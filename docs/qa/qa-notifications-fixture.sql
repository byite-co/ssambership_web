-- =============================================================================
-- ⚠️ 실행 금지 — 이 파일은 준비 산출물(초안)입니다.
-- 이 문서는 준비 산출물이며, 실행·적용은 후속 웨이브에서 승인 후 직렬 수행합니다.
-- 트랙 4(웨이브 1) 세션에서는 이 파일의 단 한 줄도 실행하지 않았습니다.
-- =============================================================================
--
-- 파일    : docs/qa/qa-notifications-fixture.sql
-- 목적    : 실기기 QA 「알림 25건」 시나리오용 데이터 초안
--           (알림 허브 페이지네이션·카테고리 서브탭·읽음 처리·딥링크 검증)
-- 총 생성량: **27행** = §2 학생 25행(시나리오 본체) + §3 멘토 2행(유형 커버리지 보조).
--           시나리오 이름의 "25건"은 학생 알림 허브에 보이는 건수를 뜻한다.
--           멘토 2행은 학생에게 갈 수 없는 수신자 전용 유형(individual_question_assigned·
--           new_application)을 채워 18/18 커버리지를 완성하기 위한 것이며, 학생 허브
--           건수(25)에는 포함되지 않는다. 검증 SELECT §5-1 의 기대값은 25 / 2 / 27 이다.
-- 대상 DB : ssambership-staging (lbeqxarxothkmzqvpudy) 전용 — production 절대 금지
-- 실행 권한: service_role (record_domain_notification 은 postgres·service_role EXECUTE 전용)
-- 선행 SQL: 132(record_domain_notification) · 155/157/158/159(원자화) — staging 적용 확인됨
-- 기점    : ssambership_web PR #42 브랜치 HEAD 6062dcc
--
-- ── 전제 조건 ────────────────────────────────────────────────────────────────
--  P1. :qa_student_01 / :qa_mentor_01 은 실제 public.users.id (UUID) 로 치환한다.
--      (qa-accounts-plan.md §0 명명 규약. 매핑표는 별도 비공개 노트 관리)
--  P2. 두 계정 모두 users.status='active' 이고 로그인 가능해야 한다.
--  P3. 반드시 BEGIN; 으로 열고, §5 검증 SELECT 를 확인한 뒤 COMMIT; 한다.
--  P4. event_key/dedup_key 는 전부 'qa25:' prefix 를 쓴다 — §4 rollback 이
--      이 prefix 만으로 정확히 되돌릴 수 있게 하기 위함이다. 실제 도메인 이벤트가
--      만드는 event_key 와 절대 충돌하지 않는다.
--  P5. 이 fixture 는 notifications / notification_outbox 두 테이블만 건드린다.
--      cash_ledger · individual_question_* · subscriptions 등 도메인/원장 테이블은
--      **일절 쓰지 않는다**(append-only 원장 오염 금지).
--
-- ── 대상 테이블 ──────────────────────────────────────────────────────────────
--   public.notifications        (INSERT via RPC · 일부 UPDATE: created_at 분산·읽음)
--   public.notification_outbox  (INSERT via RPC · 일부 UPDATE: status)
--
-- ── staging 실태 대비 부족분 (2026-07-25 SELECT 실측) ─────────────────────────
--   정본 카테고리 allowlist(lib/notifications/notificationCategories.ts) = 18 종
--   staging 현존 = 5 종 (question_answered / individual_question_assigned /
--                        individual_question_answered / individual_question_message /
--                        individual_question_expired_refunded), 총 7행
--   → 부족 13 종. 이 fixture 가 §2(학생 25건, 16종) + §3(멘토 2건, 2종) 으로
--     18/18 종을 채운다.
-- =============================================================================


-- =============================================================================
-- §1. 실행 전 baseline 스냅샷 (⚠️ 반드시 먼저 실행하고 결과를 기록할 것)
--     rollback 이 baseline 으로 복원됐는지 판정하는 기준값이다. SELECT 전용.
-- =============================================================================

