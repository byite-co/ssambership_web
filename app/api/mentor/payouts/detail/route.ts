import { NextResponse } from "next/server";
import { requireMentorApiSession } from "@/lib/mentor/mentorPayoutsApiAuth";
import { fetchMentorSettlementLines } from "@/lib/mentor/mentorSettlementService";
import { createClient } from "@/lib/supabase/server";

const SOURCE_TYPES = ["subscription", "custom_request", "individual_question"] as const;

/**
 * 정산 내역 조회 — mentor_settlement_lines RPC 단일 소스 (월 = occurred_at KST 경계).
 * RPC 는 security definer + auth.uid() 라 세션 클라이언트로 호출하며, 금액·상태를 서버·클라이언트
 * 어디서도 재계산하지 않는다. 실패는 fail-closed(빈 목록으로 무음 degrade 하지 않는다).
 */
export async function GET(request: Request) {
  const auth = await requireMentorApiSession();
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const month = url.searchParams.get("month");
  if (month !== null && !/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json({ ok: false, error: "지원하지 않는 월 형식입니다." }, { status: 400 });
  }
  // D-MT-1: 미지원 유형 값은 무음 all 폴백 대신 400 으로 거부한다.
  const typeRaw = url.searchParams.get("type");
  if (
    typeRaw !== null &&
    typeRaw !== "all" &&
    !(SOURCE_TYPES as readonly string[]).includes(typeRaw)
  ) {
    return NextResponse.json({ ok: false, error: "지원하지 않는 정산 유형입니다." }, { status: 400 });
  }

  const supabase = await createClient();
  const result = await fetchMentorSettlementLines(supabase, { ym: month });
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 500 });
  }
  const lines =
    typeRaw && typeRaw !== "all" ? result.data.filter((l) => l.sourceType === typeRaw) : result.data;
  return NextResponse.json({ ok: true, lines });
}
