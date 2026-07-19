import type { SupabaseClient } from "@supabase/supabase-js";
import { pickExistingColumn } from "@/lib/qna/safeSelect";

type Row = Record<string, unknown>;

// supabase-js 빌더의 깊은 재귀 제네릭(TS2589 회피)을 피하기 위한 최소 인터페이스.
type QB = {
  eq: (c: string, v: unknown) => QB;
  is: (c: string, v: unknown) => QB;
  not: (c: string, o: string, v: unknown) => QB;
  or: (f: string) => QB;
  filter: (c: string, o: string, v: unknown) => QB;
  order: (c: string, o: { ascending: boolean }) => QB;
  limit: (n: number) => QB;
};
type QPageResult = { data: Row[] | null; error: { message: string } | null };
type QCountResult = { count: number | null; error: { message: string } | null };

const TABLE = "notifications";

const USER_FK = ["user_id", "recipient_id", "student_id", "mentor_id", "target_user_id", "owner_id"] as const;
const READ_FK = ["read_at", "read_at_utc", "is_read", "seen_at", "opened_at", "viewed_at", "acknowledged_at"] as const;
const TYPE_FK = [
  "type",
  "kind",
  "category",
  "event_type",
  "notification_type",
  "channel",
  "template",
] as const;
// 키셋 정렬 1순위 후보(존재하는 첫 컬럼). 동률은 항상 id(uuid, 유니크)로 안정화한다.
const ORDER_CANDIDATES = ["created_at", "inserted_at", "sent_at", "updated_at"] as const;
const BOOL_READ_COLS = new Set(["is_read", "read", "acknowledged"]);

/** P2-26: 서버 키셋 페이지 크기 기본값(모바일/데스크탑 공통) */
export const DEFAULT_NOTIFICATIONS_PAGE_SIZE = 10;
export const MAX_NOTIFICATIONS_PAGE_SIZE = 50;

export const NOTIFICATIONS_HUB_DATA_MODEL = [
  "받은 알림 목록",
  "발신·수신 표시",
  "질문방·주문 관련 바로가기",
  "결제·의뢰 알림 연결",
  "공지·이벤트 연동",
] as const;

export type NotificationCursor = { orderValue: string; id: string };
export type NotificationPageDir = "next" | "prev";

export type NotificationHubLoad = {
  error: string | null;
  probe: string;
  userColumn: string | null;
  readColumn: string | null;
  typeColumn: string | null;
  orderColumn: string | null;
  rows: Row[];
  /** read 컬럼이 없어 읽지 않음 탭을 지원하지 않음 */
  unreadFilterBlocked: boolean;
  // ── P2-26 키셋 페이지네이션 ──
  pageSize: number;
  hasNext: boolean;
  hasPrev: boolean;
  /** 다음(더 오래된) 페이지 이동용 커서 = 현재 페이지 마지막 행 */
  nextCursor: string | null;
  /** 이전(더 최근) 페이지 이동용 커서 = 현재 페이지 첫 행 */
  prevCursor: string | null;
  /** 본인 전체 미읽음 수(현재 페이지가 아니라 서버 count). read 컬럼 없으면 null */
  unreadCount: number | null;
};

export function isNotificationReadRow(row: Row, readCol: string | null): boolean {
  if (!readCol) return false;
  const v = row[readCol];
  if (BOOL_READ_COLS.has(readCol)) {
    return v === true || v === 1 || v === "true" || v === 1.0;
  }
  return v != null && String(v) !== "" && !String(v).startsWith("1970-01-01");
}

// ── 커서 인코딩(URL-safe base64url) — created_at 의 '+00:00' 등이 URL 왕복에서 손상되지 않도록 ──
// 구분자: 타임스탬프/uuid 에 나타나지 않는 제어문자(0x01).
const CURSOR_SEP = String.fromCharCode(1);

