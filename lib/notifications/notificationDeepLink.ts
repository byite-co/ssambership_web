import { safeInternalNextPath } from "@/lib/auth/getPostLoginPath";
import type { AppRole } from "@/lib/types/user";

type Row = Record<string, unknown>;

// W4(C10): row 최상위 URL 후보 키 7종 스캔 삭제 — notifications 에 해당 컬럼이 없다(187 baseline
// 실측). 정본 링크 위치는 metadata->>'link' / data->>'link' (132 정본 writer 가 양쪽에 기록).
function linkFromJsonField(v: unknown): string | null {
  if (v == null || typeof v !== "object") return null;
  const s = (v as Record<string, unknown>).link;
  if (typeof s === "string" && s.startsWith("/")) {
    const safe = safeInternalNextPath(s.trim());
    if (safe) return safe;
  }
  return null;
}

function pickId(row: Row, keys: string[]): string | null {
  for (const k of keys) {
    const v = row[k];
    if (typeof v === "string" && v.length > 4) return v;
  }
  return null;
}

/**
 * 알림 한 줄 + 역할 → 이동할 경로(placeholder 가능)
 */
export function resolveNotificationHref(row: Row, role: AppRole, typeHint: string | null): string {
  for (const k of ["metadata", "data"] as const) {
    const nested = linkFromJsonField(row[k]);
    if (nested) return nested;
  }

  const tKey = (typeHint ?? "").toLowerCase();
  if (tKey === "question_answered") {
    const roomId = pickId(row, ["room_id", "question_room_id"]);
    const threadId = pickId(row, ["thread_id", "question_thread_id"]);
    if (roomId) {
      const qs = threadId ? `?thread=${encodeURIComponent(threadId)}` : "";
      return role === "mentor" ? `/mentor/question-room/${roomId}${qs}` : `/question-room/${roomId}${qs}`;
    }
    return role === "mentor" ? "/mentor/question-room" : "/question-room";
  }
  if (tKey === "new_application") {
    const postId = pickId(row, ["post_id", "custom_request_post_id", "request_id"]);
    if (postId) return `/custom-request/${postId}/applications/waiting`;
    return "/custom-request/posts";
  }
  if (tKey === "new_order_message") {
    const orderId = pickId(row, ["order_id", "custom_order_id", "custom_request_order_id", "request_order_id"]);
    if (orderId) return `/custom-request/orders/${orderId}`;
    return "/custom-request";
  }

  // W4(C10): 레거시(이벤트 타입 없는 행) 휴리스틱은 유지하되, 실존 컬럼(type, body)만 읽는다.
  const t = [
    typeHint ?? "",
    typeof row.type === "string" ? row.type : "",
    typeof row.body === "string" ? row.body : "",
  ]
    .join(" ")
    .toLowerCase();

  const orderId = pickId(row, ["order_id", "custom_order_id", "request_order_id", "entity_id"]);
  if (orderId && /order|request|custom/.test(t)) {
    return `/custom-request/orders/${orderId}`;
  }

  const roomForQna = pickId(row, [
    "room_id",
    "roomId",
    "question_room_id",
    "questionRoomId",
    "qna_room_id",
    "qnaRoomId",
  ]);
  if (
    roomForQna &&
    /(thread|qna|question|answer|room|채팅|답변|질문)/.test(t) &&
    !/(custom|order|request|의뢰|맞춤)/.test(t)
  ) {
    if (role === "mentor") {
      return `/mentor/question-room/${roomForQna}`;
    }
    if (role === "student") {
      return `/question-room/${roomForQna}`;
    }
    if (role === "admin") {
      return "/admin";
    }
  }

  if (/(thread|qna|question|answer|room|채팅|답변)/.test(t)) {
    if (role === "mentor") {
      return "/mentor/question-room";
    }
    if (role === "admin") {
      return "/admin";
    }
    return "/question-room";
  }
  if (/(subscri|payment|pay|wallet|캐시|결제|구독|영수|환불)/.test(t)) {
    if (role === "mentor") {
      return "/mentor/payouts";
    }
    if (role === "admin") {
      return "/admin/refunds";
    }
    return "/wallet/charge";
  }
  if (/(subscribe|플랜)/.test(t) && role === "student") {
    return "/mentors";
  }
  if (/(custom|request|의뢰|맞춤)/.test(t)) {
    if (orderId) return `/custom-request/orders/${orderId}`;
    return "/custom-request";
  }
  if (/(notice|공지|promo|프로모|announce|이벤트|site)/.test(t)) {
    return "/";
  }
  if (/(dispute|분쟁|report|신고|신고|review)/.test(t)) {
    const did = pickId(row, ["dispute_id", "disputeId", "report_id", "reportId"]);
    if (role === "admin" && did) {
      return `/admin/disputes/${did}`;
    }
    if (role === "mentor" && did) {
      return `/mentor/support/disputes/${did}`;
    }
    if (role === "student" && did) {
      return `/support/disputes/${did}`;
    }
    if (role === "student") {
      return "/support/disputes";
    }
    if (role === "mentor") {
      return "/mentor/support/disputes";
    }
  }
  if (role === "admin") {
    return "/admin";
  }
  return role === "mentor" ? "/mentor/mypage" : "/mypage";
}

/** 유형 키 → 배지 문구(예시) */
export function typeBadgeLabel(typeKey: string | null): { label: string; variant: string } {
  if (!typeKey) return { label: "기타", variant: "slate" };
  const s = typeKey.toLowerCase();
  if (/(qna|question|thread|answer|room|답변|질문|question_answered)/.test(s)) {
    return { label: "질문방", variant: "emerald" };
  }
  if (/(new_application|application|지원)/.test(s)) {
    return { label: "맞춤의뢰", variant: "violet" };
  }
  if (/(new_order_message|order_message|주문방)/.test(s)) {
    return { label: "주문방", variant: "violet" };
  }
  if (/(subscri|payment|pay|wallet|결제|구독|캐시)/.test(s)) {
    return { label: "구독/결제", variant: "blue" };
  }
  if (/(custom|request|order|의뢰|맞춤)/.test(s)) {
    return { label: "맞춤의뢰", variant: "violet" };
  }
  if (/(notice|promo|announce|event|공지|프로모)/.test(s)) {
    return { label: "공지/프로모", variant: "amber" };
  }
  if (/(dispute|report|abuse|분쟁|신고)/.test(s)) {
    return { label: "신고/분쟁", variant: "red" };
  }
  if (s.length > 20) {
    return { label: "알림", variant: "slate" };
  }
  return { label: typeKey, variant: "slate" };
}
