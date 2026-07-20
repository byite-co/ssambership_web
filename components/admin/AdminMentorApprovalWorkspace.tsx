"use client";

import { useMemo, useState } from "react";
import { FormSubmitButton } from "@/components/common/FormSubmitButton";
import {
  approveMentorApplicationAction,
  rejectMentorApplicationAction,
  requestMentorDocumentsAction,
} from "@/lib/admin/mentorApprovalActions";
import {
  approveMentorSchoolVerificationAction,
  rejectMentorSchoolVerificationAction,
  requestMentorSchoolVerificationResubmitAction,
} from "@/lib/admin/mentorSchoolVerificationReviewActions";
import { mentorApprovalStatusLabel, mentorApprovalStatusRaw } from "@/lib/admin/mentorApprovalLabels";
import type { ClassificationOption } from "@/lib/mentor/schoolClassificationCatalog";
import type { MentorSchoolVerificationRow } from "@/lib/mentor/mentorSchoolVerification";
import type { SchoolTier, VerifiedMajorCategory } from "@/lib/mentor/schoolVerificationConstants";

type Row = Record<string, unknown>;
type UserDisplay = { nickname: string | null; full_name: string | null; email: string | null };
type SchoolVerificationProfile = {
  user_id: string;
  university_name: string | null;
  department_name: string | null;
  verification_status: string | null;
  created_at: string | null;
  updated_at: string | null;
};

type Props = {
  rows: Row[];
  userById: Record<string, UserDisplay>;
  /** 서버에서 createSignedUrl(300s)로 발급한 학생증 미리보기 URL */
  studentIdImageSignedUrlByUserId?: Record<string, string | null>;
  /** 학생증 저장값 존재 여부 — "미제출"과 "발급 실패"를 구분 표기하기 위함 */
  studentIdImageStoredByUserId?: Record<string, boolean>;
  schoolVerificationRows: MentorSchoolVerificationRow[];
  schoolVerificationLoadError: string | null;
  schoolVerificationProfileByMentorId: Record<string, SchoolVerificationProfile>;
  schoolVerificationSignedUrlById: Record<string, string | null>;
  schoolTierOptions: ClassificationOption<SchoolTier>[];
  majorCategoryOptions: ClassificationOption<VerifiedMajorCategory>[];
  schoolTierSuggestionByVerificationId: Record<
    string,
    { schoolName: string; schoolTierCode: string; schoolTierLabel: string; note: string | null }
  >;
  statusFilter: string;
  statusColumn: string | null;
};

function textOrDash(v: unknown): string {
  if (typeof v !== "string") return "-";
  const t = v.trim();
  return t || "-";
}

function displayName(row: Row | null, user?: UserDisplay, profile?: SchoolVerificationProfile | null): string {
  const u = user?.full_name?.trim() || user?.nickname?.trim();
  if (u) return u;
  const profileName = profile?.university_name?.trim() || profile?.department_name?.trim();
  if (profileName) return profileName;
  const uni = row?.university_name ?? row?.department_name;
  if (typeof uni === "string" && uni.trim()) return uni.trim();
  return "이름 없음";
}

function formatTs(v: unknown): string {
  if (!v) return "-";
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) return "-";
  return new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short" }).format(d);
}

function schoolVerificationStatusLabel(status: string): string {
  if (status === "pending") return "심사 대기";
  if (status === "resubmit_required") return "재제출 요청";
  if (status === "approved") return "승인 완료";
  if (status === "rejected") return "반려";
  return status || "-";
}

function schoolVerificationStatusClass(status: string): string {
  if (status === "approved") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (status === "rejected") return "border-red-200 bg-red-50 text-red-800";
  if (status === "resubmit_required") return "border-amber-200 bg-amber-50 text-amber-900";
  return "border-amber-200 bg-amber-50 text-amber-900";
}

const FILTERS = [
  { id: "all", label: "전체" },
  { id: "pending", label: "대기" },
  { id: "approved", label: "승인" },
  { id: "rejected", label: "반려" },
] as const;

