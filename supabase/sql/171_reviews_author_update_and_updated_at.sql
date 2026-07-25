-- 171_reviews_author_update_and_updated_at.sql
-- reviews.updated_at 신설 + 학생(작성자) 리뷰 수정 경로 개통. 오너 확정 4·5 (웨이브 2).
--
-- ── 왜 3계층을 모두 열어야 하는가 (126 실측) ──────────────────────────────────
-- 현행 학생 수정은 **세 겹**으로 막혀 있고, 하나라도 남기면 동작하지 않는다:
--   ① UPDATE 정책이 reviews_update_mentor(126:61) · reviews_update_admin(126:66) 둘뿐 —
--      작성자 정책 자체가 없다.
--   ② 트리거 reviews_enforce_update()(126:72) 의 최종 catch-all(126:127)
--      'reviews: not permitted to update this review' 가 작성자를 거절한다.
--   ③ **공통 불변 보호 필드 가드(126:87-96)가 rating(:91)·body(:92) 를 포함하고,
--      이 가드가 액터 분기보다 먼저 실행된다**(service_role 조기 반환 :83-85 직후).
--
-- ⚠️ 함정: ②만 열고 ③을 그대로 두면 작성자 분기에 도달해도 공통 가드가 먼저 걸려
--    여전히 실패한다. 반대로 ③에서 rating·body 를 통째로 빼면 **멘토·관리자까지
--    학생 리뷰 본문을 고칠 수 있게 되는 권한 회귀**다.
--    → 정답은 공통 가드를 **액터 조건부로 좁히는 것**: rating·body 는 "작성자일 때만"
--      가드 대상에서 제외하고, 그 외 액터에게는 종전대로 불변으로 남긴다.
--
-- ── 작성자가 바꿀 수 있는 것: rating · body 둘뿐 ──────────────────────────────
--   불변(모든 액터): id · mentor_id · author_id · created_at · subscription_count
--   작성자 분기에서 **추가로** 차단하는 7종 — 관리자 분기(126:99-107)가 mentor_reply·
--   mentor_replied_at 을, 멘토 분기(126:110-124)가 is_hidden·is_blinded·moderation_state·
--   moderated_at·moderated_by 를 막는 것과 **대칭**이다. 지금까지 학생은 :127 catch-all 에
--   걸려 아무것도 못 고쳤으므로 이 방어가 필요 없었지만, 작성자 분기를 여는 순간
--   **아무 가드도 없는 통로가 생긴다**.
--   updated_at 은 클라이언트 값을 무시하고 서버가 now() 로 강제한다.
--
-- ── 자격 재검사 안 함 (정본 지정) ─────────────────────────────────────────────
-- 수정 시점에 check_review_eligibility 를 재호출하지 **않는다**. 신기준(170)에서는
-- expired 도 자격이므로 한 번 얻은 자격이 사실상 유지되어 재검사 결과가 같고,
-- 재검사를 넣으면 만료 후 오타 수정이 막히는 부작용만 남는다.
--
-- ── 작성자 전용 SELECT 정책이 필요한 이유 (기존 결함의 표면화) ────────────────
-- 126:44-46 의 reviews_select_public_visible 는 is_hidden/is_blinded 가 false 인 행만 보이고,
-- 나머지 SELECT 정책은 reviews_select_admin(126:48-50) 하나뿐이다 — **작성자 전용 SELECT 정책이 없다**.
-- 따라서 모더레이션된 본인 리뷰는 조회에서 null 이 되고 → UI 가 신규 작성으로 오판 →
-- POST 가 uq_reviews_mentor_author(042:66 · 123:129) 에 막혀 23505 가 난다.
-- 이 결함은 이번 변경이 만드는 것이 아니라 **현재도 존재하며, 편집 모드를 열면 표면화된다**.
--   → reviews_select_author 를 신설한다. 기존 두 SELECT 정책은 무변경 보존.
--   ⚠️ 공개 목록 누출 없음 — 공개 노출 2경로는 RLS 가 아니라 명시 필터에 의존한다:
--      lib/reviews/reviewQueries.ts:36-38 applyPublicFilters(:105-107 적용) 및
--      listMentorReceivedReviews 의 isPubliclyVisibleReview 후처리(:295).
--      **이 두 필터를 제거하면 작성자 정책이 누출 경로가 된다 — 절대 제거 금지.**
--
-- 선행: 042/123(uq_reviews_mentor_author), 126(정책·트리거 정본), 170.

begin;
set local lock_timeout = '5s';

-- ── 1. updated_at 신설 ────────────────────────────────────────────────────────
-- 기존 테이블 관례 계승: reviews.created_at 이 timestamptz NOT NULL DEFAULT now() 이고
-- mentor_profiles·subscriptions·individual_questions 의 updated_at 도 동일 형태다.
-- 실측 0행이므로 백필 부담 없음.
alter table public.reviews
  add column if not exists updated_at timestamptz not null default now();

