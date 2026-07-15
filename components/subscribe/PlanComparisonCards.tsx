import Link from "next/link";
import {
  type PlansByTier,
  priceLabelFromPlanRow,
  weeklyQuestionsLabel,
  type SubscribePlanTier,
} from "@/lib/subscribe/subscribePageQueries";
import { getSubscribeCatalogPlan, SUBSCRIBE_PLAN_CATALOG } from "@/lib/subscribe/subscribePlanCatalog";
import { USER_UI_LOAD_FAILED } from "@/lib/constants/userFacingMessages";

const TIERS = SUBSCRIBE_PLAN_CATALOG.map((p) => ({
  id: p.tier,
  label: p.label,
  recommend: p.recommend,
}));

/** 멘토 상세 사이드바: 스탠다드 → 라이트 → 프리미엄 */
const RADIO_RAIL_ORDER: SubscribePlanTier[] = ["standard", "limited", "premium"];

export type PlanComparisonLayout = "checkout" | "rail" | "grid" | "radio-rail";

function tierGlyphClass(id: SubscribePlanTier): string {
  if (id === "limited") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (id === "standard") return "border-blue-200 bg-blue-50 text-blue-800";
  return "border-violet-200 bg-violet-50 text-violet-800";
}

function tierGlyphLetter(id: SubscribePlanTier): string {
  if (id === "limited") return "L";
  if (id === "standard") return "S";
  return "P";
}

function tierOutlineBtn(id: SubscribePlanTier): string {
  if (id === "limited")
    return "border-2 border-emerald-500/70 bg-white text-emerald-900 hover:bg-emerald-50/80";
  if (id === "standard") return "border-2 border-blue-500/80 bg-white text-blue-900 hover:bg-blue-50/80";
  return "border-2 border-violet-500/70 bg-white text-violet-900 hover:bg-violet-50/80";
}

function checkoutBenefitLines(tier: SubscribePlanTier, row: Record<string, unknown> | undefined): string[] {
  const weekly = weeklyQuestionsLabel(row ?? null);
  const tierHint =
    tier === "limited"
      ? "처음엔 가볍게 시작해 부담을 줄여 보기 좋아요."
      : tier === "standard"
        ? "질문 한도와 가격의 균형이 무난한 플랜이에요."
        : "질문 한도가 넉넉해 집중 멘토링에 맞춰요.";
  const lines: string[] = [
    `주간 신규 질문: ${weekly}`,
    "질문방에서 멘토와 학습을 이어갈 수 있어요.",
  ];
  const desc = row ? getStringFieldLocal(row) : null;
  if (desc && desc.trim().length > 12) {
    lines.push(desc.length > 72 ? `${desc.slice(0, 69)}…` : desc);
  }
  lines.push(tierHint, "결제 전에 다른 플랜으로 다시 고를 수 있어요.");
  return lines.slice(0, 5);
}

