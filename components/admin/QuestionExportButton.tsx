"use client";

/**
 * 질문 목록의 `내보내기`(PR-13 §2-2) — PR-8 질문 목록 세 곳(학생 [개별질문] · 멘토별 화면 [질문] · 멘토 [개별질문 답변])에 붙는 버튼.
 * 시트는 공용 확인 절차(`ConfirmSubmitButton` stateChange)로 그린다: 범위(현재 목록 N건 · 필터 적용됨) · 포함 항목 체크 3종 · 형식 · 감사 로그 안내 → `N건 내보내기`.
 * 확인하면 서버 라우트(`/api/admin/question-export`)의 CSV 를 내려받는다 — 클라이언트는 URL 을 열 뿐 조립하지 않는다.
 * 상한 200건 초과·0건이면 확인이 잠긴다(서버도 같은 상한을 다시 확인한다).
 */
import { useState } from "react";
import { ConfirmSubmitButton } from "@/components/admin/ConfirmSubmitButton";
import {
  QUESTION_EXPORT_DEFAULT_INCLUDES,
  QUESTION_EXPORT_INCLUDE_KEYS,
  QUESTION_EXPORT_INCLUDE_LABELS,
  QUESTION_EXPORT_SHEET,
  buildQuestionExportUrl,
  formatQuestionExportScopeSummary,
  questionExportBlockedMessage,
  questionExportConfirmLabel,
  type QuestionExportIncludes,
  type QuestionExportScope,
} from "@/lib/admin/questionExportConsole";

type Props = {
  scope: QuestionExportScope;
  /** 현재 목록(필터 적용) 전체 건수 — 시트의 범위 표기·상한 판정 */
  totalCount: number;
};

export function QuestionExportButton({ scope, totalCount }: Props) {
  const [includes, setIncludes] = useState<QuestionExportIncludes>(
    QUESTION_EXPORT_DEFAULT_INCLUDES,
  );
  const blocked = questionExportBlockedMessage(totalCount);
  const href = buildQuestionExportUrl(scope, includes);

  const download = async () => {
    // 서버가 attachment 로 응답하므로 화면은 그대로 남는다. 조립은 전부 서버.
    const a = document.createElement("a");
    a.href = href;
    a.rel = "noopener";
    a.download = "";
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  return (
    <span
      data-question-export={scope.kind}
      data-question-export-total={totalCount}
    >
      <ConfirmSubmitButton
        level="stateChange"
        dialogTitle={QUESTION_EXPORT_SHEET.title}
        summary={`${QUESTION_EXPORT_SHEET.namesNote}\nⓘ ${QUESTION_EXPORT_SHEET.auditNote}`}
        details={[
          {
            label: QUESTION_EXPORT_SHEET.scopeLabel,
            value: formatQuestionExportScopeSummary(totalCount),
          },
          {
            label: QUESTION_EXPORT_SHEET.formatLabel,
            value: QUESTION_EXPORT_SHEET.format,
          },
        ]}
        body={
          <fieldset data-question-export-includes>
            <legend className="text-xs font-bold text-slate-700">
              {QUESTION_EXPORT_SHEET.includeLabel}
            </legend>
            <div className="mt-1.5 flex flex-wrap gap-2">
              {QUESTION_EXPORT_INCLUDE_KEYS.map((key) => (
                <label
                  key={key}
                  className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-bold text-slate-800 hover:bg-slate-50"
                >
                  <input
                    type="checkbox"
                    checked={includes[key]}
                    onChange={(e) =>
                      setIncludes({ ...includes, [key]: e.target.checked })
                    }
                    className="h-3.5 w-3.5"
                    data-include-key={key}
                  />
                  {QUESTION_EXPORT_INCLUDE_LABELS[key]}
                </label>
              ))}
            </div>
          </fieldset>
        }
        confirmBlockedMessage={blocked}
        confirmLabel={questionExportConfirmLabel(totalCount)}
        pendingLabel="내려받는 중…"
        onConfirm={download}
        className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-extrabold text-slate-800 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
        title="현재 목록을 CSV 로 내보냅니다(감사 로그 기록)"
      >
        {QUESTION_EXPORT_SHEET.button}
      </ConfirmSubmitButton>
    </span>
  );
}
