# S2-2 웹 전환 W3 — C7·C8 자금 호출부 로컬 전환·검증 감사 (2026-07-30)

> 로컬 판정 전용(PASS_LOCAL 체계). 원격(운영·staging·branch) DB·운영 Data API에는 어떤 것도
> 적용·변경하지 않았고, 실제 Toss 외부 결제 호출은 0회다. 이 문서는 W3 지시의 종료 보고 증거 원본이다.

## 1. 하드게이트 실측

| 항목 | 값 |
|------|-----|
| base branch | `claude/s2-2-transition-w2-c5-c6-c11-20260730` |
| base commit | `20b67e9f81183d8286a8baacbd907b515677bbe1` (W2 — `609dafbd…`의 정확한 단일 후속, 변경 18파일) |
| 원격 W2 tip | 동일 commit (fetch 실측) |
| 작업 브랜치 | `claude/s2-2-transition-w3-c7-c8-20260730` (부모 `20b67e9f…`) |

정본 해시 불변(커밋 직전 sha256 실측 — W2 전후 동일):

| 파일 | SHA-256 |
|------|---------|
| `docs/contracts/api_web_v1_contract_v1_1.md` (2,994행/329,690B) | `bd9fc0dd2802c8358bb09f2938e0de7248d8b60703794895708e300f8ef32fa6` |
| `supabase/sql/20260730120103_money_rpc.sql` | `3821e05f3a0c8787af180c34bbdafbcfb866a61cc3b25cbf6534783522e115d5` |
| `supabase/rollback/20260730120103_money_rpc_rollback.sql` | `c89af2f1d94dc367946ba6e3d7fc1849d6979cc53f33c4fa9d634d728015de0f` |
| `docs/audit/s2_2_migration_physical_policy_20260730.md` | `54babe01ef87d5996f95ad5934538a8876c11bdfa0ccd5ba6c4463b910378848` |
| `docs/audit/apply_manifest_prod.md` | `48647693c0109f639405a0bcfd8942c51881fd76faf332c4c154a6a9a307dc23` |
| `docs/audit/sql_apply_manifest.md` | `625c38717f01ecd12c847d850fefd2bc6668f0268c77cbd5eb9facc79422b65a` |

금지 경로(`supabase/sql/**`, `supabase/rollback/**`, `docs/contracts/**`, manifest·물리 정책,
Batch A~E 산출물, `supabase/config.toml`, secret/env) 변경 0건.

## 2. 수정 전후 자금 호출 그래프

### 수정 전

```text
[C7 운영 충전]
confirmCashTopupServer / webhook route
  → recordCashTopupFromTossOrder
    → hasCashTopupForOrderId (cash_ledger 사전 SELECT — duplicate 추정)
    → admin.rpc public.record_cash_topup (레거시 3인자)
    → recoverPastDueAfterTopup

[테스트 충전(예외)]
walletTopupActions.testWalletCashTopupAction
  → admin.rpc public.record_cash_topup (키 cash_topup_{uid}_{ts}_{hex})

[C8 확정]
/api/subscribe/checkout (amountCents 선택 인자)
  → finalizeSubscriptionCashWalletCheckout
    → ensureMentorCatalogPlanRows → createSubscriptionPaymentIntent
        (firstPayTable PAY_TABLES 프로빙 + pickExistingColumn 7종 컬럼 프로빙 INSERT)
    → finalizeSubscriptionCheckout
        → assertAccountActive · assertMentorApprovedForAction · cap · subscribe-open
        → findActiveSubscriptionForPair (SUB_TABLES 3종 프로빙 — dup 선거부)
        → succeeded 재호출 분기: repairMissingSubscriptionCashLedgerIfNeeded
            (cash_ledger 사전 SELECT + record_subscription_cash_debit JS 보정)
        → fetchPlansForMentor 재조회 → resolveMentorPlanDebitAmount (현재 가격 기반 확정)
        → admin.rpc public.confirm_subscription_checkout (레거시 직접 호출)
        → ensureMentorStudentRoomWithServiceRetry
            → ensureMentorStudentRoom (service_role mentor_student_rooms 직접 INSERT
               + 컬럼 후보 프로빙 + 23505 재조회 수렴) — 실패 시 checkout "일부 성공"
```

