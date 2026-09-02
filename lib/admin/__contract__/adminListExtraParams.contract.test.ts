// 계약 테스트: 관리자 목록 툴바 파라미터 보존(PR-1 공통 계약 층 §4).
// 실행: node --test --experimental-strip-types lib/admin/__contract__/adminListExtraParams.contract.test.ts
//
// 고정하는 것:
//   ① refunds: 상태 탭 전환·검색 초기화·페이지 이동 후에도 `type`/`sort` 가 유지된다(구 동작: 소실).
//   ② community-content: `basePath` 에 `?type=…` 이 박혀 있어도 `?type=shortforms?status=hidden` 같은
//      이중 `?` URL 이 만들어지지 않고 `type` 이 보존된다(구 동작: parseType 이 posts 로 되돌림).
//   ③ 플래시 키(ok/error/capOk/capError)와 예약 키는 extra 로 따라다니지 않는다.
//   ④ 툴바는 GET form action 에 순수 경로만 두고 보존 파라미터를 hidden input 으로 보낸다(소스 tripwire).
//   ⑤ 기존 status 왕복 계약(adminListStatusFilter.contract.test.ts)은 그대로 통과한다 — 여기서는 확장분만.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ADMIN_LIST_RESERVED_KEYS,
  ADMIN_LIST_TRANSIENT_KEYS,
  MAX_EXTRA_PARAM_KEYS,
  MAX_EXTRA_PARAM_VALUE_LENGTH,
  buildAdminListUrl,
  parseAdminListParams,
  pickAdminListExtraParams,
  resolveAdminListExtraParams,
  splitAdminListBasePath,
} from "../adminListParams.ts";

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

/** URL 문자열 → 서버 컴포넌트가 받는 searchParams 형태(브라우저 진입 재현) */
function spFromUrl(url: string): Record<string, string | string[] | undefined> {
  const u = new URL(url, "https://ssambership.local");
  const sp: Record<string, string | string[] | undefined> = {};
  for (const [k, v] of u.searchParams.entries()) sp[k] = v;
  return sp;
}

function queryOf(url: string): URLSearchParams {
  return new URL(url, "https://ssambership.local").searchParams;
}

const REFUNDS = "/admin/refunds";
const REFUNDS_OPTS = { defaultPageSize: 25, defaultStatus: "pending" } as const;

// ── ① refunds type/sort ─────────────────────────────────────────────────────────

test("refunds: SLA 딥링크(type+sort)로 진입하면 extra 에 두 키가 잡힌다", () => {
  const params = parseAdminListParams(spFromUrl(`${REFUNDS}?type=subscription_mentor_suspended&sort=deadline`), REFUNDS_OPTS);
  assert.deepEqual(params.extra, { type: "subscription_mentor_suspended", sort: "deadline" });
  assert.equal(params.status, "pending");
});

test("refunds: 상태 탭 전환 후 type/sort 유지 · status 변경 · page 1 리셋", () => {
  const entered = parseAdminListParams(
    spFromUrl(`${REFUNDS}?type=subscription_mentor_suspended&sort=deadline&status=pending&page=3`),
    REFUNDS_OPTS
  );
  const url = buildAdminListUrl(REFUNDS, entered, { status: "succeeded" });
  const q = queryOf(url);
  assert.equal(q.get("type"), "subscription_mentor_suspended");
  assert.equal(q.get("sort"), "deadline");
  assert.equal(q.get("status"), "succeeded");
  assert.equal(q.get("page"), null, "탭 전환은 page 를 1 로 리셋");
  const reparsed = parseAdminListParams(spFromUrl(url), REFUNDS_OPTS);
  assert.deepEqual(reparsed.extra, entered.extra);
});

test("refunds: 검색 초기화(search:'')·페이지 이동(page:2) 모두 type/sort 유지", () => {
  const entered = parseAdminListParams(
    spFromUrl(`${REFUNDS}?q=abc&type=subscription_prorated&sort=deadline&status=pending`),
    REFUNDS_OPTS
  );
  const reset = queryOf(buildAdminListUrl(REFUNDS, entered, { search: "" }));
  assert.equal(reset.get("q"), null);
  assert.equal(reset.get("type"), "subscription_prorated");
  assert.equal(reset.get("sort"), "deadline");

  const paged = queryOf(buildAdminListUrl(REFUNDS, entered, { page: 2 }));
  assert.equal(paged.get("page"), "2");
  assert.equal(paged.get("q"), "abc");
  assert.equal(paged.get("type"), "subscription_prorated");
  assert.equal(paged.get("sort"), "deadline");
});

