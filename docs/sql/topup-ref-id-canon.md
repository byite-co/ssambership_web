# 캐시 충전(topup) 참조 정본 — `cash_ledger.ref_id` 판정 문서

> **오너 확정 3 = 옵션 (c) (정본 공인).** 이 문서로 26차 판정의 `SERVER_GATE` 를 **종결 처리**한다.
> 작성: 웨이브 2 · W3 세션 (2026-07-25) · 대상: staging `lbeqxarxothkmzqvpudy`
> **코드 변경 0 · 스키마 변경 0 · 데이터 백필 0** — 이 회차에서 실행한 것은 SELECT 조회뿐이다.

---

## 1. 확정 내용

topup(캐시 충전) 주문의 **정본 참조는 `cash_ledger.idempotency_key`** 이며, 그 값은 `orderId`
(`cash-{userId}-{ts}` 형식)다.

`cash_ledger.ref_id`(uuid)가 topup 행에서 **null 로 남아 있는 것은 결함이 아니라 정상**이다.
uuid 로 참조할 대상(내부 주문 테이블 등)이 **아직 존재하지 않기 때문**이며, 그런 테이블이
실제로 생기기 전까지 null 유지가 정본 상태다.

따라서 **신규 DDL 없이 정본 참조가 이미 성립**해 있다. 26차가 열어 둔 게이트는 "무엇을
만들어야 하는가"가 아니라 "무엇이 이미 정본인가"의 문제였고, 답은 `idempotency_key` 다.

---

## 2. 근거 (2026-07-25 staging 실측)

### 2-1. `record_cash_topup` 3인자 실배포 — ref_id 인자가 애초에 없다

```sql
select p.oid::regprocedure::text, pg_get_function_result(p.oid)
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname='public' and p.proname='record_cash_topup';
```

| signature | result |
|---|---|
| `record_cash_topup(uuid, bigint, text)` | `void` |

인자는 `(user_id, amount_cents, idempotency_key)` 3개뿐이다. **RPC 계약에 ref_id 를 넘길
자리가 없다.** 웹 측 포트도 동일하다 — `lib/toss/tossTopupCore.ts:253` 의
`recordTopupRpc: (userId, amountCents, idempotencyKey) => …` 이고, 호출은 `:289` 의
`ports.recordTopupRpc(userId, amountCents, orderId)` 로 **orderId 를 그대로** 멱등키에 싣는다.

### 2-2. 타입 불일치 — `ref_id` 는 uuid, `orderId` 는 text

| 컬럼 | 타입 | nullable |
|---|---|---|
| `cash_ledger.ref_id` | `uuid` | YES |
| `cash_ledger.idempotency_key` | `text` | YES |

`orderId` 는 `cash-{userId}-{ts}` 형식의 **text** 다(`lib/toss/tossTopupCore.ts:24` 의
`/^cash-(.+)-(\d+)$/`). uuid 컬럼에 넣을 수 없다 — 형식 자체가 uuid 가 아니다.
즉 "orderId 를 ref_id 에 넣자"는 방향은 타입 수준에서 성립하지 않는다.

### 2-3. `cash_ledger_idempotency_key_key UNIQUE (idempotency_key)` 실재 — **결정적 근거**

```sql
select c.conname, pg_get_constraintdef(c.oid)
  from pg_constraint c join pg_class t on t.oid=c.conrelid
  join pg_namespace n on n.oid=t.relnamespace
 where n.nspname='public' and t.relname='cash_ledger' and c.contype in ('c','u');
```

| conname | def |
|---|---|
| `cash_ledger_idempotency_key_key` | `UNIQUE (idempotency_key)` |

**유일성이 DB 제약으로 이미 보장**된다. 정본 참조가 갖춰야 할 성질(주문 1건 ↔ 원장 1행)이
신규 DDL 없이 충족되어 있다는 뜻이다. 같은 orderId 로 재호출해도 원장이 늘지 않는 근거가
바로 이 제약이며, 웹은 그 앞단에서 `hasTopupForOrderId` 조기 반환(`tossTopupCore.ts:283`)으로
한 번 더 막는다.

### 2-4. 실 데이터 분포 — topup 만 ref_id 가 비어 있고, 대신 멱등키가 100% 채워져 있다

