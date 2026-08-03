# 전 기능 계약 수렴 프리플라이트 (웹) — 2026-08-04 세션

작업 지시서: "쌤버십 웹·앱·Supabase 전 기능 계약 수렴 및 결함 종결 실행 지시서".
본 문서는 신규 수정 시작 전의 실측 기준점 기록이다. 모든 값은 이 세션에서 직접 재측정했다.

## 1. 기준점

| 항목 | 값 |
|------|-----|
| 웹 기본 브랜치 | `main` @ `7b732a3cd0d812157d50a4e25b754831ec760d63` (알려진 기준과 일치) |
| 앱 기본 브랜치 | `master` @ `db20f21452c70273bcce9d8756f101e8e6ec1803` (알려진 기준과 일치) |
| 작업 브랜치(웹·앱 공통) | `claude/ssambership-convergence-defect-closure-ckc2z2` |
| staging project | `lbeqxarxothkmzqvpudy` |

**브랜치명 결정 근거**: 지시서는 `claude/full-contract-convergence-20260804` 를 지정했으나,
이 실행 세션은 두 저장소 모두 `claude/ssambership-convergence-defect-closure-ckc2z2` 브랜치로
개발·푸시하도록 고정되어 있다(세션 규칙상 다른 브랜치 푸시 불가). 지시서 3.1의
"동일 이름 존재 시 실제 브랜치명을 기록" 조항에 따라 실제 브랜치명을 여기 기록한다.

## 2. 수렴한 기존 PR (병합 완료, 중복 0)

| PR | head | 병합 순서 | 비고 |
|----|------|-----------|------|
| 웹 #57 | `c505205496e825adedd7366b0c4ab322d5ee125b` | 1 | Build 13 DB 계약 migration 정본 (DB 재적용 없음) |
| 웹 #56 | `930d92fe91f42a20d0f38fd99b18ebba0eb16282` | 2 | 계정 삭제 worker Vercel cron 배선 |
| 웹 #55 | `5dafd3175465465358bbd8c7b6a3590fc07a3ca7` | 3 | 멘토 질문방 짧은 viewport 보정 |
| 앱 #41 | `1dc5e61e4385b47496daaf134777dfb6b9ff7d8e` | 단독 | PR #38/#39/#40 전체 포함 — 개별 재병합 없음 |

3건 모두 충돌 0. 앱 PR #41 HEAD 는 PR 설명(Build 13/vc13)과 달리 실제로는
`chore: bump versionCode 13 -> 14 (Play Console rejected reused vc13)` 커밋을 포함하며
pubspec 은 `0.1.0+14` 다. 규칙 36.2에 따라 **코드가 정본** — 최종 버전 증가는 14→15 로 1회 수행한다.

## 3. Build 13 migration 적용 상태 (재검증)

- ledger: version `20260802054930`, name `20260802024641_build13_db_contract_convergence` — **정확히 1행**
- 함수 본문 파리티(파일 `$fn$/$function$` 본문 md5 vs DB `pg_proc.prosrc` md5) — **7/7 byte-exact 일치**:
  `account_deletion_write_blocked`, `ugc_write_allowed`, `report_target_user_valid`,
  `core_private.community_post_create_impl`, `core_private.community_post_update_impl`,
  `qna_append_message`, `qna_register_attachment`
- 파일 전체 md5(`b54c11ca…`)와 ledger statements md5(`bd7ceda5…`)는 다르나 이는 적용 도구의
  문장 정규화 차이이며, 계약상 의미 있는 함수 본문은 전부 일치 → drift 아님으로 판정.

## 4. 신규 발견 드리프트 — Build 13 이후 적용된 ledger 2건 (소스 부재)

| version | name | 내용 |
|---------|------|------|
| `20260803142534` | `iq_append_message_v1` | `public.iq_append_message(p_question_id, p_body)` — IQ 양방향 대화 RPC (계정 4종·차단·삭제·멘토승인 게이트, 멘토 첫 답변 answered 전이) |
| `20260803142559` | `iq_attachment_author_v1` | `individual_question_attachments.author_id` 추가 + `add_individual_question_attachment` 가 author_id 기록 |

두 migration 은 staging DB 에는 적용됐으나 웹 저장소에 소스 파일이 없다.
**처리**: DB 를 덮어쓰지 않고, ledger 의 statements 를 그대로 소스 파일로 복원해
source/applied 파리티를 회복한다(이번 수렴 브랜치에 포함). 재적용은 하지 않는다.

## 5. staging DB 실측 요약

### 데이터 건수 (수정 전)

