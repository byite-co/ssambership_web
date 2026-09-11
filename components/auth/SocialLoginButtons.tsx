"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { buildOAuthRedirectTo, SOCIAL_LOGIN_PROVIDERS, type SocialLoginProvider } from "@/lib/auth/oauthCallbackCore";
import { isSocialLoginRevisionEffective } from "@/lib/legal/socialLoginRevision";

/**
 * 소셜 로그인 3종(카카오 · 구글 · 애플) — `supabase.auth.signInWithOAuth` (PKCE · 콜백 `/auth/callback`).
 *
 * 노출 게이트: 개인정보처리방침 소셜 개정 **시행일(`lib/legal/socialLoginRevision.ts` · 2026-09-11 KST) 전에는 렌더하지
 * 않는다**(null) — 방침 페이지와 같은 상수를 본다(제12조 7일 사전 공지). 로그인·가입 화면의 나머지 동작은 영향 0.
 *
 * 브랜드 버튼은 **공식 배포 에셋만** 쓴다(로고를 코드로 그리지 않는다 · `public/auth/`):
 *  - 카카오: 공식 ko 로그인 버튼 이미지(`kakao_login_wide.png` 600×90) 를 버튼 전체로 렌더 — 위에 텍스트를 겹치지 않는다.
 *  - 구글: 공식 "Sign in with Google" Light · Pill(`google_signin_light_pill.svg` 180×40 · 텍스트가 패스라 폰트 불필요) 를 버튼 전체로.
 *  - 애플: HIG 가 커스텀 버튼을 허용하고 마크만 제공하므로 검정 버튼 + 왼쪽 18×18 공식 Logo Only White(`apple_logo_white.svg` 56×56 ·
 *    검정 배경 rect 포함 — 검정 버튼 위에서 보이지 않아 그대로 둔다) + 라벨.
 * 세 버튼은 컨테이너 높이 48px 고정 · 이미지는 그 안에서 `object-contain`. 에셋 로드 실패 시 텍스트 버튼(공식 색)으로 폴백한다.
 */
type ProviderAsset =
  | { kind: "full"; src: string; alt: string; width: number; height: number }
  | { kind: "mark"; src: string; label: string; width: number; height: number };

const PROVIDER_ASSETS: Record<SocialLoginProvider, ProviderAsset> = {
  kakao: { kind: "full", src: "/auth/kakao_login_wide.png", alt: "카카오로 계속하기", width: 600, height: 90 },
  google: { kind: "full", src: "/auth/google_signin_light_pill.svg", alt: "Google로 로그인", width: 180, height: 40 },
  apple: { kind: "mark", src: "/auth/apple_logo_white.svg", label: "Apple로 계속하기", width: 56, height: 56 },
};

/** 에셋 로드 실패 폴백 — 공식 색만 따르는 텍스트 버튼(카카오 #FEE500/#191919 · 구글 흰/#1F1F1F/#747775 · 애플 검정/흰). */
const FALLBACK_META: Record<SocialLoginProvider, { label: string; className: string }> = {
  kakao: {
    label: "카카오로 계속하기",
    className: "border-[#FEE500] bg-[#FEE500] text-[#191919] hover:brightness-95",
  },
  google: {
    label: "Google로 로그인",
    className: "border-[#747775] bg-white text-[#1F1F1F] hover:bg-slate-50",
  },
  apple: {
    label: "Apple로 계속하기",
    className: "border-black bg-black text-white hover:bg-[#111111]",
  },
};

const FOCUS_RING =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2563EB]";

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
  const [assetFailed, setAssetFailed] = useState<Partial<Record<SocialLoginProvider, true>>>({});

  // 방침 개정 시행일 전 — 렌더하지 않는다(훅 호출 뒤에 두어 훅 순서를 고정).
  if (!isSocialLoginRevisionEffective()) return null;

  function markAssetFailed(provider: SocialLoginProvider) {
    setAssetFailed((prev) => (prev[provider] ? prev : { ...prev, [provider]: true }));
  }

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

  const allDisabled = Boolean(props.disabled) || pending !== null;

  function renderButton(provider: SocialLoginProvider) {
    const asset = PROVIDER_ASSETS[provider];
    const busy = pending === provider;
    const failed = Boolean(assetFailed[provider]);

    // 카카오·구글: 공식 버튼 이미지가 버튼 전체 — 이미지 위에 텍스트를 겹치지 않는다(pending 은 sr-only 로만 알린다).
    if (asset.kind === "full" && !failed) {
      return (
        <button
          key={provider}
          type="button"
          disabled={allDisabled}
          aria-busy={busy || undefined}
          onClick={() => start(provider)}
          className={`flex h-12 w-full items-center justify-center rounded-2xl transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60 ${FOCUS_RING}`}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- 공식 배포 에셋(정적 · 규격 고정 · 최적화 불필요) */}
          <img
            src={asset.src}
            alt={asset.alt}
            width={asset.width}
            height={asset.height}
            draggable={false}
            className="h-full w-full object-contain"
            onError={() => markAssetFailed(provider)}
          />
          {busy ? <span className="sr-only">이동 중…</span> : null}
        </button>
      );
    }

    // 애플: 검정 버튼 + 왼쪽 18×18 공식 마크 + 라벨 (마크 로드 실패 시 라벨만).
    if (asset.kind === "mark") {
      const meta = FALLBACK_META[provider];
      return (
        <button
          key={provider}
          type="button"
          disabled={allDisabled}
          aria-busy={busy || undefined}
          onClick={() => start(provider)}
          className={`inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl border px-4 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-60 ${meta.className} ${FOCUS_RING}`}
        >
          {!failed ? (
            // eslint-disable-next-line @next/next/no-img-element -- 공식 배포 에셋(정적 · 규격 고정 · 최적화 불필요)
            <img
              src={asset.src}
              alt=""
              width={18}
              height={18}
              aria-hidden
              draggable={false}
              className="h-[18px] w-[18px] shrink-0"
              onError={() => markAssetFailed(provider)}
            />
          ) : null}
          <span>{busy ? "이동 중…" : asset.label}</span>
        </button>
      );
    }

    // 에셋 로드 실패 폴백 — 공식 색 텍스트 버튼(카카오·구글).
    const meta = FALLBACK_META[provider];
    return (
      <button
        key={provider}
        type="button"
        disabled={allDisabled}
        aria-busy={busy || undefined}
        onClick={() => start(provider)}
        className={`inline-flex h-12 w-full items-center justify-center rounded-2xl border px-4 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-60 ${meta.className} ${FOCUS_RING}`}
      >
        <span>{busy ? "이동 중…" : meta.label}</span>
      </button>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 text-xs font-semibold text-slate-400">
        <span className="h-px flex-1 bg-slate-200" aria-hidden />
        <span>{props.heading ?? "소셜 계정으로 계속하기"}</span>
        <span className="h-px flex-1 bg-slate-200" aria-hidden />
      </div>
      <div className="grid grid-cols-1 gap-2">{SOCIAL_LOGIN_PROVIDERS.map((provider) => renderButton(provider))}</div>
      {error ? (
        <p className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
