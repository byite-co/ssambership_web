import type { ChangeEvent, ReactNode } from "react";

export type StudentSignupFormValues = {
  fullName: string;
  nickname: string;
  /** 학년(예: 고1·고2·고3·재수) — DB·메타 `grade_level`. 학교명 필드가 아니다(멘토 가입의 `high_school_name` 과 별개 계약). */
  gradeLevel: string;
  studentStatus: string;
  birthDate: string;
};

type StudentSignupFormProps = {
  value: StudentSignupFormValues;
  onChange: (v: StudentSignupFormValues) => void;
  disabled?: boolean;
  fieldErrors?: Partial<Record<"nickname" | "gradeLevel" | "birthDate", string>>;
};

const input =
  "mt-2 w-full min-h-12 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-900 outline-none transition placeholder:text-slate-400 " +
  "focus:border-[#2563EB] focus:ring-2 focus:ring-[#2563EB]/20 sm:min-h-[3.1rem] sm:px-5";

const label = "mb-0 block text-sm font-bold text-slate-800 sm:text-base";

const hint = "mt-1.5 text-sm leading-relaxed text-slate-500";

const sectionClass =
  "rounded-2xl border border-slate-200 bg-white p-5 sm:p-6";

function patch(
  v: StudentSignupFormValues,
  p: Partial<StudentSignupFormValues>
): StudentSignupFormValues {
  return { ...v, ...p };
}

function SectionHeader({ n, id, children }: { n: string; id: string; children: ReactNode }) {
  return (
    <div className="mb-4 border-b border-slate-100 pb-3">
      <p className="text-xs font-extrabold tracking-wide text-[#2563EB]">{n}</p>
      <h3 id={id} className="mt-0.5 text-base font-extrabold text-slate-900 sm:text-lg">
        {children}
      </h3>
    </div>
  );
}

export function StudentSignupForm({ value, onChange, disabled, fieldErrors }: StudentSignupFormProps) {
  const today = new Date();
  const todayInputMax = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(
    today.getDate()
  ).padStart(2, "0")}`;
  function h<K extends keyof StudentSignupFormValues>(k: K, ev: ChangeEvent<HTMLInputElement>) {
    onChange(patch(value, { [k]: ev.target.value } as Pick<StudentSignupFormValues, K>));
  }

  return (
    <div className="space-y-6 sm:space-y-7 md:space-y-8">
      <section className={sectionClass} aria-labelledby="st-profile-heading">
        <SectionHeader n="프로필" id="st-profile-heading">
          닉네임 &amp; 학교
        </SectionHeader>
        <div className="grid grid-cols-1 gap-5 sm:gap-6 md:grid-cols-2">
          <div>
            <label htmlFor="st-nick" className={label}>
              닉네임 <span className="text-red-500">*</span>
            </label>
            <input
              id="st-nick"
              className={input}
              value={value.nickname}
              onChange={(e) => h("nickname", e)}
              disabled={disabled}
              autoComplete="nickname"
              placeholder="서비스에 표시될 호칭"
              aria-invalid={!!fieldErrors?.nickname}
            />
            {fieldErrors?.nickname ? (
              <p className="mt-1.5 text-sm text-red-600" role="alert">
                {fieldErrors.nickname}
              </p>
            ) : (
              <p className={hint}>멘토·학생에게 노출되는 이름이에요.</p>
            )}
          </div>
          <div>
            <label htmlFor="st-birth-date" className={label}>
              생년월일 <span className="text-red-500">*</span>
            </label>
            <input
              id="st-birth-date"
              type="date"
              className={input}
              value={value.birthDate}
              onChange={(e) => h("birthDate", e)}
              disabled={disabled}
              autoComplete="bday"
              max={todayInputMax}
              aria-invalid={!!fieldErrors?.birthDate}
            />
            {fieldErrors?.birthDate ? (
              <p className="mt-1.5 text-sm text-red-600" role="alert">
                {fieldErrors.birthDate}
              </p>
            ) : (
              <p className={hint}>만 14세 미만 여부를 확인하기 위한 필수 정보입니다.</p>
            )}
          </div>
          <div>
            <label htmlFor="st-grade" className={label}>
              학년 <span className="font-normal text-slate-500">(선택)</span>
            </label>
            <input
              id="st-grade"
              className={input}
              value={value.gradeLevel}
              onChange={(e) => h("gradeLevel", e)}
              disabled={disabled}
              placeholder="예: 고1, 고2, 고3, 재수"
            />
            <p className={hint}>학생 프로필과 탐색 카드에 반영됩니다.</p>
          </div>
        </div>
      </section>
    </div>
  );
}
