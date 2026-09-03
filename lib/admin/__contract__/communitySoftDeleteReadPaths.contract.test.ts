// 계약 테스트(소스 트립와이어): 커뮤니티 소프트 삭제 읽기 경로(PR-W2 · DB-2 SQL 194) — 관리자 코드(lib/admin · app/(admin))가
// shortform_posts · comments · community_comments 를 읽을 때 `deleted_at` 판정을 빠뜨리지 않았는지, 하드 DELETE 경로가 0인지, 삭제 모달이
// 전부 stateChange(복구 가능 문구)인지 소스로 고정한다. 관리자 읽기는 service_role(또는 is_admin 정책)이라 RLS 가 삭제 행을 가려 주지 않는다 —
// 각 경로가 스스로 deleted_at 을 다뤄야 하고, 새 읽기 경로는 아래 허용 목록에 방식·근거와 함께 등재해야 한다.
// 실행: node --test --experimental-strip-types lib/admin/__contract__/communitySoftDeleteReadPaths.contract.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const rel = (f: string) => f.slice(ROOT.length).replace(/\\/g, "/").replace(/^\//, "");

function walk(dir: string, out: string[]): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

const ADMIN_FILES = [...walk(join(ROOT, "lib", "admin"), []), ...walk(join(ROOT, "app", "(admin)"), [])].filter((f) => !f.includes("__contract__"));

