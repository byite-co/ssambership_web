import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import {
  NICE_VID_COOKIE,
  casLockForProcessing,
  completeIdentityVerification,
  expirePendingIfStale,
  loadVerificationById,
  recoverStuckProcessing,
  resolveAppUrl,
} from "@/lib/identity/service";
import { resolveRequestOrigin } from "@/lib/http/requestOrigin";

// S-C: NICE 표준창 복귀 핸들러 — 팝업(또는 모바일 동일창) 안에서 실행된다.
//
//  - GET/POST 둘 다 수용. vid 는 쿼리 우선, 유실 대비 start 의 httpOnly 쿠키로 이중화.
//  - CAS 락(pending→processing)으로 NICE result 1회성(3033)을 보장 — 락 실패(새로고침 등)는
//    현재 status 기준 결과 HTML 만 반환하고 result API 를 재호출하지 않는다.
//  - 응답 HTML 은 status/code 토큰만 담는다 — enc_data·개인정보는 HTML/URL 에 절대 미포함.
//  - opener 가 있으면 postMessage(복귀 요청의 오리진 한정) 후 close, 없으면(팝업 차단·동일창 진행)
//    /onboarding/verify 로 이동 — 동일창 플로우를 정식 지원한다.
//  - postMessage targetOrigin 은 이 페이지를 서빙한 호스트(= start 호스트 = 부모창 origin)다.
//    고정 APP_URL 을 쓰면 www/apex 가 어긋날 때 부모창이 메시지를 받지 못한다.
//  - 무음 조기종료 분기는 [identity/return] early-exit 로그를 남긴다(vid·code·host 만, 개인정보 없음).

type PopupResult = { status: string; code: string };

