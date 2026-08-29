import { MentorPayoutsPage } from "@/components/mentor/payouts/MentorPayoutsPage";
import { MentorSettlementLoadError } from "@/components/mentor/payouts/MentorSettlementLoadError";
import { requireRole } from "@/lib/auth/routeGuard";
import { loadMentorSettlementPageData } from "@/lib/mentor/mentorSettlementService";
import { createClient } from "@/lib/supabase/server";

export default async function MentorPayoutsRoutePage() {
  const { user } = await requireRole("mentor");
  const supabase = await createClient();
  const result = await loadMentorSettlementPageData(supabase, user.id);

  // fail-closed: RPC 오류·스키마 위반이면 0 대신 오류 화면 + 재시도
  if (!result.ok) return <MentorSettlementLoadError />;

  return <MentorPayoutsPage data={result.data} />;
}
