-- =============================================================================
-- 192_school_verification_provisional_rule.sql  (2026-09-03 · DB-1 묶음 B — 학교 인증 규칙 ★)
--
-- 원칙: "잠정" = reviewed_by IS NULL. 자동 판정은 pending 으로 만들고, 관리자가 확정해야 approved 가 된다.
--
-- B-1 기존 건 일괄 확정 (오너 결정 2026-09-03): status='approved' · reviewed_by IS NULL · 멘토 프로필
--     verification_status='approved' 인 행 전부에 reviewed_by = 9bf48819-1dd2-40dd-96a3-d64bcca2e60c
--     (byite1226@gmail.com) · reviewed_at = now(). 승인 대기(pending) 멘토는 조건으로 자연히 제외된다.
--     admin_action_logs 에 1건 기록(action_type = school_verification_bulk_confirmed · detail.count).
--     적용 전 실측(2026-09-03 운영 read-only): 대상 67건 · 이미 확정 6건 · superseded 1건 · 대기 멘토 행 0건.
-- B-2 트리거: tmp_auto_school_verification / trg_tmp_auto_school_verification 을 auto_school_verification /
--     trg_auto_school_verification 으로 교체(더 이상 임시가 아니다). 생성 행 status 'approved' → 'pending' ·
--     reviewed_by/at NULL · verified/active 동의어 분기 제거(approved 만) · LIKE 매칭 로직은 헬퍼 2종
--     (school_tier_suggest · major_category_suggest)으로 분리해 B-4 와 공유(같은 규칙).
-- B-3 RPC approve_mentor_school_verification_admin: 허용 status = pending / resubmit_required /
--     (approved AND reviewed_by IS NULL). 서류 유무·경로·객체 실재 조건 제거(서류는 판단 재료 — 화면이
--     '서류 없음'을 보여준다). 확정 시 status approved · reviewed_by/at · 등급·계열은 관리자가 넘긴 값.
--     is_admin() 게이트 · mentor 단위 advisory lock · 재승인 승계(superseded) · 반환 계약 · ACL 불변.
-- B-4 학적 변경 재판정: mentor_profiles.university_name / department_name 이 실제로 바뀌면
--     (IS DISTINCT FROM) 그 멘토의 approved·pending 행을 같은 LIKE 규칙으로 재판정하고 status 'pending' ·
--     reviewed_by/at NULL 로 되돌린다. approved 멘토인데 approved·pending 행이 하나도 없으면 pending 행을 새로 만든다.
--
-- 의도된 비용(오너 확인): 새로 승인되는 멘토·학적이 바뀐 멘토는 관리자가 PR-2 화면에서 등급을 확정하기
--   전까지 개별질문 등급 필터에서 빠진다.
-- 참고: 멘토 자기 프로필 편집(F7 mentor_profile_update_self)으로 학교/학과가 바뀌어도 B-4 가 돈다. 이때는
--   호출자 JWT 가 멘토 본인이라 077 guard_self_review 가 verified_* 제안값을 NULL 로 비우지만, 상태는
--   똑같이 pending · reviewed_by NULL(잠정)이 된다 — 관리자 확정 흐름은 동일.
--
-- Apply: 저장소 표준 경로(db-apply-pending) — 즉석 실행 금지. 적용 순서 A(190) → C(191) → B(192).
--   ★ B-1 은 데이터 변경이다 — 적용 직전 `select * from mentor_school_verifications` 전체 덤프를 PR 코멘트에 남긴다.
--   pack 등재: supabase/baseline/post_ledger_backfills/20260903100300_school_verification_provisional_rule.sql
-- Rollback: supabase/rollback/20260903100300_school_verification_provisional_rule_rollback.sql
-- 검증(§5): select status, (reviewed_by is null) as 미확정, count(*) from mentor_school_verifications group by 1,2;
--           select tgname from pg_trigger where tgname like '%school_verification%';
-- =============================================================================

begin;

-- ── 0. 사전 게이트 — 예상 상태와 다르면 중단(임의 정정 금지) ──────────────────
do $$
declare
  v_rpc_src text;
  v_check   text;
begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_tmp_auto_school_verification'
                   and tgrelid = 'public.mentor_profiles'::regclass) then
    raise exception '192_GATE: trg_tmp_auto_school_verification 부재 — 이미 적용됐거나 20260830150838 전제 불일치';
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'tmp_auto_school_verification') then
    raise exception '192_GATE: tmp_auto_school_verification() 부재';
  end if;

  select p.prosrc into v_rpc_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'approve_mentor_school_verification_admin'
     and pg_get_function_identity_arguments(p.oid) =
         'p_verification_id uuid, p_university_name text, p_university_id text, p_department_name text, p_major_category text, p_school_tier text';
  if v_rpc_src is null then
    raise exception '192_GATE: approve_mentor_school_verification_admin(uuid, text ×5) 부재';
  end if;
  if v_rpc_src not like '%not in (''pending'', ''resubmit_required'')%' or v_rpc_src not like '%DOCUMENT_REF_MISSING%' then
    raise exception '192_GATE: RPC 본문이 174 형태가 아니다(이미 적용됐거나 전제 불일치)';
  end if;

  select pg_get_constraintdef(c.oid) into v_check
    from pg_constraint c
   where c.conrelid = 'public.mentor_school_verifications'::regclass
     and c.conname = 'mentor_school_verifications_status_check';
  if v_check is null or v_check not like '%pending%' or v_check not like '%approved%' or v_check not like '%superseded%' then
    raise exception '192_GATE: status CHECK 정의가 예상과 다르다(%)', v_check;
  end if;
  if not exists (select 1 from pg_indexes where schemaname = 'public'
                   and tablename = 'mentor_school_verifications' and indexname = 'uq_msv_one_approved_per_mentor') then
    raise exception '192_GATE: uq_msv_one_approved_per_mentor 부재(174 전제)';
  end if;
end $$;

-- ── B-1. 기존 자동 판정 건 일괄 확정 ────────────────────────────────────────────
do $$
declare
  v_admin   constant uuid := '9bf48819-1dd2-40dd-96a3-d64bcca2e60c';  -- byite1226@gmail.com (오너 지정)
  v_target  integer;
  v_updated integer;
  v_now     timestamptz := now();
begin
  select count(*) into v_target
    from public.mentor_school_verifications v
    join public.mentor_profiles p on p.user_id = v.mentor_id
   where v.status = 'approved'
     and v.reviewed_by is null
     and p.verification_status = 'approved';

  if v_target = 0 then
    raise notice '192 B-1: 일괄 확정 대상 0건 — 건너뜀(로그 미기록)';
    return;
  end if;

  -- 대상이 있으면 확정 주체가 실재하는 admin 이어야 한다. 아니면 확정하지 않고 중단(추측 금지).
  if not exists (select 1 from public.users u where u.id = v_admin and u.role = 'admin') then
    raise exception '192_ABORT: 일괄 확정 admin 계정 % 이 public.users 에 admin 으로 없다 — 대상 % 건을 확정하지 않고 중단', v_admin, v_target;
  end if;
  if not exists (select 1 from auth.users au where au.id = v_admin) then
    raise exception '192_ABORT: 일괄 확정 admin 계정 % 이 auth.users 에 없다(admin_action_logs FK) — 중단', v_admin;
  end if;

  update public.mentor_school_verifications v
     set reviewed_by = v_admin,
         reviewed_at = v_now
    from public.mentor_profiles p
   where v.mentor_id = p.user_id
     and v.status = 'approved'
     and v.reviewed_by is null
     and p.verification_status = 'approved';
  get diagnostics v_updated = row_count;

  if v_updated <> v_target then
    raise exception '192_ABORT: 일괄 확정 대상 % 건 ≠ 갱신 % 건', v_target, v_updated;
  end if;

  insert into public.admin_action_logs (admin_id, action_type, target_type, target_id, detail, created_at)
  values (
    v_admin,
    'school_verification_bulk_confirmed',
    'mentor_school_verification',
    null,
    jsonb_build_object(
      'count', v_updated,
      'note', '2026-09-03 오너 결정에 따른 자동 판정 건 일괄 확정',
      'rule', 'mentor_school_verifications.status = approved AND reviewed_by IS NULL AND mentor_profiles.verification_status = approved',
      'reviewed_at', v_now,
      'migration', '20260903100300_school_verification_provisional_rule'
    ),
    v_now
  );
  raise notice '192 B-1: % 건 일괄 확정 (reviewed_by = %, reviewed_at = %)', v_updated, v_admin, v_now;
end $$;