function b64urlEncode(raw: string): string {
  const b64 = typeof btoa === "function" ? btoa(raw) : Buffer.from(raw, "binary").toString("base64");
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlDecode(s: string): string {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  return typeof atob === "function" ? atob(b64) : Buffer.from(b64, "base64").toString("binary");
}

export function encodeNotificationCursor(orderValue: string, id: string): string {
  return b64urlEncode(`${orderValue}${CURSOR_SEP}${id}`);
}

export function decodeNotificationCursor(cursor: string | null | undefined): NotificationCursor | null {
  if (!cursor) return null;
  try {
    const raw = b64urlDecode(cursor);
    const idx = raw.indexOf(CURSOR_SEP);
    if (idx < 0) return null;
    const orderValue = raw.slice(0, idx);
    const id = raw.slice(idx + CURSOR_SEP.length);
    if (!id) return null;
    return { orderValue, id };
  } catch {
    return null;
  }
}

function baseLoad(pageSize: number): NotificationHubLoad {
  return {
    error: null,
    probe: "",
    userColumn: null,
    readColumn: null,
    typeColumn: null,
    orderColumn: null,
    rows: [],
    unreadFilterBlocked: false,
    pageSize,
    hasNext: false,
    hasPrev: false,
    nextCursor: null,
    prevCursor: null,
    unreadCount: null,
  };
}

// (orderCol, id) 키셋 조건. op = 'lt'(더 오래된) | 'gt'(더 최근). orderCol 없으면 id 단독.
function applyKeyset(q: QB, orderCol: string | null, op: "lt" | "gt", cur: NotificationCursor): QB {
  if (orderCol) {
    // 타임스탬프 값은 예약문자(:,+,.)를 담으므로 큰따옴표로 감싼다.
    return q.or(`${orderCol}.${op}."${cur.orderValue}",and(${orderCol}.eq."${cur.orderValue}",id.${op}.${cur.id})`);
  }
  return q.filter("id", op, cur.id);
}

/**
 * userId = 수신자인 알림 한 페이지(키셋). 정렬 = (orderCol DESC, id DESC), 동률 안정.
 * 읽지 않음 필터는 서버에서 적용(현재 페이지만 필터하는 누락 구조 금지).
 */
export async function loadNotificationsHub(
  supabase: SupabaseClient,
  userId: string,
  options: {
    filter: "all" | "unread";
    cursor?: NotificationCursor | null;
    dir?: NotificationPageDir;
    pageSize?: number;
  }
): Promise<NotificationHubLoad> {
  const pageSize = Math.min(
    MAX_NOTIFICATIONS_PAGE_SIZE,
    Math.max(1, options.pageSize ?? DEFAULT_NOTIFICATIONS_PAGE_SIZE)
  );
  const cur = options.cursor ?? null;
  const dir: NotificationPageDir = options.dir === "prev" ? "prev" : "next";
  const out = baseLoad(pageSize);

  const { error: pe } = await supabase.from(TABLE).select("id").limit(1);
  if (pe) {
    return { ...out, error: pe.message, probe: `${TABLE} 테이블 probe 실패` };
  }

  const { column: readCol } = await pickExistingColumn(supabase, TABLE, READ_FK);
  const { column: typeCol } = await pickExistingColumn(supabase, TABLE, TYPE_FK);
  const { column: orderCol } = await pickExistingColumn(supabase, TABLE, ORDER_CANDIDATES);
  out.readColumn = readCol;
  out.typeColumn = typeCol;
  out.orderColumn = orderCol;

  let userColumn: string | null = null;
  let lastUserErr: string | null = null;
  for (const col of USER_FK) {
    const p = await supabase.from(TABLE).select("id").eq(col, userId).limit(1);
    if (!p.error) {
      userColumn = col;
      break;
    }
    lastUserErr = p.error.message;
  }
  if (!userColumn) {
    return { ...out, error: lastUserErr, probe: "user_id/recipient_id 등 FK를 찾지 못함" };
  }
  out.userColumn = userColumn;

  if (options.filter === "unread" && !readCol) {
    return {
      ...out,
      probe: `notifications · ${userColumn} · 읽지 않음 필터: read/is_read 컬럼 없음`,
      unreadFilterBlocked: true,
    };
  }

  const uCol = userColumn;
  // 스코프(수신자 + 읽지 않음) 적용기 — count/page 공통.
  const withScope = (q: QB): QB => {
    let qq = q.eq(uCol, userId);
    if (options.filter === "unread" && readCol) {
      qq = BOOL_READ_COLS.has(readCol) ? qq.not(readCol, "is", true) : qq.is(readCol, null);
    }
    return qq;
  };
  const orderBy = (q: QB, ascending: boolean): QB => {
    let qq = q;
    if (orderCol) qq = qq.order(orderCol, { ascending });
    return qq.order("id", { ascending });
  };

  // 본인 전체 미읽음 수(뱃지) — 현재 페이지가 아니라 서버 count.
  let unreadCount: number | null = null;
  if (readCol) {
    const countBase = supabase.from(TABLE).select("id", { count: "exact", head: true }) as unknown as QB;
    let cq = countBase.eq(uCol, userId);
    cq = BOOL_READ_COLS.has(readCol) ? cq.not(readCol, "is", true) : cq.is(readCol, null);
    const { count, error: ce } = (await (cq as unknown as PromiseLike<QCountResult>)) as QCountResult;
    if (!ce) unreadCount = count ?? 0;
  }
  out.unreadCount = unreadCount;

  // ── 페이지 조회: pageSize+1 로 진행 방향의 추가 존재를 판정 ──
  // prev = cur 보다 최근(gt)을 오름차순으로 pageSize+1 → 표시 시 역순(DESC). next/first = cur 보다 과거(lt) 내림차순.
  const ascending = dir === "prev" && cur != null;
  let q = withScope(supabase.from(TABLE).select("*") as unknown as QB);
  if (cur) q = applyKeyset(q, orderCol, ascending ? "gt" : "lt", cur);
  q = orderBy(q, ascending).limit(pageSize + 1);

  const { data, error } = (await (q as unknown as PromiseLike<QPageResult>)) as QPageResult;
  if (error) {
    return { ...out, error: error.message, probe: `notifications · ${userColumn} · 페이지 조회 실패` };
  }

  let rawRows = (data as Row[]) ?? [];
  const hasExtra = rawRows.length > pageSize;
  if (hasExtra) rawRows = rawRows.slice(0, pageSize);
  const rows = ascending ? [...rawRows].reverse() : rawRows; // prev 는 DESC 표시로 되돌림

  const firstRow = rows[0];
  const lastRow = rows[rows.length - 1];
  const orderValueOf = (r: Row | undefined): string => (r && orderCol ? String(r[orderCol] ?? "") : "");
  const idOf = (r: Row | undefined): string => (r ? String(r.id ?? "") : "");

  // 진행 방향(fetch) 경계 = hasExtra. 반대 방향 = 커서로 도달했는가(=페이지1 아님).
  const hasNext = dir === "prev" ? true : hasExtra;
  const hasPrev = dir === "prev" ? hasExtra : cur != null;

  return {
    ...out,
    probe: `notifications · ${userColumn} · order ${orderCol ?? "id"} · keyset ${dir}`,
    rows,
    hasNext: rows.length > 0 ? hasNext : dir === "prev",
    hasPrev: rows.length > 0 ? hasPrev : false,
    nextCursor: lastRow ? encodeNotificationCursor(orderValueOf(lastRow), idOf(lastRow)) : null,
    prevCursor: firstRow ? encodeNotificationCursor(orderValueOf(firstRow), idOf(firstRow)) : null,
    unreadCount,
  };
}
