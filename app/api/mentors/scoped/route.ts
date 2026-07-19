import { NextResponse } from "next/server";
import { defaultMentorsListFilters } from "@/lib/mentor/mentorsListSearchParams";
import { loadScopedMentorsList } from "@/lib/mentor/scopedMentorsList";
import { loadSchoolClassificationCatalogs } from "@/lib/mentor/schoolClassificationCatalog";
import { createClient } from "@/lib/supabase/server";

// P2-27 recent: 클라이언트 localStorage 최근 본 ID 를 URL 이 아닌 요청 본문으로 받아
// 제한된 서버 조회로 접근 가능한 멘토 카드만 요청 순서로 반환한다.
const MAX_IDS = 30;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  let body: { ids?: unknown };
  try {
    body = (await request.json()) as { ids?: unknown };
  } catch {
    return NextResponse.json({ ok: false, error: "요청 형식이 올바르지 않습니다." }, { status: 400 });
  }

  const rawIds = Array.isArray(body.ids) ? body.ids : [];
  const ids = [...new Set(rawIds.map((v) => String(v)).filter((s) => UUID_RE.test(s)))].slice(0, MAX_IDS);
  if (!ids.length) {
    return NextResponse.json({ ok: true, cards: [] });
  }

  try {
    const supabase = await createClient();
    const catalogs = await loadSchoolClassificationCatalogs(supabase);
    const filters = defaultMentorsListFilters({ scope: "recent", page: 1 });
    const list = await loadScopedMentorsList(
      supabase,
      filters,
      {
        schoolTierLabels: catalogs.schoolTierLabels,
        majorCategoryLabels: catalogs.majorCategoryLabels,
        pageSize: MAX_IDS,
      },
      { ids, orderByIds: true }
    );
    return NextResponse.json({ ok: true, cards: list.cards });
  } catch (e) {
    console.error("[POST /api/mentors/scoped]", e);
    return NextResponse.json({ ok: false, error: "최근 본 멘토를 불러오지 못했습니다." }, { status: 500 });
  }
}
