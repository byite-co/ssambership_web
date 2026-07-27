import Link from "next/link";
import { PageScaffold } from "@/components/shell/PageScaffold";
import { FormSubmitButton } from "@/components/common/FormSubmitButton";
import { CommunityFileDropzone } from "@/components/community/CommunityFileDropzone";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/routeGuard";
import { fetchMentorProfileRow } from "@/lib/mentor/mentorProfileQueries";
import {
  fetchLatestMentorAcademicRecordChange,
  type MentorAcademicRecordChangeRow,
} from "@/lib/mentor/mentorAcademicRecordChange";
import { submitMentorAcademicRecordChangeAction } from "@/lib/mentor/mentorAcademicRecordChangeActions";
import { mapDataErrorMessage } from "@/lib/utils/mapDataError";

type PageProps = { searchParams?: Promise<Record<string, string | string[] | undefined>> };

function firstParam(v: string | string[] | undefined): string | null {
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v[0] ?? null;
  return null;
}

function statusLabel(status: string | null | undefined): string {
  const s = String(status ?? "").trim().toLowerCase();
  if (s === "approved") return "변경 완료";
  if (s === "rejected") return "반려";
  if (s === "resubmit_required") return "재제출 필요";
  if (s === "pending") return "심사 대기";
  return "미제출";
}

function statusBadgeClass(status: string | null | undefined): string {
  const s = String(status ?? "").trim().toLowerCase();
  if (s === "approved") return "border-emerald-200 bg-emerald-50 text-[#059669]";
  if (s === "rejected") return "border-red-200 bg-red-50 text-red-700";
  if (s === "resubmit_required") return "border-amber-200 bg-amber-50 text-amber-900";
  if (s === "pending") return "border-amber-200 bg-amber-50 text-amber-900";
  return "border-slate-200 bg-slate-50 text-slate-600";
}

function formatDateTime(v: string | null | undefined): string {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short" }).format(d);
}

