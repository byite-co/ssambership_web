# Ssambership `api_web_v1` 접합부 상세 계약 v1.1

- 개정일: **2026-07-29** (v1.0 동일자 개정)
- 개정 기준 원문: `docs/contracts/api_web_v1_contract_v1_0.md` (v1.0 동결안, 2026-07-29 — 본 문서와 나란히 보존, 내용 무변경)
- 개정 정본 지시서: `docs/audit/s2_api_contract_v1_1_revision_directive_20260729.md` (**rev 8 최종 종결**, 커밋 `7ec3b26`)
- 성격: **S2 구현 전 고정 계약**. SQL·웹 코드 적용 결과가 아니라 구현·검수의 기준이다. 이 v1.1 문서는 SQL·마이그레이션·제품 코드를 포함하거나 적용하지 않는다(문서 내 DDL 블록은 전부 계약 명세다).
- 세션 성격: 문서 개정 전용 세션. DB DDL/DML, migration 적용, 제품 코드 수정, Vercel 설정 변경 **0건**.
- 상위 지시서: `ssambership_s2_session1_api_web_contract_directive_20260729.md`
- 선행 계약: `ssambership_api_app_v1_contract_20260728.md` (v1.0, 2026-07-28 확정 — 공용 계약 대조용 읽기 전용)
- 선행 검증: `ssambership_junction_verification_report_20260728` v2.1
- 진입 판정: Gate 1~5 **5/5 PASS · S2 GO** (`ssambership_s2_gate_status_20260729_s2_go.md`) — 단 §24의 v1.1 판정이 이를 대체한다

> **v1.1 개정 요약 (rev 8 A~G 전건 반영).**
> ① **A-1** F4/F5 시그니처 재배열(필수 인자 선행·DEFAULT 후행, named notation 의무) — 42P13 생성 불가 해소.
> ② **A-2** `core_private`는 Data API 도달 불가(실측) → F11·F12 외부 진입점을 `api_web_v1`로 이동(service_role 전용 GRANT), F10은 내부 구현부로 유지하고 **F12가 내부 호출 + `room_id` 반환**. §5.2의 "비노출 스키마 = 유일한 구조적 방어" 논리 폐기(정본 방어선 = GRANT).
> ③ **A-3** 컬럼 단위 REVOKE 무효(실측) → M11·M12를 **테이블 단위 `REVOKE ALL` + `GRANT SELECT`**로 교체.
> ④ **A-4** 정산계좌 전용 RPC **F13** 신설(U-06 해소).
> ⑤ **A-5** F12 멱등 재생 전면 재작성 — [C4] 오측 폐기, 결제 시점 불변 동의 금액 기준, P/C 정본 판정, 관계 결속 검증, **9단계 오류 우선순위**, `SUBSCRIPTION_REF_INVALID`(detail 3종), **검증 선행·쓰기 후행 2단계(Phase 1/2)**, room 참조 컬럼별 규칙, 회귀 테스트 A~H.
> ⑥ **A-6** topup 정본 확정 — `ref_text`·M2·4인자 F11 폐기, `idempotency_key` 단독 정본, **3층 분리**(`core_private.record_cash_topup_impl` / 레거시 `public.record_cash_topup` 무음 duplicate 유지 / 신규 strict F11), 6필드 NULL-safe 대조, 테스트 충전 분리.
> ⑦ **A-7** M0 재기술(TG_OP 선분기·`IS DISTINCT FROM`·PUBLIC EXECUTE 회수) + **필수화**.
> ⑧ **A-8** 레거시 `get_weekly_question_usage`에 NULL-safe **pair-party 가드**(M15).
> ⑨ **A-9** F0 공개 라벨 함수 **폐기** — V2는 비정규화(security_invoker 뷰 유지), V6·V7은 범위 제한 SECDEF RPC로 **객체별 확정**. V6 금액 필드는 `current_plan_amount_cents`로 단일 확정.
> ⑩ **A-10** 커뮤니티 게시글 작성 **승인 멘토 전용**(`ROLE_NOT_MENTOR`/`MENTOR_NOT_APPROVED`), 기존 학생 글 보존, 숏폼 정책 실측 정정(`sfv_mentor_insert` 1정책/2버킷).
> ⑪ **B** 공용 구현부(커뮤니티 write impl 3종 + 이미지 ref 검증기 + F10 + topup impl) 함수명·시그니처·보안 속성·GRANT 전건 명세.
> ⑫ **C** 커뮤니티 직접 쓰기 전면 잠금 **HD-1**(M16) — 보상 삭제 RPC 폐기, F4 멱등 재호출 = 생성 복구 정본, service_role moderation 예외.
> ⑬ **D** blocker 재분류(B-01·B-03·B-05·B-07 해제, B-04 동결, B-06 해소).
> ⑭ **E** stale 참조 3건 정정(945행 → `§20 M11`, 1315행 → `M11·M12`, 1754행 → `§20.4 C10`).
> ⑮ **F** 앱 계약 v1.1 동기화 기준(공용 함수·오류코드·GRANT·envelope)을 §19.5에 고정.
> 말미에 **rev 8 반영 추적표** 수록.

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
- **부수 기록 (rev 8 A-5 — 재생 경로의 인접 잠재 결함, 실측):** 정본 `confirm_subscription_checkout`은 **재생(멱등) 경로에서도** `mentor_plans`를 `FOR UPDATE`로 잠근 뒤 **현재** `amount_cents`로 기존 원장 `delta_cents`를 대조하고, 불일치 시 `LEDGER_FIELD_MISMATCH`를 반환하며 anomaly 행을 기록한다. 따라서 가격 변경 후의 정당한 재시도가 오탐된다 — v1.0 [C4]의 "정본은 succeeded면 금액 비교 없이 재생 반환"은 **오측**이었다. 이 현행 동작 자체가 XW-04 인접의 잠재 결함이며, TO-BE 해소는 §7 F12(v1.1 재작성)가 담당한다.

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

### 5.2 왜 `core_private`가 필요한가 (측정 근거 — rev 8 A-2로 역할 재정의)

> **v1.1 정정 (rev 8 A-2, 확정 실측):** PostgREST(Supabase Data API)는 **노출 스키마의 함수만** `.rpc()`로 서빙하며, **service_role 키도 스키마 노출 설정을 우회하지 않는다**(Supabase Custom Schemas 문서). 따라서 v1.0처럼 웹 JS가 `core_private`의 F11·F12를 직접 호출하는 계약은 **전부 호출 불가**다. v1.1에서 웹 JS가 부르는 진입점은 **전부 `api_web_v1`에 두고 EXECUTE를 service_role 전용으로 GRANT**한다. `core_private`는 **DB 함수끼리만 호출하는 내부 구현부**로 유지한다.

1. **공용 의미 중복 방지.** 무료질문 방 확보는 웹에 이미 있고(`web@ad076d29:lib/qna/freeQuestionRoom.ts:23`, service_role JS 경로) 앱에는 없다(A2 `roomMissing`). `api_app_v1`이 `ensure_free_question_room`을 새로 만들면 **같은 자격 판정이 JS와 SQL 두 곳에 생긴다** — S1이 진단한 계약 표류가 재발한다. 두 표면 wrapper가 **하나의 `core_private` 구현**을 호출해야 의미가 갈라질 수 없다.
2. **정본 방어선은 GRANT(EXECUTE) 기반이다.** §4.2대로 `api_web_v1`의 객체는 브라우저가 직접 부를 수 있다고 가정해야 한다. 자금 확정 계약(F11·F12)은 `api_web_v1`에 두되 `anon`/`authenticated`에 EXECUTE를 부여하지 않고 **service_role에만 EXECUTE를 부여**하는 것이 정본 방어선이다. 스키마 비노출(`core_private`)은 방어선이 아니라 **내부 구현부의 은닉 수단**으로만 기술한다 — v1.0의 "비노출 스키마가 유일한 구조적 방어" 논리는 **폐기**한다(rev 8 A-2 §4).

### 5.3 스키마 생성·기본 권한 (정확한 DDL)

```sql
-- 5.3.1 외부 노출 스키마
CREATE SCHEMA IF NOT EXISTS api_web_v1;
REVOKE ALL ON SCHEMA api_web_v1 FROM PUBLIC;
GRANT USAGE ON SCHEMA api_web_v1 TO anon, authenticated, service_role;

-- 5.3.2 내부 전용 스키마 (rev 8 A-2·A-6: 외부 역할 완전 봉인)
CREATE SCHEMA IF NOT EXISTS core_private;
REVOKE ALL ON SCHEMA core_private FROM PUBLIC;
-- PUBLIC·anon·authenticated·service_role 어디에도 USAGE 를 주지 않는다.
-- (v1.0 의 GRANT USAGE ... TO service_role 은 폐기 — service_role 도 core_private 를
--  직접 호출하지 않으며, 내부 구현부는 api_web_v1 의 SECDEF wrapper 가 소유자 권한으로만 호출한다)

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

- Supabase Dashboard(또는 프로젝트 설정)의 **Exposed schemas**에 `api_web_v1`을 추가한다(**D-API-W**). `api_app_v1`도 같은 방식으로 추가된다(**D-API-A** — 앱 계약 §3.1). **이 두 단계는 SQL migration이 아니라 플랫폼 설정이며, 시점·검증·rollback 절차는 §20.6이 정본이다.**
- `core_private`는 **절대 추가하지 않는다.** 노출 여부는 §21 T-PERM-03 테스트로 회귀 감시한다.
- 대시보드가 Exposed schemas를 관리하는 상태에서는 임의로 `ALTER ROLE authenticator SET pgrst.db_schemas`를 실행하지 않는다(§20.6).
- `public`은 레거시 호환 때문에 S2에서 **계속 노출 상태로 유지**한다(§18).

---

## 6. 신규 view 전체 목록과 정확한 필드 `[TO-BE]`

조회 계약 총 **7개**(V1~V7). 각 조회 계약은 (a) 앱과의 사용자 관점 동등성 요구, 또는 (b) §3.6에서 측정된 결함 해소 중 하나를 근거로 한다. 근거 없는 객체는 만들지 않는다.

> **v1.1 구현 형태 확정 (rev 8 A-9 — F0 폐기에 따른 객체별 결정).** 공개 라벨 함수 F0(`user_display_label`/`user_display_role`)는 **폐기**한다(§7 F0). 라벨이 필요한 V2·V6·V7은 A-9의 허용 범위 — ① `security_invoker = true` 뷰 + 비정규화 라벨 컬럼, ② 관계를 내부에서 검증하는 범위 제한 `SECURITY DEFINER` RPC — 안에서 **객체별로** 다음과 같이 확정한다. 임의 UUID를 받는 라벨 함수와 일반(invoker 미지정) SECURITY DEFINER 뷰는 금지한다.
>
> | 객체 | 확정 구현 | 근거 |
> |---|---|---|
> | **V2** | **①** `security_invoker` **뷰 유지** + `public.comments`에 `author_label`·`author_role` **비정규화**(M13: 컬럼 2 + BEFORE INSERT 트리거 + 백필) | 공개 커뮤니티 읽기(anon 포함)라 뷰 유지 가치가 크고, `community_posts`가 이미 같은 비정규화 패턴의 실측 선례다. U-11을 이 결정으로 해소 |
> | **V6** | **②** 범위 제한 SECDEF RPC `api_web_v1.my_subscriptions_self()` | 본인 당사자 한정(T2) 조회 — `auth.uid()` 당사자 검증을 함수 내부에서 수행. 라벨 비정규화(구독·정산 행에 nickname 동기화)보다 갱신 표류 위험이 없다 |
> | **V7** | **②** 범위 제한 SECDEF RPC `api_web_v1.mentor_settlement_self()` | V6과 동일 성격(멘토 본인 한정) |

| # | 조회 계약 | 구현 형태 | 호출자 | 근거 |
|---|---|---|---|---|
| V1 | `api_web_v1.community_posts_v1` | invoker 뷰 | T1(anon)+T2 | **앱 계약 §3.2와 필드 동등** — 공용 기능 계약 일치 |
| V2 | `api_web_v1.community_comments_v1` | invoker 뷰 + 비정규화 라벨(M13) | T1+T2 | XW-09 `comments`/`community_comments` 이중화 수렴 |
| V3 | `api_web_v1.mentor_directory_v1` | SECDEF 뷰(의도된 예외) | T1 | XW-02b 승인 필터를 DB로 이동 |
| V4 | `api_web_v1.my_wallet_v1` | invoker 뷰 | T2 | 자기 지갑 단일 계약 |
| V5 | `api_web_v1.my_cash_ledger_v1` | invoker 뷰 | T2 | **W3 주문 참조를 사용자에게 노출하는 지점**(topup 정본 = `idempotency_key`, rev 8 A-6) |
| V6 | `api_web_v1.my_subscriptions_self()` | **범위 제한 SECDEF RPC** | T2 | XW-10 프로빙 경로 대체 |
| V7 | `api_web_v1.mentor_settlement_self()` | **범위 제한 SECDEF RPC** | T2(멘토) | 직접 테이블 조회 대체 |

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
- `author_label` / `author_role` = **`comments.author_label` / `comments.author_role` 비정규화 컬럼**(rev 8 A-9 — v1.1 확정, M13).
  - **왜 join도 함수도 아닌 비정규화인가(측정 근거):** `users`의 SELECT 정책은 `users_select_own`(`id = auth.uid()`)과 `users_admin_select_all`(admin)뿐이라 일반 사용자는 `security_invoker` view에서 **다른 사용자 행을 읽을 수 없다**(테이블 정책은 총 4종: select_own, admin_select_all, insert_own, update_own). v1.0은 이를 좁은 SECDEF 라벨 함수(F0)로 풀었으나, **임의 uuid → nickname 조회가 열리는 트레이드오프**가 있었고 rev 8 A-9가 공개 라벨 함수를 폐기했다. `community_posts`는 이미 `author_label`·`author_role`을 비정규화해 갖고 있다(실측 선례) — `comments`에 같은 패턴을 적용한다.
  - **비정규화 계약(M13):** ① `public.comments`에 `author_label text`·`author_role text` 컬럼 추가 ② BEFORE INSERT 트리거(`public.comments_set_author_label()`)가 `public.users`에서 `nickname`·`role`을 복사 — `nickname`이 비었으면 `'쌤버십 사용자'` 고정 문구, `role='admin'`이면 `author_role`에 **NULL** 기록(관리자 신원 비노출 — 구 F0 규칙 승계) ③ 기존 행 백필 1회.
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

목적: 자기 캐시 원장 조회 + **Toss 주문 참조 노출**(topup 정본 `idempotency_key`의 사용자 가시 지점 — rev 8 A-6).

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
- `order_ref` 규약 (**rev 8 A-6 — topup 정본은 `idempotency_key` 단독**, `ref_text` 컬럼·M2는 폐기):
  ```
  order_ref = CASE WHEN ref_type = 'topup' THEN idempotency_key END
  ```
  - topup의 주문 정본은 `cash_ledger.idempotency_key`(= Toss `orderId`, UNIQUE 제약 실재)다. 정본 공인 문서 `docs/sql/topup-ref-id-canon.md`를 전부 유지한다 — `ref_id`는 **NULL이 정상**이고, 신규 DDL은 불요하다.
  - `ref_type='topup'`으로 **한정**하는 이유: 충전 행에서만 `idempotency_key`가 Toss `orderId`와 같다(실측 — `record_cash_topup`이 `p_idempotency_key`에 orderId를 그대로 넣는다). 구독 차감(`sub_debit_{payment_id}`)·IQ escrow(`iq_hold:{qid}` 등)의 키는 주문번호가 아니므로 노출하면 의미가 왜곡된다. 그 외 행의 `order_ref`는 **NULL**이다.
  - `idempotency_key`를 전 행에 **그대로 노출하는 컬럼은 두지 않는다.** 멱등키는 내부 dedup 수단이며, topup 행에서만 "주문번호"라는 사용자 의미를 갖기 때문에 위 CASE로 한정 노출한다.
- `WITH (security_invoker = true)` — `cled_select`(`user_id = auth.uid()`)로 본인 행만.

### V6 `api_web_v1.my_subscriptions_self()` — 범위 제한 SECDEF RPC (rev 8 A-9 객체별 확정)

```sql
api_web_v1.my_subscriptions_self() RETURNS TABLE (
  subscription_id            uuid,
  mentor_id                  uuid,
  mentor_label               text,
  plan_id                    uuid,
  plan_tier                  text,
  current_plan_amount_cents  integer,
  status                     text,
  started_at                 timestamptz,
  current_period_start       timestamptz,
  current_period_end         timestamptz,
  next_billing_at            timestamptz,
  cancel_at_period_end       boolean,
  grace_until                timestamptz,
  created_at                 timestamptz
)
```

- **구현 형태(확정):** 뷰가 아니라 **관계를 내부에서 검증하는 범위 제한 `SECURITY DEFINER` RPC**다. 함수 첫머리에서 `auth.uid() IS NULL → AUTH_REQUIRED`(빈 결과가 아니라 예외 42501)를 검사하고, `WHERE auth.uid() IN (subscriptions.student_id, subscriptions.mentor_id)` — 정본 정책 `subscriptions_select_parties`와 동일한 당사자 판정식 — 으로 **자기 당사자 행만** 반환한다. 따라서 이 RPC는 **멘토 쪽에서도** 자기 구독자 목록으로 쓰인다.
- 원천은 `public.subscriptions` **한 테이블만**. `SUB_TABLES` 프로빙(`mentor_subscriptions`·`user_subscriptions`)은 쓰지 않는다 — 두 테이블은 **실측 부재**다(XW-10).
- **`current_plan_amount_cents`** — 라이브 `mentor_plans`를 `plan_id`로 join해 읽는 **현재 플랜 가격**이다. 필드명은 rev 8 §6.4로 **단일 확정**됐다: 값의 실질 의미가 "현재 플랜 가격"이므로 `amount_cents`(의미 불명)나 다른 이름을 쓰지 않는다. `next_renewal_amount_cents`는 실제 다음 결제 금액을 별도 고정·스냅샷하는 계약이 생겼을 때 additive 필드로만 검토하며 v1.1에서는 사용하지 않는다.
- `mentor_label`은 함수 내부에서 `public.users.nickname`으로 도출한다(비었으면 `'쌤버십 사용자'` 고정 문구 — 구 F0 라벨 규칙 승계. `full_name`·`email`·`birth_date`는 어떤 필드로도 반환하지 않는다). 임의 UUID 라벨 함수는 존재하지 않으므로(F0 폐기) 라벨은 **당사자 관계가 검증된 행에 결합된 형태로만** 노출된다. 필드 구성은 v1.0 V6과 동일하며 `amount_cents`의 개명 1건만 다르다.
- `SECURITY DEFINER`, `STABLE`, `SET search_path = ''`, 완전 수식 객체명. EXECUTE는 `authenticated`·`service_role`(§10.3).

### V7 `api_web_v1.mentor_settlement_self()` — 범위 제한 SECDEF RPC (rev 8 A-9 객체별 확정)

```sql
api_web_v1.mentor_settlement_self() RETURNS TABLE (
  item_id             uuid,
  subscription_id     uuid,
  student_label       text,
  event_type          text,
  billing_at          timestamptz,
  period_start        timestamptz,
  period_end          timestamptz,
  gross_cents         bigint,
  platform_fee_cents  bigint,
  mentor_amount_cents bigint,
  fee_rate            numeric,
  status              text,
  hold_reason         text,
  paid_at             timestamptz,
  created_at          timestamptz
)
```

- **구현 형태(확정):** 뷰가 아니라 **관계를 내부에서 검증하는 범위 제한 `SECURITY DEFINER` RPC**다. 함수 첫머리에서 `auth.uid()` 존재를 검사하고, `WHERE subscription_settlement_items.mentor_id = auth.uid()` — 정본 정책 `ssi_select_mentor_own`과 동일한 판정식 — 으로 **자기 정산 항목만** 반환한다.
- 원천 `public.subscription_settlement_items`. authenticated GRANT가 이미 `SELECT,REFERENCES,TRIGGER,TRUNCATE`로 축소돼 있어 직접 쓰기 경로가 없다(실측).
- `student_label`은 함수 내부에서 `public.users.nickname`으로 도출한다(V6과 동일 규칙 — F0 폐기에 따른 내부 도출). 라벨은 자기 정산 항목이라는 **검증된 관계의 행에 결합된 형태로만** 노출된다.
- **`idempotency_key`·`ledger_id`·`payment_id`는 노출하지 않는다**(내부 참조).
- `due_payouts` view는 계속 `service_role` 전용으로 두고 이 RPC로 대체하지 않는다(§18).
- `SECURITY DEFINER`, `STABLE`, `SET search_path = ''`, 완전 수식 객체명. EXECUTE는 `authenticated`·`service_role`(§10.3).

---

## 7. 신규 function 전체 목록과 정확한 입력 시그니처 `[TO-BE]`

총 **20개 함수** (`api_web_v1` 14 + `core_private` 6). 계층은 §4.1 코드로 표기한다.

> **v1.1 구조 변경 요약(rev 8):** ① F0 공개 라벨 함수 2종 **폐기**(A-9) ② F4/F5 **필수 인자 선행 재배열**(A-1) ③ F11·F12의 **외부 진입점을 `api_web_v1`로 이동**(A-2 — service_role 전용 GRANT), F11은 3층 분리(A-6) ④ **F13**(정산계좌, A-4)·V6/V7 RPC(A-9)·공용 구현부 4종(B) 신설 ⑤ F10은 `core_private` 내부 구현부로 유지하되 **웹 JS 직접 호출 경로는 삭제**(A-2 — F12가 내부 호출).
>
> **외부 진입점 / 내부 구현부 구분(F10·F11·F12):**
>
> | 계약 | 외부 진입점 (`api_web_v1`, 웹 JS가 `.rpc()`로 호출) | 내부 구현부 (`core_private`, DB 함수끼리만 호출) |
> |---|---|---|
> | 방 확보 | F2 (T2) — *T4a 직접 진입점 없음* | **F10** `ensure_student_mentor_room` (F2·F12가 호출) |
> | 캐시 충전 원장 | **F11** `record_cash_topup_v2` (T4a, service_role 전용) | `record_cash_topup_impl` (F11과 레거시 `public.record_cash_topup`이 호출) |
> | 구독 checkout 확정 | **F12** `subscription_checkout_confirm_v2` (T4a, service_role 전용) | F10 재사용(방 확보·복구) + 정본 `public.confirm_subscription_checkout`(최초 실행 한정) |

| # | 함수 | 계층 | 반환 |
|---|---|---|---|
| ~~F0~~ | ~~`user_display_label` / `user_display_role`~~ — **폐기(rev 8 A-9).** 라벨은 V2 비정규화 컬럼·V6/V7 RPC 내부 도출로 대체 | — | — |
| F1 | `api_web_v1.weekly_question_usage_self(p_mentor_id uuid)` | T2 | `jsonb` |
| F2 | `api_web_v1.ensure_free_question_room(p_mentor_id uuid)` | T2 | `jsonb` |
| F3 | `api_web_v1.qna_create_question_thread(p_room_id uuid, p_title text, p_subject text DEFAULT NULL, p_topic text DEFAULT NULL, p_first_message_body text DEFAULT NULL)` | T2 | `jsonb` |
| F4 | `api_web_v1.community_post_create(p_title text, p_body text, p_category text, p_idempotency_key uuid, p_image_refs text[] DEFAULT '{}', p_status text DEFAULT 'published')` — **rev 8 A-1 재배열** | T2(멘토) | `jsonb` |
| F5 | `api_web_v1.community_post_update(p_post_id uuid, p_title text, p_body text, p_category text, p_expected_updated_at timestamptz, p_image_refs text[] DEFAULT '{}', p_status text DEFAULT 'published')` — **rev 8 A-1 재배열** | T2 | `jsonb` |
| F6 | `api_web_v1.community_post_soft_delete(p_post_id uuid)` | T2 | `jsonb` |
| F7 | `api_web_v1.mentor_profile_update_self(p_university_name text, p_department_name text, p_high_school_name text, p_teaching_subjects text[], p_intro_line text, p_bio text, p_answer_style text, p_profile_image_url text, p_is_open_for_subscriptions boolean)` | T2(멘토) | `jsonb` |
| F8 | `api_web_v1.mentor_plan_prices_set_self(p_limited_cash_krw integer, p_standard_cash_krw integer, p_premium_cash_krw integer)` | T2(멘토) | `jsonb` |
| F9 | `api_web_v1.account_deletion_status_self()` | T2 | `jsonb` |
| F10 | `core_private.ensure_student_mentor_room(p_student_id uuid, p_mentor_id uuid, p_payment_id uuid DEFAULT NULL, p_subscription_id uuid DEFAULT NULL, p_require_entitlement boolean DEFAULT true)` — **내부 구현부**(외부 EXECUTE 0) | 내부 | `jsonb` |
| F11 | `api_web_v1.record_cash_topup_v2(p_user_id uuid, p_amount_cents bigint, p_order_ref text)` — **rev 8 A-2·A-6: 3인자 envelope wrapper, `api_web_v1` 이동** | T4a | `jsonb` |
| F11i | `core_private.record_cash_topup_impl(p_user_id uuid, p_amount_cents bigint, p_idempotency_key text)` — **공용 원자 구현부**(rev 8 A-6) | 내부 | `jsonb` |
| F12 | `api_web_v1.subscription_checkout_confirm_v2(p_payment_id uuid, p_plan_id uuid, p_expected_amount_cents integer, p_idempotency_key text DEFAULT NULL)` — **rev 8 A-2: `api_web_v1` 이동** | T4a | `jsonb` |
| F13 | `api_web_v1.mentor_payout_account_update_self(p_bank_name text, p_account_number text)` — **신설(rev 8 A-4, U-06 해소)** | T2(멘토) | `jsonb` |
| V6 | `api_web_v1.my_subscriptions_self()` — §6 V6 (조회 RPC) | T2 | `TABLE` |
| V7 | `api_web_v1.mentor_settlement_self()` — §6 V7 (조회 RPC) | T2(멘토) | `TABLE` |
| B-1 | `core_private.community_post_create_impl(p_author_id uuid, p_title text, p_body text, p_category text, p_image_refs text[], p_status text, p_idempotency_key uuid)` — 공용 구현부(§7 F4·F5·F6) | 내부 | `jsonb` |
| B-2 | `core_private.community_post_update_impl(p_author_id uuid, p_post_id uuid, p_title text, p_body text, p_category text, p_image_refs text[], p_status text, p_expected_updated_at timestamptz)` | 내부 | `jsonb` |
| B-3 | `core_private.community_post_soft_delete_impl(p_author_id uuid, p_post_id uuid)` | 내부 | `jsonb` |
| B-4 | `core_private.community_image_refs_validate(p_owner_id uuid, p_image_refs text[])` — 공용 이미지 ref 검증기 | 내부 | `jsonb` |

**신규 객체를 만들지 않는 영역(의도적):** 개별질문 escrow, 맞춤의뢰 lifecycle, 정산 지급(`pay_due_payouts_for_run`·`run_scheduled_payout`), 환불 승인·거절, 알림, 계정 탈퇴 worker 체인, 공개 멘토 조회 RPC 3종. 이들은 이미 `service_role` 전용이거나 함수 내부 `auth.uid()` 검증이 있고, 이번 세션에서 **측정된 결함이 없다.** S2에서 건드리지 않는다(§18 "유지").

### F0 — **폐기** (rev 8 A-9: 관계 확인된 조회 내부로 축소)

v1.0의 공개 라벨 함수 2종(`api_web_v1.user_display_label(uuid)` / `user_display_role(uuid)`)은 **만들지 않는다.** 임의 UUID를 받는 라벨 함수는 uuid → nickname 조회를 아무 관계 검증 없이 여는 표면이었다(v1.0 §10.3이 스스로 기록한 트레이드오프).

- **대체 계약(객체별 — §6 확정표):**
  - **V2**: `comments.author_label`·`author_role` **비정규화 컬럼**(M13). 라벨 도출 규칙(nickname → 비었으면 `'쌤버십 사용자'`, admin → `author_role` NULL)은 비정규화 트리거가 승계한다.
  - **V6·V7**: 범위 제한 SECDEF RPC가 **함수 내부에서** `public.users.nickname`을 도출한다. 라벨은 당사자·소유 관계가 검증된 행에 결합된 형태로만 반환된다.
  - **V1·V3**: 변경 없음 — V1은 `community_posts`의 기존 비정규화 컬럼을, V3은 SECDEF 뷰 정의 내부 join을 이미 사용한다(F0 의존 없음).
- **승계되는 라벨 공통 규칙(구 F0 규칙 — 모든 라벨 도출 지점에 동일 적용):** `public.users.nickname`만 사용, 비었으면 `'쌤버십 사용자'` 고정 문구, **`full_name`·`email`·`birth_date`·`grade_level`은 절대 반환하지 않는다.** 표시 역할은 `'student'|'mentor'`만, `admin`이면 `'mentor'`로 강등 표기하지 않고 **NULL**(관리자 신원 노출 금지). 존재하지 않는 uid → 고정 문구 / NULL.
- 금지(재확인): 임의 UUID를 받는 라벨 함수, 일반(invoker 미지정) SECURITY DEFINER 뷰.
- v1.0의 M3(라벨 헬퍼 마이그레이션)은 **retired** 처리한다(§20.2).

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
- **레거시 하드닝 병행(rev 8 A-8 — v1.1 필수, M15):** F1 신설만으로는 레거시 `public.get_weekly_question_usage`의 IDOR(XW-01)가 닫히지 않는다. 단, `p_student_id = auth.uid()` 단순 하드닝은 웹 **멘토** 질문방 2곳(`app/(mentor)/mentor/question-room/[roomId]/page.tsx:109`, `.../thread/[threadId]/page.tsx:108`)이 `(studentId, user.id=멘토)`로 호출하므로 파손을 유발한다 — **student self가 아니라 pair party가 정답**이다. 레거시 함수 첫머리에 다음 **NULL-safe pair-party 가드**를 추가한다(오너 확정 형태 고정):

  ```sql
  IF (auth.jwt() ->> 'role') IS DISTINCT FROM 'service_role'
     AND auth.uid() IS DISTINCT FROM p_student_id
     AND auth.uid() IS DISTINCT FROM p_mentor_id
  THEN
    RAISE EXCEPTION 'NOT_PAIR_PARTY'
      USING ERRCODE = '42501';
  END IF;
  ```

  `IN`·일반 `<>`는 NULL로 인해 예기치 않게 통과할 수 있으므로 금지한다. **`IS DISTINCT FROM`만 사용**한다.
  - **유지 확인(실측 완료):** ① `qna_create_question_thread`(학생 본인 생성) 유지 ② `qt_direct_write_guard`(학생 본인 직접 생성) 유지 ③ 웹 멘토 질문방(멘토 ID = `auth.uid()`) 유지 ④ anon·제3자 차단. service_role(`weeklyQuestionUsageServer.ts`, e2e admin)은 통과한다.
  - anon EXECUTE 회수(U-08)는 별도 검토 항목으로 유지한다.

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
-- rev 8 A-1: 필수 인자 전부 선행, DEFAULT 인자 전부 후행.
--  v1.0 시그니처(DEFAULT 뒤 필수 인자)는 CREATE FUNCTION 자체가 42P13 으로 실패하는
--  생성 불가 시그니처였다. 앱 계약 §3.3(원출처)도 동일하게 재배열한다.
api_web_v1.community_post_create(
  p_title text, p_body text, p_category text,
  p_idempotency_key uuid,
  p_image_refs text[] DEFAULT '{}', p_status text DEFAULT 'published'
) RETURNS jsonb

api_web_v1.community_post_update(
  p_post_id uuid, p_title text, p_body text, p_category text,
  p_expected_updated_at timestamptz,
  p_image_refs text[] DEFAULT '{}', p_status text DEFAULT 'published'
) RETURNS jsonb

api_web_v1.community_post_soft_delete(p_post_id uuid) RETURNS jsonb
```

