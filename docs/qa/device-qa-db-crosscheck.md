# 실기기 QA ↔ DB 대조표 (시나리오 A~G)

> **이 문서는 준비 산출물이며, 실행·적용은 후속 웨이브에서 승인 후 직렬 수행한다.**
> 트랙 4 세션에서 staging 에 실행한 비-SELECT 문은 0건이다.
> 대상: ssambership-staging `lbeqxarxothkmzqvpudy` — **production 금지**.
> 이 문서의 **확인 SQL 은 전부 SELECT 전용**이다. UPDATE/DELETE/INSERT 는 한 줄도 없다.
> 계정 별칭은 `qa-accounts-plan.md` §0 규약(`qa-student-01` 등)을 따른다.

---

## 0. 사용법

1. 시나리오 시작 **전에** 「확인 SQL」의 *실행 전* 블록을 돌려 **기대 상태**와 일치하는지 본다.
   불일치면 그 시나리오는 시작하지 않는다(선행 데이터 오염 상태로 QA 하면 판정이 무의미).
2. 실기기에서 시나리오를 수행한다.
3. 「확인 SQL」의 *실행 후* 블록을 돌려 **판정 기준**과 대조한다.
4. 결과를 §9 판정 로그에 기록한다. **PASS / FAIL / BLOCKED** 3택.

**모든 시나리오 공통 불변식 (매 시나리오 종료 시 확인)**

| 불변식 | 확인 SQL | 기대 |
|---|---|---|
| IQ 첨부 중복 0 | §3-C-3 | `dup_path_groups = 0` |
| 원장 중복 0 | §3-D-3 | `dup_idem = 0` AND `dup_ref = 0` |
| 원장 append-only | §3-D-3 | 기존 행의 `id` 집합이 실행 전의 상위집합 |
| 알림 멱등 | §3-F-3 | `dup_recipient_event = 0` |

---

## 1. staging baseline (2026-07-25 SELECT 실측 · 대조 기준값)

| 테이블 | 행 수 | 비고 |
|---|---|---|
| `users` | 8 | student 3 / mentor 2 / admin 3, 전부 `active` |
| `cash_ledger` | 6 | reason 4종, `cash_topup` 2건은 `ref_id IS NULL` |
| `cash_wallets` | 1 | |
| `subscriptions` | 1 | active 1 |
| `mentor_student_rooms` | 2 | |
| `question_threads` / `question_messages` | 4 / 12 | |
| `individual_questions` | 2 | |
| `individual_question_attachments` | **1** | 중복 0 · 고아 0 · `message_id IS NULL` 1 |
| `community_posts` | 6 | `author_role='mentor'` 이나 실제 `users.role='student'` 인 **오염 2행** |
| `notifications` / `notification_outbox` | 7 / 7 | 5종만 존재(정본 18종 중) |
| `account_deletion_jobs` | 1 | `state='canceled'` |
| `user_deletion_log` | 0 | |

> 오염 2행(`community_posts.author_role`)은 **자동 수정 금지**(오너 결정 대기).
> 대조표는 이 2행을 baseline 으로 간주하고 **증가분만** 본다.

---

## 2. 시나리오 정의 (A~G)

| ID | 시나리오 | 주 계정 | 핵심 불변식 |
|---|---|---|---|
| **A** | 로그인·세션 유지 (모바일 웹 / 앱 WebView) | qa-student-01 · qa-mentor-01 | 세션 쿠키 속성 · 서버 write 0 |
| **B** | 질문방 — 학생 질문 작성 → 멘토 답변 | qa-student-01 + qa-mentor-01 | thread/message 정확히 +1 · 알림 원자 |
| **C** | 개별질문(IQ) — 작성 + 첨부 → 멘토 답변 | qa-student-01 + qa-mentor-01 | **첨부 중복 0** · escrow hold 1건 |
| **D** | 캐시 충전 → 구독 결제 | qa-student-01 | **원장 중복 0** · 잔액 = 원장 합계 |
| **E** | 커뮤니티 — 게시판 글·댓글·신고 | qa-student-01 | `author_role` = 실제 role · 오염 증가 0 |
| **F** | 알림 허브 25건 — 페이지·카테고리·읽음 | qa-student-01 | 멱등 · 읽음 단조 증가 |
| **G** | 회원 탈퇴 — 상태 전이 | **qa-delete-01** | `pending→locked→purging→…→completed` · 원장 불변 |

