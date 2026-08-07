import { PageScaffold } from "@/components/shell/PageScaffold";
import { MentorProfileEditForm } from "@/components/mentor/MentorProfileEditForm";
import { getUserProfileById } from "@/lib/auth/getCurrentProfile";
import { requireRole } from "@/lib/auth/routeGuard";
import { createClient } from "@/lib/supabase/server";
import { buildMentorProfileDisplay, mentorVerificationKo } from "@/lib/mentor/mentorDisplayFields";
import { fetchMentorProfileRow } from "@/lib/mentor/mentorProfileQueries";
import { fetchMentorIndividualQuestionPrice } from "@/lib/individualQuestion/individualQuestionPricing";
import { cashKrwFromAmountCents } from "@/lib/subscribe/mentorPlanPricing";
import { fetchPlansForMentor } from "@/lib/mentor/publicMentorBundle";
import { assignPlansByTier } from "@/lib/subscribe/subscribePageQueries";
import { mapDataErrorMessage } from "@/lib/utils/mapDataError";

type PageProps = { searchParams?: Promise<{ error?: string; ok?: string }> };

export default async function MentorProfileEditPage(props: PageProps) {
  const { user } = await requireRole("mentor");
  const sp = (await props.searchParams) ?? {};
  const err = typeof sp.error === "string" && sp.error.length ? sp.error : null;
  const ok = sp.ok === "1";

  const supabase = await createClient();
  const { row, error: re } = await fetchMentorProfileRow(supabase, user.id);
  const { data: userRow } = await getUserProfileById(supabase, user.id);
  const plans = await fetchPlansForMentor(supabase, user.id);
  const { byTier } = assignPlansByTier(plans.rows);
  const iqPrice = await fetchMentorIndividualQuestionPrice(supabase, user.id);

  const display = buildMentorProfileDisplay(row, userRow ?? null);
  const initial = {
    intro: display.intro,
    bio: display.bio,
    university: display.university,
    department: display.department,
    subjects: display.subjects,
    highSchool: display.highSchool,
    tags: display.tags,
    subOpen: display.subOpen,
    photoUrl: display.photoUrl,
    verification: display.verification,
    // 인증서류(학생증) 제출 여부만 boolean 으로 전달 — 원본/서명 URL 은 절대 폼으로 넘기지 않는다(avatar 와 분리).
    documentSubmitted:
      typeof (row as { student_id_image_url?: unknown } | null)?.student_id_image_url === "string" &&
      ((row as { student_id_image_url: string }).student_id_image_url).trim().length > 0,
    displayName: display.displayName,
    grade: display.grade,
    // 저장값은 cents(=캐시×100). 입력 프리필은 캐시로 ÷100 변환.
    individualQuestionPriceCash:
      iqPrice.amountCents != null ? cashKrwFromAmountCents(iqPrice.amountCents) : null,
  };

  if (re) {
    console.error("[mentor/profile/edit] profile row fetch", re);
  }

  // 기존 요약 대시보드에서 흡수한 상태 정보(완성도·공개·인증) — 편집 화면 상단 배너
  const completeness = [
    display.intro,
    display.university,
    display.department,
    display.subjects,
    display.tags,
  ].filter((s) => s && String(s).trim().length > 0).length;
  const completenessPct = Math.min(100, Math.round((completeness / 5) * 100));
  const verKo = mentorVerificationKo(display.verification);
  const isPublic = Boolean(display.subOpen);

  return (
    <PageScaffold
      hideHero
      hideFooterPlaceholderCards
      sections={[]}
    >
      <div className="mb-5 flex flex-wrap items-center gap-2 rounded-2xl border border-[#A7F3D0] bg-[#ECFDF5] px-4 py-3">
        <span className="text-sm font-extrabold text-[#047857]">프로필 완성도 {completenessPct}%</span>
        <span className="h-3 w-px bg-emerald-200" aria-hidden />
        <span className="rounded-full border border-emerald-200 bg-white px-2.5 py-0.5 text-xs font-bold text-[#047857]">
          {isPublic ? "공개 중" : "비공개"}
        </span>
        <span className="rounded-full border border-slate-200 bg-white px-2.5 py-0.5 text-xs font-bold text-slate-600">
          인증 {verKo}
        </span>
        <span className="ml-auto text-xs font-medium text-emerald-800/80">아래에서 항목을 채우면 공개 프로필이 더 또렷해져요.</span>
      </div>
      <MentorProfileEditForm
        initial={initial}
        query={{ row, err: re, byTier }}
        accountEmail={userRow?.email ?? user.email ?? null}
        ok={ok}
        errorMessage={err ? mapDataErrorMessage(err) : null}
      />
    </PageScaffold>
  );
}
