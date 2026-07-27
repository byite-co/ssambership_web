-- 174_mentor_school_verification_approval_canon.sql
-- 멘토 학교·전공 인증 승인 정본화 — 서류 실재 확인 + 재승인 수명주기(superseded) + 1인 1승인 강제.
--
-- 배경(2026-07-26 staging 실조회, project lbeqxarxothkmzqvpudy):
--   - `mentor_school_verifications` 0행 · 인덱스 3건(pkey(id) · btree(mentor_id) · btree(status)).
--     UNIQUE·partial 인덱스 **없음** → "멘토별 approved 최대 1건"을 DB 가 강제하지 않는다.
--   - status CHECK = `mentor_school_verifications_status_check`
--     ARRAY['pending','approved','rejected','resubmit_required'] — 'superseded' **부재**.
--   - `document_storage_ref` text NULL · CHECK 없음 → approved 인데 서류 참조가 NULL 인 행이
--     구조적으로 허용된다(승인 전제 미강제).
--   - 제출(`submitMentorSchoolVerificationAction`)은 **append-only**: 재제출마다 새 행 INSERT.
--     관리자 액션은 `.in('status', ['pending','resubmit_required'])` 로만 UPDATE 하므로
--     **이미 approved 인 행은 어떤 기존 경로로도 변경되지 않는다** → 재승인 시 approved 가 누적된다.
--   - 서류 참조 저장 형식(정본 writer): `student-id-images/{mentorId}/school-verifications/{ts}-{hex32}.{ext}`
--     (`lib/storage/studentIdImageStorage.ts` — 버킷 접두 포함). reader 는 레거시 절대 URL 과
--     접두 없는 경로도 허용하므로 아래 정규화 함수가 **동일 규칙**을 재현한다.
--   - `postgres` rolbypassrls=true → SECURITY DEFINER(owner=postgres) 함수는 storage.objects 를
--     RLS 에 막히지 않고 조회한다(실재 확인이 거짓 음성으로 실패하지 않음).
--   - 트리거 `mentor_school_verifications_guard_self_review` 는 `is_admin()` 이 true 면 NEW 를
--     그대로 반환한다 → 관리자 경유 승인/승계 UPDATE 에 간섭하지 않는다.
--
-- 규칙:
--   - CHECK 확장은 **additive**: 기존 4값 + 'superseded'. 기존 행 백필 INSERT/UPDATE 0건
--     (테이블 0행 — 백필 대상 자체가 없다).
--   - 승인은 이 RPC **한 경로**로만 한다. 서류 참조 없음·객체 부재·소유 불일치는 전부 거부이며
--     예외로 트랜잭션 전체가 rollback 된다(승인 0 · 기존 approved 변경 0).
--   - 재승인은 같은 트랜잭션에서 기존 approved → 'superseded' 전이 후 대상 행을 approved 로 만든다.
--   - 부분 UNIQUE 인덱스는 **RPC 정의 뒤에** 만든다(재승인 경로가 승계를 먼저 수행하게 된 뒤에만
--     1인 1승인을 강제해야 정상 재승인이 23505 로 죽지 않는다).
--   - 동시 승인은 mentor 단위 advisory xact lock 으로 직렬화하고, 최종 불변식은 부분 UNIQUE
--     인덱스가 강제한다(락을 우회한 경로가 있어도 approved 2행은 성립할 수 없다).
-- 선행: 077(테이블·트리거·RLS), 079(school_tier CHECK 6값).

-- ── 0. 사전 검증: 예상 상태와 다르면 중단(임의 정정 금지) ──
do $$
declare
  v_check_def text;
  v_dup integer;
  v_bad integer;
