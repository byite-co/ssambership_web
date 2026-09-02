// 계약 테스트: 맞춤의뢰 주문 화면(PR-5 §3) — 이관 + 비활성 배너만. 컬럼 동의어 유지 · 정본 컬럼 미선택.
// 실행: node --test --experimental-strip-types lib/admin/__contract__/customRequestOrderConsole.contract.test.ts
//
// .tsx 는 node --test 로 import 할 수 없으므로(strip-types 는 JSX 미지원):
//   ① 순수 규칙(탭 9개 · 기본 탭 all · status 키 하나 · 링크 빌더 · 동의어 컬럼 순서 · 금액 표기 · 배너/빈 상태 원문)은 직접 검증한다
//   ② 렌더·배선 규칙은 소스 스캔 tripwire 로 고정한다(PageScaffold 미사용 · AdminPageLayout/AdminDataTable/AdminStatusPill ·
//      비활성 배너 렌더 · 검색 form 규칙 · 조치 버튼 없음 · service_role 우회 그대로 · 컬럼 리터럴을 페이지에 다시 쓰지 않음)

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseAdminListParams } from "../adminListParams.ts";
import { buildAdminDataTableUrl } from "../adminDataTable.ts";
import { adminStatusAllowedValues, resolveAdminStatus } from "../adminStatusDictionary.ts";
import {
  CUSTOM_REQUEST_ORDER_BASE_PATH,
  CUSTOM_REQUEST_ORDER_DEFAULT_PAGE_SIZE,
  CUSTOM_REQUEST_ORDER_DEFAULT_TAB,
  CUSTOM_REQUEST_ORDER_DISABLED_BANNER,
  CUSTOM_REQUEST_ORDER_EMPTY_STATE,
  CUSTOM_REQUEST_ORDER_ROW_KEYS,
  CUSTOM_REQUEST_ORDER_TABS,
  CUSTOM_REQUEST_ORDER_TAB_VALUES,
  buildCustomRequestOrderListUrl,
  customRequestOrderEmptyVariant,
  customRequestOrderMoney,
  customRequestOrderTabStatus,
  customRequestOrderText,
  resolveCustomRequestOrderTab,
} from "../customRequestOrderConsole.ts";

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const PAGE = "app/(admin)/admin/(console)/custom-request-orders/page.tsx";
const TOOLBAR = "components/admin/CustomRequestOrderQueueToolbar.tsx";
const CONSOLE = "lib/admin/customRequestOrderConsole.ts";

function spFrom(url: string): Record<string, string | string[] | undefined> {
  const u = new URL(url, "https://ssambership.local");
  const sp: Record<string, string | string[] | undefined> = {};
  for (const [k, v] of u.searchParams.entries()) sp[k] = v;
  return sp;
}

const OPTS = { defaultPageSize: CUSTOM_REQUEST_ORDER_DEFAULT_PAGE_SIZE, defaultStatus: CUSTOM_REQUEST_ORDER_DEFAULT_TAB };

test("탭은 이관 전 9개 그대로(전체·대기·작업 중·납품 대기·수정 요청·완료·분쟁·취소·환불), 기본 탭은 전체", () => {
  assert.deepEqual([...CUSTOM_REQUEST_ORDER_TAB_VALUES], ["all", "pending", "open", "delivered", "revision_requested", "completed", "disputed", "cancelled", "refunded"]);
  assert.deepEqual(CUSTOM_REQUEST_ORDER_TABS.map((t) => t.label), ["전체", "대기", "작업 중", "납품 대기", "수정 요청", "완료", "분쟁", "취소", "환불"]);
  assert.equal(CUSTOM_REQUEST_ORDER_DEFAULT_TAB, "all");
  assert.equal(resolveCustomRequestOrderTab("completed"), "completed");
  assert.equal(resolveCustomRequestOrderTab("bogus"), "all");
  assert.equal(customRequestOrderTabStatus("all"), null);
  assert.equal(customRequestOrderTabStatus("open"), "open");
  assert.ok(CUSTOM_REQUEST_ORDER_TABS.every((t) => t.label !== "작업전" && t.label !== "정산 대기"), "통일 문구(작업 중 · 정산 예정)");
});

