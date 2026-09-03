-- =============================================================================
-- 20260903230200_realtime_admin_topic_private_rollback.sql  (DB-3 묶음 B 롤백)
-- =============================================================================
-- forward: supabase/sql/197_realtime_admin_topic_private.sql
-- 되돌리는 것: realtime.messages 의 정책 2종(realtime_admin_topic_select · realtime_admin_topic_insert) DROP → 정책 0 개(적용 전 실측 상태).
-- 주의: 웹이 이미 private 채널(PR-W3)로 배포돼 있으면 정책이 사라진 뒤 관리자도 join 이 거부된다(Presence 는 조용히 unavailable —
--   잠금 없음 · 결정 버튼 영향 0). 웹을 public 채널로 먼저 되돌리거나 그 상태를 감수한다.
-- 독립 — 196/198 과 순서 제약 없음.
-- =============================================================================

begin;

drop policy if exists realtime_admin_topic_select on realtime.messages;
drop policy if exists realtime_admin_topic_insert on realtime.messages;

-- 복원 검증
do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'realtime' and tablename = 'messages'
              and policyname in ('realtime_admin_topic_select', 'realtime_admin_topic_insert')) then
    raise exception '197_ROLLBACK_SELFCHECK: 정책 잔존';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'realtime.messages'::regclass) then
    raise exception '197_ROLLBACK_SELFCHECK: realtime.messages RLS 가 꺼져 있다(이 롤백은 RLS 를 만지지 않는다)';
  end if;
end $$;

commit;
