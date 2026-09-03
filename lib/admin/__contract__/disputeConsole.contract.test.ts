// 계약 테스트: 분쟁 화면(PR-6 §2) — 목록 이관 · 상태별 가능 조치 · 자금 조치 3종 critical · 예치금 분할 합계 검증 · 일괄 상태 변경 critical.
// 실행: node --test --experimental-strip-types lib/admin/__contract__/disputeConsole.contract.test.ts
//
// .tsx 는 node --test 로 import 할 수 없으므로(strip-types 는 JSX 미지원):
//   ① 순수 규칙(탭 = 사전 9종 · 제재 3종 한 탭 · status=all 유지 · 검색 or() · 유형 · 경과 24h/48h · 전이 표 · 분할 산식 · summary · 빈 상태)은 직접 검증한다
//   ② **전이 표는 서버 액션 소스와 대조한다** — 화면이 규칙을 새로 정의하지 않았음을 고정(지시서 §5-3)
//   ③ 렌더·배선 규칙은 소스 스캔 tripwire 로 고정한다(PageScaffold/구 워크스페이스 미사용 · Counts 미사용(prop 추가 0) · 일괄 = critical + 대상 목록 ·
//      자금 일괄 없음 · 자금 3종 같은 액션 · 분할 금액 직접 입력(슬라이더 없음) · 제재 라디오 · 새 "use server" 파일 없음 · 액션이 사유를 읽지 않는 사실)

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildAdminListUrl, parseAdminListParams } from "../adminListParams.ts";
import { buildAdminDataTableUrl } from "../adminDataTable.ts";
import { resolveAdminConfirmRequirements } from "../adminConfirmPolicy.ts";
import { adminStatusAllowedValues, resolveAdminStatus } from "../adminStatusDictionary.ts";
import { ACCOUNT_SUSPENDED_BLOCKED_SENTENCE, ACCOUNT_SUSPENDED_NOT_BLOCKED_SENTENCE } from "../accountSanctionPolicy.ts";
import {
  DISPUTE_ACTIONS,
  DISPUTE_BASE_PATH,
  DISPUTE_BULK_FROM,
  DISPUTE_BULK_STATUSES,
  DISPUTE_CLOSE_FROM,
  DISPUTE_CUSTOM_REASON_LABEL,
  DISPUTE_DEFAULT_PAGE_SIZE,
  DISPUTE_DISMISS_REASON_PRESETS,
  DISPUTE_DEFAULT_TAB,
  DISPUTE_ELAPSED_DANGER_HOURS,
  DISPUTE_ELAPSED_WARNING_HOURS,
  DISPUTE_EMPTY_STATE,
  DISPUTE_FUNDS_FROM,
  DISPUTE_FUND_ACTION_KEYS,
  DISPUTE_FUNDS_REASON_REQUIRED_MESSAGE,
  DISPUTE_NO_REASON_STORED_NOTE,
  DISPUTE_NOTE_STORED_NOTE,
  DISPUTE_REASON_FIELD,
  DISPUTE_REASON_LOGGED_NOTE,
  DISPUTE_RESOLVE_REASON_PRESETS,
  DISPUTE_REVIEW_FROM,
  DISPUTE_SANCTION_CODES,
  DISPUTE_SANCTION_FROM,
  DISPUTE_SANCTION_STATUSES,
  DISPUTE_STATUS_VALUES,
  DISPUTE_TABS,
  DISPUTE_TAB_VALUES,
  DISPUTE_TERMINAL_STATUSES,
  buildDisputeBulkSummary,
  buildDisputeDetailTitle,
  buildDisputeListUrl,
  buildDisputePayoutMentorSummary,
  buildDisputeRefundStudentSummary,
  buildDisputeSanctionSummary,
  buildDisputeSearchOr,
  buildDisputeSplitDetails,
  buildDisputeSplitPreview,
  buildDisputeSplitSummary,
  buildDisputeStatusSummary,
  disputeActionLogLabel,
  disputeAllowedActions,
  disputeBulkConfirmLabel,
  disputeDetailFlashOkMessage,
  disputeDetailPath,
  disputeElapsed,
  disputeElapsedToneClass,
  disputeEmptyVariant,
  disputeIsBulkEligible,
  disputeLedgerReasonLabel,
  disputeListFlashOkMessage,
  disputeMentorNetFromGrossWon,
  disputeOrderEventLabel,
  disputeResolveRoute,
  isDisputeReasonValid,
  disputeSanctionStatus,
  disputeShortRef,
  disputeSplitBlockedMessage,
  disputeTabStatuses,
  formatDisputeLedgerDelta,
  resolveDisputeKind,
  resolveDisputeTab,
  type DisputeActionKey,
} from "../disputeConsole.ts";

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const LIST_PAGE = "app/(admin)/admin/(console)/disputes/page.tsx";
const DETAIL_PAGE = "app/(admin)/admin/(console)/disputes/[id]/page.tsx";
const LIST = "components/admin/DisputeQueueList.tsx";
const TABLE = "components/admin/DisputeQueueTable.tsx";
const NEXT_ACTIONS = "components/admin/DisputeNextActions.tsx";
const FUNDS = "components/disputes/DisputeEscrowSplitPanel.tsx";
const CONSOLE = "lib/admin/disputeConsole.ts";
const QUERIES = "lib/admin/disputeConsoleQueries.ts";
const DISPUTE_ACTIONS_SRC = "lib/admin/adminDisputeActions.ts";
const SANCTION_ACTIONS_SRC = "lib/admin/adminDisputeSanctionActions.ts";
const BULK_SRC = "lib/admin/bulkActions.ts";
const SPLIT_RPC_SQL = "supabase/sql/125_dispute_split_fee_5pct.sql";

function spFrom(url: string): Record<string, string | string[] | undefined> {
  const u = new URL(url, "https://ssambership.local");
  const sp: Record<string, string | string[] | undefined> = {};
  for (const [k, v] of u.searchParams.entries()) sp[k] = v;
  return sp;
}

/** `runDisputeUpdate(disputeId, patch, [ … ])` 의 statusIn 배열들을 소스에서 순서대로 뽑는다 */
function statusInArrays(src: string): string[][] {
  const out: string[][] = [];
  const re = /runDisputeUpdate\(disputeId, patch, \[([\s\S]*?)\]\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) out.push([...m[1].matchAll(/"([a-z_0-9]+)"/g)].map((x) => x[1]));
  return out;
}