function sanitizeToken(value: string | null | undefined, fallback: string): string {
  const t = (value ?? "").trim();
  return /^[A-Za-z0-9_.\-]{1,64}$/.test(t) ? t : fallback;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function headlineFor(status: string): { title: string; sub: string } {
  if (status === "verified") return { title: "인증이 완료되었습니다", sub: "이 창은 자동으로 닫힙니다." };
  if (status === "expired") return { title: "인증 시간이 초과되었습니다", sub: "창이 닫히면 다시 시도해 주세요." };
  if (status === "processing") return { title: "인증 결과를 처리 중입니다", sub: "잠시 후 온보딩 화면에서 상태를 확인해 주세요." };
  if (status === "closed") return { title: "인증이 취소되었습니다", sub: "이 창은 자동으로 닫힙니다." };
  return { title: "인증을 완료하지 못했습니다", sub: "창이 닫히면 안내에 따라 다시 시도해 주세요." };
}

function htmlResponse(result: PopupResult, appOrigin: string): Response {
  const status = sanitizeToken(result.status, "failed");
  const code = sanitizeToken(result.code, "UNKNOWN");
  const fallbackPath = `/onboarding/verify?status=${encodeURIComponent(status)}&code=${encodeURIComponent(code)}`;
  const payload = JSON.stringify({ type: "nice-identity", status, code });
  const { title, sub } = headlineFor(status);

  const html = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex" />
<title>본인인증</title>
<style>
  body { margin: 0; font-family: -apple-system, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif; background: #F9FAFB; color: #111827; display: flex; min-height: 100vh; align-items: center; justify-content: center; }
  .card { text-align: center; padding: 32px 24px; }
  .title { font-size: 18px; font-weight: 700; margin-bottom: 8px; }
  .sub { font-size: 14px; color: #6B7280; margin-bottom: 20px; }
  .link { font-size: 14px; color: #1A56DB; text-decoration: underline; }
</style>
</head>
<body>
  <div class="card">
    <p class="title">${escapeHtml(title)}</p>
    <p class="sub">${escapeHtml(sub)}</p>
    <a class="link" href="${escapeHtml(fallbackPath)}">창이 닫히지 않으면 여기를 눌러 계속하기</a>
  </div>
  <script>
    (function () {
      var payload = ${payload};
      var fallback = ${JSON.stringify(fallbackPath)};
      var origin = ${JSON.stringify(appOrigin)};
      try {
        if (window.opener && !window.opener.closed && origin) {
          window.opener.postMessage(payload, origin);
          window.close();
          setTimeout(function () { window.location.replace(fallback); }, 600);
          return;
        }
      } catch (e) {}
      window.location.replace(fallback);
    })();
  </script>
</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

/** postMessage targetOrigin — 복귀 요청의 오리진(허용목록) 우선, 아니면 APP_URL 폴백. */
function resolvePopupOrigin(req: NextRequest): string {
  const fromRequest = resolveRequestOrigin(req.headers, { allowLocalhost: process.env.NODE_ENV !== "production" });
  if (fromRequest) return fromRequest;
  try {
    return new URL(resolveAppUrl()).origin;
  } catch {
    return "";
  }
}

function requestHost(req: NextRequest): string | null {
  return req.headers.get("x-forwarded-host") ?? req.headers.get("host");
}

async function handleReturn(req: NextRequest, bodyParams: URLSearchParams | null): Promise<Response> {
  const query = req.nextUrl.searchParams;
  const appOrigin = resolvePopupOrigin(req);
  const host = requestHost(req);
  const earlyExit = (code: string, vid: string | null): void => {
    console.error("[identity/return] early-exit", { code, vid, host });
  };
  const pick = (key: string): string | null => {
    const q = query.get(key);
    if (q && q.trim()) return q.trim();
    const b = bodyParams?.get(key);
    if (b && b.trim()) return b.trim();
    return null;
  };

  const webTransactionId = pick("web_transaction_id");
  // close_url 경유(사용자 취소) — 인증 데이터가 없으면 취소 안내만
  if (!webTransactionId && query.get("close") === "1") {
    return htmlResponse({ status: "closed", code: "CLOSED" }, appOrigin);
  }
  if (!webTransactionId) {
    // 파라미터 키 이름만 로그(값 로그 금지)
    console.error("[identity/return] web_transaction_id 부재", { queryKeys: [...query.keys()], host });
    return htmlResponse({ status: "failed", code: "MISSING_WEB_TX" }, appOrigin);
  }

  const vid = pick("vid") ?? req.cookies.get(NICE_VID_COOKIE)?.value?.trim() ?? null;
  if (!vid) {
    earlyExit("MISSING_VID", null);
    return htmlResponse({ status: "failed", code: "MISSING_VID" }, appOrigin);
  }

  // 팝업 세션 유저와 행 소유자 일치 검증
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  const sessionUserId = auth?.user?.id ?? null;
  if (!sessionUserId) {
    earlyExit("NO_SESSION", vid);
    return htmlResponse({ status: "failed", code: "NO_SESSION" }, appOrigin);
  }

  const admin = createServiceRoleClient();
  const row = await loadVerificationById(admin, vid);
  if (!row) {
    earlyExit("NOT_FOUND", vid);
    return htmlResponse({ status: "failed", code: "NOT_FOUND" }, appOrigin);
  }
  if (row.user_id !== sessionUserId) {
    earlyExit("FORBIDDEN", vid);
    return htmlResponse({ status: "failed", code: "FORBIDDEN" }, appOrigin);
  }

  if (await expirePendingIfStale(admin, row)) {
    earlyExit("PENDING_TIMEOUT", vid);
    return htmlResponse({ status: "expired", code: "PENDING_TIMEOUT" }, appOrigin);
  }

  const locked = await casLockForProcessing(admin, vid);
  if (!locked) {
    // 중복 실행(새로고침 등) — 현재 status 기준 결과만 반환, result API 재호출 금지(3033 예방)
    const current = await loadVerificationById(admin, vid);
    if (!current) {
      earlyExit("NOT_FOUND", vid);
      return htmlResponse({ status: "failed", code: "NOT_FOUND" }, appOrigin);
    }
    if (current.status === "verified") {
      earlyExit("ALREADY_DONE", vid);
      return htmlResponse({ status: "verified", code: "ALREADY_DONE" }, appOrigin);
    }
    if (current.status === "processing") {
      if (await recoverStuckProcessing(admin, current)) {
        earlyExit("STUCK_PROCESSING", vid);
        return htmlResponse({ status: "failed", code: "STUCK_PROCESSING" }, appOrigin);
      }
      earlyExit("IN_PROGRESS", vid);
      return htmlResponse({ status: "processing", code: "IN_PROGRESS" }, appOrigin);
    }
    if (current.status === "expired") {
      return htmlResponse({ status: "expired", code: sanitizeToken(current.failure_code, "PENDING_TIMEOUT") }, appOrigin);
    }
    if (current.status === "failed") {
      return htmlResponse({ status: "failed", code: sanitizeToken(current.failure_code, "UNKNOWN") }, appOrigin);
    }
    // pending 인데 CAS 만 진 레이스 — 다른 실행이 진행 중
    earlyExit("IN_PROGRESS", vid);
    return htmlResponse({ status: "processing", code: "IN_PROGRESS" }, appOrigin);
  }

  const outcome = await completeIdentityVerification(admin, { row: locked, webTransactionId });
  if (outcome.code === "INTEGRITY_FAIL") {
    earlyExit("INTEGRITY_FAIL", vid);
  }
  return htmlResponse(outcome, appOrigin);
}

export async function GET(req: NextRequest) {
  return handleReturn(req, null);
}

export async function POST(req: NextRequest) {
  let bodyParams: URLSearchParams | null = null;
  const contentType = req.headers.get("content-type") ?? "";
  try {
    if (contentType.includes("application/json")) {
      const json = (await req.json()) as unknown;
      bodyParams = new URLSearchParams();
      if (json && typeof json === "object") {
        for (const [key, value] of Object.entries(json as Record<string, unknown>)) {
          if (typeof value === "string") bodyParams.set(key, value);
        }
      }
    } else {
      const form = await req.formData();
      bodyParams = new URLSearchParams();
      for (const [key, value] of form.entries()) {
        if (typeof value === "string") bodyParams.set(key, value);
      }
    }
  } catch {
    bodyParams = null;
  }
  return handleReturn(req, bodyParams);
}
