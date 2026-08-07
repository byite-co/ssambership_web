import { NextResponse } from "next/server";
import { requireMentorApiSession } from "@/lib/mentor/mentorPayoutsApiAuth";
import { loadMentorPayoutDetail, type PayoutLineType } from "@/lib/mentor/mentorPayoutsService";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const auth = await requireMentorApiSession();
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const month = url.searchParams.get("month");
  const typeRaw = url.searchParams.get("type");
  // D-MT-1: individual_question 을 화이트리스트에 포함하고, 미지원 값은 무음 all 폴백 대신
  // 400 으로 거부한다(개별질문 필터가 조용히 전 유형으로 확장되던 오독 차단).
  let type: PayoutLineType | "all" | null;
  if (typeRaw === null) {
    type = null;
  } else if (
    typeRaw === "subscription" ||
    typeRaw === "custom_request" ||
    typeRaw === "individual_question" ||
    typeRaw === "all"
  ) {
    type = typeRaw;
  } else {
    return NextResponse.json({ ok: false, error: "지원하지 않는 정산 유형입니다." }, { status: 400 });
  }

  try {
    const supabase = await createClient();
    const detail = await loadMentorPayoutDetail(supabase, auth.user.id, { month, type });
    return NextResponse.json({ ok: true, ...detail });
  } catch (e) {
    console.error("[GET /api/mentor/payouts/detail]", e);
    return NextResponse.json({ ok: false, error: "상세 내역을 불러오지 못했습니다." }, { status: 500 });
  }
}
