// 계약 테스트: 멘토 승인 작업대(PR-2) — 지시서 §11 검증 항목.
// 실행: node --test --experimental-strip-types lib/admin/__contract__/mentorApprovalWorkbench.contract.test.ts
//
// .tsx 는 node --test 로 import 할 수 없으므로(strip-types 는 JSX 미지원):
//   ① 순수 규칙(큐·탭·검색·대기 우선 페이징 · 신원 판정 · 뷰어 모델 · 등급 확정 상태 · 결정·단축키 정책)은 직접 검증한다
//   ② 렌더·배선 규칙은 소스 스캔 tripwire 로 고정한다(PageScaffold 미사용 · filter 키 폐기 · 이미지/PDF 분기 · 재시도 버튼 ·
//      세 결정 버튼 stateChange · A/R/D 는 click(다이얼로그만) · 정원 TS 계산 없음 · DB 쓰기 패치 불변)

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseAdminListParams, buildAdminListUrl } from "../adminListParams.ts";
import { MENTOR_PENDING_STATUS_VALUES_FOR_IN } from "../mentorApprovalConstants.ts";
import {
  MENTOR_APPROVAL_BASE_PATH,
  MENTOR_APPROVAL_DEFAULT_TAB,
  MENTOR_APPROVAL_PENDING_TAB_STATUSES,
  MENTOR_APPROVAL_RESUBMIT_STATUSES,
  MENTOR_APPROVAL_SELECTED_PARAM,
  MENTOR_APPROVAL_TABS,
  MENTOR_APPROVAL_TAB_VALUES,
  MENTOR_SEARCH_USER_ID_LIMIT,
  buildMentorApprovalListUrl,
  buildMentorProfileSearchOr,
  buildMentorUserSearchOr,
  isMentorApprovalDecidable,
  isMentorApprovalPendingTabStatus,
  mentorApprovalTabStatuses,
  normalizeMentorSearchTerm,
  queueProgressRange,
  resolveMentorApprovalTab,
  splitPendingFirstRange,
} from "../mentorApprovalQueue.ts";
import {
  IDENTITY_PENDING_TTL_MS,
  IDENTITY_UNVERIFIED_WARNING,
  identityListBadgeLabel,
  identityPhoneDisplay,
  identityReviewLabel,
  identityReviewTone,
  isIdentityUnverified,
  namesMatchIgnoringWhitespace,
  resolveMentorIdentityReview,
  type MentorIdentityRowLite,
} from "../mentorIdentityReview.ts";
import {
  DOCUMENT_LOW_RES_BADGE,
  DOCUMENT_LOW_RES_THRESHOLD_BYTES,
  DOCUMENT_ZOOM_STEPS,
  classifyDocumentKind,
  formatDocumentSize,
  isLowResolutionDocument,
  isSignedUrlExpired,
  rotateDocument,
  signedUrlRefreshDelayMs,
  stepDocumentZoom,
} from "../documentViewerModel.ts";
import {
  SCHOOL_TIER_RPC_REVIEWABLE_STATUSES,
  pickSchoolTierReviewRow,
  resolveSchoolTierReviewState,
  schoolTierConfirmBlockerMessage,
  type SchoolTierReviewRowLite,
} from "../mentorSchoolTierReview.ts";
import { adminStatusAllowedValues } from "../adminStatusDictionary.ts";
import { SCHOOL_TIERS, VERIFIED_MAJOR_CATEGORIES } from "../../mentor/schoolVerificationConstants.ts";
import {
  MENTOR_APPROVAL_DIALOG_ONLY_ACTIONS,
  MENTOR_APPROVAL_SHORTCUTS,
  MENTOR_DECISION_ACTION_TYPES,
  MENTOR_DECISION_BUTTON_IDS,
  MENTOR_DECISION_CUSTOM_REASON_LABEL,
  MENTOR_DECISION_DESCRIPTIONS,
  MENTOR_DECISION_REASON_FIELD,
  MENTOR_DECISION_REASON_PRESETS,
  buildMentorApproveSummary,
  formatCapValue,
  resolveMentorApprovalShortcut,
  sameSchoolTodayWarning,
  shouldIgnoreMentorApprovalShortcut,
} from "../mentorApprovalDecision.ts";

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const PAGE = "app/(admin)/admin/(console)/mentor-approval/page.tsx";
const LIST = "components/admin/MentorApprovalQueueList.tsx";
const PANEL = "components/admin/MentorApprovalReviewPanel.tsx";
const DECISION = "components/admin/MentorApprovalDecisionBar.tsx";
const SHORTCUTS = "components/admin/MentorApprovalShortcuts.tsx";
const VIEWER = "components/admin/DocumentViewer.tsx";
const QUERIES = "lib/admin/mentorApprovalWorkbenchQueries.ts";
const ACTIONS = "lib/admin/mentorApprovalActions.ts";

function spFrom(url: string): Record<string, string | string[] | undefined> {
  const u = new URL(url, "https://ssambership.local");
  const sp: Record<string, string | string[] | undefined> = {};
  for (const [k, v] of u.searchParams.entries()) sp[k] = v;
  return sp;
}

// ── §11 탭: status 키 하나 · 클라이언트 필터 없음 ─────────────────────────────

test("탭은 대기·승인·반려·재제출·전체 5개, 기본 탭은 대기", () => {
  assert.deepEqual([...MENTOR_APPROVAL_TAB_VALUES], ["pending", "approved", "rejected", "resubmit_required", "all"]);
  assert.deepEqual(
    MENTOR_APPROVAL_TABS.map((t) => t.label),
    ["대기", "승인", "반려", "재제출", "전체"]
  );
  assert.equal(MENTOR_APPROVAL_DEFAULT_TAB, "pending");
});

