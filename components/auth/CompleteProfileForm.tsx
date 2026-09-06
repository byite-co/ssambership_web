"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import {
  buildCompleteProfileArgs,
  COMPLETE_PROFILE_RPC,
  COMPLETE_PROFILE_RPC_SCHEMA,
  DISPLAY_NAME_MAX_LENGTH,
  GRADE_LEVEL_MAX_LENGTH,
  interpretCompleteProfileResponse,
  validateCompleteProfileForm,
  type CompleteProfileField,
  type CompleteProfileFormValues,
} from "@/lib/auth/completeProfileCore";
import { isUnderMinimumSignupAge, parseBirthDateParts } from "@/lib/auth/minorAgeGate";
import type { ProfileRoleHint } from "@/lib/auth/getPostLoginPath";

const STUDENT_PRIMARY = "#2563EB";
const MENTOR_PRIMARY = "#059669";

const inputBase =
  "mt-2 w-full min-h-12 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-900 outline-none transition placeholder:text-slate-400";
const labelClass = "block break-keep text-sm font-bold text-slate-800";
const hintClass = "mt-1.5 text-xs leading-relaxed text-slate-500";

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p className="mt-1.5 text-sm text-red-600" role="alert">
      {message}
    </p>
  );
}

export function CompleteProfileForm(props: {
  roleHint: ProfileRoleHint | null;
  /** 완성 후 복귀 경로(`?next=` · 안전한 내부 경로만 서버가 넘긴다) */
  nextPath: string | null;
  /** provider 이름(users.nickname/full_name) — 표시 이름 기본값 */
  initialDisplayName: string;
  /** 이메일 없는 소셜 계정(카카오 미동의)도 완성할 수 있다 — 안내만 다르다 */
  hasEmail: boolean;
}) {
  const [role, setRole] = useState<ProfileRoleHint>(props.roleHint ?? "student");
  const [displayName, setDisplayName] = useState(props.initialDisplayName);
  const [birthdate, setBirthdate] = useState("");
  const [termsAgreed, setTermsAgreed] = useState(false);
  const [marketingAgreed, setMarketingAgreed] = useState(false);
  const [gradeLevel, setGradeLevel] = useState("");
  const [universityName, setUniversityName] = useState("");
  const [departmentName, setDepartmentName] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<CompleteProfileField, string>>>({});
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const isStudent = role === "student";
  const accent = isStudent ? STUDENT_PRIMARY : MENTOR_PRIMARY;
  const inputClass = `${inputBase} ${isStudent ? "focus:border-[#2563EB] focus:ring-2 focus:ring-[#2563EB]/20" : "focus:border-[#059669] focus:ring-2 focus:ring-[#059669]/20"}`;

  const minorNotice = useMemo(() => {
    if (!parseBirthDateParts(birthdate)) return false;
    return isUnderMinimumSignupAge(birthdate);
  }, [birthdate]);

  const values: CompleteProfileFormValues = {
    role,
    displayName,
    birthdate,
    termsAgreed,
    marketingAgreed,
    gradeLevel,
    universityName,
    departmentName,
  };

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setError(null);
    const localErrors = validateCompleteProfileForm(values);
    setFieldErrors(localErrors);
    if (Object.keys(localErrors).length > 0) return;

    setSubmitting(true);
    try {
      const supabase = createClient();
      const { data, error: rpcError } = await supabase
        .schema(COMPLETE_PROFILE_RPC_SCHEMA)
        .rpc(COMPLETE_PROFILE_RPC, buildCompleteProfileArgs(values));
      const outcome = interpretCompleteProfileResponse(data, rpcError, { nextPath: props.nextPath });
      if (outcome.kind === "done" || outcome.kind === "already_completed") {
        // 세션 쿠키는 이미 있고 users 행만 바뀌었다 — 전체 문서 이동으로 서버 가드가 새 상태를 읽게 한다.
        window.location.assign(outcome.redirectTo);
        return;
      }
      if (outcome.kind === "field_error") {
        setFieldErrors({ [outcome.field]: outcome.message });
        setSubmitting(false);
        return;
      }
      if (rpcError) {
        console.error("[complete-profile] rpc error", rpcError.message);
      }
      setError(outcome.message);
      setSubmitting(false);
    } catch (err) {
      console.error("[complete-profile] submit failed", err instanceof Error ? err.message : String(err));
      setError("프로필을 저장하지 못했어요. 잠시 후 다시 시도해 주세요.");
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6" noValidate>
      {error ? (
        <p className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">
          {error}
        </p>
      ) : null}

      <fieldset disabled={submitting} className="space-y-6 disabled:opacity-60">
        <div>
          <p className={labelClass}>어떤 유형으로 이용하시나요?</p>
          <div className="mt-2 grid grid-cols-2 gap-2" role="radiogroup" aria-label="이용 유형">
            {(["student", "mentor"] as const).map((r) => {
              const active = role === r;
              const color = r === "student" ? STUDENT_PRIMARY : MENTOR_PRIMARY;
              return (
                <label
                  key={r}
                  className={`flex min-h-12 cursor-pointer items-center justify-center rounded-2xl border px-4 text-sm font-extrabold transition ${
                    active ? "text-white" : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"
                  }`}
                  style={active ? { backgroundColor: color, borderColor: color } : undefined}
                >
                  <input
                    type="radio"
                    name="role"
                    value={r}
                    checked={active}
                    onChange={() => setRole(r)}
                    className="sr-only"
                  />
                  {r === "student" ? "학생" : "멘토"}
                </label>
              );
            })}
          </div>
          <p className={hintClass}>
            {isStudent ? "멘토를 구독하고 질문방에서 질문을 쌓아가요." : "관리자 승인 후 멘토 활동을 시작해요. 완성 뒤 본인인증이 이어져요."}
          </p>
          <FieldError message={fieldErrors.role} />
        </div>

        <div>
          <label htmlFor="cp-display-name" className={labelClass}>
            표시 이름
          </label>
          <input
            id="cp-display-name"
            className={inputClass}
            value={displayName}
            maxLength={DISPLAY_NAME_MAX_LENGTH}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="쌤버십에서 보일 이름(닉네임)"
            autoComplete="nickname"
          />
          <p className={hintClass}>{DISPLAY_NAME_MAX_LENGTH}자 이하. 질문방·커뮤니티에 이 이름으로 표시돼요.</p>
          <FieldError message={fieldErrors.displayName} />
        </div>

        <div>
          <label htmlFor="cp-birthdate" className={labelClass}>
            생년월일
          </label>
          <input
            id="cp-birthdate"
            type="date"
            className={inputClass}
            value={birthdate}
            onChange={(e) => setBirthdate(e.target.value)}
            autoComplete="bday"
          />
          {minorNotice ? (
            <p className="mt-1.5 text-xs leading-relaxed text-blue-800">
              만 14세 미만은 프로필 완성 뒤 보호자(법정대리인) 인증이 이어져요.
            </p>
          ) : (
            <p className={hintClass}>만 14세 미만 여부를 확인하기 위한 필수 정보예요.</p>
          )}
          <FieldError message={fieldErrors.birthdate} />
        </div>

        {isStudent ? (
          <div>
            <label htmlFor="cp-grade" className={labelClass}>
              학년
            </label>
            <input
              id="cp-grade"
              className={inputClass}
              value={gradeLevel}
              maxLength={GRADE_LEVEL_MAX_LENGTH}
              onChange={(e) => setGradeLevel(e.target.value)}
              placeholder="예: 고1, 고2, 고3, 재수"
            />
            <p className={hintClass}>학생 프로필과 탐색 카드에 반영돼요.</p>
            <FieldError message={fieldErrors.gradeLevel} />
          </div>
        ) : (
          <>
            <div>
              <label htmlFor="cp-university" className={labelClass}>
                대학교
              </label>
              <input
                id="cp-university"
                className={inputClass}
                value={universityName}
                onChange={(e) => setUniversityName(e.target.value)}
                placeholder="예: 쌤버십대학교"
                autoComplete="organization"
              />
              <p className={hintClass}>재학 인증(학생증)은 완성 뒤 마이페이지에서 제출해요.</p>
              <FieldError message={fieldErrors.universityName} />
            </div>
            <div>
              <label htmlFor="cp-department" className={labelClass}>
                학과 <span className="font-normal text-slate-500">(선택)</span>
              </label>
              <input
                id="cp-department"
                className={inputClass}
                value={departmentName}
                onChange={(e) => setDepartmentName(e.target.value)}
                placeholder="예: 수학교육과"
              />
            </div>
          </>
        )}

        <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <label className="flex items-start gap-3 text-sm text-slate-800">
            <input
              type="checkbox"
              checked={termsAgreed}
              onChange={(e) => setTermsAgreed(e.target.checked)}
              className="mt-0.5 h-5 w-5 rounded border-slate-300"
              style={{ accentColor: accent }}
            />
            <span>
              <span className="font-bold">[필수]</span>{" "}
              <Link href="/legal/terms" target="_blank" rel="noreferrer" className="font-semibold underline underline-offset-2">
                이용약관
              </Link>
              과{" "}
              <Link href="/legal/privacy" target="_blank" rel="noreferrer" className="font-semibold underline underline-offset-2">
                개인정보 처리방침
              </Link>
              에 동의합니다.
            </span>
          </label>
          <FieldError message={fieldErrors.terms} />
          <label className="flex items-start gap-3 text-sm text-slate-800">
            <input
              type="checkbox"
              checked={marketingAgreed}
              onChange={(e) => setMarketingAgreed(e.target.checked)}
              className="mt-0.5 h-5 w-5 rounded border-slate-300"
              style={{ accentColor: accent }}
            />
            <span>
              <span className="font-bold text-slate-500">[선택]</span> 이벤트·혜택 안내(마케팅 정보) 수신에 동의합니다.
            </span>
          </label>
          {!props.hasEmail ? (
            <p className="text-xs leading-relaxed text-slate-500">
              이메일 없이 가입된 계정이에요. 이메일은 선택이라 그대로 이용할 수 있어요.
            </p>
          ) : null}
        </div>

        <button
          type="submit"
          disabled={submitting}
          className="w-full min-h-14 rounded-2xl text-base font-extrabold text-white transition disabled:cursor-not-allowed disabled:opacity-60"
          style={{ backgroundColor: accent }}
        >
          {submitting ? "저장 중…" : "프로필 완성하기"}
        </button>
      </fieldset>
    </form>
  );
}
