"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import { ConnectionNotesPanel } from "@/components/qna/ConnectionNotesPanel";
import { listCardClassName, type ListCardTone } from "@/components/design-system/ListCard";
import {
  AlertTriangle,
  ArrowLeft,
  BadgeCheck,
  ChevronLeft,
  ChevronRight,
  Download,
  Eye,
  FileText,
  Inbox,
  MessageCircle,
  MessageCirclePlus,
  NotebookPen,
  Plus,
  Search,
  Send,
} from "lucide-react";
import { QuestionRoomAttachmentButton } from "@/components/qna/QuestionRoomAttachmentButton";
import { parseAttachmentMessageBody } from "@/lib/qna/questionRoomAttachmentDisplay";
import { FormSubmitButton } from "@/components/qna/FormSubmitButton";
import { QuestionRoomNewQuestionModal } from "@/components/qna/QuestionRoomNewQuestionModal";
import { QuestionThreadConfirmButton } from "@/components/qna/QuestionThreadConfirmButton";
// 오답 표시 토글은 화면에서 숨김(컴포넌트·API·DB는 보존, 추후 멘토용으로 활용). UI 렌더만 제거.
// import { QuestionThreadWrongAnswerToggle } from "@/components/qna/QuestionThreadWrongAnswerToggle";
import type { WeeklyUsageSnapshot } from "@/lib/qna/weeklyQuestionUsageDisplay";
import { weeklyQuestionQuotaLabel } from "@/lib/qna/weeklyQuestionUsageDisplay";
import { sendQuestionMessageAction } from "@/lib/qna/questionRoomActions";
import {
  formatMinutesAgo,
  formatQuestionRoomDateTime,
  threadInRoomPath,
} from "@/lib/qna/formatQuestionRoomDisplay";
import type { QuestionRoomSubscriptionContext } from "@/lib/qna/questionRoomStudentContext";
import type { QuestionRoomListPreview } from "@/lib/qna/questionRoomQueries";
import { partyUserIdFromRoomRow, isQuestionThreadLockedForMessages } from "@/lib/qna/questionRoomUiLabels";
import { readQuestionThreadWorkflowStatus } from "@/lib/qna/questionThreadStatus";
import {
  mentorDisplayForRoom,
  roomMentorLabel,
  roomSubjectChips,
  threadPreviewText,
  threadStatusBadgeClass,
  threadStatusListLabel,
  threadSubjectChip,
  threadTitleFromRow,
  threadViewCount,
  type MentorDisplayById,
} from "@/lib/qna/questionRoomStudentDisplay";
import { mentorSchoolLine, mentorSubjectChips } from "@/lib/mentor/mentorPublicProfileDisplay";

type Row = Record<string, unknown>;
type SortKey = "newest" | "oldest";

// 질문 상태 tone(답변대기=amber / 진행중=blue / 답변완료=emerald) → 목록 카드 톤(좌측 액센트 바).
const THREAD_TONE_TO_CARD_TONE: Record<"amber" | "blue" | "emerald", ListCardTone> = {
  amber: "amber",
  blue: "blue",
  emerald: "green",
};

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

function ChatSendButton(props: { disabled?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={props.disabled || pending}
      aria-label="전송"
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#2563EB] text-white hover:bg-[#1D4ED8] disabled:bg-slate-200"
    >
      <Send className="h-4 w-4" />
    </button>
  );
}

