// 계약 테스트: 학적 변경 요청 화면(PR-5 §2) — 목록 이관 · DocumentViewer 재사용 · 변경 전후 나란히 · 승인 summary 의 등급 · 사유 프리셋.
// 실행: node --test --experimental-strip-types lib/admin/__contract__/academicRecordChangeConsole.contract.test.ts
//
// .tsx 는 node --test 로 import 할 수 없으므로(strip-types 는 JSX 미지원):
//   ① 순수 규칙(탭 = CHECK 4종 · status 키 하나 · status=all 유지 · 선택 키 request · 검색 or() · 승인/반려/재제출 summary ·
//      프리셋 · 등급 표시 · 빈 상태 · 플래시)은 직접 검증한다
//   ② 렌더·배선 규칙은 소스 스캔 tripwire 로 고정한다(PageScaffold 미사용 · AdminPageLayout/AdminDataTable/AdminStatusPill ·
//      DocumentViewer 사용 · 변경 전후 렌더 · 결정 3종 ConfirmSubmitButton · 서버 액션 DB 쓰기 불변 · 등급 판정 로직 신설 없음 · 구 워크스페이스 삭제)

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildAdminListUrl, parseAdminListParams } from "../adminListParams.ts";
import { buildAdminDataTableUrl } from "../adminDataTable.ts";
import { ADMIN_CONFIRM_REASON_MIN_LENGTH, evaluateAdminConfirm, resolveAdminConfirmRequirements } from "../adminConfirmPolicy.ts";
import { adminStatusAllowedValues, resolveAdminStatus } from "../adminStatusDictionary.ts";
import { resolveSchoolTierReviewState, type SchoolTierReviewRowLite } from "../mentorSchoolTierReview.ts";
import {
  ACADEMIC_RECORD_CHANGE_APPROVED_NAME_FIELD,
  ACADEMIC_RECORD_CHANGE_BASE_PATH,
  ACADEMIC_RECORD_CHANGE_CUSTOM_REASON_LABEL,
  ACADEMIC_RECORD_CHANGE_DECISION_BUTTON_IDS,
  ACADEMIC_RECORD_CHANGE_DEFAULT_PAGE_SIZE,
  ACADEMIC_RECORD_CHANGE_DEFAULT_TAB,
  ACADEMIC_RECORD_CHANGE_EMPTY_STATE,
  ACADEMIC_RECORD_CHANGE_REASON_FIELD,
  ACADEMIC_RECORD_CHANGE_REASON_PRESETS,
  ACADEMIC_RECORD_CHANGE_REQUEST_ID_FIELD,
  ACADEMIC_RECORD_CHANGE_REVIEWABLE_STATUSES,
  ACADEMIC_RECORD_CHANGE_SELECTED_PARAM,
  ACADEMIC_RECORD_CHANGE_TABS,
  ACADEMIC_RECORD_CHANGE_TAB_VALUES,
  ACADEMIC_RECORD_CHANGE_TIER_NOTE,
  ACADEMIC_RECORD_CHANGE_TIER_UNCHANGED,
  academicRecordChangeEmptyVariant,
  academicRecordChangeFlashOkMessage,
  academicRecordChangeTabAscending,
  academicRecordChangeTabStatus,
  buildAcademicRecordChangeApproveSummary,
  buildAcademicRecordChangeListUrl,
  buildAcademicRecordChangeRejectSummary,
  buildAcademicRecordChangeResubmitSummary,
  buildAcademicRecordChangeSearchOr,
  describeAcademicRecordChangeTier,
  isAcademicRecordChangeReviewable,
  resolveAcademicRecordChangeTab,
} from "../academicRecordChangeConsole.ts";

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const PAGE = "app/(admin)/admin/(console)/academic-record-changes/page.tsx";
const LIST = "components/admin/AcademicRecordChangeQueueList.tsx";
const PANEL = "components/admin/AcademicRecordChangeReviewPanel.tsx";
const CONSOLE = "lib/admin/academicRecordChangeConsole.ts";
const QUERIES = "lib/admin/academicRecordChangeQueries.ts";
const SERVER_ACTIONS = "lib/admin/mentorAcademicRecordChangeReviewActions.ts";
const INVENTORY = "docs/audit/remote_db_inventory_20260804/constraints.json";

function spFrom(url: string): Record<string, string | string[] | undefined> {
  const u = new URL(url, "https://ssambership.local");
  const sp: Record<string, string | string[] | undefined> = {};
  for (const [k, v] of u.searchParams.entries()) sp[k] = v;
  return sp;
}

