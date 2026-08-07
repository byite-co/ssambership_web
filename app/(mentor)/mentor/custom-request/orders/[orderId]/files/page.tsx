import { redirect } from "next/navigation";

type PageProps = {
  params: Promise<{ orderId: string }>;
};

/**
 * 동선 통합: standalone "작업 파일" 페이지 은퇴 — 파일 업로드/재납품은 주문방의 인라인
 * "작업 파일" 섹션(OrderDeliverablesPanel)으로 일원화한다.
 * 라우트 파일은 깨진 고리 방지를 위해 남겨두고 주문방으로 redirect만 한다(orderId 유지).
 * D-CR-4: 구 작업파일 화면(MentorOrderFilesView·CustomRequestOrderReviewPanel)과 전용 액션
 * (uploadMentorOrderWorkFileAction·markMentorOrderDeliveredForReviewAction)은 import 0건 DEAD 로 삭제됨.
 * 납품은 주문방 인라인 "작업 파일" 섹션(submitMentorOrderDeliverableAction)으로 일원화.
 */
export const dynamic = "force-dynamic";

export default async function MentorOrderFilesPage(props: PageProps) {
  const { orderId } = await props.params;
  redirect(`/custom-request/orders/${encodeURIComponent(orderId)}`);
}
