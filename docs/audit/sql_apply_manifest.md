# SQL 적용순서 매니페스트

이 문서는 `supabase/sql/`의 현재 SQL 파일 목록, 숫자 접두어 중복, fresh DB 기준 권장 적용 순서를 정리한다. 이미 운영 DB에 적용된 마이그레이션은 재번호하지 않는다. 중복 번호는 이력 보존 대상으로 취급하고, 미적용 파일만 팀 합의 후 다음 빈 번호로 복제/정리한다.

현재 다음 신규 번호: `086`.

## 원칙

- 기존 적용 SQL 파일은 수정하거나 재번호하지 않는다.
- 보안 보정은 항상 새 번호 파일로 추가한다.
- 같은 숫자 접두어 파일이 있으면 파일명과 의존 주석을 함께 보고 적용 순서를 결정한다.
- `073`, `073b`처럼 뒤늦은 실DB 드리프트 보정 파일은 정규 번호 뒤에 이어 적용된 보정으로 간주한다.
- `071_individual_question_test_data_cleanup.sql`은 one-off 정리 스크립트로, 일반 fresh DB 마이그레이션 필수 목록과 분리한다.

## 숫자 접두어 중복

| 번호 | 파일 | 판정/조치 |
| --- | --- | --- |
| `002` | `002_app_core_schema_draft.sql`, `002_p0_subscriptions_questions_draft.sql`, `002_custom_request_orders_status.sql` | 이미 존재하는 중복. 재번호 금지. fresh DB에서는 `001` 이후 core/qna를 먼저 보고, `002_custom_request_orders_status.sql`은 `003` 이후 적용 의존. |
| `032` | `032_p0_weekly_question_usage.sql`, `032_p1_admin_content_reports.sql` | 이미 존재하는 중복. 각각 QnA usage와 admin content reports로 독립. 재번호 금지. |
| `033` | `033_question_threads_topic.sql`, `033_p1_admin_reviews_moderation.sql` | 이미 존재하는 중복. reviews moderation은 `042_reviews_system.sql` 이후 의존. 재번호 금지. |
| `034` | `034_mentor_favorites.sql`, `034_p1_admin_disputes_processing.sql` | 이미 존재하는 중복. favorites와 admin disputes로 독립. 재번호 금지. |
| `039` | `039_p1_custom_request_compat.sql`, `039_storage_buckets_private_audit.sql` | 이미 존재하는 중복. Storage private audit는 보안상 반드시 적용 여부 확인. 재번호 금지. |
| `053` | `053_community_rls_legacy_select_cleanup.sql`, `053b_shortform_posts_published_select_rls.sql` | 숫자 접두어 기준 중복/variant. `053b`는 `053` 이후 보정으로 유지. |
| `073` | `073_fix_exposed_cash_debit.sql`, `073b_drop_orphan_cash_debit.sql` | 숫자 접두어 기준 중복/variant. 실DB 함수 권한 드리프트 보정. `073b`는 orphan overload 제거 확인용 후속. |

## Fresh DB 권장 적용 흐름

아래는 파일명 숫자순을 기본으로 하되, 중복 번호와 의존 관계를 반영한 큰 흐름이다. 운영 DB 재실행 순서가 아니라 신규 환경 부트스트랩 검토용이다.

1. Base auth/profile: `001_initial_auth_profile.sql`.
2. Core/QnA base: `002_app_core_schema_draft.sql`, `002_p0_subscriptions_questions_draft.sql`.
3. Custom request base: `003_p0_custom_request_draft.sql` 이후 `002_custom_request_orders_status.sql`.
4. Cash/disputes/community draft: `004_p0_cash_disputes_admin_draft.sql`.
5. Public read and custom request hardening: `005`-`018`.
6. Cash/payment/subscription security: `019`-`030`, 특히 `023`, `024`, `027`, `028`, `029`는 direct client write 차단 기준.
7. Admin/content/community feature files: `031`-`042`. 단 `033_p1_admin_reviews_moderation.sql`은 `042_reviews_system.sql` 이후 적용 의존이 있으므로 fresh DB에서는 순서를 조정한다.
8. Settlement/review/free-question/connection-note/storage follow-ups: `043`-`053b`.
9. Custom order escrow: `054`-`057`.
10. Attachments, AI readiness, subscription/review follow-ups: `058`-`069`.
11. Individual question escrow and cleanup: `070`; `071`은 one-off cleanup이므로 운영/fresh 적용 전 별도 승인 필요.
12. Security hardening and C/D follow-ups: `072`-`085`. `073`/`073b`, `078`, `083`, `084`, `085`는 출시 전 보안 점검에서 특히 대조한다.

