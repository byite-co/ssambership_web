# 웹×Supabase 접합부 집중 학습 보고서 (2026-07-27)

> 기준 보고서: `docs/audit/V16_CROSS_REPO_FINAL_CHANGE_REPORT_20260724.md` (v16 교차 저장소 최종 변경 보고서).
> 범위: **웹(`ssambership_web`) 전용** — 앱(Flutter) 저장소는 배제하되, 웹 안의 앱 표면(`app/app/**`, app-session)은 웹 코드이므로 포함.
> 방법: main HEAD `a1841ef` 소스 전수 스캔(병렬 탐색 4트랙) + GitHub PR/브랜치 실조회 + Supabase staging(`lbeqxarxothkmzqvpudy`) 실측(list_tables / list_migrations).
> 이 문서는 학습 산출물이며 **코드·DB를 일절 변경하지 않았다.**

---

## 1. 웹의 위치와 위상

쌤버십 제품에서 웹은 **결제·상거래의 유일한 표면이자 모든 도메인의 정본 UI**다.

- 결제(토스 충전·구독 시작)·캐시·정산·관리자 콘솔은 웹 전용. 앱은 Commerce-Zero(결제 SDK 0, `/wallet/charge`·`/subscribe` 열기 0)가 실측 계약이다(기준 보고서 §10).
- 웹은 동시에 **앱을 위한 세션 게이트웨이**다: `POST /api/app-session/bootstrap`가 앱 토큰을 HttpOnly 쿠키 세션으로 교환하고, `/app/community/shortform/new`(무chrome 작성 표면)와 `/app/bridge/*`를 제공한다.
- DB와의 관계에서 웹은 "정책 집행자"가 아니라 **"게이트 검증 후 위임자"**다. 돈·상태 전이·알림 발행의 최종 권위는 전부 DB(SECURITY DEFINER RPC·트리거·RLS)에 있고, 웹은 (1) 게이트 검증 → (2) RPC 호출 → (3) `revalidatePath` 배선만 담당한다.

**스택 실측**: Next.js 16.2.4 / React 19.2.4 / `@supabase/ssr` 0.10.2 / `@supabase/supabase-js` 2.104.1.

---

## 2. 연결 계층 — Supabase 클라이언트 4종 (모든 접합부의 진입점)

| 팩토리 | 파일 | 키 | import 규모 | 실패 모드 |
|---|---|---|---|---|
| `createClient()` (server) | `lib/supabase/server.ts:4` | anon 3단 폴백 + 쿠키 세션 | **144 파일** — 웹 기본 경로 | fail-open(빈 키로 진행+로그) |
| `createServiceRoleClient()` | `lib/supabase/admin.ts:13` | `SUPABASE_SERVICE_ROLE_KEY` 단일, 폴백 0 | **48 파일 / 166 호출** | **fail-closed(throw)** + `server-only`로 번들 유출 시 빌드 실패 |
| `createAppSurfaceClient()` | `lib/supabase/appSurfaceServer.ts:23` | anon + **HttpOnly/Secure/Lax/Path=/ 강제** | **2 파일**(계약테스트 allowlist 고정) | env 누락 시 무로그 → `session_expired` 수렴 |
| `createClient()` (browser) | `lib/supabase/client.ts:1` | anon | 6 파일(auth·업로드) | fail-open |

핵심 계약:

- **웹 표면 `server.ts`는 쿠키 속성을 오버라이드하지 않는다**(httpOnly=false 유지) — 브라우저 로그인이 `document.cookie`로 세션을 쓰기 때문. `appSurfaceCookieWiring.contract.test.ts:33-37`이 `httpOnly` 문자열 등장 자체를 금지해 회귀 감시.
- **앱 표면은 전 생애주기 쿠키 강제**: `hardenAppSurfaceCookieOptions`(`lib/appSession/appSurfaceCookies.ts:37-41`)가 최초 발급·refresh 재발급·회전·`maxAge=0` 삭제·chunk 쿠키(.0/.1/…)까지 고정 속성으로 덮어쓴다. spread 순서(`{...options, ...FIXED}`)가 계약.
- **`middleware.ts`는 Supabase를 import하지 않는다**(21줄, `x-pathname`/`x-return-to` 헤더 주입만). 세션 refresh·보호 라우트 차단이 미들웨어에 없고 **인증 게이팅은 100% RSC 레이어**다. 파생 흔적 2건: 로그인 후 `window.location.assign` + 150ms 지연(`RoleLoginForm.tsx:183-190`, 쿠키-RSC 레이스 회피), `server.ts:38-42`의 setAll 무음 삼킴(RSC 렌더 중 refresh 쿠키 유실 가능 경로).
- 관리자 쓰기 폴백 금지: `lib/admin/adminWriteClient.ts:35` `resolveAdminWriteClient`는 세션 클라이언트를 인자로 받지 않아 service_role→세션 폴백이 **구조적으로 불가능**(과거 0행 갱신을 성공으로 로깅하던 데이터 발산의 재발 방지).

