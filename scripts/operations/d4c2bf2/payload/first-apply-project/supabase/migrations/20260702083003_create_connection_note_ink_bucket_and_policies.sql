-- 연결노트 필기 저장용 버킷 (비공개) — scan-annotations와 동일한 방 참여자 정책 패턴
insert into storage.buckets (id, name, public)
values ('connection-note-ink', 'connection-note-ink', false)
on conflict (id) do nothing;

create policy connection_note_ink_obj_insert
on storage.objects for insert to authenticated
with check (
  bucket_id = 'connection-note-ink'
  and exists (
    select 1 from mentor_student_rooms r
    where r.id = ((storage.foldername(objects.name))[1])::uuid
      and ((select auth.uid()) = r.student_id or (select auth.uid()) = r.mentor_id)
  )
);

create policy connection_note_ink_obj_select
on storage.objects for select to authenticated
using (
  bucket_id = 'connection-note-ink'
  and exists (
    select 1 from mentor_student_rooms r
    where r.id = ((storage.foldername(objects.name))[1])::uuid
      and ((select auth.uid()) = r.student_id or (select auth.uid()) = r.mentor_id)
  )
);

create policy connection_note_ink_obj_update
on storage.objects for update to authenticated
using (
  bucket_id = 'connection-note-ink'
  and exists (
    select 1 from mentor_student_rooms r
    where r.id = ((storage.foldername(objects.name))[1])::uuid
      and ((select auth.uid()) = r.student_id or (select auth.uid()) = r.mentor_id)
  )
)
with check (
  bucket_id = 'connection-note-ink'
  and exists (
    select 1 from mentor_student_rooms r
    where r.id = ((storage.foldername(objects.name))[1])::uuid
      and ((select auth.uid()) = r.student_id or (select auth.uid()) = r.mentor_id)
  )
);