// 계약 테스트: 질문 내보내기 CSV(PR-13 §2) — PR-8 질문 목록 세 곳의 `내보내기`.
// 실행: node --test --experimental-strip-types lib/admin/__contract__/questionExportConsole.contract.test.ts
//
// 고정하는 것(지시서 §3):
//   ① 200건 상한(시트·서버 둘 다) · 필터 = 현재 목록과 같은 조건(계정·방 단위 · created_at desc)
//   ② CSV 컬럼 순서(기본 8 → 지표 4 → 본문 4 → 첨부 1 → 개별질문 3) · 본문 포함 시 메시지당 1행(헤더 반복) · BOM · CRLF · RFC 4180 인용 · 수식 가드
//   ③ 감사 로그 1건(question_export · 건수·필터·포함 항목·대상) — 실패·상한 초과도 시도로 · 라우트가 CSV 전에 기록
//   ④ 실명·닉네임 그대로(마스킹 0) · 첨부는 파일명만(서명 URL 0) · 서버 생성·스트리밍(클라이언트 조립 0)
//   ⑤ 버튼은 세 목록에만(전체 탐색기 없음) · 공용 확인 절차(ConfirmSubmitButton) · 연결노트·예약 내보내기 없음

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  QUESTION_EXPORT_ACTION,
  QUESTION_EXPORT_ATTACHMENT_COLUMNS,
  QUESTION_EXPORT_BASE_COLUMNS,
  QUESTION_EXPORT_BODY_COLUMNS,
  QUESTION_EXPORT_BOM,
  QUESTION_EXPORT_DEFAULT_INCLUDES,
  QUESTION_EXPORT_EMPTY_MESSAGE,
  QUESTION_EXPORT_INCLUDE_LABELS,
  QUESTION_EXPORT_INDIVIDUAL_COLUMNS,
  QUESTION_EXPORT_LIMIT,
  QUESTION_EXPORT_METRIC_COLUMNS,
  QUESTION_EXPORT_OVER_LIMIT_MESSAGE,
  QUESTION_EXPORT_ROUTE,
  QUESTION_EXPORT_SHEET,
  buildQuestionExportLog,
  buildQuestionExportUrl,
  csvCell,
  csvLine,
  formatQuestionExportKst,
  formatQuestionExportMinutes,
  formatQuestionExportScopeSummary,
  guardCsvFormula,
  parseQuestionExportRequest,
  questionExportBlockedMessage,
  questionExportConfirmLabel,
  questionExportFileName,
  questionExportFilters,
  questionExportHeader,
  questionExportKind,
  questionExportResultOf,
  questionExportRows,
  questionExportTargetType,
  renderQuestionExportCsv,
  type QuestionExportRecord,
} from "../questionExportConsole.ts";
import { ADMIN_ACTION_TYPE_LABELS, adminActionLabel, resolveAdminActionType } from "../adminActionTypeLabels.ts";
import { auditLogTargetHref, auditLogTargetTypeLabel } from "../auditLogConsole.ts";

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

const PURE = "lib/admin/questionExportConsole.ts";
const QUERIES = "lib/admin/questionExportQueries.ts";
const ROUTE = "app/api/admin/question-export/route.ts";
const BUTTON = "components/admin/QuestionExportButton.tsx";
const INDIVIDUAL_TAB = "components/admin/AccountIndividualQuestionsTab.tsx";
const THREAD_LIST = "components/admin/QuestionRoomThreadList.tsx";
const NEW_FILES = [PURE, QUERIES, ROUTE, BUTTON];

const UUID = "11111111-1111-4111-8111-111111111111";
const ROOM = "22222222-2222-4222-8222-222222222222";
const T0 = "2026-08-30T12:14:00.000Z";
const H = 60 * 60 * 1000;
const atMin = (m: number) => new Date(new Date(T0).getTime() + m * 60_000).toISOString();

