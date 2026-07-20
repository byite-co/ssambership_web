"use client";

import Link from "next/link";
import { useRef, useState, type ReactNode } from "react";
import { FormSubmitButton } from "@/components/common/FormSubmitButton";
import { submitMentorProfileEdit } from "@/lib/mentor/mentorProfileEditActions";
import type { MentorProfileDisplay } from "@/lib/mentor/mentorDisplayFields";
import { mentorVerificationKo } from "@/lib/mentor/mentorDisplayFields";
import { MentorPublicProfilePreviewCard } from "@/components/mentor/MentorPublicProfilePreviewCard";
import { SUBSCRIBE_PLAN_CATALOG } from "@/lib/subscribe/subscribePlanCatalog";
import {
  isOutsideMentorPriceGuide,
  mentorPlanCashKrw,
  mentorSubscriptionPriceRule,
} from "@/lib/subscribe/mentorPlanPricing";
import { Camera, HelpCircle, PlayCircle, Info, LayoutGrid, Video, Plus, User, FileText, BookOpen, Coins, ShieldCheck, Lock } from "lucide-react";
import { MentorSubjectCheckboxes } from "@/components/subjects/MentorSubjectCheckboxes";
import { subjectCodesFromText } from "@/lib/subjects/subjectCatalog";

type Q = { 
  row: Record<string, unknown> | null; 
  err: string | null; 
  media: { rows: Record<string, unknown>[]; table: string | null; error: string | null };
  byTier?: Record<string, Record<string, unknown> | null> | null;
};
type I = {
  intro: string;
  bio?: string;
  university: string;
  department: string; 
  subjects: string; 
  highSchool: string; 
  tags: string; 
  subOpen: boolean;
  photoUrl: string;
  verification: string;
  /** 인증서류(학생증) 제출 여부. boolean 만 — 원본/서명 URL 은 절대 폼에 전달되지 않는다(avatar 와 완전 분리). */
  documentSubmitted?: boolean;
  displayName?: string;
  grade?: string;
  individualQuestionPriceCash?: number | null;
};

const inputClass =
  "min-h-[48px] w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm font-medium text-slate-700 placeholder:text-slate-400 transition focus:border-emerald-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/30";

const labelClass = "flex items-center gap-1.5 text-sm font-extrabold text-slate-900";

function priceInputName(tier: string): string {
  return `subscriptionPriceKrw_${tier}`;
}

