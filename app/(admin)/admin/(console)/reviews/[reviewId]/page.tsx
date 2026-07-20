import Link from "next/link";
import { PageScaffold } from "@/components/shell/PageScaffold";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/routeGuard";
import { firstReadableAdminTable } from "@/lib/admin/adminQueries";
import { toAdminDisplayError } from "@/lib/admin/adminDisplayError";
import { moderateAdminReviewAction } from "@/lib/admin/adminReviewActions";
import { FormSubmitButton } from "@/components/common/FormSubmitButton";

const CANDIDATES = ["reviews", "mentor_reviews", "mentor_review"] as const;

type Props = { params: Promise<{ reviewId: string }> };

export default async function AdminReviewDetailPage(props: Props) {
  await requireRole("admin");
  const { reviewId } = await props.params;
  const supabase = await createClient();
  const { table, error: te } = await firstReadableAdminTable(supabase, CANDIDATES);
  let row: Record<string, unknown> | null = null;
  let loadErr: string | null = te || null;
  if (table) {
    const { data, error } = await supabase.from(table).select("*").eq("id", reviewId).maybeSingle();
    if (error) loadErr = toAdminDisplayError(error.message, "reviews") ?? error.message;
    else row = (data as Record<string, unknown>) ?? null;
  }

  return (
    <PageScaffold
      hideFooterPlaceholderCards
      eyebrow="관리자 / 리뷰"
      title="리뷰 상세"
      description="리뷰 본문을 확인하고 숨김·블라인드·검토 완료 조치를 시도합니다."
      ctas={[
        { href: "/admin/reviews", label: "목록", tone: "blue" },
        { href: "/admin/reports", label: "신고", tone: "slate" },
      ]}
      sections={[]}
      dataPoints={[]}
    >
      <div className="space-y-4">
        <Link href="/admin/reviews" className="text-sm font-extrabold text-indigo-800 underline" prefetch={false}>
          ← 리뷰 목록
        </Link>
        {!table ? <p className="text-sm text-amber-800">리뷰 테이블을 찾지 못했습니다.</p> : null}
        {loadErr ? <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-900">{loadErr}</p> : null}
        {row ? (
          <pre className="max-h-[420px] overflow-auto rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs text-slate-800">
            {JSON.stringify(row, null, 2)}
          </pre>
        ) : table && !loadErr ? (
          <p className="text-sm text-slate-600">해당 id의 리뷰를 찾지 못했습니다.</p>
        ) : null}

        {row ? (
          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm font-extrabold text-slate-900">조치</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {(["hide", "restore", "blind", "review"] as const).map((action) => (
                <form key={action} action={moderateAdminReviewAction} className="inline">
                  <input type="hidden" name="reviewId" value={reviewId} />
                  <input type="hidden" name="action" value={action} />
                  <FormSubmitButton
                    idleLabel={action}
                    pendingLabel="…"
                    className="rounded-lg bg-slate-800 px-3 py-2 text-xs font-bold capitalize text-white"
                  />
                </form>
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </PageScaffold>
  );
}
