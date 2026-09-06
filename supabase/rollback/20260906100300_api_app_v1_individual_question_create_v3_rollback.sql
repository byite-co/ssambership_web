-- =============================================================================
-- 20260906100300_api_app_v1_individual_question_create_v3_rollback.sql  (DB-5 묶음 D + 후속 b 롤백)
-- =============================================================================
-- forward: supabase/sql/207_api_app_v1_individual_question_create_v3.sql
-- 되돌리는 것: api_app_v1.create_individual_question_as_student_v3(...) DROP → api_app_v1.create_individual_question_as_student_v2(...) 를 204 라이브 원문
--   (md5 aa8c27d2dcaa1c9cbfe5ae852f1c2dcc · 계정 차단 검사 없음 = 회귀 · 오너 승인 후에만)으로 복원 → core_private.account_blocked_state(uuid) DROP.
--   v1(public)·코어 v2·카탈로그·CHECK 는 forward 가 만지지 않았다.
-- 데이터: forward 기간에 v2/v3 로 만든 개별질문(topic·자격 조건 포함)·에스크로 홀드는 그대로 남는다(코어·정산 경로 불변).
-- =============================================================================

begin;

drop function if exists api_app_v1.create_individual_question_as_student_v3(text, text, text, int, uuid, text, text, text, text, text);

-- v2 204 원문 복원 (라이브 pg_get_functiondef 원문 · md5 aa8c27d2dcaa1c9cbfe5ae852f1c2dcc)
CREATE OR REPLACE FUNCTION api_app_v1.create_individual_question_as_student_v2(p_question_type text, p_title text, p_body text, p_amount_cents integer DEFAULT NULL::integer, p_designated_mentor_id uuid DEFAULT NULL::uuid, p_idempotency_key text DEFAULT NULL::text, p_subject text DEFAULT NULL::text)
 RETURNS SETOF individual_questions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;
comment on function api_app_v1.create_individual_question_as_student_v2(text, text, text, int, uuid, text, text) is
  '204(DB-4 F-1): create_individual_question_as_student(092) + p_subject(subjects.code 정본 · open 필수 · direct 선택). 나머지 시그니처·반환·오류 규약 v1 동일. 자금·자격은 코어 v2 위임. v1 은 그대로.';

drop function if exists core_private.account_blocked_state(uuid);

do $$
begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'api_app_v1' and p.proname = 'create_individual_question_as_student_v3') then
    raise exception '207_ROLLBACK_SELFCHECK: v3 잔존';
  end if;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'core_private' and p.proname = 'account_blocked_state') then
    raise exception '207_ROLLBACK_SELFCHECK: account_blocked_state 잔존';
  end if;
  if md5(pg_get_functiondef('api_app_v1.create_individual_question_as_student_v2(text,text,text,int,uuid,text,text)'::regprocedure)) <> 'aa8c27d2dcaa1c9cbfe5ae852f1c2dcc' then
    raise exception '207_ROLLBACK_SELFCHECK: v2 원문 불일치 — 현재 %', md5(pg_get_functiondef('api_app_v1.create_individual_question_as_student_v2(text,text,text,int,uuid,text,text)'::regprocedure));
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'api_app_v1' and p.proname = 'create_individual_question_as_student_v2'
                   and has_function_privilege('authenticated', p.oid, 'EXECUTE') and not has_function_privilege('anon', p.oid, 'EXECUTE') and not has_function_privilege('service_role', p.oid, 'EXECUTE')) then
    raise exception '207_ROLLBACK_SELFCHECK: v2 ACL 변경됨';
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'create_individual_question_as_student') then
    raise exception '207_ROLLBACK_SELFCHECK: v1 소실(이 롤백은 건드리지 않는다)';
  end if;
end $$;

commit;
