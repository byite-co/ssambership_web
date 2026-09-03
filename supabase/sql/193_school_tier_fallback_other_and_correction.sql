-- =============================================================================
-- 193_school_tier_fallback_other_and_correction.sql  (2026-09-03 · DB-2 묶음 A — 등급 정정 ★)
--
-- 오너 결정(2026-09-03): 확정된 등급도 관리자가 정정할 수 있어야 하고, 자동 판정 폴백은 '미분류' 가 아니라 '그외' 다.
--   '미분류' 는 이제 **대학명을 못 읽은 경우(NULL · 공백)** 에만 남는다.
--
-- A-1 school_tier_suggest(): university_name NULL·공백 → '미분류' · LIKE 미매칭(이름은 있음) → '그외'.
--     LIKE 패턴 13종·순서는 192 그대로. 192 의 auto_school_verification()(승인 시 자동 생성) ·
--     school_verification_reassess_on_academic_change()(학적 변경 재판정)가 이 함수를 호출하므로 자동 반영된다.
-- A-2 RPC approve_mentor_school_verification_admin: 허용 status = pending / resubmit_required / approved
--     (**approved 는 reviewed_by 유무와 무관** — 192 의 "approved AND reviewed_by IS NULL" 을 넓힌다).
--     rejected · superseded 는 여전히 NOT_REVIEWABLE. 이미 확정된 approved 행(reviewed_by NOT NULL)을 다시 확정하면
--     "정정" 이다: reviewed_by · reviewed_at 을 새로 채우고, 이전 값(이전 등급 · 이전 계열 · 이전 확정자 · 이전 확정 시각)을
--     admin_action_logs(action_type = school_tier_corrected) 상세에 남긴다. 반환 jsonb 에 corrected ·
--     previous_school_tier · previous_reviewed_by 를 additive 로 더한다(기존 키 불변 — 웹 파서는 추가 키를 무시한다).
--     is_admin() 게이트 · mentor 단위 advisory lock · 재승인 승계(superseded) · ACL 불변.
-- A-3 미분류 일괄 정정(오너 결정): status = approved · school_tier = '미분류' · verified_university_name 이 비어 있지 않은
--     행 전부 → school_tier = '그외' · reviewed_by = 9bf48819-1dd2-40dd-96a3-d64bcca2e60c · reviewed_at = now().
--     verified_major_category 는 그대로. admin_action_logs 1건(school_tier_bulk_reassigned · detail.count ·
--     detail.note = '폴백 규칙 변경(미분류→그외)에 따른 일괄 정정' · detail.rows = 행별 이전 reviewed_by/at — 롤백 정본).
--     적용 전 실측(2026-09-03 운영 read-only): 대상 19건(가천대 13 · 계명대 4 · 원광대 1 · 충북대 1) · 대학명 없는 approved
--     행 0건 · 대상 전부 reviewed_by = 위 계정(그중 2건은 2026-08-31 · 2026-09-01 개별 확정, 17건은 192 B-1 일괄 확정).
--
-- Apply: 저장소 표준 경로(db-apply-pending) — 즉석 실행 금지. 적용 순서 A(193) → B(194) → C(195).
--   ★ A-3 은 데이터 변경이다 — 적용 직전 대상 행 SELECT 덤프를 PR 코멘트에 남긴다.
--   pack 등재: supabase/baseline/post_ledger_backfills/20260903200100_school_tier_fallback_other_and_correction.sql
-- Rollback: supabase/rollback/20260903200100_school_tier_fallback_other_and_correction_rollback.sql
-- 검증(§6): select school_tier, count(*) from mentor_school_verifications where status='approved' group by 1;
--           select school_tier_suggest('가천대학교'), school_tier_suggest(''), school_tier_suggest(null);
-- =============================================================================

begin;

-- ── 0. 사전 게이트 — 192(20260903100300) 적용 상태여야 한다. 다르면 중단(임의 정정 금지) ──
do $$
declare
  v_src text;
  v_rpc text;
  v_check text;
