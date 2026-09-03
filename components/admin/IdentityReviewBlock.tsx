/**
 * 신원 블록 — 가입 이름 ↔ 본인인증 실명 대조(PR-2 §4 ① 신원). Server Component.
 *
 * PR-2 멘토 승인 작업대 심사 패널에 인라인이던 마크업을 PR-7 에서 그대로 뽑았다 — 승인 패널과 계정 상세 헤더가 **같은 컴포넌트**를 쓴다.
 * 렌더 결과는 PR-2 와 같다(행 5개 · 미인증 경고 · 불일치 경고). 미인증 문장만 호출부가 바꿀 수 있다(승인 화면은 "승인 후 인증 안내가
 * 발송됩니다" 를 덧붙이고, 계정 상세는 사실만 적는다). 일치 배지(`identityReviewLabel` · `identityReviewTone`)는 호출부가 제목 옆에 그린다.
 */
import type { ReactNode } from "react";
import {
  IDENTITY_UNVERIFIED_WARNING,
  identityPhoneDisplay,
  identityReviewLabel,
  isIdentityUnverified,
  type MentorIdentityReview,
} from "@/lib/admin/mentorIdentityReview";
import { formatKoreanDate } from "@/lib/utils/formatDisplay";
import { formatKoDateTimeKst } from "@/lib/utils/kstTime";

export const IDENTITY_MISMATCH_WARNING = "가입 이름과 본인인증 실명이 다릅니다. 서류의 이름과 대조해 주세요.";

type Props = {
  identity: MentorIdentityReview | null;
  /** service_role 부재 등 판정 불가 안내 — 있으면 표 대신 이 문장만 보인다(fail-closed) */
  identityError: string | null;
  /** 미인증(pending·lapsed·none) 경고 문장 — 기본은 PR-2 승인 화면 문장 */
  unverifiedWarning?: string;
};

function Row(props: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1 text-xs">
      <dt className="w-20 shrink-0 font-bold text-slate-500">{props.label}</dt>
      <dd className="min-w-0 flex-1 text-right font-semibold text-slate-900">{props.children}</dd>
    </div>
  );
}

export function IdentityReviewBlock({ identity, identityError, unverifiedWarning = IDENTITY_UNVERIFIED_WARNING }: Props) {
  const unverified = identity ? isIdentityUnverified(identity.kind) : false;
  return (
    <>
      {identityError ? (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] font-bold text-amber-900">{identityError}</p>
      ) : identity ? (
        <dl className="divide-y divide-slate-50" data-identity-kind={identity.kind}>
          <Row label="가입 이름">{identity.registeredName || "—"}</Row>
          <Row label="인증 실명">
            {identity.verified ? (
              <span className={identity.kind === "mismatch" ? "text-red-700" : undefined}>{identity.verifiedName ?? "—"}</span>
            ) : (
              <span className="text-slate-400">{identityReviewLabel(identity.kind)}</span>
            )}
          </Row>
          <Row label="전화번호">{identity.verified ? identityPhoneDisplay(identity.phoneRegistered) : "—"}</Row>
          <Row label="생년월일">{identity.verified ? formatKoreanDate(identity.birthdate) : "—"}</Row>
          <Row label="인증 완료">{identity.verified ? formatKoDateTimeKst(identity.verifiedAt) : "—"}</Row>
        </dl>
      ) : null}
      {identity && !identityError && unverified ? (
        <p className="mt-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] font-bold text-amber-900" role="status">
          {unverifiedWarning}
        </p>
      ) : null}
      {identity?.kind === "mismatch" ? (
        <p className="mt-2 rounded-xl border-2 border-red-400 bg-red-50 px-3 py-2 text-[11px] font-bold text-red-800" role="alert">
          {IDENTITY_MISMATCH_WARNING}
        </p>
      ) : null}
    </>
  );
}