const OPTS = { defaultPageSize: DISPUTE_DEFAULT_PAGE_SIZE, defaultStatus: DISPUTE_DEFAULT_TAB };
const UUID = "11111111-1111-4111-8111-111111111111";
const UUID2 = "22222222-2222-4222-8222-222222222222";
const HOUR = 3_600_000;

// ── 상태 · 탭 ────────────────────────────────────────────────────────────────

test("상태 9종 = 상태 사전 disputes.status(CHECK 120) · 제재 3종 · 종말 3종 · 탭 8개(제재 한 탭 + 전체) · 기본 탭 open · 탭 라벨은 사전 파생", () => {
  assert.deepEqual([...DISPUTE_STATUS_VALUES].sort(), adminStatusAllowedValues("disputes", "status").sort(), "사전과 같은 집합");
  assert.deepEqual([...DISPUTE_SANCTION_STATUSES], ["sanction_7d", "sanction_30d", "sanction_permanent"]);
  assert.deepEqual([...DISPUTE_TERMINAL_STATUSES], ["resolved", "dismissed", "sanction_permanent"]);
  assert.deepEqual([...DISPUTE_TAB_VALUES], ["open", "under_review", "on_hold", "escalated", "resolved", "dismissed", "sanction", "all"]);
  assert.equal(DISPUTE_DEFAULT_TAB, "open");
  for (const t of DISPUTE_TABS) {
    if (t.value === "all") assert.equal(t.label, "전체");
    else if (t.value === "sanction") assert.equal(t.label, "제재");
    else assert.equal(t.label, resolveAdminStatus("disputes", "status", t.value).label, `${t.value}: 탭 라벨 = 사전 라벨`);
  }
  assert.ok(stripComments(read(CONSOLE)).includes('resolveAdminStatus("disputes", "status", value).label'), "탭 라벨은 사전에서 파생(하드코딩 없음)");
  // PR-6 2번째 커밋(오너 확정) — 사전 라벨 = 분쟁 화면 표기
  assert.deepEqual(DISPUTE_TABS.map((t) => t.label), ["열림", "검토 중", "보류", "상위 이관", "해결", "기각", "제재", "전체"]);
  assert.deepEqual([...DISPUTE_SANCTION_STATUSES].map((s) => resolveAdminStatus("disputes", "status", s).label), ["제재 7일", "제재 30일", "영구 제재"]);
  assert.equal(resolveDisputeTab("sanction"), "sanction");
  assert.equal(resolveDisputeTab("sanction_7d"), "open", "개별 제재 상태값은 탭이 아니다 → 기본 탭");
  assert.equal(resolveDisputeTab(""), "open");
  assert.equal(disputeTabStatuses("all"), null);
  assert.deepEqual(disputeTabStatuses("sanction"), DISPUTE_SANCTION_STATUSES);
  assert.deepEqual(disputeTabStatuses("on_hold"), ["on_hold"]);
});

test("status=all 버그 해소: 전체 탭 링크·페이지 이동·검색 초기화가 status=all 을 유지하고 재파싱하면 전체 탭이다 · 화면 빌더 = 공용 빌더", () => {
  const all = parseAdminListParams(spFrom(`${DISPUTE_BASE_PATH}?status=all&q=%EC%84%9C&page=2`), OPTS);
  assert.ok(!buildAdminListUrl(DISPUTE_BASE_PATH, all, {}).includes("status="), "공용 빌더는 지운다(버그의 원인)");
  for (const url of [buildDisputeListUrl(all, {}), buildDisputeListUrl(all, { page: 3 }), buildDisputeListUrl(all, { search: "" })]) {
    assert.ok(url.includes("status=all"), url);
    assert.equal(resolveDisputeTab(parseAdminListParams(spFrom(url), OPTS).status), "all", url);
  }
  for (const u of ["", "?status=all", "?status=all&page=2", "?status=sanction&q=x", "?status=on_hold"]) {
    const p = parseAdminListParams(spFrom(`${DISPUTE_BASE_PATH}${u}`), OPTS);
    for (const o of [{}, { status: "all" }, { status: "sanction" }, { page: 2 }, { search: "김" }]) {
      assert.equal(buildDisputeListUrl(p, o), buildAdminDataTableUrl(DISPUTE_BASE_PATH, p, o), `${u} ${JSON.stringify(o)}`);
    }
  }
  assert.equal(disputeDetailPath(UUID), `/admin/disputes/${UUID}`);
});

// ── 검색 · 유형 · 참조 · 경과 ────────────────────────────────────────────────

test("검색 or(): 접수 내용·운영 메모 부분일치 + 당사자 id 는 학생·멘토 두 컬럼 in() · uuid 컬럼 ilike 금지(완전한 UUID 만 eq) · id 상한 100", () => {
  assert.equal(buildDisputeSearchOr("납품", []), "body.ilike.%납품%,admin_note.ilike.%납품%");
  const withIds = buildDisputeSearchOr("김", [UUID, "not-a-uuid"]);
  assert.ok(withIds.includes(`student_id.in.(${UUID})`) && withIds.includes(`mentor_id.in.(${UUID})`));
  assert.ok(!/id\.ilike|student_id\.ilike|mentor_id\.ilike|order_id\.ilike/.test(buildDisputeSearchOr("abc123", [])), "uuid 컬럼 ilike 금지");
  const uuid = buildDisputeSearchOr(UUID, []);
  assert.ok(uuid.includes(`id.eq.${UUID}`) && uuid.includes(`custom_request_order_id.eq.${UUID}`));
  const many = Array.from({ length: 150 }, (_, i) => `${String(i).padStart(8, "0")}-1111-4111-8111-111111111111`);
  assert.equal(buildDisputeSearchOr("x", many).match(/-1111-4111-8111-111111111111/g)?.length, 200, "학생·멘토 각 100 = 200");
});

