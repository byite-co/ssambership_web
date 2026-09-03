// 계약 테스트: 리뷰 관리 화면(PR-11 §2) — 유효 상태(블라인드 > 숨김 > 검토 완료 > 공개) · 탭(격리 보관함) · 조치 4종 stateChange · 삭제 경로 없음 · 상세 섹션 · 빈 상태.
// 실행: node --test --experimental-strip-types lib/admin/__contract__/reviewConsole.contract.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseAdminListParams } from "../adminListParams.ts";
import { buildAdminDataTableUrl } from "../adminDataTable.ts";
import { resolveAdminConfirmRequirements } from "../adminConfirmPolicy.ts";
import { adminStatusAllowedValues, resolveAdminStatus } from "../adminStatusDictionary.ts";
import { REVIEW_ACTION_VALUES } from "../adminActionTypeLabels.ts";
import {
  REVIEW_ACTIONS,
  REVIEW_ACTION_FIELD,
  REVIEW_ACTION_KEYS,
  REVIEW_ARCHIVE_SOURCES,
  REVIEW_BASE_PATH,
  REVIEW_DEFAULT_PAGE_SIZE,
  REVIEW_DEFAULT_TAB,
  REVIEW_DELETE_UNAVAILABLE_NOTE,
  REVIEW_ELIGIBILITY_RULE,
  REVIEW_EMPTY_STATE,
  REVIEW_ID_FIELD,
  REVIEW_MODERATION_PLAN,
  REVIEW_RETURN_TO_FIELD,
  REVIEW_STATE_VALUES,
  REVIEW_TABS,
  REVIEW_TAB_VALUES,
  buildReviewListUrl,
  buildReviewSearchOr,
  isSafeReviewReturnTo,
  resolveReviewTab,
  reviewAvailableActions,
  reviewDetailPath,
  reviewEffectiveState,
  reviewEmptyVariant,
  reviewFlashOkMessage,
  reviewRatingLabel,
  reviewReportsUrl,
  reviewStateLabel,
  reviewSummaryText,
  reviewTabFilter,
  reviewTabIsArchive,
} from "../reviewConsole.ts";

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const LIST_PAGE = "app/(admin)/admin/(console)/reviews/page.tsx";
const DETAIL_PAGE = "app/(admin)/admin/(console)/reviews/[reviewId]/page.tsx";
const LOADING = "app/(admin)/admin/(console)/reviews/loading.tsx";
const LIST = "components/admin/ReviewQueueList.tsx";
const ACTIONS_UI = "components/admin/ReviewActionButtons.tsx";
const CONSOLE = "lib/admin/reviewConsole.ts";
const QUERIES = "lib/admin/adminReviewQueries.ts";
const SERVER_ACTIONS = "lib/admin/adminReviewActions.ts";
const ADMIN_QUERIES = "lib/admin/adminQueries.ts";

function spFrom(url: string): Record<string, string | string[] | undefined> {
  const u = new URL(url, "https://ssambership.local");
  const sp: Record<string, string | string[] | undefined> = {};
  for (const [k, v] of u.searchParams.entries()) sp[k] = v;
  return sp;
}

const OPTS = { defaultPageSize: REVIEW_DEFAULT_PAGE_SIZE, defaultStatus: REVIEW_DEFAULT_TAB };
const UUID = "11111111-1111-4111-8111-111111111111";

// ── 유효 상태 · 사전 ────────────────────────────────────────────────────────

