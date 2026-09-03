// 계약 테스트: 관리자 대시보드(PR-12 §1) — "오늘 할 일" 8칸 · 현황 · 최근 활동.
// 실행: node --test --experimental-strip-types lib/admin/__contract__/adminDashboardConsole.contract.test.ts
//
// 고정하는 것(지시서 §5 · §6):
//   ① 8칸 건수가 각 화면 모듈 건수 함수의 값과 일치(입력 → 칸 매핑을 모킹 값으로 고정) · 조회 모듈은 그 함수를 호출하고 건수 로직을 재작성하지 않는다
//   ② 0 일 때 회색(숫자만 · `없음` 없음) · 1 이상 굵게 + 주의색
//   ③ 링크 목적지 8개(그 화면의 실제 키 — 멘토 활동은 `status`) · 각 목적지 라우트가 실제로 있다
//   ④ 일정 섹션 없음 · 오링크 없음(신규 가입 → 감사 로그, 캐시 거래액 → 환불) · 장식 차트 없음 · 구 대시보드 파일 삭제
//   ⑤ 최근 활동: 감사 로그 화면 조회 재사용 · 열람 기록 제외 기본 켜짐 · 행 → 대상
//   ⑥ 현황: 계좌 미등록 멘토(정산 RPC 판정 규칙) → 계정 목록 멘토 탭 · 조회 실패는 `—`

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ADMIN_DASHBOARD_ACTIVITY_LIMIT,
  ADMIN_DASHBOARD_PATH,
  ADMIN_DASHBOARD_SHOW_VIEWS_PARAM,
  ADMIN_STATUS_KEYS,
  ADMIN_STATUS_LINKS,
  ADMIN_TODO_DEFINITIONS,
  ADMIN_TODO_KEYS,
  adminDashboardActivityFilters,
  adminTodoCardClass,
  adminTodoCount,
  adminTodoCountClass,
  adminTodoTone,
  buildAdminDashboardUrl,
  buildAdminStatusItems,
  buildAdminTodoCards,
  formatAdminStatusCount,
  kstWeekStartIso,
  payoutAccountRegisteredForSettlement,
  resolveAdminDashboardShowViews,
  type AdminTodoCountsInput,
} from "../adminDashboardConsole.ts";
import { MENTOR_ACTIVITY_TAB_VALUES, resolveMentorActivityTab } from "../mentorActivityConsole.ts";
import { MENTOR_APPROVAL_TAB_VALUES } from "../mentorApprovalQueue.ts";
import { CONTENT_REPORT_TAB_VALUES } from "../contentReportConsole.ts";
import { REFUND_TAB_VALUES } from "../refundConsole.ts";
import { DISPUTE_TAB_VALUES } from "../disputeConsole.ts";
import { TOPUP_TAB_VALUES } from "../topupConsole.ts";
import { AUDIT_LOG_EMPTY_STATE } from "../auditLogConsole.ts";

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const PAGE = "app/(admin)/admin/(console)/dashboard/page.tsx";
const LOADING = "app/(admin)/admin/(console)/dashboard/loading.tsx";
const QUERIES = "lib/admin/adminDashboardQueries.ts";
const CONSOLE = "lib/admin/adminDashboardConsole.ts";
const TODO_GRID = "components/admin/AdminDashboardTodoGrid.tsx";
const STATUS_BAR = "components/admin/AdminDashboardStatusBar.tsx";
const ACTIVITY = "components/admin/AdminDashboardActivity.tsx";
const ACTIVITY_TOGGLE = "components/admin/AdminDashboardActivityToggle.tsx";
const DASHBOARD_FILES = [PAGE, LOADING, QUERIES, CONSOLE, TODO_GRID, STATUS_BAR, ACTIVITY, ACTIVITY_TOGGLE];

/** 각 화면 모듈의 건수 함수가 돌려주는 값(모킹) — 대시보드는 이 값을 그대로 보여야 한다 */
const MOCK: AdminTodoCountsInput = {
  mentorApproval: { pending: 1 },
  schoolTierUnconfirmed: 0,
  mentorActivity: { unansweredTotal: 5, counts: { abandoned: 2 } },
  contentReport: { pending: 3 },
  refund: { pending: 4 },
  dispute: { open: 6, under_review: 7 },
  topup: { pending: 8 },
  accountDeletion: { stalled: 2 },
};

// ── ① 8칸 = 각 모듈 건수 ─────────────────────────────────────────────────────

