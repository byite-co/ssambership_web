-- 164_board_comment_bridge_bidirectional_convergence.sql
-- [적용됨 — ssambership-staging 에 2026-07-21 적용(MCP execute_sql 단일 트랜잭션,
--   함수/트리거 커밋 + fixture 는 savepoint ROLLBACK). 적용 전 163 결함 A/B/C 를
--   rollback-only 스크립트로 재현 확정 → 적용 후 T1 + F1~F15 + baseline(F16/F17)
--   전부 PASS. 적용 이력: docs/audit/sql_apply_manifest.md]
-- 163 후속 보정 — 게시판 댓글 브리지의 '교차 수정/삭제' 수렴.
-- 배경(2026-07-21 staging 재현 — rollback-only, 3건 전부 재현 확정):
--   [A] canonical-origin 댓글의 legacy 미러를 구버전 경로(UPDATE)로 고치면
--       cc_sync 가 canonical_comment_id 를 무시하고 legacy_comment_id(=미러 id) 기준
--       upsert 를 해 **canonical 중복 행**을 만든다(원본 미갱신).
--   [B] 같은 미러를 DELETE 하면 legacy_comment_id=old.id 로만 찾아
--       canonical 원본(legacy_comment_id NULL)을 soft-delete 하지 못한다.
--   [C] legacy-origin 의 canonical 행을 신버전이 UPDATE 하면 mirror 함수가
--       legacy_comment_id IS NOT NULL 에서 즉시 return 해 legacy 원본에 반영되지 않는다.
-- 조치(163 파일은 수정하지 않고 함수만 교체 + legacy 매핑 보호 가드 신설):
--   - legacy→canonical: new.canonical_comment_id 가 있으면 그 canonical 행을 FOR UPDATE 잠금,
--     post/author 정합 검증 후 content/is_deleted 만 UPDATE(새 행 생성 금지). 대상 없음·타 post·
--     타 작성자는 명시적 실패. 포인터 없는 legacy-origin 만 기존 멱등 upsert.
--   - legacy DELETE: old.canonical_comment_id 우선, 없으면 legacy_comment_id=old.id 로
--     canonical soft-delete(hard DELETE 금지). 대상 0행이면 성공으로 위장하지 않고 실패.
--   - canonical→legacy: new.legacy_comment_id 가 있으면 return 하지 않고 legacy 원본을 찾아
--     body/status 갱신(매핑 canonical_comment_id=new.id 또는 NULL→세팅, 새 행 생성 금지,
--     불일치·부재는 명시적 실패). canonical-origin 만 기존 canonical_comment_id 미러 upsert.
--   - canonical DELETE 미러: canonical-origin(canonical_comment_id=old.id)과
--     legacy-origin(id=old.legacy_comment_id) 모두 hidden 처리.
--   - 신설 cc_write_guard(BEFORE, 신뢰 안 된 writer 만): INSERT 시 canonical_comment_id
--     직접 지정 금지, UPDATE 시 canonical_comment_id/id/post_id/post_type/author_id/created_at
--     불변(body/status 는 허용 — 관리자 moderation 무영향). SECURITY DEFINER 동기화 경로는
--     GUC/role 로 통과. 숏폼 write 회귀 없음(포인터를 원래 안 보냄).
-- 선행: 163.

begin;

-- ── 0. legacy 매핑 보호 가드(신설) ──────────────────────────────────────────
create or replace function public.cc_write_guard()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if public.comment_sync_in_progress() then return new; end if;
  if current_user not in ('authenticated', 'anon') then return new; end if;

  if tg_op = 'INSERT' then
    if new.canonical_comment_id is not null then
      raise exception 'CC_CANONICAL_ID_FORBIDDEN';
    end if;
    return new;
  end if;

  -- UPDATE: 매핑·식별 필드 불변(body/status 만 수정 가능).
  if new.canonical_comment_id is distinct from old.canonical_comment_id
     or new.id is distinct from old.id
     or new.post_id is distinct from old.post_id
     or new.post_type is distinct from old.post_type
     or new.author_id is distinct from old.author_id
     or new.created_at is distinct from old.created_at then
    raise exception 'CC_PROTECTED_FIELDS_IMMUTABLE';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_cc_write_guard on public.community_comments;
create trigger trg_cc_write_guard
  before insert or update on public.community_comments
  for each row execute function public.cc_write_guard();

-- ── 1. legacy(board) → canonical: 포인터 우선 수렴 ──────────────────────────
create or replace function public.cc_sync_board_to_canonical()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_canonical uuid;
  v_target public.comments;
begin
  if public.comment_sync_in_progress() then return new; end if;
  perform set_config('app.comment_sync', '1', true);

  if new.canonical_comment_id is not null then
    -- 이미 매핑된 행(canonical-origin 미러 포함) → 그 canonical 행만 갱신.
    select * into v_target from public.comments
    where id = new.canonical_comment_id for update;
    if not found then
      raise exception 'COMMENT_BRIDGE_TARGET_MISSING';
    end if;
    if v_target.post_id is distinct from new.post_id then
      raise exception 'COMMENT_BRIDGE_POST_MISMATCH';
    end if;
    if v_target.author_id is distinct from new.author_id then
      raise exception 'COMMENT_BRIDGE_AUTHOR_MISMATCH';
    end if;
    update public.comments
      set content = new.body, is_deleted = (new.status <> 'visible')
    where id = new.canonical_comment_id;
  else
    -- 포인터 없는 legacy-origin 만 멱등 upsert(163 동일) + 포인터 세팅.
    insert into public.comments (post_id, author_id, content, is_deleted, created_at, legacy_comment_id)
    values (new.post_id, new.author_id, new.body, new.status <> 'visible', new.created_at, new.id)
    on conflict (legacy_comment_id) where legacy_comment_id is not null
    do update set content = excluded.content, is_deleted = excluded.is_deleted
    returning id into v_canonical;
    if v_canonical is null then
      select id into v_canonical from public.comments where legacy_comment_id = new.id;
    end if;
    update public.community_comments set canonical_comment_id = v_canonical where id = new.id;
  end if;

  perform set_config('app.comment_sync', '0', true);
  return new;