test("refunds: 여러 번 왕복해도 extra 가 늘거나 줄지 않는다(멱등)", () => {
  let params = parseAdminListParams(spFromUrl(`${REFUNDS}?type=subscription_prorated&sort=deadline`), REFUNDS_OPTS);
  for (const status of ["succeeded", "rejected", "all", "pending"]) {
    params = parseAdminListParams(spFromUrl(buildAdminListUrl(REFUNDS, params, { status })), REFUNDS_OPTS);
    assert.deepEqual(params.extra, { type: "subscription_prorated", sort: "deadline" }, `status=${status}`);
  }
});

test("extra 를 override 로 바꾸면 반영되고 빈 문자열은 제거된다 · page 는 1 리셋", () => {
  const params = parseAdminListParams(spFromUrl(`${REFUNDS}?type=a&sort=deadline&page=4`), REFUNDS_OPTS);
  const q = queryOf(buildAdminListUrl(REFUNDS, params, { extra: { sort: "", type: "b" } }));
  assert.equal(q.get("sort"), null);
  assert.equal(q.get("type"), "b");
  assert.equal(q.get("page"), null);
});

// ── ② community-content basePath 에 박힌 ?type= ──────────────────────────────────

const COMMUNITY = "/admin/community-content";
const COMMUNITY_OPTS = { defaultPageSize: 25, defaultStatus: "all" } as const;

/** community-content/page.tsx 의 parseType 과 동일한 판정(page 파일은 이 PR 에서 수정하지 않으므로 복제) */
function parseType(raw: string | string[] | undefined): "posts" | "shortforms" | "board-comments" | "comments" {
  const v = typeof raw === "string" ? raw.trim() : Array.isArray(raw) ? raw[0] : "";
  if (v === "shortforms" || v === "board-comments" || v === "comments") return v;
  return "posts";
}

test("splitAdminListBasePath: 쿼리가 박힌 basePath 를 경로와 baked 파라미터로 나눈다", () => {
  assert.deepEqual(splitAdminListBasePath(COMMUNITY), { path: COMMUNITY, baked: {} });
  assert.deepEqual(splitAdminListBasePath(`${COMMUNITY}?type=shortforms`), {
    path: COMMUNITY,
    baked: { type: "shortforms" },
  });
  // 예약·플래시 키가 박혀 있어도 baked 로 새지 않는다
  assert.deepEqual(splitAdminListBasePath(`${COMMUNITY}?status=hidden&ok=1&type=comments`).baked, { type: "comments" });
});

test("community-content: 숏폼 탭에서 상태 탭을 눌러도 URL 에 ? 는 하나, type 은 shortforms 로 남는다", () => {
  const basePath = `${COMMUNITY}?type=shortforms`;
  const params = parseAdminListParams(spFromUrl(`${COMMUNITY}?type=shortforms`), COMMUNITY_OPTS);
  const url = buildAdminListUrl(basePath, params, { status: "hidden" });
  assert.equal(url.split("?").length - 1, 1, `이중 ? 금지: ${url}`);
  const sp = spFromUrl(url);
  assert.equal(parseType(sp.type), "shortforms");
  assert.equal(parseAdminListParams(sp, COMMUNITY_OPTS).status, "hidden");
});

test("community-content: 댓글 탭 + 검색어 + 페이지 이동에서도 type 이 보존된다", () => {
  const basePath = `${COMMUNITY}?type=comments`;
  const params = parseAdminListParams(spFromUrl(`${COMMUNITY}?type=comments&q=spam&status=hidden`), COMMUNITY_OPTS);
  const paged = spFromUrl(buildAdminListUrl(basePath, params, { page: 2 }));
  assert.equal(parseType(paged.type), "comments");
  assert.equal(paged.q, "spam");
  assert.equal(paged.status, "hidden");
  assert.equal(paged.page, "2");
});

test("community-content: status=all 탭은 쿼리에 status 를 남기지 않되 type 은 남긴다", () => {
  const basePath = `${COMMUNITY}?type=board-comments`;
  const params = parseAdminListParams(spFromUrl(`${COMMUNITY}?type=board-comments&status=hidden`), COMMUNITY_OPTS);
  const url = buildAdminListUrl(basePath, params, { status: "all" });
  assert.equal(url, `${COMMUNITY}?type=board-comments`);
});