test("유형은 disputes 의 FK 로 판정(맞춤의뢰 → 구독 → 결제 → 기타) · 짧은 참조 · 원장·이벤트·로그 라벨", () => {
  assert.equal(resolveDisputeKind({ custom_request_order_id: UUID }), "custom_order");
  assert.equal(resolveDisputeKind({ subscription_id: UUID }), "subscription");
  assert.equal(resolveDisputeKind({ payment_id: UUID }), "payment");
  assert.equal(resolveDisputeKind({}), "other");
  assert.equal(disputeShortRef(UUID), "#111111");
  assert.equal(disputeShortRef(""), "");
  assert.equal(disputeOrderEventLabel("dispute_opened"), "분쟁 제기");
  assert.equal(disputeOrderEventLabel("weird"), "weird");
  assert.equal(disputeLedgerReasonLabel("custom_order_escrow_hold"), "예치");
  assert.equal(formatDisputeLedgerDelta(-5500000), "-55,000원");
  assert.equal(formatDisputeLedgerDelta(5225000), "+52,250원");
  assert.equal(disputeActionLogLabel("dispute_custom_order_split"), "예치금 분배");
  assert.equal(buildDisputeDetailTitle({ orderRef: "#CR0412", disputeRef: "#D1", studentName: "김OO", mentorName: "수학하는하늘" }), "주문 #CR0412 · 김OO ↔ 수학하는하늘");
  assert.equal(buildDisputeDetailTitle({ orderRef: "", disputeRef: "#D1", studentName: "", mentorName: "" }), "분쟁 #D1 · 이름 없음 ↔ 이름 없음");
});

test("경과: 종결(resolved·dismissed·sanction_permanent)이 아닌 건만 센다 · 24시간 초과 주의 · 48시간 초과 위험", () => {
  assert.equal(DISPUTE_ELAPSED_WARNING_HOURS, 24);
  assert.equal(DISPUTE_ELAPSED_DANGER_HOURS, 48);
  const now = Date.parse("2026-09-02T12:00:00Z");
  const at = (h: number) => new Date(now - h * HOUR).toISOString();
  assert.deepEqual(disputeElapsed(at(5), "open", now), { hours: 5, label: "5시간", tone: "ok" });
  assert.deepEqual(disputeElapsed(at(24), "under_review", now), { hours: 24, label: "1일", tone: "ok" });
  assert.deepEqual(disputeElapsed(at(24.5), "on_hold", now), { hours: 24, label: "1일", tone: "warning" });
  assert.deepEqual(disputeElapsed(at(49), "sanction_7d", now), { hours: 49, label: "2일 1시간", tone: "danger" }, "기간 제재 중도 미종결");
  for (const s of DISPUTE_TERMINAL_STATUSES) assert.deepEqual(disputeElapsed(at(100), s, now), { hours: null, label: "—", tone: "none" }, s);
  assert.ok(disputeElapsedToneClass("danger").includes("red") && disputeElapsedToneClass("warning").includes("amber"));
});

// ── 전이 표 = 서버 액션 게이트(화면이 규칙을 새로 정의하지 않았다) ────────────

test("전이 표는 서버 액션 소스와 같다: review = setDisputeUnderReviewAction · close = resolve/dismiss statusIn · sanction = SANCTIONABLE_STATUSES · bulk = bulk .in · funds = RPC disputes 갱신 조건", () => {
  const actions = stripComments(read(DISPUTE_ACTIONS_SRC));
  const arrays = statusInArrays(actions);
  assert.equal(arrays.length, 3, "runDisputeUpdate statusIn 호출 3곳(검토·해결·기각)");
  assert.deepEqual(arrays[0], [...DISPUTE_REVIEW_FROM], "검토 시작 게이트");
  assert.deepEqual(arrays[1], [...DISPUTE_CLOSE_FROM], "해결 게이트");
  assert.deepEqual(arrays[2], [...DISPUTE_CLOSE_FROM], "기각 게이트");
  const sanction = read(SANCTION_ACTIONS_SRC);
  const m = sanction.match(/const SANCTIONABLE_STATUSES = \[([\s\S]*?)\] as const;/);
  assert.ok(m);
  assert.deepEqual([...m![1].matchAll(/"([a-z_0-9]+)"/g)].map((x) => x[1]), [...DISPUTE_SANCTION_FROM], "제재·보류 게이트");
  assert.ok(sanction.includes('hold: "on_hold",') && sanction.includes('complete: "resolved",'), "보류·완료 코드 매핑");
  for (const code of DISPUTE_SANCTION_CODES) {
    assert.ok(new RegExp(`"?${code}"?: "${disputeSanctionStatus(code)}",`).test(sanction), `${code} → ${disputeSanctionStatus(code)}`);
  }
  assert.ok(read(BULK_SRC).includes(`.in("status", [${DISPUTE_BULK_FROM.map((s) => `"${s}"`).join(", ")}])`), "일괄 게이트");
  const rpc = read(SPLIT_RPC_SQL);
  assert.ok(rpc.includes(`d.status in (${DISPUTE_FUNDS_FROM.map((s) => `'${s}'`).join(", ")})`), "RPC 가 분쟁을 resolved 로 바꾸는 조건");
  const disputesUpdate = rpc.slice(rpc.lastIndexOf("update public.disputes d"));
  const disputesWhere = disputesUpdate.slice(0, disputesUpdate.indexOf(";"));
  assert.ok(disputesWhere.includes("d.status in ('open', 'under_review', 'escalated')") && !disputesWhere.includes("'on_hold'"), "RPC 는 보류 건을 해결로 바꾸지 않는다 → 자금 조치는 보류에서 숨긴다");
});

test("escalated(상위 이관)로 바꾸는 쓰기 경로는 코드에 없다 — 버튼도 없다(보고)", () => {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir, { withFileTypes: true })) {
      if (name.name === "node_modules" || name.name === "__contract__" || name.name.startsWith(".")) continue;
      const full = join(dir, name.name);
      if (name.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(name.name)) files.push(full);
    }
  };
  for (const d of ["lib", "app", "components"]) walk(join(ROOT, d));
  const writers = files.filter((f) => /status:\s*"escalated"|\.update\(\{[^}]*"escalated"/.test(stripComments(readFileSync(f, "utf8"))));
  assert.deepEqual(writers, [], "escalated 를 쓰는 코드 없음");
  assert.ok(!read(SANCTION_ACTIONS_SRC).includes('"escalated",\n  };'), "제재 statusMap 에 escalated 없음");
  assert.ok(!stripComments(read(NEXT_ACTIONS)).includes('"escalated"'), "다음 조치 부품에 escalated 쓰기 없음");
});

