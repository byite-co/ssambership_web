# Supabase ↔ 웹 상호작용 전수조사 맵

> 조사일: 2026-07-27 · 기준 브랜치: `claude/supabase-sql-web-paths-8n8whb` (main `a1841ef` 기준)
> `supabase/sql/*.sql` 190개 파일과 웹 코드(`app/`, `lib/`, `components/`, `hooks/`, `scripts/`, `e2e/`)를
> 전수 grep 교차 대조한 결과입니다. 대조 방법은 문서 말미 §10 참고.

## 요약 수치

| 항목 | 수치 |
|------|------|
| SQL 파일 | 190개 (`supabase/sql/`) + 번들 3개 (`supabase/bundles/`) |
| SQL 정의 함수 | 193개 |
| 웹이 `.rpc()`로 직접 호출하는 함수 | **52개** (리터럴 51 + 상수 경유 1) |
| 웹 미호출 함수(트리거·RLS 헬퍼·내부 헬퍼·모바일·레거시·배치) | 141개 |
| SQL이 생성하는 테이블 | 77개 + 뷰 1개(`due_payouts`) |
| 웹이 `.from()`으로 접근하는 테이블 | 정적 51개 + 동적 5개 |
| Storage 버킷 | 13개 (웹 미사용 1: `scan-annotations`) |
| Realtime publication 테이블 | 2개 (`question_messages`, `question_threads`) — **웹 구독 없음** |
| 웹 cron 엔드포인트 | 3개 (vercel.json 등록은 2개) |

---

## §1. 웹 → Supabase 접속 경로 (클라이언트 4종)

| 파일 | 키 | 용도 |
|------|-----|------|
| `lib/supabase/client.ts` | anon/publishable | 브라우저(`createBrowserClient`) — 클라이언트 컴포넌트 |
| `lib/supabase/server.ts` | anon + 쿠키 세션 | 서버 컴포넌트·server action(`createServerClient`) — RLS 적용 호출 |
| `lib/supabase/appSurfaceServer.ts` | anon + 강화 쿠키 | 앱(WebView) 표면 전용 서버 클라이언트 |
| `lib/supabase/admin.ts` | `SUPABASE_SERVICE_ROLE_KEY` | 서버 전용, RLS 우회 — service_role 전용 RPC·배치·관리자 처리 |

`auth.admin.*` 직접 사용: `deleteUser`(계정삭제 saga: `lib/account/accountDeletionAdapters.ts`, `accountDeletionActions.ts`), `getUserById`·`updateUserById`(`lib/auth/mentorSignupStudentIdAction.ts`).

---

## §2. 웹이 호출하는 RPC 전수 매핑 (52개)

정의 SQL은 최초 정의 + 이후 재정의(behavior 변경) 파일을 모두 표기.

### 2-1. 구독·결제·캐시

| RPC | 정의/개정 SQL | 웹 호출 지점 |
|-----|--------------|--------------|
| `record_subscription_cash_debit` | 019, 022, 023, 072, 073 | `lib/subscribe/subscribeCheckoutService.ts` |
| `confirm_subscription_checkout` | 131, 143, 145 | `lib/subscribe/subscribeCheckoutService.ts` |
| `process_subscription_renewal` | 068, 072, 100 | `lib/subscribe/subscriptionRenewalBatch.ts` (← cron) |
| `record_cash_topup` | 020, 024, 072 | `lib/cash/walletTopupActions.ts`, `lib/toss/cashTopupFromPayment.ts` (← Toss confirm/webhook) |
| `refresh_subscription_settlement_items` | 086, 095, 105 | `lib/mentor/subscriptionSettlementItems.ts` |
| `approve_refund_request_admin` | 030, 056, 072, 099, 128 | `lib/admin/refundActions.ts`, `lib/admin/bulkActions.ts`(변수 rpc) |
| `reject_refund_request_admin` | 030, 072 | `lib/admin/refundActions.ts`, `lib/admin/bulkActions.ts`(변수 rpc) |

### 2-2. 질문방(QnA)·주간 사용량

| RPC | 정의/개정 SQL | 웹 호출 지점 |
|-----|--------------|--------------|
| `qna_create_question_thread` | 136, 142 | `lib/qna/questionRoomRpc.ts` |
| `qna_append_message` | 136, 142 | `lib/qna/questionRoomRpc.ts` |
| `qna_confirm_thread` | 136 | `lib/qna/questionRoomRpc.ts` |
| `qna_flag_wrong_answer` | 136 | `lib/qna/questionRoomRpc.ts` |
| `qna_register_attachment` | 136, 139, 142 | `lib/qna/questionRoomRpc.ts` |
| `get_weekly_question_usage` | 032, 065, 098 | `lib/qna/weeklyQuestionUsage.ts` |
| `get_mentor_student_nicknames` | 058, 138, 140 | `lib/qna/questionRoomMentorContext.ts`, `lib/customRequest/mentorDashboardOrderEnrichment.ts` |

