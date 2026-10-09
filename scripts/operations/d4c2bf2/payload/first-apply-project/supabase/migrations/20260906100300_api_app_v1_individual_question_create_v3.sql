-- =============================================================================
-- 207_api_app_v1_individual_question_create_v3.sql  (2026-09-06 · DB-5 묶음 D — 개별질문 v3 래퍼: 단원·개념 + 자격 조건 · 후속 b: 정지 계정 등록 차단)
--
-- 왜: 앱 A-4c 전수 대조가 찾은 유일한 서버 선행 항목. 공개형 질문의 단원·개념(`topic`)과 자격 조건(학교군·전공계열)을 웹은
--   `create_individual_question_with_hold_v2`(service_role 전용 코어)에 직접 넣지만, 앱이 부르는 204 v2 래퍼는 `p_subject` 까지만 받아
--   코어에 NULL 을 고정 전달한다. `individual_questions` 에 본인 UPDATE 정책도 없어 등록 뒤 보정도 못 한다.
--   v1(092 public)은 그대로 둔다. `_v3` 는 **v2 본문을 그대로 복제**한 뒤 인자 3개만 더한다.
--
-- 후속 b(2026-09-06 · DB-5 보고서 §5-4): v2(204)·코어 v2 는 계정 상태를 보지 않아 **정지(suspended)·차단(banned)·탈퇴 진행 중 학생도 개별질문을 등록**할 수
--   있었다(스크래치 실측 · 웹은 서버 액션 `assertAccountActive` 가 막는다). 계정 상태 검사를 함수 하나(D-0)로 빼고 **v2 와 v3 둘 다** 호출한다.
--   "v2 변경 금지"는 호환성 규칙이므로 v2 의 시그니처·반환·오류 규약은 그대로 두고 검사 한 곳만 더한다(create or replace · 원문 md5 게이트 · rollback 원문 복원).
--   막는 상태 집합 = 앱 `entry_guard.dart`/`AccountStatusReader`(auth_service.dart:97-121 · account_status.dart) · 웹 `lib/auth/accountStatus.ts`(assertAccountActive)
--   가 막는 것과 같다: banned · suspended(suspended_until NULL 또는 미래) · deleted · 탈퇴 진행 중(`account_deletion_write_blocked` = locked~auth_soft_deleted) ·
--   그 외 알 수 없는 status · users 행 부재(확인 불가 = 거부). 탈퇴 **대기**(pending · 취소 가능 창)는 앱·DB 관례대로 허용.
--   오류: `ACCOUNT_BLOCKED`(P0001) · `PG_EXCEPTION_DETAIL` = 상태값(banned · suspended · deleted · deletion_in_progress · status_unknown · row_missing).
--
-- D-0 core_private.account_blocked_state(p_user_id uuid) returns text — NULL 이면 허용, 아니면 차단 상태값. 외부 EXECUTE 0.
-- D-1 api_app_v1.create_individual_question_as_student_v2(...) — 204 본문 그대로 + AUTH_REQUIRED 직후 D-0 검사 1곳. 시그니처·반환·ACL·오류 규약 불변.
-- D-2 api_app_v1.create_individual_question_as_student_v3(
--        p_question_type text, p_title text, p_body text, p_amount_cents int default null, p_designated_mentor_id uuid default null,
--        p_idempotency_key text default null, p_subject text default null,
--        p_topic text default null, p_required_school_tier text default null, p_required_major_category text default null)
--      returns setof public.individual_questions
--   · v2 와 동일(복제): AUTH_REQUIRED(28000) · ACCOUNT_BLOCKED(P0001 · detail 상태값) · INVALID_INPUT(22023) · INVALID_SUBJECT · SUBJECT_REQUIRED(open 필수) ·
--     MENTOR_PRICE_NOT_SET(P0001) · 코어 실패 INDIVIDUAL_QUESTION_CREATE_FAILED:<code>:<message>(P0001) · 가격 결정 · 키 미전달 시 랜덤 키 · 자금·자격 판정은 코어 v2 위임.
--   · 추가: p_topic — 단원·개념 자유 텍스트(trim · 빈 값 NULL · 200자 초과 TOPIC_TOO_LONG 22023) · direct/open 모두 허용.
--   · 추가: p_required_school_tier / p_required_major_category — **open(공개형)에만**. 지정형은 값을 무시하고 NULL 로 넘긴다. 공개형은 DB 정본으로 검증:
--       학교군  = `school_tier_catalog`(079_b · is_active) ∩ `individual_questions_required_school_tier_check` 목록 − **'미분류'** → 아니면 INVALID_TIER(22023)
--       전공계열 = `major_category_catalog`(079_b · is_active) ∩ `individual_questions_required_major_category_check` 목록 → 아니면 INVALID_MAJOR(22023)
-- 권한: REVOKE public·anon · GRANT authenticated 만(204 와 동일 · service_role 0). v1 `public.create_individual_question_as_student` 는 손대지 않는다.
--
-- Apply: 저장소 표준 경로(db-apply-pending). pack 등재: supabase/baseline/post_ledger_backfills/20260906100300_api_app_v1_individual_question_create_v3.sql
-- Rollback: supabase/rollback/20260906100300_api_app_v1_individual_question_create_v3_rollback.sql (v3·D-0 DROP + v2 204 원문 복원)
-- =============================================================================