- **호출 규약(rev 8 A-1):** 호출부는 위치 인자가 아니라 **named notation**(`p_title => …, p_idempotency_key => …`)을 사용한다. Supabase JS `.rpc()`의 객체 인자는 named 호출이므로 이 규약과 자연 일치한다 — 계약으로 명시하는 이유는 SQL 직접 호출·테스트 코드에서 인자 순서 의존을 금지하기 위해서다.
- **작성 자격(rev 8 A-10 — 제품 정책 확정, 승인 멘토 전용):**
  - F4 create는 **`users.role = 'mentor'`만 허용**한다. 위반 시 `ROLE_NOT_MENTOR`.
  - 멘토지만 미승인이면 `MENTOR_NOT_APPROVED`. 승인 판정은 기존 헬퍼 **`individual_question_user_is_approved_mentor(auth.uid())`** 를 사용한다(정본 checkout과 동일 기준 — 판정식 이원화 금지).
  - **관리자도 일반 작성 경로에서는 거부**한다(관리자 공지 경로는 별도 계약).
  - **기존 학생 글 보존:** 열람 유지 · 수정(F5) 금지 · 작성자 본인의 F6 soft-delete 허용 · 관리자 moderation은 별도 경로(service_role) 유지. 파괴적 정리(일괄 삭제·비공개화)는 금지한다.
  - F5(update)·F6(soft_delete)는 **작성자 본인**(`author_id = auth.uid()`) 기준을 유지한다 — 단 F5는 위 보존 규칙에 따라 학생 작성 글에는 적용되지 않는다(학생은 수정 대상 글을 신규 생성할 수 없으므로 기존 글 수정도 거부 — `ROLE_NOT_MENTOR`).
- 시그니처·반환·오류코드는 `api_app_v1`의 동명 함수와 **완전 동일**하다(앱 계약 §3.3 — v1.1에서 A-1 재배열·A-10 자격 규칙까지 동일하게 동기화, §19.5). 검증 규칙을 웹·앱 각각 만들지 않는다.
- **공용 구현부(rev 8 B — v1.1 전건 명세, §7 표 B-1~B-4):** 웹 F4/F5/F6과 앱 동명 함수는 **같은 `core_private` 구현부**를 호출하는 얇은 wrapper다.
  - `core_private.community_post_create_impl(p_author_id uuid, p_title text, p_body text, p_category text, p_image_refs text[], p_status text, p_idempotency_key uuid) RETURNS jsonb`
  - `core_private.community_post_update_impl(p_author_id uuid, p_post_id uuid, p_title text, p_body text, p_category text, p_image_refs text[], p_status text, p_expected_updated_at timestamptz) RETURNS jsonb`
  - `core_private.community_post_soft_delete_impl(p_author_id uuid, p_post_id uuid) RETURNS jsonb`
  - `core_private.community_image_refs_validate(p_owner_id uuid, p_image_refs text[]) RETURNS jsonb` — 공용 이미지 ref 검증기(아래 검증 5종 수행, 실패 시 `{ok:false, code}` 반환)
  - 보안 속성(4종 공통): **`SECURITY INVOKER`**(SECDEF wrapper의 소유자 권한 문맥에서 실행됨), `SET search_path = ''`, 모든 객체 참조 완전 수식, owner = migration 실행 역할. **GRANT: 없음** — `PUBLIC`·`anon`·`authenticated`·`service_role` 전부 EXECUTE 미부여(§10.3). wrapper(웹 F4/F5/F6, 앱 동명 함수)만 `SECURITY DEFINER`다. 함수 생성과 권한 회수는 같은 마이그레이션(M7)에서 수행한다.
  - 역할·승인·계정 상태·본문 검증은 **구현부에서** 수행한다(wrapper는 `auth.uid()` 도출 + envelope 전달만). 판정이 wrapper마다 갈라질 수 없다.
- 클라이언트가 보낸 `author_id`·`author_role`·`author_label`은 **받지 않는다.** wrapper가 `auth.uid()`와 `public.users`에서 도출해 `p_author_id`로 전달한다.
- **본문 검증(rev 8 D — B-04 동결):** 공용 검증부는 **연락처 마스킹만** 수행한다. 금지어 검사는 폐지가 확정됐고(`lib/safety/trustSafetyText.ts` 주석 실측 — 의도적 폐지), **`POLICY_RESTRICTED`는 예약 코드이며 발생하지 않는다.** 오너가 금지어를 복원하면 additive 개정으로 처리한다.
- 반환:
  - create 성공: `{ok:true, contract_version:1, post_id, idempotent_replay:false}` / 멱등 재생: `idempotent_replay:true` + 기존 `post_id`
  - update 성공: `{ok:true, contract_version:1, post_id, updated_at, removed_image_refs:[…]}`
  - soft_delete 성공: `{ok:true, contract_version:1, post_id, deleted_at}`
- 멱등: create는 `p_idempotency_key` **필수**, `(author_id, create_idempotency_key)` 기준. 근거: `community_posts_author_idem_key` UNIQUE INDEX가 이미 존재한다(실측). **응답 유실·불명확 시 같은 멱등키로 F4를 재호출하는 것이 생성 복구의 정본 경로다**(rev 8 C — 이미 성공했으면 기존 `post_id` 반환, 실패했으면 트랜잭션 롤백이라 지울 행이 없다). **응답 불명확·유실은 실패 확정이 아니므로, Storage 신규 객체는 재호출로 성공/실패가 확정되기 전에는 삭제하지 않는다**(§14.4 보상 규약 — 재호출 선행·보상 삭제 후행). authenticated hard-delete 보상 RPC는 **만들지 않는다.**
- **F4 멱등 재생 판정 우선순위(replay-first):** 재생 판정은 신규 쓰기 검증보다 **먼저**다.
  1. `auth.uid()` 확인 및 author binding(`p_author_id = auth.uid()` 도출) **직후**, 역할·승인·계정 write-block·본문·이미지 ref 등 **신규 쓰기 검증보다 먼저** `(author_id, create_idempotency_key)`로 **기존 커밋 행을 조회**한다.
  2. 기존 행이 있으면 — 새 쓰기와 Storage 삭제 **없이** — 기존 `post_id` + `idempotent_replay:true`를 반환한다(재생 성공은 현재 시점의 역할·승인·본문 재검증 결과에 좌우되지 않는다 — 이미 커밋된 사실의 멱등 확인이기 때문).
  3. 기존 행이 **없을 때만** 신규 쓰기 검증(작성 자격·계정 상태·본문·이미지 ref)과 INSERT를 수행한다.
  4. **단순 재호출 오류(연결 실패·timeout·예상 밖 SQL 예외 전파)는 "미커밋 확인"으로 간주하지 않는다** — 성공도 확정 실패도 아니므로 §14.4대로 객체를 보존한 채 재시도한다. "미커밋 확인"은 이 replay-first 조회가 기존 행 없음을 판정하고 신규 경로가 **확정 실패 envelope**(`ok:false` 도메인 거부) 또는 rollback으로 종결된 경우만이다.
- update는 `p_expected_updated_at`으로 낙관적 충돌 검사 → 불일치 시 `UPDATE_CONFLICT`.
- soft_delete는 `deleted_at`을 세우고 **행을 지우지 않는다.** hard delete를 하지 않는다(XW-09 대응의 계약 측면. `community_posts` 직접 쓰기 자체의 전면 회수는 §14.7 **HD-1**(M16)이 담당한다 — rev 8 C. v1.0의 "§20 M8 선택 항목" 참조는 삭제: M8은 F7·F8 멘토 RPC 마이그레이션으로 **불변**이며 HD-1은 M8에 얹지 않는 별도 마이그레이션이다).
- 이미지 ref 검증(공용 검증기 B-4, 각 ref마다 전부): 허용 버킷인지 / path 첫 세그먼트가 `p_owner_id`(= 호출 wrapper의 `auth.uid()`)인지 / `storage.objects`에 실제 존재하는지 / 소유자·MIME·크기가 계약과 맞는지 / 개수 ≤ 5.
- wrapper는 `SECURITY DEFINER`, `SET search_path = ''`.

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
  - 정산 계좌(`payout_*`)는 자금 수취 대상이므로 프로필 수정과 **분리한다** — 별도 계약은 **F13 `mentor_payout_account_update_self`**(rev 8 A-4)로 v1.1에서 확정했다(구 U-06 해소).
- 검증: `auth.uid()` 존재, `users.role='mentor'`, 계정 write-block 아님, 본인 `mentor_profiles` 행 존재.
- `p_teaching_subjects`는 `public.subjects.code`에 존재하는 값만 남기고 나머지는 버린다(정본 `qna_create_question_thread`가 subject를 검증하는 방식과 동일).
- 반환: `{ok:true, contract_version:1, updated_at}` / 실패 `{ok:false, contract_version:1, code}`.
- 오류코드: `AUTH_REQUIRED`, `ROLE_NOT_MENTOR`, `ACCOUNT_BANNED`, `ACCOUNT_SUSPENDED`, `ACCOUNT_DELETION_IN_PROGRESS`, `MENTOR_PROFILE_NOT_FOUND`, `UNIVERSITY_NAME_REQUIRED`, `DEPARTMENT_NAME_REQUIRED`, `PROFILE_IMAGE_REF_INVALID`.
- `SECURITY DEFINER`, `SET search_path = ''`.
- **이 함수가 있어야 §10.6의 `mentor_profiles` 전면 회수가 가능하다.** 순서: F7 배포 → 웹 callsite 전환(F13·가입 백업 upsert 제거 병행) → 테이블 단위 REVOKE(**§20 M11**). *(v1.1 정정 — rev 8 E-1: 구 "컬럼 REVOKE(§20 M9)" 참조를 M11로 교체. 컬럼 단위 REVOKE 자체가 무효임은 §10.6/rev 8 A-3 참조.)*

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

