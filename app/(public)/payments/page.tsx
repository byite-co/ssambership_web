import { redirect } from "next/navigation";

/** 결제 랜딩 흡수 — W-05: 캐시 충전 정식 진입은 /wallet/charge (이중 리다이렉트 제거) */
export default function PublicPaymentsAliasPage() {
  redirect("/wallet/charge");
}
