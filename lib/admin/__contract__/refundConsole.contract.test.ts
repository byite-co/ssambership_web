// 계약 테스트: 환불 관리 화면(PR-3) — 지시서 §8 검증 항목.
// 실행: node --test --experimental-strip-types lib/admin/__contract__/refundConsole.contract.test.ts
//
// .tsx 는 node --test 로 import 할 수 없으므로(strip-types 는 JSX 미지원):
//   ① 순수 규칙(탭·URL·종류·금액 출처·기준 표시·승인 summary·반려 프리셋·일괄 선택/부분 실패 모델·검색·빈 상태 카피)은 직접 검증한다
//   ② 렌더·배선 규칙은 소스 스캔 tripwire 로 고정한다(PageScaffold 미사용 · 승인 critical · 반려 프리셋 · 일괄 body 슬롯 · 처리자 컬럼 ·
//      PG 경고 상시 노출 · 학생 계산 함수 재사용(재구현 금지) · 서버 액션 사유 필수 · 일괄은 건별 반복 + 롤백 없음 + redirect 없음)

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseAdminListParams, buildAdminListUrl } from "../adminListParams.ts";
import { evaluateAdminConfirm, resolveAdminConfirmRequirements } from "../adminConfirmPolicy.ts";
import { adminStatusAllowedValues, resolveAdminStatus } from "../adminStatusDictionary.ts";
import { computeProratedRefundEstimate, refundBracketLabelKo } from "../../subscribe/subscriptionRefundProration.ts";
import {
  REFUND_BASE_PATH,
  REFUND_BULK_DECISION_FIELD,
  REFUND_BULK_IDS_FIELD,
  REFUND_BULK_MAX_IDS,
  REFUND_CUSTOM_REASON_LABEL,
  REFUND_DEFAULT_PAGE_SIZE,
  REFUND_DEFAULT_TAB,
  REFUND_EMPTY_STATE,
  REFUND_KIND_LABELS,
  REFUND_PG_MANUAL_WARNING,
  REFUND_REASON_FIELD,
  REFUND_REJECT_REASON_PRESETS,
  REFUND_RETURN_TO_FIELD,
  REFUND_TABS,
  REFUND_TAB_VALUES,
  REFUND_ZERO_BASIS_WARNING,
  approveSummaryInputFor,
  buildRefundApproveDetails,
  buildRefundApproveSummary,
  buildRefundBulkSummary,
  buildRefundDetailTitle,
  buildRefundListUrl,
  buildRefundRejectSummary,
  buildRefundSearchOr,
  buildRefundUserSearchOr,
  bulkSelectionSummary,
  describeRefundBasis,
  failedRefundIds,
  formatRefundBulkResultLine,
  formatRefundElapsed,
  formatRefundWon,
  isRefundReasonValid,
  isZeroBasisRefund,
  normalizeRefundSearchTerm,
  refundAmountWon,
  refundBasisMismatch,
  refundBasisShortLabel,
  refundBulkConfirmLabel,
  refundBulkErrorState,
  refundDetailPath,
  refundModeForKind,
  refundQueueProgressRange,
  refundStatusAfterApprovalSentence,
  refundTabStatus,
  resolveRefundKind,
  resolveRefundReturnPath,
  resolveRefundTab,
  summarizeRefundBulkResults,
  summarizeRefundReason,
  sumRefundWon,
  type RefundBulkItemResult,
  type RefundDecisionTarget,
} from "../refundConsole.ts";

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const LIST_PAGE = "app/(admin)/admin/(console)/refunds/page.tsx";
const DETAIL_PAGE = "app/(admin)/admin/(console)/refunds/[id]/page.tsx";
const TABLE = "components/admin/RefundQueueTable.tsx";
const TOOLBAR = "components/admin/RefundQueueToolbar.tsx";
const PAGINATION = "components/admin/RefundQueuePagination.tsx";
const EMPTY = "components/admin/RefundEmptyState.tsx";
const PG_WARNING = "components/admin/RefundPgManualWarning.tsx";
const DECISION = "components/admin/RefundDecisionButtons.tsx";
const CONSOLE = "lib/admin/refundConsole.ts";
const QUERIES = "lib/admin/refundConsoleQueries.ts";
const ACTIONS = "lib/admin/refundActions.ts";
const BULK_ACTIONS = "lib/admin/bulkActions.ts";
const DIALOG = "components/admin/AdminConfirmDialog.tsx";

function spFrom(url: string): Record<string, string | string[] | undefined> {
  const u = new URL(url, "https://ssambership.local");
  const sp: Record<string, string | string[] | undefined> = {};
  for (const [k, v] of u.searchParams.entries()) sp[k] = v;
  return sp;
}

/** 요청 시점 저장값 픽스처 — 스탠다드 84,900원(minor 8,490,000) */
const STORED_AMOUNT_CENTS = 8_490_000;
const TARGET: RefundDecisionTarget = {
  id: "11111111-1111-4111-8111-111111111111",
  requesterName: "김서연",
  amountWon: refundAmountWon(STORED_AMOUNT_CENTS),
  kind: "subscription_student",
  planLabel: "스탠다드",
  basis: null,
  subscriptionId: "22222222-2222-4222-8222-222222222222",
};

// ── §8 탭 키 status 하나 · 클라이언트 필터 없음 ─────────────────────────────

