-- =============================================================================
-- 20260803162808_domain_contract_convergence.sql (수렴 M2)
-- =============================================================================
-- 공용 도메인 계약 수렴 (지시서 §6~§13). 선행조건: 수렴 M1(20260803162257) 적용.
-- 섹션은 독립 검증 가능하게 주석으로 구분하며, 전체는 단일 트랜잭션이다.
--
-- 소유 객체 (§23.2):
--   S1. 멘토 찾기 정본: api_web_v1.mentor_directory_v1 보강(리뷰 집계
--       moderation_state='visible' + 삭제 진행 계정 제외) + legacy RPC 3종
--       (mentor_directory_list_v2 / mentor_profiles_for_directory_v2 /
--        mentor_user_public_v2) anon·authenticated EXECUTE 회수
--   S2. 리뷰 공개 predicate 단일화: RLS(reviews_select_public_visible) ·
--       get_mentor_review_stats · directory 집계 전부
--       moderation_state='visible' AND coalesce(is_hidden,false)=false AND
--       coalesce(is_blinded,false)=false
--   S3. 신고 target 계약: content_reports INSERT allowlist 에서 모호한
--       'shortform' 제거 (신규 쓰기 정본 5종: community_post / shortform_post /
--       board_comment / community_comment / user). 기존 legacy 행은 보존.
--   S4. 숏폼 무결성: INSERT/UPDATE/DELETE 정책에 ugc_write_allowed() 결합,
--       protected-column trigger, view 이벤트 원장 + shortform_view_record_v2,
--       legacy increment_shortform_post_view EXECUTE 회수
--   S5. 숏폼 댓글: author_label 서버 파생 트리거를 shortform 으로 확장 +
--       본인 댓글 soft-delete RPC(community_comment_soft_delete_self) +
--       status CHECK 에 'deleted' 추가
--   S6. IQ 쓰기 게이트: answer_individual_question 에 계정 4종·삭제 진행·차단·
--       멘토 승인 게이트 추가(서명·반환형 불변),
--       add_individual_question_attachment 신규 등록 Storage 검증 fail-closed
--       (object 존재·소유·MIME·크기 — 기존 등록 행 멱등 경로는 불변)
--   S7. 금융 ACL 정리: 정책상 클라이언트 쓰기가 없는 금융 테이블의 잉여
--       write grant 회수 (payments pending intent INSERT ·
--        refunds INSERT(refund_ins) · withdrawals requested INSERT 는 유지)
--   S8. 경고 3회 자동정지 원자 RPC: admin_issue_user_warning
--   S9. favorites 중복(영·한) 정책 정리 — 영문 정본 3종만 유지
--
-- 판단 기록:
--   - release/refund_individual_question 은 학생의 금융 정산 권리 경로라
--     계정상태 차단을 추가하지 않는다(자금 동결 위험 — 당사자·상태·멱등 가드는
--     기존 유지). 콘텐츠 생산 경로(answer)에만 전체 게이트를 추가한다.
--   - increment_community_post_view(게시판)는 이번 지시 범위(§10.5 — 숏폼) 밖이라
--     유지한다.
--
-- rollback 정본: supabase/rollback/20260803162808_domain_contract_convergence_rollback.sql
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 사전 게이트
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  -- M1 적용 확인 (protected trigger + status CHECK)
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.users'::regclass AND tgname='trg_users_protected_columns') THEN
    RAISE EXCEPTION 'M2_BASELINE_MISMATCH: M1 not applied';
  END IF;
  -- 대상 뷰·함수 존재
  IF to_regclass('api_web_v1.mentor_directory_v1') IS NULL THEN
    RAISE EXCEPTION 'M2_BASELINE_MISMATCH: mentor_directory_v1 missing';
  END IF;
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
       WHERE n.nspname='public' AND (p.proname, pg_get_function_identity_arguments(p.oid)) IN
         (('mentor_directory_list_v2','p_limit integer'),
          ('mentor_profiles_for_directory_v2','p_ids uuid[]'),
          ('mentor_user_public_v2','p_mentor_id uuid'),
          ('get_mentor_review_stats','p_mentor_id uuid, p_include_hidden boolean'),
          ('increment_shortform_post_view','p_post_id uuid'),
          ('answer_individual_question','p_question_id uuid, p_body text'),
          ('add_individual_question_attachment','p_question_id uuid, p_storage_path text, p_file_name text, p_mime_type text, p_message_id uuid'),
          ('ugc_write_allowed',''),
          ('qna_users_blocked','p_a uuid, p_b uuid'),
          ('individual_question_user_is_approved_mentor','p_user_id uuid'))) <> 10 THEN
    RAISE EXCEPTION 'M2_BASELINE_MISMATCH: expected function set mismatch';
  END IF;
  -- 신규 객체 선점 없음
  IF to_regclass('public.shortform_view_events') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                 WHERE n.nspname='public' AND p.proname IN
                   ('shortform_view_record_v2','community_comment_soft_delete_self',
                    'admin_issue_user_warning','shortform_posts_protected_guard',
                    'account_deletion_request_self_v2','account_deletion_request_self_consented_v2')) THEN
    RAISE EXCEPTION 'M2_BASELINE_MISMATCH: target object already exists';
  END IF;
  -- S10 대상 구 self RPC 존재 (identity 고정)
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
       WHERE n.nspname='public' AND (p.proname, pg_get_function_identity_arguments(p.oid)) IN
         (('account_deletion_request_self','p_cancelable_minutes integer, p_dry_run boolean'),
          ('account_deletion_request_self_consented','p_cancelable_minutes integer, p_dry_run boolean, p_acknowledged_balance_cents bigint'),
          ('account_deletion_request_consented','p_user_id uuid, p_cancelable_minutes integer, p_dry_run boolean, p_forfeit_consent boolean, p_acknowledged_balance_cents bigint'))) <> 3 THEN
    RAISE EXCEPTION 'M2_BASELINE_MISMATCH: account deletion self RPC set mismatch';
  END IF;
  -- content_reports 기존 INSERT 정책 존재 (교체 대상)
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='content_reports'
                  AND policyname='content_reports_insert_reporter') THEN
    RAISE EXCEPTION 'M2_BASELINE_MISMATCH: content_reports insert policy missing';
  END IF;
  -- community_comments status CHECK (visible/hidden — 'deleted' 확장 대상)
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.community_comments'::regclass
                  AND pg_get_constraintdef(oid) LIKE '%visible%hidden%') THEN
    RAISE EXCEPTION 'M2_BASELINE_MISMATCH: community_comments status CHECK shape';
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- S2(선행). 리뷰 공개 predicate — moderation_state 정본화
--   (S1 의 directory 집계가 같은 predicate 를 쓰므로 먼저 정의)
-- -----------------------------------------------------------------------------
-- 신규 리뷰가 기본 노출되도록 default 정본화 + NULL 백필(스테이징 0행 — no-op).
-- 백필은 reviews_enforce_update 트리거를 잠시 비활성해 수행한다(마이그레이션 소유자
-- 경로 — 트리거는 클라이언트 액터 판정 전용이라 NULL 백필을 액터 없음으로 거부한다).
alter table public.reviews alter column moderation_state set default 'visible';
alter table public.reviews disable trigger trg_reviews_enforce_update;
update public.reviews set moderation_state = 'visible' where moderation_state is null;
alter table public.reviews enable trigger trg_reviews_enforce_update;

