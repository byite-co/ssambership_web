// 계약 테스트: AdminDataTable — 멘토 승인(PR-2)·환불(PR-3) 목록의 공통 부품 추출(PR-4).
// 실행: node --test --experimental-strip-types lib/admin/__contract__/adminDataTable.contract.test.ts
//
// .tsx 는 node --test 로 import 할 수 없으므로(strip-types 는 JSX 미지원):
//   ① 순수 규칙(대기 우선 range 분할 · 진행 표시 구간 · status=all 유지 링크 · 검색어 정규화 · users or())은 직접 검증한다
//   ② 두 화면 모듈이 자기 이름으로 **같은 구현**에 위임함을 검증한다(동일 입력 → 동일 출력, 함수 동일성)
//   ③ 렌더·배선 규칙은 소스 스캔 tripwire 로 고정한다(Server Component · 선택 prop 없음 · 두 화면만 import ·
//      두 화면에 탭/페이지네이션 자체 마크업이 남아 있지 않음 · 환불 조회가 멘토 승인 모듈에 의존하지 않음)

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildAdminListUrl, parseAdminListParams } from "../adminListParams.ts";
import {
  ADMIN_LIST_SEARCH_TERM_MAX_LENGTH,
  ADMIN_LIST_SEARCH_USER_ID_LIMIT,
  adminListProgressRange,
  buildAdminDataTableUrl,
  buildAdminUsersSearchOr,
  normalizeAdminListSearchTerm,
  splitPendingFirstRange,
} from "../adminDataTable.ts";
import {
  MENTOR_APPROVAL_BASE_PATH,
  MENTOR_APPROVAL_DEFAULT_TAB,
  MENTOR_SEARCH_TERM_MAX_LENGTH,
  MENTOR_SEARCH_USER_ID_LIMIT,
  buildMentorApprovalListUrl,
  buildMentorUserSearchOr,
  normalizeMentorSearchTerm,
  queueProgressRange,
  splitPendingFirstRange as mentorSplitPendingFirstRange,
} from "../mentorApprovalQueue.ts";
import {
  REFUND_BASE_PATH,
  REFUND_DEFAULT_TAB,
  REFUND_SEARCH_TERM_MAX_LENGTH,
  REFUND_SEARCH_USER_ID_LIMIT,
  buildRefundListUrl,
  buildRefundUserSearchOr,
  normalizeRefundSearchTerm,
  refundQueueProgressRange,
} from "../refundConsole.ts";

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const COMPONENT = "components/admin/AdminDataTable.tsx";
const PURE = "lib/admin/adminDataTable.ts";
const MENTOR_LIST = "components/admin/MentorApprovalQueueList.tsx";
const REFUND_TOOLBAR = "components/admin/RefundQueueToolbar.tsx";
const REFUND_PAGINATION = "components/admin/RefundQueuePagination.tsx";

// PR-5 세 화면 — 콘텐츠 검수 목록 · 학적 변경 목록 · 맞춤의뢰 주문 툴바(+페이지 본문의 Pagination)
const REPORT_LIST = "components/admin/ContentReportQueueList.tsx";
const ACADEMIC_LIST = "components/admin/AcademicRecordChangeQueueList.tsx";
const ORDER_TOOLBAR = "components/admin/CustomRequestOrderQueueToolbar.tsx";
const ORDER_PAGE = "app/(admin)/admin/(console)/custom-request-orders/page.tsx";
// PR-6 분쟁 목록(Tabs·Pagination — Counts 는 pending 키 전용이라 미사용, 건수 줄은 화면이 직접 그린다)
const DISPUTE_LIST = "components/admin/DisputeQueueList.tsx";

/** 이 부품을 쓰는 화면 — 새 화면을 이관할 때 이 목록을 갱신한다(PR-2 멘토 승인 · PR-3 환불 · PR-5 세 화면 · PR-6 분쟁 목록). */
const ADMIN_DATA_TABLE_IMPORTERS = [MENTOR_LIST, REFUND_PAGINATION, REFUND_TOOLBAR, REPORT_LIST, ACADEMIC_LIST, ORDER_TOOLBAR, ORDER_PAGE, DISPUTE_LIST,
  // PR-7 계정 목록(페이지네이션 조각만 — 역할 탭은 status 키가 아니라 화면이 직접 그린다)
  "components/admin/AccountListTable.tsx",
];

