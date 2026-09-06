// 계약 테스트: 멘토 찾기 페이지네이션 2단계(2026-09-06) — 서버 12장 전부 렌더 · 하단 `‹ 이전 · N / M · 다음 ›` 하나.
// 실행: node --test --experimental-strip-types lib/mentor/__contract__/mentorListPagination.contract.test.ts
//
// 고정하는 것: (1) 1페이지·중간·마지막 버튼 상태 (2) ?page= 반영(1페이지는 파라미터 없음 · 파서 하한 1)
// (3) 필터·정렬·보기·scope·검색 변경 시 1페이지 복귀 (4) MentorGrid 클라이언트 슬라이스·버튼 0 ·
// MentorsListBody "더 많은 멘토 보기"·"이전 / N / M" 0 · 페이지네이션은 하단 하나 (5) 관리자 컴포넌트 import 0 ·
// RecentMentorsScope 도 같은 MentorGrid (6) 페이지 크기 12 유지.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { mentorListPageParam, mentorListPaginationState } from "../../../components/mentor/mentorListPaginationState.ts";

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

test("1페이지(1 / 3): 이전 비활성 · 다음 활성 · 1페이지에서도 상태를 돌려준다(항상 표시)", () => {
  const s = mentorListPaginationState({ page: 1, pageSize: 12, totalCount: 30 });
  assert.deepEqual(s, { page: 1, totalPages: 3, hasPrev: false, hasNext: true, prevPage: 0, nextPage: 2, label: "1 / 3" });
  // 결과 12장 이하(1 / 1)·0명(1 / 1)도 양쪽 비활성으로 렌더된다
  assert.deepEqual(mentorListPaginationState({ page: 1, pageSize: 12, totalCount: 12 }), { page: 1, totalPages: 1, hasPrev: false, hasNext: false, prevPage: 0, nextPage: 1, label: "1 / 1" });
  assert.equal(mentorListPaginationState({ page: 1, pageSize: 12, totalCount: 0 }).label, "1 / 1");
});

test("중간(2 / 3): 이전·다음 모두 활성 · 이전은 1(파라미터 없음) · 다음은 3", () => {
  const s = mentorListPaginationState({ page: 2, pageSize: 12, totalCount: 30 });
  assert.equal(s.hasPrev, true);
  assert.equal(s.hasNext, true);
  assert.equal(s.prevPage, 1);
  assert.equal(s.nextPage, 3);
  assert.equal(s.label, "2 / 3");
  assert.equal(mentorListPageParam(s.prevPage), null, "1페이지 링크는 ?page= 를 싣지 않는다");
  assert.equal(mentorListPageParam(s.nextPage), "3");
});

test("마지막(3 / 3): 다음 비활성 · 이전 활성 · 경계 13장 = 2페이지", () => {
  const s = mentorListPaginationState({ page: 3, pageSize: 12, totalCount: 30 });
  assert.equal(s.hasNext, false);
  assert.equal(s.hasPrev, true);
  assert.equal(s.prevPage, 2);
  assert.equal(s.label, "3 / 3");
  assert.equal(mentorListPaginationState({ page: 2, pageSize: 12, totalCount: 13 }).hasNext, false);
  assert.equal(mentorListPaginationState({ page: 1, pageSize: 12, totalCount: 13 }).totalPages, 2);
  // 범위 초과 요청(9 / 3): 라벨은 요청값 · 다음 비활성 · 이전은 마지막 페이지로
  const over = mentorListPaginationState({ page: 9, pageSize: 12, totalCount: 30 });
  assert.equal(over.label, "9 / 3");
  assert.equal(over.hasNext, false);
  assert.equal(over.prevPage, 3);
  // 비정상 입력은 하한으로
  assert.equal(mentorListPaginationState({ page: 0, pageSize: 0, totalCount: -5 }).label, "1 / 1");
});

