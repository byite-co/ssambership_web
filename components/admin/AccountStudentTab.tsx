/**
 * 계정 상세 — 학생 탭(PR-7 §2-4). 프로필 · 구독 현황 · 캐시 · 질문 사용량 · 신고·분쟁 · 결제 이력 · 처리 이력. 섹션은 접히고 요약 한 줄이 보인다.
 * Server Component — 데이터는 `loadStudentAccountSection` 이 만든다.
 */
import Link from "next/link";
import type { ReactNode } from "react";
import { AccountActionLogList } from "@/components/admin/AccountActionLogList";
import { AdminStatusPill } from "@/components/admin/AdminStatusPill";
import { StatusBadge } from "@/components/design-system/StatusBadge";
import { STUDENT_BIRTH_DATE_MISSING_WARNING, accountDetailPath } from "@/lib/admin/accountDetailConsole";
import type { AccountActionLogs } from "@/lib/admin/accountDetailQueries";
import type { StudentAccountSection, StudentCaseRef } from "@/lib/admin/accountStudentQueries";
import { contentReportDetailPath } from "@/lib/admin/contentReportConsole";
import { disputeDetailPath } from "@/lib/admin/disputeConsole";
import { formatCashKrw, formatKoreanDate, minorUnitsToDisplayCash } from "@/lib/utils/formatDisplay";
import { formatKoDateTimeKst } from "@/lib/utils/kstTime";
import { cn } from "@/lib/utils/cn";

type Props = {
  userId: string;
  section: StudentAccountSection;
  logs: AccountActionLogs;
  logsMoreHref: string | null;
};

function Section(props: { id: string; title: string; summary: ReactNode; tone?: "default" | "warning"; children: ReactNode }) {
  const tone = props.tone ?? "default";
  return (
    <details className={cn("group rounded-2xl border bg-white shadow-sm", tone === "warning" ? "border-amber-300" : "border-slate-200")} data-account-section={props.id}>
      <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2 px-4 py-3 [&::-webkit-details-marker]:hidden">
        <span className="text-sm font-black tracking-tight text-slate-900">{props.title}</span>
        <span className={cn("min-w-0 truncate text-xs font-semibold", tone === "warning" ? "text-amber-800" : "text-slate-600")} data-section-summary>
          {props.summary}
          <span className="ml-2 text-[10px] font-bold text-slate-400 group-open:hidden">펼치기</span>
        </span>
      </summary>
      <div className="border-t border-slate-100 px-4 py-4 text-sm text-slate-800">{props.children}</div>
    </details>
  );
}

function Row(props: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-slate-100 py-1.5 text-xs last:border-b-0">
      <dt className="shrink-0 font-bold text-slate-500">{props.label}</dt>
      <dd className="min-w-0 text-right font-semibold text-slate-900">{props.children}</dd>
    </div>
  );
}

