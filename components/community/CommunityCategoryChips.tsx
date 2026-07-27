"use client";

import { useState } from "react";

type CategoryOption = { slug: string; label: string };

type Props = {
  categories: readonly CategoryOption[];
  name: string;
  defaultSlug?: string;
  /** postType 등 외부 값이 바뀔 때 선택값 리셋 */
  resetKey?: string;
};

function pickInitial(categories: readonly CategoryOption[], defaultSlug: string): string {
  const options = categories.filter((c) => c.slug !== "all");
  return options.some((c) => c.slug === defaultSlug) ? defaultSlug : (options[0]?.slug ?? "free");
}

export function CommunityCategoryChips({ categories, name, defaultSlug = "free", resetKey }: Props) {
  const options = categories.filter((c) => c.slug !== "all");
  const [selected, setSelected] = useState(() => pickInitial(categories, defaultSlug));

  // 외부 값(카테고리 구성·기본값·resetKey) 변경 시 선택값 리셋 — effect 대신 렌더 중 파생 리셋
  // (react-hooks/set-state-in-effect 안전 변환 패턴, 내용 기반 key 라 배열 identity 변화에도 안정).
  const syncKey = `${resetKey ?? ""}|${defaultSlug}|${options.map((c) => c.slug).join(",")}`;
  const [prevSyncKey, setPrevSyncKey] = useState(syncKey);
  if (prevSyncKey !== syncKey) {
    setPrevSyncKey(syncKey);
    setSelected(pickInitial(categories, defaultSlug));
  }

  return (
    <fieldset>
      <legend className="text-sm font-extrabold text-slate-800">카테고리</legend>
      <input type="hidden" name={name} value={selected} required />
      <div className="mt-2 flex flex-nowrap gap-2 overflow-x-auto -mx-1 px-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden md:mx-0 md:flex-wrap md:overflow-visible md:px-0">
        {options.map((c) => {
          const active = selected === c.slug;
          return (
            <button
              key={c.slug}
              type="button"
              onClick={() => setSelected(c.slug)}
              className={[
                "shrink-0 whitespace-nowrap rounded-full px-3.5 py-1.5 text-xs font-bold transition",
                active ? "bg-[#2563EB] text-white" : "border border-slate-200 text-slate-600 hover:bg-slate-50",
              ].join(" ")}
              aria-pressed={active}
            >
              {c.label}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
