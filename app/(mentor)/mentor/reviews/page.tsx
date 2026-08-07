import { MentorReviewsManage } from "@/components/mentor/MentorReviewsManage";
import { requireRole } from "@/lib/auth/routeGuard";
import { listMentorReceivedReviews } from "@/lib/reviews/reviewQueries";
import { createClient } from "@/lib/supabase/server";

export default async function MentorReviewsPage() {
  const { user } = await requireRole("mentor");
  const supabase = await createClient();
  const { items, error } = await listMentorReceivedReviews(supabase, user.id, 50);
  // D-MT-6: 조회 실패(error≠null)를 '후기 0건'과 구분해 초기 오류로 전달한다.
  return <MentorReviewsManage initialItems={items} loadFailed={error != null} />;
}
