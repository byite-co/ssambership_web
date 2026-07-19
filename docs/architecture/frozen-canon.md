# 정본 계약 동결 목록 · 정합 대기 구역

> 모듈화 기획서 §3·§4의 실행 문서. 기계 검사 목록은 `frozen-canon.json`.
> ⚠️ (P3-3 정합, 2026-07-19) 자동 검사 스크립트 `scripts/check-frozen-canon.mjs` 는 **미구현**이라
> 해당 npm 스크립트(`check:frozen-canon`)와 유령 참조를 제거했다. 현재 이 목록의 준수는 **수동 대조**로 확인한다.
> (동작 사양이 확정되면 새 스크립트를 추가하고 npm 스크립트·본 문서를 함께 정합화한다.)

## 1. 동결(frozen) — 이동·분할·개명 전면 금지

앱(Flutter)팀 정합 문서(`쌤버십_앱정합_정본.md`, `WEB_DATA_CANON.md`)가 **파일 경로(일부는 라인)까지 참조**하는
정본 계약 파일. 부득이 변경할 때는 정합 문서 동시 개정이 선행 조건이다.

| 파일 | 동결 사유 |
|---|---|
| `lib/subjects/subjectCatalog.ts` | 과목 code 정본 단일 소스 — 앱 최우선 정합 대상 |
| `lib/qna/questionSubjects.ts` | 과목 호환 위임 레이어로 정합 문서에 명시 |
| `lib/community/communityBoardConstants.ts` | 커뮤니티 카테고리 slug 5종 정본 |
| `lib/customRequest/orderLifecycleConstants.ts` | 주문 폴리모픽 상태 우선순위·라벨맵 — 앱이 "그대로 이식"하는 파일 |
| `lib/qna/weeklyQuestionUsage.ts` | 주간 질문 한도 TS 폴백 정의 |
| `lib/qna/questionRoomThreadService.ts` | 한도 강제 지점(429) — quota 정합 대기 구역이기도 함 |
| `lib/qna/questionThreadSubscriptionGuard.ts` | 한도·구독 가드 — 동상 |
| `lib/notifications/notificationDeepLink.ts` | 알림 딥링크 규칙 정본 |
| `components/notifications/notificationTypeIcon.ts` | 알림 type 분류 휴리스틱 정본 (경로: components/ 소재) |
| `components/qna/QuestionRoomStudentThreadForm.tsx` | 질문 폼 과목 선택 로직 정본 |
| `lib/reviews/checkReviewEligibility.ts` | 리뷰 자격(2회 연속 결제) 앱측 강제 지점 |
| `lib/shell/featureFlags.ts` | 맞춤의뢰 운영 게이트 — 값·경로 불변 |
| `lib/customRequest/bannedPhrases.ts` | 금지어 채움 예정(정합 작업 소유) — 모듈화가 선점하지 않음 |
| `supabase/sql/**` | DB 무변경 원칙 |

## 2. 정합 대기 구역(quarantine) — 모듈화 PR에서 수정 금지

기획-코드 정합 작업(수수료·quota·리뷰 집계·후불 정산 등) 또는 `feature/payout-postpaid` 브랜치(원격 실재,
HEAD `450e8d6`)가 변경할 예정인 파일. 모듈화가 먼저 건드리면 이중 충돌이 나므로 등기부에 표기만 하고
이동·분할하지 않는다. 해당 영역의 모듈화는 정합 완료 후 Phase S에서 수행한다.

| 구역 | 파일 | 대기 사유 |
|---|---|---|
| 정산 파이프라인 | `mentorPayoutsQueries.ts`, `subscriptionSettlementItems.ts`, `orderSettlementService.ts` | 후불 지급 배치(108/109/110 DRAFT — 리포 편입 완료, 가동 대기) 배선 시 변경 예정 |
| 구독 체크아웃 | `subscribeCheckoutService.ts`, `subscriptionRenewalBatch.ts` | 정산 모델 전환과 연동 |
| 리뷰 집계 | `publicMentorsListQueries.ts`, `mentorHubDashboardQueries.ts` | avg_rating 갱신 트리거 신설(stale 수정) 이후 분할 가능 |
| 환불 | `lib/admin/refundActions.ts` | 실 PG 취소 연동 여부 결정 대기 |
| 미성년 동의 | `lib/auth/minorConsentPlaceholders.ts` | 법무 문구 확정 대기 |

**격리 해제 이력 (2026-07-04, W-지시서 정합 수행)**: `mentorPayoutsService.ts`(W-01/04 — 원천징수 4단·IQ 라인),
`mentorPayoutsDisplay.ts`(W-03 cherry-pick 10→23 — payout 브랜치와 내용 동기화, 충돌 소멸),
`app/(student)/support/reports/`(W-06 — 신고내역 실화면 연결 완료). 후불 SQL 105~114 리포 편입 완료.
Premium 주간한도 999는 "의도된 내부 한도(외부 표기 무제한)"로 확정 — quota 구역의 FUP16 결정 대기 사유 소멸
(DB 강제·TOCTOU 해소는 여전히 대기 — `weeklyQuestionUsage`·`questionRoomThreadService` 동결 유지).

**병행 브랜치 검사(1차)**: 각 모듈화 PR 전 `git fetch origin feature/payout-postpaid` 후
`변경 파일 ∩ git diff main...origin/feature/payout-postpaid --name-only = ∅` 확인.
위 목록 검사는 "향후 배선 예정" 영역을 커버하는 2차(보완) 검사다.
