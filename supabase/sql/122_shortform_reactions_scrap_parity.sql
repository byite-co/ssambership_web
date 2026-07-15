-- =============================================================================
-- 122: shortform_reactions 스크랩(scrap) 반응 허용 — post_reactions 와 정합 (XV-SCRAP / P1)
-- =============================================================================
-- 배경(XV-SCRAP): 082 의 shortform_reactions.type CHECK 는 ('like') 만 허용하고,
--   RLS insert 정책도 with check(... and type = 'like') 로 이중 제한한다. 그러나 앱
--   (community_write_repository.dart:toggleShortformReaction)은 게시판과 동일하게
--   type='scrap' 을 insert 하여 숏폼 스크랩(북마크) 기능이 상시 실패한다.
--   게시판 post_reactions(037)는 이미 CHECK ('like','scrap') + RLS insert 는 본인
--   행 조건만(type 무제한) 이라 스크랩이 정상 동작한다 → 숏폼을 동일 수준으로 맞춘다.
--
-- 조치:
--   1) type CHECK 를 ('like','scrap') 로 확장(082 의 자동생성 제약명 교체).
--   2) RLS insert 정책의 type='like' 제약 제거 — 본인 행(user_id=auth.uid())만 유지
--      (post_reactions_insert_own 과 동일 패턴). select/delete 정책은 이미 본인 행
--      조건만이라 변경 불필요.
--   like_count 트리거(082)는 r.type='like' 만 집계하므로 scrap 삽입/삭제는 좋아요
--   수에 영향 없음. unique(user_id, shortform_id, type) 로 사용자당 like 1 + scrap 1.
--
-- 성격: 재실행 안전(if exists/or replace). 기존 like 행·집계 불변. 데이터 이관 없음.
-- 사전 조건: 082(shortform_reactions).
-- 검증: 파일 하단 §V.
-- =============================================================================

begin;

-- 1) type 허용값 확장 (082 의 컬럼 인라인 CHECK 자동생성명: shortform_reactions_type_check)
alter table public.shortform_reactions
  drop constraint if exists shortform_reactions_type_check;

alter table public.shortform_reactions
  add constraint shortform_reactions_type_check
  check (type in ('like', 'scrap'));

-- 2) insert 정책에서 type='like' 제약 제거 (본인 행 조건만 — 게시판과 동일)
drop policy if exists "shortform_reactions_insert_own" on public.shortform_reactions;
create policy "shortform_reactions_insert_own"
  on public.shortform_reactions for insert to authenticated
  with check (user_id = (select auth.uid()));

commit;

-- =============================================================================
-- §V. 적용 직후 검증 (Supabase SQL Editor 에서 수동 실행)
-- =============================================================================
-- §V-0. 제약 확인 — like·scrap 둘 다 허용되는지:
--   select conname, pg_get_constraintdef(oid)
--     from pg_constraint
--    where conrelid = 'public.shortform_reactions'::regclass and contype = 'c';
--   -- 기대: check (type = any (array['like','scrap']))
--
-- §V-a. 스크랩 insert 시뮬레이션 → 성공 기대(rollback 이라 실데이터 없음):
--   begin;
--     set local role authenticated;
--     set local request.jwt.claims = '{"sub":"<uid>","role":"authenticated"}';
--     insert into public.shortform_reactions (user_id, shortform_id, type)
--       values ('<uid>'::uuid, '<shortform_id>'::uuid, 'scrap');
--   rollback;
--
-- §V-b. 잘못된 type → CHECK 위반 기대:
--   insert ... values (..., 'foo');  -- ERROR: violates check constraint
-- =============================================================================
