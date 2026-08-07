import { redirect } from "next/navigation";
import { PageScaffold } from "@/components/shell/PageScaffold";
import { NotificationsHubView } from "@/components/notifications/NotificationsHubView";
import { getServerUserWithProfile } from "@/lib/auth/getServerUserWithProfile";
import { createClient } from "@/lib/supabase/server";
import { decodeNotificationCursor, loadNotificationsHub } from "@/lib/notifications/notificationsHubQueries";
import { parseNotificationCategory } from "@/lib/notifications/notificationCategories";
import type { AppRole } from "@/lib/types/user";

type Props = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function firstParam(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export default async function NotificationsPage(props: Props) {
  const { user, profile, error: authErr } = await getServerUserWithProfile();
  if (!user) {
    redirect(`/login?next=${encodeURIComponent("/notifications")}`);
  }

  const sp = (await props.searchParams) ?? {};
  const f = firstParam(sp.filter) === "unread" ? "unread" : "all";
  const category = parseNotificationCategory(firstParam(sp.category));
  const dir = firstParam(sp.dir) === "prev" ? "prev" : "next";
  const cursor = decodeNotificationCursor(firstParam(sp.cursor));

  const supabase = await createClient();
  const hub = await loadNotificationsHub(supabase, user.id, { filter: f, category, cursor, dir });
  if (hub.error) {
    console.error("[notifications] hub load", hub.error);
  }

  const role: AppRole = (profile?.role as AppRole) ?? "student";
  if (authErr && !profile) {
    /* 프로필 없이도 알림 id가 일치하면 목록이 표시될 수 있음 */
  }

  // D-MT-11: '모두 읽음' RPC 실패 시 액션이 ?error=mark_all_failed 로 리다이렉트한다.
  const actionError = firstParam(sp.error) === "mark_all_failed";

  return (
    <PageScaffold
      hideFooterPlaceholderCards
      eyebrow="알림"
      title="알림"
      description="받은 알림을 확인하고, 관련 화면으로 이동할 수 있습니다."
    >
      <NotificationsHubView hub={hub} filter={f} category={category} role={role} actionError={actionError} />
    </PageScaffold>
  );
}
