import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { loadApplicationById } from "@/lib/customRequest/customRequestQueries";

type Row = Record<string, unknown>;

// PR-1b V-4: 구 CUSTOM_ORDER_PLATFORM_FEE_RATE(0.05 TS 사본) 삭제 — 요율 정본은 DB(정산 행 fee_rate · 분배/수락 RPC)다.
// 아래 분할 함수의 요율은 호출부가 DB(RPC 결과)에서 받은 값을 명시적으로 넘긴다(기본값 없음).

function toPositiveIntWon(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number" && Number.isFinite(v) && v > 0) {
    return Math.floor(v);
  }
  if (typeof v === "string" && v.trim()) {
    const n = Number(String(v).replace(/,/g, "").trim());
    if (Number.isFinite(n) && n > 0) {
      return Math.floor(n);
    }
  }
  return null;
}

export type GrossAmountSource =
  | `order.${string}`
  | `application.${string}`
  | "none";

/**
 * DB 행만 사용 (FormData·클라이언트 입력 금지).
 * 우선순위: 주문(합의·최종) → 지원(제안·입찰).
 */
export function pickGrossAmountWonWithSource(
  order: Row | null,
  application: Row | null,
  logContext?: { orderId?: string }
): { gross: number; source: GrossAmountSource } | null {
  const orderKeys = [
    "agreed_price",
    "final_price",
    "quote_price",
    "price",
    "paid_amount",
    "amount",
    "total",
    "total_amount",
  ] as const;
  for (const k of orderKeys) {
    if (order && k in order) {
      const n = toPositiveIntWon((order as Row)[k]);
      if (n != null) {
        const source = `order.${k}` as const;
        if (logContext?.orderId) {
          console.info("[pickGrossAmountWonWithSource] gross source", { orderId: logContext.orderId, source, gross: n });
        }
        return { gross: n, source };
      }
    }
  }
  const appKeys = ["proposed_price", "bid_amount", "quote_price", "price"] as const;
  for (const k of appKeys) {
    if (application && k in application) {
      const n = toPositiveIntWon((application as Row)[k]);
      if (n != null) {
        const source = `application.${k}` as const;
        if (logContext?.orderId) {
          console.info("[pickGrossAmountWonWithSource] gross source", { orderId: logContext.orderId, source, gross: n });
        }
        return { gross: n, source };
      }
    }
  }
  if (logContext?.orderId) {
    console.warn("[pickGrossAmountWonWithSource] no positive gross from DB rows", { orderId: logContext.orderId });
  }
  return null;
}

/** @deprecated 내부는 `pickGrossAmountWonWithSource` — 소스 추적이 필요하면 그쪽을 쓰세요. */
export function pickGrossAmountWonFromOrderAndApplication(order: Row | null, application: Row | null): number | null {
  const picked = pickGrossAmountWonWithSource(order, application);
  return picked?.gross ?? null;
}

export function splitPlatformAndMentorForGross(
  grossWon: number,
  feeRate: number
): { platformFee: number; mentorAmount: number } {
  const g = Math.max(0, Math.floor(grossWon));
  const platformFee = Math.floor(g * feeRate);
  const mentorAmount = g - platformFee;
  return { platformFee, mentorAmount };
}

/**
 * 주문 id로 지원 로드(금액 후보) — 수락 액션에서 insert 전에 사용.
 */
export async function loadApplicationRowForOrder(supabase: SupabaseClient, order: Row): Promise<Row | null> {
  for (const k of ["application_id", "custom_request_application_id", "selected_application_id", "bid_id"] as const) {
    const v = order[k];
    if (typeof v === "string" && v.trim()) {
      const { row } = await loadApplicationById(supabase, v);
      return row;
    }
  }
  return null;
}
