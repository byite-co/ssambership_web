-- 177_p1_10_account_deletion_session_revoke.sql
-- ⚠️ 기능 플래그 OFF 기본 · worker kill switch OFF 고정. 실제 사용자·객체 삭제 없음.
--
-- W5 §3-2: 세션 폐기 인자 오용 제거 — uid 기반 실동작 수단 신설.
--
-- ── 문제(기준 HEAD a6e9183 실측) ──────────────────────────────────────────────
--   `makeRevokeSessions` 가 `admin.auth.admin.signOut(userId, "global")` 를 부른다.
--   설치된 `@supabase/auth-js` **2.104.1** 의 실제 계약은
--       signOut(jwt: string, scope?: SignOutScope)
--   이며 **첫 인자는 사용자 UUID 가 아니라 로그인된 사용자의 JWT** 다. worker 는 그 JWT 가 없다.
--   구 코드가 tsc 를 통과한 이유는 `as unknown as {...}` 로 SDK 타입을 버리고
--   자체 구조 타입을 새로 선언했기 때문이다(타입 우회).
--
-- ── SDK 실측(GoTrueAdminApi 공개 메서드 전수) ────────────────────────────────
--   signOut(jwt, scope?) · inviteUserByEmail · generateLink · createUser · listUsers ·
--   getUserById · updateUserById(uid, attributes) · deleteUser(id, shouldSoftDelete?)
--   (그 외는 전부 private, + mfa/oauth/customProviders 서브 API)
--   → **uid 만으로 전 세션을 끊는 admin 메서드는 존재하지 않는다.**
--   `AdminUserAttributes.ban_duration?: string | 'none'` 은 실재한다(types.d.ts:446).
--
-- ── 채택 ──────────────────────────────────────────────────────────────────────
--   지시서가 허용한 3선택지 중 ①+② 를 **함께** 쓴다. 둘은 서로 다른 계약을 만족하며
--   어느 하나로는 부족하기 때문이다:
--     ① updateUserById(uid, { ban_duration }) → 신규 로그인·refresh 교환을 Auth 가 거절
--     ② 이 파일의 RPC                          → auth.sessions·auth.refresh_tokens 실삭제
--   ★ 어느 쪽도 **이미 발급된 access token 자체는 무효화하지 못한다**(JWT 무상태 —
--     PostgREST/Storage 는 만료 전까지 서명만 본다). 그 구간은 151/154 write gate 가 막는다.
--     "세션 폐기" · "재로그인 차단" · "기존 토큰 무효화" 는 서로 다른 계약이다 — 합치지 않는다.
--
-- 보안 요건(지시서 §3-2 선택지 2 의무): SECURITY DEFINER · 고정 search_path ·
--   authenticated·anon·PUBLIC EXECUTE 0 · service_role 전용 grant.
-- 반환값·로그에 토큰 문자열·세션 식별자를 싣지 않는다(개수만).
--
-- 선행: 151, 154, 175, 176.

begin;
set local lock_timeout='5s';

create or replace function public.account_deletion_revoke_sessions(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_sessions int := 0; v_tokens int := 0;
begin
  if p_user_id is null then
    return jsonb_build_object('ok', false, 'code', 'USER_REQUIRED');
  end if;

  -- refresh token 을 먼저 지운다(세션 FK 로 묶인 것 + 레거시 user_id 문자열 컬럼 양쪽).
  delete from auth.refresh_tokens rt
   where rt.session_id in (select s.id from auth.sessions s where s.user_id = p_user_id)
      or rt.user_id = p_user_id::text;
  get diagnostics v_tokens = row_count;

  delete from auth.sessions s where s.user_id = p_user_id;
  get diagnostics v_sessions = row_count;

  -- 토큰 값·세션 uuid 는 반환하지 않는다 — 개수만.
  return jsonb_build_object(
    'ok', true,
    'sessions_deleted', v_sessions,
    'refresh_tokens_deleted', v_tokens
  );
end $$;

comment on function public.account_deletion_revoke_sessions(uuid) is
  '177: 계정 삭제 locked 단계의 세션 실폐기(auth.sessions·auth.refresh_tokens). service_role 전용. 반환은 개수만.';

revoke all on function public.account_deletion_revoke_sessions(uuid) from public, anon, authenticated;
grant execute on function public.account_deletion_revoke_sessions(uuid) to service_role;

commit;

-- ── §V 검증(적용 후 실행) ────────────────────────────────────────────────────
-- (1) ACL 실측 — authenticated·anon·PUBLIC EXECUTE 0
--     select p.oid::regprocedure::text, p.prosecdef, p.proconfig::text,
--            array_to_string(p.proacl,' | ') as acl
--       from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--      where n.nspname='public' and p.proname='account_deletion_revoke_sessions';
--     기대: prosecdef=true · proconfig={search_path=public} ·
--           acl = postgres=X/postgres | service_role=X/postgres  (anon·authenticated·"=X" 없음)
-- (2) 전용 staging fixture 로 세션 1건 생성 후 호출 → sessions_deleted>0,
--     기존 access token 보호 API 재요청 실패 · 기존 refresh token 갱신 실패를 **각각** 판정.
--     신규 로그인 차단 여부는 ①(ban) 의 몫이며 **별도로** 판정한다.
--
-- ── ROLLBACK ────────────────────────────────────────────────────────────────
--   drop function if exists public.account_deletion_revoke_sessions(uuid);
--   (추가형 단일 함수 — 되돌림 무손실. auth 스키마 객체는 일절 변경하지 않았다.)
