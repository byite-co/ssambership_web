// 계약 테스트: 관리자 탈퇴 요청 현황(PR-13 §1) — account_deletion_jobs 파이프라인 감시, 조회 전용.
// 실행: node --test --experimental-strip-types lib/admin/__contract__/accountDeletionConsole.contract.test.ts
//
// 고정하는 것(지시서 §3 · §5):
//   ① 상태 사전 9종(대기 · 잠금 · 삭제 중 · 파일 삭제됨 · 마무리 · 인증 해제 · 완료 · 취소 · 실패) = 타임라인 9단계 = DB CHECK
//   ② 24h 주의 · 72h 위험 — 종료 상태는 세지 않고, pending 의 30일 취소 유예 구간은 정체가 아니다(실측 2건 = 취소 유예 중)
//   ③ 요청자 익명화 표시 `(삭제 처리됨)` · 요청자 → 계정 상세 링크 없음
//   ④ 조치 버튼은 §1-1-B 결과대로 없음(재시도 RPC 없음 → 조회 전용) · 조회 모듈 쓰기·RPC 0 · DB 변경 0
//   ⑤ 대시보드 `탈퇴 멈춤` 칸 = 이 화면의 멈춤 건수(같은 함수) · 사이드바 계정 관리 아래 · 빈 상태 문구

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ACCOUNT_DELETION_ADMIN_RETRY_AVAILABLE,
  ACCOUNT_DELETION_BASE_PATH,
  ACCOUNT_DELETION_DEFAULT_TAB,
  ACCOUNT_DELETION_EMPTY_STATE,
  ACCOUNT_DELETION_PIPELINE_NOTICE,
  ACCOUNT_DELETION_REQUESTER_DELETED_LABEL,
  ACCOUNT_DELETION_STALL_DANGER_HOURS,
  ACCOUNT_DELETION_STALL_STATES,
  ACCOUNT_DELETION_STALL_WARNING_HOURS,
  ACCOUNT_DELETION_TABS,
  ACCOUNT_DELETION_TIMELINE_STEPS,
  accountDeletionCancelWindowOpen,
  accountDeletionElapsedClass,
  accountDeletionEmptyState,
  accountDeletionJobPath,
  accountDeletionRequesterLabel,
  accountDeletionRequesterRoleLabel,
  accountDeletionStallState,
  accountDeletionStateChangedAt,
  accountDeletionStateLabel,
  accountDeletionTabStates,
  accountDeletionTimeline,
  buildAccountDeletionListItem,
  buildAccountDeletionListUrl,
  countStalledAccountDeletionJobs,
  formatAccountDeletionCancelWindow,
  formatAccountDeletionElapsed,
  formatKstShort,
  isAnonymizedRequester,
  parseAccountDeletionJobRow,
  resolveAccountDeletionTab,
  type AccountDeletionJobRow,
} from "../accountDeletionConsole.ts";
import { ACCOUNT_DELETION_ACTIVE_STATES } from "../../account/accountDeletionJobStates.ts";
import { ADMIN_TODO_DEFINITIONS } from "../adminDashboardConsole.ts";
import { adminStatusAllowedValues } from "../adminStatusDictionary.ts";
import { ADMIN_CONSOLE_NAV } from "../../../components/admin/adminConsoleNavConfig.ts";

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

const PURE = "lib/admin/accountDeletionConsole.ts";
const QUERIES = "lib/admin/accountDeletionQueries.ts";
const PAGE = "app/(admin)/admin/(console)/deletions/page.tsx";
const DETAIL_PAGE = "app/(admin)/admin/(console)/deletions/[id]/page.tsx";
const TOOLBAR = "components/admin/AccountDeletionQueueToolbar.tsx";
const TABLE = "components/admin/AccountDeletionQueueTable.tsx";
const DETAIL = "components/admin/AccountDeletionJobDetail.tsx";
const NEW_FILES = [PURE, QUERIES, PAGE, DETAIL_PAGE, TOOLBAR, TABLE, DETAIL, "app/(admin)/admin/(console)/deletions/loading.tsx", "app/(admin)/admin/(console)/deletions/[id]/loading.tsx"];

