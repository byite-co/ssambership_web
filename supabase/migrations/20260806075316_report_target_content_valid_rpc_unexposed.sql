-- [backfill 2026-08-06] staging 직접 적용분 역반영(원장 20260806075316).
--
-- 리뷰 후속: report_target_content_valid 는 content_reports INSERT 정책
-- 내부용 헬퍼인데 public 스키마 + authenticated EXECUTE 라 Data API(/rpc)로
-- 직접 호출 가능했다(RLS 우회 콘텐츠 id 존재 탐지 표면). PostgREST 에
-- 노출되지 않는 전용 스키마(rls_private)로 옮겨 정책 평가 권한만 남긴다.
-- (동일 노출인 기존 public.report_target_user_valid 는 정본 팩 소관 — 별도 과제.)
create schema if not exists rls_private;
revoke all on schema rls_private from public;
grant usage on schema rls_private to authenticated, service_role;

create or replace function rls_private.report_target_content_valid(
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

revoke all on function rls_private.report_target_content_valid(text, uuid) from public, anon;
grant execute on function rls_private.report_target_content_valid(text, uuid) to authenticated, service_role;

drop policy content_reports_insert_reporter on public.content_reports;
create policy content_reports_insert_reporter on public.content_reports
  for insert to authenticated
  with check (
    reporter_id = (select auth.uid())
    and status = 'pending'
    and admin_note is null and resolved_by is null and resolved_at is null
    and target_type = any (array['community_post','shortform_post','community_comment','board_comment','user'])
    and case when target_type = 'user'
         then public.report_target_user_valid(target_id)
         else rls_private.report_target_content_valid(target_type, target_id)
        end
  );

drop function public.report_target_content_valid(text, uuid);