begin
  select p.prosrc into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'school_tier_suggest'
     and pg_get_function_identity_arguments(p.oid) = 'p_university_name text';
  if v_src is null then
    raise exception '193_GATE: school_tier_suggest(text) 부재 — 192 미적용';
  end if;
  if v_src not like '%else ''미분류''%' or v_src like '%''그외''%' then
    raise exception '193_GATE: school_tier_suggest 본문이 192 형태가 아니다(이미 적용됐거나 전제 불일치)';
  end if;

  select p.prosrc into v_rpc
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'approve_mentor_school_verification_admin'
     and pg_get_function_identity_arguments(p.oid) =
         'p_verification_id uuid, p_university_name text, p_university_id text, p_department_name text, p_major_category text, p_school_tier text';
  if v_rpc is null then
    raise exception '193_GATE: approve_mentor_school_verification_admin(uuid, text ×5) 부재';
  end if;
  if v_rpc not like '%or (v_row.status = ''approved'' and v_row.reviewed_by is null)%' or v_rpc like '%school_tier_corrected%' then
    raise exception '193_GATE: RPC 본문이 192 형태가 아니다(이미 적용됐거나 전제 불일치)';
  end if;

  if not exists (select 1 from pg_trigger where tgname = 'trg_auto_school_verification'
                   and tgrelid = 'public.mentor_profiles'::regclass)
     or not exists (select 1 from pg_trigger where tgname = 'trg_school_verification_reassess_on_academic_change'
                   and tgrelid = 'public.mentor_profiles'::regclass) then
    raise exception '193_GATE: 192 트리거 부재';
  end if;

  select pg_get_constraintdef(c.oid) into v_check
    from pg_constraint c
   where c.conrelid = 'public.mentor_school_verifications'::regclass
     and c.conname = 'mentor_school_verifications_school_tier_check';
  if v_check is null or v_check not like '%그외%' or v_check not like '%미분류%' then
    raise exception '193_GATE: school_tier CHECK 에 그외·미분류가 없다(%)', v_check;
  end if;
end $$;

-- ── A-1. 판정 헬퍼 — 폴백 변경: NULL·공백 → 미분류 · LIKE 미매칭 → 그외 (패턴·순서 192 동일) ──
create or replace function public.school_tier_suggest(p_university_name text)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when p_university_name is null or btrim(p_university_name) = ''
      then '미분류'
    when p_university_name like '서울대%' or p_university_name like '연세대%' or p_university_name like '고려대%'
      then '서연고'
    when p_university_name like '서강대%' or p_university_name like '성균관대%' or p_university_name like '한양대%'
      then '서성한'
    when p_university_name like '중앙대%' or p_university_name like '경희대%'
      or p_university_name like '한국외%' or p_university_name like '서울시립대%'
      then '중경외시'
    when p_university_name like '건국대%' or p_university_name like '동국대%' or p_university_name like '홍익대%'
      then '건동홍'
    else '그외'
  end;
$$;

comment on function public.school_tier_suggest(text) is
  '192 → 193: 대학명 → 학교군 제안값(자동 판정 · 잠정). NULL·공백 → 미분류(대학명을 못 읽은 경우만) · LIKE 미매칭 → 그외. 패턴은 20260830150838 과 동일. 정본 확정은 관리자 RPC.';

revoke all on function public.school_tier_suggest(text) from public, anon, authenticated;