export function QuestionRoomStudentDesignWorkspace(props: {
  currentUserId: string;
  roomId: string;
  threadId: string | null;
  rooms: { rows: Row[]; error: string | null; loading: boolean };
  threads: { rows: Row[]; error: string | null; loading: boolean };
  messages: { rows: Row[]; error: string | null; loading: boolean };
  notes: { rows: Row[]; error: string | null; loading: boolean };
  listPreviewsByRoomId: Record<string, QuestionRoomListPreview>;
  mentorDisplays: MentorDisplayById;
  initialUsageByMentorId?: Record<string, WeeklyUsageSnapshot>;
  messageCountsByThreadId?: Record<string, number>;
  lastMessageByThreadId?: Record<string, Row>;
  unreadCountsByRoomId?: Record<string, number>;
  subscriptionContext?: QuestionRoomSubscriptionContext;
  subjectOptions?: string[];
  actionFeedback?: { ok: string | null; error: string | null };
  draftMessageBody?: string;
  draftNoteBody?: string;
  formRevision?: string;
  /** false: 방 목록 화면(채팅 패널 숨김, 연결노트만) */
  showChatPanel?: boolean;
  backHref?: string | null;
  /** true: 중앙에 선택 질문 상세(목록 대신) */
  threadDetailMode?: boolean;
}) {
  const rev = props.formRevision ?? "0";

  const currentRoom = useMemo(
    () => props.rooms.rows.find((r) => r && String(r.id) === String(props.roomId)) ?? null,
    [props.roomId, props.rooms.rows]
  );

  const mentorId = currentRoom ? partyUserIdFromRoomRow(currentRoom, "mentor") : null;
  const mentorDisplay = mentorDisplayForRoom(currentRoom, props.mentorDisplays);
  const subCtx = props.subscriptionContext;

  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortKey>("newest");
  const [newQuestionOpen, setNewQuestionOpen] = useState(false);
  const [weeklyUsage, setWeeklyUsage] = useState<WeeklyUsageSnapshot | null>(null);
  const [usageLoading, setUsageLoading] = useState(false);
  const [usageByMentorId, setUsageByMentorId] = useState<Record<string, WeeklyUsageSnapshot>>(
    props.initialUsageByMentorId ?? {}
  );

  useEffect(() => {
    if (mentorId && props.initialUsageByMentorId?.[mentorId]) {
      setWeeklyUsage(props.initialUsageByMentorId[mentorId]);
    }
  }, [mentorId, props.initialUsageByMentorId]);

  const loadUsageForMentor = useCallback(async (mid: string) => {
    try {
      const res = await fetch(`/api/question-room/weekly-usage?mentorId=${encodeURIComponent(mid)}`, {
        credentials: "include",
      });
      const json = (await res.json()) as { ok?: boolean; usage?: WeeklyUsageSnapshot };
      if (res.ok && json.ok && json.usage) {
        const usage = json.usage;
        setUsageByMentorId((prev) => ({ ...prev, [mid]: usage }));
        if (mid === mentorId) setWeeklyUsage(json.usage);
      }
    } catch {
      /* ignore */
    }
  }, [mentorId]);

  useEffect(() => {
    if (!mentorId) return;
    setUsageLoading(true);
    void loadUsageForMentor(mentorId).finally(() => setUsageLoading(false));
  }, [mentorId, loadUsageForMentor]);

  useEffect(() => {
    const ids = new Set<string>();
    for (const r of props.rooms.rows) {
      const mid = partyUserIdFromRoomRow(r, "mentor");
      if (mid && mid !== mentorId) ids.add(mid);
    }
    for (const mid of ids) {
      void loadUsageForMentor(mid);
    }
  }, [props.rooms.rows, mentorId, loadUsageForMentor]);

  const filteredRooms = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return props.rooms.rows;
    return props.rooms.rows.filter((r) => {
      const name = roomMentorLabel(r, props.mentorDisplays).toLowerCase();
      const chips = roomSubjectChips(r, props.mentorDisplays).join(" ").toLowerCase();
      return name.includes(q) || chips.includes(q);
    });
  }, [props.rooms.rows, props.mentorDisplays, search]);

  const sortedThreads = useMemo(() => {
    const rows = [...props.threads.rows];
    rows.sort((a, b) => {
      const ta = Date.parse(String(a.created_at ?? a.updated_at ?? 0));
      const tb = Date.parse(String(b.created_at ?? b.updated_at ?? 0));
      return sort === "newest" ? tb - ta : ta - tb;
    });
    return rows;
  }, [props.threads.rows, sort]);

  // ★질문 목록 페이지네이션 (일정 개수 초과 시)
  const THREADS_PER_PAGE = 12;
  const [threadPage, setThreadPage] = useState(1);
  const threadTotalPages = Math.max(1, Math.ceil(sortedThreads.length / THREADS_PER_PAGE));
  const safeThreadPage = Math.min(threadPage, threadTotalPages);
  useEffect(() => {
    if (threadPage > threadTotalPages) setThreadPage(threadTotalPages);
  }, [threadPage, threadTotalPages]);
  useEffect(() => {
    setThreadPage(1);
  }, [props.roomId, sort]);
  const pagedThreads = sortedThreads.slice(
    (safeThreadPage - 1) * THREADS_PER_PAGE,
    safeThreadPage * THREADS_PER_PAGE
  );

  const selectedThread = useMemo(() => {
    if (!props.threadId) return sortedThreads[0] ?? null;
    return sortedThreads.find((t) => String(t.id) === String(props.threadId)) ?? null;
  }, [props.threadId, sortedThreads]);

  const threadWorkflow = selectedThread
    ? readQuestionThreadWorkflowStatus(selectedThread)
    : ("pending" as const);
  const threadLocked = isQuestionThreadLockedForMessages(selectedThread);

  const subjectChipsRoom = roomSubjectChips(currentRoom ?? {}, props.mentorDisplays, 4);

  if (!props.rooms.loading && props.rooms.rows.length === 0) {
    // 구독 0개 제로상태 — 정상 3컬럼 셸(좌 리스트·중앙 히어로·우 연결노트)을 그대로 재사용.
    // 모바일은 중앙 히어로 우선(order-1) → 좌측 리스트 → 우측 노트.
    return (
      <div className="flex min-h-[calc(100vh-120px)] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-[#f8fafc] font-sans text-slate-900 shadow-sm">
        <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
          {/* 좌측 레일 — 구독 질문방(빈 리스트 + 구독 버튼) */}
          <aside className="order-2 flex w-full shrink-0 flex-col border-t border-slate-200 bg-white lg:order-1 lg:w-[240px] lg:border-t-0 lg:border-r">
            <div className="shrink-0 border-b border-slate-100 p-4">
              <h2 className="text-[15px] font-black text-slate-900">구독 질문방</h2>
              <div className="relative mt-3">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  disabled
                  placeholder="멘토 또는 질문방 검색"
                  className="w-full rounded-lg border border-slate-200 py-2 pl-9 pr-3 text-[12px] font-medium outline-none placeholder:text-slate-400"
                />
              </div>
            </div>
            <div className="min-h-0 flex-1 p-2">
              <div className="flex flex-col items-center justify-center px-3 py-10 text-center">
                <Inbox className="h-8 w-8 text-slate-300" strokeWidth={1.75} aria-hidden />
                <p className="mt-2 text-[11px] font-bold leading-relaxed text-slate-400">구독한 질문방이 아직 없어요</p>
              </div>
            </div>
            <div className="shrink-0 border-t border-slate-100 p-3">
              <Link
                href="/mentors"
                className="flex h-10 w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-[#2563EB]/40 bg-[#EEF4FF] text-[12px] font-black text-[#2563EB] transition hover:bg-[#E0ECFF]"
              >
                <Plus className="h-4 w-4" />
                질문방 구독하기
              </Link>
            </div>
          </aside>

          {/* 중앙 — 히어로 빈상태(구독 유도) */}
          <main className="order-1 flex min-w-0 flex-1 flex-col bg-white lg:order-2 lg:border-r lg:border-slate-200">
            <div className="flex flex-1 flex-col items-center justify-center px-6 py-14 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#EEF4FF] text-[#2563EB]">
                <MessageCirclePlus className="h-6 w-6" strokeWidth={1.75} aria-hidden />
              </div>
              <h2 className="mt-3 text-base font-medium text-slate-900">멘토를 구독하면 질문방이 열려요</h2>
              <p className="mt-1.5 max-w-md text-[13px] font-medium leading-relaxed text-slate-500">
                {/* 모바일 1줄 축약 / 데스크탑 원문 유지 */}
                <span className="md:hidden">멘토를 구독하면 질문·답변·노트가 쌓여요.</span>
                <span className="hidden md:inline">마음에 드는 멘토를 구독하면 1:1로 질문하고, 답변과 노트가 여기에 쌓여요.</span>
              </p>
              <ol className="mt-5 w-full max-w-[300px] space-y-2.5 text-left">
                {[
                  ["멘토 구독하기", "마음에 드는 멘토를 골라 구독해요."],
                  ["궁금한 점 질문하기", "사진·파일도 함께 첨부할 수 있어요."],
                  ["답변 확인하기", "답변을 받으면 확인을 눌러 완료해요."],
                ].map(([t, d], i) => (
                  <li key={t} className="flex items-start gap-2.5 rounded-xl border border-slate-100 bg-slate-50/60 px-3 py-2">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#2563EB] text-[10px] font-black text-white">
                      {i + 1}
                    </span>
                    <span>
                      <span className="block text-[12px] font-bold text-slate-800">{t}</span>
                      <span className="block text-[10.5px] font-medium leading-relaxed text-slate-500">{d}</span>
                    </span>
                  </li>
                ))}
              </ol>
              <Link
                href="/mentors"
                className="mt-6 inline-flex min-h-[44px] w-full max-w-[300px] items-center justify-center rounded-xl bg-[#2563EB] px-5 text-sm font-extrabold text-white hover:bg-[#1D4ED8]"
              >
                질문방 구독하기
              </Link>
            </div>
          </main>

          {/* 우측 레일 — 연결 노트(빈) */}
          <aside className="order-3 flex w-full shrink-0 flex-col border-t border-slate-200 bg-white lg:w-[280px] lg:border-t-0">
            <div className="shrink-0 border-b border-slate-100 px-4 py-3">
              <h2 className="flex items-center gap-1.5 text-[14px] font-black text-slate-900">
                <NotebookPen className="h-4 w-4 text-slate-400" aria-hidden />
                연결 노트
              </h2>
            </div>
            <div className="flex flex-1 items-center justify-center px-4 py-10">
              <div className="flex w-full flex-col items-center rounded-xl border border-dashed border-slate-200 bg-slate-50/60 px-4 py-8 text-center">
                <NotebookPen className="h-7 w-7 text-slate-300" strokeWidth={1.75} aria-hidden />
                <p className="mt-2 text-[12px] font-bold leading-relaxed text-slate-400">
                  구독하고 질문하면
                  <br />
                  노트가 여기에 쌓여요
                </p>
              </div>
            </div>
          </aside>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-[calc(100vh-120px)] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-[#f8fafc] font-sans text-slate-900 shadow-sm">
      {(props.actionFeedback?.ok || props.actionFeedback?.error) && (
        <div className="shrink-0 border-b border-slate-200 bg-white px-4 py-2">
          {props.actionFeedback.ok ? (
            <p className="text-center text-xs font-semibold text-emerald-800">{props.actionFeedback.ok}</p>
          ) : null}
          {props.actionFeedback.error ? (
            <p className="text-center text-xs font-semibold text-amber-900">{props.actionFeedback.error}</p>
          ) : null}
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {/* 좌측 240px (모바일: 상단, 높이 제한) */}
        <aside className="flex max-h-[38vh] w-full shrink-0 flex-col border-b border-slate-200 bg-white lg:max-h-none lg:w-[240px] lg:border-b-0 lg:border-r">
          <div className="shrink-0 border-b border-slate-100 p-4">
            <h2 className="text-[15px] font-black text-slate-900">구독 질문방</h2>
            <div className="relative mt-3">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="멘토 또는 질문방 검색"
                className="w-full rounded-lg border border-slate-200 py-2 pl-9 pr-3 text-[12px] font-medium outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB]/30"
              />
            </div>
          </div>

          <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto p-2">
            {props.rooms.loading ? (
              <p className="p-4 text-center text-[11px] font-bold text-slate-400">불러오는 중…</p>
            ) : filteredRooms.length === 0 ? (
              <p className="p-4 text-center text-[11px] font-bold leading-relaxed text-slate-400">
                구독한 멘토 질문방이 없습니다.
              </p>
            ) : (
              filteredRooms.map((room) => {
                const rid = String(room.id);
                const selected = rid === props.roomId;
                const mid = partyUserIdFromRoomRow(room, "mentor");
                const display = mentorDisplayForRoom(room, props.mentorDisplays);
                const preview = props.listPreviewsByRoomId[rid];
                const unread = props.unreadCountsByRoomId?.[rid] ?? 0;
                const usage = mid ? usageByMentorId[mid] : undefined;
                return (
                  <Link
                    key={rid}
                    href={`/question-room/${encodeURIComponent(rid)}`}
                    className={`relative mb-2 block rounded-xl border p-3 pr-8 transition ${
                      selected
                        ? "border-l-[3px] border-l-[#2563EB] border-slate-200 bg-[#EEF4FF] shadow-sm"
                        : "border-transparent hover:bg-slate-50"
                    }`}
                  >
                    {unread > 0 ? (
                      <span className="absolute right-2 top-2 z-10 flex h-5 min-w-5 items-center justify-center rounded-full bg-[#2563EB] px-1.5 text-[10px] font-black text-white">
                        {unread > 9 ? "9+" : unread}
                      </span>
                    ) : null}
                    <div className="flex gap-2.5">
                      <div className="h-10 w-10 shrink-0 overflow-hidden rounded-full bg-slate-100">
                        {display?.photoUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={display.photoUrl} alt="" className="h-full w-full object-cover" />
                        ) : (
                          <span className="flex h-full w-full items-center justify-center text-[12px] font-black text-slate-400">
                            {roomMentorLabel(room, props.mentorDisplays).slice(0, 1)}
                          </span>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] font-black text-slate-900">
                          {roomMentorLabel(room, props.mentorDisplays)}
                        </p>
                        {roomSubjectChips(room, props.mentorDisplays, 3).length > 0 ? (
                          <p className="mt-1 text-[10px] font-medium text-slate-400">
                            {roomSubjectChips(room, props.mentorDisplays, 3).join(" · ")}
                          </p>
                        ) : (
                          <p className="mt-1 text-[10px] font-medium text-slate-400">과목 정보 없음</p>
                        )}
                        <p className="mt-1 text-[10px] font-bold text-[#2563EB]">
                          {weeklyQuestionQuotaLabel(usage)}
                        </p>
                        <p className="mt-0.5 text-[9px] font-medium text-slate-400">
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

          <div className="shrink-0 border-t border-slate-100 p-3">
            <Link
              href="/mentors"
              className="flex h-10 w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-[#2563EB]/40 bg-[#EEF4FF] text-[12px] font-black text-[#2563EB] transition hover:bg-[#E0ECFF]"
            >
              <Plus className="h-4 w-4" />
              질문방 구독하기
            </Link>
          </div>
        </aside>

        {/* 중앙 */}
        <main className="flex min-w-0 flex-1 flex-col border-slate-200 bg-white lg:border-r">
          <header className="shrink-0 border-b border-slate-100 px-6 py-5">
            <div className="flex gap-4">
              <div className="h-16 w-16 shrink-0 overflow-hidden rounded-full border-2 border-white bg-slate-50 shadow-md ring-1 ring-slate-100">
                {mentorDisplay?.photoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={mentorDisplay.photoUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  <span className="flex h-full w-full items-center justify-center text-xl font-black text-slate-300">
                    {roomMentorLabel(currentRoom ?? {}, props.mentorDisplays).slice(0, 1)}
                  </span>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-[18px] font-black text-slate-900">
                    {roomMentorLabel(currentRoom ?? {}, props.mentorDisplays)}
                  </h1>
                  <span className="inline-flex items-center gap-0.5 rounded-md bg-[#2563EB] px-1.5 py-0.5 text-[10px] font-black text-white">
                    <BadgeCheck className="h-3 w-3" />
                    인증
                  </span>
                </div>
                <p className="mt-1 text-[12px] font-medium text-slate-500">
                  {mentorDisplay ? mentorSchoolLine(mentorDisplay) : "학교·학과 정보 준비 중"}
                </p>
                {subjectChipsRoom.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {subjectChipsRoom.map((c) => (
                      <span
                        key={c}
                        className="rounded-md border border-[#2563EB]/40 bg-white px-2 py-0.5 text-[10px] font-bold text-[#2563EB]"
                      >
                        {c}
                      </span>
                    ))}
                  </div>
                ) : null}
                <div className="mt-4 max-w-md">
                  <div className="flex items-center justify-between text-[11px] font-bold text-slate-600">
                    <span>{weeklyQuestionQuotaLabel(weeklyUsage)}</span>
                    <span className="text-slate-400">{subCtx?.planLabel ?? "플랜"}</span>
                  </div>
                  {/* ★잔여(남은) 질문 = 파랑, 사용 = 회색 트랙 (반전) */}
                  <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-200">
                    <div
                      className="h-full rounded-full bg-[#2563EB] transition-all"
                      style={{
                        width:
                          weeklyUsage && weeklyUsage.limit >= 999
                            ? "100%"
                            : weeklyUsage && weeklyUsage.limit > 0
                              ? `${Math.min(100, Math.max(0, Math.round(((weeklyUsage.limit - weeklyUsage.used) / weeklyUsage.limit) * 100)))}%`
                              : "0%",
                      }}
                    />
                  </div>
                  {/* ★상단 구독 메타 한 줄 압축 (상세는 마우스오버 툴팁) */}
                  <p
                    className="mt-1.5 truncate text-[10px] text-slate-500"
                    title={`${subCtx?.weekRenewalLabel ?? ""} · 다음 갱신 ${subCtx?.nextRenewalLabel ?? "—"}`}
                  >
                    {subCtx?.planLabel ?? "구독 플랜"} 플랜 · 다음 갱신 {subCtx?.nextRenewalShort ?? "—"}
                  </p>
                </div>
              </div>
            </div>
          </header>

          <div className="flex min-h-0 flex-1 flex-col">
            {props.threadDetailMode && selectedThread ? (
              <>
              <div className="flex shrink-0 items-center gap-3 border-b border-slate-100 px-5 py-3">
                <Link
                  href={props.backHref ?? `/question-room/${encodeURIComponent(props.roomId)}`}
                  aria-label="질문 목록으로"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100"
                >
                  <ArrowLeft className="h-5 w-5" />
                </Link>
                <div className="min-w-0">
                  <p className="truncate text-[15px] font-black text-slate-900">
                    {roomMentorLabel(currentRoom ?? {}, props.mentorDisplays)}{" "}
                    <span className="text-slate-300">/</span> {threadTitleFromRow(selectedThread)}
                  </p>
                  <p className="text-[11px] font-medium text-slate-400">질문 상세 · 실시간 대화</p>
                </div>
              </div>
              <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto px-6 py-6">
                <div className="flex flex-wrap items-center gap-2">
                  {threadSubjectChip(selectedThread, subjectChipsRoom).map((c) => (
                    <span
                      key={c}
                      className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[9px] font-bold text-slate-600"
                    >
                      {c}
                    </span>
                  ))}
                  <span
                    className={`ml-auto rounded-full border px-2 py-0.5 text-[9px] font-black ${threadStatusBadgeClass(threadStatusListLabel(selectedThread).tone)}`}
                  >
                    {threadStatusListLabel(selectedThread).label}
                  </span>
                </div>
                <h2 className="mt-4 text-xl font-black text-slate-900">{threadTitleFromRow(selectedThread)}</h2>
                <p className="mt-4 whitespace-pre-wrap text-sm font-medium leading-relaxed text-slate-700">
                  {threadPreviewText(selectedThread, props.lastMessageByThreadId?.[String(selectedThread.id)] ?? null)}
                </p>
                <p className="mt-4 text-[11px] font-bold text-slate-400">
                  등록 {formatMinutesAgo(selectedThread.created_at ?? selectedThread.updated_at)}
                </p>

                <div className="mt-8 border-t border-slate-100 pt-6">
                  <h3 className="text-[13px] font-black text-slate-900">답변</h3>
                  {props.messages.loading ? (
                    <p className="mt-4 py-6 text-center text-[12px] font-bold text-slate-400">답변을 불러오는 중…</p>
                  ) : props.messages.rows.length === 0 ? (
                    <p className="mt-4 py-6 text-center text-[12px] font-bold text-slate-400">아직 답변 메시지가 없습니다.</p>
                  ) : (
                    <div className="mt-4 space-y-4">
                      {props.messages.rows.map((m) => {
                        const body = messageBody(m);
                        const author = messageAuthorId(m);
                        const mine = author === props.currentUserId;
                        const mentorName = roomMentorLabel(currentRoom ?? {}, props.mentorDisplays);

                        return (
                          <div key={String(m.id)} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                            <div className={`max-w-[92%] ${mine ? "items-end" : "items-start"} flex flex-col`}>
                              {!mine ? (
                                <span className="mb-1 text-[10px] font-bold text-slate-500">{mentorName}</span>
                              ) : null}
                              <div
                                className={`rounded-2xl px-4 py-2.5 text-[12px] font-medium leading-relaxed shadow-sm ${
                                  mine
                                    ? "rounded-tr-sm bg-blue-600 text-white"
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
                      })}
                    </div>
                  )}
                </div>

                {/* 오답 표시 체크박스는 화면에서 숨김(데이터/API는 보존 — 추후 멘토용 기능으로 활용).
                    QuestionThreadWrongAnswerToggle / is_wrong_answer 컬럼·라우트는 그대로 둠. */}
                {props.threadId && threadWorkflow === "answered" ? (
                  <div className="mt-3 space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-2">
                      <span className="text-[11px] font-bold text-slate-900">
                        멘토 답변이 도착했어요. 확인하면 완료로 표시돼요.
                      </span>
                      <QuestionThreadConfirmButton roomId={props.roomId} threadId={props.threadId} compact />
                    </div>
                    <p className="flex items-start gap-1.5 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] font-extrabold leading-relaxed text-amber-900">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                      <span>답변이 완전히 이해된 뒤에 <span className="font-black">“답변 확인 완료”</span>를 눌러 주세요. 확인 완료 후에는 이 질문에서 <span className="font-black">더 이상 대화를 이어갈 수 없어요.</span></span>
                    </p>
                  </div>
                ) : props.threadId && threadWorkflow === "confirmed" ? (
                  <p className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-[11px] font-bold text-emerald-800">
                    <BadgeCheck className="h-3.5 w-3.5" aria-hidden />
                    답변을 확인했어요
                  </p>
                ) : null}
              </div>

              <div className="shrink-0 border-t border-slate-200 bg-white p-3">
                {threadLocked ? (
                  <p className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-center text-[12px] font-bold text-slate-500">
                    완료된 질문이에요. 새 질문을 작성해 주세요.
                  </p>
                ) : (
                  <form key={`chat-center-${props.threadId ?? "x"}-${rev}`} action={sendQuestionMessageAction}>
                    <div className="flex items-end gap-2 rounded-xl border border-slate-200 bg-slate-50 p-2">
                      <QuestionRoomAttachmentButton roomId={props.roomId} threadId={props.threadId} actor="student" />
                      <textarea
                        name="messageBody"
                        required
                        disabled={!props.threadId || threadLocked}
                        defaultValue={props.draftMessageBody ?? ""}
                        rows={2}
                        placeholder={props.threadId ? "질문을 입력하세요..." : "질문을 먼저 선택해 주세요"}
                        className="min-h-[44px] flex-1 resize-none bg-transparent text-[12px] font-medium outline-none disabled:opacity-50"
                      />
                      {props.threadId ? <input type="hidden" name="threadId" value={props.threadId} /> : null}
                      <input type="hidden" name="roomId" value={props.roomId} />
                      <input type="hidden" name="actor" value="student" />
                      <input type="hidden" name="contextThreadId" value={props.threadId ?? ""} />
                      <ChatSendButton disabled={!props.threadId || threadLocked} />
                    </div>
                  </form>
                )}
              </div>
              </>
            ) : (
            <>
            <div className="flex shrink-0 items-center justify-between border-b border-slate-50 px-6 py-3">
              <h2 className="text-[14px] font-black text-slate-900">질문 목록</h2>
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as SortKey)}
                className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-bold text-slate-600 outline-none focus:border-[#2563EB]"
              >
                <option value="newest">최신순</option>
                <option value="oldest">오래된순</option>
              </select>
            </div>

            <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto px-6 py-4">
              {props.threads.loading ? (
                <p className="py-12 text-center text-[12px] font-bold text-slate-400">질문을 불러오는 중…</p>
              ) : sortedThreads.length === 0 ? (
                <div className="flex flex-col items-center px-2 py-10 text-center">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#EEF4FF] text-[#2563EB]">
                    <MessageCirclePlus className="h-6 w-6" strokeWidth={1.75} aria-hidden />
                  </div>
                  <h3 className="mt-3 text-[15px] font-black text-slate-900">이 멘토에게 첫 질문을 남겨보세요</h3>
                  <p className="mt-1.5 text-[12px] font-medium leading-relaxed text-slate-500">
                    구독이 시작됐어요. 궁금한 점을 질문하면 멘토가 답변하고, 연결노트로 기록이 쌓여요.
                  </p>
                  <ol className="mt-5 w-full max-w-[300px] space-y-2.5 text-left">
                    {[
                      ["과목·단원 고르기", "과목·메모는 선택이에요. 비워도 돼요."],
                      ["궁금한 점 질문하기", "사진·파일도 함께 첨부할 수 있어요."],
                      ["답변 확인하기", "답변을 받으면 확인을 눌러 완료로 표시해요."],
                    ].map(([t, d], i) => (
                      <li key={t} className="flex items-start gap-2.5 rounded-xl border border-slate-100 bg-slate-50/60 px-3 py-2">
                        <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#2563EB] text-[10px] font-black text-white">
                          {i + 1}
                        </span>
                        <span>
                          <span className="block text-[12px] font-bold text-slate-800">{t}</span>
                          <span className="block text-[10.5px] font-medium leading-relaxed text-slate-500">{d}</span>
                        </span>
                      </li>
                    ))}
                  </ol>
                  <p className="mt-4 text-[11px] font-bold text-slate-400">
                    아래 “새로운 질문하기” 버튼으로 시작해 보세요.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {pagedThreads.map((t) => {
                    const id = String(t.id);
                    const status = threadStatusListLabel(t);
                    const workflow = readQuestionThreadWorkflowStatus(t);
                    const lastMsg = props.lastMessageByThreadId?.[id] ?? null;
                    const chip = threadSubjectChip(t, subjectChipsRoom);
                    const msgCount = props.messageCountsByThreadId?.[id] ?? 0;
                    const views = threadViewCount(t);

                    return (
                      <article
                        key={id}
                        className={listCardClassName(THREAD_TONE_TO_CARD_TONE[status.tone], true)}
                      >
                        <Link
                          href={threadInRoomPath("/question-room", props.roomId, id)}
                          scroll={false}
                          className="block"
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
                          <span
                            className={`ml-auto rounded-full border px-2 py-0.5 text-[9px] font-black ${threadStatusBadgeClass(status.tone)}`}
                          >
                            {status.label}
                          </span>
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
                        {workflow === "answered" ? (
                          <QuestionThreadConfirmButton
                            roomId={props.roomId}
                            threadId={id}
                            compact
                          />
                        ) : null}
                      </article>
                    );
                  })}
                  {threadTotalPages > 1 ? (
                    <div className="flex items-center justify-center gap-2 pt-2">
                      <button
                        type="button"
                        disabled={safeThreadPage <= 1}
                        onClick={() => setThreadPage((p) => Math.max(1, p - 1))}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-50 disabled:opacity-40"
                        aria-label="이전 페이지"
                      >
                        <ChevronLeft className="h-4 w-4" />
                      </button>
                      <span className="text-[11px] font-bold text-slate-500">
                        {safeThreadPage} / {threadTotalPages}
                      </span>
                      <button
                        type="button"
                        disabled={safeThreadPage >= threadTotalPages}
                        onClick={() => setThreadPage((p) => Math.min(threadTotalPages, p + 1))}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-50 disabled:opacity-40"
                        aria-label="다음 페이지"
                      >
                        <ChevronRight className="h-4 w-4" />
                      </button>
                    </div>
                  ) : null}
                </div>
              )}
            </div>

            {!props.threadDetailMode ? (
              <div className="shrink-0 border-t border-slate-100 px-6 py-5">
                <button
                  type="button"
                  disabled={weeklyUsage != null && !weeklyUsage.canAsk}
                  onClick={() => setNewQuestionOpen(true)}
                  className="mx-auto flex h-11 items-center justify-center gap-2 rounded-full border border-[#2563EB]/20 bg-[#EEF4FF] px-6 text-[13px] font-black text-[#2563EB] transition hover:bg-[#E0ECFF] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Plus className="h-4 w-4" />
                  새로운 질문하기
                </button>
              </div>
            ) : null}
            </>
            )}
          </div>
          {/* 모바일: 중앙 하단 토글 */}
          <div className="shrink-0 border-t border-slate-100 bg-white p-3 lg:hidden">
            <ConnectionNotesPanel
              room={currentRoom}
              notes={props.notes.rows}
              viewerRole="student"
              currentUserId={props.currentUserId}
              roomId={props.roomId}
              threadId={props.threadId}
              threadCount={props.threads.rows.length}
              mentorName={roomMentorLabel(currentRoom ?? {}, props.mentorDisplays)}
              variant="mobile"
            />
          </div>
        </main>

        {/* 우측 패널: 연결 노트 (공용 컴포넌트 — 멘토/학생 통합, 데스크톱) */}
        <ConnectionNotesPanel
          room={currentRoom}
          notes={props.notes.rows}
          viewerRole="student"
          currentUserId={props.currentUserId}
          roomId={props.roomId}
          threadId={props.threadId}
          threadCount={props.threads.rows.length}
          mentorName={roomMentorLabel(currentRoom ?? {}, props.mentorDisplays)}
        />
      </div>

      <QuestionRoomNewQuestionModal
        open={newQuestionOpen}
        onClose={() => setNewQuestionOpen(false)}
        roomId={props.roomId}
        contextThreadId={props.threadId}
        usage={weeklyUsage}
        usageLoading={usageLoading}
        subjectOptions={props.subjectOptions ?? subjectChipsRoom}
      />

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
