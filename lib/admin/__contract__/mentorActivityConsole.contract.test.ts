// 계약 테스트: 멘토 활동 화면(PR-11 §4) — 상태 탭(이탈 의심 별도) · 미답변 경보(24h/48h) · 미답변 오래된 순 정렬 · 조치는 §0-C 기존 3경로만(알림·강제 정지 없음) · 탭별 빈 상태.
// 실행: node --test --experimental-strip-types lib/admin/__contract__/mentorActivityConsole.contract.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseAdminListParams } from "../adminListParams.ts";
import { buildAdminDataTableUrl } from "../adminDataTable.ts";
import { resolveAdminConfirmRequirements } from "../adminConfirmPolicy.ts";
import { MENTOR_ACTIVITY_LABELS } from "../accountDetailConsole.ts";
import {
  MENTOR_ACTIVITY_ACTIONS,
  MENTOR_ACTIVITY_BASE_PATH,
  MENTOR_ACTIVITY_DEFAULT_PAGE_SIZE,
  MENTOR_ACTIVITY_DEFAULT_TAB,
  MENTOR_ACTIVITY_EMPTY_STATES,
  MENTOR_ACTIVITY_EVENT_ID_FIELD,
  MENTOR_ACTIVITY_MENTOR_ID_FIELD,
  MENTOR_ACTIVITY_MISSING_ACTIONS_NOTE,
  MENTOR_ACTIVITY_REASON_FIELD,
  MENTOR_ACTIVITY_ROW_LIMIT,
  MENTOR_ACTIVITY_TABS,
  MENTOR_ACTIVITY_TAB_VALUES,
  MENTOR_UNANSWERED_DANGER_HOURS,
  MENTOR_UNANSWERED_WARNING_HOURS,
  buildMentorActivityListUrl,
  compareMentorActivityItems,
  mentorActivityAccountUrl,
  mentorActivityAvailableActions,
  mentorActivityEmptyState,
  mentorActivityMatchesTab,
  mentorActivityRowState,
  mentorActivityStateDetail,
  mentorActivityStateLabel,
  mentorActivityStateTone,
  mentorUnansweredElapsed,
  mentorUnansweredToneClass,
  resolveMentorActivityTab,
  resolveMentorLastActivity,
  type MentorActivityListItem,
} from "../mentorActivityConsole.ts";

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const PAGE = "app/(admin)/admin/(console)/mentor-activity/page.tsx";
const LOADING = "app/(admin)/admin/(console)/mentor-activity/loading.tsx";
const LIST = "components/admin/MentorActivityList.tsx";
const ACTIONS_UI = "components/admin/MentorActivityActionButtons.tsx";
const CONSOLE = "lib/admin/mentorActivityConsole.ts";
const QUERIES = "lib/admin/mentorActivityQueries.ts";
const SERVER_ACTIONS = "lib/admin/mentorActivityAdminActions.ts";

function walk(dir: string, out: string[]) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

function spFrom(url: string): Record<string, string | string[] | undefined> {
  const u = new URL(url, "https://ssambership.local");
  const sp: Record<string, string | string[] | undefined> = {};
  for (const [k, v] of u.searchParams.entries()) sp[k] = v;
  return sp;
}

const OPTS = { defaultPageSize: MENTOR_ACTIVITY_DEFAULT_PAGE_SIZE, defaultStatus: MENTOR_ACTIVITY_DEFAULT_TAB };
const NOW = Date.parse("2026-09-03T06:00:00Z");
const HOUR = 3_600_000;
const at = (h: number) => new Date(NOW - h * HOUR).toISOString();

function item(over: Partial<MentorActivityListItem> = {}): MentorActivityListItem {
  return {
    mentorId: "m",
    name: "멘토",
    email: null,
    studentCount: 0,
    unansweredCount: 0,
    oldestUnansweredAt: null,
    elapsed: mentorUnansweredElapsed(null, NOW),
    state: "active",
    activityStatusRaw: "active",
    pauseUntil: null,
    terminationEffectiveAt: null,
    abandonmentFlaggedAt: null,
    lastActivityAt: null,
    lastActivitySource: null,
    pendingEvents: [],
    ...over,
  };
}

// ── 탭 · 상태 ───────────────────────────────────────────────────────────────