begin
  select pg_get_constraintdef(c.oid) into v_check_def
  from pg_constraint c
  where c.conrelid = 'public.mentor_school_verifications'::regclass
    and c.conname = 'mentor_school_verifications_status_check';

  if v_check_def is null then
    raise exception 'SQL174_ABORT: mentor_school_verifications_status_check 부재 — 스키마 전제 불일치';
  end if;
  if v_check_def not like '%pending%' or v_check_def not like '%approved%'
     or v_check_def not like '%rejected%' or v_check_def not like '%resubmit_required%' then
    raise exception 'SQL174_ABORT: status CHECK 정의가 예상과 다름(%) — 임의 교체 금지', v_check_def;
  end if;

  -- 이미 멘토별 approved 중복이 있으면 인덱스 생성이 실패한다. 임의 삭제하지 않고 중단.
  select count(*) into v_dup from (
    select mentor_id from public.mentor_school_verifications
     where status = 'approved' group by mentor_id having count(*) > 1
  ) d;
  if v_dup > 0 then
    raise exception 'SQL174_ABORT: approved 중복 멘토 % 명 — 승계 정책 결정 전까지 중단(임의 정리 금지)', v_dup;
  end if;

  -- 서류 참조가 비어 있는 approved 행이 있으면 새 계약과 모순 — 관측만 하고 중단.
  select count(*) into v_bad from public.mentor_school_verifications
   where status = 'approved' and btrim(coalesce(document_storage_ref, '')) = '';
  if v_bad > 0 then
    raise exception 'SQL174_ABORT: 서류 참조 없는 approved % 행 — 백필/무효화 결정 필요(이 스크립트는 백필하지 않음)', v_bad;
  end if;
end $$;

-- ── 1. status CHECK additive 확장(+ 'superseded') ──
-- 079 가 school_tier 에서 쓴 것과 같은 drop-then-add 패턴. 값 집합만 넓히고 좁히지 않는다.
alter table public.mentor_school_verifications
  drop constraint if exists mentor_school_verifications_status_check;

alter table public.mentor_school_verifications
  add constraint mentor_school_verifications_status_check
  check (status = any (array['pending'::text, 'approved'::text, 'rejected'::text,
                             'resubmit_required'::text, 'superseded'::text]));

comment on constraint mentor_school_verifications_status_check
  on public.mentor_school_verifications is
  'SQL174: 기존 4값 + superseded(재승인 시 직전 approved 의 종료 상태). additive — 값 축소 없음.';

-- ── 2. 서류 참조 정규화 헬퍼 ──
-- lib/storage/studentIdImageStorage.ts:parseStudentIdImageStorageRef 와 동일 규칙:
--   ① 공백 제거 후 빈 문자열 → null
--   ② http(s):// → '/student-id-images/' 마커 뒤를 취하고 ?query·#fragment 절단
--   ③ 'student-id-images/' 접두 → 접두 제거 후 선행 슬래시 제거
--   ④ 슬래시를 포함한 경로 → 선행 슬래시만 제거
--   ⑤ 그 외(슬래시 없는 단일 토큰) → null
create or replace function public.mentor_school_verification_storage_path(p_ref text)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  v_raw text := btrim(coalesce(p_ref, ''));
  v_marker constant text := '/student-id-images/';
  v_prefix constant text := 'student-id-images/';
  v_idx integer;
  v_path text;
begin
  if v_raw = '' then
    return null;
  end if;

  if v_raw like 'http://%' or v_raw like 'https://%' then
    v_idx := position(v_marker in v_raw);
    if v_idx = 0 then
      return null;
    end if;
    v_path := substr(v_raw, v_idx + length(v_marker));
    v_path := split_part(v_path, '?', 1);
    v_path := split_part(v_path, '#', 1);
    return nullif(btrim(v_path), '');
  end if;

  if v_raw like (v_prefix || '%') then
    return nullif(regexp_replace(substr(v_raw, length(v_prefix) + 1), '^/+', ''), '');
  end if;

  if position('/' in v_raw) > 0 then
    return nullif(regexp_replace(v_raw, '^/+', ''), '');
  end if;

  return null;
end;
$$;

comment on function public.mentor_school_verification_storage_path(text) is
  'SQL174: 저장된 document_storage_ref → student-id-images 버킷 내 객체 경로. 웹 parseStudentIdImageStorageRef 와 동일 규칙. 판별 불가 시 NULL.';

revoke all on function public.mentor_school_verification_storage_path(text) from public;
revoke all on function public.mentor_school_verification_storage_path(text) from anon;
revoke all on function public.mentor_school_verification_storage_path(text) from authenticated;

