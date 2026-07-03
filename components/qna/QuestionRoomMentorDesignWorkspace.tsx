"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import { ConnectionNotesPanel } from "@/components/qna/ConnectionNotesPanel";
import { ArrowLeft, ChevronLeft, ChevronRight, Download, Eye, FileText, MessageCircle, Search, Send, User } from "lucide-react";
import { QuestionRoomAttachmentButton } from "@/components/qna/QuestionRoomAttachmentButton";
import { QuestionThreadAnswerCompleteButton } from "@/components/qna/QuestionThreadAnswerCompleteButton";
import { parseAttachmentMessageBody } from "@/lib/qna/questionRoomAttachmentDisplay";
import { StatusBadge, legacyToneToStatusBadgeTone } from "@/components/common/StatusBadge";
import { listCardClassName, type ListCardTone } from "@/components/design-system/ListCard";
import type { QuestionRoomSubscriptionContext } from "@/lib/qna/questionRoomStudentContext";
import type { WeeklyQuestionUsage } from "@/lib/qna/weeklyQuestionUsageDisplay";
// _threadStatusBadgeClass는 신규 StatusBadge로 대체됨 — 잔존 호출 없음(_ 접두로 미사용 표시)
void _threadStatusBadgeClass;

// 질문 상태 tone(답변대기=amber / 진행중=blue / 답변완료=emerald) → 목록 카드 톤(좌측 액센트 바).
const THREAD_TONE_TO_CARD_TONE: Record<"amber" | "blue" | "emerald", ListCardTone> = {
  amber: "amber",
  blue: "blue",
  emerald: "green",
};
import { sendQuestionMessageAction } from "@/lib/qna/questionRoomActions";
import {
  formatMinutesAgo,
  formatQuestionRoomDateTime,
  threadInRoomPath,
} from "@/lib/qna/formatQuestionRoomDisplay";
import type { QuestionRoomListPreview } from "@/lib/qna/questionRoomQueries";
import { readQuestionThreadWorkflowStatus } from "@/lib/qna/questionThreadStatus";
import { isQuestionThreadLockedForMessages } from "@/lib/qna/questionRoomUiLabels";
import {
  studentLabelForRoom,
  type StudentDisplayById,
} from "@/lib/qna/questionRoomMentorContext";
import {
  threadPreviewText,
  threadStatusBadgeClass as _threadStatusBadgeClass,
  threadStatusListLabel,
  threadSubjectChip,
  threadTitleFromRow,
  threadViewCount,
} from "@/lib/qna/questionRoomStudentDisplay";

type Row = Record<string, unknown>;
type SortKey = "newest" | "oldest";
type StatusFilter = "all" | "waiting" | "done";

function messageBody(m: Row): string {
  return (
    (typeof m.body === "string" && m.body) ||
    (typeof m.content === "string" && m.content) ||
    (typeof m.text === "string" && m.text) ||
    ""
  );
}

function messageAuthorId(m: Row): string | null {
  for (const k of ["author_id", "user_id", "sender_id"] as const) {
    const v = m[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

function renderMessageContent(body: string) {
  const trimmed = body.trim();
  if (!trimmed) return null;
  const attachment = parseAttachmentMessageBody(trimmed);
  if (attachment?.kind === "image") {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={attachment.url} alt="첨부 이미지" className="max-h-56 rounded-lg object-contain" />
    );
  }
  if (attachment?.kind === "file") {
    return (
      <a
        href={attachment.url}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-2 rounded-lg bg-white/15 px-2.5 py-1.5 underline-offset-2 hover:underline"
      >
        <FileText className="h-4 w-4 shrink-0" />
        <span className="truncate">{attachment.filename}</span>
        <Download className="h-3.5 w-3.5 shrink-0 opacity-70" />
      </a>
    );
  }
  const imgMatch = trimmed.match(/^(https?:\/\/\S+\.(png|jpe?g|gif|webp)(\?\S*)?)$/i);
  if (imgMatch) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={trimmed} alt="" className="max-h-48 rounded-lg object-contain" />
    );
  }
  return <span className="whitespace-pre-wrap break-words">{trimmed}</span>;
}

function threadMatchesFilter(t: Row, filter: StatusFilter): boolean {
  const w = readQuestionThreadWorkflowStatus(t);
  if (filter === "all") return true;
  if (filter === "waiting") return w === "pending";
  return w === "answered" || w === "confirmed";
}

