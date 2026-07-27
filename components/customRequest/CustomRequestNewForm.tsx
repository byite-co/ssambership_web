"use client";

import type { ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { FormSubmitButton } from "@/components/common/FormSubmitButton";
import { submitCustomRequestNew } from "@/lib/customRequest/customRequestComposeActions";
import { CustomRequestFlowStepper } from "@/components/customRequest/CustomRequestFlowStepper";
import { CustomRequestPolicyNotice } from "@/components/customRequest/CustomRequestPolicyNotice";
import { CUSTOM_REQUEST_BANNED_WARNING } from "@/lib/customRequest/bannedPhrases";
import { findRestrictedPhraseInText } from "@/lib/safety/trustSafetyText";
import { POST_ATTACHMENT_MAX_FILES } from "@/lib/customRequest/postAttachmentConstants";

const CATEGORIES = ["수학", "영어", "국어", "과학", "사회", "기타"] as const;

const BUDGET_OPTIONS = [
  { value: 10000, label: "10,000 캐시" },
  { value: 30000, label: "30,000 캐시" },
  { value: 50000, label: "50,000 캐시" },
  { value: 100000, label: "100,000 캐시" },
  { value: 200000, label: "200,000 캐시" },
] as const;

const BUDGET_MIN = 1000;
const BUDGET_MAX = 200000;

type BudgetMode = "preset" | "custom";

export type CustomRequestDraftFormInitial = {
  id: string;
  category?: string | null;
  subject?: string | null;
  body?: string | null;
  deadline?: string | null;
  budgetMin?: string | number | null;
  budgetMax?: string | number | null;
};

function parseBudgetDigits(raw: string): number | null {
  const digits = raw.replace(/\D/g, "");
  if (!digits) return null;
  const n = Number(digits);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.floor(n);
}

function formatBudgetDigits(raw: string): string {
  const n = parseBudgetDigits(raw);
  return n == null ? "" : n.toLocaleString("ko-KR");
}

function budgetNumberFromInitial(draft: CustomRequestDraftFormInitial | null | undefined): number | null {
  const raw = draft?.budgetMin ?? draft?.budgetMax;
  if (raw == null || raw === "") return null;
  const n = typeof raw === "number" ? raw : Number(String(raw).replace(/\D/g, ""));
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.floor(n);
}

const BODY_PLACEHOLDER =
  "어떤 도움이 필요한지 구체적으로 적어주세요.\n예: 수학 미적분 개념 정리 노트 제작, 영어 독해 지문 분석 피드백 등";

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function FormSection(props: { step: string; title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="form-section">
      <div className="form-section-head">
        <span className="ticon blue sm" aria-hidden>
          {props.step}
        </span>
        <div className="min-w-0">
          <h3>{props.title}</h3>
          {props.hint ? <p>{props.hint}</p> : null}
        </div>
      </div>
      {props.children}
    </section>
  );
}

export function CustomRequestNewForm(props: { errorMessage: string | null; draft?: CustomRequestDraftFormInitial | null }) {
  const initialBudget = budgetNumberFromInitial(props.draft);
  const initialBudgetIsPreset = initialBudget != null && BUDGET_OPTIONS.some((opt) => opt.value === initialBudget);
  const [selectedCat, setSelectedCat] = useState(props.draft?.category ?? "");
  const [subject, setSubject] = useState(props.draft?.subject ?? "");
  const [body, setBody] = useState(props.draft?.body ?? "");
  const [budgetMode, setBudgetMode] = useState<BudgetMode>(initialBudget && !initialBudgetIsPreset ? "custom" : "preset");
  const [presetBudget, setPresetBudget] = useState<number>(initialBudgetIsPreset && initialBudget ? initialBudget : 50000);
  const [customBudgetRaw, setCustomBudgetRaw] = useState(initialBudget && !initialBudgetIsPreset ? String(initialBudget) : "");
  const [selectedFiles, setSelectedFiles] = useState<{ name: string; size: number }[]>([]);

  const customBudget = useMemo(() => parseBudgetDigits(customBudgetRaw), [customBudgetRaw]);
  const effectiveBudget = budgetMode === "preset" ? presetBudget : customBudget;
  const customBudgetInputRef = useRef<HTMLInputElement>(null);

  function activateCustomBudgetMode() {
    setBudgetMode("custom");
  }

  useEffect(() => {
    if (budgetMode === "custom") {
      customBudgetInputRef.current?.focus();
    }
  }, [budgetMode]);

  const bannedHit = useMemo(() => findRestrictedPhraseInText(`${subject}\n${body}`), [subject, body]);
  const [showIncomplete, setShowIncomplete] = useState(false);

  const incompleteFields = useMemo(() => {
    const list: string[] = [];
    if (!selectedCat) list.push("카테고리");
    if (!subject.trim()) list.push("의뢰 제목");
    if (!body.trim()) list.push("의뢰 내용");
    return list;
  }, [selectedCat, subject, body]);

  const canSubmit = !bannedHit && incompleteFields.length === 0;

  return (
    <div className="cr-landing">
      <div className="form-layout">
        <div className="form-main">
          <header className="form-header sec-head left">
            <span className="eyebrow">맞춤의뢰</span>
            <h2>{props.draft?.id ? "의뢰 이어쓰기" : "의뢰 등록하기"}</h2>
            <p>카테고리 → 의뢰 내용 → 조건 설정 → 확인 순서로 작성해 주세요.</p>
          </header>

          <CustomRequestFlowStepper activeStep={1} id="new-request-stepper" variant="flat" />

          <form action={submitCustomRequestNew} className="form-shell">
            {props.draft?.id ? <input type="hidden" name="draftId" value={props.draft.id} /> : null}
            <div className="form-body">
              {props.errorMessage ? <div className="form-alert">{props.errorMessage}</div> : null}

              <div className="form-notices">
                {/* 운영 범위 안내(단순 고지·동의 불요) — 모바일 정보 피로 완화 위해 모바일 숨김, 데스크탑 원문 유지. */}
                <div className="hidden md:block">
                  <CustomRequestPolicyNotice />
                </div>
              </div>

              <FormSection step="1" title="카테고리 선택" hint="필수 · 하나를 선택해 주세요">
                <input type="hidden" name="category" value={selectedCat} required={selectedCat.length > 0} />
                <div
                  className={`form-cat-grid ${showIncomplete && !selectedCat ? "rounded-xl ring-2 ring-red-400 ring-offset-2" : ""}`}
                >
                  {CATEGORIES.map((c) => {
                    const on = selectedCat === c;
                    return (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setSelectedCat(c)}
                        className={`form-cat-chip ${on ? "is-selected" : ""}`}
                      >
                        {c}
                      </button>
                    );
                  })}
                </div>
              </FormSection>

              <FormSection step="2" title="의뢰 내용" hint="제목·본문 필수 (본문 2000자 이내)">
                <label className="form-label">
                  제목
                  <input
                    name="subject"
                    required
                    maxLength={100}
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    className={`form-input mt-2 ${showIncomplete && !subject.trim() ? "is-error" : ""}`}
                    placeholder="한 줄로 요약 (최대 100자)"
                  />
                  {showIncomplete && !subject.trim() ? (
                    <p className="form-error">의뢰 제목을 입력해 주세요.</p>
                  ) : null}
                </label>
                <label className="form-label mt-6 block">
                  의뢰 내용
                  <textarea
                    name="body"
                    required
                    rows={8}
                    maxLength={2000}
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    className={`form-textarea mt-2 ${showIncomplete && !body.trim() ? "is-error" : ""}`}
                    placeholder={BODY_PLACEHOLDER}
                  />
                  {showIncomplete && !body.trim() ? (
                    <p className="form-error">의뢰 내용을 입력해 주세요.</p>
                  ) : null}
                  <span className="form-counter">{body.trim().length}/2000자</span>
                </label>
                {bannedHit ? <p className="form-alert mt-3">{CUSTOM_REQUEST_BANNED_WARNING}</p> : null}
              </FormSection>

              <FormSection step="3" title="조건 설정" hint="마감일·예산·첨부 파일">
                <label className="form-label">
                  참고 파일 첨부 (선택)
                  <span className="form-hint block">
                    PDF/PPT/DOCX/이미지 · 최대 {POST_ATTACHMENT_MAX_FILES}개 · 각 20MB
                  </span>
                  <input
                    type="file"
                    name="postAttachmentFiles"
                    multiple
                    accept="application/pdf,image/png,image/jpeg,image/webp,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.presentationml.presentation"
                    onChange={(e) => {
                      const files = e.target.files;
                      if (!files?.length) {
                        setSelectedFiles([]);
                        return;
                      }
                      setSelectedFiles(Array.from(files).map((f) => ({ name: f.name, size: f.size })));
                    }}
                    className="form-file-input mt-2"
                  />
                  {selectedFiles.length > 0 ? (
                    <ul className="form-file-list">
                      {selectedFiles.map((f) => (
                        <li key={`${f.name}-${f.size}`}>
                          {f.name} ({formatFileSize(f.size)})
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="form-hint mt-2">선택된 파일 없음</p>
                  )}
                </label>

                <label className="form-label mt-6 block">
                  마감일
                  <input name="deadline" type="date" required defaultValue={props.draft?.deadline ?? ""} className="form-input mt-2" />
                </label>

                <div className="mt-6" role="group" aria-labelledby="budget-range-label">
                  <p id="budget-range-label" className="form-label">
                    예산 범위
                  </p>
                  <input type="hidden" name="budgetMin" value={effectiveBudget ?? ""} />
                  <input type="hidden" name="budgetMax" value={effectiveBudget ?? ""} />
                  <div className="form-budget-grid mt-3">
                    {BUDGET_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          setBudgetMode("preset");
                          setPresetBudget(opt.value);
                          setCustomBudgetRaw("");
                        }}
                        className={`form-budget-chip ${budgetMode === "preset" && presetBudget === opt.value ? "is-selected" : ""}`}
                      >
                        {opt.label}
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        activateCustomBudgetMode();
                      }}
                      className={`form-budget-chip ${budgetMode === "custom" ? "is-selected" : ""}`}
                    >
                      직접 입력
                    </button>
                  </div>
                  {budgetMode === "custom" ? (
                    <label className="form-label mt-3 block">
                      희망 예산 (캐시)
                      <input
                        ref={customBudgetInputRef}
                        type="text"
                        inputMode="numeric"
                        autoComplete="off"
                        value={formatBudgetDigits(customBudgetRaw)}
                        onChange={(e) => {
                          setBudgetMode("custom");
                          setCustomBudgetRaw(e.target.value.replace(/\D/g, ""));
                        }}
                        className="form-input mt-2"
                        placeholder={`예: ${(75000).toLocaleString("ko-KR")}`}
                      />
                      <span className="form-hint">
                        {BUDGET_MIN.toLocaleString("ko-KR")}~{BUDGET_MAX.toLocaleString("ko-KR")} 캐시 · 멘토 제안 참고용
                      </span>
                    </label>
                  ) : null}
                </div>
              </FormSection>

              <FormSection step="4" title="확인" hint="동의 후 등록해 주세요">
                <div className="space-y-3">
                  <label className="form-check">
                    <input type="checkbox" name="agreeProhibited" value="on" required />
                    <span>시험 부정·표절·대리·권리 침해를 요청하지 않겠습니다.</span>
                  </label>
                  <label className="form-check">
                    <input type="checkbox" name="agreeNoExternal" value="on" required />
                    <span>의뢰·주문 과정에서 외부로 연락처를 교환하지 않겠습니다.</span>
                  </label>
                </div>
              </FormSection>
            </div>

            <div className="form-actions">
              {showIncomplete && incompleteFields.length > 0 ? (
                <div className="form-alert">
                  <p className="font-extrabold">아래 항목을 완성해 주세요:</p>
                  <ul className="mt-2 list-inside list-disc font-medium">
                    {incompleteFields.map((f) => (
                      <li key={f}>{f}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <div className="form-action-buttons">
                <button type="submit" name="intent" value="draft" formNoValidate className="btn btn-ghost">
                  임시저장
                </button>
                <div
                  className="w-full sm:w-auto"
                  onMouseEnter={() => {
                    if (!canSubmit) setShowIncomplete(true);
                  }}
                >
                  <FormSubmitButton
                    idleLabel="의뢰 등록하기"
                    pendingLabel="등록 중…"
                    name="intent"
                    value="submit"
                    disabled={!canSubmit}
                    onClick={(e) => {
                      if (!canSubmit) {
                        e.preventDefault();
                        setShowIncomplete(true);
                      }
                    }}
                    className="btn btn-primary w-full sm:w-auto disabled:cursor-not-allowed"
                  />
                </div>
              </div>
            </div>
          </form>
        </div>

        <aside className="lg:sticky lg:top-28 lg:self-start">
          <div className="form-tip-card">
            <h4>요청 작성 팁</h4>
            <ul>
              <li>마감·분량·자료를 알려 주면 제안이 정확해져요.</li>
              <li>학년·과목·단원을 구체적으로 적어 주세요.</li>
              <li>대필·완성 대행 표현은 등록이 거절될 수 있어요.</li>
            </ul>
          </div>
        </aside>
      </div>
    </div>
  );
}