test("?page= 반영: 파서 하한 1 · 기록은 page > 1 만 · 컴포넌트는 mentorsListHref(hrefBase, { page }) 로 필터 보존", () => {
  const sp = read("lib/mentor/mentorsListSearchParams.ts");
  assert.ok(sp.includes('page: Math.max(1, parseIntParam(one("page")) ?? 1),'), "파서 하한 1");
  assert.ok(sp.includes("if (f.page > 1) o.page = String(f.page);"), "1페이지는 URL 에 싣지 않는다");
  assert.ok(sp.includes("export const MENTORS_PAGE_SIZE = 12;"), "페이지 크기 12 유지");
  const nav = read("components/mentor/MentorListPagination.tsx");
  assert.ok(nav.includes("mentorsListHref(props.hrefBase, { page: mentorListPageParam(state.prevPage) })"), "이전 링크");
  assert.ok(nav.includes("mentorsListHref(props.hrefBase, { page: mentorListPageParam(state.nextPage) })"), "다음 링크");
  assert.ok(nav.includes('aria-disabled={!state.hasPrev}') && nav.includes('aria-disabled={!state.hasNext}'), "비활성 aria-disabled");
  assert.ok(nav.includes("pointer-events-none border-slate-100 bg-white text-slate-300"), "비활성 회색(AdminDataTable 규격)");
  assert.ok(nav.includes(': "#"'), "비활성 href #");
  assert.ok(nav.includes("‹") && nav.includes("›") && nav.includes("{state.label}"), "‹ 이전 · N / M · 다음 › 마크업");
  assert.ok(!nav.includes("hasPrev ?") || !/totalPages > 1 \?/.test(nav), "1페이지에서도 렌더(조건부 숨김 없음)");
  assert.ok(!/from ["']@\/components\/admin|from ["']@\/lib\/admin/.test(nav), "관리자 컴포넌트·모듈 import 0");
});

test("필터 변경 시 1페이지 복귀: 검색 form·사이드바 form 에 page hidden 없음 · 정렬·보기 링크 page:null · 퀵링크 고정 URL", () => {
  const top = read("components/mentor/MentorsListTopFilterBar.tsx");
  assert.ok(!/name=["']page["']/.test(top), "검색 form 이 page 를 실어 보낸다");
  assert.equal((top.match(/page: null/g) ?? []).length, 3, "정렬 + 보기(list·grid) 링크 3곳 page:null");
  const sidebar = read("components/mentor/MentorsListFilterSidebar.tsx");
  assert.ok(sidebar.includes('method="get" action="/mentors"') && !/name=["']page["']/.test(sidebar), "사이드바 form 이 page 를 실어 보낸다");
  const sort = read("components/mentor/MentorSortBar.tsx");
  assert.ok(sort.includes("page: null"), "정렬 바 page:null");
  const quick = read("components/mentor/MentorsListQuickLinks.tsx");
  assert.ok(quick.includes('href="/mentors?scope=recent"') && quick.includes('href="/mentors?scope=favorite"'), "퀵링크는 page 없는 고정 URL");
  const summary = read("components/mentor/MentorResultsSummaryBar.tsx");
  assert.ok(summary.includes("{ q: null }"), "검색어 해제 링크");
});

test("MentorGrid: 클라이언트 슬라이스·이전/다음 버튼·반응형 페이지 크기 0 — 받은 cards 전부 렌더", () => {
  // 주석은 코드 표면이 아니다 — // 줄과 /* */ 블록을 걷어낸 뒤 스캔한다.
  const grid = read("components/mentor/MentorGrid.tsx").replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
  for (const forbidden of ["useState", "useMediaQuery", ".slice(", "MENTORS_PER_PAGE", "이전 페이지", "다음 페이지", "<button", '"use client"']) {
    assert.ok(!grid.includes(forbidden), `MentorGrid 클라이언트 페이지네이션 잔재: ${forbidden}`);
  }
  assert.equal((grid.match(/props\.cards\.map\(/g) ?? []).length, 2, "list·grid 두 레이아웃 모두 전부 렌더");
});

test("MentorsListBody: '더 많은 멘토 보기'·'이전 / N / M' 0 · 하단 MentorListPagination 하나 · pageSize 는 서버 결과 그대로", () => {
  const body = read("components/mentor/MentorsListBody.tsx");
  assert.ok(!body.includes("더 많은 멘토 보기"), "더 많은 멘토 보기 잔존");
  assert.ok(!body.includes("list.hasMore"), "hasMore 링크 잔존");
  assert.ok(!body.includes("Math.ceil(list.totalCount / list.pageSize)"), "구 '이전 / N / M' 블록 잔존");
  assert.equal((body.match(/<MentorListPagination/g) ?? []).length, 1, "하단 페이지네이션은 하나");
  assert.ok(body.includes("pageSize={list.pageSize}") && body.includes("totalCount={list.totalCount}") && body.includes("page={list.page}"), "서버 결과 그대로 전달");
  assert.ok(body.includes("hrefBase={hrefBase}"), "필터 보존 hrefBase");
});

test("RecentMentorsScope 도 같은 MentorGrid(전부 렌더) · components/mentor 에 관리자 import 0", () => {
  const recent = read("components/mentor/RecentMentorsScope.tsx");
  assert.ok(recent.includes('from "@/components/mentor/MentorGrid"') && recent.includes("<MentorGrid"), "최근 본 멘토가 MentorGrid 미사용");
  const dir = join(ROOT, "components/mentor");
  const offenders: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (!/\.(ts|tsx)$/.test(entry)) continue;
    const src = readFileSync(join(dir, entry), "utf8");
    if (/from ["']@\/components\/admin\/|from ["']@\/lib\/admin\//.test(src)) offenders.push(entry);
  }
  assert.deepEqual(offenders, [], `관리자 import: ${offenders.join(", ")}`);
});
