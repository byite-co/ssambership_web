// 계약 테스트: SLA 대시보드(PR-12 §2) — 건별 기한 4종 · 환불 딥링크 새 키 · 항목별 상세 링크 4종 · 정의 문단 없음 · 빈 상태.
// 실행: node --test --experimental-strip-types lib/admin/__contract__/slaConsole.contract.test.ts
//
// 고정하는 것(지시서 §5):
//   ① 환불 딥링크 = `/admin/refunds?status=pending`(PR-3 키) · 옛 `type`/`sort` 키 없음
//   ② 항목별 상세 링크 4종(개별질문 → 질문 상세 · 맞춤의뢰 → 주문 · 환불 → 환불 상세 · 분쟁 → 분쟁 상세) · 라우트 실존
//   ③ 정의 설명 문단 없음(오너 지시) · 기준값(REFUND 5일 · 분쟁 24h/48h · 개별질문 12h · 주문 D-7) 변경 없음 — 각 종류의 정본 함수 재사용
//   ④ AdminPageLayout · AdminStatusPill · 빈 상태 `기한이 임박한 항목이 없습니다` · 멘토 활동 ↔ SLA 상호 링크

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  SLA_BASE_PATH,
  SLA_DISPUTE_STATUSES,
  SLA_EMPTY_STATE,
  SLA_INDIVIDUAL_QUESTION_STATUSES,
  SLA_ITEM_KINDS,
  SLA_ITEM_KIND_LABELS,
  SLA_ITEM_ROW_LIMIT,
  SLA_ITEM_STATUS_TABLE,
  SLA_REFUND_QUEUE_HREF,
  SLA_REFUND_REQUEST_TYPE,
  compareSlaItems,
  countSlaTones,
  formatSlaRemaining,
  formatSlaSummary,
  slaCustomOrderJudgement,
  slaDisputeJudgement,
  slaIndividualQuestionJudgement,
  slaItemHref,
  slaMentorActivityHref,
  slaRefundJudgement,
  slaTitleFromBody,
  slaToneClass,
  sortSlaItems,
  type SlaItem,
} from "../slaConsole.ts";
import { REFUND_SLA_DAYS, isSlaTrackedRequestType, refundSlaToneClass } from "../refundSla.ts";
import { DISPUTE_ELAPSED_DANGER_HOURS, DISPUTE_ELAPSED_WARNING_HOURS } from "../disputeConsole.ts";
import { INDIVIDUAL_AWAITING_STATUSES } from "../questionDrilldownConsole.ts";
import { adminStatusAllowedValues } from "../adminStatusDictionary.ts";

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const PAGE = "app/(admin)/admin/(console)/sla/page.tsx";
const LOADING = "app/(admin)/admin/(console)/sla/loading.tsx";
const SERVER = "lib/admin/slaDashboard.ts";
const CONSOLE = "lib/admin/slaConsole.ts";
const MENTOR_ACTIVITY_LIST = "components/admin/MentorActivityList.tsx";

const NOW = new Date("2026-09-03T06:00:00Z");
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const at = (ms: number) => new Date(NOW.getTime() + ms).toISOString();

function item(over: Partial<SlaItem> = {}): SlaItem {
  return { kind: "refund", id: "r", title: "t", status: "pending", mentorName: null, deadlineAt: null, remainingMs: null, label: "—", tone: "ok", href: "/admin/refunds/r", ...over };
}

// ── ① 환불 딥링크 ────────────────────────────────────────────────────────────

test("환불 딥링크는 PR-3 키 `status=pending` — 옛 `type`/`sort` 키는 화면·모듈 어디에도 없다", () => {
  assert.equal(SLA_REFUND_QUEUE_HREF, "/admin/refunds?status=pending");
  const src = stripComments(read(PAGE)) + stripComments(read(CONSOLE)) + stripComments(read(SERVER));
  assert.ok(!src.includes("type=subscription_mentor_suspended") && !src.includes("sort=deadline"), "옛 키 없음");
  assert.ok(stripComments(read(PAGE)).includes("href={SLA_REFUND_QUEUE_HREF}"));
});