test("상태별 가능 조치(표) — on_hold 는 재보류 제외 · 해결은 제재 액션 complete 로 · 기간 제재 중은 재제재·상향 가능 · 종말 3종은 없음", () => {
  const F = [...DISPUTE_FUND_ACTION_KEYS];
  const expect: Record<string, DisputeActionKey[]> = {
    open: ["review", "hold", "dismiss", "resolve", ...F, "sanction"],
    under_review: ["hold", "dismiss", "resolve", ...F, "sanction"],
    escalated: ["review", "hold", "dismiss", "resolve", ...F, "sanction"],
    on_hold: ["resolve", "sanction"],
    sanction_7d: ["hold", "dismiss", "resolve", "sanction"],
    sanction_30d: ["hold", "dismiss", "resolve", "sanction"],
    resolved: [],
    dismissed: [],
    sanction_permanent: [],
  };
  for (const s of DISPUTE_STATUS_VALUES) assert.deepEqual(disputeAllowedActions(s), expect[s], s);
  assert.deepEqual(disputeAllowedActions("UNKNOWN"), []);
  assert.equal(disputeResolveRoute("open"), "resolve_action");
  assert.equal(disputeResolveRoute("on_hold"), "sanction_complete");
  assert.equal(disputeResolveRoute("resolved"), null);
  for (const s of DISPUTE_STATUS_VALUES) assert.equal(disputeIsBulkEligible(s), (DISPUTE_BULK_FROM as readonly string[]).includes(s), s);
});

test("조치 등급: 검토 시작·보류·기각·해결 = stateChange · 환불·분할·지급·제재 = critical — 전부 다이얼로그를 거친다", () => {
  assert.deepEqual(Object.keys(DISPUTE_ACTIONS), ["review", "hold", "dismiss", "resolve", "refund_student", "split", "payout_mentor", "sanction"]);
  for (const [key, a] of Object.entries(DISPUTE_ACTIONS)) {
    const critical = key === "sanction" || (DISPUTE_FUND_ACTION_KEYS as readonly string[]).includes(key);
    assert.equal(a.level, critical ? "critical" : "stateChange", key);
    assert.equal(resolveAdminConfirmRequirements({ level: a.level }).needsDialog, true, key);
    assert.ok(a.label && a.dialogTitle && a.confirmLabel && a.pendingLabel, key);
  }
  assert.equal(DISPUTE_ACTIONS.refund_student.label, "학생 전액 환불");
  assert.equal(DISPUTE_ACTIONS.split.label, "예치금 분할");
  assert.equal(DISPUTE_ACTIONS.payout_mentor.label, "멘토 지급");
});

// ── 자금 조치 — 분할 산식 · 합계 검증 · summary ───────────────────────────────

test("분할 산식 = RPC(fee = floor(gross × 요율)) · 요율 없으면 계산 안 함 · 세 숫자 합계 ≠ 예치금이면 확인 잠김 · 정수·음수 검증", () => {
  assert.deepEqual(disputeMentorNetFromGrossWon(25_000, 0.05), { feeWon: 1_250, netWon: 23_750 });
  assert.deepEqual(disputeMentorNetFromGrossWon(25_001, 0.05), { feeWon: 1_250, netWon: 23_751 }, "floor");
  assert.deepEqual(disputeMentorNetFromGrossWon(25_000, null), { feeWon: null, netWon: null });
  const ok = buildDisputeSplitPreview({ holdWon: 55_000, studentWon: 30_000, mentorGrossWon: 25_000, feeRate: 0.05 });
  assert.equal(ok.sumOk, true);
  assert.equal(ok.studentWon + ok.mentorNetWon! + ok.feeWon!, 55_000, "학생 몫 + 멘토 실수령 + 수수료 = 예치금");
  assert.equal(disputeSplitBlockedMessage(ok), null);
  const mismatch = buildDisputeSplitPreview({ holdWon: 55_000, studentWon: 30_000, mentorGrossWon: 20_000, feeRate: 0.05 });
  assert.equal(mismatch.sumOk, false);
  assert.equal(mismatch.problem, "mismatch");
  assert.ok(disputeSplitBlockedMessage(mismatch)!.includes("50,000원") && disputeSplitBlockedMessage(mismatch)!.includes("55,000원"));
  assert.equal(buildDisputeSplitPreview({ holdWon: 55_000, studentWon: 30_000.5, mentorGrossWon: 24_999.5, feeRate: 0.05 }).problem, "not_integer");
  assert.equal(buildDisputeSplitPreview({ holdWon: 55_000, studentWon: -1, mentorGrossWon: 55_001, feeRate: 0.05 }).problem, "negative");
  assert.equal(buildDisputeSplitPreview({ holdWon: 55_000, studentWon: NaN, mentorGrossWon: 0, feeRate: 0.05 }).problem, "not_integer");
  const unset = buildDisputeSplitPreview({ holdWon: 55_000, studentWon: 30_000, mentorGrossWon: 25_000, feeRate: null });
  assert.equal(unset.sumOk, true, "요율이 없어도 합계 검증은 학생 몫 + gross 로 한다");
  assert.equal(unset.mentorNetWon, null);
  assert.ok(!/0\.05|0\.15/.test(stripComments(read(CONSOLE))), "순수 모듈에 요율 리터럴 없음(정본은 DB 행)");
});

