# 04. 구독질문방 (채널 1 — 서비스 본체) — 존재 목적 리포트

> 대상 라우트 24개(페이지 17 · API 7, loading 5 별도) · 요소 행 144개 · 근거: 코드 실측 + 기획 정본

- 이 문서의 기준 관점: 구독질문방은 반복 결제(LTV)·리텐션의 핵심 채널이다. 학생이 멘토를 월 구독(**캐시 지갑 즉시 차감**, Toss 결제창 아님 — `POST /api/subscribe/checkout` → `finalizeSubscriptionCashWalletCheckout`)하면 전용 room(`mentor_student_rooms`)이 열리고, 주간 quota 안에서 질문 카드(thread: `pending → answered → confirmed`)를 누적하며, room 단위 연결노트를 학생·멘토가 공유한다.
- 주간 quota: 라이트(limited) 4 / 스탠다드 9 / 프리미엄 999(코드상 사실상 무제한)[^premium999]. 한도는 DB 제약이 아니라 서버 코드가 검사해 429를 반환한다[^db-enforce].
- 비구독 예외: 무료 질문권 — 가입 시 총 7개 · 가입일로부터 7일 유효 · 멘토당 3개 (`lib/mentor/freeQuestionPolicy.ts`).
- 구독 상태: pending/active/past_due/canceled/expired. active가 아니면 새 질문 생성이 막히고("활성 구독을 찾을 수 없습니다. 멘토 구독 후 질문을 작성해 주세요.") 연결노트는 읽기만 허용·편집 차단("멘토를 다시 구독하면 편집이 다시 열려요" — `connectionNoteSubscriptionGuard.ts`) → 재구독 유도.

## 커버 라우트 (검증용 전수 목록)

route-inventory.txt grep 결과 전수. (loading.tsx는 해당 페이지 절에 포함)

| # | 라우트 | 파일 | 구분 |
|---|--------|------|------|
| 1 | `/subscribe` | `app/(student)/subscribe/page.tsx` | 페이지 |
| 2 | `/subscribe/success` | `app/(student)/subscribe/success/page.tsx` | 페이지 |
| 3 | `/subscribe/fail` | `app/(student)/subscribe/fail/page.tsx` | 페이지 |
| 4 | `/subscribe/cancelled` | `app/(student)/subscribe/cancelled/page.tsx` | 페이지 |
| 5 | `/subscribe` loading | `app/(student)/subscribe/loading.tsx` | 로딩 |
| 6 | `/subscriptions` | `app/(student)/subscriptions/page.tsx` | 페이지 |
| 7 | `/question-room` | `app/(student)/question-room/page.tsx` (+`loading.tsx`) | 페이지 |
| 8 | `/question-room/[roomId]` | `app/(student)/question-room/[roomId]/page.tsx` (+`loading.tsx`) | 페이지 |
| 9 | `/question-room/[roomId]/thread/[threadId]` | `app/(student)/question-room/[roomId]/thread/[threadId]/page.tsx` | 페이지 |
| 10 | `/questions` | `app/(student)/questions/page.tsx` | 레거시 redirect |
| 11 | `/questions/[roomId]` | `app/(student)/questions/[roomId]/page.tsx` | 레거시 redirect |
| 12 | `/notes` | `app/(student)/notes/page.tsx` | 레거시 redirect |
| 13 | `/mentor/question-room` | `app/(mentor)/mentor/question-room/page.tsx` (+`loading.tsx`) | 페이지 |
| 14 | `/mentor/question-room/[roomId]` | `app/(mentor)/mentor/question-room/[roomId]/page.tsx` (+`loading.tsx`) | 페이지 |
| 15 | `/mentor/question-room/[roomId]/thread/[threadId]` | `app/(mentor)/mentor/question-room/[roomId]/thread/[threadId]/page.tsx` | 페이지 |
| 16 | `/mentor/questions` | `app/(mentor)/mentor/questions/page.tsx` | 레거시 redirect |
| 17 | `/mentor/questions/[roomId]` | `app/(mentor)/mentor/questions/[roomId]/page.tsx` | 레거시 redirect |
| 18 | `/pricing` | `app/(public)/pricing/page.tsx` | 레거시 redirect |
| 19 | `POST /api/question-room/threads` | `app/api/question-room/threads/route.ts` | API |
| 20 | `PATCH /api/question-room/threads/[threadId]/answer` | `.../answer/route.ts` | API |
| 21 | `PATCH /api/question-room/threads/[threadId]/confirm` | `.../confirm/route.ts` | API |
| 22 | `PATCH /api/question-room/threads/[threadId]/wrong-answer` | `.../wrong-answer/route.ts` | API |
| 23 | `GET /api/question-room/weekly-usage` | `app/api/question-room/weekly-usage/route.ts` | API |
| 24 | `POST /api/subscribe/checkout` | `app/api/subscribe/checkout/route.ts` | API |
| 25 | `GET /api/cron/subscription-renewal` | `app/api/cron/subscription-renewal/route.ts` | API(cron) |

연결 컴포넌트(전수): `components/subscribe/` 6개 — SubscribeCheckoutClient(193줄) · PlanComparisonCards(318줄) · MentorSubscribeSummaryCard · MentorCheckoutSummary · PromotionNoticeBox · StudentSubscriptionsList(244줄). `components/qna/` 16개 — QuestionRoomStudentDesignWorkspace(885줄) · QuestionRoomMentorDesignWorkspace(651줄) · QuestionRoomWorkspace(597줄) · QuestionRoomListCatalog(445줄) · MentorQuestionRoomDashboard(395줄) · ConnectionNotesPanel(294줄) · QuestionRoomStudentThreadForm(164줄) · QuestionRoomWeeklyUsageBar · QuestionThreadAnswerCompleteButton · QuestionThreadConfirmButton · QuestionThreadWrongAnswerToggle · QuestionThreadWorkflowBadge · QuestionRoomNewQuestionModal · QuestionRoomNewNoteModal · QuestionRoomAttachmentButton · FormSubmitButton. 연결 lib: `lib/subscribe/*` 14개, `lib/qna/*` 24개.

---

## 화면별 상세

### /subscribe — 구독 결제 (`student-subscribe-form`)

**바인딩**: `app/(student)/subscribe/page.tsx` (Server Component, `requireRole("student")`) → `loadStudentSubscribePage`(멘토 프로필+`mentor_plans` tier 매핑) · `fetchWalletBalanceByUserId`(캐시 잔액) · `loadMentorCapUsage`/`wouldExceedCap`(cap 마감 tier 계산, `lib/subscribe/mentorCapService.ts`). 클라이언트: `SubscribeCheckoutClient`, `MentorSubscribeSummaryCard`. 가격 계산: `mentorPlanCashKrw`(`mentor_plans` 행 금액 → 없으면 tier 권장가 55,000/114,900/249,900)[^catalog-price].

**화면의 존재 목적**: 채널 1의 결제 관문. 멘토 상세에서 넘어온 학생이 3개 tier 중 하나를 골라 **캐시 지갑에서 즉시 차감**으로 월 구독을 시작하게 하는 화면. Toss 결제창을 띄우지 않고 지갑 잔액만 검사하므로, 잔액 부족 시 충전 화면으로 보내는 분기가 결제 성공률의 핵심이다. cap 마감 tier는 수치 노출 없이 boolean으로만 내려 학생에게 멘토의 정원 정보를 숨긴다(페이지 주석: "학생에겐 구체 수치 노출 금지").

