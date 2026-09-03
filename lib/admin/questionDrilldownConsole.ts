/**
 * 질문 · 연결노트 드릴다운(PR-8)의 순수 규칙 — 계정 상세의 개별질문·구독 멘토·담당 학생·개별질문 답변 탭, 멘토별 화면(학생 × 멘토 한 쌍),
 * 질문 상세(구독·개별 공통)가 함께 쓴다.
 *
 * - 구조(지시서 §확정된 구조): 개별질문은 **질문**이 단위(건별 구매 · 멘토가 매번 다르다), 구독은 **멘토**가 단위(방 = `mentor_student_rooms` 한 행).
 *   연결노트는 구독 관계(방)에만 있다.
 * - 실명 규칙(원칙 1): 학생은 `users.full_name`, 멘토는 `users.nickname`. 마스킹·익명화·토글 없음.
 * - 멘토별 화면은 **라우트 하나**(`/admin/question-rooms/<roomId>`) — 학생 쪽에서 멘토를 눌러도, 멘토 쪽에서 학생을 눌러도 같은 화면.
 *   `returnTo` 는 PR-6·7 허용 목록 방식 — `/admin/users/<uuid>` 만(탭 파라미터는 이 화면으로 오는 탭 3종만 남긴다).
 * - 질문 상세는 **하나의 컴포넌트** — 구독질문(`question_threads`)과 개별질문(`individual_questions`)을 같은 화면으로 그린다.
 *   `returnTo` 는 계정 상세 또는 멘토별 화면(그 화면의 `returnTo` 까지 한 겹) 만 허용.
 * - 열람 기록(원칙 3): 본문을 렌더할 때 `admin_action_logs` 에 `question_body_viewed` 한 줄. 화면에는 아무것도 뜨지 않는다.
 * - 연결노트는 `created_at` 순으로 **전부** 렌더한다 — 건수 가정(유니크 제약의 방당 2건) 없음.
 *
 * node --test 계약 테스트가 직접 import 하므로 React·`@/` import 를 두지 않는다.
 */
import { classifyDocumentKind, type DocumentViewerSource } from "./documentViewerModel.ts";
import { resolveAdminStatus } from "./adminStatusDictionary.ts";

// ── 경로 ─────────────────────────────────────────────────────────────────────

export const ACCOUNT_DETAIL_BASE_PATH = "/admin/users";
export const QUESTION_ROOM_BASE_PATH = "/admin/question-rooms";
export const QUESTION_THREAD_BASE_PATH = "/admin/question-threads";
export const INDIVIDUAL_QUESTION_BASE_PATH = "/admin/individual-questions";

export const QUESTION_DRILLDOWN_RETURN_TO_PARAM = "returnTo";
export const QUESTION_ROOM_TAB_PARAM = "tab";
export const QUESTION_DRILLDOWN_PAGE_SIZE = 25;

const UUID_PATTERN = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

function encodeId(id: string): string {
  return encodeURIComponent(String(id ?? "").trim());
}

function withQuery(path: string, usp: URLSearchParams): string {
  const qs = usp.toString();
  return qs ? `${path}?${qs}` : path;
}

export function questionRoomPath(roomId: string): string {
  return `${QUESTION_ROOM_BASE_PATH}/${encodeId(roomId)}`;
}

export function questionThreadPath(threadId: string): string {
  return `${QUESTION_THREAD_BASE_PATH}/${encodeId(threadId)}`;
}

export function individualQuestionPath(questionId: string): string {
  return `${INDIVIDUAL_QUESTION_BASE_PATH}/${encodeId(questionId)}`;
}

// ── 멘토별 화면 탭 ───────────────────────────────────────────────────────────

export const QUESTION_ROOM_TAB_VALUES = ["questions", "notes"] as const;
export type QuestionRoomTab = (typeof QUESTION_ROOM_TAB_VALUES)[number];
export const QUESTION_ROOM_TABS: readonly { value: QuestionRoomTab; label: string }[] = [
  { value: "questions", label: "질문" },
  { value: "notes", label: "연결노트" },
];

