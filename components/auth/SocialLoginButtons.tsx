"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { buildOAuthRedirectTo, SOCIAL_LOGIN_PROVIDERS, type SocialLoginProvider } from "@/lib/auth/oauthCallbackCore";

/**
 * 소셜 로그인 3종(카카오 · 구글 · 애플) — `supabase.auth.signInWithOAuth` (PKCE · 콜백 `/auth/callback`).
 *
 * 브랜드 버튼은 각 제공자 공식 가이드의 색만 따른다(카카오 #FEE500/#191919 · 구글 흰 바탕 #1F1F1F 글자 ·
 * 애플 검정/흰 글자). **로고는 코드로 그리지 않는다** — 공식 배포 에셋(PNG/SVG)을 `public/auth/` 에 두고
 * 아래 `PROVIDER_LOGO_SRC` 에 경로를 채우면 버튼 앞에 붙는다(현재 null = 텍스트 버튼 · 오너 게이트).
 */
const PROVIDER_LOGO_SRC: Record<SocialLoginProvider, string | null> = {
  kakao: null,
  google: null,
  apple: null,
};

const PROVIDER_META: Record<SocialLoginProvider, { label: string; className: string }> = {
  kakao: {
    label: "카카오로 계속하기",
    className: "border-[#FEE500] bg-[#FEE500] text-[#191919] hover:brightness-95",
  },
  google: {
    label: "Google로 계속하기",
    className: "border-[#747775] bg-white text-[#1F1F1F] hover:bg-slate-50",
  },
  apple: {
    label: "Apple로 계속하기",
    className: "border-black bg-black text-white hover:bg-[#111111]",
  },
};

export function SocialLoginButtons(props: {
  /** 완성 화면 역할 기본값(`role_hint`) — 학생·멘토 로그인 화면의 역할, 가입 화면은 선택값(없으면 생략) */
  roleHint?: "student" | "mentor" | null;
  /** `/login?next=` 전달값 — 안전한 내부 경로만 콜백에 실린다 */
  next?: string | null;
  disabled?: boolean;
  /** 위 구분선 문구 */
  heading?: string;
}) {
  const [pending, setPending] = useState<SocialLoginProvider | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function start(provider: SocialLoginProvider) {
    if (pending || props.disabled) return;
    setError(null);
    setPending(provider);
    try {
      const supabase = createClient();
      const redirectTo = buildOAuthRedirectTo(window.location.origin, { next: props.next ?? null, roleHint: props.roleHint ?? null });
      const { error: oauthError } = await supabase.auth.signInWithOAuth({ provider, options: { redirectTo } });
      if (oauthError) {
        setError("소셜 로그인을 시작하지 못했어요. 잠시 후 다시 시도해 주세요.");
        setPending(null);
      }
      // 성공 시 브라우저가 제공자 페이지로 이동한다 — pending 은 페이지 이탈까지 유지.
    } catch {
      setError("소셜 로그인을 시작하지 못했어요. 잠시 후 다시 시도해 주세요.");
      setPending(null);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 text-xs font-semibold text-slate-400">
        <span className="h-px flex-1 bg-slate-200" aria-hidden />
        <span>{props.heading ?? "소셜 계정으로 계속하기"}</span>
        <span className="h-px flex-1 bg-slate-200" aria-hidden />
      </div>
      <div className="grid grid-cols-1 gap-2">
        {SOCIAL_LOGIN_PROVIDERS.map((provider) => {
          const meta = PROVIDER_META[provider];
          const logo = PROVIDER_LOGO_SRC[provider];
          const busy = pending === provider;
          return (
            <button
              key={provider}
              type="button"
              disabled={Boolean(props.disabled) || pending !== null}
              onClick={() => start(provider)}
              aria-label={meta.label}
              className={`inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl border px-4 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-60 ${meta.className}`}
            >
              {logo ? (
                // eslint-disable-next-line @next/next/no-img-element -- 공식 배포 에셋(정적 · 크기 고정)
                <img src={logo} alt="" width={18} height={18} className="h-[18px] w-[18px]" aria-hidden />
              ) : null}
              <span>{busy ? "이동 중…" : meta.label}</span>
            </button>
          );
        })}
      </div>
      {error ? (
        <p className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