export function PlanComparisonCards(props: {
  mentorId: string;
  byTier: PlansByTier;
  selectedTier: SubscribePlanTier;
  onSelectTier?: (tier: SubscribePlanTier) => void;
  plansError: string | null;
  /**
   * checkout: 구독 본문 — 3열 비교, 선택 플랜 강조, CTA 하단 정렬.
   * rail: 멘토 상세 우측 — 세로 compact, 링크형 카드.
   * radio-rail: 멘토 상세 — 라디오 선택형 카드 3개.
   * grid: checkout과 동일(하위 호환).
   */
  layout?: PlanComparisonLayout;
}) {
  const {
    mentorId,
    byTier,
    selectedTier,
    onSelectTier,
    plansError,
    layout = "checkout",
  } = props;
  if (plansError) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-5">
        <p className="text-sm font-extrabold text-red-900">플랜 조회 오류</p>
        <p className="mt-1 text-sm text-red-800">{USER_UI_LOAD_FAILED}</p>
      </div>
    );
  }

  if (layout === "radio-rail") {
    return (
      <div className="w-full min-w-0 space-y-2.5" role="radiogroup" aria-label="구독 요금제 선택">
        {RADIO_RAIL_ORDER.map((tierId) => {
          const t = TIERS.find((x) => x.id === tierId);
          if (!t) return null;
          const catalog = getSubscribeCatalogPlan(tierId);
          const row = byTier[tierId];
          const selected = selectedTier === tierId;
          const isRec = Boolean(t.recommend);
          const price = priceLabelFromPlanRow(row, tierId);

          return (
            <label
              key={tierId}
              className={[
                "relative flex cursor-pointer flex-col rounded-xl border p-3.5 transition",
                selected
                  ? "border-2 border-[#2563EB] bg-blue-50/50 ring-1 ring-[#2563EB]/20"
                  : "border-slate-200 bg-white hover:border-slate-300",
              ].join(" ")}
            >
              <input
                type="radio"
                name="mentor-plan-tier"
                value={tierId}
                checked={selected}
                onChange={() => onSelectTier?.(tierId)}
                className="absolute right-3 top-3 h-4 w-4 accent-[#2563EB]"
              />
              <div className="pr-8">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-sm font-black text-slate-900">{t.label}</span>
                  {isRec ? (
                    <span className="rounded bg-[#2563EB] px-1.5 py-px text-[9px] font-bold text-white">
                      추천
                    </span>
                  ) : null}
                </div>
                <p className="mt-1 text-base font-black tabular-nums text-slate-900">{price}</p>
                <p className="mt-0.5 text-[11px] font-semibold text-slate-600">
                  {catalog.weeklyLabel}
                </p>
              </div>
            </label>
          );
        })}
      </div>
    );
  }

  const mode: "checkout" | "rail" = layout === "rail" ? "rail" : "checkout";

  if (mode === "rail") {
    return (
      <div className="w-full min-w-0 space-y-3">
        <div className="flex flex-col gap-3">
          {TIERS.map((t) => {
            const row = byTier[t.id];
            const isRec = Boolean(t.recommend);
            return (
              <div
                key={t.id}
                className={`relative flex min-w-0 flex-col rounded-2xl border bg-white p-4 pt-5 leading-tight sm:p-4 ${
                  isRec
                    ? "border-2 border-blue-500 shadow-[0_8px_28px_rgba(26,86,219,0.12)] ring-1 ring-blue-100"
                    : "border border-slate-200 shadow-sm"
                }`}
              >
                {isRec ? (
                  <span className="absolute right-3 top-3 shrink-0 rounded-full bg-blue-600 px-2.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-white">
                    추천
                  </span>
                ) : (
                  <span
                    className="absolute right-3 top-3 flex h-5 w-5 shrink-0 rounded-full border-2 border-slate-200 bg-white"
                    aria-hidden
                  />
                )}
                <div className="min-w-0 pr-14">
                  <h3 className="break-keep text-base font-black tracking-tight text-slate-900">{t.label}</h3>
                </div>
                <div className="mt-3 min-h-[2.75rem] min-w-0">
                  <p
                    className={`break-keep text-xl font-black tracking-tight sm:text-2xl ${
                      isRec ? "text-blue-700" : "text-slate-900"
                    }`}
                  >
                    {priceLabelFromPlanRow(row, t.id)}
                  </p>
                </div>
                <p className="mt-1 break-keep text-[11px] font-bold leading-snug text-slate-600">
                  주간 신규 질문: {weeklyQuestionsLabel(row)}
                </p>
                {row ? (
                  <p className="mt-2 line-clamp-2 min-h-[2.25rem] text-[11px] leading-snug text-slate-500">
                    {getStringFieldLocal(row) ?? "학습 상황에 맞춰 선택할 수 있는 구독 옵션입니다."}
                  </p>
                ) : (
                  <div className="mt-2 space-y-1 text-[11px] font-bold leading-snug text-amber-800">
                    <p>이 티어의 요금 정보를 불러오지 못했어요.</p>
                    <p className="font-semibold text-amber-900/90">준비되면 이곳에서 다시 확인할 수 있어요.</p>
                  </div>
                )}
                <div className="mt-4 min-w-0">
                  <Link
                    href={`/subscribe?mentorId=${encodeURIComponent(mentorId)}&plan=${t.id}`}
                    className={`block w-full break-keep rounded-xl px-3 py-2.5 text-center text-xs font-extrabold transition sm:text-sm ${
                      isRec
                        ? "bg-blue-600 text-white shadow-sm hover:bg-blue-700"
                        : "border border-slate-200 bg-slate-50 text-slate-900 hover:bg-slate-100"
                    }`}
                  >
                    이 플랜으로 구독
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  /* checkout / grid */
  return (
    <div className="w-full min-w-0 space-y-3">
      <div className="grid w-full grid-cols-1 gap-4 md:grid-cols-3 md:items-stretch md:gap-5">
        {TIERS.map((t) => {
          const row = byTier[t.id];
          const selected = selectedTier === t.id;
          const isRec = Boolean(t.recommend);
          const bullets = checkoutBenefitLines(t.id, row ?? undefined);
          return (
            <div
              key={t.id}
              className={`flex h-full min-h-0 min-w-0 flex-col rounded-2xl border bg-white p-4 sm:p-5 md:min-h-[28rem] ${
                selected
                  ? "z-[1] border-2 border-blue-600 shadow-[0_12px_40px_rgba(26,86,219,0.18)] ring-2 ring-blue-100"
                  : isRec
                    ? "border border-blue-200/90 opacity-95 shadow-sm"
                    : "border border-slate-200 opacity-[0.92] shadow-sm"
              } ${!selected && isRec ? "bg-blue-50/50" : ""}`}
            >
              <div className="flex min-w-0 items-start gap-3">
                <div
                  className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border-2 text-xs font-black ${tierGlyphClass(t.id)}`}
                  aria-hidden
                >
                  {tierGlyphLetter(t.id)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <h3 className="min-w-0 break-keep text-lg font-black tracking-tight text-slate-900">{t.label}</h3>
                    {selected ? (
                      <span className="shrink-0 rounded-full bg-blue-600 px-2 py-0.5 text-[10px] font-extrabold text-white">
                        선택됨
                      </span>
                    ) : isRec ? (
                      <span className="shrink-0 rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-extrabold text-blue-800">
                        추천
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-2 inline-flex max-w-full break-keep rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-bold text-slate-700">
                    주간 신규 질문 {weeklyQuestionsLabel(row)}
                  </p>
                </div>
              </div>

              <div className="mt-4 flex min-h-[3.75rem] min-w-0 flex-col justify-end">
                <p
                  className={`break-keep text-2xl font-black leading-tight tracking-tight sm:text-[1.65rem] ${
                    selected ? "text-blue-700" : "text-slate-900"
                  }`}
                >
                  {priceLabelFromPlanRow(row, t.id)}
                </p>
              </div>

              <div className="mt-3 min-h-0 flex-1 min-w-0">
                {row ? (
                  <ul className="space-y-1.5 text-xs leading-snug text-slate-600">
                    {bullets.map((line, i) => (
                      <li key={`${t.id}-b-${i}`} className="flex gap-2 break-keep">
                        <span className="mt-0.5 shrink-0 text-emerald-600" aria-hidden>
                          ✓
                        </span>
                        <span>{line}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="space-y-1 text-xs font-bold text-amber-800">
                    <p>이 티어의 요금 정보를 불러오지 못했어요.</p>
                    <p className="font-semibold text-amber-900/90">준비되면 이곳에서 다시 확인할 수 있어요.</p>
                  </div>
                )}
              </div>

              <div className="mt-auto min-w-0 pt-5">
                <Link
                  href={`/subscribe?mentorId=${encodeURIComponent(mentorId)}&plan=${t.id}`}
                  className={`block w-full break-keep rounded-xl py-2.5 text-center text-sm font-extrabold transition ${
                    selected
                      ? "bg-blue-600 text-white shadow-sm hover:bg-blue-700"
                      : `${tierOutlineBtn(t.id)}`
                  }`}
                >
                  {selected ? "선택됨" : "이 플랜으로"}
                </Link>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function getStringFieldLocal(row: Record<string, unknown>) {
  for (const k of ["description", "summary", "body", "long_description"]) {
    const v = row[k];
    if (typeof v === "string" && v.trim()) return v;
  }
  return null;
}