test("탭은 활동 중·일시정지·종료 예정·이탈 의심·전체 5개(라벨은 계정 상세 멘토 탭 사전) · 기본 전체 · 이탈 의심 = abandonment_flagged_at IS NOT NULL", () => {
  assert.deepEqual([...MENTOR_ACTIVITY_TAB_VALUES], ["active", "paused", "terminating", "abandoned", "all"]);
  assert.deepEqual(MENTOR_ACTIVITY_TABS.map((t) => t.label), [MENTOR_ACTIVITY_LABELS.active, MENTOR_ACTIVITY_LABELS.paused, MENTOR_ACTIVITY_LABELS.terminating, "이탈 의심", "전체"]);
  assert.equal(MENTOR_ACTIVITY_DEFAULT_TAB, "all");
  assert.equal(resolveMentorActivityTab("abandoned"), "abandoned");
  assert.equal(resolveMentorActivityTab("terminated"), "all", "종료는 탭이 아니다(전체에서 배지)");
  assert.equal(mentorActivityMatchesTab("abandoned", "active", at(1)), true);
  assert.equal(mentorActivityMatchesTab("abandoned", "terminated", null), false);
  assert.equal(mentorActivityMatchesTab("paused", "paused", null), true);
  assert.equal(mentorActivityMatchesTab("active", "paused", null), false);
  assert.equal(mentorActivityMatchesTab("all", "terminated", null), true);
  const p = parseAdminListParams(spFrom(`${MENTOR_ACTIVITY_BASE_PATH}?status=all&page=2`), OPTS);
  assert.ok(buildMentorActivityListUrl(p, {}).includes("status=all"));
  assert.equal(buildMentorActivityListUrl(p, { status: "abandoned" }), buildAdminDataTableUrl(MENTOR_ACTIVITY_BASE_PATH, p, { status: "abandoned" }));
});

test("활동 상태 사전: 활동 중 · 일시정지(pause_until 까지 — 지나면 활동 중) · 종료 예정(termination_effective_at) · 종료 — 판정은 lib/mentor/mentorActivity 그대로", () => {
  const now = new Date(NOW);
  assert.equal(mentorActivityRowState({ activityStatus: "active", pauseUntil: null, terminationEffectiveAt: null }, now), "active");
  assert.equal(mentorActivityRowState({ activityStatus: "paused", pauseUntil: at(-24), terminationEffectiveAt: null }, now), "paused");
  assert.equal(mentorActivityRowState({ activityStatus: "paused", pauseUntil: at(1), terminationEffectiveAt: null }, now), "active", "복귀 예정일 경과 → 활동 중");
  assert.equal(mentorActivityRowState({ activityStatus: "terminating", pauseUntil: null, terminationEffectiveAt: at(-48) }, now), "terminating");
  assert.equal(mentorActivityRowState({ activityStatus: "terminated", pauseUntil: null, terminationEffectiveAt: null }, now), "terminated");
  assert.deepEqual(["active", "paused", "terminating", "terminated"].map((s) => mentorActivityStateLabel(s as "active")), ["활동 중", "일시정지", "종료 예정", "종료"]);
  assert.deepEqual(["active", "paused", "terminating", "terminated"].map((s) => mentorActivityStateTone(s as "active")), ["success", "warning", "danger", "neutral"]);
  const fmt = (iso: string | null) => (iso ? "D" : "—");
  assert.equal(mentorActivityStateDetail({ state: "paused", pauseUntil: at(-1), terminationEffectiveAt: null }, fmt), "복귀 예정 D");
  assert.equal(mentorActivityStateDetail({ state: "terminating", pauseUntil: null, terminationEffectiveAt: at(-1) }, fmt), "종료 예정 D");
  assert.equal(mentorActivityStateDetail({ state: "terminated", pauseUntil: null, terminationEffectiveAt: null }, fmt), "활동 종료");
  assert.equal(mentorActivityStateDetail({ state: "active", pauseUntil: null, terminationEffectiveAt: null }, fmt), "");
});

// ── 미답변 경보 · 정렬 ──────────────────────────────────────────────────────

