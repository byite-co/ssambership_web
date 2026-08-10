import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// D-DB-2 / D-ST-10 회귀 감시:
// 공개 멘토 읽기(mentorPublicRead)는 반드시 api_web_v1.mentor_directory_v1 view 만 경유해야 한다.
// view 의 WHERE 가 승인·활성·비삭제 멘토만 노출하는 유일한 실차단이므로, 누군가 raw
// mentor_profiles 테이블 직접 조회로 되돌리면 미승인/비활성 멘토가 새어나온다. 이 테스트는
// 원본 소스에 대한 정적 계약으로 그 회귀를 막는다(SECURITY DEFINER view 정의 변경은 DB 측
// 스냅샷이, 웹의 view 이탈은 이 테스트가 감시).
//
// C1 ⑤ 확장: 종전에는 mentorPublicRead.ts 한 파일만 검사해서, 다른 파일들이 세션
// 클라이언트로 mentor_profiles·users 를 직접 읽는 같은 클래스의 결함(학생 세션 RLS 0행 →
// 게이트 오작동·표시 폴백 무음 강등)이 전부 살아남았다. 아래 트리 walk 테스트가
// app/lib/components 전체를 검사한다.
//
// CI: `npm run test:contract` 는 `.github/workflows/web-contract-tests.yml` 이
// app/lib/components·package* 변경 PR마다 실행한다(2026-08-10 편입 — 종전 로컬 전용 고지 해소).

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

// ─────────────────────────────────────────────────────────────────────────────
// C1 ⑤: mentor_profiles·users 직접 접근 전면 검사 (app/lib/components 트리 walk)
//
// 배경: 두 테이블의 SELECT 정책은 본인(*_select_own)·관리자(*_admin_select_all) 2개뿐이다.
// 타인 행을 세션 클라이언트로 읽으면 **에러가 아니라 0행**이 돌아와, fail-closed 게이트는
// 오차단(구독 게이트 4가 전 구독을 막음)·fail-open 게이트는 무단 통과(게이트 3)·표시 경로는
// 무음 폴백 강등("멘토 멘토"·랜딩 "준비 중")이 된다. 공개·학생 경로는 반드시
// api_web_v1.mentor_directory_v1 뷰(또는 전용 RPC)를 경유해야 한다.
//
// 면제 목록: 실측으로 확인한 정상 호출부(본인 행 / 관리자 / 서비스 롤)만 사유와 함께 등재한다.
// 목록에 없는 새 직접 접근은 이 테스트가 실패시킨다 — 뷰·RPC 로 옮기거나, 본인/관리자/서비스
// 롤 경로임을 실측 확인한 뒤 사유와 함께 등재하라.
// ─────────────────────────────────────────────────────────────────────────────

const ROOT = join(process.cwd());
const SCAN_DIRS = ["app", "lib", "components"];
const EXT = new Set([".ts", ".tsx"]);
// 파일 전체(주석 공백화 후)를 스캔한다 — 줄 단위 매칭이 놓치던 우회형
// (.from(\n"users") 줄바꿈 · .from(`users`) 백틱 · .from<T>("users") 제네릭 · 블록 주석으로
// 시작하는 코드 줄)을 전부 잡는다. storage.from(버킷)·다른 테이블은 미매치.
// 알려진 잔여 한계: `const TABLE = "mentor_profiles"` 간접 참조 3곳(lib/admin/adminQueries.ts ·
// mentorApprovalActions.ts · mentorCapAdminActions.ts — 전부 관리자/서비스 롤 실측)은 리터럴
// 정규식에 걸리지 않는다. 새 간접 참조를 만들지 마라.
const DIRECT_TABLE_RE = /\.from\s*(?:<[^>]*>)?\(\s*["'`](mentor_profiles|users)["'`]\s*\)/g;

/** 주석을 줄 구조 보존한 채 공백화한다(문자열 내 `//` 도 지워지는 러프 러너 — 검출 전용). */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/\/\/[^\n]*/g, (m) => " ".repeat(m.length));
}

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "__contract__" || entry.startsWith(".")) continue;
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) yield* walk(p);
    else if (EXT.has(p.slice(p.lastIndexOf(".")))) yield p;
  }
}