test("자금 summary: 전액 환불 = (멘토 0, 학생 예치금) · 멘토 지급 = (멘토 예치금, 학생 0) · 분할은 세 숫자·합계·실행 후 상태 · 금액 재표시 행 5개", () => {
  const refund = buildDisputeSplitPreview({ holdWon: 55_000, studentWon: 55_000, mentorGrossWon: 0, feeRate: 0.05 });
  const r = buildDisputeRefundStudentSummary(refund, "김OO");
  assert.ok(r.startsWith("김OO 학생에게 예치금 55,000원 전액을 캐시로 환불합니다. 멘토 지급 0원."), r);
  assert.ok(r.includes("'해결'") && r.includes("되돌릴 수 없습니다"));
  const payout = buildDisputeSplitPreview({ holdWon: 55_000, studentWon: 0, mentorGrossWon: 55_000, feeRate: 0.05 });
  const p = buildDisputePayoutMentorSummary(payout, "수학하는하늘");
  assert.ok(p.includes("수학하는하늘 멘토에게 예치금 55,000원(수수료 5% 2,750원 공제 후 실수령 52,250원)을 지급합니다. 학생 환불 0원."), p);
  const split = buildDisputeSplitPreview({ holdWon: 55_000, studentWon: 30_000, mentorGrossWon: 25_000, feeRate: 0.05 });
  const s = buildDisputeSplitSummary(split, { studentName: "김OO", mentorName: "수학하는하늘" });
  assert.ok(s.includes("김OO 학생에게 30,000원을 캐시로 환불합니다.") && s.includes("수학하는하늘 멘토 몫 25,000원(수수료 5% 1,250원 공제 후 실수령 23,750원)."), s);
  assert.ok(s.includes("합계 55,000원 = 예치금 55,000원."));
  const bad = buildDisputeSplitSummary(buildDisputeSplitPreview({ holdWon: 55_000, studentWon: 30_000, mentorGrossWon: 20_000, feeRate: 0.05 }), { studentName: "a", mentorName: "b" });
  assert.ok(bad.includes("≠ 예치금") && bad.includes("잠깁니다"));
  const unset = buildDisputeSplitSummary(buildDisputeSplitPreview({ holdWon: 55_000, studentWon: 30_000, mentorGrossWon: 25_000, feeRate: null }), { studentName: "a", mentorName: "b" });
  assert.ok(unset.includes("요율 미설정"));
  const rows = buildDisputeSplitDetails(split);
  assert.deepEqual(rows.map((x) => x.label), ["예치금(hold)", "학생 몫(환불)", "멘토 몫(gross)", "수수료(5%)", "멘토 실수령"]);
  assert.deepEqual(rows.map((x) => x.value), ["55,000원", "30,000원", "25,000원", "1,250원", "23,750원"]);
});

// ── 제재 · 상태 · 일괄 summary ───────────────────────────────────────────────

test("제재 summary: 계정 정지 실제 영향 문장(공용) + 분쟁 상태 전이 + 멘토면 담당 학생 수 · 대상·기간 미선택은 잠김", () => {
  const s = buildDisputeSanctionSummary({ targetName: "수학하는하늘", target: "mentor", code: "7d", untilLabel: "2026.09.10", mentorRoomCount: 4 });
  assert.ok(s.startsWith("수학하는하늘 멘토 계정을 7일 정지합니다. 2026.09.10까지 정지되며 그 뒤 자동 해제됩니다."), s);
  assert.ok(s.includes(ACCOUNT_SUSPENDED_BLOCKED_SENTENCE) && s.includes(ACCOUNT_SUSPENDED_NOT_BLOCKED_SENTENCE));
  assert.ok(s.includes("담당 학생 4명의 질문방이 영향받습니다"));
  assert.ok(s.includes("분쟁 상태가 '제재 7일'(으)로 바뀝니다"));
  const st = buildDisputeSanctionSummary({ targetName: "김OO", target: "student", code: "permanent", untilLabel: null, mentorRoomCount: 9 });
  assert.ok(st.includes("영구 차단합니다") && !st.includes("담당 학생"), "학생은 담당 학생 문장 없음");
  assert.ok(st.includes("'영구 제재'(으)로 바뀝니다"));
  const noRooms = buildDisputeSanctionSummary({ targetName: "m", target: "mentor", code: "30d", untilLabel: "x", mentorRoomCount: null });
  assert.ok(!noRooms.includes("담당 학생"), "데이터 없으면 생략");
});

