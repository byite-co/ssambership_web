import { PageScaffold } from "@/components/shell/PageScaffold";
import { StudentSupportTabs } from "@/components/support/StudentSupportTabs";
import { StudentDisputesFilterableList } from "@/components/disputes/StudentDisputesFilterableList";
import { requireRole } from "@/lib/auth/routeGuard";
import { createClient } from "@/lib/supabase/server";
import { loadDisputesListForUser } from "@/lib/disputes/disputeListQueries";

export default async function StudentDisputesListPage() {
  const { user } = await requireRole("student");
  const supabase = await createClient();
  const { table, items, error, usedColumn, probe } = await loadDisputesListForUser(supabase, user.id, "student", 40);

  return (
    <PageScaffold
      hideFooterPlaceholderCards
      eyebrow="지원 · 분쟁"
      title="분쟁·환불 현황"
      description={
        <>
          <span className="md:hidden">분쟁·처리 상태를 확인하세요.</span>
          <span className="hidden md:inline">맞춤의뢰 진행 중 접수한 분쟁과 처리 상태를 확인할 수 있습니다.</span>
        </>
      }
    >
      <StudentSupportTabs active="disputes" />
      <StudentDisputesFilterableList
        items={items}
        detailHrefBase="/support/disputes"
        listError={error}
        usedColumn={usedColumn}
        table={table}
        probe={probe}
      />
    </PageScaffold>
  );
}
