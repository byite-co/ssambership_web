import { PageScaffold } from "@/components/shell/PageScaffold";
import { AdminListToolbar } from "@/components/admin/AdminListToolbar";
import { AdminListPagination } from "@/components/admin/AdminListPagination";
import { parseAdminListParams } from "@/lib/admin/adminListParams";
import {
  loadAdminUsersListPaged,
  countAdminUsersByStatus,
  loadRecentUserBlocks,
  loadRecentDeletionLogs,
  type AdminUserRow,
} from "@/lib/admin/accountStatusQueries";
import { setUserStatusAction, issueUserWarningAction } from "@/lib/admin/accountStatusActions";
import { WARNING_AUTO_SUSPEND_THRESHOLD } from "@/lib/admin/accountStatusCore";
import { effectiveAccountStatus } from "@/lib/auth/accountStatus";

const BASE_PATH = "/admin/users";

function fmtDate(v: string | null): string {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v;
  return new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short" }).format(d);
}

function roleLabel(r: string): string {
  if (r === "student") return "학생";
  if (r === "mentor") return "멘토";
  if (r === "admin") return "관리자";
  return r || "—";
}

function statusMeta(eff: string): { label: string; cls: string } {
  switch (eff) {
    case "suspended":
      return { label: "일시 정지", cls: "bg-amber-50 text-amber-700 border-amber-200" };
    case "banned":
      return { label: "영구 차단", cls: "bg-red-50 text-red-700 border-red-200" };
    default:
      return { label: "정상", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" };
  }
}

type PageProps = { searchParams?: Promise<Record<string, string | string[] | undefined>> };

export default async function AdminUsersPage(props: PageProps) {
  const sp = (await props.searchParams) ?? {};
  const flashOk = typeof sp.ok === "string" ? sp.ok : null;
  const flashErr = typeof sp.error === "string" ? sp.error : null;

  const params = parseAdminListParams(sp, { defaultPageSize: 25, defaultStatus: "all" });
  const [list, byStatus, blocks, deletions] = await Promise.all([
    loadAdminUsersListPaged(params),
    countAdminUsersByStatus(),
    loadRecentUserBlocks(10),
    loadRecentDeletionLogs(10),
  ]);
  const rows = list.rows;

  const statusTabs = [
    { value: "all", label: "전체", count: byStatus.all ?? 0 },
    { value: "active", label: "정상", count: byStatus.active ?? 0 },
    { value: "suspended", label: "정지", count: byStatus.suspended ?? 0 },
    { value: "banned", label: "차단", count: byStatus.banned ?? 0 },
  ];

  return (
    <PageScaffold
      eyebrow="관리자 / 계정"
      title="계정 관리"
      description="회원 계정 상태를 정상·일시정지·영구차단으로 관리합니다. 정지된 계정은 질문 작성·구독·캐시 출금·커뮤니티 작성 등 핵심 활동이 차단됩니다."
      ctas={[
        { href: "/admin/disputes", label: "분쟁 관리", tone: "blue" },
        { href: "/admin/moderation", label: "콘텐츠 검수", tone: "slate" },
        { href: "/admin", label: "대시보드", tone: "slate" },
      ]}
      sections={[
        {
          title: "정지 정책",
          body: "일시 정지는 기간(일)을 지정하면 그 시각 이후 자동 해제됩니다. 영구 차단은 수동 해제 전까지 유지됩니다. 관리자 계정은 변경할 수 없습니다.",
          status: "connected",
        },
      ]}
      emptyState=""
      dataPoints={[]}
      hideFooterPlaceholderCards
    >
      <div className="mx-auto max-w-6xl space-y-6 pb-12">
        {flashOk ? (
          <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-900">
            {flashOk.startsWith("warned_suspended:")
              ? `경고가 누적되어 계정을 자동 일시정지했습니다. (누적 ${flashOk.split(":")[1]}회)`
              : flashOk.startsWith("warned:")
                ? `경고를 발급했습니다. (누적 ${flashOk.split(":")[1]}회)`
                : `상태를 변경했습니다: ${statusMeta(flashOk).label}`}
          </p>
        ) : null}
        {flashErr ? (
          <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-900">
            {flashErr}
          </p>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-3">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-bold uppercase text-slate-500">정상 계정</p>
            <p className="mt-2 text-2xl font-black text-emerald-600">{byStatus.active ?? 0}명</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-bold uppercase text-slate-500">일시 정지</p>
            <p className="mt-2 text-2xl font-black text-amber-600">{byStatus.suspended ?? 0}명</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-bold uppercase text-slate-500">영구 차단</p>
            <p className="mt-2 text-2xl font-black text-red-600">{byStatus.banned ?? 0}명</p>
          </div>
        </div>

        <AdminListToolbar
          basePath={BASE_PATH}
          params={params}
          searchPlaceholder="이메일·닉네임·이름·계정 ID로 검색"
          statusTabs={statusTabs}
        />

        {list.error ? (
          <div className="rounded-2xl border border-red-200 bg-red-50/60 p-5 text-sm text-red-950">
            <p className="font-bold">목록을 불러오지 못했습니다.</p>
            <p className="mt-1 text-xs text-red-900/90">{list.error}</p>
          </div>
        ) : !rows.length ? (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/40 p-8 text-center text-sm text-slate-500">
            <p className="font-bold text-slate-700">조건에 맞는 계정이 없습니다.</p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
            <table className="w-full min-w-[1000px] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/40">
                  <th className="px-5 py-3 text-xs font-bold text-slate-600">계정</th>
                  <th className="px-5 py-3 text-xs font-bold text-slate-600">역할</th>
                  <th className="px-5 py-3 text-xs font-bold text-slate-600">상태</th>
                  <th className="px-5 py-3 text-xs font-bold text-slate-600">사유 · 가입일</th>
                  <th className="px-5 py-3 text-xs font-bold text-slate-600">상태 변경</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((row: AdminUserRow) => {
                  const eff = effectiveAccountStatus(row);
                  const meta = statusMeta(eff);
                  const isAdmin = row.role === "admin";
                  return (
                    <tr key={row.id} className="align-top hover:bg-slate-50/30">
                      <td className="px-5 py-4">
                        <p className="font-bold text-slate-900">
                          {row.full_name || row.nickname || "(이름 없음)"}
                        </p>
                        <p className="text-xs text-slate-500">{row.email || "—"}</p>
                        <p className="mt-0.5 font-mono text-[10px] text-slate-400" title={row.id}>
                          {row.id.slice(0, 12)}…
                        </p>
                      </td>
                      <td className="px-5 py-4 text-xs font-semibold text-slate-700">
                        {roleLabel(row.role)}
                      </td>
                      <td className="px-5 py-4">
                        <span
                          className={`inline-block rounded-lg border px-2.5 py-1 text-xs font-bold ${meta.cls}`}
                        >
                          {meta.label}
                        </span>
                        {eff === "suspended" && row.suspended_until ? (
                          <p className="mt-1 text-[11px] font-semibold text-amber-700">
                            {fmtDate(row.suspended_until)} 해제
                          </p>
                        ) : null}
                        {(row.warning_count ?? 0) > 0 ? (
                          <p
                            className={`mt-1 text-[11px] font-bold ${
                              (row.warning_count ?? 0) >= WARNING_AUTO_SUSPEND_THRESHOLD
                                ? "text-red-600"
                                : "text-amber-600"
                            }`}
                          >
                            ⚠ 경고 {row.warning_count}/{WARNING_AUTO_SUSPEND_THRESHOLD}
                          </p>
                        ) : null}
                      </td>
                      <td className="px-5 py-4 text-xs text-slate-500">
                        <p className="text-slate-700">{row.status_reason || "—"}</p>
                        <p className="mt-1 text-[11px]">가입 {fmtDate(row.created_at)}</p>
                      </td>
                      <td className="px-5 py-4">
                        {isAdmin ? (
                          <span className="text-xs font-medium text-slate-400">관리자 (변경 불가)</span>
                        ) : (
                          <form className="flex min-w-[260px] flex-col gap-2">
                            <input type="hidden" name="userId" value={row.id} />
                            <div className="flex flex-wrap items-center gap-2">
                              <select
                                name="nextStatus"
                                defaultValue={eff}
                                className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs font-semibold text-slate-800 focus:border-blue-500 focus:outline-none"
                              >
                                <option value="active">정상</option>
                                <option value="suspended">일시 정지</option>
                                <option value="banned">영구 차단</option>
                              </select>
                              <input
                                type="number"
                                name="durationDays"
                                min={1}
                                placeholder="정지 일수"
                                className="w-24 rounded-lg border border-slate-200 px-2 py-1.5 text-xs text-slate-800 focus:border-blue-500 focus:outline-none"
                              />
                            </div>
                            <input
                              type="text"
                              name="reason"
                              placeholder="사유(선택)"
                              autoComplete="off"
                              className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-xs text-slate-800 focus:border-blue-500 focus:outline-none"
                            />
                            <button
                              type="submit"
                              formAction={setUserStatusAction}
                              className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-blue-500"
                            >
                              상태 적용
                            </button>
                          </form>
                        )}
                        {!isAdmin ? (
                          <form className="mt-2 flex min-w-[260px] flex-wrap items-center gap-2 border-t border-slate-100 pt-2">
                            <input type="hidden" name="userId" value={row.id} />
                            <input
                              type="text"
                              name="warnReason"
                              placeholder="경고 사유"
                              autoComplete="off"
                              className="min-w-[120px] flex-1 rounded-lg border border-slate-200 px-2 py-1.5 text-xs text-slate-800 focus:border-amber-500 focus:outline-none"
                            />
                            <button
                              type="submit"
                              formAction={issueUserWarningAction}
                              className="rounded-lg border border-amber-400 bg-white px-3 py-1.5 text-xs font-bold text-amber-700 hover:bg-amber-50"
                              title={`경고 ${WARNING_AUTO_SUSPEND_THRESHOLD}회 누적 시 자동 일시정지`}
                            >
                              ⚠ 경고 발급
                            </button>
                          </form>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <AdminListPagination
              basePath={BASE_PATH}
              params={params}
              totalCount={list.totalCount}
              rowsOnPage={rows.length}
            />
          </div>
        )}

        {/* 신설 기능 조회(읽기 전용): 사용자 차단 · 회원 탈퇴 로그 */}
        <div className="grid gap-4 lg:grid-cols-2">
          <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/60 px-5 py-3.5">
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-700">사용자 차단 현황</h2>
              <span className="rounded bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-600">
                {blocks.ok ? `총 ${blocks.totalCount}건 · 최근 ${blocks.rows.length}건` : "조회 실패"}
              </span>
            </div>
            {blocks.rows.length === 0 ? (
              <p className="p-6 text-center text-sm font-semibold text-slate-400">
                {blocks.ok ? "차단 기록이 없습니다." : "차단 현황을 불러오지 못했습니다."}
              </p>
            ) : (
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200/60 bg-slate-50/40">
                    <th className="px-5 py-2.5 text-xs font-bold text-slate-600">차단한 사용자</th>
                    <th className="px-5 py-2.5 text-xs font-bold text-slate-600">차단 대상</th>
                    <th className="px-5 py-2.5 text-xs font-bold text-slate-600">일시</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {blocks.rows.map((b) => (
                    <tr key={`${b.blockerId}-${b.blockedId}`}>
                      <td className="px-5 py-3 text-xs font-bold text-slate-800" title={b.blockerId}>
                        {b.blockerNickname ?? `${b.blockerId.slice(0, 8)}…`}
                      </td>
                      <td className="px-5 py-3 text-xs font-bold text-slate-800" title={b.blockedId}>
                        {b.blockedNickname ?? `${b.blockedId.slice(0, 8)}…`}
                      </td>
                      <td className="whitespace-nowrap px-5 py-3 text-xs text-slate-500">{fmtDate(b.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="border-t border-slate-100 px-5 py-3 text-xs text-slate-400">
              차단 생성·해제는 사용자 본인만 가능합니다(커뮤니티 노출 필터). 관리자 화면은 조회 전용입니다.
            </p>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/60 px-5 py-3.5">
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-700">회원 탈퇴 로그</h2>
              <span className="rounded bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-600">
                {deletions.ok ? `총 ${deletions.totalCount}건 · 최근 ${deletions.rows.length}건` : "조회 실패"}
              </span>
            </div>
            {deletions.rows.length === 0 ? (
              <p className="p-6 text-center text-sm font-semibold text-slate-400">
                {deletions.ok ? "탈퇴 기록이 없습니다." : "탈퇴 로그를 불러오지 못했습니다."}
              </p>
            ) : (
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200/60 bg-slate-50/40">
                    <th className="px-5 py-2.5 text-xs font-bold text-slate-600">사용자</th>
                    <th className="px-5 py-2.5 text-xs font-bold text-slate-600">사유</th>
                    <th className="px-5 py-2.5 text-xs font-bold text-slate-600">요청 일시</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {deletions.rows.map((d) => (
                    <tr key={`${d.userId}-${d.requestedAt ?? ""}`}>
                      <td className="px-5 py-3 text-xs font-bold text-slate-800" title={d.userId}>
                        {d.nickname ?? `${d.userId.slice(0, 8)}… (익명화)`}
                      </td>
                      <td className="max-w-[220px] truncate px-5 py-3 text-xs text-slate-600" title={d.reason ?? ""}>
                        {d.reason ?? "—"}
                      </td>
                      <td className="whitespace-nowrap px-5 py-3 text-xs text-slate-500">{fmtDate(d.requestedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="border-t border-slate-100 px-5 py-3 text-xs text-slate-400">
              탈퇴 완료 계정은 PII가 익명화되어 닉네임이 표시되지 않을 수 있습니다.
            </p>
          </section>
        </div>
      </div>
    </PageScaffold>
  );
}