test("조치 플랜은 adminQueries 의 상수 플랜과 같다 · 유효 상태 우선순위 블라인드 > 숨김 > 검토 완료 > 공개 · 라벨은 사전 reviews.moderation_state", () => {
  const aq = stripComments(read(ADMIN_QUERIES));
  assert.ok(aq.includes('hide: { column: "is_hidden", mode: "boolean_true" },') && aq.includes('blind: { column: "is_blinded" },') && aq.includes('reviewDone: { column: "moderation_state", kind: "enum", enumValue: "reviewed" },'));
  assert.deepEqual(REVIEW_MODERATION_PLAN, { hide: { column: "is_hidden", mode: "boolean_true" }, blind: { column: "is_blinded" }, reviewDone: { column: "moderation_state", kind: "enum", enumValue: "reviewed" } });
  assert.equal(reviewEffectiveState({ is_hidden: true, is_blinded: true, moderation_state: "reviewed" }), "blinded");
  assert.equal(reviewEffectiveState({ is_hidden: true, is_blinded: false, moderation_state: "reviewed" }), "hidden");
  assert.equal(reviewEffectiveState({ is_hidden: false, is_blinded: false, moderation_state: "reviewed" }), "reviewed");
  assert.equal(reviewEffectiveState({ is_hidden: false, is_blinded: false, moderation_state: "visible" }), "visible");
  assert.equal(reviewEffectiveState({ is_hidden: false, is_blinded: false, moderation_state: "hidden" }), "hidden", "moderation_state=hidden 도 숨김");
  assert.equal(reviewEffectiveState({}), "visible");
  assert.deepEqual([...REVIEW_STATE_VALUES], adminStatusAllowedValues("reviews", "moderation_state"));
  assert.deepEqual(REVIEW_STATE_VALUES.map(reviewStateLabel), ["공개", "숨김", "블라인드", "검토 완료"]);
});

// ── 탭 ──────────────────────────────────────────────────────────────────────

test("탭은 공개·숨김·블라인드·격리·전체 5개(사전 라벨 + 격리·전체) · 기본 전체 · 탭 → is_hidden/is_blinded 필터 · 격리는 보관함 2곳", () => {
  assert.deepEqual([...REVIEW_TAB_VALUES], ["visible", "hidden", "blinded", "quarantine", "all"]);
  assert.deepEqual(REVIEW_TABS.map((t) => t.label), ["공개", "숨김", "블라인드", "격리", "전체"]);
  for (const t of REVIEW_TABS) if (t.value !== "quarantine" && t.value !== "all") assert.equal(t.label, resolveAdminStatus("reviews", "moderation_state", t.value).label);
  assert.equal(REVIEW_DEFAULT_TAB, "all");
  assert.equal(resolveReviewTab("quarantine"), "quarantine");
  assert.equal(resolveReviewTab("reviewed"), "all", "검토 완료는 탭이 아니다(공개 탭 안의 배지)");
  assert.deepEqual(reviewTabFilter("visible"), { isHidden: false, isBlinded: false });
  assert.deepEqual(reviewTabFilter("hidden"), { isHidden: true, isBlinded: null });
  assert.deepEqual(reviewTabFilter("blinded"), { isHidden: null, isBlinded: true });
  assert.deepEqual(reviewTabFilter("all"), { isHidden: null, isBlinded: null });
  assert.deepEqual(reviewTabFilter("quarantine"), { isHidden: null, isBlinded: null });
  assert.equal(reviewTabIsArchive("quarantine"), true);
  assert.equal(reviewTabIsArchive("all"), false);
  assert.deepEqual(REVIEW_ARCHIVE_SOURCES.map((s) => s.table), ["reviews_quarantine_archive", "reviews_duplicates_archive"]);
  const p = parseAdminListParams(spFrom(`${REVIEW_BASE_PATH}?status=all&page=2`), OPTS);
  assert.ok(buildReviewListUrl(p, {}).includes("status=all"));
  assert.equal(buildReviewListUrl(p, { page: 3 }), buildAdminDataTableUrl(REVIEW_BASE_PATH, p, { page: 3 }));
});

// ── 조치 ────────────────────────────────────────────────────────────────────

