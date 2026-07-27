import { pickDisplayField } from "@/lib/customRequest/customRequestQueries";
import { submitCustomOrderRoomMessageAction } from "@/lib/customRequest/orderMessageActions";
import type { OrderDetailPageData } from "@/lib/customRequest/orderDetailQueries";
import { EmptyState } from "@/components/design-system";
import { Avatar } from "@/components/common/Avatar";
import {
  orderPartyLabelForMessage,
  pickOrderMentorIdFromRow,
  pickOrderStudentId,
} from "@/lib/customRequest/orderRoomMutations";
import type { AppRole } from "@/lib/types/user";
import { Download, FileText, Image as ImageIcon, MessageSquare, Paperclip, User } from "lucide-react";

type Row = Record<string, unknown>;
type MessageAttachmentView = OrderDetailPageData["messageAttachmentsByMessageId"][string][number];

const ORDER_MESSAGE_ATTACHMENT_ACCEPT =
  "application/pdf,image/png,image/jpeg,image/webp,application/zip,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.presentationml.presentation,.pdf,.png,.jpg,.jpeg,.webp,.zip,.docx,.pptx";

type Props = {
  detail: OrderDetailPageData;
  orderId: string;
  view: "student" | "mentor";
  actorRole: AppRole;
  hasOrderPartyAccess: boolean;
  orderTerminal?: boolean;
  embedded?: boolean;
  /** 멘토 뷰 — 학생 메시지 발신자 라벨(서버 RPC 조회) */
  mentorStudentDisplayName?: string;
};

function messageText(m: Row) {
  return pickDisplayField(m, ["body"]);
}

function attachmentsForMessage(detail: OrderDetailPageData, message: Row): MessageAttachmentView[] {
  const id = message.id == null ? "" : String(message.id);
  if (!id) return [];
  return detail.messageAttachmentsByMessageId[id] ?? [];
}

