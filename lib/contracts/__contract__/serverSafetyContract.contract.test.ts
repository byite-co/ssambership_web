/**
 * serverSafetyContract.contract.test.ts — 질문방 안전 서버 계약 소스 잠금.
 *
 * 문서 드리프트(과거 "SERVER_BLOCK_CONTRACT_MISSING")가 재발하지 않도록,
 * migration 소스에서 다음 현행 계약을 고정한다(오프라인 · DB 미접촉):
 *  - qna_append_message / qna_register_attachment 함수 본문에 양방향 차단
 *    (qna_users_blocked → BLOCKED)이 있고, 그 검사가 각 INSERT **이전**에 위치
 *  - qna_register_attachment 에 멘토 승인 검사(MENTOR_NOT_APPROVED)가 attachment
 *    INSERT 이전에 위치
 *  - content_reports INSERT allowlist 정본 5종(board_comment/shortform_post 포함),
 *    모호한 'shortform'/'comment' 는 신규 허용값 아님
 *
 * 정본 소스: Build 13 migration(qna 함수) + 수렴 M2 migration(신고 allowlist).
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const BUILD13 = readFileSync(
  join(ROOT, "supabase/sql/20260802024641_build13_db_contract_convergence.sql"),
  "utf8"
);
const M2 = readFileSync(
  join(ROOT, "supabase/sql/20260803162808_domain_contract_convergence.sql"),
  "utf8"
);

/** `CREATE OR REPLACE FUNCTION public.<name>(...) ... AS $tag$ BODY $tag$;` 의 BODY 만 슬라이스.
 *  (Build 13 파일은 대문자 DDL·`AS $tag$` 사용 — 대소문자 무관 매칭.) */
function functionBody(src: string, fnName: string): string {
  const headerRe = new RegExp(
    `create\\s+or\\s+replace\\s+function\\s+public\\.${fnName}\\s*\\(`,
    "i"
  );
  const hm = headerRe.exec(src);
  assert.ok(hm, `${fnName} 정의를 소스에서 찾지 못함`);
  const header = hm.index;
  const asIdx = src.toLowerCase().indexOf(" as $", header);
  assert.ok(asIdx >= 0, `${fnName} AS $tag$ 시작을 찾지 못함`);
  const tagStart = src.indexOf("$", asIdx + 4);
  const tagEnd = src.indexOf("$", tagStart + 1) + 1;
  const tag = src.slice(tagStart, tagEnd); // e.g. $function$
  const bodyStart = tagEnd;
  const bodyEnd = src.indexOf(tag, bodyStart);
  assert.ok(bodyEnd > bodyStart, `${fnName} 본문 닫는 dollar-quote 를 찾지 못함`);
  return src.slice(bodyStart, bodyEnd);
}

test("qna_append_message: 양방향 차단이 message INSERT 이전", () => {
  const body = functionBody(BUILD13, "qna_append_message");
  const block = body.indexOf("qna_users_blocked");
  const insert = body.indexOf("insert into public.question_messages");
  assert.ok(block >= 0, "qna_users_blocked 차단 검사 없음");
  assert.ok(body.includes("'BLOCKED'"), "BLOCKED raise 없음");
  assert.ok(insert >= 0, "message INSERT 없음");
  assert.ok(block < insert, "차단 검사가 message INSERT 뒤에 있음(부수효과 위험)");
});

test("qna_register_attachment: 차단 + 멘토 승인이 attachment INSERT 이전", () => {
  const body = functionBody(BUILD13, "qna_register_attachment");
  const block = body.indexOf("qna_users_blocked");
  const mentor = body.indexOf("MENTOR_NOT_APPROVED");
  const insert = body.indexOf("insert into public.question_attachments");
  assert.ok(block >= 0 && body.includes("'BLOCKED'"), "차단 검사/BLOCKED 없음");
  assert.ok(mentor >= 0, "MENTOR_NOT_APPROVED 승인 게이트 없음");
  assert.ok(insert >= 0, "attachment INSERT 없음");
  assert.ok(block < insert, "차단 검사가 attachment INSERT 뒤에 있음");
  assert.ok(mentor < insert, "멘토 승인 검사가 attachment INSERT 뒤에 있음(첨부-only 우회 위험)");
});

test("content_reports INSERT allowlist = 정본 5종, 모호 어휘 배제", () => {
  const policyIdx = M2.indexOf("create policy content_reports_insert_reporter");
  assert.ok(policyIdx >= 0, "content_reports_insert_reporter 정책을 M2 에서 찾지 못함");
  const policy = M2.slice(policyIdx, M2.indexOf(";", policyIdx));
  for (const t of ["community_post", "shortform_post", "community_comment", "board_comment", "user"]) {
    assert.ok(policy.includes(`'${t}'::text`), `allowlist 에 ${t} 없음`);
  }
  // 정확 토큰 비교 — 'community_comment' 가 'comment' 를, 'shortform_post' 가 'shortform' 을
  // 부분 포함하므로 dollar-quoted 정확 토큰으로 배제 확인.
  assert.ok(!policy.includes("'shortform'::text"), "모호한 'shortform' 이 신규 allowlist 에 있음");
  assert.ok(!policy.includes("'comment'::text"), "모호한 'comment' 가 신규 allowlist 에 있음");
});
