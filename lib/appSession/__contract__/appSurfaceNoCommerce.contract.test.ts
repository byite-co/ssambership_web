import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// 앱 WebView 표면(app/app/**) 소스 회귀 방지 스캔:
// - 결제·구독·충전 링크/문구 0 (Commerce-Zero 표면 계약)
// - AppShell(전역 헤더/네비/푸터) 미사용
// 문자열 스캔은 tripwire 다 — 정상 사용처가 생기면 계약을 재검토하고 갱신할 것.

const APP_SURFACE_DIR = fileURLToPath(new URL("../../../app/app", import.meta.url));

const FORBIDDEN_SUBSTRINGS = [
  "/subscribe",
  "/wallet",
  "tosspayments",
  "Toss",
  "BillingClient",
  "in_app_purchase",
  "구독하기",
  "충전하기",
  "결제",
  "AppShell",
  "SiteFooter",
];

function collectFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...collectFiles(p));
    else out.push(p);
  }
  return out;
}

test("앱 표면 파일 존재(작성·완료 브릿지·오류 브릿지)", () => {
  const files = collectFiles(APP_SURFACE_DIR);
  const rel = files.map((f) => f.slice(APP_SURFACE_DIR.length));
  assert.ok(rel.some((f) => f.includes("community/shortform/new")), "compose page");
  assert.ok(rel.some((f) => f.includes("bridge/complete")), "complete bridge");
  assert.ok(rel.some((f) => f.includes("bridge/error")), "error bridge");
});

test("앱 표면 소스에 결제·구독·충전·전역 셸 참조 0", () => {
  for (const file of collectFiles(APP_SURFACE_DIR)) {
    const text = readFileSync(file, "utf8");
    for (const bad of FORBIDDEN_SUBSTRINGS) {
      assert.ok(!text.includes(bad), `${file} 에 금지 문자열 '${bad}' 존재`);
    }
  }
});

test("숏폼 작성 폼: video picker 는 name 없이 렌더(File 폼 제출 구조 차단) + 파일명 중복 출력 제거", () => {
  const composeForm = readFileSync(
    fileURLToPath(new URL("../../../components/community/CommunityShortformComposeForm.tsx", import.meta.url)),
    "utf8",
  );
  // 구조 차단 회귀 방지: video picker 에 name 지정 금지.
  assert.ok(!composeForm.includes('name="video-picker"'), "video picker 에 name 이 다시 지정됨");
  // 파일명 2줄 출력 회귀 방지: 부모의 videoFile.name 별도 출력 금지(Dropzone 내부 label 이 정본).
  assert.ok(!composeForm.includes("videoFile.name"), "videoFile.name 중복 출력이 부활함");
  // intent 는 hidden input 으로 캡처되고, 재제출은 submitter 전달에 의존하지 않는다.
  assert.ok(composeForm.includes('name="intent"'), "intent hidden input 부재");
  assert.ok(composeForm.includes("requestSubmit()"), "submitter 없는 requestSubmit 재제출 부재");
  assert.ok(!composeForm.includes("requestSubmit(submitter"), "disabled submitter 의존 재제출이 부활함");
});