test("최장 미답변: 24시간 초과 주의 · 48시간 초과 위험(정각은 아직 아님) · 없으면 — · 톤 클래스", () => {
  assert.equal(MENTOR_UNANSWERED_WARNING_HOURS, 24);
  assert.equal(MENTOR_UNANSWERED_DANGER_HOURS, 48);
  assert.deepEqual(mentorUnansweredElapsed(at(0.5), NOW), { hours: 0, label: "1시간 미만", tone: "ok" });
  assert.deepEqual(mentorUnansweredElapsed(at(24), NOW), { hours: 24, label: "1일", tone: "ok" });
  assert.deepEqual(mentorUnansweredElapsed(at(24.5), NOW), { hours: 24, label: "1일", tone: "warning" });
  assert.deepEqual(mentorUnansweredElapsed(at(48), NOW), { hours: 48, label: "2일", tone: "warning" });
  assert.deepEqual(mentorUnansweredElapsed(at(49), NOW), { hours: 49, label: "2일 1시간", tone: "danger" });
  assert.deepEqual(mentorUnansweredElapsed(null, NOW), { hours: null, label: "—", tone: "none" });
  assert.ok(mentorUnansweredToneClass("danger").includes("red") && mentorUnansweredToneClass("warning").includes("amber"));
  assert.ok(!mentorUnansweredToneClass("ok").includes("red") && !mentorUnansweredToneClass("ok").includes("amber"));
});

test("정렬: 가장 오래된 미답변이 있는 멘토가 위(오래된 순) → 미답변 건수 많은 순 → 이탈 의심 → 이름 · 최근 활동은 마지막 답변 우선", () => {
  const old = item({ mentorId: "a", name: "가", oldestUnansweredAt: at(72), unansweredCount: 1 });
  const recent = item({ mentorId: "b", name: "나", oldestUnansweredAt: at(2), unansweredCount: 5 });
  const none = item({ mentorId: "c", name: "다" });
  const flagged = item({ mentorId: "d", name: "라", abandonmentFlaggedAt: at(1) });
  const many = item({ mentorId: "e", name: "마", oldestUnansweredAt: at(2), unansweredCount: 9 });
  const sorted = [none, recent, flagged, old, many].sort(compareMentorActivityItems).map((i) => i.mentorId);
  assert.deepEqual(sorted, ["a", "e", "b", "d", "c"]);
  assert.deepEqual(resolveMentorLastActivity(at(3), at(1)), { at: at(3), source: "answer" });
  assert.deepEqual(resolveMentorLastActivity(null, at(1)), { at: at(1), source: "profile" });
  assert.deepEqual(resolveMentorLastActivity("bad", null), { at: null, source: null });
  assert.equal(MENTOR_ACTIVITY_ROW_LIMIT, 500);
});

// ── 조치 — §0-C 기존 3경로만 ───────────────────────────────────────────────