export function resolveQuestionRoomTab(raw: string | null | undefined): QuestionRoomTab {
  const s = String(raw ?? "").trim().toLowerCase();
  return (QUESTION_ROOM_TAB_VALUES as readonly string[]).includes(s) ? (s as QuestionRoomTab) : "questions";
}

/** 계정 상세 탭 중 이 드릴다운으로 이어지는 탭 — `returnTo` 가 이 값만 남긴다. */
export const ACCOUNT_DRILLDOWN_TABS = ["individual", "mentors", "students", "answers"] as const;
export type AccountDrilldownTab = (typeof ACCOUNT_DRILLDOWN_TABS)[number];

function isAccountDrilldownTab(value: string): value is AccountDrilldownTab {
  return (ACCOUNT_DRILLDOWN_TABS as readonly string[]).includes(value);
}

export function buildAccountDrilldownReturnPath(userId: string, tab: AccountDrilldownTab): string {
  return `${ACCOUNT_DETAIL_BASE_PATH}/${encodeId(userId)}?tab=${tab}`;
}

export function buildQuestionRoomUrl(roomId: string, opts: { tab?: QuestionRoomTab | null; returnTo?: string | null; page?: number | null } = {}): string {
  const usp = new URLSearchParams();
  if (opts.tab && opts.tab !== "questions") usp.set(QUESTION_ROOM_TAB_PARAM, opts.tab);
  if (opts.page && opts.page > 1) usp.set("page", String(Math.trunc(opts.page)));
  if (opts.returnTo) usp.set(QUESTION_DRILLDOWN_RETURN_TO_PARAM, opts.returnTo);
  return withQuery(questionRoomPath(roomId), usp);
}

export function buildQuestionThreadUrl(threadId: string, opts: { returnTo?: string | null } = {}): string {
  const usp = new URLSearchParams();
  if (opts.returnTo) usp.set(QUESTION_DRILLDOWN_RETURN_TO_PARAM, opts.returnTo);
  return withQuery(questionThreadPath(threadId), usp);
}

export function buildIndividualQuestionUrl(questionId: string, opts: { returnTo?: string | null } = {}): string {
  const usp = new URLSearchParams();
  if (opts.returnTo) usp.set(QUESTION_DRILLDOWN_RETURN_TO_PARAM, opts.returnTo);
  return withQuery(individualQuestionPath(questionId), usp);
}

// ── returnTo 허용 목록(open redirect 방지) ───────────────────────────────────

type ParsedRelative = { path: string; params: URLSearchParams } | null;

/** 상대 경로만 받는다 — 스킴·호스트·`//` 는 거부. 잘못된 인코딩도 거부. */
function parseRelative(raw: string | null | undefined): ParsedRelative {
  const s = typeof raw === "string" ? raw.trim() : "";
  if (!s || !s.startsWith("/") || s.startsWith("//") || s.includes("\\")) return null;
  try {
    const u = new URL(s, "https://ssambership.local");
    if (u.origin !== "https://ssambership.local" || u.hash) return null;
    const path = decodeURIComponent(u.pathname);
    if (path.includes("..")) return null;
    return { path, params: u.searchParams };
  } catch {
    return null;
  }
}

/**
 * 멘토별 화면의 `returnTo` — 계정 상세 `/admin/users/<uuid>` 만 허용한다(지시서 §3).
 * 탭 파라미터는 이 드릴다운으로 오는 탭(individual·mentors·students·answers)만 남기고 그 외 쿼리는 버린다. 허용 밖이면 null(호출부가 기본 경로를 정한다).
 */
export function resolveQuestionRoomReturnPath(raw: string | null | undefined): string | null {
  const parsed = parseRelative(raw);
  if (!parsed) return null;
  const m = /^\/admin\/users\/([^/]+)$/.exec(parsed.path);
  if (!m || !isUuid(m[1])) return null;
  const tab = String(parsed.params.get("tab") ?? "").trim().toLowerCase();
  const usp = new URLSearchParams();
  if (isAccountDrilldownTab(tab)) usp.set("tab", tab);
  return withQuery(`${ACCOUNT_DETAIL_BASE_PATH}/${m[1]}`, usp);
}

