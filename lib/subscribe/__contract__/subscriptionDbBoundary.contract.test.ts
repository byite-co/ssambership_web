import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = (name: string) => readFileSync(new URL(`../${name}`, import.meta.url), "utf8");

// Architecture gate; transactional behavior is tested with real DB failure triggers in CI.
test("renewal orchestration cannot decide a debit amount or write financial tables", () => {
  const batch = source("subscriptionRenewalBatch.ts");
  assert.doesNotMatch(batch, /fetchPlansForMentor|resolveRenewalAmountCents|p_amount_cents|recommendedPrice/i);
  assert.doesNotMatch(batch, /\.(insert|upsert|update|delete)\s*\(/);
  assert.match(batch, /rpc\("process_subscription_renewal_v2"/);
  assert.match(batch, /rpc\("claim_subscription_renewal_batch"/);
  assert.match(batch, /rpc\("record_subscription_renewal_notice"/);
  assert.match(batch, /rpc\("finalize_subscription_terminal_transition"/);
});

test("checkout must include billing in the DB transaction", () => {
  const checkout = source("subscribeCheckoutService.ts");
  assert.match(checkout, /callApiWebV1Rpc\([\s\S]*?"subscription_checkout_confirm_v3"/);
  assert.doesNotMatch(checkout, /recordInitialSubscriptionBillingEvent|\.from\("subscription_billing_events"\)/);
});
