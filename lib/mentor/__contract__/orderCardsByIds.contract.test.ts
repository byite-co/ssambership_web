// 계약 테스트: 멘토 scope 정렬/필터 — favorite(입력정렬 유지)·recent(ids 순서)·디렉터리 제외.
// 실행: node --test --experimental-strip-types lib/mentor/__contract__/orderCardsByIds.contract.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import { filterAndOrderByIds, orderItemsByIds } from "../orderCardsByIds.ts";

type Card = { mentorId: string; name: string };
const getId = (c: Card) => c.mentorId;

const cards: Card[] = [
  { mentorId: "a", name: "A" },
  { mentorId: "b", name: "B" },
  { mentorId: "c", name: "C" },
  { mentorId: "d", name: "D" },
];

test("recent: ids 순서 보존(최근 본 순서)", () => {
  const out = filterAndOrderByIds(cards, ["c", "a"], getId, { orderByIds: true });
  assert.deepEqual(out.map(getId), ["c", "a"]);
});

test("favorite: orderByIds=false → 입력(디렉터리 정렬) 순서 유지", () => {
  const out = filterAndOrderByIds(cards, ["c", "a"], getId, { orderByIds: false });
  assert.deepEqual(out.map(getId), ["a", "c"]); // 원본 순서
});

test("디렉터리에 없는 ID(삭제·비활성)는 자동 제외", () => {
  const out = filterAndOrderByIds(cards, ["a", "zzz", "b"], getId, { orderByIds: true });
  assert.deepEqual(out.map(getId), ["a", "b"]);
});

test("빈 ids → 빈 결과", () => {
  assert.deepEqual(filterAndOrderByIds(cards, [], getId, { orderByIds: true }), []);
});

test("orderItemsByIds: ids 에 없는 항목은 뒤로, 원본 불변", () => {
  const src = [...cards];
  const out = orderItemsByIds(src, ["d", "b"], getId);
  assert.deepEqual(out.map(getId), ["d", "b", "a", "c"]);
  assert.deepEqual(src.map(getId), ["a", "b", "c", "d"]); // 원본 변형 안 함
});
