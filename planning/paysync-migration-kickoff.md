# 킥오프: 토스 게이팅 + 페이싱크 무통장입금 전환

> 이 문서는 Claude Code 세션의 작업 지시서다. 작업 전 `CLAUDE.md`, `AGENTS.md`, `ssambership_house_style.md`를 먼저 읽고 레포 컨벤션을 우선하라. 이 문서와 레포 컨벤션이 충돌하면 레포 컨벤션을 따르되 충돌 내용을 보고하라.

## 0. 배경과 목표

현재 캐시 충전은 토스페이먼츠 카드결제(테스트결제, PG 심사용)로 동작한다. 목표 상태:

1. **토스 결제는 심사용 allowlist 계정에만** 노출·허용된다. 일반 계정에는 UI에서 보이지 않고, API 직접 호출도 서버에서 차단된다.
2. **페이싱크(PaySync) 무통장입금 자동확인**이 일반 계정의 충전 수단이 된다.

배포 전략: Phase 0(토스 게이팅)과 페이싱크 오픈은 **같은 릴리스로 머지·배포**한다(단독 배포 시 일반 유저 충전 수단 공백 발생). 개발 순서는 Phase 0 → 1 → 2 → 3.

페이싱크는 PG가 아니라 무통장입금 자동 확인 서비스다: 우리가 등록한 실계좌로 입금되면 은행 SMS를 파싱해 주문(금액+입금자명 정확 일치)과 자동 매칭하고, 서명된 웹훅(`invoice.paid`)을 보낸다. API 문서 전체 색인: `https://docs.paysync.kr/llms.txt` (필요 시 개별 `.md` 페이지를 fetch해 확인하라).

## 1. 반드시 지킬 레포 컨벤션

- **순수 코어 + 서버 래퍼 + `__contract__` 계약 테스트** 패턴. `lib/toss/tossTopupCore.ts`와 그 계약 테스트를 참조 구현으로 삼아 미러링한다.
- **검증 순서 계약**: 인증 확인 → 입력 검증(패키지 allowlist, 형식) → 그 후에만 외부 호출. 비허용 케이스에서 외부 API 호출 0회를 계약 테스트로 보장.
- **오류 노출**: 사용자에게는 고정 문구만, 외부 API 오류 원문은 서버 로그에만.
- **원장**: `api_web_v1.record_cash_topup_v2(p_user_id, p_amount_cents, p_order_ref)` RPC를 그대로 재사용. `p_order_ref`가 멱등키다. 새 원장 RPC를 만들지 마라.
- **RLS**: 신규 테이블은 본인 row SELECT만, 쓰기는 service_role 전용.
- 적립 성공 후 `recoverPastDueAfterTopup` 호출(토스 경로와 동일 계약).
- 금액 단위: 캐시 원장은 cents(원×100) 저장 관례 확인 후 동일하게.

## 2. Phase 0 — 토스 게이팅 (2~3h)

토스 표면은 4곳뿐이다: `CashChargeWidget`(렌더 위치는 `WalletChargePageView` 유일), `/wallet/charge/success`, `/api/toss/confirm`, `/api/toss/webhook`.

- env `TOSS_REVIEW_ALLOWED_USER_IDS` (쉼표 구분 UUID) + `lib/payments/tossGate.ts`의 `isTossAllowedUser(userId)` 헬퍼.
- **UI 게이트**: `/wallet/charge/page.tsx`는 이미 `requireWalletChargeAccess()`로 유저를 안다. 여기서 판정한 `tossEnabled`를 `WalletChargePageView` → `CashChargeWidget`으로 내려, false면 카드 결제수단을 **아예 렌더하지 않는다**(숨김 아님, 미렌더).
- **서버 게이트(핵심)**: `confirmCashTopupCore` 검증 사슬의 인증 확인 직후에 allowlist 체크 추가. success 페이지와 `/api/toss/confirm`이 같은 코어를 쓰므로 한 곳 수정으로 둘 다 차단된다. 비허용 시 고정 문구 + 토스 외부 호출 0회.
- **웹훅 보강**: `recordCashTopupFromTossOrder`에서 orderId(`cash-{userId}-{ts}`)로 파싱한 userId도 allowlist 통과 시에만 적립.
- 계약 테스트: 기존 토스 계약 테스트에 "비허용 유저" 케이스 추가.

## 3. Phase 1 — 페이싱크 웹훅 (최우선 구현, 실입금 E2E 먼저)

외부 연동 불확실성을 세션 초반에 소진한다. 코어 완성 전이라도 "실제 이체 → 웹훅 도착 → 서명 검증 통과" 로그까지 먼저 확인.

- `lib/paysync/verifyPaysyncWebhookSignature.ts` — Standard Webhooks 명세:
  - `whsec_` 접두사 제거 후 Base64 디코드한 키로, `` `${webhook-id}.${webhook-timestamp}.${rawBody}` ``에 HMAC-SHA256.
  - `webhook-signature` 헤더(`v1,<base64>` 목록)와 **타이밍 세이프 비교**, 타임스탬프 ±5분 윈도우 검증.
  - Next.js 라우트에서 `req.text()`로 raw body를 받아 검증 후 JSON 파싱(파싱 후 재직렬화 금지).