/**
 * 질문 상세의 `returnTo` — 계정 상세(위와 같은 규칙) 또는 멘토별 화면 `/admin/question-rooms/<uuid>`(탭 + 그 화면의 `returnTo` 한 겹)만 허용.
 * 허용 밖이면 null.
 */
export function resolveQuestionDetailReturnPath(raw: string | null | undefined): string | null {
  const account = resolveQuestionRoomReturnPath(raw);
  if (account) return account;
  const parsed = parseRelative(raw);
  if (!parsed) return null;
  const m = /^\/admin\/question-rooms\/([^/]+)$/.exec(parsed.path);
  if (!m || !isUuid(m[1])) return null;
  const tab = parsed.params.get(QUESTION_ROOM_TAB_PARAM);
  const nested = resolveQuestionRoomReturnPath(parsed.params.get(QUESTION_DRILLDOWN_RETURN_TO_PARAM));
  return buildQuestionRoomUrl(m[1], { tab: resolveQuestionRoomTab(tab), returnTo: nested });
}

export const RETURN_LINK_LABEL_ACCOUNT = "← 계정 상세";
export const RETURN_LINK_LABEL_ROOM = "← 멘토별 화면";

/** `←` 링크의 문구 — 돌아갈 곳이 계정 상세인지 멘토별 화면인지. */
export function returnLinkLabel(returnPath: string): string {
  return returnPath.startsWith(`${QUESTION_ROOM_BASE_PATH}/`) ? RETURN_LINK_LABEL_ROOM : RETURN_LINK_LABEL_ACCOUNT;
}

// ── 이름 규칙(원칙 1) ────────────────────────────────────────────────────────

export type PartyIdentity = {
  id: string;
  role: string | null;
  fullName: string | null;
  nickname: string | null;
  email: string | null;
};

function nonEmpty(v: string | null | undefined): string | null {
  const s = typeof v === "string" ? v.trim() : "";
  return s || null;
}

function idTail(id: string | null | undefined): string {
  return String(id ?? "").slice(0, 8) || "—";
}

/** 학생 = 실명(`full_name`). 없으면 닉네임 → 이메일 → id 앞 8자. */
export function studentDisplayName(user: PartyIdentity | null | undefined, fallbackId?: string | null): string {
  if (!user) return idTail(fallbackId);
  return nonEmpty(user.fullName) ?? nonEmpty(user.nickname) ?? nonEmpty(user.email) ?? idTail(user.id);
}

/** 멘토 = 닉네임(`nickname`). 없으면 실명 → 이메일 → id 앞 8자. */
export function mentorDisplayName(user: PartyIdentity | null | undefined, fallbackId?: string | null): string {
  if (!user) return idTail(fallbackId);
  return nonEmpty(user.nickname) ?? nonEmpty(user.fullName) ?? nonEmpty(user.email) ?? idTail(user.id);
}

export type PartyRole = "student" | "mentor" | "admin" | "unknown";

export const PARTY_ROLE_LABELS: Readonly<Record<PartyRole, string>> = {
  student: "학생",
  mentor: "멘토",
  admin: "관리자",
  unknown: "알 수 없음",
};

/**
 * 메시지 작성자의 역할 — 방(또는 개별질문)의 당사자 id 와 먼저 맞추고, 아니면 `users.role`.
 * 당사자 대조가 우선인 이유: 역할이 바뀐 계정(학생→멘토 전환 등)도 그 대화 안에서는 당시 자리로 보인다.
 */
export function resolveMessageAuthorRole(authorId: string | null | undefined, party: { studentId: string | null; mentorId: string | null }, userRole: string | null | undefined): PartyRole {
  const id = String(authorId ?? "").trim();
  if (id && party.studentId && id === party.studentId) return "student";
  if (id && party.mentorId && id === party.mentorId) return "mentor";
  const r = String(userRole ?? "").trim().toLowerCase();
  if (r === "student" || r === "mentor" || r === "admin") return r;
  return "unknown";
}

