// 계약 테스트: 신고 상세 경고·계정 정지(PR-6 §1) + 계정 제재 표시 규칙(accountSanctionPolicy).
// 실행: node --test --experimental-strip-types lib/admin/__contract__/contentReportSanctionConsole.contract.test.ts
//
// 고정하는 것:
//   ① 두 조치는 계정 관리 화면의 기존 서버 액션(issueUserWarningAction · setUserStatusAction)을 그대로 재사용한다 — 필드명·허용 값·redirect 는 소스 대조
//   ② 경고 = stateChange + 사유 프리셋 필수(4종 + 직접 입력) · 정지 = critical(기간 7일·30일·영구 선택 + 사유 필수 · 미선택 잠금)
//   ③ 제재 코드 → 계정 상태 표 = accountStatusCore.sanctionToAccountStatus · 경고 자동 정지 3회/7일 = accountStatusCore 상수 = RPC 본문
//   ④ 정지가 실제로 막는 것/막지 않는 것 문장은 코드 실측과 일치한다(assertAccountActive 호출부 · canLogin 미배선 · users 행만 갱신 · 멘토 찾기 뷰 status 조건)
//   ⑤ 렌더·배선 tripwire(부품 2개 · 신고당한 사용자 블록 · 기존 조치 6종 부품 무변경 · 새 "use server" 없음)

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateAdminConfirm, resolveAdminConfirmRequirements } from "../adminConfirmPolicy.ts";
import {
  ACCOUNT_BANNED_SENTENCE,
  ACCOUNT_SANCTION_CODES,
  ACCOUNT_SANCTION_LABELS,
  ACCOUNT_SANCTION_TO_STATUS,
  ACCOUNT_SUSPENDED_BLOCKED_SENTENCE,
  ACCOUNT_SUSPENDED_NOT_BLOCKED_SENTENCE,
  ACCOUNT_WARNING_AUTO_SUSPEND_DAYS,
  ACCOUNT_WARNING_AUTO_SUSPEND_THRESHOLD,
  accountRoleLabel,
  buildAccountSanctionSummary,
  buildAccountWarningSummary,
  isAccountSanctionCode,
  mentorSanctionImpactSentence,
} from "../accountSanctionPolicy.ts";
import {
  CONTENT_REPORT_CUSTOM_REASON_LABEL,
  CONTENT_REPORT_SUSPEND_BLOCKED_MESSAGE,
  CONTENT_REPORT_SUSPEND_CODES,
  CONTENT_REPORT_SUSPEND_DURATION_FIELD,
  CONTENT_REPORT_SUSPEND_REASON_FIELD,
  CONTENT_REPORT_SUSPEND_STATUS_FIELD,
  CONTENT_REPORT_USER_ACTIONS,
  CONTENT_REPORT_USER_ACTION_REDIRECT_NOTE,
  CONTENT_REPORT_USER_ID_FIELD,
  CONTENT_REPORT_WARNING_PRESETS,
  CONTENT_REPORT_WARN_REASON_FIELD,
  CONTENT_REPORT_WARN_SEVERITY_DEFAULT,
  CONTENT_REPORT_WARN_SEVERITY_FIELD,
  buildContentReportSuspendSummary,
  buildContentReportWarningSummary,
  contentReportSuspendFields,
  contentReportUserActionsAvailable,
  type ContentReportTargetUser,
} from "../contentReportSanctionConsole.ts";

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const DETAIL_PAGE = "app/(admin)/admin/(console)/reports/[id]/page.tsx";
const USER_ACTIONS_UI = "components/admin/ContentReportUserActionButtons.tsx";
const TARGET_PANEL = "components/admin/ContentReportTargetUserPanel.tsx";
const CONTENT_ACTIONS_UI = "components/admin/ContentReportActionButtons.tsx";
const POLICY = "lib/admin/accountSanctionPolicy.ts";
const CONSOLE = "lib/admin/contentReportSanctionConsole.ts";
const TARGET_QUERIES = "lib/admin/contentReportTargetUserQueries.ts";
const ACCOUNT_ACTIONS = "lib/admin/accountStatusActions.ts";
const ACCOUNT_CORE = "lib/admin/accountStatusCore.ts";
const WARNING_RPC_SQL = "supabase/sql/20260803162808_domain_contract_convergence.sql";

function walk(dir: string, out: string[]) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "__contract__" || name.startsWith(".")) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