| 요소 (표시 라벨) | 종류 | 소스 | 연결 동작 | 추론한 존재 목적 |
|---|---|---|---|---|
| "멘토를 먼저 선택해 주세요" + "멘토 찾기 →" | 가드 화면 | page.tsx (조건: `?mentorId` 없음) | `/mentors` 링크 | 구독은 멘토 단위 상품이므로 멘토 미지정 진입을 멘토 찾기로 회송 |
| "멘토 정보를 불러오지 못했어요" | 가드 화면 | page.tsx (조건: `data.kind === "no_mentor" \| "mentor_error"`) | `/mentors` 링크 | 잘못된 mentorId·조회 실패 시 결제 진행 차단 |
| "아직 구독할 수 없는 멘토입니다" · "관리자 승인 완료 전에는 구독을 받을 수 없습니다." | 가드 화면 | page.tsx (조건: `mentorVerificationStatusAllowsActivity` false) | `/mentors` 링크 | 미승인 멘토에 대한 결제 발생을 원천 차단 |
| "선택한 멘토" 카드 (사진/이니셜·이름·"대학 · 학과") | 정보 카드 | `MentorSubscribeSummaryCard` | — | 결제 대상 멘토를 재확인시켜 오구독 방지 |
| 과목 태그 | 칩 | 〃 `.map()` — 최대 6개 반복 (`,·/\|` 분리) | — | 멘토 전문 과목 요약 표시 |
| "프로필 보기 →" | 링크 | 〃 | `/mentors/[mentorId]` | 결제 전 프로필 재검토 경로 |
| 캐시 잔액 사이드바 | 공용 | `WalletChargeSidebar` variant="balance-only" | — | 01 공용 사전 참조 |
| "멘토 구독" + "{멘토명} 멘토와 연결할 플랜을 선택하세요." | 헤더 | page.tsx | — | 화면 성격(멘토별 플랜 선택) 고지 |
| "플랜 선택" · "플랜을 고른 뒤 구독하기를 누르면 캐시가 차감됩니다." | 섹션 헤더 | `SubscribeCheckoutClient` | — | 캐시 차감 방식임을 결제 전 명시 |
| "이 멘토는 현재 구독이 마감되었습니다." + "프로필 열람과 찜하기는 계속 가능해요." + "멘토 찾기 →" | 안내 박스 | 〃 (조건: `allClosed` — 3개 tier 전부 cap 마감) | `/mentors` | cap 전체 마감 시 대체 행동(다른 멘토) 제시 |
| 플랜 카드 버튼 (라벨·"N캐시"·"/ 월"·주간 라벨) | 선택 버튼 | 〃 `.map()` — 3개 반복(tier: limited/standard/premium) | `setSelectedTier` (조건: `planClosed`면 클릭 무시·disabled) | 3개 tier 비교·선택. 기본 선택은 마감 안 된 추천(스탠다드) 우선 |
| "추천" 배지 | 배지 | 〃 (조건: `plan.recommend && !planClosed` — standard만) | — | 중간 tier로 유도해 객단가 방어 (추정) |
| "구독 마감" 배지 | 배지 | 〃 (조건: `closedTiers.has(plan.tier)`) | — | cap 초과 tier를 수치 없이 마감으로만 표시 |
| "캐시가 부족합니다." + "선택한 플랜은 N캐시가 필요합니다. 현재 잔액 N캐시." + "충전하러 가기 →" | 경고 박스 | 〃 (조건: `currentBalanceCash < selected.cashKrw`) | `/wallet/charge` | 잔액 부족 시 이탈 대신 충전 퍼널로 연결 |
| 오류 문구 (`role="alert"`) | 인라인 오류 | 〃 (조건: checkout 응답 실패 등 `error` state) | — | `alert()` 금지 규칙 하의 인라인 피드백 |
| "{플랜} 구독하기" / "구독 처리 중..." / "구독 마감" | 주 CTA | 〃 (disabled: `loading \|\| insufficient \|\| selectedClosed`) | `POST /api/subscribe/checkout` → 성공 시 `router.push("/subscribe/success?mentorId=&planTier=")` | 채널 1 수익의 발생 지점 — 지갑 차감 구독 확정 |
| "구독하기를 누르면 캐시 잔액에서 즉시 차감됩니다." | 캡션 | 〃 | — | 즉시 차감(환불 규정 연계) 사전 고지 |
| "이 멘토의 구독 플랜을 불러오지 못했습니다." | 오류 박스 | 〃 (조건: `plans` 비어 selected 없음) | — | 플랜 데이터 결손 시 결제 차단 |
| 스켈레톤 (제목 1 + 카드 1 + 3열 카드) | 로딩 | `subscribe/loading.tsx` | — | 플랜 3열 레이아웃 예고 Skeleton |

### /subscribe/success — 결제 완료 확인 (`subscribe-success`)

**바인딩**: `app/(student)/subscribe/success/page.tsx` (Server Component). `findActiveSubscriptionForPair`로 **서버에서 활성 구독 실재 여부를 재검증** — 쿼리 파라미터만 믿지 않는다.

**화면의 존재 목적**: 결제 직후의 전환 화면. 검증 성공 시 곧바로 질문방으로 보내 "결제 → 첫 질문"의 활성화 간격을 최소화하고, 검증 실패 시(구독 행 미생성·처리 중) 재시도 경로를 준다.

| 요소 (표시 라벨) | 종류 | 소스 | 연결 동작 | 추론한 존재 목적 |
|---|---|---|---|---|
| (파라미터 불량 시) redirect | 가드 | page.tsx (조건: mentorId/planTier 누락·비정상) | `/subscribe?error=구독 정보가 올바르지 않습니다.` | 성공 화면 위조 접근 차단 |
| "구독이 완료되었습니다!" + "{멘토명}님과 함께 공부를 시작해보세요." | 확인 메시지 | page.tsx (조건: 활성 구독 검증 성공) | — | 결제 성공의 심리적 확정 |
| "질문방으로 이동하기" | 주 CTA | 〃 | `/question-room` | 결제 직후 첫 질문 유도 = 리텐션 활성화 |
| "결제 정보를 확인할 수 없습니다" + "활성 구독을 찾지 못했어요…" | 경고 화면 | page.tsx (조건: `findActiveSubscriptionForPair` null) | — | 미완료/처리 중 상태의 오인 방지 |
| "구독 다시 시도" | CTA | 〃 | `/subscribe?mentorId=` | 실패 시 같은 멘토로 재시도 |
| "마이페이지" | 보조 링크 | 〃 | `/mypage` | 결제 이력 자체 확인 경로 |

### /subscribe/fail — 결제 실패 (`subscribe-fail`)

**바인딩**: `app/(student)/subscribe/fail/page.tsx` (Server Component, `requireRole("student")`).

**화면의 존재 목적**: 승인 실패·취소 케이스의 종착 화면. 실패 사유를 그대로 보여주고 같은 멘토 재시도(또는 멘토 찾기)로 되돌린다.

| 요소 (표시 라벨) | 종류 | 소스 | 연결 동작 | 추론한 존재 목적 |
|---|---|---|---|---|
| "결제에 실패했습니다" + `?message` (기본 "결제가 취소되었거나 승인되지 않았습니다.") | 오류 메시지 | page.tsx | — | 실패 사유 전달 |
| "다시 시도" | 주 CTA | page.tsx (조건: mentorId 있으면 `/subscribe?mentorId=`, 없으면 `/mentors`) | 재시도/멘토 찾기 | 결제 실패 이탈 최소화 |

### /subscribe/cancelled — 결제 취소 (`subscribe-cancelled`)

**바인딩**: `app/(student)/subscribe/cancelled/page.tsx` (정적, 인증 가드 없음 — 파일 내 `requireRole` 호출 없음).

**화면의 존재 목적**: 사용자가 스스로 취소한 경우의 안심 화면 — "캐시는 차감되지 않았으니 안심하세요"로 지갑 차감 불안을 해소하고 재구독 여지를 남긴다. 문구의 "결제 창을 닫았거나"는 결제창 흐름 전제의 잔존 카피로 보인다(현 구독 결제는 지갑 차감, 결제창 없음) (추정).

| 요소 (표시 라벨) | 종류 | 소스 | 연결 동작 | 추론한 존재 목적 |
|---|---|---|---|---|
| "결제를 취소했어요" + "…캐시는 차감되지 않았으니 안심하세요. 언제든 다시 구독할 수 있어요." | 안내 | page.tsx | — | 미차감 확인으로 불안 제거 |
| "요금제로 돌아가기" | 주 CTA | page.tsx | `/subscribe` (mentorId 없이 진입 → 실제로는 "멘토를 먼저 선택해 주세요" 가드 화면에 도달 — 사실 표기) | 재결제 재개 |
| "멘토 찾기" | 보조 CTA | page.tsx | `/mentors` | 다른 멘토 탐색 |

### /subscriptions — 구독 현황 관리 (`student-subscriptions`)