## 전체 SQL 파일 목록

| 번호 | 중복 | 파일 | 설명 |
| --- | --- | --- | --- |
| 001 |  | `001_initial_auth_profile.sql` | Supabase SQL Editor에 붙여넣어 한 번에 실행하세요. (필요 시 팀에서 마이그레이션으로 옮깁니다.) |
| 002 | yes | `002_app_core_schema_draft.sql` | [의존 순서] 이 파일은 001_initial_auth_profile.sql 이후 적용할 것 |
| 002 | yes | `002_custom_request_orders_status.sql` | [의존 순서] 이 파일은 003_p0_custom_request_draft.sql 이후 적용할 것 |
| 002 | yes | `002_p0_subscriptions_questions_draft.sql` | [의존 순서] 이 파일은 001_initial_auth_profile.sql 이후 적용할 것 |
| 003 |  | `003_p0_custom_request_draft.sql` | DRAFT P0 (003) — 맞춤의뢰(포스트·지원·주문) + 주문–결제 연결 + 납품/리비전/메시지/이벤트 |
| 004 |  | `004_p0_cash_disputes_admin_draft.sql` | DRAFT P0 (004) — 캐시(지갑/원장/충전패키지) · 분쟁/환불 · 커뮤니티(숏폼/게시) · 멘토플랜/리뷰 |
| 005 |  | `005_p0_public_mentor_read_rpc.sql` | P0: 공개 멘토 목록/상세를 위한 읽기 RPC (001 users·mentor_profiles RLS “본인만” 보완) |
| 006 |  | `006_p0_custom_request_public_post_browse_rpc.sql` | P0: 멘토가 맞춤의뢰 공개 상세(/custom-request/[id])를 읽기 위한 최소 열 RPC |
| 007 |  | `007_p0_custom_order_revisions_and_order_events_rls.sql` | P0: 학생(의뢰자) 전용 수정 요청 insert, order_events insert(주문 당사자) |
| 008 |  | `008_p0_disputes_insert_party_rls.sql` | P0: 맞춤의뢰 주문방 — disputes insert 를 학생·멘토(주문 당사자)로 제한. |
| 009 |  | `009_p0_disputes_submitted_by_and_active_unique.sql` | P0: 맞춤의뢰 disputes — submitted_by(감사) + active 분쟁 1건만(부분 유니크 인덱스) |
| 010 |  | `010_p0_custom_order_deliverable_files_storage.sql` | P0: 맞춤의뢰 납품 첨부 — private Storage 버킷 + custom_order_deliverables 메타 컬럼 + storage.objects RLS |
| 011 |  | `011_p0_custom_order_deliverable_version_unique.sql` | P0: 동일 주문(custom_request_order_id)에 동일 version 의 납품이 2건 이상 생기지 않도록 DB 제약 |
| 012 |  | `012_p0_custom_request_post_attachments_storage.sql` | P0: 맞춤의뢰 등록 첨부 — private Storage + custom_request_post_attachments + storage.objects RLS |
| 013 |  | `013_p0_custom_order_settlement_items.sql` | P0: 맞춤의뢰 주문 — 멘토 정산 예정(1차) + 금액·상태 메타 |
| 014 |  | `014_p0_harden_custom_order_settlement_items.sql` | P0 보강: custom_order_settlement_items — RLS(학생 직접 insert 제거) + 금액·요율 CHECK |
| 015 |  | `015_p0_prevent_settlement_during_active_dispute.sql` | P0: 진행 중 분쟁이 있을 때 custom_order_settlement_items INSERT 차단 (RLS·service role 모두 동일) |
| 016 |  | `016_p0_community_comments.sql` | 커뮤니티 게시판/숏폼 공용 댓글 (post_type + post_id로 글을 가리킴, FK는 게시글 테이블에 직접 연결하지 않음) |
| 017 |  | `017_p0_community_author_role_compat.sql` | P0: community_posts / shortform_posts — author_role (앱 insert와 스키마 정렬) |
| 018 |  | `018_p0_mentor_list_open_custom_request_posts.sql` | P0: Mentor/admin browse list for open custom request posts. |
| 019 |  | `019_p0_subscription_cash_debit.sql` | P0: 구독 체크아웃 — 캐시 원장 차감 + 지갑을 단일 DB 함수(원자적 트랜잭션)에서 처리 |
| 020 |  | `020_p0_cash_topup_charge.sql` | P0: 캐시 충전 — 원장(양수) + 지갑 증가를 한 트랜잭션에서 처리 |
| 021 |  | `021_p0_refund_ins_admin_only.sql` | refunds INSERT: admin만 허용 (public.is_admin() = true) |
| 022 |  | `022_p0_subscription_cash_debit_grants.sql` | p0 subscription cash debit grants |
| 023 |  | `023_p0_subscription_cash_debit_service_role_only.sql` | p0 subscription cash debit service role only |
| 024 |  | `024_p0_cash_topup_service_role_grant.sql` | p0 cash topup service role grant |
| 025 |  | `025_p0_payments_drop_update_own.sql` | p0 payments drop update own |
| 026 |  | `026_p0_msr_insert_subscription_check.sql` | p0 msr insert subscription check |
| 027 |  | `027_p0_harden_payments_and_question_room_rls.sql` | 027 P0 harden payments and mentor_student_rooms RLS |
| 028 |  | `028_p0_lock_subscriptions_writes.sql` | P0: block authenticated direct INSERT/UPDATE on subscription tables. |
| 029 |  | `029_p0_lock_subscription_deletes.sql` | P0: remove authenticated DELETE (and listed FOR ALL / self_rw) policies on subscription tables. |
| 030 |  | `030_p0_refund_approve_reject_admin_rpc.sql` | P0: 관리자 환불 승인/거절 — 단일 트랜잭션 RPC (service_role 전용) |
| 031 |  | `031_p1_admin_notices_promotions.sql` | P1: 관리자 공지(app_notices) · 프로모션(promotion_campaigns) |
| 032 | yes | `032_p0_weekly_question_usage.sql` | [의존 순서] 이 파일은 002_p0_subscriptions_questions_draft.sql 이후 적용할 것 |
| 032 | yes | `032_p1_admin_content_reports.sql` | [의존 순서] 이 파일은 001_initial_auth_profile.sql 이후 적용할 것 |
| 033 | yes | `033_p1_admin_reviews_moderation.sql` | [의존 순서] 이 파일은 042_reviews_system.sql 이후 적용할 것 |
| 033 | yes | `033_question_threads_topic.sql` | [의존 순서] 이 파일은 002_p0_subscriptions_questions_draft.sql 이후 적용할 것 |
| 034 | yes | `034_mentor_favorites.sql` | [의존 순서] 이 파일은 001_initial_auth_profile.sql 이후 적용할 것 |
| 034 | yes | `034_p1_admin_disputes_processing.sql` | [의존 순서] 이 파일은 004_p0_cash_disputes_admin_draft.sql 이후 적용할 것 |
| 035 |  | `035_p1_admin_audit_logs.sql` | 035_p1_admin_audit_logs.sql |
| 036 |  | `036_p1_prelaunch_rls_tightening.sql` | 036_p1_prelaunch_rls_tightening.sql |
| 037 |  | `037_p1_community_board_v2.sql` | 커뮤니티 게시판 v2: community_posts 확장, comments(2depth), post_reactions, community_hashtags, 이미지 Storage |
| 038 |  | `038_p1_shortform_v2.sql` | 숏폼 v2: video_url, thumbnail, tags, status, counts, Storage bucket |
| 039 | yes | `039_p1_custom_request_compat.sql` | [의존 순서] 이 파일은 003_p0_custom_request_draft.sql 이후 적용할 것 |
| 039 | yes | `039_storage_buckets_private_audit.sql` | [의존 순서] 이 파일은 001_initial_auth_profile.sql 이후 적용할 것 |
| 040 |  | `040_admin_action_logs.sql` | 관리자 활동 로그 (백오피스 감사) |
| 041 |  | `041_mentor_payout_account.sql` | 멘토 정산 계좌 (마스킹 표시용) |
| 042 |  | `042_reviews_system.sql` | 멘토 리뷰 (학생 작성, 멘토 답글 1회, 관리자 숨김) |
| 043 |  | `043_p1_accept_order_settlement_atomic_rpc.sql` | P1: 학생 납품 수락 + 정산 예정 insert — 단일 트랜잭션 (service_role 전용 RPC) |
| 044 |  | `044_free_question_usage.sql` | P2: 무료 질문권 사용 기록 (학생당 15회·멘토당 3회 — 앱에서 count) |
| 045 |  | `045_review_eligibility_guard.sql` | 045_review_eligibility_guard.sql |
| 046 |  | `046_free_question_usage_db_guard.sql` | 046_free_question_usage_db_guard.sql |
| 047 |  | `047_active_dispute_settlement_block_trigger.sql` | 047_active_dispute_settlement_block_trigger.sql |
| 048 |  | `048_connection_notes_author.sql` | STEP 2: 연결노트 작성자 식별 컬럼 추가 |
| 049 |  | `049_question_room_attachments_storage.sql` | STEP 5: 질문방 채팅 파일/사진 첨부 — private Storage 버킷 + storage.objects RLS |
| 050 |  | `050_mentor_subscription_cap.sql` | 050_mentor_subscription_cap.sql |
| 051 |  | `051_community_typo_author_label_category_backfill.sql` | 051 community comments 오타 백필 + community_posts category 기본값 (실제 존재 컬럼만) |
| 052 |  | `052_free_question_policy_7_total_7day_expiry.sql` | 052_free_question_policy_7_total_7day_expiry.sql |
| 053 | yes | `053_community_rls_legacy_select_cleanup.sql` | 053 community RLS cleanup (is_mentor 의존 제거, 안전/idempotent 버전) |
| 053b | yes | `053b_shortform_posts_published_select_rls.sql` | 053b: shortform_posts 공개 SELECT RLS |
| 054 |  | `054_p0_custom_order_escrow_hold.sql` | P0: 맞춤의뢰 예치(에스크로 hold) — 학생 캐시 차감 + cash_ledger append-only |
| 055 |  | `055_p0_custom_order_escrow_payout.sql` | P0: 맞춤의뢰 에스크로 2단계 — 납품 수락 시 멘토 지급 + settlement paid + payment_status paid |
| 056 |  | `056_p0_custom_order_escrow_refund.sql` | P0: 맞춤의뢰 에스크로 3단계 — 예치 전액 학생 반환(취소·환불) + 관리자 환불 연동 |
| 057 |  | `057_p0_custom_order_dispute_split.sql` | P0: 맞춤의뢰 에스크로 4단계-A — 분쟁 예치 분배(멘토 gross·학생 환불, 20% 공제) |
| 058 |  | `058_mentor_student_nickname_rpc.sql` | P0: 멘토 맞춤의뢰 화면 — 의뢰자 닉네임/이름 표시용 RPC |
| 059 |  | `059_p0_custom_request_application_attachments_storage.sql` | P0: 멘토 지원서 포트폴리오 첨부 — private Storage + custom_request_application_attachments + storage.objects RLS |
| 060 |  | `060_ai_readiness_question_schema.sql` | 060_ai_readiness_question_schema.sql |
| 061 |  | `061_review_consecutive_and_response_time.sql` | 061_review_consecutive_and_response_time.sql |
| 062 |  | `062_custom_request_order_unique_active_application.sql` | 062_custom_request_order_unique_active_application.sql |
| 063 |  | `063_gate_deliverable_storage_by_order_completion.sql` | 063_gate_deliverable_storage_by_order_completion.sql |
| 064 |  | `064_subscription_billing_period_schema.sql` | 064_subscription_billing_period_schema.sql |
| 065 |  | `065_anchor_weekly_question_usage.sql` | 065_anchor_weekly_question_usage.sql |
| 066 |  | `066_review_eligibility_billing_events.sql` | 066_review_eligibility_billing_events.sql |
| 067 |  | `067_mentor_subscription_pricing.sql` | 067_mentor_subscription_pricing.sql |
| 068 |  | `068_subscription_renewal_rpc.sql` | 068_subscription_renewal_rpc.sql |
| 069 |  | `069_subscription_cancel_refund_request.sql` | 069_subscription_cancel_refund_request.sql |
| 070 |  | `070_individual_question_schema_escrow.sql` | 070_individual_question_schema_escrow.sql |
| 071 |  | `071_individual_question_test_data_cleanup.sql` | 071_individual_question_test_data_cleanup.sql  (one-off 정리 스크립트, 마이그레이션 아님) |
| 072 |  | `072_harden_linter_warnings.sql` | 072_harden_linter_warnings.sql |
| 073 | yes | `073_fix_exposed_cash_debit.sql` | 073_fix_exposed_cash_debit.sql |
| 073b | yes | `073b_drop_orphan_cash_debit.sql` | 073b_drop_orphan_cash_debit.sql |
| 074 |  | `074_subjects_subdivision.sql` | 074_subjects_subdivision.sql |
| 075 |  | `075_individual_question_transfers.sql` | 075_individual_question_transfers.sql |
| 076 |  | `076_connection_notes_owner_edit.sql` | 076_connection_notes_owner_edit.sql |
| 077 |  | `077_mentor_school_verification.sql` | 077_mentor_school_verification.sql |
| 078 |  | `078_p0_public_mentor_read_rpc_v2.sql` | 078_p0_public_mentor_read_rpc_v2.sql |
| 079 |  | `079_b_classification_catalog.sql` | 079_b_classification_catalog.sql |
| 080 |  | `080_c_individual_question_qualification.sql` | 080_c_individual_question_qualification.sql |
| 081 |  | `081_d_claim_gate.sql` | 081_d_claim_gate.sql |
| 082 |  | `082_community_shortform_likes.sql` | 082_community_shortform_likes.sql |
| 083 |  | `083_custom_order_message_attachments.sql` | 083_custom_order_message_attachments.sql |
| 084 |  | `084_admin_case_notes.sql` | 084_admin_case_notes.sql |
| 085 |  | `085_connection_notes_author_rls.sql` | 085_connection_notes_author_rls.sql |
## v16(1) 잔여 작업 적용 기록 (ssambership-staging `lbeqxarxothkmzqvpudy`)