-- ── B-2a. 판정 규칙 헬퍼 — 20260830150838 의 LIKE 규칙을 그대로 분리(B-2·B-4 공유) ──
create or replace function public.school_tier_suggest(p_university_name text)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when p_university_name like '서울대%' or p_university_name like '연세대%' or p_university_name like '고려대%'
      then '서연고'
    when p_university_name like '서강대%' or p_university_name like '성균관대%' or p_university_name like '한양대%'
      then '서성한'
    when p_university_name like '중앙대%' or p_university_name like '경희대%'
      or p_university_name like '한국외%' or p_university_name like '서울시립대%'
      then '중경외시'
    when p_university_name like '건국대%' or p_university_name like '동국대%' or p_university_name like '홍익대%'
      then '건동홍'
    else '미분류'
  end;
$$;

comment on function public.school_tier_suggest(text) is
  '192: 대학명 → 학교군 제안값(자동 판정 · 잠정). 정본 확정은 관리자 RPC. 규칙은 20260830150838 과 동일.';

create or replace function public.major_category_suggest(p_department_name text)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when p_department_name like '%의예%' or p_department_name like '%의학%'
      or p_department_name like '%치의%' or p_department_name like '%약학%' or p_department_name like '%한의%'
      or p_department_name like '%수의%' or p_department_name like '%간호%'
      then '메디컬'
    when p_department_name like '%교육%' then '교육'
    when p_department_name like '%국어국문%' or p_department_name like '%문헌정보%'
      or p_department_name like '%철학%' or p_department_name like '%사학%' or p_department_name like '%어문%'
      then '인문'
    when p_department_name like '%경영%' or p_department_name like '%경제%'
      or p_department_name like '%미디어%' or p_department_name like '%정치%' or p_department_name like '%사회학%'
      or p_department_name like '%행정%' or p_department_name like '%심리%'
      then '사회상경'
    when p_department_name like '%수학%' or p_department_name like '%물리%'
      or p_department_name like '%화학%' or p_department_name like '%생명%' or p_department_name like '%통계%'
      then '자연'
    when p_department_name like '%공학%' or p_department_name like '%컴퓨터%'
      or p_department_name like '%전자%' or p_department_name like '%기계%' or p_department_name like '%소프트웨어%'
      or p_department_name like '%모빌리티%' or p_department_name like '%융합%'
      then '공학'
    when p_department_name like '%음악%' or p_department_name like '%미술%'
      or p_department_name like '%체육%' or p_department_name like '%디자인%'
      then '예체능'
    else '기타'
  end;
$$;

comment on function public.major_category_suggest(text) is
  '192: 학과명 → 전공 계열 제안값(자동 판정 · 잠정). 정본 확정은 관리자 RPC. 규칙은 20260830150838 과 동일.';

revoke all on function public.school_tier_suggest(text) from public, anon, authenticated;
revoke all on function public.major_category_suggest(text) from public, anon, authenticated;

-- ── B-2b. 자동 생성 트리거 — tmp_ 제거 · pending · approved 만 ───────────────────
drop trigger if exists trg_tmp_auto_school_verification on public.mentor_profiles;
drop function if exists public.tmp_auto_school_verification();

create or replace function public.auto_school_verification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.verification_status = 'approved' then
    insert into public.mentor_school_verifications
      (mentor_id, status, verified_university_name, verified_department_name,
       school_tier, verified_major_category, reviewed_by, reviewed_at)
    select
      new.user_id,
      'pending',
      nullif(trim(new.university_name), ''),
      nullif(trim(new.department_name), ''),
      public.school_tier_suggest(new.university_name),
      public.major_category_suggest(new.department_name),
      null,
      null
    where not exists (
      select 1 from public.mentor_school_verifications v
      where v.mentor_id = new.user_id and v.status in ('pending', 'approved')
    );
  end if;
  return new;
end;
$$;

comment on function public.auto_school_verification() is
  '192: 멘토 승인(verification_status = approved) 시 학교·전공 인증 행을 pending(잠정 · reviewed_by NULL)으로 자동 생성 — 등급·계열은 제안값. 관리자가 approve_mentor_school_verification_admin 으로 확정해야 approved.';

revoke all on function public.auto_school_verification() from public, anon, authenticated;

drop trigger if exists trg_auto_school_verification on public.mentor_profiles;
create trigger trg_auto_school_verification
  after insert or update of verification_status on public.mentor_profiles
  for each row execute function public.auto_school_verification();