### 2-3. 개별 질문(에스크로)

| RPC | 정의/개정 SQL | 웹 호출 지점 |
|-----|--------------|--------------|
| `create_individual_question_with_hold` (v1 폴백) | 070, 072 | `lib/individualQuestion/individualQuestionActions.ts` |
| `create_individual_question_with_hold_v2` | 080 | `lib/individualQuestion/individualQuestionActions.ts` |
| `claim_individual_question_v2` | 081 | `lib/individualQuestion/individualQuestionActions.ts` |
| `release_individual_question_payout` | 070, 072, 096, 109 | `lib/individualQuestion/individualQuestionActions.ts` |
| `refund_individual_question_hold` | 070, 072 | `lib/individualQuestion/individualQuestionExpiryBatch.ts` (← cron) |
| `list_open_individual_questions_for_mentor` | 070 | `lib/individualQuestion/individualQuestionQueries.ts` |
| `set_individual_question_price` | 094 | `lib/mentor/mentorProfileMutations.ts` |

### 2-4. 맞춤의뢰(에스크로·상태전이)

| RPC | 정의/개정 SQL | 웹 호출 지점 |
|-----|--------------|--------------|
| `record_custom_order_escrow_hold` | 054, 072 | `lib/customRequest/customOrderEscrowService.ts` |
| `record_custom_order_escrow_refund` | 056, 072 | `lib/customRequest/customOrderEscrowService.ts` |
| `record_custom_order_dispute_split` | 057, 072, 125 | `lib/customRequest/customOrderDisputeSplitService.ts` |
| `accept_custom_order_deliverable_atomic` | 043, 055, 072, 090, 110 | `lib/customRequest/orderSettlementService.ts` |
| `custom_order_mentor_start` | 088 | `lib/customRequest/orderTransitionRpc.ts` |
| `custom_order_mentor_deliver` | 088 | `lib/customRequest/orderTransitionRpc.ts` |
| `custom_order_student_request_revision` | 088 | `lib/customRequest/orderTransitionRpc.ts` |
| `get_public_custom_request_post_for_browse` | 006 | `lib/customRequest/customRequestQueries.ts` |
| `list_open_custom_request_posts_for_mentor_browse` | 018 | `lib/customRequest/customRequestQueries.ts` |

### 2-5. 멘토 공개 읽기·리뷰

| RPC | 정의/개정 SQL | 웹 호출 지점 |
|-----|--------------|--------------|
| `mentor_directory_list_v2` | 078 | `lib/auth/mentorPublicRead.ts` |
| `mentor_profiles_for_directory_v2` | 078, 112 | `lib/auth/mentorPublicRead.ts` |
| `mentor_user_public_v2` | 078 | `lib/auth/mentorPublicRead.ts` |
| `get_mentor_review_stats` | 135 | `lib/mentor/publicMentorBundle.ts`, `lib/reviews/reviewQueries.ts` |
| `get_mentor_avg_response_hours` | 061 | `lib/mentor/avgResponseHoursDisplay.ts` |
| `approve_mentor_school_verification_admin` | 089, 174 | `lib/admin/mentorSchoolVerificationReviewActions.ts` (상수 `APPROVE_MENTOR_SCHOOL_VERIFICATION_RPC` = `lib/admin/mentorSchoolVerificationApproval.ts`) |

### 2-6. 커뮤니티·알림

| RPC | 정의/개정 SQL | 웹 호출 지점 |
|-----|--------------|--------------|
| `increment_community_post_view` | 037 | `lib/community/communityBoardMutations.ts` |
| `increment_shortform_post_view` | 038 | `lib/community/communityShortformQueries.ts` |
| `mark_all_notifications_read` | 133 | `lib/notifications/notificationReadActions.ts` |

### 2-7. 계정 삭제 saga (P1-10)

