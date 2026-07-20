-- 144_community_shortform_idempotency_softdelete.sql
-- P0-4(게시판 중복·이미지·수정/삭제) · P2-24(숏폼 413/중복) 수렴 보정 — 기존 SQL 미수정, 새 번호로만 추가.
--
-- 담는 것:
--  (1) 생성 멱등키: community_posts·shortform_posts 에 create_idempotency_key(uuid, nullable) +
--      (author_id, create_idempotency_key) UNIQUE. 더블클릭·네트워크 재시도로 finalize 가 두 번 와도
--      같은 키면 두 번째 INSERT 는 충돌 → 기존 행 id 반환(신규 행 없음). 성공 후에만 새 키 생성.
--      NULL 키(레거시 행·키 없는 경로)는 Postgres 에서 서로 distinct 취급이라 UNIQUE 충돌이 없다.
--  (2) 게시판 소프트삭제: community_posts.deleted_at(timestamptz, nullable). hard DELETE 금지 정책의
--      DB 근거. deleted_at IS NOT NULL 행은 일반 목록/상세에서 숨기되 관리자 감사용으로 보존한다.
--
-- 안전: 전부 추가형(ADD COLUMN IF NOT EXISTS + UNIQUE + 인덱스). 기존 데이터·정책·RLS 불변.
-- 선행: 037(community_board_v2), 038(shortform_v2), 129(shortform_author_label).

begin;
set local lock_timeout = '5s';

-- (1) 생성 멱등키 컬럼
alter table public.community_posts add column if not exists create_idempotency_key uuid;
alter table public.shortform_posts add column if not exists create_idempotency_key uuid;

-- (author_id, create_idempotency_key) UNIQUE — NULL 키는 distinct 라 레거시/키없는 행끼리 충돌 없음.
alter table public.community_posts drop constraint if exists community_posts_author_idem_key;
alter table public.community_posts
  add constraint community_posts_author_idem_key unique (author_id, create_idempotency_key);

alter table public.shortform_posts drop constraint if exists shortform_posts_author_idem_key;
alter table public.shortform_posts
  add constraint shortform_posts_author_idem_key unique (author_id, create_idempotency_key);

-- (2) 게시판 소프트삭제 컬럼 + 부분 인덱스(활성 행 조회 가속).
alter table public.community_posts add column if not exists deleted_at timestamptz;
create index if not exists idx_cp_active_created
  on public.community_posts (created_at desc)
  where deleted_at is null;

commit;

-- §검증: (a) 두 테이블에 create_idempotency_key 존재, (b) (author_id, key) UNIQUE 두 건,
--        (c) community_posts.deleted_at 존재 + 활성 부분 인덱스, (d) 기존 행 create_idempotency_key = NULL.
