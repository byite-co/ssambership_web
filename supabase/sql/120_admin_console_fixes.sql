-- 120_admin_console_fixes.sql
-- 관리자 기능 점검(2026-07-17) 후속 수정 모음. 전 구간 멱등(재실행 안전).
--
-- A. content_reports 상태 CHECK 확장
--    검수 콘솔의 숨김/삭제 처리(updateContentReportModerationAction)가
--    status='hidden'/'removed' 를 쓰지만 032 CHECK가 거부 → 콘텐츠만 변경되고
--    신고 상태 갱신이 실패하는 불일치. 허용값에 두 상태를 추가한다.
-- B. disputes 상태 CHECK 확장
--    제재 액션(applyDisputeSanctionAction)의 on_hold/sanction_* 상태를 허용.
--    기존 CHECK 위반으로 제재 전체(계정 정지 연동 포함)가 첫 UPDATE에서 실패했다.
-- C. 실 DB에만 수동 적용돼 있던 관리자 정책 백포트 (레포 SQL로 재구축 시에도 관리자 콘솔이 동작하도록)
--    - users_admin_select_all / mp_admin_select_all / student_id_images_admin_select
-- D. 게시판 v2 comments 정리
--    - 조건 `true` 인 레거시 공개 정책 3종 제거(삭제된 댓글까지 전체 공개되던 누출).
--      정상 노출은 comments_select_visible(is_deleted=false, anon+authenticated)이 계속 담당.
--    - 관리자 검수용 select(숨김 포함)/update/delete 정책 추가.
-- E. 관리자 증거 열람 보강
--    - question-room-attachments / scan-annotations 버킷과 scan_annotations 테이블에
--      관리자 SELECT 정책 추가(분쟁·신고 검토 시 첨부 확인용, service_role 불필요).

-- ── A. content_reports 상태 CHECK ────────────────────────────────────────────
alter table public.content_reports
  drop constraint if exists content_reports_status_allowed;
alter table public.content_reports
  add constraint content_reports_status_allowed
  check (status = any (array[
    'pending', 'reviewing', 'resolved', 'rejected', 'dismissed',
    'hidden', 'removed'
  ]));

-- ── B. disputes 상태 CHECK ──────────────────────────────────────────────────
alter table public.disputes
  drop constraint if exists disputes_status_check;
alter table public.disputes
  add constraint disputes_status_check
  check (status = any (array[
    'open', 'under_review', 'resolved', 'dismissed', 'escalated',
    'on_hold', 'sanction_7d', 'sanction_30d', 'sanction_permanent'
  ]));

-- ── C. 관리자 정책 백포트 ────────────────────────────────────────────────────
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

-- ── D. comments(게시판 v2) 정책 정리 ─────────────────────────────────────────
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

-- ── E. 관리자 증거 열람(스토리지·주석 테이블) ────────────────────────────────
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
