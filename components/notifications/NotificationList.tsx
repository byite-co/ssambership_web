import Link from "next/link";
import type { AppRole } from "@/lib/types/user";
import { NotificationItemCard } from "@/components/notifications/NotificationItemCard";
import { NotificationEmptyState } from "@/components/notifications/NotificationEmptyState";
import type { NotificationHubLoad } from "@/lib/notifications/notificationsHubQueries";
import { notificationsHref, type NotificationCategory } from "@/lib/notifications/notificationCategories";

type Row = Record<string, unknown>;
type Filter = "all" | "unread";

// P2-26: 서버 키셋 페이지네이션. 클라이언트 상태 없이 URL(searchParam) 로만 페이지를 이동한다
// → 브라우저 뒤로/앞으로가 각 페이지 URL(filter·category·cursor) 을 그대로 복원한다.
export function NotificationList(props: {
  hub: NotificationHubLoad;
  filter: Filter;
  category: NotificationCategory;
  role: AppRole;
}) {
  const { hub, filter, category, role } = props;

  const resetHref = notificationsHref({ filter, category });
  const prevHref =
    hub.hasPrev && hub.prevCursor
      ? notificationsHref({ filter, category, dir: "prev", cursor: hub.prevCursor })
      : null;
  const nextHref =
    hub.hasNext && hub.nextCursor
      ? notificationsHref({ filter, category, dir: "next", cursor: hub.nextCursor })
      : null;

  // 로드 실패/빈 상태 — 카드 구조 이전에 처리.
  if (hub.unreadFilterBlocked) {
    return <NotificationEmptyState filter={filter} hadTableError={false} unreadFilterBlocked />;
  }
  if (hub.error && hub.rows.length === 0) {
    return (
      <div className="space-y-3">
        <NotificationEmptyState filter={filter} hadTableError={true} />
        <div className="text-center">
          <Link
            href={resetHref}
            className="inline-block rounded-lg border border-slate-200 px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"
          >
            다시 시도
          </Link>
        </div>
      </div>
    );
  }
  if (hub.rows.length === 0) {
    return (
      <div className="space-y-3">
        <NotificationEmptyState filter={filter} hadTableError={false} />
        {hub.hasPrev || hub.hasNext ? (
          <div className="text-center">
            <Link
              href={resetHref}
              className="inline-block rounded-lg border border-slate-200 px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"
            >
              처음으로
            </Link>
          </div>
        ) : null}
      </div>
    );
  }

  const pagerButtonBase =
    "rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold transition";

  return (
    <div className="space-y-3">
      <ul className="space-y-2">
        {hub.rows.map((r, i) => (
          <li key={String((r as Row).id ?? `notif-${i}`)}>
            <NotificationItemCard row={r as Row} hub={hub} role={role} />
          </li>
        ))}
      </ul>

      {hub.hasPrev || hub.hasNext ? (
        <nav className="flex items-center justify-center gap-2" aria-label="알림 페이지 이동">
          {prevHref ? (
            <Link href={prevHref} className={`${pagerButtonBase} text-slate-700 hover:bg-slate-50`} rel="prev">
              이전
            </Link>
          ) : (
            <span className={`${pagerButtonBase} text-slate-300`} aria-disabled>
              이전
            </span>
          )}
          {nextHref ? (
            <Link href={nextHref} className={`${pagerButtonBase} text-slate-700 hover:bg-slate-50`} rel="next">
              다음
            </Link>
          ) : (
            <span className={`${pagerButtonBase} text-slate-300`} aria-disabled>
              다음
            </span>
          )}
        </nav>
      ) : null}
    </div>
  );
}
