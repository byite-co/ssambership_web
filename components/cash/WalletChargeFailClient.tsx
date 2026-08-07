"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export function WalletChargeFailClient(props: { message: string }) {
  const router = useRouter();

  useEffect(() => {
    const t = window.setTimeout(() => router.replace("/wallet/charge"), 3000);
    return () => window.clearTimeout(t);
  }, [router]);

  return (
    <div className="mx-auto max-w-lg space-y-4 rounded-2xl border border-red-200 bg-white p-6 shadow-sm">
      <h1 className="text-xl font-black text-slate-900">결제 실패</h1>
      <p className="text-sm text-red-800">결제에 실패했습니다: {props.message}</p>
      <p className="text-xs text-slate-500">3초 후 충전 페이지로 이동합니다.</p>
      <Link href="/wallet/charge" className="text-sm font-bold text-blue-700 hover:underline">
        충전 페이지로 돌아가기
      </Link>
    </div>
  );
}
