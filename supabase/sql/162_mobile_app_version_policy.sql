-- 162_mobile_app_version_policy.sql
-- [적용됨 — ssambership-staging 에 2026-07-21 적용(MCP execute_sql 단일 트랜잭션).
--   T1~T4 + S1~S4 + baseline 전부 PASS. seed=android/ios min=1(비차단).
--   적용 이력: docs/audit/sql_apply_manifest.md]
-- Track E 게이트 1/2 — 모바일 앱 최소 지원 버전 정책(강제 업데이트 인프라).
-- 배경: 게시판 댓글 정본(comments) 전환 시 구버전 앱(legacy write)과 신버전 앱의 데이터
--   갈라짐을 막으려면 서버 최소버전 응답 + 앱 시작 게이트가 필요하다(앱 계획 §0-2).
-- 설계:
--   - 정본 비교값은 build number 정수(min_supported_build/latest_build) — 버전 문자열
--     비교('1.10' < '1.9' 오판) 금지. minimum_version_name 은 표시용.
--   - 테이블 `mobile_app_version_policies`: RLS on·정책 0(직접 접근 불가) + anon/authenticated
--     테이블 권한 revoke → write 는 service_role 만.
--   - store_url 은 저장 시 CHECK 로 HTTPS + Google Play/App Store 허용 호스트만
--     (임의 URL 저장 자체가 불가). NULL 허용(스토어 등재 전).
--   - RPC `get_mobile_app_version_policy(p_platform)`: 앱 시작·로그인 전 호출 →
--     anon/authenticated EXECUTE. platform allowlist(android|ios) 밖은 INVALID_PLATFORM.
--     행 부재 시 차단하지 않는 기본값(min=1) 반환 — RPC 실패(네트워크)와
--     강제업데이트 필요 상태는 앱에서 분리 처리(실패=재시도 화면).
--   - 초기 seed: android/ios min_supported_build=1, latest_build=1 — 현재 앱(build 1)을
--     차단하지 않는 값. ★실제 최소 build 상향은 이 SQL 범위 밖(운영 절차로만).
-- 선행: 없음(독립).

begin;

create table if not exists public.mobile_app_version_policies (
  platform text primary key
    constraint mavp_platform_chk check (platform in ('android','ios')),
  min_supported_build integer not null default 1
    constraint mavp_min_build_chk check (min_supported_build >= 1),
  latest_build integer not null default 1,
  minimum_version_name text,
  store_url text
    constraint mavp_store_url_chk check (
      store_url is null or (
        store_url like 'https://%' and (
          store_url like 'https://play.google.com/%'
          or store_url like 'https://apps.apple.com/%'
          or store_url like 'https://itunes.apple.com/%'
        )
      )
    ),
  message text,
  updated_at timestamptz not null default now(),
  constraint mavp_latest_ge_min_chk check (latest_build >= min_supported_build)
);

alter table public.mobile_app_version_policies enable row level security;
revoke all on table public.mobile_app_version_policies from public, anon, authenticated;

drop trigger if exists trg_mavp_set_updated on public.mobile_app_version_policies;
create trigger trg_mavp_set_updated
  before update on public.mobile_app_version_policies
  for each row execute function public.set_updated_at();

-- 초기 seed — 현재 앱을 차단하지 않는 값(멱등).
insert into public.mobile_app_version_policies (platform, min_supported_build, latest_build)
values ('android', 1, 1), ('ios', 1, 1)
on conflict (platform) do nothing;

create or replace function public.get_mobile_app_version_policy(p_platform text)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_row public.mobile_app_version_policies;
begin
  if p_platform is null or lower(btrim(p_platform)) not in ('android','ios') then
    raise exception 'INVALID_PLATFORM' using errcode = '22023';
  end if;
  select * into v_row from public.mobile_app_version_policies
  where platform = lower(btrim(p_platform));
  if not found then
    -- 정책 행 부재 = 차단하지 않는 기본값(게이트 fail-open 은 여기까지 —
    -- RPC/네트워크 실패는 앱이 재시도 화면으로 분리 처리).
    return jsonb_build_object(
      'platform', lower(btrim(p_platform)),
      'min_supported_build', 1,
      'latest_build', 1,
      'minimum_version_name', null,
      'store_url', null,
      'message', null);
  end if;
  return jsonb_build_object(
    'platform', v_row.platform,
    'min_supported_build', v_row.min_supported_build,
    'latest_build', v_row.latest_build,
    'minimum_version_name', v_row.minimum_version_name,
    'store_url', v_row.store_url,
    'message', v_row.message);
end;
$$;

revoke all on function public.get_mobile_app_version_policy(text) from public;
grant execute on function public.get_mobile_app_version_policy(text) to anon, authenticated, service_role;

comment on table public.mobile_app_version_policies is
  'Track E: 모바일 최소 지원 build 정책(정수 비교 정본). write=service_role, read=RPC 경유만.';
comment on function public.get_mobile_app_version_policy(text) is
  'Track E: 앱 시작 게이트용 버전 정책 조회(anon 허용·platform allowlist).';

commit;

-- §V(적용 시 함께 실행한 검증 요약):
--   T1 테이블 존재·RLS on·정책 0·anon/authenticated 테이블 권한 없음
--   T2 CHECK: platform allowlist / min>=1 / latest>=min / store_url HTTPS+스토어 호스트만
--   T3 RPC anon+authenticated EXECUTE, secdef, search_path=public
--   T4 seed 2행(android/ios, min=1·latest=1 — 현재 앱 비차단)
--   S1 get('android') → min_supported_build=1(정수)·jsonb 필드 전체
--   S2 get('windows') → INVALID_PLATFORM
--   S3 (savepoint) store_url='http://play.google.com/…' 및 'https://evil.com/…' UPDATE → CHECK 거부,
--      'https://play.google.com/store/apps/details?id=com.ssambership.app' → 허용 후 롤백
--   S4 (savepoint) authenticated 로 테이블 직접 SELECT/UPDATE → 권한 거부(RPC 경유만)
--   S5 build 비교는 정수 계약 — '1.10'/'1.9' 문자열 비교 오판 원천 배제(스키마 타입 integer 확인)
--   fixture 전부 savepoint ROLLBACK, seed 만 커밋(비차단 값)
