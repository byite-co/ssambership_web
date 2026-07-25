# 삭제(탈퇴) 전용 계정 시나리오 — DELETE-03 실증

> **이 문서는 준비 산출물이며, 실행·적용은 후속 웨이브에서 승인 후 직렬 수행한다.**
> 트랙 4 세션에서 staging 에 실행한 비-SELECT 문은 0건 · 생성한 계정은 0건이다.
> 대상: ssambership-staging `lbeqxarxothkmzqvpudy` — **production 금지**.
> 계정 별칭: `qa-delete-01` (`qa-accounts-plan.md` §0 규약).

---

## 1. 목적과 전제

**목적**: 회원 탈퇴 saga 의 상태 전이
`pending → locked → purging → storage_purged → finalized → auth_soft_deleted → completed`
를 실데이터로 **순차 대조**하고, 원장·UGC 가 보존되는지(물리 삭제 0) 실증한다.

> ⛔ **선행 조건 — 이 시나리오는 탈퇴 worker 가 운영화된 뒤에만 실행할 수 있다.**
> 상세와 근거는 §5. worker 미운영 상태에서는 `pending` 이후로 전이하지 않으므로
> 대조표(`device-qa-db-crosscheck.md` §3-G)는 **BLOCKED** 로 판정한다.

**이 계정은 1회용이다.** 익명화(`anonymize_user_for_deletion`)는 되돌릴 수 없고
`auth` soft-delete 후 로그인이 영구 차단되므로, 다른 시나리오와 절대 공유하지 않는다.

---

## 2. 전용 계정 요건

| # | 요건 | 확인 방법 | 비고 |
|---|---|---|---|
| R-1 | `users.role='student'` · `status='active'` | §6-1 | 신규 가입으로 생성 |
| R-2 | **정상 가입 플로우로 생성** (직접 SQL 시드 금지) | 가입 절차 §3 | 과거 GoTrue 컬럼 NULL 부채 재발 방지(현행 staging 은 NULL 0건) |
| R-3 | active/past_due 구독 **0** | §6-2 | 사전조건 |
| R-4 | escrow 진행중 IQ (`open`/`assigned`/`claimed`/`answered`) **0** | §6-2 | 사전조건 |
| R-5 | 진행중 맞춤의뢰 주문(터미널 외) **0** | §6-2 | 사전조건 |
| R-6 | `open`/`under_review` 분쟁 **0** | §6-2 | 사전조건 |
| R-7 | 지갑 잔액 0 **또는** '잔액 소멸 동의' 체크 | §6-2 | 소멸 시 상계 라인 1건 생성 |
| R-8 | 커뮤니티 게시글 ≥1 · 댓글 ≥1 (탈퇴 **전에** 작성) | §6-3 | 작성자 표기 '탈퇴회원' 전환 대조용 |
| R-9 | `account_deletion_jobs` 행 **없음** | §6-4 | 이미 job 이 있으면 전이 실증 불가 |
| R-10 | `NEXT_PUBLIC_FEATURE_ACCOUNT_DELETION=true` 로 배포된 환경 | 진입점 노출 여부 | 오너 수작업 W-7 |

**staging 실태 대비 판정 (2026-07-25 실측)**

- `account_deletion_jobs` 총 1행, `state='canceled'` — 기존 계정 `32c8c8eb-…fa65` 에 붙어 있다.
  `canceled` 는 `account_deletion_advance` 의 허용 전이 출발점이 아니므로 **재사용 불가**.
- `user_deletion_log` 0행 → **완주 사례 0건**.
- → **전용 계정 부족분 = 1건(신규 생성 필요).**

---

## 3. 계정 생성 절차 (오너/운영자 수작업 단계 명시)

