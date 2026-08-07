// 계약 테스트: 분쟁 제재 라이프사이클(D-AD-6·D-AD-2) + legacy 댓글 판정 fail-closed(D-AD-4).
// 실행: node --test --experimental-strip-types lib/admin/__contract__/disputeSanctionLifecycle.contract.test.ts
//
// 대상이 "use server" 액션·"server-only" 모듈이라 node --test 로 직접 import 할 수 없어
// 소스 스캔 tripwire 로 고정한다(tossConfirmWiring 과 같은 방식).
//
// 여기서 고정하는 것:
//   ① D-AD-6(순서): 분쟁 행 선점(게이트 UPDATE)이 계정 제재(applyAccountStatus)보다 먼저다.
//      실패 시 분쟁 행을 이전 상태로 되돌리는 보상 UPDATE 가 존재한다.
//   ② D-AD-6(원문): redirect URL 에 DB/내부 오류 원문을 싣지 않는다(고정 한국어 문구만).
//   ③ D-AD-2(출구): sanction_7d/30d 는 전이 가능 상태 — 단건 제재·resolve/dismiss·bulk
//      게이트 모두에 포함. 종말 상태는 resolved/dismissed/sanction_permanent 3종뿐.
//   ④ D-AD-4: resolveLegacyCommentTargetType 의 service role 생성이 try 로 보호되고
//      실패 시 null(수동 검토)로 강등 — 호출부(adminReportEvidence)는 null 을 unsupported 로 흡수.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

const SANCTION_SRC = read("lib/admin/adminDisputeSanctionActions.ts");
const DISPUTE_ACTIONS_SRC = read("lib/admin/adminDisputeActions.ts");
const BULK_SRC = read("lib/admin/bulkActions.ts");
const MODERATION_CORE_SRC = read("lib/admin/communityModerationCore.ts");
const EVIDENCE_SRC = read("lib/admin/adminReportEvidence.ts");

function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

test("D-AD-2: SANCTIONABLE_STATUSES 는 sanction_7d/30d 포함 · 종말 3종 제외", () => {
  const m = SANCTION_SRC.match(/const SANCTIONABLE_STATUSES = \[([\s\S]*?)\] as const;/);
  assert.ok(m, "SANCTIONABLE_STATUSES 정의가 없음");
  const block = m[1];
  for (const s of ["open", "under_review", "escalated", "on_hold", "sanction_7d", "sanction_30d"]) {
    assert.ok(block.includes(`"${s}"`), `전이 가능 상태 ${s} 가 게이트에서 빠짐(출구 없는 종말 상태)`);
  }
  for (const s of ["resolved", "dismissed", "sanction_permanent"]) {
    assert.ok(!block.includes(`"${s}"`), `종말 상태 ${s} 가 게이트에 들어감(종결 건 덮어쓰기)`);
  }
});

test("D-AD-6: 분쟁 행 선점(게이트 UPDATE)이 applyAccountStatus 보다 먼저 실행된다", () => {
  const claimIdx = SANCTION_SRC.indexOf('.in("status", [...SANCTIONABLE_STATUSES])');
  const accountIdx = SANCTION_SRC.indexOf("await applyAccountStatus(");
  assert.ok(claimIdx > 0, "게이트 UPDATE(.in SANCTIONABLE_STATUSES)가 사라짐");
  assert.ok(accountIdx > 0, "applyAccountStatus 호출이 사라짐");
  assert.ok(claimIdx < accountIdx, "계정 제재가 분쟁 행 선점보다 앞섬 — 종결 분쟁 계정만 정지 회귀");
});

test("D-AD-6: 계정 반영 실패 시 분쟁 행 보상 복원 + 이후 감사 로그가 배선돼 있다", () => {
  // 보상: 이전 상태(prevStatus)로 되돌리는 UPDATE 가 존재해야 한다.
  assert.ok(SANCTION_SRC.includes("restorePatch"), "보상 복원 UPDATE 가 사라짐");
  assert.ok(SANCTION_SRC.includes("prevStatus"), "이전 상태 보존(prevStatus)이 사라짐");
  // 성공 경로 감사 로그 정본.
  const accountIdx = SANCTION_SRC.indexOf("await applyAccountStatus(");
  const logIdx = SANCTION_SRC.indexOf("await logAdminAction(");
  assert.ok(logIdx > accountIdx, "logAdminAction 이 계정 반영보다 앞서거나 사라짐");
});

test("D-AD-6/D-AD-3: redirect URL 에 오류 원문을 싣지 않는다(고정 문구만)", () => {
  assert.ok(!SANCTION_SRC.includes("res.error"), "redirect 문구에 res.error 원문 삽입이 부활함");
  // errUrl 호출은 전부 고정 문자열 — 템플릿 보간 호출이 없어야 한다.
  assert.equal(count(SANCTION_SRC, "errUrl(`"), 0, "errUrl 템플릿 보간(원문 노출 가능)이 생김");
});

test("D-AD-2: 단건 resolve/dismiss 게이트에 sanction_7d/30d 가 포함된다", () => {
  // resolveDisputeAction · dismissDisputeAction 두 곳(정의부 제외 최소 2회).
  assert.ok(count(DISPUTE_ACTIONS_SRC, '"sanction_7d"') >= 2, "resolve/dismiss 게이트에서 sanction_7d 빠짐");
  assert.ok(count(DISPUTE_ACTIONS_SRC, '"sanction_30d"') >= 2, "resolve/dismiss 게이트에서 sanction_30d 빠짐");
});

test("D-AD-2: bulk 분쟁 게이트에 sanction_7d/30d 가 포함된다", () => {
  assert.ok(
    BULK_SRC.includes('.in("status", ["open", "under_review", "escalated", "sanction_7d", "sanction_30d"])'),
    "bulk 게이트가 sanction_7d/30d 를 제외함(출구 없는 종말 상태 회귀)"
  );
});

test("D-AD-4: resolveLegacyCommentTargetType 은 service role 생성 실패를 null 로 강등한다", () => {
  const start = MODERATION_CORE_SRC.indexOf("export async function resolveLegacyCommentTargetType");
  assert.ok(start > 0, "resolveLegacyCommentTargetType 이 없음");
  const rest = MODERATION_CORE_SRC.slice(start);
  const end = rest.indexOf("\nexport ", 1);
  const body = end > 0 ? rest.slice(0, end) : rest;

  const tryIdx = body.indexOf("try {");
  const clientIdx = body.indexOf("createServiceRoleClient()");
  assert.ok(clientIdx > 0, "service role 클라이언트 호출이 없음");
  assert.ok(tryIdx > 0 && tryIdx < clientIdx, "createServiceRoleClient 가 try 밖(키 부재 시 500)");
  assert.ok(/catch\s*\{\s*return null;/.test(body), "catch → null(수동 검토) 강등이 사라짐");
});

test("D-AD-4: 호출부(adminReportEvidence)는 null 판정을 unsupported 로 흡수한다", () => {
  const resolveIdx = EVIDENCE_SRC.indexOf("await resolveLegacyCommentTargetType(");
  const guardIdx = EVIDENCE_SRC.indexOf('if (!targetType) return { kind: "unsupported" };');
  assert.ok(resolveIdx > 0, "legacy comment 판정 배선이 사라짐");
  assert.ok(guardIdx > resolveIdx, "null 판정 → unsupported 강등 가드가 사라짐(상세 페이지 500 위험)");
});