const H = 60 * 60 * 1000;
/** 실측 2건 중 하나(스테이징 · 2026-09-03) — 요청 08-30 20:54 KST · 취소 유예 09-29 · attempts 0 · lease 없음 · dry_run false */
const LIVE_ROW = {
  id: "5123393a-e29f-437a-9a5a-bc0390ffbbd7",
  user_id: "11111111-1111-4111-8111-111111111111",
  state: "pending",
  attempts: 0,
  last_error: null,
  next_attempt_at: null,
  lease_owner: null,
  leased_until: null,
  dry_run: false,
  requested_at: "2026-08-30T11:54:59.918808+00:00",
  cancelable_until: "2026-09-29T11:54:59.918808+00:00",
  forfeit_consent_at: null,
  consented_balance_cents: 0,
  updated_at: "2026-08-30T11:54:59.918808+00:00",
};
const NOW = "2026-09-03T09:41:07.660Z";
const LIVE_JOB = parseAccountDeletionJobRow(LIVE_ROW)!;
const job = (over: Partial<AccountDeletionJobRow>): AccountDeletionJobRow => ({ ...LIVE_JOB, ...over });
const at = (base: string, hours: number) => new Date(new Date(base).getTime() + hours * H).toISOString();

// ── ① 상태 사전 9종 · 타임라인 9단계 ────────────────────────────────────────

test("상태 사전 9종 = 타임라인 9단계 = DB CHECK — 라벨은 지시서 사전(대기 · 잠금 · 삭제 중 · 파일 삭제됨 · 마무리 · 인증 해제 · 완료 · 취소 · 실패)", () => {
  const states = ACCOUNT_DELETION_TIMELINE_STEPS.map((s) => s.state);
  assert.deepEqual(states, ["pending", "locked", "purging", "storage_purged", "finalized", "auth_soft_deleted", "completed", "canceled", "failed"]);
  assert.deepEqual([...states].sort(), [...adminStatusAllowedValues("account_deletion_jobs", "state")].sort(), "사전 값 집합과 같다");
  assert.deepEqual(states.map(accountDeletionStateLabel), ["대기", "잠금", "삭제 중", "파일 삭제됨", "마무리", "인증 해제", "완료", "취소", "실패"]);
  assert.deepEqual(ACCOUNT_DELETION_TIMELINE_STEPS.map((s) => s.at), ["requestedAt", "lockedAt", "purgingAt", "storagePurgedAt", "finalizedAt", "authSoftDeletedAt", "completedAt", "canceledAt", "failedAt"], "각 단계의 *_at 컬럼");
  const timeline = accountDeletionTimeline(job({ state: "purging", lockedAt: at(LIVE_ROW.requested_at, 1), purgingAt: at(LIVE_ROW.requested_at, 2) }));
  assert.equal(timeline.length, 9);
  assert.deepEqual(timeline.map((t) => t.reached), [true, true, true, false, false, false, false, false, false]);
  assert.deepEqual(timeline.map((t) => t.current), [false, false, true, false, false, false, false, false, false]);
  assert.equal(accountDeletionStateChangedAt(job({ state: "locked", lockedAt: "2026-09-01T00:00:00Z" })), "2026-09-01T00:00:00Z", "현재 단계 진입 시각 = 그 단계의 *_at");
  assert.equal(accountDeletionStateChangedAt(job({ state: "locked", lockedAt: null, updatedAt: "2026-09-02T00:00:00Z" })), "2026-09-02T00:00:00Z", "없으면 updated_at");
  assert.equal(parseAccountDeletionJobRow({ id: "x", user_id: "", state: "pending" }), null);
});

test("탭 4개(진행 중 · 완료 · 실패 · 취소) — 진행 중 = SQL 175 활성 상태 미러 · 기본 탭 진행 중 · 링크는 공용 규칙(status 키)", () => {
  assert.deepEqual(ACCOUNT_DELETION_TABS.map((t) => [t.value, t.label]), [["active", "진행 중"], ["completed", "완료"], ["failed", "실패"], ["canceled", "취소"]]);
  assert.equal(ACCOUNT_DELETION_DEFAULT_TAB, "active");
  assert.deepEqual([...accountDeletionTabStates("active")], [...ACCOUNT_DELETION_ACTIVE_STATES]);
  assert.deepEqual([...accountDeletionTabStates("failed")], ["failed"]);
  assert.equal(resolveAccountDeletionTab("FAILED"), "failed");
  assert.equal(resolveAccountDeletionTab("weird"), "active");
  const params = { search: "", status: "active", page: 1, pageSize: 25, extra: {} };
  assert.equal(ACCOUNT_DELETION_BASE_PATH, "/admin/deletions");
  assert.equal(buildAccountDeletionListUrl(params, { status: "failed" }), "/admin/deletions?status=failed");
  assert.equal(buildAccountDeletionListUrl({ ...params, page: 2 }), "/admin/deletions?status=active&page=2");
  assert.equal(accountDeletionJobPath(LIVE_JOB.id), `/admin/deletions/${LIVE_JOB.id}`);
});

