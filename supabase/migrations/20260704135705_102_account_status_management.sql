-- 102_account_status_management.sql
-- P0 #4 — 계정 상태 관리(active / suspended / banned)
-- (레포 원문 그대로 — 2026-07-04 라이브 드리프트 보완 적용: 어드민 정지/차단 및 115 선행)

alter table public.users
  add column if not exists suspended_until timestamptz,
  add column if not exists status_reason text,
  add column if not exists status_changed_at timestamptz,
  add column if not exists status_changed_by uuid references public.users (id) on delete set null;

comment on column public.users.suspended_until is '정지 만료 시각(suspended 전용). null=영구/미설정. 이 시각 이후 앱 가드가 active로 간주';
comment on column public.users.status_reason is '정지/차단 사유(관리자 기록)';
comment on column public.users.status_changed_at is '상태 마지막 변경 시각';
comment on column public.users.status_changed_by is '상태를 변경한 관리자 user id';

create index if not exists users_status_blocked_idx
  on public.users (status, suspended_until)
  where status <> 'active';