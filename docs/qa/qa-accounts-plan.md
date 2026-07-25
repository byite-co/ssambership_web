# QA 계정 준비 계획서 (웨이브 1 / 트랙 4)

> **이 문서는 준비 산출물이며, 실행·적용은 후속 웨이브에서 승인 후 직렬 수행한다.**
> 이 세션에서 staging 에 적용한 변경은 0건이다(비-SELECT 문 0건 · 생성 계정 0건).
> 대상 프로젝트: `lbeqxarxothkmzqvpudy` (ssambership-staging) — **production 접근 금지**.
> 기점: `byite-co/ssambership_web` PR #42 브랜치 HEAD `6062dcc`.

---

## 0. 계정 명명 규약 (전 QA 문서 공통)

| 별칭 | 역할 | 용도 |
|---|---|---|
| `qa-student-01` | student | 학생 주 시나리오(구독·질문방·개별질문·캐시·커뮤니티·알림) |
| `qa-mentor-01` | mentor | 멘토 주 시나리오(질문방 답변·개별질문 claim·프로필·앱 WebView 부트스트랩) |
| `qa-admin-01` | admin | 관리자 콘솔(승인·검수·분쟁·환불·공지) |
| `qa-delete-01` | student | **DELETE-03 전용 폐기 계정**(탈퇴 상태 전이 실증 후 재사용 금지) |

이 별칭은 `device-qa-db-crosscheck.md` · `delete-account-scenario.md` ·
`mobile-session-matrix.md` · `qa-notifications-fixture.sql` 에서 동일하게 쓴다.
별칭 ↔ 실제 `users.id` 매핑표는 계정 생성 세션에서 **별도 비공개 노트**에 기록한다
(이 문서에는 이메일·이름·비밀번호 등 개인정보/자격증명을 적지 않는다).

---

## 1. staging 실태 (2026-07-25 SELECT 실측)

실행 SQL·집계 수치 전문은 §6 및 보고 §3 참조. 요약:

| 역할 | status | 계정 수 | QA 사용 가능성 |
|---|---|---|---|
| admin | active | 3 | 있음(단, §2-3 자격증명 확립 필요) |
| mentor | active | 2 | 있음(2건 모두 `verification_status='approved'`) |
| student | active | 3 | 부분적 |

전 계정 `status='active'`, `suspended`/`banned`/`deleted` 행 0.

준비도 실측(내부 id 만, 개인정보 값 미출력):

| user_id (내부) | role | wallet | 구독 | room | 알림 | 탈퇴job | 알림설정 |
|---|---|---|---|---|---|---|---|
| `c04a191c-…80fb` | student | ✅ | 1(active 1) | 2 | 5 | ✗ | ✅ |
| `a0daa58b-…9826` | student | ✗ | 0 | 0 | 0 | ✗ | ✗ |
| `32c8c8eb-…fa65` | student | ✗ | 0 | 0 | 0 | **✅(canceled)** | ✗ |
| `95c5c537-…c88e` | mentor | ✗ | 1(active 1) | 1 | 2 | ✗ | ✅ |
| `790b16cd-…507d` | mentor | ✗ | 0 | 1 | 0 | ✗ | ✗ |
| `9bf48819-…e60c` | admin | ✗ | 0 | 0 | 0 | ✗ | ✗ |
| `e2e00000-…0001` | admin | ✗ | 0 | 0 | 0 | ✗ | ✗ |
| `970f7278-…f459` | admin | ✗ | 0 | 0 | 0 | ✗ | ✗ |

---

## 2. 계정 4종 — 요건 / 부족분 / 생성 절차

### 2-1. `qa-student-01` (학생)

**요건**
- `users.role='student'` · `status='active'` · `email` 확인 완료(로그인 가능)
- `cash_wallets` 행 존재 · `balance_cents` ≥ 20,000,000 (=20만 캐시, 구독 1회 + IQ 2건 여유)
- 활성 구독 1건(`subscriptions.status='active'`) → `mentor_student_rooms` 1행 이상
- `question_threads` ≥ 1 · `individual_questions` ≥ 1(첨부 포함)
- `notification_settings` 행 존재(push_enabled=true)
- 알림 25건 시나리오 수신자(→ `qa-notifications-fixture.sql`)