function spFrom(url: string): Record<string, string | string[] | undefined> {
  const u = new URL(url, "https://ssambership.local");
  const sp: Record<string, string | string[] | undefined> = {};
  for (const [k, v] of u.searchParams.entries()) sp[k] = v;
  return sp;
}

function walk(dir: string, out: string[]) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

// ── ① 순수 규칙 ──────────────────────────────────────────────────────────────

test("splitPendingFirstRange(정본): 대기 부분과 나머지 부분을 두 range 로 정확히 쪼갠다", () => {
  assert.deepEqual(splitPendingFirstRange(1, 0, 24), { pending: { from: 0, to: 0 }, rest: { from: 0, to: 23 } });
  assert.deepEqual(splitPendingFirstRange(0, 0, 24), { pending: null, rest: { from: 0, to: 24 } });
  assert.deepEqual(splitPendingFirstRange(30, 0, 24), { pending: { from: 0, to: 24 }, rest: null });
  assert.deepEqual(splitPendingFirstRange(30, 25, 49), { pending: { from: 25, to: 29 }, rest: { from: 0, to: 19 } });
  assert.deepEqual(splitPendingFirstRange(30, 50, 74), { pending: null, rest: { from: 20, to: 44 } });
  assert.deepEqual(splitPendingFirstRange(-3, -1, 4), { pending: null, rest: { from: 0, to: 4 } }, "음수는 0 으로 클램프");
});

test("adminListProgressRange: 1-based 구간, 행이 없으면 0–0", () => {
  assert.deepEqual(adminListProgressRange(1, 25, 25, 74), { first: 1, last: 25 });
  assert.deepEqual(adminListProgressRange(3, 25, 24, 74), { first: 51, last: 74 });
  assert.deepEqual(adminListProgressRange(2, 25, 10, 35), { first: 26, last: 35 });
  assert.deepEqual(adminListProgressRange(1, 25, 0, 0), { first: 0, last: 0 });
  assert.deepEqual(adminListProgressRange(0, 0, 3, 3), { first: 1, last: 3 }, "page/pageSize 0 은 1 로 클램프");
});

test("buildAdminDataTableUrl: 공용 빌더가 지우는 status=all 을 되살리고, 그 외는 공용 규칙 그대로", () => {
  const base = "/admin/x";
  const opts = { defaultStatus: "pending" };
  const params = parseAdminListParams(spFrom(`${base}?status=all&q=%EC%84%9C&page=2`), opts);
  const shared = buildAdminListUrl(base, params, {});
  assert.ok(!shared.includes("status="), shared);
  const ours = buildAdminDataTableUrl(base, params, {});
  assert.ok(ours.includes("status=all") && ours.includes("q=") && ours.includes("page=2"), ours);
  assert.equal(parseAdminListParams(spFrom(ours), opts).status, "all", "재파싱하면 전체 탭");
  assert.ok(buildAdminDataTableUrl(base, params, { page: 3 }).includes("status=all"), "페이지 이동");
  assert.ok(buildAdminDataTableUrl(base, params, { search: "" }).includes("status=all"), "검색 초기화");
  const pending = buildAdminDataTableUrl(base, params, { status: "pending" });
  assert.equal(pending, buildAdminListUrl(base, params, { status: "pending" }), "all 이 아니면 공용 빌더 결과 그대로");
  assert.ok(pending.includes("status=pending") && !pending.includes("page="), "필터 변경 시 page 리셋(공용 규칙)");
  const extra = parseAdminListParams(spFrom(`${base}?type=shortforms&status=all`), opts);
  const withExtra = buildAdminDataTableUrl(base, extra, { page: 2 });
  assert.ok(withExtra.includes("type=shortforms") && withExtra.includes("status=all"), "extra 보존(공용 규칙)");
  const plain = parseAdminListParams(spFrom(base), opts);
  assert.equal(buildAdminDataTableUrl(base, plain, {}), buildAdminListUrl(base, plain, {}), "기본 탭(대기)은 공용 빌더 결과 그대로");
  assert.equal(buildAdminDataTableUrl(base, plain, {}), `${base}?status=pending`);
});