| 단계 | 주체 | 내용 |
|---|---|---|
| S-1 | QA | 웹 `/signup` 에서 학생 신규 가입(이메일·비밀번호·학년·약관 동의). **직접 SQL 시드 금지** |
| S-2 | QA | 이메일 인증 → 최초 로그인 → `public.users` 행 트리거 동기화 확인(§6-1) |
| S-3 | QA | `/community` 에서 게시글 1건 + 댓글 1건 작성 (R-8) |
| S-4 | QA | 캐시 충전·구독·IQ 를 **하지 않는다** (사전조건 R-3~R-7 을 처음부터 만족시키는 것이 가장 빠르다) |
| S-5 | **오너** | `NEXT_PUBLIC_FEATURE_ACCOUNT_DELETION=true` 로 QA 환경 배포 (W-7) |
| S-6 | **오너** | 탈퇴 worker 러너 운영화 — §5 (W-8) |
| S-7 | QA | `/mypage` 하단 '회원 탈퇴' 진입점 노출 확인 → `/account/delete` 진입 |

> S-5·S-6 은 **오너/운영자 수작업**이다. QA 세션이 자체적으로 처리할 수 없다.

---

## 4. 상태 세팅 fixture 초안 (⚠️ 실행 금지)

```sql
-- =====================================================================
-- ⚠️ 실행 금지 — 준비 산출물(초안)입니다.
-- 실행·적용은 후속 웨이브에서 오너 승인 후 직렬 수행합니다.
-- 트랙 4 세션에서는 단 한 줄도 실행하지 않았습니다.
-- 대상: ssambership-staging (lbeqxarxothkmzqvpudy) 전용 · production 금지
-- 실행 권한: service_role
-- 치환: :qa_delete_01 = 실제 users.id (UUID)
-- =====================================================================
```

**대상 테이블**: `public.account_deletion_jobs` (읽기 위주 · 정리 목적 DELETE 1건만)
**전제 조건**: `qa-delete-01` 이 §2 의 R-1~R-8 을 이미 충족 · worker 미기동 상태

```sql
BEGIN;

-- [전제 확인 1] 대상이 학생·활성인가 (0행이면 즉시 ROLLBACK)
SELECT id, role, status FROM public.users
 WHERE id = :'qa_delete_01' AND role = 'student' AND status = 'active';

-- [전제 확인 2] 탈퇴 사전조건 — 아래 5값이 전부 0이어야 한다
SELECT (SELECT count(*) FROM public.subscriptions
         WHERE student_id = :'qa_delete_01' AND status IN ('active','past_due'))      AS open_subs,
       (SELECT count(*) FROM public.individual_questions
         WHERE student_id = :'qa_delete_01'
           AND status IN ('open','assigned','claimed','answered'))                    AS open_iq,
       (SELECT count(*) FROM public.custom_request_orders
         WHERE status NOT IN ('completed','canceled','refunded'))                     AS open_orders,
       (SELECT count(*) FROM public.disputes
         WHERE status IN ('open','under_review'))                                     AS open_disputes,
       (SELECT coalesce(max(balance_cents), 0) FROM public.cash_wallets
         WHERE user_id = :'qa_delete_01')                                             AS wallet_cents;

-- [전제 확인 3] 대조용 UGC 가 있는가 (R-8)
SELECT (SELECT count(*) FROM public.community_posts    WHERE author_id = :'qa_delete_01') AS posts,
       (SELECT count(*) FROM public.community_comments WHERE author_id = :'qa_delete_01') AS comments;

-- (1) 잔여 job 정리 — 이전 리허설의 canceled/failed job 이 있으면 전이 실증이 막힌다.
--     ⚠️ 대상 계정 1건으로 한정한다. WHERE 절을 절대 넓히지 말 것.
--     ⚠️ 이 DELETE 는 '전용 폐기 계정'에만 허용된다. 다른 계정에 쓰면 감사 이력이 소실된다.
DELETE FROM public.account_deletion_jobs
 WHERE user_id = :'qa_delete_01'
   AND state IN ('canceled','failed');

-- (2) 탈퇴 요청 자체는 fixture 로 만들지 않는다.
--     반드시 앱/웹 UI(/account/delete)에서 비밀번호 재인증을 거쳐
--     account_deletion_request_self() 가 호출되게 한다 — 그것이 검증 대상이다.

-- 여기서 §7 검증 SELECT 를 확인한 뒤 COMMIT.
COMMIT;   -- 불일치 시 ROLLBACK;
```