-- ── A-2. 확정 RPC — approved 는 reviewed_by 유무와 무관하게 허용 · 확정된 행 재확정 = 정정(감사 로그) ──
create or replace function public.approve_mentor_school_verification_admin(
  p_verification_id uuid,
  p_university_name text,
  p_university_id text,
  p_department_name text,
  p_major_category text,
  p_school_tier text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin uuid := (select auth.uid());
  v_row public.mentor_school_verifications;
  v_superseded integer := 0;
  v_correction boolean := false;
  v_previous jsonb := null;
begin
  -- (a) 관리자 전용. mentor·student·anon 은 여기서 종료된다.
  if not coalesce(public.is_admin(), false) then
    raise exception 'NOT_ADMIN' using errcode = '42501';
  end if;

  if p_verification_id is null then
    raise exception 'INVALID_INPUT: verification_id is required' using errcode = '22023';
  end if;
  if btrim(coalesce(p_university_name, '')) = ''
     or btrim(coalesce(p_university_id, '')) = ''
     or btrim(coalesce(p_department_name, '')) = ''
     or btrim(coalesce(p_major_category, '')) = ''
     or btrim(coalesce(p_school_tier, '')) = '' then
    raise exception 'INVALID_INPUT: university/department/major/tier are required' using errcode = '22023';
  end if;

  -- (b) mentor 단위 직렬화 — 같은 멘토의 서로 다른 요청이 동시에 승인되지 않도록.
  select * into v_row from public.mentor_school_verifications where id = p_verification_id;
  if not found then
    raise exception 'VERIFICATION_NOT_FOUND' using errcode = 'P0002';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('msv_approve:' || v_row.mentor_id::text, 0));

  -- 락 획득 후 재조회(대기 중 다른 트랜잭션이 상태를 바꿨을 수 있다).
  select * into v_row from public.mentor_school_verifications
   where id = p_verification_id for update;
  -- 193: 확정 가능 = 심사 대상(pending·resubmit_required) 또는 approved(잠정·확정 무관 — 확정된 행은 "정정").
  if v_row.status not in ('pending', 'resubmit_required', 'approved') then
    raise exception 'NOT_REVIEWABLE: %', v_row.status using errcode = '22023';
  end if;

  -- (c) 192: 서류 유무·경로·객체 실재는 확정 조건이 아니다 — 서류는 판단 재료이며 화면이 '서류 없음'을 보여준다.

  -- 193: 이미 확정된 approved 행(reviewed_by NOT NULL)의 재확정 = 정정. 이전 값을 감사 로그 상세에 남긴다.
  v_correction := (v_row.status = 'approved' and v_row.reviewed_by is not null);
  if v_correction then
    v_previous := jsonb_build_object(
      'school_tier', v_row.school_tier,
      'verified_major_category', v_row.verified_major_category,
      'verified_university_name', v_row.verified_university_name,
      'verified_university_id', v_row.verified_university_id,
      'verified_department_name', v_row.verified_department_name,
      'reviewed_by', v_row.reviewed_by,
      'reviewed_at', v_row.reviewed_at
    );
  end if;

  -- (d) 재승인 수명주기 — 같은 트랜잭션에서 기존 approved 를 먼저 종료시킨다.
  update public.mentor_school_verifications
     set status = 'superseded',
         updated_at = now()
   where mentor_id = v_row.mentor_id
     and status = 'approved'
     and id <> v_row.id;
  get diagnostics v_superseded = row_count;

  -- (e) 대상 행 확정(정정 시 reviewed_by · reviewed_at 이 새로 채워진다).
  update public.mentor_school_verifications
     set status = 'approved',
         verified_university_name = btrim(p_university_name),
         verified_university_id = btrim(p_university_id),
         verified_department_name = btrim(p_department_name),
         verified_major_category = btrim(p_major_category),
         school_tier = btrim(p_school_tier),
         reviewed_by = v_admin,
         reviewed_at = now(),
         reject_reason = null
   where id = v_row.id;

  -- (f) 193: 정정 감사 로그 — 이전 등급 · 이전 확정자(웹 액션의 mentor_school_verification_approve 기록과 별개).
  if v_correction then
    insert into public.admin_action_logs (admin_id, action_type, target_type, target_id, detail)
    values (
      v_admin,
      'school_tier_corrected',
      'mentor_school_verification',
      v_row.id,
      jsonb_build_object(
        'mentor_id', v_row.mentor_id,
        'previous', v_previous,
        'next', jsonb_build_object(
          'school_tier', btrim(p_school_tier),
          'verified_major_category', btrim(p_major_category),
          'verified_university_name', btrim(p_university_name),
          'verified_university_id', btrim(p_university_id),
          'verified_department_name', btrim(p_department_name),
          'reviewed_by', v_admin
        ),
        'note', '확정된 학교 등급 정정(193 A-2) — 이전 등급·이전 확정자 보존'
      )
    );
  end if;

  -- 감사 가능 최소 정보만 반환한다(서류 내용·signed URL·토큰 미포함). corrected · previous_* 는 193 additive 키.
  return jsonb_build_object(
    'verification_id', v_row.id,
    'mentor_id', v_row.mentor_id,
    'status', 'approved',
    'superseded_count', v_superseded,
    'reviewed_by', v_admin,
    'corrected', v_correction,
    'previous_school_tier', case when v_correction then v_row.school_tier end,
    'previous_reviewed_by', case when v_correction then v_row.reviewed_by end
  );
end;
$$;

comment on function public.approve_mentor_school_verification_admin(uuid, text, text, text, text, text) is
  'SQL174 → 192 → 193: 학교·전공 인증 확정 정본. is_admin() 전용 · 확정 가능 = pending / resubmit_required / approved(잠정·확정 무관 — 확정된 행은 정정: reviewed_by/at 갱신 + admin_action_logs school_tier_corrected 에 이전 등급·확정자 기록) · 서류 조건 없음 · 재승인 시 기존 approved → superseded 를 같은 트랜잭션에서 수행. 실패는 전부 예외(부분 반영 없음).';

revoke all on function public.approve_mentor_school_verification_admin(uuid, text, text, text, text, text) from public;
revoke all on function public.approve_mentor_school_verification_admin(uuid, text, text, text, text, text) from anon;
grant execute on function public.approve_mentor_school_verification_admin(uuid, text, text, text, text, text)
  to authenticated, service_role;

-- ── A-3. 미분류 일괄 정정 (대학명이 있는 approved 행만 · 이전 값은 로그 detail.rows 에 보존) ──
do $$
declare
  v_admin   constant uuid := '9bf48819-1dd2-40dd-96a3-d64bcca2e60c';  -- byite1226@gmail.com (오너 지정 · 192 B-1 과 동일)
  v_target  integer;
  v_updated integer;
  v_rows    jsonb;
  v_now     timestamptz := now();