**실태 대비 판정**: `c04a191c-…80fb` 이 요건 대부분을 이미 충족(wallet ✅ · active 구독 1 ·
room 2 · 알림 5 · 알림설정 ✅). **부족분은 (a) 로그인 자격증명 유효성 (b) 알림 25건 (c) IQ 첨부 세트.**

> ⚠️ 기존 감사(`docs/audit/V16_CROSS_REPO_FINAL_CHANGE_REPORT_20260724.md` §7-5)에
> **주입된 E2E 계정 3종의 비밀번호↔DB 해시 불일치(`invalid_credentials`)** 가 기록되어 있다.
> 기존 계정 재사용 전 **오너가 비밀번호를 재설정**해야 한다(수작업 항목 W-1).

**생성 절차 (기존 계정 재사용안 — 권장)**
1. (오너) Supabase Studio → Authentication → 대상 사용자 → *Reset password* / *Send magic link*.
2. (QA) 웹 `/login` 에서 로그인 성공 확인 → `/mypage` 진입 확인.
3. (승인 후) `qa-notifications-fixture.sql` **§2** 실행으로 학생 알림 25건 세팅
   (같은 파일 §3 의 멘토 2건까지 실행해야 정본 18종 커버리지가 완성된다 — 총 27행).

**생성 절차 (신규 계정안 — 정상 가입 플로우)**
1. (QA) 웹 `/signup` 학생 가입 — 이메일·비밀번호·학년·약관 동의. **직접 SQL 시드 금지**
   (과거 §7-6 관리자 GoTrue 500 을 일으킨 auth 컬럼 NULL 부채가 재발할 수 있다.
   현재 staging 은 NULL 0건으로 정상이나, 재발 방지 규율로 직접 시드는 계속 금지한다).
2. (QA) 이메일 인증 완료 → 최초 로그인 → `users` 행 트리거 동기화 확인.
3. (오너) 캐시 충전은 **웹 `/wallet/charge` 토스 테스트 결제**로 수행(수작업 항목 W-2).
   fixture 로 `cash_ledger` 를 직접 INSERT 하지 않는다 — append-only 원장 오염 금지.
4. (QA) `/subscribe` 에서 `qa-mentor-01` 구독 1건 결제 → room 자동 생성 확인.
5. (승인 후) 상태 세팅 fixture §3-A 실행.

---

### 2-2. `qa-mentor-01` (멘토)

**요건**
- `users.role='mentor'` · `mentor_profiles.verification_status='approved'`
- `mentor_plans` 3티어 행 존재(라이트/스탠다드/프리미엄, 가격 밴드 내)
- `mentor_individual_question_pricing` 행 존재(IQ 응답가)
- `is_open_for_subscriptions=true` · `activity_status` 정상
- **앱 WebView 부트스트랩 대상** — `/api/app-session/bootstrap` 은 `strictMentorRoleDecision`
  으로 **mentor role 만** 통과시킨다(`mobile-session-matrix.md` §3 참조)

**실태 대비 판정**: mentor 2건 모두 `approved`. `95c5c537-…c88e` 는 활성 구독 1·room 1·
알림설정 ✅ 로 주 계정에 적합. **부족분은 (a) 로그인 자격증명 (b) `cash_wallets` 행 없음
(정산·캐시충전 화면 검증 시 필요) (c) 앱 로그인 확인.**

**생성 절차**
1. (기존 재사용) 오너 비밀번호 재설정 → 웹 `/mentor/dashboard` 진입 확인.
2. (신규 시) `/signup` 멘토 가입 → 학생증 업로드 → **(오너) `/admin/mentor-approval` 에서
   승인**(수작업 항목 W-3) → `verification_status='approved'` 전이 확인.
