import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// D-DB-2 / D-ST-10 회귀 감시:
// 공개 멘토 읽기(mentorPublicRead)는 반드시 api_web_v1.mentor_directory_v1 view 만 경유해야 한다.
// view 의 WHERE 가 승인·활성·비삭제 멘토만 노출하는 유일한 실차단이므로, 누군가 raw
// mentor_profiles 테이블 직접 조회로 되돌리면 미승인/비활성 멘토가 새어나온다. 이 테스트는
// 원본 소스에 대한 정적 계약으로 그 회귀를 막는다(SECURITY DEFINER view 정의 변경은 DB 측
// 스냅샷이, 웹의 view 이탈은 이 테스트가 감시).

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "..", "mentorPublicRead.ts"), "utf8");

test("mentorPublicRead 는 mentor_directory_v1 view 만 읽는다", () => {
  assert.match(src, /\.schema\(API_WEB_V1_SCHEMA\)\.from\("mentor_directory_v1"\)/, "directoryView 가 V3 view 를 참조해야 한다");
});

test("mentorPublicRead 는 raw mentor_profiles 테이블을 직접 조회하지 않는다", () => {
  // 주석/문서 문자열이 아닌 실제 코드에서 .from("mentor_profiles") 호출이 없어야 한다.
  assert.doesNotMatch(src, /\.from\(\s*["']mentor_profiles["']\s*\)/, "raw mentor_profiles 직접 조회 금지");
});

test("verification_status 상수 채움에 view 불변식 계약 주석이 남아 있다", () => {
  // D-ST-10: 상수가 '독립 심사'로 오인되지 않도록 계약 주석을 요구한다.
  assert.match(src, /view 불변식의 반영/, "verification_status 상수의 계약 주석 유지");
});
