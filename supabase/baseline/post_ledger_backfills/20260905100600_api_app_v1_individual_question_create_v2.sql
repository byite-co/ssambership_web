-- =============================================================================
-- 204_api_app_v1_individual_question_create_v2.sql  (2026-09-05 · DB-4 묶음 F — 개별질문 과목 인자)
--
-- 왜: 앱이 부르는 `public.create_individual_question_as_student`(092)는 과목을 받지 않고 코어 `create_individual_question_with_hold_v2` 에
--   p_subject NULL 을 고정 전달한다. `individual_questions` 에 본인 UPDATE 정책도 없어(iq_select_party SELECT 뿐) 등록 뒤에도 못 채운다
--   (A-4a 보고서 §6 · 판정표 §5-3). 공개형 질문은 멘토가 과목으로 거르므로 과목 없는 등록은 라우팅되지 않는다.
--   기존 함수는 바꾸지 않는다(웹·구 앱이 쓴다 — "하지 말 것" 2). `_v2` 를 `api_app_v1` 에 만들어 `p_subject` 를 더한다(나머지 시그니처·반환·오류 규약 동일).
--
-- F-1 api_app_v1.create_individual_question_as_student_v2(p_question_type text, p_title text, p_body text, p_amount_cents int default null,
--        p_designated_mentor_id uuid default null, p_idempotency_key text default null, p_subject text default null) returns setof public.individual_questions
--   · v1 과 동일: AUTH_REQUIRED(28000) · INVALID_INPUT(22023 — type/title/body/amount/designated) · MENTOR_PRICE_NOT_SET(P0001) · 코어 실패
--     INDIVIDUAL_QUESTION_CREATE_FAILED:<code>:<message>(P0001 — 잔액 부족 = CASH_INSUFFICIENT · 멘토 미승인 = mentor_not_approved 등) · 직접 가격은
--     `mentor_individual_question_pricing`(앱 표시가와 같은 소스) · 앱이 키를 안 보내면 랜덤 키(코어 NOT NULL 충족용 — 진짜 멱등은 앱이 안정 키를 보내야 한다 · 092 주석 승계)
--   · 추가: p_subject 는 코드 정본 `public.subjects.code`(074 — lib/subjects/subjectCatalog.ts 와 동일 집합) 실존 값만 — 아니면 INVALID_SUBJECT(22023) ·
--     **open(공개형)은 과목 필수**(SUBJECT_REQUIRED 22023 — 라우팅 전제) · direct(지정형)는 선택(NULL 허용 · 웹 지정형과 동일).
--   · 자금·자격 판정은 전부 코어 v2(service_role 전용)에 위임 — 이 래퍼는 가격 조회·키 생성·과목 검증만(092 와 같은 얇은 껍데기 · 금액 계산 0).
--   · 만료(expires_at)는 v1 과 같이 설정하지 않는다(웹은 서버 액션이 env 기반 시간으로 best-effort 설정 — 앱 트랙 별도 · 보고서 기재).
-- 권한: REVOKE public·anon · GRANT authenticated 만(v1 과 동일). 앱은 A-4b 에서 `api_app_v1` 스키마의 `_v2` 로 전환한다.
--
-- Apply: 저장소 표준 경로(db-apply-pending). pack 등재: supabase/baseline/post_ledger_backfills/20260905100600_api_app_v1_individual_question_create_v2.sql
-- Rollback: supabase/rollback/20260905100600_api_app_v1_individual_question_create_v2_rollback.sql
-- =============================================================================

begin;

do $$
begin
  if not exists (select 1 from pg_namespace where nspname = 'api_app_v1') then
    raise exception '204_GATE: api_app_v1 스키마 부재';
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'create_individual_question_as_student'
                    and pg_get_function_identity_arguments(p.oid) = 'p_question_type text, p_title text, p_body text, p_amount_cents integer, p_designated_mentor_id uuid, p_idempotency_key text') then
    raise exception '204_GATE: v1 create_individual_question_as_student identity 불일치(092) — 그대로 둬야 한다';
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'create_individual_question_with_hold_v2'
                    and pg_get_function_identity_arguments(p.oid) = 'p_student_id uuid, p_question_type text, p_mentor_id uuid, p_subject text, p_topic text, p_title text, p_body text, p_price_cents integer, p_idempotency_key text, p_required_school_tier text, p_required_major_category text') then
    raise exception '204_GATE: 코어 create_individual_question_with_hold_v2 identity 불일치(080_c)';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'individual_questions' and column_name = 'subject') then
    raise exception '204_GATE: individual_questions.subject 부재(070)';
  end if;
  if not exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'subjects')
     or not exists (select 1 from public.subjects where code = 'math_calculus') then
    raise exception '204_GATE: subjects 정본(074 소분류) 부재';
  end if;
  if not exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'mentor_individual_question_pricing') then
    raise exception '204_GATE: mentor_individual_question_pricing 부재(094)';
  end if;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'api_app_v1' and p.proname = 'create_individual_question_as_student_v2') then
    raise exception '204_GATE: 대상 함수가 이미 있다';
  end if;
end $$;

