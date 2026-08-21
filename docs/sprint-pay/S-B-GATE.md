# S-B-GATE.md — Phase 0 착수 게이트 실측 결과 (압축 R2)

> 2026-08-20 · 세션: sprint-pay S-B (DB 마이그레이션) · 작업 브랜치 `claude/sprint-pay-s-b-yrewf3`
> 대상 DB: Supabase `lbeqxarxothkmzqvpudy` (이름 "ssambership-staging" — **실제 라이브 프로덕션**)
> 원칙: IMPACT.md(R1) 판정을 신뢰하지 않고 전 항목 실측 재현. DB는 SELECT 계열만 실행.
>
> **판정: 전 항목 PASS (A1은 앱 레포 미제공으로 재현 생략 — IMPACT A1 판정 인용으로 대체). §3 진입 가.**

## [환경] 마이그레이션 원장 정합 — PASS

- 리모트 최신: `supabase_migrations.schema_migrations` SELECT 실측 — 최신 version `20260808092007`
  (`account_deletion_server_cancel_window_30d`). 지시서 전제와 일치.
- 집합 대조: 리모트 전 version 85본(`20260701000000`~`20260808092007`) vs 로컬
  `supabase/migrations/*.sql` 85본 — `comm` 집합 diff 결과 **remote_only 0 · local_only 0** (완전 일치).
- 함의: `db-apply-pending`의 remote_only 가드 발동 조건 없음. 깨끗한 원장 위에서 시작한다 (IMPACT C1 재확인).

## [W1] 삭제 사가 — "user FK 테이블 순회 레지스트리" 부재, strict 관문은 버킷 커버리지 — PASS

재독 + DB 실측으로 재현:

- `lib/account/accountDeletionWorker.ts:242-345` `runAccountDeletionJob` — real-run 스텝은
  ① 계획 산출(Storage refs, `planAccountDeletion`) ② `beginLocked`(pending→locked) ③ `revokeSessions`
  ④ `removeObjects`(Storage 삭제) + 빈 상태 재검증 ⑤ `forfeitWalletAndAnonymize`(지갑 몰수+익명화)
  ⑥ `authSoftDelete` ⑦ advance 전이. **"user_id FK 테이블을 순회 삭제"하는 루프·테이블 레지스트리는 없다.**
- strict 관문 실체: `lib/account/accountDeletionWorker.ts:145-166` `planBlockReason` —
  `uncovered_buckets` / `ownership_conflict` / `unattributable` 3종(전부 **Storage 축**)만 차단 사유.
  `lib/account/accountDeletionPurgePlan.ts:7-8` "수집 경로가 없는 버킷이 하나라도 남으면 real-run 자체를 금지".
  `lib/account/accountDeletionBucketCoverage.ts:31-45` `ACCOUNT_DELETION_ALL_BUCKETS` 13종 정적 목록,
  `:161-180` `computeUncoveredBuckets` 계산.
- DB 실측 `pg_get_functiondef(public.account_deletion_advance)` (전문 1,166자 SELECT):
  허용 전이는 정확히 5쌍 — `locked→purging`, `purging→storage_purged`, `storage_purged→finalized`,
  `finalized→auth_soft_deleted`, `auth_soft_deleted→completed`. 그 외 `INVALID_TRANSITION` 예외,
  `pending→locked`은 `USE_BEGIN_LOCKED` 예외로 176 전용. 함수는 `account_deletion_jobs` 1테이블만 UPDATE.
- users 행은 삭제가 아니라 익명화: `pg_get_functiondef(public.anonymize_user_for_deletion)` 실측 —
  `delete from public.users` **부재(false)**, `update public.users set full_name='탈퇴회원', …` **실재(true)**.
  → 신규 테이블 4종이 `users(id)`를 FK로 참조해도(on delete 무엇이든) 삭제 충돌 자체가 발생하지 않는다.
- **결론: 신규 테이블 4종 추가는 Storage 버킷을 만들지 않으므로(§ 절대 규칙: 버킷 신설 금지)
  기존 탈퇴 real-run을 깨지 않는다.** 단 신규 테이블 행은 현행 사가 어느 스텝도 파기하지 않으므로
  m7 파기 RPC + 워커 스텝 추가가 타당하다 (IMPACT W1 부수 판정과 일치).

## [A1] 앱 users 조회 strict성 — 재현 생략 (앱 레포 미제공)

- `/home/user/` 확인 — `ssambership-app` 체크아웃 부재. 지시서 §0-3에 따라 A1 재현은 생략하고
  **IMPACT A1 판정 인용으로 대체**: users 조회 전수 3곳 명시 select · fromMap은 unknown key 무시 구조 ·
  발동 조건 없음(컬럼 추가 한정). 이번 S-B는 컬럼 추가/신규 테이블만이므로(삭제·개명 0) A1 전제 하 안전.

## [B1·B2] 구독 확정·갱신 경로 — 지갑 차감 내장·멱등키·PAYMENT_STALE·3자 일치 — PASS

`subscription_checkout_confirm_v2` 경로(웹):