const OPTS = { defaultPageSize: ACADEMIC_RECORD_CHANGE_DEFAULT_PAGE_SIZE, defaultStatus: ACADEMIC_RECORD_CHANGE_DEFAULT_TAB };
const UUID = "11111111-1111-4111-8111-111111111111";

// ── 탭 = CHECK 4종 ───────────────────────────────────────────────────────────

test("탭은 대기·승인·반려·재제출·전체 5개, 기본 탭은 대기 — 값은 mentor_academic_record_change_requests.status CHECK 4종과 1:1(인벤토리 대조)", () => {
  assert.deepEqual([...ACADEMIC_RECORD_CHANGE_TAB_VALUES], ["pending", "approved", "rejected", "resubmit_required", "all"]);
  assert.deepEqual(ACADEMIC_RECORD_CHANGE_TABS.map((t) => t.label), ["대기", "승인", "반려", "재제출", "전체"]);
  assert.equal(ACADEMIC_RECORD_CHANGE_DEFAULT_TAB, "pending");
  type Row = { schema: string; table: string; conname: string; contype: string; definition: string };
  const inv = JSON.parse(read(INVENTORY)) as Row[];
  const check = inv.find((r) => r.table === "mentor_academic_record_change_requests" && r.conname === "mentor_academic_record_change_requests_status_check");
  assert.ok(check, "CHECK 제약 존재");
  const dbValues = [...check!.definition.matchAll(/'([^']*)'::text/g)].map((m) => m[1]).sort();
  assert.deepEqual(dbValues, [...ACADEMIC_RECORD_CHANGE_TAB_VALUES].filter((t) => t !== "all").sort(), "탭 값 == DB CHECK");
  assert.equal(resolveAcademicRecordChangeTab("resubmit_required"), "resubmit_required");
  assert.equal(resolveAcademicRecordChangeTab("superseded"), "pending", "탭이 아닌 값은 기본 탭");
  assert.equal(academicRecordChangeTabStatus("all"), null);
  assert.equal(academicRecordChangeTabStatus("approved"), "approved");
  assert.equal(academicRecordChangeTabAscending("pending"), true, "심사 대기는 오래된 것부터");
  assert.equal(academicRecordChangeTabAscending("resubmit_required"), true);
  assert.equal(academicRecordChangeTabAscending("approved"), false);
  assert.equal(academicRecordChangeTabAscending("all"), false);
});

test("상태 사전 대조: 이 컬럼은 사전에 없다 → AdminStatusPill 은 neutral 톤 + 원시 값으로 그린다(사전에 추가하지 않고 보고 — PR-6 후보)", () => {
  assert.deepEqual(adminStatusAllowedValues("mentor_academic_record_change_requests", "status"), [], "사전 미등재(이 PR 에서 추가하지 않는다)");
  for (const v of ["pending", "approved", "rejected", "resubmit_required"]) {
    const r = resolveAdminStatus("mentor_academic_record_change_requests", "status", v);
    assert.equal(r.known, false, v);
    assert.equal(r.tone, "neutral", v);
    assert.equal(r.label, v, "원시 값 그대로");
  }
});

test("심사 대상(pending·resubmit_required)은 서버 액션 REVIEWABLE_STATUSES 와 같은 집합", () => {
  assert.deepEqual([...ACADEMIC_RECORD_CHANGE_REVIEWABLE_STATUSES], ["pending", "resubmit_required"]);
  const actions = stripComments(read(SERVER_ACTIONS));
  assert.ok(actions.includes('const REVIEWABLE_STATUSES = ["pending", "resubmit_required"] as const;'));
  assert.ok(actions.includes('.in("status", [...REVIEWABLE_STATUSES])'));
  assert.equal(isAcademicRecordChangeReviewable("pending"), true);
  assert.equal(isAcademicRecordChangeReviewable("resubmit_required"), true);
  assert.equal(isAcademicRecordChangeReviewable("approved"), false);
  assert.equal(isAcademicRecordChangeReviewable(null), false);
});

// ── URL — status 키 하나 · status=all 유지 · 선택 키 request ─────────────────