test("검색어 정규화·users or() — PostgREST 패턴·구분자 제거, 상한 80, 이름·닉네임·이메일", () => {
  assert.equal(normalizeAdminListSearchTerm("  김%서_연, (x) "), "김 서 연 x");
  assert.equal(normalizeAdminListSearchTerm(null), "");
  assert.equal(normalizeAdminListSearchTerm(undefined), "");
  assert.equal(normalizeAdminListSearchTerm("a".repeat(200)).length, ADMIN_LIST_SEARCH_TERM_MAX_LENGTH);
  assert.equal(ADMIN_LIST_SEARCH_TERM_MAX_LENGTH, 80);
  assert.equal(ADMIN_LIST_SEARCH_USER_ID_LIMIT, 100);
  assert.equal(buildAdminUsersSearchOr("서연"), "full_name.ilike.%서연%,nickname.ilike.%서연%,email.ilike.%서연%");
});

// ── ② 두 화면 모듈은 같은 구현에 위임한다 ───────────────────────────────────

test("멘토 승인·환불 모듈의 화면 이름은 공용 정본과 같은 함수·상수다(재수출)", () => {
  assert.equal(mentorSplitPendingFirstRange, splitPendingFirstRange);
  assert.equal(queueProgressRange, adminListProgressRange);
  assert.equal(refundQueueProgressRange, adminListProgressRange);
  assert.equal(normalizeMentorSearchTerm, normalizeAdminListSearchTerm);
  assert.equal(normalizeRefundSearchTerm, normalizeAdminListSearchTerm);
  assert.equal(buildMentorUserSearchOr, buildAdminUsersSearchOr);
  assert.equal(buildRefundUserSearchOr, buildAdminUsersSearchOr);
  assert.equal(MENTOR_SEARCH_TERM_MAX_LENGTH, ADMIN_LIST_SEARCH_TERM_MAX_LENGTH);
  assert.equal(REFUND_SEARCH_TERM_MAX_LENGTH, ADMIN_LIST_SEARCH_TERM_MAX_LENGTH);
  assert.equal(MENTOR_SEARCH_USER_ID_LIMIT, ADMIN_LIST_SEARCH_USER_ID_LIMIT);
  assert.equal(REFUND_SEARCH_USER_ID_LIMIT, ADMIN_LIST_SEARCH_USER_ID_LIMIT);
});

test("화면별 링크 빌더는 공용 빌더에 자기 경로를 묶은 것과 동일한 URL 을 만든다(동등성 매트릭스)", () => {
  const urls = ["", "?status=all", "?status=all&q=%EC%84%9C&page=2", "?status=approved&page=3", "?q=x&mentor=abc", "?status=succeeded&type=t&sort=s", "?pageSize=10&page=2&status=all"];
  const overrides = [{}, { status: "all" }, { status: "pending" }, { page: 2 }, { search: "" }, { search: "김" }, { page: 1, extra: { mentor: "xyz" } }] as const;
  for (const u of urls) {
    const mp = parseAdminListParams(spFrom(`${MENTOR_APPROVAL_BASE_PATH}${u}`), { defaultStatus: MENTOR_APPROVAL_DEFAULT_TAB });
    const rp = parseAdminListParams(spFrom(`${REFUND_BASE_PATH}${u}`), { defaultStatus: REFUND_DEFAULT_TAB });
    for (const o of overrides) {
      assert.equal(buildMentorApprovalListUrl(mp, o), buildAdminDataTableUrl(MENTOR_APPROVAL_BASE_PATH, mp, o), `mentor ${u} ${JSON.stringify(o)}`);
      assert.equal(buildRefundListUrl(rp, o), buildAdminDataTableUrl(REFUND_BASE_PATH, rp, o), `refund ${u} ${JSON.stringify(o)}`);
    }
  }
});

