import { AlertTriangle, CheckCircle2, ChevronRight, Pencil, Play, XCircle } from "lucide-react";
import { PendingSubmitButton } from "@/components/customRequest/order/PendingSubmitButton";
import { startCustomOrderWorkAction } from "@/lib/customRequest/orderMentorActions";
import {
  acceptCustomOrderDeliverableAction,
  cancelCustomOrderByStudentAction,
} from "@/lib/customRequest/orderStudentActions";
import {
  ORDER_ROOM_CARD_CLASS,
  ORDER_ROOM_TERMINAL_MENTOR_NOTICE,
  ORDER_ROOM_TERMINAL_STUDENT_NOTICE,
} from "@/lib/customRequest/orderLifecycleConstants";
import type { AppRole } from "@/lib/types/user";

const cardPrimary =
  "flex w-full items-center justify-between gap-3 rounded-xl border px-4 py-3 text-left shadow-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40";
const subtleLinkBar =
  "flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm font-semibold text-slate-700 transition hover:bg-slate-50";
const mutedLink =
  `${subtleLinkBar} opacity-55 cursor-not-allowed hover:bg-transparent`;

// 납품 수락 — 학생의 가장 중요한 결정. 연한 카드 대신 채움형 primary(파랑) hero로 강조(시각만, 동작·가드 미터치).
const studentAcceptHero =
  "flex w-full items-center justify-between gap-3 rounded-2xl bg-[#2563EB] px-5 py-4 text-left text-white shadow-[0_6px_16px_rgba(37,99,235,0.28)] ring-1 ring-blue-700/10 transition-colors hover:bg-[#1D4ED8] disabled:cursor-not-allowed disabled:opacity-50";
// 분쟁 진행중 상태 알림 — 정의되지 않은 주황 대신 중립(secondary) 회색 보더로 통일
const orangeNoticeCard = `${cardPrimary} border-slate-300 bg-slate-50 text-slate-800 hover:bg-slate-100`;

/** 분쟁 신청 진입 — 보조(밑줄 위주). 주 액션과 시각 역할 분리 */
const disputeSubtleHref = `${subtleLinkBar} text-red-900/95 hover:underline`;

type Props = {
  view: "student" | "mentor";
  actorRole: AppRole;
  orderId: string;
  /** 종료·완료 주문: 진행성 액션 전부 숨기고 안내만 */
  orderTerminal?: boolean;
  studentAcceptDisabledReason: string | null;
  mentorStartDisabledReason: string | null;
  studentRevisionRequestDisabledReason: string | null;
  studentCancelDisabledReason: string | null;
  openDisputeApplicationDisabledReason: string | null;
  hasActiveDispute?: boolean;
  mentorRevisionJumpDisabledReason?: string | null;
  embedded?: boolean;
};

function Chevr() {
  return <ChevronRight className="h-4 w-4 shrink-0 opacity-60" aria-hidden />;
}