**바인딩**: `app/(student)/subscriptions/page.tsx` (Server Component, 미로그인 시 `/login/student?next=/subscriptions` redirect) → `loadStudentSubscriptionManagementList`(`lib/subscribe/studentSubscriptionManagement.ts` — 상태 라벨은 `subscriptionDisplay.ts`). 클라이언트: `StudentSubscriptionsList`. 셸: `StudentDashboardShell` — 01 공용 사전 참조.

**화면의 존재 목적**: 반복 결제의 관리 접점. 구독 5상태(active/past_due/canceled 예약/expired/refunded)를 학생 언어로 번역해 보여주고, **해지 예약·해지 철회·잔여기간 환불·재구독**의 4개 전환 행동을 한 화면에 모은다. 갱신 중단(이탈) 순간에도 "구독 계속하기"·"재구독"으로 복귀 경로를 유지하는 것이 이 화면의 리텐션 역할.

| 요소 (표시 라벨) | 종류 | 소스 | 연결 동작 | 추론한 존재 목적 |
|---|---|---|---|---|
| "구독 현황" + "이용 중인 멘토 플랜과 다음 갱신, 해지·환불 상태를 확인하세요."(md↑) / "구독 플랜과 갱신·해지 상태를 확인하세요."(모바일) | 헤더 | page.tsx | — | 화면 범위 고지 (반응형 카피 분리) |
| flash 문구 (초록/빨강 박스) | 피드백 | page.tsx (조건: `?ok=` / `?error=` — 해지 액션 redirect 결과) | — | server action 결과를 URL 경유로 표시 |
| 통계 바 "구독 중 N명 · 전체 기록 N건 · 만료 예정 N건" | 요약 | page.tsx (active count·전체·statusTone==="scheduled" count) | — | 구독 포트폴리오 한눈 요약 (past_due는 혼란 방지로 "구독 중"에서 제외 — 코드 주석) |
| "구독 목록을 불러오지 못했습니다…" | 오류 | page.tsx (조건: `subscriptionList.error`) | — | 부분 실패 고지 |
| 탭 "전체 / 이용 중 / 지난 구독" (+건수) | 필터 | `StudentSubscriptionsList` `.map()` — 3개 반복 | 탭 전환 + 페이지 1 리셋 | 살아있는 구독(active·scheduled·pastDue)과 종료 구독(expired·refunded) 분리 |
| "해당하는 구독이 없습니다." | 빈 상태 | 〃 (조건: 필터 결과 0) | — | 탭별 빈 결과 안내 |
| 구독 카드 (멘토명 · 플랜 배지 · 상태 배지) | 카드 | 〃 `.map()` — 페이지당 모바일 3 / 데스크탑 4개 반복 | — | 구독 1건 = 카드 1장. 좌측 3px 액센트 바 색: active=파랑/scheduled=주황/pastDue=빨강/종료=회색 |
| 상태 배지 라벨 | 배지 | `subscriptionDisplay.ts` — "이용 중" / "구독 만료 예정 · {날짜}까지 이용" / "결제 실패 · {날짜}까지 충전 필요" / "만료됨 · 재구독 가능" / "환불됨" | — | 상태 5종을 행동 힌트가 담긴 라벨로 번역 |
| 정보 4칸 "현재 기간 / 다음 결제일 / 주간 질문 한도 / 질문 리셋" | dl | 〃 (`currentPeriodLabel` 등) | — | 갱신·quota 주기의 예측 가능성 제공 |
| "예상 환불액 · 학원법 안내" (접힘 details) + "학원법 시행령 별표4 기준…" | 펼침 상세 | 〃 (`refundEstimateLabel`, `refundEstimateBracketLabel`) | — | 환불 신청 전 예상액·법적 근거 고지 (기본 숨김) |
| "현재 기간({날짜})까지 이용 가능하며 이후 자동 만료됩니다." | 안내 | 〃 (조건: `cancelAtPeriodEnd`) | — | 해지 예약 상태의 이용 가능 기간 명시 |
| "잔여기간 환불 신청이 관리자 검토 대기 중입니다." | 안내 | 〃 (조건: `pendingRefundId`) | — | 환불 파이프라인 진행 상태 표시 |
| "다음 결제 중단" / "저장 중..." | 폼 버튼 | 〃 (조건: `canCancel`) | server action `requestSubscriptionCancelAtPeriodEndAction` (hidden `subscriptionId`) | cancel_at_period_end 예약 — 즉시 해지가 아닌 기간말 해지 |
| "구독 계속하기" / "저장 중..." | 폼 버튼 | 〃 (조건: `canUndoCancel`) | server action `undoSubscriptionCancelAtPeriodEndAction` | 해지 예약 철회 = 이탈 복구 장치 |
| "재구독" | 링크 CTA | 〃 (조건: statusTone expired \| refunded) | `resubscribeHref` | 만료 후 재결제 퍼널 |
| "환불 신청" | 링크 CTA | 〃 (조건: 위 외 — `canRequestRefund` false면 회색·`pointer-events-none`) | `/support/refunds?subscriptionId=` | 잔여기간 환불 접수(관리자 검토 큐 연결) |
| 페이지네이션 "이전 / N · M / 다음" | 내비 | 〃 (조건: totalPages > 1) | 클라이언트 slice | 카드 목록 분할 |
| 빈 상태 "이용 중인 정기 구독이 없습니다" + "멘토 찾기 및 구독" | 빈 상태 | page.tsx (조건: items 0건) | `/mentors` | 무구독 학생을 구독 퍼널 시작점으로 |
| "구독 시 유의 사항" (자동 결제·"구독 해지는 만료일 24시간 전까지"·환불 규정 3항) | 안내 리스트 | page.tsx | — | 자동 갱신 고지 의무 이행 (추정: 전자상거래 고지 목적) |

### /question-room — 학생 질문방 목록 (`student-question-room-list`)

**바인딩**: `app/(student)/question-room/page.tsx` (Server Component) → `loadQuestionRoomListBundle` 후 **방이 1개라도 있으면 첫 방으로 `redirect`**. 따라서 이 화면이 실제 렌더되는 경우는 "구독 0개"뿐이다(코드 주석: "학생 list는 항상 0개 제로상태"). 렌더: `QuestionRoomWorkspace(variant="student", surface="list")` → 내부에서 `QuestionRoomStudentDesignWorkspace`의 제로상태 분기.

**화면의 존재 목적**: 목록 화면이라기보다 **구독 온보딩 히어로**. 구독이 없어 서비스 본체가 비어 있는 학생에게 3컬럼 셸(좌 방 목록 / 중 히어로 / 우 연결노트)을 빈 상태 그대로 보여주어 "구독하면 이 구조가 채워진다"를 시각적으로 학습시키고 `/mentors`로 보낸다.

| 요소 (표시 라벨) | 종류 | 소스 | 연결 동작 | 추론한 존재 목적 |
|---|---|---|---|---|
| (방 ≥1) 첫 방으로 redirect | 라우팅 | page.tsx | `/question-room/[첫 roomId]` | 목록 단계를 생략하고 즉시 작업 화면으로 — 채널 1 접근 마찰 제거 |
| 좌: "구독 질문방" + 검색 input(placeholder "멘토 또는 질문방 검색", disabled) | 레일 헤더 | `QuestionRoomStudentDesignWorkspace` 제로상태 분기 | — | 채워질 목록 자리의 예고 (검색은 방 0개라 비활성) |
| 좌: "구독한 질문방이 아직 없어요" | 빈 상태 | 〃 | — | 빈 원인 설명 |
| 좌·하단: "질문방 구독하기" (+ Plus 아이콘) | CTA | 〃 | `/mentors` | 구독 퍼널 진입 1 |
| 중: "멘토를 구독하면 질문방이 열려요" + 설명(모바일 1줄/데스크탑 원문 분리) | 히어로 | 〃 | — | 구독 = 질문방 개설이라는 상품 구조 교육 |
| 중: 3단계 리스트 "멘토 구독하기 / 궁금한 점 질문하기 / 답변 확인하기" | 온보딩 스텝 | 〃 `.map()` — 3개 반복 | — | 구독→질문→확인(confirmed) 워크플로 예습 |
| 중: "질문방 구독하기" | 주 CTA | 〃 | `/mentors` | 구독 퍼널 진입 2 (히어로 종착) |
| 우: "연결 노트" + "구독하고 질문하면 노트가 여기에 쌓여요" | 빈 패널 | 〃 | — | 장기 학습 관리(연결노트) 가치 예고 |
| 스켈레톤 | 로딩 | `question-room/loading.tsx` | — | 목록 로딩 자리 |

