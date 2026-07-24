import test from "node:test";
import assert from "node:assert/strict";
import {
  APP_SESSION_BOOTSTRAP_MAX_BODY_BYTES,
  APP_SESSION_BOOTSTRAP_TARGETS,
  bootstrapBodyKindForContentType,
  bootstrapProjectRefMatches,
  isAppSessionBootstrapTarget,
  jwtProjectRef,
  parseBootstrapBody,
  supabaseProjectRefFromUrl,
} from "../appSessionBootstrapCore.ts";
import { APP_SHORTFORM_COMPOSE_PATH } from "../appSurfacePaths.ts";

const STAGING_REF = "lbeqxarxothkmzqvpudy";
const STAGING_URL = `https://${STAGING_REF}.supabase.co`;

function fakeJwt(payload: Record<string, unknown>): string {
  const b64 = (obj: Record<string, unknown>) => Buffer.from(JSON.stringify(obj)).toString("base64url");
  return `${b64({ alg: "HS256", typ: "JWT" })}.${b64(payload)}.sig`;
}

const GOOD_JWT = fakeJwt({ iss: `${STAGING_URL}/auth/v1`, sub: "user-1" });

function formBody(fields: Record<string, string>): string {
  return new URLSearchParams(fields).toString();
}

test("Content-Type allowlist: form-urlencoded(+charset)·json 만 허용, 그 외 거부", () => {
  assert.equal(bootstrapBodyKindForContentType("application/x-www-form-urlencoded"), "form");
  assert.equal(bootstrapBodyKindForContentType("application/x-www-form-urlencoded; charset=utf-8"), "form");
  assert.equal(bootstrapBodyKindForContentType("Application/JSON"), "json");
  assert.equal(bootstrapBodyKindForContentType("multipart/form-data; boundary=x"), null);
  assert.equal(bootstrapBodyKindForContentType("text/plain"), null);
  assert.equal(bootstrapBodyKindForContentType(null), null);
  assert.equal(bootstrapBodyKindForContentType(""), null);
});

test("form-urlencoded 본문 파싱(Android WebView postUrl 기본 경로) — percent-encoding 복원", () => {
  const body = formBody({
    access_token: GOOD_JWT,
    refresh_token: "r+t/with=special&chars",
    target: "shortform_create",
  });
  const r = parseBootstrapBody("application/x-www-form-urlencoded", body);
  assert.ok(r.ok);
  assert.equal(r.accessToken, GOOD_JWT);
  assert.equal(r.refreshToken, "r+t/with=special&chars");
  assert.equal(r.target, "shortform_create");
});

test("JSON 본문도 허용(JSON 단독 제한 금지 요건의 역방향 — 병행 허용)", () => {
  const r = parseBootstrapBody(
    "application/json",
    JSON.stringify({ access_token: GOOD_JWT, refresh_token: "rt", target: "shortform_create" }),
  );
  assert.ok(r.ok);
  assert.equal(r.target, "shortform_create");
});

test("필수 필드 누락 → missing_fields", () => {
  const r = parseBootstrapBody(
    "application/x-www-form-urlencoded",
    formBody({ access_token: GOOD_JWT, target: "shortform_create" }),
  );
  assert.deepEqual(r, { ok: false, error: "missing_fields" });
});

test("invalid target 거부 — 결제·임의 target 은 enum 에 없다", () => {
  for (const bad of ["wallet_charge", "subscribe", "shortform_create2", "SHORTFORM_CREATE", "../evil"]) {
    const r = parseBootstrapBody(
      "application/x-www-form-urlencoded",
      formBody({ access_token: GOOD_JWT, refresh_token: "rt", target: bad }),
    );
    assert.deepEqual(r, { ok: false, error: "invalid_target" }, `target=${bad}`);
  }
  assert.equal(isAppSessionBootstrapTarget("shortform_create"), true);
  assert.equal(isAppSessionBootstrapTarget("hasOwnProperty"), false);
});

test("target enum 은 단일(shortform_create)이고 redirect 는 앱 표면 상수 경로", () => {
  assert.deepEqual(Object.keys(APP_SESSION_BOOTSTRAP_TARGETS), ["shortform_create"]);
  assert.equal(APP_SESSION_BOOTSTRAP_TARGETS.shortform_create, "/app/community/shortform/new");
  // 리터럴 이중화 회귀 방지: appSurfacePaths 정본과 반드시 동일해야 한다.
  assert.equal(APP_SESSION_BOOTSTRAP_TARGETS.shortform_create, APP_SHORTFORM_COMPOSE_PATH);
});

test("본문 크기 상한 초과 → body_too_large(413 크래시 대신 안전 종료)", () => {
  const huge = formBody({
    access_token: "a".repeat(APP_SESSION_BOOTSTRAP_MAX_BODY_BYTES + 1),
    refresh_token: "rt",
    target: "shortform_create",
  });
  const r = parseBootstrapBody("application/x-www-form-urlencoded", huge);
  assert.deepEqual(r, { ok: false, error: "body_too_large" });
});

test("깨진 JSON → malformed(스택·입력 반사 없음)", () => {
  const r = parseBootstrapBody("application/json", "{not json");
  assert.deepEqual(r, { ok: false, error: "malformed" });
  const r2 = parseBootstrapBody("application/json", JSON.stringify(["array"]));
  assert.deepEqual(r2, { ok: false, error: "malformed" });
});

test("프로젝트 ref 추출: URL·JWT iss·ref claim", () => {
  assert.equal(supabaseProjectRefFromUrl(STAGING_URL), STAGING_REF);
  assert.equal(supabaseProjectRefFromUrl("not a url"), null);
  assert.equal(supabaseProjectRefFromUrl(""), null);
  assert.equal(jwtProjectRef(GOOD_JWT), STAGING_REF);
  assert.equal(jwtProjectRef(fakeJwt({ ref: STAGING_REF })), STAGING_REF);
  assert.equal(jwtProjectRef("not.a"), null);
  assert.equal(jwtProjectRef(""), null);
});

test("project mismatch 거부 — 타 프로젝트 토큰 이식 차단", () => {
  assert.equal(bootstrapProjectRefMatches(GOOD_JWT, STAGING_URL), true);
  const otherJwt = fakeJwt({ iss: "https://otherproject.supabase.co/auth/v1" });
  assert.equal(bootstrapProjectRefMatches(otherJwt, STAGING_URL), false);
  assert.equal(bootstrapProjectRefMatches(GOOD_JWT, "https://other.supabase.co"), false);
  // 비교 불능(ref 미추출)은 항상 거부.
  assert.equal(bootstrapProjectRefMatches("garbage", STAGING_URL), false);
  assert.equal(bootstrapProjectRefMatches(GOOD_JWT, ""), false);
});
