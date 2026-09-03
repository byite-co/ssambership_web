import { redirect } from "next/navigation";
import { buildAccountDetailUrl } from "@/lib/admin/accountDetailConsole";

type Props = { params: Promise<{ id: string }>; searchParams?: Promise<Record<string, string | string[] | undefined>> };

/**
 * 구 라우트 `/admin/mentor-approvals/[id]`(미도달) — PR-7 부터 계정 상세 멘토 탭으로 리다이렉트한다.
 * 감사 로그의 `detailHref` 와 정원 조정 액션의 옛 복귀 경로가 여기를 가리켜도 목록으로 튕기지 않는다. 정원 조정 플래시(`capOk`·`capError`)는 이어 붙인다.
 */
export default async function MentorApprovalDetailLegacyRedirect(props: Props) {
  const { id } = await props.params;
  const sp = (await props.searchParams) ?? {};
  const capError = typeof sp.capError === "string" ? sp.capError : null;
  redirect(buildAccountDetailUrl(id, { tab: "mentor", capOk: typeof sp.capOk === "string", capError }));
}