### /question-room/[roomId] — 학생 질문방 상세 · 3단 레이아웃 (`student-question-room-detail`)

**바인딩**: `app/(student)/question-room/[roomId]/page.tsx` (Server Component). 접근 가드 `userCanAccessMentorStudentRoom` 실패 시 `notFound()`. `?thread=` 쿼리는 thread 상세 라우트로 redirect. 데이터: 목록 번들 + 상세 번들 + `loadQuestionRoomSubscriptionContext`(플랜 라벨·갱신일) + `loadInitialWeeklyUsageSnapshots`(멘토별 quota) + 메시지 수/최근 메시지/미읽음(=answered thread 수) + `roomSubjectChips`. 렌더: `QuestionRoomWorkspace(surface="detail", showChatPanel=false)` → `QuestionRoomStudentDesignWorkspace`(목록 모드). server action 실패 시 `?error=&kind=&dThread/dMessage/dNote=&t=`로 초안 복원.

**화면의 존재 목적**: **서비스 본체의 학생 작업대.** 3단 구조 — 좌: 구독 멘토(room) 목록 + 멘토별 주간 quota 잔여 표시, 중: 이 멘토와의 질문 카드 목록 + 새 질문 생성, 우: room 단위 연결노트. 학생이 quota를 보며 질문을 누적하고, answered 카드를 확인 완료(confirmed)로 넘기는 소비 사이클이 여기서 돈다.

| 요소 (표시 라벨) | 종류 | 소스 | 연결 동작 | 추론한 존재 목적 |
|---|---|---|---|---|
| 접근 가드 | 라우팅 | page.tsx (조건: room 당사자 아님) | `notFound()` | 타인 질문방 URL 접근 차단 (RLS + 앱 이중 가드) |
| 성공/오류 배너 | 피드백 | 워크스페이스 상단 (조건: `?ok=` / `?error=`; 오류는 `mapDataErrorMessage` 변환) | — | action 결과 표시 + 실패 시 draft 파라미터로 입력 복원 |
| **[좌]** "구독 질문방" + 검색 input "멘토 또는 질문방 검색" | 레일 헤더 | StudentDesignWorkspace | 클라이언트 필터(멘토명·과목칩) | 다중 구독 학생의 방 전환 |
| [좌] 방 카드 (멘토 사진/이니셜 · 멘토명 · 과목칩 ≤3 or "과목 정보 없음" · "N분 전") | 카드 링크 | 〃 `.map()` — 구독 방 수만큼 반복 (선택 방은 좌측 파란 바+`#EEF4FF`) | `/question-room/[rid]` | 멘토별 방 네비게이션 |
| [좌] quota 한 줄 "주 N개 질문 · 잔여 x/N" / "주 무제한 질문 · N 사용"[^premium999] | 표시 | 〃 (`weeklyQuestionQuotaLabel`; 방별 멘토 usage를 `GET /api/question-room/weekly-usage`로 개별 fetch) | — | 멘토마다 다른 잔여 질문 수를 목록에서 즉시 비교 |
| [좌] 미읽음 배지 (1~9, "9+") | 배지 | 〃 (조건: `unreadCountsByRoomId[rid] > 0` — answered 상태 thread 수 기반) | — | "답변 도착·확인 필요" 방 강조 → 확인 완료 행동 유도 |
| [좌·하단] "질문방 구독하기" | CTA | 〃 | `/mentors` | 멘토 추가 구독(교차 판매) 상시 노출 |
| **[중]** 멘토 헤더 (사진 · 이름 · "인증" 배지 · 학교/학과 or "학교·학과 정보 준비 중" · 과목칩 ≤4) | 헤더 | 〃 ("인증" 배지는 조건 없이 항상 렌더 — 사실 표기; 승인 멘토만 구독 가능 가드가 전제 (추정)) | — | 답변 주체의 신뢰 정보 상시 표시 |
| [중] quota 막대 + "{quota 라벨}" + "{플랜}" | 진행 바 | 〃 (채움 = **잔여** 비율 파랑, limit≥999는 100%) | — | 이번 주 남은 질문의 시각화(소진 임박 인지) |
| [중] "{플랜} 플랜 · 다음 갱신 M/D" (hover 시 "매주 {요일} 갱신 (구독 시작 시각 기준) · 다음 갱신 {상세}") | 메타 | 〃 (`QuestionRoomSubscriptionContext` — 구독 시작 시각 anchor 7일 주기) | — | quota 리셋 시점 예고 → 질문 타이밍 계획 |
| [중] "질문 목록" + 정렬 select "최신순 / 오래된순" | 목록 헤더 | 〃 | 클라이언트 정렬 | 누적 카드 탐색 |
| [중] 첫 질문 빈 상태 "이 멘토에게 첫 질문을 남겨보세요" + 3단계("과목·단원 고르기 / 궁금한 점 질문하기 / 답변 확인하기") + "아래 “새로운 질문하기” 버튼으로 시작해 보세요." | 빈 상태 | 〃 (조건: thread 0건) `.map()` — 스텝 3개 반복 | — | 구독 직후 첫 질문 전환(활성화 지표) 유도 |
| [중] 질문 카드 (과목칩 · 상태 배지 · 제목 · 미리보기 2줄 · 메시지수/조회수/"N분 전") | 카드 링크 | 〃 `.map()` — 페이지당 12개 반복, 좌측 액센트 바 tone 매핑(amber/blue/green) | `/question-room/[rid]/thread/[tid]` | thread = 질문 1건 단위의 진행 상태 관리 |
| [중] 상태 배지 3종 "답변 대기"(amber) / "진행 중"(blue) / "답변 완료"(emerald) | 배지 | `questionThreadStatus.ts` (pending/answered/confirmed; 레거시 closed·archived→confirmed 매핑) | — | thread 워크플로 3단계의 시각 언어 통일 |
| [중] 카드 내 "답변 확인 완료" (compact) | 액션 버튼 | `QuestionThreadConfirmButton` (조건: workflow==="answered"인 카드에만) | `PATCH /api/question-room/threads/[id]/confirm` → `router.refresh()` | 목록에서 바로 confirmed 전환 — 확인 지연 축소 |
| [중] 페이지네이션 ‹ "N / M" › | 내비 | 〃 (조건: 12건 초과) | 클라이언트 slice | 장기 누적 카드 분할 |
| [중·하단] "새로운 질문하기" (+ Plus) | 주 CTA | 〃 (disabled: `weeklyUsage != null && !weeklyUsage.canAsk` — quota 소진) | `QuestionRoomNewQuestionModal` 오픈 | 질문 생성 진입점. 소진 시 비활성으로 429 사전 차단 |
| 모달 "새로운 질문하기" + "과목·메모·제목은 모두 선택이에요. 제목을 비우면 “질문 N”으로 자동 생성됩니다. 확인 완료된 질문만 주간 한도에 포함됩니다."[^quota-copy] | 모달 | `QuestionRoomNewQuestionModal` (ESC/배경 클릭 닫기) | — | 입력 부담 최소화 고지로 질문 생성 문턱 낮춤 |
| 모달: "과목 (선택)" select ("과목 미지정" + 옵션) | 드롭다운 | `QuestionRoomStudentThreadForm` `.map()` — 멘토 지정 과목 수만큼 반복(라벨→코드 정규화, 없으면 `SubjectSelectOptions` 전체 폴백) | — | 질문을 멘토 과목 체계로 분류(연결노트·복기 활용 (추정)) |
| 모달: "단원·개념 메모" input (placeholder "예: 미적분, 확률과 통계, 지문 독해") | 입력 | 〃 | — | 질문 맥락 태깅 |
| 모달: "질문 제목 (선택)" (placeholder "비우면 '질문 N'으로 자동 생성돼요") | 입력 | 〃 (서버가 room 단위 순번으로 "질문 N" 생성) | — | 제목 강제 없이 카드 식별성 확보 |
| 모달: "이번 주 질문 한도를 모두 사용했습니다" | 경고 | 〃 (조건: `usage.canAsk === false`) | — | quota 소진 상태에서의 제출 차단 사유 고지 |
| 모달: "새로운 질문하기" / "등록 중…" | 제출 | 〃 (disabled: `!canAsk \|\| pending`) | `POST /api/question-room/threads` → 성공 시 `?thread=&ok=새 질문이 등록되었습니다.` push + refresh | thread 생성 = quota 차감 이벤트[^quota-copy] |
| 모달: 오류 문구 (예: 429 시 "이번 주 질문 한도를 모두 사용했습니다") | 인라인 오류 | 〃 (API `error` 그대로) | — | 서버 최종 판정(429 등) 표시 |
| **[우]** 연결노트 패널 — 아래 공통 절 참조 | 패널 | `ConnectionNotesPanel` (데스크톱 우측 420px + 모바일 중앙 하단 토글 2회 렌더) | — | room 단위 장기 기록 상주 |
| 스켈레톤 | 로딩 | `[roomId]/loading.tsx` | — | 상세 로딩 자리 |

