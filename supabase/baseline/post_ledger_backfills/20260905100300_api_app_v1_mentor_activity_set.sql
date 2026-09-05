-- =============================================================================
-- 201_api_app_v1_mentor_activity_set.sql  (2026-09-05 · DB-4 묶음 C — 멘토 활동 상태)
--
-- 왜: 멘토 활동 일시 중단/복귀/종료 예약은 웹이 service_role 로 4개 표(mentor_profiles · mentor_plans · subscriptions · mentor_activity_events)를
--   갱신한다(`lib/mentor/mentorActivityService.ts`). 앱은 어느 표도 쓸 수 없다(A-4a 판정표 #6). 규칙을 SQL 로 옮긴 래퍼 하나를 둔다.
--   DB 에는 활동 상태 코어 함수가 없어 이식이 불가피하다(웹 TS 가 정본 — 상수: 일시 중단 최대 7일 · 일반 휴식 6개월 1회(KST 달력) · 종료 공지 14일).
--
-- C-1 api_app_v1.mentor_activity_set(p_status text, p_pause_until timestamptz default null, p_termination_effective_at timestamptz default null,
--                                    p_reason text default 'rest') returns jsonb
--   · 공통 게이트: AUTH_REQUIRED → ROLE_NOT_MENTOR → ACCOUNT_BANNED / ACCOUNT_SUSPENDED / ACCOUNT_NOT_ACTIVE / ACCOUNT_DELETION_IN_PROGRESS →
--     ACTIVITY_STATUS_INVALID(active·paused·terminating 밖 — terminated 는 관리자/배치 전용) → MENTOR_PROFILE_NOT_FOUND
--   · 현재 상태 판정 = 웹 mentorActivityState: terminated / terminating / paused(pause_until 경과면 active) / active
--   · paused (웹 startMentorPause): 현재 active 만(ACTIVITY_STATE_INVALID · current_state) · p_pause_until 필수(PAUSE_UNTIL_REQUIRED) · 미래(PAUSE_UNTIL_INVALID) ·
--     일수 = ceil((pause_until − now)/1일) ≤ 7(PAUSE_TOO_LONG · max_days) · p_reason ∈ {rest, illness}(PAUSE_REASON_INVALID) ·
--     rest 는 last_pause_at 이 KST 달력 6개월 이전이어야 함(REST_FREQUENCY_LIMIT — 질병은 예외·관리자 확인 pending_review) ·
--     활성/past_due 구독의 current_period_end·next_billing_at 를 일수만큼 연장(과금 보호 · 웹 동일) · mentor_activity_events pause_started ·
--     학생 알림은 158 트리거(activity_status → paused)가 원자 fan-out
--     **paused 는 새 구독만 막는다(199 MENTOR_PAUSED)** — 질문방 RPC(qna_*)는 activity_status 를 보지 않으므로 기존 학생 질문은 계속 받는다(웹 동일 · 검증 픽스처).
--   · active (웹 resumeMentorActivity): 현재 raw activity_status = 'paused' 만 · pause_until NULL · mentor_plans.is_active 전부 true(웹 동일 — 202 토글과의 상호작용은 보고서) ·
--     이벤트 pause_resumed
--   · terminating (웹 startMentorTermination): terminating/terminated 가 아니면 · 효력일 = max(p_termination_effective_at, now+14일)(웹은 정확히 +14일 —
--     더 늦은 날짜만 허용 · now+90일 초과 TERMINATION_DATE_TOO_FAR) · mentor_plans.is_active 전부 false(신규 구독 즉시 차단) · 이벤트 termination_requested ·
--     학생 알림은 158 트리거. **효력일 이후 처리기**: 웹 `finalizeMentorTermination`(관리자 콘솔 액션 `lib/admin/mentorActivityAdminActions.ts` — 수동, cron 없음)이
--     잔여 100% 환불·구독 정리·terminated 전이를 한다. 이 래퍼는 상태만 바꾼다(지시서 §C — 확정·환불 생성 없음).
--   · 반환 {ok, contract_version:1, activity_status, …상태별 필드}
-- 권한: REVOKE public·anon · GRANT authenticated 만. 웹 액션은 그대로(service_role 경로).
-- 트리거 대조: trg_mp_notify_activity(158 · terminating/paused 전이 알림 ✓ 의도) · trg_mentor_profile_privileged_guard(verification_status·cap_limit 변경만 · 미발화) ·
--   trg_school_verification_reassess_on_academic_change(대학·학과 변경만 · 미발화) · trg_mplan_notify_price_*(amount_cents 변경만 · is_active 토글 미발화) ·
--   subscriptions: enforce_mentor_cap(status·plan_tier 만) · keep_subscription_refunded_status(status 만) — 기간 연장 UPDATE 에 미발화.
--
-- Apply: 저장소 표준 경로(db-apply-pending). pack 등재: supabase/baseline/post_ledger_backfills/20260905100300_api_app_v1_mentor_activity_set.sql
-- Rollback: supabase/rollback/20260905100300_api_app_v1_mentor_activity_set_rollback.sql
-- =============================================================================

begin;

-- ── 0. 사전 게이트 ─────────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_namespace where nspname = 'api_app_v1') then
    raise exception '201_GATE: api_app_v1 스키마 부재';
  end if;
  if (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'mentor_profiles'
       and column_name in ('user_id','activity_status','termination_requested_at','termination_effective_at','pause_started_at','pause_until','pause_reason','last_pause_at')) <> 8 then
    raise exception '201_GATE: mentor_profiles 활동 컬럼 8종 불일치(103)';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'mentor_plans' and column_name = 'is_active') then
    raise exception '201_GATE: mentor_plans.is_active 부재(103)';
  end if;
  if (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'mentor_activity_events'
       and column_name in ('mentor_id','event_type','reason','detail','status')) <> 5 then
    raise exception '201_GATE: mentor_activity_events 컬럼 불일치(103)';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'trg_mp_notify_activity' and tgrelid = 'public.mentor_profiles'::regclass) then
    raise exception '201_GATE: trg_mp_notify_activity 부재(158) — 학생 알림 fan-out 전제';
  end if;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'api_app_v1' and p.proname = 'mentor_activity_set') then
    raise exception '201_GATE: 대상 함수가 이미 있다';
  end if;
