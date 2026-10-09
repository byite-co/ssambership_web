-- =============================================================================
-- 20260808030000_iq_attachment_author_backfill.sql (F1 backfill)
-- =============================================================================
-- individual_question_attachments.author_id NULL 행의 작성자 backfill.
--
-- 배경: 웹 IQ 첨부 경로는 service-role 클라이언트로 INSERT 하면서 author_id 를
-- 기록하지 않아 attribution NULL 행이 발생했다(코드 수정: 웹
-- lib/individualQuestion/individualQuestionAttachmentStorage.ts — authorId 명시 전달).
-- 이 migration 은 "권위 있는 관계에서 작성자가 유일하게 판별되는 행"만 채운다.
--
-- 판별 규칙(둘 다 FK 단일 조인 — 파생이 유일함이 구조적으로 보장):
--   ① message 첨부:  a.message_id → individual_question_messages.author_id
--   ② 최초 질문 첨부: a.message_id IS NULL → a.question_id → individual_questions.student_id
--      (멘토 id 는 절대 쓰지 않는다 — 최초 첨부는 질문자(학생) 소유가 정본)
-- 파생 결과가 NULL 인 행은 건드리지 않는다(별도 보고 대상).
--
-- 멱등: author_id IS NULL 조건이 재실행을 no-op 으로 만든다.
-- 기존 값 보존: author_id 가 이미 있는 행은 어떤 경우에도 갱신하지 않는다.
-- account deletion 영향 없음: 삭제 수집기는 author_id 가 아니라 관계 추적
-- (message author / question student)으로 동작한다 — 이 backfill 과 독립.
-- =============================================================================

begin;

DO $$
DECLARE
  v_null_before integer;
  v_msg_updated integer;
  v_initial_updated integer;
  v_null_after integer;
BEGIN
  IF to_regclass('public.individual_question_attachments') IS NULL THEN
    RAISE EXCEPTION 'IQ_ATTACH_BACKFILL_ABORT: public.individual_question_attachments not found';
  END IF;

  SELECT count(*) INTO v_null_before
    FROM public.individual_question_attachments WHERE author_id IS NULL;

  -- ① message 첨부: 연결 메시지 작성자로 귀속
  UPDATE public.individual_question_attachments a
     SET author_id = m.author_id
    FROM public.individual_question_messages m
   WHERE a.author_id IS NULL
     AND a.message_id IS NOT NULL
     AND m.id = a.message_id
     AND m.author_id IS NOT NULL;
  GET DIAGNOSTICS v_msg_updated = ROW_COUNT;

  -- ② 최초 질문 첨부(message 미연결): 질문자(학생)로 귀속
  UPDATE public.individual_question_attachments a
     SET author_id = q.student_id
    FROM public.individual_questions q
   WHERE a.author_id IS NULL
     AND a.message_id IS NULL
     AND q.id = a.question_id
     AND q.student_id IS NOT NULL;
  GET DIAGNOSTICS v_initial_updated = ROW_COUNT;

  SELECT count(*) INTO v_null_after
    FROM public.individual_question_attachments WHERE author_id IS NULL;

  RAISE NOTICE 'IQ_ATTACH_BACKFILL: null_before=% msg_backfilled=% initial_backfilled=% null_after=%',
    v_null_before, v_msg_updated, v_initial_updated, v_null_after;
END $$;

commit;
