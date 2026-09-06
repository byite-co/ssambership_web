-- =============================================================================
-- 207_api_app_v1_individual_question_create_v3.sql  (2026-09-06 · DB-5 묶음 D — 개별질문 v3 래퍼: 단원·개념 + 자격 조건)
--
-- 왜: 앱 A-4c 전수 대조가 찾은 유일한 서버 선행 항목. 공개형 질문의 단원·개념(`topic`)과 자격 조건(학교군·전공계열)을 웹은
--   `create_individual_question_with_hold_v2`(service_role 전용 코어)에 직접 넣지만, 앱이 부르는 204 v2 래퍼는 `p_subject` 까지만 받아
--   코어에 NULL 을 고정 전달한다. `individual_questions` 에 본인 UPDATE 정책도 없어 등록 뒤 보정도 못 한다.
--   v1(092 public)·v2(204 api_app_v1)는 그대로 둔다(웹·구 앱이 쓴다 — "하지 말 것" 2). `_v3` 는 **v2 본문을 그대로 복제**한 뒤 인자 3개만 더한다.
--
-- D-1 api_app_v1.create_individual_question_as_student_v3(
--        p_question_type text, p_title text, p_body text, p_amount_cents int default null, p_designated_mentor_id uuid default null,
--        p_idempotency_key text default null, p_subject text default null,
--        p_topic text default null, p_required_school_tier text default null, p_required_major_category text default null)
--      returns setof public.individual_questions
--   · v2 와 동일(복제): AUTH_REQUIRED(28000) · INVALID_INPUT(22023) · INVALID_SUBJECT · SUBJECT_REQUIRED(open 필수) · MENTOR_PRICE_NOT_SET(P0001) ·
--     코어 실패 INDIVIDUAL_QUESTION_CREATE_FAILED:<code>:<message>(P0001 — 학생 아님 invalid_student · 잔액 부족 CASH_INSUFFICIENT · 멘토 미승인 등) ·
--     가격 결정(direct 는 `mentor_individual_question_pricing`, open 은 앱 금액) · 키 미전달 시 랜덤 키 · 자금·자격 판정은 코어 v2 위임(자금 로직 복제 0).
--     v2 가 거부하는 계정 상태(auth.uid() 없음 · 학생 아님 · 탈퇴 잠금 = adg 지갑·원장 트리거)는 v3 도 같은 경로로 똑같이 거부한다.
--   · 추가: p_topic — 단원·개념 자유 텍스트(trim · 빈 값 NULL · 200자 초과 TOPIC_TOO_LONG 22023) · direct/open 모두 허용(웹 지정형과 동일).
--   · 추가: p_required_school_tier / p_required_major_category — **open(공개형)에만** 의미가 있다. 지정형(designated_mentor_id 있음)은 이미 멘토가 정해졌으므로
--     값을 무시하고 NULL 로 넘긴다(검증도 하지 않는다). 공개형은 DB 정본으로 검증:
--       학교군  = `school_tier_catalog`(079_b · is_active) ∩ `individual_questions_required_school_tier_check` 목록 − **'미분류'**(자격 조건으로 못 쓴다) → 아니면 INVALID_TIER(22023)
--       전공계열 = `major_category_catalog`(079_b · is_active) ∩ `individual_questions_required_major_category_check` 목록 → 아니면 INVALID_MAJOR(22023)
--     둘 다 선택(NULL = 조건 없음). 코어 v2 의 CHECK 목록 검사는 그 뒤에 한 번 더 걸린다(이중 방어).
-- 권한: REVOKE public·anon · GRANT authenticated 만(204 와 동일 · service_role 0). 앱은 A-4c 에서 `_v3` 로 전환한다(v2 는 남는다).
--
-- Apply: 저장소 표준 경로(db-apply-pending). pack 등재: supabase/baseline/post_ledger_backfills/20260906100300_api_app_v1_individual_question_create_v3.sql
-- Rollback: supabase/rollback/20260906100300_api_app_v1_individual_question_create_v3_rollback.sql
-- =============================================================================

begin;

