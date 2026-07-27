import test from "node:test";
import assert from "node:assert/strict";
import {
  APP_BRIDGE_COMPLETE_PATH,
  APP_BRIDGE_ERROR_PATH,
  APP_SHORTFORM_COMPOSE_PATH,
  appBridgeCompletePath,
  appBridgeErrorPath,
  isAppBridgeErrorCode,
  isAppBridgeKind,
  isAppBridgeResult,
} from "../appSurfacePaths.ts";

test("앱 표면 경로 상수 — 전부 /app/ 하위(무크롬·allowlist 대상)", () => {
  for (const p of [APP_SHORTFORM_COMPOSE_PATH, APP_BRIDGE_COMPLETE_PATH, APP_BRIDGE_ERROR_PATH]) {
    assert.ok(p.startsWith("/app/"), p);
  }
});

test("완료 브릿지 kind/result 는 서버 enum 으로 제한", () => {
  assert.equal(isAppBridgeKind("shortform"), true);
  assert.equal(isAppBridgeKind("payment"), false);
  assert.equal(isAppBridgeResult("draft"), true);
  assert.equal(isAppBridgeResult("published"), true);
  assert.equal(isAppBridgeResult("cancel"), false);
  assert.equal(isAppBridgeResult("PUBLISHED"), false);

  assert.equal(appBridgeCompletePath("shortform", "draft"), "/app/bridge/complete?kind=shortform&result=draft");
  assert.equal(
    appBridgeCompletePath("shortform", "published"),
    "/app/bridge/complete?kind=shortform&result=published",
  );
});

test("오류 code enum — 미지 코드는 타입상 조합 불가, 판별자는 미지값 거부", () => {
  for (const c of ["session_expired", "mentor_only", "account_blocked", "bootstrap_failed", "invalid_request"]) {
    assert.equal(isAppBridgeErrorCode(c), true, c);
  }
  assert.equal(isAppBridgeErrorCode("weird"), false);
  assert.equal(appBridgeErrorPath("mentor_only"), "/app/bridge/error?code=mentor_only");
});
