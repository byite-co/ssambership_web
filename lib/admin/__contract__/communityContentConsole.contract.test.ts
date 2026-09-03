// 계약 테스트: 커뮤니티 관리 화면(PR-11 §1) — 종류 탭 · 상태 탭(deleted_at 판정) · 조치 4종 확인 절차(종류별 삭제 방식) · 숨김으로 대신하기 · 빈 상태 · 플래시.
// 실행: node --test --experimental-strip-types lib/admin/__contract__/communityContentConsole.contract.test.ts
//
// .tsx 는 node --test 로 import 할 수 없으므로(strip-types 는 JSX 미지원):
//   ① 순수 규칙(종류 3 · 상태 탭 4 · 유효 상태 · 삭제 효과/summary · 재입력 · 조치 가용성 · 링크 · 검색 or() · 플래시 · 빈 상태)은 직접 검증한다
//   ② 렌더·배선 규칙은 소스 스캔 tripwire 로 고정한다(PageScaffold 미사용 · AdminPageLayout/AdminDataTable/AdminStatusPill · 조치 부품 등급 ·
//      삭제 모달 `숨김으로 대신하기` · 서버 액션·DB 쓰기 불변 · 숏폼·댓글 하드 DELETE 그대로 · 조회 전용)

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildAdminListUrl, parseAdminListParams } from "../adminListParams.ts";
import { buildAdminDataTableUrl } from "../adminDataTable.ts";
import { evaluateAdminConfirm, resolveAdminConfirmRequirements } from "../adminConfirmPolicy.ts";
import { adminStatusAllowedValues, resolveAdminStatus } from "../adminStatusDictionary.ts";
import { CONTENT_REPORT_HIDE_INSTEAD_LABEL } from "../contentReportConsole.ts";
import {
  COMMUNITY_CONTENT_ACTIONS,
  COMMUNITY_CONTENT_BASE_PATH,
  COMMUNITY_CONTENT_CONFIRM_TEXT_LENGTH,
  COMMUNITY_CONTENT_DEFAULT_PAGE_SIZE,
  COMMUNITY_CONTENT_DEFAULT_TAB,
  COMMUNITY_CONTENT_DEFAULT_TYPE,
  COMMUNITY_CONTENT_DELETED_LABEL,
  COMMUNITY_CONTENT_DELETE_EFFECT_LABELS,
  COMMUNITY_CONTENT_EMPTY_STATE,
  COMMUNITY_CONTENT_HARD_DELETE_BANNER,
  COMMUNITY_CONTENT_HIDE_INSTEAD_LABEL,
  COMMUNITY_CONTENT_REASON_FIELD,
  COMMUNITY_CONTENT_RETURN_TO_FIELD,
  COMMUNITY_CONTENT_TABLES,
  COMMUNITY_CONTENT_TABS,
  COMMUNITY_CONTENT_TAB_VALUES,
  COMMUNITY_CONTENT_TARGET_ID_FIELD,
  COMMUNITY_CONTENT_TARGET_TYPES,
  COMMUNITY_CONTENT_TYPE_PARAM,
  COMMUNITY_CONTENT_TYPE_TABS,
  COMMUNITY_CONTENT_TYPE_VALUES,
  buildCommunityContentDeleteSummary,
  buildCommunityContentHideSummary,
  buildCommunityContentListUrl,
  buildCommunityContentRestoreSummary,
  buildCommunityContentSearchOr,
  buildCommunityContentTypeTabUrl,
  communityContentActionButtonId,
  communityContentAvailableActions,
  communityContentDeleteConfirmText,
  communityContentDeleteEffect,
  communityContentEffectiveStatus,
  communityContentEmptyVariant,
  communityContentFlashOkMessage,
  communityContentHasDeletedRows,
  communityContentPublicPath,
  communityContentPublishedValue,
  communityContentReportsUrl,
  communityContentStatusLabel,
  communityContentSummaryText,
  communityContentTabFilter,
  isSafeCommunityContentReturnTo,
  resolveCommunityContentTab,
  resolveCommunityContentType,
  type CommunityContentType,
} from "../communityContentConsole.ts";

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const PAGE = "app/(admin)/admin/(console)/community-content/page.tsx";
const LOADING = "app/(admin)/admin/(console)/community-content/loading.tsx";
const LIST = "components/admin/CommunityContentList.tsx";
const ACTIONS_UI = "components/admin/CommunityContentActionButtons.tsx";
const CONSOLE = "lib/admin/communityContentConsole.ts";
const QUERIES = "lib/admin/adminCommunityContentQueries.ts";
const SERVER_ACTIONS = "lib/admin/communityModerationActions.ts";
const MODERATION_CORE = "lib/admin/communityModerationCore.ts";

