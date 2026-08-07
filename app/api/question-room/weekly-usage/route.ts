import { NextResponse } from "next/server";
import { getQnaApiSession } from "@/lib/qna/questionRoomApiAuth";
import {
  fetchWeeklyQuestionUsageSelf,
  weeklyUsageDisplayLimit,
  weeklyUsageToSnapshot,
} from "@/lib/qna/weeklyQuestionUsage";

/**
 * 단건 계약: `?mentorId=` → { ok, usage: { ...snapshot, limitLabel } }.
 * D-QR-3: 호출부 0 이던 `?mentorIds=` 배치 분기(limitLabel 누락·다른 응답 모양)는 제거했다 —
 * 두 응답 계약이 한 라우트에 공존해 향후 배치화 시 클라이언트 파싱이 깨지던 표면을 없앴다.
 */

export async function GET(req: Request) {
  const session = await getQnaApiSession();
  if (!session.ok) {
    return NextResponse.json({ ok: false, error: session.error }, { status: session.status });
  }
  if (session.actor !== "student") {
    return NextResponse.json(
      { ok: false, error: "학생만 주간 질문 사용량을 조회할 수 있습니다." },
      { status: 403 }
    );
  }

  const url = new URL(req.url);
  const mentorId = url.searchParams.get("mentorId")?.trim();

  if (!mentorId) {
    return NextResponse.json({ ok: false, error: "mentorId가 필요합니다." }, { status: 400 });
  }

  const { usage, error } = await fetchWeeklyQuestionUsageSelf(
    session.supabase,
    session.user.id,
    mentorId
  );

  if (error) {
    console.error("[GET /api/question-room/weekly-usage]", error);
  }

  return NextResponse.json({
    ok: true,
    usage: {
      ...weeklyUsageToSnapshot(usage),
      limitLabel: weeklyUsageDisplayLimit(usage),
    },
  });
}
