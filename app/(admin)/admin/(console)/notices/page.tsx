import Link from "next/link";
import { AdminPageLayout } from "@/components/admin/AdminPageLayout";
import { EmptyState } from "@/components/common/EmptyState";
import { NoticeEditorForm } from "@/components/admin/NoticeEditorForm";
import { NoticeListTable } from "@/components/admin/NoticeListTable";
import { NoticeListToolbar } from "@/components/admin/NoticeListToolbar";
import { PromotionSection } from "@/components/admin/PromotionSection";
import { toAdminDisplayError } from "@/lib/admin/adminDisplayError";
import { parseAdminListParams, type AdminListParams } from "@/lib/admin/adminListParams";
import { countNoticeTabs, loadNoticeById, loadNoticeList, loadPromotionList } from "@/lib/admin/adminNoticesQueries";
import {
  NOTICE_DEFAULT_PAGE_SIZE,
  NOTICE_EDIT_PARAM,
  NOTICE_TYPE_PARAM,
  buildNoticeListUrl,
  noticeEmptyState,
  noticeFlashOkMessage,
  noticeFormDefaults,
  resolveNoticeTypeTab,
} from "@/lib/admin/noticeConsole";
import { createClient } from "@/lib/supabase/server";

type PageProps = { searchParams?: Promise<Record<string, string | string[] | undefined>> };

const ACTION_LINK = "rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-extrabold text-slate-700 hover:bg-slate-50";

function pick(value: string | string[] | undefined): string {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value) && typeof value[0] === "string") return value[0].trim();
  return "";
}

/**
 * 관리자 · 공지·이벤트(PR-10 §1 · 패턴 A + 작성·수정 폼).
 *
 * 쿼리: `type`(유형 탭 · extra) · `q`(제목) · `page` · `edit`(수정 대상 — 링크에 따라다니지 않게 extra 에서 뺀다). 전부 서버 조회.
 * 목록 → 활성 토글(팝업 공지 활성화만 stateChange) · 수정 링크 → 같은 화면의 폼. 프로모션은 접힌 섹션(실사용 0).
 * 팝업을 실제로 띄우는 것은 PR-10b(서비스 레이아웃) — 이 화면은 서비스 화면을 건드리지 않는다.
 * (admin)/layout.tsx + (console)/layout.tsx 의 이중 requireRole("admin") 가드 아래에 있다.
 */
export default async function AdminNoticesPage(props: PageProps) {
  const sp = (await props.searchParams) ?? {};
  const rawParams = parseAdminListParams(sp, { defaultPageSize: NOTICE_DEFAULT_PAGE_SIZE });
  const tab = resolveNoticeTypeTab(rawParams.extra[NOTICE_TYPE_PARAM]);
  const extra: Record<string, string> = {};
  if (tab !== "all") extra[NOTICE_TYPE_PARAM] = tab;
  const params: AdminListParams = { ...rawParams, status: "", extra };
  const editId = pick(sp[NOTICE_EDIT_PARAM]) || null;

  const flashOk = noticeFlashOkMessage(pick(sp.ok));
  const flashErrRaw = pick(sp.error) || null;
  const flashErr = flashErrRaw ? (toAdminDisplayError(flashErrRaw, "notices") ?? "처리에 실패했습니다. 잠시 후 다시 시도해 주세요.") : null;

  const supabase = await createClient();
  const [list, counts, promotions, editing] = await Promise.all([
    loadNoticeList(supabase, params, tab),
    countNoticeTabs(supabase),
    loadPromotionList(supabase, 50),
    editId ? loadNoticeById(supabase, editId) : Promise.resolve(null),
  ]);
  const nowIso = new Date().toISOString();
  const empty = noticeEmptyState(tab, params.search, counts.tabs.all);
  const editMissing = Boolean(editId) && !editing;

  return (
    <AdminPageLayout
      title="공지·이벤트"
      description="서비스 공지·이벤트·점검·업데이트 안내를 등록하고 노출을 관리합니다. 팝업으로도 노출하면 접속하는 전체 사용자에게 모달로 표시됩니다."
      actions={
        <>
          <Link href="/admin/audit-logs" className={ACTION_LINK} prefetch={false}>
            감사 로그
          </Link>
          <Link href="/notices" className={ACTION_LINK} prefetch={false} target="_blank" rel="noreferrer">
            공개 공지 보기
          </Link>
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
          처리 실패 — {flashErr}
        </p>
      ) : null}
      {editMissing ? (
        <p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900">
          수정할 공지를 찾을 수 없습니다. 새 공지 작성 폼을 보여 드립니다.
        </p>
      ) : null}

      <NoticeListToolbar params={params} tab={tab} counts={counts} totalCount={list.totalCount} />

      {list.error ? (
        <div role="alert" className="rounded-2xl border border-red-200 bg-red-50/60 p-5 text-sm text-red-950">
          <p className="font-bold">공지 목록을 불러오지 못했습니다.</p>
          <p className="mt-1 text-xs text-red-900/90">{toAdminDisplayError(list.error, "notices") ?? "잠시 후 다시 시도해 주세요."}</p>
        </div>
      ) : list.rows.length === 0 ? (
        <EmptyState title={empty.title} description={empty.description}>
          {params.search ? (
            <Link href={buildNoticeListUrl(params, { search: "" })} className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50" prefetch={false}>
              검색 초기화
            </Link>
          ) : null}
        </EmptyState>
      ) : (
        <NoticeListTable items={list.rows} params={params} totalCount={list.totalCount} nowIso={nowIso} />
      )}

      <NoticeEditorForm
        key={editing ? `edit:${editing.id}:${editing.updatedAt ?? ""}` : "create"}
        mode={editing ? "edit" : "create"}
        noticeId={editing?.id ?? null}
        defaults={noticeFormDefaults(editing)}
        errorMessage={null}
      />

      <PromotionSection items={promotions.rows} error={promotions.error} />
    </AdminPageLayout>
  );
}