---

## 3. 시나리오별 대조표

### 3-A. 로그인·세션 유지

**실행 전 기대 상태**
- `qa-student-01` · `qa-mentor-01` 모두 `users.status='active'`
- 기기 브라우저 쿠키·앱 저장소 초기화 완료(이전 세션 잔존 0)

**실행 후 기대 상태**
- DB 는 **변화 없음**. 로그인은 `auth` 스키마 왕복이므로 `public` 테이블 행 수가 그대로여야 한다.
- (쿠키 속성 확인은 DB 가 아니라 개발자도구 — `mobile-session-matrix.md` §4)

**확인 SQL (SELECT 전용)**

```sql
-- A-1. 실행 전 / 실행 후 동일 실행 — 두 결과가 완전히 같아야 한다
SELECT (SELECT count(*) FROM public.users)                  AS users_rows,
       (SELECT count(*) FROM public.question_messages)      AS qmsg_rows,
       (SELECT count(*) FROM public.cash_ledger)            AS ledger_rows,
       (SELECT count(*) FROM public.notifications)          AS notif_rows,
       (SELECT count(*) FROM public.admin_action_logs)      AS admin_log_rows;

-- A-2. 대상 계정이 로그인 가능 상태인지 (게이트 사전 확인)
SELECT id, role, status, (suspended_until IS NOT NULL) AS has_suspension
  FROM public.users WHERE id IN (:'qa_student_01', :'qa_mentor_01');
```

**판정 기준**
- PASS: A-1 의 5개 값이 실행 전/후 **완전 동일** · A-2 가 2행 `active`·`has_suspension=false`
- FAIL: 로그인만으로 어떤 `public` 테이블이든 행 수가 변함
- 참고: 앱 WebView 부트스트랩은 **mentor 만** 통과한다(`strictMentorRoleDecision`).
  `qa-student-01` 로 부트스트랩 시 `/app/bridge/error?code=mentor_only` 가 **기대 동작**이다.

---

### 3-B. 질문방 — 학생 질문 작성 → 멘토 답변

**실행 전 기대 상태**
- `qa-student-01` ↔ `qa-mentor-01` 사이 `mentor_student_rooms` 1행 존재(활성 구독 기반)
- 해당 room 의 `question_threads` 수 = `T0`, `question_messages` 수 = `M0` (값 기록)

**실행 후 기대 상태**
- `question_threads` = `T0 + 1`
- `question_messages` = `M0 + 2` (학생 질문 1 + 멘토 답변 1)
- `notifications` 에 `question_answered` **정확히 1건 증가** (원자 producer·멱등)
- 주간 질문 한도 카운트가 요금제 cap 을 넘지 않음

**확인 SQL (SELECT 전용)**

```sql
-- B-1. 실행 전/후 동일 실행
SELECT r.id AS room_id,
       (SELECT count(*) FROM public.question_threads t WHERE t.room_id = r.id)  AS thread_cnt,
       (SELECT count(*) FROM public.question_messages m
          JOIN public.question_threads t2 ON t2.id = m.thread_id
         WHERE t2.room_id = r.id)                                               AS message_cnt
FROM public.mentor_student_rooms r
WHERE r.student_id = :'qa_student_01' AND r.mentor_id = :'qa_mentor_01';

-- B-2. question_answered 알림 증가분 (실행 전/후 비교)
SELECT count(*) AS question_answered_cnt
FROM public.notifications
WHERE recipient_user_id = :'qa_student_01' AND type = 'question_answered'
  AND event_key NOT LIKE 'qa25:%';   -- fixture 분 제외

-- B-3. 알림 멱등 — 같은 (recipient, event_key) 중복 0
SELECT count(*) AS dup_recipient_event FROM (
  SELECT recipient_user_id, event_key FROM public.notifications
   WHERE recipient_user_id IS NOT NULL AND event_key IS NOT NULL
   GROUP BY 1,2 HAVING count(*) > 1) d;
```

