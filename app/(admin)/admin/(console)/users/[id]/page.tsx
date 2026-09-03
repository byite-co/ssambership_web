import Link from "next/link";
import { AccountActionPanel } from "@/components/admin/AccountActionPanel";
import { AccountActionLogList } from "@/components/admin/AccountActionLogList";
import { AccountDetailHeader } from "@/components/admin/AccountDetailHeader";
import { AccountDeferredTabNotice, AccountDetailTabs } from "@/components/admin/AccountDetailTabs";
import { AccountMentorTab } from "@/components/admin/AccountMentorTab";
import { AccountStudentTab } from "@/components/admin/AccountStudentTab";
import { AdminPageLayout } from "@/components/admin/AdminPageLayout";
import { EmptyState } from "@/components/common/EmptyState";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/routeGuard";
import { toAdminDisplayError } from "@/lib/admin/adminDisplayError";
import {
  ACCOUNT_ACTION_LOG_MORE,
  ACCOUNT_ACTION_LOG_MORE_PARAM,
  ACCOUNT_ACTION_LOG_PAGE,
  ACCOUNT_BASE_PATH,
  ACCOUNT_CAP_OK_MESSAGE,
  ACCOUNT_DETAIL_TAB_PARAM,
  accountDetailFlashOkMessage,
  accountDetailTabsForRole,
  accountDetailUserActionsAvailable,
  buildAccountDetailUrl,
  resolveAccountDetailTab,
} from "@/lib/admin/accountDetailConsole";
import { ACCOUNT_READ_UNAVAILABLE_MESSAGE, loadAccountActionLogs, loadAccountDetailBase, serviceRoleOrNull } from "@/lib/admin/accountDetailQueries";
import { loadMentorAccountSection } from "@/lib/admin/accountMentorQueries";
import { loadStudentAccountSection } from "@/lib/admin/accountStudentQueries";
import { formatKoreanDate } from "@/lib/utils/formatDisplay";

type Props = { params: Promise<{ id: string }>; searchParams?: Promise<Record<string, string | string[] | undefined>> };

const BACK_LINK = "rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-extrabold text-slate-700 hover:bg-slate-50";

function pick(value: string | string[] | undefined): string {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value) && typeof value[0] === "string") return value[0].trim();
  return "";
}

/** 정지 해제 예정일(7일·30일) 표기 — 서버에서 한 번 계산해 클라이언트 모달에 넘긴다(실제 값은 액션 실행 시각 기준). */
function suspendUntilLabels(now = Date.now()): Record<"7d" | "30d", string> {
  const at = (days: number) => formatKoreanDate(new Date(now + days * 86_400_000).toISOString());
  return { "7d": at(7), "30d": at(30) };
}

/**
 * 관리자 · 계정 상세(PR-7 §2 · 패턴 B) — 한 사람에 대한 단일 진실 화면.
 *
 * 헤더(신원 블록 = PR-2 컴포넌트 · 상태축 계정·승인 둘) + 조치 패널(경고·정지·차단 — 관리자 계정은 없음) + 역할별 탭(멘토·학생·관리자 / PR-8 자리).
 * 읽기는 전부 service_role, 쓰기는 기존 액션만. 플래시: `?ok=`(경고·정지) · `?capOk=1`/`?capError=`(정원 조정) · `?error=`.
 * (admin)/layout.tsx + (console)/layout.tsx 의 이중 requireRole("admin") 가드 아래에 있다.
 */