const THREAD_RECORD: QuestionExportRecord = {
  kind: "thread",
  id: UUID,
  studentName: "이수민",
  mentorName: "수학하는하늘",
  subjectLabel: "수학",
  title: "극한 문제, 어렵습니다",
  createdAt: T0,
  status: "confirmed",
  metrics: { firstAnswerMs: 80 * 60_000, roundTrips: 2, confirmedAt: atMin(12 * 60), confirmMs: 12 * H },
  messages: [
    { id: "m1", order: 1, role: "student", createdAt: T0, body: "극한 문제가 안 풀려요" },
    { id: "m2", order: 2, role: "mentor", createdAt: atMin(80), body: '분모가 0 이 되는 "패턴"을 먼저 보세요\n둘째 줄' },
  ],
  attachments: [
    { messageId: "m1", fileName: "문제.png" },
    { messageId: null, fileName: "스캔.jpg" },
  ],
  individual: null,
};

const INDIVIDUAL_RECORD: QuestionExportRecord = {
  ...THREAD_RECORD,
  kind: "individual",
  id: ROOM,
  status: "answered",
  metrics: { firstAnswerMs: 30 * 60_000, roundTrips: 1, confirmedAt: null, confirmMs: null },
  messages: [{ id: `question-${ROOM}`, order: 1, role: "student", createdAt: T0, body: "=SUM(1,2) 이게 뭔가요" }],
  attachments: [],
  individual: { priceCents: 800000, escrow: "released", questionType: "open" },
};

// ── ① 상한 · 필터 ────────────────────────────────────────────────────────────

test("상한 200건 — 시트는 초과·0건에서 확인을 잠그고, 서버 조회는 range(0, 200)+count 로 초과를 판정해 레코드 없이 돌려주며, 라우트는 400 으로 막는다", () => {
  assert.equal(QUESTION_EXPORT_LIMIT, 200);
  assert.equal(QUESTION_EXPORT_OVER_LIMIT_MESSAGE, "필터를 좁혀 200건 이하로 만들어 주세요");
  assert.equal(questionExportBlockedMessage(201), QUESTION_EXPORT_OVER_LIMIT_MESSAGE);
  assert.equal(questionExportBlockedMessage(200), null);
  assert.equal(questionExportBlockedMessage(24), null);
  assert.equal(questionExportBlockedMessage(0), QUESTION_EXPORT_EMPTY_MESSAGE);
  const q = stripComments(read(QUERIES));
  assert.equal((q.match(/\.range\(0, QUESTION_EXPORT_LIMIT\)/g) ?? []).length, 2, "구독·개별 둘 다 상한+1 까지만 읽는다");
  assert.equal((q.match(/if \(totalCount > QUESTION_EXPORT_LIMIT\) return \{ records: \[\], totalCount, overLimit: true, error: null \};/g) ?? []).length, 2);
  const route = stripComments(read(ROUTE));
  assert.ok(route.includes("if (loaded.overLimit) return json(400, { ok: false, error: QUESTION_EXPORT_OVER_LIMIT_MESSAGE, totalCount: loaded.totalCount });"));
  assert.equal(formatQuestionExportScopeSummary(24), "현재 목록 24건 (필터 적용됨)");
  assert.equal(questionExportConfirmLabel(24), "24건 내보내기");
});

