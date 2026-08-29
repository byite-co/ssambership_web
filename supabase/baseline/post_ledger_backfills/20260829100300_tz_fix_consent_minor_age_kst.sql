-- =============================================================================
-- 187_tz_fix_consent_minor_age_kst.sql  (TZ-FIX R3 — 감사 보고서 버그표 #25)
--
-- Purpose: 동의원장 트리거의 만 14세 폴백 판정 기준일을 current_date(세션 TZ=UTC 달력)
--   에서 KST 달력 '오늘'로 교정. 웹 경로가 is_minor 를 항상 채워 현재 도달 불가한
--   잠재 결함이나, 폴백 경로가 살아나는 순간 KST 새벽 가입 건이 하루 어긋난다.
--
-- Base: 라이브(lbeqxarxothkmzqvpudy) pg_get_functiondef 원문 2026-08-29 추출.
--   handle_new_auth_user_consent_records  def md5 833a94c880ea8000d049d67eb83a1f46 (3,300 bytes)
--   (라이브는 저장소 087 원문(3,044 B)보다 최신 패치 상태 — 087 을 베이스로 쓰지 않았다.
--    본문은 base64 2분할 추출 후 재조립 md5 대조(86f4512b04f460f6e980e21ba5049cf8)로 무결 확인.)
--
-- Fix (판정 기준일 식 1곳만 — 그 외 라인 라이브 원문 바이트 그대로, CRLF 보존):
--   current_date < (v_birth_date + interval '14 years')::date
--     -> (now() at time zone 'Asia/Seoul')::date < (v_birth_date + interval '14 years')::date
--   변경 없음: 멱등 키('signup:…' 조립식) · consent 행 구성 · 함수 시그니처(trigger) ·
--   SECURITY DEFINER · search_path.
--
-- Apply: 저장소 표준 경로(db-apply-pending) — MCP apply_migration 직접 적용 금지.
--   pack 등재: supabase/baseline/post_ledger_backfills/20260829100300_... (v1.1 보정).
--
-- Rollback: 위 Base md5 의 라이브 원문(create or replace) 재적용으로 원복.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.handle_new_auth_user_consent_records()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  m jsonb;
  v_role text;
  v_birth_date date;
  v_is_minor boolean := false;
  v_version text;
  v_agreed_at timestamptz := now();
  v_metadata jsonb;
begin
  m := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_role := lower(coalesce(nullif(trim(m->>'app_role'), ''), 'student'));
  v_version := coalesce(nullif(trim(m->>'consent_version'), ''), 'legal-placeholder-2026-06-20');

  begin
    v_birth_date := nullif(trim(m->>'birth_date'), '')::date;
  exception when others then
    v_birth_date := null;
  end;

  v_is_minor := coalesce(
    nullif(trim(m->>'is_minor'), '')::boolean,
    case when v_birth_date is not null
         then ((now() at time zone 'Asia/Seoul')::date < (v_birth_date + interval '14 years')::date)
         else false end
  );

  v_metadata := jsonb_build_object(
    'role', v_role,
    'birth_date', case when v_birth_date is not null then v_birth_date::text else null end,
    'age_gate_checked_at', nullif(trim(m->>'age_gate_checked_at'), ''),
    'verification_method', coalesce(nullif(trim(m->>'guardian_verification_method'), ''), 'legal_review_pending')
  );

  if (m->>'terms_agreed') = 'true' then
    insert into public.user_consent_records (
      user_id, consent_type, consent_actor, is_minor, guardian_consent,
      consent_version, agreed_at, source, metadata, idempotency_key
    ) values (
      new.id, 'terms', 'user', v_is_minor, false,
      v_version, v_agreed_at, 'signup', v_metadata, 'signup:' || new.id::text || ':terms:' || v_version
    ) on conflict (idempotency_key) do nothing;
  end if;

  if (m->>'privacy_agreed') = 'true' then
    insert into public.user_consent_records (
      user_id, consent_type, consent_actor, is_minor, guardian_consent,
      consent_version, agreed_at, source, metadata, idempotency_key
    ) values (
      new.id, 'privacy', 'user', v_is_minor, false,
      v_version, v_agreed_at, 'signup', v_metadata, 'signup:' || new.id::text || ':privacy:' || v_version
    ) on conflict (idempotency_key) do nothing;
  end if;

  if (m->>'marketing_agreed') = 'true' then
    insert into public.user_consent_records (
      user_id, consent_type, consent_actor, is_minor, guardian_consent,
      consent_version, agreed_at, source, metadata, idempotency_key
    ) values (
      new.id, 'marketing', 'user', v_is_minor, false,
      v_version, v_agreed_at, 'signup', v_metadata, 'signup:' || new.id::text || ':marketing:' || v_version
    ) on conflict (idempotency_key) do nothing;
  end if;

  if v_is_minor and (m->>'guardian_consent') = 'true' then
    insert into public.user_consent_records (
      user_id, consent_type, consent_actor, is_minor, guardian_consent,
      consent_version, guardian_ref, agreed_at, source, metadata, idempotency_key
    ) values (
      new.id, 'minor_guardian_consent', 'guardian', true, true,
      v_version, nullif(trim(m->>'guardian_ref'), ''), v_agreed_at, 'signup', v_metadata,
      'signup:' || new.id::text || ':minor_guardian_consent:' || v_version
    ) on conflict (idempotency_key) do nothing;
  end if;

  return new;
end;
$function$;