/** 세 테이블(+ 게시판 글은 이미 소프트 삭제) 읽기 판정 — `.from("<table>")` 리터럴, 또는 테이블명 상수 맵을 통한 `.from(table)`. */
const TABLE_LITERAL = /\.from\(\s*"(shortform_posts|comments|community_comments)"\s*\)/;
const TABLE_VIA_MAP = /\.from\(\s*(table|COMMUNITY_CONTENT_TABLES\[|TARGET_TABLE_BY_TYPE\[)/;
const TABLE_NAME_MENTION = /"(shortform_posts|community_comments|comments)"|COMMUNITY_CONTENT_TABLES|TARGET_TABLE_BY_TYPE/;

function readsCommunityTables(code: string): boolean {
  return TABLE_LITERAL.test(code) || (TABLE_VIA_MAP.test(code) && TABLE_NAME_MENTION.test(code));
}

/**
 * 허용 목록 — 파일마다 deleted_at 을 다루는 방식과 근거. `required` 는 주석을 뺀 코드에서, `rawRequired` 는 원문(주석 포함)에서 찾는다.
 *  - filters:     게시·숨김 탭 `deleted_at IS NULL` · 삭제됨 탭 `IS NOT NULL` · 세 종류 컬럼 목록 전부 deleted_at
 *  - exposes:     삭제 행을 읽되 deleted_at 을 골라 status 'deleted'(삭제됨 배지)로 넘긴다 — 신고 증거는 삭제된 콘텐츠도 보여야 한다
 *  - mutates:     소프트 삭제·복원 UPDATE 자체(하드 DELETE 없음) · 레거시 'comment' 유형 판정은 행 실재 확인이라 deleted_at 무관(주석 근거)
 *  - intentional: 삭제 행 포함이 의도 — 작성자 콘텐츠 id 는 이전 신고 건수 집계용(삭제돼도 신고 이력은 남는다)
 */
const ALLOWED: ReadonlyArray<{ file: string; mode: "filters" | "exposes" | "mutates" | "intentional"; required: readonly string[]; rawRequired: readonly string[] }> = [
  {
    file: "lib/admin/adminCommunityContentQueries.ts",
    mode: "filters",
    required: ['r.is("deleted_at", null)', 'r.not("deleted_at", "is", null)', "status, deleted_at, created_at"],
    rawRequired: [],
  },
  {
    file: "lib/admin/adminReportEvidence.ts",
    mode: "exposes",
    required: ['str(row, "deleted_at") ? "deleted"', "deleted_at, author_id"],
    rawRequired: [],
  },
  {
    file: "lib/admin/communityModerationCore.ts",
    mode: "mutates",
    required: [".update({ deleted_at: new Date().toISOString(), deleted_by: actorId })", '.is("deleted_at", null)', "statusPatch.deleted_at = null", "{ is_deleted: false, deleted_at: null, deleted_by: null }"],
    rawRequired: ["deleted_at 무관"],
  },
  {
    file: "lib/admin/contentReportTargetUserQueries.ts",
    mode: "intentional",
    required: [],
    rawRequired: ["deleted_at 무관(의도)"],
  },
];

test("트립와이어: 세 테이블을 읽는 관리자 코드는 허용 목록과 정확히 같고, 각 파일은 deleted_at 판정(필터·노출·변경·의도 근거)을 갖춘다", () => {
  const readers = ADMIN_FILES.filter((f) => readsCommunityTables(stripComments(readFileSync(f, "utf8")))).map(rel).sort();
  assert.deepEqual(readers, ALLOWED.map((a) => a.file).sort(), "새 관리자 읽기 경로는 deleted_at 판정을 명시하고 허용 목록에 등재한다");
  for (const a of ALLOWED) {
    const raw = read(a.file);
    const code = stripComments(raw);
    for (const s of a.required) assert.ok(code.includes(s), `${a.file}(${a.mode}): ${s}`);
    for (const s of a.rawRequired) assert.ok(raw.includes(s), `${a.file}(${a.mode}) 근거 주석: ${s}`);
  }
  // 세 종류 컬럼 목록 전부 deleted_at — 글·숏폼·댓글
  const q = stripComments(read("lib/admin/adminCommunityContentQueries.ts"));
  assert.equal((q.match(/status, deleted_at, created_at/g) ?? []).length, 3);
  // 신고 증거는 네 종류(글·숏폼·레거시 댓글·정본 댓글) 전부 deleted_at 을 읽는다
  const ev = stripComments(read("lib/admin/adminReportEvidence.ts"));
  assert.equal((ev.match(/deleted_at, author_id/g) ?? []).length, 4);
  assert.ok(ev.includes("evidenceStatus(row,"), "삭제가 숨김보다 강하다 — deleted_at 이 있으면 'deleted'");
  const detail = stripComments(read("app/(admin)/admin/(console)/reports/[id]/page.tsx"));
  assert.ok(detail.includes('evidence.status === "deleted"') && detail.includes("data-content-report-evidence-deleted"), "신고 상세 증거에 삭제됨 배지");
});

test("하드 DELETE 경로 0: 관리자 코드 어디에서도 네 콘텐츠 테이블에 .delete() 를 걸지 않는다 · 코어 삭제는 네 테이블 공통 UPDATE · 두 액션 경로가 조치 관리자 id 를 넘긴다", () => {
  const DELETE_CHAIN = /\.from\(\s*(?:"(?:community_posts|shortform_posts|comments|community_comments)"|table|TARGET_TABLE_BY_TYPE\[[^)]*\]|COMMUNITY_CONTENT_TABLES\[[^)]*\])\s*\)[\s\S]{0,160}?\.delete\(/;
  for (const f of ADMIN_FILES) {
    const code = stripComments(readFileSync(f, "utf8"));
    if (!TABLE_NAME_MENTION.test(code) && !code.includes('"community_posts"')) continue;
    assert.ok(!DELETE_CHAIN.test(code), `${rel(f)}: 콘텐츠 테이블 하드 DELETE 금지(소프트 삭제 — SQL 194)`);
  }
  const core = stripComments(read("lib/admin/communityModerationCore.ts"));
  assert.ok(!core.includes(".delete("), "코어에 DELETE 없음");
  assert.ok(!core.includes('if (targetType === "community_post") {'), "종류별 삭제 분기 없음 — community_posts·shortform_posts·community_comments·comments 공통");
  assert.ok(core.includes("actorId: string;") && core.includes("deleted_by: actorId"), "deleted_by = 조치한 관리자(service_role 경로라 auth.uid() 대신 전달)");
  for (const f of ["lib/admin/communityModerationActions.ts", "lib/admin/adminReportActions.ts"]) {
    assert.ok(stripComments(read(f)).includes("actorId: user.id,"), `${f}: requireRole("admin") 의 user.id 를 actorId 로`);
  }
});

test("삭제 모달·문구: 커뮤니티 관리·신고 상세의 삭제는 stateChange(재입력 없음) · 복구 불가·영구 삭제 문구 0 · 페이지 설명은 삭제됨 탭 복원 안내", () => {
  const files = [
    "components/admin/CommunityContentActionButtons.tsx",
    "components/admin/ContentReportActionButtons.tsx",
    "lib/admin/communityContentConsole.ts",
    "lib/admin/contentReportConsole.ts",
    "app/(admin)/admin/(console)/community-content/page.tsx",
  ];
  for (const f of files) {
    const code = stripComments(read(f));
    assert.ok(!code.includes('level="destructive"') && !code.includes('level: "destructive"'), `${f}: destructive 없음`);
    for (const banned of ["복구 불가", "영구 삭제", "복구할 수 없습니다", "되돌릴 수 없는 작업", "confirmText="]) assert.ok(!code.includes(banned), `${f}: ${banned}`);
  }
  assert.ok(stripComments(read("app/(admin)/admin/(console)/community-content/page.tsx")).includes("삭제는 소프트 삭제라 '삭제됨' 탭에서 복원할 수 있습니다."));
});

test("공개 표면 방어(세션 클라이언트): 숏폼 상세는 삭제 행을 not-found 로 닫고, 숏폼 피드·댓글 목록은 deleted_at IS NULL 을 쿼리에 명시한다", () => {
  const sf = stripComments(read("lib/community/communityShortformQueries.ts"));
  assert.ok(sf.includes('if (resolveCommunityVisibility(row) === "deleted") {') && sf.includes('q = q.is("deleted_at", null);'), "숏폼 상세·피드");
  const cq = stripComments(read("lib/community/communityQueries.ts"));
  assert.ok(/\.eq\("status", "visible"\)\s*\.is\("deleted_at", null\)/.test(cq), "숏폼·레거시 댓글 목록");
});
