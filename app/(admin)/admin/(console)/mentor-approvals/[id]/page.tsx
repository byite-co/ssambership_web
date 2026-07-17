import Link from "next/link";
import { PageScaffold } from "@/components/shell/PageScaffold";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/routeGuard";
import { fetchMentorProfileRow } from "@/lib/mentor/mentorProfileQueries";
import { getUserProfileById } from "@/lib/auth/getCurrentProfile";
import { buildMentorProfileDisplay, mentorVerificationKo } from "@/lib/mentor/mentorDisplayFields";
import { loadMentorCapUsage } from "@/lib/subscribe/mentorCapService";
import { updateMentorCapLimitAction } from "@/lib/admin/mentorCapAdminActions";
import { mentorProfilesAdminReadClient } from "@/lib/admin/mentorProfilesAdminRead";
import { fetchLatestMentorSchoolVerification } from "@/lib/mentor/mentorSchoolVerification";
import { resolveStudentIdImageSignedUrl } from "@/lib/storage/studentIdImageStorage";

type Props = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function fmtCap(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/** `id`는 멘토 `user_id`(uuid)로 해석합니다. */
export default async function AdminMentorApprovalDetailPage(props: Props) {
  await requireRole("admin");
  const { id } = await props.params;
  const sp = (await props.searchParams) ?? {};
  const capOk = typeof sp.capOk === "string";
  const capError = typeof sp.capError === "string" ? sp.capError : null;
  const supabase = await createClient();
  // 서류·프로필 조회는 서비스롤 우선(키 없으면 세션 클라이언트) — 목록 화면과 동일 경로.
  const readDb = mentorProfilesAdminReadClient(supabase);
  const { row, error } = await fetchMentorProfileRow(readDb, id);
  const { data: userRow } = await getUserProfileById(supabase, id);
  const display = buildMentorProfileDisplay(row, userRow ?? null);
  const capUsage = await loadMentorCapUsage(id);

  // 제출 서류: 학생증(mentor_profiles.student_id_image_url) + 학교·전공 증명(mentor_school_verifications)
  const studentIdStoredRef =
    row && typeof row.student_id_image_url === "string" && row.student_id_image_url.trim().length > 0
      ? row.student_id_image_url
      : null;
  const studentIdSignedUrl = studentIdStoredRef
    ? await resolveStudentIdImageSignedUrl(readDb, studentIdStoredRef)
    : null;
  const schoolVerification = await fetchLatestMentorSchoolVerification(readDb, id);
  const schoolDocRef = schoolVerification.row?.document_storage_ref ?? null;
  const schoolDocSignedUrl = schoolDocRef ? await resolveStudentIdImageSignedUrl(readDb, schoolDocRef) : null;

  return (
    <PageScaffold
      hideFooterPlaceholderCards
      eyebrow="관리자 / 멘토 승인"
      title="멘토 승인 상세"
      description="멘토 프로필·인증 상태를 확인합니다. 승인·반려는 목록 화면의 액션을 사용해 주세요."
      ctas={[
        { href: "/admin/mentor-approval", label: "목록", tone: "blue" },
        { href: `/mentors/${encodeURIComponent(id)}`, label: "공개 프로필", tone: "slate" },
      ]}
      sections={[]}
      dataPoints={[]}
    >
      <div className="space-y-4">
        <Link href="/admin/mentor-approval" className="text-sm font-extrabold text-indigo-800 underline" prefetch={false}>
          ← 멘토 승인 목록
        </Link>
        {error ? <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-900">{error}</p> : null}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm font-extrabold text-slate-900">표시명</p>
          <p className="text-lg font-black text-slate-800">{display.displayName}</p>
          <p className="mt-2 text-sm text-slate-600">
            인증: <span className="font-bold">{mentorVerificationKo(display.verification)}</span>
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm font-extrabold text-slate-900">제출 서류</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-xs font-black text-slate-500">학생증 · 재학증명서</p>
              {studentIdSignedUrl ? (
                <a
                  href={studentIdSignedUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 inline-block rounded-lg bg-[#2563EB] px-3.5 py-1.5 text-xs font-extrabold text-white hover:bg-[#1D4ED8]"
                >
                  서류 열기 (5분 유효)
                </a>
              ) : (
                <p className="mt-2 text-sm font-semibold text-slate-500">
                  {studentIdStoredRef ? "서류 링크를 생성하지 못했습니다." : "제출된 서류가 없습니다."}
                </p>
              )}
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-xs font-black text-slate-500">학교·전공 증명 서류</p>
              {schoolDocSignedUrl ? (
                <a
                  href={schoolDocSignedUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 inline-block rounded-lg bg-[#2563EB] px-3.5 py-1.5 text-xs font-extrabold text-white hover:bg-[#1D4ED8]"
                >
                  서류 열기 (5분 유효)
                </a>
              ) : (
                <p className="mt-2 text-sm font-semibold text-slate-500">
                  {schoolDocRef ? "서류 링크를 생성하지 못했습니다." : "제출된 서류가 없습니다."}
                </p>
              )}
              {schoolVerification.row?.reject_reason ? (
                <p className="mt-2 text-xs font-bold text-red-700">반려 사유: {schoolVerification.row.reject_reason}</p>
              ) : null}
            </div>
          </div>
          <p className="mt-3 text-xs text-slate-500">승인·반려 처리는 목록 화면의 액션을 사용해 주세요.</p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm font-extrabold text-slate-900">구독 수용량 (cap)</p>
          <p className="mt-2 text-2xl font-black tabular-nums text-slate-900">
            {fmtCap(capUsage.usedCap)}{" "}
            <span className="text-base font-bold text-slate-400">/ {fmtCap(capUsage.capLimit)}</span>
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {capUsage.activeCount}명 구독 중 · {capUsage.pct}% 사용
            {capUsage.isFull ? <span className="ml-2 font-bold text-[#e08a2f]">구독 마감</span> : null}
          </p>

          <div className="mt-3 h-[9px] w-full overflow-hidden rounded-md bg-slate-100">
            <div
              className="h-full rounded-md"
              style={{
                width: `${Math.min(100, capUsage.pct)}%`,
                backgroundColor: capUsage.pct >= 80 ? "#e08a2f" : "#2563EB",
              }}
            />
          </div>

          <form action={updateMentorCapLimitAction} className="mt-4 flex flex-wrap items-end gap-2">
            <input type="hidden" name="mentorUserId" value={id} />
            <label className="text-xs font-bold text-slate-600">
              cap 상한 (관리자만)
              <input
                type="number"
                name="capLimit"
                step="0.5"
                min="0"
                max="1000"
                defaultValue={fmtCap(capUsage.capLimit)}
                className="mt-1 block w-28 rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-900"
              />
            </label>
            <button
              type="submit"
              className="rounded-lg bg-[#2563EB] px-4 py-2 text-sm font-extrabold text-white hover:bg-[#1D4ED8]"
            >
              저장
            </button>
          </form>
          {capOk ? <p className="mt-2 text-xs font-bold text-emerald-600">cap 상한을 저장했습니다.</p> : null}
          {capError ? <p className="mt-2 text-xs font-bold text-red-600">{capError}</p> : null}
        </div>
      </div>
    </PageScaffold>
  );
}
