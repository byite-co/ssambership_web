-- 147_p2_2_community_board_idempotency_softdelete.sql
-- Phase 2-2 게시판: 중복 방지(create_idempotency_key)·soft-delete(deleted_at) 정본 수렴.
--
-- 배경: staging(lbeqxarxothkmzqvpudy)에는 아래 구조가 이전 세션에서 out-of-band 로 이미 적용돼 있으나
--   저장소 SQL 파일에는 없었다(계보 공백). 이 파일은 그 구조를 정본화한다 —
--   전부 IF NOT EXISTS 라 staging 에는 no-op, 신규 DB 에는 동일 구조를 재현한다.
--
-- 계약:
--   * create_idempotency_key: nullable uuid. 클라 요청 UUID. NULL 은 "키 없음"(중복검사 제외).
--   * (author_id, create_idempotency_key) UNIQUE — 동일 작성자+동일 키 재삽입 차단.
--     NULL 은 서로 distinct 하므로 키 없는 삽입은 자유(레거시 호환).
--   * deleted_at: soft-delete 신호. NOT NULL = 삭제됨. hard DELETE 대신 이 컬럼으로만 삭제.
--     상태 CHECK(status)는 건드리지 않는다(status='deleted' 미사용 — deleted_at 이 정본 신호).
-- 선행: 037.

begin;

alter table public.community_posts add column if not exists create_idempotency_key uuid;
alter table public.community_posts add column if not exists deleted_at timestamptz;

-- 동일 작성자+동일 요청키 중복 삽입 차단(ON CONFLICT 타깃). NULL 키는 충돌하지 않음.
create unique index if not exists community_posts_author_idem_key
  on public.community_posts (author_id, create_idempotency_key);

-- 활성(미삭제) 목록 조회 가속.
create index if not exists idx_cp_active_created
  on public.community_posts (created_at desc) where deleted_at is null;

commit;

-- §V(rollback-only): create_idempotency_key·deleted_at 존재 · (author_id,create_idempotency_key) UNIQUE ·
--   동일 키 재삽입은 UNIQUE 위반(23505) → 웹은 ON CONFLICT 로 기존 행 반환 · NULL 키 다중 삽입 허용 ·
--   deleted_at 세팅 후 활성 목록에서 제외 · 행은 보존(관리자 감사).