SELECT 'baseline' AS phase,
       (SELECT count(*) FROM public.notifications)       AS notifications_total,
       (SELECT count(*) FROM public.notification_outbox) AS outbox_total,
       (SELECT count(*) FROM public.notifications
         WHERE event_key LIKE 'qa25:%')                  AS qa25_notifications,  -- 기대 0
       (SELECT count(*) FROM public.notification_outbox
         WHERE dedup_key LIKE 'qa25:%')                  AS qa25_outbox;         -- 기대 0

-- 2026-07-25 실측 baseline: notifications_total=7 · outbox_total=7 · qa25_* = 0/0


-- =============================================================================
-- §2. 학생 25건 (:qa_student_01) — 16종 · 5개 카테고리 탭 전부 커버
--     페이지 크기 10(DEFAULT_NOTIFICATIONS_PAGE_SIZE) → 25건 = 3페이지 커서 검증
-- =============================================================================

BEGIN;

-- [전제 확인] 0행이면 즉시 ROLLBACK
SELECT id, role, status FROM public.users
 WHERE id = :'qa_student_01' AND role = 'student' AND status = 'active';

-- ── 2-1. 25건 생성 (정본 producer RPC 경유 — 직접 INSERT 금지) ────────────────
--   RPC 는 (recipient_user_id, event_key) UNIQUE 로 멱등이므로 재실행해도 중복 0.
SELECT v.seq,
       public.record_domain_notification(
         :'qa_student_01'::uuid,
         v.event_key,
         v.event_key,          -- dedup_key = event_key (QA 고정)
         v.event_type,
         v.title,
         v.body,
         v.link,
         jsonb_build_object('qa_fixture', 'qa25', 'seq', v.seq),
         jsonb_build_object('qa_fixture', 'qa25', 'seq', v.seq)
       ) AS result
