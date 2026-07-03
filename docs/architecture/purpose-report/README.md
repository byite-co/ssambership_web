# 쌤버십 존재 목적 전수 리포트 (Purpose Report)

> 레포지토리의 **모든 라우트·기능·인터랙티브 요소(버튼 하나까지)** 에 대해 "왜 존재하는가(목적)·왜 필요한가(구조적 이유)"를
> 코드 실측 근거로 추론해 정리한 리포트 모음. 근거 우선순위: ① 실제 코드(라벨·핸들러·서버 액션·RLS/RPC) ② 기획 정본
> (기능·유저플로우 통합보고서, 동업자 보고서, 앱정합 정본). 근거가 약한 추론은 본문에 "(추정)"으로 명시했다.
> 평가·개선 제안은 범위 밖 — 존재 이유 추론과 사실 기록만 담는다.

## 인덱스

| 파일 | 영역 (기획 채널 구조) | 라우트 | 요소 행 | (추정) |
|---|---|---|---|---|
| `01-shell-landing-common.md` | 셸·랜딩·법적 고지·공용 컴포넌트 사전(30여 항목) | 17 | 96 | 8 |
| `02-account-auth.md` | 계정·인증·마이페이지 (가입 1005줄 스텝별 분해) | 11 | 90+34 | 7 |
| `03-mentor-profile.md` | [인프라 B] 멘토 찾기·인증·프로필·채널 | 12 | 129 | 4 |
| `04-subscription-qna.md` | [채널 1] 구독·질문방·연결노트·quota | 31 | 144 | 12 |
| `05-individual-question.md` | [채널 2] 개별질문 에스크로 단건 | 7 | 105 | 4 |
| `06-custom-request.md` | [채널 3] 맞춤의뢰 (주문방 10섹션 분해) | 24 | 286 | 5 |
| `07-community.md` | [채널 4] 게시판·숏폼·신고 | 16 | 118 | 12 |
| `08-cash-payments.md` | [인프라 A] 캐시·충전(Toss)·원장 | 11 | 70 | 4 |
| `09-cross-…-notifications.md` | 정산·리뷰·분쟁·알림 | 20 | 126 | 4 |
| `10-admin-console.md` | 관리자 콘솔 33라우트 전수 | 33 | 216 | 7 |
| **합계** | | **182** | **≈1,414** | **67** |

## 방법론·표기 규약

- 요소 행 형식: `| 요소(표시 라벨) | 종류 | 소스 | 연결 동작 | 추론한 존재 목적 |` — 라벨은 코드의 실제 한국어 문자열 인용.
- `.map()` 반복 렌더 요소는 1행 + "N개 반복" 표기(개수 부풀리기 방지). 조건부 렌더는 노출 조건 명시.
- 공용 컴포넌트(FormSubmitButton·EmptyState·StatusBadge·AppToast 등)는 `01` 의 "공용 컴포넌트 사전"에서 1회 정의하고
  각 화면에서는 "01 공용 사전 참조"로 표기.
- 코드≠기획 차이는 각주로 기록(수정하지 않음): Premium 주간한도 999 vs FUP16, 랜딩 표시 카탈로그 가격 vs
  실차감 권장가(55,000/114,900/249,900), 커뮤니티 "선검수" 기획 vs 즉시 공개+사후 신고 코드, 금지어 배열 폐지 상태 등.
- 미배선·미참조(orphan)·0바이트 파일·리다이렉트 스텁은 "사실 표기"로 수록 (삭제·정리 제안 아님) —
  대표 사례: `/mentor/dashboard`는 `loading.tsx`만 존재(page.tsx 부재), 맞춤의뢰 보존 View 3종, 커뮤니티 오펀 7개,
  `components/layout/Header.tsx` 0바이트.

## 커버리지 증명 — 라우트 182/182