test("basePath 에 박힌 값보다 params.extra 가 우선한다(현재 URL 이 정본)", () => {
  const params = parseAdminListParams(spFromUrl(`${COMMUNITY}?type=comments`), COMMUNITY_OPTS);
  assert.deepEqual(resolveAdminListExtraParams(`${COMMUNITY}?type=shortforms`, params), { type: "comments" });
});

// ── ③ 플래시·예약 키 제외 ──────────────────────────────────────────────────────

test("플래시 키(ok/error/capOk/capError)는 extra 에 들어가지 않는다 → 탭 이동에 따라다니지 않는다", () => {
  const params = parseAdminListParams(
    spFromUrl(`${REFUNDS}?ok=approved&error=x&capOk=1&capError=y&type=subscription_prorated`),
    REFUNDS_OPTS
  );
  assert.deepEqual(params.extra, { type: "subscription_prorated" });
  const q = queryOf(buildAdminListUrl(REFUNDS, params, { status: "all" }));
  for (const key of ADMIN_LIST_TRANSIENT_KEYS) assert.equal(q.get(key), null, key);
});

test("예약 키(q/search/status/page/pageSize)는 전용 필드로만 가고 extra 에는 없다", () => {
  const extra = pickAdminListExtraParams({ q: "a", search: "b", status: "c", page: "2", pageSize: "50", type: "t" });
  for (const key of ADMIN_LIST_RESERVED_KEYS) assert.equal(key in extra, false, key);
  assert.deepEqual(extra, { type: "t" });
});

test("extra 상한: 키 형식 위반 제외 · 키 개수 상한 · 값 길이 절단", () => {
  const sp: Record<string, string> = {};
  for (let i = 0; i < MAX_EXTRA_PARAM_KEYS + 5; i += 1) sp[`k${i}`] = "v";
  assert.equal(Object.keys(pickAdminListExtraParams(sp)).length, MAX_EXTRA_PARAM_KEYS);

  assert.deepEqual(pickAdminListExtraParams({ "bad key": "x", "ok-key.1_": "y", "": "z" }), { "ok-key.1_": "y" });

  const long = "x".repeat(MAX_EXTRA_PARAM_VALUE_LENGTH + 100);
  assert.equal(pickAdminListExtraParams({ type: long }).type.length, MAX_EXTRA_PARAM_VALUE_LENGTH);
});

test("배열(중복 키) extra 는 첫 값으로 안정 파싱 · 빈 값은 제외", () => {
  assert.deepEqual(pickAdminListExtraParams({ type: ["a", "b"], sort: "", empty: ["", "x"] }), { type: "a" });
});

// ── ④ 툴바 소스 tripwire ───────────────────────────────────────────────────────

test("툴바: GET form action 은 순수 경로(splitAdminListBasePath) · 보존 파라미터는 hidden input", () => {
  const src = read("components/admin/AdminListToolbar.tsx");
  assert.ok(src.includes("splitAdminListBasePath(basePath)"), "basePath 분리 누락");
  assert.ok(src.includes("resolveAdminListExtraParams(basePath, params)"), "보존 파라미터 계산 누락");
  assert.ok(/action=\{actionPath\}\s+method="GET"/.test(src), "form action 이 순수 경로가 아님");
  assert.ok(!/action=\{basePath\}/.test(src), "form action 에 쿼리 포함 basePath 가 남아 있음");
  assert.ok(
    /Object\.entries\(preservedParams\)\.map\(\(\[key, value\]\) => \(\s*<input key=\{key\} type="hidden" name=\{key\} value=\{value\} \/>/.test(src),
    "보존 파라미터 hidden input 누락"
  );
  // 탭·초기화 링크는 여전히 buildAdminListUrl 경유(extra 보존은 빌더 책임)
  assert.ok(src.includes('buildAdminListUrl(basePath, params, { status: tab.value })'));
  assert.ok(src.includes('buildAdminListUrl(basePath, params, { search: "" })'));
});

test("페이지네이션도 같은 빌더를 쓰므로 extra 보존을 그대로 상속한다(파일 무수정)", () => {
  const src = read("components/admin/AdminListPagination.tsx");
  assert.ok(src.includes("buildAdminListUrl(basePath, params, { page: prevPage })"));
  assert.ok(src.includes("buildAdminListUrl(basePath, params, { page: nextPage })"));
});