begin
  select count(*),
         coalesce(jsonb_agg(jsonb_build_object(
           'id', v.id,
           'mentor_id', v.mentor_id,
           'verified_university_name', v.verified_university_name,
           'reviewed_by', v.reviewed_by,
           'reviewed_at', v.reviewed_at
         ) order by v.verified_university_name, v.created_at), '[]'::jsonb)
    into v_target, v_rows
    from public.mentor_school_verifications v
   where v.status = 'approved'
     and v.school_tier = '미분류'
     and v.verified_university_name is not null
     and btrim(v.verified_university_name) <> '';

  if v_target = 0 then
    raise notice '193 A-3: 일괄 정정 대상 0건 — 건너뜀(로그 미기록)';
    return;
  end if;

  -- 대상이 있으면 정정 주체가 실재하는 admin 이어야 한다. 아니면 정정하지 않고 중단(추측 금지).
  if not exists (select 1 from public.users u where u.id = v_admin and u.role = 'admin') then
    raise exception '193_ABORT: 일괄 정정 admin 계정 % 이 public.users 에 admin 으로 없다 — 대상 % 건을 정정하지 않고 중단', v_admin, v_target;
  end if;
  if not exists (select 1 from auth.users au where au.id = v_admin) then
    raise exception '193_ABORT: 일괄 정정 admin 계정 % 이 auth.users 에 없다(admin_action_logs FK) — 중단', v_admin;
  end if;

  update public.mentor_school_verifications v
     set school_tier = '그외',
         reviewed_by = v_admin,
         reviewed_at = v_now
   where v.status = 'approved'
     and v.school_tier = '미분류'
     and v.verified_university_name is not null
     and btrim(v.verified_university_name) <> '';
  get diagnostics v_updated = row_count;

  if v_updated <> v_target then
    raise exception '193_ABORT: 일괄 정정 대상 % 건 ≠ 갱신 % 건', v_target, v_updated;
  end if;

  insert into public.admin_action_logs (admin_id, action_type, target_type, target_id, detail, created_at)
  values (
    v_admin,
    'school_tier_bulk_reassigned',
    'mentor_school_verification',
    null,
    jsonb_build_object(
      'count', v_updated,
      'from_tier', '미분류',
      'to_tier', '그외',
      'note', '폴백 규칙 변경(미분류→그외)에 따른 일괄 정정',
      'rule', 'mentor_school_verifications.status = approved AND school_tier = 미분류 AND verified_university_name 비어 있지 않음',
      'reviewed_at', v_now,
      'rows', v_rows,
      'migration', '20260903200100_school_tier_fallback_other_and_correction'
    ),
    v_now
  );
  raise notice '193 A-3: % 건 미분류 → 그외 (reviewed_by = %, reviewed_at = %)', v_updated, v_admin, v_now;
end $$;

-- ── 적용 직후 자가 검증 ───────────────────────────────────────────────────────
do $$
declare v_n integer;
begin
  if public.school_tier_suggest('가천대학교') <> '그외'
     or public.school_tier_suggest('') <> '미분류'
     or public.school_tier_suggest('   ') <> '미분류'
     or public.school_tier_suggest(null) <> '미분류'
     or public.school_tier_suggest('성균관대학교') <> '서성한'
     or public.school_tier_suggest('연세대학교 미래캠퍼스') <> '서연고' then
    raise exception '193_SELFCHECK: 판정 헬퍼 규칙 불일치';
  end if;

  select count(*) into v_n
    from public.mentor_school_verifications v
   where v.status = 'approved' and v.school_tier = '미분류'
     and v.verified_university_name is not null and btrim(v.verified_university_name) <> '';
  if v_n > 0 then
    raise exception '193_SELFCHECK: 대학명이 있는 미분류 approved 행 % 건 잔존', v_n;
  end if;

  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'approve_mentor_school_verification_admin'
                    and p.prosecdef and p.proconfig::text like '%search_path=%'
                    and p.prosrc like '%school_tier_corrected%'
                    and p.prosrc like '%not in (''pending'', ''resubmit_required'', ''approved'')%'
                    and p.prosrc not like '%DOCUMENT_REF_MISSING%'
                    and NOT has_function_privilege('anon', p.oid, 'EXECUTE')
                    and has_function_privilege('authenticated', p.oid, 'EXECUTE')
                    and has_function_privilege('service_role', p.oid, 'EXECUTE')) then
    raise exception '193_SELFCHECK: RPC 본문/ACL 불일치';
  end if;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname = 'school_tier_suggest'
                and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE'))) then
    raise exception '193_SELFCHECK: school_tier_suggest 에 anon·authenticated EXECUTE 잔존';
  end if;
end $$;

commit;