const user = (over: Partial<ContentReportTargetUser> = {}): ContentReportTargetUser => ({
  id: "11111111-1111-4111-8111-111111111111",
  name: "김OO",
  email: null,
  role: "student",
  roleLabel: "학생",
  createdAt: "2026-08-01T00:00:00Z",
  status: "active",
  effectiveStatus: "active",
  suspendedUntil: null,
  statusReason: null,
  activeWarningCount: 1,
  previousReportCount: 0,
  mentorRoomCount: null,
  ...over,
});

// ── ① 기존 액션 재사용 — 필드명·허용 값·redirect 소스 대조 ──────────────────

test("필드명 = accountStatusActions 가 읽는 이름(userId · warnReason · severity · nextStatus · durationDays · reason) · 허용 상태 · redirect 는 /admin/users(기존 동작 — 보고)", () => {
  const a = stripComments(read(ACCOUNT_ACTIONS));
  assert.equal(CONTENT_REPORT_USER_ID_FIELD, "userId");
  assert.equal(CONTENT_REPORT_WARN_REASON_FIELD, "warnReason");
  assert.equal(CONTENT_REPORT_WARN_SEVERITY_FIELD, "severity");
  assert.equal(CONTENT_REPORT_SUSPEND_STATUS_FIELD, "nextStatus");
  assert.equal(CONTENT_REPORT_SUSPEND_DURATION_FIELD, "durationDays");
  assert.equal(CONTENT_REPORT_SUSPEND_REASON_FIELD, "reason");
  for (const f of ["userId", "warnReason", "severity", "nextStatus", "durationDays", "reason"]) assert.ok(a.includes(`formData.get("${f}")`), f);
  assert.ok(a.includes('const ALLOWED_STATUS = new Set(["active", "suspended", "banned"]);'));
  assert.ok(a.includes('const PATH = "/admin/users";') && a.includes("redirect(okUrl(") && !a.includes("returnTo"), "두 액션은 계정 관리 화면으로 돌아간다(신고 상세로 안 옴)");
  assert.ok(a.includes('session.rpc("admin_issue_user_warning"'), "경고 = RPC 한 경로");
  assert.ok(CONTENT_REPORT_USER_ACTION_REDIRECT_NOTE.includes("계정 관리 화면으로 이동"));
  assert.ok(read(WARNING_RPC_SQL).includes(`if v_severity not in ('normal','severe')`) && CONTENT_REPORT_WARN_SEVERITY_DEFAULT === "normal");
});

// ── ② 프리셋 · 기간 · 등급 ───────────────────────────────────────────────────

test("경고 프리셋 4종 + 직접 입력 · stateChange 에 사유 필수(프리셋 없이 제출 불가) · 정지 = critical(사유 필수) · 기간 미선택 잠금 문구", () => {
  assert.deepEqual([...CONTENT_REPORT_WARNING_PRESETS], ["외부 연락처 유도", "대필 요청", "부적절한 언어", "커뮤니티 가이드라인 위반"]);
  assert.equal(CONTENT_REPORT_CUSTOM_REASON_LABEL, "직접 입력");
  assert.equal(CONTENT_REPORT_USER_ACTIONS.warn.level, "stateChange");
  assert.equal(CONTENT_REPORT_USER_ACTIONS.suspend.level, "critical");
  const warn = resolveAdminConfirmRequirements({ level: "stateChange", reasonRequired: true });
  assert.equal(evaluateAdminConfirm(warn, { reason: "", typedConfirmText: "" }).ok, false, "프리셋(사유) 없이 제출 불가");
  assert.equal(evaluateAdminConfirm(warn, { reason: CONTENT_REPORT_WARNING_PRESETS[0], typedConfirmText: "" }).ok, true);
  const suspend = resolveAdminConfirmRequirements({ level: "critical" });
  assert.equal(suspend.reasonRequired, true, "정지 사유 필수");
  assert.equal(evaluateAdminConfirm(suspend, { reason: "", typedConfirmText: "" }).ok, false);
  assert.equal(CONTENT_REPORT_SUSPEND_BLOCKED_MESSAGE, "정지 기간(7일 · 30일 · 영구)을 선택해 주세요.");
  assert.deepEqual([...CONTENT_REPORT_SUSPEND_CODES], ["7d", "30d", "permanent"]);
});

