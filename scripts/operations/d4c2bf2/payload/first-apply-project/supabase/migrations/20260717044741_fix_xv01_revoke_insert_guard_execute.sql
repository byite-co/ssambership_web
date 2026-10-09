-- XV-01 후속: INSERT 가드 트리거 함수의 직접 EXECUTE 권한 회수(기존 UPDATE 가드
-- enforce_users_role_guard 와 동일한 위생). 트리거는 definer 로 실행되므로 회수해도
-- 트리거 동작에는 영향 없음. anon/authenticated 의 직접 호출 표면만 제거.
revoke execute on function public.enforce_users_role_insert_guard() from public;
revoke execute on function public.enforce_users_role_insert_guard() from anon;
revoke execute on function public.enforce_users_role_insert_guard() from authenticated;