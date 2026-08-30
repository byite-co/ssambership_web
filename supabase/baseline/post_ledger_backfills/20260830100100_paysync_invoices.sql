-- [Phase 2 2026-08-30] 페이싱크 무통장입금 주문 원장 `paysync_invoices`.
--
-- 용도: 우리가 선발급한 페이싱크 주문(`ivc_...`)의 로컬 정본. 웹훅·보정 크론이
--   "이 주문이 우리 것인가 · 누구 것인가 · 얼마인가"를 이 테이블로 대조한 뒤에만
--   적립한다. 페이로드의 metadata 만 믿고 적립하지 않는다(대시보드 수기 발행 주문의
--   metadata 로 임의 계정에 캐시를 넣는 경로 차단).
--
-- ledger_order_ref 가 있는 이유 (F11 계약과의 정합):
--   F11 `api_web_v1.record_cash_topup_v2` 는 `p_order_ref` 에 Toss 주문 형식
--   `^cash-(.+)-(\d+)$` 를 **강제**하고, 캡처한 uuid 가 `p_user_id` 와 일치해야 한다
--   (계약 §7 F11 2·3항). 따라서 `ivc_...` 를 그대로 멱등키로 넘길 수 없다 —
--   항상 `ORDER_REF_INVALID` 로 거부된다. 새 원장 RPC 신설은 금지(킥오프 §1)이므로,
--   주문 발급 시점에 F11 이 받아들이는 형식의 참조를 만들어 이 컬럼에 고정 저장하고
--   그 값을 멱등키로 쓴다. 주문당 1개로 고정되므로 웹훅이 몇 번 재전송돼도 멱등하다.
--
--   `paysync_invoices_ledger_ref_shape` CHECK 가 ref 형식을 행의 user_id 와 묶어
--   구조적으로 강제한다 — F11 의 ORDER_REF_INVALID·ORDER_REF_OWNER_MISMATCH 가
--   이 테이블을 거친 적립 경로에서는 발생할 수 없다.
--
--   `ivc_...` ↔ 원장 멱등키의 대응은 이 테이블이 유일한 정본이다
--   (cash_ledger.idempotency_key 만 보면 Toss 주문과 형식이 같아 구분되지 않는다).
--
-- 토스 채널과의 충돌 불가 논증 (중요 — 이 분리가 깨지면 적립이 조용히 삼켜진다):
--   두 채널의 ref 는 같은 `cash_ledger.idempotency_key` 네임스페이스를 공유한다.
--   같은 값이 두 번 오면 F11 은 ON CONFLICT DO NOTHING 후 6필드 대조를 거쳐
--   `duplicate: true` 로 **성공 응답**한다 — 뒤에 온 결제는 적립 없이 성공으로
--   보고되고 돈만 사라진다. 따라서 충돌은 '드물어야' 하는 게 아니라 '불가능'해야 한다.
--
--   분리자: 숫자부의 **선행 0**.
--     토스    `cash-{uuid}-{Date.now()}`   — components/cash/CashChargeWidget.tsx
--     페이싱크 `cash-{uuid}-0{Date.now()}`  — lib/paysync/paysyncLedgerRef.ts
--   `Date.now()` 는 양의 정수이고, 자바스크립트의 Number→string 변환은 선행 0 을
--   만들지 않는다. 즉 토스 숫자부는 **절대** '0' 으로 시작할 수 없고, 페이싱크 숫자부는
--   **항상** '0' 으로 시작한다. 두 집합은 문자열로서 교집합이 공집합이다 — 시각·난수·
--   자릿수 같은 확률적 근거가 아니라 표현 형식에서 나오는 구조적 분리다.
--
--   F11 은 숫자부(`v_m[2]`)를 캡처만 하고 쓰지 않으며 소유자 판정에 `v_m[1]`(uuid)만
--   쓴다. `parseUserIdFromCashOrderId` 도 동일하다 — 선행 0 은 양쪽 모두 무해하다.
--   아래 CHECK 가 선행 0 없는 ref 의 저장을 거부하고, 반대편(토스 생성기가 선행 0 을
--   만들지 않음)은 lib/paysync/__contract__/paysyncLedgerRef.contract.test.ts 가 고정한다.
--   (테스트 충전 `walletTopupActions` 의 `cash_topup_...` 키는 접두사부터 달라 무관.)
--
-- 금액 단위: 이 테이블은 **원(KRW)** 으로 보관한다. cash_ledger 의 cents(원×100)
--   환산은 기존 krwWonToCents 경로가 담당한다 — 여기서 미리 곱하지 않는다.
--
-- 접근 경계: 본인 row SELECT 만 열고 쓰기는 service_role 전용
--   (cash_ledger/cash_wallets 의 cled_select·cwal_select 선례와 동일 형태).
--
-- adg 가드: 탈퇴 진행(locked 이상) 유저 앞 **신규 주문 발급**만 차단한다(billing_keys 선례).
--   INSERT 에만 부착하고 UPDATE 에는 부착하지 않는다 — 이미 발급된 주문에 입금이
--   도착했는데 탈퇴 진행 중이라는 이유로 paid 전이가 막히면 돈만 들어오고 상태가
--   갱신되지 않아 대사가 불가능해진다.
--
-- 롤백 노트 (실행 금지 — 참고용):
--   -- drop trigger if exists adg_paysync_invoices on public.paysync_invoices;
--   -- drop policy if exists paysync_invoices_select_own on public.paysync_invoices;
--   -- drop table if exists public.paysync_invoices;

