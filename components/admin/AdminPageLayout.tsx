/**
 * 관리자 전용 페이지 틀 — `PageScaffold`(서비스 화면 공용) 대체.
 *
 * 관리자 화면 14곳이 `PageScaffold` 에 넘기던 props 중 실데이터를 담는 것은
 * title · description · 우상단 액션 · children 뿐이다(분석 §2-1). 그래서 이 컴포넌트는 그 넷만 받고
 * "준비 중"·"로딩"·"오류"·"참고" 안내 카드(`sections`·`emptyState`·`loadingState`·`errorState`·`dataPoints`)를
 * 렌더하는 경로를 아예 두지 않는다. 로딩·오류·빈 상태는 본문(children) 쪽 컴포넌트의 책임이다.
 *
 * 사이드바·앱바는 `AdminConsoleShell` 이 그린다 — 이 컴포넌트는 `<main>` 안의 페이지 본문 영역만 담당한다.
 * Server Component. (PR-1: 신설만 — 아직 어떤 화면도 쓰지 않는다.)
 */
import type { ReactNode } from "react";

export type AdminPageLayoutProps = {
  /** 화면 제목(h1) */
  title: string;
  /** 한 줄 설명 */
  description?: ReactNode;
  /** 우상단 액션 슬롯 — 링크·버튼을 그대로 넘긴다 */
  actions?: ReactNode;
  /** 본문 */
  children: ReactNode;
};

export function AdminPageLayout({ title, description, actions, children }: AdminPageLayoutProps) {
  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 border-b border-slate-200 pb-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-black tracking-tight text-slate-900">{title}</h1>
          {description ? <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-600">{description}</p> : null}
        </div>
        {actions ? (
          <div className="flex flex-wrap items-center gap-2 sm:shrink-0 sm:justify-end" aria-label="페이지 액션">
            {actions}
          </div>
        ) : null}
      </header>
      {children}
    </div>
  );
}