test("status=all 버그 해소: 전체 탭 링크·페이지 이동·검색 초기화가 status=all 을 유지한다 · 선택 키 request 는 행 링크에만 실린다", () => {
  const all = parseAdminListParams(spFrom(`${ACADEMIC_RECORD_CHANGE_BASE_PATH}?status=all&q=%EC%84%9C&page=2&request=${UUID}`), OPTS);
  assert.ok(!buildAdminListUrl(ACADEMIC_RECORD_CHANGE_BASE_PATH, all, {}).includes("status="), "공용 빌더는 지운다(버그의 원인)");
  const { [ACADEMIC_RECORD_CHANGE_SELECTED_PARAM]: _sel, ...extra } = all.extra;
  const listParams = { ...all, extra };
  for (const url of [buildAcademicRecordChangeListUrl(listParams, {}), buildAcademicRecordChangeListUrl(listParams, { page: 3 }), buildAcademicRecordChangeListUrl(listParams, { search: "" })]) {
    assert.ok(url.includes("status=all"), url);
    assert.ok(!url.includes("request="), `탭·검색·페이지 링크에 선택 키 없음: ${url}`);
    assert.equal(resolveAcademicRecordChangeTab(parseAdminListParams(spFrom(url), OPTS).status), "all", url);
  }
  const rowHref = buildAcademicRecordChangeListUrl(listParams, { page: listParams.page, extra: { [ACADEMIC_RECORD_CHANGE_SELECTED_PARAM]: UUID } });
  assert.ok(rowHref.includes(`request=${UUID}`) && rowHref.includes("status=all") && rowHref.includes("page=2"), rowHref);
  assert.equal(ACADEMIC_RECORD_CHANGE_SELECTED_PARAM, "request");
  for (const u of ["", "?status=all", "?status=rejected&page=2", "?q=x"]) {
    const p = parseAdminListParams(spFrom(`${ACADEMIC_RECORD_CHANGE_BASE_PATH}${u}`), OPTS);
    for (const o of [{}, { status: "all" }, { page: 2 }, { search: "김" }]) {
      assert.equal(buildAcademicRecordChangeListUrl(p, o), buildAdminDataTableUrl(ACADEMIC_RECORD_CHANGE_BASE_PATH, p, o), `${u} ${JSON.stringify(o)}`);
    }
  }
});

test("검색 or(): 요청·확정 대학명·사유 부분일치 + 멘토 id.in(users 검색 결과) · uuid 컬럼에는 ilike 금지(완전한 UUID 만 eq)", () => {
  assert.equal(buildAcademicRecordChangeSearchOr("연세", []), "requested_university_name.ilike.%연세%,approved_university_name.ilike.%연세%,change_reason.ilike.%연세%");
  assert.ok(!/id\.ilike|mentor_id\.ilike/.test(buildAcademicRecordChangeSearchOr("abc", ["x"])));
  const withIds = buildAcademicRecordChangeSearchOr(UUID, [UUID]);
  assert.ok(withIds.includes(`id.eq.${UUID}`) && withIds.includes(`mentor_id.eq.${UUID}`) && withIds.endsWith(`mentor_id.in.(${UUID})`));
});

// ── 결정 — summary · 프리셋 · 필드명 ────────────────────────────────────────

test("승인 summary: 전후 학교 · 학과 그대로 · 학교 등급 변동 없음(승인은 등급을 다시 판정하지 않는다) · 인증 행 없으면 등급 정보 없음", () => {
  const s = buildAcademicRecordChangeApproveSummary({ name: "김서연", beforeUniversity: "서울대학교", beforeDepartment: "의예과", afterUniversity: "연세대학교", tierLabel: "서연고" });
  assert.equal(s, `김서연 멘토의 학교를 서울대학교 → 연세대학교 로 바꿔 승인합니다. 학과(의예과)는 그대로입니다. 학교 등급 서연고 → 서연고 (${ACADEMIC_RECORD_CHANGE_TIER_UNCHANGED}).`);
  assert.ok(s.includes("서울대학교 → 연세대학교") && s.includes("학교 등급"), "전후 학교·등급 변화 포함");
  const noTier = buildAcademicRecordChangeApproveSummary({ name: "", beforeUniversity: "", beforeDepartment: "", afterUniversity: "연세대학교", tierLabel: null });
  assert.ok(noTier.startsWith("이름 없음 멘토의 학교를 학교 미입력 → 연세대학교 로") && noTier.includes("학과는 요청에 없어 그대로입니다") && noTier.includes("학교 등급 정보 없음"));
  assert.equal(buildAcademicRecordChangeRejectSummary("김서연"), "김서연 멘토의 학적 변경 요청을 반려합니다. 프로필 학교는 바뀌지 않습니다.");
  assert.equal(buildAcademicRecordChangeResubmitSummary("김서연"), "김서연 멘토에게 서류 재제출을 요청합니다. 고쳐서 다시 낼 수 있습니다.");
  assert.ok(ACADEMIC_RECORD_CHANGE_TIER_NOTE.includes("다시 판정하지 않습니다"));
});

