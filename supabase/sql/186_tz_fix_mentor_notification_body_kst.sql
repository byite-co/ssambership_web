-- =============================================================================
-- 186_tz_fix_mentor_notification_body_kst.sql  (TZ-FIX R2 — 감사 보고서 버그표 #14)
--
-- Purpose: 멘토 활동종료·휴식 알림 '본문' 날짜를 UTC 박제(at time zone 'UTC')에서
--   157 정본 notification_date_label(KST, 'YYYY년 M월 D일')로 교정.
--   KST 새벽 신청 건은 학생 push·알림함 본문이 하루 이른 날짜로 나가던 결함.
--
-- Base: 라이브(lbeqxarxothkmzqvpudy) pg_get_functiondef 원문 2026-08-29 추출.
--   mp_notify_activity_transition  def md5 11b614c5a2acd21558f2e0684f7a9101 (2,215 bytes)
--   (라이브 본문은 supabase/sql/158_p1_11_mentor_notification_atomization.sql 의
--    동일 함수 본문과 바이트 단위 일치 확인 — 158 파일 자체는 무수정 역사 파일.)
--
-- Fix (본문 날짜만 — 멱등 키 포맷 보존, §0-3):
--   1) v_body_date 변수 신설, 각 분기에서
--      public.notification_date_label(coalesce(NEW.termination_effective_at|pause_until, now()))
--   2) 알림 본문 문자열의 v_date_key 2곳 → v_body_date
--   변경 없음: v_date_key 산출식(UTC 'YYYY-MM-DD') · v_key 멱등 키 조립식 2곳 ·
--   함수 시그니처(trigger) · SECURITY DEFINER · search_path · 그 외 전 라인.
--
-- Apply: 저장소 표준 경로(db-apply-pending) — MCP apply_migration 직접 적용 금지.
--   pack 등재: supabase/baseline/post_ledger_backfills/20260829100200_... (v1.1 보정).
--
-- Rollback: 위 Base md5 의 라이브 원문(create or replace) 재적용으로 원복.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.mp_notify_activity_transition()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_sub record;
  v_key text;
  v_date_key text;
  v_body_date text;
begin
  if NEW.activity_status = 'terminating' then
    v_date_key := to_char(coalesce(NEW.termination_effective_at, now()) at time zone 'UTC', 'YYYY-MM-DD');
    v_body_date := public.notification_date_label(coalesce(NEW.termination_effective_at, now()));
    for v_sub in
      select s.id, s.student_id from public.subscriptions s
      where s.mentor_id = NEW.user_id and s.status in ('active', 'past_due')
    loop
      v_key := 'mentor_termination_notice:' || v_sub.id::text || ':' || v_date_key;
      perform public.record_domain_notification(
        v_sub.student_id, v_key, v_key, 'mentor_termination_notice',
        '멘토 활동 종료 예정',
        '구독 중인 멘토가 활동을 종료합니다. 2주 후(' || v_body_date
          || ') 구독이 정리되며 남은 기간은 환불됩니다. 그때까지는 정상 이용할 수 있어요.',
        '/subscriptions',
        jsonb_build_object('mentor_id', NEW.user_id, 'effective_at', NEW.termination_effective_at,
          'subscription_id', v_sub.id),
        jsonb_build_object('mentor_id', NEW.user_id, 'subscription_id', v_sub.id));
    end loop;
  elsif NEW.activity_status = 'paused' then
    v_date_key := to_char(coalesce(NEW.pause_until, now()) at time zone 'UTC', 'YYYY-MM-DD');
    v_body_date := public.notification_date_label(coalesce(NEW.pause_until, now()));
    for v_sub in
      select s.id, s.student_id from public.subscriptions s
      where s.mentor_id = NEW.user_id and s.status in ('active', 'past_due')
    loop
      v_key := 'mentor_pause_notice:' || v_sub.id::text || ':' || v_date_key;
      perform public.record_domain_notification(
        v_sub.student_id, v_key, v_key, 'mentor_pause_notice',
        '멘토 일시 휴식 안내',
        '구독 중인 멘토가 ' || v_body_date || '까지 일시 휴식합니다. 쉰 기간만큼 구독 기간이 자동 연장됩니다.',
        '/subscriptions',
        jsonb_build_object('mentor_id', NEW.user_id, 'pause_until', NEW.pause_until,
          'subscription_id', v_sub.id),
        jsonb_build_object('mentor_id', NEW.user_id, 'subscription_id', v_sub.id));
    end loop;
  end if;
  return NEW;
end $function$;
