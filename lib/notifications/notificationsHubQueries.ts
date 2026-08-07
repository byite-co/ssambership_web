import type { SupabaseClient } from "@supabase/supabase-js";
import {
  notificationCategoryTypeList,
  type NotificationCategory,
} from "@/lib/notifications/notificationCategories";
import {
  BOOL_READ_COLS,
  decodeNotificationCursor,
  encodeNotificationCursor,
  isNotificationReadRow,
  type NotificationCursor,
} from "@/lib/notifications/notificationCursor";

// 커서·읽음판정 순수 로직은 notificationCursor.ts 로 이동해 계약 테스트로 회귀 방지. 여기서 re-export.
export { BOOL_READ_COLS, decodeNotificationCursor, encodeNotificationCursor, isNotificationReadRow };
export type { NotificationCursor };

type Row = Record<string, unknown>;

// supabase-js 빌더의 깊은 재귀 제네릭(TS2589 회피)을 피하기 위한 최소 인터페이스.
type QB = {
  eq: (c: string, v: unknown) => QB;
  is: (c: string, v: unknown) => QB;
  not: (c: string, o: string, v: unknown) => QB;
  in: (c: string, v: readonly unknown[]) => QB;
  or: (f: string) => QB;
  order: (c: string, o: { ascending: boolean }) => QB;
  limit: (n: number) => QB;
};
type QPageResult = { data: Row[] | null; error: { message: string } | null };

const TABLE = "notifications";

// W4(C10): 컬럼 후보 프로빙(수신자 FK 6종·읽음 7종·유형 7종·정렬 4종 순회) 제거 —
// 정본 고정: 수신자 user_id(132 정본 writer 가 set) · 읽음 is_read+read_at(133 정본 술어
// `is_read is distinct from true`) · 유형 type · 정렬 created_at (187 baseline 실측).
const USER_COLUMN = "user_id";
const READ_COLUMN = "is_read";
const TYPE_COLUMN = "type";
// 키셋 정렬 기준. 동률은 항상 id(uuid, 유니크)로 안정화한다.
const ORDER_COLUMN = "created_at";
// BOOL_READ_COLS 는 notificationCursor.ts 에서 import(위 re-export).

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

// NotificationCursor 는 notificationCursor.ts 에서 import(위 re-export).
export type NotificationPageDir = "next" | "prev";

export type NotificationHubLoad = {
  error: string | null;
  probe: string;
  /** W4(C10): 정본 고정값(user_id/is_read/type/created_at) — 뷰 호환용으로 유지 */
  userColumn: string | null;
  readColumn: string | null;
  typeColumn: string | null;
  orderColumn: string | null;
  rows: Row[];
  /** W4(C10): 읽음 컬럼이 is_read 로 고정되어 항상 false(뷰 호환용 유지) */
  unreadFilterBlocked: boolean;
  // ── P2-26 키셋 페이지네이션 ──
  pageSize: number;
  hasNext: boolean;
  hasPrev: boolean;
  /** 다음(더 오래된) 페이지 이동용 커서 = 현재 페이지 마지막 행 */
  nextCursor: string | null;
  /** 이전(더 최근) 페이지 이동용 커서 = 현재 페이지 첫 행 */
  prevCursor: string | null;
  /** 본인 전체 미읽음 수(현재 페이지가 아니라 서버 count). count 조회 실패 시 null(0건과 구분) */
  unreadCount: number | null;
};

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