test("반려·재제출 사유 프리셋: 서류를 알아볼 수 없음 / 서류와 요청 불일치 / 직접 입력 — 프리셋은 정책 최소 길이와 서버 필수 검사를 통과한다 · 필드명은 액션이 읽는 rejectReason", () => {
  assert.deepEqual([...ACADEMIC_RECORD_CHANGE_REASON_PRESETS], ["서류를 알아볼 수 없음", "서류와 요청 불일치"]);
  assert.equal(ACADEMIC_RECORD_CHANGE_CUSTOM_REASON_LABEL, "직접 입력");
  const req = resolveAdminConfirmRequirements({ level: "stateChange", reasonRequired: true });
  for (const preset of ACADEMIC_RECORD_CHANGE_REASON_PRESETS) {
    assert.ok(preset.trim().length >= ADMIN_CONFIRM_REASON_MIN_LENGTH, preset);
    assert.equal(evaluateAdminConfirm(req, { reason: preset, typedConfirmText: "" }).ok, true, preset);
  }
  assert.equal(evaluateAdminConfirm(req, { reason: "", typedConfirmText: "" }).ok, false, "사유 없이 반려·재제출 불가");
  assert.equal(ACADEMIC_RECORD_CHANGE_REASON_FIELD, "rejectReason");
  assert.equal(ACADEMIC_RECORD_CHANGE_APPROVED_NAME_FIELD, "approvedUniversityName");
  assert.equal(ACADEMIC_RECORD_CHANGE_REQUEST_ID_FIELD, "requestId");
  const actions = stripComments(read(SERVER_ACTIONS));
  assert.ok(actions.includes('formData.get("rejectReason")') && actions.includes('formData.get("approvedUniversityName")') && actions.includes('formData.get("requestId")'));
  assert.ok(actions.includes('if (!rejectReason) {'), "서버도 사유 없는 제출을 막는다");
  assert.equal(new Set(Object.values(ACADEMIC_RECORD_CHANGE_DECISION_BUTTON_IDS)).size, 3);
});

test("서버 액션 DB 쓰기 불변: 승인은 요청 status=approved + mentor_profiles.university_name 만 갱신 · 반려/재제출은 status·reject_reason", () => {
  const actions = stripComments(read(SERVER_ACTIONS));
  assert.ok(actions.includes('status: "approved",') && actions.includes("approved_university_name: approvedUniversityName,"));
  assert.ok(actions.includes('.update({ university_name: approvedUniversityName, updated_at: reviewedAt })'), "프로필 반영은 university_name 만(등급 재판정 없음)");
  assert.ok(actions.includes('status: "rejected",') && actions.includes('status: "resubmit_required",') && actions.includes("reject_reason: rejectReason,"));
  assert.ok(!actions.includes("school_tier") && !actions.includes("mentor_school_verifications"), "액션은 등급을 건드리지 않는다");
});

// ── 등급 표시 · 빈 상태 · 플래시 ─────────────────────────────────────────────

test("등급 표시: 인증 행 없음 → null/none · 자동 판정 행 → 사전 라벨 + auto · 확정 행 → confirmed. 요청 대학의 등급 판정 함수는 코드에 없어 미리보기를 생략했다(신설 금지)", () => {
  assert.deepEqual(describeAcademicRecordChangeTier(null), { label: null, mode: "none" });
  assert.deepEqual(describeAcademicRecordChangeTier(resolveSchoolTierReviewState(null)), { label: null, mode: "none" });
  const row = (extra: Partial<SchoolTierReviewRowLite>): SchoolTierReviewRowLite => ({
    id: "v1", status: "approved", school_tier: "서연고", verified_major_category: "메디컬", verified_university_name: "서울대학교", verified_university_id: null,
    verified_department_name: "의예과", document_storage_ref: null, reviewed_by: null, reviewed_at: null, created_at: "2026-08-30T05:22:00Z", ...extra,
  });
  assert.deepEqual(describeAcademicRecordChangeTier(resolveSchoolTierReviewState(row({}))), { label: "서연고", mode: "auto" });
  assert.deepEqual(describeAcademicRecordChangeTier(resolveSchoolTierReviewState(row({ reviewed_by: "admin-1", school_tier: "건동홍" }))), { label: "건동홍", mode: "confirmed" });
  // 등급 판정 로직 신설 없음 — 트리거 LIKE 규칙(서울대%·연세대%…)을 TS 로 옮기지 않았다
  for (const rel of [CONSOLE, QUERIES, PANEL, LIST, PAGE]) {
    const code = stripComments(read(rel));
    assert.ok(!/서울대|연세대|고려대|서강대|성균관대|한양대/.test(code), `${rel}: 등급 판정 규칙 리터럴 없음`);
    assert.ok(!/school_tier\s*=|schoolTierFor|judgeTier|resolveTier/.test(code), `${rel}: 등급 판정 함수 없음`);
  }
});

