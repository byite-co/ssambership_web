"use client";

import { useState } from "react";
import { Notebook, Plus, CalendarDays, MessagesSquare, Pencil, Trash2 } from "lucide-react";
import { QuestionRoomNewNoteModal } from "@/components/qna/QuestionRoomNewNoteModal";
import { FormSubmitButton } from "@/components/common/FormSubmitButton";
import {
  deleteConnectionNoteAction,
  updateConnectionNoteAction,
} from "@/lib/qna/questionRoomActions";
import { partyUserIdFromRoomRow } from "@/lib/qna/questionRoomUiLabels";
import { formatQuestionRoomDateTime } from "@/lib/qna/formatQuestionRoomDisplay";

type Row = Record<string, unknown>;

function authorIdOf(n: Row): string | null {
  for (const k of ["author_id", "user_id", "sender_id"] as const) {
    const v = n[k];
    if (typeof v === "string" && v.trim()) return v;
  }
  return null;
}

function noteBodyOf(n: Row): string {
  for (const k of ["body", "content", "note", "text"] as const) {
    const v = n[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

/** room.created_at → "N개월" (1개월 미만은 "N일"). */
function periodTogether(createdAt: unknown): string {
  if (typeof createdAt !== "string" || !createdAt) return "-";
  const start = new Date(createdAt);
  if (Number.isNaN(start.getTime())) return "-";
  const days = Math.max(0, Math.floor((Date.now() - start.getTime()) / (24 * 60 * 60 * 1000)));
  if (days < 31) return `${days}일`;
  return `${Math.floor(days / 30)}개월`;
}

type NoteCard = { id: string; body: string; dateLabel: string; authorLabel: string; editable: boolean };

// 렌더 중 컴포넌트 생성(중첩 정의) 금지 — 모듈 스코프로 호이스트하고 클로저 값은 props 로 받는다.
// (중첩 정의는 부모 재렌더마다 컴포넌트 identity 가 바뀌어 편집 textarea 가 remount 되는 원인이었다.)
function NoteItem(opts: {
  card: NoteCard;
  isStudent: boolean;
  roomId: string;
  threadId: string | null;
  editing: boolean;
  onStartEdit: (id: string) => void;
  onCancelEdit: () => void;
}) {
  const { card, isStudent } = opts;
  const accent = isStudent ? "border-blue-200 border-l-blue-600" : "border-emerald-200 border-l-emerald-600";

  if (opts.editing) {
    return (
      <form
        action={updateConnectionNoteAction}
        className={`rounded-xl border border-l-[3px] bg-white px-3 py-3 ${accent}`}
      >
        <input type="hidden" name="noteId" value={card.id} />
        <input type="hidden" name="roomId" value={opts.roomId} />
        <input type="hidden" name="contextThreadId" value={opts.threadId ?? ""} />
        <textarea
          name="noteBody"
          required
          defaultValue={card.body}
          rows={3}
          className={`w-full rounded-lg border border-slate-200 px-3 py-2 text-[13px] leading-relaxed outline-none focus:ring-2 ${
            isStudent ? "focus:border-blue-400 focus:ring-blue-100" : "focus:border-emerald-400 focus:ring-emerald-100"
          }`}
        />
        <div className="mt-2 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => opts.onCancelEdit()}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-[11px] font-bold text-slate-600 hover:bg-slate-50"
          >
            취소
          </button>
          <FormSubmitButton
            idleLabel="저장"
            pendingLabel="저장 중…"
            className={`rounded-lg px-3 py-1.5 text-[11px] font-extrabold text-white ${
              isStudent ? "bg-blue-600 hover:bg-blue-700" : "bg-emerald-600 hover:bg-emerald-700"
            }`}
          />
        </div>
      </form>
    );
  }

  return (
    <article className={`rounded-xl border border-l-[3px] bg-white px-3.5 py-3 shadow-[0_1px_4px_rgba(0,0,0,0.06)] ${accent}`}>
      <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-slate-700">{card.body}</p>
      <div className="mt-2 flex items-center justify-between gap-2">
        <p className="text-[11px] font-semibold text-slate-400">
          {card.authorLabel}
          {card.dateLabel ? <span className="text-slate-300"> · {card.dateLabel}</span> : null}
        </p>
        {card.editable ? (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => opts.onStartEdit(card.id)}
              className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-bold text-slate-500 hover:bg-slate-100 hover:text-slate-700"
            >
              <Pencil className="h-3 w-3" aria-hidden />수정
            </button>
            <form
              action={deleteConnectionNoteAction}
              onSubmit={(e) => {
                if (!window.confirm("이 노트를 삭제할까요?")) e.preventDefault();
              }}
            >
              <input type="hidden" name="noteId" value={card.id} />
              <input type="hidden" name="roomId" value={opts.roomId} />
              <input type="hidden" name="contextThreadId" value={opts.threadId ?? ""} />
              <button
                type="submit"
                className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-bold text-rose-500 hover:bg-rose-50"
              >
                <Trash2 className="h-3 w-3" aria-hidden />삭제
              </button>
            </form>
          </div>
        ) : null}
      </div>
    </article>
  );
}

function NoteColumn(opts: {
  side: "student" | "mentor";
  title: string;
  cards: NoteCard[];
  viewerRole: "student" | "mentor";
  roomId: string;
  threadId: string | null;
  editingId: string | null;
  onStartEdit: (id: string) => void;
  onCancelEdit: () => void;
  onAddNote: () => void;
}) {
  const isStudent = opts.side === "student";
  const canAdd = opts.viewerRole === opts.side;
  return (
    <section className={`rounded-2xl border p-3.5 ${isStudent ? "border-blue-200 bg-blue-50" : "border-emerald-200 bg-emerald-50"}`}>
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-[13px] font-extrabold text-slate-900">
          <span className={`h-2.5 w-2.5 rounded-full ${isStudent ? "bg-blue-600" : "bg-emerald-600"}`} aria-hidden />
          {opts.title}
          <span className={`text-[11px] font-bold ${isStudent ? "text-blue-700" : "text-emerald-700"}`}>{opts.cards.length}</span>
        </p>
        {canAdd ? (
          <button
            type="button"
            onClick={() => opts.onAddNote()}
            className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-extrabold text-white transition ${
              isStudent ? "bg-blue-600 hover:bg-blue-700" : "bg-emerald-600 hover:bg-emerald-700"
            }`}
          >
            <Plus className="h-3.5 w-3.5" />내 노트 추가
          </button>
        ) : null}
      </div>
      <div className="mt-3 flex flex-col gap-2">
        {opts.cards.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-200 bg-white/70 px-3 py-4 text-center text-[12px] font-semibold text-slate-400">
            아직 노트가 없어요
          </p>
        ) : (
          opts.cards.map((card) => (
            <NoteItem
              key={card.id}
              card={card}
              isStudent={isStudent}
              roomId={opts.roomId}
              threadId={opts.threadId}
              editing={opts.editingId === card.id}
              onStartEdit={opts.onStartEdit}
              onCancelEdit={opts.onCancelEdit}
            />
          ))
        )}
      </div>
    </section>
  );
}

export function ConnectionNotesPanel(props: {
  room: Row | null;
  notes: Row[];
  viewerRole: "student" | "mentor";
  currentUserId: string;
  roomId: string;
  threadId?: string | null;
  threadCount: number;
  studentName?: string;
  mentorName?: string;
  /** desktop: 우측 aside / mobile: 중앙 하단 토글 블록 */
  variant?: "desktop" | "mobile";
}) {
  const variant = props.variant ?? "desktop";
  const [newNoteOpen, setNewNoteOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);

  const studentId = props.room ? partyUserIdFromRoomRow(props.room, "student") : null;
  const mentorId = props.room ? partyUserIdFromRoomRow(props.room, "mentor") : null;
  const studentLabel = props.studentName?.trim() || "학생";
  const mentorLabel = props.mentorName?.trim() || "멘토";

  function sideOf(n: Row): "student" | "mentor" | null {
    const aid = authorIdOf(n);
    if (studentId && aid === studentId) return "student";
    if (mentorId && aid === mentorId) return "mentor";
    const role = String(n.author_role ?? "").toLowerCase();
    if (role === "student") return "student";
    if (role === "mentor") return "mentor";
    if (aid) return aid === props.currentUserId ? props.viewerRole : props.viewerRole === "student" ? "mentor" : "student";
    return null;
  }

  const studentNotes: NoteCard[] = [];
  const mentorNotes: NoteCard[] = [];
  for (const n of props.notes) {
    const body = noteBodyOf(n);
    if (!body) continue;
    const side = sideOf(n);
    if (!side) continue;
    const aid = authorIdOf(n);
    const id = String(n.id ?? `${aid}-${body.slice(0, 8)}`);
    const card: NoteCard = {
      id,
      body,
      dateLabel: formatQuestionRoomDateTime(n.updated_at ?? n.created_at) ?? "",
      authorLabel: side === "student" ? studentLabel : mentorLabel,
      // 본인 author + id 가 실제 노트 id(레거시 author_id null 은 수정/삭제 불가)
      editable: Boolean(aid && aid === props.currentUserId && typeof n.id === "string"),
    };
    (side === "student" ? studentNotes : mentorNotes).push(card);
  }

  const totalCount = studentNotes.length + mentorNotes.length;

  const header = (
    <div className="border-b border-slate-200 bg-slate-50 px-5 py-4">
      <p className="flex items-center gap-2 text-[15px] font-extrabold text-slate-900">
        <Notebook className="h-[18px] w-[18px] text-slate-500" aria-hidden />
        연결 노트
      </p>
      <div className="mt-3 grid grid-cols-2 overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="flex items-center gap-2 px-3 py-2.5">
          <CalendarDays className="h-4 w-4 shrink-0 text-slate-500" aria-hidden />
          <span className="min-w-0">
            <span className="block text-[10px] font-bold text-slate-500">함께한 기간</span>
            <span className="block text-[15px] font-black tabular-nums text-slate-900">{periodTogether(props.room?.created_at)}</span>
          </span>
        </div>
        <div className="flex items-center gap-2 border-l border-slate-200 px-3 py-2.5">
          <MessagesSquare className="h-4 w-4 shrink-0 text-slate-500" aria-hidden />
          <span className="min-w-0">
            <span className="block text-[10px] font-bold text-slate-500">함께한 질문</span>
            <span className="block text-[15px] font-black tabular-nums text-slate-900">{props.threadCount}</span>
          </span>
        </div>
      </div>
    </div>
  );

  const columns = (
    <div className="flex flex-col gap-3 p-4">
      <NoteColumn
        side="student"
        title="학생의 노트"
        cards={studentNotes}
        viewerRole={props.viewerRole}
        roomId={props.roomId}
        threadId={props.threadId ?? null}
        editingId={editingId}
        onStartEdit={setEditingId}
        onCancelEdit={() => setEditingId(null)}
        onAddNote={() => setNewNoteOpen(true)}
      />
      <NoteColumn
        side="mentor"
        title="멘토의 노트"
        cards={mentorNotes}
        viewerRole={props.viewerRole}
        roomId={props.roomId}
        threadId={props.threadId ?? null}
        editingId={editingId}
        onStartEdit={setEditingId}
        onCancelEdit={() => setEditingId(null)}
        onAddNote={() => setNewNoteOpen(true)}
      />
    </div>
  );

  const modal = (
    <QuestionRoomNewNoteModal
      open={newNoteOpen}
      onClose={() => setNewNoteOpen(false)}
      roomId={props.roomId}
      threadId={props.threadId}
      actor={props.viewerRole}
    />
  );

  if (variant === "mobile") {
    return (
      <div className="lg:hidden">
        <button
          type="button"
          onClick={() => setMobileOpen((o) => !o)}
          className="flex w-full items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-[13px] font-extrabold text-slate-900"
        >
          <span className="inline-flex items-center gap-2">
            <Notebook className="h-4 w-4 text-slate-500" aria-hidden />
            연결 노트 ({totalCount})
          </span>
          <span className="text-[12px] font-bold text-slate-600">{mobileOpen ? "닫기" : "보기"}</span>
        </button>
        {mobileOpen ? (
          <div className="mt-2 overflow-hidden rounded-2xl border border-slate-200 bg-white">
            {header}
            {columns}
          </div>
        ) : null}
        {modal}
      </div>
    );
  }

  return (
    <aside className="hidden w-full shrink-0 flex-col bg-[#f8fafc] lg:flex lg:w-[420px]">
      <div className="custom-scrollbar flex min-h-0 flex-1 flex-col overflow-y-auto bg-white">
        {header}
        {columns}
      </div>
      {modal}
    </aside>
  );
}