### 인증 게이트

- `requireRole(role)`(`lib/auth/routeGuard.ts:41-59`) — **130 호출 / 98 파일**(admin 58 · mentor 39 · student 33). 반환되면 세션+`public.users` 프로필+role 일치 보장. 역할 불일치는 본인 홈으로 redirect.
- `requireQnaActor()`(`routeGuard.ts:80-99`) — actor를 **프로필 role에서만** 도출(formData `actor` 불신뢰).
- 계정 게이트 **이원화**(의도적, 계약테스트로 양방향 봉인):
  - 웹 `assertAccountActive`(`lib/auth/accountStatus.ts:71-94`) = **fail-open**(조회 오류·행 없음·미지 status 전부 통과, banned/유효 suspended만 차단).
  - 앱 표면 `assertAppSurfaceAccountActiveStrict`(`lib/appSession/appSurfaceAccountGate.ts`) = **fail-closed**(거부 사유 enum 8종, status allowlist 정확히 2종, 삭제 상태는 `account_deletion_status_self` RPC로 확인·불명도 거부). anon 키만으로 완결 — 앱 표면에 service_role 미도입.
- open redirect 0: `safeInternalNextPath` 5중 검사 + 역할별 경로 매칭(`getPostLoginPath.ts:6-17, 36-88`). 앱 표면은 임의 URL 파라미터 자체가 없고 enum 조립만 가능(`appSurfacePaths.ts`).
- auth 호출 전수 13곳: `signInWithPassword`(학생·멘토 클라이언트 / 관리자 서버액션), `signUp`, `signOut`, `updateUser`, `resetPasswordForEmail`, `setSession`(bootstrap 단 1곳). **`getSession`/`refreshSession`/`exchangeCodeForSession` 호출 0건** — 세션 확인은 항상 `auth.getUser()`(서버 왕복 검증)뿐.

### app-session bootstrap (앱→웹 세션 접합부)

`app/api/app-session/bootstrap/route.ts` — 9단 검증: 메서드 405 → 본문 파싱(16KB 상한, form/json만) → env → **JWT 프로젝트 ref 일치**(오배선 차단, 서명 검증은 getUser가 담당) → `setSession` → `getUser` 재검증 → strict 계정 게이트 → 멘토 role → 서버 상수 target으로 303. **pendingCookies 격리 버퍼**: 실패 응답 9종 전부 Set-Cookie 0, 쿠키는 전 검증 통과 성공 응답에만 부착. target enum은 `shortform_create` 단 하나 — 결제·구독 target은 존재하지 않는다.

---

## 3. 웹→DB 접합부 전수

### 3-1. RPC 호출 51종 (요약)

