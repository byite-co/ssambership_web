import { redirect } from "next/navigation";
import { CommunityBoardComposeForm } from "@/components/community/CommunityBoardComposeForm";
import { CommunityLayoutShell } from "@/components/community/CommunityLayoutShell";
import { getServerUserWithProfile } from "@/lib/auth/getServerUserWithProfile";
import { getCommunityBoardDraft } from "@/lib/community/communityBoardQueries";
import { createClient } from "@/lib/supabase/server";

type Props = { searchParams?: Promise<Record<string, string | string[] | undefined>> };

export default async function CommunityNewPage(props: Props) {
  const { user } = await getServerUserWithProfile();
  if (!user) {
    redirect(`/login?next=${encodeURIComponent("/community/new")}`);
  }

  const sp = (await props.searchParams) ?? {};
  const errorCode = typeof sp.error === "string" ? sp.error : null;
  const draftSaved = sp.draft === "1";
  const draftId = typeof sp.draftId === "string" ? sp.draftId : null;

  let draft = null;
  if (draftId && user.id) {
    const supabase = await createClient();
    const { draft: loaded } = await getCommunityBoardDraft(supabase, user.id, draftId);
    draft = loaded;
  }

  return (
    <CommunityLayoutShell activeNav="board">
      <CommunityBoardComposeForm
        userId={user.id}
        errorCode={errorCode}
        draftSaved={draftSaved}
        draft={draft}
        returnPath="/community/new"
      />
    </CommunityLayoutShell>
  );
}
