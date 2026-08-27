// App-F1(푸시 재도입, 2026-08) — FCM HTTP v1 transport (PUSH 지시문 B-2).
// firebase-admin 금지: google-auth-library JWT + fetch 만 사용(번들·콜드스타트·"firebase" 표면 최소화).
// 순수 함수(buildFcmMessage · classifyFcmSendFailure · splitGatedOutboxRows)는
// lib/notifications/__contract__/fcmMessage.contract.test.ts 의 node:test 대상(네트워크 0)이므로
// 이 파일의 런타임 value import 는 node 단독 실행에서 해석 가능한 것만 둔다
// (outboxWorker 는 "@/" alias 를 쓰므로 type-only import 만 허용).
// ★ 시크릿 금지: FCM_SERVICE_ACCOUNT_JSON_B64 원문·액세스 토큰·기기 토큰 전문·제목·본문을
//   어떤 로그·오류 문자열에도 싣지 않는다(B-3 로그 규칙).

import { isInvalidTokenError } from "./outboxBackoff.ts";
import type { OutboxRow, OutboxTransport, TransportResult } from "./outboxWorker.ts";

/** claim RPC 는 SETOF notification_outbox — 런타임 행에는 전 컬럼이 있고,
 *  transport 는 OutboxRow 외에 notification_id/event_key 를 추가로 읽는다(2026-08-27 DB 실측). */
export type OutboxRowForPush = OutboxRow & {
  notification_id?: string | null;
  event_key?: string | null;
};

/** notifications 행 중 푸시 메시지 구성에 쓰는 부분(F15: data 에 title, metadata 에 id 3종). */
export type NotificationRowForPush = {
  body: string | null;
  data: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
};

/** 앱 미노출 게이트 2종(F19) — 앱 notification_types.dart kGatedNotificationTypeCodes 와 동일 값.
 *  앱 알림함(목록·unread RPC)에서 제외되는 유형은 푸시로도 보내지 않는다(정책 정합).
 *  claim 직후 이 유형은 즉시 notification_outbox_mark_sent 처리하고 발송 대상에서 제외한다(B-3). */
export const GATED_PUSH_EVENT_TYPES: ReadonlySet<string> = new Set([
  "new_order_message",
  "new_application",
]);

/** claim 결과 분리(순수): gated = 발송 제외(즉시 sent 처리 대상) / sendable = 발송 파이프라인 진행. */
export function splitGatedOutboxRows<T extends { event_type: string }>(
  rows: readonly T[]
): { gated: T[]; sendable: T[] } {
  const gated: T[] = [];
  const sendable: T[] = [];
  for (const row of rows) {
    (GATED_PUSH_EVENT_TYPES.has(row.event_type) ? gated : sendable).push(row);
  }
  return { gated, sendable };
}

export type FcmMessage = {
  message: {
    token: string;
    notification: { title: string; body: string };
    data: Record<string, string>;
    android: { priority: "high"; notification: { channel_id: "ssambership_default" } };
    apns: { headers: { "apns-priority": "10" }; payload: { aps: { sound: "default" } } };
  };
};

/** 비어 있지 않은 문자열만 통과(그 외 = 키 생략). 빈 문자열 금지 — 앱은 빈/부재를 null 로 취급. */
function nonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** FCM v1 메시지 순수 빌더(B-2 계약, 계약테스트 대상).
 *  - data 값은 전부 문자열, 없는 값은 키 자체를 생략한다.
 *  - data 키는 {type, notification_id, event_key, room_id, thread_id, question_id} 밖을 만들지 않는다.
 *  - link/url 은 넣지 않는다(앱 PushPayload 가 버린다).
 *  - type 은 outbox.event_type(정본 18종 코드) 그대로. */
export function buildFcmMessage(args: {
  token: string;
  outbox: OutboxRowForPush;
  notification: NotificationRowForPush;
}): FcmMessage {
  const { token, outbox, notification } = args;
  const metadata = notification.metadata ?? {};

  const data: Record<string, string> = {};
  const put = (key: string, value: unknown) => {
    const s = nonEmptyString(value);
    if (s !== undefined) data[key] = s;
  };
  put("type", outbox.event_type);
  put("notification_id", outbox.notification_id);
  put("event_key", outbox.event_key);
  put("room_id", (metadata as Record<string, unknown>)["room_id"]);
  put("thread_id", (metadata as Record<string, unknown>)["thread_id"]);
  put("question_id", (metadata as Record<string, unknown>)["question_id"]);

  return {
    message: {
      token,
      notification: {
        title: nonEmptyString((notification.data ?? {})["title"]) ?? "쌤버십",
        body: nonEmptyString(notification.body) ?? "",
      },
      data,
      android: { priority: "high", notification: { channel_id: "ssambership_default" } },
      apns: { headers: { "apns-priority": "10" }, payload: { aps: { sound: "default" } } },
    },
  };
}

/** FCM v1 비-2xx 응답 → 실패 TransportResult 정규화(순수, 계약테스트 대상).
 *  판정 우선순위(B-2 — 400 INVALID_ARGUMENT 를 무효 토큰으로 오분류하지 않기 위한 순서):
 *  ① 404 또는 details[].errorCode UNREGISTERED → invalidToken:true (무효 확정 → revoke 경로)
 *  ② 429/5xx → invalidToken:false (backoff 재시도)
 *  ③ 그 외 → isInvalidTokenError(합성 문자열) */