test("9칸 순서·키: 승인 대기 · 미확정 등급 · 미답변 질문 · 미처리 신고 / 환불 요청 · 분쟁 · 충전 대기 · 이탈 의심 / 탈퇴 멈춤(PR-13)", () => {
  assert.deepEqual([...ADMIN_TODO_KEYS], ["mentor_approval", "school_tier_unconfirmed", "unanswered_questions", "content_reports", "refunds", "disputes", "topups", "abandonment", "deletion_stalled"]);
  assert.deepEqual(
    ADMIN_TODO_DEFINITIONS.map((d) => d.label),
    ["승인 대기", "미확정 등급", "미답변 질문", "미처리 신고", "환불 요청", "분쟁", "충전 대기", "이탈 의심", "탈퇴 멈춤"]
  );
  assert.deepEqual(ADMIN_TODO_DEFINITIONS.map((d) => d.key), [...ADMIN_TODO_KEYS]);
});

test("건수 일치 ★: 9칸 숫자 = 각 화면 모듈 함수 값(모킹) — 승인 pending · 신고 pending · 환불 pending · 분쟁 open+under_review · 충전 pending · 미답변 합 · 이탈 abandoned · 미확정 등급 · 탈퇴 멈춤", () => {
  const cards = buildAdminTodoCards(MOCK);
  const byKey = Object.fromEntries(cards.map((c) => [c.key, c.count]));
  assert.equal(byKey.mentor_approval, MOCK.mentorApproval.pending);
  assert.equal(byKey.school_tier_unconfirmed, MOCK.schoolTierUnconfirmed);
  assert.equal(byKey.unanswered_questions, MOCK.mentorActivity.unansweredTotal);
  assert.equal(byKey.content_reports, MOCK.contentReport.pending);
  assert.equal(byKey.refunds, MOCK.refund.pending);
  assert.equal(byKey.disputes, MOCK.dispute.open + MOCK.dispute.under_review);
  assert.equal(byKey.topups, MOCK.topup.pending);
  assert.equal(byKey.abandonment, MOCK.mentorActivity.counts.abandoned);
  assert.equal(byKey.deletion_stalled, MOCK.accountDeletion.stalled);
  assert.deepEqual(cards.map((c) => c.count), [1, 0, 5, 3, 4, 13, 8, 2, 2]);
  // 음수·NaN 은 0 으로(화면 탭도 0 이하를 보여주지 않는다)
  assert.equal(adminTodoCount("refunds", { ...MOCK, refund: { pending: -3 } }), 0);
  assert.equal(adminTodoCount("disputes", { ...MOCK, dispute: { open: Number.NaN, under_review: 2 } }), 2);
});

test("입력 필드가 가리키는 탭 값이 각 화면 모듈에 실제로 있다(pending · open · under_review · abandoned)", () => {
  assert.ok((MENTOR_APPROVAL_TAB_VALUES as readonly string[]).includes("pending"));
  assert.ok((CONTENT_REPORT_TAB_VALUES as readonly string[]).includes("pending"));
  assert.ok((REFUND_TAB_VALUES as readonly string[]).includes("pending"));
  assert.ok((DISPUTE_TAB_VALUES as readonly string[]).includes("open") && (DISPUTE_TAB_VALUES as readonly string[]).includes("under_review"));
  assert.ok((TOPUP_TAB_VALUES as readonly string[]).includes("pending"));
  assert.ok((MENTOR_ACTIVITY_TAB_VALUES as readonly string[]).includes("abandoned"));
});

