// 숏폼 finalize 액션의 FormData 계약 — 순수 모듈(node/브라우저/테스트 공용).
//
// 허용 키 10종의 "문자열 값"만 사용한다. File/Blob 등 비문자 엔트리는 신뢰하지 않는다
// (클라 쪽에서 video picker input 에 name 을 주지 않아 구조적으로 폼 제출에 실리지 않고,
//  서버 쪽에서도 문자열이 아닌 값은 빈 값으로 취급한다 — 이중 안전망).

export const SHORTFORM_SUBMIT_ALLOWED_KEYS = [
  "title",
  "category",
  "body",
  "source",
  "rightsAck",
  "draftId",
  "videoUrl",
  "videoRef",
  "requestId",
  "intent",
] as const;

export type ShortformSubmitIntent = "draft" | "publish";

export type ShortformSubmitFields = {
  intent: ShortformSubmitIntent;
  title: string;
  category: string;
  body: string;
  source: string;
  rightsAck: boolean;
  draftId: string;
  videoUrl: string;
  videoRef: string;
  requestId: string;
};

/**
 * intent 해석: `getAll("intent")` 값들 중 첫 번째 유효값("draft"|"publish")을 채택한다.
 * - JS 활성 경로: hidden input 1개(캡처된 intent)만 존재.
 * - JS 비활성(점진 향상) 경로: submitter 버튼 값 + 빈 hidden 값이 함께 올 수 있다 —
 *   빈 문자열·비문자는 건너뛰므로 어느 순서로 와도 실제 클릭 의도가 보존된다.
 * - 유효값이 하나도 없으면 publish(기존 기본값 유지).
 */
export function resolveShortformIntent(values: unknown[]): ShortformSubmitIntent {
  for (const v of values) {
    if (v === "draft" || v === "publish") return v;
  }
  return "publish";
}

function trimmed(formData: FormData, key: string): string {
  const v = formData.get(key);
  return typeof v === "string" ? v.trim() : "";
}

/** 허용 키만 문자열로 추출한다(비문자 엔트리는 빈 값 취급 — File 이 값이 될 수 없다). */
export function extractShortformSubmitFields(formData: FormData): ShortformSubmitFields {
  const rawCategory = formData.get("category");
  return {
    intent: resolveShortformIntent(formData.getAll("intent")),
    title: trimmed(formData, "title"),
    // 기존 계약 유지: 값이 아예 없으면 "study"(빈 문자열 제출은 그대로 통과 → DB 검증 위임).
    category: typeof rawCategory === "string" ? rawCategory : "study",
    body: trimmed(formData, "body"),
    source: trimmed(formData, "source"),
    rightsAck: formData.get("rightsAck") === "on",
    draftId: trimmed(formData, "draftId"),
    videoUrl: trimmed(formData, "videoUrl"),
    videoRef: trimmed(formData, "videoRef"),
    requestId: trimmed(formData, "requestId"),
  };
}

/** FormData 안에 문자열이 아닌 엔트리(File/Blob)가 있는지 — 계약 테스트·감사용. */
export function formDataHasBinaryEntry(formData: FormData): boolean {
  for (const value of formData.values()) {
    if (typeof value !== "string") return true;
  }
  return false;
}
