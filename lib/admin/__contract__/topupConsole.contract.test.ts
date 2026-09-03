// 계약 테스트: 관리자 충전 관리(PR-9 §2) — 무통장입금 주문 목록, 조회 전용.
// 실행: node --test --experimental-strip-types lib/admin/__contract__/topupConsole.contract.test.ts
//
// 고정하는 것(지시서 §4):
//   ① 정렬 기본값 만료 임박순(대기 탭) · 만료까지 6시간 미만 주의 · 지났으면 만료됨
//   ② 입금자명 ≠ 요청자 실명 표시(부모 이름 입금)
//   ③ 상태는 사전 paysync_invoices.status(대기·완료·만료·취소) — 탭 라벨은 사전에서 파생
//   ④ 조회 전용: 조회 모듈·화면에 쓰기(insert/update/rpc)·확인 폼·ConfirmSubmitButton 없음 · 상단 안내 · paid_trigger 컬럼
//   ⑤ 빈 상태 문구 · 요청자 이름 → 계정 상세 링크 · 사이드바 정산 그룹(환불 위)

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  TOPUP_DEFAULT_TAB,
  TOPUP_EMPTY_STATE,
  TOPUP_EXPIRY_WARN_MS,
  TOPUP_KNOWN_PAYSYNC_TRIGGERS,
  TOPUP_LOCAL_TRIGGERS,
  TOPUP_READ_ONLY_NOTICE,
  TOPUP_TABS,
  TOPUP_TRIGGER_LABELS,
  buildTopupListUrl,
  buildTopupSearchOr,
  depositorDiffersFromRequester,
  formatTopupRemaining,
  isTopupTriggerManual,
  parseTopupRow,
  resolveTopupTab,
  topupEmptyState,
  topupExpiryState,
  topupListOrder,
  topupTabStatus,
  topupTriggerLabel,
} from "../topupConsole.ts";
import { adminStatusAllowedValues, resolveAdminStatus } from "../adminStatusDictionary.ts";
import { ADMIN_CONSOLE_NAV } from "../../../components/admin/adminConsoleNavConfig.ts";

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const NOW = "2026-09-03T04:48:00Z";

// ── ① 만료 임박순 · 남은 시간 ─────────────────────────────────────────────────

test("정렬 기본값: 대기 탭은 만료 임박순(expires_at 오름차순, 만료 없음은 뒤) · 다른 탭은 발행 최신순", () => {
  assert.deepEqual(topupListOrder("pending"), { column: "expires_at", ascending: true, nullsFirst: false });
  assert.deepEqual(topupListOrder("paid"), { column: "issued_at", ascending: false, nullsFirst: false });
  assert.deepEqual(topupListOrder("all"), { column: "issued_at", ascending: false, nullsFirst: false });
  assert.equal(TOPUP_DEFAULT_TAB, "pending");
});

test("만료까지: 6시간 미만은 soon(주의색) · 이상은 ok · 지났으면 expired('만료됨') · 완료·취소는 none('—') · 경계값은 아직 만료 아님", () => {
  assert.equal(TOPUP_EXPIRY_WARN_MS, 6 * 60 * 60 * 1000);
  const soon = topupExpiryState({ status: "pending", expiresAt: "2026-09-03T10:00:00Z" }, NOW);
  assert.equal(soon.kind, "soon");
  assert.equal(formatTopupRemaining(soon), "5시간 12분");
  const ok = topupExpiryState({ status: "pending", expiresAt: "2026-09-04T04:00:00Z" }, NOW);
  assert.equal(ok.kind, "ok");
  assert.equal(formatTopupRemaining(ok), "23시간 12분");
  assert.equal(formatTopupRemaining(topupExpiryState({ status: "pending", expiresAt: "2026-09-05T06:00:00Z" }, NOW)), "2일 1시간");
  assert.equal(formatTopupRemaining(topupExpiryState({ status: "pending", expiresAt: "2026-09-03T05:30:00Z" }, NOW)), "42분");
  const expired = topupExpiryState({ status: "pending", expiresAt: "2026-09-03T04:00:00Z" }, NOW);
  assert.equal(expired.kind, "expired");
  assert.equal(formatTopupRemaining(expired), "만료됨");
  assert.equal(topupExpiryState({ status: "expired", expiresAt: "2026-09-01T00:00:00Z" }, NOW).kind, "expired");
  assert.equal(topupExpiryState({ status: "pending", expiresAt: NOW }, NOW).kind, "soon", "정확히 만료 시각 = 아직 만료 아님(보정 크론과 같은 경계)");
  assert.equal(topupExpiryState({ status: "paid", expiresAt: "2026-09-03T04:00:00Z" }, NOW).kind, "none");
  assert.equal(formatTopupRemaining(topupExpiryState({ status: "canceled", expiresAt: null }, NOW)), "—");
  assert.equal(topupExpiryState({ status: "pending", expiresAt: null }, NOW).kind, "none");
});