export function OrderActionBar(props: Props) {
  if (props.view === "mentor") {
    return <OrderActionBarMentor {...props} />;
  }
  const {
    view,
    actorRole,
    orderId,
    orderTerminal = false,
    studentAcceptDisabledReason,
    studentRevisionRequestDisabledReason,
    studentCancelDisabledReason,
    openDisputeApplicationDisabledReason,
    hasActiveDispute = false,
    embedded = false,
  } = props;

  if (orderTerminal) {
    const notice =
      view === "student" && actorRole === "student"
        ? ORDER_ROOM_TERMINAL_STUDENT_NOTICE
        : "이 주문은 완료되어 추가 작업이 제한됩니다.";
    return (
      <div className={embedded ? "space-y-2" : ORDER_ROOM_CARD_CLASS} role="status" aria-label="주문 완료 안내">
        {!embedded ? <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">작업 관리</p> : null}
        <p className="mt-2 text-sm font-semibold text-slate-900">추가 작업 없음</p>
        <p className="mt-1 text-sm leading-relaxed text-slate-700">{notice}</p>
      </div>
    );
  }

  const canStudentAccept =
    actorRole === "student" && view === "student" && !studentAcceptDisabledReason && orderId.trim().length > 0;
  const canStudentRevisionJumps =
    actorRole === "student" && view === "student" && !studentRevisionRequestDisabledReason && orderId.trim().length > 0;
  const canStudentCancel =
    actorRole === "student" && view === "student" && !studentCancelDisabledReason && orderId.trim().length > 0;
  const canDisputeJump =
    (actorRole === "student" || actorRole === "mentor") &&
    !hasActiveDispute &&
    !openDisputeApplicationDisabledReason &&
    orderId.trim().length > 0;

  const studentPrimaryAccepts = Boolean(canStudentAccept);

  return (
    <div className={embedded ? "w-full space-y-3" : `${ORDER_ROOM_CARD_CLASS} w-full`} role="group" aria-label="주문 액션">
      {!embedded ? (
        <>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">작업 관리</p>
          <p className="mt-0.5 text-xs text-slate-500">
            현재 단계에서 꼭 눌러야 할 작업 하나를 위에 두고, 나머지는 바로 아래 텍스트 링크로 모았습니다.
          </p>
        </>
      ) : null}

      <div className={embedded ? "flex flex-col gap-2" : "mt-4 flex flex-col gap-2"}>
        {!embedded && hasActiveDispute ? (
          <a href="#order-disputes" className={orangeNoticeCard}>
            <span className="flex min-w-0 items-start gap-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <span>
                <span className="block text-sm font-bold">해결 요청 상태 보기</span>
                <span className="mt-0.5 block text-xs font-normal opacity-90">검토 현황을 확인합니다.</span>
              </span>
            </span>
            <Chevr />
          </a>
        ) : null}

        {view === "student" && actorRole === "student" && studentPrimaryAccepts ? (
          <form action={acceptCustomOrderDeliverableAction} className="w-full">
            <input type="hidden" name="orderId" value={orderId} />
            <PendingSubmitButton
              className={studentAcceptHero}
              pendingChildren={
                <span className="flex min-w-0 items-start gap-3">
                  <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" />
                  <span>
                    <span className="block text-base font-extrabold">수락 처리 중…</span>
                    <span className="mt-0.5 block text-xs font-normal opacity-90">잠시만 기다려 주세요.</span>
                  </span>
                </span>
              }
            >
              <span className="flex min-w-0 items-start gap-3">
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" />
                <span>
                  <span className="block text-base font-extrabold">수락하고 완료하기</span>
                  <span className="mt-0.5 block text-xs font-normal opacity-90">납품이 만족스러우면 수락해 주세요. 수락하면 정산돼요.</span>
                </span>
              </span>
              <ChevronRight className="h-5 w-5 shrink-0 opacity-80" aria-hidden />
            </PendingSubmitButton>
          </form>
        ) : null}
      </div>

      <div className={embedded ? "space-y-0.5" : "mt-3 space-y-0.5 border-t border-slate-100 pt-3"}>
        {!embedded ? <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">추가 링크</p> : null}
        {view === "student" && actorRole === "student" && !studentPrimaryAccepts ? (
          <p className="py-1 text-xs text-slate-500" title={studentAcceptDisabledReason ?? undefined}>
            납품 수락은 지금 단계에서 사용할 수 없어요.
          </p>
        ) : null}
        {view === "student" && actorRole === "student" && canStudentCancel ? (
          <form action={cancelCustomOrderByStudentAction} className="w-full">
            <input type="hidden" name="orderId" value={orderId} />
            <PendingSubmitButton
              className={`${subtleLinkBar} text-red-800 hover:bg-red-50`}
              pendingChildren={
                <span className="flex min-w-0 items-center gap-2">
                  <XCircle className="h-3.5 w-3.5 shrink-0" />
                  취소 처리 중…
                </span>
              }
            >
              <span className="flex min-w-0 items-center gap-2">
                <XCircle className="h-3.5 w-3.5 shrink-0" />
                주문 취소 · 전액 환불
              </span>
              <Chevr />
            </PendingSubmitButton>
          </form>
        ) : view === "student" && actorRole === "student" ? (
          <button
            type="button"
            disabled
            className={mutedLink}
            title={studentCancelDisabledReason ?? "지금은 주문을 취소할 수 없습니다."}
          >
            <span className="flex min-w-0 items-center gap-2">
              <XCircle className="h-3.5 w-3.5 shrink-0" />
              주문 취소(전액 환불)
            </span>
            <Chevr />
          </button>
        ) : null}
        {!embedded ? (
          view === "student" && actorRole === "student" && canStudentRevisionJumps ? (
            <a href="#order-revisions" className={subtleLinkBar}>
              <span className="flex min-w-0 items-center gap-2">
                <Pencil className="h-3.5 w-3.5 shrink-0 text-slate-500" />
                수정 요청하기
              </span>
              <Chevr />
            </a>
          ) : view === "student" && actorRole === "student" ? (
            <button type="button" disabled className={mutedLink} title={studentRevisionRequestDisabledReason ?? "사용할 수 없음"}>
              <span className="flex min-w-0 items-center gap-2">
                <Pencil className="h-3.5 w-3.5 shrink-0" />
                수정 요청하기
              </span>
              <Chevr />
            </button>
          ) : null
        ) : null}

        {!embedded ? (
          hasActiveDispute ? null : canDisputeJump ? (
            <a href="#order-disputes" className={disputeSubtleHref}>
              <span className="flex min-w-0 items-center gap-2">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />
                문제 해결 요청하기
              </span>
              <Chevr />
            </a>
          ) : (
            <button
              type="button"
              disabled
              className={mutedLink}
              title={openDisputeApplicationDisabledReason ?? "지금은 문제 해결 요청을 보낼 수 없습니다."}
            >
              <span className="flex min-w-0 items-center gap-2">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />
                문제 해결 요청하기
              </span>
              <Chevr />
            </button>
          )
        ) : null}
      </div>
    </div>
  );
}

/**
 * ========================================================
 * MENTOR ONLY VISUAL UPGRADES (SAFETY ENCAPSULATED)
 * ========================================================
 */

function ChevrMentor() {
  return <ChevronRight className="h-4 w-4 shrink-0 opacity-60 transition-transform group-hover:translate-x-0.5" aria-hidden />;
}

function OrderActionBarMentor(props: Props) {
  const {
    actorRole,
    orderId,
    orderTerminal = false,
    mentorStartDisabledReason,
    openDisputeApplicationDisabledReason,
    hasActiveDispute = false,
    mentorRevisionJumpDisabledReason = null,
  } = props;

  if (orderTerminal) {
    const notice = actorRole === "mentor" ? ORDER_ROOM_TERMINAL_MENTOR_NOTICE : "이 주문은 완료되어 추가 작업이 제한됩니다.";
    return (
      <div className="rounded-2xl bg-slate-50 p-6" role="status" aria-label="주문 완료 안내">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">작업 관리</p>
        <p className="mt-3 text-sm font-bold text-slate-900">추가 작업 없음</p>
        <p className="mt-2 text-sm leading-relaxed text-slate-600">{notice}</p>
      </div>
    );
  }

  const canMentorStart =
    actorRole === "mentor" && !mentorStartDisabledReason && orderId.trim().length > 0;
  const canMentorRevisionJump =
    actorRole === "mentor" && !mentorRevisionJumpDisabledReason && orderId.trim().length > 0;
  const canDisputeJump =
    actorRole === "mentor" &&
    !hasActiveDispute &&
    !openDisputeApplicationDisabledReason &&
    orderId.trim().length > 0;

  const mentorPrimaryStarts = Boolean(canMentorStart);

  return (
    <div className="w-full space-y-4" role="group" aria-label="주문 액션">
      <p className="text-sm font-semibold text-slate-900">작업 관리</p>

      <div className="flex flex-col gap-2">
        {hasActiveDispute ? (
          <a href="#order-disputes" className="group flex w-full items-center justify-between gap-2 rounded-xl border border-slate-300 bg-slate-50 px-4 py-3 transition hover:border-slate-400 hover:bg-slate-100">
            <span className="flex items-start gap-2.5">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" aria-hidden />
              <span className="flex flex-col text-left">
                <span className="text-sm font-bold text-slate-800">문제 해결 진행 중</span>
                <span className="text-xs font-medium text-slate-500">현황을 확인하세요.</span>
              </span>
            </span>
            <ChevrMentor />
          </a>
        ) : null}

        {actorRole === "mentor" && mentorPrimaryStarts ? (
          <form action={startCustomOrderWorkAction} className="w-full">
            <input type="hidden" name="orderId" value={orderId} />
            <button type="submit" className="group flex w-full items-center justify-between gap-2 rounded-xl border border-green-200 bg-green-50/60 px-4 py-3 transition hover:border-green-300 hover:bg-green-50 active:scale-[0.98]">
              <span className="flex items-start gap-2.5">
                <Play className="mt-0.5 h-4 w-4 shrink-0 text-green-600" />
                <span className="flex flex-col text-left">
                  <span className="text-sm font-bold text-green-900">작업 시작하기</span>
                  <span className="text-xs font-medium text-green-800/80">의뢰 착수 버튼을 누릅니다.</span>
                </span>
              </span>
              <ChevrMentor />
            </button>
          </form>
        ) : null}
      </div>

      <div className="mt-4 space-y-0.5 border-t border-ds-border-subtle pt-3">
        {actorRole === "mentor" && !mentorPrimaryStarts && (
          <p className="px-1 py-1 text-xs font-medium text-slate-500">※ 지금은 작업을 시작할 수 없습니다.</p>
        )}
        
        {actorRole === "mentor" && canMentorRevisionJump ? (
          <a href="#order-revisions" className="group flex w-full items-center justify-between gap-2 rounded-lg px-2 py-2 text-left text-xs font-semibold text-slate-700 transition hover:bg-slate-50 hover:text-green-700">
            <span className="flex items-center gap-2">
              <Pencil className="h-3.5 w-3.5 text-slate-400 group-hover:text-green-600" />
              수정 요청 내역
            </span>
            <ChevrMentor />
          </a>
        ) : null}

        {hasActiveDispute ? null : canDisputeJump ? (
          <a href="#order-disputes" className="group flex w-full items-center justify-between gap-2 rounded-lg px-2 py-2 text-left text-xs font-semibold text-red-600 transition hover:bg-red-50/50">
            <span className="flex items-center gap-2">
              <AlertTriangle className="h-3.5 w-3.5 text-red-400" aria-hidden />
              문제 해결 요청
            </span>
            <ChevrMentor />
          </a>
        ) : (
          <div className="flex w-full cursor-not-allowed items-center justify-between gap-2 rounded-lg px-2 py-2 text-left text-xs font-medium text-slate-300">
            <span className="flex items-center gap-2">
              <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
              문제 해결 요청
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