> 이 저장소 브랜치(`claude/v16-web-db-autonomous-*`)는 `main` 기준이며 SQL 파일은 121까지만 포함한다.
> 122–129 번호대는 미머지 PR(#31=120, #33=121, #34=122–125, 기타 숏폼/리뷰 계열)에서 예약 중이므로,
> 신규 파일은 충돌을 피하기 위해 **130 이상**을 사용한다. (staging DB 는 이 브랜치보다 앞서 있어
> `notification_outbox`·`record_domain_notification` 등 저장소에 원본이 없는 객체가 이미 존재한다 —
> 이들은 재생성하지 않고 그대로 재사용한다.)

| 번호 | 적용 | 파일 | 비고 |
| --- | --- | --- | --- |
| 130 | yes | `130_p1_8a_question_room_atomic_rpc.sql` | P1-8A. `free_question_usage.thread_id` 수렴(FK ON DELETE SET NULL) + 원자 RPC 5종(`qna_create_free_question_thread`/`qna_append_message`/`qna_confirm_thread`/`qna_flag_wrong_answer`/`qna_register_attachment`). SECURITY DEFINER, execute={authenticated,service_role} (anon revoke). 기존 direct-write 정책·GRANT 는 유지(앱 전환 전 P1-8B 로 이관). rollback-only fixture 14/14 PASS. 동시성(독립 2세션) 미검증 = BLOCKED_ENV. |
| 131 | yes | `131_p3_8_realtime_messages_threads.sql` | P3-8. `supabase_realtime` publication 에 `question_messages`·`question_threads` 추가(117 은 attachments 만). 멱등. SELECT RLS 로 당사자만 수신. 적용 후 3테이블 멤버십 확인. |
| 132 | yes | `132_p3_9_student_nickname_rpc_anon_revoke.sql` | P3-9(부분). PII 반환 `get_mentor_student_nicknames(uuid[])` 의 anon/public EXECUTE 회수(심층방어). 나머지 P3-9(인가 집합 재정의)는 제품 결정 대기. |

## 출시 전 대조 포인트

- `023`, `024`, `072`, `073`, `073b`: 민감 RPC가 실DB에서 `anon`/`authenticated`에 열려 있지 않은지 확인한다.
- `027`: `payments` UPDATE 정책 0개, `mentor_student_rooms` INSERT/UPDATE 정책 0개를 확인한다.
- `039`: 필수 Storage 버킷이 `public=false`인지 확인한다.
- `078`: 공개 멘토 read는 v2 whitelist RPC만 열리고 구 v1 RPC는 닫혔는지 확인한다.
- `083`: 맞춤의뢰 주문 메시지 첨부 메타/Storage 접근이 주문 당사자와 관리자에만 열려 있는지 확인한다.
- `084`: 관리자 내부 case note는 `is_admin()` 전용인지 확인한다.
- `085`: `connection_notes` write 정책이 `author_id = auth.uid()`를 포함하는지 확인한다.

## 사용자 실행 절차

1. `docs/audit/db_permission_audit_queries.sql`을 Supabase SQL Editor에서 실행한다.
2. 결과를 `docs/audit/db_expected_state.md`와 대조한다.
3. 차이가 있으면 결과를 Claude에게 전달해 드리프트 목록과 새 보정 SQL 초안을 만든다.
4. 보정 SQL도 기존 SQL 수정이 아니라 다음 빈 번호로 생성한다.