function spFrom(url: string): Record<string, string | string[] | undefined> {
  const u = new URL(url, "https://ssambership.local");
  const sp: Record<string, string | string[] | undefined> = {};
  for (const [k, v] of u.searchParams.entries()) sp[k] = v;
  return sp;
}

const OPTS = { defaultPageSize: COMMUNITY_CONTENT_DEFAULT_PAGE_SIZE, defaultStatus: COMMUNITY_CONTENT_DEFAULT_TAB };
const UUID = "11111111-1111-4111-8111-111111111111";
const TYPES = [...COMMUNITY_CONTENT_TYPE_VALUES] as CommunityContentType[];

// ── 종류 탭 · 상태 탭 ───────────────────────────────────────────────────────

test("종류 탭은 글·숏폼·댓글 3개(구 URL 값 posts·shortforms·comments 유지) · 기본 글 · 구 board-comments 는 댓글 탭으로", () => {
  assert.deepEqual([...COMMUNITY_CONTENT_TYPE_VALUES], ["posts", "shortforms", "comments"]);
  assert.deepEqual(COMMUNITY_CONTENT_TYPE_TABS.map((t) => t.label), ["글", "숏폼", "댓글"]);
  assert.equal(COMMUNITY_CONTENT_DEFAULT_TYPE, "posts");
  assert.equal(resolveCommunityContentType("shortforms"), "shortforms");
  assert.equal(resolveCommunityContentType("board-comments"), "comments", "게시판 댓글은 브리지로 community_comments 에 있다");
  assert.equal(resolveCommunityContentType("nope"), "posts");
  assert.equal(resolveCommunityContentType(undefined), "posts");
  assert.deepEqual(COMMUNITY_CONTENT_TABLES, { posts: "community_posts", shortforms: "shortform_posts", comments: "community_comments" });
  assert.deepEqual(COMMUNITY_CONTENT_TARGET_TYPES, { posts: "community_post", shortforms: "shortform_post", comments: "community_comment" });
  assert.equal(COMMUNITY_CONTENT_TYPE_PARAM, "type");
});

test("상태 탭은 게시·숨김·삭제됨·전체 4개 · 기본 전체 · 쿼리 키는 status 하나(type 은 extra)", () => {
  assert.deepEqual([...COMMUNITY_CONTENT_TAB_VALUES], ["published", "hidden", "deleted", "all"]);
  assert.deepEqual(COMMUNITY_CONTENT_TABS.map((t) => t.label), ["게시", "숨김", "삭제됨", "전체"]);
  assert.equal(COMMUNITY_CONTENT_DEFAULT_TAB, "all");
  assert.equal(resolveCommunityContentTab("hidden"), "hidden");
  assert.equal(resolveCommunityContentTab("draft"), "all", "임시는 탭이 아니다(전체에서만 보인다)");
  const p = parseAdminListParams(spFrom(`${COMMUNITY_CONTENT_BASE_PATH}?type=comments&status=deleted`), OPTS);
  assert.equal(resolveCommunityContentTab(p.status), "deleted");
  assert.equal(resolveCommunityContentType(p.extra[COMMUNITY_CONTENT_TYPE_PARAM]), "comments");
});

// ── 유효 상태 — deleted_at 우선 · CHECK 가 deleted 를 막는다 ──────────────────

