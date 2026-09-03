/**
 * 등급 분류 화면(PR-11 §3 · PR-W1 정정 · PR-W2)의 섹션 부품 — 미분류 멘토 목록(맨 위 · 행별 `등급 정정` 폼) · 등급별 분포 · 판정 규칙(DB 트리거의 LIKE 패턴 표 ·
 * 폴백 그외 · 대학명 없음 미분류 — SQL 193) · 카탈로그(읽기 전용) · 캠퍼스 표기 멘토. 전부 Server Component.
 * 학교명 매핑 표 섹션은 DB-2 SQL 195(테이블 DROP)에 맞춰 PR-W2 에서 내렸다.
 * 유일한 폼은 미분류 행의 등급 정정이며 기존 확정 RPC 액션(`approveMentorSchoolVerificationAction`)을 그대로 쓴다(새 쓰기 경로 0 · stateChange).
 * 그 밖의 편집 폼은 없다(§0-B 실측에 따라 판정에 영향 없는 편집을 내놓지 않는다).
 */
import Link from "next/link";
import { AdminStatusPill } from "@/components/admin/AdminStatusPill";
import { ConfirmSubmitButton } from "@/components/admin/ConfirmSubmitButton";
import { StatusBadge } from "@/components/design-system/StatusBadge";
import { EmptyState } from "@/components/common/EmptyState";
import { approveMentorSchoolVerificationAction } from "@/lib/admin/mentorSchoolVerificationReviewActions";
import type { BranchCampusMentorItem } from "@/lib/admin/schoolClassificationQueries";
import {
  BRANCH_CAMPUS_HINT_LABELS,
  BRANCH_CAMPUS_NOTE,
  MAJOR_CATEGORY_LIKE_FALLBACK,
  MAJOR_CATEGORY_LIKE_RULES,
  MAJOR_CATEGORY_VALUES,
  SCHOOL_CATALOG_FIXED_NOTICE,
  SCHOOL_RULE_HARDCODED_NOTICE,
  SCHOOL_RULE_SOURCE,
  SCHOOL_TIER_CORRECTION_BUTTON_LABEL,
  SCHOOL_TIER_CORRECTION_DETAIL,
  SCHOOL_TIER_CORRECTION_DIALOG_TITLE,
  SCHOOL_TIER_CORRECTION_FORM_FIELDS,
  SCHOOL_TIER_CORRECTION_NOTE,
  SCHOOL_TIER_CORRECTION_PENDING_LABEL,
  SCHOOL_TIER_CORRECTION_TARGET,
  SCHOOL_TIER_CORRECTION_UNAVAILABLE_LABEL,
  SCHOOL_TIER_LIKE_BLANK_RESULT,
  SCHOOL_TIER_LIKE_FALLBACK,
  SCHOOL_TIER_LIKE_RULES,
  SCHOOL_TIER_VALUES,
  SCHOOL_UNCLASSIFIED_EMPTY_STATE,
  SCHOOL_VERIFICATION_TABLE,
  branchCampusHint,
  buildSchoolTierCorrectionSummary,
  formatSchoolTierDistribution,
  schoolTierCorrectionFormValues,
  unclassifiedMentorAccountUrl,
  type SchoolTierDistributionRow,
  type UnclassifiedMentorItem,
} from "@/lib/admin/schoolClassificationConsole";
import type { ClassificationOption } from "@/lib/mentor/schoolClassificationCatalog";
import { formatKoreanDate } from "@/lib/utils/formatDisplay";
import { cn } from "@/lib/utils/cn";

const CARD = "rounded-2xl border border-slate-200 bg-white p-5 shadow-sm";
const TH = "px-3 py-2 text-left text-[11px] font-black uppercase tracking-wide text-slate-500";
const TD = "px-3 py-2 align-top text-xs text-slate-800";

