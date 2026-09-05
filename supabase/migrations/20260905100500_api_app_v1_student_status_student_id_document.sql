-- =============================================================================
-- 203_api_app_v1_student_status_student_id_document.sql  (2026-09-05 · DB-4 묶음 E — 재학 상태 · 학생증 사후 제출)
--
-- 왜:
--   E-1 학생 재학 상태 = `users.student_status`(text · 가입 메타 `handle_new_auth_user` 로만 채움). 변경 RPC 가 없고 `users` UPDATE 는
--       20260803162257 A 절이 회수 + 보호 컬럼 트리거 → 앱이 못 바꾼다(A-4a 판정표 #12). 웹에도 편집 UI 없음(마이페이지 표시만).
--       어휘 정본: 없음 — 웹 가입 폼(`components/auth/StudentSignupForm.tsx`)은 `studentStatus` 를 타입에만 두고 입력을 그리지 않는다(자유 텍스트 계약).
--       → 서버는 grade_level 과 같은 규칙(trim · 최대 20자 · 학생만 · ''=값 제거)만 강제한다.
--       기존 `api_app_v1.user_profile_update_self(p_nickname, p_grade_level)` 의 시그니처는 바꾸지 않는다(지시서 "하지 말 것" 2 · PostgREST 오버로드 모호성 회피)
--       → `_v2` 를 만들어 `p_student_status` 를 더한다. 닉네임·학년·계정 게이트는 정본 `core_private.user_profile_update_self_impl` 에 위임(복제 0).
--       오류는 v1 과 같은 raise 규약(AUTH_REQUIRED 28000 · NICKNAME_* / GRADE_LEVEL_* 22023 · 추가: STUDENT_STATUS_NOT_ALLOWED · STUDENT_STATUS_TOO_LONG 22023) —
--       앱의 v1 오류 매퍼가 그대로 동작한다.
--   E-2 학생증 사후 제출(A-4a α8): 웹 `lib/mentor/mentorStudentIdActions.ts` 는 세션 클라이언트로 `student-id-images/{uid}/…` 업로드 후
--       service_role 로 `mentor_profiles.student_id_image_url` 을 갱신한다(F7 allowlist 밖 컬럼 · 테이블 쓰기 회수). 앱은 업로드까지는 Storage RLS
--       (`student_id_images_insert_own` — 첫 세그먼트 = uid)로 가능하지만 컬럼 반영 경로가 없다.
--       → `api_app_v1.mentor_student_id_document_set_self(p_object_path)`: 경로 `{uid}/…`(하위 폴더 허용 · `..` 금지 · jpg/jpeg/png/pdf) +
--         `storage.objects` 실재·소유(bucket 'student-id-images' · name = 경로 · owner_id = uid — 139 qna_register_attachment 와 같은 검증) →
--         `student_id_image_url = 'student-id-images/' || 경로`(웹 formatStudentIdImageStoredRef 형식). 덮어쓰기 허용(웹 사후 제출 동일 — "다른 서류로 바꾸려면").
--       크기·매직바이트(웹 20MB · JPG/PNG/PDF)는 서버 액션 검증이라 앱은 클라이언트 검증으로 내려간다(A-4a 3-4 와 같은 신뢰도 · 보고서 기재).
--       트리거 대조: enforce_mentor_profile_privileged_guard(verification_status·cap_limit 만) · 192 재판정(대학·학과만) — 미발화.
-- 권한: 두 함수 REVOKE public·anon · GRANT authenticated 만.
--
-- Apply: 저장소 표준 경로(db-apply-pending). pack 등재: supabase/baseline/post_ledger_backfills/20260905100500_api_app_v1_student_status_student_id_document.sql
-- Rollback: supabase/rollback/20260905100500_api_app_v1_student_status_student_id_document_rollback.sql
-- =============================================================================

begin;

do $$
begin
  if (select count(*) from pg_namespace where nspname in ('api_app_v1', 'core_private')) <> 2 then
    raise exception '203_GATE: api_app_v1/core_private 스키마 부재';
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'core_private' and p.proname = 'user_profile_update_self_impl'
                    and pg_get_function_identity_arguments(p.oid) = 'p_user_id uuid, p_nickname text, p_grade_level text') then
    raise exception '203_GATE: core_private.user_profile_update_self_impl identity 불일치(20260803162257)';
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'api_app_v1' and p.proname = 'user_profile_update_self'
                    and pg_get_function_identity_arguments(p.oid) = 'p_nickname text, p_grade_level text') then
    raise exception '203_GATE: api_app_v1.user_profile_update_self(v1) 부재 — 그대로 둬야 한다';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'users' and column_name = 'student_status') then
    raise exception '203_GATE: users.student_status 부재(001)';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'mentor_profiles' and column_name = 'student_id_image_url') then
    raise exception '203_GATE: mentor_profiles.student_id_image_url 부재(001)';
  end if;
  if (select count(*) from information_schema.columns where table_schema = 'storage' and table_name = 'objects' and column_name in ('bucket_id','name','owner_id')) <> 3 then
    raise exception '203_GATE: storage.objects 컬럼 불일치';
  end if;
  if not exists (select 1 from storage.buckets b where b.id = 'student-id-images' and b.public = false) then
    raise exception '203_GATE: 비공개 버킷 student-id-images 부재(039)';
  end if;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'api_app_v1' and p.proname in ('user_profile_update_self_v2', 'mentor_student_id_document_set_self')) then
    raise exception '203_GATE: 대상 함수가 이미 있다';
  end if;
