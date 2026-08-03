# 전 기능 계약 수렴 실행 보고서 (웹) — 2026-08-04 세션

프리플라이트: `docs/audit/full_contract_convergence_preflight_20260804.md`.
로컬 왕복 러너: `scripts/verify/full_convergence_local_roundtrip.sh` (M1~M3 forward/rollback/재적용/clean).

## A. 기준점

| 항목 | 값 |
|------|-----|
| 웹 기본 브랜치 | `main` @ `7b732a3cd0d812157d50a4e25b754831ec760d63` |
| 웹 작업 브랜치 | `claude/ssambership-convergence-defect-closure-ckc2z2` |
| staging project | `lbeqxarxothkmzqvpudy` |
| 수렴한 기존 PR | #57(`c505205`) · #56(`930d92f`) · #55(`5dafd31`) — 중복 병합 0 |
| 신규 migration | M1 `20260803162257_security_identity_profile_lockdown` · M2 `20260803162808_domain_contract_convergence` · M3 `20260803163322_realtime_notification_convergence` |
| 적용 ledger(신규) | M1 `20260803170552` · M2 `20260803170916` · M3 `20260803171053` (정확히 3행) |
| Build 13 ledger | `20260802054930` — 1행 불변, 재적용 0 |
| 복원한 drift 소스 | `20260803142534_iq_append_message_v1` · `20260803142559_iq_attachment_author_v1` (ledger 본문 md5 byte-exact) |

### migration 파일 SHA-256

- M1 `d7e41c2fefd33a29bb4362d3b6d32039288e425d9e5eb30e1b756ec11aa8a310`
- M2 `cad7aff711e08bae66eda0e348dac27c85485534560e90e946f122bb92dfb8f2`
- M3 `37c0b3a6919c95201d11d97de56efa9b0da72b70e9036760ca7bd9535a6c7170`

## B. 수정 결과 (기능별)

| 영역 | Supabase | 웹 | 판정 |
|------|----------|-----|------|
| users self-update lockdown | users 테이블 client UPDATE 회수 + `users_protected_columns_guard`(INVOKER) 트리거 + `users_status_allowed` CHECK | 가입 sync 를 트리거 결과 검증으로 전환(직접 upsert 제거) · `api_web_v1.user_profile_update_self` | PASS |
| 프로필 self RPC | `api_app_v1`/`api_web_v1.user_profile_update_self` + `core_private` 공용 impl · 마케팅 동의 별도 RPC | — | PASS |
| 멘토 찾기 | `api_web_v1.mentor_directory_v1` 리뷰 predicate + 삭제진행 제외 · legacy RPC 3종 EXECUTE 회수 | (앱 전환은 앱 보고서) | PASS |
| 리뷰 공개 predicate | RLS·`get_mentor_review_stats`·directory 집계 전부 `moderation_state='visible'` | `reviewQueries.applyPublicFilters` + `isPubliclyVisibleReview` | PASS |
| 신고 target | INSERT allowlist 5종(모호 `shortform` 제거) | 숏폼 신고 `shortform_post` · legacy `comment` 는 테이블 실재로만 수렴(`resolveLegacyCommentTargetType`) | PASS |
| 숏폼 무결성 | ugc gate 3정책 + `shortform_posts_protected_guard` 트리거 + `shortform_view_events`/`shortform_view_record_v2` · legacy +1 회수 | `incrementShortformView`→v2(impression당 key) · 댓글 author_label 전송 제거 | PASS |
| 숏폼 댓글 | 서버 파생 label 트리거(shortform) + `community_comment_soft_delete_self` + status `deleted` | (앱 UI는 앱 보고서) | PASS |
| 개별질문 게이트 | `answer_individual_question` 계정4+삭제+차단+승인 게이트 · `add_individual_question_attachment` 신규등록 Storage fail-closed | — | PASS |
| 금융 ACL | cash/subscription/payments/refunds/withdrawals 잉여 write 회수(인가 INSERT 3종 유지) | (금융 확정은 기존 service 경로 유지) | PASS |
| 경고 자동정지 | `admin_issue_user_warning` 원자 RPC | `issueUserWarningAction`→RPC 단일 경로(비트랜잭션 제거) | PASS |
| 즐겨찾기 | 영·한 중복 정책 → 영문 3종 | — | PASS |
| 계정 삭제 self v2 | `account_deletion_request_self_v2`/`_consented_v2`(창 30분 서버고정) · 구 self RPC authenticated 회수 | (앱 호출 전환은 앱 보고서) | PASS |
| 알림 Realtime | publication +notifications/IQ3 · RLS recipient_user_id · read 미러 트리거 | `markNotificationRead`→`mark_notification_read` RPC | PASS |
| unread count | `notification_unread_count_self`(앱 제외 타입 동일) | — | PASS |
| outbox 억제 | transport config 게이트 · pending 43→suppressed · `record_domain_notification` outbox 게이트 | — | PASS |
| notification_enabled | users 컬럼 drop(참조 0) | — | PASS |
| 계약 스냅샷 CI | — | `scripts/contracts/*` + `contracts/snapshots/staging_contract.json` + `lib/contracts/__contract__/outboundSurface.contract.test.ts` | PASS |

## C. P0/P1 해소

1. **P0 users self status 변조**: 원인 — `users_update_own` 전체 컬럼 UPDATE + 테이블 레벨 client UPDATE grant, role 전용 트리거.
   수정 — 테이블 client UPDATE/DELETE 회수(SELECT·가입 INSERT 유지), `users_protected_columns_guard`(SECURITY INVOKER — DEFINER 면 owner 로 우회되는 문제 로컬 검증 중 발견·수정), status/role/suspended/동의/created 보호, self 프로필은 RPC.
   테스트 — 로컬 M1-3/4/5(직접 UPDATE 거부·status 자가변조 거부·트리거 보호컬럼 거부) + staging post-verify(client UPDATE grant 0). 결과 PASS.
