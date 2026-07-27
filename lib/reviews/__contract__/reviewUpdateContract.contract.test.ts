// 계약 테스트: 리뷰 수정 UPDATE 의 1행 계약 — supabase/sql/173 과 한 쌍.
// 실행: node --test --experimental-strip-types lib/reviews/__contract__/reviewUpdateContract.contract.test.ts
//
// ⚠️ 이 파일이 고정하는 것은 **영향 행 수 → 성공/실패 판정**뿐이다.
//    173 이 reviews_update_author 정책의 USING 에 조정 상태 조건을 더한 뒤로,
//    모더레이션된 리뷰에 대한 UPDATE 는 예외가 아니라 **error 없는 0행**으로 끝난다.
//    error 만 검사하던 구현은 이때 { ok:true } 를 돌려줬다 — 화면은 "수정 성공"인데
//    DB 는 그대로인 조용한 무효 수정이다. 그 회귀를 여기서 막는다.
//
//    RLS·트리거 자체의 계약(타인이 숨김 행을 못 읽는다 등)은 TS 로 고정할 수 없어
//    staging 공격 테스트(§4-A ①)로 검증한다. 여기서는 다루지 않는다.
//
// SupabaseClient 는 체이닝 가능한 최소 스텁으로 대체한다 — 네트워크·DB 접근 0.

import test from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  REVIEW_UPDATE_FAILED_MESSAGE,
  REVIEW_UPDATE_NOT_APPLIED_MESSAGE,
  applyReviewUpdate,
  decideReviewUpdateOutcome,
} from "../reviewUpdateResult.ts";

const REVIEW_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_REVIEW_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const AUTHOR_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const PATCH = { rating: 5, body: "수정된 본문입니다. 최소 길이를 넘기기 위한 더미 텍스트." };

type StubCalls = {
  table: string | null;
  patch: Record<string, unknown> | null;
  eq: [string, unknown][];
  select: string | null;
};

/** update → eq → eq → select("id") 체인만 흉내 내는 최소 스텁. */
function makeStub(result: { data: unknown; error: unknown }): {
  client: SupabaseClient;
  calls: StubCalls;
} {
  const calls: StubCalls = { table: null, patch: null, eq: [], select: null };

  const chain = {
    eq(column: string, value: unknown) {
      calls.eq.push([column, value]);
      return chain;
    },
    select(columns: string) {
      calls.select = columns;
      return Promise.resolve(result);
    },
  };

  const client = {
    from(table: string) {
      calls.table = table;
      return {
        update(patch: Record<string, unknown>) {
          calls.patch = patch;
          return chain;
        },
      };
    },
  };

  return { client: client as unknown as SupabaseClient, calls };
}

test("UPDATE 가 0행을 반환하면 ok:false — 성공 표시 0 (RLS 가 조용히 막은 경우)", async () => {
  const { client } = makeStub({ data: [], error: null });
  const result = await applyReviewUpdate(client, AUTHOR_ID, REVIEW_ID, PATCH);

  assert.equal(result.ok, false);
  assert.equal(result.ok === false ? result.error : null, REVIEW_UPDATE_NOT_APPLIED_MESSAGE);
});

test("UPDATE 가 2행 이상을 반환하면 ok:false", async () => {
  const { client } = makeStub({ data: [{ id: REVIEW_ID }, { id: OTHER_REVIEW_ID }], error: null });
  const result = await applyReviewUpdate(client, AUTHOR_ID, REVIEW_ID, PATCH);

  assert.equal(result.ok, false);
  assert.equal(result.ok === false ? result.error : null, REVIEW_UPDATE_NOT_APPLIED_MESSAGE);
});

test("반환된 id 가 요청 reviewId 와 다르면 ok:false", async () => {
  const { client } = makeStub({ data: [{ id: OTHER_REVIEW_ID }], error: null });
  const result = await applyReviewUpdate(client, AUTHOR_ID, REVIEW_ID, PATCH);

  assert.equal(result.ok, false);
  assert.equal(result.ok === false ? result.error : null, REVIEW_UPDATE_NOT_APPLIED_MESSAGE);
});

test("정확히 1행 + id 일치일 때만 ok:true 이고 id 를 그대로 반환한다", async () => {
  const { client, calls } = makeStub({ data: [{ id: REVIEW_ID }], error: null });
  const result = await applyReviewUpdate(client, AUTHOR_ID, REVIEW_ID, PATCH);

  assert.equal(result.ok, true);
  assert.equal(result.ok === true ? result.id : null, REVIEW_ID);

  // 체인 형태 고정: reviews 테이블 · rating/body 만 · id + author_id 이중 조건 · id 회수
  assert.equal(calls.table, "reviews");
  assert.deepEqual(calls.patch, { rating: PATCH.rating, body: PATCH.body });
  assert.deepEqual(calls.eq, [
    ["id", REVIEW_ID],
    ["author_id", AUTHOR_ID],
  ]);
  assert.equal(calls.select, "id");
});

test("error 가 있으면 기존 문구로 ok:false (회귀)", async () => {
  const { client } = makeStub({ data: null, error: { message: "permission denied for table reviews" } });
  const result = await applyReviewUpdate(client, AUTHOR_ID, REVIEW_ID, PATCH);

  assert.equal(result.ok, false);
  assert.equal(result.ok === false ? result.error : null, REVIEW_UPDATE_FAILED_MESSAGE);
});

test("error 문구에 DB 원문 에러를 노출하지 않는다", async () => {
  const dbMessage = 'new row violates row-level security policy for table "reviews"';
  const { client } = makeStub({ data: null, error: { message: dbMessage } });
  const result = await applyReviewUpdate(client, AUTHOR_ID, REVIEW_ID, PATCH);

  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.error.includes(dbMessage), false);
  assert.equal(result.ok === false && result.error.includes("row-level security"), false);
});

test("data 가 null 이고 error 도 없으면 0행과 동일하게 취급한다", () => {
  const result = decideReviewUpdateOutcome(REVIEW_ID, null, null);

  assert.equal(result.ok, false);
  assert.equal(result.ok === false ? result.error : null, REVIEW_UPDATE_NOT_APPLIED_MESSAGE);
});

test("error 판정이 행 수 판정보다 우선한다 — 1행이어도 error 면 실패", () => {
  const result = decideReviewUpdateOutcome(REVIEW_ID, [{ id: REVIEW_ID }], { message: "boom" });

  assert.equal(result.ok, false);
  assert.equal(result.ok === false ? result.error : null, REVIEW_UPDATE_FAILED_MESSAGE);
});

test("신규 문구는 1건뿐이고 기존 실패 문구와 구분된다", () => {
  assert.notEqual(REVIEW_UPDATE_NOT_APPLIED_MESSAGE, REVIEW_UPDATE_FAILED_MESSAGE);
  assert.equal(REVIEW_UPDATE_FAILED_MESSAGE, "후기 수정에 실패했습니다.");
  assert.equal(
    REVIEW_UPDATE_NOT_APPLIED_MESSAGE,
    "수정할 수 없는 후기예요. 검토 중이거나 이미 변경된 상태일 수 있어요."
  );
});