test("필터 = 현재 목록과 같은 조건: 학생 student_id · 멘토 designated/claimed · 방 mentor_student_room_id · created_at desc — 조회 모듈이 PR-8 목록과 같은 술어를 쓴다", () => {
  assert.deepEqual(questionExportFilters({ kind: "student_individual", id: UUID }), { table: "individual_questions", student_id: UUID, order: "created_at desc", limit: 200 });
  assert.deepEqual(questionExportFilters({ kind: "mentor_individual", id: UUID }), { table: "individual_questions", answering_mentor_id: UUID, order: "created_at desc", limit: 200 });
  assert.deepEqual(questionExportFilters({ kind: "room_threads", id: ROOM }), { table: "question_threads", mentor_student_room_id: ROOM, order: "created_at desc", limit: 200 });
  const q = stripComments(read(QUERIES));
  const drilldown = stripComments(read("lib/admin/questionDrilldownQueries.ts"));
  for (const needle of ['query.eq("student_id", scope.userId)', "query.or(`designated_mentor_id.eq.${scope.userId},claimed_mentor_id.eq.${scope.userId}`)"]) assert.ok(q.includes(needle), needle);
  assert.ok(drilldown.includes('query.eq("student_id", userId)') && drilldown.includes("query.or(`designated_mentor_id.eq.${userId},claimed_mentor_id.eq.${userId}`)"), "PR-8 목록 술어");
  assert.ok(q.includes('.eq("mentor_student_room_id", roomId).order("created_at", { ascending: false })') && drilldown.includes('.eq("mentor_student_room_id", roomId).order("created_at", { ascending: false })'));
  assert.equal(questionExportKind("room_threads"), "thread");
  assert.equal(questionExportKind("student_individual"), "individual");
  assert.equal(questionExportTargetType("room_threads"), "question_room");
  assert.equal(questionExportTargetType("mentor_individual"), "user");
});

test("요청 URL ↔ 파싱: 범위 3종 + uuid 만 · 포함 항목은 쉼표 목록(모르는 값 무시 · 없으면 전부 제외)", () => {
  const url = buildQuestionExportUrl({ kind: "room_threads", id: ROOM }, QUESTION_EXPORT_DEFAULT_INCLUDES);
  assert.equal(url, `${QUESTION_EXPORT_ROUTE}?scope=room_threads&id=${ROOM}&include=body%2Cattachments%2Cmetrics`);
  const parsed = parseQuestionExportRequest(new URL(url, "https://ssambership.local").searchParams);
  assert.deepEqual(parsed, { ok: true, scope: { kind: "room_threads", id: ROOM }, includes: { body: true, attachments: true, metrics: true } });
  const partial = parseQuestionExportRequest(new URLSearchParams({ scope: "student_individual", id: UUID, include: "metrics,weird" }));
  assert.deepEqual(partial, { ok: true, scope: { kind: "student_individual", id: UUID }, includes: { body: false, attachments: false, metrics: true } });
  assert.deepEqual(parseQuestionExportRequest(new URLSearchParams({ scope: "all", id: UUID })), { ok: false, code: "bad_scope" }, "전체 탐색·일괄 범위 없음");
  assert.deepEqual(parseQuestionExportRequest(new URLSearchParams({ scope: "room_threads", id: "not-uuid" })), { ok: false, code: "bad_id" });
  assert.deepEqual(parseQuestionExportRequest(new URLSearchParams({ scope: "room_threads", id: ROOM })).ok && parseQuestionExportRequest(new URLSearchParams({ scope: "room_threads", id: ROOM })), { ok: true, scope: { kind: "room_threads", id: ROOM }, includes: { body: false, attachments: false, metrics: false } });
  assert.deepEqual(QUESTION_EXPORT_INCLUDE_LABELS, { body: "질문·답변 본문", attachments: "첨부 파일명", metrics: "품질 지표" });
  assert.equal(QUESTION_EXPORT_SHEET.format, "CSV (UTF-8, Excel용 BOM)");
  assert.equal(QUESTION_EXPORT_SHEET.auditNote, "이 내보내기는 감사 로그에 기록됩니다");
});

// ── ② CSV 열 · 행 · BOM ──────────────────────────────────────────────────────