do $$
declare v_def text;
begin
  if not exists (select 1 from pg_namespace where nspname = 'api_app_v1') then
    raise exception '207_GATE: api_app_v1 스키마 부재';
  end if;
  -- v2(204) 본문이 복제 원본과 같은지(md5) — 다르면 이 파일의 복제본이 v2 와 어긋난 것이므로 중단
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'api_app_v1' and p.proname = 'create_individual_question_as_student_v2'
     and pg_get_function_identity_arguments(p.oid) = 'p_question_type text, p_title text, p_body text, p_amount_cents integer, p_designated_mentor_id uuid, p_idempotency_key text, p_subject text';
  if v_def is null then
    raise exception '207_GATE: v2 create_individual_question_as_student_v2 identity 불일치(204) — 그대로 둬야 한다';
  end if;
  if md5(v_def) <> 'aa8c27d2dcaa1c9cbfe5ae852f1c2dcc' then
    raise exception '207_GATE: v2 본문 md5 불일치(복제 원본 204 · 2026-09-06 운영 실측 aa8c27d2…) — 현재 %', md5(v_def);
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'create_individual_question_with_hold_v2'
                    and pg_get_function_identity_arguments(p.oid) = 'p_student_id uuid, p_question_type text, p_mentor_id uuid, p_subject text, p_topic text, p_title text, p_body text, p_price_cents integer, p_idempotency_key text, p_required_school_tier text, p_required_major_category text') then
    raise exception '207_GATE: 코어 create_individual_question_with_hold_v2 identity 불일치(080_c)';
  end if;
  if (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'individual_questions'
       and column_name in ('subject', 'topic', 'required_school_tier', 'required_major_category')) <> 4 then
    raise exception '207_GATE: individual_questions 컬럼(subject·topic·required_*) 부재(070·080_c)';
  end if;
  -- CHECK 목록 정본(080_c) 과 카탈로그(079_b) 전제 — 목록이 바뀌면 이 래퍼의 판정 근거가 달라지므로 중단
  if (select pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.individual_questions'::regclass and conname = 'individual_questions_required_school_tier_check')
       not like '%''서연고''%''서성한''%''중경외시''%''건동홍''%''그외''%''미분류''%' then
    raise exception '207_GATE: required_school_tier CHECK 목록 불일치(080_c)';
  end if;
  if (select pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.individual_questions'::regclass and conname = 'individual_questions_required_major_category_check')
       not like '%''메디컬''%''교육''%''인문''%''사회상경''%''자연''%''공학''%''예체능''%''기타''%' then
    raise exception '207_GATE: required_major_category CHECK 목록 불일치(080_c)';
  end if;
  if not exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'school_tier_catalog')
     or not exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'major_category_catalog') then
    raise exception '207_GATE: 분류 카탈로그(school_tier_catalog · major_category_catalog · 079_b) 부재';
  end if;
  if not exists (select 1 from public.school_tier_catalog where code = '서연고' and is_active)
     or not exists (select 1 from public.major_category_catalog where code = '공학' and is_active) then
    raise exception '207_GATE: 분류 카탈로그 행 부재';
  end if;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'api_app_v1' and p.proname = 'create_individual_question_as_student_v3') then
    raise exception '207_GATE: 대상 함수가 이미 있다';
  end if;
end $$;