test("조치 4종 = 서버 액션 ACTION_SET 그대로 · 전부 stateChange · 상태별 가용 조치 · 삭제 경로 없음(하드·소프트 어느 쪽도) · 필드명 · returnTo", () => {
  const actions = stripComments(read(SERVER_ACTIONS));
  const actionSet = [...(actions.match(/const ACTION_SET = new Set\(\[([^\]]+)\]\)/)?.[1] ?? "").matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
  assert.deepEqual([...REVIEW_ACTION_KEYS].sort(), actionSet.sort());
  assert.deepEqual([...REVIEW_ACTION_KEYS].sort(), [...REVIEW_ACTION_VALUES].sort(), "감사 로그 사전의 review_${action} 전개와 같다");
  for (const key of REVIEW_ACTION_KEYS) {
    const a = REVIEW_ACTIONS[key];
    assert.equal(a.level, "stateChange", key);
    assert.equal(resolveAdminConfirmRequirements({ level: a.level }).needsDialog, true);
    assert.ok(a.summary && a.dialogTitle && a.confirmLabel && a.pendingLabel, key);
  }
  assert.ok(REVIEW_ACTIONS.hide.summary.includes("복원할 수 있습니다") && REVIEW_ACTIONS.blind.summary.includes("복원할 수 있습니다"));
  assert.deepEqual(reviewAvailableActions("visible"), ["hide", "blind", "review"]);
  assert.deepEqual(reviewAvailableActions("reviewed"), ["hide", "blind"]);
  assert.deepEqual(reviewAvailableActions("hidden"), ["restore", "blind"]);
  assert.deepEqual(reviewAvailableActions("blinded"), ["restore"]);
  assert.ok(!actionSet.includes("delete") && !/\.delete\(/.test(actions), "리뷰 삭제 액션 없음 — 새로 만들지 않았다");
  assert.ok(REVIEW_DELETE_UNAVAILABLE_NOTE.includes("삭제 조치는 없습니다"));
  assert.equal(REVIEW_ID_FIELD, "reviewId");
  assert.equal(REVIEW_ACTION_FIELD, "action");
  assert.equal(REVIEW_RETURN_TO_FIELD, "returnTo");
  assert.ok(actions.includes('formData.get("reviewId")') && actions.includes('formData.get("action")') && actions.includes('formData.get("returnTo")'));
  assert.ok(actions.includes("isSafeReviewReturnTo(returnTo)"));
  assert.ok(actions.includes("actionType: `review_${action}`"), "감사 로그 그대로");
  assert.equal(isSafeReviewReturnTo(reviewDetailPath(UUID)), true);
  assert.equal(isSafeReviewReturnTo("/admin/users"), false);
  assert.equal(isSafeReviewReturnTo("//x"), false);
});

// ── 검색 · 표시 · 빈 상태 ───────────────────────────────────────────────────

test("검색 or(): 본문 ilike + 멘토·작성자 id.in · uuid 는 eq 만 · 상한 100 · 평점·요약·경로·플래시·빈 상태", () => {
  assert.equal(buildReviewSearchOr("좋아요", []), "body.ilike.%좋아요%");
  const u = buildReviewSearchOr(UUID, [UUID, "x"]);
  assert.ok(u.includes(`id.eq.${UUID}`) && u.includes(`mentor_id.eq.${UUID}`) && u.includes(`author_id.eq.${UUID}`));
  assert.ok(u.includes(`mentor_id.in.(${UUID})`) && u.includes(`author_id.in.(${UUID})`));
  assert.ok(!/id\.ilike|mentor_id\.ilike|author_id\.ilike/.test(buildReviewSearchOr("abc", [])));
  const many = Array.from({ length: 150 }, (_, i) => `${String(i).padStart(8, "0")}-1111-4111-8111-111111111111`);
  assert.equal(buildReviewSearchOr("x", many).match(/mentor_id\.in\.\(([^)]*)\)/)?.[1].split(",").length, 100);
  assert.equal(reviewRatingLabel(4), "★ 4");
  assert.equal(reviewRatingLabel("5"), "★ 5");
  assert.equal(reviewRatingLabel(null), "—");
  assert.equal(reviewSummaryText("  안녕  하세요 "), "안녕 하세요");
  assert.equal(reviewSummaryText("가".repeat(120)).length, 100);
  assert.equal(reviewSummaryText(null), "—");
  assert.equal(reviewDetailPath(UUID), `/admin/reviews/${UUID}`);
  assert.equal(reviewReportsUrl(UUID), `/admin/moderation?status=all&q=${UUID}`);
  assert.ok(REVIEW_ELIGIBILITY_RULE.includes("2회 연속") && REVIEW_ELIGIBILITY_RULE.includes("check_review_eligibility"));
  assert.equal(reviewFlashOkMessage("hide"), "리뷰를 숨김 처리했습니다.");
  assert.equal(reviewFlashOkMessage("blind"), "리뷰를 블라인드 처리했습니다.");
  assert.equal(reviewFlashOkMessage("restore"), "리뷰를 복원했습니다.");
  assert.equal(reviewFlashOkMessage("review"), "검토 완료로 표시했습니다.");
  assert.equal(reviewFlashOkMessage("nope"), null);
  assert.equal(REVIEW_EMPTY_STATE.title, "아직 작성된 리뷰가 없습니다");
  assert.equal(REVIEW_EMPTY_STATE.description, "학생이 같은 멘토에게 2회 이상 결제하면 후기를 남길 수 있습니다.");
  assert.equal(reviewEmptyVariant("", 0), "first");
  assert.equal(reviewEmptyVariant("", 2), "tab");
  assert.equal(reviewEmptyVariant("x", 0), "search");
});