function ChatSendButton(props: { disabled?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={props.disabled || pending}
      aria-label="전송"
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:bg-slate-200"
    >
      <Send className="h-4 w-4" />
    </button>
  );
}

export function QuestionRoomMentorDesignWorkspace(props: {
  currentUserId: string;
  roomId: string;
  threadId: string | null;
  rooms: { rows: Row[]; error: string | null; loading: boolean };
  threads: { rows: Row[]; error: string | null; loading: boolean };
  messages: { rows: Row[]; error: string | null; loading: boolean };
  notes: { rows: Row[]; error: string | null; loading: boolean };
  listPreviewsByRoomId: Record<string, QuestionRoomListPreview>;
  studentDisplays: StudentDisplayById;
  messageCountsByThreadId?: Record<string, number>;
  lastMessageByThreadId?: Record<string, Row>;
  unreadCountsByRoomId?: Record<string, number>;
  roomHrefBase?: string;
  draftMessageBody?: string;
  draftNoteBody?: string;
  formRevision?: string;
  actionFeedback?: { ok: string | null; error: string | null };
  /** true: 질문 상세(톡방) 화면 — 중앙 채팅 + 우측 연결노트만 */
  threadDetailMode?: boolean;
  /** 톡방에서 질문 목록(2단계)으로 돌아가는 경로 */
  backHref?: string | null;
  /** 이 학생의 구독 요금제·갱신 정보(읽기 전용 표시용). */
  subscriptionContext?: QuestionRoomSubscriptionContext | null;
  /** 이 학생의 이번 주 질문 사용/한도(읽기 전용 표시용). */
  studentWeeklyUsage?: WeeklyQuestionUsage | null;
}) {
  const rev = props.formRevision ?? "0";
  const roomBase = props.roomHrefBase ?? "/mentor/question-room";
  const detailMode = Boolean(props.threadDetailMode && props.threadId);
  const [roomSearch, setRoomSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [sort, setSort] = useState<SortKey>("newest");

  const currentRoom = useMemo(
    () => props.rooms.rows.find((r) => r && String(r.id) === String(props.roomId)) ?? null,
    [props.roomId, props.rooms.rows]
  );

  const studentName = currentRoom
    ? studentLabelForRoom(currentRoom, props.studentDisplays)
    : "이름 미설정";

  const filteredRooms = useMemo(() => {
    const q = roomSearch.trim().toLowerCase();
    return props.rooms.rows.filter((r) => {
      if (!r?.id) return false;
      if (!q) return true;
      return studentLabelForRoom(r, props.studentDisplays).toLowerCase().includes(q);
    });
  }, [props.rooms.rows, props.studentDisplays, roomSearch]);

  const filteredThreads = useMemo(
    () => props.threads.rows.filter((t) => threadMatchesFilter(t, statusFilter)),
    [props.threads.rows, statusFilter]
  );

  const sortedThreads = useMemo(() => {
    const list = [...filteredThreads];
    list.sort((a, b) => {
      const ta = new Date(String(a.created_at ?? 0)).getTime();
      const tb = new Date(String(b.created_at ?? 0)).getTime();
      return sort === "newest" ? tb - ta : ta - tb;
    });
    return list;
  }, [filteredThreads, sort]);

  // ★질문 목록 페이지네이션 (이미 로드된 배열 클라이언트 slice). 모바일 3 / 데스크탑 4.
  // 초기값=데스크탑값(SSR/hydration 일치) → 마운트 후 matchMedia로 보정.
  const THREADS_PER_PAGE_DESKTOP = 4;
  const [threadsPerPage, setThreadsPerPage] = useState(THREADS_PER_PAGE_DESKTOP);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const apply = () => setThreadsPerPage(mq.matches ? 3 : THREADS_PER_PAGE_DESKTOP);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);
  const [threadPage, setThreadPage] = useState(1);
  const threadTotalPages = Math.max(1, Math.ceil(sortedThreads.length / threadsPerPage));
  const safeThreadPage = Math.min(threadPage, threadTotalPages);
  useEffect(() => {
    if (threadPage > threadTotalPages) setThreadPage(threadTotalPages);
  }, [threadPage, threadTotalPages]);
  useEffect(() => {
    setThreadPage(1);
  }, [props.roomId, sort, statusFilter]);
  const pagedThreads = sortedThreads.slice(
    (safeThreadPage - 1) * threadsPerPage,
    safeThreadPage * threadsPerPage
  );

  const subjectChipsRoom = useMemo(() => {
    const chips = new Set<string>();
    for (const t of props.threads.rows) {
      for (const c of threadSubjectChip(t, [])) chips.add(c);
    }
    return [...chips].slice(0, 6);
  }, [props.threads.rows]);

  const selectedThread = useMemo(
    () => props.threads.rows.find((t) => String(t.id) === String(props.threadId)) ?? null,
    [props.threads.rows, props.threadId]
  );
  const selectedThreadTitle = selectedThread ? threadTitleFromRow(selectedThread) : "질문";
  const selectedThreadWorkflow = selectedThread
    ? readQuestionThreadWorkflowStatus(selectedThread)
    : ("pending" as const);
  const selectedThreadLocked = isQuestionThreadLockedForMessages(selectedThread);

  /* 연결 노트 패널 (공용 컴포넌트 — 멘토/학생 통합) */
  /* 학생 구독 요금제·이번 주 잔여 질문 카드 (읽기 전용, 멘토 중앙 헤더 상주) */
  const sub = props.subscriptionContext ?? null;
  const usage = props.studentWeeklyUsage ?? null;
  const hasPlan = Boolean(sub && (sub.planTier || (usage && (usage.limit > 0 || usage.planTier))));
  const usageUnlimited = Boolean(usage && usage.limit >= 999);
  const studentPlanCard = sub ? (
    <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-[11px] font-bold">
      {hasPlan ? (
        <>
          <span className="rounded-full bg-emerald-600 px-2 py-0.5 text-[10px] font-extrabold text-white">
            {sub.planLabel}
          </span>
          <span className="text-slate-700">
            {usageUnlimited
              ? `이번 주 무제한 · ${usage?.used ?? 0} 사용`
              : `이번 주 잔여 ${usage?.remaining ?? 0}/${usage?.limit ?? 0}`}
          </span>
          <span className="text-emerald-700/80">다음 갱신 {sub.nextRenewalLabel}</span>
        </>
      ) : (
        <span className="text-slate-500">구독 정보 없음</span>
      )}
    </div>
  ) : null;

  const notesPanelProps = {
    room: currentRoom,
    notes: props.notes.rows,
    viewerRole: "mentor" as const,
    currentUserId: props.currentUserId,
    roomId: props.roomId,
    threadId: props.threadId,
    threadCount: props.threads.rows.length,
    studentName,
  };
  const notesPanel = <ConnectionNotesPanel {...notesPanelProps} />;
  const mobileNotesPanel = (
    <div className="shrink-0 border-t border-slate-100 bg-white p-3 lg:hidden">
      <ConnectionNotesPanel {...notesPanelProps} variant="mobile" />
    </div>
  );

  /* 채팅(톡방) 본문 — 3단계 중앙 */
  const chatThread = (
    <main className="flex min-w-0 flex-1 flex-col border-slate-200 bg-white lg:border-r">
      <header className="flex shrink-0 items-center gap-3 border-b border-slate-100 px-5 py-4">
        <Link
          href={props.backHref ?? roomBase}
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100"
          aria-label="질문 목록으로"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="min-w-0">
          <p className="truncate text-[15px] font-black text-slate-900">
            {studentName} <span className="text-slate-300">/</span> {selectedThreadTitle}
          </p>
          <p className="text-[11px] font-medium text-slate-400">질문 상세 · 실시간 대화</p>
        </div>
        {props.threadId ? (
          <div className="ml-auto shrink-0">
            <QuestionThreadAnswerCompleteButton
              roomId={props.roomId}
              threadId={props.threadId}
              workflowStatus={selectedThreadWorkflow}
            />
          </div>
        ) : null}
      </header>

      {studentPlanCard ? <div className="shrink-0 border-b border-slate-100 px-5 pb-3 pt-0">{studentPlanCard}</div> : null}

      <div className="custom-scrollbar min-h-0 flex-1 space-y-4 overflow-y-auto bg-[#f8fafc] p-5">
        {props.messages.loading ? (
          <p className="py-8 text-center text-[11px] font-bold text-slate-400">대화 불러오는 중…</p>
        ) : props.messages.rows.length === 0 ? (
          <p className="py-8 text-center text-[11px] font-bold text-slate-400">아직 메시지가 없습니다.</p>
        ) : (
          props.messages.rows.map((m) => {
            const body = messageBody(m);
            const author = messageAuthorId(m);
            const mine = author === props.currentUserId;
            return (
              <div key={String(m.id)} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[78%] ${mine ? "items-end" : "items-start"} flex flex-col`}>
                  {!mine ? (
                    <span className="mb-1 text-[10px] font-bold text-slate-500">{studentName}</span>
                  ) : null}
                  <div
                    className={`rounded-2xl px-4 py-2.5 text-[13px] font-medium leading-relaxed shadow-sm ${
                      mine
                        ? "rounded-tr-sm bg-emerald-600 text-white"
                        : "rounded-tl-sm border border-slate-200 bg-white text-slate-800"
                    }`}
                  >
                    {renderMessageContent(body)}
                  </div>
                  <span className="mt-1 px-1 text-[9px] font-bold text-slate-400">
                    {formatQuestionRoomDateTime(m.created_at) ?? formatMinutesAgo(m.created_at)}
                  </span>
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="shrink-0 border-t border-slate-200 bg-white p-3">
        {selectedThreadLocked ? (
          <p className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-center text-[12px] font-bold text-slate-500">
            완료된 질문이에요. 새 질문을 작성해 주세요.
          </p>
        ) : (
          <form key={`mentor-chat-${props.threadId ?? "x"}-${rev}`} action={sendQuestionMessageAction}>
            <div className="flex items-end gap-2 rounded-xl border border-slate-200 bg-slate-50 p-2">
              <QuestionRoomAttachmentButton roomId={props.roomId} threadId={props.threadId} actor="mentor" />
              <textarea
                name="messageBody"
                required
                disabled={!props.threadId || selectedThreadLocked}
                defaultValue={props.draftMessageBody ?? ""}
                rows={3}
                placeholder={props.threadId ? "답변을 입력하세요..." : "질문을 먼저 선택해 주세요"}
                className="min-h-[52px] flex-1 resize-none bg-transparent text-[12px] font-medium outline-none disabled:opacity-50"
              />
              {props.threadId ? <input type="hidden" name="threadId" value={props.threadId} /> : null}
              <input type="hidden" name="roomId" value={props.roomId} />
              <input type="hidden" name="actor" value="mentor" />
              <input type="hidden" name="contextThreadId" value={props.threadId ?? ""} />
              <ChatSendButton disabled={!props.threadId || selectedThreadLocked} />
            </div>
          </form>
        )}
      </div>
      {mobileNotesPanel}
    </main>
  );

  if (detailMode) {
    return (
      <div className="flex h-[calc(100vh-100px)] min-h-[640px] flex-col overflow-hidden border-t border-slate-200 bg-[#f8fafc] font-sans text-slate-900">
        {props.actionFeedback?.ok ? (
          <div className="shrink-0 border-b border-emerald-100 bg-emerald-50 px-4 py-2 text-center text-[11px] font-bold text-emerald-900">
            {props.actionFeedback.ok}
          </div>
        ) : null}
        {props.actionFeedback?.error ? (
          <div className="shrink-0 border-b border-red-100 bg-red-50 px-4 py-2 text-center text-[11px] font-bold text-red-900">
            {props.actionFeedback.error}
          </div>
        ) : null}
        <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden lg:grid-cols-[1fr_420px]">
          {chatThread}
          {notesPanel}
        </div>
        <style jsx global>{`
          .custom-scrollbar::-webkit-scrollbar {
            width: 5px;
            height: 5px;
          }
          .custom-scrollbar::-webkit-scrollbar-thumb {
            background: #cbd5e1;
            border-radius: 8px;
          }
        `}</style>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-100px)] min-h-[640px] flex-col overflow-hidden border-t border-slate-200 bg-[#f8fafc] font-sans text-slate-900">
      {props.actionFeedback?.ok ? (
        <div className="shrink-0 border-b border-emerald-100 bg-emerald-50 px-4 py-2 text-center text-[11px] font-bold text-emerald-900">
          {props.actionFeedback.ok}
        </div>
      ) : null}
      {props.actionFeedback?.error ? (
        <div className="shrink-0 border-b border-red-100 bg-red-50 px-4 py-2 text-center text-[11px] font-bold text-red-900">
          {props.actionFeedback.error}
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden lg:flex-row">
        <aside className="flex max-h-[38vh] w-full shrink-0 flex-col border-b border-slate-200 bg-white lg:max-h-none lg:w-[260px] lg:border-b-0 lg:border-r">
          <div className="shrink-0 border-b border-slate-100 px-4 py-4">
            <h1 className="text-[15px] font-black text-slate-900">학생 질문방</h1>
            <div className="relative mt-3">
              <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input
                type="search"
                value={roomSearch}
                onChange={(e) => setRoomSearch(e.target.value)}
                placeholder="학생명 검색"
                className="h-9 w-full rounded-lg border border-slate-200 bg-slate-50 pl-9 pr-3 text-[11px] font-medium outline-none focus:border-emerald-500"
              />
            </div>
          </div>
          <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto p-2">
            {props.rooms.loading ? (
              <p className="p-4 text-center text-[11px] font-bold text-slate-400">불러오는 중…</p>
            ) : filteredRooms.length === 0 ? (
              <p className="p-4 text-center text-[11px] font-bold text-slate-500">아직 연결된 학생 질문방이 없어요</p>
            ) : (
              filteredRooms.map((room) => {
                const rid = String(room.id);
                const selected = rid === props.roomId;
                const preview = props.listPreviewsByRoomId[rid];
                const unread = props.unreadCountsByRoomId?.[rid] ?? 0;
                const lastTitle =
                  preview?.latestThread && threadTitleFromRow(preview.latestThread as Row);
                return (
                  <Link
                    key={rid}
                    href={`${roomBase}/${encodeURIComponent(rid)}`}
                    className={`relative mb-2 block rounded-xl border p-3 pr-8 transition ${
                      selected
                        ? "border-l-[3px] border-l-emerald-600 border-slate-200 bg-emerald-50 shadow-sm"
                        : "border-transparent hover:bg-slate-50"
                    }`}
                  >
                    {unread > 0 ? (
                      <span className="absolute right-2 top-2 flex h-5 min-w-5 items-center justify-center rounded-full bg-emerald-600 px-1.5 text-[10px] font-black text-white">
                        {unread > 9 ? "9+" : unread}
                      </span>
                    ) : null}
                    <div className="flex gap-2.5">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-100">
                        <User className="h-5 w-5 text-slate-400" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] font-black text-slate-900">
                          {studentLabelForRoom(room, props.studentDisplays)}
                        </p>
                        <p className="mt-0.5 line-clamp-1 text-[10px] font-medium text-slate-500">
                          {lastTitle ?? "최근 질문 없음"}
                        </p>
                        <p className="mt-1 text-[9px] font-medium text-slate-400">
                          {formatMinutesAgo(
                            preview?.lastMessage?.created_at ??
                              preview?.latestThread?.updated_at ??
                              room.updated_at ??
                              room.created_at
                          )}
                        </p>
                      </div>
                    </div>
                  </Link>
                );
              })
            )}
          </div>
        </aside>

        <main className="flex min-w-0 flex-1 flex-col border-slate-200 bg-white lg:border-r">
          <header className="shrink-0 border-b border-slate-100 px-6 py-5">
            <div className="flex gap-4">
              <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full border-2 border-white bg-slate-50 shadow-md ring-1 ring-slate-100">
                <User className="h-8 w-8 text-slate-300" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="truncate text-[18px] font-black text-slate-900">{studentName}</h1>
                  <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-black text-slate-500">
                    학생
                  </span>
                </div>
                <p className="mt-1 text-[12px] font-medium text-slate-500">질문방 관리</p>
                {subjectChipsRoom.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {subjectChipsRoom.map((c) => (
                      <span
                        key={c}
                        className="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-bold text-slate-600"
                      >
                        {c}
                      </span>
                    ))}
                  </div>
                ) : null}
                {studentPlanCard}
              </div>
            </div>
          </header>

          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-slate-50 px-6 py-3">
              <div className="flex rounded-lg bg-slate-100 p-0.5">
                {(
                  [
                    ["all", "전체"],
                    ["waiting", "답변대기"],
                    ["done", "완료"],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setStatusFilter(key)}
                    className={`rounded-md px-3 py-1 text-[11px] font-black transition ${
                      statusFilter === key ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as SortKey)}
                className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-bold text-slate-600 outline-none focus:border-emerald-500"
              >
                <option value="newest">최신순</option>
                <option value="oldest">오래된순</option>
              </select>
            </div>

            <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto px-6 py-4">
              {props.threads.loading ? (
                <p className="py-12 text-center text-[12px] font-bold text-slate-400">질문을 불러오는 중…</p>
              ) : sortedThreads.length === 0 ? (
                <p className="py-12 text-center text-[12px] font-bold text-slate-400">표시할 질문이 없습니다.</p>
              ) : (
                <div className="space-y-3">
                  {pagedThreads.map((t) => {
                    const id = String(t.id);
                    const status = threadStatusListLabel(t);
                    const lastMsg = props.lastMessageByThreadId?.[id] ?? null;
                    const chip = threadSubjectChip(t, subjectChipsRoom);
                    const msgCount = props.messageCountsByThreadId?.[id] ?? 0;
                    const views = threadViewCount(t);
                    return (
                      <Link
                        key={id}
                        href={threadInRoomPath(roomBase, props.roomId, id)}
                        scroll={false}
                        className={listCardClassName(THREAD_TONE_TO_CARD_TONE[status.tone], true, "block")}
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          {chip.map((c) => (
                            <span
                              key={c}
                              className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[9px] font-bold text-slate-600"
                            >
                              {c}
                            </span>
                          ))}
                          <StatusBadge
                            tone={legacyToneToStatusBadgeTone(status.tone)}
                            className="ml-auto"
                          />
                        </div>
                        <h3 className="mt-2 text-[14px] font-black text-slate-900">{threadTitleFromRow(t)}</h3>
                        <p className="mt-1 line-clamp-2 text-[12px] font-medium leading-relaxed text-slate-500">
                          {threadPreviewText(t, lastMsg)}
                        </p>
                        <div className="mt-3 flex flex-wrap items-center gap-3 text-[10px] font-bold text-slate-400">
                          <span className="inline-flex items-center gap-1">
                            <MessageCircle className="h-3.5 w-3.5" />
                            {msgCount}
                          </span>
                          <span className="inline-flex items-center gap-1">
                            <Eye className="h-3.5 w-3.5" />
                            {views}
                          </span>
                          <span>{formatMinutesAgo(t.updated_at ?? t.created_at)}</span>
                        </div>
                      </Link>
                    );
                  })}
                  {threadTotalPages > 1 ? (
                    <div className="flex items-center justify-center gap-2 pt-2">
                      <button
                        type="button"
                        disabled={safeThreadPage <= 1}
                        onClick={() => setThreadPage((p) => Math.max(1, p - 1))}
                        className="inline-flex h-8 items-center gap-1 rounded-lg border border-emerald-200 bg-white px-2.5 text-[11px] font-bold text-emerald-600 transition hover:bg-emerald-50 disabled:border-slate-200 disabled:text-slate-300 disabled:hover:bg-white"
                        aria-label="이전 페이지"
                      >
                        <ChevronLeft className="h-4 w-4" />
                        이전
                      </button>
                      <span className="text-[11px] font-bold text-slate-500">
                        {safeThreadPage} · {threadTotalPages}
                      </span>
                      <button
                        type="button"
                        disabled={safeThreadPage >= threadTotalPages}
                        onClick={() => setThreadPage((p) => Math.min(threadTotalPages, p + 1))}
                        className="inline-flex h-8 items-center gap-1 rounded-lg border border-emerald-200 bg-white px-2.5 text-[11px] font-bold text-emerald-600 transition hover:bg-emerald-50 disabled:border-slate-200 disabled:text-slate-300 disabled:hover:bg-white"
                        aria-label="다음 페이지"
                      >
                        다음
                        <ChevronRight className="h-4 w-4" />
                      </button>
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          </div>
          {mobileNotesPanel}
        </main>

        {notesPanel}
      </div>

      <style jsx global>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 5px;
          height: 5px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: #cbd5e1;
          border-radius: 8px;
        }
      `}</style>
    </div>
  );
}
