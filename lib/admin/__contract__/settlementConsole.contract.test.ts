// 계약 테스트: 관리자 정산 관리(PR-9 §1) — 미리보기 → 실행 · 지급 이력 · 멘토별.
// 실행: node --test --experimental-strip-types lib/admin/__contract__/settlementConsole.contract.test.ts
//
// 고정하는 것(지시서 §4):
//   ① 미리보기: 합계 = 멘토별 합 · 계좌 미등록 건은 합계에서 빠지고 경고 묶음에 보인다 · 대사 불일치 시 실행 잠금
//   ② 실행: critical · 사유 필수(서버 액션도 검사) · summary 금액 == hidden(RPC 대조 입력) == 미리보기 합계
//   ③ 멘토별 금액은 각 멘토의 실제 단가(정산 행 gross) — 요금제별 고정 단가(카탈로그 cashKrw)로 계산하면 실패
//   ④ 지급 이력: payout_run_items 는 select 만(쓰기 없음) · 실행 순서(드라이런 = run_scheduled_payout force · 실행 = pay_due_payouts_for_run dry_run=false)
//   ⑤ scheduler_enabled 변경 0 · 빈 상태 문구 · 지급일·cutoff 산술이 RPC 규칙과 같다

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  PAYOUT_RUN_DAY_OF_MONTH,
  SETTLEMENT_EMPTY_STATE,
  SETTLEMENT_EXECUTE_FIELDS,
  SETTLEMENT_EXECUTE_BLOCK_MESSAGES,
  SETTLEMENT_NOTICE,
  SETTLEMENT_TABS,
  buildPayoutExecuteDetails,
  buildPayoutExecuteSummary,
  buildSettlementPreview,
  buildSettlementUrl,
  currentPayoutRunDate,
  expectedMatchesDryRun,
  formatSettlementWon,
  individualQuestionSettlementStatus,
  isSettlementReasonValid,
  mentorLineStatusLabel,
  orderedTierBreakdown,
  parsePayoutExecuteExpected,
  parsePayoutRunItemRow,
  parsePayoutRunResult,
  parseReconciliationRow,
  payoutCutoffInstant,
  payoutCutoffLabel,
  payoutExecuteHiddenFields,
  payoutExecuteSummaryInputFor,
  payoutRunIdempotencyKey,
  payoutRunTitle,
  previewTotalsMatchMentors,
  reconcilePreviewWithDryRun,
  resolveSettlementTab,
  settlementExecuteBlock,
  settlementItemKey,
  settlementMentorTabPath,
  summarizeMentorLines,
  summarizePayoutRunItems,
  type PayoutRunResult,
  type ReconciliationRow,
  type SettlementItemExtra,
  type SettlementMentorInfo,
} from "../settlementConsole.ts";
import { SUBSCRIBE_PLAN_CATALOG } from "../../subscribe/subscribePlanCatalog.ts";
import { ADMIN_CONFIRM_REASON_MIN_LENGTH } from "../adminConfirmPolicy.ts";

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

// ── 픽스처: 대사표(RPC) 행 — 멘토 A(계좌 있음, 실제 단가 29,900·84,900) · 멘토 B(계좌 있음, 같은 요금제인데 단가 39,900) · 멘토 C(계좌 없음) ──

const A = "aaaaaaaa-0000-0000-0000-000000000001";
const B = "bbbbbbbb-0000-0000-0000-000000000002";
const C = "cccccccc-0000-0000-0000-000000000003";

function rpcRow(over: Partial<Record<string, unknown>>): Record<string, unknown> {
  return { source_type: "subscription", source_id: "s", mentor_id: A, mentor_amount_cents: 0, withholding_cents: 0, net_paid_cents: 0, eligible: true, reason: "eligible", ...over };
}

