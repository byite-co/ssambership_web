import { redirect } from "next/navigation";
import { getServerAuthUser } from "@/lib/auth/getCurrentUser";
import { getMyNotificationSettings } from "@/lib/notifications/notificationSettingsActions";
import { NotificationSettingsPanel } from "@/components/notifications/NotificationSettingsPanel";

// P2-17 알림 설정 화면. 본인 설정(RLS)만 조회·수정. worker(152)가 이 설정을 강제한다.
export default async function NotificationSettingsPage() {
  const { user } = await getServerAuthUser();
  if (!user) {
    redirect(`/login?next=${encodeURIComponent("/settings/notifications")}`);
  }
  const initial = await getMyNotificationSettings();

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-8">
      <h1 className="mb-6 text-xl font-black tracking-tight text-slate-900">알림 설정</h1>
      <NotificationSettingsPanel initial={initial} />
    </main>
  );
}