// ── tripwire ────────────────────────────────────────────────────────────────

test("목록 페이지: PageScaffold·구 표·힌트 칩 미사용 · AdminPageLayout · 기본 탭 상수로 파싱 · 격리 탭은 보관함 조회 · loading.tsx · 구 파일 삭제", () => {
  const page = stripComments(read(LIST_PAGE));
  assert.ok(!page.includes("PageScaffold") && !page.includes("AdminReviewsTable") && !page.includes("AdminStatusBadge") && !page.includes("AdminRecordTable"));
  assert.ok(page.includes("<AdminPageLayout") && page.includes("<ReviewQueueList"));
  assert.ok(page.includes("parseAdminListParams(sp, { defaultPageSize: REVIEW_DEFAULT_PAGE_SIZE, defaultStatus: REVIEW_DEFAULT_TAB })") && page.includes("resolveReviewTab(rawParams.status)"));
  assert.ok(page.includes("reviewTabIsArchive(tab)") && page.includes("loadReviewArchiveList("), "격리 탭");
  assert.ok(page.includes("처리 실패 —"));
  assert.ok(existsSync(join(ROOT, LOADING)));
  for (const gone of ["components/admin/AdminReviewsTable.tsx", "components/admin/AdminRecordTable.tsx", "components/admin/AdminStatusBadge.tsx"]) assert.ok(!existsSync(join(ROOT, gone)), `${gone} 삭제`);
  const aq = stripComments(read(ADMIN_QUERIES));
  assert.ok(!aq.includes("loadAdminReviewsPage") && !aq.includes("loadAdminReviewsList") && !aq.includes("AdminReviewsPageMeta"), "구 리뷰 목록 조회 삭제(조치 플랜 프로브는 유지)");
  assert.ok(aq.includes("export async function probeAdminReviewModerationPlan(") && aq.includes("export async function probeAdminReviewAuditColumnNames("));
});