test("CSV 컬럼 순서(§2-3): 기본 8 → [지표 4] → [본문 4] → [첨부 1] → [개별질문 3 — 개별질문 범위만]", () => {
  assert.deepEqual([...QUESTION_EXPORT_BASE_COLUMNS], ["종류", "질문ID", "학생(실명)", "멘토(닉네임)", "과목", "제목", "질문일시", "상태"]);
  assert.deepEqual([...QUESTION_EXPORT_METRIC_COLUMNS], ["첫 답변까지(분)", "왕복", "확인여부", "확인까지(분)"]);
  assert.deepEqual([...QUESTION_EXPORT_BODY_COLUMNS], ["메시지 순서", "작성자 역할", "작성일시", "본문"]);
  assert.deepEqual([...QUESTION_EXPORT_ATTACHMENT_COLUMNS], ["첨부 파일명"]);
  assert.deepEqual([...QUESTION_EXPORT_INDIVIDUAL_COLUMNS], ["가격", "에스크로 상태", "지정/공개"]);
  const all = { body: true, attachments: true, metrics: true };
  assert.deepEqual(questionExportHeader("thread", all), [...QUESTION_EXPORT_BASE_COLUMNS, ...QUESTION_EXPORT_METRIC_COLUMNS, ...QUESTION_EXPORT_BODY_COLUMNS, ...QUESTION_EXPORT_ATTACHMENT_COLUMNS]);
  assert.deepEqual(questionExportHeader("individual", all), [...QUESTION_EXPORT_BASE_COLUMNS, ...QUESTION_EXPORT_METRIC_COLUMNS, ...QUESTION_EXPORT_BODY_COLUMNS, ...QUESTION_EXPORT_ATTACHMENT_COLUMNS, ...QUESTION_EXPORT_INDIVIDUAL_COLUMNS]);
  assert.deepEqual(questionExportHeader("thread", { body: false, attachments: false, metrics: false }), [...QUESTION_EXPORT_BASE_COLUMNS]);
  assert.deepEqual(questionExportHeader("individual", { body: true, attachments: false, metrics: false }), [...QUESTION_EXPORT_BASE_COLUMNS, ...QUESTION_EXPORT_BODY_COLUMNS, ...QUESTION_EXPORT_INDIVIDUAL_COLUMNS]);
});

test("본문 포함 시 메시지 1행 = CSV 1행(질문 헤더 반복 · 첨부는 귀속 메시지 행, 미귀속은 첫 행) · 본문 제외 시 1행(첨부 전체) · 개별질문 3열 · 일시 KST · 분 단위", () => {
  const all = { body: true, attachments: true, metrics: true };
  const rows = questionExportRows(THREAD_RECORD, all);
  assert.equal(rows.length, 2, "메시지 2개 = 2행");
  const head = ["구독", UUID, "이수민", "수학하는하늘", "수학", "극한 문제, 어렵습니다", "2026-08-30 21:14:00", "학생 확인", "80", "2", "확인", "720"];
  assert.deepEqual(rows[0], [...head, "1", "학생", "2026-08-30 21:14:00", "극한 문제가 안 풀려요", "문제.png | 스캔.jpg"]);
  assert.deepEqual(rows[1], [...head, "2", "멘토", "2026-08-30 22:34:00", '분모가 0 이 되는 "패턴"을 먼저 보세요\n둘째 줄', ""]);
  assert.deepEqual(rows[0].slice(0, 12), rows[1].slice(0, 12), "질문 헤더 열 반복");
  const single = questionExportRows(THREAD_RECORD, { body: false, attachments: true, metrics: false });
  assert.deepEqual(single, [["구독", UUID, "이수민", "수학하는하늘", "수학", "극한 문제, 어렵습니다", "2026-08-30 21:14:00", "학생 확인", "문제.png | 스캔.jpg"]]);
  const ind = questionExportRows(INDIVIDUAL_RECORD, all);
  assert.equal(ind.length, 1);
  assert.deepEqual(ind[0].slice(0, 8), ["개별", ROOM, "이수민", "수학하는하늘", "수학", "극한 문제, 어렵습니다", "2026-08-30 21:14:00", "답변 완료"]);
  assert.deepEqual(ind[0].slice(8, 12), ["30", "1", "", ""], "개별질문은 확인 개념 없음 → 빈 셀");
  assert.deepEqual(ind[0].slice(-3), ["8000", "지급됨", "공개형"]);
  assert.deepEqual(questionExportRows({ ...THREAD_RECORD, messages: [] }, all).length, 1, "메시지 없는 질문도 1행");
  assert.equal(formatQuestionExportMinutes(null), "");
  assert.equal(formatQuestionExportMinutes(90_000), "2");
  assert.equal(formatQuestionExportKst(null), "");
});

