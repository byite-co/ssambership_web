"use client";

import { useState } from "react";
import { FormSubmitButton } from "@/components/common/FormSubmitButton";
import { requestAccountDeletion } from "@/lib/account/accountDeletionActions";

const REASONS = ["더 이상 이용하지 않아요", "원하는 멘토·서비스가 없어요", "개인정보가 걱정돼요", "기타"] as const;

/**
 * 회원 탈퇴 폼 (스펙 §3) — 사유(선택) → 비밀번호 → 이해 동의 → 2단 확인 버튼.
 * blockersOk=false면 전체 비활성(사전조건 미충족 안내는 페이지가 렌더).
 */
export function AccountDeletionForm(props: {
  blockersOk: boolean;
  requiresForfeitConsent: boolean;
  balanceLabel: string | null;
}) {
  const [armed, setArmed] = useState(false);
  const disabled = !props.blockersOk;

  return (
    <form action={requestAccountDeletion} className="space-y-4">
      <label className="block text-sm font-semibold text-slate-700">
        탈퇴 사유 (선택)
        <select
          name="reason"
          disabled={disabled}
          className="mt-1 block w-full rounded-lg border border-slate-200 px-3 py-2 text-sm disabled:bg-slate-50"
          defaultValue=""
        >
          <option value="">선택 안 함</option>
          {REASONS.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </label>

      <label className="block text-sm font-semibold text-slate-700">
        비밀번호 확인
        <input
          type="password"
          name="password"
          required
          disabled={disabled}
          autoComplete="current-password"
          className="mt-1 block w-full rounded-lg border border-slate-200 px-3 py-2 text-sm disabled:bg-slate-50"
          placeholder="현재 비밀번호"
        />
      </label>

      {props.requiresForfeitConsent ? (
        <label className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
          <input type="checkbox" name="forfeitConsent" disabled={disabled} className="mt-0.5" />
          <span>
            남은 캐시 <strong className="font-extrabold">{props.balanceLabel}</strong>의 소멸에 동의합니다. (환불을
            원하면 탈퇴 전에 환불 신청을 먼저 진행해 주세요)
          </span>
        </label>
      ) : null}

      <label className="flex items-start gap-2 text-sm text-slate-700">
        <input type="checkbox" name="understood" required disabled={disabled} className="mt-0.5" />
        <span>위 내용을 이해했으며 탈퇴합니다.</span>
      </label>

      {!armed ? (
        <button
          type="button"
          disabled={disabled}
          onClick={() => setArmed(true)}
          className="w-full rounded-xl border border-red-200 bg-white px-4 py-3 text-sm font-extrabold text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          탈퇴 진행하기
        </button>
      ) : (
        <div className="space-y-2">
          <p className="text-center text-xs font-bold text-red-600">정말 탈퇴할까요? 이 작업은 되돌릴 수 없습니다.</p>
          <FormSubmitButton
            idleLabel="네, 계정을 삭제합니다"
            pendingLabel="탈퇴 처리 중…"
            disabled={disabled}
            className="w-full rounded-xl bg-red-600 px-4 py-3 text-sm font-extrabold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
          />
          <button
            type="button"
            onClick={() => setArmed(false)}
            className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-600 hover:bg-slate-50"
          >
            취소
          </button>
        </div>
      )}
    </form>
  );
}