function CaseList(props: { title: string; count: number | null; recent: StudentCaseRef[]; hrefOf: (id: string) => string; table: string }) {
  return (
    <div>
      <p className="text-xs font-black text-slate-700">
        {props.title} <span className="tabular-nums text-slate-900">{props.count == null ? "확인 불가" : `${props.count}건`}</span>
      </p>
      {props.recent.length ? (
        <ul className="mt-1 divide-y divide-slate-100">
          {props.recent.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-2 py-1.5 text-xs">
              <Link href={props.hrefOf(c.id)} className="min-w-0 truncate font-bold text-blue-700 hover:underline" prefetch={false}>
                {formatKoreanDate(c.createdAt)} · {c.label}
              </Link>
              <AdminStatusPill table={props.table} column="status" value={c.status} size="sm" className="shrink-0" />
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-xs text-slate-500">없음</p>
      )}
    </div>
  );
}

export function AccountStudentTab({ userId, section, logs, logsMoreHref }: Props) {
  const { profile, subscriptions, cash, usage, cases, payments } = section;
  const activeCount = subscriptions.rows.filter((s) => s.status === "active").length;
  const caseTotal = [cases.reportedBy.count, cases.reportedAgainst.count, cases.disputes.count].reduce<number>((sum, n) => sum + (n ?? 0), 0);

  return (
    <div className="space-y-3" data-account-student-tab={userId}>
      <Section
        id="profile"
        title="프로필"
        summary={profile.warnings.length ? profile.warnings.join(" · ") : `${profile.gradeLevel ?? "학년 미입력"} · ${profile.studentStatus ?? "재학 상태 미입력"}`}
        tone={profile.warnings.length ? "warning" : "default"}
      >
        <dl>
          <Row label="닉네임">{profile.nickname ?? "—"}</Row>
          <Row label="학년(grade_level)">{profile.gradeLevel ?? "—"}</Row>
          <Row label="재학 상태(student_status)">{profile.studentStatus ?? "—"}</Row>
          <Row label="생년월일">
            {profile.birthDate ? formatKoreanDate(profile.birthDate) : <span className="font-bold text-amber-700" data-birth-date-missing>{STUDENT_BIRTH_DATE_MISSING_WARNING}</span>}
          </Row>
        </dl>
      </Section>

      <Section id="subscriptions" title="구독 현황" summary={subscriptions.error ?? `활성 ${activeCount}건 · 전체 ${subscriptions.rows.length}건`}>
        {subscriptions.error ? (
          <p className="text-xs font-bold text-amber-900">{subscriptions.error}</p>
        ) : subscriptions.rows.length ? (
          <ul className="divide-y divide-slate-100" data-student-subscriptions>
            {subscriptions.rows.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-xs">
                <span className="min-w-0">
                  <Link href={accountDetailPath(s.mentorId)} className="font-extrabold text-slate-900 hover:underline" prefetch={false}>
                    {s.mentorName}
                  </Link>
                  <span className="ml-2 text-slate-600">{s.planLabel}</span>
                </span>
                <span className="flex items-center gap-2 text-slate-600">
                  <span className="tabular-nums">{s.cancelAtPeriodEnd ? "갱신 중단 예정" : `갱신 ${formatKoreanDate(s.renewalAt)}`}</span>
                  <AdminStatusPill table="subscriptions" column="status" value={s.status} size="sm" />
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-slate-600">구독 이력이 없습니다.</p>
        )}
      </Section>

      <Section id="cash" title="캐시" summary={cash.walletError ?? `잔액 ${cash.balanceCashKrw == null ? "—" : formatCashKrw(cash.balanceCashKrw)}${cash.pendingInvoices.length ? ` · 무통장 대기 ${cash.pendingInvoices.length}건` : ""}`}>
        <dl>
          <Row label="잔액(cash_wallets)">{cash.walletError ?? (cash.balanceCashKrw == null ? "—" : formatCashKrw(cash.balanceCashKrw))}</Row>
        </dl>
        {cash.invoicesError ? <p className="mt-2 text-xs font-bold text-amber-900">{cash.invoicesError}</p> : null}
        {cash.pendingInvoices.length ? (
          <ul className="mt-2 space-y-1" data-student-pending-invoices>
            {cash.pendingInvoices.map((inv) => (
              <li key={inv.id} className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900">
                무통장 대기 · {inv.payKrw.toLocaleString("ko-KR")}원 → {inv.cashKrw.toLocaleString("ko-KR")}캐시 · 입금자 {inv.depositorName} · 발급 {formatKoreanDate(inv.issuedAt)}
                {inv.expiresAt ? ` · 마감 ${formatKoreanDate(inv.expiresAt)}` : ""}
              </li>
            ))}
          </ul>
        ) : null}
        <p className="mt-3 text-[11px] font-black text-slate-500">원장 최근 {cash.ledger.length}건</p>
        {cash.ledgerError ? (
          <p className="text-xs font-bold text-amber-900">{cash.ledgerError}</p>
        ) : cash.ledger.length ? (
          <ul className="divide-y divide-slate-100" data-student-ledger>
            {cash.ledger.map((l) => (
              <li key={l.id} className="flex items-center justify-between gap-3 py-1.5 text-xs">
                <span className="shrink-0 tabular-nums text-slate-500">{formatKoDateTimeKst(l.createdAt)}</span>
                <span className="min-w-0 flex-1 truncate text-slate-800">
                  <StatusBadge label={l.kindLabel} tone={l.kind === "charge" ? "success" : l.kind === "refund" ? "info" : l.kind === "bonus" ? "warning" : "neutral"} size="sm" className="mr-1" />
                  {l.reasonLabel}
                </span>
                <span className={cn("shrink-0 font-extrabold tabular-nums", l.deltaCents < 0 ? "text-slate-900" : "text-emerald-700")}>
                  {l.deltaCents < 0 ? "-" : "+"}
                  {formatCashKrw(minorUnitsToDisplayCash(l.deltaCents))}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-slate-600">원장 이력이 없습니다.</p>
        )}
      </Section>

      <Section
        id="usage"
        title="질문 사용량"
        summary={`구독 ${usage.rows.length}건 · 무료 질문권 잔여 ${usage.free.remaining == null ? "—" : `${usage.free.remaining}/${usage.free.total}`}`}
      >
        {usage.rows.length ? (
          <ul className="divide-y divide-slate-100" data-student-usage>
            {usage.rows.map((u) => (
              <li key={u.mentorId} className="flex items-center justify-between gap-3 py-1.5 text-xs">
                <span className="font-bold text-slate-900">{u.mentorName}</span>
                {u.usage ? (
                  <span className="tabular-nums text-slate-700">
                    이번 주 {u.usage.used} / {u.usage.limit >= 999 ? "무제한" : u.usage.limit} · 잔여 {u.usage.limit >= 999 ? "무제한" : u.usage.remaining}
                    {u.usage.weekEnd ? ` · 초기화 ${formatKoreanDate(u.usage.weekEnd)}` : ""}
                  </span>
                ) : (
                  <span className="font-bold text-amber-800">{u.error ?? "—"}</span>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-slate-600">활성 구독이 없어 주간 사용량이 없습니다.</p>
        )}
        <dl className="mt-3" data-student-free-usage>
          <Row label="무료 질문권">
            {usage.free.error
              ? usage.free.error
              : usage.free.expired
                ? `만료(가입 ${usage.free.expiryDays}일 경과) · 사용 ${usage.free.used}/${usage.free.total}`
                : `잔여 ${usage.free.remaining} / ${usage.free.total} · 사용 ${usage.free.used}`}
          </Row>
        </dl>
      </Section>

      <Section id="cases" title="신고·분쟁" summary={cases.error ?? `총 ${caseTotal}건`} tone={cases.error ? "warning" : "default"}>
        {cases.error ? <p className="mb-2 text-xs font-bold text-amber-900">{cases.error}</p> : null}
        <div className="grid gap-4 md:grid-cols-3">
          <CaseList title="신고한 건" count={cases.reportedBy.count} recent={cases.reportedBy.recent} hrefOf={contentReportDetailPath} table="content_reports" />
          <CaseList title="신고당한 건" count={cases.reportedAgainst.count} recent={cases.reportedAgainst.recent} hrefOf={contentReportDetailPath} table="content_reports" />
          <CaseList title="분쟁 당사자" count={cases.disputes.count} recent={cases.disputes.recent} hrefOf={disputeDetailPath} table="disputes" />
        </div>
      </Section>

      <Section id="payments" title="결제 이력" summary={payments.error ?? `최근 ${payments.rows.length}건`}>
        {payments.error ? (
          <p className="text-xs font-bold text-amber-900">{payments.error}</p>
        ) : payments.rows.length ? (
          <ul className="divide-y divide-slate-100" data-student-payments>
            {payments.rows.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 py-1.5 text-xs">
                <span className="shrink-0 tabular-nums text-slate-500">{formatKoDateTimeKst(p.createdAt)}</span>
                <span className="min-w-0 flex-1 truncate text-slate-800">
                  {p.kind ?? "결제"}
                  {p.method ? ` · ${p.method}` : ""}
                </span>
                <span className="shrink-0 font-extrabold tabular-nums text-slate-900">{p.amount == null ? "—" : formatCashKrw(p.amount, { unit: "원" })}</span>
                <AdminStatusPill table="payments" column="status" value={p.status} size="sm" className="shrink-0" />
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-slate-600">결제 이력이 없습니다.</p>
        )}
      </Section>

      <Section id="logs" title="처리 이력" summary={logs.error ? logs.error : `${logs.rows.length}건${logs.totalCount != null && logs.totalCount > logs.rows.length ? ` / 전체 ${logs.totalCount}건` : ""}`}>
        <AccountActionLogList logs={logs} mode="target" moreHref={logsMoreHref} />
      </Section>
    </div>
  );
}
