# 실DB 권한 기대상태 (코드 기준)

이 문서는 `supabase/sql/`의 현재 코드가 기대하는 운영 DB 권한 상태다. 실제 운영 DB는 `docs/audit/db_permission_audit_queries.sql`을 Supabase SQL Editor에서 실행한 결과와 1:1로 대조한다.

범위: 함수 EXECUTE 권한, 민감 테이블 RLS/정책, Storage bucket public 플래그, 공개 멘토 RPC. 이번 문서는 읽기 전용 감사 기준이며 DB 변경을 포함하지 않는다.

## 1. Service role 전용 RPC

아래 함수들은 돈, 정산, 캐시 차감, 에스크로, 환불, 개별질문 청구/클레임 경로다. 기대상태는 `anon=false`, `authenticated=false`, `service_role=true` EXECUTE다.

| 함수 | 기대 | 근거 SQL |
| --- | --- | --- |
| `record_cash_topup(uuid, bigint, text)` | service_role 전용 | `020_p0_cash_topup_charge.sql`, `024_p0_cash_topup_service_role_grant.sql`, `072_harden_linter_warnings.sql` |
| `record_subscription_cash_debit(uuid, uuid, uuid, bigint)` | service_role 전용, orphan overload 없음 | `019_p0_subscription_cash_debit.sql`, `023_p0_subscription_cash_debit_service_role_only.sql`, `072_harden_linter_warnings.sql`, `073_fix_exposed_cash_debit.sql`, `073b_drop_orphan_cash_debit.sql` |
| `record_subscription_cash_rollback(uuid, uuid, uuid, bigint)` | service_role 전용 | `019_p0_subscription_cash_debit.sql`, `023_p0_subscription_cash_debit_service_role_only.sql`, `072_harden_linter_warnings.sql` |
| `process_subscription_renewal(uuid, timestamptz, bigint, text, timestamptz)` | service_role 전용 | `068_subscription_renewal_rpc.sql`, `072_harden_linter_warnings.sql` |
| `accept_custom_order_deliverable_atomic(uuid, uuid, boolean)` | service_role 전용 | `043_p1_accept_order_settlement_atomic_rpc.sql`, `055_p0_custom_order_escrow_payout.sql`, `072_harden_linter_warnings.sql` |
| `record_custom_order_escrow_hold(uuid, uuid, bigint)` | service_role 전용 | `054_p0_custom_order_escrow_hold.sql`, `072_harden_linter_warnings.sql` |
| `record_custom_order_escrow_payout(uuid)` | service_role 전용 | `055_p0_custom_order_escrow_payout.sql`, `072_harden_linter_warnings.sql` |
| `record_custom_order_escrow_refund(uuid)` | service_role 전용 | `056_p0_custom_order_escrow_refund.sql`, `072_harden_linter_warnings.sql` |
| `record_custom_order_dispute_split(uuid, integer, integer, uuid)` | service_role 전용 | `057_p0_custom_order_dispute_split.sql`, `072_harden_linter_warnings.sql` |
| `approve_refund_request_admin(uuid, uuid, text)` | service_role/admin RPC only, public clients revoked | `030_p0_refund_approve_reject_admin_rpc.sql`, `056_p0_custom_order_escrow_refund.sql`, `072_harden_linter_warnings.sql` |
| `reject_refund_request_admin(uuid, uuid, text)` | service_role/admin RPC only, public clients revoked | `030_p0_refund_approve_reject_admin_rpc.sql`, `072_harden_linter_warnings.sql` |
| `create_individual_question_with_hold(...)` | service_role 전용 | `070_individual_question_schema_escrow.sql`, `072_harden_linter_warnings.sql` |
| `create_individual_question_with_hold_v2(...)` | service_role 전용 | `080_c_individual_question_qualification.sql` |
| `claim_individual_question(uuid, uuid)` | service_role 전용 | `070_individual_question_schema_escrow.sql`, `072_harden_linter_warnings.sql` |
| `claim_individual_question_v2(uuid, uuid)` | service_role 전용 | `081_d_claim_gate.sql` |
| `release_individual_question_payout(uuid)` | service_role 전용 | `070_individual_question_schema_escrow.sql`, `072_harden_linter_warnings.sql` |
| `refund_individual_question_hold(uuid)` | service_role 전용 | `070_individual_question_schema_escrow.sql`, `072_harden_linter_warnings.sql` |