end $$;

-- ── C-1. mentor_activity_set ──────────────────────────────────────────────────
create function api_app_v1.mentor_activity_set(
  p_status text,
  p_pause_until timestamptz default null,
  p_termination_effective_at timestamptz default null,
  p_reason text default 'rest'
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $fn$
declare
  v_uid uuid := (select auth.uid());
  v_role text; v_status text; v_susp timestamptz; v_norm text;
  v_target text := lower(btrim(coalesce(p_status, '')));
  v_reason text := lower(btrim(coalesce(p_reason, 'rest')));
  v_mp record;
  v_state text;
  v_days integer;
  v_threshold timestamptz;
  v_s record;
  v_new_end timestamptz; v_new_next timestamptz;
  v_extended integer := 0;
  v_plans integer := 0;
  v_notified integer := 0;
  v_eff timestamptz;
  v_event_status text;
  v_event_id uuid;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'AUTH_REQUIRED');
  end if;
  select u.role, u.status, u.suspended_until into v_role, v_status, v_susp from public.users u where u.id = v_uid;
  if not found or v_role is distinct from 'mentor' then
    return jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'ROLE_NOT_MENTOR');
  end if;
  v_norm := lower(btrim(coalesce(v_status, '')));
  if v_norm = 'banned' then
    return jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'ACCOUNT_BANNED');
  end if;
  if v_norm = 'suspended' and (v_susp is null or v_susp > now()) then
    return jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'ACCOUNT_SUSPENDED');
  end if;
  if v_norm not in ('active', 'suspended') then
    return jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'ACCOUNT_NOT_ACTIVE');
  end if;
  if public.account_deletion_write_blocked(v_uid) then
    return jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'ACCOUNT_DELETION_IN_PROGRESS');
  end if;
  if v_target not in ('active', 'paused', 'terminating') then
    return jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'ACTIVITY_STATUS_INVALID');
  end if;

  select mp.user_id, mp.activity_status, mp.pause_until, mp.last_pause_at, mp.termination_effective_at
    into v_mp from public.mentor_profiles mp where mp.user_id = v_uid for update;
  if not found then
    return jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'MENTOR_PROFILE_NOT_FOUND');
  end if;

  -- 웹 mentorActivityState
  v_state := lower(btrim(coalesce(v_mp.activity_status, 'active')));
  if v_state = 'paused' and v_mp.pause_until is not null and v_mp.pause_until <= now() then
    v_state := 'active';
  elsif v_state not in ('terminated', 'terminating', 'paused') then
    v_state := 'active';
  end if;

  if v_target = 'paused' then
    if v_state <> 'active' then
      return jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'ACTIVITY_STATE_INVALID', 'current_state', v_state);
    end if;
    if p_pause_until is null then
      return jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'PAUSE_UNTIL_REQUIRED');
    end if;
    if p_pause_until <= now() then
      return jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'PAUSE_UNTIL_INVALID');
    end if;
    v_days := greatest(1, ceil(extract(epoch from (p_pause_until - now())) / 86400.0)::int);
    if v_days > 7 then
      return jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'PAUSE_TOO_LONG', 'max_days', 7);
    end if;
    if v_reason not in ('rest', 'illness') then
      return jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'PAUSE_REASON_INVALID');
    end if;
    if v_reason = 'rest' and v_mp.last_pause_at is not null then
      -- 웹 canRequestNormalRest: last <= addMonthsClampedKst(now, -6) 이어야 허용(KST 달력 · 말일 clamp = PG 월 산술과 동일)
      v_threshold := (((now() at time zone 'Asia/Seoul') - interval '6 months') at time zone 'Asia/Seoul');
      if v_mp.last_pause_at > v_threshold then
        return jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'REST_FREQUENCY_LIMIT',
                                  'last_pause_at', v_mp.last_pause_at,
                                  'next_available_at', (((v_mp.last_pause_at at time zone 'Asia/Seoul') + interval '6 months') at time zone 'Asia/Seoul'));
      end if;
    end if;

    update public.mentor_profiles mp
       set activity_status = 'paused', pause_started_at = now(), pause_until = p_pause_until, pause_reason = v_reason,
           last_pause_at = case when v_reason = 'rest' then now() else mp.last_pause_at end
     where mp.user_id = v_uid;

    -- 쉰 일수만큼 구독 기간 연장(과금 보호) — 웹 startMentorPause 동일
    for v_s in select s.id, s.current_period_end, s.next_billing_at from public.subscriptions s
                where s.mentor_id = v_uid and s.status in ('active', 'past_due') loop
      v_new_end := coalesce(v_s.current_period_end, now()) + (v_days * interval '1 day');
      v_new_next := case when v_s.next_billing_at is not null then v_s.next_billing_at + (v_days * interval '1 day') else v_new_end end;
      update public.subscriptions s set current_period_end = v_new_end, next_billing_at = v_new_next, updated_at = now() where s.id = v_s.id;
      v_extended := v_extended + 1;
    end loop;

    v_event_status := case when v_reason = 'illness' then 'pending_review' else 'logged' end;
    insert into public.mentor_activity_events (mentor_id, event_type, reason, detail, status)
    values (v_uid, 'pause_started', v_reason,
            jsonb_build_object('pause_until', p_pause_until, 'days', v_days, 'subscriptions_extended', v_extended, 'source', 'api_app_v1'),
            v_event_status)
    returning id into v_event_id;

    return jsonb_build_object('ok', true, 'contract_version', 1, 'activity_status', 'paused',
                              'pause_until', p_pause_until, 'pause_days', v_days, 'pause_reason', v_reason,
                              'subscriptions_extended', v_extended, 'event_status', v_event_status, 'event_id', v_event_id);
  end if;

  if v_target = 'active' then
    if lower(btrim(coalesce(v_mp.activity_status, ''))) <> 'paused' then
      return jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'ACTIVITY_STATE_INVALID', 'current_state', v_state);
    end if;
    update public.mentor_profiles mp set activity_status = 'active', pause_until = null where mp.user_id = v_uid;
    update public.mentor_plans mp set is_active = true where mp.mentor_id = v_uid and mp.is_active is distinct from true;
    get diagnostics v_plans = row_count;
    insert into public.mentor_activity_events (mentor_id, event_type, reason, detail, status)
    values (v_uid, 'pause_resumed', null, jsonb_build_object('source', 'api_app_v1'), 'logged')
    returning id into v_event_id;
    return jsonb_build_object('ok', true, 'contract_version', 1, 'activity_status', 'active',
                              'plans_reactivated', v_plans, 'event_id', v_event_id);
  end if;

  -- terminating
  if v_state in ('terminating', 'terminated') then
    return jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'ACTIVITY_STATE_INVALID', 'current_state', v_state);
  end if;
  v_eff := greatest(coalesce(p_termination_effective_at, now() + interval '14 days'), now() + interval '14 days');
  if v_eff > now() + interval '90 days' then
    return jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'TERMINATION_DATE_TOO_FAR', 'max_days', 90);
  end if;
  update public.mentor_profiles mp
     set activity_status = 'terminating', termination_requested_at = now(), termination_effective_at = v_eff
   where mp.user_id = v_uid;
  update public.mentor_plans mp set is_active = false where mp.mentor_id = v_uid and mp.is_active is distinct from false;
  get diagnostics v_plans = row_count;
  select count(*) into v_notified from public.subscriptions s where s.mentor_id = v_uid and s.status in ('active', 'past_due');
  insert into public.mentor_activity_events (mentor_id, event_type, reason, detail, status)
  values (v_uid, 'termination_requested', null,
          jsonb_build_object('effective_at', v_eff, 'notified_subscribers', v_notified, 'source', 'api_app_v1'), 'logged')
  returning id into v_event_id;
  return jsonb_build_object('ok', true, 'contract_version', 1, 'activity_status', 'terminating',
                            'termination_effective_at', v_eff, 'notified_subscribers', v_notified,
                            'plans_deactivated', v_plans, 'event_id', v_event_id);
