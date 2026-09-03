-- =============================================================================
-- 197_realtime_admin_topic_private.sql  (2026-09-03 · DB-3 묶음 B — Realtime 관리자 채널 비공개 ★)
--
-- 왜: PR-2b(멘토 승인 동시 심사 표시)의 Presence 채널 `admin:mentor-approval` 이 public 채널이다. public 채널은
--   `realtime.messages` RLS 를 검사하지 않으므로 anon 키만 있으면 누구나 join 해 관리자 표시명·지금 보는 지원자 id 를 볼 수 있다.
--   private 채널(`config.private = true`)은 join 시 Realtime 이 `realtime.messages` 의 RLS 정책(SELECT = 수신 · INSERT = 송신/presence track)
--   을 그 사용자의 JWT 로 평가한다 — 정책이 0 개이면 전부 거부. 따라서 정책을 먼저 두고(이 파일), 그 다음 웹이 private 로 바꾼다(PR-W3).
--
-- B-1 정책: `admin:` 으로 시작하는 토픽은 is_admin() 인 authenticated 만 SELECT · INSERT.
--   · realtime.topic() = current_setting('realtime.topic') — Realtime 이 인가 검사 트랜잭션에서 채널 토픽을 넣어 준다(운영 실측 본문 동일).
--   · 그 외 토픽은 정책을 두지 않는다 = 현재 동작 유지. 실측(2026-09-03): 웹·앱 어느 쪽도 `realtime.messages` 를 쓰는 private 채널이 없다.
--       웹: Realtime 사용처는 PR-2b Presence 채널 하나(public). 질문방·개별질문·알림 실시간은 웹에 없다.
--       앱: question_thread_<id> · iq_<id> · notifications_<uid> 채널 = postgres_changes(public 채널 · 발행 supabase_realtime + 테이블 RLS) —
--           `realtime.messages` 와 무관하다(Broadcast/Presence 인가 테이블). 이 정책은 그 채널들에 영향이 없다.
--   · anon 은 정책 대상이 아니다(private 채널 join 거부 유지) · service_role 은 RLS 우회.
-- B-2 클라이언트(PR-W3): PR-2b 채널 구독을 `config: { private: true }` + 구독 전 `supabase.realtime.setAuth()`. 정책이 없으면 구독이 실패하므로
--   **이 파일 적용 후** 배포. 실패 시 조용히 unavailable(PR-2b 가 이미 그렇게 한다).
--
-- 적용 전 실측(2026-09-03 운영 read-only): realtime.messages 실재 · owner supabase_realtime_admin · RLS on(force off) · 정책 0 개 ·
--   realtime.topic() 실재 · 컬럼 topic/extension/payload/event/private/updated_at/inserted_at/id/binary_payload ·
--   GRANT anon/authenticated/service_role = SELECT·INSERT·UPDATE · postgres 는 owner 가 아니지만 supautils.policy_grants 에
--   realtime.messages 가 등재돼 있어 CREATE POLICY 가 허용된다(storage.objects 정책 42 개가 같은 경로로 만들어졌다).
--
-- Apply: 저장소 표준 경로(db-apply-pending) — 즉석 실행 금지. 적용 순서 A(196) → B(197) → C(198).
--   pack 등재: supabase/baseline/post_ledger_backfills/20260903230200_realtime_admin_topic_private.sql
-- Rollback: supabase/rollback/20260903230200_realtime_admin_topic_private_rollback.sql
-- 검증(§6): select policyname, cmd, roles, qual, with_check from pg_policies where schemaname = 'realtime' and tablename = 'messages';
-- =============================================================================

begin;

-- ── 0. 사전 게이트 — 예상 상태와 다르면 중단(임의 정정 금지) ──────────────────
do $$
begin
  if to_regclass('realtime.messages') is null then
    raise exception '197_GATE: realtime.messages 부재(Realtime 인가 테이블)';
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'realtime' and p.proname = 'topic') then
    raise exception '197_GATE: realtime.topic() 부재';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'realtime.messages'::regclass) then
    raise exception '197_GATE: realtime.messages RLS 비활성(플랫폼 전제 불일치)';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'realtime' and tablename = 'messages'
              and policyname in ('realtime_admin_topic_select', 'realtime_admin_topic_insert')) then
    raise exception '197_GATE: 정책이 이미 있다(이미 적용됐거나 전제 불일치)';
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'is_admin')
     or not has_function_privilege('authenticated', 'public.is_admin()', 'EXECUTE') then
    raise exception '197_GATE: public.is_admin() 부재 또는 authenticated EXECUTE 불가';
  end if;
  raise notice '197 pre: realtime.messages 기존 정책 % 개', (select count(*) from pg_policies where schemaname = 'realtime' and tablename = 'messages');
end $$;

-- ── B-1. 정책 — admin:* 토픽은 관리자만 ───────────────────────────────────────
create policy realtime_admin_topic_select on realtime.messages
  for select
  to authenticated
  using (
    realtime.topic() like 'admin:%'
    and coalesce((select public.is_admin()), false)
  );

create policy realtime_admin_topic_insert on realtime.messages
  for insert
  to authenticated
  with check (
    realtime.topic() like 'admin:%'
    and coalesce((select public.is_admin()), false)
  );

comment on policy realtime_admin_topic_select on realtime.messages is
  '197(DB-3 B): admin:* 토픽(private 채널)의 수신(Broadcast/Presence)은 관리자(is_admin())만. 그 외 토픽은 정책 없음(현 동작 유지).';
comment on policy realtime_admin_topic_insert on realtime.messages is
  '197(DB-3 B): admin:* 토픽(private 채널)의 송신·presence track 은 관리자(is_admin())만.';

-- ── 적용 직후 자가 검증 ───────────────────────────────────────────────────────
do $$
begin
  if (select count(*) from pg_policies where schemaname = 'realtime' and tablename = 'messages'
       and ((policyname = 'realtime_admin_topic_select' and cmd = 'SELECT' and roles = '{authenticated}'::name[]
             and qual like '%admin:%' and qual like '%is_admin()%')
         or (policyname = 'realtime_admin_topic_insert' and cmd = 'INSERT' and roles = '{authenticated}'::name[]
             and with_check like '%admin:%' and with_check like '%is_admin()%'))) <> 2 then
    raise exception '197_SELFCHECK: realtime.messages 정책 2종 불일치';
  end if;
end $$;

commit;
