-- =============================================================================
-- 20260903100300_school_verification_provisional_rule_rollback.sql  (DB-1 묶음 B 롤백)
-- =============================================================================
-- forward: supabase/sql/192_school_verification_provisional_rule.sql
-- 되돌리는 것(역순):
--   B-4  트리거 trg_school_verification_reassess_on_academic_change + 함수 DROP
--   B-3  approve_mentor_school_verification_admin 을 운영 적용본(174 규칙 · 20260804100002 as-applied 본문)으로 복원
--        (pending/resubmit_required + 서류 실재 조건)
--   B-2  trg_auto_school_verification + auto_school_verification() DROP →
--        20260830150838 의 tmp_auto_school_verification() + trg_tmp_auto_school_verification 재생성(approved 자동 생성)
--   헬퍼 school_tier_suggest · major_category_suggest DROP
--   B-1  일괄 확정 데이터 되돌림 — admin_action_logs 의 school_verification_bulk_confirmed 기록과 reviewed_at 이
--        정확히 일치하는 행만 reviewed_by/at NULL 로(같은 트랜잭션의 now() 이므로 바이트 동일). 되돌린 건수를
--        admin_action_logs 에 school_verification_bulk_confirm_reverted 로 남긴다. 기록이 없으면 데이터는 건드리지 않는다.
-- 데이터 롤백 없음: forward 기간에 트리거가 만든 pending 행 · 관리자가 RPC 로 확정한 행 · 학적 변경 재판정 결과는
--   삭제·복원하지 않는다(오너 판단). 되돌린 뒤에는 그 행들이 pending 인 채 174 RPC(서류 필요) 대상이 된다.
-- =============================================================================

begin;

-- B-4
drop trigger if exists trg_school_verification_reassess_on_academic_change on public.mentor_profiles;
drop function if exists public.school_verification_reassess_on_academic_change();

-- B-3 — 운영 적용본(20260804100002_as_applied_function_bodies.sql · prosrc md5 b4d4ebcd653ba8365511928e663c144b,
--        2026-09-03 운영 실측과 동일) 그대로. COMMENT·ACL 은 174 와 동일.
CREATE OR REPLACE FUNCTION public.approve_mentor_school_verification_admin(p_verification_id uuid, p_university_name text, p_university_id text, p_department_name text, p_major_category text, p_school_tier text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_admin uuid := (select auth.uid());
  v_row public.mentor_school_verifications;
  v_path text;
  v_owner_segment text;
  v_superseded integer := 0;
begin
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

  select * into v_row from public.mentor_school_verifications where id = p_verification_id;
  if not found then
    raise exception 'VERIFICATION_NOT_FOUND' using errcode = 'P0002';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('msv_approve:' || v_row.mentor_id::text, 0));

  select * into v_row from public.mentor_school_verifications
   where id = p_verification_id for update;
  if v_row.status not in ('pending', 'resubmit_required') then
    raise exception 'NOT_REVIEWABLE: %', v_row.status using errcode = '22023';
  end if;

  if btrim(coalesce(v_row.document_storage_ref, '')) = '' then
    raise exception 'DOCUMENT_REF_MISSING' using errcode = '22023';
  end if;
  v_path := public.mentor_school_verification_storage_path(v_row.document_storage_ref);
  if v_path is null then
    raise exception 'DOCUMENT_REF_UNPARSEABLE' using errcode = '22023';
  end if;

  v_owner_segment := split_part(v_path, '/', 1);
  if v_owner_segment is distinct from v_row.mentor_id::text then
    raise exception 'DOCUMENT_REF_OWNER_MISMATCH' using errcode = '42501';
  end if;

  if not exists (
    select 1 from storage.objects o
     where o.bucket_id = 'student-id-images'
       and o.name = v_path
  ) then
    raise exception 'DOCUMENT_OBJECT_NOT_FOUND' using errcode = '22023';
  end if;

  update public.mentor_school_verifications
     set status = 'superseded',
         updated_at = now()
   where mentor_id = v_row.mentor_id
     and status = 'approved'
     and id <> v_row.id;
  get diagnostics v_superseded = row_count;

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

  return jsonb_build_object(
    'verification_id', v_row.id,
    'mentor_id', v_row.mentor_id,
    'status', 'approved',
    'superseded_count', v_superseded,
    'reviewed_by', v_admin
  );
end;
$function$;

comment on function public.approve_mentor_school_verification_admin(uuid, text, text, text, text, text) is
  'SQL174: 학교·전공 인증 승인 정본. is_admin() 전용 · 서류 참조 실재(storage.objects) 확인 · 소유 경로 검증 · 재승인 시 기존 approved → superseded 를 같은 트랜잭션에서 수행. 실패는 전부 예외(부분 반영 없음).';

revoke all on function public.approve_mentor_school_verification_admin(uuid, text, text, text, text, text) from public;
revoke all on function public.approve_mentor_school_verification_admin(uuid, text, text, text, text, text) from anon;
grant execute on function public.approve_mentor_school_verification_admin(uuid, text, text, text, text, text)
  to authenticated, service_role;

-- B-2 — 20260830150838 본문 그대로
drop trigger if exists trg_auto_school_verification on public.mentor_profiles;
drop function if exists public.auto_school_verification();

