// 계약 테스트: 멘토 승인 작업대 PR-2b — 보류 · 동시 심사 표시 · 승인 취소(지시서 §4 검증 항목).
// 실행: node --test --experimental-strip-types lib/admin/__contract__/mentorApprovalHold.contract.test.ts
//
//   ① on_hold 소비처 전수(§1-1): 상태 사전 등재 · 대기 집합·결정 가능 집합·자동 이동 밖 · 공개 노출 판정(긍정 조건) · 멘토 화면 라벨(보류라는 말 없음)
//   ② 보류: 메모 없이 제출 불가(서버 검사) · 감사 로그 · 멘토 알림 0 · 보류 해제 → pending
//   ③ 동시 심사: presence 페이로드 형태 · 배지 문구 · DB 쓰기 0 · 잠금 없음
//   ④ 승인 취소: critical · 활성 구독 시 비활성(fail-closed) · 학교 인증·요금제 행 불변 · 감사 로그
//   ⑤ 오늘 처리 목록: 건수 = 감사 로그 집계 · 되돌리기 종류 · 새 쓰기 경로 2개(보류 모듈 · 승인 취소 모듈)

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ADMIN_ACTION_TYPE_LABELS, adminActionLabel } from "../adminActionTypeLabels.ts";
import { adminStatusAllowedValues, resolveAdminStatus } from "../adminStatusDictionary.ts";
import { MENTOR_PENDING_STATUS_VALUES_FOR_IN } from "../mentorApprovalConstants.ts";
import { MENTOR_APPROVAL_DIALOG_ONLY_ACTIONS, MENTOR_DECISION_ACTION_TYPES, mentorDecisionResultLabel, resolveMentorApprovalShortcut } from "../mentorApprovalDecision.ts";
import {
  ALREADY_PROCESSED_PARAM_MAX_LENGTH,
  MENTOR_APPROVAL_HISTORY_ACTION_TYPES,
  MENTOR_APPROVAL_REVOKED_ACTION_TYPE,
  MENTOR_HOLD_ACTION_TYPE,
  MENTOR_HOLD_BUTTON_IDS,
  MENTOR_HOLD_MENTOR_FACING_LABEL,
  MENTOR_HOLD_REASON_FIELD,
  MENTOR_HOLD_REASON_PRESETS,
  MENTOR_HOLD_RELEASE_ACTION_TYPE,
  MENTOR_HOLD_RELEASE_TARGET_STATUS,
  MENTOR_HOLD_STATUS,
  MENTOR_REJECTION_REVERTED_ACTION_TYPE,
  MENTOR_REVOKE_REASON_FIELD,
  REVOKE_BLOCKING_SUBSCRIPTION_STATUSES,
  REVOKE_INDETERMINATE_MESSAGE,
  buildAlreadyProcessedText,
  buildMentorHoldSummary,
  buildMentorRevokeSummary,
  formatKstShortDateTime,
  formatMentorDecisionsTodayHeading,
  isMentorApprovalRevoked,
  isMentorOnHold,
  mentorApprovalHistoryLabel,
  mentorDecisionUndoKind,
  revokeBlockedMessage,
  sanitizeAlreadyProcessedParam,
  summarizeMentorDecisionsToday,
} from "../mentorApprovalHold.ts";
import {
  MENTOR_APPROVAL_PRESENCE_CHANNEL,
  buildPresencePayload,
  flattenPresenceState,
  formatPresenceSinceAgo,
  parsePresencePayload,
  presenceConfirmLine,
  presenceDetailNotice,
  presenceListBadgeLabel,
  viewersOfMentor,
} from "../mentorApprovalPresence.ts";
import {
  MENTOR_APPROVAL_HOLD_STATUSES,
  MENTOR_APPROVAL_PENDING_TAB_STATUSES,
  MENTOR_APPROVAL_TABS,
  isMentorApprovalDecidable,
  isMentorApprovalPendingTabStatus,
  mentorApprovalTabStatuses,
} from "../mentorApprovalQueue.ts";

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const HOLD_ACTIONS = "lib/admin/mentorApprovalHoldActions.ts";
const REVOKE_ACTIONS = "lib/admin/mentorApprovalRevokeActions.ts";
const TRANSITION = "lib/admin/mentorProfileStatusTransition.ts";
const URLS = "lib/admin/mentorApprovalActionUrls.ts";
const DECISION_ACTIONS = "lib/admin/mentorApprovalActions.ts";
const QUERIES = "lib/admin/mentorApprovalWorkbenchQueries.ts";
const PAGE = "app/(admin)/admin/(console)/mentor-approval/page.tsx";
const PANEL = "components/admin/MentorApprovalReviewPanel.tsx";
const LIST = "components/admin/MentorApprovalQueueList.tsx";
const DECISION_BAR = "components/admin/MentorApprovalDecisionBar.tsx";
const HOLD_BAR = "components/admin/MentorApprovalHoldBar.tsx";
const CONTROLS = "components/admin/MentorApprovalStatusControls.tsx";
const PROVIDER = "components/admin/MentorApprovalPresenceProvider.tsx";
const PRESENCE_BADGE = "components/admin/MentorApprovalPresenceBadge.tsx";
const PRESENCE_NOTICE = "components/admin/MentorApprovalPresenceNotice.tsx";
const TODAY = "components/admin/MentorApprovalTodayPanel.tsx";
const SHORTCUTS = "components/admin/MentorApprovalShortcuts.tsx";

