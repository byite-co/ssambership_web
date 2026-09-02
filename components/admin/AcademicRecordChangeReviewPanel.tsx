"use client";

/**
 * 학적 변경 심사(PR-5 §2-2) — 좌: 서류(PR-2 `DocumentViewer` 그대로 재사용) · 우: 변경 전후 나란히 + 학교 등급 + 결정.
 *
 * - 서류 없는 요청은 빈 뷰어 대신 `제출된 서류 없음`(`DOCUMENT_EMPTY_LABEL`).
 * - 변경 전 = 프로필(대학·학과) · 변경 후 = 요청 대학(학과는 요청 항목에 없어 그대로).
 * - 학교 등급: **현재 등급**과 "승인이 등급을 다시 판정하지 않는다" 는 안내만 보인다 — 요청 대학명으로 등급을 판정하는 함수가
 *   코드에 없어 미리보기를 생략했다(지시서 §2-2 · 새 계산 로직 금지). 판정 규칙은 SQL 트리거에만 있다.
 * - 승인 = `ConfirmSubmitButton` stateChange(summary 에 전후 학교·학과 그대로·등급 변동 없음) — 확정 학교명은 요청값이 기본이고 고칠 수 있다
 *   (이관 전 화면의 입력 유지 · 액션이 읽는 `approvedUniversityName`). 반려·재제출 = stateChange + 사유 프리셋(칩 클릭 = 확인 · `rejectReason`).
 * - 클라이언트 컴포넌트인 이유는 확정 학교명 입력 하나다(summary 가 입력값을 따라간다). 데이터는 전부 서버가 넘긴다.
 */
import { useState } from "react";
import { AdminStatusPill } from "@/components/admin/AdminStatusPill";
import { ConfirmSubmitButton } from "@/components/admin/ConfirmSubmitButton";
import { DocumentViewer } from "@/components/admin/DocumentViewer";
import { StatusBadge } from "@/components/design-system/StatusBadge";
import { EmptyState } from "@/components/common/EmptyState";
import {
  ACADEMIC_RECORD_CHANGE_APPROVED_NAME_FIELD,
  ACADEMIC_RECORD_CHANGE_CUSTOM_REASON_LABEL,
  ACADEMIC_RECORD_CHANGE_DECISION_BUTTON_IDS,
  ACADEMIC_RECORD_CHANGE_DECISION_LABELS,
  ACADEMIC_RECORD_CHANGE_REASON_FIELD,
  ACADEMIC_RECORD_CHANGE_REASON_PRESETS,
  ACADEMIC_RECORD_CHANGE_REQUEST_ID_FIELD,
  ACADEMIC_RECORD_CHANGE_TIER_NOTE,
  buildAcademicRecordChangeApproveSummary,
  buildAcademicRecordChangeRejectSummary,
  buildAcademicRecordChangeResubmitSummary,
} from "@/lib/admin/academicRecordChangeConsole";
import type { AcademicRecordChangeDetail } from "@/lib/admin/academicRecordChangeQueries";
import { DOCUMENT_EMPTY_LABEL } from "@/lib/admin/documentViewerModel";
import { SCHOOL_TIER_BADGE_AUTO, SCHOOL_TIER_BADGE_CONFIRMED_PREFIX } from "@/lib/admin/mentorSchoolTierReview";
import {
  approveMentorAcademicRecordChangeAction,
  rejectMentorAcademicRecordChangeAction,
  requestMentorAcademicRecordChangeResubmitAction,
} from "@/lib/admin/mentorAcademicRecordChangeReviewActions";
import { formatKoDateTimeKst } from "@/lib/utils/kstTime";

type Props = {
  /** null = 선택된 요청이 없다(목록이 비었거나 id 가 틀림) */
  detail: AcademicRecordChangeDetail | null;
  /** 직전 처리 실패 안내(URL `error`) */
  flashError: string | null;
};

const BUTTON_BASE = "inline-flex h-11 w-full items-center justify-center rounded-xl text-sm font-extrabold transition disabled:cursor-not-allowed disabled:opacity-60";

function Cell(props: { label: string; value: string; emphasis?: boolean }) {
  return (
    <div>
      <dt className="text-[11px] font-bold text-slate-500">{props.label}</dt>
      <dd className={props.emphasis ? "mt-0.5 text-base font-black text-slate-900" : "mt-0.5 text-sm font-semibold text-slate-800"}>{props.value || "—"}</dd>
    </div>
  );
}

