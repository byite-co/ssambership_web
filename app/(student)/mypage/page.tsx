import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import Link from "next/link";
import { Bell, HelpCircle, Star } from "lucide-react";
import { getServerUserWithProfile } from "@/lib/auth/getServerUserWithProfile";
import { createClient } from "@/lib/supabase/server";
import { fetchWalletBalanceByUserId } from "@/lib/cash/cashQueries";
import { parseWalletBalanceKrw } from "@/lib/cash/parseWalletBalanceKrw";
import { loadStudentMypageBundle } from "@/lib/mypage/mypageQueries";
import { loadWalletChargePageData } from "@/lib/cash/walletRouteData";
import {
  ledgerAmountLabel,
  ledgerAt,
  ledgerIsCredit,
  ledgerReasonLabel,
} from "@/lib/cash/ledgerRowDisplay";
import { countActiveSubscriptionsForStudent } from "@/lib/mypage/studentActiveSubscriptions";
import { isAccountDeletionFeatureEnabled, isUserBlocksEnabled } from "@/lib/shell/featureFlags";
import { MypageSubscriptionsCard } from "@/components/mypage/MypageSubscriptionsCard";

function SectionTitle(props: { title: string; hint?: ReactNode }) {
  return (
    <div>
      <h2 className="flex items-center gap-2 text-base font-extrabold text-[#0f172a]">
        <span className="block h-4 w-[3px] shrink-0 rounded-sm bg-[#2563EB]" aria-hidden />
        {props.title}
      </h2>
      {props.hint ? <p className="mt-1 text-xs font-medium leading-relaxed text-[#8a96a8]">{props.hint}</p> : null}
    </div>
  );
}

