/**
 * 멘토별 화면 — [연결노트] 탭(§3): `created_at` 순 타임라인. 작성자를 색·라벨로 구분(멘토 #059669 · 학생 #2563EB). Server Component.
 * 건수 가정 없음 — 조회 모듈이 넘긴 배열을 전부 그린다. `ink_path` 는 무시하고 텍스트만.
 */
import { EmptyState } from "@/components/common/EmptyState";
import { EMPTY_CONNECTION_NOTES, PARTY_ROLE_LABELS } from "@/lib/admin/questionDrilldownConsole";
import type { ConnectionNoteView } from "@/lib/admin/questionDrilldownQueries";
import { formatKoDateTimeKst } from "@/lib/utils/kstTime";
import { cn } from "@/lib/utils/cn";

type Props = { roomId: string; notes: { rows: ConnectionNoteView[]; error: string | null } };

/** 지시서 §3 색 — `CONNECTION_NOTE_AUTHOR_COLORS` 와 같은 값(계약 테스트가 대조). */
const AUTHOR_STYLE = {
  mentor: { dot: "bg-[#059669]", text: "text-[#059669]", border: "border-[#059669]/30" },
  student: { dot: "bg-[#2563EB]", text: "text-[#2563EB]", border: "border-[#2563EB]/30" },
  unknown: { dot: "bg-slate-400", text: "text-slate-500", border: "border-slate-200" },
} as const;

export function ConnectionNoteTimeline({ roomId, notes }: Props) {
  if (notes.error) {
    return (
      <div role="alert" className="rounded-2xl border border-red-200 bg-red-50/60 p-5 text-sm text-red-950">
        <p className="font-bold">{notes.error}</p>
      </div>
    );
  }
  if (!notes.rows.length) {
    return <EmptyState title={EMPTY_CONNECTION_NOTES} description="연결노트는 구독 관계(방)에서 멘토·학생이 남기는 장기 학습 메모입니다." />;
  }
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm" aria-label="연결노트 타임라인" data-connection-notes={roomId} data-note-count={notes.rows.length}>
      <ol className="space-y-4">
        {notes.rows.map((note) => {
          const style = AUTHOR_STYLE[note.authorRole];
          return (
            <li key={note.id} className={cn("relative rounded-xl border bg-white pl-6 pr-4 py-3", style.border)} data-note-id={note.id} data-note-author-role={note.authorRole}>
              <span aria-hidden="true" className={cn("absolute left-2.5 top-4 h-2.5 w-2.5 rounded-full", style.dot)} />
              <p className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs">
                <span className={cn("font-extrabold", style.text)}>
                  {PARTY_ROLE_LABELS[note.authorRole]} · {note.authorName}
                </span>
                <span className="tabular-nums text-slate-500">{formatKoDateTimeKst(note.createdAt)}</span>
              </p>
              <p className="mt-1.5 whitespace-pre-wrap break-words text-sm leading-6 text-slate-800">{note.body || <span className="text-slate-400">(본문 없음)</span>}</p>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
