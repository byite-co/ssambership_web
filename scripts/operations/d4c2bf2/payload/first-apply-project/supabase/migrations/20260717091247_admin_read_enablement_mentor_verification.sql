-- 기능 복원: 관리자 콘솔이 service_role 없이(세션 폴백 시)에도 멘토 심사 데이터를 읽을 수 있도록
-- 기존 msv_admin_select_all 패턴과 동일한 is_admin() 기반 SELECT 정책 추가 (additive).

drop policy if exists "student_id_images_admin_select" on storage.objects;
create policy "student_id_images_admin_select" on storage.objects
  for select to authenticated
  using (bucket_id = 'student-id-images' and (select is_admin()) = true);

drop policy if exists "mp_admin_select_all" on public.mentor_profiles;
create policy "mp_admin_select_all" on public.mentor_profiles
  for select to authenticated
  using ((select is_admin()) = true);

drop policy if exists "users_admin_select_all" on public.users;
create policy "users_admin_select_all" on public.users
  for select to authenticated
  using ((select is_admin()) = true);