**판정 기준**
- PASS: `thread_cnt` +1 · `message_cnt` +2 · `question_answered_cnt` +1 · `dup_recipient_event = 0`
- FAIL: message +3 이상(이중 전송) · 알림 0(원자성 파손) · 알림 +2 이상(멱등 파손)

---

### 3-C. 개별질문(IQ) — 작성 + 첨부 → 멘토 답변  ★ 첨부 중복 0 필수

**실행 전 기대 상태**
- `individual_questions` = 2 · `individual_question_attachments` = **1**
- `individual_question_attachments` 중복 그룹 0 · 고아 0
- `qa-student-01` 지갑 잔액이 IQ 가격 이상

**실행 후 기대 상태**
- `individual_questions` +1 (status 전이: `open|assigned` → `claimed` → `answered` → `released`)
- `individual_question_attachments` **첨부한 파일 수만큼만 증가** (재시도·재렌더로 인한 중복 0)
- `cash_ledger` 에 `individual_question_escrow_hold` 1건(음수), 답변 수락 후 release 1건
- `notifications` 에 IQ 계열 이벤트가 각 1건씩

**확인 SQL (SELECT 전용)**

```sql
-- C-1. IQ 본체 (실행 전/후)
SELECT status, count(*) AS cnt
FROM public.individual_questions
GROUP BY status ORDER BY status;

-- C-2. 첨부 총량 (실행 전/후)
SELECT count(*) AS total_rows,
       count(*) FILTER (WHERE message_id IS NULL) AS message_id_null_rows
FROM public.individual_question_attachments;

-- ★ C-3. 첨부 중복·고아 0 (핵심 불변식 — 실행 후 필수)
SELECT
  (SELECT count(*) FROM (
     SELECT question_id, storage_path
       FROM public.individual_question_attachments
      GROUP BY question_id, storage_path HAVING count(*) > 1) d)      AS dup_path_groups,
  (SELECT count(*) FROM (
     SELECT storage_path FROM public.individual_question_attachments
      GROUP BY storage_path HAVING count(*) > 1) d2)                  AS dup_storage_path_global,
  (SELECT count(*) FROM public.individual_question_attachments a
     LEFT JOIN public.individual_questions q ON q.id = a.question_id
    WHERE q.id IS NULL)                                               AS orphan_question_rows,
  (SELECT count(*) FROM public.individual_question_attachments a
     LEFT JOIN public.individual_question_messages m ON m.id = a.message_id
    WHERE a.message_id IS NOT NULL AND m.id IS NULL)                  AS orphan_message_rows;

-- C-4. escrow 원장 라인 (실행 전/후)
SELECT reason, count(*) AS cnt, sum(delta_cents) AS sum_cents
FROM public.cash_ledger
WHERE ref_type = 'individual_questions'
GROUP BY reason ORDER BY reason;
```

**판정 기준**
- PASS: `dup_path_groups = 0` **AND** `dup_storage_path_global = 0` **AND**
  `orphan_question_rows = 0` **AND** `orphan_message_rows = 0`
  **AND** 첨부 증가분 = 실제 첨부한 파일 수(초과 0)
- FAIL: 위 4값 중 하나라도 > 0, 또는 파일 1개 첨부에 행이 2개 생김(업로드 재시도 이중 등록)
- 참고: baseline 의 `message_id IS NULL` 1행은 **기존 데이터**다. 증가분만 판정한다.

---

### 3-D. 캐시 충전 → 구독 결제  ★ 원장 중복 0 필수

**실행 전 기대 상태**
- `cash_ledger` = 6행 · reason 4종(`cash_topup` 2 / `individual_question_escrow_hold` 2 /
  `individual_question_refund` 1 / `subscription_payment` 1)
- `cash_topup` 2건은 `ref_id IS NULL` (**기존 부채 — 자동 수정 금지**)
- 지갑 `balance_cents` = 해당 유저 원장 `sum(delta_cents)`

