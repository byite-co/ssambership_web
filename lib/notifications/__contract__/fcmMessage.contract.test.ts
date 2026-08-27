// fcmMessage.contract.test.ts — FCM v1 메시지 빌더·오류 판정·게이트 분리 순수 계약
// (PUSH 지시문 B-5). node:test · 네트워크 0 · Supabase/"@/" 의존 0.
//
// 고정하는 계약(앱 PushPayload.fromRemote 와의 와이어 계약):
//  - data 키 ⊆ {type, notification_id, event_key, room_id, thread_id, question_id}
//  - data 값은 전부 string · 부재 값은 키 생략(빈 문자열 금지 — 앱은 빈/부재를 null 취급)
//  - link/url 미포함(앱이 버린다 — 외부 경로 실행 금지 계약)
//  - android channel_id = ssambership_default 고정(앱 A-4 채널과 1:1)
//  - 게이트 2종(new_order_message·new_application)은 빌더 이전(claim 래퍼) 단계에서 걸러진다
//  - invalidToken 판정(상태 코드별 명시 — isInvalidTokenError 폴백 없음):
//    404/UNREGISTERED → true · 400 은 FCM 무효 토큰 문구(/registration token/i)일 때만 true ·
//    401/403 은 항상 false(SENDER_ID_MISMATCH 포함 — 서버 설정 오류) · 429/5xx → false

import test from "node:test";
import assert from "node:assert/strict";
import {
  GATED_PUSH_EVENT_TYPES,
  buildFcmMessage,
  classifyFcmSendFailure,
  createFcmTransport,
  resolveFcmTransportMode,
  splitGatedOutboxRows,
  type NotificationRowForPush,
  type OutboxRowForPush,
} from "../fcmTransport.ts";

const ALLOWED_DATA_KEYS = new Set([
  "type",
  "notification_id",
  "event_key",
  "room_id",
  "thread_id",
  "question_id",
]);

function outboxRow(overrides?: Partial<OutboxRowForPush>): OutboxRowForPush {
  return {
    id: "outbox-1",
    recipient_user_id: "user-1",
    event_type: "question_answered",
    attempt_count: 0,
    payload: {},
    notification_id: "notif-1",
    event_key: "question_answer_message:m-1",
    ...overrides,
  };
}

function notificationRow(overrides?: Partial<NotificationRowForPush>): NotificationRowForPush {
  return {
    body: "새 답변이 도착했어요.",
    data: { title: "질문방 답변" },
    metadata: { room_id: "room-1", thread_id: "thread-1" },
    ...overrides,
  };
}

test("data 키는 허용 6종 밖을 만들지 않고 값은 전부 string 이다", () => {
  const { message } = buildFcmMessage({
    token: "tok-1",
    outbox: outboxRow(),
    notification: notificationRow({
      metadata: { room_id: "room-1", thread_id: "thread-1", question_id: "q-1", link: "https://evil.example" },
    }),
  });
  for (const [key, value] of Object.entries(message.data)) {
    assert.ok(ALLOWED_DATA_KEYS.has(key), `허용 밖 data 키: ${key}`);
    assert.equal(typeof value, "string", `${key} 값이 string 이 아니다`);
    assert.ok(value.length > 0, `${key} 값이 빈 문자열이다(생략 계약 위반)`);
  }
  // metadata 의 link/url 류는 어떤 키로도 전달되지 않는다.
  assert.ok(!("link" in message.data) && !("url" in message.data), "link/url 전달 금지");
  assert.equal(message.data.type, "question_answered");
  assert.equal(message.data.notification_id, "notif-1");
  assert.equal(message.data.event_key, "question_answer_message:m-1");
  assert.equal(message.data.room_id, "room-1");
  assert.equal(message.data.thread_id, "thread-1");
  assert.equal(message.data.question_id, "q-1");
});

test("없는 값은 키 자체를 생략한다(빈 문자열·null 문자열화 금지)", () => {
  const { message } = buildFcmMessage({
    token: "tok-1",
    outbox: outboxRow({ notification_id: null, event_key: "" }),
    notification: notificationRow({ metadata: { room_id: "  ", thread_id: null, question_id: 7 } }),
  });
  assert.deepEqual(Object.keys(message.data).sort(), ["type"]);
});

test("notification 파트: title 은 notifications.data.title, 없으면 '쌤버십' 폴백", () => {
  const withTitle = buildFcmMessage({ token: "t", outbox: outboxRow(), notification: notificationRow() });
  assert.equal(withTitle.message.notification.title, "질문방 답변");
  assert.equal(withTitle.message.notification.body, "새 답변이 도착했어요.");

  const withoutTitle = buildFcmMessage({
    token: "t",
    outbox: outboxRow(),
    notification: notificationRow({ data: null, body: null }),
  });
  assert.equal(withoutTitle.message.notification.title, "쌤버십");
  assert.equal(withoutTitle.message.notification.body, "");
});

test("android channel_id = ssambership_default · priority high · apns-priority 10 고정", () => {
  const { message } = buildFcmMessage({ token: "t", outbox: outboxRow(), notification: notificationRow() });
  assert.equal(message.android.notification.channel_id, "ssambership_default");
  assert.equal(message.android.priority, "high");
  assert.equal(message.apns.headers["apns-priority"], "10");
  assert.equal(message.apns.payload.aps.sound, "default");
  assert.equal(message.token, "t");
});

