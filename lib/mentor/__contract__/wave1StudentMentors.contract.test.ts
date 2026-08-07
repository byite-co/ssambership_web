import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Wave1 L6 학생핵심 — 멘토찾기 결함 회귀 방지(소스 스캔 tripwire).
const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

test("D-ST-8: 디렉터리는 전량 range 순회한다(200행 인메모리 캡 제거)", () => {
  const q = read("lib/mentor/publicMentorsListQueries.ts");
  assert.ok(q.includes("fetchAllDirectoryUserRows"), "전량 순회 로더가 없음");
  assert.ok(q.includes(".range("), "range 페이지네이션 미사용");
  assert.ok(!q.includes("loadMentorDirectoryUserRows"), "구 캡 로더(loadMentorDirectoryUserRows) 잔존");
  assert.ok(q.includes("loadProfilesForDirectoryChunked"), "프로필 청크 배치 조회 없음(1000행 잘림 위험)");
});

test("D-ST-9: 렌더되지 않는 subscriptions 집계·응답시간 N+1 제거", () => {
  const q = read("lib/mentor/publicMentorsListQueries.ts");
  assert.ok(!q.includes("loadMentorAvgResponseHours"), "멘토 1인당 응답시간 RPC N+1 잔존");
  assert.ok(!q.includes('from("subscriptions")'), "connectedStudents subscriptions 스캔 잔존");
});

test("D-ST-9 회귀: 데이터 소스 없는 'response' 정렬·avgResponseLabel 일괄 제거", () => {
  // 응답시간 RPC 제거 후 avgResponseLabel 은 "—" 고정이었고, 이를 파싱하던 'response' 정렬은
  // 전 행 동률 no-op — 정렬 옵션·라벨·파싱 코드가 되살아나지 않게 소스 스캔으로 고정한다.
  const q = read("lib/mentor/publicMentorsListQueries.ts");
  assert.ok(!q.includes("avgResponseLabel"), "목록 stats 에 avgResponseLabel 고정 세팅/파싱 잔존");
  assert.ok(!q.includes('case "response"'), "sortKey 'response' 분기 잔존(no-op 정렬)");
  const sp = read("lib/mentor/mentorsListSearchParams.ts");
  assert.ok(!sp.includes('"response"'), "MentorsListSort/SORTS 에 response 잔존 — sort=response 는 기본 정렬 폴백이어야 함");
  const sidebar = read("components/mentor/MentorsListFilterSidebar.tsx");
  assert.ok(!sidebar.includes("답변 속도 빠른 순"), "사이드바 '답변 속도 빠른 순' 라디오 잔존");
  const summary = read("components/mentor/MentorResultsSummaryBar.tsx");
  assert.ok(!summary.includes("답변속도순"), "요약 바 '답변속도순' 정렬 라벨 잔존");
});

test("D-ST-17: 찜 조회 오류는 메시지 정규식이 아니라 error.code 로 판정한다", () => {
  const q = read("lib/mentor/mentorFavorites.ts");
  assert.ok(q.includes('error.code === "42P01"'), "PostgREST code 기반 판정이 없음");
  assert.ok(!q.includes("/does not exist|relation/i"), "메시지 정규식 분기가 잔존함");
});