test("빈 상태 문구 · 변형 · 플래시", () => {
  assert.equal(ACADEMIC_RECORD_CHANGE_EMPTY_STATE.title, "처리할 학적 변경 요청이 없습니다");
  assert.ok(ACADEMIC_RECORD_CHANGE_EMPTY_STATE.description.includes("지금은 비어 있는 것이 정상입니다"));
  assert.equal(academicRecordChangeEmptyVariant("", 0), "first");
  assert.equal(academicRecordChangeEmptyVariant("", 2), "tab");
  assert.equal(academicRecordChangeEmptyVariant("x", 0), "search");
  assert.equal(academicRecordChangeFlashOkMessage("approve"), "학적 변경 요청을 승인하고 프로필 학교를 반영했습니다.");
  assert.equal(academicRecordChangeFlashOkMessage("reject"), "학적 변경 요청을 반려했습니다.");
  assert.equal(academicRecordChangeFlashOkMessage("resubmit"), "서류 재제출을 요청했습니다.");
  assert.equal(academicRecordChangeFlashOkMessage("x"), null);
});

// ── tripwire ────────────────────────────────────────────────────────────────

test("페이지: PageScaffold 미사용 · AdminPageLayout · 목록 + 심사 패널 · 선택 키 request 는 목록 파라미터에서 제거 · 상세는 선택 1건만 조회 · 구 툴바/워크스페이스 미사용", () => {
  const page = stripComments(read(PAGE));
  assert.ok(!page.includes("PageScaffold") && !page.includes("AdminListToolbar") && !page.includes("AdminListPagination") && !page.includes("AdminAcademicRecordChangeWorkspace"));
  assert.ok(page.includes("<AdminPageLayout") && page.includes("<AcademicRecordChangeQueueList") && page.includes("<AcademicRecordChangeReviewPanel"));
  assert.ok(page.includes("const { [ACADEMIC_RECORD_CHANGE_SELECTED_PARAM]: _selectedExtra, ...extraWithoutSelected } = rawParams.extra;"));
  assert.ok(page.includes("loadAcademicRecordChangeDetail(supabase, selectedId)"), "선택 1건만");
  assert.ok(!page.includes("resolveStudentIdImageSignedUrl"), "행마다 서명 URL 발급하던 구 경로 없음");
  assert.ok(page.includes("parseAdminListParams(sp, { defaultPageSize: ACADEMIC_RECORD_CHANGE_DEFAULT_PAGE_SIZE, defaultStatus: ACADEMIC_RECORD_CHANGE_DEFAULT_TAB })"));
  assert.ok(!existsSync(join(ROOT, "components/admin/AdminAcademicRecordChangeWorkspace.tsx")), "구 워크스페이스 삭제");
});

test("목록 부품: Server Component · Counts/Tabs/Pagination · AdminStatusPill(mentor_academic_record_change_requests.status) · 컬럼 6개 · 행 링크는 request 키", () => {
  const src = stripComments(read(LIST));
  assert.ok(!src.startsWith('"use client"'));
  assert.ok(src.includes("<AdminDataTable.Counts counts={counts} />") && src.includes("<AdminDataTable.Tabs") && src.includes("<AdminDataTable.Pagination"));
  assert.ok(!src.includes('aria-label="상태 탭"') && !src.includes("← 이전") && !src.includes("다음 →"));
  assert.ok(src.includes('<AdminStatusPill table="mentor_academic_record_change_requests" column="status" value={item.status} size="sm" />'));
  for (const col of [">멘토</th>", ">현재 학교</th>", ">요청 학교</th>", ">사유</th>", ">요청일</th>", ">상태</th>"]) assert.ok(src.includes(col), col);
  assert.ok(src.includes("extra: { [ACADEMIC_RECORD_CHANGE_SELECTED_PARAM]: id }"), "행 링크에만 선택 키");
  assert.ok(src.includes("ACADEMIC_RECORD_CHANGE_EMPTY_STATE.title"), "빈 상태 문구");
});

