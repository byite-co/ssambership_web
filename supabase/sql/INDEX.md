# supabase/sql 정본 인덱스

레포 `supabase/sql/` SQL 파일의 **번호순 정본 목록**입니다. Supabase Dashboard SQL Editor 스니펫 정리 기준으로 사용합니다.

- **002번 중복·적용 순서:** [`README_002_apply_order.md`](./README_002_apply_order.md) 참고 (알파벳 순 ≠ 적용 순).
- **제거됨:** `999_dummy_data.sql` (UI 데모 INSERT, README_002에 기록).
- **미반영 주의 (감사 2026-08-29, #26):** `20260805170000` 이후 라이브 적용 마이그레이션 31본이 이 번호 체계에 미반영이며, 특히 `153`·`156`의 지급 cutoff 는 라이브(`20260827100200`, KST 패치)와 달라 **재적용 금지** — 각 파일 머리 경고 참조.
- **DB 적용 여부:** 아래 “적용 메모”는 **파일 주석에 명시된 것만** 표기. 그 외는 운영 DB 이력으로 확인.

---

## 번호순 표

| 번호 | 파일명 | 유형 | 한 줄 목적 | 적용 메모 |
|------|--------|------|------------|-----------|
| 001 | `001_initial_auth_profile.sql` | MIGRATE | Auth·`users`·`mentor_profiles`·RLS·`set_updated_at` 등 초기 프로필 스키마 | |
| 002 | `002_app_core_schema_draft.sql` | MIGRATE | 전체 도메인 DDL **인벤토리 초안(DRAFT)** — `002_p0`·`003`과 중복, **프로덕션 직접 적용 금지** | 참고용 |
| 002 | `002_custom_request_orders_status.sql` | MIGRATE | DDL 없음. `select 1` — 앱 `orderSchemaGate` 마커 (`003` 이후) | |
| 002 | `002_p0_subscriptions_questions_draft.sql` | MIGRATE | P0 구독·결제 intent·`mentor_student_rooms`·질문방·알림 DDL + RLS | README_002: **002 계열 실적용 1순위** |
| 003 | `003_p0_custom_request_draft.sql` | MIGRATE | 맞춤의뢰 포스트·지원·주문·납품/리비전/이벤트 DDL + RLS (DRAFT P0) | |
| 004 | `004_p0_cash_disputes_admin_draft.sql` | MIGRATE | 캐시 지갑/원장·분쟁/환불·커뮤니티·멘토플랜 등 (DRAFT P0) | |
| 005 | `005_p0_public_mentor_read_rpc.sql` | MIGRATE | 공개 멘토 목록/상세용 SECURITY DEFINER 읽기 RPC (이메일 제외) | |
| 006 | `006_p0_custom_request_public_post_browse_rpc.sql` | MIGRATE | 공개 맞춤의뢰 포스트 browse RPC | |
| 007 | `007_p0_custom_order_revisions_and_order_events_rls.sql` | MIGRATE | 학생 수정 요청·`order_events` insert RLS (주문 당사자) | |
| 008 | `008_p0_disputes_insert_party_rls.sql` | MIGRATE | 맞춤의뢰 주문 분쟁 `disputes` insert — 학생·멘토 당사자 제한 | |
| 009 | `009_p0_disputes_submitted_by_and_active_unique.sql` | MIGRATE | `disputes.submitted_by` + active 분쟁 1건 유니크 | |
| 010 | `010_p0_custom_order_deliverable_files_storage.sql` | MIGRATE | 납품 첨부 private Storage + 메타 + `storage.objects` RLS | |
| 011 | `011_p0_custom_order_deliverable_version_unique.sql` | MIGRATE | 주문당 deliverable version 유니크 DB 제약 | |
| 012 | `012_p0_custom_request_post_attachments_storage.sql` | MIGRATE | 의뢰 등록 첨부 private Storage + `custom_request_post_attachments` + RLS | |
| 013 | `013_p0_custom_order_settlement_items.sql` | MIGRATE | 맞춤의뢰 주문 멘토 정산 예정(1건) 테이블 + RLS | |
| 014 | `014_p0_harden_custom_order_settlement_items.sql` | MIGRATE | 정산 items RLS 강화 + 금액·수수료 CHECK | |
| 015 | `015_p0_prevent_settlement_during_active_dispute.sql` | MIGRATE | active 분쟁 중 `custom_order_settlement_items` INSERT 차단 (RLS) | |
| 016 | `016_p0_community_comments.sql` | MIGRATE | 커뮤니티 공용 댓글 `community_comments` | |
| 017 | `017_p0_community_author_role_compat.sql` | MIGRATE | `community_posts` / `shortform_posts` `author_role` 호환 | |
| 018 | `018_p0_mentor_list_open_custom_request_posts.sql` | MIGRATE | 멘토/관리자용 공개 맞춤의뢰 목록 browse | |
| 019 | `019_p0_subscription_cash_debit.sql` | MIGRATE | 구독 체크아웃 캐시 차감 RPC (`record_subscription_cash_debit` 등) | |
| 020 | `020_p0_cash_topup_charge.sql` | MIGRATE | 캐시 충전 원장·지갑 RPC (`record_cash_topup`) | |
| 021 | `021_p0_refund_ins_admin_only.sql` | MIGRATE | `refunds` INSERT — admin만 | |
| 022 | `022_p0_subscription_cash_debit_grants.sql` | MIGRATE | 구독 캐시 debit/rollback 함수 `service_role` EXECUTE GRANT | |
| 023 | `023_p0_subscription_cash_debit_service_role_only.sql` | MIGRATE | 구독 캐시 debit/rollback — public/anon/authenticated REVOKE | |
| 024 | `024_p0_cash_topup_service_role_grant.sql` | MIGRATE | `record_cash_topup` service_role 전용 GRANT/REVOKE | |
| 025 | `025_p0_payments_drop_update_own.sql` | MIGRATE | `payments_update_own` 정책 제거 (상태 변경 서버 전용) | |
| 026 | `026_p0_msr_insert_subscription_check.sql` | MIGRATE | `mentor_student_rooms` insert — active 구독 확인 정책 | |
| 027 | `027_p0_harden_payments_and_question_room_rls.sql` | MIGRATE | payments·질문방 RLS 강화 (클라이언트 직접 갱신/insert 차단) | |
| 028 | `028_p0_lock_subscriptions_writes.sql` | MIGRATE | authenticated 직접 subscriptions INSERT/UPDATE 차단 | |
| 029 | `029_p0_lock_subscription_deletes.sql` | MIGRATE | subscriptions DELETE·self_rw 정책 제거 | |
| 030 | `030_p0_refund_approve_reject_admin_rpc.sql` | MIGRATE | 관리자 환불 승인/거절 단일 트랜잭션 RPC | |
| 031 | `031_p1_admin_notices_promotions.sql` | MIGRATE | 관리자 공지(`app_notices`)·프로모션 테이블 | |
| 032 | `032_p0_weekly_question_usage.sql` | MIGRATE | 주간 질문 한도(월~일) + usage RPC | |
| 032 | `032_p1_admin_content_reports.sql` | MIGRATE | 관리자 콘텐츠 신고(`content_reports`) P1 | |
| 033 | `033_p1_admin_reviews_moderation.sql` | MIGRATE | `reviews` 운영·모더레이션 컬럼 + 공개 SELECT 제한 | |
| 033 | `033_question_threads_topic.sql` | MIGRATE | `question_threads.topic` 과목 태그 컬럼 추가 | |
| 034 | `034_mentor_favorites.sql` | MIGRATE | 멘토 찜하기 `favorites` 테이블 | |
| 034 | `034_p1_admin_disputes_processing.sql` | MIGRATE | 관리자 분쟁 처리 P1 (disputes 확장) | |
| 035 | `035_p1_admin_audit_logs.sql` | MIGRATE | 관리자 `verification_logs` SELECT 정책 (audit-logs UI) | |
| 036 | `036_p1_prelaunch_rls_tightening.sql` | MIGRATE | P1 출시 전 RLS 감사·강화 **초안** (주석: Editor 즉시 적용 금지) | |
| 037 | `037_p1_community_board_v2.sql` | MIGRATE | 게시판 v2 — posts 확장·댓글 2depth·reactions·hashtags·Storage | |
| 038 | `038_p1_shortform_v2.sql` | MIGRATE | 숏폼 v2 — video/thumbnail/tags/status·Storage | |
| 039 | `039_p1_custom_request_compat.sql` | MIGRATE | 맞춤의뢰 `003` 이후 컬럼 호환·v2 필드 보강 | |
| 039 | `039_storage_buckets_private_audit.sql` | MIGRATE | 필수 Storage 버킷 `public=false` 설정 + 점검용 SELECT 주석 | LOOKUP 주석 포함 |
| 040 | `040_admin_action_logs.sql` | MIGRATE | 관리자 활동 로그 테이블 | |
| 041 | `041_mentor_payout_account.sql` | MIGRATE | 멘토 정산 계좌(마스킹 표시) | |
| 042 | `042_reviews_system.sql` | MIGRATE | 멘토 리뷰 시스템 (학생 작성·멘토 1회·관리자) | |
| 043 | `043_p1_accept_order_settlement_atomic_rpc.sql` | MIGRATE | 학생 납품 수락 + 정산 insert 단일 RPC | |
| 044 | `044_free_question_usage.sql` | MIGRATE | 무료 질문권 사용 기록 테이블 | |
| 045 | `045_review_eligibility_guard.sql` | MIGRATE | reviews INSERT — 동일 멘토 2회 결제 후만 (RLS 함수) | |
| 046 | `046_free_question_usage_db_guard.sql` | MIGRATE | 무료 질문권 INSERT DB 한도 트리거 (TOCTOU 방지) | |
| 047 | `047_active_dispute_settlement_block_trigger.sql` | MIGRATE | active 분쟁 시 settlement INSERT **트리거** 차단 | 파일 하단 VERIFY SELECT 포함 |
| 048 | `048_connection_notes_author.sql` | MIGRATE | `connection_notes.author_id` / `author_role` 추가 | |
| 049 | `049_question_room_attachments_storage.sql` | MIGRATE | 질문방 첨부 private Storage + RLS | |
| 050 | `050_mentor_subscription_cap.sql` | MIGRATE | 멘토 구독 cap(가중치·상한·트리거) | |
| 051 | `051_community_typo_author_label_category_backfill.sql` | MIGRATE | community 오타 백필 + `category` 기본값 UPDATE | |
| 052 | `052_free_question_policy_7_total_7day_expiry.sql` | MIGRATE | 무료 질문권 7회·7일 만료 정책 (044·046 후속) | |
| 053 | `053_community_rls_legacy_select_cleanup.sql` | MIGRATE | community RLS 정리 (`is_mentor` 의존 제거) + shortform `sf_select_published` 인라인 | |
| 053b | `053b_shortform_posts_published_select_rls.sql` | MIGRATE | shortform_posts 공개 SELECT — published / 작성자 / admin (`sf_select_published`) | **staging 적용됨**(파일 주석) |
| 054 | `054_p0_custom_order_escrow_hold.sql` | MIGRATE | 맞춤의뢰 에스크로 hold — 학생 캐시 차감 RPC | |
| 055 | `055_p0_custom_order_escrow_payout.sql` | MIGRATE | 에스크로 payout — 수락 시 멘토 지급 + accept RPC 연동 | |
| 056 | `056_p0_custom_order_escrow_refund.sql` | MIGRATE | 에스크로 refund — 예치 전액 반환 + admin 환불 연동 | |
| 057 | `057_p0_custom_order_dispute_split.sql` | MIGRATE | 에스크로 분쟁 분배 RPC (멘토 gross·학생 환불) | |
| 058 | `058_mentor_student_nickname_rpc.sql` | MIGRATE | 멘토 맞춤의뢰용 학생 nickname RPC (`get_custom_request_student_display`) | **파일 주석: 이미 Supabase 적용됨** |
| 059 | `059_p0_custom_request_application_attachments_storage.sql` | MIGRATE | 멘토 지원서 첨부 private Storage + `custom_request_application_attachments` + RLS | |

**유형 범례:** `MIGRATE` = DDL/정책/함수/GRANT/백fill 등 스키마·권한 변경. `VERIFY`/`SEED`/`LOOKUP` **단독 파일 없음** (047·039 등 일부 MIGRATE 파일 끝에 VERIFY/LOOKUP 주석·SELECT 블록 포함).

---

## 이상치 요약

### 번호 공백 (001–059)
- **없음** — 001~059 각 번호에 최소 1개 파일 존재.
- **레포에 없음:** `999_dummy_data.sql` (README에만 언급).

### 번호 중복 (동일 접두 2~3개)
| 번호 | 파일 |
|------|------|
| **002** | `002_app_core_schema_draft`, `002_custom_request_orders_status`, `002_p0_subscriptions_questions_draft` |
| **032** | `032_p0_weekly_question_usage`, `032_p1_admin_content_reports` |
| **033** | `033_question_threads_topic`, `033_p1_admin_reviews_moderation` |
| **034** | `034_mentor_favorites`, `034_p1_admin_disputes_processing` |
| **039** | `039_p1_custom_request_compat`, `039_storage_buckets_private_audit` |

### 대체/폐기 추정
| 항목 | 내용 |
|------|------|
| `002_app_core_schema_draft` | `002_p0`·`003`로 **대체 적용** — 본 파일은 참고용 DRAFT (README_002). |
| `002_custom_request_orders_status` | 실 DDL은 **`003`** — 본 파일은 `select 1` 마커만. |
| `999_dummy_data.sql` | **제거됨** (SEED, README_002). |
| `053` vs `053b` | `053`에 shortform 정책이 **인라인 포함**. `053b`는 숏폼 SELECT만 **분리 정본**(staging 적용·재구축용). 재구축 시 `053b`만으로 shortform 읽기 정책 복원 가능. |

### 일회성·디버깅·주의 후보 (Dashboard 정리 시)
| 파일 | 사유 |
|------|------|
| `002_app_core_schema_draft.sql` | 대형 DRAFT 인벤토리 — 적용 이력 없으면 Editor 스니펫에서 제외 권장 |
| `002_custom_request_orders_status.sql` | `select 1` 한 줄 — 재실행 무해하나 Editor clutter |
| `039_storage_buckets_private_audit.sql` | 소규모 bucket `public` 점검 — 환경별 1회성 성격 |
| `047_active_dispute_settlement_block_trigger.sql` | **하단 VERIFY SELECT 2개** — 트리거 DDL과 분리 저장 권장 |
| `058_mentor_student_nickname_rpc.sql` | 주석상 **이미 적용** — 기록용·중복 적용 주의 |
| `036_p1_prelaunch_rls_tightening.sql` | 주석: **즉시 적용 금지** 초안 |

---

## README_002와의 대조

- [`README_002_apply_order.md`](./README_002_apply_order.md)는 **002번 3중복**과 `003`·마커 순서만 상세 기술.
- 본 `INDEX.md`는 **001–059 전체** 인벤토리 + 유형·이상치.
- README의 `002a/002b/002c` 파일명 제안은 **아직 레포에 반영되지 않음** (현행 파일명 유지).

---

## 대시보드 정리 가이드

Supabase SQL Editor에 쌓인 스니펫 중 **이 목록의 번호·파일명과 매칭되는 것만** `유형 - SQL 0XX - 한줄목적` 형식(예: `MIGRATE - SQL 054 - escrow hold`)으로 남기세요. **번호가 없거나 목록에 없는 일회성 조회·디버그 쿼리**는 DB 스키마에 영향 없이 삭제해도 됩니다. 적용 순서가 중요한 구간(002·003·054–057 등)은 README_002와 파일 상단 `-- 선행:` 주석을 함께 확인하세요.