test("쿼리 키는 status 하나 · 링크는 공용 정본 빌더와 동일 · 전체 탭도 재파싱하면 전체", () => {
  for (const u of ["", "?status=all", "?status=completed&page=2", "?q=x&status=disputed"]) {
    const p = parseAdminListParams(spFrom(`${CUSTOM_REQUEST_ORDER_BASE_PATH}${u}`), OPTS);
    for (const o of [{}, { status: "all" }, { status: "open" }, { page: 2 }, { search: "김" }]) {
      const url = buildCustomRequestOrderListUrl(p, o);
      assert.equal(url, buildAdminDataTableUrl(CUSTOM_REQUEST_ORDER_BASE_PATH, p, o), `${u} ${JSON.stringify(o)}`);
      const back = parseAdminListParams(spFrom(url), OPTS);
      assert.equal(resolveCustomRequestOrderTab(back.status), resolveCustomRequestOrderTab(o.status ?? p.status), `재파싱 ${url}`);
    }
  }
  const p = parseAdminListParams(spFrom(`${CUSTOM_REQUEST_ORDER_BASE_PATH}?filter=open`), OPTS);
  assert.equal(resolveCustomRequestOrderTab(p.status), "all", "다른 키는 탭을 바꾸지 못한다");
});

test("컬럼 동의어는 이관 전 화면의 키 목록·순서 그대로 — 정본 컬럼을 새로 고르지 않는다(데이터 정본 §8-3 별도 정리)", () => {
  assert.deepEqual([...CUSTOM_REQUEST_ORDER_ROW_KEYS.postId], ["post_id", "custom_request_post_id"]);
  assert.deepEqual([...CUSTOM_REQUEST_ORDER_ROW_KEYS.studentId], ["student_id", "buyer_id", "client_id", "user_id"]);
  assert.deepEqual([...CUSTOM_REQUEST_ORDER_ROW_KEYS.mentorId], ["mentor_id", "selected_mentor_id", "assigned_mentor_id"]);
  assert.deepEqual([...CUSTOM_REQUEST_ORDER_ROW_KEYS.status], ["status", "state", "order_status"]);
  assert.deepEqual([...CUSTOM_REQUEST_ORDER_ROW_KEYS.amount], ["agreed_price", "price", "amount", "total_amount"]);
  assert.equal(customRequestOrderText({ buyer_id: "b", user_id: "u" }, CUSTOM_REQUEST_ORDER_ROW_KEYS.studentId, ""), "b", "첫 매치 우선(순서)");
  assert.equal(customRequestOrderText({ student_id: "  ", client_id: "c" }, CUSTOM_REQUEST_ORDER_ROW_KEYS.studentId, ""), "c", "빈 문자열은 건너뛴다");
  assert.equal(customRequestOrderText({ amount: 12 }, ["amount"]), "12", "숫자는 문자열화");
  assert.equal(customRequestOrderText({}, ["x"]), "—");
  assert.equal(customRequestOrderMoney({ agreed_price: 84900 }), "84,900원");
  assert.equal(customRequestOrderMoney({ price: "1234.6" }), "1,235원");
  assert.equal(customRequestOrderMoney({ agreed_price: null, amount: 5 }), "5원", "null 은 ?? 처럼 건너뛴다");
  assert.equal(customRequestOrderMoney({ agreed_price: "abc" }), "—", "첫 non-null 값이 숫자가 아니면 — (이관 전 동작)");
  assert.equal(customRequestOrderMoney({}), "—");
});

test("상태 사전 대조: custom_request_orders.status 는 CHECK 가 없어 코드 사용값 8종만 등재(PR-5 후속) — 탭 값·라벨과 1:1", () => {
  const sorted = (xs: readonly string[]) => [...xs].sort();
  assert.deepEqual(sorted(adminStatusAllowedValues("custom_request_orders", "status")), sorted(CUSTOM_REQUEST_ORDER_TAB_VALUES.filter((t) => t !== "all")));
  for (const t of CUSTOM_REQUEST_ORDER_TABS) {
    if (t.value === "all") continue;
    const r = resolveAdminStatus("custom_request_orders", "status", t.value);
    assert.equal(r.known, true, t.value);
    assert.equal(r.label, t.label, `${t.value}: 탭 라벨 = 사전 라벨`);
  }
  assert.equal(resolveAdminStatus("custom_request_orders", "status", "canceled").known, false, "레거시 동의어는 미등재 → neutral");
});

test("비활성 배너 원문 · 빈 상태 문구 · 변형", () => {
  assert.equal(CUSTOM_REQUEST_ORDER_DISABLED_BANNER, "맞춤의뢰는 현재 비활성 상태입니다. 기능이 열리면 이 화면으로 주문이 들어옵니다.");
  assert.equal(CUSTOM_REQUEST_ORDER_EMPTY_STATE.title, "아직 들어온 맞춤의뢰 주문이 없습니다");
  assert.ok(CUSTOM_REQUEST_ORDER_EMPTY_STATE.description.includes("지금은 비어 있는 것이 정상입니다"));
  assert.equal(customRequestOrderEmptyVariant("", 0), "first");
  assert.equal(customRequestOrderEmptyVariant("", 4), "tab");
  assert.equal(customRequestOrderEmptyVariant("q", 0), "search");
});

