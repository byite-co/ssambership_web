// 계약 테스트: 콘텐츠 검수 화면(PR-5 §1) — 목록 이관 · 신고 상세 조치 6종 확인 절차 · 삭제 모달의 안전한 대안.
// 실행: node --test --experimental-strip-types lib/admin/__contract__/contentReportConsole.contract.test.ts
//
// .tsx 는 node --test 로 import 할 수 없으므로(strip-types 는 JSX 미지원):
//   ① 순수 규칙(탭 = 코드가 쓰는 status 6종 · status 키 하나 · status=all 유지 · 검색 or() · 대상 종류별 삭제 효과/summary ·
//      경과 24h/48h 색 · 빈 상태 원문 · 플래시)은 직접 검증한다
//   ② 렌더·배선 규칙은 소스 스캔 tripwire 로 고정한다(PageScaffold 미사용 · AdminPageLayout/AdminDataTable/AdminStatusPill 사용 ·
//      검색 form 규칙 · 조치 6종 등급(전부 stateChange — PR-W2 소프트 삭제) · 삭제 모달 `숨김으로 대신하기` · 서버 액션·필드명 불변 ·
//      코어 소프트 삭제(하드 DELETE 0 · DB-2 SQL 194) · 구 워크스페이스 삭제)

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildAdminListUrl, parseAdminListParams } from "../adminListParams.ts";
import { buildAdminDataTableUrl } from "../adminDataTable.ts";
import { evaluateAdminConfirm, resolveAdminConfirmRequirements } from "../adminConfirmPolicy.ts";
import { adminStatusAllowedValues, resolveAdminStatus } from "../adminStatusDictionary.ts";
import { contentReportRowIsActionable } from "../contentReportLabels.ts";
import {
  CONTENT_REPORT_ACTIONS,
  CONTENT_REPORT_ACTION_BUTTON_IDS,
  CONTENT_REPORT_BASE_PATH,
  CONTENT_REPORT_DEFAULT_PAGE_SIZE,
  CONTENT_REPORT_DEFAULT_TAB,
  CONTENT_REPORT_ELAPSED_DANGER_HOURS,
  CONTENT_REPORT_ELAPSED_WARNING_HOURS,
  CONTENT_REPORT_EMPTY_STATE,
  CONTENT_REPORT_HIDE_INSTEAD_LABEL,
  CONTENT_REPORT_INTENT_FIELD,
  CONTENT_REPORT_NOTE_FIELD,
  CONTENT_REPORT_REPORT_ID_FIELD,
  CONTENT_REPORT_STATUS_FIELD,
  CONTENT_REPORT_TABS,
  CONTENT_REPORT_TAB_VALUES,
  CONTENT_REPORT_WRITTEN_STATUSES,
  buildContentReportDeleteSummary,
  buildContentReportHideSummary,
  buildContentReportListUrl,
  buildContentReportRestoreSummary,
  buildContentReportSearchOr,
  buildContentReportStatusSummary,
  contentReportDeleteEffect,
  contentReportDetailPath,
  contentReportElapsed,
  contentReportElapsedToneClass,
  contentReportEmptyVariant,
  contentReportFlashOkMessage,
  contentReportTabStatus,
  contentReportTargetLabel,
  resolveContentReportTab,
  type ContentReportTargetKind,
} from "../contentReportConsole.ts";

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const LIST_PAGE = "app/(admin)/admin/(console)/moderation/page.tsx";
const DETAIL_PAGE = "app/(admin)/admin/(console)/reports/[id]/page.tsx";
const LIST = "components/admin/ContentReportQueueList.tsx";
const ACTIONS_UI = "components/admin/ContentReportActionButtons.tsx";
const CONSOLE = "lib/admin/contentReportConsole.ts";
const QUERIES = "lib/admin/contentReportQueueQueries.ts";
const SERVER_ACTIONS = "lib/admin/adminReportActions.ts";
const MODERATION_CORE = "lib/admin/communityModerationCore.ts";