test("유효 상태: deleted_at 이 있으면 삭제됨(status 무관) · hidden · draft · 게시(글 published · 댓글 visible) — 사전 값 집합에 deleted 없음", () => {
  assert.equal(communityContentEffectiveStatus("posts", "published", "2026-09-01T00:00:00Z"), "deleted");
  assert.equal(communityContentEffectiveStatus("posts", "hidden", "2026-09-01T00:00:00Z"), "deleted", "삭제가 숨김보다 강하다");
  assert.equal(communityContentEffectiveStatus("posts", "hidden", null), "hidden");
  assert.equal(communityContentEffectiveStatus("posts", "draft", null), "draft");
  assert.equal(communityContentEffectiveStatus("posts", "published", null), "published");
  assert.equal(communityContentEffectiveStatus("comments", "visible", undefined), "published");
  assert.equal(communityContentEffectiveStatus("comments", "hidden", ""), "hidden");
  assert.equal(communityContentPublishedValue("comments"), "visible");
  assert.equal(communityContentPublishedValue("posts"), "published");
  for (const t of TYPES) assert.ok(!adminStatusAllowedValues(COMMUNITY_CONTENT_TABLES[t], "status").includes("deleted"), `${t}: 사전(CHECK 교집합)에 deleted 없음`);
  assert.equal(communityContentStatusLabel("posts", "deleted"), COMMUNITY_CONTENT_DELETED_LABEL);
  assert.equal(communityContentStatusLabel("posts", "published"), resolveAdminStatus("community_posts", "status", "published").label);
  assert.equal(communityContentStatusLabel("comments", "published"), resolveAdminStatus("community_comments", "status", "visible").label);
  assert.equal(communityContentStatusLabel("shortforms", "draft"), "임시");
});

test("탭 → 서버 필터: 게시·숨김은 deleted_at IS NULL 을 함께 · 삭제됨은 deleted_at IS NOT NULL · 전체는 조건 없음 · 하드 DELETE 종류는 삭제됨 행이 없다", () => {
  assert.deepEqual(communityContentTabFilter("posts", "published"), { status: "published", deleted: "exclude" });
  assert.deepEqual(communityContentTabFilter("comments", "published"), { status: "visible", deleted: "exclude" });
  assert.deepEqual(communityContentTabFilter("posts", "hidden"), { status: "hidden", deleted: "exclude" });
  assert.deepEqual(communityContentTabFilter("posts", "deleted"), { status: null, deleted: "only" });
  assert.deepEqual(communityContentTabFilter("posts", "all"), { status: null, deleted: "any" });
  assert.equal(communityContentHasDeletedRows("posts"), true);
  assert.equal(communityContentHasDeletedRows("shortforms"), false);
  assert.equal(communityContentHasDeletedRows("comments"), false);
});

// ── 삭제 방식 · summary · 재입력 ─────────────────────────────────────────────

test("삭제 효과 = applyContentModeration 분기 그대로: 게시판 글 soft-delete(복구 가능) · 숏폼·댓글 하드 DELETE(복구 불가) — 삭제 방식은 바꾸지 않았다", () => {
  assert.equal(communityContentDeleteEffect("posts"), "soft_delete");
  assert.equal(communityContentDeleteEffect("shortforms"), "hard_delete");
  assert.equal(communityContentDeleteEffect("comments"), "hard_delete");
  assert.deepEqual(COMMUNITY_CONTENT_DELETE_EFFECT_LABELS, { soft_delete: "소프트 삭제(복구 가능)", hard_delete: "영구 삭제(복구 불가)" });
  const core = stripComments(read(MODERATION_CORE));
  assert.ok(core.includes('if (targetType === "community_post") {') && core.includes(".update({ deleted_at: new Date().toISOString() })"), "게시판 글 soft-delete");
  assert.ok(core.includes('.delete().eq("id", targetId)'), "그 외 하드 DELETE — 바꾸지 않았다(soft-delete 전환은 DB-2)");
});

test("삭제 summary: 게시판 글 `삭제 후 복구할 수 있습니다` · 숏폼·댓글 첫 줄 `복구 불가` + `영구 삭제됩니다. 복구할 수 없습니다` · 숨김 `복구할 수 있습니다` · 복원 문구", () => {
  assert.equal(buildCommunityContentDeleteSummary("posts"), "이 게시판 글을 삭제합니다. 삭제 후 복구할 수 있습니다.");
  for (const t of ["shortforms", "comments"] as const) {
    const s = buildCommunityContentDeleteSummary(t);
    assert.ok(s.startsWith(COMMUNITY_CONTENT_HARD_DELETE_BANNER), `${t}: 첫 줄 복구 불가`);
    assert.ok(s.includes("영구 삭제됩니다. 복구할 수 없습니다"), t);
    assert.ok(!s.includes("복구할 수 있습니다"), `${t}: 복구 가능 문구 금지`);
  }
  assert.equal(COMMUNITY_CONTENT_HARD_DELETE_BANNER, "복구 불가");
  for (const t of TYPES) assert.ok(buildCommunityContentHideSummary(t).endsWith("숨깁니다. 복구할 수 있습니다."), t);
  assert.equal(buildCommunityContentRestoreSummary("posts", "deleted"), "삭제된 게시판 글을 복구합니다. 다시 게시 상태가 됩니다.");
  assert.equal(buildCommunityContentRestoreSummary("comments", "hidden"), "이 댓글을 다시 게시합니다.");
});

