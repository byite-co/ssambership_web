import { redirect } from "next/navigation";
import { CommunityLayoutShell } from "@/components/community/CommunityLayoutShell";
import { CommunityShortformComposeForm } from "@/components/community/CommunityShortformComposeForm";
import { getServerUserWithProfile } from "@/lib/auth/getServerUserWithProfile";
import { legacyShortformTabRedirect } from "@/lib/community/communityComposeTab";
import { getShortformDraft } from "@/lib/community/communityShortformQueries";
import { createClient } from "@/lib/supabase/server";

type Props = { searchParams?: Promise<Record<string, string | string[] | undefined>> };

export default async function CommunityShortformNewPage(props: Props) {
  const { user, profile } = await getServerUserWithProfile();
  if (!user) redirect(`/login?next=${encodeURIComponent("/community/shortform/new")}`);
  if (profile?.role !== "mentor") redirect("/community/shortform?error=mentor_only");

  const sp = (await props.searchParams) ?? {};
  const spFlat: Record<string, string> = {};
  for (const [k, v] of Object.entries(sp)) {
    if (typeof v === "string") spFlat[k] = v;
  }

  const legacy = legacyShortformTabRedirect(spFlat);
  if (legacy) redirect(legacy);

  const errorCode = typeof sp.error === "string" ? sp.error : null;
  const draftSaved = sp.draft === "1";
  const draftId = typeof sp.draftId === "string" ? sp.draftId : null;

  let shortformDraft = null;
  if (draftId) {
    const supabase = await createClient();
    const { draft } = await getShortformDraft(supabase, user.id, draftId);
    shortformDraft = draft;
  }

  return (
    <CommunityLayoutShell activeNav="shortform">
      <CommunityShortformComposeForm
        errorCode={errorCode}
        draftSaved={draftSaved}
        draft={shortformDraft}
      />
    </CommunityLayoutShell>
  );
}