`route-inventory.txt`(Phase 0 스냅샷)의 182개 라우트 파일 전부가 아래 매핑대로 정확히 1개 리포트에 속한다.
(리포트 본문의 "커버 라우트" 절은 축약 표기(`…/`·`(+ loading.tsx)`)를 쓰므로, 기계 대조는 이 목록을 기준으로 한다.)

### 01-shell-landing-common.md — 17개

- `app/(mentor)/layout.tsx`
- `app/(public)/layout.tsx`
- `app/(public)/legal/copyright/page.tsx`
- `app/(public)/legal/mentor-guide/page.tsx`
- `app/(public)/legal/minor-consent/page.tsx`
- `app/(public)/legal/no-ghostwriting/page.tsx`
- `app/(public)/legal/no-offplatform-contact/page.tsx`
- `app/(public)/legal/payout-guide/page.tsx`
- `app/(public)/legal/privacy/page.tsx`
- `app/(public)/legal/refund/page.tsx`
- `app/(public)/legal/terms/page.tsx`
- `app/(public)/notices/page.tsx`
- `app/(public)/support/page.tsx`
- `app/(student)/layout.tsx`
- `app/dev/design-system/page.tsx`
- `app/layout.tsx`
- `app/page.tsx`

### 02-account-auth.md — 11개

- `app/(mentor)/mentor/mypage/page.tsx`
- `app/(public)/auth/update-password/page.tsx`
- `app/(public)/forgot-password/page.tsx`
- `app/(student)/home/page.tsx`
- `app/(student)/mypage/loading.tsx`
- `app/(student)/mypage/page.tsx`
- `app/login/mentor/page.tsx`
- `app/login/page.tsx`
- `app/login/student/page.tsx`
- `app/logout/route.ts`
- `app/signup/page.tsx`

### 03-mentor-profile.md — 12개

- `app/(mentor)/mentor/academic-record-change/page.tsx`
- `app/(mentor)/mentor/channel/loading.tsx`
- `app/(mentor)/mentor/channel/page.tsx`
- `app/(mentor)/mentor/dashboard/loading.tsx`
- `app/(mentor)/mentor/profile/edit/page.tsx`
- `app/(mentor)/mentor/profile/page.tsx`
- `app/(mentor)/mentor/verification/page.tsx`
- `app/(public)/mentors/[mentorId]/loading.tsx`
- `app/(public)/mentors/[mentorId]/page.tsx`
- `app/(public)/mentors/loading.tsx`
- `app/(public)/mentors/page.tsx`
- `app/api/mentors/favorites/route.ts`

### 04-subscription-qna.md — 31개

- `app/(mentor)/mentor/question-room/[roomId]/loading.tsx`
- `app/(mentor)/mentor/question-room/[roomId]/page.tsx`
- `app/(mentor)/mentor/question-room/[roomId]/thread/[threadId]/page.tsx`
- `app/(mentor)/mentor/question-room/loading.tsx`
- `app/(mentor)/mentor/question-room/page.tsx`
- `app/(mentor)/mentor/questions/[roomId]/page.tsx`
- `app/(mentor)/mentor/questions/page.tsx`
- `app/(public)/pricing/page.tsx`
- `app/(student)/cash-history/page.tsx`
- `app/(student)/notes/page.tsx`
- `app/(student)/question-room/[roomId]/loading.tsx`
- `app/(student)/question-room/[roomId]/page.tsx`
- `app/(student)/question-room/[roomId]/thread/[threadId]/page.tsx`
- `app/(student)/question-room/loading.tsx`
- `app/(student)/question-room/page.tsx`
- `app/(student)/questions/[roomId]/page.tsx`
- `app/(student)/questions/page.tsx`
- `app/(student)/subscribe/cancelled/page.tsx`
- `app/(student)/subscribe/fail/page.tsx`
- `app/(student)/subscribe/loading.tsx`
- `app/(student)/subscribe/page.tsx`
- `app/(student)/subscribe/success/page.tsx`
- `app/(student)/subscriptions/page.tsx`
- `app/api/cron/subscription-renewal/route.ts`
- `app/api/mypage/active-subscriptions/route.ts`
- `app/api/question-room/threads/[threadId]/answer/route.ts`
- `app/api/question-room/threads/[threadId]/confirm/route.ts`
- `app/api/question-room/threads/[threadId]/wrong-answer/route.ts`
- `app/api/question-room/threads/route.ts`
- `app/api/question-room/weekly-usage/route.ts`
- `app/api/subscribe/checkout/route.ts`