#### 공통 — 연결노트 패널 (`connection-notes-panel`, 학생·멘토 상세/스레드 4개 라우트 공유)

**바인딩**: `components/qna/ConnectionNotesPanel.tsx` + `QuestionRoomNewNoteModal`. 쓰기 액션은 `saveConnectionNoteAction`/`updateConnectionNoteAction`/`deleteConnectionNoteAction`(server action) — `assertConnectionNoteWriteAllowed`가 active 구독 없으면 편집 차단(읽기 허용).

**존재 목적**: room당 1개 축(양측 노트 스택)으로 학생 배경·목표와 멘토 관리 메모를 나란히 공유 — 질문 단발이 아닌 **장기 학습 관리**라는 상품 약속의 실체.

| 요소 (표시 라벨) | 종류 | 소스 | 연결 동작 | 추론한 존재 목적 |
|---|---|---|---|---|
| "연결 노트" 헤더 + 통계 2칸 "함께한 기간"(room.created_at 기준 "N일/N개월") · "함께한 질문"(thread 수) | 헤더 | ConnectionNotesPanel | — | 관계 누적을 수치화 → 구독 유지 동기 (추정) |
| 컬럼 "학생의 노트 N" / "멘토의 노트 N" | 2열 스택 | 〃 (author_id를 room의 student/mentor에 매칭해 분류) | — | 양측 기록의 병렬 공유 |
| "내 노트 추가" | 버튼 | 〃 (조건: `viewerRole === 컬럼 side` — 자기 컬럼에만) | "새 노트 작성" 모달 오픈 | 상대 컬럼 오염 방지 + 작성 진입 |
| 모달 "새 노트 작성" textarea(placeholder "멘토에게 전달할 배경·목표를 짧게 남겨 주세요.") + "취소"/"저장" | 모달 폼 | QuestionRoomNewNoteModal | server action `saveConnectionNoteAction` (hidden roomId/actor/contextThreadId) | 노트 생성 — 구독 만료 시 가드가 거부하고 재구독 안내 문구 반환 |
| 노트 카드 (본문 · "{작성자} · {일시}") | 카드 | 〃 `.map()` — 노트 수만큼 반복 (좌측 바: 학생=파랑/멘토=초록) | — | 기록 열람 (만료 후에도 읽기 유지) |
| "수정" | 버튼 | 〃 (조건: `editable` = 본인 작성 + 실제 note id 존재; 레거시 author_id null은 불가 — 코드 주석) | 인라인 편집 폼("취소"/"저장" → `updateConnectionNoteAction`) | 본인 노트 갱신 |
| "삭제" | 폼 버튼 | 〃 (동일 조건; `window.confirm("이 노트를 삭제할까요?")` 통과 시) | `deleteConnectionNoteAction` | 본인 노트 제거 |
| "아직 노트가 없어요" | 빈 상태 | 〃 (컬럼별 0건) | — | 작성 유도 |
| 모바일 토글 "연결 노트 (N)" + "보기/닫기" | 접기 | 〃 variant="mobile" | 펼침/접힘 | 모바일에서 3단 → 세로 스택 대응 |

### /question-room/[roomId]/thread/[threadId] — 학생 질문 스레드 상세 (`student-thread-detail`)

**바인딩**: `app/(student)/question-room/[roomId]/thread/[threadId]/page.tsx`. 접근 가드 동일 + `resolvedThreadId` 없으면 `notFound()`. 렌더: 동일 워크스페이스에 `threadDetailMode`·`showChatPanel` — 중앙이 질문 목록 대신 **선택 질문 1건의 상세+대화**로 바뀐다.

**화면의 존재 목적**: 질문 카드 1건의 소비 화면. 질문 원문 → 멘토 답변 대화 → "답변 확인 완료"(confirmed 확정)까지의 종결 흐름을 담당한다. confirmed 후 메시지 입력이 잠기므로(추가 대화 불가) 확인 버튼 옆에 강한 경고를 붙여 조기 확정을 막는다.

| 요소 (표시 라벨) | 종류 | 소스 | 연결 동작 | 추론한 존재 목적 |
|---|---|---|---|---|
| ← 뒤로 (aria "질문 목록으로") + "{멘토명} / {질문 제목}" + "질문 상세 · 실시간 대화" | 브레드크럼 | StudentDesignWorkspace threadDetailMode | `backHref` = `/question-room/[roomId]` | 목록↔상세 2단 내비 |
| 과목칩 + 상태 배지("답변 대기/진행 중/답변 완료") | 메타 | 〃 | — | 카드 상태 재확인 |
| 질문 제목 + 본문 미리보기 + "등록 N분 전" | 본문 | 〃 (`threadPreviewText`) | — | 질문 원문 컨텍스트 |
| "답변" 섹션 — 메시지 말풍선 (내 것 우측 파랑 / 멘토 좌측 흰색+이름, 시각) | 대화 | 〃 `.map()` — 메시지 수만큼 반복; 첨부는 `question_attachments` 행 기준으로 렌더(linked=말풍선 내부 썸네일/파일칩, standalone=시간순 독립 행) — 본문 마커 폐지(XV-ATTACH) | — | thread 안 문답 누적 열람 |
| "아직 답변 메시지가 없습니다." / "답변을 불러오는 중…" | 빈/로딩 | 〃 | — | 대기 상태 안내 |
| "멘토 답변이 도착했어요. 확인하면 완료로 표시돼요." + "답변 확인 완료" (compact) | 확정 유도 | 〃 (조건: workflow==="answered") | `PATCH .../confirm` | answered→confirmed 전환 지점 |
| 경고 "답변이 완전히 이해된 뒤에 “답변 확인 완료”를 눌러 주세요. 확인 완료 후에는 이 질문에서 더 이상 대화를 이어갈 수 없어요." | 경고 | 〃 (동일 조건) | — | confirmed = 대화 잠금이라는 비가역성 고지 |
| "답변을 확인했어요" | 완료 배지 | 〃 (조건: workflow==="confirmed") | — | 종결 상태 표시 |
| (숨김) 오답 표시 토글 "이 문제는 내가 틀렸던 문제예요" | 비노출 | `QuestionThreadWrongAnswerToggle` — 코드 주석 "오답 표시 토글은 화면에서 숨김(컴포넌트·API·DB는 보존, 추후 멘토용으로 활용)" (import 주석 처리) | (연결 시) `PATCH .../wrong-answer` | 약점 분석·복습 리포트 대비 데이터 축적 장치 — 현재 UI 미노출 (사실 표기) |
| 입력 잠금 "완료된 질문이에요. 새 질문을 작성해 주세요." | 잠금 안내 | 〃 (조건: `isQuestionThreadLockedForMessages` — confirmed/closed/archived) | — | 종결 thread 재개 차단 → 새 질문(=quota 소비) 유도 |
| 첨부 버튼 (Paperclip, title "파일·사진 첨부" / "질문을 먼저 선택해 주세요") | 파일 입력 | `QuestionRoomAttachmentButton` (accept 이미지·pdf·doc·ppt·zip; 20MB 초과 시 "파일은 20MB 이하만 첨부할 수 있어요.") | server action `sendQuestionAttachmentAction` (transition 직접 호출 — 메시지 폼 내부라 자체 form 없음, 코드 주석) | 문제 사진·자료 기반 질문 지원 |
| textarea (placeholder "질문을 입력하세요...") + 전송 버튼(Send, aria "전송") | 채팅 폼 | 〃 (disabled: thread 미선택·잠금) | server action `sendQuestionMessageAction` → redirect(`?ok=`·실패 시 `dMessage` 초안 보존) | 질문 메시지 발신 — 만료 구독은 `assertThreadCreationSubscriptionAllowed`가 거부(무료 질문권 thread는 예외 허용) |