export function classifyFcmSendFailure(args: {
  status: number;
  errorMessage?: string | null;
  errorCodes?: readonly string[];
}): TransportResult {
  const { status } = args;
  const errorCodes = args.errorCodes ?? [];
  const error = [`fcm_status_${status}`, args.errorMessage ?? "", ...errorCodes]
    .filter((part) => part.length > 0)
    .join(" | ");
  const invalidToken =
    status === 404 || errorCodes.includes("UNREGISTERED")
      ? true
      : status === 429 || status >= 500
        ? false
        : isInvalidTokenError(error);
  return { ok: false, invalidToken, error };
}

export type FcmTransportMode = "dry-run" | "live";

/** FCM_TRANSPORT_MODE 해석 — 'live' 정확 일치만 live, 미설정·그 외 전부 dry-run(기본, B-0). */
export function resolveFcmTransportMode(raw: string | null | undefined): FcmTransportMode {
  return raw?.trim() === "live" ? "live" : "dry-run";
}

type ServiceAccountKey = { client_email: string; private_key: string };

function readServiceAccountKey(): ServiceAccountKey {
  const b64 = process.env.FCM_SERVICE_ACCOUNT_JSON_B64?.trim();
  if (!b64) throw new Error("FCM_SERVICE_ACCOUNT_JSON_B64 is not set");
  let parsed: Partial<ServiceAccountKey>;
  try {
    parsed = JSON.parse(Buffer.from(b64, "base64").toString("utf8")) as Partial<ServiceAccountKey>;
  } catch {
    // 원문(시크릿)을 오류에 싣지 않는다.
    throw new Error("FCM_SERVICE_ACCOUNT_JSON_B64 is not valid base64 JSON");
  }
  if (!parsed.client_email || !parsed.private_key) {
    throw new Error("FCM service account key: client_email/private_key missing");
  }
  return { client_email: parsed.client_email, private_key: parsed.private_key };
}

const FCM_OAUTH_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";

/** 액세스 토큰 모듈 스코프 캐시 — 만료 60초 전 갱신(B-2). 값은 로그 금지. */
let cachedAccessToken: { token: string; expiresAtMs: number } | null = null;

async function getFcmAccessToken(): Promise<string> {
  const now = Date.now();
  if (cachedAccessToken && now < cachedAccessToken.expiresAtMs - 60_000) {
    return cachedAccessToken.token;
  }
  // live 경로에서만 로드(dry-run 콜드스타트 비용 0 + node:test 가 이 모듈을 import 해도 무부담).
  const { JWT } = await import("google-auth-library");
  const key = readServiceAccountKey();
  const jwt = new JWT({ email: key.client_email, key: key.private_key, scopes: [FCM_OAUTH_SCOPE] });
  const credentials = await jwt.authorize();
  const token = credentials.access_token;
  if (!token) throw new Error("FCM auth: empty access token");
  cachedAccessToken = {
    token,
    expiresAtMs: credentials.expiry_date ?? now + 5 * 60_000,
  };
  return token;
}

/** outbox 별 FCM transport 생성(B-3 이 주입).
 *  - notificationsByOutboxId: claim 래퍼가 outbox 1건당 1회 조회로 확보한 notifications 행.
 *  - dryRun: 기존 dryRunTransport 를 라우트가 주입(재사용 — 이 모듈은 outboxWorker 를 value import 하지 않는다).
 *  - dry-run 이어도 빌더는 실행해 형식 오류를 로그로 남긴다(발송 0). */
export function createFcmTransport(opts: {
  mode: FcmTransportMode;
  projectId: string;
  notificationsByOutboxId: ReadonlyMap<string, NotificationRowForPush>;
  dryRun: OutboxTransport;
  log?: (msg: string, meta?: Record<string, unknown>) => void;
}): OutboxTransport {
  return async (delivery, outbox) => {
    const notification = opts.notificationsByOutboxId.get(outbox.id);
    if (!notification) {
      // claim 래퍼가 notifications 부재 outbox 를 이미 sent 처리·제외하므로 도달하지 않는 방어선.
      return { ok: false, invalidToken: false, error: "notification_row_missing" };
    }

    let message: FcmMessage;
    try {
      message = buildFcmMessage({ token: delivery.token, outbox: outbox as OutboxRowForPush, notification });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      opts.log?.("[notification-outbox] fcm_message_build_failed", {
        outboxId: outbox.id,
        eventType: outbox.event_type,
        error: msg,
      });
      return { ok: false, invalidToken: false, error: `fcm_message_build_failed: ${msg}` };
    }

    if (opts.mode !== "live") {
      return opts.dryRun(delivery, outbox);
    }

    try {
      const accessToken = await getFcmAccessToken();
      const res = await fetch(
        `https://fcm.googleapis.com/v1/projects/${opts.projectId}/messages:send`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify(message),
        }
      );
      if (res.ok) return { ok: true };

      let errorMessage: string | undefined;
      let errorCodes: string[] = [];
      try {
        const body = (await res.json()) as {
          error?: { message?: string; details?: Array<{ errorCode?: string }> };
        };
        errorMessage = body.error?.message;
        errorCodes = (body.error?.details ?? [])
          .map((d) => d.errorCode)
          .filter((c): c is string => typeof c === "string");
      } catch {
        // 본문 파싱 실패 — status 만으로 판정한다.
      }
      return classifyFcmSendFailure({ status: res.status, errorMessage, errorCodes });
    } catch (e) {
      // 네트워크·인증 예외도 실패로 정규화(throw 금지 — outbox backoff 재시도, B-2).
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, invalidToken: false, error: `fcm_send_exception: ${msg}` };
    }
  };
}
