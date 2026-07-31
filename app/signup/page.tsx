"use client";

import { FREE_QUESTION_PER_MENTOR_LIMIT, FREE_QUESTION_TOTAL_LIMIT } from "@/lib/mentor/freeQuestionPolicy";
import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { BookOpen, Check, GraduationCap } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { AuthPageLayout } from "@/components/auth/AuthPageLayout";
import { SignupStepBar } from "@/components/auth/SignupStepBar";
import { StudentSignupForm, type StudentSignupFormValues } from "@/components/auth/StudentSignupForm";
import { MentorSignupForm, type MentorSignupFormValues } from "@/components/auth/MentorSignupForm";
import { SignupTrustBlock } from "@/components/auth/SignupTrustBlock";
import { buildSignupUserMetadata } from "@/lib/auth/buildSignupUserMetadata";
import { uploadMentorStudentIdAfterSignUpAction } from "@/lib/auth/mentorSignupStudentIdAction";
import { syncAfterSignUpWithSession } from "@/lib/auth/syncAfterSignUpSession";
import { safeInternalNextPath } from "@/lib/auth/getPostLoginPath";
import { signupFieldErrorsByRole, type SignupFieldErrors } from "@/lib/auth/signupValidation";
import { isUnderMinimumSignupAge } from "@/lib/auth/minorAgeGate";
import {
  MINOR_CONSENT_COPY,
  MINOR_CONSENT_VERIFICATION_METHOD_PLACEHOLDER,
  MINOR_CONSENT_VERSION,
} from "@/lib/auth/minorConsentPlaceholders";
import { mapSupabaseAuthError } from "@/lib/utils/mapSupabaseAuthError";
import type { AppRole } from "@/lib/types/user";

type SignupRole = Extract<AppRole, "student" | "mentor">;

const emptyStudent: StudentSignupFormValues = {
  fullName: "",
  nickname: "",
  gradeLevel: "",
  studentStatus: "",
  birthDate: "",
};

const emptyMentor: MentorSignupFormValues = {
  nickname: "",
  universityName: "",
  departmentName: "",
  teachingSubjectsCsv: "",
  highSchoolName: "",
  introLine: "",
  studentIdFile: null,
};

const STUDENT_PRIMARY = "#2563EB";
const MENTOR_PRIMARY = "#059669";

const signupInputBase =
  "mt-2 w-full min-h-12 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-900 outline-none transition placeholder:text-slate-400 sm:min-h-[3.1rem] sm:px-5";
const inputClassStudent =
  `${signupInputBase} focus:border-[#2563EB] focus:ring-2 focus:ring-[#2563EB]/20`;
const inputClassMentor =
  `${signupInputBase} focus:border-[#059669] focus:ring-2 focus:ring-[#059669]/20`;
const labelClass =
  "mb-0 block break-keep text-sm font-bold text-slate-800 sm:text-base";
const subhelper = "mt-1.5 text-sm leading-relaxed text-slate-500";
const profileStudent =
  "rounded-2xl border border-[#2563EB] bg-white p-6 ring-2 ring-[#2563EB]/15 sm:p-7";
const profileMentor =
  "rounded-2xl border border-[#059669] bg-white p-6 ring-2 ring-[#059669]/15 sm:p-7";
const accountSection = "rounded-2xl border border-slate-200 bg-white p-5 sm:p-6";
const accountSectionMentor = "rounded-2xl border border-slate-200 bg-white p-5 sm:p-6";

const fieldErrorClass = "mt-1.5 text-sm text-red-600";

function FieldError({ message }: { message?: string }) {
  if (!message) {
    return null;
  }
  return (
    <p className={fieldErrorClass} role="alert">
      {message}
    </p>
  );
}

function stepDescription(s: 1 | 2 | 3) {
  switch (s) {
    case 1:
      return (
        <>
          <span className="md:hidden">가입 유형을 골라주세요.</span>
          <span className="hidden md:inline">가입 유형을 골라주세요.</span>
        </>
      );
    case 2:
      return "이메일·비밀번호를 정하고, 프로필과 약관 동의를 완료하면 가입이 끝나요.";
    case 3:
      return "이제 쌤버십의 여정이 시작돼요.";
    default:
      return "";
  }
}

const signupRoleBenefits: Record<SignupRole, string[]> = {
  student: [
    `가입 시 무료 질문권 ${FREE_QUESTION_TOTAL_LIMIT}장 제공`,
    `무료 질문은 한 멘토당 최대 ${FREE_QUESTION_PER_MENTOR_LIMIT}개`,
    "프리미엄 구독 시 맞춤 리포트 제공",
  ],
  mentor: ["질문방 관리 및 답변 작성", "요금제 직접 설정", "정산 확인 및 수익 관리"],
};

