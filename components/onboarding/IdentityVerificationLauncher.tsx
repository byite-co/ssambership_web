"use client";

// S-C: NICE 표준창 런처 + 결과 수신 (온보딩 본인/보호자 공용).
//
//  - 버튼 클릭 핸들러에서 **동기로** window.open(user gesture 보존 — 특히 보호자 2차 인증)
//    후 /api/identity/start 응답의 authUrl 로 팝업을 이동시킨다.
//  - 팝업이 차단되면 동일창으로 진행한다(return 이 동일창 복귀를 정식 지원).
//  - postMessage 수신은 event.origin === 현재 origin(APP_ORIGIN) 검증 필수.
//    수신 후 서버 상태 재조회(router.refresh)로 게이트 해제/보호자 분기를 서버가 판정한다.

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  identityResultView,
  identityStartErrorView,
  type IdentityResultView,
} from "@/components/onboarding/identityResultMessages";

const POPUP_NAME = "authNiceWeb";
const POPUP_FEATURES =
  "width=480, height=812, top=100, fullscreen=no, menubar=no, status=no, titlebar=yes, location=no, toolbar=no, scrollbar=no";

type Props = {
  kind: "self" | "guardian";
  startLabel: string;
  /** 동일창 복귀(/onboarding/verify?status=..&code=..)로 전달된 초기 결과 */
  initialStatus?: string | null;
  initialCode?: string | null;
};

const toneClass: Record<IdentityResultView["tone"], string> = {
  success: "border-emerald-200 bg-emerald-50 text-emerald-800",
  error: "border-red-200 bg-red-50 text-red-700",
  info: "border-blue-200 bg-blue-50 text-blue-800",
};

export function IdentityVerificationLauncher({ kind, startLabel, initialStatus, initialCode }: Props) {
  const router = useRouter();
  const [launching, setLaunching] = useState(false);
  const [result, setResult] = useState<IdentityResultView | null>(() =>
    identityResultView(initialStatus ?? null, initialCode ?? null)
  );
  const refreshTimer = useRef<number | null>(null);

  const scheduleRefresh = useCallback(() => {
    if (refreshTimer.current !== null) return;
    refreshTimer.current = window.setTimeout(() => {
      refreshTimer.current = null;
      router.refresh();
    }, 700);
  }, [router]);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      // APP_ORIGIN 검증 필수 — return 팝업은 같은 origin 에서만 postMessage 한다.
      if (event.origin !== window.location.origin) return;
      const data = event.data as { type?: unknown; status?: unknown; code?: unknown } | null;
      if (!data || data.type !== "nice-identity") return;
      const status = typeof data.status === "string" ? data.status : null;
      const code = typeof data.code === "string" ? data.code : null;
      setResult(identityResultView(status, code));
      if (status === "verified") {
        // 서버 상태 재조회 — verified 면 홈으로, 14세 미만이면 보호자 페이지로 서버가 리다이렉트
        scheduleRefresh();
      }
    }
    window.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener("message", onMessage);
      if (refreshTimer.current !== null) {
        window.clearTimeout(refreshTimer.current);
        refreshTimer.current = null;
      }
    };
  }, [scheduleRefresh]);

  // 동일창 복귀로 verified 가 온 경우도 서버 재판정으로 이동시킨다.
  useEffect(() => {
    if ((initialStatus ?? null) === "verified") {
      scheduleRefresh();
    }
  }, [initialStatus, scheduleRefresh]);

  const launch = useCallback(async () => {
    if (launching) return;
    setLaunching(true);
    setResult(null);
    // 클릭 핸들러 안에서 동기 open — user gesture 를 잃지 않는다.
    const popup = window.open("about:blank", POPUP_NAME, POPUP_FEATURES);
    try {
      const res = await fetch("/api/identity/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind }),
      });
      const json = (await res.json().catch(() => null)) as
        | { ok?: boolean; authUrl?: unknown; error?: unknown; message?: unknown }
        | null;
      if (!res.ok || !json?.ok || typeof json.authUrl !== "string") {
        popup?.close();
        setResult(
          identityStartErrorView(
            typeof json?.error === "string" ? json.error : null,
            typeof json?.message === "string" ? json.message : null
          )
        );
        return;
      }
      if (popup && !popup.closed) {
        popup.location.replace(json.authUrl);
      } else {
        // 팝업 차단 — 동일창 진행 (return 라우트가 /onboarding/verify 로 복귀시킨다)
        window.location.assign(json.authUrl);
      }
    } catch {
      popup?.close();
      setResult({
        tone: "error",
        title: "인증을 시작하지 못했어요",
        description: "네트워크 상태를 확인한 뒤 다시 시도해 주세요.",
        action: "retry",
      });
    } finally {
      setLaunching(false);
    }
  }, [kind, launching]);

  return (
    <div className="flex flex-col gap-4">
      {result ? (
        <div className={`rounded-xl border px-4 py-3 text-sm ${toneClass[result.tone]}`} role="status">
          <p className="font-semibold">{result.title}</p>
          <p className="mt-1">{result.description}</p>
          {result.action === "login_existing" ? (
            <p className="mt-2">
              <Link href="/login" className="font-semibold underline">
                기존 계정으로 로그인하기
              </Link>
            </p>
          ) : null}
          {result.action === "guardian" ? (
            <p className="mt-2">
              <Link href="/onboarding/guardian" className="font-semibold underline">
                보호자 인증으로 이동
              </Link>
            </p>
          ) : null}
        </div>
      ) : null}
      <button
        type="button"
        onClick={launch}
        disabled={launching}
        className="inline-flex w-full items-center justify-center rounded-xl bg-[#1A56DB] px-4 py-3 text-sm font-bold text-white transition hover:bg-[#164fc0] disabled:cursor-not-allowed disabled:opacity-60"
      >
        {launching ? "인증 창을 여는 중..." : startLabel}
      </button>
      <p className="text-center text-xs text-slate-500">
        본인 명의 휴대폰이 필요해요. 인증 창(팝업)이 열리지 않으면 팝업 차단을 해제해 주세요 — 차단 상태에서는
        현재 창에서 이어서 진행돼요.
      </p>
    </div>
  );
}