function spFrom(url: string): Record<string, string | string[] | undefined> {
  const u = new URL(url, "https://ssambership.local");
  const sp: Record<string, string | string[] | undefined> = {};
  for (const [k, v] of u.searchParams.entries()) sp[k] = v;
  return sp;
}

const OPTS = { defaultPageSize: CONTENT_REPORT_DEFAULT_PAGE_SIZE, defaultStatus: CONTENT_REPORT_DEFAULT_TAB };
const UUID = "11111111-1111-4111-8111-111111111111";
const HOUR = 3_600_000;

// ── 탭 ──────────────────────────────────────────────────────────────────────

test("탭은 대기·검토 중·해결·기각·숨김·삭제·전체 7개, 기본 탭은 대기 — 값은 CHECK 7종 중 코드가 실제로 쓰는 6종(rejected 제외)", () => {
  assert.deepEqual([...CONTENT_REPORT_TAB_VALUES], ["pending", "reviewing", "resolved", "dismissed", "hidden", "removed", "all"]);
  assert.deepEqual(CONTENT_REPORT_TABS.map((t) => t.label), ["대기", "검토 중", "해결", "기각", "숨김 처리", "삭제 처리", "전체"]);
  for (const t of CONTENT_REPORT_TABS) {
    if (t.value === "all") continue;
    assert.equal(t.label, resolveAdminStatus("content_reports", "status", t.value).label, `${t.value}: 탭 라벨 = 사전 라벨`);
  }
  assert.ok(stripComments(read(CONSOLE)).includes('resolveAdminStatus("content_reports", "status", value).label'), "탭 라벨은 사전에서 파생(하드코딩 없음)");
  assert.equal(CONTENT_REPORT_DEFAULT_TAB, "pending");
  const allowed = adminStatusAllowedValues("content_reports", "status");
  assert.equal(allowed.length, 7, "상태 사전 = CHECK 7종");
  for (const v of CONTENT_REPORT_WRITTEN_STATUSES) assert.ok(allowed.includes(v), `${v} 는 사전(CHECK)에 있다`);
  assert.deepEqual([...CONTENT_REPORT_WRITTEN_STATUSES], CONTENT_REPORT_TAB_VALUES.filter((t) => t !== "all"), "탭 = 코드가 쓰는 값");
  assert.ok(!CONTENT_REPORT_WRITTEN_STATUSES.includes("rejected"), "rejected 는 쓰는 액션이 없어 탭이 아니다");
  // 실측: 어떤 서버 액션도 content_reports.status 에 'rejected' 를 쓰지 않는다
  const writers = [read(SERVER_ACTIONS), read("lib/admin/bulkActions.ts"), read("lib/community/communityReportActions.ts")].map(stripComments).join("\n");
  assert.ok(!/["']rejected["']/.test(writers), "rejected 를 쓰는 액션 없음");
  assert.ok(!read("lib/admin/bulkActions.ts").includes("bulkUpdateContentReportsAction"), "호출자 없는 신고 일괄 액션은 삭제됐다(PR-5 후속)");
  for (const t of CONTENT_REPORT_TABS) {
    if (t.value === "all") continue;
    assert.equal(resolveAdminStatus("content_reports", "status", t.value).known, true, `${t.value} 사전 등재`);
  }
  assert.equal(resolveContentReportTab("hidden"), "hidden");
  assert.equal(resolveContentReportTab("rejected"), "pending", "탭이 아닌 값은 기본 탭");
  assert.equal(resolveContentReportTab(""), "pending");
  assert.equal(contentReportTabStatus("all"), null);
  assert.equal(contentReportTabStatus("removed"), "removed");
});

test("쿼리 키는 status 하나 — 다른 키는 탭을 바꾸지 못한다(extra 로만 남는다)", () => {
  const p = parseAdminListParams(spFrom(`${CONTENT_REPORT_BASE_PATH}?filter=hidden&type=x`), OPTS);
  assert.equal(resolveContentReportTab(p.status), "pending");
  assert.deepEqual(p.extra, { filter: "hidden", type: "x" });
});

test("status=all 버그 해소: 전체 탭 링크·페이지 이동·검색 초기화가 status=all 을 유지하고 재파싱하면 전체 탭이다(구 AdminListToolbar 는 대기 탭으로 튀었다)", () => {
  const all = parseAdminListParams(spFrom(`${CONTENT_REPORT_BASE_PATH}?status=all&q=%EC%84%9C&page=2`), OPTS);
  assert.ok(!buildAdminListUrl(CONTENT_REPORT_BASE_PATH, all, {}).includes("status="), "공용 빌더는 지운다(버그의 원인)");
  for (const url of [buildContentReportListUrl(all, {}), buildContentReportListUrl(all, { page: 3 }), buildContentReportListUrl(all, { search: "" })]) {
    assert.ok(url.includes("status=all"), url);
    assert.equal(resolveContentReportTab(parseAdminListParams(spFrom(url), OPTS).status), "all", url);
  }
  const pending = parseAdminListParams(spFrom(CONTENT_REPORT_BASE_PATH), OPTS);
  assert.ok(buildContentReportListUrl(pending, { status: "all" }).includes("status=all"), "대기 탭에서 전체 탭 링크");
  for (const u of ["", "?status=all", "?status=all&page=2", "?status=hidden&q=x"]) {
    const p = parseAdminListParams(spFrom(`${CONTENT_REPORT_BASE_PATH}${u}`), OPTS);
    for (const o of [{}, { status: "all" }, { page: 2 }, { search: "김" }]) {
      assert.equal(buildContentReportListUrl(p, o), buildAdminDataTableUrl(CONTENT_REPORT_BASE_PATH, p, o), `${u} ${JSON.stringify(o)}`);
    }
  }
  assert.equal(contentReportDetailPath(UUID), `/admin/reports/${UUID}`);
});

// ── 검색 ────────────────────────────────────────────────────────────────────

test("검색 or(): 사유·설명·메모·대상 유형 부분일치 + 신고자 id.in · uuid 컬럼에는 ilike 를 걸지 않는다(완전한 UUID 만 eq)", () => {
  const plain = buildContentReportSearchOr("욕설", []);
  assert.equal(plain, "reason.ilike.%욕설%,description.ilike.%욕설%,admin_note.ilike.%욕설%,target_type.ilike.%욕설%");
  assert.ok(!/id\.ilike|target_id\.ilike|reporter_id\.ilike/.test(buildContentReportSearchOr("abc123", [])), "hex 조각으로 uuid ilike 금지");
  const withUuid = buildContentReportSearchOr(UUID, [UUID, "not-a-uuid"]);
  assert.ok(withUuid.includes(`id.eq.${UUID}`) && withUuid.includes(`target_id.eq.${UUID}`), "완전한 UUID 는 eq");
  assert.ok(withUuid.endsWith(`reporter_id.in.(${UUID})`), "신고자 id 는 uuid 만 걸러 in()");
  const many = Array.from({ length: 150 }, (_, i) => `${String(i).padStart(8, "0")}-1111-4111-8111-111111111111`);
  const capped = buildContentReportSearchOr("x", many);
  assert.equal(capped.match(/-1111-4111-8111-111111111111/g)?.length, 100, "id 상한 100");
});

// ── 대상 종류 · 삭제 효과 · summary ─────────────────────────────────────────

test("대상 종류 라벨: 게시판 글 · 숏폼 · 댓글(레거시 comment 포함) · 멘토 리뷰 · 사용자 · 그 외 기타", () => {
  assert.equal(contentReportTargetLabel("community_post"), "게시판 글");
  assert.equal(contentReportTargetLabel("shortform_post"), "숏폼");
  assert.equal(contentReportTargetLabel("shortform"), "숏폼");
  assert.equal(contentReportTargetLabel("board_comment"), "댓글");
  assert.equal(contentReportTargetLabel("community_comment"), "댓글");
  assert.equal(contentReportTargetLabel("comment"), "댓글");
  assert.equal(contentReportTargetLabel("mentor_review"), "멘토 리뷰");
  assert.equal(contentReportTargetLabel("individual_question"), "기타");
  assert.equal(contentReportTargetLabel(null), "—");
});

test("삭제 효과 = applyContentModeration 그대로: 지원 유형 4종 전부 소프트 삭제(deleted_at/deleted_by · 복구 가능) · 미지원 유형은 신고 상태만 — 하드 DELETE 0(PR-W2 · SQL 194)", () => {
  for (const k of ["community_post", "shortform_post", "community_comment", "board_comment"] as ContentReportTargetKind[]) assert.equal(contentReportDeleteEffect(k), "soft_delete", String(k));
  assert.equal(contentReportDeleteEffect(null), "report_only");
  const core = stripComments(read(MODERATION_CORE));
  assert.ok(core.includes(".update({ deleted_at: new Date().toISOString(), deleted_by: actorId })"), "네 테이블 공통 soft-delete");
  assert.ok(!core.includes(".delete("), "하드 DELETE 없음");
  assert.ok(core.includes("statusPatch.deleted_at = null") && core.includes("{ is_deleted: false, deleted_at: null, deleted_by: null }"), "콘텐츠 복구 = deleted_at 해제");
});

test("삭제 summary 는 모든 지원 유형에 `삭제 후 복구할 수 있습니다` · 복구 불가 문구 0 · 숨김은 '복구할 수 있습니다' · 복구·상태 전이 summary", () => {
  assert.equal(buildContentReportDeleteSummary("community_post"), "이 게시판 글을 삭제합니다. 삭제 후 복구할 수 있습니다.");
  assert.equal(buildContentReportDeleteSummary("shortform_post"), "이 숏폼을 삭제합니다. 삭제 후 복구할 수 있습니다.");
  assert.equal(buildContentReportDeleteSummary("board_comment"), "이 댓글을 삭제합니다. 삭제 후 복구할 수 있습니다.");
  assert.equal(buildContentReportDeleteSummary("community_comment"), "이 댓글을 삭제합니다. 삭제 후 복구할 수 있습니다.");
  const pure = stripComments(read(CONSOLE));
  for (const banned of ["복구 불가", "영구 삭제", "복구할 수 없습니다", "되돌릴 수 없는"]) assert.ok(!pure.includes(banned), `복구 불가 문구 폐기: ${banned}`);
  assert.ok(buildContentReportDeleteSummary(null).includes("콘텐츠는 바뀌지 않습니다") && buildContentReportDeleteSummary(null).includes("'삭제 처리'"));
  assert.equal(buildContentReportHideSummary("shortform_post"), "이 숏폼을 숨깁니다. 복구할 수 있습니다.");
  assert.ok(buildContentReportHideSummary(null).includes("'숨김 처리'"));
  assert.ok(buildContentReportRestoreSummary("community_post").includes("복구합니다") && buildContentReportRestoreSummary("community_post").includes("'해결'"));
  assert.ok(buildContentReportStatusSummary("reviewing").includes("'검토 중'"));
  assert.ok(buildContentReportStatusSummary("resolved").includes("'해결'"));
  assert.ok(buildContentReportStatusSummary("dismissed").includes("기각"));
  for (const s of ["reviewing", "resolved", "dismissed"] as const) assert.ok(buildContentReportStatusSummary(s).includes("콘텐츠는 바뀌지 않습니다"));
});

test("삭제는 재입력 없음(PR-W2): stateChange 요구 사항에 confirmText 가 없다 · 순수 모듈에 재입력 헬퍼 없음", () => {
  const req = resolveAdminConfirmRequirements({ level: CONTENT_REPORT_ACTIONS.deleted.level, confirmText: UUID.slice(0, 8) });
  assert.equal(req.needsDialog, true);
  assert.equal(req.confirmText, null, "stateChange 는 confirmText 를 받아도 재입력 단계를 만들지 않는다");
  assert.equal(evaluateAdminConfirm(req, { reason: "", typedConfirmText: "" }).ok, true);
  assert.ok(!stripComments(read(CONSOLE)).includes("ConfirmText"), "재입력 헬퍼 삭제");
});

test("조치 6종의 등급: 전부 stateChange(한 줄 확인 — 삭제도 소프트 삭제라 복구 가능 · PR-W2) — 전부 다이얼로그를 거친다", () => {
  assert.deepEqual(Object.keys(CONTENT_REPORT_ACTIONS), ["reviewing", "resolved", "dismissed", "hidden", "restored", "deleted"]);
  for (const [key, a] of Object.entries(CONTENT_REPORT_ACTIONS)) {
    assert.equal(a.level, "stateChange", key);
    assert.equal(resolveAdminConfirmRequirements({ level: a.level, confirmText: "x" }).needsDialog, true, key);
    assert.ok(a.label && a.dialogTitle && a.confirmLabel && a.pendingLabel, key);
  }
  assert.equal(CONTENT_REPORT_ACTIONS.dismissed.label, "기각");
  assert.equal(CONTENT_REPORT_ACTIONS.deleted.dialogTitle, "콘텐츠 삭제");
  assert.equal(new Set(Object.values(CONTENT_REPORT_ACTION_BUTTON_IDS)).size, 6, "버튼 id 는 서로 다르다");
  assert.equal(CONTENT_REPORT_HIDE_INSTEAD_LABEL, "숨김으로 대신하기");
});

test("서버 액션이 읽는 필드명·허용 값은 그대로다(DB 쓰기 불변): reportId · nextStatus(reviewing|resolved|dismissed) · intent(hidden|deleted|restored) · note", () => {
  assert.equal(CONTENT_REPORT_REPORT_ID_FIELD, "reportId");
  assert.equal(CONTENT_REPORT_STATUS_FIELD, "nextStatus");
  assert.equal(CONTENT_REPORT_INTENT_FIELD, "intent");
  assert.equal(CONTENT_REPORT_NOTE_FIELD, "note");
  const actions = stripComments(read(SERVER_ACTIONS));
  assert.ok(actions.includes('const NEXT_ALLOWED = new Set(["reviewing", "resolved", "dismissed"]);'));
  assert.ok(actions.includes('const MODERATION_INTENTS = new Set(["hidden", "deleted", "restored"]);'));
  assert.ok(actions.includes('formData.get("reportId")') && actions.includes('formData.get("nextStatus")') && actions.includes('formData.get("intent")') && actions.includes('formData.get("note")'));
  assert.ok(actions.includes('.in("status", ["pending", "reviewing"])'), "상태 전이 조건 그대로");
  assert.ok(actions.includes("hidden: \"hidden\",") && actions.includes("deleted: \"removed\",") && actions.includes("restored: \"resolved\","), "조치 → 신고 상태 매핑 그대로");
  assert.ok(actions.includes("applyContentModeration({"), "콘텐츠 변경은 코어 그대로");
  assert.ok(actions.includes("actorId: user.id,"), "삭제 시 deleted_by = 조치한 관리자(PR-W2)");
});

// ── 경과 ────────────────────────────────────────────────────────────────────

test("경과: 미처리 건만 센다 · 24시간 초과 주의 · 48시간 초과 위험 · 처리된 건은 '—'", () => {
  assert.equal(CONTENT_REPORT_ELAPSED_WARNING_HOURS, 24);
  assert.equal(CONTENT_REPORT_ELAPSED_DANGER_HOURS, 48);
  const now = Date.parse("2026-09-02T12:00:00Z");
  const at = (h: number) => new Date(now - h * HOUR).toISOString();
  assert.deepEqual(contentReportElapsed(at(0.5), "pending", now), { hours: 0, label: "1시간 미만", tone: "ok" });
  assert.deepEqual(contentReportElapsed(at(5), "reviewing", now), { hours: 5, label: "5시간", tone: "ok" });
  assert.deepEqual(contentReportElapsed(at(24), "pending", now), { hours: 24, label: "1일", tone: "ok" }, "24시간 정각은 아직 주의 아님");
  assert.deepEqual(contentReportElapsed(at(24.5), "pending", now), { hours: 24, label: "1일", tone: "warning" }, "24시간을 넘기면(정각 초과) 주의 — 내림한 시간이 아니라 실제 경과로 판정");
  assert.deepEqual(contentReportElapsed(at(25), "pending", now), { hours: 25, label: "1일 1시간", tone: "warning" });
  assert.deepEqual(contentReportElapsed(at(48), "pending", now), { hours: 48, label: "2일", tone: "warning" }, "48시간 정각은 아직 위험 아님");
  assert.deepEqual(contentReportElapsed(at(48.5), "pending", now), { hours: 48, label: "2일", tone: "danger" });
  assert.deepEqual(contentReportElapsed(at(49), "pending", now), { hours: 49, label: "2일 1시간", tone: "danger" });
  for (const s of ["resolved", "dismissed", "hidden", "removed", "rejected"]) {
    assert.deepEqual(contentReportElapsed(at(100), s, now), { hours: null, label: "—", tone: "none" }, s);
    assert.equal(contentReportRowIsActionable(s), false);
  }
  assert.deepEqual(contentReportElapsed(null, "pending", now), { hours: null, label: "—", tone: "none" });
  assert.ok(contentReportElapsedToneClass("danger").includes("red") && contentReportElapsedToneClass("warning").includes("amber"));
  assert.ok(!contentReportElapsedToneClass("ok").includes("red") && !contentReportElapsedToneClass("ok").includes("amber"));
});

// ── 빈 상태 · 플래시 ────────────────────────────────────────────────────────

test("빈 상태: 지시서 §1-3 원문 + 처리 순서 3단계 · 신고가 0건일 때 first · 검색 중 search · 탭만 비었으면 tab", () => {
  assert.equal(CONTENT_REPORT_EMPTY_STATE.title, "아직 접수된 신고가 없습니다");
  assert.equal(CONTENT_REPORT_EMPTY_STATE.description, "학생 모집이 시작되면 이 화면으로 신고가 쌓입니다. 지금은 비어 있는 것이 정상입니다.");
  assert.equal(CONTENT_REPORT_EMPTY_STATE.stepsTitle, "신고가 들어오면 이렇게 처리합니다");
  assert.deepEqual([...CONTENT_REPORT_EMPTY_STATE.steps], [
    "대상 콘텐츠와 신고 사유를 확인합니다",
    "숨김(복구 가능) · 경고 · 정지 · 삭제(복구 가능) 중 하나를 고릅니다",
    "처리 결과가 신고자에게 전달됩니다",
  ]);
  assert.equal(contentReportEmptyVariant("", 0), "first");
  assert.equal(contentReportEmptyVariant("", 3), "tab");
  assert.equal(contentReportEmptyVariant("김", 0), "search");
  assert.equal(contentReportFlashOkMessage("hidden"), "콘텐츠를 숨김 처리했습니다.");
  assert.equal(contentReportFlashOkMessage("deleted"), "삭제 처리했습니다.");
  assert.equal(contentReportFlashOkMessage("dismissed"), "신고를 기각했습니다.");
  assert.equal(contentReportFlashOkMessage("nope"), null);
});

// ── tripwire ────────────────────────────────────────────────────────────────

test("목록 페이지: PageScaffold 미사용 · AdminPageLayout · 구 툴바/페이지네이션/워크스페이스 미사용 · 기본 탭 상수로 파싱", () => {
  const page = stripComments(read(LIST_PAGE));
  assert.ok(!page.includes("PageScaffold"));
  assert.ok(page.includes("<AdminPageLayout") && page.includes("<ContentReportQueueList"));
  assert.ok(!page.includes("AdminListToolbar") && !page.includes("AdminListPagination") && !page.includes("AdminModerationWorkspace"));
  assert.ok(page.includes("parseAdminListParams(sp, { defaultPageSize: CONTENT_REPORT_DEFAULT_PAGE_SIZE, defaultStatus: CONTENT_REPORT_DEFAULT_TAB })"));
  assert.ok(page.includes("resolveContentReportTab(rawParams.status)"));
  assert.ok(page.includes("처리 실패 —"), "실패 플래시 문구");
  assert.ok(!existsSync(join(ROOT, "components/admin/AdminModerationWorkspace.tsx")) && !existsSync(join(ROOT, "components/admin/AdminContentReportsTable.tsx")), "구 워크스페이스·표 삭제");
});

test("목록 부품: Server Component · Counts/Tabs/Pagination 사용 · 자체 탭·페이지네이션 마크업 없음 · AdminStatusPill(content_reports.status) · 컬럼 6개 · 상세 링크 · 경과 톤 · 인라인 조치 없음", () => {
  const src = stripComments(read(LIST));
  assert.ok(!src.startsWith('"use client"'), "Server Component");
  assert.ok(src.includes("<AdminDataTable.Counts counts={counts} />") && src.includes("<AdminDataTable.Tabs") && src.includes("<AdminDataTable.Pagination"));
  assert.ok(!src.includes('aria-label="상태 탭"') && !src.includes("← 이전") && !src.includes("다음 →"), "탭·페이지네이션 마크업은 공용 부품에만");
  assert.ok(src.includes('<AdminStatusPill table="content_reports" column="status" value={item.status} size="sm" />'));
  for (const col of [">신고 대상</th>", ">유형</th>", ">신고자</th>", ">접수일</th>", ">경과</th>", ">상태</th>"]) assert.ok(src.includes(col), col);
  assert.ok(src.includes("contentReportDetailPath(item.id)"), "행 → 신고 상세");
  assert.ok(src.includes("contentReportElapsedToneClass(item.elapsed.tone)"), "경과 색");
  assert.ok(src.includes("CONTENT_REPORT_EMPTY_STATE.stepsTitle") && src.includes("CONTENT_REPORT_EMPTY_STATE.steps.map"), "빈 상태 3단계");
  assert.ok(!src.includes("updateContentReport") && !src.includes("bulkUpdateContentReportsAction"), "목록 인라인 조치·일괄 액션 없음(조치는 상세에서만)");
  assert.equal((src.match(/<form\b/g) ?? []).length, 1, "폼은 GET 검색 form 하나");
  assert.ok(src.includes('method="GET"') && !/<form action=\{(update|bulk)/.test(src));
  assert.ok(!/style=\{/.test(src) && !/alert\(/.test(src));
});

test("신고 상세: PageScaffold 미사용 · AdminPageLayout · AdminStatusPill · 조치 부품 · FormSubmitButton 제거 · 대상 종류는 코어의 normalize 로 판정 · 나머지 섹션(증거·메모·디버그) 유지", () => {
  const page = stripComments(read(DETAIL_PAGE));
  assert.ok(!page.includes("PageScaffold") && !page.includes("FormSubmitButton") && !page.includes("contentReportStatusLabel"));
  assert.ok(page.includes("<AdminPageLayout") && page.includes('<AdminStatusPill table="content_reports" column="status" value={status} size="sm" />'));
  assert.ok(page.includes("<ContentReportActionButtons reportId={id} targetKind={targetKind}"));
  assert.ok(page.includes("normalizeModerationTargetType(targetType)"), "서버 액션과 같은 판정");
  assert.ok(page.includes("<EvidenceSection evidence={evidence} />") && page.includes("<AdminCaseNotesPanel") && page.includes("원본 데이터(디버그)"), "레이아웃 유지");
  assert.ok(!page.includes("updateContentReportStatusAction") && !page.includes("updateContentReportModerationAction"), "액션 폼은 조치 부품 안으로");
});

test("조치 부품: ConfirmSubmitButton 6개(전부 stateChange · destructive 0) · 삭제는 재입력 없이 종류별 summary + 숨김으로 대신하기(숨김 모달만 연다) · 필드명 상수 · 서버 액션 그대로", () => {
  const src = stripComments(read(ACTIONS_UI));
  assert.ok(src.startsWith('"use client"'));
  assert.equal((src.match(/<ConfirmSubmitButton\b/g) ?? []).length, 6);
  assert.equal((src.match(/level="stateChange"/g) ?? []).length, 6);
  assert.equal((src.match(/level="destructive"/g) ?? []).length, 0, "PR-W2: 삭제도 stateChange");
  assert.ok(!/level="(critical|immediate)"/.test(src), "이 화면의 조치에 critical·immediate 없음");
  assert.ok(!src.includes("confirmText=") && !src.includes("ConfirmText("), "삭제 재입력 없음");
  assert.ok(!src.includes("복구 불가") && !src.includes("하드 삭제"), "복구 불가 문구 없음");
  assert.ok(src.includes("summary={buildContentReportDeleteSummary(targetKind)}") && src.includes("summary={buildContentReportHideSummary(targetKind)}"), "종류별 summary");
  assert.ok(src.includes("{CONTENT_REPORT_HIDE_INSTEAD_LABEL}") && src.includes("data-content-report-hide-instead"), "삭제 모달 안 숨김 대안");
  assert.ok(src.includes("document.getElementById(CONTENT_REPORT_ACTION_BUTTON_IDS.hidden)?.click()"), "대안 클릭 = 숨김 확인 모달 열기");
  assert.ok(!src.includes("requestSubmit"), "대안 버튼은 직접 제출하지 않는다");
  assert.ok(src.includes('<button\n                type="button"\n                onClick={hideInstead}'), "body 슬롯 버튼은 type=button");
  for (const id of ["reviewing", "resolved", "dismissed", "hidden", "restored", "deleted"]) assert.ok(src.includes(`id={CONTENT_REPORT_ACTION_BUTTON_IDS.${id}}`), id);
  assert.ok(src.includes("name={CONTENT_REPORT_REPORT_ID_FIELD}") && src.includes("name={CONTENT_REPORT_STATUS_FIELD}") && src.includes("name={CONTENT_REPORT_INTENT_FIELD}"));
  assert.ok(src.includes("action={updateContentReportStatusAction}") && src.includes("action={updateContentReportModerationAction}"), "기존 서버 액션 그대로");
  assert.equal((src.match(/<form action=\{updateContentReportStatusAction\}/g) ?? []).length, 3);
  assert.equal((src.match(/<form action=\{updateContentReportModerationAction\}/g) ?? []).length, 3);
  assert.ok(!src.includes("AdminConfirmDialog"), "자체 모달 금지 — ConfirmSubmitButton 경유");
});

test("서버 조회: 오래된 것이 위(created_at asc) · 탭 필터 .eq(status) · 서버 range · head count 폴백 · 신고자 이름·이메일 검색은 users 조인 · 세션 클라이언트로 신고 읽기", () => {
  const q = stripComments(read(QUERIES));
  assert.ok(q.includes('.order("created_at", { ascending: true })'), "오래된 것이 위");
  assert.ok(q.includes('r.eq("status", args.status)') && q.includes(".range(from, to)"));
  assert.ok(q.includes('select("id", { count: "exact", head: true })'), "head count");
  assert.ok(q.includes("buildAdminUsersSearchOr(term)") && q.includes("buildContentReportSearchOr(args.term, args.reporterIds)"));
  assert.ok(q.includes('supabase.from("content_reports")') && q.includes("mentorProfilesAdminReadClient(supabase)"), "신고는 세션 · users 는 관리자 읽기 클라이언트(이관 전과 동일)");
  const pure = stripComments(read(CONSOLE));
  assert.ok(!/from "react"|from "@\//.test(pure), "순수 모듈은 React·@/ import 없음");
});

test("UI 카피 금지어 없음(선생님·강사님·수강생·과외·alert)", () => {
  for (const rel of [LIST_PAGE, DETAIL_PAGE, LIST, ACTIONS_UI, CONSOLE, QUERIES]) {
    const code = stripComments(read(rel));
    for (const banned of ["선생님", "강사님", "수강생", "과외", "커패니티", "웰버십", "쌤버쉽", "alert("]) {
      assert.ok(!code.includes(banned), `${rel}: 금지 문구 ${banned}`);
    }
  }
});