create function api_app_v1.create_individual_question_as_student_v3(
  p_question_type text,
  p_title text,
  p_body text,
  p_amount_cents int default null,
  p_designated_mentor_id uuid default null,
  p_idempotency_key text default null,
  p_subject text default null,
  p_topic text default null,
  p_required_school_tier text default null,
  p_required_major_category text default null
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
  v_topic text := nullif(btrim(coalesce(p_topic, '')), '');
  v_tier text := nullif(btrim(coalesce(p_required_school_tier, '')), '');
  v_major text := nullif(btrim(coalesce(p_required_major_category, '')), '');
  v_price int;
  v_res public.individual_question_escrow_result;
begin
  -- ── 이하 v2(204) 본문 복제 — 권한·상태·과목·가격·키 검사 동일 ──
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
  -- ── v2 복제 끝 ──

  -- v3 추가 ①: 단원·개념 — 자유 텍스트(웹 지정형·공개형 모두 허용) · 200자 상한
  if v_topic is not null and char_length(v_topic) > 200 then
    raise exception 'TOPIC_TOO_LONG' using errcode = '22023';
  end if;

  -- v3 추가 ②: 자격 조건 — 공개형만. 지정형은 멘토가 이미 정해졌으므로 무시(NULL)
  if v_type <> 'open' then
    v_tier := null;
    v_major := null;
  else
    if v_tier is not null and (
         v_tier = '미분류'
      or not exists (select 1 from public.school_tier_catalog c where c.code = v_tier and c.is_active)
      or v_tier not in ('서연고', '서성한', '중경외시', '건동홍', '그외')
    ) then
      raise exception 'INVALID_TIER' using errcode = '22023';
    end if;
    if v_major is not null and (
         not exists (select 1 from public.major_category_catalog c where c.code = v_major and c.is_active)
      or v_major not in ('메디컬', '교육', '인문', '사회상경', '자연', '공학', '예체능', '기타')
    ) then
      raise exception 'INVALID_MAJOR' using errcode = '22023';
    end if;
  end if;

  -- 코어 v2(service_role 전용)에 위임 — v2 와 같은 호출에 topic·자격 3인자만 채운다
  v_res := public.create_individual_question_with_hold_v2(
    v_uid, v_type, p_designated_mentor_id, v_subject, v_topic, p_title, p_body, v_price, v_idem, v_tier, v_major);

  if not v_res.ok then
    raise exception 'INDIVIDUAL_QUESTION_CREATE_FAILED:%:%', v_res.code, v_res.message using errcode = 'P0001';
  end if;

  return query select q.* from public.individual_questions q where q.id = v_res.question_id;
end
$fn$;

comment on function api_app_v1.create_individual_question_as_student_v3(text, text, text, int, uuid, text, text, text, text, text) is
  '207(DB-5 D-1): create_individual_question_as_student_v2(204) 본문 복제 + p_topic(≤200자) + p_required_school_tier/p_required_major_category(공개형만 · 카탈로그 079_b ∩ CHECK 080_c · 미분류 불가 · INVALID_TIER/INVALID_MAJOR · 지정형은 무시). 나머지 시그니처·반환·오류 규약 v2 동일. 자금·자격은 코어 v2 위임. v1·v2 는 그대로.';

revoke all on function api_app_v1.create_individual_question_as_student_v3(text, text, text, int, uuid, text, text, text, text, text) from public, anon;
grant execute on function api_app_v1.create_individual_question_as_student_v3(text, text, text, int, uuid, text, text, text, text, text) to authenticated;

do $$
declare v_oid oid; v_src text;
begin
  select p.oid, p.prosrc into v_oid, v_src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'api_app_v1' and p.proname = 'create_individual_question_as_student_v3'
     and pg_get_function_identity_arguments(p.oid) = 'p_question_type text, p_title text, p_body text, p_amount_cents integer, p_designated_mentor_id uuid, p_idempotency_key text, p_subject text, p_topic text, p_required_school_tier text, p_required_major_category text'
     and p.prosecdef and coalesce(p.proconfig::text, '') like '%search_path=%' and p.proretset;
  if v_oid is null then
    raise exception '207_SELFCHECK: identity/attributes 불일치';
  end if;
  if has_function_privilege('anon', v_oid, 'EXECUTE') or not has_function_privilege('authenticated', v_oid, 'EXECUTE')
     or has_function_privilege('service_role', v_oid, 'EXECUTE') then
    raise exception '207_SELFCHECK: ACL 불일치(authenticated 만)';
  end if;
  if v_src not like '%public.create_individual_question_with_hold_v2(%' or v_src like '%insert into public.cash_ledger%' then
    raise exception '207_SELFCHECK: 코어 위임 아님 또는 자금 로직 복제';
  end if;
  -- v2 검사부 복제 확인(문자열 존재) — AUTH_REQUIRED · SUBJECT_REQUIRED · INVALID_SUBJECT · MENTOR_PRICE_NOT_SET · 랜덤 키
  if v_src not like '%AUTH_REQUIRED%' or v_src not like '%SUBJECT_REQUIRED%' or v_src not like '%INVALID_SUBJECT%'
     or v_src not like '%MENTOR_PRICE_NOT_SET%' or v_src not like '%''iqc:'' || gen_random_uuid()%' then
    raise exception '207_SELFCHECK: v2 검사부 복제 누락';
  end if;
  -- v1·v2 불변(identity·ACL·md5)
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'create_individual_question_as_student'
                    and has_function_privilege('authenticated', p.oid, 'EXECUTE') and not has_function_privilege('anon', p.oid, 'EXECUTE')) then
    raise exception '207_SELFCHECK: v1 ACL 변경됨';
  end if;
  if (select md5(pg_get_functiondef(p.oid)) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'api_app_v1' and p.proname = 'create_individual_question_as_student_v2') <> 'aa8c27d2dcaa1c9cbfe5ae852f1c2dcc' then
    raise exception '207_SELFCHECK: v2 본문 변경됨';
  end if;
end $$;

commit;
