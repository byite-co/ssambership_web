-- =============================================================================
-- 195_drop_school_tier_mappings.sql  (2026-09-03 · DB-2 묶음 C — 매핑 테이블 정리 · 권고)
--
-- school_tier_mappings(079) 는 행 0 · 코드 참조 0(판정 트리거·RPC 는 192 의 LIKE 하드코딩 헬퍼를 쓴다) · 뷰/FK 의존 0 이다.
--   적용 전 실측(2026-09-03 운영 read-only): 행 0 · 참조 함수 0 · 의존 뷰 0 · 참조 FK 0. 웹에서 이 표를 읽는 곳은 등급 분류
--   화면의 "읽기 전용 매핑 표" 섹션뿐이며(PR-11 §0-B-1) PR-W2 가 그 섹션을 내린다(그 전까지는 섹션이 "불러오지 못했습니다" 로 보인다).
-- DROP TABLE(RESTRICT · CASCADE 금지). 정책·인덱스·updated_at 트리거는 테이블과 함께 사라진다.
-- 오너가 거부하면 이 파일(pack 사본 · rollback 포함)만 뺀다.
--
-- Apply: 저장소 표준 경로(db-apply-pending) — 즉석 실행 금지. 적용 순서 A(193) → B(194) → C(195).
--   pack 등재: supabase/baseline/post_ledger_backfills/20260903200300_drop_school_tier_mappings.sql
-- Rollback: supabase/rollback/20260903200300_drop_school_tier_mappings_rollback.sql (079 원문 재생성)
-- 검증(§6): select to_regclass('public.school_tier_mappings');   -- NULL 기대
-- =============================================================================

begin;

-- ── 0. 사전 게이트 — 비어 있고 아무도 참조하지 않을 때만 지운다 ──────────────
do $$
declare v_n bigint;
begin
  if to_regclass('public.school_tier_mappings') is null then
    raise exception '195_GATE: school_tier_mappings 부재(이미 적용됐거나 전제 불일치)';
  end if;
  execute 'select count(*) from public.school_tier_mappings' into v_n;
  if v_n <> 0 then
    raise exception '195_ABORT: school_tier_mappings 에 % 행이 있다 — 비어 있지 않으면 지우지 않는다', v_n;
  end if;
  if exists (select 1 from pg_depend d join pg_rewrite r on r.oid = d.objid
              where d.refobjid = 'public.school_tier_mappings'::regclass
                and r.ev_class <> 'public.school_tier_mappings'::regclass) then
    raise exception '195_ABORT: school_tier_mappings 를 참조하는 뷰가 있다';
  end if;
  if exists (select 1 from pg_constraint where confrelid = 'public.school_tier_mappings'::regclass) then
    raise exception '195_ABORT: school_tier_mappings 를 참조하는 FK 가 있다';
  end if;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname not in ('pg_catalog', 'information_schema') and p.prosrc ilike '%school_tier_mappings%') then
    raise exception '195_ABORT: school_tier_mappings 를 참조하는 함수가 있다';
  end if;
  if to_regclass('public.school_tier_catalog') is null then
    raise exception '195_GATE: school_tier_catalog 부재(079 전제)';
  end if;
end $$;

drop table public.school_tier_mappings;

-- ── 적용 직후 자가 검증 ───────────────────────────────────────────────────────
do $$
begin
  if to_regclass('public.school_tier_mappings') is not null then
    raise exception '195_SELFCHECK: school_tier_mappings 잔존';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'school_tier_mappings')
     or exists (select 1 from pg_class where relname in ('school_tier_mappings_school_name_unique', 'school_tier_mappings_active_order_idx')) then
    raise exception '195_SELFCHECK: 정책/인덱스 잔존';
  end if;
  if to_regclass('public.school_tier_catalog') is null or to_regclass('public.major_category_catalog') is null then
    raise exception '195_SELFCHECK: 카탈로그 테이블이 사라졌다';
  end if;
end $$;

commit;
