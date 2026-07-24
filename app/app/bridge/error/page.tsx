import type { AppBridgeErrorCode } from "@/lib/appSession/appSurfacePaths";
import { isAppBridgeErrorCode } from "@/lib/appSession/appSurfacePaths";

// 앱 WebView 고정 오류 페이지 — code enum 별 한글 안내만 표시한다.
// 미지 code 는 invalid_request 문구로 폴백(입력값을 화면에 되비추지 않는다).
// 재시도·뒤로가기는 앱 네이티브 UI 담당. 링크·네비게이션 0.

export const metadata = {
  title: "요청을 처리하지 못했어요",
  robots: { index: false, follow: false },
};

const ERROR_MESSAGES: Record<AppBridgeErrorCode, string> = {
  session_expired: "로그인이 만료됐어요. 앱에서 다시 시도해 주세요.",
  mentor_only: "멘토 계정만 이용할 수 있는 기능이에요.",
  account_blocked: "계정 상태를 확인해 주세요.",
  bootstrap_failed: "연결에 실패했어요. 앱에서 다시 시도해 주세요.",
  invalid_request: "잘못된 요청이에요. 앱에서 다시 시도해 주세요.",
};

type Props = { searchParams?: Promise<Record<string, string | string[] | undefined>> };

export default async function AppBridgeErrorPage(props: Props) {
  const sp = (await props.searchParams) ?? {};
  const raw = typeof sp.code === "string" ? sp.code : "";
  const code: AppBridgeErrorCode = isAppBridgeErrorCode(raw) ? raw : "invalid_request";

  return (
    <main className="flex min-h-[100dvh] items-center justify-center bg-[#F9FAFB] px-6">
      <div className="text-center">
        <p className="text-lg font-extrabold text-slate-900">요청을 처리하지 못했어요</p>
        <p className="mt-2 text-sm text-slate-600">{ERROR_MESSAGES[code]}</p>
      </div>
    </main>
  );
}
