-- =============================================================================
-- 208_review_eligibility_paid_twice.sql  (2026-09-06 · DB-5 묶음 E — 리뷰 자격 정본화: 같은 멘토 구독 결제 2회 이상)
--
-- 왜: 문서가 정본이다(오너 확정 2026-09-06) — "같은 멘토에게 2회 결제하면 후기 작성 가능"(학생 이용안내서 · CLAUDE.md 잠금값 "동일 멘토 2회 연속 결제 성공").
--   현재 `check_review_eligibility`(170)는 "구독 이력 있음(active/expired/cancel_scheduled) 또는 완료 개별질문 있음"으로 더 느슨하다.
--   "연속"은 **누적 2회**로 해석한다(초기 결제 + 갱신 1회 = 2회 · 같은 멘토를 두 번 구독해도 2회) — 갱신 연속성은 세지 않는다.
--   정본 표는 `subscription_billing_events`(064 · 정산 배치의 원천): `status = 'succeeded'` AND `event_type in ('initial','renewal')` AND `amount_cents > 0`.
--   개별질문 결제는 세지 않는다. 066 의 cash_ledger/payments 폴백 집계는 되살리지 않는다(운영 구독 0 · 리뷰 0 → 레거시 데이터 없음).
--
-- E-1 core_private.review_eligibility_impl(p_mentor_id uuid, p_student_id uuid) returns jsonb  {eligible, paid_count, required_count: 2}
--     · 판정 정본 하나 — 아래 두 함수가 공유한다. 외부 EXECUTE 0(anon/authenticated/service_role 전부 없음).
-- E-2 public.check_review_eligibility(p_mentor_id uuid, p_student_id uuid) returns boolean  — **시그니처·반환형·속성·ACL 유지**(126 정책 `reviews_insert_student`
--     가 boolean 식으로 쓴다 · 인자 순서 (멘토, 학생) 고정 — 170 경고 승계). 본문만 E-1 위임으로 교체.
-- E-3 api_app_v1.review_eligibility_self(p_mentor_id uuid) returns jsonb — 앱 후기 화면용 사유 포함 판정
--     · `{ok:true, contract_version:1, eligible, reason: 'OK' | 'NOT_ENOUGH_PAYMENTS' | 'ALREADY_REVIEWED', paid_count, required_count, existing_review_id}`
--       (ALREADY_REVIEWED 는 본인 기존 후기 → 수정 경로 · 171 `reviews_update_author` · 숨김/블라인드면 `can_edit false`)
--     · 오류 envelope `{ok:false, contract_version:1, code}`: AUTH_REQUIRED · MENTOR_NOT_FOUND(NULL · 멘토 역할 아님)
--     · SECURITY DEFINER · search_path '' · authenticated 만(DB-4 계약 동일).
-- 웹: `lib/reviews/reviewEligibilityPolicy.ts`(UI 사전 판정 · 170 과 1:1)는 이 배치에서 바꾸지 않는다(원칙 — 웹 PR 이 같은 규칙으로 갱신해야 화면과 INSERT 정책이 일치한다 · 보고서).
--
-- Apply: 저장소 표준 경로(db-apply-pending). pack 등재: supabase/baseline/post_ledger_backfills/20260906100400_review_eligibility_paid_twice.sql
-- Rollback: supabase/rollback/20260906100400_review_eligibility_paid_twice_rollback.sql (170 본문 원문 복원 + E-1·E-3 DROP)
-- =============================================================================

begin;

