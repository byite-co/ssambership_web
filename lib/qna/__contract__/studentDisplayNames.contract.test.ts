import test from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ANON_STUDENT_LABEL,
  buildDisplayNameMap,
  fetchStudentDisplayNames,
} from "../studentDisplayNames.ts";

test("full_name → nickname 순 폴백, 없으면 익명 라벨", () => {
  const m = buildDisplayNameMap(["a", "b", "c"], [
    { id: "a", full_name: "홍길동", nickname: "gil" },
    { id: "b", full_name: "  ", nickname: "닉네임" },
  ]);
  assert.equal(m.a.displayName, "홍길동");
  assert.equal(m.b.displayName, "닉네임");
  assert.equal(m.c.displayName, ANON_STUDENT_LABEL);
  assert.equal(m.a.initial, "홍");
});

function stub(result: { data: unknown; error: unknown }): SupabaseClient {
  return { rpc: async () => result } as unknown as SupabaseClient;
}

test("빈 id 목록 → error:false + 빈 맵 (RPC 미호출)", async () => {
  let called = false;
  const s = { rpc: async () => { called = true; return { data: [], error: null }; } } as unknown as SupabaseClient;
  const r = await fetchStudentDisplayNames(s, []);
  assert.equal(r.error, false);
  assert.deepEqual(r.byId, {});
  assert.equal(called, false, "빈 목록은 RPC 를 부르지 않는다");
});

test("정상 빈 결과와 조회 오류를 구분한다 (D-QR-7 핵심)", async () => {
  const ok = await fetchStudentDisplayNames(stub({ data: [], error: null }), ["x"]);
  assert.equal(ok.error, false, "정상 빈 결과는 error:false");
  assert.equal(ok.byId.x.displayName, ANON_STUDENT_LABEL);

  const failed = await fetchStudentDisplayNames(stub({ data: null, error: { message: "denied" } }), ["x"]);
  assert.equal(failed.error, true, "RPC 오류는 error:true 로 표면화");
  assert.equal(failed.byId.x.displayName, ANON_STUDENT_LABEL, "오류여도 맵은 안전 라벨로 채운다");
});

test("예외도 삼키지 않고 error:true", async () => {
  const throwing = { rpc: async () => { throw new Error("boom"); } } as unknown as SupabaseClient;
  const r = await fetchStudentDisplayNames(throwing, ["x"]);
  assert.equal(r.error, true);
});
