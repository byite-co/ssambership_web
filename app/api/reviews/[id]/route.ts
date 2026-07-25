import { NextResponse } from "next/server";
import { getServerUserWithProfile } from "@/lib/auth/getServerUserWithProfile";
import { updateReview } from "@/lib/reviews/reviewQueries";
import { createClient } from "@/lib/supabase/server";

type RouteContext = { params: Promise<{ id: string }> };

/** 편집 모드 prefill 용 — 본인 후기 1건만 반환한다. */
export async function GET(_request: Request, context: RouteContext) {
  const { user, error: authError } = await getServerUserWithProfile();
  if (authError || !user) {
    return NextResponse.json({ ok: false, error: "로그인이 필요합니다." }, { status: 401 });
  }

  const { id } = await context.params;
  const reviewId = id?.trim();
  if (!reviewId) {
    return NextResponse.json({ ok: false, error: "후기를 지정해 주세요." }, { status: 400 });
  }

  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("reviews")
      .select("id, rating, body, author_id")
      .eq("id", reviewId)
      .maybeSingle();

    if (error || !data) {
      return NextResponse.json({ ok: false, error: "후기를 찾을 수 없습니다." }, { status: 404 });
    }
    const row = data as { id: string; rating: number; body: string; author_id: string };
    if (row.author_id !== user.id) {
      return NextResponse.json({ ok: false, error: "본인이 작성한 후기만 볼 수 있습니다." }, { status: 403 });
    }

    return NextResponse.json({ ok: true, review: { id: row.id, rating: row.rating, body: row.body } });
  } catch (e) {
    console.error("[GET /api/reviews/[id]]", e);
    return NextResponse.json({ ok: false, error: "후기를 불러오지 못했습니다." }, { status: 500 });
  }
}

/**
 * 작성자 본인 후기 수정. SQL 171 로 열린 경로다.
 * POST /api/reviews 의 `profile?.role !== "student"` → 403 게이트 패턴을 계승하고,
 * 본인 후기인지는 updateReview 안에서 서버가 다시 확인한다(RLS 와 이중 방어).
 */
export async function PATCH(request: Request, context: RouteContext) {
  const { user, profile, error: authError } = await getServerUserWithProfile();
  if (authError || !user) {
    return NextResponse.json({ ok: false, error: "로그인이 필요합니다." }, { status: 401 });
  }
  if (profile?.role !== "student") {
    return NextResponse.json({ ok: false, error: "학생만 후기를 수정할 수 있습니다." }, { status: 403 });
  }

  const { id } = await context.params;
  const reviewId = id?.trim();
  if (!reviewId) {
    return NextResponse.json({ ok: false, error: "후기를 지정해 주세요." }, { status: 400 });
  }

  let payload: { rating?: number; body?: string; content?: string };
  try {
    payload = (await request.json()) as typeof payload;
  } catch {
    return NextResponse.json({ ok: false, error: "요청 형식이 올바르지 않습니다." }, { status: 400 });
  }

  const body = (payload.body ?? payload.content ?? "").trim();

  try {
    const supabase = await createClient();
    const result = await updateReview(supabase, user.id, reviewId, {
      rating: Number(payload.rating),
      body,
    });
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
    }
    return NextResponse.json({ ok: true, id: result.id });
  } catch (e) {
    console.error("[PATCH /api/reviews/[id]]", e);
    return NextResponse.json({ ok: false, error: "후기 수정에 실패했습니다." }, { status: 500 });
  }
}
