import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Wave1 L6 학생핵심 — 마이페이지 결함 회귀 방지(소스 스캔 tripwire).
const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

test("D-ST-7: 마이페이지는 requireRole('student') 로 역할을 가드한다(멘토는 멘토 홈으로)", () => {
  const q = read("app/(student)/mypage/page.tsx");
  assert.ok(q.includes('requireRole("student")'), "학생 역할 가드가 없음");
  assert.ok(!q.includes("if (!user) {"), "구 `!user` 단독 검사가 잔존함");
});

test("D-ST-5: 개별질문 카운트 오류는 0 이 아니라 null(→'—')로 표기한다", () => {
  const q = read("app/(student)/mypage/page.tsx");
  assert.ok(q.includes("iqCountRes.error ? null"), "오류 시 null 폴백이 아님");
  assert.ok(q.includes('== null ? "—"'), "null 을 '—' 로 표기하지 않음");
});

test("D-ST-6: 마이페이지는 잔액을 한 번만 조회하고 원장 preview 만 받는다(패키지/80행/이중잔액 제거)", () => {
  const q = read("app/(student)/mypage/page.tsx");
  assert.ok(q.includes("loadMypageWalletPreview"), "마이페이지 전용 preview 로더 미사용");
  assert.ok(!q.includes("loadWalletChargePageData"), "충전 페이지 번들(잔액 중복·80행·패키지) 재사용 잔존");
});

test("D-ST-18: 활성 구독 로더는 멘토별 N+1 대신 배치 조회한다", () => {
  const q = read("lib/mypage/studentActiveSubscriptions.ts");
  assert.ok(q.includes("planTierRowsByMentorIdBatch"), "플랜 배치 조회 없음");
  assert.ok(q.includes("mentorUserRowsByIdBatch"), "멘토 유저 배치 조회 없음");
  assert.ok(!q.includes("getMentorUserPublic"), "getMentorUserPublic N+1 잔존");
});