- **웹 F2·앱 `api_app_v1.ensure_free_question_room`·F12(구독 확정 내부 경로)가 모두 이 함수로 수렴한다.**
- **v1.1 진입점 재설계(rev 8 A-2 — 오너 채택):** 이 함수는 Data API로 도달 불가한 `core_private`에 있으므로 **웹 JS가 직접 호출하는 계약을 전부 삭제**한다(§17 #3 삭제). 구독 확정 시 방 확보는 **F12가 내부에서 이 함수를 호출하고 응답에 `room_id`를 포함해 반환**한다 — 구독 성공 시 질문방 존재는 **필수 불변조건**으로 승격된다. (대안이던 `api_web_v1.ensure_student_mentor_room_server`는 채택하지 않는다.)
- `p_student_id`를 인자로 받는 이유: 구독 확정(F12 내부)은 학생 세션이 아닌 서버 컨텍스트에서 실행되므로 `auth.uid()`를 쓸 수 없다. 대신 **T2 wrapper(F2)가 `auth.uid()`를 넣어 호출**하고, 이 함수 자체는 어떤 외부 역할에도 EXECUTE를 주지 않는다(§10) → 클라이언트가 임의 `p_student_id`를 넣을 경로가 없다.
- `p_require_entitlement=true`(F2 경로): 무료질문 자격 또는 활성 구독을 검사한다.
  `false`(F12 구독 확정 경로): 구독이 방금 확정됐으므로 자격 재검사를 건너뛴다.
- `INSERT … ON CONFLICT (student_id, mentor_id) DO NOTHING` + 재조회. 근거: `uq_msr_pair(student_id, mentor_id)` UNIQUE INDEX 실측 존재. 현행 웹의 "INSERT → 23505 감지 → 재조회" 애플리케이션 처리(실측)를 DB 원자 연산으로 대체한다.
- **트랜잭션 의미(rev 8 A-2 §3 — 오너 확정):**
  - **최초 checkout 실행:** 방 확보 실패 시 호출 트랜잭션(F12)의 자금 차감·구독 생성/갱신·원장 기록·결제 상태 변경을 **전부 롤백**한다(부분 성공 금지).
  - **성공 재생:** 기존 자금 처리를 반복하지 않고 방을 조회·복구한 뒤 `room_id`를 반환한다. 재생 중 방 복구 실패는 기존 자금 처리를 건드리지 않고 안정 코드 **`ROOM_ENSURE_FAILED`**로 실패한다(자금 상태는 성공인 채 유지, 재시도 가능) — 상세는 §7 F12 Phase 2.
  - **사전 검사:** 배포 전에 "기존 succeeded 구독 결제 중 `mentor_student_rooms` 행이 없는 건"을 탐지·보정하는 점검 절차를 v1.1 배포 게이트(§20.3)에 둔다.
- 컬럼 프로빙을 하지 않는다 — `mentor_student_rooms` 컬럼은 `id, student_id, mentor_id, payment_id, subscription_id, created_at, updated_at`으로 실측 확정됐다.
- 반환: `{ok:true, room_id, created, entitlement}` / `{ok:false, code}`.
- **보안 속성·GRANT 전건 명세(rev 8 B):** `SECURITY DEFINER`, `SET search_path = ''`, 완전 수식 객체명, owner = migration 실행 역할. **EXECUTE: `PUBLIC`·`anon`·`authenticated`·`service_role` 전부 미부여**(생성과 같은 마이그레이션 M5에서 `REVOKE ALL … FROM PUBLIC` 명시) — 호출자는 SECDEF wrapper(F2·F12·앱 wrapper)의 소유자 권한 문맥뿐이다.

### F11 `api_web_v1.record_cash_topup_v2` — W3 해소 (rev 8 A-2·A-6: 3층 구조로 전면 재확정)

> **topup 정본 확정(rev 8 A-6 — 오너 채택):** 정본 공인 문서 `docs/sql/topup-ref-id-canon.md`를 **전부 유지**한다 — 주문 정본은 `idempotency_key`(= Toss `orderId`, UNIQUE 제약 `cash_ledger_idempotency_key_key` 실재), `ref_id`는 NULL이 정상, **신규 DDL 불요**, 레거시 `record_cash_topup` 3인자 유지. 이 정본과 충돌하던 v1.0의 **`ref_text` 컬럼·M2 마이그레이션·4인자 F11은 전부 폐기**한다(`p_idempotency_key = p_order_ref`를 강제하는 이상 `ref_text`는 같은 문자열의 중복 저장일 뿐 새 추적 정보를 제공하지 않는다). F11은 선행 스키마가 갖춰진 **한 가지 계약**으로만 배포한다.

**3층 구조(rev 8 A-6 — 오너 확정).** 현행 `public.record_cash_topup(uuid,bigint,text)`의 실측 계약은 `RETURNS void` · `SECURITY DEFINER` · service_role 전용 EXECUTE · `ON CONFLICT DO NOTHING RETURNING id` · **duplicate이면 지갑 미갱신·무음 반환**이다. F11의 엄격 대조를 공용 구현부에서 바로 예외로 던지면 이 무음 duplicate 계약이 깨지므로 세 층으로 분리한다. **사전 SELECT로 신규/duplicate를 추정하는 구현은 금지한다**(동시 호출에서 둘 다 신규로 오판).

#### 1층 — 공용 원자 구현부 `core_private.record_cash_topup_impl`

```sql
core_private.record_cash_topup_impl(
  p_user_id uuid, p_amount_cents bigint, p_idempotency_key text
) RETURNS jsonb
```

- 같은 트랜잭션에서: ① `INSERT INTO public.cash_ledger (user_id, delta_cents, reason, ref_type, ref_id, idempotency_key) VALUES (p_user_id, p_amount_cents, 'cash_topup', 'topup', NULL, p_idempotency_key) ON CONFLICT (idempotency_key) DO NOTHING RETURNING id` 로 **원자 판정** ② **신규 INSERT일 때만** 지갑 upsert·잔액 가산(`row_count=0`이면 예외 — 부분 실패 전파) ③ duplicate에서는 지갑 갱신 금지 ④ duplicate 행을 **`FOR UPDATE`로 재조회** ⑤ 최소 반환:

  ```text
  ledger_id · inserted · user_id · delta_cents · reason · ref_type · ref_id · idempotency_key
  ```

- **보안 속성(rev 8 A-6·B — 전건 명세):** 함수명 `core_private.record_cash_topup_impl`, 입력 `(uuid, bigint, text)`, 출력 jsonb(위 8필드), schema `core_private`, owner = migration 실행 역할, **`SECURITY INVOKER`**, `SET search_path = ''`, 모든 객체 참조 schema-qualified. **GRANT: 없음** — `PUBLIC`·`anon`·`authenticated`·`service_role`의 직접 USAGE/EXECUTE를 **명시 회수**한다. 함수 생성과 권한 회수는 **같은 마이그레이션(M9)** 에서 수행한다.

#### 2층 — 기존 공개 함수 `public.record_cash_topup` (변경 없음)

- `public.record_cash_topup(uuid,bigint,text) RETURNS void` — 기존 시그니처 · `SECURITY DEFINER` · **service_role 전용 EXECUTE** · **duplicate 무음 반환**을 그대로 유지한다. 내부 구현만 공용 구현부 호출로 바꾸되, 공용 구현부의 반환값은 폐기하고 duplicate mismatch를 새로 외부에 노출하지 않는다.
- 이 함수는 **개발·스테이징 테스트 충전 경로의 정본으로 존속**한다(아래 "테스트 충전 분리").

#### 3층 — 신규 F11 `api_web_v1.record_cash_topup_v2` (strict wrapper)

```sql
api_web_v1.record_cash_topup_v2(
  p_user_id uuid, p_amount_cents bigint, p_order_ref text
) RETURNS jsonb
```

- **3인자 envelope wrapper**다(rev 8 A-6 확정 계약 #1). `p_order_ref`를 **그대로 멱등키로 사용**한다(`p_idempotency_key = p_order_ref` — 별도 인자가 아니다). 스키마는 `api_web_v1`(rev 8 A-2 — `core_private`는 Data API 도달 불가).
- 동작:
  1. 입력 검증: `p_user_id` 필수, `0 < p_amount_cents <= 1000000000`
  2. `p_order_ref` 필수. **Toss 주문 참조 형식 `^cash-(.+)-(\d+)$` 강제**. 불만족 시 `ORDER_REF_INVALID`.
  3. `p_order_ref`에서 파싱한 uuid가 `p_user_id`와 **일치해야 한다**. 불일치 시 `ORDER_REF_OWNER_MISMATCH` — 원장 단계에서도 소유자를 재검증한다(현재는 웹 코드만 검증).
  4. `core_private.record_cash_topup_impl(p_user_id, p_amount_cents, p_order_ref)` 호출.
  5. `inserted=true` → 성공 반환. `inserted=false`(duplicate) → **기존 6필드 NULL-safe 전건 대조**(아래) 후 완전 일치면 `{ok:true, duplicate:true}`(지갑 증분 0), 하나라도 불일치면 `LEDGER_FIELD_MISMATCH`.
- **duplicate 전건 대조 — 기존 6필드, NULL-safe(rev 8 A-6):** 일반 `=`·`<>`는 한쪽이 NULL이면 NULL을 반환해 불일치를 놓치므로 nullable 필드에 금지한다.

  ```text
  user_id           -- IS NOT DISTINCT FROM (p_user_id)
  delta_cents       -- IS NOT DISTINCT FROM (p_amount_cents)
  reason            -- IS NOT DISTINCT FROM 'cash_topup'
  ref_type          -- IS NOT DISTINCT FROM 'topup'   (라이브 topup 원장 4행 전부 'topup' — 2026-07-29 실측)
  ref_id            -- IS NULL (topup 정본 상태)
  idempotency_key   -- = p_order_ref (NOT NULL 강제 후 비교)
  ```

- 반환: `{ok:true, contract_version:1, duplicate:false, ledger_id, balance_cents}` / `{ok:true, …, duplicate:true}` / `{ok:false, contract_version:1, code}`.
- **보안 속성:** `SECURITY DEFINER`, `SET search_path = ''`, owner = migration 실행 역할. EXECUTE는 `PUBLIC`·`anon`·`authenticated` 회수 후 **service_role만 허용**(§10.3). 생성과 권한 회수는 같은 마이그레이션(M9).

#### 테스트 충전 분리 (rev 8 A-6 정정 2 — 오너 확정)

- Toss confirm/webhook(`lib/toss/cashTopupFromPayment.ts`) → **F11** (`^cash-(.+)-(\d+)$` 주문 참조 강제).
- 개발·스테이징 테스트 충전(`lib/cash/walletTopupActions.ts`, 키 형식 `cash_topup_{uid}_{ts}_{hex}`) → **기존 `public.record_cash_topup` 유지.** §17 #13에서 F11 전환 대상에서 **제외**한다. 형식 allowlist를 확장해 `cash_topup_...`을 수용하는 안은 **기각**됐다.
- production에서는 현행대로 테스트 충전 강제 비활성(`CASH_TOPUP_ALLOW_TEST_CHARGE`).
- 이 결함의 성격: 운영 결제 장애가 아니라 개발·스테이징 테스트 경로 장애다(미분리 시 전환 후 항상 `ORDER_REF_INVALID`).

### F12 `api_web_v1.subscription_checkout_confirm_v2` — XW-04 해소 (rev 8 A-2·A-5 전면 재작성)

```sql
api_web_v1.subscription_checkout_confirm_v2(
  p_payment_id uuid, p_plan_id uuid,
  p_expected_amount_cents integer,
  p_idempotency_key text DEFAULT NULL
) RETURNS jsonb
```

- 스키마는 **`api_web_v1`**(rev 8 A-2 — `core_private`는 Data API 도달 불가). EXECUTE는 **service_role 전용**(T4a, §10.3).
- **최초 실행**은 기존 `public.confirm_subscription_checkout(uuid,uuid,text)`를 대체하지 않고 감싼다(기존 함수 유지). **재생(멱등) 판정은 정본에 위임하지 않고 F12가 자체 수행한다**(rev 8 A-5 — v1.0 [C4]의 "정본은 succeeded면 금액 비교 없이 재생 반환"은 **오측**이었다: 정본은 재생 경로에서도 현재 `mentor_plans.amount_cents`로 기존 원장을 대조해 가격 변경 후 정당한 재시도를 `LEDGER_FIELD_MISMATCH` + anomaly로 오탐한다. §3.6 XW-04 부수 기록 참조).
- **방 확보 불변조건(rev 8 A-2):** 성공 응답에 **`room_id`를 포함**한다. 최초 실행에서 방 확보 실패 시 이번 트랜잭션의 자금·원장·구독·결제 변경을 전부 롤백한다.

#### 결제 시점 불변 동의 금액 (rev 8 A-5 — 금액 정본)

재생 판정의 금액 기준은 현재 플랜 가격이 아니라 **결제 시점 불변 동의 금액**이다. 다음 검증을 계약으로 명시한다:

```text
payments.kind = 'subscription'
payments.currency = 'KRW'
payments.amount > 0
payments.amount = trunc(payments.amount)   -- 정수 원 단위
intent_amount_cents = payments.amount × 100
```

- **DB 계약 명시(오너 지시):** 라이브 `payments.amount`는 numeric이며 통화·정수 CHECK 제약이 없다(실측: subscription 결제 2건 모두 `currency='KRW'`·`amount=29900`·소수 0건). 위 KRW·정수 규칙을 v1.1의 **문서 차원 DB 계약**으로 명시하고, CHECK 제약 추가 여부는 **S3 후보**로 기재한다.
- **실데이터 확인(2026-07-29):** 현재 구독 결제 2건 모두 `payments.amount = 29,900(KRW)` · `mentor_plans.amount_cents = 2,990,000` · `payments.amount × 100 = amount_cents` 관계 성립.

#### F12 필수 실행 순서 (이 순서를 벗어나면 교착 또는 멱등 파손이 발생한다)

```
1) public.payments FOR UPDATE (p_payment_id)          -- §12.2 선언 순서 준수 [C3]
2) 재생 판정: payments.status 가 succeeded 계열
     ('succeeded','paid','success','complete','captured') 이면
     → 아래 "재생 계약(Phase 1/Phase 2)"으로 분기한다 (정본 재호출 금지)
--- 이하 최초 실행 경로 ---
3) pg_advisory_xact_lock(hashtext(student_id), hashtext(mentor_id))
4) public.mentor_plans FOR UPDATE (p_plan_id)
5) 3자 일치 검증(오너 확정):
     payments.amount × 100 = p_expected_amount_cents = 잠근 mentor_plans.amount_cents
     셋 중 하나라도 불일치하면 자금 처리 없이 PLAN_AMOUNT_CHANGED 반환(차감 0)
6) 정본 public.confirm_subscription_checkout(p_payment_id, p_plan_id, p_idempotency_key) 호출
7) 방 확보: core_private.ensure_student_mentor_room(student_id, mentor_id,
     p_payment_id => p_payment_id, p_subscription_id => subscription_id,
     p_require_entitlement => false)
     실패 시 ROOM_ENSURE_FAILED — 이번 트랜잭션의 자금·원장·구독·결제 변경 전부 롤백
8) 정본이 raise 하면 잡아서 envelope 로 변환. 성공 응답에 room_id 포함
```

**[C3] 잠금 순서 — `payments`가 먼저다.** 초안은 "`mentor_plans`를 먼저 잠근 뒤 정본을 호출한다"고 규정했으나, 이는 §12.2가 "반드시" 지키라고 고정한 순서(`payments` → advisory → `mentor_plans`)의 **역순**이다. §10.5·§18.2대로 레거시 3인자 함수는 계속 살아 있고 §20.4 C8 전까지 웹이 그것을 직접 호출하므로, 전환 기간에 F12(`mentor_plans`→`payments`)와 레거시(`payments`→`mentor_plans`)가 같은 (payment, plan) 쌍에 동시 진입하면 **교착(40P01)** 이 난다. 위 순서는 `payments`를 먼저 잡으므로 레거시와 순서가 일치해 교착이 성립하지 않는다.
TOCTOU 차단력은 그대로다 — 4)에서 잡은 `mentor_plans` 잠금을 5)~6) 내내 **같은 트랜잭션에서 유지**하므로, 비교 시점과 정본의 차감 시점 사이에 멘토의 UPDATE가 끼어들 수 없다(멘토의 UPDATE는 대기한다). 정본이 같은 행을 다시 `FOR UPDATE`하는 것은 동일 트랜잭션이라 무해하다.
*(구 [C4] 블록은 rev 8 A-5로 폐기 — 재생은 정본 위임이 아니라 아래 재생 계약으로 자체 판정한다. "멱등 재생은 금액 검사보다 먼저"라는 순서 원칙 자체는 2)에서 유지된다.)*

#### 재생 계약 — 성공 재생 판정 (rev 8 A-5 최종 확정)

기호 정의:

```text
P = 이번 호출에서 재생하려는 succeeded payment
C = 잠근 subscription.last_payment_id가 가리키는 최신 성공 payment
```

원칙: **최신 결제 정본은 오직 `subscription.last_payment_id`**(`FOR UPDATE`로 잠근 값)다. 생성시각·수정시각·UUID 순서 등으로 최신 결제를 추론하지 않는다. `P = C`면 일반 멱등 재생, `P ≠ C`면 과거 성공 결제의 **늦은 재생 후보**이며, 늦은 재생은 P가 succeeded이고 동일 학생·멘토 pair이며 동일 subscription의 정당한 결제인 경우에만 성공으로 흡수한다. 늦은 재생 성공에서도 자금·원장·구독·결제 상태를 반복 처리하지 않는다. (구 "`room.payment_id` = 재생 중인 payment → 일반 멱등 성공" 단순 분기는 stale room을 정상으로 오인하므로 폐기된 역사 규칙이다.)

재생 금지·허용 규칙(오너 확정):

- 현재 플랜 가격을 **읽지 않는다.**
- 기존 정본 함수(`confirm_subscription_checkout`)를 **다시 호출하지 않는다.**
- `payments.amount × 100`과 **기존 원장 행만** 비교한다.

**관계 결속 검증(오너 확정):** 금액 비교와 별도로 다음 결속을 전건 검증한다. 불일치 시 재생 성공을 반환하지 않으며, 관계 계층별로 안정 오류코드를 반환한다:

| 결속 | 검증 | 불일치 코드 |
|---|---|---|
| payment–plan | `payments.plan_id = p_plan_id` | `PLAN_BINDING_MISMATCH` |
| payment–subscription 당사자 | `payments.user_id = subscription.student_id` · `payments.mentor_id = subscription.mentor_id` | `PARTY_BINDING_MISMATCH` |
| ledger–subscription | `ledger.user_id = payments.user_id` · `ledger.ref_id = subscription.id` | `LEDGER_BINDING_MISMATCH` |
| room 당사자·참조 | pair(student, mentor) 일치 + 아래 room 참조 규칙 | `ROOM_REF_MISMATCH` |

**NULL 규칙:** 위 표의 payment·subscription·ledger 결속은 전부 **필수 관계**로, 어느 쪽이든 NULL이면 일치가 아니라 **해당 코드로 명시 거부**한다(일반 `=`의 NULL 통과 금지). nullable 호환 관계(room 참조 컬럼)만 `IS NOT DISTINCT FROM` 또는 아래 보정 규칙을 적용한다.

#### 오류코드 우선순위 — 9단계 단일 목록 (rev 8 — 구 7단계 완전 교체)

라이브 정본의 기존 안정 코드(`SUCCEEDED_NO_SUBSCRIPTION`·`SUCCEEDED_NO_LEDGER`·`LEDGER_FIELD_MISMATCH`, 전부 anomaly 행 + `anomaly_id` 반환)는 **그대로 유지**한다. 판정 순서:

```text
1. SUCCEEDED_NO_SUBSCRIPTION
2. SUCCEEDED_NO_LEDGER
3. PLAN_BINDING_MISMATCH
4. PARTY_BINDING_MISMATCH — P의 학생·멘토 관계 불일치
5. LEDGER_BINDING_MISMATCH
6. LEDGER_FIELD_MISMATCH
7. SUBSCRIPTION_REF_INVALID — C가 NULL이거나 유효한 succeeded payment를 가리키지 않음
8. PARTY_BINDING_MISMATCH — C가 가리키는 payment의 학생·멘토가 subscription pair와 불일치
9. ROOM_REF_MISMATCH
```

**우선순위의 의미:** ① 상위 조건이 성립하면 하위 코드로 덮어쓰지 않는다 ② 기존 안정 코드 3종을 새 코드로 치환하지 않는다 ③ 새 관계 오류코드는 행이 존재하지만 관계가 다른 경우에만 사용한다 ④ 오류 경로는 기존 anomaly 계약에 따라 안정 코드·detail·`anomaly_id`를 반환한다 ⑤ 오류 시 business-state 부작용은 0건이다 ⑥ `ROOM_ENSURE_FAILED`는 위 9단계 관계 검증을 통과한 후 Phase 2의 room 확보·복구가 실패했을 때 사용하는 **운영 오류**이므로 9단계 관계 오류 우선순위와 별도로 둔다.

#### `SUBSCRIPTION_REF_INVALID` — C 전제 실패의 안정 코드 (rev 8 신설)

다음 조건은 모두 `SUBSCRIPTION_REF_INVALID`로 반환하되 **anomaly detail로 구분**한다. detail은 내부 감사 정보이며 클라이언트 분기용 안정 코드는 `SUBSCRIPTION_REF_INVALID` 하나로 고정한다.

| 조건 | anomaly detail |
|---|---|
| `subscription.last_payment_id IS NULL` | `LAST_PAYMENT_ID_NULL` |
| C가 가리키는 payment 행이 없음 | `LAST_PAYMENT_NOT_FOUND` |
| C가 가리키는 payment가 `succeeded`가 아님 | `LAST_PAYMENT_NOT_SUCCEEDED` |

**C 당사자 불일치:** C가 가리키는 payment가 존재하고 succeeded지만 학생·멘토가 현재 subscription pair와 다르면 `SUBSCRIPTION_REF_INVALID`가 아니라 8단계의 `PARTY_BINDING_MISMATCH`를 사용한다(`LEDGER_BINDING_MISMATCH`로 뭉개지 않는다 — 결함 계층이 payment–subscription 당사자 결속이기 때문). 두 경우 모두 anomaly 행 기록 + `anomaly_id` 반환 + room 포함 업무 상태 변경 0건 계약을 따른다. C 검증은 기존 P·ledger 검증(1~6단계)을 통과한 뒤, room 충돌 판정(9단계) 전에 수행한다.

#### 검증 선행·쓰기 후행 — 실행 단계 분리 (rev 8)

이 함수 계열은 오류를 예외가 아니라 JSONB로 반환하므로, **검증 전에 수행한 UPDATE는 오류 JSONB 반환 후에도 커밋될 수 있다.** 따라서 재생 처리를 두 단계로 분리한다.

```text
검증 선행·쓰기 후행: room 보정 INSERT/UPDATE는 모든 Phase 1 검증을 통과한 뒤에만 수행한다.
```

**Phase 1 — 검증 전용 (business-state 쓰기 금지):** 필요한 payment·subscription·ledger·room 행을 조회·잠금하고, 금액·플랜·당사자·원장·최신 결제 C·room 참조 정합성을 검증한다. 이 단계에서는 room INSERT/UPDATE를 포함한 업무 객체 쓰기를 수행하지 않으며, room은 읽어서 **보정 예정값(후보)만 계산**한다.

```text
1. 재생 payment(P) 행 확인·잠금
2. subscription 행 확인·잠금
3. ledger 행 확인
4. P의 payment–plan 결속
5. P의 payment–subscription 당사자 결속
6. P의 ledger–subscription 결속
7. ledger 필드값 대조 (payments.amount × 100 과 기존 원장 행 비교)
8. C = subscription.last_payment_id 유효성 검증
   (SUBSCRIPTION_REF_INVALID / C 당사자 → PARTY_BINDING_MISMATCH)
9. 기존 room의 pair·subscription_id·payment_id 충돌 여부 판정 (쓰기 없음)
10. 모든 검증 통과 후에만 Phase 2 진입
```

**오류 시 허용/금지 쓰기:**

```text
허용: subscription_checkout_anomalies INSERT (감사 기록)
금지: room INSERT/UPDATE · 지갑·원장 변경 · 구독 변경 · payment 상태·metadata 변경
```

`ROOM_REF_MISMATCH` 판정 시 Phase 2로 진입하지 않는다(anomaly 기록 + `anomaly_id` 반환 + room 포함 업무 상태 변경 0건).

**Phase 1의 room 참조 판정(읽기 전용 — 후보 계산):**

- `room.subscription_id`: NULL → Phase 2에서 현재 `subscription.id`로 채울 후보 / 현재 `subscription.id`와 동일 → 유지 / 다른 값 → `ROOM_REF_MISMATCH`
- `room.payment_id`: C와 동일 → 유지 / NULL → Phase 2에서 C로 채울 후보 / P와 동일이고 `P ≠ C` → **stale room**으로 판정, Phase 2에서 C로 교체할 후보 / P도 C도 아닌 제3 결제 → `ROOM_REF_MISMATCH`

**Phase 2 — 검증 통과 후 room 확보·보정:** Phase 1을 전부 통과한 경우에만 실행한다.

- room이 없으면 **본 계약 §7 F10 = F12 내부 `core_private.ensure_student_mentor_room` 호출**로 확보한다. 확보한 room의 pair는 subscription의 학생·멘토 pair와 일치해야 한다.
- `room.subscription_id IS NULL` → 현재 `subscription.id`로 보정
- `room.payment_id IS NULL` → C로 보정
- `room.payment_id = P` 이고 `P ≠ C` → stale 참조를 C로 보정
- `room.payment_id = C` → 변경 없음
- room 보정은 모든 결속 검증 통과 후 수행하는 **참조 복구**일 뿐이며, 자금 차감·원장 INSERT·subscription 갱신·payment 상태/metadata 변경을 반복하지 않는다.

#### room 참조 규칙 — 컬럼별 정본 의미 (rev 8 동결)

라이브 구조상 방·구독 모두 `(student_id, mentor_id)` UNIQUE이고, 정본 checkout은 **재구독 시 기존 구독 행을 UPDATE하며 `payment_id`·`last_payment_id`를 새 결제 ID로 교체**한다(원문 실측). 따라서 "참조 컬럼에 다른 값이 있으면 일괄 거부"는 정상 재구독을 막는 결함이었다 — 컬럼별 의미를 다음으로 분리 확정한다:

| 컬럼 | 정본 의미 | 신규 결제 | 멱등 재생 |
|---|---|---|---|
| `student_id, mentor_id` | 방의 불변 정본 | 변경 금지 | 일치 필수 |
| `subscription_id` | pair에 대응하는 구독 | NULL이면 채움, 다른 값이면 거부 | 재생 판정 규칙 적용 — NULL이면 Phase 2에서 현재 `subscription_id`로 보정, 동일하면 유지, 다른 값이면 `ROOM_REF_MISMATCH` |
| `payment_id` | **가장 최근 성공 checkout** | 현재 결제로 갱신 | 재생 판정 규칙 적용(위 Phase 1 판정) |

(`payment_id`를 "최초 방 생성 결제의 불변 참조"로 쓰는 안은 **기각** — 최신 참조 의미론으로 고정하며, 두 의미를 섞지 않는다.) 실측 참고: 현재 방 2건 중 1건은 두 참조가 NULL — 위 표의 "NULL이면 채움/갱신" 규칙으로 수렴된다.

#### 재생 결과

- `P = C` → `ok:true, idempotent:true`, 자금·원장·구독·결제 반복 처리 0건, room 참조가 NULL이면 Phase 2에서 복구 가능.
- `P ≠ C` → P가 succeeded·동일 pair·동일 subscription 정당 결속·원장 관계/필드 검증을 전부 통과한 경우에만 **늦은 과거 재생**으로 `ok:true, idempotent:true`(자금 반복 0, room의 `payment_id`는 C 유지 또는 C로 복구, anomaly 0). 조건 미충족 시 9단계 우선순위에 따른 안정 오류를 반환한다.
- **`ROOM_ENSURE_FAILED`(운영 오류):** Phase 2의 room 확보·보정 실패 시 반환한다. **재생에서는** 기존 자금·원장·구독·결제 성공 상태를 변경·복원하지 않고, room 부분 변경은 같은 statement/내부 exception block에서 롤백해 남기지 않으며, 재시도 가능하다(다음 재생에서 room 복구 재시도). **최초 checkout 실행에서는** 이번 트랜잭션의 자금·원장·구독·결제 변경을 전부 롤백한다(rev 8 A-2 §3).

#### 반환·보안 속성

- 반환 성공: 기존 함수 반환 + `contract_version:1` + **`room_id`** (`{ok:true, subscription_id, payment_status, amount_cents, room_id, reactivated}` 또는 재생 `{ok:true, idempotent:true, subscription_id, payment_status, room_id}`).
- envelope 정규화: 기존 함수가 `raise`하는 17종 코드(§3.3 A)를 잡아 `{ok:false, code}`로 변환한다. 예상 밖 오류는 전파한다.
- `SECURITY DEFINER`, `SET search_path = ''`, owner = migration 실행 역할. EXECUTE는 `PUBLIC`·`anon`·`authenticated` 회수 후 **service_role만 허용**(§10.3). 생성과 권한 회수는 같은 마이그레이션(M9).
- 회귀 테스트: §21.8 **T-REP-A~H**(재생 8건) + T-CONC-08·09.

### F13 `api_web_v1.mentor_payout_account_update_self` — 정산계좌 전용 RPC (rev 8 A-4 신설, U-06 해소)

```sql
api_web_v1.mentor_payout_account_update_self(
  p_bank_name text, p_account_number text
) RETURNS jsonb
```

- **배경(확정·실측):** `lib/mentor/mentorPayoutAccountActions.ts:39`가 **세션 클라이언트**로 `mentor_profiles`의 정산계좌 컬럼(`payout_bank_name`·`payout_account_number`)을 직접 UPDATE하며, `components/mentor/payouts/MentorPayoutAccountPanel.tsx`에 실제 연결된 활성 경로다. F7은 payout 컬럼을 의도적으로 제외했으므로 §10.6(A-3)의 전면 REVOKE는 이 기능을 파손한다 — 회수 전에 이 RPC가 반드시 배포·전환되어야 한다(§20.3 M11 게이트 ②).
- 필수 계약(rev 8 A-4):
  - **authenticated 전용** — `anon`·`PUBLIC` EXECUTE 회수(§10.3).
  - 대상 행은 **`auth.uid()`에서 자체 도출**한다(인자로 user_id를 받지 않는다 — §11.3).
  - **승인된 멘토**(`verification_status` 승인 상태 — `individual_question_user_is_approved_mentor(auth.uid())`와 동일 판정식) 여부 확인. 실패 시 `MENTOR_NOT_APPROVED`.
  - **은행명 allowlist 검증.** allowlist 밖이면 `PAYOUT_BANK_NAME_INVALID`.
  - **계좌번호는 숫자만·길이 8~24 검증.** 위반 시 `PAYOUT_ACCOUNT_NUMBER_INVALID`.
  - **계좌 원문을 응답에 포함하지 않는다.** 성공 반환은 `{ok:true, contract_version:1, updated_at, account_masked}`(끝 4자리 외 마스킹) 수준으로 제한한다.
  - 관리자/service_role의 조회·수정 경로는 **별도 함수로 분리**한다(이 함수에 겸용 경로를 만들지 않는다 — 별도 계약).
  - 그 외 공통 검증: `AUTH_REQUIRED`, `ROLE_NOT_MENTOR`, `ACCOUNT_*` 상태 게이트(§11.5 fail-closed).
- **적용·웹 전환 완료 후** `mentor_profiles` 직접 쓰기 전면 회수(§10.6 M11)가 가능해진다.
- `SECURITY DEFINER`, `SET search_path = ''`. 마이그레이션 **M14**.

---

## 8. 각 함수의 성공·실패 반환 envelope `[TO-BE]`

### 8.1 고정 envelope