| RPC | 정의/개정 SQL | 웹 호출 지점 |
|-----|--------------|--------------|
| `account_deletion_request_consented` | 176, 179, 182 | `lib/account/accountDeletionActions.ts` |
| `account_deletion_cancel` | 151, 175 | `lib/account/accountDeletionActions.ts` |
| `account_deletion_status_self` | 161, 175 | `lib/appSession/appSurfaceAccountGate.ts` |
| `account_deletion_claim` | 154 | `lib/account/accountDeletionAdapters.ts` (← cron) |
| `account_deletion_reclaim_expired` | 154 | `lib/account/accountDeletionAdapters.ts` |
| `account_deletion_advance` | 151, 175, 176 | `lib/account/accountDeletionAdapters.ts` |
| `account_deletion_begin_locked` | 176 | `lib/account/accountDeletionAdapters.ts` |
| `account_deletion_record_error` | 151, 175 | `lib/account/accountDeletionAdapters.ts` |
| `account_deletion_revoke_sessions` | 177 | `lib/account/accountDeletionAdapters.ts` |
| `account_deletion_forfeit_and_anonymize` | 154, 175, 176, 180 | `lib/account/accountDeletionAdapters.ts` |
| `account_deletion_storage_owner_refs` | 181 | `lib/account/accountDeletionAdapters.ts` |
| `account_deletion_verify_object_owners` | 183 | `lib/account/accountDeletionAdapters.ts` |

---

## §3. SQL 정의 함수 중 웹 미호출 141개 — 분류

웹이 직접 부르지 않지만 웹 트래픽에 **간접 작동**(트리거·RLS)하거나, 모바일/배치 전용이거나, 레거시.

### 3-1. 트리거 함수 (웹 write 시 DB 내부에서 발화)

- 공통: `set_updated_at`(001) · `set_refunds_updated_at` · `set_admin_content_updated_at`
- Auth 가입: `handle_new_auth_user`(001, ↔ `lib/auth/buildSignupUserMetadata.ts` 메타데이터 계약) · `handle_new_auth_user_consent_records`(087)
- 구독·캡: `enforce_mentor_cap`(050) · `keep_subscription_refunded_status` · `sync_subscription_refunded_from_refund`(069)
- 역할: `enforce_users_role_guard`(119) · `122_signup_role_no_admin`
- 정산 차단: `trg_block_settlement_on_active_dispute`(047)
- 커뮤니티 카운터·해시태그: `community_refresh_post_comment_count` / `community_refresh_post_like_count` / `community_refresh_shortform_like_count`(037/038/082) · `community_sync_hashtags`(037)
- 게시판 댓글 canonical 브리지(163/164): `cc_sync_board_to_canonical` · `cc_sync_board_delete_to_canonical` · `cc_write_guard` · `comments_mirror_to_legacy` · `comments_mirror_delete_to_legacy` · `comments_write_guard` · `comment_sync_in_progress`
- 질문방 직접쓰기 가드(141/144): `qa_direct_write_guard` · `qm_direct_write_guard` · `qt_direct_write_guard` · `qa_direct_answered_after` · `qm_direct_answered_after` · `qt_direct_consume_free_usage` · `qna_apply_answered_transition`(136)
- 자기심사 방지: `mentor_acad_change_guard_self_review`(089) · `mentor_school_verifications_guard_self_review`(077)
- 승인 시 플랜 시드: `mp_seed_default_plans_on_approval`(166)
- 정산 불변: `payout_run_items_block_mutation`(106/111)
- 리뷰 수정 가드: `reviews_enforce_update`(123/126/171/173)
- 삭제 saga 쓰기 가드: `account_deletion_write_guard`(151)
- FK 백필: `cro_backfill_fks` · `cra_backfill_post_fk`(039)
- 도메인 알림 트리거(155~159): `cra_notify_new_application` · `com_notify_new_order_message` · `iq_notify_assigned` · `iq_notify_status_transition` · `iqm_notify_message` · `mp_notify_activity_transition` · `mplan_notify_price_changed` · `sbe_notify_billing_event` · `sub_notify_expired` · `refund_notify_mentor_termination`
- 레거시 noop: `fqu_legacy_standalone_noop`(052)

### 3-2. RLS·Storage 정책 헬퍼 (웹의 모든 select/insert/스토리지 접근에 간접 적용)

