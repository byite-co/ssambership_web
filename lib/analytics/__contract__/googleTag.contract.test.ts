import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  GOOGLE_ADS_TAG_ID,
  GTAG_SCRIPT_SRC,
  googleTagInitScript,
  shouldLoadGoogleTag,
} from "../googleTag.ts";

// ─────────────────────────────────────────────────────────────────────────────
// Google Ads 기본 태그 계약 회귀 감시
//
// 배경 — Ads 캠페인 진단 "웹사이트에 Google 태그 설치":
//   Ads 콘솔은 ssambership.com 모든 페이지에서 gtag.js(AW-18397050128)를 찾는다.
//   태그 ID 오타·루트 레이아웃에서의 이탈·프리뷰 환경 로드 셋 중 하나라도 무너지면
//   전환 측정이 조용히 끊기거나 테스트 트래픽이 섞이므로 소스 텍스트로 상시 감시한다.
//
// 실행: node --test --experimental-strip-types "lib/**/__contract__/*.contract.test.ts"
//   → next 타입에 의존하는 app/layout.tsx · components/analytics/GoogleTag.tsx 는
//     import 하지 않고 소스 텍스트로 정적 검증한다.
// ─────────────────────────────────────────────────────────────────────────────

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const LAYOUT_PATH = join(REPO_ROOT, "app", "layout.tsx");
const COMPONENT_PATH = join(REPO_ROOT, "components", "analytics", "GoogleTag.tsx");

function withEnv<T>(patch: Record<string, string | undefined>, fn: () => T): T {
  const saved: Record<string, string | undefined> = {};
  for (const key of Object.keys(patch)) {
    saved[key] = process.env[key];
    if (patch[key] === undefined) delete process.env[key];
    else process.env[key] = patch[key];
  }
  try {
    return fn();
  } finally {
    for (const key of Object.keys(patch)) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
}

test("1. 태그 ID 는 Google Ads 계정 형식(AW-숫자)이며 로더 URL 에 그대로 실린다", () => {
  assert.match(GOOGLE_ADS_TAG_ID, /^AW-\d{9,}$/);
  assert.equal(GTAG_SCRIPT_SRC, `https://www.googletagmanager.com/gtag/js?id=${GOOGLE_ADS_TAG_ID}`);
});

test("2. 초기화 스크립트는 Ads 콘솔 스니펫과 같은 순서로 config 까지 도달한다", () => {
  const script = googleTagInitScript();
  const order = [
    "window.dataLayer = window.dataLayer || [];",
    "function gtag(){dataLayer.push(arguments);}",
    "gtag('js', new Date());",
    `gtag('config', '${GOOGLE_ADS_TAG_ID}');`,
  ];
  let cursor = -1;
  for (const line of order) {
    const idx = script.indexOf(line, cursor + 1);
    assert.ok(idx > cursor, `순서 이탈 또는 누락: ${line}`);
    cursor = idx;
  }
});

test("3. 로드 게이트 — Vercel Production 에서만 true, 프리뷰·로컬·미설정은 false", () => {
  assert.equal(withEnv({ VERCEL_ENV: "production" }, () => shouldLoadGoogleTag()), true);
  assert.equal(withEnv({ VERCEL_ENV: "preview" }, () => shouldLoadGoogleTag()), false);
  assert.equal(withEnv({ VERCEL_ENV: "development" }, () => shouldLoadGoogleTag()), false);
  assert.equal(withEnv({ VERCEL_ENV: undefined }, () => shouldLoadGoogleTag()), false);
  // 주입 env 로도 같은 판정 — NODE_ENV=production 만으로는 로드하지 않는다(프리뷰 빌드도 production 이다).
  assert.equal(shouldLoadGoogleTag({ NODE_ENV: "production" } as NodeJS.ProcessEnv), false);
});

test("4. 루트 레이아웃이 GoogleTag 를 렌더하고, 컴포넌트는 정본 모듈만 참조한다", () => {
  const layout = readFileSync(LAYOUT_PATH, "utf8");
  assert.match(layout, /from "@\/components\/analytics\/GoogleTag"/, "루트 레이아웃 import 이탈");
  assert.match(layout, /<GoogleTag \/>/, "루트 레이아웃 렌더 이탈");

  const component = readFileSync(COMPONENT_PATH, "utf8");
  assert.match(component, /from "@\/lib\/analytics\/googleTag"/, "정본 모듈 참조 이탈");
  assert.match(component, /shouldLoadGoogleTag\(\)/, "로드 게이트 호출 이탈");
  assert.doesNotMatch(component, /AW-\d+/, "태그 ID 하드코딩 중복 — 정본은 lib/analytics/googleTag.ts");
});