test("BOM · CRLF · RFC 4180 인용(쉼표·따옴표·줄바꿈) · 수식 주입 가드(= + - @) · 파일명", () => {
  assert.equal(QUESTION_EXPORT_BOM, "\uFEFF");
  const chunks = [...renderQuestionExportCsv([THREAD_RECORD, INDIVIDUAL_RECORD], "thread", { body: true, attachments: false, metrics: false })];
  assert.ok(chunks[0].startsWith("\uFEFF종류,질문ID,"), "첫 청크 = BOM + 헤더");
  assert.ok(chunks.every((c) => c.endsWith("\r\n")), "CRLF");
  assert.equal(chunks.length, 1 + 2 + 1, "헤더 + 스레드 2행 + 개별 1행");
  assert.ok(chunks[2].includes('"분모가 0 이 되는 ""패턴""을 먼저 보세요\n둘째 줄"'), "따옴표 두 번 · 줄바꿈 인용");
  assert.equal(csvCell("극한 문제, 어렵습니다"), '"극한 문제, 어렵습니다"');
  assert.equal(csvCell("plain"), "plain");
  assert.equal(csvCell(null), "");
  assert.equal(csvCell(3), "3");
  assert.equal(guardCsvFormula("=SUM(1,2)"), "'=SUM(1,2)");
  assert.equal(guardCsvFormula("+82"), "'+82");
  assert.equal(guardCsvFormula("-1"), "'-1");
  assert.equal(guardCsvFormula("@here"), "'@here");
  assert.equal(guardCsvFormula("정상"), "정상");
  assert.ok(chunks[3].includes(`"'=SUM(1,2) 이게 뭔가요"`), "학생 본문의 수식은 가드");
  assert.equal(csvLine(["a", "b,c"]), 'a,"b,c"\r\n');
  assert.equal(questionExportFileName({ kind: "room_threads", id: ROOM }, "2026-09-03T05:41:07Z"), "question-export-room_threads-22222222-20260903-1441.csv");
});

// ── ③ 감사 로그 1건 ─────────────────────────────────────────────────────────