// ── ② 24h 주의 · 72h 위험 · 취소 유예 ───────────────────────────────────────

test("정체 판정 ★: 실측 2건(08-30 요청 · 09-29 취소 유예)은 09-03 시점에 취소 유예 중 = 정체 아님 · 멈춤 0(문자 그대로의 24h 규칙이면 2) · 경과 칸 `취소 유예 · 09-29 20:54까지`", () => {
  assert.equal(accountDeletionCancelWindowOpen(LIVE_JOB, NOW), true);
  const stall = accountDeletionStallState(LIVE_JOB, NOW);
  assert.equal(stall.kind, "cancel_window");
  assert.equal(stall.stalled, false);
  assert.equal(stall.tone, "neutral");
  assert.equal(formatAccountDeletionElapsed(stall, LIVE_JOB), "취소 유예 · 09-29 20:54까지");
  assert.equal(formatAccountDeletionCancelWindow(LIVE_JOB, NOW), "D-27 · 09-29 20:54");
  assert.equal(countStalledAccountDeletionJobs([LIVE_JOB, job({ id: "7d0d5a25-a774-4a54-985b-34b9f8f7329c", requestedAt: "2026-08-30T11:36:28.56866+00:00", cancelableUntil: "2026-09-29T11:36:28.56866+00:00" })], NOW), 0);
  // 지시서 §1-4 의 문자 그대로(요청 후 24h 초과)라면 2 — 취소 유예 30일(hotfix 20260808)을 반영해 세지 않는다.
  const literal = [LIVE_JOB].filter((j) => new Date(NOW).getTime() - new Date(j.requestedAt!).getTime() > 24 * H).length;
  assert.equal(literal, 1, "문자 그대로면 요청 4일째 = 초과");
});

test("정체 판정: 취소 유예가 지난 pending 은 유예 종료 시각부터 · 24h 주의 · 72h 위험 · 다른 단계는 그 단계 진입 시각부터 · 종료(완료·취소)는 — · failed 는 멈춤에 포함", () => {
  assert.equal(ACCOUNT_DELETION_STALL_WARNING_HOURS, 24);
  assert.equal(ACCOUNT_DELETION_STALL_DANGER_HOURS, 72);
  const closed = job({ cancelableUntil: at(NOW, -25) });
  const s1 = accountDeletionStallState(closed, NOW);
  assert.equal(s1.kind, "running");
  assert.equal(s1.tone, "warning");
  assert.equal(s1.stalled, true);
  assert.equal(formatAccountDeletionElapsed(s1, closed), "1일 1시간");
  assert.equal(s1.sinceIso, at(NOW, -25), "유예 종료 시각부터 센다(요청 시각 아님)");
  const fresh = accountDeletionStallState(job({ cancelableUntil: at(NOW, -2) }), NOW);
  assert.equal(fresh.tone, "neutral");
  assert.equal(fresh.stalled, false);
  const danger = accountDeletionStallState(job({ cancelableUntil: at(NOW, -73) }), NOW);
  assert.equal(danger.tone, "danger");
  assert.equal(danger.stalled, true);
  const locked = accountDeletionStallState(job({ state: "locked", lockedAt: at(NOW, -30) }), NOW);
  assert.equal(locked.tone, "warning");
  assert.equal(locked.sinceIso, at(NOW, -30));
  assert.equal(accountDeletionStallState(job({ state: "purging", purgingAt: at(NOW, -3) }), NOW).stalled, false);
  const done = accountDeletionStallState(job({ state: "completed", completedAt: at(NOW, -100) }), NOW);
  assert.equal(done.kind, "terminal");
  assert.equal(formatAccountDeletionElapsed(done, LIVE_JOB), "—");
  assert.equal(accountDeletionStallState(job({ state: "canceled", canceledAt: at(NOW, -100) }), NOW).stalled, false);
  const failed = accountDeletionStallState(job({ state: "failed", failedAt: at(NOW, -40) }), NOW);
  assert.equal(failed.stalled, true, "failed 는 state NOT IN (completed, canceled) 규칙대로 포함(자동 재시도 없음)");
  assert.deepEqual([...ACCOUNT_DELETION_STALL_STATES], [...ACCOUNT_DELETION_ACTIVE_STATES, "failed"]);
  assert.equal(countStalledAccountDeletionJobs([closed, job({ state: "completed", completedAt: at(NOW, -100) }), job({ state: "failed", failedAt: at(NOW, -40) })], NOW), 2);
  assert.ok(accountDeletionElapsedClass("warning").includes("amber") && accountDeletionElapsedClass("danger").includes("red") && !accountDeletionElapsedClass("neutral").includes("amber"));
  assert.equal(formatKstShort("2026-08-30T11:54:59.918808+00:00"), "08-30 20:54");
  assert.equal(formatKstShort(null), "—");
});

