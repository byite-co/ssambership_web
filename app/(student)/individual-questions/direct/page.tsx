import { redirect } from "next/navigation";

/** /individual-questions/direct 단독 진입은 멘토 지정 게시판 앵커로 돌려보낸다(멘토 미지정 상태 방어). */
export default function DirectIndividualQuestionIndexPage() {
  redirect("/individual-questions#direct-mentor-board");
}