users 8 (전원 status=active) · mentor_profiles 2 · mentor_plans 6 · reviews 0 · favorites 0 ·
community_posts 10 · comments 4 · community_comments 5 (board/visible 4, shortform/visible 1) ·
shortform_posts 3 (published) · content_reports 5 (community_post 4, legacy `shortform` 1) ·
individual_questions 5 · individual_question_messages 9 · individual_question_attachments 12 ·
question_threads 6 · question_messages 31 · question_attachments 33 ·
notifications 43 (is_read=false 23 / true 20) · notification_outbox 43 (전원 pending, attempt_count=0) ·
notification_deliveries 0 · notification_settings 2 · device_tokens 0 ·
account_deletion_jobs 2 (pending 1, canceled 1) · payments 2 · subscriptions 2 ·
cash_wallets 3 · cash_ledger 15 · user_warnings 0 · user_consent_records 12 · user_blocks 0 ·
mentor_student_rooms 2 · mobile_app_version_policies 2 (android min=9/latest=9, ios 1/1)

### Realtime publication (`supabase_realtime`)

question_threads · question_messages · question_attachments — 3개만 포함.
notifications / individual_questions / individual_question_messages / individual_question_attachments **부재** (M3 대상).

### Storage 버킷

13개 전부 private, 예외는 `profile-avatars` (public=true, 기존 계약 유지 대상).

### 확인된 결함 (수정 전 재현)

1. **P0 — users self-update**: `users_update_own` 정책이 본인 행 전체 UPDATE 허용 +
   `public.users` 에 anon/authenticated 테이블 레벨 UPDATE(및 DELETE/INSERT/TRUNCATE 등 광역) grant.
   보호 트리거는 `role` 컬럼 전용(`trg_users_role_guard`) → status/suspended_until/동의 시각 자가 변조 가능.
2. users.status CHECK 부재 (현재 데이터는 active 8행뿐 → CHECK 추가 안전).
3. notifications SELECT/UPDATE 정책·`notifications_at_least_one_recipient` CHECK 에 `recipient_user_id` 부재
   (정본 기록 함수 `record_domain_notification` 는 recipient_user_id + user_id 병기로만 통과).
4. reviews 공개 SELECT 정책·`get_mentor_review_stats`·`api_web_v1.mentor_directory_v1` 리뷰 집계에
   `moderation_state='visible'` 조건 누락.
5. content_reports INSERT allowlist 에 모호한 `shortform` 잔존. 웹은 숏폼 신고 시 `shortform`,
   앱은 게시판 댓글 신고 시 `comment` 를 전송(후자는 allowlist 에 없어 **현재 거부되는 실사용 결함**).
6. shortform_posts: INSERT 정책은 멘토 확인만(ugc gate 없음), UPDATE 정책은 소유권만
   (protected column 없음 — author/counter/status/idempotency 변조 가능), DELETE 도 gate 없음.
7. `increment_shortform_post_view`: PUBLIC EXECUTE 무제한 +1.
8. 숏폼 댓글(community_comments post_type='shortform')은 author_label 서버 파생 트리거의
   WHEN(board 한정) 밖 → 클라이언트 라벨 저장 가능. 본인 댓글 삭제 경로 부재.
9. `account_deletion_request_self(_consented)` 가 클라이언트 `p_cancelable_minutes`/`p_dry_run` 수용.
10. `mentor_directory_list_v2`/`mentor_profiles_for_directory_v2`/`mentor_user_public_v2` anon/auth EXECUTE
    (role=mentor 만 검사, full_name 반환, 200 상한) — 앱이 사용 중.
11. favorites 영문/한글 중복 RLS 정책 3쌍.
12. `users.notification_enabled`: DB 내 참조 0 (proc/view/policy/index/trigger 전수 검색) — 소스 검색 후 drop 예정.
13. 웹 가입 sync(`syncAfterSignUpSession.ts`)가 브라우저 클라이언트로 users upsert(role/status/동의 포함).
    가입 트리거 `handle_new_auth_user` 가 동일 필드를 서버측 정본으로 이미 제공 → 클라이언트 upsert 는
    중복이며 M1 이후 실패 예정 → read-verify 로 전환.
14. `issueUserWarningAction`: user_warnings INSERT → count → users update → audit log 가 **비트랜잭션**.

### 수정 전 PASS/FAIL 매트릭스 (요약)

