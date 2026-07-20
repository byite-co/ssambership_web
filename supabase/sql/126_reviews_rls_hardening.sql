-- --------------------------------------------------------------------------
-- 126_reviews_rls_hardening.sql   (P1-7 · 리뷰 RLS 정본화 — 다세대 정책 정리 + 컬럼 강제)
-- [적용됨 — ssambership-staging 에 2026-07-19 단일 트랜잭션(lock_timeout 3s) 적용·검증 통과
--   (구조 assertion 7 + 역할 스모크 5 전부 PASS). 원장 미기재 — 적용 이력은 docs/audit/sql_apply_manifest.md.]
-- 목적: reviews 의 중복/레거시 정책을 전부 제거하고, 자격검증 INSERT·역할별 UPDATE·
--   숨김/블라인드 보호 SELECT 정책만 남긴다. 행 접근은 정책이, 컬럼 범위는 트리거가 강제.
--   ⚠️ 004의 rev_select USING(true) 가 남으면 모든 SELECT 정책과 OR 결합되어 숨김·블라인드
--      보호가 무력화되므로 반드시 제거한다. 순수 042형/045형의 student_id·author 정책도 제거.
-- 선행: 066 (check_review_eligibility), 123 (reviews 스키마 수렴·fail-closed 상태).
--   is_admin()·check_review_eligibility() 는 이미 존재. 123 로 정책 0개(fail-closed)인 상태에서
--   본 파일이 정본 정책을 다시 연다(적용 전까지 리뷰 트래픽 재개 금지).
-- --------------------------------------------------------------------------

alter table public.reviews enable row level security;

-- 1) 기존 정책 전부 제거 -----------------------------------------------------
-- (a) 알려진 이름 명시 제거 (감사용)
drop policy if exists "rev_select"                     on public.reviews;  -- 004 USING(true) — 치명적
drop policy if exists "rev_ins"                        on public.reviews;  -- 004 (자격 미검증)
drop policy if exists "rev_update_own"                 on public.reviews;  -- 004 (with_check 없음)
drop policy if exists "reviews_select_public"          on public.reviews;  -- 042형 (is_blinded 미검사)
drop policy if exists "reviews_select_public_visible"  on public.reviews;
drop policy if exists "reviews_select_admin"           on public.reviews;
drop policy if exists "reviews_insert_author"          on public.reviews;  -- 구 자격 정책명
drop policy if exists "reviews_insert_student"         on public.reviews;  -- 042형(student_id)/045형(author_id)
drop policy if exists "reviews_update_mentor_reply"    on public.reviews;
drop policy if exists "reviews_update_mentor"          on public.reviews;
drop policy if exists "reviews_admin_moderate"         on public.reviews;
drop policy if exists "reviews_update_admin"           on public.reviews;
drop policy if exists "누구나 리뷰 읽기"                on public.reviews;
drop policy if exists "학생만 리뷰 작성"                on public.reviews;
drop policy if exists "멘토 답글 작성"                  on public.reviews;

-- (b) 그 외 남은 정책까지 이름 불문 전부 제거 (누락 방지 — OR 결합 무력화 봉쇄)
do $$
declare pol record;
begin
  for pol in select policyname from pg_policies where schemaname='public' and tablename='reviews' loop
    execute format('drop policy if exists %I on public.reviews', pol.policyname);
  end loop;
end $$;

-- 2) SELECT 정본 — 공개: 숨김/블라인드 아닌 행만. 관리자: 전체. -----------------
create policy "reviews_select_public_visible" on public.reviews
  for select to anon, authenticated
  using (coalesce(is_hidden, false) = false and coalesce(is_blinded, false) = false);

create policy "reviews_select_admin" on public.reviews
  for select to authenticated
  using ((select public.is_admin()) = true);

-- 3) INSERT 정본 — 자격검증 (author 본인 + 유료 2회+ 구독 이력) --------------------
create policy "reviews_insert_student" on public.reviews
  for insert to authenticated
  with check (
    author_id = (select auth.uid())
    and public.check_review_eligibility(mentor_id, (select auth.uid()))
  );

-- 4) UPDATE 정본 — 행 접근만(컬럼 범위는 5의 트리거) -----------------------------
create policy "reviews_update_mentor" on public.reviews
  for update to authenticated
  using ((select auth.uid()) = mentor_id)
  with check ((select auth.uid()) = mentor_id);

create policy "reviews_update_admin" on public.reviews
  for update to authenticated
  using ((select public.is_admin()) = true)
  with check ((select public.is_admin()) = true);

-- 5) BEFORE UPDATE 트리거 — 역할별 허용 컬럼 강제 --------------------------------
create or replace function public.reviews_enforce_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
  v_is_admin boolean := coalesce((select public.is_admin()), false);
begin
  -- service_role: 시스템 경로 통과
  if coalesce(auth.role(), '') = 'service_role' then
    return new;
  end if;

  -- 공통 불변 보호 필드 (모든 비-service 액터)
  if new.id is distinct from old.id
     or new.mentor_id is distinct from old.mentor_id
     or new.author_id is distinct from old.author_id
     or new.rating is distinct from old.rating
     or new.body is distinct from old.body
     or new.subscription_count is distinct from old.subscription_count
     or new.created_at is distinct from old.created_at then
    raise exception 'reviews: protected columns are immutable';
  end if;

  -- 관리자: is_hidden/is_blinded/moderation_state 만. moderated_* 서버 강제.
  if v_is_admin then
    if new.mentor_reply is distinct from old.mentor_reply
       or new.mentor_replied_at is distinct from old.mentor_replied_at then
      raise exception 'reviews: admin must not change mentor reply fields';
    end if;
    new.moderated_at := now();
    new.moderated_by := v_uid;
    return new;
  end if;

  -- 멘토(본인 리뷰): mentor_reply 만, 1회. moderation 필드 변경 금지. replied_at 서버 강제.
  if v_uid is not null and v_uid = old.mentor_id then
    if new.is_hidden is distinct from old.is_hidden
       or new.is_blinded is distinct from old.is_blinded
       or new.moderation_state is distinct from old.moderation_state
       or new.moderated_at is distinct from old.moderated_at
       or new.moderated_by is distinct from old.moderated_by then
      raise exception 'reviews: mentor must not change moderation fields';
    end if;
    if old.mentor_reply is not null and new.mentor_reply is distinct from old.mentor_reply then
      raise exception 'reviews: mentor reply already set (one-time only)';
    end if;
    if new.mentor_reply is distinct from old.mentor_reply
      then new.mentor_replied_at := now(); else new.mentor_replied_at := old.mentor_replied_at; end if;
    return new;
  end if;

  -- 학생(작성자) 및 그 외: 수정 불가
  raise exception 'reviews: not permitted to update this review';
end;
$$;

drop trigger if exists trg_reviews_enforce_update on public.reviews;
create trigger trg_reviews_enforce_update
  before update on public.reviews
  for each row execute function public.reviews_enforce_update();