- 역할 판별: `is_admin` · `is_mentor`
- 질문방 첨부(049/139/149): `qra_room_uuid_from_path` · `qra_thread_writable_for_path` · `qra_uploader_allowed_for_path` · `qra_path_upload_eligible` · `user_is_room_party_for_qra_path`
- 개별질문(070/113/167/169): `individual_question_user_is_admin` · `individual_question_user_is_approved_mentor` · `individual_question_uuid_from_storage_path` · `user_is_individual_question_party` · `user_is_party_for_individual_question_storage_path`
- 맞춤의뢰 첨부·납품(010/012/059/063/083): `cro_uuid_from_deliverable_storage_path` · `cro_student_can_read_deliverable_storage` · `user_can_read_cro_deliverable_storage_path` · `user_is_mentor_of_cro_storage_path` · `user_is_party_to_cro_storage_path` · `crp_uuid_from_post_attachment_path` · `user_can_read_crpa_storage_path` · `user_is_post_author_for_crpa_path` · `craa_application_uuid_from_path` · `user_can_read_craa_storage_path` · `user_is_application_mentor_for_craa_application` · `user_is_application_mentor_for_craa_path` · `user_is_post_author_for_craa_application` · `custom_order_message_attachment_is_party` / `_order_id_from_path` / `_uploader_id_from_path`
- 학교인증 경로: `mentor_school_verification_storage_path`(077)
- QnA 가드 조건: `qna_is_direct_untrusted_writer` · `qna_users_blocked`(116) · `qna_subscription_has_live_refund`(142)
- 캡 계산(050): `mentor_cap_limit` · `mentor_cap_used` · `subscription_cap_weight` — TS 미러: `lib/subscribe/mentorCapService.ts`
- 무료질문 한도: `check_free_question_usage_limits`(046/052)
- 삭제 saga: `account_deletion_write_blocked` · `account_deletion_active_states` · `account_deletion_active_job_id` · `account_deletion_latest_job_id` — 상태 정의 TS 미러: `lib/account/accountDeletionJobStates.ts`

### 3-3. RPC 내부 전용 하위 함수

- 맞춤의뢰 상태전이(088/090): `_cro_transition_actor_is_mentor` / `_actor_is_student` / `_deliverable_count` / `_has_active_dispute` / `_is_terminal` / `_payment_confirmed` / `_primary_status_col` / `_primary_status_norm` / `_revision_count` · `_order_primary_status_norm` · `_pick_custom_order_gross_won` · `_positive_int_from_numeric` · `cro_primary_status_norm`
- 알림 원자화(132/152/160): `record_domain_notification`(도메인 RPC들이 같은 트랜잭션에서 호출 — exactly-once) · `notification_display_name` / `_date_label` / `_cash_label` / `_mentor_label` / `_event_group`(TS 미러: `lib/notifications/notificationSettingsModel.ts`) · `notification_delivery_allowed` · `notification_create_deliveries`
- 구독 보상 트랜잭션: `record_subscription_cash_rollback`(019/023 — service_role 전용, checkout RPC 내부 보상 경로)
- 리뷰 자격 정본: `check_review_eligibility`(045/066/170) — 웹은 `lib/reviews/checkReviewEligibility.ts`가 동일 규칙을 조회로 미러(판정 정본은 SQL 170)
- 기타: `mark_individual_question_released`(070) · `account_deletion_self_response`(161)

### 3-4. 모바일 앱 전용 (웹 미사용이 정상)

- `register_device_token` · `revoke_device_token`(132) — `device_tokens` 테이블
- `get_mobile_app_version_policy`(162) — `mobile_app_version_policies` 테이블

### 3-5. 배치·운영 — **웹 배선 없음(주의)**

- 알림 발송 워커(152): `notification_outbox_claim` / `notification_outbox_mark_sent` / `notification_outbox_mark_failed` / `notification_outbox_reclaim_expired` / `notification_delivery_mark_sent` / `notification_delivery_mark_failed` — 웹에는 `lib/notifications/outboxWorker.ts` **오케스트레이터(어댑터 주입형, dry-run transport)만 존재**하고 실제 RPC 어댑터·cron 배선이 없음
- 정산 지급(108/153/156): `pay_due_payouts_for_run` · `run_scheduled_payout` · `payout_reconciliation_report` · 뷰 `due_payouts` — 웹 호출 없음. `lib/payout/payoutComputation.ts`는 "SQL 153과 동일 규칙"의 순수 표시용 TS 미러
- `account_deletion_worker_claim`(151) — **의도적 미사용**: cron 라우트 주석에 "lease를 다루지 않아 중복 처리 가능하므로 쓰지 않는다" (154의 `account_deletion_claim` 사용)

### 3-6. 레거시·대체됨 (호출 경로 없음, DB에 잔존)