### 수정 후

```text
[C7 운영 충전]
confirmCashTopupServer / webhook route
  → recordCashTopupFromTossOrder
    → recordCashTopupCore(순수) — 사전 SELECT 0
      → callApiWebV1Rpc(admin) F11 api_web_v1.record_cash_topup_v2(p_user_id, p_amount_cents,
        p_order_ref = Toss orderId 원문 = 멱등키) — duplicate 는 F11 반환이 정본
      → duplicate:false 일 때만 recoverPastDueAfterTopup 1회

[테스트 충전(예외 — 의도적 유지)]
walletTopupActions.testWalletCashTopupAction → public.record_cash_topup (변경 0)

[C8 확정]
/api/subscribe/checkout (amountCents = 학생 표시 금액, **필수**)
  → finalizeSubscriptionCashWalletCheckout(expectedAmountCents)
    → createSubscriptionPaymentIntent — 정본 payments 고정 컬럼 INSERT
        (amount = 동의 금액 KRW · metadata.expected_amount_cents 동의 사본 보존 · plan_id 기록)
    → finalizeSubscriptionCheckout(expectedAmountCents)
        → payments 정본 1행 읽기(세션 RLS) — 소유권·멘토 일치 확인만
        → callApiWebV1Rpc(admin) F12 api_web_v1.subscription_checkout_confirm_v2(
            p_payment_id, p_plan_id(payments.plan_id→metadata.planId 정본 ID),
            p_expected_amount_cents(동의 금액 — 재생은 metadata 보존 사본 우선),
            p_idempotency_key = 'sub_checkout_<paymentId>' 기존 안정 키)
        → 성공: room_id/subscription_id = 응답 정본 · 신규 확정만 billing event 기록
          · IQ 이전 best-effort. 실패: envelope 안정 코드 매핑(anomaly_id 로그 보존),
          전송 오류는 보상 없이 재시도 안내(전파).
```

제거된 것(§8 전건): 레거시 `confirm_subscription_checkout` 직접 호출 · `ensureMentorStudentRoom`
JS 방 생성(+service_role room 직접 INSERT·23505 수렴·컬럼 프로빙) · checkout 확정 경로의
SUB/PAY_TABLES 프로빙 · succeeded 재생의 JS 원장 보정 3종 · 현재 mentor_plans 가격 재조회 기반
확정 · F12 성공 후 별도 방 확보 · cash_ledger 사전 SELECT(duplicate 추정).

## 3. 학생 표시 금액 provenance (§6)

| 단계 | 파일·필드 | 단위 | 변조 방지 경계 |
|------|-----------|------|----------------|
| 1. 가격 표시 | `components/subscribe/SubscribeCheckoutClient.tsx` — 서버 렌더 props `plan.cashKrw` 표시 | KRW(캐시) | 서버 컴포넌트가 mentor_plans 정본에서 조회해 렌더 |
| 2. POST | 동일 파일 `amountCents = selected.cashKrw * 100` → body | cents | 클라이언트 값(변조 가능) — 단독 신뢰하지 않음(4·6단계가 교차 검증) |
| 3. route 수신 | `app/api/subscribe/checkout/route.ts` — `amountCents` **필수**(정수·양수·100의 배수), 현재 플랜가와 다르면 사전 안내(UX — 확정 인자로는 미사용) | cents | 서버 검증 |
| 4. intent 보존 | `createSubscriptionPaymentIntent` — `payments.amount = amountCents/100`, `payments.metadata.expected_amount_cents = amountCents` | KRW / cents | 서버 INSERT(계약 §17 C8 주의 이행: "intent 생성 시점 금액을 payments 행에 보존") |
| 5. (Toss 요청) | 캐시 지갑 확정이라 구독 경로에 외부 PG 왕복 없음 — `payments.amount`가 청구 정본 | KRW | — |
| 6. F12 인자 | `finalizeSubscriptionCheckout` — 최초: 요청의 동의 금액, 재생: `metadata.expected_amount_cents` 보존 사본 우선 | cents | DB 3자 일치(payments.amount×100 = p_expected = 잠근 mentor_plans.amount_cents)가 최종 정본 — 어느 하나의 변조도 `PLAN_AMOUNT_CHANGED` 거부(차감 0) |

