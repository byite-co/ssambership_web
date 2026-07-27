-- 181_p1_10_account_deletion_storage_owner_refs.sql
-- ⚠️ 기능 플래그 OFF 기본 · worker kill switch OFF 고정. 실제 사용자·객체 삭제 없음.
--    기존 SQL 167~180 파일은 **수정하지 않는다** — 신규 함수 1개만 추가한다(W5-e E2).
--
-- W5-e E2: owner 증거 수집의 PGRST106 해소 — storage owner 전용 SECURITY DEFINER RPC.
--
-- ── 문제(W5-e §2-2 read-only 재현, staging lbeqxarxothkmzqvpudy, 2026-07-26) ──
--   owner 증거 어댑터(`makeResolveObjectOwners`, accountDeletionAdapters.ts)가
--   PostgREST 로 `storage` 스키마를 직접 조회한다(`admin.schema("storage").from("objects")`).
--   staging 의 PostgREST 노출 스키마는 `public, graphql_public` 뿐이라 런타임에
--     {"code":"PGRST106","message":"Invalid schema: storage"}  (HTTP 406)
--   → 어댑터는 설계대로 예외를 던지고 워커는 fail-closed 로 정지한다.
--   (fail-closed 자체는 옳다 — 고칠 것은 "소유 증거를 읽을 수단"이다.)
--
-- ── 채택 ──────────────────────────────────────────────────────────────────────
--   177(session revoke)·180(forfeit key canon)과 동일 패턴: public 스키마의
--   SECURITY DEFINER 함수가 비노출 스키마를 대신 읽고, EXECUTE 는 service_role 로만
--   좁힌다. PostgREST 는 public 스키마 RPC 로 호출하므로 PGRST106 이 구조적으로
--   사라진다.
--
-- ── 캐스팅 근거(§2-1 information_schema 실측 — 추측 아님) ─────────────────────
--   storage.objects.owner_id 의 실제 타입은 **text** 다(구 `owner` 컬럼이 uuid).
--   따라서 비교는 `o.owner_id = p_user_id::text` 로 한다. p_user_id 가 null 이면
--   비교가 unknown 이 되어 0행 — null 가드가 따로 필요 없다.
--
-- ── 반환 최소화(least exposure) ───────────────────────────────────────────────
--   (bucket_id, name) 2컬럼만 반환한다. id·metadata·owner·user_metadata 등은
--   워커 계획 산출에 불필요하며 반환하지 않는다.
--
-- 선행: 175, 176, 177, 178, 179, 180.

begin;
set local lock_timeout='5s';

create or replace function public.account_deletion_storage_owner_refs(p_user_id uuid)
returns table(bucket_id text, name text)
language sql
stable
security definer
set search_path to 'public'
as $$
  select o.bucket_id, o.name
    from storage.objects o
   where o.owner_id = p_user_id::text;
$$;

comment on function public.account_deletion_storage_owner_refs(uuid) is
  '181: 계정 삭제 owner 증거 수집 — storage.objects 에서 owner_id = 대상 uid 인 객체의 '
  '(bucket_id, name)만 반환. PostgREST 가 storage 스키마를 노출하지 않아(PGRST106) '
  'public 스키마 SECURITY DEFINER RPC 로 대신 읽는다 — 177/180 과 동일 패턴. '
  'owner_id 는 text 라 uuid 를 ::text 캐스팅해 비교한다(§2-1 실측). service_role 전용.';

revoke all on function public.account_deletion_storage_owner_refs(uuid) from public, anon, authenticated;
grant execute on function public.account_deletion_storage_owner_refs(uuid) to service_role;

commit;

-- ── §V 검증(적용 후 실행 — T34~T36, 별도 begin; … rollback; 배치·mutation 0) ──
-- T34 ACL: has_function_privilege('anon'|'authenticated', …, 'EXECUTE') 전부 false
--     (anon false 는 PUBLIC grant 부재까지 함의 — PUBLIC 경유 상속이 없다는 뜻).
--     proacl 에 '=X'(PUBLIC) 엔트리 없음 · service_role=X 만.
-- T35 owner_id 보유 실사용자 1명의 uid 로 호출(set local role service_role)
--     → 반환 행수 = select count(*) from storage.objects where owner_id = 그 uid::text
-- T36 임의 신규 uuid → 0행 · pg_get_function_result = 'TABLE(bucket_id text, name text)'
--
-- ── ROLLBACK ────────────────────────────────────────────────────────────────
--   drop function if exists public.account_deletion_storage_owner_refs(uuid);
--   (추가형 단일 함수 — 되돌림 무손실. storage 스키마 객체는 일절 변경하지 않았다.)