| 레거시 | 대체 |
|--------|------|
| `mentor_directory_list` · `mentor_profiles_for_directory` · `mentor_user_public` (005) | v2 (078/112) |
| `claim_individual_question`(070) · `claim_individual_question_as_mentor`(071) | `claim_individual_question_v2`(081) — v1은 e2e(`e2e/rpc-money.spec.ts`, `e2e/local-scenarios.spec.ts`)에서만 호출 |
| `create_individual_question_as_student`(060) | `create_individual_question_with_hold(_v2)` |
| `release_individual_question` · `refund_individual_question`(070) | `release_individual_question_payout` · `refund_individual_question_hold` |
| `record_custom_order_escrow_payout`(055) | 110에서 즉시지급 제거 — `accept_custom_order_deliverable_atomic` 내부 정산 예정 경로로 대체 |
| `qna_create_free_question_thread`(052) | `qna_create_question_thread`(136)가 무료/구독 자격을 서버 내부 분기로 흡수 |
| `answer_individual_question`(060/070) | v2 메시지·전이 플로우 |
| `add_individual_question_attachment`(070→167/168 멱등 재정의) | **웹은 미사용** — `lib/individualQuestion/individualQuestionAttachmentStorage.ts`가 테이블 직접 insert. RPC는 모바일/외부용 병행 |
| `account_deletion_request` · `account_deletion_request_self` · `account_deletion_request_self_consented` · `account_deletion_cancel_self` | `account_deletion_request_consented` · `account_deletion_cancel` — 구버전은 `scripts/verify/w5f-concurrency.mjs`에서만 참조 |

---

## §4. 테이블 매핑

### 4-1. 웹이 `.from()`으로 직접 접근하는 테이블 (51 + 동적 5)

괄호는 접근하는 대표 웹 모듈(계약 테스트 제외 전수).

