// 계약 테스트: 최근 본 멘토 localStorage — 순서(최신 먼저)·dedup·손상 파싱·빈 상태.
// 실행: node --test --experimental-strip-types lib/mentor/__contract__/recentMentorsStorage.contract.test.ts

import test from "node:test";
import assert from "node:assert/strict";

// window.localStorage 모의(모듈 import 전에 설치 — 모듈은 참조만 하고 top-level 접근 없음).
class MemStorage {
  private m = new Map<string, string>();
  getItem(k: string): string | null {
    return this.m.has(k) ? (this.m.get(k) as string) : null;
  }
  setItem(k: string, v: string): void {
    this.m.set(k, v);
  }
  removeItem(k: string): void {
    this.m.delete(k);
  }
  clear(): void {
    this.m.clear();
  }
}
const store = new MemStorage();
(globalThis as unknown as { window: unknown }).window = { localStorage: store };

const { readRecentMentorIds, recordRecentMentor, recentMentorCount } = await import("../recentMentorsStorage.ts");

const KEY = "ssambership_recent_mentors";

test("빈 상태 → []", () => {
  store.clear();
  assert.deepEqual(readRecentMentorIds(), []);
  assert.equal(recentMentorCount(), 0);
});

test("기록 순서: 최근 본 것이 앞", () => {
  store.clear();
  recordRecentMentor("m1");
  recordRecentMentor("m2");
  recordRecentMentor("m3");
  assert.deepEqual(readRecentMentorIds(), ["m3", "m2", "m1"]);
});

test("dedup: 같은 멘토 재방문 시 1건·맨 앞", () => {
  store.clear();
  recordRecentMentor("m1");
  recordRecentMentor("m2");
  recordRecentMentor("m1");
  const ids = readRecentMentorIds();
  assert.equal(ids.filter((x) => x === "m1").length, 1);
  assert.equal(ids[0], "m1");
});

test("손상 localStorage → [] (throw 안 함)", () => {
  store.clear();
  store.setItem(KEY, "{not-json");
  assert.deepEqual(readRecentMentorIds(), []);
  store.setItem(KEY, JSON.stringify({ not: "array" }));
  assert.deepEqual(readRecentMentorIds(), []);
  store.setItem(KEY, JSON.stringify([{ mentorId: "", viewedAt: 1 }, { nope: true }]));
  assert.deepEqual(readRecentMentorIds(), []); // mentorId 없는/빈 항목 제외
});

test("빈/무효 mentorId 기록은 무시", () => {
  store.clear();
  recordRecentMentor("");
  assert.deepEqual(readRecentMentorIds(), []);
});