// ── ③ 요청자 익명화 · 링크 없음 ────────────────────────────────────────────

test("요청자: users 행이 남아 있으면 이름(실명 → 닉네임 → 이메일) · 익명화(탈퇴회원 · @removed.invalid · status deleted)·행 없음은 `(삭제 처리됨)` · 역할 라벨", () => {
  const alive = { id: LIVE_JOB.userId, role: "mentor", status: "active", fullName: "김멘토", nickname: "하늘", email: "m@x.kr" };
  assert.equal(accountDeletionRequesterLabel(alive, LIVE_JOB.userId), "김멘토");
  assert.equal(accountDeletionRequesterLabel({ ...alive, fullName: null }, LIVE_JOB.userId), "하늘");
  assert.equal(accountDeletionRequesterRoleLabel(alive), "멘토");
  assert.equal(accountDeletionRequesterRoleLabel(null), "—");
  assert.equal(ACCOUNT_DELETION_REQUESTER_DELETED_LABEL, "(삭제 처리됨)");
  for (const anon of [
    null,
    { ...alive, status: "deleted" },
    { ...alive, fullName: "탈퇴회원", nickname: "탈퇴회원_51233939", email: `deleted_${LIVE_JOB.userId}@removed.invalid` },
    { ...alive, nickname: "탈퇴회원_51233939" },
  ]) {
    assert.equal(isAnonymizedRequester(anon), true);
    assert.equal(accountDeletionRequesterLabel(anon, LIVE_JOB.userId), "(삭제 처리됨)");
  }
  assert.equal(isAnonymizedRequester(alive), false);
  const item = buildAccountDeletionListItem(LIVE_JOB, { ...alive, status: "deleted" }, NOW);
  assert.equal(item.requesterDeleted, true);
  assert.equal(item.stateLabel, "대기");
  assert.equal(item.lastErrorLabel, "—");
  assert.equal(item.cancelWindowLabel, "D-27 · 09-29 20:54");
  // 익명화 값은 SQL 115 anonymize_user_for_deletion 이 남기는 것과 같다
  const sql = read("supabase/sql/115_account_deletion.sql");
  assert.ok(sql.includes("set full_name = '탈퇴회원'") && sql.includes("nickname = '탈퇴회원_' || left(p_user_id::text, 8)") && sql.includes("status = 'deleted'"));
});