test("기간 코드 → setUserStatusAction 필드 = accountStatusCore.sanctionToAccountStatus 표(7d suspended 7 · 30d suspended 30 · permanent banned)", () => {
  assert.deepEqual(contentReportSuspendFields("7d"), { nextStatus: "suspended", durationDays: "7" });
  assert.deepEqual(contentReportSuspendFields("30d"), { nextStatus: "suspended", durationDays: "30" });
  assert.deepEqual(contentReportSuspendFields("permanent"), { nextStatus: "banned", durationDays: "" });
  const core = read(ACCOUNT_CORE);
  for (const code of ACCOUNT_SANCTION_CODES) {
    const m = ACCOUNT_SANCTION_TO_STATUS[code];
    assert.ok(core.includes(`case "${code}":\n      return { nextStatus: "${m.nextStatus}", durationDays: ${m.durationDays === null ? "null" : m.durationDays} };`), `${code} 매핑 = 코어`);
  }
  assert.deepEqual([...ACCOUNT_SANCTION_CODES], ["7d", "30d", "permanent"]);
  assert.deepEqual(ACCOUNT_SANCTION_LABELS, { "7d": "7일 정지", "30d": "30일 정지", permanent: "영구 차단" });
  assert.ok(isAccountSanctionCode("30d") && !isAccountSanctionCode("14d"));
});

// ── ③ 경고 자동 정지 규칙 = 코어 상수 = RPC ──────────────────────────────────

test("경고 3회 누적 → 7일 자동 정지: accountStatusCore 상수 · RPC admin_issue_user_warning 본문(v_active_count >= 3 · interval '7 days')과 같다", () => {
  assert.equal(ACCOUNT_WARNING_AUTO_SUSPEND_THRESHOLD, 3);
  assert.equal(ACCOUNT_WARNING_AUTO_SUSPEND_DAYS, 7);
  const core = read(ACCOUNT_CORE);
  assert.ok(core.includes(`export const WARNING_AUTO_SUSPEND_THRESHOLD = ${ACCOUNT_WARNING_AUTO_SUSPEND_THRESHOLD};`));
  assert.ok(core.includes(`export const WARNING_AUTO_SUSPEND_DAYS = ${ACCOUNT_WARNING_AUTO_SUSPEND_DAYS};`));
  const sql = read(WARNING_RPC_SQL);
  assert.ok(sql.includes(`if v_active_count >= ${ACCOUNT_WARNING_AUTO_SUSPEND_THRESHOLD} then`));
  assert.ok(sql.includes(`interval '${ACCOUNT_WARNING_AUTO_SUSPEND_DAYS} days'`));
});

test("경고 summary: 누적 N회 표시 · 이번 경고로 3회면 자동 정지 문장(정지 안내) · 횟수 미확인이면 그 사실", () => {
  assert.equal(buildAccountWarningSummary({ name: "김OO", activeWarningCount: 0 }), "김OO 님에게 경고를 기록합니다. 누적 경고 0회.\n경고 3회 누적 시 계정이 7일 자동 정지됩니다.");
  const third = buildAccountWarningSummary({ name: "김OO", activeWarningCount: 2 });
  assert.ok(third.startsWith("김OO 님에게 경고를 기록합니다. 누적 경고 2회."));
  assert.ok(third.includes("이번 경고로 3회가 되어 계정이 7일 자동 정지됩니다") && third.includes("'계정 정지'"));
  assert.ok(buildAccountWarningSummary({ name: "김OO", activeWarningCount: 5 }).includes("이번 경고로 6회가 되어"));
  assert.ok(buildAccountWarningSummary({ name: " ", activeWarningCount: null }).startsWith("이름 없음 님에게 경고를 기록합니다. 누적 경고 횟수를 확인하지 못했습니다."));
  assert.equal(buildContentReportWarningSummary(user({ activeWarningCount: 1 })), buildAccountWarningSummary({ name: "김OO", activeWarningCount: 1 }));
});

// ── ④ 정지의 실제 영향 문장 = 코드 실측 ──────────────────────────────────────