export function AcademicRecordChangeReviewPanel({ detail, flashError }: Props) {
  // 확정 학교명 — 요청값이 기본. 요청이 바뀌면 key 로 리마운트되어 초기화된다(페이지가 key={detail.id} 를 넘긴다).
  const [approvedName, setApprovedName] = useState(detail?.requestedUniversity ?? "");

  if (!detail) {
    return (
      <section className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6" aria-label="학적 변경 심사">
        <EmptyState title="심사할 요청을 선택해 주세요" description="목록에서 멘토를 누르면 서류와 변경 전후가 여기에 보입니다." />
      </section>
    );
  }

  const tierLabel = detail.tier.label;
  const approveSummary = buildAcademicRecordChangeApproveSummary({
    name: detail.mentorName,
    beforeUniversity: detail.currentUniversity,
    beforeDepartment: detail.currentDepartment,
    afterUniversity: approvedName,
    tierLabel,
  });

  return (
    <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_400px]" aria-label="학적 변경 심사" data-academic-record-change-review={detail.id}>
      {/* 서류 */}
      <div className="flex min-h-[420px] flex-col">
        {detail.document ? (
          <DocumentViewer
            key={`${detail.id}:${detail.document.storedRef}`}
            storagePath={detail.document.storedRef}
            fileSizeBytes={detail.document.sizeBytes}
            initialSource={detail.document}
            alt={`${detail.mentorName} 학적 변경 증빙 서류`}
            listenFullscreenShortcut
            className="min-h-[420px]"
          />
        ) : (
          <div className="flex min-h-[420px] flex-1 items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6">
            <EmptyState title={DOCUMENT_EMPTY_LABEL} description="증빙 서류가 제출되지 않았습니다. 재제출 요청으로 안내해 주세요." />
          </div>
        )}
      </div>

      {/* 변경 전후 + 결정 */}
      <div className="flex flex-col rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-4 py-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <h2 className="truncate text-base font-black text-slate-900">{detail.mentorName}</h2>
              <p className="truncate text-xs text-slate-500">{detail.mentorEmail ?? "이메일 없음"} · 요청 {formatKoDateTimeKst(detail.createdAt)}</p>
            </div>
            <AdminStatusPill table="mentor_academic_record_change_requests" column="status" value={detail.status} size="sm" className="shrink-0" />
          </div>
        </div>

        <div className="space-y-4 px-4 py-4">
          <dl className="grid grid-cols-2 gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3" data-academic-record-change-diff>
            <div className="space-y-2">
              <p className="text-xs font-black text-slate-500">변경 전</p>
              <Cell label="대학" value={detail.currentUniversity} emphasis />
              <Cell label="학과" value={detail.currentDepartment} />
            </div>
            <div className="space-y-2 border-l border-slate-200 pl-3">
              <p className="text-xs font-black text-blue-700">변경 후</p>
              <Cell label="대학" value={detail.reviewable ? approvedName : detail.approvedUniversity || detail.requestedUniversity} emphasis />
              <Cell label="학과" value={detail.currentDepartment ? `${detail.currentDepartment} (그대로)` : "요청 없음"} />
            </div>
          </dl>

          <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2" data-academic-record-change-tier>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-black text-amber-900">학교 등급</p>
              {detail.tier.mode === "none" ? (
                <StatusBadge label="인증 행 없음" tone="neutral" size="sm" />
              ) : detail.tier.mode === "auto" ? (
                <StatusBadge label={SCHOOL_TIER_BADGE_AUTO} tone="warning" size="sm" />
              ) : (
                <StatusBadge label={SCHOOL_TIER_BADGE_CONFIRMED_PREFIX} tone="success" size="sm" />
              )}
            </div>
            <p className="mt-1 text-sm font-extrabold text-amber-950">
              {tierLabel ? `${tierLabel} → ${tierLabel} (동일)` : "현재 등급 정보 없음"}
            </p>
            <p className="mt-1 text-[11px] leading-4 text-amber-900">{ACADEMIC_RECORD_CHANGE_TIER_NOTE}</p>
          </div>

          <dl className="space-y-2 text-sm">
            <Cell label="변경 사유" value={detail.changeReason} />
            {!detail.reviewable ? (
              <>
                <Cell label="처리" value={`${detail.reviewerName ?? "관리자"} · ${formatKoDateTimeKst(detail.reviewedAt)}`} />
                {detail.rejectReason ? <Cell label="반려·재제출 사유" value={detail.rejectReason} /> : null}
              </>
            ) : null}
          </dl>
        </div>

        {detail.reviewable ? (
          <div className="mt-auto space-y-2 border-t border-slate-200 bg-white p-3" data-academic-record-change-decision>
            {flashError ? (
              <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-900">
                처리 실패 — {flashError} 같은 버튼으로 다시 시도할 수 있습니다.
              </p>
            ) : null}
            <form action={approveMentorAcademicRecordChangeAction} className="space-y-2">
              <input type="hidden" name={ACADEMIC_RECORD_CHANGE_REQUEST_ID_FIELD} value={detail.id} />
              <label htmlFor={`approved-name-${detail.id}`} className="text-[11px] font-bold text-slate-600">
                확정 학교명 (승인 시 멘토 프로필에 반영)
              </label>
              <input
                id={`approved-name-${detail.id}`}
                name={ACADEMIC_RECORD_CHANGE_APPROVED_NAME_FIELD}
                type="text"
                maxLength={40}
                value={approvedName}
                onChange={(e) => setApprovedName(e.target.value)}
                className="block w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-800 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
              />
              <ConfirmSubmitButton
                id={ACADEMIC_RECORD_CHANGE_DECISION_BUTTON_IDS.approve}
                level="stateChange"
                summary={approveSummary}
                dialogTitle="학적 변경 승인"
                confirmLabel="승인"
                pendingLabel="승인 중…"
                disabled={!approvedName.trim()}
                title={approvedName.trim() ? undefined : "확정 학교명을 입력해야 승인할 수 있습니다"}
                className={`${BUTTON_BASE} bg-[#1A56DB] text-white hover:bg-[#1747B8]`}
              >
                {ACADEMIC_RECORD_CHANGE_DECISION_LABELS.approve}
              </ConfirmSubmitButton>
            </form>
            <div className="grid grid-cols-2 gap-2">
              <form action={rejectMentorAcademicRecordChangeAction}>
                <input type="hidden" name={ACADEMIC_RECORD_CHANGE_REQUEST_ID_FIELD} value={detail.id} />
                <ConfirmSubmitButton
                  id={ACADEMIC_RECORD_CHANGE_DECISION_BUTTON_IDS.reject}
                  level="stateChange"
                  summary={buildAcademicRecordChangeRejectSummary(detail.mentorName)}
                  dialogTitle="반려 사유"
                  confirmLabel="반려"
                  pendingLabel="반려 중…"
                  reasonRequired
                  reasonFieldName={ACADEMIC_RECORD_CHANGE_REASON_FIELD}
                  reasonLabel="반려 사유"
                  reasonPresets={ACADEMIC_RECORD_CHANGE_REASON_PRESETS}
                  customReasonLabel={ACADEMIC_RECORD_CHANGE_CUSTOM_REASON_LABEL}
                  className={`${BUTTON_BASE} border-2 border-red-500 bg-white text-red-700 hover:bg-red-50`}
                >
                  {ACADEMIC_RECORD_CHANGE_DECISION_LABELS.reject}
                </ConfirmSubmitButton>
              </form>
              <form action={requestMentorAcademicRecordChangeResubmitAction}>
                <input type="hidden" name={ACADEMIC_RECORD_CHANGE_REQUEST_ID_FIELD} value={detail.id} />
                <ConfirmSubmitButton
                  id={ACADEMIC_RECORD_CHANGE_DECISION_BUTTON_IDS.resubmit}
                  level="stateChange"
                  summary={buildAcademicRecordChangeResubmitSummary(detail.mentorName)}
                  dialogTitle="재제출 요청 사유"
                  confirmLabel="재제출 요청"
                  pendingLabel="요청 중…"
                  reasonRequired
                  reasonFieldName={ACADEMIC_RECORD_CHANGE_REASON_FIELD}
                  reasonLabel="재제출 요청 사유"
                  reasonPresets={ACADEMIC_RECORD_CHANGE_REASON_PRESETS}
                  customReasonLabel={ACADEMIC_RECORD_CHANGE_CUSTOM_REASON_LABEL}
                  className={`${BUTTON_BASE} border-2 border-slate-300 bg-white text-slate-800 hover:bg-slate-50`}
                >
                  {ACADEMIC_RECORD_CHANGE_DECISION_LABELS.resubmit}
                </ConfirmSubmitButton>
              </form>
            </div>
            <p className="text-[11px] leading-4 text-slate-500">반려·재제출은 사유를 누르면 바로 처리됩니다. 재제출 요청은 멘토가 서류를 고쳐 다시 낼 수 있습니다.</p>
          </div>
        ) : null}
      </div>
    </section>
  );
}