function SignupRoleChoiceCard({
  role,
  active,
  disabled,
  onSelect,
}: {
  role: SignupRole;
  active: boolean;
  disabled: boolean;
  onSelect: () => void;
}) {
  const isStudent = role === "student";
  const primary = isStudent ? STUDENT_PRIMARY : MENTOR_PRIMARY;
  const title = isStudent ? "학생으로 가입" : "멘토로 가입";
  const description = isStudent ? (
    <>
      <span className="md:hidden">필요한 도움을 바로 받을 수 있어요.</span>
      <span className="hidden md:inline">질문권과 맞춤의뢰로 필요한 도움을 바로 받을 수 있어요.</span>
    </>
  ) : (
    <>
      <span className="md:hidden">답변 콘텐츠를 통해 수익을 창출해요.</span>
      <span className="hidden md:inline">답변 콘텐츠를 통해 수익을 창출해요.</span>
    </>
  );

  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      aria-pressed={active}
      className={[
        "relative flex h-full min-h-[270px] flex-col rounded-2xl border bg-white p-6 text-left transition sm:p-7",
        isStudent
          ? active
            ? "border-[#2563EB] ring-2 ring-[#2563EB]/15"
            : "border-slate-200 hover:border-slate-300"
          : active
            ? "border-[#059669] ring-2 ring-[#059669]/15"
            : "border-slate-200 hover:border-slate-300",
        disabled ? "cursor-not-allowed opacity-60" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {active ? (
        <span
          className="absolute right-5 top-5 flex h-7 w-7 items-center justify-center rounded-full text-white"
          style={{ backgroundColor: primary }}
          aria-hidden
        >
          <Check className="h-4 w-4" />
        </span>
      ) : null}

      <div
        className="flex h-12 w-12 items-center justify-center rounded-xl"
        style={{ backgroundColor: `${primary}14` }}
        aria-hidden
      >
        {isStudent ? (
          <BookOpen className="h-6 w-6" style={{ color: primary }} />
        ) : (
          <GraduationCap className="h-6 w-6" style={{ color: primary }} />
        )}
      </div>
      <h3 className="mt-3 text-xl font-black text-slate-900 sm:text-2xl">{title}</h3>
      <p className="mt-1.5 text-sm font-medium leading-relaxed text-slate-600">{description}</p>

      {isStudent ? (
        <p className="mt-2 text-sm font-extrabold text-red-600">*가입 후 첫 주 한정혜택</p>
      ) : null}

      <ul className="mt-5 space-y-2 border-y border-slate-100 py-4">
        {signupRoleBenefits[role].map((line) => (
          <li key={line} className="flex items-start gap-2 text-sm text-slate-700">
            <Check className="mt-0.5 h-4 w-4 shrink-0" style={{ color: primary }} aria-hidden />
            <span>{line}</span>
          </li>
        ))}
      </ul>
    </button>
  );
}

function SignupPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [role, setRole] = useState<SignupRole | null>(null);
  const [completedRole, setCompletedRole] = useState<SignupRole | null>(null);

  const [studentEmail, setStudentEmail] = useState("");
  const [studentPassword, setStudentPassword] = useState("");
  const [studentPasswordConfirm, setStudentPasswordConfirm] = useState("");

  const [mentorEmail, setMentorEmail] = useState("");
  const [mentorPassword, setMentorPassword] = useState("");
  const [mentorPasswordConfirm, setMentorPasswordConfirm] = useState("");

  const [student, setStudent] = useState<StudentSignupFormValues>(emptyStudent);
  const [mentor, setMentor] = useState<MentorSignupFormValues>(emptyMentor);

  const [termsAgree, setTermsAgree] = useState(false);
  const [privacyAgree, setPrivacyAgree] = useState(false);
  const [marketingAgree, setMarketingAgree] = useState(false);
  const [guardianConsentAgree, setGuardianConsentAgree] = useState(false);
  const [minorConsentPrompt, setMinorConsentPrompt] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<SignupFieldErrors>({});
  const [loading, setLoading] = useState(false);

  const termsUrl = process.env.NEXT_PUBLIC_LEGAL_TERMS_URL;
  const privacyUrl = process.env.NEXT_PUBLIC_LEGAL_PRIVACY_URL;
  const formSectionRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (step !== 2 || !role) {
      return;
    }
    const target = formSectionRef.current;
    if (!target) {
      return;
    }
    target.scrollIntoView({ behavior: "smooth", block: "start" });
    target.focus({ preventScroll: true });
  }, [role, step]);

  function handleStudentChange(next: StudentSignupFormValues) {
    setStudent(next);
    if (!isUnderMinimumSignupAge(next.birthDate)) {
      setGuardianConsentAgree(false);
      setMinorConsentPrompt(false);
    }
  }

  function goNext() {
    setError(null);
    setFieldErrors({});
    if (step === 1) {
      if (!role) {
        setError("학생 또는 멘토를 선택해 주세요.");
        return;
      }
      setStep(2);
    }
  }

  function goBackToRoleSelect() {
    setError(null);
    setFieldErrors({});
    setGuardianConsentAgree(false);
    setMinorConsentPrompt(false);
    setStep(1);
  }

  async function handleSignUp(forcedRole?: SignupRole) {
    if (loading) {
      return;
    }
    setError(null);
    setFieldErrors({});

    const currentRole = forcedRole ?? role;
    if (!currentRole) {
      setError("학생 또는 멘토를 선택해 주세요.");
      return;
    }
    const studentPayload = {
      email: studentEmail,
      password: studentPassword,
      passwordConfirm: studentPasswordConfirm,
      student,
      termsAgree,
      privacyAgree,
    };
    const mentorPayload = {
      email: mentorEmail,
      password: mentorPassword,
      passwordConfirm: mentorPasswordConfirm,
      mentor,
      termsAgree,
      privacyAgree,
    };
    const nextFieldErrors = signupFieldErrorsByRole(currentRole, studentPayload, mentorPayload);
    if (Object.keys(nextFieldErrors).length > 0) {
      setFieldErrors(nextFieldErrors);
      setError(Object.values(nextFieldErrors)[0] ?? "입력 내용을 확인해 주세요.");
      return;
    }

    const isMinorSignup = currentRole === "student" && isUnderMinimumSignupAge(student.birthDate);
    if (isMinorSignup && !guardianConsentAgree) {
      setMinorConsentPrompt(true);
      setFieldErrors({ guardianConsent: MINOR_CONSENT_COPY.requiredError });
      setError(MINOR_CONSENT_COPY.requiredError);
      return;
    }

    const email = currentRole === "student" ? studentEmail : mentorEmail;
    const password = currentRole === "student" ? studentPassword : mentorPassword;
    const nextRaw = searchParams.get("next");
    const ageGateCheckedAt = currentRole === "student" && student.birthDate ? new Date().toISOString() : "";

    const displayName = currentRole === "student" ? student.nickname : mentor.nickname;

    setLoading(true);
    const supabase = createClient();
    const meta = buildSignupUserMetadata({
      role: currentRole,
      fullName: displayName.trim(),
      nickname: displayName.trim(),
      gradeLevel: currentRole === "student" ? student.gradeLevel : "",
      studentStatus: currentRole === "student" ? student.studentStatus : "",
      birthDate: currentRole === "student" ? student.birthDate : "",
      termsAgree,
      privacyAgree,
      marketingAgree,
      universityName: currentRole === "mentor" ? mentor.universityName : "",
      departmentName: currentRole === "mentor" ? mentor.departmentName : "",
      teachingSubjectsCsv: currentRole === "mentor" ? mentor.teachingSubjectsCsv : "",
      highSchoolName: currentRole === "mentor" ? mentor.highSchoolName : "",
      introLine: currentRole === "mentor" ? mentor.introLine : "",
      isMinor: isMinorSignup,
      guardianConsent: isMinorSignup && guardianConsentAgree,
      guardianConsentVersion: MINOR_CONSENT_VERSION,
      guardianRef: "",
      ageGateCheckedAt,
      guardianVerificationMethod: MINOR_CONSENT_VERIFICATION_METHOD_PLACEHOLDER,
    });

    let newUser: { id: string } | null = null;
    let newSession: boolean = false;
    let signUpErrorMessage: string | null = null;

    try {
      const { data, error: sErr } = await supabase.auth.signUp({
        email: email.trim(),
        password: password,
        options: { data: meta, emailRedirectTo: typeof window !== "undefined" ? window.location.origin : undefined },
      });
      if (sErr) {
        signUpErrorMessage = mapSupabaseAuthError(sErr.message);
        setLoading(false);
        setError(signUpErrorMessage);
        return;
      }
      if (!data.user) {
        setError("가입에 실패했습니다. 잠시 후 다시 시도해 주세요.");
        setLoading(false);
        return;
      }
      newUser = { id: data.user.id };
      newSession = !!data.session;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(mapSupabaseAuthError(msg));
      setLoading(false);
      return;
    }

    if (newUser && newSession) {
      const w =
        currentRole === "student"
          ? await syncAfterSignUpWithSession({
              userId: newUser.id,
              email: email.trim(),
              role: "student",
              fullName: displayName,
              nickname: displayName,
              gradeLevel: student.gradeLevel,
              studentStatus: student.studentStatus,
              birthDate: student.birthDate,
              termsAgree,
              privacyAgree,
              marketingAgree,
              universityName: "",
              departmentName: "",
              teachingSubjectsCsv: "",
              highSchoolName: "",
              introLine: "",
              studentIdFile: null,
            })
          : await syncAfterSignUpWithSession({
              userId: newUser.id,
              email: email.trim(),
              role: "mentor",
              fullName: displayName,
              nickname: displayName,
              gradeLevel: "",
              studentStatus: "",
              birthDate: "",
              termsAgree,
              privacyAgree,
              marketingAgree,
              universityName: mentor.universityName,
              departmentName: mentor.departmentName,
              teachingSubjectsCsv: mentor.teachingSubjectsCsv,
              highSchoolName: mentor.highSchoolName,
              introLine: mentor.introLine,
              studentIdFile: mentor.studentIdFile,
            });
      const criticalSync = w.warningMessages.filter(
        (m) => m.includes("[프로필 저장]") || m.includes("[멘토 프로필]")
      );
      if (criticalSync.length > 0) {
        setError(criticalSync.join(" "));
        setLoading(false);
        return;
      }
      if (w.warningMessages.length > 0) {
        console.warn("[signup] post-signup sync warnings (비차단):", w.warningMessages);
      }
      // W2(C6): 학생증 저장은 세션 유무와 무관하게 service_role 서버 액션이 단일 경로다
      // (구 브라우저 업로드 + mentor_profiles 직접 UPDATE 는 제거 — C6 직접 쓰기 0건 게이트).
      if (currentRole === "mentor" && mentor.studentIdFile) {
        try {
          const docForm = new FormData();
          docForm.set("userId", newUser.id);
          docForm.set("studentIdDocument", mentor.studentIdFile);
          const uploadedDoc = await uploadMentorStudentIdAfterSignUpAction(docForm);
          if (!uploadedDoc.ok) {
            console.warn("[signup] 학생증 서버 업로드 실패 (비차단):", uploadedDoc.message);
          }
        } catch (e) {
          console.warn("[signup] 학생증 서버 업로드 실패 (비차단):", e);
        }
      }
      setLoading(false);
      setCompletedRole(currentRole);
      setStep(3);
      return;
    }

    if (newUser) {
      const q = new URLSearchParams();
      // 세션이 없는 가입 경로(이메일 인증 대기 등)에서는 클라이언트가 Storage에 쓸 수 없으므로
      // 서버 액션(service role)으로 학생증을 저장한다. 실패한 경우에만
      // 로그인 후 /mentor/verification 에서 재제출하도록 별도 안내 메시지를 붙인다.
      let mentorDocDropped = false;
      if (currentRole === "mentor" && mentor.studentIdFile) {
        try {
          const docForm = new FormData();
          docForm.set("userId", newUser.id);
          docForm.set("studentIdDocument", mentor.studentIdFile);
          const uploaded = await uploadMentorStudentIdAfterSignUpAction(docForm);
          mentorDocDropped = !uploaded.ok;
          if (!uploaded.ok) {
            console.warn("[signup] 학생증 서버 업로드 실패 (비차단):", uploaded.message);
          }
        } catch (e) {
          mentorDocDropped = true;
          console.warn("[signup] 학생증 서버 업로드 실패 (비차단):", e);
        }
      }
      q.set("message", mentorDocDropped ? "signup-check-email-doc" : "signup-check-email");
      const safeNext = safeInternalNextPath(nextRaw);
      if (safeNext) {
        q.set("next", safeNext);
      }
      const loginPath = currentRole === "mentor" ? "/login/mentor" : "/login/student";
      setLoading(false);
      router.replace(`${loginPath}?${q.toString()}`);
      router.refresh();
      return;
    }

    setLoading(false);
  }

  const showMinorConsent = role === "student" && (minorConsentPrompt || isUnderMinimumSignupAge(student.birthDate));

  return (
    <AuthPageLayout
      title="회원가입"
      titleClassName="!text-[#111827]"
      description={stepDescription(step)}
      signupLayout
      headerPrefix={
        <Link
          href="/"
          className="inline-flex items-center gap-1 text-sm font-semibold text-slate-600 transition hover:text-slate-900 sm:text-base"
        >
          <span aria-hidden>←</span> 이전으로
        </Link>
      }
    >
      <div className="mb-6 w-full sm:mb-8">
        <SignupStepBar current={step} />
      </div>

      <>
        {error ? (
          <p
            className="mb-6 rounded-2xl border-2 border-red-200/90 bg-red-50 px-4 py-3.5 text-base text-red-900 shadow-sm"
            role="alert"
          >
            {error}
          </p>
        ) : null}

        {step === 3 && completedRole ? (
          <div
            className="mx-auto w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm sm:p-10"
            role="status"
          >
            <p className="break-keep text-2xl font-extrabold text-slate-900 sm:text-3xl">가입을 환영합니다!</p>
            {completedRole === "student" ? (
              <>
                <p className="mt-3 break-keep text-base leading-relaxed text-slate-600 sm:mt-4 sm:text-lg">
                  이제 멘토를 찾아 질문·학습을 시작해 보세요.
                </p>
                <Link
                  href="/mentors"
                  className="mt-8 inline-flex min-h-12 items-center justify-center rounded-2xl bg-[#2563EB] px-8 text-base font-extrabold text-white transition hover:bg-blue-700 sm:min-h-[3.25rem] sm:px-10 sm:text-lg"
                >
                  멘토 찾기
                </Link>
              </>
            ) : (
              <>
                <p className="mt-3 break-keep text-base leading-relaxed text-slate-600 sm:mt-4 sm:text-lg">
                  관리자 승인 전까지 멘토 활동은 대기 상태입니다. 프로필을 먼저 작성해 주세요.
                </p>
                <Link
                  href="/mentor/profile/edit"
                  className="mt-8 inline-flex min-h-12 items-center justify-center rounded-2xl bg-[#059669] px-8 text-base font-extrabold text-white transition hover:bg-emerald-700 sm:min-h-[3.25rem] sm:px-10 sm:text-lg"
                >
                  프로필 관리
                </Link>
              </>
            )}
          </div>
        ) : null}

        {step === 1 ? (
            <div>
              <h2 className="text-center text-2xl font-extrabold tracking-tight text-slate-900 sm:text-3xl">
                어떤 유형으로 가입하시나요?
              </h2>
              <p className="mx-auto mt-3 max-w-2xl text-center text-base font-medium leading-relaxed text-slate-500 sm:text-lg">
                <span className="md:hidden">한 가지 유형을 골라주세요.</span>
                <span className="hidden md:inline">한 가지 유형을 골라주세요.</span>
              </p>
              <div className="mt-6 grid grid-cols-1 items-stretch gap-6 lg:grid-cols-2 lg:gap-8">
                <SignupRoleChoiceCard
                  role="student"
                  active={role === "student"}
                  disabled={loading}
                  onSelect={() => setRole("student")}
                />
                <SignupRoleChoiceCard
                  role="mentor"
                  active={role === "mentor"}
                  disabled={loading}
                  onSelect={() => setRole("mentor")}
                />
              </div>
            </div>
        ) : null}

        {step === 2 ? (
            <div className="space-y-8 sm:space-y-10">
              {role ? (
                <div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
                  <div className="min-w-0 rounded-2xl border border-slate-200 bg-white px-4 py-3.5 sm:px-5">
                    <p className="text-xs font-extrabold uppercase tracking-wider text-slate-500">선택한 가입 유형</p>
                    <p className="mt-1 break-keep text-xl font-extrabold text-slate-900 sm:text-2xl">
                      {role === "student" ? "학생" : "멘토"}
                    </p>
                  </div>
                  <div className="flex min-w-0 flex-wrap items-center gap-2 sm:justify-end">
                    <p className="w-full min-w-0 break-keep text-sm text-slate-500 sm:w-auto sm:text-right">
                      다른 유형이면 1단계로 돌아가 주세요.
                    </p>
                    <button
                      type="button"
                      onClick={goBackToRoleSelect}
                      disabled={loading}
                      className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-slate-200 bg-white px-5 text-sm font-bold text-slate-800 transition hover:border-slate-300 disabled:opacity-50 sm:min-h-12 sm:px-6 sm:text-base"
                    >
                      ← 역할 다시 선택
                    </button>
                  </div>
                </div>
              ) : null}

              {!role ? (
                <div
                  className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 text-amber-950 sm:px-5 sm:py-5"
                  role="status"
                >
                  <p className="font-bold">1단계에서 가입 유형이 선택되지 않았어요.</p>
                  <button
                    type="button"
                    onClick={goBackToRoleSelect}
                    className="mt-3 min-h-11 w-full rounded-2xl bg-[#2563EB] py-2.5 text-sm font-extrabold text-white sm:text-base"
                  >
                    가입 유형 선택으로
                  </button>
                </div>
              ) : null}

              {role === "student" ? (
                <section
                  ref={formSectionRef}
                  key="signup-student"
                  tabIndex={-1}
                  className={`${profileStudent} z-[1] mx-auto w-full max-w-2xl outline-none`}
                  aria-label="학생 회원가입 폼"
                >
                  <header className="border-b border-slate-100 pb-5">
                    <p className="text-xs font-extrabold uppercase tracking-[0.14em] text-[#2563EB]">
                      Student signup
                    </p>
                    <h2 className="mt-1.5 text-2xl font-extrabold leading-tight text-slate-900 sm:text-3xl">
                      학생 회원가입
                    </h2>
                    <p className="mt-2.5 text-sm leading-relaxed text-slate-600 sm:text-base">
                      이메일·비밀번호와 프로필을 같이 완성하면 쌤버십에 바로 들어갈 수 있어요.
                    </p>
                  </header>

                  <div className="mt-6 space-y-1 sm:mt-7">
                    <h3 className="text-sm font-extrabold text-slate-900 sm:text-base">로그인에 쓰는 계정</h3>
                    <p className="text-sm text-slate-500 sm:text-base">이메일과 비밀번호는 이후에도 그대로 사용돼요.</p>
                    <div className={`${accountSection} mt-3 space-y-4 sm:mt-4`}>
                    <div>
                      <label htmlFor="sg-email-student" className={labelClass}>
                        이메일 <span className="text-red-500">*</span>
                      </label>
                      <input
                        id="sg-email-student"
                        name="email_student"
                        type="email"
                        className={inputClassStudent}
                        value={studentEmail}
                        onChange={(e) => setStudentEmail(e.target.value)}
                        autoComplete="email"
                        aria-invalid={!!fieldErrors.email}
                      />
                      <FieldError message={fieldErrors.email} />
                    </div>
                    <div>
                      <label htmlFor="sg-pw-student" className={labelClass}>
                        비밀번호 <span className="text-red-500">*</span>
                      </label>
                      <input
                        id="sg-pw-student"
                        name="password_student"
                        type="password"
                        className={inputClassStudent}
                        value={studentPassword}
                        onChange={(e) => setStudentPassword(e.target.value)}
                        autoComplete="new-password"
                        aria-invalid={!!fieldErrors.password}
                      />
                      <FieldError message={fieldErrors.password} />
                    </div>
                    <div>
                      <label htmlFor="sg-pw2-student" className={labelClass}>
                        비밀번호 확인 <span className="text-red-500">*</span>
                      </label>
                      <input
                        id="sg-pw2-student"
                        name="password2_student"
                        type="password"
                        className={inputClassStudent}
                        value={studentPasswordConfirm}
                        onChange={(e) => setStudentPasswordConfirm(e.target.value)}
                        autoComplete="new-password"
                        aria-invalid={!!fieldErrors.passwordConfirm}
                      />
                      {fieldErrors.passwordConfirm ? (
                        <FieldError message={fieldErrors.passwordConfirm} />
                      ) : (
                        <p className={subhelper}>8자 이상, 영문·숫자 조합을 권장해요.</p>
                      )}
                    </div>
                    </div>
                  </div>

                  <div className="mt-7 border-t border-slate-100 pt-6 sm:mt-8 sm:pt-7">
                    <StudentSignupForm
                      value={student}
                      onChange={handleStudentChange}
                      disabled={loading}
                      fieldErrors={{
                        nickname: fieldErrors.nickname,
                        gradeLevel: fieldErrors.gradeLevel,
                        birthDate: fieldErrors.birthDate,
                      }}
                    />
                  </div>

                  <div className="mt-7 sm:mt-8">
                    {termsBlock(
                      "sky",
                      termsAgree,
                      privacyAgree,
                      marketingAgree,
                      setTermsAgree,
                      setPrivacyAgree,
                      setMarketingAgree,
                      loading,
                      termsUrl,
                      privacyUrl
                    )}
                    <FieldError message={fieldErrors.terms} />
                    {showMinorConsent ? (
                      <div className="mt-4">
                        {minorGuardianConsentBlock(guardianConsentAgree, setGuardianConsentAgree, loading)}
                        <FieldError message={fieldErrors.guardianConsent} />
                      </div>
                    ) : null}
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setRole("student");
                      void handleSignUp("student");
                    }}
                    disabled={loading}
                    className="mt-7 w-full min-h-14 rounded-2xl bg-[#2563EB] px-8 text-base font-extrabold text-white transition hover:bg-blue-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2563EB] disabled:cursor-not-allowed disabled:opacity-60 sm:mt-8 sm:min-h-[3.5rem] sm:text-lg"
                  >
                    {loading ? "처리 중…" : "학생으로 가입하기"}
                  </button>
                </section>
              ) : null}

              {role === "mentor" ? (
                <section
                  ref={formSectionRef}
                  key="signup-mentor"
                  tabIndex={-1}
                  className={`${profileMentor} z-[1] mx-auto w-full max-w-2xl outline-none`}
                  aria-label="멘토 회원가입 폼"
                >
                  <header className="border-b border-slate-100 pb-5">
                    <p className="text-xs font-extrabold uppercase tracking-[0.14em] text-[#059669]">
                      Mentor signup
                    </p>
                    <h2 className="mt-1.5 text-2xl font-extrabold leading-tight text-slate-900 sm:text-3xl">
                      멘토 회원가입
                    </h2>
                    <p className="mt-2.5 text-sm leading-relaxed text-slate-600 sm:text-base">
                      대학·전공·서류를 입력하면 인증·활동 준비까지 수월해요.
                    </p>
                  </header>

                  <div className="mt-6 space-y-1 sm:mt-7">
                    <h3 className="text-sm font-extrabold text-slate-900 sm:text-base">로그인에 쓰는 계정</h3>
                    <p className="text-sm text-slate-500 sm:text-base">이메일과 비밀번호는 이후에도 그대로 사용돼요.</p>
                    <div className={`${accountSectionMentor} mt-3 space-y-4 sm:mt-4`}>
                    <div>
                      <label htmlFor="sg-email-mentor" className={labelClass}>
                        이메일 <span className="text-red-500">*</span>
                      </label>
                      <input
                        id="sg-email-mentor"
                        name="email_mentor"
                        type="email"
                        className={inputClassMentor}
                        value={mentorEmail}
                        onChange={(e) => setMentorEmail(e.target.value)}
                        autoComplete="email"
                        aria-invalid={!!fieldErrors.email}
                      />
                      <FieldError message={fieldErrors.email} />
                    </div>
                    <div>
                      <label htmlFor="sg-pw-mentor" className={labelClass}>
                        비밀번호 <span className="text-red-500">*</span>
                      </label>
                      <input
                        id="sg-pw-mentor"
                        name="password_mentor"
                        type="password"
                        className={inputClassMentor}
                        value={mentorPassword}
                        onChange={(e) => setMentorPassword(e.target.value)}
                        autoComplete="new-password"
                        aria-invalid={!!fieldErrors.password}
                      />
                      <FieldError message={fieldErrors.password} />
                    </div>
                    <div>
                      <label htmlFor="sg-pw2-mentor" className={labelClass}>
                        비밀번호 확인 <span className="text-red-500">*</span>
                      </label>
                      <input
                        id="sg-pw2-mentor"
                        name="password2_mentor"
                        type="password"
                        className={inputClassMentor}
                        value={mentorPasswordConfirm}
                        onChange={(e) => setMentorPasswordConfirm(e.target.value)}
                        autoComplete="new-password"
                        aria-invalid={!!fieldErrors.passwordConfirm}
                      />
                      {fieldErrors.passwordConfirm ? (
                        <FieldError message={fieldErrors.passwordConfirm} />
                      ) : (
                        <p className={subhelper}>8자 이상, 영문·숫자 조합을 권장해요.</p>
                      )}
                    </div>
                    </div>
                  </div>

                  <div className="mt-7 border-t border-slate-100 pt-6 sm:mt-8 sm:pt-7">
                    <MentorSignupForm
                      value={mentor}
                      onChange={setMentor}
                      disabled={loading}
                      fieldErrors={{
                        nickname: fieldErrors.nickname,
                        universityName: fieldErrors.universityName,
                        departmentName: fieldErrors.departmentName,
                        teachingSubjectsCsv: fieldErrors.teachingSubjectsCsv,
                        highSchoolName: fieldErrors.highSchoolName,
                        studentIdFile: fieldErrors.studentIdFile,
                      }}
                    />
                  </div>

                  <div className="mt-7 sm:mt-8">
                    {termsBlock(
                      "emerald",
                      termsAgree,
                      privacyAgree,
                      marketingAgree,
                      setTermsAgree,
                      setPrivacyAgree,
                      setMarketingAgree,
                      loading,
                      termsUrl,
                      privacyUrl
                    )}
                    <FieldError message={fieldErrors.terms} />
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setRole("mentor");
                      void handleSignUp("mentor");
                    }}
                    disabled={loading}
                    className="mt-7 w-full min-h-14 rounded-2xl bg-[#059669] px-8 text-base font-extrabold text-white transition hover:bg-emerald-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#059669] disabled:cursor-not-allowed disabled:opacity-60 sm:mt-8 sm:min-h-[3.5rem] sm:text-lg"
                  >
                    {loading ? "처리 중…" : "멘토로 가입하기"}
                  </button>
                </section>
              ) : null}
            </div>
        ) : null}

          {step === 1 ? (
            <div className="mt-8 flex flex-wrap items-center justify-end gap-3 sm:mt-10">
              <button
                type="button"
                onClick={goNext}
                disabled={loading || !role}
                className="min-h-14 min-w-[11.5rem] rounded-2xl bg-[#2563EB] px-10 text-base font-extrabold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50 sm:text-lg md:min-w-[12.5rem]"
              >
                다음 — 정보 입력
              </button>
            </div>
          ) : null}

        {step !== 3 ? <SignupTrustBlock /> : null}
        </>

      {step !== 3 ? (
      <p className="mt-8 text-center text-sm text-slate-600 sm:mt-10 sm:text-base">
        이미 계정이 있으신가요?{" "}
        <Link href="/login" className="font-bold text-blue-700 underline decoration-blue-200 underline-offset-4 hover:text-blue-800">
          로그인
        </Link>
      </p>
      ) : null}
    </AuthPageLayout>
  );
}

