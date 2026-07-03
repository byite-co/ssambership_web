# 쌤버십 모듈 등기부 (Module Registry)

> 기능단위 모듈화 기획서 v2.2의 실행 문서. **물리 이동 없는 제자리 경계 형식화** —
> 기존 `lib/<기능>` + `components/<기능>` + app 바인딩을 논리 모듈로 선언하고 경계를 문서·도구로 강제한다.
> 대원칙: 동작 무변경(DB/RLS/RPC·URL·UI/UX·유저플로우 보존).
>
> 함께 보기: `frozen-canon.md`(동결·격리 목록) · `route-inventory.txt`/`action-inventory.txt`/`dep-baseline.json`(무변경 증명 기준선)

## 1. 모듈 해부도 (컨벤션)

```
Module X = lib/X          서버측 (공개 표면 = 최상위 파일 · 내부 구현 = internal/ 하위폴더)
         + components/X   UI (공개 = 최상위 · 화면별 하위폴더 = 내부)
         + app 바인딩      해당 기능의 page.tsx/route.ts 목록 (이동 금지 — 아래 표로 소유 선언)
         + 소유 DB         supabase/sql의 테이블/RPC (문서화만 — SQL 무변경)
```

- 배럴(index.ts) 의무화 없음 — 'use server'/'use client' 혼합 배럴은 RSC 번들 경계를 흔든다.
- 타 모듈 import는 공개 표면만. `internal/` 침범 금지 (dependency-cruiser로 강제 예정 — Phase 2).

## 2. 최상위 구조 — 기획 정본의 "4개 거래 채널 + 2개 신뢰 인프라"

```
[채널 1] 구독질문방 (서비스 본체)   = subscribe + qna  (+연결노트·주간quota·무료질문권)
[채널 2] 개별질문 (IQ)             = individualQuestion  (에스크로 단건, 구독 전환 깔때기)
[채널 3] 맞춤의뢰 (CR)             = customRequest  (에스크로 주문 — 운영 게이트 OFF)
[채널 4] 커뮤니티                  = community (게시판+숏폼) + notices
[인프라 A] 결제·회계               = cash + toss + 환불  (1캐시=1원, append-only 원장)
[인프라 B] 멘토 인증·프로필         = mentor  (온보딩·검증·공개 디렉터리)
[크로스]  정산 · 리뷰 · 분쟁 · 알림(커널)
[운영]    admin · home/mypage/landing · account
```

## 3. L0 공용 커널

| 커널 | 위치 | 비고 |
|---|---|---|
| kernel/auth | `lib/auth/`, `lib/types/user.ts` | `requireRole`·`getServerUserWithProfile` — 148개 파일이 참조하는 최대 공용 의존 |
| kernel/data | `lib/supabase/`(server/client/admin), `lib/storage/` | `admin.ts`(service-role)는 import 허용목록 관리 대상(§6) |
| kernel/ui | `lib/design-system/` + `components/design-system/`(유일한 실배럴), `components/common/`, `components/ui/`, `components/brand/`, `lib/utils/` | 공용 프리미티브. `FormSubmitButton`은 common으로 이관(구경로는 재수출 심) |
| kernel/shell | `lib/shell/`, `components/shell/`(54개 파일이 참조), `components/layout/` | `featureFlags.ts`(CR 게이트)는 동결 — 값·경로 불변 |
| kernel/notifications | `lib/notifications/`, `components/notifications/` | 5개+ 기능이 쓰는 크로스 싱크 → 커널로 재분류. `notificationDeepLink.ts`·`notificationTypeIcon.ts`는 동결 |
| kernel/reference | `lib/subjects/`, `components/subjects/`, `lib/safety/`, `components/legal/`, `components/reports/ReportDialog` | `subjectCatalog.ts` = 앱 정합 1순위 정본(동결) |

## 4. 채널·인프라 모듈 매핑