/** 저장소 상대 경로(구분자 / 로 정규화) → 면제 사유. 전부 2026-08 실측. */
const DIRECT_ACCESS_EXEMPT: Record<string, string> = {
  // ── mentor_profiles ──
  "lib/mentor/mentorProfileQueries.ts":
    "본인 행 조회(멘토 콘솔 user.id)·관리자 승인 상세(readDb) 전용 — 공개 경로 호출부 없음",
  "lib/mentor/mentorProfileMutations.ts": "F7 RPC 전면 교체 인자용 자기 행 읽기(본인 세션)",
  "lib/mentor/mentorProfileEditActions.ts": "본인 행 읽기(구 아바타 조회 — user.id 한정)",
  "lib/mentor/mentorStudentIdActions.ts":
    "서비스 롤 쓰기 — 인증서류 컬럼(F7 allowlist 밖) 의도된 예외, 본인(user.id) 행 한정",
  "lib/mentor/mentorSubscribeOpen.ts":
    "본인 세션 전용(mypage 자기 토글 읽기·F7 인자용 자기 행 읽기) — C1 경계 주석 참조. 미승인 멘토도 자기 행은 읽혀야 하므로 뷰 전환 금지",
  "lib/mentor/mentorActivityService.ts":
    "서비스 롤 전용(활동 전이 saga + C1 게이트 3 조회 — loadMentorActivityForGate 은 indeterminate fail-closed)",
  "lib/mentor/mentorPayoutsService.ts": "본인 행 조회(멘토 정산 계좌 마스킹 표시)",
  "lib/auth/mentorSignupStudentIdAction.ts": "서비스 롤(가입 창구 학생증 반영 — 본인 행 한정 가드)",
  "lib/subscribe/mentorCapService.ts": "서비스 롤(cap 집계 — D-ST-11 indeterminate fail-closed 선례)",
  "lib/admin/adminQueries.ts": "관리자 콘솔 조회(requireRole admin 뒤 admin/readDb 클라이언트)",
  "lib/admin/adminUnifiedActivityLog.ts": "관리자 활동 로그 집계(관리자 클라이언트)",
  "lib/admin/mentorAcademicRecordChangeReview.ts": "관리자 학적 변경 심사 조회",
  "lib/admin/mentorAcademicRecordChangeReviewActions.ts": "관리자 학적 변경 심사 액션",
  "lib/admin/mentorSchoolVerificationReview.ts": "관리자 재학 인증 심사 조회",
  "lib/reviews/reviewQueries.ts":
    "C1 ③-c: 과목 라벨은 뷰 우선 — 직접 읽기는 뷰 0행(미승인·삭제대기 멘토)의 본인 콘솔·관리자 폴백 전용(학생 세션은 종전대로 0행 무해). users 읽기는 후기 작성자명 — 학생 nickname 뷰 부재로 잔존(범위 밖, 타 학생은 '학*' 폴백)",
  "app/(mentor)/mentor/mypage/page.tsx": "본인 행 조회(user.id — 멘토 마이페이지 활동 상태 표시)",
  // ── users ──
  "lib/individualQuestion/individualQuestionQueries.ts":
    "C1 ③-a: 본인 행 해석 + 멘토 id 는 뷰 nickname 으로 보강(부분 해결 — 학생 nickname 뷰 부재로 상대 학생명은 폴백·D-IQ-6 RPC 가 멘토 화면을 덮음)",
  "lib/qna/freeQuestionUsage.ts": "본인 행(세션 학생 created_at — 무료 질문권 게이트)",
  "lib/auth/accountStatus.ts": "본인 행(세션 사용자 status·suspended_until 게이트)",
  "lib/auth/getCurrentProfile.ts":
    "본인 행(세션 사용자 프로필) + 관리자 호출부 2곳(멘토 승인 상세·분쟁 상세 — users_admin_select_all 로 읽힘)",
  "lib/auth/syncAfterSignUpSession.ts": "본인 행(가입 직후 트리거 결과 검증 — 직접 쓰기 없음)",
  "lib/appSession/appSurfaceAccountGate.ts": "본인 행(앱 표면 요청별 계정 상태 게이트)",
  "lib/admin/accountStatusActions.ts": "관리자 서비스 롤 계정 상태 조치(outboundSurface 면제와 동일)",
  "lib/admin/accountStatusQueries.ts": "관리자 계정 상태 콘솔 조회(admin 클라이언트)",
  "lib/admin/accountStatusCore.ts": "관리자 서비스 롤 계정 상태 코어",
  "lib/admin/adminDashboardExtended.ts": "관리자 대시보드 집계(admin 클라이언트)",
  "lib/admin/mentorActivityQueries.ts": "관리자 활동 이벤트 조회(admin 클라이언트 — 멘토 표시명)",
  "lib/community/communityAuthorLabels.ts":
    "알려진 열화(범위 밖): 타인 행은 RLS 0행 → 폴백 라벨. 학생 nickname 은 어떤 뷰에도 없어 마이그레이션 필요",
  "app/(student)/settings/blocks/page.tsx":
    "알려진 열화(범위 밖): 차단 상대 이름 — 타인 행 RLS 0행 → '회원' 폴백(학생 nickname 뷰 부재)",
  "components/auth/UpdatePasswordClient.tsx": "본인 행(세션 사용자 role — 로그인 경로 분기)",
};