test("사유(2번째 커밋): 기각·해결·분배·일괄 액션이 선택적 reason 을 읽어 감사 로그 detail 에 남긴다 · 분배는 서버에서도 필수 · 검토·보류는 사유 없음 · summary 가 그 사실을 적는다", () => {
  const actions = stripComments(read(DISPUTE_ACTIONS_SRC));
  assert.equal((actions.match(/const reason = textFromForm\(formData\.get\("reason"\)\);/g) ?? []).length, 3, "resolve · dismiss · split 이 reason 을 읽는다");
  assert.equal((actions.match(/detail: \{ reason: reason \|\| null \},/g) ?? []).length, 2, "resolve · dismiss 는 detail.reason 에만(선택)");
  assert.ok(actions.includes("if (!isDisputeReasonValid(reason)) redirect(errUrlDetail(disputeId, safeMsg(DISPUTE_FUNDS_REASON_REQUIRED_MESSAGE)));"), "분배(자금)는 서버에서도 사유 필수");
  assert.ok(/detail: \{\s*orderId,\s*reason,/.test(actions), "분배 detail 에 reason");
  const reviewBody = actions.slice(actions.indexOf("export async function setDisputeUnderReviewAction"), actions.indexOf("export async function resolveDisputeAction"));
  assert.ok(!reviewBody.includes('formData.get("reason")'), "검토 시작은 사유를 받지 않는다(변경 없음)");
  assert.equal((actions.match(/formData\.get\("adminNote"\)/g) ?? []).length, 1, "adminNote 를 읽는 곳은 케이스 노트 액션 하나뿐");
  const bulk = stripComments(read(BULK_SRC));
  assert.ok(bulk.includes('const reason = text(formData, "reason");') && bulk.includes("reason: reason || null }"), "일괄 액션도 reason → detail");
  assert.equal(DISPUTE_REASON_FIELD, "reason");
  assert.ok(isDisputeReasonValid("근거 부족") && !isDisputeReasonValid("x") && !isDisputeReasonValid("  ") && !isDisputeReasonValid(null));
  assert.equal(DISPUTE_FUNDS_REASON_REQUIRED_MESSAGE, "예치금 조치 사유를 입력해 주세요.");
  assert.deepEqual([...DISPUTE_DISMISS_REASON_PRESETS], ["근거 부족", "중복 접수", "당사자 취하"]);
  assert.deepEqual([...DISPUTE_RESOLVE_REASON_PRESETS], ["예치금 처리 완료", "당사자 합의", "제재로 종결"]);
  assert.equal(DISPUTE_CUSTOM_REASON_LABEL, "직접 입력");
  for (const a of ["review", "hold"] as const) {
    const s = buildDisputeStatusSummary(a);
    assert.ok(s.includes("예치금은 이동하지 않습니다") && s.includes(DISPUTE_NO_REASON_STORED_NOTE), a);
  }
  for (const a of ["dismiss", "resolve"] as const) {
    const s = buildDisputeStatusSummary(a, "resolve_action");
    assert.ok(s.includes("예치금은 이동하지 않습니다") && s.includes(DISPUTE_REASON_LOGGED_NOTE) && !s.includes("저장하지 않습니다"), a);
  }
  const complete = buildDisputeStatusSummary("resolve", "sanction_complete");
  assert.ok(complete.includes("보류 상태에서는 제재 액션의 완료 코드로만") && complete.includes(DISPUTE_NOTE_STORED_NOTE));
  assert.deepEqual([...DISPUTE_BULK_STATUSES], ["under_review", "resolved"]);
  assert.ok(read(BULK_SRC).includes('["under_review", "resolved", "dismissed"].includes(nextStatus)'), "액션 허용 값 ⊇ UI 2종");
  const b = buildDisputeBulkSummary("resolved", 3);
  assert.ok(b.startsWith("선택한 3건을 '해결'로 종결합니다.") && b.includes("예치금은 이동하지 않습니다") && b.includes(DISPUTE_REASON_LOGGED_NOTE) && b.includes("전체에 같은 값"));
  assert.ok(buildDisputeBulkSummary("under_review", 2).startsWith("선택한 2건을 '검토 중'으로 바꿉니다."));
  assert.ok(buildDisputeBulkSummary("resolved", 0).includes("선택된 건이 없습니다"));
  assert.equal(disputeBulkConfirmLabel("under_review", 2), "2건 검토 중으로");
});

// ── 빈 상태 · 플래시 ────────────────────────────────────────────────────────

test("빈 상태: 지시서 §2-5 원문 + 처리 순서 3단계 · 플래시 키는 액션의 redirect 값과 같다", () => {
  assert.equal(DISPUTE_EMPTY_STATE.title, "아직 접수된 분쟁이 없습니다");
  assert.equal(DISPUTE_EMPTY_STATE.description, "개별질문·맞춤의뢰에서 '문제 해결 요청'이 들어오면 여기에 쌓입니다.");
  assert.equal(DISPUTE_EMPTY_STATE.stepsTitle, "분쟁이 들어오면 이렇게 처리합니다");
  assert.deepEqual([...DISPUTE_EMPTY_STATE.steps], ["양측 주장과 주문·결제 이력을 확인합니다", "환불 · 분할 · 지급 중 하나로 예치금을 처리합니다", "필요하면 제재를 함께 결정합니다"]);
  assert.equal(disputeEmptyVariant("", 0), "first");
  assert.equal(disputeEmptyVariant("", 3), "tab");
  assert.equal(disputeEmptyVariant("김", 0), "search");
  const actions = read(DISPUTE_ACTIONS_SRC);
  for (const key of ["reviewing", "resolved", "dismissed", "note", "dispute_split"]) {
    assert.ok(actions.includes(`okUrl(disputeId, "${key}")`), `액션 redirect 키 ${key}`);
    assert.ok(disputeDetailFlashOkMessage(key), key);
  }
  assert.ok(read(SANCTION_ACTIONS_SRC).includes("?ok=sanction"));
  assert.equal(disputeListFlashOkMessage("sanction"), "조치를 기록했습니다.");
  assert.equal(disputeListFlashOkMessage("3건을 일괄 처리했습니다(under_review)."), "3건을 일괄 처리했습니다(under_review).");
  assert.equal(disputeListFlashOkMessage("<script>"), null, "형식 밖 값은 표시하지 않는다");
  assert.equal(disputeDetailFlashOkMessage("nope"), null);
});

// ── 필드명 = 액션이 읽는 이름 ────────────────────────────────────────────────

test("서버 액션이 읽는 필드명 그대로: disputeId · sanction · target · note · orderId · mentorGrossWon · studentRefundWon · ids · bulkStatus", () => {
  const a = stripComments(read(DISPUTE_ACTIONS_SRC));
  const s = stripComments(read(SANCTION_ACTIONS_SRC));
  const b = stripComments(read(BULK_SRC));
  for (const f of ["disputeId", "orderId", "mentorGrossWon", "studentRefundWon"]) assert.ok(a.includes(`formData.get("${f}")`), f);
  for (const f of ["disputeId", "sanction", "note", "target"]) assert.ok(s.includes(`formData.get("${f}")`), f);
  assert.ok(b.includes('.getAll("ids")') && b.includes('text(formData, "bulkStatus")'));
  assert.ok(s.includes('["7d", "30d", "permanent", "hold", "complete"].includes(sanction)'), "제재 코드 허용 값 그대로");
});

// ── tripwire ────────────────────────────────────────────────────────────────

test("목록 페이지: PageScaffold·구 툴바/페이지네이션/워크스페이스 미사용 · AdminPageLayout · 기본 탭 상수로 파싱 · 실패 플래시 문구", () => {
  const page = stripComments(read(LIST_PAGE));
  assert.ok(!page.includes("PageScaffold") && !page.includes("AdminListToolbar") && !page.includes("AdminListPagination") && !page.includes("AdminDisputesWorkspace"));
  assert.ok(page.includes("<AdminPageLayout") && page.includes("<DisputeQueueList"));
  assert.ok(page.includes("parseAdminListParams(sp, { defaultPageSize: DISPUTE_DEFAULT_PAGE_SIZE, defaultStatus: DISPUTE_DEFAULT_TAB })"));
  assert.ok(page.includes("resolveDisputeTab(rawParams.status)") && page.includes("처리 실패 —"));
  for (const gone of ["components/admin/AdminDisputesWorkspace.tsx", "components/disputes/DisputeAdminPageBody.tsx", "components/disputes/DisputeKeyValueList.tsx"]) {
    assert.ok(!existsSync(join(ROOT, gone)), `${gone} 삭제(관리자 분쟁 화면 전용이던 구 부품)`);
  }
});

test("목록 부품: Server Component · Tabs/Pagination 사용 · Counts 미사용(pending 전용 — prop 추가 0, 건수 줄은 화면 로컬) · 자체 탭 마크업 없음 · 컬럼 7 · 검색 form · 빈 상태 3단계", () => {
  const src = stripComments(read(LIST));
  assert.ok(!src.startsWith('"use client"'));
  assert.ok(src.includes("<AdminDataTable.Tabs") && src.includes("<AdminDataTable.Pagination"));
  assert.ok(!src.includes("AdminDataTable.Counts"), "Counts 는 pending 키만 읽어 이 화면(기본 탭 open)에 맞지 않는다 — prop 을 더하지 않고 화면이 그린다");
  assert.ok(src.includes("data-dispute-counts") && src.includes("{counts.open}") && src.includes("{counts.all}"), "화면 로컬 건수 줄");
  assert.ok(!src.includes('aria-label="상태 탭"') && !src.includes("← 이전") && !src.includes("다음 →"));
  for (const col of [">주문</th>", ">학생</th>", ">멘토</th>", ">유형</th>", ">접수일</th>", ">경과</th>", ">상태</th>"]) assert.ok(stripComments(read(TABLE)).includes(col), col);
  assert.ok(src.includes('name="q"') && src.includes('role="search"'));
  assert.ok(src.includes("DISPUTE_EMPTY_STATE.stepsTitle") && src.includes("DISPUTE_EMPTY_STATE.steps.map"));
  assert.ok(!src.includes("Action}") && !src.includes("bulkUpdateDisputesAction"), "목록 부품에는 서버 액션 없음(일괄은 표 부품)");
  // AdminDataTable 본체는 손대지 않았다 — Counts props 그대로
  assert.ok(read("components/admin/AdminDataTable.tsx").includes("counts: { pending: number; all: number };"));
});

test("표 부품: 일괄 = 기존 bulkUpdateDisputesAction(상태 변경만) · critical + 대상 목록 모달 · 사유 미요구(액션이 안 읽음) · 자금·제재 일괄 없음 · 행 인라인 제재 폼 제거", () => {
  const src = stripComments(read(TABLE));
  assert.ok(src.startsWith('"use client"'));
  assert.ok(src.includes("action={bulkUpdateDisputesAction}"));
  assert.equal((src.match(/<ConfirmSubmitButton\b/g) ?? []).length, 1, "일괄 버튼 하나를 상태 2종에 map");
  assert.ok(src.includes('level="critical"') && !src.includes("reasonRequired={false}") && src.includes("reasonFieldName={DISPUTE_REASON_FIELD}"), "일괄은 critical 기본대로 사유 필수 · reason 필드");
  assert.ok(src.includes("name={DISPUTE_BULK_STATUS_FIELD}") && src.includes("name={DISPUTE_BULK_IDS_FIELD}"));
  assert.ok(src.includes("body={checklist}") && src.includes("DisputeBulkChecklist"), "대상 목록 모달");
  assert.ok(src.includes("confirmBlockedMessage={selectedItems.length === 0 ? DISPUTE_BULK_BLOCKED_MESSAGE : null}"));
  assert.ok(!src.includes("applyCustomOrderDisputeSplitAdminAction") && !src.includes("applyDisputeSanctionAction"), "자금·제재 일괄 없음");
  assert.ok(!src.includes("SANCTIONS") && !src.includes('name="sanction"'), "구 행 인라인 제재 폼 제거");
  assert.ok(src.includes('<AdminStatusPill table="disputes" column="status" value={item.status} size="sm" />'));
  assert.ok(src.includes("disputeDetailPath(item.id)") && src.includes("disputeElapsedToneClass(item.elapsed.tone)"));
  assert.ok(!/style=\{/.test(src) && !/alert\(/.test(src));
});

test("상세 페이지: PageScaffold 미사용 · AdminPageLayout · 가능 조치는 disputeAllowedActions 로 · 케이스 노트 패널 · TS 수수료 모듈 미import", () => {
  const page = stripComments(read(DETAIL_PAGE));
  assert.ok(!page.includes("PageScaffold") && !page.includes("DisputeAdminPageBody"));
  assert.ok(page.includes("<AdminPageLayout") && page.includes("<DisputeNextActions") && page.includes("disputeAllowedActions(status)") && page.includes("disputeResolveRoute(status)"));
  assert.ok(page.includes('<AdminCaseNotesPanel targetKind="dispute"'), "케이스 노트 = 기존 admin_case_notes 경로(immediate · 감사 로그는 액션이 남김)");
  assert.ok(page.includes('<AdminStatusPill table="disputes" column="status" value={status} size="sm" />'));
  assert.ok(page.includes("loadAdminDisputeEscrowSplitPanelState(readClient, id, row, orderRow)"), "예치 상태는 기존 로더");
  assert.ok(!/orderSettlementAmounts|mentorPayoutsConstants|payoutComputation/.test(page));
  for (const title of ['title="접수 주장"', 'title="주문 정보"', 'title="주문 이력"', 'title="결제 이력"', 'title="납품물 증거"', 'title="처리 이력"']) assert.ok(page.includes(title), title);
});

test("다음 조치 부품: 기존 액션 4개만 import · stateChange 5(검토·보류·기각·해결 2경로) · critical 1(제재) · 제재는 대상·기간 라디오 + 잠금 + note 사유 · 자체 모달 없음", () => {
  const src = stripComments(read(NEXT_ACTIONS));
  assert.ok(src.startsWith('"use client"'));
  assert.ok(src.includes('import { dismissDisputeAction, resolveDisputeAction, setDisputeUnderReviewAction } from "@/lib/admin/adminDisputeActions";'));
  assert.ok(src.includes('import { applyDisputeSanctionAction } from "@/lib/admin/adminDisputeSanctionActions";'));
  assert.equal((src.match(/level="stateChange"/g) ?? []).length, 5);
  assert.equal((src.match(/level="critical"/g) ?? []).length, 1);
  assert.equal((src.match(/action=\{applyDisputeSanctionAction\}/g) ?? []).length, 3, "보류 · 보류 건 해결(complete) · 제재");
  assert.ok(src.includes("value={DISPUTE_HOLD_CODE}") && src.includes("value={DISPUTE_COMPLETE_CODE}"));
  assert.ok(src.includes('has("resolve") && resolveRoute === "sanction_complete"'), "보류 건 해결은 제재 액션 complete 로");
  assert.ok(src.includes("name={DISPUTE_SANCTION_FIELD}") && src.includes("name={DISPUTE_SANCTION_TARGET_FIELD}"));
  assert.equal((src.match(/reasonFieldName=\{DISPUTE_SANCTION_NOTE_FIELD\}/g) ?? []).length, 2, "제재 · 보류 건 완료(complete)는 note 로");
  assert.equal((src.match(/reasonFieldName=\{DISPUTE_REASON_FIELD\}/g) ?? []).length, 2, "기각 · 해결은 reason 으로");
  assert.equal((src.match(/reasonPresets=\{DISPUTE_DISMISS_REASON_PRESETS\}/g) ?? []).length, 1);
  assert.equal((src.match(/reasonPresets=\{DISPUTE_RESOLVE_REASON_PRESETS\}/g) ?? []).length, 2, "해결 2경로 모두 프리셋");
  assert.ok(!src.includes("reasonRequired={false}"));
  assert.ok(src.includes("confirmBlockedMessage={sanctionReady ? null : DISPUTE_SANCTION_BLOCKED_MESSAGE}"));
  assert.equal((src.match(/type="radio"/g) ?? []).length, 2, "대상 라디오 · 기간 라디오(map)");
  assert.ok(src.includes("<DisputeEscrowSplitPanel"), "자금 3종은 패널 부품");
  assert.ok(!src.includes("AdminConfirmDialog"), "자체 모달 금지 — ConfirmSubmitButton 경유");
  assert.ok(!/style=\{/.test(src) && !/alert\(/.test(src));
});

test("자금 부품: 같은 액션 3폼(환불·지급 hidden 고정 금액 · 분할 직접 입력) · critical 3 · 분할 합계 불일치 시 확인 잠김 · 슬라이더 없음 · 요율은 DB 행", () => {
  const src = stripComments(read(FUNDS));
  assert.ok(src.startsWith('"use client"'));
  assert.equal((src.match(/action=\{applyCustomOrderDisputeSplitAdminAction\}/g) ?? []).length, 3);
  assert.equal((src.match(/level="critical"/g) ?? []).length, 3);
  assert.equal((src.match(/<ConfirmSubmitButton\b/g) ?? []).length, 3);
  assert.ok(src.includes('<input type="hidden" name={DISPUTE_SPLIT_MENTOR_GROSS_FIELD} value="0" />') && src.includes('<input type="hidden" name={DISPUTE_SPLIT_STUDENT_REFUND_FIELD} value={String(hold)} />'), "전액 환불 = (0, hold)");
  assert.ok(src.includes('<input type="hidden" name={DISPUTE_SPLIT_MENTOR_GROSS_FIELD} value={String(hold)} />') && src.includes('<input type="hidden" name={DISPUTE_SPLIT_STUDENT_REFUND_FIELD} value="0" />'), "멘토 지급 = (hold, 0)");
  assert.ok(src.includes("confirmBlockedMessage={splitBlocked}") && src.includes("disputeSplitBlockedMessage(preview)"));
  assert.ok(!src.includes("reasonRequired={false}"), "자금 3종은 critical 기본대로 사유 필수");
  assert.equal((src.match(/reasonFieldName=\{DISPUTE_REASON_FIELD\}/g) ?? []).length, 3, "사유는 액션이 읽는 reason 필드로");
  assert.ok(src.includes("DISPUTE_REASON_LOGGED_NOTE"), "감사 로그 안내");
  assert.equal((src.match(/type="number"/g) ?? []).length, 2, "학생 몫·멘토 몫 금액 직접 입력");
  assert.ok(!src.includes('type="range"'), "슬라이더 없음");
  assert.ok(src.includes("props.form.feeRate") && src.includes("SETTLEMENT_FEE_RATE_UNSET_LABEL") && !/0\.05|0\.15/.test(src));
  assert.ok(src.includes("details={buildDisputeSplitDetails(preview)}"), "금액 재표시");
  assert.ok(!src.includes("AdminConfirmDialog"));
});

test("서버 조회: 오래된 것이 위(created_at asc) · 제재 탭 .in · head count · 당사자 이름 검색 users 조인 · 관리자 읽기 클라이언트 · 쓰기 없음 · 새 'use server' 파일 없음", () => {
  const q = stripComments(read(QUERIES));
  assert.ok(q.includes('.order("created_at", { ascending: true })'));
  assert.ok(q.includes('r.in("status", [...args.statuses])') && q.includes('r.eq("status", args.statuses[0])'));
  assert.ok(q.includes('select("id", { count: "exact", head: true })'));
  assert.ok(q.includes("buildAdminUsersSearchOr(term)") && q.includes("buildDisputeSearchOr(args.term, args.partyIds)"));
  assert.ok(q.includes("mentorProfilesAdminReadClient(supabase)"));
  assert.ok(!/\.insert\(|\.update\(|\.delete\(|\.rpc\(/.test(q), "조회 전용");
  const useServer = readdirSync(join(ROOT, "lib", "admin"))
    .filter((f) => f.endsWith(".ts") && readFileSync(join(ROOT, "lib", "admin", f), "utf8").startsWith('"use server"'))
    .sort();
  assert.deepEqual(useServer, [
    "accountStatusActions.ts",
    "adminDisputeActions.ts",
    "adminDisputeSanctionActions.ts",
    "adminNoticesActions.ts",
    "adminReportActions.ts",
    "adminReviewActions.ts",
    "adminTopupPackageActions.ts",
    "bulkActions.ts",
    "communityModerationActions.ts",
    "mentorAcademicRecordChangeReviewActions.ts",
    "mentorActivityAdminActions.ts",
    "mentorApprovalActions.ts",
    "mentorApprovalDocumentActions.ts",
    "mentorCapAdminActions.ts",
    "mentorSchoolVerificationReviewActions.ts",
    // PR-8: 질문 첨부 뷰어의 서명 URL 재요청(읽기 전용 · DB 쓰기 없음) — 쓰기 액션이 아니다
    "questionDrilldownDocumentActions.ts",
    "refundActions.ts",
    "schoolClassificationActions.ts",
  ], "PR-6 는 서버 액션을 새로 만들지 않았다(기존 쓰기 경로만) · PR-8 은 읽기 전용 서명 URL 액션 하나");
  const pure = stripComments(read(CONSOLE));
  assert.ok(!/from "react"|from "@\//.test(pure), "순수 모듈은 React·@/ import 없음");
});

test("UI 카피 금지어 없음(선생님·강사님·수강생·과외·alert)", () => {
  for (const rel of [LIST_PAGE, DETAIL_PAGE, LIST, TABLE, NEXT_ACTIONS, FUNDS, CONSOLE, QUERIES]) {
    const code = stripComments(read(rel));
    for (const banned of ["선생님", "강사님", "수강생", "과외", "커패니티", "웰버십", "쌤버쉽", "alert("]) {
      assert.ok(!code.includes(banned), `${rel}: 금지 문구 ${banned}`);
    }
  }
});