end;
$$;

-- ── 2. legacy DELETE → canonical soft-delete(포인터 우선) ───────────────────
create or replace function public.cc_sync_board_delete_to_canonical()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_rows int;
begin
  if public.comment_sync_in_progress() then return old; end if;
  perform set_config('app.comment_sync', '1', true);

  if old.canonical_comment_id is not null then
    update public.comments set is_deleted = true where id = old.canonical_comment_id;
  else
    update public.comments set is_deleted = true where legacy_comment_id = old.id;
  end if;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    -- 대상 없음을 성공으로 위장하지 않는다(수렴 실패를 드러냄).
    raise exception 'COMMENT_BRIDGE_TARGET_MISSING';
  end if;

  perform set_config('app.comment_sync', '0', true);
  return old;
end;
$$;

-- ── 3. canonical → legacy: legacy-origin 도 원본 갱신 ───────────────────────
create or replace function public.comments_mirror_to_legacy()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_body text;
  v_rows int;
begin
  if public.comment_sync_in_progress() then return new; end if;
  perform set_config('app.comment_sync', '1', true);

  v_body := left(coalesce(new.content, ''), 1000);

  if new.legacy_comment_id is not null then
    -- legacy-origin: 원본 갱신(새 행 생성 금지, 매핑 일치 확인·NULL 이면 세팅).
    if char_length(btrim(v_body)) >= 1 then
      update public.community_comments
        set body = v_body,
            status = case when coalesce(new.is_deleted, false) then 'hidden' else 'visible' end,
            canonical_comment_id = new.id
      where id = new.legacy_comment_id
        and (canonical_comment_id = new.id or canonical_comment_id is null);
    else
      -- legacy body CHECK(1..1000) 보호 — 상태만 동기화.
      update public.community_comments
        set status = case when coalesce(new.is_deleted, false) then 'hidden' else 'visible' end,
            canonical_comment_id = new.id
      where id = new.legacy_comment_id
        and (canonical_comment_id = new.id or canonical_comment_id is null);
    end if;
    get diagnostics v_rows = row_count;
    if v_rows = 0 then
      -- 원본 부재 또는 매핑 불일치 — 성공으로 위장하지 않는다.
      raise exception 'COMMENT_BRIDGE_LEGACY_MISSING';
    end if;
  else
    -- canonical-origin: 기존 미러 upsert(163 동일). 빈 본문은 미러 생략(CHECK 보호).
    if char_length(btrim(v_body)) >= 1 then
      insert into public.community_comments (post_id, post_type, author_id, body, status, created_at, canonical_comment_id)
      values (new.post_id, 'board', new.author_id, v_body,
              case when coalesce(new.is_deleted, false) then 'hidden' else 'visible' end,
              coalesce(new.created_at, now()), new.id)
      on conflict (canonical_comment_id) where canonical_comment_id is not null
      do update set body = excluded.body, status = excluded.status;
    end if;
  end if;

  perform set_config('app.comment_sync', '0', true);
  return new;
end;
$$;

-- ── 4. canonical DELETE → legacy hidden(양 origin) ──────────────────────────
create or replace function public.comments_mirror_delete_to_legacy()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if public.comment_sync_in_progress() then return old; end if;
  perform set_config('app.comment_sync', '1', true);
  update public.community_comments set status = 'hidden'
  where canonical_comment_id = old.id
     or (old.legacy_comment_id is not null and id = old.legacy_comment_id);
  perform set_config('app.comment_sync', '0', true);
  return old;
end;
$$;

commit;

-- §V(적용 시 함께 실행한 검증 요약):
--   T1 cc_write_guard 트리거 존재, 동기화 함수 4종 교체 확인(secdef+search_path, 포인터 분기 sentinel)
--   F1 legacy-origin 생성 → 양쪽 1행 / F2 legacy-origin canonical 수정 → legacy 원본 갱신
--   F3 legacy-origin canonical soft-delete → legacy hidden / F4 canonical-origin 생성 → 양쪽 1행
--   F5 canonical-origin legacy 수정 → canonical '원본' 갱신 / F6 그 후 canonical 행 수 == 1(중복 0)
--   F7 canonical-origin legacy DELETE → canonical 잔존+soft-delete / F8 동일 수정 3회 → 양쪽 각 1행
--   F9 authenticated INSERT 에 canonical_comment_id → 거부 / F10 UPDATE 로 포인터 변경 → 거부
--   F11 타 post canonical 포인터 → COMMENT_BRIDGE_POST_MISMATCH
--   F12 타 작성자 canonical 포인터 → COMMENT_BRIDGE_AUTHOR_MISMATCH
--   F13 shortform 미동기화 / F14 2-depth·타 post parent 기존 가드 유지
--   F15 canonical(비삭제) == legacy(board·visible) == community_posts.comment_count 일치
--   F16 fixture 전부 savepoint ROLLBACK / F17 새 조회 baseline 0행 복원
--   163 결함 재현 스크립트(A/B/C) → 적용 후 동일 시나리오가 수렴(F5~F7)으로 대체됨을 확인