test("게이트 2종은 빌더 이전(claim 래퍼) 단계에서 분리된다(F19)", () => {
  assert.deepEqual([...GATED_PUSH_EVENT_TYPES].sort(), ["new_application", "new_order_message"]);
  const rows = [
    outboxRow({ id: "a", event_type: "new_order_message" }),
    outboxRow({ id: "b", event_type: "question_answered" }),
    outboxRow({ id: "c", event_type: "new_application" }),
    outboxRow({ id: "d", event_type: "subscription_expired" }),
  ];
  const { gated, sendable } = splitGatedOutboxRows(rows);
  assert.deepEqual(gated.map((r) => r.id), ["a", "c"]);
  assert.deepEqual(sendable.map((r) => r.id), ["b", "d"]);
});

test("invalidToken 판정 — 404 는 무효 토큰(revoke 경로)", () => {
  const res = classifyFcmSendFailure({
    status: 404,
    errorMessage: "Requested entity was not found.",
    errorCodes: [],
  });
  assert.equal(res.ok, false);
  assert.equal(res.invalidToken, true);
  assert.ok(res.error && res.error.includes("fcm_status_404"));
});

test("invalidToken 판정 — details[].errorCode UNREGISTERED 는 무효 토큰", () => {
  const res = classifyFcmSendFailure({
    status: 400,
    errorMessage: "Requested entity was not found.",
    errorCodes: ["UNREGISTERED"],
  });
  assert.equal(res.invalidToken, true);
  assert.ok(res.error && res.error.includes("UNREGISTERED"));
});

test("invalidToken 판정 — 429/5xx 는 무효 아님(backoff 재시도)", () => {
  for (const status of [429, 500, 503]) {
    const res = classifyFcmSendFailure({
      status,
      // 메시지에 무효 토큰 어휘가 섞여 있어도 상태 클래스가 우선한다.
      errorMessage: "internal error while checking registration",
      errorCodes: ["INTERNAL"],
    });
    assert.equal(res.ok, false);
    assert.equal(res.invalidToken, false, `status ${status} 는 재시도 대상`);
  }
});

test("400 INVALID_ARGUMENT(payload 형식 오류)는 무효 토큰으로 분류하지 않는다(적대 검증 #9)", () => {
  // 명시 판정 계약(2026-08-27 개정): 400 은 FCM 무효 토큰 문구가 아닌 한 토큰 잘못이
  // 아니다 — isInvalidTokenError 폴백 제거로 invalid_argument 어휘 오분류가 원천 차단됐다.
  // (형식 위반 payload 자체를 만들지 않는 빌더 계약은 위 두 테스트가 별도로 고정한다.)
  const res = classifyFcmSendFailure({
    status: 400,
    errorMessage: "Invalid JSON payload received.",
    errorCodes: ["INVALID_ARGUMENT"],
  });
  assert.equal(res.ok, false);
  assert.equal(res.invalidToken, false);
  assert.ok(res.error && res.error.includes("INVALID_ARGUMENT"));
});

test("400 + FCM 무효 토큰 문구는 무효 토큰이다(revoke 경로)", () => {
  const res = classifyFcmSendFailure({
    status: 400,
    errorMessage: "The registration token is not a valid FCM registration token",
    errorCodes: ["INVALID_ARGUMENT"],
  });
  assert.equal(res.ok, false);
  assert.equal(res.invalidToken, true);
});

test("400 'message is too big' 은 무효 토큰이 아니다", () => {
  const res = classifyFcmSendFailure({
    status: 400,
    errorMessage: "message is too big",
    errorCodes: ["INVALID_ARGUMENT"],
  });
  assert.equal(res.ok, false);
  assert.equal(res.invalidToken, false);
});

test("403 SENDER_ID_MISMATCH 는 서버 설정 오류 — 무효 토큰이 아니다(revoke 금지)", () => {
  const res = classifyFcmSendFailure({
    status: 403,
    errorMessage: "SenderId mismatch",
    errorCodes: ["SENDER_ID_MISMATCH"],
  });
  assert.equal(res.ok, false);
  assert.equal(res.invalidToken, false);
  assert.ok(res.error && res.error.includes("SENDER_ID_MISMATCH"));
});

test("FCM_TRANSPORT_MODE 해석 — 기본·미설정·미지값 전부 dry-run", () => {
  assert.equal(resolveFcmTransportMode(undefined), "dry-run");
  assert.equal(resolveFcmTransportMode(""), "dry-run");
  assert.equal(resolveFcmTransportMode("DRY-RUN"), "dry-run");
  assert.equal(resolveFcmTransportMode("live "), "live");
  assert.equal(resolveFcmTransportMode("live"), "live");
});

test("dry-run transport: 실발송 없이 빌더만 실행하고 주입된 dryRun 결과를 반환한다", async () => {
  let dryRunCalls = 0;
  const transport = createFcmTransport({
    mode: "dry-run",
    projectId: "",
    notificationsByOutboxId: new Map([["outbox-1", notificationRow()]]),
    dryRun: async () => {
      dryRunCalls += 1;
      return { ok: true };
    },
  });
  const res = await transport(
    { id: "d-1", device_token_id: "dt-1", token: "tok-1" },
    outboxRow()
  );
  assert.deepEqual(res, { ok: true });
  assert.equal(dryRunCalls, 1);
});