| 영역 | 상태 |
|------|------|
| users self-update lockdown | FAIL (결함 1·2) |
| 신고 target type 단일화 | FAIL (결함 5) |
| 숏폼 무결성 | FAIL (결함 6·7·8) |
| 리뷰 공개 predicate | FAIL (결함 4) |
| 멘토 찾기 웹·앱 동일 표면 | FAIL (결함 10, 앱 legacy RPC) |
| IQ Realtime | FAIL (publication 부재) |
| 알림 Realtime·배지 | FAIL (publication 부재·클라이언트 페이지 카운트) |
| outbox 누적 방지 | FAIL (43 pending·worker 부재) |
| 계정 삭제 self 창 고정 | FAIL (결함 9) |
| 커뮤니티 게시글 create/update/이미지 (PR #57+#41) | PASS (검증 완료) |
| 질문방 차단·계정 게이트 (Build 13) | PASS (함수 파리티 확인) |
| 금융 확정 service-role 한정 | PASS (record_cash_topup_v2·subscription_checkout_confirm_v2 service_role 전용) |

## 6. 호출부 인벤토리 (요약)

### 웹이 호출하는 표면
- `api_web_v1` RPC: qna_create_question_thread, my_subscriptions_self, mentor_settlement_self,
  community_post_create/update/soft_delete, subscription_checkout_confirm_v2(service),
  weekly_question_usage_self, ensure_free_question_room, mentor_profile_update_self,
  mentor_plan_prices_set_self, mentor_payout_account_update_self, record_cash_topup_v2(service)
- `api_web_v1` 뷰: mentor_directory_v1, community_posts_v1, community_comments_v1, my_wallet_v1, my_cash_ledger_v1
- public RPC 주요: qna_*, get_mentor_review_stats, get_mobile_app_version_policy,
  increment_shortform_post_view/increment_community_post_view, mark_all_notifications_read,
  account_deletion_request_consented(service)/cancel(service)/status_self + worker adapter 9종(service),
  IQ 계열(create/claim/release/refund/list/hold), 맞춤의뢰 계열, 환불 admin 계열
- 직접 테이블 쓰기 잔존: shortform_posts insert/update(직접), community_comments insert(author_label 포함),
  comments insert/soft-delete, content_reports insert, favorites insert/delete, user_warnings insert(관리자),
  users upsert(가입 sync — 전환 예정), post_reactions/shortform_reactions insert/delete

### 앱이 호출하는 표면 (수렴 전)
- users 직접 UPDATE: `profile_edit_repository.dart` (nickname, grade_level) — 유일한 users 직접 쓰기
- 멘토 찾기: mentor_directory_list_v2 + mentor_profiles_for_directory_v2 + get_mentor_avg_response_hours,
  질문방 상대 조회: mentor_user_public_v2 · mentor_plans select(is_active 필터 **없음** — 주석과 불일치)
- 커뮤니티 읽기: community_posts/shortform_posts base table (view 미사용), comments/community_comments,
  post_reactions/shortform_reactions
- 커뮤니티 쓰기: api_app_v1.community_post_create/update(RPC), content_reports insert
  (target_type: 게시판 글 community_post · 게시판 댓글 **comment** · 숏폼 글 **shortform** · 숏폼 댓글 community_comment · 사용자 user)
- 질문방: qna_* RPC + Realtime(3테이블) + user_blocks
- IQ: create/claim/answer/release/refund/list/add_attachment — **Realtime 없음, iq_append_message 미사용**
- 알림: notifications select/update(markRead 직접), mark_all_notifications_read — Realtime·서버 unread count 없음,
  배지는 로드된 페이지 내 카운트
- 계정 삭제: account_deletion_request_self(_consented) (p_cancelable_minutes=30, p_dry_run=false 전송)
- 버전: get_mobile_app_version_policy(p_platform)
- Firebase 의존성 0 (pubspec/gradle/manifest/plist 확인, 회귀 테스트 존재)

## 7. cron / worker

`vercel.json` crons: subscription-renewal(10 18 * * *), individual-question-expiry(40 18 * * *),
account-deletion(0 * * * *, PR #56). 계정 삭제 worker 게이트: CRON_SECRET + ACCOUNT_DELETION_WORKER_ENABLED +
ACCOUNT_DELETION_SCHEDULED_REAL_RUN + feature flag — 기본 전부 fail-closed. 알림 push worker cron 없음(추가하지 않음).

## 8. 도구 가용성

- Node 22 + npm ✅ / psql 16 + postgresql-16 서버 ✅ (로컬 왕복 검증 가능)
- Supabase CLI ✗ → 규칙 36.7에 따라 기계 생성 timestamp(`date -u +%Y%m%d%H%M%S`)로 migration 파일명 채번,
  저장소의 timestamped 파일 규칙(supabase/sql + supabase/rollback)을 따른다.
- Flutter SDK ✗ → 앱 analyze/test/AAB 는 세션 내 설치 시도 후 불가 시 BLOCKED_ENV 로 기록 예정.
