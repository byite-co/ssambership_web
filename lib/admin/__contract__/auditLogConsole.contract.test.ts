// 계약 테스트: 관리자 감사 로그(PR-10 §2) — 액션 사전(코드가 쓰는 action_type 전부) · 필터(실행자·액션·기간·열람 제외) · 대상 링크 · 레거시 라벨 헬퍼의 사전 참조.
// 실행: node --test --experimental-strip-types lib/admin/__contract__/auditLogConsole.contract.test.ts
//
// 고정하는 것(지시서 §4):
//   ① 액션명 사전에 코드가 기록하는 action_type 전부(고정 + 템플릿 전개)가 있고 라벨은 한글 — 소스 스캔 대조 · 미등재는 `기타 조치`(코드값 노출 금지)
//   ② 열람 기록 제외 필터(`question_body_viewed` neq) · 실행자 옵션 = 관리자 N명 + 시스템 · 기간 시작 산술
//   ③ 레거시 라벨 헬퍼 2곳(contentReportLabels · disputeLabels)이 상태 사전을 참조한다(소스 트립와이어) · 화면별 액션 라벨 맵 2곳이 사전에 위임
//   ④ 행의 → 는 대상으로(사람은 계정 상세 · 멘토 승인 대상은 계정 상세 멘토 탭) · 사유 없으면 —
//   ⑤ 화면: 상시 안내 · 탭 없음 · 코드값 미노출 · 조회 전용 · 구 통합 뷰 파일 삭제 · 빈 상태

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ADMIN_ACTION_GROUPS,
  ADMIN_ACTION_TYPE_KEYS,
  ADMIN_ACTION_TYPE_LABELS,
  ADMIN_ACTION_UNKNOWN_LABEL,
  COMMUNITY_TARGET_TYPE_VALUES,
  DISPUTE_SANCTION_VALUES,
  MODERATION_INTENT_VALUES,
  REFUND_BULK_DECISION_VALUES,
  REVIEW_ACTION_VALUES,
  adminActionLabel,
  adminActionTypesForGroup,
  resolveAdminActionType,
} from "../adminActionTypeLabels.ts";
import {
  AUDIT_LOG_EMPTY_STATE,
  AUDIT_LOG_HARD_DELETE_NOTICE,
  AUDIT_LOG_SYSTEM_ACTOR,
  auditLogActionTypesFilter,
  auditLogEmptyState,
  auditLogFilterExtra,
  auditLogPeriodStartIso,
  auditLogReason,
  auditLogSearchScope,
  auditLogTargetHref,
  auditLogTargetTypeLabel,
  buildAuditLogActorOptions,
  buildAuditLogItem,
  buildAuditLogUrl,
  resolveAuditLogFilters,
} from "../auditLogConsole.ts";
import { parseAdminListParams } from "../adminListParams.ts";
import { accountActionLogLabel } from "../accountDetailConsole.ts";
import { DISPUTE_ACTION_LOG_LABELS, disputeActionLogLabel } from "../disputeConsole.ts";
import { contentReportStatusLabel } from "../contentReportLabels.ts";
import { adminDisputeStatusLabel } from "../disputeLabels.ts";
import { resolveAdminStatus } from "../adminStatusDictionary.ts";
import { QUESTION_BODY_VIEWED_ACTION } from "../questionDrilldownConsole.ts";
import { ADMIN_CONSOLE_NAV } from "../../../components/admin/adminConsoleNavConfig.ts";

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const PAGE = "app/(admin)/admin/(console)/audit-logs/page.tsx";
const TOOLBAR = "components/admin/AuditLogToolbar.tsx";
const TABLE = "components/admin/AuditLogTable.tsx";
const QUERIES = "lib/admin/auditLogQueries.ts";

const ADMIN_A = "9bf48819-1dd2-40dd-96a3-d64bcca2e60c";
const USER_B = "ca55f8ea-d852-4bf1-a789-b2d014bc5fd0";

