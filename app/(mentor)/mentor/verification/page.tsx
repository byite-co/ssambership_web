import { BadgeCheck, Clock, FileUp, RotateCcw, XCircle } from "lucide-react";
import { PageScaffold } from "@/components/shell/PageScaffold";
import { FormSubmitButton } from "@/components/qna/FormSubmitButton";
import { CommunityFileDropzone } from "@/components/community/CommunityFileDropzone";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/routeGuard";
import { fetchMentorProfileRow } from "@/lib/mentor/mentorProfileQueries";
import { buildMentorProfileDisplay } from "@/lib/mentor/mentorDisplayFields";
import { getUserProfileById } from "@/lib/auth/getCurrentProfile";
import { fetchLatestMentorSchoolVerification, type MentorSchoolVerificationRow } from "@/lib/mentor/mentorSchoolVerification";
import { submitMentorSchoolVerificationAction } from "@/lib/mentor/mentorSchoolVerificationActions";
import { submitMentorStudentIdImageAction } from "@/lib/mentor/mentorStudentIdActions";
import { mapDataErrorMessage } from "@/lib/utils/mapDataError";

type PageProps = { searchParams?: Promise<Record<string, string | string[] | undefined>> };

function firstParam(v: string | string[] | undefined): string | null {
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v[0] ?? null;
  return null;
}

function formatDateTime(v: string | null | undefined): string {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short" }).format(d);
}

type VerificationHeroMeta = {
  Icon: typeof BadgeCheck;
  tile: string;
  fg: string;
  badgeClass: string;
  badgeLabel: string;
  headline: string;
  sub: string;
};

// 상태 히어로 메타(주문방/분쟁 상세 히어로와 동일 원리: 상태색 아이콘 타일 + 헤드라인 + 단일 배지).
// 멘토 초록 정체성 유지: 진행/대기 = 주황, 반려 = 빨강, 완료 = 초록.
function verificationHeroMeta(status: string | null | undefined): VerificationHeroMeta {
  const s = String(status ?? "").trim().toLowerCase();
  if (s === "approved") {
    return {
      Icon: BadgeCheck,
      tile: "bg-emerald-50",
      fg: "text-[#059669]",
      badgeClass: "border-emerald-200 bg-emerald-50 text-[#059669]",
      badgeLabel: "인증 완료",
      headline: "학교·전공 인증이 완료됐어요",
      sub: "검증값이 프로필에 반영됐어요. 멘토 활동을 시작할 수 있어요.",
    };
  }
  if (s === "rejected") {
    return {
      Icon: XCircle,
      tile: "bg-red-50",
      fg: "text-red-600",
      badgeClass: "border-red-200 bg-red-50 text-red-700",
      badgeLabel: "반려",
      headline: "서류가 반려됐어요",
      sub: "아래 사유를 확인하고 다시 제출해 주세요",
    };
  }
  if (s === "resubmit_required") {
    return {
      Icon: RotateCcw,
      tile: "bg-amber-50",
      fg: "text-amber-600",
      badgeClass: "border-amber-200 bg-amber-50 text-amber-900",
      badgeLabel: "재제출 필요",
      headline: "서류 재제출이 필요해요",
      sub: "안내에 맞춰 서류를 다시 제출해 주세요",
    };
  }
  if (s === "pending") {
    return {
      Icon: Clock,
      tile: "bg-amber-50",
      fg: "text-amber-600",
      badgeClass: "border-amber-200 bg-amber-50 text-amber-900",
      badgeLabel: "검토 중",
      headline: "서류를 심사하고 있어요",
      sub: "관리자 검토 중 · 보통 1~2일",
    };
  }
  return {
    Icon: FileUp,
    tile: "bg-slate-100",
    fg: "text-slate-500",
    badgeClass: "border-slate-200 bg-slate-50 text-slate-600",
    badgeLabel: "미제출",
    headline: "아직 제출된 서류가 없어요",
    sub: "학교·전공을 확인할 수 있는 서류를 제출해 주세요",
  };
}

function verifiedValueSummary(row: MentorSchoolVerificationRow | null): string {
  if (!row) return "관리자가 서류를 확인하면 검증값이 기록됩니다.";
  const values = [
    row.verified_university_name,
    row.verified_department_name,
    row.verified_major_category,
    row.school_tier,
  ].filter((x) => typeof x === "string" && x.trim().length > 0);
  return values.length ? values.join(" · ") : "관리자 입력 전이라 검증값은 비어 있습니다.";
}