// 멘토 A — 라이트 29,900 (fee 15% → 4,485 · mentor 25,415 · wh 838 · net 24,577) · 스탠다드 84,900 (12,735 · 72,165 · 2,381 · 69,784)
// 멘토 B — 라이트 **39,900**(자기 단가) (5,985 · 33,915 · 1,119 · 32,796) · 개별질문 10,000 (85% → 8,500 · wh 280 · net 8,220)
// 멘토 C — 계좌 미등록 · 스탠다드 84,900 → no_payout_account
// not_due 1건 · already_paid 1건
const RAW_ROWS = [
  rpcRow({ source_id: "sub-a1", mentor_id: A, mentor_amount_cents: 2_541_500, withholding_cents: 83_800, net_paid_cents: 2_457_700 }),
  rpcRow({ source_id: "sub-a2", mentor_id: A, mentor_amount_cents: 7_216_500, withholding_cents: 238_100, net_paid_cents: 6_978_400 }),
  rpcRow({ source_id: "sub-b1", mentor_id: B, mentor_amount_cents: 3_391_500, withholding_cents: 111_900, net_paid_cents: 3_279_600 }),
  rpcRow({ source_type: "individual_question", source_id: "iq-b1", mentor_id: B, mentor_amount_cents: 850_000, withholding_cents: 28_000, net_paid_cents: 822_000 }),
  rpcRow({ source_id: "sub-c1", mentor_id: C, mentor_amount_cents: 7_216_500, withholding_cents: 238_100, net_paid_cents: 6_978_400, eligible: false, reason: "no_payout_account" }),
  rpcRow({ source_id: "sub-a3", mentor_id: A, mentor_amount_cents: 2_541_500, withholding_cents: 83_800, net_paid_cents: 2_457_700, eligible: false, reason: "not_due" }),
  rpcRow({ source_type: "custom_request", source_id: "cr-a1", mentor_id: A, mentor_amount_cents: 950_000, withholding_cents: 31_300, net_paid_cents: 918_700, eligible: false, reason: "already_paid" }),
];

const ROWS = RAW_ROWS.map((r) => parseReconciliationRow(r)!).filter(Boolean);

const EXTRAS = new Map<string, SettlementItemExtra>([
  [settlementItemKey("subscription", "sub-a1"), { grossCents: 2_990_000, platformFeeCents: 448_500, feeRate: 0.15, planTier: "limited", studentId: "st-1" }],
  [settlementItemKey("subscription", "sub-a2"), { grossCents: 8_490_000, platformFeeCents: 1_273_500, feeRate: 0.15, planTier: "standard", studentId: "st-2" }],
  [settlementItemKey("subscription", "sub-b1"), { grossCents: 3_990_000, platformFeeCents: 598_500, feeRate: 0.15, planTier: "limited", studentId: "st-3" }],
  [settlementItemKey("individual_question", "iq-b1"), { grossCents: 1_000_000, platformFeeCents: 150_000, feeRate: 0.15, planTier: null, studentId: null }],
  [settlementItemKey("subscription", "sub-c1"), { grossCents: 8_490_000, platformFeeCents: 1_273_500, feeRate: 0.15, planTier: "standard", studentId: "st-4" }],
]);

const MENTORS = new Map<string, SettlementMentorInfo>([
  [A, { name: "멘토A", accountRegistered: true, accountDisplay: "국민 ****1234" }],
  [B, { name: "멘토B", accountRegistered: true, accountDisplay: "신한 ****5678" }],
  [C, { name: "멘토C", accountRegistered: false, accountDisplay: "미등록" }],
]);

const preview = buildSettlementPreview({ rows: ROWS, extras: EXTRAS, mentors: MENTORS });

/** 드라이런(실행 함수와 같은 경로)이 돌려줄 값 — 픽스처의 eligible 합계와 같다 */
const DRY_OK: PayoutRunResult = {
  runId: null,
  dryRun: true,
  paidCount: 4,
  skippedNoAccount: 1,
  totalMentorCents: 2_541_500 + 7_216_500 + 3_391_500 + 850_000,
  totalWithholdingCents: 83_800 + 238_100 + 111_900 + 28_000,
  totalNetCents: 2_457_700 + 6_978_400 + 3_279_600 + 822_000,
  schedulerEnabled: false,
};

// ── ① 미리보기 ────────────────────────────────────────────────────────────────