| 모듈 | lib / components | app 바인딩 (소유 라우트) | api/cron | 소유 DB (문서화) |
|---|---|---|---|---|
| 구독질문방/subscribe | `lib/subscribe` / `components/subscribe` | `(student)/subscribe*`, `(student)/subscriptions` | `api/subscribe/checkout`, `api/cron/subscription-renewal` | `subscriptions`, `subscription_billing_events`, debit RPC(019) |
| 구독질문방/qna | `lib/qna` / `components/qna` | `(student)/question-room/**`, `(mentor)/mentor/question-room/**`, 레거시 `/questions`·`/notes` | `api/question-room/**` | `mentor_student_rooms`, `question_threads`, `question_messages`, `connection_notes`, 주간usage(098)·무료질문권(044/046/052) |
| 개별질문 | `lib/individualQuestion` / `components/individualQuestion` | `(student)/individual-questions/**`, `(mentor)/mentor/individual-questions/**`, `mentors/[id]/individual-question/new` | `api/cron/individual-question-expiry` | IQ 테이블, escrow 070/091/092/096 |
| 맞춤의뢰 | `lib/customRequest` / `components/customRequest` | `(public)`·`(student)`·`(mentor)`의 `custom-request/**` | — | posts/applications/orders, escrow 054~057, 정산항목 013/014 |
| 커뮤니티 | `lib/community`, `lib/notices` / `components/community`, `components/notices` | `(public)/community/**`, `(public)/notices`, `(mentor)/mentor/community/new` | `api/community/**` | `community_posts`, `shortform_posts`, `content_reports`, `app_notices` |
| 결제·회계 | `lib/cash`, `lib/toss` / `components/cash` | `(student)/wallet/**`, `(public)/cash`·`payments`, 레거시 `/cash-history` | `api/toss/confirm`, `api/toss/webhook` | `cash_wallets`, `cash_ledger`(append-only), topup RPC(020), 환불 RPC(030) |
| 멘토 인증·프로필 | `lib/mentor` / `components/mentor` | `(public)/mentors/**`, `(mentor)/mentor/{profile,verification,academic-record-change,channel,mypage,reviews}` | `api/mentors/favorites` | `mentor_profiles`, 학교인증 077, 학적변경 089, cap 050, favorites 034 |
| 정산 ⚠️격리 | `lib/mentor`의 payouts류, `subscriptionSettlementItems`, `orderSettlementService` | `(mentor)/mentor/payouts/**` | `api/mentor/payouts/**` | settlement_items — **정합 대기 구역**(frozen-canon.md §2) |
| 리뷰 | `lib/reviews` / `components/reviews` | (멘토 상세·주문 리뷰 화면) | `api/reviews/**` | `reviews` 042/045/061/066 |
| 분쟁 | `lib/disputes` / `components/disputes`, `components/support` | `(student)`·`(mentor)`의 `support/disputes/**` | — | disputes 004/008/009 |
| 운영/admin | `lib/admin` / `components/admin` | `(admin)/admin/(console)/**` | — | `admin_action_logs`, `admin_audit_logs` |
| 운영/집계 | `lib/home`, `lib/mypage`, `lib/landing` / `components/home`, `components/mypage`, `components/landing` | `/`, `(student)/home`·`mypage`, `(public)/support`·`legal/**` | `api/mypage/active-subscriptions` | (읽기 전용 집계) |
| 운영/account | `lib/auth`의 signup·password 액션류 / `components/auth` | `/login*`, `/signup`, `/logout`, `(public)/forgot-password`, `(public)/auth/update-password`, `(admin)/admin/login` | — | `users`, `user_consent_records`(087) |
| legacy-redirects | — | `/dashboard`, `/questions*`, `/cash-history`, `/notes`, `/wallet`, `/pricing`, `/payments`, `/community/posts`·`shorts*`·`write`, `/mentor/questions*`, `/mentor/custom-request`, `/admin`(index)·`mentors`·`mentor-approvals`·`reports`·`refunds-settlement`, `/support/reports`, `/home` | — | 리다이렉트 전용 — **삭제 금지** (URL 보존) |