-- ── 3. 승인 정본 RPC ──
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
  v_path text;
  v_owner_segment text;
  v_superseded integer := 0;
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
  if v_row.status not in ('pending', 'resubmit_required') then
    raise exception 'NOT_REVIEWABLE: %', v_row.status using errcode = '22023';
  end if;

  -- (c) 서류 참조 실재 확인 — 참조 자체가 없으면 승인 불가.
  if btrim(coalesce(v_row.document_storage_ref, '')) = '' then
    raise exception 'DOCUMENT_REF_MISSING' using errcode = '22023';
  end if;
  v_path := public.mentor_school_verification_storage_path(v_row.document_storage_ref);
  if v_path is null then
    raise exception 'DOCUMENT_REF_UNPARSEABLE' using errcode = '22023';
  end if;

  -- 경로 위조 차단: 객체는 제출 멘토 소유 디렉터리 아래여야 한다
  -- (writer 규약 '{mentorId}/school-verifications/...' — 타인 서류 참조 승인 금지).
  v_owner_segment := split_part(v_path, '/', 1);
  if v_owner_segment is distinct from v_row.mentor_id::text then
    raise exception 'DOCUMENT_REF_OWNER_MISMATCH' using errcode = '42501';
  end if;

  -- 실제 Storage 객체 행 존재 확인(부재면 승인 0 · 기존 approved 변경 0 으로 rollback).
  if not exists (
    select 1 from storage.objects o
     where o.bucket_id = 'student-id-images'
       and o.name = v_path
  ) then
    raise exception 'DOCUMENT_OBJECT_NOT_FOUND' using errcode = '22023';
  end if;

  -- (d) 재승인 수명주기 — 같은 트랜잭션에서 기존 approved 를 먼저 종료시킨다.
  update public.mentor_school_verifications
     set status = 'superseded',
         updated_at = now()
   where mentor_id = v_row.mentor_id
     and status = 'approved'
     and id <> v_row.id;
  get diagnostics v_superseded = row_count;

  -- (e) 대상 행 승인.
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

  -- 감사 가능 최소 정보만 반환한다(서류 내용·signed URL·토큰 미포함).
  return jsonb_build_object(
    'verification_id', v_row.id,
    'mentor_id', v_row.mentor_id,
    'status', 'approved',
    'superseded_count', v_superseded,
    'reviewed_by', v_admin
  );
end;
$$;

comment on function public.approve_mentor_school_verification_admin(uuid, text, text, text, text, text) is
  'SQL174: 학교·전공 인증 승인 정본. is_admin() 전용 · 서류 참조 실재(storage.objects) 확인 · 소유 경로 검증 · 재승인 시 기존 approved → superseded 를 같은 트랜잭션에서 수행. 실패는 전부 예외(부분 반영 없음).';

revoke all on function public.approve_mentor_school_verification_admin(uuid, text, text, text, text, text) from public;
revoke all on function public.approve_mentor_school_verification_admin(uuid, text, text, text, text, text) from anon;
grant execute on function public.approve_mentor_school_verification_admin(uuid, text, text, text, text, text)
  to authenticated, service_role;

-- ── 4. 1인 1승인 부분 UNIQUE 인덱스(반드시 RPC 뒤) ──
create unique index if not exists uq_msv_one_approved_per_mentor
  on public.mentor_school_verifications (mentor_id)
  where status = 'approved';

comment on index public.uq_msv_one_approved_per_mentor is
  'SQL174: 멘토별 approved 최대 1행. 재승인은 approve_mentor_school_verification_admin 이 승계(superseded) 후 승인하므로 정상 경로에서는 위반하지 않는다.';

-- ── ROLLBACK 절차 ──
-- 역순으로 되돌린다(인덱스 → RPC → 헬퍼 → CHECK).
--
--   drop index if exists public.uq_msv_one_approved_per_mentor;
--   drop function if exists public.approve_mentor_school_verification_admin(uuid, text, text, text, text, text);
--   drop function if exists public.mentor_school_verification_storage_path(text);
--   -- CHECK 를 4값으로 되돌리기 전에 superseded 행이 남아 있으면 23514 로 실패한다.
--   -- 되돌릴 경우 승계 이력을 어떤 값으로 접을지 먼저 결정해야 한다(임의 UPDATE 금지).
--   alter table public.mentor_school_verifications
--     drop constraint if exists mentor_school_verifications_status_check;
--   alter table public.mentor_school_verifications
--     add constraint mentor_school_verifications_status_check
--     check (status = any (array['pending'::text,'approved'::text,'rejected'::text,'resubmit_required'::text]));