test("정지가 막는 것 = assertAccountActive 호출부(질문방 · 개별 질문 · 커뮤니티 글·댓글·숏폼) · 로그인은 막지 않음(canLogin 호출부 0 · middleware 무처리) · users 행만 갱신", () => {
  const callers = walk(join(ROOT, "lib"), [])
    .filter((f) => /assertAccountActive\(/.test(stripComments(readFileSync(f, "utf8"))))
    .map((f) => f.slice(ROOT.length).replace(/\\/g, "/"))
    .filter((f) => !/lib\/auth\/accountStatus\.ts$|lib\/appSession\/appSurfaceAccountGate\.ts$/.test(f))
    .sort();
  assert.deepEqual(callers, [
    "lib/community/commentActions.ts",
    "lib/community/communityBoardActions.ts",
    "lib/community/communityShortformActions.ts",
    "lib/individualQuestion/individualQuestionActions.ts",
    "lib/qna/questionRoomActions.ts",
  ], "게이트 호출부가 바뀌면 ACCOUNT_SUSPENDED_BLOCKED_SENTENCE 를 갱신하라");
  assert.equal(ACCOUNT_SUSPENDED_BLOCKED_SENTENCE, "정지 중에는 질문방 글·답변·연결노트, 개별 질문, 커뮤니티 글·댓글·숏폼 작성이 차단됩니다.");
  const canLoginUsers = [...walk(join(ROOT, "lib"), []), ...walk(join(ROOT, "app"), []), ...walk(join(ROOT, "components"), []), join(ROOT, "middleware.ts")]
    .filter((f) => !/lib\/account\/effectiveAccountStatus\.ts$/.test(f))
    .filter((f) => /\bcanLogin\b/.test(stripComments(readFileSync(f, "utf8"))));
  assert.deepEqual(canLoginUsers, [], "로그인 차단이 배선되면 ACCOUNT_SUSPENDED_NOT_BLOCKED_SENTENCE 를 갱신하라");
  assert.ok(!/suspend|banned|status/.test(stripComments(read("middleware.ts"))), "middleware 는 계정 상태를 보지 않는다");
  assert.equal(ACCOUNT_SUSPENDED_NOT_BLOCKED_SENTENCE, "로그인·구독·결제는 막히지 않으며, 진행 중인 구독은 유지됩니다.");
  for (const rel of [ACCOUNT_CORE, ACCOUNT_ACTIONS]) {
    const tables = [...stripComments(read(rel)).matchAll(/\.from\("([a-z_]+)"\)/g)].map((m) => m[1]);
    assert.deepEqual([...new Set(tables)], ["users"], `${rel}: users 행만 갱신(구독·질문방 불변)`);
  }
  assert.ok(read(WARNING_RPC_SQL).includes("lower(COALESCE(u.status, 'active'::text)) = 'active'::text"), "멘토 찾기 뷰는 active 멘토만");
});

test("정지 summary: 기간별 문장 · 차단/비차단 사실 · 멘토면 담당 학생 수(없으면 생략) · 영구 차단은 수동 해제 문장", () => {
  const s = buildContentReportSuspendSummary(user({ role: "mentor", roleLabel: "멘토", name: "수학하는하늘", mentorRoomCount: 3 }), "7d", "2026.09.10");
  assert.ok(s.startsWith("수학하는하늘 멘토 계정을 7일 정지합니다. 2026.09.10까지 정지되며 그 뒤 자동 해제됩니다."), s);
  assert.ok(s.includes(ACCOUNT_SUSPENDED_BLOCKED_SENTENCE) && s.includes(ACCOUNT_SUSPENDED_NOT_BLOCKED_SENTENCE));
  assert.ok(s.includes("담당 학생 3명의 질문방이 영향받습니다"));
  const p = buildContentReportSuspendSummary(user(), "permanent", null);
  assert.ok(p.startsWith(`김OO 학생 계정을 영구 차단합니다. ${ACCOUNT_BANNED_SENTENCE}`) && !p.includes("담당 학생"));
  assert.ok(buildAccountSanctionSummary({ name: "m", roleLabel: "멘토", code: "30d", untilLabel: null, mentorRoomCount: null, isMentor: true }).startsWith("m 멘토 계정을 30일 정지합니다.\n"));
  assert.equal(mentorSanctionImpactSentence(null), null);
  assert.equal(mentorSanctionImpactSentence(0), "담당 학생이 없어 질문방 영향은 없습니다. 멘토 찾기 목록에서는 빠집니다.");
  assert.equal(accountRoleLabel("mentor"), "멘토");
  assert.equal(contentReportUserActionsAvailable(user({ role: "admin", roleLabel: "관리자" })), false, "관리자는 서버가 거부 — 버튼 없음");
  assert.equal(contentReportUserActionsAvailable(null), false);
  assert.equal(contentReportUserActionsAvailable(user()), true);
});

// ── ⑤ tripwire ──────────────────────────────────────────────────────────────

test("조치 부품: 기존 액션 2개만(accountStatusActions) · 경고 stateChange+프리셋(warnReason) · 정지 critical(reason) + 기간 라디오 3 + 잠금 + hidden nextStatus/durationDays · 자체 모달 없음", () => {
  const src = stripComments(read(USER_ACTIONS_UI));
  assert.ok(src.startsWith('"use client"'));
  assert.ok(src.includes('import { issueUserWarningAction, setUserStatusAction } from "@/lib/admin/accountStatusActions";'), "계정 관리 화면 액션 재사용");
  assert.ok(src.includes("action={issueUserWarningAction}") && src.includes("action={setUserStatusAction}"));
  assert.equal((src.match(/<ConfirmSubmitButton\b/g) ?? []).length, 2);
  assert.equal((src.match(/level="stateChange"/g) ?? []).length, 1);
  assert.equal((src.match(/level="critical"/g) ?? []).length, 1);
  assert.ok(src.includes("reasonPresets={CONTENT_REPORT_WARNING_PRESETS}") && src.includes("reasonFieldName={CONTENT_REPORT_WARN_REASON_FIELD}"), "경고 프리셋 → warnReason");
  assert.ok(/level="stateChange"[\s\S]*?reasonRequired\s/.test(src), "경고는 사유 필수로 격상");
  assert.ok(src.includes("reasonFieldName={CONTENT_REPORT_SUSPEND_REASON_FIELD}"), "정지 사유 → reason");
  assert.ok(src.includes("confirmBlockedMessage={code ? null : CONTENT_REPORT_SUSPEND_BLOCKED_MESSAGE}"), "기간 미선택 시 제출 불가");
  assert.ok(src.includes("name={CONTENT_REPORT_SUSPEND_STATUS_FIELD} value={fields.nextStatus}") && src.includes("name={CONTENT_REPORT_SUSPEND_DURATION_FIELD} value={fields.durationDays}"));
  assert.ok(src.includes("CONTENT_REPORT_SUSPEND_CODES.map") && src.includes('type="radio"'), "기간 라디오");
  assert.ok(src.includes("name={CONTENT_REPORT_WARN_SEVERITY_FIELD} value={CONTENT_REPORT_WARN_SEVERITY_DEFAULT}"));
  assert.ok(!src.includes("AdminConfirmDialog") && !/alert\(/.test(src) && !/style=\{/.test(src));
});

test("신고 상세: 신고당한 사용자 블록(이름·역할·가입일·누적 경고·계정 상태·이전 신고) + 조치 부품 배선 · 기존 조치 6종 부품은 그대로", () => {
  const page = stripComments(read(DETAIL_PAGE));
  assert.ok(page.includes("<ContentReportTargetUserPanel user={targetUser} authorKnown={Boolean(authorId)} />"));
  assert.ok(page.includes("<ContentReportUserActionButtons user={targetUser} untilLabels={untilLabels} />"));
  assert.ok(page.includes("loadContentReportTargetUser(evidenceClient, authorId, { excludeReportId: id })"), "증거 조회와 같은 클라이언트로 작성자 조회");
  assert.ok(page.includes("<ContentReportActionButtons reportId={id} targetKind={targetKind}"), "기존 6종 그대로");
  const panel = stripComments(read(TARGET_PANEL));
  assert.ok(!panel.startsWith('"use client"'));
  for (const label of ['label="이름"', 'label="역할"', 'label="가입일"', 'label="누적 경고"', 'label="현재 계정 상태"', 'label="이전 신고 건수"']) assert.ok(panel.includes(label), label);
  assert.ok(panel.includes('<AdminStatusPill table="users" column="status" value={user.effectiveStatus} size="sm" />'));
  const six = stripComments(read(CONTENT_ACTIONS_UI));
  assert.equal((six.match(/<ConfirmSubmitButton\b/g) ?? []).length, 6, "PR-5 조치 6종 무변경");
  assert.ok(!six.includes("issueUserWarningAction") && !six.includes("setUserStatusAction"));
  const q = stripComments(read(TARGET_QUERIES));
  assert.ok(q.includes('.from("user_warnings")') && q.includes('.from("content_reports")') && q.includes("countMentorStudentRooms("));
  assert.ok(!/\.insert\(|\.update\(|\.delete\(|\.rpc\(/.test(q), "조회 전용");
  for (const rel of [POLICY, CONSOLE]) assert.ok(!/from "react"|from "@\//.test(stripComments(read(rel))), `${rel}: 순수 모듈`);
});

test("UI 카피 금지어 없음(선생님·강사님·수강생·과외·alert)", () => {
  for (const rel of [DETAIL_PAGE, USER_ACTIONS_UI, TARGET_PANEL, POLICY, CONSOLE, TARGET_QUERIES]) {
    const code = stripComments(read(rel));
    for (const banned of ["선생님", "강사님", "수강생", "과외", "커패니티", "웰버십", "쌤버쉽", "alert("]) {
      assert.ok(!code.includes(banned), `${rel}: 금지 문구 ${banned}`);
    }
  }
});