test("destructive 재입력 = 대상 ID 앞 8자(모든 종류) — 정책상 불일치면 확인 불가", () => {
  assert.equal(COMMUNITY_CONTENT_CONFIRM_TEXT_LENGTH, 8);
  assert.equal(communityContentDeleteConfirmText(UUID), "11111111");
  const req = resolveAdminConfirmRequirements({ level: "destructive", confirmText: communityContentDeleteConfirmText(UUID) });
  assert.equal(req.confirmText, "11111111");
  assert.equal(evaluateAdminConfirm(req, { reason: "", typedConfirmText: "1111111" }).ok, false);
  assert.equal(evaluateAdminConfirm(req, { reason: "", typedConfirmText: "11111111" }).ok, true);
});

// ── 조치 ────────────────────────────────────────────────────────────────────

test("조치 3종 등급: 숨김·복원 stateChange · 삭제 destructive · 상태별 가용 조치 · 행마다 다른 버튼 id · 숨김 대안 라벨은 PR-5 와 같다 · 필드명 불변", () => {
  assert.deepEqual(Object.keys(COMMUNITY_CONTENT_ACTIONS), ["hidden", "restored", "deleted"]);
  assert.equal(COMMUNITY_CONTENT_ACTIONS.hidden.level, "stateChange");
  assert.equal(COMMUNITY_CONTENT_ACTIONS.restored.level, "stateChange");
  assert.equal(COMMUNITY_CONTENT_ACTIONS.deleted.level, "destructive");
  for (const a of Object.values(COMMUNITY_CONTENT_ACTIONS)) assert.equal(resolveAdminConfirmRequirements({ level: a.level, confirmText: "x" }).needsDialog, true);
  assert.deepEqual(communityContentAvailableActions("published"), ["hidden", "deleted"]);
  assert.deepEqual(communityContentAvailableActions("hidden"), ["restored", "deleted"]);
  assert.deepEqual(communityContentAvailableActions("draft"), ["deleted"]);
  assert.deepEqual(communityContentAvailableActions("deleted"), ["restored"], "삭제된 행(게시판 글만 남는다)은 복원만");
  assert.notEqual(communityContentActionButtonId("hidden", "a"), communityContentActionButtonId("hidden", "b"));
  assert.notEqual(communityContentActionButtonId("hidden", "a"), communityContentActionButtonId("deleted", "a"));
  assert.equal(COMMUNITY_CONTENT_HIDE_INSTEAD_LABEL, CONTENT_REPORT_HIDE_INSTEAD_LABEL);
  assert.equal(COMMUNITY_CONTENT_TARGET_ID_FIELD, "targetId");
  assert.equal(COMMUNITY_CONTENT_REASON_FIELD, "reason");
  assert.equal(COMMUNITY_CONTENT_RETURN_TO_FIELD, "returnTo");
  assert.equal(isSafeCommunityContentReturnTo(`${COMMUNITY_CONTENT_BASE_PATH}?type=comments&status=hidden`), true);
  assert.equal(isSafeCommunityContentReturnTo("/admin/users"), false);
  assert.equal(isSafeCommunityContentReturnTo("//evil"), false);
  assert.equal(isSafeCommunityContentReturnTo(""), false);
});

// ── 링크 · 검색 ─────────────────────────────────────────────────────────────