**rollback 문**

```sql
-- 롤백 A: 트랜잭션 미확정
ROLLBACK;

-- 롤백 B: 이미 COMMIT 된 경우
--   (1) 의 DELETE 는 삭제된 행을 자동 복원할 수 없다.
--   → 반드시 실행 **전에** 아래 스냅샷을 떠서 보관한다:
SELECT * FROM public.account_deletion_jobs WHERE user_id = :'qa_delete_01';
--   복원이 필요하면 보관한 값으로 명시 INSERT 한다(컬럼 전체 지정):
INSERT INTO public.account_deletion_jobs
  (id, user_id, state, attempts, last_error, next_attempt_at, cancelable_until, dry_run,
   requested_at, locked_at, purging_at, storage_purged_at, finalized_at,
   auth_soft_deleted_at, completed_at, canceled_at, failed_at, updated_at,
   lease_owner, leased_until)
VALUES (:'prev_id', :'qa_delete_01', :'prev_state', :prev_attempts, :'prev_last_error',
        :'prev_next_attempt_at', :'prev_cancelable_until', :prev_dry_run,
        :'prev_requested_at', :'prev_locked_at', :'prev_purging_at', :'prev_storage_purged_at',
        :'prev_finalized_at', :'prev_auth_soft_deleted_at', :'prev_completed_at',
        :'prev_canceled_at', :'prev_failed_at', now(), :'prev_lease_owner', :'prev_leased_until');

-- ⚠️ 익명화(anonymize_user_for_deletion)와 auth soft-delete 는 되돌릴 수 없다.
--    그래서 이 시나리오는 전용 폐기 계정으로만 수행한다. 완주 후 rollback 은 존재하지 않는다.
```

**실행 후 검증 SELECT**

```sql
SELECT (SELECT count(*) FROM public.account_deletion_jobs
         WHERE user_id = :'qa_delete_01')                       AS job_rows,   -- 기대 0 (요청 직전 상태)
       (SELECT count(*) FROM public.users
         WHERE id = :'qa_delete_01' AND status = 'active')      AS user_active,-- 기대 1
       (SELECT count(*) FROM public.community_posts
         WHERE author_id = :'qa_delete_01')                     AS posts;      -- 기대 >=1
```

---

## 5. worker 운영화 — 실행 가능 조건 (⛔ 현재 미충족)

**DB 측은 준비 완료.** staging 에 아래 함수가 전부 존재한다(2026-07-25 실측, §6-5):

| 함수 | 역할 |
|---|---|
| `account_deletion_request_self(int, bool)` | 사용자 요청(auth.uid() 기반) → `pending` |
| `account_deletion_cancel_self()` | 취소 창 내 취소 → `canceled` |
| `account_deletion_status_self()` | 상태 조회(worker 내부 정보 미노출) |
| `account_deletion_claim(text, int, int)` | worker 리스 claim |
| `account_deletion_reclaim_expired()` | 만료 리스 회수 |
| `account_deletion_advance(uuid, text, text)` | **from→to 엄격 검증 전이** |
| `account_deletion_record_error(uuid, text, int, int)` | 실패 백오프·`failed` 전이 |
| `account_deletion_forfeit_and_anonymize(uuid)` | 잔액 소멸 + PII 익명화 |
| `anonymize_user_for_deletion(uuid, text)` | PII 익명화 |
| `account_deletion_write_blocked(uuid)` / `_write_guard()` | 탈퇴 진행 중 write 차단 |

**미충족 항목**: 이 함수들을 **주기적으로 호출하는 러너(worker 프로세스)가 저장소에 없다.**
`grep -rln "account_deletion_claim\|deletionWorker" lib/ app/ scripts/` → **0건**
(참조는 `supabase/sql/151·154·161` 정의부와 `lib/account/effectiveAccountStatus.ts` 읽기뿐).