test("탭은 대기·완료·반려·취소·전체 5개, 기본 탭은 대기, 라벨은 상태 사전과 같다", () => {
  assert.deepEqual([...REFUND_TAB_VALUES], ["pending", "succeeded", "rejected", "canceled", "all"]);
  assert.deepEqual(
    REFUND_TABS.map((t) => t.label),
    ["대기", "완료", "반려", "취소", "전체"]
  );
  assert.equal(REFUND_DEFAULT_TAB, "pending");
  for (const t of REFUND_TABS) {
    if (t.value === "all") continue;
    assert.equal(resolveAdminStatus("refunds", "status", t.value).label, t.label, `${t.value} 라벨은 사전과 같다`);
  }
  assert.deepEqual([...adminStatusAllowedValues("refunds", "status")].sort(), ["canceled", "pending", "rejected", "succeeded"]);
});

test("쿼리 키는 status 하나 — 구 type/sort 키는 탭을 바꾸지 못하고 링크에도 실리지 않는다", () => {
  const opts = { defaultPageSize: REFUND_DEFAULT_PAGE_SIZE, defaultStatus: REFUND_DEFAULT_TAB };
  const legacy = parseAdminListParams(spFrom(`${REFUND_BASE_PATH}?type=subscription_mentor_suspended&sort=deadline`), opts);
  assert.equal(resolveRefundTab(legacy.status), "pending", "type/sort 는 탭에 영향이 없다");
  assert.equal(resolveRefundTab("succeeded"), "succeeded");
  assert.equal(resolveRefundTab("weird"), "pending");
  assert.equal(resolveRefundTab(""), "pending");
  assert.equal(refundTabStatus("all"), null);
  assert.equal(refundTabStatus("rejected"), "rejected");
  const page = stripComments(read(LIST_PAGE));
  assert.ok(page.includes("const { type: _legacyType, sort: _legacySort, ...extra } = rawParams.extra;"), "구 키를 extra 에서 뺀다");
  assert.ok(!/sp\.type|sp\.sort|requestType/.test(page), "type/sort 로 목록을 바꾸는 코드 없음");
  const toolbar = stripComments(read(TOOLBAR));
  assert.ok(!toolbar.startsWith('"use client"'), "툴바는 Server Component");
  assert.ok(toolbar.includes('name="q"') && toolbar.includes('name="status"'), "검색·탭 키");
  const table = stripComments(read(TABLE));
  assert.ok(!/items\.filter\(\(i\) => i\.status ===|useSearchParams|useRouter/.test(table), "표는 상태로 클라이언트 필터하지 않는다(선택용 pending 분리만)");
});

test("전체 탭 링크는 status=all 을 잃지 않는다(공용 빌더는 지운다) · 검색·페이지 이동에도 유지", () => {
  const opts = { defaultStatus: REFUND_DEFAULT_TAB };
  const params = parseAdminListParams(spFrom(`${REFUND_BASE_PATH}?status=all&q=%EC%84%9C`), opts);
  const shared = buildAdminListUrl(REFUND_BASE_PATH, params, { status: "all" });
  assert.ok(!shared.includes("status="), shared);
  const ours = buildRefundListUrl(params, { status: "all" });
  assert.ok(ours.includes("status=all") && ours.includes("q="), ours);
  assert.ok(buildRefundListUrl(params, { page: 3 }).includes("status=all"), "페이지 이동");
  assert.ok(buildRefundListUrl(params, { search: "" }).includes("status=all"), "검색 초기화");
  const pendingHref = buildRefundListUrl(params, { status: "pending" });
  assert.ok(pendingHref.includes("status=pending") && !pendingHref.includes("status=all"), pendingHref);
  const parsedBack = parseAdminListParams(spFrom(ours), opts);
  assert.equal(resolveRefundTab(parsedBack.status), "all", "전체 탭 링크를 다시 파싱하면 전체 탭이다");
  assert.equal(refundDetailPath("abc"), "/admin/refunds/abc");
});

test("서버 조회: 탭 필터는 .eq(status) · 건수는 head count · 서버 range · 대기 건은 오래된 것부터 · 전체 탭은 대기 부분을 먼저 잇는다", () => {
  const q = stripComments(read(QUERIES));
  assert.ok(q.includes('r.eq("status", scope.status)'), "탭 필터는 서버 .eq");
  assert.ok(q.includes('r.neq("status", scope.status)'), "전체 탭 나머지 부분은 .neq");
  assert.ok(q.includes('{ count: "exact", head: true }'), "탭 건수는 head count");
  assert.ok(q.includes(".range(from, to)"), "서버 페이징");
  assert.ok(q.includes('q.order("created_at", { ascending: true })'), "대기 건은 요청일 오름차순(오래된 것부터)");
  assert.ok(q.includes("splitPendingFirstRange(pendingHead.count, from, to)"), "전체 탭: 대기 건이 항상 위");
  assert.ok(q.includes('from("users").select("id").or(buildRefundUserSearchOr(term))'), "요청자 이름·이메일 검색은 users 서버 쿼리");
  assert.ok(q.includes("r.or(buildRefundSearchOr(scope.term, scope.userIds))"), "검색이 refunds 쿼리에 배선");
});

test("검색어 정규화와 or() 인자 — 이름·닉네임·이메일 + user_id.in + 사유", () => {
  assert.equal(normalizeRefundSearchTerm("  김%서_연, (x) "), "김 서 연 x");
  assert.equal(normalizeRefundSearchTerm(null), "");
  assert.equal(normalizeRefundSearchTerm("a".repeat(200)).length, 80);
  const userOr = buildRefundUserSearchOr("서연");
  for (const col of ["full_name", "nickname", "email"]) assert.ok(userOr.includes(`${col}.ilike.%서연%`), col);
  const or = buildRefundSearchOr("서연", ["11111111-1111-4111-8111-111111111111", "bad"]);
  assert.ok(or.includes("reason.ilike.%서연%"));
  assert.ok(or.includes("user_id.in.(11111111-1111-4111-8111-111111111111)") && !or.includes("bad"));
  assert.ok(!or.includes("id.ilike"), "UUID 형식이 아니면 환불 ID 검색 절 없음");
  assert.ok(buildRefundSearchOr("1111", []).includes("id.ilike.1111%"), "UUID 앞부분이면 환불 ID 검색");
  assert.ok(!buildRefundSearchOr("x", []).includes("user_id.in"), "id 없으면 in 절 생략");
});

// ── §0 2번 · §8 모달 금액 = 저장값(refunds.amount_cents) ─────────────────────

test("금액 출처는 refunds.amount_cents 저장값 하나 — minor→원 변환 함수 하나만 쓴다(모달 표시 = RPC 실지급)", () => {
  assert.equal(refundAmountWon(STORED_AMOUNT_CENTS), 84_900);
  assert.equal(refundAmountWon("8490000"), 84_900);
  assert.equal(refundAmountWon(null), null, "저장값 없음 → null(금액 미설정)");
  assert.equal(refundAmountWon(undefined), null);
  assert.equal(refundAmountWon(-100), 0);
  assert.equal(formatRefundWon(84_900), "84,900원");
  assert.equal(formatRefundWon(null), "금액 미설정");
  assert.equal(sumRefundWon([{ amountWon: 84_900 }, { amountWon: null }, { amountWon: 29_900 }]), 114_800);

  // 서버 조회가 저장값을 이 함수로만 변환하고, 액션은 금액을 RPC 에 넘기지 않는다(RPC 가 r.amount_cents 를 그대로 쓴다).
  const q = stripComments(read(QUERIES));
  assert.ok(q.includes("const amountCents = num(row.amount_cents);") && q.includes("amountWon: refundAmountWon(amountCents),"), "목록·상세 금액은 저장값");
  const a = stripComments(read(ACTIONS));
  assert.ok(a.includes("p_refund_id: refundId,") && a.includes("p_admin_id: adminId,") && a.includes("p_admin_note: adminNote,"), "RPC 인자 3개");
  assert.ok(!/p_amount|amount_cents/.test(a), "액션은 금액을 계산·전달하지 않는다 — 저장값이 유일한 출처");
});

test("승인 summary: 방향을 문장으로 + 종류·기준 + 승인 후 구독 상태(트리거 동작), details 첫 행이 실지급 금액(저장값)", () => {
  const summary = buildRefundApproveSummary(approveSummaryInputFor(TARGET));
  const lines = summary.split("\n");
  assert.equal(lines[0], "김서연 학생에게 84,900원을 캐시로 환불합니다.");
  assert.equal(lines[1], "스탠다드 구독");
  assert.equal(lines[2], "승인 후 구독은 '환불됨' 상태가 됩니다.", "sync_subscription_refunded_from_refund 트리거(subscription_prorated)");
  const details = buildRefundApproveDetails(approveSummaryInputFor(TARGET));
  assert.deepEqual(details[0], { label: "실지급 금액(저장값)", value: "84,900원" });
  assert.equal(details[1].value, "김서연");

  // 금액 미설정 — RPC 도 자동 승인을 거절하므로 모달이 그 사실을 드러낸다
  const unset = buildRefundApproveSummary({ ...approveSummaryInputFor(TARGET), amountWon: null });
  assert.ok(unset.includes("환불 금액이 설정되지 않았습니다"), unset);
  assert.equal(buildRefundApproveDetails({ ...approveSummaryInputFor(TARGET), amountWon: null })[0].value, "금액 미설정");

  // 종류별 승인 후 문장 — 멘토 중단은 캐시만, 맞춤의뢰는 예치금
  assert.ok(refundStatusAfterApprovalSentence("subscription_mentor_suspended", true).includes("캐시만 환불"));
  assert.ok(refundStatusAfterApprovalSentence("custom_order", false).includes("예치금"));
  assert.ok(refundStatusAfterApprovalSentence("subscription_student", false).includes("결제 기준"), "구독 행 없으면 트리거가 안 돈다");
  assert.equal(buildRefundDetailTitle("김서연", 84_900), "김서연 · 84,900원 환불 요청");
  assert.equal(buildRefundDetailTitle("", null), "이름 없음 · 환불 요청(금액 미설정)");
});

// ── §8 승인이 critical 모달을 거치고 사유 없이 제출 불가 ─────────────────────

test("승인은 critical(사유 필수 기본) — 정책상 사유 없이 확인 불가, 서버 액션도 사유 없는 제출을 막는다", () => {
  const req = resolveAdminConfirmRequirements({ level: "critical" });
  assert.equal(req.reasonRequired, true);
  assert.equal(evaluateAdminConfirm(req, { reason: "", typedConfirmText: "" }).ok, false);
  assert.equal(evaluateAdminConfirm(req, { reason: "기준 확인", typedConfirmText: "" }).ok, true);
  assert.equal(isRefundReasonValid(""), false);
  assert.equal(isRefundReasonValid(" a "), false, "다이얼로그와 같은 최소 길이");
  assert.equal(isRefundReasonValid("기준 확인"), true);

  const d = stripComments(read(DECISION));
  const approveForm = d.slice(d.indexOf("action={approveAdminRefundAction}"), d.indexOf("action={rejectAdminRefundAction}"));
  assert.ok(approveForm.includes('level="critical"'), "승인 버튼은 critical");
  assert.ok(approveForm.includes("summary={approveSummary}") && approveForm.includes("details={approveDetails}"), "summary + 금액 재표시");
  assert.ok(approveForm.includes(`reasonFieldName={REFUND_REASON_FIELD}`), "사유는 기존 액션 필드명으로");
  assert.ok(!/reasonRequired=\{false\}/.test(approveForm), "승인 사유 필수 해제 금지");
  assert.equal(REFUND_REASON_FIELD, "adminNote", "기존 액션이 읽는 필드명 → RPC p_admin_note");

  const a = stripComments(read(ACTIONS));
  const single = a.slice(a.indexOf("async function runSingleDecision"), a.indexOf("export async function approveAdminRefundAction"));
  assert.ok(single.includes("if (!isRefundReasonValid(adminNote))"), "서버 사유 검사");
  assert.ok(single.indexOf("isRefundReasonValid(adminNote)") < single.indexOf("callRefundRpc("), "사유 검사는 RPC 호출보다 앞");
  assert.ok(single.includes("resolveRefundReturnPath("), "돌아갈 경로 검증");
  assert.ok(a.includes('"approve_refund_request_admin"') && a.includes('"reject_refund_request_admin"'), "기존 RPC 두 개 그대로");
  assert.ok(!/from\("refunds"\)\s*\.\s*(update|insert|delete)/.test(a), "액션은 refunds 를 직접 쓰지 않는다 — RPC 경유만");
});

test("돌아갈 경로는 목록 또는 상세만 허용(open redirect 방지)", () => {
  assert.equal(resolveRefundReturnPath(null), REFUND_BASE_PATH);
  assert.equal(resolveRefundReturnPath("/admin/refunds"), REFUND_BASE_PATH);
  assert.equal(resolveRefundReturnPath(`/admin/refunds/${TARGET.id}`), `/admin/refunds/${TARGET.id}`);
  assert.equal(resolveRefundReturnPath("/admin/refunds/not-a-uuid"), REFUND_BASE_PATH);
  assert.equal(resolveRefundReturnPath("https://evil.example/admin/refunds"), REFUND_BASE_PATH);
  assert.equal(resolveRefundReturnPath("/admin/disputes"), REFUND_BASE_PATH);
  assert.equal(resolveRefundReturnPath("//evil.example"), REFUND_BASE_PATH);
  assert.equal(REFUND_RETURN_TO_FIELD, "returnTo");
});

// ── §8 반려 프리셋 선택 시 텍스트 없이 제출 가능 ───────────────────────────

test("반려는 stateChange + 사유 프리셋(칩 클릭 = 확인) — 프리셋 값은 서버 사유 검사를 통과한다", () => {
  assert.deepEqual([...REFUND_REJECT_REASON_PRESETS], ["기준 미충족 (이용 기간 1/2 경과)", "중복 요청", "사유 불충분"]);
  assert.equal(REFUND_CUSTOM_REASON_LABEL, "직접 입력");
  for (const p of REFUND_REJECT_REASON_PRESETS) assert.equal(isRefundReasonValid(p), true, p);
  const d = stripComments(read(DECISION));
  const rejectForm = d.slice(d.indexOf("action={rejectAdminRefundAction}"));
  assert.ok(rejectForm.includes('level="stateChange"'), "반려는 stateChange");
  assert.ok(rejectForm.includes("reasonRequired") && rejectForm.includes("reasonPresets={REFUND_REJECT_REASON_PRESETS}"), "프리셋 배선");
  const dialog = stripComments(read(DIALOG));
  assert.ok(dialog.includes("onClick={() => onConfirm(preset)}"), "칩 클릭 = 즉시 확인(텍스트 입력 없음)");
  assert.equal(buildRefundRejectSummary("김서연", 84_900), "김서연 학생의 84,900원 환불 요청을 반려합니다. 캐시는 이동하지 않습니다.");
  assert.ok(buildRefundRejectSummary("김서연", null).includes("캐시는 이동하지 않습니다"));
});

// ── §8 일괄 승인: 모달 항목 해제 시 건수·총액 갱신 · 부분 실패 시 성공 건 유지 + 실패 건 표시 ──

const CANDIDATES = [
  { id: "a", amountWon: 84_900 },
  { id: "b", amountWon: 87_450 },
  { id: "c", amountWon: 29_900 },
];

test("일괄 모달 선택 모델: 항목을 해제하면 건수·총액이 갱신되고 summary·확인 문구가 따라간다", () => {
  const all = bulkSelectionSummary(CANDIDATES, ["a", "b", "c"]);
  assert.equal(all.count, 3);
  assert.equal(all.totalWon, 202_250);
  assert.equal(buildRefundBulkSummary("approve", all.count, all.totalWon).split("\n")[0], "선택한 3건을 승인합니다 · 총 202,250원");
  const one = bulkSelectionSummary(CANDIDATES, ["a", "c"]);
  assert.equal(one.count, 2);
  assert.equal(one.totalWon, 114_800);
  assert.deepEqual(one.selected.map((c) => c.id), ["a", "c"], "hidden ids 는 선택된 것만");
  assert.equal(refundBulkConfirmLabel("approve", 2), "2건 승인");
  assert.equal(refundBulkConfirmLabel("reject", 1), "1건 반려");
  const none = bulkSelectionSummary(CANDIDATES, []);
  assert.equal(none.count, 0);
  assert.ok(buildRefundBulkSummary("approve", 0, 0).includes("선택된 건이 없습니다"));
  assert.ok(buildRefundBulkSummary("reject", 2, 100).includes("캐시는 이동하지 않으며"), "반려 summary 는 자금 이동 없음을 말한다");
  assert.equal(bulkSelectionSummary(CANDIDATES, ["zzz"]).count, 0, "후보에 없는 id 는 세지 않는다");
});

test("일괄 처리 부분 실패: 성공 건은 그대로 성공으로 남고 실패 건만 재시도 대상 — 2건 성공 · 1건 실패(이유)", () => {
  const results: RefundBulkItemResult[] = [
    { refundId: "a", ok: true, noop: false, message: null },
    { refundId: "b", ok: false, noop: false, message: "이미 멘토 정산 지급이 완료된 구독 건은 자동 환불할 수 없습니다. 수동 조정이 필요합니다." },
    { refundId: "c", ok: true, noop: true, message: "이미 처리되었거나 대기 상태가 아닙니다." },
  ];
  const state = summarizeRefundBulkResults("approve", results, "2026-09-02T00:00:00Z");
  assert.equal(state.requested, 3);
  assert.equal(state.succeeded, 2, "noop(이미 처리됨)은 실패가 아니다");
  assert.equal(state.failed, 1);
  assert.deepEqual(failedRefundIds(state), ["b"], "실패 건만 다시 선택");
  assert.equal(formatRefundBulkResultLine(state), "일괄 승인: 2건 성공 · 1건 실패");
  assert.equal(state.results.find((r) => r.refundId === "a")?.ok, true, "성공 건을 되돌리거나 지우지 않는다");
  assert.equal(formatRefundBulkResultLine(summarizeRefundBulkResults("reject", results.slice(0, 1))), "일괄 반려: 1건 성공");
  const err = refundBulkErrorState("approve", "선택된 항목이 없습니다.");
  assert.equal(err.requested, 0);
  assert.deepEqual(failedRefundIds(err), []);
  assert.equal(formatRefundBulkResultLine(err), "일괄 승인 실패 — 선택된 항목이 없습니다.");
  assert.equal(failedRefundIds(null).length, 0);
});

test("일괄 액션은 별도 RPC 없이 단건 RPC 를 건별 순차 호출 · 롤백 없음 · redirect 없이 건별 결과 반환 · 사유 필수 · 상한", () => {
  const a = stripComments(read(ACTIONS));
  const bulk = a.slice(a.indexOf("export async function bulkRefundDecisionAction"));
  assert.ok(bulk.includes("for (const refundId of ids) {"), "건별 반복(§0: 일괄 RPC 없음)");
  assert.ok(bulk.includes("await callRefundRpc(admin, decision, refundId, user.id, adminNote)"), "검증된 단건 RPC 재사용");
  assert.ok(!/redirect\(/.test(bulk), "useActionState — redirect 없이 상태 반환");
  assert.ok(!/rollback|되돌리|reject_refund_request_admin/.test(bulk.replace(/RPC_BY_DECISION/g, "")), "성공 건 롤백 시도 없음");
  assert.ok(bulk.includes("if (!isRefundReasonValid(adminNote))"), "일괄 사유 필수");
  assert.ok(bulk.includes("summarizeRefundBulkResults(decision, results)"), "건별 결과 요약");
  assert.ok(a.includes(".slice(0, REFUND_BULK_MAX_IDS)"), "선택 상한");
  assert.equal(REFUND_BULK_MAX_IDS, REFUND_DEFAULT_PAGE_SIZE);
  assert.equal(REFUND_BULK_DECISION_FIELD, "bulkDecision");
  assert.equal(REFUND_BULK_IDS_FIELD, "ids");
  // 구 일괄 액션(redirect 로 결과를 URL 에 뭉쳐 담던 경로)은 제거됐다 — 두 경로가 공존하지 않는다.
  assert.ok(!read(BULK_ACTIONS).includes("export async function bulkProcessRefundsAction"), "구 bulkProcessRefundsAction 제거");
  assert.ok(!read(LIST_PAGE).includes("bulkProcessRefundsAction"));
});

test("일괄 다이얼로그: ConfirmSubmitButton(critical/stateChange) + body 슬롯의 체크 목록 · 0건이면 확인 잠금 · hidden ids 는 선택만", () => {
  const t = stripComments(read(TABLE));
  assert.ok(t.startsWith('"use client"'), "행 선택 상태 때문에 클라이언트");
  assert.ok(t.includes("useActionState<RefundBulkResultState, FormData>(bulkRefundDecisionAction, null)"), "일괄 결과는 useActionState");
  const bulkStart = t.indexOf('decision === "approve" ? (');
  assert.ok(bulkStart > 0, "일괄 폼 분기");
  const bulkSplit = t.indexOf(") : (", bulkStart);
  const approveForm = t.slice(bulkStart, bulkSplit);
  assert.ok(approveForm.includes('level="critical"') && approveForm.includes("body={body}") && approveForm.includes("confirmBlockedMessage={blocked}"));
  assert.ok(approveForm.includes('value="approve"') && approveForm.includes("name={REFUND_BULK_DECISION_FIELD}"), "submitter name/value 로 결정 전달");
  const rejectForm = t.slice(bulkSplit, t.indexOf("function RefundBulkChecklist"));
  assert.ok(rejectForm.includes('level="stateChange"') && rejectForm.includes("reasonPresets={REFUND_REJECT_REASON_PRESETS}") && rejectForm.includes("body={body}"));
  assert.ok(t.includes("{selected.map((c) => (") && t.includes("name={REFUND_BULK_IDS_FIELD} value={c.id}"), "hidden ids = 모달 선택");
  assert.ok(t.includes('<input\n                type="checkbox"') || t.includes('type="checkbox"'), "체크 목록");
  assert.ok(!/<form\b/.test(stripComments(read(DIALOG))), "다이얼로그 안에 form 없음(body 슬롯은 체크박스만)");
  assert.ok(t.includes("const failed = failedRefundIds(bulkState);") && t.includes("setSelected(failed);"), "결과 수신 후 실패 건만 선택 유지");
  assert.ok(!/useEffect/.test(t), "상태 조정은 렌더 중(PR-2 관례) — effect 없음");
  const dialog = read(DIALOG);
  assert.ok(dialog.includes("body?: ReactNode;") && dialog.includes("confirmBlockedMessage?: string | null;"), "다이얼로그 확장 props");
  assert.ok(stripComments(dialog).includes("const canConfirm = evaluation.ok && !pending && !blocked;"), "잠금이 확인 판정에 반영");
  assert.ok(stripComments(dialog).includes("whitespace-pre-line"), "summary 줄바꿈(3문장) 표시");
});

// ── §8 빈 상태 렌더 ───────────────────────────────────────────────────────────

test("빈 상태: 지시서 §6 문구 + 처리 순서 3단계, 환불이 0건일 때 first 변형", () => {
  assert.equal(REFUND_EMPTY_STATE.title, "아직 환불 요청이 없습니다");
  assert.equal(REFUND_EMPTY_STATE.description, "학생 모집이 시작되면 구독 환불 요청이 이 화면으로 들어옵니다.");
  assert.equal(REFUND_EMPTY_STATE.steps.length, 3);
  assert.ok(REFUND_EMPTY_STATE.steps[1].includes("'환불됨'") && REFUND_EMPTY_STATE.steps[2].includes("PG사"));
  const e = stripComments(read(EMPTY));
  assert.ok(e.includes("REFUND_EMPTY_STATE.title") && e.includes("REFUND_EMPTY_STATE.steps.map("), "카피는 상수에서");
  assert.ok(e.includes('variant === "search"') && e.includes('variant === "tab"'), "검색·탭 변형");
  const page = stripComments(read(LIST_PAGE));
  assert.ok(page.includes('counts.all === 0 ? "first" : "tab"'), "환불 0건 → first 변형");
  assert.ok(page.includes("<RefundEmptyState"), "빈 상태 렌더");
});

// ── §8 상세: 환불 기준 계산이 학생 화면 함수와 같은 결과(같은 함수를 호출) ─────

test("환불 기준은 학생 화면 함수 computeProratedRefundEstimate 를 그대로 호출한 결과다 — 관리자용 재구현 없음", () => {
  const q = stripComments(read(QUERIES));
  assert.ok(q.includes('import { computeProratedRefundEstimate } from "@/lib/subscribe/subscriptionRefundProration";'), "학생 함수 import");
  assert.ok(q.includes("const estimate = computeProratedRefundEstimate({"), "학생 함수 호출");
  assert.ok(q.includes("now: Number.isNaN(requestedAt.getTime()) ? new Date() : requestedAt,"), "요청 시점(created_at) 기준");
  assert.ok(q.includes("hasSubscriptionUsageStartedForPair(usageDb, { studentId, mentorId, periodStartIso: periodStart })"), "이용 개시 판정도 학생 액션과 같은 함수");
  // 학원법 분기 산식(결제액 × 2/3 · ÷ 2 · 경과율 < 1/3 · 경과/총 ms) 을 관리자 쪽에서 다시 쓰지 않는다 — 표시 라벨의 "2/3" 문자열은 산식이 아니다.
  for (const rel of [CONSOLE, QUERIES, DETAIL_PAGE]) {
    const src = stripComments(read(rel));
    assert.ok(
      !/Math\.floor\([^;]*\/\s*[23]\)|elapsedRatio\s*<\s*1\s*\/|elapsedMs\s*\/\s*totalMs|usageStarted === false/.test(src),
      `${rel}: 학원법 분기 산식 재구현 금지`
    );
  }
  assert.ok(!stripComments(read(CONSOLE)).includes("computeProratedRefundEstimate("), "순수 모듈은 계산을 호출하지 않는다(결과만 옮긴다)");
  // 같은 입력 → 같은 결과. 표시 모델은 estimate 수치를 옮기기만 한다.
  const periodStart = "2026-08-13T00:00:00+09:00";
  const periodEnd = "2026-09-13T00:00:00+09:00";
  const requestedAt = new Date("2026-08-18T00:00:00+09:00");
  const estimate = computeProratedRefundEstimate({ amountCents: STORED_AMOUNT_CENTS, periodStartIso: periodStart, periodEndIso: periodEnd, now: requestedAt, usageStarted: true, mode: "student_voluntary" });
  assert.equal(estimate.bracketReason, "lt_1_3");
  const basis = describeRefundBasis(estimate, { periodStart, periodEnd, usageStarted: true, paidAmountCents: STORED_AMOUNT_CENTS });
  assert.equal(basis.estimatedCents, estimate.amountCents);
  assert.equal(basis.estimatedWon, refundAmountWon(estimate.amountCents));
  assert.equal(basis.bracketLabel, refundBracketLabelKo("lt_1_3"));
  assert.equal(basis.totalDays, estimate.totalDays);
  assert.equal(basis.elapsedDays, estimate.totalDays - estimate.remainingDays);
  assert.equal(formatRefundElapsed(basis), `${basis.elapsedDays}일 / ${basis.totalDays}일 (${Math.round(basis.elapsedRatio * 100)}%)`);
  assert.equal(refundBasisShortLabel(basis), "1/3 경과 전 · 2/3");
  // 멘토 중단 모드는 usageStarted 를 판정하지 않는다
  const mentor = describeRefundBasis(
    computeProratedRefundEstimate({ amountCents: STORED_AMOUNT_CENTS, periodStartIso: periodStart, periodEndIso: periodEnd, now: requestedAt, mode: "mentor_suspended" }),
    { periodStart, periodEnd, usageStarted: true, paidAmountCents: STORED_AMOUNT_CENTS }
  );
  assert.equal(mentor.usageStarted, null);
  assert.equal(refundBasisShortLabel(mentor), "멘토 중단 · 잔여 일할");
  assert.equal(refundModeForKind("subscription_student"), "student_voluntary");
  assert.equal(refundModeForKind("subscription_mentor_suspended"), "mentor_suspended");
  assert.equal(refundModeForKind("custom_order"), null, "구독 환불이 아니면 기준 계산 없음");
});

test("기준상 환불액 0원 경고 · 저장값과 재계산 불일치 경고 — 실지급은 저장값", () => {
  const periodStart = "2026-08-13T00:00:00+09:00";
  const periodEnd = "2026-09-13T00:00:00+09:00";
  const late = describeRefundBasis(
    computeProratedRefundEstimate({ amountCents: STORED_AMOUNT_CENTS, periodStartIso: periodStart, periodEndIso: periodEnd, now: new Date("2026-09-02T00:00:00+09:00"), usageStarted: true, mode: "student_voluntary" }),
    { periodStart, periodEnd, usageStarted: true, paidAmountCents: STORED_AMOUNT_CENTS }
  );
  assert.equal(late.bracketReason, "ge_1_2");
  assert.equal(isZeroBasisRefund(late), true);
  assert.equal(refundBasisShortLabel(late), "1/2 경과 후 · 환불 없음");
  assert.equal(refundBasisMismatch(late, STORED_AMOUNT_CENTS), true, "저장 84,900 vs 기준 0");
  assert.equal(refundBasisMismatch(late, 0), false);
  assert.equal(isZeroBasisRefund(null), false);
  const invalid = describeRefundBasis(
    computeProratedRefundEstimate({ amountCents: null, periodStartIso: null, periodEndIso: null, mode: "student_voluntary" }),
    { periodStart: null, periodEnd: null, usageStarted: null, paidAmountCents: null }
  );
  assert.equal(invalid.bracketReason, "invalid");
  assert.equal(isZeroBasisRefund(invalid), false, "계산 불가는 0원 경고가 아니다");
  assert.equal(refundBasisMismatch(invalid, STORED_AMOUNT_CENTS), false);
  assert.equal(formatRefundElapsed(invalid), "기간 정보 없음");
  const summary = buildRefundApproveSummary({ ...approveSummaryInputFor(TARGET), basis: late });
  assert.ok(summary.endsWith(`⚠ ${REFUND_ZERO_BASIS_WARNING}`), "승인 모달에도 0원 경고");
  assert.ok(summary.split("\n")[1].includes(refundBracketLabelKo("ge_1_2")), "기준 문구는 학생 화면과 같다");
  const detail = stripComments(read(DETAIL_PAGE));
  assert.ok(detail.includes("detail.pending && detail.zeroBasis") && detail.includes("REFUND_ZERO_BASIS_WARNING"), "상세 0원 경고");
  assert.ok(detail.includes("detail.basisMismatch") && detail.includes("REFUND_BASIS_MISMATCH_WARNING"), "상세 불일치 경고");
  assert.ok(detail.includes("결제 이력") && detail.includes("구독 상태") && detail.includes("분쟁 여부") && detail.includes("이전 환불"), "한 화면 4구역");
  assert.ok(detail.includes("<RefundDecisionButtons target={decisionTarget(detail)}"), "우상단 승인·반려는 목록과 같은 부품");
});

// ── §8 처리자·처리일시 컬럼 렌더 · PG 경고 상시 노출 · PageScaffold 미사용 ───

test("목록 컬럼: 요청자·종류·금액·사유(요약)·요청일·상태·처리자·일시 — 처리자·처리일시가 보인다", () => {
  const t = stripComments(read(TABLE));
  for (const col of ["요청자", "종류", "금액", "사유(요약)", "요청일", "상태", "처리자·일시"]) assert.ok(t.includes(`>${col}</th>`), `컬럼 ${col}`);
  assert.ok(t.includes("data-refund-processed") && t.includes("item.processorName") && t.includes("{item.processedAtLabel}"), "처리자·처리일시 셀");
  assert.ok(!t.includes("formatKoDateTimeKst"), "날짜 문자열은 서버가 만든다(클라이언트 재포맷 없음 — hydration)");
  assert.ok(t.includes('<AdminStatusPill table="refunds" column="status" value={item.status}'), "상태는 AdminStatusPill");
  assert.ok(!/bg-amber-50 text-amber-700 border-amber-100|refundStatusLabel/.test(t), "자체 상태 배지 없음");
  const q = stripComments(read(QUERIES));
  assert.ok(q.includes("processedById ? displayNameOf(users.get(processedById)) : null"), "처리자 이름은 users 조회");
  assert.ok(q.includes("createdAtLabel: formatKoDateTimeKst(createdAt),") && q.includes("processedAtLabel: formatKoDateTimeKst(strOrNull(row.processed_at)),"), "서버 날짜 라벨");
  assert.equal(summarizeRefundReason("  다른   멘토로 바꾸려고요 ", 40), "다른 멘토로 바꾸려고요");
  assert.equal(summarizeRefundReason("가".repeat(50), 40), `${"가".repeat(40)}…`);
  assert.equal(summarizeRefundReason(null), "—");
  assert.deepEqual(refundQueueProgressRange(2, 25, 10, 35), { first: 26, last: 35 });
  assert.deepEqual(refundQueueProgressRange(1, 25, 0, 0), { first: 0, last: 0 });
  assert.ok(!stripComments(read(PAGINATION)).startsWith('"use client"'));
});

test("PG 수동 취소 경고가 목록·상세 상단에 상시 노출되고 닫을 수 없다", () => {
  assert.ok(REFUND_PG_MANUAL_WARNING.includes("PG사에서 수동으로"));
  const w = stripComments(read(PG_WARNING));
  assert.ok(w.includes("REFUND_PG_MANUAL_WARNING") && w.includes('role="note"'), "상수 문구 · note");
  assert.ok(!/<button|useState|onClick|dismiss|닫기/.test(w), "닫기 버튼·상태 없음");
  assert.ok(!w.startsWith('"use client"'));
  for (const rel of [LIST_PAGE, DETAIL_PAGE]) {
    const src = stripComments(read(rel));
    const idx = src.indexOf("<RefundPgManualWarning />");
    assert.ok(idx > 0, `${rel}: 경고 렌더`);
    assert.ok(idx < src.indexOf("flashOk ?"), `${rel}: 경고는 플래시보다 위(상단)`);
  }
});

test("PageScaffold 미사용 · AdminPageLayout 사용 · 구 딥링크 ?refundId= 는 상세로 · DB/RPC 파일 무변경 범위", () => {
  for (const rel of [LIST_PAGE, DETAIL_PAGE]) {
    const src = read(rel);
    assert.ok(!src.includes("PageScaffold"), `${rel}: PageScaffold 금지`);
    assert.ok(src.includes("<AdminPageLayout"), `${rel}: AdminPageLayout`);
  }
  const page = stripComments(read(LIST_PAGE));
  assert.ok(page.includes("if (focusRefundId) redirect(refundDetailPath(focusRefundId));"), "분쟁 상세·활동 로그의 ?refundId= 딥링크 보존");
  assert.ok(page.includes("loadRefundQueue(supabase") && page.includes("countRefundTabs(supabase)"), "서버 조회");
  const detail = stripComments(read(DETAIL_PAGE));
  assert.ok(detail.includes('await requireRole("admin");'), "상세 페이지 가드(레이아웃 가드와 중복)");
});

// ── 종류(§0 4번) ─────────────────────────────────────────────────────────────

test("환불 종류 판정 — request_type 우선, 없으면 맞춤의뢰 주문/구독 연결로 판정", () => {
  assert.equal(resolveRefundKind({ request_type: "subscription_prorated" }), "subscription_student");
  assert.equal(resolveRefundKind({ request_type: "subscription_mentor_suspended" }), "subscription_mentor_suspended");
  assert.equal(resolveRefundKind({ request_type: null, custom_request_order_id: "x" }), "custom_order");
  assert.equal(resolveRefundKind({ request_type: "iq" }), "individual_question");
  assert.equal(resolveRefundKind({ request_type: "order" }), "custom_order");
  assert.equal(resolveRefundKind({ request_type: null, subscription_id: "s" }), "subscription_student");
  assert.equal(resolveRefundKind({}), "other");
  assert.equal(REFUND_KIND_LABELS.subscription_mentor_suspended, "구독 환불(멘토 중단)");
});