**실행 후 기대 상태**
- 충전 1회 → `cash_topup` +1 (양수 delta)
- 구독 결제 1회 → `subscription_payment` +1 (음수 delta) + `subscriptions` 상태 전이
- **동일 `idempotency_key` 중복 0** (UNIQUE 제약이 있으므로 위반 시 에러가 나야 정상)
- 잔액 항등식 유지: `balance_cents = sum(delta_cents)`

**확인 SQL (SELECT 전용)**

```sql
-- D-1. reason 분포 (실행 전/후)
SELECT coalesce(reason,'(null)') AS reason, coalesce(ref_type,'(null)') AS ref_type,
       count(*) AS cnt,
       count(*) FILTER (WHERE ref_id IS NULL)          AS ref_id_null_cnt,
       count(*) FILTER (WHERE idempotency_key IS NULL) AS idem_null_cnt,
       sum(delta_cents)                                 AS sum_cents
FROM public.cash_ledger
GROUP BY 1,2 ORDER BY 1,2;

-- D-2. 정본 4종 외 reason 이 생겼는지
SELECT DISTINCT reason FROM public.cash_ledger
WHERE reason IS NULL OR reason NOT IN (
  'cash_topup','subscription_payment',
  'individual_question_escrow_hold','individual_question_refund');
-- 실행 전 기대: 0행. 실행 후 신규 reason 이 나오면 정본 목록 갱신 필요(수정 아님, 기록)

-- ★ D-3. 원장 중복 0 (핵심 불변식 — 실행 후 필수)
SELECT
  (SELECT count(*) FROM (
     SELECT idempotency_key FROM public.cash_ledger
      WHERE idempotency_key IS NOT NULL
      GROUP BY idempotency_key HAVING count(*) > 1) a)                       AS dup_idem,
  (SELECT count(*) FROM (
     SELECT user_id, reason, ref_type, ref_id, delta_cents
       FROM public.cash_ledger WHERE ref_id IS NOT NULL
      GROUP BY 1,2,3,4,5 HAVING count(*) > 1) b)                             AS dup_ref,
  (SELECT count(*) FROM public.cash_ledger WHERE idempotency_key IS NULL)    AS idem_null_rows;

-- ★ D-4. 잔액 항등식 (실행 후 필수)
SELECT w.user_id,
       w.balance_cents                       AS wallet_cents,
       coalesce(l.sum_cents, 0)              AS ledger_sum_cents,
       w.balance_cents - coalesce(l.sum_cents, 0) AS drift_cents
FROM public.cash_wallets w
LEFT JOIN LATERAL (SELECT sum(delta_cents) AS sum_cents
                     FROM public.cash_ledger c WHERE c.user_id = w.user_id) l ON true;

-- D-5. append-only 확인 — 실행 전 id 집합이 실행 후에도 전부 남아 있는가
--   (실행 전에 아래를 저장해 두고, 실행 후 같은 쿼리 결과와 비교)
SELECT id, created_at FROM public.cash_ledger ORDER BY created_at, id;
```

**판정 기준**
- PASS: `dup_idem = 0` **AND** `dup_ref = 0` **AND** 모든 행의 `drift_cents = 0`
  **AND** D-5 의 실행 전 `id` 집합 ⊆ 실행 후 `id` 집합(삭제·수정 0)
- FAIL: 충전 1회에 `cash_topup` 이 2행(웹훅 이중 처리) · `drift_cents ≠ 0` · 기존 행 소실
- 참고: `cash_topup` 2건의 `ref_id IS NULL` 은 baseline 부채다. **신규** topup 행에
  `ref_id` 가 채워지는지를 별도로 본다(채워지면 개선, 여전히 NULL 이면 §7 로 기록만).

---

### 3-E. 커뮤니티 — 게시판 글·댓글·신고

**실행 전 기대 상태**
- `community_posts` = 6 · 그중 `author_role='mentor'` 이나 실제 `users.role='student'` 인 **오염 2행**
- `community_comments` = 2 · `content_reports` = 3

**실행 후 기대 상태**
- 글 1건 작성 → `community_posts` +1, 그 행의 `author_role` = 작성자의 실제 `users.role`
- 댓글 1건 → `community_comments` +1 (브리지 미러 중복 0 — SQL 164 수정분 회귀 확인)
- 신고 1건 → `content_reports` +1
- **오염 행 수는 2 그대로**(증가 0)

