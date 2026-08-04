-- interleave_20260802000000_public_defacl_hardening.sql
-- 부모 pg_default_acl 실측(role postgres, schema public)으로의 전환을 원장 시점에 재현.
-- 근거: build13(20260802054930) 이후 생성 객체들이 hardened 기본 ACL 흔적을 보인다
--   (notification_transport_config·shortform_view_events 에 anon/auth/service_role CRUD 부재,
--    이후 public 함수들이 proacl 비-NULL·owner-only) — 반면 그 이전 생성 객체는 permissive.
-- 전환 주체·정확 시각은 저장소·원장 어디에도 없음(out-of-band; UNRECOVERABLE_EXACT_TIME).
-- 목표 상태(부모 현재): tables anon/auth/service_role = D,x,t(,m) · functions postgres-only ·
--   sequences anon/auth/service_role = w(update) 만.
alter default privileges in schema public
  revoke select, insert, update, delete on tables from anon, authenticated, service_role;
alter default privileges in schema public
  revoke execute on functions from public;
alter default privileges in schema public
  revoke select, usage on sequences from anon, authenticated, service_role;