/** 역할별 표시 이름 — 학생은 실명, 멘토는 닉네임, 그 외는 실명 → 닉네임 순. */
export function displayNameForRole(role: PartyRole, user: PartyIdentity | null | undefined, fallbackId?: string | null): string {
  return role === "mentor" ? mentorDisplayName(user, fallbackId) : studentDisplayName(user, fallbackId);
}

// ── 시간 ─────────────────────────────────────────────────────────────────────

const HOUR_MS = 60 * 60 * 1000;

export function timeOf(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? null : t;
}

/** `to - from`(ms). 어느 한쪽이 없거나 파싱 불가면 null. 음수는 0. */
export function durationMs(fromIso: string | null | undefined, toIso: string | null | undefined): number | null {
  const a = timeOf(fromIso);
  const b = timeOf(toIso);
  if (a == null || b == null) return null;
  return Math.max(0, b - a);
}

/** `1시간 20분` · `3일 4시간` · `12분` · `1분 미만`. null 은 `—`. */
export function formatDurationKo(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return "—";
  const totalMinutes = Math.floor(ms / 60_000);
  if (totalMinutes < 1) return "1분 미만";
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return hours > 0 ? `${days}일 ${hours}시간` : `${days}일`;
  if (hours > 0) return minutes > 0 ? `${hours}시간 ${minutes}분` : `${hours}시간`;
  return `${minutes}분`;
}

export const UNANSWERED_WARNING_HOURS = 24;
export const UNANSWERED_DANGER_HOURS = 48;

export type ElapsedTone = "neutral" | "warning" | "danger";

/** 미답변 경과 톤 — 24h 주의, 48h 위험(지시서 §1). */
export function unansweredElapsedTone(ms: number | null | undefined): ElapsedTone {
  if (ms == null || !Number.isFinite(ms)) return "neutral";
  if (ms >= UNANSWERED_DANGER_HOURS * HOUR_MS) return "danger";
  if (ms >= UNANSWERED_WARNING_HOURS * HOUR_MS) return "warning";
  return "neutral";
}

export type FirstAnswerCell =
  | { kind: "answered"; label: string }
  | { kind: "elapsed"; label: string; tone: ElapsedTone }
  | { kind: "none"; label: "—" };

/**
 * "첫 답변까지" 칸 — 답변됐으면 `answeredAt - createdAt`, 아직이면(그리고 여전히 답변을 기다리는 상태면) `now - createdAt` 경과 + 톤.
 * 답변 없이 끝난 건(만료·환불·취소 등)은 `—`.
 */
export function firstAnswerCell(input: { createdAt: string | null; answeredAt: string | null; awaiting: boolean }, now: number = Date.now()): FirstAnswerCell {
  if (input.answeredAt) {
    const ms = durationMs(input.createdAt, input.answeredAt);
    return { kind: "answered", label: formatDurationKo(ms) };
  }
  if (!input.awaiting) return { kind: "none", label: "—" };
  const created = timeOf(input.createdAt);
  if (created == null) return { kind: "none", label: "—" };
  const ms = Math.max(0, now - created);
  return { kind: "elapsed", label: `${formatDurationKo(ms)} 경과`, tone: unansweredElapsedTone(ms) };
}

// ── 구독 질문(스레드) ────────────────────────────────────────────────────────

export type QuestionThreadStatus = "pending" | "answered" | "confirmed" | "open" | "closed" | "archived";

/** 미답변 판정(지시서 §2) — `status='pending'` 또는 `first_answered_at IS NULL`. 레거시(open/closed/archived) 행도 이 규칙 그대로. */
export function isThreadUnanswered(row: { status: string | null; first_answered_at: string | null }): boolean {
  return String(row.status ?? "").trim().toLowerCase() === "pending" || !row.first_answered_at;
}

/** 아직 답변을 기다리는 스레드인가 — 경과 시간을 보여줄지 결정한다(종료·확인된 건은 경과를 세지 않는다). */
export function isThreadAwaitingAnswer(row: { status: string | null; first_answered_at: string | null }): boolean {
  const s = String(row.status ?? "").trim().toLowerCase();
  if (row.first_answered_at) return false;
  return s === "pending" || s === "open" || s === "";
}