-- ── B-3. 확정 RPC — 잠정 approved 행 허용 · 서류 조건 제거 (174 본문 그 외 동일) ──
create or replace function public.approve_mentor_school_verification_admin(
  p_verification_id uuid,
  p_university_name text,
  p_university_id text,
  p_department_name text,
  p_major_category text,
  p_school_tier text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin uuid := (select auth.uid());
  v_row public.mentor_school_verifications;
  v_superseded integer := 0;
begin
  -- (a) 관리자 전용. mentor·student·anon 은 여기서 종료된다.
  if not coalesce(public.is_admin(), false) then
    raise exception 'NOT_ADMIN' using errcode = '42501';
  end if;

  if p_verification_id is null then
    raise exception 'INVALID_INPUT: verification_id is required' using errcode = '22023';
  end if;
  if btrim(coalesce(p_university_name, '')) = ''
     or btrim(coalesce(p_university_id, '')) = ''
     or btrim(coalesce(p_department_name, '')) = ''
     or btrim(coalesce(p_major_category, '')) = ''
     or btrim(coalesce(p_school_tier, '')) = '' then
    raise exception 'INVALID_INPUT: university/department/major/tier are required' using errcode = '22023';
  end if;

  -- (b) mentor 단위 직렬화 — 같은 멘토의 서로 다른 요청이 동시에 승인되지 않도록.
  select * into v_row from public.mentor_school_verifications where id = p_verification_id;
  if not found then
    raise exception 'VERIFICATION_NOT_FOUND' using errcode = 'P0002';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('msv_approve:' || v_row.mentor_id::text, 0));

  -- 락 획득 후 재조회(대기 중 다른 트랜잭션이 상태를 바꿨을 수 있다).
  select * into v_row from public.mentor_school_verifications
   where id = p_verification_id for update;
  -- 192: 확정 가능 = 심사 대상(pending·resubmit_required) 또는 잠정 승인(approved + reviewed_by IS NULL).
  if not (v_row.status in ('pending', 'resubmit_required')
          or (v_row.status = 'approved' and v_row.reviewed_by is null)) then
    raise exception 'NOT_REVIEWABLE: %', v_row.status using errcode = '22023';
  end if;

  -- (c) 192: 서류 유무·경로·객체 실재는 확정 조건이 아니다 — 서류는 판단 재료이며 화면이 '서류 없음'을 보여준다.

  -- (d) 재승인 수명주기 — 같은 트랜잭션에서 기존 approved 를 먼저 종료시킨다.
  update public.mentor_school_verifications
     set status = 'superseded',
         updated_at = now()
   where mentor_id = v_row.mentor_id
     and status = 'approved'
     and id <> v_row.id;
  get diagnostics v_superseded = row_count;

  -- (e) 대상 행 확정.
  update public.mentor_school_verifications
     set status = 'approved',
         verified_university_name = btrim(p_university_name),
         verified_university_id = btrim(p_university_id),
         verified_department_name = btrim(p_department_name),
         verified_major_category = btrim(p_major_category),
         school_tier = btrim(p_school_tier),
         reviewed_by = v_admin,
         reviewed_at = now(),
         reject_reason = null
   where id = v_row.id;

  -- 감사 가능 최소 정보만 반환한다(서류 내용·signed URL·토큰 미포함).
  return jsonb_build_object(
    'verification_id', v_row.id,
    'mentor_id', v_row.mentor_id,
    'status', 'approved',
    'superseded_count', v_superseded,
    'reviewed_by', v_admin
  );
end;
$$;

comment on function public.approve_mentor_school_verification_admin(uuid, text, text, text, text, text) is
  'SQL174 → 192: 학교·전공 인증 확정 정본. is_admin() 전용 · 확정 가능 = pending / resubmit_required / (approved AND reviewed_by IS NULL) · 서류 조건 없음 · 재승인 시 기존 approved → superseded 를 같은 트랜잭션에서 수행. 실패는 전부 예외(부분 반영 없음).';

revoke all on function public.approve_mentor_school_verification_admin(uuid, text, text, text, text, text) from public;
revoke all on function public.approve_mentor_school_verification_admin(uuid, text, text, text, text, text) from anon;
grant execute on function public.approve_mentor_school_verification_admin(uuid, text, text, text, text, text)
  to authenticated, service_role;

-- ── B-4. 학적 변경 시 재판정(잠정으로 되돌림) ───────────────────────────────────
create or replace function public.school_verification_reassess_on_academic_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tier text := public.school_tier_suggest(new.university_name);
  v_cat  text := public.major_category_suggest(new.department_name);
  v_n    integer := 0;