- **계정·사용자**: `users` (16파일: `lib/auth/getCurrentProfile.ts`, `lib/auth/accountStatus.ts`, `lib/auth/syncAfterSignUpSession.ts`, `lib/admin/accountStatus*.ts`, `lib/appSession/appSurfaceAccountGate.ts`, `lib/community/communityAuthorLabels.ts`, `lib/landing/landingPageQueries.ts`, `lib/qna/freeQuestionUsage.ts`, `lib/reviews/reviewQueries.ts` 등) · `user_warnings` (`lib/admin/accountStatusActions.ts`, `accountStatusQueries.ts`) · `user_blocks` (`lib/blocks/userBlocks*.ts`, `app/(student)/settings/blocks/page.tsx`, `lib/admin/accountStatusQueries.ts`) · `user_deletion_log` (`lib/admin/accountStatusQueries.ts`) · `account_deletion_jobs` (`app/(student)/account/delete/page.tsx`)
- **멘토**: `mentor_profiles` (20파일: `lib/mentor/*`, `lib/admin/mentorSchoolVerificationReview.ts`, `lib/admin/mentorAcademicRecordChangeReview*.ts`, `lib/auth/mentorSignupStudentIdAction.ts`, `lib/subscribe/mentorCapService.ts`, `lib/reviews/reviewQueries.ts`, `lib/landing/landingPageQueries.ts` 등) · `mentor_plans` (`lib/mentor/mentorProfileMutations.ts`, `mentorActivityService.ts`) · `mentor_school_verifications` (`lib/mentor/mentorSchoolVerification*.ts`, `lib/admin/mentorSchoolVerificationReview.ts`) · `mentor_academic_record_change_requests` (`lib/admin/adminQueries.ts`, `lib/mentor/mentorAcademicRecordChange*.ts`) · `mentor_activity_events` (`lib/mentor/mentorActivityService.ts`, `lib/admin/mentorActivity*.ts`) · `school_tier_mappings` (`lib/mentor/schoolClassificationCatalog.ts`, `lib/admin/schoolClassificationActions.ts`) · `favorites` (`lib/mentor/mentorFavorites.ts`, 상수 TABLE)
- **구독·정산**: `subscriptions` (`lib/subscribe/*`, `lib/qna/*Guard.ts`, `lib/reviews/checkReviewEligibility.ts`, `lib/mentor/mentorActivityService.ts`) · `subscription_billing_events` (`lib/subscribe/subscribeCheckoutService.ts`, `studentSubscriptionManagement.ts`, `subscriptionCancelActions.ts`, `subscriptionRenewalBatch.ts`, `lib/mentor/mentorActivityService.ts`) · `subscription_settlement_items` (`lib/mentor/mentorActivityService.ts`, `lib/admin/mentorActivityAdminActions.ts`)
- **캐시·결제**: `cash_ledger` (`lib/subscribe/subscribeCheckoutService.ts`, `lib/toss/cashTopupFromPayment.ts`, `lib/admin/adminDashboardExtended.ts`, `adminDisputeEscrowSplitQueries.ts`, `app/(mentor)/mentor/mypage/page.tsx`) · `cash_wallets` (`lib/account/accountDeletionPreconditions.ts`; 잔액 갱신은 RPC 전용) · `cash_topup_packages` (`lib/admin/adminTopupPackageActions.ts`, `app/(admin)/admin/(console)/settings/page.tsx`) · `refunds` (`lib/admin/adminQueries.ts`, `slaDashboard.ts`, `lib/subscribe/studentSubscriptionManagement.ts`, `subscriptionCancelActions.ts`, `lib/mentor/mentorActivityService.ts`) · **동적 probe**: `payments` / `payment_intents` / `order_payments` (`lib/cash/cashQueries.ts`·`lib/subscribe/subscribeCheckoutService.ts`의 `PAY_TABLES` 순회 — §9-1 참고)
- **질문방**: `mentor_student_rooms` (`lib/qna/questionRoom*.ts`, `weeklyQuestionUsage.ts`, `lib/subscribe/subscriptionUsageStarted.ts`) · `question_threads` (`lib/qna/*`, `lib/individualQuestion/transferIndividualQuestionsToRoom.ts`) · `question_messages` (transfer만 직접; 일반 쓰기는 136 RPC 전용) · `question_attachments` (`lib/qna/questionRoomAttachmentsQueries.ts`, transfer) · `connection_notes` (`lib/qna/questionRoomActions.ts`) · `free_question_usage` (`lib/qna/freeQuestionUsage.ts`, 상수 TABLE)
- **개별질문**: `individual_questions` (`lib/individualQuestion/*`, `lib/mentor/mentorPayoutsService.ts`, `lib/reviews/checkReviewEligibility.ts`, `app/(student)/mypage/page.tsx`) · `individual_question_messages` · `individual_question_attachments` · `individual_question_transfers` (모두 `lib/individualQuestion/*`)
- **맞춤의뢰**: `custom_request_posts` (`lib/customRequest/customRequestMutations.ts`, `studentCustomRequestOrdersQueries.ts`, `app/(admin)/.../custom-request-orders/page.tsx`) · `custom_request_applications` (`lib/customRequest/applicationAttachmentAccess.ts`) · `custom_request_orders` (`lib/mentor/mentorPayoutsService.ts`, `lib/admin/adminQueries.ts`, `lib/account/accountDeletionPreconditions.ts`) · `custom_request_post_attachments` · `custom_request_application_attachments` (`lib/customRequest/*`) · `custom_order_deliverables` (`lib/admin/adminDisputeDeliverables.ts`) · `order_events` (`lib/admin/adminUnifiedActivityLog.ts`)
- **커뮤니티**: `community_posts` (`lib/community/communityBoard*.ts`, `lib/landing/landingPageQueries.ts`, `lib/admin/adminReportEvidence.ts`) · `comments`(canonical) · `community_comments`(legacy) · `community_hashtags` · `post_reactions` · `shortform_posts` (`lib/community/communityShortform*.ts`, landing, adminReportEvidence) · `shortform_reactions`
- **리뷰**: `reviews` (`lib/reviews/*`, `app/api/reviews/[id]/route.ts`, `lib/admin/adminUnifiedActivityLog.ts`)
- **분쟁·신고·운영**: `disputes` (`lib/disputes/*`, `lib/admin/adminDisputeSanctionActions.ts`, `bulkActions.ts`) · `content_reports` (`lib/admin/*`, `lib/support/studentReportsQueries.ts`) · `admin_action_logs` (`lib/admin/adminActionLog.ts`, `lib/toss/cashTopupFromPayment.ts`) · `verification_logs` (`lib/admin/adminUnifiedActivityLog.ts`) · `app_notices` (`lib/notices/publicNoticesQueries.ts`, `lib/admin/adminQueries.ts`) · `promotion_campaigns` (`lib/admin/adminQueries.ts`)
- **알림**: `notifications` (`lib/home/mentorDashboardQueries.ts`; 읽음 처리는 133 RPC) · `notification_settings` (`lib/notifications/notificationSettingsActions.ts`)

### 4-2. SQL에만 존재하고 웹이 직접 접근하지 않는 테이블 (26)

트리거·RPC 내부 전용이거나 모바일/운영 전용:

`admin_case_notes`(084) · `ai_drafts`(060) · `custom_order_messages` · `custom_order_message_attachments`(083 — 접근은 Storage+RPC 경유) · `custom_order_revisions`(007) · `custom_order_settlement_items`(013 — RPC 내부 기록) · `device_tokens`(132, 모바일) · `major_category_catalog` · `school_tier_catalog` · `subjects`(074/079 — 웹은 TS 카탈로그 미러 사용) · `mentor_individual_question_pricing`(094 — RPC 경유) · `mobile_app_version_policies`(162) · `notification_outbox` · `notification_deliveries`(132/152 — 트리거 기록·워커 소비) · `payments` / `order_payments`(002 계열 — 동적 probe 대상이나 정적 참조 없음) · `payout_runs` · `payout_run_items` · `payout_settings`(106/156) · `question_attachments`제외 · `reviews_duplicates_archive` · `reviews_quarantine_archive`(123) · `scan_annotations` · `withdrawals`(093) · `subscription_checkout_anomalies`(145 — RPC 내부 기록) · `user_consent_records`(087 — 가입 트리거 기록) · `free_question_usage`제외