## 5. 의존 규칙 (계층)

```
L4  app/** 바인딩                          — 전부 import 가능. 아무도 app/을 import하지 않음
L3  집계·오케스트레이션: admin, home/mypage/landing, account, toss(오케스트레이션)
L2  파생 채널: subscribe, customRequest, individualQuestion, reviews, disputes, 정산(격리)
L1  코어: qna, cash, mentor(공개 read-model), community, notices
L0  커널: auth, data, ui, shell, notifications, reference
```

- **subscribe ↔ qna = 채널 내부 의존(합법)** — "구독하면 질문방이 생긴다"가 서비스 정의. 관리 대상이지 해소 대상이 아님.
- **채널 간 의존은 계약 경유** — mentor 공개 read-model(`publicProfile/` — Phase 5 추출 예정). customRequest→qna(×18, 주문방의 메시징 재사용)·mentor→subscribe(×10)·mentor→qna(×10, 정산·대시보드 계열)는 예외 원장 등재분.
- **admin → 전 채널 = 합법 하향 의존** (검수·중재·환불).
- **toss → cash → subscribe(past_due 복구) = 선언된 브리지 에지**.
- 예외 원장 초기값은 Phase 0 실측 그래프(`dep-baseline.json`)에서 생성 — 문서 수치는 참고값.

## 6. `lib/supabase/admin` (service-role) import 허용목록

현재 import하는 파일의 스냅샷으로 고정 — **신규 추가 금지** (Phase 2에서 도구 강제):
결제·회계(cash/toss), subscribe, qna(2), individualQuestion, customRequest, admin(17),
**mentor 5파일**(mentorPayoutsQueries·subscriptionSettlementItems·mentorActivityActions·mentorActivityService·mentorProfileMutations),
**notifications/notificationInsert.ts**, `app/api/**` 라우트 핸들러.

## 7. 유저플로우 → 모듈 대응 (기획 통합보고서 §4)

| 기획 플로우 | 관여 모듈 (경계 통과 지점) |
|---|---|
| 4.1 온보딩→첫질문 | account → 멘토프로필(디렉터리) → 결제·회계(충전) → 구독질문방(subscribe→qna) |
| 4.2 질문방 반복 사용 | 구독질문방(qna, quota·연결노트) |
| 4.3 개별질문 | 개별질문 ⇄ 결제·회계(hold/release) ⇄ 정산(즉시적립) |
| 4.4 멘토 온보딩 | 멘토 인증·프로필 → admin(승인) |
| 4.5 멘토 답변 | 구독질문방(qna) |
| 4.6 캐시 충전 | 결제·회계(toss→cash) → subscribe(past_due 복구 브리지) |
| 4.7 커뮤니티 | 커뮤니티 → admin(검수) |
| 4.8 맞춤의뢰 | 맞춤의뢰 ⇄ 결제·회계(에스크로) ⇄ 분쟁 ⇄ 정산 |
| 4.9 멘토 정산 | 정산(⚠️격리 — 후불 전환 대기) |
| 4.10 분쟁·환불·신고 | 분쟁/커뮤니티(신고) → admin, 환불 → 결제·회계 |

## 8. 검증 기준선 (무변경 증명)

- 라우트: `npm run inventory:routes` ↔ `route-inventory.txt` diff 공백 (182 파일)
- 서버 액션: `npm run inventory:actions` ↔ `action-inventory.txt` diff 공백 (44 파일)
- 의존 그래프: `npm run dep:baseline` ↔ `dep-baseline.json` — 순환 수 단조 감소·원장 외 신규 에지 0 (기준: 모듈 770 · 에지 2,988 · 순환 5)
- 동결·격리: `npm run check:frozen-canon` (+ `--diff main`)
- 시각: 기획 캡처 264장(132화면 × desktop/mobile, `screenshots_full_detail.zip` — 리포지토리에 커밋하지 않음, 파일명 규약 `desktop/<화면명>.png`) + 기존 `npm run screenshots` 하네스
