import Link from "next/link";
import type { ReactNode } from "react";
import { CheckCircle2, Clock, Inbox, MessageCircle, MessageCircleCheck, MessageSquareText, Paperclip, ReceiptText, ShieldCheck, WalletCards } from "lucide-react";
import { FormSubmitButton } from "@/components/common/FormSubmitButton";
import { EmptyState } from "@/components/common/EmptyState";
import { listCardClassName, type ListCardTone } from "@/components/design-system/ListCard";
import { getSubjectLabel } from "@/lib/subjects/subjectCatalog";
import {
  confirmIndividualQuestionAnswerAction,
  confirmIndividualQuestionAnswerByMentorAction,
  sendIndividualQuestionMessageAction,
} from "@/lib/individualQuestion/individualQuestionActions";
import {
  formatIndividualQuestionDate,
  formatIndividualQuestionExpiryRemaining,
  formatIndividualQuestionPrice,
  individualQuestionStatusBadgeClass,
  individualQuestionStatusLabel,
  individualQuestionTypeLabel,
  isIndividualQuestionExpiringSoon,
  type IndividualQuestionDetail,
  type IndividualQuestionListItem,
} from "@/lib/individualQuestion/individualQuestionQueries";

// 개별질문 상태 → 목록 카드 좌측 액센트 톤(상태 배지 색과 일치).
function iqCardTone(status: string | null | undefined): ListCardTone {
  switch ((status ?? "").toLowerCase()) {
    case "released":
      return "blue";
    case "answered":
      return "green";
    case "open":
    case "assigned":
    case "claimed":
    case "escrowed":
      return "amber";
    default:
      return "neutral"; // refunded / expired / canceled
  }
}

