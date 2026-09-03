// 계약 테스트(소스 트립와이어): 작성자 본인 소프트 삭제 경로 — PR-W3 · DB-3(SQL 196 RPC · 197 Realtime 정책 · 198 하드 DELETE 차단).
//   ① 웹의 작성자 삭제 경로(숏폼 댓글 · 게시판 댓글)는 정본 RPC soft_delete_own_content 하나만 부른다 — 직접 UPDATE(is_deleted · deleted_at) 0 ·
//      구 community_comment_soft_delete_self 호출 0(앱 계약이라 DB 에는 남는다) · 게시판 글은 F6 그대로
//   ② 순수 규칙: RPC 이름·인자 형태·예외 코드 → 액션 실패 코드
//   ③ SQL 196/197/198 + rollback 3본 + pack 사본의 형태(시그니처 · ACL · 정책 · 트리거 · 게이트)를 소스로 고정
// 실행: node --test --experimental-strip-types lib/community/__contract__/authorSoftDelete.contract.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  SOFT_DELETE_OWN_CONTENT_KINDS,
  SOFT_DELETE_OWN_CONTENT_RPC,
  buildSoftDeleteOwnContentArgs,
  softDeleteOwnContentErrorCode,
} from "../softDeleteOwnContent.ts";

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const stripSqlComments = (src: string) => src.replace(/^\s*--.*$/gm, "");

const BOARD_MUTATIONS = "lib/community/communityBoardMutations.ts";
const COMMENT_ACTIONS = "lib/community/commentActions.ts";
const BOARD_ACTIONS = "lib/community/communityBoardActions.ts";
const SQL_196 = "supabase/sql/196_soft_delete_own_content_rpc.sql";
const SQL_197 = "supabase/sql/197_realtime_admin_topic_private.sql";
const SQL_198 = "supabase/sql/198_ugc_block_hard_delete.sql";
const PACK = {
  [SQL_196]: "supabase/baseline/post_ledger_backfills/20260903230100_soft_delete_own_content_rpc.sql",
  [SQL_197]: "supabase/baseline/post_ledger_backfills/20260903230200_realtime_admin_topic_private.sql",
  [SQL_198]: "supabase/baseline/post_ledger_backfills/20260903230300_ugc_block_hard_delete.sql",
} as const;
const ROLLBACK = {
  [SQL_196]: "supabase/rollback/20260903230100_soft_delete_own_content_rpc_rollback.sql",
  [SQL_197]: "supabase/rollback/20260903230200_realtime_admin_topic_private_rollback.sql",
  [SQL_198]: "supabase/rollback/20260903230300_ugc_block_hard_delete_rollback.sql",
} as const;

// ── ② 순수 규칙 ────────────────────────────────────────────────────────────────

test("RPC 이름·kind 4종·인자 키(p_kind · p_id)는 DB 시그니처 그대로", () => {
  assert.equal(SOFT_DELETE_OWN_CONTENT_RPC, "soft_delete_own_content");
  assert.deepEqual([...SOFT_DELETE_OWN_CONTENT_KINDS], ["shortform", "shortform_comment", "board_comment", "board_post"]);
  assert.deepEqual(buildSoftDeleteOwnContentArgs("board_comment", " 11111111-1111-4111-8111-111111111111 "), {
    p_kind: "board_comment",
    p_id: "11111111-1111-4111-8111-111111111111",
  });
});

test("예외 코드 → 액션 실패 코드: 비존재·타인·종류 불일치 = not_found · 계정 4종 = account_blocked · 관리자 숨김 = moderated · 그 외 = db", () => {
  for (const m of ["CONTENT_NOT_FOUND", "CONTENT_NOT_OWNED", "CONTENT_KIND_MISMATCH"]) assert.equal(softDeleteOwnContentErrorCode(m), "not_found", m);
  for (const m of ["ACCOUNT_BANNED", "ACCOUNT_SUSPENDED", "ACCOUNT_NOT_ACTIVE", "ACCOUNT_DELETION_IN_PROGRESS"]) assert.equal(softDeleteOwnContentErrorCode(m), "account_blocked", m);
  assert.equal(softDeleteOwnContentErrorCode("CONTENT_MODERATED"), "moderated");
  for (const m of ["AUTH_REQUIRED", "INVALID_KIND", "permission denied for function soft_delete_own_content", "", null, undefined]) {
    assert.equal(softDeleteOwnContentErrorCode(m), "db", String(m));
  }
});

// ── ① 웹 작성자 삭제 경로 ─────────────────────────────────────────────────────

