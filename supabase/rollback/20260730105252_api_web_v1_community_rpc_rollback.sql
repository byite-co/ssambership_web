-- =============================================================================
-- 20260730105252_api_web_v1_community_rpc_rollback.sql (S2 M7 rollback)
-- =============================================================================
-- forward: supabase/sql/20260730105252_api_web_v1_community_rpc.sql
-- 정본: 계약 §20.2 M7 · §22 #2(역의존 — M16·M17 rollback 이 먼저. Batch C 시점에는
-- 해당 후속이 미적용이므로 Batch C 역순 최선두다). 제거 대상은 M7 이 만든 7객체
-- (wrapper F4·F5·F6 + 구현부 B-1~B-4)뿐이다 — wrapper 먼저, 구현부 역순.
-- CASCADE 금지 · community_posts 데이터·기존 정책·GRANT 무접촉.
-- 실행: ledger name = 20260730105252_api_web_v1_community_rpc_rollback (원장 새 행 append).
-- =============================================================================

begin;

DO $$
BEGIN
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE (n.nspname = 'api_web_v1'
              AND p.proname IN ('community_post_create','community_post_update','community_post_soft_delete'))
          OR (n.nspname = 'core_private'
              AND p.proname IN ('community_image_refs_validate','community_post_create_impl',
                                'community_post_update_impl','community_post_soft_delete_impl'))) <> 7 THEN
    RAISE EXCEPTION 'S2_M7_ROLLBACK_GATE: M7 forward state incomplete — nothing/partial to roll back';
  END IF;
END $$;

-- wrapper 3종 (생성 역순)
DROP FUNCTION api_web_v1.community_post_soft_delete(uuid);
DROP FUNCTION api_web_v1.community_post_update(uuid, text, text, text, timestamptz, text[], text);
DROP FUNCTION api_web_v1.community_post_create(text, text, text, uuid, text[], text);
-- 구현부 4종 (생성 역순 — B-3 → B-2 → B-1 → B-4)
DROP FUNCTION core_private.community_post_soft_delete_impl(uuid, uuid);
DROP FUNCTION core_private.community_post_update_impl(uuid, uuid, text, text, text, text[], text, timestamptz);
DROP FUNCTION core_private.community_post_create_impl(uuid, text, text, text, text[], text, uuid);
DROP FUNCTION core_private.community_image_refs_validate(uuid, text[]);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE (n.nspname = 'api_web_v1'
                     AND p.proname IN ('community_post_create','community_post_update','community_post_soft_delete'))
                 OR (n.nspname = 'core_private'
                     AND p.proname IN ('community_image_refs_validate','community_post_create_impl',
                                       'community_post_update_impl','community_post_soft_delete_impl'))) THEN
    RAISE EXCEPTION 'S2_M7_ROLLBACK_SELFCHECK: M7 objects not fully removed';
  END IF;
  -- M5 F10·M4 view 5종은 불변이어야 한다
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                  WHERE n.nspname = 'core_private' AND p.proname = 'ensure_student_mentor_room')
     OR (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'api_web_v1' AND c.relkind = 'v') <> 5 THEN
    RAISE EXCEPTION 'S2_M7_ROLLBACK_SELFCHECK: out-of-scope objects were touched';
  END IF;
END $$;

commit;