create function api_app_v1.create_individual_question_as_student_v2(
  p_question_type text,
  p_title text,
  p_body text,
  p_amount_cents int default null,
  p_designated_mentor_id uuid default null,
  p_idempotency_key text default null,
  p_subject text default null
)
returns setof public.individual_questions
language plpgsql
security definer
set search_path to ''
as $fn$
declare
  v_uid uuid := (select auth.uid());
  v_type text := lower(btrim(coalesce(p_question_type, '')));
  v_idem text := nullif(btrim(coalesce(p_idempotency_key, '')), '');
  v_subject text := nullif(btrim(coalesce(p_subject, '')), '');
  v_price int;
  v_res public.individual_question_escrow_result;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;

  if v_type not in ('direct', 'open') then
    raise exception 'INVALID_INPUT: question_type must be direct or open' using errcode = '22023';
  end if;

  if char_length(btrim(coalesce(p_title, ''))) = 0 or char_length(btrim(coalesce(p_body, ''))) = 0 then
    raise exception 'INVALID_INPUT: title and body are required' using errcode = '22023';
  end if;

  -- 과목: 코드 정본(subjects.code) 실존 값만 · 공개형은 필수(멘토 라우팅 전제) · 지정형은 선택
  if v_subject is not null and not exists (select 1 from public.subjects s where s.code = v_subject) then
    raise exception 'INVALID_SUBJECT' using errcode = '22023';
  end if;
  if v_type = 'open' and v_subject is null then
    raise exception 'SUBJECT_REQUIRED' using errcode = '22023';
  end if;

  -- 가격 결정(v1 동일): open 은 앱이 보낸 금액, direct 는 멘토 가격표에서 조회 — 임의 계산 없음
  if v_type = 'direct' then
    if p_designated_mentor_id is null then
      raise exception 'INVALID_INPUT: designated_mentor_id is required for direct' using errcode = '22023';
    end if;
    select mp.amount_cents into v_price from public.mentor_individual_question_pricing mp where mp.mentor_id = p_designated_mentor_id;
    if v_price is null then
      raise exception 'MENTOR_PRICE_NOT_SET' using errcode = 'P0001';
    end if;
  else
    v_price := p_amount_cents;
    if v_price is null or v_price <= 0 then
      raise exception 'INVALID_INPUT: amount_cents must be positive for open' using errcode = '22023';
    end if;
  end if;

  -- 멱등성 키: 앱이 안 보내면 랜덤 생성(코어 NOT NULL 충족용 — v1 동일)
  if v_idem is null then
    v_idem := 'iqc:' || gen_random_uuid()::text;
  end if;

  -- 코어 v2(service_role 전용)에 위임 — 자격 파라미터는 v1 과 같이 NULL
  v_res := public.create_individual_question_with_hold_v2(
    v_uid, v_type, p_designated_mentor_id, v_subject, null, p_title, p_body, v_price, v_idem, null, null);

  if not v_res.ok then
    raise exception 'INDIVIDUAL_QUESTION_CREATE_FAILED:%:%', v_res.code, v_res.message using errcode = 'P0001';
  end if;

  return query select q.* from public.individual_questions q where q.id = v_res.question_id;
end
$fn$;

comment on function api_app_v1.create_individual_question_as_student_v2(text, text, text, int, uuid, text, text) is
  '204(DB-4 F-1): create_individual_question_as_student(092) + p_subject(subjects.code 정본 · open 필수 · direct 선택). 나머지 시그니처·반환·오류 규약 v1 동일. 자금·자격은 코어 v2 위임. v1 은 그대로.';

revoke all on function api_app_v1.create_individual_question_as_student_v2(text, text, text, int, uuid, text, text) from public, anon;
grant execute on function api_app_v1.create_individual_question_as_student_v2(text, text, text, int, uuid, text, text) to authenticated;

do $$
declare v_oid oid;
begin
  select p.oid into v_oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'api_app_v1' and p.proname = 'create_individual_question_as_student_v2'
     and pg_get_function_identity_arguments(p.oid) = 'p_question_type text, p_title text, p_body text, p_amount_cents integer, p_designated_mentor_id uuid, p_idempotency_key text, p_subject text'
     and p.prosecdef and coalesce(p.proconfig::text, '') like '%search_path=%' and p.proretset;
  if v_oid is null then
    raise exception '204_SELFCHECK: identity/attributes 불일치';
  end if;
  if has_function_privilege('anon', v_oid, 'EXECUTE') or not has_function_privilege('authenticated', v_oid, 'EXECUTE')
     or has_function_privilege('service_role', v_oid, 'EXECUTE') then
    raise exception '204_SELFCHECK: ACL 불일치(authenticated 만)';
  end if;
  if (select prosrc from pg_proc where oid = v_oid) not like '%public.create_individual_question_with_hold_v2(%'
     or (select prosrc from pg_proc where oid = v_oid) like '%insert into public.cash_ledger%' then
    raise exception '204_SELFCHECK: 코어 위임 아님 또는 자금 로직 복제';
  end if;
  -- v1 불변(identity·ACL)
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'create_individual_question_as_student'
                    and has_function_privilege('authenticated', p.oid, 'EXECUTE')
                    and not has_function_privilege('anon', p.oid, 'EXECUTE')) then
    raise exception '204_SELFCHECK: v1 ACL 변경됨';
  end if;
end $$;

commit;
