-- 163_board_comment_canonical_bridge.sql
-- [적용됨 — ssambership-staging 에 2026-07-21 적용(MCP execute_sql 단일 트랜잭션,
--   DDL 커밋 + fixture 는 savepoint ROLLBACK). T1~T2 + S1~S8 + baseline 전부 PASS
--   (양방향 동기화·soft-delete·depth/보호필드/hard-delete 가드·숏폼 제외·수 일치).
--   적용 이력: docs/audit/sql_apply_manifest.md]
-- Track E 게이트 2/2 — 게시판 댓글 legacy(community_comments) ↔ 정본(comments) 호환 브리지.
-- 배경(2026-07-21 staging 실측): 웹·현행 앱 모두 board 댓글을 community_comments 에 쓰고,
--   정본 comments 는 양쪽 다 미사용(두 테이블 모두 0행 — 백필·중복 격리 대상 없음).
--   신버전 앱이 comments 로 전환해도 구버전 앱·현행 웹이 legacy 를 계속 읽고 쓰는 동안
--   양쪽 어디에 써도 서로 보이도록 **양방향 멱등 동기화**로 데이터 갈라짐을 막는다.
--   (숏폼 댓글은 community_comments(post_type='shortform') 유지 — 동기화 대상 아님.)
-- 설계:
--   - 매핑: comments.legacy_comment_id(uuid UNIQUE, legacy 원본 id) /
--           community_comments.canonical_comment_id(uuid UNIQUE, 정본 id) — 중복 방지 UNIQUE.
--   - 재귀 방지: GUC 'app.comment_sync'(트랜잭션 로컬) — 동기화 중 상대 트리거 스킵.
--   - legacy→정본: board INSERT/UPDATE 를 comments 에 upsert(body→content,
--     status<>'visible'→is_deleted). legacy DELETE(관리자 hard delete 정책)는 정본을
--     삭제하지 않고 is_deleted=true 로만 반영(기존 행 자동 삭제 금지).
--   - 정본→legacy: legacy 미러 upsert(content→body 1000자 절단, is_deleted→status hidden).
--     정본 hard DELETE(관리자)도 legacy 는 hidden 처리만. reply(parent)는 legacy 에
--     parent 개념이 없어 평면 미러(구버전 표시 한계 — 전환 공지 사항).
--   - 정본 가드(comments_write_guard, 신뢰 안 된 writer 만):
--     · INSERT: legacy_comment_id 위조 금지 / parent 는 같은 post + 최대 2-depth
--       (parent 의 parent 금지) / 다른 post 부모 참조 거부
--     · UPDATE: 보호필드(id/post_id/author_id/parent_id/created_at/legacy_comment_id/
--       like_count) 불변 — content/is_deleted 만 수정 가능
--     · DELETE: 관리자 외 hard DELETE 거부(soft-delete 강제)
--   - comment count: trg_comments_refresh_count(기존)가 comments 기준으로
--     community_posts.comment_count 를 유지 — 양방향 미러로 legacy 행수와 일치.
-- 선행: 없음(comments/community_comments 는 기존 스키마). 웹 write 경로는 무변경
--   (legacy 에 계속 써도 정본에 동기화됨 — 앱 배포 전 legacy write 제거 금지 원칙 준수).

begin;

-- ── 매핑 컬럼 ────────────────────────────────────────────────────────────────
alter table public.comments
  add column if not exists legacy_comment_id uuid;
create unique index if not exists comments_legacy_comment_id_key
  on public.comments (legacy_comment_id) where legacy_comment_id is not null;

alter table public.community_comments
  add column if not exists canonical_comment_id uuid;
create unique index if not exists community_comments_canonical_id_key
  on public.community_comments (canonical_comment_id) where canonical_comment_id is not null;

-- ── 재귀 방지 헬퍼 ───────────────────────────────────────────────────────────
create or replace function public.comment_sync_in_progress()
returns boolean language sql stable
as $$ select coalesce(current_setting('app.comment_sync', true), '0') = '1' $$;

-- ── 정본 write 가드(신뢰 안 된 writer 만) ────────────────────────────────────
create or replace function public.comments_write_guard()
returns trigger
language plpgsql
set search_path to 'public'
as $$
declare v_parent public.comments;
begin
  if public.comment_sync_in_progress() then
    return coalesce(new, old);
  end if;
  if current_user not in ('authenticated', 'anon') then
    return coalesce(new, old);
  end if;

  if tg_op = 'DELETE' then
    if coalesce((select public.is_admin()), false) then return old; end if;
    raise exception 'COMMENT_HARD_DELETE_FORBIDDEN';
  end if;

  if tg_op = 'INSERT' then
    if new.legacy_comment_id is not null then
      raise exception 'COMMENT_LEGACY_ID_FORBIDDEN';
    end if;
    if new.parent_id is not null then
      select * into v_parent from public.comments where id = new.parent_id;
      if not found then raise exception 'COMMENT_PARENT_NOT_FOUND'; end if;
      if v_parent.post_id is distinct from new.post_id then
        raise exception 'COMMENT_PARENT_POST_MISMATCH';
      end if;
      if v_parent.parent_id is not null then
        raise exception 'COMMENT_DEPTH_EXCEEDED';
      end if;
    end if;
    return new;
  end if;

  -- UPDATE: 보호필드 불변(content/is_deleted 만 허용).
  if new.id is distinct from old.id
     or new.post_id is distinct from old.post_id
     or new.author_id is distinct from old.author_id
     or new.parent_id is distinct from old.parent_id
     or new.created_at is distinct from old.created_at
     or new.legacy_comment_id is distinct from old.legacy_comment_id
     or new.like_count is distinct from old.like_count then
    raise exception 'COMMENT_PROTECTED_FIELDS_IMMUTABLE';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_comments_write_guard on public.comments;
