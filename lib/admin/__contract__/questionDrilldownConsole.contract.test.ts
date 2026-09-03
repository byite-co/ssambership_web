// 계약 테스트: 질문 · 연결노트 드릴다운(PR-8) — 지시서 §8 검증 항목.
// 실행: node --test --experimental-strip-types lib/admin/__contract__/questionDrilldownConsole.contract.test.ts
//
// .tsx 는 node --test 로 import 할 수 없으므로(strip-types 는 JSX 미지원):
//   ① 순수 규칙(경로·returnTo 허용 목록 · 실명/닉네임 규칙 · 미답변 경과·첫 답변 · 스레드/개별질문 파생 · 연결노트 시간순(건수 가정 없음) ·
//      품질 지표 · 열람 기록 · 첨부 버킷/서명 소스 · 주간 사용량 표기 · 빈 상태 문구)은 픽스처로 직접 검증한다
//   ② 렌더·배선 규칙은 소스 스캔 tripwire 로 고정한다(멘토별 화면 라우트 하나 · 양쪽 탭에서 같은 라우트 · 질문 상세 공통 컴포넌트 ·
//      렌더 시 열람 기록 1건 · 서명 URL 서버 발급 · 조회 모듈 읽기 전용 · AdminDataTable prop 추가 0 · 마스킹/익명화/토글 없음 · 조치 버튼 없음)

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { accountActionLogLabel, accountDetailTabsForRole } from "../accountDetailConsole.ts";
import { adminStatusAllowedValues, resolveAdminStatus } from "../adminStatusDictionary.ts";
import {
  ACCOUNT_DRILLDOWN_TABS,
  CONNECTION_NOTE_AUTHOR_COLORS,
  EMPTY_CONNECTION_NOTES,
  EMPTY_MENTOR_INDIVIDUAL,
  EMPTY_MENTOR_ROOMS,
  EMPTY_ROOM_THREADS,
  EMPTY_STUDENT_INDIVIDUAL,
  EMPTY_STUDENT_ROOMS,
  ESCROW_STATE_LABELS,
  INDIVIDUAL_QUESTION_ATTACHMENTS_BUCKET_NAME,
  PARTY_ROLE_LABELS,
  QUESTION_ATTACHMENT_SIGNED_URL_TTL_SEC,
  QUESTION_BODY_VIEWED_ACTION,
  QUESTION_BODY_VIEWED_TARGET_TYPES,
  QUESTION_DRILLDOWN_PAGE_SIZE,
  QUESTION_ROOM_ATTACHMENTS_BUCKET_NAME,
  QUESTION_ROOM_BASE_PATH,
  QUESTION_ROOM_TABS,
  ROOM_SUBSCRIPTION_MISSING_LABEL,
  SCAN_ANNOTATIONS_BUCKET_NAME,
  UNANSWERED_DANGER_HOURS,
  UNANSWERED_WARNING_HOURS,
  attachmentFileNameFromPath,
  buildAccountDrilldownReturnPath,
  buildAttachmentViewerSource,
  buildIndividualQuestionUrl,
  buildQuestionBodyViewedLog,
  buildQuestionQualityMetrics,
  buildQuestionRoomUrl,
  buildQuestionThreadUrl,
  connectionNoteAuthorRole,
  displayNameForRole,
  durationMs,
  firstAnswerCell,
  formatAnswerLength,
  formatDurationKo,
  formatIndividualPriceKrw,
  formatQuestionAttachmentStoredRef,
  formatWeeklyUsageShort,
  individualAnsweringMentorId,
  individualEscrowState,
  individualRequirementLabel,
  individualTypeLabel,
  isIndividualAwaitingAnswer,
  isThreadAwaitingAnswer,
  isThreadUnanswered,
  isWebRenderableImageMime,
  mentorDisplayName,
  pageRange,
  parseQuestionAttachmentStoredRef,
  questionRoomPath,
  resolveMessageAuthorRole,
  resolveQuestionDetailReturnPath,
  resolveQuestionRoomReturnPath,
  resolveQuestionRoomTab,
  returnLinkLabel,
  roomSubscriptionStatus,
  scanAnnotationDisplayPath,
  sortByCreatedAt,
  sortConnectionNotesChronologically,
  studentDisplayName,
  threadBadges,
  threadStatusLabel,
  unansweredElapsedTone,
  type ConversationMessage,
  type PartyIdentity,
} from "../questionDrilldownConsole.ts";

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const PURE = "lib/admin/questionDrilldownConsole.ts";
const QUERIES = "lib/admin/questionDrilldownQueries.ts";
const DOC_ACTION = "lib/admin/questionDrilldownDocumentActions.ts";
const ACCOUNT_PAGE = "app/(admin)/admin/(console)/users/[id]/page.tsx";
const ROOM_PAGE = "app/(admin)/admin/(console)/question-rooms/[roomId]/page.tsx";
const THREAD_PAGE = "app/(admin)/admin/(console)/question-threads/[id]/page.tsx";
const INDIVIDUAL_PAGE = "app/(admin)/admin/(console)/individual-questions/[id]/page.tsx";
const DETAIL_SCREEN = "components/admin/QuestionDetailScreen.tsx";
const CONVERSATION = "components/admin/QuestionConversationView.tsx";
const GALLERY = "components/admin/QuestionAttachmentGallery.tsx";
const VIEWER = "components/admin/DocumentViewer.tsx";
const INDIVIDUAL_TAB = "components/admin/AccountIndividualQuestionsTab.tsx";
const ROOMS_TAB = "components/admin/AccountRoomsTab.tsx";
const ROOM_HEADER = "components/admin/QuestionRoomHeader.tsx";
const THREAD_LIST = "components/admin/QuestionRoomThreadList.tsx";
const NOTE_TIMELINE = "components/admin/ConnectionNoteTimeline.tsx";
const TABS = "components/admin/AccountDetailTabs.tsx";
const NEW_FILES = [PURE, QUERIES, DOC_ACTION, ROOM_PAGE, THREAD_PAGE, INDIVIDUAL_PAGE, DETAIL_SCREEN, CONVERSATION, GALLERY, INDIVIDUAL_TAB, ROOMS_TAB, ROOM_HEADER, THREAD_LIST, NOTE_TIMELINE, TABS];