test("감사 로그 ★: 내보내기 1회 = question_export 1건 — 실행자 · 건수 · 필터 · 포함 항목 · 대상(학생/방/멘토 id) · 실패·상한 초과도 시도로 · 사전 등재(한글 · 질문 열람 계열) · 대상 링크", () => {
  const ok = buildQuestionExportLog({ scope: { kind: "room_threads", id: ROOM }, includes: { body: true, attachments: false, metrics: true }, count: 24, totalCount: 24, rowCount: 91, result: "ok" });
  assert.deepEqual(ok, {
    actionType: "question_export",
    targetType: "question_room",
    targetId: ROOM,
    detail: {
      scope: "room_threads",
      targetId: ROOM,
      count: 24,
      totalCount: 24,
      rowCount: 91,
      filters: { table: "question_threads", mentor_student_room_id: ROOM, order: "created_at desc", limit: 200 },
      includes: ["body", "metrics"],
      result: "ok",
      note: "멘토별 화면의 구독 질문 CSV · 24건 내보냄 · 포함 질문·답변 본문·품질 지표",
    },
  });
  const over = buildQuestionExportLog({ scope: { kind: "student_individual", id: UUID }, includes: QUESTION_EXPORT_DEFAULT_INCLUDES, count: 0, totalCount: 340, rowCount: 0, result: "over_limit" });
  assert.equal(over.targetType, "user");
  assert.equal(over.detail.result, "over_limit");
  assert.ok(over.detail.note.includes("상한 초과(340건 > 200)"));
  const failed = buildQuestionExportLog({ scope: { kind: "mentor_individual", id: UUID }, includes: { body: false, attachments: false, metrics: false }, count: 0, totalCount: 0, rowCount: 0, result: "load_failed", error: "질문 데이터를 불러오지 못했습니다." });
  assert.equal(failed.detail.error, "질문 데이터를 불러오지 못했습니다.");
  assert.ok(failed.detail.note.includes("조회 실패") && failed.detail.note.includes("기본 열만"));
  assert.equal(questionExportResultOf({ error: null, overLimit: false, count: 3 }), "ok");
  assert.equal(questionExportResultOf({ error: null, overLimit: false, count: 0 }), "empty");
  assert.equal(questionExportResultOf({ error: null, overLimit: true, count: 0 }), "over_limit");
  assert.equal(questionExportResultOf({ error: "x", overLimit: false, count: 0 }), "load_failed");
  assert.equal(QUESTION_EXPORT_ACTION, "question_export");
  assert.ok(ADMIN_ACTION_TYPE_LABELS.question_export, "액션 사전 등재");
  assert.ok(/[가-힣]/.test(adminActionLabel("question_export")));
  assert.equal(resolveAdminActionType("question_export").group, "question_view");
  assert.equal(auditLogTargetHref("question_room", ROOM, null), `/admin/question-rooms/${ROOM}`);
  assert.equal(auditLogTargetTypeLabel("question_room"), "질문방");
  assert.equal(auditLogTargetHref("user", UUID, null), `/admin/users/${UUID}`, "계정 단위 내보내기는 계정 상세로");
  // 라우트: 관리자 가드 → 조회 → 로그 1건(CSV 전 · 실패 분기 전) → 응답
  const route = stripComments(read(ROUTE));
  assert.equal((route.match(/logAdminAction\(db, \{/g) ?? []).length, 1, "로그 호출 1곳");
  const logIdx = route.indexOf("await logAdminAction(db, {");
  assert.ok(logIdx > route.indexOf("await loadQuestionExportRecords(db, scope)"), "조회 뒤(건수·결과 확정)");
  assert.ok(logIdx < route.indexOf("if (loaded.error) return json(500") && logIdx < route.indexOf("if (loaded.overLimit) return json(400") && logIdx < route.indexOf("renderQuestionExportCsv(loaded.records"), "실패·상한 초과·CSV 어느 분기보다 앞");
  assert.ok(route.includes('if (profile?.role !== "admin") return json(403') && route.includes("if (authError || !user) return json(401"), "관리자만 · 비관리자는 로그 없이 거부");
  assert.ok(route.includes("adminId: user.id, actionType: log.actionType, targetType: log.targetType, targetId: log.targetId, detail: log.detail"));
});

// ── ④ 마스킹 0 · 파일명만 · 서버 생성 ───────────────────────────────────────

test("실명·닉네임 그대로(마스킹·익명화 0) · 첨부는 파일명만(서명 URL 발급 0) · 서버 스트리밍(text/csv · attachment) · 클라이언트 조립 0 · 조회 모듈 읽기 전용", () => {
  for (const rel of NEW_FILES) {
    const code = stripComments(read(rel));
    assert.ok(!/mask\w*\(|anonymi|익명|가리기|revealName|showRealName|blur-sm/.test(code), `${rel}: 마스킹·익명화 흔적`);
  }
  const q = stripComments(read(QUERIES));
  assert.ok(q.startsWith('import "server-only";'));
  assert.ok(q.includes("loadPartyIdentities(db,") && q.includes("studentDisplayName(") && q.includes("mentorDisplayName("), "PR-8 이름 규칙(학생 실명 · 멘토 닉네임) 재사용");
  assert.ok(!/createSignedStorageUrl|createSignedUrl|signedUrl/.test(q), "서명 URL 발급 없음 — 파일명만");
  assert.ok(q.includes('.from("question_attachments")') || q.includes('"question_attachments"'), "첨부 파일명 조회");
  assert.ok(!/\.insert\(|\.update\(|\.delete\(|\.upsert\(|\.rpc\(/.test(q), "조회 모듈 쓰기·RPC 없음");
  assert.ok(!q.includes("connection_notes") && !q.includes("scan_annotations"), "연결노트·필기 주석 내보내기 없음(요청 없음)");
  assert.ok(!q.includes('.from("users")'), "이름은 PR-8 loadPartyIdentities 경유(직접 users 읽기 없음)");
  const route = stripComments(read(ROUTE));
  assert.ok(route.includes("new ReadableStream<Uint8Array>") && route.includes('"Content-Type": "text/csv; charset=utf-8"') && route.includes("attachment; filename="), "서버 생성 · 스트리밍 · 첨부 다운로드");
  assert.ok(route.includes('"Cache-Control": "no-store"'));
  const button = stripComments(read(BUTTON));
  assert.ok(button.startsWith('"use client"'));
  assert.ok(!/Blob|createObjectURL|csvLine|csvCell|renderQuestionExportCsv|loadQuestionExportRecords/.test(button), "클라이언트에서 조립하지 않는다");
  assert.ok(button.includes("buildQuestionExportUrl(scope, includes)") && button.includes("<ConfirmSubmitButton") && button.includes('level="stateChange"'), "공용 확인 절차 경유 · 서버 URL");
  assert.ok(button.includes("confirmBlockedMessage={blocked}") && button.includes("questionExportBlockedMessage(totalCount)"), "상한·0건 잠금");
  assert.ok(!button.includes("AdminConfirmDialog"), "자체 모달 금지");
  const pure = stripComments(read(PURE));
  assert.ok(!/from "react"|from "@\//.test(pure), "순수 모듈");
});

// ── ⑤ 세 목록에만 · 전체 탐색기 없음 ────────────────────────────────────────

test("버튼은 PR-8 질문 목록 세 곳(학생 [개별질문] · 멘토 [개별질문 답변] — 같은 컴포넌트 · 멘토별 화면 [질문])에만 · 전체 질문 탐색기·예약 내보내기 없음", () => {
  const tab = stripComments(read(INDIVIDUAL_TAB));
  assert.ok(tab.includes('<QuestionExportButton scope={{ kind: variant === "student" ? "student_individual" : "mentor_individual", id: userId }} totalCount={list.totalCount} />'), "학생·멘토 개별질문 탭");
  const list = stripComments(read(THREAD_LIST));
  assert.ok(list.includes('<QuestionExportButton scope={{ kind: "room_threads", id: roomId }} totalCount={list.totalCount} />'), "멘토별 화면 질문 탭");
  const files = (d: string): string[] => readdirSync(join(ROOT, d), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(`${d}/${e.name}`) : /\.tsx?$/.test(e.name) ? [`${d}/${e.name}`] : []));
  const importers = [...files("app"), ...files("components"), ...files("lib")].filter((rel) => !rel.includes("__contract__") && stripComments(read(rel)).includes("QuestionExportButton") && rel !== BUTTON);
  assert.deepEqual(importers.sort(), [INDIVIDUAL_TAB, THREAD_LIST].sort(), "버튼 사용처는 두 컴포넌트뿐(세 탭)");
  const consoleDir = readdirSync(join(ROOT, "app", "(admin)", "admin", "(console)"));
  assert.ok(!consoleDir.some((d) => /^questions?$|export/i.test(d)), "전체 질문 탐색기·내보내기 화면 없음");
  assert.ok(!existsSync(join(ROOT, "app", "api", "cron", "question-export")), "예약·자동 내보내기 없음");
  const vercel = read("vercel.json");
  assert.ok(!vercel.includes("question-export"));
  assert.ok(existsSync(join(ROOT, ROUTE)));
});

test("UI 카피 금지어 없음(선생님·강사님·수강생·과외·alert) · 인라인 style 없음", () => {
  for (const rel of [...NEW_FILES, INDIVIDUAL_TAB, THREAD_LIST]) {
    const code = stripComments(read(rel));
    for (const banned of ["선생님", "강사님", "수강생", "과외", "커패니티", "웰버십", "쌤버쉽", "alert("]) assert.ok(!code.includes(banned), `${rel}: 금지 문구 ${banned}`);
    assert.ok(!/style=\{/.test(code), `${rel}: 인라인 style 금지`);
  }
});
