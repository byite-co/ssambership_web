-- ⚠️ 라이브 미적용 — 오너 "적용 승인"(PUSH 지시문 O-7) 후 CLAUDE.md 절차로 적용 (114 패턴).
--   적용 후: npm run contracts:export 로 스냅샷 재수출 + contracts:verify green +
--   인벤토리(grants) 갱신 — S-B/S-C-APPLY 선례 형식으로 docs/sprint-push/PUSH-APPLY.md 증적.
--
-- App-F1(푸시 재도입): 앱(authenticated)이 자기 FCM 토큰을 등록할 수 있게 EXECUTE 부여.
-- register_device_token 은 SECURITY DEFINER + auth.uid() 강제 + on conflict(token) 소유권 이전 내장(재검토 2026-08-25).
-- revoke_device_token 은 소유권 검사가 없고 notification_delivery_mark_failed 가 내부 호출하므로 authenticated 에 열지 않는다(앱은 RLS 본인 행 UPDATE 로 철회).
grant execute on function public.register_device_token(text, text) to authenticated;
