-- [backfill 2026-08-06] staging 직접 적용분 역반영(원장 20260806033452).
--
-- C16: 연결노트는 (방, 작성자)당 1장이 계약인데 DB 제약이 없어 앱이
-- 중복 내성·자가치유 삭제(e9f1311)로 방어하고 있었다. 유일성 정본을 DB 로
-- 올린다(적용 시점 행 0건 — 정리 불요). 앱의 upsert/중복 방어는 그대로 동작.
alter table public.connection_notes
  add constraint connection_notes_room_author_unique
  unique (mentor_student_room_id, author_id);