test("링크: 목록 = 공용 빌더(status=all 유지 · type 보존) · 종류 탭은 type extra(글은 빈 값) · 신고 → 검수 목록 대상 ID 검색 · 공개 경로", () => {
  const p = parseAdminListParams(spFrom(`${COMMUNITY_CONTENT_BASE_PATH}?type=comments&status=all&q=x`), OPTS);
  for (const o of [{}, { page: 2 }, { status: "hidden" }, { search: "" }]) {
    assert.equal(buildCommunityContentListUrl(p, o), buildAdminDataTableUrl(COMMUNITY_CONTENT_BASE_PATH, p, o));
  }
  assert.ok(buildCommunityContentListUrl(p, {}).includes("status=all") && buildCommunityContentListUrl(p, {}).includes("type=comments"));
  assert.ok(!buildAdminListUrl(COMMUNITY_CONTENT_BASE_PATH, p, {}).includes("status="), "공용 빌더는 지운다(버그의 원인)");
  const toPosts = buildCommunityContentTypeTabUrl(p, "posts");
  assert.ok(!toPosts.includes("type=") && toPosts.includes("status=all"), `글 탭은 type 을 지우고 상태 탭은 유지: ${toPosts}`);
  const toShort = spFrom(buildCommunityContentTypeTabUrl(p, "shortforms"));
  assert.equal(toShort.type, "shortforms");
  assert.equal(toShort.q, "x", "검색어 유지");
  assert.equal(communityContentReportsUrl(UUID), `/admin/moderation?status=all&q=${UUID}`);
  assert.equal(communityContentPublicPath("posts", "p1"), "/community/board/p1");
  assert.equal(communityContentPublicPath("shortforms", "s1"), "/community/shortform/s1");
  assert.equal(communityContentPublicPath("comments", "c1", { postType: "shortform", postId: "s9" }), "/community/shortform/s9");
  assert.equal(communityContentPublicPath("comments", "c1", { postType: "board", postId: "p9" }), "/community/board/p9");
  assert.equal(communityContentPublicPath("comments", "c1", { postType: null, postId: null }), null);
});

test("검색 or(): 종류별 본문 컬럼 + author_label + 작성자 id.in · uuid 컬럼에는 ilike 를 걸지 않는다(완전한 UUID 만 eq)", () => {
  assert.equal(buildCommunityContentSearchOr("posts", "스팸", []), "title.ilike.%스팸%,body.ilike.%스팸%,author_label.ilike.%스팸%");
  assert.equal(buildCommunityContentSearchOr("shortforms", "스팸", []), "title.ilike.%스팸%,description.ilike.%스팸%,author_label.ilike.%스팸%");
  assert.equal(buildCommunityContentSearchOr("comments", "스팸", []), "body.ilike.%스팸%,author_label.ilike.%스팸%");
  assert.ok(!/id\.ilike|author_id\.ilike|post_id\.ilike/.test(buildCommunityContentSearchOr("comments", "abc123", [])));
  const withUuid = buildCommunityContentSearchOr("comments", UUID, [UUID, "nope"]);
  assert.ok(withUuid.includes(`id.eq.${UUID}`) && withUuid.includes(`author_id.eq.${UUID}`) && withUuid.includes(`post_id.eq.${UUID}`));
  assert.ok(withUuid.endsWith(`author_id.in.(${UUID})`));
  assert.ok(!buildCommunityContentSearchOr("posts", UUID, []).includes("post_id"), "post_id 는 댓글만");
  const many = Array.from({ length: 150 }, (_, i) => `${String(i).padStart(8, "0")}-1111-4111-8111-111111111111`);
  assert.equal(buildCommunityContentSearchOr("posts", "x", many).match(/-1111-4111-8111-111111111111/g)?.length, 100, "id 상한 100");
});

// ── 요약 · 플래시 · 빈 상태 ─────────────────────────────────────────────────

test("요약: 제목 우선 · 없으면 본문/내용/설명 앞 80자 · 전부 비면 — · 플래시 `${type}_${intent}` · 빈 상태 원문", () => {
  assert.equal(communityContentSummaryText({ title: " 제목 ", body: "본문" }), "제목");
  assert.equal(communityContentSummaryText({ title: "", description: "설명" }), "설명");
  assert.equal(communityContentSummaryText({ body: "가".repeat(100) }).length, 80);
  assert.equal(communityContentSummaryText({}), "—");
  assert.equal(communityContentFlashOkMessage("community_post_hidden"), "게시판 글을 숨김 처리했습니다.");
  assert.equal(communityContentFlashOkMessage("shortform_post_deleted"), "숏폼을 삭제했습니다.");
  assert.equal(communityContentFlashOkMessage("community_comment_restored"), "댓글을 복원했습니다.");
  assert.equal(communityContentFlashOkMessage("board_comment_hidden"), "게시판 댓글을 숨김 처리했습니다.");
  assert.equal(communityContentFlashOkMessage("nope"), null);
  assert.equal(communityContentFlashOkMessage(""), null);
  assert.equal(COMMUNITY_CONTENT_EMPTY_STATE.title, "아직 등록된 콘텐츠가 없습니다");
  assert.equal(COMMUNITY_CONTENT_EMPTY_STATE.description, "멘토가 숏폼·게시글을 올리면 검수 후 여기에 보입니다.");
  assert.equal(communityContentEmptyVariant("", 0), "first");
  assert.equal(communityContentEmptyVariant("", 3), "tab");
  assert.equal(communityContentEmptyVariant("김", 0), "search");
});