export function threadStatusLabel(status: unknown): string {
  return resolveAdminStatus("question_threads", "status", status).label;
}

export function masteryStatusLabel(status: unknown): string {
  return resolveAdminStatus("question_threads", "mastery_status", status).label;
}

/** 오답노트 표시 · 숙달 상태 배지 — `unknown` 은 배지를 만들지 않는다(정보 없음). */
export function threadBadges(row: { is_wrong_answer: boolean | null; mastery_status: string | null }): { label: string; tone: "danger" | "warning" | "success" | "neutral" }[] {
  const out: { label: string; tone: "danger" | "warning" | "success" | "neutral" }[] = [];
  if (row.is_wrong_answer === true) out.push({ label: "오답노트", tone: "danger" });
  const m = String(row.mastery_status ?? "").trim().toLowerCase();
  if (m && m !== "unknown") {
    const resolved = resolveAdminStatus("question_threads", "mastery_status", m);
    out.push({ label: resolved.label, tone: resolved.tone === "danger" ? "danger" : resolved.tone === "warning" ? "warning" : resolved.tone === "success" ? "success" : "neutral" });
  }
  return out;
}

export const ROOM_SUBSCRIPTION_MISSING_LABEL = "해지됨";

/** 방의 구독 상태 라벨·톤 — `subscriptions.status` 사전. 방은 있는데 구독 행이 없으면 `해지됨`(neutral). */
export function roomSubscriptionStatus(status: string | null | undefined): { label: string; tone: "neutral" | "info" | "success" | "warning" | "danger"; known: boolean } {
  const s = String(status ?? "").trim();
  if (!s) return { label: ROOM_SUBSCRIPTION_MISSING_LABEL, tone: "neutral", known: false };
  const r = resolveAdminStatus("subscriptions", "status", s);
  return { label: r.label, tone: r.tone, known: r.known };
}

// ── 개별질문 ────────────────────────────────────────────────────────────────

export const INDIVIDUAL_AWAITING_STATUSES: readonly string[] = ["escrowed", "assigned", "open", "claimed"];

export function isIndividualAwaitingAnswer(status: string | null | undefined): boolean {
  return INDIVIDUAL_AWAITING_STATUSES.includes(String(status ?? "").trim().toLowerCase());
}

/** 답변 멘토 id — 지정형은 `designated_mentor_id`, 공개형은 `claimed_mentor_id`(없으면 null). */
export function individualAnsweringMentorId(row: { question_type: string | null; designated_mentor_id: string | null; claimed_mentor_id: string | null }): string | null {
  const type = String(row.question_type ?? "").trim().toLowerCase();
  const designated = nonEmpty(row.designated_mentor_id);
  const claimed = nonEmpty(row.claimed_mentor_id);
  if (type === "open") return claimed ?? null;
  return designated ?? claimed ?? null;
}

export function individualTypeLabel(questionType: string | null | undefined): string {
  return String(questionType ?? "").trim().toLowerCase() === "open" ? "공개형" : "지정형";
}

export type EscrowState = "held" | "released" | "refunded" | "none";
export const ESCROW_STATE_LABELS: Readonly<Record<EscrowState, string>> = {
  held: "보관 중",
  released: "지급됨",
  refunded: "환불됨",
  none: "—",
};

/**
 * 안전결제(에스크로) 상태 — `escrowed 보관 중 / released 지급됨 / refunded 환불됨`(지시서 §4).
 * 그 밖의 상태는 원장 id 로 판정한다: 지급 원장 → 지급됨, 환불 원장 → 환불됨, 예치 원장만 → 보관 중, 아무것도 없으면 `—`.
 */
export function individualEscrowState(row: { status: string | null; hold_ledger_id: string | null; release_ledger_id: string | null; refund_ledger_id: string | null }): EscrowState {
  const s = String(row.status ?? "").trim().toLowerCase();
  if (s === "escrowed") return "held";
  if (s === "released") return "released";
  if (s === "refunded") return "refunded";
  if (row.release_ledger_id) return "released";
  if (row.refund_ledger_id) return "refunded";
  if (row.hold_ledger_id) return "held";
  return "none";
}

