import { redirect } from "next/navigation";

/** 예상 URL `/admin/mentors` — 실제 멘토 운영 메뉴는 멘토 승인으로 통합됨(직결) */
export default function AdminMentorsRedirectPage() {
  redirect("/admin/mentor-approval");
}