// ── tripwire ────────────────────────────────────────────────────────────────

test("페이지: PageScaffold·구 툴바·구 페이지네이션 미사용 · AdminPageLayout · 기본 탭·종류 상수로 파싱 · 실패 플래시 · loading.tsx", () => {
  const page = stripComments(read(PAGE));
  assert.ok(!page.includes("PageScaffold") && !page.includes("AdminListToolbar") && !page.includes("AdminListPagination"));
  assert.ok(page.includes("<AdminPageLayout") && page.includes("<CommunityContentList"));
  assert.ok(page.includes("parseAdminListParams(sp, { defaultPageSize: COMMUNITY_CONTENT_DEFAULT_PAGE_SIZE, defaultStatus: COMMUNITY_CONTENT_DEFAULT_TAB })"));
  assert.ok(page.includes("resolveCommunityContentType(rawParams.extra[COMMUNITY_CONTENT_TYPE_PARAM])") && page.includes("resolveCommunityContentTab(rawParams.status)"));
  assert.ok(page.includes("처리 실패 —"));
  assert.ok(existsSync(join(ROOT, LOADING)));
  assert.ok(!page.includes("requireRole("), "가드는 (admin)·(console) 레이아웃 이중 — 페이지 중복 호출 없음(PR-10 방식)");
});