/** `price_cents`(캐시×100) → 원 단위 정수 표시(`8,000원`). */
export function formatIndividualPriceKrw(priceCents: number | null | undefined): string {
  const cents = typeof priceCents === "number" && Number.isFinite(priceCents) ? priceCents : 0;
  return `${Math.floor(Math.abs(cents) / 100).toLocaleString("ko-KR")}원`;
}

/** 자격 조건 한 줄 — 학교 등급 · 계열. 둘 다 없으면 `없음`. */
export function individualRequirementLabel(row: { required_school_tier: string | null; required_major_category: string | null }): string {
  const parts = [nonEmpty(row.required_school_tier), nonEmpty(row.required_major_category)].filter((v): v is string => Boolean(v));
  return parts.length ? parts.join(" · ") : "없음";
}

// ── 연결노트 ────────────────────────────────────────────────────────────────

export type ConnectionNoteRow = {
  id: string;
  author_id: string | null;
  author_role: string | null;
  body: string | null;
  created_at: string | null;
};

/** 멘토 `#059669` · 학생 `#2563EB`(지시서 §3). Tailwind 임의값 클래스는 컴포넌트가 이 값으로 만든다. */
export const CONNECTION_NOTE_AUTHOR_COLORS = { mentor: "#059669", student: "#2563EB" } as const;

export function connectionNoteAuthorRole(row: { author_role: string | null }): "mentor" | "student" | "unknown" {
  const r = String(row.author_role ?? "").trim().toLowerCase();
  return r === "mentor" || r === "student" ? r : "unknown";
}

/**
 * `created_at` 오름차순 — 건수 가정 없음(유니크 제약이 풀리면 그대로 더 보인다). 같은 시각은 id 순으로 안정.
 * `ink_path` 는 저장·표시 코드가 없다고 확인됐다 — 값이 있어도 무시하고 텍스트만 그린다.
 */
export function sortConnectionNotesChronologically<T extends { id: string; created_at: string | null }>(rows: readonly T[]): T[] {
  return [...rows]
    .map((row, idx) => ({ row, idx, t: timeOf(row.created_at) ?? 0 }))
    .sort((a, b) => a.t - b.t || a.row.id.localeCompare(b.row.id) || a.idx - b.idx)
    .map((w) => w.row);
}

// ── 질문 상세: 품질 지표 ─────────────────────────────────────────────────────

export type ConversationMessage = {
  id: string;
  authorId: string | null;
  authorRole: PartyRole;
  body: string;
  createdAt: string | null;
};

export type QuestionQualityMetrics = {
  /** 첫 답변까지(ms) — `first_answered_at`(없으면 첫 멘토 메시지) − 질문 생성. 없으면 null */
  firstAnswerMs: number | null;
  /** 멘토 메시지 글자 수 합 */
  answerLength: number;
  /** 왕복 = 메시지 수 */
  roundTrips: number;
  /** 확인까지(ms) — `confirmed_at` − 질문 생성. 없으면 null */
  confirmMs: number | null;
};

export function buildQuestionQualityMetrics(input: { createdAt: string | null; firstAnsweredAt: string | null; confirmedAt: string | null; messages: readonly ConversationMessage[] }): QuestionQualityMetrics {
  const mentorMessages = input.messages.filter((m) => m.authorRole === "mentor");
  const firstMentorAt = mentorMessages.map((m) => m.createdAt).find((t) => timeOf(t) != null) ?? null;
  return {
    firstAnswerMs: durationMs(input.createdAt, input.firstAnsweredAt ?? firstMentorAt),
    answerLength: mentorMessages.reduce((sum, m) => sum + [...String(m.body ?? "")].length, 0),
    roundTrips: input.messages.length,
    confirmMs: durationMs(input.createdAt, input.confirmedAt),
  };
}

export function formatAnswerLength(chars: number): string {
  return `${Math.max(0, Math.trunc(chars)).toLocaleString("ko-KR")}자`;
}