end $$;

-- ── E-1. user_profile_update_self_v2 ─────────────────────────────────────────
create function api_app_v1.user_profile_update_self_v2(
  p_nickname text default null,
  p_grade_level text default null,
  p_student_status text default null
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $fn$
declare
  v_uid uuid := (select auth.uid());
  v_res jsonb;
  v_role text;
  v_ss text;
  v_out text;
begin
  -- 닉네임·학년·계정 게이트·행 잠금은 정본 impl(v1 과 동일 raise 규약 — AUTH_REQUIRED 포함)
  v_res := core_private.user_profile_update_self_impl(v_uid, p_nickname, p_grade_level);

  if p_student_status is not null then
    select u.role into v_role from public.users u where u.id = v_uid;
    if v_role is distinct from 'student' then
      raise exception 'STUDENT_STATUS_NOT_ALLOWED' using errcode = '22023';
    end if;
    -- grade_level 과 동일 규칙: null=유지 · ''=값 제거 · trim · 최대 20자(자유 텍스트 — 어휘 정본 없음)
    v_ss := nullif(btrim(p_student_status), '');
    if v_ss is not null and char_length(v_ss) > 20 then
      raise exception 'STUDENT_STATUS_TOO_LONG' using errcode = '22023';
    end if;
    update public.users u set student_status = v_ss, updated_at = now() where u.id = v_uid
      returning u.student_status into v_out;
  else
    select u.student_status into v_out from public.users u where u.id = v_uid;
  end if;

  return v_res || jsonb_build_object('student_status', v_out);
end
$fn$;

comment on function api_app_v1.user_profile_update_self_v2(text, text, text) is
  '203(DB-4 E-1): v1(user_profile_update_self) + p_student_status(users.student_status · 학생만 · trim · ≤20자 · ''=제거). 닉네임·학년·게이트는 core_private impl 위임. v1 은 그대로.';

-- ── E-2. mentor_student_id_document_set_self ──────────────────────────────────
create function api_app_v1.mentor_student_id_document_set_self(p_object_path text)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $fn$
declare
  v_uid uuid := (select auth.uid());
  v_role text; v_status text; v_susp timestamptz; v_norm text;
  v_path text := regexp_replace(btrim(coalesce(p_object_path, '')), '^/+', '');
  v_ext text;
  v_ref text;
  v_updated timestamptz;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'AUTH_REQUIRED');
  end if;
  select u.role, u.status, u.suspended_until into v_role, v_status, v_susp from public.users u where u.id = v_uid;
  if not found or v_role is distinct from 'mentor' then
    return jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'ROLE_NOT_MENTOR');
  end if;
  v_norm := lower(btrim(coalesce(v_status, '')));
  if v_norm = 'banned' then
    return jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'ACCOUNT_BANNED');
  end if;
  if v_norm = 'suspended' and (v_susp is null or v_susp > now()) then
    return jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'ACCOUNT_SUSPENDED');
  end if;
  if v_norm not in ('active', 'suspended') then
    return jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'ACCOUNT_NOT_ACTIVE');
  end if;
  if public.account_deletion_write_blocked(v_uid) then
    return jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'ACCOUNT_DELETION_IN_PROGRESS');
  end if;
  if not exists (select 1 from public.mentor_profiles mp where mp.user_id = v_uid) then
    return jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'MENTOR_PROFILE_NOT_FOUND');
  end if;

  -- 저장값 형식(student-id-images/…)으로 넘어와도 받는다 — 객체 경로만 남긴다
  if v_path like 'student-id-images/%' then
    v_path := substr(v_path, char_length('student-id-images/') + 1);
  end if;
  if v_path = '' then
    return jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'STORAGE_PATH_REQUIRED');
  end if;
  if split_part(v_path, '/', 1) is distinct from v_uid::text
     or split_part(v_path, '/', 2) = ''
     or v_path ~ '(^|/)\.\.(/|$)'
     or v_path like '%//%' then
    return jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'STORAGE_PATH_INVALID');
  end if;
  v_ext := lower(coalesce((regexp_match(v_path, '\.([A-Za-z0-9]+)$'))[1], ''));
  if v_ext not in ('jpg', 'jpeg', 'png', 'pdf') then
    return jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'STORAGE_FILE_TYPE_INVALID');
  end if;
  -- 객체 실재 + 정확한 버킷 + 소유(owner_id = auth.uid()) — 139 qna_register_attachment 동일 검증
  if not exists (select 1 from storage.objects o
                  where o.bucket_id = 'student-id-images' and o.name = v_path and o.owner_id = v_uid::text) then
    return jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'STORAGE_OBJECT_NOT_OWNED');
  end if;

  v_ref := 'student-id-images/' || v_path;
  update public.mentor_profiles mp
     set student_id_image_url = v_ref
   where mp.user_id = v_uid
   returning mp.updated_at into v_updated;

  return jsonb_build_object('ok', true, 'contract_version', 1, 'stored_ref', v_ref, 'updated_at', v_updated);
