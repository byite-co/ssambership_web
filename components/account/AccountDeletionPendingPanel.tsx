import { cancelAccountDeletion } from "@/lib/account/accountDeletionActions";
import { FormSubmitButton } from "@/components/common/FormSubmitButton";
import { canCancelAccountDeletion } from "@/lib/account/accountDeletionJobStates";
import { formatKoreanDate } from "@/lib/utils/formatDisplay";

/**
 * 탈퇴 요청 접수 패널 (W5 §3-5).
 * 웹 즉시 삭제 경로를 폐지하고 saga 요청으로 통합하면서 생긴 화면이다 —
 * 사용자는 취소 창 안에서 요청을 철회할 수 있고, 창이 지나면 되돌릴 수 없다.
 */
export function AccountDeletionPendingPanel(props: {
  state: string;
  cancelableUntil: string | null;
}) {
  const cancelable = canCancelAccountDeletion(props.state, props.cancelableUntil, new Date());
  const untilLabel = props.cancelableUntil ? formatKoreanDate(props.cancelableUntil) : null;

  return (
    <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 shadow-sm">
      <h2 className="text-sm font-extrabold text-amber-900">탈퇴 요청이 접수되었습니다</h2>

      {cancelable ? (
        <>
          <p className="mt-2 text-[13px] leading-relaxed text-amber-900">
            {untilLabel ? (
              <>
                <strong className="font-extrabold">{untilLabel}</strong>까지는 이 화면에서 요청을 취소할 수 있습니다.
                그 이후에는 계정이 잠기고 삭제가 진행되며 되돌릴 수 없습니다.
              </>
            ) : (
              <>아직 취소할 수 있습니다. 취소하지 않으면 계정이 잠기고 삭제가 진행됩니다.</>
            )}
          </p>
          <p className="mt-2 text-[13px] leading-relaxed text-amber-900">
            취소 창 동안에는 계정을 평소처럼 쓸 수 있습니다. 남은 캐시 소멸에 동의했다면, 이 기간에 캐시를 충전할 경우
            동의 금액과 어긋나 삭제가 중단되고 재동의가 필요합니다.
          </p>
          <form action={cancelAccountDeletion} className="mt-4">
            <FormSubmitButton
              idleLabel="탈퇴 요청 취소하기"
              pendingLabel="취소 처리 중…"
              className="w-full rounded-xl border border-amber-300 bg-white px-4 py-3 text-sm font-extrabold text-amber-900 hover:bg-amber-100"
            />
          </form>
        </>
      ) : (
        <p className="mt-2 text-[13px] leading-relaxed text-amber-900">
          취소 가능 시간이 지나 삭제 절차가 진행 중입니다. 이 시점부터는 요청을 되돌릴 수 없으며, 문의는 고객센터로
          부탁드립니다.
        </p>
      )}
    </section>
  );
}