test("목록 부품: Server Component · 공용 탭·페이지네이션 · hidden status 는 기본 탭이 아닐 때만 · 컬럼 7(평점 … 상태) · 사전 배지 · 상세·계정·신고 링크 · 인라인 조치 없음 · 격리 표", () => {
  const src = stripComments(read(LIST));
  assert.ok(!src.startsWith('"use client"'));
  assert.ok(src.includes("<AdminDataTable.Tabs") && src.includes("<AdminDataTable.Pagination"));
  assert.ok(!src.includes('aria-label="상태 탭"') && !src.includes("← 이전"));
  assert.ok(src.includes('{tab !== REVIEW_DEFAULT_TAB ? <input type="hidden" name="status" value={tab} /> : null}') && !/tab !== "(all|pending)"/.test(src));
  assert.ok(src.includes('name="q"') && src.includes('role="search"'));
  for (const col of [">평점</th>", ">내용 요약</th>", ">대상 멘토</th>", ">작성자</th>", ">신고</th>", ">작성일</th>", ">상태</th>"]) assert.ok(src.includes(col), col);
  assert.ok(src.includes('<AdminStatusPill table={REVIEW_TABLE} column="moderation_state" value={item.state} size="sm" />'));
  assert.ok(src.includes("reviewDetailPath(item.id)") && src.includes("accountDetailPath(item.mentorId)") && src.includes("accountDetailPath(item.authorId)") && src.includes("reviewReportsUrl(item.id)"));
  assert.ok(src.includes("data-review-archive-table") && src.includes("REVIEW_ARCHIVE_NOTE"), "격리 표 + 안내");
  assert.equal((src.match(/<form\b/g) ?? []).length, 1, "폼은 GET 검색 form 하나(조치는 상세에서만)");
  assert.ok(!src.includes("moderateAdminReviewAction") && !src.includes("ConfirmSubmitButton"));
  assert.ok(src.includes("REVIEW_EMPTY_STATE.title"));
});

test("상세: PageScaffold·JSON 덤프·FormSubmitButton 제거 · AdminPageLayout · 전문·멘토·작성자·결제 이력·신고 이력·처리 이력·조치 · 조치 부품은 stateChange 4종 · 자격은 RPC 값 · 조회 전용", () => {
  const page = stripComments(read(DETAIL_PAGE));
  assert.ok(!page.includes("PageScaffold") && !page.includes("JSON.stringify") && !page.includes("FormSubmitButton"));
  assert.ok(page.includes("<AdminPageLayout") && page.includes("loadReviewDetail(supabase, reviewId)"));
  for (const sec of ["data-review-body", "data-review-actions-section", "data-review-payments", "data-review-reports", "data-review-logs"]) assert.ok(page.includes(sec), sec);
  assert.ok(page.includes("<ReviewActionButtons reviewId={detail.id} state={detail.state} returnTo={returnTo}"));
  assert.ok(page.includes("REVIEW_ELIGIBILITY_RULE") && page.includes("REVIEW_ELIGIBILITY_LABELS[detail.payments.eligibility]"));
  assert.ok(page.includes("accountDetailPath(detail.mentorId)") && page.includes("accountDetailPath(detail.authorId)") && page.includes("contentReportDetailPath(r.id)"));
  assert.ok(page.includes("moderated_by") && page.includes("detail.logs.rows.map"), "처리 이력 = moderated_by + 감사 로그");
  const ui = stripComments(read(ACTIONS_UI));
  assert.ok(!ui.startsWith('"use client"'), "폼 + 클라이언트 확인 버튼(Server Component)");
  assert.equal((ui.match(/<ConfirmSubmitButton\b/g) ?? []).length, 1);
  assert.equal((ui.match(/level="stateChange"/g) ?? []).length, 1);
  assert.ok(!/level="(critical|destructive|immediate)"/.test(ui));
  assert.ok(ui.includes("action={moderateAdminReviewAction}") && ui.includes("reviewAvailableActions(state)"));
  assert.ok(ui.includes("name={REVIEW_ID_FIELD}") && ui.includes("name={REVIEW_ACTION_FIELD}") && ui.includes("name={REVIEW_RETURN_TO_FIELD}"));
  assert.ok(!ui.includes("AdminConfirmDialog"));
  const q = stripComments(read(QUERIES));
  assert.ok(!/\.(insert|update|upsert|delete)\(/.test(q), "조회 전용");
  assert.ok(q.includes('session.rpc("check_review_eligibility", { p_mentor_id: mentorId, p_student_id: authorId })'), "자격 판정은 DB RPC 값(웹 재구현 없음)");
  assert.ok(q.includes('.eq("target_type", "review")'), "처리 이력 = admin_action_logs(target_type=review)");
  assert.ok(q.includes("REVIEW_ARCHIVE_SOURCES.map") && q.includes("서비스 키가 없어 격리 보관함을 조회할 수 없습니다."), "보관함은 service_role 전용");
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
