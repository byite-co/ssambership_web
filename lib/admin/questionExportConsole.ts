/**
 * 질문 내보내기(PR-13 §2)의 순수 규칙 — PR-8 질문 목록 세 곳(학생 [개별질문] · 멘토별 화면 [질문] · 멘토 [개별질문 답변])의 `내보내기` 버튼이 쓰는
 * 요청 파싱 · CSV 조립 · 감사 로그 · 시트 문구. 별도 화면(전체 탐색기)은 없다.
 *
 * - 범위는 **현재 목록과 같은 조건**(계정·방 단위)뿐이다. 상한 200건(`QUESTION_EXPORT_LIMIT`) — 넘으면 서버·시트 모두 막는다.
 * - 실명(학생 `full_name`)·닉네임(멘토 `nickname`) **그대로**(오너 결정 · PR-8 원칙 1). 마스킹 없음.
 * - CSV 는 서버(라우트 핸들러)가 만들어 스트리밍한다. 클라이언트는 URL 을 열 뿐 조립하지 않는다.
 * - 본문 포함 시 **메시지 1행 = CSV 1행**(질문 헤더 열 반복) — Excel 에서 대화 순서가 보이게. 첨부는 **파일명만**(URL·서명 링크 없음).
 * - 내보내기마다 `admin_action_logs` 1건(`question_export`): 실행자 · 건수 · 필터 조건 · 포함 항목 · 대상(학생/방/멘토 id). 실패도 시도를 남긴다(§2-4).
 * - CSV 셀은 RFC 4180 인용 + 수식 주입 가드(`= + - @` 로 시작하면 `'` 접두) — 미성년자 자유 텍스트를 Excel 로 여는 파일이다.
 *
 * node --test 계약 테스트가 직접 import 하므로 React·`@/` import 를 두지 않는다.
 */
import { resolveAdminStatus } from "./adminStatusDictionary.ts";
import { ESCROW_STATE_LABELS, PARTY_ROLE_LABELS, individualTypeLabel, timeOf, type EscrowState, type PartyRole } from "./questionDrilldownConsole.ts";

export const QUESTION_EXPORT_ROUTE = "/api/admin/question-export";
/** PR-8 목록과 같은 조회 상한 — 넘으면 `필터를 좁혀 200건 이하로 만들어 주세요`. */
export const QUESTION_EXPORT_LIMIT = 200;
export const QUESTION_EXPORT_ACTION = "question_export";

// ── 범위(현재 목록과 같은 조건) ───────────────────────────────────────────────

export const QUESTION_EXPORT_SCOPE_KINDS = ["student_individual", "mentor_individual", "room_threads"] as const;
export type QuestionExportScopeKind = (typeof QUESTION_EXPORT_SCOPE_KINDS)[number];
export type QuestionExportScope = { kind: QuestionExportScopeKind; id: string };

export const QUESTION_EXPORT_SCOPE_LABELS: Readonly<Record<QuestionExportScopeKind, string>> = {
  student_individual: "학생 계정의 개별질문",
  mentor_individual: "멘토 계정의 개별질문 답변",
  room_threads: "멘토별 화면의 구독 질문",
};

/** 감사 로그 대상 유형 — 계정 단위는 `user`(계정 상세 링크), 방 단위는 `question_room`(멘토별 화면 링크). */
export function questionExportTargetType(kind: QuestionExportScopeKind): "user" | "question_room" {
  return kind === "room_threads" ? "question_room" : "user";
}

/** 구독 질문(스레드)인가 개별질문인가 — CSV 열 구성이 갈린다. */
export function questionExportKind(kind: QuestionExportScopeKind): "thread" | "individual" {
  return kind === "room_threads" ? "thread" : "individual";
}

/** 목록이 서버에 거는 조건 그대로 — 감사 로그 `filters` 와 PR 설명에 쓴다. */
export function questionExportFilters(scope: QuestionExportScope): Record<string, string | number> {
  const base = { order: "created_at desc", limit: QUESTION_EXPORT_LIMIT };
  switch (scope.kind) {
    case "student_individual":
      return { table: "individual_questions", student_id: scope.id, ...base };
    case "mentor_individual":
      return { table: "individual_questions", answering_mentor_id: scope.id, ...base };
    case "room_threads":
      return { table: "question_threads", mentor_student_room_id: scope.id, ...base };
  }
}