2. **P1 신고 target 단절**: 게시판 댓글 앱이 `comment` 전송 → 서버 allowlist 밖 → 신고 실패. 수정 — 앱 `board_comment`(앱 보고서) + 웹 숏폼 `shortform_post`. 결과 PASS.
3. **P1 숏폼 own-row 전체 컬럼 변조**: 소유권만 검사하던 UPDATE 정책 → protected trigger + status 전이 제한. 결과 PASS.
4. **P1 무제한 view +1**: anon 무제한 → 이벤트 원장 멱등 v2. 결과 PASS.
5. **P1 outbox 무한 pending**: 43 pending·worker 부재 → transport 게이트 + suppressed(삭제 0). 결과 PASS.

## D. 데이터 변화

로컬 왕복 러너의 before/after business row count 완전 일치(users/community_posts/shortform_posts/comments/reviews/favorites/iq/threads/subscriptions/payments/cash_ledger/cash_wallets/notifications/outbox/deletion_jobs).
staging 실측 전후: users 8·community_posts 10·payments 2·cash_ledger 15·subscriptions 2 불변. account_deletion_jobs 상태 불변(pending 1·canceled 1). Build 13 ledger 1행 불변.

허용된 변화만 발생:
- notifications read backfill (행 수 43 불변, `read` 미러 정합화, `read_at` 채움)
- notification_outbox pending 43 → suppressed 43 (총행 43 불변, 삭제 0)
- notification_transport_config seed 1행 (신규 테이블)
- shortform_view_events 신규 0행

실사용 데이터 변경 없음: 게시글·리뷰·질문·결제 상태·캐시·구독·계정삭제 job·실제 user status 모두 불변.

## E. 테스트

- `npx tsc --noEmit` — 통과(0)
- `npm run lint` (eslint) — 통과(0)
- `npm run test:contract` — **362/362 pass** (신규 outbound-surface guard 9종 포함)
- `npm run build` (next build) — 통과
- `npm run contracts:verify` (offline) — source/applied parity OK(55 ledger)
- 로컬 DB 왕복(`scripts/verify/full_convergence_local_roundtrip.sh`) — 전 단계 PASS
  (M1 16 · M2 35 · M3 11 assertions × forward·재적용·clean, rollback 3, 데이터 불변식 OK)
- staging M1→M2→M3 적용 + 각 self-check + 외부 post-verify — PASS

## F. 산출물

- 브랜치: `claude/ssambership-convergence-defect-closure-ckc2z2` (push 완료)
- 신규 migration 3 + rollback 3 + 복원 drift 소스 2
- 로컬 검증: fixture 1 + verify SQL 3 + rollback-verify 1 + 러너 1
- 계약 CI: query/export/verify 스크립트 3 + snapshot 1 + guard 테스트 1
- E2E: admin credential helper(`e2e/helpers/adminCredentials.ts`) + auth 배선

## G. 잔여 blocker

- **BLOCKED_ENV — 웹 E2E 실행**: staging Supabase(`lbeqxarxothkmzqvpudy.supabase.co:443`) 로의
  outbound HTTPS 가 이 세션의 egress 정책에서 403(CONNECT 거부)로 차단된다. E2E 는 live
  Supabase 로그인을 요구하므로 실행 불가. **코드·자격 배선은 완료**:
  - `E2E_ADMIN_EMAIL_PRESENT: YES` · `E2E_ADMIN_PASSWORD_BASE_PRESENT: YES` ·
    `E2E_ADMIN_PASSWORD_SUFFIX_RESTORED: YES` · `E2E_ADMIN_PASSWORD_LOGGED: NO`
  - 관리자 비밀번호는 `getE2EAdminCredentials()` 단일 helper 가 base+'#' 를 메모리에서만 조립
    (파일·로그·리포트 노출 0). 학생/멘토는 suffix 보정 없음.
  - 복구 후 실행 명령: `npm run start` + `npx playwright test` (또는 preview config).
- **코드 blocker 아님**: production Vercel cron plan 확인·실기기 QA·운영 worker real-run 은
  코드 밖 운영 단계다(BLOCKED_EXTERNAL / NOT_RUN_DEVICE / OUT_OF_SCOPE_POLICY).
- 계약 스냅샷 온라인 diff(`SUPABASE_DB_URL` 필요)는 동일 egress 차단으로 미실행 — 단, 스냅샷 자체는
  MCP 경로로 DB 실측에서 생성했고 offline parity 는 통과.

## H. 최종 판정 (웹 범위)

```
SOURCE_CONVERGENCE: PASS
STAGING_DB_CONVERGENCE: PASS
WEB_CONTRACTS: PASS
SECURITY_P0: PASS
FUNCTIONAL_P1: PASS
REALTIME_IN_APP_NOTIFICATIONS: PASS (DB·웹 소비자)
ACCOUNT_DELETION_WORKER_CODE_READY: YES
ACCOUNT_DELETION_REAL_RUN_ENABLED: NO
OS_PUSH_POLICY: EXCLUDED_APP_F0
CONTRACT_SNAPSHOT_CI: PASS
PRODUCTION_DEPLOYED: NO
PLAY_UPLOADED: NO
WEB_E2E: BLOCKED_ENV (egress 정책 — 코드·자격 준비 완료)
READY_FOR_PRODUCTION: NO (production migration·실기기 QA·운영 worker 단계 잔존)
```