create or replace function public.tmp_auto_school_verification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if lower(coalesce(new.verification_status, '')) in ('approved', 'verified', 'active') then
    insert into public.mentor_school_verifications
      (mentor_id, status, verified_university_name, verified_department_name,
       school_tier, verified_major_category, reviewed_at)
    select
      new.user_id,
      'approved',
      nullif(trim(new.university_name), ''),
      nullif(trim(new.department_name), ''),
      case
        when new.university_name like '서울대%' or new.university_name like '연세대%' or new.university_name like '고려대%'
          then '서연고'
        when new.university_name like '서강대%' or new.university_name like '성균관대%' or new.university_name like '한양대%'
          then '서성한'
        when new.university_name like '중앙대%' or new.university_name like '경희대%'
          or new.university_name like '한국외%' or new.university_name like '서울시립대%'
          then '중경외시'
        when new.university_name like '건국대%' or new.university_name like '동국대%' or new.university_name like '홍익대%'
          then '건동홍'
        else '미분류'
      end,
      case
        when new.department_name like '%의예%' or new.department_name like '%의학%'
          or new.department_name like '%치의%' or new.department_name like '%약학%' or new.department_name like '%한의%'
          or new.department_name like '%수의%' or new.department_name like '%간호%'
          then '메디컬'
        when new.department_name like '%교육%' then '교육'
        when new.department_name like '%국어국문%' or new.department_name like '%문헌정보%'
          or new.department_name like '%철학%' or new.department_name like '%사학%' or new.department_name like '%어문%'
          then '인문'
        when new.department_name like '%경영%' or new.department_name like '%경제%'
          or new.department_name like '%미디어%' or new.department_name like '%정치%' or new.department_name like '%사회학%'
          or new.department_name like '%행정%' or new.department_name like '%심리%'
          then '사회상경'
        when new.department_name like '%수학%' or new.department_name like '%물리%'
          or new.department_name like '%화학%' or new.department_name like '%생명%' or new.department_name like '%통계%'
          then '자연'
        when new.department_name like '%공학%' or new.department_name like '%컴퓨터%'
          or new.department_name like '%전자%' or new.department_name like '%기계%' or new.department_name like '%소프트웨어%'
          or new.department_name like '%모빌리티%' or new.department_name like '%융합%'
          then '공학'
        when new.department_name like '%음악%' or new.department_name like '%미술%'
          or new.department_name like '%체육%' or new.department_name like '%디자인%'
          then '예체능'
        else '기타'
      end,
      now()
    where not exists (
      select 1 from public.mentor_school_verifications v
      where v.mentor_id = new.user_id and v.status = 'approved'
    );
  end if;
  return new;
end;
$$;

comment on function public.tmp_auto_school_verification() is
  '[임시/스테이징] 멘토 승인 시 학교인증 자동 approved 처리 — 정식 학교인증 플로우 전환 시 트리거와 함께 제거할 것';

drop trigger if exists trg_tmp_auto_school_verification on public.mentor_profiles;
create trigger trg_tmp_auto_school_verification
  after insert or update of verification_status on public.mentor_profiles
  for each row execute function public.tmp_auto_school_verification();

-- 헬퍼
drop function if exists public.school_tier_suggest(text);
drop function if exists public.major_category_suggest(text);

-- B-1 데이터 되돌림(기록 기반 · 정확 일치 행만)
do $$
declare
  v_log   public.admin_action_logs;
  v_n     integer := 0;
begin
  select * into v_log
    from public.admin_action_logs
   where action_type = 'school_verification_bulk_confirmed'
   order by created_at desc
   limit 1;
  if not found then
    raise notice '192 rollback B-1: school_verification_bulk_confirmed 기록 없음 — 데이터 무변경';
    return;
  end if;

  update public.mentor_school_verifications v
     set reviewed_by = null,
         reviewed_at = null
   where v.status = 'approved'
     and v.reviewed_by = v_log.admin_id
     and v.reviewed_at = (v_log.detail ->> 'reviewed_at')::timestamptz;
  get diagnostics v_n = row_count;

  insert into public.admin_action_logs (admin_id, action_type, target_type, target_id, detail)
  values (v_log.admin_id, 'school_verification_bulk_confirm_reverted', 'mentor_school_verification', null,
          jsonb_build_object('count', v_n, 'reverted_log_id', v_log.id,
                             'note', '192 rollback — 일괄 확정 되돌림(기록 reviewed_at 정확 일치 행만)'));
  raise notice '192 rollback B-1: % 건 되돌림 (기록 count=%)', v_n, v_log.detail ->> 'count';
end $$;

-- 복원 검증
do $$
begin
  if exists (select 1 from pg_trigger where tgname in ('trg_auto_school_verification', 'trg_school_verification_reassess_on_academic_change'))
     or not exists (select 1 from pg_trigger where tgname = 'trg_tmp_auto_school_verification' and tgrelid = 'public.mentor_profiles'::regclass)
     or exists (select 1 from pg_proc where proname in ('auto_school_verification', 'school_verification_reassess_on_academic_change', 'school_tier_suggest', 'major_category_suggest'))
     or not exists (select 1 from pg_proc where proname = 'approve_mentor_school_verification_admin'
                      and prosrc like '%DOCUMENT_REF_MISSING%' and prosrc not like '%v_row.reviewed_by is null%') then
    raise exception '192_ROLLBACK_SELFCHECK: 복원 불일치';
  end if;
end $$;

commit;