function walk(dir: string, out: string[]): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next" || name.startsWith(".")) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

// ── ① on_hold 소비처 전수 ────────────────────────────────────────────────────

test("on_hold: 상태 사전에 등재(라벨 보류) · 값 상수 일치 · 탭 값·라벨", () => {
  assert.equal(MENTOR_HOLD_STATUS, "on_hold");
  assert.ok(adminStatusAllowedValues("mentor_profiles", "verification_status").includes("on_hold"));
  const r = resolveAdminStatus("mentor_profiles", "verification_status", "on_hold");
  assert.equal(r.known, true);
  assert.equal(r.label, "보류");
  assert.deepEqual([...MENTOR_APPROVAL_HOLD_STATUSES], ["on_hold"]);
  assert.deepEqual(mentorApprovalTabStatuses("on_hold"), ["on_hold"]);
  assert.deepEqual(MENTOR_APPROVAL_TABS.find((t) => t.value === "on_hold"), { value: "on_hold", label: "보류" });
  assert.equal(isMentorOnHold("on_hold"), true);
  assert.equal(isMentorOnHold(" on_hold "), true);
  assert.equal(isMentorOnHold("pending"), false);
});

test("on_hold: 대기 집합·결정 가능 집합·대기 탭·자동 이동(다음 대기 건) 전부 밖 — 대시보드 대기 건수(pending 탭 집합)에서도 빠진다(H1 불변)", () => {
  assert.ok(!MENTOR_PENDING_STATUS_VALUES_FOR_IN.includes("on_hold"), "액션 .in 집합 밖");
  assert.ok(!MENTOR_APPROVAL_PENDING_TAB_STATUSES.includes("on_hold"), "대기 탭 밖");
  assert.equal(isMentorApprovalDecidable("on_hold"), false, "보류 건은 결정 불가 — 해제 뒤 결정");
  assert.equal(isMentorApprovalPendingTabStatus("on_hold"), false, "다음 대기 건 이동이 건너뛴다");
  assert.ok(!(mentorApprovalTabStatuses("pending") ?? []).includes("on_hold"), "대시보드 승인 대기 = pending 탭 집합(countMentorApprovalTabs)");
  const dashboard = stripComments(read("lib/admin/adminDashboardQueries.ts"));
  assert.ok(dashboard.includes("countMentorApprovalTabs(supabase)") && dashboard.includes("mentorApproval: { pending: mentorApproval.pending }"), "대시보드 대기 건수는 pending 탭 값");
  const page = stripComments(read(PAGE));
  assert.ok(page.includes("isMentorApprovalPendingTabStatus(r.status)"), "다음 대기 건 판정은 대기 탭 집합");
});