3. (오너) `/mentor/profile/edit` 에서 요금제 3티어 가격 저장 — 서버가 밴드를 강제하므로
   라이트 29,900~69,900 · 스탠다드 84,900~149,900 · 프리미엄 174,900~329,900 범위로 입력.
4. (승인 후) 상태 세팅 fixture §3-B 로 잔여 상태만 보정.

---

### 2-3. `qa-admin-01` (관리자)

**요건**
- `users.role='admin'` · `status='active'`
- `/admin/dashboard` · `/admin/mentor-approval` · `/admin/moderation` · `/admin/disputes` ·
  `/admin/refunds` · `/admin/notices` 전 라우트 진입 가능
- `requireRole("admin")` 통과(모든 관리자 server action 의 첫 줄 게이트)

**실태 대비 판정**: admin 3건 존재. **부족분은 자격증명 미확립(로그인 가능 여부 미확인).**

> **[정정 2026-07-25]** 초판은 이 항목의 사유를 「GoTrue 500 부채로 **로그인 불가**」로 적었다.
> 그 전제는 **현행 staging 에서 소멸했다.** 판정 세션과 본 트랙이 각각 `auth.users` 를
> 재실측한 결과 **8행 전원(관리자 3명 포함) 토큰 컬럼 8종에 NULL 0건**이며
> `email_confirmed_at` 8/8 · `banned_until` 0 · `deleted_at` 0 이다(근거 SQL §6 RECON-11).
> 즉 GoTrue Go 스캔 오류의 원인(NULL 토큰 컬럼)은 지금 존재하지 않는다.
>
> 다만 이것이 「관리자 로그인 가능」을 뜻하지는 **않는다.** 비밀번호 해시 유효성은
> SELECT 로 확인할 수 없는 별개 문제이고, 기존 감사 §7-5 의 자격증명 불일치
> (`invalid_credentials`) 부채는 그대로 남아 있다.
> → **사유를 「500 부채」에서 「자격증명 미확립」으로 갱신한다. 실기기·관리자 QA 전에
> 로그인 선행 조치가 필요하다는 결론 자체는 유지된다.**

> **PR #45 취급 변경**: `claude/admin-account-creation-5zql3q`(PR #45)의 **정규화 SQL 은
> 무조건 적용 대상이 아니다.** 적용 전에 아래 NULL 재확인 게이트를 통과할 때만 쓴다.
> 현 실측(NULL 0건)대로면 **정규화 파트는 불필요**하고, 신규 계정 **생성 템플릿 파트만** 유효하다.

```sql
-- [NULL 재확인 게이트] 정규화 SQL 적용 여부 판정 — SELECT 전용
-- 아래 8개 값이 전부 0이면 정규화 불필요(생성 템플릿만 사용).
-- 하나라도 > 0 이면 그때 PR #45 정규화 SQL 적용을 검토한다.
SELECT count(*)                                                    AS auth_users_total,
       count(*) FILTER (WHERE confirmation_token         IS NULL)  AS null_confirmation_token,
       count(*) FILTER (WHERE recovery_token             IS NULL)  AS null_recovery_token,
       count(*) FILTER (WHERE email_change_token_new     IS NULL)  AS null_email_change_token_new,
       count(*) FILTER (WHERE email_change_token_current IS NULL)  AS null_email_change_token_current,
       count(*) FILTER (WHERE email_change               IS NULL)  AS null_email_change,
       count(*) FILTER (WHERE phone_change               IS NULL)  AS null_phone_change,
       count(*) FILTER (WHERE phone_change_token         IS NULL)  AS null_phone_change_token,
       count(*) FILTER (WHERE reauthentication_token     IS NULL)  AS null_reauthentication_token
FROM auth.users;
-- 2026-07-25 실측: total 8 · NULL 전 항목 0
```