> `cash_wallets` / `cash_ledger` 잔액·원장 **쓰기**는 전부 RPC(019/020/054~057/070/131 계열) 내부에서만 일어나고, 웹의 직접 접근은 읽기(원장 조회·삭제 전 잔액 확인)에 한정됨 — 설계 의도와 일치.

---

## §5. Storage 버킷 전수 매핑 (13개, 전부 private)

| 버킷 | 생성/정책 SQL | 웹 사용 파일 |
|------|---------------|--------------|
| `student-id-images` | 001 (+077 경로정책) | `lib/storage/studentIdImageStorage.ts`, `lib/auth/mentorSignupStudentIdAction.ts`, `lib/mentor/mentorStudentIdActions.ts` — `{userId}/school-verifications/…` 하위 경로로 학교인증 서류 겸용 |
| `custom-order-deliverables` | 010, 063 | `lib/customRequest/orderDeliverableFiles.ts`, `lib/admin/adminDisputeDeliverables.ts` |
| `custom-request-post-attachments` | 012 | `lib/customRequest/postAttachmentConstants.ts` 계열 |
| `custom-request-application-attachments` | 059 | `lib/customRequest/applicationAttachmentConstants.ts` 계열 |
| `community-post-images` | 037, 118 | `lib/community/communityImage*.ts` (signed URL) |
| `shortform-videos` | 038 | `lib/community/communityShortform*.ts`, `shortformVideoRef.ts` |
| `shortform-thumbnails` | 038 | `lib/community/communityShortformConstants.ts` |
| `question-room-attachments` | 049, 139, 149 | `lib/qna/questionRoomAttachmentStorage.ts` (업로드 후 `qna_register_attachment` RPC로 행 등록) |
| `individual-question-attachments` | 070, 167~169 | `lib/individualQuestion/individualQuestionAttachmentStorage.ts` |
| `custom-order-message-attachments` | 083 | `lib/customRequest/orderMessageAttachments.ts` |
| `profile-avatars` | 097, 146 | `lib/storage/mentorAvatarStorage.ts` |
| `school-verifications`(경로 프리픽스) | 077 | `lib/storage/studentIdImageStorage.ts` — 독립 버킷이 아니라 `student-id-images` 내 디렉터리 |
| `scan-annotations` | 093 | **웹 미사용** (계정삭제 커버리지 `lib/account/accountDeletionBucketCoverage.ts`에만 등재) — 모바일/AI 스캔용 |

버킷 private 감사: `039_storage_buckets_private_audit.sql`. 계정삭제 saga는 전 버킷을 `lib/account/accountDeletionBucketCoverage.ts` + `account_deletion_storage_owner_refs`(181) + `account_deletion_verify_object_owners`(183)로 교차 검증.

---

## §6. Realtime

- `137_p3_8_realtime_messages_threads.sql`: `question_messages` · `question_threads`를 `supabase_realtime` publication에 추가.
- **웹에는 `.channel()` / `postgres_changes` 구독 코드가 전혀 없음** — 소비자는 모바일 앱. 웹 질문방은 새로고침/서버 fetch 기반.
- `117_question_attachments_v2_author_realtime_backfill.sql`도 realtime 관련 백필 포함.

## §7. Auth 연동

- 가입: 웹 `supabase.auth.signUp` 메타데이터(`lib/auth/buildSignupUserMetadata.ts`) → DB 트리거 `handle_new_auth_user`(001)가 `public.users` 생성, `handle_new_auth_user_consent_records`(087)가 동의 기록 생성, `122_signup_role_no_admin`이 role 상승 차단. 가입 직후 보정: `lib/auth/syncAfterSignUpSession.ts`.
- 역할 가드: 웹 `requireRole()` ↔ DB `is_admin()`/`is_mentor()`/RLS 이중화. **주의 계약**: `approve_mentor_school_verification_admin`은 `is_admin()`이 호출자 JWT의 `auth.uid()`를 읽으므로 **세션 클라이언트로 호출**해야 함(service role로 부르면 NOT_ADMIN) — `lib/admin/mentorSchoolVerificationReviewActions.ts:136` 주석.
- 세션 파기: `account_deletion_revoke_sessions`(177) + `auth.admin.deleteUser`.

## §8. API 라우트·크론·웹훅 → SQL 경로

