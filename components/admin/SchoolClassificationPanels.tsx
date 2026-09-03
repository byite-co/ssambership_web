/**
 * 등급 분류 화면(PR-11 §3)의 섹션 부품 — 미분류 멘토 목록(맨 위) · 등급별 분포 · 판정 규칙(DB 트리거의 LIKE 패턴 표) · 카탈로그(읽기 전용) ·
 * 학교명 매핑(읽기 전용) · 캠퍼스 표기 멘토. 전부 Server Component · 폼 없음(편집 액션 0 — §0-B 실측에 따라 화면이 판정에 영향 없는 편집을 내놓지 않는다).
 */
import Link from "next/link";
import { AdminStatusPill } from "@/components/admin/AdminStatusPill";
import { StatusBadge } from "@/components/design-system/StatusBadge";
import { EmptyState } from "@/components/common/EmptyState";
import type { BranchCampusMentorItem } from "@/lib/admin/schoolClassificationQueries";
import {
  BRANCH_CAMPUS_HINT_LABELS,
  BRANCH_CAMPUS_NOTE,
  MAJOR_CATEGORY_LIKE_FALLBACK,
  MAJOR_CATEGORY_LIKE_RULES,
  MAJOR_CATEGORY_VALUES,
  SCHOOL_CATALOG_FIXED_NOTICE,
  SCHOOL_MAPPING_EMPTY_LABEL,
  SCHOOL_MAPPING_READONLY_NOTE,
  SCHOOL_RULE_HARDCODED_NOTICE,
  SCHOOL_RULE_SOURCE,
  SCHOOL_TIER_CORRECTION_DETAIL,
  SCHOOL_TIER_CORRECTION_PENDING_NOTE,
  SCHOOL_TIER_LIKE_FALLBACK,
  SCHOOL_TIER_LIKE_RULES,
  SCHOOL_TIER_VALUES,
  SCHOOL_UNCLASSIFIED_EMPTY_STATE,
  SCHOOL_VERIFICATION_TABLE,
  branchCampusHint,
  formatSchoolTierDistribution,
  unclassifiedMentorAccountUrl,
  type SchoolTierDistributionRow,
  type UnclassifiedMentorItem,
} from "@/lib/admin/schoolClassificationConsole";
import type { ClassificationOption, SchoolTierMappingRow } from "@/lib/mentor/schoolClassificationCatalog";
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

/** 미분류 멘토 목록 — 맨 위. 정정 버튼 없음(§0-B-2 · 경로 없음) → `등급 정정은 DB-2 후 가능` 표시 + 계정 상세 링크. */
export function SchoolClassificationUnclassifiedTable({ items }: { items: UnclassifiedMentorItem[] }) {
  return (
    <section className={CARD} data-school-unclassified>
      <SectionHeader title="미분류 멘토" count={items.length} hint="확정 등급이 '미분류' 인 멘토입니다. 대학명은 멘토가 입력한 값 그대로입니다." />
      <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-900" data-school-correction-note>
        {SCHOOL_TIER_CORRECTION_PENDING_NOTE} — {SCHOOL_TIER_CORRECTION_DETAIL}
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
              {items.map((it) => (
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
                  <td className={cn(TD, "whitespace-nowrap text-[11px] font-bold text-slate-500")}>{SCHOOL_TIER_CORRECTION_PENDING_NOTE}</td>
                </tr>
              ))}
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
        hint={`${SCHOOL_RULE_SOURCE.trigger} → ${SCHOOL_RULE_SOURCE.tierFunction}() · ${SCHOOL_RULE_SOURCE.majorFunction}() — ${SCHOOL_RULE_SOURCE.migration}`}
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
              <tr className="border-t border-slate-100">
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

/** 학교명 → 학교군 매핑 — 읽기 전용(§8-3: 판정에 영향 없는 편집을 가능해 보이게 하지 않는다). */
export function SchoolClassificationMappingTable({ rows, error }: { rows: SchoolTierMappingRow[]; error: string | null }) {
  return (
    <section className={CARD} data-school-mappings>
      <SectionHeader title="학교명 → 학교군 매핑(읽기 전용)" count={rows.length} hint={SCHOOL_MAPPING_READONLY_NOTE} />
      {error ? <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-900">매핑 표를 불러오지 못했습니다.</p> : null}
      {rows.length === 0 ? (
        <p className="mt-3 rounded-xl border border-dashed border-slate-200 py-6 text-center text-sm font-semibold text-slate-500">{SCHOOL_MAPPING_EMPTY_LABEL}</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-slate-50/60">
              <tr>
                <th className={TH}>학교명</th>
                <th className={TH}>학교군</th>
                <th className={TH}>메모</th>
                <th className={TH}>활성</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => (
                <tr key={m.id} className="border-t border-slate-100">
                  <td className={TD}>{m.school_name}</td>
                  <td className={TD}>
                    <AdminStatusPill table={SCHOOL_VERIFICATION_TABLE} column="school_tier" value={m.school_tier_code} size="sm" />
                  </td>
                  <td className={TD}>{m.note ?? "—"}</td>
                  <td className={TD}>{m.is_active ? "활성" : "비활성"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
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