/** 멘토 개별질문 요약 스트립 — 답변 대기 / 진행 중 / 이번 달 완료 (숫자는 목록 데이터로 계산). */
export function MentorIndividualQuestionSummaryStrip(props: {
  waiting: number;
  inProgress: number;
  doneThisMonth: number;
}) {
  // 의미색 위계: 답변 대기=주황(살짝 강조), 진행 중=초록(멘토 정체성), 이번 달 완료=중립 회색.
  const cells = [
    {
      label: "답변 대기",
      value: props.waiting,
      Icon: Inbox,
      card: "border-amber-200 bg-amber-50/60",
      tile: "bg-amber-100 text-amber-600",
      num: "text-amber-700",
      lab: "text-amber-700",
    },
    {
      label: "진행 중",
      value: props.inProgress,
      Icon: MessageCircle,
      card: "border-slate-200 bg-white",
      tile: "bg-emerald-50 text-[#059669]",
      num: "text-slate-900",
      lab: "text-slate-500",
    },
    {
      label: "이번 달 완료",
      value: props.doneThisMonth,
      Icon: CheckCircle2,
      card: "border-slate-200 bg-white",
      tile: "bg-slate-100 text-slate-500",
      num: "text-slate-700",
      lab: "text-slate-500",
    },
  ];
  return (
    <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
      {cells.map(({ label, value, Icon, card, tile, num, lab }) => (
        <div key={label} className={`flex items-center gap-3 rounded-xl border-[0.5px] p-3 sm:p-4 ${card}`}>
          <div className={`flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-xl ${tile}`}>
            <Icon className="h-5 w-5" aria-hidden />
          </div>
          <div className="min-w-0">
            <p className={`text-xl font-black leading-none tabular-nums sm:text-2xl ${num}`}>{value}</p>
            <p className={`mt-1 break-keep text-xs font-bold ${lab}`}>{label}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

function ExpiringSoonBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-rose-100 bg-rose-50 px-2.5 py-1 text-xs font-extrabold text-rose-600">
      <Clock className="h-3 w-3" aria-hidden />
      마감 임박
    </span>
  );
}

function SectionTitle(props: { title: string; hint?: string; right?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <h2 className="cr-section-title-v5">
          <span className="bar" aria-hidden />
          {props.title}
        </h2>
        {props.hint ? <p className="mt-1 text-sm text-slate-500">{props.hint}</p> : null}
      </div>
      {props.right}
    </div>
  );
}

export function IndividualQuestionStatusBadge(props: { status: string | null | undefined }) {
  return (
    <span className={`rounded-full border px-2.5 py-1 text-xs font-extrabold ${individualQuestionStatusBadgeClass(props.status)}`}>
      {individualQuestionStatusLabel(props.status)}
    </span>
  );
}

export function IndividualQuestionListCards(props: {
  rows: IndividualQuestionListItem[];
  emptyTitle: string;
  emptyDescription: string;
  detailBaseHref: string;
  counterpartLabel: "멘토" | "학생";
}) {
  if (props.rows.length === 0) {
    return (
      <EmptyState compact icon={<Inbox className="h-5 w-5" aria-hidden />} title={props.emptyTitle} description={props.emptyDescription} />
    );
  }

  return (
    <div className="grid gap-4">
      {props.rows.map((row) => {
        const counterpart = props.counterpartLabel === "멘토" ? row.mentorName : row.studentName;
        const expiringSoon = isIndividualQuestionExpiringSoon(row.expires_at, row.status);
        const remainingLabel = formatIndividualQuestionExpiryRemaining(row.expires_at, row.status);
        return (
          <Link
            key={row.id}
            href={`${props.detailBaseHref}/${row.id}`}
            className={listCardClassName(iqCardTone(row.status), true, "group block")}
          >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <IndividualQuestionStatusBadge status={row.status} />
                  <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-600">
                    {individualQuestionTypeLabel(row.question_type)}
                  </span>
                  {row.subject ? (
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-600">
                      {getSubjectLabel(row.subject)}
                      {row.topic ? ` · ${row.topic}` : ""}
                    </span>
                  ) : null}
                  <span className="text-xs font-bold text-slate-900">{formatIndividualQuestionPrice(row.price_cents)} 안전 결제</span>
                  {expiringSoon ? <ExpiringSoonBadge /> : null}
                </div>
                <h2 className="mt-2 truncate text-lg font-black text-slate-900 group-hover:text-blue-700">{row.title}</h2>
                <p className="mt-1 line-clamp-2 text-sm leading-6 text-slate-600">{row.body}</p>
                {remainingLabel ? (
                  <p className={`mt-2 text-xs font-bold ${expiringSoon ? "text-rose-600" : "text-slate-500"}`}>{remainingLabel}</p>
                ) : null}
              </div>
              <dl className="grid min-w-[180px] gap-2 rounded-xl bg-slate-50 px-4 py-3 text-sm">
                <div>
                  <dt className="text-xs font-bold text-slate-500">{props.counterpartLabel}</dt>
                  <dd className="mt-0.5 font-extrabold text-slate-900">{counterpart}</dd>
                </div>
                <div>
                  <dt className="text-xs font-bold text-slate-500">등록일</dt>
                  <dd className="mt-0.5 font-extrabold text-slate-900">{formatIndividualQuestionDate(row.created_at)}</dd>
                </div>
              </dl>
            </div>
          </Link>
        );
      })}
    </div>
  );
}

// [D-IQ-8] 사문(死文) OpenIndividualQuestionBrowseCards 제거. 어느 라우트도 import하지 않았고
// (멘토 목록은 OpenQuestionBoard 사용), 자체 claim 폼을 보유해 되살리면 claim 경로가 이원화된다.

type IqAttachment = IndividualQuestionDetail["attachments"][number];

function isImageAttachment(att: IqAttachment): boolean {
  const mime = (att.mime_type ?? "").toLowerCase();
  if (mime.startsWith("image/")) return true;
  return /\.(png|jpe?g|webp|gif)$/i.test(att.file_name ?? "");
}

// 첨부 인라인 렌더 — 이미지는 썸네일(클릭 확대), 그 외는 파일칩. 질문 카드·메시지 버블 공용.
function AttachmentInline(props: { attachments: IqAttachment[] }) {
  if (props.attachments.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {props.attachments.map((att) =>
        !att.signedUrl ? (
          <span key={att.id} className="rounded-lg bg-white/70 px-2.5 py-1.5 text-xs font-semibold text-slate-400">
            열람 불가
          </span>
        ) : isImageAttachment(att) ? (
          <Link key={att.id} href={att.signedUrl} target="_blank" rel="noreferrer" className="block">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={att.signedUrl}
              alt={att.file_name || "첨부 이미지"}
              className="max-h-48 rounded-xl border border-slate-200 bg-white object-contain"
            />
          </Link>
        ) : (
          <Link
            key={att.id}
            href={att.signedUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-w-0 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-extrabold text-slate-800 hover:bg-slate-50"
          >
            <Paperclip className="h-4 w-4 shrink-0 text-blue-600" aria-hidden />
            <span className="max-w-[180px] truncate">{att.file_name || "첨부 파일"}</span>
          </Link>
        )
      )}
    </div>
  );
}

export function IndividualQuestionDetailView(props: {
  detail: IndividualQuestionDetail;
  backHref: string;
  backLabel: string;
  actor: "student" | "mentor";
  flash?: string | null;
  warning?: string | null;
  transfer?: { roomId: string | null; threadId: string | null; transferredAt?: string | null } | null;
}) {
  const { detail, actor } = props;
  const transferThreadHref =
    props.transfer?.roomId && props.transfer?.threadId
      ? `/question-room/${props.transfer.roomId}/thread/${props.transfer.threadId}`
      : null;
  const counterpartName = actor === "student" ? detail.mentorName : detail.studentName;
  const counterpartLabel = actor === "student" ? (detail.question_type === "open" ? "답변 멘토" : "담당 멘토") : "학생";
  // 메시지 발신자 판별용 멘토 id(공개형은 claim된 멘토, 지정형은 지정 멘토). 질문 행에서만 읽어 RLS 영향 없음.
  const mentorUserId = detail.claimed_mentor_id ?? detail.designated_mentor_id;

  // 질문 자체 첨부(message_id 없음)와 메시지별 첨부 분리.
  const questionAttachments = detail.attachments.filter((a) => !a.message_id);
  const attachmentsByMessage = new Map<string, IqAttachment[]>();
  for (const att of detail.attachments) {
    if (!att.message_id) continue;
    const list = attachmentsByMessage.get(att.message_id) ?? [];
    list.push(att);
    attachmentsByMessage.set(att.message_id, list);
  }

  const status = (detail.status ?? "").toLowerCase();
  const terminal = status === "released" || status === "refunded" || status === "expired" || status === "canceled";
  const canCompose = !terminal;
  const canMentorConfirm = actor === "mentor" && (status === "assigned" || status === "claimed");
  const canStudentConfirm = actor === "student" && status === "answered";
  const answeredWaiting = actor === "mentor" && status === "answered";

  // ── 표시 전용 파생값(가드 미접근). 학생=파랑 / 멘토=초록 액센트, 주문방과 같은 톤.
  const isStudent = actor === "student";
  const refunded = status === "refunded";
  const expired = status === "expired" || status === "canceled";
  const released = status === "released";
  const accent = isStudent
    ? {
        eyebrow: "bg-blue-50 text-blue-700",
        safeChip: "border-blue-200 bg-blue-50 text-blue-700",
        turnChip: "bg-blue-600 text-white",
        cardLabel: "text-blue-700",
        ring: "ring-blue-100 focus:border-blue-400",
        btn: "bg-blue-600 hover:bg-blue-700",
        mine: "bg-blue-600",
        receiptBox: "border-blue-100 bg-blue-50/50",
        icon: "text-blue-600",
      }
    : {
        eyebrow: "bg-emerald-50 text-emerald-700",
        safeChip: "border-emerald-200 bg-emerald-50 text-emerald-700",
        turnChip: "bg-emerald-600 text-white",
        cardLabel: "text-emerald-700",
        ring: "ring-emerald-100 focus:border-emerald-400",
        btn: "bg-emerald-600 hover:bg-emerald-700",
        mine: "bg-emerald-600",
        receiptBox: "border-emerald-100 bg-emerald-50/50",
        icon: "text-emerald-600",
      };

  const amountLabel = formatIndividualQuestionPrice(detail.price_cents);
  // 안전 결제 칩 문구 — 주문방과 통일. 답변 전엔 "안전 보관 중", 정산/환불 후엔 결과 표시(서버 상태 기반).
  const safeChipText = released ? "정산 완료" : refunded || expired ? "환불 완료" : "안전 보관 중";
  // 멘토 히어로 상태 아이콘 앵커(주문방과 동일 원리): 답변완료(조치 대기)=주황, 환불/만료=중립, 그 외 진행=초록.
  const iqHeroIcon =
    status === "answered"
      ? { tile: "bg-amber-50", fg: "text-amber-600", Icon: MessageCircleCheck }
      : refunded || expired
        ? { tile: "bg-slate-100", fg: "text-slate-500", Icon: MessageCircleCheck }
        : released
          ? { tile: "bg-emerald-50", fg: "text-[#059669]", Icon: MessageCircleCheck }
          : { tile: "bg-emerald-50", fg: "text-[#059669]", Icon: MessageCircle };

  // 큰 상태 문장(주인공) + 누구 차례 — 액터별 관점. 순수 표시값, 상태에서 파생만.
  const hero: { headline: string; guide: string; guideMobile?: string } = (() => {
    if (isStudent) {
      if (released) return { headline: "답변을 받았어요", guide: "질문이 완료됐어요. 받은 답변과 결제 내역을 아래에서 확인할 수 있어요.", guideMobile: "받은 답변을 아래에서 확인하세요." };
      if (refunded) return { headline: "안전 보관 중이던 캐시를 돌려받았어요", guide: "질문이 취소되어 안전 보관 중이던 캐시가 환불됐어요." };
      if (expired) return { headline: "답변 기간이 지났어요", guide: "기간 내 답변이 없어 안전 보관 중이던 캐시가 환불 처리됐어요." };
      if (status === "answered") return { headline: "멘토가 답변했어요. 확인해 주세요", guide: "답변을 확인하고 도움이 됐다면 [해결 완료]를 눌러 주세요.", guideMobile: "확인 후 [해결 완료]를 눌러 주세요." };
      if (status === "claimed") return { headline: "멘토가 답변을 준비하고 있어요", guide: "멘토가 질문을 맡았어요. 답변이 도착하면 여기에 표시돼요.", guideMobile: "답변이 도착하면 알려드려요." };
      if (status === "open") return { headline: "멘토 답변을 기다리고 있어요", guide: "공개 질문이 등록됐어요. 멘토가 답변을 맡으면 알려드릴게요.", guideMobile: "멘토가 맡으면 알려드릴게요." };
      return { headline: "멘토 답변을 기다리고 있어요", guide: "지정한 멘토에게 질문이 전달됐어요. 답변을 준비하면 여기에 표시돼요.", guideMobile: "답변을 준비하면 알려드려요." };
    }
    if (released) return { headline: "답변이 완료됐어요", guide: "학생이 답변을 확정해 정산이 끝났어요. 수고하셨어요.", guideMobile: "정산이 끝났어요. 수고하셨어요." };
    if (refunded) return { headline: "질문이 환불됐어요", guide: "학생이 질문을 취소해 안전 보관 중이던 캐시가 환불됐어요." };
    if (expired) return { headline: "답변 기간이 지났어요", guide: "기간 내 답변이 없어 안전 보관 중이던 캐시가 환불 처리됐어요." };
    if (status === "answered") return { headline: "답변을 확정했어요", guide: "학생이 [해결 완료]를 누르면 정산돼요. 보충 설명은 계속 보낼 수 있어요.", guideMobile: "해결 완료 시 정산돼요. 보충 설명 가능." };
    if (status === "claimed") return { headline: "답변을 맡았어요", guide: "답변을 작성하고 확정하면 학생 확인을 요청해요.", guideMobile: "답변을 작성하고 확정해 주세요." };
    return { headline: "학생 질문이 도착했어요", guide: "학생이 캐시를 안전 결제하고 답변을 기다리고 있어요. 답변을 작성해 확정해 주세요.", guideMobile: "답변을 작성해 확정해 주세요." };
  })();

  // 누구 차례인지 — 내 차례 / 상대 대기 / 종료(표시 전용).
  const heroTurn: "mine" | "waiting" | "done" = terminal
    ? "done"
    : isStudent
      ? status === "answered"
        ? "mine"
        : "waiting"
      : status === "assigned" || status === "claimed"
        ? "mine"
        : "waiting";
  const waitingLabel = isStudent ? "멘토를 기다리는 중" : "학생 확인을 기다리는 중";

  return (
    <div className="cr-landing cr-detail-v5 cr-detail-shell mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 lg:px-8">
      <article className="cr-detail-card">
        {/* 큰 상태 문장이 주인공: 지금 무슨 상태고 누구 차례인지 사람 말로(주문방과 통일). */}
        <header className="cr-detail-header">
          {isStudent ? (
            <>
              <span className={`inline-block rounded-full px-3.5 py-1.5 text-[13px] font-extrabold ${accent.eyebrow}`}>
                개별 질문 · {individualQuestionTypeLabel(detail.question_type)}
              </span>
              <div className="cr-detail-header-row">
                <h1 className="cr-detail-title max-md:!text-[1.2rem]">{hero.headline}</h1>
                <IndividualQuestionStatusBadge status={detail.status} />
              </div>
              <p className="cr-detail-subtitle">
                {hero.guideMobile ? (
                  <>
                    <span className="md:hidden">{hero.guideMobile}</span>
                    <span className="hidden md:inline">{hero.guide}</span>
                  </>
                ) : (
                  hero.guide
                )}
              </p>
            </>
          ) : (
            <div className="flex items-start gap-3.5">
              <span className={`flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-xl ${iqHeroIcon.tile} ${iqHeroIcon.fg}`}>
                <iqHeroIcon.Icon className="h-5 w-5" aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <span className={`inline-block rounded-full px-3.5 py-1.5 text-[13px] font-extrabold ${accent.eyebrow}`}>
                    개별 질문 · {individualQuestionTypeLabel(detail.question_type)}
                  </span>
                  <IndividualQuestionStatusBadge status={detail.status} />
                </div>
                <h1 className="cr-detail-title mt-1.5">{hero.headline}</h1>
                <p className="cr-detail-subtitle">
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
          )}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-extrabold ${accent.safeChip}`}>
              <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
              {amountLabel} {safeChipText}
            </span>
            {heroTurn === "mine" ? (
              <span className={`inline-flex items-center rounded-full px-3 py-1.5 text-xs font-extrabold ${accent.turnChip}`}>
                지금 내 차례예요
              </span>
            ) : heroTurn === "waiting" ? (
              <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-bold text-slate-600">
                {waitingLabel}
              </span>
            ) : (
              <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-bold text-slate-600">
                거래 종료
              </span>
            )}
          </div>
        </header>

        {props.flash ? (
          <p className="mb-4 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-bold text-blue-900">{props.flash}</p>
        ) : null}
        {props.warning ? (
          <p className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-900">{props.warning}</p>
        ) : null}

        {props.transfer ? (
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3">
            <p className="text-sm font-bold text-blue-900">
              이 개별 질문은 구독 질문방으로 이어졌어요. 이어서 대화하려면 구독 질문방에서 확인하세요.
            </p>
            {transferThreadHref ? (
              <Link
                href={transferThreadHref}
                className="shrink-0 rounded-lg border border-blue-200 bg-white px-3 py-1.5 text-xs font-extrabold text-blue-700 hover:bg-blue-100"
              >
                구독 질문방에서 보기 →
              </Link>
            ) : null}
          </div>
        ) : null}

        {/* 질문 카드 — 본문·첨부 미리보기를 상단에 고정해 대화 중에도 보이게 */}
        <section className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className={`text-xs font-extrabold ${accent.cardLabel}`}>질문 내용</span>
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-500">
              {counterpartLabel} {counterpartName}
            </span>
          </div>
          <h2 className="mt-2 text-lg font-black leading-snug text-slate-900">{detail.title}</h2>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-7 text-slate-700">{detail.body}</p>
          <div className="mt-3 flex flex-wrap gap-2 text-xs font-bold text-slate-500">
            {detail.subject ? <span className="rounded-full bg-slate-100 px-2.5 py-1">과목 {getSubjectLabel(detail.subject)}</span> : null}
            {detail.topic ? <span className="rounded-full bg-slate-100 px-2.5 py-1">단원 {detail.topic}</span> : null}
            <span className="rounded-full bg-slate-100 px-2.5 py-1">등록 {formatIndividualQuestionDate(detail.created_at)}</span>
          </div>
          <AttachmentInline attachments={questionAttachments} />
        </section>

        <hr className="cr-detail-divider" />

        {/* 대화 스레드 */}
        <section>
          <SectionTitle
            title={released ? "받은 답변" : "대화"}
            hint={
              detail.messages.length > 0
                ? "멘토와 학생이 주고받은 메시지입니다."
                : terminal
                  ? "주고받은 메시지 없이 종료됐어요."
                  : isStudent
                    ? "멘토가 답변하면 여기에 표시돼요."
                    : "학생 질문을 확인하고 첫 답변을 보내 보세요."
            }
            right={
              <span className="inline-flex items-center gap-1 rounded-full bg-slate-50 px-3 py-1 text-xs font-bold text-slate-600">
                <MessageSquareText className="h-3.5 w-3.5" aria-hidden />
                {detail.messages.length}건
              </span>
            }
          />
          {detail.messages.length > 0 ? (
            <ol className="space-y-3">
              {detail.messages.map((message) => {
                // 발신자 역할은 질문 자체의 id(본인이 읽을 수 있는 값)로 판별 — 상대 users 행은
                // RLS(users_select_own)로 못 읽어 authorRole이 'unknown'이 되므로 의존하지 않는다.
                const role: "student" | "mentor" | "unknown" =
                  message.author_id === detail.student_id
                    ? "student"
                    : mentorUserId && message.author_id === mentorUserId
                      ? "mentor"
                      : message.authorRole; // 안전망(본인 메시지 등 해석 가능한 경우)
                const mine = role === actor;
                const atts = attachmentsByMessage.get(message.id) ?? [];
                const otherLabel = role === "mentor" ? "멘토" : role === "student" ? "학생" : "상대";
                const initial = mine ? "나" : role === "mentor" ? "멘" : role === "student" ? "학" : "·";
                return (
                  <li key={message.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                    <div className={`flex max-w-[82%] gap-2 ${mine ? "flex-row-reverse" : "flex-row"}`}>
                      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-black text-slate-600">
                        {initial}
                      </span>
                      <div className="min-w-0">
                        <div className={`rounded-2xl px-4 py-3 ${mine ? `${accent.mine} text-white` : "border border-slate-200 bg-white text-slate-700"}`}>
                          <p className="whitespace-pre-wrap text-sm leading-7">{message.body}</p>
                          <AttachmentInline attachments={atts} />
                        </div>
                        <p className={`mt-1 text-[11px] font-semibold text-slate-400 ${mine ? "text-right" : "text-left"}`}>
                          {mine ? "나" : otherLabel} · {formatIndividualQuestionDate(message.created_at)}
                        </p>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>
          ) : (
            <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-slate-200 bg-slate-50/60 px-4 py-8 text-center">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-slate-400 shadow-sm">
                <MessageSquareText className="h-5 w-5" aria-hidden />
              </span>
              <p className="text-sm font-bold text-slate-600">
                {terminal
                  ? "이 질문은 종료되어 더 이상 메시지를 주고받을 수 없어요."
                  : isStudent
                    ? "멘토가 답변하면 여기에 표시돼요."
                    : "학생 질문을 확인하고 답변을 보내 보세요."}
              </p>
              {!terminal ? (
                <p className="text-xs font-medium text-slate-400">
                  {isStudent ? "추가로 설명할 내용이 있으면 아래에서 메시지를 보낼 수 있어요." : "아래에서 답변·메시지를 작성해 보낼 수 있어요."}
                </p>
              ) : null}
            </div>
          )}
        </section>

        {/* 메시지 입력바 — 멘토·학생 공통(서버가 작성자 판별) */}
        {canCompose ? (
          <>
            <hr className="cr-detail-divider" />
            <form action={sendIndividualQuestionMessageAction} className="space-y-2">
              <input type="hidden" name="questionId" value={detail.id} />
              <textarea
                name="body"
                rows={4}
                className={`w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm leading-7 text-slate-900 outline-none transition placeholder:text-slate-400 focus:ring-4 ${accent.ring}`}
                placeholder={actor === "mentor" ? "학생에게 보낼 답변·메시지를 작성하세요." : "멘토에게 보낼 메시지를 작성하세요."}
              />
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label className="inline-flex cursor-pointer items-center gap-2 text-xs font-bold text-slate-600">
                  <Paperclip className={`h-4 w-4 ${accent.icon}`} aria-hidden />
                  <span>파일 첨부</span>
                  <input
                    type="file"
                    name="attachment"
                    accept=".jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf"
                    className="sr-only"
                  />
                </label>
                <FormSubmitButton
                  idleLabel="보내기"
                  pendingLabel="전송 중..."
                  className={`rounded-xl px-5 py-2.5 text-sm font-extrabold text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-60 ${accent.btn}`}
                />
              </div>
            </form>
          </>
        ) : null}

        {/* 멘토 답변 확정 */}
        {canMentorConfirm ? (
          <>
            <hr className="cr-detail-divider" />
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-bold text-slate-700">답변을 모두 작성했다면 확정해 학생 확인을 요청하세요.</p>
                <span className="inline-flex items-center gap-1 rounded-full bg-white px-3 py-1 text-xs font-bold text-emerald-700">
                  <WalletCards className="h-3.5 w-3.5" aria-hidden />
                  학생 확정 시 정산
                </span>
              </div>
              <form action={confirmIndividualQuestionAnswerByMentorAction} className="mt-3 flex justify-end">
                <input type="hidden" name="questionId" value={detail.id} />
                <FormSubmitButton
                  idleLabel="답변 확정"
                  pendingLabel="처리 중..."
                  className="rounded-xl bg-emerald-600 px-5 py-3 text-sm font-extrabold text-white shadow-sm hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
                />
              </form>
            </div>
          </>
        ) : null}

        {answeredWaiting ? (
          <p className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50/60 px-4 py-3 text-sm font-bold text-emerald-800">
            답변을 확정했어요. 학생이 [해결 완료]를 누르면 안전 보관 중인 캐시가 정산돼요. 보충 설명은 계속 보낼 수 있어요.
          </p>
        ) : null}

        {/* 학생 해결 완료(→ 정산) */}
        {canStudentConfirm ? (
          <>
            <hr className="cr-detail-divider" />
            <div className="rounded-2xl border border-blue-200 bg-blue-50/60 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm leading-6 text-slate-700">
                  멘토 답변이 도착했어요. 내용을 확인하고 도움이 됐다면 아래 [해결 완료]를 눌러 주세요. 누르기 전까지 캐시는 안전하게 보관돼요.
                </p>
                <span className="inline-flex items-center gap-1 rounded-full bg-white px-3 py-1 text-xs font-bold text-blue-700">
                  <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
                  완료 시 정산
                </span>
              </div>
              <form action={confirmIndividualQuestionAnswerAction} className="mt-3 flex justify-end">
                <input type="hidden" name="questionId" value={detail.id} />
                <FormSubmitButton
                  idleLabel="해결 완료"
                  pendingLabel="처리 중..."
                  className="rounded-xl bg-blue-600 px-5 py-3 text-sm font-extrabold text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                />
              </form>
            </div>
          </>
        ) : null}

        {/* 완료/환불 영수증 — 종료된 질문은 결과를 정적으로 보여준다(금액·일시는 서버값). */}
        {terminal ? (
          <>
            <hr className="cr-detail-divider" />
            <section className={`rounded-2xl border p-5 ${accent.receiptBox}`}>
              <div className="flex items-center gap-2">
                <ReceiptText className={`h-5 w-5 ${accent.icon}`} aria-hidden />
                <h2 className="text-base font-black text-slate-900">{released ? "정산 영수증" : "환불 영수증"}</h2>
              </div>
              <p className="mt-1 text-sm font-medium text-slate-600">
                {released
                  ? isStudent
                    ? "질문이 완료됐어요. 안전 보관 중이던 캐시가 멘토에게 정산됐어요."
                    : "학생이 답변을 확정해 정산이 끝났어요. 수고하셨어요."
                  : expired
                    ? "답변 기간이 지나 안전 보관 중이던 캐시가 환불 처리됐어요."
                    : "안전 보관 중이던 캐시가 환불됐어요."}
              </p>
              <dl className="mt-4 overflow-hidden rounded-xl border border-slate-100 bg-white text-sm">
                <div className="flex items-center justify-between gap-3 px-4 py-3">
                  <dt className="font-bold text-slate-500">{isStudent ? "안전 결제 금액" : "학생 결제 금액"}</dt>
                  <dd className="font-extrabold tabular-nums text-slate-900">{amountLabel}</dd>
                </div>
                <div className="flex items-center justify-between gap-3 border-t border-slate-100 px-4 py-3">
                  <dt className="font-bold text-slate-500">결제 일시</dt>
                  <dd className="font-extrabold text-slate-900">{formatIndividualQuestionDate(detail.created_at)}</dd>
                </div>
                {released && detail.released_at ? (
                  <div className="flex items-center justify-between gap-3 border-t border-slate-100 px-4 py-3">
                    <dt className="font-bold text-slate-500">정산 완료 일시</dt>
                    <dd className="font-extrabold text-slate-900">{formatIndividualQuestionDate(detail.released_at)}</dd>
                  </div>
                ) : null}
                {!released && detail.refunded_at ? (
                  <div className="flex items-center justify-between gap-3 border-t border-slate-100 px-4 py-3">
                    <dt className="font-bold text-slate-500">환불 일시</dt>
                    <dd className="font-extrabold text-slate-900">{formatIndividualQuestionDate(detail.refunded_at)}</dd>
                  </div>
                ) : null}
                <div className="flex items-center justify-between gap-3 border-t border-slate-100 px-4 py-3">
                  <dt className="font-bold text-slate-500">상태</dt>
                  <dd>
                    <IndividualQuestionStatusBadge status={detail.status} />
                  </dd>
                </div>
              </dl>
              {!isStudent && released ? (
                <p className="mt-3 text-xs font-medium leading-5 text-slate-500">
                  플랫폼 수수료(15%) 차감 후 실수령액은 <span className="font-bold text-slate-600">[정산]</span> 페이지에서 확인할 수 있어요.
                </p>
              ) : null}
            </section>
          </>
        ) : null}

        <div className="mt-8 flex flex-wrap gap-2">
          <Link
            href={props.backHref}
            className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-extrabold text-slate-700 hover:bg-slate-50"
          >
            ← {props.backLabel}
          </Link>
        </div>
      </article>
    </div>
  );
}
