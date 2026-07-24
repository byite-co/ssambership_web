-- 165_shortform_posts_mentor_insert_policy_convergence.sql
-- shortform_posts 학생 직접 INSERT 우회 제거 — canonical 멘토 전용 INSERT 로 수렴.
--
-- 배경(2026-07-24 staging 실조회·재현 — rollback-only 픽스처):
--   permissive RLS 는 OR 결합이므로, canonical `sf_insert_mentor`
--   (authenticated, WITH CHECK: is_mentor() AND (author self OR creator self))가
--   있어도 아래 레거시 INSERT 정책이 남아 있으면 학생이 PostgREST 직행으로
--   본인 author_id 행을 INSERT 할 수 있다(서버 액션의 mentor 강제를 우회).
--     [제거 1] "멘토만 업로드"  : TO public,        WITH CHECK (auth.uid() = author_id)
--                                — 이름과 달리 is_mentor 조건이 없음(038 이전 레거시).
--     [제거 2] sp_write_self    : TO authenticated, WITH CHECK (author self OR is_admin())
--                                — 학생 self INSERT 허용 + admin 임의 author 허용(레거시).
--   적용 전 재현(2026-07-24, 트랜잭션 픽스처·전량 정리): 학생 본인 author_id INSERT
--   ALLOWED / 타인 author_id 위조 REJECTED(42501) / 멘토 본인 INSERT ALLOWED.
--
-- 조치(정확히 INSERT 우회 2건만 — 그 외 불변):
--   - canonical `sf_insert_mentor` 가 없거나 하는 사이 삭제된 경우를 대비해 먼저
--     멱등 보장(존재하면 그대로 둠 — 기존 정책 정의 무수정).
--   - "멘토만 업로드", sp_write_self 두 INSERT 정책만 DROP.
--   - sp_update_self · sf_update_own · sf_delete_own · sf_select_published,
--     favorites/storage 정책, 기존 행 데이터는 일절 건드리지 않는다.
--
-- 적용 후 기대(픽스처): 학생 본인 author_id INSERT REJECTED(42501) /
--   멘토 본인 INSERT ALLOWED / 위조 REJECTED / INSERT 정책은 sf_insert_mentor 1건.
-- 선행: 038(shortform v2), 148(멱등키). 후속 없음.

-- 1) canonical mentor INSERT 정책 멱등 보장(부재 시에만 생성 — staging 실측 정의와 동일 식).
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'shortform_posts'
      and policyname = 'sf_insert_mentor' and cmd = 'INSERT'
  ) then
    create policy sf_insert_mentor on public.shortform_posts
      for insert to authenticated
      with check (
        (( select public.is_mentor() ) = true)
        and (
          author_id = ( select auth.uid() )
          or creator_id = ( select auth.uid() )
        )
      );
  end if;
end $$;

-- 2) 학생 직행 INSERT 를 허용하던 레거시 permissive 정책 2건 제거.
drop policy if exists "멘토만 업로드" on public.shortform_posts;
drop policy if exists sp_write_self on public.shortform_posts;

-- 검증 쿼리(참고):
--   select policyname, cmd, roles, with_check from pg_policies
--   where schemaname='public' and tablename='shortform_posts' order by cmd, policyname;
--   기대: INSERT = sf_insert_mentor 1건, UPDATE = sf_update_own·sp_update_self(불변),
--        DELETE = sf_delete_own(불변), SELECT = sf_select_published(불변).