function walk(dir: string, out: string[]) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === "__contract__" || name === "node_modules") continue;
      walk(full, out);
    } else if (/\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

/**
 * 코드가 기록하는 action_type 을 소스에서 뽑는다:
 *   `actionType: "x"` · `actionType: cond ? "x" : "y"` · `action_type: "x"`(웹훅 service_role insert) ·
 *   `log…Action(…, "x", …)` / `log…Action(…, cond ? "x" : "y", …)`(학적 변경·학교 인증·분류 액션의 헬퍼) · SQL 192 배치의 `'school_verification_bulk_confirmed'`.
 * 템플릿(`review_${action}` 등)은 값 집합 대조로 따로 고정한다.
 */
function scanRecordedActionTypes(): Map<string, string[]> {
  const found = new Map<string, string[]>();
  const add = (type: string, where: string) => {
    if (!found.has(type)) found.set(type, []);
    found.get(type)!.push(where);
  };
  const files = [...walk(join(ROOT, "lib"), []), ...walk(join(ROOT, "app"), [])];
  for (const f of files) {
    const rel = f.slice(ROOT.length).replace(/\\/g, "/").replace(/^\/+/, "");
    const src = stripComments(readFileSync(f, "utf8"));
    if (!/actionType|action_type|log\w*Action\(/.test(src)) continue;
    for (const m of src.matchAll(/action(?:Type|_type):\s*"([a-z0-9_]+)"/g)) add(m[1], rel);
    for (const m of src.matchAll(/action(?:Type|_type):\s*[^\n]*?\?\s*"([a-z0-9_]+)"\s*:\s*"([a-z0-9_]+)"/g)) {
      add(m[1], rel);
      add(m[2], rel);
    }
    for (const m of src.matchAll(/log\w*Action\(\s*[^,()]+,\s*"([a-z0-9_]+)"/g)) add(m[1], rel);
    for (const m of src.matchAll(/log\w*Action\(\s*[^,()]+,\s*[^,()]+,\s*"([a-z0-9_]+)"/g)) add(m[1], rel);
    for (const m of src.matchAll(/log\w*Action\(\s*[^,()]+,\s*[^,()]+,\s*[^,()]*?\?\s*"([a-z0-9_]+)"\s*:\s*"([a-z0-9_]+)"/g)) {
      add(m[1], rel);
      add(m[2], rel);
    }
  }
  const sql = read("supabase/sql/192_school_verification_provisional_rule.sql");
  for (const m of sql.matchAll(/'(school_verification_bulk_confirmed)'/g)) add(m[1], "supabase/sql/192");
  return found;
}

// ── ① 사전 ───────────────────────────────────────────────────────────────────

test("사전: 코드가 기록하는 action_type(고정 + 웹훅 + 배치)은 전부 등재돼 있고 라벨은 한글이다(소스 스캔 대조)", () => {
  const recorded = scanRecordedActionTypes();
  assert.ok(recorded.size >= 35, `스캔된 고정 액션이 너무 적다: ${recorded.size}`);
  const missing = [...recorded.entries()].filter(([type]) => !ADMIN_ACTION_TYPE_LABELS[type]).map(([type, where]) => `${type} (${where.join(", ")})`);
  assert.deepEqual(missing, [], "사전에 없는 action_type — adminActionTypeLabels.ts 에 등재하라");
  for (const [type] of recorded) assert.ok(/[가-힣]/.test(adminActionLabel(type)), `${type} 라벨에 한글 없음`);
  for (const must of ["mentor_approve", "question_body_viewed", "school_verification_bulk_confirmed", "paysync_webhook", "webhook_recovery", "payout_run_execute", "notice_updated_notice"]) {
    assert.ok(recorded.has(must) || ADMIN_ACTION_TYPE_LABELS[must], must);
  }
});

test("사전: 템플릿 계열의 값 집합은 소스와 같다(review · refund_bulk · dispute_sanction · content_report/community intent · community target · notice) → 전개 항목 전부 등재", () => {
  const review = stripComments(read("lib/admin/adminReviewActions.ts"));
  const reviewSet = [...(review.match(/const ACTION_SET = new Set\(\[([^\]]+)\]\)/)?.[1] ?? "").matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
  assert.deepEqual(reviewSet.sort(), [...REVIEW_ACTION_VALUES].sort(), "review_${action}");
  assert.ok(review.includes("actionType: `review_${action}`"));

  const refund = stripComments(read("lib/admin/refundActions.ts"));
  assert.ok(refund.includes("actionType: `refund_bulk_${decision}`"));
  assert.deepEqual([...REFUND_BULK_DECISION_VALUES], ["approve", "reject"]);
  assert.ok(refund.includes('actionType: decision === "approve" ? "refund_approve" : "refund_reject"'));

  const sanction = stripComments(read("lib/admin/adminDisputeSanctionActions.ts"));
  const sanctionSet = [...(sanction.match(/if \(!\[([^\]]+)\]\.includes\(sanction\)\)/)?.[1] ?? "").matchAll(/"([a-z0-9_]+)"/g)].map((m) => m[1]);
  assert.deepEqual(sanctionSet.sort(), [...DISPUTE_SANCTION_VALUES].sort(), "dispute_${sanction}");
  assert.ok(sanction.includes("actionType: `dispute_${sanction}`"));

  const report = stripComments(read("lib/admin/adminReportActions.ts"));
  const intentSet = [...(report.match(/const MODERATION_INTENTS = new Set\(\[([^\]]+)\]\)/)?.[1] ?? "").matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
  assert.deepEqual(intentSet.sort(), [...MODERATION_INTENT_VALUES].sort(), "content_report_${intent}");
  assert.ok(report.includes("actionType: `content_report_${intent}`"));

  const core = stripComments(read("lib/admin/communityModerationCore.ts"));
  const targetUnion = core.match(/export type ModerationTargetType =([\s\S]*?);/)?.[1] ?? "";
  const targetSet = [...targetUnion.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
  assert.deepEqual(targetSet.sort(), [...COMMUNITY_TARGET_TYPE_VALUES].sort(), "community_${intent}_${targetType}");
  const intentUnion = core.match(/export type ModerationIntent =([^;]+);/)?.[1] ?? "";
  assert.deepEqual([...intentUnion.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]).sort(), [...MODERATION_INTENT_VALUES].sort());
  assert.ok(stripComments(read("lib/admin/communityModerationActions.ts")).includes("actionType: `community_${args.intent}_${args.targetType}`"));

  const notices = stripComments(read("lib/admin/adminNoticesActions.ts"));
  assert.ok(notices.includes("`notice_activated_${resource}`") && notices.includes("`notice_deactivated_${resource}`"));
  assert.ok(notices.includes('"notice_created_notice"') && notices.includes('"notice_created_promotion"') && notices.includes('"notice_updated_notice"'));

  for (const a of REVIEW_ACTION_VALUES) assert.ok(ADMIN_ACTION_TYPE_LABELS[`review_${a}`], a);
  for (const s of DISPUTE_SANCTION_VALUES) assert.ok(ADMIN_ACTION_TYPE_LABELS[`dispute_${s}`], s);
  for (const i of MODERATION_INTENT_VALUES) {
    assert.ok(ADMIN_ACTION_TYPE_LABELS[`content_report_${i}`], i);
    for (const t of COMMUNITY_TARGET_TYPE_VALUES) assert.ok(ADMIN_ACTION_TYPE_LABELS[`community_${i}_${t}`], `${i}/${t}`);
  }
  for (const v of ["created", "updated", "activated", "deactivated"]) for (const r of ["notice", "promotion"]) assert.ok(ADMIN_ACTION_TYPE_LABELS[`notice_${v}_${r}`], `${v}/${r}`);
});

test("사전: 계열 16 · 항목 72(고정 38 + 전개 34 — PR-13 question_export 추가) · 모든 항목에 계열·한글 라벨 · 금지 문구 없음 · 미등재는 '기타 조치'(코드값 노출 금지)", () => {
  assert.equal(ADMIN_ACTION_GROUPS.length, 16);
  assert.equal(ADMIN_ACTION_TYPE_KEYS.length, 72);
  const groupKeys = new Set(ADMIN_ACTION_GROUPS.map((g) => g.key));
  for (const key of ADMIN_ACTION_TYPE_KEYS) {
    const e = ADMIN_ACTION_TYPE_LABELS[key];
    assert.ok(groupKeys.has(e.group), `${key} 계열`);
    assert.ok(/[가-힣]/.test(e.label), `${key} 라벨`);
    for (const banned of ["선생님", "강사님", "수강생", "과외", "커패니티", "웰버십", "쌤버쉽", "정산 대기", "작업전"]) assert.ok(!e.label.includes(banned), `${key} ${banned}`);
  }
  for (const g of ADMIN_ACTION_GROUPS) assert.ok(adminActionTypesForGroup(g.key).length > 0, `${g.key} 비어 있음`);
  assert.equal(adminActionTypesForGroup("dispute").length, 11);
  const unknown = resolveAdminActionType("mentor_approve_v2");
  assert.equal(unknown.known, false);
  assert.equal(unknown.label, ADMIN_ACTION_UNKNOWN_LABEL);
  assert.equal(unknown.raw, "mentor_approve_v2");
  assert.equal(unknown.group, null);
  assert.equal(resolveAdminActionType(null).label, "기타 조치");
  assert.equal(resolveAdminActionType("mentor_approve").label, "멘토 승인");
  assert.equal(resolveAdminActionType("mentor_approve").groupLabel, "멘토 승인");
  assert.equal(adminActionLabel("dispute_7d"), `제재 · ${resolveAdminStatus("disputes", "status", "sanction_7d").label}`);
});

// ── ③ 레거시 라벨 헬퍼 · 화면별 라벨 맵 위임 ────────────────────────────────

test("레거시 라벨 헬퍼 2곳: 상태 사전을 참조(import 트립와이어) · 옛 표기(접수·거절·종결·에스컬레이션) 없음 · 값은 사전 라벨과 같다", () => {
  for (const rel of ["lib/admin/contentReportLabels.ts", "lib/admin/disputeLabels.ts"]) {
    const code = stripComments(read(rel));
    assert.ok(code.includes('import { resolveAdminStatus } from "./adminStatusDictionary.ts";'), `${rel}: 사전 참조`);
    for (const legacy of ['"접수"', '"거절"', '"종결"', '"접수·진행"', '"에스컬레이션"']) assert.ok(!code.includes(legacy), `${rel}: 옛 표기 ${legacy}`);
  }
  assert.equal(contentReportStatusLabel("pending"), resolveAdminStatus("content_reports", "status", "pending").label);
  assert.equal(contentReportStatusLabel("rejected"), "반려");
  assert.equal(contentReportStatusLabel("dismissed"), "기각");
  assert.equal(contentReportStatusLabel(""), "—");
  assert.equal(contentReportStatusLabel("weird"), "기타", "코드값 노출 금지");
  assert.equal(adminDisputeStatusLabel("open"), "열림");
  assert.equal(adminDisputeStatusLabel("escalated"), "상위 이관");
  assert.equal(adminDisputeStatusLabel("dismissed"), "기각");
  assert.equal(adminDisputeStatusLabel(null), "—");
  assert.equal(adminDisputeStatusLabel("weird"), "weird (확인 필요)", "구 폴백 유지");
});

test("화면별 액션 라벨 맵 2곳(계정 상세 · 분쟁 상세)은 사전에 위임한다 — 기존 계약 값 유지", () => {
  const account = stripComments(read("lib/admin/accountDetailConsole.ts"));
  assert.ok(account.includes('import { resolveAdminActionType } from "./adminActionTypeLabels.ts";') && !account.includes("ACCOUNT_ACTION_LOG_LABELS"), "계정 상세 위임");
  assert.equal(accountActionLogLabel("mentor_approve"), "멘토 승인");
  assert.equal(accountActionLogLabel("question_body_viewed"), "질문 본문 열람");
  assert.equal(accountActionLogLabel("refund_approve"), adminActionLabel("refund_approve"));
  const dispute = stripComments(read("lib/admin/disputeConsole.ts"));
  assert.ok(dispute.includes('adminActionTypesForGroup("dispute").map((actionType) => [actionType, adminActionLabel(actionType)])'), "분쟁 상세 위임");
  assert.deepEqual(Object.keys(DISPUTE_ACTION_LOG_LABELS).sort(), adminActionTypesForGroup("dispute").sort());
  assert.equal(disputeActionLogLabel("dispute_custom_order_split"), "예치금 분배");
  assert.equal(disputeActionLogLabel("dispute_hold"), "보류");
  assert.equal(DISPUTE_ACTION_LOG_LABELS.dispute_30d, adminActionLabel("dispute_30d"));
});

// ── ② 필터 ───────────────────────────────────────────────────────────────────

test("필터 파싱: 실행자(uuid | system | 그 외 무시) · 액션 계열(모르면 무시) · 기간(all·today·7d·30d) · 열람 제외('1') · extra 정규화 왕복", () => {
  const f = resolveAuditLogFilters({ actor: ADMIN_A, action: "dispute", period: "7d", hideViews: "1" });
  assert.deepEqual(f, { actor: ADMIN_A, group: "dispute", period: "7d", hideViews: true });
  assert.deepEqual(auditLogFilterExtra(f), { actor: ADMIN_A, action: "dispute", period: "7d", hideViews: "1" });
  assert.deepEqual(resolveAuditLogFilters({ actor: "system" }).actor, AUDIT_LOG_SYSTEM_ACTOR);
  assert.deepEqual(resolveAuditLogFilters({ actor: "not-a-uuid", action: "bogus", period: "1y", hideViews: "yes" }), { actor: null, group: null, period: "all", hideViews: false });
  assert.deepEqual(auditLogFilterExtra(resolveAuditLogFilters({})), {}, "기본값은 싣지 않는다");
  const params = { ...parseAdminListParams({ q: "홍길동", page: "2", actor: "system" }, { defaultPageSize: 50 }), status: "", extra: { actor: "system" } };
  const url = buildAuditLogUrl(params, { page: 3 });
  assert.ok(url.includes("actor=system") && url.includes("page=3") && url.includes("q="), url);
  assert.ok(!url.includes("status="), "탭 없음 — status 파라미터 없음");
});

test("열람 기록 제외 = question_body_viewed neq · 계열 필터 = 사전 전개 목록 in · 기간 시작(오늘 KST 자정 · 7일 · 30일)", () => {
  assert.deepEqual(auditLogActionTypesFilter({ actor: null, group: null, period: "all", hideViews: true }), { include: null, exclude: QUESTION_BODY_VIEWED_ACTION });
  assert.equal(QUESTION_BODY_VIEWED_ACTION, "question_body_viewed");
  const g = auditLogActionTypesFilter({ actor: null, group: "notice", period: "all", hideViews: false });
  assert.deepEqual(g.include?.sort(), adminActionTypesForGroup("notice").sort());
  assert.equal(g.exclude, null);
  const now = "2026-09-03T05:00:00Z"; // KST 14:00
  assert.equal(auditLogPeriodStartIso("today", now), "2026-09-03T00:00:00+09:00");
  assert.equal(auditLogPeriodStartIso("today", "2026-09-02T16:00:00Z"), "2026-09-03T00:00:00+09:00", "UTC 16:00 = KST 다음날 01:00");
  assert.equal(auditLogPeriodStartIso("7d", now), "2026-08-27T05:00:00.000Z");
  assert.equal(auditLogPeriodStartIso("30d", now), "2026-08-04T05:00:00.000Z");
  assert.equal(auditLogPeriodStartIso("all", now), null);
});

test("검색(대상): uuid 는 target_id 일치 · 문자열은 users 이름·닉네임·이메일 · 빈 값 없음 · PostgREST 특수문자 제거", () => {
  assert.deepEqual(auditLogSearchScope(` ${USER_B.toUpperCase()} `), { kind: "uuid", id: USER_B });
  assert.deepEqual(auditLogSearchScope("홍%길_동"), { kind: "users", term: "홍 길 동" });
  assert.deepEqual(auditLogSearchScope("   "), { kind: "none" });
});

test("실행자 옵션 = 전체 + 관리자 N명 + 시스템(웹훅·배치) · 빈 상태 2종", () => {
  const opts = buildAuditLogActorOptions([
    { id: ADMIN_A, name: "관리자" },
    { id: "970f7278-14e2-435c-86e5-3d0d19a7f459", name: "쌤버십 운영자" },
  ]);
  assert.deepEqual(opts.map((o) => o.value), ["", ADMIN_A, "970f7278-14e2-435c-86e5-3d0d19a7f459", "system"]);
  assert.equal(opts[opts.length - 1].label, "시스템(웹훅·배치)");
  assert.deepEqual(auditLogEmptyState({ actor: null, group: null, period: "all", hideViews: false }, ""), AUDIT_LOG_EMPTY_STATE.none);
  assert.equal(auditLogEmptyState({ actor: null, group: null, period: "all", hideViews: true }, "").title, "조건에 맞는 기록이 없습니다");
  assert.equal(auditLogEmptyState({ actor: null, group: null, period: "all", hideViews: false }, "x").title, "조건에 맞는 기록이 없습니다");
});

// ── ④ 대상 · 사유 · 행 ───────────────────────────────────────────────────────

test("대상 링크: 사람 → 계정 상세 · 멘토 승인 대상(mentor_profile) → 계정 상세 멘토 탭 · 학교 인증은 detail.mentorId · 각 화면 상세 · 모르면 null", () => {
  assert.equal(auditLogTargetHref("user", USER_B, null), `/admin/users/${USER_B}`);
  assert.equal(auditLogTargetHref("mentor_profile", USER_B, { note: "" }), `/admin/users/${USER_B}?tab=mentor`);
  assert.equal(auditLogTargetHref("mentor_school_verification", "e1547c17-ea46-40ce-acbc-26b876ca3785", { mentorId: USER_B }), `/admin/users/${USER_B}?tab=mentor`);
  assert.equal(auditLogTargetHref("mentor_school_verification", null, { count: 67 }), null, "배치 행(대상 없음)");
  assert.equal(auditLogTargetHref("dispute", "d1", null), "/admin/disputes/d1");
  assert.equal(auditLogTargetHref("content_report", "r1", null), "/admin/reports/r1");
  assert.equal(auditLogTargetHref("refund", "f1", null), "/admin/refunds/f1");
  assert.equal(auditLogTargetHref("review", "v1", null), "/admin/reviews/v1");
  assert.equal(auditLogTargetHref("question_thread", "t1", null), "/admin/question-threads/t1");
  assert.equal(auditLogTargetHref("individual_question", "q1", null), "/admin/individual-questions/q1");
  assert.equal(auditLogTargetHref("app_notice", "n1", null), "/admin/notices?edit=n1#notice-editor");
  assert.equal(auditLogTargetHref("cash_topup", null, null), "/admin/topups");
  assert.equal(auditLogTargetHref("cash_topup_package", "p1", null), "/admin/settings");
  assert.equal(auditLogTargetHref("payout_run", "run1", null), "/admin/settlements?tab=history&run=run1");
  assert.equal(auditLogTargetHref("school_tier_mapping", "m1", null), "/admin/school-classifications");
  assert.equal(auditLogTargetHref("mentor_academic_record_change", "a1", null), "/admin/academic-record-changes?request=a1");
  assert.equal(auditLogTargetHref("mentor_activity_event", "x", null), null);
  assert.equal(auditLogTargetHref(null, null, null), null);
  assert.equal(auditLogTargetTypeLabel("mentor_profile"), "멘토");
  assert.equal(auditLogTargetTypeLabel("something_new"), "기타", "코드값 노출 금지");
  assert.equal(auditLogTargetTypeLabel(null), "—");
});

test("사유: reason · rejectionReason · adminNote · note 순 · 빈 문자열은 없음 · 행 조립(시스템 · 사람 이름 · 미등재 라벨)", () => {
  assert.equal(auditLogReason({ note: "", reason: "외부 연락처 유도" }), "외부 연락처 유도");
  assert.equal(auditLogReason({ rejectionReason: "서류 불명확" }), "서류 불명확");
  assert.equal(auditLogReason({ note: "" }), null);
  assert.equal(auditLogReason({ count: 67 }), null);
  assert.equal(auditLogReason("x"), null);
  const names = { admins: new Map([[ADMIN_A, "관리자"]]), users: new Map([[USER_B, "홍길동"]]) };
  const sys = buildAuditLogItem({ id: "1", createdAt: "2026-08-30T07:52:01Z", actorId: null, actionType: "paysync_webhook", targetType: "cash_topup", targetId: null, detail: null }, names);
  assert.equal(sys.actorLabel, "시스템");
  assert.equal(sys.action.label, "페이싱크 웹훅 수신");
  assert.equal(sys.targetLabel, "캐시 충전");
  assert.equal(sys.targetHref, "/admin/topups");
  assert.equal(sys.reason, null);
  const person = buildAuditLogItem({ id: "2", createdAt: null, actorId: ADMIN_A, actionType: "mentor_approve", targetType: "mentor_profile", targetId: USER_B, detail: { note: "" } }, names);
  assert.equal(person.actorLabel, "관리자");
  assert.equal(person.targetLabel, "멘토 · 홍길동");
  assert.equal(person.targetHref, `/admin/users/${USER_B}?tab=mentor`);
  const unknown = buildAuditLogItem({ id: "3", createdAt: null, actorId: "unknown-admin", actionType: "legacy_thing", targetType: "user", targetId: "00000000-0000-4000-8000-000000000009", detail: null }, names);
  assert.equal(unknown.actorLabel, "관리자 unknown-…");
  assert.equal(unknown.action.label, "기타 조치");
  assert.equal(unknown.action.known, false);
  assert.equal(unknown.targetLabel, "사용자 · 00000000…");
});

// ── ⑤ 화면 tripwire ──────────────────────────────────────────────────────────

test("페이지: AdminPageLayout(PageScaffold 없음) · 상시 안내('사용자를 완전히 삭제한 경우…') · 탭 없음 · extra 는 필터 4키만 · EmptyState · 나브 라벨 '감사 로그'", () => {
  const code = stripComments(read(PAGE));
  assert.ok(code.includes("<AdminPageLayout") && !code.includes("PageScaffold"));
  assert.ok(code.includes("AUDIT_LOG_HARD_DELETE_NOTICE") && code.includes("data-audit-hard-delete-notice"), "상시 안내");
  assert.equal(AUDIT_LOG_HARD_DELETE_NOTICE, "사용자를 완전히 삭제한 경우는 이 로그에 남지 않습니다.");
  assert.ok(code.includes("extra: auditLogFilterExtra(filters)"), "extra 정규화");
  assert.ok(!code.includes("<AdminDataTable.Tabs") && !code.includes("AdminListToolbar"), "탭 없음");
  assert.ok(code.includes("<EmptyState title={empty.title}"));
  assert.equal(ADMIN_CONSOLE_NAV.find((n) => n.href === "/admin/audit-logs")?.label, "감사 로그");
});

test("툴바·표: 필터 3 select + 검색 + 열람 제외 체크 · 액션 셀은 사전 라벨만(코드값은 툴팁) · → 는 대상 링크 · 사유 없으면 — · 페이지네이션 공용", () => {
  const toolbar = stripComments(read(TOOLBAR));
  assert.ok(toolbar.includes('role="search"') && toolbar.includes('name="q"'));
  assert.ok(toolbar.includes("name={AUDIT_LOG_ACTOR_PARAM}") && toolbar.includes("name={AUDIT_LOG_ACTION_PARAM}") && toolbar.includes("name={AUDIT_LOG_PERIOD_PARAM}"), "필터 3개");
  assert.ok(toolbar.includes('type="checkbox" name={AUDIT_LOG_HIDE_VIEWS_PARAM} value="1"') && toolbar.includes("열람 기록 제외"), "열람 제외 체크");
  assert.ok(toolbar.includes("data-audit-counts"), "N / M");
  const table = stripComments(read(TABLE));
  assert.ok(!table.includes("{it.actionType}"), "코드값을 셀에 그리지 않는다");
  assert.ok(table.includes("{it.action.label}") && table.includes("title={it.action.known ? undefined : it.action.raw}"), "라벨 + 툴팁");
  assert.ok(table.includes("{it.action.groupLabel}"), "계열 접두");
  assert.ok(table.includes("it.targetHref ? (") && table.includes("aria-label=\"대상으로 이동\""), "→ 링크");
  assert.ok(table.includes('{it.reason ? <span className="line-clamp-2 text-slate-700">{it.reason}</span> : <span className="text-slate-400">—</span>}'), "사유 —");
  assert.ok(table.includes("<AdminDataTable.Pagination") && !table.includes('aria-label="상태 탭"'));
  assert.ok(!read(TOOLBAR).startsWith('"use client"') && !read(TABLE).startsWith('"use client"'), "Server Component");
});

test("조회 모듈: select 만(insert/update/upsert/delete/rpc 없음) · 열람 제외 neq · 시스템 is null · 구 통합 뷰 3파일 삭제", () => {
  const code = stripComments(read(QUERIES));
  assert.ok(code.includes('import "server-only"'));
  assert.ok(!/\.(insert|update|upsert|delete|rpc)\(/.test(code), "조회 전용");
  assert.ok(code.includes('q = q.is("admin_id", null)') && code.includes('q.neq("action_type", exclude)') && code.includes('q.in("action_type", include)'), "필터 배선");
  assert.ok(code.includes("auditLogActionTypesFilter(filters)") && code.includes("auditLogPeriodStartIso(filters.period, nowIso)"), "순수 규칙 위임");
  for (const gone of ["lib/admin/adminUnifiedActivityLog.ts", "components/admin/AdminUnifiedActivityLogView.tsx", "lib/admin/adminOperationalLabels.ts"]) {
    assert.ok(!existsSync(join(ROOT, gone)), `${gone} 삭제(구 9소스 통합 뷰 · 구 표기 라벨)`);
  }
});