export default async function MentorAcademicRecordChangePage(props: PageProps) {
  const { user } = await requireRole("mentor");
  const sp = (await props.searchParams) ?? {};
  const okMessage = firstParam(sp.ok);
  const errorMessage = firstParam(sp.error);

  const supabase = await createClient();
  const { row: profileRow } = await fetchMentorProfileRow(supabase, user.id);
  const latest = await fetchLatestMentorAcademicRecordChange(supabase, user.id);
  const row: MentorAcademicRecordChangeRow | null = latest.row;
  const status = row?.status ?? null;
  const currentUniversity =
    (profileRow && typeof (profileRow as Record<string, unknown>).university_name === "string"
      ? ((profileRow as Record<string, unknown>).university_name as string)
      : "") || "등록된 학교 정보가 없습니다.";
  const canSubmit = status !== "pending";

  return (
    <PageScaffold
      hideFooterPlaceholderCards
      eyebrow="멘토"
      title="학적변경요청"
      description={
        <>
          <span className="md:hidden">증명 서류를 제출하면 관리자 확인 후 반영돼요.</span>
          <span className="hidden md:inline">학교 정보는 멘토가 직접 수정할 수 없습니다. 편입·졸업·전과 등으로 학교가 바뀌었다면 증명 서류를 제출해 주세요. 관리자가 확인한 뒤 학교 정보에 반영됩니다.</span>
        </>
      }
      ctas={[
        { href: "/mentor/profile/edit", label: "프로필로 돌아가기", tone: "slate" },
      ]}
    >
      <div className="mx-auto max-w-3xl space-y-4">
        {okMessage ? (
          <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-800">
            {okMessage}
          </p>
        ) : null}
        {errorMessage ? (
          <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-800">
            {errorMessage}
          </p>
        ) : null}
        {latest.error ? (
          <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-900">
            요청 상태를 불러오지 못했습니다. {mapDataErrorMessage(latest.error)}
          </p>
        ) : null}

        <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-sm font-extrabold text-slate-900">현재 등록된 학교</p>
              <p className="mt-1 text-lg font-black text-slate-800">{currentUniversity}</p>
            </div>
            <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-black text-slate-700">
              잠금됨 · 직접 수정 불가
            </span>
          </div>
          <p className="text-xs leading-6 text-slate-500">
            <span className="md:hidden">변경 시 아래에서 서류와 함께 요청하세요.</span>
            <span className="hidden md:inline">학교 정보는 멘토의 신뢰·정산과 직결되어 임의 변경이 막혀 있습니다. 변경이 필요하면 아래에서 증명 서류와 함께 요청해 주세요.</span>
          </p>
        </section>

        <section className="space-y-5 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-4">
            <div>
              <h2 className="text-xl font-black text-slate-900">학적변경요청</h2>
              <p className="mt-1 text-sm leading-6 text-slate-600">
                <span className="md:hidden">학적 변동 증명 서류를 제출해 주세요.</span>
                <span className="hidden md:inline">재학증명서, 졸업증명서, 합격증, 전과 확인서 등 학적 변동을 확인할 수 있는 서류를 제출해 주세요.</span>
              </p>
            </div>
            <span className={`rounded-full border px-3 py-1 text-xs font-black ${statusBadgeClass(status)}`}>
              {statusLabel(status)}
            </span>
          </div>

          <div className="grid gap-3 text-sm sm:grid-cols-2">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-xs font-black text-slate-500">최근 제출</p>
              <p className="mt-1 font-bold text-slate-900">{row ? formatDateTime(row.created_at) : "아직 제출된 요청이 없습니다."}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-xs font-black text-slate-500">요청한 학교명</p>
              <p className="mt-1 font-bold text-slate-900">{row?.requested_university_name || "아직 요청 전이에요"}</p>
            </div>
          </div>

          {row?.reject_reason ? (
            <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-800">
              반려 사유: {row.reject_reason}
            </p>
          ) : null}

          <form action={submitMentorAcademicRecordChangeAction} className="space-y-4">
            <div>
              <label htmlFor="requestedUniversityName" className="text-sm font-black text-slate-900">
                변경하려는 학교명 <span className="text-red-500">*</span>
              </label>
              <input
                id="requestedUniversityName"
                name="requestedUniversityName"
                type="text"
                maxLength={40}
                disabled={!canSubmit}
                placeholder="예: 서울대학교"
                defaultValue={row?.requested_university_name ?? ""}
                className="mt-2 block w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 placeholder:text-slate-400 focus:border-[#059669] focus:outline-none disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400"
              />
            </div>
            <div>
              <label htmlFor="changeReason" className="text-sm font-black text-slate-900">
                변경 사유 (선택)
              </label>
              <input
                id="changeReason"
                name="changeReason"
                type="text"
                maxLength={100}
                disabled={!canSubmit}
                placeholder="예: 편입 / 졸업 / 전과 등"
                className="mt-2 block w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 placeholder:text-slate-400 focus:border-[#059669] focus:outline-none disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400"
              />
            </div>
            <div>
              <p className="text-sm font-black text-slate-900">학적 변동 증명 서류 <span className="text-red-500">*</span></p>
              <div className="mt-2">
                <CommunityFileDropzone
                  name="academicRecordDocument"
                  accept=".jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf"
                  required
                  disabled={!canSubmit}
                  buttonLabel="파일 선택"
                  hint="JPG, PNG, PDF · 클릭하거나 파일을 끌어다 놓으세요"
                />
              </div>
              <p className="mt-2 text-xs leading-5 text-slate-500">
                JPG, PNG, PDF 형식을 지원합니다. 제출한 서류는 비공개 저장소에 보관되고, 관리자만 열람합니다.
              </p>
            </div>
            <FormSubmitButton
              idleLabel={canSubmit ? "학적변경요청 제출" : "심사 대기 중"}
              pendingLabel="제출 중…"
              disabled={!canSubmit}
              className="min-h-12 w-full rounded-xl bg-[#059669] px-5 text-sm font-black text-white shadow-sm transition hover:bg-[#047857] disabled:cursor-not-allowed disabled:bg-slate-300"
            />
          </form>

          <p className="text-xs text-slate-500">
            학교·전공 최초 인증은{" "}
            <Link href="/mentor/verification" className="font-bold text-[#047857] underline">
              인증 상태
            </Link>{" "}
            화면에서 진행할 수 있어요.
          </p>
        </section>
      </div>
    </PageScaffold>
  );
}
