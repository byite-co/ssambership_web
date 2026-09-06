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

## 1b. `api_app_v1` 앱 래퍼 기대상태 (DB-4 · 2026-09-05)

앱(authenticated)이 service_role 전용 경로 대신 부르는 SECURITY DEFINER 래퍼다. 기대상태는 전부 `anon=false`, `authenticated=true`, `service_role=false` EXECUTE(M17 앱 계약 §3.3 — service_role 은 앱 공개 계약의 호출자가 아니다) · `search_path=''` · 핵심 로직은 기존 정본에 위임한다. 스키마 `api_app_v1` USAGE 는 authenticated 만.

| 함수 | 위임 정본 | 근거 SQL |
| --- | --- | --- |
| `api_app_v1.subscribe_with_cash(uuid, text, text)` | `api_web_v1.subscription_checkout_confirm_v2`(F12 · service_role 전용 그대로) → 정본 `confirm_subscription_checkout` · `core_private.ensure_student_mentor_room` · initial billing event 는 웹 TS 와 같은 키로 SQL 수행 | `199_api_app_v1_subscribe_with_cash.sql` |
| `api_app_v1.subscription_cancel_at_period_end(uuid)` · `subscription_cancel_undo(uuid)` | `subscriptions.cancel_at_period_end/cancel_requested_at` 본인 행(웹 액션 동일) | `199_api_app_v1_subscribe_with_cash.sql` |
| `core_private.subscription_refund_estimate_impl(uuid, timestamptz)` | **외부 EXECUTE 0**(anon/authenticated/service_role 전부 false) — 별표 4 계산 정본(웹 TS 이식) | `200_api_app_v1_refund_request.sql` |
| `api_app_v1.refund_estimate(uuid)` · `refund_request_create(uuid, text)` | 위 impl · `refunds` pending INSERT(`refund_ins` 관리자 전용 정책은 불변 — 래퍼가 SECDEF 로 우회) | `200_api_app_v1_refund_request.sql` |
| `api_app_v1.mentor_activity_set(text, timestamptz, timestamptz, text)` | 웹 `mentorActivityService.ts` 규칙 이식(DB 코어 없음) · 알림은 158 트리거 | `201_api_app_v1_mentor_activity_set.sql` |
| `api_app_v1.mentor_plan_active_set(text, boolean)` | `mentor_plans.is_active` 본인 행(F8 은 가격만 · 불변) | `202_api_app_v1_mentor_plan_active_set.sql` |
| `api_app_v1.user_profile_update_self_v2(text, text, text)` | `core_private.user_profile_update_self_impl`(v1 시그니처 불변) + `users.student_status` | `203_api_app_v1_student_status_student_id_document.sql` |
| `api_app_v1.mentor_student_id_document_set_self(text)` | `storage.objects` 소유 검증(139 동일) → `mentor_profiles.student_id_image_url` | `203_api_app_v1_student_status_student_id_document.sql` |
| `api_app_v1.create_individual_question_as_student_v2(text, text, text, integer, uuid, text, text)` | 코어 `create_individual_question_with_hold_v2`(service_role 전용 그대로) · v1 `public.create_individual_question_as_student` 불변 | `204_api_app_v1_individual_question_create_v2.sql` |

census 기대: `api_app_v1` 함수 16(M17 5 + 20260803162257 1 + DB-4 10) · `core_private` 8(7 + 1). public 함수/정책/테이블/버킷 수는 DB-4 로 변하지 않는다(`scripts/verify/baseline/verify_local_stack_state.sh` [4c]).

## 1c. DB-5 배포 전 서버 객체 기대상태 (2026-09-06)