test("목록 부품: Server Component · 종류 탭은 화면 렌더(type) · 상태 탭·페이지네이션은 공용 부품 · hidden type/status 는 기본값이 아닐 때만 · 컬럼 7 · 삭제됨 배지 · 사전 배지 · 신고·작성자 링크 · 행 조치 부품", () => {
  const src = stripComments(read(LIST));
  assert.ok(!src.startsWith('"use client"'));
  assert.ok(src.includes('aria-label="종류 탭"') && src.includes("buildCommunityContentTypeTabUrl(params, t.value)"), "종류 탭은 화면이 그린다");
  assert.ok(src.includes("<AdminDataTable.Tabs") && src.includes("<AdminDataTable.Pagination"));
  assert.ok(!src.includes('aria-label="상태 탭"') && !src.includes("← 이전") && !src.includes("다음 →"), "상태 탭·페이지네이션 마크업은 공용 부품에만");
  assert.ok(src.includes('{type !== COMMUNITY_CONTENT_DEFAULT_TYPE ? <input type="hidden" name={COMMUNITY_CONTENT_TYPE_PARAM} value={type} /> : null}'));
  assert.ok(src.includes('{tab !== COMMUNITY_CONTENT_DEFAULT_TAB ? <input type="hidden" name="status" value={tab} /> : null}'));
  assert.ok(!/tab !== "(all|pending)"/.test(src) && src.includes('name="q"') && src.includes('role="search"'));
  for (const col of [">종류</th>", ">제목/내용 요약</th>", ">작성자</th>", ">상태</th>", ">신고</th>", ">작성일</th>", ">조치</th>"]) assert.ok(src.includes(col), col);
  assert.ok(src.includes("<StatusBadge label={COMMUNITY_CONTENT_DELETED_LABEL} tone=\"danger\"") && src.includes('<AdminStatusPill table={table} column="status" value={item.rawStatus}'));
  assert.ok(src.includes("communityContentReportsUrl(item.id)") && src.includes("accountDetailPath(item.authorId)"));
  assert.ok(src.includes("<CommunityContentActionButtons type={item.type} targetId={item.id} status={item.status} returnTo={returnTo} />"));
  assert.ok(src.includes("COMMUNITY_CONTENT_EMPTY_STATE.title"), "빈 상태 원문");
  assert.equal((src.match(/<form\b/g) ?? []).length, 1, "목록 자체 폼은 GET 검색 form 하나(조치 폼은 부품 안)");
  assert.ok(!/style=\{/.test(src) && !/alert\(/.test(src));
});

test("조치 부품: 'use client' · ConfirmSubmitButton 두 갈래(destructive 1 · stateChange 1) · 삭제는 confirmText + 종류별 summary + 삭제 방식 재표시 + 하드 DELETE 배너 + 숨김으로 대신하기(숨김 모달만 연다) · 기존 서버 액션 9개 · 필드명 상수", () => {
  const src = stripComments(read(ACTIONS_UI));
  assert.ok(src.startsWith('"use client"'));
  assert.equal((src.match(/<ConfirmSubmitButton\b/g) ?? []).length, 2);
  assert.equal((src.match(/level="destructive"/g) ?? []).length, 1);
  assert.equal((src.match(/level="stateChange"/g) ?? []).length, 1);
  assert.ok(!/level="(critical|immediate)"/.test(src));
  assert.ok(src.includes("confirmText={communityContentDeleteConfirmText(targetId)}") && src.includes("summary={buildCommunityContentDeleteSummary(type)}"));
  assert.ok(src.includes('{ label: "삭제 방식", value: COMMUNITY_CONTENT_DELETE_EFFECT_LABELS[effect] }'), "삭제 방식 재표시");
  assert.ok(src.includes("data-community-content-hard-delete-banner") && src.includes("{COMMUNITY_CONTENT_HARD_DELETE_BANNER} — 영구 삭제됩니다. 복구할 수 없습니다."), "하드 DELETE 배너(굵게)");
  assert.ok(src.includes('effect === "hard_delete" ? (') , "배너는 하드 DELETE 종류에만");
  assert.ok(src.includes("{COMMUNITY_CONTENT_HIDE_INSTEAD_LABEL}") && src.includes("data-community-content-hide-instead"));
  assert.ok(src.includes('document.getElementById(communityContentActionButtonId("hidden", targetId))?.click()'), "대안 클릭 = 같은 행의 숨김 확인 모달 열기");
  assert.ok(!src.includes("requestSubmit") && !src.includes("AdminConfirmDialog"));
  assert.ok(src.includes("canHideInstead ? (") && src.includes('available.includes("hidden")'), "숨김이 가능한 행에서만 대안");
  for (const fn of ["directHideCommunityPostAction", "directDeleteCommunityPostAction", "directRestoreCommunityPostAction", "directHideShortformAction", "directDeleteShortformAction", "directRestoreShortformAction", "directHideCommentAction", "directDeleteCommentAction", "directRestoreCommentAction"]) {
    assert.ok(src.includes(fn), fn);
  }
  assert.ok(!src.includes("BoardComment"), "게시판 댓글 전용 액션은 쓰지 않는다(댓글 탭 = community_comments · 브리지)");
  assert.ok(src.includes("name={COMMUNITY_CONTENT_TARGET_ID_FIELD}") && src.includes("name={COMMUNITY_CONTENT_RETURN_TO_FIELD}"));
});

test("서버 액션·조회: returnTo 는 이 화면 안으로만 · 필드명 targetId/reason 불변 · 코어 삭제 분기 불변 · 조회 모듈은 select 만(deleted_at 판정) · 구 조회 함수 삭제", () => {
  const actions = stripComments(read(SERVER_ACTIONS));
  assert.ok(actions.includes("isSafeCommunityContentReturnTo(returnTo)"), "복귀 경로 검증");
  assert.equal((actions.match(/returnTo: textFromForm\(formData\.get\("returnTo"\)\)/g) ?? []).length, 12, "12개 액션 전부 returnTo 를 읽는다");
  assert.equal((actions.match(/reason: textFromForm\(formData\.get\("reason"\)\)/g) ?? []).length, 12);
  assert.ok(actions.includes("applyContentModeration({") && actions.includes("actionType: `community_${args.intent}_${args.targetType}`"), "코어·감사 로그 그대로");
  const q = stripComments(read(QUERIES));
  assert.ok(!/\.(insert|update|upsert|delete|rpc)\(/.test(q), "조회 전용");
  assert.ok(q.includes('r.not("deleted_at", "is", null)') && q.includes('r.is("deleted_at", null)'), "삭제됨 = deleted_at 판정");
  assert.ok(q.includes("mentorProfilesAdminReadClient(supabase)") && q.includes('.from("content_reports").select("target_id").in("target_id", unique)'), "신고 건수 집계");
  assert.ok(q.includes('if (args.tab === "deleted" && !communityContentHasDeletedRows(args.type)) return { rows: [], totalCount: 0, error: null };'), "하드 DELETE 종류의 삭제됨 탭은 조회 없이 0");
  assert.ok(!q.includes("loadAdminCommunityPostsListPaged") && !q.includes("countAdminCommunityByStatus"), "구 조회 함수 삭제");
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
