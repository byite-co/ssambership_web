-- [backfill 2026-08-06] staging 직접 적용분 역반영(원장 20260806041547).
--
-- C15: 학생 질문방 목록·마이페이지가 멘토 수만큼 사용량 RPC 를 병렬
-- 호출(N회 왕복)하던 것을 1회로 묶는 배치 self RPC. 계산부는 정본
-- public.get_weekly_question_usage 재사용(한도 규칙 이원화 금지 —
-- weekly_question_usage_self 와 동일 원칙), 학생은 auth.uid() 로 확정.
create or replace function api_web_v1.weekly_question_usage_self_batch(
  p_mentor_ids uuid[]
) returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_items jsonb := '[]'::jsonb;
  v_mid uuid;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'AUTH_REQUIRED');
  end if;
  if p_mentor_ids is null or coalesce(array_length(p_mentor_ids, 1), 0) = 0 then
    return jsonb_build_object('ok', true, 'contract_version', 1, 'items', '[]'::jsonb);
  end if;
  if array_length(p_mentor_ids, 1) > 50 then
    return jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'TOO_MANY_MENTORS');
  end if;
  for v_mid in select distinct m from unnest(p_mentor_ids) m where m is not null loop
    v_items := v_items || jsonb_build_array(
      public.get_weekly_question_usage(v_uid, v_mid)::jsonb
        || jsonb_build_object('mentor_id', v_mid));
  end loop;
  return jsonb_build_object('ok', true, 'contract_version', 1, 'items', v_items);
end $function$;

revoke all on function api_web_v1.weekly_question_usage_self_batch(uuid[]) from public;
grant execute on function api_web_v1.weekly_question_usage_self_batch(uuid[]) to authenticated;
