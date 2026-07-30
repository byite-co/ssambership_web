import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { fetchWalletBalanceByUserId } from "@/lib/cash/cashQueries";
import { parseWalletBalanceBreakdown } from "@/lib/cash/parseWalletBalanceKrw";
import { finalizeSubscriptionCashWalletCheckout } from "@/lib/subscribe/subscribeCheckoutService";
import { getStudentSupabaseForSubscribe } from "@/lib/subscribe/subscribeCheckoutSession";
import { fetchPlansForMentor } from "@/lib/mentor/publicMentorBundle";
import { assignPlansByTier, isSubscribePlanTier } from "@/lib/subscribe/subscribePageQueries";
import { cashKrwFromAmountCents, mentorPlanDebitAmountCents } from "@/lib/subscribe/mentorPlanPricing";

function userMessageForCheckoutError(code: string | undefined, error: string): string {
  if (code === "dup") return error;
  if (/캐시|잔액|CASH_INSUFFICIENT/i.test(error)) return error;
  if (code === "not_found") return error;
  if (code === "forbidden") return error;
  if (/플랜|plan/i.test(error)) return error;
  return error.length > 0 && error.length < 200 ? error : "구독 처리에 실패했습니다. 잠시 후 다시 시도해 주세요.";
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch (e) {
    console.error("[subscribe/checkout] invalid JSON", e);
    return NextResponse.json(
      { ok: false, error: "bad_request", message: "요청 정보가 올바르지 않습니다." },
      { status: 400 }
    );
  }

  const { mentorId, planTier, amountCents, planId } = body as {
    mentorId?: string;
    planId?: string;
    planTier?: string;
    amountCents?: number;
  };

  const mentorIdTrim = String(mentorId ?? "").trim();
  if (!mentorIdTrim || !planTier || !isSubscribePlanTier(planTier)) {
    return NextResponse.json(
      { ok: false, error: "invalid_params", message: "요청 정보가 올바르지 않습니다." },
      { status: 400 }
    );
  }
  // S2-2 W3(C8): amountCents 는 학생이 결제 화면에서 실제로 본 금액(cents) — 불변 동의
  // 금액의 출발점이라 이제 필수다. 이 값이 intent(payments.amount·metadata 보존)와
  // F12 `p_expected_amount_cents` 로 그대로 흐른다(§6 — 서버 재계산으로 대체 금지).
  if (
    typeof amountCents !== "number" ||
    !Number.isFinite(amountCents) ||
    !Number.isInteger(amountCents) ||
    amountCents <= 0 ||
    amountCents % 100 !== 0
  ) {
    return NextResponse.json(
      { ok: false, error: "invalid_params", message: "결제 금액 정보가 올바르지 않습니다. 새로고침 후 다시 시도해 주세요." },
      { status: 400 }
    );
  }

  const session = await getStudentSupabaseForSubscribe();
  if (!session.ok) {
    return NextResponse.json(
      { ok: false, error: session.code, message: session.error },
      { status: session.status }
    );
  }

  const plans = await fetchPlansForMentor(session.supabase, mentorIdTrim);
  if (plans.error) {
    console.error("[subscribe/checkout] plan fetch failed", {
      mentorId: mentorIdTrim,
      planTier,
      error: plans.error,
    });
    return NextResponse.json(
      { ok: false, error: "plan_fetch_failed", message: "플랜 정보를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요." },
      { status: 400 }
    );
  }
  const { byTier } = assignPlansByTier(plans.rows);
  // 현재 플랜 가격은 신규 시도 사전 안내(UX)와 잔액 검사에만 쓴다 — F12 인자로는 쓰지
  // 않는다(확정 판정은 DB 3자 일치가 정본). 표시 금액과 다르면 결제 생성 전에 안내한다.
  const currentPlanAmountCents = mentorPlanDebitAmountCents(byTier[planTier], planTier);
  const expectedCashKrw = cashKrwFromAmountCents(amountCents);

  if (currentPlanAmountCents > 0 && amountCents !== currentPlanAmountCents) {
    console.error("[subscribe/checkout] amount_mismatch", {
      mentorId: mentorIdTrim,
      planTier,
      amountCents,
      currentPlanAmountCents,
      planProbe: plans.probe,
    });
    return NextResponse.json(
      {
        ok: false,
        error: "amount_mismatch",
        message: "결제 금액이 현재 멘토 요금제와 일치하지 않습니다. 새로고침 후 다시 시도해 주세요.",
      },
      { status: 400 }
    );
  }

  const balance = await fetchWalletBalanceByUserId(session.supabase, session.studentId);
  const breakdown = parseWalletBalanceBreakdown(balance.row);
  const balanceCents = breakdown.totalCash * 100;
  const requiredCents = amountCents;

  if (balanceCents < requiredCents) {
    return NextResponse.json(
      {
        ok: false,
        error: "insufficient_cash",
        message: "캐시가 부족합니다. 충전 후 다시 시도해 주세요.",
      },
      { status: 400 }
    );
  }

  const result = await finalizeSubscriptionCashWalletCheckout(session.supabase, {
    studentId: session.studentId,
    mentorId: mentorIdTrim,
    planTier,
    expectedAmountCents: amountCents,
  });

  if (!result.ok) {
    console.error("[subscribe/checkout] finalize failed", {
      code: result.code,
      error: result.error,
      mentorId: mentorIdTrim,
      planTier,
      planId: planId ?? null,
      studentId: session.studentId,
      balanceCents,
      requiredCents,
    });
    const status =
      result.code === "dup"
        ? 409
        : /캐시|잔액/i.test(result.error)
          ? 400
          : result.code === "not_found"
            ? 404
            : 500;
    return NextResponse.json(
      {
        ok: false,
        error: result.code,
        message: userMessageForCheckoutError(result.code, result.error),
      },
      { status }
    );
  }

  revalidatePath("/subscribe");
  revalidatePath("/subscriptions");
  revalidatePath("/question-room");
  revalidatePath("/wallet/charge");
  revalidatePath("/wallet/ledger");

  return NextResponse.json({
    ok: true,
    subscriptionId: result.subscriptionId,
    roomId: result.roomId,
    paymentId: result.paymentId,
    amountCents: requiredCents,
    cashKrw: expectedCashKrw,
  });
}
