-- 연결노트 필기 참조 컬럼 (기획서 5-1: 필기 JSON 위치 + 목록용 썸네일 위치)
-- nullable — 기존 행·기존 웹 코드 무영향. 필기 존재 여부는 ink_path is not null 로 판정.
alter table public.connection_notes
  add column if not exists ink_path text,
  add column if not exists ink_thumb_path text;

comment on column public.connection_notes.ink_path is
  '필기 원본(잉크 문서 JSON)의 Storage 경로. 버킷 connection-note-ink, 경로 첫 세그먼트는 room id';
comment on column public.connection_notes.ink_thumb_path is
  '목록 표시용 필기 썸네일 PNG의 Storage 경로 (원본과 분리 저장)';