// ── 포함 항목 ────────────────────────────────────────────────────────────────

export const QUESTION_EXPORT_INCLUDE_KEYS = ["body", "attachments", "metrics"] as const;
export type QuestionExportIncludeKey = (typeof QUESTION_EXPORT_INCLUDE_KEYS)[number];
export type QuestionExportIncludes = Readonly<Record<QuestionExportIncludeKey, boolean>>;

export const QUESTION_EXPORT_INCLUDE_LABELS: Readonly<Record<QuestionExportIncludeKey, string>> = {
  body: "질문·답변 본문",
  attachments: "첨부 파일명",
  metrics: "품질 지표",
};

export const QUESTION_EXPORT_DEFAULT_INCLUDES: QuestionExportIncludes = { body: true, attachments: true, metrics: true };

export function questionExportIncludeList(includes: QuestionExportIncludes): QuestionExportIncludeKey[] {
  return QUESTION_EXPORT_INCLUDE_KEYS.filter((k) => includes[k]);
}

// ── 요청 URL · 파싱 ──────────────────────────────────────────────────────────

export const QUESTION_EXPORT_SCOPE_PARAM = "scope";
export const QUESTION_EXPORT_ID_PARAM = "id";
export const QUESTION_EXPORT_INCLUDE_PARAM = "include";

const UUID_PATTERN = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export function buildQuestionExportUrl(scope: QuestionExportScope, includes: QuestionExportIncludes): string {
  const usp = new URLSearchParams();
  usp.set(QUESTION_EXPORT_SCOPE_PARAM, scope.kind);
  usp.set(QUESTION_EXPORT_ID_PARAM, scope.id);
  usp.set(QUESTION_EXPORT_INCLUDE_PARAM, questionExportIncludeList(includes).join(","));
  return `${QUESTION_EXPORT_ROUTE}?${usp.toString()}`;
}

export type QuestionExportRequestError = "bad_scope" | "bad_id";
export type ParsedQuestionExportRequest = { ok: true; scope: QuestionExportScope; includes: QuestionExportIncludes } | { ok: false; code: QuestionExportRequestError };

/** 라우트 핸들러의 쿼리 파싱 — 범위 3종 + uuid 만 받는다. 모르는 포함 항목은 무시(없으면 전부 제외). */
export function parseQuestionExportRequest(params: { get(name: string): string | null }): ParsedQuestionExportRequest {
  const kind = String(params.get(QUESTION_EXPORT_SCOPE_PARAM) ?? "").trim();
  if (!(QUESTION_EXPORT_SCOPE_KINDS as readonly string[]).includes(kind)) return { ok: false, code: "bad_scope" };
  const id = String(params.get(QUESTION_EXPORT_ID_PARAM) ?? "").trim();
  if (!UUID_PATTERN.test(id)) return { ok: false, code: "bad_id" };
  const raw = String(params.get(QUESTION_EXPORT_INCLUDE_PARAM) ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase());
  const includes: QuestionExportIncludes = {
    body: raw.includes("body"),
    attachments: raw.includes("attachments"),
    metrics: raw.includes("metrics"),
  };
  return { ok: true, scope: { kind: kind as QuestionExportScopeKind, id }, includes };
}

// ── 상한 · 시트 문구 ─────────────────────────────────────────────────────────

export const QUESTION_EXPORT_OVER_LIMIT_MESSAGE = `필터를 좁혀 ${QUESTION_EXPORT_LIMIT}건 이하로 만들어 주세요`;
export const QUESTION_EXPORT_EMPTY_MESSAGE = "내보낼 질문이 없습니다";

/** 시트의 확인을 잠그는 문구 — 상한 초과 · 0건. 그 외 null. */
export function questionExportBlockedMessage(totalCount: number): string | null {
  if (totalCount > QUESTION_EXPORT_LIMIT) return QUESTION_EXPORT_OVER_LIMIT_MESSAGE;
  if (totalCount <= 0) return QUESTION_EXPORT_EMPTY_MESSAGE;
  return null;
}

