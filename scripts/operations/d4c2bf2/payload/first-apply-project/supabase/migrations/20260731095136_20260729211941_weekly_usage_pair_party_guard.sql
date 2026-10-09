-- =============================================================================
-- 20260729211941_weekly_usage_pair_party_guard.sql (S2 M15)
-- =============================================================================
-- XW-01 레거시 하드닝 — public.get_weekly_question_usage(uuid,uuid) 에
-- NULL-safe pair-party 가드를 추가한다(rev 8 A-8 — 오너 확정 형태 고정).
-- 정본 계약: docs/contracts/api_web_v1_contract_v1_1.md §7 F1 · §20.2 M15.
--   - 함수 첫 실행부에 가드만 추가한다. 그 외 본문은 098(현행 정본)과 문자 동일.
--   - 비교는 IS DISTINCT FROM 만 사용한다(IN·NOT IN·<>·NOT(...) 대체 금지 — NULL-safe).
--   - 허용: service_role JWT / 학생 본인(auth.uid()=p_student_id) /
--           멘토 당사자(auth.uid()=p_mentor_id). 그 외(anon·제3자)는 42501 거부.
--   - signature·return(json)·volatility·SECURITY DEFINER·search_path=public·
--     owner·ACL 전부 불변. anon EXECUTE 는 이번 M15 에서 회수하지 않는다(U-08 별도).
--   - 기존 NULL 인자 검사·한도 매핑(limited 4/standard 9/premium 999)·anchor 7일
--     롤링·반환 JSON 의미 불변.
-- 유지 확인 대상(계약 §7 F1): qna_create_question_thread(학생 본인) ·
--   qt_direct_write_guard(학생 본인) · 웹 멘토 질문방(멘토 ID = auth.uid()) ·
--   service_role 서버 경로(weeklyQuestionUsageServer.ts, e2e admin).
-- rollback 정본: supabase/rollback/20260729211941_weekly_usage_pair_party_guard_rollback.sql
--   (가드 없는 098 전체 정의를 명시적으로 복원)
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
  -- [S2 M15] NULL-safe pair-party 가드 (계약 §7 F1 — 오너 확정 형태 고정).
  IF (auth.jwt() ->> 'role') IS DISTINCT FROM 'service_role'
     AND auth.uid() IS DISTINCT FROM p_student_id
     AND auth.uid() IS DISTINCT FROM p_mentor_id
  THEN
    RAISE EXCEPTION 'NOT_PAIR_PARTY'
      USING ERRCODE = '42501';
  END IF;

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
