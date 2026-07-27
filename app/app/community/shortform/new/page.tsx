import { redirect } from "next/navigation";
import { CommunityShortformComposeForm } from "@/components/community/CommunityShortformComposeForm";
import { assertAppSurfaceAccountActiveStrict } from "@/lib/appSession/appSurfaceAccountGate";
import { getUserProfileById } from "@/lib/auth/getCurrentProfile";
import { appBridgeErrorPath } from "@/lib/appSession/appSurfacePaths";
import { getShortformDraft } from "@/lib/community/communityShortformQueries";
import { createAppSurfaceClient } from "@/lib/supabase/appSurfaceServer";

// 앱(모바일) WebView 전용 숏폼 작성 표면.
// - `app/` 최상위(라우트 그룹 밖) 배치 → 전역 셸(헤더/네비/푸터)이 전혀 렌더되지 않는다.
// - 세션은 POST /api/app-session/bootstrap 이 심은 쿠키로 성립한다(로그인 화면 유도 없음).
// - 세션 검증·draft 조회는 앱 표면 전용 클라이언트(appSurfaceServer)로 수행한다 —
//   쿠키 재발급이 발생해도 HttpOnly/Secure/SameSite=Lax 속성이 유지된다.
// - 실패는 전부 고정 브릿지 오류 페이지(enum code)로 보낸다.

export const metadata = {
  title: "숏폼 작성",
  robots: { index: false, follow: false },
};

type Props = { searchParams?: Promise<Record<string, string | string[] | undefined>> };

export default async function AppShortformComposePage(props: Props) {
  const supabase = await createAppSurfaceClient();
  const { data: authData, error: authError } = await supabase.auth.getUser();
  const user = authData?.user ?? null;
  if (authError || !user) redirect(appBridgeErrorPath("session_expired"));

  // 앱 표면 계정 게이트(strict·fail-closed) — 확인 불가·정지·삭제 write-block 전부 차단.
  const acctGate = await assertAppSurfaceAccountActiveStrict(supabase, user.id);
  if (!acctGate.ok) redirect(appBridgeErrorPath("account_blocked"));
  // 서버 최종 검증: 활성 mentor role 만(웹 표면과 동일 계약 — 별도 승인조건 추가 없음).
  const { data: profile } = await getUserProfileById(supabase, user.id);
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
