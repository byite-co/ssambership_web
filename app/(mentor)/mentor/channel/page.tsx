/**
 * ⚠️ 보존 고아(orphan) — W-08 결정: 폐기 금지·무링크 보존.
 * 어떤 네비게이션·버튼에서도 이 페이지로 링크를 걸지 않는다(URL 직접 접근만 가능).
 * 채널 기능 검토 후 처리 예정. 이전 이력: 7a9ef7c에서 redirect 스텁으로 숨김 → 원형 복구.
 */
import { PageScaffold } from "@/components/shell/PageScaffold";
import { MentorChannelPageBody } from "@/components/mentor/MentorChannelPageBody";
import { requireRole } from "@/lib/auth/routeGuard";
import { MENTOR_CHANNEL_DATA_MODEL, MENTOR_PROFILE_DATA_MODEL } from "@/lib/mentor/mentorDataModel";
import { loadMentorChannelMedia } from "@/lib/mentor/mentorChannelQueries";
import { createClient } from "@/lib/supabase/server";
import {
  USER_UI_MENTOR_CHANNEL_EMPTY,
  USER_UI_MENTOR_CHANNEL_LOAD_FAILED,
} from "@/lib/constants/userFacingMessages";

export default async function MentorChannelPage() {
  const { user } = await requireRole("mentor");
  const supabase = await createClient();
  const { items, error, probe } = await loadMentorChannelMedia(supabase, user.id);

  const listFailed = Boolean(error);
  const hasItems = items.length > 0;

  return (
    <PageScaffold
      hideFooterPlaceholderCards
      eyebrow="멘토 · 채널"
      title="멘토 채널 · 대표 콘텐츠"
      description="등록한 대표 콘텐츠를 유형별로 모아 보여 줍니다. 새 자료는 프로필·연결 메뉴에서 준비할 수 있어요."
      ctas={[
        { href: "/mentor/profile/edit", label: "프로필·연결 편집", tone: "slate" },
        { href: "/mentor/mypage", label: "마이페이지", tone: "green" },
      ]}
      sections={[
        {
          title: "목록",
          body: listFailed
            ? USER_UI_MENTOR_CHANNEL_LOAD_FAILED
            : hasItems
              ? `${items.length}건의 콘텐츠를 불러왔습니다.`
              : "등록된 미디어가 없거나, 채널 자료는 아직 준비 중입니다.",
          status: listFailed ? "skeleton" : "connected",
        },
        {
          title: "추가·편집",
          body: "자료 추가와 편집은 프로필·연결 화면과 이후 업데이트에서 안내될 예정이에요.",
          status: "skeleton",
        },
        {
          title: "공개 상태",
          body: "각 항목의 공개 설정에 따라 노출 여부가 달라질 수 있어요.",
          status: "connected",
        },
        {
          title: "성과",
          body: "조회·반응 등 지표는 추후 제공될 수 있어요.",
          status: "skeleton",
        },
      ]}
      emptyState={USER_UI_MENTOR_CHANNEL_EMPTY}
      loadingState="불러오는 중입니다."
      errorState={listFailed ? USER_UI_MENTOR_CHANNEL_LOAD_FAILED : "—"}
      dataPoints={[...MENTOR_PROFILE_DATA_MODEL, ...MENTOR_CHANNEL_DATA_MODEL]}
    >
      <MentorChannelPageBody items={items} listError={error} probe={probe} />
    </PageScaffold>
  );
}