### 05-individual-question.md — 7개

- `app/(mentor)/mentor/individual-questions/[questionId]/page.tsx`
- `app/(mentor)/mentor/individual-questions/page.tsx`
- `app/(student)/individual-questions/[questionId]/page.tsx`
- `app/(student)/individual-questions/new/page.tsx`
- `app/(student)/individual-questions/page.tsx`
- `app/(student)/mentors/[mentorId]/individual-question/new/page.tsx`
- `app/api/cron/individual-question-expiry/route.ts`

### 06-custom-request.md — 24개

- `app/(mentor)/mentor/custom-request/dashboard/page.tsx`
- `app/(mentor)/mentor/custom-request/orders/[orderId]/files/page.tsx`
- `app/(mentor)/mentor/custom-request/orders/[orderId]/page.tsx`
- `app/(mentor)/mentor/custom-request/orders/[orderId]/revision/page.tsx`
- `app/(mentor)/mentor/custom-request/orders/[orderId]/room/page.tsx`
- `app/(mentor)/mentor/custom-request/orders/[orderId]/waiting-review/page.tsx`
- `app/(mentor)/mentor/custom-request/orders/page.tsx`
- `app/(mentor)/mentor/custom-request/page.tsx`
- `app/(mentor)/mentor/custom-request/posts/[postId]/apply/page.tsx`
- `app/(mentor)/mentor/custom-request/posts/[postId]/page.tsx`
- `app/(mentor)/mentor/custom-request/posts/page.tsx`
- `app/(public)/custom-request/[postId]/loading.tsx`
- `app/(public)/custom-request/[postId]/page.tsx`
- `app/(public)/custom-request/orders/[orderId]/loading.tsx`
- `app/(public)/custom-request/orders/[orderId]/page.tsx`
- `app/(public)/custom-request/orders/[orderId]/review/page.tsx`
- `app/(public)/custom-request/orders/page.tsx`
- `app/(public)/custom-request/page.tsx`
- `app/(student)/custom-request/[postId]/applications/loading.tsx`
- `app/(student)/custom-request/[postId]/applications/page.tsx`
- `app/(student)/custom-request/[postId]/applications/waiting/page.tsx`
- `app/(student)/custom-request/new/page.tsx`
- `app/(student)/custom-request/orders/[orderId]/complete/page.tsx`
- `app/(student)/custom-request/posts/page.tsx`

### 07-community.md — 16개

- `app/(mentor)/mentor/community/new/page.tsx`
- `app/(public)/community/board/[id]/page.tsx`
- `app/(public)/community/board/page.tsx`
- `app/(public)/community/me/page.tsx`
- `app/(public)/community/new/page.tsx`
- `app/(public)/community/page.tsx`
- `app/(public)/community/posts/page.tsx`
- `app/(public)/community/shortform/[id]/page.tsx`
- `app/(public)/community/shortform/new/page.tsx`
- `app/(public)/community/shortform/page.tsx`
- `app/(public)/community/shorts/[id]/page.tsx`
- `app/(public)/community/shorts/page.tsx`
- `app/(public)/community/write/page.tsx`
- `app/(public)/legal/community-guidelines/page.tsx`
- `app/api/community/board/view/route.ts`
- `app/api/community/posts/route.ts`

### 08-cash-payments.md — 11개