const UUID = "11111111-1111-4111-8111-111111111111";
const UUID2 = "22222222-2222-4222-8222-222222222222";
const H = 60 * 60 * 1000;
const T0 = "2026-08-30T12:14:00.000Z";
const at = (hours: number) => new Date(new Date(T0).getTime() + hours * H).toISOString();
const atMin = (minutes: number) => new Date(new Date(T0).getTime() + minutes * 60_000).toISOString();

function walk(dir: string, out: string[]) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "__contract__" || name.startsWith(".")) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

const identity = (over: Partial<PartyIdentity>): PartyIdentity => ({ id: UUID, role: null, fullName: null, nickname: null, email: null, ...over });

// ── 경로 · 탭 ────────────────────────────────────────────────────────────────

test("경로: 멘토별 화면은 라우트 하나(/admin/question-rooms/<roomId>) · 질문 상세는 구독·개별 두 경로 · 링크 빌더는 tab/returnTo/page 를 쿼리로", () => {
  assert.equal(QUESTION_ROOM_BASE_PATH, "/admin/question-rooms");
  assert.equal(questionRoomPath(UUID), `/admin/question-rooms/${UUID}`);
  assert.equal(buildQuestionRoomUrl(UUID), `/admin/question-rooms/${UUID}`, "기본 탭(questions)은 쿼리 생략");
  assert.equal(buildQuestionRoomUrl(UUID, { tab: "notes" }), `/admin/question-rooms/${UUID}?tab=notes`);
  assert.equal(buildQuestionRoomUrl(UUID, { tab: "questions", page: 2, returnTo: `/admin/users/${UUID2}?tab=mentors` }), `/admin/question-rooms/${UUID}?page=2&returnTo=%2Fadmin%2Fusers%2F${UUID2}%3Ftab%3Dmentors`);
  assert.equal(buildQuestionThreadUrl(UUID, { returnTo: `/admin/question-rooms/${UUID2}` }), `/admin/question-threads/${UUID}?returnTo=%2Fadmin%2Fquestion-rooms%2F${UUID2}`);
  assert.equal(buildIndividualQuestionUrl(UUID), `/admin/individual-questions/${UUID}`);
  assert.equal(buildAccountDrilldownReturnPath(UUID, "mentors"), `/admin/users/${UUID}?tab=mentors`);
  assert.deepEqual(QUESTION_ROOM_TABS.map((t) => [t.value, t.label]), [["questions", "질문"], ["notes", "연결노트"]]);
  assert.equal(resolveQuestionRoomTab("notes"), "notes");
  assert.equal(resolveQuestionRoomTab("NOTES"), "notes");
  assert.equal(resolveQuestionRoomTab("weird"), "questions");
  assert.equal(QUESTION_DRILLDOWN_PAGE_SIZE, 25);
  assert.deepEqual(pageRange(1, 25), { from: 0, to: 24 });
  assert.deepEqual(pageRange(3, 25), { from: 50, to: 74 });
  assert.deepEqual(pageRange(0, 0), { from: 0, to: 0 });
});

test("계정 상세 탭 4개가 드릴다운 탭 집합과 같다(학생 개별질문·구독 멘토 · 멘토 담당 학생·개별질문 답변) — PR-7 자리표시자 전부 열림", () => {
  const opened = [...accountDetailTabsForRole("student").map((t) => t.value), ...accountDetailTabsForRole("mentor").map((t) => t.value)].filter((v) => v !== "student" && v !== "mentor");
  assert.deepEqual([...opened].sort(), [...ACCOUNT_DRILLDOWN_TABS].sort());
  for (const dir of ["app/(admin)", "components/admin", "lib/admin"]) {
    for (const file of walk(join(ROOT, dir), [])) {
      assert.ok(!stripComments(readFileSync(file, "utf8")).includes("PR-8에서 열립니다"), `${file.slice(ROOT.length)}: 자리표시자 문구 잔존`);
    }
  }
});

// ── returnTo 허용 목록 ───────────────────────────────────────────────────────

test("멘토별 화면 returnTo: /admin/users/<uuid> 만 · 탭은 드릴다운 탭 3종(+answers)만 남기고 나머지 쿼리는 버린다 · 그 외는 null", () => {
  assert.equal(resolveQuestionRoomReturnPath(`/admin/users/${UUID}`), `/admin/users/${UUID}`);
  assert.equal(resolveQuestionRoomReturnPath(`/admin/users/${UUID}?tab=mentors`), `/admin/users/${UUID}?tab=mentors`);
  assert.equal(resolveQuestionRoomReturnPath(`/admin/users/${UUID}?tab=students`), `/admin/users/${UUID}?tab=students`);
  assert.equal(resolveQuestionRoomReturnPath(`/admin/users/${UUID}?tab=individual&page=3&ok=1`), `/admin/users/${UUID}?tab=individual`, "허용 탭 외 쿼리는 버린다");
  assert.equal(resolveQuestionRoomReturnPath(`/admin/users/${UUID}?tab=mentor`), `/admin/users/${UUID}`, "드릴다운 탭이 아닌 값은 탭을 버린다");
  assert.equal(resolveQuestionRoomReturnPath(`/admin/users/${UUID.toUpperCase()}`), `/admin/users/${UUID.toUpperCase()}`);
  for (const bad of [
    "",
    null,
    undefined,
    "/admin/users",
    "/admin/users/not-a-uuid",
    `/admin/users/${UUID}/x`,
    `/admin/reports/${UUID}`,
    `/admin/question-rooms/${UUID}`,
    `/admin/question-threads/${UUID}`,
    `https://evil.example/admin/users/${UUID}`,
    `//evil.example/admin/users/${UUID}`,
    `/admin/users/../reports/${UUID}`,
    `/admin/users/${UUID}#x`,
    `\\admin\\users\\${UUID}`,
    `/admin/users/%2e%2e/${UUID}`,
    "/admin/users/%zz",
  ]) {
    assert.equal(resolveQuestionRoomReturnPath(bad as string), null, String(bad));
  }
});

