import { redirect } from "next/navigation";
import { CommunityShortformComposeForm } from "@/components/community/CommunityShortformComposeForm";
import { getServerUserWithProfile } from "@/lib/auth/getServerUserWithProfile";
import { assertAccountActive } from "@/lib/auth/accountStatus";
import { appBridgeErrorPath } from "@/lib/appSession/appSurfacePaths";
import { getShortformDraft } from "@/lib/community/communityShortformQueries";
import { createClient } from "@/lib/supabase/server";

// 앱(모바일) WebView 전용 숏폼 작성 표면.
// - `app/` 최상위(라우트 그룹 밖) 배치 → 전역 셸(헤더/네비/푸터)이 전혀 렌더되지 않는다.
// - 세션은 POST /api/app-session/bootstrap 이 심은 쿠키로 성립한다(로그인 화면 유도 없음).
// - 실패는 전부 고정 브릿지 오류 페이지(enum code)로 보낸다.

export const metadata = {
  title: "숏폼 작성",
  robots: { index: false, follow: false },
};

type Props = { searchParams?: Promise<Record<string, string | string[] | undefined>> };

export default async function AppShortformComposePage(props: Props) {
  const { user, profile } = await getServerUserWithProfile();
  if (!user) redirect(appBridgeErrorPath("session_expired"));

  const supabase = await createClient();
  const acctGate = await assertAccountActive(supabase, user.id);
  if (!acctGate.ok) redirect(appBridgeErrorPath("account_blocked"));
  // 서버 최종 검증: 활성 mentor role 만(웹 표면과 동일 계약 — 별도 승인조건 추가 없음).
  if (profile?.role !== "mentor") redirect(appBridgeErrorPath("mentor_only"));

  const sp = (await props.searchParams) ?? {};
  const errorCode = typeof sp.error === "string" ? sp.error : null;
  const draftSaved = sp.draft === "1";
  const draftId = typeof sp.draftId === "string" ? sp.draftId : null;

  let shortformDraft = null;
  if (draftId) {
    const { draft } = await getShortformDraft(supabase, user.id, draftId);
    shortformDraft = draft;
  }

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-5">
      <CommunityShortformComposeForm
        surface="app"
        errorCode={errorCode}
        draftSaved={draftSaved}
        draft={shortformDraft}
      />
    </main>
  );
}