type DirectHit = { file: string; line: number; text: string };

function scanDirectTableAccess(): DirectHit[] {
  const hits: DirectHit[] = [];
  for (const dir of SCAN_DIRS) {
    for (const file of walk(join(ROOT, dir))) {
      const rel = file.slice(ROOT.length + 1).split("\\").join("/");
      const raw = readFileSync(file, "utf8");
      const src = stripComments(raw); // 주석은 코드 표면이 아니다(줄 번호 보존 공백화)
      const rawLines = raw.split("\n");
      for (const m of src.matchAll(DIRECT_TABLE_RE)) {
        const line = src.slice(0, m.index).split("\n").length;
        hits.push({ file: rel, line, text: (rawLines[line - 1] ?? "").trim() });
      }
    }
  }
  return hits;
}

test("mentor_profiles·users 직접 접근은 면제 목록(본인/관리자/서비스롤 실측)에만 존재한다", () => {
  const offenders = scanDirectTableAccess().filter((h) => !(h.file in DIRECT_ACCESS_EXEMPT));
  assert.equal(
    offenders.length,
    0,
    "면제 목록에 없는 mentor_profiles·users 직접 접근 발견 — 공개·학생 경로면 " +
      "api_web_v1.mentor_directory_v1 뷰(또는 전용 RPC)로 옮기고, 본인/관리자/서비스 롤 경로면 " +
      "실측 확인 후 사유와 함께 DIRECT_ACCESS_EXEMPT 에 등재하라(타인 행은 에러 없이 0행이다):\n" +
      offenders.map((h) => `  ${h.file}:${h.line} ${h.text}`).join("\n")
  );
});

test("면제 목록에 사문 엔트리가 없다(파일 이동·정리 시 목록도 갱신)", () => {
  const filesWithHits = new Set(scanDirectTableAccess().map((h) => h.file));
  const stale = Object.keys(DIRECT_ACCESS_EXEMPT).filter((f) => !filesWithHits.has(f));
  assert.deepEqual(stale, [], `직접 접근이 더 이상 없는 면제 엔트리 — 목록에서 제거하라: ${stale.join(", ")}`);
});

test("검출기 자가 검증 — 우회형(줄바꿈·백틱·제네릭·블록주석 선행)을 잡고 주석·타 테이블은 넘긴다", () => {
  const re = () => new RegExp(DIRECT_TABLE_RE.source); // /g 상태 공유 방지용 새 인스턴스
  const mustCatch = [
    `const r = await supabase.from("users").select("id");`,
    "const r = await supabase.from(`users`).select(\"id\");",
    `const r = await supabase\n  .from(\n    "mentor_profiles"\n  )\n  .select("x");`,
    `const r = supabase.from<Row>("users").select("id");`,
    `/* x */ const r = s.from("users").select("id");`,
  ];
  for (const fixture of mustCatch) {
    assert.match(stripComments(fixture), re(), `검출기가 놓친 우회형: ${JSON.stringify(fixture)}`);
  }
  const mustSkip = [
    `// supabase.from("users") 는 금지다`,
    `/* .from("mentor_profiles") 이야기만 하는 블록 주석 */`,
    `const r = s.from("reviews").select("id");`,
    `await supabase.storage.from("student-id-images").upload(p, b);`,
  ];
  for (const fixture of mustSkip) {
    assert.doesNotMatch(stripComments(fixture), re(), `오검출: ${JSON.stringify(fixture)}`);
  }
});