### /questions · /questions/[roomId] · /notes · /mentor/questions · /mentor/questions/[roomId] · /pricing — 레거시 redirect 6종 (`legacy-redirects`)

**바인딩**: 각 page.tsx가 `redirect()` 한 줄 수행.

**존재 목적**: 구 URL 체계(`/questions`, `/notes`, `/pricing`)의 북마크·외부 링크를 현 정보구조로 흡수해 404 이탈을 막는다. `/notes`는 파일 주석이 명시: "연결노트 실기능은 질문방(QuestionRoomWorkspace 내 ConnectionNotesPanel)에 통합… 독립 통합뷰는 미구현이므로 질문방으로 보냅니다".

| 요소 (표시 라벨) | 종류 | 소스 | 연결 동작 | 추론한 존재 목적 |
|---|---|---|---|---|
| `/questions` → | redirect | `(student)/questions/page.tsx` | `/question-room` | 구 질문 목록 URL 흡수 |
| `/questions/[roomId]` → | redirect | `(student)/questions/[roomId]/page.tsx` | `/question-room/[roomId]` | 구 방 상세 URL 흡수 |
| `/notes` → | redirect | `(student)/notes/page.tsx` | `/question-room` | 독립 연결노트 뷰 미구현 — 질문방 내 패널로 통합 |
| `/mentor/questions` → | redirect | `(mentor)/mentor/questions/page.tsx` | `/mentor/question-room` | 멘토 구 URL 흡수 |
| `/mentor/questions/[roomId]` → | redirect | `(mentor)/mentor/questions/[roomId]/page.tsx` | `/mentor/question-room/[roomId]` | 〃 |
| `/pricing` → | redirect | `(public)/pricing/page.tsx` | `/mentors` | 전역 요금제 페이지 폐기 — 가격은 멘토 단위(멘토 상세 사이드바 `PlanComparisonCards`)로 이동 |

### /mentor/question-room — 멘토 질문방 목록 (`mentor-question-room-list`)

**바인딩**: `app/(mentor)/mentor/question-room/page.tsx` (`requireRole("mentor")` — 레이아웃 가드와 이중). 학생 측과 동일하게 **방 ≥1이면 첫 방으로 redirect**. 0개일 때만 `MentorQuestionRoomDashboard` 렌더.

**화면의 존재 목적**: 신규 멘토(연결 학생 0명)의 대기 화면. 좌 목록 / 중 학생 요약 / 우 실시간 미리보기의 3영역 대시보드 골격을 빈 상태로 보여준다. redirect 정책상 방이 생기면 이 화면 자체를 지나치므로, 실질 역할은 "학생이 오면 여기가 채워진다"는 구조 예고다 (추정).

| 요소 (표시 라벨) | 종류 | 소스 | 연결 동작 | 추론한 존재 목적 |
|---|---|---|---|---|
| (방 ≥1) 첫 방으로 redirect | 라우팅 | page.tsx | `/mentor/question-room/[첫 roomId]` | 답변 작업 화면 직행 |
| [좌] "질문방 목록" + 검색 "학생명 검색"(disabled) + 탭 "전체/대기/완료" | 레일 | MentorQuestionRoomDashboard `.map()` — 탭 3개 반복 | 탭 필터 | 담당 학생 분류 골격 |
| [좌] 방 버튼 (학생명 + "학생" 배지 + 최근 대화 미리보기) | 목록 항목 | 〃 `.map()` — 방 수만큼 반복 (redirect 정책상 0개 상태가 기본) | 중앙 패널 선택 | 학생 선택 |
| [좌] "질문방이 없습니다." | 빈 상태 | 〃 | — | 학생 미연결 상태 고지 |
| [중] "학생을 선택하여 질문을 관리하세요." | 빈 상태 | 〃 (조건: 선택 없음) | — | 마스터-디테일 사용법 안내 |
| [중] 선택 방 헤더 + "질문방 열기 ›" | CTA | 〃 (조건: 선택 있음) | `roomDetailPath` | 요약 → 상세 작업 화면 전환 |
| [중] "최근 질문" 카드 ("진행 중" 배지 · 제목 · 미리보기 · "상세 보기") / "등록된 질문이 없습니다." | 카드 | 〃 (조건: `latestThread` 유무) | thread 상세 링크 | 최신 미답변 확인 |
| [중] "학생 메모" ("상세 화면에서 학생/멘토 메모를 확인하세요.") | 안내 | 〃 | — | 연결노트 위치 안내 |
| [중] "채팅 미리보기 / 닫기" 토글 | 접기 | 〃 (lg 미만) | 우측 패널 펼침 | 좁은 화면 3열 대응 |
| [우] "실시간 질문방 · 대화 미리보기" + 최근 메시지 말풍선 / "최근 대화가 없습니다." | 미리보기 | 〃 | — | 답변 전 대화 맥락 확인 |
| [우] "상세 화면에서 답변하기" / (미선택 시) "질문방을 선택해주세요" | 주 CTA | 〃 | `roomDetailPath` | 답변 작업 진입 |
| [우] "첨부파일 및 상세 기능은 상세 페이지에서 제공됩니다." | 캡션 | 〃 | — | 미리보기의 기능 한계 고지 |
| 스켈레톤 | 로딩 | `mentor/question-room/loading.tsx` | — | 로딩 자리 |

### /mentor/question-room/[roomId] — 멘토 질문방 상세 · 3단 (`mentor-question-room-detail`)

**바인딩**: `app/(mentor)/mentor/question-room/[roomId]/page.tsx`. 접근 가드 후 목록·상세 번들 + `loadStudentDisplaysForQuestionRooms` + **학생의 구독 컨텍스트·주간 사용량을 읽기 전용으로 재사용**(코드 주석: "이 학생의 구독 요금제·이번 주 잔여 질문(읽기 전용 표시용). 기존 학생 로직 재사용."). 렌더: `QuestionRoomWorkspace(variant="mentor")` → `QuestionRoomMentorDesignWorkspace`(목록 모드, emerald 액센트).

**화면의 존재 목적**: 멘토의 답변 작업대. 좌: 담당 학생 방 목록(미확인=answered 배지), 중: 선택 학생 헤더 + **학생 플랜·잔여 quota 카드**(학생이 어떤 요금제로 얼마나 물을 수 있는지 파악) + 상태 필터가 붙은 질문 카드 목록, 우: 연결노트. 멘토 수익(구독 15% 공제 후 85% 수령)의 근거 노동이 일어나는 화면.

