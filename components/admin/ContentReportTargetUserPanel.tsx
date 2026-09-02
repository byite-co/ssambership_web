/**
 * 신고 상세 — 신고당한 사용자 블록(PR-6 §1-3). 조치를 결정할 재료: 이름 · 역할 · 가입일 · 누적 경고 · 현재 계정 상태 · 이전 신고 건수 ·
 * (멘토) 담당 학생 수. Server Component — 데이터는 `loadContentReportTargetUser` 가 만든다.
 * 작성자를 알 수 없는 신고(미지원 유형·삭제된 콘텐츠·조회 실패)는 그 사실을 보이고 조치 버튼을 두지 않는다.
 */
import { AdminStatusPill } from "@/components/admin/AdminStatusPill";
import { ACCOUNT_WARNING_AUTO_SUSPEND_THRESHOLD } from "@/lib/admin/accountSanctionPolicy";
import type { ContentReportTargetUser } from "@/lib/admin/contentReportSanctionConsole";
import { formatKoreanDate } from "@/lib/utils/formatDisplay";
import { cn } from "@/lib/utils/cn";

type Props = {
  user: ContentReportTargetUser | null;
  /** 증거 조회에서 작성자 id 를 얻었는가(없으면 사용자 블록 대신 안내) */
  authorKnown: boolean;
};

function Cell(props: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div>
      <dt className="text-xs font-black text-slate-500">{props.label}</dt>
      <dd className={cn("mt-0.5 text-sm font-bold text-slate-900", props.className)}>{props.children}</dd>
    </div>
  );
}

export function ContentReportTargetUserPanel({ user, authorKnown }: Props) {
  if (!user) {
    return (
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" data-content-report-target-user="unknown">
        <p className="text-sm font-extrabold text-slate-900">신고당한 사용자</p>
        <p className="mt-2 text-sm font-semibold text-slate-500">
          {authorKnown
            ? "작성자 계정을 찾지 못했습니다. 탈퇴했거나 계정 정보를 읽을 수 없습니다 — 경고·정지는 계정 관리 화면에서 확인해 주세요."
            : "이 신고는 대상 콘텐츠의 작성자를 알 수 없어(미지원 유형·삭제된 콘텐츠·조회 실패) 사용자 정보와 경고·정지 조치를 표시하지 않습니다."}
        </p>
      </section>
    );
  }

  const warn = user.activeWarningCount;
  const warnTone = warn == null ? "text-slate-500" : warn >= ACCOUNT_WARNING_AUTO_SUSPEND_THRESHOLD ? "text-red-700" : warn > 0 ? "text-amber-700" : "text-slate-900";

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" data-content-report-target-user={user.id}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-extrabold text-slate-900">신고당한 사용자</p>
        <AdminStatusPill table="users" column="status" value={user.effectiveStatus} size="sm" />
      </div>
      <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-3">
        <Cell label="이름">
          {user.name}
          {user.email ? <span className="ml-1 text-xs font-medium text-slate-500">{user.email}</span> : null}
          <p className="mt-0.5 font-mono text-[10px] font-normal text-slate-400" title={user.id}>
            {user.id.slice(0, 12)}…
          </p>
        </Cell>
        <Cell label="역할">{user.roleLabel}</Cell>
        <Cell label="가입일">{formatKoreanDate(user.createdAt)}</Cell>
        <Cell label="누적 경고" className={warnTone}>
          {warn == null ? "확인 불가" : `${warn}회 / ${ACCOUNT_WARNING_AUTO_SUSPEND_THRESHOLD}회 자동 정지`}
        </Cell>
        <Cell label="현재 계정 상태">
          <AdminStatusPill table="users" column="status" value={user.effectiveStatus} size="sm" />
          {user.effectiveStatus === "suspended" && user.suspendedUntil ? (
            <p className="mt-0.5 text-[11px] font-semibold text-amber-700">{formatKoreanDate(user.suspendedUntil)} 해제</p>
          ) : null}
          {user.statusReason ? (
            <p className="mt-0.5 truncate text-[11px] font-medium text-slate-500" title={user.statusReason}>
              사유: {user.statusReason}
            </p>
          ) : null}
        </Cell>
        <Cell label="이전 신고 건수">
          {user.previousReportCount == null ? "확인 불가" : `${user.previousReportCount}건`}
          {user.role === "mentor" && user.mentorRoomCount != null ? (
            <p className="mt-0.5 text-[11px] font-semibold text-slate-500">담당 학생 {user.mentorRoomCount}명</p>
          ) : null}
        </Cell>
      </dl>
    </section>
  );
}