end
$fn$;

comment on function api_app_v1.mentor_activity_set(text, timestamptz, timestamptz, text) is
  '201(DB-4 C-1): 본인 멘토 활동 상태 — paused(≤7일 · rest 6개월 1회 · 구독 기간 연장 · 새 구독만 차단) / active(복귀 · 플랜 재활성) / terminating(효력일 ≥ +14일 · 플랜 비활성 · 확정·환불은 관리자 finalize). 웹 mentorActivityService 규칙 이식 · 알림은 158 트리거.';

revoke all on function api_app_v1.mentor_activity_set(text, timestamptz, timestamptz, text) from public, anon;
grant execute on function api_app_v1.mentor_activity_set(text, timestamptz, timestamptz, text) to authenticated;

-- ── 적용 직후 자가 검증 ───────────────────────────────────────────────────────
do $$
declare v_oid oid;
begin
  select p.oid into v_oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'api_app_v1' and p.proname = 'mentor_activity_set'
     and pg_get_function_identity_arguments(p.oid) = 'p_status text, p_pause_until timestamp with time zone, p_termination_effective_at timestamp with time zone, p_reason text'
     and p.prosecdef and coalesce(p.proconfig::text, '') like '%search_path=%';
  if v_oid is null then
    raise exception '201_SELFCHECK: mentor_activity_set identity/attributes 불일치';
  end if;
  if has_function_privilege('anon', v_oid, 'EXECUTE') or not has_function_privilege('authenticated', v_oid, 'EXECUTE')
     or has_function_privilege('service_role', v_oid, 'EXECUTE') then
    raise exception '201_SELFCHECK: ACL 불일치(authenticated 만)';
  end if;
  if (select prosrc from pg_proc where oid = v_oid) not like '%interval ''6 months''%'
     or (select prosrc from pg_proc where oid = v_oid) not like '%interval ''14 days''%' then
    raise exception '201_SELFCHECK: 웹 상수(6개월·14일) 이식 불일치';
  end if;
end $$;

commit;
