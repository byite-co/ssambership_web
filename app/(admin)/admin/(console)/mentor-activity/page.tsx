import Link from "next/link";
import { AdminPageLayout } from "@/components/admin/AdminPageLayout";
import { MentorActivityList } from "@/components/admin/MentorActivityList";
import { toAdminDisplayError } from "@/lib/admin/adminDisplayError";
import { parseAdminListParams, type AdminListParams } from "@/lib/admin/adminListParams";
import {
  MENTOR_ACTIVITY_DEFAULT_PAGE_SIZE,
  MENTOR_ACTIVITY_DEFAULT_TAB,
  MENTOR_ACTIVITY_MISSING_ACTIONS_NOTE,
  resolveMentorActivityTab,
} from "@/lib/admin/mentorActivityConsole";
import { loadMentorActivityList } from "@/lib/admin/mentorActivityQueries";

type PageProps = { searchParams?: Promise<Record<string, string | string[] | undefined>> };

const ACTION_LINK = "rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-extrabold text-slate-700 hover:bg-slate-50";

function pick(value: string | string[] | undefined): string {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value) && typeof value[0] === "string") return value[0].trim();
  return "";
}

/**
 * 관리자 · 멘토 활동(PR-11 §4 · 패턴 A). `AdminPageLayout` + `AdminDataTable` 위에 있다.
 *
 * 쿼리: `status`(탭 — 활동 중 · 일시정지 · 종료 예정 · 이탈 의심 · 전체(기본)) · `q`(닉네임·이름·이메일) · `page`. 목록은 승인된 멘토 전원을 한 번 읽어
 * 미답변이 오래된 순으로 정렬한다. 조치는 기존 3경로(보류 확정 · 구제 · 유예 만료 정리)만 — 알림·활동 강제 정지 경로는 없다(§0-C).
 * 구 액션의 복귀 경로가 여기라 `?ok=`·`?error=` 플래시(자유 문장)를 그대로 받는다. (admin)/layout.tsx + (console)/layout.tsx 의 이중 requireRole("admin") 가드 아래에 있다.
 */
export default async function AdminMentorActivityPage(props: PageProps) {
  const sp = (await props.searchParams) ?? {};
  const rawParams = parseAdminListParams(sp, { defaultPageSize: MENTOR_ACTIVITY_DEFAULT_PAGE_SIZE, defaultStatus: MENTOR_ACTIVITY_DEFAULT_TAB });
  const tab = resolveMentorActivityTab(rawParams.status);
  const params: AdminListParams = { ...rawParams, status: tab, extra: {} };

  const flashOk = pick(sp.ok) || null;
  const flashErrRaw = pick(sp.error) || null;
  const flashErr = flashErrRaw ? (toAdminDisplayError(flashErrRaw, "default") ?? "처리에 실패했습니다. 잠시 후 다시 시도해 주세요.") : null;

  const now = new Date();
  const { list, counts } = await loadMentorActivityList({ tab, search: params.search, page: params.page, pageSize: params.pageSize, now });

  return (
    <AdminPageLayout
      title="멘토 활동"
      description={`승인된 멘토의 담당 학생·미답변 질문·활동 상태를 봅니다. 미답변이 오래된 멘토가 위에 오고, 24시간이 지나면 주의색, 48시간이 지나면 위험색입니다. ${MENTOR_ACTIVITY_MISSING_ACTIONS_NOTE}`}
      actions={
        <>
          <Link href="/admin/settlements" className={ACTION_LINK} prefetch={false}>
            정산 관리
          </Link>
          <Link href="/admin/users?role=mentor" className={ACTION_LINK} prefetch={false}>
            멘토 계정
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

      <MentorActivityList items={list.rows} params={params} tab={tab} counts={counts} totalCount={list.totalCount} error={list.error} now={now.getTime()} />
    </AdminPageLayout>
  );
}
