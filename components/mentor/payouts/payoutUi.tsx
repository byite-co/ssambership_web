import { formatCashKrw } from "@/lib/mentor/mentorPayoutsConstants";
import type { PayoutLineType } from "@/lib/mentor/mentorPayoutsTypes";
import {
  settlementHoldReasonLabel,
  settlementStatusLabel,
} from "@/lib/mentor/mentorSettlementDisplay";

export { formatCashKrw };

/**
 * 정산 금액 표시 — RPC cents/100 을 그대로 받는다. 캐시 정수면 통일 포맷으로,
 * 소수(구독·개별질문 85% 산식에서 가격이 20의 배수가 아니면 합법적으로 발생)면
 * 반올림·절사 없이 정확값을 노출하되 단위 오류 표식을 붙인다(무음 보정 금지).
 */
export function CashText(props: { cash: number; unit?: boolean }) {
  const withUnit = props.unit ?? true;
  if (Number.isInteger(props.cash)) {
    return <>{withUnit ? formatCashKrw(props.cash) : props.cash.toLocaleString("ko-KR")}</>;
  }
  const exact = props.cash.toLocaleString("ko-KR", { maximumFractionDigits: 2 });
  return (
    <span
      className="text-rose-700 underline decoration-dotted underline-offset-2"
      title={`캐시 단위 오류 — 원 단위와 일치하지 않는 금액입니다 (${exact} 캐시)`}
    >
      {withUnit ? `${exact} 캐시` : exact}
    </span>
  );
}

/** 일자 표시 — 표·XLSX 의 월 버킷(RPC KST 경계)과 일치하도록 KST 고정(뷰어 시간대 무관). */
export function formatPayoutTableDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Asia/Seoul",
  }).format(d);
}

export function typeBadgeClass(type: PayoutLineType | "unknown"): string {
  if (type === "subscription") return "border-slate-200 bg-slate-100 text-slate-600";
  if (type === "individual_question") return "border-sky-200 bg-sky-50 text-sky-800";
  if (type === "unknown") return "border-red-200 bg-red-50 text-red-700";
  return "border-emerald-200 bg-emerald-50 text-emerald-800";
}

export function typeBadgeLabel(type: PayoutLineType | "unknown"): string {
  if (type === "subscription") return "구독";
  if (type === "individual_question") return "개별질문";
  if (type === "unknown") return "알 수 없음";
  return "맞춤의뢰";
}

/**
 * 정산 내역 상태 칩 — RPC 가 정규화한 5종(accruing/pending/hold/paid/canceled)만 매핑한다.
 * 그 외 값은 오류 칩으로 그대로 노출한다(무음 매핑 금지 — 미지값을 '지급 예정'으로 접지 않는다).
 * hold 는 hold_reason 을 툴팁으로 안내한다(active_dispute → "분쟁 진행 중").
 */
export function settlementLineStatusBadge(
  status: string,
  holdReason: string | null
): { label: string; className: string; title?: string } {
  const label = settlementStatusLabel(status);
  if (label === null) {
    return {
      label: "상태 오류",
      className: "border-red-200 bg-red-50 text-red-700",
      title: `알 수 없는 상태값: ${status}`,
    };
  }
  switch (status) {
    case "paid":
      return { label, className: "border-emerald-200 bg-emerald-50 text-emerald-800" };
    case "hold":
      return {
        label,
        className: "border-slate-200 bg-slate-100 text-slate-600",
        title: settlementHoldReasonLabel(holdReason) ?? undefined,
      };
    case "canceled":
      return { label, className: "border-slate-200 bg-slate-100 text-slate-500" };
    case "accruing":
      // 지급 예정(amber)과 색까지 구분한다 — 같은 칩으로 보이면 구분한 의미가 없다.
      return { label, className: "border-sky-200 bg-sky-50 text-sky-800" };
    default:
      return { label, className: "border-amber-200 bg-amber-50 text-amber-900" };
  }
}

export function performanceStatusBadge(status: "done" | "in_progress" | "cancelled"): {
  label: string;
  className: string;
} {
  switch (status) {
    case "done":
      return { label: "완료", className: "border-emerald-200 bg-emerald-50 text-emerald-800" };
    case "cancelled":
      return { label: "취소", className: "border-slate-200 bg-slate-100 text-slate-500" };
    default:
      return { label: "진행중", className: "border-slate-200 bg-slate-100 text-slate-600" };
  }
}

export function momLabel(pct: number | null): string {
  if (pct === null) return "전월 대비 —";
  if (pct === 0) return "전월 대비 0%";
  const sign = pct > 0 ? "+" : "";
  return `전월 대비 ${sign}${pct}%`;
}

export function momClass(pct: number | null): string {
  if (pct === null || pct === 0) return "text-slate-500";
  return pct > 0 ? "text-emerald-700" : "text-red-600";
}
