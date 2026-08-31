import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// 멘토 기본 노출 순서 계약 — 소스 스캔 tripwire.
// 기본(인기순) 정렬의 1차 키는 학교인증 그룹 랭크:
// ① 서연고×메디컬 ② 그 외 메디컬 ③ 서연고 일반과 ④ 나머지 대학 ⑤ 학교 미인증(맨 뒤).
const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

test("멘토 기본 정렬: tierGroupRank 1차 키가 존재하고 popular 분기에 적용된다", () => {
  const q = read("lib/mentor/publicMentorsListQueries.ts");
  assert.ok(q.includes("function tierGroupRank"), "tierGroupRank 함수 없음 — 기본 노출 순서 계약 소실");

  // popular 분기에서 그룹 랭크 → 한줄소개 작성 여부 → 설명(bio) 길이 → 인기 점수 순으로 적용돼야 한다.
  const popularIdx = q.indexOf('case "popular"');
  assert.ok(popularIdx >= 0, "sortKey popular 분기 없음");
  const popularBody = q.slice(popularIdx, q.indexOf("case ", popularIdx + 10));
  const rankIdx = popularBody.indexOf("tierGroupRank(");
  const introIdx = popularBody.indexOf("hasCustomIntro");
  const lenIdx = popularBody.indexOf("descriptionLength(");
  const scoreIdx = popularBody.indexOf("reviewCount");
  assert.ok(rankIdx >= 0, "popular 분기에서 tierGroupRank 미사용");
  assert.ok(introIdx > rankIdx, "한줄소개 작성 여부 키가 그룹 랭크 뒤에 없음");
  assert.ok(lenIdx > introIdx, "설명 길이가 한줄소개 작성 여부보다 먼저 적용됨 — 3차여야 한다");
  assert.ok(scoreIdx > lenIdx, "인기 점수가 설명 길이보다 먼저 적용됨 — 최종 폴백이어야 한다");
  assert.ok(popularBody.includes("Number(b.hasCustomIntro) - Number(a.hasCustomIntro)"), "작성 멘토 우선(내림차순) 아님");

  // 한줄소개 작성 여부는 intro_line 원본 컬럼 기준(공란=초기값) — display.intro 는 bio 폴백 오염.
  assert.ok(q.includes("intro_line"), "hasCustomIntro 판정이 intro_line 원본 컬럼 기준이 아님");

  // 2차 키는 순수 bio 컬럼 길이(내림차순)를 재야 한다(intro 는 50자 캡 + bio 폴백 오염).
  const fnStart = q.indexOf("function descriptionLength");
  assert.ok(fnStart >= 0, "descriptionLength 함수 없음");
  const fnBody = q.slice(fnStart, q.indexOf("\nfunction ", fnStart + 10));
  assert.ok(fnBody.includes("display.bio"), "설명 길이 판정이 bio 컬럼 기준이 아님");
  assert.ok(popularBody.includes("descriptionLength(b) - descriptionLength(a)"), "설명 길이 내림차순 아님");
});

test("멘토 기본 정렬: 그룹 랭크 순서(서연고×메디컬→메디컬→서연고→나머지→미인증)가 유지된다", () => {
  const q = read("lib/mentor/publicMentorsListQueries.ts");
  const fnStart = q.indexOf("function tierGroupRank");
  const fnBody = q.slice(fnStart, q.indexOf("\nfunction ", fnStart + 10));

  // 미인증(schoolVerified=false 또는 tier 공란)은 맨 뒤(4).
  assert.ok(/!d\.schoolVerified[^\n]*return 4/.test(fnBody), "학교 미인증 멘토가 맨 뒤(4)로 밀리지 않음");
  // 랭크 반환 순서가 0→1→2→3 으로 소스에 나타나야 한다(서연고×메디컬이 최상위).
  const r0 = fnBody.indexOf("return 0");
  const r1 = fnBody.indexOf("return 1");
  const r2 = fnBody.indexOf("return 2");
  const r3 = fnBody.indexOf("return 3");
  assert.ok(r0 >= 0 && r1 > r0 && r2 > r1 && r3 > r2, "그룹 랭크 분기 순서 훼손");
  // 판정 기준 필드가 학교인증 정본(schoolTier / verifiedMajorCategory)이어야 한다.
  assert.ok(fnBody.includes("schoolTier"), "schoolTier 미사용");
  assert.ok(fnBody.includes("verifiedMajorCategory"), "verifiedMajorCategory 미사용");
  assert.ok(fnBody.includes('"서연고"') && fnBody.includes('"메디컬"'), "서연고/메디컬 판정 상수 소실");
});

test("멘토 기본 정렬: 명시 정렬(가격·별점·리뷰·최신)은 그룹 랭크를 적용하지 않는다", () => {
  const q = read("lib/mentor/publicMentorsListQueries.ts");
  const callCount = q.split("tierGroupRank(").length - 1 - (q.split("function tierGroupRank(").length - 1);
  // popular 분기의 a/b 두 호출만 존재해야 한다(정의부 제외, 재귀 없음).
  assert.equal(callCount, 2, "tierGroupRank 가 popular 외 정렬 분기로 확산됨(명시 정렬은 순수 정렬 유지)");
});
