import test from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  assertConnectionNoteWriteAllowed,
  roomHasNoSubscriptionLink,
} from "../connectionNoteSubscriptionGuard.ts";

const STUDENT = "s-1";
const MENTOR = "m-1";
const ROOM = "room-1";

test("D-QR-11: roomHasNoSubscriptionLink — subscription_id 부재/공백은 무료 방", () => {
  assert.equal(roomHasNoSubscriptionLink({ subscription_id: null }), true);
  assert.equal(roomHasNoSubscriptionLink({ subscription_id: undefined }), true);
  assert.equal(roomHasNoSubscriptionLink({ subscription_id: "   " }), true);
  assert.equal(roomHasNoSubscriptionLink({}), true);
  assert.equal(roomHasNoSubscriptionLink({ subscription_id: "sub-9" }), false);
});

type SubsResult = { data: unknown; error: unknown };

/** roomRow 를 1회 반환하고, subscriptions 조회 여부를 기록하는 최소 스텁. */
function makeSupabase(roomRow: Record<string, unknown>, subs: SubsResult, seen: { subsQueried: boolean }): SupabaseClient {
  return {
    from(table: string) {
      if (table === "mentor_student_rooms") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: roomRow, error: null }),
            }),
          }),
        };
      }
      if (table === "subscriptions") {
        seen.subsQueried = true;
        const thenable: Record<string, unknown> = {
          eq() {
            return thenable;
          },
          then(res: (v: SubsResult) => unknown) {
            return Promise.resolve(subs).then(res);
          },
        };
        return { select: () => thenable };
      }
      throw new Error("unexpected table " + table);
    },
  } as unknown as SupabaseClient;
}

test("D-QR-11: 무료 질문권 방(subscription_id 없음)은 편집 허용 — subscriptions 조회조차 하지 않는다", async () => {
  const seen = { subsQueried: false };
  const supabase = makeSupabase(
    { id: ROOM, student_id: STUDENT, mentor_id: MENTOR, subscription_id: null },
    { data: [], error: null },
    seen
  );
  const r = await assertConnectionNoteWriteAllowed(supabase, ROOM, "student");
  assert.equal(r.ok, true, "무료 방은 '만료' 차단 대상이 아니다");
  assert.equal(seen.subsQueried, false, "무료 방은 구독 조회 없이 즉시 허용");
});

test("D-QR-11: 구독 이력 있으나 비활성 방은 여전히 차단(만료 메시지)", async () => {
  const seen = { subsQueried: false };
  const supabase = makeSupabase(
    { id: ROOM, student_id: STUDENT, mentor_id: MENTOR, subscription_id: "sub-9" },
    { data: [{ status: "canceled" }], error: null },
    seen
  );
  const r = await assertConnectionNoteWriteAllowed(supabase, ROOM, "student");
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.userMessage, /만료/);
  assert.equal(seen.subsQueried, true);
});

test("D-QR-11: 활성 구독 방은 허용", async () => {
  const seen = { subsQueried: false };
  const supabase = makeSupabase(
    { id: ROOM, student_id: STUDENT, mentor_id: MENTOR, subscription_id: "sub-9" },
    { data: [{ status: "active" }], error: null },
    seen
  );
  const r = await assertConnectionNoteWriteAllowed(supabase, ROOM, "mentor");
  assert.equal(r.ok, true);
});