// ── ③ 렌더·배선 tripwire ─────────────────────────────────────────────────────

test("AdminDataTable 은 Server Component 이고 Counts · Tabs · Pagination 셋만 내보낸다 — 선택 prop(?:) 없음", () => {
  const src = read(COMPONENT);
  const code = stripComments(src);
  assert.ok(!src.startsWith('"use client"'), "Server Component");
  assert.ok(!/useState|useEffect|useMemo|useSearchParams|useRouter/.test(code), "클라이언트 훅 없음");
  assert.ok(code.includes("export const AdminDataTable = { Counts, Tabs, Pagination };"), "내보내기는 셋");
  assert.equal((code.match(/^export\s/gm) ?? []).length, 1, "다른 export 없음");
  // props 계약: 두 화면이 지금 넘기는 것만 — 한 화면만 쓰는 선택 옵션을 두지 않는다
  for (const block of ["type CountsProps = {", "type TabsProps<V extends string> = {", "type PaginationProps = {"]) {
    const start = code.indexOf(block);
    assert.ok(start >= 0, block);
    const body = code.slice(start, code.indexOf("};", start));
    assert.ok(!/\?:/.test(body), `${block} 선택 prop 금지`);
  }
  assert.ok(code.includes("counts: { pending: number; all: number };"), "Counts: counts(pending·all)");
  assert.ok(code.includes("basePath: string;") && code.includes("params: AdminListParams;"), "Tabs/Pagination: basePath · params");
  assert.ok(code.includes("tabs: readonly AdminDataTableTab<V>[];") && code.includes("activeTab: V;") && code.includes("counts: Readonly<Record<V, number>>;"), "Tabs props");
  assert.ok(code.includes("totalCount: number;") && code.includes("rowsOnPage: number;") && code.includes("className: string;"), "Pagination props");
  assert.ok(!/columns|rows:|selectable|onSelectionChange|emptyState|rowHref|sort/.test(code), "미사용 일반화 prop 없음(컬럼·선택·정렬·빈 상태·행 링크는 화면 소유)");
  // 링크는 status=all 을 유지하는 정본 빌더로만 만든다 — 공용 빌더를 직접 부르지 않는다
  assert.ok(code.includes("buildAdminDataTableUrl(basePath, params, { status: t.value })"), "탭 링크");
  assert.ok(code.includes("buildAdminDataTableUrl(basePath, params, { page: params.page - 1 })") && code.includes("buildAdminDataTableUrl(basePath, params, { page: params.page + 1 })"), "이전·다음 링크");
  assert.ok(!code.includes("buildAdminListUrl("), "공용 빌더 직접 호출 없음");
  assert.ok(code.includes('aria-label="상태 탭"') && code.includes("← 이전") && code.includes("다음 →") && code.includes("/ 전체"), "탭·페이지네이션·건수 마크업");
  assert.ok(code.includes('toLocaleString("ko-KR")'), "전체 건수 천 단위 구분(PR-3 표기 정본)");
  const pure = stripComments(read(PURE));
  assert.ok(!/from "react"|from "@\//.test(pure), "순수 모듈은 React·@/ import 없음(node --test 직접 import)");
});

test("이관 범위: AdminDataTable 을 import 하는 관리자 파일은 멘토 승인 목록·환불 툴바·환불 페이지네이션 + PR-5 세 화면(신고 목록·학적 변경 목록·맞춤의뢰 툴바·페이지) + PR-6 분쟁 목록 + PR-7 계정 목록뿐이다", () => {
  const files = [...walk(join(ROOT, "app", "(admin)"), []), ...walk(join(ROOT, "components", "admin"), [])];
  const importers = files
    .filter((f) => !/components\/admin\/AdminDataTable\.tsx$/.test(f))
    .filter((f) => /components\/admin\/AdminDataTable"/.test(readFileSync(f, "utf8")))
    .map((f) => f.slice(ROOT.length).replace(/\\/g, "/"))
    .sort();
  assert.deepEqual(importers, [...ADMIN_DATA_TABLE_IMPORTERS].sort());
});

test("두 화면에서 공통 부분은 사라지고 고유 부분(검색 form · 행 · 빈 상태)만 남았다", () => {
  const list = stripComments(read(MENTOR_LIST));
  const toolbar = stripComments(read(REFUND_TOOLBAR));
  const pagination = stripComments(read(REFUND_PAGINATION));
  for (const [rel, src] of [
    [MENTOR_LIST, list],
    [REFUND_TOOLBAR, toolbar],
    [REFUND_PAGINATION, pagination],
  ] as const) {
    assert.ok(!src.includes('aria-label="상태 탭"'), `${rel}: 탭 마크업은 공용 부품에만`);
    assert.ok(!src.includes("← 이전") && !src.includes("다음 →"), `${rel}: 페이지네이션 마크업은 공용 부품에만`);
    assert.ok(!src.includes("/ 전체{"), `${rel}: 건수 줄은 공용 부품에만`);
    assert.ok(!src.startsWith('"use client"'), `${rel}: Server Component 유지`);
  }
  assert.ok(list.includes("<AdminDataTable.Counts counts={counts} />") && list.includes("<AdminDataTable.Tabs") && list.includes("<AdminDataTable.Pagination"), "멘토 승인: 셋 다 사용");
  assert.ok(list.includes('className="border-t border-slate-100 px-3 py-2"'), "멘토 승인: 카드 하단 배치(기존 클래스 그대로)");
  assert.ok(toolbar.includes("<AdminDataTable.Counts counts={counts} />") && toolbar.includes("<AdminDataTable.Tabs"), "환불 툴바: 건수·탭 사용");
  assert.ok(pagination.includes("<AdminDataTable.Pagination") && pagination.includes('className="rounded-2xl border border-slate-200 bg-white px-4 py-2"'), "환불: 독립 카드 배치(기존 클래스 그대로)");
  // 화면 고유 — 검색 form(배치·크기가 다르고 트립와이어가 파일을 고정) · 행 · 빈 상태는 그대로 화면에 있다
  assert.ok(list.includes('name="q"') && list.includes('placeholder="이름 · 이메일 · 대학"') && list.includes("<EmptyState") && list.includes("data-mentor-row"), "멘토 승인 고유 부분 유지");
  assert.ok(toolbar.includes('name="q"') && toolbar.includes('placeholder="요청자 이름 · 이메일"'), "환불 고유 부분 유지");
});

test("검색 form 은 모든 이관 화면에서 같은 규칙 — hidden status 는 기본 탭이 아닐 때만(검색해도 현재 탭 유지) · PR-5 세 화면 · PR-6 분쟁 목록 등록", () => {
  const list = stripComments(read(MENTOR_LIST));
  const toolbar = stripComments(read(REFUND_TOOLBAR));
  assert.ok(list.includes('{tab !== MENTOR_APPROVAL_DEFAULT_TAB ? <input type="hidden" name="status" value={tab} /> : null}'), "멘토 승인: 기본 탭 상수 기준");
  assert.ok(toolbar.includes('{tab !== REFUND_DEFAULT_TAB ? <input type="hidden" name="status" value={tab} /> : null}'), "환불: 기본 탭 상수 기준");
  // PR-5 — 기본 탭 상수 이름만 다르고 규칙은 같다(맞춤의뢰 주문은 기본 탭이 all 이라 all 에서 hidden 이 없고 그 외 탭에서 실린다)
  const reportList = stripComments(read(REPORT_LIST));
  const academicList = stripComments(read(ACADEMIC_LIST));
  const orderToolbar = stripComments(read(ORDER_TOOLBAR));
  assert.ok(reportList.includes('{tab !== CONTENT_REPORT_DEFAULT_TAB ? <input type="hidden" name="status" value={tab} /> : null}'), "콘텐츠 검수: 기본 탭 상수 기준");
  assert.ok(academicList.includes('{tab !== ACADEMIC_RECORD_CHANGE_DEFAULT_TAB ? <input type="hidden" name="status" value={tab} /> : null}'), "학적 변경: 기본 탭 상수 기준");
  assert.ok(orderToolbar.includes('{tab !== CUSTOM_REQUEST_ORDER_DEFAULT_TAB ? <input type="hidden" name="status" value={tab} /> : null}'), "맞춤의뢰 주문: 기본 탭 상수 기준");
  // PR-6 — 분쟁 목록(기본 탭 open)
  const disputeList = stripComments(read(DISPUTE_LIST));
  assert.ok(disputeList.includes('{tab !== DISPUTE_DEFAULT_TAB ? <input type="hidden" name="status" value={tab} /> : null}'), "분쟁: 기본 탭 상수 기준");
  for (const [rel, src] of [
    [MENTOR_LIST, list],
    [REFUND_TOOLBAR, toolbar],
    [REPORT_LIST, reportList],
    [ACADEMIC_LIST, academicList],
    [ORDER_TOOLBAR, orderToolbar],
    [DISPUTE_LIST, disputeList],
  ] as const) {
    assert.ok(!/tab !== "(all|pending)"/.test(src), `${rel}: 탭 리터럴 비교 없음(기본 탭이 바뀌어도 form 이 따라간다)`);
    assert.ok(src.includes('name="q"') && src.includes('role="search"'), `${rel}: 검색 form(q) 존재`);
  }
});

test("환불 조회 모듈은 멘토 승인 모듈이 아니라 공용 정본에서 range 분할을 가져온다(화면 간 의존 제거)", () => {
  const refundQueries = stripComments(read("lib/admin/refundConsoleQueries.ts"));
  assert.ok(refundQueries.includes('import { splitPendingFirstRange } from "@/lib/admin/adminDataTable";'));
  assert.ok(!refundQueries.includes("mentorApprovalQueue"), "환불 → 멘토 승인 모듈 import 없음");
  const mentorQueries = stripComments(read("lib/admin/mentorApprovalWorkbenchQueries.ts"));
  assert.ok(mentorQueries.includes('import { splitPendingFirstRange } from "@/lib/admin/adminDataTable";'));
  const pure = stripComments(read(PURE));
  assert.ok(!/import .* from "\.\/(mentorApproval|refund)/.test(pure), "공용 정본은 화면 모듈을 import 하지 않는다");
});

test("레거시 표 래퍼는 AdminTableCard 로 개명만 했고 맞춤의뢰 주문 화면만 쓴다(렌더 불변)", () => {
  const card = read("components/admin/AdminTableCard.tsx");
  assert.ok(card.includes("export function AdminTableCard(props: Props)"));
  assert.ok(card.includes("rounded-2xl border border-slate-200 bg-white shadow-sm") && card.includes("{props.count}건"), "래퍼 마크업 그대로");
  const files = [...walk(join(ROOT, "app", "(admin)"), []), ...walk(join(ROOT, "components", "admin"), [])];
  const users = files
    .filter((f) => !/components\/admin\/AdminTableCard\.tsx$/.test(f))
    .filter((f) => /components\/admin\/AdminTableCard"/.test(readFileSync(f, "utf8")))
    .map((f) => f.slice(ROOT.length).replace(/\\/g, "/"));
  assert.deepEqual(users, ["app/(admin)/admin/(console)/custom-request-orders/page.tsx"]);
});

test("UI 카피 금지어 없음(선생님·강사님·수강생·과외·alert)", () => {
  for (const rel of [COMPONENT, PURE]) {
    const code = stripComments(read(rel));
    for (const banned of ["선생님", "강사님", "수강생", "과외", "커패니티", "웰버십", "쌤버쉽", "alert("]) {
      assert.ok(!code.includes(banned), `${rel}: 금지 문구 ${banned}`);
    }
  }
});