test("쿼리 키는 status 하나 — 구 filter 키는 탭에 영향이 없다(파싱 시 extra 로만 남는다)", () => {
  const opts = { defaultPageSize: 25, defaultStatus: MENTOR_APPROVAL_DEFAULT_TAB };
  const withFilter = parseAdminListParams(spFrom(`${MENTOR_APPROVAL_BASE_PATH}?filter=approved`), opts);
  assert.equal(resolveMentorApprovalTab(withFilter.status), "pending", "filter 키는 탭을 바꾸지 못한다");
  const withStatus = parseAdminListParams(spFrom(`${MENTOR_APPROVAL_BASE_PATH}?status=approved`), opts);
  assert.equal(resolveMentorApprovalTab(withStatus.status), "approved");
  assert.equal(resolveMentorApprovalTab("weird"), "pending", "모르는 값은 기본 탭");
  assert.equal(resolveMentorApprovalTab(""), "pending");
  for (const src of [read(PAGE), read(LIST), read(PANEL)]) {
    assert.ok(!/sp\.filter|"filter"|filter=/.test(stripComments(src)), "filter 키 사용 금지");
  }
});

test("탭 필터는 서버 집합이며 서로 겹치지 않는다 — 대기 탭 + 재제출 탭 = 액션 .in(...) 집합(H1)", () => {
  const pending = mentorApprovalTabStatuses("pending")!;
  const resubmit = mentorApprovalTabStatuses("resubmit_required")!;
  assert.deepEqual([...pending].sort(), [...MENTOR_APPROVAL_PENDING_TAB_STATUSES].sort());
  assert.deepEqual([...resubmit].sort(), [...MENTOR_APPROVAL_RESUBMIT_STATUSES].sort());
  assert.ok(resubmit.includes("under_review"), "requestMentorDocumentsAction 이 쓰는 under_review 는 재제출 탭");
  assert.ok(resubmit.includes("resubmit_required"));
  for (const s of pending) assert.ok(!resubmit.includes(s), `${s} 가 두 탭에 겹친다`);
  // 대기 탭 ∪ (재제출 탭 ∩ 액션 집합) == 승인·반려 액션의 .in 조건 — 액션 집합의 어떤 값도 탭에서 빠지지 않는다.
  const actionSet = [...MENTOR_PENDING_STATUS_VALUES_FOR_IN].sort();
  const covered = [...pending, ...resubmit.filter((s) => actionSet.includes(s))].sort();
  assert.deepEqual(covered, actionSet, "액션 .in 집합은 대기·재제출 탭이 전부 덮는다");
  // 사전 값 resubmit_required 는 기존 액션의 .in 집합 밖이다(액션 DB 조건은 이 PR 이 바꾸지 않는다) —
  // 재제출 탭에는 보이되 결정 버튼은 잠긴다("이미 처리됨" 배너). PR-2b 후속: 사전 값 ↔ 액션 집합 정합.
  assert.equal(isMentorApprovalDecidable("resubmit_required"), false);
  assert.deepEqual(mentorApprovalTabStatuses("approved"), ["approved"]);
  assert.deepEqual(mentorApprovalTabStatuses("rejected"), ["rejected"]);
  assert.equal(mentorApprovalTabStatuses("all"), null);
  for (const s of MENTOR_PENDING_STATUS_VALUES_FOR_IN) assert.equal(isMentorApprovalDecidable(s), true, s);
  assert.equal(isMentorApprovalDecidable("approved"), false);
  assert.equal(isMentorApprovalPendingTabStatus("under_review"), false);
  assert.equal(isMentorApprovalPendingTabStatus("pending"), true);
});