즉 현재 상태에서 UI 로 탈퇴를 요청하면 `state='pending'` 에서 **멈춘다.**
`locked` 이후 전이는 다음 중 하나가 갖춰져야 관측할 수 있다:

| 옵션 | 내용 | 필요 작업 |
|---|---|---|
| O-1 | Supabase Edge Function + cron 으로 러너 배포 | 러너 구현 + 배포(스코프 밖) |
| O-2 | 웹 API route + 외부 스케줄러 호출 | 러너 구현 + 배포(스코프 밖) |
| O-3 | 운영자가 service_role 로 `account_deletion_claim` → `account_deletion_advance` 수동 호출 | **오너 수작업 · 승인 필요** |

> 트랙 4 는 어느 옵션도 실행하지 않는다. O-3(수동 전이)은 후속 웨이브에서 오너가
> 승인·집행하며, 그때 `device-qa-db-crosscheck.md` §3-G 의 G-1 을 단계마다 반복 실행한다.

**앱 표면 영향**: 탈퇴 진행 중 계정은 `assertAppSurfaceAccountActiveStrict` 가
fail-closed 로 차단한다(`/api/app-session/bootstrap` → `code=account_blocked`).
`pending` 단계에서 앱 접근을 시도해 이 게이트가 도는지도 함께 본다.

---

## 6. 순차 대조 절차 (worker 운영화 이후에만 실행)

각 단계마다 `device-qa-db-crosscheck.md` §3-G 의 **G-1** 을 실행하고 결과를 §8 표에 기록한다.

### 단계 D0 — 탈퇴 요청 직전 (baseline)

```sql
-- 6-1. 계정 상태
SELECT id, role, status FROM public.users WHERE id = :'qa_delete_01';

-- 6-4. job 없음 확인
SELECT count(*) AS job_rows FROM public.account_deletion_jobs WHERE user_id = :'qa_delete_01';  -- 기대 0

-- 6-6. 원장 baseline (L0 로 기록 — 완주 후 이 값이 그대로여야 한다)
SELECT (SELECT count(*) FROM public.cash_ledger)   AS ledger_rows,
       (SELECT count(*) FROM public.payments)      AS payment_rows,
       (SELECT count(*) FROM public.subscriptions) AS sub_rows,
       (SELECT count(*) FROM public.user_deletion_log) AS deletion_log_rows;  -- 기대 0
```

### 단계 D1 — `/account/delete` 요청 직후 → **pending**

| 기대 | 확인 |
|---|---|
| `state='pending'` | G-1 |
| `cancelable_until` 설정됨(기본 30분) | G-1 `has_cancel_window=true` |
| `locked_at` 등 이후 타임스탬프 전부 NULL | G-1 |
| `account_deletion_status_self()` 가 `can_cancel=true` 반환 | 앱/웹 화면 |
| 앱 WebView 부트스트랩 시 `code=account_blocked` | 브릿지 오류 페이지 |

**분기 검증**: 취소 창 안에서 `/account/delete` 취소를 눌러 `state='canceled'` 로 가는지
한 번 확인한 뒤, **다시 요청**해 `pending` 으로 되돌린다(취소 경로 회귀 확인).

### 단계 D2 — 취소 창 경과 + worker claim → **locked**

| 기대 | 확인 |
|---|---|
| `state='locked'` · `locked_at` 채워짐 | G-1 |
| `cancelable_until <= now()` | G-1 |
| 이제 `account_deletion_cancel_self()` 가 `NOT_CANCELABLE` 반환 | 앱/웹 |
| `account_deletion_write_blocked()` = true → 도메인 write 차단 | 글 작성 시도 시 거부 |

> `account_deletion_advance('pending','locked')` 는 `cancelable_until` 경과를 WHERE 로
> 강제한다(151 SQL). 창 경과 전 호출은 **0행 갱신**이 정상이다.

### 단계 D3 — **purging**

| 기대 | 확인 |
|---|---|
| `state='purging'` · `purging_at` 채워짐 | G-1 |
| `cash_ledger` 행 수 = `L0` (불변) | G-3 |