test("on_hold: 공개 노출 판정은 전부 긍정 조건(approved·verified·active) — 보류 멘토는 목록·상세·개별질문·디렉터리 뷰 어디에도 나오지 않는다", () => {
  const gate = stripComments(read("lib/mentor/mentorVerificationGate.ts"));
  assert.ok(gate.includes('new Set(["approved", "verified", "active"])'), "mentorVerificationStatusAllowsActivity 긍정 집합");
  assert.ok(!gate.includes("on_hold") && !gate.includes("!== \"rejected\""), "부정 조건 없음");
  for (const rel of [
    "lib/mentor/publicMentorsListQueries.ts",
    "app/(public)/mentors/[mentorId]/page.tsx",
    "app/(student)/mentors/[mentorId]/individual-question/new/page.tsx",
    "app/(student)/individual-questions/direct/[mentorId]/page.tsx",
  ]) {
    assert.ok(stripComments(read(rel)).includes("mentorVerificationStatusAllowsActivity("), `${rel}: 긍정 게이트 사용`);
  }
  // DB 뷰·RPC 도 긍정 조건이다(mentor_directory_v1 · individual_question_user_is_approved_mentor).
  assert.ok(read("supabase/sql/20260730095441_api_web_v1_read_views.sql").includes("IN ('approved', 'verified', 'active')"));
  assert.ok(read("supabase/sql/070_individual_question_schema_escrow.sql").includes("in ('approved', 'verified', 'active')"));
  // 승인 전용 관리자 집계(멘토 활동 · 분류 관리 · 대시보드 계좌 미등록)는 .eq("approved") — 보류가 섞이지 않는다.
  for (const rel of ["lib/admin/mentorActivityQueries.ts", "lib/admin/schoolClassificationQueries.ts", "lib/admin/adminDashboardQueries.ts"]) {
    assert.ok(stripComments(read(rel)).includes('.eq("verification_status", "approved")'), rel);
  }
});