export function AdminMentorApprovalWorkspace(props: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedSchoolVerificationId, setSelectedSchoolVerificationId] = useState<string | null>(
    props.schoolVerificationRows[0]?.id ?? null
  );
  const [filter, setFilter] = useState(props.statusFilter || "all");
  const [rejectOpen, setRejectOpen] = useState(false);

  const filtered = useMemo(() => {
    if (filter === "all") return props.rows;
    return props.rows.filter((r) => {
      const s = mentorApprovalStatusRaw(r, props.statusColumn);
      if (filter === "pending") return /pending|submitted|review|await/i.test(s);
      if (filter === "approved") return /approved|success/i.test(s);
      if (filter === "rejected") return /reject/i.test(s);
      return true;
    });
  }, [props.rows, filter, props.statusColumn]);

  const selected = filtered.find((r) => String(r.user_id ?? r.id) === selectedId) ?? null;
  const mentorUserId = selected ? String(selected.user_id ?? selected.id ?? "") : "";
  const user = mentorUserId ? props.userById[mentorUserId] : undefined;
  const img = (mentorUserId && props.studentIdImageSignedUrlByUserId?.[mentorUserId]) || null;
  const selectedSchoolVerification =
    props.schoolVerificationRows.find((r) => r.id === selectedSchoolVerificationId) ?? props.schoolVerificationRows[0] ?? null;
  const selectedSchoolMentorId = selectedSchoolVerification?.mentor_id ?? "";
  const selectedSchoolUser = selectedSchoolMentorId ? props.userById[selectedSchoolMentorId] : undefined;
  const selectedSchoolProfile = selectedSchoolMentorId
    ? props.schoolVerificationProfileByMentorId[selectedSchoolMentorId] ?? null
    : null;
  const selectedSchoolDocumentUrl = selectedSchoolVerification
    ? props.schoolVerificationSignedUrlById[selectedSchoolVerification.id] ?? null
    : null;
  const selectedSchoolTierSuggestion = selectedSchoolVerification
    ? props.schoolTierSuggestionByVerificationId[selectedSchoolVerification.id] ?? null
    : null;

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-black text-slate-900">멘토 승인</h1>
        <p className="mt-1 text-sm text-slate-600">멘토 가입 승인과 학교·전공 인증 서류를 검토합니다.</p>
      </header>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_430px]">
        <div className="space-y-4">
          <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-4 py-3">
              <div>
                <h2 className="text-sm font-black text-slate-900">학교·전공 인증 대기</h2>
                <p className="mt-0.5 text-xs text-slate-500">증명 서류를 보고 관리자 검증값을 입력합니다.</p>
              </div>
              <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-bold text-blue-700">
                {props.schoolVerificationRows.length}건
              </span>
            </div>
            {props.schoolVerificationLoadError ? (
              <p className="m-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-900">
                학교 인증 요청을 불러오지 못했습니다.
              </p>
            ) : null}
            {!props.schoolVerificationRows.length ? (
              <p className="px-4 py-8 text-center text-sm font-semibold text-slate-500">심사 대기 중인 학교·전공 인증이 없습니다.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 bg-slate-50/70 text-xs font-bold text-slate-600">
                      <th className="px-4 py-3">멘토</th>
                      <th className="px-4 py-3">참고 학교</th>
                      <th className="px-4 py-3">참고 학과</th>
                      <th className="px-4 py-3">상태</th>
                      <th className="px-4 py-3">제출일</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {props.schoolVerificationRows.map((r) => {
                      const profile = props.schoolVerificationProfileByMentorId[r.mentor_id] ?? null;
                      const isSelected = selectedSchoolVerification?.id === r.id;
                      return (
                        <tr
                          key={r.id}
                          className={["cursor-pointer hover:bg-slate-50", isSelected ? "bg-blue-50/60" : ""].join(" ")}
                          onClick={() => {
                            setSelectedSchoolVerificationId(r.id);
                            setSelectedId(r.mentor_id);
                          }}
                        >
                          <td className="px-4 py-3 font-semibold text-slate-900">
                            {displayName(null, props.userById[r.mentor_id], profile)}
                          </td>
                          <td className="px-4 py-3 text-slate-600">{textOrDash(profile?.university_name)}</td>
                          <td className="px-4 py-3 text-slate-600">{textOrDash(profile?.department_name)}</td>
                          <td className="px-4 py-3">
                            <span className={`rounded-full border px-2.5 py-1 text-xs font-bold ${schoolVerificationStatusClass(r.status)}`}>
                              {schoolVerificationStatusLabel(r.status)}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-xs text-slate-500">{formatTs(r.created_at)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {FILTERS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setFilter(f.id)}
                  className={[
                    "rounded-full px-3.5 py-1.5 text-xs font-bold",
                    filter === f.id ? "bg-[#2563EB] text-white" : "border border-slate-200 bg-white text-slate-700",
                  ].join(" ")}
                >
                  {f.label}
                </button>
              ))}
            </div>

            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50 text-xs font-bold text-slate-600">
                    <th className="px-4 py-3">이름</th>
                    <th className="px-4 py-3">학교</th>
                    <th className="px-4 py-3">학과</th>
                    <th className="px-4 py-3">신청일</th>
                    <th className="px-4 py-3">상태</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filtered.map((r) => {
                    const id = String(r.user_id ?? r.id ?? "");
                    return (
                      <tr
                        key={id}
                        className={["cursor-pointer hover:bg-slate-50", selectedId === id ? "bg-blue-50/50" : ""].join(" ")}
                        onClick={() => setSelectedId(id)}
                      >
                        <td className="px-4 py-3">
                          <p className="font-semibold text-slate-900">{displayName(r, props.userById[id])}</p>
                          <p className="text-xs text-slate-500">{props.userById[id]?.email || "—"}</p>
                        </td>
                        <td className="px-4 py-3 text-slate-600">{String(r.university_name ?? "-")}</td>
                        <td className="px-4 py-3 text-slate-600">{String(r.department_name ?? "-")}</td>
                        <td className="px-4 py-3 text-slate-500">{formatTs(r.created_at ?? r.submitted_at)}</td>
                        <td className="px-4 py-3 text-xs font-bold">
                          {mentorApprovalStatusLabel(mentorApprovalStatusRaw(r, props.statusColumn))}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </div>

        <aside className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm xl:sticky xl:top-6 xl:self-start">
          {!selectedSchoolVerification && !selected ? (
            <p className="text-sm text-slate-500">목록에서 심사할 항목을 선택하세요.</p>
          ) : (
            <div className="space-y-5">
              {selectedSchoolVerification ? (
                <section className="space-y-4">
                  <div>
                    <h2 className="text-lg font-black text-slate-900">학교·전공 검증</h2>
                    <p className="mt-1 text-xs text-slate-500">
                      {displayName(null, selectedSchoolUser, selectedSchoolProfile)}
                      {selectedSchoolUser?.email ? ` · ${selectedSchoolUser.email}` : ""} ·{" "}
                      {schoolVerificationStatusLabel(selectedSchoolVerification.status)}
                    </p>
                  </div>

                  <dl className="grid grid-cols-2 gap-2 rounded-xl border border-slate-100 bg-slate-50 p-3 text-xs">
                    <div>
                      <dt className="font-bold text-slate-500">멘토 자유입력 학교</dt>
                      <dd className="mt-1 text-slate-900">{textOrDash(selectedSchoolProfile?.university_name)}</dd>
                    </div>
                    <div>
                      <dt className="font-bold text-slate-500">멘토 자유입력 학과</dt>
                      <dd className="mt-1 text-slate-900">{textOrDash(selectedSchoolProfile?.department_name)}</dd>
                    </div>
                    <div>
                      <dt className="font-bold text-slate-500">제출일</dt>
                      <dd className="mt-1 text-slate-900">{formatTs(selectedSchoolVerification.created_at)}</dd>
                    </div>
                    <div>
                      <dt className="font-bold text-slate-500">문서 경로</dt>
                      <dd className="mt-1 truncate text-slate-900" title={selectedSchoolVerification.document_storage_ref ?? ""}>
                        {textOrDash(selectedSchoolVerification.document_storage_ref)}
                      </dd>
                    </div>
                  </dl>

                  {selectedSchoolDocumentUrl ? (
                    <div className="space-y-2">
                      <iframe
                        src={selectedSchoolDocumentUrl}
                        title="학교·전공 증명 서류"
                        className="h-72 w-full rounded-xl border border-slate-200 bg-slate-50"
                      />
                      <a
                        href={selectedSchoolDocumentUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex w-full items-center justify-center rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50"
                      >
                        새 창에서 서류 열기
                      </a>
                    </div>
                  ) : (
                    <p className="rounded-xl border border-dashed border-slate-200 py-8 text-center text-xs text-slate-500">
                      서류 signed URL을 만들 수 없습니다.
                    </p>
                  )}

                  {selectedSchoolTierSuggestion ? (
                    <div className="rounded-xl border border-blue-100 bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-950">
                      학교군 추천: {selectedSchoolTierSuggestion.schoolName} → {selectedSchoolTierSuggestion.schoolTierLabel}
                      {selectedSchoolTierSuggestion.note ? (
                        <span className="ml-1 text-blue-900/80">({selectedSchoolTierSuggestion.note})</span>
                      ) : null}
                    </div>
                  ) : null}

                  <form action={approveMentorSchoolVerificationAction} className="space-y-3 border-t border-slate-100 pt-4">
                    <input type="hidden" name="verificationId" value={selectedSchoolVerification.id} />
                    <label className="block text-xs font-bold text-slate-700">
                      검증 학교명
                      <input
                        name="verifiedUniversityName"
                        required
                        defaultValue={selectedSchoolVerification.verified_university_name ?? ""}
                        placeholder="예: 서울대학교"
                        className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-900"
                      />
                    </label>
                    <label className="block text-xs font-bold text-slate-700">
                      정규화 학교 키
                      <input
                        name="verifiedUniversityId"
                        defaultValue={selectedSchoolVerification.verified_university_id ?? ""}
                        placeholder="비우면 학교명 기반으로 자동 생성"
                        className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900"
                      />
                    </label>
                    <label className="block text-xs font-bold text-slate-700">
                      검증 학과명
                      <input
                        name="verifiedDepartmentName"
                        required
                        defaultValue={selectedSchoolVerification.verified_department_name ?? ""}
                        placeholder="예: 치의학과"
                        className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-900"
                      />
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      <label className="block text-xs font-bold text-slate-700">
                        전공 계열
                        <select
                          name="verifiedMajorCategory"
                          required
                          defaultValue={selectedSchoolVerification.verified_major_category ?? ""}
                          className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900"
                        >
                          <option value="" disabled>
                            선택
                          </option>
                          {props.majorCategoryOptions.map((category) => (
                            <option key={category.code} value={category.code}>
                              {category.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="block text-xs font-bold text-slate-700">
                        학교군
                        <select
                          name="schoolTier"
                          required
                          defaultValue={selectedSchoolVerification.school_tier ?? "미분류"}
                          className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900"
                        >
                          {props.schoolTierOptions.map((tier) => (
                            <option key={tier.code} value={tier.code}>
                              {tier.label}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <FormSubmitButton
                      idleLabel="검증값 저장 후 승인"
                      pendingLabel="승인 중..."
                      className="w-full rounded-xl bg-[#2563EB] py-2.5 text-sm font-bold text-white disabled:opacity-60"
                    />
                  </form>

                  <div className="grid gap-3 border-t border-slate-100 pt-4">
                    <form action={requestMentorSchoolVerificationResubmitAction} className="space-y-2">
                      <input type="hidden" name="verificationId" value={selectedSchoolVerification.id} />
                      <textarea
                        name="rejectReason"
                        required
                        rows={2}
                        placeholder="재제출 요청 사유"
                        className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                      />
                      <FormSubmitButton
                        idleLabel="재제출 요청"
                        pendingLabel="요청 중..."
                        className="w-full rounded-xl border border-amber-300 bg-amber-50 py-2.5 text-sm font-bold text-amber-950 disabled:opacity-60"
                      />
                    </form>
                    <form action={rejectMentorSchoolVerificationAction} className="space-y-2">
                      <input type="hidden" name="verificationId" value={selectedSchoolVerification.id} />
                      <textarea
                        name="rejectReason"
                        required
                        rows={2}
                        placeholder="반려 사유"
                        className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                      />
                      <FormSubmitButton
                        idleLabel="반려"
                        pendingLabel="반려 중..."
                        className="w-full rounded-xl bg-red-600 py-2.5 text-sm font-bold text-white hover:bg-red-700 disabled:opacity-60"
                      />
                    </form>
                  </div>
                </section>
              ) : null}

              {selected ? (
                <section className="space-y-4 border-t border-slate-100 pt-5">
                  <h2 className="text-lg font-black text-slate-900">{displayName(selected, user)}</h2>
                  {user?.email ? (
                    <a href={`mailto:${user.email}`} className="block text-xs font-semibold text-blue-700 hover:underline">
                      {user.email}
                    </a>
                  ) : (
                    <p className="text-xs text-slate-500">—</p>
                  )}
                  <p className="text-xs text-slate-500">
                    멘토 승인 상태: {mentorApprovalStatusLabel(mentorApprovalStatusRaw(selected, props.statusColumn))}
                  </p>
                  {img ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={img} alt="학생증" className="max-h-48 w-full rounded-xl border object-contain" />
                  ) : props.studentIdImageStoredByUserId?.[mentorUserId] ? (
                    <p className="rounded-xl border border-dashed border-amber-300 bg-amber-50 py-8 text-center text-xs font-semibold text-amber-900">
                      학생증 이미지를 불러오지 못했습니다. 잠시 후 새로고침하거나 스토리지 설정을 확인해 주세요.
                    </p>
                  ) : (
                    <p className="rounded-xl border border-dashed border-slate-200 py-8 text-center text-xs text-slate-500">
                      학생증 미제출 — 아래 &lsquo;추가 서류 요청&rsquo;으로 재제출을 안내해 주세요.
                    </p>
                  )}
                  {mentorUserId ? (
                    <div className="space-y-2 border-t border-slate-100 pt-4">
                      <form action={approveMentorApplicationAction} className="space-y-2">
                        <input type="hidden" name="mentorUserId" value={mentorUserId} />
                        <input name="adminNote" placeholder="승인 메모(선택)" className="w-full rounded-lg border px-3 py-2 text-sm" />
                        <button type="submit" className="w-full rounded-xl bg-[#2563EB] py-2.5 text-sm font-bold text-white">
                          승인
                        </button>
                      </form>
                      <form action={requestMentorDocumentsAction} className="space-y-2">
                        <input type="hidden" name="mentorUserId" value={mentorUserId} />
                        <input name="adminNote" placeholder="추가 서류 요청 사유" className="w-full rounded-lg border px-3 py-2 text-sm" />
                        <button type="submit" className="w-full rounded-xl border border-amber-300 bg-amber-50 py-2.5 text-sm font-bold text-amber-950">
                          추가 서류 요청
                        </button>
                      </form>
                      <button
                        type="button"
                        onClick={() => setRejectOpen(true)}
                        className="w-full rounded-xl bg-red-600 py-2.5 text-sm font-bold text-white hover:bg-red-700"
                      >
                        반려
                      </button>
                    </div>
                  ) : null}
                </section>
              ) : null}
            </div>
          )}
        </aside>
      </div>

      {rejectOpen && selected && mentorUserId ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-xl">
            <h3 className="text-lg font-black text-slate-900">반려 사유 입력</h3>
            <p className="mt-1 text-xs text-slate-500">{displayName(selected, user)} 멘토 신청을 반려합니다.</p>
            <form action={rejectMentorApplicationAction} className="mt-4 space-y-3">
              <input type="hidden" name="mentorUserId" value={mentorUserId} />
              <textarea
                name="rejectionReason"
                required
                rows={4}
                placeholder="반려 사유를 입력해 주세요."
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setRejectOpen(false)}
                  className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm font-bold text-slate-700"
                >
                  취소
                </button>
                <button type="submit" className="flex-1 rounded-xl bg-red-600 py-2.5 text-sm font-bold text-white">
                  반려 확정
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