drop policy if exists reviews_select_public_visible on public.reviews;
create policy reviews_select_public_visible on public.reviews
  for select to anon, authenticated
  using (
    moderation_state = 'visible'
    and coalesce(is_hidden, false) = false
    and coalesce(is_blinded, false) = false
  );

create or replace function public.get_mentor_review_stats(p_mentor_id uuid, p_include_hidden boolean default false)
returns table(review_count integer, avg_rating numeric, d1 integer, d2 integer, d3 integer, d4 integer, d5 integer)
language plpgsql stable security definer
set search_path to 'public'
as $fn$
declare v_include_hidden boolean := coalesce(p_include_hidden, false);
begin
  if v_include_hidden and not coalesce(public.is_admin(), false) then v_include_hidden := false; end if;
  return query
  select count(*)::integer,
    case when count(*) > 0 then round(avg(r.rating)::numeric, 1) else null end,
    count(*) filter (where round(r.rating)=1)::integer, count(*) filter (where round(r.rating)=2)::integer,
    count(*) filter (where round(r.rating)=3)::integer, count(*) filter (where round(r.rating)=4)::integer,
    count(*) filter (where round(r.rating)=5)::integer
  from public.reviews r
  where r.mentor_id = p_mentor_id
    and (v_include_hidden
         or (r.moderation_state = 'visible'
             and coalesce(r.is_hidden,false)=false
             and coalesce(r.is_blinded,false)=false));
end;
$fn$;

-- -----------------------------------------------------------------------------
-- S1. 멘토 찾기 정본 뷰 보강 + legacy RPC 회수
--   projection·노출 조건은 기존 그대로(role=mentor · status=active ·
--   verification approved/verified/active · full_name 등 비공개 필드 없음).
--   추가: 리뷰 집계 S2 predicate 일치 + 삭제 진행 계정 제외.
-- -----------------------------------------------------------------------------
create or replace view api_web_v1.mentor_directory_v1 as
 SELECT mp.user_id AS mentor_id,
    u.nickname,
    mp.university_name,
    mp.department_name,
    mp.teaching_subjects,
    mp.intro_line,
    mp.profile_image_url,
    mp.high_school_name,
    sv.mentor_id IS NOT NULL AS school_verified,
    sv.school_tier,
    sv.verified_major_category,
    sv.verified_university_name,
    sv.verified_department_name,
    mp.is_open_for_subscriptions,
    rv.avg_rating,
    rv.review_count,
    mp.created_at
   FROM mentor_profiles mp
     JOIN users u ON u.id = mp.user_id
     LEFT JOIN LATERAL ( SELECT msv.mentor_id,
            msv.school_tier,
            msv.verified_major_category,
            msv.verified_university_name,
            msv.verified_department_name
           FROM mentor_school_verifications msv
          WHERE msv.mentor_id = mp.user_id AND msv.status = 'approved'::text
          ORDER BY (COALESCE(msv.reviewed_at, msv.updated_at, msv.created_at)) DESC, msv.created_at DESC
         LIMIT 1) sv ON true
     LEFT JOIN LATERAL ( SELECT avg(r.rating) AS avg_rating,
            count(*)::integer AS review_count
           FROM reviews r
          WHERE r.mentor_id = mp.user_id
            AND r.moderation_state = 'visible'::text
            AND COALESCE(r.is_hidden, false) = false
            AND COALESCE(r.is_blinded, false) = false) rv ON true
  WHERE u.role = 'mentor'::text
    AND lower(COALESCE(u.status, 'active'::text)) = 'active'::text
    AND (lower(COALESCE(mp.verification_status, ''::text)) = ANY (ARRAY['approved'::text, 'verified'::text, 'active'::text]))
    -- 삭제 진행 중 계정 제외 (state 목록 = account_deletion_active_states() 정본과 일치;
    -- definer 뷰에서 함수 EXECUTE 의존을 피하려 리터럴로 고정)
    AND NOT EXISTS (
      SELECT 1 FROM account_deletion_jobs j
       WHERE j.user_id = mp.user_id
         AND j.state = ANY (ARRAY['pending','locked','purging','storage_purged','finalized','auth_soft_deleted']));