FROM (VALUES
  -- ── 카테고리 qna (10건 / 5종) ──────────────────────────────────────────────
  ( 1, 'qa25:qna:question_answered:01',              'question_answered',
       '멘토가 답변했어요',        '질문방에 새 답변이 등록되었습니다. (QA 01)',            '/question-room'),
  ( 2, 'qa25:qna:question_answered:02',              'question_answered',
       '멘토가 답변했어요',        '질문방에 새 답변이 등록되었습니다. (QA 02)',            '/question-room'),
  ( 3, 'qa25:qna:question_answered:03',              'question_answered',
       '멘토가 답변했어요',        '질문방에 새 답변이 등록되었습니다. (QA 03)',            '/question-room'),
  ( 4, 'qa25:qna:iq_claimed:01',                     'individual_question_claimed',
       '멘토가 질문을 맡았어요',   '개별 질문을 멘토가 맡았습니다. (QA 04)',                '/question-room'),
  ( 5, 'qa25:qna:iq_claimed:02',                     'individual_question_claimed',
       '멘토가 질문을 맡았어요',   '개별 질문을 멘토가 맡았습니다. (QA 05)',                '/question-room'),
  ( 6, 'qa25:qna:iq_answered:01',                    'individual_question_answered',
       '개별 질문 답변 완료',      '개별 질문에 답변이 등록되었습니다. (QA 06)',            '/question-room'),
  ( 7, 'qa25:qna:iq_answered:02',                    'individual_question_answered',
       '개별 질문 답변 완료',      '개별 질문에 답변이 등록되었습니다. (QA 07)',            '/question-room'),
  ( 8, 'qa25:qna:iq_released:01',                    'individual_question_released',
       '개별 질문 정산 완료',      '개별 질문 예치금이 멘토에게 지급되었습니다. (QA 08)',   '/wallet/ledger'),
  ( 9, 'qa25:qna:iq_message:01',                     'individual_question_message',
       '새 메시지가 도착했어요',   '개별 질문에 새 메시지가 있습니다. (QA 09)',             '/question-room'),
  (10, 'qa25:qna:iq_message:02',                     'individual_question_message',
       '새 메시지가 도착했어요',   '개별 질문에 새 메시지가 있습니다. (QA 10)',             '/question-room'),

  -- ── 카테고리 order (2건 / 1종) ─────────────────────────────────────────────
  (11, 'qa25:order:new_order_message:01',            'new_order_message',
       '맞춤의뢰 새 메시지',       '맞춤의뢰 주문에 새 메시지가 있습니다. (QA 11)',         '/custom-request'),
  (12, 'qa25:order:new_order_message:02',            'new_order_message',
       '맞춤의뢰 새 메시지',       '맞춤의뢰 주문에 새 메시지가 있습니다. (QA 12)',         '/custom-request'),

  -- ── 카테고리 subscription (6건 / 5종) ──────────────────────────────────────
  (13, 'qa25:sub:renewal_upcoming:01',               'subscription_renewal_upcoming',
       '구독 갱신 예정',           '3일 뒤 구독이 갱신됩니다. (QA 13)',                     '/mypage'),
  (14, 'qa25:sub:renewal_upcoming:02',               'subscription_renewal_upcoming',
       '구독 갱신 예정',           '내일 구독이 갱신됩니다. (QA 14)',                       '/mypage'),
  (15, 'qa25:sub:renewal_succeeded:01',              'subscription_renewal_succeeded',
       '구독이 갱신됐어요',        '구독 갱신 결제가 완료되었습니다. (QA 15)',              '/wallet/ledger'),
  (16, 'qa25:sub:renewal_failed_cash:01',            'subscription_renewal_failed_insufficient_cash',
       '캐시가 부족해요',          '캐시 부족으로 구독 갱신에 실패했습니다. (QA 16)',       '/wallet/charge'),
  (17, 'qa25:sub:expired:01',                        'subscription_expired',
       '구독이 만료됐어요',        '구독 기간이 만료되었습니다. (QA 17)',                   '/subscribe'),
  (18, 'qa25:sub:price_changed:01',                  'mentor_subscription_price_changed',
       '멘토 요금제가 변경됐어요', '구독 중인 멘토의 요금제가 변경되었습니다. (QA 18)',     '/mypage'),

  -- ── 카테고리 refund (3건 / 2종) ────────────────────────────────────────────
  (19, 'qa25:refund:iq_expired_refunded:01',         'individual_question_expired_refunded',
       '개별 질문 환불 완료',      '기한 만료로 예치금이 환불되었습니다. (QA 19)',          '/wallet/ledger'),
  (20, 'qa25:refund:iq_expired_refunded:02',         'individual_question_expired_refunded',
       '개별 질문 환불 완료',      '기한 만료로 예치금이 환불되었습니다. (QA 20)',          '/wallet/ledger'),
  (21, 'qa25:refund:mentor_termination_refund:01',   'mentor_termination_refund',
       '멘토 활동 종료 환불',      '멘토 활동 종료로 잔여 구독료가 환불되었습니다. (QA 21)','/wallet/ledger'),

  -- ── 카테고리 system (4건 / 3종) ────────────────────────────────────────────
  (22, 'qa25:sys:notice:01',                         'notice',
       '공지사항',                 '서비스 점검 안내입니다. (QA 22)',                       '/mypage'),
  (23, 'qa25:sys:notice:02',                         'notice',
       '공지사항',                 '이벤트 안내입니다. (QA 23)',                            '/mypage'),
  (24, 'qa25:sys:mentor_termination_notice:01',      'mentor_termination_notice',
       '멘토 활동 종료 안내',      '구독 중인 멘토가 활동을 종료합니다. (QA 24)',           '/mentors'),
  (25, 'qa25:sys:mentor_pause_notice:01',            'mentor_pause_notice',
       '멘토 휴식 안내',           '구독 중인 멘토가 휴식에 들어갑니다. (QA 25)',           '/mentors')
) AS v(seq, event_key, event_type, title, body, link)
ORDER BY v.seq;

-- ── 2-2. created_at 분산 (커서 페이지네이션 검증용) ──────────────────────────
--   RPC 는 전부 now() 로 넣으므로 25건이 동일 시각 → created_at DESC 커서가
--   동률로 뭉친다. seq 역순으로 1시간 간격을 벌려 3페이지 경계를 명확히 한다.
UPDATE public.notifications n
   SET created_at = now() - make_interval(hours => (n.metadata->>'seq')::int),
       updated_at = now()
 WHERE n.recipient_user_id = :'qa_student_01'::uuid
   AND n.event_key LIKE 'qa25:%';