**확인 SQL (SELECT 전용)**

```sql
-- E-1. author_role 정합성 (실행 전/후)
SELECT coalesce(p.author_role,'(null)') AS author_role,
       coalesce(u.role,'(no-user)')     AS actual_user_role,
       count(*)                          AS cnt,
       count(*) FILTER (WHERE p.deleted_at IS NOT NULL) AS soft_deleted_cnt
FROM public.community_posts p
LEFT JOIN public.users u ON u.id = p.author_id
GROUP BY 1,2 ORDER BY 1,2;
-- 실행 전 기대: (mentor, mentor) 4 · (mentor, student) 2

-- ★ E-2. 오염 행 수 (실행 후 필수 — 증가 0)
SELECT count(*) AS role_mismatch_rows
FROM public.community_posts p JOIN public.users u ON u.id = p.author_id
WHERE p.author_role IS DISTINCT FROM u.role;   -- 기대 2 (baseline 유지, 증가 0)

-- E-3. 댓글 중복 (163 결함 회귀 확인)
SELECT (SELECT count(*) FROM public.community_comments) AS community_comments,
       (SELECT count(*) FROM public.comments)           AS comments_bridge,
       (SELECT count(*) FROM (
          SELECT post_id, author_id, body FROM public.community_comments
           GROUP BY 1,2,3 HAVING count(*) > 1) d)       AS dup_comment_groups;  -- 기대 0

-- E-4. 신고 큐
SELECT status, count(*) AS cnt FROM public.content_reports GROUP BY 1 ORDER BY 1;

-- E-5. 소프트 삭제 수렴 (글 삭제 시)
SELECT count(*) FILTER (WHERE deleted_at IS NOT NULL) AS soft_deleted,
       count(*) FILTER (WHERE status = 'hidden')      AS hidden
FROM public.community_posts;
```

**판정 기준**
- PASS: 신규 글의 `author_role` = 실제 role · `role_mismatch_rows = 2`(불변) ·
  `dup_comment_groups = 0` · 댓글 1건 작성에 `community_comments` +1(브리지 이중 등록 0)
- FAIL: `role_mismatch_rows > 2`(신규 오염) · 댓글 1건에 행 2개 · 삭제가 원본에 미반영

---

### 3-F. 알림 허브 25건 — 페이지·카테고리·읽음

**실행 전 기대 상태**
- `qa-notifications-fixture.sql` §2 적용 완료 → `qa-student-01` 에 `qa25:%` 25행
- 읽음 10 / 안읽음 15 · 카테고리 5탭 전부 ≥2건 · `created_at` 서로 다름(25개 distinct)

**실행 후 기대 상태**
- 앱/웹에서 읽음 처리한 건수만큼 `is_read=true` 증가 (**단조 증가만** — 되돌아가지 않음)
- 알림 행 수는 **변하지 않음**(읽음은 UPDATE 이지 INSERT 가 아니다)
- 딥링크 탭 시 이동 경로가 `metadata->>'link'` 와 일치

**확인 SQL (SELECT 전용)**

