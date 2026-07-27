import type { ReviewEligibilityMode } from "@/lib/reviews/reviewEligibilityPolicy";

type Props = {
  /** null이면 자격 정보를 불러오지 못한 상태 */
  eligibilityKnown: boolean;
  eligible: boolean;
  /** 'create' = 신규 작성 · 'edit' = 기존 후기 수정 */
  mode?: ReviewEligibilityMode;
  /** mode==='edit' 이어도 모더레이션된 후기는 수정 불가 */
  canEdit?: boolean;
};

export function ReviewEligibilityBanner(props: Props) {
  if (!props.eligibilityKnown) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50/90 px-4 py-3 text-xs font-medium leading-relaxed text-amber-950">
        <p className="font-extrabold">후기 작성 자격</p>
        <p className="mt-1">
          해당 멘토를 <strong>구독했거나 개별 질문을 이용한 이력</strong>이 있는 경우에만 후기 작성이 가능합니다. 현재
          자격을 계산하는 쿼리가 연결되어 있지 않아 작성 폼은 비활성화됩니다.
        </p>
        <ul className="mt-2 list-inside list-disc text-amber-900/90">
          <li>구독을 시작하지 않은 경우 작성 불가</li>
          <li>답변이 완료되지 않은 개별 질문만 있는 경우 작성 불가</li>
        </ul>
      </div>
    );
  }

  if (!props.eligible) {
    return (
      <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs font-medium text-slate-800">
        <p className="font-extrabold">후기를 작성할 수 없습니다</p>
        <p className="mt-1">이 멘토의 구독 또는 개별 질문 이용 이력이 있는 학생만 후기를 남길 수 있어요.</p>
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
