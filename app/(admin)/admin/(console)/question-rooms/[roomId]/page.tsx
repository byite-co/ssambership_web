import Link from "next/link";
import { AdminPageLayout } from "@/components/admin/AdminPageLayout";
import { ConnectionNoteTimeline } from "@/components/admin/ConnectionNoteTimeline";
import { QuestionRoomHeader } from "@/components/admin/QuestionRoomHeader";
import { QuestionRoomThreadList } from "@/components/admin/QuestionRoomThreadList";
import { EmptyState } from "@/components/common/EmptyState";
import { requireRole } from "@/lib/auth/routeGuard";
import { parseAdminListParams } from "@/lib/admin/adminListParams";
import {
  QUESTION_DRILLDOWN_PAGE_SIZE,
  QUESTION_DRILLDOWN_RETURN_TO_PARAM,
  QUESTION_ROOM_TAB_PARAM,
  buildAccountDrilldownReturnPath,
  buildQuestionRoomUrl,
  resolveQuestionRoomReturnPath,
  resolveQuestionRoomTab,
} from "@/lib/admin/questionDrilldownConsole";
import { QUESTION_READ_UNAVAILABLE_MESSAGE, loadQuestionRoomOverview, loadRoomConnectionNotes, loadRoomThreads, serviceRoleOrNull } from "@/lib/admin/questionDrilldownQueries";

type Props = { params: Promise<{ roomId: string }>; searchParams?: Promise<Record<string, string | string[] | undefined>> };

const BACK_LINK = "rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-extrabold text-slate-700 hover:bg-slate-50";

function pick(value: string | string[] | undefined): string {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value) && typeof value[0] === "string") return value[0].trim();
  return "";
}

/**
 * 관리자 · 멘토별 화면(PR-8 §3) — 학생 × 멘토 한 쌍. **라우트 하나**, 방(`mentor_student_rooms.id`)으로 식별한다.
 * 학생 상세의 [구독 멘토]에서 와도, 멘토 상세의 [담당 학생]에서 와도 같은 화면이며 `returnTo`(계정 상세만 허용)로 온 곳에 돌아간다.
 * 헤더(실명 × 닉네임 · 구독 상태 · 사용량 RPC) + [질문] 탭(스레드 목록 → 질문 상세) / [연결노트] 탭(시간순 전부).
 * 읽기는 전부 service_role, 쓰기 없음. (admin)/layout.tsx + (console)/layout.tsx 의 이중 requireRole("admin") 가드 아래에 있다.
 */
export default async function AdminQuestionRoomPage(props: Props) {
  await requireRole("admin");
  const { roomId } = await props.params;
  const sp = (await props.searchParams) ?? {};
  const tab = resolveQuestionRoomTab(pick(sp[QUESTION_ROOM_TAB_PARAM]));
  const returnTo = resolveQuestionRoomReturnPath(pick(sp[QUESTION_DRILLDOWN_RETURN_TO_PARAM]));

  const db = serviceRoleOrNull();
  if (!db) {
    return (
      <AdminPageLayout title="멘토별 화면" actions={<Link href={returnTo ?? "/admin/users"} className={BACK_LINK} prefetch={false}>← 계정 상세</Link>}>
        <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-900">
          {QUESTION_READ_UNAVAILABLE_MESSAGE}
        </p>
      </AdminPageLayout>
    );
  }

  const { overview, error } = await loadQuestionRoomOverview(db, roomId);
  if (!overview) {
    return (
      <AdminPageLayout title="멘토별 화면" actions={<Link href={returnTo ?? "/admin/users"} className={BACK_LINK} prefetch={false}>← 계정 상세</Link>}>
        {error ? (
          <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-900">
            {error}
          </p>
        ) : (
          <EmptyState title="해당 질문방을 찾을 수 없습니다" description="삭제됐거나 주소가 잘못되었을 수 있습니다. 계정 상세에서 다시 선택해 주세요." />
        )}
      </AdminPageLayout>
    );
  }

  // 온 곳이 없거나 허용 밖이면 학생 상세의 [구독 멘토] 탭으로.
  const backHref = returnTo ?? buildAccountDrilldownReturnPath(overview.room.studentId, "mentors");
  const listParams = parseAdminListParams(sp, { defaultPageSize: QUESTION_DRILLDOWN_PAGE_SIZE });
  /** 질문 상세가 돌아올 곳 — 이 화면(탭 · returnTo 포함) */
  const selfReturnTo = buildQuestionRoomUrl(overview.room.id, { tab, returnTo });
  const [threads, notes] = await Promise.all([
    tab === "questions" ? loadRoomThreads(db, overview.room.id, { page: listParams.page, pageSize: listParams.pageSize }) : Promise.resolve(null),
    tab === "notes" ? loadRoomConnectionNotes(db, overview.room.id, { studentId: overview.room.studentId, mentorId: overview.room.mentorId }) : Promise.resolve(null),
  ]);

  return (
    <AdminPageLayout
      title={`${overview.studentName} × ${overview.mentorName}`}
      description="학생 × 멘토 한 쌍 — 질문 목록과 연결노트. 학생은 실명, 멘토는 닉네임으로 보입니다."
      actions={
        <Link href={backHref} className={BACK_LINK} prefetch={false}>
          ← 계정 상세
        </Link>
      }
    >
      <QuestionRoomHeader overview={overview} activeTab={tab} returnTo={returnTo} />
      {tab === "notes" && notes ? (
        <ConnectionNoteTimeline roomId={overview.room.id} notes={notes} />
      ) : threads ? (
        <QuestionRoomThreadList roomId={overview.room.id} list={threads} params={listParams} returnTo={selfReturnTo} />
      ) : null}
    </AdminPageLayout>
  );
}