test("25건 제한이 사라졌다: 목록·탭·건수는 서버 조회(mentor_profiles range/head count)이고 클라이언트 filter 가 없다", () => {
  const q = stripComments(read(QUERIES));
  assert.ok(q.includes('.in("verification_status", [...scope.statuses])'), "탭 필터는 서버 .in");
  assert.ok(q.includes('.not("verification_status", "in"'), "전체 탭 나머지 부분은 서버 .not in");
  assert.ok(q.includes('{ count: "exact", head: true }'), "탭 건수는 head count");
  assert.ok(q.includes(".range(from, to)"), "서버 페이징");
  const list = stripComments(read(LIST));
  assert.ok(!/useState|useMemo|\.filter\(\(r\)/.test(list), "목록은 Server Component — 클라이언트 필터 없음");
  assert.ok(!list.startsWith('"use client"'));
});

// ── §11 검색: 이름·이메일·대학 각각 서버 쿼리에 반영 ─────────────────────────

test("검색어 정규화: PostgREST 패턴·구분자 문자를 제거하고 상한을 건다", () => {
  assert.equal(normalizeMentorSearchTerm("  김%서_연, (x) "), "김 서 연 x");
  assert.equal(normalizeMentorSearchTerm(""), "");
  assert.equal(normalizeMentorSearchTerm(null), "");
  assert.equal(normalizeMentorSearchTerm("a".repeat(200)).length, 80);
});

test("이름·이메일은 users 조회 or(), 대학·학과는 mentor_profiles or() + users 결과 user_id.in — 셋이 모두 쿼리에 반영된다", () => {
  const userOr = buildMentorUserSearchOr("서연");
  assert.ok(userOr.includes("full_name.ilike.%서연%"), "이름");
  assert.ok(userOr.includes("email.ilike.%서연%"), "이메일");
  assert.ok(userOr.includes("nickname.ilike.%서연%"), "닉네임");
  const ids = ["11111111-1111-4111-8111-111111111111", "not-a-uuid"];
  const profileOr = buildMentorProfileSearchOr("서울대", ids);
  assert.ok(profileOr.includes("university_name.ilike.%서울대%"), "대학");
  assert.ok(profileOr.includes("department_name.ilike.%서울대%"), "학과");
  assert.ok(profileOr.includes("user_id.in.(11111111-1111-4111-8111-111111111111)"), "users 결과 id 연결");
  assert.ok(!profileOr.includes("not-a-uuid"), "uuid 형식이 아닌 값은 in 절에 넣지 않는다");
  assert.ok(!buildMentorProfileSearchOr("x", []).includes("user_id.in"), "id 없으면 in 절 생략");
  const many = Array.from({ length: 150 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
  const inClause = /user_id\.in\.\(([^)]*)\)/.exec(buildMentorProfileSearchOr("x", many))![1];
  assert.equal(inClause.split(",").length, MENTOR_SEARCH_USER_ID_LIMIT, "in 절 상한");
  const q = stripComments(read(QUERIES));
  assert.ok(q.includes('from("users").select("id").or(buildMentorUserSearchOr(term))'), "users 검색이 서버 쿼리에 배선");
  assert.ok(q.includes("r.or(buildMentorProfileSearchOr(scope.term, scope.userIds))"), "profiles 검색이 서버 쿼리에 배선");
});

// ── 대기 건이 항상 위: range 산술 ──────────────────────────────────────────────

test("splitPendingFirstRange: 대기 부분과 나머지 부분을 두 range 로 정확히 쪼갠다", () => {
  assert.deepEqual(splitPendingFirstRange(1, 0, 24), { pending: { from: 0, to: 0 }, rest: { from: 0, to: 23 } });
  assert.deepEqual(splitPendingFirstRange(0, 0, 24), { pending: null, rest: { from: 0, to: 24 } });
  assert.deepEqual(splitPendingFirstRange(30, 0, 24), { pending: { from: 0, to: 24 }, rest: null });
  assert.deepEqual(splitPendingFirstRange(30, 25, 49), { pending: { from: 25, to: 29 }, rest: { from: 0, to: 19 } });
  assert.deepEqual(splitPendingFirstRange(30, 50, 74), { pending: null, rest: { from: 20, to: 44 } });
  assert.deepEqual(splitPendingFirstRange(25, 0, 24), { pending: { from: 0, to: 24 }, rest: null });
  assert.deepEqual(splitPendingFirstRange(25, 25, 49), { pending: null, rest: { from: 0, to: 24 } });
});

test("하단 진행 표시 N / 전체: 1-based 구간", () => {
  assert.deepEqual(queueProgressRange(1, 25, 25, 74), { first: 1, last: 25 });
  assert.deepEqual(queueProgressRange(3, 25, 24, 74), { first: 51, last: 74 });
  assert.deepEqual(queueProgressRange(1, 25, 0, 0), { first: 0, last: 0 });
});

test("선택 지원자 키(mentor)는 행 링크에만 실리고 탭·검색·페이지 링크에는 실리지 않는다 · 전체 탭은 status=all 을 잃지 않는다", () => {
  const opts = { defaultStatus: MENTOR_APPROVAL_DEFAULT_TAB };
  const params = parseAdminListParams(spFrom(`${MENTOR_APPROVAL_BASE_PATH}?status=all&q=%EC%84%9C&mentor=abc`), opts);
  assert.equal(params.extra[MENTOR_APPROVAL_SELECTED_PARAM], "abc", "mentor 는 예약 키가 아니라 extra 로 파싱된다");
  const { [MENTOR_APPROVAL_SELECTED_PARAM]: _m, ...extra } = params.extra;
  const listParams = { ...params, extra };
  const tabHref = buildMentorApprovalListUrl(listParams, { status: "approved" });
  assert.ok(!tabHref.includes("mentor=") && tabHref.includes("status=approved"), tabHref);
  const rowHref = buildMentorApprovalListUrl(listParams, { page: 1, extra: { [MENTOR_APPROVAL_SELECTED_PARAM]: "xyz" } });
  assert.ok(rowHref.includes("mentor=xyz") && rowHref.includes("status=all") && rowHref.includes("q="), rowHref);
  // 공용 빌더는 status=all 을 지운다 → 이 화면(기본 탭 대기)에서는 대기 탭으로 튄다. 화면 전용 빌더가 되살린다.
  const shared = buildAdminListUrl(MENTOR_APPROVAL_BASE_PATH, listParams, { status: "all" });
  assert.ok(!shared.includes("status="), shared);
  const own = buildMentorApprovalListUrl(listParams, { status: "all" });
  assert.equal(resolveMentorApprovalTab(parseAdminListParams(spFrom(own), opts).status), "all", own);
  assert.equal(resolveMentorApprovalTab(parseAdminListParams(spFrom(shared), opts).status), "pending", "공용 빌더 결과는 대기 탭으로 재파싱된다(그래서 전용 빌더가 필요)");
  // 대기 탭 링크는 status 를 생략해도 기본 탭이라 그대로다
  const pendingHref = buildMentorApprovalListUrl(listParams, { status: "pending" });
  assert.equal(resolveMentorApprovalTab(parseAdminListParams(spFrom(pendingHref), opts).status), "pending");
  const page = stripComments(read(PAGE));
  assert.ok(page.includes("const { [MENTOR_APPROVAL_SELECTED_PARAM]: _selectedExtra, ...extraWithoutSelected } = rawParams.extra;"));
  assert.ok(!page.includes("buildAdminListUrl(") && !stripComments(read(LIST)).includes("buildAdminListUrl("), "화면은 전용 빌더만 쓴다");
});

// ── §11 신원 블록: 일치 / 불일치 / pending / 시도 없음 (+ 만료·실패) ─────────

const NOW = Date.parse("2026-09-02T09:00:00+09:00");
const verifiedRow = (name: string, extra: Partial<MentorIdentityRowLite> = {}): MentorIdentityRowLite => ({
  kind: "self",
  status: "verified",
  verified_name: name,
  birthdate: "2004-03-11",
  verified_at: "2026-08-30T05:22:00+00:00",
  created_at: "2026-08-30T05:20:00+00:00",
  mobile_no_enc: "v1:abc",
  ...extra,
});

test("신원 판정 4상태 + 만료·실패: 일치 / 불일치 / 인증 진행 중(pending) / 인증 시도 없음 / 만료·실패", () => {
  const match = resolveMentorIdentityReview([verifiedRow("김서연")], "김서연", NOW);
  assert.equal(match.kind, "match");
  assert.equal(match.verified, true);
  assert.equal(match.verifiedName, "김서연");
  assert.equal(match.birthdate, "2004-03-11");
  assert.equal(match.phoneRegistered, true);

  const mismatch = resolveMentorIdentityReview([verifiedRow("이서연")], "김서연", NOW);
  assert.equal(mismatch.kind, "mismatch");
  assert.equal(identityReviewTone("mismatch"), "danger", "불일치는 위험색");

  const pending = resolveMentorIdentityReview(
    [{ kind: "self", status: "pending", verified_name: null, birthdate: null, verified_at: null, created_at: new Date(NOW - 60_000).toISOString() }],
    "김서연",
    NOW
  );
  assert.equal(pending.kind, "pending");
  assert.equal(identityReviewLabel("pending"), "인증 진행 중");

  const none = resolveMentorIdentityReview([], "김서연", NOW);
  assert.equal(none.kind, "none");
  assert.equal(identityReviewLabel("none"), "인증 시도 없음");

  const stalePending = resolveMentorIdentityReview(
    [{ kind: "self", status: "pending", verified_name: null, birthdate: null, verified_at: null, created_at: new Date(NOW - IDENTITY_PENDING_TTL_MS - 1).toISOString() }],
    "김서연",
    NOW
  );
  assert.equal(stalePending.kind, "lapsed", "30분 넘긴 pending 은 진행 중이 아니다(identity service 의 TTL 과 동일)");
  const expired = resolveMentorIdentityReview(
    [{ kind: "self", status: "expired", verified_name: null, birthdate: null, verified_at: null, created_at: "2026-08-01T00:00:00Z" }],
    "김서연",
    NOW
  );
  assert.equal(expired.kind, "lapsed");
  assert.equal(identityReviewLabel("lapsed"), "인증 만료·실패");

  for (const k of ["pending", "lapsed", "none"] as const) assert.equal(isIdentityUnverified(k), true, k);
  for (const k of ["match", "mismatch"] as const) assert.equal(isIdentityUnverified(k), false, k);
  assert.equal(identityListBadgeLabel("match"), "인증 완료");
  assert.equal(identityListBadgeLabel("pending"), "인증 진행 중");
  assert.equal(identityListBadgeLabel("none"), "인증 없음");
});

test("일치 판정은 공백 제거 후 비교 · 보호자(guardian) 행은 무시 · verified 가 있으면 pending 행이 있어도 완료", () => {
  assert.equal(namesMatchIgnoringWhitespace("김 서연", "김서연 "), true);
  assert.equal(namesMatchIgnoringWhitespace("", ""), false, "빈 이름은 일치로 치지 않는다");
  const guardianOnly = resolveMentorIdentityReview([verifiedRow("보호자", { kind: "guardian" })], "김서연", NOW);
  assert.equal(guardianOnly.kind, "none");
  const both = resolveMentorIdentityReview(
    [
      verifiedRow("김서연"),
      { kind: "self", status: "pending", verified_name: null, birthdate: null, verified_at: null, created_at: new Date(NOW - 1000).toISOString() },
    ],
    "김서연",
    NOW
  );
  assert.equal(both.kind, "match");
});

test("전화번호는 마스킹만 — 복호 없이 등록 여부만 · 경고 문장은 지시서 §4 원문", () => {
  assert.equal(identityPhoneDisplay(true), "등록됨");
  assert.equal(identityPhoneDisplay(false), "미등록");
  assert.equal(IDENTITY_UNVERIFIED_WARNING, "본인인증이 완료되지 않았습니다 — 승인 후 인증 안내가 발송됩니다");
  const q = stripComments(read(QUERIES));
  assert.ok(!/decryptIdentityField|identityCrypto|encryption"/.test(q), "관리자 조회는 복호 함수를 부르지 않는다");
  assert.ok(q.includes('from("identity_verifications")'), "identity_verifications 조회");
  assert.ok(q.includes("serviceRoleOrNull()"), "service_role 로 읽는다(정책 0개 테이블)");
  assert.ok(q.includes("IDENTITY_READ_UNAVAILABLE_MESSAGE"), "키 부재는 '없음' 으로 속이지 않고 판정 불가로 드러낸다");
});

test("미인증이어도 승인을 잠그지 않는다 — 결정 바는 decidable(상태)로만 가려지고 identity 로 disabled 되지 않는다", () => {
  const panel = stripComments(read(PANEL));
  assert.ok(panel.includes("{detail.decidable ? (") && panel.includes("<MentorApprovalDecisionBar"), "결정 바 조건은 decidable");
  const decision = stripComments(read(DECISION));
  assert.ok(!/disabled=\{/.test(decision), "결정 버튼에 disabled 조건 없음(승인 잠금 금지)");
  const summary = buildMentorApproveSummary({ name: "김서연", university: "서울대", department: "의예과", tierConfirmed: false, tierLabel: "서연고", identityKind: "none" });
  assert.ok(summary.includes(IDENTITY_UNVERIFIED_WARNING), "승인 모달 summary 에 미인증 경고 한 줄");
  assert.ok(summary.includes("자동 판정(미확정)") && summary.includes("서울대"));
  const verified = buildMentorApproveSummary({ name: "김서연", university: "서울대", department: "의예과", tierConfirmed: true, tierLabel: "서연고", identityKind: "match" });
  assert.ok(!verified.includes(IDENTITY_UNVERIFIED_WARNING));
  assert.ok(verified.includes("확정됨") && verified.includes("이름 일치"));
});

// ── §11 뷰어: 이미지·PDF 분기 · 300KB 배지 · 실패 재시도 ──────────────────────

test("mimetype 분기: image/* → image · application/pdf → pdf · 메타 없으면 확장자 · 모르면 unknown", () => {
  assert.equal(classifyDocumentKind("image/jpeg", "a/b.bin"), "image");
  assert.equal(classifyDocumentKind("application/pdf", "a/b.jpg"), "pdf", "메타가 확장자보다 우선");
  assert.equal(classifyDocumentKind(null, "uuid/1788159094932-73a1.pdf"), "pdf");
  assert.equal(classifyDocumentKind(null, "uuid/x.PNG"), "image");
  assert.equal(classifyDocumentKind(null, "uuid/x.docx"), "unknown");
  assert.equal(classifyDocumentKind("", null), "unknown");
});

test("300KB 미만 배지 — 경계값: 307,199 은 저해상도, 307,200 은 아니다 · 크기 미상은 배지 없음", () => {
  assert.equal(DOCUMENT_LOW_RES_THRESHOLD_BYTES, 300 * 1024);
  assert.equal(isLowResolutionDocument(DOCUMENT_LOW_RES_THRESHOLD_BYTES - 1), true);
  assert.equal(isLowResolutionDocument(DOCUMENT_LOW_RES_THRESHOLD_BYTES), false);
  assert.equal(isLowResolutionDocument(58331), true, "실데이터 최소 PDF 58KB");
  assert.equal(isLowResolutionDocument(4019373), false, "실데이터 최대 3.8MB");
  assert.equal(isLowResolutionDocument(null), false);
  assert.equal(DOCUMENT_LOW_RES_BADGE, "저해상도 · 판독 주의");
  assert.equal(formatDocumentSize(58331), "57KB");
  assert.equal(formatDocumentSize(4019373), "3.8MB");
});

test("확대·축소 단계 · 90도 회전 · 서명 URL 만료 판정", () => {
  assert.equal(stepDocumentZoom(1, 1), 1.25);
  assert.equal(stepDocumentZoom(1, -1), 0.75);
  assert.equal(stepDocumentZoom(DOCUMENT_ZOOM_STEPS[DOCUMENT_ZOOM_STEPS.length - 1], 1), 3, "최대에서 더 커지지 않는다");
  assert.equal(stepDocumentZoom(0.5, -1), 0.5);
  assert.equal(stepDocumentZoom(1.1, 1), 1.25, "표 밖 값은 가장 가까운 단계로 스냅 후 이동");
  assert.equal(rotateDocument(0), 90);
  assert.equal(rotateDocument(270), 0);
  assert.equal(rotateDocument(-90), 0);
  const now = 1_000_000;
  assert.equal(isSignedUrlExpired(now + 300_000, now), false);
  assert.equal(isSignedUrlExpired(now + 10_000, now), true, "여유(20초) 안이면 만료로 본다");
  assert.equal(isSignedUrlExpired(null, now), true);
  assert.equal(signedUrlRefreshDelayMs(now + 300_000, now), 280_000);
  assert.equal(signedUrlRefreshDelayMs(now - 1, now), 0);
});

test("DocumentViewer 렌더 배선: <img>/<iframe> 분기 · 재시도 버튼 + 새 탭 · 저해상도 배지 · 서명 URL 재요청 · 인라인 style 없음", () => {
  const src = read(VIEWER);
  const code = stripComments(src);
  assert.ok(src.startsWith('"use client"'));
  assert.ok(/kind === "image" \?/.test(code) && /<img\b/.test(code) && /<iframe\b/.test(code), "이미지 → img · PDF → iframe 분기");
  assert.ok(code.includes("재시도") && code.includes("새 탭에서 열기"), "실패 시 재시도 + 새 탭");
  assert.ok(code.includes("DOCUMENT_LOW_RES_BADGE"), "저해상도 배지");
  assert.ok(code.includes("refreshStudentIdDocumentAction(storagePath)"), "서명 URL 서버 재요청");
  assert.ok(code.includes("signedUrlRefreshDelayMs(expiresAt)"), "만료 전 재요청 타이머");
  assert.ok(code.includes("DOCUMENT_VIEWER_FULLSCREEN_EVENT"), "F 단축키 이벤트 수신");
  assert.ok(code.includes("rotateDocument(") && code.includes("stepDocumentZoom("), "회전·확대");
  assert.ok(!/style=\{/.test(code), "Tailwind only — 인라인 style 금지(CLAUDE.md 코딩 규칙 3)");
  assert.ok(!/alert\(/.test(code), "alert 금지");
  const docs = read("lib/admin/mentorApprovalDocuments.ts");
  assert.ok(docs.includes("parseStudentIdImageStorageRef(storedRef)"), "버킷 접두를 벗겨 서명 URL 발급");
  assert.ok(docs.includes(".list(dir, { limit: METADATA_LIST_LIMIT, search: fileName })"), "스토리지 메타데이터(mimetype·size) 조회");
  const pane = stripComments(read("components/admin/MentorApprovalDocumentsPane.tsx"));
  assert.ok(pane.includes("DOCUMENT_EMPTY_LABEL"), "서류 없음 → '제출된 서류 없음'(빈 뷰어 금지)");
});

// ── §11 등급 확정: reviewed_by NULL/NOT NULL 배지 · 드롭다운 값 == 상태 사전 == DB CHECK ──

const tierRow = (extra: Partial<SchoolTierReviewRowLite>): SchoolTierReviewRowLite => ({
  id: "v1",
  status: "approved",
  school_tier: "서연고",
  verified_major_category: "메디컬",
  verified_university_name: "서울대학교",
  verified_university_id: "서울대학교",
  verified_department_name: "의예과",
  document_storage_ref: null,
  reviewed_by: null,
  reviewed_at: "2026-08-30T05:22:00Z",
  created_at: "2026-08-30T05:22:00Z",
  ...extra,
});

test("reviewed_by NULL → 자동 판정·미확정, NOT NULL → 확정됨 · 드롭다운 초기값은 행의 값", () => {
  const auto = resolveSchoolTierReviewState(tierRow({}));
  assert.equal(auto.mode, "auto");
  assert.equal(auto.suggestedTier, "서연고");
  assert.equal(auto.suggestedCategory, "메디컬");
  const confirmed = resolveSchoolTierReviewState(tierRow({ reviewed_by: "admin-uuid" }));
  assert.equal(confirmed.mode, "confirmed");
  const none = resolveSchoolTierReviewState(null);
  assert.equal(none.mode, "none");
  assert.equal(none.confirmable, false);
  assert.equal(none.suggestedTier, "미분류");
});

test("확정 RPC 전제: pending/resubmit_required + 서류 있음만 확정 가능 — 트리거 자동 행(approved·서류 없음)은 두 blocker 로 잠긴다", () => {
  assert.deepEqual([...SCHOOL_TIER_RPC_REVIEWABLE_STATUSES], ["pending", "resubmit_required"]);
  const autoRow = resolveSchoolTierReviewState(tierRow({}));
  assert.deepEqual(autoRow.blockers, ["not_reviewable_status", "document_missing"]);
  assert.equal(autoRow.confirmable, false);
  const ok = resolveSchoolTierReviewState(tierRow({ status: "pending", document_storage_ref: "student-id-images/u/school-verifications/a.pdf" }));
  assert.equal(ok.confirmable, true);
  assert.deepEqual(ok.blockers, []);
  assert.ok(schoolTierConfirmBlockerMessage("not_reviewable_status", "approved").includes("approve_mentor_school_verification_admin"));
  assert.ok(schoolTierConfirmBlockerMessage("document_missing").includes("DOCUMENT_REF_MISSING"));
  // RPC 174 본문: reviewed_by · reviewed_at 을 채운다(중단 조건 아님) — SQL 원문으로 고정
  const sql = read("supabase/sql/174_mentor_school_verification_approval_canon.sql");
  assert.ok(sql.includes("reviewed_by = v_admin,") && sql.includes("reviewed_at = now(),"), "RPC 가 reviewed_by·reviewed_at 을 채운다");
  assert.ok(sql.includes("if v_row.status not in ('pending', 'resubmit_required') then"), "RPC 는 pending·resubmit_required 만 받는다");
  assert.ok(sql.includes("raise exception 'DOCUMENT_REF_MISSING'"), "RPC 는 서류 없는 행을 거부한다");
});

test("행 선택: approved 우선 → 심사 대상 최신 → 최신", () => {
  const rows = [
    tierRow({ id: "old-pending", status: "pending", created_at: "2026-08-01T00:00:00Z" }),
    tierRow({ id: "approved", status: "approved", created_at: "2026-07-01T00:00:00Z" }),
    tierRow({ id: "superseded", status: "superseded", created_at: "2026-08-20T00:00:00Z" }),
  ];
  assert.equal(pickSchoolTierReviewRow(rows)?.id, "approved");
  assert.equal(pickSchoolTierReviewRow(rows.filter((r) => r.id !== "approved"))?.id, "old-pending");
  assert.equal(pickSchoolTierReviewRow([rows[2]])?.id, "superseded");
  assert.equal(pickSchoolTierReviewRow([]), null);
});

test("드롭다운 값은 PR-1 상태 사전에서 오고, 사전 값 == 코드 상수 == DB CHECK(6 등급 · 8 계열)", () => {
  const tiers = adminStatusAllowedValues("mentor_school_verifications", "school_tier");
  const cats = adminStatusAllowedValues("mentor_school_verifications", "verified_major_category");
  assert.deepEqual(tiers, ["서연고", "서성한", "중경외시", "건동홍", "그외", "미분류"]);
  assert.deepEqual(cats, ["메디컬", "교육", "인문", "사회상경", "자연", "공학", "예체능", "기타"]);
  assert.deepEqual([...tiers].sort(), [...SCHOOL_TIERS].sort());
  assert.deepEqual([...cats].sort(), [...VERIFIED_MAJOR_CATEGORIES].sort());
  const panel = stripComments(read(PANEL));
  assert.ok(panel.includes('adminStatusAllowedValues("mentor_school_verifications", "school_tier")'), "등급 옵션은 사전");
  assert.ok(panel.includes('adminStatusAllowedValues("mentor_school_verifications", "verified_major_category")'), "계열 옵션은 사전");
  assert.ok(panel.includes("approveMentorSchoolVerificationAction"), "확정 = 기존 RPC 액션(새 쓰기 경로 없음)");
  assert.ok(panel.includes("SCHOOL_TIER_BADGE_AUTO") && panel.includes("SCHOOL_TIER_BADGE_CONFIRMED_PREFIX"), "자동/확정 배지 분기");
  assert.ok(panel.includes("disabled={!schoolTier.confirmable}"), "RPC 가 받지 않는 행은 확정 버튼 잠금 + 이유 표시");
});

// ── §11 결정: 세 버튼 · 프리셋 · stateChange 모달 · 사유 감사 로그 ─────────────

test("결정 영역: 세 버튼 모두 ConfirmSubmitButton stateChange · 반려/재제출은 프리셋(타이핑 없이 제출) · 승인은 summary", () => {
  const src = read(DECISION);
  const code = stripComments(src);
  assert.ok(src.startsWith('"use client"'));
  assert.equal((code.match(/<ConfirmSubmitButton/g) ?? []).length, 3, "세 버튼");
  assert.equal((code.match(/level="stateChange"/g) ?? []).length, 3, "셋 다 stateChange");
  assert.equal((code.match(/reasonPresets=\{MENTOR_DECISION_REASON_PRESETS\}/g) ?? []).length, 2, "반려·재제출에 프리셋");
  assert.ok(code.includes("summary={approveSummary}"), "승인 summary");
  assert.ok(code.includes("approveMentorApplicationAction") && code.includes("rejectMentorApplicationAction") && code.includes("requestMentorDocumentsAction"), "기존 서버 액션 3종 그대로");
  assert.ok(!/AdminConfirmDialog|role="dialog"|fixed inset-0/.test(code), "자체 모달 금지 — PR-1 부품만");
  assert.ok(!/alert\(/.test(code));
  // 세 버튼 같은 크기: 공통 BUTTON_BASE(h-11 w-full) 를 셋이 공유
  assert.equal((code.match(/\$\{BUTTON_BASE\}/g) ?? []).length, 3, "세 버튼 시각적 무게 동일(같은 크기 클래스)");
  assert.ok(code.includes("bg-[#1A56DB]"), "승인만 액션색 채움(Primary #1A56DB)");
  assert.ok(code.includes("border-red-500"), "반려는 위험색 외곽선");
  assert.ok(code.includes("border-slate-300"), "재제출은 중립 외곽선");
});

test("사유 프리셋 3종 + 직접 입력 · 버튼 아래 설명 문구 · 사유 필드명은 서버 액션이 읽는 이름", () => {
  assert.deepEqual([...MENTOR_DECISION_REASON_PRESETS], ["서류를 알아볼 수 없음", "정보가 일치하지 않음", "자격 미달"]);
  assert.equal(MENTOR_DECISION_CUSTOM_REASON_LABEL, "직접 입력");
  assert.equal(MENTOR_DECISION_DESCRIPTIONS.reject, "자격 미달 — 다시 지원할 수 없음");
  assert.equal(MENTOR_DECISION_DESCRIPTIONS.resubmit, "서류 문제 — 고쳐서 다시 낼 수 있음");
  const actions = read(ACTIONS);
  assert.ok(actions.includes(`formData.get("${MENTOR_DECISION_REASON_FIELD.reject}")`), "reject 액션이 rejectionReason 을 읽는다");
  assert.ok(actions.includes(`formData.get("${MENTOR_DECISION_REASON_FIELD.resubmit}")`), "resubmit 액션이 adminNote 를 읽는다");
});

test("서버 액션 DB 쓰기 불변: 승인·반려·재제출 패치는 verification_status 만 갱신하고 .in(pending) 조건 그대로 · 사유는 admin_action_logs.detail 에만", () => {
  const actions = stripComments(read(ACTIONS));
  assert.ok(actions.includes('return { [STATUS_COLUMN]: "approved" };'));
  assert.ok(actions.includes('return { [STATUS_COLUMN]: "rejected" };'));
  assert.ok(actions.includes('const patch: Record<string, unknown> = { [STATUS_COLUMN]: "under_review" };'));
  assert.ok(actions.includes(".in(statusCol, pendingList)"), "대기 조건 그대로");
  assert.ok(actions.includes("detail: { reason },"), "반려 사유 감사 로그");
  assert.ok(actions.includes("detail: { note: adminNote, reason: adminNote },"), "재제출 사유 감사 로그(reason 키 추가)");
  assert.ok(!/from\("mentor_school_verifications"\)|from\("identity_verifications"\)/.test(actions), "액션에 새 테이블 쓰기 없음");
  assert.deepEqual([...MENTOR_DECISION_ACTION_TYPES], ["mentor_approve", "mentor_reject", "mentor_request_documents"]);
});

// ── §11 단축키: 입력 포커스 중 A 는 무시 · A 는 모달만 ────────────────────────

test("단축키 정책: 입력 요소·contenteditable·조합키·다이얼로그 열림·IME 조합 중에는 전부 무시", () => {
  for (const tag of ["INPUT", "input", "TEXTAREA", "SELECT"]) {
    assert.equal(shouldIgnoreMentorApprovalShortcut({ tagName: tag }), true, tag);
  }
  assert.equal(shouldIgnoreMentorApprovalShortcut({ tagName: "DIV", isContentEditable: true }), true);
  assert.equal(shouldIgnoreMentorApprovalShortcut({ tagName: "BODY", hasModifier: true }), true);
  assert.equal(shouldIgnoreMentorApprovalShortcut({ tagName: "BODY", dialogOpen: true }), true);
  assert.equal(shouldIgnoreMentorApprovalShortcut({ tagName: "BODY", isComposing: true }), true);
  assert.equal(shouldIgnoreMentorApprovalShortcut({ tagName: "BODY" }), false);
  assert.equal(shouldIgnoreMentorApprovalShortcut({ tagName: "A" }), false);
});

test("키 매핑: J/K/N/F 이동·전체화면 · A/R/D 는 확인 모달만 여는 액션 · 그 외 키는 없음", () => {
  assert.equal(resolveMentorApprovalShortcut("j"), "next");
  assert.equal(resolveMentorApprovalShortcut("K"), "prev");
  assert.equal(resolveMentorApprovalShortcut("n"), "nextPending");
  assert.equal(resolveMentorApprovalShortcut("f"), "fullscreen");
  assert.equal(resolveMentorApprovalShortcut("a"), "openApprove");
  assert.equal(resolveMentorApprovalShortcut("r"), "openReject");
  assert.equal(resolveMentorApprovalShortcut("d"), "openResubmit");
  assert.equal(resolveMentorApprovalShortcut("Enter"), null);
  assert.equal(resolveMentorApprovalShortcut("x"), null);
  assert.deepEqual([...MENTOR_APPROVAL_DIALOG_ONLY_ACTIONS], ["openApprove", "openReject", "openResubmit"]);
  assert.equal(MENTOR_APPROVAL_SHORTCUTS.length, 7, "하단 표시 목록 7개");
});

test("단축키 배선: 핸들러 첫 줄에서 shouldIgnore 검사 · A/R/D 는 트리거 버튼 click(다이얼로그 열기)만 · requestSubmit/서버 액션 호출 없음 · 하단 항상 표시", () => {
  const src = read(SHORTCUTS);
  const code = stripComments(src);
  assert.ok(src.startsWith('"use client"'));
  const handlerStart = code.indexOf("const onKeyDown = (e: KeyboardEvent) => {");
  const ignoreCall = code.indexOf("shouldIgnoreMentorApprovalShortcut({", handlerStart);
  const resolveCall = code.indexOf("resolveMentorApprovalShortcut(e.key)", handlerStart);
  assert.ok(handlerStart >= 0 && ignoreCall > handlerStart && ignoreCall < resolveCall, "무시 검사가 키 해석보다 먼저(핸들러 첫 줄)");
  assert.ok(code.includes("document.getElementById(id)") && code.includes(".click()"), "A/R/D 는 버튼 click 으로 다이얼로그만 연다");
  assert.ok(!/requestSubmit|\w+Action\(|\bfetch\(/.test(code), "단축키가 직접 실행하지 않는다(prefetch 는 이동 준비일 뿐)");
  assert.ok(code.includes("MENTOR_DECISION_BUTTON_IDS.approve") && code.includes("MENTOR_DECISION_BUTTON_IDS.reject") && code.includes("MENTOR_DECISION_BUTTON_IDS.resubmit"));
  assert.ok(code.includes('role="dialog"][aria-modal="true"]'), "다이얼로그 열림 감지");
  assert.ok(code.includes("MENTOR_APPROVAL_SHORTCUTS.map("), "사용 가능한 단축키 하단 표시");
  assert.ok(/<footer\b[\s\S]*sticky bottom-0/.test(code), "화면 하단 고정 표시");
  const decision = stripComments(read(DECISION));
  for (const id of Object.values(MENTOR_DECISION_BUTTON_IDS)) {
    assert.ok(/mentor-approval-decision-(approve|reject|resubmit)/.test(id));
  }
  assert.ok(decision.includes("id={MENTOR_DECISION_BUTTON_IDS.approve}") && decision.includes("id={MENTOR_DECISION_BUTTON_IDS.reject}") && decision.includes("id={MENTOR_DECISION_BUTTON_IDS.resubmit}"), "click 대상 id 부착");
});

// ── §11 정원: RPC 결과 그대로(TS 계산 없음) · 이상 신호 ───────────────────────

test("정원은 DB RPC 결과를 그대로 표시한다 — 포맷만, 계산 없음", () => {
  assert.equal(formatCapValue(2.5), "2.5");
  assert.equal(formatCapValue(3), "3");
  assert.equal(formatCapValue(null), "—");
  assert.equal(formatCapValue(Number.NaN), "—");
  const panel = stripComments(read(PANEL));
  assert.ok(panel.includes("formatCapValue(cap.usedCap)") && panel.includes("formatCapValue(cap.capLimit)"), "RPC 값 그대로");
  assert.ok(!/capWeight|CAP_WEIGHT|usedCap\s*[+\-*/]|capLimit\s*[+\-*/]/.test(panel), "TS 로 정원을 계산하지 않는다");
  const q = stripComments(read(QUERIES));
  assert.ok(q.includes("loadMentorCapUsage(id)"), "정원은 PR-1b 서비스(DB RPC) 경유");
  assert.ok(!/mentor_cap_used|subscription_cap_weight/.test(q), "RPC 를 우회한 재계산 없음");
});

test("이상 신호: 같은 대학 당일 가입 5명 이상만 경고 · 그 외 신호는 없다", () => {
  assert.equal(sameSchoolTodayWarning(4), null);
  assert.equal(sameSchoolTodayWarning(5), "같은 학교에서 오늘 5명 지원");
  assert.equal(sameSchoolTodayWarning(null), null);
  const panel = stripComments(read(PANEL));
  assert.ok(!/\bIP\b|기기|\bdevice\b/.test(panel), "동일 IP·기기 신호는 데이터가 없어 넣지 않는다");
});

// ── 완료 기준 1·9: PageScaffold 미사용 · AdminPageLayout 사용 · 이미 처리됨 · 빈 상태 ──

test("화면 틀: PageScaffold 미사용 · AdminPageLayout 사용 · 3분할 프레임 · 로딩 스켈레톤 존재", () => {
  const page = stripComments(read(PAGE));
  assert.ok(!page.includes("PageScaffold"), "PageScaffold 미사용");
  assert.ok(page.includes("<AdminPageLayout"), "AdminPageLayout 사용");
  assert.ok(page.includes("<MentorApprovalWorkbenchFrame"), "3분할 프레임");
  assert.ok(page.includes("<MentorApprovalShortcuts"));
  assert.ok(!page.includes("AdminMentorApprovalWorkspace"), "구 워크스페이스 제거");
  const loading = read("app/(admin)/admin/(console)/mentor-approval/loading.tsx");
  assert.ok(loading.includes("animate-pulse"), "스켈레톤");
  const frame = stripComments(read("components/admin/MentorApprovalWorkbenchFrame.tsx"));
  assert.ok(frame.includes("300px_minmax(0,1fr)_380px"), "300 / 가변 / 380");
  assert.ok(frame.includes('"hidden xl:block"'), "1280px 미만에서 목록 접힘(뷰어는 가장 나중에 줄인다)");
});

test("상태·실패 처리: 이미 처리됨 배너({일시} {관리자} {결과}) · 대기 0건 빈 상태 + 처리 건수 · 처리 실패 문구", () => {
  const panel = stripComments(read(PANEL));
  assert.ok(panel.includes("이미 처리됨 —"), "이미 처리됨 배너");
  assert.ok(panel.includes("mentorDecisionResultLabel(detail.lastDecision.actionType)"), "결과 라벨");
  assert.ok(panel.includes("formatKoDateTimeKst(detail.lastDecision.createdAt)"), "일시");
  assert.ok(panel.includes('title="대기 건이 없습니다"'), "대기 0건 빈 상태");
  assert.ok(panel.includes("오늘 처리 ${decisionsToday}건"), "처리 건수");
  const decision = stripComments(read(DECISION));
  assert.ok(decision.includes("처리 실패 —"), "무엇이 실패했는지 + 다시 시도 안내");
  const page = stripComments(read(PAGE));
  assert.ok(page.includes("처리 실패 —"), "상단에도 실패 안내(조용히 실패 금지)");
});

test("UI 카피 금지어 없음(선생님·강사님·수강생·과외·alert)", () => {
  for (const rel of [PAGE, LIST, PANEL, DECISION, SHORTCUTS, VIEWER, "components/admin/MentorApprovalDocumentsPane.tsx", "components/admin/MentorApprovalWorkbenchFrame.tsx"]) {
    const code = stripComments(read(rel));
    for (const banned of ["선생님", "강사님", "수강생", "과외", "커패니티", "웰버십", "쌤버쉽", "alert("]) {
      assert.ok(!code.includes(banned), `${rel}: 금지 문구 ${banned}`);
    }
  }
});