| 요소 (표시 라벨) | 종류 | 소스 | 연결 동작 | 추론한 존재 목적 |
|---|---|---|---|---|
| [좌] "학생 질문방" + 검색 "학생명 검색" | 레일 | MentorDesignWorkspace | 클라이언트 필터 | 다수 학생 탐색 |
| [좌] 방 카드 (학생명 · 최근 질문 제목 or "최근 질문 없음" · "N분 전" · 미읽음 배지 "9+") | 카드 링크 | 〃 `.map()` — 방 수만큼 반복 (선택=emerald 바) | `/mentor/question-room/[rid]` | 미답 학생 우선 파악 |
| [좌] "아직 연결된 학생 질문방이 없어요" | 빈 상태 | 〃 (조건: 필터 결과 0) | — | 무학생 상태 고지 |
| [중] 학생 헤더 (이름 + "학생" 배지 + "질문방 관리" + 과목칩 ≤6 — thread들에서 수집) | 헤더 | 〃 | — | 상대 식별 |
| [중] 학생 플랜 카드 — "{플랜}" emerald 배지 + "이번 주 잔여 x/y" / "이번 주 무제한 · N 사용"[^premium999] + "다음 갱신 {일시}" / "구독 정보 없음" | 읽기 전용 카드 | 〃 (`subscriptionContext` + `studentWeeklyUsage`; 조건: hasPlan 여부 분기) | — | 학생의 결제 상태·질문 여력을 멘토가 파악 → 응대 우선순위·기대치 조정 (추정) |
| [중] 상태 필터 "전체 / 답변대기 / 완료" | 세그먼트 | 〃 `.map()` — 3개 반복 (waiting=pending, done=answered∪confirmed) | 클라이언트 필터 | 미답변 큐 분리 |
| [중] 정렬 "최신순 / 오래된순" | select | 〃 | 클라이언트 정렬 | 오래된 미답변 소급 |
| [중] 질문 카드 (과목칩 · StatusBadge · 제목 · 미리보기 · 메시지수/조회수/"N분 전") | 카드 링크 | 〃 `.map()` — 페이지당 모바일 3 / 데스크탑 4개 반복; StatusBadge는 01 공용 사전 참조 | `/mentor/question-room/[rid]/thread/[tid]` | 답변 대상 선택 |
| [중] "표시할 질문이 없습니다." | 빈 상태 | 〃 | — | 필터 결과 0 안내 |
| [중] 페이지네이션 "‹ 이전 / N · M / 다음 ›" | 내비 | 〃 (조건: 페이지 초과) | 클라이언트 slice | 목록 분할 |
| [우] 연결노트 패널 (viewerRole="mentor" — "멘토의 노트" 컬럼에만 "내 노트 추가") | 패널 | ConnectionNotesPanel | 위 공통 절 참조 | 학생 배경 파악 + 멘토 관리 메모 |
| 성공/오류 배너 | 피드백 | 〃 상단 (조건: `?ok=`/`?error=`) | — | action 결과 표시 |
| 스켈레톤 | 로딩 | `[roomId]/loading.tsx` | — | 로딩 자리 |

### /mentor/question-room/[roomId]/thread/[threadId] — 멘토 스레드 상세 (`mentor-thread-detail`)

**바인딩**: `.../thread/[threadId]/page.tsx` — 파일 docstring: 학생 동등 라우트와 같은 형태로 멘토 URL을 받아준다("누락 시 mentor 측 thread 링크가 404로 떨어졌음"). 렌더: MentorDesignWorkspace `threadDetailMode`(중앙 채팅 + 우측 연결노트 2열, `lg:grid-cols-[1fr_420px]`).

**화면의 존재 목적**: 답변 발신 + **"답변 완료" 선언**의 화면. 멘토가 메시지로 답한 뒤 answer API로 thread를 answered로 올려 학생 확인(confirmed) 사이클로 넘긴다. 멘토 말풍선은 emerald로 학생 화면(blue)과 색 언어를 구분.

| 요소 (표시 라벨) | 종류 | 소스 | 연결 동작 | 추론한 존재 목적 |
|---|---|---|---|---|
| ← "질문 목록으로" + "{학생명} / {질문 제목}" + "질문 상세 · 실시간 대화" | 브레드크럼 | chatThread 헤더 | `backHref` = 방 상세 | 2단 내비 |
| "답변 완료" (CheckCircle2) / "처리 중..." | 상태 전이 버튼 | `QuestionThreadAnswerCompleteButton` (조건: workflow==="pending"일 때만 활성 버튼) | `PATCH .../answer` → `router.refresh()` (`first_answered_at` 최초 1회 기록) | pending→answered 선언 — 학생 확인 단계 개시 + 응답 시간 데이터 축적 (추정) |
| "답변 완료됨 · 학생 확인 대기" | 비활성 배지 | 〃 (조건: workflow==="answered") | — | 이중 완료 클릭 방지 + "완료 아님(학생 확인 대기)" 상태 구분 |
| "학생 확인 완료" | 비활성 배지 | 〃 (조건: workflow==="confirmed") | — | 종결 확인 |
| 학생 플랜 카드 (위 화면과 동일) | 읽기 전용 | 〃 (헤더 아래 상주) | — | 답변 중에도 학생 quota 맥락 유지 |
| 메시지 말풍선 (내 것 우측 emerald / 학생 좌측 흰색+이름) | 대화 | 〃 `.map()` — 메시지 수만큼 반복 (첨부 이미지/파일 렌더 동일) | — | 문답 진행 |
| "아직 메시지가 없습니다." / "대화 불러오는 중…" | 빈/로딩 | 〃 | — | 상태 안내 |
| 첨부 버튼 + textarea "답변을 입력하세요..." + 전송 | 채팅 폼 | 〃 (disabled: 잠금 시; actor="mentor") | server action `sendQuestionMessageAction` / `sendQuestionAttachmentAction` — 미승인 멘토는 `assertMentorApprovedForAction`이 거부, 학생 구독 비활성이면 "학생의 활성 구독이 없어 현재 답변을 작성할 수 없습니다." | 답변 발신 (멘토 자격·구독 유효성 서버 이중 가드) |
| "완료된 질문이에요. 새 질문을 작성해 주세요." | 잠금 안내 | 〃 (조건: confirmed/closed/archived) | — | 종결 thread 답변 차단 |
| 우측 연결노트 패널 | 패널 | ConnectionNotesPanel | 공통 절 참조 | 답변 중 학생 맥락 참조 |

### 잔존 컴포넌트 경로 (라우트 직결 아님 — 전수 기록용)

| 요소 (표시 라벨) | 종류 | 소스 | 연결 동작 | 추론한 존재 목적 |
|---|---|---|---|---|
| `QuestionRoomWorkspace` 내 레거시 3단 렌더 (질문 주제 목록 + `QuestionRoomWeeklyUsageBar` "이번 주 질문" + 메모 폼 "메모 저장" + "빠른 링크" + "멘토 가이드") | 폴백 UI | `QuestionRoomWorkspace.tsx` 260행~ (조건: detail인데 roomId/currentUserId 미충족 — 현 라우트 4곳 모두 신형 워크스페이스 분기로 빠져 실도달 없음 (추정)) | 구형 server action 폼 | 신형(Student/MentorDesignWorkspace) 도입 이전 구현의 잔존 안전망 (추정) |
| `QuestionRoomWeeklyUsageBar` — "이번 주 질문" + 진행 바(잔여=파랑) + "남은 질문 N개 · 확인 완료 시에만 차감됩니다."[^quota-copy] + "다시 시도" | quota 위젯 | 위 레거시 3단·`QuestionRoomStudentThreadForm` 연동 | `GET /api/question-room/weekly-usage` | quota 표시의 독립 위젯화 (레거시 경로 전용) |
| `QuestionRoomListCatalog` — 탭 4종("전체/답변 대기/답변 도착 · 확인 or 학생 확인 대기/완료") + 통계 3칸 + 방 카드("질문방 열기/답변하기/대화 열기") + "이용 순서/운영 가이드" 레일 | 목록 UI | `QuestionRoomWorkspace` surface="list" variant="mentor" 분기에서만 렌더 — 멘토 목록 라우트는 `MentorQuestionRoomDashboard`를 직접 사용하므로 현 라우트에서 미도달 (추정: 구 목록 화면 잔존) | 방 상세 링크 | 구 세대 목록 카탈로그 보존 |
| `PlanComparisonCards` (318줄) — "구독 요금제 선택" radio-rail / rail / checkout 3레이아웃, CTA "이 플랜으로 구독"·"이 플랜으로"·"선택됨", 배지 "추천", 폴백 "이 티어의 요금 정보를 불러오지 못했어요." | 요금제 카드 | 사용처: `components/mentor/MentorDetailSubscribeSidebar.tsx`(멘토 상세, layout="radio-rail")뿐 — `/subscribe` 본문은 `SubscribeCheckoutClient` 자체 카드 사용 (grep 실측) | rail/checkout 레이아웃 CTA → `/subscribe?mentorId=&plan={tier}` | 멘토 상세→구독 진입 카드(03 멘토 찾기 리포트 영역과 접점). checkout 레이아웃 벤핏 불릿(`주간 신규 질문: {라벨}` 등 최대 5줄 `.map()`)은 미사용 레이아웃의 잔존 (추정) |
| `MentorCheckoutSummary` — "선택한 멘토" + "프로필로 돌아가기" + dl "대학교/과/과목/인증" | 정보 카드 | 프로젝트 내 import 0건 (grep 실측 — 자기 파일뿐) | — | 구 checkout 요약 카드의 잔존, 현재 미사용 (사실 표기) |
| `PromotionNoticeBox` — "무료 질문 정책"(FREE_QUESTION_POLICY_SHORT: "무료 질문권으로 멘토당 최대 3개 질문 가능 (가입 시 7개 지급, 7일간 유효)") + "구매 전 안내" 3항 + "프로모션 · 공지" `.map()` 최대 5행 | 안내 박스 | 프로젝트 내 import 0건 (grep 실측) | — | 구 구독 페이지의 정책 고지 블록 잔존, 현재 미사용 (사실 표기) |

