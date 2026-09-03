import Link from "next/link";
import { AdminPageLayout } from "@/components/admin/AdminPageLayout";
import { CommunityContentList } from "@/components/admin/CommunityContentList";
import { countCommunityContentTabs, countCommunityContentTypes, loadCommunityContentList } from "@/lib/admin/adminCommunityContentQueries";
import { toAdminDisplayError } from "@/lib/admin/adminDisplayError";
import { parseAdminListParams, type AdminListParams } from "@/lib/admin/adminListParams";
import {
  COMMUNITY_CONTENT_DEFAULT_PAGE_SIZE,
  COMMUNITY_CONTENT_DEFAULT_TAB,
  COMMUNITY_CONTENT_DEFAULT_TYPE,
  COMMUNITY_CONTENT_TYPE_PARAM,
  communityContentFlashOkMessage,
  resolveCommunityContentTab,
  resolveCommunityContentType,
} from "@/lib/admin/communityContentConsole";
import { CONTENT_REPORT_BASE_PATH } from "@/lib/admin/contentReportConsole";
import { createClient } from "@/lib/supabase/server";

type PageProps = { searchParams?: Promise<Record<string, string | string[] | undefined>> };

const ACTION_LINK = "rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-extrabold text-slate-700 hover:bg-slate-50";

function pick(value: string | string[] | undefined): string {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value) && typeof value[0] === "string") return value[0].trim();
  return "";
}

/**
 * 관리자 · 커뮤니티 관리(PR-11 §1 · 패턴 A). `AdminPageLayout` + `AdminDataTable` 위에 있다.
 *
 * 쿼리: `type`(종류 탭 — 글 `posts`(기본) · 숏폼 `shortforms` · 댓글 `comments` · extra) · `status`(상태 탭 — 게시 · 숨김 · 삭제됨 · 전체(기본)) · `q` · `page`. 전부 서버 조회.
 * 삭제됨은 `deleted_at IS NOT NULL` 판정(CHECK 가 deleted 를 막는다 · DB-2 SQL 194 부터 글·숏폼·댓글 전부). 조치 3종은 행의 확인 절차(stateChange)를 거치고,
 * 삭제는 소프트 삭제라 삭제됨 탭에서 복원한다(PR-W2 — 하드 DELETE 경로 0).
 * (admin)/layout.tsx + (console)/layout.tsx 의 이중 requireRole("admin") 가드 아래에 있다.
 */
export default async function AdminCommunityContentPage(props: PageProps) {
  const sp = (await props.searchParams) ?? {};
  const rawParams = parseAdminListParams(sp, { defaultPageSize: COMMUNITY_CONTENT_DEFAULT_PAGE_SIZE, defaultStatus: COMMUNITY_CONTENT_DEFAULT_TAB });
  const type = resolveCommunityContentType(rawParams.extra[COMMUNITY_CONTENT_TYPE_PARAM]);
  const tab = resolveCommunityContentTab(rawParams.status);
  // 링크에 실을 extra 는 이 화면이 아는 키(정규화된 종류)만 — 알 수 없는 키가 따라다니지 않게.
  const extra: Record<string, string> = {};
  if (type !== COMMUNITY_CONTENT_DEFAULT_TYPE) extra[COMMUNITY_CONTENT_TYPE_PARAM] = type;
  const params: AdminListParams = { ...rawParams, status: tab, extra };

  const flashOk = communityContentFlashOkMessage(pick(sp.ok));
  const flashErrRaw = pick(sp.error) || null;
  const flashErr = flashErrRaw ? (toAdminDisplayError(flashErrRaw, "default") ?? "처리에 실패했습니다. 잠시 후 다시 시도해 주세요.") : null;

  const supabase = await createClient();
  const [list, counts, typeCounts] = await Promise.all([
    loadCommunityContentList(supabase, { type, tab, search: params.search, page: params.page, pageSize: params.pageSize }),
    countCommunityContentTabs(supabase, type),
    countCommunityContentTypes(supabase),
  ]);

  return (
    <AdminPageLayout
      title="커뮤니티 관리"
      description="신고가 없어도 글·숏폼·댓글을 찾아 숨김·복원·삭제합니다. 삭제는 소프트 삭제라 '삭제됨' 탭에서 복원할 수 있습니다."
      actions={
        <>
          <Link href={CONTENT_REPORT_BASE_PATH} className={ACTION_LINK} prefetch={false}>
            콘텐츠 검수(신고)
          </Link>
          <Link href="/community" className={ACTION_LINK} prefetch={false} target="_blank" rel="noreferrer">
            공개 커뮤니티 보기
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

      <CommunityContentList items={list.rows} params={params} type={type} tab={tab} counts={counts} typeCounts={typeCounts} totalCount={list.totalCount} error={list.error} />
    </AdminPageLayout>
  );
}