test("대사표 행 파싱: 채널·id·멘토가 없으면 null(조용히 0 으로 접지 않음) · eligible/reason 그대로", () => {
  assert.equal(parseReconciliationRow({ source_type: "subscription", source_id: "", mentor_id: A }), null);
  assert.equal(parseReconciliationRow({ source_type: "weird", source_id: "x", mentor_id: A }), null);
  const r = parseReconciliationRow(RAW_ROWS[4])!;
  assert.equal(r.eligible, false);
  assert.equal(r.reason, "no_payout_account");
  assert.equal(r.mentorAmountCents, 7_216_500);
});

test("합계 = 지급 대상(eligible) 멘토별 합 — 계좌 미등록·미도래·지급 완료 건은 합계에 들어가지 않는다", () => {
  assert.equal(preview.totals.mentorCount, 2);
  assert.equal(preview.totals.itemCount, 4);
  assert.equal(preview.totals.mentorCents, DRY_OK.totalMentorCents);
  assert.equal(preview.totals.withholdingCents, DRY_OK.totalWithholdingCents);
  assert.equal(preview.totals.netCents, DRY_OK.totalNetCents);
  assert.equal(preview.totals.grossCents, 2_990_000 + 8_490_000 + 3_990_000 + 1_000_000);
  assert.equal(preview.totals.platformFeeCents, 448_500 + 1_273_500 + 598_500 + 150_000);
  assert.equal(previewTotalsMatchMentors(preview), true);
  assert.deepEqual(preview.totals.bySource.subscription, { count: 3, grossCents: 2_990_000 + 8_490_000 + 3_990_000, mentorCents: 2_541_500 + 7_216_500 + 3_391_500 });
  assert.deepEqual(preview.totals.bySource.individual_question, { count: 1, grossCents: 1_000_000, mentorCents: 850_000 });
  assert.deepEqual(preview.totals.bySource.custom_request, { count: 0, grossCents: 0, mentorCents: 0 });
});

test("계좌 미등록 멘토는 별도 묶음(경고)에 금액과 함께 보이고 지급 대상 목록에는 없다", () => {
  assert.equal(preview.noAccount.mentorCount, 1);
  assert.equal(preview.noAccount.itemCount, 1);
  assert.equal(preview.noAccount.netCents, 6_978_400);
  assert.equal(preview.noAccount.mentors[0].mentorId, C);
  assert.equal(preview.noAccount.mentors[0].eligible, false);
  assert.equal(preview.noAccount.mentors[0].accountDisplay, "미등록");
  assert.ok(!preview.mentors.some((m) => m.mentorId === C));
  assert.deepEqual(preview.notDue, { count: 1, mentorCents: 2_541_500 });
  assert.deepEqual(preview.alreadyPaid, { count: 1, mentorCents: 950_000 });
});

test("멘토별 행: 실지급액 큰 순 · 요금제별 인원·금액 · 개별질문·맞춤의뢰 · 원천징수는 RPC 행 합(재계산 없음)", () => {
  assert.deepEqual(preview.mentors.map((m) => m.name), ["멘토A", "멘토B"]);
  const a = preview.mentors[0];
  assert.equal(a.itemCount, 2);
  assert.equal(a.withholdingCents, 83_800 + 238_100);
  assert.equal(a.netCents, 2_457_700 + 6_978_400);
  assert.equal(a.platformFeeCents, 448_500 + 1_273_500);
  const tiers = orderedTierBreakdown(a.subscription.byTier);
  assert.deepEqual(tiers.map((t) => `${t.label} ${t.breakdown.studentCount}명`), ["라이트 1명", "스탠다드 1명"]);
  const b = preview.mentors[1];
  assert.equal(b.individual.count, 1);
  assert.equal(b.individual.mentorCents, 850_000);
  assert.equal(b.subscription.count, 1);
  assert.equal(b.custom.count, 0);
});

// ── ③ 각 멘토 실제 단가 ────────────────────────────────────────────────────────