### 단계 D4 — **storage_purged**

| 기대 | 확인 |
|---|---|
| `state='storage_purged'` · `storage_purged_at` 채워짐 | G-1 |
| 아바타·학생증 등 private 객체 제거 | Storage 목록(경로만 확인, signed URL 원문 금지) |

### 단계 D5 — **finalized** (PII 익명화)

| 기대 | 확인 |
|---|---|
| `state='finalized'` · `finalized_at` 채워짐 | G-1 |
| `users` 행 **존속** · PII 익명화 | G-4 (boolean 판정만) |
| `user_deletion_log` +1 (멱등: 재호출해도 1) | G-5 |
| 커뮤니티 글·댓글 행 존속, 표기만 '탈퇴회원' | G-6 + 화면 |

### 단계 D6 — **auth_soft_deleted**

| 기대 | 확인 |
|---|---|
| `state='auth_soft_deleted'` · 타임스탬프 채워짐 | G-1 |
| 해당 계정 로그인 시도 실패(행은 보존) | 웹 `/login` |

### 단계 D7 — **completed**

| 기대 | 확인 |
|---|---|
| `state='completed'` · `completed_at` 채워짐 | G-1 |
| `failed_at IS NULL` · `attempts` 가 최대치 미만 | G-1 |
| `cash_ledger`/`payments`/`subscriptions` 행 수 = D0 값 | G-3 |
| `user_deletion_log` = 1 | G-5 |

### 참조 SQL

```sql
-- 6-2. 사전조건 (§4 [전제 확인 2] 와 동일)
-- 6-3. UGC 존재 (§4 [전제 확인 3] 과 동일)

-- 6-5. staging 에 탈퇴 함수가 실제로 존재하는지 (운영화 판정 근거)
SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname LIKE '%deletion%'
ORDER BY 1, 2;
-- 2026-07-25 실측: 14개 함수 전부 존재(151·154·161 적용 완료)
```

---

## 7. 실패·중단 처리

| 상황 | 판정 | 조치 |
|---|---|---|
| `state='failed'` · `last_error` 채워짐 | FAIL | `last_error` 를 기록만 하고 **수정하지 않는다**(원인 분석은 별도 트랙) |
| `attempts` 가 백오프 한도 도달 | FAIL | 동일 |
| 단계 건너뜀 관측 | — | `account_deletion_advance` 가 거부하므로 관측 자체가 이례. worker 이중 기동 의심 |
| worker 가 `pending` 에서 진행 안 함 | BLOCKED | §5 O-3 승인 대기. `qa-delete-01` 은 그대로 두고 다른 시나리오로 진행 |
| 원장 행 수 감소 | **CRITICAL FAIL** | 즉시 중단 · 오너 보고. CASCADE 발동 의심 |

---

## 8. 전이 기록표 (실행 세션에서 채움)

| 단계 | 기대 state | 관측 state | 타임스탬프 | 원장 행 수 | 판정 |
|---|---|---|---|---|---|
| D0 baseline | (job 없음) | | — | L0 = | |
| D1 요청 직후 | `pending` | | | | |
| D1' 취소 확인 | `canceled` → 재요청 `pending` | | | | |
| D2 창 경과 | `locked` | | | | |
| D3 | `purging` | | | | |
| D4 | `storage_purged` | | | | |
| D5 | `finalized` | | | | |
| D6 | `auth_soft_deleted` | | | | |
| D7 | `completed` | | | | |

**완주 판정**: D7 도달 + 원장 행 수 = L0 + `user_deletion_log` = 1 + `users` 행 존속.

---

## 9. 개인정보 취급

- 이 시나리오의 어떤 확인 SQL 도 이메일·이름·닉네임 **값**을 출력하지 않는다.
  익명화 확인은 `(email LIKE '%@removed.invalid')` 같은 boolean 판정으로만 한다.
- Storage 확인 시 signed URL 원문을 기록하지 않는다(경로 존재 여부만).
