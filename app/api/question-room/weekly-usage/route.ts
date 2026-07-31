import { NextResponse } from "next/server";
import { getQnaApiSession } from "@/lib/qna/questionRoomApiAuth";
import {
  fetchWeeklyQuestionUsageSelf,
  weeklyUsageDisplayLimit,
  weeklyUsageToSnapshot,
} from "@/lib/qna/weeklyQuestionUsage";

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
  const mentorIdsParam = url.searchParams.get("mentorIds")?.trim();

  if (mentorIdsParam) {
    const ids = mentorIdsParam.split(",").map((s) => s.trim()).filter(Boolean);
    const usageMap: Record<string, ReturnType<typeof weeklyUsageToSnapshot>> = {};
    await Promise.all(
      ids.map(async (mid) => {
        const { usage } = await fetchWeeklyQuestionUsageSelf(
          session.supabase,
          session.user.id,
          mid
        );
        usageMap[mid] = weeklyUsageToSnapshot(usage);
      })
    );
    return NextResponse.json({ ok: true, usageByMentorId: usageMap });
  }

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
