import type { AppRole } from "@/lib/types/user";
import { markNotificationReadFormAction } from "@/lib/notifications/notificationReadActions";
import { resolveNotificationHref } from "@/lib/notifications/notificationDeepLink";
import { NotificationCardLink } from "@/components/notifications/NotificationCardLink";
import {
  formatNotificationTime,
  notificationTimeIso,
  notificationTitleLine,
  typeRaw,
} from "@/lib/notifications/notificationRowDisplay";
import { isNotificationReadRow, type NotificationHubLoad } from "@/lib/notifications/notificationsHubQueries";
import {
  notificationTypeMeta,
  notificationToneChipClass,
  notificationToneBadgeClass,
} from "@/components/notifications/notificationTypeIcon";

type Row = Record<string, unknown>;

export function NotificationItemCard(props: {
  row: Row;
  hub: Pick<NotificationHubLoad, "readColumn" | "typeColumn">;
  role: AppRole;
}) {
  const { row, hub, role } = props;
  const read = isNotificationReadRow(row, hub.readColumn);
  const typeK = typeRaw(row, hub.typeColumn);
  const meta = notificationTypeMeta(typeK);
  const Icon = meta.Icon;
  const href = resolveNotificationHref(row, role, typeK);
  const tiso = notificationTimeIso(row);
  const title = notificationTitleLine(row);

  return (
    <article
      className={`relative flex gap-3 rounded-xl border px-3.5 py-3 transition ${
        read
          ? "border-slate-200 bg-slate-50/50"
          : "border-blue-200/80 bg-white shadow-sm"
      }`}
    >
      {/* 종류별 아이콘 칩 */}
      <span
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${notificationToneChipClass(meta.tone)} ${
          read ? "opacity-60" : ""
        }`}
        aria-hidden
      >
        <Icon className="h-[18px] w-[18px]" strokeWidth={1.9} />
      </span>

      <NotificationCardLink
        href={href}
        notificationId={String(row.id ?? "")}
        unread={!read}
        className="block min-w-0 flex-1"
      >
        <div className="flex items-center gap-2">
          <span
            className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${notificationToneBadgeClass(meta.tone)} ${
              read ? "opacity-70" : ""
            }`}
          >
            {meta.label}
          </span>
          {!read ? <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#2563EB]" aria-label="안 읽음" /> : null}
          <span className="ml-auto shrink-0 text-[11px] text-slate-400">{formatNotificationTime(tiso)}</span>
        </div>
        <p
          className={`mt-1 line-clamp-2 text-[13px] leading-relaxed ${
            read ? "font-medium text-slate-500" : "font-bold text-slate-900"
          }`}
        >
          {title}
        </p>
      </NotificationCardLink>

      {/* 읽음 처리 (안 읽은 항목만) */}
      {hub.readColumn && !read ? (
        <form action={markNotificationReadFormAction} className="shrink-0 self-start">
          <input type="hidden" name="notificationId" value={String(row.id ?? "")} />
          <button
            type="submit"
            className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-[10px] font-bold text-slate-500 transition hover:bg-slate-50 hover:text-slate-700"
            title="본인 알림만 읽음 처리"
          >
            읽음
          </button>
        </form>
      ) : null}
    </article>
  );
}