begin;

do $$
declare v_def text;
begin
  if not exists (select 1 from pg_namespace where nspname = 'api_app_v1') or not exists (select 1 from pg_namespace where nspname = 'core_private') then
    raise exception '207_GATE: api_app_v1/core_private 스키마 부재';
  end if;
  -- v2(204) 본문이 복제 원본과 같은지(md5) — 다르면 이 파일의 복제본·교체본이 v2 와 어긋난 것이므로 중단
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'api_app_v1' and p.proname = 'create_individual_question_as_student_v2'
     and pg_get_function_identity_arguments(p.oid) = 'p_question_type text, p_title text, p_body text, p_amount_cents integer, p_designated_mentor_id uuid, p_idempotency_key text, p_subject text';
  if v_def is null then
    raise exception '207_GATE: v2 create_individual_question_as_student_v2 identity 불일치(204)';
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
  if (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'users' and column_name in ('status', 'suspended_until')) <> 2
     or not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'account_deletion_write_blocked') then
    raise exception '207_GATE: users.status/suspended_until 또는 account_deletion_write_blocked(151) 부재';
  end if;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where (n.nspname, p.proname) in (('api_app_v1', 'create_individual_question_as_student_v3'), ('core_private', 'account_blocked_state'))) then
    raise exception '207_GATE: 대상 함수가 이미 있다';
  end if;
  -- v1 불변 확인용 스냅샷
  create temp table db5_207_pre on commit drop as
    select md5(pg_get_functiondef('public.create_individual_question_as_student(text,text,text,int,uuid,text)'::regprocedure)) as v1_md5;
end $$;

-- -----------------------------------------------------------------------------
-- D-0. 계정 차단 상태 판정 (core_private · 외부 EXECUTE 0) — v2·v3 공유
-- -----------------------------------------------------------------------------
create function core_private.account_blocked_state(p_user_id uuid)
returns text
language plpgsql
stable
security invoker
set search_path to ''
as $fn$
declare
  v_status text;
  v_susp timestamptz;
  v_norm text;
begin
  if p_user_id is null then
    return 'row_missing';
  end if;
  select u.status, u.suspended_until into v_status, v_susp from public.users u where u.id = p_user_id;
  if not found then
    return 'row_missing';
  end if;
  v_norm := lower(btrim(coalesce(v_status, '')));
  if v_norm = 'banned' then
    return 'banned';
  end if;
  if v_norm = 'suspended' then
    if v_susp is null or v_susp > now() then
      return 'suspended';
    end if;
    -- 만료된 정지 → 허용(앱·웹 동일)
  elsif v_norm = 'deleted' then
    return 'deleted';
  elsif v_norm <> 'active' then
    return 'status_unknown';
  end if;
  if public.account_deletion_write_blocked(p_user_id) then
    return 'deletion_in_progress';
  end if;
  return null;
