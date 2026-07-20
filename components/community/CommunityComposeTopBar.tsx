import Link from "next/link";

const PRIMARY = "#2563EB";

type Props = {
  backHref: string;
  formId: string;
  /** 제출 진행 중 버튼 비활성(중복 제출 방지). */
  disabled?: boolean;
};

export function CommunityComposeTopBar(props: Props) {
  const disabled = Boolean(props.disabled);
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3">
      <Link href={props.backHref} className="text-sm font-extrabold text-slate-600 hover:text-[#2563EB]">
        ← 뒤로
      </Link>
      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          form={props.formId}
          name="intent"
          value="draft"
          formNoValidate
          disabled={disabled}
          className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          임시저장
        </button>
        <button
          type="submit"
          form={props.formId}
          name="intent"
          value="publish"
          disabled={disabled}
          className="rounded-xl px-5 py-2 text-sm font-extrabold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          style={{ backgroundColor: PRIMARY }}
        >
          {disabled ? "올리는 중…" : "올리기"}
        </button>
      </div>
    </div>
  );
}
