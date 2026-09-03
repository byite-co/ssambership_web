-- =============================================================================
-- 20260903200100_school_tier_fallback_other_and_correction_rollback.sql  (DB-2 묶음 A 롤백)
-- =============================================================================
-- forward: supabase/sql/193_school_tier_fallback_other_and_correction.sql
-- 되돌리는 것(역순):
--   A-2  approve_mentor_school_verification_admin 을 192(20260903100300) 본문으로 복원
--        (허용 = pending / resubmit_required / approved AND reviewed_by IS NULL · 정정 로그 없음)
--   A-1  school_tier_suggest 를 192 본문으로 복원(LIKE 미매칭 → 미분류)
--   A-3  일괄 정정 데이터 되돌림 — admin_action_logs 의 school_tier_bulk_reassigned 기록(detail.rows) 에 있는 행 중
--        지금도 school_tier = '그외' · reviewed_by/at 이 기록의 일괄 값과 정확히 일치하는 행만 '미분류' + 기록된 이전
--        reviewed_by/at 으로 되돌린다. 되돌린 건수를 school_tier_bulk_reassign_reverted 로 남긴다. 기록이 없으면 데이터 무변경.
-- 데이터 롤백 없음: forward 기간에 RPC 로 정정된 행(school_tier_corrected 로그) · 트리거가 '그외' 로 만든 pending 행은
--   되돌리지 않는다(오너 판단). 되돌린 뒤 그 행들은 192 규칙(확정 행 재확정 = NOT_REVIEWABLE) 아래 남는다.
-- =============================================================================

begin;

-- A-2 — 192 본문 그대로(COMMENT·ACL 동일)
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

-- A-1 — 192 본문 그대로
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

revoke all on function public.school_tier_suggest(text) from public, anon, authenticated;

-- A-3 데이터 되돌림(기록 기반 · 정확 일치 행만)
do $$
declare
  v_log   public.admin_action_logs;
  v_n     integer := 0;
  v_total integer := 0;
  v_row   jsonb;
begin
  select * into v_log
    from public.admin_action_logs
   where action_type = 'school_tier_bulk_reassigned'
   order by created_at desc
   limit 1;
  if not found then
    raise notice '193 rollback A-3: school_tier_bulk_reassigned 기록 없음 — 데이터 무변경';
    return;
  end if;

  for v_row in select * from jsonb_array_elements(coalesce(v_log.detail -> 'rows', '[]'::jsonb))
  loop
    update public.mentor_school_verifications v
       set school_tier = '미분류',
           reviewed_by = nullif(v_row ->> 'reviewed_by', '')::uuid,
           reviewed_at = nullif(v_row ->> 'reviewed_at', '')::timestamptz
     where v.id = (v_row ->> 'id')::uuid
       and v.status = 'approved'
       and v.school_tier = '그외'
       and v.reviewed_by = v_log.admin_id
       and v.reviewed_at = (v_log.detail ->> 'reviewed_at')::timestamptz;
    get diagnostics v_n = row_count;
    v_total := v_total + v_n;
  end loop;

  insert into public.admin_action_logs (admin_id, action_type, target_type, target_id, detail)
  values (v_log.admin_id, 'school_tier_bulk_reassign_reverted', 'mentor_school_verification', null,
          jsonb_build_object('count', v_total, 'reverted_log_id', v_log.id,
                             'note', '193 rollback — 미분류→그외 일괄 정정 되돌림(기록 rows 의 이전 reviewed_by/at 복원 · 일괄 값 정확 일치 행만)'));
  raise notice '193 rollback A-3: % 건 되돌림 (기록 count=%)', v_total, v_log.detail ->> 'count';
end $$;

-- 복원 검증
do $$
begin
  if public.school_tier_suggest(null) <> '미분류' or public.school_tier_suggest('가천대학교') <> '미분류'
     or public.school_tier_suggest('성균관대학교') <> '서성한' then
    raise exception '193_ROLLBACK_SELFCHECK: school_tier_suggest 복원 불일치';
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'approve_mentor_school_verification_admin'
                    and p.prosrc like '%or (v_row.status = ''approved'' and v_row.reviewed_by is null)%'
                    and p.prosrc not like '%school_tier_corrected%'
                    and NOT has_function_privilege('anon', p.oid, 'EXECUTE')
                    and has_function_privilege('authenticated', p.oid, 'EXECUTE')) then
    raise exception '193_ROLLBACK_SELFCHECK: RPC 복원 불일치';
  end if;
end $$;

commit;
