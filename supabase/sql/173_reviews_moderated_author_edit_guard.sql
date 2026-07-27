-- 173_reviews_moderated_author_edit_guard.sql
-- 모더레이션(숨김·블라인드)된 본인 리뷰의 **작성자 수정**을 서버에서 차단한다.
--
-- ── 이 파일이 닫는 결함 ───────────────────────────────────────────────────────
-- 「작성자 분기가 OLD.is_hidden·OLD.is_blinded 를 보지 않아 모더레이션 리뷰가
--   직접 요청으로 수정 가능」
--   171 의 reviews_update_author 정책은 author_id 일치만 보고,
--   트리거 reviews_enforce_update() 의 작성자 분기(171:작성자 블록)도 조정 상태를
--   전혀 읽지 않는다. UI 의 canEdit:false 는 클라이언트 가드일 뿐이라
--   Supabase 직접 호출(PostgREST)로 그대로 우회된다.
--
-- ── 171 검증 주석 정정 (파일은 고치지 않는다) ────────────────────────────────
-- 171 파일 말미 §V 검증 주석의 `-- 기대 6건:` 은 뒤에 정책을 7개 나열하므로
-- **「기대 7건」이 옳다**(171 본문 말미도 "→ 총 7건"으로 스스로 정정하고 있다).
-- 171 은 이미 staging 에 적용되어 **바이트 동일 보존이 원칙**이므로 파일을 수정하지
-- 않고 이 헤더에 정정 기록만 남긴다. 실측 기준값도 7건이다.
--
-- ── 2계층으로 막는다 (둘 다 필수) ────────────────────────────────────────────
--   (가) 트리거: 작성자 분기 최상단에서 OLD 의 조정 상태를 보고 예외를 던진다.
--   (나) RLS   : reviews_update_author 의 USING 에 조정 상태 조건을 더해
--                애초에 대상 행이 보이지 않게 한다.
--
-- ⚠️ 계층 순서가 만드는 결과 — 웹 1행 계약과 묶이는 이유
--    정책 USING 이 먼저 걸리므로 정상 authenticated 경로에서 UPDATE 는 **예외가 아니라
--    0행**으로 끝난다. 즉 (나)만 넣고 애플리케이션이 영향 행 수를 확인하지 않으면
--    사용자에게 「수정 성공」이 표시되는데 실제로는 아무것도 바뀌지 않는다.
--    → lib/reviews/reviewQueries.ts 의 updateReview() 1행 계약과 **같은 라운드에서**
--      함께 닫는다. 한쪽만 적용하면 조용한 무효 수정이 남는다.
--    → 트리거 (가)는 정책을 우회하는 경로(테이블 소유자 세션 등)에 대한 심층 방어다.
--
-- ⚠️ 절대 건드리지 않는 것
--    · reviews_select_author (171): 작성자는 숨김된 본인 리뷰를 **읽을 수 있어야**
--      mode:'edit' + canEdit:false 가 성립한다. SELECT 를 같이 조이면 UI 가 다시
--      신규 작성으로 오판해 uq_reviews_mentor_author 23505 가 난다 — 171 이 닫은
--      결함의 재발이다.
--    · lib/reviews/reviewQueries.ts 의 applyPublicFilters(:34-36) 와
--      listMentorReceivedReviews 의 isPubliclyVisibleReview 후처리(:353):
--      공개 목록의 유일한 차단막이다. 제거 금지.
--    · 관리자 분기(숨김·해제) · 멘토 분기(답글) · service_role 조기 반환:
--      종전 동작 그대로여야 한다. 가드를 작성자 분기 **밖**에 두면 관리자가 숨긴
--      리뷰를 되돌릴 수 없게 되는 권한 회귀다.
--
-- 선행: 126(정책·트리거 정본) · 170 · 171

begin;
set local lock_timeout = '5s';

-- ── 1. 트리거 — 작성자 분기 최상단 가드 ──────────────────────────────────────
-- plpgsql 은 부분 패치가 불가하므로 171 본문 전체를 그대로 재선언하고
-- 작성자 분기의 첫 문장으로 가드 1개만 추가한다. 나머지는 한 글자도 바뀌지 않는다.
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
    -- ★ 173: 모더레이션된 리뷰는 작성자가 수정할 수 없다.
    --   이 가드는 **작성자 분기 안에서만** 동작한다 — 관리자의 숨김 해제와
    --   멘토의 답글은 종전대로 조정된 행에도 적용되어야 하기 때문이다.
    if coalesce(old.is_hidden, false) or coalesce(old.is_blinded, false) then
      raise exception 'reviews: moderated review is not editable by author';
    end if;
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

-- 트리거 자체는 171 에서 이미 붙어 있고 함수만 교체하면 되지만,
-- 재적용 멱등성을 위해 동일 정의로 다시 건다(동작 변화 없음).
drop trigger if exists trg_reviews_enforce_update on public.reviews;
create trigger trg_reviews_enforce_update
  before update on public.reviews
  for each row execute function public.reviews_enforce_update();

-- ── 2. RLS — reviews_update_author USING 강화 ────────────────────────────────
-- USING 에만 조건을 더한다. WITH CHECK 은 171 그대로 — 작성자 분기는 조정 컬럼을
-- 어차피 트리거가 막으므로 WITH CHECK 에 중복 조건을 넣을 이유가 없고,
-- 넣으면 관리자 해제 직후 상태 전이에서 불필요한 거절이 생길 수 있다.
drop policy if exists "reviews_update_author" on public.reviews;
create policy "reviews_update_author" on public.reviews
  for update to authenticated
  using ((select auth.uid()) = author_id
         and coalesce(is_hidden, false) = false
         and coalesce(is_blinded, false) = false)
  with check ((select auth.uid()) = author_id);

commit;

-- ── §V 검증 SELECT (적용 후 별도 실행) ──
-- select policyname, cmd, qual from pg_policies
--  where schemaname='public' and tablename='reviews' order by policyname;
-- 기대 7건(신설·삭제 0). reviews_update_author 의 qual 만 바뀐다:
--   ((SELECT auth.uid()) = author_id)
--     AND (COALESCE(is_hidden,false) = false) AND (COALESCE(is_blinded,false) = false)
-- 나머지 6건(reviews_insert_student · reviews_select_admin · reviews_select_author ·
--   reviews_select_public_visible · reviews_update_admin · reviews_update_mentor)은 무변경.
--
-- select position('moderated review is not editable by author' in prosrc)
--   from pg_proc where proname='reviews_enforce_update';
-- 기대: > 0 (작성자 분기 안에 정확히 1개)
--
-- ── ROLLBACK 절차 ──
--   -- (1) 정책을 171 정의(조건 없는 author_id 비교)로 되돌린다
--   drop policy if exists "reviews_update_author" on public.reviews;
--   create policy "reviews_update_author" on public.reviews
--     for update to authenticated
--     using ((select auth.uid()) = author_id)
--     with check ((select auth.uid()) = author_id);
--   -- (2) 트리거 함수는 171_reviews_author_update_and_updated_at.sql 의
--   --     reviews_enforce_update() 정의를 그대로 재적용한다(가드 1개 제거).
-- 전체 롤백 순서: 173 → 171 → 170 → 169 → 168 → 167