test("질문 상세 returnTo: 계정 상세 또는 멘토별 화면(탭 + 그 화면의 returnTo 한 겹)만 · 중첩은 다시 검증되어 재조립 · 그 외는 null", () => {
  assert.equal(resolveQuestionDetailReturnPath(`/admin/users/${UUID}?tab=individual`), `/admin/users/${UUID}?tab=individual`);
  assert.equal(resolveQuestionDetailReturnPath(`/admin/question-rooms/${UUID}`), `/admin/question-rooms/${UUID}`);
  assert.equal(resolveQuestionDetailReturnPath(`/admin/question-rooms/${UUID}?tab=notes`), `/admin/question-rooms/${UUID}?tab=notes`);
  assert.equal(resolveQuestionDetailReturnPath(`/admin/question-rooms/${UUID}?tab=bogus&page=2`), `/admin/question-rooms/${UUID}`, "모르는 탭은 기본 탭 · page 는 버린다");
  const nested = buildQuestionRoomUrl(UUID, { tab: "questions", returnTo: `/admin/users/${UUID2}?tab=students` });
  assert.equal(resolveQuestionDetailReturnPath(nested), `/admin/question-rooms/${UUID}?returnTo=%2Fadmin%2Fusers%2F${UUID2}%3Ftab%3Dstudents`, "중첩 returnTo 유지");
  const nestedBad = buildQuestionRoomUrl(UUID, { returnTo: `https://evil.example/admin/users/${UUID2}` });
  assert.equal(resolveQuestionDetailReturnPath(nestedBad), `/admin/question-rooms/${UUID}`, "허용 밖 중첩 returnTo 는 버린다");
  const nestedRoom = buildQuestionRoomUrl(UUID, { returnTo: `/admin/question-rooms/${UUID2}` });
  assert.equal(resolveQuestionDetailReturnPath(nestedRoom), `/admin/question-rooms/${UUID}`, "중첩은 계정 상세만(한 겹)");
  for (const bad of [`/admin/question-threads/${UUID}`, `/admin/individual-questions/${UUID}`, `https://evil.example/admin/question-rooms/${UUID}`, "/admin/question-rooms/nope", `/admin/question-rooms/${UUID}/x`]) {
    assert.equal(resolveQuestionDetailReturnPath(bad), null, bad);
  }
  assert.equal(returnLinkLabel(`/admin/question-rooms/${UUID}`), "← 멘토별 화면");
  assert.equal(returnLinkLabel(`/admin/users/${UUID}?tab=individual`), "← 계정 상세");
});

// ── 실명 · 닉네임 규칙(원칙 1) ───────────────────────────────────────────────

test("이름 규칙: 학생 = full_name · 멘토 = nickname · 폴백 순서 · 역할별 표시 · 작성자 역할은 당사자 대조 우선", () => {
  const both = identity({ fullName: "이수민", nickname: "하늘", email: "s@x.kr" });
  assert.equal(studentDisplayName(both), "이수민");
  assert.equal(mentorDisplayName(both), "하늘");
  assert.equal(studentDisplayName(identity({ nickname: "닉", email: "s@x.kr" })), "닉", "실명 없으면 닉네임");
  assert.equal(mentorDisplayName(identity({ fullName: "김멘토", email: "m@x.kr" })), "김멘토", "닉네임 없으면 실명");
  assert.equal(mentorDisplayName(identity({ email: "m@x.kr" })), "m@x.kr");
  assert.equal(studentDisplayName(identity({})), UUID.slice(0, 8));
  assert.equal(studentDisplayName(null, UUID2), UUID2.slice(0, 8));
  assert.equal(studentDisplayName(null, null), "—");
  assert.equal(studentDisplayName(identity({ fullName: "  " , nickname: "닉" })), "닉", "공백 실명은 없음으로");
  assert.equal(displayNameForRole("mentor", both), "하늘");
  assert.equal(displayNameForRole("student", both), "이수민");
  assert.equal(displayNameForRole("admin", both), "이수민", "관리자·미상은 실명 우선");
  const party = { studentId: UUID, mentorId: UUID2 };
  assert.equal(resolveMessageAuthorRole(UUID, party, "mentor"), "student", "당사자 대조가 users.role 보다 우선");
  assert.equal(resolveMessageAuthorRole(UUID2, party, null), "mentor");
  assert.equal(resolveMessageAuthorRole("33333333-3333-4333-8333-333333333333", party, "admin"), "admin");
  assert.equal(resolveMessageAuthorRole("33333333-3333-4333-8333-333333333333", party, "weird"), "unknown");
  assert.equal(resolveMessageAuthorRole(null, party, null), "unknown");
  assert.deepEqual(PARTY_ROLE_LABELS, { student: "학생", mentor: "멘토", admin: "관리자", unknown: "알 수 없음" });
});