test("요청자 → 계정 상세 링크 없음(표 · 상세 · 페이지) — accountDetailPath·/admin/users/<id> 링크 0", () => {
  for (const rel of [TABLE, DETAIL, PAGE, DETAIL_PAGE]) {
    const code = stripComments(read(rel));
    assert.ok(!code.includes("accountDetailPath"), `${rel}: accountDetailPath 사용 금지`);
    assert.ok(!/\/admin\/users\/\$\{|\/admin\/users\/`|accountDetailPath\(/.test(code), `${rel}: 계정 상세 링크 없음`);
  }
  const table = stripComments(read(TABLE));
  assert.ok(table.includes("{it.requesterLabel}") && !/href=\{[^}]*requester/i.test(table), "요청자 이름은 텍스트");
  assert.ok(table.includes("href={accountDeletionJobPath(it.job.id)}"), "행 → 상세(타임라인)");
});

// ── ④ 조치 없음(§1-1-B) · 조회 전용 · DB 변경 0 ─────────────────────────────

test("§1-1-B: 관리자 재시도 RPC 없음 → 조치 버튼 0(폼·ConfirmSubmitButton·button 없음) · 조회 모듈 쓰기·RPC 0 · account_deletion_advance 호출 0 · 단계 건너뛰기·직접 삭제 버튼 없음", () => {
  assert.equal(ACCOUNT_DELETION_ADMIN_RETRY_AVAILABLE, false);
  for (const rel of [TABLE, DETAIL, TOOLBAR, PAGE, DETAIL_PAGE]) {
    const code = stripComments(read(rel));
    assert.ok(!/<form\b|formAction|ConfirmSubmitButton|<button\b|"use server"|"use client"/.test(code), `${rel}: 조치 버튼·폼·클라이언트 코드 없음(Server Component · 조회 전용)`);
    assert.ok(!/재시도 요청|level="|onConfirm/.test(code), `${rel}: 재시도 버튼·확인 다이얼로그 없음`);
  }
  const q = stripComments(read(QUERIES));
  assert.ok(q.startsWith('import "server-only";'));
  assert.ok(!/\.insert\(|\.update\(|\.delete\(|\.upsert\(|\.rpc\(/.test(q), "조회 모듈 쓰기·RPC 없음");
  assert.ok(q.includes('.from("account_deletion_jobs")') && q.includes('.in("state", states)') && q.includes('.order("requested_at", { ascending: false })'), "탭 → state in · 요청 최신순");
  for (const dir of ["lib/admin", "components/admin", "app/(admin)"]) {
    const walk = (d: string): string[] => readdirSync(join(ROOT, d), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(`${d}/${e.name}`) : /\.tsx?$/.test(e.name) ? [`${d}/${e.name}`] : []));
    for (const rel of walk(dir)) {
      if (rel.includes("__contract__")) continue;
      assert.ok(!/account_deletion_(advance|record_error|claim|reclaim_expired|begin_locked|forfeit_and_anonymize|cancel)\b/.test(stripComments(read(rel))), `${rel}: 탈퇴 saga RPC 호출은 워커 전용`);
    }
  }
  // 새 RPC 도 없다 — 저장소 RPC 정본에 관리자 재시도 함수가 없다
  const sqlFiles = readdirSync(join(ROOT, "supabase", "sql")).filter((f) => f.endsWith(".sql"));
  assert.ok(!sqlFiles.some((f) => /retry|deletion_admin/i.test(f)), "새 SQL(재시도 RPC) 없음");
  const migrations = readdirSync(join(ROOT, "supabase", "migrations")).filter((f) => f.endsWith(".sql"));
  for (const f of migrations) assert.ok(!read(`supabase/migrations/${f}`).includes("question_export"), `${f}: 이 PR 은 DB 변경 0`);
  const pure = stripComments(read(PURE));
  assert.ok(!/from "react"|from "@\//.test(pure), "순수 모듈");
});

// ── ⑤ 대시보드 칸 · 사이드바 · 빈 상태 · 문구 ──────────────────────────────

test("대시보드 `탈퇴 멈춤` 칸 = 이 화면의 멈춤 건수(같은 함수 countAccountDeletionStalled) · 목적지 /admin/deletions(진행 중 탭) · 사이드바 계정 관리 바로 아래 · 빈 상태 문구", () => {
  const card = ADMIN_TODO_DEFINITIONS.find((d) => d.key === "deletion_stalled");
  assert.ok(card);
  assert.equal(card.label, "탈퇴 멈춤");
  assert.equal(card.href, "/admin/deletions");
  const page = stripComments(read(PAGE));
  const dash = stripComments(read("lib/admin/adminDashboardQueries.ts"));
  assert.ok(page.includes("countAccountDeletionStalled(nowIso)") && dash.includes("countAccountDeletionStalled(now.toISOString())"), "화면과 대시보드가 같은 함수");
  const q = stripComments(read(QUERIES));
  assert.ok(q.includes("countStalledAccountDeletionJobs(") && q.includes("ACCOUNT_DELETION_STALL_STATES"), "집계 = 순수 판정 함수 · state NOT IN (completed, canceled)");
  assert.ok(page.includes("<AccountDeletionQueueToolbar") && page.includes("<AccountDeletionQueueTable") && page.includes("ACCOUNT_DELETION_PIPELINE_NOTICE") && page.includes("<AdminPageLayout"), "페이지 구성");
  assert.ok(stripComments(read(TOOLBAR)).includes("<AdminDataTable.Tabs") && stripComments(read(TABLE)).includes("<AdminDataTable.Pagination"), "공용 부품(prop 추가 0)");
  assert.ok(stripComments(read(DETAIL_PAGE)).includes('await requireRole("admin");') && stripComments(read(DETAIL)).includes("accountDeletionTimeline(job)") && stripComments(read(DETAIL)).includes("job.consentedBalanceCents"), "상세 = 가드 + 9단계 타임라인 + 잔액 포기 동의");
  const hrefs = ADMIN_CONSOLE_NAV.map((n) => n.href);
  assert.equal(hrefs[hrefs.indexOf("/admin/users") + 1], "/admin/deletions");
  assert.equal(ADMIN_CONSOLE_NAV.find((n) => n.href === "/admin/deletions")?.label, "탈퇴 요청");
  assert.ok(existsSync(join(ROOT, PAGE)) && existsSync(join(ROOT, DETAIL_PAGE)));
  assert.equal(ACCOUNT_DELETION_PIPELINE_NOTICE, "탈퇴는 9단계 자동 절차입니다. 24시간 넘게 같은 단계면 처리기를 확인하세요");
  assert.equal(ACCOUNT_DELETION_EMPTY_STATE.title, "진행 중인 탈퇴 요청이 없습니다");
  assert.equal(accountDeletionEmptyState("active").title, "진행 중인 탈퇴 요청이 없습니다");
  assert.equal(accountDeletionEmptyState("failed").title, "'실패' 상태의 탈퇴 요청이 없습니다");
});

test("처리기 배선(§1-1-A 근거): vercel.json 매시 정각 GET /api/cron/account-deletion · 실삭제 env 2종 · pg_cron 등록 없음 · 취소 유예 30일(hotfix 20260808)", () => {
  const vercel = JSON.parse(read("vercel.json")) as { crons: { path: string; schedule: string }[] };
  assert.deepEqual(vercel.crons.find((c) => c.path === "/api/cron/account-deletion"), { path: "/api/cron/account-deletion", schedule: "0 * * * *" });
  const cron = read("lib/account/accountDeletionCronRoute.ts");
  assert.ok(cron.includes('export const ACCOUNT_DELETION_SCHEDULED_REAL_RUN_ENV = "ACCOUNT_DELETION_SCHEDULED_REAL_RUN";'));
  assert.ok(read("lib/account/accountDeletionRunnerConfig.ts").includes('export const ACCOUNT_DELETION_WORKER_ENABLED_ENV = "ACCOUNT_DELETION_WORKER_ENABLED";'));
  const migrations = readdirSync(join(ROOT, "supabase", "migrations")).filter((f) => f.endsWith(".sql"));
  const cronSql = migrations.filter((f) => /cron\.schedule/.test(read(`supabase/migrations/${f}`)));
  assert.ok(cronSql.length > 0 && !cronSql.some((f) => /account-deletion|account_deletion/.test(read(`supabase/migrations/${f}`).replace(/--.*$/gm, ""))), "pg_cron 에 탈퇴 job 없음");
  assert.ok(read("supabase/migrations/20260808092007_account_deletion_server_cancel_window_30d.sql").includes("now() + interval '30 days'"), "취소 유예 30일");
});

test("UI 카피 금지어 없음(선생님·강사님·수강생·과외·alert) · 인라인 style 없음", () => {
  for (const rel of NEW_FILES) {
    const code = stripComments(read(rel));
    for (const banned of ["선생님", "강사님", "수강생", "과외", "커패니티", "웰버십", "쌤버쉽", "alert("]) assert.ok(!code.includes(banned), `${rel}: 금지 문구 ${banned}`);
    assert.ok(!/style=\{/.test(code), `${rel}: 인라인 style 금지`);
  }
});