- `lib/subscribe/subscribeCheckoutService.ts:478-618` `finalizeSubscriptionCheckout` —
  service_role로 `api_web_v1.subscription_checkout_confirm_v2` 단일 호출(`:545-551`),
  멱등키 `sub_checkout_<paymentId>`(`:550`), `PAYMENT_STALE` 사용자 문구 매핑(`:640-641`).
  캐시 지갑 즉시 차감 진입점은 `finalizeSubscriptionCashWalletCheckout`(`:439-458`, `cashWallet: true`).

DB 실측 (`pg_get_functiondef` SELECT):

- `api_web_v1.subscription_checkout_confirm_v2(p_payment_id, p_plan_id, p_expected_amount_cents, p_idempotency_key)`
  (16,621자) — 헤더 주석에 "정본 confirm_subscription_checkout raise 17종(§9.8 — 동명 envelope 변환)".
  **3자 일치 실측**: "3자 일치: payments.amount×100 = p_expected_amount_cents = 잠근 amount_cents" →
  불일치 시 `PLAN_AMOUNT_CHANGED` envelope 반환.
- `public.confirm_subscription_checkout` (8,468자) — **`PAYMENT_STALE` = pending 30분**:
  `if v_created_at is null or now() > v_created_at + interval '30 minutes' then raise exception 'PAYMENT_STALE'`.
  **지갑 차감 내장**: `perform public.record_subscription_cash_debit(v_student, v_sub_id, p_payment_id, v_amount_cents::bigint)`
  후 `update public.payments set status='succeeded', …`. → PG 결제에 이 경로를 재사용하면 이중 차감(IMPACT B1 재확인).
- `public.process_subscription_renewal(p_subscription_id, p_period_end, p_amount_cents, p_idempotency_key, p_processed_at)`
  (7,293자) — 갱신 가능 status ∈ `('active','past_due')`, `subscription_billing_events` 멱등키 기반,
  지갑 차감은 `update public.cash_wallets set balance_cents = balance_cents - p_amount_cents … and balance_cents >= …`.
  **`funding` 문자열 히트 0** — 현행 갱신 RPC는 결제수단을 구분하지 않는다(전 구독 = 캐시 차감).
- 갱신 크론(웹): `vercel.json` crons 3종 실측 — `/api/cron/subscription-renewal` 매일 18:10 UTC.
  `app/api/cron/subscription-renewal/route.ts` — CRON_SECRET(timing-safe) + `SUBSCRIPTION_RENEWAL_ENABLED`
  fail-closed, `runSubscriptionRenewalBatch` 호출.

**funding_source 분기 지점 후보 (m6 컬럼의 후속 소비처 — S-C~E에서 구현, 이번 회차 스키마만):**

1. `lib/subscribe/subscriptionRenewalBatch.ts:379-380·404-405` — 갱신 대상 구독 SELECT 2곳.
   캐시 크론은 `funding_source in ('cash') or funding_source is null`만 집도록 필터 추가(빌링키 크론은 `'pg'` 전용).
   past_due 복구 경로 `:479-482`(충전 직후 복구 — 캐시 전용 유지)도 동일 필터 대상.
2. DB `process_subscription_renewal` — status 가드(`not in ('active','past_due')` 분기) 직후가
   funding_source 가드 삽입 지점(`'pg'` 구독이면 `not_renewable_funding` 계열 거부 — 이중 청구 구조 차단).
3. `lib/subscribe/subscribeCheckoutService.ts:545-551` — 확정 RPC 호출 지점. PG 경로는 지갑 차감이 내장된
   v2 재사용 금지 → 별도 확정 경로(또는 원장 처리 분기 파라미터) 신설이 S-D 과제(IMPACT B1).
4. `subscriptions.funding_source` NULL 해석은 `'cash'`(방어적 — m6 헤더 주석 명문화).

## [B5] contracts 파이프라인·부분-컬럼 INSERT — PASS

- `package.json` scripts 실측: `contracts:export` = `node scripts/contracts/export_remote_contract.mjs`,
  `contracts:verify` = `node scripts/contracts/verify_remote_contract.mjs`,
  `test:contract` = `node --test --experimental-strip-types "lib/**/__contract__/*.contract.test.ts"`.
- `scripts/contracts/verify_remote_contract.mjs:150-154` — diff 경로 1개 이상이면
  `VERDICT: SEMANTIC_DRIFT` + hard fail. `scripts/contracts/contract_snapshot_query.sql:117-120` —
  스냅샷 `migrations` 배열 = `schema_migrations` 전 행(version+name). → **적용 +7본 시 재수출 없으면
  `$.migrations` 길이 불일치로 hard fail** (IMPACT B5 후단 재확인. 적용 회차에 `contracts:export` 필수).
- 부분-컬럼 INSERT 실측: `lib/subscribe/subscribeCheckoutService.ts:324-344` —
  `.from("payments").insert({user_id, mentor_id, status, amount, currency, kind, plan_id, external_id, metadata})`
  9컬럼 부분 INSERT. e2e의 payments INSERT 3지점: `e2e/connection-note-guard.spec.ts:58`,
  `e2e/subscription-renewal-sim.spec.ts:88`, `e2e/local-scenarios.spec.ts:281` (전부 admin 부분-컬럼 INSERT).
  → **기존 테이블 신규 컬럼은 전부 nullable·무DEFAULT** (§2 확정치)이면 전 지점 안전.