test("게시판 댓글 본인 삭제 = RPC soft_delete_own_content('board_comment') — 직접 UPDATE is_deleted 0(RLS 가 거부하던 결함 경로 제거)", () => {
  const code = stripComments(read(BOARD_MUTATIONS));
  assert.ok(code.includes('supabase.rpc(SOFT_DELETE_OWN_CONTENT_RPC, buildSoftDeleteOwnContentArgs("board_comment", commentId))'));
  assert.ok(code.includes("softDeleteOwnContentErrorCode(error.message)"), "실패 코드 매핑");
  assert.ok(!/is_deleted:\s*true/.test(code), "UPDATE comments SET is_deleted = true 잔존 0");
  assert.ok(!/\.from\(\s*"comments"\s*\)[\s\S]{0,120}?\.update\(/.test(code), "comments 직접 UPDATE 0");
  assert.ok(!code.includes("삭제된 댓글입니다"), "본문 덮어쓰기 0 — RPC 는 본문을 보존한다(관리자 복원)");
  const actions = stripComments(read(BOARD_ACTIONS));
  assert.ok(actions.includes("const r = await softDeleteBoardComment(supabase, user.id, commentId);") && actions.includes('q.set("commentError", "delete");'), "실패는 commentError=delete 로 표면화(계약 불변)");
  assert.ok(actions.includes('callApiWebV1Rpc') === false && stripComments(read(BOARD_MUTATIONS)).includes('callApiWebV1Rpc(supabase, "community_post_soft_delete", { p_post_id: postId })'), "게시판 글 삭제는 F6 그대로");
});

test("숏폼 댓글 본인 삭제 = RPC soft_delete_own_content('shortform_comment') — 구 community_comment_soft_delete_self 호출 0(앱 계약 · DB 에는 유지)", () => {
  const code = stripComments(read(COMMENT_ACTIONS));
  assert.ok(code.includes('supabase.rpc(SOFT_DELETE_OWN_CONTENT_RPC, buildSoftDeleteOwnContentArgs("shortform_comment", commentId))'));
  assert.ok(!code.includes("community_comment_soft_delete_self"), "구 RPC 호출 0");
  assert.ok(code.includes('redirect(buildCommentRedirect(returnPath, "delete"))'), "실패는 commentError=delete(계약 불변)");
  for (const f of ["lib", "components", "app"]) {
    void f;
  }
});

test("웹 어디에서도 세 콘텐츠 테이블에 .delete() 를 걸지 않는다(198 하드 DELETE 차단과 정합) · 구 RPC 호출은 lib/community 밖에도 0", () => {
  const files = [BOARD_MUTATIONS, COMMENT_ACTIONS, BOARD_ACTIONS, "lib/community/communityShortformMutations.ts", "lib/community/communityShortformActions.ts", "lib/community/communityMutations.ts"];
  const DELETE_CHAIN = /\.from\(\s*"(?:shortform_posts|comments|community_comments)"\s*\)[\s\S]{0,160}?\.delete\(/;
  for (const f of files) {
    const code = stripComments(read(f));
    assert.ok(!DELETE_CHAIN.test(code), `${f}: 하드 DELETE 0`);
    assert.ok(!code.includes('"community_comment_soft_delete_self"'), `${f}: 구 RPC 0`);
  }
});

// ── ③ SQL 형태 ────────────────────────────────────────────────────────────────

test("SQL 196: soft_delete_own_content(p_kind text, p_id uuid) void · SECURITY DEFINER · search_path '' · anon REVOKE · authenticated GRANT · kind 4종 · 예외 코드 · 감사 로그 0 · 복원 없음", () => {
  const sql = stripSqlComments(read(SQL_196));
  assert.ok(sql.includes("create function public.soft_delete_own_content(p_kind text, p_id uuid)\nreturns void"));
  assert.ok(sql.includes("security definer\nset search_path to ''"));
  assert.ok(sql.includes("p_kind not in ('shortform', 'shortform_comment', 'board_comment', 'board_post')"));
  for (const code of ["AUTH_REQUIRED", "INVALID_KIND", "CONTENT_NOT_FOUND", "CONTENT_KIND_MISMATCH", "CONTENT_NOT_OWNED", "CONTENT_MODERATED", "ACCOUNT_BANNED", "ACCOUNT_SUSPENDED", "ACCOUNT_NOT_ACTIVE", "ACCOUNT_DELETION_IN_PROGRESS"]) {
    assert.ok(sql.includes(`'${code}'`), code);
  }
  assert.ok(sql.includes("if v_deleted_at is not null then\n    return;"), "멱등");
  assert.ok(sql.includes("revoke all on function public.soft_delete_own_content(text, uuid) from public, anon;"));
  assert.ok(sql.includes("grant execute on function public.soft_delete_own_content(text, uuid) to authenticated, service_role;"));
  assert.ok(!sql.includes("admin_action_logs"), "감사 로그 0(사용자 행위)");
  assert.ok(!/restore|deleted_at = null/.test(sql), "작성자 복원 경로 0");
  assert.equal((sql.match(/set deleted_at = now\(\), deleted_by = v_uid where id = p_id/g) ?? []).length, 4, "네 테이블 전부 deleted_at/deleted_by 만");
  assert.ok(sql.includes("v_author is distinct from v_uid and v_creator is distinct from v_uid"), "숏폼은 creator_id 도 본인");
  assert.ok(sql.includes("community_comment_soft_delete_self"), "기존 앱 계약 RPC 실재를 게이트·자가 검증한다(그대로 둔다)");
});

test("SQL 197: realtime.messages 정책 2종(SELECT · INSERT) · authenticated · admin:% 토픽 · is_admin() · 그 외 토픽 정책 0", () => {
  const sql = stripSqlComments(read(SQL_197));
  assert.ok(sql.includes("create policy realtime_admin_topic_select on realtime.messages\n  for select\n  to authenticated"));
  assert.ok(sql.includes("create policy realtime_admin_topic_insert on realtime.messages\n  for insert\n  to authenticated"));
  assert.equal((sql.match(/realtime\.topic\(\) like 'admin:%'/g) ?? []).length, 2);
  assert.equal((sql.match(/coalesce\(\(select public\.is_admin\(\)\), false\)/g) ?? []).length, 2);
  assert.equal((sql.match(/create policy /g) ?? []).length, 2, "admin:* 외 토픽 정책 0(현 동작 유지)");
  assert.ok(sql.includes("to_regclass('realtime.messages') is null"), "게이트: 인가 테이블 실재");
});

test("SQL 198: 세 테이블 BEFORE DELETE 트리거 · 클라이언트 역할(anon · authenticated)만 거부 · SECURITY DEFINER 아님 · 196 을 게이트로 전제", () => {
  const sql = stripSqlComments(read(SQL_198));
  assert.ok(sql.includes("if current_user in ('anon', 'authenticated') then"), "service_role · postgres · supabase_auth_admin 통과");
  assert.ok(sql.includes("'UGC_HARD_DELETE_FORBIDDEN"));
  for (const t of ["shortform_posts", "comments", "community_comments"]) {
    assert.ok(sql.includes(`create trigger trg_${t}_no_delete\n  before delete on public.${t}\n  for each row execute function public.ugc_block_hard_delete();`), t);
  }
  assert.ok(!/create function public\.ugc_block_hard_delete\(\)[\s\S]*?security definer/.test(sql.split("comment on function")[0]), "트리거 함수는 INVOKER");
  assert.ok(sql.includes("soft_delete_own_content") && sql.includes("196 먼저"), "196 게이트");
});

test("pack 사본은 supabase/sql 정본과 byte 동일 · rollback 3본은 대상 객체만 되돌린다", () => {
  for (const [src, pack] of Object.entries(PACK)) assert.equal(read(pack), read(src), `${pack} ≡ ${src}`);
  const rb196 = stripSqlComments(read(ROLLBACK[SQL_196]));
  assert.ok(rb196.includes("drop function if exists public.soft_delete_own_content(text, uuid);") && rb196.includes("198 롤백을 먼저"));
  const rb197 = stripSqlComments(read(ROLLBACK[SQL_197]));
  assert.ok(rb197.includes("drop policy if exists realtime_admin_topic_select on realtime.messages;") && rb197.includes("drop policy if exists realtime_admin_topic_insert on realtime.messages;"));
  const rb198 = stripSqlComments(read(ROLLBACK[SQL_198]));
  for (const t of ["shortform_posts", "comments", "community_comments"]) assert.ok(rb198.includes(`drop trigger if exists trg_${t}_no_delete on public.${t};`), t);
  assert.ok(rb198.includes("drop function if exists public.ugc_block_hard_delete();"));
  for (const rb of Object.values(ROLLBACK)) assert.ok(!/delete from|truncate/i.test(stripSqlComments(read(rb))), `${rb}: 데이터 무접촉`);
});
