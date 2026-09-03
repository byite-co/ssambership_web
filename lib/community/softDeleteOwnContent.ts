/**
 * 작성자 본인 소프트 삭제 — 정본 RPC `soft_delete_own_content(p_kind, p_id)` (DB-3 SQL 196 · PR-W3)의 순수 규칙.
 *
 * - 웹의 작성자 삭제 경로(숏폼 댓글 · 게시판 댓글)는 전부 이 RPC 하나를 부른다. 직접 UPDATE(`is_deleted = true` · `deleted_at`)는 UPDATE 의
 *   새 행이 SELECT 정책을 통과하지 못해 RLS 가 거부한다(게시판 댓글 본인 삭제가 실제로는 동작하지 않던 결함의 원인).
 * - RPC 는 소유(auth.uid() = 작성자) · 계정 게이트 · 관리자 숨김(moderation) · 멱등을 판정하고 deleted_at/deleted_by 만 기록한다.
 *   감사 로그를 남기지 않는다(사용자 행위) — 관리자 화면은 deleted_by = author_id 를 `작성자 삭제` 로 보여 준다.
 * - 게시판 글은 기존 F6(`community_post_soft_delete`) 경로를 유지한다 — RPC 의 `board_post` 는 경로 통일용이며 웹은 아직 쓰지 않는다.
 * - 숏폼 본인 삭제 UI 는 웹·앱 어느 쪽에도 없다(§0 실측) — RPC 의 `shortform` 은 그 경로가 생길 때 쓴다.
 *
 * node --test 계약 테스트가 직접 import 하므로 React·`@/` import 를 두지 않는다.
 */

export const SOFT_DELETE_OWN_CONTENT_RPC = "soft_delete_own_content";

export const SOFT_DELETE_OWN_CONTENT_KINDS = ["shortform", "shortform_comment", "board_comment", "board_post"] as const;
export type SoftDeleteOwnContentKind = (typeof SOFT_DELETE_OWN_CONTENT_KINDS)[number];

export type SoftDeleteOwnContentArgs = { p_kind: SoftDeleteOwnContentKind; p_id: string };

/** RPC 인자 — 키 이름은 DB 시그니처(p_kind text, p_id uuid) 그대로. */
export function buildSoftDeleteOwnContentArgs(kind: SoftDeleteOwnContentKind, id: string): SoftDeleteOwnContentArgs {
  return { p_kind: kind, p_id: String(id ?? "").trim() };
}

/** 액션이 쓰는 실패 코드 — 기존 게시판 댓글 삭제 계약(`not_found` · `account_blocked` · `db`)에 `moderated` 만 더한다. */
export type SoftDeleteOwnContentErrorCode = "not_found" | "account_blocked" | "moderated" | "db";

/**
 * RPC 예외 메시지(raise exception 의 SQLERRM) → 액션 실패 코드.
 *  - CONTENT_NOT_FOUND · CONTENT_NOT_OWNED · CONTENT_KIND_MISMATCH → not_found(타인·비존재를 구분해 노출하지 않는다 — 구 0행 UPDATE 와 동일)
 *  - ACCOUNT_BANNED · ACCOUNT_SUSPENDED · ACCOUNT_NOT_ACTIVE · ACCOUNT_DELETION_IN_PROGRESS → account_blocked
 *  - CONTENT_MODERATED → moderated(관리자가 숨긴 행은 본인이 지우지 못한다)
 *  - 그 외(AUTH_REQUIRED · INVALID_KIND · 권한 · 네트워크) → db
 */
export function softDeleteOwnContentErrorCode(message: string | null | undefined): SoftDeleteOwnContentErrorCode {
  const m = String(message ?? "").trim();
  if (/^CONTENT_(NOT_FOUND|NOT_OWNED|KIND_MISMATCH)\b/.test(m)) return "not_found";
  if (/^ACCOUNT_(BANNED|SUSPENDED|NOT_ACTIVE|DELETION_IN_PROGRESS)\b/.test(m)) return "account_blocked";
  if (/^CONTENT_MODERATED\b/.test(m)) return "moderated";
  return "db";
}