운영 DB에서 `anon` 또는 `authenticated`가 위 함수 중 하나라도 EXECUTE 가능하면 C-4/H-5 드리프트다. 특히 `073`은 코드와 실DB가 달랐던 기록을 보정하기 위한 파일이므로 `record_subscription_cash_debit` overload를 반드시 확인한다.

## 2. 민감 테이블 RLS 기대상태

| 테이블 | 기대상태 | 근거 SQL |
| --- | --- | --- |
| `payments` | RLS enabled. `SELECT`는 자기 관련 행, `INSERT`는 자기 pending/processing intent. `UPDATE` 정책 0개. | `027_p0_harden_payments_and_question_room_rls.sql` |
| `mentor_student_rooms` | RLS enabled. 참가자 `SELECT`만 유지. `INSERT` 정책 0개, `UPDATE` 정책 0개. 방 생성/변경은 서버/service_role 경로. | `027_p0_harden_payments_and_question_room_rls.sql` |
| `connection_notes` | RLS enabled. `SELECT`는 방 참가자 열람 유지. `INSERT`는 `author_id = auth.uid()` + 방 참가자. `UPDATE/DELETE`는 작성자 본인 + 방 참가자. | `002_p0_subscriptions_questions_draft.sql`, `048_connection_notes_author.sql`, `076_connection_notes_owner_edit.sql`, `085_connection_notes_author_rls.sql` |
| `cash_wallets` | RLS enabled. 자기 지갑 조회만. 직접 쓰기 없음. | `004_p0_cash_disputes_admin_draft.sql` |
| `cash_ledger` | RLS enabled. 자기 원장 조회만. append는 service_role/RPC 경로. | `004_p0_cash_disputes_admin_draft.sql`, `019`, `020`, `054`-`057` |
| `individual_questions` | RLS enabled. 학생/멘토 당사자 중심 select, 클레임/정산/환불 핵심 쓰기는 service_role RPC. | `070_individual_question_schema_escrow.sql`, `080_c_individual_question_qualification.sql`, `081_d_claim_gate.sql` |
| `custom_request_orders` | RLS enabled. 학생/멘토 주문 당사자 select/update 범위. 결제/에스크로 상태 변경은 service_role RPC. | `003_p0_custom_request_draft.sql`, `054`-`057`, `063_gate_deliverable_storage_by_order_completion.sql` |
| `custom_order_message_attachments` | RLS enabled. 주문 학생/멘토/관리자만 메타 접근. Storage도 같은 party/admin 경계. | `083_custom_order_message_attachments.sql` |
| `admin_case_notes` | RLS enabled. `is_admin()` 전용 select/insert/update/delete. 공개 노출 없음. | `084_admin_case_notes.sql` |
| `mentor_profiles` | RLS enabled. 본인 select/insert/update. anon table select 정책 없음. 공개 읽기는 078 v2 whitelist RPC만 사용. | `001_initial_auth_profile.sql`, `078_p0_public_mentor_read_rpc_v2.sql` |
| `mentor_school_verifications` | RLS enabled. 멘토 본인 pending 제출/수정, 관리자 select/update. anon 직접 접근 없음. | `077_mentor_school_verification.sql` |
| `school_tier_catalog` | RLS enabled. active row는 anon/authenticated read, write는 admin. | `079_b_classification_catalog.sql` |
| `school_tier_mappings` | **제거됨(DB-2 C · 2026-09-03)** — 행 0 · 참조 0 이라 DROP. 롤백 시 079 정의(RLS · admin_all 정책 · GRANT)로 재생성. | `079_b_classification_catalog.sql` → `195_drop_school_tier_mappings.sql` |
| `shortform_posts` / `comments` / `community_comments` | RLS enabled. anon/authenticated SELECT 정책(`sf_select_published` · `comments_select_visible` · `community_comments_select_visible`)에 `deleted_at IS NULL`. 관리자(`is_admin()`)는 삭제 행도 읽음. 삭제는 `deleted_at`/`deleted_by`(하드 DELETE 차단 트리거는 오너 결정으로 두지 않음 — 기존 `comments_write_guard` 가 비관리자 DELETE 를 거부). | `194_community_soft_delete_deleted_at.sql` |
| `major_category_catalog` | RLS enabled if applied. classification catalog와 같은 감사 대상. | `079_b_classification_catalog.sql` |
| `shortform_reactions` | RLS enabled. 자기 reaction select/insert/delete. | `082_community_shortform_likes.sql` |