alter view api_web_v1.mentor_directory_v1 set (security_invoker = false);

-- legacy RPC 회수 — 웹·앱 신규 코드 호출부 0 (이번 수렴에서 앱 전환 완료).
-- service_role/postgres EXECUTE 는 유지(내부·비상 경로).
revoke execute on function public.mentor_directory_list_v2(integer) from public, anon, authenticated;
revoke execute on function public.mentor_profiles_for_directory_v2(uuid[]) from public, anon, authenticated;
revoke execute on function public.mentor_user_public_v2(uuid) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- S3. 신고 target 계약 — INSERT allowlist 에서 'shortform' 제거
-- -----------------------------------------------------------------------------
drop policy if exists content_reports_insert_reporter on public.content_reports;
create policy content_reports_insert_reporter on public.content_reports
  for insert to authenticated
  with check (
    reporter_id = (select auth.uid())
    and status = 'pending'::text
    and admin_note is null
    and resolved_by is null
    and resolved_at is null
    and target_type = any (array['community_post'::text, 'shortform_post'::text,
                                 'community_comment'::text, 'board_comment'::text, 'user'::text])
    and (target_type <> 'user'::text or public.report_target_user_valid(target_id))
  );

-- -----------------------------------------------------------------------------
-- S4. 숏폼 무결성
-- -----------------------------------------------------------------------------
-- (a) 계정 게이트 결합 정책 교체
drop policy if exists sf_insert_mentor on public.shortform_posts;
create policy sf_insert_mentor on public.shortform_posts
  for insert to authenticated
  with check (
    (select public.is_mentor()) = true
    and (author_id = (select auth.uid()) or creator_id = (select auth.uid()))
    and (select public.ugc_write_allowed())
  );

drop policy if exists sf_update_own on public.shortform_posts;
drop policy if exists sp_update_self on public.shortform_posts;
create policy sf_update_own on public.shortform_posts
  for update to authenticated
  using (
    (author_id = (select auth.uid()) or creator_id = (select auth.uid()))
    and (select public.ugc_write_allowed())
  )
  with check (
    (author_id = (select auth.uid()) or creator_id = (select auth.uid()))
  );
create policy sf_update_admin on public.shortform_posts
  for update to authenticated
  using ((select public.is_admin()) = true)
  with check ((select public.is_admin()) = true);

drop policy if exists sf_delete_own on public.shortform_posts;
create policy sf_delete_own on public.shortform_posts
  for delete to authenticated
  using (
    (author_id = (select auth.uid()) or creator_id = (select auth.uid()))
    and (select public.ugc_write_allowed())
  );

-- (b) protected-column trigger — 클라이언트 역할 비관리자의 소유 행 UPDATE 에서
--     식별·귀속·카운터·서버 관리 필드 변조 거부. 허용 콘텐츠 필드:
--     title/body/description/category/tags/video_url/thumbnail_url +
--     status 는 draft<->published 전이만. updated_at 은 서버 강제.
create function public.shortform_posts_protected_guard()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $fn$
begin
  -- SECURITY INVOKER 필수 — current_user 게이트가 실제 클라이언트 역할을 봐야 한다.
  if current_user not in ('anon','authenticated') then
    return new;
  end if;
  if coalesce((select public.is_admin()), false) then
    return new;
  end if;
  if new.id                   is distinct from old.id
     or new.author_id            is distinct from old.author_id
     or new.creator_id           is distinct from old.creator_id
     or new.author_role          is distinct from old.author_role
     or new.author_label         is distinct from old.author_label
     or new.source               is distinct from old.source
     or new.created_at           is distinct from old.created_at
     or new.view_count           is distinct from old.view_count
     or new.like_count           is distinct from old.like_count
     or new.create_idempotency_key is distinct from old.create_idempotency_key then
    raise exception 'SHORTFORM_PROTECTED_COLUMNS' using errcode = '42501';
  end if;
  if new.status is distinct from old.status then
    if not (old.status in ('draft','published') and new.status in ('draft','published')) then
      raise exception 'SHORTFORM_STATUS_TRANSITION_FORBIDDEN' using errcode = '42501';
    end if;
  end if;
  new.updated_at := now();
  return new;