-- ── 2-3. 읽음 상태 배분 (읽음 10 / 안읽음 15) ────────────────────────────────
--   '안읽음' 필터도 2페이지(15건)가 되도록 한다. seq 16~25 를 읽음 처리.
UPDATE public.notifications n
   SET is_read = true, read_at = now(), updated_at = now()
 WHERE n.recipient_user_id = :'qa_student_01'::uuid
   AND n.event_key LIKE 'qa25:%'
   AND (n.metadata->>'seq')::int BETWEEN 16 AND 25;

-- ── 2-4. outbox 처리 정책 (택 1 — 실행 세션에서 결정) ────────────────────────
--   RPC 는 outbox 행을 status='pending' 으로 만든다. 152 worker 가 돌면 25건이
--   실제 push 발송 대상이 된다.
--   (A) FCM 실수신까지 QA 한다면  → 아래 UPDATE 를 실행하지 않는다(pending 유지).
--   (B) 인앱 허브만 QA 한다면     → 아래 UPDATE 로 발송을 봉인한다(권장 기본값).
UPDATE public.notification_outbox o
   SET status = 'sent', updated_at = now()
 WHERE o.recipient_user_id = :'qa_student_01'::uuid
   AND o.dedup_key LIKE 'qa25:%'
   AND o.status = 'pending';

-- ⚠️ 여기서 §5 검증 SELECT 를 실행해 기대치와 일치하는지 확인한 뒤 COMMIT.
COMMIT;   -- 불일치 시 ROLLBACK;


-- =============================================================================
-- §3. 멘토 2건 (:qa_mentor_01) — 학생에게 갈 수 없는 멘토 수신 전용 2종
--     이 블록까지 실행해야 정본 18종 커버리지가 18/18 이 된다.
-- =============================================================================

BEGIN;

-- [전제 확인] 0행이면 즉시 ROLLBACK
SELECT u.id, u.role, mp.verification_status
  FROM public.users u
  JOIN public.mentor_profiles mp ON mp.user_id = u.id
 WHERE u.id = :'qa_mentor_01' AND u.role = 'mentor' AND u.status = 'active';

SELECT v.seq,
       public.record_domain_notification(
         :'qa_mentor_01'::uuid, v.event_key, v.event_key, v.event_type,
         v.title, v.body, v.link,
         jsonb_build_object('qa_fixture', 'qa25', 'seq', v.seq),
         jsonb_build_object('qa_fixture', 'qa25', 'seq', v.seq)
       ) AS result
FROM (VALUES
  (26, 'qa25:mentor:iq_assigned:01',      'individual_question_assigned',
       '새 개별 질문이 배정됐어요', '지정 개별 질문이 도착했습니다. (QA 26)',   '/mentor/question-room'),
  (27, 'qa25:mentor:new_application:01',  'new_application',
       '맞춤의뢰 새 지원',          '맞춤의뢰에 새 지원이 있습니다. (QA 27)',   '/mentor/custom-request/dashboard')
) AS v(seq, event_key, event_type, title, body, link)
ORDER BY v.seq;

UPDATE public.notification_outbox o
   SET status = 'sent', updated_at = now()
 WHERE o.recipient_user_id = :'qa_mentor_01'::uuid
   AND o.dedup_key LIKE 'qa25:%'
   AND o.status = 'pending';

COMMIT;   -- 불일치 시 ROLLBACK;


-- =============================================================================
-- §4. ROLLBACK — baseline 복원
--     'qa25:' prefix 만 지우므로 기존 7행(실기 도메인 이벤트)은 보존된다.
--     outbox 를 먼저 지운다(notification_id FK 참조 순서).
-- =============================================================================

-- 4-A. 트랜잭션이 아직 열려 있는 경우
ROLLBACK;

-- 4-B. 이미 COMMIT 된 뒤 되돌리는 경우 (아래 전체를 한 트랜잭션으로)
BEGIN;

DELETE FROM public.notification_outbox
 WHERE dedup_key LIKE 'qa25:%';

