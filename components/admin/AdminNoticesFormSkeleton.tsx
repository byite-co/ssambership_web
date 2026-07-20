"use client";

import { FormSubmitButton } from "@/components/common/FormSubmitButton";
import { submitAdminNoticeDraft } from "@/lib/admin/adminNoticesActions";
import { toAdminDisplayError } from "@/lib/admin/adminDisplayError";

type Hints = {
  title: string | null;
  body: string | null;
  type: string | null;
  target: string | null;
  start: string | null;
  end: string | null;
  active: string | null;
} | null;

export function AdminNoticesFormSkeleton(props: { hints: Hints; errorMessage: string | null; ok: boolean; hintTable: string | null }) {
  const { hints, errorMessage, ok, hintTable } = props;
  const safeError = toAdminDisplayError(errorMessage, "notices");
  return (
    <form action={submitAdminNoticeDraft} className="space-y-2 rounded-2xl border border-slate-200 bg-slate-50/60 p-4">
      <h3 className="text-sm font-extrabold text-slate-900">새 공지 또는 프로모션</h3>
      {ok ? <p className="text-sm font-bold text-emerald-800">저장되었습니다. 목록에서 확인할 수 있습니다.</p> : null}
      {safeError ? <p className="text-sm font-bold text-red-800">{safeError}</p> : null}
      {hintTable && hints ? (
        <p className="text-xs text-slate-500">입력한 내용은 목록 형식에 맞게 저장됩니다.</p>
      ) : (
        <p className="text-xs text-slate-500">
          공지·프로모션 저장소에 초안으로 등록됩니다. 변경 이력을 더 살보려면 감사 로그 메뉴를 함께 확인할 수 있습니다.
        </p>
      )}

      <label className="block text-sm font-extrabold text-slate-800">
        제목
        <input name="title" required className="mt-1 w-full rounded border border-slate-200 bg-white px-2 py-1.5" />
      </label>
      <label className="block text-sm font-extrabold text-slate-800">
        본문·배너 문구(요약)
        <textarea name="body" rows={3} className="mt-1 w-full rounded border border-slate-200 bg-white px-2 py-1.5" />
      </label>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="text-sm font-extrabold text-slate-800">
          유형
          <select name="resource" className="mt-1 w-full rounded border border-slate-200 bg-white px-2 py-1.5" defaultValue="notice">
            <option value="notice">공지</option>
            <option value="promotion">프로모션</option>
          </select>
        </label>
        <label className="text-sm font-extrabold text-slate-800">
          타겟/노출 화면(문자)
          <input name="target" className="mt-1 w-full rounded border border-slate-200 bg-white px-2 py-1.5" placeholder="예: 홈, 요금제" />
        </label>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="text-sm font-extrabold text-slate-800">
          노출 시작
          <input name="start" type="datetime-local" className="mt-1 w-full rounded border border-slate-200 bg-white px-2 py-1.5" />
        </label>
        <label className="text-sm font-extrabold text-slate-800">
          노출 종료
          <input name="end" type="datetime-local" className="mt-1 w-full rounded border border-slate-200 bg-white px-2 py-1.5" />
        </label>
      </div>
      <label className="flex items-center gap-2 text-sm text-slate-800">
        <input type="checkbox" name="active" value="on" defaultChecked />
        활성(비활성은 저장 후 목록에서 조정)
      </label>
      <FormSubmitButton
        idleLabel="임시 저장"
        pendingLabel="처리 중…"
        className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-bold text-white enabled:hover:bg-slate-800 disabled:bg-slate-300"
      />
    </form>
  );
}
