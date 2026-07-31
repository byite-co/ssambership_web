-- =============================================================================
-- 20260729211941_weekly_usage_pair_party_guard_rollback.sql (S2 M15 rollback)
-- =============================================================================
-- forward: supabase/sql/20260729211941_weekly_usage_pair_party_guard.sql
-- 정본: 물리 정책 §6·§7 / 계약 §20.2 M15("가드 없는 구 본문 복원 migration") · §22.
-- M15 적용 직전의 public.get_weekly_question_usage(uuid,uuid) "전체 정의"를
-- 명시적으로 복원한다(가드 줄만 동적으로 제거하는 SQL 금지).
--   - 복원 본문 = 098_weekly_usage_count_on_create.sql 의 현행 정본과 문자 동일
--     (baseline 175 적용 후 pg_get_functiondef 실측과 대조 완료 —
--      prosrc SHA-256 b5c39e0a47328fecedc848f35cf0493dee524778879cedccbf9af15fef90b2d8).
--   - signature·return(json)·volatility·SECURITY DEFINER·search_path=public·
--     owner·ACL 전부 기준선과 동일해야 한다. create or replace 는 기존 ACL·
--     owner·comment 를 보존하므로 GRANT/REVOKE 문을 두지 않는다(변경 0).
--   - 다른 함수·정책·데이터 변경 금지.
-- 실행: 장애 시 오너 승인 후 apply_migration 으로 이 파일 1건을 명시 선택,
--   ledger name = 20260729211941_weekly_usage_pair_party_guard_rollback
--   (원장 새 행 append — forward 행 삭제·수정·reverted 처리 금지).
-- =============================================================================

begin;

create or replace function public.get_weekly_question_usage(
  p_student_id uuid,
  p_mentor_id uuid
)
returns json
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_anchor timestamptz;
  v_week_start timestamptz;
  v_week_end timestamptz;
  v_elapsed_seconds numeric;
  v_period_index integer;
  v_used integer := 0;
  v_plan_tier text;
  v_limit integer := 0;
begin
  if p_student_id is null or p_mentor_id is null then
    raise exception 'p_student_id and p_mentor_id are required';
  end if;

  select
    s.plan_tier,
    coalesce(s.started_at, s.created_at)
  into v_plan_tier, v_anchor
  from public.subscriptions s
  where s.student_id = p_student_id
    and s.mentor_id = p_mentor_id
    and lower(coalesce(s.status, '')) = 'active'
  order by s.created_at desc
  limit 1;

  v_limit := case lower(coalesce(v_plan_tier, ''))
    when 'limited' then 4
    when 'standard' then 9
    when 'premium' then 999
    else 0
  end;

  if v_anchor is not null then
    v_elapsed_seconds := extract(epoch from (now() - v_anchor));
    v_period_index := greatest(0, floor(v_elapsed_seconds / 604800.0)::integer);
    v_week_start := v_anchor + (v_period_index * interval '7 days');
    v_week_end := v_week_start + interval '7 days';

    select count(*)::integer into v_used
    from public.question_threads qt
    inner join public.mentor_student_rooms r on r.id = qt.mentor_student_room_id
    where r.student_id = p_student_id
      and r.mentor_id = p_mentor_id
      and lower(coalesce(qt.status, '')) in ('pending', 'answered', 'confirmed', 'closed', 'archived')
      and qt.created_at >= v_week_start
      and qt.created_at < v_week_end;
  end if;

  return json_build_object(
    'used', coalesce(v_used, 0),
    'limit', v_limit,
    'plan_tier', v_plan_tier,
    'remaining', greatest(0, v_limit - coalesce(v_used, 0)),
    'can_ask', coalesce(v_used, 0) < v_limit,
    'week_start', v_week_start,
    'week_end', v_week_end
  );
end;
$function$;

commit;