// (orderCol, id) 키셋 조건. op = 'lt'(더 오래된) | 'gt'(더 최근). W4(C10): 정렬 컬럼 고정으로 id 단독 폴백 제거.
function applyKeyset(q: QB, orderCol: string, op: "lt" | "gt", cur: NotificationCursor): QB {
  // 타임스탬프 값은 예약문자(:,+,.)를 담으므로 큰따옴표로 감싼다.
  return q.or(`${orderCol}.${op}."${cur.orderValue}",and(${orderCol}.eq."${cur.orderValue}",id.${op}.${cur.id})`);
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
    category?: NotificationCategory;
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
  // W4(C10): 테이블 probe·컬럼 프로빙 제거 — notifications(user_id, is_read, read_at, type,
  // created_at) 187 baseline 실측. 고정 컬럼을 뷰 호환 필드로 그대로 노출한다.
  out.userColumn = USER_COLUMN;
  out.readColumn = READ_COLUMN;
  out.typeColumn = TYPE_COLUMN;
  out.orderColumn = ORDER_COLUMN;

  // 카테고리 → event type allowlist(서버 필터).
  const categoryTypes = notificationCategoryTypeList(options.category ?? "all");
  // 스코프(수신자 → 읽음 여부 → 카테고리 event type 집합) 적용기 — cursor 이전 단계.
  const withScope = (q: QB): QB => {
    let qq = q.eq(USER_COLUMN, userId);
    if (options.filter === "unread") {
      // 정본 미읽음 술어(133): is_read is distinct from true
      qq = qq.not(READ_COLUMN, "is", true);
    }
    if (categoryTypes) {
      qq = qq.in(TYPE_COLUMN, categoryTypes);
    }
    return qq;
  };
  const orderBy = (q: QB, ascending: boolean): QB =>
    q.order(ORDER_COLUMN, { ascending }).order("id", { ascending });

  // 본인 전체 미읽음 수(뱃지) — 현재 페이지가 아니라 서버 count.
  // D-MT-10: 앱 쿼리(notifications head count) 대신 DB 정본 RPC(notification_unread_count_self)로
  // 통일한다. 뱃지 카운트 정본이 DB 함수와 앱 쿼리 두 벌로 갈리던 문제를 없앤다(앱 게이팅 타입
  // 제외 규칙도 RPC 가 서버에서 강제). 실패/계약 불일치는 unreadCount=null(0건과 구분) + 로그.
  let unreadCount: number | null = null;
  {
    const { data, error: ce } = await supabase.rpc("notification_unread_count_self");
    if (ce) {
      console.error("[loadNotificationsHub] notification_unread_count_self", ce.message);
    } else {
      const env = (data ?? {}) as { ok?: unknown; count?: unknown };
      const parsed = typeof env.count === "number" ? env.count : Number(env.count);
      if (env.ok === true && Number.isFinite(parsed)) {
        unreadCount = parsed;
      } else {
        console.error("[loadNotificationsHub] notification_unread_count_self contract_mismatch");
      }
    }
  }
  out.unreadCount = unreadCount;

  // ── 페이지 조회: pageSize+1 로 진행 방향의 추가 존재를 판정 ──
  // prev = cur 보다 최근(gt)을 오름차순으로 pageSize+1 → 표시 시 역순(DESC). next/first = cur 보다 과거(lt) 내림차순.
  const ascending = dir === "prev" && cur != null;
  let q = withScope(supabase.from(TABLE).select("*") as unknown as QB);
  if (cur) q = applyKeyset(q, ORDER_COLUMN, ascending ? "gt" : "lt", cur);
  q = orderBy(q, ascending).limit(pageSize + 1);

  const { data, error } = (await (q as unknown as PromiseLike<QPageResult>)) as QPageResult;
  if (error) {
    return { ...out, error: error.message, probe: `notifications · ${USER_COLUMN} · 페이지 조회 실패` };
  }

  let rawRows = (data as Row[]) ?? [];
  const hasExtra = rawRows.length > pageSize;
  if (hasExtra) rawRows = rawRows.slice(0, pageSize);
  const rows = ascending ? [...rawRows].reverse() : rawRows; // prev 는 DESC 표시로 되돌림

  const firstRow = rows[0];
  const lastRow = rows[rows.length - 1];
  const orderValueOf = (r: Row | undefined): string => (r ? String(r[ORDER_COLUMN] ?? "") : "");
  const idOf = (r: Row | undefined): string => (r ? String(r.id ?? "") : "");

  // 진행 방향(fetch) 경계 = hasExtra. 반대 방향 = 커서로 도달했는가(=페이지1 아님).
  const hasNext = dir === "prev" ? true : hasExtra;
  const hasPrev = dir === "prev" ? hasExtra : cur != null;

  return {
    ...out,
    probe: `notifications · ${USER_COLUMN} · order ${ORDER_COLUMN} · keyset ${dir}`,
    rows,
    hasNext: rows.length > 0 ? hasNext : dir === "prev",
    hasPrev: rows.length > 0 ? hasPrev : false,
    nextCursor: lastRow ? encodeNotificationCursor(orderValueOf(lastRow), idOf(lastRow)) : null,
    prevCursor: firstRow ? encodeNotificationCursor(orderValueOf(firstRow), idOf(firstRow)) : null,
    unreadCount,
  };
}
