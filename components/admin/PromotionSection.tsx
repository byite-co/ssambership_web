/**
 * 프로모션 섹션(PR-10 §1-4) — 실사용 0(액션 로그 0건). **접힌 상태로 유지**하고 헤더에 `사용 이력 없음` 을 표시한다. 삭제는 오너 결정 후.
 * 활성 토글은 기존 액션(즉시). 새 프로모션 작성 폼은 두지 않는다. Server Component.
 */
import { ConfirmSubmitButton } from "@/components/admin/ConfirmSubmitButton";
import { StatusBadge } from "@/components/design-system/StatusBadge";
import { toggleAdminNoticeActiveAction } from "@/lib/admin/adminNoticesActions";
import { PROMOTION_EMPTY_LABEL, PROMOTION_NO_USAGE_LABEL, PROMOTION_SECTION_LABEL, formatNoticePeriod, type PromotionListItem } from "@/lib/admin/noticeConsole";

type Props = {
  items: PromotionListItem[];
  error: string | null;
};

const TH = "px-3 py-2 text-left text-[11px] font-black uppercase tracking-wide text-slate-500";
const TD = "px-3 py-2.5 align-top text-xs text-slate-800";

export function PromotionSection({ items, error }: Props) {
  return (
    <details className="rounded-2xl border border-slate-200 bg-white shadow-sm" data-promotion-section>
      <summary className="cursor-pointer list-none px-4 py-3 text-xs font-black text-slate-700 [&::-webkit-details-marker]:hidden">
        {PROMOTION_SECTION_LABEL} · <span className="text-slate-500">{PROMOTION_NO_USAGE_LABEL}</span> · {error ? "조회 실패" : `${items.length}건`}
      </summary>
      <div className="border-t border-slate-100 px-4 py-3">
        <p className="text-[11px] text-slate-500">프로모션 캠페인은 실사용 이력이 없어 접어 두었습니다. 섹션 삭제는 오너 결정 후에 합니다.</p>
        {error ? (
          <p className="mt-2 text-xs font-semibold text-red-800">프로모션 목록을 불러오지 못했습니다.</p>
        ) : items.length === 0 ? (
          <p className="mt-2 text-xs font-semibold text-slate-500">{PROMOTION_EMPTY_LABEL}</p>
        ) : (
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="bg-slate-50/40">
                <tr>
                  <th className={TH}>제목</th>
                  <th className={TH}>기간</th>
                  <th className={TH}>활성</th>
                  <th className={TH}>조치</th>
                </tr>
              </thead>
              <tbody>
                {items.map((p) => (
                  <tr key={p.id} className="border-t border-slate-100">
                    <td className={`${TD} font-bold text-slate-900`}>{p.title}</td>
                    <td className={`${TD} whitespace-nowrap`}>{formatNoticePeriod(p.startsAt, p.endsAt)}</td>
                    <td className={TD}>
                      <StatusBadge label={p.isActive ? "표시 중" : "숨김"} tone={p.isActive ? "success" : "neutral"} size="sm" />
                    </td>
                    <td className={`${TD} whitespace-nowrap`}>
                      <form action={toggleAdminNoticeActiveAction}>
                        <input type="hidden" name="id" value={p.id} />
                        <input type="hidden" name="resource" value="promotion" />
                        <input type="hidden" name="nextActive" value={p.isActive ? "false" : "true"} />
                        <ConfirmSubmitButton
                          level="immediate"
                          confirmLabel={p.isActive ? "비활성화" : "활성화"}
                          pendingLabel="처리 중…"
                          className={
                            p.isActive
                              ? "rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50"
                              : "rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-500"
                          }
                        >
                          {p.isActive ? "비활성화" : "활성화"}
                        </ConfirmSubmitButton>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </details>
  );
}