- `app/(public)/cash/page.tsx`
- `app/(public)/payments/page.tsx`
- `app/(student)/wallet/charge/fail/page.tsx`
- `app/(student)/wallet/charge/loading.tsx`
- `app/(student)/wallet/charge/page.tsx`
- `app/(student)/wallet/charge/success/page.tsx`
- `app/(student)/wallet/ledger/loading.tsx`
- `app/(student)/wallet/ledger/page.tsx`
- `app/(student)/wallet/page.tsx`
- `app/api/toss/confirm/route.ts`
- `app/api/toss/webhook/route.ts`

### 09-cross-payouts-reviews-disputes-notifications.md — 20개

- `app/(mentor)/mentor/payouts/detail/page.tsx`
- `app/(mentor)/mentor/payouts/page.tsx`
- `app/(mentor)/mentor/reviews/page.tsx`
- `app/(mentor)/mentor/support/disputes/[id]/page.tsx`
- `app/(mentor)/mentor/support/disputes/loading.tsx`
- `app/(mentor)/mentor/support/disputes/page.tsx`
- `app/(public)/notifications/loading.tsx`
- `app/(public)/notifications/page.tsx`
- `app/(student)/support/disputes/[id]/loading.tsx`
- `app/(student)/support/disputes/[id]/page.tsx`
- `app/(student)/support/disputes/page.tsx`
- `app/(student)/support/refunds/page.tsx`
- `app/(student)/support/reports/page.tsx`
- `app/api/mentor/payouts/detail/route.ts`
- `app/api/mentor/payouts/monthly/route.ts`
- `app/api/mentor/payouts/summary/route.ts`
- `app/api/reviews/[id]/hide/route.ts`
- `app/api/reviews/[id]/reply/route.ts`
- `app/api/reviews/eligibility/route.ts`
- `app/api/reviews/route.ts`

### 10-admin-console.md — 33개

- `app/(admin)/admin/(console)/academic-record-changes/page.tsx`
- `app/(admin)/admin/(console)/audit-logs/page.tsx`
- `app/(admin)/admin/(console)/community-content/page.tsx`
- `app/(admin)/admin/(console)/custom-request-orders/page.tsx`
- `app/(admin)/admin/(console)/dashboard/page.tsx`
- `app/(admin)/admin/(console)/disputes/[id]/loading.tsx`
- `app/(admin)/admin/(console)/disputes/[id]/page.tsx`
- `app/(admin)/admin/(console)/disputes/loading.tsx`
- `app/(admin)/admin/(console)/disputes/page.tsx`
- `app/(admin)/admin/(console)/layout.tsx`
- `app/(admin)/admin/(console)/mentor-activity/page.tsx`
- `app/(admin)/admin/(console)/mentor-approval/page.tsx`
- `app/(admin)/admin/(console)/mentor-approvals/[id]/page.tsx`
- `app/(admin)/admin/(console)/mentor-approvals/page.tsx`
- `app/(admin)/admin/(console)/mentors/page.tsx`
- `app/(admin)/admin/(console)/moderation/page.tsx`
- `app/(admin)/admin/(console)/notices/page.tsx`
- `app/(admin)/admin/(console)/page.tsx`
- `app/(admin)/admin/(console)/refunds-settlement/page.tsx`
- `app/(admin)/admin/(console)/refunds/[id]/page.tsx`
- `app/(admin)/admin/(console)/refunds/loading.tsx`
- `app/(admin)/admin/(console)/refunds/page.tsx`
- `app/(admin)/admin/(console)/reports/[id]/page.tsx`
- `app/(admin)/admin/(console)/reports/page.tsx`
- `app/(admin)/admin/(console)/reviews/[reviewId]/page.tsx`
- `app/(admin)/admin/(console)/reviews/page.tsx`
- `app/(admin)/admin/(console)/school-classifications/page.tsx`
- `app/(admin)/admin/(console)/settings/page.tsx`
- `app/(admin)/admin/(console)/settlements/page.tsx`
- `app/(admin)/admin/(console)/sla/page.tsx`
- `app/(admin)/admin/(console)/users/page.tsx`
- `app/(admin)/admin/login/page.tsx`
- `app/(admin)/layout.tsx`