test("§0-C: 관리자 서버 액션은 보류 확정·구제·유예 만료 정리 3개뿐 — 알림 보내기·활동 강제 정지 경로 없음(만들지 않았다) · 등급: stateChange 1 · critical 2 · 필드명", () => {
  const actions = stripComments(read(SERVER_ACTIONS));
  const exported = [...actions.matchAll(/export async function (\w+)\(/g)].map((m) => m[1]).sort();
  assert.deepEqual(exported, ["approveMentorAbandonmentHoldAction", "finalizeMentorTerminationAdminAction", "releaseMentorSettlementHoldAction"]);
  const adminSrc = walk(join(ROOT, "lib", "admin"), []).filter((f) => !f.includes("__contract__")).map((f) => stripComments(readFileSync(f, "utf8"))).join("\n");
  assert.ok(!adminSrc.includes("record_domain_notification") && !adminSrc.includes("startMentorPause(") && !adminSrc.includes("flagMentorAbandonment("), "관리자 모듈에 알림·강제 정지 경로 없음");
  assert.equal((actions.match(/const reason = textFromForm\(formData\.get\("reason"\)\);/g) ?? []).length, 3, "세 액션이 사유를 읽어 감사 로그 detail 에 싣는다");
  assert.equal((actions.match(/reason: reason \|\| null/g) ?? []).length, 3);
  assert.deepEqual(Object.keys(MENTOR_ACTIVITY_ACTIONS), ["hold_approve", "hold_release", "termination_finalize"]);
  assert.equal(MENTOR_ACTIVITY_ACTIONS.hold_approve.level, "stateChange");
  assert.equal(MENTOR_ACTIVITY_ACTIONS.hold_release.level, "critical", "정산 항목 복원 = 자금 조치");
  assert.equal(MENTOR_ACTIVITY_ACTIONS.termination_finalize.level, "critical", "환불 생성 = 자금 조치");
  assert.equal(resolveAdminConfirmRequirements({ level: "critical" }).reasonRequired, true);
  assert.equal(MENTOR_ACTIVITY_EVENT_ID_FIELD, "eventId");
  assert.equal(MENTOR_ACTIVITY_MENTOR_ID_FIELD, "mentorId");
  assert.equal(MENTOR_ACTIVITY_REASON_FIELD, "reason");
  assert.ok(MENTOR_ACTIVITY_MISSING_ACTIONS_NOTE.includes("알림 보내기") && MENTOR_ACTIVITY_MISSING_ACTIONS_NOTE.includes("활동 강제 정지"));
});

test("행별 가능한 조치: 검토 대기 이탈 이벤트 → 보류 확정·구제(이벤트 id) · 종료 예정 + 유예 만료 → 정리 · 유예 전·활동 중은 없음", () => {
  const ev = { id: "ev1", eventType: "abandonment_suspected", reason: null, createdAt: null };
  assert.deepEqual(mentorActivityAvailableActions(item({ pendingEvents: [ev] }), NOW), [
    { key: "hold_approve", eventId: "ev1" },
    { key: "hold_release", eventId: "ev1" },
  ]);
  assert.deepEqual(mentorActivityAvailableActions(item({ pendingEvents: [{ ...ev, eventType: "pause_started" }] }), NOW), [], "질병 휴식 검토 이벤트는 조치 경로가 없다");
  assert.deepEqual(mentorActivityAvailableActions(item({ state: "terminating", terminationEffectiveAt: at(1) }), NOW), [{ key: "termination_finalize", eventId: null }]);
  assert.deepEqual(mentorActivityAvailableActions(item({ state: "terminating", terminationEffectiveAt: at(-1) }), NOW), [], "유예 만료 전에는 서비스가 거절하므로 버튼도 없다");
  assert.deepEqual(mentorActivityAvailableActions(item(), NOW), []);
  assert.equal(mentorActivityAccountUrl("m1"), "/admin/users/m1?tab=mentor");
});

// ── 빈 상태 ─────────────────────────────────────────────────────────────────

test("빈 상태: 전체 '등록된 멘토가 없습니다' · 탭별 문구(이탈 의심 멘토가 없습니다 등) · 검색 중은 검색 안내", () => {
  assert.equal(MENTOR_ACTIVITY_EMPTY_STATES.all.title, "등록된 멘토가 없습니다");
  assert.equal(MENTOR_ACTIVITY_EMPTY_STATES.abandoned.title, "이탈 의심 멘토가 없습니다");
  assert.equal(MENTOR_ACTIVITY_EMPTY_STATES.paused.title, "일시정지 중인 멘토가 없습니다");
  assert.equal(mentorActivityEmptyState("terminating", "").title, "종료 예정인 멘토가 없습니다");
  assert.equal(mentorActivityEmptyState("all", "김").title, "조건에 맞는 멘토가 없습니다");
});

// ── tripwire ────────────────────────────────────────────────────────────────

test("페이지: PageScaffold 미사용 · AdminPageLayout · 기본 탭 상수로 파싱 · 누락 조치 안내 · loading.tsx", () => {
  const page = stripComments(read(PAGE));
  assert.ok(!page.includes("PageScaffold") && !page.includes("loadMentorActivityEvents"));
  assert.ok(page.includes("<AdminPageLayout") && page.includes("<MentorActivityList"));
  assert.ok(page.includes("parseAdminListParams(sp, { defaultPageSize: MENTOR_ACTIVITY_DEFAULT_PAGE_SIZE, defaultStatus: MENTOR_ACTIVITY_DEFAULT_TAB })") && page.includes("resolveMentorActivityTab(rawParams.status)"));
  assert.ok(page.includes("MENTOR_ACTIVITY_MISSING_ACTIONS_NOTE"));
  assert.ok(page.includes("처리 실패 —"));
  assert.ok(existsSync(join(ROOT, LOADING)));
});

test("목록 부품: Server Component · 공용 탭·페이지네이션 · hidden status 는 기본 탭이 아닐 때만 · 컬럼 7 · 미답변 톤 · 이탈 배지 · 계정 상세(멘토 탭) 링크 · 행 조치 부품", () => {
  const src = stripComments(read(LIST));
  assert.ok(!src.startsWith('"use client"'));
  assert.ok(src.includes("<AdminDataTable.Tabs") && src.includes("<AdminDataTable.Pagination"));
  assert.ok(!src.includes('aria-label="상태 탭"') && !src.includes("← 이전"));
  assert.ok(src.includes('{tab !== MENTOR_ACTIVITY_DEFAULT_TAB ? <input type="hidden" name="status" value={tab} /> : null}') && !/tab !== "(all|pending)"/.test(src));
  assert.ok(src.includes('name="q"') && src.includes('role="search"'));
  for (const col of [">멘토</th>", ">담당 학생</th>", ">미답변</th>", ">최장 미답변</th>", ">활동 상태</th>", ">최근 활동</th>", ">조치</th>"]) assert.ok(src.includes(col), col);
  assert.ok(src.includes("mentorUnansweredToneClass(item.elapsed.tone)") && src.includes("data-unanswered-tone"));
  assert.ok(src.includes("mentorActivityAccountUrl(item.mentorId)") && src.includes("이탈 의심 ·"));
  assert.ok(src.includes("<MentorActivityActionButtons item={item} now={now} />"));
  assert.ok(src.includes("mentorActivityEmptyState(tab, params.search)"));
  assert.equal((src.match(/<form\b/g) ?? []).length, 1, "목록 자체 폼은 GET 검색 form 하나");
});

test("조치 부품: 기존 3액션만 import · ConfirmSubmitButton 3(stateChange 1 · critical 2) · critical 은 사유 필드(reason) · 필드명 상수 · 자체 모달 없음", () => {
  const src = stripComments(read(ACTIONS_UI));
  assert.ok(!src.startsWith('"use client"'));
  assert.equal((src.match(/<ConfirmSubmitButton\b/g) ?? []).length, 3);
  assert.equal((src.match(/level="stateChange"/g) ?? []).length, 1);
  assert.equal((src.match(/level="critical"/g) ?? []).length, 2);
  assert.ok(!/level="(destructive|immediate)"/.test(src));
  assert.equal((src.match(/reasonFieldName=\{MENTOR_ACTIVITY_REASON_FIELD\}/g) ?? []).length, 2, "자금 조치 2종은 사유가 감사 로그에");
  for (const fn of ["approveMentorAbandonmentHoldAction", "releaseMentorSettlementHoldAction", "finalizeMentorTerminationAdminAction"]) assert.ok(src.includes(`action={${fn}}`), fn);
  assert.ok(!/record_domain_notification|startMentorPause|flagMentorAbandonment|suspend/.test(src), "알림·강제 정지 없음");
  assert.ok(src.includes("name={MENTOR_ACTIVITY_EVENT_ID_FIELD}") && src.includes("name={MENTOR_ACTIVITY_MENTOR_ID_FIELD}"));
  assert.ok(src.includes("mentorActivityAvailableActions(item, now)") && !src.includes("AdminConfirmDialog"));
});

test("조회 모듈: 승인 멘토 · 미답변 = first_answered_at IS NULL · 검토 대기 이벤트 · 메모리 정렬(compareMentorActivityItems) · 조회 전용 · 구 이벤트 조회 삭제", () => {
  const q = stripComments(read(QUERIES));
  assert.ok(q.includes('.eq("verification_status", "approved")') && q.includes(".limit(MENTOR_ACTIVITY_ROW_LIMIT)"));
  assert.ok(q.includes('.is("first_answered_at", null)') && q.includes('.not("first_answered_at", "is", null)'));
  assert.ok(q.includes('.eq("status", "pending_review")'));
  assert.ok(q.includes(".sort(compareMentorActivityItems)"), "미답변 오래된 순");
  assert.ok(!/\.(insert|update|upsert|delete|rpc)\(/.test(q), "조회 전용");
  assert.ok(!q.includes("export async function loadMentorActivityEvents") && !q.includes("countMentorActivityPendingReview"), "호출자 없는 구 이벤트 조회 삭제");
  const pure = stripComments(read(CONSOLE));
  assert.ok(!/from "react"|from "@\//.test(pure), "순수 모듈은 React·@/ import 없음");
});

test("UI 카피 금지어 없음(선생님·강사님·수강생·과외·alert)", () => {
  for (const rel of [PAGE, LIST, ACTIONS_UI, CONSOLE, QUERIES]) {
    const code = stripComments(read(rel));
    for (const banned of ["선생님", "강사님", "수강생", "과외", "커패니티", "웰버십", "쌤버쉽", "alert("]) {
      assert.ok(!code.includes(banned), `${rel}: 금지 문구 ${banned}`);
    }
  }
});