// ── tripwire ────────────────────────────────────────────────────────────────

test("페이지: PageScaffold 미사용 · AdminPageLayout · 비활성 배너 상시 렌더 · 툴바 + Pagination · AdminStatusPill · 빈 상태 · 조치 버튼 없음 · service_role 우회 그대로 · 컬럼 키는 상수 경유", () => {
  const page = stripComments(read(PAGE));
  assert.ok(!page.includes("PageScaffold") && !page.includes("AdminListToolbar") && !page.includes("AdminListPagination"));
  assert.ok(page.includes("<AdminPageLayout"));
  assert.ok(page.includes("{CUSTOM_REQUEST_ORDER_DISABLED_BANNER}") && page.includes("data-custom-request-order-disabled") && /role="status"[^>]*\n?[^<]*<\/p>|<p role="status"/.test(page), "배너 상시(조건 없음)");
  assert.ok(!/\{[^}]*\? \(\s*<p role="status"/.test(page), "배너는 조건부 렌더가 아니다");
  assert.ok(page.includes("<CustomRequestOrderQueueToolbar") && page.includes("<AdminDataTable.Pagination"));
  assert.ok(page.includes('<AdminStatusPill table="custom_request_orders" column="status"'));
  assert.ok(page.includes("CUSTOM_REQUEST_ORDER_EMPTY_STATE.title") && page.includes("<EmptyState"), "빈 상태");
  assert.ok(!page.includes("ConfirmSubmitButton") && !/<form\b/.test(page), "읽기 전용 — 조치 버튼·폼 없음");
  assert.ok(page.includes("db = createServiceRoleClient();"), "service_role 우회 그대로(RLS 정책 추가는 DB 작업)");
  assert.ok(page.includes("<AdminTableCard title=\"주문 목록\">") && !page.includes("count={"), "표 래퍼는 유지하되 건수 칩은 Counts 로");
  for (const literal of ['"buyer_id"', '"client_id"', '"selected_mentor_id"', '"assigned_mentor_id"', '"order_status"', '"total_amount"']) {
    assert.ok(!page.includes(literal), `${literal}: 동의어 리터럴은 상수(CUSTOM_REQUEST_ORDER_ROW_KEYS)에만`);
  }
  assert.ok(page.includes("CUSTOM_REQUEST_ORDER_ROW_KEYS.studentId") && page.includes("CUSTOM_REQUEST_ORDER_ROW_KEYS.mentorId") && page.includes("CUSTOM_REQUEST_ORDER_ROW_KEYS.status"));
  assert.ok(page.includes("parseAdminListParams(sp, { defaultPageSize: CUSTOM_REQUEST_ORDER_DEFAULT_PAGE_SIZE, defaultStatus: CUSTOM_REQUEST_ORDER_DEFAULT_TAB })"));
});

test("툴바: Server Component · Counts/Tabs · 검색 form(q) 은 기본 탭(all)이 아닐 때만 hidden status", () => {
  const src = stripComments(read(TOOLBAR));
  assert.ok(!src.startsWith('"use client"'));
  assert.ok(src.includes("<AdminDataTable.Counts counts={counts} />") && src.includes("<AdminDataTable.Tabs"));
  assert.ok(!src.includes('aria-label="상태 탭"') && !src.includes("← 이전"));
  assert.ok(src.includes('{tab !== CUSTOM_REQUEST_ORDER_DEFAULT_TAB ? <input type="hidden" name="status" value={tab} /> : null}'));
  const pure = stripComments(read(CONSOLE));
  assert.ok(!/from "react"|from "@\//.test(pure), "순수 모듈은 React·@/ import 없음");
});

test("UI 카피 금지어 없음(선생님·강사님·수강생·과외·alert)", () => {
  for (const rel of [PAGE, TOOLBAR, CONSOLE]) {
    const code = stripComments(read(rel));
    for (const banned of ["선생님", "강사님", "수강생", "과외", "커패니티", "웰버십", "쌤버쉽", "alert(", "작업전", "정산 대기"]) {
      assert.ok(!code.includes(banned), `${rel}: 금지 문구 ${banned}`);
    }
  }
});
