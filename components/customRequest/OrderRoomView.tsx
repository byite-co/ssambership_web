"use client";

import "@/app/(public)/custom-request/landing.css";

import Link from "next/link";

import { AlertTriangle, BadgeCheck, Briefcase, Pencil, Send, ShieldCheck } from "lucide-react";
import type { loadOrderBundle } from "@/lib/customRequest/customRequestQueries";
import type { OrderDetailPageData } from "@/lib/customRequest/orderDetailQueries";
import { hasActiveDisputeForOrderRows } from "@/lib/customRequest/orderDisputeHelpers";

import {
  ORDER_INSERT_STATUS_PENDING,
  ORDER_MENTOR_WORK_STARTED_PRIMARY_STATUS,
  ORDER_STATUSES_MENTOR_START_WORK_ALLOWED,
  isOrderPaymentEscrowedForStudentCancel,
  isOrderStatusAllowingStudentAccept,
  isOrderStatusBeforeMentorWorkStarted,
  isOrderRowTerminalForActions,
  isOrderRowPaymentConfirmedForMentorWork,
  normalizedPrimaryOrderStatus,
  orderWorkspaceCurrentStepIndex,
  orderStatusLabelForUi,
  ORDER_ROOM_TIMELINE_STEPS,
} from "@/lib/customRequest/orderLifecycleConstants";
import { mapDataErrorMessage } from "@/lib/utils/mapDataError";
import { OrderActionBar } from "@/components/customRequest/order/OrderActionBar";
import type { AppRole } from "@/lib/types/user";
import { OrderDeliverablesPanel } from "@/components/customRequest/order/OrderDeliverablesPanel";
import { OrderDisputesPanel } from "@/components/customRequest/order/OrderDisputesPanel";
import { OrderEventsLogPanel } from "@/components/customRequest/order/OrderEventsLogPanel";
import { OrderProgressSection } from "@/components/customRequest/order/OrderProgressSection";
import { OrderRevisionsPanel } from "@/components/customRequest/order/OrderRevisionsPanel";
import { StudentOrderCompleteView } from "@/components/customRequest/order/StudentOrderCompleteView";
import { DeliveryReviewCountdown } from "@/components/customRequest/DeliveryReviewCountdown";
import {
  hasRightSettlementBlockContent,
  OrderPaymentSettlementBlock,
  OrderRoomPageHeader,
  OrderSettlementLineCard,
  OrderRightSidebarMentor,
} from "@/components/customRequest/order/OrderSummaryHeader";
import { MentorOrderRoomGuidanceCollapsible } from "@/components/customRequest/MentorOrderRoomGuidanceCollapsible";
import { CustomRequestPolicyNotice } from "@/components/customRequest/CustomRequestPolicyNotice";
import { ContactMaskingNotice } from "@/components/customRequest/ContactMaskingNotice";
import {
  CustomRequestCoreStrip,
  CustomRequestDetailDivider,
  CustomRequestSectionPane,
} from "@/components/customRequest/customRequestDetailLayout";

type Bundle = Awaited<ReturnType<typeof loadOrderBundle>>;
type Row = Record<string, unknown>;

// (revision/waiting-review 흡수) 순수 표시 헬퍼 — 서버 전용 모듈을 끌어오지 않도록 client에 인라인.
function computeRevisionUsageLocal(deliverableCount: number, max = 2): { used: number; max: number; exceeded: boolean } {
  const used = Math.max(0, deliverableCount - 1);
  return { used, max, exceeded: used >= max };
}
function pickSubmittedRawLocal(row: Row | null): unknown {
  if (!row) return null;
  for (const k of ["submitted_at", "created_at", "updated_at"] as const) {
    const v = row[k];
    if (v != null && String(v).trim()) return v;
  }
  return null;
}
function reviewDeadlineIsoFromSubmittedLocal(submittedRaw: unknown): string | null {
  const raw = submittedRaw == null ? "" : String(submittedRaw).trim();
  if (!raw) return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  d.setDate(d.getDate() + 3);
  return d.toISOString();
}

/** 분쟁 open/under_review/escalated 시 납품·수락·수정요청·작업시작을 잠금(서버 액션과 동기). */
function disputeLifecycleBlockReason(detail: OrderDetailPageData): string | null {
  if (hasActiveDisputeForOrderRows(detail.bundle.disputes.rows ?? [])) {
    return "진행 중인 분쟁이 있어 이 작업은 제한됩니다.";
  }
  return null;
}

function studentAcceptDisabledReason(
  actorRole: AppRole,
  view: "student" | "mentor",
  order: Row,
  detail: OrderDetailPageData
): string | null {
  if (view !== "student" || actorRole !== "student") {
    return "학생 본인 의뢰에서만 납품 수락을 사용할 수 있습니다.";
  }
  const byDispute = disputeLifecycleBlockReason(detail);
  if (byDispute) {
    return byDispute;
  }
  const hasDel = (detail.bundle.deliverables.rows?.length ?? 0) > 0;
  if (!hasDel) {
    return "등록된 납품이 있어야 수락할 수 있습니다.";
  }
  const norm = normalizedPrimaryOrderStatus(order);
  if (!norm) {
    return "주문 상태를 확인할 수 없습니다.";
  }
  if (isOrderRowTerminalForActions(order)) {
    return "이미 완료된 주문입니다.";
  }
  if (!isOrderStatusAllowingStudentAccept(norm)) {
    return `현재 단계(${orderStatusLabelForUi(norm)})에서는 수락할 수 없습니다.`;
  }
  return null;
}