/** 시간순 정렬(안정) — 메시지·첨부·주석 어디에나. */
export function sortByCreatedAt<T extends { createdAt: string | null }>(rows: readonly T[]): T[] {
  return [...rows]
    .map((row, idx) => ({ row, idx, t: timeOf(row.createdAt) ?? 0 }))
    .sort((a, b) => a.t - b.t || a.idx - b.idx)
    .map((w) => w.row);
}

// ── 첨부 · 필기 주석 ─────────────────────────────────────────────────────────

/** 질문 첨부가 사는 비공개 버킷 — `lib/qna/questionRoomAttachmentStorage.ts` · `lib/individualQuestion/individualQuestionAttachmentStorage.ts` · SQL 093 과 같은 값(계약 테스트가 대조). */
export const QUESTION_ROOM_ATTACHMENTS_BUCKET_NAME = "question-room-attachments";
export const INDIVIDUAL_QUESTION_ATTACHMENTS_BUCKET_NAME = "individual-question-attachments";
export const SCAN_ANNOTATIONS_BUCKET_NAME = "scan-annotations";

export const QUESTION_ATTACHMENT_BUCKETS: readonly string[] = [QUESTION_ROOM_ATTACHMENTS_BUCKET_NAME, INDIVIDUAL_QUESTION_ATTACHMENTS_BUCKET_NAME, SCAN_ANNOTATIONS_BUCKET_NAME];

/** 서명 URL TTL — 질문방 첨부 v2 계약(표시 시점 발급 1h)과 같다. */
export const QUESTION_ATTACHMENT_SIGNED_URL_TTL_SEC = 60 * 60;

/** 뷰어 재요청 키 — `bucket/path`. 버킷은 허용 3종만. */
export function formatQuestionAttachmentStoredRef(bucket: string, path: string): string {
  return `${bucket}/${String(path ?? "").replace(/^\/+/, "")}`;
}

export function parseQuestionAttachmentStoredRef(storedRef: string | null | undefined): { bucket: string; path: string } | null {
  const raw = typeof storedRef === "string" ? storedRef.trim() : "";
  if (!raw) return null;
  const idx = raw.indexOf("/");
  if (idx <= 0) return null;
  const bucket = raw.slice(0, idx);
  const path = raw.slice(idx + 1).replace(/^\/+/, "");
  if (!QUESTION_ATTACHMENT_BUCKETS.includes(bucket) || !path || path.includes("..")) return null;
  return { bucket, path };
}

export function isWebRenderableImageMime(mime: string | null | undefined): boolean {
  return typeof mime === "string" && /^image\/(png|jpe?g|webp|gif|avif)$/i.test(mime.trim());
}

export function attachmentFileNameFromPath(storagePath: string): string {
  const tail = storagePath.split("/").pop() ?? storagePath;
  const m = tail.match(/^(?:[0-9a-fA-F-]{36}-|\d{10,}_)(.+)$/);
  return (m?.[1] ?? tail) || "첨부 파일";
}

/** 서명 URL 결과 → 뷰어 소스. 발급 실패도 throw 하지 않고 `error` 로. */
export function buildAttachmentViewerSource(input: { bucket: string; path: string; signedUrl: string | null; mimeType: string | null; issuedAt: number; ttlSec?: number }): DocumentViewerSource {
  const ttl = input.ttlSec ?? QUESTION_ATTACHMENT_SIGNED_URL_TTL_SEC;
  return {
    storedRef: formatQuestionAttachmentStoredRef(input.bucket, input.path),
    storagePath: input.path,
    signedUrl: input.signedUrl,
    mimeType: input.mimeType,
    sizeBytes: null,
    kind: classifyDocumentKind(input.mimeType, input.path),
    expiresAt: input.signedUrl ? input.issuedAt + ttl * 1000 : null,
    error: input.signedUrl ? null : "첨부 링크를 발급하지 못했습니다. 다시 시도해 주세요.",
  };
}

