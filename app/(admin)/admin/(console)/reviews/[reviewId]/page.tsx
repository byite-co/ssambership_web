import Link from "next/link";
import type { ReactNode } from "react";
import { AdminPageLayout } from "@/components/admin/AdminPageLayout";
import { AdminStatusPill } from "@/components/admin/AdminStatusPill";
import { ReviewActionButtons } from "@/components/admin/ReviewActionButtons";
import { EmptyState } from "@/components/common/EmptyState";
import { StatusBadge } from "@/components/design-system/StatusBadge";
import { accountDetailPath } from "@/lib/admin/accountDetailConsole";
import { toAdminDisplayError } from "@/lib/admin/adminDisplayError";
import { loadReviewDetail } from "@/lib/admin/adminReviewQueries";
import { contentReportDetailPath } from "@/lib/admin/contentReportConsole";
import {
  REVIEW_BASE_PATH,
  REVIEW_DELETE_UNAVAILABLE_NOTE,
  REVIEW_ELIGIBILITY_LABELS,
  REVIEW_ELIGIBILITY_RULE,
  REVIEW_TABLE,
  reviewDetailPath,
  reviewFlashOkMessage,
  reviewRatingLabel,
} from "@/lib/admin/reviewConsole";
import { requireRole } from "@/lib/auth/routeGuard";
import { createClient } from "@/lib/supabase/server";
import { formatKoDateTimeKst } from "@/lib/utils/kstTime";

type Props = { params: Promise<{ reviewId: string }>; searchParams?: Promise<Record<string, string | string[] | undefined>> };

const ACTION_LINK = "rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-extrabold text-slate-700 hover:bg-slate-50";
const CARD = "rounded-2xl border border-slate-200 bg-white p-5 shadow-sm";
const TH = "px-3 py-2 text-left text-[11px] font-black uppercase tracking-wide text-slate-500";
const TD = "px-3 py-2 align-top text-xs text-slate-800";

function pick(value: string | string[] | undefined): string {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value) && typeof value[0] === "string") return value[0].trim();
  return "";
}

function Row(props: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-slate-100 py-1.5 text-xs last:border-b-0">
      <dt className="shrink-0 font-bold text-slate-500">{props.label}</dt>
      <dd className="min-w-0 text-right font-semibold text-slate-900">{props.children}</dd>
    </div>
  );
}

/**
 * 관리자 · 리뷰 상세(PR-11 §2-2) — 전문 · 멘토 · 작성자 · 결제 이력(후기 작성 조건) · 신고 이력 · 처리 이력(`moderated_by` + 감사 로그) · 조치(확인 절차).
 * 구 화면의 JSON 덤프·소문자 액션 버튼을 대체한다. 조치는 기존 `moderateAdminReviewAction` 한 경로. 삭제 조치 없음(경로 없음).
 */
