import { redirect } from "next/navigation";
import { CommunityBoardComposeForm } from "@/components/community/CommunityBoardComposeForm";
import { CommunityLayoutShell } from "@/components/community/CommunityLayoutShell";
import { getServerUserWithProfile } from "@/lib/auth/getServerUserWithProfile";
import { getCommunityBoardPostForEdit } from "@/lib/community/communityBoardQueries";
import { createClient } from "@/lib/supabase/server";

type Props = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

// 작성자 전용 게시글 편집. 본인 글(발행/임시, 미삭제)만 로드하며, 저장은 update 경로가
// 소유권(author_id)과 삭제 여부(deleted_at)를 서버에서 재검사한다.
export default async function CommunityBoardEditPage(props: Props) {
  const { id } = await props.params;
  const { user } = await getServerUserWithProfile();
  if (!user) {
    redirect(`/login?next=${encodeURIComponent(`/community/board/${id}/edit`)}`);
  }

  const supabase = await createClient();
  const { draft } = await getCommunityBoardPostForEdit(supabase, user.id, id);
  if (!draft) {
    // 비존재·비소유·삭제됨 → 상세로 되돌림(소유권 없는 편집 화면 노출 안 함).
    redirect(`/community/board/${id}`);
  }

  const sp = (await props.searchParams) ?? {};
  const errorCode = typeof sp.error === "string" ? sp.error : null;

  return (
    <CommunityLayoutShell activeNav="board">
      <CommunityBoardComposeForm
        userId={user.id}
        errorCode={errorCode}
        draftSaved={false}
        draft={draft}
        returnPath={`/community/board/${id}/edit`}
      />
    </CommunityLayoutShell>
  );
}