test("멘토별 금액은 각 멘토의 실제 단가(정산 행 gross) — 같은 라이트 요금제라도 A 29,900 · B 39,900 이 그대로다(요금제 고정 단가면 실패)", () => {
  const catalogLimited = SUBSCRIBE_PLAN_CATALOG.find((p) => p.tier === "limited")!.cashKrw * 100;
  const a = preview.mentors.find((m) => m.mentorId === A)!;
  const b = preview.mentors.find((m) => m.mentorId === B)!;
  assert.equal(a.subscription.byTier.limited.grossCents, 2_990_000);
  assert.equal(b.subscription.byTier.limited.grossCents, 3_990_000);
  assert.notEqual(b.subscription.byTier.limited.grossCents, catalogLimited, "B 의 라이트 금액이 카탈로그 고정가와 같으면 고정 단가로 계산한 것");
  assert.equal(b.subscription.byTier.limited.mentorCents, 3_391_500);
  // 순수 모듈·조회 모듈 어디에도 카탈로그 가격(cashKrw)·요율 리터럴로 금액을 만드는 코드가 없다
  for (const rel of ["lib/admin/settlementConsole.ts", "lib/admin/settlementConsoleQueries.ts", "lib/admin/settlementActions.ts"]) {
    const code = stripComments(read(rel));
    assert.ok(!/cashKrw/.test(code), `${rel}: 카탈로그 가격 사용 금지`);
    assert.ok(!/\* 0\.(85|15|05|033)\b/.test(code), `${rel}: 요율·원천징수 리터럴 재계산 금지`);
    assert.ok(!/calc_withholding|0\.033/.test(code), `${rel}: 원천징수는 RPC 값만`);
  }
});

// ── ① 대사 · 실행 잠금 ───────────────────────────────────────────────────────

test("대사: 대사표 eligible 합계 == 드라이런 합계면 ok · 하나라도 다르면 diffs 에 항목별로 담기고 실행 잠금", () => {
  assert.deepEqual(reconcilePreviewWithDryRun(preview, DRY_OK), { ok: true, diffs: [] });
  const bad = reconcilePreviewWithDryRun(preview, { ...DRY_OK, totalNetCents: DRY_OK.totalNetCents - 100, paidCount: 5 });
  assert.equal(bad.ok, false);
  assert.deepEqual(bad.diffs.map((d) => d.label), ["지급 대상 건수", "실지급 합계"]);
  assert.deepEqual(bad.diffs[1], { label: "실지급 합계", report: DRY_OK.totalNetCents, dryRun: DRY_OK.totalNetCents - 100, unit: "원" });
  assert.equal(reconcilePreviewWithDryRun(preview, null).ok, false, "드라이런 없음 = 불일치");
  assert.equal(settlementExecuteBlock({ previewOk: true, reconciled: false, alreadyCompleted: false, eligibleCount: 4 }), "reconciliation_mismatch");
  assert.equal(settlementExecuteBlock({ previewOk: true, reconciled: true, alreadyCompleted: false, eligibleCount: 4 }), null);
  assert.equal(settlementExecuteBlock({ previewOk: false, reconciled: true, alreadyCompleted: false, eligibleCount: 4 }), "preview_failed");
  assert.equal(settlementExecuteBlock({ previewOk: true, reconciled: true, alreadyCompleted: true, eligibleCount: 4 }), "already_completed");
  assert.equal(settlementExecuteBlock({ previewOk: true, reconciled: true, alreadyCompleted: false, eligibleCount: 0 }), "nothing_eligible");
  for (const key of ["preview_failed", "reconciliation_mismatch", "already_completed", "nothing_eligible"] as const) {
    assert.ok(SETTLEMENT_EXECUTE_BLOCK_MESSAGES[key].length > 0, key);
  }
});

// ── ② 실행: summary 금액 == hidden(RPC 대조 입력) == 미리보기 ─────────────────

test("실행 summary: '멘토 N명에게 총 X원을 정산 확정합니다' + 계좌 미등록 제외 + '실제 이체는 별도' — 금액은 미리보기 합계 그대로", () => {
  const input = payoutExecuteSummaryInputFor(preview);
  const summary = buildPayoutExecuteSummary(input);
  assert.equal(
    summary,
    `멘토 2명에게 총 ${formatSettlementWon(DRY_OK.totalNetCents)}을 정산 확정합니다.\n계좌 미등록 1명(${formatSettlementWon(6_978_400)})은 제외됩니다.\n실제 이체는 별도로 진행합니다.`
  );
  assert.equal(formatSettlementWon(DRY_OK.totalNetCents), "135,377원");
  assert.equal(buildPayoutExecuteSummary({ ...input, noAccountMentorCount: 0 }).includes("계좌 미등록"), false);
  const details = buildPayoutExecuteDetails(preview, "2026-09-23");
  assert.deepEqual(details.map((d) => d.label), ["지급일", "지급 대상", "멘토 정산금 합계", "원천징수 합계(3.3%)", "실지급 합계"]);
  assert.equal(details[4].value, formatSettlementWon(preview.totals.netCents));
});

