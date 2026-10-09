-- [backfill 2026-08-06] staging 직접 적용분 역반영(원장 20260806033833).
-- ★ 이 파일의 public 헬퍼 노출은 20260806075316 에서 rls_private 로 교정된다
--   (역사 보존 — 원장과 1:1 재현을 위해 적용 당시 그대로 기록).
--
-- N26: content_reports INSERT 가 user 타입만 실존 검증(report_target_user_valid)
-- 하고 콘텐츠 4종은 target_id 를 검증하지 않았다 — 존재하지 않는 id 로 신고
-- 큐 스팸/노이즈 가능. user 검증과 같은 규약(STABLE SECURITY DEFINER)의
-- 콘텐츠 실존 검증을 추가하고 INSERT 정책에 결합한다.
create or replace function public.report_target_content_valid(
  p_target_type text, p_target_id uuid
) returns boolean
language sql
stable security definer
set search_path to ''
as $function$
  select p_target_id is not null and case p_target_type
    when 'community_post'    then exists (select 1 from public.community_posts   t where t.id = p_target_id)
    when 'shortform_post'    then exists (select 1 from public.shortform_posts   t where t.id = p_target_id)
    when 'community_comment' then exists (select 1 from public.community_comments t where t.id = p_target_id)
    when 'board_comment'     then exists (select 1 from public.comments          t where t.id = p_target_id)
    else false
  end
$function$;

revoke all on function public.report_target_content_valid(text, uuid) from public;
grant execute on function public.report_target_content_valid(text, uuid) to authenticated;

drop policy content_reports_insert_reporter on public.content_reports;
create policy content_reports_insert_reporter on public.content_reports
  for insert to authenticated
  with check (
    reporter_id = (select auth.uid())
    and status = 'pending'
    and admin_note is null and resolved_by is null and resolved_at is null
    and target_type = any (array['community_post','shortform_post','community_comment','board_comment','user'])
    and case when target_type = 'user'
         then report_target_user_valid(target_id)
         else report_target_content_valid(target_type, target_id)
        end
  );
