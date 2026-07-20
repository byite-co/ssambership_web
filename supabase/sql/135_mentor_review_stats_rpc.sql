-- --------------------------------------------------------------------------
-- 135_mentor_review_stats_rpc.sql   (P3-2 · 멘토 리뷰 통계 서버 집계 RPC)
-- [적용됨 — ssambership-staging 에 2026-07-19 단일 트랜잭션(lock_timeout 3s) 적용·검증 통과
--   (T1 secdef/search_path · T2 anon/authenticated 실행 · T3 0행 빈결과 · S1 공개 blinded 제외 ·
--    S2 비관리자 include_hidden 강제 공개 · S3 관리자 include). fixture savepoint 롤백·baseline 0행 복원.
--   원장 미기재 — 적용 이력: docs/audit/sql_apply_manifest.md]
-- 목적: 리뷰 평균/분포를 클라이언트가 최대 500건 fetch 후 집계하던 cap 결함을 제거하고, 서버에서
--   mentor별 count·평균·분포(1~5)를 집계해 반환한다. **집계값만 반환**(원본 행 미노출)하므로 일반
--   사용자가 blinded/hidden 원본을 우회 조회할 수 없다. 공개 통계는 is_hidden/is_blinded 를 제외한다.
--   include_hidden 은 관리자(is_admin())만 허용(그 외는 강제 false).
-- 선행: 042/123/126(reviews 정본: mentor_id·rating·is_hidden·is_blinded). is_admin() 필요.
-- 방식: SECURITY DEFINER 집계 RPC(권한 제한 — 원본 미노출·include_hidden admin 게이트). anon/authenticated 실행 허용.
-- --------------------------------------------------------------------------

create or replace function public.get_mentor_review_stats(
  p_mentor_id uuid,
  p_include_hidden boolean default false
)
returns table(review_count integer, avg_rating numeric, d1 integer, d2 integer, d3 integer, d4 integer, d5 integer)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_include_hidden boolean := coalesce(p_include_hidden, false);
begin
  -- include_hidden 은 관리자만 허용. 그 외에는 공개 집계(hidden/blinded 제외)로 강제.
  if v_include_hidden and not coalesce(public.is_admin(), false) then
    v_include_hidden := false;
  end if;

  return query
  select
    count(*)::integer,
    case when count(*) > 0 then round(avg(r.rating)::numeric, 1) else null end,
    count(*) filter (where round(r.rating) = 1)::integer,
    count(*) filter (where round(r.rating) = 2)::integer,
    count(*) filter (where round(r.rating) = 3)::integer,
    count(*) filter (where round(r.rating) = 4)::integer,
    count(*) filter (where round(r.rating) = 5)::integer
  from public.reviews r
  where r.mentor_id = p_mentor_id
    and (
      v_include_hidden
      or (coalesce(r.is_hidden, false) = false and coalesce(r.is_blinded, false) = false)
    );
end;
$$;

comment on function public.get_mentor_review_stats(uuid, boolean) is
  'P3-2: 멘토 리뷰 통계(count·avg·분포) 서버 집계. 집계값만 반환(원본 미노출). 공개는 hidden/blinded 제외, include_hidden 은 is_admin() 전용.';

revoke all on function public.get_mentor_review_stats(uuid, boolean) from public;
grant execute on function public.get_mentor_review_stats(uuid, boolean) to anon, authenticated, service_role;