test("hidden 필드(서버 액션의 드라이런 대조 입력)는 summary·details 와 같은 미리보기 값이고, 드라이런과 1:1 로 대조된다", () => {
  const hidden = payoutExecuteHiddenFields(preview, "2026-09-23");
  assert.equal(hidden[SETTLEMENT_EXECUTE_FIELDS.runDate], "2026-09-23");
  assert.equal(hidden[SETTLEMENT_EXECUTE_FIELDS.expectedNetCents], String(preview.totals.netCents));
  assert.equal(hidden[SETTLEMENT_EXECUTE_FIELDS.expectedSkipped], String(preview.noAccount.itemCount));
  const expected = parsePayoutExecuteExpected((f) => hidden[f as keyof typeof hidden])!;
  assert.ok(expected);
  assert.equal(expectedMatchesDryRun(expected, DRY_OK), true);
  assert.equal(expectedMatchesDryRun(expected, { ...DRY_OK, totalNetCents: DRY_OK.totalNetCents + 1 }), false, "실행 직전 대상이 바뀌면 거부");
  assert.equal(expectedMatchesDryRun(expected, { ...DRY_OK, skippedNoAccount: 0 }), false);
  assert.equal(parsePayoutExecuteExpected(() => "abc"), null, "정수가 아니면 거부");
  assert.equal(parsePayoutExecuteExpected(() => ""), null);
});

test("사유 필수: 최소 길이(확인 다이얼로그와 같은 기준) 미만은 거부", () => {
  assert.equal(isSettlementReasonValid(""), false);
  assert.equal(isSettlementReasonValid("  "), false);
  assert.equal(isSettlementReasonValid("x".repeat(ADMIN_CONFIRM_REASON_MIN_LENGTH - 1)), false);
  assert.equal(isSettlementReasonValid("월 정산 정기 실행"), true);
});

