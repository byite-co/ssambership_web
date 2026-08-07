import type { CSSProperties, ReactNode } from "react";

const SUBJECT_CATEGORIES = [
  { label: "수학", desc: "수학 개념·문제 코치" },
  { label: "영어", desc: "영어 언어·작문 피드백" },
  { label: "국어", desc: "국어 작문·비설 코치" },
  { label: "과학", desc: "과학 실험·이론 정리" },
  { label: "사회", desc: "사회 내신·서술 코치" },
  { label: "기타", desc: "기타 학습 상담" },
] as const;

const CAT_COLORS = [
  { cls: "blue", cc: "#2563EB", cbg: "#eef4ff", cbd: "#c9dcfb" },
  { cls: "violet", cc: "#7c3aed", cbg: "#f4eeff", cbd: "#dccdfb" },
  { cls: "emerald", cc: "#059669", cbg: "#e9f8f1", cbd: "#aeead0" },
  { cls: "sky", cc: "#0284c7", cbg: "#e8f5fd", cbd: "#b3e0fa" },
  { cls: "amber", cc: "#d97706", cbg: "#fdf4e7", cbd: "#f8d99c" },
  { cls: "rose", cc: "#e11d48", cbg: "#fdeef2", cbd: "#f8c2cd" },
] as const;

const ICON_BY_NAME: Record<string, ReactNode> = {
  수학: (
    <svg className="ico" width="27" height="27" viewBox="0 0 24 24" aria-hidden>
      <line x1="19" y1="5" x2="5" y2="19" />
      <circle cx="6.5" cy="6.5" r="2.5" />
      <circle cx="17.5" cy="17.5" r="2.5" />
    </svg>
  ),
  영어: (
    <svg className="ico" width="27" height="27" viewBox="0 0 24 24" aria-hidden>
      <path d="M4 19.5A2.5 2.5 0 016.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z" />
    </svg>
  ),
  국어: (
    <svg className="ico" width="27" height="27" viewBox="0 0 24 24" aria-hidden>
      <path d="M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4 12.5-12.5z" />
    </svg>
  ),
  과학: (
    <svg className="ico" width="27" height="27" viewBox="0 0 24 24" aria-hidden>
      <path d="M9 3h6M10 3v5.5L5.2 17a2 2 0 001.8 3h10a2 2 0 001.8-3L14 8.5V3" />
    </svg>
  ),
  사회: (
    <svg className="ico" width="27" height="27" viewBox="0 0 24 24" aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3a15 15 0 010 18 15 15 0 010-18z" />
    </svg>
  ),
  기타: (
    <svg className="ico" width="27" height="27" viewBox="0 0 24 24" aria-hidden>
      <path d="M21 11.5a8.4 8.4 0 01-9 8.4L3 21l1.1-4A8.4 8.4 0 1121 11.5z" />
    </svg>
  ),
};

const FALLBACK_ICON = (
  <svg className="ico" width="27" height="27" viewBox="0 0 24 24" aria-hidden>
    <path d="M4 4h16v16H4z" />
    <path d="M4 9h16M9 4v16" />
  </svg>
);

type DisplayCategory = { key: string; name: string; desc: string | null };

// D-CR-8: 카테고리 테이블 부재(사문 로더 loadCustomRequestCategories 제거) — 정적 상수만 사용.
const STATIC_DISPLAY_CATEGORIES: DisplayCategory[] = SUBJECT_CATEGORIES.map((c) => ({
  key: c.label,
  name: c.label,
  desc: c.desc,
}));

export function CustomRequestCategoryGrid() {
  const categories = STATIC_DISPLAY_CATEGORIES;

  return (
    <>
      <div className="sec-head">
        <span className="eyebrow">분야 선택</span>
        <h2>어떤 도움이 필요하신가요?</h2>
        <p>가까운 분야를 골라 의뢰를 등록해 주세요.</p>
      </div>
      <div className="cat-grid">
        {categories.map((cat, i) => {
          const c = CAT_COLORS[i % CAT_COLORS.length];
          const icon = ICON_BY_NAME[cat.name] ?? FALLBACK_ICON;
          const cardStyle = {
            "--cc": c.cc,
            "--cbg": c.cbg,
            "--cbd": c.cbd,
          } as CSSProperties;

          return (
            <article
              key={cat.key}
              tabIndex={0}
              className="cat"
              style={cardStyle}
            >
              <span className={`ticon ${c.cls}`}>{icon}</span>
              <div className="cn">{cat.name}</div>
              {cat.desc ? <div className="cs">{cat.desc}</div> : null}
              <span className="catgo" aria-hidden>
                <svg className="ico" width="19" height="19" viewBox="0 0 24 24">
                  <path d="M5 12h14M13 6l6 6-6 6" />
                </svg>
              </span>
            </article>
          );
        })}
      </div>
    </>
  );
}
