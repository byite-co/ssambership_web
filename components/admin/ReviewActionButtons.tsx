/**
 * 리뷰 조치 버튼(PR-11 §2-3) — 구 `AdminReviewsTable`·상세의 1클릭 버튼을 `ConfirmSubmitButton(stateChange)` 으로 바꾼 것. 서버 액션(`moderateAdminReviewAction`)과
 * 필드명(`reviewId` · `action`)은 그대로다. 유효 상태별 가능한 조치만 그린다(`reviewAvailableActions`). 삭제 조치는 없다(경로 없음 — `REVIEW_DELETE_UNAVAILABLE_NOTE`).
 * Server Component — 폼 + 클라이언트 확인 버튼.
 */
import { ConfirmSubmitButton } from "@/components/admin/ConfirmSubmitButton";
import { moderateAdminReviewAction } from "@/lib/admin/adminReviewActions";
import {
  REVIEW_ACTIONS,
  REVIEW_ACTION_FIELD,
  REVIEW_ID_FIELD,
  REVIEW_RETURN_TO_FIELD,
  reviewAvailableActions,
  type ReviewActionKey,
  type ReviewState,
} from "@/lib/admin/reviewConsole";

type Props = {
  reviewId: string;
  state: ReviewState;
  /** 처리 후 돌아올 경로(상세·목록) */
  returnTo: string;
  details?: { label: string; value: string }[];
};

const BUTTON = "inline-flex h-9 items-center justify-center rounded-lg px-3 text-xs font-bold text-white transition disabled:cursor-not-allowed disabled:opacity-60";
const TONE: Readonly<Record<ReviewActionKey, string>> = {
  hide: "bg-slate-700 hover:bg-slate-800",
  blind: "bg-red-600 hover:bg-red-700",
  restore: "bg-blue-600 hover:bg-blue-700",
  review: "bg-emerald-600 hover:bg-emerald-700",
};

export function ReviewActionButtons({ reviewId, state, returnTo, details }: Props) {
  const available = reviewAvailableActions(state);
  return (
    <div className="flex flex-wrap gap-2" data-review-actions={reviewId}>
      {available.map((key) => {
        const def = REVIEW_ACTIONS[key];
        return (
          <form action={moderateAdminReviewAction} className="inline" key={key}>
            <input type="hidden" name={REVIEW_ID_FIELD} value={reviewId} />
            <input type="hidden" name={REVIEW_ACTION_FIELD} value={key} />
            <input type="hidden" name={REVIEW_RETURN_TO_FIELD} value={returnTo} />
            <ConfirmSubmitButton
              level="stateChange"
              summary={def.summary}
              details={details}
              dialogTitle={def.dialogTitle}
              confirmLabel={def.confirmLabel}
              pendingLabel={def.pendingLabel}
              className={`${BUTTON} ${TONE[key]}`}
            >
              {def.label}
            </ConfirmSubmitButton>
          </form>
        );
      })}
    </div>
  );
}
