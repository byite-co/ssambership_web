/**
 * 서류 뷰어(`components/admin/DocumentViewer`)의 순수 모델(PR-2 §3).
 *
 * - mimetype 분기: 스토리지 메타데이터(`metadata.mimetype`) → 없으면 확장자로 판정. 이미지 → <img>, PDF → <iframe>.
 *   PDF 가 지금까지 안 보인 원인: 구 화면은 학생증을 무조건 <img src=signedUrl> 로 그려서 application/pdf 응답이
 *   깨진 이미지로 떨어졸다(분석 §3-4). 이 분기가 그 교체다.
 * - 300KB 미만은 "저해상도 · 판독 주의" 배지.
 * - 서명 URL 은 300초(`STUDENT_ID_IMAGE_SIGNED_URL_TTL_SEC`)라 만료 전 재요청이 필요하다.
 *
 * node --test 계약 테스트가 직접 import 하므로 React·`@/` import 를 두지 않는다.
 */

export type DocumentKind = "image" | "pdf" | "unknown";

export const DOCUMENT_LOW_RES_THRESHOLD_BYTES = 300 * 1024;
export const DOCUMENT_LOW_RES_BADGE = "저해상도 · 판독 주의";
export const DOCUMENT_EMPTY_LABEL = "제출된 서류 없음";

/** 서명 URL 만료 판정 여유 — 이 시간 안이면 만료로 보고 미리 재요청한다 */
export const DOCUMENT_SIGNED_URL_SKEW_MS = 20_000;

/** F 단축키 → 뷰어 전체화면 토글. 단축키 핸들러가 window 에 dispatch 하고 뷰어가 듣는다. */
export const DOCUMENT_VIEWER_FULLSCREEN_EVENT = "ssambership:document-viewer:toggle-fullscreen";

export const DOCUMENT_ZOOM_STEPS: readonly number[] = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];
export const DOCUMENT_ZOOM_DEFAULT = 1;

export type DocumentViewerSource = {
  /** 컬럼값(버킷명 포함 경로) — 재요청 키 */
  storedRef: string;
  /** 버킷 접두를 벗긴 객체 경로. 파싱 불가면 null */
  storagePath: string | null;
  signedUrl: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  kind: DocumentKind;
  /** epoch ms. signedUrl 이 없으면 null */
  expiresAt: number | null;
  /** 발급·메타 조회 실패 안내(운영자용, 경로·토큰 미포함) */
  error: string | null;
};

const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "gif", "webp", "bmp", "heic", "heif", "avif"]);

export function fileExtensionOf(path: string | null | undefined): string {
  const m = /\.([A-Za-z0-9]+)(?:[?#].*)?$/.exec(String(path ?? "").trim());
  return m?.[1]?.toLowerCase() ?? "";
}

/** mimetype 우선, 없으면 확장자. 둘 다 모르면 unknown(<iframe> 폴백 + 새 탭 열기). */
export function classifyDocumentKind(mimeType: string | null | undefined, path: string | null | undefined): DocumentKind {
  const mime = String(mimeType ?? "").trim().toLowerCase();
  if (mime.startsWith("image/")) return "image";
  if (mime === "application/pdf" || mime === "application/x-pdf") return "pdf";
  const ext = fileExtensionOf(path);
  if (ext === "pdf") return "pdf";
  if (IMAGE_EXTENSIONS.has(ext)) return "image";
  return "unknown";
}

export function isLowResolutionDocument(sizeBytes: number | null | undefined): boolean {
  return typeof sizeBytes === "number" && Number.isFinite(sizeBytes) && sizeBytes >= 0 && sizeBytes < DOCUMENT_LOW_RES_THRESHOLD_BYTES;
}

export function formatDocumentSize(sizeBytes: number | null | undefined): string {
  if (typeof sizeBytes !== "number" || !Number.isFinite(sizeBytes) || sizeBytes < 0) return "—";
  if (sizeBytes < 1024) return `${sizeBytes}B`;
  if (sizeBytes < 1024 * 1024) return `${Math.round(sizeBytes / 1024)}KB`;
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)}MB`;
}

export function documentKindLabel(kind: DocumentKind): string {
  if (kind === "image") return "이미지";
  if (kind === "pdf") return "PDF";
  return "파일";
}

/** 확대·축소 — 단계표 안에서 한 칸 이동. 표 밖 값은 가장 가까운 단계로 스냅한다. */
export function stepDocumentZoom(current: number, direction: 1 | -1): number {
  const steps = DOCUMENT_ZOOM_STEPS;
  let idx = steps.findIndex((s) => Math.abs(s - current) < 1e-6);
  if (idx < 0) {
    idx = steps.reduce((best, s, i) => (Math.abs(s - current) < Math.abs(steps[best] - current) ? i : best), 0);
  }
  const next = Math.min(steps.length - 1, Math.max(0, idx + direction));
  return steps[next];
}

/** 90도 회전 — 0 → 90 → 180 → 270 → 0 */
export function rotateDocument(currentDeg: number): number {
  const d = ((Math.trunc(currentDeg) % 360) + 360) % 360;
  return (d + 90) % 360;
}

/** 서명 URL 만료(여유 포함) 판정 */
export function isSignedUrlExpired(expiresAt: number | null | undefined, now: number = Date.now(), skewMs: number = DOCUMENT_SIGNED_URL_SKEW_MS): boolean {
  if (typeof expiresAt !== "number" || !Number.isFinite(expiresAt)) return true;
  return now + skewMs >= expiresAt;
}

/** 만료 전 재요청 타이머 지연(ms). 이미 만료면 0. */
export function signedUrlRefreshDelayMs(expiresAt: number | null | undefined, now: number = Date.now(), skewMs: number = DOCUMENT_SIGNED_URL_SKEW_MS): number {
  if (typeof expiresAt !== "number" || !Number.isFinite(expiresAt)) return 0;
  return Math.max(0, expiresAt - skewMs - now);
}
