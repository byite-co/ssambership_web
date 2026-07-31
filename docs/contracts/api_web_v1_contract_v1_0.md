# Ssambership `api_web_v1` 접합부 상세 계약 v1.0 (동결안)

- 작성일: **2026-07-29**
- 성격: **S2 구현 전 고정 계약**. SQL·웹 코드 적용 결과가 아니라 구현·검수의 기준이다.
- 세션 성격: 읽기 전용 설계·계약 세션. DB DDL/DML, migration 적용, GitHub 브랜치·commit·PR, 코드 수정, Vercel 설정 변경 **0건**.
- 상위 지시서: `ssambership_s2_session1_api_web_contract_directive_20260729.md`
- 선행 계약: `ssambership_api_app_v1_contract_20260728.md` (v1.0, 2026-07-28 확정)
- 선행 검증: `ssambership_junction_verification_report_20260728` v2.1
- 진입 판정: Gate 1~5 **5/5 PASS · S2 GO** (`ssambership_s2_gate_status_20260729_s2_go.md`)

> **읽는 법.** 이 문서는 **AS-IS(실측)** 와 **TO-BE(제안)** 를 절대 섞지 않는다.
> §3·§4·§18의 "현재" 열과 `[AS-IS]` 표시 절은 2026-07-29 실측 사실이다.
> §5~§17·§20~§22의 `[TO-BE]` 절은 아직 존재하지 않는 제안이다.
> 모든 실측 값에는 출처가 붙는다 — 코드는 `저장소@SHA:파일:행`, DB는 `측정시각 + 조회한 카탈로그/함수정의`.

---

## 1. 문서 목적, 비범위, 측정 시각

### 1.1 목적

라이브 Supabase DB와 웹 저장소의 실제 접합부를 읽기 전용으로 재측정한 결과를 확정하고, 구현 전에 사용할 `api_web_v1` 상세 계약(스키마·view·function·시그니처·envelope·오류코드·GRANT·보안규약·멱등규약·migration 분해안·test matrix)을 동결한다.

### 1.2 비범위 (이번 세션에서 하지 않음)

- 실제 `api_web_v1`·`api_app_v1` SQL 구현 및 DB 적용
- 웹·Flutter 코드 전환
- account-deletion worker 구축·활성화·스케줄 등록
- 기존 SQL 190개 history squash, platform repo baseline 생성
- 레거시 객체 삭제·GRANT 회수 (S5에서만 검토)
- Storage 객체 백업·삭제
- 별도 분석용 데이터 창고
- NICE PG 실제 연동

### 1.3 측정 시각·수단

| 측정 | 시각 (UTC) | 수단 |
|---|---|---|
| DB 기준선 카탈로그 | 2026-07-29 03:19:04 | `pg_namespace`/`pg_tables`/`pg_proc`/`pg_policies`/`pg_extension`/`cron.job`/`storage.buckets` SELECT |
| DB 함수 인벤토리 194종 | 2026-07-29 03:2x | `pg_proc` + `pg_get_function_identity_arguments` + `pg_get_function_result` + `prosecdef` + `proconfig` + `has_function_privilege` |
| DB 함수 본문 15종 | 2026-07-29 03:2x~03:3x | `pg_get_functiondef` |
| RLS·정책·permissive 구분 | 2026-07-29 03:3x | `pg_policies`(schemaname public·storage), `pg_class.relrowsecurity` |
| 테이블/컬럼 GRANT | 2026-07-29 03:2x~03:3x | `information_schema.role_table_grants`, `information_schema.column_privileges` |
| 제약조건·인덱스·트리거 | 2026-07-29 03:2x~03:3x | `pg_constraint`, `pg_indexes`, `pg_trigger` + `pg_get_triggerdef` |
| Storage 버킷·정책 | 2026-07-29 03:19~03:3x | `storage.buckets`, `pg_policies`(storage.objects) |
| Realtime publication | 2026-07-29 03:19 | `pg_publication_tables` (`supabase_realtime`) |
| 웹 저장소 스윕 | 2026-07-29 03:18~03:35 | `git fetch` + 읽기 전용 grep/read |
| 앱 저장소 경계 확인 | 2026-07-29 03:2x~ | 읽기 전용 grep/read |

업무 데이터 원문·개인정보는 조회하지 않았다. 모든 조회는 카탈로그·권한·정의·형상 확인용이다.

---

## 2. 저장소 HEAD · DB ref · 운영 기준선

### 2.1 재측정된 기준선 `[AS-IS]`

| 항목 | 실측값 | 출처 |
|---|---|---|
| Supabase project ref | `lbeqxarxothkmzqvpudy` | 지시서 §2 고정 + 이번 세션 전 조회 대상 |
| 프로젝트 명칭 / 실사용 | `ssambership-staging` / `www.ssambership.com` Production 연결 → **사실상 운영 DB로 취급** | S2 상태문서 Gate 2 |
| 웹 저장소 | `byite-co/ssambership_web`, 기본 브랜치 `main` | |
| **웹 `main` HEAD** | **`ad076d296ce46a8f7ae0ec30c13200758862e6af`** (2026-07-28 21:41:06 +0900, `Merge pull request #47 from byite-co/claude/footer-business-info-9vg266`) | `git fetch origin main` → `git rev-parse origin/main` (2026-07-29 03:18 UTC) |
| 앱 저장소 | `byite-co/ssambership-app`, 기본 브랜치 `master` | |
| **앱 `master` HEAD** | **`b0ea4051baf9993dcbad5e94a8b26c51c7d6de43`** (2026-07-27 16:31:23 +0900, `Merge pull request #34 …play-doc-followup`) | `git fetch origin master` → `git rev-parse origin/master` |
| `api_web_v1` / `api_app_v1` / `core_private` / `private` 스키마 | **0건 (전부 부재)** | `pg_namespace`, 03:19:04 UTC |
| public 테이블 | **77** | `pg_tables` |
| public 함수·프로시저 | **194** | `pg_proc` (prokind f,p) |
| public view | **1** (`due_payouts`) | `pg_views` |
| RLS 정책 | **public 193 + storage 42 = 235** | `pg_policies` |
| RLS 정책 permissive 구분 | **PERMISSIVE 233 + RESTRICTIVE 2** (RESTRICTIVE는 `storage.objects`의 `adg_storage_block_insert_when_deleting`·`adg_storage_block_update_when_deleting` 2건뿐. **public 스키마에는 RESTRICTIVE 정책이 0건**) | `pg_policies.permissive` |
| `pg_cron` | **1.6.4 설치 · `cron.job` 0건** | `pg_extension`, `cron.job` |
| Storage 버킷 | **13** (public=true는 `profile-avatars` 1개뿐) | `storage.buckets` |
| Realtime publication | **3** (`question_threads`, `question_messages`, `question_attachments`) | `pg_publication_tables` |

### 2.2 기준선 확인 결론

- 웹 `main` HEAD는 S2 상태문서가 지목한 PR #47 머지 커밋 `ad076d29…`와 **동일**하다. PR #47 이후 추가 머지는 없다 → **접합부 관련 추가 드리프트 0건**.
- PR #47 직전 커밋 2건(`a38d335` footer 사업자정보, `9d234b4` 고객센터 이메일 `hello@byite.co.kr`)은 모두 법정 고지·회사정보 표시 변경이며 DB·SQL·API·인증·결제·구독·크론·앱 계약을 건드리지 않는다. S1 기준선 `a1841efe` → 현재 `ad076d29`의 기능 드리프트로 계산하지 않는다.
- 앱 `master` HEAD는 S1 검증 보고서 v2.1 기준선(`b0ea4051`)과 **동일**하다 → 앱 측 드리프트 0건.
- 라이브 DB는 S2 미착수 상태(신규 스키마 0건)이며 `pg_cron`은 설치만 되고 job은 0건이다.

### 2.3 운영 플래그·Cron 기준선 `[AS-IS]`

| 항목 | 실측값 | 출처 |
|---|---|---|
| `vercel.json` 등록 cron | **2건**: `/api/cron/subscription-renewal` `10 18 * * *`, `/api/cron/individual-question-expiry` `40 18 * * *` | `web@ad076d29:vercel.json` |
| `/api/cron/subscription-renewal` | **GET** | `:app/api/cron/subscription-renewal/route.ts:42` |
| `/api/cron/individual-question-expiry` | **GET** | `:app/api/cron/individual-question-expiry/route.ts:38` |
| `/api/cron/account-deletion` | **POST 전용 · vercel.json 미등록** | `:app/api/cron/account-deletion/route.ts:54` |
| account-deletion 3중 게이트 | `ACCOUNT_DELETION_WORKER_ENABLED` + 기능 플래그 + `?dryRun=false` | `:app/api/cron/account-deletion/route.ts:24,41,61,63` |
| CRON_SECRET 검증 | 3종 모두 timing-safe 비교(`Buffer.from` + `timingSafeEqual`) | 각 route 상단 |
| 운영 env (Gate 2 실사) | `CRON_SECRET` 설정·재배포 / `SUBSCRIPTION_RENEWAL_ENABLED=true` / `INDIVIDUAL_QUESTION_EXPIRY_ENABLED=true` / `ACCOUNT_DELETION_WORKER_ENABLED` 미설정·비활성 | S2 상태문서 Gate 2 (이번 세션 재실사 대상 아님 — §23 참조) |

**W1 재확인**: Vercel Cron은 등록 경로를 **GET**으로 호출하고 `/api/cron/account-deletion`은 **POST 전용**이므로, `vercel.json`에 경로만 추가해도 작동하지 않는다. 이 경계는 §16에서 계약으로 고정한다.

---

## 3. AS-IS 웹 접합부 전수 목록 `[AS-IS]`

출처 표기: 코드는 `web@ad076d29:<경로>:<행>`, DB 권한은 2026-07-29 `has_function_privilege`/`role_table_grants` 실측.

### 3.1 접합 표면 총량 (전수 스윕 결과)

| 표면 | 고유 개수 | 비고 |
|---|---:|---:|
| `supabase.rpc()` 호출 대상 함수 | **51** | 문자열 리터럴 50 + 상수 경유 1 (`APPROVE_MENTOR_SCHOOL_VERIFICATION_RPC` → `approve_mentor_school_verification_admin`). 변수 경유 1건(`bulkActions.ts:106`)은 리터럴 2종으로 해소되어 신규 추가 없음 |
| 직접 테이블 접근(`.from("…")`) | **50** | 문자열 리터럴 기준 |
| 직접 테이블 접근(런타임 프로빙) | **+1** (`payments`) | `payTable` 변수 경유 — 리터럴 스윕에 안 잡힘 |
| Storage 버킷 (기능 사용) | **11** | `.storage.from(상수)` 스윕 10종 + **`individual-question-attachments`**(별도 상수 파일 — 리터럴 스윕에서 누락되어 재확인함) |
| 기능 미배선 버킷 | **2** | `connection-note-ink`, `scan-annotations` — `lib/account/accountDeletionBucketCoverage.ts:33,41`의 **삭제 커버리지 목록에만** 등재되고 제품 기능 경로는 없음 |
| 계정삭제 커버리지 | **13/13** | 13개 버킷 전부 등재 (`accountDeletionBucketCoverage.ts`) |
| 웹 Realtime 소비 | **0** | `.channel(` / `postgres_changes` / `realtime` 참조 **0건 실측**. publication 3테이블은 앱 전용 소비 (W6, 결함 아님) |

RPC 51종은 S1 검증 보고서 v2.1 §2.1의 "RPC 51종(공통16 + 웹전용35, 상수 경유 포함)"과 **일치**한다.

### 3.2 신뢰 경계 = Supabase 클라이언트 팩토리 4종

| 팩토리 | 파일 | 키 | DB 역할 | 호출자 분류 |
|---|---|---|---|---|
| `createClient()` (browser) | `lib/supabase/client.ts` | anon/publishable | `anon` 또는 `authenticated` | 브라우저 (로그인 여부에 따라) |
| `createClient()` (server) | `lib/supabase/server.ts` | anon/publishable + 쿠키 세션 | `authenticated` | 웹 서버 세션 |
| `createServiceRoleClient()` | `lib/supabase/admin.ts` | **`SUPABASE_SERVICE_ROLE_KEY`** | `service_role` | 서버 전용 특권 (`import "server-only"`) |
| `createAppSurfaceClient()` | `lib/supabase/appSurfaceServer.ts` | anon/publishable + HttpOnly 강제 쿠키 | `authenticated` | 앱 WebView 표면 전용 |

- `admin.ts`는 `SUPABASE_SERVICE_ROLE_KEY`만 사용하며 `NEXT_PUBLIC_*` 경유를 금지한다. `"server-only"`로 Client Component import 시 빌드가 실패한다 → **클라이언트에 service_role 키 노출 경로 없음(원칙 §6.6 준수 확인)**.
- `appSurfaceServer.ts` 주석 계약: 사용 범위는 `POST /api/app-session/bootstrap`, `/app/community/shortform/new`, 앱 표면 wrapper 액션. 일반 웹 표면은 사용 금지(웹 로그인은 브라우저가 `document.cookie`로 세션을 기록하므로 HttpOnly화하면 로그인이 깨진다).

**호출 주체 판정 규칙**: 다수 helper가 `SupabaseClient`를 주입받으므로(=파일만 봐서는 역할 불명), 이 문서는 **DB EXECUTE 권한 실측을 1차 판정 근거**로 사용한다. `authenticated=false, service_role=true`인 함수는 정의상 service_role 경로만 가능하다.

### 3.3 RPC 51종 전수표

열 의미 — **권한**: `a`=anon / `u`=authenticated / `s`=service_role EXECUTE 실측(2026-07-29). **주체**: 권한 + 코드 실측으로 확정한 실제 호출자.

#### (A) 자금·상태 확정 — service_role 전용 (`u=false`)

| 기능 | 코드 위치 | 주체 | 현재 객체(정확한 시그니처) | 권한 | 보안 검증 | 원자성·멱등 |
|---|---|---|---|---|---|---|
| 구독 checkout 확정 | `subscribeCheckoutService.ts:843` | service_role | `confirm_subscription_checkout(p_payment_id uuid, p_plan_id uuid, p_idempotency_key text)` → jsonb | `s`만 | SECDEF. payments 소유자·kind·상태·30분 신선도, users banned/suspended, mentor 승인·`is_open_for_subscriptions`, plan 소유·활성·금액>0, cap | `payments FOR UPDATE` → `pg_advisory_xact_lock(hashtext(student),hashtext(mentor))` → `mentor_plans FOR UPDATE` → `users FOR UPDATE` → `mentor_profiles FOR UPDATE`; 구독 `ON CONFLICT (student_id,mentor_id) DO UPDATE`; 원장 멱등키 **`sub_debit_{payment_id}`** |
| 구독 캐시 차감 | `subscribeCheckoutService.ts:408` | service_role | `record_subscription_cash_debit(p_user_id uuid, p_subscription_id uuid, p_payment_id uuid, p_amount_cents bigint)` → void | `s`만 | SECDEF | `cash_ledger` UNIQUE(idempotency_key), 키 `sub_debit_{payment_id}` (웹 상수 `subscriptionCashDebitIdempotencyKey` :124와 일치) |
| 구독 갱신 배치 | `subscriptionRenewalBatch.ts:326` | service_role (cron) | `process_subscription_renewal(p_subscription_id uuid, p_period_end timestamptz, p_amount_cents bigint, p_idempotency_key text, p_processed_at timestamptz)` → `TABLE(ok,code,message,billing_event_id,ledger_id,next_period_start,next_period_end,wallet_balance_cents,attempt_count)` | `s`만 | SECDEF | `subscription_billing_events` UNIQUE(idempotency_key) |
| 캐시 충전 원장 (Toss) | `toss/cashTopupFromPayment.ts:74` | service_role | `record_cash_topup(p_user_id uuid, p_amount_cents bigint, p_idempotency_key text)` → void | `s`만 | SECDEF. 금액 양수·상한 10억 cents, idem 필수 | `cash_ledger` `ON CONFLICT (idempotency_key) DO NOTHING` → 신규 0건이면 즉시 return(지갑 미변경). **`ref_id`를 상수 `null`로 기록** |
| 캐시 충전 (관리자·테스트) | `cash/walletTopupActions.ts:97` | service_role | 동일 | `s`만 | 동일 | 동일 |
| IQ 생성+hold (지정) | `individualQuestionActions.ts:156` | service_role | `create_individual_question_with_hold(p_student_id, p_question_type, p_mentor_id, p_subject, p_topic, p_title, p_body, p_price_cents, p_idempotency_key)` → `individual_question_escrow_result` | `s`만 | SECDEF | 아래 v2와 동일 계열 |
| IQ 생성+hold (공개) | `individualQuestionActions.ts:230` | service_role | `create_individual_question_with_hold_v2(… + p_required_school_tier text, p_required_major_category text)` → `individual_question_escrow_result` | `s`만 | SECDEF. student role, type∈{direct,open}, 금액 양수·상한, title/body 필수, tier·major enum 검증 | `cash_wallets FOR UPDATE` → **lock 후 멱등 재확인** → 원장 키 **`iq_hold:{qid}`** → 지갑 차감 `where balance_cents >= price`(0행이면 `CASH_INSUFFICIENT_AFTER_LOCK`) |
| IQ claim (공개) | `individualQuestionActions.ts:279` | service_role | `claim_individual_question_v2(p_question_id uuid, p_mentor_id uuid)` → `individual_question_escrow_result` | `s`만 | SECDEF. 멘토 승인, 과목 게이트(`teaching_subjects`), school_tier·major_category 요구 충족, 본인 질문 금지 | 조건부 `UPDATE … WHERE status='open' AND claimed_mentor_id IS NULL AND (expires_at IS NULL OR >now())` — CAS |
| IQ 정산 release | `individualQuestionActions.ts:475` | service_role | `release_individual_question_payout(p_question_id uuid)` → `individual_question_escrow_result` | `s`만 | SECDEF. `status='answered'` 필수, hold 존재, mentor 존재, refund 원장 부재 | `individual_questions FOR UPDATE`; 원장 키 **`iq_payout:{qid}`**; 멘토 `floor(price*0.85)` |
| IQ 환불 (만료 배치) | `individualQuestionExpiryBatch.ts:41` | service_role (cron) | `refund_individual_question_hold(p_question_id uuid)` → `individual_question_escrow_result` | `s`만 | SECDEF. release 원장 부재, hold 존재 | `FOR UPDATE`; 원장 키 **`iq_refund:{qid}`** |
| 맞춤의뢰 escrow hold | `customOrderEscrowService.ts:64` | service_role | `record_custom_order_escrow_hold(p_student_id uuid, p_order_id uuid, p_amount_cents bigint)` → void | `s`만 | SECDEF | `cash_ledger` UNIQUE(idempotency_key) |
| 맞춤의뢰 escrow 환불 | `customOrderEscrowService.ts:199` | service_role | `record_custom_order_escrow_refund(p_order_id uuid)` → void | `s`만 | SECDEF | 동일 |
| 맞춤의뢰 납품 수락(원자) | `orderSettlementService.ts:265` | service_role | `accept_custom_order_deliverable_atomic(p_order_id uuid, p_student_id uuid, p_require_payment boolean)` → jsonb | `s`만 | SECDEF | 원자 상태 전이 |
| 맞춤의뢰 분쟁 분할 | `customOrderDisputeSplitService.ts:102` | service_role | `record_custom_order_dispute_split(p_order_id uuid, p_mentor_gross_won integer, p_student_refund_won integer, p_admin_id uuid)` → jsonb | `s`만 | SECDEF | |
| 정산 항목 재생성 | `subscriptionSettlementItems.ts:91` | service_role | `refresh_subscription_settlement_items(p_from timestamptz, p_to timestamptz)` → `TABLE(item_status,item_count,gross_cents,platform_fee_cents,mentor_amount_cents)` | `s`만 | SECDEF | |
| 환불 승인 | `admin/refundActions.ts:124`, `admin/bulkActions.ts:106` | service_role | `approve_refund_request_admin(p_refund_id uuid, p_admin_id uuid, p_admin_note text)` → jsonb | `s`만 | SECDEF. `p_admin_id`를 **인자로 받음**(호출자 JWT 무관) → 웹 서버가 `requireRole("admin")`로 선검증 | |
| 환불 거절 | `admin/refundActions.ts:176`, `admin/bulkActions.ts:106` | service_role | `reject_refund_request_admin(p_refund_id uuid, p_admin_id uuid, p_admin_note text)` → jsonb | `s`만 | 동일 | |

#### (B) 계정 탈퇴 — service_role 전용 + worker

| 기능 | 코드 위치 | 주체 | 현재 객체 | 권한 | 비고 |
|---|---|---|---|---|---|
| 탈퇴 요청(동의 포함) | `accountDeletionActions.ts:81` | service_role | `account_deletion_request_consented(p_user_id uuid, p_cancelable_minutes integer, p_dry_run boolean, p_forfeit_consent boolean, p_acknowledged_balance_cents bigint)` → jsonb | `s`만 | **웹 정본(W5)**. 관문: 기능플래그 → 세션 → admin 거부 → `understood` → 비밀번호 재인증(일회용 bare client, 세션 쿠키 미변경) → 사전조건 → 잔액>0이면 `forfeitConsent` 필수 |
| 탈퇴 취소 | `accountDeletionActions.ts:109` | service_role | `account_deletion_cancel(p_user_id uuid)` → jsonb | `s`만 | 코드 `CANCEL_WINDOW_PASSED`/`NOT_CANCELABLE` |
| 본인 상태 조회 | `appSession/appSurfaceAccountGate.ts:134` | **앱 표면 세션** | `account_deletion_status_self()` → jsonb | `u`,`s` | 앱 표면 게이트에서 사용 |
| worker: job 확보 | `accountDeletionAdapters.ts:498` | service_role (worker) | `account_deletion_claim(p_owner text, p_limit integer, p_lease_seconds integer)` → `SETOF account_deletion_jobs` | `s`만 | **lease 기반 정본**. deprecated `account_deletion_worker_claim(integer)`는 `anon/authenticated/service_role` **전부 false**(실측) = 전면 회수, 웹 미사용 |
| worker: 단계 진입 lock | `:71` | service_role | `account_deletion_begin_locked(p_user_id uuid)` → jsonb | `s`만 | `FORFEIT_CONSENT_STALE` 발생 지점 중 하나 |
| worker: 단계 전이 | `:54` | service_role | `account_deletion_advance(p_user_id uuid, p_from text, p_to text)` → boolean | `s`만 | |
| worker: 오류 기록 | `:82` | service_role | `account_deletion_record_error(p_user_id uuid, p_error text, p_backoff_seconds integer, p_max_attempts integer)` → jsonb | `s`만 | |
| worker: 세션 폐기 | `:126` | service_role | `account_deletion_revoke_sessions(p_user_id uuid)` → jsonb | `s`만 | |
| worker: Storage ref 수집 | `:360` | service_role | `account_deletion_storage_owner_refs(p_user_id uuid)` → `TABLE(bucket_id text, name text)` | `s`만 | |
| worker: 객체 소유 검증 | `:373` | service_role | `account_deletion_verify_object_owners(p_user_id uuid, p_refs jsonb)` → `TABLE(bucket_id text, name text, owner_state text)` | `s`만 | |
| worker: 몰수+익명화 | `:445` | service_role | `account_deletion_forfeit_and_anonymize(p_user_id uuid)` → jsonb | `s`만 | 정본. `state='storage_purged'` 게이트 → 몰수 원장(**키 `acct_del_forfeit:{uid}`**) + 지갑 0화 → 동의 3층 재검증 → `anonymize_user_for_deletion` 호출 |
| worker: lease 회수 | `:515` | service_role | `account_deletion_reclaim_expired()` → integer | `s`만 | |

#### (C) 로그인 사용자 직접 호출 (`u=true`)

| 기능 | 코드 위치 | 주체 | 현재 객체 | 권한 | 보안 검증 | 원자성 |
|---|---|---|---|---|---|---|
| 질문 스레드 생성 | `qna/questionRoomRpc.ts:94` | authenticated | `qna_create_question_thread(p_room_id uuid, p_title text, p_subject text, p_topic text, p_first_message_body text)` → jsonb | `u`,`s` | SECDEF + `auth.uid()`. 방 당사자·학생 한정(멘토 거부), banned/suspended, 상호 차단, 멘토 승인, 활성구독 시 환불진행 차단 + 주간한도, 무구독 시 무료 3층 한도 | `users FOR UPDATE` + 활성구독 `FOR UPDATE`; free 경로는 같은 트랜잭션에서 `free_question_usage` INSERT(UNIQUE(thread_id)) |
| 메시지 추가 | `:125` | authenticated | `qna_append_message(p_thread_id uuid, p_body text)` → jsonb | `u`,`s` | SECDEF + auth.uid() 당사자 | |
| 스레드 확인 | `:149` | authenticated | `qna_confirm_thread(p_thread_id uuid)` → jsonb | `u`,`s` | 동일 | |
| 오답 표시 | `:164` | authenticated | `qna_flag_wrong_answer(p_thread_id uuid, p_is_wrong boolean)` → jsonb | `u`,`s` | 동일 | |
| 첨부 등록 | `:182` | authenticated | `qna_register_attachment(p_thread_id uuid, p_storage_path text, p_file_name text, p_mime_type text, p_message_id uuid)` → jsonb | `u`,`s` | 동일 | |
| 주간 사용량 조회 | `qna/weeklyQuestionUsage.ts:113` | authenticated | `get_weekly_question_usage(p_student_id uuid, p_mentor_id uuid)` → json | **`a`,`u`,`s`** | ⚠ **본문에 `auth.uid()` 검증 없음** — §3.6 XW-01 | STABLE 조회 |
| 알림 전체 읽음 | `notificationReadActions.ts:134` | authenticated (서버 세션) | `mark_all_notifications_read()` → integer | `u`,`s` | auth.uid() 자체 도출 | |
| 멘토 학교인증 승인 | `admin/mentorSchoolVerificationReviewActions.ts:141` | **관리자 세션** (service_role 금지) | `approve_mentor_school_verification_admin(p_verification_id uuid, p_university_name text, p_university_id text, p_department_name text, p_major_category text, p_school_tier text)` → jsonb | `u`,`s` | SECDEF + 내부 `is_admin()`이 **호출자 JWT의 auth.uid()** 를 읽음 → service_role로 호출하면 정상 관리자도 `NOT_ADMIN` (코드 주석 명시) | |
| IQ 단가 설정 | `mentorProfileMutations.ts:128` | authenticated (멘토) | `set_individual_question_price(p_amount_cents integer)` → `SETOF mentor_individual_question_pricing` | `u`,`s` | auth.uid() 자체 도출. `amount_cents>0` CHECK | PK(mentor_id) upsert |
| 맞춤의뢰 작업 시작 | `orderTransitionRpc.ts:25` | authenticated (멘토) | `custom_order_mentor_start(p_order_id uuid)` → jsonb | `u`,`s` | SECDEF + 당사자 | |
| 맞춤의뢰 납품 | `:36` | authenticated (멘토) | `custom_order_mentor_deliver(p_order_id uuid)` → jsonb | `u`,`s` | 동일 | |
| 맞춤의뢰 수정요청 | `:48` | authenticated (학생) | `custom_order_student_request_revision(p_order_id uuid, p_note text)` → jsonb | `u`,`s` | 동일 | |
| 멘토 담당 학생 닉네임 | `mentorDashboardOrderEnrichment.ts:31,110`, `qna/questionRoomMentorContext.ts:24` | authenticated (멘토) | `get_mentor_student_nicknames(p_student_ids uuid[])` → `TABLE(id,nickname,full_name)` | `u`,`s` | SECDEF | |
| 공개 IQ 목록(멘토) | `individualQuestionQueries.ts:218` | authenticated (멘토) | `list_open_individual_questions_for_mentor(p_limit integer)` → `TABLE(id,subject,topic,title,price_cents,expires_at,created_at)` | `u`,`s` | SECDEF | |

#### (D) 로그인 전 공개 조회 (`a=true`)

| 기능 | 코드 위치 | 현재 객체 | 권한 | 비고 |
|---|---|---|---|---|
| 멘토 디렉터리 | `auth/mentorPublicRead.ts:76` | `mentor_directory_list_v2(p_limit integer)` → `TABLE(id,role,status,full_name,nickname,created_at)` | `a`,`u`,`s` | **`users.role='mentor'` 전원 반환** — `verification_status`·`users.status` 미필터 (§3.6 XW-02) |
| 멘토 프로필 묶음 | `:110` | `mentor_profiles_for_directory_v2(p_ids uuid[])` → `TABLE(user_id, university_name, department_name, teaching_subjects, intro_line, verification_status, created_at, verified_university_name, verified_department_name, verified_major_category, school_tier, school_verified, high_school_name, profile_image_url)` | `a`,`u`,`s` | `verification_status`를 반환하므로 필터는 **웹 코드 책임** |
| 멘토 공개 유저 | `:138` | `mentor_user_public_v2(p_mentor_id uuid)` → `TABLE(id,role,status,full_name,nickname,created_at)` | `a`,`u`,`s` | |
| 평균 응답시간 | `mentor/avgResponseHoursDisplay.ts:27` | `get_mentor_avg_response_hours(p_mentor_id uuid)` → numeric | `a`,`u`,`s` | |
| 리뷰 통계 | `publicMentorBundle.ts:69`, `reviews/reviewQueries.ts:128` | `get_mentor_review_stats(p_mentor_id uuid, p_include_hidden boolean)` → `TABLE(review_count,avg_rating,d1..d5)` | `a`,`u`,`s` | `p_include_hidden`이 **인자** — 호출자가 true를 보내면 숨김 리뷰 통계까지 집계(§3.6 XW-05) |
| 게시글 조회수 | `communityBoardMutations.ts:218` | `increment_community_post_view(p_post_id uuid)` → void | `a`,`u`,`s` | |
| 숏폼 조회수 | `communityShortformQueries.ts:223` | `increment_shortform_post_view(p_post_id uuid)` → void | `a`,`u`,`s` | |
| 맞춤의뢰 공개 상세 | `customRequestQueries.ts:408` | `get_public_custom_request_post_for_browse(p_post_id uuid)` → `TABLE(23열)` | `a`,`u`,`s` | |
| 맞춤의뢰 공개 목록 | `:759` | `list_open_custom_request_posts_for_mentor_browse(p_limit integer)` → `TABLE(23열)` | `a`,`u`,`s` | |

### 3.4 직접 테이블 접근 51종 (50 리터럴 + `payments` 동적)

`account_deletion_jobs`, `admin_action_logs`, `app_notices`, `cash_ledger`, `cash_topup_packages`, `cash_wallets`, `comments`, `community_comments`, `community_hashtags`, `community_posts`, `connection_notes`, `content_reports`, `custom_order_deliverables`, `custom_request_application_attachments`, `custom_request_applications`, `custom_request_orders`, `custom_request_post_attachments`, `custom_request_posts`, `disputes`, `individual_question_attachments`, `individual_question_messages`, `individual_question_transfers`, `individual_questions`, `mentor_academic_record_change_requests`, `mentor_activity_events`, `mentor_plans`, `mentor_profiles`, `mentor_school_verifications`, `mentor_student_rooms`, `notification_settings`, `notifications`, `order_events`, `post_reactions`, `promotion_campaigns`, `question_attachments`, `question_messages`, `question_threads`, `refunds`, `reviews`, `school_tier_mappings`, `shortform_posts`, `shortform_reactions`, `subscription_billing_events`, `subscription_settlement_items`, `subscriptions`, `user_blocks`, `user_deletion_log`, `user_warnings`, `users`, `verification_logs` **+ `payments`(동적)**