export const QUESTION_EXPORT_SHEET = {
  button: "내보내기",
  title: "질문 내보내기",
  scopeLabel: "범위",
  includeLabel: "포함 항목",
  formatLabel: "형식",
  format: "CSV (UTF-8, Excel용 BOM)",
  auditNote: "이 내보내기는 감사 로그에 기록됩니다",
  namesNote: "학생 실명·멘토 닉네임이 그대로 담깁니다. 첨부는 파일명만 담고 파일 자체는 반출하지 않습니다.",
} as const;

export function formatQuestionExportScopeSummary(totalCount: number): string {
  return `현재 목록 ${Math.max(0, Math.trunc(totalCount)).toLocaleString("ko-KR")}건 (필터 적용됨)`;
}

export function questionExportConfirmLabel(totalCount: number): string {
  return `${Math.max(0, Math.trunc(totalCount)).toLocaleString("ko-KR")}건 내보내기`;
}

// ── CSV 셀 ───────────────────────────────────────────────────────────────────

export const QUESTION_EXPORT_BOM = "\uFEFF";
export const QUESTION_EXPORT_LINE_BREAK = "\r\n";

/** 수식 주입 가드 — Excel 이 수식으로 해석하는 선행 문자(`= + - @` · 탭·CR)는 `'` 를 앞에 붙인다. */
export function guardCsvFormula(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

/** RFC 4180 — 쉼표·따옴표·줄바꿈이 있으면 따옴표로 감싸고 따옴표는 두 번. null/undefined 는 빈 셀. */
export function csvCell(value: unknown): string {
  const s = value == null ? "" : typeof value === "string" ? value : String(value);
  const guarded = guardCsvFormula(s);
  return /[",\r\n]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

export function csvLine(cells: readonly unknown[]): string {
  return `${cells.map(csvCell).join(",")}${QUESTION_EXPORT_LINE_BREAK}`;
}

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** `2026-08-30 21:14:00`(KST) — CSV 일시. 없으면 빈 셀. */
export function formatQuestionExportKst(iso: string | null | undefined): string {
  const t = timeOf(iso);
  if (t == null) return "";
  const d = new Date(t + KST_OFFSET_MS);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}

/** ms → 분(반올림). null 은 빈 셀. */
export function formatQuestionExportMinutes(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return "";
  return String(Math.round(ms / 60_000));
}

// ── 레코드 · 열 · 행 ─────────────────────────────────────────────────────────

export type QuestionExportMessage = {
  /** 1부터 — 대화 순서 */
  order: number;
  role: PartyRole;
  createdAt: string | null;
  body: string;
};

export type QuestionExportAttachment = {
  /** 귀속 메시지 — 없으면(질문 자체 첨부) 첫 행에 싣는다 */
  messageId: string | null;
  fileName: string;
};

export type QuestionExportRecord = {
  kind: "thread" | "individual";
  id: string;
  /** 실명 */
  studentName: string;
  /** 닉네임 — 공개형 미배정이면 null */
  mentorName: string | null;
  subjectLabel: string | null;
  title: string;
  createdAt: string | null;
  status: string;
  metrics: { firstAnswerMs: number | null; roundTrips: number; confirmedAt: string | null; confirmMs: number | null };
  messages: readonly (QuestionExportMessage & { id: string })[];
  attachments: readonly QuestionExportAttachment[];
  individual: { priceCents: number; escrow: EscrowState; questionType: string } | null;
};

export const QUESTION_EXPORT_BASE_COLUMNS = ["종류", "질문ID", "학생(실명)", "멘토(닉네임)", "과목", "제목", "질문일시", "상태"] as const;
export const QUESTION_EXPORT_METRIC_COLUMNS = ["첫 답변까지(분)", "왕복", "확인여부", "확인까지(분)"] as const;
export const QUESTION_EXPORT_BODY_COLUMNS = ["메시지 순서", "작성자 역할", "작성일시", "본문"] as const;
export const QUESTION_EXPORT_ATTACHMENT_COLUMNS = ["첨부 파일명"] as const;
export const QUESTION_EXPORT_INDIVIDUAL_COLUMNS = ["가격", "에스크로 상태", "지정/공개"] as const;

export const QUESTION_EXPORT_KIND_LABELS = { thread: "구독", individual: "개별" } as const;

/** 열 순서(§2-3): 기본 8 → [지표 4] → [본문 4] → [첨부 1] → [개별질문 3 — 개별질문 범위에서만]. */
export function questionExportHeader(kind: "thread" | "individual", includes: QuestionExportIncludes): string[] {
  return [
    ...QUESTION_EXPORT_BASE_COLUMNS,
    ...(includes.metrics ? QUESTION_EXPORT_METRIC_COLUMNS : []),
    ...(includes.body ? QUESTION_EXPORT_BODY_COLUMNS : []),
    ...(includes.attachments ? QUESTION_EXPORT_ATTACHMENT_COLUMNS : []),
    ...(kind === "individual" ? QUESTION_EXPORT_INDIVIDUAL_COLUMNS : []),
  ];
}

export function questionExportStatusLabel(kind: "thread" | "individual", status: string): string {
  return resolveAdminStatus(kind === "thread" ? "question_threads" : "individual_questions", "status", status).label;
}

/** `price_cents`(캐시×100) → 원 정수 문자열(CSV 숫자 셀 — 구분 기호 없음). */
export function formatQuestionExportPriceKrw(priceCents: number | null | undefined): string {
  const cents = typeof priceCents === "number" && Number.isFinite(priceCents) ? priceCents : 0;
  return String(Math.floor(Math.abs(cents) / 100));
}

const ATTACHMENT_JOINER = " | ";

function attachmentNamesFor(record: QuestionExportRecord, messageId: string | null, includeUnattributed: boolean): string {
  const names = record.attachments
    .filter((a) => (messageId != null && a.messageId === messageId) || (includeUnattributed && (a.messageId == null || !record.messages.some((m) => m.id === a.messageId))))
    .map((a) => a.fileName)
    .filter(Boolean);
  return names.join(ATTACHMENT_JOINER);
}

/**
 * 질문 1건 → CSV 행들. 본문 포함이면 메시지마다 1행(질문 헤더 열 반복 · 메시지가 없으면 빈 본문 1행), 아니면 1행.
 * 첨부 파일명: 본문 포함 시 그 메시지에 귀속된 파일명(귀속 없는 첨부는 첫 행), 아니면 질문 전체 파일명.
 */
export function questionExportRows(record: QuestionExportRecord, includes: QuestionExportIncludes): string[][] {
  const head: string[] = [
    QUESTION_EXPORT_KIND_LABELS[record.kind],
    record.id,
    record.studentName,
    record.mentorName ?? "",
    record.subjectLabel ?? "",
    record.title,
    formatQuestionExportKst(record.createdAt),
    questionExportStatusLabel(record.kind, record.status),
  ];
  if (includes.metrics) {
    head.push(formatQuestionExportMinutes(record.metrics.firstAnswerMs), String(record.metrics.roundTrips), record.metrics.confirmedAt ? "확인" : "", formatQuestionExportMinutes(record.metrics.confirmMs));
  }
  const tail: string[] = record.kind === "individual" && record.individual ? [formatQuestionExportPriceKrw(record.individual.priceCents), ESCROW_STATE_LABELS[record.individual.escrow], individualTypeLabel(record.individual.questionType)] : record.kind === "individual" ? ["", "", ""] : [];

  if (!includes.body) {
    const attachment = includes.attachments ? [record.attachments.map((a) => a.fileName).filter(Boolean).join(ATTACHMENT_JOINER)] : [];
    return [[...head, ...attachment, ...tail]];
  }

  const messages = record.messages.length ? record.messages : [{ id: "", order: 1, role: "unknown" as PartyRole, createdAt: null, body: "" }];
  return messages.map((m, idx) => {
    const body = [String(m.order), PARTY_ROLE_LABELS[m.role], formatQuestionExportKst(m.createdAt), m.body];
    const attachment = includes.attachments ? [attachmentNamesFor(record, m.id || null, idx === 0)] : [];
    return [...head, ...body, ...attachment, ...tail];
  });
}

/** 전체 CSV — BOM → 헤더 → 행. 제너레이터라 라우트가 청크 단위로 스트리밍한다. */
export function* renderQuestionExportCsv(records: Iterable<QuestionExportRecord>, kind: "thread" | "individual", includes: QuestionExportIncludes): Generator<string> {
  yield QUESTION_EXPORT_BOM + csvLine(questionExportHeader(kind, includes));
  for (const record of records) {
    for (const row of questionExportRows(record, includes)) yield csvLine(row);
  }
}

/** `question-export-room_threads-11111111-20260903-1441.csv` */
export function questionExportFileName(scope: QuestionExportScope, nowIso: string): string {
  const stamp = formatQuestionExportKst(nowIso).replace(/[-: ]/g, "").slice(0, 12).replace(/^(\d{8})(\d{4})$/, "$1-$2") || "export";
  return `question-export-${scope.kind}-${scope.id.slice(0, 8)}-${stamp}.csv`;
}

// ── 감사 로그(§2-4 ★) ────────────────────────────────────────────────────────

export const QUESTION_EXPORT_RESULTS = ["ok", "empty", "over_limit", "load_failed"] as const;
export type QuestionExportResult = (typeof QUESTION_EXPORT_RESULTS)[number];

export type QuestionExportLog = {
  actionType: typeof QUESTION_EXPORT_ACTION;
  targetType: "user" | "question_room";
  targetId: string;
  detail: {
    scope: QuestionExportScopeKind;
    targetId: string;
    /** 실제로 내려간 질문 수(실패·상한 초과는 0) */
    count: number;
    /** 조건에 맞는 전체 건수 */
    totalCount: number;
    /** 본문 포함 시 CSV 행 수(메시지당 1행) — 실패면 0 */
    rowCount: number;
    filters: Record<string, string | number>;
    includes: QuestionExportIncludeKey[];
    result: QuestionExportResult;
    /** 감사 로그 표의 사유 칸에 보이는 한 줄 요약 */
    note: string;
    error?: string;
  };
};

/** 내보내기 1회 = 로그 1건. 실패(`load_failed`)·상한 초과(`over_limit`)도 시도로 남긴다. */
export function buildQuestionExportLog(input: {
  scope: QuestionExportScope;
  includes: QuestionExportIncludes;
  count: number;
  totalCount: number;
  rowCount: number;
  result: QuestionExportResult;
  error?: string | null;
}): QuestionExportLog {
  const includeKeys = questionExportIncludeList(input.includes);
  const includeLabels = includeKeys.map((k) => QUESTION_EXPORT_INCLUDE_LABELS[k]).join("·") || "기본 열만";
  const resultLabel = input.result === "ok" ? `${input.count}건 내보냄` : input.result === "empty" ? "0건(내보낼 질문 없음)" : input.result === "over_limit" ? `상한 초과(${input.totalCount}건 > ${QUESTION_EXPORT_LIMIT})` : "조회 실패";
  const log: QuestionExportLog = {
    actionType: "question_export",
    targetType: questionExportTargetType(input.scope.kind),
    targetId: input.scope.id,
    detail: {
      scope: input.scope.kind,
      targetId: input.scope.id,
      count: Math.max(0, Math.trunc(input.count)),
      totalCount: Math.max(0, Math.trunc(input.totalCount)),
      rowCount: Math.max(0, Math.trunc(input.rowCount)),
      filters: questionExportFilters(input.scope),
      includes: includeKeys,
      result: input.result,
      note: `${QUESTION_EXPORT_SCOPE_LABELS[input.scope.kind]} CSV · ${resultLabel} · 포함 ${includeLabels}`,
    },
  };
  if (input.error) log.detail.error = String(input.error).slice(0, 300);
  return log;
}

/** 조회 결과 → 로그 result 코드 */
export function questionExportResultOf(input: { error: string | null; overLimit: boolean; count: number }): QuestionExportResult {
  if (input.error) return "load_failed";
  if (input.overLimit) return "over_limit";
  return input.count > 0 ? "ok" : "empty";
}
