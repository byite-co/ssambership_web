-- =============================================================================
-- 20260808032000_mavp_store_url_platform_host_chk.sql (F2 적대적 검증 후속)
-- =============================================================================
-- ADV-F2-3 실측: 기존 mavp_store_url_chk 는 https+스토어 호스트만 보므로
-- android 행에 apps.apple.com URL(플랫폼 뒤바뀜)을 넣어도 통과했다.
-- platform↔host 일치 CHECK 를 추가해 뒤바뀐 저장 자체를 거부한다.
--
-- 충돌 없음: 현재 staging 두 행 모두 store_url IS NULL(제약 통과).
-- min_supported_build/latest_build 는 건드리지 않는다.
-- "강제 업데이트 활성(min>1) 정책은 store_url NOT NULL" 제약은 현재 android
-- 행(min=9, url NULL — 스토어 등재 전)과 충돌하므로 추가하지 않고 제안으로 남긴다.
-- =============================================================================

begin;

DO $$
BEGIN
  IF to_regclass('public.mobile_app_version_policies') IS NULL THEN
    RAISE EXCEPTION 'MAVP_PLATFORM_CHK_ABORT: table not found';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.mobile_app_version_policies'::regclass
       AND conname = 'mavp_store_url_platform_chk'
  ) THEN
    RAISE NOTICE 'MAVP_PLATFORM_CHK: already present — skip';
  ELSE
    ALTER TABLE public.mobile_app_version_policies
      ADD CONSTRAINT mavp_store_url_platform_chk CHECK (
        store_url IS NULL
        OR (platform = 'android' AND store_url LIKE 'https://play.google.com/%')
        OR (platform = 'ios' AND (
              store_url LIKE 'https://apps.apple.com/%'
              OR store_url LIKE 'https://itunes.apple.com/%'
        ))
      );
  END IF;
END $$;

commit;