| 도메인 | RPC (호출 클라이언트) |
|---|---|
| 질문방 | `qna_create_question_thread` · `qna_append_message` · `qna_confirm_thread` · `qna_flag_wrong_answer` · `qna_register_attachment` (server, 래퍼 `lib/qna/questionRoomRpc.ts`) · `get_weekly_question_usage` · `get_mentor_student_nicknames` |
| 개별질문 | `create_individual_question_with_hold(_v2)` · `claim_individual_question_v2` · `release_individual_question_payout` · `refund_individual_question_hold`(cron) — 전부 **service_role** · `set_individual_question_price`(server, SD RPC) · `list_open_individual_questions_for_mentor` |
| 맞춤의뢰 | `record_custom_order_escrow_hold/refund` · `record_custom_order_dispute_split` · `accept_custom_order_deliverable_atomic`(service_role) · `custom_order_mentor_start/_deliver` · `custom_order_student_request_revision`(server) · browse RPC 2종 |
| 캐시·구독 | `record_cash_topup` · `record_subscription_cash_debit`(보정 전용) · `confirm_subscription_checkout` · `process_subscription_renewal`(cron) · `refresh_subscription_settlement_items` — 전부 service_role |
| 리뷰·멘토 공개 | `get_mentor_review_stats` · `get_mentor_avg_response_hours` · `mentor_directory_list_v2` · `mentor_user_public_v2` · `mentor_profiles_for_directory_v2`(v1 3종은 078에서 revoke) |
| 관리자 | `approve/reject_refund_request_admin`(service_role; `bulkActions.ts:106`은 RPC명 동적 분기) · `approve_mentor_school_verification_admin`(**세션 클라이언트** — RPC 내부 `is_admin()`이 호출자 JWT를 읽으므로 service_role로 부르면 NOT_ADMIN. 유일한 역행 예외, 계약테스트로 고정) |
| 알림·커뮤니티 | `mark_all_notifications_read` · `increment_community_post_view` · `increment_shortform_post_view` |
| 계정삭제 saga | `account_deletion_request_consented/cancel/advance/begin_locked/record_error/revoke_sessions/storage_owner_refs/verify_object_owners/forfeit_and_anonymize/claim/reclaim_expired`(service_role, cron 워커) · `account_deletion_status_self`(appSurface, authenticated self RPC) |

DB에 있으나 **웹 호출 0건**인 함수군(누가 부르는지 구분 학습): 152 outbox worker RPC(미배선, `outboxWorker.ts`는 순수 모듈), 108/153/156 지급 RPC(DRAFT·게이트 대기), 162 `get_mobile_app_version_policy`·168 `add_individual_question_attachment`·161 self 래퍼 2종(앱 전용), `check_review_eligibility`(RLS 정책 내부 소비), `is_admin` 등 정책 술어 ~30종.

### 3-2. 테이블 49종 — 읽기/쓰기 경계

**웹에서 읽기 전용(쓰기는 RPC/트리거 봉인)**: `cash_ledger` · `cash_wallets` · `notifications` · `account_deletion_jobs` · `custom_request_orders` · `mentor_student_rooms` · `custom_request_applications` · `custom_order_deliverables` · `order_events` · `app_notices`(공개측) · `verification_logs` 등. **이 경계가 깨지면 원장 무결성·멱등 계약이 붕괴한다.**

직접 쓰기가 남은 대표: `mentor_profiles`(36곳, 최다) · `users`(23곳) · `community_posts`/`shortform_posts`(멱등키 INSERT) · `reviews`(INSERT/UPDATE, 최종 강제는 RLS) · `subscriptions`(해지 예약·되돌리기 UPDATE만) · `refunds`(학생 신청 INSERT) · `connection_notes` · `disputes`/`content_reports`(관리자).

### 3-3. Storage 버킷 13종

정본 목록: `lib/account/accountDeletionBucketCoverage.ts:31` (`ACCOUNT_DELETION_ALL_BUCKETS`).
`student-id-images`(signed URL TTL 300s) · `profile-avatars`(유일한 public) · `community-post-images` · `shortform-videos`(**signed upload 티켓** — 서버가 경로 조립, 브라우저가 직접 업로드해 Server Action body 413 회피) · `shortform-thumbnails` · `question-room-attachments` · `individual-question-attachments`(TTL 600s) · `custom-request-post-attachments` · `custom-request-application-attachments` · `custom-order-deliverables` · `custom-order-message-attachments` · `connection-note-ink`/`scan-annotations`(웹 업로드 경로 없음, 탈퇴 purge 커버리지만).
signed URL 단일 진입점: `lib/storage/signedStorageUrl.ts:12`. 동적 버킷명 2건(`accountDeletionAdapters.ts:304/420`, `communityShortformStorage.ts:88`)은 리터럴 grep에 안 잡히는 접합부.

### 3-4. API 라우트 24종

- 도메인: question-room 4(전부 RPC 위임) · reviews 6 · mentors 2 · mentor/payouts 3 · mypage 1 · community 2 · subscribe/checkout 1 · toss 2 · cron 3 · app-session 1.
- cron 3종(`account-deletion`, `subscription-renewal`, `individual-question-expiry`)은 **timing-safe `CRON_SECRET`** + service_role — 사용자 세션 경로와 완전 분리.

### 3-5. 계약테스트 — 34파일 / 9디렉토리 (기준 보고서 21파일에서 증가)