모든 신규 명령 함수는 **jsonb 단일 객체**를 반환한다. (예외 2종: V6·V7 조회 RPC는 `TABLE`을 반환하는 읽기 계약이고, `core_private` 내부 구현부의 반환은 wrapper가 소비하는 내부 형상이다. v1.0의 F0 예외는 F0 폐기로 소멸.)

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
| F10 (내부) | `room_id, created, entitlement` | — |
| F11 | `duplicate, ledger_id, balance_cents` | `duplicate:true` (6필드 NULL-safe 대조 통과 시) |
| F11i (내부) | `ledger_id, inserted, user_id, delta_cents, reason, ref_type, ref_id, idempotency_key` | wrapper 전용 내부 형상 |
| F12 | `subscription_id, payment_status, amount_cents, room_id, reactivated` | `idempotent:true` + `room_id` / 오류 시 `code`·`anomaly_id`(§7 F12 9단계) |
| F13 | `updated_at, account_masked` | 계좌 원문 미반환 |
| V6·V7 RPC | `TABLE` 반환(읽기 계약 — envelope 예외) | — |

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
- **작성 자격(rev 8 A-10):** F4 create의 역할 위반은 `ROLE_NOT_MENTOR`(§9.2), 미승인 멘토는 `MENTOR_NOT_APPROVED`(§9.3)를 사용한다. 앱 계약 v1.0의 `ROLE_NOT_ALLOWED`(= 학생·멘토가 아님) 정의는 학생 작성을 허용하는 정의였으므로 **앱 계약 v1.1에서 멘토 전용 기준으로 재정의**한다(§19.5 동기화 항목).
- **`POLICY_RESTRICTED`는 예약 코드다(rev 8 D — B-04 동결):** 금지어 검사 폐지가 확정되어 v1.1에서 이 코드는 **발생하지 않는다.** 코드 사전에서 삭제하지 않는 이유는 앱 계약 §6.4와의 코드 집합 동일성 유지와, 금지어 복원 시 additive 개정으로 재활성화하기 위해서다.

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
| **`PAYOUT_BANK_NAME_INVALID`** | 은행명 allowlist 밖 (F13, rev 8 A-4) | |
| **`PAYOUT_ACCOUNT_NUMBER_INVALID`** | 계좌번호 숫자 아님·길이 8~24 밖 (F13) | |

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
| **`PLAN_BINDING_MISMATCH`** | 재생 P의 payment–plan 결속 불일치 | `anomaly_id` | 신규(rev 8 A-5, F12 재생 3단계) |
| **`PARTY_BINDING_MISMATCH`** | 재생 P의 payment–subscription 당사자 불일치(4단계) **또는** C가 가리키는 payment의 당사자 불일치(8단계) | `anomaly_id` | 신규(rev 8 A-5) |
| **`LEDGER_BINDING_MISMATCH`** | 재생 ledger–subscription 결속 불일치 | `anomaly_id` | 신규(rev 8 A-5, 5단계) |
| **`SUBSCRIPTION_REF_INVALID`** | `subscription.last_payment_id` 전제 실패 — C가 NULL이거나 유효한 succeeded payment를 가리키지 않음 | `anomaly_id` + anomaly detail(`LAST_PAYMENT_ID_NULL` / `LAST_PAYMENT_NOT_FOUND` / `LAST_PAYMENT_NOT_SUCCEEDED`) | 신규(rev 8 A-5, 7단계) |
| **`ROOM_REF_MISMATCH`** | room 참조가 pair·subscription·payment 정본과 충돌(제3 결제 참조 등) | `anomaly_id` | 신규(rev 8 A-5, 9단계) |
| `ROOM_ENSURE_FAILED` | Phase 2 room 확보·복구 실패 — **운영 오류**(9단계 우선순위와 별도, 재시도 가능) | | §9.3과 동일 코드. F12에서는 재생 시 자금 상태를 건드리지 않는 실패, 최초 실행 시 전부 롤백(§7 F12) |

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
| `SCHEMA core_private` | REVOKE ALL | — (부여 안 함) | — (부여 안 함) | — (**부여 안 함** — rev 8 A-2·A-6: 내부 구현부는 SECDEF wrapper의 소유자 권한으로만 호출) |

### 10.2 View

| view | PUBLIC | anon | authenticated | service_role | 비고 |
|---|---|---|---|---|---|
| `api_web_v1.community_posts_v1` | REVOKE ALL | **SELECT** | **SELECT** | SELECT | anon = 비로그인 게시판 열람 |
| `api_web_v1.community_comments_v1` | REVOKE ALL | **SELECT** | **SELECT** | SELECT | 라벨은 비정규화 컬럼(M13) |
| `api_web_v1.mentor_directory_v1` | REVOKE ALL | **SELECT** | **SELECT** | SELECT | 유일한 SECDEF view |
| `api_web_v1.my_wallet_v1` | REVOKE ALL | — | **SELECT** | SELECT | |
| `api_web_v1.my_cash_ledger_v1` | REVOKE ALL | — | **SELECT** | SELECT | |

*(v1.1 — rev 8 A-9: 구 V6 `my_subscriptions_v1`·V7 `mentor_settlement_v1` 뷰는 만들지 않는다. 두 조회 계약은 범위 제한 SECDEF RPC로 §10.3에 있다.)*

모든 view에 `INSERT`/`UPDATE`/`DELETE`는 **어떤 역할에도 부여하지 않는다.**

> **`service_role` SELECT의 의미(주의).** V4·V5는 `security_invoker = true`이고 `service_role`은 `BYPASSRLS`다. 따라서 **service_role이 이 view들을 조회하면 "본인 것"이 아니라 전 사용자 행이 반환된다.** 이는 의도된 동작이며(서버 배치·관리자 조회가 필요할 수 있다), 대신 다음을 계약으로 못박는다:
> - 웹 서버 코드는 **사용자 데이터를 보여주기 위해 V4·V5를 `service_role`로 조회하지 않는다.** 사용자 표시용 조회는 항상 세션 클라이언트로 한다.
> - service_role로 조회할 경우 **호출부가 명시적으로 `user_id`/`mentor_id`를 필터**해야 한다. view가 걸러 줄 것이라고 가정하지 않는다.
> - V6·V7 RPC를 service_role로 호출하는 경우도 동일하다 — `auth.uid()`가 NULL이므로 함수는 `AUTH_REQUIRED` 계열로 거부하며, 서버 배치용 전 사용자 조회는 기존 테이블 직접 SELECT(명시 필터)로 한다.
> - §21 **T-PERM-13**이 이 성질을 문서화된 사실로 고정한다(회귀가 아니라 계약임을 표시).

```sql
REVOKE ALL ON ALL TABLES IN SCHEMA api_web_v1 FROM PUBLIC;
GRANT SELECT ON api_web_v1.community_posts_v1,
               api_web_v1.community_comments_v1,
               api_web_v1.mentor_directory_v1        TO anon, authenticated, service_role;
GRANT SELECT ON api_web_v1.my_wallet_v1,
               api_web_v1.my_cash_ledger_v1          TO authenticated, service_role;
```

### 10.3 Function

| function (정확한 인자 타입) | 계층 | PUBLIC | anon | authenticated | service_role |
|---|---|---|---|---|---|
| `api_web_v1.weekly_question_usage_self(uuid)` | T2 | REVOKE | — | **EXECUTE** | EXECUTE |
| `api_web_v1.ensure_free_question_room(uuid)` | T2 | REVOKE | — | **EXECUTE** | EXECUTE |
| `api_web_v1.qna_create_question_thread(uuid,text,text,text,text)` | T2 | REVOKE | — | **EXECUTE** | EXECUTE |
| `api_web_v1.community_post_create(text,text,text,uuid,text[],text)` — rev 8 A-1 재배열 | T2 | REVOKE | — | **EXECUTE** | EXECUTE |
| `api_web_v1.community_post_update(uuid,text,text,text,timestamptz,text[],text)` — rev 8 A-1 재배열 | T2 | REVOKE | — | **EXECUTE** | EXECUTE |
| `api_web_v1.community_post_soft_delete(uuid)` | T2 | REVOKE | — | **EXECUTE** | EXECUTE |
| `api_web_v1.mentor_profile_update_self(text,text,text,text[],text,text,text,text,boolean)` | T2 | REVOKE | — | **EXECUTE** | EXECUTE |
| `api_web_v1.mentor_plan_prices_set_self(integer,integer,integer)` | T2 | REVOKE | — | **EXECUTE** | EXECUTE |
| `api_web_v1.mentor_payout_account_update_self(text,text)` — **F13 신설(A-4)** | T2 | REVOKE | — | **EXECUTE** | EXECUTE |
| `api_web_v1.account_deletion_status_self()` | T2 | REVOKE | — | **EXECUTE** | EXECUTE |
| `api_web_v1.my_subscriptions_self()` — **V6 RPC(A-9)** | T2 | REVOKE | — | **EXECUTE** | EXECUTE |
| `api_web_v1.mentor_settlement_self()` — **V7 RPC(A-9)** | T2 | REVOKE | — | **EXECUTE** | EXECUTE |
| `api_web_v1.record_cash_topup_v2(uuid,bigint,text)` — **F11 진입점(A-2·A-6)** | T4a | REVOKE | — | — | **EXECUTE** |
| `api_web_v1.subscription_checkout_confirm_v2(uuid,uuid,integer,text)` — **F12 진입점(A-2)** | T4a | REVOKE | — | — | **EXECUTE** |
| `core_private.ensure_student_mentor_room(uuid,uuid,uuid,uuid,boolean)` — 내부 구현부 | 내부 | REVOKE | — | — | — (**미부여**) |
| `core_private.record_cash_topup_impl(uuid,bigint,text)` — 내부 구현부(A-6) | 내부 | REVOKE | — | — | — (**미부여**) |
| `core_private.community_post_create_impl(uuid,text,text,text,text[],text,uuid)` — 내부(B) | 내부 | REVOKE | — | — | — (**미부여**) |
| `core_private.community_post_update_impl(uuid,uuid,text,text,text,text[],text,timestamptz)` — 내부(B) | 내부 | REVOKE | — | — | — (**미부여**) |
| `core_private.community_post_soft_delete_impl(uuid,uuid)` — 내부(B) | 내부 | REVOKE | — | — | — (**미부여**) |
| `core_private.community_image_refs_validate(uuid,text[])` — 내부(B) | 내부 | REVOKE | — | — | — (**미부여**) |

*(v1.0의 F0 라벨 함수 2행은 폐기 — rev 8 A-9. §7 F0 참조.)*

```sql
-- 명시 REVOKE (default privileges 와 이중 방어)
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA api_web_v1  FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA core_private FROM PUBLIC;

-- T2
GRANT EXECUTE ON FUNCTION api_web_v1.weekly_question_usage_self(uuid)                                      TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION api_web_v1.ensure_free_question_room(uuid)                                        TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION api_web_v1.qna_create_question_thread(uuid,text,text,text,text)                   TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION api_web_v1.community_post_create(text,text,text,uuid,text[],text)                 TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION api_web_v1.community_post_update(uuid,text,text,text,timestamptz,text[],text)     TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION api_web_v1.community_post_soft_delete(uuid)                                       TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION api_web_v1.mentor_profile_update_self(text,text,text,text[],text,text,text,text,boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION api_web_v1.mentor_plan_prices_set_self(integer,integer,integer)                   TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION api_web_v1.mentor_payout_account_update_self(text,text)                           TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION api_web_v1.account_deletion_status_self()                                         TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION api_web_v1.my_subscriptions_self()                                                TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION api_web_v1.mentor_settlement_self()                                               TO authenticated, service_role;

-- T4a (service_role 만 — 웹 서버 전용 진입점, rev 8 A-2)
GRANT EXECUTE ON FUNCTION api_web_v1.record_cash_topup_v2(uuid,bigint,text)                                 TO service_role;
GRANT EXECUTE ON FUNCTION api_web_v1.subscription_checkout_confirm_v2(uuid,uuid,integer,text)               TO service_role;

-- core_private 내부 구현부: 어떤 외부 역할에도 EXECUTE 를 부여하지 않는다 (rev 8 A-2·A-6·B).
--  (스키마 USAGE 자체가 없고, 함수 생성 마이그레이션에서 REVOKE ALL ... FROM PUBLIC 을 명시한다.
--   호출은 api_web_v1/api_app_v1 의 SECDEF wrapper 소유자 권한 문맥에서만 일어난다.)
```

> **설계 정정 (v1.1 — F0 폐기, rev 8 A-9).** v1.0이 이 자리에서 논증했던 "F0을 `api_web_v1`에 두는 배치"와 그에 따른 트레이드오프("임의 uuid → nickname 조회 개방")는 **문제 자체가 소멸**했다: 공개 라벨 함수를 만들지 않는다. v1.0이 S3 후보(U-11)로 이월했던 `comments.author_label` 비정규화를 **v1.1이 채택**(M13)해 V2의 라벨 요구를 해소했고, V6·V7은 관계를 내부에서 검증하는 범위 제한 SECDEF RPC로 라벨을 행에 결합해 반환한다(§6·§7 F0). `core_private`에는 어떤 외부 역할의 USAGE/EXECUTE도 **끝까지 주지 않는다**(§10.1) — F10과 내부 구현부들은 클라이언트 도달 불가다.

### 10.4 신규 컬럼 (v1.1 — rev 8 A-6·A-9 재확정)

> **`cash_ledger.ref_text` 폐기(rev 8 A-6).** v1.0이 이 절에서 추가하던 `ref_text` 컬럼·부분 인덱스·M2 마이그레이션은 **전부 만들지 않는다.** topup 주문 정본은 `idempotency_key`(=`orderId`, UNIQUE 제약 실재)이고 `p_idempotency_key = p_order_ref`를 강제하는 이상 `ref_text`는 같은 문자열의 중복 저장일 뿐이다. **cash_ledger에 신규 DDL 0건.** V5의 `order_ref`는 `idempotency_key`에서 반환한다(§6 V5).

| 대상 | 변경 | 권한 |
|---|---|---|
| `public.comments.author_label text NULL` | **추가**(M13 — rev 8 A-9, V2 비정규화) | 기존 테이블 GRANT·RLS를 따른다. 값 기록은 BEFORE INSERT 트리거 전용 |
| `public.comments.author_role text NULL` | **추가**(M13 — 동일) | 동일 |
| 트리거 `public.comments_set_author_label()` + `trg_comments_set_author_label` | BEFORE INSERT — `users.nickname`/`role` 복사(라벨 규칙은 §6 V2·§7 F0 승계 규칙) | 함수는 SECDEF + `SET search_path = ''` + PUBLIC EXECUTE 회수 |
| 백필 | 기존 `comments` 행 1회 백필(M13 내) | — |

### 10.5 레거시 표면 회수 — **S2에서 하지 않는 것**

| 대상 | S2 조치 | 근거 |
|---|---|---|
| `public` 함수 194종 | **회수 0건** | 구버전 앱 종료 전 금지(앱 계약 §7.4 T3 일정) |
| `public` 테이블 GRANT | **회수 0건** | 동일 |
| `public.account_deletion_request_self_consented(integer,boolean,bigint)` | `authenticated` EXECUTE **유지** | 앱 계약 T0 상태. T3에서만 회수 |
| Data API `public` 노출 | **유지** | 앱·구버전 웹 호환 |

### 10.6 조건부 회수 — 웹 전환 완료 후에만 (S2 후반 M11·M12)

*(v1.1 — rev 8 E-2: 구 "S2 후반 M9" 표기를 M11·M12로 정정.)*

> **v1.1 정정(rev 8 A-3 — 컬럼 단위 REVOKE는 무효, 확정 실측):** `anon`·`authenticated`가 `mentor_profiles`·`mentor_plans`에 **테이블 단위** 권한 7종(SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER)을 보유한다. PostgreSQL은 테이블 단위 권한이 있으면 컬럼 단위 REVOKE가 실효 없다 → v1.0의 컬럼 단위 회수는 적용해도 XW-02가 닫히지 않는다. **M11·M12의 분리 구조는 유지하되 테이블 단위 전면 회수로 교체**한다. TRUNCATE는 RLS 대상이 아니나 PostgREST가 노출하지 않아 즉각적 HTTP 공격 경로는 아님 — 그러나 "최소 권한·전면 회수" 계약이므로 TRUNCATE·REFERENCES·TRIGGER까지 함께 회수한다. (현재 실효 방어는 전적으로 RLS(`mentor_update_own` 등 own-row 정책)뿐이다 — 실측.)

아래 2건은 **레거시 앱과 무관한 웹 전용 표면**이므로 앱 cutoff를 기다리지 않는다.

```sql
-- M11
REVOKE ALL ON public.mentor_profiles FROM anon, authenticated;
GRANT SELECT ON public.mentor_profiles TO anon, authenticated;
-- M12
REVOKE ALL ON public.mentor_plans FROM anon, authenticated;
GRANT SELECT ON public.mentor_plans TO anon, authenticated;
```

| 대상 | 조치 | 해소하는 결함 | 적용 게이트(rev 8 A-3) |
|---|---|---|---|
| `public.mentor_profiles` (M11) | 위 `REVOKE ALL` + `GRANT SELECT` — INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER 전부 회수, SELECT만 재부여 | **XW-02 (가)·(나)** | ① F7 전환 완료 ② **A-4 정산계좌 RPC(F13) 적용 + 웹 호출부(`lib/mentor/mentorPayoutAccountActions.ts`) 전환** ③ `syncAfterSignUpWithSession` 백업 upsert 제거 ④ 프로필 직접 쓰기 실측 0건 확인 |
| `public.mentor_plans` (M12) | 위 `REVOKE ALL` + `GRANT SELECT` (SELECT 유지 — 공개 가격 표시에 필요) | **XW-03** | ① F8 전환 완료 ② 플랜 직접 쓰기 실측 0건 확인 |

