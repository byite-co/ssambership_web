-- 167_iq_attachment_unique_question_storage_path.sql
-- individual_question_attachments (question_id, storage_path) UNIQUE 제약 신설 —
-- 168 등록 RPC 멱등 계약의 arbiter(중복 판정 기준) 를 DB 에 확정한다.
--
-- ⚠️ 이 파일은 웨이브 1(트랙 3)에서 **초안으로만** 작성되었다. staging 미적용.
--    적용은 후속 웨이브(W3)의 순차 적용 세션에서 docs/sql/wave1-iq-contract-plan.md 의
--    6단계 절차(preflight → rollback-only 재현 → 적용 → fixture → baseline 복원 → manifest)를
--    따라 수행한다.
--
-- 배경(2026-07-25 staging `lbeqxarxothkmzqvpudy` read-only 실조회):
--   - 제약 실태: pg_constraint 는 pkey(id) + FK 2건(question_id→individual_questions ON DELETE
--     CASCADE, message_id→individual_question_messages ON DELETE SET NULL) 뿐. UNIQUE **없음**.
--   - 인덱스 실태: pg_indexes 는 individual_question_attachments_pkey(UNIQUE, id),
--     idx_iqa_question_created(question_id, created_at DESC), idx_iqa_message(message_id).
--     → (question_id, storage_path) 를 커버하는 UNIQUE 인덱스도 **없음**.
--       (UNIQUE 가 constraint 없이 index 로만 존재하는 경우가 있어 양쪽을 모두 조회했다.)
--   - 중복 실태: 전체 1행 · (question_id, storage_path) 중복 조합 0건 · 중복에 걸린 행 0건 ·
--     storage_path 단독 중복 0건. → 정리 작업 없이 **직접 생성 가능**.
--   - 손상 행 실태: question_id NULL 0 · storage_path NULL 0 · 공백 0 · 미trim 0 ·
--     question FK 고아 0. (question_id 는 NOT NULL uuid 라 NULL·빈 문자열이 스키마상 불가.
--     v19·v20 클라이언트가 AMBIGUOUS 로 처리하는 대상은 서버 실태 기준 0건이다.)
--
-- 조치: (question_id, storage_path) UNIQUE constraint 1건 추가. 그 외 일절 불변.
--   - constraint 형태를 택한 이유: 168 이 `ON CONFLICT (question_id, storage_path)` 컬럼 추론과
--     `ON CONFLICT ON CONSTRAINT` 양쪽을 모두 쓸 수 있고, 제약 위반 시 conname 이 오류에 실려
--     호출자·픽스처가 원인을 특정할 수 있기 때문이다.
--   - 대상 테이블은 실측 1행이라 ADD CONSTRAINT 의 ACCESS EXCLUSIVE 락 구간이 사실상 0 이다.
--     (대량 테이블이었다면 CREATE UNIQUE INDEX CONCURRENTLY → ADD CONSTRAINT ... USING INDEX
--      2단계가 필요했을 것 — 현 실태에서는 불필요.)
--
-- 알려진 한계(168 에서 보완):
--   현행 RPC 는 빈 문자열 검사에만 btrim 을 쓰고 **저장은 원문 그대로** 한다. 따라서
--   'uuid/a.png' 와 'uuid/a.png ' 는 이 UNIQUE 로 접히지 않는다. 실측 미trim 행 0건이라
--   지금 당장의 오염은 없고, 168 이 저장 직전 btrim 을 도입해 유입 자체를 막는다.
--   (정규화를 표현식 인덱스로 강제하지 않는 이유: 앱·픽스처가 조회에 쓰는 경로 문자열과
--    저장 문자열이 달라지는 부작용을 피하고, 정본을 RPC 한 곳에 두기 위함이다.)
--
-- 선행: 070(individual_question 스키마), 117(첨부 v2). 후속: 168(이 제약을 arbiter 로 사용).
-- 적용 보류 조건: 아래 §0 검증에서 중복 1건이라도 발견되면 **중단**한다. 이 스크립트는
--   중복을 자동 정리하지 않는다(오염 행 자동 수정 금지 규율 — 처리 옵션은 plan 문서 §5 참조).

begin;
set local lock_timeout = '5s';

-- ── 0. 사전 검증: 중복 0건 재확인(적용 시점 실태 기준). 1건이라도 있으면 트랜잭션 중단 ──
do $$
declare
  v_dup_combos integer;
  v_dup_rows   integer;
begin
  select count(*), coalesce(sum(c), 0)
    into v_dup_combos, v_dup_rows
  from (
    select count(*) as c
    from public.individual_question_attachments
    group by question_id, storage_path
    having count(*) > 1
  ) d;

  if v_dup_combos > 0 then
    raise exception
      'ABORT_167: (question_id, storage_path) 중복 조합 %건 / 관련 행 %건 — UNIQUE 생성 불가. 자동 정리 금지, 오너·판정자 결정 필요(plan 문서 §5).',
      v_dup_combos, v_dup_rows;
  end if;

  raise notice '167 preflight OK: 중복 조합 0건 (총 %행)',
    (select count(*) from public.individual_question_attachments);
end $$;

-- ── 1. UNIQUE 제약 생성(멱등 — 이미 있으면 건너뜀) ──
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conrelid = 'public.individual_question_attachments'::regclass
      and conname = 'uq_iqa_question_storage_path'
  ) then
    raise notice '167: uq_iqa_question_storage_path 이미 존재 — 생성 건너뜀(무수정).';
  else
    alter table public.individual_question_attachments
      add constraint uq_iqa_question_storage_path unique (question_id, storage_path);
    raise notice '167: uq_iqa_question_storage_path 생성 완료.';
  end if;
end $$;

commit;

-- ── §V 검증 SELECT (적용 후 별도 실행 — DDL 과 분리) ──
-- select conname, pg_get_constraintdef(oid)
--   from pg_constraint
--  where conrelid = 'public.individual_question_attachments'::regclass and contype = 'u';
-- 기대: uq_iqa_question_storage_path | UNIQUE (question_id, storage_path)
--
-- select indexname, indexdef from pg_indexes
--  where schemaname='public' and tablename='individual_question_attachments';
-- 기대: 기존 3건 + uq_iqa_question_storage_path (백킹 인덱스) = 4건
--
-- ── ROLLBACK 절차 ──
-- 이 스크립트는 추가형이며 기존 행·정책·함수를 변경하지 않으므로 되돌림이 무손실이다.
--   alter table public.individual_question_attachments
--     drop constraint if exists uq_iqa_question_storage_path;
-- 주의: 168 을 적용한 상태에서 167 만 되돌리면 168 의 ON CONFLICT 가 arbiter 부재로
--   런타임 오류(42P10)를 낸다. 되돌릴 때는 반드시 **168 → 167 역순**으로 되돌린다.
