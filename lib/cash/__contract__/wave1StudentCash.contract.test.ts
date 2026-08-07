import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Wave1 L6 학생핵심 — 캐시/지갑 결함 회귀 방지(소스 스캔 tripwire).
const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

test("D-ST-13: 원장 기간 필터를 뷰 쿼리에 created_at gte/lte 로 내리고 250행 캡을 제거한다", () => {
  const q = read("lib/cash/cashQueries.ts");
  assert.ok(q.includes("fetchCashLedgerWindow"), "윈도우 로더가 없음");
  assert.ok(q.includes('.gte("created_at"') && q.includes('.lte("created_at"'), "created_at gte/lte 미적용");
  const r = read("lib/cash/walletRouteData.ts");
  assert.ok(!r.includes("fetchCashLedgerForUser(supabase, userId, 250)"), "구 250행 캡 잔존");
  assert.ok(r.includes("truncated"), "잘림 표면화(truncated) 없음");
  const body = read("components/cash/WalletLedgerPageBody.tsx");
  assert.ok(body.includes("data.filter.truncated"), "UI 가 잘림을 표시하지 않음");
});

test("D-ST-15: 지갑 로더는 미사용 cash_topup_packages 를 조회하지 않는다", () => {
  const r = read("lib/cash/walletRouteData.ts");
  assert.ok(!r.includes("fetchCashTopupPackages"), "미사용 packages 조회가 잔존함");
});

test("D-ST-14: 충전 실패 화면은 Toss 원문(message)이 아니라 code allowlist 고정 문구를 쓴다", () => {
  const page = read("app/(student)/wallet/charge/fail/page.tsx");
  assert.ok(page.includes("mapTossErrorCode") && page.includes("userMessageForConfirmCode"), "code allowlist 매핑 미사용");
  assert.ok(!page.includes('one(sp, "message")'), "쿼리스트링 message 원문을 여전히 사용함");
  const client = read("components/cash/WalletChargeFailClient.tsx");
  assert.ok(!client.includes("props.code"), "실패 화면이 원시 code 를 노출함");
});