create trigger trg_comments_write_guard
  before insert or update or delete on public.comments
  for each row execute function public.comments_write_guard();

-- ── legacy(board) → 정본 동기화 ─────────────────────────────────────────────
create or replace function public.cc_sync_board_to_canonical()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_canonical uuid;
begin
  if public.comment_sync_in_progress() then return new; end if;
  perform set_config('app.comment_sync', '1', true);

  insert into public.comments (post_id, author_id, content, is_deleted, created_at, legacy_comment_id)
  values (new.post_id, new.author_id, new.body, new.status <> 'visible', new.created_at, new.id)
  on conflict (legacy_comment_id) where legacy_comment_id is not null
  do update set content = excluded.content, is_deleted = excluded.is_deleted
  returning id into v_canonical;

  if v_canonical is null then
    select id into v_canonical from public.comments where legacy_comment_id = new.id;
  end if;
  if new.canonical_comment_id is distinct from v_canonical then
    update public.community_comments set canonical_comment_id = v_canonical where id = new.id;
  end if;

  perform set_config('app.comment_sync', '0', true);
  return new;
end;
$$;

drop trigger if exists trg_cc_sync_board_to_canonical on public.community_comments;
create trigger trg_cc_sync_board_to_canonical
  after insert or update on public.community_comments
  for each row when (new.post_type = 'board')
  execute function public.cc_sync_board_to_canonical();

create or replace function public.cc_sync_board_delete_to_canonical()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if public.comment_sync_in_progress() then return old; end if;
  perform set_config('app.comment_sync', '1', true);
  -- 기존 행 자동 삭제 금지 — soft-delete 만 반영.
  update public.comments set is_deleted = true where legacy_comment_id = old.id;
  perform set_config('app.comment_sync', '0', true);
  return old;
end;
$$;

drop trigger if exists trg_cc_sync_board_delete on public.community_comments;
create trigger trg_cc_sync_board_delete
  after delete on public.community_comments
  for each row when (old.post_type = 'board')
  execute function public.cc_sync_board_delete_to_canonical();

-- ── 정본 → legacy 미러 ──────────────────────────────────────────────────────
create or replace function public.comments_mirror_to_legacy()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_body text;
begin
  if public.comment_sync_in_progress() then return new; end if;
  if new.legacy_comment_id is not null then return new; end if; -- legacy 원본은 A 가 유지.
  v_body := left(coalesce(new.content, ''), 1000);
  if char_length(btrim(v_body)) < 1 then return new; end if; -- legacy CHECK(1..1000) 불충족 시 미러 생략.
  perform set_config('app.comment_sync', '1', true);

  insert into public.community_comments (post_id, post_type, author_id, body, status, created_at, canonical_comment_id)
  values (new.post_id, 'board', new.author_id, v_body,
          case when coalesce(new.is_deleted, false) then 'hidden' else 'visible' end,
          coalesce(new.created_at, now()), new.id)
  on conflict (canonical_comment_id) where canonical_comment_id is not null
  do update set body = excluded.body, status = excluded.status;

  perform set_config('app.comment_sync', '0', true);
  return new;
end;
$$;

drop trigger if exists trg_comments_mirror_to_legacy on public.comments;
create trigger trg_comments_mirror_to_legacy
  after insert or update on public.comments
  for each row execute function public.comments_mirror_to_legacy();

create or replace function public.comments_mirror_delete_to_legacy()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if public.comment_sync_in_progress() then return old; end if;
  perform set_config('app.comment_sync', '1', true);
  -- legacy 미러도 삭제하지 않고 hidden 처리만.
  update public.community_comments set status = 'hidden' where canonical_comment_id = old.id;
  perform set_config('app.comment_sync', '0', true);
  return old;
end;
$$;

drop trigger if exists trg_comments_mirror_delete on public.comments;
create trigger trg_comments_mirror_delete
  after delete on public.comments
  for each row execute function public.comments_mirror_delete_to_legacy();

commit;

-- §V(적용 시 함께 실행한 검증 요약):
--   T1 매핑 컬럼+부분 UNIQUE 2종, 가드/동기화 트리거 5종 존재
--   T2 동기화 함수 4종 SECURITY DEFINER + search_path=public(가드는 invoker)
--   S1 legacy board INSERT(authenticated) → 정본 1행(body→content·매핑 양방향)·중복 0
--   S2 legacy UPDATE(status hidden) → 정본 is_deleted=true
--   S3 legacy DELETE → 정본 행 유지 + is_deleted=true(자동 삭제 없음)
--   S4 정본 INSERT → legacy 미러 1행(visible)·comment_count 반영, 정본 soft-delete →
--      legacy hidden, 정본 DELETE(관리자) → legacy hidden 유지
--   S5 depth: 최상위→답글 OK, 답글의 답글 → COMMENT_DEPTH_EXCEEDED,
--      다른 post 부모 → COMMENT_PARENT_POST_MISMATCH
--   S6 신뢰 안 된 writer: author_id 변조 UPDATE → PROTECTED_FIELDS,
--      비관리자 hard DELETE → HARD_DELETE_FORBIDDEN, legacy_comment_id 위조 INSERT → 거부
--   S7 shortform legacy INSERT → 정본 미생성(동기화 대상 아님)
--   S8 board 댓글 수: comments(비삭제) == community_comments(board·visible) 일치
--   fixture(auth/public users·community_posts·양 테이블) 전부 savepoint ROLLBACK, baseline 0행 복원