// ── ② 입금자명 ≠ 요청자 ───────────────────────────────────────────────────────

test("입금자명이 요청자 실명과 다르면 표시 — 공백 차이는 무시 · 실명을 모르면 표시하지 않는다", () => {
  assert.equal(depositorDiffersFromRequester("김요섭", "김요섭"), false);
  assert.equal(depositorDiffersFromRequester("김요섭", "김 요섭"), false);
  assert.equal(depositorDiffersFromRequester("김부모", "김요섭"), true);
  assert.equal(depositorDiffersFromRequester("김부모", null), false);
  assert.equal(depositorDiffersFromRequester("김부모", ""), false);
  const row = parseTopupRow(
    { id: "i1", user_id: "u1", paysync_invoice_id: "ivc_1", pay_krw: 30000, cash_krw: 30000, bonus_krw: 0, depositor_name: "김부모", status: "pending", issued_at: "2026-08-31T10:25:00Z", expires_at: "2026-09-01T10:25:00Z", paid_at: null, paid_trigger: null },
    { fullName: "김요섭", nickname: "요섭" }
  )!;
  assert.equal(row.depositorDiffers, true);
  assert.equal(row.requesterName, "김요섭");
  assert.equal(row.payKrw, 30000);
  assert.equal(parseTopupRow({ id: "", user_id: "u" }, null), null);
});

// ── ③ 상태 사전 ───────────────────────────────────────────────────────────────

test("상태는 사전 paysync_invoices.status 4값(대기 · 완료 · 만료 · 취소) — 탭 라벨은 사전에서 파생 · 전체 탭 추가", () => {
  assert.deepEqual(adminStatusAllowedValues("paysync_invoices", "status").sort(), ["canceled", "expired", "paid", "pending"]);
  assert.deepEqual(TOPUP_TABS.map((t) => t.label), ["대기", "완료", "만료", "취소", "전체"]);
  for (const t of TOPUP_TABS) {
    if (t.value === "all") continue;
    assert.equal(t.label, resolveAdminStatus("paysync_invoices", "status", t.value).label, t.value);
    assert.equal(topupTabStatus(t.value), t.value);
  }
  assert.equal(topupTabStatus("all"), null);
  assert.equal(resolveTopupTab(undefined), "pending");
  assert.equal(resolveTopupTab("paid"), "paid");
  assert.equal(resolveTopupTab("weird"), "pending");
  // 사전 값 집합 == 마이그레이션 인라인 CHECK
  const sql = read("supabase/migrations/20260830100100_paysync_invoices.sql");
  assert.ok(sql.includes("check (status in ('pending', 'paid', 'expired', 'canceled'))"));
});

test("목록 링크·검색: status=all 유지 · 검색어는 입금자명 ilike + 요청자 id in", () => {
  const params = { search: "", status: "pending", page: 1, pageSize: 25, extra: {} };
  assert.equal(buildTopupListUrl(params, { status: "all" }), "/admin/topups?status=all");
  assert.equal(buildTopupListUrl(params, { search: "김" }), "/admin/topups?q=%EA%B9%80&status=pending", "검색해도 탭 유지 · page 리셋");
  assert.equal(buildTopupListUrl({ ...params, page: 3 }, { page: 2 }), "/admin/topups?status=pending&page=2");
  assert.equal(buildTopupSearchOr("김", []), "depositor_name.ilike.%김%");
  assert.equal(buildTopupSearchOr("김", ["u1", "u2"]), "depositor_name.ilike.%김%,user_id.in.(u1,u2)");
});

// ── ④ paid_trigger · 조회 전용 ────────────────────────────────────────────────