begin
  update public.mentor_school_verifications v
     set status = 'pending',
         school_tier = v_tier,
         verified_major_category = v_cat,
         verified_university_name = nullif(trim(new.university_name), ''),
         verified_university_id = null,
         verified_department_name = nullif(trim(new.department_name), ''),
         reviewed_by = null,
         reviewed_at = null
   where v.mentor_id = new.user_id
     and v.status in ('approved', 'pending');
  get diagnostics v_n = row_count;

  -- 승인 멘토인데 재판정할 행이 없으면(예: superseded/rejected 만 남음) 잠정 행을 새로 만든다.
  if v_n = 0 and new.verification_status = 'approved' then
    insert into public.mentor_school_verifications
      (mentor_id, status, verified_university_name, verified_department_name,
       school_tier, verified_major_category, reviewed_by, reviewed_at)
    values
      (new.user_id, 'pending',
       nullif(trim(new.university_name), ''), nullif(trim(new.department_name), ''),
       v_tier, v_cat, null, null);
  end if;
  return new;
end;
$$;

comment on function public.school_verification_reassess_on_academic_change() is
  '192 B-4: mentor_profiles.university_name/department_name 이 실제로 바뀌면 그 멘토의 approved·pending 인증 행을 같은 LIKE 규칙으로 재판정하고 pending(잠정 · reviewed_by NULL)으로 되돌린다. 관리자는 학적 변경 승인 후 등급을 다시 확정한다.';

revoke all on function public.school_verification_reassess_on_academic_change() from public, anon, authenticated;

drop trigger if exists trg_school_verification_reassess_on_academic_change on public.mentor_profiles;
create trigger trg_school_verification_reassess_on_academic_change
  after update of university_name, department_name on public.mentor_profiles
  for each row
  when (old.university_name is distinct from new.university_name
        or old.department_name is distinct from new.department_name)
  execute function public.school_verification_reassess_on_academic_change();

-- ── 적용 직후 자가 검증 ───────────────────────────────────────────────────────
do $$
declare v_n integer;
begin
  select count(*) into v_n
    from public.mentor_school_verifications v
    join public.mentor_profiles p on p.user_id = v.mentor_id
   where v.status = 'approved' and v.reviewed_by is null and p.verification_status = 'approved';
  if v_n > 0 then
    raise exception '192_SELFCHECK: 잠정 approved 행 % 건 잔존', v_n;
  end if;

  if exists (select 1 from pg_trigger where tgname = 'trg_tmp_auto_school_verification')
     or exists (select 1 from pg_proc where proname = 'tmp_auto_school_verification') then
    raise exception '192_SELFCHECK: tmp_ 트리거/함수 잔존';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'trg_auto_school_verification'
                   and tgrelid = 'public.mentor_profiles'::regclass)
     or not exists (select 1 from pg_trigger where tgname = 'trg_school_verification_reassess_on_academic_change'
                   and tgrelid = 'public.mentor_profiles'::regclass) then
    raise exception '192_SELFCHECK: 신규 트리거 부재';
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'approve_mentor_school_verification_admin'
                    and p.prosecdef and p.proconfig::text like '%search_path=%'
                    and p.prosrc like '%v_row.reviewed_by is null%'
                    and p.prosrc not like '%DOCUMENT_REF_MISSING%'
                    and NOT has_function_privilege('anon', p.oid, 'EXECUTE')
                    and has_function_privilege('authenticated', p.oid, 'EXECUTE')
                    and has_function_privilege('service_role', p.oid, 'EXECUTE')) then
    raise exception '192_SELFCHECK: RPC 본문/ACL 불일치';
  end if;
  if public.school_tier_suggest('성균관대학교') <> '서성한' or public.school_tier_suggest(null) <> '미분류'
     or public.major_category_suggest('의예과') <> '메디컬' or public.major_category_suggest(null) <> '기타' then
    raise exception '192_SELFCHECK: 판정 헬퍼 규칙 불일치';
  end if;
  for v_n in select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public'
                and p.proname in ('auto_school_verification', 'school_verification_reassess_on_academic_change',
                                  'school_tier_suggest', 'major_category_suggest')
                and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE'))
  loop
    raise exception '192_SELFCHECK: 트리거/헬퍼 함수에 anon·authenticated EXECUTE 잔존';
  end loop;
end $$;

commit;
