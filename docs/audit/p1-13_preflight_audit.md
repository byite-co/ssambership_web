# P1-13 구독·환불·정산 상태기계 — 착수 전 실데이터 감사 (오너 지시)

> 상태: **preflight 감사 완료 · 구현 미착수(환경 blocker)**. 조각별 PASS 금지 — B-1~B-12 전체를 하나의 release 로만 착수.

## 1. 실데이터 감사 (2026-07-19 staging, read-only)

| 테이블 | 행수 | 이상 |
|---|---|---|
| payments | 0 | 없음 |
| subscriptions | 0 | 없음 |
| refunds | 0 | 없음 |
| subscription_settlement_items | 0 | 없음 |
| custom_order_settlement_items | 0 | 없음 |
| cash_ledger | 0 | 없음 |
| cash_wallets | 0 | 음수 잔액 0 |

- 존재: `subscription_billing_events`·`payout_runs`·`payout_run_items`.
- 부재(P1-13 이 생성 예정): `billing_events`(정본 event 는 `subscription_billing_events` 사용 검토)·`payment_anomalies`.
- **데이터 이상·중복·불일치 없음 → 데이터發 HARD STOP 아님.** 대사 불필요(0행).

## 2. 착수 blocker (환경·선행)

§10 P1-13 선행 중 미충족:
1. **P1-8A 질문 소비 RPC 미적용**(2세션/런타임 환경 부재로 apply 보류 — `p1-8a_question_room_rpc_plan.md`). B-4/B-11(pending refund → 질문 생성/append/attachment 차단)이 P1-8A 세 소비 RPC 와 같은 subscription lock 을 공유해야 하므로 P1-8A 선적용 필요.
2. **B-12 14개 동시성 시나리오**는 **실제 독립 2세션/worker 환경** 검증 필수(§B-12). 현 단일 세션 도구로 PASS 위조 금지(§10).
3. **기능 일시중지·대사 계획 승인**(§10 선행) — 배포/일시정지 계획 오너 승인.

## 3. 착수 조건(충족 시 재개)

1. P1-8A 적용·검증(2세션+런타임 환경).
2. 독립 2세션/worker 동시성 환경(B-12 14 시나리오).
3. 운영(실사용) payment/subscription/refund/billing/settlement/ledger 덤프 대조(운영 적용 시).
4. 128(P1-9) 본문 기반 승인 함수 전체 재정의(구독 paid 가드·맞춤 에스크로 분기·billing-event/settlement 잠금 보존).
5. `131_subscription_create_rpc.sql`(예약) + 웹 checkout RPC 전환.

## 4. 미검증/보류
- B-1~B-12 전체 = **HARD-STOP-class 보류**(동시성 검증 환경 부재 + 선행 P1-8A 미적용). PASS 위조 금지.
- payout(P2-25 지급 스택)은 P1-13 이후.