```sql
-- F-1. 총량·읽음 배분 (실행 전/후)
SELECT count(*)                             AS total,        -- 기대 25 (전/후 불변)
       count(*) FILTER (WHERE is_read)      AS read_cnt,
       count(*) FILTER (WHERE NOT is_read)  AS unread_cnt
FROM public.notifications
WHERE recipient_user_id = :'qa_student_01' AND event_key LIKE 'qa25:%';

-- F-2. 카테고리 탭별 분포 (정본 allowlist 대조)
SELECT CASE
         WHEN type IN ('question_answered','individual_question_assigned','individual_question_claimed',
                       'individual_question_answered','individual_question_message',
                       'individual_question_released')                        THEN 'qna'
         WHEN type IN ('new_order_message','new_application')                 THEN 'order'
         WHEN type IN ('subscription_expired','subscription_renewal_succeeded',
                       'subscription_renewal_failed_insufficient_cash',
                       'subscription_renewal_upcoming',
                       'mentor_subscription_price_changed')                   THEN 'subscription'
         WHEN type IN ('individual_question_expired_refunded',
                       'mentor_termination_refund')                           THEN 'refund'
         WHEN type IN ('notice','mentor_termination_notice','mentor_pause_notice') THEN 'system'
         ELSE '(uncategorized)'
       END AS category, count(*) AS cnt
FROM public.notifications
WHERE recipient_user_id = :'qa_student_01' AND event_key LIKE 'qa25:%'
GROUP BY 1 ORDER BY 1;
-- 기대: qna 10 · order 2 · subscription 6 · refund 3 · system 4 · (uncategorized) 0

-- ★ F-3. 멱등 (실행 후 필수)
SELECT count(*) AS dup_recipient_event FROM (
  SELECT recipient_user_id, event_key FROM public.notifications
   WHERE recipient_user_id IS NOT NULL AND event_key IS NOT NULL
   GROUP BY 1,2 HAVING count(*) > 1) d;   -- 기대 0

-- F-4. 커서 페이지네이션 경계 (page size 10 → 3페이지)
SELECT ceil(count(*)::numeric / 10) AS expected_pages,          -- 기대 3
       count(DISTINCT created_at)   AS distinct_created_at      -- 기대 25
FROM public.notifications
WHERE recipient_user_id = :'qa_student_01' AND event_key LIKE 'qa25:%';

-- F-5. 딥링크 값 존재 확인 (본문·개인정보 미출력 — link 키 존재 여부만)
SELECT count(*) FILTER (WHERE metadata ? 'link' AND metadata->>'link' IS NOT NULL) AS has_link
FROM public.notifications
WHERE recipient_user_id = :'qa_student_01' AND event_key LIKE 'qa25:%';   -- 기대 25
```

**판정 기준**
- PASS: `total = 25` 불변 · `read_cnt` 단조 증가 · `(uncategorized) = 0` ·
  `dup_recipient_event = 0` · 3페이지 커서 앞/뒤 이동 시 건너뜀·중복 0
- FAIL: 읽음 처리로 행이 늘거나 줄어듦 · 카테고리 탭 합계 ≠ 25 · 커서 페이지에 동일 항목 재등장

---

### 3-G. 회원 탈퇴 — 상태 전이  ★ pending→locked→purging→completed 필수

**실행 전 기대 상태**
- 전용 계정 `qa-delete-01` 존재 · 탈퇴 사전조건 전부 충족
- `account_deletion_jobs` 에 `qa-delete-01` 행 **없음**
- `user_deletion_log` = 0 · `cash_ledger` 행 수 기록(`L0`)

**실행 후 기대 상태**
- 요청 직후: `state='pending'` · `cancelable_until` 설정됨 · `write_blocked=false`
- 취소 창 경과 후 worker: `pending → locked → purging → storage_purged → finalized →
  auth_soft_deleted → completed`
- `users` 행 **존속**(물리 삭제 0) · PII 컬럼 익명화
- **`cash_ledger` 행 수 불변(`L0`)** — 원장은 세법·회계상 보존
- 커뮤니티 글·댓글 행 존속(작성자 표기만 '탈퇴회원')

**확인 SQL (SELECT 전용)**

