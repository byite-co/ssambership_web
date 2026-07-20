import { redirect } from "next/navigation";
import {
  CommunityBoardComposeForm,
  type ExistingBoardImage,
} from "@/components/community/CommunityBoardComposeForm";
import { CommunityLayoutShell } from "@/components/community/CommunityLayoutShell";
import { getServerUserWithProfile } from "@/lib/auth/getServerUserWithProfile";
import {
  getCommunityBoardDraft,
  getCommunityBoardEditablePost,
  type CommunityBoardDraftRow,
} from "@/lib/community/communityBoardQueries";
import { resolveCommunityImageUrl } from "@/lib/community/communityImageStorage";
import { createClient } from "@/lib/supabase/server";

type Props = { searchParams?: Promise<Record<string, string | string[] | undefined>> };

/** 저장된 이미지 ref 배열을 (ref, 미리보기 URL) 쌍으로 변환(편집 화면의 기존 이미지 표시용). */
async function resolveExistingImages(
  supabase: Awaited<ReturnType<typeof createClient>>,
  refs: string[],
): Promise<ExistingBoardImage[]> {
  const pairs = await Promise.all(
    refs.map(async (ref) => {
      const url = await resolveCommunityImageUrl(supabase, ref);
      return url ? { ref, url } : null;
    }),
  );
  return pairs.filter((p): p is ExistingBoardImage => p != null);
}

export default async function CommunityNewPage(props: Props) {
  const { user } = await getServerUserWithProfile();
  if (!user) {
    redirect(`/login?next=${encodeURIComponent("/community/new")}`);
  }

  const sp = (await props.searchParams) ?? {};
  const errorCode = typeof sp.error === "string" ? sp.error : null;
  const draftSaved = sp.draft === "1";
  const draftId = typeof sp.draftId === "string" ? sp.draftId : null;
  const editId = typeof sp.editId === "string" ? sp.editId : null;

  let draft: CommunityBoardDraftRow | null = null;
  let existingImages: ExistingBoardImage[] = [];
  let editingPublished = false;

  if (user.id && (editId || draftId)) {
    const supabase = await createClient();
    if (editId) {
      // 발행/초안 구분 없이 소유 글을 편집 로드(수정 저장).
      const { draft: loaded, status } = await getCommunityBoardEditablePost(supabase, user.id, editId);
      draft = loaded;
      editingPublished = status === "published";
    } else if (draftId) {
      const { draft: loaded } = await getCommunityBoardDraft(supabase, user.id, draftId);
      draft = loaded;
    }
    if (draft?.imageUrls.length) {
      existingImages = await resolveExistingImages(supabase, draft.imageUrls);
    }
  }

  return (
    <CommunityLayoutShell activeNav="board">
      <CommunityBoardComposeForm
        errorCode={errorCode}
        draftSaved={draftSaved}
        draft={draft}
        existingImages={existingImages}
        editingPublished={editingPublished}
        returnPath="/community/new"
      />
    </CommunityLayoutShell>
  );
}