- payments 현행 컬럼 16종 DB 실측: `id,user_id,student_id,payer_id,mentor_id,amount,currency,status,kind,idempotency_key,external_id,metadata,data,created_at,updated_at,plan_id` — IMPACT C2의 "현행 16컬럼" 일치.

## [C2 잔여] DDL 이름 충돌 전수 대조 — PASS (충돌 0)

이번 DDL이 만들 이름 25종을 `pg_class`(전 relkind — 인덱스 relkind='i' 포함)·`pg_constraint`·
`pg_trigger`(tgisinternal 제외)·`pg_proc`·`pg_type`·`pg_policies` 6개 카탈로그에 UNION 대조 — **히트 0행**:

- 테이블 4: `nice_auth_tokens` `identity_verifications` `billing_keys` `portone_webhook_events`
- 인덱스/유니크 10: `nice_auth_tokens_pkey` `identity_verifications_pkey`
  `identity_verifications_request_no_key` `identity_verifications_di_hash_verified_uniq`
  `identity_verifications_user_id_idx` `billing_keys_pkey` `billing_keys_user_id_active_uniq`
  `billing_keys_user_id_idx` `portone_webhook_events_pkey` `portone_webhook_events_webhook_id_key`
- 제약 8: `identity_verifications_user_id_fkey` `identity_verifications_token_id_fkey`
  `identity_verifications_status_check` `billing_keys_user_id_fkey` `billing_keys_status_check`
  `payments_billing_key_id_fkey` `subscriptions_funding_source_check` (+ pkey 제약은 인덱스명과 동일)
- 트리거 3: `adg_identity_verifications` `adg_billing_keys` `trg_iv_set_updated`
- 함수 1: `account_deletion_purge_identity_payment_artifacts` (별도 pg_proc 전수 대조에서도 부재 확인)

추가 실측:

- `pg_extension` — **pg_cron 설치 확인(1)**. `cron.job` 등록 잡은 `subscription_settlement_refresh_hourly`
  1건뿐 → 신규 잡 이름 `nice_auth_token_sweep_daily` 충돌 없음. 기존 등록 패턴
  (`supabase/baseline/post_ledger_backfills/20260806202000_subscription_settlement_hourly_schedule.sql` —
  pg_extension 확인 후 없으면 skip, unschedule 후 schedule)을 그대로 따른다.
- 컬럼 부재 확인: `subscriptions.funding_source` 0 · `users.identity_verified_at` 0 ·
  `refunds.pg_cancellation_id`/`pg_cancelled_at` 부재(refunds 현행 15컬럼 SELECT) · payments pg_* 8종 전부 부재.
- adg 트리거 부착 정본 패턴: `supabase/sql/151_p1_10_account_deletion_saga.sql:66-83` —
  `create trigger adg_<table> before insert on public.<table> for each row execute function
  public.account_deletion_write_guard('<유저 컬럼명>')`. 현행 부착 6종(cash_wallets(+update)·cash_ledger·
  payments·question_messages·community_posts·shortform_posts) 확인.
- service_role 전용 테이블 선례: 같은 파일 `:16-36` `account_deletion_jobs` —
  `enable row level security` + `revoke all … from public, anon, authenticated` +
  service_role GRANT + **정책 0**. RPC EXECUTE 선례: `account_deletion_forfeit_and_anonymize`
  proacl 실측 — service_role EXECUTE 1 · anon/authenticated EXECUTE **0**.
- `subscriptions` 현행 행수 2 (m6 백필 UPDATE 대상 2행 — 라이브 영향 최소).
- updated_at 유지 정본: `public.set_updated_at()` (`supabase/sql/001_initial_auth_profile.sql:9`) —
  `trg_<약어>_set_updated` 네이밍 관례.

## 게이트 종합

| 항목 | 판정 | 비고 |
|------|------|------|
| 환경 (원장 정합) | PASS | 85=85, remote_only/local_only 0, 최신 20260808092007 |
| W1 (삭제 사가) | PASS | 버킷 커버리지 관문 재현, users 익명화(비삭제), 테이블 4종 추가 무영향 |
| A1 (앱 파싱) | 생략 | 앱 레포 미제공 — IMPACT A1 판정 인용으로 대체 |
| B1·B2 (확정·갱신 RPC) | PASS | 지갑 차감 내장·30분 STALE·3자 일치·멱등키 재현, funding 분기 후보 4곳 기록 |
| B5 (contracts·부분 INSERT) | PASS | SEMANTIC_DRIFT 경로·INSERT 4지점 실측, nullable 확정치 유지 |
| C2 잔여 (이름 충돌) | PASS | 25종 × 6카탈로그 히트 0, pg_cron 설치·잡명 충돌 0 |

**→ §3 마이그레이션 작성 진입. DB 적용(DDL)은 §5 승인 게이트 전 금지 유지.**