**생성 절차**
1. (오너) 위 NULL 재확인 게이트를 먼저 실행한다.
   - 전부 0 → **정규화 SQL 생략.** 기존 관리자 3건 중 1건의 **비밀번호를 재설정**해 쓰거나
     (Studio → Authentication → *Reset password*), 신규가 필요하면 2번으로.
   - 하나라도 > 0 → PR #45 정규화 SQL 적용 검토(트랙 4 범위 밖).
2. (오너) 신규가 필요하면 **Supabase Studio UI 로 생성**한다 — 수작업 항목 W-4.
   직접 SQL 시드는 계속 금지한다(과거 GoTrue 500 의 원인이었고, 재발 방지 규율로 유지).
3. (오너) 생성 계정의 `public.users.role` 을 `'admin'` 으로 승격 — 수작업 항목 W-5.
   (이 UPDATE 는 트랙 4 범위 밖. SQL 초안은 트랙 3/PR #45 소관이므로 여기 싣지 않는다.)
4. (QA) `/admin/dashboard` 로그인 진입 확인 → `admin_action_logs` 에 진입 로그 적재 확인.

---

### 2-4. `qa-delete-01` (탈퇴 전용 · 폐기 계정)

**요건**
- 신규 가입 학생 계정. **다른 시나리오와 절대 공유하지 않는다**(익명화는 되돌릴 수 없다).
- 탈퇴 사전조건을 만족해야 진행 가능:
  active/past_due 구독 0 · escrow 진행중 IQ 0 · 진행중 CR 주문 0 · open 분쟁 0 ·
  지갑 잔액 0(또는 소멸 동의)
- 익명화 후 대조를 위해 **탈퇴 전에** 커뮤니티 게시글 1건 · 댓글 1건을 남겨둔다
  (작성자 표기가 '탈퇴회원' 으로 바뀌는지 확인용)
- `NEXT_PUBLIC_FEATURE_ACCOUNT_DELETION` 플래그 ON 인 환경 필요(`lib/shell/featureFlags.ts:18`)

**실태 대비 판정**: **전용 계정 0건 — 신규 생성 필요.**
`32c8c8eb-…fa65` 에 `account_deletion_jobs` 행이 1건 있으나 `state='canceled'` 이므로
전이 실증에 쓸 수 없다(§7 발견 참조). 재사용 금지.

**생성 절차**: `delete-account-scenario.md` §2 참조.

---

## 3. 상태 세팅 fixture 초안 (⚠️ 실행 금지)

```sql
-- =====================================================================
-- ⚠️ 실행 금지 — 준비 산출물(초안)입니다.
-- 이 파일/블록은 후속 웨이브에서 오너 승인 후 직렬로만 실행합니다.
-- 트랙 4 세션에서는 단 한 줄도 실행하지 않았습니다.
-- 대상: ssambership-staging (lbeqxarxothkmzqvpudy) 전용 · production 금지
-- 실행 권한: service_role (Supabase Studio SQL Editor 또는 MCP execute_sql)
-- 실행 전 필수: BEGIN; 으로 열고, 검증 SELECT 확인 후 COMMIT; 또는 ROLLBACK;
-- 치환 필요: :qa_student_01 / :qa_mentor_01 = 실제 users.id (UUID)
-- =====================================================================
```

### 3-A. `qa-student-01` 상태 보정

**대상 테이블**: `public.notification_settings`, `public.cash_wallets`(읽기 확인만)
**전제 조건**: 대상 `users.id` 존재 · `role='student'` · `status='active'`

```sql
BEGIN;

-- [전제 확인] 대상이 학생·활성인지 먼저 확인(0행이면 즉시 ROLLBACK)
SELECT id, role, status FROM public.users
 WHERE id = :'qa_student_01' AND role = 'student' AND status = 'active';

-- (1) 알림 설정 행 보장 — 없으면 생성, 있으면 push 만 켠다
INSERT INTO public.notification_settings (user_id, push_enabled, groups, updated_at)
VALUES (:'qa_student_01', true, '{}'::jsonb, now())
ON CONFLICT (user_id) DO UPDATE
   SET push_enabled = true, updated_at = now();

-- (2) 지갑 잔액은 fixture 로 조작하지 않는다.
--     캐시는 append-only 원장이 정본이므로 반드시 웹 /wallet/charge 토스 테스트 결제로 채운다.
--     여기서는 현재 잔액 확인만 한다.
SELECT user_id, balance_cents, balance_cents / 100 AS balance_krw
  FROM public.cash_wallets WHERE user_id = :'qa_student_01';

COMMIT;  -- 또는 문제 발견 시 ROLLBACK;
```

**rollback 문**

```sql
-- 롤백 A: 트랜잭션 미확정 상태
ROLLBACK;

-- 롤백 B: 이미 COMMIT 된 뒤 (1) 만 되돌리는 경우
--   - fixture 실행 전에 아래를 먼저 저장해 두어야 한다:
--     SELECT user_id, push_enabled, groups FROM public.notification_settings
--      WHERE user_id = :'qa_student_01';
--   - 실행 전 행이 "없었다면":
DELETE FROM public.notification_settings WHERE user_id = :'qa_student_01';
--   - 실행 전 행이 "있었다면"(저장해 둔 값으로 복원):
UPDATE public.notification_settings
   SET push_enabled = :prev_push_enabled, groups = :'prev_groups'::jsonb, updated_at = now()
 WHERE user_id = :'qa_student_01';
```

**실행 후 검증 SELECT**

```sql
SELECT (SELECT count(*) FROM public.notification_settings
         WHERE user_id = :'qa_student_01' AND push_enabled) AS settings_ok,   -- 기대 1
       (SELECT count(*) FROM public.cash_wallets
         WHERE user_id = :'qa_student_01')                  AS wallet_rows,   -- 기대 1
       (SELECT count(*) FROM public.subscriptions
         WHERE student_id = :'qa_student_01' AND status = 'active') AS active_subs; -- 기대 >=1
```

### 3-B. `qa-mentor-01` 상태 보정

**대상 테이블**: `public.notification_settings`
**전제 조건**: `role='mentor'` · `mentor_profiles.verification_status='approved'`

```sql
BEGIN;

-- [전제 확인] 승인 멘토인지 (0행이면 ROLLBACK — 승인은 관리자 화면 수작업 W-3)
SELECT u.id, u.role, mp.verification_status, mp.is_open_for_subscriptions
  FROM public.users u
  JOIN public.mentor_profiles mp ON mp.user_id = u.id
 WHERE u.id = :'qa_mentor_01' AND u.role = 'mentor' AND mp.verification_status = 'approved';

-- (1) 알림 설정 행 보장
INSERT INTO public.notification_settings (user_id, push_enabled, groups, updated_at)
VALUES (:'qa_mentor_01', true, '{}'::jsonb, now())
ON CONFLICT (user_id) DO UPDATE
   SET push_enabled = true, updated_at = now();

-- (2) 요금제/IQ 가격은 fixture 로 쓰지 않는다 — 서버가 가격 밴드를 강제하므로
--     반드시 /mentor/profile/edit 화면에서 저장한다(수작업 항목 W-6). 여기서는 확인만.
SELECT count(*) AS plan_rows FROM public.mentor_plans WHERE mentor_id = :'qa_mentor_01';
SELECT count(*) AS iq_price_rows FROM public.mentor_individual_question_pricing
 WHERE mentor_id = :'qa_mentor_01';

COMMIT;  -- 또는 ROLLBACK;
```

**rollback 문**: §3-A 의 롤백 A/B 와 동일 (대상만 `:'qa_mentor_01'`).

**실행 후 검증 SELECT**

```sql
SELECT (SELECT count(*) FROM public.notification_settings
         WHERE user_id = :'qa_mentor_01' AND push_enabled)                 AS settings_ok,  -- 기대 1
       (SELECT count(*) FROM public.mentor_plans
         WHERE mentor_id = :'qa_mentor_01')                                AS plan_rows,    -- 기대 3
       (SELECT count(*) FROM public.mentor_individual_question_pricing
         WHERE mentor_id = :'qa_mentor_01')                                AS iq_price_rows;-- 기대 1
```

### 3-C. `qa-admin-01` 상태 보정

**fixture 없음.** 관리자 계정은 auth 컬럼 정합성 재발 방지(§2-3) 때문에 DB 직접 조작이 아닌
**Supabase Studio UI 경로**로만 만든다(PR #45 정규화 SQL 은 NULL 재확인 게이트 통과 시에만).
확인은 SELECT 로만 한다.

```sql
-- 확인 전용(SELECT only)
SELECT id, role, status FROM public.users WHERE id = :'qa_admin_01' AND role = 'admin';
```

### 3-D. `qa-delete-01` 상태 보정

`delete-account-scenario.md` §4 로 분리(탈퇴 사전조건 검증 + 전이 대조가 함께 묶여야 하므로).

---

## 4. 부족분 판정 요약

| # | 항목 | 실태 | 부족분 | 해소 주체 |
|---|---|---|---|---|
| A-1 | 학생 QA 계정 | 후보 1건(데이터 충족) | 로그인 자격증명 | 오너(W-1) |
| A-2 | 멘토 QA 계정 | 후보 2건(승인 완료) | 로그인 자격증명 · wallet 행 | 오너(W-1, W-2) |
| A-3 | 관리자 QA 계정 | 3건 존재 · auth 토큰 NULL **0건**(정상) | **자격증명 미확립**(로그인 미검증) | 오너(W-1 확장 또는 W-4·W-5) |
| A-4 | 탈퇴 전용 계정 | **0건** | 신규 생성 필요 | QA 가입 + 오너 플래그(W-7) |
| A-5 | 알림 유형 커버리지 | 5/18 | **13종 부족** | fixture(승인 후) |
| A-6 | 알림 건수 | 최대 5건/계정 | 학생 25건 미달(20건 부족) · 멘토 보조 2건 별도 | fixture(승인 후) |

**오너 수작업 필요 항목**

| ID | 내용 | 이유 |
|---|---|---|
| W-1 | QA 계정 비밀번호 재설정(학생·멘토·**관리자**) | 기존 주입 계정 `invalid_credentials` 부채 |
| W-2 | `/wallet/charge` 토스 테스트 결제로 캐시 충전 | `cash_ledger` append-only — fixture INSERT 금지 |
| W-3 | `/admin/mentor-approval` 에서 멘토 승인 | 승인은 관리자 server action 경로만 |
| W-4 | Supabase Studio UI 로 관리자 계정 생성(**필요 시에만**) | 직접 SQL 시드는 과거 GoTrue 500 원인 — 재발 방지 |
| W-5 | 관리자 계정 `users.role='admin'` 승격 | 트랙 4 쓰기 금지 범위 |
| W-6 | `/mentor/profile/edit` 에서 3티어 가격 저장 | 서버가 가격 밴드 강제 |
| W-7 | `NEXT_PUBLIC_FEATURE_ACCOUNT_DELETION=true` 배포 | 탈퇴 UI 진입점 노출 |
| W-8 | 탈퇴 worker 운영화(claim→advance 러너) | 저장소에 러너 구현 0건(§7 발견) |

---

## 5. 품질 기준 준수 확인

- [x] 전 fixture 블록에 **실행 금지 헤더** 포함
- [x] 전 fixture 블록에 **대상 테이블·전제 조건** 명시
- [x] 전 fixture 블록에 **rollback 문** 동봉
- [x] 전 fixture 블록에 **실행 후 검증 SELECT** 동봉
- [x] 개인정보 값(이메일·이름·연락처·본문) 미기재 — 내부 id·집계만

---

## 6. 근거 SQL (이 문서 작성에 실제 실행한 SELECT)

```sql
-- RECON-1: 역할·상태별 계정 수
SELECT role, status, count(*) AS cnt
FROM public.users
GROUP BY role, status
ORDER BY role, status;
```

```sql
-- RECON-1b: QA 후보 계정 준비도 (내부 id + 존재 여부 플래그만)
SELECT u.id AS user_id, u.role, u.status,
       (u.email IS NOT NULL)    AS has_email,
       (mp.user_id IS NOT NULL) AS has_mentor_profile,
       mp.verification_status,
       (w.user_id IS NOT NULL)  AS has_wallet,
       coalesce(s.sub_cnt,0)    AS subscription_cnt,
       coalesce(s.active_cnt,0) AS active_subscription_cnt,
       coalesce(r.room_cnt,0)   AS room_cnt,
       coalesce(n.noti_cnt,0)   AS notification_cnt,
       (adj.user_id IS NOT NULL) AS has_deletion_job,
       (ns.user_id IS NOT NULL)  AS has_notification_settings
FROM public.users u
LEFT JOIN public.mentor_profiles mp ON mp.user_id = u.id
LEFT JOIN public.cash_wallets w     ON w.user_id  = u.id
LEFT JOIN public.notification_settings ns ON ns.user_id = u.id
LEFT JOIN LATERAL (SELECT count(*) sub_cnt, count(*) FILTER (WHERE status='active') active_cnt
                   FROM public.subscriptions x WHERE x.student_id=u.id OR x.mentor_id=u.id) s ON true
LEFT JOIN LATERAL (SELECT count(*) room_cnt FROM public.mentor_student_rooms x
                   WHERE x.student_id=u.id OR x.mentor_id=u.id) r ON true
LEFT JOIN LATERAL (SELECT count(*) noti_cnt FROM public.notifications x
                   WHERE x.recipient_user_id=u.id OR x.user_id=u.id) n ON true
LEFT JOIN LATERAL (SELECT user_id FROM public.account_deletion_jobs x WHERE x.user_id=u.id LIMIT 1) adj ON true
ORDER BY u.role, u.created_at;
```

```sql
-- RECON-11 (정정 2026-07-25 추가): auth.users 토큰 컬럼 NULL 실태
-- §2-3 의 「GoTrue 500 부채」 전제가 현행 staging 에 존재하는지 검증한 조회.
SELECT count(*)                                                    AS auth_users_total,
       count(*) FILTER (WHERE confirmation_token         IS NULL)  AS null_confirmation_token,
       count(*) FILTER (WHERE recovery_token             IS NULL)  AS null_recovery_token,
       count(*) FILTER (WHERE email_change_token_new     IS NULL)  AS null_email_change_token_new,
       count(*) FILTER (WHERE email_change_token_current IS NULL)  AS null_email_change_token_current,
       count(*) FILTER (WHERE email_change               IS NULL)  AS null_email_change,
       count(*) FILTER (WHERE phone_change               IS NULL)  AS null_phone_change,
       count(*) FILTER (WHERE phone_change_token         IS NULL)  AS null_phone_change_token,
       count(*) FILTER (WHERE reauthentication_token     IS NULL)  AS null_reauthentication_token,
       count(*) FILTER (WHERE email_confirmed_at         IS NOT NULL) AS email_confirmed_cnt,
       count(*) FILTER (WHERE banned_until IS NOT NULL)            AS banned_cnt,
       count(*) FILTER (WHERE deleted_at   IS NOT NULL)            AS soft_deleted_cnt
FROM auth.users;
```

결과: `auth_users_total=8` · **NULL 8개 항목 전부 0** · `email_confirmed_cnt=8` ·
`banned_cnt=0` · `soft_deleted_cnt=0`
→ GoTrue Go 스캔 오류의 전제(NULL 토큰 컬럼)가 **현행 staging 에 없다**. §2-3 정정 근거.

세 조회 모두 SELECT 전용이며, 이메일·이름·비밀번호 해시·토큰 등 개인정보/자격증명 **값**은
출력하지 않았다(`has_email` 같은 존재 여부 boolean, NULL 건수 집계, 내부 UUID 만 조회).
