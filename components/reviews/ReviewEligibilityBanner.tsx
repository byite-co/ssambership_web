import { REVIEW_REQUIRED_PAID_COUNT, type ReviewEligibilityMode } from "@/lib/reviews/reviewEligibilityPolicy";

type Props = {
  /** null이면 자격 정보를 불러오지 못한 상태 */
  eligibilityKnown: boolean;
  eligible: boolean;
  /** 'create' = 신규 작성 · 'edit' = 기존 후기 수정 */
  mode?: ReviewEligibilityMode;
  /** mode==='edit' 이어도 모더레이션된 후기는 수정 불가 */
  canEdit?: boolean;
  /** 208: 같은 멘토 결제 성공 누적 횟수(서버 응답) — 미충족 안내 "현재 N/2" */
  paidCount?: number | null;
  requiredCount?: number;
};

export function ReviewEligibilityBanner(props: Props) {
  const required = props.requiredCount ?? REVIEW_REQUIRED_PAID_COUNT;
  if (!props.eligibilityKnown) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50/90 px-4 py-3 text-xs font-medium leading-relaxed text-amber-950">
        <p className="font-extrabold">후기 작성 자격</p>
        <p className="mt-1">
          같은 멘토에게 <strong>{required}회 결제(구독 시작 + 갱신)</strong>한 학생만 후기를 남길 수 있어요. 지금은 자격을
          확인하지 못해 작성 폼이 비활성화됩니다.
        </p>
      </div>
    );
  }

  if (!props.eligible) {
    const paid = Math.max(0, props.paidCount ?? 0);
    return (
      <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs font-medium text-slate-800">
        <p className="font-extrabold">후기를 작성할 수 없습니다</p>
        <p className="mt-1">
          같은 멘토에게 {required}회 결제하면 후기를 남길 수 있어요 (현재 {paid}/{required}). 개별 질문 결제는 세지 않아요.
        </p>
      </div>
    );
  }

  if (props.mode === "edit" && props.canEdit === false) {
    return (
      <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs font-medium text-slate-800">
        <p className="font-extrabold">지금은 후기를 수정할 수 없습니다</p>
        <p className="mt-1">검토 중인 후기라 지금은 수정할 수 없습니다.</p>
      </div>
    );
  }

  if (props.mode === "edit") {
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50/80 px-4 py-3 text-xs font-semibold text-emerald-950">
        이미 작성한 후기가 있습니다. 별점과 내용을 수정할 수 있어요.
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-emerald-200 bg-emerald-50/80 px-4 py-3 text-xs font-semibold text-emerald-950">
      후기 작성 조건을 충족한 것으로 표시됩니다. 아래에서 내용을 작성해 주세요.
    </div>
  );
}
