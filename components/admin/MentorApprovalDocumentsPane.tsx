"use client";

/**
 * 멘토 승인 작업대 — 중앙 서류 뷰어 칸(PR-2 §1·§3).
 * 학생증 / 학교 인증 서류를 세그먼트로 전환한다. 없는 서류는 빈 뷰어 대신 "제출된 서류 없음" 이다.
 */
import { useState } from "react";
import { DocumentViewer } from "@/components/admin/DocumentViewer";
import { EmptyState } from "@/components/common/EmptyState";
import { DOCUMENT_EMPTY_LABEL, type DocumentViewerSource } from "@/lib/admin/documentViewerModel";
import { cn } from "@/lib/utils/cn";

type DocKey = "studentId" | "school";

type Props = {
  mentorUserId: string | null;
  mentorName: string;
  /** null = 학생증 미제출 */
  studentIdDocument: DocumentViewerSource | null;
  /** null = 학교 인증 서류 없음 */
  schoolDocument: DocumentViewerSource | null;
};

export function MentorApprovalDocumentsPane(props: Props) {
  const { mentorUserId, mentorName, studentIdDocument, schoolDocument } = props;
  const [active, setActive] = useState<DocKey>("studentId");

  if (!mentorUserId) {
    return (
      <div className="flex h-full min-h-[320px] items-center justify-center rounded-2xl border border-slate-700 bg-slate-900 p-6">
        <p className="text-sm font-semibold text-slate-300">지원자를 선택하면 서류가 여기에 보입니다.</p>
      </div>
    );
  }

  const docs: { key: DocKey; label: string; source: DocumentViewerSource | null }[] = [
    { key: "studentId", label: "학생증 · 재학증명", source: studentIdDocument },
    { key: "school", label: "학교 인증 서류", source: schoolDocument },
  ];
  const current = docs.find((d) => d.key === active) ?? docs[0];

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1 rounded-xl bg-slate-100 p-1" role="tablist" aria-label="서류 종류">
        {docs.map((d) => {
          const selected = d.key === current.key;
          return (
            <button
              key={d.key}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => setActive(d.key)}
              className={cn(
                "rounded-lg px-3 py-1.5 text-xs font-extrabold transition",
                selected ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"
              )}
            >
              {d.label}
              <span className={cn("ml-1.5 text-[10px] font-bold", d.source ? "text-emerald-600" : "text-slate-400")}>
                {d.source ? "있음" : "없음"}
              </span>
            </button>
          );
        })}
      </div>
      {current.source ? (
        <DocumentViewer
          key={`${mentorUserId}:${current.key}:${current.source.storedRef}`}
          storagePath={current.source.storedRef}
          fileSizeBytes={current.source.sizeBytes}
          initialSource={current.source}
          alt={`${mentorName} ${current.label}`}
          listenFullscreenShortcut
          className="min-h-[420px]"
        />
      ) : (
        <div className="flex min-h-[320px] flex-1 items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6">
          <EmptyState
            title={DOCUMENT_EMPTY_LABEL}
            description={
              current.key === "school"
                ? "학교 인증 서류가 제출되지 않았습니다. 학교 등급은 우측 ③에서 자동 판정값을 확인합니다."
                : "학생증이 제출되지 않았습니다. 재제출 요청으로 안내해 주세요."
            }
          />
        </div>
      )}
    </div>
  );
}