function mentorStartDisabledReason(
  actorRole: AppRole,
  view: "student" | "mentor",
  order: Row,
  detail: OrderDetailPageData,
  byDdl: string | null
): string | null {
  const byDispute = disputeLifecycleBlockReason(detail);
  if (byDispute) {
    return byDispute;
  }
  if (view === "mentor" && actorRole === "mentor" && !isOrderRowPaymentConfirmedForMentorWork(order)) {
    return "학생 측 결제가 완료된 뒤에만 작업을 시작할 수 있습니다.";
  }
  if (byDdl) {
    return byDdl;
  }
  if (view !== "mentor" || actorRole !== "mentor") {
    return "멘토 본인에게 배정된 주문에서만 작업 시작을 사용할 수 있습니다.";
  }
  const norm = normalizedPrimaryOrderStatus(order);
  if (!norm) {
    return "주문 상태를 확인할 수 없습니다.";
  }
  if (isOrderRowTerminalForActions(order)) {
    return "이미 완료된 주문입니다.";
  }
  if (norm === ORDER_MENTOR_WORK_STARTED_PRIMARY_STATUS) {
    return "이미 작업이 시작된 상태입니다.";
  }
  if (!ORDER_STATUSES_MENTOR_START_WORK_ALLOWED.has(norm)) {
    return `현재 단계(${orderStatusLabelForUi(norm)})에서는 작업을 시작할 수 없습니다.`;
  }
  return null;
}

function studentCancelDisabledReason(
  actorRole: AppRole,
  view: "student" | "mentor",
  order: Row,
  detail: OrderDetailPageData
): string | null {
  if (view !== "student" || actorRole !== "student") {
    return "학생 본인 의뢰에서만 주문을 취소할 수 있습니다.";
  }
  const byDispute = disputeLifecycleBlockReason(detail);
  if (byDispute) {
    return byDispute;
  }
  if (isOrderRowTerminalForActions(order)) {
    return "이미 종료된 주문입니다.";
  }
  const norm = normalizedPrimaryOrderStatus(order);
  if (!norm) {
    return "주문 상태를 확인할 수 없습니다.";
  }
  if (!isOrderPaymentEscrowedForStudentCancel(order)) {
    return "예치(결제)가 완료된 주문만 직접 취소할 수 있습니다.";
  }
  if (!isOrderStatusBeforeMentorWorkStarted(norm)) {
    if (norm === ORDER_MENTOR_WORK_STARTED_PRIMARY_STATUS || norm === "in_progress") {
      return "작업이 시작되어 직접 취소할 수 없습니다. 문의·분쟁을 이용하세요.";
    }
    return `현재 단계(${orderStatusLabelForUi(norm)})에서는 직접 취소할 수 없습니다.`;
  }
  return null;
}

function studentRevisionRequestDisabledReason(
  actorRole: AppRole,
  view: "student" | "mentor",
  order: Row,
  detail: OrderDetailPageData
): string | null {
  if (view !== "student" || actorRole !== "student") {
    return "학생 본인 의뢰에서만 수정 요청을 보낼 수 있습니다.";
  }
  const byDispute = disputeLifecycleBlockReason(detail);
  if (byDispute) {
    return byDispute;
  }
  const hasDel = (detail.bundle.deliverables.rows?.length ?? 0) > 0;
  if (!hasDel) {
    return "등록된 납품이 있어야 수정 요청을 할 수 있습니다.";
  }
  const norm = normalizedPrimaryOrderStatus(order);
  if (!norm) {
    return "주문 상태를 확인할 수 없습니다.";
  }
  if (isOrderRowTerminalForActions(order)) {
    return "이미 완료·종료된 주문에는 수정 요청을 할 수 없습니다.";
  }
  if (!isOrderStatusAllowingStudentAccept(norm)) {
    return `납품 검토·수락 단계에서만 수정 요청할 수 있습니다(현재: ${orderStatusLabelForUi(norm)}).`;
  }
  return null;
}

/**
 * 분쟁 신청 폼: 학생/멘토, 비종료, 미진행 분쟁.
 * - terminal: 이 화면에서 신규 티켓 열지 않음(정책, 사후는 운영·별도).
 * - 멘토: 납품 1건 이상 또는 학생 검토 가능 상태에서만 신청(서버 액션과 동일).
 */
function openDisputeApplicationDisabledReason(
  actorRole: AppRole,
  order: Row,
  detail: OrderDetailPageData
): string | null {
  if (actorRole !== "student" && actorRole !== "mentor") {
    return "학생·멘토만 이 화면에서 분쟁을 신청할 수 있습니다.";
  }
  const norm = normalizedPrimaryOrderStatus(order);
  if (!norm) {
    return "주문 상태를 확인할 수 없어 분쟁을 신청할 수 없습니다.";
  }
  if (isOrderRowTerminalForActions(order)) {
    // 정책: terminal 이후 동일 주문 URL 로는 신규 분쟁 티켓을 열지 않음(사후 클레임은 운영·별도).
    return "종료·완료된 주문에는 이 화면에서 새 분쟁을 열 수 없습니다.";
  }
  if (hasActiveDisputeForOrderRows(detail.bundle.disputes.rows ?? [])) {
    return "이미 진행 중인 분쟁이 있습니다.";
  }
  if (actorRole === "mentor") {
    // 멘토 분쟁은 납품 이후 단계에서만 허용한다. 납품 전 진행 이슈는 메시지/고객센터로 처리.
    const hasDel = (detail.bundle.deliverables.rows?.length ?? 0) > 0;
    const inStudentReview = isOrderStatusAllowingStudentAccept(norm);
    if (!hasDel && !inStudentReview) {
      return "멘토는 납품이 등록된 이후(또는 학생 검토·수락 단계)에만 분쟁을 신청할 수 있습니다. 납품 전 이슈는 주문 메시지·고객센터로 문의해 주세요.";
    }
  }
  return null;
}