test("조회 모듈: 각 화면의 건수 함수를 그대로 호출하고 그 값을 입력 필드에 넣는다 — 건수 로직 재작성 없음(refunds·content_reports·disputes·paysync_invoices·question_threads 직접 count 없음) · 조회 전용", () => {
  const q = stripComments(read(QUERIES));
  for (const fn of ["countMentorApprovalTabs(supabase)", "countContentReportTabs(supabase)", "countRefundTabs(supabase)", "countDisputeTabs(supabase)", "countTopupTabs()", "countAccountRoleTabs()"]) {
    assert.ok(q.includes(fn), `재사용: ${fn}`);
  }
  assert.ok(q.includes('loadMentorActivityList({ tab: "all", search: "", page: 1, pageSize: MENTOR_ACTIVITY_ROW_LIMIT, now })'), "멘토 활동 화면과 같은 행 집합(전체 탭 · 상한)");
  assert.ok(q.includes("mentorActivity.list.rows.reduce((sum, item) => sum + item.unansweredCount, 0)"), "미답변 합 = 행의 unansweredCount 합");
  assert.ok(q.includes("counts: { abandoned: mentorActivity.counts.abandoned }"));
  assert.ok(q.includes("mentorApproval: { pending: mentorApproval.pending }") && q.includes("contentReport: { pending: contentReport.pending }"));
  assert.ok(q.includes("refund: { pending: refund.pending }") && q.includes("dispute: { open: dispute.open, under_review: dispute.under_review }") && q.includes("topup: { pending: topup.pending }"));
  assert.ok(q.includes("countAccountDeletionStalled(now.toISOString())") && q.includes("accountDeletion: { stalled: deletionStalled ?? 0 }"), "탈퇴 멈춤 = 탈퇴 요청 화면의 집계 함수(PR-13)");
  assert.ok(!q.includes('.from("account_deletion_jobs")'), "account_deletion_jobs 직접 조회 없음 — 화면 모듈 함수 재사용");
  assert.ok(q.includes('.eq("status", "pending").is("reviewed_by", null)'), "미확정 등급 = pending + reviewed_by NULL(지시서 §1-2 표)");
  for (const table of ["refunds", "content_reports", "disputes", "paysync_invoices", "question_threads", "mentor_student_rooms", "mentor_activity_events"]) {
    assert.ok(!q.includes(`.from("${table}")`), `${table} 직접 조회 없음 — 화면 모듈 함수 재사용`);
  }
  assert.ok(!/\.(insert|update|upsert|delete|rpc)\(/.test(q), "조회 전용");
  assert.ok(q.includes("loadAuditLogList(supabase, { search: \"\", status: \"\", page: 1, pageSize: ADMIN_DASHBOARD_ACTIVITY_LIMIT, extra: {} }, adminDashboardActivityFilters(opts.showViews), now.toISOString())"), "최근 활동 = 감사 로그 화면 조회 함수");
  assert.ok(q.includes("if (!payoutAccountRegisteredForSettlement(row.payout_account_number)) missing += 1;"));
  assert.ok(q.includes('.eq("verification_status", "approved")'), "계좌 미등록은 승인 멘토 기준(정산 대상)");
});

// ── ② 0 은 회색 · 1 이상 주의색 ───────────────────────────────────────────────

test("0 이면 quiet(회색 · 보통 굵기) · 1 이상이면 attention(굵게 · 주의색 테두리) · 카드에 `없음` 문구 없음", () => {
  assert.equal(adminTodoTone(0), "quiet");
  assert.equal(adminTodoTone(1), "attention");
  assert.ok(adminTodoCountClass("quiet").includes("text-slate-400") && !adminTodoCountClass("quiet").includes("font-black"));
  assert.ok(adminTodoCountClass("attention").includes("font-black"));
  assert.ok(adminTodoCardClass("attention").includes("amber") && !adminTodoCardClass("quiet").includes("amber"));
  const cards = buildAdminTodoCards(MOCK);
  assert.equal(cards.find((c) => c.key === "school_tier_unconfirmed")?.tone, "quiet");
  assert.equal(cards.find((c) => c.key === "mentor_approval")?.tone, "attention");
  const grid = stripComments(read(TODO_GRID));
  assert.ok(!grid.includes("없음"), "0 은 정상 — `없음` 이라고 쓰지 않는다");
  assert.ok(grid.includes("adminTodoCardClass(card.tone)") && grid.includes("adminTodoCountClass(card.tone)"));
  assert.ok(grid.includes("grid-cols-2 gap-3 md:grid-cols-4"), "4열 → 1280·1440 모두 2줄");
  assert.ok(grid.includes("data-todo-tone={card.tone}"));
});

// ── ③ 링크 목적지 8개 ────────────────────────────────────────────────────────

test("링크 목적지 9개 — 그 화면의 실제 키(멘토 활동은 status · 지시서 표기 tab= 은 그 화면이 읽지 않는다 · 탈퇴 멈춤은 탈퇴 요청 진행 중 탭)", () => {
  assert.deepEqual(
    ADMIN_TODO_DEFINITIONS.map((d) => d.href),
    [
      "/admin/mentor-approval?status=pending",
      "/admin/mentor-approval",
      "/admin/mentor-activity",
      "/admin/moderation?status=pending",
      "/admin/refunds?status=pending",
      "/admin/disputes",
      "/admin/topups?status=pending",
      "/admin/mentor-activity?status=abandoned",
      "/admin/deletions",
    ]
  );
  assert.equal(resolveMentorActivityTab("abandoned"), "abandoned", "status=abandoned 가 이탈 의심 탭으로 열린다");
  for (const d of ADMIN_TODO_DEFINITIONS) {
    const route = d.href.split("?")[0].replace(/^\/admin\//, "");
    assert.ok(existsSync(join(ROOT, "app", "(admin)", "admin", "(console)", route, "page.tsx")), `목적지 라우트 존재: ${d.href}`);
  }
});

// ── ④ 일정 없음 · 오링크 없음 · 장식 차트 없음 ───────────────────────────────

test("일정 섹션·`+ 일정 추가` 없음 · 오링크 없음(신규 가입 → 감사 로그 · 캐시 거래액 → 환불) · recharts 없음 · 구 대시보드 파일 삭제 · loading.tsx", () => {
  const all = DASHBOARD_FILES.map((f) => stripComments(read(f))).join("\n");
  assert.ok(!all.includes("일정") && !all.includes("schedule"), "일정 섹션 없음");
  assert.ok(!all.includes("recharts"), "장식 차트 없음");
  assert.ok(!all.includes("오늘 신규 가입") && !all.includes("금일 캐시 거래액") && !all.includes("cash_ledger"), "구 KPI(오링크) 없음");
  assert.equal(ADMIN_STATUS_LINKS.weekly_signups, "/admin/users", "신규 가입 → 계정 목록(감사 로그 아님)");
  const hrefsToRefunds = ADMIN_TODO_DEFINITIONS.filter((d) => d.href.startsWith("/admin/refunds"));
  assert.deepEqual(hrefsToRefunds.map((d) => d.key), ["refunds"], "환불로 가는 칸은 환불 요청뿐");
  for (const gone of ["components/admin/AdminDashboardView.tsx", "components/admin/AdminQueueGrid.tsx", "lib/admin/adminDashboardExtended.ts"]) {
    assert.ok(!existsSync(join(ROOT, gone)), `삭제: ${gone}`);
  }
  const adminQueries = stripComments(read("lib/admin/adminQueries.ts"));
  assert.ok(!adminQueries.includes("loadAdminDashboardSummary") && !adminQueries.includes("AdminQueueMetric"), "구 대시보드 집계 삭제");
  assert.ok(existsSync(join(ROOT, LOADING)));
  const page = stripComments(read(PAGE));
  assert.ok(page.includes("<AdminPageLayout") && !page.includes("PageScaffold"));
  assert.ok(page.includes("<AdminDashboardTodoGrid cards={data.todo} />") && page.includes("<AdminDashboardStatusBar items={data.status} />") && page.includes("<AdminDashboardActivity"));
  assert.ok(!/<button\b/.test(page + stripComments(read(TODO_GRID)) + stripComments(read(STATUS_BAR))), "죽은 버튼 없음(대시보드에는 링크만)");
});

// ── ⑤ 최근 활동 ──────────────────────────────────────────────────────────────

test("최근 활동: 10건 · 열람 기록 제외 기본 켜짐(showViews 가 아니면 hideViews) · 토글은 URL 하나 · 행 → 대상(targetHref) · 빈 상태는 감사 로그 사전", () => {
  assert.equal(ADMIN_DASHBOARD_ACTIVITY_LIMIT, 10);
  assert.equal(ADMIN_DASHBOARD_SHOW_VIEWS_PARAM, "showViews");
  assert.equal(resolveAdminDashboardShowViews(undefined), false, "기본 = 열람 제외");
  assert.equal(resolveAdminDashboardShowViews("1"), true);
  assert.equal(resolveAdminDashboardShowViews(["1", "0"]), true);
  assert.deepEqual(adminDashboardActivityFilters(false), { actor: null, group: null, period: "all", hideViews: true });
  assert.deepEqual(adminDashboardActivityFilters(true), { actor: null, group: null, period: "all", hideViews: false });
  assert.equal(buildAdminDashboardUrl(false), ADMIN_DASHBOARD_PATH);
  assert.equal(buildAdminDashboardUrl(true), "/admin/dashboard?showViews=1");
  const toggle = stripComments(read(ACTIVITY_TOGGLE));
  assert.ok(toggle.startsWith('"use client"') && toggle.includes("checked={!showViews}") && toggle.includes("router.replace(buildAdminDashboardUrl(!hide))"));
  const activity = stripComments(read(ACTIVITY));
  assert.ok(!activity.startsWith('"use client"'));
  assert.ok(activity.includes("item.targetHref ? (") && activity.includes("<Link href={item.targetHref}"), "행 → 대상");
  assert.ok(activity.includes("item.action.label") && activity.includes("item.action.groupLabel"), "액션명은 PR-10 사전(AuditLogItem.action)");
  assert.ok(activity.includes("ADMIN_DASHBOARD_ACTIVITY_EMPTY.title"));
  assert.equal(AUDIT_LOG_EMPTY_STATE.none.title, "기록된 조치가 없습니다");
  const page = stripComments(read(PAGE));
  assert.ok(page.includes("resolveAdminDashboardShowViews(sp[ADMIN_DASHBOARD_SHOW_VIEWS_PARAM])"));
});

// ── ⑥ 현황 ───────────────────────────────────────────────────────────────────

test("현황: 멘토 · 학생 · 활성 구독 · 이번 주 신규 가입 · 계좌 미등록 멘토 — 조회 실패는 `—` · 계좌 미등록 → 계정 목록 멘토 탭 · 판정은 정산 RPC 규칙(번호만)", () => {
  assert.deepEqual([...ADMIN_STATUS_KEYS], ["mentors", "students", "active_subscriptions", "weekly_signups", "payout_missing"]);
  const items = buildAdminStatusItems({ mentorCount: 74, studentCount: 3, activeSubscriptionCount: 0, weeklySignupCount: null, mentorsWithoutPayoutAccount: 70 });
  assert.deepEqual(items.map((i) => i.value), ["74", "3", "0", "—", "70"]);
  assert.deepEqual(items.map((i) => i.href), ["/admin/users?role=mentor", "/admin/users?role=student", null, "/admin/users", "/admin/users?role=mentor"]);
  assert.equal(items[4].tone, "attention");
  assert.equal(buildAdminStatusItems({ mentorCount: 0, studentCount: 0, activeSubscriptionCount: 0, weeklySignupCount: 0, mentorsWithoutPayoutAccount: 0 })[4].tone, "neutral");
  assert.equal(formatAdminStatusCount(Number.NaN), "—");
  assert.equal(formatAdminStatusCount(1234), "1,234");
  assert.equal(payoutAccountRegisteredForSettlement("110-123-456"), true);
  assert.equal(payoutAccountRegisteredForSettlement("   "), false);
  assert.equal(payoutAccountRegisteredForSettlement(null), false);
  const settlement = stripComments(read("lib/admin/settlementConsoleQueries.ts"));
  assert.ok(settlement.includes('String(acct?.number ?? "").trim().length > 0'), "정산 미리보기의 등록 판정(번호만)과 같은 규칙");
  const bar = stripComments(read(STATUS_BAR));
  assert.ok(bar.includes("item.href ? (") && bar.includes("<Link href={item.href}"));
});

test("이번 주 시작 = KST 월요일 00:00 (일요일은 지난 월요일 · 자정 경계)", () => {
  assert.equal(kstWeekStartIso(new Date("2026-09-03T06:00:00Z")), "2026-08-30T15:00:00.000Z", "목요일 15:00 KST");
  assert.equal(kstWeekStartIso(new Date("2026-09-06T10:00:00Z")), "2026-08-30T15:00:00.000Z", "일요일은 지난 월요일");
  assert.equal(kstWeekStartIso(new Date("2026-08-30T16:00:00Z")), "2026-08-30T15:00:00.000Z", "월요일 01:00 KST");
  assert.equal(kstWeekStartIso(new Date("2026-08-30T14:00:00Z")), "2026-08-23T15:00:00.000Z", "일요일 23:00 KST 는 그 전 주");
});

// ── 순수 모듈 · UI 카피 ──────────────────────────────────────────────────────

test("순수 모듈은 React·@/ import 없음 · UI 카피 금지어 없음(선생님·강사님·수강생·과외·alert)", () => {
  const pure = stripComments(read(CONSOLE));
  assert.ok(!/from "react"|from "@\//.test(pure));
  for (const rel of DASHBOARD_FILES) {
    const code = stripComments(read(rel));
    for (const banned of ["선생님", "강사님", "수강생", "과외", "커패니티", "웰버십", "쌤버쉽", "alert("]) {
      assert.ok(!code.includes(banned), `${rel}: 금지 문구 ${banned}`);
    }
  }
});
