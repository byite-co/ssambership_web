import type { MentorsListView } from "@/lib/mentor/mentorsListSearchParams";
import type { MentorPublicListCard } from "@/lib/mentor/publicMentorsListQueries";
import { MentorCard } from "@/components/mentor/MentorCard";

// ★공개 멘토 카드 그리드: 받은 cards 를 **전부** 렌더한다(2단계 · 2026-09-06).
// 서버가 이미 페이지 단위(MENTORS_PAGE_SIZE 12)로 잘라 보내므로 클라이언트 슬라이스·이전/다음 버튼·
// 반응형 페이지 크기(useMediaQuery)를 두지 않는다 — 페이지 이동은 MentorsListBody 하단의
// MentorListPagination(?page= 링크) 하나뿐이다. RecentMentorsScope(최근 본 멘토 ≤20)도 같은 그리드로 전부 그린다.
export function MentorGrid(props: {
  cards: MentorPublicListCard[];
  favoriteIds: Set<string>;
  isLoggedIn: boolean;
  view?: MentorsListView;
}) {
  const view = props.view ?? "list";

  if (view === "grid") {
    return (
      <div className="grid min-w-0 grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-2">
        {props.cards.map((c) => (
          <MentorCard
            key={c.mentorId}
            card={c}
            isLoggedIn={props.isLoggedIn}
            isFavorited={props.favoriteIds.has(c.mentorId)}
            layout="grid"
          />
        ))}
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      {props.cards.map((c) => (
        <MentorCard
          key={c.mentorId}
          card={c}
          isLoggedIn={props.isLoggedIn}
          isFavorited={props.favoriteIds.has(c.mentorId)}
          layout="list"
        />
      ))}
    </div>
  );
}
