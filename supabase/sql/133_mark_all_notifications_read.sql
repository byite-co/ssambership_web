-- --------------------------------------------------------------------------
-- 133_mark_all_notifications_read.sql   (P2-15 · 본인 전체 미읽음 알림 읽음 처리 RPC)
-- [적용됨 — ssambership-staging 에 2026-07-19 단일 트랜잭션(lock_timeout 3s) 적용·검증 통과
--   (T1 secdef/search_path · T2 authenticated/service_role 실행·anon 불가 · S1 본인 3건 읽음 · S2 재호출 0 멱등 · S3 타 사용자 보존).
--   fixture savepoint 롤백·baseline 0행 복원. 원장 미기재 — 적용 이력: docs/audit/sql_apply_manifest.md]
-- 목적: 클라이언트가 "로드한 ID"만 읽음 처리하던 문제를 없애고, 서버에서 본인 전체 미읽음 알림을
--   원자적으로 읽음 처리하는 RPC 를 제공한다. 소유권은 auth.uid() 로 서버 판정하고, 멱등(재호출 0건)·
--   row count 반환. SECURITY DEFINER 지만 WHERE 로 본인 행만 갱신하므로 authenticated 실행 허용.
-- 선행: 132(notifications.recipient_user_id). notifications 6개 레거시 수신자 컬럼 + recipient_user_id 를 모두 소유 판정.
-- 보존: is_read(정본)·read_at 만 갱신. 다른 컬럼·정책·타 사용자 행 불변.
-- --------------------------------------------------------------------------

create or replace function public.mark_all_notifications_read()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := (select auth.uid());
  v_count int;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;

  update public.notifications
  set is_read = true,
      read_at = coalesce(read_at, now()),
      updated_at = now()
  where is_read is distinct from true
    and (
      user_id = v_uid or recipient_id = v_uid or student_id = v_uid
      or mentor_id = v_uid or target_user_id = v_uid or owner_id = v_uid
      or recipient_user_id = v_uid
    );
  get diagnostics v_count = row_count;
  return coalesce(v_count, 0);
end;
$$;

comment on function public.mark_all_notifications_read() is
  'P2-15: 호출자(auth.uid()) 본인의 전체 미읽음 알림을 읽음 처리하고 갱신 행수를 반환한다(멱등). 로드한 ID 에 의존하지 않는다.';

revoke all on function public.mark_all_notifications_read() from public, anon;
grant execute on function public.mark_all_notifications_read() to authenticated, service_role;
