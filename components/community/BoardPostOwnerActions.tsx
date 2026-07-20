"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Pencil, Trash2 } from "lucide-react";
import { softDeleteCommunityBoardPostAction } from "@/lib/community/communityBoardActions";

/**
 * 게시글 작성자 전용 수정·삭제 컨트롤(실제 동작). 상세 화면에서 작성자에게만 렌더한다.
 * 삭제는 soft-delete(서버가 소유권 재검증) — hard DELETE 아님. 성공 시 목록으로 이동.
 */
export function BoardPostOwnerActions(props: { postId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    if (pending) return;
    if (!window.confirm("이 게시글을 삭제할까요? 삭제하면 목록과 상세에서 보이지 않습니다.")) return;
    setPending(true);
    setError(null);
    try {
      const res = await softDeleteCommunityBoardPostAction({ postId: props.postId });
      if (!res.ok) {
        setError(res.error === "not_found" ? "삭제 권한이 없거나 이미 삭제된 글입니다." : "삭제에 실패했습니다.");
        setPending(false);
        return;
      }
      router.push("/community/board");
      router.refresh();
    } catch {
      setError("삭제에 실패했습니다.");
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        <Link
          href={`/community/new?editId=${props.postId}`}
          className="inline-flex items-center gap-1 rounded-full border border-slate-200 px-3 py-1 text-xs font-bold text-slate-600 transition hover:border-[#2563EB] hover:text-[#2563EB]"
        >
          <Pencil className="h-3.5 w-3.5" aria-hidden /> 수정
        </Link>
        <button
          type="button"
          onClick={handleDelete}
          disabled={pending}
          className="inline-flex items-center gap-1 rounded-full border border-slate-200 px-3 py-1 text-xs font-bold text-red-600 transition hover:border-red-300 hover:bg-red-50 disabled:opacity-60"
        >
          <Trash2 className="h-3.5 w-3.5" aria-hidden /> {pending ? "삭제 중…" : "삭제"}
        </button>
      </div>
      {error ? <p className="text-[11px] font-semibold text-red-600">{error}</p> : null}
    </div>
  );
}