```sql
select reason, count(*) as n,
       count(*) filter (where ref_id is null) as ref_id_null,
       count(*) filter (where idempotency_key is not null) as idem_present
  from public.cash_ledger group by reason order by reason;
```

| reason | 행 수 | ref_id null | idempotency_key 존재 |
|---|---|---|---|
| `cash_topup` | 2 | **2 (100%)** | **2 (100%)** |
| `individual_question_escrow_hold` | 2 | 0 | 2 |
| `individual_question_refund` | 1 | 0 | 1 |
| `subscription_payment` | 1 | 0 | 1 |

읽는 법: uuid 참조 대상이 **있는** 3종(IQ·구독)은 `ref_id` 가 전부 채워져 있고, 참조 대상이
**없는** topup 만 전부 null 이다. 이는 누락 패턴이 아니라 **구조적 구분**이다. 그리고 topup
행은 예외 없이 `idempotency_key` 를 갖는다 — 참조가 사라진 게 아니라 **다른 컬럼에 있다**.

### 2-5. 143 이 payments 의 topup kind 를 거부한다 — payments 를 경유한 uuid 참조도 막혀 있다

`supabase/sql/143_p1_13_state_machine_hardening.sql:31`

```sql
if lower(coalesce(v_kind,'')) in ('cash_topup','topup','cash','individual_question','iq',
                                  'custom_order','custom_request','deliverable') then
```

구독 상태머신이 **비구독 kind 를 명시적으로 거부**한다. 따라서 "payments 행을 만들어 그
uuid 를 ref_id 에 넣는다"는 우회도 현행 설계와 충돌한다. topup 은 payments 를 정본으로 삼는
흐름이 아니다.

---

## 3. 금지 사항

- **기존 `ref_id IS NULL` 행의 백필을 금지한다.** 넣을 uuid 가 존재하지 않으므로, 백필은
  임의의 값을 만들어 넣는 행위가 된다. `cash_ledger` 는 append-only 원장이며 과거 행의
  의미를 사후에 바꾸지 않는다.
- topup 경로에 `ref_id` 를 채우기 위한 신규 컬럼·테이블·제약을 이번 회차에 도입하지 않는다.
- `record_cash_topup` 의 3인자 시그니처를 바꾸지 않는다(웹 포트 계약과 동시 변경이 필요하다).

---

## 4. 향후 uuid 참조 도입 시 이행 절차 (W4 입력)

정본을 (c)로 확정했으므로 아래는 **지금 실행하는 계획이 아니라, 내부 주문 테이블이 생겼을 때
비로소 검토할 선택지**다.

### 옵션 (a) — 내부 topup 주문 테이블 신설 후 참조

1. `cash_topup_orders(id uuid pk, user_id, order_id text unique, amount_cents, status, …)` 신설
2. 충전 개시 시 주문 행 생성 → `record_cash_topup` 에 **4번째 인자로 주문 uuid** 추가
   (기존 3인자 오버로드를 남겨 앱·웹 배포 순서를 분리할 것)
3. 신규 행부터 `ref_type='cash_topup_orders'` · `ref_id=주문 uuid` 기록
4. **과거 행은 그대로 둔다** — `idempotency_key` 가 정본 참조로 계속 유효하다

### 옵션 (b) — `ref_id` 를 text 로 확장해 orderId 를 직접 수용

- 장점: 주문 테이블 없이 참조가 채워진다.
- 단점: `ref_id` 의 uuid 의미론이 깨지고, IQ·구독 3종의 기존 uuid 참조와 타입이 섞인다.
  현 시점에서는 **권장하지 않는다**(정합성 손실이 이득보다 크다).

두 옵션 모두 **선행 조건은 같다**: 위 §2-3 의 UNIQUE 제약을 유지한 채, 신규 참조 경로가
기존 멱등 계약(같은 orderId → 원장 1행)을 깨뜨리지 않음을 rollback-only 픽스처로 먼저 증명한다.

---

## 5. 종결 판정

| 항목 | 판정 |
|---|---|
| 26차 `SERVER_GATE` | **종결** — 정본은 `idempotency_key`, 신규 DDL 불요 |
| 이번 회차 스키마 변경 | 0 |
| 이번 회차 코드 변경 | 0 |
| 이번 회차 백필 | 0 (금지 명문화) |
| W4 이연 | 옵션 (a)·(b)는 내부 주문 테이블 도입 시점에 재검토 |
