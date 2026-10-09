-- [backfill 2026-08-06] staging 적용분 역반영(원장 20260806075353).
--
-- G2 데이터 정합의 멱등 마이그레이션화: 2026-08-06 콘솔 직접 UPDATE 로
-- 반영했던 버전 정책 데이터를 재생 가능한 형태로 원장에 기록한다.
-- 조건부라 재실행·클린 DB 재생 모두 안전(행이 없으면 no-op — 정책 행
-- 시드는 운영 데이터 소관).
update public.mobile_app_version_policies
   set latest_build = greatest(coalesce(latest_build, 0), 16),
       minimum_version_name = coalesce(minimum_version_name, '1.0.0'),
       updated_at = now()
 where platform in ('ios','android')
   and (coalesce(latest_build, 0) < 16 or minimum_version_name is null);