end
$fn$;
comment on function core_private.account_blocked_state(uuid) is
  '207(DB-5 후속 b): 계정 차단 상태 — NULL 이면 허용. banned · suspended(무기한/미래) · deleted · deletion_in_progress(account_deletion_write_blocked) · status_unknown · row_missing. 앱 entry_guard/웹 assertAccountActive 와 같은 집합. 개별질문 v2·v3 가 공유. 외부 EXECUTE 0.';
revoke all on function core_private.account_blocked_state(uuid) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- D-1. v2 — 204 본문 그대로 + AUTH_REQUIRED 직후 계정 검사 1곳 (시그니처·반환·오류 규약·ACL 불변)
-- -----------------------------------------------------------------------------
create or replace function api_app_v1.create_individual_question_as_student_v2(
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
  v_blocked text;
  v_price int;
  v_res public.individual_question_escrow_result;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;

  -- 207(DB-5 후속 b): 정지·차단·탈퇴 진행 중 계정은 등록 불가 — 앱 entry_guard/웹 assertAccountActive 와 같은 집합
  v_blocked := core_private.account_blocked_state(v_uid);
  if v_blocked is not null then
    raise exception 'ACCOUNT_BLOCKED' using errcode = 'P0001', detail = v_blocked;
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
  '204(DB-4 F-1) + 207(DB-5 후속 b): create_individual_question_as_student(092) + p_subject(subjects.code 정본 · open 필수 · direct 선택) + 계정 차단 검사(ACCOUNT_BLOCKED · core_private.account_blocked_state). 나머지 시그니처·반환·오류 규약 동일. 자금·자격은 코어 v2 위임. v1 은 그대로.';

-- -----------------------------------------------------------------------------
-- D-2. v3 — v2 본문 복제 + topic · 자격 조건
-- -----------------------------------------------------------------------------
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
  v_blocked text;
  v_price int;
  v_res public.individual_question_escrow_result;
begin
  -- ── 이하 v2(204 + 207 D-1) 본문 복제 — 권한·계정·상태·과목·가격·키 검사 동일 ──
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;

  -- 207(DB-5 후속 b): 정지·차단·탈퇴 진행 중 계정은 등록 불가 — v2 와 같은 판정 함수
  v_blocked := core_private.account_blocked_state(v_uid);
  if v_blocked is not null then
    raise exception 'ACCOUNT_BLOCKED' using errcode = 'P0001', detail = v_blocked;
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
  '207(DB-5 D-2): create_individual_question_as_student_v2 본문 복제(계정 차단 검사 포함) + p_topic(≤200자) + p_required_school_tier/p_required_major_category(공개형만 · 카탈로그 079_b ∩ CHECK 080_c · 미분류 불가 · INVALID_TIER/INVALID_MAJOR · 지정형은 무시). 나머지 시그니처·반환·오류 규약 v2 동일. 자금·자격은 코어 v2 위임. v1 은 그대로.';

revoke all on function api_app_v1.create_individual_question_as_student_v3(text, text, text, int, uuid, text, text, text, text, text) from public, anon;
grant execute on function api_app_v1.create_individual_question_as_student_v3(text, text, text, int, uuid, text, text, text, text, text) to authenticated;

do $$
declare v_oid oid; v_src text; v2_oid oid; v2_src text; v_gate oid;
begin
  -- D-0
  select p.oid into v_gate from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'core_private' and p.proname = 'account_blocked_state' and pg_get_function_identity_arguments(p.oid) = 'p_user_id uuid' and p.provolatile = 's';
  if v_gate is null or has_function_privilege('anon', v_gate, 'EXECUTE') or has_function_privilege('authenticated', v_gate, 'EXECUTE') or has_function_privilege('service_role', v_gate, 'EXECUTE') then
    raise exception '207_SELFCHECK: account_blocked_state 부재 또는 외부 EXECUTE 잔존';
  end if;
  -- D-1 v2: identity·ACL 불변 · 본문은 검사 1곳만 추가
  select p.oid, p.prosrc into v2_oid, v2_src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'api_app_v1' and p.proname = 'create_individual_question_as_student_v2'
     and pg_get_function_identity_arguments(p.oid) = 'p_question_type text, p_title text, p_body text, p_amount_cents integer, p_designated_mentor_id uuid, p_idempotency_key text, p_subject text'
     and p.prosecdef and coalesce(p.proconfig::text, '') like '%search_path=%' and p.proretset;
  if v2_oid is null then
    raise exception '207_SELFCHECK: v2 identity/attributes 변경됨';
  end if;
  if has_function_privilege('anon', v2_oid, 'EXECUTE') or not has_function_privilege('authenticated', v2_oid, 'EXECUTE') or has_function_privilege('service_role', v2_oid, 'EXECUTE') then
    raise exception '207_SELFCHECK: v2 ACL 변경됨(authenticated 만)';
  end if;
  if md5(pg_get_functiondef(v2_oid)) = 'aa8c27d2dcaa1c9cbfe5ae852f1c2dcc' or v2_src not like '%core_private.account_blocked_state(%' or v2_src not like '%ACCOUNT_BLOCKED%'
     or v2_src not like '%public.create_individual_question_with_hold_v2(%' or v2_src like '%insert into public.cash_ledger%' then
    raise exception '207_SELFCHECK: v2 교체 실패(검사 미포함 또는 위임 아님)';
  end if;
  -- D-2 v3
  select p.oid, p.prosrc into v_oid, v_src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'api_app_v1' and p.proname = 'create_individual_question_as_student_v3'
     and pg_get_function_identity_arguments(p.oid) = 'p_question_type text, p_title text, p_body text, p_amount_cents integer, p_designated_mentor_id uuid, p_idempotency_key text, p_subject text, p_topic text, p_required_school_tier text, p_required_major_category text'
     and p.prosecdef and coalesce(p.proconfig::text, '') like '%search_path=%' and p.proretset;
  if v_oid is null then
    raise exception '207_SELFCHECK: v3 identity/attributes 불일치';
  end if;
  if has_function_privilege('anon', v_oid, 'EXECUTE') or not has_function_privilege('authenticated', v_oid, 'EXECUTE') or has_function_privilege('service_role', v_oid, 'EXECUTE') then
    raise exception '207_SELFCHECK: v3 ACL 불일치(authenticated 만)';
  end if;
  if v_src not like '%public.create_individual_question_with_hold_v2(%' or v_src like '%insert into public.cash_ledger%' then
    raise exception '207_SELFCHECK: v3 코어 위임 아님 또는 자금 로직 복제';
  end if;
  if v_src not like '%AUTH_REQUIRED%' or v_src not like '%core_private.account_blocked_state(%' or v_src not like '%ACCOUNT_BLOCKED%' or v_src not like '%SUBJECT_REQUIRED%'
     or v_src not like '%INVALID_SUBJECT%' or v_src not like '%MENTOR_PRICE_NOT_SET%' or v_src not like '%''iqc:'' || gen_random_uuid()%' then
    raise exception '207_SELFCHECK: v3 검사부(v2 복제 + 계정 검사) 누락';
  end if;
  -- v1 불변(identity·ACL·md5)
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'create_individual_question_as_student'
                    and has_function_privilege('authenticated', p.oid, 'EXECUTE') and not has_function_privilege('anon', p.oid, 'EXECUTE')) then
    raise exception '207_SELFCHECK: v1 ACL 변경됨';
  end if;
  if md5(pg_get_functiondef('public.create_individual_question_as_student(text,text,text,int,uuid,text)'::regprocedure)) <> (select v1_md5 from db5_207_pre) then
    raise exception '207_SELFCHECK: v1 본문 변경됨';
  end if;
  -- 판정 함수: 존재하지 않는 사용자 → row_missing
  if core_private.account_blocked_state(gen_random_uuid()) is distinct from 'row_missing' or core_private.account_blocked_state(null) is distinct from 'row_missing' then
    raise exception '207_SELFCHECK: account_blocked_state 판정 불일치';
  end if;
end $$;

commit;
