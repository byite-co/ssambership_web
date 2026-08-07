import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { recordPostViewV2 } from "@/lib/community/communityBoardMutations";
import { isCommunityPostUuid } from "@/lib/community/communityQueries";
import { anonViewerKeyFromRequestHeaders, viewEventKeyFor } from "@/lib/community/viewEventKey";

/**
 * 게시글 조회수 +1 — 클라이언트(BoardViewTracker)가 세션당 1회만 호출.
 * 카운팅 외 부수효과 없음(데이터 변경 없음).
 * D-CM-4: 멱등키 없는 v1 RPC 대신 v2(community_post_view_record_v2)로 계수한다.
 * event_key 는 (글 + 뷰어 + 시간버킷) 결정적 파생 — 뷰어는 로그인 uid,
 * 비로그인은 요청 헤더(첫 홉 IP + UA) sha256 익명키(원본 미저장·미로깅).
 */
export async function POST(req: Request) {
  let postId = "";
  try {
    const body = (await req.json()) as { postId?: unknown };
    postId = typeof body?.postId === "string" ? body.postId : "";
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  if (!isCommunityPostUuid(postId)) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  try {
    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getUser();
    const viewerId = auth.user?.id ?? anonViewerKeyFromRequestHeaders(req.headers);
    const res = await recordPostViewV2(supabase, postId, viewEventKeyFor(postId, viewerId));
    if (!res.ok) return NextResponse.json({ ok: false }, { status: 200 });
  } catch {
    return NextResponse.json({ ok: false }, { status: 200 });
  }

  return NextResponse.json({ ok: true });
}
