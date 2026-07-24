import { notFound } from "next/navigation";
import { isAppBridgeKind, isAppBridgeResult } from "@/lib/appSession/appSurfacePaths";

// 앱 WebView 완료 브릿지 — 앱이 이 URL 로의 탐색을 intercept 해 WebView 를 닫는다.
// kind/result 는 서버 enum 으로 제한한다(임의 값은 404). 링크·네비게이션 0 인 고정 페이지.

export const metadata = {
  title: "완료",
  robots: { index: false, follow: false },
};

type Props = { searchParams?: Promise<Record<string, string | string[] | undefined>> };

export default async function AppBridgeCompletePage(props: Props) {
  const sp = (await props.searchParams) ?? {};
  const kind = typeof sp.kind === "string" ? sp.kind : "";
  const result = typeof sp.result === "string" ? sp.result : "";
  if (!isAppBridgeKind(kind) || !isAppBridgeResult(result)) notFound();

  const message = result === "draft" ? "임시저장됐어요." : "게시가 완료됐어요.";

  return (
    <main className="flex min-h-[100dvh] items-center justify-center bg-[#F9FAFB] px-6">
      <div className="text-center">
        <p className="text-lg font-extrabold text-slate-900">{message}</p>
        <p className="mt-2 text-sm text-slate-500">앱으로 돌아가는 중이에요…</p>
      </div>
    </main>
  );
}
