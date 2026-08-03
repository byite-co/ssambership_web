-- =============================================================================
-- 20260803162808_domain_contract_convergence_rollback.sql
-- =============================================================================
-- forward(수렴 M2)의 소유 객체를 역순으로 되돌린다. 로컬 왕복 검증·비상 복구 전용.
-- 주의: 이 rollback 은 legacy 멘토 RPC·무제한 view +1·숏폼 무보호 UPDATE 등
--       수렴 이전 결함 상태를 재개방한다. 운영 적용 금지.
-- =============================================================================

begin;

-- 사전 게이트: forward 이후 'deleted' 상태 숏폼 댓글이 남아 있으면 CHECK 원복 불가
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.community_comments WHERE status = 'deleted') THEN
    RAISE EXCEPTION 'M2_ROLLBACK_BLOCKED: deleted-status comments exist — 수동 정리 후 재시도';
  END IF;
END $$;

-- S10. 계정 삭제 self v2 제거 + 구 self RPC authenticated 재허용
drop function if exists public.account_deletion_request_self_v2();
drop function if exists public.account_deletion_request_self_consented_v2(bigint);
grant execute on function public.account_deletion_request_self(integer, boolean) to authenticated;
grant execute on function public.account_deletion_request_self_consented(integer, boolean, bigint) to authenticated;

-- S9. favorites 한글 중복 정책 원복
create policy "본인 찜만 조회" on public.favorites for select using (auth.uid() = user_id);
create policy "본인만 찜 삭제" on public.favorites for delete using (auth.uid() = user_id);
create policy "본인만 찜 추가" on public.favorites for insert with check (auth.uid() = user_id);

-- S8. 경고 RPC 제거
drop function if exists public.admin_issue_user_warning(uuid, text, text);

-- S7. 금융 grant 원복 (forward 이전 실측 상태)
grant insert, update, delete, truncate, references, trigger on table
  public.cash_wallets, public.cash_ledger, public.subscriptions,
  public.cash_topup_packages, public.subscription_billing_events, public.order_payments,
  public.payments, public.refunds, public.withdrawals, public.user_warnings
to anon;
grant insert, update, delete, truncate, references, trigger on table
  public.cash_wallets, public.cash_ledger, public.subscriptions,
  public.cash_topup_packages, public.subscription_billing_events, public.order_payments,
  public.payments, public.refunds, public.withdrawals, public.user_warnings
to authenticated;

-- S6(b). add_individual_question_attachment 원복 — 직전 정본(20260803142559 드리프트 v1,
--        author_id 기록 포함) 본문으로 복원
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

-- S6(a). answer_individual_question 원복 (forward 이전 실측 본문)
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

-- S5. 숏폼 댓글 원복
drop function if exists public.community_comment_soft_delete_self(uuid);
alter table public.community_comments drop constraint if exists community_comments_status_check;
alter table public.community_comments
  add constraint community_comments_status_check
  check (status = any (array['visible'::text, 'hidden'::text]));
drop trigger if exists trg_cc_set_author_label_shortform_ins on public.community_comments;
drop trigger if exists trg_cc_set_author_label_shortform_upd on public.community_comments;

-- S4. 숏폼 원복
grant execute on function public.increment_shortform_post_view(uuid) to public;
drop function if exists public.shortform_view_record_v2(uuid, uuid);
drop table if exists public.shortform_view_events;
drop trigger if exists trg_shortform_posts_protected on public.shortform_posts;
drop function if exists public.shortform_posts_protected_guard();

drop policy if exists sf_delete_own on public.shortform_posts;
create policy sf_delete_own on public.shortform_posts
  for delete to authenticated
  using ((author_id = ( SELECT auth.uid() AS uid)) OR (creator_id = ( SELECT auth.uid() AS uid)));

drop policy if exists sf_update_admin on public.shortform_posts;
drop policy if exists sf_update_own on public.shortform_posts;
create policy sf_update_own on public.shortform_posts
  for update to authenticated
  using ((author_id = ( SELECT auth.uid() AS uid)) OR (creator_id = ( SELECT auth.uid() AS uid)))
  with check ((author_id = ( SELECT auth.uid() AS uid)) OR (creator_id = ( SELECT auth.uid() AS uid)));
create policy sp_update_self on public.shortform_posts
  for update to authenticated
  using ((author_id = ( SELECT auth.uid() AS uid)) OR (( SELECT is_admin() AS is_admin) = true));

drop policy if exists sf_insert_mentor on public.shortform_posts;
create policy sf_insert_mentor on public.shortform_posts
  for insert to authenticated
  with check ((( SELECT is_mentor() AS is_mentor) = true) AND ((author_id = ( SELECT auth.uid() AS uid)) OR (creator_id = ( SELECT auth.uid() AS uid))));

-- S3. 신고 allowlist 원복 ('shortform' 포함)
drop policy if exists content_reports_insert_reporter on public.content_reports;
create policy content_reports_insert_reporter on public.content_reports
  for insert to authenticated
  with check (
    (reporter_id = ( SELECT auth.uid() AS uid))
    AND (status = 'pending'::text)
    AND (admin_note IS NULL)
    AND (resolved_by IS NULL)
    AND (resolved_at IS NULL)
    AND (target_type = ANY (ARRAY['community_post'::text, 'shortform'::text, 'shortform_post'::text, 'community_comment'::text, 'board_comment'::text, 'user'::text]))
    AND ((target_type <> 'user'::text) OR public.report_target_user_valid(target_id))
  );

-- S1. 멘토 찾기 원복 — legacy RPC 재허용 + 뷰 원본 정의
grant execute on function public.mentor_directory_list_v2(integer) to anon, authenticated;
grant execute on function public.mentor_profiles_for_directory_v2(uuid[]) to anon, authenticated;
grant execute on function public.mentor_user_public_v2(uuid) to anon, authenticated;

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
          WHERE r.mentor_id = mp.user_id AND COALESCE(r.is_hidden, false) = false AND COALESCE(r.is_blinded, false) = false) rv ON true
  WHERE u.role = 'mentor'::text AND lower(COALESCE(u.status, 'active'::text)) = 'active'::text AND (lower(COALESCE(mp.verification_status, ''::text)) = ANY (ARRAY['approved'::text, 'verified'::text, 'active'::text]));

alter view api_web_v1.mentor_directory_v1 set (security_invoker = false);

-- S2. 리뷰 원복
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
    and (v_include_hidden or (coalesce(r.is_hidden,false)=false and coalesce(r.is_blinded,false)=false));
end;
$fn$;

drop policy if exists reviews_select_public_visible on public.reviews;
create policy reviews_select_public_visible on public.reviews
  for select to anon, authenticated
  using ((COALESCE(is_hidden, false) = false) AND (COALESCE(is_blinded, false) = false));

alter table public.reviews alter column moderation_state drop default;

-- 자가 검증
DO $$
BEGIN
  IF NOT has_function_privilege('anon', 'public.mentor_directory_list_v2(integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'M2_ROLLBACK_SELFCHECK: legacy RPC not restored';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.shortform_posts'::regclass AND tgname='trg_shortform_posts_protected') THEN
    RAISE EXCEPTION 'M2_ROLLBACK_SELFCHECK: shortform trigger still present';
  END IF;
  IF to_regclass('public.shortform_view_events') IS NOT NULL THEN
    RAISE EXCEPTION 'M2_ROLLBACK_SELFCHECK: view events table still present';
  END IF;
  IF (SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename='favorites') <> 6 THEN
    RAISE EXCEPTION 'M2_ROLLBACK_SELFCHECK: favorites policies not restored';
  END IF;
END $$;

commit;