DELETE FROM public.notifications
 WHERE event_key LIKE 'qa25:%';

-- 복원 검증 — 아래 3값이 전부 baseline(§1)과 같아야 한다
SELECT 'after_rollback' AS phase,
       (SELECT count(*) FROM public.notifications)       AS notifications_total,  -- 기대 7
       (SELECT count(*) FROM public.notification_outbox) AS outbox_total,         -- 기대 7
       (SELECT count(*) FROM public.notifications
         WHERE event_key LIKE 'qa25:%')                  AS qa25_left;            -- 기대 0

COMMIT;   -- 값이 다르면 ROLLBACK;


-- =============================================================================
-- §5. 실행 후 검증 SELECT (전부 SELECT 전용)
-- =============================================================================

-- 5-1. 총량 — 학생 25 / 멘토 2 / 중복 0
SELECT (SELECT count(*) FROM public.notifications
         WHERE recipient_user_id = :'qa_student_01'::uuid AND event_key LIKE 'qa25:%') AS student_rows,   -- 기대 25
       (SELECT count(*) FROM public.notifications
         WHERE recipient_user_id = :'qa_mentor_01'::uuid  AND event_key LIKE 'qa25:%') AS mentor_rows,    -- 기대 2
       (SELECT count(*) FROM public.notification_outbox
         WHERE dedup_key LIKE 'qa25:%')                                                AS outbox_rows;   -- 기대 27

-- 5-2. 멱등성 — (recipient, event_key) 중복 0 이어야 한다
SELECT count(*) AS dup_groups FROM (
  SELECT recipient_user_id, event_key
    FROM public.notifications
   WHERE event_key LIKE 'qa25:%'
   GROUP BY 1,2 HAVING count(*) > 1
) d;   -- 기대 0

-- 5-3. 카테고리 탭별 분포 (정본 allowlist 대조)
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
       END AS category,
       count(*) AS cnt
FROM public.notifications
WHERE event_key LIKE 'qa25:%'
GROUP BY 1 ORDER BY 1;
-- 기대: qna 11(학생10+멘토1) · order 3(학생2+멘토1) · subscription 6 · refund 3 · system 4
--       '(uncategorized)' 0  ← 0 이 아니면 allowlist 미등록 type 이 섞인 것

-- 5-4. 읽음/안읽음 배분
SELECT count(*) FILTER (WHERE is_read)     AS read_cnt,     -- 기대 10
       count(*) FILTER (WHERE NOT is_read) AS unread_cnt    -- 기대 15
FROM public.notifications
WHERE recipient_user_id = :'qa_student_01'::uuid AND event_key LIKE 'qa25:%';

-- 5-5. 유형 커버리지 — 정본 18종 중 몇 종이 존재하는가
SELECT count(DISTINCT type) AS distinct_types   -- 기대 18
FROM public.notifications
WHERE type IN ('question_answered','individual_question_assigned','individual_question_claimed',
               'individual_question_answered','individual_question_message','individual_question_released',
               'new_order_message','new_application',
               'subscription_expired','subscription_renewal_succeeded',
               'subscription_renewal_failed_insufficient_cash','subscription_renewal_upcoming',
               'mentor_subscription_price_changed',
               'individual_question_expired_refunded','mentor_termination_refund',
               'notice','mentor_termination_notice','mentor_pause_notice');

-- 5-6. created_at 분산 확인 (커서 3페이지 경계)
SELECT count(DISTINCT created_at) AS distinct_created_at   -- 기대 25
FROM public.notifications
WHERE recipient_user_id = :'qa_student_01'::uuid AND event_key LIKE 'qa25:%';

-- 5-7. 원장·도메인 무영향 확인 (이 fixture 가 건드리면 안 되는 테이블)
SELECT (SELECT count(*) FROM public.cash_ledger)                        AS cash_ledger_rows,    -- 기대 6 (불변)
       (SELECT count(*) FROM public.individual_question_attachments)    AS iq_attachment_rows,  -- 기대 1 (불변)
       (SELECT count(*) FROM public.subscriptions)                      AS subscription_rows;   -- 기대 1 (불변)