기준 보고서(07-24) 이후 `lib/account/__contract__/` 8개(계정삭제 saga)·`lib/appSession/__contract__/` 6개가 추가됐다. 성격상 이 테스트들은 **웹-DB 접합부의 회귀 방지 장치 그 자체**다: 소스 스캔 tripwire(쿠키 배선·Toss self-fetch 금지·Commerce-Zero), SQL과 1:1 진리표(리뷰 자격=SQL 170, job 상태=SQL 175, owner refs=SQL 181/183), 멱등·보상 계약(숏폼 필드·videoRef·백오프).

---

## 4. SQL 정본 체계 (supabase/sql 190파일, 001~184)

### 4-1. 구간별 위상

| 구간 | 성격 | 웹 접합 요지 |
|---|---|---|
| 001–073 | 초기 스키마 → P0 하드닝 | 돈 경로를 service_role RPC로 봉인, 클라이언트 직접 write 정책 삭제(023/025/027/028…) |
| 074–121 | 기능 확장 + 앱 호환 래퍼 + 수수료 확정(90/95/96) | 078 공개 멘토 read v2 whitelist(v1 revoke) · 091/092/094는 앱이 이름으로 부르는 authenticated 래퍼 · 105~110/114 지급 스택은 **DRAFT 미적용**(108/109/110 실행 금지 표기) · 119 role 가드 |
| 122–156 | v16 수렴·보안 마감 | 122 가입 admin 자가승격 차단 · 123/126 reviews 수렴 · 131/143/145 구독 체크아웃 원자화 · 132 알림 outbox 기반(`(recipient,event_key)` 부분 UNIQUE) · 136/141/144/149 질문방 원자 RPC+직접 write 트리거 가드 · 151/152/154/156 삭제 saga·알림 worker(플래그 OFF) |
| 157–166 | 알림 원자화 완결 + 정책 수렴 | 157~159 트리거 알림(웹 발송 코드 삭제 근거) · 160 헬퍼 ACL(ALTER DEFAULT PRIVILEGES 함정 봉인) · 161 self RPC · 163/164 댓글 양방향 브리지 · 165 숏폼 INSERT 우회 제거 · 166 승인 시 요금제 시드 |
| 167–184 | 웨이브 1/2/4/5 | 167~169 IQ 첨부 계약(**미적용 초안, W3 대기**) · 170 리뷰 자격 관계 기반 전환 · 171/173 리뷰 수정 개통+모더레이션 가드 · 174 학교인증 승인 정본 RPC(07-26 적용) · **175~183 계정삭제 saga 하드닝 9연발**(07-26~27 적용, flag OFF) · 184 관리자 시드 |

결번 127·172, 레거시 번호중복 8건(재번호 금지 원칙). `INDEX.md`는 001–059만 커버 — 060 이후 정본 인덱스는 `docs/audit/sql_apply_manifest.md` + `apply_manifest_prod.md`(우선).

### 4-2. 적용 규약과 드리프트 (실측)

- **`supabase/migrations/` 디렉토리는 없다.** CLI 마이그레이션 워크플로 대신 `supabase/sql/NNN_*.sql` + MCP `execute_sql` 수동 적용 + 매니페스트 문서로 이력 관리.
- staging(`lbeqxarxothkmzqvpudy`) 마이그레이션 원장 실측: 31건, 최신 기재는 156(2026-07-20)까지. **157 이후와 122~130 다수는 SQL Editor/execute_sql 적용이라 원장 미기재 — 의도적 드리프트**(오너 방침)이며 `sql_apply_manifest.md` 하단 표가 정본 이력.
- 불변 원칙: 적용된 파일은 수정·재번호 금지, 보정은 **항상 다음 빈 번호 신규 파일**(163→164, 171→173, 175→179→182가 실사례). 검증은 rollback-only 재현→적용→fixture PASS→baseline 복원→manifest 기록 6단계.
- production: **미적용이 정상 상태**(런북 `production_apply_runbook.md` 준비 완료, 오너 승인 대기).
- staging 실측: public 테이블 78개 **전부 RLS 활성**.

### 4-3. 접합 메커니즘 3종 (웹이 DB를 소비하는 방식)

