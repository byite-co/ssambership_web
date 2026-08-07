import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Wave1 L6 학생핵심 — 랜딩 결함 회귀 방지(소스 스캔 tripwire).
const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

test("D-ST-1/2/3/D-CM-17: 랜딩 로더는 부재 테이블·플랜 혼합·커뮤니티 미사용 조회를 하지 않는다", () => {
  const q = read("lib/landing/landingPageQueries.ts");
  assert.ok(!q.includes("NOTICE_TABLES"), "notices 계열 프로빙 잔존(D-ST-1)");
  assert.ok(!q.includes("PLAN_TABLES"), "plans 프로빙 잔존(D-ST-2)");
  assert.ok(!q.includes("assignPlansByTier"), "랜딩 플랜 혼합 배정 잔존(D-ST-2)");
  assert.ok(!q.includes("listShortformPosts"), "숏폼 목록 조회 잔존(D-CM-17)");
  assert.ok(!q.includes("listBoardPosts"), "게시판 목록 조회 잔존(D-CM-17)");
});

test("D-ST-4: 로드 실패를 폴백 배너 플래그로 표면화한다", () => {
  const q = read("lib/landing/landingPageQueries.ts");
  assert.ok(q.includes("loadError"), "loadError 플래그 없음");
  const view = read("components/landing/PublicGuestLanding.tsx");
  assert.ok(view.includes("loadError"), "랜딩 뷰가 loadError 배너를 노출하지 않음");
});