do $$
declare v_md5 text;
begin
  if not exists (select 1 from pg_namespace where nspname = 'api_app_v1') or not exists (select 1 from pg_namespace where nspname = 'core_private') then
    raise exception '208_GATE: api_app_v1/core_private 스키마 부재';
  end if;
  select md5(pg_get_functiondef(p.oid)) into v_md5 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'check_review_eligibility' and pg_get_function_identity_arguments(p.oid) = 'p_mentor_id uuid, p_student_id uuid';
  if v_md5 is null then
    raise exception '208_GATE: check_review_eligibility(uuid,uuid) identity 불일치(170)';
  end if;
  if v_md5 <> '7f458145b70b0eb239a0c67f265a4c93' then
    raise exception '208_GATE: check_review_eligibility 본문 md5 불일치(170 · 2026-09-06 운영 실측 7f458145…) — 현재 %', v_md5;
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'reviews' and policyname = 'reviews_insert_student'
                   and with_check like '%check_review_eligibility(mentor_id%') then
    raise exception '208_GATE: reviews_insert_student 정책(126) 이 check_review_eligibility(mentor_id, …) 를 쓰지 않는다';
  end if;
  if (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'subscription_billing_events'
       and column_name in ('student_id', 'mentor_id', 'status', 'event_type', 'amount_cents')) <> 5 then
    raise exception '208_GATE: subscription_billing_events 컬럼 불일치(064)';
  end if;
  if not exists (select 1 from pg_indexes where schemaname = 'public' and tablename = 'reviews' and indexname = 'uq_reviews_mentor_author') then
    raise exception '208_GATE: uq_reviews_mentor_author 부재(042/123)';
  end if;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where (n.nspname, p.proname) in (('core_private', 'review_eligibility_impl'), ('api_app_v1', 'review_eligibility_self'))) then
    raise exception '208_GATE: 대상 함수가 이미 있다';
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- E-1. 판정 정본 (core_private · 외부 EXECUTE 0)
-- -----------------------------------------------------------------------------
create function core_private.review_eligibility_impl(p_mentor_id uuid, p_student_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $fn$
declare
  v_required constant int := 2;   -- 같은 멘토 구독 결제 성공 2회(누적) — CLAUDE.md 잠금값
  v_paid int := 0;
begin
  if p_mentor_id is not null and p_student_id is not null then
    select count(*)::int into v_paid
      from public.subscription_billing_events e
     where e.student_id = p_student_id
       and e.mentor_id = p_mentor_id
       and e.status = 'succeeded'
       and e.event_type in ('initial', 'renewal')
       and coalesce(e.amount_cents, 0) > 0;
  end if;
  return jsonb_build_object('eligible', v_paid >= v_required, 'paid_count', v_paid, 'required_count', v_required);
end
$fn$;

comment on function core_private.review_eligibility_impl(uuid, uuid) is
  '208(DB-5 E-1): 리뷰 자격 판정 정본 — 같은 (학생, 멘토) 의 subscription_billing_events succeeded·initial/renewal·amount>0 누적 2건 이상. check_review_eligibility 와 api_app_v1.review_eligibility_self 가 공유. 외부 EXECUTE 0.';

revoke all on function core_private.review_eligibility_impl(uuid, uuid) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- E-2. RLS 판정 함수 — 시그니처·반환형·속성 유지(170 과 동일 헤더) · 본문만 교체 · ACL 은 replace 로 보존
-- -----------------------------------------------------------------------------
create or replace function public.check_review_eligibility(
  p_mentor_id uuid,
  p_student_id uuid
) returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  -- 208(DB-5 E): 같은 멘토 구독 결제 성공 2회 이상(누적) — 판정 정본은 core_private.review_eligibility_impl.
  -- 인자 순서 (p_mentor_id, p_student_id) 는 126 reviews_insert_student 가 고정한다(170 경고 승계).
  if p_mentor_id is null or p_student_id is null then
    return false;
  end if;
  return coalesce((core_private.review_eligibility_impl(p_mentor_id, p_student_id) ->> 'eligible')::boolean, false);
end;
$$;

comment on function public.check_review_eligibility(uuid, uuid) is
  'Review eligibility (DB-5 208, owner decision 2026-09-06): eligible when the same (student, mentor) pair has >= 2 succeeded paid subscription billing events (initial/renewal, amount > 0, cumulative). Individual-question payments do not count. Replaces the relationship-based rule (170). Argument order (p_mentor_id, p_student_id) is fixed by 126 reviews_insert_student.';

-- -----------------------------------------------------------------------------
-- E-3. 앱 self 판정(사유 포함)
-- -----------------------------------------------------------------------------
create function api_app_v1.review_eligibility_self(p_mentor_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $fn$
declare
  v_uid uuid := (select auth.uid());
  v_existing_id uuid;
  v_moderated boolean := false;
  v_res jsonb;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'AUTH_REQUIRED');
  end if;
  if p_mentor_id is null or not exists (select 1 from public.users u where u.id = p_mentor_id and u.role = 'mentor') then
    return jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'MENTOR_NOT_FOUND');
  end if;

  -- ① 본인 기존 후기(숨김·블라인드 포함 — 171 reviews_select_author) → 수정 경로. 자격을 재검사하지 않는다(171 정본).
  select r.id, (coalesce(r.is_hidden, false) or coalesce(r.is_blinded, false))
    into v_existing_id, v_moderated
    from public.reviews r
   where r.mentor_id = p_mentor_id and r.author_id = v_uid
   limit 1;
  if v_existing_id is not null then
    return jsonb_build_object('ok', true, 'contract_version', 1, 'eligible', false, 'reason', 'ALREADY_REVIEWED',
                              'existing_review_id', v_existing_id, 'can_edit', not v_moderated,
                              'paid_count', null, 'required_count', 2);
  end if;

  -- ② 신규 작성 자격 — E-1 정본
  v_res := core_private.review_eligibility_impl(p_mentor_id, v_uid);
  return jsonb_build_object('ok', true, 'contract_version', 1,
                            'eligible', (v_res ->> 'eligible')::boolean,
                            'reason', case when (v_res ->> 'eligible')::boolean then 'OK' else 'NOT_ENOUGH_PAYMENTS' end,
                            'existing_review_id', null, 'can_edit', false,
                            'paid_count', (v_res ->> 'paid_count')::int, 'required_count', (v_res ->> 'required_count')::int);
