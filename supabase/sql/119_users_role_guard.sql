-- =============================================================================
-- 119: users.role 권한상승 차단 가드 (XV-01 / P0)
-- =============================================================================
-- 배경(XV-01): 001 의 "users_update_own" 정책이 컬럼 제한 없이 본인 행 UPDATE 를
--   허용한다. 즉 로그인한 누구나
--     update public.users set role = 'admin' where id = auth.uid();
--   로 스스로를 admin 으로 승격할 수 있다(P0 권한상승). role 은 is_admin() ·
--   requireRole() · 다수 RLS 정책의 근거 값이라 즉시 전체 권한으로 번진다.
--
-- 조치: BEFORE UPDATE 트리거로 role 변경을 DB 최하층에서 차단한다.
--   허용 조건(아래 셋 중 하나) 외에는 ROLE_CHANGE_FORBIDDEN 예외.
--     1) 호출자 JWT role = 'service_role' (서버 admin API 경유)
--     2) JWT 자체가 없는 직접 DB 세션 (Supabase SQL Editor(postgres)·마이그레이션.
--        PostgREST/GoTrue 경유 요청은 항상 role 클레임을 갖고 오므로 API 로는
--        이 분기를 위조할 수 없다. 최초 admin 시드·수동 복구 경로 보존 목적)
--     3) 호출자가 public.users 에서 role = 'admin' (관리자 콘솔)
--   ※ users 에 is_admin 같은 boolean 권한 컬럼은 없음(001 정의 + alter 이력 grep 0건.
--     marketing_agreed 는 동의 플래그로 권한 아님) → 가드 대상은 role 단일 컬럼.
--   ※ 3) 은 003 의 public.is_admin() 과 동일 판정이나, 실행 순서 의존을 없애기 위해
--     인라인 EXISTS 로 자체 판정한다(BEFORE UPDATE 시점의 SELECT 는 변경 전
--     스냅샷을 보므로 자기 자신을 승격하며 통과하는 경로는 생기지 않는다).
--
-- 성격: 재실행 안전(create or replace + drop trigger if exists). 파괴적 변경 없음.
--   기존 정상 플로우(닉네임 등 role 무변경 UPDATE)는 WHEN 절에서 걸러져 비용 0에 수렴.
-- 사전 조건: 001(public.users). RLS 정책 변경 없음 — 정책과 무관하게 모든 UPDATE
--   경로(향후 정책 실수 포함)에 대해 동작하는 심층방어다.
-- 검증 쿼리: 파일 하단 §V.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- A. 가드 함수
-- -----------------------------------------------------------------------------
-- security definer: 함수 소유자 권한으로 public.users 를 조회해 호출자의 admin
-- 여부를 판정한다(호출자 RLS 로는 타인 행이 안 보여도 판정 가능해야 하므로).
-- auth.jwt() 는 request.jwt.claims(요청 JWT)를 읽으므로 definer 여부와 무관하게
-- "호출자" 기준이 유지된다.
create or replace function public.enforce_users_role_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_jwt_role text;
begin
  -- 트리거를 WHEN 절 없이 재생성해도 안전하도록 함수 안에서도 재확인
  if new.role is distinct from old.role then
    v_jwt_role := auth.jwt() ->> 'role';

    if v_jwt_role = 'service_role' then
      return new; -- 1) 서버(service key) 경유
    end if;

    if v_jwt_role is null then
      return new; -- 2) JWT 없는 직접 DB 세션(SQL Editor·마이그레이션)
    end if;

    if exists (
      select 1
        from public.users u
       where u.id = (select auth.uid())
         and u.role = 'admin'
    ) then
      return new; -- 3) 관리자
    end if;

    raise exception 'ROLE_CHANGE_FORBIDDEN'
      using errcode = '42501', -- insufficient_privilege
            detail  = format('users.id=%s role %L -> %L', old.id, old.role, new.role),
            hint    = 'role 변경은 service_role 또는 admin 만 가능합니다.';
  end if;

  return new;
end;
$$;

comment on function public.enforce_users_role_guard() is
  'XV-01: users.role 변경을 service_role/직접 DB 세션/admin 으로 제한하는 BEFORE UPDATE 가드.';

-- 트리거 함수는 RPC 로 직접 호출될 수 없지만 관례대로 실행권한을 조인다.
revoke execute on function public.enforce_users_role_guard() from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- B. 트리거 (재실행 안전)
-- -----------------------------------------------------------------------------
drop trigger if exists trg_users_role_guard on public.users;
create trigger trg_users_role_guard
  before update on public.users
  for each row
  when (old.role is distinct from new.role)
  execute function public.enforce_users_role_guard();

-- =============================================================================
-- §V. 적용 직후 검증 (Supabase SQL Editor 에서 수동 실행)
-- =============================================================================
-- §V-0. 설치 확인 — 1행(트리거)·1행(함수) 기대:
--   select tgname, tgenabled from pg_trigger
--    where tgrelid = 'public.users'::regclass and tgname = 'trg_users_role_guard';
--   select proname, prosecdef from pg_proc
--    where pronamespace = 'public'::regnamespace and proname = 'enforce_users_role_guard';
--
-- §V-a. 일반 유저 시뮬레이션 → ROLE_CHANGE_FORBIDDEN 에러 기대.
--   (<uid> 는 role='student'/'mentor' 인 실제 uuid 로 치환. RLS(users_update_own)
--    때문에 sub 와 where id 가 같아야 트리거까지 도달한다.)
--   begin;
--     set local role authenticated;
--     set local request.jwt.claims = '{"sub":"<uid>","role":"authenticated"}';
--     update public.users set role = 'admin' where id = '<uid>'::uuid;
--   rollback;
--   -- 기대: ERROR: ROLE_CHANGE_FORBIDDEN (42501)
--
-- §V-b. service_role 시뮬레이션 → 통과(UPDATE 1) 기대. rollback 이라 실변경 없음.
--   begin;
--     set local role service_role;
--     set local request.jwt.claims = '{"role":"service_role"}';
--     update public.users set role = 'mentor' where id = '<uid>'::uuid;
--   rollback;
--
-- §V-c. (참고) role 무변경 UPDATE 는 어떤 호출자든 가드 미발동:
--   §V-a 블록에서 set role 대신 nickname 등 다른 컬럼을 바꾸면 정상 통과해야 한다.
-- =============================================================================
