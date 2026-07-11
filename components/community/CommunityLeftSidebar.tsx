import Link from "next/link";
import type { CommunityNavActive } from "@/components/community/CommunityNavTypes";
import type { CommunityHashtagRow } from "@/lib/community/communityBoardQueries";
import { SURFACE_CARD } from "@/lib/ui/surfaceCard";

function NavLink({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <Link
      href={href}
      className={[
        "block rounded-xl px-3 py-2 text-sm transition",
        active ? "bg-[#eef4ff] font-semibold text-[#2563EB]" : "font-medium text-slate-700 hover:bg-slate-50",
      ].join(" ")}
    >
      {label}
    </Link>
  );
}

export function CommunityLeftSidebar(props: {
  active: CommunityNavActive;
  loggedIn: boolean;
  /** 실시간 인기 주제 — community_hashtags(트리거 집계)에서 count 상위 순 (CommunityLayoutShell에서 조회) */
  hotTopics?: CommunityHashtagRow[];
}) {
  const a = props.active;
  const meActive = a === "me" || a === "my-posts" || a === "scraps";
  const hotTopics = props.hotTopics ?? [];

  return (
    <aside className="hidden w-full lg:block lg:w-[200px]" aria-label="커뮤니티 메뉴">
      <div className="flex flex-col gap-[14px]">
      <nav className={`${SURFACE_CARD} !px-3 !py-3`}>
        <NavLink href="/community" label="홈" active={a === "home"} />
        <NavLink href="/community/shortform" label="숏폼" active={a === "shortform"} />
        <NavLink href="/community/board" label="게시판" active={a === "board"} />
        <div className="my-2 border-t border-[#eef0f3]" />
        <NavLink href="/community/me" label="내 활동" active={meActive} />
      </nav>

      <section className={`${SURFACE_CARD} !px-3 !py-3`}>
        <h3 className="text-xs font-extrabold text-slate-900">실시간 인기 주제</h3>
        {hotTopics.length > 0 ? (
          <ol className="mt-2 space-y-2">
            {hotTopics.map((topic, i) => (
              <li key={topic.tag} className="flex items-start gap-2">
                <span className="w-4 shrink-0 text-sm font-extrabold text-[#2563EB]">{i + 1}</span>
                <span className="min-w-0 truncate text-xs font-medium text-slate-700">#{topic.tag}</span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="mt-2 text-xs font-medium text-slate-400">게시글이 쌓이면 인기 주제가 표시돼요.</p>
        )}
      </section>

      {!props.loggedIn ? (
        <section className="rounded-2xl bg-[#2563EB] px-3 py-4 text-white">
          <p className="text-xs font-extrabold leading-relaxed">로그인하면</p>
          <p className="mt-1 text-xs leading-relaxed text-blue-50">댓글·스크랩 이용</p>
          <Link
            href="/login?next=%2Fcommunity"
            className="mt-3 inline-flex w-full items-center justify-center rounded-xl bg-white px-3 py-2 text-xs font-extrabold text-[#2563EB]"
          >
            로그인
          </Link>
        </section>
      ) : null}
      </div>
    </aside>
  );
}