end
$fn$;

revoke execute on function public.shortform_posts_protected_guard() from public, anon, authenticated;

create trigger trg_shortform_posts_protected
  before update on public.shortform_posts
  for each row execute function public.shortform_posts_protected_guard();

-- (c) view 이벤트 원장 + v2 RPC (한 impression 당 event key 1개 — 멱등)
create table public.shortform_view_events (
  post_id        uuid not null references public.shortform_posts(id) on delete cascade,
  event_key      uuid not null,
  viewer_user_id uuid,
  created_at     timestamptz not null default now(),
  primary key (post_id, event_key)
);
alter table public.shortform_view_events enable row level security;
-- 클라이언트 정책 없음 — 쓰기·읽기 전부 RPC/서버 경로 (definer)
revoke all on table public.shortform_view_events from public, anon, authenticated;

create function public.shortform_view_record_v2(p_post_id uuid, p_event_key uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_uid uuid := (select auth.uid());
  v_inserted boolean := false;
begin
  if p_post_id is null or p_event_key is null then
    raise exception 'INVALID_INPUT' using errcode = '22023';
  end if;
  -- 게시 상태 공개 글만 계수
  if not exists (select 1 from public.shortform_posts sp
                  where sp.id = p_post_id and sp.status = 'published') then
    raise exception 'POST_NOT_FOUND' using errcode = 'P0001';
  end if;

  insert into public.shortform_view_events (post_id, event_key, viewer_user_id)
  values (p_post_id, p_event_key, v_uid)
  on conflict (post_id, event_key) do nothing;
  v_inserted := found;

  if v_inserted then
    update public.shortform_posts
       set view_count = view_count + 1
     where id = p_post_id;
  end if;

  -- 중복 key 는 idempotent success (계수 증가 없음)
  return jsonb_build_object('ok', true, 'contract_version', 1, 'incremented', v_inserted);
end
$fn$;

revoke execute on function public.shortform_view_record_v2(uuid, uuid) from public;
grant execute on function public.shortform_view_record_v2(uuid, uuid) to anon, authenticated;

-- legacy 무제한 +1 RPC 회수 (정의는 rollback 을 위해 남기되 클라이언트 호출 불가)
revoke execute on function public.increment_shortform_post_view(uuid) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- S5. 숏폼 댓글 — 서버 파생 author_label 확장 + 본인 soft-delete
-- -----------------------------------------------------------------------------
-- (a) label 트리거를 shortform 에도 적용 (기존 board 트리거는 불변 — bridge 순수성 유지)
create trigger trg_cc_set_author_label_shortform_ins
  before insert on public.community_comments
  for each row when (new.post_type = 'shortform'::text)
  execute function public.community_comments_set_author_label();

create trigger trg_cc_set_author_label_shortform_upd
  before update of author_label on public.community_comments
  for each row when (old.post_type = 'shortform'::text)
  execute function public.community_comments_set_author_label();

-- (b) status CHECK 확장: 'deleted' (본인 삭제) — 관리자 'hidden' 과 구분
alter table public.community_comments drop constraint if exists community_comments_status_check;
alter table public.community_comments
  add constraint community_comments_status_check
  check (status = any (array['visible'::text, 'hidden'::text, 'deleted'::text]));

-- (c) 본인 숏폼 댓글 soft-delete RPC (hard delete 금지 — §10.6)
--     board 댓글은 기존 웹 계약(comments.is_deleted soft-delete)을 그대로 사용하며
--     이 RPC 는 shortform 전용이다(bridge 에 숏폼 미혼입).
create function public.community_comment_soft_delete_self(p_comment_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_uid uuid := (select auth.uid());
  v_row public.community_comments%rowtype;
  v_status text;
  v_susp timestamptz;
  v_norm text;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;

  select * into v_row from public.community_comments where id = p_comment_id for update;
  if not found then
    raise exception 'COMMENT_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_row.post_type <> 'shortform' then
    raise exception 'COMMENT_TYPE_NOT_SUPPORTED' using errcode = '22023';
  end if;
  if v_row.author_id is distinct from v_uid then
    raise exception 'COMMENT_NOT_OWNED' using errcode = '42501';
  end if;

  -- 계정 게이트 (Build 13 판정과 동일: banned·유효 suspended·unknown/deleted·삭제 진행 차단)
  select u.status, u.suspended_until into v_status, v_susp from public.users u where u.id = v_uid;
  if not found then raise exception 'ACCOUNT_NOT_ACTIVE'; end if;
  v_norm := lower(btrim(coalesce(v_status,'')));
  if v_norm = 'banned' then raise exception 'ACCOUNT_BANNED'; end if;
  if v_norm = 'suspended' and (v_susp is null or v_susp > now()) then raise exception 'ACCOUNT_SUSPENDED'; end if;
  if v_norm not in ('active','suspended') then raise exception 'ACCOUNT_NOT_ACTIVE'; end if;
  if public.account_deletion_write_blocked(v_uid) then raise exception 'ACCOUNT_DELETION_IN_PROGRESS'; end if;

  if v_row.status = 'deleted' then
    return jsonb_build_object('ok', true, 'contract_version', 1, 'comment_id', p_comment_id, 'idempotent_hit', true);
  end if;
  if v_row.status <> 'visible' then
    -- 관리자 hidden 처리된 댓글은 본인이 삭제로 덮지 못한다 (moderation 유지)
    raise exception 'COMMENT_MODERATED' using errcode = '42501';
  end if;

  update public.community_comments set status = 'deleted' where id = p_comment_id;

  return jsonb_build_object('ok', true, 'contract_version', 1, 'comment_id', p_comment_id, 'idempotent_hit', false);
end
$fn$;

revoke execute on function public.community_comment_soft_delete_self(uuid) from public, anon;
grant execute on function public.community_comment_soft_delete_self(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- S6. IQ 쓰기 게이트
-- -----------------------------------------------------------------------------
-- (a) answer_individual_question — 계정·차단·승인 게이트 추가 (서명·반환형·기존
--     당사자/상태/멱등 의미 불변; iq_append_message 와 동일 게이트 순서)
create or replace function public.answer_individual_question(p_question_id uuid, p_body text)
returns setof public.individual_questions
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_question public.individual_questions%rowtype;
  v_mentor_id uuid;
  v_status text; v_susp timestamptz; v_norm text;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;

  if coalesce(btrim(p_body), '') = '' then
    raise exception 'INVALID_INPUT: body is required' using errcode = '22023';
  end if;

  select *
    into v_question
  from public.individual_questions
  where id = p_question_id
  for update;

  if not found then
    raise exception 'QUESTION_NOT_FOUND' using errcode = 'P0001';
  end if;

  -- payout 과 동일한 멘토 해석(open=claimed, direct=designated).
  v_mentor_id := coalesce(v_question.claimed_mentor_id, v_question.designated_mentor_id);
  if v_mentor_id is null or v_mentor_id <> v_uid then
    raise exception 'NOT_QUESTION_MENTOR' using errcode = '42501';
  end if;

  -- 계정 상태 4종 + 삭제 진행 + 상호 차단 + 멘토 승인 (수렴 M2 — iq_append_message 동일 게이트)
  select u.status, u.suspended_until into v_status, v_susp from public.users u where u.id = v_uid;
  if not found then raise exception 'ACCOUNT_NOT_ACTIVE'; end if;
  v_norm := lower(btrim(coalesce(v_status,'')));
  if v_norm = 'banned' then raise exception 'ACCOUNT_BANNED'; end if;
  if v_norm = 'suspended' and (v_susp is null or v_susp > now()) then raise exception 'ACCOUNT_SUSPENDED'; end if;
  if v_norm not in ('active','suspended') then raise exception 'ACCOUNT_NOT_ACTIVE'; end if;
  if public.account_deletion_write_blocked(v_uid) then raise exception 'ACCOUNT_DELETION_IN_PROGRESS'; end if;
  if public.qna_users_blocked(v_question.student_id, v_mentor_id) then raise exception 'BLOCKED'; end if;
  if not public.individual_question_user_is_approved_mentor(v_mentor_id) then
    raise exception 'MENTOR_NOT_APPROVED';
  end if;

  if v_question.status not in ('claimed', 'assigned') then
    raise exception 'NOT_ANSWERABLE_STATUS:%', v_question.status using errcode = 'P0001';
  end if;

  insert into public.individual_question_messages (question_id, author_id, body)
  values (p_question_id, v_uid, p_body);

  update public.individual_questions
  set status = 'answered',
      answered_at = coalesce(answered_at, now())
  where id = p_question_id
  returning * into v_question;

  return next v_question;
end;
$function$;

-- (b) add_individual_question_attachment — 신규 등록만 Storage fail-closed 강화.
--     기존 등록 행의 멱등 경로(선조회 → existing 봉투)는 Storage 검증 없이 그대로
--     통과시켜 §12.1 멱등·수렴 계약을 보존한다. 반환 봉투 키·의미 전부 불변.
create or replace function public.add_individual_question_attachment(p_question_id uuid, p_storage_path text, p_file_name text, p_mime_type text, p_message_id uuid default null::uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid  uuid := (select auth.uid());
  v_path text;
  v_id   uuid;
  v_existing_message_id uuid;
  v_created boolean := false;
  v_status text; v_susp timestamptz; v_norm text;
  v_obj_owner text;
  v_obj_meta jsonb;
  v_obj_found boolean := false;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;

  v_path := btrim(coalesce(p_storage_path, ''));
  if v_path = '' then
    raise exception 'INVALID_INPUT: storage_path is required' using errcode = '22023';
  end if;

  if not public.user_is_individual_question_party(p_question_id) then
    raise exception 'NOT_QUESTION_PARTY' using errcode = '42501';
  end if;

  if split_part(v_path, '/', 1) <> p_question_id::text then
    raise exception 'STORAGE_PATH_MISMATCH' using errcode = '22023';
  end if;

  if p_message_id is not null and not exists (
    select 1
    from public.individual_question_messages m
    where m.id = p_message_id
      and m.question_id = p_question_id
  ) then
    raise exception 'MESSAGE_NOT_IN_QUESTION' using errcode = '22023';
  end if;

  -- 멱등 선조회: 이미 등록된 (question_id, storage_path) 는 기존 계약 그대로 반환
  -- (legacy 객체 읽기·기존 등록 행을 깨지 않는다 — 신규 등록만 아래에서 fail-closed)
  select a.id, a.message_id
    into v_id, v_existing_message_id
  from public.individual_question_attachments a
  where a.question_id = p_question_id
    and a.storage_path = v_path;

  if v_id is null then
    -- === 신규 등록 검증 (수렴 M2 §12.6) ===
    -- 계정 상태 4종 + 삭제 진행
    select u.status, u.suspended_until into v_status, v_susp from public.users u where u.id = v_uid;
    if not found then raise exception 'ACCOUNT_NOT_ACTIVE'; end if;
    v_norm := lower(btrim(coalesce(v_status,'')));
    if v_norm = 'banned' then raise exception 'ACCOUNT_BANNED'; end if;
    if v_norm = 'suspended' and (v_susp is null or v_susp > now()) then raise exception 'ACCOUNT_SUSPENDED'; end if;
    if v_norm not in ('active','suspended') then raise exception 'ACCOUNT_NOT_ACTIVE'; end if;
    if public.account_deletion_write_blocked(v_uid) then raise exception 'ACCOUNT_DELETION_IN_PROGRESS'; end if;

    -- Storage object 존재·소유·MIME·크기 (bucket=individual-question-attachments 고정)
    select o.owner_id, o.metadata into v_obj_owner, v_obj_meta
      from storage.objects o
     where o.bucket_id = 'individual-question-attachments'
       and o.name = v_path;
    v_obj_found := found;
    if not v_obj_found then
      raise exception 'STORAGE_OBJECT_NOT_FOUND' using errcode = '22023';
    end if;
    if v_obj_owner is null or v_obj_owner <> v_uid::text then
      raise exception 'STORAGE_OBJECT_NOT_OWNED' using errcode = '42501';
    end if;
    if v_obj_meta ? 'mimetype'
       and coalesce(nullif(btrim(p_mime_type), ''), '(none)') <> (v_obj_meta->>'mimetype') then
      raise exception 'MIME_MISMATCH' using errcode = '22023';
    end if;
    if p_mime_type is not null and btrim(p_mime_type) <> '' and not exists (
      select 1 from storage.buckets b
       where b.id = 'individual-question-attachments'
         and (b.allowed_mime_types is null or btrim(p_mime_type) = any (b.allowed_mime_types))
    ) then
      raise exception 'MIME_NOT_ALLOWED' using errcode = '22023';
    end if;
    if v_obj_meta ? 'size' and (v_obj_meta->>'size')::bigint > 20971520 then
      raise exception 'SIZE_EXCEEDED' using errcode = '22023';
    end if;

    insert into public.individual_question_attachments
      (question_id, message_id, storage_path, file_name, mime_type, author_id)
    values
      (p_question_id, p_message_id, v_path, p_file_name, p_mime_type, v_uid)
    on conflict (question_id, storage_path) do nothing
    returning id into v_id;

    if v_id is not null then
      v_created := true;
    else
      select a.id, a.message_id
        into v_id, v_existing_message_id
      from public.individual_question_attachments a
      where a.question_id = p_question_id
        and a.storage_path = v_path;

      if v_id is null then
        raise exception 'REGISTER_CONFLICT_UNRESOLVED' using errcode = '40001';
      end if;
    end if;
  end if;

  return jsonb_build_object(
    'ok',            true,
    'status',        case when v_created then 'created' else 'existing' end,
    'idempotent_hit', not v_created,
    'attachment_id', v_id,
    'question_id',   p_question_id,
    'storage_path',  v_path,
    'message_id_mismatch',
      case when v_created then false
           else coalesce(v_existing_message_id, '00000000-0000-0000-0000-000000000000'::uuid)
                is distinct from coalesce(p_message_id, '00000000-0000-0000-0000-000000000000'::uuid)
      end
  );
end;
$function$;

-- -----------------------------------------------------------------------------
-- S7. 금융 ACL 정리 — RLS 가 이미 거부하는 잉여 write grant 회수 (defense-in-depth)
--     유지: payments INSERT(pending intent 정책) · refunds INSERT(refund_ins) ·
--           withdrawals INSERT(requested 정책) — 제품 계약상 필요한 클라이언트 쓰기
-- -----------------------------------------------------------------------------
revoke insert, update, delete, truncate, references, trigger on table
  public.cash_wallets, public.cash_ledger, public.subscriptions,
  public.cash_topup_packages, public.subscription_billing_events, public.order_payments,
  public.payments, public.refunds, public.withdrawals, public.user_warnings
from anon;

revoke update, delete, truncate, references, trigger on table
  public.cash_wallets, public.cash_ledger, public.subscriptions,
  public.cash_topup_packages, public.subscription_billing_events, public.order_payments,
  public.payments, public.refunds, public.withdrawals
from authenticated;

revoke insert on table
  public.cash_wallets, public.cash_ledger, public.subscriptions,
  public.cash_topup_packages, public.subscription_billing_events, public.order_payments
from authenticated;

-- user_warnings: 클라이언트 정책 0 — 쓰기는 admin_issue_user_warning/service 경로만
revoke insert, update, delete, truncate, references, trigger on table public.user_warnings from authenticated;

-- -----------------------------------------------------------------------------
-- S8. 경고 3회 자동정지 원자 RPC (§18.3)
-- -----------------------------------------------------------------------------
create function public.admin_issue_user_warning(
  p_user_id  uuid,
  p_reason   text,
  p_severity text default 'normal'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_actor uuid := (select auth.uid());
  v_is_service boolean := (coalesce((select auth.role()), '') = 'service_role');
  v_target_role text;
  v_reason text;
  v_severity text;
  v_warning_id uuid;
  v_active_count integer;
  v_auto_suspended boolean := false;
  v_suspended_until timestamptz;
begin
  -- caller: admin 세션 또는 service_role
  if not v_is_service and not coalesce((select public.is_admin()), false) then
    raise exception 'ADMIN_ONLY' using errcode = '42501';
  end if;
  if p_user_id is null then
    raise exception 'TARGET_REQUIRED' using errcode = '22023';
  end if;
  if v_actor is not null and v_actor = p_user_id then
    raise exception 'SELF_WARNING_FORBIDDEN' using errcode = '42501';
  end if;

  v_reason := nullif(btrim(coalesce(p_reason, '')), '');
  if v_reason is null then
    raise exception 'REASON_REQUIRED' using errcode = '22023';
  end if;
  v_severity := lower(btrim(coalesce(p_severity, 'normal')));
  if v_severity not in ('normal','severe') then
    raise exception 'SEVERITY_INVALID' using errcode = '22023';
  end if;

  select u.role into v_target_role from public.users u where u.id = p_user_id for update;
  if not found then
    raise exception 'TARGET_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_target_role = 'admin' then
    raise exception 'ADMIN_TARGET_FORBIDDEN' using errcode = '42501';
  end if;

  insert into public.user_warnings (user_id, issued_by, reason, severity, source, is_active)
  values (p_user_id, v_actor, v_reason, v_severity, 'admin', true)
  returning id into v_warning_id;

  select count(*) into v_active_count
    from public.user_warnings w
   where w.user_id = p_user_id and w.is_active = true;

  -- 3회 이상 → 7일 suspended (경고 INSERT 와 동일 트랜잭션 — 부분 성공 불가)
  if v_active_count >= 3 then
    v_suspended_until := now() + interval '7 days';
    update public.users
       set status = 'suspended',
           suspended_until = v_suspended_until,
           status_reason = 'auto_suspend_warnings_' || v_active_count,
           status_changed_at = now(),
           status_changed_by = v_actor,
           updated_at = now()
     where id = p_user_id;
    v_auto_suspended := true;
  end if;

  return jsonb_build_object(
    'ok', true,
    'contract_version', 1,
    'warning_id', v_warning_id,
    'active_warning_count', v_active_count,
    'auto_suspended', v_auto_suspended,
    'suspended_until', v_suspended_until
  );
end
$fn$;

revoke execute on function public.admin_issue_user_warning(uuid, text, text) from public, anon;
grant execute on function public.admin_issue_user_warning(uuid, text, text) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- S9. favorites 중복 정책 정리 — 영문 정본 3종 유지, 한글 중복 3종 제거
-- -----------------------------------------------------------------------------
drop policy if exists "본인 찜만 조회" on public.favorites;
drop policy if exists "본인만 찜 삭제" on public.favorites;
drop policy if exists "본인만 찜 추가" on public.favorites;

-- -----------------------------------------------------------------------------
-- S10. 계정 삭제 self v2 — 취소창 30분·dry_run=false 서버 고정 (§16.4)
--      구 self RPC(클라이언트 p_cancelable_minutes/p_dry_run 수용)는
--      authenticated EXECUTE 회수(운영 도구용 service_role 경로만 유지).
-- -----------------------------------------------------------------------------
create function public.account_deletion_request_self_v2()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_uid uuid := (select auth.uid());
  v_raw jsonb;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED' using errcode = '28000'; end if;
  perform pg_advisory_xact_lock(hashtextextended('account_deletion_self:' || v_uid::text, 0));
  -- 취소창·dry_run 은 서버 고정값 — 클라이언트 입력 없음
  v_raw := public.account_deletion_request_consented(v_uid, 30, false, false, null);
  return public.account_deletion_self_response(v_uid, v_raw);
end
$fn$;

revoke execute on function public.account_deletion_request_self_v2() from public, anon;
grant execute on function public.account_deletion_request_self_v2() to authenticated, service_role;

create function public.account_deletion_request_self_consented_v2(p_acknowledged_balance_cents bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_uid uuid := (select auth.uid());
  v_raw jsonb;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED' using errcode = '28000'; end if;
  perform pg_advisory_xact_lock(hashtextextended('account_deletion_self:' || v_uid::text, 0));
  v_raw := public.account_deletion_request_consented(v_uid, 30, false, true, p_acknowledged_balance_cents);
  return public.account_deletion_self_response(v_uid, v_raw);
end
$fn$;

revoke execute on function public.account_deletion_request_self_consented_v2(bigint) from public, anon;
grant execute on function public.account_deletion_request_self_consented_v2(bigint) to authenticated, service_role;

revoke execute on function public.account_deletion_request_self(integer, boolean) from public, anon, authenticated;
revoke execute on function public.account_deletion_request_self_consented(integer, boolean, bigint) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 자가 검증
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  -- S1: legacy RPC 회수
  IF has_function_privilege('anon', 'public.mentor_directory_list_v2(integer)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.mentor_directory_list_v2(integer)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.mentor_profiles_for_directory_v2(uuid[])', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.mentor_user_public_v2(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'M2_SELFCHECK: legacy mentor RPC still executable';
  END IF;
  -- S1: 뷰 projection 에 full_name 부재
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema='api_web_v1' AND table_name='mentor_directory_v1'
                AND column_name IN ('full_name','email','birth_date','status_reason')) THEN
    RAISE EXCEPTION 'M2_SELFCHECK: mentor_directory_v1 leaks private columns';
  END IF;
  -- S2: 리뷰 공개 정책에 moderation_state 포함
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='reviews'
                  AND policyname='reviews_select_public_visible'
                  AND qual LIKE '%moderation_state%') THEN
    RAISE EXCEPTION 'M2_SELFCHECK: reviews public policy missing moderation_state';
  END IF;
  -- S3: allowlist 에서 shortform 제거·5종 유지
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='content_reports'
              AND policyname='content_reports_insert_reporter'
              AND with_check LIKE '%''shortform''%') THEN
    RAISE EXCEPTION 'M2_SELFCHECK: ambiguous shortform still allowed';
  END IF;
  -- S4: 정책·트리거·RPC
  IF (SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename='shortform_posts'
       AND coalesce(qual,'')||coalesce(with_check,'') LIKE '%ugc_write_allowed%') < 3 THEN
    RAISE EXCEPTION 'M2_SELFCHECK: shortform ugc gate missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.shortform_posts'::regclass
                  AND tgname='trg_shortform_posts_protected') THEN
    RAISE EXCEPTION 'M2_SELFCHECK: shortform protected trigger missing';
  END IF;
  IF has_function_privilege('anon', 'public.increment_shortform_post_view(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.increment_shortform_post_view(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'M2_SELFCHECK: legacy view increment still executable';
  END IF;
  IF NOT has_function_privilege('anon', 'public.shortform_view_record_v2(uuid,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'M2_SELFCHECK: view record v2 not executable';
  END IF;
  -- S5: 트리거 2 + CHECK deleted + RPC
  IF (SELECT count(*) FROM pg_trigger WHERE tgrelid='public.community_comments'::regclass
       AND tgname IN ('trg_cc_set_author_label_shortform_ins','trg_cc_set_author_label_shortform_upd')) <> 2 THEN
    RAISE EXCEPTION 'M2_SELFCHECK: shortform label triggers missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.community_comments'::regclass
                  AND conname='community_comments_status_check'
                  AND pg_get_constraintdef(oid) LIKE '%deleted%') THEN
    RAISE EXCEPTION 'M2_SELFCHECK: community_comments deleted status missing';
  END IF;
  -- S7: 금융 write 회수 (인가 예외 3종 유지)
  IF EXISTS (SELECT 1 FROM information_schema.role_table_grants
              WHERE table_schema='public' AND grantee='authenticated' AND privilege_type='UPDATE'
                AND table_name IN ('cash_wallets','cash_ledger','subscriptions','payments','refunds','withdrawals')) THEN
    RAISE EXCEPTION 'M2_SELFCHECK: financial UPDATE grant still present';
  END IF;
  IF (SELECT count(*) FROM information_schema.role_table_grants
       WHERE table_schema='public' AND grantee='authenticated' AND privilege_type='INSERT'
         AND table_name IN ('payments','refunds','withdrawals')) <> 3 THEN
    RAISE EXCEPTION 'M2_SELFCHECK: contract-required INSERT grants lost';
  END IF;
  -- S8
  IF NOT has_function_privilege('authenticated', 'public.admin_issue_user_warning(uuid,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'M2_SELFCHECK: warning RPC not executable';
  END IF;
  -- S10: 삭제 self v2 존재 + 구 RPC authenticated 회수
  IF NOT has_function_privilege('authenticated', 'public.account_deletion_request_self_v2()', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.account_deletion_request_self_consented_v2(bigint)', 'EXECUTE') THEN
    RAISE EXCEPTION 'M2_SELFCHECK: deletion self v2 not executable';
  END IF;
  IF has_function_privilege('authenticated', 'public.account_deletion_request_self(integer,boolean)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.account_deletion_request_self_consented(integer,boolean,bigint)', 'EXECUTE') THEN
    RAISE EXCEPTION 'M2_SELFCHECK: legacy deletion self RPC still executable';
  END IF;
  -- S9
  IF (SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename='favorites') <> 3 THEN
    RAISE EXCEPTION 'M2_SELFCHECK: favorites policy count != 3';
  END IF;
END $$;

commit;