create table if not exists public.paysync_invoices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id),
  -- 페이싱크 주문 ID(`ivc_...`) — 웹훅 멱등 판정의 도메인 키.
  paysync_invoice_id text not null unique,
  -- F11 에 넘길 원장 멱등키. 발급 시점에 확정하고 이후 불변.
  ledger_order_ref text not null unique,
  pay_krw integer not null check (pay_krw > 0),
  cash_krw integer not null check (cash_krw > 0),
  bonus_krw integer not null default 0 check (bonus_krw >= 0),
  -- 입금자명 — 페이싱크 자동 매칭 키(입금자명 + 금액 정확 일치).
  -- 1~5자·공백 불가(킥오프 §5). 공백이 섞이면 매칭이 어긋나므로 형식으로 막는다.
  depositor_name text not null check (depositor_name ~ '^[^[:space:]]{1,5}$'),
  status text not null default 'pending'
    check (status in ('pending', 'paid', 'expired', 'canceled')),
  issued_at timestamptz not null default now(),
  expires_at timestamptz,
  paid_at timestamptz,
  -- 문서상 AUTOMATIC_MATCHING / MANUAL_MATCHING / MANUAL_APPROVE / API_CALL.
  -- 로직 분기 없이 감사용이라 CHECK 로 잠그지 않는다(값이 늘어도 수신이 깨지지 않게).
  paid_trigger text,
  created_at timestamptz not null default now(),
  -- F11 형식 + 소유자 일치 + **토스 채널과의 네임스페이스 분리**를 행 안에서 강제한다.
  -- 숫자부 선행 `0` 이 분리자다 — 아래 헤더 주석의 충돌 불가 논증 참조.
  constraint paysync_invoices_ledger_ref_shape
    check (ledger_order_ref ~ ('^cash-' || user_id::text || '-0[0-9]+$')),
  -- 지급 캐시 = 결제 금액 + 보너스 (CASH_CHARGE_PACKAGES 정본과 동치).
  constraint paysync_invoices_cash_krw_sum
    check (cash_krw = pay_krw + bonus_krw)
);

comment on table public.paysync_invoices is
  'Phase 2: 페이싱크 무통장입금 주문 로컬 정본. 웹훅·보정 크론이 소유자·금액을 이 표로 대조한 뒤 적립한다. ledger_order_ref 는 F11 record_cash_topup_v2 의 p_order_ref(= 원장 멱등키) — F11 이 Toss 형식만 받으므로 ivc_ 를 직접 쓸 수 없어 발급 시점에 고정한다. 금액은 원(KRW) 단위.';

comment on column public.paysync_invoices.ledger_order_ref is
  'F11 p_order_ref(원장 idempotency_key). `cash-{user_id}-{digits}` 고정 형식 — CHECK 로 소유자까지 강제. cash_ledger 만 보면 Toss 주문과 구분되지 않으므로 ivc_ 대응은 이 표가 정본이다.';

create index if not exists paysync_invoices_user_id_idx
  on public.paysync_invoices (user_id);

-- 보정 크론이 "pending 인데 N분 경과" 를 훑는 경로.
create index if not exists paysync_invoices_pending_issued_at_idx
  on public.paysync_invoices (issued_at)
  where status = 'pending';

alter table public.paysync_invoices enable row level security;
revoke all on public.paysync_invoices from public, anon, authenticated;
grant select on public.paysync_invoices to authenticated;
grant select, insert, update on public.paysync_invoices to service_role;

-- 본인 row SELECT 만 (cled_select·cwal_select 와 동일 형태 — auth.uid() 는 select 로 감싼다).
drop policy if exists paysync_invoices_select_own on public.paysync_invoices;
create policy paysync_invoices_select_own
  on public.paysync_invoices for select to authenticated
  using (user_id = (select auth.uid()));

-- 탈퇴 진행 유저 앞 신규 주문 발급 차단 — billing_keys 선례. UPDATE 는 막지 않는다.
drop trigger if exists adg_paysync_invoices on public.paysync_invoices;
create trigger adg_paysync_invoices before insert on public.paysync_invoices
  for each row execute function public.account_deletion_write_guard('user_id');