| 엔드포인트 | SQL 경로 |
|------------|----------|
| `POST /api/toss/confirm` | `confirmCashTopupServer` → `record_cash_topup`(020/024) + `cash_ledger`/`admin_action_logs` |
| `POST /api/toss/webhook` | `lib/toss/cashTopupFromPayment.ts` → `record_cash_topup` (멱등) |
| `GET /api/cron/subscription-renewal` (vercel.json `10 18 * * *`) | `subscriptionRenewalBatch` → `process_subscription_renewal`(068/100) |
| `GET /api/cron/individual-question-expiry` (vercel.json `40 18 * * *`) | `individualQuestionExpiryBatch` → `refund_individual_question_hold`(070) |
| `GET /api/cron/account-deletion` | `accountDeletionAdapters` → `account_deletion_claim`/`advance`/… (151~183) — **vercel.json crons에 미등록** (§9-2) |
| `/api/subscribe/checkout` | `subscribeCheckoutService` → `record_subscription_cash_debit` + `confirm_subscription_checkout` |
| `/api/question-room/*` | `questionRoomRpc` → `qna_*` RPC 5종, `get_weekly_question_usage` |
| `/api/reviews/*` | `reviews` 테이블 + `check_review_eligibility` 규칙 미러 + `get_mentor_review_stats` |
| `/api/mentor/payouts/*` | `mentorPayoutsService` → `custom_request_orders`/`individual_questions`/`mentor_profiles` 조회 (지급 실행 RPC는 미배선, §9-3) |
| `/api/mentors/*`, `/api/mypage/*`, `/api/community/*`, `/api/app-session/bootstrap` | 각 도메인 쿼리 모듈 경유 테이블 조회 |

## §9. 특이·관찰 사항 (조치 제안 아님, 사실 기록)

1. **`payment_intents` 동적 probe**: `lib/cash/cashQueries.ts`·`lib/subscribe/subscribeCheckoutService.ts`의 `PAY_TABLES = ["payments","payment_intents","order_payments"]`가 존재 여부를 런타임 probe하는데, `payment_intents`는 repo SQL 어디에도 생성되지 않음(레거시 호환 probe).
2. **`/api/cron/account-deletion` 미스케줄**: 라우트·시크릿 검증은 구현돼 있으나 `vercel.json` crons에 등록되지 않음(외부 스케줄러 사용이 아니라면 삭제 saga가 자동 진행되지 않음).
3. **정산 지급 파이프라인 웹 미배선**: `due_payouts` 뷰, `pay_due_payouts_for_run`, `run_scheduled_payout`(106~108/153/156)은 DB에만 존재. 웹은 표시용 계산 미러(`lib/payout/payoutComputation.ts`)만 보유.
4. **알림 발송 워커 미배선**: 152의 outbox/delivery RPC 6종에 대응하는 웹 어댑터·cron이 없음. `lib/notifications/outboxWorker.ts`는 dry-run transport 주입형 뼈대.
5. **레거시 RPC 잔존**: §3-6 목록(v1 멘토 디렉터리, v1 개별질문 claim/release/refund, `record_custom_order_escrow_payout`, `qna_create_free_question_thread`, 구 계정삭제 request 계열)이 DB에 남아 있고 웹 경로는 없음. e2e·scripts/verify에서만 일부 참조.
6. **IQ 첨부 이중 경로**: 웹은 `individual_question_attachments` 직접 insert, DB에는 멱등 RPC `add_individual_question_attachment`(168)가 병존.
7. **Realtime publication은 열려 있으나 웹 소비자 없음** (§6) — 모바일 전제.
8. **`scan-annotations` 버킷**(093)은 웹 코드에서 업로드/조회 경로가 없음(삭제 커버리지 목록에만 존재).

## §10. 조사 방법 (재현 커맨드)

```bash
# 웹 → RPC 호출 전수
grep -rhoE '\.rpc\(\s*["'\'']([a-z0-9_]+)' app lib components hooks scripts e2e
# 리터럴이 아닌 호출(상수/변수) 별도 확인
grep -rn '\.rpc(' … | grep -vE '\.rpc\(\s*["'\'']'
# 웹 → 테이블 접근 전수 (동적 .from(변수) 별도 확인)
grep -rhoE '\.from\(\s*["'\''][a-zA-Z0-9_]+["'\'']\)' app lib components hooks
# SQL 함수/테이블/뷰/버킷 정의 전수
grep -hioE 'create (or replace )?function [a-z0-9_.]+' supabase/sql/*.sql
grep -hioE 'create table (if not exists )?[a-z0-9_.]+' supabase/sql/*.sql
grep -hoE "bucket_id\s*=\s*'[a-z-]+'" supabase/sql/*.sql
grep -n 'supabase_realtime' supabase/sql/*.sql
```
