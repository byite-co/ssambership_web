import Link from "next/link";
import React from "react";
import { FileText, CalendarDays, Wallet, Bell, ShieldAlert, type LucideIcon } from "lucide-react";
import { SURFACE_CARD, PAGE_COL_GAP } from "@/lib/ui/surfaceCard";
import { MobileNavTabs } from "@/components/common/MobileNavTabs";

interface UserLike {
  email?: string | null;
}
interface ProfileLike {
  full_name?: string | null;
  nickname?: string | null;
  email?: string | null;
  grade_level?: string | null;
  student_status?: string | null;
}

type Props = {
  activeTab: "home" | "subscriptions" | "wallet" | "questions" | "custom" | "notifications" | "support";
  user: UserLike | null;
  profile: ProfileLike | null;
  profileLoadError: string | null;
  /** ledgerPreview 없을 때 우측 간단 캐시 카드용 */
  cashBalanceKrw?: number;
  /** 좌측 프로필 아래 미니 학습 요약 */
  learningSummary?: {
    roomCount: number;
    activeMentorCount: number;
    paymentCount: string;
  };
  /** 우측 결제·캐시 최근 내역 */
  ledgerPreview?: React.ReactNode;
  /** 우측 결제·캐시 레일 숨김(중앙 2컬럼 확장) — 캐시 사용내역처럼 우측 박스가 중복인 페이지 전용 */
  hideRightRail?: boolean;
  children: React.ReactNode;
};

/** 상단 AppShell 네비와 겹치지 않는 보조 메뉴만 유지 (아이콘은 lucide로 통일) */
const NAV_ITEMS: { tab: Props["activeTab"]; href: string; label: string; Icon: LucideIcon }[] = [
  { tab: "home", href: "/mypage", label: "마이페이지", Icon: FileText },
  { tab: "subscriptions", href: "/subscriptions", label: "구독 현황", Icon: CalendarDays },
  { tab: "wallet", href: "/wallet/ledger", label: "캐시 내역", Icon: Wallet },
  { tab: "notifications", href: "/notifications", label: "알림", Icon: Bell },
  // W-06: 지원 허브(분쟁·환불·신고 3탭) 진입 — 첫 탭 disputes로 연결
  { tab: "support", href: "/support/disputes", label: "지원 (분쟁·환불·신고)", Icon: ShieldAlert },
];

export function StudentDashboardShell({
  activeTab,
  user,
  profile,
  profileLoadError,
  cashBalanceKrw = 0,
  learningSummary,
  ledgerPreview,
  hideRightRail = false,
  children,
}: Props) {
  const name = profile?.full_name?.trim() || profile?.nickname?.trim() || user?.email || "—";
  const emailLine = profile?.email?.trim() || user?.email || "";
  const schoolLine = profile?.grade_level?.trim() || "";

  return (
    <div className="mx-auto max-w-[1320px] px-4 py-8 antialiased">
      <div className={`grid grid-cols-1 items-start ${hideRightRail ? "lg:grid-cols-[200px_minmax(0,1fr)]" : "lg:grid-cols-[200px_minmax(0,1fr)_300px]"} ${PAGE_COL_GAP}`}>
        <aside className={`hidden lg:flex flex-col self-start ${PAGE_COL_GAP} lg:col-span-1`}>
          <section className={SURFACE_CARD}>
            <p className="mb-3 text-xs font-bold uppercase tracking-wide text-slate-400">마이페이지</p>
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-blue-100 bg-blue-50 text-xl font-bold text-blue-600">
                {name.charAt(0)}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <h3 className="truncate text-base font-extrabold leading-tight text-slate-900">{name}</h3>
                  <span className="shrink-0 rounded border border-blue-100 bg-blue-50 px-1.5 py-0.5 text-[10px] font-bold text-blue-600">
                    학생
                  </span>
                </div>
                {emailLine ? (
                  <p className="mt-1 truncate text-xs font-medium leading-tight text-slate-500">{emailLine}</p>
                ) : null}
                {schoolLine ? (
                  <p className="truncate text-xs font-medium leading-tight text-slate-500">{schoolLine}</p>
                ) : null}
              </div>
            </div>
            {profileLoadError ? (
              <p className="mt-2 text-xs font-semibold leading-tight text-amber-600">{profileLoadError}</p>
            ) : null}
          </section>

          {learningSummary ? (
            <section className={SURFACE_CARD}>
              <p className="mb-3 text-xs font-bold uppercase tracking-wide text-slate-400">내 학습 요약</p>
              <dl className="grid grid-cols-3 gap-2 text-center">
                <div>
                  <dt className="text-[10px] font-semibold text-slate-400">질문방</dt>
                  <dd className="mt-0.5 text-lg font-black text-slate-900">{learningSummary.roomCount}</dd>
                </div>
                <div>
                  <dt className="text-[10px] font-semibold text-slate-400">구독</dt>
                  <dd className="mt-0.5 text-lg font-black text-slate-900">{learningSummary.activeMentorCount}</dd>
                </div>
                <div>
                  <dt className="text-[10px] font-semibold text-slate-400">의뢰·결제</dt>
                  <dd className="mt-0.5 text-lg font-black text-slate-900">{learningSummary.paymentCount}</dd>
                </div>
              </dl>
            </section>
          ) : null}

          <nav className={`space-y-1 ${SURFACE_CARD} !py-3`}>
            {NAV_ITEMS.map((item) => {
              const Icon = item.Icon;
              const active = activeTab === item.tab;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={`flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-bold transition duration-150 ${
                    active
                      ? "bg-blue-50 font-extrabold text-blue-700"
                      : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                  }`}
                >
                  <Icon className="h-4 w-4 shrink-0" aria-hidden />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </nav>
        </aside>

        <div className={`min-w-0 ${PAGE_COL_GAP} flex flex-col`}>
          <MobileNavTabs
            tone="blue"
            ariaLabel="마이페이지 메뉴"
            items={NAV_ITEMS.map((item) => ({
              href: item.href,
              label: item.label,
              active: activeTab === item.tab,
              Icon: item.Icon,
            }))}
          />
          {children}
        </div>

        {hideRightRail ? null : (
          <aside className={`flex flex-col self-start ${PAGE_COL_GAP}`}>
            {ledgerPreview ? (
              ledgerPreview
            ) : (
              <section className={SURFACE_CARD}>
                <p className="text-xs font-bold uppercase tracking-wide text-slate-400">결제 · 캐시</p>
                <p className="mt-2 text-2xl font-black tabular-nums text-[#2563EB]">
                  {cashBalanceKrw.toLocaleString("ko-KR")}
                  <span className="ml-1 text-sm font-bold text-slate-500">캐시</span>
                </p>
                <div className="mt-4 flex flex-col gap-2">
                  <Link
                    href="/wallet/charge"
                    className="inline-flex w-full items-center justify-center rounded-xl bg-blue-600 px-5 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-blue-700"
                  >
                    충전하기
                  </Link>
                  <Link
                    href="/wallet/ledger"
                    className="inline-flex w-full items-center justify-center rounded-xl border border-slate-200 bg-white px-5 py-3 text-sm font-bold text-slate-700 shadow-sm transition hover:bg-slate-50"
                  >
                    사용내역 전체
                  </Link>
                </div>
              </section>
            )}
          </aside>
        )}
      </div>
    </div>
  );
}
