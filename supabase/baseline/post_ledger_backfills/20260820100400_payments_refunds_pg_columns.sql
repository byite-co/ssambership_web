-- [S-B 2026-08-20] m4 — `payments` 포트원 8컬럼 + `refunds` PG 취소 2컬럼.
--
-- 전부 nullable·무DEFAULT (B5 확정치): 기존 부분-컬럼 INSERT 4지점
--   (lib/subscribe/subscribeCheckoutService.ts:324-344, e2e 3곳)이 즉시 실패하지 않는다.
--
-- external_id ↔ pg_tx_id 매핑 규칙 (별개 도메인 — 혼용 금지):
--   * `payments.external_id`(기존) = Toss/내부 참조 도메인. 실측 용례: 구독 intent
--     `sub_intent_<intentKey>`, Toss 충전 paymentKey 계열. 포트원 값을 넣지 않는다.
--   * `pg_tx_id`(신규) = 포트원 V2 트랜잭션 ID(paymentId/txId). 포트원 결제 행에서만
--     기록하며, Toss·캐시 행에서는 항상 NULL 이다.
--   * `pg_provider` = 'portone' 등 PG 식별 문자열. NULL = 기존 Toss/캐시 도메인 행.
--
-- #4 방어 규칙 (IMPACT 수정 제안 #4 — 클라이언트 인텐트 선입력 불신):
--   `payments_insert_intent` 정책(authenticated INSERT)은 행 술어만 검사하고 테이블 단위
--   INSERT GRANT 라 클라이언트가 인텐트 생성 시 pg_* 컬럼을 임의 선입력할 수 있다.
--   → **pg_* 는 서버 확정 경로가 포트원 단건조회(승인 결과) 값으로 전량 덮어쓴다.**
--   클라이언트 인텐트가 실은 pg_* 선입력 값은 신뢰·보존하지 않는다(S-D 확정 경로 계약).
--
-- billing_key_id FK: m3(20260820100300) 이 먼저 적용된다 — 같은 스프린트 내
--   테이블 생성(m3) → 컬럼 추가(m4) 순서 보장(IMPACT 수정 제안 #6).
--
-- refunds.pg_cancellation_id/pg_cancelled_at: 포트원 취소 연계(S-D~F 신규 표면)의
--   기록 컬럼. 현행 환불은 DB 캐시 환급 전용이라 이번 회차에는 기록 주체가 없다(스키마만).
--
-- 롤백 노트 (실행 금지 — 참고용):
--   -- alter table public.payments
--   --   drop column if exists pg_provider, drop column if exists pg_tx_id,
--   --   drop column if exists pg_method, drop column if exists pg_receipt_url,
--   --   drop column if exists pg_paid_at, drop column if exists pg_fail_code,
--   --   drop column if exists pg_fail_message, drop column if exists billing_key_id;
--   -- alter table public.refunds
--   --   drop column if exists pg_cancellation_id, drop column if exists pg_cancelled_at;

alter table public.payments
  add column if not exists pg_provider text,
  add column if not exists pg_tx_id text,
  add column if not exists pg_method text,
  add column if not exists pg_receipt_url text,
  add column if not exists pg_paid_at timestamptz,
  add column if not exists pg_fail_code text,
  add column if not exists pg_fail_message text,
  add column if not exists billing_key_id uuid references public.billing_keys (id);

comment on column public.payments.pg_provider is
  'S-B m4: PG 식별자(예 portone). NULL = 기존 Toss/캐시 도메인 행.';
comment on column public.payments.pg_tx_id is
  'S-B m4: 포트원 V2 트랜잭션 ID. external_id(Toss/내부 참조 도메인)와 별개 — 혼용 금지. 서버 확정 경로가 포트원 단건조회 값으로 전량 덮어쓴다(클라이언트 선입력 불신).';
comment on column public.payments.billing_key_id is
  'S-B m4: 이 결제를 일으킨 빌링키(billing_keys FK). 구독 정기결제 전용.';

alter table public.refunds
  add column if not exists pg_cancellation_id text,
  add column if not exists pg_cancelled_at timestamptz;

comment on column public.refunds.pg_cancellation_id is
  'S-B m4: 포트원 취소 트랜잭션 ID(S-D~F 취소 연계 신규 표면에서 기록). NULL = DB 캐시 환급 행.';