end
$fn$;

comment on function api_app_v1.mentor_student_id_document_set_self(text) is
  '203(DB-4 E-2): 학생증 사후 제출 반영 — student-id-images/{uid}/… 객체 실재·소유 검증 후 mentor_profiles.student_id_image_url 갱신(웹 submitMentorStudentIdImageAction 의 service_role UPDATE 와 동일 형식). 덮어쓰기 허용.';

-- ── 권한 ───────────────────────────────────────────────────────────────────────
revoke all on function api_app_v1.user_profile_update_self_v2(text, text, text) from public, anon;
revoke all on function api_app_v1.mentor_student_id_document_set_self(text) from public, anon;
grant execute on function api_app_v1.user_profile_update_self_v2(text, text, text) to authenticated;
grant execute on function api_app_v1.mentor_student_id_document_set_self(text) to authenticated;

do $$
declare v_n integer;
begin
  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'api_app_v1'
     and p.prosecdef and coalesce(p.proconfig::text, '') like '%search_path=%'
     and not has_function_privilege('anon', p.oid, 'EXECUTE')
     and has_function_privilege('authenticated', p.oid, 'EXECUTE')
     and not has_function_privilege('service_role', p.oid, 'EXECUTE')
     and (p.proacl is null or (p.proacl::text not like '{=%' and p.proacl::text not like '%,=%'))
     and (p.proname, pg_get_function_identity_arguments(p.oid)) in
         (('user_profile_update_self_v2', 'p_nickname text, p_grade_level text, p_student_status text'),
          ('mentor_student_id_document_set_self', 'p_object_path text'));
  if v_n <> 2 then
    raise exception '203_SELFCHECK: 함수 2종 identity/SECDEF/ACL 불일치(matched %)', v_n;
  end if;
  -- v1 불변 · impl 위임
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'api_app_v1' and p.proname = 'user_profile_update_self'
                    and pg_get_function_identity_arguments(p.oid) = 'p_nickname text, p_grade_level text'
                    and has_function_privilege('authenticated', p.oid, 'EXECUTE')) then
    raise exception '203_SELFCHECK: v1 user_profile_update_self 변경됨';
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'api_app_v1' and p.proname = 'user_profile_update_self_v2'
                    and p.prosrc like '%core_private.user_profile_update_self_impl(%'
                    and p.prosrc not like '%NICKNAME_TOO_LONG%') then
    raise exception '203_SELFCHECK: v2 가 impl 에 위임하지 않거나 닉네임 규칙을 복제했다';
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'api_app_v1' and p.proname = 'mentor_student_id_document_set_self'
                    and p.prosrc like '%storage.objects%' and p.prosrc like '%owner_id = v_uid::text%') then
    raise exception '203_SELFCHECK: 학생증 함수의 객체 소유 검증 부재';
  end if;
end $$;

commit;
