"use client";

/**
 * 대시보드 "최근 활동" 의 `☐ 열람 기록 제외` 체크박스(PR-12 §1-2) — 기본 켜짐. 상호작용(토글 → URL 갱신)만 담당하는 클라이언트 부품.
 * 체크를 풀면 `?showViews=1`(열람 기록 포함)로, 켜면 기본 경로로 이동한다. 상태는 URL 하나뿐이라 새로고침·공유에도 같다.
 */
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { ADMIN_DASHBOARD_HIDE_VIEWS_LABEL, buildAdminDashboardUrl } from "@/lib/admin/adminDashboardConsole";

type Props = { showViews: boolean };

export function AdminDashboardActivityToggle({ showViews }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <label className="flex items-center gap-1.5 text-xs font-bold text-slate-700" data-dashboard-hide-views>
      <input
        type="checkbox"
        checked={!showViews}
        disabled={pending}
        onChange={(e) => {
          const hide = e.target.checked;
          startTransition(() => router.replace(buildAdminDashboardUrl(!hide)));
        }}
        aria-label={ADMIN_DASHBOARD_HIDE_VIEWS_LABEL}
      />
      {ADMIN_DASHBOARD_HIDE_VIEWS_LABEL}
    </label>
  );
}