-- ── 2. RLS — 작성자 SELECT / UPDATE 정책 신설 (기존 정책 무변경 보존) ─────────
drop policy if exists "reviews_select_author" on public.reviews;
create policy "reviews_select_author" on public.reviews
  for select to authenticated
  using (author_id = (select auth.uid()));

drop policy if exists "reviews_update_author" on public.reviews;
create policy "reviews_update_author" on public.reviews
  for update to authenticated
  using ((select auth.uid()) = author_id)
  with check ((select auth.uid()) = author_id);

-- ── 3. 트리거 개정 — 액터 조건부 컬럼 가드 ────────────────────────────────────
create or replace function public.reviews_enforce_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
  v_is_admin boolean := coalesce((select public.is_admin()), false);
  v_is_author boolean;
begin
  -- service_role: 시스템 경로 통과 (126 동작 그대로 보존)
  if coalesce(auth.role(), '') = 'service_role' then
    return new;
  end if;

  -- 관리자가 우연히 작성자이기도 한 경우에는 **관리자 의미론을 우선**한다
  -- (권한이 늘어나지 않는 보수적 방향 — 관리자 분기는 rating·body 를 못 바꾼다).
  v_is_author := (not v_is_admin) and v_uid is not null and v_uid = old.author_id;

  -- 공통 불변 보호 필드 (모든 비-service 액터)
  -- 126:87-96 과 동일하되 rating·body 는 아래에서 액터 조건부로 판정한다.
  if new.id is distinct from old.id
     or new.mentor_id is distinct from old.mentor_id
     or new.author_id is distinct from old.author_id
     or new.subscription_count is distinct from old.subscription_count
     or new.created_at is distinct from old.created_at then
    raise exception 'reviews: protected columns are immutable';
  end if;

  -- rating·body 는 **작성자만** 변경 가능. 멘토·관리자에게는 종전대로 불변.
  if not v_is_author then
    if new.rating is distinct from old.rating
       or new.body is distinct from old.body then
      raise exception 'reviews: protected columns are immutable';
    end if;
  end if;

  -- 관리자: is_hidden/is_blinded/moderation_state 만. moderated_* 서버 강제.
  if v_is_admin then
    if new.mentor_reply is distinct from old.mentor_reply
       or new.mentor_replied_at is distinct from old.mentor_replied_at then
      raise exception 'reviews: admin must not change mentor reply fields';
    end if;
    new.moderated_at := now();
    new.moderated_by := v_uid;
    -- 조정은 "작성자가 마지막으로 수정한 시각"을 건드리지 않는다.
    new.updated_at := old.updated_at;
    return new;
  end if;

  -- 작성자(학생): rating·body 만. 조정·멘토답글 필드 7종 전량 차단. updated_at 서버 강제.
  if v_is_author then
    if new.is_hidden is distinct from old.is_hidden
       or new.is_blinded is distinct from old.is_blinded
       or new.moderation_state is distinct from old.moderation_state
       or new.moderated_at is distinct from old.moderated_at
       or new.moderated_by is distinct from old.moderated_by
       or new.mentor_reply is distinct from old.mentor_reply
       or new.mentor_replied_at is distinct from old.mentor_replied_at then
      raise exception 'reviews: author must not change moderation or mentor reply fields';
    end if;
    new.updated_at := now();   -- 클라이언트 값 무시
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
    -- 멘토 답글은 학생 수정 시각을 건드리지 않는다.
    new.updated_at := old.updated_at;
    return new;
  end if;

  -- 그 외: 수정 불가
  raise exception 'reviews: not permitted to update this review';
end;
$$;

drop trigger if exists trg_reviews_enforce_update on public.reviews;
create trigger trg_reviews_enforce_update
  before update on public.reviews
  for each row execute function public.reviews_enforce_update();

commit;

-- ── §V 검증 SELECT (적용 후 별도 실행) ──
-- select column_name, data_type, is_nullable, column_default
--   from information_schema.columns
--  where table_schema='public' and table_name='reviews' and column_name='updated_at';
-- 기대: updated_at | timestamp with time zone | NO | now()
--
-- select policyname, cmd, roles::text from pg_policies
--  where schemaname='public' and tablename='reviews' order by policyname;
-- 기대 6건: reviews_insert_student(INSERT) · reviews_select_admin(SELECT) ·
--          reviews_select_author(SELECT) · reviews_select_public_visible(SELECT) ·
--          reviews_update_admin(UPDATE) · reviews_update_author(UPDATE) · reviews_update_mentor(UPDATE)
--          → 총 7건
--
-- ── ROLLBACK 절차 ──
--   drop policy if exists "reviews_update_author" on public.reviews;
--   drop policy if exists "reviews_select_author" on public.reviews;
--   -- 트리거 함수는 126_reviews_rls_hardening.sql 의 reviews_enforce_update() 정의를 재적용
--   alter table public.reviews drop column if exists updated_at;
-- 전체 롤백 순서: 171 → 170 → 169 → 168 → 167
