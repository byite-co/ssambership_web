-- --------------------------------------------------------------------------
-- 126_reviews_rls_hardening.sql   (P1-7 · 리뷰 RLS 정본화 — 다세대 정책 정리 + 컬럼 강제)
-- 목적: reviews 의 중복/레거시 정책(rev_ins·rev_update_own(with_check 없음)·
--   reviews_select_public(is_blinded 미검사)·"누구나 리뷰 읽기"·"학생만 리뷰 작성"·
--   "멘토 답글 작성")을 전부 제거하고, 자격검증 INSERT·역할별 UPDATE 정책만 남긴다.
--   행 접근은 정책이, 컬럼 범위는 BEFORE UPDATE 트리거가 강제한다.
-- 선행: 123_reviews_converge.sql(스키마 수렴) · 066_review_eligibility_billing_events.sql
--   (check_review_eligibility). is_admin()·check_review_eligibility()는 이미 존재.
-- --------------------------------------------------------------------------

alter table public.reviews enable row level security;

-- 1) 기존 정책 전부 제거 (레거시 + 정본 구본 — 아래에서 정본만 재생성) ----------------
drop policy if exists "reviews_select_public"          on public.reviews;  -- 042형(is_blinded 미검사)
drop policy if exists "누구나 리뷰 읽기"                 on public.reviews;  -- 레거시(is_blinded 미검사)
drop policy if exists "reviews_select_public_visible"   on public.reviews;
drop policy if exists "reviews_select_admin"            on public.reviews;
drop policy if exists "학생만 리뷰 작성"                 on public.reviews;  -- 레거시(자격 미검증)
drop policy if exists "rev_ins"                         on public.reviews;  -- 004형(자격 미검증)
drop policy if exists "reviews_insert_student"          on public.reviews;
drop policy if exists "멘토 답글 작성"                   on public.reviews;  -- 레거시
drop policy if exists "reviews_update_mentor_reply"     on public.reviews;
drop policy if exists "reviews_update_mentor"           on public.reviews;
drop policy if exists "reviews_admin_moderate"          on public.reviews;
drop policy if exists "reviews_update_admin"            on public.reviews;
drop policy if exists "rev_update_own"                  on public.reviews;  -- 004형(with_check 없음 — 위험)

-- 2) SELECT 정본 ------------------------------------------------------------
--   공개: 숨김/블라인드 아닌 행만. 관리자: 전체.
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

-- 4) UPDATE 정본 — 행 접근만 허용(컬럼 범위는 5의 트리거가 강제) --------------------
--   멘토 본인 리뷰: 답글용. 관리자: 모더레이션용. 학생(작성자) UPDATE 정책 없음.
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
    if new.mentor_reply is distinct from old.mentor_reply then
      new.mentor_replied_at := now();
    else
      new.mentor_replied_at := old.mentor_replied_at;
    end if;
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
