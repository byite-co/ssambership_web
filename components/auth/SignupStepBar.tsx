import { Fragment } from "react";

type SignupStepBarProps = {
  current: 1 | 2 | 3;
};

const steps: { n: 1 | 2 | 3; label: string }[] = [
  { n: 1, label: "1. 가입 유형 선택" },
  { n: 2, label: "2. 정보 입력" },
  { n: 3, label: "3. 가입 완료" },
];

const lineDone = "bg-[#2563EB]/30";
const linePending = "bg-slate-200";

export function SignupStepBar({ current }: SignupStepBarProps) {
  return (
    <div className="w-full" aria-label="가입 단계">
      <ol className="mx-auto flex w-full max-w-3xl items-stretch justify-between gap-1.5 px-0 sm:gap-3 md:gap-4">
        {steps.map((s, i) => {
          const here = s.n === current;
          const done = s.n < current;
          return (
            <Fragment key={s.n}>
              {i > 0 ? (
                <li className="flex min-w-0 flex-1 items-center self-center px-0.5" aria-hidden>
                  <div
                    className={`h-1 w-full rounded-full ${current > i ? lineDone : linePending}`}
                  />
                </li>
              ) : null}
              <li className="flex min-w-0 max-w-[30%] flex-col items-center sm:max-w-none sm:flex-1">
                <div className="flex w-full max-w-[9rem] flex-col items-center text-center sm:max-w-[11rem]">
                  <span
                    className={[
                      "flex h-9 w-9 items-center justify-center text-sm font-extrabold transition sm:h-10 sm:w-10 sm:text-base",
                      here
                        ? "rounded-full bg-[#2563EB] text-white"
                        : "",
                      done && !here
                        ? "rounded-full bg-[#2563EB] text-white"
                        : "",
                      !here && !done
                        ? "rounded-full border border-slate-200 bg-white text-slate-400"
                        : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  >
                    {done ? "✓" : s.n}
                  </span>
                  <span
                    className={[
                      "mt-2.5 w-full break-words text-center text-xs font-bold leading-tight sm:text-sm",
                      here ? "text-slate-900" : done ? "text-slate-700" : "text-slate-400",
                    ].join(" ")}
                  >
                    {s.label}
                  </span>
                </div>
              </li>
            </Fragment>
          );
        })}
      </ol>
    </div>
  );
}
