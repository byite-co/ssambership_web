import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { confirmCashTopupForCurrentUser } from "@/lib/toss/confirmCashTopupServer";

// 인증 사용자 기반 Toss 승인 라우트 — success page 와 **같은 서버 코어**
// (confirmCashTopupForCurrentUser)를 직접 호출한다. HTTP 계약(오류 code·status·
// 성공/duplicate 응답 형태)은 기존 클라이언트 호환을 유지한다.
// 검증 순서: 인증·소유권·패키지 allowlist 통과 후에만 Toss 외부 승인 호출
// (미로그인·타인 orderId·형식 오류·비허용 패키지에서 Toss fetch 0회).

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as
    | { paymentKey?: unknown; orderId?: unknown; amount?: unknown }
    | null;
  if (!body) {
    return NextResponse.json({ error: "invalid_params" }, { status: 400 });
  }

  const result = await confirmCashTopupForCurrentUser({
    paymentKey: body.paymentKey,
    orderId: body.orderId,
    amount: body.amount,
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, message: result.message },
      { status: result.httpStatus },
    );
  }

  if (result.duplicate) {
    return NextResponse.json({ ok: true, duplicate: true, amount: result.amount, payAmount: result.payAmount });
  }

  revalidatePath("/wallet");
  revalidatePath("/wallet/charge");
  revalidatePath("/wallet/ledger");

  return NextResponse.json({
    ok: true,
    amount: result.amount,
    payAmount: result.payAmount,
    method: result.method,
  });
}