1. **RPC 호출** — 웹 `.rpc()` 50여종(§3-1). 자금 RPC 17종은 `anon=false, authenticated=false, service_role=true`가 기대상태(`db_expected_state.md`).
2. **트리거 자동 발화** — 웹의 domain write(또는 RPC)가 트리거를 발화: 알림 원자화(155/157~159), 요금제 시드(166), 직접 write 가드(141/144), 댓글 브리지(163/164), 삭제 write gate(151 `adg_*`). 총 트리거 90건.
3. **RLS 차단/허용** — 누적 CREATE POLICY 265건/68테이블(현재 살아있는 수와 다름 — 후속 파일이 DROP·좁힘). 핵심 기대상태: `payments` UPDATE 정책 0 · `mentor_student_rooms` INSERT/UPDATE 정책 0 · `mobile_app_version_policies` RLS on+정책 0(RPC 전용 패턴) · 165의 permissive OR 결합 교훈.

SECURITY DEFINER 패턴 3종: ①트리거 함수형(EXECUTE 전부 revoke해도 동작 — 노출 표면 아님) ②표시 헬퍼형(160이 anon/authenticated revoke — **ALTER DEFAULT PRIVILEGES가 신규 함수에 EXECUTE 자동 부여하는 함정**이 최중요 학습점) ③비노출 스키마 프록시형(`auth.*`/`storage.*`는 PostgREST 밖 → PGRST106 → public SD RPC로 우회: 177/181/183).

---

## 5. Supabase 접합 PR·브랜치의 현재 위상 (GitHub 실조회)

열린 PR 4건 — **전부 Supabase SQL 접합 PR·전부 draft·전부 사실상 superseded**:

| PR | 제안 내용 | main 정본 수렴처 | 판정 |
|---|---|---|---|
| #33 `claude/ssambership-final-validation-td9r56` | SQL121 가입 admin 자가승격 차단 (P0) | `122_signup_role_no_admin.sql` + staging 원장 `20260717 fix_xv01_*` 2건 | **해소됨** |
| #31 `fix/reviews-canonical` | SQL120 reviews 3중정의 수렴 | `123_reviews_converge.sql` + `126_reviews_rls_hardening.sql` (07-19 staging 적용) | **해소됨**(더 강한 형태로) |
| #34 `claude/sambership-session-handoff-7z5xdi` | SQL122~125 스크랩/실시간/잔액소멸/환불 | `130_shortform_scrap_reaction.sql` · `137_p3_8_realtime_messages_threads.sql`(PR #43 선적용 계보) · 잔액소멸→176/180 계열 · `128_refund_admin_restore_escrow.sql` | **해소됨** |
| #27 `verify/cross-final-2026-07` | 2차 크로스 검증 NO-GO 판정 문서 | 지적 P0/P1 전부 후속 해소(122·130 등) | 기록 가치만 잔존 |

