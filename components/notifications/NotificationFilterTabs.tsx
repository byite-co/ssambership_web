import Link from "next/link";
import { notificationsHref, type NotificationCategory } from "@/lib/notifications/notificationCategories";

type Filter = "all" | "unread";

const STY = {
  active: "bg-slate-900 text-white border-slate-900",
  idle: "bg-white text-slate-700 border-slate-200 hover:border-slate-300",
} as const;

/**
 * /notifications?filter=all|unread — 현재 카테고리를 보존(필터 변경 시 cursor 초기화).
 */
export function NotificationFilterTabs(props: { current: Filter; category: NotificationCategory }) {
  const { current, category } = props;
  return (
    <div className="flex flex-wrap gap-2" role="tablist" aria-label="알림 필터">
      <FilterLink
        href={notificationsHref({ filter: "all", category })}
        label="전체"
        active={current === "all"}
        id="notif-filter-all"
      />
      <FilterLink
        href={notificationsHref({ filter: "unread", category })}
        label="읽지 않음"
        active={current === "unread"}
        id="notif-filter-unread"
      />
    </div>
  );
}

function FilterLink({ href, label, active, id }: { href: string; label: string; active: boolean; id: string }) {
  return (
    <Link
      href={href}
      className={`rounded-lg border px-3 py-1.5 text-xs font-extrabold ${active ? STY.active : STY.idle}`}
      aria-selected={active}
      role="tab"
      id={id}
    >
      {label}
    </Link>
  );
}