test("서버 액션 tripwire: requireRole(admin) 첫 줄 · 사유 검사 · 이미 완료 거부 · 드라이런 재대조 · pay_due_payouts_for_run 은 p_dry_run:false 로 정확히 1회 · 감사 로그", () => {
  const src = read("lib/admin/settlementActions.ts");
  const code = stripComments(src);
  assert.ok(src.startsWith('"use server"'));
  assert.ok(code.includes('await requireRole("admin")'));
  assert.ok(code.includes("isSettlementReasonValid(reason)"), "사유 서버 검사");
  assert.ok(code.includes("expectedMatchesDryRun(expected, dryRun)"), "드라이런 재대조");
  assert.ok(code.includes('=== "completed"'), "이미 완료된 달 거부");
  assert.ok(code.includes("resolveAdminWriteClient(() => createServiceRoleClient())"), "fail-closed 쓰기 클라이언트");
  const execCalls = code.match(/rpc\("pay_due_payouts_for_run"/g) ?? [];
  assert.equal(execCalls.length, 1, "실행 RPC 는 액션 안에 정확히 1회");
  assert.ok(/rpc\("pay_due_payouts_for_run", \{ p_run_date: runDate, p_idempotency_key: null, p_dry_run: false \}\)/.test(code), "p_dry_run:false 명시");
  assert.ok(/rpc\("run_scheduled_payout", \{ p_run_date: runDate, p_force_dry_run: true \}\)/.test(code), "드라이런은 강제 드라이런");
  assert.ok(code.includes("logAdminAction(") && code.includes("PAYOUT_RUN_EXECUTE_ACTION_TYPE"), "감사 로그");
  assert.ok(!/scheduler_enabled|payout_settings/.test(code), "스케줄러 설정을 읽거나 쓰지 않는다");
});

test("실행 버튼 tripwire: ConfirmSubmitButton level=critical · summary/details/hidden 이 같은 미리보기에서 · reasonPresets", () => {
  const src = read("components/admin/SettlementExecuteButton.tsx");
  const code = stripComments(src);
  assert.ok(src.startsWith('"use client"'));
  assert.ok(code.includes('level="critical"'), "critical");
  assert.ok(code.includes("buildPayoutExecuteSummary(payoutExecuteSummaryInputFor(preview))"), "summary 는 미리보기에서");
  assert.ok(code.includes("payoutExecuteHiddenFields(preview, runDate)"), "hidden 은 같은 미리보기에서");
  assert.ok(code.includes("buildPayoutExecuteDetails(preview, runDate)"), "금액 재표시");
  assert.ok(code.includes("action={executePayoutRunAction}"), "서버 액션 폼");
  assert.ok(code.includes("reasonFieldName={SETTLEMENT_EXECUTE_REASON_FIELD}"));
  assert.ok(code.includes("reasonPresets={SETTLEMENT_EXECUTE_REASON_PRESETS}"));
  assert.ok(code.includes("confirmBlockedMessage="), "잠금 사유를 다이얼로그에도 전달");
});

// ── ④ 지급 이력 · 읽기 전용 · 실행 순서 ─────────────────────────────────────

test("조회 모듈 tripwire: payout_run_items · payout_runs 는 select 만(insert/update/delete/upsert 없음) · 드라이런은 run_scheduled_payout(force) · 실행 RPC 호출 없음", () => {
  const code = stripComments(read("lib/admin/settlementConsoleQueries.ts"));
  assert.ok(code.includes('import "server-only"'));
  assert.ok(!/\.(insert|update|upsert|delete)\(/.test(code), "조회 모듈에 쓰기 호출 금지");
  assert.ok(!code.includes('rpc("pay_due_payouts_for_run"'), "조회 모듈은 실행 RPC 를 부르지 않는다");
  assert.ok(/rpc\("run_scheduled_payout", \{ p_run_date: runDate, p_force_dry_run: true \}\)/.test(code), "드라이런은 강제 드라이런 플래그");
  assert.ok(code.includes('rpc("payout_reconciliation_report", { p_run_date: runDate })'), "대사표 RPC");
  assert.ok(!/scheduler_enabled|payout_settings/.test(code), "스케줄러 설정 미접근");
  // payout_settings 를 읽거나 scheduler_enabled 를 켜는 TS 코드가 없다(오너 결정). 순수 모듈은 RPC 응답의 scheduler_enabled 를 **표시용으로 읽기만** 한다.
  for (const rel of ["lib/admin/settlementConsole.ts", "lib/admin/topupConsole.ts", "lib/admin/topupConsoleQueries.ts", "lib/admin/settlementActions.ts"]) {
    const c = stripComments(read(rel));
    assert.ok(!/payout_settings/.test(c), rel);
    assert.ok(!/scheduler_enabled\s*[=:]\s*true|update\([^)]*scheduler_enabled/.test(c), `${rel}: 스케줄러 켜기 금지`);
  }
});

test("지급 이력 파싱·합계: payout_run_items 스냅샷 값 그대로 · net_paid_cents null(153 이전 행)은 정산금−원천징수", () => {
  const it = parsePayoutRunItemRow({ id: "i1", payout_run_id: "r1", mentor_id: A, source_type: "subscription", source_id: "sub-a1", gross_cents: 2_990_000, platform_fee_cents: 448_500, mentor_amount_cents: 2_541_500, fee_rate: "0.15", withholding_cents: 83_800, net_paid_cents: 2_457_700 })!;
  assert.equal(it.netPaidCents, 2_457_700);
  assert.equal(it.feeRate, 0.15);
  const legacy = parsePayoutRunItemRow({ id: "i2", payout_run_id: "r1", mentor_id: B, source_type: "individual_question", source_id: "iq", gross_cents: 1_000_000, platform_fee_cents: 150_000, mentor_amount_cents: 850_000, fee_rate: 0.15, withholding_cents: 28_000, net_paid_cents: null })!;
  assert.equal(legacy.netPaidCents, 822_000);
  assert.deepEqual(summarizePayoutRunItems([it, legacy]), { count: 2, mentorCount: 2, mentorCents: 3_391_500, withholdingCents: 111_800, netCents: 3_279_700 });
  assert.equal(parsePayoutRunItemRow({ payout_run_id: "r1" }), null);
});

test("RPC 결과 파싱: run_scheduled_payout(jsonb) · pay_due_payouts_for_run(returns table 1행 배열) 을 같은 형상으로", () => {
  const fromJson = parsePayoutRunResult({ ok: true, scheduler_enabled: false, dry_run: true, run_id: null, paid_count: 4, skipped_no_account: 1, total_mentor_cents: "13999500", total_withholding_cents: 461800, total_net_cents: 13537700 })!;
  assert.equal(fromJson.dryRun, true);
  assert.equal(fromJson.schedulerEnabled, false);
  assert.equal(fromJson.totalMentorCents, 13_999_500);
  const fromTable = parsePayoutRunResult([{ run_id: "r-1", paid_count: 4, skipped_no_account: 1, total_mentor_cents: 13999500, total_withholding_cents: 461800, total_net_cents: 13537700, dry_run: false }])!;
  assert.equal(fromTable.runId, "r-1");
  assert.equal(fromTable.dryRun, false);
  assert.equal(fromTable.schedulerEnabled, null);
  assert.equal(parsePayoutRunResult(null), null);
  assert.equal(parsePayoutRunResult([]), null);
  assert.equal(parsePayoutRunResult({ ok: true }), null);
});

// ── ⑤ 지급일 · cutoff · 탭 · 문구 ────────────────────────────────────────────

test("지급일: KST 달력 기준 이번 달 23일 — UTC 로는 전날 밤이어도 KST 달을 따른다 · 멱등키 payout:YYYY-MM · cutoff = 달 1일 00:00 KST − 1초", () => {
  assert.equal(PAYOUT_RUN_DAY_OF_MONTH, 23);
  assert.equal(currentPayoutRunDate(new Date("2026-09-03T00:00:00Z")), "2026-09-23");
  assert.equal(currentPayoutRunDate(new Date("2026-09-30T15:30:00Z")), "2026-10-23", "UTC 9/30 15:30 = KST 10/1 00:30");
  assert.equal(currentPayoutRunDate(new Date("2026-08-31T14:59:59Z")), "2026-08-23");
  assert.equal(payoutRunIdempotencyKey("2026-09-23"), "payout:2026-09");
  assert.equal(payoutCutoffInstant("2026-09-23").toISOString(), "2026-08-31T14:59:59.000Z");
  assert.equal(payoutCutoffInstant("2026-01-23").toISOString(), "2025-12-31T14:59:59.000Z");
  assert.equal(payoutCutoffLabel("2026-09-23"), "8월 31일 23:59(KST)까지 완료된 건");
  assert.equal(payoutRunTitle("2026-09-23"), "2026년 9월 정산 · 지급 예정일 9월 23일");
  assert.throws(() => payoutRunIdempotencyKey("2026-9-23"));
});

test("탭 3개(이번 달 정산 · 지급 이력 · 멘토별) · 기본 탭 · 링크 · 계정 상세 멘토 탭 링크", () => {
  assert.deepEqual(SETTLEMENT_TABS.map((t) => t.label), ["이번 달 정산", "지급 이력", "멘토별"]);
  assert.equal(resolveSettlementTab(undefined), "current");
  assert.equal(resolveSettlementTab("history"), "history");
  assert.equal(resolveSettlementTab("weird"), "current");
  assert.equal(buildSettlementUrl(), "/admin/settlements");
  assert.equal(buildSettlementUrl({ tab: "history", run: "r-1" }), "/admin/settlements?tab=history&run=r-1");
  assert.equal(settlementMentorTabPath(A), `/admin/settlements?tab=mentor&mentor=${A}`);
  const mentorTab = read("components/admin/AccountMentorTab.tsx");
  assert.ok(mentorTab.includes("settlementMentorTabPath(userId)"), "계정 상세 멘토 탭 → 정산 멘토별 링크");
});

test("멘토별 라인: 상태 라벨 통일(정산 예정 아님 → 지급 대기) · 개별질문 상태는 RPC individual_question 분기와 같은 규칙 · 요약", () => {
  assert.equal(mentorLineStatusLabel("pending"), "지급 대기");
  assert.equal(mentorLineStatusLabel("accruing"), "적립중");
  assert.equal(mentorLineStatusLabel("on_hold"), "보류");
  assert.equal(mentorLineStatusLabel("paid"), "지급 완료");
  assert.equal(mentorLineStatusLabel("cancelled"), "취소");
  assert.equal(individualQuestionSettlementStatus({ release_ledger_id: "l", status: "released" }), "paid");
  assert.equal(individualQuestionSettlementStatus({ release_ledger_id: null, refund_ledger_id: "r", status: "released" }), "canceled");
  assert.equal(individualQuestionSettlementStatus({ release_ledger_id: null, refund_ledger_id: null, status: "expired" }), "canceled");
  assert.equal(individualQuestionSettlementStatus({ release_ledger_id: null, refund_ledger_id: null, status: "released" }), "pending");
  const s = summarizeMentorLines([
    { key: "a", sourceType: "subscription", sourceId: "a", occurredAt: null, description: "", grossCents: 0, platformFeeCents: 0, mentorCents: 100, feeRate: 0.15, status: "pending", holdReason: null, paidRunDate: null, paidAt: null },
    { key: "b", sourceType: "subscription", sourceId: "b", occurredAt: null, description: "", grossCents: 0, platformFeeCents: 0, mentorCents: 200, feeRate: 0.15, status: "paid", holdReason: null, paidRunDate: "2026-09-23", paidAt: null },
    { key: "c", sourceType: "custom_request", sourceId: "c", occurredAt: null, description: "", grossCents: 0, platformFeeCents: 0, mentorCents: 300, feeRate: 0.05, status: "on_hold", holdReason: "active_dispute", paidRunDate: null, paidAt: null },
    { key: "d", sourceType: "subscription", sourceId: "d", occurredAt: null, description: "", grossCents: 0, platformFeeCents: 0, mentorCents: 400, feeRate: 0.15, status: "accruing", holdReason: null, paidRunDate: null, paidAt: null },
  ]);
  assert.deepEqual(s, { pendingCents: 100, pendingCount: 1, accruingCents: 400, accruingCount: 1, heldCents: 300, heldCount: 1, paidCents: 200, paidCount: 1, canceledCount: 0 });
});

test("문구: 상단 안내(실행 = 시스템상 지급 확정 · 실제 이체 별도) · 빈 상태 · 금지 문구 없음", () => {
  assert.equal(SETTLEMENT_NOTICE, "정산 실행은 시스템상 지급 확정입니다. 실제 계좌 이체는 별도로 진행합니다.");
  assert.equal(SETTLEMENT_EMPTY_STATE.title, "이번 달 정산 대상이 없습니다");
  assert.equal(SETTLEMENT_EMPTY_STATE.description, "구독·개별질문·맞춤의뢰가 발생하면 정산 항목이 쌓입니다. 지급일은 매월 23일입니다.");
  const src = read("lib/admin/settlementConsole.ts");
  for (const banned of ["정산 대기", "작업전", "선생님", "수강생", "과외"]) assert.ok(!src.includes(banned), banned);
});

test("정산 화면 tripwire: PageScaffold 없음(준비 중 카드 제거) · AdminPageLayout · 탭 3개 · 상단 안내 상시", () => {
  const page = stripComments(read("app/(admin)/admin/(console)/settlements/page.tsx"));
  assert.ok(!page.includes("PageScaffold"), "준비 중 카드를 그리던 PageScaffold 제거");
  assert.ok(page.includes('from "@/components/admin/AdminPageLayout"'));
  assert.ok(page.includes("SETTLEMENT_NOTICE"), "상단 안내 상시");
  assert.ok(!page.includes("준비 중"));
  assert.ok(page.includes("<SettlementTabNav tab={tab} />"), "탭 3개");
});