---

## API 라우트 — 존재 목적 (왜 server action이 아니라 API인가)

이 영역의 서버 쓰기는 두 계열로 나뉜다: **redirect 후 URL 쿼리로 결과를 전달해도 되는 폼**(메시지·노트)은 server action, **JSON 응답을 받아 클라이언트가 모달 닫기·인라인 오류·상태코드(429/409) 분기·`router.refresh()` 부분 갱신을 제어해야 하는 상호작용**은 Route Handler(API)다. 질문방 API 4종은 공통 세션 가드 `getQnaApiSession`(401/403) + `assertRoomParty`(room 당사자 검증)를 지난다.

| 요소 (엔드포인트) | 종류 | 소스 | 연결 동작 | 추론한 존재 목적 |
|---|---|---|---|---|
| `POST /api/question-room/threads` | API | `threads/route.ts` → `createStudentQuestionThread` | 학생 전용(403 "질문 주제는 학생만 만들 수 있습니다."). 활성 구독 없으면 무료 질문권 검사(총7·멘토당3·가입 7일)→사용 기록, 있으면 주간 usage 검사 → 소진 시 **429 + `code:"weekly_limit_exceeded"`**. 제목 공란이면 room 순번 "질문 N" 자동 생성 | 질문 카드 생성 = quota 차감의 관문. 모달 폼이 threadId를 받아 `?thread=` 라우팅해야 하고 429를 코드로 구분해야 하므로 API[^db-enforce] |
| `PATCH /api/question-room/threads/[threadId]/answer` | API | `answer/route.ts` → `markQuestionThreadAnsweredForMentor` | 멘토 전용(403). `assertMentorApprovedForAction` + thread∈room 검증. pending→answered(+최초 `first_answered_at`), answered/confirmed면 멱등 ok | 멘토의 "답변 완료" 선언. 버튼이 페이지 이동 없이 `router.refresh()`로 배지만 갱신하는 상호작용이라 API |
| `PATCH /api/question-room/threads/[threadId]/confirm` | API | `confirm/route.ts` → `confirmQuestionThreadForStudent` | 학생 전용(403 "학생만 질문을 확인 완료할 수 있습니다."). answered 상태에서만 confirmed(+`confirmed_at`); 그 외 400 "멘토 답변이 도착한 뒤에만 확인할 수 있습니다."; confirmed 재호출 멱등 | 학생의 최종 확정 — thread 종결·메시지 잠금의 트리거. 목록 카드·상세 양쪽에서 인라인 호출되므로 API |
| `PATCH /api/question-room/threads/[threadId]/wrong-answer` | API | `wrong-answer/route.ts` → `updateQuestionThreadWrongAnswerForStudent` | 학생 전용. `is_wrong_answer`(+가능 시 `mastery_status: wrong/unknown`) 저장 — 컬럼 부재 대비 3단 payload 폴백 | 오답 데이터 축적(복습 리포트 대비). 호출 UI는 현재 숨김 상태로 API만 보존 (사실 표기) |
| `GET /api/question-room/weekly-usage` | API | `weekly-usage/route.ts` → `fetchWeeklyQuestionUsageWithFallback` | 학생 전용. `?mentorId=` 단건 또는 `?mentorIds=a,b` 배치(usageByMentorId 맵). RPC `get_weekly_question_usage` → 실패 시 코드 폴백(활성 구독 tier→limit 4/9/999, 구독 시작 시각 anchor 7일 창에서 생성 thread 수 집계)[^premium999][^quota-copy] | quota의 단일 조회 소스. 좌측 레일이 방마다·수시로 fetch하는 읽기 전용 조회라 GET API (server action은 조회 부적합) |
| `POST /api/subscribe/checkout` | API | `checkout/route.ts` → `finalizeSubscriptionCashWalletCheckout` | 파라미터·세션 검증 → **서버가 mentor_plans에서 금액 재계산**, 클라 amountCents와 불일치 시 400 `amount_mismatch`("결제 금액이 현재 멘토 요금제와 일치하지 않습니다…") → 잔액 검사 400 `insufficient_cash` → intent 생성 → `finalizeSubscriptionCheckout`(계정 정지·멘토 승인 가드, 결제 행 소유 검증, subscriptions 생성 + `record_subscription_cash_debit` 지갑 차감 + room 보장) → 중복 구독 409 `dup` → `revalidatePath` 5개(`/subscribe` `/subscriptions` `/question-room` `/wallet/charge` `/wallet/ledger`) | 채널 1 매출 발생 지점. 금액을 절대 클라이언트 값으로 확정하지 않는 서버 재계산 + 코드화된 오류(dup/insufficient_cash)를 UI가 인라인 분기해야 하므로 API |
| `GET /api/cron/subscription-renewal` | API(cron) | `cron/subscription-renewal/route.ts` → `runSubscriptionRenewalBatch` | `CRON_SECRET` Bearer/`x-cron-secret` timingSafeEqual 인증(401) → `SUBSCRIPTION_RENEWAL_ENABLED` 플래그 아니면 no-op → `?at=` 기준 시각 주입 가능 → active/past_due 구독 일괄 갱신(지갑 차감, 잔액 부족→past_due, 만료 처리, 갱신 3일 전 사전 알림) 결과 summary JSON | **반복 결제(LTV)의 심장.** 사용자 세션 없이 외부 스케줄러가 호출하므로 server action이 원천 불가 — 시크릿 인증 API가 유일한 형태. `?at=`은 갱신 시뮬레이션·재처리용 (추정) |

---

[^premium999]: 프리미엄 한도: 코드 `lib/qna/weeklyQuestionUsage.ts` `limitForTier("premium") === 999`, UI는 `limit >= 999`를 "무제한"("주 무제한 질문", "이번 주 무제한")으로 표기 — 사실상 무제한. 기획 정본의 프리미엄 FUP(주 16 수준)와 불일치. cap 가중치(`mentorCapService.ts` premium 4.5)는 잠금값과 일치하나 질문 한도 자체는 FUP 미구현.
[^catalog-price]: 가격 이중화: `lib/subscribe/subscribePlanCatalog.ts`의 카탈로그 기본값은 라이트 29,900 / 스탠다드 84,900 / 프리미엄 179,000캐시 + tier 라벨 "라이트"로, CLAUDE.md 잠금값(베이직(주4) 55,000 / 스탠다드 114,900 / 프리미엄 249,900)과 다르다. 실제 차감액은 `mentorPlanDebitAmountCents`가 `mentor_plans` 행 금액 → 없으면 **권장가 55,000/114,900/249,900**(`MENTOR_SUBSCRIPTION_PRICE_RULES.recommendedCashKrw`, 잠금값과 일치)으로 결정하므로 카탈로그 값은 플랜 행·권장가 모두 실패 시의 표시 폴백. 라벨 "베이직" vs 코드 "라이트"도 표기 불일치.
[^db-enforce]: 주간 한도는 DB 제약(트리거·CHECK)이 아니라 서버 코드 검사다: `assertStudentCanCreateThread`가 usage를 조회해 `canAsk` false면 429를 반환하고, server action 경로도 `assertThreadCreationSubscriptionAllowed`가 같은 검사를 수행한다. DB 직접 insert에는 강제되지 않는다 (사실 표기).
[^quota-copy]: 차감 시점 문구≠코드: UI 다수 문구는 "확인 완료된 질문만 이번 주 한도에 포함됩니다"·"확인 완료 시에만 차감됩니다"라고 안내하지만, 코드 집계는 생성 시 차감이다 — `weeklyQuestionUsage.ts` 주석 "Mirrors get_weekly_question_usage (098): quota is consumed on create", `COUNTED_THREAD_STATUSES = ["pending","answered","confirmed","closed","archived"]`(pending 포함). 문구와 집계 기준 불일치 (사실 표기).
