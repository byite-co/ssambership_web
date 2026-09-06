import Link from "next/link";

// 앱(WebView) 복귀 안내 — 웹 PR-2 §6. bootstrap target(identity_verify · guardian_consent)이
// `?src=app` 을 붙여 열면 온보딩 두 화면이 이 안내를 보여준다(현행 A7 완료 브릿지 패턴의 문구 판).
// 딥링크 스킴은 앱 A-4c 가 보고하므로 이 PR 은 안내 문구까지만 — 링크·네비게이션은 두지 않는다.

export function AppReturnNotice(props: { variant: "pending" | "done"; title?: string }) {
  if (props.variant === "done") {
    return (
      <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6 text-center shadow-sm sm:p-8" role="status">
        <p className="text-lg font-extrabold text-emerald-900">{props.title ?? "인증이 완료됐어요"}</p>
        <p className="mt-2 text-sm leading-relaxed text-emerald-800">
          이 화면을 닫고 앱으로 돌아가 주세요. 앱에서 이어서 이용할 수 있어요.
        </p>
      </section>
    );
  }
  return (
    <p className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-xs leading-relaxed text-blue-900" role="status">
      앱에서 이어서 진행 중이에요. 인증이 끝나면 이 화면을 닫고 앱으로 돌아가 주세요.
      <span className="sr-only">
        <Link href="/">쌤버십 홈</Link>
      </span>
    </p>
  );
}
