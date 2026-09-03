/**
 * 계정 상세 공통 헤더(PR-7 §2-1) — 역할 무관. Server Component.
 *
 * - 신원 블록은 PR-2 멘토 승인 작업대와 **같은 컴포넌트**(`IdentityReviewBlock`). 일치 배지는 제목 옆.
 * - 상태축은 **계정 · 승인(멘토만)** 둘뿐이다. 학교 인증·활동 상태는 멘토 탭의 섹션 라벨로만 보인다(넷을 한 줄에 나열하지 않는다).
 */
import { AdminStatusPill } from "@/components/admin/AdminStatusPill";
import { IdentityReviewBlock } from "@/components/admin/IdentityReviewBlock";
import { StatusBadge } from "@/components/design-system/StatusBadge";
import { ACCOUNT_IDENTITY_UNVERIFIED_WARNING, ACCOUNT_LAST_ACTIVITY_SOURCE_LABELS, accountHeaderAxes } from "@/lib/admin/accountDetailConsole";
import type { AccountDetailBase } from "@/lib/admin/accountDetailQueries";
import { ACCOUNT_WARNING_AUTO_SUSPEND_THRESHOLD } from "@/lib/admin/accountSanctionPolicy";
import { identityReviewLabel, identityReviewTone } from "@/lib/admin/mentorIdentityReview";
import { formatKoreanDate } from "@/lib/utils/formatDisplay";
import { formatKoDateTimeKst } from "@/lib/utils/kstTime";

type Props = {
  base: AccountDetailBase;
  /** 멘토만 — `mentor_profiles.verification_status`(승인 축). 프로필 행이 없으면 null */
  mentorVerificationStatus: string | null;
};

export function AccountDetailHeader({ base, mentorVerificationStatus }: Props) {
  const { user, identity, identityError, effectiveStatus, lastActivity } = base;
  const axes = accountHeaderAxes(user.role);
  const warn = base.activeWarningCount;

  return (
    <section className="rounded-2xl border border-slate-200 bg-white shadow-sm" aria-label="계정 헤더" data-account-header={user.id}>
      <div className="grid gap-4 px-4 py-4 lg:grid-cols-[minmax(0,420px)_1fr]">
        <div>
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-xs font-black tracking-tight text-slate-900">신원</h2>
            {identity ? <StatusBadge label={identityReviewLabel(identity.kind)} tone={identityReviewTone(identity.kind)} size="sm" /> : null}
          </div>
          <div className="mt-2">
            <IdentityReviewBlock identity={identity} identityError={identityError} unverifiedWarning={ACCOUNT_IDENTITY_UNVERIFIED_WARNING} />
          </div>
        </div>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-xs sm:grid-cols-3" data-account-header-axes={axes.join(",")}>
          <div>
            <dt className="font-black text-slate-500">계정</dt>
            <dd className="mt-1">
              <AdminStatusPill table="users" column="status" value={effectiveStatus} size="sm" />
              {effectiveStatus === "suspended" && user.suspended_until ? (
                <p className="mt-0.5 text-[11px] font-semibold text-amber-700">{formatKoreanDate(user.suspended_until)} 해제</p>
              ) : null}
              {user.status_reason ? (
                <p className="mt-0.5 truncate text-[11px] font-medium text-slate-500" title={user.status_reason}>
                  사유: {user.status_reason}
                </p>
              ) : null}
              {user.status_changed_at ? (
                <p className="mt-0.5 text-[11px] text-slate-400">
                  {formatKoDateTimeKst(user.status_changed_at)}
                  {base.statusChangedByName ? ` · ${base.statusChangedByName}` : ""}
                </p>
              ) : null}
            </dd>
          </div>
          {axes.includes("approval") ? (
            <div>
              <dt className="font-black text-slate-500">승인</dt>
              <dd className="mt-1">
                {mentorVerificationStatus == null ? (
                  <StatusBadge label="프로필 없음" tone="neutral" size="sm" />
                ) : (
                  <AdminStatusPill table="mentor_profiles" column="verification_status" value={mentorVerificationStatus} size="sm" />
                )}
              </dd>
            </div>
          ) : null}
          <div>
            <dt className="font-black text-slate-500">가입</dt>
            <dd className="mt-1 font-semibold tabular-nums text-slate-900">{formatKoreanDate(user.created_at)}</dd>
          </div>
          <div>
            <dt className="font-black text-slate-500">최근 활동</dt>
            <dd className="mt-1 font-semibold tabular-nums text-slate-900" title={lastActivity.source ? ACCOUNT_LAST_ACTIVITY_SOURCE_LABELS[lastActivity.source] : undefined}>
              {formatKoreanDate(lastActivity.at)}
              {lastActivity.source ? <span className="ml-1 text-[10px] font-bold text-slate-400">{lastActivity.source === "audit" ? "조치" : "갱신"}</span> : null}
            </dd>
          </div>
          <div>
            <dt className="font-black text-slate-500">누적 경고</dt>
            <dd className={`mt-1 font-semibold tabular-nums ${warn == null ? "text-slate-500" : warn >= ACCOUNT_WARNING_AUTO_SUSPEND_THRESHOLD ? "text-red-700" : warn > 0 ? "text-amber-700" : "text-slate-900"}`}>
              {warn == null ? "확인 불가" : `${warn}회 / ${ACCOUNT_WARNING_AUTO_SUSPEND_THRESHOLD}회 자동 정지`}
            </dd>
          </div>
          {user.role === "mentor" && base.mentorRoomCount != null ? (
            <div>
              <dt className="font-black text-slate-500">담당 학생</dt>
              <dd className="mt-1 font-semibold tabular-nums text-slate-900">{base.mentorRoomCount}명</dd>
            </div>
          ) : null}
        </dl>
      </div>
    </section>
  );
}
