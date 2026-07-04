import { redirect } from "next/navigation";

/**
 * W-05: 충전 경로 통합 — 정식 진입은 /wallet/charge 단일화.
 * /cash 는 레거시 URL 보존용 redirect 스텁(북마크·외부 링크 호환).
 * 접근 가드(학생/멘토 충전 허용, 비로그인 로그인 유도)는 /wallet/charge 측이 담당.
 */
export default function LegacyCashPage() {
  redirect("/wallet/charge");
}