export default function SignupPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto flex min-h-[40vh] max-w-lg items-center justify-center p-8 text-slate-600">
          불러오는 중…
        </div>
      }
    >
      <SignupPageContent />
    </Suspense>
  );
}

function minorGuardianConsentBlock(
  checked: boolean,
  setChecked: (b: boolean) => void,
  loading: boolean
) {
  return (
    <section className="rounded-2xl border border-[#2563EB]/25 bg-blue-50/40 p-5 sm:p-6" aria-label="보호자 동의">
      <header className="border-b border-blue-100 pb-4">
        <p className="text-xs font-extrabold tracking-wide text-[#2563EB]">04 · 보호자 동의</p>
        <h2 className="mt-1.5 text-lg font-extrabold text-slate-900 sm:text-xl">{MINOR_CONSENT_COPY.title}</h2>
        <p className="mt-1.5 text-sm leading-relaxed text-slate-600">{MINOR_CONSENT_COPY.description}</p>
      </header>
      <div className="mt-4 rounded-xl border border-dashed border-blue-200 bg-white/70 p-4">
        <p className="text-xs font-extrabold uppercase tracking-wide text-slate-500">{MINOR_CONSENT_COPY.legalSlotLabel}</p>
        <ul className="mt-2 space-y-1.5 text-sm text-slate-600">
          {MINOR_CONSENT_COPY.legalSlots.map((slot) => (
            <li key={slot}>- {slot}</li>
          ))}
        </ul>
      </div>
      <label className="mt-4 flex items-start gap-3 text-slate-800 sm:gap-3.5">
        <input
          type="checkbox"
          className="mt-1.5 h-5 w-5 shrink-0 rounded border-slate-300 text-[#2563EB] focus:ring-[#2563EB]"
          checked={checked}
          onChange={(e) => setChecked(e.target.checked)}
          disabled={loading}
        />
        <span className="text-sm font-semibold leading-relaxed sm:text-base">{MINOR_CONSENT_COPY.checkboxLabel}</span>
      </label>
    </section>
  );
}