export default async function StudentMyPage() {
  const { user, profile, error: profileLoadError } = await getServerUserWithProfile();
  if (!user) {
    redirect(`/login/student?next=${encodeURIComponent("/mypage")}`);
  }

  const supabase = await createClient();
  const [bundle, activeSubs, balance, walletData] = await Promise.all([
    loadStudentMypageBundle(supabase, user.id, profile, profileLoadError?.message ?? null),
    countActiveSubscriptionsForStudent(supabase, user.id),
    fetchWalletBalanceByUserId(supabase, user.id),
    loadWalletChargePageData(supabase, user.id),
  ]);
  const cashBalanceKrw = parseWalletBalanceKrw(balance.row);

  const activeMentorCount = activeSubs.error ? 0 : activeSubs.count;
  const paymentCount = bundle.payments.valueText || "0";

  // 개별질문 건수 — 표시용 카운트(학생이 보낸 지정/공개 합계). 계산 로직 변경 없음.
  const iqCountRes = await supabase
    .from("individual_questions")
    .select("id", { count: "exact", head: true })
    .eq("student_id", user.id);
  const individualQuestionCount = iqCountRes.error ? 0 : iqCountRes.count ?? 0;

  const { roomCount } = bundle;
  const displayName = profile?.full_name?.trim() || profile?.nickname?.trim() || user.email || "학생";
  const emailLine = profile?.email?.trim() || user.email || "";
  const schoolLine = [profile?.grade_level?.trim(), profile?.student_status?.trim()].filter(Boolean).join(" · ");
  const initial = displayName.trim().charAt(0).toUpperCase() || "S";
  const roomText: ReactNode = roomCount.error
    ? "질문방 목록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요."
    : roomCount.n === 0
      ? (
          <>
            <span className="md:hidden">구독하면 질문방이 여기 열려요.</span>
            <span className="hidden md:inline">아직 열린 질문방이 없습니다. 멘토와 맺은 방이 여기에 이어집니다.</span>
          </>
        )
      : `연결된 질문방 ${roomCount.n}개 · 최근 질문과 답변을 확인하세요.`;

  const ledgerPreview = (
    <>
      <section className="rounded-2xl border border-slate-300 bg-white p-5 sm:p-6 shadow-[0_1px_4px_rgba(0,0,0,0.05)]">
        <SectionTitle title="결제·캐시" hint="충전 잔액과 최근 원장을 확인하세요." />
        <p className="mt-5 text-3xl font-black tabular-nums text-[#0f172a]">
          {cashBalanceKrw.toLocaleString("ko-KR")}
          <span className="ml-1 text-sm font-bold text-slate-500">캐시</span>
        </p>
        <div className="mt-4 space-y-2">
          <p className="text-xs font-bold text-slate-500">최근 내역</p>
          {walletData.ledgerPreview.error ? (
            <p className="text-xs text-red-700">내역을 불러오지 못했습니다.</p>
          ) : walletData.ledgerPreview.rows.length === 0 ? (
            <p className="text-xs text-slate-500">최근 사용 내역이 없습니다.</p>
          ) : (
            <ul className="divide-y divide-slate-100 text-sm">
              {walletData.ledgerPreview.rows.slice(0, 5).map((row, i) => {
                const r = row as Record<string, unknown>;
                const credit = ledgerIsCredit(r);
                return (
                  <li
                    key={typeof r.id === "string" ? r.id : `ledger-${i}`}
                    className="flex items-center justify-between gap-2 py-2"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-medium text-slate-700">{ledgerReasonLabel(r)}</p>
                      <p className="text-[11px] text-slate-400">{ledgerAt(r)}</p>
                    </div>
                    <span
                      className={`shrink-0 text-[13px] font-bold tabular-nums ${credit ? "text-[#047857]" : "text-[#dc2626]"}`}
                    >
                      {ledgerAmountLabel(r)}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <div className="mt-4 flex flex-col gap-2">
          <Link
            className="inline-flex min-h-[44px] w-full items-center justify-center rounded-xl bg-[#2563EB] px-4 py-2.5 text-sm font-bold text-white transition hover:bg-[#1d4ed8]"
            href="/wallet/charge"
          >
            충전하기
          </Link>
          <Link
            className="inline-flex min-h-[44px] w-full items-center justify-center rounded-xl border border-[#d8e0ec] bg-white px-4 py-2.5 text-sm font-bold text-[#3f4b5f] transition hover:border-[#c4cedd] hover:text-[#0f172a]"
            href="/wallet/ledger"
          >
            사용내역 전체
          </Link>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-300 bg-white p-5 sm:p-6 shadow-[0_1px_4px_rgba(0,0,0,0.05)]">
        <SectionTitle title="알림·지원·리뷰" />
        <ul className="divide-y divide-slate-100 text-sm">
          <li className="flex items-center justify-between gap-2 py-2.5">
            <span className="inline-flex items-center gap-2 font-medium text-slate-700">
              <Bell className="h-4 w-4 text-[#2563EB]" strokeWidth={2} aria-hidden />
              알림
            </span>
            <Link href="/notifications" className="text-xs font-bold text-[#2563EB] hover:underline">
              {bundle.notifications.valueText} · 센터 →
            </Link>
          </li>
          <li className="flex items-center justify-between gap-2 py-2.5">
            <span className="inline-flex items-center gap-2 font-medium text-slate-700">
              <HelpCircle className="h-4 w-4 text-[#2563EB]" strokeWidth={2} aria-hidden />
              고객지원
            </span>
            <Link href="/support/disputes" className="text-xs font-bold text-[#2563EB] hover:underline">
              분쟁·환불 →
            </Link>
          </li>
          <li className="flex items-center justify-between gap-2 py-2.5">
            <span className="inline-flex items-center gap-2 font-medium text-slate-700">
              <Star className="h-4 w-4 text-amber-500" strokeWidth={2} aria-hidden />
              리뷰 · 신고
            </span>
            <span className="text-right text-xs text-slate-500">
              {bundle.reviews.valueText} · {bundle.reports.valueText}
            </span>
          </li>
          {/* 차단 관리 진입 — 플래그 ON일 때만 렌더(OFF면 DOM에도 없음, 스펙 §4) */}
          {isUserBlocksEnabled() ? (
            <li className="flex items-center justify-between gap-2 py-2.5">
              <span className="font-medium text-slate-700">계정</span>
              <Link href="/settings/blocks" className="text-xs font-bold text-[#2563EB] hover:underline">
                차단 관리 →
              </Link>
            </li>
          ) : null}
          {/* 계정 삭제 진입 — 플래그 ON일 때만 렌더(OFF면 DOM에도 없음, 스펙 §3) */}
          {isAccountDeletionFeatureEnabled() ? (
            <li className="flex items-center justify-between gap-2 py-2.5">
              <span className="font-medium text-slate-700">계정</span>
              <Link href="/account/delete" className="text-xs font-bold text-slate-400 hover:text-red-600 hover:underline">
                회원 탈퇴 →
              </Link>
            </li>
          ) : null}
        </ul>
      </section>
    </>
  );

  return (
    <main className="min-h-screen bg-white px-4 py-8 antialiased sm:px-6 lg:px-8">
      <div className="mx-auto max-w-[1120px]">
        <header>
          <span className="inline-block rounded-full bg-[#e9f0ff] px-3.5 py-1.5 text-[13px] font-extrabold text-[#2563EB]">
            마이페이지
          </span>
          <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
            <h1 className="min-w-0 flex-1 text-[clamp(1.35rem,2.5vw,1.75rem)] font-extrabold leading-tight tracking-[-0.03em] text-[#0f172a]">
              내 학습과 결제를 한곳에서 확인하세요
            </h1>
          </div>
          <p className="mt-2 text-sm font-medium leading-relaxed text-[#3f4b5f]">
            <span className="md:hidden">진행 중인 질문·구독·캐시를 한눈에.</span>
            <span className="hidden md:inline">진행 중인 질문, 구독 현황, 캐시 잔액과 지원 링크를 한 화면에 정리했어요.</span>
          </p>
        </header>

        <div className="mt-6 grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="min-w-0 space-y-6">
            <section className="rounded-2xl border border-slate-300 bg-white p-5 sm:p-6 shadow-[0_1px_4px_rgba(0,0,0,0.05)]">
              <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-center">
                <div className="flex min-w-0 items-center gap-4">
                  <div
                    className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-[#e9f0ff] text-xl font-black text-[#2563EB]"
                    aria-hidden
                  >
                    {initial}
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-[#2563EB]">학생 프로필</p>
                    <h2 className="mt-1 truncate text-xl font-black text-[#0f172a]">{displayName}</h2>
                    <p className="mt-1 truncate text-sm font-medium text-slate-500">
                      {[emailLine, schoolLine].filter(Boolean).join(" · ")}
                    </p>
                    {profileLoadError ? (
                      <p className="mt-2 text-xs font-semibold text-amber-700">{profileLoadError.message}</p>
                    ) : null}
                  </div>
                </div>
                <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {[
                    { label: "질문방", value: String(roomCount.n ?? 0) },
                    { label: "구독", value: String(activeMentorCount) },
                    { label: "개별질문", value: String(individualQuestionCount) },
                    { label: "의뢰·결제", value: paymentCount },
                  ].map((item) => (
                    <div
                      key={item.label}
                      className="rounded-xl border border-[#bfdbfe] bg-[#eef4ff] px-3 py-3 text-center"
                    >
                      <dd className="text-2xl font-black tabular-nums text-[#0f172a]">{item.value}</dd>
                      <dt className="mt-0.5 text-[11px] font-bold text-[#2563EB]">{item.label}</dt>
                    </div>
                  ))}
                </dl>
              </div>
            </section>

            <section className="rounded-2xl border border-slate-300 bg-white p-5 sm:p-6 shadow-[0_1px_4px_rgba(0,0,0,0.05)]">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0 flex-1">
                  <SectionTitle title="진행 중인 질문" hint={roomText} />
                  {roomCount.error ? (
                    <p className="mt-2 text-xs font-semibold text-amber-800">정보를 불러오지 못했습니다.</p>
                  ) : null}
                  <p className="mt-2 text-2xl font-black tabular-nums text-[#0f172a]">
                    {roomCount.n ?? 0}
                    <span className="ml-1 text-xs font-normal text-slate-500">질문방</span>
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  <Link className="inline-flex min-h-[44px] items-center justify-center rounded-xl bg-[#2563EB] px-5 py-2.5 text-sm font-bold text-white transition hover:bg-[#1d4ed8]" href="/question-room">
                    질문방 바로가기
                  </Link>
                  <Link className="inline-flex min-h-[44px] items-center justify-center rounded-xl border border-[#d8e0ec] bg-white px-5 py-2.5 text-sm font-bold text-[#3f4b5f] transition hover:border-[#c4cedd] hover:text-[#0f172a]" href="/individual-questions">
                    개별 질문 보기
                  </Link>
                </div>
              </div>
            </section>

            <MypageSubscriptionsCard />
          </div>

          <aside className="space-y-6 lg:sticky lg:top-8">{ledgerPreview}</aside>
        </div>
      </div>
    </main>
  );
}
