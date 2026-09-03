import Link from "next/link";
import type { ReactNode } from "react";
import { AdminPageLayout } from "@/components/admin/AdminPageLayout";
import { PayoutRunHistory } from "@/components/admin/PayoutRunHistory";
import { SettlementCurrentPanel } from "@/components/admin/SettlementCurrentPanel";
import { SettlementMentorPanel } from "@/components/admin/SettlementMentorPanel";
import { SettlementTabNav } from "@/components/admin/SettlementTabNav";
import { toAdminDisplayError } from "@/lib/admin/adminDisplayError";
import {
  SETTLEMENT_MENTOR_PARAM,
  SETTLEMENT_NOTICE,
  SETTLEMENT_RUN_PARAM,
  SETTLEMENT_TAB_PARAM,
  resolveSettlementTab,
} from "@/lib/admin/settlementConsole";
import {
  loadMentorSettlementLines,
  loadPayoutRunDetail,
  loadPayoutRuns,
  loadSettlementPreview,
  searchSettlementMentors,
} from "@/lib/admin/settlementConsoleQueries";

type PageProps = { searchParams?: Promise<Record<string, string | string[] | undefined>> };

function pick(value: string | string[] | undefined): string {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value) && typeof value[0] === "string") return value[0].trim();
  return "";
}

const ACTION_LINK = "rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-extrabold text-slate-700 hover:bg-slate-50";

/**
 * 관리자 · 정산 관리(PR-9 §1) — [이번 달 정산] 미리보기 → 실행(critical) · [지급 이력] · [멘토별].
 *
 * - 구 화면의 PageScaffold "오류 재처리 [준비 중]" 카드는 없다. 상단 안내(실행 = 시스템상 지급 확정 · 실제 이체 별도)는 상시.
 * - 탭 키는 `tab` 하나. 지급 이력의 펼친 실행은 `run`, 멘토별 선택은 `mentor` · 검색은 `q`.
 * - 정산 RPC·`due_payouts`·`payout_runs` 는 service_role 전용이라 조회 모듈이 서비스 롤로 읽는다. 쓰기는 실행 액션 하나뿐.
 * (admin)/layout.tsx + (console)/layout.tsx 의 이중 requireRole("admin") 가드 아래에 있다.
 */
export default async function AdminSettlementsPage(props: PageProps) {
  const sp = (await props.searchParams) ?? {};
  const tab = resolveSettlementTab(pick(sp[SETTLEMENT_TAB_PARAM]));
  const flashOk = pick(sp.ok) || null;
  const flashErrRaw = pick(sp.error) || null;
  const flashErr = flashErrRaw ? (toAdminDisplayError(flashErrRaw, "settlements") ?? "처리에 실패했습니다. 잠시 후 다시 시도해 주세요.") : null;

  let body: ReactNode;
  if (tab === "history") {
    const runId = pick(sp[SETTLEMENT_RUN_PARAM]) || null;
    const [runs, detail] = await Promise.all([loadPayoutRuns(), runId ? loadPayoutRunDetail(runId) : Promise.resolve(null)]);
    body = <PayoutRunHistory runs={runs} detail={detail} selectedRunId={runId} />;
  } else if (tab === "mentor") {
    const q = pick(sp.q);
    const mentorId = pick(sp[SETTLEMENT_MENTOR_PARAM]) || null;
    const [search, selected] = await Promise.all([
      q ? searchSettlementMentors(q) : Promise.resolve({ hits: [], error: null }),
      mentorId ? loadMentorSettlementLines(mentorId) : Promise.resolve(null),
    ]);
    body = <SettlementMentorPanel q={q} search={search} selected={selected} selectedId={mentorId} />;
  } else {
    const load = await loadSettlementPreview();
    body = <SettlementCurrentPanel load={load} />;
  }

  return (
    <AdminPageLayout
      title="정산 관리"
      description="이번 달 지급 대상을 미리 보고 대사한 뒤 정산을 실행합니다. 실행은 캐시 원장·지급 이력에 확정 기록을 남기며 되돌릴 수 없습니다."
      actions={
        <>
          <Link href="/admin/topups" className={ACTION_LINK} prefetch={false}>
            충전 관리
          </Link>
          <Link href="/admin/refunds" className={ACTION_LINK} prefetch={false}>
            환불 관리
          </Link>
          <Link href="/admin/disputes" className={ACTION_LINK} prefetch={false}>
            분쟁 관리
          </Link>
          <Link href="/admin/audit-logs" className={ACTION_LINK} prefetch={false}>
            감사 로그
          </Link>
        </>
      }
    >
      <p role="note" className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-bold text-blue-900" data-settlement-notice>
        ⓘ {SETTLEMENT_NOTICE}
      </p>

      {flashOk ? (
        <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-900">
          {flashOk}
        </p>
      ) : null}
      {flashErr ? (
        <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-900">
          처리 실패 — {flashErr}
        </p>
      ) : null}

      <SettlementTabNav tab={tab} />
      {body}
    </AdminPageLayout>
  );
}
