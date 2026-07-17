import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

type Row = Record<string, unknown>;
export type AdminListPagedResult = {
  table: string | null;
  rows: Row[];
  totalCount: number;
  error: string | null;
};

function isRangeNotSatisfiableError(e: { code?: string; message?: string } | null): boolean {
  if (!e) return false;
  return (
    e.code === "PGRST103" || /range not satisfiable|invalid range/i.test(String(e.message ?? ""))
  );
}

type Filter = (q: ReturnType<ReturnType<SupabaseClient["from"]>["select"]>) =>
  ReturnType<ReturnType<SupabaseClient["from"]>["select"]>;

async function runPaged(args: {
  client: SupabaseClient;
  table: string;
  applyFilters: Filter;
  from: number;
  to: number;
  orderColumn?: string;
}): Promise<AdminListPagedResult> {
  const orderColumn = args.orderColumn ?? "created_at";
  let q = args.client.from(args.table).select("*", { count: "exact" });
  q = args.applyFilters(q);
  const r1 = await q.order(orderColumn, { ascending: false }).range(args.from, args.to);
  if (!r1.error) {
    return {
      table: args.table,
      rows: ((r1.data as Row[] | null) ?? []),
      totalCount: r1.count ?? 0,
      error: null,
    };
  }
  if (isRangeNotSatisfiableError(r1.error)) {
    let head = args.client.from(args.table).select("*", { count: "exact", head: true });
    head = args.applyFilters(head);
    const r2 = await head;
    return { table: args.table, rows: [], totalCount: r2.count ?? 0, error: null };
  }
  return { table: args.table, rows: [], totalCount: 0, error: r1.error.message ?? null };
}

/** community_posts 페이지네이션 — 제목·본문·작성자 ID 검색 + 상태 필터. */
export async function loadAdminCommunityPostsListPaged(
  supabase: SupabaseClient,
  args: { search: string; status: string; page: number; pageSize: number }
): Promise<AdminListPagedResult> {
  const from = Math.max(0, (args.page - 1) * args.pageSize);
  const to = from + args.pageSize - 1;
  return runPaged({
    client: supabase,
    table: "community_posts",
    from,
    to,
    applyFilters: (q) => {
      let r = q;
      if (args.status && args.status !== "all") r = r.eq("status", args.status);
      if (args.search) {
        const s = args.search.replace(/[%_,]/g, " ").trim();
        if (s) {
          const looksLikeUuid = /^[0-9a-fA-F-]+$/.test(s);
          const parts: string[] = [];
          if (looksLikeUuid) {
            parts.push(`id.ilike.${s}%`);
            parts.push(`author_id.ilike.${s}%`);
          }
          parts.push(`title.ilike.%${s}%`);
          parts.push(`body.ilike.%${s}%`);
          parts.push(`category.ilike.%${s}%`);
          parts.push(`author_label.ilike.%${s}%`);
          r = r.or(parts.join(","));
        }
      }
      return r;
    },
  });
}

export async function loadAdminShortformPostsListPaged(
  supabase: SupabaseClient,
  args: { search: string; status: string; page: number; pageSize: number }
): Promise<AdminListPagedResult> {
  const from = Math.max(0, (args.page - 1) * args.pageSize);
  const to = from + args.pageSize - 1;
  return runPaged({
    client: supabase,
    table: "shortform_posts",
    from,
    to,
    applyFilters: (q) => {
      let r = q;
      if (args.status && args.status !== "all") r = r.eq("status", args.status);
      if (args.search) {
        const s = args.search.replace(/[%_,]/g, " ").trim();
        if (s) {
          const looksLikeUuid = /^[0-9a-fA-F-]+$/.test(s);
          const parts: string[] = [];
          if (looksLikeUuid) {
            parts.push(`id.ilike.${s}%`);
            parts.push(`author_id.ilike.${s}%`);
          }
          parts.push(`title.ilike.%${s}%`);
          parts.push(`description.ilike.%${s}%`);
          parts.push(`category.ilike.%${s}%`);
          r = r.or(parts.join(","));
        }
      }
      return r;
    },
  });
}

export async function loadAdminCommunityCommentsListPaged(
  supabase: SupabaseClient,
  args: { search: string; status: string; page: number; pageSize: number }
): Promise<AdminListPagedResult> {
  const from = Math.max(0, (args.page - 1) * args.pageSize);
  const to = from + args.pageSize - 1;
  return runPaged({
    client: supabase,
    table: "community_comments",
    from,
    to,
    applyFilters: (q) => {
      let r = q;
      if (args.status && args.status !== "all") r = r.eq("status", args.status);
      if (args.search) {
        const s = args.search.replace(/[%_,]/g, " ").trim();
        if (s) {
          const looksLikeUuid = /^[0-9a-fA-F-]+$/.test(s);
          const parts: string[] = [];
          if (looksLikeUuid) {
            parts.push(`id.ilike.${s}%`);
            parts.push(`author_id.ilike.${s}%`);
            parts.push(`post_id.ilike.${s}%`);
          }
          parts.push(`body.ilike.%${s}%`);
          parts.push(`author_label.ilike.%${s}%`);
          r = r.or(parts.join(","));
        }
      }
      return r;
    },
  });
}

/** 게시판 v2 댓글(comments) 페이지네이션 — status 대신 is_deleted 플래그 기준. */
export async function loadAdminBoardCommentsListPaged(
  supabase: SupabaseClient,
  args: { search: string; status: string; page: number; pageSize: number }
): Promise<AdminListPagedResult> {
  const from = Math.max(0, (args.page - 1) * args.pageSize);
  const to = from + args.pageSize - 1;
  return runPaged({
    client: supabase,
    table: "comments",
    from,
    to,
    applyFilters: (q) => {
      let r = q;
      if (args.status === "visible") r = r.eq("is_deleted", false);
      if (args.status === "hidden") r = r.eq("is_deleted", true);
      if (args.search) {
        const s = args.search.replace(/[%_,]/g, " ").trim();
        if (s) {
          const looksLikeUuid = /^[0-9a-fA-F-]+$/.test(s);
          const parts: string[] = [];
          if (looksLikeUuid) {
            parts.push(`id.ilike.${s}%`);
            parts.push(`author_id.ilike.${s}%`);
            parts.push(`post_id.ilike.${s}%`);
          }
          parts.push(`content.ilike.%${s}%`);
          r = r.or(parts.join(","));
        }
      }
      return r;
    },
  });
}

/** 각 콘텐츠 테이블별 상태별 카운트. */
export async function countAdminCommunityByStatus(
  supabase: SupabaseClient,
  table: "community_posts" | "shortform_posts" | "community_comments" | "comments"
): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  const { count: total } = await supabase.from(table).select("*", { count: "exact", head: true });
  out.all = total ?? 0;
  // 게시판 v2 댓글은 status 컬럼이 없고 is_deleted 로 노출을 제어한다.
  if (table === "comments") {
    const { count: visible } = await supabase
      .from(table)
      .select("*", { count: "exact", head: true })
      .eq("is_deleted", false);
    out.visible = visible ?? 0;
    out.hidden = (total ?? 0) - (visible ?? 0);
    return out;
  }
  const statuses =
    table === "community_comments"
      ? ["visible", "hidden"]
      : ["draft", "published", "hidden"];
  for (const s of statuses) {
    const { count } = await supabase
      .from(table)
      .select("*", { count: "exact", head: true })
      .eq("status", s);
    out[s] = count ?? 0;
  }
  return out;
}