- **앱 영향 — 실측 확인 완료.** 앱 직접 테이블 24종에 두 테이블이 포함되지만 실제 접근은 **2곳 모두 SELECT**다(§19.4-B). SELECT는 유지하므로 위 회수는 앱을 깨뜨리지 않는다. 다만 지시서 §4가 앱에 허용한 단순 프로필 수정의 **제품 범위 정의**는 별개 문제로 남는다 → §23 **B-07**(rev 8 D로 blocker에서는 해제).
- 테이블 단위 REVOKE는 `SECURITY DEFINER` 경로에 영향을 주지 않는다(§5.3 주의 3). 관리자 승인 RPC는 계속 동작한다.
- rollback은 회수한 권한을 되돌리는 **별도 migration**으로만 한다(§22 #6 — 테이블 단위 대칭 복원).

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

- 라벨은 **`nickname`만** 사용한다(§7 F0 승계 규칙 — 비정규화 컬럼·V6/V7 RPC 내부 도출 공통). `full_name`·`email`·`birth_date`·`grade_level`·`phone` 계열은 어떤 신규 view/function도 반환하지 않는다. **임의 UUID를 받는 공개 라벨 함수는 존재하지 않는다**(rev 8 A-9 — F0 폐기).
- `mentor_directory_v1`은 `nickname`만 노출하고 `full_name`을 제외한다. **현행 `mentor_directory_list_v2`는 `full_name`을 반환한다**(실측) — 신규 view는 이를 **의도적으로 좁힌다.**
- 표시 역할은 `admin`에 대해 `NULL`을 기록·반환한다(관리자 신원 비노출 — V2 비정규화 트리거·V6/V7 RPC 공통).
- V7 RPC는 `idempotency_key`·`ledger_id`·`payment_id`를 노출하지 않는다. F13은 계좌 원문을 반환하지 않는다(끝 4자리 마스킹만).

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
| `api_web_v1.my_subscriptions_self()`/`mentor_settlement_self()` (V6·V7 RPC) | 타인 `users.nickname` 라벨 결합·당사자 행 조회 | 함수 내부 당사자 판정(`auth.uid()` = 정본 정책 판정식), 라벨은 검증된 행에 결합된 형태로만, PII 컬럼 미반환 |
| `public.comments_set_author_label()` (M13 트리거 함수) | INSERT 시 타인 아닌 **본인** `users` 행 읽기 | BEFORE INSERT 전용, 라벨 규칙 고정(admin → NULL), PUBLIC EXECUTE 회수 |
| F1~F9, F13 (SECDEF wrapper) | 정본 RPC 호출·타인 행 검증 | `auth.uid()` 도출 + 상태·역할·소유권 검증 |
| F11·F12 (`api_web_v1`, SECDEF) | 자금·상태 확정 | `service_role` EXECUTE 전용 |
| F10·내부 구현부 5종 (`core_private`) | 공용 구현부(자금 원장·방 확보·커뮤니티 검증) | **외부 EXECUTE 0** — SECDEF wrapper의 소유자 권한 문맥에서만 호출(§10.3) |

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
| **캐시 충전 원장 (Toss)** | **F11** `api_web_v1.record_cash_topup_v2` → `core_private.record_cash_topup_impl` (3층 — §7 F11) | `p_order_ref`(=orderId, **`idempotency_key`로 기록** — 정본, rev 8 A-6) | `cash_wallets` upsert(신규 INSERT 시만) + duplicate `FOR UPDATE` 재조회 | — | `ref_type='topup'` · **`ref_id IS NULL`(정본 상태)** · 주문 참조 = `idempotency_key` | `ORDER_REF_INVALID`, `ORDER_REF_OWNER_MISMATCH`, `LEDGER_FIELD_MISMATCH`(6필드 NULL-safe), `CASH_WALLET_UPSERT_FAILED` |
| 캐시 충전 (개발·스테이징 테스트) | 기존 `record_cash_topup`(3인자) **유지 — F11 전환 제외**(rev 8 A-6 정정 2) | `cash_topup_{uid}_{ts}_{hex}` | 동일 | — | 동일 | duplicate 무음 반환(기존 계약) |
| **구독 checkout 확정** | **F12** `api_web_v1.subscription_checkout_confirm_v2` (재생 판정 자체 수행 — §7 F12) | `sub_debit_{paymentId}` (원장), `sub_checkout_{paymentId}` | §12.2 순서 + 재생 시 Phase 1/2 분리 | `payments.pending→succeeded`, `subscriptions` upsert `active`, **room 확보·보정(Phase 2)** | `ref_type='subscriptions'`, `ref_id=subscription_id`, `reason='subscription_payment'` | **`PLAN_AMOUNT_CHANGED`**, `CASH_INSUFFICIENT`, `MENTOR_CAP_EXCEEDED`, `PAYMENT_STALE`, 9단계 관계 오류(§7 F12 — `PLAN/PARTY/LEDGER_BINDING_MISMATCH`, `LEDGER_FIELD_MISMATCH`, `SUBSCRIPTION_REF_INVALID`, `ROOM_REF_MISMATCH`) + 운영 오류 `ROOM_ENSURE_FAILED` |
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
- 신규 경로는 **두 가지로 수렴**한다(rev 8 A-2): ① 질문방 CTA = **F2 → F10** ② 구독 확정 = **F12 내부 F10 호출**(웹 JS가 F10을 직접 부르는 경로는 없다 — `core_private`는 Data API 도달 불가). 기존 웹 JS 경로(`ensureFreeQuestionRoomForStudent` → `ensureMentorStudentRoom`, service_role + 컬럼 프로빙 + 23505 재조회)는 이 두 경로로 **대체**한다(§17 매핑).
- **구독 성공 시 질문방 존재는 필수 불변조건**이다(rev 8 A-2 §3). room의 nullable 참조(`subscription_id`·`payment_id`) 보정 규칙은 §7 F12의 컬럼별 표를 따른다.
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
- **응답 불명확·응답 유실은 실패 확정이 아니다 — 재호출 선행·보상 삭제 후행:**
  - **업로드 단계 실패:** 이미 업로드한 신규 Storage 객체를 **즉시 보상 삭제**한다(Storage 보상 삭제 — **유지**).
  - **DB finalize의 확정 실패·rollback 확인:** 신규 Storage 객체를 보상 삭제한다(트랜잭션 롤백이므로 지울 DB 행은 없다).
  - **DB finalize 응답 불명확·응답 유실:** Storage 객체를 **삭제하지 말고**, **동일 멱등키로 F4를 먼저 재호출**한다 — 이것이 생성 복구의 **정본 경로**다(rev 8 C).
    - 재호출 성공 또는 기존 `post_id` 반환(멱등 재생): 게시글이 커밋된 것이므로 **객체를 유지**한다(먼저 지우면 커밋된 글의 image ref가 깨진다).
    - 확정 실패 및 게시물 미커밋 확인: **그때** 신규 객체를 보상 삭제한다. **"미커밋 확인"의 판정 주체는 §7 F4의 replay-first 판정이다** — 재호출이 `(author_id, create_idempotency_key)` 기존 행 없음을 판정하고 신규 경로에서 확정 실패 envelope(`ok:false` 도메인 거부) 또는 rollback으로 종결된 경우만 해당한다. **단순 재호출 오류(연결 실패·timeout·예상 밖 예외)는 미커밋 확인이 아니다** — 객체를 보존한 채 재시도한다. **별도 조회 RPC는 신설하지 않는다**(F4 재호출 자체가 조회를 겸한다).
  - **DB 게시글을 hard DELETE하는 보상 RPC·직접 DELETE 경로는 계속 금지한다**(authenticated hard-delete API는 새 공격면만 만든다).
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
| 보상 삭제 | **재호출 선행·보상 삭제 후행**(§14.4 — 확정 실패 시에만 요청 단위 신규 객체 삭제) + orphan 기록 | 앱 계약 v1.0 §6.3은 "응답 불명확 시 선삭제" 구순서 — **v1.1에서 §14.4 규약으로 동기화**(§19.5 #8) | ⚠→✅ (앱 계약 v1.1 동기화 시 충족) |
| soft delete | F6 (hard delete 금지) | `community_post_soft_delete` (동일) | ✅ |
| 본문 검증 | 연락처 마스킹만(금지어 폐지 확정 — rev 8 D) | 동일 규칙 공유 필수 | ✅ **공용 검증부(B-1~B-4) 공유로 구조적 보장** — 앱 전용 약한 규칙 금지(앱 계약 §6.2) |
| 작성 자격 | **승인 멘토 전용**(F4 — rev 8 A-10) | 동일(`ROLE_NOT_MENTOR` 재정의 — §19.5) | ✅ 공용 구현부가 판정 |

**구 동등성 리스크(B-04) — 동결로 해소(rev 8 D):** v1에서는 **"금지어 검사 폐지, `POLICY_RESTRICTED`는 예약 코드이며 발생하지 않음"**으로 한쪽 동결한다. 코드가 폐지를 의도적이라고 명시하고 있고(`lib/safety/trustSafetyText.ts` 상단 주석 실측), F4/F5 공용 검증부는 마스킹만 수행한다. 오너가 금지어를 복원하면 additive 개정으로 처리한다. 웹·앱 동등성은 공용 구현부 공유로 성립한다.

### 14.7 `HD-1` — 커뮤니티 직접 쓰기 전면 잠금 (rev 8 C — v1.1 신설, M16)

- **실측:** 앱 `lib/features/community/data/community_write_repository.dart:204-210` + `board_author_gate.dart:183`(`deleteOwnPostForCompensation`)이 `community_posts.delete()`를 실행한다 — **생성 실패 보상 전용** 내부 경로(공개 API·UI·라우트 없음). 웹은 `communityBoardActions.ts`가 직접 INSERT·UPDATE를 실행한다.
- **보상 삭제 RPC 폐기(오너 확정):** 대체 RPC는 **만들지 않는다.** §14.4의 "같은 멱등키 F4 재호출"이 정본 복구 경로다. 제거 대상은 **DB 게시글 hard DELETE뿐**이며, Storage에 먼저 올린 신규 이미지의 보상 삭제는 **유지**한다.
- **`HD-1` 확정(직접 쓰기 전면 잠금 — "hard DELETE 회수"에서 확장):** F4/F5/F6 전환과 앱 보상 DELETE 제거 후 **같은 마이그레이션(M16)**에서:

  ```sql
  REVOKE ALL ON public.community_posts FROM anon, authenticated;
  GRANT SELECT ON public.community_posts TO anon, authenticated;
  ```

  같은 마이그레이션에서 제거할 정책(2026-07-29 `pg_policies` 실측 전수):

  ```text
  INSERT: cp_write_self · 로그인 유저 게시글 작성
  UPDATE: cp_update_own · cp_update_self · 본인 게시글 수정
  DELETE: cp_delete_own
  ```

  SELECT 정책은 유지한다. 이후 쓰기는 F4/F5/F6만 통과한다.
- **게이트 순서(확대 게이트 7단계 — 변경 금지):** `HD-1`은 `REVOKE ALL`이므로 DELETE만이 아니라 **웹·앱의 anon/authenticated 세션 경로에서 `community_posts` 직접 INSERT/UPDATE/DELETE 전부 0건**을 확인해야 한다. 현재 전환 대상: **웹 = 직접 INSERT·UPDATE**, **앱 = 직접 INSERT·보상 DELETE**.

  ```text
  1. F4/F5/F6 웹·앱 전환
  2. F4 응답 불명확 시 동일 멱등키 재시도 구현
  3. deleteOwnPostForCompensation 제거
  4. 앱 DB 게시글 hard DELETE 제거
  5. 웹·앱 anon/authenticated 세션의 직접 INSERT/UPDATE/DELETE 0건 확인
  6. service_role 관리자 moderation 직접 UPDATE를 의도된 예외로 목록화·회귀 확인
  7. HD-1 적용 (M16)
  ```

- **service_role 예외(명시):** `lib/admin/communityModerationCore.ts`의 service_role moderation은 **유지**한다 — `REVOKE … FROM anon, authenticated`의 대상이 아니다. 따라서 "저장소 전체에서 `community_posts` write 0건"처럼 service_role 예외까지 제거하는 잘못된 게이트를 사용하지 않는다.
- **마이그레이션 번호(오너 확정):** v1.0의 **M8은 F7·F8 멘토 RPC 마이그레이션이므로 그대로 유지**한다. `HD-1`은 M8에 얹지 않는 **별도 마이그레이션 M16**이다.

### 14.8 숏폼 작성 정책 — 실측 정정 (rev 8 A-10)

- 현재 숏폼 INSERT는 **이미 멘토 전용**이다. 정책 실재(2026-07-29 `pg_policies` 실측): `shortform_posts` INSERT 정책 **`sf_insert_mentor` 1건**, Storage INSERT 정책은 버킷별 2건이 아니라 **`sfv_mentor_insert` 1건이 `shortform-videos`·`shortform-thumbnails` 2버킷을 함께 포괄**한다. `sfv_mentor_insert`를 버킷별 2개 정책으로 분해해 기술하지 않는다.
- 두 정책 모두 커뮤니티 작성과 **동일한 승인 헬퍼**(`individual_question_user_is_approved_mentor`)로 정합화하되, `sfv_mentor_insert` 수정 시 기존 조건 4종을 **반드시 보존**한다: ① 대상 버킷 제한 ② 사용자 폴더 소유권(`storage.foldername(name)[1] = auth.uid()`) ③ `NOT account_deletion_write_blocked(auth.uid())` ④ authenticated 역할 범위.

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
| 3 | `subscribeCheckoutService.ts:763, 870` (구독 확정 시 방 확보) | 동일 JS 경로 | **F12 내부 F10 호출로 흡수** — 구 "웹 JS → F10 직접 호출" 행은 **삭제**(rev 8 A-2: `core_private`는 Data API 도달 불가) | **대체(F12 통합)** | XW-10 |
| 4 | `lib/qna/questionRoomRpc.ts:94` | `qna_create_question_thread(...)` (raise) | **F3** (envelope 변환) | **wrapper** | XW-07, XW-08 |
| 5 | `lib/qna/questionRoomRpc.ts:125,149,164,182` | `qna_append_message`/`confirm_thread`/`flag_wrong_answer`/`register_attachment` | — | **유지** | — |
| 6 | 커뮤니티 글 목록·상세 (`communityBoardQueries.ts:208`) | `community_posts` 직접 SELECT + 레거시 폴백 | **V1** `community_posts_v1` | **대체** | XW-09, XW-14 (**글 목록 한정** — `listPopularHashtags`/`community_hashtags` 경로는 V1로 덮이지 않는다. §23 U-12) |
| 7 | 댓글 조회 (`comments`/`community_comments` 이중) | 두 테이블 직접 SELECT | **V2** `community_comments_v1` | **대체** | XW-09 |
| 8 | 글 작성·수정·삭제 (`communityBoardActions.ts`) | `community_posts` 직접 INSERT/UPDATE/DELETE | **F4/F5/F6** | **대체** | XW-09(hard delete), 앱 동등성 |
| 9 | `lib/auth/mentorPublicRead.ts:76,110,138` | `mentor_directory_list_v2` + `mentor_profiles_for_directory_v2` + `mentor_user_public_v2` | **V3** `mentor_directory_v1` | **대체**(3종 → 1 view) | XW-02b, PII 축소 |
| 10 | 멘토 프로필 저장 (`mentorProfileMutations.ts`) | `mentor_profiles` 직접 UPDATE(전 컬럼) | **F7** | **대체** | **XW-02** |
| 11 | 멘토 요금제 저장 (`mentorProfileMutations.ts:46-113`) | `mentor_plans` 직접 upsert(밴드=JS 검증) | **F8** | **대체** | **XW-03** |
| 12 | `subscribeCheckoutService.ts:843` | `confirm_subscription_checkout(3인자)` | **F12** `api_web_v1.subscription_checkout_confirm_v2(4인자)` — 재생 자체 판정 + room_id 반환 | **wrapper** | **XW-04**, XW-07 |
| 13 | `lib/toss/cashTopupFromPayment.ts:74` **만** | `record_cash_topup(3인자)` | **F11** `api_web_v1.record_cash_topup_v2(3인자)` — `lib/cash/walletTopupActions.ts:97`(테스트 충전, 키 형식 `cash_topup_…`)는 **전환 대상에서 제외, 기존 함수 유지**(rev 8 A-6 정정 2) | **wrapper**(Toss 경로만) | **W3** |
| 14 | 지갑·원장 조회 (`lib/cash/cashQueries.ts`, `firstReadableTable` 프로빙) | `cash_wallets`/`cash_ledger` 직접 SELECT + 테이블 프로빙 | **V4** + **V5** | **대체** | XW-10, W3 가시화 |
| 15 | 구독 조회 (`SUB_TABLES` 프로빙) | `subscriptions` 직접 SELECT | **V6 RPC** `my_subscriptions_self()` | **대체** | XW-10 |
| 16 | 멘토 정산 조회 | `subscription_settlement_items` 직접 SELECT | **V7 RPC** `mentor_settlement_self()` | **대체** | — |
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
| 30 | 숏폼 Storage | `shortform-videos`/`shortform-thumbnails` | — | **유지**(정책 실측 정정은 §14.8 — `sf_insert_mentor` 1정책 · `sfv_mentor_insert` 1정책/2버킷) | XW-06 §23 이월 |
| **31** | 정산계좌 저장 (`lib/mentor/mentorPayoutAccountActions.ts:39`) | `mentor_profiles` 정산계좌 컬럼 **세션 클라이언트 직접 UPDATE**(실측 — `MentorPayoutAccountPanel.tsx` 연결 활성 경로) | **F13** `mentor_payout_account_update_self` | **대체** | **U-06 → rev 8 A-4** (M11 게이트 ② 선행 조건) |

**전환 요약**: 대체 13건 · wrapper 4건 · 유지 14건 (31행 — #13은 Toss 경로만 wrapper, 테스트 충전 경로는 유지). 신규 객체 **27개**(view 5 + function 20 + 컬럼 2 — §부록 A)로 **웹 호출점 51 RPC + 51 테이블 중 17개 경로**를 정리한다. 나머지는 S2에서 손대지 않는다.

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
| 자금 확정 | `confirm_subscription_checkout` | **유지 + F12 wrapper**(최초 실행 한정 — 재생 판정은 F12 자체 수행, §7 F12) | F12가 내부 호출하므로 **영구 유지**(철거 대상 아님) |
| | `record_cash_topup(3인자)` | **유지 — 3층 구조의 2층**(rev 8 A-6): 내부 구현만 `core_private.record_cash_topup_impl` 호출로 교체, 시그니처·void 반환·service_role 전용·duplicate 무음 계약 불변. **테스트 충전 경로의 정본으로 존속** | 기존 원장 행 호환 + 테스트 충전 경로. **영구 유지** |
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
| `payments` (동적 접근) | 유지. 단 프로빙 제거 후 리터럴 접근으로 전환 권고(**§20.4 C10** — v1.1 정정, rev 8 E-3: 구 "§20 M10" 오참조 교체. 프로빙 제거는 마이그레이션이 아니라 웹 callsite 코드 작업이다) |

---

## 19. `api_app_v1`과의 공용·웹전용·앱금지 경계표 `[TO-BE]`

### 19.1 제품 경계 (지시서 §4 기준 + 실측 반영)

| 기능 | 웹 | 앱 | 신규 객체 배치 |
|---|---|---|---|
| 신규 회원가입 | ✅ | ❌ | 신규 객체 없음(기존 auth 경로 유지) |
| **NICE PASS 본인인증** | 계약상 웹 전용 | ❌ | **구현 0건 — 신규 객체 없음**(XW-12, B-01) |
| 신규 구독·결제 | ✅ | ❌ | **F12** (`api_web_v1`, **service_role 전용 EXECUTE** → 앱 anon 키·authenticated로 도달 불가 — rev 8 A-2) |
| 구독 변경·해지 | ✅ | ❌ | 신규 객체 없음 |
| 신규 개별질문 등록·결제 | ✅ | ❌ | 신규 객체 없음(기존 service_role RPC) |
| 캐시 충전·결제 확정 | ✅ | ❌ | **F11** (`api_web_v1`, **service_role 전용 EXECUTE** — rev 8 A-2) |
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
| 커뮤니티 이미지 ref·서명 URL·업로드·보상 삭제 규약이 동등한가 | **조건부 충족 — 앱 v1.1이 새 웹 정본으로 재동기화된 뒤 PASS** | §14.5 표 — ref 형식·TTL 3600초·5장/5MiB/4MIME·soft delete는 일치. 보상 삭제는 웹 v1.1이 정본을 **재호출 선행·보상 삭제 후행**(§14.4·§7 F4 replay-first)으로 개정했으므로, 앱 계약 §6.3의 구순서("불명확 시 선삭제")가 §19.5 #8로 재동기화되어야 PASS |
| 질문방·무료질문 자격 판단이 모순되지 않는가 | **충족(구조적 보장)** | 웹 F2·앱 wrapper가 **동일한 F10**을 호출. 소비는 양쪽 모두 정본 `qna_create_question_thread`가 수행 |
| 앱 금지 기능이 `api_app_v1`에 유입되지 않는가 | **충족** | F11·F12는 `api_web_v1`에 있고 `anon`·`authenticated` EXECUTE 없음(service_role 전용) → 앱 anon 키로 도달 불가. 내부 구현부(`core_private`)는 외부 EXECUTE 0 |
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

### 19.5 앱 계약 v1.1 동기화 기준 — 웹 계약이 공용 계약의 정본 (rev 8 F, v1.1 신설) `[TO-BE]`

`api_app_v1` 계약 v1.1 작성 세션은 아래 항목을 이 문서와 **동일하게** 반영해야 한다. 공용 함수·오류코드·GRANT·envelope의 정본은 본 문서다.

1. **F4/F5 시그니처 재배열(rev 8 A-1 — 앱 계약 §3.3이 원출처):** `community_post_create(p_title, p_body, p_category, p_idempotency_key, p_image_refs DEFAULT, p_status DEFAULT)` · `community_post_update(p_post_id, p_title, p_body, p_category, p_expected_updated_at, p_image_refs DEFAULT, p_status DEFAULT)` — 필수 인자 선행·DEFAULT 후행·named notation 의무(§7 F4·F5·F6). **앱 계약 Gate 4의 "문서 게이트 PASS" 판정은 A-1로 소급 무효 — v1.1에서 재게이트한다.**
2. **`SUBSCRIPTION_REFUND_PENDING` 오류 코드 정합화:** 앱 계약 §4.3 목록에 누락된 이 코드(§9.3)를 추가한다.
3. **응답 envelope 가정 재기술:** 웹 계약 §8과 동일 구조(`ok`/`contract_version`/`code`)로 재기술한다 — 정본 `public` 함수가 envelope를 반환한다는 v1.0의 가정을 정정한다.
4. **Gate 4 재게이트:** 1항의 소급 무효를 반영해 시그니처·오류코드·GRANT contract test를 다시 통과시킨다.
5. **주간 사용량 pair-party 가드(rev 8 A-8):** 레거시 `get_weekly_question_usage`에 NULL-safe pair-party 가드가 추가된다(§7 F1). **앱 호출(자기 학생 ID 전달)은 `auth.uid() = p_student_id`로 통과하므로 영향이 없다** — 이 사실을 앱 계약에 명기한다.
6. **공용 커뮤니티 내부 함수 대조표(오너 확정):** 웹·앱 계약이 공유하는 커뮤니티 내부 함수의 **이름·시그니처·오류코드·GRANT가 웹 계약과 동일**함을 증명하는 대조표를 앱 계약 v1.1에 추가한다. 대조 기준(본 문서): `core_private.community_post_create_impl(uuid,text,text,text,text[],text,uuid)` · `community_post_update_impl(uuid,uuid,text,text,text,text[],text,timestamptz)` · `community_post_soft_delete_impl(uuid,uuid)` · `community_image_refs_validate(uuid,text[])` — 전부 `SECURITY INVOKER`·`search_path=''`·외부 EXECUTE 0(§7 F4·F5·F6, §10.3). 공용 방 확보는 `core_private.ensure_student_mentor_room(uuid,uuid,uuid,uuid,boolean)`(§7 F10). 오류코드는 §9.2~9.4, envelope는 §8.1.
7. **`ROLE_NOT_ALLOWED` 재정의(rev 8 A-10):** 앱 계약의 커뮤니티 작성 오류코드 설명을 멘토 전용(`ROLE_NOT_MENTOR`·`MENTOR_NOT_APPROVED`) 기준으로 수정한다(§9.4).
8. **보상 삭제 순서 정정:** 앱 계약 §6.3의 "DB finalize 실패·응답 불명확이면 이번 요청 신규 객체를 보상 삭제" 규정을 **§14.4의 재호출 선행·보상 삭제 후행 규약으로 동기화**한다 — 응답 불명확·유실은 실패 확정이 아니며, 동일 멱등키 재호출(또는 멱등키 재조회)로 성공/실패를 확정하기 전에는 Storage 신규 객체를 삭제하지 않는다. 커밋된 글의 image ref 파손을 막는 규칙이다. DB 게시물 hard DELETE 보상 처리는 계속 금지.

9. **`api_app_v1` DB 표면의 소유 migration 확정(v1.1 canon 보정 — rev 8 F, M17 신설):** 아래를 앱 계약 v1.1 재동기화 시 명기한다.
   - **`api_app_v1` DB 표면(스키마·`community_posts_v1` 뷰·앱 wrapper 5종)은 웹 저장소의 `M17`이 생성한다**(§20.2 M17). 앱 계약 §3.1·§3.2·§3.3이 요구하는 객체의 SQL 정본 소유자는 M17이다.
   - **앱 저장소는 S2 공용 DB migration의 SQL 정본을 별도로 만들지 않는다.** DB migration의 소유 저장소는 `ssambership_web/supabase/sql`로 확정한다 — 앱 저장소의 기존 `supabase/migrations` 스냅샷 체계(IQ 첨부 기록용)를 S2 공용 DB migration 정본으로 사용하지 않는다.
   - **앱 제품 코드 전환은 `M17` 적용 + `D-API-A`(Exposed schemas에 `api_app_v1` 추가·§20.6) 이후에만** 시작한다. 그 전에는 앱이 호출할 표면이 존재하지 않거나 REST로 도달할 수 없다.
   - **M16(HD-1)은 앱 Gate 4 통과와 직접 쓰기 0건 확인 전에는 금지**된다(§20.3 M16 게이트). M17 적용 직후 M16을 실행하지 않는다.
   - 앱 wrapper 5종의 시그니처·GRANT·envelope는 앱 계약 §3.3·§10 Gate 4와 **완전히 동일**해야 하며, `core_private` 구현부는 M7·M5가 만든 동일 객체를 **공유**한다(복제 금지 — §12 대조표).
   - **앱 계약 v1.1은 이 보정을 반영한 새 웹 정본 commit·SHA-256으로 다시 동기화해야 한다**(앱 §14 대조표의 "웹 정본 정체성" 행을 새 값으로 갱신 — 구 정본 `53120d02…`/`0df3a98d…` 참조를 남기지 않는다).

**동기화 의무:** 웹 지시서와 앱 지시서 사이의 오류코드·room 의미론·테스트 기대값은 동일해야 한다 — F12 재생 계약(§7 F12: `subscription.last_payment_id` 유일 정본 · `SUBSCRIPTION_REF_INVALID` detail 3종 · C 당사자 = `PARTY_BINDING_MISMATCH` · 9단계 우선순위 · 검증 선행·쓰기 후행 · room nullable 참조의 Phase 2 복구 · 늦은 과거 재생의 무부작용 멱등 성공 · 테스트 A~H)이 그 기준이다.

---

## 20. 삭제 없는 timestamp migration 분해안과 적용 순서 `[TO-BE]`

### 20.1 규칙

- 이번 세션은 **migration 파일을 만들지 않는다.** 아래는 분해안이다.
- 전부 **추가형**이다. 기존 190개 SQL을 수정·재번호·삭제하지 않는다.
- Supabase **표준 timestamp migration**(`YYYYMMDDHHMMSS_name.sql`)을 쓰고, 번호 접두어 체계를 신규에 쓰지 않는다.
- **상태를 생성·변경하는** 각 migration에는 **대응 rollback migration**을 별도로 설계한다(§22). **M2·M3(retired)와 M10(상태 0 읽기 전용 assertion checkpoint)은 예외**다.
- 운영 DB에 대한 임의 `execute_sql` 적용을 금지한다. 검토된 단일 배포 경로(`apply_migration`)만 쓴다.

### 20.2 migration 논리 ID·분해안

> **번호는 시간 순서가 아니라 논리 ID다.** M0~M17 각 번호는 마이그레이션의 정체성(객체 묶음)을 가리키며, 표의 나열 순서는 적용 순서가 아니다. **적용 순서의 정본은 §20.2.1의 선행조건 그래프**이고, 각 간선의 상세 조건은 §20.3 게이트 표가 정의한다. **M2·M3는 retired 슬롯**이다(rev 8 A-6의 번호 불변 정책 — 번호를 당기지 않고 논리 슬롯으로 유지, stale 참조 재발 방지) — 적용·롤백 대상이 아니다. **M17은 v1.1 canon 보정으로 신설된 `api_app_v1` DB 표면 소유 migration이다**(rev 8 F 보정 — v1.0/v1.1 초판에서 `api_app_v1` 스키마·뷰·wrapper를 생성하는 소유 migration이 M0~M16에 누락돼 있던 계약 결함을 해소한다. 앱 계약 §3.1·§3.2·§3.3·§10이 요구하는 표면의 SQL 정본 소유자가 없던 문제 — §19.5 #9·부록 C).

| # | migration | 내용 | 되돌릴 수 있나 |
|---|---|---|---|
| **M0** | `..._mentor_profile_privileged_column_guard.sql` | **필수·우선 적용(rev 8 A-7 — 구 "선택·권고" 폐기).** `mentor_profiles`에 BEFORE INSERT OR UPDATE 트리거를 추가해 `verification_status`·`cap_limit` 변경을 service_role / JWT 없는 세션 / 기존 admin 으로 제한(§20.5 재기술) + **트리거 함수 PUBLIC EXECUTE 회수(같은 트랜잭션)** | ✅ 트리거·함수 DROP |
| **M1** | `..._api_web_v1_schemas.sql` | `api_web_v1`·`core_private` 생성, `REVOKE ALL FROM PUBLIC`, 스키마 USAGE(§10.1 — `core_private`는 어떤 외부 역할에도 USAGE 미부여), `ALTER DEFAULT PRIVILEGES … REVOKE EXECUTE FROM PUBLIC` | ✅ 스키마 DROP(비어 있을 때) |
| **M2** | **retired / no migration** (rev 8 A-6) | 구 `cash_ledger.ref_text` 컬럼·부분 인덱스 — **폐기.** 번호를 당기지 않고 논리 슬롯으로 남긴다(stale 참조 재발 방지, M3~M12의 논리 ID 유지) | — |
| **M3** | **retired / no migration** (rev 8 A-9) | 구 F0 라벨 헬퍼 — **F0 폐기로 불요.** M2와 동일한 retired 슬롯 정책 | — |
| **M4** | `..._api_web_v1_read_views.sql` | **V1~V5 뷰 5종** + view GRANT(§10.2). V6·V7은 RPC로 M6에 | ✅ DROP VIEW |
| **M5** | `..._core_private_room_ensure.sql` | **F10** `ensure_student_mentor_room` + `REVOKE ALL … FROM PUBLIC`(외부 EXECUTE 0 — 같은 마이그레이션) | ✅ |
| **M6** | `..._api_web_v1_self_rpc.sql` | **F1, F2, F3, F9** + **V6·V7 RPC**(`my_subscriptions_self`·`mentor_settlement_self`) + GRANT | ✅ |
| **M7** | `..._api_web_v1_community_rpc.sql` | **F4, F5, F6** + **공용 구현부 B-1~B-4**(`core_private.community_post_*_impl`·`community_image_refs_validate`, 외부 EXECUTE 0) + GRANT — 생성과 권한 회수 동일 마이그레이션 | ✅ |
| **M8** | `..._api_web_v1_mentor_rpc.sql` | **F7, F8** + GRANT (**불변 — rev 8 C: HD-1을 여기에 얹지 않는다**) | ✅ |
| **M9** | `..._money_rpc.sql` | **F11 3층**(`core_private.record_cash_topup_impl` 신설 + `public.record_cash_topup` 내부 구현 교체 + `api_web_v1.record_cash_topup_v2`) + **F12** `api_web_v1.subscription_checkout_confirm_v2` + service_role 전용 GRANT·내부 구현부 EXECUTE 회수 — 전부 같은 마이그레이션 | ✅ |
| **M10** | `..._contract_permission_assertions.sql` | **최종 권한 assertion checkpoint** — M11·M12·M16을 포함한 검사 대상 마이그레이션이 전부 적용된 뒤 실행(§20.2.1). **운영 M10의 검사 범위는 카탈로그·ACL·정책·함수 속성의 읽기 전용 assertion만**이다(`DO $$ … RAISE EXCEPTION`, §21 T-PERM 중 카탈로그로 판정 가능한 항목 한정 — 상태 변경 가능 기능 테스트는 §21.10대로 브랜치 DB/로컬 스택에서 수행) | — (**rollback 객체 없음** — 상태를 만들지 않는 검증 checkpoint, §22 #2) |
| — | *(웹 코드 전환 — migration 아님)* | 호출점을 신규 객체로 이동(§17), 프로빙 제거 | — |
| **M11** | `..._revoke_mentor_profiles_write.sql` | §10.6 `mentor_profiles` **테이블 단위 `REVOKE ALL` + `GRANT SELECT`**(rev 8 A-3) | ✅ GRANT 복원 migration |
| **M12** | `..._revoke_mentor_plans_write.sql` | §10.6 `mentor_plans` **테이블 단위 `REVOKE ALL` + `GRANT SELECT`**(rev 8 A-3) | ✅ GRANT 복원 migration |
| **M13** | `..._comments_author_label_denormalize.sql` | **V2 선행 비정규화**(rev 8 A-9 — §10.4): `comments.author_label`·`author_role` 컬럼 + BEFORE INSERT 트리거 + 백필 | ✅ 트리거 DROP·컬럼 DROP(백필 값 소실 주의) |
| **M14** | `..._api_web_v1_payout_account_rpc.sql` | **F13** `mentor_payout_account_update_self` + GRANT (rev 8 A-4) — **M11 게이트 ②의 선행 조건** | ✅ DROP FUNCTION |
| **M15** | `..._weekly_usage_pair_party_guard.sql` | 레거시 `public.get_weekly_question_usage`에 **NULL-safe pair-party 가드** 추가(rev 8 A-8 — §7 F1). M0처럼 독립·조기 적용 가능 | ✅ 가드 없는 구 본문 복원 migration |
| **M16** | `..._community_direct_write_lockdown.sql` | **HD-1**(rev 8 C — §14.7): `community_posts` `REVOKE ALL` + `GRANT SELECT` + 쓰기 정책 6종 제거 | ✅ GRANT·정책 복원 migration |
| **M17** | `..._api_app_v1_surface.sql` | **`api_app_v1` DB 표면(rev 8 F 보정 — 앱 계약 §3 소유 migration 누락 해소).** ① `api_app_v1` 스키마 ② `REVOKE ALL ON SCHEMA api_app_v1 FROM PUBLIC, anon` ③ `GRANT USAGE ON SCHEMA api_app_v1 TO authenticated` ④ `api_app_v1.community_posts_v1` 뷰(`security_invoker=true`) ⑤ 앱 wrapper 5종(`ensure_free_question_room`·`qna_create_question_thread`·`community_post_create`·`community_post_update`·`community_post_soft_delete`) ⑥ 각 객체 최소 GRANT/REVOKE(외부는 `authenticated`만, `PUBLIC`·`anon` 불필요 권한 0) ⑦ default privilege 방어(`ALTER DEFAULT PRIVILEGES … REVOKE EXECUTE FROM PUBLIC`) ⑧ 시그니처는 앱 계약 §3.3·§3.4·§10 Gate 4의 identity argument와 완전 동일. **`core_private` 구현부(B-1~B-4·F10)는 M7·M5가 만든 동일 객체를 공유 — 복제 금지.** (Data API Exposed schemas 추가는 SQL이 아닌 플랫폼 단계 D-API-A, §20.6) | ✅ wrapper·뷰·스키마 DROP migration(**단, §22 순서 — Exposed schemas에서 `api_app_v1` 제거·PostgREST 반영이 DROP보다 선행**) |

#### 20.2.1 실행 순서 정본 — 선행조건 그래프

적용 순서의 **권위(정본)는 아래 선행조건 그래프**다. 그래프를 위반하지 않는 어떤 위상 정렬도 유효하며, §20.3의 게이트 표가 각 선행조건의 상세 판정 기준을 정의한다.

```text
M0  : 선행 없음 — 필수·최우선. 본 작업 체인(M1 이하) 전체의 실제 선행 간선 (rev 8 A-7)
M15 : 선행 없음 — 유일하게 M0와 독립·병행 가능 (rev 8 A-8)
M1  : M0
M13 : M0
M4  : M1 + M13                      # V1~V5 뷰 — V2가 M13 비정규화 컬럼을 참조
M5  : M1                            # F10
M6  : M5                            # F1·F2(F10 호출)·F3·F9 + V6/V7 RPC
M7  : M1                            # F4/F5/F6 + 공용 구현부 B-1~B-4
M8  : M1                            # F7·F8
M14 : M1                            # F13
M9  : M5                            # F11 3층·F12(F12가 F10 내부 호출) + §20.3 사전 검사
M17 : M5 + M7 + M13                 # api_app_v1 표면(스키마·community_posts_v1·앱 wrapper 5종) — rev 8 F 보정
                                    #   M5=F10(ensure_free_question_room 호출) · M7=공용 impl B-1~B-4(F4/F5/F6 wrapper 호출)
                                    #   M13=community_posts_v1 의 author_label·author_role 사용 · M1은 M5·M7 선행이라 간접 충족
M11 : M8(F7)+C6 전환 · M14(F13)+C11 전환 · 백업 upsert 제거 · 직접 쓰기 0건 실측
M12 : M8(F8)+C6 전환 · 플랜 직접 쓰기 0건 실측
M16 : M7 + M17 + 웹·앱 F4/F5/F6 전환(C5 포함) + 앱 보상 DELETE 제거 + 직접 쓰기 0건 실측
      (§14.7 확대 게이트 7단계 + 앱 Gate 4 통과 — M17 적용 직후 M16 실행 금지: 앱 코드 전환·Gate 4가 별도 선행)
M10 : M11 + M12 + M16 + M17         # 최종 권한 assertion checkpoint —
      (+ 검사 대상 객체 마이그레이션 전부: M0·M1·M4~M9·M13·M14·M17)
      # M10이 검사하는 모든 객체·회수 마이그레이션이 먼저 적용되어야 한다.
      # 읽기 전용·상태 0 (§20.2 표·§21.10 검사 범위 참조)
```

- **M0 최우선의 그래프 표현:** `M1: M0`·`M13: M0` 간선으로 인해, 어떤 유효한 위상 정렬에서도 **M0는 본 작업 체인(M1·M13과 그 후행 전부)보다 먼저** 온다. M15만 M0와 독립이라 병행 가능하다.

권고 직렬화 — 위 그래프의 유효한 위상 정렬 한 가지(§24.2와 동일, C 단계 삽입):

```text
M0(M15 병행 가능) → M1 → M13 → M4 → [D-API-W: api_web_v1 Exposed schemas 추가 — C1 이전] → C1 → M5 → M6 → C2·C3·C4 → M7 → C5
→ M17 → [D-API-A: api_app_v1 Exposed schemas 추가 — 앱 Gate 4 이전] → 앱 F4/F5/F6·Gate 4 전환
→ M8 → C6 → M14 → C11 → M9 → C7·C8 → (직접 쓰기·호출 0건 확인) → M11 → M12
→ (§14.7 게이트 + 앱 Gate 4 충족 후) M16 → M10 → C9·C10
```

### 20.3 게이트 (앞 단계 미충족 시 다음 단계 금지)

| 게이트 | 조건 |
|---|---|
| M4 이전 | M1·M13 적용(M2·M3는 retired) + `api_web_v1`·`core_private`에 `PUBLIC` 권한 0건 실측 |
| M6 이전 | M5의 F10이 동시성 테스트(T-CONC-01) 통과 |
| M9 이전 | F11 3층 계약 테스트(§21.9 T-TOP) + F12 재생 계약 테스트(§21.8 T-REP) 설계 확정. **F12 배포 전 사전 검사(rev 8 A-2 §3):** "기존 succeeded 구독 결제 중 `mentor_student_rooms` 행이 없는 건"을 탐지·보정하는 점검 절차 수행 |
| **M11 이전** | ① F7 전환 완료 ② **M14(F13) 적용 + 웹 호출부(`lib/mentor/mentorPayoutAccountActions.ts`) 전환** ③ `syncAfterSignUpWithSession` 백업 upsert 제거 ④ 프로필 직접 쓰기 실측 0건 확인(웹·앱 — 앱 영향 없음은 **§19.4-B에서 실측 완료**) |
| **M12 이전** | ① F8 전환 완료 ② 플랜 직접 쓰기 실측 0건 확인 |
| **M17 이전** | M5(F10)·M7(공용 impl B-1~B-4)·M13(comments 라벨 비정규화) 적용 + `api_app_v1`에 `PUBLIC`·`anon` 권한 0건 실측 + **`core_private` 구현부 복제 0건**(M7·M5 객체 공유 확인) |
| **D-API-A(플랫폼 단계) 이전** | M17 적용 완료·`api_app_v1` 생성 확인. Data API Exposed schemas 추가는 SQL migration이 **아님**(§20.6). 앱 Gate 4 전환 이전 완료 |
| **M16(HD-1) 이전** | §14.7 확대 게이트 7단계 — F4/F5/F6 웹·앱 전환 + 멱등 재시도 구현 + 앱 보상 DELETE 제거 + 직접 쓰기 0건 확인 + service_role moderation 예외 목록화 + **M17 적용 + D-API-A 노출 + 앱 Gate 4 통과** |
| 전 단계 공통 | Data API exposed schema에 `core_private`가 **없음** 확인. `api_web_v1`·`api_app_v1`은 **노출**(D-API-W·D-API-A, §20.6) |

### 20.4 웹 callsite 전환 계획 (migration 사이에 끼는 코드 작업)

| 순서 | 대상 | 선행 migration |
|---|---|---|
| C1 | 읽기 경로 → V1~V7 (프로빙 제거 동반) | M4 |
| C2 | `weeklyQuestionUsage` → F1 | M6 |
| C3 | `freeQuestionRoom` + 구독 확정 방 확보 → F2/F10 | M5, M6 |
| C4 | `questionRoomRpc.createThread` → F3 | M6 |
| C5 | 커뮤니티 쓰기 → F4/F5/F6 | M7 |
| C6 | 멘토 프로필·요금제 저장 → F7/F8 | M8 |
| C7 | 충전 원장 → F11 (`p_order_ref = orderId`) — **`lib/toss/cashTopupFromPayment.ts`만.** `walletTopupActions.ts`(테스트 충전)는 제외·기존 함수 유지(rev 8 A-6 정정 2) | M9 |
| C8 | 구독 확정 → F12 (`p_expected_amount_cents` = 학생에게 표시한 금액) | M9 |
| C9 | `assertAccountActive` fail-open 제거(§11.5) | — |
| C10 | 런타임 스키마 프로빙 제거(`firstPayTable`·`firstReadableTable`·`pickExistingColumn` 호출부) | C1 완료 후 |
| **C11** | 정산계좌 저장 → F13 (`mentorPayoutAccountActions.ts` 전환 — M11 게이트 ② 선행 조건) | M14 |

**C8 주의**: `p_expected_amount_cents`는 **학생이 결제 화면에서 실제로 본 금액**이어야 한다. 서버가 확정 직전에 `mentor_plans`를 다시 읽어 채우면 XW-04가 그대로 남는다. 결제 intent 생성 시점의 금액을 세션·`payments` 행에 보존해 전달한다.

### 20.5 M0 — XW-02 선행 완화 (rev 8 A-7: 재기술 + **필수화**)

**문제**: XW-02(멘토 자기승인)의 정식 해소는 M11(테이블 단위 전면 REVOKE)이고, M11은 F7 배포 + 웹 callsite 전환이 선행돼야 한다. 그 사이 기간 동안 결함이 그대로 남는다.

**필수화(rev 8 A-7 — 오너 확정):** authenticated가 `mentor_profiles` UPDATE 권한을 보유한 실측 상태에서 자기 행 `verification_status`·`cap_limit` 조작이 열려 있으므로 **M0는 권장이 아닌 필수 마이그레이션**이다. A-3 전면 REVOKE(M11) 이후에도 **심층 방어로 유지**한다. (구 B-06 blocker는 이 확정으로 해소 — §23.)

이미 DB에서 검증된 패턴을 **그대로 복제**해 `mentor_profiles`의 특권 컬럼에 적용한다. 이 저장소·DB는 컬럼 단위 인가에 BEFORE 트리거를 쓰는 관행이 이미 확립돼 있다 — `enforce_users_role_guard`(`users.role`)와 `reviews_enforce_update`(리뷰 컬럼별 액터 분기)가 실측 선례다.

**재기술 근거(rev 8 A-7 — 확정 사실만):**

- `mentor_profiles.cap_limit`은 기본값 `28` **NOT NULL**이다(실측) → INSERT 발화 조건으로 `new.cap_limit IS NOT NULL`을 쓰면 **항상 참**이라 함수가 모든 INSERT에서 불필요하게 실행된다 → 기본값 대비 조건(`new.cap_limit IS DISTINCT FROM 28`)으로 재작성한다.
- PostgreSQL(17 문서 기준)에서 **INSERT 트리거의 `OLD`는 NULL**이다 → `TG_OP` 분기 **전에** `OLD`를 비교하는 v1.0 함수 구조는 잘못됐다 → **`TG_OP` 선분기(INSERT/UPDATE 분리)** 로 재작성하고, 민감 필드 비교는 `IS DISTINCT FROM`만 쓴다.
- 가입 성공 여부는 이후 `auth.jwt()` NULL 평가 통과 여부에 달려 있어 실제 가입 테스트 없이 확정할 수 없다 — 가입 실패 여부에 대한 단정은 이 계약에 두지 않는다.

**INSERT까지 덮어야 한다(C6).** XW-02의 (나) INSERT 경로는 `BEFORE UPDATE` 전용 트리거로 막히지 않으므로, 트리거를 **`BEFORE INSERT OR UPDATE`** 로 건다.

```sql
-- 형태(구현 시 최종 확정). 기존 users 가드와 동일한 3분기 구조 + TG_OP 선분기 (rev 8 A-7).
CREATE OR REPLACE FUNCTION public.enforce_mentor_profile_privileged_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_jwt_role  text;
  v_sensitive boolean;
BEGIN
  -- TG_OP 선분기: INSERT 에서 OLD 는 NULL 이므로 OLD 비교 전에 반드시 분기한다.
  IF tg_op = 'INSERT' THEN
    -- 기본값 대비 판정. 28 하드코딩은 컬럼 기본값 변경 시 드리프트하는 취약점이다 —
    -- 기본값을 바꾸는 마이그레이션은 이 조건을 함께 갱신해야 한다(주석 의무).
    v_sensitive := (new.verification_status IS DISTINCT FROM 'pending'
                    OR new.cap_limit IS DISTINCT FROM 28);
  ELSE  -- 'UPDATE'
    v_sensitive := (new.verification_status IS DISTINCT FROM old.verification_status
                    OR new.cap_limit IS DISTINCT FROM old.cap_limit);
  END IF;

  IF v_sensitive THEN
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

-- [필수 — rev 8 A-7] 트리거 함수 생성과 동일 트랜잭션에서 PUBLIC EXECUTE 회수:
REVOKE ALL ON FUNCTION public.enforce_mentor_profile_privileged_guard()
FROM PUBLIC;

-- UPDATE: 특권 컬럼이 바뀔 때만
CREATE TRIGGER trg_mentor_profile_privileged_guard_upd
  BEFORE UPDATE ON public.mentor_profiles
  FOR EACH ROW
  WHEN (old.verification_status IS DISTINCT FROM new.verification_status
        OR old.cap_limit IS DISTINCT FROM new.cap_limit)
  EXECUTE FUNCTION public.enforce_mentor_profile_privileged_guard();

-- INSERT: 'pending' 이외의 verification_status 또는 기본값(28) 이외의 cap_limit 지정을 막는다 (C6)
--   (구 WHEN 조건 new.cap_limit IS NOT NULL 은 기본값 28 NOT NULL 때문에 항상 참 — 폐기)
CREATE TRIGGER trg_mentor_profile_privileged_guard_ins
  BEFORE INSERT ON public.mentor_profiles
  FOR EACH ROW
  WHEN (new.verification_status IS DISTINCT FROM 'pending'
        OR new.cap_limit IS DISTINCT FROM 28)
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

- M0는 **추가형**이며 M1~M16과 독립이다. F7 배포를 기다리지 않는다.
- M11 적용 후에도 M0를 남겨 둔다(권한 회수 + 트리거 이중 방어).
- **이 문서는 M0를 적용하지 않는다(문서 계약).** 적용 여부는 rev 8 A-7로 **필수 확정**됐고(구 B-06 해소), 시점은 S2 착수 즉시·우선이다.
- 동일 논리의 `mentor_plans` 밴드 강제 트리거도 가능하지만, 밴드 상수를 DB에 이중 정의하게 되므로 **F8(M8)로 처리하는 것을 권고**한다. 급하면 `amount_cents > 0` 및 tier allowlist CHECK만 먼저 거는 것도 선택지다.

### 20.6 Data API exposed schema 플랫폼 단계 (migration 아님 — rev 8 F 보정)

`api_web_v1`·`api_app_v1`을 웹·앱 클라이언트가 PostgREST로 호출하려면 Data API의 **Exposed schemas** 목록에 포함돼야 한다. 이는 **SQL migration이 아니라 Supabase 플랫폼 설정**이므로 M계열 migration과 분리해 별도 operational step으로 관리한다(M17이 `api_app_v1` 객체를 만들지만, 노출 자체는 이 플랫폼 단계가 담당한다). 대시보드가 Exposed schemas를 관리하는 상태에서는 **임의로 `ALTER ROLE authenticator SET pgrst.db_schemas`를 실행하지 않는다**(플랫폼 설정과 이원화되어 드리프트가 생긴다).

| 단계 | 내용 | 시점 |
|---|---|---|
| **D-API-W** | `api_web_v1`을 Exposed schemas에 추가 | M1 적용 후 · **C1(웹 읽기 경로 전환) 이전** 완료 |
| **D-API-A** | `api_app_v1`을 Exposed schemas에 추가 | **M17 적용 후 · 앱 Gate 4 전환 이전** 완료 |

목표 상태:

```text
api_web_v1   : exposed
api_app_v1   : exposed
core_private : never exposed
```

- `core_private`는 Exposed schemas에 **절대 포함하지 않는다.** `anon`·`authenticated`·`service_role`에 스키마 USAGE와 외부 EXECUTE가 **0**이어야 한다(§10.1·§21 T-PERM-01·03·06).
- **설정 변경 후 검증 의무:** Exposed schemas 변경은 PostgREST가 즉시 반영하지 않을 수 있다. 변경 후 (a) PostgREST schema cache reload(`NOTIFY pgrst, 'reload schema'` 또는 대시보드 저장 시 자동 reload) 반영 여부, (b) 신규 스키마의 wrapper·뷰가 실제 REST로 도달 가능한지, (c) `core_private` 미포함을 확인한다.
- **rollback:** Exposed schemas에서 스키마를 제거하고 schema cache를 reload한다. M17 rollback은 이 플랫폼 단계(제거·반영)가 객체 DROP보다 **선행**한다(§22).

---

---

---

## 21. contract test · 권한 test · 동시성 test · 회귀 test 매트릭스 `[TO-BE]`

### 21.1 계약 테스트 (T-CON)

| id | 대상 | 검증 |
|---|---|---|
| T-CON-01 | F1~F13 전부(envelope 반환 함수) | 반환이 jsonb이고 `ok`·`contract_version` 필드를 항상 포함 (V6·V7 조회 RPC는 TABLE 반환 예외 — §8.1) |
| T-CON-02 | F1~F13 실패 경로 | `ok:false`면 `code`가 §9 사전에 있는 값 |
| T-CON-03 | V1~V5 뷰 + V6·V7 RPC | 컬럼(반환 필드) 이름·타입·순서가 §6과 일치(스냅샷 비교). V6 금액 필드명이 `current_plan_amount_cents`인지 포함 확인 |
| T-CON-04 | 웹 클라이언트 | `ok` 필드가 없는 응답을 성공으로 처리하지 않음 |
| T-CON-05 | F3 | 정본이 raise하는 14종 코드가 전부 envelope로 변환됨 |
| T-CON-06 | F3 | 사전에 없는 예외는 **전파**되고 `ok:true`로 바뀌지 않음 |
| T-CON-07 | V1 vs `api_app_v1.community_posts_v1` | 두 view의 컬럼 집합이 **동일** |
| T-CON-08 | F4/F5/F6 vs 앱 동명 함수 | 시그니처·오류코드가 **동일** |

### 21.2 권한 테스트 (T-PERM) — 전부 **실측**으로 검증

| id | 검증 | 기대 |
|---|---|---|
| T-PERM-01 | `has_schema_privilege('anon'/'authenticated'/'service_role','core_private','USAGE')` | **전부 false** (rev 8 A-2·A-6 — service_role 포함) |
| T-PERM-02 | `api_web_v1`의 모든 함수에 대해 `has_function_privilege('PUBLIC', …, 'EXECUTE')` | **false** |
| T-PERM-03 | Data API exposed schema 목록 | `core_private` **미포함** |
| T-PERM-04 | 신규 SECDEF 객체 목록 | §11.6 화이트리스트와 **정확히 일치**(추가 시 실패) |
| T-PERM-05 | 라벨 표면(F0 폐기 검증) | `api_web_v1`·`core_private`에 `user_display_label`/`user_display_role` 함수가 **존재하지 않음**. 라벨 노출은 V1·V2 비정규화 컬럼과 V6·V7 RPC 반환 필드뿐이고, 어떤 라벨 지점에서도 `full_name`·`email`·`birth_date` 미노출, admin의 표시 역할은 `NULL` |
| T-PERM-06 | F11·F12 진입점 / 내부 구현부 | `api_web_v1.record_cash_topup_v2`·`subscription_checkout_confirm_v2`: `anon`·`authenticated` EXECUTE **false**, `service_role` **true**. `core_private`의 F10·`record_cash_topup_impl`·community impl 4종: `PUBLIC`·`anon`·`authenticated`·`service_role` EXECUTE **전부 false** |
| T-PERM-07 | V4·V5 뷰 + V6·V7 RPC | `anon` SELECT/EXECUTE **false** |
| T-PERM-08 | 신규 view 전체 | `INSERT/UPDATE/DELETE` 권한이 어떤 역할에도 **없음** |
| T-PERM-09 | M11 후 | `anon`·`authenticated`의 `mentor_profiles`: **SELECT만 true**, INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER **전부 false** (rev 8 A-3 — 테이블 단위 전면 회수. 컬럼 단위 잔여 권한 0건) |
| T-PERM-10 | M12 후 | `anon`·`authenticated`의 `mentor_plans`: **SELECT만 true**, 비SELECT 6종 **전부 false**. (DELETE를 빠뜨리면 멘토가 자기 플랜 행을 지워 `confirm_subscription_checkout`이 `PLAN_NOT_FOUND`로 실패하게 만들 수 있다 — 전면 회수로 원천 차단) |
| T-PERM-11 | M11 후 | `approve_mentor_school_verification_admin`(SECDEF)이 **여전히 동작**(컬럼 회수 영향 없음 확인) |
| T-PERM-12 | 레거시 | `public` 함수 194종의 anon/auth EXECUTE가 **S2 전후 동일**(회수 0건 회귀 감시) |
| T-PERM-13 | V4·V5 | `service_role`로 조회 시 **전 사용자 행이 반환됨**(BYPASSRLS)을 명시적으로 확인 — 계약된 성질이며 호출부 필터 책임임을 고정. V6·V7 RPC는 service_role 호출 시 `auth.uid()` NULL로 거부됨을 함께 확인 |
| T-PERM-14 | M11 후 | `authenticated`의 `mentor_profiles` **INSERT false**(XW-02 (나) 차단 — T-PERM-09의 전면 회수에 포함, 회귀 분리 확인). 가입 경로가 여전히 정상 동작(트리거 `handle_new_auth_user` 경유) |
| **T-PERM-15** | M16(HD-1) 후 | `anon`·`authenticated`의 `community_posts`: **SELECT만 true**, 비SELECT 전부 **false**. 쓰기 정책 6종(§14.7) **부재**. service_role 관리자 moderation(`communityModerationCore.ts`) **정상 동작**(의도된 예외) |

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
| **T-CONC-09** | **멱등 재생 + 가격 변경(rev 8 A-5 재작성)**: F12 성공 → 멘토가 `amount_cents` 변경 → **동일 `p_payment_id`·기존 `p_expected_amount_cents`로 재시도** | **가격 변경 후 재생 = `{ok:true, idempotent:true}`, anomaly 기록 없음.** `PLAN_AMOUNT_CHANGED`·`LEDGER_FIELD_MISMATCH`가 아니어야 한다(재생은 현재 플랜 가격을 읽지 않고 `payments.amount × 100`과 기존 원장 행만 비교 — §7 F12) |
| **T-CONC-10** | **(canonical 소유 = M7 — rev 8 F 보정)** **F4 응답 유실 복구(replay-first — §7 F4·§14.4)**: 이미지 객체 업로드 → F4가 **DB commit에 성공했으나 응답을 유실**한 것으로 모사 → **재호출 전에 Storage DELETE가 0회인지 확인** → 동일 멱등키로 F4 재호출 | 동일 `post_id` + `idempotent_replay:true` / 글 **1건** / 원래 `image_refs` **불변** / 참조 객체 **전부 존재**(서명 URL 발급 가능). **추가 분기:** 확정 rollback·미커밋(replay-first가 기존 행 없음 + 확정 실패 envelope로 종결)인 경우**에만** 신규 객체 보상 삭제가 일어난다 |

### 21.4 자금 정합성 테스트 (T-FIN)

| id | 검증 |
|---|---|
| T-FIN-01 | F11 후 `cash_ledger.idempotency_key = orderId`(주문 정본 — rev 8 A-6)이고 `ref_id IS NULL`·`ref_type='topup'`. `ref_text` 컬럼은 **존재하지 않음** |
| T-FIN-02 | F11에 타인 orderId 전달 → `ORDER_REF_OWNER_MISMATCH`, 원장 0행 |
| T-FIN-03 | F12에 실제와 다른 `p_expected_amount_cents` → `PLAN_AMOUNT_CHANGED`, **차감 0** |
| T-FIN-04 | 잔액 부족 상태 F12 → `CASH_INSUFFICIENT`, 구독 생성 안 됨 |
| T-FIN-05 | IQ 1건 hold→release 후 `iq_hold` + `iq_payout` 합계 = **`-(price_cents - floor(price_cents*0.85))`** (= 플랫폼 수수료). `price_cents`가 100의 배수가 아니면 `floor(price*0.15)`와 다르므로 이 식을 정본으로 쓴다(§12.4) |
| T-FIN-06 | 원장 UPDATE/DELETE 시도 → 실패(append-only) |
| T-FIN-07 | V5의 `order_ref`가 topup 행(신규·레거시 동일)은 `idempotency_key`, **그 외 행은 NULL** (rev 8 A-6) |

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
| T-SEC-12 | PII | V3·V2(비정규화 라벨)·V6/V7 RPC 어디에도 `full_name`·`email`·`birth_date` 미노출 (임의 UUID 라벨 함수 부재는 T-PERM-05) |
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

### 21.8 F12 재생 회귀 테스트 (T-REP — rev 8 A-5 필수 8건)

> **fixture 명시:** 현재 라이브 DB에는 pair당 succeeded 결제가 최대 1건이므로 P1→P2 시나리오는 실데이터 검증 주장이 아니라, **재구독·늦은 재생을 검증하는 테스트 fixture 기반 회귀 계약**이다(테스트 주석에 명시할 것). 기호 P·C는 §7 F12 재생 계약을 따른다.

| id | 시나리오 | 기대 결과 |
|---|---|---|
| **T-REP-A** | P1 성공 → P2 성공, room=`P2` → P1 늦은 재생 | `ok:true, idempotent:true` / room 변경 0 / 자금 부작용 0, anomaly 0 |
| **T-REP-B** | P1 성공 → P2 성공 뒤 room=`P1`(stale) → P1 재생 | `ok:true, idempotent:true` / 검증 완료 후 room을 C=`P2`로 복구 / 자금 부작용 0, anomaly 0 |
| **T-REP-C** | P1 성공 → P2 성공 뒤 `room.payment_id`=NULL → P1 재생 | `ok:true, idempotent:true` / 검증 완료 후 `room.payment_id`를 C=`P2`로 복구 / 자금 부작용 0, anomaly 0 |
| **T-REP-D** | `room.payment_id`가 C도 P도 아닌 제3 결제 참조 | `ROOM_REF_MISMATCH` + `anomaly_id` / business-state 쓰기 0 |
| **T-REP-E** | `subscription.last_payment_id IS NULL` | `SUBSCRIPTION_REF_INVALID`, detail=`LAST_PAYMENT_ID_NULL` + `anomaly_id` / room 변경 0 |
| **T-REP-F** | C 행이 없거나 succeeded가 아님 | `SUBSCRIPTION_REF_INVALID`, detail=`LAST_PAYMENT_NOT_FOUND` 또는 `LAST_PAYMENT_NOT_SUCCEEDED` + `anomaly_id` / room 변경 0 |
| **T-REP-G** | C는 succeeded이나 subscription과 당사자가 다름 | `PARTY_BINDING_MISMATCH` + `anomaly_id` / room 변경 0 |
| **T-REP-H** | room 참조가 NULL 또는 stale 후보지만 P·ledger·관계 검증이 실패 | 해당 상위 안정 오류 반환(9단계 우선순위) / 후보였던 room 보정은 실행되지 않음 / room 변경 0 |

### 21.9 F11 topup 회귀 테스트 (T-TOP — rev 8 A-6 필수 6건)

| id | 시나리오 | 기대 결과 |
|---|---|---|
| **T-TOP-01** | 기존 3인자 `record_cash_topup` 신규 호출 | 원장 1행 + 지갑 가산, void 반환(기존 계약 불변) |
| **T-TOP-02** | 기존 3인자 함수 — **동일 duplicate**(같은 키·같은 필드) | 무음 반환, 지갑 미갱신(기존 계약 불변) |
| **T-TOP-03** | 기존 3인자 함수 — **충돌 duplicate**(같은 키·다른 금액) | 무음 반환(기존 계약 유지 — mismatch를 새로 노출하지 않음), 지갑 미갱신 |
| **T-TOP-04** | 동시 호출(같은 키 2회 병행 — F11 및 레거시) | 원장 정확히 1행(사전 SELECT 추정 금지 — `ON CONFLICT` 원자 판정) |
| **T-TOP-05** | 신규+duplicate 혼합 흐름에서 지갑 증분 | **정확히 1회** |
| **T-TOP-06** | **신규 F11에서만** 동일 duplicate와 충돌 duplicate 구분 | 동일 → `{ok:true, duplicate:true}` / 충돌(6필드 NULL-safe 하나라도 불일치) → `LEDGER_FIELD_MISMATCH` |

### 21.10 테스트 실행 위치

- **권한·동시성·자금 정합성**은 운영 DB가 아니라 **Supabase 브랜치 DB 또는 로컬 스택**에서 실행한다(지시서 §3 운영 DB 변경 금지).
- 계약 테스트 중 순수 로직(오류코드 매핑·밴드 상수·ref 파싱)은 기존 `__contract__` 패턴(`node --test`)을 따른다 — 저장소에 이미 `lib/*/__contract__/*.contract.test.ts` 관행이 있다.
- **M10 검사 범위 분리(운영/비운영):**
  - **운영 M10**은 M11·M12·M16·**M17**까지 적용된 뒤 실행하는 최종 checkpoint로, **카탈로그·ACL·정책·함수 속성 등 읽기 전용 assertion만** 수행한다(예: `has_schema_privilege`/`has_function_privilege`/`has_table_privilege`·`pg_policies` 존재/부재·`prosecdef`·`proconfig`·exposed schema 목록 — T-PERM-01~04·06~10·12·14, T-PERM-05의 함수 부재 확인, T-PERM-15의 GRANT·정책 부재 확인, **M17의 `api_app_v1` 스키마·wrapper 5종·뷰 GRANT 및 `PUBLIC`·`anon` 권한 0건 확인**).

### 21.11 M17(`api_app_v1` 표면) 테스트 소유권 (v1.1 보정 — rev 8 F)

migration별 테스트 소유를 아래와 같이 고정한다. 같은 시나리오라도 **표면이 다르면 소유 migration이 다르다.**

| 소유 | 테스트 범위 |
|---|---|
| **M7** | 공용 구현부 B-1~B-4와 **웹** F4/F5/F6. **`T-CONC-10`의 canonical 소유**(웹 표면 replay-first·Storage 보존) · T-CONC-06 · T-CON-07·08 |
| **M17** | **앱 Gate 4**(앱 계약 §10) · 앱 wrapper 5종의 **시그니처·GRANT·envelope**(앱 계약 §3.3 identity argument 완전 일치) · `api_app_v1.community_posts_v1` 필드·권한(T-CON-07의 앱 측) · **앱 표면에서 T-CONC-10과 동일한 응답 유실 시나리오 재검증**(동일 멱등키 F4 재호출 → 동일 `post_id`+`idempotent_replay:true`, 재호출 전 Storage DELETE 0회, `image_refs` 불변) |

- **M9는 `T-CONC-10`을 소유하지 않는다.** M9의 테스트는 T-CONC-02·03·04·08·09 · T-FIN(01~07) · T-REP A~H · T-TOP 01~06이다(자금·재생 계약 전용).
- M17의 앱 표면 재검증은 M7의 canonical 판정을 대체하지 않는다 — **같은 공용 구현부(B-1)가 두 표면에서 동일하게 동작함을 증명**하는 이중 확인이다.
  - **상태 변경 가능 기능 테스트** — 관리자 승인 동작(T-PERM-11), 가입 경로 정상 동작(T-PERM-14 후단), service_role moderation 동작(T-PERM-15 후단), V4·V5의 service_role 전행 반환 확인(T-PERM-13) 등 실제 쓰기·세션이 필요한 검증 — 는 운영 M10에 넣지 않고 **Supabase 브랜치 DB 또는 로컬 스택에서** 수행한다.
  - T-PERM 전체를 M10 SQL 한 건으로 수행한다는 해석은 금지한다 — M10은 위 읽기 전용 부분집합만 담는다.

---

## 22. rollback 원칙 `[TO-BE]`

1. **rollback이 필요한 모든 상태 변경은 별도 추가형 migration으로 되돌린다.** 기존 migration 파일을 수정하지 않는다.
2. **역순 적용 — §20.2.1 선행조건 그래프의 역방향이 정본이다.** 규칙: 어떤 마이그레이션을 되돌리기 전에, 그것에 **의존하는(그래프에서 후행하는) 마이그레이션을 먼저** 되돌린다. **M10은 상태를 만들지 않는 검증 checkpoint이므로 rollback 객체가 없다 — 상태 rollback 대상으로 취급하지 않는다.** 상태 rollback 직렬화(§20.2.1 역방향) 한 가지:

   ```text
   M16 → M12 → M11 → M9 → M14 → M8 → M17 → M7 → M6 → M5 → M4 → M13 → M1
   → M15 → (M0는 마지막이며 되도록 남긴다 — §20.5)
   ```

   핵심 역의존: M16은 M7·M17보다 먼저 / **M17은 M7·M5·M13보다 먼저**(앱 표면이 공용 구현부·라벨 컬럼에 의존) / M11은 M8·M14보다 먼저 / M12는 M8보다 먼저 / M9·M6은 M5보다 먼저 / M4는 M13·M1보다 먼저 / `api_web_v1`·`api_app_v1`·`core_private` 객체(M4~M9·M14·M17)는 스키마(M1·M17)보다 먼저. M15는 독립이므로 위치 제약이 없다(레거시 함수 구 본문 복원 migration). (M2·M3는 retired — 롤백 대상 자체가 없다.)

   **M17 rollback 필수 선행 순서(rev 8 F 보정 — `..._api_app_v1_surface_rollback.sql`):**

   1. **앱 제품 코드를 구 `public` 경로로 먼저 복원**한다(웹 코드 우선 원칙 #4와 동일 — 앱도 동일).
   2. `api_app_v1` 호출 **0건**을 실측 확인한다.
   3. **Data API Exposed schemas에서 `api_app_v1`을 제거**한다(플랫폼 단계 D-API-A의 역방향, §20.6).
   4. PostgREST 설정 반영(schema cache reload)을 확인한다.
   5. 그 다음에만 M17의 wrapper 5종 → 뷰 → 스키마를 DROP한다.
   6. M7·M5·M13 rollback은 **M17 rollback 완료 이후에만** 가능하다.

   > **금지:** Exposed schemas에 남아 있는 스키마를 먼저 DROP하지 않는다 — PostgREST가 존재하지 않는 스키마를 계속 노출 대상으로 들고 있어 schema cache 오류·요청 실패가 발생할 수 있다. 반드시 **노출 제거 → 반영 확인 → DROP** 순서다.

   **rollback 완료 후 재검증 의무:** 목표 지점까지 되돌린 뒤, M10과 동일한 **읽기 전용 assertion**(§21.10 운영 M10 범위)을 다시 실행해 복원된 권한·정책 상태가 해당 지점의 계약과 일치함을 확인한다.
3. **F11 롤백은 코드 우선이다.** `cash_ledger`에 신규 DDL이 없으므로(rev 8 A-6 — `ref_text` 폐기) 데이터 소실 시나리오가 없다. 롤백이 필요하면 웹 호출점을 기존 3인자 `record_cash_topup`으로 되돌린 뒤 M9의 함수들을 DROP한다(레거시 함수의 내부 구현 교체분은 구 본문 복원 migration으로).
4. **웹 코드 롤백이 DB 롤백보다 먼저**다. 신규 객체를 DROP하기 전에 웹 호출점을 레거시로 되돌린다 — 반대 순서는 즉시 장애다.
5. **레거시는 계속 살아 있으므로 롤백이 안전하다.** §10.5대로 S2는 `public` 표면을 회수하지 않는다. F11/F12/F3는 wrapper이므로 웹이 레거시 함수를 다시 부르면 그대로 동작한다.
6. **M11·M12 롤백은 GRANT 복원 migration**으로만 한다(rev 8 A-3 — 테이블 단위 대칭 복원):
   ```sql
   -- M11 롤백
   GRANT INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.mentor_profiles TO anon, authenticated;
   -- M12 롤백
   GRANT INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.mentor_plans TO anon, authenticated;
   ```
   회수한 권한 목록(비SELECT 6종·역할 2종)을 migration에 **문자 그대로 보존**해 대칭성을 보장한다. M16(HD-1) 롤백도 동일 원칙 — `community_posts` GRANT 복원 + 제거한 정책 6종 재생성 migration.
7. **부분 실패 시**: migration은 단일 트랜잭션으로 적용한다. 실패하면 그 migration 전체가 롤백되며, 다음 단계로 진행하지 않는다.
8. **데이터 롤백은 없다.** F4~F8이 만든 행(글·프로필·요금제)은 정상 업무 데이터이므로 되돌리지 않는다.
9. 롤백 실행도 **운영 DB 임의 `execute_sql` 금지** — 동일한 단일 배포 경로를 쓴다.

## 23. 미확정 사항과 정확한 blocker `[TO-BE]`

### 23.1 blocker 재분류 (rev 8 D — v1.1 확정)

> **재분류 결과(rev 8 D):** **S2 blocker(마이그레이션 M0~M16 진행을 막는 항목)는 0건이다.** v1.0의 blocker 표는 다음과 같이 재분류됐다 — **B-01·B-03·B-05: S2 blocker에서 해제**(오너 결정 대기 항목으로만 유지, M0~M16을 막지 않음) / **B-04: 동결 확정** / **B-06: 해소**(A-7이 M0를 필수로 확정) / **B-07: 해제**(실측 — 앱 프로필 수정은 `lib/features/mypage/data/profile_edit_repository.dart:30`의 `users` UPDATE 단일 호출뿐, `mentor_profiles` 쓰기 없음) / **B-02: 해소**(v1.0에서 기해소).

| id | 재분류(rev 8 D) | 사안 | 남은 결정·근거 | 이 계약에 미치는 영향 |
|---|---|---|---|---|
| **B-01** | **해제**(S2 비저지) | **NICE정보인증 PASS 본인인증** — 코드 0건(XW-12), 도입 여부·시점·범위는 제품 결정 | 도입 시점과 적용 범위(가입 전체 / 멘토만 / 만14세 미만 보호자) — 오너 결정 대기 | 이번 계약은 관련 객체를 **0개** 만든다. 도입 시 별도 계약 세션 필요. **M0~M16 진행을 막지 않는다** |
| **B-03** | **해제**(S2 비저지) | account-deletion worker 실행 방식 — GET/POST 경계는 기술 사실(§15.4), 실가동 여부는 운영 결정 | (a) GET 러너 추가 **(권고)** / (b) 외부 POST 스케줄러, 플래그 ON 시점 — 오너 결정 대기 | 계약은 두 안을 비교만 한다. 구축·등록·활성화 **0건**. **M0~M16 진행을 막지 않는다** |
| **B-04** | **동결 확정**(오너 확정) | 금지어 정책 — 코드가 폐지를 의도적이라고 명시(`lib/safety/trustSafetyText.ts` 상단 주석 실측) | **v1에서는 "금지어 검사 폐지, `POLICY_RESTRICTED`는 예약 코드이며 발생하지 않음"으로 한쪽 동결.** F4/F5 공용 검증부는 마스킹만 수행. 오너가 금지어를 복원하면 additive 개정으로 처리 | §9.4·§14.5에 반영 완료. 웹·앱 동등성은 공용 구현부 공유로 성립 |
| **B-05** | **해제**(S2 비저지) | 리뷰 자격 규칙 — 잠금값 "동일 멘토 2회 연속 결제 후" vs DB `check_review_eligibility` 불일치(XW-11) | 잠금값을 DB에 맞출지, DB를 잠금값에 맞출지 — 오너 결정 대기 | 이번 계약은 리뷰 객체를 만들지 않는다. **M0~M16 진행을 막지 않는다** |
| **B-06** | **해소**(rev 8 A-7) | XW-02 선행 완화(M0) 적용 여부 | **M0는 필수 마이그레이션으로 확정**(§20.5) — 결정 완료 | XW-02 노출 기간이 사라진다. M11 후에도 심층 방어로 유지 |
| **B-07** | **해제**(rev 8 D — 실측) | 앱의 "단순 프로필 수정" 제품 범위 | **실측 확정:** 앱 프로필 수정은 `users` UPDATE 단일 호출뿐, `mentor_profiles` 쓰기 없음 → §10.6 회수와 충돌 없음. 향후 앱이 멘토 프로필 쓰기를 원하면 전용 `api_app_v1` RPC로 여는 원칙만 유지 | M11 회수를 막지 않는다 |

> **B-02는 해소되었다**(v1.0 기해소) — 앱이 `mentor_profiles`·`mentor_plans`를 SELECT 전용으로만 쓴다는 실측(§19.4-B)으로 §10.6 회수의 앱 영향이 없음을 확인했다.

### 23.2 이번 세션에서 검증하지 못한 항목 (추정으로 채우지 않음)

| id | 항목 | 막힌 이유 | 필요한 권한·다음 조치 |
|---|---|---|---|
| **U-01** | `TOSS_SECRET_KEY`·**`TOSS_WEBHOOK_SECRET`** 설정 여부 | Vercel MCP `get_project`는 프로젝트 메타(도메인·최신 배포)만 반환하고 **환경변수를 노출하지 않는다.** 확인한 것: 프로젝트 `ssambership-web`(`prj_1esRN0q6npJ4BJUEqFeloX9kTTOf`), 도메인에 `ssambership.com`·`www.ssambership.com` 포함, 최신 production 배포 READY | **Vercel 대시보드에서 env 존재 여부 육안 확인.** `TOSS_WEBHOOK_SECRET` 미설정이면 webhook 복구 경로가 전면 OFF다(XW-16) |
| **U-02** | XW-06(`cpi_public_read`·`sfv_public_read` 버킷 전체 SELECT) 축소 설계 | 웹·앱 이미지 읽기가 이 정책에 의존 — 좁히면 회귀 위험이 크고 앱 동시 변경이 필요 | S3에서 앱·웹 읽기 경로를 view/RPC로 옮긴 뒤 정책 축소 설계 |
| **U-03** | mutable `search_path` 5종 | 전부 non-SECDEF 헬퍼·트리거이며 S2 범위 밖. 변경 시 회귀 위험 > 이득 | S4/S5 위생 작업 |
| **U-04** | 비내부 트리거 총량 89 재집계 | 이번 세션은 대상 테이블 단위로만 트리거를 확인했고 전수 재집계를 하지 않았다 | 필요 시 `pg_trigger` 전수 재집계 |
| **U-05** | IQ escrow `lowercase_snake` 오류코드 정규화 | 앱이 해당 함수들을 직접 사용(앱 RPC 27종) → 신규 wrapper 없이 바꾸면 앱이 깨진다 | S3에서 `api_app_v1`/`api_web_v1` IQ wrapper와 함께 |
| ~~U-06~~ | ~~멘토 정산 계좌 변경 계약~~ | **해소(rev 8 A-4)** — F13 `mentor_payout_account_update_self`로 v1.1에서 확정(§7 F13, M14). 본인확인(B-01)과 무관하게 승인 멘토 자기 행 한정·allowlist·형식 검증으로 성립 | — |
| **U-07** | 플랫폼 수수료 원장 계정 도입 | 현재 15%는 어떤 지갑에도 입금되지 않고 hold−payout 차액으로만 존재(§12.4). 회계 정책 결정 사항 | 오너·회계 확인 후 별도 설계 |
| **U-08** | `get_weekly_question_usage`의 **anon EXECUTE 회수** 가능 여부 | 앱도 이 함수를 쓰지만 로그인 후 호출로 보이므로 anon 회수는 앱에 영향이 없을 가능성이 높다. 다만 앱 호출 시점(로그인 전/후)을 이번 세션에 확정하지 못했다 | 앱 호출 경로가 전부 인증 후임을 확인하면 **F1과 무관하게 anon EXECUTE만 즉시 회수 가능** → XW-01의 미인증 노출이 조기 차단된다 |
| **U-09** | ~~앱 FORFEIT 처리~~ | **해소** — §19.4-D에서 실측 완료 | — |
| ~~U-10~~ | 웹 영역 전수 추적 | **해소** — 15개 영역 전수 추적을 **15/15 완료**했고, 그 결과를 §3.8(XW-19~XW-24)에 반영했다. §3.3의 RPC 51종·§3.4 테이블 51종·§3.5 버킷 11종은 별도로 저장소 전수 grep + DB 카탈로그 대조로 독립 확보했다 | — |
| **U-13** | `shortform-thumbnails` 쓰기 경로 부재(XW-19) | 업로더 함수는 있으나 호출자 0건이고 `thumbnailUrl`이 null 하드코딩. 배선할지 기능을 접을지는 제품 결정 | 썸네일 기능 존폐 결정 후 배선 또는 버킷 정리(S5) |
| **U-14** | 레거시 멘토 숏폼 작성 경로(XW-21) | 도달 가능하며 `video_url`·`status`를 채우지 않는다. 제거 대상인지 유지 대상인지 판단 필요 | S3에서 정본 경로로 통합 또는 제거 |
| **U-15** | 마이페이지 신고 지표(XW-22) | 존재하지 않는 `reports`/`abuse_reports`를 조회 — 정본은 `content_reports` | S3 위생 수정 |
| **U-16** | 알림 `recipient_user_id` 정합성(XW-24) | 웹 USER_FK 후보군 누락. 실제 데이터 형상은 개인정보 최소 조회 원칙상 조회하지 않았다 | `notifications`의 수신자 컬럼 사용 실태를 집계 쿼리(개인정보 미포함)로 확인 후 후보군 정정 |
| **U-12** | `community_hashtags` / `listPopularHashtags` 경로 | XW-14의 폴백 3곳 중 인기 해시태그 조회는 V1(글 목록)로 덮이지 않는다. V1 필드에 `hashtags`가 없고 `community_hashtags`는 §3.4 직접 접근 목록에 잔존한다 | S3에서 해시태그 전용 view 또는 V1 필드 확장 검토 |
| ~~U-11~~ | ~~`comments.author_label` 비정규화~~ | **해소(rev 8 A-9)** — F0 폐기에 따라 v1.1이 비정규화를 **채택**(§6 V2, §10.4, M13). 임의 uuid→nickname 조회 표면 자체가 소멸 | — |

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
| 3 | 신규 view·function 이름과 정확한 시그니처 확정 (**공용 구현부 포함 — rev 8 B로 게이트 재정의**) | ✅ | §6 조회 계약 7개(뷰 5 + RPC 2, 필드 전체) · §7 function **20개**(인자 타입 전체 — `api_web_v1` 14 + `core_private` 내부 구현부 6, 보안 속성·GRANT 전건 명세) |
| 4 | 모든 객체의 호출자·GRANT·REVOKE 확정 | ✅ | §4.1 계층 6종 · §10.1~10.4 DDL |
| 5 | 안정 오류코드와 반환 envelope 확정 | ✅ | §8 envelope · §9 사전 + 레거시 매핑표 |
| 6 | 결제·환불·원장·정산의 멱등·동시성·트랜잭션 규약 확정 | ✅ | §12.1~12.5 (lock 순서·멱등키 총람·재시도 전제) |
| 7 | Toss `orderId` 원장 추적 공백의 계약상 해결안 확정 | ✅ | §7 F11 3층(`idempotency_key` 정본 — rev 8 A-6, 신규 DDL 0건) + §6 V5 `order_ref` |
| 8 | Storage·커뮤니티 미디어 계약 확정 | ✅ | §14 (ref·TTL 3종·업로드 제한·멱등·보상 삭제·앱 동등성) |
| 9 | account-deletion 비활성 유지 + 운영 계약 확정 | ✅ | §15 (변경 0건, GET/POST 경계, 대안 비교) |
| 10 | 현재 호출점 → 신규 객체 → 레거시 호환표 완료 | ✅ | §17 (30행) · §18 |
| 11 | `api_app_v1`과 제품 경계 대조 완료 | ✅ | §19 + **§19.4 앱 저장소 실측**(RPC 27/27, 테이블 24/24) |
| 12 | 삭제 없는 migration 분해안과 적용 순서 완료 | ✅ | §20 (**활성 16개 = M0·M1·M4~M17**, M2·M3 retired + 게이트 + callsite 전환 C1~C11 + 플랫폼 단계 D-API-W·D-API-A §20.6). **M17은 v1.1 canon 보정 신설**(`api_app_v1` 표면 소유 migration 누락 해소 — §19.5 #9·부록 C) |
| 13 | 구현 검수용 test matrix 완료 | ✅ | §21 (T-CON 8 · T-PERM 15 · T-CONC 10 · T-FIN 7 · T-SEC 14 · T-REG 7 · **T-REP 8 · T-TOP 6** = **75건**) + **§21.11 migration별 테스트 소유권**(M7 = T-CONC-10 canonical · M17 = 앱 Gate 4·앱 wrapper 시그니처/GRANT/envelope·`community_posts_v1`·앱 표면 응답 유실 재검증 · M9는 T-CONC-10 미소유) |
| 14 | AS-IS와 TO-BE가 명확히 분리됨 | ✅ | 절마다 `[AS-IS]`/`[TO-BE]` 표시, 문서 상단 "읽는 법" |
| 15 | 미검증 사실을 추정으로 채운 항목 0건 | ✅ | §23.2에 U-01~U-16으로 전부 명시(U-09·U-10 해소). §16.2의 TOSS env 2종은 **미검증**으로 표기(추정 아님) |
| 16 | DB·GitHub·코드·Vercel 변경 0건 | ✅ | §24.3 |

**16/16 충족.** (문서 완결 게이트 기준 — 아래 §24.2의 v1.1 판정이 S2-1 상태의 정본이다.)

### 24.2 판정 (v1.1 — rev 8 G-7)

```text
웹 계약 v1.1 작성 완료
웹 계약 보정 완료(M17 + D-API-A 신설 — api_app_v1 migration ownership 결함 해소)
앱 계약 재동기화 대기 (새 웹 정본 commit·SHA-256 기준)
S2-1: 웹 계약 보정 완료 후 앱 재동기화 대기
S2-2: BLOCKED
      SAFE_TEST_ENV_UNAVAILABLE 유지
      Data API 현재 Exposed schemas 목록 확인 대기
```

> **보정 판정 주석(v1.1 canon 보정):** 이 보정은 **구현 승인이 아니다.** `api_app_v1` 표면 소유 migration 누락이라는 계약 결함을 M17·D-API-A로 해소한 문서 보정이며, S2-2는 안전 테스트 환경 미확보(`SAFE_TEST_ENV_UNAVAILABLE`)와 Data API 현재 노출 목록 미확인으로 **BLOCKED를 유지**한다.

- 이 문서 단독으로는 **전체 S2-1 PASS를 선언하지 않는다.** `api_app_v1` 계약 v1.1이 작성되어 두 계약의 **공용 함수·시그니처·오류코드·GRANT·테스트 대조**(§19.5)가 통과한 뒤에만 S2-1 PASS / S2-2 GO 재선언 심사가 가능하다(rev 8 G-7).
- **SQL 작성·적용은 계속 금지**다 — 두 계약 문서의 대조 통과 전까지 S2-2는 임시 NO-GO를 유지한다.

승인·대조 통과 후 권고 착수 순서(실행 순서 정본은 **§20.2.1 선행조건 그래프** — 아래는 그 유효한 위상 정렬 한 가지): **M0(필수·최우선, M15만 병행 가능) → M1 → M13 → M4 → [D-API-W] → C1 → M5 → M6 → C2·C3·C4 → M7 → C5 → M17 → [D-API-A] → 앱 F4/F5/F6·Gate 4 전환 → M8 → C6 → M14 → C11 → M9 → C7·C8 → (호출 0건 확인) → M11 → M12 → (HD-1 게이트 7단계 + 앱 Gate 4 충족 후) M16 → M10(최종 읽기 전용 assertion checkpoint) → C9·C10** (M2·M3는 retired — 적용 대상 아님. D-API-W·D-API-A는 migration이 아닌 플랫폼 단계 — §20.6)

### 24.3 변경 없음 확인

```text
v1.0 세션(2026-07-29)은 읽기 전용으로 수행했으며, 이 v1.1 개정 세션 역시
문서 2건(docs/contracts/) 외에 DB DDL/DML, migration 적용, 제품 코드 수정,
SQL 파일 작성, Vercel 설정 변경, PR 생성·머지는 0건이다.
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

## 부록 A. 신규 객체 한눈표 (v1.1)

| 객체 | 종류 | 계층 | anon | auth | svc |
|---|---|---|---|:--:|:--:|:--:|
| `api_web_v1.community_posts_v1` | view | T1+T2 | S | S | S |
| `api_web_v1.community_comments_v1` | view (+M13 비정규화) | T1+T2 | S | S | S |
| `api_web_v1.mentor_directory_v1` | view (SECDEF) | T1 | S | S | S |
| `api_web_v1.my_wallet_v1` | view | T2 | — | S | S |
| `api_web_v1.my_cash_ledger_v1` | view | T2 | — | S | S |
| `api_web_v1.my_subscriptions_self()` | fn — V6 조회 RPC(SECDEF) | T2 | — | E | E |
| `api_web_v1.mentor_settlement_self()` | fn — V7 조회 RPC(SECDEF) | T2 | — | E | E |
| `api_web_v1.weekly_question_usage_self(uuid)` | fn | T2 | — | E | E |
| `api_web_v1.ensure_free_question_room(uuid)` | fn | T2 | — | E | E |
| `api_web_v1.qna_create_question_thread(uuid,text,text,text,text)` | fn | T2 | — | E | E |
| `api_web_v1.community_post_create(text,text,text,uuid,text[],text)` | fn (A-1 재배열) | T2 | — | E | E |
| `api_web_v1.community_post_update(uuid,text,text,text,timestamptz,text[],text)` | fn (A-1 재배열) | T2 | — | E | E |
| `api_web_v1.community_post_soft_delete(uuid)` | fn | T2 | — | E | E |
| `api_web_v1.mentor_profile_update_self(text,text,text,text[],text,text,text,text,boolean)` | fn | T2 | — | E | E |
| `api_web_v1.mentor_plan_prices_set_self(integer,integer,integer)` | fn | T2 | — | E | E |
| `api_web_v1.mentor_payout_account_update_self(text,text)` | fn — F13(A-4) | T2 | — | E | E |
| `api_web_v1.account_deletion_status_self()` | fn | T2 | — | E | E |
| `api_web_v1.record_cash_topup_v2(uuid,bigint,text)` | fn — F11 진입점(A-2·A-6) | T4a | — | — | E |
| `api_web_v1.subscription_checkout_confirm_v2(uuid,uuid,integer,text)` | fn — F12 진입점(A-2·A-5) | T4a | — | — | E |
| `core_private.ensure_student_mentor_room(uuid,uuid,uuid,uuid,boolean)` | fn — 내부(F10) | 내부 | — | — | — |
| `core_private.record_cash_topup_impl(uuid,bigint,text)` | fn — 내부(A-6) | 내부 | — | — | — |
| `core_private.community_post_create_impl(uuid,text,text,text,text[],text,uuid)` | fn — 내부(B) | 내부 | — | — | — |
| `core_private.community_post_update_impl(uuid,uuid,text,text,text,text[],text,timestamptz)` | fn — 내부(B) | 내부 | — | — | — |
| `core_private.community_post_soft_delete_impl(uuid,uuid)` | fn — 내부(B) | 내부 | — | — | — |
| `core_private.community_image_refs_validate(uuid,text[])` | fn — 내부(B) | 내부 | — | — | — |
| `public.comments.author_label` / `public.comments.author_role` | column ×2 (M13 — A-9) | — | (기존 정책 상속) | | |
| `public.comments_set_author_label()` + 트리거 | trigger fn (M13) | — | (PUBLIC EXECUTE 회수) | | |

**합계: view 5 · function 20 (`api_web_v1` 14 + `core_private` 6) · column 2(`comments`) · schema 2** (+ **필수** M0의 트리거·함수 1쌍, M13 트리거 함수 1, M15의 레거시 함수 가드 재정의 1)

> **정정(rev 8 A-6):** v1.0 합계의 `cash_ledger.ref_text` **column 1 → column 0**으로 정정한다(`ref_text` 폐기). 위 column 2는 rev 8 A-9의 `comments` 비정규화 신설분이다. F11은 위치·시그니처만 바뀌므로 함수 수에 계속 포함된다. F0 폐기(−2)·F13(+1)·V6/V7 RPC(+2)·내부 구현부(+5)로 함수 총계는 **20**이다.

## 부록 B. AS-IS 결함 → TO-BE 해소 대조

| 결함 | 심각도 | 해소 객체 | 회귀 테스트 |
|---|---|---|---|
| **XW-02(가)** 멘토 자기승인 (UPDATE) | **높음** | M0(필수 — A-7) + F7 + **M11 테이블 단위 전면 REVOKE(A-3)** | T-SEC-02·03, T-PERM-09·11 |
| **XW-02(나)** 프로필 행 자기생성 (INSERT) | **높음** | M0(BEFORE INSERT) + **M11 전면 REVOKE(A-3)** (+ 가입 백업 upsert 제거 + F13 선행) | T-SEC-14, T-PERM-14 |
| **XW-03** 가격 밴드 DB 미강제 | **높음** | F8 + **M12 전면 REVOKE(A-3)** | T-SEC-06·07, T-PERM-10, T-REG-02 |
| **XW-04** 구독 금액 미결속 (+재생 오탐 인접 결함) | **높음** | F12(3자 일치 + 재생 자체 판정 — A-5) | T-FIN-03, T-CONC-04·09, T-SEC-08, **T-REP-A~H** |
| **XW-01** 주간사용량 IDOR | 중간 | F1 + **M15 pair-party 가드(A-8)** (+ U-08 anon 조기 회수) | T-SEC-01 |
| XW-02b 디렉터리 미필터 | 중간 | V3 | T-SEC-04·05 |
| W3 orderId 원장 공백 | 중간 | F11 3층(`idempotency_key` 정본 — A-6) + V5 `order_ref` | T-FIN-01·02·07, **T-TOP-01~06** |
| XW-09 soft-delete 미강제 | 중간 | V1 + F6 + **M16 HD-1 전면 잠금(C)** | T-SEC-09, T-PERM-15 |
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
| XW-13 금지어 dead code | — | **동결 확정(rev 8 D — B-04): 폐지 추인, `POLICY_RESTRICTED` 예약 코드** | — |
| XW-16 webhook secret | — | (미검증 — U-01) | — |
| XW-17 PG 완료 경로 미배선 | — | (설계 선택 — 기록만) | — |
| **XW-N1** reviews UPDATE 정책 | — | **결함 아님**(트리거가 컬럼 인가 강제) — 기록만 | — |

---

## 부록 C. rev 8 반영 추적표 (v1.1 필수 — 지시서 G-2 역기입)

정본: `docs/audit/s2_api_contract_v1_1_revision_directive_20260729.md` (rev 8, 커밋 `7ec3b26`). 모든 행은 실제 반영 절 번호를 갖는다.

| rev 8 항목 | v1.1 반영 절 | 반영 상태 | 근거 |
|---|---|---|---|
| **A-1** F4/F5 시그니처 재배열 | §7 함수 표 · §7 F4·F5·F6(시그니처 블록·named notation 규약) · §10.3 · 부록 A · §19.5 #1(앱 원출처 동기화·Gate 4 소급 무효) | 반영 완료 | 필수 인자 선행·DEFAULT 후행으로 42P13 해소. identity args `(text,text,text,uuid,text[],text)` / `(uuid,text,text,text,timestamptz,text[],text)` |
| **A-2** `core_private` 도달 불가 — 진입점 재설계 | §5.2(GRANT 정본 방어선·비노출 논리 폐기) · §5.3 · §7 진입점/구현부 구분표 · §7 F10(F12 내부 호출·`room_id` 반환·트랜잭션 의미) · §7 F11·F12(스키마 `api_web_v1`) · §10.1·§10.3 · §13.1 · §17 #3(행 삭제) · §20.3(배포 전 사전 검사) | 반영 완료 | 웹 JS 진입점 전부 `api_web_v1` + service_role 전용 GRANT. `ensure_student_mentor_room_server` 대안 미채택 |
| **A-3** 컬럼 REVOKE 무효 — M11·M12 테이블 단위 교체 | §10.6(REVOKE ALL + GRANT SELECT·적용 게이트) · §20.2 M11·M12 · §20.3 · §22 #6 · §21 T-PERM-09·10 | 반영 완료 | 분리 구조 유지, 비SELECT 6종 전면 회수(TRUNCATE·REFERENCES·TRIGGER 포함) |
| **A-4** 정산계좌 전용 RPC 신설 | §7 F13 · §9.5(오류코드 2종) · §10.3 · §17 #31 · §20.2 M14 · §20.4 C11 · §23.2 U-06(해소) | 반영 완료 | authenticated 전용·`auth.uid()` 자체 도출·allowlist·8~24 숫자·원문 미반환·관리자 경로 분리·M11 게이트 ② |
| **A-5** F12 멱등 재생 — 불변 동의 금액·재생 계약 | §3.6 XW-04 부수 기록(AS-IS) · §7 F12 전체(불변 동의 금액·3자 일치·P/C·관계 결속·9단계·detail 3종·Phase 1/2·room 컬럼별 표·재생 결과·DB 계약) · §9.6 · §12.3 · §21 T-CONC-09(재작성)·§21.8 T-REP-A~H | 반영 완료 | [C4] 오측 폐기. v1.0 실행 순서 블록을 원문 위치에서 개정(요약 재구성 아님 — G-4) |
| **A-6** F11 topup 정본·3층 분리·테스트 충전 분리 | §6 V5(`order_ref`) · §7 F11(3층·6필드 NULL-safe·보안 속성) · §10.4(`ref_text` 폐기·DDL 0건) · §12.3 · §17 #13(테스트 충전 제외) · §18.2 · §20.2 M2 retired·M9 · §21.9 T-TOP-01~06 · 부록 A(column 1→0 정정) | 반영 완료 | `idempotency_key` 단독 정본, `core_private.record_cash_topup_impl` + 레거시 무음 유지 + strict F11 |
| **A-7** M0 재기술 + 필수화 | §20.2 M0(필수) · §20.5(TG_OP 선분기·`IS DISTINCT FROM`·기본값 28 대비·PUBLIC EXECUTE 회수 동일 트랜잭션) · §23.1 B-06(해소) | 반영 완료 | "정상 가입 전부 실패" 단정 미포함(확정 사실만 기재) |
| **A-8** XW-01 pair-party NULL-safe 가드 | §7 F1(가드 SQL 원문·유지 확인 4종) · §20.2 M15 · 부록 B XW-01 행 · §19.5 #5(앱 영향 없음 명기) | 반영 완료 | student-self 하드닝 기각(웹 멘토 질문방 2곳 파손 방지), `IS DISTINCT FROM`만 사용 |
| **A-9** F0 폐기 — V2·V6·V7 객체별 확정 | §6(확정표) · §6 V2(비정규화)·V6(`my_subscriptions_self` RPC·`current_plan_amount_cents` 단일 확정·금지 선언문)·V7(`mentor_settlement_self` RPC) · §7 F0(폐기·승계 규칙) · §10.3·§10.4(M13) · §11.4·§11.6 · §20.2 M3 retired·M13 · §23.2 U-11(해소) | 반영 완료 | 허용 범위(①invoker 뷰+비정규화 / ②범위 제한 SECDEF RPC) 안에서 객체별 결정 — G-5 충족 |
| **A-10** 커뮤니티 작성 멘토 전용 | §7 F4·F5·F6(작성 자격·기존 학생 글 보존) · §9.4 · §14.5 · §14.8(숏폼 `sf_insert_mentor` 1건·`sfv_mentor_insert` 1정책/2버킷·조건 4종 보존) · §19.5 #7 | 반영 완료 | 승인 판정 = `individual_question_user_is_approved_mentor` 단일 헬퍼. 관리자 일반 작성 거부 |
| **B** 공용 구현부 명세 의무 | §7 표(B-1~B-4) · §7 F4·F5·F6(공용 구현부 4종 — 함수명·시그니처·스키마·owner·보안 속성·search_path·GRANT/REVOKE) · §7 F10 · §7 F11(1층 impl) · §10.3 · §24.1 #3(게이트 재정의) | 반영 완료 | 미명세 공용 구현부 0건 — 시그니처 확정 게이트에 공용 구현부 포함 |
| **C** `HD-1` 전면 잠금·보상 삭제 RPC 폐기 | §14.4(F4 재호출 정본) · §14.7(HD-1 전체 — REVOKE ALL·정책 6종·확대 게이트 7단계·service_role moderation 예외·M8 불변·M16 별도) · §7 F4·F5·F6(922행 상당의 "§20 M8 선택 항목" 참조 삭제) · §20.2 M16 · §21 T-PERM-15 | 반영 완료 | Storage 이미지 보상 삭제는 유지, DB hard DELETE만 제거 |
| **D** blocker 재분류 | §23.1(재분류 표 — B-01·B-03·B-05·B-07 해제, B-04 동결, B-06 해소, B-02 기해소) · §14.5(B-04) · §9.4(`POLICY_RESTRICTED` 예약) | 반영 완료 | S2 blocker 0건 — M0~M16 진행 비저지 |
| **E-1** 945행 stale(`컬럼 REVOKE(§20 M9)`) | §7 F7 마지막 불릿 — `§20 M11`로 교체 | 반영 완료 | v1.0 945행 대응 위치에서 정정(마이그레이션 번호 오참조) |
| **E-2** 1315행 stale(`S2 후반 M9`) | §10.6 절 제목 — `M11·M12`로 교체 | 반영 완료 | v1.0 1315행 대응 위치에서 정정 |
| **E-3** 1754행 stale(`§20 M10`) | §18.4 `payments` 행 — `§20.4 C10`으로 교체 | 반영 완료 | 프로빙 제거는 마이그레이션이 아닌 웹 callsite 코드 작업 |
| **F-1** F4/F5 재배열 동기화 | §19.5 #1 | 반영 완료 | 앱 계약 §3.3 원출처 — Gate 4 소급 무효 명시 |
| **F-2** `SUBSCRIPTION_REFUND_PENDING` 정합화 | §19.5 #2 · §9.3 | 반영 완료 | 앱 계약 §4.3 누락 코드 추가 요구 고정 |
| **F-3** envelope 가정 재기술 | §19.5 #3 · §8.1 | 반영 완료 | 웹 계약 §8과 동일 구조 |
| **F-4** Gate 4 재게이트 | §19.5 #4 | 반영 완료 | A-1 소급 무효 반영 |
| **F-5** pair-party 가드 앱 영향 없음 | §19.5 #5 · §7 F1 | 반영 완료 | 앱 호출(자기 학생 ID)은 통과 |
| **F-6** 공용 커뮤니티 내부 함수 대조표 | §19.5 #6(대조 기준 확정 — 이름·시그니처·오류코드·GRANT) | 반영 완료 | 웹 계약이 정본, 앱 계약 v1.1에 대조표 추가 의무 |
| **F-7** `ROLE_NOT_ALLOWED` 재정의 | §19.5 #7 · §9.4 | 반영 완료 | 멘토 전용(`ROLE_NOT_MENTOR`·`MENTOR_NOT_APPROVED`) 기준 |
| **G-3** stale 참조 3건 교체 게이트 | 위 E-1~E-3 행 · §7 F7·§10.6·§18.4 | 반영 완료 | 확정 정정값으로 교체 완료 |
| **G-4** 자금 함수 3종 원문 기준 재기술 | §7 F11(v1.0 동작 분기 순서 기준 3층 개정) · §7 F12(v1.0 실행 순서 7단계를 원위치에서 개정) · §12.3 갱신 행(renewal은 **변경 없음** — `process_subscription_renewal` 행 유지) | 반영 완료 | 요약 전재 아님 — v1.0 본문 분기 순서 기준 개정([C4] 오측 재발 방지) |
| **G-5** V2·V6·V7 객체별 결정 의무 | §6 확정표 · A-9 행 참조 | 반영 완료 | 객체별 확정 없이는 게이트 통과 불가 조건 충족 |
| **G-6** 회귀 테스트 의무 | §21.8 T-REP-A~H(8건 — stale room 복구·NULL 복구·제3 결제 거부·detail 3종·C 당사자·검증 실패 시 보정 미실행) · §21.9 T-TOP-01~06(6건) · §21.3 T-CONC-09 재작성 · fixture 명시(§21.8 인용문) · §7 F12(검증 선행·쓰기 후행 2단계 + 9단계 원문 이관) | 반영 완료 | rev 8 조건 — F12 절이 A-5의 2단계 구조·9단계 우선순위를 그대로 옮김 |
| **G-7** 게이트·판정 | §24.2(웹 v1.1 작성 완료 · 앱 교차대조 대기 · S2-1 REVISE 유지 · S2-2 임시 NO-GO 유지) | 반영 완료 | 단독 S2-1 PASS 선언 없음 — 두 계약 대조 통과 후 심사 |
| **V2** (A-9 객체별) | §6 V2 — `security_invoker` 뷰 + `comments.author_label`·`author_role` 비정규화(M13) | 반영 완료 | `community_posts` 실측 선례와 동일 패턴, U-11 해소 |
| **V6** (A-9 객체별 + 필드 단일 확정) | §6 V6 — 범위 제한 SECDEF RPC `api_web_v1.my_subscriptions_self()`, 금액 필드 `current_plan_amount_cents` 단일 확정(+금지 선언문 1회) | 반영 완료 | 당사자 판정식 = `subscriptions_select_parties` 동일 |
| **V7** (A-9 객체별) | §6 V7 — 범위 제한 SECDEF RPC `api_web_v1.mentor_settlement_self()` | 반영 완료 | 판정식 = `ssi_select_mentor_own` 동일, 내부 참조 3종 미노출 |

### 부록 C-1. v1.1 canon 보정 추적표 (M17 — 오너 지시 2026-07-30 역기입)

| 항목 | 내용 |
|---|---|
| **결함** | `api_app_v1` migration ownership 누락 — 앱 계약 §3.1(스키마)·§3.2(`community_posts_v1` 뷰)·§3.3(wrapper 5종)·§10(Gate 4)이 요구하는 DB 표면을 **생성하는 소유 migration이 M0~M16에 없었다.** §20.2 M1은 `api_web_v1`·`core_private` 두 스키마만 생성하며, 다른 어떤 M도 `api_app_v1`을 만들지 않았다. 또한 Exposed schemas 추가가 migration과 구분되지 않아 앱 표면의 도달 가능 시점이 계약에 없었다 |
| **해소** | **M17 신설**(`..._api_app_v1_surface.sql` — 스키마·REVOKE/GRANT·뷰·wrapper 5종·최소 GRANT·default privilege 방어, 시그니처는 앱 §3.3·§10과 완전 동일, `core_private` 구현부는 M7·M5 객체 공유·복제 금지) + **rollback `..._api_app_v1_surface_rollback.sql`** + **D-API-W·D-API-A 플랫폼 단계 분리**(§20.6) |
| **선행조건** | `M17 : M5 + M7 + M13` (M1은 M5·M7의 선행이라 간접 충족). `M16 : M7 + M17 + 앱 전환·Gate 4`, `M10 : 기존 + M17` |
| **반영 절** | §5.4(D-API-W·D-API-A 연결) · §19.5 #9(앱 동기화 의무 신규 항목) · §20.2 M17 행·논리 ID 서문 · §20.2.1 그래프 간선·M16·M10·권고 직렬화 · §20.3 게이트(M17 이전·D-API-A 이전·M16 이전·전 단계 공통) · **§20.6 신설**(Data API 플랫폼 단계) · §21.3 T-CONC-10(M7 canonical 표시) · **§21.11 신설**(migration별 테스트 소유권) · §21.10(운영 M10 범위에 M17) · §22 #2(역순에 M17·rollback 6단계 필수 선행·DROP 선행 금지) · §24.1 #12·#13 · §24.2 판정 |
| **개수 정합** | 활성 forward migration **16개**(M0·M1·M4~M17) · retired **M2·M3** · rollback 없는 상태 0 checkpoint **M10** · **forward+rollback 쌍 15개** |
| **테스트 소유권** | M7 = 공용 B-1~B-4·웹 F4/F5/F6·**T-CONC-10 canonical** / M17 = 앱 Gate 4·앱 wrapper 시그니처·GRANT·envelope·`community_posts_v1`·앱 표면 응답 유실 재검증 / **M9는 T-CONC-10 미소유**(T-CONC-02·03·04·08·09·T-FIN·T-REP A~H·T-TOP 1~6) |
| **판정** | 구현 승인 아님 — S2-1은 앱 재동기화 대기, S2-2는 `BLOCKED`(`SAFE_TEST_ENV_UNAVAILABLE` 유지 · Data API 현재 목록 확인 대기) |