function OngoingOrderStepper({ currentIndex, paused }: { currentIndex: number; paused?: boolean }) {
  return (
    <div className="cr-stepper-shell mt-3 !mb-0">
      {/* 분쟁 중에는 단계를 리셋하지 않고 직전 진행 위치를 유지한 채 '일시 정지'로만 표시(표시 전용). */}
      {paused ? (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800">
          <span className="inline-flex h-5 items-center rounded-full bg-amber-100 px-2 text-[11px] font-extrabold text-amber-800">
            운영팀 확인 중
          </span>
          진행이 잠시 멈췄어요 · 현재 단계는 그대로 유지돼요
        </div>
      ) : null}
      <div className={`form-stepper-lifecycle${paused ? " opacity-70" : ""}`}>
        <ol aria-label="주문 진행 단계">
          {ORDER_ROOM_TIMELINE_STEPS.map((step, index) => {
            const isDone = index < currentIndex;
            const isCurrent = index === currentIndex;
            return (
              <li
                key={step.id}
                className={`step-item ${isDone ? "is-done" : ""} ${isCurrent ? "is-current" : ""}`.trim()}
              >
                <span className="step-dot">{isDone ? "✓" : index + 1}</span>
                <span className="step-label">{step.title}</span>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}

function OngoingPolicySection() {
  return (
    <CustomRequestSectionPane title="안내 및 정책">
      <div className="mt-3 grid gap-3">
        <CustomRequestPolicyNotice />
        <ContactMaskingNotice />
        <div className="rounded-xl border border-slate-200 bg-slate-50/90 px-4 py-3 text-xs leading-relaxed text-slate-700">
          <p className="font-extrabold text-slate-900">환불·취소 안내</p>
          <p className="mt-2">
            지원 없음·자동 취소·결제 실패·납품 지연 등 예외는 주문 상태와 이벤트 로그를 함께 확인해 주세요.{" "}
            <a href="/legal/refund" className="font-bold text-blue-700 underline">
              환불·취소 안내
            </a>
          </p>
        </div>
      </div>
    </CustomRequestSectionPane>
  );
}

export function OrderRoomView(props: {
  bundle: Bundle;
  detail: OrderDetailPageData | null;
  orderId: string;
  view: "student" | "mentor";
  actorRole: AppRole;
  accessDenied: boolean;
  accessDetail?: string;
  /** 멘토: 맞춤의뢰 주문 목록 등 허브로 돌아가는 경로(OrderRoomPageHeader breadcrumb) */
  mentorOrderHubHref?: string;
  mentorStartDdlDisabledReason: string | null;
  /** 멘토 뷰 채팅 — 학생 발신자 표시명(RPC 조회, 서버에서 주입) */
  mentorStudentDisplayName?: string;
}) {
  if (props.view === "mentor") {
    return <OrderRoomViewMentor {...props} />;
  }
  const {
    bundle,
    detail,
    orderId,
    view,
    actorRole,
    accessDenied,
    mentorStartDdlDisabledReason,
  } = props;
  const o = bundle.order.row;

  if (accessDenied) {
    return (
      <p className="mb-3 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
        이 주문에 접근할 권한이 없습니다. 의뢰를 등록한 학생, 배정된 멘토, 운영자만 볼 수 있습니다.
      </p>
    );
  }

  if (!o) {
    const errMsg = bundle.order.error ? mapDataErrorMessage(String(bundle.order.error)) : "주문을 찾을 수 없습니다.";
    return (
      <div className="space-y-2 text-sm text-slate-600">
        <p>{errMsg}</p>
      </div>
    );
  }

  if (!detail) {
    return null;
  }

  const orderNorm = normalizedPrimaryOrderStatus(o as Row);
  const isTerminalOrder = isOrderRowTerminalForActions(o as Row);
  const mentorDeliverableBlockReason = (() => {
    if (actorRole !== "mentor") {
      return "멘토만 납품을 등록할 수 있습니다.";
    }
    if (!isOrderRowPaymentConfirmedForMentorWork(o as Row)) {
      return "학생 측 결제가 완료된 뒤에만 납품을 등록할 수 있습니다.";
    }
    const d = disputeLifecycleBlockReason(detail);
    if (d) {
      return d;
    }
    if (isOrderRowTerminalForActions(o as Row)) {
      return "완료된 주문에서는 납품을 추가로 등록할 수 없습니다.";
    }
    if (orderNorm === ORDER_INSERT_STATUS_PENDING) {
      return "멘토가 작업을 시작한 뒤에 납품을 등록할 수 있습니다.";
    }
    if (orderNorm !== ORDER_MENTOR_WORK_STARTED_PRIMARY_STATUS && orderNorm !== "delivered") {
      return `이 단계(${orderNorm ? orderStatusLabelForUi(orderNorm) : "—"})에서는 납품을 등록할 수 없습니다.`;
    }
    return null;
  })();

  const revBlock = studentRevisionRequestDisabledReason(actorRole, view, o as Row, detail);
  const disputeFormBlock = openDisputeApplicationDisabledReason(actorRole, o as Row, detail);
  const hasActiveDispute = Boolean(detail.hasActiveDispute);
  const oid = String((o as Row).id ?? "");
  const idForDisplay = String(oid || orderId).trim();
  const shouldRenderStudentCompleteView =
    view === "student" && actorRole === "student" && (isTerminalOrder || orderNorm === "completed");

  if (shouldRenderStudentCompleteView) {
    return <StudentOrderCompleteView detail={detail} orderId={idForDisplay} />;
  }

  const hasDeliverable = (detail.bundle.deliverables.rows?.length ?? 0) > 0;
  const currentStepIndex = orderWorkspaceCurrentStepIndex(orderNorm, isTerminalOrder, hasDeliverable);
  // 분쟁 중에는 상태가 'disputed'로 와서 라벨이 "종료됨", 스테퍼가 1단계로 리셋된다.
  // 표시 전용: 활성 분쟁(open/under_review/escalated)뿐 아니라 status==='disputed'(분쟁 기록이 resolved여도
  // 주문 상태가 disputed로 남은 경우)도 포함해 멘토 주문방과 통일 — 라벨 "운영팀 확인 중", 스테퍼는 진행 맥락 유지.
  // 가드 입력(hasActiveDispute)·escrow·정산은 미터치.
  const inDispute = hasActiveDispute || orderNorm === "disputed";
  const statusLabel = inDispute ? "운영팀 확인 중" : orderNorm ? orderStatusLabelForUi(orderNorm) : "진행 중";
  const stepIndexForDisplay = inDispute ? Math.max(currentStepIndex, hasDeliverable ? 2 : 1) : currentStepIndex;
  const categoryLabel = detail.header.category && detail.header.category !== "—" ? detail.header.category : "맞춤의뢰";
  const mentorLabel =
    detail.header.mentorName && detail.header.mentorName !== "—" ? `${detail.header.mentorName} 멘토` : "배정 멘토";
  const amountLabel = detail.header.priceLine && detail.header.priceLine !== "—" ? detail.header.priceLine : "협의 중";
  const dueLabel = detail.header.dueLine && detail.header.dueLine !== "—" ? detail.header.dueLine : "—";

  // (revision/waiting-review 페이지 흡수) — 납품 완료→학생 검토 대기 단계에서만 노출
  const deliverableRows = (detail.bundle.deliverables.rows as Row[] | undefined) ?? [];
  const inReviewStage = orderNorm === "delivered" && !isTerminalOrder;
  const revisionUsage = computeRevisionUsageLocal(deliverableRows.length);
  const reviewDeadlineIso = inReviewStage
    ? reviewDeadlineIsoFromSubmittedLocal(pickSubmittedRawLocal(deliverableRows[0] ?? null))
    : null;
  const showReviewCountdown = inReviewStage && reviewDeadlineIso != null;
  const showRevisionUsage = inReviewStage;

  // 가드 판정값을 한 번만 계산해 재사용(값은 기존 함수 그대로 — 안전 규칙 불변).
  const acceptBlock = studentAcceptDisabledReason(actorRole, view, o as Row, detail);
  const cancelBlock = studentCancelDisabledReason(actorRole, view, o as Row, detail);
  // rule 5: 최종 판정은 서버(RPC)지만, 2회 모두 사용 시 화면에서도 수정 버튼을 미리 비활성화(서버 enforcement와 동기).
  const revBlockEffective = revBlock ?? (revisionUsage.exceeded ? "수정 요청은 최대 2회까지 가능해요. 모두 사용했습니다." : null);
  const revisionsLeft = Math.max(0, revisionUsage.max - revisionUsage.used);
  // 큰 상태 문장(주인공) + 지금 누구 차례 — 순수 표시, 상태/분쟁/수락가능 여부에서 파생.
  const turn: "student" | "mentor" | "ops" = inDispute
    ? "ops"
    : orderNorm === "delivered" && !acceptBlock
      ? "student"
      : "mentor";
  const statusHero: { headline: string; guide: string; guideMobile?: string } = (() => {
    if (inDispute) {
      return { headline: "운영팀이 확인하고 있어요", guide: "운영팀이 확인하는 동안 수락·수정·취소는 잠시 멈춰요.", guideMobile: "확인하는 동안 잠시 멈춰요." };
    }
    if (orderNorm === "delivered") {
      return { headline: "멘토가 결과물을 보냈어요", guide: "결과물을 확인하고 수락하거나, 필요하면 수정을 요청하세요.", guideMobile: "확인 후 수락하거나 수정을 요청하세요." };
    }
    if (orderNorm === "revision_requested") {
      return { headline: "멘토가 다시 작업하고 있어요", guide: "요청한 수정 사항을 반영하는 중이에요. 조금만 기다려 주세요.", guideMobile: "수정 사항을 반영하는 중이에요." };
    }
    if (orderNorm === ORDER_MENTOR_WORK_STARTED_PRIMARY_STATUS || orderNorm === "in_progress") {
      return { headline: "멘토가 작업하고 있어요", guide: "작업이 끝나면 결과물을 보내드려요." };
    }
    if (orderNorm === ORDER_INSERT_STATUS_PENDING) {
      return { headline: "곧 작업이 시작돼요", guide: "멘토가 곧 작업을 시작할 거예요." };
    }
    return { headline: statusLabel, guide: "현재 진행 상태를 확인하세요." };
  })();

  return (
    <div className="cr-landing cr-detail-v5 cr-detail-shell py-3" data-views="custom-order-room">
      <article className="cr-detail-card">
        {/* 큰 상태 문장이 주인공: 지금 무슨 일이고 누구 차례인지 사람 말로. */}
        <header className="cr-detail-header">
          <span className="eyebrow">맞춤의뢰 · {categoryLabel}</span>
          <div className="cr-detail-header-row">
            <h1 className="cr-detail-title max-md:!text-[1.2rem]">{statusHero.headline}</h1>
            <span className="cr-category-badge">{statusLabel}</span>
          </div>
          <p className="cr-detail-subtitle">
            {statusHero.guideMobile ? (
              <>
                <span className="md:hidden">{statusHero.guideMobile}</span>
                <span className="hidden md:inline">{statusHero.guide}</span>
              </>
            ) : (
              statusHero.guide
            )}
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-[#bfdbfe] bg-[#eff5ff] px-3 py-1.5 text-xs font-extrabold text-[#2563EB]">
              <span aria-hidden>✓</span>
              {amountLabel} 안전 보관 중
            </span>
            {turn === "student" ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-[#2563EB] px-3 py-1.5 text-xs font-extrabold text-white">
                지금 내 차례예요
              </span>
            ) : turn === "mentor" ? (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-bold text-slate-600">
                멘토를 기다리는 중
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-300 bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-700">
                운영팀 확인 중
              </span>
            )}
          </div>
        </header>

        <CustomRequestCoreStrip
          items={[
            { label: "선택된 멘토", value: mentorLabel },
            { label: "안전 결제 금액", value: amountLabel },
            { label: "마감일(납기)", value: dueLabel },
          ]}
        />

        <CustomRequestDetailDivider />

        {/* 진행 단계 — 조연(작게) */}
        <CustomRequestSectionPane title="진행 단계" hint="현재 주문 상태에 맞춰 자동으로 표시돼요">
          <OngoingOrderStepper currentIndex={stepIndexForDisplay} paused={inDispute} />
        </CustomRequestSectionPane>

        <CustomRequestDetailDivider />

        {/* 결정 영역: 멘토가 보낸 결과물(결정 대상) + 바로 아래 수락/수정 액션 */}
        <CustomRequestSectionPane title="멘토가 보낸 결과물" hint="수락 전에는 다운로드·미리보기가 잠겨 있어요">
          <div className="mt-3">
            <OrderDeliverablesPanel
              detail={detail}
              orderId={oid}
              view={view}
              actorRole={actorRole}
              mentorDeliverableBlockReason={mentorDeliverableBlockReason}
              orderTerminal={isTerminalOrder}
              embedded
            />
            {showReviewCountdown ? (
              <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                <p className="text-sm font-bold text-slate-800">
                  학생 검토 기간 <DeliveryReviewCountdown reviewDeadlineIso={reviewDeadlineIso} compact className="ml-1" />
                </p>
                <p className="text-xs font-medium text-slate-500">기간 내 무응답 시 자동 완료</p>
              </div>
            ) : null}
          </div>
          <div className="mt-4 border-t border-slate-100 pt-4">
            {turn === "student" ? (
              <p className="mb-2 text-sm font-bold text-slate-800">
                확인 후 결정해 주세요{" "}
                <span className="font-medium text-slate-500">
                  · 수락하면 안전 보관 중인 {amountLabel}가 멘토에게 정산돼요
                </span>
              </p>
            ) : turn === "mentor" ? (
              <p className="mb-2 text-sm font-medium text-slate-500">아직 내가 결정할 단계가 아니에요. 멘토 작업을 기다려 주세요.</p>
            ) : null}
            <OrderActionBar
              view={view}
              actorRole={actorRole}
              orderId={oid}
              orderTerminal={isTerminalOrder}
              studentAcceptDisabledReason={acceptBlock}
              mentorStartDisabledReason={mentorStartDisabledReason(
                actorRole,
                view,
                o as Row,
                detail,
                mentorStartDdlDisabledReason
              )}
              studentRevisionRequestDisabledReason={revBlockEffective}
              studentCancelDisabledReason={cancelBlock}
              openDisputeApplicationDisabledReason={disputeFormBlock}
              hasActiveDispute={hasActiveDispute}
              mentorRevisionJumpDisabledReason={null}
              embedded
            />
          </div>

          {/* D1: 수정 요청을 핵심 작업 카드에 통합(별도 카드 제거) */}
          <div className="mt-4 border-t border-slate-100 pt-4">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-extrabold text-slate-900">수정 요청</p>
              {showRevisionUsage ? (
                <span className={`text-xs font-bold ${revisionUsage.exceeded ? "text-red-700" : "text-[#2563EB]"}`}>
                  수정 {revisionUsage.max}회 중 {revisionsLeft}회 남음
                </span>
              ) : null}
            </div>
            <div className="mt-3">
              <OrderRevisionsPanel
                detail={detail}
                orderId={oid}
                actorRole={actorRole}
                hasOrderPartyAccess={!accessDenied}
                studentRevisionRequestDisabledReason={revBlockEffective}
                orderTerminal={isTerminalOrder}
                revisionAccent={"default"}
                embedded
              />
            </div>
          </div>
        </CustomRequestSectionPane>

        <CustomRequestDetailDivider />

        {/* 채팅 — 소통용, 결정 아래로 분리 */}
        <CustomRequestSectionPane title="멘토와 대화" hint="결정과 별개로, 궁금한 점은 여기서 이야기해요">
          <div className="mt-3">
            <OrderProgressSection
              detail={detail}
              orderId={idForDisplay}
              view={view}
              actorRole={actorRole}
              hasOrderPartyAccess={!accessDenied}
              orderTerminal={isTerminalOrder}
              embedded
            />
          </div>
        </CustomRequestSectionPane>

        <CustomRequestDetailDivider />

        {/* 보조: 문제 해결 → 진행 로그 → 정책 (하단 보조 위치) */}
        <CustomRequestSectionPane title="문제가 있나요?" hint="결제·납품·수정 요청 관련 문제를 접수할 수 있어요">
          <div className="mt-3">
            <OrderDisputesPanel
              detail={detail}
              orderId={oid}
              actorRole={actorRole}
              hasOrderPartyAccess={!accessDenied}
              openDisputeApplicationDisabledReason={disputeFormBlock}
              orderTerminal={isTerminalOrder}
              embedded
            />
          </div>
        </CustomRequestSectionPane>

        <CustomRequestDetailDivider />

        {/* D1: 진행 로그는 기본 접힘 — 펼칠 때만 노출 */}
        <details className="mt-2">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50/70 px-4 py-3 text-sm font-extrabold text-slate-700 hover:bg-slate-50">
            진행 로그
            <span className="text-xs font-medium text-slate-400">펼쳐 보기</span>
          </summary>
          <div className="mt-3">
            <OrderEventsLogPanel detail={detail} embedded />
          </div>
        </details>

        <CustomRequestDetailDivider />

        <OngoingPolicySection />

        <footer className="cr-detail-footer">
          <Link href="/custom-request" className="btn btn-ghost">
            ← 맞춤의뢰 목록으로 돌아가기
          </Link>
        </footer>
      </article>
    </div>
  );
}

/**
 * ========================================================
 * MENTOR ONLY VISUAL UPGRADES (SAFETY ENCAPSULATED)
 * ========================================================
 */

function OrderRoomViewMentor(props: {
  bundle: Bundle;
  detail: OrderDetailPageData | null;
  orderId: string;
  view: "student" | "mentor";
  actorRole: AppRole;
  accessDenied: boolean;
  accessDetail?: string;
  mentorOrderHubHref?: string;
  mentorStartDdlDisabledReason: string | null;
  mentorStudentDisplayName?: string;
}) {
  const {
    bundle,
    detail,
    orderId,
    view,
    actorRole,
    accessDenied,
    mentorOrderHubHref,
    mentorStartDdlDisabledReason,
    mentorStudentDisplayName,
  } = props;

  const o = bundle.order.row;

  if (accessDenied) {
    return (
      <div className="p-8 text-center">
        <p className="inline-flex rounded-xl border border-amber-200 bg-amber-50 px-6 py-3 text-sm font-medium text-amber-900">
          이 주문에 접근할 권한이 없습니다.
        </p>
      </div>
    );
  }

  if (!o) {
    const errMsg = bundle.order.error ? mapDataErrorMessage(String(bundle.order.error)) : "주문을 찾을 수 없습니다.";
    return (
      <div className="p-8 text-center text-slate-600 font-medium">
        <p>{errMsg}</p>
      </div>
    );
  }

  if (!detail) return null;

  const orderNorm = normalizedPrimaryOrderStatus(o as Row);
  const isTerminalOrder = isOrderRowTerminalForActions(o as Row);
  const mentorDeliverableBlockReason = (() => {
    if (view !== "mentor" || actorRole !== "mentor") return "멘토 전용입니다.";
    if (!isOrderRowPaymentConfirmedForMentorWork(o as Row)) {
      return "결제가 완료된 뒤에만 납품을 등록할 수 있습니다.";
    }
    const d = disputeLifecycleBlockReason(detail);
    if (d) return d;
    if (isOrderRowTerminalForActions(o as Row)) {
      return "완료된 주문에서는 납품을 추가할 수 없습니다.";
    }
    if (orderNorm === ORDER_INSERT_STATUS_PENDING) {
      return "멘토가 작업을 시작한 뒤에 납품할 수 있습니다.";
    }
    if (orderNorm !== ORDER_MENTOR_WORK_STARTED_PRIMARY_STATUS && orderNorm !== "delivered") {
      return `현재 단계에서는 납품 등록이 불가합니다.`;
    }
    return null;
  })();

  const revBlock = studentRevisionRequestDisabledReason(actorRole, view, o as Row, detail);
  const disputeFormBlock = openDisputeApplicationDisabledReason(actorRole, o as Row, detail);
  const hasActiveDispute = Boolean(detail.hasActiveDispute);
  const activeDisputeActionBlock = hasActiveDispute ? "문제 해결 진행 중에는 제한됩니다." : null;
  const oid = String((o as Row).id ?? "");
  const idForDisplay = String(oid || orderId).trim();

  // ── 학생 시점과 통일: 큰 상태 문장(주인공) + 누구 차례 + 안전 결제(에스크로). 순수 표시값 —
  //    상태/결제확인/분쟁에서 파생만 하고 가드 판정 함수·값은 건드리지 않는다.
  const amountLabel =
    detail.header.priceLine && detail.header.priceLine !== "—" ? detail.header.priceLine : "협의 중";
  const paymentConfirmed = isOrderRowPaymentConfirmedForMentorWork(o as Row);
  const statusLabel = orderNorm ? orderStatusLabelForUi(orderNorm) : "진행 중";
  const heroTerminal = isTerminalOrder || orderNorm === "completed";
  // 멘토가 실제로 행동할 수 있는(=가드가 열리는 방향의) 상태에서만 "내 차례"로 표시.
  // 그 외 종료·취소·분쟁종결 등은 중립으로 둬서 "지금 내 차례예요"를 과하게 외치지 않는다.
  const heroMentorActionable =
    !heroTerminal &&
    !hasActiveDispute &&
    (orderNorm === ORDER_MENTOR_WORK_STARTED_PRIMARY_STATUS ||
      orderNorm === "in_progress" ||
      orderNorm === "revision_requested" ||
      (orderNorm === ORDER_INSERT_STATUS_PENDING && paymentConfirmed));
  const heroTurn: "mentor" | "student" | "ops" | "done" = heroTerminal
    ? "done"
    : hasActiveDispute
      ? "ops"
      : orderNorm === "delivered"
        ? "student"
        : orderNorm === ORDER_INSERT_STATUS_PENDING && !paymentConfirmed
          ? "student"
          : heroMentorActionable
            ? "mentor"
            : "done";
  const hero: { headline: string; guide: string; guideMobile?: string } = (() => {
    if (hasActiveDispute) {
      return { headline: "문제 해결을 진행하고 있어요", guide: "운영팀이 확인하는 동안 작업·납품·수정은 잠시 멈춰요.", guideMobile: "문제 해결이 진행 중이에요." };
    }
    if (isTerminalOrder || orderNorm === "completed") {
      return { headline: "거래가 완료됐어요", guide: "결제·납품·정산이 모두 마무리됐어요. 수고하셨어요.", guideMobile: "정산까지 마무리됐어요." };
    }
    if (orderNorm === "delivered") {
      return { headline: "결과물을 보냈어요", guide: "학생이 확인하고 수락하면 정산돼요. 조금만 기다려 주세요.", guideMobile: "확인·수락하면 정산돼요." };
    }
    if (orderNorm === "revision_requested") {
      return { headline: "학생이 수정을 요청했어요", guide: "요청 내용을 확인하고 수정본을 보내 주세요.", guideMobile: "수정본을 보완해 보내 주세요." };
    }
    if (orderNorm === ORDER_MENTOR_WORK_STARTED_PRIMARY_STATUS || orderNorm === "in_progress") {
      return { headline: "작업을 진행하고 있어요", guide: "작업이 끝나면 결과물을 학생에게 보내 주세요.", guideMobile: "작업 후 결과물을 보내 주세요." };
    }
    if (orderNorm === ORDER_INSERT_STATUS_PENDING) {
      return paymentConfirmed
        ? { headline: "작업을 시작해 주세요", guide: "학생 결제가 안전하게 확인됐어요. 착수 버튼을 눌러 시작해 주세요.", guideMobile: "착수 버튼을 눌러 시작해 주세요." }
        : { headline: "학생 결제를 기다리고 있어요", guide: "결제가 확인되면 작업을 시작할 수 있어요." };
    }
    return { headline: statusLabel, guide: "현재 진행 상태를 확인하세요." };
  })();

  // 상태별 아이콘 앵커(톤은 기존 상태 의미 재사용): 분쟁=빨강, 수정요청=주황, 그 외 정상=초록.
  const heroIcon = (() => {
    if (hasActiveDispute || orderNorm === "disputed") {
      return { tile: "bg-red-50", fg: "text-red-600", Icon: AlertTriangle };
    }
    if (orderNorm === "revision_requested") {
      return { tile: "bg-amber-50", fg: "text-amber-600", Icon: Pencil };
    }
    if (orderNorm === "delivered") {
      return { tile: "bg-emerald-50", fg: "text-[#059669]", Icon: Send };
    }
    return { tile: "bg-emerald-50", fg: "text-[#059669]", Icon: Briefcase };
  })();

  return (
    <div className="min-h-screen w-full bg-white py-8">
      <div className="mx-auto max-w-7xl px-4 md:px-6 lg:px-8">
        {/* TOP: Shared Mentor Header (Restructured) */}
        <OrderRoomPageHeader
          detail={detail}
          view={view}
          backHref={mentorOrderHubHref ?? "/mentor/custom-request/orders"}
        />

        {/* 상태 히어로 — 플랫 카드(그라데이션 제거) + 좌측 상태 아이콘 앵커. 멘토 초록 브랜드(칩·pill·CTA) 유지 */}
        <header className="mt-6 rounded-3xl border-[0.5px] border-slate-200 bg-white p-6 sm:p-8">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex min-w-0 flex-1 items-start gap-3.5">
              <span className={`flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-xl ${heroIcon.tile} ${heroIcon.fg}`}>
                <heroIcon.Icon className="h-5 w-5" aria-hidden />
              </span>
              <div className="min-w-0">
                <span className="inline-flex items-center rounded-full bg-emerald-100/70 px-3 py-1 text-xs font-extrabold text-emerald-800">
                  {detail.header.category && detail.header.category !== "—" ? `맞춤의뢰 · ${detail.header.category}` : "맞춤의뢰 주문방"}
                </span>
                <h1 className="mt-2 text-xl font-extrabold leading-tight tracking-tight text-slate-900 sm:text-[28px]">
                  {hero.headline}
                </h1>
                <p className="mt-2 text-sm font-medium leading-relaxed text-slate-600">
                  {hero.guideMobile ? (
                    <>
                      <span className="md:hidden">{hero.guideMobile}</span>
                      <span className="hidden md:inline">{hero.guide}</span>
                    </>
                  ) : (
                    hero.guide
                  )}
                </p>
              </div>
            </div>
            <span className="inline-flex h-7 shrink-0 items-center rounded-full border border-slate-200 bg-white px-3 text-xs font-bold text-slate-600">
              {statusLabel}
            </span>
          </div>
          <div className="mt-5 flex flex-wrap items-center gap-2">
            {heroTurn === "done" && !heroTerminal ? (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-bold text-slate-600">
                {amountLabel}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-extrabold text-emerald-700">
                <ShieldCheck className="h-3.5 w-3.5" aria-hidden /> {amountLabel} {heroTerminal ? "정산 완료" : "안전 보관 중"}
              </span>
            )}
            {heroTurn === "mentor" ? (
              <span className="inline-flex items-center rounded-full bg-emerald-600 px-3 py-1.5 text-xs font-extrabold text-white">
                지금 내 차례예요
              </span>
            ) : heroTurn === "student" ? (
              <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-bold text-slate-600">
                학생을 기다리는 중
              </span>
            ) : heroTurn === "ops" ? (
              <span className="inline-flex items-center rounded-full border border-slate-300 bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-700">
                운영팀 확인 중
              </span>
            ) : (
              <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-bold text-slate-600">
                거래 종료
              </span>
            )}
            {heroTurn === "mentor" || heroTurn === "student" ? (
              <span className="text-xs font-medium text-slate-400">학생이 수락하면 정산돼요</span>
            ) : null}
          </div>
        </header>

        {/* MAIN: 2-Column Workspace Layout */}
        <div className="mt-8 flex flex-col gap-8 lg:flex-row lg:items-start lg:gap-10">
          {/* LEFT CONTENT: 탭 대신 세로로 쌓는 섹션(작업↔채팅 분리) */}
          <div className="flex min-w-0 flex-1 flex-col gap-8">
            {/* 완료 영수증 — 종료된 주문 상단 안내 */}
            {isTerminalOrder ? (
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-5">
                <p className="flex items-center gap-2 text-sm font-extrabold text-emerald-800">
                  <BadgeCheck className="h-4 w-4" aria-hidden /> 거래가 완료됐어요
                </p>
                <p className="mt-1 text-xs font-medium text-emerald-700/90">
                  결제·납품·정산이 마무리됐어요. 자세한 내역은 아래 정산·진행 로그에서 확인할 수 있어요.
                </p>
              </div>
            ) : null}

            {/* 지금 할 일: 작업 시작/납품 제어 + 결과물 파일 (멘토 액션 — 가드 프롭 1:1 보존) */}
            {/* id=deliverables: 재납품 화면 등에서 "작업 파일" 섹션으로 바로 스크롤 연결 */}
            <section id="deliverables" className="scroll-mt-24 space-y-5">
              <OrderActionBar
                view={view}
                actorRole={actorRole}
                orderId={oid}
                orderTerminal={isTerminalOrder}
                studentAcceptDisabledReason={null}
                mentorStartDisabledReason={mentorStartDisabledReason(
                  actorRole,
                  view,
                  o as Row,
                  detail,
                  mentorStartDdlDisabledReason
                )}
                studentRevisionRequestDisabledReason={null}
                studentCancelDisabledReason="학생 본인 의뢰에서만 주문을 취소할 수 있습니다."
                openDisputeApplicationDisabledReason={disputeFormBlock}
                hasActiveDispute={hasActiveDispute}
                mentorRevisionJumpDisabledReason={activeDisputeActionBlock}
              />
              <OrderDeliverablesPanel
                detail={detail}
                orderId={oid}
                view={view}
                actorRole={actorRole}
                mentorDeliverableBlockReason={mentorDeliverableBlockReason}
                orderTerminal={isTerminalOrder}
              />
            </section>

            {/* 수정 요청 내역 */}
            <OrderRevisionsPanel
              detail={detail}
              orderId={oid}
              actorRole={actorRole}
              hasOrderPartyAccess={!accessDenied}
              studentRevisionRequestDisabledReason={revBlock}
              orderTerminal={isTerminalOrder}
              revisionAccent="default"
              view={view}
            />

            {/* 학생과 대화 — 작업과 분리 */}
            <OrderProgressSection
              detail={detail}
              orderId={idForDisplay}
              view={view}
              actorRole={actorRole}
              hasOrderPartyAccess={!accessDenied}
              orderTerminal={isTerminalOrder}
              mentorStudentDisplayName={mentorStudentDisplayName}
            />

            {/* 문제 해결 */}
            <OrderDisputesPanel
              detail={detail}
              orderId={oid}
              actorRole={actorRole}
              hasOrderPartyAccess={!accessDenied}
              openDisputeApplicationDisabledReason={disputeFormBlock}
              orderTerminal={isTerminalOrder}
              view={view}
            />

            {/* 정산 내역 */}
            {hasRightSettlementBlockContent(detail, o as Row, actorRole) && (
              <section className="space-y-5 border-t border-ds-border-subtle pt-8">
                <h4 className="text-base font-bold text-slate-900">정산 내역</h4>
                <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                  <OrderPaymentSettlementBlock
                    detail={detail}
                    orderRow={o as Row}
                    orderId={oid}
                    actorRole={actorRole}
                    view={view}
                  />
                  <OrderSettlementLineCard detail={detail} view={view} />
                </div>
              </section>
            )}

            {/* D1: 진행 로그는 기본 접힘 — 펼칠 때만 노출 */}
            <details className="mt-2">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50/70 px-4 py-3 text-sm font-extrabold text-slate-700 hover:bg-slate-50">
                진행 로그
                <span className="text-xs font-medium text-slate-400">펼쳐 보기</span>
              </summary>
              <div className="mt-3">
                <OrderEventsLogPanel detail={detail} view={view} />
              </div>
            </details>
          </div>

          {/* RIGHT SIDEBAR: 진행 단계 + 의뢰 정보 + 접이식 안내 */}
          <aside className="w-full shrink-0 space-y-6 lg:w-[252px]">
            <OrderRightSidebarMentor
              detail={detail}
              view={view}
              isTerminalOrder={isTerminalOrder}
              orderIdDisplay={idForDisplay}
            />
            <MentorOrderRoomGuidanceCollapsible
              order={o as Row}
              disputeRows={detail.bundle.disputes.rows ?? []}
            />
          </aside>
        </div>
      </div>
    </div>
  );
}