금지 확인: 확정 직전 mentor_plans 재조회값·재계산·payments.amount×100 재사용·재시도 시 현재
가격 교체 전부 0(소스 계약 테스트 `subscribeCheckoutWiring.contract.test.ts` tripwire).
단위 불일치 없음(cents 고정, `%100===0` 검증 — C8_AMOUNT_UNIT_MISMATCH 해당 없음).

## 4. 운영 충전·테스트 충전 분리 증거 (§4.3)

- `lib/toss/cashTopupFromPayment.ts`: F11 전환, `p_order_ref` = `^cash-(.+)-([0-9]+)$` 원문만.
- `lib/cash/walletTopupActions.ts`: **변경 0바이트** — 레거시 `public.record_cash_topup` + 키
  `cash_topup_{uid}_{ts}_{hex}` 유지, production 강제 비활성(NODE_ENV=production 에서
  `CASH_TOPUP_ALLOW_TEST_CHARGE=true` 면 throw, 아니면 비활성 안내) 유지.
- 통합검증 실측: F11 에 테스트 키 형식 입력 → `ORDER_REF_INVALID`(C7-5 — allowlist 미확장),
  레거시 테스트 충전 회귀 정상(C7-7), production 게이트 소스 확인(C7-8).
- 계약 테스트 tripwire: 테스트 충전이 F11 로 바뀌거나 레거시 호출이 사라지면 실패.

## 5. 로컬 통합검증 (격리 전체 스택)

스택: PG 17.6 · clean-install 187 · gotrue·kong·PostgREST(`api_web_v1` 노출)·storage —
운영·staging 데이터 반입 0, 외부 Toss 호출 0. fixture: gotrue 실계정 6명(승인 멘토 1·학생 5),
승인 트리거가 시드한 mentor_plans(표준 8,490,000 cents). 로컬 한정 grant(라이브 platform 기본
grant 재현 — authenticated: payments INSERT/SELECT(RLS `payments_insert_intent` 실경로),
service_role: 하네스 검증 대상 8테이블)를 시험 구간에만 부여하고 종료 시 회수(레포 migration 에
revoke 없음 — W1·W2 선례와 동일한 로컬 baseline 환경 차이). 호출은 웹이 실제 보내는 형태
(service_role + `api_web_v1` 스키마 + 동일 인자·동일 멱등키)를 재현했다.

결과 **전건 PASS** — node 20/20 + psql 시나리오 2조 + 누출·잔여 0:

| # | 시나리오 | 결과 |
|---|----------|------|
| C7-1 | 운영 형식 orderId 신규 충전(duplicate:false·지갑 +3,000,000) | PASS |
| C7-2 | 동일 orderId 재호출 → duplicate:true·지갑 1회 증가·원장 1행 | PASS |
| C7-3 | 동일 orderId 다른 금액 → `LEDGER_FIELD_MISMATCH`(지갑 불변·미은폐) | PASS |
| C7-4 | 타인 UUID orderId → `ORDER_REF_OWNER_MISMATCH` | PASS |
| C7-5 | 잘못된 orderId·`cash_topup_…` 형식 → `ORDER_REF_INVALID` | PASS |
| C7-6 | authenticated·anon 직접 F11 → permission denied(T4a) | PASS |
| C7-7 | 테스트 충전 레거시 회귀(+500,000·원장 1행) | PASS |
| C7-8 | production 테스트 충전 강제 비활성 소스 게이트 | PASS |
| C8-1 | 최초 확정(sub·room_id·차감 8,490,000·succeeded·plan_id 기록) | PASS |
| C8-2 | 동일 결제 재호출 → idempotent:true·room 동일·자금 0 | PASS |
| C8-3 | 확정 뒤 플랜 가격 변경 후 재생 성공(불변 동의 금액 기준·선거부 0) | PASS |
| C8-4 | 3자 불일치 → `PLAN_AMOUNT_CHANGED`(expected/actual 필드·차감 0·pending 유지·구독 0) | PASS |
| C8-5 | room = F12 정본 1개(JS 직접 INSERT 0) | PASS |
| C8-6 | NULL room 참조 → F12 재생이 sub·C 로 복구 | PASS |
| C8-7 | stale room 결제 참조(P) → C 로 복구 | PASS |
| C8-8 | 제3 payment 참조 → `ROOM_REF_MISMATCH`(anomaly_id·보정 0) | PASS |
| C8-9 | `SUBSCRIPTION_REF_INVALID` detail 3종(NULL/NOT_FOUND/NOT_SUCCEEDED — 상위 code 1종 고정, rollback 트랜잭션·커밋 0) | PASS |
| C8-10 | 결속 오류 4종(PLAN/PARTY/LEDGER_BINDING/LEDGER_FIELD) | PASS |
| C8-11 | `ROOM_ENSURE_FAILED`(user_blocks 주입) — 자금·원장·구독·결제 전부 rollback 후 차단 해소 시 동일 결제 재시도 성공 | PASS |
| C8-12 | 예상 밖 예외(필수 인자 NULL) → PostgREST 오류 전파(envelope 둔갑 0) | PASS |
| C8-13 | 동일 payment 동시 2호출 → 양쪽 ok·idempotent 정확히 1·원장 1·구독 1·차감 1회·room 1 | PASS |
| C8-14 | checkout 코드 레거시 직접 호출·JS 방 생성 0(소스 게이트) | PASS |

