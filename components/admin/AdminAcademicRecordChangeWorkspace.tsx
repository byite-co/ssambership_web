"use client";

import type { MentorAcademicRecordChangeRow } from "@/lib/mentor/mentorAcademicRecordChange";
import {
  approveMentorAcademicRecordChangeAction,
  rejectMentorAcademicRecordChangeAction,
  requestMentorAcademicRecordChangeResubmitAction,
} from "@/lib/admin/mentorAcademicRecordChangeReviewActions";
import { formatKoDateTimeKst } from "@/lib/utils/kstTime";

type ReviewProfile = {
  user_id: string;
  university_name: string | null;
  department_name: string | null;
  verification_status: string | null;
};

function displayName(
  user: { nickname: string | null; full_name: string | null } | undefined
): string {
  if (!user) return "(이름 미상)";
  return user.nickname || user.full_name || "(이름 미상)";
}

function formatDateTime(v: string | null | undefined): string {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "—";
  return formatKoDateTimeKst(v);
}

function statusLabel(status: string): string {
  if (status === "resubmit_required") return "재제출 필요";
  if (status === "pending") return "심사 대기";
  return status;
}

export function AdminAcademicRecordChangeWorkspace(props: {
  rows: MentorAcademicRecordChangeRow[];
  loadError: string | null;
  userById: Record<string, { nickname: string | null; full_name: string | null }>;
  profileByMentorId: Record<string, ReviewProfile>;
  signedUrlById: Record<string, string | null>;
}) {
  const { rows, loadError, userById, profileByMentorId, signedUrlById } = props;

  if (loadError) {
    return (
      <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-900">
        학적변경요청 목록을 불러오지 못했습니다: {loadError}
      </p>
    );
  }

  if (!rows.length) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center">
        <p className="text-sm font-bold text-slate-500">처리할 학적변경요청이 없습니다.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm font-semibold text-slate-600">
        심사 대기·재제출 요청 {rows.length}건. 서류를 확인한 뒤 확정 학교명을 입력해 승인하면 멘토 프로필 학교가 갱신됩니다.
      </p>
      {rows.map((row) => {
        const profile = profileByMentorId[row.mentor_id] ?? null;
        const signedUrl = signedUrlById[row.id] ?? null;
        return (
          <section key={row.id} className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-4">
              <div>
                <p className="text-sm font-black text-slate-900">{displayName(userById[row.mentor_id])}</p>
                <p className="mt-1 text-xs font-semibold text-slate-500">멘토 ID: {row.mentor_id}</p>
                <p className="mt-1 text-xs text-slate-500">제출: {formatDateTime(row.created_at)}</p>
              </div>
              <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-black text-amber-900">
                {statusLabel(row.status)}
              </span>
            </div>

            <div className="grid gap-3 text-sm sm:grid-cols-3">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs font-black text-slate-500">현재 학교(프로필)</p>
                <p className="mt-1 font-bold text-slate-900">{profile?.university_name || "—"}</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs font-black text-slate-500">요청 학교명</p>
                <p className="mt-1 font-bold text-slate-900">{row.requested_university_name || "—"}</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs font-black text-slate-500">변경 사유</p>
                <p className="mt-1 font-bold text-slate-900">{row.change_reason || "—"}</p>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-xs font-black text-slate-500">제출 서류</p>
              {signedUrl ? (
                <a
                  href={signedUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1 inline-block text-sm font-bold text-[#2563EB] underline"
                >
                  서류 열기 (단기 링크)
                </a>
              ) : (
                <p className="mt-1 text-sm font-semibold text-slate-500">첨부 서류를 불러올 수 없습니다.</p>
              )}
            </div>

            <form action={approveMentorAcademicRecordChangeAction} className="space-y-3 rounded-xl border border-emerald-200 bg-emerald-50/40 p-4">
              <input type="hidden" name="requestId" value={row.id} />
              <label className="text-sm font-black text-slate-900" htmlFor={`approve-${row.id}`}>
                확정 학교명 (승인 시 멘토 프로필에 반영)
              </label>
              <input
                id={`approve-${row.id}`}
                name="approvedUniversityName"
                type="text"
                maxLength={40}
                defaultValue={row.requested_university_name ?? ""}
                placeholder="확정 학교명을 입력"
                className="block w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 focus:border-emerald-500 focus:outline-none"
              />
              <button
                type="submit"
                className="min-h-11 w-full rounded-xl bg-[#059669] px-5 text-sm font-black text-white transition hover:bg-emerald-700"
              >
                승인하고 학교 반영
              </button>
            </form>

            <form action={requestMentorAcademicRecordChangeResubmitAction} className="space-y-3 rounded-xl border border-amber-200 bg-amber-50/40 p-4">
              <input type="hidden" name="requestId" value={row.id} />
              <label className="text-sm font-black text-slate-900" htmlFor={`resubmit-${row.id}`}>
                재제출 요청 사유
              </label>
              <input
                id={`resubmit-${row.id}`}
                name="rejectReason"
                type="text"
                maxLength={200}
                placeholder="어떤 서류가 더 필요한지 안내"
                className="block w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 focus:border-amber-500 focus:outline-none"
              />
              <button
                type="submit"
                className="min-h-11 w-full rounded-xl border border-amber-300 bg-white px-5 text-sm font-black text-amber-900 transition hover:bg-amber-50"
              >
                재제출 요청
              </button>
            </form>

            <form action={rejectMentorAcademicRecordChangeAction} className="space-y-3 rounded-xl border border-red-200 bg-red-50/40 p-4">
              <input type="hidden" name="requestId" value={row.id} />
              <label className="text-sm font-black text-slate-900" htmlFor={`reject-${row.id}`}>
                반려 사유
              </label>
              <input
                id={`reject-${row.id}`}
                name="rejectReason"
                type="text"
                maxLength={200}
                placeholder="반려 사유를 입력"
                className="block w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 focus:border-red-500 focus:outline-none"
              />
              <button
                type="submit"
                className="min-h-11 w-full rounded-xl border border-red-300 bg-white px-5 text-sm font-black text-red-700 transition hover:bg-red-50"
              >
                반려
              </button>
            </form>
          </section>
        );
      })}
    </div>
  );
}
