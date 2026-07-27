-- 148_p2_3_shortform_idempotency.sql
-- Phase 2-3 숏폼: 중복 업로드 방지(create_idempotency_key) 정본 수렴.
--
-- 배경: staging 에 create_idempotency_key + (author_id, create_idempotency_key) UNIQUE 가
--   out-of-band 로 이미 적용돼 있으나 저장소 SQL 에는 없었다(계보 공백). 정본화 — IF NOT EXISTS 라
--   staging no-op, 신규 DB 재현.
-- 계약: 요청 UUID 로 더블클릭·재시도에도 1행. NULL 키는 서로 distinct(레거시 무검사 허용).
-- 선행: 038.

begin;

alter table public.shortform_posts add column if not exists create_idempotency_key uuid;

create unique index if not exists shortform_posts_author_idem_key
  on public.shortform_posts (author_id, create_idempotency_key);

commit;

-- §V(rollback-only): create_idempotency_key 존재 · (author_id,create_idempotency_key) UNIQUE ·
--   동일 키 재삽입 23505 → 웹 ON CONFLICT 로 기존 행 반환 · NULL 키 다중 삽입 허용.