## 3. 공개 멘토 RPC 기대상태

`078_p0_public_mentor_read_rpc_v2.sql` 기준:

| 함수 | anon/authenticated EXECUTE | 기대 반환 범위 |
| --- | --- | --- |
| `mentor_directory_list_v2(int)` | 허용 | `users`의 공개 허용 필드만 |
| `mentor_user_public_v2(uuid)` | 허용 | 단일 멘토 공개 허용 필드만 |
| `mentor_profiles_for_directory_v2(uuid[])` | 허용 | `mentor_profiles` 공개 프로필 필드 + 승인된 학력 표시 필드만 |
| `mentor_directory_list(int)` | 차단 | 구 v1 직접 실행 revoke |
| `mentor_user_public(uuid)` | 차단 | 구 v1 직접 실행 revoke |
| `mentor_profiles_for_directory(uuid[])` | 차단 | 구 v1 직접 실행 revoke |

`mentor_profiles_for_directory_v2`는 `payout_bank_name`, `payout_account_number`, 동의 메타데이터, 문서 경로를 반환하지 않는 whitelist 함수다. 운영 DB에서 구 v1 함수가 anon/authenticated에 열려 있으면 드리프트다.

## 4. Storage bucket 기대상태

아래 버킷은 모두 `storage.buckets.public = false`여야 한다.

| 버킷 | 기대 | 근거 SQL |
| --- | --- | --- |
| `student-id-images` | private | `001_initial_auth_profile.sql`, `039_storage_buckets_private_audit.sql` |
| `custom-order-deliverables` | private | `010_p0_custom_order_deliverable_files_storage.sql`, `039_storage_buckets_private_audit.sql` |
| `custom-request-post-attachments` | private | `012_p0_custom_request_post_attachments_storage.sql`, `039_storage_buckets_private_audit.sql` |
| `community-post-images` | private after 039 | `037_p1_community_board_v2.sql`, `039_storage_buckets_private_audit.sql` |
| `shortform-videos` | private after 039 | `038_p1_shortform_v2.sql`, `039_storage_buckets_private_audit.sql` |
| `shortform-thumbnails` | private after 039 | `038_p1_shortform_v2.sql`, `039_storage_buckets_private_audit.sql` |
| `custom-order-message-attachments` | private | `083_custom_order_message_attachments.sql` |

`community-post-images`, `shortform-videos`, `shortform-thumbnails`는 초기 파일에서 public media처럼 생성된 이력이 있으므로 039 적용 여부를 실DB에서 반드시 확인한다.

## 5. 대조 절차

1. Supabase SQL Editor에서 `docs/audit/db_permission_audit_queries.sql` 전체를 실행한다.
2. 결과를 이 문서의 기대상태와 비교한다.
3. `DRIFT` 또는 기대 0행 쿼리에서 나온 행을 Claude에게 전달한다.
4. 차이가 있으면 새 번호 SQL로 보정안을 만들고, 검토 후 Supabase에 적용한다. 기존 적용 SQL 재번호/수정은 하지 않는다.