/**
 * 필기 주석(`scan_annotations`)의 표시 이미지 — 주석이 구워진 `preview_path` 가 있으면 그것, 없으면 원본 `scan_image_path`.
 * 행은 **방 단위**(스레드·첨부 FK 없음)라 첨부 위에 겹칠 수 없다 — 질문 상세에서는 별도 이미지 블록으로 그린다.
 */
export function scanAnnotationDisplayPath(row: { scan_image_path: string | null; preview_path: string | null; has_annotations: boolean | null }): { path: string; annotated: boolean } | null {
  const preview = nonEmpty(row.preview_path);
  const original = nonEmpty(row.scan_image_path);
  if (preview) return { path: preview, annotated: row.has_annotations !== false };
  if (original) return { path: original, annotated: false };
  return null;
}

// ── 열람 기록(원칙 3) ────────────────────────────────────────────────────────

export const QUESTION_BODY_VIEWED_ACTION = "question_body_viewed";
export const QUESTION_BODY_VIEWED_TARGET_TYPES = { thread: "question_thread", individual: "individual_question" } as const;
export type QuestionDetailKind = keyof typeof QUESTION_BODY_VIEWED_TARGET_TYPES;

export type QuestionBodyViewedLog = {
  actionType: typeof QUESTION_BODY_VIEWED_ACTION;
  targetType: (typeof QUESTION_BODY_VIEWED_TARGET_TYPES)[QuestionDetailKind];
  targetId: string;
  detail: { kind: QuestionDetailKind; roomId: string | null; studentId: string | null; mentorId: string | null; messageCount: number; attachmentCount: number };
};

/** 본문 렌더 1회 = 로그 1건. 액션 `question_body_viewed`, 대상은 스레드·개별질문 id. 화면에는 아무것도 뜨지 않는다. */
export function buildQuestionBodyViewedLog(input: { kind: QuestionDetailKind; id: string; roomId: string | null; studentId: string | null; mentorId: string | null; messageCount: number; attachmentCount: number }): QuestionBodyViewedLog {
  return {
    actionType: QUESTION_BODY_VIEWED_ACTION,
    targetType: QUESTION_BODY_VIEWED_TARGET_TYPES[input.kind],
    targetId: input.id,
    detail: {
      kind: input.kind,
      roomId: input.roomId,
      studentId: input.studentId,
      mentorId: input.mentorId,
      messageCount: Math.max(0, Math.trunc(input.messageCount)),
      attachmentCount: Math.max(0, Math.trunc(input.attachmentCount)),
    },
  };
}

// ── 주간 사용량 표기 ─────────────────────────────────────────────────────────

/** `3/9` · `3/무제한`(프리미엄 내부 한도 999). 사용량을 못 읽었으면 `—`. */
export function formatWeeklyUsageShort(usage: { used: number; limit: number } | null | undefined): string {
  if (!usage) return "—";
  const limit = usage.limit >= 999 ? "무제한" : String(usage.limit);
  return `${usage.used}/${limit}`;
}

// ── 빈 상태 문구 ─────────────────────────────────────────────────────────────

export const EMPTY_STUDENT_INDIVIDUAL = "구매한 개별질문이 없습니다";
export const EMPTY_STUDENT_ROOMS = "구독한 멘토가 없습니다";
export const EMPTY_MENTOR_ROOMS = "담당 학생이 없습니다";
export const EMPTY_MENTOR_INDIVIDUAL = "답변한 개별질문이 없습니다";
export const EMPTY_ROOM_THREADS = "이 방에는 아직 질문이 없습니다";
export const EMPTY_CONNECTION_NOTES = "아직 작성된 연결노트가 없습니다";
export const EMPTY_CONVERSATION = "아직 메시지가 없습니다";

// ── 목록 파라미터 ────────────────────────────────────────────────────────────

/** 0-based inclusive range(PostgREST `.range`). */
export function pageRange(page: number, pageSize: number): { from: number; to: number } {
  const p = Math.max(1, Math.trunc(page));
  const size = Math.max(1, Math.trunc(pageSize));
  const from = (p - 1) * size;
  return { from, to: from + size - 1 };
}