export default async function AdminAccountDetailPage(props: Props) {
  await requireRole("admin");
  const { id } = await props.params;
  const sp = (await props.searchParams) ?? {};

  const flashOk = accountDetailFlashOkMessage(pick(sp.ok)) ?? (pick(sp.capOk) ? ACCOUNT_CAP_OK_MESSAGE : null);
  const flashErrRaw = pick(sp.error) || pick(sp.capError) || null;
  const flashErr = flashErrRaw ? (toAdminDisplayError(flashErrRaw, "default") ?? "처리에 실패했습니다. 잠시 후 다시 시도해 주세요.") : null;

  const backLink = (
    <Link href={ACCOUNT_BASE_PATH} className={BACK_LINK} prefetch={false}>
      ← 계정 목록
    </Link>
  );

  const db = serviceRoleOrNull();
  if (!db) {
    return (
      <AdminPageLayout title="계정 상세" actions={backLink}>
        <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-900">
          {ACCOUNT_READ_UNAVAILABLE_MESSAGE}
        </p>
      </AdminPageLayout>
    );
  }

  const { base, error } = await loadAccountDetailBase(db, id);
  if (!base) {
    return (
      <AdminPageLayout title="계정 상세" actions={backLink}>
        {error ? (
          <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-900">
            {error}
          </p>
        ) : (
          <EmptyState title="해당 계정을 찾을 수 없습니다" description="탈퇴했거나 주소가 잘못되었을 수 있습니다. 목록에서 다시 선택해 주세요." />
        )}
      </AdminPageLayout>
    );
  }

  const role = base.user.role;
  const tab = resolveAccountDetailTab(role, pick(sp[ACCOUNT_DETAIL_TAB_PARAM]));
  const tabDef = accountDetailTabsForRole(role).find((t) => t.value === tab)!;
  const logsMore = pick(sp[ACCOUNT_ACTION_LOG_MORE_PARAM]) === "all";
  const logsLimit = logsMore ? ACCOUNT_ACTION_LOG_MORE : ACCOUNT_ACTION_LOG_PAGE;

  const supabase = await createClient();
  const [logs, mentorSection, studentSection] = await Promise.all([
    loadAccountActionLogs(db, id, { by: role === "admin" ? "admin" : "target", limit: logsLimit }),
    role === "mentor" && tab === "mentor" ? loadMentorAccountSection(supabase, db, id) : Promise.resolve(null),
    role === "student" && tab === "student" ? loadStudentAccountSection(db, base.user) : Promise.resolve(null),
  ]);
  const logsMoreHref = !logsMore && logs.totalCount != null && logs.totalCount > logs.rows.length ? buildAccountDetailUrl(id, { tab, logs: "all" }) : null;
  const actionsAvailable = accountDetailUserActionsAvailable(role);

  return (
    <AdminPageLayout
      title={base.displayName}
      description={
        <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
          <span>{base.roleLabel}</span>
          <span aria-hidden="true">·</span>
          <span>{base.user.email ?? "이메일 없음"}</span>
          <span aria-hidden="true">·</span>
          <span className="font-mono text-xs text-slate-500" title={base.user.id}>
            {base.user.id}
          </span>
        </span>
      }
      actions={
        <>
          {backLink}
          {actionsAvailable ? (
            <AccountActionPanel
              target={{
                id: base.user.id,
                name: base.displayName,
                role,
                roleLabel: base.roleLabel,
                activeWarningCount: base.activeWarningCount,
                mentorRoomCount: base.mentorRoomCount,
              }}
              untilLabels={suspendUntilLabels()}
            />
          ) : null}
        </>
      }
    >
      {flashOk ? (
        <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-900">
          {flashOk}
        </p>
      ) : null}
      {flashErr ? (
        <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-900">
          처리 실패 — {flashErr} 이 화면에서 같은 버튼으로 다시 시도할 수 있습니다.
        </p>
      ) : null}

      <AccountDetailHeader base={base} mentorVerificationStatus={role === "mentor" ? (mentorSection?.profile.verificationStatus ?? null) : null} />

      <AccountDetailTabs userId={id} role={role} active={tab} />

      {tabDef.deferred ? (
        <AccountDeferredTabNotice label={tabDef.label} />
      ) : role === "mentor" ? (
        <AccountMentorTab userId={id} displayName={base.displayName} section={mentorSection} logs={logs} logsMoreHref={logsMoreHref} />
      ) : role === "student" && studentSection ? (
        <AccountStudentTab userId={id} section={studentSection} logs={logs} logsMoreHref={logsMoreHref} />
      ) : (
        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm" aria-label="처리 이력" data-account-admin-tab={id}>
          <h2 className="text-sm font-black tracking-tight text-slate-900">처리 이력 — 이 관리자가 실행한 조치</h2>
          <p className="mt-1 text-xs text-slate-500">관리자 계정에는 조치 패널이 없습니다(이 화면에서 정지하지 않습니다).</p>
          <div className="mt-3">
            <AccountActionLogList logs={logs} mode="admin" moreHref={logsMoreHref} />
          </div>
        </section>
      )}
    </AdminPageLayout>
  );
}