function termsBlock(
  tone: "sky" | "emerald",
  termsAgree: boolean,
  privacyAgree: boolean,
  marketingAgree: boolean,
  setTerms: (b: boolean) => void,
  setPrivacy: (b: boolean) => void,
  setMarketing: (b: boolean) => void,
  loading: boolean,
  termsUrl: string | undefined,
  privacyUrl: string | undefined
) {
  const setBoth = (b: boolean) => {
    setTerms(b);
    setPrivacy(b);
  };
  const allRequired = termsAgree && privacyAgree;
  const isSky = tone === "sky";
  const skin = "border-slate-200 bg-white";
  const sub = "text-slate-500";
  const headerBorder = "border-slate-100";
  const kicker = isSky ? "text-[#2563EB]" : "text-[#059669]";
  const link = isSky ? "text-[#2563EB] hover:text-blue-700" : "text-[#059669] hover:text-emerald-700";
  const chk = isSky
    ? "text-[#2563EB] focus:ring-[#2563EB]"
    : "text-[#059669] focus:ring-[#059669]";

  return (
    <section
      className={`rounded-2xl border p-5 sm:p-6 ${skin}`}
      aria-label="약관 동의"
    >
      <header className={`border-b ${headerBorder} pb-4`}>
        <p className={`text-xs font-extrabold tracking-wide sm:text-sm ${kicker}`}>03 · 약관</p>
        <h2 className="mt-1.5 text-lg font-extrabold text-slate-900 sm:text-xl">필수·선택 동의</h2>
        <p className="mt-1.5 text-sm leading-relaxed text-slate-600">
          필수 항목에 동의해야 가입이 완료돼요.
        </p>
        <p className={`mt-0.5 text-xs sm:text-sm ${sub}`}>
          {isSky ? "학생 가입 흐름" : "멘토 가입 흐름"}에 맞는 색 톤으로 정리했어요.
        </p>
      </header>
      <div className="mt-4 space-y-3.5 text-slate-800 sm:mt-5 sm:space-y-4 sm:text-base">
        <label className="flex items-start gap-3 sm:gap-3.5">
          <input
            type="checkbox"
            className={`mt-1.5 h-5 w-5 shrink-0 rounded border-slate-300 ${chk}`}
            checked={allRequired}
            onChange={(e) => setBoth(e.target.checked)}
            disabled={loading}
          />
          <span>
            <span className="font-bold text-slate-900">필수</span> — 서비스 이용약관 및 개인정보 수집·이용에 동의합니다.{" "}
            {termsUrl || privacyUrl ? (
              <span className="text-slate-600">
                {termsUrl ? (
                  <a
                    className={`font-medium underline underline-offset-2 ${link}`}
                    href={termsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                  >
                    이용약관
                  </a>
                ) : null}
                {termsUrl && privacyUrl ? " · " : null}
                {privacyUrl ? (
                  <a
                    className={`font-medium underline underline-offset-2 ${link}`}
                    href={privacyUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                  >
                    개인정보처리방침
                  </a>
                ) : null}
              </span>
            ) : null}
          </span>
        </label>
        <label className="flex items-start gap-3 text-slate-700 sm:gap-3.5">
          <input
            type="checkbox"
            className={`mt-1.5 h-5 w-5 shrink-0 rounded border-slate-300 ${chk}`}
            checked={marketingAgree}
            onChange={(e) => setMarketing(e.target.checked)}
            disabled={loading}
          />
          <span>
            <span className="font-bold text-slate-900">선택</span> — 이벤트·혜택 알림 수신에 동의합니다.
          </span>
        </label>
        <p className="text-xs leading-relaxed text-slate-600">
          만 14세 미만은 보호자 동의 절차가 필요할 수 있어요.{" "}
          <Link href="/legal/minor-consent" className={`font-bold underline underline-offset-2 ${link}`}>
            보호자 동의 안내(초안)
          </Link>
        </p>
      </div>
    </section>
  );
}