- `app/api/paysync/webhook/route.ts`:
  - 검증 실패 → 4xx. 성공 시 **정확히 200** 반환(201/204도 실패 취급됨), 10초 내 응답. 자동 재시도가 없으므로 핸들러는 가볍게, 무거운 후처리는 응답 이후로.
  - `type === "invoice.paid"`만 처리, 모르는 type은 200으로 무시.
  - 처리: `data.metadata.userId` + 로컬 `paysync_invoices` 대조 → `record_cash_topup_v2(p_order_ref = ivc_...)` 적립(멱등이라 중복 웹훅 안전) → 로컬 status `paid` + `paid_at`/`paid_trigger` 기록 → `recoverPastDueAfterTopup` → `revalidatePath`.
  - `trigger`(BANK_TRANSACTION / MANUAL_MATCHING / MARK_AS_PAID)는 로직 분기 없이 감사 로그로만.

## 4. Phase 2 — DB·클라이언트·코어·보정 크론

- **마이그레이션** `paysync_invoices`: `id`, `user_id`, `paysync_invoice_id`(unique), `pay_krw`, `cash_krw`, `bonus_krw`, `depositor_name`, `status`(`pending|paid|expired|canceled`), `issued_at`, `expires_at`, `paid_at`, `paid_trigger`. RLS 상기 규칙.
- `lib/paysync/client.ts`: Base `https://api.paysync.kr/v1`, `Authorization: Bearer`, 응답 `code`/`data` 파싱. 오류 코드(`INVALID_CUSTOMER_NAME`, `INVOICE_ALREADY_EXISTS` 등)→고정 사용자 문구 매핑표. env 누락 시 토스의 `server_config` 패턴처럼 처리.
- `lib/paysync/paysyncTopupCore.ts` + `__contract__` 테스트: 검증 순서, 멱등 판정, 오류 문구 계약.
- **보정 크론** `app/api/cron/paysync-reconcile` (기존 cron 라우트 패턴 미러링): 페이싱크 웹훅은 자동 재시도가 없다 — 유실 시 "돈은 왔는데 캐시 미적립"이 되므로 이 크론이 필수 안전장치다. pending인데 N분 경과한 로컬 주문을 `GET /v1/invoices/{id}`로 재조회 → `paid: true`면 웹훅과 동일 경로로 적립(멱등) → `expires_at` 경과 시 `expired` 마킹. 웹훅 이벤트에 `invoice.expired`는 없다(created/paid/deleted뿐) — 만료는 로컬 판정만.

## 5. Phase 3 — 주문 생성 + UI

- **주문 생성**(서버 액션 또는 라우트): `POST /v1/invoices`
  - `amount` = 패키지 `payKrw`(`CASH_CHARGE_PACKAGES` allowlist 검증), `customer.name` = 입금자명, `expireAfter` = `"1d"`, `metadata` = `{ userId, ref }`(최대 5쌍), `bankAccountIds` = `[]`(전 계좌), 옵션 `cashReceipt`(소득공제 PERSONAL + 휴대폰번호).
  - **입금자명**: 기본값 = NICE 본인인증 `verified_name`, 수정 가능. 1~5자·공백 불가를 클라+서버 양쪽 검증.
  - **409 `INVOICE_ALREADY_EXISTS`**: 본인의 pending 주문이 있으면 그 입금 안내로 재사용, 아니면(동명이인 충돌) "잠시 후 재시도 또는 다른 금액" 고정 문구. v1에서 금액 유니크화는 하지 않는다.
  - 응답 `ivc_...`로 로컬 pending row 생성.
- **취소**: `DELETE /v1/invoices/{id}` (미결제만 가능) + 로컬 `canceled`.
- **UI**:
  - `CashChargeWidget`: 무통장입금 활성화(일반 계정 기본 선택 + 입금자명 필드 + "입금자명이 다르면 자동 확인 불가" 경고). `tossEnabled`일 때만 카드 수단 렌더.
  - 신규 `/wallet/charge/pending`: 계좌(env의 은행/계좌번호/예금주)·금액·입금자명·마감 시각 + 복사 버튼 + 상태 폴링 + "입금했는데 확인이 안 돼요" 버튼(크론과 동일한 재조회 로직 호출).
  - 원장 화면에 진행 중 무통장 주문 섹션(취소 포함).

## 6. env

이미 준비됨(코드에서 존재 가정 가능, 값은 커밋 금지):
- `PAYSYNC_API_KEY`, `PAYSYNC_WEBHOOK_SECRET` — 서버 전용, `NEXT_PUBLIC_` 금지
- `PAYSYNC_DEPOSIT_BANK_NAME`, `PAYSYNC_DEPOSIT_ACCOUNT_NUMBER`, `PAYSYNC_DEPOSIT_ACCOUNT_HOLDER`

Phase 0에서 추가: `TOSS_REVIEW_ALLOWED_USER_IDS` (심사 계정 생성 후 UUID 기입; 비어 있으면 전원 차단으로 동작해야 함).

## 7. 완료 기준 (DoD)

- **Phase 0**: 일반 계정 UI에 카드 미노출 · 비허용 유저의 confirm 직접 호출이 외부 호출 0회로 차단(계약 테스트) · allowlist 계정은 기존 토스 플로우 정상.
- **Phase 1**: 실입금 1건 기준 웹훅 수신 → 서명 검증 → 적립 → 잔액 반영 E2E 성공. 동일 웹훅 재전송 시 중복 적립 0.
- **Phase 2**: 웹훅 핸들러를 끈 상태에서 크론만으로 적립되는 것 확인(유실 시나리오).
- **전체**: 계약 테스트 · `tsc` · build 통과. 신규 코드가 기존 오류 문구·검증 순서 계약과 일치.

## 8. 이 세션에서 하지 않는 것

- 토스 코드 삭제(노출 게이트만; 코드는 보존), 금액 유니크화, 환불 자동화, `cash_topup_packages` 테이블 개편, Toss 심사 통과 후의 전환 정리 작업.