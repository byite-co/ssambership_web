# 09. 크로스 도메인 — 정산·리뷰·분쟁·알림 — 존재 목적 리포트

> 대상 라우트 17개(화면 10 + API 7) · 요소 행 126개 · 근거: 코드 실측 + 기획 정본

- 담당 범위: 멘토 정산(`/mentor/payouts/**` + `/api/mentor/payouts/**`), 리뷰(`/mentor/reviews`, `/api/reviews/**`), 당사자 분쟁·환불(`/support/**`, `/mentor/support/disputes/**`), 알림(`/notifications`).
- 제외: 관리자 측 disputes/refunds/reviews/reports 콘솔 화면(`app/(admin)/**`) — **10번 리포트 담당**.
- 기획 기준(정본): 정산=활동 즉시 캐시 적립 + 수수료(구독 15% / 맞춤의뢰 5% / 개별질문 15%), 후불 은행송금 배치는 별도 브랜치 진행 중·미가동. 리뷰=동일 멘토 2회 연속 결제 성공 시에만 작성(앱+DB 2중 강제)·1인 1리뷰·멘토 답글·관리자 숨김. 분쟁=정산 보류→관리자 중재→환불/정산 종결. 환불=사유 5자 이상→관리자 승인→캐시 크레딧, 학원법 비율. 알림=per-event 발행+role별 딥링크+읽음 처리(type free-form).

---

## 화면별 상세

### /mentor/payouts — 정산 요약 (`mentor-payouts`)

- 파일: `app/(mentor)/mentor/payouts/page.tsx` → `components/mentor/payouts/MentorPayoutsPage.tsx`
- 가드: `requireRole("mentor")` (페이지 첫 줄) + `(mentor)/layout.tsx` 중복 가드
- 데이터: `loadMentorPayoutsPageData()` (`lib/mentor/mentorPayoutsService.ts`) — 구독(`subscription_settlement_items`)·맞춤의뢰 정산 라인을 서버에서 합산
- 레이아웃: `ResponsivePageColumns` — xl 이상 `1fr + 300px` 우측 패널, 모바일 단일 컬럼