test("마스킹·익명화·열람 토글 없음 — 새 파일에 이름 가림·토글 코드가 없다(원칙 1 · 하지 말 것 1)", () => {
  for (const rel of NEW_FILES) {
    const code = stripComments(read(rel));
    assert.ok(!/mask\w*\(|anonymi|익명|가리기|revealName|showRealName|blur-sm/.test(code), `${rel}: 이름 마스킹·익명화·토글 흔적`);
  }
});

// ── 시간 · 미답변 경과 · 첫 답변 ────────────────────────────────────────────

test("시간 표기: durationMs · formatDurationKo · 미답변 톤(24h 주의 · 48h 위험)", () => {
  assert.equal(durationMs(T0, atMin(80)), 80 * 60_000);
  assert.equal(durationMs(T0, null), null);
  assert.equal(durationMs(at(2), T0), 0, "음수는 0");
  assert.equal(formatDurationKo(0), "1분 미만");
  assert.equal(formatDurationKo(12 * 60_000), "12분");
  assert.equal(formatDurationKo(80 * 60_000), "1시간 20분");
  assert.equal(formatDurationKo(3 * H), "3시간");
  assert.equal(formatDurationKo(26 * H), "1일 2시간");
  assert.equal(formatDurationKo(48 * H), "2일");
  assert.equal(formatDurationKo(null), "—");
  assert.equal(formatDurationKo(-5), "—");
  assert.equal(UNANSWERED_WARNING_HOURS, 24);
  assert.equal(UNANSWERED_DANGER_HOURS, 48);
  assert.equal(unansweredElapsedTone(23 * H), "neutral");
  assert.equal(unansweredElapsedTone(24 * H), "warning");
  assert.equal(unansweredElapsedTone(47.9 * H), "warning");
  assert.equal(unansweredElapsedTone(48 * H), "danger");
  assert.equal(unansweredElapsedTone(null), "neutral");
});

test("첫 답변까지 칸: 답변됨 → 소요 · 미답변(대기 중) → 경과 + 톤 · 답변 없이 끝난 건 → —", () => {
  const now = new Date(at(9)).getTime();
  assert.deepEqual(firstAnswerCell({ createdAt: T0, answeredAt: atMin(80), awaiting: false }, now), { kind: "answered", label: "1시간 20분" });
  assert.deepEqual(firstAnswerCell({ createdAt: T0, answeredAt: null, awaiting: true }, now), { kind: "elapsed", label: "9시간 경과", tone: "neutral" });
  assert.deepEqual(firstAnswerCell({ createdAt: T0, answeredAt: null, awaiting: true }, new Date(at(48)).getTime()), { kind: "elapsed", label: "2일 경과", tone: "danger" });
  assert.deepEqual(firstAnswerCell({ createdAt: T0, answeredAt: null, awaiting: true }, new Date(at(30)).getTime()), { kind: "elapsed", label: "1일 6시간 경과", tone: "warning" });
  assert.deepEqual(firstAnswerCell({ createdAt: T0, answeredAt: null, awaiting: false }, now), { kind: "none", label: "—" }, "만료·환불 건은 경과를 세지 않는다");
  assert.deepEqual(firstAnswerCell({ createdAt: null, answeredAt: null, awaiting: true }, now), { kind: "none", label: "—" });
});

// ── 구독 질문(스레드) ────────────────────────────────────────────────────────

test("스레드: 미답변 = pending 또는 first_answered_at 없음(지시서 §2) · 대기 판정 · 상태 사전 6값 · 오답노트/숙달 배지(unknown 은 없음)", () => {
  assert.equal(isThreadUnanswered({ status: "pending", first_answered_at: at(1) }), true);
  assert.equal(isThreadUnanswered({ status: "answered", first_answered_at: null }), true);
  assert.equal(isThreadUnanswered({ status: "confirmed", first_answered_at: at(1) }), false);
  assert.equal(isThreadUnanswered({ status: "open", first_answered_at: null }), true, "레거시 행도 같은 규칙");
  assert.equal(isThreadAwaitingAnswer({ status: "pending", first_answered_at: null }), true);
  assert.equal(isThreadAwaitingAnswer({ status: "open", first_answered_at: null }), true);
  assert.equal(isThreadAwaitingAnswer({ status: "confirmed", first_answered_at: null }), false, "확인·종료된 건은 경과를 세지 않는다");
  assert.equal(isThreadAwaitingAnswer({ status: "pending", first_answered_at: at(1) }), false);
  assert.deepEqual(adminStatusAllowedValues("question_threads", "status").sort(), ["answered", "archived", "closed", "confirmed", "open", "pending"]);
  assert.deepEqual(adminStatusAllowedValues("question_threads", "mastery_status").sort(), ["mastered", "review", "unknown", "wrong"]);
  assert.equal(threadStatusLabel("pending"), "답변 대기");
  assert.equal(threadStatusLabel("confirmed"), "학생 확인");
  assert.equal(resolveAdminStatus("question_threads", "status", "weird").known, false, "사전 밖 값도 throw 없음");
  assert.deepEqual(threadBadges({ is_wrong_answer: true, mastery_status: "review" }), [
    { label: "오답노트", tone: "danger" },
    { label: "복습 필요", tone: "warning" },
  ]);
  assert.deepEqual(threadBadges({ is_wrong_answer: false, mastery_status: "unknown" }), []);
  assert.deepEqual(threadBadges({ is_wrong_answer: null, mastery_status: "mastered" }), [{ label: "숙달", tone: "success" }]);
});

test("방 구독 상태: subscriptions.status 사전 · 구독 행 없음 → 해지됨(neutral)", () => {
  assert.equal(ROOM_SUBSCRIPTION_MISSING_LABEL, "해지됨");
  assert.deepEqual(roomSubscriptionStatus(null), { label: "해지됨", tone: "neutral", known: false });
  assert.deepEqual(roomSubscriptionStatus("active"), { label: "이용 중", tone: "success", known: true });
  assert.deepEqual(roomSubscriptionStatus("canceled"), { label: "해지", tone: "neutral", known: true });
});

// ── 개별질문 ────────────────────────────────────────────────────────────────

test("개별질문: 답변 멘토(지정형 designated · 공개형 claimed) · 지정/공개 배지 · 에스크로 상태 · 가격(원) · 자격 조건 · 대기 상태 집합", () => {
  assert.equal(individualAnsweringMentorId({ question_type: "direct", designated_mentor_id: UUID, claimed_mentor_id: null }), UUID);
  assert.equal(individualAnsweringMentorId({ question_type: "open", designated_mentor_id: null, claimed_mentor_id: UUID2 }), UUID2);
  assert.equal(individualAnsweringMentorId({ question_type: "open", designated_mentor_id: null, claimed_mentor_id: null }), null, "공개형 미배정 → —");
  assert.equal(individualAnsweringMentorId({ question_type: "open", designated_mentor_id: UUID, claimed_mentor_id: null }), null, "공개형은 claimed 만");
  assert.equal(individualTypeLabel("open"), "공개형");
  assert.equal(individualTypeLabel("direct"), "지정형");
  const led = { hold_ledger_id: null, release_ledger_id: null, refund_ledger_id: null };
  assert.equal(individualEscrowState({ status: "escrowed", ...led }), "held");
  assert.equal(individualEscrowState({ status: "released", ...led }), "released");
  assert.equal(individualEscrowState({ status: "refunded", ...led }), "refunded");
  assert.equal(individualEscrowState({ status: "expired", ...led, refund_ledger_id: UUID }), "refunded", "그 외 상태는 원장 id 로");
  assert.equal(individualEscrowState({ status: "assigned", ...led, hold_ledger_id: UUID }), "held");
  assert.equal(individualEscrowState({ status: "answered", ...led, hold_ledger_id: UUID, release_ledger_id: UUID2 }), "released");
  assert.equal(individualEscrowState({ status: "canceled", ...led }), "none");
  assert.deepEqual(ESCROW_STATE_LABELS, { held: "보관 중", released: "지급됨", refunded: "환불됨", none: "—" });
  assert.equal(formatIndividualPriceKrw(800000), "8,000원");
  assert.equal(formatIndividualPriceKrw(null), "0원");
  assert.equal(individualRequirementLabel({ required_school_tier: "서연고", required_major_category: "메디컬" }), "서연고 · 메디컬");
  assert.equal(individualRequirementLabel({ required_school_tier: null, required_major_category: null }), "없음");
  for (const s of ["escrowed", "assigned", "open", "claimed"]) assert.equal(isIndividualAwaitingAnswer(s), true, s);
  for (const s of ["answered", "released", "expired", "refunded", "canceled", ""]) assert.equal(isIndividualAwaitingAnswer(s), false, s);
});

// ── 연결노트 ────────────────────────────────────────────────────────────────

test("연결노트: created_at 순 전부 렌더 — 3건 픽스처(유니크 제약 2건 가정 없음) · 같은 시각은 id 순 안정 · 작성자 색 #059669/#2563EB", () => {
  const rows = [
    { id: "n2", created_at: atMin(21), author_role: "student", body: "네 감사합니다!" },
    { id: "n3", created_at: at(24), author_role: "mentor", body: "다음 주 수열" },
    { id: "n1", created_at: at(0), author_role: "mentor", body: "분모 0 패턴" },
  ];
  assert.deepEqual(sortConnectionNotesChronologically(rows).map((r) => r.id), ["n1", "n2", "n3"]);
  const five = ["e", "d", "c", "b", "a"].map((id) => ({ id, created_at: T0 }));
  assert.deepEqual(sortConnectionNotesChronologically(five).map((r) => r.id), ["a", "b", "c", "d", "e"], "건수 상한 없음 · 동시각 id 순");
  assert.deepEqual(sortConnectionNotesChronologically([{ id: "x", created_at: null }, { id: "y", created_at: T0 }]).map((r) => r.id), ["x", "y"], "시각 없는 행은 맨 앞(0)");
  assert.equal(connectionNoteAuthorRole({ author_role: "mentor" }), "mentor");
  assert.equal(connectionNoteAuthorRole({ author_role: "STUDENT" }), "student");
  assert.equal(connectionNoteAuthorRole({ author_role: null }), "unknown");
  assert.deepEqual(CONNECTION_NOTE_AUTHOR_COLORS, { mentor: "#059669", student: "#2563EB" });
  const timeline = stripComments(read(NOTE_TIMELINE));
  assert.ok(timeline.includes(`bg-[${CONNECTION_NOTE_AUTHOR_COLORS.mentor}]`) && timeline.includes(`bg-[${CONNECTION_NOTE_AUTHOR_COLORS.student}]`), "타임라인 색 = 지시서 값");
  assert.ok(timeline.includes("notes.rows.map((note)"), "배열 전부 순회");
  assert.ok(!/slice\(0,\s*2\)|rows\[1\]|rows\[0\]|length === 2|length <= 2/.test(timeline), "2건 가정 없음");
  assert.ok(!/ink_path|inkPath/.test(timeline), "ink_path 무시(텍스트만)");
  assert.ok(timeline.includes("EMPTY_CONNECTION_NOTES"), "빈 상태 문구(정본 상수)");
  const queries = stripComments(read(QUERIES));
  assert.ok(queries.includes('.from("connection_notes")') && queries.includes('.order("created_at", { ascending: true })') && !/\.limit\(\d+\)\s*;?\s*$/m.test(queries.split('.from("connection_notes")')[1].split(";")[0]), "연결노트 조회에 limit 없음");
  assert.ok(queries.includes("sortConnectionNotesChronologically(raw)"), "정렬 정본 사용");
});

// ── 질문 상세: 품질 지표 · 열람 기록 ────────────────────────────────────────

const FIXTURE_MESSAGES: ConversationMessage[] = [
  { id: "m1", authorId: UUID, authorRole: "student", body: "극한 문제가 안 풀려요", createdAt: T0 },
  { id: "m2", authorId: UUID2, authorRole: "mentor", body: "가".repeat(400) + "😀".repeat(20), createdAt: atMin(80) },
  { id: "m3", authorId: UUID, authorRole: "student", body: "아 이해했어요", createdAt: atMin(708) },
  { id: "m4", authorId: UUID2, authorRole: "mentor", body: "좋아요", createdAt: atMin(714) },
];

test("품질 지표: 첫 답변(first_answered_at · 없으면 첫 멘토 메시지) · 답변 길이 = 멘토 메시지 글자 수 합(코드 포인트) · 왕복 = 메시지 수 · 확인까지", () => {
  const m = buildQuestionQualityMetrics({ createdAt: T0, firstAnsweredAt: atMin(80), confirmedAt: at(12), messages: FIXTURE_MESSAGES });
  assert.equal(formatDurationKo(m.firstAnswerMs), "1시간 20분");
  assert.equal(m.answerLength, 423);
  assert.equal(formatAnswerLength(m.answerLength), "423자");
  assert.equal(m.roundTrips, 4);
  assert.equal(formatDurationKo(m.confirmMs), "12시간");
  const noFirst = buildQuestionQualityMetrics({ createdAt: T0, firstAnsweredAt: null, confirmedAt: null, messages: FIXTURE_MESSAGES });
  assert.equal(formatDurationKo(noFirst.firstAnswerMs), "1시간 20분", "first_answered_at 없으면 첫 멘토 메시지");
  assert.equal(noFirst.confirmMs, null);
  const unanswered = buildQuestionQualityMetrics({ createdAt: T0, firstAnsweredAt: null, confirmedAt: null, messages: [FIXTURE_MESSAGES[0]] });
  assert.deepEqual(unanswered, { firstAnswerMs: null, answerLength: 0, roundTrips: 1, confirmMs: null });
  assert.deepEqual(sortByCreatedAt([{ createdAt: at(2) }, { createdAt: null }, { createdAt: T0 }]).map((r) => r.createdAt), [null, T0, at(2)]);
});

test("열람 기록: 액션 question_body_viewed · 대상 question_thread/individual_question · detail 필드 · 처리 이력 라벨", () => {
  assert.equal(QUESTION_BODY_VIEWED_ACTION, "question_body_viewed");
  assert.deepEqual(QUESTION_BODY_VIEWED_TARGET_TYPES, { thread: "question_thread", individual: "individual_question" });
  const log = buildQuestionBodyViewedLog({ kind: "thread", id: UUID, roomId: UUID2, studentId: UUID, mentorId: UUID2, messageCount: 4, attachmentCount: 1 });
  assert.deepEqual(log, {
    actionType: "question_body_viewed",
    targetType: "question_thread",
    targetId: UUID,
    detail: { kind: "thread", roomId: UUID2, studentId: UUID, mentorId: UUID2, messageCount: 4, attachmentCount: 1 },
  });
  assert.equal(buildQuestionBodyViewedLog({ kind: "individual", id: UUID, roomId: null, studentId: UUID, mentorId: null, messageCount: -1, attachmentCount: 2.7 }).targetType, "individual_question");
  assert.equal(buildQuestionBodyViewedLog({ kind: "individual", id: UUID, roomId: null, studentId: UUID, mentorId: null, messageCount: -1, attachmentCount: 2.7 }).detail.messageCount, 0);
  assert.equal(accountActionLogLabel("question_body_viewed"), "질문 본문 열람");
});

// ── 첨부 · 필기 주석 · 서명 URL ─────────────────────────────────────────────

test("첨부 버킷 3종 = 저장소 정본(질문방 업로더 · 개별질문 업로더 · SQL 093) · storedRef 파싱은 허용 버킷만 · 뷰어 소스(1h · 실패는 error)", () => {
  assert.ok(read("lib/qna/questionRoomAttachmentStorage.ts").includes(`QUESTION_ROOM_ATTACHMENTS_BUCKET = "${QUESTION_ROOM_ATTACHMENTS_BUCKET_NAME}"`));
  assert.ok(read("lib/individualQuestion/individualQuestionAttachmentStorage.ts").includes(`INDIVIDUAL_QUESTION_ATTACHMENTS_BUCKET = "${INDIVIDUAL_QUESTION_ATTACHMENTS_BUCKET_NAME}"`));
  assert.ok(read("supabase/migrations/20260701000000_pre_ledger_baseline.sql").includes(`values ('${SCAN_ANNOTATIONS_BUCKET_NAME}', '${SCAN_ANNOTATIONS_BUCKET_NAME}', false)`));
  assert.equal(QUESTION_ATTACHMENT_SIGNED_URL_TTL_SEC, 60 * 60);
  assert.equal(formatQuestionAttachmentStoredRef("question-room-attachments", "/r/t/a.png"), "question-room-attachments/r/t/a.png");
  assert.deepEqual(parseQuestionAttachmentStoredRef("question-room-attachments/r/t/a.png"), { bucket: "question-room-attachments", path: "r/t/a.png" });
  assert.deepEqual(parseQuestionAttachmentStoredRef("scan-annotations/room/1-preview.png"), { bucket: "scan-annotations", path: "room/1-preview.png" });
  for (const bad of ["student-id-images/u/x.png", "question-room-attachments/", "question-room-attachments", "question-room-attachments/../x", "", "  ", "/question-room-attachments/x"]) {
    assert.equal(parseQuestionAttachmentStoredRef(bad), null, bad);
  }
  const ok = buildAttachmentViewerSource({ bucket: "question-room-attachments", path: "r/t/a.png", signedUrl: "https://s/x?token=1", mimeType: "image/png", issuedAt: 1_000_000 });
  assert.equal(ok.kind, "image");
  assert.equal(ok.expiresAt, 1_000_000 + 3_600_000);
  assert.equal(ok.error, null);
  assert.equal(ok.storedRef, "question-room-attachments/r/t/a.png");
  const pdf = buildAttachmentViewerSource({ bucket: "individual-question-attachments", path: "q/1-file.pdf", signedUrl: null, mimeType: null, issuedAt: 1 });
  assert.equal(pdf.kind, "pdf");
  assert.equal(pdf.expiresAt, null);
  assert.ok(pdf.error);
  assert.equal(isWebRenderableImageMime("image/jpeg"), true);
  assert.equal(isWebRenderableImageMime("image/heic"), false, "HEIC 는 파일 칩");
  assert.equal(attachmentFileNameFromPath(`r/t/${UUID}-문제.png`), "문제.png");
  assert.equal(attachmentFileNameFromPath("r/t/1725000000_scan.jpg"), "scan.jpg");
  assert.deepEqual(scanAnnotationDisplayPath({ scan_image_path: "r/1-original.jpg", preview_path: "r/1-preview.png", has_annotations: true }), { path: "r/1-preview.png", annotated: true });
  assert.deepEqual(scanAnnotationDisplayPath({ scan_image_path: "r/1-original.jpg", preview_path: null, has_annotations: false }), { path: "r/1-original.jpg", annotated: false });
  assert.equal(scanAnnotationDisplayPath({ scan_image_path: null, preview_path: null, has_annotations: false }), null);
});

test("주간 사용량 표기 · 빈 상태 문구 4종+", () => {
  assert.equal(formatWeeklyUsageShort({ used: 3, limit: 9 }), "3/9");
  assert.equal(formatWeeklyUsageShort({ used: 2, limit: 999 }), "2/무제한");
  assert.equal(formatWeeklyUsageShort(null), "—");
  assert.equal(EMPTY_STUDENT_INDIVIDUAL, "구매한 개별질문이 없습니다");
  assert.equal(EMPTY_STUDENT_ROOMS, "구독한 멘토가 없습니다");
  assert.equal(EMPTY_CONNECTION_NOTES, "아직 작성된 연결노트가 없습니다");
  assert.equal(EMPTY_MENTOR_ROOMS, "담당 학생이 없습니다");
  assert.equal(EMPTY_MENTOR_INDIVIDUAL, "답변한 개별질문이 없습니다");
  assert.equal(EMPTY_ROOM_THREADS, "이 방에는 아직 질문이 없습니다");
  assert.ok(read(INDIVIDUAL_TAB).includes("EMPTY_STUDENT_INDIVIDUAL") && read(INDIVIDUAL_TAB).includes("EMPTY_MENTOR_INDIVIDUAL"));
  assert.ok(read(ROOMS_TAB).includes("EMPTY_STUDENT_ROOMS") && read(ROOMS_TAB).includes("EMPTY_MENTOR_ROOMS"));
  assert.ok(read(THREAD_LIST).includes("EMPTY_ROOM_THREADS"));
});

// ── tripwire: 라우트 하나 · 양쪽에서 도달 · 공통 컴포넌트 · 열람 기록 · 서명 URL · 읽기 전용 ──

test("멘토별 화면은 라우트 하나 — 학생 [구독 멘토]·멘토 [담당 학생] 둘 다 buildQuestionRoomUrl 로 같은 경로에 간다(returnTo 만 다르다)", () => {
  assert.ok(existsSync(join(ROOT, ROOM_PAGE)), "라우트 파일");
  const consoleDir = join(ROOT, "app", "(admin)", "admin", "(console)");
  const roomLike = readdirSync(consoleDir).filter((d) => /room/i.test(d));
  assert.deepEqual(roomLike, ["question-rooms"], "방 화면 라우트는 하나");
  const rooms = stripComments(read(ROOMS_TAB));
  assert.ok(rooms.includes("buildQuestionRoomUrl(row.roomId, { returnTo })"), "행 → 멘토별 화면");
  assert.ok(rooms.includes('buildAccountDrilldownReturnPath(userId, variant === "student" ? "mentors" : "students")'), "returnTo 만 다르다");
  assert.ok(rooms.includes('variant: "student" | "mentor"'), "같은 컴포넌트 · 방향만 반대");
  assert.ok(rooms.includes("<AdminDataTable.Pagination") && rooms.includes("EmptyState"), "공용 페이지네이션 · 빈 상태");
  const page = stripComments(read(ROOM_PAGE));
  assert.ok(page.includes('await requireRole("admin");'), "페이지 가드(레이아웃 가드와 중복)");
  assert.ok(page.includes("resolveQuestionRoomReturnPath(pick(sp[QUESTION_DRILLDOWN_RETURN_TO_PARAM]))"), "returnTo 허용 목록");
  assert.ok(page.includes('buildAccountDrilldownReturnPath(overview.room.studentId, "mentors")'), "허용 밖이면 학생 상세 구독 멘토 탭");
  assert.ok(page.includes("<QuestionRoomHeader") && page.includes("<QuestionRoomThreadList") && page.includes("<ConnectionNoteTimeline"), "헤더 + 질문 탭 + 연결노트 탭");
  assert.ok(page.includes("selfReturnTo = buildQuestionRoomUrl(overview.room.id, { tab, returnTo })"), "질문 상세는 이 화면(탭·returnTo 포함)으로 돌아온다");
  const header = stripComments(read(ROOM_HEADER));
  assert.ok(/data-party="student"[\s\S]*\{studentName\}[\s\S]*data-party="mentor"[\s\S]*\{mentorName\}/.test(header), "학생 실명 × 멘토 닉네임 순서");
  assert.ok(header.includes("formatWeeklyUsageShort(usage)"), "이번 주 사용량 = RPC 값");
  const q = stripComments(read(QUERIES));
  assert.ok(q.includes("fetchWeeklyQuestionUsagePairParty(db, room.studentId, room.mentorId)"), "RPC get_weekly_question_usage(pair-party · service_role)");
  assert.ok(q.includes("studentName: studentDisplayName(") && q.includes("mentorName: mentorDisplayName("), "헤더 이름 규칙");
});

test("질문 상세: 두 라우트가 같은 틀(QuestionDetailScreen)과 같은 컴포넌트(QuestionConversationView)를 쓴다 · 렌더 시 열람 기록 정확히 1건 · 조치 버튼 없음", () => {
  const thread = stripComments(read(THREAD_PAGE));
  const individual = stripComments(read(INDIVIDUAL_PAGE));
  assert.ok(thread.includes('<QuestionDetailScreen kind="thread"') && individual.includes('<QuestionDetailScreen kind="individual"'));
  for (const src of [thread, individual]) {
    assert.ok(src.includes('const { user } = await requireRole("admin");'), "페이지 가드 + 열람 기록의 admin_id");
    assert.ok(src.includes("adminId={user.id}"));
  }
  const screen = stripComments(read(DETAIL_SCREEN));
  assert.equal((screen.match(/logAdminAction\(db, \{/g) ?? []).length, 1, "열람 기록 1건");
  assert.equal((screen.match(/buildQuestionBodyViewedLog\(\{/g) ?? []).length, 1);
  assert.ok(/if \(!conversation\) \{[\s\S]*\}\s*\n\s*await logAdminAction/.test(screen), "본문이 있을 때만(렌더 직전) 기록");
  assert.ok(screen.includes("<QuestionConversationView conversation={conversation} refreshSource={refreshQuestionAttachmentDocumentAction} />"));
  assert.ok(screen.includes("resolveQuestionDetailReturnPath(returnToRaw)"), "returnTo 허용 목록");
  const view = stripComments(read(CONVERSATION));
  assert.ok(view.includes('c.kind === "thread"') && view.includes("c.individual ?") && view.includes("data-question-kind={c.kind}"), "구독·개별 한 컴포넌트");
  assert.ok(view.includes("<QuestionAttachmentGallery") && view.includes("data-scan-annotations"), "첨부 갤러리 · 필기 주석 블록");
  assert.ok(view.includes("학생이 확인함") && view.includes("품질 지표") && view.includes("ESCROW_STATE_LABELS[c.individual.escrow]"), "확인 줄 · 품질 지표 · 개별질문 요약");
  assert.ok(!/<form\b|formAction|ConfirmSubmitButton|<button\b/.test(view), "조치 버튼·폼 없음(읽기 전용)");
  assert.ok(!/<form\b|ConfirmSubmitButton/.test(screen));
  assert.ok(!/신고 접수<|멘토에게 안내<|CSV|내보내기/.test(view + screen), "후속 PR 기능 없음");
  for (const rel of [INDIVIDUAL_TAB, THREAD_LIST]) {
    const src = stripComments(read(rel));
    assert.ok(/buildIndividualQuestionUrl\(row\.id, \{ returnTo \}\)[^>]*prefetch=\{false\}|buildQuestionThreadUrl\(row\.id, \{ returnTo \}\)[^>]*prefetch=\{false\}/.test(src), `${rel}: 상세 링크는 prefetch 없이(프리페치가 열람 기록을 남기지 않게)`);
  }
});

test("첨부: 서명 URL 은 서버(조회 모듈)에서 · 클릭 확대는 PR-2 DocumentViewer · 재요청은 허용 버킷 전용 읽기 액션(prop 으로 주입, 기본 학생증 액션 유지)", () => {
  const q = stripComments(read(QUERIES));
  assert.ok(q.includes("createSignedStorageUrl(db, bucket, path, QUESTION_ATTACHMENT_SIGNED_URL_TTL_SEC)"), "서명 URL 서버 발급");
  assert.ok(q.includes("toAttachmentViews(db, QUESTION_ROOM_ATTACHMENTS_BUCKET_NAME, rawAttachments)") && q.includes("toAttachmentViews(db, INDIVIDUAL_QUESTION_ATTACHMENTS_BUCKET_NAME, rawAttachments)"));
  assert.ok(q.includes('.from("scan_annotations")') && q.includes("SCAN_ANNOTATIONS_BUCKET_NAME, display.path"), "필기 주석 = 방 단위 · preview 우선");
  const gallery = stripComments(read(GALLERY));
  assert.ok(gallery.startsWith('"use client"') && gallery.includes("<DocumentViewer") && gallery.includes("refreshSource={refreshSource}") && gallery.includes("initialSource={open.source}"));
  assert.ok(!/createSignedUrl|createServiceRoleClient|SUPABASE_SERVICE_ROLE_KEY/.test(gallery), "클라이언트는 서명하지 않는다");
  const viewer = stripComments(read(VIEWER));
  assert.ok(viewer.includes("refreshSource?: (storedRef: string) => Promise<DocumentViewerSource>;"), "선택 prop 하나");
  assert.ok(viewer.includes("refreshSource ? await refreshSource(storagePath) : await refreshStudentIdDocumentAction(storagePath)"), "기본 동작(학생증 액션) 유지");
  const action = stripComments(read(DOC_ACTION));
  assert.ok(action.startsWith('"use server"') && action.includes('await requireRole("admin");') && action.includes("describeQuestionAttachmentDocument(db, ref)"));
  assert.ok(!/\.insert\(|\.update\(|\.delete\(|\.upsert\(|\.rpc\(/.test(action), "읽기 전용 액션");
});

test("DB·RPC·정책 변경 0 · 조회 모듈은 읽기 전용(쓰기 없음 · 직접 .rpc 없음 · server-only) · 순수 모듈은 React·@/ import 없음 · AdminDataTable prop 추가 0", () => {
  const q = stripComments(read(QUERIES));
  assert.ok(q.startsWith('import "server-only";'));
  assert.ok(!/\.insert\(|\.update\(|\.delete\(|\.upsert\(/.test(q), "쓰기 없음");
  assert.ok(!/\.rpc\(/.test(q), "직접 RPC 호출 없음(주간 사용량은 기존 래퍼 import)");
  assert.ok(!q.includes('"use server"'));
  const pure = stripComments(read(PURE));
  assert.ok(!/from "react"|from "@\//.test(pure), "순수 모듈");
  const serverFiles = [...walk(join(ROOT, "lib", "admin"), []), ...walk(join(ROOT, "components", "admin"), [])]
    .filter((f) => /questionDrilldown|Question[A-Z]\w+\.tsx$|ConnectionNoteTimeline|AccountIndividualQuestionsTab|AccountRoomsTab/.test(f))
    .filter((f) => readFileSync(f, "utf8").includes('"use server"'))
    .map((f) => f.slice(ROOT.length).replace(/\\/g, "/"));
  assert.deepEqual(serverFiles, [DOC_ACTION], "새 서버 액션은 서명 URL 재요청(읽기) 하나뿐");
  const table = read("components/admin/AdminDataTable.tsx");
  assert.ok(table.includes("type PaginationProps = {\n  basePath: string;\n  params: AdminListParams;\n  /** 필터(탭·검색) 후 건수 */\n  totalCount: number;\n  rowsOnPage: number;\n  /** 배치 클래스 — 카드 안 하단(border-t)인지 독립 카드인지는 화면이 정한다 */\n  className: string;\n};"), "Pagination prop 그대로");
  assert.ok(!/\?:/.test(stripComments(table).split("export const AdminDataTable")[0].replace(/\/\*\*[^*]*\*\//g, "")), "선택 prop 없음 유지");
  const migrations = readdirSync(join(ROOT, "supabase", "migrations")).filter((f) => f.endsWith(".sql"));
  for (const f of migrations) assert.ok(!read(`supabase/migrations/${f}`).includes("question_body_viewed"), `${f}: 이 PR 은 DB 변경 0`);
});

test("UI 카피 금지어 없음(선생님·강사님·수강생·과외·alert) · 인라인 style 없음 · 학생 이름 열은 실명 문구", () => {
  for (const rel of NEW_FILES) {
    const code = stripComments(read(rel));
    for (const banned of ["선생님", "강사님", "수강생", "과외", "커패니티", "웰버십", "쌤버쉽", "alert("]) assert.ok(!code.includes(banned), `${rel}: 금지 문구 ${banned}`);
    assert.ok(!/style=\{/.test(code), `${rel}: 인라인 style 금지`);
  }
  const accountPage = stripComments(read(ACCOUNT_PAGE));
  assert.ok(accountPage.includes("loadIndividualQuestionsForAccount(db, { role: drilldownRole") && accountPage.includes("loadRoomsForAccount(db, { role: drilldownRole"), "계정 상세가 드릴다운 조회를 탭별로만 호출");
  assert.ok(!stripComments(read(TABS)).includes("PR-8"), "탭에 PR-8 꼬리표 없음");
});
