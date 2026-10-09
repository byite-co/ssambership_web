-- 120_admin_console_fixes.sql (repo: supabase/sql/120_admin_console_fixes.sql)
alter table public.content_reports
  drop constraint if exists content_reports_status_allowed;
alter table public.content_reports
  add constraint content_reports_status_allowed
  check (status = any (array[
    'pending', 'reviewing', 'resolved', 'rejected', 'dismissed',
    'hidden', 'removed'
  ]));

alter table public.disputes
  drop constraint if exists disputes_status_check;
alter table public.disputes
  add constraint disputes_status_check
  check (status = any (array[
    'open', 'under_review', 'resolved', 'dismissed', 'escalated',
    'on_hold', 'sanction_7d', 'sanction_30d', 'sanction_permanent'
  ]));

drop policy if exists users_admin_select_all on public.users;
create policy users_admin_select_all on public.users
  for select to authenticated
  using ((select public.is_admin()) = true);

drop policy if exists mp_admin_select_all on public.mentor_profiles;
create policy mp_admin_select_all on public.mentor_profiles
  for select to authenticated
  using ((select public.is_admin()) = true);

drop policy if exists student_id_images_admin_select on storage.objects;
create policy student_id_images_admin_select on storage.objects
  for select to authenticated
  using (bucket_id = 'student-id-images' and (select public.is_admin()) = true);

drop policy if exists "누구나 댓글 읽기" on public.comments;
drop policy if exists "로그인 유저 댓글 작성" on public.comments;
drop policy if exists "본인 댓글 삭제" on public.comments;

drop policy if exists comments_admin_select_all on public.comments;
create policy comments_admin_select_all on public.comments
  for select to authenticated
  using ((select public.is_admin()) = true);

drop policy if exists comments_admin_update on public.comments;
create policy comments_admin_update on public.comments
  for update to authenticated
  using ((select public.is_admin()) = true)
  with check ((select public.is_admin()) = true);

drop policy if exists comments_admin_delete on public.comments;
create policy comments_admin_delete on public.comments
  for delete to authenticated
  using ((select public.is_admin()) = true);

drop policy if exists qra_storage_read_admin on storage.objects;
create policy qra_storage_read_admin on storage.objects
  for select to authenticated
  using (bucket_id = 'question-room-attachments' and (select public.is_admin()) = true);

drop policy if exists scan_annotations_obj_admin_select on storage.objects;
create policy scan_annotations_obj_admin_select on storage.objects
  for select to authenticated
  using (bucket_id = 'scan-annotations' and (select public.is_admin()) = true);

drop policy if exists scan_annotations_admin_select on public.scan_annotations;
create policy scan_annotations_admin_select on public.scan_annotations
  for select to authenticated
  using ((select public.is_admin()) = true);

comment on constraint content_reports_status_allowed on public.content_reports is
  '120: hidden/removed 추가 — 검수 콘솔 숨김/삭제 처리와 정합.';
comment on constraint disputes_status_check on public.disputes is
  '120: on_hold/sanction_7d/sanction_30d/sanction_permanent 추가 — 분쟁 제재 액션과 정합.';