test("paid_trigger: 페이싱크 문서 4종 + 우리 경로 2종 전부 라벨 · 모르는 값은 원시 값 · 수동 매칭/승인 판정", () => {
  for (const t of [...TOPUP_KNOWN_PAYSYNC_TRIGGERS, ...TOPUP_LOCAL_TRIGGERS]) assert.ok(TOPUP_TRIGGER_LABELS[t], `${t} 라벨 없음`);
  assert.equal(topupTriggerLabel("AUTOMATIC_MATCHING"), "자동 매칭");
  assert.equal(topupTriggerLabel("MANUAL_APPROVE"), "수동 승인(페이싱크)");
  assert.equal(topupTriggerLabel("RECONCILE_CRON"), "보정 크론");
  assert.equal(topupTriggerLabel("SOMETHING_NEW"), "SOMETHING_NEW");
  assert.equal(topupTriggerLabel(null), "—");
  assert.equal(isTopupTriggerManual("MANUAL_MATCHING"), true);
  assert.equal(isTopupTriggerManual("AUTOMATIC_MATCHING"), false);
  // 우리 경로가 넣는 문자열과 같다
  const server = read("lib/paysync/paysyncInvoiceService.ts") + read("app/api/cron/paysync-reconcile/route.ts");
  for (const t of TOPUP_LOCAL_TRIGGERS) assert.ok(server.includes(`"${t}"`), `${t} 는 실제 적립 경로가 넣는 값이어야 한다`);
});

test("조회 전용 tripwire: 조회 모듈·화면·툴바·표에 쓰기(insert/update/upsert/delete/rpc)·확인 폼·ConfirmSubmitButton 없음 · 상단 안내 · paid_trigger 컬럼", () => {
  const queries = stripComments(read("lib/admin/topupConsoleQueries.ts"));
  assert.ok(queries.includes('import "server-only"'));
  assert.ok(!/\.(insert|update|upsert|delete|rpc)\(/.test(queries), "쓰기·RPC 호출 금지");
  assert.ok(!/record_cash_topup|recordPaysyncTopup/.test(queries), "적립 경로 호출 금지 — 새 쓰기 경로를 만들지 않는다");
  for (const rel of ["app/(admin)/admin/(console)/topups/page.tsx", "components/admin/TopupQueueTable.tsx", "components/admin/TopupQueueToolbar.tsx"]) {
    const code = stripComments(read(rel));
    assert.ok(!code.includes("ConfirmSubmitButton"), `${rel}: 확인 버튼 없음(조회 전용)`);
    assert.ok(!/action=\{\w*Action\}/.test(code), `${rel}: 서버 액션 폼 없음(GET 검색 form 만)`);
    assert.ok(!/from "@\/lib\/admin\/\w+Actions"/.test(code), `${rel}: 액션 모듈 import 없음`);
    assert.ok(!/"use server"/.test(code), rel);
  }
  const page = read("app/(admin)/admin/(console)/topups/page.tsx");
  assert.ok(page.includes("TOPUP_READ_ONLY_NOTICE"), "상단 안내: 입금은 자동으로 감지");
  assert.ok(page.includes('from "@/components/admin/AdminPageLayout"'));
  const table = read("components/admin/TopupQueueTable.tsx");
  assert.ok(table.includes("topupTriggerLabel("), "paid_trigger 컬럼(자동/수동 구분)");
  assert.ok(table.includes("accountDetailPath("), "요청자 이름 → 계정 상세 링크");
  assert.ok(table.includes('<AdminStatusPill table="paysync_invoices" column="status"'), "상태는 사전 배지");
  assert.ok(table.includes("depositorDiffers"), "입금자명 ≠ 요청자 표시");
  assert.equal(TOPUP_READ_ONLY_NOTICE, "입금은 자동으로 감지됩니다. 감지가 안 된 건은 고객센터로 처리합니다.");
});

// ── ⑤ 빈 상태 · 사이드바 ──────────────────────────────────────────────────────

test("빈 상태: 대기 탭 고정 문구(24시간 만료 안내) · 검색·다른 탭 변형", () => {
  assert.equal(TOPUP_EMPTY_STATE.title, "대기 중인 충전 요청이 없습니다");
  assert.equal(TOPUP_EMPTY_STATE.description, "학생이 계좌이체 충전을 요청하면 여기에 쌓입니다. 요청서는 발행 후 24시간 뒤 만료됩니다.");
  assert.deepEqual(topupEmptyState("pending", ""), TOPUP_EMPTY_STATE);
  assert.equal(topupEmptyState("expired", "").title, "'만료' 상태의 충전 요청이 없습니다");
  assert.ok(topupEmptyState("pending", "김").description.includes("'김'"));
});

test("사이드바: 충전 관리는 정산 그룹에서 환불 관리 바로 위 · 정산 관리는 그 아래", () => {
  const hrefs = ADMIN_CONSOLE_NAV.map((n) => n.href);
  const topups = hrefs.indexOf("/admin/topups");
  assert.ok(topups >= 0, "충전 관리 항목");
  assert.equal(hrefs[topups + 1], "/admin/refunds");
  assert.equal(hrefs[topups + 2], "/admin/settlements");
  assert.equal(ADMIN_CONSOLE_NAV[topups].label, "충전 관리");
});
