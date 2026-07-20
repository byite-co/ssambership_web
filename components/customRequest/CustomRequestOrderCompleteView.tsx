"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { CircleCheck } from "lucide-react";
import { downloadCustomOrderDeliverableAction } from "@/lib/customRequest/orderDeliverableDownloadActions";

export type CustomRequestOrderCompleteViewProps = {
  orderId: string;
  completedAtLabel: string;
  summary: {
    mentorName: string;
    requestTitle: string;
    finalAmountLabel: string;
    durationLabel: string;
    completedDateLabel: string;
    deadlineLabel: string;
  };
  deliverable: {
    id: string;
    fileName: string;
    sizeLabel: string;
    downloadable: boolean;
  } | null;
  payment: {
    amountLabel: string;
    feeLabel: string;
    paidAtLabel: string;
  };
  review: {
    eligible: boolean;
    tooltip: string;
    href: string;
  };
};

function SummaryItem(props: { label: string; value: string; accent?: boolean }) {
  return (
    <div>
      <dt className="text-xs font-bold text-slate-500">{props.label}</dt>
      <dd
        className={`mt-0.5 text-sm font-extrabold ${props.accent ? "text-[#2563EB]" : "text-slate-900"}`}
      >
        {props.value}
      </dd>
    </div>
  );
}

function ActionButton(props: {
  href?: string;
  disabled?: boolean;
  tooltip?: string;
  variant?: "primary" | "secondary";
  children: ReactNode;
}) {
  const base =
    "inline-flex min-h-[48px] w-full items-center justify-center rounded-xl px-4 text-sm font-extrabold transition";
  const styles =
    props.variant === "secondary"
      ? "border-2 border-[#2563EB] bg-white text-[#2563EB] hover:bg-blue-50/40"
      : "bg-[#2563EB] text-white hover:bg-[#1D4ED8]";

  if (props.href && !props.disabled) {
    return (
      <Link href={props.href} className={`${base} ${styles}`}>
        {props.children}
      </Link>
    );
  }

  return (
    <span className="relative block w-full" title={props.tooltip}>
      <button type="button" disabled className={`${base} ${styles} cursor-not-allowed opacity-50`}>
        {props.children}
      </button>
    </span>
  );
}

export function CustomRequestOrderCompleteView(props: CustomRequestOrderCompleteViewProps) {
  const { orderId, completedAtLabel, summary, deliverable, payment, review } = props;

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <header className="rounded-2xl border-[0.5px] border-slate-200 bg-white p-6 text-center shadow-sm sm:p-8">
        {/* 완료/성공 의미색은 체크 아이콘에만 — 배너 전체를 초록으로 칠하지 않음 */}
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
          <CircleCheck className="h-7 w-7" strokeWidth={2} aria-hidden />
        </span>
        <h1 className="mt-4 text-2xl font-black text-slate-900 sm:text-3xl">주문이 완료되었습니다</h1>
        <p className="mt-2 text-sm font-medium text-slate-600">완료 일시 · {completedAtLabel}</p>
      </header>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <h2 className="text-lg font-black text-slate-900">주문 요약</h2>
        <dl className="mt-4 grid gap-3 sm:grid-cols-2">
          <SummaryItem label="선택 멘토" value={summary.mentorName} />
          <SummaryItem label="요청 제목" value={summary.requestTitle} />
          <SummaryItem label="최종 금액" value={summary.finalAmountLabel} accent />
          <SummaryItem label="완료일" value={summary.completedDateLabel} />
          <SummaryItem label="마감일" value={summary.deadlineLabel} />
        </dl>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <h2 className="text-lg font-black text-slate-900">납품 파일</h2>
        {deliverable ? (
          <div className="mt-4 flex flex-col gap-4 rounded-xl border border-slate-100 bg-slate-50/80 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="truncate text-sm font-extrabold text-slate-900">{deliverable.fileName}</p>
              <p className="mt-1 text-xs font-medium text-slate-500">{deliverable.sizeLabel}</p>
            </div>
            {deliverable.downloadable ? (
              <form action={downloadCustomOrderDeliverableAction}>
                <input type="hidden" name="orderId" value={orderId} />
                <input type="hidden" name="deliverableId" value={deliverable.id} />
                <button
                  type="submit"
                  className="inline-flex min-h-[44px] items-center justify-center rounded-xl bg-[#2563EB] px-4 text-sm font-extrabold text-white hover:bg-[#1D4ED8]"
                >
                  다운로드
                </button>
              </form>
            ) : (
              <p className="text-xs font-medium text-slate-500">파일 준비 중이에요.</p>
            )}
          </div>
        ) : (
          <p className="mt-3 text-sm font-medium text-slate-600">등록된 납품 파일이 없어요.</p>
        )}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <h2 className="text-lg font-black text-slate-900">결제 정보</h2>
        <dl className="mt-4 space-y-3 text-sm">
          {/* F4: 학생은 전액 결제 — 수수료는 멘토 정산 측 공제이므로 학생 영수증에서 제외(IQ 영수증과 동일 규칙). */}
          <div className="flex justify-between gap-4">
            <dt className="font-bold text-slate-500">결제 금액</dt>
            <dd className="font-extrabold text-slate-900">{payment.amountLabel}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="font-bold text-slate-500">지급 완료 일시</dt>
            <dd className="font-extrabold text-slate-900">{payment.paidAtLabel}</dd>
          </div>
        </dl>
        {/* P2-28: 영수증 조회 기능 미구현 → 무동작 대신 명시적 disabled + 사유. */}
        <button
          type="button"
          disabled
          aria-disabled="true"
          title="영수증 조회 기능은 준비 중이에요."
          className="mt-4 inline-flex min-h-[40px] cursor-not-allowed items-center justify-center rounded-lg border border-slate-200 bg-slate-50 px-4 text-sm font-extrabold text-slate-400"
        >
          결제 영수증 보기 (준비 중)
        </button>
      </section>

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <ActionButton
          href={review.eligible ? review.href : undefined}
          disabled={!review.eligible}
          tooltip={review.eligible ? undefined : review.tooltip}
        >
          이용 후기 작성하기
        </ActionButton>
        <ActionButton href="/custom-request" variant="secondary">
          다른 맞춤의뢰 진행하기
        </ActionButton>
        <ActionButton href="/question-room" variant="secondary">
          질문방 이용하기
        </ActionButton>
      </section>
    </div>
  );
}
