import Link from "next/link";

/**
 * W-06: 학생 지원 허브 탭 — 분쟁·환불·신고 3개 라우트를 하나의 허브로 묶는다.
 * `/support` 자체는 (public) 고객센터 페이지가 점유하므로(동일 URL 병렬 page 충돌),
 * 별도 허브 페이지 대신 세 라우트가 이 탭 바를 공유한다. URL 전부 보존.
 */
const TABS = [
  { key: "disputes", href: "/support/disputes", label: "분쟁" },
  { key: "refunds", href: "/support/refunds", label: "환불" },
  { key: "reports", href: "/support/reports", label: "신고 내역" },
] as const;

export type StudentSupportTabKey = (typeof TABS)[number]["key"];

export function StudentSupportTabs({ active }: { active: StudentSupportTabKey }) {
  return (
    <nav aria-label="지원 메뉴" className="mb-5 flex gap-2 border-b border-slate-200">
      {TABS.map((tab) => {
        const isActive = tab.key === active;
        return (
          <Link
            key={tab.key}
            href={tab.href}
            aria-current={isActive ? "page" : undefined}
            className={
              isActive
                ? "-mb-px rounded-t-lg border-b-2 border-[#1A56DB] px-4 py-2.5 text-sm font-extrabold text-[#1A56DB]"
                : "-mb-px rounded-t-lg border-b-2 border-transparent px-4 py-2.5 text-sm font-semibold text-slate-500 hover:text-slate-800"
            }
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