| 요소 (표시 라벨) | 종류 | 소스 | 연결 동작 | 추론한 존재 목적 |
|---|---|---|---|---|
| "멘토 정산" / "예상 정산 금액과 서비스 수익을 확인하세요." | 페이지 헤더 | MentorPayoutsPage | — | 정산 허브임을 선언, 멘토가 수익 확인 목적으로 진입했음을 확정 |
| 히어로 카드 좌측 초록(#059669) 보더 | 스타일 | MentorPayoutsHeroCard | — | 멘토 정체성 초록 액센트 — 학생(파랑) 화면과 역할 구분 |
| "이번 달 예상 정산 · {8월}" + 38px 대형 금액 | KPI 텍스트 | `summary.thisMonthScheduledPayout` | — | 이 화면의 단일 핵심 답 "이번 달 얼마 받나"를 최상단 최대 크기로 |
| "지급 예정일" + `schedule.nextPayoutLabel` | 정보 행 | `buildPayoutScheduleInfo()` | — | 후불 지급 시점 기대치 설정 (배치 미가동 상태의 예정 표기)¹ |
| "정산 예정" 배지 (amber) | 상태 배지 | 고정 문구 | — | 아직 지급되지 않은 금액임을 표시 — 금지어 "정산 대기" 대신 통일 문구 "정산 예정" 사용 |
| "구독 수익" + 금액 + "15% 공제 (플랫폼 수수료)" | 수익원 타일 | `summary.thisMonthSubscription` + `SUBSCRIPTION_PLATFORM_FEE_LABEL` | — | 수익원별 분해 1/2 — 잠금값 수수료 15%가 이미 공제된 순액임을 명시해 금액 오해 방지 |
| "맞춤의뢰 수익" + 금액 + "5% 공제 (플랫폼 수수료)" | 수익원 타일 | `summary.thisMonthCustomRequest` + `CUSTOM_REQUEST_PLATFORM_FEE_LABEL` | — | 수익원별 분해 2/2 — 잠금값 수수료 5% 공제 명시 |
| "누적 정산" + 초록 금액 + "지급 완료 합계" | 수익원 타일 | `kpis.lifetimePaid` | — | 발생 전(중립 slate) vs 지급 완료(초록) 색 위계로 확정/미확정 수익 구분 (컴포넌트 주석 명시) |
| "정산받을 계좌" 패널 + `{은행} {계좌번호}` 또는 "정산 계좌 미등록" | 계좌 카드 | MentorPayoutAccountPanel · `loadMentorPayoutBankAccount()` | — | 계좌 미등록 시 정산 보류라는 기획 전제의 등록 진입점 — 요약 화면에 상시 노출 |
| "등록됨"(emerald) / "미등록"(amber) 배지 | 상태 배지 | `registered = Boolean(accountNumber)` 조건부 | — | 계좌 등록 여부를 색으로 즉시 판별 — 미등록 경고 톤(amber) |
| "은행" select (KB국민은행 외 16개 + 커스텀 옵션) | 폼 입력 | BANK_OPTIONS 상수 | — | 은행명 자유 입력 오타 방지 — 기존 저장값이 목록 밖이면 커스텀 옵션으로 보존 |
| "계좌번호" input ("숫자만 입력") | 폼 입력 | `digitsOnly()` 필터 | — | 숫자 8~24자리 검증(서버 액션)과 짝 — 하이픈 등 비숫자 사전 제거 |
| "계좌 변경" / "저장 중" 버튼 | 제출 버튼 | `updateMentorPayoutAccountAction` (server action) | `mentor_profiles` 은행·계좌 컬럼 update → `revalidatePath("/mentor/payouts")` | 계좌 등록·변경 저장 — 성공 시 "정산 계좌를 저장했습니다." 인라인 메시지(alert 금지 규칙 준수) |
| "정산 계좌 저장 컬럼이 아직 적용되지 않았습니다." | 경고문 | `!props.editable` 조건부 (컬럼 스키마 미탐지 시) | — | DB에 계좌 컬럼이 없는 환경에서 폼 비활성 사유 고지 — 스키마 탐지형 방어 |
| 탭 "정산 내역" / "수행 내역" | 탭 | MentorPayoutsMain `useState(tab)` | 클라이언트 탭 전환 | 돈 관점(정산액)과 활동 관점(수행 건)을 한 화면에서 분리 열람 |
| 월 선택 select (최근 12개월) | 필터 | `monthOptions()` | 클라이언트 필터(`inMonth`) | 월 단위 정산 대사(월별 상세) — 재조회 없이 로드된 라인 필터 |
| "{2026년 6월} 기준 {N}건" | 카운트 | `filteredSettlement.length` | — | 필터 결과 규모 확인 |
| "다운로드" 버튼 (Download 아이콘) | 버튼 | `downloadSettlement()` — xlsx 동적 import | `mentor-settlement-{월}.xlsx` 생성(일자·유형·내용·총액·수수료·정산액·상태) | 정산 증빙·개인 장부용 엑셀 반출 — 내역 0건이면 disabled |
| 정산 내역 표 헤더 "일자·유형·내용·총액·수수료·정산액·상태" | 테이블 | MentorPayoutsSettlementTable | — | 총액→수수료→정산액 순서로 공제 구조를 행 단위로 투명화 |
| 정산 행 (유형 배지 "구독"/"맞춤의뢰" + 금액 3종 + 상태 배지) | 테이블 행 `.map()` | `settlementLines` 최신순 상위 **6개 반복** (주석: 나머지는 상세 페이지에서) | hover 하이라이트 | 최근 발생 건 미리보기 — 전량은 `/mentor/payouts/detail`로 위임 |
| 취소 건 금액 표기: 총액 `-{금액}` 빨강 / 수수료 `+{금액}` 초록 | 조건부 스타일 | `row.isCancelled` 조건부 | — | 환불·취소 시 차감(−)과 수수료 환입(+)의 방향을 부호·색으로 표시 |
| 상태 배지 "정산완료 / 정산예정 / 보류 / 취소" | 상태 배지 | `settlementStatusBadge()` (payoutUi.tsx) | — | 지급 lifecycle 표시 — "보류"는 분쟁·계좌 미등록 등 정산 보류 기획의 표면 |
| 모바일 카드형 리스트 (sm 미만, 동일 행) | 반응형 대체 뷰 `.map()` | 동일 rows **6개 반복** | — | 좁은 화면에서 7열 표 대신 카드로 — 정산액만 크게 강조 |
| 빈 상태 "선택한 기간에 정산 내역이 없어요" | EmptyState | rows 0건 조건부 | — | 01 공용 사전 참조 (`EmptyState` compact) |
| "최근 수행 {N}건" + 수행 내역 표 (일자·유형·제목·학생·금액·상태) | 테이블 `.map()` | `performanceLines.slice(0, 30)` — **최대 30개 반복** | — | 정산액의 근거가 된 활동(주문·구독) 목록 — 상태 "완료/진행중/취소" |
| 수행 내역 빈 문구 "최근 수행 내역이 없습니다." | 빈 상태 | rows 0건 조건부 | — | 신규 멘토의 빈 탭 안내 |
| 우측 "지급 일정" 카드 — "다음 지급 예정일" + "{월} 정산 진행 현황 {N}%" 프로그레스 바 | 사이드 카드 | MentorPayoutsRightPanel · `schedule` | — | 지급 사이클 내 현재 위치를 시각화 — 월 경과율 기반¹ |
| 우측 "월간 추이" 카드 + "최근 6개월" 칩 + 영역 차트 | recharts 차트 | MentorPayoutsMonthlyAreaChartLazy (`dynamic`, ssr:false) | 로딩 중 "차트 불러오는 중…" | 수익 추세 파악 — recharts를 지연 로드해 초기 번들 절감 |
| 우측 "정산 안내" 카드 — "지급일: 매월 10일 · 등록 계좌" / "수수료: 구독 15% · 맞춤의뢰 5%" / "환불·취소: 익월 정산 반영" | 안내 dl | 상수 `MENTOR_*_PLATFORM_SHARE` | — | 정산 정책 3줄 요약 — 수수료율은 잠금값 상수에서 파생(하드코딩 아님)¹ |
| "1:1 문의하기 →" 링크 | 링크 | Link `/support/disputes` | 학생용 분쟁 목록으로 이동 | 정산 이의 제기 진입점 — 단, 멘토 화면에서 학생 라우트로 연결됨² |

**미사용 잔존 컴포넌트(이 디렉터리 소속, 화면 미연결):**

| 요소 (표시 라벨) | 종류 | 소스 | 연결 동작 | 추론한 존재 목적 |
|---|---|---|---|---|
| MentorPayoutsKpiCards — "구독 수익/맞춤의뢰 수익/총 수익/정산 완료" 4카드 + "전월 대비 ±N%" | 미사용 컴포넌트 | `payouts/MentorPayoutsKpiCards.tsx` (import 0건) | — | 이전 레이아웃의 KPI 4분할 (추정: 히어로 카드로 대체된 구버전) |
| MentorPayoutsLeftSidebar — "이번 달 예상 정산"·"수익 비중" 도넛·"정산 안내" | 미사용 컴포넌트 | `payouts/MentorPayoutsLeftSidebar.tsx` (import 0건) | — | 이전 3단 레이아웃의 좌측 사이드바 (추정). 내부에 "구독 멘토 몫 70% · 맞춤의뢰 멘토 몫 80%" 구 문구 잔존 — 잠금값(85/95)과 불일치³ |
| MentorPayoutsDonutChart "구독 {N}% / 맞춤의뢰 {N}%" | 차트 | `payouts/MentorPayoutsCharts.tsx` — LeftSidebar에서만 참조 | — | 수익원 비중 시각화 (미사용 경로에서만 소비) |

¹ **코드≠기획 각주(정산 방식):** 기획 정본상 현행 정산은 "활동 즉시 캐시 적립"이며, "매월 10일 지급"·"지급 예정일"·진행률 바는 후불 은행송금 배치(별도 브랜치 진행 중·**미가동**) 기준의 안내 표기다. 화면은 후불 어휘를 쓰지만 실제 지급 배치는 돌지 않는다 — 사실 표기.
² **코드≠기획 각주:** `/support/disputes`는 `requireRole("student")` 가드 페이지 — 멘토 클릭 시 멘토용 `/mentor/support/disputes`가 아닌 학생 라우트로 연결된다.
³ **코드≠기획 각주:** 미사용 파일 내부이지만 70/80 표기는 수수료 잠금값(멘토 수령 85/95)과 다른 구버전 값.
⁴ **사실 표기(기획 명시):** 개별질문(IQ) 지급 라인은 `PayoutLineType = "subscription" | "custom_request"` 두 종뿐 — 정산 화면에 미표시되고 지갑에는 즉시 반영된다.

---

### /mentor/payouts/detail — 정산 월별 상세 (`mentor-payouts-detail`)

- 파일: `app/(mentor)/mentor/payouts/detail/page.tsx` → `components/mentor/MentorPayoutsDetailView.tsx` (`'use client'`)
- 가드: `requireRole("mentor")` · 데이터는 클라이언트에서 `GET /api/mentor/payouts/detail` fetch

| 요소 (표시 라벨) | 종류 | 소스 | 연결 동작 | 추론한 존재 목적 |
|---|---|---|---|---|
| "← 정산 요약으로" | 링크 | Link `/mentor/payouts` | 요약 화면 복귀 | 요약↔상세 2화면 구조의 되돌아가기 |
| "정산 상세" / "기간·유형별 수익 내역과 합계를 확인합니다." | 헤더 | 고정 문구 | — | 요약(미리보기 6건)에서 못 본 전량 내역 열람 화면임을 선언 |
| "엑셀 다운로드" 버튼 | 버튼 | `exportExcel()` — xlsx 동적 import | `mentor-payouts-{월}.xlsx` (마지막 행에 "합계" 추가) | 월 단위 정산 대사·증빙 반출 — 합계 행 포함이 요약 다운로드와의 차이 |
| "순수령액 합계" + 초록 대형 금액 | 합계 카드 | `totals.netAmount` — `!loading && !error` 조건부 | — | 필터 결과의 최종 수령액을 표 이전에 먼저 제시(주석: "헤더 근처로 끌어올려 먼저 보이게") |
| "기간" select (최근 12개월) | 필터 | `monthOptions()` | 변경 시 API 재조회 + page 1 리셋 | 서버측 월 필터 — month 파라미터로 전달 |
| "유형" select — "전체 / 구독 / 맞춤의뢰" | 필터 | type state | 변경 시 API 재조회 + page 1 리셋 | 수익원별 분리 열람 — IQ 옵션 없음(정산 화면 미표시 기획과 일치)⁴ |
| 에러 문구 (빨강 카드) | 조건부 알림 | `error` state — API 실패 시 | — | fetch 실패 고지, 인라인(alert 금지) |
| "불러오는 중…" | 로딩 문구 | `loading` state 조건부 | — | 클라이언트 fetch 대기 표시 |
| 정산 표 (variant="detail": "결제금액"·"순수령액" 라벨) | 테이블 `.map()` | MentorPayoutsSettlementTable — 페이지당 rows 반복 | — | 요약("총액/정산액")과 어휘를 바꿔 결제 원금 대비 수령액 관점 강조 |
| "이전 / {n} / {N} / 다음" 페이지네이션 | 페이지 이동 | 클라이언트 slice — 데스크탑 10/모바일 5 per page (`matchMedia` 보정) | page state 증감 | 전량 내역의 무한 스크롤 대신 페이지 분할 — SSR/hydration 일치 위해 초기값 데스크탑 |

---

### /mentor/reviews — 받은 리뷰 관리 (`mentor-reviews`)

- 파일: `app/(mentor)/mentor/reviews/page.tsx` → `components/mentor/MentorReviewsManage.tsx` (`'use client'`)
- 가드: `requireRole("mentor")` · 데이터: `listMentorReceivedReviews()` 서버 로드 후 initialItems 전달 (최대 50건)

| 요소 (표시 라벨) | 종류 | 소스 | 연결 동작 | 추론한 존재 목적 |
|---|---|---|---|---|
| "받은 리뷰" / "학생 리뷰에 답글은 1회만 작성할 수 있습니다." | 헤더 | 고정 문구 | — | 답글 1회 제한 정책을 진입 즉시 고지 |
| 에러 카드 (빨강) | 조건부 알림 | `error` state — 답글 저장 실패 시 | — | API 에러의 인라인 피드백 |
| 빈 상태 "아직 받은 후기가 없어요" + "학생이 동일 멘토를 2회 이상 이용하면 후기를 남길 수 있어요." | 빈 상태 | `!items.length` 조건부 | — | 리뷰 0건이 이상 상태가 아님을 설명 — 2회 결제 자격 정책을 멘토에게도 교육 |
| 리뷰 카드: 마스킹 학생명("이*연") + 별점(★ amber) + 작성일 + 학년·과목 + 본문 | 카드 `.map()` | `items` **최대 50개 반복** · `maskStudentName()`/`starIcons()` (`lib/reviews/reviewDisplay.ts`) | — | 학생 개인정보 보호(이름 마스킹) + 별점·맥락(학년·과목)으로 리뷰 신뢰도 표시 |
| "내 답글" 블록 (초록 좌측 보더) | 조건부 표시 | `item.mentorReply` 존재 시 | — | 이미 답글한 리뷰 — 폼 대신 읽기 전용, 멘토 초록 액센트 |
| 답글 textarea ("답글을 입력하세요 (1회만 작성 가능)", maxLength 500) | 폼 입력 | `mentorReply` 없을 때 조건부 | replyDraft state | 미답글 리뷰에만 작성 폼 노출 — 500자 상한은 서버 검증과 동일 |
| "답글 작성" / "저장 중…" 버튼 (초록 #059669) | 제출 버튼 | `PATCH /api/reviews/{id}/reply` | 성공 시 낙관적 갱신 + `router.refresh()` | 멘토 답글 정책의 실행 — 빈 입력이면 disabled |

---

### /mentor/support/disputes — 멘토 분쟁·환불 목록 (`mentor-disputes`)

- 파일: `app/(mentor)/mentor/support/disputes/page.tsx` (+ `loading.tsx` 스켈레톤)
- 가드: `requireRole("mentor")` · 데이터: `loadDisputesListForUser(supabase, user.id, "mentor", 40)`

| 요소 (표시 라벨) | 종류 | 소스 | 연결 동작 | 추론한 존재 목적 |
|---|---|---|---|---|
| PageScaffold eyebrow "지원 · 분쟁" / 제목 "분쟁·환불 현황" | 헤더 | PageScaffold — 01 공용 사전 참조 | — | 지원 섹션 내 위치 표시 |
| 설명 "맞춤의뢰 등으로 접수된 분쟁의 진행 상태를 상세 보기에서 확인할 수 있습니다." (모바일 축약 "접수된 분쟁의 진행 상태를 확인하세요.") | 설명 | `md:hidden` / `hidden md:inline` 조건부 | — | 화면 폭별 카피 길이 조절 |
| 상태 필터 탭 "전체 / 진행중 / 처리완료" + 건수 칩 | 탭 `.map()` | StudentDisputesFilterableList — **3개 반복** · `isResolvedStatus()` regex 분류 | filter state → 하위 리스트 리마운트(`key={filter}`, page 1 리셋) | 종결/미종결 분리 열람 — 활성 탭 색 `accent="green"`(멘토) |
| 리스트 테이블 "분쟁 유형 / 상태 / 관련 주문·결제 / 상세" | 테이블 | DisputesListView (공유) | — | 분쟁의 4대 식별 정보 한 줄 요약 |
| 분쟁 행: 유형 라벨(없으면 "유형 미지정") + 상태 배지 + 주문 요약(없으면 "연결된 주문 없음") + "상세 보기" | 테이블 행 `.map()` | `visibleRows` — 페이지당 데스크탑 10/모바일 5개 반복 | Link `/mentor/support/disputes/{id}` | 개별 사건 상세 진입 — id 없는 행은 사전 필터 |
| 상태 배지 색 (escalated=빨강 / open·under_review=amber / resolved=emerald / 기타 slate) | 상태 배지 | `badge()` regex — status free-form 방어 | — | 기획 status 5종(open/under_review/resolved/dismissed/escalated)을 색 3계열로 압축 표시 |
| "이전 / {n} · {N} / 다음" 페이지네이션 (활성 숫자 초록) | 페이지 이동 | accent green 조건부 | page state | 40건 로드분의 페이지 분할 — 역할 액센트 유지 |
| 에러 "분쟁 내역을 불러오지 못했습니다…" / 테이블 부재 "분쟁·환불 현황을 불러올 수 없습니다…" / 빈 목록 "현재 확인할 분쟁이 없습니다." | 상태별 카드 | `listError` / `!table` / `!items.length` 조건부 | — | 실패·스키마 미비·정상 0건을 서로 다른 톤으로 구분(빨강/중립/점선) |
| 로딩 스켈레톤 (제목·설명·리스트 3블록 pulse) | loading.tsx | `mentor/support/disputes/loading.tsx` | — | 서버 조회 대기 중 라우트 레벨 스켈레톤 (코딩 규칙 10) |

---

### /mentor/support/disputes/[id] — 멘토 분쟁 상세 (`mentor-dispute-detail`)

- 파일: `app/(mentor)/mentor/support/disputes/[id]/page.tsx` → `DisputeMentorPageBody` → `DisputeDetailView role="mentor"`
- 가드: `requireRole("mentor")` + `canPartyViewDispute(user.id, "mentor", row)` 당사자 검증

| 요소 (표시 라벨) | 종류 | 소스 | 연결 동작 | 추론한 존재 목적 |
|---|---|---|---|---|
| "이 사건에 대한 조회 권한이 없습니다." | 접근 차단 문구 | `row && !access.ok` 조건부 | — | RLS 외 앱 레벨 2차 당사자 검증 — 타인 사건 URL 직접 접근 차단 |
| "요청하신 분쟁 정보를 찾을 수 없습니다." / 로드 실패 문구 | 폴백 | `!row` / `loadFailed` 조건부 | — | 404성·에러성 상황의 사용자 카피 분리 |
| 상태 히어로: Gavel 아이콘 타일 + "지원 · 분쟁" 칩 + 헤드라인 "분쟁을 확인하고 있어요 / 처리가 완료됐어요 / 신청이 반려됐어요" | 히어로 카드 | `categoryOf(status)` → CAT(review/done/rejected) 3분기 | — | status 원문 대신 감정 완화형 한 문장으로 현재 국면 전달 — 의미색(주황/초록/빨강)은 역할 액센트와 분리(코드 주석 명시) |
| "접수 {단축ref} · {날짜} · 처리 완료까지 안전 보관 금액은 보호돼요" | 부제 | `shortDisputeRef()` + `created_at` | — | 접수 증빙 + 분쟁 중 정산 보류(에스크로 보호) 기획의 사용자 문구화 |
| 상태 배지 `{검토 중 등 한글 상태}` | 상태 배지 | `partyDisputeStatusKo()` | — | DB 영문 status의 한글 변환 표시 |
| "신청 내용" — 사유(없으면 "사유 미입력") / 유형(없으면 "미지정") | 정보 dl | `pickText()` 다중 키 폴백 | — | 신청 원문 재확인 — 스키마 편차(reason/description/message…)를 키 후보군으로 흡수 |
| "증빙 · 첨부" — "첨부된 증빙이 없어요." | 고정 문구 | 하드코딩 | — | 자료 제출 슬롯의 자리 표시 — 첨부 업로드·표시 로직 미연결(코드≠기획: 분쟁 자료 제출 기능은 UI 문구만 존재)⁵ |
| "처리 이력" 타임라인 — "접수됨 → 검토 중 → 처리 완료" (현재 단계 링 강조, "현재 단계" 캡션) | 스텝 `.map()` | STEPS **3개 반복** · `currentIndex` = review면 1, 종결이면 2 | — | 5종 status를 사용자용 3단계로 단순화한 진행 시각화 |
| 처리 로그 목록 "· {로그 한 줄}" (없으면 "아직 처리 이력이 없어요.") | 목록 `.map()` | `bundle.modLogs.rows` **N개 반복** · `formatModLogLine()` | — | 관리자 중재 행위의 당사자용 열람 — 원문 JSON 노출 방지 포맷 |
| "관련 주문 · 결제" — "맞춤의뢰 주문 · {상태}" + 제목 + "주문 보기 →" | 연계 카드 | `custom_request_order_id` 등 키 폴백, `orderStatusLabelForUi()` | Link `/mentor/custom-request/orders/{id}` (멘토 경로) | 분쟁의 원인 주문으로 역이동 — raw UUID 비노출(주석 명시), role별 경로 분기 |
| "연결: 결제 · 환불 · 구독" (있는 것만) | 요약 한 줄 | `bundle.payment/refund/subscription.row` 존재 여부 | — | 분쟁에 묶인 금전 레코드의 존재 표시 — "없음 나열 금지" 주석 |
| 초록(#059669) 액센트 (주문 보기 링크 등) | 스타일 | `role === "mentor"` 조건부 | — | **멘토=초록 / 학생=파랑 배색 구분** — 동일 공유 뷰에서 지금 어느 역할 화면인지 식별 (DisputeMentorPageBody 주석: "구조는 학생과 동일, 색만 다름") |

⁵ **코드≠기획 각주:** 분쟁 "자료(증빙) 제출"은 상세 화면에 제출 폼이 없고 "첨부된 증빙이 없어요." 고정 문구만 있다 — 제출 기능 미구현 상태의 자리 표시.

---

### /support/disputes — 학생 분쟁·환불 목록 (`student-disputes`)

- 파일: `app/(student)/support/disputes/page.tsx` · 가드 `requireRole("student")` · 데이터 `loadDisputesListForUser(…, "student", 40)`

| 요소 (표시 라벨) | 종류 | 소스 | 연결 동작 | 추론한 존재 목적 |
|---|---|---|---|---|
| 제목 "분쟁·환불 현황" / 설명 "맞춤의뢰 진행 중 접수한 분쟁과 처리 상태를 확인할 수 있습니다." | 헤더 | PageScaffold — 01 공용 사전 참조 | — | 멘토판과 동일 구조·다른 관점 카피(내가 "접수한" 분쟁) |
| 필터 탭·테이블·상태 배지·페이지네이션·에러/빈 상태 | 공유 컴포넌트 | StudentDisputesFilterableList + DisputesListView — 멘토 목록과 동일 (위 표 참조) | Link `/support/disputes/{id}` | 동일 공유 뷰 재사용 — `detailHrefBase`만 학생 경로 |
| 활성 탭·페이지 숫자 파랑(#2563EB) | 스타일 | `accent` 미지정 → 기본 "blue" | — | **학생=파랑 배색** — 멘토(green)와의 유일한 시각 차이로 역할 컨텍스트 표시 |

---

### /support/disputes/[id] — 학생 분쟁 상세 (`student-dispute-detail`)

- 파일: `app/(student)/support/disputes/[id]/page.tsx` (+ `loading.tsx` 스켈레톤) → `DisputePartyPageBody` → `DisputeDetailView role="student"`
- 가드: `requireRole("student")` + `canPartyViewDispute(user.id, "student", row)` (학생은 신고/원고 컬럼 기준 — lib 주석)

| 요소 (표시 라벨) | 종류 | 소스 | 연결 동작 | 추론한 존재 목적 |
|---|---|---|---|---|
| 접근 차단·미존재·로드 실패 문구 3종 | 조건부 폴백 | 멘토 상세와 동일 문구·동일 분기 | — | 당사자 검증·에러 처리 대칭 |
| 상태 히어로·신청 내용·처리 이력 타임라인·관련 주문 카드 | 공유 뷰 | DisputeDetailView role="student" — 멘토 상세 표와 동일 요소 | "주문 보기 →" Link `/custom-request/orders/{id}` (학생 경로) | 동일 정보 구조 — 주문 링크만 학생 라우트로 분기 |
| 파랑(#2563EB) 액센트 | 스타일 | `role === "student"` 조건부 | — | **학생=파랑** 역할 배색 — 상태 의미색(주황/초록/빨강)과는 분리 운용 |
| `reasonLabel="신청 사유:"` prop | 전달 인자 | DisputePartyPageBody 시그니처 | — | 하위 뷰로 전달되지 않고 소멸 — 구버전 API 잔재 (추정)⁶ |
| 로딩 스켈레톤 (제목 + 카드 2블록 pulse) | loading.tsx | `support/disputes/[id]/loading.tsx` | — | 상세 조회 대기 스켈레톤 |

⁶ **코드≠기획 각주:** `DisputePartyPageBody`는 `reasonLabel` prop을 받지만 `DisputeDetailView`에 넘기지 않는다 — 미사용 파라미터.

---

### /support/refunds — 구독 환불 신청 (`student-refunds`)

- 파일: `app/(student)/support/refunds/page.tsx` · 로그인 필수(미로그인 → `/login/student?next=…`)
- 데이터: `loadStudentSubscriptionManagementList()` → `canRequestRefund || pendingRefundId` 필터

| 요소 (표시 라벨) | 종류 | 소스 | 연결 동작 | 추론한 존재 목적 |
|---|---|---|---|---|
| 제목 "구독 환불 신청" / 설명 "잔여기간 환불을 예상 금액으로 신청하면 관리자 승인 후 처리됩니다." | 헤더 | PageScaffold — 01 공용 사전 참조 | — | "신청→관리자 승인→캐시 크레딧" 기획 플로우를 첫 문장으로 |
| dataPoints "학원법 시행령 별표4 기준 — 이용 개시 전 전액 / 기간 1/3 전 2/3 / 1/2 전 1/2 / 1/2 경과 후 환불 없음" · "환불 금액은 신청 시점에 고정되며 관리자 승인 전에는 캐시가 환불되지 않습니다." | 법정 고지 | PageScaffold dataPoints | — | 학원법 환불 비율 잠금 정책의 화면 내 법적 고지 |
| flash 성공(emerald)/실패(red) 카드 | 조건부 알림 | searchParams `ok` / `error` (server action redirect 회신) | — | 제출 결과를 리다이렉트 쿼리로 받아 인라인 표시 (alert 금지) |
| "구독 목록을 불러오지 못했습니다…" (amber) | 조건부 알림 | `subscriptionList.error` | — | 목록 로드 실패 고지 |
| 빈 상태 "환불 신청 가능한 구독이 없습니다" + "구독 현황으로 이동" 버튼 | 빈 상태 + CTA | `refundableItems.length === 0` 조건부 | Link `/subscriptions` | 환불 전 해지 선행 등 다음 행동 안내 — 대상 0건의 막다른 화면 방지 |
| 구독 카드: 멘토명 + 요금제 배지(파랑) + "현재 기간 종료일은 {날짜}입니다." | 카드 `.map()` | `refundableItems` **N개 반복** · `?subscriptionId=` 일치 시 파랑 ring 강조 | — | 환불 대상 구독 식별 — 딥링크로 특정 구독 선택 상태 표현 |
| "예상 환불액 (학원법 기준)" + 금액 + 구간 라벨 + "남은 {N}일 / 전체 {N}일" | 금액 패널 | `item.refundEstimate*` | — | 법정 비율로 산정된 예상액과 산정 근거(잔여일)를 신청 전에 공개 — 기대치 관리 |
| "이미 접수된 환불 신청이 관리자 검토 대기 중입니다." | 조건부 안내 | `item.pendingRefundId` 존재 시 (폼 대체) | — | 중복 신청 차단 — 접수 후에는 폼 대신 대기 상태 표시 |
| "신청 사유 *필수" textarea — placeholder "환불이 필요한 이유를 간단히 적어 주세요. (5자 이상)" `minLength={5}` `required` | 폼 입력 | pendingRefundId 없을 때 조건부 | — | **사유 5자 이상** 기획 규칙의 클라이언트 강제(HTML minLength) |
| 안내문 "…신청 시점의 금액으로 고정되며, 관리자가 결제·이용 내역을 확인한 뒤 승인합니다." | 폼 하단 고지 | 고정 문구 | — | 승인 전 미지급·금액 고정 정책 재고지 |
| "잔여기간 환불 신청" / "접수 중..." 제출 버튼 | FormSubmitButton | `requestSubscriptionProratedRefundAction` (server action) + hidden `subscriptionId` | 환불 신청 레코드 생성 → 관리자 큐 | 신청 접수의 실행 — pending 상태 라벨로 이중 제출 방지 |
| "환불 승인 후 캐시 원장 반영은 캐시 원장에서 확인할 수 있습니다." | 푸터 링크 | Link `/wallet/ledger` | 캐시 원장 이동 | 승인 후 캐시 크레딧의 확인 위치 안내 — 환불→원장 추적 동선 완결 |

---

### /support/reports — 신고 내역 (레거시 리다이렉트) (`student-reports-legacy`)

- 파일: `app/(student)/support/reports/page.tsx`

| 요소 (표시 라벨) | 종류 | 소스 | 연결 동작 | 추론한 존재 목적 |
|---|---|---|---|---|
| (화면 없음) `redirect("/support/disputes")` | 서버 리다이렉트 | 파일 전체 | 분쟁 목록으로 즉시 이동 | 코드 주석 원문: "'내 신고 내역 조회'는 목록 API 미연결(미완성)으로 출시에서 숨김… 북마크·구 링크 대비 분쟁 현황으로 리다이렉트." — 신고 제출 자체는 게시글·숏폼의 신고 버튼으로 유지⁷ |

⁷ **코드≠기획 각주:** 신고 내역 페이지는 기획상 존재하나 목록 API 미연결로 미완성 — 라우트는 남기고 리다이렉트로 봉인한 상태.

---

### /notifications — 알림 허브 (`notifications`)

- 파일: `app/(public)/notifications/page.tsx` (+ `loading.tsx` 스켈레톤) — (public) 그룹이지만 미로그인 시 `/login?next=/notifications` 리다이렉트
- 데이터: `loadNotificationsHub(supabase, user.id, { filter })` — read/type 컬럼 스키마 탐지형, role은 profile에서 (없으면 "student" 폴백)

| 요소 (표시 라벨) | 종류 | 소스 | 연결 동작 | 추론한 존재 목적 |
|---|---|---|---|---|
| 제목 "알림" / 설명 "받은 알림을 확인하고, 관련 화면으로 이동할 수 있습니다." | 헤더 | PageScaffold — 01 공용 사전 참조 | — | 알림 = 열람 + 딥링크 이동 허브임을 선언 |
| "안 읽음 {N}건" (파랑 숫자) / "모두 확인했어요" | 카운트 | NotificationsHubView — `isNotificationReadRow()` 집계 조건부 | — | 미확인 규모의 즉시 파악 — 0건이면 안심 카피로 전환 |
| 필터 탭 "전체 / 읽지 않음" | 링크 탭 | NotificationFilterTabs | Link `/notifications` / `/notifications?filter=unread` (URL 상태) | 읽음 처리 워크플로 — URL 쿼리라 새로고침·공유에도 유지 |
| "읽지 않음 필터는 아직 모든 환경에서 지원되지 않을 수 있어요." | 조건부 경고 | `hub.unreadFilterBlocked` — read 컬럼 부재 시 | — | 스키마 편차 환경에서 기능 한계 고지 |
| "읽지 않은 알림만 모아 보여 드리고 있어요." | 조건부 안내 | `unreadUsedMemoryFilter && filter==="unread"` | — | DB 필터 대신 메모리 필터로 동작 중임을 부드럽게 표시 |
| 카테고리 칩 "전체 + (질문방/구독·결제/맞춤의뢰/환불/공지 중 실존 카테고리만)" | 탭 `.map()` | NotificationList — `notificationTypeMeta().label` 분류, **현재 rows에 존재하는 것만 반복** | category state + page 1 리셋 | type이 free-form이어도 카드 배지와 동일 분류로 2차 필터 — 매핑 불명 시 탭 자동 미노출(깨짐 방지 주석) |
| 알림 카드: 종류별 아이콘 칩 + 종류 배지 + 파랑 점(안 읽음) + 상대 시각 + 제목 2줄 클램프 | 카드 `.map()` | NotificationItemCard — 페이지당 데스크탑 10/모바일 5개 반복 · `notificationTypeMeta()` regex 매칭(환불→amber, 분쟁·신고→red, 질문방·리뷰·맞춤의뢰→blue, 공지→amber, 구독·결제→slate) | — | free-form type을 라벨·색·아이콘으로 정규화 — 읽음 항목은 저채도·연회색 배경으로 시각 강등 |
| 카드 본문 Link (제목 영역 전체) | 딥링크 | `resolveNotificationHref(row, role, type)` (`lib/notifications/notificationDeepLink.ts`) | 예: question_answered → 학생 `/question-room/{roomId}?thread=…` · 멘토 `/mentor/question-room/{roomId}…`, new_application → 지원 대기 화면, new_order_message → 주문 화면 | **role별 딥링크** 기획의 구현 — row의 내부 경로 우선, 없으면 type+id 휴리스틱, 외부 URL은 차단(안전성) |
| "읽음" 버튼 (안 읽은 항목에만) | 폼 버튼 | `markNotificationReadFormAction` (server action) — `hub.readColumn && !read` 조건부 | 수신자 본인 확인 후 read 컬럼 update | 개별 읽음 처리 — "본인 알림만 읽음 처리" title로 권한 범위 명시 |
| "이전 / {n} · {N} / 다음" 페이지네이션 (활성 파랑) | 페이지 이동 | 클라이언트 slice · rows 변경 시 1페이지 리셋 | page state | 누적 알림의 페이지 분할 |
| 빈 상태 A "새 알림이 없어요" + 종류 힌트 칩 5개(질문방·구독·결제·맞춤의뢰·환불·공지) | 빈 상태 `.map()` | NotificationEmptyState — 전체 탭 0건, TYPE_HINTS **5개 반복** | — | 첫 방문·0건 상태에서 "여기로 어떤 소식이 오는지" 기대치 형성 |
| 빈 상태 B "모든 알림을 확인했어요" (초록 CheckCheck) | 빈 상태 | 읽지 않음 탭 0건 조건부 | — | 미확인 0건을 성취 상태로 표현 |
| 빈 상태 C "읽지 않음 필터를 아직 쓸 수 없어요" / D "알림을 불러오지 못했습니다" | 빈 상태 | `unreadFilterBlocked` / `hadTableError` 조건부 | — | 기능 미지원과 장애를 정상 0건과 구분 |
| 로딩 스켈레톤 (제목·탭·카드 2개 pulse) | loading.tsx | `notifications/loading.tsx` | — | 허브 조회 대기 스켈레톤 |

**미사용 잔존 컴포넌트:**

| 요소 (표시 라벨) | 종류 | 소스 | 연결 동작 | 추론한 존재 목적 |
|---|---|---|---|---|
| NotificationSettingsPanel — "알림 설정" + 채널 4행(질문방/맞춤의뢰/커뮤니티/정산·결제) 토글(disabled) | 미사용 컴포넌트 | `components/notifications/NotificationSettingsPanel.tsx` (app 내 import 0건) | — | 자체 문구 원문: "채널별 on/off를 저장하는 API가 아직 연결되어 있지 않습니다." — 설정 백엔드 대기 중인 자리 표시 UI⁸ |

⁸ **코드≠기획 각주:** 알림 채널 on/off 설정은 컴포넌트만 존재하고 화면 연결·저장 API 모두 미구현.

---

### API — 멘토 정산 3종 (`api-mentor-payouts`)

공통 가드: `requireMentorApiSession()` (`lib/mentor/mentorPayoutsApiAuth.ts`) — 미로그인 401 "로그인이 필요합니다." / 비멘토 403 "멘토 계정만 이용할 수 있습니다."

| 요소 (표시 라벨) | 종류 | 소스 | 연결 동작 | 추론한 존재 목적 |
|---|---|---|---|---|
| `GET /api/mentor/payouts/summary` | API 라우트 | `app/api/mentor/payouts/summary/route.ts` → `loadMentorPayoutSummary()` | `{ ok, summary }` — 이번 달 수익·예상 정산·수익원별 합·계좌 표시값 | 정산 요약 수치의 클라이언트 재조회 창구 — 실패 시 "수익 요약을 불러오지 못했습니다." |
| `GET /api/mentor/payouts/monthly` | API 라우트 | `app/api/mentor/payouts/monthly/route.ts` → `loadMentorPayoutMonthlyCards(…, 6)` | `{ ok, months }` — 최근 6개월 카드 | 월간 추이 차트의 데이터 소스 — 실패 시 "월별 내역을 불러오지 못했습니다." |
| `GET /api/mentor/payouts/detail?month=&type=` | API 라우트 | `app/api/mentor/payouts/detail/route.ts` → `loadMentorPayoutDetail()` | `{ ok, lines, totals }` — 월·유형(subscription/custom_request/all) 필터 + 결제금액·수수료·순수령액 합계 | `/mentor/payouts/detail` 화면의 유일한 데이터 소스 — type 파라미터에 IQ 없음(정산 화면 미표시)⁴ |

### API — 리뷰 4종 (`api-reviews`)

| 요소 (표시 라벨) | 종류 | 소스 | 연결 동작 | 추론한 존재 목적 |
|---|---|---|---|---|
| `GET /api/reviews?mentorId=&page=&limit=` | API 라우트 (공개) | `app/api/reviews/route.ts` → `listMentorReviews()` | `{ ok, items, total, avgRating, distribution }` | 멘토 상세의 리뷰 목록·평점 분포 페이지네이션 조회 — mentorId 누락 시 400 |
| `POST /api/reviews` | API 라우트 (학생 전용) | 같은 파일 → `createReview()` | 자격 재검증(`checkReviewEligibility` — 동일 멘토 결제 성공 2회) → 별점 1~5·본문 20~500자 검증 → 연락처 마스킹 후 insert, unique 위반 시 "이미 리뷰를 작성했습니다." | **2회 결제 자격 + 1인 1리뷰의 서버측 강제** — 클라이언트 배너와 별개로 API에서 자격을 다시 검사(앱 계층 2중), DB unique 제약이 최종 방어(앱+DB 2중 강제) |
| `GET /api/reviews/eligibility?mentorId=` | API 라우트 | `app/api/reviews/eligibility/route.ts` → `checkReviewEligibility()` (`MIN_PAID_SUBSCRIPTION_COUNT = 2`, billing events 성공 상태 집계) | `{ ok, eligible, reason }` — 비학생은 eligible:false + "학생만 리뷰를 작성할 수 있습니다." | 리뷰 작성 버튼 활성화 판정 — 체리피킹 방지 정책을 UI 진입 전에 미리 판정 |
| `PATCH /api/reviews/[id]/reply` | API 라우트 (멘토 전용) | `app/api/reviews/[id]/reply/route.ts` → `replyToReview()` | 본인 리뷰 검증("본인에게 달린 리뷰에만 답글할 수 있습니다.") + 기존 답글 존재 시 "답글은 1회만 작성할 수 있습니다." → `mentor_reply`/`mentor_replied_at` update | 멘토 답글 정책의 서버 강제 — 1회 제한·소유권 검증 |
| `PATCH /api/reviews/[id]/hide` | API 라우트 (관리자 전용) | `app/api/reviews/[id]/hide/route.ts` → `hideReview()` — `is_hidden` + `moderation_state`(hidden/visible) 갱신 | `{ ok, hidden }` — 비관리자 403 "관리자만 숨김 처리할 수 있습니다." | 관리자 리뷰 숨김(검수) 정책의 실행 API — 호출 UI는 관리자 콘솔(10번 담당) |

---

## 컴포넌트·lib 비고 (담당 범위 내 전수)

| 항목 | 상태 | 비고 |
|---|---|---|
| `components/reviews/ReviewWriteModal.tsx` | 사용 중 — `components/mentor/PublicMentorDetailBody.tsx`(멘토 상세) | "리뷰 작성하기" 버튼(자격 미달 시 disabled + 사유 툴팁) → 모달: "{멘토명} 멘토 리뷰" · "작성 후 수정할 수 없습니다." · 별점 StarPicker(1~5, "별점 (필수)") · "리뷰 내용 (20~500자)" textarea(글자수 카운터, 20자 미만 제출 disabled) · "리뷰 제출" → `POST /api/reviews` → `reviews-updated` 이벤트 발행. 파랑(#2563EB) — 학생 액션 배색 |
| `components/reviews/ReviewEligibilityBanner.tsx` | 사용 중 — 멘토 상세 | 3상태 배너: 자격 미확인(amber, "동일 멘토에 대해 2회 이상 결제 성공한 경우에만…") / 자격 없음(slate, "같은 멘토에게 2회 이상 결제한 학생만 후기를 남길 수 있어요.") / 충족(emerald) — 체리피킹 방지 정책의 사전 고지 |
| `components/reviews/ReviewWritePanel.tsx` | **미사용** | 비활성 폼 자리 표시("백엔드 저장 액션이 연결되면 제출할 수 있어요.") — 모달 방식 채택 전 구버전 (추정) |
| `components/reviews/ReviewReportButton.tsx` | **미사용** | "신고 접수 (비활성화)" 고정 disabled 버튼 — 리뷰 신고 기능의 자리 표시 (추정)⁹ |
| `components/disputes/AdminDisputesListView.tsx` · `DisputeAdminPageBody.tsx` · `DisputeEscrowSplitPanel.tsx` · `DisputeKeyValueList.tsx` | 관리자 콘솔 전용 | **10번 리포트 담당** — 본 리포트 제외 |
| `lib/mentor/mentorPayoutsService.ts` / `mentorPayoutsQueries.ts` | 사용 중 | 구독 정산 라인(`subscription_settlement_items`) + 맞춤의뢰 정산 라인 결합·월별 합산. RLS 세션 실패 시에만 service_role 재시도(mentor_id 동일 조건, 주석 명시) |
| `lib/mentor/mentorPayoutsDisplay.ts` | 사용 중 | `resolvePlatformFeeRate()` — "DB fee_rate가 잘못 저장된 경우(예: 0.1) 유형별 잠금값으로 보정" — 수수료 잠금값(15/5%)의 표시 계층 방어 |
| `lib/mentor/subscriptionSettlementItems.ts` | 사용 중 | status pending/paid/hold/canceled, minor cents→캐시 변환, best-effort refresh RPC — 후불 배치 브랜치와 공유되는 정산 아이템 테이블 접근층 |
| `lib/reviews/reviewRowMapper.ts` | 사용 중 | `isPubliclyVisibleReview()` — "공개 목록용 필터 (RLS와 동일 기준)" — 숨김 리뷰의 앱 계층 이중 차단 |
| `lib/disputes/disputeDataModel.ts` | 사용 중 | 분쟁 목록/상세 하단 안내 문구 상수 |
| `lib/notifications/notificationInsert.ts` | 사용 중 (발행측) | `insertNotificationBestEffort()` — 질문답변·지원·주문메시지·구독 등 per-event 발행의 공용 삽입기, 실패해도 본 트랜잭션 미차단(best-effort) |

⁹ **코드≠기획 각주:** 리뷰 신고는 버튼 컴포넌트만 있고 접수 API·연결 화면이 없다.

---

## 커버 라우트 (검증용 전수 목록)

route-inventory.txt 기준, 본 리포트가 커버한 파일 20개:

```
app/(mentor)/mentor/payouts/page.tsx
app/(mentor)/mentor/payouts/detail/page.tsx
app/(mentor)/mentor/reviews/page.tsx
app/(mentor)/mentor/support/disputes/page.tsx
app/(mentor)/mentor/support/disputes/loading.tsx
app/(mentor)/mentor/support/disputes/[id]/page.tsx
app/(student)/support/disputes/page.tsx
app/(student)/support/disputes/[id]/page.tsx
app/(student)/support/disputes/[id]/loading.tsx
app/(student)/support/refunds/page.tsx
app/(student)/support/reports/page.tsx          ← 레거시 redirect
app/(public)/notifications/page.tsx
app/(public)/notifications/loading.tsx
app/api/mentor/payouts/summary/route.ts
app/api/mentor/payouts/monthly/route.ts
app/api/mentor/payouts/detail/route.ts
app/api/reviews/route.ts                        ← GET·POST
app/api/reviews/eligibility/route.ts
app/api/reviews/[id]/reply/route.ts
app/api/reviews/[id]/hide/route.ts
```

타 리포트 위임: `app/(admin)/admin/(console)/disputes/**`·`refunds/**`·`refunds-settlement`·`reports/**`·`reviews/**` → 10번. `app/(public)/custom-request/orders/[orderId]/review/**`(주문 상호 평가)·`app/(mentor)/mentor/custom-request/orders/[orderId]/waiting-review/**` → 맞춤의뢰 담당 리포트. `app/(public)/support/page.tsx`(지원 허브)·`legal/refund`·`legal/payout-guide` → 공개/법적 고지 담당 리포트.
