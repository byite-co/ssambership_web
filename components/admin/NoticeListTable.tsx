/**
 * 공지·이벤트 표(PR-10 §1-2) — 제목 · 유형 · 대상 · 노출 방식 · 기간 · 활성 · 수정. Server Component.
 *
 * - 노출 방식 배지: `목록` / **`팝업`은 눈에 띄게**(전원에게 뜨는 것이다 — 주황 테두리).
 * - 활성 토글은 기존 액션(`toggleAdminNoticeActiveAction`). **팝업 공지의 활성화만 `stateChange` 확인**(summary `이 공지가 팝업으로 전체 사용자에게 표시됩니다.`) ·
 *   목록 공지·비활성화는 즉시(`immediate` — 버튼 그대로).
 * - 기간이 지난 활성 공지는 `만료됨`, 시작 전이면 `예정`.
 */
import Link from "next/link";
import { AdminDataTable } from "@/components/admin/AdminDataTable";
import { AdminStatusPill } from "@/components/admin/AdminStatusPill";
import { ConfirmSubmitButton } from "@/components/admin/ConfirmSubmitButton";
import { StatusBadge } from "@/components/design-system/StatusBadge";
import type { DsStatusTone } from "@/lib/design-system/statusBadge";
import type { AdminListParams } from "@/lib/admin/adminListParams";
import { toggleAdminNoticeActiveAction } from "@/lib/admin/adminNoticesActions";
import {
  NOTICE_BASE_PATH,
  NOTICE_DISPLAY_MODE_BADGE,
  NOTICE_EXPOSURE_LABELS,
  NOTICE_POPUP_ACTIVATE_SUMMARY,
  formatNoticePeriod,
  noticeEditUrl,
  noticeExposureState,
  noticeToggleConfirmLevel,
  type NoticeExposureState,
  type NoticeListItem,
} from "@/lib/admin/noticeConsole";
import { cn } from "@/lib/utils/cn";

type Props = {
  items: NoticeListItem[];
  params: AdminListParams;
  totalCount: number;
  /** 서버 렌더 시각(ISO) — 만료·예정 판정 기준 */
  nowIso: string;
};

const TH = "px-3 py-2 text-left text-[11px] font-black uppercase tracking-wide text-slate-500";
const TD = "px-3 py-2.5 align-top text-xs text-slate-800";
const TOGGLE_ON = "rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50";
const TOGGLE_OFF = "rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-500";

const EXPOSURE_TONE: Record<NoticeExposureState, DsStatusTone> = {
  active: "success",
  expired: "warning",
  scheduled: "info",
  inactive: "neutral",
};

export function NoticeListTable({ items, params, totalCount, nowIso }: Props) {
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm" data-notice-table>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[960px] text-sm">
          <thead className="bg-slate-50/40">
            <tr>
              <th className={TH}>제목</th>
              <th className={TH}>유형</th>
              <th className={TH}>대상</th>
              <th className={TH}>노출 방식</th>
              <th className={TH}>기간</th>
              <th className={TH}>활성</th>
              <th className={TH}>수정</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it) => {
              const exposure = noticeExposureState(it, nowIso);
              const nextActive = !it.isActive;
              const level = noticeToggleConfirmLevel(it.displayMode, nextActive);
              const toggleLabel = nextActive ? "활성화" : "비활성화";
              return (
                <tr key={it.id} className="border-t border-slate-100 hover:bg-slate-50/60" data-notice-row={it.id} data-display-mode={it.displayMode}>
                  <td className={cn(TD, "max-w-[280px]")}>
                    <Link href={noticeEditUrl(it.id)} className="line-clamp-2 font-extrabold text-slate-900 hover:underline" prefetch={false}>
                      {it.title}
                    </Link>
                  </td>
                  <td className={TD}>
                    <AdminStatusPill table="app_notices" column="type" value={it.typeRaw} />
                  </td>
                  <td className={TD}>
                    <AdminStatusPill table="app_notices" column="target" value={it.target} />
                  </td>
                  <td className={cn(TD, "whitespace-nowrap")}>
                    {it.displayMode === "popup" ? (
                      <span
                        className="inline-flex items-center rounded-md border-2 border-[#F59E0B] bg-amber-50 px-2 py-0.5 text-[11px] font-black text-amber-900"
                        title="접속 시 전체 사용자에게 모달로 표시됩니다"
                        data-notice-popup-badge
                      >
                        {NOTICE_DISPLAY_MODE_BADGE.popup}
                      </span>
                    ) : (
                      <span className="inline-flex items-center rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-bold text-slate-600">
                        {NOTICE_DISPLAY_MODE_BADGE.page}
                      </span>
                    )}
                  </td>
                  <td className={cn(TD, "whitespace-nowrap")}>
                    <p className="text-slate-700">{formatNoticePeriod(it.startsAt, it.endsAt)}</p>
                    <StatusBadge label={NOTICE_EXPOSURE_LABELS[exposure]} tone={EXPOSURE_TONE[exposure]} size="sm" className="mt-1" />
                  </td>
                  <td className={cn(TD, "whitespace-nowrap")}>
                    <form action={toggleAdminNoticeActiveAction} className="flex items-center gap-2">
                      <input type="hidden" name="id" value={it.id} />
                      <input type="hidden" name="resource" value="notice" />
                      <input type="hidden" name="nextActive" value={nextActive ? "true" : "false"} />
                      {level === "stateChange" ? (
                        <ConfirmSubmitButton
                          level="stateChange"
                          summary={NOTICE_POPUP_ACTIVATE_SUMMARY}
                          dialogTitle="팝업 공지 활성화"
                          confirmLabel="활성화"
                          pendingLabel="처리 중…"
                          className={TOGGLE_OFF}
                        >
                          {toggleLabel}
                        </ConfirmSubmitButton>
                      ) : (
                        <ConfirmSubmitButton level="immediate" confirmLabel={toggleLabel} pendingLabel="처리 중…" className={it.isActive ? TOGGLE_ON : TOGGLE_OFF}>
                          {toggleLabel}
                        </ConfirmSubmitButton>
                      )}
                    </form>
                  </td>
                  <td className={cn(TD, "whitespace-nowrap")}>
                    <Link href={noticeEditUrl(it.id)} className="text-xs font-bold text-blue-700 hover:underline" prefetch={false}>
                      수정
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <AdminDataTable.Pagination basePath={NOTICE_BASE_PATH} params={params} totalCount={totalCount} rowsOnPage={items.length} className="border-t border-slate-100 px-4 py-3" />
    </div>
  );
}