핵심 테이블의 실효 방어 (RLS 실측):

| 테이블 | 정책 | 클라이언트 쓰기 가능? | 근거 |
|---|---|---|---|
| `cash_ledger` | `cled_select`(본인) **SELECT만** | ❌ | INSERT/UPDATE 정책 부재 → 광범위 GRANT에도 RLS가 차단. 쓰기는 SECDEF RPC 전용 |
| `cash_wallets` | `cwal_select`(본인) SELECT만 | ❌ | 동일 |
| `subscriptions` | `subscriptions_select_parties` SELECT만 | ❌ | 동일. 트리거 `trg_enforce_mentor_cap`, `trg_subscriptions_keep_refunded_status` |
| `individual_questions` | `iq_select_party` SELECT만 | ❌ | 동일 |
| `mentor_student_rooms` | `msr_select`(당사자) **SELECT만** | ❌ | **INSERT 정책이 아예 없음** → 방 생성은 service_role 전용. `uq_msr_pair(student_id,mentor_id)` UNIQUE 존재 |
| `question_threads` | select/insert/update via room(당사자) | ✅(당사자) | + 트리거 `trg_qt_direct_write_guard`, `trg_qt_direct_consume_free_usage` |
| `question_messages` | `qm_select`/`qm_insert`(당사자 + `author_id=auth.uid()`) | ✅ | |
| `free_question_usage` | `fqu_insert_own`(`student_id=auth.uid()`) + `fqu_select_own` | ✅ | 트리거 `check_free_question_usage_limits`가 한도 강제, UNIQUE(thread_id) |
| `reviews` | INSERT `reviews_insert_student`(`author_id=auth.uid()` AND **`check_review_eligibility(mentor_id, auth.uid())`**) · UPDATE 3종(`reviews_update_author`, `reviews_update_mentor`, `reviews_update_admin`) · SELECT 3종 | ✅(단, **트리거가 컬럼별로 좁힌다**) | 자격 판정이 RLS에 내장. UPDATE 정책은 넓지만 **`trg_reviews_enforce_update`가 실효 방어** — §3.6 XW-N1 |
| `users` | select_own/admin_select_all/update_own/insert_own | ✅(본인) | 트리거 `trg_users_role_guard`(role 변경 차단), `trg_users_role_insert_guard`(admin INSERT 차단) |
| `mentor_profiles` | `mentor_update_own`(`user_id=auth.uid()`, **컬럼 제한 없음**) | ✅(본인 전 컬럼) | §3.6 **XW-03** |
| `mentor_plans` | **정책 4종**: `mplan_select`(SELECT, anon+authenticated, `true`), `mplan_ins`, `mplan_upd`, **`mplan_del`(DELETE, authenticated, `mentor_id=auth.uid() OR is_admin()`)** | ✅(본인 행 INSERT/UPDATE/**DELETE**) | §3.6 **XW-03**. `pg_constraint`는 PK·FK뿐이나 **UNIQUE INDEX `uq_mentor_plans_mentor_tier(mentor_id, plan_tier)`** 는 실재 |
| `community_posts` | cp_* 6종 + 한글명 레거시 3종 (**전부 PERMISSIVE**) | ✅(본인) | `cp_delete_own`이 작성자 **hard DELETE 허용**; SELECT 정책 어디에도 `deleted_at` 필터 없음. UNIQUE(author_id, create_idempotency_key) |
| `subscription_settlement_items` / `payout_run_items` / `user_consent_records` | — | ❌ | authenticated GRANT가 `SELECT,REFERENCES,TRIGGER,TRUNCATE`로 축소(INSERT/UPDATE/DELETE 없음) |
| service_role 전용 10종 | 정책 0건(deny-by-default) | ❌ | `account_deletion_jobs`, `mobile_app_version_policies`, `notification_deliveries`, `notification_outbox`, `payout_runs`, `payout_settings`, `reviews_duplicates_archive`, `reviews_quarantine_archive`, `subscription_checkout_anomalies`, `user_deletion_log` — 클라이언트 GRANT 자체가 없음 |

**public 전 77테이블 RLS 활성**(`relrowsecurity=false` 0건). 대다수 테이블은 anon/authenticated에 광범위 기본 GRANT가 남아 있어 **실효 방어는 전적으로 RLS**다.

### 3.5 Storage 버킷 11종(기능 사용) + 미배선 2종 + 정책 `[AS-IS]`

| 버킷 | public | 크기 | MIME | INSERT 정책 | SELECT 정책 |
|---|---|---|---|---|---|
| `community-post-images` | false | 5 MiB | jpeg/png/webp/gif | `cpi_auth_insert_own`: 본인 UID 첫 세그먼트 AND `NOT account_deletion_write_blocked` | ⚠ `cpi_public_read`: **버킷 전체**(`anon`,`authenticated`) — §3.6 XW-06 |
| `question-room-attachments` | false | 20 MiB | png/jpeg/webp/gif/pdf/zip/docx/pptx | `qra_storage_insert_party`: 방 당사자 AND 스레드 쓰기가능 AND 업로더 허용 AND path 적격 AND NOT write_blocked | 방 당사자 또는 admin |
| `shortform-videos` | false | 500 MiB | mp4/quicktime/webm | `sfv_mentor_insert`: **`is_mentor()`** AND 본인 UID AND NOT write_blocked | ⚠ `sfv_public_read`: 버킷 전체 |
| `shortform-thumbnails` | false | 5 MiB | jpeg/png/webp | 동일 | 동일 |
| `profile-avatars` | **true** | 5 MiB | jpeg/png/webp | `pa_auth_insert_own`: 본인 UID | `pa_public_read`: 버킷 전체(공개 버킷이므로 의도된 설계) |
| `student-id-images` | false | 무제한 | 무제한 | `student_id_images_insert_own`: `split_part(name,'/',1)=uid` | 본인 + admin |
| `custom-order-deliverables` | false | 20 MiB | pdf/이미지/zip/docx/pptx | 주문 멘토만 | 당사자 판정 함수 |
| `custom-order-message-attachments` | false | 20 MiB | 동일 | 경로 파싱 order_id·uploader_id 일치 AND 당사자 | 등록 행 기준 당사자 |
| `custom-request-post-attachments` | false | 20 MiB | 동일 | 글 작성자 | 권한 함수 |
| `custom-request-application-attachments` | false | 20 MiB | 동일 | 지원 멘토 | 권한 함수 |
| `individual-question-attachments` | false | 20 MiB | +json | `iqa_storage_insert_party`: 질문 당사자 | 질문 당사자. `iqa_storage_update_party_annotations`는 `split_part(name,'/',2)='annotations'` 경로만 UPDATE 허용 |
| (기능 미배선) `connection-note-ink`, `scan-annotations` | false | 무제한 | 무제한 | 방 당사자 | 방 당사자(+scan은 admin SELECT) |

**버킷 사용 정정(§3.7 #8):** `individual-question-attachments`는 웹이 **실제로 사용**한다 — `lib/individualQuestion/individualQuestionAttachmentStorage.ts:13,61,87`(업로드 + 서명 TTL **600초**), `lib/individualQuestion/transferIndividualQuestionsToRoom.ts:88`(질문→질문방 이전, service_role). 이 버킷만 업로더 컬럼이 없어 계정삭제 소유자 판정이 **2단계 조인**이다(`lib/account/accountDeletionAdapters.ts:235,249`).

**서명 URL TTL 실측(도메인별로 다름 — §14에서 계약화):**

| 대상 | TTL | 출처 |
|---|---:|---|
| 전역 기본값 | **7일** | `lib/storage/signedStorageUrl.ts` `DEFAULT_TTL_SEC` |
| 커뮤니티 게시글 이미지 | **3600초** | `lib/community/communityImageStorage.ts:23` (전역 기본을 도메인에서 명시 오버라이드) |
| 질문방 첨부 | **3600초** | 표시 시점 재발급, 저장하지 않음 |
| 개별질문 첨부 | **600초** | `individualQuestionAttachmentStorage.ts:87` |

전역 가드 2종은 **RESTRICTIVE**(실측)이므로 버킷별 소유권 검사와 AND 결합된다 — 우회 경로가 아니다:
`adg_storage_block_insert_when_deleting`(INSERT), `adg_storage_block_update_when_deleting`(UPDATE), 조건 `NOT account_deletion_write_blocked(auth.uid())`.

### 3.6 이번 세션에 새로 확인된 AS-IS 결함 `[AS-IS]`

> 전부 2026-07-29 라이브 DB·코드 실측이며, 추정이 아니다. 각 항목은 §7·§10에서 TO-BE 계약으로 해소된다.
> 이 절은 **사실 기록**이다. 이번 세션은 어떤 수정도 적용하지 않았다.

#### XW-01 `get_weekly_question_usage` — 미인증 임의 학생 조회 (IDOR)

- 실측: `SECURITY DEFINER`, `search_path=public`, **anon EXECUTE = true**, 본문에 `auth.uid()` 검증 **전무**. 인자 `p_student_id`·`p_mentor_id`를 그대로 사용.
- 반환: `used`, `limit`, `plan_tier`, `remaining`, `can_ask`, `week_start`, `week_end`
- 영향: 학생 UUID를 아는 **미인증 호출자**가 임의 학생의 구독 요금제와 주간 질문 사용량을 열람할 수 있다.
- 출처: `pg_get_functiondef(public.get_weekly_question_usage)` + `has_function_privilege('anon', …)` (2026-07-29)
- 관련: `api_app_v1` 계약 §8은 이 함수를 "임시 허용·향후 student self 도출"로 이미 표시했다. 웹도 동일 처리가 필요하다.

#### XW-02 멘토 자기승인 — `mentor_profiles.verification_status` 자기 UPDATE

측정된 연쇄:

1. 가입 시 `handle_new_auth_user`가 `raw_user_meta_data.app_role`를 읽어 `student`/`mentor`만 허용(XV-01 반영 확인) → mentor 가입 시 `mentor_profiles.verification_status='pending'` 생성.
2. `mentor_profiles` RLS 정책 **4종**(전부 PERMISSIVE): `mentor_select_own`, `mp_admin_select_all`, `mentor_update_own`(`UPDATE`, authenticated, `USING/WITH CHECK = (user_id = auth.uid())` — **컬럼 제한 없음**), **`mentor_insert_own`(`INSERT`, authenticated, `WITH CHECK = (user_id = auth.uid())` — 역할 검사 없음)**.
3. `information_schema.column_privileges` 실측: `verification_status`·`cap_limit` 포함 **전 컬럼에 `authenticated` UPDATE 권한** 존재(컬럼 단위 축소 없음).
4. `mentor_profiles` 트리거 실측: `trg_mentor_profiles_set_updated`(BEFORE UPDATE, `set_updated_at`), `trg_mp_notify_activity`(activity_status 전이), `trg_mp_seed_default_plans`(**AFTER UPDATE WHEN `new.verification_status='approved' AND old IS DISTINCT FROM 'approved'`** → 기본 플랜 3종 자동 시딩). **`verification_status` 변경을 막는 가드는 없다.**
5. `individual_question_user_is_approved_mentor(uid)` 본문 = `mentor_profiles.verification_status IN ('approved','verified','active')`.
6. 이 함수가 게이트하는 지점: `confirm_subscription_checkout`(`MENTOR_NOT_APPROVED`), `qna_create_question_thread`(`MENTOR_NOT_APPROVED`), `claim_individual_question_v2`·`claim_individual_question_as_mentor`(`mentor_not_approved`).

→ **자기승인 경로가 둘이다.**

- **(가) UPDATE 경로** — 멘토 역할 사용자가 자기 세션 JWT로 `verification_status='approved'`를 직접 쓴다. 승인 시 `trg_mp_seed_default_plans`가 기본 플랜 3종까지 자동 시딩하고, 이후 구독 수령·IQ claim·85% 정산 수령이 열린다. `mentor_directory_list_v2`는 `verification_status`를 필터하지 않으므로(XW-02b) 디렉터리 노출도 함께 열린다. 동일 경로로 `cap_limit`(→ `mentor_cap_limit`, 기본 28)도 자기 상향이 가능해 cap 제한이 무력화된다.
- **(나) INSERT 경로** — `mentor_profiles` 행이 **없는** 사용자(예: 학생 역할)가 `INSERT INTO public.mentor_profiles(user_id, verification_status) VALUES (auth.uid(), 'approved')`를 실행한다. `mentor_insert_own`은 `user_id = auth.uid()`만 검사하고 **`users.role`을 보지 않으며**, `authenticated`·`anon`에 INSERT GRANT가 실재한다(실측). 게이트 함수가 `users.role`이 아니라 `verification_status`만 보므로 그대로 통과한다. 이어서 `mplan_ins`로 자기 `mentor_plans` 행까지 만들 수 있다.
  - 다만 `mentor_directory_list_v2`와 신규 V3는 `users.role='mentor'`를 요구하므로 **디렉터리 노출은 되지 않는다.** 영향은 `individual_question_user_is_approved_mentor`를 게이트로 쓰는 경로(특히 `claim_individual_question_as_mentor`)에 한정된다.
  - **(나)는 UPDATE 회수(M11)나 BEFORE UPDATE 트리거만으로는 막히지 않는다.** §10.6·§20.5의 조치가 INSERT까지 덮어야 하는 이유다.

- 출처: `pg_policies`(public.mentor_profiles) · `information_schema.column_privileges` · `pg_get_triggerdef` · `pg_get_functiondef` (2026-07-29)
- `users.role`은 `trg_users_role_guard`가 service_role/admin/JWT-없는 세션으로 제한하므로 **역할 자체의 승격은 불가**하다. 결함은 `mentor_profiles` 컬럼 보호 부재에 한정된다.

#### XW-02b `mentor_directory_list_v2` 미필터

- 실측 본문: `select … from public.users u where u.role='mentor' order by created_at desc limit …` — `verification_status`·`users.status`(banned/suspended) 필터 없음.
- 승인 여부 필터는 `mentor_profiles_for_directory_v2`가 돌려주는 `verification_status`를 **웹 코드가** 걸러야 성립한다.

#### XW-03 멘토 가격 밴드 — DB 강제 부재

- 밴드 정본은 **웹 코드에만** 있다: `web@ad076d29:lib/subscribe/mentorPlanPricing.ts:13` `MENTOR_SUBSCRIPTION_PRICE_RULES` (limited 29,900/29,900/69,900 · standard 84,900/84,900/149,900 · premium 174,900/174,900/329,900).
- 강제 지점도 웹 서버 액션 한 곳뿐: `lib/mentor/mentorProfileMutations.ts:78-88`(`isOutsideMentorPriceGuide` 위반 시 거부) → 통과분만 `mentor_plans.upsert({onConflict:"mentor_id,plan_tier"})`. 이때 쓰는 클라이언트는 **세션 클라이언트**(service_role 아님).
- DB 실측: `mentor_plans` 제약조건은 `mentor_plans_pkey`(PK) + `mentor_plans_mentor_id_fkey`(FK) **뿐**. `amount_cents` CHECK 없음, 클램프 트리거 없음, 이름에 `clamp`/`price_band`/`plan_price`를 포함한 함수 **0건**.
- RLS `mplan_upd`는 `mentor_id=auth.uid()`만 본다.

→ 멘토가 웹 UI를 우회해 Supabase REST로 자기 `mentor_plans.amount_cents`를 밴드 밖 임의 값으로 쓸 수 있다. `plan_tier`도 CHECK가 없어 임의 문자열이 들어갈 수 있다(그 경우 `subscription_cap_weight`가 0을 반환해 cap 검사가 무력화된다 — `enforce_mentor_cap`은 `v_new<=0`이면 "가중치를 모르는 플랜은 차단하지 않음"으로 통과시킨다).
- CLAUDE.md의 "멘토 가격 저장 시 밴드를 **서버에서** 강제한다"는 **Next.js 서버 액션 계층**을 의미하며, DB 계층 강제는 아니다.

#### XW-04 구독 확정 시 금액 미결속 (TOCTOU 과다청구)

- `confirm_subscription_checkout` 본문 실측: `mentor_plans FOR UPDATE`로 `v_amount_cents`를 읽어 그 값으로 `record_subscription_cash_debit`을 호출한다. **`payments.amount`(학생이 동의한 금액)와 대조하지 않는다.**
- 결과: 학생이 결제 화면에서 금액 A를 확인한 뒤 확정 사이에 멘토가 `mentor_plans.amount_cents`를 B로 바꾸면 학생 지갑에서 **B가 차감**된다. XW-03과 결합하면 B는 밴드 밖 값일 수 있다.
- 출처: `pg_get_functiondef(public.confirm_subscription_checkout)` (2026-07-29)

#### XW-05 `get_mentor_review_stats(p_mentor_id, p_include_hidden)`

- `p_include_hidden`이 **호출자 인자**이고 anon EXECUTE=true다. 숨김·블라인드 리뷰를 집계에 포함시킬지 여부를 클라이언트가 정한다.
- `reviews` RLS는 `reviews_select_public_visible`로 행 조회를 제한하지만, 이 함수는 SECDEF이므로 RLS를 우회한다.
- 영향은 통계 수치(개수·평균·분포) 노출에 한정되며 리뷰 본문 노출은 아니다. 심각도는 XW-01/02보다 낮다.

#### XW-06 커뮤니티·숏폼 버킷의 버킷 전체 SELECT 정책

- `cpi_public_read`: `SELECT`, `{anon,authenticated}`, 조건 `bucket_id='community-post-images'` **뿐** — 경로 소유권·게시 상태 무관.
- `sfv_public_read`: 동일 패턴(`shortform-videos`, `shortform-thumbnails`).
- 두 버킷은 `public=false`이므로 익명 URL 직접 접근은 불가하지만, **로그인 사용자는 경로만 알면 임의 객체에 서명 URL을 발급**할 수 있다(비공개 초안 글의 이미지 포함).
- 대조군으로 `question-room-attachments`는 방 당사자 판정 함수 4종으로 SELECT를 좁힌다 → 설계 의도가 버킷별로 갈려 있다.

#### XW-07 오류 반환 형식 3원화

같은 DB 안에 세 가지 규약이 공존한다(전부 본문 실측):

| 계열 | 형식 | 예 |
|---|---|---|
| qna·구독 일부 | **`raise exception`** (UPPER_SNAKE) | `AUTH_REQUIRED`, `ROOM_NOT_FOUND`, `WEEKLY_LIMIT_EXHAUSTED`, `PAYMENT_STALE`, `MENTOR_CAP_EXCEEDED` |
| 구독 일부 | **jsonb envelope** (UPPER_SNAKE) | `{ok:false, code:'CASH_INSUFFICIENT'}`, `SUCCEEDED_NO_LEDGER`, `LEDGER_FIELD_MISMATCH`(+`anomaly_id`) |
| IQ escrow | **composite 반환** (**lowercase_snake**) | `(false,'insufficient_cash',…)`, `not_available`, `mentor_subject_not_met`, `already_released` |

`confirm_subscription_checkout` 한 함수 안에서도 raise와 envelope가 섞인다(§3.3 A 참조). `api_app_v1` 계약 §4.3은 스레드 생성 wrapper가 기존 오류를 "그대로 안정 코드로 전달"한다고 했는데, **정본은 envelope가 아니라 raise**이므로 wrapper는 반드시 예외를 잡아 envelope로 변환해야 한다. 이 사실을 §8·§9에서 계약으로 확정한다.

#### XW-08 무료질문 한도 오류코드 이원화 (동시성 노출)

- `qna_create_question_thread`는 사전 검사에서 `FREE_QUOTA_EXPIRED` / `FREE_QUOTA_TOTAL_EXHAUSTED` / `FREE_QUOTA_MENTOR_EXHAUSTED`를 raise한다.
- 그런데 실제 소비 INSERT를 받는 트리거 `check_free_question_usage_limits`는 **같은 한도를 다른 이름**으로 강제한다: `FREE_QUESTION_EXPIRED`(P0003) / `FREE_QUESTION_TOTAL_LIMIT`(P0002, ≥7) / `FREE_QUESTION_PER_MENTOR_LIMIT`(P0001, ≥3) / `FREE_QUESTION_STUDENT_NOT_FOUND`(P0003).
- 동시 요청 경합에서 사전 검사를 통과하고 트리거에서 걸리면 **클라이언트가 받는 코드 문자열이 달라진다**. 한도값(7일/전역 7/멘토별 3)은 양쪽 동일.

#### XW-09 `community_posts` soft-delete 미강제 + 레거시 정책 중복

- `deleted_at` 컬럼은 존재하지만 **어떤 SELECT 정책도 `deleted_at`을 필터하지 않는다** → 직접 테이블 조회는 soft-delete된 글을 계속 읽는다.
- `cp_delete_own`(DELETE, authenticated, 작성자 또는 admin)이 **hard DELETE를 허용**한다. RESTRICTIVE 가드가 public에 0건이므로 이를 막는 장치가 없다. `api_app_v1` 계약 §3.3은 "hard delete 금지"를 규정했으나 현 DB는 강제하지 않는다.
- 한글명 레거시 정책 3종(`누구나 게시글 읽기`, `로그인 유저 게시글 작성`, `본인 게시글 수정`, role=`public`)이 `cp_*` 6종과 **동시에 PERMISSIVE**로 존재한다. permissive OR 결합이므로 가장 넓은 정책이 실효다.
- `comments`(정본) / `community_comments`(레거시) 이중 테이블이 `cc_sync_*`·`comments_mirror_*` 트리거로 양방향 동기화된다.

#### XW-10 런타임 스키마 프로빙이 존재 근거 없이 남아 있음 (W4 정량화)

- `lib/subscribe/subscribeCheckoutService.ts:95` `firstPayTable`은 `PAY_TABLES=["payments","payment_intents","order_payments"]`를 `select id limit 1`로 순회한다.
- `lib/qna/safeSelect.ts:3` `pickExistingColumn`은 후보 컬럼을 하나씩 `select(col).limit(1)`로 시도한다(구독 FK·plan FK·상태·금액·metadata·통화·kind 등 다수 지점).
- **라이브 DB 실측: `payment_intents`·`mentor_subscriptions`·`user_subscriptions` 3종 모두 부재(0건)** → 프로빙은 항상 첫 후보(`payments`/`subscriptions`)로 귀결한다. 즉 현재 프로빙은 결과를 바꾸지 않는 왕복 쿼리이며, 계약 불확정성만 남긴다.
- 부수효과: `payments`가 리터럴 스윕에 잡히지 않아 **접합부 지도에서 누락되기 쉽다**(이 문서는 §3.4에서 명시적으로 되살렸다).

#### XW-11 리뷰 자격 판정이 잠금값 문서와 불일치

- 잠금값(CLAUDE.md): "리뷰 = 동일 멘토 **2회 연속 결제 성공** 후".
- DB 실측 `check_review_eligibility(p_mentor_id, p_student_id)`: `subscriptions.status IN ('active','expired','cancel_scheduled')`가 하나라도 있으면 true, 또는 `individual_questions.status IN ('answered','released')`가 하나라도 있으면 true. **결제 횟수 조건 없음.**
- 이 함수는 `reviews_insert_student` RLS에 직접 내장되어 있으므로 실효 규칙은 DB 쪽이다.
- 판정: 문서·구현 불일치. 어느 쪽이 정본인지는 **오너 확정 사항**이며 이번 계약에서 임의로 바꾸지 않는다(§23 blocker B-05).

#### XW-N1 (검증 결과: **결함 아님**) `reviews` UPDATE 정책은 넓지만 트리거가 좁힌다

- 정책만 보면 위험해 보인다: `reviews_update_mentor`(UPDATE, authenticated, USING·WITH CHECK 모두 `auth.uid() = mentor_id`) + `authenticated`에 `reviews` 전 컬럼 UPDATE GRANT. 즉 **RLS 레벨만 보면 멘토가 자기 리뷰 행의 `rating`·`body`를 바꿀 수 있어 보인다.**
- 그러나 `trg_reviews_enforce_update`(BEFORE UPDATE) → `reviews_enforce_update()`(SECDEF)가 **컬럼별 액터 인가를 강제**한다(본문 실측):
  - 공통 불변: `id`, `mentor_id`, `author_id`, `subscription_count`, `created_at`
  - `rating`·`body`는 **작성자만** 변경 가능 (`if not v_is_author then raise 'reviews: protected columns are immutable'`)
  - 멘토 분기: `mentor_reply`만, **1회 한정**, `mentor_replied_at` 서버 강제, moderation 필드 변경 금지
  - 관리자 분기: `is_hidden`/`is_blinded`/`moderation_state`만, `moderated_at`·`moderated_by` 서버 강제, 멘토 답글 필드 변경 금지
  - 작성자 분기: 모더레이션된 리뷰는 수정 불가, `updated_at` 서버 강제
  - `service_role`은 통과
- **판정: 결함 아님.** 넓은 RLS + 좁은 BEFORE 트리거 조합은 이 DB의 확립된 컬럼 인가 패턴이며(`enforce_users_role_guard`도 동형), `mentor_profiles`에 **바로 이 가드가 없다는 점**이 XW-02의 본질이다. §20.5 M0는 이 검증된 패턴을 그대로 복제한다.
- 이 항목은 적대적 검토에서 누락 결함 후보로 제기됐으나 **트리거 본문 실측으로 반증**되어 기록만 남긴다.

#### XW-12 NICE정보인증 PASS 본인인증 — **구현 0건**

- 실측: `app`·`lib`·`components` 전체에서 `nice`/`본인인증`/`pass인증`/`danal`/`iamport`/`portone`/`휴대폰 인증`/`identity verif` **매치 0건**. 외부 본인인증 API 호출·env·redirect 경로가 일절 없다.
- 만 14세 미만 보호자 동의의 "신원확인 방식"은 실제 인증이 아니라 placeholder 상수다: `MINOR_CONSENT_VERIFICATION_METHOD_PLACEHOLDER = "legal_review_pending"` (`lib/auth/minorConsentPlaceholders.ts:18`). 보호자 동의는 **체크박스 자기신고**다.
- 판정: 지시서 §4가 "웹 전용"으로 분류한 *NICE정보인증을 통한 PASS 본인인증*은 **현재 AS-IS에 존재하지 않는다.** 따라서 이번 계약은 본인인증 관련 DB 객체를 만들지 않는다(§23 blocker **B-01**).
- `auth` 관련 미배선도 함께 기록: `exchangeCodeForSession`·`getSession`·`onAuthStateChange`·`signInWithOtp`·`signInWithOAuth`·`verifyOtp` 사용 0건, `/auth` 하위 callback route 없음(`app/(public)/auth`에는 `update-password`만). `middleware.ts`는 Supabase 세션 갱신을 하지 않고 `x-pathname`/`x-return-to` 헤더만 주입한다. `app/logout`은 **GET** 라우트로 CSRF 토큰이 없다.

#### XW-13 금지어 차단 정책이 dead code

- 실측 (`lib/safety/trustSafetyText.ts:15-17`):
  ```ts
  export function findRestrictedPhraseInText(..._values: string[]): string | null {
    return null;
  }
  ```
  **항상 `null`을 반환**한다. 이를 호출하는 차단 분기(`lib/community/communityBoardActions.ts:98`, `lib/community/communityComposeActions.ts:48`)는 사실상 도달 불가다.
- 실효 검증은 **연락처 마스킹만** 남아 있다: 글은 `maskContactInUserText`(제목·본문), 댓글은 `sanitizeTrustSafetyText`(항상 `ok:true` + 마스킹). 구현은 `lib/customRequest/contactMasking.ts`.
- 같은 파일 상단 주석이 **의도적 폐지**임을 명시한다(`[정책 변경] 금지어 차단 폐지`, `[폐지됨] 과거 금지어 검사. 차단 정책을 없앴으므로…`). 사고성 회귀가 아니라 결정의 결과다.
- 판정: CLAUDE.md의 맞춤의뢰 금지어 목록은 **커뮤니티 경로에 더 이상 강제되지 않는다.** 따라서 §9의 `POLICY_RESTRICTED`는 사전에는 두되 **현재 발생 조건이 없음**을 명시한다. 남은 것은 이 폐지를 계약으로 추인할지다(§23 blocker **B-04**).

#### XW-14 커뮤니티 목록 레거시 폴백이 `status`/`deleted_at` 필터를 버림

- 정상 경로 `listCommunityBoardPosts`는 `.eq("status", …)` + `.is("deleted_at", null)`을 건다(`lib/community/communityBoardQueries.ts:208-209`).
- 그러나 오류 메시지가 `/relation|does not exist|column|status/i`에 걸리면 `listCommunityBoardPostsLegacy`로 폴백하고(`:231-232`), 그 함수는 `select("*")`에 **`status`·`deleted_at` 필터를 전혀 걸지 않는다**(`:262`).
- **정확한 잔여 노출 범위(RLS 실측 반영):** RLS가 피해를 제한한다 — `cp_select_published`/`cp_select_own`/`누구나 게시글 읽기`의 permissive OR 결과는 `status='published' OR 본인 OR admin`이므로 **타인의 draft는 노출되지 않는다.** 실제로 새는 것은 (a) **soft-delete된 published 글**(어떤 정책도 `deleted_at`을 필터하지 않으므로, XW-09) 과 (b) 공개 목록에 섞이는 **호출자 본인의 draft** 다.
- 폴백 트리거 정규식에 `|status`가 포함되어 "status"라는 단어가 든 임의의 오류 메시지에도 반응한다 — 트리거 범위가 필요보다 넓다.
- 유사 폴백이 `listCommunityPopularPostsForHome`(`:296`)·`listPopularHashtags`에도 있다.

#### XW-15 계정상태 게이트의 fail-open / fail-closed 이원화

- 웹 일반 표면 `assertAccountActive`(`lib/auth/accountStatus.ts`): 1차 select 실패 시 `status` 단독 select로 재시도하고, **그마저 실패하거나 예외면 `active`로 취급(fail-open)**.
- 앱 표면 게이트 `appSurfaceAccountGate`: 확인 불가 시 **거부(fail-closed)**.
- 같은 계정 상태 판정이 표면에 따라 반대 방향으로 실패한다. 자금·상태 확정 RPC는 내부에서 banned/suspended를 재검사하므로(실측) 치명적 우회는 아니지만, **계약 수준에서 방향을 통일해야 한다**(§11.5).
- 같은 계열의 fail-open 지점(질문방 영역): `assertThreadNotLockedForMessages` 조회 실패 시 차단하지 않음, `isFreeQuestionQuotaExpired`가 relation 부재 시 "미만료" 취급.

#### XW-16 `TOSS_WEBHOOK_SECRET` 미설정 시 webhook 복구 경로 전면 차단

- `verifyTossWebhookSignature`는 `HMAC-SHA256(rawBody, TOSS_WEBHOOK_SECRET)`을 헤더 후보값과 대조한다. **secret이 없으면 항상 `false`** → 모든 webhook이 401이 된다.
- 결과: 고아 결제 복구(webhook 경유 충전 확정) 경로가 **조용히 전부 비활성**된다. `TOSS_SECRET_KEY` 미설정 시에도 confirm은 6단계에서 `server_config` 500이며 외부 호출은 0회다.
- Gate 2 실사 대상 env 4종에 **`TOSS_WEBHOOK_SECRET`이 포함되지 않았다** → §23 미검증 **U-01**.

#### XW-17 구독 결제의 PG 완료 경로 미배선 — 캐시지갑 단일 경로

- `createSubscriptionPaymentIntent` 반환 메시지가 `/api/subscribe/complete`를 언급하지만(`lib/subscribe/subscribeCheckoutService.ts:564`) **해당 route가 존재하지 않는다**(`app/api/subscribe/` 하위엔 `checkout`만).
- 즉 구독은 현재 **캐시지갑 즉시차감 단일 경로**이며, Toss 카드 등으로 구독을 직접 결제하는 웹훅 확정 경로는 미배선이다.
- 개발용 우회 `SUBSCRIBE_CHECKOUT_ALLOW_PENDING`(`:577-590`)은 `NODE_ENV=production`에서 켜면 throw로 기동을 막는다. 단 **캐시지갑 경로는 `cashWallet===true`로 항상 pending을 통과**하므로(`:783`) 실질 방어는 `confirm_subscription_checkout` 내부 상태기계다.
- 롤백 RPC `record_subscription_cash_rollback`은 **웹 호출점 0건**이다(P1-13 개편으로 수동 보상 헬퍼가 제거되고 단일 원자 RPC로 대체됨 — `:431-432`, `:931-933` 주석). §18에서 "유지·미사용"으로 분류한다.

#### XW-18 구독 멱등키 총람 (실측 — §12 계약의 입력)

| 용도 | 키 형식 |
|---|---|
| 구독 캐시 차감 원장 | `sub_debit_{paymentId}` |
| checkout 확정 | `sub_checkout_{paymentId}` |
| 최초 billing event | `sub_initial:{subscriptionId}` |
| 갱신 | `sub_renewal:{subscriptionId}:{YYYY-MM-DD}` |
| 갱신 예고 마커 | `sub_renewal_notice:{subscriptionId}:{YYYY-MM-DD}` |
| 해지예약 종료 event | `sub_cancel:{subscriptionId}:{YYYY-MM-DD}` |
| 유예만료 event | `sub_expired:{subscriptionId}:{YYYY-MM-DD}` |
| 결제 intent 외부 참조 | `payments.external_id = sub_intent_sub_{uuid}` |
| Toss 캐시충전 | `cash-{userId}-{Date.now()}` (**클라이언트 생성** — `components/cash/CashChargeWidget.tsx:11-13`) |
| 테스트 충전 | `cash_topup_{userId}_{Date.now()}_{randomHex}` |
| IQ 생성 | `iq_open:{randomUUID}` / `iq_direct:{randomUUID}` (**폼 hidden, 페이지 렌더 시 생성**) |
| IQ 원장 | `iq_hold:{qid}` / `iq_payout:{qid}` / `iq_refund:{qid}` |
| 커뮤니티 글 생성 | `crypto.randomUUID()` 원문(prefix 없음) → `community_posts.create_idempotency_key` |
| 가입 동의 기록 | `signup:{userId}:{consent_type}:{version}` |
| 탈퇴 잔액 몰수 | `acct_del_forfeit:{uid}` |

**주의:** Toss 충전 orderId와 IQ 생성 멱등키는 **클라이언트가 만든다.** 서버는 형식·소유자만 검증한다(충전은 `parseUserIdFromCashOrderId`로 소유자 대조). F11이 원장 단계에서 소유자를 재검증하는 근거다.

### 3.7 정정 사항 (기존 문서 대비)

| # | 기존 기술 | 2026-07-29 실측 | 조치 |
|---|---|---|---|
| 1 | `freeQuestionRoom.ts` 주석: "room insert RLS는 **활성 구독을 요구**하므로 service role로 생성한다" | `mentor_student_rooms`에는 **INSERT 정책이 아예 없다**(`msr_select` SELECT 1건뿐). 활성 구독 조건이 아니라 클라이언트 INSERT 전면 불가 | 계약 문구를 실측대로 고정(§13). 코드 주석 수정은 S2 구현 시 |
| 2 | CLAUDE.md: 질문방 `question_threads`의 room FK를 `room_id`로 축약 표기 | 실제 컬럼은 **`mentor_student_room_id`**. `connection_notes`도 동일 | 신규 view·함수는 실제 컬럼명을 사용(§6) |
| 3 | CLAUDE.md: "멘토 가격 저장 시 밴드를 서버에서 강제" | 강제는 **Next.js 서버 액션 계층**에만 존재. DB 강제 0건 | XW-03. §7에서 DB 강제를 계약화 |
| 4 | `api_app_v1` §4.3: 스레드 생성 wrapper가 기존 오류를 "그대로 안정 코드로 전달" | 정본은 **raise exception**이며 envelope가 아니다 | XW-07. §8에서 변환 계약 명시 |
| 5 | `api_app_v1` §4.3 오류 목록 | 정본이 raise하는 **`SUBSCRIPTION_REFUND_PENDING`이 목록에 없다** | §9 오류코드 사전에 추가하고 §19에서 앱 계약 보정 항목으로 표시 |
| 6 | S1: 비내부 트리거 89 = public 82 + auth 2 + storage 4 + realtime 1 | 이번 세션은 트리거 총량을 재집계하지 않았다(대상 테이블 단위로만 확인) | §23 미검증 항목 U-04 |
| 7 | CLAUDE.md: `mentor_profiles`에 `avg_rating`·`review_count` 컬럼 존재 | 두 컬럼 **부재**(실측 0건). 리뷰 통계는 `get_mentor_review_stats` RPC 또는 `reviews` 집계로만 얻는다 | V3에서 `reviews` 집계로 산출 |
| 8 | 이 문서 초안(§3.1): "웹 미사용 버킷 3종" | **오류.** `individual-question-attachments`는 웹이 실제로 사용한다(업로드·서명·이전). 기능 미배선은 `connection-note-ink`·`scan-annotations` **2종**뿐 | §3.1·§3.5 수정 완료 |
| 9 | 과제 지시서 §5.2: 버킷명 "question-attachments" | 실제 버킷은 **`question-room-attachments`**. `question_attachments`는 **테이블**명이며 버킷명과 다르다 | 신규 계약은 실측 이름 사용 |
| 10 | 이 문서 초안: 웹에 IQ 생성 feature flag 존재 가정 | 웹에는 **없다**(`IQ_CREATE` 검색 0건). `lib/shell/featureFlags.ts`에는 `CUSTOM_REQUEST`·`ACCOUNT_DELETION`·`USER_BLOCKS`만. `kIndividualQuestionCreateEnabled`는 **앱** 전용 | §16 플래그표에 반영 |

### 3.8 영역 전수 추적에서 추가 확인된 사실 `[AS-IS]`

15개 영역 병렬 추적 완료분에서 나온 항목 중, 계약에 영향이 있거나 S3 이후 조치가 필요한 것만 추린다. 각 항목은 직접 재확인했다.

#### XW-19 `shortform-thumbnails` 버킷에 **쓰기 경로가 존재하지 않는다** (W5 확장)

- `lib/community/communityShortformActions.ts:157` — `thumbnailUrl: null as string | null` **하드코딩**. 웹·앱 표면 finalize가 이 payload를 공유하므로 신규·수정 숏폼은 예외 없이 `shortform_posts.thumbnail_url = NULL`로 저장된다.
- 업로더 `uploadShortformThumbnail`(`communityShortformStorage.ts:155`)은 저장소 전체에서 **호출자 0건**(정의 1건뿐, 재확인함).
- 표시측 `pickThumb`는 `thumbnail_url` → `thumbnailUrl` → `cover_url` 순으로 읽지만 **어느 쓰기 경로도 이 컬럼들을 채우지 않는다.** 작성 폼에도 썸네일 입력 필드가 없다.
- 판정: 버킷은 읽기·계정삭제 정리만 배선돼 있어 레거시 데이터가 없으면 **항상 빈 상태**다. S1의 W5("숏폼 썸네일 배선 미완")보다 범위가 넓다 — 미완이 아니라 **쓰기 경로 부재**다. S2 신규 객체 대상 아님(§23 U-13).

#### XW-20 실제 업로드 경로에 **서버측 magic-bytes 검증이 없다**

- `uploadShortformVideo`(`communityShortformStorage.ts:107`)와 `uploadCommunityPostImages`(`lib/community/communityStorage.ts:24`)는 magic-bytes·MIME·크기 검증을 모두 갖췄지만 **호출자 0건**이다 — 브라우저 staged 업로드(서명 티켓 + `uploadToSignedUrl`)로 대체되면서 사문화됐다.
- 따라서 실제 업로드 경로의 서버측 방어는 **Storage 버킷의 `allowed_mime_types`와 `file_size_limit`뿐**이다(둘 다 실측 확인 — §3.5).
- §14.3의 "클라이언트가 magic bytes를 검사하고 bucket 제한을 서버 측 2차 검증으로 쓴다"는 이 사실과 일치한다. 다만 **F4/F5 finalize 시점의 `storage.objects` 소유자·MIME·크기 재검증이 실질적인 서버 게이트**가 된다는 점을 구현자가 알아야 한다.

#### XW-21 레거시 멘토 숏폼 작성 경로가 살아 있고 필수 필드를 채우지 않는다

- `insertMentorShortformPost`(`communityMutations.ts:53`)는 **도달 가능**하다: `app/(mentor)/mentor/community/new/page.tsx` → `MentorCommunityComposeForm` → `communityComposeActions.ts:60`.
- 이 경로는 후보 payload 6종을 순차 INSERT 시도하며 `video_url`·`status`·`author_label`·`create_idempotency_key`를 **전혀 넣지 않는다** → `status` DB 기본값에 따라 **영상 없는 숏폼이 공개 상태로 생성될 수 있다.**
- `communityShortformMutations.ts:50-51`이 "폴백 INSERT 제거"로 없앤 결함 패턴이 이 레거시 액션에 그대로 남아 있다. S2 신규 객체 대상은 아니나 §23 U-14로 기록한다.

#### XW-22 마이페이지 신고 건수가 **존재하지 않는 테이블**을 조회한다

- `lib/mypage/mypageQueries.ts:134,136` — `countRowsForUser(supabase, "reports", …)` 실패 시 `"abuse_reports"`로 재시도한다.
- 실측: public 77테이블에 **`reports`도 `abuse_reports`도 없다.** 정본은 `content_reports`다.
- 결과: 마이페이지 신고 지표는 **항상 폴백 문구**로 표시된다(기능이 조용히 죽어 있다). 보안 문제는 아니며 S2 신규 객체 대상도 아니다 → §23 U-15.

#### XW-23 리뷰 가시성 필터가 런타임 프로빙에 의존 (잠재 위험, 현재는 정상)

- `lib/mentor/publicReviewVisibility.ts:14-15`가 `is_hidden|hidden`, `is_blinded|is_blind`를 `pickExistingColumn`으로 탐지하고, **탐지 실패 시 hidden/blinded 제외 필터를 아예 붙이지 않는다.**
- 현재 `reviews`에는 `is_hidden`·`is_blinded`가 **둘 다 실재**하므로(실측) 프로빙은 성공하고 필터가 적용된다 → **현재는 정상 동작**한다.
- 다만 "컬럼을 못 찾으면 필터를 생략한다"는 fail-open 방향은 XW-15와 같은 계열이다. 신규 계약(V3의 `avg_rating`·`review_count` 집계)은 `is_hidden`·`is_blinded`를 **고정 컬럼으로 직접 참조**하므로 이 위험을 승계하지 않는다.

#### XW-24 알림 수신자 컬럼 후보군에 `recipient_user_id`가 없다 (정합성 미확인)

- `notifications`는 코드에 고정 스키마가 없고 실행 시점에 컬럼을 탐지한다(`notificationsHubQueries.ts:37-49`의 USER_FK 6 / READ_FK 7 / TYPE_FK 7 / ORDER 4 후보군). 같은 후보군이 `notificationReadActions.ts:13-14`에도 **중복 정의**돼 정본이 한 곳이 아니다.
- DB 정본 `mark_all_notifications_read`는 소유 판정에 `recipient_user_id`를 포함하는데, 웹 USER_FK 후보군에는 그 이름이 **없다**.
- 영향: `recipient_user_id`만 채워진 알림은 RPC로는 읽음 처리되지만 허브 목록·단건 읽음 경로에서 수신자 탐지에 걸리지 않을 수 있다. **실제 데이터 형상을 조회하지 않았으므로 발생 여부는 미확인**이다(개인정보 최소 조회 원칙) → §23 U-16.
- 부수: `typeCol` 탐지 실패 시 카테고리 allowlist 필터가 **조용히 생략**되어 해당 탭이 전체 목록을 보여준다(`:183-186`). `readCol` 탐지 실패는 반대로 탭을 막는다(`:167-173`) — 같은 파일 안에서 fail-open과 fail-closed가 갈린다.

> **이 6건은 모두 S2 `api_web_v1` 신규 객체의 대상이 아니다.** XW-19~XW-22·XW-24는 기능 위생 문제이고, XW-23은 현재 정상 동작한다. §7의 "신규 객체를 만들지 않는 영역" 판단은 유지되며, 각 항목은 §23에 U-13~U-16으로 이월한다.

---

## 4. 호출자와 신뢰 경계 `[TO-BE]`

### 4.1 호출자 계층 6종 (모든 신규 객체는 정확히 하나에 배정된다)

| 계층 | 코드 | DB 역할 | 실행 위치 | 신뢰 근거 |
|---|---|---|---|---|
| **T1** 로그인 전 공개 조회 | `PUBLIC-READ` | `anon` | 브라우저/서버 | 없음 — 공개 정보만. 쓰기 금지 |
| **T2** 로그인 사용자 직접 호출 | `USER` | `authenticated` | 브라우저 또는 웹 서버 세션 | 사용자 JWT. 주체는 **함수 내부 `auth.uid()`** 로만 도출 |
| **T3** 웹 서버 세션 기반 호출 | `WEB-SERVER` | `authenticated` (사용자 JWT) | Next.js 서버 액션·route (`"use server"` / `import "server-only"`) | 사용자 JWT + 서버 측 선검증. **DB 역할은 T2와 동일** — 분리는 코드 위치 규약이며 권한 경계가 아니다 |
| **T4a** 관리자 — 특권 우회 | `ADMIN-SVC` | `service_role` | 서버 전용 | 웹 서버가 `requireRole("admin")` 선검증. 관리자 신원은 **인자로 전달**(`p_admin_id`) |
| **T4b** 관리자 — 호출자 JWT 검증 | `ADMIN-JWT` | `authenticated` (관리자 JWT) | 서버 전용 | 함수 내부 `is_admin()`이 `auth.uid()`를 검증. **service_role로 호출하면 실패** |
| **T5** scheduled worker | `WORKER` | `service_role` | cron route | `CRON_SECRET` timing-safe + env 킬스위치 |

**T4a/T4b 분리는 이번 세션의 실측 결과다.** `approve_mentor_school_verification_admin`은 내부 `is_admin()`이 호출자 JWT의 `auth.uid()`를 읽으므로 service_role 호출 시 정상 관리자도 `NOT_ADMIN`이 된다(코드 주석 + 함수 정의로 확인). 반면 `approve_refund_request_admin`은 `p_admin_id`를 인자로 받는 T4a다. 신규 관리자 계약은 **T4a·T4b 중 하나를 반드시 명시**한다.

### 4.2 T3의 정확한 의미 (혼동 방지)

T3는 새로운 DB 권한 계층이 **아니다**. `lib/supabase/server.ts`의 세션 클라이언트는 `authenticated` 역할이며 T2와 동일한 GRANT를 사용한다. 따라서:

- **T2/T3에 배정된 객체는 브라우저에서도 직접 호출될 수 있다고 가정하고 설계한다.** "서버 액션만 부를 것"이라는 전제에 보안을 의존하지 않는다.
- 브라우저가 절대 부를 수 없어야 하는 계약(자금 확정·상태 확정·관리자·worker)은 T4a/T5로 배정하고 `core_private`에 두어 `anon`·`authenticated` EXECUTE를 부여하지 않는다.
- 이 원칙이 XW-02·XW-03(직접 테이블 UPDATE로 웹 검증을 우회) 재발을 막는 유일한 구조적 방어다.

### 4.3 클라이언트 키 노출 규약 (실측 확인 + 유지)

- `service_role` 키는 `lib/supabase/admin.ts`에서 `SUPABASE_SERVICE_ROLE_KEY`로만 읽고 `import "server-only"`로 보호된다 → 클라이언트 번들 유출 경로 없음(실측). **이 구조를 유지한다.**
- 신규 계약은 클라이언트에 `service_role` 키를 요구하는 경로를 만들지 않는다.
- 앱 표면(`createAppSurfaceClient`)은 anon 키 + HttpOnly 쿠키를 유지하며, 신규 `api_web_v1` 객체를 앱 표면에서 호출할 필요가 생기면 **§19 경계표를 먼저 개정**한다.

---

## 5. 신규 schema 구성 `[TO-BE]`

### 5.1 스키마 2개

| 스키마 | 성격 | Data API 노출 | 목적 |
|---|---|---|---|
| `api_web_v1` | **외부 노출** | ✅ exposed schema에 추가 | 웹이 호출할 최소 view·function |
| `core_private` | **내부 전용** | ❌ 절대 노출 금지 | 공용 구현부 + 서버/관리자/worker 전용 특권 계약 |

`core_private` 이름은 `api_app_v1` 계약 §7.4 T3(consented RPC 이전 대상 스키마)와 **동일한 이름을 재사용**한다. 신규 스키마를 또 만들지 않는다.

### 5.2 왜 `core_private`가 필요한가 (측정 근거)

1. **공용 의미 중복 방지.** 무료질문 방 확보는 웹에 이미 있고(`web@ad076d29:lib/qna/freeQuestionRoom.ts:23`, service_role JS 경로) 앱에는 없다(A2 `roomMissing`). `api_app_v1`이 `ensure_free_question_room`을 새로 만들면 **같은 자격 판정이 JS와 SQL 두 곳에 생긴다** — S1이 진단한 계약 표류가 재발한다. 두 표면 wrapper가 **하나의 `core_private` 구현**을 호출해야 의미가 갈라질 수 없다.
2. **T4a/T5 계약을 외부 스키마에 두지 않기.** §4.2대로 `api_web_v1`의 객체는 브라우저가 직접 부를 수 있다고 가정해야 한다. 자금 확정·관리자·worker 계약은 `anon`/`authenticated`에 EXECUTE를 주지 않는 별도 스키마에 두는 것이 유일한 구조적 방어다(원칙 §6.14).

### 5.3 스키마 생성·기본 권한 (정확한 DDL)

```sql
-- 5.3.1 외부 노출 스키마
CREATE SCHEMA IF NOT EXISTS api_web_v1;
REVOKE ALL ON SCHEMA api_web_v1 FROM PUBLIC;
GRANT USAGE ON SCHEMA api_web_v1 TO anon, authenticated, service_role;

-- 5.3.2 내부 전용 스키마
CREATE SCHEMA IF NOT EXISTS core_private;
REVOKE ALL ON SCHEMA core_private FROM PUBLIC;
-- anon·authenticated 에는 USAGE 를 주지 않는다(부여 자체를 하지 않음).
GRANT USAGE ON SCHEMA core_private TO service_role;

-- 5.3.3 [필수] 신규 함수의 PUBLIC 기본 EXECUTE 차단
--  PostgreSQL 은 새 함수에 PUBLIC EXECUTE 를 기본 부여한다.
--  아래 default privileges 없이는 함수마다 REVOKE 를 빠뜨리는 순간 열린다.
ALTER DEFAULT PRIVILEGES IN SCHEMA api_web_v1  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA core_private REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
```

> **구현 주의 (측정에 기반한 함정 3개)**
> 1. `ALTER DEFAULT PRIVILEGES`는 **실행한 역할이 앞으로 만드는** 객체에만 적용된다. migration 실행 역할과 함수 소유 역할이 같아야 하며, 그래도 각 함수에 **명시적 `REVOKE ALL … FROM PUBLIC`을 함께 쓴다**(이중 방어).
> 2. `service_role`은 RLS를 우회하지만 **함수 EXECUTE와 스키마 USAGE는 우회하지 않는다.** 기존 `public` 함수들이 `service_role=true`로 보이는 것은 Supabase가 `public`에 기본 권한을 설정해 둔 결과이며, **신규 스키마에는 적용되지 않는다.** §10 표의 `service_role` GRANT를 빠뜨리면 웹 서버 경로가 전부 깨진다.
> 3. `SECURITY DEFINER` 함수는 **소유자 권한**으로 실행되므로, §10에서 `authenticated`의 `mentor_profiles.verification_status` 컬럼 UPDATE를 회수해도 **기존 SECDEF 관리자 RPC(`approve_mentor_school_verification_admin`)는 영향받지 않는다.** 컬럼 회수와 관리자 승인 경로는 충돌하지 않는다.

### 5.4 Data API 노출 설정

- Supabase Dashboard(또는 프로젝트 설정)의 **Exposed schemas**에 `api_web_v1`을 추가한다. `api_app_v1`도 같은 방식으로 추가된다(앱 계약 §3.1).
- `core_private`는 **절대 추가하지 않는다.** 노출 여부는 §21 T-PERM-03 테스트로 회귀 감시한다.
- `public`은 레거시 호환 때문에 S2에서 **계속 노출 상태로 유지**한다(§18).

---

## 6. 신규 view 전체 목록과 정확한 필드 `[TO-BE]`

총 **7개**. 각 view는 (a) 앱과의 사용자 관점 동등성 요구, 또는 (b) §3.6에서 측정된 결함 해소 중 하나를 근거로 한다. 근거 없는 view는 만들지 않는다.

| # | view | 호출자 | 근거 |
|---|---|---|---|
| V1 | `api_web_v1.community_posts_v1` | T1(anon)+T2 | **앱 계약 §3.2와 필드 동등** — 공용 기능 계약 일치 |
| V2 | `api_web_v1.community_comments_v1` | T1+T2 | XW-09 `comments`/`community_comments` 이중화 수렴 |
| V3 | `api_web_v1.mentor_directory_v1` | T1 | XW-02b 승인 필터를 DB로 이동 |
| V4 | `api_web_v1.my_wallet_v1` | T2 | 자기 지갑 단일 계약 |
| V5 | `api_web_v1.my_cash_ledger_v1` | T2 | **W3/§7.2 주문 참조를 사용자에게 노출하는 지점** |
| V6 | `api_web_v1.my_subscriptions_v1` | T2 | XW-10 프로빙 경로 대체 |
| V7 | `api_web_v1.mentor_settlement_v1` | T2(멘토) | 직접 테이블 조회 대체 |

### V1 `api_web_v1.community_posts_v1`

목적: 게시판 목록·상세·내 글이 **앱과 동일한 필드 계약**으로 `image_refs`를 읽는다.

```text
id              uuid
author_id       uuid
title           text
body            text
category        text
image_refs      text[]
author_label    text
author_role     text
like_count      integer
comment_count   integer
view_count      integer
status          text
created_at      timestamptz
updated_at      timestamptz
```

필드 규약 (앱 계약 §3.2와 **완전 동일**):
- `body = coalesce(content, body)` — 과도기 컬럼(`community_posts`에 `body`·`content` 병존, 실측)을 한 번만 수렴한다.
- `image_refs = coalesce(image_urls, '{}')` — 이름으로 "영구 URL"이라는 오해를 제거한다. 값은 `community-post-images/{uid}/{object}` 형식 ref다.
- 노출 조건: `deleted_at IS NULL` **AND** (`status='published'` **OR** `author_id = auth.uid()`).
  - **XW-09 해소 지점**: 기반 RLS 어디에도 `deleted_at` 필터가 없으므로 view가 명시적으로 건다.
- `author_id`는 차단 필터·본인 글 판정에만 쓰고 UI에 직접 표시하지 않는다.
- `WITH (security_invoker = true)` — 기반 `community_posts` RLS를 그대로 적용한다.
- DML 금지. 쓰기는 §7의 RPC만 사용한다.

### V2 `api_web_v1.community_comments_v1`

목적: 정본 `comments`만 노출해 레거시 `community_comments` 이중 읽기를 종료한다.

```text
id            uuid
post_id       uuid
author_id     uuid
parent_id     uuid
body          text
like_count    integer
author_label  text
author_role   text
created_at    timestamptz
```

필드 규약:
- 원천은 **`public.comments`(정본)만** 사용한다. `community_comments`(레거시)는 읽지 않는다. 두 테이블은 `cc_sync_*`·`comments_mirror_*` 트리거로 동기화되므로(실측) 정본만 읽어도 손실이 없다.
- `body = comments.content` (실측 컬럼명은 `content`).
- 노출 조건: `is_deleted = false` — 기반 정책 `comments_select_visible`(`is_deleted=false`, `{anon,authenticated}`)과 동일하므로 `security_invoker=true`로 성립한다.
- `author_label` / `author_role` = **`api_web_v1.user_display_label(author_id)` / `api_web_v1.user_display_role(author_id)`** 호출 결과.
  - **왜 join이 아닌 함수인가(측정 근거):** `users`의 SELECT 정책은 `users_select_own`(`id = auth.uid()`)과 `users_admin_select_all`(admin)뿐이라 일반 사용자는 `security_invoker` view에서 **다른 사용자 행을 읽을 수 없다.**(테이블 정책은 총 4종: select_own, admin_select_all, insert_own, update_own) `community_posts`가 `author_label`·`author_role`을 비정규화해 갖고 있는 이유가 이것이며, `comments`에는 그 컬럼이 없다(실측). 따라서 행 필터는 RLS에 맡기고 **라벨만 좁은 SECDEF 함수**로 얻는다(§7 F0).
- `WITH (security_invoker = true)`.
- DML 금지.

### V3 `api_web_v1.mentor_directory_v1`

목적: **승인·활성 멘토만** 공개 디렉터리에 노출한다(XW-02b 해소).

```text
mentor_id                 uuid
nickname                  text
university_name           text
department_name           text
teaching_subjects         text[]
intro_line                text
profile_image_url         text
high_school_name          text
school_verified           boolean
school_tier               text
verified_major_category   text
verified_university_name  text
verified_department_name  text
is_open_for_subscriptions boolean
avg_rating                numeric
review_count              integer
created_at                timestamptz
```

필드 규약:
- 노출 조건 (**모두 AND**):
  - `users.role = 'mentor'`
  - `lower(coalesce(users.status,'active')) = 'active'` — banned/suspended 제외
  - `lower(coalesce(mentor_profiles.verification_status,'')) IN ('approved','verified','active')` — `individual_question_user_is_approved_mentor`와 **동일한 판정식**을 사용해 게이트와 디렉터리가 갈라지지 않게 한다.
- `nickname` = `users.nickname` (없으면 `NULL`). **`full_name`·`email`·`birth_date`는 노출하지 않는다.**
- 학교 인증 4필드는 `mentor_school_verifications`에서 `status='approved'` 최신 1건을 `LEFT JOIN LATERAL`로 취한다(기존 `mentor_profiles_for_directory_v2`와 동일한 정렬: `coalesce(reviewed_at, updated_at, created_at) DESC, created_at DESC`). `school_verified = (매칭 행 존재)`.
- `avg_rating` / `review_count`는 **`reviews`에서 계산**한다: `coalesce(is_hidden,false)=false AND coalesce(is_blinded,false)=false`인 행의 `avg(rating)`·`count(*)`.
  - **측정 정정:** `mentor_profiles`에는 `avg_rating`·`review_count` 컬럼이 **없다**(실측 0건). CLAUDE.md의 해당 표기는 stale이다(§3.7 #7). 기존 웹은 `get_mentor_review_stats` RPC로 값을 얻는다.
- `WITH (security_invoker = false)` — **의도된 예외.** 근거: 타인 `users`·`mentor_profiles` 행을 읽어야 하는데 두 테이블의 RLS는 본인·admin만 허용한다(실측). 원칙 §6.13의 "가능하면 invoker"에 대한 명시적 예외이며, 안전장치는 **위 노출 조건이 view 정의 안에 하드코딩**되고 view가 읽기 전용이라는 점이다.
- 소유자는 migration 역할로 고정하고, `anon`·`authenticated`에 **SELECT만** 부여한다(§10).

### V4 `api_web_v1.my_wallet_v1`

```text
user_id        uuid
balance_cents  bigint
balance_krw    bigint
```

- `balance_krw = balance_cents / 100` (1캐시 = 1원, `balance_cents`는 minor unit = 원×100 — 잠금값).
- `WITH (security_invoker = true)` — `cash_wallets` `cwal_select`(`user_id = auth.uid()`)가 자동으로 본인 행만 남긴다.

### V5 `api_web_v1.my_cash_ledger_v1`

목적: 자기 캐시 원장 조회 + **Toss 주문 참조 노출**(§7.2 결정의 사용자 가시 지점).

```text
id          uuid
delta_cents bigint
delta_krw   bigint
reason      text
ref_type    text
ref_id      uuid
order_ref   text
created_at  timestamptz
```

- `delta_krw = delta_cents / 100`.
- `order_ref` 규약:
  ```
  order_ref = coalesce(
      cash_ledger.ref_text,                                  -- §7.2 신규 컬럼(정본)
      CASE WHEN ref_type = 'topup' THEN idempotency_key END  -- 레거시 충전 행 호환
  )
  ```
  - 레거시 폴백을 `ref_type='topup'`으로 **한정**하는 이유: 충전 행에서만 `idempotency_key`가 Toss `orderId`와 같다(실측 — `record_cash_topup`이 `p_idempotency_key`에 orderId를 그대로 넣는다). 구독 차감(`sub_debit_{payment_id}`)·IQ escrow(`iq_hold:{qid}` 등)의 키는 주문번호가 아니므로 노출하면 의미가 왜곡된다.
  - `idempotency_key`를 **그대로 노출하는 컬럼은 두지 않는다.** 멱등키는 내부 dedup 수단이며 사용자 계약 필드가 아니다(향후 dedup 전략 변경 자유도 보존).
- `WITH (security_invoker = true)` — `cled_select`(`user_id = auth.uid()`)로 본인 행만.

### V6 `api_web_v1.my_subscriptions_v1`

```text
subscription_id        uuid
mentor_id              uuid
mentor_label           text
plan_id                uuid
plan_tier              text
amount_cents           integer
status                 text
started_at             timestamptz
current_period_start   timestamptz
current_period_end     timestamptz
next_billing_at        timestamptz
cancel_at_period_end   boolean
grace_until            timestamptz
created_at             timestamptz
```

- 원천은 `public.subscriptions` **한 테이블만**. `SUB_TABLES` 프로빙(`mentor_subscriptions`·`user_subscriptions`)은 쓰지 않는다 — 두 테이블은 **실측 부재**다(XW-10).
- `amount_cents`는 `mentor_plans`를 `plan_id`로 join해서 얻는다(`mplan_select`가 `true`이므로 invoker로 읽힌다).
- `mentor_label = api_web_v1.user_display_label(mentor_id)`.
- `WITH (security_invoker = true)` — `subscriptions_select_parties`가 학생·멘토 당사자만 남긴다. 따라서 이 view는 **멘토 쪽에서도** 자기 구독자 목록으로 쓰인다.

### V7 `api_web_v1.mentor_settlement_v1`

```text
item_id             uuid
subscription_id     uuid
student_label       text
event_type          text
billing_at          timestamptz
period_start        timestamptz
period_end          timestamptz
gross_cents         bigint
platform_fee_cents  bigint
mentor_amount_cents bigint
fee_rate            numeric
status              text
hold_reason         text
paid_at             timestamptz
created_at          timestamptz
```

- 원천 `public.subscription_settlement_items`. `WITH (security_invoker = true)` — 정책 `ssi_select_mentor_own`(`mentor_id = auth.uid()`, `authenticated` SELECT)이 자기 항목만 남긴다(실측). authenticated GRANT가 이미 `SELECT,REFERENCES,TRIGGER,TRUNCATE`로 축소돼 있어 쓰기 경로가 없다.
- `student_label = api_web_v1.user_display_label(student_id)`.
- **`idempotency_key`·`ledger_id`·`payment_id`는 노출하지 않는다**(내부 참조).
- `due_payouts` view는 계속 `service_role` 전용으로 두고 이 view로 대체하지 않는다(§18).

---

## 7. 신규 function 전체 목록과 정확한 입력 시그니처 `[TO-BE]`

총 **14개 함수** (`api_web_v1` 11 + `core_private` 3). 아래 표는 13행이지만 **F0이 함수 2개**(`user_display_label`, `user_display_role`)이므로 함수 수는 14다. 계층은 §4.1 코드로 표기한다.

| # | 함수 | 계층 | 반환 |
|---|---|---|---|
| F0 | `api_web_v1.user_display_label(p_user_id uuid)` / `api_web_v1.user_display_role(p_user_id uuid)` | T1/T2 보조 | `text` |
| F1 | `api_web_v1.weekly_question_usage_self(p_mentor_id uuid)` | T2 | `jsonb` |
| F2 | `api_web_v1.ensure_free_question_room(p_mentor_id uuid)` | T2 | `jsonb` |
| F3 | `api_web_v1.qna_create_question_thread(p_room_id uuid, p_title text, p_subject text DEFAULT NULL, p_topic text DEFAULT NULL, p_first_message_body text DEFAULT NULL)` | T2 | `jsonb` |
| F4 | `api_web_v1.community_post_create(p_title text, p_body text, p_category text, p_image_refs text[] DEFAULT '{}', p_status text DEFAULT 'published', p_idempotency_key uuid)` | T2 | `jsonb` |
| F5 | `api_web_v1.community_post_update(p_post_id uuid, p_title text, p_body text, p_category text, p_image_refs text[] DEFAULT '{}', p_status text DEFAULT 'published', p_expected_updated_at timestamptz)` | T2 | `jsonb` |
| F6 | `api_web_v1.community_post_soft_delete(p_post_id uuid)` | T2 | `jsonb` |
| F7 | `api_web_v1.mentor_profile_update_self(p_university_name text, p_department_name text, p_high_school_name text, p_teaching_subjects text[], p_intro_line text, p_bio text, p_answer_style text, p_profile_image_url text, p_is_open_for_subscriptions boolean)` | T2(멘토) | `jsonb` |
| F8 | `api_web_v1.mentor_plan_prices_set_self(p_limited_cash_krw integer, p_standard_cash_krw integer, p_premium_cash_krw integer)` | T2(멘토) | `jsonb` |
| F9 | `api_web_v1.account_deletion_status_self()` | T2 | `jsonb` |
| F10 | `core_private.ensure_student_mentor_room(p_student_id uuid, p_mentor_id uuid, p_payment_id uuid DEFAULT NULL, p_subscription_id uuid DEFAULT NULL, p_require_entitlement boolean DEFAULT true)` | T4a/T5 | `jsonb` |
| F11 | `core_private.record_cash_topup_v2(p_user_id uuid, p_amount_cents bigint, p_idempotency_key text, p_order_ref text)` | T4a | `jsonb` |
| F12 | `core_private.subscription_checkout_confirm_v2(p_payment_id uuid, p_plan_id uuid, p_expected_amount_cents integer, p_idempotency_key text DEFAULT NULL)` | T4a | `jsonb` |

**신규 객체를 만들지 않는 영역(의도적):** 개별질문 escrow, 맞춤의뢰 lifecycle, 정산 지급(`pay_due_payouts_for_run`·`run_scheduled_payout`), 환불 승인·거절, 알림, 계정 탈퇴 worker 체인, 공개 멘토 조회 RPC 3종. 이들은 이미 `service_role` 전용이거나 함수 내부 `auth.uid()` 검증이 있고, 이번 세션에서 **측정된 결함이 없다.** S2에서 건드리지 않는다(§18 "유지").

### F0 `api_web_v1.user_display_label` / `user_display_role`

```sql
api_web_v1.user_display_label(p_user_id uuid) RETURNS text
api_web_v1.user_display_role(p_user_id uuid)  RETURNS text
```

- `SECURITY DEFINER`, `STABLE`, `SET search_path = ''`, 완전 수식 객체명.
- `user_display_label` 반환: `public.users.nickname`. `nickname`이 비었으면 `'쌤버십 사용자'` 고정 문구. **`full_name`·`email`·`birth_date`·`grade_level`은 절대 반환하지 않는다.**
- `user_display_role` 반환: `public.users.role` 중 `'student'|'mentor'` 만. `admin`이면 `'mentor'`로 강등 표기하지 않고 **`NULL`** 을 반환한다(관리자 신원 노출 금지).
- 존재하지 않는 uid → `user_display_label`은 고정 문구, `user_display_role`은 `NULL`.
- **PII 노출 범위가 이 두 함수로 한정**되며, 이것이 §10에서 `anon`·`authenticated`에 EXECUTE를 주는 유일한 `core_private` 함수다(예외를 §11.4에 명시).

### F1 `api_web_v1.weekly_question_usage_self` — XW-01 해소

```sql
api_web_v1.weekly_question_usage_self(p_mentor_id uuid) RETURNS jsonb
```

- **학생 id를 인자로 받지 않는다.** 내부에서 `auth.uid()`로 도출한다(원칙 §6.5).
- 계산 로직은 기존 `public.get_weekly_question_usage(p_student_id, p_mentor_id)`와 **수치적으로 동일**해야 한다. 구현은 계산부를 새로 만들지 않고 기존 정본 함수를 `auth.uid()`를 넣어 호출한다 — 이렇게 하면 한도 규칙이 두 곳에 생기지 않는다.
- **사전 검사가 필수다.** 정본은 인자가 null이면 `raise exception 'p_student_id and p_mentor_id are required'`를 던진다(실측) — 안정 코드가 아닌 원문 문자열이라 §8.2의 "사전에 없는 예외는 전파"에 걸려 그대로 새어 나간다. 따라서 F1은 정본 호출 **전에** 다음을 검사한다:
  - `auth.uid() IS NULL` → `AUTH_REQUIRED`
  - `p_mentor_id IS NULL` → `MENTOR_ID_REQUIRED`
- 성공 반환:
  ```json
  { "ok": true, "contract_version": 1,
    "used": 3, "limit": 9, "remaining": 6, "can_ask": true,
    "plan_tier": "standard",
    "week_start": "2026-07-25T00:00:00Z", "week_end": "2026-08-01T00:00:00Z" }
  ```
- 한도 매핑(실측 재확인): `limited`=4, `standard`=9, `premium`=999, 그 외 0. 주 경계는 `coalesce(subscriptions.started_at, created_at)` 기준 **7일 롤링**(달력주 아님).
- 실패: `AUTH_REQUIRED`, `MENTOR_ID_REQUIRED`.
- `SECURITY DEFINER`, `SET search_path = ''`.

### F2 `api_web_v1.ensure_free_question_room` — A2/XW 해소 + 앱과 공용

```sql
api_web_v1.ensure_free_question_room(p_mentor_id uuid) RETURNS jsonb
```

- **`api_app_v1.ensure_free_question_room(p_mentor_id uuid)`와 이름·시그니처·반환·오류코드가 완전히 동일**하다. 두 wrapper는 동일한 `core_private.ensure_student_mentor_room`(F10)을 호출하는 **얇은 껍데기**여야 한다. 자격 판정 로직을 각자 복제하지 않는다.
- 성공 반환 (앱 계약 §4.1과 동일):
  ```json
  { "ok": true, "contract_version": 1, "room_id": "uuid", "created": true, "entitlement": "free" }
  ```
  `entitlement` ∈ `free | subscription`. `created`는 이번 호출이 방을 만들었는지.
- 원자성·순서 (앱 계약 §4.2와 동일, F10이 수행):
  1. `auth.uid()` 및 학생 역할 확인
  2. 계정 상태·탈퇴 write-block 확인
  3. 승인된 멘토·상호 차단 확인
  4. 학생 행 잠금 및 활성 구독/무료질문 자격 확인
  5. `(student_id, mentor_id)` 기존 방 조회
  6. 없으면 `INSERT … ON CONFLICT (student_id, mentor_id) DO NOTHING`
  7. 최종 방을 재조회해 반환
- **방 확보는 무료질문권을 소비하지 않는다.** 실제 소비는 F3(스레드 생성)이 같은 트랜잭션에서 `free_question_usage` INSERT로 처리한다. 방 확보 후 자격이 바뀌어도 F3가 다시 거부한다.
- 오류코드: `AUTH_REQUIRED`, `ROLE_NOT_STUDENT`, `ACCOUNT_BANNED`, `ACCOUNT_SUSPENDED`, `ACCOUNT_DELETION_IN_PROGRESS`, `MENTOR_NOT_FOUND`, `MENTOR_NOT_APPROVED`, `BLOCKED`, `FREE_QUOTA_EXPIRED`, `FREE_QUOTA_TOTAL_EXHAUSTED`, `FREE_QUOTA_MENTOR_EXHAUSTED`, `ROOM_ENSURE_FAILED`.
- `SECURITY DEFINER`, `SET search_path = ''`.

### F3 `api_web_v1.qna_create_question_thread` — XW-07/XW-08 해소

```sql
api_web_v1.qna_create_question_thread(
  p_room_id uuid, p_title text,
  p_subject text DEFAULT NULL, p_topic text DEFAULT NULL,
  p_first_message_body text DEFAULT NULL
) RETURNS jsonb
```

- 시그니처는 기존 정본 `public.qna_create_question_thread(uuid,text,text,text,text)` 및 `api_app_v1.qna_create_question_thread`와 **동일**하다.
- 역할: 정본을 호출하고 **예외를 envelope로 변환**한다. 정본은 도메인 거부를 전부 `raise exception`으로 던진다(실측, XW-07) — 이 wrapper 없이는 클라이언트가 안정 코드를 얻을 수 없다.
- 성공 반환:
  ```json
  { "ok": true, "contract_version": 1,
    "thread_id": "uuid", "message_id": "uuid|null",
    "path": "free|subscription", "used_free_quota": true }
  ```
  (정본 반환 `{ok,thread_id,message_id,path,used_free_quota}`에 `contract_version`만 추가)
- 변환 규약:
  - 정본이 던지는 메시지가 §9 사전의 알려진 코드면 그 코드로 매핑한다.
  - **XW-08 정규화**: 트리거가 던지는 `FREE_QUESTION_EXPIRED`/`FREE_QUESTION_TOTAL_LIMIT`/`FREE_QUESTION_PER_MENTOR_LIMIT`도 각각 `FREE_QUOTA_EXPIRED`/`FREE_QUOTA_TOTAL_EXHAUSTED`/`FREE_QUOTA_MENTOR_EXHAUSTED`로 **같은 코드에 수렴**시킨다. 동시성 경합에서 코드 문자열이 달라지는 현상을 계약 수준에서 제거한다.
  - 사전에 없는 예외는 **삼키지 않고 그대로 전파**한다(원칙 §6.11). `ok:true`로 바꾸지 않는다.
- `SECURITY INVOKER`가 아니라 `SECURITY DEFINER`로 만든다 — 이유: 정본이 이미 SECDEF이고, wrapper가 INVOKER면 `authenticated`에 정본 EXECUTE가 계속 필요해 레거시 표면을 좁힐 수 없다. wrapper 내부는 인자를 그대로 넘기고 자체 권한 판단을 하지 않는다(판단은 정본이 `auth.uid()`로 수행).

### F4·F5·F6 커뮤니티 글 쓰기 — 앱과 동등

```sql
api_web_v1.community_post_create(
  p_title text, p_body text, p_category text,
  p_image_refs text[] DEFAULT '{}', p_status text DEFAULT 'published',
  p_idempotency_key uuid
) RETURNS jsonb

api_web_v1.community_post_update(
  p_post_id uuid, p_title text, p_body text, p_category text,
  p_image_refs text[] DEFAULT '{}', p_status text DEFAULT 'published',
  p_expected_updated_at timestamptz
) RETURNS jsonb

api_web_v1.community_post_soft_delete(p_post_id uuid) RETURNS jsonb
```

- 시그니처·반환·오류코드는 `api_app_v1`의 동명 함수와 **완전 동일**하다(앱 계약 §3.3). 검증 규칙을 웹·앱 각각 만들지 않는다 — 구현은 `core_private` 공용 검증부를 공유한다.
- 클라이언트가 보낸 `author_id`·`author_role`·`author_label`은 **받지 않는다.** 함수가 `auth.uid()`와 `public.users`에서 도출한다.
- 반환:
  - create 성공: `{ok:true, contract_version:1, post_id, idempotent_replay:false}` / 멱등 재생: `idempotent_replay:true` + 기존 `post_id`
  - update 성공: `{ok:true, contract_version:1, post_id, updated_at, removed_image_refs:[…]}`
  - soft_delete 성공: `{ok:true, contract_version:1, post_id, deleted_at}`
- 멱등: create는 `p_idempotency_key` **필수**, `(author_id, create_idempotency_key)` 기준. 근거: `community_posts_author_idem_key` UNIQUE INDEX가 이미 존재한다(실측).
- update는 `p_expected_updated_at`으로 낙관적 충돌 검사 → 불일치 시 `UPDATE_CONFLICT`.
- soft_delete는 `deleted_at`을 세우고 **행을 지우지 않는다.** hard delete를 하지 않는다(XW-09 대응의 계약 측면. RLS `cp_delete_own`의 hard DELETE 자체를 막는 것은 §20 M8 선택 항목).
- 이미지 ref 검증(각 ref마다 전부): 허용 버킷인지 / path 첫 세그먼트가 `auth.uid()`인지 / `storage.objects`에 실제 존재하는지 / 소유자·MIME·크기가 계약과 맞는지 / 개수 ≤ 5.
- `SECURITY DEFINER`, `SET search_path = ''`.

### F7 `api_web_v1.mentor_profile_update_self` — XW-02 해소

```sql
api_web_v1.mentor_profile_update_self(
  p_university_name text, p_department_name text, p_high_school_name text,
  p_teaching_subjects text[], p_intro_line text, p_bio text,
  p_answer_style text, p_profile_image_url text,
  p_is_open_for_subscriptions boolean
) RETURNS jsonb
```

- **쓰기 허용 컬럼 allowlist가 시그니처 그 자체다.** 위 9개 컬럼만 갱신한다.
- **절대 갱신하지 않는 컬럼(= XW-02의 공격면):** `verification_status`, `cap_limit`, `user_id`, `student_id_image_url`, `activity_status`, `termination_requested_at`, `termination_effective_at`, `pause_*`, `last_pause_at`, `abandonment_flagged_at`, `payout_bank_name`, `payout_account_number`, `created_at`.
  - 정산 계좌(`payout_*`)는 자금 수취 대상이므로 프로필 수정과 **분리한다**(별도 계약은 §23 U-06으로 이월).
- 검증: `auth.uid()` 존재, `users.role='mentor'`, 계정 write-block 아님, 본인 `mentor_profiles` 행 존재.
- `p_teaching_subjects`는 `public.subjects.code`에 존재하는 값만 남기고 나머지는 버린다(정본 `qna_create_question_thread`가 subject를 검증하는 방식과 동일).
- 반환: `{ok:true, contract_version:1, updated_at}` / 실패 `{ok:false, contract_version:1, code}`.
- 오류코드: `AUTH_REQUIRED`, `ROLE_NOT_MENTOR`, `ACCOUNT_BANNED`, `ACCOUNT_SUSPENDED`, `ACCOUNT_DELETION_IN_PROGRESS`, `MENTOR_PROFILE_NOT_FOUND`, `UNIVERSITY_NAME_REQUIRED`, `DEPARTMENT_NAME_REQUIRED`, `PROFILE_IMAGE_REF_INVALID`.
- `SECURITY DEFINER`, `SET search_path = ''`.
- **이 함수가 있어야 §10의 컬럼 REVOKE가 가능하다.** 순서: F7 배포 → 웹 callsite 전환 → 컬럼 REVOKE(§20 M9).

### F8 `api_web_v1.mentor_plan_prices_set_self` — XW-03 해소

```sql
api_web_v1.mentor_plan_prices_set_self(
  p_limited_cash_krw  integer,
  p_standard_cash_krw integer,
  p_premium_cash_krw  integer
) RETURNS jsonb
```

- 캐시(원) 단위로 받아 내부에서 `amount_cents = cash_krw * 100`으로 변환한다(웹 `amountCentsFromCashKrw`와 동일).
- **가격 밴드를 DB에서 강제한다.** 밴드값은 함수 안에 상수로 고정한다(현행 웹 정본 `lib/subscribe/mentorPlanPricing.ts:13`과 동일):

  | tier | min | 권장 | max |
  |---|---:|---:|---:|
  | `limited` | 29,900 | 29,900 | 69,900 |
  | `standard` | 84,900 | 84,900 | 149,900 |
  | `premium` | 174,900 | 174,900 | 329,900 |

- 밴드 밖 값은 **클램프하지 않고 거부**한다(현행 웹 동작과 동일 — 조용한 보정은 멘토가 의도한 가격과 달라져 더 위험하다).
- `plan_tier`는 `limited|standard|premium` 3종만 허용한다. `cap_weight`는 tier에 따라 `1.0/2.5/4.5`로 **함수가 강제**한다(클라이언트가 보낼 수 없다) — XW-03의 cap 우회 경로를 함께 닫는다.
- upsert 대상은 `(mentor_id, plan_tier)` — 근거는 실측 **UNIQUE INDEX `uq_mentor_plans_mentor_tier`**. `ON CONFLICT (mentor_id, plan_tier) DO UPDATE`를 쓴다. 3 tier를 **한 트랜잭션**에서 처리한다.
- 반환: `{ok:true, contract_version:1, updated:[{plan_tier, amount_cents}], unchanged:[…]}`.
- 오류코드: `AUTH_REQUIRED`, `ROLE_NOT_MENTOR`, `ACCOUNT_*`, `PLAN_PRICE_OUT_OF_BAND`(+`tier`,`min_cash_krw`,`max_cash_krw` 필드 동반), `PLAN_PRICE_INVALID`.
- `SECURITY DEFINER`, `SET search_path = ''`.
- **잠금값 개정 시 이 함수와 `lib/subscribe/mentorPlanPricing.ts`를 같은 PR에서 함께 바꾼다**(§21 T-REG-02가 두 값의 일치를 회귀 감시).

### F9 `api_web_v1.account_deletion_status_self`

```sql
api_web_v1.account_deletion_status_self() RETURNS jsonb
```

- 기존 `public.account_deletion_status_self()`(인자 없음, `authenticated` 실행 가능)의 얇은 wrapper. envelope(`ok`/`contract_version`)만 통일한다.
- 신규 로직 없음. `api_app_v1`은 앱 호환을 위해 기존 `public` 함수를 계속 쓰므로(앱 계약 §7.1) 이 wrapper는 **웹 전용**이다.

### F10 `core_private.ensure_student_mentor_room` — 공용 구현부

```sql
core_private.ensure_student_mentor_room(
  p_student_id uuid, p_mentor_id uuid,
  p_payment_id uuid DEFAULT NULL, p_subscription_id uuid DEFAULT NULL,
  p_require_entitlement boolean DEFAULT true
) RETURNS jsonb
```

- **웹 F2·앱 `api_app_v1.ensure_free_question_room`·구독 확정 경로가 모두 이 함수로 수렴한다.**
- `p_student_id`를 인자로 받는 이유: 구독 확정(T4a)은 학생 세션이 아닌 서버 컨텍스트에서 실행되므로 `auth.uid()`를 쓸 수 없다. 대신 **T2 wrapper(F2)가 `auth.uid()`를 넣어 호출**하고, 이 함수 자체는 `anon`·`authenticated`에 EXECUTE를 주지 않는다(§10) → 클라이언트가 임의 `p_student_id`를 넣을 경로가 없다.
- `p_require_entitlement=true`(F2 경로): 무료질문 자격 또는 활성 구독을 검사한다.
  `false`(구독 확정 경로): 구독이 방금 확정됐으므로 자격 재검사를 건너뛴다.
- `INSERT … ON CONFLICT (student_id, mentor_id) DO NOTHING` + 재조회. 근거: `uq_msr_pair(student_id, mentor_id)` UNIQUE INDEX 실측 존재. 현행 웹의 "INSERT → 23505 감지 → 재조회" 애플리케이션 처리(실측)를 DB 원자 연산으로 대체한다.
- 컬럼 프로빙을 하지 않는다 — `mentor_student_rooms` 컬럼은 `id, student_id, mentor_id, payment_id, subscription_id, created_at, updated_at`으로 실측 확정됐다.
- 반환: `{ok:true, room_id, created, entitlement}` / `{ok:false, code}`.
- `SECURITY DEFINER`, `SET search_path = ''`.

### F11 `core_private.record_cash_topup_v2` — §7.2 결정 (W3 해소)

```sql
core_private.record_cash_topup_v2(
  p_user_id uuid, p_amount_cents bigint,
  p_idempotency_key text, p_order_ref text
) RETURNS jsonb
```

- 기존 `public.record_cash_topup(uuid,bigint,text)`를 **제자리에서 바꾸지 않는다.** 3인자 함수와 기존 원장 행은 그대로 둔다(추가형 원칙).
- 동작:
  1. 입력 검증(기존과 동일): `p_user_id` 필수, `p_idempotency_key` 필수(trim 후 비어있지 않음), `0 < p_amount_cents <= 1000000000`
  2. `p_order_ref`는 필수. 형식은 `cash-{uuid}-{digits}`(Toss `orderId` 형식, 실측 정규식 `^cash-(.+)-(\d+)$`)를 만족해야 한다. 불만족 시 `ORDER_REF_INVALID`.
  3. `p_order_ref`에서 파싱한 uuid가 `p_user_id`와 **일치해야 한다**. 불일치 시 `ORDER_REF_OWNER_MISMATCH` — 원장 단계에서도 소유자를 재검증한다(현재는 웹 코드만 검증).
  4. `INSERT INTO public.cash_ledger (user_id, delta_cents, reason, ref_type, ref_id, ref_text, idempotency_key) VALUES (…, 'cash_topup', 'topup', NULL, p_order_ref, p_idempotency_key) ON CONFLICT (idempotency_key) DO NOTHING`
  5. 신규 0건이면 `{ok:true, duplicate:true}` 반환 후 종료(지갑 미변경) — 기존 함수의 조용한 `return`을 **명시적 결과로 승격**한다.
  6. 지갑 upsert + 잔액 가산. `row_count=0`이면 `CASH_WALLET_UPSERT_FAILED`.
- 반환: `{ok:true, contract_version:1, duplicate:false, ledger_id, balance_cents}` / `{ok:true, …, duplicate:true}` / `{ok:false, contract_version:1, code}`.
- `SECURITY DEFINER`, `SET search_path = ''`.

### F12 `core_private.subscription_checkout_confirm_v2` — XW-04 해소

```sql
core_private.subscription_checkout_confirm_v2(
  p_payment_id uuid, p_plan_id uuid,
  p_expected_amount_cents integer,
  p_idempotency_key text DEFAULT NULL
) RETURNS jsonb
```

- 기존 `public.confirm_subscription_checkout(uuid,uuid,text)`를 **대체하지 않고 감싼다.** 기존 함수는 그대로 유지한다.
- 추가하는 것 **딱 두 가지**:
  1. **금액 결속.** `mentor_plans.amount_cents`를 `FOR UPDATE`로 읽어 `p_expected_amount_cents`와 비교한다. 다르면 **차감 없이** `{ok:false, code:'PLAN_AMOUNT_CHANGED', expected_amount_cents, actual_amount_cents}`를 반환한다. 웹은 이 코드를 받으면 학생에게 새 금액을 다시 확인시킨다.
  2. **envelope 정규화.** 기존 함수가 `raise`하는 17종 코드(§3.3 A)를 잡아 `{ok:false, code}`로 변환한다. 예상 밖 오류는 전파한다.

#### F12 필수 실행 순서 (이 순서를 벗어나면 교착 또는 멱등 파손이 발생한다)

```
1) public.payments FOR UPDATE (p_payment_id)          -- §12.2 선언 순서 준수
2) 재생 판정: payments.status 가 succeeded 계열
     ('succeeded','paid','success','complete','captured') 이면
     → 금액 비교를 건너뛰고 즉시 정본에 위임한다 (아래 [C4] 참조)
3) pg_advisory_xact_lock(hashtext(student_id), hashtext(mentor_id))
4) public.mentor_plans FOR UPDATE (p_plan_id)
5) amount_cents 와 p_expected_amount_cents 비교 → 불일치면 PLAN_AMOUNT_CHANGED 반환(차감 0)
6) 정본 public.confirm_subscription_checkout(p_payment_id, p_plan_id, p_idempotency_key) 호출
7) 정본이 raise 하면 잡아서 envelope 로 변환
```

**[C3] 잠금 순서 — `payments`가 먼저다.** 초안은 "`mentor_plans`를 먼저 잠근 뒤 정본을 호출한다"고 규정했으나, 이는 §12.2가 "반드시" 지키라고 고정한 순서(`payments` → advisory → `mentor_plans`)의 **역순**이다. §10.5·§18.2대로 레거시 3인자 함수는 계속 살아 있고 §20.4 C8 전까지 웹이 그것을 직접 호출하므로, 전환 기간에 F12(`mentor_plans`→`payments`)와 레거시(`payments`→`mentor_plans`)가 같은 (payment, plan) 쌍에 동시 진입하면 **교착(40P01)** 이 난다. 위 순서는 `payments`를 먼저 잡으므로 레거시와 순서가 일치해 교착이 성립하지 않는다.
TOCTOU 차단력은 그대로다 — 4)에서 잡은 `mentor_plans` 잠금을 5)~6) 내내 **같은 트랜잭션에서 유지**하므로, 비교 시점과 정본의 차감 시점 사이에 멘토의 UPDATE가 끼어들 수 없다(멘토의 UPDATE는 대기한다). 정본이 같은 행을 다시 `FOR UPDATE`하는 것은 동일 트랜잭션이라 무해하다.

**[C4] 멱등 재생은 금액 검사보다 먼저다.** 정본은 `payments.status`가 succeeded 계열이면 **금액 비교 없이** `{ok:true, idempotent:true, subscription_id, payment_status}`를 반환하는 재생 경로를 갖는다(실측). 그런데 금액 비교를 무조건 먼저 하면, 응답 유실 후 재시도(§12.5) 사이에 멘토가 가격을 바꿨을 때 **이미 성공한 구독의 재시도가 `PLAN_AMOUNT_CHANGED` 실패로 뒤집힌다** — §8.2의 "멱등 재생은 성공"과 정면 충돌한다. 따라서 2)에서 재생을 먼저 판정하고, 재생이면 `p_expected_amount_cents`를 **평가하지 않는다.**
- 반환 성공: 기존 함수 반환 + `contract_version:1` (`{ok:true, subscription_id, payment_status, amount_cents, reactivated}` 또는 `{ok:true, idempotent:true, subscription_id, payment_status}`).
- `SECURITY DEFINER`, `SET search_path = ''`.

---

## 8. 각 함수의 성공·실패 반환 envelope `[TO-BE]`

### 8.1 고정 envelope

모든 신규 함수(F0 제외 — 스칼라 반환)는 **jsonb 단일 객체**를 반환한다.

```json
// 성공
{ "ok": true,  "contract_version": 1, "<도메인 필드>": "…" }
// 예상 가능한 도메인 거부
{ "ok": false, "contract_version": 1, "code": "STABLE_DOMAIN_CODE", "<보조 필드>": "…" }
```

- `contract_version`은 **정수 `1`** 로 시작한다. 필드 추가는 버전을 올리지 않고, **필드 제거·의미 변경은 버전을 올린다.**
- `ok:false`에는 항상 `code`가 있다. `message`는 **선택**이며 사용자 노출 문구로 쓰지 않는다(디버깅용). 사용자 문구는 웹이 코드→문구 매핑으로 만든다(현행 `CONFIRM_ERROR_MESSAGES` 패턴 유지).
- `api_app_v1` envelope와 **동일 형상**이다(앱 계약 §3.3) → 공용 기능에서 클라이언트 분기 로직이 갈라지지 않는다.

### 8.2 오류를 성공으로 바꾸지 않는다 (원칙 §6.11)

| 상황 | 처리 |
|---|---|
| 예상 가능한 도메인 거부 | `{ok:false, code}` envelope |
| 사전에 없는 SQL 예외 | **그대로 전파**(PostgREST 4xx/5xx). 삼키지 않는다 |
| statement/lock timeout | 전파 |
| 연결 실패 | 전파 |
| 멱등 재생(정상) | `{ok:true, …, duplicate:true}` 또는 `idempotent_replay:true` — **성공이지만 재생임을 반드시 표시** |

웹은 `ok` 필드가 없는 응답을 **성공으로 간주해서는 안 된다**(§21 T-CON-04).

### 8.3 함수별 반환 필드 요약

| 함수 | 성공 필드 | 멱등·특수 |
|---|---|---|
| F1 | `used, limit, remaining, can_ask, plan_tier, week_start, week_end` | — |
| F2 | `room_id, created, entitlement` | `created:false` = 기존 방 재사용 |
| F3 | `thread_id, message_id, path, used_free_quota` | — |
| F4 | `post_id, idempotent_replay` | `idempotent_replay:true` |
| F5 | `post_id, updated_at, removed_image_refs` | `UPDATE_CONFLICT` |
| F6 | `post_id, deleted_at` | 이미 삭제면 `ok:true` + `already_deleted:true` |
| F7 | `updated_at` | — |
| F8 | `updated[], unchanged[]` | 변경 없으면 `updated:[]` |
| F9 | `state, cancelable_until, job_id` | — |
| F10 | `room_id, created, entitlement` | — |
| F11 | `duplicate, ledger_id, balance_cents` | `duplicate:true` |
| F12 | `subscription_id, payment_status, amount_cents, reactivated` | `idempotent:true` |

---

## 9. 안정 오류코드 사전 `[TO-BE]`

### 9.1 표기 규약

- **모든 신규 코드는 `UPPER_SNAKE_CASE`** 다. IQ escrow 계열의 `lowercase_snake`(실측 XW-07)는 신규 계약에 쓰지 않는다.
- 코드는 **추가만** 한다. 기존 코드의 의미를 바꾸지 않는다.
- 웹·앱이 같은 상황에서 **같은 코드**를 받는다.

### 9.2 공통 코드 (전 함수 공유)

| code | 의미 | 클라이언트 처리 |
|---|---|---|
| `AUTH_REQUIRED` | 세션 없음 | 로그인 유도 |
| `ROLE_NOT_STUDENT` | 학생 아님 | CTA 숨김 |
| `ROLE_NOT_MENTOR` | 멘토 아님 | CTA 숨김 |
| `ROLE_NOT_ALLOWED` | 학생·멘토 아님 | CTA 숨김 |
| `ACCOUNT_BANNED` | 영구 제한 | 차단 화면 |
| `ACCOUNT_SUSPENDED` | 일시 제한 | 차단 화면 |
| `ACCOUNT_DELETION_IN_PROGRESS` | 탈퇴 처리 중 write-block | 차단 화면 |

### 9.3 질문방·무료질문

| code | 의미 | 정본 대응 |
|---|---|---|
| `MENTOR_ID_REQUIRED` | 인자 누락 | 신규 |
| `MENTOR_NOT_FOUND` | 멘토 없음 | 신규 |
| `MENTOR_NOT_APPROVED` | 미승인 멘토 | 정본 raise 동일명 |
| `BLOCKED` | 상호 차단 | 정본 raise 동일명 |
| `FREE_QUOTA_EXPIRED` | 가입 7일 경과 | 정본 `FREE_QUOTA_EXPIRED` **+ 트리거 `FREE_QUESTION_EXPIRED` 수렴** |
| `FREE_QUOTA_TOTAL_EXHAUSTED` | 전역 7회 소진 | 정본 동일명 **+ 트리거 `FREE_QUESTION_TOTAL_LIMIT` 수렴** |
| `FREE_QUOTA_MENTOR_EXHAUSTED` | 멘토별 3회 소진 | 정본 동일명 **+ 트리거 `FREE_QUESTION_PER_MENTOR_LIMIT` 수렴** |
| `FREE_QUOTA_STUDENT_NOT_FOUND` | 학생 행 없음 | 트리거 `FREE_QUESTION_STUDENT_NOT_FOUND` 수렴 |
| `ROOM_ENSURE_FAILED` | 최종 방 확보 실패 | 신규(재시도 가능) |
| `ROOM_NOT_FOUND` | 방 없음 | 정본 raise 동일명 |
| `NOT_ROOM_PARTY` | 방 당사자 아님 | 정본 raise 동일명 |
| `MENTOR_CANNOT_CREATE_THREAD` | 멘토는 스레드 생성 불가 | 정본 raise 동일명 |
| `TITLE_REQUIRED` | 제목 없음 | 정본 raise 동일명 |
| `WEEKLY_LIMIT_EXHAUSTED` | 주간 한도 소진 | 정본 raise 동일명 |
| **`SUBSCRIPTION_REFUND_PENDING`** | 구독 환불 진행 중 | 정본 raise 동일명. **`api_app_v1` §4.3 목록에 누락된 코드**(§3.7 #5) — 앱 계약도 이 코드를 처리해야 한다 |

### 9.4 커뮤니티 (앱 계약 §6.4와 동일 — 웹도 같은 코드를 쓴다)

`TITLE_REQUIRED`, `BODY_TOO_SHORT`, `CATEGORY_INVALID`, `POLICY_RESTRICTED`, `IMAGE_COUNT_EXCEEDED`, `IMAGE_REF_INVALID`, `IMAGE_NOT_OWNED`, `IMAGE_OBJECT_NOT_FOUND`, `IMAGE_MIME_NOT_ALLOWED`, `IMAGE_SIZE_EXCEEDED`, `POST_NOT_FOUND_OR_NOT_OWNED`, `UPDATE_CONFLICT`

- `CATEGORY_INVALID` 허용값: `study|school|career|college|free` (앱 계약과 동일).
- `BODY_TOO_SHORT`: 공개 글 본문 10자 미만.

### 9.5 멘토 프로필·요금제 (신규)

| code | 의미 | 보조 필드 |
|---|---|---|
| `MENTOR_PROFILE_NOT_FOUND` | 프로필 행 없음 | |
| `UNIVERSITY_NAME_REQUIRED` | 대학명 필수 | |
| `DEPARTMENT_NAME_REQUIRED` | 학과명 필수 | |
| `PROFILE_IMAGE_REF_INVALID` | 아바타 ref 형식·소유 불일치 | |
| **`PLAN_PRICE_OUT_OF_BAND`** | 가격 밴드 밖 | `tier`, `min_cash_krw`, `max_cash_krw`, `given_cash_krw` |
| `PLAN_PRICE_INVALID` | 1캐시 미만·비정수·비수치 | `tier` |
| `PLAN_TIER_INVALID` | tier가 3종 밖 | `tier` |

### 9.6 자금·결제 (신규 + 정본 승격)

| code | 의미 | 보조 필드 | 출처 |
|---|---|---|---|
| **`PLAN_AMOUNT_CHANGED`** | 확정 시점 플랜 금액이 학생 동의 금액과 다름 | `expected_amount_cents`, `actual_amount_cents` | 신규(XW-04) |
| **`ORDER_REF_INVALID`** | Toss orderId 형식 아님 | | 신규(F11) |
| **`ORDER_REF_OWNER_MISMATCH`** | orderId의 uid ≠ 원장 대상 uid | | 신규(F11) |
| `CASH_INSUFFICIENT` | 잔액 부족 | `balance_cents` | 정본 envelope 동일명 |
| `CASH_WALLET_UPSERT_FAILED` | 지갑 갱신 0행 | | 정본 raise 승격 |
| `PAYMENT_NOT_FOUND` / `PAYMENT_NO_USER` / `PAYMENT_NO_MENTOR` / `PAYMENT_KIND_INVALID` / `PAYMENT_PROCESSING` / `PAYMENT_NOT_PENDING` / `PAYMENT_STATE_UNEXPECTED` / `PAYMENT_STALE` | 결제 행 상태 | | 정본 raise → envelope 승격(F12) |
| `PLAN_NOT_FOUND` / `PLAN_MENTOR_MISMATCH` / `PLAN_AMOUNT_INVALID` / `PLAN_INACTIVE` | 플랜 상태 | | 동일 |
| `MENTOR_NOT_OPEN_FOR_SUBSCRIPTIONS` / `MENTOR_CAP_EXCEEDED` | 멘토 수용 상태 | | 동일 |
| `SUCCEEDED_NO_SUBSCRIPTION` / `SUCCEEDED_NO_LEDGER` / `LEDGER_FIELD_MISMATCH` / `FINANCIAL_WRITE_ERROR` | 정합성 이상 | `anomaly_id` | 정본 envelope 유지 |

### 9.7 계정 탈퇴 (기존 코드 유지)

`FORFEIT_CONSENT_REQUIRED`(+`balance_cents`), `FORFEIT_CONSENT_STALE`, `ALREADY_COMPLETED`, `CANCEL_WINDOW_PASSED`, `NOT_CANCELABLE`, `LEGACY_FORFEIT_LEDGER_PRESENT`

### 9.8 레거시 → 신규 코드 매핑표 (구현자용)

| 레거시(실측) | 형식 | 신규 코드 | 변환 위치 |
|---|---|---|---|
| `FREE_QUESTION_EXPIRED` (P0003) | 트리거 raise | `FREE_QUOTA_EXPIRED` | F3 |
| `FREE_QUESTION_TOTAL_LIMIT` (P0002) | 트리거 raise | `FREE_QUOTA_TOTAL_EXHAUSTED` | F3 |
| `FREE_QUESTION_PER_MENTOR_LIMIT` (P0001) | 트리거 raise | `FREE_QUOTA_MENTOR_EXHAUSTED` | F3 |
| `FREE_QUESTION_STUDENT_NOT_FOUND` (P0003) | 트리거 raise | `FREE_QUOTA_STUDENT_NOT_FOUND` | F3 |
| `insufficient_cash` | composite lowercase | `CASH_INSUFFICIENT` | (IQ 신규 wrapper 미도입 — S3 이월, §23 U-05) |
| `not_available` / `already_released` / `already_refunded` / `not_answered` / `hold_missing` / `mentor_missing` / `invalid_payout` / `mentor_subject_not_met` / `mentor_qualification_not_met` / `mentor_school_verification_required` | composite lowercase | 대문자 동명(`NOT_AVAILABLE` 등) | S3 이월 |
| `qna_*` raise **14종** | raise UPPER | 동명 유지 | F3 |
| `confirm_subscription_checkout` raise 17종 | raise UPPER | 동명 유지 | F12 |

> **S2 범위 명시**: IQ escrow의 lowercase 코드 정규화는 신규 wrapper가 필요하고 앱이 현재 그 함수들을 직접 쓰므로(앱 RPC 27종에 포함) **S2에서 하지 않는다.** §23 U-05로 이월하고, S2에서는 표기 불일치를 **문서화만** 한다.

---

## 10. schema/table/view/function별 정확한 GRANT·REVOKE 표 `[TO-BE]`

> "service_role이면 다 된다"는 설명을 쓰지 않는다. **신규 스키마에는 Supabase 기본 권한이 적용되지 않으므로** 아래 GRANT를 빠뜨리면 해당 경로가 즉시 깨진다.

### 10.1 스키마

| 대상 | PUBLIC | anon | authenticated | service_role |
|---|---|---|---|---|
| `SCHEMA api_web_v1` | REVOKE ALL | **USAGE** | **USAGE** | **USAGE** |
| `SCHEMA core_private` | REVOKE ALL | — (부여 안 함) | — (부여 안 함) | **USAGE** |

### 10.2 View

| view | PUBLIC | anon | authenticated | service_role | 비고 |
|---|---|---|---|---|---|
| `api_web_v1.community_posts_v1` | REVOKE ALL | **SELECT** | **SELECT** | SELECT | anon = 비로그인 게시판 열람 |
| `api_web_v1.community_comments_v1` | REVOKE ALL | **SELECT** | **SELECT** | SELECT | |
| `api_web_v1.mentor_directory_v1` | REVOKE ALL | **SELECT** | **SELECT** | SELECT | 유일한 SECDEF view |
| `api_web_v1.my_wallet_v1` | REVOKE ALL | — | **SELECT** | SELECT | |
| `api_web_v1.my_cash_ledger_v1` | REVOKE ALL | — | **SELECT** | SELECT | |
| `api_web_v1.my_subscriptions_v1` | REVOKE ALL | — | **SELECT** | SELECT | |
| `api_web_v1.mentor_settlement_v1` | REVOKE ALL | — | **SELECT** | SELECT | |

모든 view에 `INSERT`/`UPDATE`/`DELETE`는 **어떤 역할에도 부여하지 않는다.**

> **`service_role` SELECT의 의미(주의).** V4~V7은 `security_invoker = true`이고 `service_role`은 `BYPASSRLS`다. 따라서 **service_role이 이 view들을 조회하면 "본인 것"이 아니라 전 사용자 행이 반환된다.** 이는 의도된 동작이며(서버 배치·관리자 조회가 필요할 수 있다), 대신 다음을 계약으로 못박는다:
> - 웹 서버 코드는 **사용자 데이터를 보여주기 위해 V4~V7을 `service_role`로 조회하지 않는다.** 사용자 표시용 조회는 항상 세션 클라이언트로 한다.
> - service_role로 조회할 경우 **호출부가 명시적으로 `user_id`/`mentor_id`를 필터**해야 한다. view가 걸러 줄 것이라고 가정하지 않는다.
> - §21 **T-PERM-13**이 이 성질을 문서화된 사실로 고정한다(회귀가 아니라 계약임을 표시).

```sql
REVOKE ALL ON ALL TABLES IN SCHEMA api_web_v1 FROM PUBLIC;
GRANT SELECT ON api_web_v1.community_posts_v1,
               api_web_v1.community_comments_v1,
               api_web_v1.mentor_directory_v1        TO anon, authenticated, service_role;
GRANT SELECT ON api_web_v1.my_wallet_v1,
               api_web_v1.my_cash_ledger_v1,
               api_web_v1.my_subscriptions_v1,
               api_web_v1.mentor_settlement_v1       TO authenticated, service_role;
```

### 10.3 Function

| function (정확한 인자 타입) | 계층 | PUBLIC | anon | authenticated | service_role |
|---|---|---|---|---|---|
| `api_web_v1.user_display_label(uuid)` | 보조 | REVOKE | **EXECUTE** | **EXECUTE** | EXECUTE |
| `api_web_v1.user_display_role(uuid)` | 보조 | REVOKE | **EXECUTE** | **EXECUTE** | EXECUTE |
| `api_web_v1.weekly_question_usage_self(uuid)` | T2 | REVOKE | — | **EXECUTE** | EXECUTE |
| `api_web_v1.ensure_free_question_room(uuid)` | T2 | REVOKE | — | **EXECUTE** | EXECUTE |
| `api_web_v1.qna_create_question_thread(uuid,text,text,text,text)` | T2 | REVOKE | — | **EXECUTE** | EXECUTE |
| `api_web_v1.community_post_create(text,text,text,text[],text,uuid)` | T2 | REVOKE | — | **EXECUTE** | EXECUTE |
| `api_web_v1.community_post_update(uuid,text,text,text,text[],text,timestamptz)` | T2 | REVOKE | — | **EXECUTE** | EXECUTE |
| `api_web_v1.community_post_soft_delete(uuid)` | T2 | REVOKE | — | **EXECUTE** | EXECUTE |
| `api_web_v1.mentor_profile_update_self(text,text,text,text[],text,text,text,text,boolean)` | T2 | REVOKE | — | **EXECUTE** | EXECUTE |
| `api_web_v1.mentor_plan_prices_set_self(integer,integer,integer)` | T2 | REVOKE | — | **EXECUTE** | EXECUTE |
| `api_web_v1.account_deletion_status_self()` | T2 | REVOKE | — | **EXECUTE** | EXECUTE |
| `core_private.ensure_student_mentor_room(uuid,uuid,uuid,uuid,boolean)` | T4a/T5 | REVOKE | — | — | **EXECUTE** |
| `core_private.record_cash_topup_v2(uuid,bigint,text,text)` | T4a | REVOKE | — | — | **EXECUTE** |
| `core_private.subscription_checkout_confirm_v2(uuid,uuid,integer,text)` | T4a | REVOKE | — | — | **EXECUTE** |

```sql
-- 명시 REVOKE (default privileges 와 이중 방어)
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA api_web_v1  FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA core_private FROM PUBLIC;

-- T1/T2 보조
GRANT EXECUTE ON FUNCTION api_web_v1.user_display_label(uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION api_web_v1.user_display_role(uuid)  TO anon, authenticated, service_role;

-- T2
GRANT EXECUTE ON FUNCTION api_web_v1.weekly_question_usage_self(uuid)                                      TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION api_web_v1.ensure_free_question_room(uuid)                                        TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION api_web_v1.qna_create_question_thread(uuid,text,text,text,text)                   TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION api_web_v1.community_post_create(text,text,text,text[],text,uuid)                 TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION api_web_v1.community_post_update(uuid,text,text,text,text[],text,timestamptz)     TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION api_web_v1.community_post_soft_delete(uuid)                                       TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION api_web_v1.mentor_profile_update_self(text,text,text,text[],text,text,text,text,boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION api_web_v1.mentor_plan_prices_set_self(integer,integer,integer)                   TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION api_web_v1.account_deletion_status_self()                                         TO authenticated, service_role;

-- T4a/T5 (service_role 만)
GRANT EXECUTE ON FUNCTION core_private.ensure_student_mentor_room(uuid,uuid,uuid,uuid,boolean)              TO service_role;
GRANT EXECUTE ON FUNCTION core_private.record_cash_topup_v2(uuid,bigint,text,text)                          TO service_role;
GRANT EXECUTE ON FUNCTION core_private.subscription_checkout_confirm_v2(uuid,uuid,integer,text)             TO service_role;
```

> **설계 정정 (F0 배치).** 라벨 헬퍼 2종은 `core_private`가 아니라 **`api_web_v1`에 둔다.**
>
> 초안은 "`core_private`에 두고 EXECUTE만 부여하되 스키마 USAGE를 주지 않으면, view 내부 평가는 되고 직접 호출은 막힌다"고 설계했다. **이 전제를 채택하지 않는다.** `security_invoker = true` view가 참조하는 함수의 권한 검사 주체(호출자 vs view 소유자)와, 저장된 view가 함수 OID를 이미 해석해 둔 상태에서 **스키마 USAGE가 실행 시점에 재검사되는지**는 버전·경로에 따라 달라질 수 있는 미묘한 동작이다. 계약이 이런 미묘함에 의존하면 구현자가 추측하게 되고(원칙 §6.15 위반), 최악의 경우 **V2·V6·V7 조회가 런타임에 권한 오류로 실패**한다.
>
> 따라서 두 함수를 `api_web_v1`(이미 `anon`·`authenticated`에 USAGE가 있는 스키마)에 두어 **권한 경로를 단순하고 명시적으로** 만든다. `core_private`에는 `anon`·`authenticated` USAGE를 **끝까지 주지 않는다**(§10.1 유지) — 따라서 F10·F11·F12는 그대로 클라이언트 도달 불가다.
>
> **수용한 트레이드오프**: `api_web_v1.user_display_label(uuid)`가 클라이언트에서 직접 호출 가능해지므로, 임의 uuid → nickname 조회가 열린다. 노출 범위는 **nickname 한 컬럼**이며 `full_name`·`email`·`birth_date`는 반환하지 않는다(§11.4). 게시글 작성자의 uuid↔nickname 대응은 V1이 `author_id`와 `author_label`을 함께 제공하므로 **이미 공개**다. 잔여 증분은 "글을 쓴 적 없는 사용자의 uuid를 이미 알고 있을 때 nickname을 얻을 수 있다"에 한정된다.
> 이 증분마저 없애려면 `comments`에 `author_label`을 비정규화(`community_posts`와 동일 패턴)해야 하며, 이는 트리거·백필이 필요하므로 **S3 후보로 이월**한다(§23 U-11).

### 10.4 신규 컬럼 (§7.2 결정)

| 대상 | 변경 | 권한 |
|---|---|---|
| `public.cash_ledger.ref_text text NULL` | **추가**(nullable, 기본값 없음) | 기존 테이블 GRANT를 따른다. `cash_ledger`는 authenticated **SELECT 정책만** 존재하므로 별도 조정 불필요 |
| `idx_cash_ledger_ref_text` | `CREATE INDEX … ON public.cash_ledger (ref_text) WHERE ref_text IS NOT NULL` | 정산·대조 조회용 부분 인덱스 |

기존 행은 백필하지 않는다(`NULL` 유지). 조회 호환은 V5의 `order_ref` COALESCE 규약이 담당한다.

### 10.5 레거시 표면 회수 — **S2에서 하지 않는 것**

| 대상 | S2 조치 | 근거 |
|---|---|---|
| `public` 함수 194종 | **회수 0건** | 구버전 앱 종료 전 금지(앱 계약 §7.4 T3 일정) |
| `public` 테이블 GRANT | **회수 0건** | 동일 |
| `public.account_deletion_request_self_consented(integer,boolean,bigint)` | `authenticated` EXECUTE **유지** | 앱 계약 T0 상태. T3에서만 회수 |
| Data API `public` 노출 | **유지** | 앱·구버전 웹 호환 |

### 10.6 조건부 회수 — 웹 전환 완료 후에만 (S2 후반 M9)

아래 2건은 **레거시 앱과 무관한 웹 전용 표면**이므로 앱 cutoff를 기다리지 않는다. 다만 **F7·F8 배포 + 웹 callsite 전환 + 호출 0건 확인이 선행 조건**이다.

| 대상 | 조치 | 해소하는 결함 | 선행 조건 |
|---|---|---|---|
| `public.mentor_profiles` 컬럼 UPDATE | `REVOKE UPDATE (verification_status, cap_limit, payout_bank_name, payout_account_number, activity_status, termination_requested_at, termination_effective_at, pause_started_at, pause_until, pause_reason, last_pause_at, abandonment_flagged_at, student_id_image_url, user_id, created_at) ON public.mentor_profiles FROM authenticated, anon;` | **XW-02 (가)** | F7 배포 + `mentor_profiles.update` 웹 callsite 0건 |
| `public.mentor_profiles` **INSERT** | `REVOKE INSERT ON public.mentor_profiles FROM authenticated, anon;` — 행 생성은 가입 트리거 `handle_new_auth_user`(SECDEF)가 하므로 클라이언트 INSERT는 불필요하다 | **XW-02 (나)** | 웹·앱에서 `mentor_profiles` INSERT 호출 0건 실측. (웹은 `syncAfterSignUpWithSession`의 백업 upsert 경로가 있으므로 **F7 전환 시 이 경로를 함께 제거**해야 한다) |
| `public.mentor_plans` INSERT/UPDATE/**DELETE** | `REVOKE INSERT, UPDATE, DELETE ON public.mentor_plans FROM authenticated, anon;` (SELECT는 유지 — 공개 가격 표시에 필요) | **XW-03** | F8 배포 + `mentor_plans` 쓰기 웹 callsite 0건 |

- **앱 영향 — 실측 확인 완료.** 앱 직접 테이블 24종에 두 테이블이 포함되지만 실제 접근은 **2곳 모두 SELECT**다(§19.4-B). SELECT는 유지하므로 위 회수는 앱을 깨뜨리지 않는다. 다만 지시서 §4가 앱에 허용한 단순 프로필 수정의 **제품 범위 정의**는 별개 문제로 남는다 → §23 **B-07**.
- 컬럼 단위 REVOKE는 `SECURITY DEFINER` 경로에 영향을 주지 않는다(§5.3 주의 3). 관리자 승인 RPC는 계속 동작한다.
- rollback은 동일 컬럼 목록에 `GRANT`를 되돌리는 **별도 migration**으로만 한다(§22).

---

## 11. RLS · `SECURITY DEFINER` · `search_path` 보안 규약 `[TO-BE]`

### 11.1 기본값

| 항목 | 규약 |
|---|---|
| view 기본 | `WITH (security_invoker = true)` + 기반 RLS |
| view 예외 | `mentor_directory_v1`만 `security_invoker = false`. 근거·안전장치를 §6 V3에 명시 |
| function 기본 | 권한 상승이 필요 없으면 `SECURITY INVOKER` |
| function 예외 | 원자 명령·타인 행 참조·RLS 우회가 필요한 경우만 `SECURITY DEFINER` |
| SECDEF 필수 3종 세트 | ① `SET search_path = ''` (**빈 search_path**) ② 모든 객체를 `public.…`/`storage.…`로 **완전 수식** ③ 함수 첫머리에서 호출자·역할·소유권·상태를 **명시 검증** |
| 소유자 | 전 신규 객체를 migration 실행 역할(= DB 소유자)로 고정. 함수 소유자를 개별 사용자로 두지 않는다 |

### 11.2 왜 빈 `search_path`인가 (실측 대비)

- **현재 194개 함수는 전부 `search_path=public`이다**(실측). 빈 문자열이 아니다.
- `search_path=public`은 `public`이 신뢰 가능한 동안에는 안전하지만, `public`에 임의 객체를 만들 수 있는 역할이 있으면 함수 내부 해석이 바뀔 수 있다.
- 신규 객체는 **`SET search_path = ''` + 완전 수식**을 사용한다(원칙 §6.9). 기존 함수의 `search_path`는 S2에서 **바꾸지 않는다**(동작 회귀 위험 > 이득).
- mutable `search_path` 5종(`comment_sync_in_progress`, `notification_cash_label`, `notification_date_label`, `payout_run_items_block_mutation`, `qna_is_direct_untrusted_writer`)은 전부 non-SECDEF 헬퍼·트리거다(실측). S2에서 손대지 않고 §23 U-03으로 기록한다.

### 11.3 사용자 ID 도출 규칙 (원칙 §6.5)

| 계층 | 규칙 |
|---|---|
| T1·T2 | **사용자 ID를 인자로 받지 않는다.** 함수 내부 `auth.uid()`로만 도출. `p_user_id`/`p_student_id`를 받는 T2 계약은 만들지 않는다 |
| T4a·T5 | 세션이 없으므로 ID를 인자로 받는다. 대신 **`anon`·`authenticated`에 EXECUTE를 주지 않는다**(§10.3) |
| T4b | 관리자 신원은 `auth.uid()` + `is_admin()`으로 검증. `p_admin_id` 인자를 신뢰하지 않는다 |

이 규칙이 **XW-01의 근본 원인(임의 `p_student_id` 수용 + anon 실행)** 을 구조적으로 차단한다.

### 11.4 PII 노출 최소화

- `api_web_v1.user_display_label`은 **`nickname`만** 반환한다. `full_name`·`email`·`birth_date`·`grade_level`·`phone` 계열은 어떤 신규 view/function도 반환하지 않는다.
- `mentor_directory_v1`은 `nickname`만 노출하고 `full_name`을 제외한다. **현행 `mentor_directory_list_v2`는 `full_name`을 반환한다**(실측) — 신규 view는 이를 **의도적으로 좁힌다.**
- `user_display_role`은 `admin`에 대해 `NULL`을 반환한다(관리자 신원 비노출).
- V7은 `idempotency_key`·`ledger_id`·`payment_id`를 노출하지 않는다.

### 11.5 계정 상태 게이트 방향 통일 (XW-15 해소)

- 신규 계약의 모든 쓰기 함수는 계정 상태 확인에 **fail-closed**를 적용한다: 상태를 확인할 수 없으면 **거부**하고 `ACCOUNT_STATE_UNVERIFIABLE` 대신 기존 `ACCOUNT_SUSPENDED`가 아니라 **오류를 전파**한다(§8.2 — 예상 밖 실패는 성공으로 바꾸지 않는다).
- 판정식은 정본 `qna_create_question_thread`와 동일하게 고정한다:
  - `lower(coalesce(status,'active')) = 'banned'` → `ACCOUNT_BANNED`
  - `lower(coalesce(status,'active')) = 'suspended'` AND (`suspended_until IS NULL` OR `suspended_until > now()`) → `ACCOUNT_SUSPENDED`
  - `public.account_deletion_write_blocked(auth.uid())` → `ACCOUNT_DELETION_IN_PROGRESS`
- 기존 웹 JS 게이트(`assertAccountActive`)의 fail-open은 **S2에서 코드 수정 대상**이며, DB 계약은 이미 fail-closed이므로 최종 방어는 성립한다.

### 11.6 RLS를 우회하는 신규 객체 목록 (감사용 화이트리스트)

| 객체 | 우회 사유 | 보상 통제 |
|---|---|---|
| `mentor_directory_v1` (SECDEF view) | 타인 `users`·`mentor_profiles` 읽기 | 노출 조건이 view 정의에 하드코딩, 읽기 전용, 컬럼 최소화 |
| `api_web_v1.user_display_label`/`user_display_role` | 타인 `users.nickname`/`role` 읽기 | 반환값이 스칼라 1개(닉네임 또는 역할)로 제한, PII 컬럼 미반환, admin은 `NULL` |
| F1~F9 (SECDEF) | 정본 RPC 호출·타인 행 검증 | `auth.uid()` 도출 + 상태·역할·소유권 검증 |
| F10~F12 (SECDEF) | 자금·상태 확정 | `service_role` EXECUTE 전용 |

이 표에 없는 신규 객체는 RLS를 우회하지 않는다. 표 자체를 §21 **T-PERM-04**가 회귀 감시한다(신규 SECDEF 추가 시 테스트 실패).

---

## 12. 결제·원장·환불·정산의 트랜잭션·lock·멱등 규약 `[TO-BE]`

### 12.1 불변 규칙

1. **원장은 append-only.** `cash_ledger` 행을 UPDATE·DELETE하지 않는다. 정정은 반대 부호 행 추가로만 한다.
2. **모든 자금 이동은 `cash_ledger.idempotency_key` UNIQUE에 의존**한다(실측 제약 `cash_ledger_idempotency_key_key`). `ON CONFLICT (idempotency_key) DO NOTHING` + 신규 여부 판정이 표준 패턴이다.
3. **지갑 갱신은 원장 신규 삽입에 성공한 경우에만** 수행한다. 재생(중복) 경로는 지갑을 건드리지 않는다.
4. **잔액 차감은 조건부 UPDATE**로 한다: `SET balance_cents = balance_cents - :amt WHERE user_id = :uid AND balance_cents >= :amt`. `row_count=0`이면 부족으로 판정한다(실측 `create_individual_question_with_hold_v2` 패턴).
5. 자금 함수는 전부 `service_role` EXECUTE 전용이다. 신규 계약도 이를 유지한다.
6. **금액은 클라이언트가 정하지 않는다.** 서버가 정본(`mentor_plans`·`mentor_individual_question_pricing`·패키지 allowlist)에서 재계산한다.

### 12.2 lock 순서 (교착 방지 — 실측 순서를 계약으로 고정)

구독 확정 경로의 잠금 순서는 **반드시 아래 순서**를 지킨다(현행 `confirm_subscription_checkout` 실측 순서와 동일):

```
1) public.payments            FOR UPDATE   (p_payment_id)
2) pg_advisory_xact_lock(hashtext(student_id), hashtext(mentor_id))
3) public.mentor_plans        FOR UPDATE   (p_plan_id)
4) public.users               FOR UPDATE   (student_id)
5) public.mentor_profiles     FOR UPDATE   (mentor_id)
6) public.cash_wallets        (record_subscription_cash_debit 내부)
```

- F12도 **위 순서를 그대로 따른다**: `payments` → advisory → `mentor_plans`. `mentor_plans` 잠금을 정본 호출 전에 취득해 비교~차감 구간 내내 유지하므로 XW-04의 TOCTOU가 닫히면서도, 레거시 직접 호출과 **잠금 순서가 일치**해 전환기 교착이 발생하지 않는다(§7 F12 [C3]).
- 계정 탈퇴는 `pg_advisory_xact_lock(hashtextextended('account_deletion_self:'||uid, 0))`를 사용한다(실측). 다른 자금 경로와 advisory 키 공간이 겹치지 않는다.
- IQ escrow는 `individual_questions FOR UPDATE` → `cash_wallets FOR UPDATE` 순서다(실측).

### 12.3 흐름별 계약표

| 흐름 | 함수 | 멱등키 | lock | 상태 전이 | 원장 참조 | 주요 오류코드 |
|---|---|---|---|---|---|---|
| Toss 결제 주문 생성 | (웹 JS) `orderId = cash-{uid}-{ts}` | orderId 자체 | — | — | — | `invalid_order`, `invalid_package` |
| Toss 결제 확인 | (웹 JS) `confirmCashTopupCore` | orderId | — | — | — | `payment_not_done`, `order_mismatch`, `amount_mismatch`, `order_owner_mismatch` |
| **캐시 충전 원장** | **F11** `core_private.record_cash_topup_v2` | `p_idempotency_key`(=orderId) | `cash_wallets` upsert | — | **`ref_text` = orderId** (신규) | `ORDER_REF_INVALID`, `ORDER_REF_OWNER_MISMATCH`, `CASH_WALLET_UPSERT_FAILED` |
| **구독 checkout 확정** | **F12** `core_private.subscription_checkout_confirm_v2` | `sub_debit_{paymentId}` (원장), `sub_checkout_{paymentId}` | §12.2 순서 | `payments.pending→succeeded`, `subscriptions` upsert `active` | `ref_type='subscriptions'`, `ref_id=subscription_id`, `reason='subscription_payment'` | **`PLAN_AMOUNT_CHANGED`**, `CASH_INSUFFICIENT`, `MENTOR_CAP_EXCEEDED`, `PAYMENT_STALE`, `LEDGER_FIELD_MISMATCH` |
| 구독 갱신 | 기존 `process_subscription_renewal` (변경 없음) | `sub_renewal:{subId}:{YYYY-MM-DD}` | 내부 | 기간 이동 / `past_due` | `subscription_billing_events` UNIQUE | `ok/code/message` 반환열 |
| 구독 캐시 차감 | 기존 `record_subscription_cash_debit` | `sub_debit_{paymentId}` | — | — | 위와 동일 | — |
| 구독 rollback | 기존 `record_subscription_cash_rollback` | — | — | — | — | **웹 호출점 0건**(XW-17) — 유지·미사용 |
| IQ hold | 기존 `create_individual_question_with_hold(_v2)` | `iq_hold:{qid}`, `create_idempotency_key` | 지갑 `FOR UPDATE` + **lock 후 멱등 재확인** | `→assigned|open` | `ref_type='individual_questions'` | `insufficient_cash`(lowercase — S3 정규화) |
| IQ claim | 기존 `claim_individual_question_v2` | 조건부 UPDATE(CAS) | — | `open→claimed` | — | `not_available`, `mentor_subject_not_met` |
| IQ release | 기존 `release_individual_question_payout` | `iq_payout:{qid}` | `FOR UPDATE` | `answered→released` | 멘토 `floor(price*0.85)` | `not_answered`, `already_refunded` |
| IQ refund | 기존 `refund_individual_question_hold` | `iq_refund:{qid}` | `FOR UPDATE` | `→refunded` | 학생 `+price_cents` | `already_released`, `hold_missing` |
| 맞춤의뢰 hold/refund/payout | 기존 `record_custom_order_escrow_*` | `cash_ledger` UNIQUE | — | — | `ref_type='custom_request_orders'` | — |
| 환불 승인·거절 | 기존 `approve/reject_refund_request_admin` | — | — | `refunds.status` | `billing_event_id` | — |
| 정산 지급 | 기존 `pay_due_payouts_for_run(p_run_date,p_idempotency_key,p_dry_run)` | `p_idempotency_key` | — | `payout_runs`/`payout_run_items` | — | dry-run 기본 |

### 12.4 플랫폼 수수료의 원장 표현 (실측 사실 기록)

- IQ: 학생에게서 `price_cents` 전액을 hold하고, 멘토에게 `floor(price_cents * 0.85)`만 지급한다. **차액 15%는 어떤 지갑에도 입금되지 않는다** — hold와 payout의 차이로 남는다(실측 `release_individual_question_payout` 본문 주석: "플랫폼 15%는 price_cents - v_mentor_cents = hold 차액으로 남김").
- 즉 **플랫폼 수익을 담는 원장 계정(지갑)이 없다.** 총합 검증(sum of `delta_cents` = 0) 방식의 회계 정합성 검사는 현재 스키마에서 성립하지 않는다.
- 이 문서는 이를 **결함으로 판정하지 않는다**(설계 선택). 다만 §21 T-FIN-05에서 "hold - payout = 예상 수수료" 항등식을 검사 대상으로 명시하고, 플랫폼 원장 계정 도입 여부는 §23 U-07로 이월한다.
- `due_payouts` view의 IQ 분기도 동일 공식(`floor(price_cents * 0.85)`, `fee_rate 0.15`)을 쓴다(실측 view 정의).

### 12.5 재시도·중복 호출 전제

| 시나리오 | 계약 |
|---|---|
| 클라이언트 중복 제출 | 동일 멱등키 재사용 → `duplicate:true` / `idempotent_replay:true` 반환. **새 키를 만들지 않는다** |
| 응답 유실 후 재시도 | 동일 멱등키 재전송이 정답. 서버는 기존 결과를 재조회해 반환 |
| 동시 실행 | UNIQUE 제약 + advisory lock + 조건부 UPDATE로 직렬화. 두 번째 호출은 재생 경로로 수렴 |
| cron 중복 기동 | 날짜 포함 멱등키(`sub_renewal:{id}:{date}`)로 1일 1회 보장 |
| 부분 실패 | 원장 삽입 성공 + 지갑 갱신 실패 = **예외 전파**(트랜잭션 롤백). 조용한 성공 금지 |

---

## 13. 질문방·메시지·첨부 계약 `[TO-BE]`

### 13.1 방(room) 확보

- **방 생성은 클라이언트에서 불가능하다**(RLS INSERT 정책 부재 — 실측). 이 사실을 유지한다.
- 신규 경로는 **F2 → F10** 한 가지로 통일한다. 기존 웹 JS 경로(`ensureFreeQuestionRoomForStudent` → `ensureMentorStudentRoom`, service_role + 컬럼 프로빙 + 23505 재조회)는 **F10으로 대체**한다(§17 매핑).
- 원자성: `INSERT … ON CONFLICT (student_id, mentor_id) DO NOTHING` + 재조회. 근거 = `uq_msr_pair` UNIQUE INDEX 실측.
- 동시 호출에서 방은 **정확히 1개**만 존재해야 한다(§21 T-CONC-01).
- 컬럼 프로빙 금지: `mentor_student_rooms`의 컬럼은 `id, student_id, mentor_id, payment_id, subscription_id, created_at, updated_at`으로 확정됐다.

### 13.2 스레드 생성·무료질문 소비

- 정본 `public.qna_create_question_thread`의 **판정 로직을 복제하지 않는다.** F3는 호출 + envelope 변환만 한다.
- 자격 분기(실측 유지): 활성 구독 있으면 `subscription` 경로(환불 진행 차단 → 주간 한도), 없으면 `free` 경로(가입 7일 · 전역 7회 · 멘토별 3회).
- 무료 소비는 스레드 생성과 **같은 트랜잭션**에서 `free_question_usage(student_id, mentor_id, thread_id)` INSERT로 확정된다. `UNIQUE(thread_id)` 실측.
- **방 확보(F2)는 무료질문권을 소비하지 않는다.** 소비는 F3에서만 일어난다. 따라서 F2 성공 후 자격이 바뀌면 F3가 거부한다 — 앱 계약 §4.2와 동일한 2단 구조다.
- XW-08 코드 수렴은 F3의 책임이다(§9.8).

### 13.3 메시지·첨부

- 메시지·확인·오답표시는 기존 `qna_append_message`/`qna_confirm_thread`/`qna_flag_wrong_answer`를 **그대로 유지**한다. 신규 wrapper를 만들지 않는다(측정된 결함 없음).
- 첨부 버킷은 **`question-room-attachments`** 다(테이블 `question_attachments`와 이름이 다름 — §3.7 #9).
- 업로드는 사용자 세션 클라이언트로 하고, Storage RLS 5조건(`user_is_room_party_for_qra_path` AND `qra_thread_writable_for_path` AND `qra_uploader_allowed_for_path` AND `qra_path_upload_eligible` AND `NOT account_deletion_write_blocked`)이 방어한다 — **이 버킷은 이미 엄격하므로 신규 객체를 만들지 않는다.**
- 등록은 `qna_register_attachment` RPC로 일원화하고, 실패 시 방금 올린 객체를 best-effort remove한다(현행 유지).
- 서명 URL은 표시 시점 **3600초**로 재발급하고 저장하지 않는다(현행 유지 → §14 계약).

### 13.4 연결노트

- `connection_notes`의 room FK는 **`mentor_student_room_id`** 다(실측). 신규 객체는 이 이름을 쓴다.
- 컬럼: `id, mentor_student_room_id, body, created_at, updated_at, author_id, author_role, ink_path, ink_thumb_path`.
- `ink_path`/`ink_thumb_path`가 가리키는 `connection-note-ink` 버킷은 **기능 미배선**이다(§3.1). S2에서 배선하지 않는다.

### 13.5 Realtime

- 웹은 Realtime을 **소비하지 않는다**(실측 0건). 재조회 기반(서버 액션 redirect + `revalidatePath`, 클라이언트 `router.refresh()`)을 유지한다.
- publication 3테이블(`question_threads`, `question_messages`, `question_attachments`)은 **앱 전용**이다. 신규 view를 publication에 추가하지 않는다(view는 Realtime 대상이 될 수 없고, 앱은 기존 테이블 구독을 유지한다).
- 앱 계약 Gate 4 체크박스 "Realtime 미수신 시 기존 재조회 fallback 유지"를 침범하지 않는다.

---

## 14. 커뮤니티 · Storage · 서명 URL 계약 `[TO-BE]`

### 14.1 ref 저장 규약 (DB에 영구 URL 금지)

- DB에는 **안정적인 `bucket/path` ref**만 저장한다. 영구 서명 URL을 저장하지 않는다.
- 커뮤니티 게시글 정본 형식: **`community-post-images/{auth.uid()}/{uuid}-{safe_name}.{ext}`** (실측 `lib/community/communityImageRef.ts`).
- 신뢰 조건: `communityImageRefBelongsToUser` = 경로 첫 세그먼트가 `user.id`와 일치. 계약 테스트가 이미 존재한다(`lib/community/__contract__/communityImageRef.contract.test.ts`).
- **읽기 호환**: 레거시로 저장된 7일 서명 `http(s)` URL은 `/community-post-images/` 마커에서 path를 추출해 **재서명**한다. 추출 실패 시 원문을 통과시키되 이미지 하나만 숨기고 구조화 로그를 남긴다(앱 계약 §5.7과 동일).

### 14.2 서명 URL TTL·재서명·캐시 (도메인별 실측값을 계약으로 고정)

| 대상 | TTL | 규약 |
|---|---:|---|
| 커뮤니티 게시글 이미지 | **3600초** | 표시 시점 발급. DB·로컬 영구 저장소에 재저장 금지 |
| 질문방 첨부 | **3600초** | 동일 |
| 개별질문 첨부 | **600초** | 동일 |
| 전역 기본값 | 7일 | **신규 계약에서는 사용하지 않는다.** 도메인별 값을 항상 명시 오버라이드한다 |

- 서명 URL은 **메모리 캐시에만** 둔다. 만료·서명 실패 시 **해당 이미지만 재서명**하고 본문은 계속 표시한다.
- `DEFAULT_TTL_SEC = 7일`(실측)은 위험한 기본값이다. 신규 도메인 코드는 TTL을 **명시 인자로 전달**하는 것을 계약으로 한다(§21 T-STO-03이 기본값 사용을 감시).

### 14.3 업로드 제한·소유권·검증

| 항목 | 값 (실측 bucket 정책과 일치) |
|---|---|
| 최대 장수 | 5 |
| 장당 최대 크기 | 5 MiB (`community-post-images` `file_size_limit=5242880`) |
| 허용 MIME | `image/jpeg`, `image/png`, `image/webp`, `image/gif` |
| 경로 | `{auth.uid()}/{uuid}-{safe_name}.{ext}` |
| `upsert` | `false` |
| DB 저장 ref | `community-post-images/{path}` |

- 클라이언트는 로컬 MIME·확장자·**magic bytes**를 검사하고, Storage bucket 제한을 서버 측 2차 검증으로 사용한다.
- **F4/F5의 finalize 검증**(각 ref마다 전부): 허용 버킷 / path 첫 세그먼트 = `auth.uid()` / `storage.objects`에 실제 존재 / 소유자·MIME·크기 일치 / 개수 ≤ 5.
- 클라이언트가 보낸 `author_id`·`author_role`·`author_label`은 받지 않는다.

### 14.4 멱등·보상 삭제·orphan 정리

- create의 `p_idempotency_key`는 **필수**이며 `(author_id, create_idempotency_key)` 기준으로 멱등이다(UNIQUE INDEX `community_posts_author_idem_key` 실측).
- 멱등 재생 성공은 기존 `post_id` + `idempotent_replay:true`를 반환한다.
- 업로드 중 하나가 실패하면 **그 요청에서 이미 올린 객체를 즉시 삭제**한다.
- DB finalize 실패·응답 불명확이면 이번 요청 신규 객체를 보상 삭제하고, **idempotency key로 재조회**해 성공 여부를 확정한다.
- update 성공은 `removed_image_refs`를 반환한다. 클라이언트는 commit 이후 제거된 구객체를 best-effort 삭제한다.
- **보상 삭제 실패는 사용자 성공을 뒤집지 않는다.** orphan 정리 대상으로 기록한다.
- soft delete는 게시글 행과 이미지 참조를 감사 목적으로 보존한다. 실제 객체 purge는 계정삭제·보존정책 작업이 담당한다.
- 재시도는 **동일 requestId 재사용**이 정답이다. 현행 웹은 성공 redirect 후 remount로 새 UUID를 발급한다(실측) — 이 동작을 유지한다.

### 14.5 웹·앱 동등성 (지시서 §4 필수)

| 항목 | 웹 | 앱 | 동등? |
|---|---|---|---|
| 이미지 읽기 | V1 `image_refs` → 표시 시점 서명 | `api_app_v1.community_posts_v1.image_refs` → `createSignedUrl(path, 3600)` | ✅ **동일 필드명·동일 형식·동일 TTL** |
| 이미지 쓰기 | F4/F5 (최대 5장, 5 MiB, 4종 MIME, UID 경로) | `api_app_v1.community_post_create/update` (동일 제한) | ✅ **동일 계약** |
| ref 형식 | `community-post-images/{uid}/{object}` | 동일 | ✅ |
| 레거시 URL 호환 | path 추출 후 재서명 | 동일 | ✅ |
| 보상 삭제 | 요청 단위 신규 객체 삭제 + orphan 기록 | 동일 | ✅ |
| soft delete | F6 (hard delete 금지) | `community_post_soft_delete` (동일) | ✅ |
| 본문 검증 | 연락처 마스킹만(**금지어 dead code — XW-13**) | 동일 규칙 공유 필수 | ⚠ **앱이 웹과 같은 단일 검증 규칙을 써야 한다.** 앱 전용 약한 규칙 금지(앱 계약 §6.2) |

**동등성 리스크 1건**: 앱 계약 §6.4는 `POLICY_RESTRICTED`(금지 문구·정책 위반)를 오류코드로 두지만, 웹의 금지어 검사는 현재 dead code다(XW-13). 두 표면이 같은 규칙을 쓰려면 **금지어 정책의 존재 여부 자체를 먼저 확정**해야 한다 → §23 blocker **B-04**.

### 14.6 버킷 공개 여부·백업 제한

- `community-post-images`는 `public=false`를 **유지**한다. 어떤 신규 계약도 버킷을 공개로 바꾸지 않는다.
- **XW-06 기록**: `cpi_public_read`·`sfv_public_read`는 버킷 전체 SELECT를 `anon`+`authenticated`에 허용한다. 로그인 사용자는 경로를 알면 임의 객체에 서명 URL을 발급할 수 있다. S2에서 이 정책을 **좁히지 않는다**(웹·앱 이미지 읽기가 이 정책에 의존하고 있어 회귀 위험이 크다). 좁히는 설계는 §23 U-02로 이월한다.
- **Supabase 물리 백업에 Storage 객체가 포함되지 않는다**는 사실은 **S5 제한으로 유지**한다. S5 삭제 전 별도 객체 백업이 필수다.

---

## 15. 계정 탈퇴와 worker 계약 `[TO-BE]`

### 15.1 고정 사항

| 항목 | 계약 |
|---|---|
| 웹 잔액 소멸 동의 | **서버 전용 유지.** `public.account_deletion_request_consented(uuid,integer,boolean,boolean,bigint)` (service_role) 계속 사용 |
| 앱용 consented wrapper | **만들지 않는다.** `api_web_v1`·`api_app_v1` 어디에도 두지 않는다 |
| `public.account_deletion_request_self_consented(integer,boolean,bigint)` | `authenticated` EXECUTE **유지**(T0 상태). 회수는 앱 계약 T3에서만 |
| worker 현재 상태 | **비활성·미스케줄**. `ACCOUNT_DELETION_WORKER_ENABLED` 미설정, `vercel.json` 미등록, `cron.job` 0건 |
| 이번 세션 조치 | **없음.** 구축·등록·활성화·수동 실행 0건 |

### 15.2 웹 탈퇴 관문 (현행 유지 — 계약으로 고정)

1. 기능 플래그 `isAccountDeletionFeatureEnabled()`
2. 세션 확인 → `admin` role은 이 화면에서 거부
3. 고지 동의 `understood` 필수
4. **비밀번호 재인증** — 세션 쿠키를 건드리지 않는 일회용 bare client로 `signInWithPassword` 검증만
5. 사전조건 `checkAccountDeletionPreconditions`
6. 잔액 > 0이면 `forfeitConsent` 필수
7. service_role RPC 호출: 잔액>0이면 `p_forfeit_consent=true` + `p_acknowledged_balance_cents=실측 잔액`, 잔액 0이면 `false`/`null`
8. 성공 시 즉시 파괴 없이 `/account/delete?requested=1`로 이동, **로그아웃하지 않는다**(취소 창 안에서 취소 가능해야 함)

- 취소 창 `CANCELABLE_MINUTES = 30`.
- 오류코드: `FORFEIT_CONSENT_REQUIRED`, `FORFEIT_CONSENT_STALE`, `ALREADY_COMPLETED`, `CANCEL_WINDOW_PASSED`, `NOT_CANCELABLE`.
- 몰수 멱등키 `acct_del_forfeit:{uid}`, 정본 익명화 RPC `account_deletion_forfeit_and_anonymize`(state `storage_purged` 게이트 → 몰수 원장 + 지갑 0화 → 동의 3층 재검증 → `anonymize_user_for_deletion` 호출).

### 15.3 앱 FORFEIT 웹 유도 (경계 재확인)

- 앱은 `public.account_deletion_request_self(integer,boolean)`만 호출한다. 이 함수는 `forfeit_consent=false`·`acknowledged=null` 고정으로 `account_deletion_request_consented`에 위임한다(실측 본문) → 잔액>0이면 항상 `FORFEIT_CONSENT_REQUIRED`.
- 앱 처리 계약(앱 계약 §7.3, 이번 계약에서 변경 없음): 로컬 성공·pending 상태를 만들지 않고, 로그아웃하지 않고, 잔액 안내 후 `WebBridge.openAccountDelete()`로 **`https://ssambership.com/account/delete?src=app`** 을 외부 브라우저에서 연다.
- **웹 수신 측 계약**: `/account/delete`는 `src=app` 쿼리를 받아도 동작이 달라지지 않는다. 동일한 §15.2 관문을 적용한다.
- `FORFEIT_CONSENT_STALE`은 앱 호출 경로에서 도달하지 않지만 방어적으로 같은 웹 유도를 한다.

### 15.4 worker 실행 경로 — GET/POST 경계 (W1)

**현재 사실**: Vercel Cron은 등록 경로를 **GET**으로 호출한다. `/api/cron/account-deletion`은 **POST 전용**이다. 따라서 `vercel.json`에 경로만 추가해도 **작동하지 않는다.**

계약 수준 대안 비교 (**이번 세션에서 구현·등록·활성화하지 않는다**):

| 안 | 내용 | 장점 | 단점·전제 |
|---|---|---|---|
| **(a) GET 러너 추가** | 기존 POST와 **동일한** `CRON_SECRET` timing-safe 검증 + 3중 게이트를 유지한 GET 핸들러를 추가하고 `vercel.json`에 등록 | Vercel Cron 그대로 사용, 인프라 추가 없음 | GET이 부수효과를 갖는다(멱등하지만 의미상 부적절). 브라우저 프리페치·크롤러 노출면 증가 → secret 없으면 401이므로 실질 위험은 낮음 |
| **(b) 인증된 외부 POST 스케줄러** | GitHub Actions cron 등이 `CRON_SECRET`으로 POST 호출 | 메서드 의미 보존, 라우트 변경 0 | 외부 시스템 의존·secret 보관처 추가, 운영 책임자 지정 필요 |
| (c) `pg_cron` + `pg_net` | DB에서 직접 호출 | 인프라 단일화 | **`pg_net` 미설치**(실측 설치 확장 6종 = `pg_cron`, `pg_stat_statements`, `pgcrypto`, `plpgsql`, `supabase_vault`, `uuid-ossp` — `pg_net` 없음). 설치는 별도 승인 사항 |

- **권고: (a)**. 근거 — 인프라 추가 없이 기존 3중 게이트·secret 검증을 그대로 재사용하며, 멱등한 lease 기반 claim(`account_deletion_claim`)이라 GET 반복 호출이 안전하다. 단 이는 **권고이며 이번 세션의 결정 사항이 아니다**(오너 승인 필요 — §23 B-03).
- 어느 안이든 **"스케줄 등록"만으로 끝나지 않는다**: 기본 dry-run이므로 실운영 가동(플래그 ON + `?dryRun=false`)은 별도 오너 승인 사항이다.

### 15.5 파괴 실행 안전장치 (전부 보존)

| 장치 | 현재 | S2 조치 |
|---|---|---|
| `CRON_SECRET` timing-safe 비교 | 3종 route 공통 | 유지 |
| `ACCOUNT_DELETION_WORKER_ENABLED` | 미설정(=비활성) | **유지. 활성화하지 않는다** |
| 기능 플래그 | ON 필요 | 유지 |
| `?dryRun=false` 명시 | 기본 dry-run | 유지 |
| lease 기반 claim | `account_deletion_claim(p_owner,p_limit,p_lease_seconds)` | 유지. deprecated `account_deletion_worker_claim`은 **전 역할 EXECUTE=false**(실측) — 되살리지 않는다 |
| Storage 커버리지 | 13/13 버킷 등재 | 유지. `individual-question-attachments`는 2단계 조인 |
| state 게이트 | `storage_purged` 이후에만 금융·익명화 | 유지 |

---

## 16. Cron route와 운영 플래그 계약 `[TO-BE]`

### 16.1 route 계약표

| route | 메서드 | 인증 | 킬스위치 | vercel.json | S2 조치 |
|---|---|---|---|---|---|
| `/api/cron/subscription-renewal` | **GET** | `CRON_SECRET` (Bearer 또는 `x-cron-secret`, timing-safe, 미설정 시 전면 401) | `SUBSCRIPTION_RENEWAL_ENABLED` (`true`/`1` 외에는 200 no-op `{disabled:true}`) | ✅ `10 18 * * *` (UTC = KST 03:10) | **변경 없음** |
| `/api/cron/individual-question-expiry` | **GET** | 동일 | `INDIVIDUAL_QUESTION_EXPIRY_ENABLED` | ✅ `40 18 * * *` | **변경 없음** |
| `/api/cron/account-deletion` | **POST** | 동일 | `ACCOUNT_DELETION_WORKER_ENABLED` + 기능 플래그 + `?dryRun=false` | ❌ 미등록 | **변경 없음**(§15.4 대안만 계약화) |

### 16.2 운영 env 계약

| env | 용도 | 현재(Gate 2) | S2 조치 |
|---|---|---|---|
| `CRON_SECRET` | cron 3종 인증 | 설정·재배포 완료 | 유지 |
| `SUBSCRIPTION_RENEWAL_ENABLED` | 갱신 배치 | `true` | 유지 |
| `INDIVIDUAL_QUESTION_EXPIRY_ENABLED` | IQ 만료 환불 | `true` | 유지 |
| `ACCOUNT_DELETION_WORKER_ENABLED` | 탈퇴 worker | 미설정(비활성) | **유지(활성화 금지)** |
| `SUPABASE_SERVICE_ROLE_KEY` | 서버 특권 | 설정 | 유지 |
| `TOSS_SECRET_KEY` | 결제 승인 | **미검증**(이번 세션 실측 아님) | **§23 U-01** |
| **`TOSS_WEBHOOK_SECRET`** | webhook 서명 | **미검증** | **§23 U-01.** 미설정이면 webhook 복구 경로 전면 OFF(XW-16) |
| `SUBSCRIBE_CHECKOUT_ALLOW_PENDING` | 개발 우회 | production에서 ON이면 throw | 유지 |
| `CASH_TOPUP_ALLOW_TEST_CHARGE` | 테스트 충전 | production+true면 throw | 유지 |
| 배치 튜닝 | `SUBSCRIPTION_RENEWAL_BATCH_LIMIT`(50/최대100), `SUBSCRIPTION_RENEWAL_NOTICE_DAYS`(3/최대14), `IQ_EXPIRY_BATCH_LIMIT`(100/최대500), `IQ_OPEN_EXPIRY_HOURS`(48), `IQ_CLAIMED_ANSWER_HOURS`(48), `IQ_DIRECT_EXPIRY_HOURS`(72) | — | 유지 |

### 16.3 기능 플래그 (실측)

- `lib/shell/featureFlags.ts`에 있는 것: **`CUSTOM_REQUEST`, `ACCOUNT_DELETION`, `USER_BLOCKS`** 3종.
- **웹에 IQ 생성 플래그는 없다**(`IQ_CREATE` 검색 0건). 앱의 `kIndividualQuestionCreateEnabled`(`bool.fromEnvironment('IQ_CREATE_ENABLED', default false)`)와 혼동하지 않는다(§3.7 #10).
- `SUBSCRIPTION_RENEWAL_ENABLED`는 **UI에도 이중 사용**된다: `lib/subscribe/subscriptionDisplay.ts:5-7`이 false면 "자동 갱신 준비 중 · <일자> 예정" 라벨을 표시한다. 즉 이 env는 배치 킬스위치이면서 **표시 계약**이기도 하다 — 끄면 사용자 문구가 바뀐다.

### 16.4 신규 계약이 cron에 요구하는 것

- **없음.** F10~F12는 기존 cron route가 호출하는 함수를 바꾸지 않는다.
- 단 F12로 전환하면 구독 확정 경로가 `p_expected_amount_cents`를 요구하므로, **갱신 배치는 F12를 쓰지 않는다**(갱신은 `process_subscription_renewal`이 별도 경로). 신규 결제 확정(checkout)만 F12를 쓴다 — 이 경계를 §17 매핑표에 명시한다.

---

## 17. 현재 웹 호출점 → 신규 객체 → 레거시 객체 매핑표 `[AS-IS → TO-BE]`

전환 상태 범례: **유지** = 신규 객체 없음 / **wrapper** = 신규 객체가 레거시를 감쌈 / **대체** = 웹 호출점을 신규 객체로 옮김 / **추후 제거** = S3 이후 검토

| # | 현재 웹 호출점 (`web@ad076d29`) | 현재 객체 | 신규 객체 | 전환 상태 | 해소 결함 |
|---|---|---|---|---|---|
| 1 | `lib/qna/weeklyQuestionUsage.ts:113` | `get_weekly_question_usage(p_student_id, p_mentor_id)` | **F1** `api_web_v1.weekly_question_usage_self(p_mentor_id)` | **대체** | XW-01 |
| 2 | `lib/qna/freeQuestionRoom.ts:46` → `subscribeCheckoutService.ts:940 ensureMentorStudentRoom` | 직접 테이블 INSERT(service_role) + 컬럼 프로빙 + 23505 재조회 | **F2** → **F10** | **대체** | A2, XW-10 |
| 3 | `subscribeCheckoutService.ts:763, 870` (구독 확정 시 방 확보) | 동일 JS 경로 | **F10** (`p_require_entitlement=false`) | **대체** | XW-10 |
| 4 | `lib/qna/questionRoomRpc.ts:94` | `qna_create_question_thread(...)` (raise) | **F3** (envelope 변환) | **wrapper** | XW-07, XW-08 |
| 5 | `lib/qna/questionRoomRpc.ts:125,149,164,182` | `qna_append_message`/`confirm_thread`/`flag_wrong_answer`/`register_attachment` | — | **유지** | — |
| 6 | 커뮤니티 글 목록·상세 (`communityBoardQueries.ts:208`) | `community_posts` 직접 SELECT + 레거시 폴백 | **V1** `community_posts_v1` | **대체** | XW-09, XW-14 (**글 목록 한정** — `listPopularHashtags`/`community_hashtags` 경로는 V1로 덮이지 않는다. §23 U-12) |
| 7 | 댓글 조회 (`comments`/`community_comments` 이중) | 두 테이블 직접 SELECT | **V2** `community_comments_v1` | **대체** | XW-09 |
| 8 | 글 작성·수정·삭제 (`communityBoardActions.ts`) | `community_posts` 직접 INSERT/UPDATE/DELETE | **F4/F5/F6** | **대체** | XW-09(hard delete), 앱 동등성 |
| 9 | `lib/auth/mentorPublicRead.ts:76,110,138` | `mentor_directory_list_v2` + `mentor_profiles_for_directory_v2` + `mentor_user_public_v2` | **V3** `mentor_directory_v1` | **대체**(3종 → 1 view) | XW-02b, PII 축소 |
| 10 | 멘토 프로필 저장 (`mentorProfileMutations.ts`) | `mentor_profiles` 직접 UPDATE(전 컬럼) | **F7** | **대체** | **XW-02** |
| 11 | 멘토 요금제 저장 (`mentorProfileMutations.ts:46-113`) | `mentor_plans` 직접 upsert(밴드=JS 검증) | **F8** | **대체** | **XW-03** |
| 12 | `subscribeCheckoutService.ts:843` | `confirm_subscription_checkout(3인자)` | **F12** `subscription_checkout_confirm_v2(4인자)` | **wrapper** | **XW-04**, XW-07 |
| 13 | `lib/toss/cashTopupFromPayment.ts:74`, `lib/cash/walletTopupActions.ts:97` | `record_cash_topup(3인자)` | **F11** `record_cash_topup_v2(4인자)` | **wrapper** | **W3** |
| 14 | 지갑·원장 조회 (`lib/cash/cashQueries.ts`, `firstReadableTable` 프로빙) | `cash_wallets`/`cash_ledger` 직접 SELECT + 테이블 프로빙 | **V4** + **V5** | **대체** | XW-10, W3 가시화 |
| 15 | 구독 조회 (`SUB_TABLES` 프로빙) | `subscriptions` 직접 SELECT | **V6** | **대체** | XW-10 |
| 16 | 멘토 정산 조회 | `subscription_settlement_items` 직접 SELECT | **V7** | **대체** | — |
| 17 | `appSurfaceAccountGate.ts:134` | `account_deletion_status_self()` | **F9**(웹) / 앱은 `public` 유지 | **wrapper** | — |
| 18 | `accountDeletionActions.ts:81,109` | `account_deletion_request_consented`, `account_deletion_cancel` | — | **유지** | — |
| 19 | worker 체인 10종 (`accountDeletionAdapters.ts`) | `account_deletion_*` | — | **유지** | — |
| 20 | IQ 자금 6종 (`individualQuestionActions.ts`, `individualQuestionExpiryBatch.ts`) | `create_*_with_hold(_v2)`, `claim_*_v2`, `release_*_payout`, `refund_*_hold` | — | **유지** (S3에서 코드 정규화 검토) | XW-07은 문서화만 |
| 21 | 맞춤의뢰 8종 | `custom_order_*`, `record_custom_order_*`, `accept_*_atomic` | — | **유지** | — |
| 22 | 관리자 환불 2종 | `approve/reject_refund_request_admin` (T4a) | — | **유지** | — |
| 23 | 관리자 학교인증 승인 | `approve_mentor_school_verification_admin` (**T4b — 관리자 세션 필수**) | — | **유지** | — |
| 24 | 정산 배치 | `refresh_subscription_settlement_items`, `pay_due_payouts_for_run`, `run_scheduled_payout` | — | **유지** | — |
| 25 | 알림 | `mark_all_notifications_read`, `notifications` 직접 | — | **유지** | — |
| 26 | 리뷰 | `reviews` 직접 + `get_mentor_review_stats` + `check_review_eligibility`(RLS 내장) | — | **유지** | XW-05·XW-11은 §23 이월 |
| 27 | 조회수 2종 | `increment_community_post_view`, `increment_shortform_post_view` | — | **유지** | — |
| 28 | 맞춤의뢰 공개 조회 2종 | `get_public_custom_request_post_for_browse`, `list_open_custom_request_posts_for_mentor_browse` | — | **유지** | — |
| 29 | 질문방 첨부 Storage | `question-room-attachments` + `qna_register_attachment` | — | **유지**(이미 엄격) | — |
| 30 | 숏폼 Storage | `shortform-videos`/`shortform-thumbnails` | — | **유지** | XW-06 §23 이월 |

**전환 요약**: 대체 12건 · wrapper 4건 · 유지 14건. 신규 객체 21개(view 7 + function 14)로 **웹 호출점 51 RPC + 51 테이블 중 16개 경로**를 정리한다. 나머지는 S2에서 손대지 않는다.

---

## 18. 기존 `public` 함수·view·직접 테이블 접근 호환표 `[TO-BE]`

### 18.1 원칙

- **S2에서 현 `public` 표면을 삭제·이동·revoke하지 않는다**(§10.5). 유일한 예외는 §10.6의 **웹 전용 컬럼/테이블 쓰기 권한 2건**이며, 그조차 웹 전환 완료 후 조건부다.
- 앱 `V_fix` 배포 → 14일 → 강제 업데이트 → 7일 유예 → 호출 0건 확인 후 GRANT 회수·private 이동이라는 **기존 일정을 침범하지 않는다**(앱 계약 §7.4).
- 실제 삭제는 **S5에서만** 검토한다.

### 18.2 웹이 쓰는 `public` 함수 51종 — 철거 조건표

| 그룹 | 함수 | S2 판정 | 철거 조건 |
|---|---|---|---|
| 질문방 5종 | `qna_create_question_thread` | **유지 + F3 wrapper** | 웹·앱 호출점이 전부 `api_*_v1`로 이동 + 앱 cutoff 후 |
| | `qna_append_message`, `qna_confirm_thread`, `qna_flag_wrong_answer`, `qna_register_attachment` | 유지 | 앱이 직접 사용 중(앱 RPC 27종) → 앱 cutoff 전 금지 |
| 무료질문 | `get_weekly_question_usage(uuid,uuid)` | **유지(레거시)** + F1 대체 | 웹 전환 후에도 **앱이 사용**(앱 RPC 27종에 포함) → 앱 cutoff 전 회수 금지. **anon EXECUTE 회수는 앱 cutoff와 무관하게 검토 가능** → §23 U-08 |
| | `qna_create_free_question_thread` | 유지 | 앱 전용. 웹 호출 0건 |
| 자금 확정 | `confirm_subscription_checkout` | **유지 + F12 wrapper** | F12가 내부 호출하므로 **영구 유지**(철거 대상 아님) |
| | `record_cash_topup(3인자)` | **유지 + F11 병행** | 기존 원장 행 호환. 철거 시 과거 재실행 불가 → **영구 유지 권고** |
| | `record_subscription_cash_debit`, `process_subscription_renewal`, IQ escrow 6종, 맞춤의뢰 escrow 4종 | 유지 | 변경 없음 |
| | `record_subscription_cash_rollback` | **유지·미사용** | 웹 호출점 0건(XW-17). 앱도 미사용. S5 삭제 후보 |
| 공개 조회 | `mentor_directory_list_v2`, `mentor_profiles_for_directory_v2`, `mentor_user_public_v2` | 유지 + V3 대체 | **앱이 사용**(앱 RPC 27종) → 앱 cutoff 전 금지 |
| | `mentor_directory_list`, `mentor_profiles_for_directory`, `mentor_user_public` (v1) | **유지·사실상 폐쇄** | anon/auth EXECUTE 이미 false(실측). 웹·앱 호출 0건 → **S5 삭제 1순위** |
| | `get_mentor_avg_response_hours`, `get_mentor_review_stats`, `increment_*_view`, `get_public_custom_request_post_for_browse`, `list_open_custom_request_posts_for_mentor_browse`, `get_mobile_app_version_policy` | 유지 | 로그인 전 동작 필요 |
| 탈퇴 | `account_deletion_request_consented`(5인자) | 유지 | 웹 정본. 철거 대상 아님 |
| | `account_deletion_request_self`, `_status_self`, `_cancel_self`, `_write_blocked` | 유지 | 앱 allowlist |
| | `account_deletion_request_self_consented`(3인자) | **유지 + 신규 계약 제외** | 앱 계약 T3(=`V_fix`+14일+강제업데이트+7일 유예 후) 에서만 회수·`core_private` 이동 |
| | `account_deletion_worker_claim` | **이미 전면 회수**(전 역할 EXECUTE=false) | S5 삭제 후보 |
| | worker 체인 10종 | 유지 | — |
| 관리자 | `approve_mentor_school_verification_admin`(T4b), `approve/reject_refund_request_admin`(T4a) | 유지 | — |
| 정산 | `refresh_subscription_settlement_items`, `pay_due_payouts_for_run`, `run_scheduled_payout`, `payout_reconciliation_report` | 유지 | — |
| 기타 | `mark_all_notifications_read`, `get_mentor_student_nicknames`, `list_open_individual_questions_for_mentor`, `set_individual_question_price`, `custom_order_*` 3종, `accept_custom_order_deliverable_atomic`, `record_custom_order_dispute_split` | 유지 | — |

### 18.3 `public.due_payouts` view

| 항목 | 내용 |
|---|---|
| 현재 | `service_role`만 접근(실측 GRANT). `reloptions = null` → **`security_invoker` 미설정(구식 owner 뷰)** |
| 정의 | 3원천 UNION — 구독(`subscription_settlement_items`), 맞춤의뢰(`custom_order_settlement_items`, 분쟁 제외), IQ(`floor(price_cents*0.85)`, `fee_rate 0.15`) |
| S2 판정 | **유지.** V7은 멘토 자기 조회용이며 `due_payouts`를 대체하지 않는다 |

### 18.4 직접 테이블 접근 호환

| 테이블군 | S2 판정 |
|---|---|
| 앱이 쓰는 24종 | **GRANT 회수 0건.** 앱 계약 §9 유지. `cash_ledger`·`cash_wallets`·`subscriptions`·`subscription_settlement_items`는 앱에서 SELECT 전용 |
| 웹 전용 쓰기 2종 (`mentor_profiles` 일부 컬럼, `mentor_plans`) | §10.6 조건부 회수 — **앱 사용 여부 실측이 전제**(B-02) |
| 나머지 웹 직접 접근 | 유지. RLS가 실효 방어 |
| `payments` (동적 접근) | 유지. 단 프로빙 제거 후 리터럴 접근으로 전환 권고(§20 M10) |

---

## 19. `api_app_v1`과의 공용·웹전용·앱금지 경계표 `[TO-BE]`

### 19.1 제품 경계 (지시서 §4 기준 + 실측 반영)

| 기능 | 웹 | 앱 | 신규 객체 배치 |
|---|---|---|---|
| 신규 회원가입 | ✅ | ❌ | 신규 객체 없음(기존 auth 경로 유지) |
| **NICE PASS 본인인증** | 계약상 웹 전용 | ❌ | **구현 0건 — 신규 객체 없음**(XW-12, B-01) |
| 신규 구독·결제 | ✅ | ❌ | **F12** (`core_private`, service_role 전용 → 앱 도달 불가) |
| 구독 변경·해지 | ✅ | ❌ | 신규 객체 없음 |
| 신규 개별질문 등록·결제 | ✅ | ❌ | 신규 객체 없음(기존 service_role RPC) |
| 캐시 충전·결제 확정 | ✅ | ❌ | **F11** (`core_private`, service_role 전용) |
| 전체 멘토·프로필 설정 | ✅ | 단순 프로필만 | **F7**(웹). 앱은 현재 `mentor_profiles`를 **읽기만** 한다(§19.4-B). 앱의 단순 프로필 수정 제품 범위 정의는 **B-07** |
| 관리자 기능 | ✅ | ❌ | 신규 객체 없음 |
| **기존 구독 질문방 사용** | ✅ | ✅ | **F2/F3**(웹) ↔ `api_app_v1.ensure_free_question_room`/`qna_create_question_thread`(앱) — **F10 공용 구현부 공유** |
| **커뮤니티 전 기능(이미지 읽기·쓰기 포함)** | ✅ | ✅ | **V1/F4/F5/F6**(웹) ↔ `api_app_v1.community_posts_v1`/`community_post_*`(앱) — **필드·제한·오류코드 동일** |
| 멘토 검색 | ✅ | ✅ | **V3**(웹). 앱은 기존 `mentor_*_v2` RPC 유지 → **의미 차이 주의(19.3)** |
| 잔액 소멸 동의·consented 탈퇴 | ✅(서버 전용) | ❌ | **wrapper 만들지 않음**(§15.1) |

### 19.2 경계 대조 결과 — 지시서 §5.4 체크리스트

| 확인 항목 | 결과 | 근거 |
|---|---|---|
| 공용 기능의 의미·오류코드가 불필요하게 갈라지지 않는가 | **조건부 충족** | 커뮤니티·질문방은 §19.1대로 동일 계약. 단 (a) 앱 계약 §4.3 오류 목록에 `SUBSCRIPTION_REFUND_PENDING` 누락(§3.7 #5), (b) 앱 계약이 정본을 envelope로 가정(§3.7 #4) → **앱 계약 보정 2건 필요** |
| 커뮤니티 이미지 ref·서명 URL·업로드·보상 삭제 규약이 동등한가 | **충족** | §14.5 표 — ref 형식·TTL 3600초·5장/5MiB/4MIME·보상 삭제·soft delete 전부 일치 |
| 질문방·무료질문 자격 판단이 모순되지 않는가 | **충족(구조적 보장)** | 웹 F2·앱 wrapper가 **동일한 F10**을 호출. 소비는 양쪽 모두 정본 `qna_create_question_thread`가 수행 |
| 앱 금지 기능이 `api_app_v1`에 유입되지 않는가 | **충족** | F11·F12는 `core_private`에 있고 `authenticated` EXECUTE 없음 → 앱 anon 키로 도달 불가 |
| `FORFEIT_CONSENT_REQUIRED`가 앱에서 웹 유도로 처리되는가 | **계약상 충족 · 구현 미완(실측 확정)** | §19.4-D. 웹 유도 인프라는 존재하나 **FORFEIT 분기에 연결돼 있지 않다.** `V_fix` 릴리스 대기 상태 — 이번 계약이 침범하지 않음 |
| `account_deletion_request_self_consented`가 앱 allowlist 밖에 유지되는가 | **충족(실측)** | §19.4-C. 앱 코드 참조 **0건**. 신규 wrapper 0건. `public` GRANT는 T3까지 유지 |
| 기존 앱 RPC 27종·직접 테이블 24종의 호환 기간을 침범하지 않는가 | **충족(실측 — 조건 해소됨)** | §19.4-A·B. 앱 RPC **27/27 일치**, 테이블 **24/24 일치**. §10.6 회수 대상 2종은 앱에서 **SELECT 전용**임을 실측 확인 → **B-02 해소** |

### 19.3 웹·앱 의미 차이 (의도적 — 기록)

| 항목 | 웹(V3) | 앱(기존 RPC) | 판정 |
|---|---|---|---|
| 멘토 디렉터리 승인 필터 | **DB에서 강제** | RPC가 미필터 → **앱 코드가 필터**해야 함 | 앱 cutoff 전에는 통일 불가. 앱은 `verification_status`를 받으므로 필터 가능. **S3에서 앱도 V3 상당 객체로 이동** |
| 노출 PII | `nickname`만 | `full_name` 포함 | 웹이 더 좁다. 앱 축소는 S3 |

이 두 차이는 **사용자 관점 기능 동등성을 해치지 않는다**(둘 다 승인 멘토만 보이고, 이름 표기는 앱이 넓을 뿐이다). 지시서 §4의 "커뮤니티 이미지 읽기·쓰기 완전 동등" 요구와는 무관한 영역이다.

### 19.4 앱 저장소 경계 실측 `[AS-IS]`

측정: 2026-07-29, `byite-co/ssambership-app@b0ea4051` (읽기 전용 grep). 경계 확인에 필요한 항목만 조사했고 S1 전체 감사를 반복하지 않았다.

**A. 앱 RPC — 27종, 계약과 27/27 일치**

`account_deletion_cancel_self`, `account_deletion_request_self`, `account_deletion_status_self`, `account_deletion_write_blocked`, `add_individual_question_attachment`, `answer_individual_question`, `claim_individual_question_as_mentor`, `create_individual_question_as_student`, `get_mentor_avg_response_hours`, `get_mentor_student_nicknames`, `get_mobile_app_version_policy`, `get_weekly_question_usage`, `increment_community_post_view`, `increment_shortform_post_view`, `list_open_individual_questions_for_mentor`, `mark_all_notifications_read`, `mentor_directory_list_v2`, `mentor_profiles_for_directory_v2`, `mentor_user_public_v2`, `qna_append_message`, `qna_confirm_thread`, `qna_create_free_question_thread`, `qna_create_question_thread`, `qna_flag_wrong_answer`, `qna_register_attachment`, `refund_individual_question`, `release_individual_question`

- 호출 지점 27곳(파일별: mentors 3, community 2, notifications 1, mypage 4, individual_question 6, question_room write 4 / read 1 / student_lookup 1 / mentor_lookup 1 / attachment_upload 1, core/auth 2, version_gate 1).
- 앱 계약 §8의 27종 목록과 **완전 일치**. S2 신규 계약이 이 표면을 건드리지 않으므로 호환 기간 침범 없음.

**B. 앱 직접 테이블 — 24종, 계약과 24/24 일치**

`cash_ledger`, `cash_wallets`, `community_posts`, `connection_notes`, `content_reports`, `free_question_usage`, `individual_question_attachments`, `individual_question_messages`, `individual_questions`, `mentor_individual_question_pricing`, `mentor_plans`, `mentor_profiles`, `mentor_student_rooms`, `notifications`, `post_reactions`, `question_attachments`, `question_messages`, `question_threads`, `reviews`, `shortform_posts`, `shortform_reactions`, `subscription_settlement_items`, `subscriptions`, `users`

> **B-02 해소 — §10.6 회수의 앱 영향 없음(실측).** `mentor_profiles`·`mentor_plans`에 대한 앱 접근은 **총 2곳이며 전부 SELECT**다:
> - `lib/features/mentors/data/mentor_directory_repository.dart:175` — `.from('mentor_plans').select('mentor_id, plan_tier, amount_cents, label').inFilter('mentor_id', ids)`
> - `lib/features/question_room/data/question_room_read_repository.dart:67` — `.from('mentor_profiles').select('teaching_subjects').eq('user_id', mentorId)`
>
> §10.6은 **SELECT를 유지**하고 INSERT/UPDATE와 특정 컬럼 UPDATE만 회수하므로 **앱 동작에 영향이 없다.** M11·M12 게이트의 조건 ④는 이 실측으로 충족된다.

**C. 앱 금지 표면 — 실측 0건**

| 확인 | 결과 |
|---|---|
| `account_deletion_request_self_consented` 참조 | **0건** ✅ |
| `image_urls` / `imageUrls` / `community-post-images` 참조 | **0건** ✅ (A0 미해소 상태 그대로 — S3 범위) |

**D. `FORFEIT_CONSENT_REQUIRED` 처리 — 미구현 확정(A1 유지)**

- 앱 코드 전체에 `FORFEIT_CONSENT_REQUIRED` / `FORFEIT_CONSENT_STALE` 문자열 **0건**.
- 탈퇴 요청 결과 처리는 `lib/features/mypage/data/account_deletion_repository.dart:147`:
  ```dart
  if (data is! Map || data['ok'] != true || data['job_id'] is! String) { … }
  ```
  → `ok != true`면 **서버가 준 `code`·`balance_cents` payload를 버리고** 실패로 처리한다. S1 v2.1 §3.2 A1의 "서버 payload를 버리고 고정 문구 표시"가 이 HEAD에서도 그대로다.
- 웹 유도 인프라는 **존재한다**: `WebBridge.openAccountDelete()`(`lib/core/web_bridge/web_bridge.dart:62`), `openAccountDeleteWeb`(`web_bridge_actions.dart:54`), 경로 상수 `/account/delete`(`web_bridge_config.dart:42`).
- 그러나 이 경로는 `AccountDeletionUnavailable`(= **42501 권한 오류** 분기, `account_deletion_repository.dart:210`)에서만 호출된다(`account_delete_screen.dart:88-99`). **FORFEIT 분기와 연결돼 있지 않다.**
- **판정**: A1은 미해소이며 해소에는 앱 릴리스(`V_fix`)가 필요하다는 기존 결론이 재확인된다. 이번 `api_web_v1` 계약은 이 상태를 **바꾸지도 침범하지도 않는다** — 웹 `/account/delete`는 `src=app`을 받아도 동일 관문을 적용한다(§15.3).

---

## 20. 삭제 없는 timestamp migration 분해안과 적용 순서 `[TO-BE]`

### 20.1 규칙

- 이번 세션은 **migration 파일을 만들지 않는다.** 아래는 분해안이다.
- 전부 **추가형**이다. 기존 190개 SQL을 수정·재번호·삭제하지 않는다.
- Supabase **표준 timestamp migration**(`YYYYMMDDHHMMSS_name.sql`)을 쓰고, 번호 접두어 체계를 신규에 쓰지 않는다.
- 각 migration에 **대응 rollback migration**을 별도로 설계한다(§22).
- 운영 DB에 대한 임의 `execute_sql` 적용을 금지한다. 검토된 단일 배포 경로(`apply_migration`)만 쓴다.

### 20.2 적용 순서

| # | migration | 내용 | 되돌릴 수 있나 |
|---|---|---|---|
| **M0** | `..._mentor_profile_privileged_column_guard.sql` | **선택·우선 적용 권고(§23 B-06).** `mentor_profiles`에 BEFORE UPDATE 트리거를 추가해 `verification_status`·`cap_limit` 변경을 service_role / JWT 없는 세션 / 기존 admin 으로 제한 | ✅ 트리거·함수 DROP |
| **M1** | `..._api_web_v1_schemas.sql` | `api_web_v1`·`core_private` 생성, `REVOKE ALL FROM PUBLIC`, 스키마 USAGE(§10.1), `ALTER DEFAULT PRIVILEGES … REVOKE EXECUTE FROM PUBLIC` | ✅ 스키마 DROP(비어 있을 때) |
| **M2** | `..._cash_ledger_ref_text.sql` | `ALTER TABLE public.cash_ledger ADD COLUMN ref_text text` (nullable) + 부분 인덱스 | ✅ 컬럼 DROP (**단, 값이 쌓이면 데이터 손실** → §22 주의) |
| **M3** | `..._api_web_v1_label_helpers.sql` | **F0** `api_web_v1.user_display_label`/`user_display_role` + GRANT | ✅ DROP FUNCTION |
| **M4** | `..._api_web_v1_read_views.sql` | **V1~V7** + view GRANT(§10.2) | ✅ DROP VIEW |
| **M5** | `..._core_private_room_ensure.sql` | **F10** `ensure_student_mentor_room` | ✅ |
| **M6** | `..._api_web_v1_self_rpc.sql` | **F1, F2, F3, F9** + GRANT | ✅ |
| **M7** | `..._api_web_v1_community_rpc.sql` | **F4, F5, F6** + 공용 검증부 + GRANT | ✅ |
| **M8** | `..._api_web_v1_mentor_rpc.sql` | **F7, F8** + GRANT | ✅ |
| **M9** | `..._core_private_money_rpc.sql` | **F11, F12** + service_role GRANT | ✅ |
| **M10** | `..._contract_permission_assertions.sql` | 권한 실측 assertion(§21 T-PERM 계열을 SQL `DO $$ … RAISE EXCEPTION`으로) — **읽기 전용 검증 migration** | ✅ (부작용 없음) |
| — | *(웹 코드 전환 — migration 아님)* | 호출점을 신규 객체로 이동(§17), 프로빙 제거 | — |
| **M11** | `..._revoke_mentor_profile_columns.sql` | §10.6 `mentor_profiles` 컬럼 UPDATE 회수 | ✅ GRANT 복원 migration |
| **M12** | `..._revoke_mentor_plans_write.sql` | §10.6 `mentor_plans` INSERT/UPDATE/**DELETE** 회수 | ✅ GRANT 복원 migration |

### 20.3 게이트 (앞 단계 미충족 시 다음 단계 금지)

| 게이트 | 조건 |
|---|---|
| M4 이전 | M1~M3 적용 + `api_web_v1`·`core_private`에 `PUBLIC` 권한 0건 실측 |
| M6 이전 | M5의 F10이 동시성 테스트(T-CONC-01) 통과 |
| M9 이전 | M2의 `ref_text` 존재 + F11 계약 테스트 통과 |
| **M11·M12 이전** | ① F7·F8 배포 완료 ② 웹 callsite 전환 완료(**`syncAfterSignUpSession`의 `mentor_profiles` upsert 제거 포함**) ③ **웹·앱 저장소에서 두 테이블 직접 쓰기 호출 0건 실측** ④ 앱 영향 없음 — **§19.4-B에서 실측 완료** |
| 전 단계 공통 | Data API exposed schema에 `core_private`가 **없음** 확인 |

### 20.4 웹 callsite 전환 계획 (migration 사이에 끼는 코드 작업)

| 순서 | 대상 | 선행 migration |
|---|---|---|
| C1 | 읽기 경로 → V1~V7 (프로빙 제거 동반) | M4 |
| C2 | `weeklyQuestionUsage` → F1 | M6 |
| C3 | `freeQuestionRoom` + 구독 확정 방 확보 → F2/F10 | M5, M6 |
| C4 | `questionRoomRpc.createThread` → F3 | M6 |
| C5 | 커뮤니티 쓰기 → F4/F5/F6 | M7 |
| C6 | 멘토 프로필·요금제 저장 → F7/F8 | M8 |
| C7 | 충전 원장 → F11 (`p_order_ref = orderId`) | M9 |
| C8 | 구독 확정 → F12 (`p_expected_amount_cents` = 학생에게 표시한 금액) | M9 |
| C9 | `assertAccountActive` fail-open 제거(§11.5) | — |
| C10 | 런타임 스키마 프로빙 제거(`firstPayTable`·`firstReadableTable`·`pickExistingColumn` 호출부) | C1 완료 후 |

**C8 주의**: `p_expected_amount_cents`는 **학생이 결제 화면에서 실제로 본 금액**이어야 한다. 서버가 확정 직전에 `mentor_plans`를 다시 읽어 채우면 XW-04가 그대로 남는다. 결제 intent 생성 시점의 금액을 세션·`payments` 행에 보존해 전달한다.

### 20.5 M0 — XW-02 선행 완화안 (권고, 오너 승인 필요)

**문제**: XW-02(멘토 자기승인)의 정식 해소는 M11(컬럼 REVOKE)이고, M11은 F7 배포 + 웹 callsite 전환이 선행돼야 한다. 그 사이 기간 동안 결함이 그대로 남는다.

**완화안**: 이미 DB에서 검증된 패턴을 **그대로 복제**해 `mentor_profiles`의 특권 컬럼에 적용한다. 이 저장소·DB는 컬럼 단위 인가에 BEFORE 트리거를 쓰는 관행이 이미 확립돼 있다 — `enforce_users_role_guard`(`users.role`)와 `reviews_enforce_update`(리뷰 컬럼별 액터 분기)가 실측 선례다.

**INSERT까지 덮어야 한다(C6).** XW-02의 (나) INSERT 경로는 `BEFORE UPDATE` 전용 트리거로 막히지 않으므로, 트리거를 **`BEFORE INSERT OR UPDATE`** 로 건다. INSERT일 때는 `old`가 없으므로 "특권 컬럼이 기본값이 아닌 값으로 들어오는지"를 검사한다.

```sql
-- 형태(구현 시 최종 확정). 기존 users 가드와 동일한 3분기 구조.
CREATE OR REPLACE FUNCTION public.enforce_mentor_profile_privileged_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_jwt_role text;
BEGIN
  IF new.verification_status IS DISTINCT FROM old.verification_status
     OR new.cap_limit IS DISTINCT FROM old.cap_limit THEN
    v_jwt_role := auth.jwt() ->> 'role';
    IF v_jwt_role = 'service_role' THEN RETURN new; END IF;   -- 서버 경유
    IF v_jwt_role IS NULL THEN RETURN new; END IF;            -- SQL Editor·migration
    IF EXISTS (SELECT 1 FROM public.users u
               WHERE u.id = (SELECT auth.uid()) AND u.role = 'admin') THEN
      RETURN new;                                             -- 기존 관리자
    END IF;
    RAISE EXCEPTION 'MENTOR_PROFILE_PRIVILEGED_COLUMN_FORBIDDEN'
      USING errcode = '42501';
  END IF;
  RETURN new;
END $$;

-- UPDATE: 특권 컬럼이 바뀔 때만
CREATE TRIGGER trg_mentor_profile_privileged_guard_upd
  BEFORE UPDATE ON public.mentor_profiles
  FOR EACH ROW
  WHEN (old.verification_status IS DISTINCT FROM new.verification_status
        OR old.cap_limit IS DISTINCT FROM new.cap_limit)
  EXECUTE FUNCTION public.enforce_mentor_profile_privileged_guard();

-- INSERT: 'pending' 이외의 verification_status 또는 cap_limit 지정을 막는다 (C6)
--   함수는 TG_OP='INSERT' 분기에서 old 참조 없이
--   (new.verification_status IS DISTINCT FROM 'pending' OR new.cap_limit IS NOT NULL) 를 판정한다.
CREATE TRIGGER trg_mentor_profile_privileged_guard_ins
  BEFORE INSERT ON public.mentor_profiles
  FOR EACH ROW
  WHEN (new.verification_status IS DISTINCT FROM 'pending'
        OR new.cap_limit IS NOT NULL)
  EXECUTE FUNCTION public.enforce_mentor_profile_privileged_guard();
```

**호환성 검토 (실측 근거)**

| 경로 | 영향 |
|---|---|
| `approve_mentor_school_verification_admin` (T4b, 관리자 세션 SECDEF) | **통과** — `auth.uid()`가 관리자이므로 3번 분기. (SECDEF라도 트리거는 실행되므로 이 분기가 필요하다) |
| 관리자 콘솔 service_role 경로 | **통과** — 1번 분기 |
| migration·SQL Editor | **통과** — 2번 분기 |
| `trg_mp_seed_default_plans` (AFTER UPDATE WHEN `verification_status='approved'`) | 영향 없음 — 정상 승인은 계속 통과하므로 시딩도 정상 동작 |
| 멘토 본인의 직접 UPDATE | **차단** ← 목적 |
| 앱 | 영향 없음 — 앱은 `mentor_profiles`를 **SELECT만** 한다(§19.4-B) |

- M0는 **추가형**이며 M1~M12와 독립이다. F7 배포를 기다리지 않는다.
- M11 적용 후에도 M0를 남겨 둔다(권한 회수 + 트리거 이중 방어).
- **이번 세션은 M0를 적용하지 않았다.** 적용 여부·시점은 오너 결정이다(§23 B-06).
- 동일 논리의 `mentor_plans` 밴드 강제 트리거도 가능하지만, 밴드 상수를 DB에 이중 정의하게 되므로 **F8(M8)로 처리하는 것을 권고**한다. 급하면 `amount_cents > 0` 및 tier allowlist CHECK만 먼저 거는 것도 선택지다.

---

---

---

## 21. contract test · 권한 test · 동시성 test · 회귀 test 매트릭스 `[TO-BE]`

### 21.1 계약 테스트 (T-CON)

| id | 대상 | 검증 |
|---|---|---|
| T-CON-01 | F1~F12 전부 | 반환이 jsonb이고 `ok`·`contract_version` 필드를 항상 포함 |
| T-CON-02 | F1~F12 실패 경로 | `ok:false`면 `code`가 §9 사전에 있는 값 |
| T-CON-03 | V1~V7 | 컬럼 이름·타입·순서가 §6과 일치(스냅샷 비교) |
| T-CON-04 | 웹 클라이언트 | `ok` 필드가 없는 응답을 성공으로 처리하지 않음 |
| T-CON-05 | F3 | 정본이 raise하는 14종 코드가 전부 envelope로 변환됨 |
| T-CON-06 | F3 | 사전에 없는 예외는 **전파**되고 `ok:true`로 바뀌지 않음 |
| T-CON-07 | V1 vs `api_app_v1.community_posts_v1` | 두 view의 컬럼 집합이 **동일** |
| T-CON-08 | F4/F5/F6 vs 앱 동명 함수 | 시그니처·오류코드가 **동일** |

### 21.2 권한 테스트 (T-PERM) — 전부 **실측**으로 검증

| id | 검증 | 기대 |
|---|---|---|
| T-PERM-01 | `has_schema_privilege('anon'/'authenticated','core_private','USAGE')` | **false** |
| T-PERM-02 | `api_web_v1`의 모든 함수에 대해 `has_function_privilege('PUBLIC', …, 'EXECUTE')` | **false** |
| T-PERM-03 | Data API exposed schema 목록 | `core_private` **미포함** |
| T-PERM-04 | 신규 SECDEF 객체 목록 | §11.6 화이트리스트와 **정확히 일치**(추가 시 실패) |
| T-PERM-05 | `api_web_v1.user_display_label` | 반환이 `nickname` 한 컬럼뿐이고 `full_name`·`email`·`birth_date`가 어떤 입력에도 노출되지 않음. `user_display_role`은 admin uid에 대해 `NULL` |
| T-PERM-06 | F10/F11/F12 | `anon`·`authenticated` EXECUTE **false**, `service_role` **true** |
| T-PERM-07 | V4~V7 | `anon` SELECT **false** |
| T-PERM-08 | 신규 view 전체 | `INSERT/UPDATE/DELETE` 권한이 어떤 역할에도 **없음** |
| T-PERM-09 | M11 후 | `authenticated`의 `mentor_profiles.verification_status` UPDATE **false**, 나머지 허용 컬럼은 **true** |
| T-PERM-10 | M12 후 | `authenticated`의 `mentor_plans` INSERT/UPDATE/**DELETE 전부 false**, SELECT **true**. (DELETE를 빠뜨리면 멘토가 자기 플랜 행을 지워 `confirm_subscription_checkout`이 `PLAN_NOT_FOUND`로 실패하게 만들 수 있다) |
| T-PERM-11 | M11 후 | `approve_mentor_school_verification_admin`(SECDEF)이 **여전히 동작**(컬럼 회수 영향 없음 확인) |
| T-PERM-12 | 레거시 | `public` 함수 194종의 anon/auth EXECUTE가 **S2 전후 동일**(회수 0건 회귀 감시) |
| T-PERM-13 | V4~V7 | `service_role`로 조회 시 **전 사용자 행이 반환됨**(BYPASSRLS)을 명시적으로 확인 — 계약된 성질이며 호출부 필터 책임임을 고정 |
| T-PERM-14 | M11 후 | `authenticated`의 `mentor_profiles` **INSERT false**(XW-02 (나) 차단). 가입 경로가 여전히 정상 동작(트리거 `handle_new_auth_user` 경유) |

### 21.3 동시성 테스트 (T-CONC)

| id | 시나리오 | 기대 |
|---|---|---|
| T-CONC-01 | 동일 학생–멘토로 F2를 N개 동시 호출 | 방이 **정확히 1개**. `created:true`는 1회만 |
| T-CONC-02 | 동일 `p_idempotency_key`로 F11 동시 2회 | 원장 1행, 지갑 1회 가산, 두 번째는 `duplicate:true` |
| T-CONC-03 | 동일 `p_payment_id`로 F12 동시 2회 | 구독 1건, `sub_debit_` 원장 1행, 두 번째는 `idempotent:true` |
| T-CONC-04 | F12 실행 중 멘토가 `mentor_plans.amount_cents` UPDATE | 멘토 UPDATE가 **대기**하고, 확정 금액은 잠금 시점 값 |
| T-CONC-05 | 무료질문 마지막 1개를 F3로 동시 2회 | 하나만 성공, 나머지는 `FREE_QUOTA_*` (**`FREE_QUESTION_*` 문자열이 노출되지 않을 것** — XW-08) |
| T-CONC-06 | 동일 `create_idempotency_key`로 F4 동시 2회 | 글 1건, 두 번째 `idempotent_replay:true`, 중복 업로드 객체 보상 삭제 |
| T-CONC-07 | F8을 3 tier 동시 호출 | 전부 반영 또는 전부 실패(트랜잭션) |
| **T-CONC-08** | **전환기 교착 검증(C3)**: 같은 (payment, plan) 쌍에 대해 **F12**와 **레거시 `confirm_subscription_checkout` 직접 호출**을 동시 실행 | 교착(40P01) **0건**. 두 경로의 잠금 순서가 `payments` → advisory → `mentor_plans`로 동일함을 확인 |
| **T-CONC-09** | **멱등 재생 + 가격 변경(C4)**: F12 성공 → 멘토가 `amount_cents` 변경 → **동일 `p_payment_id`·기존 `p_expected_amount_cents`로 재시도** | `{ok:true, idempotent:true}` 반환. **`PLAN_AMOUNT_CHANGED`가 아니어야 한다** |

### 21.4 자금 정합성 테스트 (T-FIN)

| id | 검증 |
|---|---|
| T-FIN-01 | F11 후 `cash_ledger.ref_text = orderId`이고 `ref_id IS NULL` |
| T-FIN-02 | F11에 타인 orderId 전달 → `ORDER_REF_OWNER_MISMATCH`, 원장 0행 |
| T-FIN-03 | F12에 실제와 다른 `p_expected_amount_cents` → `PLAN_AMOUNT_CHANGED`, **차감 0** |
| T-FIN-04 | 잔액 부족 상태 F12 → `CASH_INSUFFICIENT`, 구독 생성 안 됨 |
| T-FIN-05 | IQ 1건 hold→release 후 `iq_hold` + `iq_payout` 합계 = **`-(price_cents - floor(price_cents*0.85))`** (= 플랫폼 수수료). `price_cents`가 100의 배수가 아니면 `floor(price*0.15)`와 다르므로 이 식을 정본으로 쓴다(§12.4) |
| T-FIN-06 | 원장 UPDATE/DELETE 시도 → 실패(append-only) |
| T-FIN-07 | V5의 `order_ref`가 신규 행은 `ref_text`, 레거시 topup 행은 `idempotency_key`, **그 외 행은 NULL** |

### 21.5 보안 회귀 테스트 (T-SEC) — §3.6 결함별 1:1

| id | 결함 | 검증 |
|---|---|---|
| T-SEC-01 | XW-01 | anon 세션으로 F1 호출 → 실패. 타인 usage 조회 경로 없음 |
| T-SEC-02 | **XW-02** | 멘토 세션으로 `mentor_profiles.verification_status='approved'` 직접 UPDATE → **거부**(M11 후) |
| T-SEC-03 | XW-02 | 멘토 세션으로 `cap_limit` UPDATE → **거부**(M11 후) |
| T-SEC-04 | XW-02b | V3에 `verification_status='pending'` 멘토가 **나타나지 않음** |
| T-SEC-05 | XW-02b | V3에 `users.status='banned'/'suspended'` 멘토가 **나타나지 않음** |
| T-SEC-06 | **XW-03** | F8에 밴드 밖 금액 → `PLAN_PRICE_OUT_OF_BAND`. `mentor_plans` 직접 UPDATE → **거부**(M12 후) |
| T-SEC-07 | XW-03 | F8이 `cap_weight`를 tier 고정값으로 강제(클라이언트 값 무시) |
| T-SEC-08 | **XW-04** | T-FIN-03과 동일 |
| T-SEC-09 | XW-09 | F6 후 V1에서 글이 사라짐. 직접 hard DELETE 경로가 웹 코드에 0건 |
| T-SEC-10 | XW-14 | 폴백 경로에서도 `deleted_at IS NOT NULL` 글이 목록에 없음 |
| T-SEC-11 | 커뮤니티 이미지 | 타인 UID 경로 ref로 F4 → `IMAGE_NOT_OWNED` |
| T-SEC-12 | PII | V3·V2·F0 어디에도 `full_name`·`email`·`birth_date` 미노출 |
| T-SEC-13 | XW-15 | 계정 상태 확인 불가 시 신규 쓰기 함수가 **거부**(fail-closed) |
| T-SEC-14 | **XW-02(나)** | `mentor_profiles` 행이 없는 **학생 역할** 세션으로 `INSERT (user_id=auth.uid(), verification_status='approved')` → **거부**(M0 또는 M11 후). 거부 후 `individual_question_user_is_approved_mentor(해당 uid)` = false |

### 21.6 회귀 테스트 (T-REG)

| id | 검증 |
|---|---|
| T-REG-01 | 앱 RPC 27종 + 직접 테이블 24종이 S2 전후 **동일하게 동작** |
| T-REG-02 | F8의 밴드 상수 == `lib/subscribe/mentorPlanPricing.ts`의 `MENTOR_SUBSCRIPTION_PRICE_RULES` (**두 정본 일치 감시**) |
| T-REG-03 | 잠금값: tier id `limited/standard/premium`, cap `1.0/2.5/4.5`, 수수료 15%/5%/15%, 주간한도 4/9/999 |
| T-REG-04 | cron 3종의 메서드·킬스위치·CRON_SECRET 동작 불변 |
| T-REG-05 | Realtime publication이 **3테이블 그대로**(신규 추가 0) |
| T-REG-06 | `public` 함수 개수·시그니처가 S2 전후 동일(신규는 `api_web_v1`/`core_private`에만) |
| T-REG-07 | 웹 로그인·가입 플로 정상(세션 쿠키 회귀 없음) |

### 21.7 테스트 실행 위치

- **권한·동시성·자금 정합성**은 운영 DB가 아니라 **Supabase 브랜치 DB 또는 로컬 스택**에서 실행한다(지시서 §3 운영 DB 변경 금지).
- 계약 테스트 중 순수 로직(오류코드 매핑·밴드 상수·ref 파싱)은 기존 `__contract__` 패턴(`node --test`)을 따른다 — 저장소에 이미 `lib/*/__contract__/*.contract.test.ts` 관행이 있다.
- M10은 운영 적용 후 **읽기 전용 assertion**만 수행한다.

---

## 22. rollback 원칙 `[TO-BE]`

1. **모든 rollback은 별도 추가형 migration**이다. 기존 migration 파일을 수정하지 않는다.
2. **역순 적용**: M12 → M11 → **M10** → M9 → M8 → M7 → M6 → M5 → M4 → M3 → M1 → (**M0는 마지막이며 되도록 남긴다** — §20.5). (M2는 아래 예외)
3. **M2(`cash_ledger.ref_text`)는 되돌리지 않는 것을 기본으로 한다.** 컬럼을 DROP하면 F11이 기록한 주문 참조가 **영구 소실**된다. 롤백이 필요하면 컬럼을 남긴 채 F11 호출만 중단하고 기존 3인자 `record_cash_topup`으로 되돌린다.
4. **웹 코드 롤백이 DB 롤백보다 먼저**다. 신규 객체를 DROP하기 전에 웹 호출점을 레거시로 되돌린다 — 반대 순서는 즉시 장애다.
5. **레거시는 계속 살아 있으므로 롤백이 안전하다.** §10.5대로 S2는 `public` 표면을 회수하지 않는다. F11/F12/F3는 wrapper이므로 웹이 레거시 함수를 다시 부르면 그대로 동작한다.
6. **M11·M12 롤백은 GRANT 복원 migration**으로만 한다:
   ```sql
   GRANT UPDATE (verification_status, cap_limit, …) ON public.mentor_profiles TO authenticated;
   GRANT INSERT, UPDATE, DELETE ON public.mentor_plans TO authenticated;
   ```
   회수 대상 컬럼 목록을 migration에 **문자 그대로 보존**해 대칭성을 보장한다.
7. **부분 실패 시**: migration은 단일 트랜잭션으로 적용한다. 실패하면 그 migration 전체가 롤백되며, 다음 단계로 진행하지 않는다.
8. **데이터 롤백은 없다.** F4~F8이 만든 행(글·프로필·요금제)은 정상 업무 데이터이므로 되돌리지 않는다.
9. 롤백 실행도 **운영 DB 임의 `execute_sql` 금지** — 동일한 단일 배포 경로를 쓴다.

## 23. 미확정 사항과 정확한 blocker `[TO-BE]`

### 23.1 오너 결정이 필요한 blocker

| id | 사안 | 왜 이번 세션에서 못 정하는가 | 필요한 결정 | 이 계약에 미치는 영향 |
|---|---|---|---|---|
| **B-01** | **NICE정보인증 PASS 본인인증** | 지시서 §4는 "웹 전용 기능"으로 분류했으나 **코드 0건**(XW-12). 도입 여부·시점·범위가 제품 결정 | 도입 시점과 적용 범위(가입 전체 / 멘토만 / 만14세 미만 보호자) | 이번 계약은 관련 객체를 **0개** 만든다. 도입 시 별도 계약 세션 필요 |
| **B-03** | account-deletion worker 실행 방식 | GET/POST 경계는 기술 사실이나(§15.4), 어느 안을 쓸지와 **실가동 여부**는 운영 책임 결정 | (a) GET 러너 추가 **(권고)** / (b) 외부 POST 스케줄러, 그리고 플래그 ON 시점 | 계약은 두 안을 비교만 한다. 이번 세션 구축·등록·활성화 **0건** |
| **B-04** | 금지어 정책 **폐지 추인** | 코드가 폐지를 **의도적**이라고 명시한다(`lib/safety/trustSafetyText.ts` 상단 주석 — `[정책 변경] 금지어 차단 폐지`, `[폐지됨] 과거 금지어 검사`). 따라서 회귀 여부는 쟁점이 아니고, **폐지를 계약으로 추인할지**가 남은 결정이다 | 폐지 확정 또는 복원 | `POLICY_RESTRICTED`(§9.4)의 실효 여부. **웹·앱 동등성(§14.5)이 이 결정에 걸려 있다** |
| **B-05** | 리뷰 자격 규칙 | 잠금값 "동일 멘토 **2회 연속 결제** 후" vs DB `check_review_eligibility`(구독 관계 1건 또는 완료 IQ 1건이면 허용)가 불일치(XW-11). 어느 쪽이 정본인지 문서로 판별 불가 | 잠금값을 DB에 맞출지, DB를 잠금값에 맞출지 | 이번 계약은 리뷰 객체를 만들지 않는다. DB를 바꾸는 결정이면 별도 migration + `reviews.subscription_count` 컬럼 활용 검토 |
| **B-06** | **XW-02 선행 완화(M0) 적용 여부** | M11 정식 해소는 F7 배포 후에나 가능. 그 사이 노출 기간을 감수할지, M0를 먼저 넣을지는 리스크 수용 결정 | M0를 S2 착수 즉시 적용할지 | 적용하면 XW-02 노출 기간이 사라진다. 미적용 시 M11까지 결함 유지 |

| **B-07** | 앱의 "단순 프로필 수정" 제품 범위 | 지시서 §4는 앱에 "단순 프로필 수정"을 허용했으나, 앱은 현재 `mentor_profiles`를 **읽기만** 한다(§19.4-B). 즉 허용된 범위가 아직 구현되지 않았거나 범위 정의가 다르다 — 코드로는 판별 불가 | 앱이 어떤 프로필 필드를 쓰게 할지. 쓰기를 허용한다면 §10.6의 `mentor_profiles` INSERT/컬럼 회수와 **충돌하지 않도록 전용 `api_app_v1` RPC**로 열어야 한다 | M11 회수 범위와 `api_app_v1` v2 설계 |

> **B-02는 해소되었다** — 앱이 `mentor_profiles`·`mentor_plans`를 SELECT 전용으로만 쓴다는 실측(§19.4-B)으로 §10.6 회수의 앱 영향이 없음을 확인했다. 다만 앱의 프로필 **쓰기 제품 범위**는 별도 결정으로 분리했다(B-07).

### 23.2 이번 세션에서 검증하지 못한 항목 (추정으로 채우지 않음)

| id | 항목 | 막힌 이유 | 필요한 권한·다음 조치 |
|---|---|---|---|
| **U-01** | `TOSS_SECRET_KEY`·**`TOSS_WEBHOOK_SECRET`** 설정 여부 | Vercel MCP `get_project`는 프로젝트 메타(도메인·최신 배포)만 반환하고 **환경변수를 노출하지 않는다.** 확인한 것: 프로젝트 `ssambership-web`(`prj_1esRN0q6npJ4BJUEqFeloX9kTTOf`), 도메인에 `ssambership.com`·`www.ssambership.com` 포함, 최신 production 배포 READY | **Vercel 대시보드에서 env 존재 여부 육안 확인.** `TOSS_WEBHOOK_SECRET` 미설정이면 webhook 복구 경로가 전면 OFF다(XW-16) |
| **U-02** | XW-06(`cpi_public_read`·`sfv_public_read` 버킷 전체 SELECT) 축소 설계 | 웹·앱 이미지 읽기가 이 정책에 의존 — 좁히면 회귀 위험이 크고 앱 동시 변경이 필요 | S3에서 앱·웹 읽기 경로를 view/RPC로 옮긴 뒤 정책 축소 설계 |
| **U-03** | mutable `search_path` 5종 | 전부 non-SECDEF 헬퍼·트리거이며 S2 범위 밖. 변경 시 회귀 위험 > 이득 | S4/S5 위생 작업 |
| **U-04** | 비내부 트리거 총량 89 재집계 | 이번 세션은 대상 테이블 단위로만 트리거를 확인했고 전수 재집계를 하지 않았다 | 필요 시 `pg_trigger` 전수 재집계 |
| **U-05** | IQ escrow `lowercase_snake` 오류코드 정규화 | 앱이 해당 함수들을 직접 사용(앱 RPC 27종) → 신규 wrapper 없이 바꾸면 앱이 깨진다 | S3에서 `api_app_v1`/`api_web_v1` IQ wrapper와 함께 |
| **U-06** | 멘토 정산 계좌(`payout_bank_name`·`payout_account_number`) 변경 계약 | 자금 수취 대상이라 프로필 수정(F7)과 분리해야 하는데, 본인확인 수단이 없다(B-01과 연결) | B-01 확정 후 별도 계약 |
| **U-07** | 플랫폼 수수료 원장 계정 도입 | 현재 15%는 어떤 지갑에도 입금되지 않고 hold−payout 차액으로만 존재(§12.4). 회계 정책 결정 사항 | 오너·회계 확인 후 별도 설계 |
| **U-08** | `get_weekly_question_usage`의 **anon EXECUTE 회수** 가능 여부 | 앱도 이 함수를 쓰지만 로그인 후 호출로 보이므로 anon 회수는 앱에 영향이 없을 가능성이 높다. 다만 앱 호출 시점(로그인 전/후)을 이번 세션에 확정하지 못했다 | 앱 호출 경로가 전부 인증 후임을 확인하면 **F1과 무관하게 anon EXECUTE만 즉시 회수 가능** → XW-01의 미인증 노출이 조기 차단된다 |
| **U-09** | ~~앱 FORFEIT 처리~~ | **해소** — §19.4-D에서 실측 완료 | — |
| ~~U-10~~ | 웹 영역 전수 추적 | **해소** — 15개 영역 전수 추적을 **15/15 완료**했고, 그 결과를 §3.8(XW-19~XW-24)에 반영했다. §3.3의 RPC 51종·§3.4 테이블 51종·§3.5 버킷 11종은 별도로 저장소 전수 grep + DB 카탈로그 대조로 독립 확보했다 | — |
| **U-13** | `shortform-thumbnails` 쓰기 경로 부재(XW-19) | 업로더 함수는 있으나 호출자 0건이고 `thumbnailUrl`이 null 하드코딩. 배선할지 기능을 접을지는 제품 결정 | 썸네일 기능 존폐 결정 후 배선 또는 버킷 정리(S5) |
| **U-14** | 레거시 멘토 숏폼 작성 경로(XW-21) | 도달 가능하며 `video_url`·`status`를 채우지 않는다. 제거 대상인지 유지 대상인지 판단 필요 | S3에서 정본 경로로 통합 또는 제거 |
| **U-15** | 마이페이지 신고 지표(XW-22) | 존재하지 않는 `reports`/`abuse_reports`를 조회 — 정본은 `content_reports` | S3 위생 수정 |
| **U-16** | 알림 `recipient_user_id` 정합성(XW-24) | 웹 USER_FK 후보군 누락. 실제 데이터 형상은 개인정보 최소 조회 원칙상 조회하지 않았다 | `notifications`의 수신자 컬럼 사용 실태를 집계 쿼리(개인정보 미포함)로 확인 후 후보군 정정 |
| **U-12** | `community_hashtags` / `listPopularHashtags` 경로 | XW-14의 폴백 3곳 중 인기 해시태그 조회는 V1(글 목록)로 덮이지 않는다. V1 필드에 `hashtags`가 없고 `community_hashtags`는 §3.4 직접 접근 목록에 잔존한다 | S3에서 해시태그 전용 view 또는 V1 필드 확장 검토 |
| **U-11** | `comments.author_label` 비정규화 | F0를 `api_web_v1`로 옮기면서 임의 uuid→nickname 조회가 열린다(§10.3 트레이드오프). 이를 없애려면 `comments`에 `author_label`을 비정규화해야 하나 트리거·백필이 필요해 S2 범위를 넘는다 | S3에서 `community_posts`와 동일한 비정규화 패턴 적용 검토 |

### 23.3 이번 계약이 의도적으로 다루지 않는 것

- IQ·맞춤의뢰·정산·알림 도메인의 신규 객체 (측정된 결함 없음 → §7 "신규 객체를 만들지 않는 영역")
- 기존 194개 함수의 `search_path`·시그니처 변경
- `public` 표면 회수 (§10.5)
- SQL history squash, baseline 생성, 저장소 단일화 (S4/S5)
- 레거시 한글명 RLS 정책 3종 정리 (XW-09 — 정리 자체는 안전하지만 S2 범위 밖, S4 위생 작업)

---

## 24. 다음 세션 진입 판정 `[결론]`

### 24.1 완료 게이트 대조 (지시서 §10)

| # | 게이트 | 결과 | 근거 |
|---|---|---|---|
| 1 | 최신 웹 HEAD와 라이브 DB 기준선 재측정 완료 | ✅ | §2.1 — 웹 `ad076d29`, 앱 `b0ea4051`, DB 03:19:04 UTC |
| 2 | 웹 호출점 전수 목록 완료 | ✅ | §3.3 RPC 51종(파일:행) · §3.4 테이블 51종 · §3.5 버킷 11종. **영역별 전수 추적 15/15 완료** → §3.8에 추가 실측 6건 반영 |
| 3 | 신규 view·function 이름과 정확한 시그니처 확정 | ✅ | §6 view 7개(필드 전체) · §7 function **14개**(인자 타입 전체, F0이 2개) |
| 4 | 모든 객체의 호출자·GRANT·REVOKE 확정 | ✅ | §4.1 계층 6종 · §10.1~10.4 DDL |
| 5 | 안정 오류코드와 반환 envelope 확정 | ✅ | §8 envelope · §9 사전 + 레거시 매핑표 |
| 6 | 결제·환불·원장·정산의 멱등·동시성·트랜잭션 규약 확정 | ✅ | §12.1~12.5 (lock 순서·멱등키 총람·재시도 전제) |
| 7 | Toss `orderId` 원장 추적 공백의 계약상 해결안 확정 | ✅ | §7 F11 + §10.4 `cash_ledger.ref_text` + V5 `order_ref` |
| 8 | Storage·커뮤니티 미디어 계약 확정 | ✅ | §14 (ref·TTL 3종·업로드 제한·멱등·보상 삭제·앱 동등성) |
| 9 | account-deletion 비활성 유지 + 운영 계약 확정 | ✅ | §15 (변경 0건, GET/POST 경계, 대안 비교) |
| 10 | 현재 호출점 → 신규 객체 → 레거시 호환표 완료 | ✅ | §17 (30행) · §18 |
| 11 | `api_app_v1`과 제품 경계 대조 완료 | ✅ | §19 + **§19.4 앱 저장소 실측**(RPC 27/27, 테이블 24/24) |
| 12 | 삭제 없는 migration 분해안과 적용 순서 완료 | ✅ | §20 (M0~M12 + 게이트 + callsite 전환 C1~C10) |
| 13 | 구현 검수용 test matrix 완료 | ✅ | §21 (T-CON 8 · T-PERM 14 · T-CONC 9 · T-FIN 7 · T-SEC 14 · T-REG 7 = **59건**) |
| 14 | AS-IS와 TO-BE가 명확히 분리됨 | ✅ | 절마다 `[AS-IS]`/`[TO-BE]` 표시, 문서 상단 "읽는 법" |
| 15 | 미검증 사실을 추정으로 채운 항목 0건 | ✅ | §23.2에 U-01~U-16으로 전부 명시(U-09·U-10 해소). §16.2의 TOSS env 2종은 **미검증**으로 표기(추정 아님) |
| 16 | DB·GitHub·코드·Vercel 변경 0건 | ✅ | §24.3 |

**16/16 충족.**

### 24.2 판정

```
S2-1 PASS / S2-2 GO
```

단, **S2 세션 2의 SQL 구현을 자동으로 시작하지 않는다.** 이 계약 문서에 대한 사용자 승인을 기다린다.

승인 시 권고 착수 순서: **M0(B-06 승인 시) → M1 → M2 → M3 → M4 → C1 → M5 → M6 → C2·C3·C4 → M7 → C5 → M8 → C6 → M9 → C7·C8 → M10 → (호출 0건 확인) → M11 → M12 → C9·C10**

### 24.3 변경 없음 확인

```text
이번 세션은 읽기 전용으로 수행했으며 DB DDL/DML, migration 적용,
GitHub 브랜치·commit·PR·merge, 코드 수정, Vercel 설정 변경은 0건이다.
```

세부:

| 영역 | 수행한 것 | 변경 |
|---|---|---|
| Supabase | `pg_catalog`/`information_schema`/`storage.buckets`/`cron.job` **SELECT만** | DDL 0 · DML 0 · `apply_migration` 0 · `execute_sql` 변경 0 |
| GitHub | `git fetch` + 읽기 전용 grep/read | 브랜치 0 · commit 0 · push 0 · PR 0 · issue 0 |
| 저장소 파일 | 읽기만 | **수정 0건** (계약 문서는 저장소 밖 작업 디렉터리에 작성) |
| Vercel | `list_teams`/`list_projects`/`get_project` **읽기만** | env 0 · 재배포 0 · cron 0 |
| 운영 플래그 | 조회만 | `ACCOUNT_DELETION_WORKER_ENABLED` 활성화 0 · worker 수동 실행 0 · 외부 스케줄러 0 |
| 기존 SQL 190개 | 참조만 | 재번호·수정·삭제 0 |

### 24.4 적대적 검토 이력 (v1.0 확정 전)

초안 완성 후 **독립 적대적 검토**를 1회 수행했다(읽기 전용 DB 조회 + 양 저장소 grep). 지적된 항목은 전부 재실측으로 판정했다.

| 지적 | 판정 | 조치 |
|---|---|---|
| §7 함수 총계 13 vs §10.3·부록 A 14행 불일치 | **인정** | F0이 함수 2개임을 명시하고 14로 통일(§7·§17·§24.1·부록 A) |
| `qna_*` raise 13종 vs 14종 | **인정** | 14종으로 정정(§9.8). §9.3에 없는 `ACCOUNT_BANNED`/`ACCOUNT_SUSPENDED`는 §9.2 공통에 있음을 확인 |
| **F12 잠금 순서가 §12.2 선언 순서의 역순 → 전환기 교착** | **인정(중대)** | F12 실행 순서를 `payments` → advisory → `mentor_plans`로 재규정(§7 F12 [C3], §12.2). 회귀 테스트 **T-CONC-08** 신설 |
| **F12 금액 검사가 멱등 재생을 실패로 뒤집음** | **인정(중대)** | 재생 판정을 금액 비교보다 **앞**에 배치(§7 F12 [C4]). 회귀 테스트 **T-CONC-09** 신설 |
| §10.3 각주의 PostgreSQL 근거가 자기부정 | **인정** | F0을 `api_web_v1`으로 이전해 예외 자체를 제거(§10.3). 미묘한 동작에 의존하지 않는다 |
| **XW-02 해소안이 INSERT 경로를 못 막음**(`mentor_insert_own`, 역할 검사 없음) | **인정(중대)** | XW-02를 (가)UPDATE/(나)INSERT로 분리. M0를 `BEFORE INSERT OR UPDATE`로, M11에 `REVOKE INSERT` 추가. 가입 백업 upsert 제거를 선행 조건에 명시. **T-SEC-14·T-PERM-14** 신설 |
| **`mplan_del` DELETE 잔존 → M12 회수 불완전** | **인정** | M12에 `DELETE` 추가, §3.4 정책 4종으로 정정, T-PERM-10 확장. `uq_mentor_plans_mentor_tier` UNIQUE INDEX를 F8 `ON CONFLICT` 근거로 명시 |
| `reviews_update_mentor`가 멘토의 rating·body 수정을 허용(누락 결함) | **반증** | `trg_reviews_enforce_update` 본문 실측 결과 `rating`·`body`는 **작성자만** 변경 가능하고 멘토는 `mentor_reply` 1회로 제한된다. **결함 아님** — §3.6 **XW-N1**로 기록 |
| 버킷 10종/확장 5종/계층 5종/`users` RLS "뿐"/롤백 순서 M10 누락/T-FIN-05 수식/B-04 전제/해시태그 폴백/B-02 참조 잔존/service_role BYPASSRLS/F1 사전검사/행번호 | **인정(경미)** | 전부 정정. `service_role`의 BYPASSRLS 성질은 **T-PERM-13**으로 계약화, 해시태그 미커버는 **U-12**, 앱 프로필 쓰기 범위는 **B-07**로 분리 |

검토가 확인한 고위험 실측 주장(제약조건·정책·권한·함수 시그니처·저장소 HEAD·RPC 51/27종·테이블 24종·버킷 메타 등)은 **전부 일치**했다.

---

---

## 부록 A. 신규 객체 한눈표

| 객체 | 종류 | 계층 | anon | auth | svc |
|---|---|---|---|:--:|:--:|:--:|
| `api_web_v1.community_posts_v1` | view | T1+T2 | S | S | S |
| `api_web_v1.community_comments_v1` | view | T1+T2 | S | S | S |
| `api_web_v1.mentor_directory_v1` | view (SECDEF) | T1 | S | S | S |
| `api_web_v1.my_wallet_v1` | view | T2 | — | S | S |
| `api_web_v1.my_cash_ledger_v1` | view | T2 | — | S | S |
| `api_web_v1.my_subscriptions_v1` | view | T2 | — | S | S |
| `api_web_v1.mentor_settlement_v1` | view | T2 | — | S | S |
| `api_web_v1.user_display_label(uuid)` | fn | 보조 | E | E | E |
| `api_web_v1.user_display_role(uuid)` | fn | 보조 | E | E | E |
| `api_web_v1.weekly_question_usage_self(uuid)` | fn | T2 | — | E | E |
| `api_web_v1.ensure_free_question_room(uuid)` | fn | T2 | — | E | E |
| `api_web_v1.qna_create_question_thread(uuid,text,text,text,text)` | fn | T2 | — | E | E |
| `api_web_v1.community_post_create(text,text,text,text[],text,uuid)` | fn | T2 | — | E | E |
| `api_web_v1.community_post_update(uuid,text,text,text,text[],text,timestamptz)` | fn | T2 | — | E | E |
| `api_web_v1.community_post_soft_delete(uuid)` | fn | T2 | — | E | E |
| `api_web_v1.mentor_profile_update_self(text,text,text,text[],text,text,text,text,boolean)` | fn | T2 | — | E | E |
| `api_web_v1.mentor_plan_prices_set_self(integer,integer,integer)` | fn | T2 | — | E | E |
| `api_web_v1.account_deletion_status_self()` | fn | T2 | — | E | E |
| `core_private.ensure_student_mentor_room(uuid,uuid,uuid,uuid,boolean)` | fn | T4a/T5 | — | — | E |
| `core_private.record_cash_topup_v2(uuid,bigint,text,text)` | fn | T4a | — | — | E |
| `core_private.subscription_checkout_confirm_v2(uuid,uuid,integer,text)` | fn | T4a | — | — | E |
| `public.cash_ledger.ref_text` | column | — | (기존 정책 상속) | | |

**합계: view 7 · function 14 · column 1 · schema 2** (+ 선택 M0의 트리거·함수 1쌍)

> 표는 13행이지만 F0 행이 함수 2개를 담고 있어 **함수 총계는 14**다(§7 참조).

## 부록 B. AS-IS 결함 → TO-BE 해소 대조

| 결함 | 심각도 | 해소 객체 | 회귀 테스트 |
|---|---|---|---|
| **XW-02(가)** 멘토 자기승인 (UPDATE) | **높음** | M0(BEFORE UPDATE) + F7 + M11 컬럼 REVOKE | T-SEC-02·03, T-PERM-09·11 |
| **XW-02(나)** 프로필 행 자기생성 (INSERT) | **높음** | M0(BEFORE INSERT) + M11 INSERT REVOKE (+ 가입 백업 upsert 제거) | T-SEC-14, T-PERM-14 |
| **XW-03** 가격 밴드 DB 미강제 | **높음** | F8 + M12 | T-SEC-06·07, T-PERM-10, T-REG-02 |
| **XW-04** 구독 금액 미결속 | **높음** | F12 | T-FIN-03, T-CONC-04, T-SEC-08 |
| **XW-01** 주간사용량 IDOR | 중간 | F1 (+ U-08 anon 조기 회수) | T-SEC-01 |
| XW-02b 디렉터리 미필터 | 중간 | V3 | T-SEC-04·05 |
| W3 orderId 원장 공백 | 중간 | F11 + `ref_text` + V5 | T-FIN-01·02·07 |
| XW-09 soft-delete 미강제 | 중간 | V1 + F6 | T-SEC-09 |
| XW-14 폴백 필터 소실 | 중간 | V1 | T-SEC-10 |
| XW-07 오류 형식 3원화 | 중간 | F3·F12 envelope 변환 | T-CON-05·06 |
| XW-08 무료질문 코드 이원화 | 낮음 | F3 코드 수렴 | T-CONC-05 |
| XW-10 런타임 프로빙 | 낮음 | V4~V6 + F10 + C10 | — |
| XW-15 fail-open | 낮음 | §11.5 fail-closed | T-SEC-13 |
| A2 무료질문 방 데드엔드 | — | F2/F10 (앱과 공용) | T-CONC-01 |
| XW-05 리뷰 통계 인자 | 낮음 | (미해소 — U 이월) | — |
| XW-06 버킷 전체 SELECT | 낮음 | (미해소 — U-02) | — |
| XW-11 리뷰 자격 불일치 | — | (오너 결정 — B-05) | — |
| XW-12 NICE 미구현 | — | (오너 결정 — B-01) | — |
| XW-13 금지어 dead code | — | (오너 결정 — B-04) | — |
| XW-16 webhook secret | — | (미검증 — U-01) | — |
| XW-17 PG 완료 경로 미배선 | — | (설계 선택 — 기록만) | — |
| **XW-N1** reviews UPDATE 정책 | — | **결함 아님**(트리거가 컬럼 인가 강제) — 기록만 | — |