| 객체 | 기대 | 근거 SQL |
| --- | --- | --- |
| `public.plan_price_stats()` | SECURITY DEFINER · STABLE · search_path '' · `anon=true`, `authenticated=true`, `service_role=true` EXECUTE(비로그인 메인 · 집계 6열만 — 멘토별 단가 비노출) | `205_plan_price_stats.sql` |
| `users.profile_completed_at` | timestamptz NULL 허용 · 기존 전원 `created_at` 백필 · NULL = 소셜 가입 후 완성 전 | `206_social_signup_profile_completion.sql` |
| `users.role` | **NULL 허용**(NOT NULL 완화) + CHECK `users_role_required_when_completed (role is not null or profile_completed_at is null)` · `users_role_check`(student/mentor/admin) 유지 · 임시 역할값 없음 | `206` |
| `public.handle_new_auth_user()` | `raw_user_meta_data ? 'app_role'` 없으면 소셜 경로(role NULL · 프로필 행 0) · 있으면 122 정규화 + `profile_completed_at = now()` · 본문은 `core_private.user_signup_provision_impl` 위임 | `206` |
| `core_private.user_signup_provision_impl(uuid, text, text, text, text, text, text, date, boolean, boolean, boolean, text, text, text[], text, text, timestamptz)` | **외부 EXECUTE 0** — 트리거 두 경로 + `complete_profile` 공유 정본 | `206` |
| `public.enforce_users_role_guard()` | 119 원문 + 완성 전(role NULL · profile_completed_at NULL) 행의 student/mentor 최초 부여만 추가 허용 | `206` |
| `core_private.user_profile_update_self_impl(uuid, text, text)` | 20260803162257 D 원문 + `v_role is null` 명시 거부(ROLE_NOT_ALLOWED) · ACL 불변(외부 0) | `206` |
| `public.user_profile_completed()` | SECURITY DEFINER · STABLE · `anon=true`, `authenticated=true` EXECUTE(정책 식에서 호출) | `206` |
| 쓰기 정책 18종(`favorites_insert_own` · `ub_insert_own` · `content_reports_insert_reporter` · `fqu_insert_own` · `payments_insert_intent` · `ver_logs_insert_own` · `device_tokens_modify_own` · `notif_settings_modify_own` · `ai_drafts_insert_own` · `withdrawals_insert_self_requested` · `crp_insert` · `cra_insert` · `cro_insert` · 레거시 `학생만 의뢰 등록` · `멘토만 지원` · `당사자만 메시지 전송` · `멘토만 납품 업로드` · `관리자만 로그 기록`) | 원문 + `AND public.user_profile_completed()` · 이름·명령·역할·permissive 불변 · 정책 수 175 불변 | `206` |
| `api_app_v1.complete_profile(text, text, date, boolean, boolean, text, text, text)` | `anon=false`, `authenticated=true`, `service_role=false` · SECDEF · search_path '' · impl 위임 · `user_consent_records` 미기록 | `206` |
| `api_app_v1.create_individual_question_as_student_v3(text, text, text, integer, uuid, text, text, text, text, text)` | 204 와 동일 ACL(authenticated 만) · v2 본문 복제 + topic·자격 · 코어 v2 위임 · v1·v2 불변 | `207_api_app_v1_individual_question_create_v3.sql` |
| `core_private.review_eligibility_impl(uuid, uuid)` | **외부 EXECUTE 0** · 결제 2회(누적) 판정 정본 | `208_review_eligibility_paid_twice.sql` |
| `public.check_review_eligibility(uuid, uuid)` | 170 과 같은 시그니처·boolean·STABLE·SECDEF·ACL(anon 0 · authenticated) · 본문만 impl 위임 · 정책 `reviews_insert_student` 불변 | `208` |
| `api_app_v1.review_eligibility_self(uuid)` | `anon=false`, `authenticated=true`, `service_role=false` | `208` |

census 기대: `api_app_v1` 함수 19(16 + 3) · `core_private` 10(8 + 2) · public 함수 230(228 + `plan_price_stats` + `user_profile_completed`) · 정책 175 · 테이블 84 · 버킷 13 불변(`scripts/verify/baseline/verify_local_stack_state.sh` [4]·[4c]).

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
| `shortform_posts` / `comments` / `community_comments` | RLS enabled. anon/authenticated SELECT 정책(`sf_select_published` · `comments_select_visible` · `community_comments_select_visible`)에 `deleted_at IS NULL`. 관리자(`is_admin()`)는 삭제 행도 읽음. 삭제는 `deleted_at`/`deleted_by` 만 — 작성자 본인은 `soft_delete_own_content(p_kind, p_id)`(SECURITY DEFINER · anon EXECUTE false · authenticated/service_role true · 감사 로그 없음), 관리자는 service_role 코어(PR-W2 UPDATE). **하드 DELETE 는 BEFORE DELETE 트리거 3종(`trg_*_no_delete` → `ugc_block_hard_delete()`)이 anon/authenticated(관리자 세션 포함)에 거부**(UGC_HARD_DELETE_FORBIDDEN) · service_role/postgres/supabase_auth_admin 통과(DB-3 C · 2026-09-03 — DB-2 에서 뺐던 것을 §0 판정 후 재도입). | `194_community_soft_delete_deleted_at.sql`, `196_soft_delete_own_content_rpc.sql`, `198_ugc_block_hard_delete.sql` |
| `realtime.messages` (Realtime Broadcast/Presence 인가) | RLS enabled(플랫폼 기본). 정책 2종 `realtime_admin_topic_select`(SELECT) · `realtime_admin_topic_insert`(INSERT) — to authenticated · `realtime.topic() like 'admin:%' and is_admin()`. 그 외 토픽 정책 0(private 채널 거부 · public 채널·postgres_changes 는 이 테이블을 쓰지 않음). 웹 PR-2b Presence 채널 `admin:mentor-approval` 은 `private: true` + `realtime.setAuth()`. | `197_realtime_admin_topic_private.sql` |
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
