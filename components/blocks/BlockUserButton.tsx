"use client";

import { useState } from "react";
import { FormSubmitButton } from "@/components/common/FormSubmitButton";
import { blockUserAction } from "@/lib/blocks/userBlocksActions";

/**
 * '이 사용자 차단' 버튼 (스펙 §4) — 신고 버튼과 같은 화면에서 접근(신고+차단 병존).
 * 2단 인라인 확인(다이얼로그 문구는 스펙 §4). 차단은 노출 필터일 뿐 상대 기능 제한이 아님.
 * 플래그 OFF면 호출부(서버)에서 아예 렌더하지 않는다.
 */
export function BlockUserButton(props: { blockedUserId: string; returnTo: string }) {
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="inline-flex items-center rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-500 hover:bg-slate-50 hover:text-slate-700"
      >
        이 사용자 차단
      </button>
    );
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
      <span className="text-xs font-medium leading-relaxed text-slate-600">
        이 사용자의 게시글·댓글·숏폼이 더 이상 보이지 않아요. 언제든 해제할 수 있어요.
      </span>
      <form action={blockUserAction} className="inline-flex items-center gap-1.5">
        <input type="hidden" name="blockedUserId" value={props.blockedUserId} />
        <input type="hidden" name="returnTo" value={props.returnTo} />
        <FormSubmitButton
          idleLabel="차단"
          pendingLabel="차단 중…"
          className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-extrabold text-white hover:bg-slate-900"
        />
      </form>
      <button
        type="button"
        onClick={() => setConfirming(false)}
        className="rounded-lg px-2 py-1.5 text-xs font-bold text-slate-500 hover:text-slate-700"
      >
        취소
      </button>
    </span>
  );
}