```sql
-- ★ G-1. 상태 전이 (각 단계마다 반복 실행)
SELECT state, attempts,
       (cancelable_until IS NOT NULL) AS has_cancel_window,
       (locked_at        IS NOT NULL) AS t_locked,
       (purging_at       IS NOT NULL) AS t_purging,
       (storage_purged_at IS NOT NULL) AS t_storage_purged,
       (finalized_at     IS NOT NULL) AS t_finalized,
       (auth_soft_deleted_at IS NOT NULL) AS t_auth_soft_deleted,
       (completed_at     IS NOT NULL) AS t_completed,
       (failed_at        IS NOT NULL) AS t_failed,
       dry_run
FROM public.account_deletion_jobs
WHERE user_id = :'qa_delete_01';

-- G-2. 전체 상태 분포 (다른 계정에 영향 없는지)
SELECT state, count(*) AS cnt FROM public.account_deletion_jobs GROUP BY 1 ORDER BY 1;

-- ★ G-3. 원장 불변 (실행 후 필수)
SELECT (SELECT count(*) FROM public.cash_ledger)  AS ledger_rows,   -- 기대 L0 (불변)
       (SELECT count(*) FROM public.payments)     AS payment_rows,  -- 불변
       (SELECT count(*) FROM public.subscriptions) AS sub_rows;     -- 불변

-- G-4. users 행 존속 + 익명화 (개인정보 값 미출력 — 마스킹 패턴 여부만)
SELECT id, role, status,
       (full_name = '탈퇴회원')                        AS name_anonymized,
       (nickname LIKE '탈퇴회원%')                     AS nickname_anonymized,
       (email LIKE '%@removed.invalid')                AS email_anonymized,
       (birth_date IS NULL)                            AS birth_cleared,
       (grade_level IS NULL)                           AS grade_cleared
FROM public.users WHERE id = :'qa_delete_01';

-- G-5. 감사 로그
SELECT count(*) AS deletion_log_rows FROM public.user_deletion_log
WHERE user_id = :'qa_delete_01';   -- 기대 1 (멱등: 재실행해도 1)

-- G-6. UGC 존속 (물리 삭제 0)
SELECT (SELECT count(*) FROM public.community_posts    WHERE author_id = :'qa_delete_01') AS posts,
       (SELECT count(*) FROM public.community_comments WHERE author_id = :'qa_delete_01') AS comments;
-- 기대: 탈퇴 전 작성한 건수 그대로
```

**판정 기준**
- PASS: G-1 이 `pending → locked → purging → storage_purged → finalized →
  auth_soft_deleted → completed` 순서로 전이(역행·건너뜀 0) · 각 단계 타임스탬프 채워짐 ·
  `ledger_rows` 불변 · G-4 익명화 플래그 전부 `true` · `users` 행 존속 ·
  `deletion_log_rows = 1` · G-6 UGC 행 존속
- FAIL: `state='failed'` · 상태 건너뜀 · `cash_ledger` 행 감소 · `users` 행 소실(CASCADE 발동)
- BLOCKED: **worker 러너 미운영화** — 상세는 `delete-account-scenario.md` §5

> ⚠️ 상태 전이는 `account_deletion_advance(p_user_id, p_from, p_to)` 가 **from→to 를 엄격히
> 검증**하므로(151 SQL), 단계를 건너뛴 호출은 DB 가 거부한다. 즉 전이 순서 위반은
> 애초에 기록되지 않는다 — 관측 실패는 worker 미동작 쪽을 먼저 의심한다.

---

## 4. 개인정보 취급 규칙 (QA 전 단계 공통)

- 확인 SQL 은 **이메일·이름·닉네임·연락처·본문 값을 출력하지 않는다.**
  `(email LIKE '%@removed.invalid')` 처럼 **boolean 판정**으로만 본다.
- 결과 캡처를 문서·이슈에 붙일 때 내부 UUID 는 앞 8자리까지만 남긴다.
- signed URL·토큰·secret 원문은 어떤 로그에도 남기지 않는다.

---

## 5. 판정 로그 (QA 실행 세션에서 채움)

| 시나리오 | 실행 전 확인 | 실행 후 확인 | 판정 | 비고 |
|---|---|---|---|---|
| A 로그인·세션 | | | | |
| B 질문방 | | | | |
| C 개별질문 첨부 | | | | |
| D 캐시·원장 | | | | |
| E 커뮤니티 | | | | |
| F 알림 25건 | | | | |
| G 회원 탈퇴 | | | | |

**공통 불변식 최종 확인**

| 불변식 | 값 | 판정 |
|---|---|---|
| IQ 첨부 중복 0 (`dup_path_groups`) | | |
| 원장 중복 0 (`dup_idem` / `dup_ref`) | | |
| 잔액 항등식 (`drift_cents`) | | |
| 알림 멱등 (`dup_recipient_event`) | | |
| community_posts 오염 증가 0 (`role_mismatch_rows`) | | |
| 탈퇴 상태 전이 완주 | | |