export default async function AdminReviewDetailPage(props: Props) {
  await requireRole("admin");
  const { reviewId } = await props.params;
  const sp = (await props.searchParams) ?? {};
  const flashOk = reviewFlashOkMessage(pick(sp.ok));
  const flashErrRaw = pick(sp.error) || null;
  const flashErr = flashErrRaw ? (toAdminDisplayError(flashErrRaw, "reviews") ?? "처리에 실패했습니다. 잠시 후 다시 시도해 주세요.") : null;

  const supabase = await createClient();
  const { detail, error } = await loadReviewDetail(supabase, reviewId);
  const returnTo = reviewDetailPath(reviewId);

  return (
    <AdminPageLayout
      title="리뷰 상세"
      description={`리뷰 본문과 작성 근거(결제 이력)·신고·처리 이력을 확인하고 조치합니다. ${REVIEW_DELETE_UNAVAILABLE_NOTE}`}
      actions={
        <Link href={REVIEW_BASE_PATH} className={ACTION_LINK} prefetch={false}>
          ← 리뷰 목록
        </Link>
      }
    >
      {flashOk ? (
        <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-900">
          {flashOk}
        </p>
      ) : null}
      {flashErr ? (
        <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-900">
          처리 실패 — {flashErr}
        </p>
      ) : null}

      {error ? (
        <div role="alert" className="rounded-2xl border border-red-200 bg-red-50/60 p-5 text-sm text-red-950">
          <p className="font-bold">리뷰를 불러오지 못했습니다.</p>
          <p className="mt-1 text-xs text-red-900/90">{toAdminDisplayError(error, "reviews") ?? "잠시 후 다시 시도해 주세요."}</p>
        </div>
      ) : !detail ? (
        <EmptyState title="리뷰를 찾을 수 없습니다" description="삭제되었거나 잘못된 주소입니다. 격리 보관함에 있을 수 있습니다.">
          <Link href={`${REVIEW_BASE_PATH}?status=quarantine`} className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50" prefetch={false}>
            격리 보관함 보기
          </Link>
        </EmptyState>
      ) : (
        <div className="space-y-4" data-review-detail={detail.id}>
          <section className={CARD} data-review-body>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-lg font-black tabular-nums text-slate-900">{reviewRatingLabel(detail.rating)}</span>
                <AdminStatusPill table={REVIEW_TABLE} column="moderation_state" value={detail.state} size="sm" />
              </div>
              <p className="font-mono text-[11px] text-slate-400">{detail.id}</p>
            </div>
            <p className="mt-3 whitespace-pre-line text-sm leading-6 text-slate-800">{detail.body || "—"}</p>
            <dl className="mt-4">
              <Row label="작성일">{formatKoDateTimeKst(detail.createdAt)}</Row>
              <Row label="수정일">{formatKoDateTimeKst(detail.updatedAt)}</Row>
              <Row label="대상 멘토">
                {detail.mentorId ? (
                  <Link href={accountDetailPath(detail.mentorId)} className="hover:underline" prefetch={false}>
                    {detail.mentorName}
                  </Link>
                ) : (
                  detail.mentorName
                )}
              </Row>
              <Row label="작성자">
                {detail.authorId ? (
                  <Link href={accountDetailPath(detail.authorId)} className="hover:underline" prefetch={false}>
                    {detail.authorName}
                  </Link>
                ) : (
                  detail.authorName
                )}
              </Row>
              <Row label="작성 시 결제 횟수(subscription_count)">{detail.subscriptionCount ?? "—"}</Row>
            </dl>
            {detail.mentorReply ? (
              <div className="mt-4 rounded-xl border border-slate-100 bg-slate-50/70 px-3 py-2">
                <p className="text-[11px] font-black text-slate-500">멘토 답글 · {formatKoDateTimeKst(detail.mentorRepliedAt)}</p>
                <p className="mt-1 whitespace-pre-line text-sm text-slate-800">{detail.mentorReply}</p>
              </div>
            ) : null}
          </section>

          <section className={CARD} data-review-actions-section>
            <h2 className="text-base font-black text-slate-900">조치</h2>
            <p className="mt-1 text-xs text-slate-500">숨김·블라인드·복원·검토 완료 — 모두 확인 절차를 거칩니다. 처리한 관리자·시각은 리뷰 행(moderated_by)에 기록됩니다.</p>
            <div className="mt-3">
              <ReviewActionButtons reviewId={detail.id} state={detail.state} returnTo={returnTo} details={[{ label: "대상", value: `${detail.mentorName} 멘토 리뷰 · ${reviewRatingLabel(detail.rating)}` }]} />
            </div>
          </section>

          <section className={CARD} data-review-payments>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-base font-black text-slate-900">결제 이력</h2>
              <StatusBadge
                label={`후기 작성 조건 ${REVIEW_ELIGIBILITY_LABELS[detail.payments.eligibility]}`}
                tone={detail.payments.eligibility === "eligible" ? "success" : detail.payments.eligibility === "ineligible" ? "danger" : "neutral"}
                size="sm"
              />
            </div>
            <p className="mt-1 text-xs text-slate-500">후기 작성 조건 = {REVIEW_ELIGIBILITY_RULE}. 판정은 DB 함수 값 그대로입니다.</p>
            {detail.payments.error ? <p className="mt-2 text-xs font-bold text-amber-800">결제 이력 일부를 불러오지 못했습니다.</p> : null}
            <p className="mt-3 text-xs font-bold text-slate-700">
              성공한 구독 결제 이벤트 <span className="tabular-nums text-slate-900">{detail.payments.succeededBillingCount ?? "—"}</span>건
            </p>
            {detail.payments.subscriptions.length === 0 ? (
              <p className="mt-2 text-sm font-semibold text-slate-500">이 작성자와 멘토 사이의 구독 행이 없습니다.</p>
            ) : (
              <div className="mt-2 overflow-x-auto">
                <table className="w-full min-w-[560px] text-sm">
                  <thead className="bg-slate-50/60">
                    <tr>
                      <th className={TH}>구독</th>
                      <th className={TH}>요금제</th>
                      <th className={TH}>상태</th>
                      <th className={TH}>시작</th>
                      <th className={TH}>현재 기간 종료</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.payments.subscriptions.map((s) => (
                      <tr key={s.id} className="border-t border-slate-100">
                        <td className={`${TD} font-mono text-[11px]`}>{s.id.slice(0, 8)}…</td>
                        <td className={TD}>{s.planTier ?? "—"}</td>
                        <td className={TD}>
                          <AdminStatusPill table="subscriptions" column="status" value={s.status} size="sm" />
                        </td>
                        <td className={`${TD} whitespace-nowrap tabular-nums`}>{formatKoDateTimeKst(s.startedAt)}</td>
                        <td className={`${TD} whitespace-nowrap tabular-nums`}>{formatKoDateTimeKst(s.currentPeriodEnd)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className={CARD} data-review-reports>
            <h2 className="text-base font-black text-slate-900">신고 이력 {detail.reports.rows.length}건</h2>
            {detail.reports.error ? <p className="mt-2 text-xs font-bold text-amber-800">신고 이력을 불러오지 못했습니다.</p> : null}
            {detail.reports.rows.length === 0 ? (
              <p className="mt-2 text-sm font-semibold text-slate-500">이 리뷰에 대한 신고가 없습니다.</p>
            ) : (
              <ul className="mt-2 divide-y divide-slate-100 text-sm">
                {detail.reports.rows.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <span className="min-w-0">
                      <Link href={contentReportDetailPath(r.id)} className="font-bold text-slate-900 hover:underline" prefetch={false}>
                        {r.reason || "사유 없음"}
                      </Link>
                      <span className="ml-2 text-xs text-slate-500">신고자 {r.reporterName}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      <AdminStatusPill table="content_reports" column="status" value={r.status} size="sm" />
                      <span className="text-xs tabular-nums text-slate-500">{formatKoDateTimeKst(r.createdAt)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className={CARD} data-review-logs>
            <h2 className="text-base font-black text-slate-900">처리 이력</h2>
            <dl className="mt-2">
              <Row label="마지막 처리(moderated_by)">{detail.moderatedBy ? `${detail.moderatedByName ?? detail.moderatedBy.slice(0, 8)} · ${formatKoDateTimeKst(detail.moderatedAt)}` : "—"}</Row>
              <Row label="moderation_state">{detail.moderationState ?? "—"}</Row>
              <Row label="is_hidden · is_blinded">{`${detail.isHidden ? "true" : "false"} · ${detail.isBlinded ? "true" : "false"}`}</Row>
            </dl>
            {detail.logs.error ? <p className="mt-2 text-xs font-bold text-amber-800">감사 로그를 불러오지 못했습니다.</p> : null}
            {detail.logs.rows.length === 0 ? (
              <p className="mt-3 text-sm font-semibold text-slate-500">감사 로그에 기록된 조치가 없습니다.</p>
            ) : (
              <ul className="mt-3 divide-y divide-slate-100 text-sm">
                {detail.logs.rows.map((l) => (
                  <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <span className="min-w-0">
                      <span className="font-bold text-slate-900" title={l.actionRaw}>
                        {l.actionLabel}
                      </span>
                      <span className="ml-2 text-xs text-slate-500">{l.adminName}</span>
                      {l.reason ? <span className="ml-2 text-xs text-slate-500">· {l.reason}</span> : null}
                    </span>
                    <span className="shrink-0 text-xs tabular-nums text-slate-500">{formatKoDateTimeKst(l.createdAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </AdminPageLayout>
  );
}
