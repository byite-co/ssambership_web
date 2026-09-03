/**
 * 대시보드 "오늘 할 일" 8칸(PR-12 §1-2) — 각 칸은 그 화면(탭)으로 가는 링크. Server Component.
 * 0 은 정상 상태: 숫자만 회색이고 `없음` 이라고 쓰지 않는다. 1 이상은 굵게 + 주의색 테두리.
 * 4열 고정(md 이상)이라 1280·1440 모두 2줄이다.
 */
import Link from "next/link";
import { ADMIN_DASHBOARD_TITLES, adminTodoCardClass, adminTodoCountClass, type AdminTodoCard } from "@/lib/admin/adminDashboardConsole";
import { cn } from "@/lib/utils/cn";

type Props = { cards: AdminTodoCard[] };

export function AdminDashboardTodoGrid({ cards }: Props) {
  return (
    <section aria-labelledby="admin-dashboard-todo" data-dashboard-todo>
      <h2 id="admin-dashboard-todo" className="text-sm font-extrabold text-slate-900">
        {ADMIN_DASHBOARD_TITLES.todo}
      </h2>
      <ul className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
        {cards.map((card) => (
          <li key={card.key}>
            <Link
              href={card.href}
              prefetch={false}
              title={card.source}
              data-todo-key={card.key}
              data-todo-tone={card.tone}
              className={cn("block rounded-2xl border p-4 shadow-sm transition hover:shadow-md", adminTodoCardClass(card.tone))}
            >
              <p className="text-xs font-bold text-slate-600">{card.label}</p>
              <p className={cn("mt-2 text-3xl tabular-nums", adminTodoCountClass(card.tone))}>{card.count.toLocaleString("ko-KR")}</p>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