export default async function MentorVerificationPage(props: PageProps) {
  const { user } = await requireRole("mentor");
  const sp = (await props.searchParams) ?? {};
  const schoolDocOk = firstParam(sp.schoolDoc);
  const schoolDocError = firstParam(sp.schoolDocError);
  const studentIdDocOk = firstParam(sp.studentIdDoc);
  const studentIdDocError = firstParam(sp.studentIdDocError);
  const supabase = await createClient();
  const { row } = await fetchMentorProfileRow(supabase, user.id);
  const { data: userRow } = await getUserProfileById(supabase, user.id);
  const schoolVerification = await fetchLatestMentorSchoolVerification(supabase, user.id);
  const display = buildMentorProfileDisplay(row, userRow ?? null);
  const schoolRow = schoolVerification.row;
  const schoolStatus = schoolRow?.status ?? null;
  const hero = verificationHeroMeta(schoolStatus);
  // 상태 분기 로직 보존: 심사 대기(pending) 중에는 재제출을 잠근다(기존과 동일).
  const canSubmitSchoolDocument = schoolStatus !== "pending";
  const isPending = schoolStatus === "pending";
  const submitLabel = schoolRow ? "학교·전공 인증 서류 다시 제출" : "학교·전공 인증 서류 제출";
  // 가입 시 학생증 업로드가 누락된 경우(이메일 인증 가입 경로) 여기서 사후 제출한다.
  const studentIdStoredRef =
    row && typeof row.student_id_image_url === "string" && row.student_id_image_url.trim().length > 0
      ? row.student_id_image_url
      : null;

  // 서류 업로드 폼(미터치 동작) — pending은 토글 안으로, 그 외는 펼침.
  const schoolForm = (
    <form action={submitMentorSchoolVerificationAction} className="space-y-3">
      <div>
        <p className="text-sm font-black text-slate-900">학교·전공 증명 서류</p>
        <div className="mt-2">
          <CommunityFileDropzone
            name="schoolVerificationDocument"
            accept=".jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf"
            disabled={!canSubmitSchoolDocument}
            buttonLabel="파일 선택"
            hint="JPG, PNG, PDF · 클릭하거나 파일을 끌어다 놓으세요"
          />
        </div>
        <p className="mt-2 text-xs leading-5 text-slate-500">
          JPG, PNG, PDF 형식을 지원합니다. 제출한 서류는 비공개 저장소에 보관되고, 관리자 확인 후 인증됩니다.
        </p>
      </div>
      <FormSubmitButton
        idleLabel={submitLabel}
        pendingLabel="제출 중…"
        disabled={!canSubmitSchoolDocument}
        className="min-h-12 w-full rounded-xl bg-[#059669] px-5 text-sm font-black text-white transition hover:bg-[#047857] disabled:cursor-not-allowed disabled:bg-slate-300"
      />
    </form>
  );

  return (
    <PageScaffold
      hideFooterPlaceholderCards
      eyebrow="멘토"
      title="인증 상태"
      description={
        <>
          <span className="md:hidden">운영 검토 결과가 이 화면에 반영돼요.</span>
          <span className="hidden md:inline">학생증·운영 검토 결과를 확인합니다. 승인·반려·재제출 안내는 운영자 검토 후 이 화면에 반영됩니다.</span>
        </>
      }
      ctas={[]}
    >
      <div className="mx-auto max-w-3xl space-y-4">
        {schoolDocOk ? (
          <p className="rounded-xl border-[0.5px] border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-800">
            {schoolDocOk}
          </p>
        ) : null}
        {schoolDocError ? (
          <p className="rounded-xl border-[0.5px] border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-800">
            {schoolDocError}
          </p>
        ) : null}
        {studentIdDocOk ? (
          <p className="rounded-xl border-[0.5px] border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-800">
            {studentIdDocOk}
          </p>
        ) : null}
        {studentIdDocError ? (
          <p className="rounded-xl border-[0.5px] border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-800">
            {studentIdDocError}
          </p>
        ) : null}
        {schoolVerification.error ? (
          <p className="rounded-xl border-[0.5px] border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-900">
            학교·전공 인증 상태를 불러오지 못했습니다. {mapDataErrorMessage(schoolVerification.error)}
          </p>
        ) : null}

        {/* ★상태 히어로 — 표시명 + 단일 상태 배지 + 상태 문구를 하나로(중복 배지·안내 박스 통합). */}
        <section className="flex items-start gap-3.5 rounded-2xl border-[0.5px] border-slate-300 bg-white p-5">
          <span className={`flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-xl ${hero.tile} ${hero.fg}`} aria-hidden>
            <hero.Icon className="h-5 w-5" strokeWidth={2} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <span className="inline-flex items-center rounded-full bg-slate-100 px-3 py-1 text-xs font-extrabold text-slate-600">
                멘토 인증
              </span>
              <span className={`shrink-0 rounded-full border px-3 py-1 text-xs font-black ${hero.badgeClass}`}>
                {hero.badgeLabel}
              </span>
            </div>
            <h2 className="mt-2 text-xl font-black text-slate-900">{hero.headline}</h2>
            <p className="mt-1 text-sm leading-6 text-slate-600">
              <span className="font-bold text-slate-800">{display.displayName}</span> · {hero.sub}
            </p>
          </div>
        </section>

        {!row ? (
          <p className="rounded-xl border-[0.5px] border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
            멘토 프로필 행을 찾지 못했습니다. 프로필 편집에서 정보를 저장해 주세요.
          </p>
        ) : null}

        <section className="space-y-5 rounded-2xl border-[0.5px] border-slate-300 bg-white p-6">
          <div className="border-b border-slate-100 pb-4">
            <p className="text-xs font-black tracking-wider text-slate-500">학교 인증</p>
            <h2 className="mt-1 text-xl font-black text-slate-900">학교·전공 인증</h2>
            <p className="mt-1 text-sm leading-6 text-slate-600">
              재학증명서, 졸업증명서, 합격증 등 학교와 전공이 확인되는 서류를 제출해 주세요.
              관리자가 서류를 확인한 뒤 검증값을 입력합니다.
            </p>
          </div>

          {isPending ? (
            <>
              <p className="text-sm font-bold text-slate-700">
                학교·전공 증명 서류 제출 완료 · 최근 제출 {formatDateTime(schoolRow?.created_at)}
              </p>
              <div className="rounded-xl border-[0.5px] border-slate-300 bg-slate-50 p-4 text-sm">
                <p className="text-xs font-black text-slate-500">검증값</p>
                <p className="mt-1 font-bold text-slate-900">{verifiedValueSummary(schoolRow)}</p>
              </div>
              <details className="group rounded-xl border-[0.5px] border-slate-300 bg-white">
                <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-bold text-[#059669]">
                  다른 서류로 다시 제출
                  <span aria-hidden className="transition group-open:rotate-90">→</span>
                </summary>
                <div className="space-y-3 border-t border-slate-100 p-4">
                  <p className="text-xs leading-5 text-slate-500">
                    현재 심사 중이라, 새 서류 제출은 검토 결과가 나온 뒤 가능해요.
                  </p>
                  {schoolForm}
                </div>
              </details>
            </>
          ) : (
            <>
              <div className="grid gap-3 text-sm sm:grid-cols-2">
                <div className="rounded-xl border-[0.5px] border-slate-300 bg-slate-50 p-4">
                  <p className="text-xs font-black text-slate-500">최근 제출</p>
                  <p className="mt-1 font-bold text-slate-900">
                    {schoolRow ? formatDateTime(schoolRow.created_at) : "아직 제출된 서류가 없습니다."}
                  </p>
                </div>
                <div className="rounded-xl border-[0.5px] border-slate-300 bg-slate-50 p-4">
                  <p className="text-xs font-black text-slate-500">검증값</p>
                  <p className="mt-1 font-bold text-slate-900">{verifiedValueSummary(schoolRow)}</p>
                </div>
              </div>

              {schoolRow?.reject_reason ? (
                <div className="rounded-xl border-[0.5px] border-red-200 bg-red-50 px-4 py-3">
                  <p className="text-xs font-black text-red-700">반려 사유</p>
                  <p className="mt-1 text-sm font-semibold leading-relaxed text-red-800">{schoolRow.reject_reason}</p>
                </div>
              ) : null}

              {schoolForm}
            </>
          )}
        </section>

        <section className="space-y-5 rounded-2xl border-[0.5px] border-slate-300 bg-white p-6">
          <div className="border-b border-slate-100 pb-4">
            <p className="text-xs font-black tracking-wider text-slate-500">신분 확인</p>
            <h2 className="mt-1 text-xl font-black text-slate-900">학생증 서류</h2>
            <p className="mt-1 text-sm leading-6 text-slate-600">
              가입 시 첨부한 학생증·재학증명서가 저장되지 않았거나 다른 서류로 바꾸려면 여기서 제출해 주세요.
            </p>
          </div>

          {studentIdStoredRef ? (
            <p className="rounded-xl border-[0.5px] border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-800">
              학생증 서류가 제출되어 있습니다. 다른 서류로 바꾸려면 아래에서 다시 제출해 주세요.
            </p>
          ) : (
            <p className="rounded-xl border-[0.5px] border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-900">
              아직 제출된 학생증 서류가 없습니다. 관리자 승인 심사에 필요하니 지금 제출해 주세요.
            </p>
          )}

          <form action={submitMentorStudentIdImageAction} className="space-y-3">
            <div>
              <p className="text-sm font-black text-slate-900">학생증 또는 재학증명서</p>
              <div className="mt-2">
                <CommunityFileDropzone
                  name="studentIdDocument"
                  accept=".jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf"
                  buttonLabel="파일 선택"
                  hint="JPG, PNG, PDF · 클릭하거나 파일을 끌어다 놓으세요"
                />
              </div>
              <p className="mt-2 text-xs leading-5 text-slate-500">
                JPG, PNG, PDF 형식을 지원합니다. 제출한 서류는 비공개 저장소에 보관되고, 관리자만 열람합니다.
              </p>
            </div>
            <FormSubmitButton
              idleLabel={studentIdStoredRef ? "학생증 서류 다시 제출" : "학생증 서류 제출"}
              pendingLabel="제출 중…"
              className="min-h-12 w-full rounded-xl bg-[#059669] px-5 text-sm font-black text-white transition hover:bg-[#047857] disabled:cursor-not-allowed disabled:bg-slate-300"
            />
          </form>
        </section>
      </div>
    </PageScaffold>
  );
}