// ── ② 상세 링크 4종 ──────────────────────────────────────────────────────────

test("항목별 상세 링크 4종: 개별질문 → PR-8 질문 상세 · 맞춤의뢰 → 주문 목록(그 주문 검색) · 환불 → 환불 상세 · 분쟁 → 분쟁 상세 · 라우트 실존", () => {
  assert.deepEqual([...SLA_ITEM_KINDS], ["individual_question", "custom_order", "refund", "dispute"]);
  assert.equal(slaItemHref("individual_question", "q1"), "/admin/individual-questions/q1");
  assert.equal(slaItemHref("custom_order", "o1"), "/admin/custom-request-orders?q=o1");
  assert.equal(slaItemHref("refund", "r1"), "/admin/refunds/r1");
  assert.equal(slaItemHref("dispute", "d1"), "/admin/disputes/d1");
  for (const rel of ["individual-questions/[id]", "custom-request-orders", "refunds/[id]", "disputes/[id]"]) {
    assert.ok(existsSync(join(ROOT, "app", "(admin)", "admin", "(console)", rel, "page.tsx")), `라우트 존재: ${rel}`);
  }
  assert.deepEqual(Object.values(SLA_ITEM_KIND_LABELS), ["개별질문", "맞춤의뢰", "환불", "분쟁"]);
  assert.equal(slaMentorActivityHref("김멘토"), "/admin/mentor-activity?q=%EA%B9%80%EB%A9%98%ED%86%A0");
  assert.equal(slaMentorActivityHref("  "), "/admin/mentor-activity");
});

test("상태 배지 사전 키: 4종 테이블의 status 가 상태 사전에 등재돼 있다(AdminStatusPill 로 그린다)", () => {
  assert.deepEqual(SLA_ITEM_STATUS_TABLE, { individual_question: "individual_questions", custom_order: "custom_request_orders", refund: "refunds", dispute: "disputes" });
  for (const table of Object.values(SLA_ITEM_STATUS_TABLE)) assert.ok(adminStatusAllowedValues(table, "status").length > 0, table);
  const page = stripComments(read(PAGE));
  assert.ok(page.includes('<AdminStatusPill table={SLA_ITEM_STATUS_TABLE[it.kind]} column="status" value={it.status} size="sm" />'));
});

// ── ③ 기준값 불변 · 종류별 판정은 정본 재사용 ────────────────────────────────