function SectionHeader(props: { number: string; title: string; required?: boolean; optional?: boolean; icon?: ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b border-slate-100 pb-4">
      <div className="flex items-center gap-2.5">
        {props.icon ? (
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-[#ECFDF5] text-[#059669]">
            {props.icon}
          </span>
        ) : null}
        <h2 className="text-lg font-black text-slate-900">
          <span className="mr-1.5">{props.number}.</span>
          {props.title}
        </h2>
        {props.required && (
          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-600 ring-1 ring-emerald-100">
            필수
          </span>
        )}
        {props.optional && (
          <span className="rounded-full bg-slate-50 px-2 py-0.5 text-[10px] font-bold text-slate-500 ring-1 ring-slate-200">
            선택
          </span>
        )}
      </div>
    </div>
  );
}

export function MentorProfileEditForm(props: {
  initial: I;
  query: Q;
  accountEmail?: string | null;
  ok: boolean;
  errorMessage: string | null;
}) {
  const { initial, query, ok, errorMessage } = props;

  // Real-time preview state
  const [formData, setFormData] = useState({
    nickname: initial.displayName || "",
    university: initial.university || "",
    department: initial.department || "",
    highSchool: initial.highSchool || "",
    grade: initial.grade || "",
    intro: initial.intro || "",
    bio: initial.bio || "",
    career: "", // Actual career column would need to be added to lib/mentor/mentorDisplayFields.ts
    subjects: initial.subjects || "",
    answerStyle: "",
    subOpen: initial.subOpen,
  });
  const [planPrices, setPlanPrices] = useState(() =>
    Object.fromEntries(
      SUBSCRIBE_PLAN_CATALOG.map((plan) => [
        plan.tier,
        String(mentorPlanCashKrw(query.byTier?.[plan.tier] ?? null, plan.tier)),
      ]),
    ) as Record<string, string>,
  );
  const [individualQuestionPrice, setIndividualQuestionPrice] = useState(
    initial.individualQuestionPriceCash != null && initial.individualQuestionPriceCash > 0
      ? String(initial.individualQuestionPriceCash)
      : "",
  );
  // 서버가 가격 밴드를 강제하므로, 밴드 밖·무효 가격이면 제출 자체를 막아
  // "일부만 저장된 채 실패" 상태를 예방한다.
  const planPriceBlocked = SUBSCRIBE_PLAN_CATALOG.some((plan) => {
    const rule = mentorSubscriptionPriceRule(plan.tier);
    const n = Number(planPrices[plan.tier] ?? String(rule.recommendedCashKrw));
    return !Number.isFinite(n) || n <= 0 || isOutsideMentorPriceGuide(n, plan.tier);
  });

  // 프로필 사진: 숨김 file input + 클라이언트 검증(5MB·이미지) + 원형 미리보기.
  // 실제 업로드는 폼 제출 시 서버액션(submitMentorProfileEdit)에서 처리.
  const photoInputRef = useRef<HTMLInputElement>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);

  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.target;
    const file = input.files?.[0];
    if (!file) {
      setPhotoPreview(null);
      setPhotoError(null);
      return;
    }
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) {
      setPhotoError("JPG, PNG, WEBP 이미지만 올릴 수 있어요.");
      input.value = "";
      setPhotoPreview(null);
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setPhotoError("이미지는 최대 5MB까지 올릴 수 있어요.");
      input.value = "";
      setPhotoPreview(null);
      return;
    }
    setPhotoError(null);
    setPhotoPreview(URL.createObjectURL(file));
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target;
    const val = type === "checkbox" ? (e.target as HTMLInputElement).checked : value;
    setFormData((prev) => ({ ...prev, [name]: val }));
  };

  const handlePlanPriceChange = (tier: string, value: string) => {
    setPlanPrices((prev) => ({ ...prev, [tier]: value }));
  };

  // 담당과목: formData.subjects(콤마 결합)에서 정본 code 파생. 토글 시 code 결합으로 갱신.
  // (미선택/레거시 자유텍스트는 첫 토글 전까지 그대로 보존 — 강제 변환 없음)
  const subjectCodes = subjectCodesFromText(formData.subjects);
  const toggleSubjectCode = (code: string) => {
    const next = new Set(subjectCodes);
    if (next.has(code)) next.delete(code);
    else next.add(code);
    setFormData((prev) => ({ ...prev, subjects: [...next].join(",") }));
  };

  // 취소: 저장 전 staged 상태(입력·가격·사진 미리보기)를 원래 값으로 복원한다.
  const handleReset = () => {
    setFormData({
      nickname: initial.displayName || "",
      university: initial.university || "",
      department: initial.department || "",
      highSchool: initial.highSchool || "",
      grade: initial.grade || "",
      intro: initial.intro || "",
      bio: initial.bio || "",
      career: "",
      subjects: initial.subjects || "",
      answerStyle: "",
      subOpen: initial.subOpen,
    });
    setPlanPrices(
      Object.fromEntries(
        SUBSCRIBE_PLAN_CATALOG.map((plan) => [
          plan.tier,
          String(mentorPlanCashKrw(query.byTier?.[plan.tier] ?? null, plan.tier)),
        ]),
      ) as Record<string, string>,
    );
    setIndividualQuestionPrice(
      initial.individualQuestionPriceCash != null && initial.individualQuestionPriceCash > 0
        ? String(initial.individualQuestionPriceCash)
        : "",
    );
    setPhotoPreview(null);
    setPhotoError(null);
    if (photoInputRef.current) photoInputRef.current.value = "";
  };

  const previewDisplay: MentorProfileDisplay = {
    displayName: formData.nickname || initial.displayName || "",
    university: formData.university,
    department: formData.department,
    highSchool: formData.highSchool,
    grade: formData.grade,
    intro: formData.intro,
    bio: formData.bio,
    subjects: formData.subjects,
    tags: initial.tags,
    subOpen: formData.subOpen,
    photoUrl: photoPreview ?? initial.photoUrl,
    verification: initial.verification,
  };

  const lastSavedStr = query.row?.updated_at
    ? new Date(query.row.updated_at as string).toLocaleString("ko-KR", {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "기록 없음";

  return (
    <div className="mx-auto w-full max-w-[1400px] px-4 py-8">
      {/* Header Area */}
      <div className="mb-10 flex flex-col items-start justify-between gap-4 border-b border-slate-100 pb-8 sm:flex-row sm:items-end">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-slate-900 sm:text-3xl">멘토 프로필 관리</h1>
          <p className="mt-2 text-sm font-medium text-slate-500">기본 정보·소개·과목·요금제·인증 서류를 관리하세요.</p>
        </div>
        <div className="flex items-center gap-4">
          <p suppressHydrationWarning className="text-xs font-medium text-slate-400">마지막 저장: {lastSavedStr}</p>
        </div>
      </div>

      <form action={submitMentorProfileEdit} className="grid grid-cols-1 gap-10 lg:grid-cols-12">
        {/* Left Column: Form Fields */}
        <div className="space-y-12 lg:col-span-7">
          {ok && (
            <p className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-900">성공적으로 저장되었습니다.</p>
          )}
          {errorMessage && (
            <p className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-900">{errorMessage}</p>
          )}

          {/* 1. 기본 정보 */}
          <section className="space-y-6 rounded-2xl border border-l-[4px] border-slate-300 border-l-[#059669] bg-white p-5 shadow-[0_1px_4px_rgba(0,0,0,0.05)] sm:p-6">
            <SectionHeader number="1" title="기본 정보" required icon={<User className="h-4 w-4" aria-hidden />} />
            
            <div className="flex flex-col gap-8 sm:flex-row sm:items-start">
              <div className="flex flex-col items-center gap-3">
                <p className="w-full text-xs font-extrabold text-slate-500">프로필 사진</p>
                <div className="relative h-24 w-24 overflow-hidden rounded-full border-2 border-slate-100 bg-slate-50 shadow-inner">
                  {photoPreview ?? initial.photoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={photoPreview ?? initial.photoUrl} alt="프로필 사진" className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-slate-300">
                      <Camera className="h-8 w-8" />
                    </div>
                  )}
                </div>
                <input
                  ref={photoInputRef}
                  type="file"
                  name="profileImage"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={handlePhotoChange}
                  className="sr-only"
                />
                <button
                  type="button"
                  onClick={() => photoInputRef.current?.click()}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 shadow-sm transition hover:bg-slate-50"
                >
                  사진 변경
                </button>
                {photoError ? (
                  <p className="text-center text-[10px] font-bold text-red-600">{photoError}</p>
                ) : null}
                <div className="text-center text-[10px] leading-relaxed text-slate-400">
                  권장 사이즈: 400x400px (JPG, PNG, WEBP)<br />최대 5MB
                </div>
              </div>

              <div className="flex-1 space-y-5">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className={labelClass} htmlFor="nickname">이름</label>
                    <div className="relative mt-1.5">
                      <input
                        id="nickname"
                        name="nickname"
                        placeholder="닉네임을 입력해주세요"
                        className={inputClass}
                        value={formData.nickname}
                        onChange={handleChange}
                        maxLength={20}
                      />
                    </div>
                  </div>
                  <div>
                    <label className={labelClass} htmlFor="grade">학번 (예: 22학번)</label>
                    <div className="relative mt-1.5">
                      <input
                        id="grade"
                        name="grade"
                        className={inputClass}
                        placeholder="22학번"
                        value={formData.grade}
                        onChange={handleChange}
                        maxLength={20}
                      />
                    </div>
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-1">
                  <div>
                    <label className={labelClass} htmlFor="department">
                      전공(학과) <span className="ml-0.5 text-red-500">*</span>
                      <span className="ml-1 inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-500 ring-1 ring-slate-200">
                        <Lock className="h-3 w-3" aria-hidden /> 잠금
                      </span>
                    </label>
                    <div className="relative mt-1.5">
                      <input
                        id="department"
                        name="department"
                        placeholder="전공 학과를 입력해주세요"
                        className={`${inputClass} cursor-not-allowed bg-slate-50 text-slate-500`}
                        value={formData.department}
                        readOnly
                        aria-readonly="true"
                        maxLength={40}
                      />
                    </div>
                    <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                      <p className="text-[11px] font-medium text-slate-500">
                        학과 정보는 인증값이라 직접 수정할 수 없어요. 변경이 필요하면 요청해 주세요.
                      </p>
                      <Link
                        href="/mentor/academic-record-change"
                        className="inline-flex items-center gap-1 rounded-lg border border-[#059669] bg-emerald-50 px-3 py-1.5 text-xs font-extrabold text-[#059669] transition hover:bg-emerald-100"
                      >
                        <FileText className="h-3.5 w-3.5" aria-hidden /> 학적변경요청
                      </Link>
                    </div>
                  </div>
                </div>

                <div>
                  <label className={labelClass} htmlFor="highSchool">출신 고등학교 <span className="ml-0.5 text-red-500">*</span></label>
                  <div className="relative mt-1.5">
                    <input
                      id="highSchool"
                      name="highSchool"
                      placeholder="출신 고등학교를 입력해주세요"
                      className={inputClass}
                      value={formData.highSchool}
                      onChange={handleChange}
                      maxLength={40}
                    />
                  </div>
                </div>

                <div>
                  <label className={labelClass} htmlFor="university">
                    대학교 <span className="ml-0.5 text-red-500">*</span>
                    <span className="ml-1 inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-500 ring-1 ring-slate-200">
                      <Lock className="h-3 w-3" aria-hidden /> 잠금
                    </span>
                  </label>
                  <div className="relative mt-1.5">
                    <input
                      id="university"
                      name="university"
                      placeholder="대학교를 입력해주세요"
                      className={`${inputClass} cursor-not-allowed bg-slate-50 text-slate-500`}
                      value={formData.university}
                      readOnly
                      aria-readonly="true"
                      maxLength={40}
                    />
                  </div>
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                    <p className="text-[11px] font-medium text-slate-500">
                      학교 정보는 인증값이라 직접 수정할 수 없어요. 변경이 필요하면 요청해 주세요.
                    </p>
                    <Link
                      href="/mentor/academic-record-change"
                      className="inline-flex items-center gap-1 rounded-lg border border-[#059669] bg-emerald-50 px-3 py-1.5 text-xs font-extrabold text-[#059669] transition hover:bg-emerald-100"
                    >
                      <FileText className="h-3.5 w-3.5" aria-hidden /> 학적변경요청
                    </Link>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* 2. 소개 */}
          <section className="space-y-6 rounded-2xl border border-l-[4px] border-slate-300 border-l-[#059669] bg-white p-5 shadow-[0_1px_4px_rgba(0,0,0,0.05)] sm:p-6">
            <SectionHeader number="2" title="소개" required icon={<FileText className="h-4 w-4" aria-hidden />} />
            
            <div className="space-y-5">
              <div>
                <label className={labelClass} htmlFor="intro">한줄 소개 <span className="ml-0.5 text-red-500">*</span></label>
                <div className="relative mt-1.5">
                  <input
                    id="intro"
                    name="intro"
                    placeholder="대표 한줄 소개를 입력해주세요"
                    className={inputClass}
                    value={formData.intro}
                    onChange={handleChange}
                    maxLength={50}
                  />
                  <p className="mt-1 text-right text-[10px] font-medium text-slate-400">{formData.intro.length}/50</p>
                </div>
              </div>

              <div>
                <label className={labelClass} htmlFor="bio">상세 소개 <span className="ml-0.5 text-red-500">*</span></label>
                <div className="relative mt-1.5">
                  <textarea
                    id="bio"
                    name="bio"
                    placeholder="멘토링 스타일, 경력, 강점을 자세히 적어주세요"
                    rows={6}
                    className={`${inputClass} min-h-[140px] py-3 resize-none`}
                    value={formData.bio}
                    onChange={handleChange}
                    maxLength={500}
                  />
                  <p className="mt-1 text-right text-[10px] font-medium text-slate-400">{formData.bio.length}/500</p>
                </div>
              </div>
            </div>
          </section>

          {/* 3. 전공 및 과목 */}
          <section className="space-y-6 rounded-2xl border border-l-[4px] border-slate-300 border-l-[#059669] bg-white p-5 shadow-[0_1px_4px_rgba(0,0,0,0.05)] sm:p-6">
            <SectionHeader number="3" title="전공 및 과목" required icon={<BookOpen className="h-4 w-4" aria-hidden />} />
            <div>
              <label className={labelClass}>담당 과목</label>
              <p className="mt-1 text-xs font-medium text-slate-500">
                가르치는 과목을 모두 선택하세요. 대분류를 펼쳐 세부 과목을 고를 수 있어요.
              </p>
              <div className="mt-2">
                <MentorSubjectCheckboxes selected={subjectCodes} onToggle={toggleSubjectCode} />
              </div>
              {subjectCodes.length === 0 ? (
                <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs font-bold leading-relaxed text-amber-900">
                  활동(구독 공개)하려면 담당 과목을 1개 이상 지정하세요. 과목을 설정하기 전에는 멘토 찾기에 노출되지 않고 새 구독을 받을 수 없어요.
                </p>
              ) : null}
              {/* 저장은 기존 경로 유지: name="subjects" 콤마 결합 code. (mutation이 split→text[]) */}
              <input type="hidden" name="subjects" value={formData.subjects} />
              <input type="hidden" name="tags" value={initial.tags} />
            </div>
          </section>

          {/* 4. 요금제 */}
          <section className="space-y-4 rounded-2xl border border-l-[4px] border-slate-300 border-l-[#059669] bg-white p-5 shadow-[0_1px_4px_rgba(0,0,0,0.05)] sm:p-6">
            <SectionHeader number="4" title="요금제 설정" icon={<Coins className="h-4 w-4" aria-hidden />} />
            <p className="text-xs font-medium text-slate-500">
              구독 요금은 멘토가 직접 설정할 수 있어요. 각 플랜의 가격 범위 안에서만 저장할 수 있습니다.
            </p>
            <div className="grid gap-3 sm:grid-cols-3">
              {SUBSCRIBE_PLAN_CATALOG.map((plan) => {
                const rule = mentorSubscriptionPriceRule(plan.tier);
                const rawValue = planPrices[plan.tier] ?? String(rule.recommendedCashKrw);
                const numericValue = Number(rawValue);
                const invalid = !Number.isFinite(numericValue) || numericValue <= 0;
                const outsideGuide = !invalid && isOutsideMentorPriceGuide(numericValue, plan.tier);
                return (
                  <div
                    key={plan.tier}
                    className={`rounded-xl border p-4 ${
                      plan.recommend ? "border-2 border-[#059669] bg-emerald-50/30" : "border-slate-200 bg-slate-50/50"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-black text-slate-900">{plan.label}</p>
                        <p className="mt-1 text-[11px] font-semibold text-slate-600">{plan.weeklyLabel}</p>
                      </div>
                      {plan.recommend ? (
                        <span className="rounded-full bg-emerald-600 px-2 py-0.5 text-[10px] font-extrabold text-white">
                          추천
                        </span>
                      ) : null}
                    </div>
                    <label className="mt-3 block text-[11px] font-extrabold text-slate-500" htmlFor={priceInputName(plan.tier)}>
                      월 구독 캐시
                    </label>
                    <div className="mt-1.5 flex items-center gap-2">
                      <input
                        id={priceInputName(plan.tier)}
                        name={priceInputName(plan.tier)}
                        type="number"
                        inputMode="numeric"
                        min={1}
                        step={1}
                        className={inputClass}
                        value={rawValue}
                        onChange={(e) => handlePlanPriceChange(plan.tier, e.target.value)}
                      />
                      <span className="shrink-0 text-xs font-bold text-slate-500">캐시</span>
                    </div>
                    <p className="mt-2 whitespace-nowrap text-[10px] font-semibold text-slate-500">
                      범위 {rule.minCashKrw.toLocaleString("ko-KR")}~{rule.maxCashKrw.toLocaleString("ko-KR")}
                    </p>
                    {invalid ? (
                      <p className="mt-2 rounded-lg border border-red-200 bg-red-50 px-2 py-1.5 text-[10px] font-bold text-red-700">
                        1캐시 이상 입력해 주세요.
                      </p>
                    ) : outsideGuide ? (
                      <p className="mt-2 rounded-lg border border-red-200 bg-red-50 px-2 py-1.5 text-[10px] font-bold text-red-700">
                        가격 범위를 벗어나 저장할 수 없어요.
                      </p>
                    ) : null}
                  </div>
                );
              })}
            </div>

            {/* 개별 질문 답변 단가 — 구독 요금제와 별개 */}
            <div className="rounded-xl border-2 border-dashed border-emerald-200 bg-emerald-50/40 p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-black text-slate-900">개별 질문 답변 단가</p>
                <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-bold text-emerald-600 ring-1 ring-emerald-100">
                  구독과 별개
                </span>
              </div>
              <p className="mt-1 text-xs font-medium text-slate-500">
                학생이 나를 지정해 보내는 단건(지정형) 개별 질문의 답변 단가예요. 구독 요금제와 무관하며, 자유롭게 설정할 수 있어요.
                비워 두면 지정형 개별 질문을 받지 않습니다.
              </p>
              <label
                className="mt-3 block text-[11px] font-extrabold text-slate-500"
                htmlFor="individualQuestionPriceCash"
              >
                답변 단가 (캐시)
              </label>
              <div className="mt-1.5 flex max-w-xs items-center gap-2">
                <input
                  id="individualQuestionPriceCash"
                  name="individualQuestionPriceCash"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  step={1}
                  placeholder="예: 5000"
                  className={inputClass}
                  value={individualQuestionPrice}
                  onChange={(e) => setIndividualQuestionPrice(e.target.value)}
                />
                <span className="shrink-0 text-xs font-bold text-slate-500">캐시</span>
              </div>
            </div>
          </section>

          {/* 5. 인증 서류 */}
          <section className="space-y-4 rounded-2xl border border-l-[4px] border-slate-300 border-l-[#059669] bg-white p-5 shadow-[0_1px_4px_rgba(0,0,0,0.05)] sm:p-6">
            <SectionHeader number="5" title="인증 서류" icon={<ShieldCheck className="h-4 w-4" aria-hidden />} />
            <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-4">
              {/* [분리] 아바타 상태와 인증서류 상태를 완전히 분리한다.
                  - 서류 제출 여부: student_id_image_url 존재(boolean)만으로 판정(아바타와 무관).
                  - 인증(승인) 상태: verification_status. 서류 원본·아바타 이미지는 이 영역에 미리보기하지 않는다. */}
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-bold text-slate-800">서류 제출</span>
                <span
                  className={`rounded-full px-2.5 py-0.5 text-xs font-bold ring-1 ${
                    initial.documentSubmitted
                      ? "bg-emerald-50 text-emerald-700 ring-emerald-100"
                      : "bg-slate-100 text-slate-500 ring-slate-200"
                  }`}
                >
                  {initial.documentSubmitted ? "제출됨" : "미제출"}
                </span>
                <span className="h-3 w-px bg-slate-200" aria-hidden />
                <span className="text-sm font-bold text-slate-800">인증 상태</span>
                <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-bold text-[#059669] ring-1 ring-emerald-100">
                  {mentorVerificationKo(initial.verification)}
                </span>
              </div>
              {/* [보안] 학생증(민감 문서)·아바타 이미지를 이 영역에 미리보기로 노출하지 않는다.
                  제출 상태 배지와 인증 페이지 링크만 제공한다(학생증 원본은 인증 페이지에서만 확인). */}
              <p className="mt-2 text-xs font-medium text-slate-500">
                학생증 원본은 보안을 위해 이 화면에 표시하지 않아요. 제출·재제출은 인증 페이지에서 진행할 수 있어요.
              </p>
              <Link
                href="/mentor/verification"
                className="mt-3 inline-block text-xs font-bold text-[#059669] hover:underline"
              >
                인증 서류 제출하기 &gt;
              </Link>
            </div>
            {/* 과목 0개면 구독 공개를 켜지 않는다(저장은 통과, 구독만 닫힘) — 과목 필수 게이트 */}
            {formData.subOpen && subjectCodes.length > 0 ? (
              <input type="hidden" name="subscribeOpen" value="on" />
            ) : null}
          </section>

          {/* 6. 대표 콘텐츠 설정 */}
          <section className="space-y-6 rounded-2xl border border-l-[4px] border-slate-300 border-l-[#059669] bg-white p-5 shadow-[0_1px_4px_rgba(0,0,0,0.05)] sm:p-6">
            <SectionHeader number="6" title="대표 콘텐츠 설정" optional icon={<LayoutGrid className="h-4 w-4" aria-hidden />} />
            
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <button 
                type="button" 
                disabled
                className="flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50/50 p-6 opacity-75 cursor-not-allowed"
              >
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white shadow-sm ring-1 ring-slate-100">
                  <LayoutGrid className="h-6 w-6 text-slate-400" />
                </div>
                <div className="text-center">
                  <p className="text-sm font-bold text-slate-700">커뮤니티 게시글 추가</p>
                  <p className="mt-1 text-[11px] font-medium text-slate-400">작성한 글을 대표 콘텐츠로 등록</p>
                </div>
                <div className="mt-2 flex items-center gap-1 rounded-lg bg-slate-100 px-2 py-1 text-[10px] font-bold text-slate-500">
                  <Plus className="h-3 w-3" /> 준비 중
                </div>
              </button>

              <button 
                type="button" 
                disabled
                className="flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50/50 p-6 opacity-75 cursor-not-allowed"
              >
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white shadow-sm ring-1 ring-slate-100">
                  <Video className="h-6 w-6 text-slate-400" />
                </div>
                <div className="text-center">
                  <p className="text-sm font-bold text-slate-700">숏폼 영상 추가</p>
                  <p className="mt-1 text-[11px] font-medium text-slate-400">업로드한 숏폼을 대표 콘텐츠로 등록</p>
                </div>
                <div className="mt-2 flex items-center gap-1 rounded-lg bg-slate-100 px-2 py-1 text-[10px] font-bold text-slate-500">
                  <Plus className="h-3 w-3" /> 준비 중
                </div>
              </button>
            </div>
            
            <p className="text-[11px] font-medium text-slate-400 text-center bg-slate-50 py-2 rounded-lg border border-slate-100 border-dashed">
              대표 콘텐츠 연결 기능은 준비 중입니다. (게시글 및 숏폼 선택 기능)
            </p>

            <div className="rounded-xl border border-slate-100 bg-white p-4">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-bold text-slate-500">현재 등록된 대표 콘텐츠 ({query.media.rows.length})</h4>
              </div>
              {query.media.rows.length > 0 ? (
                <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {query.media.rows.map((r, i) => (
                    <div key={i} className="group relative aspect-video overflow-hidden rounded-lg bg-slate-100 ring-1 ring-slate-200 transition hover:ring-emerald-500">
                      <div className="absolute inset-0 flex items-center justify-center bg-black/5">
                        <PlayCircle className="h-8 w-8 text-white/80" />
                      </div>
                      <button type="button" className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/50 text-white opacity-0 transition group-hover:opacity-100">
                        <Plus className="h-3 w-3 rotate-45" />
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="mt-4 flex flex-col items-center justify-center rounded-lg border border-slate-50 bg-slate-50/30 py-10">
                  <p className="text-xs font-medium text-slate-400">등록된 콘텐츠가 없습니다. 위 버튼을 통해 추가해주세요.</p>
                </div>
              )}
            </div>
          </section>

          <div className="flex items-center gap-3 rounded-xl bg-emerald-50/50 p-4">
            <Info className="h-5 w-5 text-emerald-500" />
            <p className="text-xs font-bold text-emerald-800">입력한 정보는 프로필(채널)에 공개되며, 언제든지 수정할 수 있습니다.</p>
          </div>

          <div className="flex items-center justify-between gap-4 pt-6">
            <button
              type="button"
              onClick={handleReset}
              className="min-h-[52px] flex-1 rounded-xl border border-slate-200 bg-white px-8 text-sm font-extrabold text-slate-600 transition hover:bg-slate-50"
            >
              취소
            </button>
            <FormSubmitButton
              idleLabel="저장하기"
              pendingLabel="저장 중…"
              disabled={planPriceBlocked}
              className="min-h-[52px] flex-[2] rounded-xl bg-emerald-600 px-8 text-sm font-extrabold text-white shadow-md transition hover:bg-emerald-700 disabled:bg-slate-300"
            />
            <p className="hidden text-[11px] font-bold text-slate-400 sm:block">변경 사항은 저장 즉시 반영됩니다.</p>
          </div>
        </div>

        {/* Right Column: Preview */}
        <div className="lg:col-span-5">
          <div className="space-y-6">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-black text-slate-900">학생에게 보여지는 프로필 미리보기</h2>
              <HelpCircle className="h-4 w-4 text-slate-300" />
            </div>
            <p className="text-sm font-medium text-slate-500">실제 학생들이 보는 화면이에요.</p>

            {/* Preview Card */}
            <MentorPublicProfilePreviewCard
              variant="preview"
              display={previewDisplay}
              stats={{ mediaCount: query.media.rows.length, byTier: query.byTier }}
              mediaPreviewSlots={query.media.rows.length}
              footerNote="실제 학생에게 보이는 공개 프로필과 동일한 요약입니다."
            />
          </div>
        </div>
      </form>
    </div>
  );
}