end
$fn$;

comment on function api_app_v1.review_eligibility_self(uuid) is
  '208(DB-5 E-3): 앱 후기 화면 자격 판정 — 본인 기존 후기 ALREADY_REVIEWED(existing_review_id · can_edit) → 아니면 E-1 정본(OK / NOT_ENOUGH_PAYMENTS · paid_count · required_count 2). AUTH_REQUIRED · MENTOR_NOT_FOUND 는 ok:false. authenticated 만.';

revoke all on function api_app_v1.review_eligibility_self(uuid) from public, anon;
grant execute on function api_app_v1.review_eligibility_self(uuid) to authenticated;

do $$
declare v_oid oid; v_impl oid; v_self oid;
begin
  select p.oid into v_oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'check_review_eligibility'
     and pg_get_function_identity_arguments(p.oid) = 'p_mentor_id uuid, p_student_id uuid'
     and p.prorettype = 'boolean'::regtype and p.prosecdef and p.provolatile = 's';
  if v_oid is null then
    raise exception '208_SELFCHECK: check_review_eligibility 시그니처/속성 변경됨';
  end if;
  if has_function_privilege('anon', v_oid, 'EXECUTE') or not has_function_privilege('authenticated', v_oid, 'EXECUTE') then
    raise exception '208_SELFCHECK: check_review_eligibility ACL 변경됨(170: anon 0 · authenticated)';
  end if;
  if (select prosrc from pg_proc where oid = v_oid) not like '%core_private.review_eligibility_impl(%'
     or (select prosrc from pg_proc where oid = v_oid) like '%individual_questions%' then
    raise exception '208_SELFCHECK: check_review_eligibility 본문이 정본 위임이 아니거나 개별질문 경로가 남아 있다';
  end if;
  select p.oid into v_impl from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'core_private' and p.proname = 'review_eligibility_impl' and p.prosecdef and p.provolatile = 's';
  if v_impl is null or has_function_privilege('anon', v_impl, 'EXECUTE') or has_function_privilege('authenticated', v_impl, 'EXECUTE')
     or has_function_privilege('service_role', v_impl, 'EXECUTE') then
    raise exception '208_SELFCHECK: impl 부재 또는 외부 EXECUTE 잔존';
  end if;
  select p.oid into v_self from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'api_app_v1' and p.proname = 'review_eligibility_self' and pg_get_function_identity_arguments(p.oid) = 'p_mentor_id uuid'
     and p.prosecdef and coalesce(p.proconfig::text, '') like '%search_path=%';
  if v_self is null or has_function_privilege('anon', v_self, 'EXECUTE') or not has_function_privilege('authenticated', v_self, 'EXECUTE')
     or has_function_privilege('service_role', v_self, 'EXECUTE') then
    raise exception '208_SELFCHECK: review_eligibility_self 부재 또는 ACL 불일치(authenticated 만)';
  end if;
  if (select prosrc from pg_proc where oid = v_self) not like '%core_private.review_eligibility_impl(%' then
    raise exception '208_SELFCHECK: review_eligibility_self 가 정본을 공유하지 않는다';
  end if;
  -- 정책 불변(126)
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'reviews' and policyname = 'reviews_insert_student'
                   and with_check like '%check_review_eligibility(mentor_id%') then
    raise exception '208_SELFCHECK: reviews_insert_student 정책 변경됨';
  end if;
  -- 판정: NULL 인자 → false · 존재하지 않는 쌍 → false (impl paid_count 0)
  if public.check_review_eligibility(null, null) or public.check_review_eligibility(gen_random_uuid(), gen_random_uuid()) then
    raise exception '208_SELFCHECK: 빈 쌍 판정이 true';
  end if;
end $$;

commit;
