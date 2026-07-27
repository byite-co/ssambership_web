// 회귀 테스트(§3-3): 관리자 콘텐츠 필터 status 상태 유지 — URL 직접 진입·새로고침·뒤로가기.
// 3-3 은 CODE_COMPLETE 항목이라 재구현하지 않는다. 이 테스트는 현재 동작을 고정만 한다.
//
// 필터는 전적으로 URL searchParams 기반이고 페이지는 Server Component 이므로,
// "새로고침"·"뒤로가기"는 결국 같은 searchParams 로 다시 파싱되는 것과 동치다.
// 따라서 parse(URL) 왕복이 안정적이면 세 시나리오 모두 상태가 유지된다.
//
// 실행: node --test --experimental-strip-types lib/admin/__contract__/adminListStatusFilter.contract.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import {
  buildAdminListUrl,
  isStatusActive,
  parseAdminListParams,
} from "../adminListParams.ts";

const BASE = "/admin/community-content";
// community-content 페이지가 쓰는 옵션 그대로(app/(admin)/admin/(console)/community-content/page.tsx:65)
const OPTS = { defaultPageSize: 25, defaultStatus: "all" } as const;

/** URL 문자열 → 서버 컴포넌트가 받는 searchParams 형태로 변환(브라우저 진입 재현) */
function searchParamsFromUrl(url: string): Record<string, string | string[] | undefined> {
  const u = new URL(url, "https://ssambership.local");
  const sp: Record<string, string | string[] | undefined> = {};
  for (const [k, v] of u.searchParams.entries()) sp[k] = v;
  return sp;
}

test("URL 직접 진입: ?status=hidden 은 hidden 으로 파싱되고 필터가 활성이다", () => {
  const params = parseAdminListParams(searchParamsFromUrl(`${BASE}?status=hidden`), OPTS);
  assert.equal(params.status, "hidden");
  assert.equal(isStatusActive(params.status), true);
});

test("status 미지정 진입은 기본값 all — 전체 조회(필터 비활성)", () => {
  const params = parseAdminListParams(searchParamsFromUrl(BASE), OPTS);
  assert.equal(params.status, "all");
  assert.equal(isStatusActive(params.status), false);
});

test("명시적 ?status=all 과 status 생략은 동일 상태로 수렴한다", () => {
  const explicit = parseAdminListParams(searchParamsFromUrl(`${BASE}?status=all`), OPTS);
  const implicit = parseAdminListParams(searchParamsFromUrl(BASE), OPTS);
  assert.deepEqual(explicit, implicit);
  assert.equal(isStatusActive(explicit.status), false);
});

test("새로고침 동치: 같은 URL 을 다시 파싱해도 동일 params (멱등)", () => {
  for (const url of [
    BASE,
    `${BASE}?status=all`,
    `${BASE}?status=hidden`,
    `${BASE}?status=hidden&page=3`,
    `${BASE}?q=%EC%8A%A4%ED%8C%B8&status=published&pageSize=50`,
  ]) {
    const a = parseAdminListParams(searchParamsFromUrl(url), OPTS);
    const b = parseAdminListParams(searchParamsFromUrl(url), OPTS);
    assert.deepEqual(a, b, url);
  }
});

test("뒤로가기 동치: parse → buildUrl → parse 왕복이 status 를 보존한다", () => {
  for (const status of ["all", "published", "hidden", "draft", "visible"]) {
    const entered = parseAdminListParams(searchParamsFromUrl(`${BASE}?status=${status}`), OPTS);
    const rebuilt = buildAdminListUrl(BASE, entered);
    const reparsed = parseAdminListParams(searchParamsFromUrl(rebuilt), OPTS);
    assert.equal(reparsed.status, status, `status=${status} 왕복 실패 (${rebuilt})`);
    assert.equal(isStatusActive(reparsed.status), status !== "all", `status=${status} 활성 판정`);
  }
});

test("status=all 은 URL 에서 생략 정규화되지만 파싱 결과는 all 로 되돌아온다", () => {
  const params = parseAdminListParams(searchParamsFromUrl(`${BASE}?status=all`), OPTS);
  const url = buildAdminListUrl(BASE, params);
  // 정규화: all 은 쿼리에 남기지 않는다.
  assert.equal(url, BASE);
  // 그래도 재파싱하면 all 이다(기본값과 일치) → 탭 활성 표시가 흔들리지 않는다.
  assert.equal(parseAdminListParams(searchParamsFromUrl(url), OPTS).status, "all");
});

test("검색어·페이지와 함께여도 status 가 유지된다(탭 이동 시 page 만 1로 리셋)", () => {
  const params = parseAdminListParams(
    searchParamsFromUrl(`${BASE}?q=abc&status=hidden&page=4`),
    OPTS
  );
  assert.equal(params.status, "hidden");
  assert.equal(params.page, 4);

  // 다른 상태 탭으로 이동 → status 는 바뀌고 검색어는 유지, page 는 1 리셋.
  const next = parseAdminListParams(
    searchParamsFromUrl(buildAdminListUrl(BASE, params, { status: "published" })),
    OPTS
  );
  assert.equal(next.status, "published");
  assert.equal(next.search, "abc");
  assert.equal(next.page, 1);

  // 페이지만 이동 → status·검색어 유지.
  const paged = parseAdminListParams(
    searchParamsFromUrl(buildAdminListUrl(BASE, params, { page: 2 })),
    OPTS
  );
  assert.equal(paged.status, "hidden");
  assert.equal(paged.search, "abc");
  assert.equal(paged.page, 2);
});

test("배열 searchParams(중복 키)도 첫 값으로 안정 파싱된다", () => {
  const params = parseAdminListParams({ status: ["hidden", "published"] }, OPTS);
  assert.equal(params.status, "hidden");
});