anomaly 누출 0(rollback 시나리오), cleanup 후 fixture·grant residue 0.

## 6. C10 잔여 프로빙 목록 (이월)

| 위치 | 내용 |
|------|------|
| `lib/subscribe/subscribeCheckoutService.ts` `findActiveSubscriptionForPair` | SUB_TABLES 3종 프로빙 helper — **C8 확정 경로 사용 0**. 잔여 사용처: intent 사전 dup 게이트(동일 파일), `lib/qna/questionRoomStudentContext.ts` · `questionThreadSubscriptionGuard.ts` · `questionRoomThreadService.ts`, `app/(student)/subscribe/success/page.tsx` |
| `lib/subscribe/subscribeCheckoutService.ts` `ensureMentorCatalogPlanRows` | PLAN_TABLE_CANDIDATES·컬럼 프로빙(service_role) — intent 사전 시드 전용으로 잔존(확정 경로 사용 0) |
| `lib/cash/cashQueries.ts` `PAY_TABLES` | 지갑 조회측 프로빙(자금 쓰기 아님) |
| `lib/qna/safeSelect.ts` `pickExistingColumn` 사용처 전반 | C10 전역 프로빙 제거 대상 |

`recordInitialSubscriptionBillingEvent`(service_role 부기 — subscription_billing_events upsert)는
자금 원장이 아니어서 유지하되, **신규 확정에만** 호출로 축소(재생에서 last_payment_id 를 P 로
되돌리는 stale 갱신 제거).

## 7. 정적 검증

`tsc --noEmit` 0 · `eslint` 0 · 계약 테스트 **276/276**(기존 271 유지 + C7 재구성·신규 C8 wiring
tripwire 4건 순증) · `next build` 성공 · `git diff --check` 무결.

판정: **S2_2_TRANSITION_W3_C7: PASS_LOCAL · S2_2_TRANSITION_W3_C8: PASS_LOCAL ·
C7_OPERATIONAL_LEGACY_CALL_ZERO: PASS · C7_TEST_TOPUP_LEGACY_EXCEPTION: PRESERVED ·
C8_LEGACY_CONFIRM_DIRECT_CALL_ZERO: PASS · C8_ROOM_DIRECT_WRITE_ZERO: PASS ·
C8_IMMUTABLE_EXPECTED_AMOUNT_PROVENANCE: PASS · D_API_W_LOCAL: PASS ·
D_API_W_REMOTE: NOT_STARTED · C9_FAIL_OPEN_REMOVAL: NOT_STARTED ·
C10_GLOBAL_PROBING_REMOVAL: NOT_STARTED · APP_F4_F5_F6_TRANSITION: NOT_STARTED ·
S2_2_TRANSITION_W3: COMPLETE · READY_FOR_APP_TRANSITION: YES · READY_FOR_S2_2_BATCH_F: NO**
