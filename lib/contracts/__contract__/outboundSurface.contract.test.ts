/**
 * outboundSurface.contract.test.ts — 웹 소스 outbound 표면 가드 (수렴 §22.4·§22.5).
 *
 * 소스 스캔만으로 판정 가능한 재발 방지 조건:
 *  - users 직접 self UPDATE/UPSERT 재등장 0 (관리자 service-role 경로 파일만 예외)
 *  - legacy 멘토 RPC(mentor_directory_list_v2 등) 재등장 0
 *  - legacy 숏폼 view +1 RPC 재등장 0
 *  - legacy 계정 삭제 self RPC(클라이언트 창 지정) 재등장 0 (v2·service consented 예외)
 *  - community_posts 직접 INSERT/UPDATE 재등장 0 (정본은 api_web_v1 RPC)
 *  - community_comments 에 author_label 클라이언트 전송 재등장 0 (서버 트리거 파생)
 *  - 신고 target 에 모호한 'shortform'/'comment' 신규 쓰기 재등장 0
 *  - canonical 호출 존재: shortform_view_record_v2 · mark_notification_read ·
 *    admin_issue_user_warning · api_web_v1 community RPC
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(process.cwd());
const SCAN_DIRS = ["app", "lib", "components"];
const EXT = new Set([".ts", ".tsx"]);

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "__contract__" || entry.startsWith(".")) continue;
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) yield* walk(p);
    else if (EXT.has(p.slice(p.lastIndexOf(".")))) yield p;
  }
}

type Hit = { file: string; line: number; text: string };

const COMMENT_LINE = /^\s*(\/\/|\/?\*)/;

function scan(re: RegExp, opts?: { excludeFiles?: RegExp }): Hit[] {
  const hits: Hit[] = [];
  for (const dir of SCAN_DIRS) {
    for (const file of walk(join(ROOT, dir))) {
      if (opts?.excludeFiles?.test(file)) continue;
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((text, i) => {
        if (COMMENT_LINE.test(text)) return; // 주석은 코드 표면이 아니다
        if (re.test(text)) hits.push({ file: file.slice(ROOT.length + 1), line: i + 1, text: text.trim() });
      });
    }
  }
  return hits;
}

function assertNoHits(hits: Hit[], label: string) {
  assert.equal(
    hits.length,
    0,
    `${label} 재등장:\n${hits.map((h) => `  ${h.file}:${h.line} ${h.text}`).join("\n")}`
  );
}

test("users 직접 self UPDATE/UPSERT 0 (관리자 service-role 코어 제외)", () => {
  // .from("users") 와 .update(/.upsert( 가 같은 파일에 함께 있으면 위험 신호로 본다.
  const exempt = /lib[\\/]admin[\\/](accountStatusActions|accountStatusCore|adminDisputeSanctionActions)\.ts$|lib[\\/]account[\\/]accountDeletionAdapters\.ts$/;
  const offenders: string[] = [];
  for (const dir of SCAN_DIRS) {
    for (const file of walk(join(ROOT, dir))) {
      if (exempt.test(file)) continue;
      const src = readFileSync(file, "utf8");
      // .from("users") 에 체이닝으로 이어지는 update/upsert 만 위반으로 본다.
      if (/\.from\(["']users["']\)[\s\S]{0,200}?\.(update|upsert)\(/.test(src)) {
        offenders.push(file.slice(ROOT.length + 1));
      }
    }
  }
  assert.deepEqual(offenders, [], `users 직접 쓰기 의심 파일: ${offenders.join(", ")}`);
});

test("legacy 멘토 디렉토리 RPC 0", () => {
  assertNoHits(
    scan(/mentor_directory_list_v2|mentor_profiles_for_directory_v2|mentor_user_public_v2/),
    "legacy mentor RPC"
  );
});

test("legacy 숏폼 view +1 RPC 0", () => {
  assertNoHits(scan(/increment_shortform_post_view/), "increment_shortform_post_view");
});

test("legacy 계정 삭제 self RPC 0 (v2·service consented 만 허용)", () => {
  assertNoHits(
    scan(/account_deletion_request_self["']|account_deletion_request_self_consented["']/),
    "legacy account_deletion_request_self*"
  );
});

test("community_posts 직접 INSERT/UPDATE 0", () => {
  const offenders: string[] = [];
  for (const dir of SCAN_DIRS) {
    for (const file of walk(join(ROOT, dir))) {
      const src = readFileSync(file, "utf8");
      const m = src.match(/\.from\(["']community_posts["']\)[\s\S]{0,200}?\.(insert|update|upsert|delete)\(/);
      if (m) offenders.push(`${file.slice(ROOT.length + 1)} (${m[1]})`);
    }
  }
  assert.deepEqual(offenders, [], `community_posts 직접 쓰기: ${offenders.join(", ")}`);
});

test("community_comments INSERT 에 author_label 전송 0", () => {
  const offenders: string[] = [];
  for (const dir of SCAN_DIRS) {
    for (const file of walk(join(ROOT, dir))) {
      const src = readFileSync(file, "utf8");
      const m = src.match(/\.from\(["']community_comments["']\)\s*\.insert\(\s*\{[\s\S]{0,400}?\}/);
      if (m && /author_label/.test(m[0])) offenders.push(file.slice(ROOT.length + 1));
    }
  }
  assert.deepEqual(offenders, [], `author_label 클라이언트 전송: ${offenders.join(", ")}`);
});

test("신고 target 신규 쓰기에 모호 어휘 0 (community_post/shortform_post/board_comment/community_comment/user 만)", () => {
  // content_reports insert payload 의 target_type 리터럴을 검사한다.
  const src = readFileSync(join(ROOT, "lib/community/communityReportActions.ts"), "utf8");
  assert.ok(src.includes('"shortform_post"'), "숏폼 신고는 shortform_post 여야 한다");
  assert.ok(!/target_type\s*=[^;]*["']shortform["']/.test(src), "모호한 'shortform' 전송 금지");
  assert.ok(!/target_type\s*=[^;]*["']comment["']/.test(src), "모호한 'comment' 전송 금지");
});

test("canonical 호출 존재 (전환 완료 증빙)", () => {
  const all = SCAN_DIRS.flatMap((d) => [...walk(join(ROOT, d))]).map((f) => readFileSync(f, "utf8")).join("\n");
  for (const needle of [
    'rpc("shortform_view_record_v2"',
    'rpc("mark_notification_read"',
    'rpc("admin_issue_user_warning"',
    'rpc("mark_all_notifications_read"',
  ]) {
    assert.ok(all.includes(needle), `canonical 호출 부재: ${needle}`);
  }
});

test("리뷰 공개 predicate 에 moderation_state 포함", () => {
  const q = readFileSync(join(ROOT, "lib/reviews/reviewQueries.ts"), "utf8");
  const m = readFileSync(join(ROOT, "lib/reviews/reviewRowMapper.ts"), "utf8");
  assert.ok(/moderation_state.*visible/.test(q), "reviewQueries 공개 필터에 moderation_state 필요");
  assert.ok(/moderation_state\s*===\s*["']visible["']/.test(m), "isPubliclyVisibleReview 에 moderation_state 필요");
});

test("Firebase 미유입", () => {
  assertNoHits(scan(/firebase/i, { excludeFiles: /outboundSurface\.contract\.test\.ts$/ }), "firebase 참조");
});
