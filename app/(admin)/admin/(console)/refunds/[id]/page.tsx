import Link from "next/link";
import { PageScaffold } from "@/components/shell/PageScaffold";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/routeGuard";
import { toAdminDisplayError } from "@/lib/admin/adminDisplayError";
import { approveAdminRefundAction, rejectAdminRefundAction } from "@/lib/admin/refundActions";
import { FormSubmitButton } from "@/components/common/FormSubmitButton";

type Props = { params: Promise<{ id: string }> };

// W4(C10): 단일 후보 사전 프로브(firstReadableAdminTable(["refunds"])) 제거 — 정본 refunds
// 단일 조회, 오류는 그대로 표시(빈 결과로 은폐하지 않음).
export default async function AdminRefundDetailPage(props: Props) {
  await requireRole("admin");
  const { id } = await props.params;
  const supabase = await createClient();
  let row: Record<string, unknown> | null = null;
  let loadErr: string | null = null;
  {
    const { data, error } = await supabase.from("refunds").select("*").eq("id", id).maybeSingle();
    if (error) loadErr = toAdminDisplayError(error.message, "default") ?? error.message;
    else row = (data as Record<string, unknown>) ?? null;
  }

  return (
    <PageScaffold
      hideFooterPlaceholderCards
      eyebrow="관리자 / 환불"
      title="환불 상세"
      description="환불 행을 확인하고 승인·거절 RPC를 호출합니다. 실패 시 목록 상단 메시지를 확인해 주세요."
      ctas={[
        { href: "/admin/refunds", label: "환불 목록", tone: "blue" },
        { href: "/admin/disputes", label: "분쟁", tone: "slate" },
      ]}
      sections={[]}
      dataPoints={[]}
    >
      <div className="space-y-4">
        <Link href="/admin/refunds" className="text-sm font-extrabold text-indigo-800 underline" prefetch={false}>
          ← 환불 목록
        </Link>
        {loadErr ? <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-900">{loadErr}</p> : null}
        {row ? (
          <pre className="max-h-[420px] overflow-auto rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs text-slate-800">
            {JSON.stringify(row, null, 2)}
          </pre>
        ) : !loadErr ? (
          <p className="text-sm text-slate-600">해당 id의 환불 행을 찾지 못했습니다.</p>
        ) : null}

        {row ? (
          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm font-extrabold text-slate-900">처리</p>
            <p className="mt-1 text-xs text-slate-500">RPC·원장 환경에 따라 실패할 수 있습니다.</p>
            <div className="mt-3 flex flex-wrap gap-3">
              <form action={approveAdminRefundAction} className="space-y-2">
                <input type="hidden" name="refundId" value={id} />
                <label className="block text-xs font-bold text-slate-700">
                  메모 (선택)
                  <input name="adminNote" className="mt-1 block w-full rounded border border-slate-200 px-2 py-1 text-xs" />
                </label>
                <FormSubmitButton idleLabel="승인" pendingLabel="…" className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white" />
              </form>
              <form action={rejectAdminRefundAction} className="space-y-2">
                <input type="hidden" name="refundId" value={id} />
                <label className="block text-xs font-bold text-slate-700">
                  메모 (선택)
                  <input name="adminNote" className="mt-1 block w-full rounded border border-slate-200 px-2 py-1 text-xs" />
                </label>
                <FormSubmitButton idleLabel="거절" pendingLabel="…" className="rounded-lg bg-red-600 px-3 py-2 text-xs font-bold text-white" />
              </form>
            </div>
          </section>
        ) : null}
      </div>
    </PageScaffold>
  );
}