test("심사 패널: DocumentViewer 재사용 · 서류 없음 → 제출된 서류 없음 · 변경 전/후 나란히(대학·학과) · 등급 안내 · 결정 3종 ConfirmSubmitButton stateChange · 반려/재제출 프리셋 · 승인 summary 는 등급 포함", () => {
  const src = stripComments(read(PANEL));
  assert.ok(src.startsWith('"use client"'));
  assert.ok(src.includes("<DocumentViewer") && src.includes("initialSource={detail.document}"), "PR-2 뷰어 그대로");
  assert.ok(src.includes("DOCUMENT_EMPTY_LABEL"), "서류 없음 표시");
  assert.ok(src.includes("data-academic-record-change-diff") && src.includes(">변경 전</p>") && src.includes(">변경 후</p>"), "변경 전후 나란히");
  assert.equal((src.match(/<Cell label="대학"/g) ?? []).length, 2, "대학 전·후");
  assert.equal((src.match(/<Cell label="학과"/g) ?? []).length, 2, "학과 전·후");
  assert.ok(src.includes("ACADEMIC_RECORD_CHANGE_TIER_NOTE") && src.includes("data-academic-record-change-tier"), "등급 안내");
  assert.equal((src.match(/<ConfirmSubmitButton\b/g) ?? []).length, 3);
  assert.equal((src.match(/level="stateChange"/g) ?? []).length, 3);
  assert.ok(src.includes("summary={approveSummary}") && src.includes("buildAcademicRecordChangeApproveSummary({"), "승인 summary(등급 포함)");
  assert.equal((src.match(/reasonPresets=\{ACADEMIC_RECORD_CHANGE_REASON_PRESETS\}/g) ?? []).length, 2, "반려·재제출 프리셋");
  assert.equal((src.match(/reasonFieldName=\{ACADEMIC_RECORD_CHANGE_REASON_FIELD\}/g) ?? []).length, 2);
  assert.ok(src.includes("name={ACADEMIC_RECORD_CHANGE_APPROVED_NAME_FIELD}") && src.includes("name={ACADEMIC_RECORD_CHANGE_REQUEST_ID_FIELD}"));
  assert.ok(src.includes("action={approveMentorAcademicRecordChangeAction}") && src.includes("action={rejectMentorAcademicRecordChangeAction}") && src.includes("action={requestMentorAcademicRecordChangeResubmitAction}"), "기존 서버 액션 그대로");
  assert.ok(!src.includes("AdminConfirmDialog") && !/style=\{/.test(src));
});

test("서버 조회: 멘토 이름·이메일 검색은 users 조인 · 탭 .eq(status) · 정렬은 탭 규칙 · 서류는 describeStudentIdDocument · 등급은 mentor_school_verifications 현재 값만", () => {
  const q = stripComments(read(QUERIES));
  assert.ok(q.includes("buildAdminUsersSearchOr(term)") && q.includes("buildAcademicRecordChangeSearchOr(args.term, args.mentorIds)"));
  assert.ok(q.includes('r.eq("status", args.status)') && q.includes('.order("created_at", { ascending: academicRecordChangeTabAscending(args.tab) })') && q.includes(".range(from, to)"));
  assert.ok(q.includes("describeStudentIdDocument(db, docRef)"), "PR-2 서류 소스");
  assert.ok(q.includes('.from("mentor_school_verifications")') && q.includes("pickSchoolTierReviewRow(tierRows)"), "현재 등급 행");
  assert.ok(q.includes("mentorProfilesAdminReadClient(supabase)"), "관리자 읽기 클라이언트(이관 전과 동일)");
  const pure = stripComments(read(CONSOLE));
  assert.ok(!/from "react"|from "@\//.test(pure), "순수 모듈은 React·@/ import 없음");
});

test("UI 카피 금지어 없음(선생님·강사님·수강생·과외·alert)", () => {
  for (const rel of [PAGE, LIST, PANEL, CONSOLE, QUERIES]) {
    const code = stripComments(read(rel));
    for (const banned of ["선생님", "강사님", "수강생", "과외", "커패니티", "웰버십", "쌤버쉽", "alert("]) {
      assert.ok(!code.includes(banned), `${rel}: 금지 문구 ${banned}`);
    }
  }
});