브랜치 43개 중 SQL/DB 접합 계보: `claude/supabase-sql-web-paths-8n8whb` · `claude/v16-web-db-autonomous-g7glnb` · `wave1/server-sql-draft` · `feat/s1-db-contract-recovery` · `feat/s3-rls-pricing` · `claude/web-app-fixes-bug-rollback-cx52cq`(=머지된 PR #42) · `claude/admin-account-creation-5zql3q`(=머지된 PR #45, SQL 184의 출처) 등. main은 PR #42(v16)·#45(관리자 시드)·#46(카피 복구)까지 머지된 상태.

---

## 6. 도메인별 신호 흐름 (접합부 중심 요약)

각 도메인은 "웹이 DB에 보내는 신호(호출)와 DB가 웹에 돌려주는 신호(코드·트리거 결과)"가 명확히 정의되어 있다.

### 결제 (토스 충전)
승인 2경로(success 페이지 RSC + `/api/toss/confirm`)가 **같은 코어** `confirmCashTopupCore`(`lib/toss/tossTopupCore.ts:170`)를 공유. 검증 순서 계약: 형식→인증→orderId 파싱(`cash-{uid}-{ts}`)→소유자 일치→패키지 allowlist(하드코딩 5종)→시크릿 존재→**그제서야 Toss 승인**→응답 4중 재검증→멱등 원장(`record_cash_topup`, 키=orderId). 1~6 실패 시 Toss fetch 0회. 웹훅은 별도 게이트(HMAC 서명+결제 재조회)로 동일 원장 함수에 수렴. `payments` 테이블은 topup에 쓰지 않음(`[SERVER_GATE]` 주석 규약으로 SQL 트랙 위임).

### 구독
금액 결정 3층 폴백: `mentor_plans` 행(cents/KRW 컬럼 탐지) → 권장가(`mentorPlanPricing.ts`) → 카탈로그(`subscribePlanCatalog.ts`). 단 **최종 금액 권위는 RPC** — `confirm_subscription_checkout`이 `mentor_plans` 정본에서 재계산. 시작=단일 원자 RPC, 갱신=cron `process_subscription_renewal`(멱등키 `sub_renewal:{id}:{periodEnd10}`), 해지 예약·환불 신청만 `subscriptions`/`refunds` 직접 write. 알림은 웹이 만들지 않음(157 트리거). DB에 tier 행이 없으면 `ensureMentorCatalogPlanRows`가 카탈로그→DB 역방향 시드.

### 질문방
웹도 `qna_*` 원자 RPC를 쓴다(정본 래퍼 `lib/qna/questionRoomRpc.ts` ← SQL 136). 직접 write는 `connection_notes`만 잔존. `answered` 직접 write 경로는 폐지 명시. `weekly_question_usage`는 `get_weekly_question_usage` RPC로만 읽고 실패 시에만 `question_threads` 카운트 폴백(tier 한도 4/9/999 미러). 첨부는 업로드→RPC 등록 실패 시 보상 삭제.

### 커뮤니티/숏폼
signed upload 티켓(경로는 서버 조립 `{userId}/{uuid}.{ext}`) → 브라우저 직접 업로드 → finalize는 문자열 10키만 추출(`shortformSubmitFields.ts`)·ref 소유권 검증(`shortformVideoRefBelongsToUser`)·`create_idempotency_key` UNIQUE로 1행 보장. 보상 삭제 3분기(DB 실패/멱등재생/교체) 전부 이번 요청분만, 오류 은폐 금지. 표면 분기 1곳(`submitShortformUploadCore(surface)`)이 웹/앱 클라이언트·게이트·redirect를 가른다.

### 알림
웹은 **생산 0**(insert 모듈 부재·호출 0건 — 발행은 SQL 155/157~159 트리거와 `record_domain_notification` 전담), 조회·설정 upsert·읽음 처리만. 전체 읽음은 `mark_all_notifications_read` RPC(소유권은 `auth.uid()` 판정). 딥링크는 내부 상대경로만 통과(`notificationDeepLink.ts` — http/`//` 시작 값 스킵). outbox 워커는 순수 모듈로 존재하나 **미배선**(dry-run, 실 FCM은 앱 부채).

### 맞춤의뢰·개별질문 (에스크로)
지갑 직접 조작 금지가 전역 계약. hold→(deliver/accept)→payout/refund/dispute-split 전이가 각각 전용 service_role RPC. 맞춤의뢰 hold는 3단 보상(order INSERT unpaid → hold RPC → 실패 시 unpaid 조건 삭제; "escrowed without hold" 불가). 개별질문 만료 환불은 cron+멱등키 `iq_refund:{id}`.

### 리뷰
**"동일 멘토 2회 연속 결제" 기준은 폐기됨** — 현행 정본은 SQL 170 관계 기반: (B) 구독 status ∈ {active, expired, cancel_scheduled} 또는 (C) 개별질문 status ∈ {answered, released}. 웹 사전판정(`reviewEligibilityPolicy.ts`)과 RLS(`reviews_insert_student` WITH CHECK → `check_review_eligibility(mentor_id, auth.uid())` — **인자 순서가 계약**)가 1:1 미러. SQL 173 이후 모더레이션 리뷰 UPDATE는 예외가 아니라 **0행**으로 끝나므로 웹 `updateReview()`의 1행 계약이 짝이다(웹-DB 결합 대표 사례).

### 정산·지급
웹은 계산·표시만(`payoutComputation.ts` — 수수료 15/5/15%, 원천징수 3.3%, 매월 23일 = SQL 153 규칙 미러), 지급 write 0. 지급 스택 SQL(105~110/114, 108 `pay_due_payouts`)은 DRAFT 미적용 — DB에 없어도 웹 코드는 후보 테이블 탐색형 읽기로 무해.

### 관리자
5단 관례가 전 파일 일관: 첫 줄 `requireRole("admin")` → service_role fail-closed 확보 → RPC(`p_admin_id`=세션 user.id, 폼 값 아님) → `error`+`payload.ok` 이중 검사 → `admin_action_logs` 기록.

### 계정삭제 saga (최신 접합부, 2026-07-26~27)
`/api/cron/account-deletion` 워커가 claim→advance→begin_locked(TOCTOU 0)→revoke_sessions(auth.sessions 실삭제 RPC — auth-js에 uid 기반 전세션 종료 admin 메서드가 없는 것의 우회)→storage_owner_refs(PGRST106 우회 SD RPC)→verify_object_owners(타인-owner verdict, 값 비노출)→forfeit_and_anonymize(멱등키 `acct_del_forfeit:{uid}`, 레거시 키 존재 시 fail-closed). **전 구간 기능 플래그 OFF** — DB 객체만 존재, 실삭제 없음.

---

## 7. 설계 불변식 사전 (접합부 신호 검토용)

1. **돈은 RPC로만**: `cash_ledger`/`cash_wallets` 웹 쓰기 0. 자금 RPC 17종 = service_role 전용이 기대상태.
2. **멱등 키 사전**: `cash-{uid}-{ts}` · `sub_debit_{paymentId}` · `sub_checkout_{paymentId}` · `sub_initial:{subId}` · `sub_renewal:{subId}:{periodEnd10}` · `sub_cancel/sub_expired:{subId}:{periodKey}` · `iq_refund:{id}` · `acct_del_forfeit:{uid}` · 커뮤니티 `create_idempotency_key=requestId(UUID)` · 알림 `(recipient, event_key)` 부분 UNIQUE.
3. **웹은 알림을 생산하지 않는다** — 발행은 DB 트리거, 웹은 읽기·설정·읽음만.
4. **순수 코어+포트 주입+계약테스트** 패턴이 결제·구독·알림·리뷰·삭제 saga에 일관 적용(node --test, 34파일).
5. **RLS 차단은 예외가 아니라 0행** — 웹은 영향 행 수를 반드시 검사(리뷰 173, 숏폼 UPDATE 등).
6. **스키마 탐지(`pickExistingColumn`/후보 테이블 배열)는 레거시 유연성용** — 금전 경로는 반대로 고정 시그니처.
7. **오류 노출 정책**: 도메인별 sanitize 함수 고정(Toss 원문·RPC 코드·PGRST 문자열을 사용자에게 미노출).
8. **[SERVER_GATE] 주석 규약**: 웹에서 구현 불가한 항목을 SQL 파일:줄 근거와 함께 기록하고 트랙 위임.
9. **기존 SQL 파일 수정·재번호 금지** — 보정은 항상 새 번호. 원장 드리프트는 매니페스트가 정본.

---

## 8. 관찰·후속 후보 (학습 중 발견, 조치는 오너 결정 대상)

1. **CLAUDE.md 잠금값과 실코드 불일치**: "리뷰: 동일 멘토 2회 연속 결제 성공 후"는 SQL 170 + `reviewEligibilityPolicy.ts:14-15`에서 명시 폐기됨(관계 기반으로 전환). CLAUDE.md 개정 후보.
2. **열린 PR 4건(#27/#31/#33/#34) 전부 superseded** — main 정본과 staging 적용으로 내용이 흡수됨. 닫기(close) 정리 후보.
3. `app/logout/route.ts` — 세션 종료가 **GET**(CSRF 관점 관찰 지점).
4. `server.ts:38-42` setAll 무음 삼킴 + middleware 미갱신 조합 — RSC 렌더 경로에서 refresh 쿠키 유실 가능(현 구조에서 로그인 직후 `window.location.assign`으로 완화).
5. service_role 키 누락 감지가 에러 **메시지 문자열 매칭**에 의존(`walletTopupActions.ts:85`, `mentorPayoutsQueries.ts:124`) — `admin.ts:17` 메시지 변경 시 동반 수정 필요.
6. `getCurrentProfile.ts:16-22` — 프로필 조회마다 컬럼 존재 탐지 왕복 2회(성능 관찰 지점).
7. 계약테스트 34파일(기준 보고서 21파일 대비 +13) — 보고서 이후 W5 계정삭제·앱세션 트랙이 추가된 실측 증거.
8. 미적용 초안 167~169(IQ 첨부, W3 대기)와 지급 스택 105~114(승인 대기)는 **DB에 없어야 정상** — 드리프트 감사 시 오탐 주의.