test("기준값 변경 없음: 환불 5일 · 분쟁 24h/48h · 개별질문 답변 대기 집합 · 멘토 중단 환불만 추적", () => {
  assert.equal(REFUND_SLA_DAYS, 5);
  assert.equal(DISPUTE_ELAPSED_WARNING_HOURS, 24);
  assert.equal(DISPUTE_ELAPSED_DANGER_HOURS, 48);
  assert.equal(SLA_REFUND_REQUEST_TYPE, "subscription_mentor_suspended");
  assert.equal(isSlaTrackedRequestType(SLA_REFUND_REQUEST_TYPE), true);
  assert.deepEqual([...SLA_INDIVIDUAL_QUESTION_STATUSES], [...INDIVIDUAL_AWAITING_STATUSES]);
  assert.deepEqual([...SLA_DISPUTE_STATUSES], ["open", "under_review", "escalated"]);
  const server = stripComments(read(SERVER));
  assert.ok(server.includes('.eq("request_type", SLA_REFUND_REQUEST_TYPE)'));
  assert.ok(server.includes('.in("status", [...SLA_DISPUTE_STATUSES])') && server.includes('.in("status", [...SLA_INDIVIDUAL_QUESTION_STATUSES])'));
  assert.ok(server.includes("MENTOR_DEADLINE_IMMINENT_DAYS, now)"), "주문 D-day 임박 기준은 멘토 대시보드 상수");
  assert.ok(server.includes("isOrderStatusTerminal(normalizedPrimaryOrderStatus(row))") && server.includes("mentorOrderDeadlineDisplay(row)"));
  assert.ok(!/\.(insert|update|upsert|delete|rpc)\(/.test(server), "조회 전용");
  assert.ok(server.includes("sortSlaItems("), "남은 기간 짧은 순");
});

test("환불 판정 = refundSlaInfo: 4일 경과 → soon(1일 남음) · 6일 경과 → over(1일 초과) · 처리됨 → 기한 없음", () => {
  const soon = slaRefundJudgement(at(-4 * DAY), "pending", NOW);
  assert.equal(soon.tone, "soon");
  assert.equal(soon.label, "1일 남음");
  assert.equal(soon.deadlineAt, at(DAY));
  const over = slaRefundJudgement(at(-6 * DAY), "pending", NOW);
  assert.equal(over.tone, "over");
  assert.equal(over.label, "1일 초과");
  assert.equal(slaRefundJudgement(at(-10 * DAY), "succeeded", NOW).deadlineAt, null);
  assert.equal(slaRefundJudgement(null, "pending", NOW).remainingMs, null);
});

test("분쟁 판정 = disputeElapsed 톤 + 기한(접수 + 24h): 2h 경과 → ok(22시간 남음) · 30h → soon(6시간 초과) · 50h → over · 종결 → 없음", () => {
  const ok = slaDisputeJudgement(at(-2 * HOUR), "open", NOW);
  assert.equal(ok.tone, "ok");
  assert.equal(ok.label, "22시간 남음");
  assert.equal(ok.deadlineAt, at(22 * HOUR));
  const soon = slaDisputeJudgement(at(-30 * HOUR), "under_review", NOW);
  assert.equal(soon.tone, "soon");
  assert.equal(soon.label, "6시간 초과");
  assert.equal(slaDisputeJudgement(at(-50 * HOUR), "escalated", NOW).tone, "over");
  assert.equal(slaDisputeJudgement(at(-50 * HOUR), "resolved", NOW).deadlineAt, null);
});

test("개별질문 판정 = expires_at + isIndividualQuestionExpiringSoon(12h): 3h 남음 → soon · 20h → ok · 지남 → over · 없음 → 없음", () => {
  const soon = slaIndividualQuestionJudgement(at(3 * HOUR), "claimed", NOW);
  assert.equal(soon.tone, "soon");
  assert.equal(soon.label, "3시간 남음");
  assert.equal(slaIndividualQuestionJudgement(at(20 * HOUR), "open", NOW).tone, "ok");
  const over = slaIndividualQuestionJudgement(at(-90 * 60_000), "assigned", NOW);
  assert.equal(over.tone, "over");
  assert.equal(over.label, "1시간 30분 초과");
  assert.equal(slaIndividualQuestionJudgement(null, "open", NOW).remainingMs, null);
});

test("맞춤의뢰 주문 판정 = 달력일 차(mentorOrderDeadlineDisplay) + MENTOR_DEADLINE_IMMINENT_DAYS: -1 → over · 3(≤7) → soon · 10 → ok · 없음 → 없음", () => {
  assert.equal(slaCustomOrderJudgement(at(-DAY), -1, 7, NOW).tone, "over");
  assert.equal(slaCustomOrderJudgement(at(3 * DAY), 3, 7, NOW).tone, "soon");
  assert.equal(slaCustomOrderJudgement(at(10 * DAY), 10, 7, NOW).tone, "ok");
  assert.equal(slaCustomOrderJudgement(at(10 * DAY), null, 7, NOW).deadlineAt, null);
  assert.equal(slaCustomOrderJudgement(null, 3, 7, NOW).deadlineAt, null);
});

test("남은 기간 표기 · 정렬(초과 → 임박 → 여유 · 기한 없음은 뒤 · 상한) · 요약 · 톤 클래스는 환불 SLA 와 같다", () => {
  assert.equal(formatSlaRemaining(90 * 60_000), "1시간 30분 남음");
  assert.equal(formatSlaRemaining(-(2 * DAY + HOUR)), "2일 1시간 초과");
  assert.equal(formatSlaRemaining(30_000), "1분 남음");
  assert.equal(formatSlaRemaining(3 * DAY), "3일 남음");
  assert.equal(formatSlaRemaining(null), "—");
  const a = item({ id: "a", remainingMs: 5 * HOUR, tone: "soon" });
  const b = item({ id: "b", remainingMs: -HOUR, tone: "over", kind: "dispute" });
  const c = item({ id: "c", remainingMs: null });
  const d = item({ id: "d", remainingMs: 3 * DAY });
  assert.deepEqual([c, d, a, b].sort(compareSlaItems).map((i) => i.id), ["b", "a", "d", "c"]);
  assert.deepEqual(sortSlaItems([c, d, a, b], 2).map((i) => i.id), ["b", "a"]);
  assert.equal(SLA_ITEM_ROW_LIMIT, 50);
  assert.deepEqual(countSlaTones([a, b, c, d]), { ok: 2, soon: 1, over: 1 });
  assert.equal(formatSlaSummary([a, b, c, d]), "초과 1 · 임박 1 · 전체 4");
  assert.equal(slaToneClass("over"), refundSlaToneClass("over"));
  assert.equal(slaTitleFromBody("  납품이   너무 늦어요  ", "분쟁"), "납품이 너무 늦어요");
  assert.equal(slaTitleFromBody("", "분쟁"), "분쟁");
  assert.equal(slaTitleFromBody("가".repeat(50), "분쟁", 40), `${"가".repeat(40)}…`);
});

// ── ④ 화면 ───────────────────────────────────────────────────────────────────

test("정의 설명 문단 없음(오너 지시) — `기준` 섹션·`목표입니다`·`이내 처리` 문구 없음 · PageScaffold 없음 · AdminPageLayout · KPI 3 · loading.tsx", () => {
  const page = stripComments(read(PAGE));
  assert.ok(!page.includes("PageScaffold") && page.includes("<AdminPageLayout"));
  for (const phrase of ["목표입니다", "이내 처리", "임박, 0일", "초과로 강조", 'title="기준"']) assert.ok(!page.includes(phrase), `정의 문단 문구 없음: ${phrase}`);
  assert.ok(!page.includes("sections="), "PageScaffold 안내 카드 prop 없음");
  assert.equal((page.match(/uppercase text-slate-500/g) ?? []).length, 3, "KPI 3개 유지");
  assert.ok(existsSync(join(ROOT, LOADING)));
});

test("빈 상태 `기한이 임박한 항목이 없습니다` · 행: 항목 링크 + → 링크 · 멘토 이름 → 멘토 활동 · 멘토 활동의 미답변 수 → SLA", () => {
  assert.equal(SLA_EMPTY_STATE.title, "기한이 임박한 항목이 없습니다");
  const page = stripComments(read(PAGE));
  assert.ok(page.includes("<EmptyState title={SLA_EMPTY_STATE.title}"));
  assert.ok(page.includes("<Link href={it.href}") && page.includes('aria-label="상세로 이동"'));
  assert.ok(page.includes("<Link href={slaMentorActivityHref(it.mentorName)}"));
  assert.ok(page.includes("SLA_ITEM_KIND_LABELS[it.kind]") && page.includes("slaToneClass(it.tone)"));
  const list = stripComments(read(MENTOR_ACTIVITY_LIST));
  assert.equal(SLA_BASE_PATH, "/admin/sla");
  assert.ok(list.includes("<Link href={SLA_BASE_PATH}"), "멘토 활동 미답변 수 → SLA");
});

test("순수 모듈은 React·@/ import 없음 · UI 카피 금지어 없음", () => {
  const pure = stripComments(read(CONSOLE));
  assert.ok(!/from "react"|from "@\//.test(pure));
  for (const rel of [PAGE, LOADING, SERVER, CONSOLE]) {
    const code = stripComments(read(rel));
    for (const banned of ["선생님", "강사님", "수강생", "과외", "커패니티", "웰버십", "쌤버쉽", "alert("]) {
      assert.ok(!code.includes(banned), `${rel}: 금지 문구 ${banned}`);
    }
  }
});