function OrderMessageAttachmentPreviewList({
  attachments,
  isOwnMessage,
}: {
  attachments: MessageAttachmentView[];
  isOwnMessage: boolean;
}) {
  if (attachments.length === 0) {
    return null;
  }

  return (
    <div className="mt-2 space-y-2">
      {attachments.map((attachment) => {
        const canOpen = Boolean(attachment.signedUrl);
        const cardClass = isOwnMessage
          ? "border-white/70 bg-white text-slate-900 hover:border-blue-200"
          : "border-ds-border-subtle bg-white text-slate-900 hover:border-blue-200";

        return (
          <a
            key={attachment.id}
            href={attachment.signedUrl ?? undefined}
            target="_blank"
            rel="noopener noreferrer"
            aria-disabled={!canOpen}
            className={`block overflow-hidden rounded-xl border ${cardClass} transition ${
              canOpen ? "cursor-pointer" : "cursor-not-allowed opacity-70"
            }`}
          >
            {attachment.isImage && attachment.signedUrl ? (
              <div className="bg-slate-50">
                {/* 서명 URL(단기 만료·외부 최적화 불가) — next/image 미적용, 워크스페이스 첨부 렌더와 동일 관례 */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={attachment.signedUrl}
                  alt={attachment.fileName}
                  className="max-h-56 w-full object-contain"
                  loading="lazy"
                />
              </div>
            ) : null}
            <div className="flex items-center justify-between gap-3 p-3">
              <div className="flex min-w-0 items-center gap-2.5">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                  {attachment.isImage ? (
                    <ImageIcon className="h-4 w-4" strokeWidth={2.2} />
                  ) : (
                    <FileText className="h-4 w-4" strokeWidth={2.2} />
                  )}
                </div>
                <div className="min-w-0">
                  <p className="truncate text-[11px] font-bold">{attachment.fileName}</p>
                  <p className="text-[10px] font-semibold text-slate-500">
                    {[attachment.isPdf ? "PDF" : attachment.mimeType, attachment.displaySize]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
              </div>
              <Download className="h-4 w-4 shrink-0 text-slate-400" strokeWidth={2.2} />
            </div>
          </a>
        );
      })}
    </div>
  );
}

function formatMessageGroupDate(dateStr: unknown) {
  if (!dateStr) return "";
  try {
    const d = new Date(String(dateStr));
    const days = ["일", "월", "화", "수", "목", "금", "토"];
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    const day = days[d.getDay()];
    return `${yyyy}.${mm}.${dd} (${day})`;
  } catch {
    return "";
  }
}

function formatMessageTime(dateStr: unknown) {
  if (!dateStr) return "";
  try {
    const d = new Date(String(dateStr));
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    return `${hh}:${mm}`;
  } catch {
    return "";
  }
}

export function OrderProgressSection(props: Props) {
  if (props.view === "mentor") {
    return <OrderProgressSectionMentor {...props} />;
  }
  const {
    detail,
    orderId: orderIdProp,
    hasOrderPartyAccess,
    orderTerminal = false,
    embedded = false,
  } = props;
  const o = detail.bundle.order.row;
  const msg = detail.messages;
  const msgErr = msg.error;

  const orderIdFromRow = o ? String((o as Row).id ?? "") : "";
  const orderId = (String(orderIdProp).trim() || orderIdFromRow).trim();
  const studentId = pickOrderStudentId(o as Row | null);
  const mentorId = pickOrderMentorIdFromRow(o as Row | null);

  const rawMsgRows = (msg.rows ?? []) as Row[];
  const sortedMsgRows = [...rawMsgRows].sort((a, b) => {
    const tA = a.created_at ? new Date(String(a.created_at)).getTime() : 0;
    const tB = b.created_at ? new Date(String(b.created_at)).getTime() : 0;
    return tA - tB;
  });

  const showComposer = !orderTerminal && hasOrderPartyAccess && Boolean(orderId);

  let lastDateStr = "";

  return (
    <div className={embedded ? "space-y-4" : "rounded-xl border border-slate-200/90 bg-white p-5 shadow-sm space-y-4 hover:border-blue-100 transition duration-300"}>
      {!embedded ? (
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div>
            <h3 className="text-sm font-black text-slate-900 flex items-center gap-1.5">
              <span>주문방 채팅</span>
              <svg className="h-3.5 w-3.5 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
            </h3>
            <p className="mt-0.5 text-[10px] font-bold text-slate-400">대화 내용은 안전한 거래를 위해 저장됩니다.</p>
          </div>
          <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[8px] font-black text-blue-600">실시간 연동</span>
        </div>
      ) : null}

      <div className="min-h-[300px] max-h-[500px] overflow-y-auto pr-1 space-y-3 scroll-smooth">
        {msgErr && (
          <p className="text-xs text-amber-800 text-center bg-amber-50 p-2 rounded-lg">채팅 기록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.</p>
        )}
        {sortedMsgRows.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-slate-400 space-y-2">
            <svg className="h-8 w-8 text-slate-300" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
            </svg>
            <p className="text-xs font-bold">주고받은 대화 메시지가 아직 없습니다.</p>
          </div>
        ) : (
          sortedMsgRows.map((m, idx) => {
            const role = orderPartyLabelForMessage(m, o as Row | null, studentId, mentorId);
            const isMe = role === "학생";
            const senderName = role === "학생" ? "의뢰 학생" : `${detail.header.mentorName || "배정"} 멘토`;
            const dateStr = formatMessageGroupDate(m.created_at);
            const timeStr = formatMessageTime(m.created_at);
            const attachments = attachmentsForMessage(detail, m);

            const showDateHeader = dateStr !== lastDateStr;
            if (showDateHeader) {
              lastDateStr = dateStr;
            }

            return (
              <div key={String(m.id || idx)} className="space-y-2">
                {showDateHeader && (
                  <div className="flex items-center my-3">
                    <div className="flex-1 border-t border-slate-100" />
                    <span className="mx-3 text-[10px] font-black text-slate-400 bg-slate-50 px-2 py-0.5 rounded-full">{dateStr}</span>
                    <div className="flex-1 border-t border-slate-100" />
                  </div>
                )}

                <div className={`flex items-start gap-2.5 ${isMe ? "justify-end" : "justify-start"}`}>
                  {!isMe && (
                    <Avatar name={detail.header.mentorName || null} role="mentor" className="h-8 w-8 text-xs" />
                  )}
                  <div className={`flex flex-col space-y-0.5 max-w-[70%] ${isMe ? "items-end" : "items-start"}`}>
                    {!isMe && (
                      <span className="text-[10px] font-black text-slate-500">{senderName}</span>
                    )}
                    <div className="flex items-end gap-1.5">
                      {isMe && <span className="text-[9px] font-bold text-slate-400 tabular-nums">{timeStr}</span>}
                      <div
                        className={`rounded-2xl px-3.5 py-2 text-xs font-bold leading-relaxed shadow-sm ${
                          isMe
                            ? "bg-blue-600 text-white rounded-tr-none"
                            : "bg-slate-100/85 text-slate-800 rounded-tl-none border border-slate-200/50"
                        }`}
                      >
                        <p className="whitespace-pre-wrap">{messageText(m)}</p>
                        <OrderMessageAttachmentPreviewList attachments={attachments} isOwnMessage={isMe} />
                      </div>
                      {!isMe && <span className="text-[9px] font-bold text-slate-400 tabular-nums">{timeStr}</span>}
                    </div>
                  </div>
                  {isMe && (
                    <div className="h-8 w-8 shrink-0 rounded-full bg-blue-50 border border-blue-100 flex items-center justify-center text-xs font-black text-blue-600">
                      {role === "학생" ? "S" : "M"}
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {showComposer && (
        <form action={submitCustomOrderRoomMessageAction} className="pt-3 border-t border-slate-100">
          <input type="hidden" name="orderId" value={orderId} />
          <div className="relative flex items-center">
            <textarea
              name="messageBody"
              rows={2}
              placeholder="메시지를 입력해 주세요..."
              className="w-full rounded-xl border border-slate-200 bg-white pl-4 pr-20 py-2.5 text-xs font-bold text-slate-800 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 shadow-inner resize-none leading-normal"
              maxLength={4000}
            />
            <div className="absolute right-2 bottom-2 flex items-center gap-1.5">
              <label
                className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-blue-600"
                title="파일 첨부"
              >
                <Paperclip className="h-4 w-4" strokeWidth={2.2} />
                <input
                  type="file"
                  name="attachment"
                  accept={ORDER_MESSAGE_ATTACHMENT_ACCEPT}
                  className="sr-only"
                />
              </label>
              <button
                type="submit"
                className="rounded-lg bg-blue-600 px-3.5 py-1.5 text-xs font-black text-white hover:bg-blue-700 transition"
              >
                전송
              </button>
            </div>
          </div>
        </form>
      )}
    </div>
  );
}

/**
 * ========================================================
 * MENTOR ONLY VISUAL UPGRADES (SAFETY ENCAPSULATED)
 * ========================================================
 */

/** DB에 첨부 관련 열/메타가 있을 때만 표시(읽기 전용, 기존 select * 행 활용). */
function pickAttachmentFromMessage(m: Row): { href: string; label: string } | null {
  const urlKeys = ["file_url", "attachment_url", "file_uri", "download_url", "url"] as const;
  for (const k of urlKeys) {
    const v = m[k];
    if (typeof v === "string" && v.trim()) {
      const href = v.trim();
      if (href.startsWith("http://") || href.startsWith("https://") || href.startsWith("/")) {
        const labelRaw = pickDisplayField(m, [
          "original_filename",
          "file_name",
          "filename",
          "attachment_name",
          "name",
        ]);
        return { href, label: labelRaw !== "—" ? labelRaw : "첨부 파일" };
      }
    }
  }
  return null;
}

function MessageAttachmentChip({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="mt-2 flex max-w-sm items-center justify-between gap-4 rounded-xl border border-ds-border-subtle bg-white p-3 transition hover:border-blue-200 group text-left"
    >
      <div className="flex items-center gap-2.5 min-w-0">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-orange-50 text-orange-500 font-black text-[10px]">
          FILE
        </div>
        <div className="min-w-0">
          <p className="text-[11px] font-bold text-slate-800 truncate group-hover:text-blue-600 transition">
            {label}
          </p>
        </div>
      </div>
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-50 text-slate-400 group-hover:bg-blue-50 group-hover:text-blue-500 transition">
        <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
        </svg>
      </div>
    </a>
  );
}

function OrderProgressSectionMentor({
  detail,
  orderId: orderIdProp,
  hasOrderPartyAccess,
  orderTerminal = false,
  mentorStudentDisplayName,
}: Props) {
  const o = detail.bundle.order.row;
  const msg = detail.messages;
  const msgErr = msg.error;

  const orderIdFromRow = o ? String((o as Row).id ?? "") : "";
  const orderId = (String(orderIdProp).trim() || orderIdFromRow).trim();
  const studentId = pickOrderStudentId(o as Row | null);
  const mentorId = pickOrderMentorIdFromRow(o as Row | null);
  const studentSenderLabel = mentorStudentDisplayName?.trim() || "의뢰자";

  const rawMsgRows = (msg.rows ?? []) as Row[];
  const sortedMsgRows = [...rawMsgRows].sort((a, b) => {
    const tA = a.created_at ? new Date(String(a.created_at)).getTime() : 0;
    const tB = b.created_at ? new Date(String(b.created_at)).getTime() : 0;
    return tA - tB;
  });

  const showComposer = !orderTerminal && hasOrderPartyAccess && Boolean(orderId);
  const isEmptyChat = sortedMsgRows.length === 0 && !msgErr;
  const panelHeight =
    orderTerminal && isEmptyChat ? "min-h-0" : "min-h-[280px] max-h-[560px] flex flex-col";

  return (
    <div className={`flex flex-col ${panelHeight}`}>
      <div className="mb-6 space-y-1 border-b border-ds-border-subtle pb-4">
        <h3 className="text-base font-bold text-slate-900">주문방 채팅</h3>
        <p className="flex items-center gap-1.5 text-sm leading-relaxed text-slate-600">
          <svg className="h-3.5 w-3.5 shrink-0 opacity-70" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
          <span>대화 내용은 안전한 거래를 위해 저장됩니다.</span>
        </p>
      </div>

      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col overflow-hidden">
        <div className="min-h-[320px] flex-1 space-y-3 overflow-y-auto scroll-smooth py-2 pr-1">
          {msgErr ? (
            <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-center text-xs font-medium text-amber-900">
              채팅 기록을 불러오지 못했습니다.
            </p>
          ) : null}

          {isEmptyChat ? (
            <EmptyState
              icon={MessageSquare}
              title={orderTerminal ? "종료된 주문 대화방" : "주문방 대화"}
              description={
                orderTerminal
                  ? "이 주문은 종료되어 새 메시지를 보낼 수 없어요. 작업 파일과 요청사항은 아래에서 확인할 수 있어요."
                  : "아직 주고받은 메시지가 없습니다. 상대방에게 먼저 인사를 건너보세요."
              }
              className="py-8"
            />
          ) : null}

          {sortedMsgRows.map((m, idx) => {
            const role = orderPartyLabelForMessage(m, o as Row | null, studentId, mentorId);
            const isMe = role === "멘토";
            const senderName = role === "학생" ? studentSenderLabel : "나";
            const dateStr = formatMessageGroupDate(m.created_at);
            const prevDateStr = idx > 0 ? formatMessageGroupDate(sortedMsgRows[idx - 1]?.created_at) : "";
            const showDateHeader = Boolean(dateStr && dateStr !== prevDateStr);
            const timeStr = formatMessageTime(m.created_at);
            const bodyLine = messageText(m);
            const hasText = bodyLine !== "—" && bodyLine.trim().length > 0;
            const attachment = pickAttachmentFromMessage(m);
            const attachments = attachmentsForMessage(detail, m);

            return (
              <div key={String(m.id || idx)} className={showDateHeader ? "pt-2 first:pt-0" : ""}>
                {showDateHeader && dateStr ? (
                  <div className="mb-4 flex items-center justify-center py-1">
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-500">{dateStr}</span>
                  </div>
                ) : null}

                {isMe ? (
                  <div className="flex justify-end">
                    <div className="flex max-w-[70%] items-end gap-1.5 sm:max-w-md">
                      <span className="shrink-0 text-xs tabular-nums text-slate-400">{timeStr}</span>
                      <div className="min-w-0 rounded-2xl rounded-tr-md bg-emerald-600 px-4 py-2.5 text-sm font-medium leading-relaxed text-white">
                        {hasText ? (
                          <p className="whitespace-pre-wrap break-words">{bodyLine}</p>
                        ) : null}
                        <OrderMessageAttachmentPreviewList attachments={attachments} isOwnMessage={isMe} />
                        {attachment ? (
                          <MessageAttachmentChip href={attachment.href} label={attachment.label} />
                        ) : null}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-end gap-2.5">
                    <div
                      className="mb-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-200 text-slate-600"
                      aria-hidden
                    >
                      <User className="h-4 w-4" strokeWidth={2} />
                    </div>
                    <div className="flex min-w-0 max-w-[70%] flex-col items-start gap-1 sm:max-w-md">
                      <span className="px-0.5 text-xs font-semibold text-slate-600">{senderName}</span>
                      <div className="flex items-end gap-1.5">
                        <div className="min-w-0 rounded-2xl rounded-tl-md bg-slate-100 px-4 py-2.5 text-sm font-medium leading-relaxed text-slate-900">
                          {hasText ? (
                            <p className="whitespace-pre-wrap break-words">{bodyLine}</p>
                          ) : null}
                          <OrderMessageAttachmentPreviewList attachments={attachments} isOwnMessage={isMe} />
                          {attachment ? (
                            <MessageAttachmentChip href={attachment.href} label={attachment.label} />
                          ) : null}
                        </div>
                        <span className="shrink-0 text-xs tabular-nums text-slate-400">{timeStr}</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {showComposer ? (
          <div className="shrink-0 border-t border-ds-border-subtle pt-5">
            <form
              action={submitCustomOrderRoomMessageAction}
              className="flex items-center gap-3 rounded-xl border border-ds-border-subtle bg-slate-50/50 px-4 py-2 transition-colors focus-within:border-emerald-300 focus-within:bg-white"
            >
              <input type="hidden" name="orderId" value={orderId} />
              <input
                type="text"
                name="messageBody"
                placeholder="메시지를 입력하세요..."
                className="flex-1 border-none bg-transparent py-1.5 text-sm font-medium text-slate-900 outline-none placeholder:text-slate-500"
                maxLength={4000}
                autoComplete="off"
              />
              <div className="flex shrink-0 items-center gap-3">
                <label
                  className="cursor-pointer text-slate-500 transition hover:text-emerald-600"
                  title="파일 첨부"
                >
                  <Paperclip className="h-5 w-5" strokeWidth={2.2} />
                  <input
                    type="file"
                    name="attachment"
                    accept={ORDER_MESSAGE_ATTACHMENT_ACCEPT}
                    className="sr-only"
                  />
                </label>
                <button
                  type="submit"
                  className="inline-flex h-9 items-center justify-center rounded-xl bg-emerald-600 px-5 text-xs font-bold text-white transition-colors hover:bg-emerald-700"
                >
                  전송
                </button>
              </div>
            </form>
          </div>
        ) : (
          <div className="shrink-0 border-t border-ds-border-subtle bg-slate-50 px-4 py-3 text-center text-xs font-medium text-slate-500">
            이미 종료된 주문 대화방입니다.
          </div>
        )}
      </div>
    </div>
  );
}
