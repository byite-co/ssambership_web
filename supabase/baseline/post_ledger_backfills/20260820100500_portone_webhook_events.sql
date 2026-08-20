-- [S-B 2026-08-20] m5 — 포트원 웹훅 수신 원장 `portone_webhook_events`.
--
-- 용도: 포트원 V2 웹훅(Standard Webhooks) 수신 기록 + 멱등 처리 기반.
--   webhook_id UNIQUE 가 재전송 중복 처리를 구조적으로 차단한다(수신 라우트는 S-D 구현).
--   processed_at/process_result 로 수신(항상 성공해야 함)과 처리(재시도 가능)를 분리한다.
--
-- adg 비부착 (의도적): 감사 로그 성격 — 수신 자체는 항상 성공해야 한다.
--   탈퇴 진행 중 유저의 결제 이벤트도 **수신 기록은 남아야** 원인 추적이 가능하다.
--   실제 자금 반영 단계(payments 등)는 기존 adg_payments 가드가 이미 막는다
--   (ACCOUNT_DELETION_IN_PROGRESS — 웹훅 처리기가 이 예외를 다뤄야 한다, IMPACT W5-(f)).
--   user FK 도 두지 않는다(수신 시점에 유저 귀속이 불확정일 수 있음 — payload 로 추적).
--
-- 접근 경계: service_role 전용(RLS on·정책 0·anon/authenticated GRANT 0 — 151 선례).
--
-- 롤백 노트 (실행 금지 — 참고용):
--   -- drop table if exists public.portone_webhook_events;

create table if not exists public.portone_webhook_events (
  id uuid primary key default gen_random_uuid(),
  webhook_id text not null unique,
  event_type text,
  portone_payment_id text,
  payload jsonb not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  process_result text
);

comment on table public.portone_webhook_events is
  'S-B m5: 포트원 V2 웹훅 수신 원장(감사 로그 성격 — adg 비부착, 수신은 항상 성공). webhook_id UNIQUE 로 재전송 멱등. service_role 전용.';

alter table public.portone_webhook_events enable row level security;
revoke all on public.portone_webhook_events from public, anon, authenticated;
grant select, insert, update on public.portone_webhook_events to service_role;