test("on_hold: 멘토 쪽 화면은 '검토 중' — 보류라는 말을 멘토에게 쓰지 않는다(mentorVerificationKo · 마이페이지 · 프로필 편집)", () => {
  assert.equal(MENTOR_HOLD_MENTOR_FACING_LABEL, "검토 중");
  const fields = stripComments(read("lib/mentor/mentorDisplayFields.ts"));
  assert.ok(fields.includes('on_hold: "검토 중"'), "mentorVerificationKo(on_hold) = 검토 중(프로필 편집 폼이 쓴다)");
  const mypage = stripComments(read("app/(mentor)/mentor/mypage/page.tsx"));
  assert.ok(/s === "on_hold"\) return \{ label: "인증 검토중", tone: "pending" \}/.test(mypage), "마이페이지 verificationLabel(on_hold) = 인증 검토중");
  for (const rel of ["lib/mentor/mentorDisplayFields.ts", "app/(mentor)/mentor/mypage/page.tsx", "components/mentor/MentorProfileEditForm.tsx"]) {
    const code = stripComments(read(rel));
    assert.ok(!/["'`>][^"'`<\n]*보류/.test(code), `${rel}: 멘토에게 보이는 문구에 '보류' 없음`);
  }
});

test("on_hold: 관리자 화면(계정 목록·계정 상세 헤더·승인 목록·심사 패널)은 상태 사전 배지를 쓴다 → 보류 라벨로 안전하게 렌더", () => {
  for (const rel of ["components/admin/AccountListTable.tsx", "components/admin/AccountDetailHeader.tsx", LIST, PANEL]) {
    assert.ok(stripComments(read(rel)).includes('<AdminStatusPill table="mentor_profiles" column="verification_status"'), rel);
  }
});

// ── ② 보류 ───────────────────────────────────────────────────────────────────

test("보류 액션: requireRole 첫 줄 · 메모 없이 제출 불가(서버 검사) · 결정 가능 집합 → on_hold · 감사 로그 mentor_hold(note·reason) · 멘토 알림 0 · admin_case_notes 미사용", () => {
  const src = read(HOLD_ACTIONS);
  const code = stripComments(src);
  assert.ok(src.startsWith('"use server"'));
  const fns = code.match(/export async function \w+\(formData: FormData\) \{\n  const \{ user \} = await requireRole\("admin"\);/g) ?? [];
  assert.equal(fns.length, 2, "보류 · 보류 해제 모두 requireRole(admin) 첫 줄");
  assert.ok(code.includes("formData.get(MENTOR_HOLD_REASON_FIELD)") && MENTOR_HOLD_REASON_FIELD === "holdNote");
  assert.ok(code.includes("if (note.length < ADMIN_CONFIRM_REASON_MIN_LENGTH) redirect("), "메모 필수 — 모달을 우회한 제출도 서버가 막는다");
  assert.ok(code.includes("transitionMentorVerificationStatus(mentorUserId, MENTOR_PENDING_STATUS_VALUES_FOR_IN, MENTOR_HOLD_STATUS)"), "결정 가능 집합 → on_hold");
  assert.ok(code.includes('actionType: "mentor_hold"') && code.includes("detail: { note, reason: note }"), "감사 로그(메모는 note·reason)");
  assert.ok(code.includes("transitionMentorVerificationStatus(mentorUserId, [MENTOR_HOLD_STATUS], MENTOR_HOLD_RELEASE_TARGET_STATUS)"), "해제: on_hold → pending");
  assert.equal(MENTOR_HOLD_RELEASE_TARGET_STATUS, "pending");
  assert.ok(code.includes('actionType: "mentor_hold_release"'));
  assert.ok(!/notif|record_domain_notification|sendMail|push/i.test(code), "멘토 알림 0");
  assert.ok(!code.includes("admin_case_notes") && !code.includes("insertAdminCaseNote"), "admin_case_notes 는 CHECK(dispute_id·report_id) 때문에 쓰지 않는다");
  assert.ok(code.includes('mentorApprovalOkUrl("hold")') && code.includes('mentorApprovalOkUrl("hold-release", mentorUserId)'), "보류는 다음 건 이동 · 해제는 같은 지원자 선택 유지");
  assert.equal(MENTOR_HOLD_ACTION_TYPE, "mentor_hold");
  assert.equal(MENTOR_HOLD_RELEASE_ACTION_TYPE, "mentor_hold_release");
});

test("보류 화면: 프리셋 3종 + 직접 입력 · stateChange + reasonRequired · H 단축키는 보류 버튼 id 를 click(모달만) · 보류 건은 배너 + 보류 해제만(결정 바 없음)", () => {
  assert.deepEqual([...MENTOR_HOLD_REASON_PRESETS], ["서류 재확인 필요", "학교 확인 필요", "동업자 상의"]);
  const bar = stripComments(read(HOLD_BAR));
  assert.ok(read(HOLD_BAR).startsWith('"use client"'));
  assert.ok(bar.includes('level="stateChange"') && bar.includes("reasonRequired") && bar.includes("reasonPresets={MENTOR_HOLD_REASON_PRESETS}"));
  assert.ok(bar.includes("id={MENTOR_HOLD_BUTTON_IDS.hold}") && bar.includes("holdMentorApplicationAction"));
  assert.ok(!/AdminConfirmDialog|role="dialog"|alert\(/.test(bar), "자체 모달 금지 — PR-1 부품만");
  assert.equal(resolveMentorApprovalShortcut("H"), "openHold");
  assert.ok(MENTOR_APPROVAL_DIALOG_ONLY_ACTIONS.includes("openHold"));
  const shortcuts = stripComments(read(SHORTCUTS));
  assert.ok(shortcuts.includes("openDecisionDialog(MENTOR_HOLD_BUTTON_IDS.hold)"), "H → 보류 버튼 click");
  assert.equal(MENTOR_HOLD_BUTTON_IDS.hold, "mentor-approval-decision-hold");
  const panel = stripComments(read(PANEL));
  assert.ok(panel.includes("<MentorApprovalHoldBar") && panel.includes("{detail.hold ? (") && panel.includes("data-hold-banner"), "보류 배너(메모·관리자·시각)");
  assert.ok(panel.includes("<MentorHoldReleaseButton") && panel.includes("멘토에게는 알리지 않았습니다"));
  assert.ok(panel.includes("buildMentorHoldSummary(detail.displayName)"));
  assert.ok(buildMentorHoldSummary("김서연").includes("멘토에게는 알리지 않습니다"));
});

// ── ③ 동시 심사(Presence) ───────────────────────────────────────────────────

test("presence 페이로드: { adminId, adminName, mentorId, since } — 형태가 다르면 무시 · 나는 제외 · 같은 관리자 여러 탭은 하나 · 먼저 연 사람이 앞", () => {
  assert.equal(MENTOR_APPROVAL_PRESENCE_CHANNEL, "admin:mentor-approval");
  const p = buildPresencePayload({ adminId: " a1 ", adminName: "", mentorId: "m1", since: "2026-09-03T05:00:00Z" });
  assert.deepEqual(p, { adminId: "a1", adminName: "관리자", mentorId: "m1", since: "2026-09-03T05:00:00Z" });
  assert.deepEqual(Object.keys(p).sort(), ["adminId", "adminName", "mentorId", "since"], "PII 없음 — 표시명·지원자 id·시각만");
  assert.equal(parsePresencePayload({ adminId: "a", mentorId: "m", since: "not-a-date" }), null);
  assert.equal(parsePresencePayload({ foo: 1 }), null);
  assert.equal(parsePresencePayload(null), null);
  const state = {
    a1: [{ presence_ref: "x", adminId: "a1", adminName: "박운영", mentorId: "m1", since: "2026-09-03T05:03:00Z" }, { presence_ref: "y", adminId: "a1", adminName: "박운영", mentorId: "m1", since: "2026-09-03T05:01:00Z" }],
    me: [{ presence_ref: "z", adminId: "me", adminName: "나", mentorId: "m1", since: "2026-09-03T05:00:00Z" }],
    a2: [{ presence_ref: "w", adminId: "a2", adminName: "이운영", mentorId: "m2", since: "2026-09-03T05:02:00Z" }, { presence_ref: "bad" }],
  };
  const viewers = flattenPresenceState(state, "me");
  assert.deepEqual(viewers.map((v) => [v.adminId, v.mentorId, v.since]), [
    ["a1", "m1", "2026-09-03T05:01:00Z"],
    ["a2", "m2", "2026-09-03T05:02:00Z"],
  ]);
  assert.equal(viewersOfMentor(viewers, "m1").length, 1);
  assert.equal(viewersOfMentor(viewers, "").length, 0);
});

test("presence 문구: 목록 배지 `박운영 심사 중` · 상세 `박운영님이 3분 전부터 보고 있습니다` · 확인 모달 `박운영님도 이 지원자를 보고 있습니다` · 둘 이상은 `외 N명`", () => {
  const now = Date.parse("2026-09-03T05:04:00Z");
  const one = [{ adminId: "a1", adminName: "박운영", mentorId: "m1", since: "2026-09-03T05:01:00Z" }];
  assert.equal(presenceListBadgeLabel(one), "박운영 심사 중");
  assert.equal(presenceDetailNotice(one, now), "박운영님이 3분 전부터 보고 있습니다");
  assert.equal(presenceConfirmLine(one), "박운영님도 이 지원자를 보고 있습니다");
  const two = [...one, { adminId: "a2", adminName: "이운영", mentorId: "m1", since: "2026-09-03T05:03:00Z" }];
  assert.equal(presenceListBadgeLabel(two), "박운영 외 1명 심사 중");
  assert.equal(presenceConfirmLine(two), "박운영님 외 1명도 이 지원자를 보고 있습니다");
  assert.equal(presenceListBadgeLabel([]), null);
  assert.equal(presenceDetailNotice([], now), null);
  assert.equal(presenceConfirmLine([]), null);
  assert.equal(formatPresenceSinceAgo("2026-09-03T05:03:40Z", now), "방금 전");
  assert.equal(formatPresenceSinceAgo("2026-09-03T03:00:00Z", now), "2시간 전");
  assert.equal(formatPresenceSinceAgo("garbage", now), "방금 전");
});

test("presence 배선: Realtime 채널 track/untrack 만(DB 쓰기 0) · 구독 실패는 unavailable 로 조용히 · 배지·안내·확인 모달 한 줄 · 결정 버튼 잠금 없음", () => {
  const provider = stripComments(read(PROVIDER));
  assert.ok(read(PROVIDER).startsWith('"use client"'));
  assert.ok(provider.includes("supabase.channel(MENTOR_APPROVAL_PRESENCE_CHANNEL, { config: { presence: { key: adminId } } })"));
  assert.ok(provider.includes("channel.track(buildPresencePayload(") && provider.includes("channel.untrack()"));
  assert.ok(provider.includes('channel.on("presence", { event: "sync" }'));
  assert.ok(!/\.from\(|\.insert\(|\.update\(|\.upsert\(|\.rpc\(/.test(provider), "DB 쓰기·읽기 0 — Presence 만");
  assert.ok(provider.includes('setStatus("unavailable")'), "CHANNEL_ERROR·TIMED_OUT → 기능만 빠진다");
  assert.ok(provider.includes("supabase.removeChannel(channel)"), "언마운트 시 채널 정리");
  assert.ok(stripComments(read(PRESENCE_BADGE)).includes("presenceListBadgeLabel(viewersOfMentor(viewers, mentorId))"));
  assert.ok(stripComments(read(PRESENCE_NOTICE)).includes("presenceDetailNotice(viewersOfMentor(viewers, mentorId), now)"));
  assert.ok(stripComments(read(LIST)).includes("<MentorApprovalPresenceBadge mentorId={item.mentorUserId} />"), "목록 행 배지");
  assert.ok(stripComments(read(PANEL)).includes("<MentorApprovalPresenceNotice mentorId={detail.mentorUserId} />"), "상세 상단 안내");
  const decision = stripComments(read(DECISION_BAR));
  assert.equal((decision.match(/details=\{presenceDetails\}/g) ?? []).length, 3, "세 결정 모달 모두 동시 심사 한 줄");
  assert.ok(!/disabled=\{/.test(decision), "잠그지 않는다 — 결정 버튼은 그대로 활성");
  assert.ok(!/status === "unavailable"|viewers\.length/.test(decision), "presence 상태로 버튼을 가리지 않는다");
  const page = stripComments(read(PAGE));
  assert.ok(page.includes("<MentorApprovalPresenceProvider adminId={user.id} adminName={adminName} selectedMentorId={selectedId}>"), "페이지가 프로바이더로 감싼다");
});

test("이미 처리됨(§2-3): 게이트 거절 → `09-03 14:20 박운영 승인` 을 감사 로그에서 읽어 already 파라미터로 · 기존 결정 액션 3종 모두 이 경로", () => {
  assert.equal(formatKstShortDateTime("2026-09-03T05:20:00Z"), "09-03 14:20");
  assert.equal(buildAlreadyProcessedText({ createdAt: "2026-09-03T05:20:00Z", adminName: "박운영", actionType: "mentor_approve" }), "09-03 14:20 박운영 승인");
  assert.equal(buildAlreadyProcessedText({ createdAt: "2026-09-03T05:20:00Z", adminName: null, actionType: "mentor_hold" }), "09-03 14:20 관리자 미상 보류");
  assert.equal(sanitizeAlreadyProcessedParam("  a\nb  "), "a b");
  assert.equal(sanitizeAlreadyProcessedParam(""), null);
  assert.equal(sanitizeAlreadyProcessedParam("x".repeat(500))!.length, ALREADY_PROCESSED_PARAM_MAX_LENGTH);
  const actions = stripComments(read(DECISION_ACTIONS));
  assert.equal((actions.match(/redirect\(await mentorApprovalAlreadyProcessedUrl\(mentorUserId\)\)/g) ?? []).length, 3, "승인·반려·재제출 게이트 거절 3곳");
  assert.ok(actions.includes(".in(statusCol, pendingList)"), "게이트 자체는 그대로(PR-2 H1)");
  const urls = stripComments(read(URLS));
  assert.ok(urls.includes("describeMentorAlreadyProcessed(supabase, mentorUserId)") && urls.includes("q.set(ALREADY_PROCESSED_PARAM, text)"));
  const queries = stripComments(read(QUERIES));
  assert.ok(queries.includes(".in(\"action_type\", [...actionTypes])") && queries.includes("buildAlreadyProcessedText({"), "마지막 처리는 감사 로그");
  const page = stripComments(read(PAGE));
  assert.ok(page.includes("sanitizeAlreadyProcessedParam(sp[ALREADY_PROCESSED_PARAM])") && page.includes("{ALREADY_PROCESSED_PREFIX} — {alreadyText}"));
  assert.deepEqual([...MENTOR_APPROVAL_HISTORY_ACTION_TYPES], [...MENTOR_DECISION_ACTION_TYPES, "mentor_hold", "mentor_hold_release", "mentor_approval_revoked", "mentor_rejection_reverted"]);
  for (const t of MENTOR_APPROVAL_HISTORY_ACTION_TYPES) {
    assert.equal(mentorApprovalHistoryLabel(t), mentorDecisionResultLabel(t), t);
    assert.notEqual(mentorDecisionResultLabel(t), "처리", `${t} 라벨 등재`);
  }
});

// ── ④ 승인 취소 ─────────────────────────────────────────────────────────────

test("승인 취소: critical + 사유 필수 · 활성 구독 시 비활성(집계 실패도 막는다) · approved → pending 한 컬럼 · 학교 인증·요금제 행 불변 · 감사 로그", () => {
  assert.deepEqual([...REVOKE_BLOCKING_SUBSCRIPTION_STATUSES], ["active", "cancel_scheduled", "past_due"]);
  assert.equal(revokeBlockedMessage(0), null);
  assert.equal(revokeBlockedMessage(3), "구독 중인 학생 3명 — 구독이 끝나야 취소할 수 있습니다");
  assert.equal(revokeBlockedMessage(null), REVOKE_INDETERMINATE_MESSAGE, "판정 불가는 0 으로 위장하지 않는다");
  assert.equal(
    buildMentorRevokeSummary("김OO"),
    "김OO 멘토의 승인을 취소합니다. 멘토 목록에서 사라지고 대기 상태로 돌아갑니다. 학교 등급 확정은 유지됩니다. 요금제는 유지됩니다."
  );
  const src = read(REVOKE_ACTIONS);
  const code = stripComments(src);
  assert.ok(src.startsWith('"use server"'));
  const fns = code.match(/export async function \w+\(formData: FormData\) \{\n  const \{ user \} = await requireRole\("admin"\);/g) ?? [];
  assert.equal(fns.length, 2, "승인 취소 · 반려 되돌리기 모두 requireRole(admin) 첫 줄");
  assert.ok(code.includes("formData.get(MENTOR_REVOKE_REASON_FIELD)") && MENTOR_REVOKE_REASON_FIELD === "revokeReason");
  assert.ok(code.includes("if (reason.length < ADMIN_CONFIRM_REASON_MIN_LENGTH) redirect("), "사유 필수(서버)");
  const subsCheck = code.indexOf("countMentorActiveSubscriptions(mentorUserId)");
  const blockedCheck = code.indexOf("revokeBlockedMessage(activeSubscriptions)");
  const transition = code.indexOf('transitionMentorVerificationStatus(mentorUserId, ["approved"], MENTOR_HOLD_RELEASE_TARGET_STATUS)');
  assert.ok(subsCheck > 0 && blockedCheck > subsCheck && transition > blockedCheck, "구독 재검사 → 차단 → 전이 순서");
  assert.ok(code.includes('actionType: "mentor_approval_revoked"') && code.includes("activeSubscriptions }"), "감사 로그(구독 수 포함)");
  assert.ok(code.includes('transitionMentorVerificationStatus(mentorUserId, ["rejected"], MENTOR_HOLD_RELEASE_TARGET_STATUS)') && code.includes('actionType: "mentor_rejection_reverted"'));
  for (const rel of [REVOKE_ACTIONS, HOLD_ACTIONS, TRANSITION]) {
    const c = stripComments(read(rel));
    assert.ok(!/mentor_school_verifications|mentor_plans|\.rpc\(/.test(c), `${rel}: 학교 인증·요금제 행·RPC 를 건드리지 않는다`);
  }
  const transitionSrc = stripComments(read(TRANSITION));
  assert.ok(transitionSrc.includes('from(TABLE).update(patch).eq("user_id", mentorUserId).in(STATUS_COLUMN, fromList)'), "상태 컬럼 하나 · from 게이트");
  assert.ok(transitionSrc.includes('const TABLE = "mentor_profiles"') && transitionSrc.includes('const STATUS_COLUMN = "verification_status"'));
  const controls = stripComments(read(CONTROLS));
  assert.ok(read(CONTROLS).startsWith('"use client"'));
  assert.ok(/level="critical"[\s\S]*?reasonFieldName=\{MENTOR_REVOKE_REASON_FIELD\}[\s\S]*?disabled=\{blocked\}/.test(controls), "승인 취소 = critical · 활성 구독 시 disabled");
  assert.equal((controls.match(/level="critical"/g) ?? []).length, 1, "critical 은 승인 취소 하나");
  assert.ok(controls.includes("data-revoke-blocked") && controls.includes("{blockedMessage}"), "잠금 이유 문구");
  const panel = stripComments(read(PANEL));
  assert.ok(panel.includes("blockedMessage={revokeBlockedMessage(detail.activeSubscriptionCount)}") && panel.includes('detail.status === "approved" ? ('));
  const queries = stripComments(read(QUERIES));
  assert.ok(queries.includes('.in("status", [...REVOKE_BLOCKING_SUBSCRIPTION_STATUSES])') && queries.includes('status === "approved" ? countMentorActiveSubscriptions(id) : Promise.resolve(null)'));
});

test("승인 취소됨 배지: 대기 상태 + 마지막 처리가 승인 취소일 때만 — 목록 행·패널 헤더", () => {
  assert.equal(isMentorApprovalRevoked({ status: "pending", lastActionType: MENTOR_APPROVAL_REVOKED_ACTION_TYPE }), true);
  assert.equal(isMentorApprovalRevoked({ status: "pending", lastActionType: "mentor_hold" }), false, "뒤에 다른 처리가 오면 배지 없음");
  assert.equal(isMentorApprovalRevoked({ status: "approved", lastActionType: MENTOR_APPROVAL_REVOKED_ACTION_TYPE }), false);
  assert.ok(stripComments(read(LIST)).includes("{item.revoked ? <StatusBadge label={MENTOR_APPROVAL_REVOKED_BADGE}"));
  assert.ok(stripComments(read(PANEL)).includes("{detail.revoked ? <StatusBadge label={MENTOR_APPROVAL_REVOKED_BADGE}"));
});

// ── ⑤ 오늘 내가 처리한 건 · 쓰기 경로 수 · 감사 로그 사전 ──────────────────

test("오늘 내가 처리한 건: 건수 = 감사 로그 집계(admin_id = 나 · 오늘 KST) · 제목 형식 · 되돌리기 종류는 현재 상태가 그대로일 때만", () => {
  const s = summarizeMentorDecisionsToday([
    { actionType: "mentor_approve" }, { actionType: "mentor_approve" }, { actionType: "mentor_reject" }, { actionType: "mentor_hold" },
    { actionType: "mentor_request_documents" }, { actionType: "legacy_thing" },
  ]);
  assert.equal(s.total, 5, "모르는 action_type 은 세지 않는다");
  assert.equal(formatMentorDecisionsTodayHeading(s), "오늘 내가 처리한 건 5 (승인 2 · 반려 1 · 보류 1 · 재제출 1)");
  assert.equal(formatMentorDecisionsTodayHeading(summarizeMentorDecisionsToday([])), "오늘 내가 처리한 건 0 (승인 0 · 반려 0 · 보류 0)");
  assert.equal(mentorDecisionUndoKind("mentor_approve", "approved"), "revoke");
  assert.equal(mentorDecisionUndoKind("mentor_approve", "pending"), null, "이미 취소됐으면 되돌릴 대상이 아니다");
  assert.equal(mentorDecisionUndoKind("mentor_reject", "rejected"), "revert");
  assert.equal(mentorDecisionUndoKind("mentor_hold", "on_hold"), "release");
  assert.equal(mentorDecisionUndoKind("mentor_request_documents", "under_review"), null);
  const queries = stripComments(read(QUERIES));
  assert.ok(queries.includes('.eq("admin_id", me)') && queries.includes('.gte("created_at", kstTodayStartIso())'), "admin_id = 나 AND 오늘");
  assert.ok(queries.includes("summary: summarizeMentorDecisionsToday(rows)"), "건수 = 집계");
  const today = stripComments(read(TODAY));
  assert.ok(today.includes("formatMentorDecisionsTodayHeading(data.summary)") && today.includes("<details"));
  assert.ok(today.includes('row.undo === "revoke"') && today.includes('row.undo === "revert"') && today.includes('row.undo === "release"'));
  assert.ok(stripComments(read(PAGE)).includes("<MentorApprovalTodayPanel data={myToday} listParams={listParams} />"));
});

test("새 쓰기 경로는 2개(보류 모듈 · 승인 취소 모듈)뿐 — 전이 헬퍼를 import 하는 파일이 그 둘이고, 결정 액션 3종의 패치·게이트는 불변", () => {
  const files = [...walk(join(ROOT, "lib"), []), ...walk(join(ROOT, "app"), []), ...walk(join(ROOT, "components"), [])];
  const importers = files
    .filter((f) => !f.includes("__contract__") && stripComments(readFileSync(f, "utf8")).includes('from "@/lib/admin/mentorProfileStatusTransition"'))
    .map((f) => f.slice(ROOT.length).replace(/\\/g, "/").replace(/^\/+/, ""))
    .sort();
  assert.deepEqual(importers, [HOLD_ACTIONS, REVOKE_ACTIONS]);
  const actions = stripComments(read(DECISION_ACTIONS));
  assert.ok(actions.includes('return { [STATUS_COLUMN]: "approved" };') && actions.includes('return { [STATUS_COLUMN]: "rejected" };'));
  assert.ok(!actions.includes("transitionMentorVerificationStatus"), "기존 액션의 쓰기 경로는 그대로");
});

test("감사 로그 사전: 새 action_type 4종 등재(한글 라벨 · 멘토 승인 계열)", () => {
  for (const t of [MENTOR_HOLD_ACTION_TYPE, MENTOR_HOLD_RELEASE_ACTION_TYPE, MENTOR_APPROVAL_REVOKED_ACTION_TYPE, MENTOR_REJECTION_REVERTED_ACTION_TYPE]) {
    assert.equal(ADMIN_ACTION_TYPE_LABELS[t]?.group, "mentor_approval", t);
    assert.ok(/[가-힣]/.test(adminActionLabel(t)), t);
  }
});

test("UI 카피 금지어 없음 · 인라인 style 없음(새 컴포넌트)", () => {
  for (const rel of [HOLD_BAR, CONTROLS, PROVIDER, PRESENCE_BADGE, PRESENCE_NOTICE, TODAY]) {
    const code = stripComments(read(rel));
    for (const banned of ["선생님", "강사님", "수강생", "과외", "커패니티", "웰버십", "쌤버쉽", "alert("]) {
      assert.ok(!code.includes(banned), `${rel}: 금지 문구 ${banned}`);
    }
    assert.ok(!/style=\{/.test(code), `${rel}: 인라인 style 금지`);
  }
});
