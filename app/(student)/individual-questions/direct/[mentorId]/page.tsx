import { randomUUID } from "crypto";
import Link from "next/link";
import { redirect } from "next/navigation";
import "@/app/(public)/custom-request/landing.css";
import { DirectIndividualQuestionFormSection } from "@/components/individualQuestion/DirectIndividualQuestionFormSection";
import { requireRole } from "@/lib/auth/routeGuard";
import { fetchMentorIndividualQuestionPrice } from "@/lib/individualQuestion/individualQuestionPricing";
import { buildMentorProfileDisplay } from "@/lib/mentor/mentorDisplayFields";
import { mentorVerificationStatusAllowsActivity } from "@/lib/mentor/mentorVerificationGate";
import { loadPublicMentorBundle } from "@/lib/mentor/publicMentorBundle";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type PageProps = {
  params: Promise<{ mentorId: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function firstParam(value: string | string[] | undefined): string | null {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value[0] ?? null;
  return null;
}

/**
 * 지정형 개별 질문 작성 — 개별 질문 탭 내 경로.
 * /mentors/[mentorId]/individual-question/new와 동일한 폼(DirectIndividualQuestionFormSection)을 쓰되,
 * 네비게이션·취소·오류 복귀가 전부 개별 질문 탭 안에서 끝난다(멘토 지정 게시판 → 여기 → 질문 상세).
 */
export default async function DirectIndividualQuestionInTabPage(props: PageProps) {
  await requireRole("student");
  const { mentorId } = await props.params;
  const sp = (await props.searchParams) ?? {};
  const error = firstParam(sp.error);
  const supabase = await createClient();

  const [bundle, pricing] = await Promise.all([
    loadPublicMentorBundle(supabase, mentorId),
    fetchMentorIndividualQuestionPrice(supabase, mentorId),
  ]);

  if (bundle.kind !== "ok") {
    redirect("/individual-questions");
  }

  const display = buildMentorProfileDisplay(bundle.profileRow, bundle.userRow);
  const isApproved = mentorVerificationStatusAllowsActivity(bundle.profileRow?.verification_status);
  const idempotencyKey = `iq_direct:${randomUUID()}`;

  return (
    <div className="cr-landing cr-detail-v5 cr-detail-shell mx-auto w-full max-w-4xl px-4 py-6 sm:px-6 lg:px-8">
      <article className="cr-detail-card">
        <header className="cr-detail-header">
          <span className="eyebrow">개별 질문</span>
          <div className="cr-detail-header-row">
            <h1 className="cr-detail-title">{display.displayName} 멘토에게 질문하기</h1>
            <span className="cr-category-badge">지정형</span>
          </div>
          <p className="cr-detail-subtitle">
            구독 질문권과 별개로 캐시를 안전 결제해 단건 질문을 보냅니다. 답변 완료 시 결제 금액이 멘토에게 지급됩니다.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
            <Link href="/individual-questions" className="font-extrabold text-slate-500 hover:text-slate-700">
              ← 개별 질문으로
            </Link>
            <Link
              href={`/mentors/${encodeURIComponent(mentorId)}`}
              className="font-extrabold text-[#2563EB] hover:text-[#1D4ED8]"
            >
              멘토 프로필 보기
            </Link>
          </div>
        </header>

        <DirectIndividualQuestionFormSection
          mentorId={mentorId}
          displayName={display.displayName}
          isApproved={isApproved}
          amountCents={pricing.amountCents}
          error={error}
          idempotencyKey={idempotencyKey}
          origin="iq-tab"
          cancelHref="/individual-questions"
          fallbackHref="/individual-questions"
          fallbackLabel="개별 질문으로 돌아가기"
        />
      </article>
    </div>
  );
}