function SectionHeader({ title, count, hint }: { title: string; count?: number; hint?: string }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="text-base font-black text-slate-900">{title}</h2>
        {hint ? <p className="mt-1 text-xs font-medium leading-relaxed text-slate-500">{hint}</p> : null}
      </div>
      {typeof count === "number" ? <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-bold text-[#2563EB]">{count.toLocaleString("ko-KR")}건</span> : null}
    </div>
  );
}

/** 미분류 멘토 목록 — 맨 위. 행별 `등급 정정` 폼(PR-W1) = 기존 확정 RPC 액션 · stateChange · 등급 '그외'(새 폴백). 다른 등급은 계정 상세에서. */
export function SchoolClassificationUnclassifiedTable({ items }: { items: UnclassifiedMentorItem[] }) {
  return (
    <section className={CARD} data-school-unclassified>
      <SectionHeader title="미분류 멘토" count={items.length} hint="확정 등급이 '미분류' 인 멘토입니다. 대학명은 멘토가 입력한 값 그대로입니다." />
      <p className="mt-3 rounded-xl border border-blue-100 bg-blue-50/60 px-3 py-2 text-xs font-bold text-slate-800" data-school-correction-note>
        {SCHOOL_TIER_CORRECTION_NOTE} — {SCHOOL_TIER_CORRECTION_DETAIL}
      </p>
      {items.length === 0 ? (
        <div className="mt-4">
          <EmptyState title={SCHOOL_UNCLASSIFIED_EMPTY_STATE.title} description={SCHOOL_UNCLASSIFIED_EMPTY_STATE.description} />
        </div>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm">
            <thead className="bg-slate-50/60">
              <tr>
                <th className={TH}>멘토</th>
                <th className={TH}>대학명(입력값)</th>
                <th className={TH}>학과</th>
                <th className={TH}>확정자</th>
                <th className={TH}>확정일</th>
                <th className={TH}>정정</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => {
                const values = schoolTierCorrectionFormValues(it);
                return (
                  <tr key={it.verificationId} className="border-t border-slate-100 hover:bg-slate-50/60" data-school-unclassified-row={it.mentorId}>
                    <td className={cn(TD, "font-extrabold text-slate-900")}>
                      <Link href={unclassifiedMentorAccountUrl(it.mentorId)} className="hover:underline" prefetch={false} title="계정 상세(멘토 탭)">
                        {it.name}
                      </Link>
                    </td>
                    <td className={TD}>{it.universityName}</td>
                    <td className={TD}>{it.departmentName}</td>
                    <td className={TD}>{it.confirmed ? (it.reviewerName ?? "관리자") : <StatusBadge label="자동 판정 · 미확정" tone="warning" size="sm" />}</td>
                    <td className={cn(TD, "whitespace-nowrap tabular-nums")}>{formatKoreanDate(it.reviewedAt)}</td>
                    <td className={cn(TD, "whitespace-nowrap")}>
                      {values ? (
                        <form action={approveMentorSchoolVerificationAction} className="inline" data-school-correction-form={it.verificationId}>
                          <input type="hidden" name={SCHOOL_TIER_CORRECTION_FORM_FIELDS.verificationId} value={values.verificationId} />
                          <input type="hidden" name={SCHOOL_TIER_CORRECTION_FORM_FIELDS.verifiedUniversityName} value={values.verifiedUniversityName} />
                          <input type="hidden" name={SCHOOL_TIER_CORRECTION_FORM_FIELDS.verifiedUniversityId} value={values.verifiedUniversityId} />
                          <input type="hidden" name={SCHOOL_TIER_CORRECTION_FORM_FIELDS.verifiedDepartmentName} value={values.verifiedDepartmentName} />
                          <input type="hidden" name={SCHOOL_TIER_CORRECTION_FORM_FIELDS.verifiedMajorCategory} value={values.verifiedMajorCategory} />
                          <input type="hidden" name={SCHOOL_TIER_CORRECTION_FORM_FIELDS.schoolTier} value={values.schoolTier} />
                          <ConfirmSubmitButton
                            level="stateChange"
                            summary={buildSchoolTierCorrectionSummary(it.name, it.tier)}
                            details={[
                              { label: "대상", value: `${it.name} · ${it.universityName}` },
                              { label: "등급", value: `${it.tier} → ${SCHOOL_TIER_CORRECTION_TARGET}` },
                            ]}
                            dialogTitle={SCHOOL_TIER_CORRECTION_DIALOG_TITLE}
                            confirmLabel={SCHOOL_TIER_CORRECTION_BUTTON_LABEL}
                            pendingLabel={SCHOOL_TIER_CORRECTION_PENDING_LABEL}
                            className="h-8 rounded-lg bg-slate-900 px-3 text-[11px] font-extrabold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
                          >
                            {SCHOOL_TIER_CORRECTION_BUTTON_LABEL}
                          </ConfirmSubmitButton>
                        </form>
                      ) : (
                        <span className="text-[11px] font-bold text-slate-500" data-school-correction-unavailable>
                          {SCHOOL_TIER_CORRECTION_UNAVAILABLE_LABEL}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export function SchoolClassificationDistribution({ rows, approvedCount }: { rows: SchoolTierDistributionRow[]; approvedCount: number }) {
  return (
    <section className={CARD} data-school-distribution>
      <SectionHeader title="등급별 분포" count={approvedCount} hint="확정 승인 행(approved · 멘토당 1행) 기준입니다." />
      <p className="mt-3 text-sm font-bold text-slate-800">{formatSchoolTierDistribution(rows)}</p>
      <ul className="mt-3 grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {rows.map((r) => (
          <li key={r.tier} className="rounded-xl border border-slate-100 bg-slate-50/70 px-3 py-2" data-school-tier={r.tier}>
            <AdminStatusPill table={SCHOOL_VERIFICATION_TABLE} column="school_tier" value={r.tier} size="sm" />
            <p className="mt-1 text-lg font-black tabular-nums text-slate-900">{r.count}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** 판정 규칙 — §0-B-1: 트리거가 매핑 표가 아니라 하드코딩 LIKE 를 쓴다. 그 패턴을 그대로 보여준다. */
export function SchoolClassificationRulesTable() {
  return (
    <section className={CARD} data-school-rules>
      <SectionHeader
        title="판정 규칙(DB 트리거)"
        hint={`${SCHOOL_RULE_SOURCE.trigger} → ${SCHOOL_RULE_SOURCE.tierFunction}() — ${SCHOOL_RULE_SOURCE.tierMigration} · ${SCHOOL_RULE_SOURCE.majorFunction}() — ${SCHOOL_RULE_SOURCE.migration}`}
      />
      <p className="mt-3 rounded-xl border border-blue-100 bg-blue-50/60 px-3 py-2 text-xs font-bold text-slate-800" data-school-rules-notice>
        {SCHOOL_RULE_HARDCODED_NOTICE}
      </p>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div>
          <h3 className="text-xs font-black text-slate-700">학교 등급 — 대학명 접두 LIKE</h3>
          <table className="mt-2 w-full text-sm">
            <thead className="bg-slate-50/60">
              <tr>
                <th className={TH}>패턴</th>
                <th className={TH}>등급</th>
              </tr>
            </thead>
            <tbody>
              {SCHOOL_TIER_LIKE_RULES.map((r) => (
                <tr key={r.pattern} className="border-t border-slate-100">
                  <td className={cn(TD, "font-mono")}>{r.pattern}</td>
                  <td className={TD}>
                    <AdminStatusPill table={SCHOOL_VERIFICATION_TABLE} column="school_tier" value={r.result} size="sm" />
                  </td>
                </tr>
              ))}
              <tr className="border-t border-slate-100" data-school-rule-blank>
                <td className={cn(TD, "text-slate-500")}>대학명 없음(NULL · 공백)</td>
                <td className={TD}>
                  <AdminStatusPill table={SCHOOL_VERIFICATION_TABLE} column="school_tier" value={SCHOOL_TIER_LIKE_BLANK_RESULT} size="sm" />
                </td>
              </tr>
              <tr className="border-t border-slate-100" data-school-rule-fallback>
                <td className={cn(TD, "text-slate-500")}>그 외</td>
                <td className={TD}>
                  <AdminStatusPill table={SCHOOL_VERIFICATION_TABLE} column="school_tier" value={SCHOOL_TIER_LIKE_FALLBACK} size="sm" />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div>
          <h3 className="text-xs font-black text-slate-700">전공 계열 — 학과명 포함 LIKE</h3>
          <table className="mt-2 w-full text-sm">
            <thead className="bg-slate-50/60">
              <tr>
                <th className={TH}>패턴</th>
                <th className={TH}>계열</th>
              </tr>
            </thead>
            <tbody>
              {MAJOR_CATEGORY_LIKE_RULES.map((r) => (
                <tr key={r.pattern} className="border-t border-slate-100">
                  <td className={cn(TD, "font-mono")}>{r.pattern}</td>
                  <td className={TD}>
                    <AdminStatusPill table={SCHOOL_VERIFICATION_TABLE} column="verified_major_category" value={r.result} size="sm" />
                  </td>
                </tr>
              ))}
              <tr className="border-t border-slate-100">
                <td className={cn(TD, "text-slate-500")}>그 외</td>
                <td className={TD}>
                  <AdminStatusPill table={SCHOOL_VERIFICATION_TABLE} column="verified_major_category" value={MAJOR_CATEGORY_LIKE_FALLBACK} size="sm" />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function CatalogList({ title, values, column, options }: { title: string; values: readonly string[]; column: "school_tier" | "verified_major_category"; options: ClassificationOption[] }) {
  return (
    <div>
      <h3 className="text-xs font-black text-slate-700">{title}</h3>
      <ul className="mt-2 flex flex-wrap gap-2">
        {values.map((code) => {
          const opt = options.find((o) => o.code === code);
          return (
            <li key={code} className="flex items-center gap-1.5 rounded-xl border border-slate-100 bg-slate-50/70 px-2.5 py-1.5" data-catalog-code={code}>
              <AdminStatusPill table={SCHOOL_VERIFICATION_TABLE} column={column} value={code} size="sm" />
              {opt && opt.label !== code ? <span className="text-[11px] text-slate-500">표시 라벨 {opt.label}</span> : null}
              {opt && !opt.isActive ? <StatusBadge label="비활성" tone="neutral" size="sm" /> : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** 카탈로그 — 값 집합은 상태 사전(= DB CHECK). 편집 없음. catalog 표의 라벨·활성은 참고로만. */
export function SchoolClassificationCatalog({ schoolTiers, majorCategories }: { schoolTiers: ClassificationOption[]; majorCategories: ClassificationOption[] }) {
  return (
    <section className={CARD} data-school-catalog>
      <SectionHeader title="카탈로그" hint={`ⓘ ${SCHOOL_CATALOG_FIXED_NOTICE} 새 값 추가·변경은 DB 작업입니다.`} />
      <div className="mt-4 space-y-4">
        <CatalogList title={`학교 등급 (${SCHOOL_TIER_VALUES.length})`} values={SCHOOL_TIER_VALUES} column="school_tier" options={schoolTiers} />
        <CatalogList title={`전공 계열 (${MAJOR_CATEGORY_VALUES.length})`} values={MAJOR_CATEGORY_VALUES} column="verified_major_category" options={majorCategories} />
      </div>
    </section>
  );
}

/** 캠퍼스·분교 표기 멘토(§3-2) — 접두 LIKE 가 분교를 구분하지 못한다는 사실을 보이는 참고 목록. 규칙 수정은 DB. */
export function SchoolClassificationBranchCampusList({ items }: { items: BranchCampusMentorItem[] }) {
  return (
    <section className={CARD} data-school-branch-campus>
      <SectionHeader title="캠퍼스 표기 멘토(분교 확인)" count={items.length} hint={BRANCH_CAMPUS_NOTE} />
      {items.length === 0 ? (
        <p className="mt-3 text-sm font-semibold text-slate-500">캠퍼스·분교 표기가 있는 확정 멘토가 없습니다.</p>
      ) : (
        <ul className="mt-3 divide-y divide-slate-100 text-sm">
          {items.map((it) => {
            const hint = branchCampusHint(it.universityName);
            return (
              <li key={`${it.mentorId}-${it.universityName}`} className="flex flex-wrap items-center justify-between gap-2 py-2" data-branch-hint={hint}>
                <span className="min-w-0 truncate">
                  <Link href={unclassifiedMentorAccountUrl(it.mentorId)} className="font-bold text-slate-900 hover:underline" prefetch={false}>
                    {it.name}
                  </Link>
                  <span className="ml-2 text-slate-600">{it.universityName}</span>
                </span>
                <span className="flex shrink-0 items-center gap-1.5">
                  <AdminStatusPill table={SCHOOL_VERIFICATION_TABLE} column="school_tier" value={it.tier} size="sm" />
                  <StatusBadge label={BRANCH_CAMPUS_HINT_LABELS[hint]} tone={hint === "main" ? "neutral" : "warning"} size="sm" />
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
