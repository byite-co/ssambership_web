# 시간대 전수 감사 보고서 — 모든 시간 코드의 기준(KST/UTC) 판정

> **지시서**: TZ-AUDIT v1 (2026-08-29) · **성격**: 읽기 전용 감사 — 코드·SQL·설정·DB 무수정  
> **대상**: `ssambership_web` main 전체(app·components·lib·e2e·scripts) + `supabase/sql`·`supabase/baseline`·`supabase/migrations`·`vercel.json` + 라이브 DB(staging `lbeqxarxothkmzqvpudy`) 읽기 전용 조회  
> **감사일**: 2026-08-29

---

## 1. 요약

- **수집·판정한 경계**: 총 **221건** (웹 TS/TSX 137건 · DB/SQL 54건 · 보강 감사 30건). 20개 감사 범위로 분할해 수집했다.
- **1차 판정 분포**: 버그 54 · 모호 18 · 정상 106 · 제외(순수 상대 간격) 43
- **검증 후 최종 발견**: **버그 37건** (S1 **1** · S2 **16** · S3 **20**), 모호 2건, 규범 이의 3건
- 1차 발견 59건을 36건으로 병합한 뒤 **전건 적대적 검증**(인용 전수 대조 + 반박 가설 최소 2개)을 거쳤다: 확정 14 · 조정 15 · 모호→확정 7. 검증 과정에서 **3건이 정상으로 반증**되어 표에서 빠졌고, 인용 정확도는 36건 중 35건 OK·1건 교정이었다.

### 핵심 결론

1. **촉발 건(공지 노출기간)은 단일 사고가 아니라 4개 유형의 대표 사례였다.** 같은 뿌리(무오프셋 문자열의 UTC 해석·서버 UTC 달력·timeZone 미지정 포매터·UTC 달력 월/일 산술)에서 37건이 나왔다.
2. **유일한 S1은 촉발 건이 아니라 구독 기간 산출이다.** `timestamptz + interval '1 month'`가 세션 TZ(UTC) 달력으로 계산돼, KST 00~09시 결제 구독은 같은 날 09시 이후 결제보다 이용기간이 최대 3일 짧다(2026-03-01 02:00 KST 결제 = 28일 / 09:00 결제 = 31일). 이 기간이 학원법 별표4 환불 브래킷의 분모이므로 **실제 환불액과 제공 질문 수까지 갈린다**.
3. **표시 계층 결함이 가장 많다(20/37).** 대부분 `timeZone: 'Asia/Seoul'`이 빠진 3줄짜리 사본 포매터로, KST 고정 유틸 1~2본을 신설해 일괄 치환하면 파일 수(약 25개)에 비해 리뷰 부담이 작다.
4. **저장 계층은 규범을 지키고 있다.** 앱 스키마에 `timestamp without time zone` 컬럼은 0건이며(전 22건이 Supabase 관리 스키마), 라이브 DB `TimeZone=UTC`가 확정이다. 정산 cutoff 등 핵심 월 경계는 이미 `at time zone 'Asia/Seoul'`로 KST 기준이 잡혀 있다.

## 2. 버그 표 (심각도순)

> 심각도: **S1** 돈·법·발송 영향 · **S2** 사용자 가시 오동작 · **S3** 표기 불일치·관리 화면 한정  
> 「현재」는 실제 동작 기준, 「의도」는 화면 문구·도메인 맥락상 있어야 할 기준이다.

| # | 심각도 | 경계 | 근거 (파일:라인) | 현재 | 의도 | 증상 | 권고 수정 | 파일 |
|---|:--:|---|---|---|---|---|---|:--:|
| 1 | **S1** | 구독 +1개월 기간 산출 (체크아웃·갱신 RPC·TS 폴백) | `live:public.confirm_subscription_checkout`<br>`supabase/sql/131_p1_13_subscription_checkout_atomic.sql:93`<br>`supabase/sql/068_subscription_renewal_rpc.sql:119`<br>`lib/subscribe/subscriptionsTable.ts:56` | UTC(세션 달력) | KST 달력 | KST 00~09시 결제분을 UTC 달력으로 +1개월 — 3/1 02:00 결제는 28일, 같은 날 09:00 결제는 31일. 환불액·주간 질문 한도까지 갈림 | SQL은 (ts at time zone 'Asia/Seoul' + 1 month) 환산으로, TS addMonthsClampedUtc는 KST 달력 산술로 교체 | 3 |
| 2 | **S2** | 공지·프로모션 노출기간 입력→저장 | `lib/admin/adminNoticesMutations.ts:6`<br>`lib/admin/adminNoticesActions.ts:27`<br>`components/admin/AdminNoticesFormSkeleton.tsx:57`<br>`supabase/sql/031_p1_admin_notices_promotions.sql:31` | UTC(무변환 저장) | KST | 관리자가 KST 벽시계로 고른 노출 시작·종료가 무변환 UTC 저장 — 공개 /notices 노출창이 9시간 늦게 열리고 늦게 닫힘 | toTimestamptzOrNull에서 datetime-local 문자열에 +09:00 부여 후 저장 — 목록 표시 항목과 동시 배포 | 1 |
| 3 | **S2** | 캐시 원장 '직접설정' 기간 필터 | `lib/cash/cashQueries.ts:76`<br>`lib/cash/cashQueries.ts:87`<br>`components/cash/WalletLedgerPageBody.tsx:102`<br>`components/cash/WalletLedgerPageBody.tsx:103` | UTC+브라우저로컬 | KST 달력 | '직접설정' 조회에서 시작일 KST 00:00~08:59 내역이 항상 누락 — 서버 gte·클라이언트 재필터가 모두 UTC 자정 경계 | 서버 질의·클라 재필터 경계를 T00:00:00+09:00 / T23:59:59.999+09:00로 오프셋 명시 | 2 |
| 4 | **S2** | 구 정산 로더 월 귀속·허브 월 라벨 | `lib/mentor/mentorPayoutsService.ts:62`<br>`lib/mentor/mentorPayoutsService.ts:72`<br>`lib/mentor/dashboard/mentorHubDashboardQueries.ts:252`<br>`lib/mentor/mentorSettlementService.ts:88` | 서버로컬(UTC) | KST 달력월 | 멘토 마이페이지 '이번 달 수익'(구 로더)이 UTC 월 귀속 — KST 1일 새벽 정산이 전월로 빠지고 /mentor/payouts와 숫자 불일치 | ymKey/currentYm/inYm·hub monthLabel·마이페이지 monthKey를 kstYearMonth로 교체 | 3 |
| 5 | **S2** | 멘토 마이페이지 월별 수익 차트 월 버킷 | `app/(mentor)/mentor/mypage/page.tsx:53`<br>`app/(mentor)/mentor/mypage/page.tsx:71`<br>`app/(mentor)/mentor/mypage/page.tsx:82`<br>`app/(mentor)/mentor/mypage/page.tsx:283` | 서버로컬(UTC) | KST 달력월 | cash_ledger를 UTC 월로 버킷·조회 — KST 1일 새벽 인입이 전월로 귀속되고 5개월 창 첫 달 첫 9시간은 아예 소실 | monthKey·버킷 시드·gte 하한을 kstYearMonth·listRecentYearMonths·kstMonthBounds로 교체 | 1 |
| 6 | **S2** | 맞춤의뢰 대시보드 '이번 달 수익' monthBounds | `lib/mentor/mentorPayoutsQueries.ts:173`<br>`lib/mentor/mentorPayoutsQueries.ts:175`<br>`app/(mentor)/mentor/custom-request/dashboard/page.tsx:54`<br>`components/customRequest/MentorCustomRequestDashboardView.tsx:194` | 서버로컬(UTC) | KST 달력월 | monthBounds()의 UTC 월 경계로 정산 행을 걸러 KST 1일 00:00~08:59 생성 행이 전월로 귀속됨 | monthBounds()를 kstMonthBounds(kstYearMonth(now)) 기반 +09:00 경계로 교체 | 1 |
| 7 | **S2** | 충전 페이지 '이번 달 사용 요약' 월 경계 | `components/cash/WalletChargeRightSidebar.tsx:12`<br>`components/cash/WalletChargeRightSidebar.tsx:22`<br>`app/(student)/wallet/charge/page.tsx:11` | 서버로컬(UTC) | KST 달력월 | 학생 노출 /wallet/charge 요약이 UTC 월초 경계로 집계 — 매월 1일 KST 새벽 차감분이 월 내내 누락 | monthStart를 KST 달력 월초(epoch+9h 산술 후 instant 환산)로 계산 | 1 |
| 8 | **S2** | 멘토 개별질문 '이번 달 완료' 월 집계 | `app/(mentor)/mentor/individual-questions/page.tsx:51`<br>`components/individualQuestion/IndividualQuestionViews.tsx:71` | 서버로컬(UTC) | KST 달력월 | '이번 달 완료'가 UTC 월로 집계 — KST 1일 00:00~08:59 released 건은 영구히 전월로 빠짐 | released_at·now를 Asia/Seoul YYYY-MM 문자열(또는 epoch+9h 연·월)로 비교 | 1 |
| 9 | **S2** | 캐시 원장 일시 표시 formatKoDateTime | `lib/cash/ledgerRowDisplay.ts:34`<br>`components/cash/WalletChargeRecentSummary.tsx:79`<br>`app/(student)/mypage/page.tsx:100`<br>`components/cash/WalletLedgerPageBody.tsx:302` | UTC(서버렌더) | KST 고정 | timeZone 미지정 Intl로 서버 UTC 표기 — /wallet/charge·/mypage 최근 내역이 항상 9시간 이르게 고정됨 | formatKoDateTime의 Intl 옵션에 timeZone: 'Asia/Seoul' 추가 | 1 |
| 10 | **S2** | 알림함 수신 시각 렌더 | `lib/notifications/notificationRowDisplay.ts:31`<br>`components/notifications/NotificationItemCard.tsx:67`<br>`components/mypage/StudentDashboardShell.tsx:43` | UTC(서버렌더) | KST 고정 | /notifications 수신 시각이 timeZone 미지정 toLocaleString으로 서버 UTC 렌더 — KST 새벽 알림은 날짜도 전날 | formatNotificationTime의 toLocaleString에 timeZone: 'Asia/Seoul' 지정 | 1 |
| 11 | **S2** | 관리자 콘솔 서버 렌더 일시 (Intl timeZone 미지정 그룹) | `app/(admin)/admin/(console)/settlements/page.tsx:34`<br>`app/(admin)/admin/(console)/users/page.tsx:22`<br>`app/(admin)/admin/(console)/mentor-activity/page.tsx:13`<br>`lib/disputes/disputeListQueries.ts:169` | UTC(서버렌더) | KST 고정 | 가입일·환불 요청일·정산 지급일·멘토활동 이벤트·분쟁 접수일이 서버 UTC 렌더 — KST 새벽 건은 날짜도 전날 | KST 고정 시각 유틸 신설 후 사본 포매터 일괄 교체(과도기엔 timeZone:'Asia/Seoul' 추가) | 17 |
| 12 | **S2** | 커뮤니티 글·숏폼·댓글 작성일 폴백 라벨 | `lib/community/communityShortformQueries.ts:65`<br>`lib/community/communityBoardQueries.ts:138`<br>`lib/community/communityQueries.ts:347`<br>`lib/community/communityQueries.ts:268` | UTC(서버렌더) | KST 고정 | 커뮤니티 홈·게시판·숏폼·댓글·「내 활동」 작성일이 서버 UTC 달력 — KST 00~09시 작성분이 하루 전 날짜 | 세 폴백 포매터에 timeZone:'Asia/Seoul' 지정 또는 formatKoreanDate()로 통일 | 3 |
| 13 | **S2** | 계정 정지 차단 메시지 해제일 (formatUntil) | `lib/auth/accountStatus.ts:54`<br>`lib/auth/accountStatus.ts:70`<br>`lib/admin/accountStatusCore.ts:21`<br>`lib/individualQuestion/individualQuestionActions.ts:156` | 서버로컬(UTC) | KST | 정지 해제일을 서버 로컬(UTC) 달력으로 찍어 KST 00:00~08:59 해제 건은 학생·멘토에게 하루 이른 날짜로 안내 | formatUntil을 formatKoreanDate(epoch+9h)로 교체(null 반환 동작은 유지) | 1 |
| 14 | **S2** | 멘토 활동종료·휴식 알림 본문 날짜 (SQL) | `live:public.mp_notify_activity_transition`<br>`supabase/sql/158_p1_11_mentor_notification_atomization.sql:32`<br>`supabase/sql/158_p1_11_mentor_notification_atomization.sql:49`<br>`supabase/sql/158_p1_11_mentor_notification_atomization.sql:58` | UTC(SQL 명시) | KST | 알림 본문 날짜가 at time zone 'UTC'로 박제 — KST 새벽 신청 건은 학생 push·알림함 본문이 하루 이른 날짜 | 본문 날짜를 157 정본 notification_date_label(KST)로 교체, 멱등 키 날짜는 별도 변수로 분리 | 2 |
| 15 | **S2** | 가입 만 14세 판정 '오늘' (클라이언트 게이트) | `lib/auth/minorAgeGate.ts:27`<br>`app/signup/page.tsx:295`<br>`lib/auth/buildSignupUserMetadata.ts:45`<br>`lib/identity/age.ts:42` | 브라우저 로컬 | KST 달력 | '오늘'을 브라우저 로컬 달력으로 산출 — 해외·TZ 오설정 기기에서 동의원장 is_minor 각인값이 KST와 하루 어긋남 | minorAgeGate.todayParts()를 정본 kstTodayParts(lib/identity/age.ts)로 교체 | 2 |
| 16 | **S2** | 멘토 일반휴식 6개월 게이트 — UTC 달력 월 산술 | `lib/mentor/mentorActivity.ts:52`<br>`lib/mentor/mentorActivity.ts:53`<br>`lib/mentor/mentorActivityService.ts:242`<br>`lib/mentor/mentorActivityActions.ts:46` | 서버로컬(UTC) | KST 달력 | 6개월 빈도 게이트가 서버 로컬(UTC) 달력으로 월 산술 — KST 00~09시 신청 시 기준선이 ±1일 어긋나 오차단·오허용 | epoch+9h로 KST 벽시계 분해 후 월 감산·말일 clamp·−9h 복원(setMonth 사용 금지) | 1 |
| 17 | **S2** | 멘토 휴식 게이트 — setMonth 월말 오버플로 | `lib/mentor/mentorActivity.ts:53`<br>`lib/mentor/mentorActivity.ts:54`<br>`lib/mentor/mentorActivity.ts:8`<br>`supabase/sql/103_mentor_activity_suspension.sql:26` | UTC+setMonth이월 | KST+말일clamp | setMonth가 없는 일자를 다음 달로 이월해 기준선이 최대 3일 미래로 밀림 — 6개월 미만인데 2회차 휴식 승인(시각 무관) | 월 감산 후 Math.min(원 일자, 대상 월 말일)로 clamp — 앞 항목과 한 함수에서 동시 수정 | 1 |
| 18 | **S3** | 신고·분쟁 목록 날짜 필터 재파싱 | `components/admin/AdminDisputesWorkspace.tsx:74`<br>`components/admin/AdminDisputesWorkspace.tsx:76`<br>`lib/disputes/disputeListQueries.ts:189`<br>`lib/disputes/disputeListQueries.ts:169` | 혼합(재파싱 실패) | KST 달력일 | 시작일/종료일 필터를 지정하면 포맷된 문자열 재파싱이 항상 Invalid Date가 되어 전 행이 필터 아웃됨 | createdAtIso 원본 필드를 추가해 ISO 비교 + KST 자정(+09:00) 경계로 판정 | 2 |
| 19 | **S3** | 관리자 대시보드 '오늘'·'어제'·7일 추이 | `lib/admin/adminDashboardExtended.ts:83`<br>`lib/admin/adminDashboardExtended.ts:56`<br>`lib/admin/adminDashboardExtended.ts:37` | 서버로컬(UTC) | KST 달력일 | 일 창·추이 라벨이 UTC 일 경계로 집계 — KST 0~9시 실적이 전날로 귀속되고 오전엔 '오늘'이 전날 창을 표시 | 일 창 산출을 KST 고정 산술(epoch+9h 자정 절단 후 −9h)로 바꾸고 dayKey도 KST 날짜로 | 1 |
| 20 | **S3** | 멘토 대시보드 KPI '오늘 신규 의뢰' | `lib/mentor/dashboard/mentorHubDashboardQueries.ts:61`<br>`lib/mentor/dashboard/mentorHubDashboardQueries.ts:237`<br>`components/mentor/dashboard/MentorDashboardKpiCards.tsx:10` | UTC(서버) | KST 달력일 | 서버 UTC 달력일로 집계돼 KST 00:00~08:59 등록분이 '오늘'에서 누락 — 표시 카드가 orphan이라 현재는 잠복 | isCreatedToday를 KST 달력 비교(epoch+9h → YYYY-MM-DD)로 교체 | 1 |
| 21 | **S3** | 마감 D-day '오늘' 산출 (사본 3곳) | `lib/customRequest/mentorCustomOrderBrowseDisplay.ts:66`<br>`lib/customRequest/studentPostDisplay.ts:65`<br>`lib/mentor/dashboard/mentorHubDashboardDisplay.ts:40`<br>`components/customRequest/CustomRequestStudentPostsList.tsx:113` | UTC(서버 자정) | KST 달력일 | '오늘'을 UTC 자정으로 절단 — KST 0~9시 동안 D-day가 하루 더 남고 '마감 초과' 배지는 하루 늦게 잡힘 | today/deadline 절단을 epoch+9h KST 달력일 diff 공용 유틸로 교체(사본 3곳 통합) | 4 |
| 22 | **S3** | 주문 완료·작업방 일시 (formatOrderRoomDateTime) | `lib/customRequest/orderLifecycleConstants.ts:455`<br>`app/(student)/custom-request/orders/[orderId]/complete/page.tsx:119`<br>`components/customRequest/order/OrderEventsLogPanel.tsx:109`<br>`components/customRequest/OrderRoomView.tsx:384` | UTC/브라우저로컬 | KST | 로컬 getter라 /complete의 완료·결제 일시가 UTC로 굳고, 주문방은 SSR 초기 HTML만 UTC로 찍혀 하이드레이션 불일치 | formatOrderRoomDate/DateTime을 KST 고정 포맷(epoch+9h 또는 Asia/Seoul)으로 교체 | 1 |
| 23 | **S3** | 멘토 활동 상태 복귀·종료 예정일 표기 | `components/mentor/mypage/MentorActivityControls.tsx:16`<br>`components/mentor/mypage/MentorActivityControls.tsx:44`<br>`components/mentor/mypage/MentorActivityControls.tsx:113`<br>`app/(mentor)/mentor/mypage/page.tsx:195` | 서버로컬(UTC) | KST | '활동 관리' 카드의 복귀 예정일·종료 정리 예정일이 서버 UTC 달력 — KST 새벽 신청 건은 하루 이르게 표시 | 로컬 fmt() 제거 후 formatKoreanDate()로 4개 호출부(44·46·113·127행) 교체 | 1 |
| 24 | **S3** | 학생 주문 목록·멘토 의뢰 카드 등록일 | `lib/customRequest/orderLifecycleConstants.ts:435`<br>`lib/customRequest/mentorCustomRequestDisplay.ts:49`<br>`lib/customRequest/studentCustomRequestOrdersQueries.ts:242`<br>`components/customRequest/MentorCustomRequestDetailCard.tsx:42` | UTC(서버렌더) | KST 달력일 | 등록일이 서버 UTC 로컬 getter로 문자열 확정 — KST 00:00~08:59 생성 건이 하루 이른 날짜로 표시(클라 보정 없음) | formatOrderRoomDate·formatDateYMDOrDash를 formatKoreanDate 산술로 교체 | 2 |
| 25 | **S3** | 가입 만 14세 폴백 판정 current_date (SQL) | `supabase/sql/087_user_consent_records.sql:87`<br>`live:public.handle_new_auth_user_consent_records`<br>`lib/auth/buildSignupUserMetadata.ts:45`<br>`lib/identity/age.ts:63` | UTC(current_date) | KST 달력 | 동의원장 트리거의 만14세 폴백이 current_date(UTC 달력) — 웹 경로가 is_minor를 항상 채워 현재 도달 불가한 잠재 결함 | current_date를 (now() at time zone 'Asia/Seoul')::date로 교체(함수 replace 마이그레이션) | 1 |
| 26 | **S3** | 지급 배치 cutoff — 저장소 구본 UTC 원문 잔존 | `supabase/sql/153_p2_25_pay_due_payouts_convergence.sql:50`<br>`supabase/sql/156_p2_25_payout_scheduler_foundation.sql:32`<br>`supabase/migrations/20260827100200_withholding_cash_unit_and_mentor_settlement_rpc.sql:42`<br>`live:public.pay_due_payouts_for_run` | UTC(저장소 원문) | KST 월말 | 라이브 cutoff는 KST 패치됐으나 저장소 153·156은 UTC 원문 — 재적용하면 정산 마감이 9시간 무음 역행 | 153·156 머리에 '재적용 금지' 경고 주석 + INDEX.md에 20260805170000 이후 31본 미반영 명시 | 3 |
| 27 | **S3** | 공지·프로모션 목록 노출기간·생성일 표시 | `lib/admin/adminNoticesQueries.ts:36`<br>`lib/admin/adminNoticesQueries.ts:106`<br>`components/admin/AdminNoticesList.tsx:61`<br>`app/(admin)/admin/(console)/notices/page.tsx:17` | UTC(ISO slice) | KST | 생성일이 ISO slice(0,16) UTC 절단으로 9시간 이르게 표시되고, 노출기간 열은 저장 버그와 상쇄돼 오류를 은폐 | formatTs를 KST 고정 포매터로 교체 — 저장 수정(2번)과 반드시 동시 배포 | 1 |
| 28 | **S3** | 구독 정산 기간 period_start~end slice(0,10) | `lib/admin/adminQueries.ts:963`<br>`lib/admin/adminQueries.ts:964`<br>`lib/mentor/subscriptionSettlementItems.ts:82`<br>`app/(admin)/admin/(console)/settlements/page.tsx:83` | UTC(ISO slice) | KST 달력일 | 관리자 정산 툴팁의 구독 기간을 timestamptz 앞 10자로 잘라 UTC 날짜 표기 — KST 새벽 결제 건은 하루 이름 | period_start/end의 slice(0,10)을 formatKoreanDate/formatKstMonthDay로 교체 | 2 |
| 29 | **S3** | 관리자 정산 툴팁 completed_at slice(0,19) | `lib/admin/adminQueries.ts:1073`<br>`lib/admin/adminQueries.ts:1132`<br>`app/(admin)/admin/(console)/settlements/page.tsx:83`<br>`supabase/sql/003_p0_custom_request_draft.sql:230` | UTC(ISO slice) | KST | '완료:' 값이 UTC 벽시계 원문(T·초 포함)으로 노출 — 15시 UTC 이후 완료 건은 월말 귀속을 이전 달로 오독 | slice(0,19)를 formatKoreanDate 또는 Asia/Seoul 고정 Intl로 교체하고 라벨에 KST 명시 | 1 |
| 30 | **S3** | 휴식 시작 토스트 '복귀 예정' 날짜 | `lib/mentor/mentorActivityActions.ts:51`<br>`lib/mentor/mentorActivityActions.ts:56`<br>`lib/mentor/mentorActivityService.ts:251` | UTC(ISO slice) | KST | 토스트의 복귀 예정일을 UTC ISO 앞 10자로 표기 — KST 00:00~08:59 신청 시 하루 이른 날짜를 안내 | slice(0,10) 제거 후 formatKoreanDate()로 교체 | 1 |
| 31 | **S3** | 지급 일정 위젯 23일 판정·월 라벨 (구) | `lib/mentor/mentorPayoutsDisplay.ts:83`<br>`lib/mentor/mentorPayoutsDisplay.ts:91`<br>`lib/mentor/mentorPayoutsDisplay.ts:56`<br>`lib/mentor/mentorPayoutsService.ts:612` | 서버로컬(UTC) | KST | buildPayoutScheduleInfo가 서버 로컬(UTC) 일·월로 23일 판정·월 라벨·진행률 산출 — 소비 사이드바가 orphan이라 잠복 | 23일 판정·월 라벨을 kstDateString/kstYearMonth 산술로 교체하거나 orphan과 함께 제거 | 2 |
| 32 | **S3** | 멘토 인증·학적변경 제출 일시 표기 | `app/(mentor)/mentor/verification/page.tsx:27`<br>`app/(mentor)/mentor/academic-record-change/page.tsx:45`<br>`app/(mentor)/mentor/verification/page.tsx:267`<br>`app/(mentor)/mentor/academic-record-change/page.tsx:130` | UTC(서버렌더) | KST 고정 | '최근 제출' 일시가 timeZone 미지정 Intl로 서버 UTC 렌더 — KST 00~09시 제출분은 날짜까지 하루 전 | 두 페이지 사본 formatDateTime을 Asia/Seoul 고정 공통 유틸로 교체 | 2 |
| 33 | **S3** | 공개 공지사항 게시일 표기 | `lib/notices/publicNoticesQueries.ts:26`<br>`lib/notices/publicNoticesQueries.ts:41`<br>`app/(public)/notices/page.tsx:14`<br>`components/notices/PublicNoticesList.tsx:36` | UTC(서버렌더) | KST 고정 | 공개 /notices 게시일이 서버 UTC 달력으로 포맷 — KST 00:00~08:59 등록 공지가 하루 전 날짜로 노출됨 | formatDate()의 toLocaleDateString에 timeZone:'Asia/Seoul' 추가('년 월 일' 표기 유지) | 1 |
| 34 | **S3** | 마이페이지 구독 시작일 라벨 | `lib/mypage/studentActiveSubscriptions.ts:92`<br>`lib/mypage/studentActiveSubscriptions.ts:236`<br>`app/api/mypage/active-subscriptions/route.ts:23`<br>`lib/subscribe/subscriptionDisplay.ts:14` | 서버로컬(UTC) | KST 고정 | subscribedAtLabel이 서버 로컬(UTC) 달력 — 같은 카드의 Asia/Seoul 라벨과 불일치(현재 렌더 경로 없어 잠재) | formatSubscriptionStartedAt을 subscriptionDisplay.formatSubscriptionDate로 위임 | 1 |
| 35 | **S3** | 클라이언트 컴포넌트 일시 표기 그룹 | `components/admin/AdminDashboardView.tsx:41`<br>`components/admin/AdminMentorApprovalWorkspace.tsx:72`<br>`components/mentor/MentorProfileEditForm.tsx:223`<br>`components/customRequest/CustomRequestStudentPostsList.tsx:28` | SSR UTC→브라우저 | KST 고정 | 관리자·멘토 콘솔과 학생 임시저장 카드 일시가 timeZone 미지정 — SSR 초기 HTML은 UTC, 해외 접속은 현지 시각 | 각 포맷터에 timeZone:'Asia/Seoul' 추가해 SSR/CSR 표기를 KST로 고정 | 8 |
| 36 | **S3** | 캐시 원장 기간 프리셋(1/3/6개월) 경계 | `components/cash/WalletLedgerPageBody.tsx:26`<br>`components/cash/WalletLedgerPageBody.tsx:27`<br>`components/cash/WalletLedgerPageBody.tsx:94` | 실행환경 로컬 | KST 자정 | 프리셋 경계를 실행 환경 로컬 자정으로 계산 — SSR(UTC)과 하이드레이션(KST) 결과가 9시간 어긋나 경계 행이 깜빡임 | periodStart를 KST 고정 산술(epoch+9h → 연·월·일 → −9h)로 교체(직접설정 분기와 동시) | 1 |
| 37 | **S3** | 생년월일 '오늘 이전' 검증 (isFutureBirthDate) | `lib/auth/minorAgeGate.ts:46`<br>`lib/auth/minorAgeGate.ts:49`<br>`lib/auth/signupValidation.ts:49`<br>`lib/auth/signupValidation.ts:50` | 브라우저 로컬 | KST 달력 | '오늘 이전' 검증도 브라우저 로컬 달력 기준 — 기기 TZ에 따라 최대 1일 창의 입력 오거부·오허용 | todayParts를 kstTodayParts로 교체(만 14세 판정 항목과 동시 해소) | 1 |

### 대표 근거 인용

각 항목의 대표 1줄 인용 (원문 그대로):

- **#1** `supabase/sql/131_p1_13_subscription_checkout_atomic.sql:93` — `now(), now(), now() + interval '1 month', now() + interval '1 month', 'monthly',`
- **#2** `lib/admin/adminNoticesMutations.ts:6` — `function toTimestamptzOrNull(raw: string): string \| null {`
- **#3** `lib/cash/cashQueries.ts:76` — `const fromTs = args.from ? `${args.from}T00:00:00` : null;`
- **#4** `lib/mentor/mentorPayoutsService.ts:62` — `return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;`
- **#5** `app/(mentor)/mentor/mypage/page.tsx:71` — `const d = new Date(now.getFullYear(), now.getMonth() - i, 1);`
- **#6** `lib/mentor/mentorPayoutsQueries.ts:173` — `const start = new Date(d.getFullYear(), d.getMonth(), 1);`
- **#7** `components/cash/WalletChargeRightSidebar.tsx:12` — `const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);`
- **#8** `app/(mentor)/mentor/individual-questions/page.tsx:51` — `return !Number.isNaN(d.getTime()) && d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();`
- **#9** `lib/cash/ledgerRowDisplay.ts:34` — `return new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short" }).format(d);`
- **#10** `lib/notifications/notificationRowDisplay.ts:31` — `return d.toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" });`
- **#11** `app/(admin)/admin/(console)/settlements/page.tsx:34` — `return new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short" }).format(d);`
- **#12** `lib/community/communityQueries.ts:347` — `return d.toLocaleDateString("ko-KR", { dateStyle: "medium" });`
- **#13** `lib/auth/accountStatus.ts:54` — `return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(`
- **#14** `supabase/sql/158_p1_11_mentor_notification_atomization.sql:32` — `v_date_key := to_char(coalesce(NEW.termination_effective_at, now()) at time zone 'UTC', 'YYYY-MM-DD');`
- **#15** `lib/auth/minorAgeGate.ts:27` — `year: at.getFullYear(),`
- **#16** `lib/mentor/mentorActivity.ts:53` — `threshold.setMonth(threshold.getMonth() - MENTOR_REST_FREQUENCY_MONTHS);`
- **#17** `lib/mentor/mentorActivity.ts:53` — `threshold.setMonth(threshold.getMonth() - MENTOR_REST_FREQUENCY_MONTHS);`
- **#18** `components/admin/AdminDisputesWorkspace.tsx:76` — `if (dateFrom && d < new Date(`${dateFrom}T00:00:00`)) return false;`
- **#19** `lib/admin/adminDashboardExtended.ts:83` — `todayStart.setHours(0, 0, 0, 0);`
- **#20** `lib/mentor/dashboard/mentorHubDashboardQueries.ts:61` — `d.getDate() === now.getDate()`
- **#21** `lib/customRequest/mentorCustomOrderBrowseDisplay.ts:66` — `today.setHours(0, 0, 0, 0);`
- **#22** `lib/customRequest/orderLifecycleConstants.ts:455` — `return `${d.getFullYear()}.${pad2(d.getMonth() + 1)}.${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;`
- **#23** `components/mentor/mypage/MentorActivityControls.tsx:16` — `return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;`
- **#24** `lib/customRequest/orderLifecycleConstants.ts:435` — `return `${d.getFullYear()}.${pad2(d.getMonth() + 1)}.${pad2(d.getDate())}`;`
- **#25** `supabase/sql/087_user_consent_records.sql:87` — `then (current_date < (v_birth_date + interval '14 years')::date)`
- **#26** `supabase/sql/153_p2_25_pay_due_payouts_convergence.sql:50` — `v_cutoff timestamptz := date_trunc('month', p_run_date::timestamp) - interval '1 second';`
- **#27** `lib/admin/adminNoticesQueries.ts:36` — `if (s.includes("T")) return s.slice(0, 16).replace("T", " ");`
- **#28** `lib/admin/adminQueries.ts:963` — `const periodStart = typeof r.period_start === "string" && r.period_start ? r.period_start.slice(0, 10) : "";`
- **#29** `lib/admin/adminQueries.ts:1073` — `parts.push(`완료: ${String(o.completed_at).slice(0, 19)}`);`
- **#30** `lib/mentor/mentorActivityActions.ts:51` — `? String(res.summary.pauseUntil).slice(0, 10)`
- **#31** `lib/mentor/mentorPayoutsDisplay.ts:83` — `const target = day < 23 ? new Date(y, m, 23) : new Date(y, m + 1, 23);`
- **#32** `app/(mentor)/mentor/verification/page.tsx:27` — `return new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short" }).format(d);`
- **#33** `lib/notices/publicNoticesQueries.ts:26` — `return d.toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric" });`
- **#34** `lib/mypage/studentActiveSubscriptions.ts:92` — `return date.toLocaleDateString("ko-KR", {`
- **#35** `components/admin/AdminDashboardView.tsx:41` — `return new Intl.DateTimeFormat("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(d);`
- **#36** `components/cash/WalletLedgerPageBody.tsx:27` — `if (key === "1m") return new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());`
- **#37** `lib/auth/minorAgeGate.ts:49` — `return birth.day > today.day;`

## 3. 모호 표

> 코드만으로는 현재/의도 기준을 확정할 수 없어 사람의 확인이 필요한 항목. 추측으로 버그·정상 어느 쪽으로도 분류하지 않았다.

| # | 경계 | 근거 | 현재 | 의도 | 쟁점 | 확인 방법 |
|---|---|---|---|---|---|---|
| 1 | 운영용 cron ?at= 파라미터 해석 (구독 갱신·개별질문 만료 라우트) | `app/api/cron/subscription-renewal/route.ts:37`<br>`app/api/cron/individual-question-expiry/route.ts:33`<br>`lib/subscribe/subscriptionRenewalBatch.ts:406` | 서버 호스트 로컬(Vercel=UTC) — 오프셋 없는 date-time은 ECMAScript 규정상 로컬로, date-only는 UTC 자정… | 오프셋이 명시된 절대 instant(라우트 계약 문구 "ISO timestamp") — 다만 한국 운영자는… | 운영자가 `?at=2026-08-29T03:10`처럼 오프셋 없이(KST 의도) 수동 호출하면 기준 instant가 9시간 밀리고, 그 시각이 처리 대상 컷오프(next_billing_at·expires_at lte)와 기록 타임스탬프(billing_at·processed_at·grace_until)를 전부 결정한다. Vercel cron 기본 경로(at 미전달)와 e2e(Z 포함 ISO)는 정상이고 멱등키 날짜 조각은 DB 행 값에서 나와 무영향 — 따라서 '실제 무오프셋 수동 호출 이력이 있었는가'가 버그/정상을 가른다. 코드만으로는 확정 불가. | ① 운영 담당자(오너·백엔드 운영자)에게 `?at=` 수동 호출 이력 유무와 표기 형식(Z / +09:00 / 무오프셋)을 확인 ② Vercel Function 로그에서 `/api/cron/subscription-renewal`·`/api/cron/individual-question-expiry` 요청 중 쿼리에 `at=`이 붙은 건의 값 포맷을 조회(무오프셋 0건이면 정상 종결) ③ subscription_billing_events의 processed_at·created_at이 정기 스케줄(18:10Z·18:40Z)이나 해당 행 period_end와 9시간 어긋난 레코드가 있는지 조회해 과거 오입력 흔적 확인. 어느 결과든 parseAt에 오프셋 필수 검증(무오프셋·date-only는 400 invalid_at)을 넣으면 모호 자체가 소멸… |
| 2 | 약관·방침 시행일 기반 분기 구현 부재 + 미래 시행일 개정문 조기 노출 | `app/(public)/legal/terms/page.tsx:53`<br>`app/(public)/legal/terms/page.tsx:292`<br>`app/(public)/legal/privacy/page.tsx:11` | 해당 없음 — 시행일을 현재 시각과 비교하는 코드가 0건(legal 전 표면에 JS 시간 API·'use client' 없음). 배포 시점에… | KST 달력(시행일 00:00 KST 전환이 자연 해석) | 약관 제3조 제2·3항, 부칙 제2항, 방침 제12조는 모두 '적용일/시행일' 기준의 시간 분기(7일 전 공지 → 적용일 이후 계속 이용 시 동의 간주 → 시행일 이후 최초 로그인 시 멘토 정책 재동의)를 규정하지만 이를 실행하는 코드가 저장소에 없다. 그 결과 오늘(2026-08-29) 기준 /legal/privacy는 헤더에 '시행일: 2026년 9월 1일'을 달면서 동시에 제12조 이력에 '2026년 9월 1일: 개정 시행'을 완료형으로 게시하고 개정 본문 전체를 시행 3일 전부터 노출한다. 게이팅 부재는 확정했으나, 이 조기 노출이 '사전 공지' 이행을 겸한… | ① 오너 확인 2건 — (a) 2026-09-01 시행 개정문의 시행 전 전문 노출이 '사전 공지' 이행으로 갈음되는지, (b) 갈음이라면 제12조 이력의 '개정 시행'을 시행 전 기간에 '개정 예정'으로 표기할지 ② 약관 부칙 제2항의 멘토 재동의 게이트가 실제 운영 요구사항(구현 예정)인지 프로덕트 확인 — 요구사항이면 미구현 컴플라이언스 갭, 아니면 부칙 문구 정리 대상 ③ 재현 검증 — 시스템 시각을 2026-08-30 / 2026-09-02로 바꿔 /legal/privacy를 렌더해 HTML이 바이트 동일함을 확인하면 게이팅 부재가 코드로 확정된다. 도입 시엔 시행 순간을 UTC 절대상수(예: Date.parse("2026-08-31T15:00:00Z"))로 두고 서버에서 비교할 것 — new Date("2026-09-01")(=K… |

## 4. 정상·제외 표 (그룹핑)

> 지시서 §4-4에 따라 축약·그룹핑했다. 각 항목은 전수 판정된 경계이며 대표 근거를 1건씩 표기한다.

### 4-1. 정상

> 규범에 부합하거나, 시간대와 무관하게 올바른 경계.

#### 웹(TS/TSX) — 56건

| 도메인 | 경계 | 대표 근거 | 판정 근거 |
|---|---|---|---|
| 관리자 공지·프로모션 | 공지·프로모션 노출 필터 (RLS starts_at/ends_at vs now()) | `supabase/sql/031_p1_admin_notices_promotions.sql:99`<br>`supabase/sql/031_p1_admin_notices_promotions.sql:100` | timestamptz끼리의 now() 비교는 절대시각 비교라 그 자체로 정확 — 현재 관측되는 9시간 지연 노출은 이 필터가 아니라 경계#1의 오저장이 원인. |
| 관리자 공지·프로모션 | 노출기간 컬럼 스키마 (timestamptz 여부) | `supabase/sql/031_p1_admin_notices_promotions.sql:31`<br>`supabase/sql/031_p1_admin_notices_promotions.sql:32` | app_notices·promotion_campaigns 모두 timestamptz — timestamp(without tz) 컬럼 없음. 규범 적합. |
| 관리자 공지·프로모션 | 저장된 노출기간 → 편집 폼 역주입 (datetime-local value) | `components/admin/AdminNoticesFormSkeleton.tsx:57`<br>`components/admin/AdminNoticesList.tsx:65` | 편집 폼이 존재하지 않아 역주입 경계 부재 — 폼은 생성 전용(defaultValue/value 없음)이고 목록의 조치는 활성/비활성 토글뿐, 기간 수정 UI 자체가 없음. |
| 관리자 공지·프로모션 | 관리자 감사 로그·행 생성 시각 기록 | `lib/admin/adminActionLog.ts:20` | 공지 생성·토글, 충전패키지 토글의 감사 로그 insert가 시각 컬럼을 클라이언트에서 만들지 않고 DB 기본값에 맡김 — UTC timestamptz로 올바르게 기록. |
| 관리자 콘솔 | 조치 시각 기록(now → timestamptz) — resolved_at·updated_at·reviewed… | `lib/admin/adminDisputeActions.ts:75`<br>`lib/admin/adminReviewActions.ts:57` | 현재 순간을 오프셋 포함 UTC ISO로 timestamptz에 기록 — 규범(UTC 저장)에 부합. adminReportActions.ts:61·142, bulkActions.ts:42·82, mentorAcademicRecordChangeReviewActions.ts:98·159·201, mento… |
| 관리자 콘솔 | 멘토 활동 종료 유예 만료 판정(termination_effective_at vs now) | `lib/admin/mentorActivityAdminActions.ts:120`<br>`lib/mentor/mentorActivityService.ts:147` | timestamptz(오프셋 포함)로 파싱한 절대 순간 비교 — 시간대 영향 없음 |
| 관리자 콘솔 | 대시보드 요약·목록 카운트/페이지네이션(상태 기반, 시간 경계 없음) | `lib/admin/adminQueries.ts:24`<br>`lib/admin/adminQueries.ts:317` | 환불/신고/분쟁/승인/학적변경/사용자 목록·카운트는 status 필터와 created_at 정렬만 사용 — 날짜 범위 질의(.gte/.lte on 시간 컬럼) 없음 |
| 관리자 콘솔 | 정지 lazy 해제 판정(effectiveAccountStatus — users 화면 상태 배지) | `lib/auth/accountStatus.ts:34` | suspended_until(오프셋 포함 ISO) 순간 비교로 자동 해제 판정 — 정확 |
| 정산·지급 | 멘토 정산 페이지(/mentor/payouts) 기준 월·오늘·월 진행률 산출 | `lib/mentor/mentorSettlementService.ts:88`<br>`lib/mentor/mentorSettlementSchema.ts:262` | 현행 정산 페이지 로더는 기준 연월·오늘(todayKst)·월 진행률을 전부 epoch+9h 고정 산술로 계산 — 서버 UTC에서도 KST 달력과 일치 |
| 정산·지급 | 정산 내역 월 필터 → mentor_settlement_lines/summary RPC 날짜 인자 생성 | `lib/mentor/mentorSettlementSchema.ts:298`<br>`lib/mentor/mentorSettlementService.ts:39` | 월 경계를 +09:00 오프셋 포함 ISO로 만들어 RPC에 넘기므로 timestamptz 비교가 KST 달력 월과 정확히 일치. 클라이언트 월 목록(상세 뷰)도 kstYearMonth라 브라우저 시간대 무관 |
| 정산·지급 | 정산 날짜 표시 유틸 그룹 (표 일자·지급(예정)일·적립중 확정일·XLSX) | `components/mentor/payouts/payoutUi.tsx:39`<br>`lib/mentor/mentorSettlementSchema.ts:308` | formatPayoutTableDate(Asia/Seoul 명시)·formatKstMonthDay(+9h)·formatRunDateLabel(Date.UTC 결정적)·formatKoreanDate(+9h, 날짜 전용 문자열은 무변환 통과) — 표·XLSX·지급일 표기 전부 KST 고정 |
| 정산·지급 | 지급일 경과 판정 (확정 실지급 '예정' 표기 제거) | `components/mentor/payouts/MentorPayoutsHeroCard.tsx:33` | run_date('YYYY-MM-DD')와 서버에서 KST 산출한 todayKst의 사전식 비교 — 달력 날짜끼리라 시간대 오차 없음 |
| 정산·지급 | 기간 집계 순수 유틸(aggregateSettlementTotalsInPeriod) 자체의 시각 비교 | `lib/mentor/settlementPeriodTotals.ts:49`<br>`lib/mentor/settlementPeriodTotals.ts:44` | created_at(+00:00 부착)과 경계 ISO를 epoch으로 비교 — 유틸 자체는 실행 시간대 무관하게 결정적. KST 정합성은 전적으로 호출측 경계(경계 6의 monthBounds)에 달림 |
| 정산·지급 | 정산 목록 정렬·최신순 비교 (instant 기준) | `lib/admin/adminQueries.ts:1137`<br>`components/mentor/payouts/MentorPayoutsMain.tsx:101` | PostgREST가 항상 +00:00 고정 포맷으로 내려주므로 문자열/epoch 정렬 모두 시각 순서와 일치 — 달력 경계를 만들지 않아 시간대 문제 없음 |
| 구독 | 구독 갱신 cron 스케줄 (subscription-renewal) | `vercel.json:6`<br>`docs/contracts/api_web_v1_contract_v1_1.md:2028` | UTC 18:10 = KST 03:10 — 새벽 배치 의도에 −9h 보정이 정확히 반영돼 있고 계약 문서도 동일하게 명기 |
| 구독 | 갱신 만기·유예 만료 판정 (next_billing_at / grace_until 비교) | `lib/subscribe/subscriptionRenewalBatch.ts:406`<br>`lib/subscribe/subscriptionRenewalBatch.ts:433` | 갱신·만료 판정이 저장된 timestamptz instant 대 현재 instant 비교라 시간대와 무관하게 옳음 |
| 구독 | 구독 날짜 표시 공용 포맷터 (기간·결제일·유예일 라벨) | `lib/subscribe/subscriptionDisplay.ts:14`<br>`lib/subscribe/subscriptionRefundProration.ts:150` | formatSubscriptionDate/WithWeekday·formatDateLabel·questionRoomStudentContext 의 formatKoDate·nextAnchorRenewalLabel 전부 Asia/Seoul 명시 — SSR(UTC 서버)에서 계산돼도 KST 날짜로 고정 |
| 구독 | 해지 예약·청구 이벤트 타임스탬프 기록 | `lib/subscribe/subscriptionCancelActions.ts:112`<br>`lib/subscribe/subscriptionRenewalBatch.ts:362` | cancel_requested_at·canceled_at·expired_at·billing_at·processed_at 등 이벤트 시각이 전부 오프셋 명시 ISO(UTC)로 기록돼 저장 규범 부합 |
| 구독 | 갱신 멱등키 날짜 조각 (periodEnd.slice(0,10)) | `lib/subscribe/subscriptionRenewalBatch.ts:327`<br>`lib/subscribe/subscriptionRenewalBatch.ts:307` | UTC 날짜 조각이지만 항상 동일 저장값(period_end 등)에서 파생되는 결정적 키라 실행 시각·시간대와 무관하게 같은 회차 = 같은 키 — 경계 오판 위험 없음 |
| 구독 | 학원법 '이용 개시' 판정 (기간 내 첫 질문 여부) | `lib/subscribe/subscriptionUsageStarted.ts:45` | question_threads.created_at ≥ current_period_start 의 instant 대 instant 비교라 시간대 무관하게 옳음 (전액 환불 분기 입력값) |
| 맞춤의뢰 | 희망 납기·마감일 날짜 표시 그룹 (관례상 결정적) | `lib/customRequest/customRequestQueries.ts:472`<br>`lib/customRequest/customRequestPostMappers.ts:91` | 정상인 이유: 마감·납기 컬럼은 date-only 입력이 UTC 자정으로 저장되므로 UTC 환경 getter도 KST 환경 getter도 문자열 slice도 전부 사용자가 고른 그 날짜를 돌려줌 (UTC 자정과 KST 09:00이 같은 달력 날짜) |
| 맞춤의뢰 | 에스크로 상태 갱신 updated_at 기록 | `lib/customRequest/customOrderEscrowService.ts:93` | 규범(저장은 UTC timestamptz)에 부합 — 오프셋 포함 ISO로 정확한 인스턴트 저장 |
| 질문방·개별질문 | 개별질문 만료 스캔 cron 실행 시각 | `vercel.json:10`<br>`lib/individualQuestion/individualQuestionExpiryBatch.ts:138` | 18:40 UTC = KST 03:40 새벽 실행으로 KST−9h 보정이 되어 있고, 만료 판정은 expires_at(timestamptz instant) lte 비교라 tz 무관 — 계약 문서도 40 18 * * * '변경 없음'으로 확정, '시간당' 의도 문서는 발견되지 않음 |
| 질문방·개별질문 | 개별질문 시각 표시(formatIndividualQuestionDate — 목록·상세·오픈보드 등록/완료/환불… | `lib/individualQuestion/individualQuestionFormat.ts:15`<br>`components/individualQuestion/IndividualQuestionViews.tsx:668` | created_at·released_at·refunded_at 등 개별질문 도메인 시각 표시가 전부 이 유틸(Asia/Seoul 명시)을 경유 — 실행 위치 무관 KST |
| 질문방·개별질문 | 질문방 시각 표시(formatQuestionRoomDateTime — 메시지·스레드·노트·첨부·카탈로그) | `lib/qna/formatQuestionRoomDisplay.ts:7`<br>`components/qna/QuestionRoomWorkspace.tsx:441` | 질문방 UI의 절대 시각 표기는 전부 이 유틸 경유 — hydration 불일치까지 의도적으로 회피한 KST 고정 구현 |
| 질문방·개별질문 | 주간 질문 사용량 "주" 경계(TS 라벨 + SQL 정본 집계) | `lib/qna/weeklyQuestionUsage.ts:47`<br>`supabase/baseline/ledger_replay/20260731095136_20260729211941_weekly_usage_pair_party_guard.sql:77` | 집계 정본은 SQL get_weekly_question_usage(anchor + period×7d, timestamptz)이고 TS subscriptionAnchorWeekBounds 는 동일 산술의 표시용 미러 — 양쪽 모두 instant 간격이라 시간대 어긋남 없음 |
| 질문방·개별질문 | 구독 갱신 요일·다음 갱신일 라벨(질문방 헤더) | `lib/qna/questionRoomStudentContext.ts:32`<br>`lib/qna/questionRoomStudentContext.ts:54` | 구독 시작일·매주 X요일·다음 갱신 M/D·갱신 시각 표시 모두 Asia/Seoul 명시 — 갱신 instant(anchor+7d)의 KST 요일 표기와 실제 갱신 시점이 일치 |
| 질문방·개별질문 | 타임스탬프 정렬·최신값 파생·타임라인 병합(스레드/메시지/첨부/오픈보드) | `lib/qna/questionRoomQueries.ts:130`<br>`lib/qna/questionRoomStudentDisplay.ts:150` | PostgREST 가 timestamptz 를 항상 +00:00 오프셋 포함 ISO 로 반환하므로 파싱이 환경 무관하게 동일 epoch — 순서 비교만 하므로 정상(동일 패턴 전부 그룹) |
| 질문방·개별질문 | 개별질문 타임스탬프 기록(answered_at·expires_at·이관 시 first_answered_at 전… | `lib/individualQuestion/individualQuestionActions.ts:472`<br>`lib/individualQuestion/individualQuestionActions.ts:102` | 서버 액션이 현재 instant 를 UTC ISO 로 기록하고 이관은 timestamptz 문자열 무변환 전달 — 오프셋 없는 문자열 삽입 경로 없음 |
| 캐시·결제·본인인증 | 충전 성공 화면(/wallet/charge/success) 일시 표기 | `app/(student)/wallet/charge/success/page.tsx:65` | 정상 — 성공 화면은 금액·적립·잔액만 표시하고 결제 일시를 표시하지 않아 시간대 표면이 없다(실패 화면 fail/page.tsx·WalletChargeFailClient도 동일). |
| 캐시·결제·본인인증 | Toss 승인 응답 시각 필드(approvedAt 등) 파싱·저장·표시 | `lib/toss/tossTopupCore.ts:128`<br>`lib/toss/confirmCashTopupServer.ts:51` | 정상 — confirm·lookup·webhook 어느 경로도 Toss의 +09:00 오프셋 ISO 시각 필드(approvedAt/requestedAt)를 파싱·저장·표시하지 않고(저장소 전수 grep 0히트), 충전 시각은 DB now()가 UTC timestamptz로 기록한다. |
| 캐시·결제·본인인증 | 본인인증 만나이 판정(만 14세·보호자 19세, KST) | `lib/identity/age.ts:12`<br>`lib/identity/age.ts:42` | 정상 — KST 달력 날짜를 epoch+9h 후 UTC getter로 산출해 서버 UTC에서도 KST 오늘 기준으로 판정하며, UTC/KST 날짜가 갈리는 경계(자정~09:00)를 계약 테스트(identityAge.contract.test.ts:18-19)가 고정한다. |
| 계정·인증·마이페이지 | 정지 만료 자동 해제·계정 게이트 판정 | `lib/auth/accountStatus.ts:34`<br>`lib/appSession/appSurfaceAccountGate.ts:61` | suspended_until(timestamptz, PostgREST가 +00:00 부착)과 now의 epoch 순간 비교라 시간대 영향 없음 — 세 게이트(웹·앱 표면·P2-22) 모두 동일 패턴. |
| 계정·인증·마이페이지 | 탈퇴 철회 기한(cancelable_until) 안내 표기 | `components/account/AccountDeletionPendingPanel.tsx:16`<br>`lib/utils/formatDisplay.ts:22` | N21에서 고쳐진 지점 그대로 유지 — cancelable_until이 formatKoreanDate를 경유해 KST 달력 날짜로 정확히 표기(구 UTC 앞자르기 하루 밀림 재발 없음). |
| 계정·인증·마이페이지 | 탈퇴 취소 가능 판정(취소창 비교) | `lib/account/accountDeletionJobStates.ts:43`<br>`supabase/migrations/20260808092007_account_deletion_server_cancel_window_30d.sql:73` | 취소 가부는 timestamptz 순간 비교(웹 표시용 canCancelAccountDeletion + DB 정본 account_deletion_cancel의 now() 비교)로 일관 — 달력 경계 미개입. |
| 계정·인증·마이페이지 | 계정 삭제 cron 스케줄·대상 선별 | `app/api/cron/account-deletion/route.ts:24`<br>`lib/account/accountDeletionAdapters.ts:599` | "0 * * * *" 매시 실행은 주기형이라 KST 보정 불필요(캘리브레이션 3과 동형). preview/claim의 next_attempt_at·leased_until 비교는 toISOString(Z) ↔ timestamptz 순간 비교, 취소창 검증은 DB 176 begin_locked의 now()… |
| 계정·인증·마이페이지 | 생년월일 입력→저장·검증(달력 문자열) | `components/auth/StudentSignupForm.tsx:92`<br>`lib/auth/buildSignupUserMetadata.ts:36` | type=date 값이 문자열 그대로 metadata→트리거→users.birth_date(date)로 흘러 시간대 산술 0 — new Date("YYYY-MM-DD")+로컬 getter 혼용 함정 없음(존재 검증은 Date.UTC와 UTC getter로 닫힘). ageGateCheckedAt은 UTC… |
| 계정·인증·마이페이지 | 마이페이지 후기 날짜 표기(formatKoreanDate 경유 그룹) | `app/(mentor)/mentor/mypage/page.tsx:505` | 최근 후기 작성일이 formatKoreanDate 경유 — 실행 환경 무관 KST 달력 날짜로 정확(담당 범위 내 formatKoreanDate 경유 표시는 이 1건). |
| 계정·인증·마이페이지 | 서버 기록 타임스탬프 저장(updated_at 등) | `lib/auth/mentorSignupStudentIdAction.ts:118`<br>`lib/auth/mentorPublicRead.ts:50` | toISOString()의 Z 부착 순간이 timestamptz로 저장/보충 — 오프셋 없는 문자열 저장 함정 없음, 규범(UTC 저장) 정합. |
| 대시보드·커뮤니티·알림 | 공지 노출기간 필터(학생 표시측) | `lib/notices/publicNoticesQueries.ts:47`<br>`lib/notices/publicNoticesQueries.ts:56` | 노출기간 판정은 DB RLS의 timestamptz instant 비교로 필터 기전 자체는 정상 — 실제 9h 밀림은 관리자 입력 저장측 버그(캘리브레이션 1, adminNoticesMutations — 타 요원 담당)에서 유입되는 것 |
| 대시보드·커뮤니티·알림 | UTC instant 저장 경로(알림 설정 updated_at·리뷰 답글 시각) | `lib/notifications/notificationSettingsActions.ts:73`<br>`lib/reviews/reviewQueries.ts:318` | toISOString()은 오프셋 포함 UTC instant라 timestamptz 저장 규범에 정확히 부합 — 정상 |
| 대시보드·커뮤니티·알림 | 목록 정렬·키셋 커서(게시판 피드·알림함·내 활동 병합) | `lib/community/communityBoardQueries.ts:230`<br>`lib/notifications/notificationsHubQueries.ts:115` | 커서 값이 PostgREST가 돌려준 +00:00 포함 ISO 원문이라 instant 비교로 일관 — 달력 경계 아님, 정상 |
| 대시보드·커뮤니티·알림 | 커뮤니티 조회수 멱등 시간버킷(hourBucket) | `lib/community/viewEventKey.ts:55`<br>`lib/community/viewEventKey.ts:56` | 1시간 단위 중복 제거 버킷일 뿐 달력 경계('오늘' 집계 등)에 쓰이지 않아 UTC 고정이 오히려 환경 무관 결정성을 보장 — 정상 |
| e2e·스크립트·설정 | vercel.json cron — 구독 갱신 배치 스케줄 | `vercel.json:5`<br>`vercel.json:6` | UTC 18:10 = KST 익일 03:10 — 매일 KST 새벽 실행 의도에 −9h 보정이 정확히 반영돼 있음 |
| e2e·스크립트·설정 | vercel.json cron — 개별질문 만료 배치 스케줄 | `vercel.json:9`<br>`vercel.json:10` | UTC 18:40 = KST 익일 03:40 — 구독 갱신 30분 후 실행, KST 새벽 의도와 부합 |
| e2e·스크립트·설정 | vercel.json cron — 계정삭제 배치 스케줄 | `vercel.json:13`<br>`vercel.json:14` | 매시 정각 실행 — 주기형이므로 시간대 개념이 개입하지 않음 |
| e2e·스크립트·설정 | vercel.json cron — 알림 outbox 워커 스케줄 | `vercel.json:17`<br>`vercel.json:18` | 매분 실행 — 캘리브레이션 3번과 동일, 주기형이라 시간대 무관 |
| e2e·스크립트·설정 | 리뷰 보고서 생성시각 표기 (generate-review-report.mjs) | `scripts/generate-review-report.mjs:135` | 스크린샷 검토 HTML 보고서 하단 생성시각 — 실행 호스트 시간대와 무관하게 KST 고정 표기 |
| e2e·스크립트·설정 | e2e 단위 시뮬 고정 시각 픽스처 (계정상태·환불SLA·환불분기·멘토활동) | `e2e/account-status-unit.spec.ts:12`<br>`e2e/refund-sla-unit.spec.ts:7` | 전 픽스처가 오프셋 명시 'Z' 순간 + NOW 주입 방식 — 호스트 tz가 KST든 UTC든 결과 동일, KST/UTC 전환에 깨질 하드코딩 없음 |
| e2e·스크립트·설정 | e2e 갱신 cron 시뮬 기준시각 전달 (?at= 파라미터) | `e2e/subscription-renewal-sim.spec.ts:153`<br>`e2e/subscription-renewal-sim.spec.ts:206` | 시뮬 기준시각을 'Z' 포함 ISO로 넘겨 서버(UTC)·DB(UTC) 어디서 파싱해도 동일 순간 — 오프셋 무명시 파싱 함정 없음 |
| e2e·스크립트·설정 | 마이그레이션 파일명 UTC timestamp 정책 검증 (sql_number_integrity.mjs) | `scripts/verify/sql_number_integrity.mjs:155`<br>`scripts/verify/sql_number_integrity.mjs:170` | 파일명 자릿수·월일시분초 범위 검사만 수행(new Date 파싱·로컬 getter 미사용) — 실행 환경 시간대에 영향받지 않음 |
| e2e·스크립트·설정 | 베이스라인 체크섬 캡처 시각 (axis_checksums_v2.sql captured_at_utc) | `scripts/verify/baseline/axis_checksums_v2.sql:69` | 키 이름(_utc)·변환·'Z' 표기가 모두 UTC로 일관 — DB 세션 TZ가 UTC가 아니어도 정확 |
| e2e·스크립트·설정 | 주간 질문 사용량 창 계약 검증 (s2_2_batch_a T7c — rolling 7일) | `scripts/verify/s2_2_batch_a_verify.sql:433`<br>`scripts/verify/s2_2_batch_a_verify.sql:435` | 검증 스크립트가 주간 한도 창을 'started_at + 7일 rolling'으로 계약 고정 — 간격 기반이라 tz 밀림 자체가 없음 |
| e2e·스크립트·설정 | Playwright 설정 — 브라우저 timezoneId 미지정 | `playwright.config.ts:17`<br>`playwright.preview.config.ts:21` | 두 config 모두 use에 timezoneId 없음 → 테스트 브라우저가 호스트 tz로 렌더. 전 e2e spec을 grep한 결과 렌더된 날짜·시각 텍스트를 단언하는 곳이 0건이라 현재는 영향 없음 |
| e2e·스크립트·설정 | 설정·환경변수 TZ 항목 부재 (.env.example·next.config·package.json·eslin… | `.env.example:21`<br>`package.json:5` | TZ=Asia/Seoul 같은 서버 시계 변조 설정이 어디에도 없음 — 서버 UTC 전제(규범)와 일치. next.config.ts·eslint.config.mjs·postcss.config.mjs에도 시간 관련 항목 0건 |
| e2e·스크립트·설정 | DB 계약 스냅샷 — export 시각 metadata 비교 제외 정책 | `scripts/contracts/verify_remote_contract.mjs:29`<br>`scripts/contracts/verify_remote_contract.mjs:31` | contracts/snapshots/staging_contract.json에는 시각 필드 자체가 없고(카탈로그·grant·hash만), 검증기는 exported_at/generated_at류를 METADATA_ONLY_DRIFT로 격리 — 시간대가 계약 판정에 개입할 여지 없음 |

#### DB/SQL — 39건

| 도메인 | 경계 | 대표 근거 | 판정 근거 |
|---|---|---|---|
| SQL 정산·지급 | 지급 배치 cutoff (pay_due_payouts_for_run — 정산 대상월 마감) | `live:public.pay_due_payouts_for_run`<br>`supabase/migrations/20260827100200_withholding_cash_unit_and_mentor_settlement_rpc.sql:42` | 증상 없음. run_date(매월 23일)의 소속 월 1일 00:00 KST − 1초 = 전월 말 23:59:59 KST가 cutoff — 도메인 규범(KST 달력 마감)에 부합. 캘리브레이션 #1 확정 판정과 일치. 멱등키 to_char(date,'YYYY-MM')는 date 타입 기반이라 세션 TZ… |
| SQL 정산·지급 | 지급 대사 보고서 cutoff (payout_reconciliation_report) | `live:public.payout_reconciliation_report`<br>`supabase/migrations/20260827100200_withholding_cash_unit_and_mentor_settlement_rpc.sql:65` | 증상 없음. not_due/eligible 분류 기준 cutoff가 지급 함수(pay_due_payouts_for_run)와 동일한 KST 전월 말 — 대사와 실지급의 모집단이 일치. |
| SQL 정산·지급 | expected_run_date 산출 (mentor_settlement_lines — 지급 예정일) | `live:public.mentor_settlement_lines`<br>`supabase/migrations/20260827100300_mentor_settlement_rpc_v2_due_payouts_parity.sql:107` | 증상 없음. completion_ts의 KST 소속월 + 1개월 + 22일 = 다음 달 23일. pay_due_payouts_for_run의 cutoff 도출(run_date 소속월 1일 KST − 1초)과 역함수 관계로 정합 — 예: period_end가 KST 9/1 08:00(UTC 8/31 23… |
| SQL 정산·지급 | 멘토 정산 요약 월 경계·cutoff·run_date (mentor_settlement_summary) | `live:public.mentor_settlement_summary`<br>`live:public.mentor_settlement_summary` | 증상 없음. (1) p_month 기본값이 (now() at time zone 'Asia/Seoul')::date — KST '오늘' 기준(UTC였다면 KST 새벽 00:00~08:59에 전월 요약이 뜨는 버그였을 지점). (2) cutoff는 지급 함수와 동일식(다음 달 1일 00:00 KST − 1… |
| SQL 정산·지급 | due_payouts 뷰 완료 가드 (completion_ts ≤ now()) | `live:public.due_payouts(view, views.md)`<br>`supabase/sql/111_due_payouts_completion_guard.sql:31` | 증상 없음. 3채널(period_end/accepted_at/released_at) 모두 timestamptz vs now() 순간 비교 — 시간대 무관하게 옳다. 월 마감은 뷰가 아니라 RPC cutoff가 담당하는 이중 구조(111 주석 명시)로 역할 분리도 정확. |
| SQL 정산·지급 | 구독 정산 항목 기간 게이팅 (refresh_subscription_settlement_items) | `live:public.refresh_subscription_settlement_items`<br>`live:public.refresh_subscription_settlement_items` | 증상 없음. [105] 게이팅(period_end > now() → accruing, 도래 시 pending 승격)은 순간 비교라 시간대 무관. p_from/p_to는 timestamptz 파라미터로 롤링 창 용도 — 달력 경계 아님. |
| SQL 정산·지급 | pg_cron job 1 — subscription_settlement_refresh_hourly 스케줄·파라… | `live:cron.job#1(cron_jobs.md)`<br>`supabase/migrations/20260806202000_subscription_settlement_hourly_schedule.sql:39` | 증상 없음. '0 * * * *'는 매시 주기형 — 규범상 시간대 무관(캘리브레이션 #2와 동형). 파라미터는 [now()−45일, now()) 롤링 재계산 창으로 순수 간격이며, 함수가 멱등이라 반복 계산 안전(마이그레이션 주석 명시). 45일 창은 월 구독 주기(period_end ≈ billing… |
| SQL 정산·지급 | 빌링·만료 알림 dedupe 키의 UTC 날짜 (sbe_notify_billing_event · sub_not… | `live:public.sbe_notify_billing_event`<br>`live:public.sub_notify_expired` | 증상 없음. UTC 날짜는 event_key(주기당 1건 dedupe)에만 들어가고 사용자 노출 본문의 날짜는 전부 notification_date_label(Asia/Seoul)을 거친다. 키가 UTC 일자로 잘려도 같은 구독의 서로 다른 갱신 주기는 period_end 자체가 다르므로 오충돌 없음. |
| SQL 정산·지급 | 지급·환불 money 함수군의 시각 기록 (now() 스탬핑) | `live:public.release_individual_question_payout`<br>`live:public.record_custom_order_escrow_payout` | 증상 없음. record_custom_order_escrow_payout/escrow_refund/dispute_split, release_individual_question_payout, refund_individual_question_hold, approve/reject_refund_request_… |
| SQL 수명주기 | 주간 질문 한도(주4/주9)의 '주' 경계 | `live:public.get_weekly_question_usage`<br>`supabase/sql/065_anchor_weekly_question_usage.sql:4` | 브리핑의 질문('주 시작이 KST 월요일인지 UTC인지')에 대한 답: 둘 다 아니다. 032의 KST 월요일 달력 주를 065에서 의도적으로 폐기하고 anchor=coalesce(started_at, created_at) 기준 epoch 초 나눗셈(604800s) rolling 창으로 전환했다. 달력… |
| SQL 수명주기 | 멘토 평균 응답시간의 KST 일 단위 분할(야간 00~06시 제외) | `live:public.get_mentor_avg_response_hours`<br>`live:public.get_mentor_avg_response_hours` | 없음. timestamptz → KST 무tz timestamp로 내려 일 경계를 만들고, 경계값을 다시 at time zone 'Asia/Seoul'로 timestamptz로 되돌려 원 인스턴트와 비교 — 규범의 2중 변환 요건을 정확히 충족. 각 KST 일의 06:00~24:00만 응답시간으로 계상… |
| SQL 수명주기 | 개별질문 만료 판정(expires_at)과 만료값 생성 주체 | `live:public.claim_individual_question`<br>`live:public.list_open_individual_questions_for_mentor` | 없음(DB 측). claim/claim_v2/list_open 모두 timestamptz 인스턴트 비교라 정확. expires_at 값을 **만드는 쪽은 웹 계층**(individualQuestionActions.ts, ISO 인스턴트로 기록)이므로 그 산출 달력·만료 배치(individualQuest… |
| SQL 수명주기 | 구독 결제·갱신의 기간 산정(current_period_end, next_billing_at, grace) | `live:public.confirm_subscription_checkout`<br>`supabase/sql/068_subscription_renewal_rpc.sql:119` | 실질 없음. 결제 시각 앵커 + 1개월 rolling(성공 갱신 시 v_period_start=직전 current_period_end로 이월, 표류 없음), grace는 상대 2일 — 달력 마감형 경계가 아니므로 KST 요건 비해당. 유의: timestamptz+interval '1 month'는 세션… |
| SQL 수명주기 | 계정 삭제 30일 철회 창(cancelable_until) 산출·판정 | `live:public.account_deletion_request_consented`<br>`live:public.account_deletion_cancel` | 없음. 산출(요청 시각+30일)과 판정(cancel/begin_locked/status_self 모두 timestamptz 인스턴트 비교)이 일관된 상대 창. hotfix(30분→30일) 역수입본과 라이브 일치 확인. |
| SQL 수명주기 | 구독 알림 이벤트 멱등 키의 UTC 날짜 렌더 | `live:public.sbe_notify_billing_event`<br>`live:public.sub_notify_expired` | 없음. 세션 TZ(UTC) 날짜 렌더이지만 용도가 dedup 키 구성뿐이고(월 단위 주기에서 결정적·충돌 없음) 사용자에게 노출되지 않는다. 사용자 노출 본문의 날짜는 전부 notification_date_label(KST) 경유로 정상. |
| SQL 수명주기 | 알림 표시용 날짜 라벨(notification_date_label) | `live:public.notification_date_label` | 없음. timestamptz를 Asia/Seoul로 변환해 한국어 날짜로 렌더 — 표기 경계의 정본 패턴. |
| SQL 수명주기 | nice_auth_token 일일 스윕 cron(job 2) 스케줄·내용 | `/tmp/claude-0/-home-user-ssambership-web/986edf6e-81fd-59cd-bb7d-cd212305fc79/scratchpad/db_snapshot/cron_jobs.md:17`<br>`/tmp/claude-0/-home-user-ssambership-web/986edf6e-81fd-59cd-bb7d-cd212305fc79/scratchpad/db_snapshot/cron_jobs.md:22` | 없음. 삭제 대상(expires_at+1일 경과)과 pending 본인인증 24시간 만료 모두 순수 상대 간격이라 실행 시각에 결과가 달라지지 않는다(하루 1회 지연 상한만 결정). 실행 시각도 KST 01:20 새벽으로, '매일 새벽' 의도라면 이미 KST−9h 보정된 값. |
| SQL 수명주기 | 시간 조건 RLS 2건(app_notices_select·promotion_campaigns_select)의… | `/tmp/claude-0/-home-user-ssambership-web/986edf6e-81fd-59cd-bb7d-cd212305fc79/scratchpad/db_snapshot/rls_policies.md:22` | 정책 자체는 없음 — timestamptz 대 now() 인스턴트 비교는 세션 TZ와 무관하게 정확하다. |
| SQL 수명주기 | 리뷰 자격(동일 멘토 2회 결제) 판정의 시간 경계 | `supabase/sql/066_review_eligibility_billing_events.sql:95`<br>`supabase/sql/061_review_consecutive_and_response_time.sql:63` | 없음. 061의 'KST 연속 월' 판정(그 자체는 올바른 KST 패턴이었음)은 066에서 결제 성공 횟수 >= 2 카운트로 대체되어 달력 경계가 소멸 — UTC/KST 이슈 없음. 라이브 시간함수 덤프에 check_review_eligibility가 없는 것도 본문에 시간 함수가 없어 필터 밖이기 때… |
| SQL 수명주기 | 수명주기 타임스탬프 기록·정지/차단 게이트 일괄 (QnA·개별질문·구독 상태·알림 읽음·삭제 워커) | `live:public.qna_append_message`<br>`live:public.answer_individual_question` | 없음. 이 그룹 전체(qna_confirm_thread confirmed_at, qna_apply_answered_transition, claim_individual_question claimed_at, keep_subscription_refunded_status, sub_notify_expired 트… |
| SQL 라이브 함수 전수 | updated_at·created_at·처리시각 now() 저장 (트리거·RPC 공통 그룹) | `live:public.set_updated_at`<br>`live:public.reviews_enforce_update` | 없음 — timestamptz 컬럼에 now() 기록은 UTC 저장 규범에 부합. |
| SQL 라이브 함수 전수 | 계정 정지 만료 판정 (suspended_until 대 now()) | `live:public.ugc_write_allowed`<br>`live:public.qna_append_message` | 없음 — 정지 해제는 저장된 절대 시각 도달 여부이므로 시간대 영향 없음. |
| SQL 라이브 함수 전수 | 멘토 평균 응답시간 KST 일 단위 분해 (2중 변환) | `live:public.get_mentor_avg_response_hours`<br>`live:public.get_mentor_avg_response_hours` | 없음 — timestamptz→KST 무tz 분해 후 비교 시 'at time zone Asia/Seoul' 로 timestamptz 복귀까지 양방향 변환이 모두 있어 9시간 밀림 없음. 한국은 DST 없어 경계 안전. |
| SQL 라이브 함수 전수 | 알림 날짜 라벨 KST 렌더 (notification_date_label) | `live:public.notification_date_label` | 없음 — to_char 를 KST 변환 후 적용해 세션 TZ(UTC) 렌더 함정을 회피. IMMUTABLE 표기도 tz 하드코딩이라 타당. |
| SQL 라이브 함수 전수 | IQ 공개질문 만료 시각 비교 (expires_at > now()) | `live:public.claim_individual_question`<br>`live:public.list_open_individual_questions_for_mentor` | 없음 — 비교 자체는 시간대 무관. 단 expires_at 값을 만드는 쪽(달력 마감인지 상대 간격인지)이 진짜 경계이며, 그 생성 경로는 타 요원(IQ만료) 담당. |
| SQL 라이브 함수 전수 | 가입 birth_date 저장 (클라이언트 문자열 → date) | `live:public.handle_new_auth_user`<br>`live:public.handle_new_auth_user_consent_records` | 없음 — public.users.birth_date(date 컬럼 3종 중 1)는 서버가 now() 계열로 만들지 않고 입력 달력 날짜를 그대로 보존. 이 값을 '해석'하는 쪽의 current_date 비교는 별도 경계(위 만 14세 판정 버그)로 분리 판정함. |
| SQL 저장소 | 지급 배치 cutoff(현행 라이브·pack 최종 상태) — KST 월말 | `supabase/baseline/post_ledger_backfills/20260827100200_withholding_cash_unit_and_mentor_settlement_rpc.sql:65`<br>`live:public.payout_reconciliation_report` | 없음 — 전월 말 23:59:59 KST 로 올바르게 고정(캘리브레이션 1 부합). date(무TZ)를 KST 로 해석해 timestamptz 로 되돌리는 단방향 변환이라 2중 변환 문제 없음. |
| SQL 저장소 | 멘토 정산 RPC 월 집계·지급예정일(mentor_settlement_lines/summary) | `supabase/migrations/20260827100300_mentor_settlement_rpc_v2_due_payouts_parity.sql:107`<br>`supabase/migrations/20260827100300_mentor_settlement_rpc_v2_due_payouts_parity.sql:125` | 없음 — '오늘'(KST)·월 시작/끝(KST)·지급예정일(완료월 KST 기준 익월 23일) 모두 KST 달력이며, date→timestamptz 복귀 시 at time zone 'Asia/Seoul' 2중 변환을 빠짐없이 적용. to_char(m.m_start,'YYYY-MM') 은 date 입력이라… |
| SQL 저장소 | 정산 후보·게이팅의 순간 비교(due_payouts 뷰 107/111/114, refresh_subscript… | `supabase/sql/111_due_payouts_completion_guard.sql:31`<br>`supabase/sql/105_subscription_settlement_period_gating.sql:102` | 없음 — 달력 경계가 아니라 '완료 시각 도달' 순간 비교. 달력 cutoff 는 108/153 RPC 층에서 별도 적용(107 주석 명시). |
| SQL 저장소 | 주간 질문 한도 창(현행: 구독 시작 앵커 롤링 7일 / 구본 032: KST 달력 주) | `supabase/sql/065_anchor_weekly_question_usage.sql:4`<br>`supabase/sql/032_p0_weekly_question_usage.sql:44` | 없음 — 065가 'KST 월요일 경계'를 의도적으로 폐기하고 구독 시작 앵커 기준 7일 롤링(간격 산술, 시간대 중립)으로 전환. 라이브 = 저장소 최신본(065→098→20260729211941 pair guard) 일치. 032의 KST 주 경계(2중 변환 포함)는 당시 기준으로도 올바른 패턴이었… |
| SQL 저장소 | 리뷰 자격 판정(현행 170: 관계 상태 기반, 무시간 / 구본 061·066: KST 월 연속) | `supabase/sql/170_review_eligibility_relationship_based.sql:2`<br>`supabase/sql/061_review_consecutive_and_response_time.sql:63` | 없음 — 현행 check_review_eligibility(170)는 시간 함수를 쓰지 않아 라이브 dump(시간 패턴 필터)에 미등장하는 것이 정합. 구본 061/066의 '2개월 연속' KST 월 경계 판정은 폐기됨(당시 KST 처리 자체는 올바랐음). |
| SQL 저장소 | 멘토 평균 응답시간(KST 일 분할 + 00~06시 KST 제외) | `supabase/sql/061_review_consecutive_and_response_time.sql:105`<br>`supabase/sql/061_review_consecutive_and_response_time.sql:118` | 없음 — KST 로 일 분할한 무TZ local_day 를 다시 at time zone 'Asia/Seoul' 로 timestamptz 에 복귀시키는 2중 변환이 양쪽 경계(일 시작+6h, 익일 0h) 모두 올바름. 라이브와 저장소 061 동일. |
| SQL 저장소 | 알림 한국어 날짜 라벨(notification_date_label) | `supabase/sql/157_p1_11_subscription_notification_atomization.sql:55`<br>`live:public.notification_date_label` | 없음 — 구독 갱신 예고/성공/실패 알림 본문의 날짜(billing_at·period_end·grace)는 모두 이 KST 헬퍼를 경유(158의 UTC 직결과 대조적). |
| SQL 저장소 | 알림 멱등(dedup) 키의 날짜 렌더(157 세션TZ to_char vs 158 명시 UTC) | `supabase/sql/157_p1_11_subscription_notification_atomization.sql:72`<br>`supabase/sql/157_p1_11_subscription_notification_atomization.sql:160` | 없음(실사용 기준) — 키는 사용자 노출이 아니고 월 단위 주기 구분에는 UTC 날짜로도 충돌이 없다. 단 157은 세션 TZ 의존 렌더라, 세션 TimeZone 을 바꾸는 커넥션이 생기면 동일 이벤트의 키가 달라져 중복 알림이 이론상 가능(158은 at time zone 'UTC' 명시로 면역). |
| SQL 저장소 | pg_cron 2건 스케줄(시간당 정산 갱신 · NICE 토큰 일일 스윕) | `supabase/migrations/20260806202000_subscription_settlement_hourly_schedule.sql:40`<br>`supabase/migrations/20260820100100_nice_auth_tokens.sql:10` | 없음 — 시간당 잡은 주기형(캘리브레이션 2와 동형), 일일 스윕은 '16:20 UTC = 01:20 KST' 로 KST-9h 보정을 주석으로 명시했고 잡 본문 조건이 전부 순수 간격(now()−interval)이라 실행 시각의 달력 의존 자체가 없다. 저장소 등록 마이그레이션과 라이브 cron.job… |
| SQL 저장소 | 공지·프로모션 노출기간 RLS(starts_at/ends_at 대 now()) | `supabase/sql/031_p1_admin_notices_promotions.sql:99`<br>`live:public.app_notices app_notices_select` | 없음 — 비교 자체는 순간 대 순간으로 올바름(캘리브레이션 3). 저장소 031 정의와 라이브 정책 2건 동치이며, 저장소에 이 밖의 시간 조건 RLS 는 없음(전 정책 스캔 결과 now() 포함 정책은 031의 2건뿐). |
| SQL 저장소 | 저장 계층 전반(컬럼 기본값·타입) | `supabase/sql/106_payout_runs.sql:25`<br>`live:db_meta (timestamp without time zone 전수)` | 없음 — 저장소 SQL 전수에서 시간 관련 default 는 371곳 전부 default now()(timestamptz)뿐이며, default 에 timezone()/current_date/localtimestamp/오프셋 없는 리터럴을 쓰는 곳이 0건. seed 성 파일(184 등)에도 고정 시각… |
| SQL 저장소 | public 의 date 컬럼 3개의 생성 경계(run_date · birthdate · birth_date) | `supabase/sql/106_payout_runs.sql:19`<br>`supabase/migrations/20260827100300_mentor_settlement_rpc_v2_due_payouts_parity.sql:130` | 없음 — birth_date/birthdate 는 사용자 입력 달력 사실(문자열→date, TZ 변환 없음). payout_runs.run_date 는 DB 내부 산출 경로(mentor_settlement_summary)가 KST 월 기준 익월 23일로 계산하며, 실제 지급 실행의 p_run_date… |
| SQL 저장소 | 테스트 픽스처·검증 스크립트의 시각(scripts/verify) | `scripts/verify/fixtures/full_convergence_supplement_fixture.sql:837`<br>`scripts/verify/baseline/axis_checksums_v2.sql:69` | 없음 — 30개 SQL 전수에서 시각은 거의 전부 now()±interval 상대값. 유일한 고정 리터럴은 Z 오프셋 명시(모호성 없음), 체크섬 캡처 라벨은 명시 UTC 렌더에 'Z' 접미와 키 이름(captured_at_utc)까지 정합. |

#### 보강 감사 — 11건

| 도메인 | 경계 | 대표 근거 | 판정 근거 |
|---|---|---|---|
| 법률·약관 | 법률 문서 공통 시행일 표기 — LegalDocLayout ← COMPANY.effectiveDate (정적… | `components/legal/LegalDocLayout.tsx:14`<br>`lib/legal/companyInfo.ts:22` | 증상 없음. 시행일은 Date 객체를 거치지 않고 이미 KST 달력으로 확정된 한국어 문자열 상수를 그대로 렌더한다. LegalDocLayout을 쓰는 3개 문서(terms·refund·privacy) 중 terms·refund는 effectiveDate prop 미지정으로 COMPANY.effecti… |
| 법률·약관 | 개인정보처리방침 개정 시행일·개정 이력 상수 — 표기 전용, 시각 비교 0건 | `app/(public)/legal/privacy/page.tsx:12`<br>`app/(public)/legal/privacy/page.tsx:14` | 증상 없음. 개정 시행일(2026년 9월 1일)·직전 개정일(2026년 8월 25일)·최초 시행일(COMPANY.effectiveDate)이 모두 const 문자열이며, 헤더 effectiveDate prop과 제12조 개정 이력 목록이 동일 상수를 재사용한다. 어떤 상수도 현재 시각과 비교되지 않아… |
| 법률·약관 | 약관 동의 원장(user_consent_records) 기록 시각·동의 버전 — 방침 버전 비교 로직 웹 코드… | `supabase/sql/087_user_consent_records.sql:22`<br>`lib/identity/service.ts:435` | 증상 없음. 동의 기록 시각은 웹 코드가 계산하지 않고 컬럼 기본값 now()(timestamptz, DB TZ=UTC)로 채워진다 — lib/identity/service.ts:428-441의 보호자 동의 upsert 페이로드에는 agreed_at 키 자체가 없다. consent_version은 'l… |
| 멘토 활동 상태 | mentorActivityState 자동 복귀 판정 · finalizeMentorTermination 유예 만… | `lib/mentor/mentorActivity.ts:28`<br>`lib/mentor/mentorActivityService.ts:147` | 두 판정 모두 PostgREST가 돌려준 +00:00 ISO를 Date로 파싱해 getTime()끼리 비교한다. 로컬 달력 필드를 쓰지 않으므로 서버(UTC)·브라우저(KST) 어디서 평가해도 결과가 같다. 복귀·정리는 KST 자정이 아니라 저장된 정확한 instant에 일어나며, 이는 상대 간격(+N… |
| 테스트 픽스처 | 계약 테스트(lib/**/__contract__/*.contract.test.ts) 하드코딩 고정 시각 — 전… | `lib/utils/__contract__/formatKoreanDate.contract.test.ts:11`<br>`lib/utils/__contract__/formatKoreanDate.contract.test.ts:27` | 없음(무증상). 지시서가 우려한 "CI=UTC / 개발자 로컬=KST 에서 결과가 갈리는 단정"은 계약 테스트 77본 중 단 1건도 존재하지 않는다. 런타임 고정 시각을 가진 17본 전부가 (a) new Date("...Z") / new Date("...+09:00") 처럼 오프셋을 명시하거나, (b)… |
| 리뷰 자격·잔여 표면 | 리뷰 작성 자격 정본 = 170(관계 상태 기반) — 시간 경계 없음 | `supabase/sql/170_review_eligibility_relationship_based.sql:3`<br>`supabase/sql/170_review_eligibility_relationship_based.sql:63` | 없음. 현행 정본 170 은 subscriptions.status ∈ {active, expired, cancel_scheduled} 또는 individual_questions.status ∈ {answered, released} 존재 여부만 본다 — 기간 창(N일 이내), 연속 결제의 시간 간격, 결… |
| 리뷰 자격·잔여 표면 | 리뷰 수정(작성 후 편집) 가능 기간 — 시간 창 없음, 자격 재검사도 없음 | `supabase/sql/171_reviews_author_update_and_updated_at.sql:29`<br>`supabase/sql/171_reviews_author_update_and_updated_at.sql:26` | 없음. decideReviewEligibility 는 (기존 후기 존재 여부 · is_hidden/is_blinded)만 보고 mode/canEdit 을 정한다 — 작성 후 N일 이내 같은 편집 마감 창이 SQL(171)에도 TS 에도 존재하지 않는다. reviews.updated_at 은 서버 now… |
| 리뷰 자격·잔여 표면 | 회원가입 age_gate_checked_at 이 클라이언트 시계의 UTC 순간값 | `app/signup/page.tsx:300`<br>`lib/auth/buildSignupUserMetadata.ts:49` | 없음(시간대 관점). 저장=UTC 규범에 부합한다. |
| 리뷰 자격·잔여 표면 | 숏폼 조회수 멱등 키의 시간버킷 — UTC 명시, 달력 경계 아님 | `lib/community/viewEventKey.ts:54`<br>`lib/community/viewEventKey.ts:56` | 없음. 중복 계수 방지용 해시 시드일 뿐이라 KST/UTC 어느 쪽이든 의미가 같고, 표시·정산·마감 어디에도 노출되지 않는다. |
| 리뷰 자격·잔여 표면 | middleware.ts · hooks/** · contracts/** · app/(public) 페이지 본체… | `middleware.ts:15`<br>`hooks/index.ts:1` | 없음. |
| 구독 월 산술 | TS 폴백 산술(addMonthsClampedUtc) ↔ SQL interval '1 month' 결과 대조 | `lib/subscribe/subscriptionsTable.ts:56`<br>`lib/subscribe/subscribeCheckoutService.ts:81` | Math.min(getUTCDate(), 대상월 일수) 클램프는 Postgres의 interval month 클램프와 동일 규칙이고, getUTCMonth/getUTCDate 기반이라 세션 TZ=UTC인 SQL과 동일 달력을 쓴다. 2026년 12개 피벗 시작일 전건에서 TS 계산 결과와 라이브 SQL… |

### 4-2. 감사 제외 (순수 상대 간격)

> 달력 경계와 무관한 순수 간격(lease·backoff·"N일 후"). 지시서 §0에 따라 판정 대상에서 제외하되 누락으로 보이지 않도록 기록한다.

#### 웹(TS/TSX) — 33건

| 도메인 | 경계 | 대표 근거 | 판정 근거 |
|---|---|---|---|
| 관리자 공지·프로모션 | 충전패키지 토글·시스템 설정 화면 | `lib/admin/adminTopupPackageActions.ts:30`<br>`app/(admin)/admin/(console)/settings/page.tsx:42` | adminTopupPackageActions.ts와 settings/page.tsx 전문을 읽었으나 시간대 관련 로직이 전무(불리언 토글·가격 표시만) — 감사 대상 경계 없음. |
| 관리자 콘솔 | 정지 기간 산출(지금+N일: 수동 정지 durationDays·제재 7d/30d·경고 3회 자동정지 7일) | `lib/admin/accountStatusActions.ts:29`<br>`lib/admin/accountStatusCore.ts:21` | '지금부터 N일 후' 상대 간격이라 시간대 무관(UTC 서버라 DST 왜곡도 없음) — 감사 제외. 단 해제 '시각' 표기는 별도 경계(위 S3)로 지적 |
| 관리자 콘솔 | 환불 5일 SLA 잔여·평균 처리/응답시간(refundSla·slaDashboard·refunds/sla 화면… | `lib/admin/refundSla.ts:37`<br>`lib/admin/slaDashboard.ts:12` | 요청 시각+5×24h 마감과 epoch 차 기반 평균 — 달력 경계를 쓰지 않아 시간대 무관 |
| 정산·지급 | 상대 시간·타임스탬프 기록류 (pickTs 폴백 now, 계정·활동 액션의 now 기록) | `lib/mentor/mentorPayoutsService.ts:80` | 순수 시각 기록·폴백으로 달력 경계에 쓰이지 않음 — 감사 규범상 제외 |
| 구독 | 주간 질문 한도(주4/주9) '주' 경계 | `lib/qna/weeklyQuestionUsage.ts:46`<br>`supabase/sql/065_anchor_weekly_question_usage.sql:70` | KST 월요일/UTC 주 문제 자체가 없음 — TS(subscriptionAnchorWeekBounds)와 SQL 집행 정본이 동일 산식·동일 anchor(started_at??created_at)로 순수 7일 간격이라 감사 규범상 제외 |
| 구독 | 구독 환불 비례 계산 (학원법 별표4 경과율) | `lib/subscribe/subscriptionRefundProration.ts:74`<br>`lib/subscribe/subscriptionRefundProration.ts:70` | 1/3·1/2 분기와 잔여 일할이 전부 period_start/end instant 간 순수 간격 비율이라 시간대 영향 없음 (단, 기간 자체는 경계 '구독 1개월 기간 산출'의 UTC 월 연산 산출물) |
| 구독 | 갱신 예고 D-3 창·past_due 유예 2일 | `lib/subscribe/subscriptionRenewalBatch.ts:377`<br>`lib/subscribe/subscriptionRenewalBatch.ts:92` | 예고 창과 유예 기한이 순수 24h 배수 간격이라 감사 규범상 제외 (유예일 '표시'는 KST 고정 포맷터 경계에서 정상 확인) |
| 맞춤의뢰 | 납품 후 학생 검토 3일 카운트다운 (+3일) | `components/customRequest/OrderRoomView.tsx:73`<br>`components/customRequest/DeliveryReviewCountdown.tsx:33` | 달력 경계가 아닌 제출 시점 기준 72시간 간격(KST·UTC 모두 DST 없어 setDate +3 = 정확히 +72h) — 감사 제외 |
| 맞춤의뢰 | 지원/게시 상대시간 "N분 전" 표시 | `components/customRequest/MentorAppliedListSection.tsx:12`<br>`components/customRequest/MentorOpenPostListSection.tsx:18` | timestamptz 오프셋 포함 파싱 + now와의 차 — 실행 환경 무관 |
| 맞춤의뢰 | 완료 페이지 진행 기간(N일) 계산 | `app/(student)/custom-request/orders/[orderId]/complete/page.tsx:55` | created→completed 간격의 일수 표기 — 달력 경계 아님 |
| 맞춤의뢰 | 첨부·납품 파일 저장 경로 Date.now() 유니크 키 | `lib/customRequest/orderMessageAttachments.ts:147`<br>`lib/customRequest/postAttachmentFiles.ts:49` | 파일명 유니크화 용도 — 시간대 무관 |
| 질문방·개별질문 | 개별질문 만료 기한 간격(48h/72h 설정·NULL 폴백 판정·임박 12h·"N시간 후 마감" 표시) | `lib/individualQuestion/individualQuestionExpiryConfig.ts:39`<br>`lib/individualQuestion/individualQuestionExpiryScan.ts:32` | 달력 경계가 아닌 순수 상대 간격(48h/72h/12h) — 감사 제외 |
| 질문방·개별질문 | 질문방 상대 시간 표시(formatMinutesAgo — N분/시간/일 전) | `lib/qna/formatQuestionRoomDisplay.ts:53` | 순수 경과 간격 표시 — 7일 초과 시 KST 절대 표기(위 경계)로 폴백하므로 잔여 위험 없음 |
| 질문방·개별질문 | 연결노트 "함께한 기간" D+일/개월 표시 | `components/qna/ConnectionNotesPanel.tsx:37` | room 생성 후 경과일의 순수 간격 표시(30일=1개월 근사) — 달력 경계 아님, 감사 제외 |
| 질문방·개별질문 | 무료 질문권 유효기간(가입 후 N일) 게이트 | `lib/qna/freeQuestionUsage.ts:24`<br>`lib/qna/freeQuestionUsage.ts:44` | 안내 문구도 '가입 후 N일까지'로 간격형이라 판정 기전과 일치 — 달력 경계 아님, 감사 제외(DB측 P0003 트리거와의 초 단위 정합은 간격 동일 기전) |
| 질문방·개별질문 | 질문방 redirect 캐시버스터 t=Date.now() | `lib/qna/questionRoomRedirect.ts:81` | 쿼리스트링 캐시버스터 — 시각 해석 없음, 감사 제외 |
| 캐시·결제·본인인증 | NICE 토큰 만료(expires_at) 산출·캐시 히트 판정 | `lib/nice/client.ts:169`<br>`lib/nice/client.ts:185` | 순수 상대 간격(만료 5분 버퍼·폴백 30분 TTL·60초 버퍼) — epoch↔toISOString↔timestamptz 비교가 전부 UTC로 정합하고 달력 경계로 쓰이지 않으며, 사용자 안내 문구에 시각·날짜 노출도 없다. |
| 캐시·결제·본인인증 | 본인인증 스로틀 창·pending TTL·processing 고착 판정 | `lib/identity/service.ts:202`<br>`lib/identity/service.ts:296` | 순수 상대 간격 — 달력 경계 없음. .gte("created_at", windowStartIso)의 ISO는 toISOString(Z 포함)이라 timestamptz 비교도 정합. 안내 문구('10분 후 다시')도 상대 표현만 사용. |
| 캐시·결제·본인인증 | 주문번호·멱등키의 Date.now() (Toss orderId·테스트 충전 idempotencyKey) | `components/cash/CashChargeWidget.tsx:12`<br>`lib/cash/walletTopupActions.ts:61` | epoch ms를 주문번호·멱등키의 유일성 재료로만 사용 — 달력·표시 의미가 없어 시간대 감사 대상 아님. |
| 캐시·결제·본인인증 | 충전 직후 past_due 구독 복구에 넘기는 new Date() | `lib/toss/cashTopupFromPayment.ts:17` | 현재 시각 instant를 구독 도메인 함수에 인자로 넘길 뿐 — 이 지점 자체에 달력 경계 없음. 갱신 마감 산정의 시간대 판정은 구독 도메인(lib/subscribe) 감사 소관. |
| 계정·인증·마이페이지 | 구독 시작일·구독 카드 기간 표기(마이페이지 내) | `lib/mypage/studentActiveSubscriptions.ts:92` | 구독 도메인 표시(담당 지시상 제외 — 구독 요원 소관). |
| 계정·인증·마이페이지 | 학생 마이페이지 캐시 원장 시각 표기 | `app/(student)/mypage/page.tsx:100`<br>`lib/cash/ledgerRowDisplay.ts:34` | 캐시 도메인 표시(담당 지시상 제외 — 캐시 요원 소관). |
| 계정·인증·마이페이지 | 가입 직후 학생증 업로드 허용 창 | `lib/auth/mentorSignupStudentIdAction.ts:78` | 가입 시각 대비 경과 ms 비교 — 순수 간격이라 감사 제외. |
| 계정·인증·마이페이지 | 앱 세션 쿠키 수명(maxAge) | `lib/appSession/appSurfaceCookies.ts:7` | 쿠키 Max-Age 상대 수명 — 순수 간격이라 감사 제외. |
| 대시보드·커뮤니티·알림 | 커뮤니티·대시보드 상대시간 "n분/시간 전" 계산 | `lib/community/communityBoardQueries.ts:130`<br>`lib/community/communityShortformQueries.ts:61` | 두 instant 간 순수 간격이라 시간대 무관 — 정상 동작 (24h/7일 초과 시의 날짜 폴백은 위 별도 경계에서 버그로 판정) |
| 대시보드·커뮤니티·알림 | 알림 outbox 재시도 backoff(next_attempt_at) | `lib/notifications/outboxBackoff.ts:6`<br>`lib/notifications/outboxWorker.ts:89` | 지수 backoff 초 단위 상대 간격만 산출 — 달력 경계 없음, 감사 제외 확인 |
| 대시보드·커뮤니티·알림 | FCM 액세스 토큰 만료 캐시 | `lib/notifications/fcmTransport.ts:167` | 토큰 만료 60초 전 갱신 판정 — 순수 epoch 간격, 감사 제외 |
| 대시보드·커뮤니티·알림 | 스토리지 서명 URL TTL·업로드 파일명 토큰 | `lib/storage/signedStorageUrl.ts:10`<br>`lib/storage/studentIdImageStorage.ts:40` | 서명 URL 만료는 상대 간격(7일 TTL), 파일명 Date.now()는 유니크 토큰 — 달력 경계 아님, 감사 제외 |
| e2e·스크립트·설정 | e2e 현재시각 스탬프·시드 주기·멱등키·폴링 (전 spec 공통 패턴) | `e2e/local-scenarios.spec.ts:295`<br>`e2e/local-scenarios.spec.ts:296` | now±간격(30일 주기 시드), toISOString(UTC 오프셋 명시)→timestamptz 기록, Date.now() 멱등키/제목, 타임아웃 폴링 — 전부 달력 경계 없는 순수 간격이라 감사 제외 |
| e2e·스크립트·설정 | e2e 비례환불 잔여비율 산술 검증 (rpc-subscription) | `e2e/rpc-subscription.spec.ts:113`<br>`e2e/rpc-subscription.spec.ts:115` | timestamptz(오프셋 포함 ISO) 파싱 후 epoch 차이 비율만 계산 — 달력 경계 없음 |
| e2e·스크립트·설정 | 동시성 검증 락 대기 순서 타임스탬프 (w5f-concurrency.mjs) | `scripts/verify/w5f-concurrency.mjs:106`<br>`scripts/verify/w5f-concurrency.mjs:127` | 탈퇴-충전 동시성 관측용 상대 순서 비교(모두 같은 프로세스 시계) — 달력 의미 없음 |
| e2e·스크립트·설정 | 네이티브 팩 리플레이 소요시간 측정 (run_native_pack_replay.sh) | `scripts/verify/baseline/run_native_pack_replay.sh:48`<br>`scripts/verify/baseline/run_native_pack_replay.sh:55` | 마이그레이션별 적용 소요초 측정 — epoch 차이만 사용 |
| e2e·스크립트·설정 | verify SQL 픽스처·배치 검증의 now()±interval 시드 (전 파일 공통 패턴) | `scripts/verify/fixtures/notification_atomization_157_159_fixture.sql:140`<br>`scripts/verify/s2_2_batch_c_verify.sql:578` | 정지 만료·구독 주기·의뢰 마감 등 전부 now() 기준 상대 interval 시드 — 달력 경계 없음, date_trunc/AT TIME ZONE 'Asia/Seoul' 사용처 0건(전수 grep) |

#### DB/SQL — 4건

| 도메인 | 경계 | 대표 근거 | 판정 근거 |
|---|---|---|---|
| SQL 정산·지급 | 순수 간격 항목 일괄 (결제 유효 30분 · 갱신 유예 2일 · 45일 재계산 창) | `live:public.confirm_subscription_checkout` | 감사 제외 — PAYMENT_STALE 30분, sbe 갱신 유예 processed_at+2일, cron의 45일 롤링 창 등은 달력 경계로 쓰이지 않는 순수 간격. |
| SQL 수명주기 | 순수 상대 간격 일괄 (lease·backoff·결제 신선도·무료질문 7일·자동정지 7일) | `live:public.notification_outbox_mark_failed`<br>`live:public.account_deletion_claim` | 감사 제외 — 전부 달력 경계가 아닌 순수 간격: notification_outbox claim/mark_failed/reclaim_expired(lease 60s·backoff), account_deletion_claim/reclaim_expired/record_error/worker_claim(le… |
| SQL 라이브 함수 전수 | 순수 상대 간격류 (무료질문 7일 창 · 경고 자동정지 7일) | `live:public.check_free_question_usage_limits`<br>`live:public.qna_create_question_thread` | 해당 없음 — 감사 규범상 순수 간격은 제외. qt_direct_write_guard 도 동일한 가입+7일 식 포함(같은 판정). |
| SQL 저장소 | 순수 상대 간격 그룹(만료·유예·리스·백오프·스테일 창) | `supabase/sql/052_free_question_policy_7_total_7day_expiry.sql:26`<br>`supabase/sql/131_p1_13_subscription_checkout_atomic.sql:61` | 감사 제외 — 무료질문 가입후 7일 만료, 결제 30분 스테일, 알림/탈퇴 잡 리스·백오프, 탈퇴 취소 30일 창(원장 hotfix 역수입본), 갱신 유예 2일, IQ expires_at·suspended_until 비교 등 전부 달력 경계가 아닌 순수 간격. 달력 경계 용도로 전용되는 사례 없음 확인. |

#### 보강 감사 — 6건

| 도메인 | 경계 | 대표 근거 | 판정 근거 |
|---|---|---|---|
| 멘토 활동 상태 | pause_until · termination_effective_at 산출(addDaysIso +휴식일수 /… | `lib/mentor/mentorActivity.ts:66`<br>`lib/mentor/mentorActivityService.ts:110` | 두 값 모두 `now + N일` 형태의 순수 상대 간격이다. UTC·KST 모두 DST 없는 고정 오프셋이므로 setDate 기반 일수 가산은 어느 달력에서 계산하든 동일한 절대 시각을 낸다(예외 없음). 저장은 timestamptz(UTC)이고 소비측(mentorActivityState, finali… |
| 멘토 활동 상태 | 구독 기간 자동 연장 — current_period_end · next_billing_at 에 휴식일수 가산 | `lib/mentor/mentorActivityService.ts:270`<br>`lib/mentor/mentorActivityService.ts:271` | 기존 instant에 +N×86400초를 더하는 연산이라 KST 벽시계 시분초가 그대로 보존되고(고정 오프셋), 갱신 배치도 next_billing_at을 KST 달력 경계가 아닌 instant(`lte(next_billing_at, atIso)`)로만 비교하므로 시간대 경계가 개입할 여지가 없다. 월… |
| 관리자·레거시 | 레거시 멘토 대시보드 — customOrderLine의 updated_at/created_at slice(0,… | `lib/home/mentorDashboardQueries.ts:79`<br>`lib/home/mentorDashboardQueries.ts:78` | 코드상으로는 timestamptz ISO 문자열을 slice(0,10)로 잘라 UTC 날짜를 표시하는 전형적 하루-오차 패턴이지만, 렌더 경로가 존재하지 않아 사용자 노출은 0건이다. 실증 3단: (1) customOrderLine repo 전역 grep 소비처는 components/home/Mento… |
| 관리자·레거시 | 레거시 멘토 대시보드 — formatOrderDate의 ISO 정규식/slice(0,10) UTC 날짜 절단… | `components/home/MentorDashboardBody.tsx:15`<br>`components/home/MentorDashboardBody.tsx:12` | customOrderLine 조사 중 같은 dead 컴포넌트에서 발견된 두 번째 절단 지점. updated_at/created_at/accepted_at(모두 timestamptz)의 ISO 원문에서 정규식으로 UTC 날짜부만 뽑아 '2026.08.29' 형태로 찍는다. 09:00 KST 이전 이벤트는… |
| 테스트 픽스처 | e2e/*-unit.spec.ts 하드코딩 고정 시각 4본 — 순수 유닛 픽스처(요약, 목록 보강) | `e2e/account-status-unit.spec.ts:12`<br>`e2e/mentor-activity-unit.spec.ts:49` | 없음. e2e/ 28본 중 날짜 리터럴을 가진 파일은 account-status-unit · mentor-activity-unit · refund-bracket-unit · refund-sla-unit 4본뿐이며, 모두 `Z` 오프셋을 명시한다(무오프셋 리터럴 0건 — grep 전수 확인). 나머지 e… |
| 구독 월 산술 | 주간 질문 한도 창 — started_at 기준 7일 고정 간격 | `lib/qna/weeklyQuestionUsage.ts:30`<br>`lib/qna/weeklyQuestionUsage.ts:47` | 구독 시작 시각에 앵커된 7일 고정 창이며 달력 경계를 쓰지 않는다. 규범상 '순수 상대 간격'에 해당해 감사 대상에서 제외한다. 다만 1번 항목의 기간 길이 편차(28일 vs 31일)가 이 창의 개수(4개 vs 4개+부분 5번째)를 통해 실제 제공 질문 수 차이로 증폭되므로, 1번의 영향 산정 근거로… |

## 5. 규범 이의

> 지시서 §0의 판정 규범 자체에 대한 이의. 지시서 지침대로 고치지 않고 기록만 한다.

### 5-1. S1 정의의 '돈'을 결제 금액 변동으로만 읽으면 '결제 대비 제공 부족'을 놓친다 — 정의에 제공기간·환불액을 명시해야

F18(구독 +1개월)에서 검증 요원은 S2, 보강 요원은 S1을 냈고 갈린 원인은 규범 문구다. 규범의 S1은 '돈·법·발송에 영향 — 정산 마감, 결제·환불 기한, 방침 시행일, 알림 발송 창'으로 열거되어 있어, 검증 요원은 '실차감 금액은 불변'을 근거로 S2를 유지했다(verified_part2 F18 notes (3)). 그러나 실제 피해는 청구액이 아니라 같은 금액에 대한 제공량과 환불액이다: lib/subscribe/subscriptionRefundProration.ts:70-74가 elapsedRatio=elapsed/(end−start)로 학원법 별표4 브래킷을 가르고, 그 결과 amountCents가 subscriptionCancelActions.ts:243·mentorActivityService.ts:191에서 refunds.amount_cents로 그대로 INSERT된다(관리자 승인 대상 실지급액). 즉 저장된 기간 길이가 3일 짧아지면 환불 실지급액이 달라진다. 규범 S1 정의에 '결제 대비 실제 제공기간·환불 산정 기준'을 명시적으로 포함해야 이 유형이 두 요원 사이에서 갈리지 않는다.

근거: `lib/subscribe/subscriptionRefundProration.ts:70` · `lib/subscribe/subscriptionCancelActions.ts:243` · `lib/mentor/mentorActivityService.ts:191` · `lib/qna/weeklyQuestionUsage.ts:30`

### 5-2. '순수 상대 간격 제외' 규범에 월·년 단위 예외를 명시해야 — 문자 그대로 읽으면 이번 감사의 유일한 S1이 제외 대상이 된다

규범은 순수 상대 간격(예: N일 후·N시간 후)을 감사 대상에서 제외한다. 그러나 '+1개월'·'−6개월'은 상대 표현이지만 구현이 달력 필드에 의존한다: Postgres `timestamptz + interval '1 month'`는 세션 TZ 달력으로 계산되고(supabase/sql/131:93), JS setMonth는 로컬 달력 필드를 조작하며 말일 clamp도 없다(lib/mentor/mentorActivity.ts:53). 실제로 두 요원 모두 이 조항을 반증 가설로 검토해야 했고(F18 H5), 만약 문자 그대로 적용했다면 최상위 S1 1건과 S2 2건이 통째로 누락됐다. 규범에 '월·년 단위 가산·감산은 달력 연산으로 간주하며 제외 대상이 아니다. 제외는 밀리초 고정 간격(WEEK_MS 등)에 한한다'는 단서를 넣어야 한다 — 실제로 이 감사에서 제외 판정이 옳았던 건(gap:renewal-month의 주간 질문 한도 창)은 lib/qna/weeklyQuestionUsage.ts:30의 WEEK_MS 고정 간격이었다.

근거: `supabase/sql/131_p1_13_subscription_checkout_atomic.sql:93` · `lib/mentor/mentorActivity.ts:53` · `lib/qna/weeklyQuestionUsage.ts:30` · `lib/subscribe/subscriptionsTable.ts:56`

### 5-3. '화면 표시 KST 고정'을 클라이언트 컴포넌트에 문자 그대로 적용하면 무증상 항목까지 동급 지적이 된다 — 규범이 '서버 확정 문자열'과 '클라 전용 렌더'를 구분해야

규범을 문자 그대로 읽으면 timeZone 미지정 toLocale*/Intl 호출은 모두 위반이다. 그런데 실행 위치에 따라 피해가 질적으로 다르다. (a) 서버에서 문자열이 확정되는 경로(F15 알림함, F27 커뮤니티, F19 관리자 콘솔)는 국내 사용자에게도 항상 −9h로 굳어 실피해가 있다. (b) 순수 'use client' 경로(F34, F35)는 국내 KST 기기에서 하이드레이션 후 자가 보정되어 남는 증상이 SSR 첫 페인트 깜빡임과 해외 접속 오차뿐이다. 두 요원은 이를 verdict가 아니라 severity(S2 vs S3)로만 구분했는데, 그러면 규범 준수 여부와 실피해가 표에서 뒤섞인다. 다만 예외가 있어 (b)를 무해로 일괄 면제하는 것도 틀리다 — components/mentor/MentorProfileEditForm.tsx:238은 suppressHydrationWarning 탓에 UTC 텍스트가 교정 없이 잔류한다. 규범에 '서버에서 문자열이 확정되면 버그, 클라 전용 렌더는 규약 위반(S3)으로 분리하되 suppressHydrationWarning이 걸린 지점은 서버 확정과 동급'이라는 판정 규칙을 넣을 것을 제안한다.

근거: `components/mentor/MentorProfileEditForm.tsx:238` · `components/admin/AdminDashboardView.tsx:41` · `lib/notifications/notificationRowDisplay.ts:31` · `lib/community/communityQueries.ts:347`

## 6. 수정 회차 제안

> **이 지시서에서는 수정하지 않는다.** 아래는 후속 TZ-FIX 회차를 위한 묶음 제안이다.

| 회차 | 묶음 | 항목 | 예상 변경 파일 |
|---|---|---|:--:|
| R1 | 구독 월 경계 KST 산출 | #1 | 3 |
| R2 | KST 표시 유틸 통일 — Intl/toLocale | #9, #10, #11, #12 | 22 |
| R2 | KST 표시 유틸 통일 — 로컬 getter | #13 | 1 |
| R2 | SQL 함수 KST 전환 | #14 | 2 |
| R2 | 공지 저장·표시 동시 배포 | #2 | 1 |
| R2 | 기간 필터 경계 KST 명시 | #3 | 2 |
| R2 | 만 14세·생년월일 게이트 KST 통일 | #15 | 2 |
| R2 | 멘토 휴식 빈도 게이트 KST 달력 산술 | #16, #17 | 2 |
| R2 | 월 경계 KST 산출(집계) | #4, #5, #6, #7, #8 | 7 |
| R3 | KST 표시 유틸 통일 — ISO slice | #28, #29, #30 | 4 |
| R3 | KST 표시 유틸 통일 — Intl/toLocale | #32, #33, #34, #35 | 12 |
| R3 | KST 표시 유틸 통일 — 로컬 getter | #22, #23, #24 | 4 |
| R3 | SQL 함수 KST 전환 | #25 | 1 |
| R3 | 공지 저장·표시 동시 배포 | #27 | 1 |
| R3 | 기간 필터 경계 KST 명시 | #18, #36 | 3 |
| R3 | 만 14세·생년월일 게이트 KST 통일 | #37 | 1 |
| R3 | 일 경계 KST 산출(집계·D-day) | #19, #20, #21 | 6 |
| R3 | 저장소 SQL 드리프트 경고 | #26 | 3 |
| R3 | 지급 일정 위젯 KST 정리 | #31 | 2 |

### 회차별 상세

【R1 — 즉시 (S1 1건)】 #1 구독 +1개월 KST 달력 산출. 예상 3파일: confirm_subscription_checkout 재정의 마이그레이션(라이브 본문 기준, 저장소 131·143·145·068·100의 동일 산술도 함께 정리) · supabase/sql/068 · lib/subscribe/subscriptionsTable.ts(addMonthsClampedUtc → KST 산술, 호출부 subscribeCheckoutService.ts:81 동반). 동시 배포 제약: SQL 2본(체크아웃·갱신)은 반드시 같은 배포에 넣는다 — 체크아웃만 고치면 최초 기간은 KST, 갱신 체이닝은 UTC로 갈려 회차별 기준이 섞인다. 배포 후 소급: 과다 제공 1일분은 그대로 두고 과소 제공 1~3일분(3/1·5/1·7/1·10/1·12/1 새벽 결제분)만 current_period_end 연장 보정을 권장. 회귀 고정: 12개 피벗 시작일 × KST 02:00/09:00 조합을 contract test에 박아 둔다.

【R2 — 묶음 (S2 16건: #2~#17)】 naive 38파일, 라운드 내 중복 2건(#4·#5가 app/(mentor)/mentor/mypage/page.tsx 공유, #16·#17이 lib/mentor/mentorActivity.ts 공유) 제거 시 약 36파일. 최대 덩어리는 #11(관리자 콘솔 사본 포매터 17파일)로, 이 라운드는 사실상 'KST 고정 시각 유틸 1본 신설 → 사본 포매터 일괄 치환' 작업이다: 유틸을 먼저 만들면 #9·#10·#11·#12·#13이 한 PR로 처리되고 R3의 #32·#33·#34·#35까지 같은 유틸을 재사용한다. 나머지는 (a) 월 경계 집계 5건(#4~#8) — kstYearMonth/kstMonthBounds/listRecentYearMonths 기존 헬퍼로 치환, (b) 저장·필터 경계 2건(#2·#3) — +09:00 명시, (c) 도메인 로직 3건(#14 SQL 알림 본문, #15 만14세 게이트, #16·#17 휴식 빈도 게이트).

동시 배포 제약(라운드 교차): **#2(저장, S2/R2)와 #27(표시, S3/R3)은 반드시 같은 배포에 넣어야 한다.** 현재 저장 +9h 오차와 표시 −9h 절단이 노출기간 열에서 상쇄돼 있어, 한쪽만 고치면 관리자 화면의 노출기간이 9시간 어긋나 보이며 오히려 오조작을 유발한다. 심각도 규칙상 #27은 R3로 분류했으나 실행 시에는 R2로 끌어올릴 것.

또 하나: #14(SQL 알림 본문)는 멱등 키용 날짜 문자열을 본문 날짜와 분리해야 하며(키 포맷 유지), 배포 시 미발송 전이 건 1회 재발송 여부를 점검한다. 마이그레이션 hotfix 역수입 규칙(CLAUDE.md)에 따라 신규 마이그레이션 1본 + supabase/sql/158 주기를 같은 세션에서 마칠 것.

【R3 — 후순위 (S3 20건: #18~#37)】 naive 37파일, 라운드 내 중복 2건(#22·#24가 lib/customRequest/orderLifecycleConstants.ts 공유, #28·#29가 lib/admin/adminQueries.ts 공유) 제거 시 약 35파일. 구성은 (a) R2에서 만든 KST 유틸의 잔여 적용 6건(#32~#35·#28~#30), (b) 일 경계 산출 3건(#19·#20·#21 — #21은 공용 D-day 유틸 1본 신설로 사본 3곳을 통합), (c) 잠복·orphan 정리 3건(#20 KPI 카드·#31 지급 일정 위젯·#34 구독 API 라벨 — 화면 재연결 전에 고치거나 미사용 코드와 함께 제거), (d) SQL·저장소 위생 2건(#25 만14세 폴백 함수 replace, #26 저장소 153·156 재적용 금지 경고 — #26은 코드 수정이 아니라 주석·INDEX.md 문서 작업이라 언제든 선행 가능하고 오히려 R1 전에 넣는 편이 안전하다).

【총계】 라운드별 naive 합 3+38+37 = 78파일. 라운드 내 중복 4건(위 4쌍) + 라운드 간 중복 4건(lib/auth/minorAgeGate.ts는 #15·#37, components/cash/WalletLedgerPageBody.tsx는 #3·#36, lib/mentor/dashboard/mentorHubDashboardQueries.ts는 #4·#20, lib/disputes/disputeListQueries.ts는 #11·#18) 제거 시 **실제 변경 대상은 약 70개 파일**. 다만 #11(17)·#35(8) 합계 25파일은 모두 '동일 3줄짜리 사본 포매터'라, KST 고정 시각 유틸 1~2본을 먼저 신설하고 일괄 치환하면 리뷰 부담은 파일 수보다 훨씬 작다. 권장 착수 순서: #26(문서 경고) → #1(R1) → KST 유틸 신설 → R2 → R3.


---

## 부록 A. 감사 방법·범위

### A-1. 판정 규범 (지시서 §0)

| 계층 | 규범 |
|---|---|
| 저장 | UTC (`timestamptz`). `timestamp`(without tz) 컬럼·값은 그 자체로 지적 대상 |
| 사용자 입력 해석 | **KST** — 사람이 화면에서 고른 날짜·시각은 한국 시간 의도 |
| 화면 표시 | KST 고정이 원칙. 브라우저 로컬 의존은 "모호" |
| 도메인 경계(일·월 마감) | KST — 정산 cutoff·"이번 달"·"오늘" 집계는 KST 달력 |
| 스케줄 | pg_cron·Vercel cron 표현식은 **UTC로 실행** — "매일 아침"류 의도면 KST−9h 보정이 있어야 정상 |
| 상대 시간 | `interval '24 hours'`·lease·backoff 등 순수 간격은 **감사 제외** |

### A-2. 수집·판정 절차

1. **수집** — 지시서 §1의 패턴 집합을 `app`·`components`·`lib`·`e2e`·`scripts`(TS/TSX 919파일 중 히트 184파일)와 `supabase/sql`(219파일)·`supabase/baseline`·`supabase/migrations`(히트 196파일)에 전수 grep. 라이브 DB는 MCP 읽기 전용 SELECT로 `pg_proc`·`pg_policies`·`pg_views`·`cron.job`·`information_schema.columns`를 조회.
2. **경계화** — grep 히트를 나열하지 않고 "값이 생성·해석·비교·표시되는 한 지점"의 흐름 단위로 묶었다. 20개 범위(웹 10 · DB/SQL 4 · 보강 6)로 분할해 병렬 수집했고, 범위 간 위임(“타 담당”)은 별도 대조표로 수령 여부를 확인했다.
3. **판정** — 경계마다 ① 현재 기준(UTC/KST/브라우저 로컬/서버 로컬/불명) ② 의도 기준 ③ `정상|버그|모호|규범이의|제외`. 실행 경로가 불명이면 추측하지 않고 모호로 두고 확인 방법을 적었다.
4. **검증** — 버그·모호 판정 전건(병합 후 36건)에 대해 ① 인용 전수 대조(파일을 열어 라인·원문 확인) ② 반박 가설 최소 2개 수립·검증(도달 불가 경로 / 클라이언트 전용 / 상쇄 로직 / 레거시 미사용 / KST 포매터 기통과) ③ 모호 해소 시도 ④ 심각도 재판정을 수행했다.
5. **완전성 비평** — 지시서 §3 체크리스트 대비 매트릭스와 범위 간 위임 대조로 미판정 표면을 찾아 6건을 보강 감사했다(법률 시행일, 멘토 휴식 빈도 게이트, 관리자 정산 툴팁·레거시 dead path, 테스트 픽스처, 리뷰 자격·잔여 표면, 구독 월 산술).

### A-3. 확정된 환경 사실

- **DB**: Supabase Postgres 17.6, `SHOW timezone` = **UTC**. PostgREST는 `timestamptz`를 항상 오프셋(`+00:00`) 포함 ISO로 반환한다.
- **서버**: Vercel 서버리스 — 서버 시계 UTC(`process.env.TZ` 설정 없음). **브라우저**: 사용자 로컬(한국 사용자 = KST).
- **`timestamp without time zone` 컬럼**: 앱 스키마 **0건**(전 22건이 `auth`·`realtime`·`storage` 등 Supabase 관리 스키마) — 저장 규범 위반 없음.
- **`public`의 `date` 컬럼 3개**: `identity_verifications.birthdate` · `payout_runs.run_date` · `users.birth_date`. 생년월일 2건은 달력 사실 그대로라 정상, `run_date`는 §3 모호 항목과 연결된다.
- **시간 관련 라이브 함수 79본** 전체 원문(`pg_get_functiondef`), 시간 조건 **RLS 2건**(`app_notices_select`·`promotion_campaigns_select`), 시간 의존 **뷰 1건**(`due_payouts`)을 대조했다.

### A-4. 캘리브레이션 자가 검증 (지시서 §2-5)

지시서가 미리 확정해 준 3건과 본 감사의 판정이 일치하는지 대조했다 — **3/3 일치**.

| 캘리브레이션 | 지시서 확정 | 본 감사 판정 | 일치 |
|---|---|---|:--:|
| 공지 노출기간 (촉발 건) | S2 버그 | **버그 S2** — 버그표 #2 (`lib/admin/adminNoticesMutations.ts:6`) | ✅ |
| 정산 cutoff `(date_trunc(month …) at time zone 'Asia/Seoul') - 1s` | 정상(KST) | **정상** — `live:public.pay_due_payouts_for_run` 및 `payout_reconciliation_report` 양쪽 KST 확인 | ✅ |
| `notification-outbox` cron `* * * * *` | 정상(주기형) | **정상** — `vercel.json:17`, 주기형이라 시간대 무관 | ✅ |

## 부록 B. 스케줄 전 항목 대조 (UTC 실행 → KST 환산)

| 스케줄 | 표현식(UTC 실행) | KST 환산 | 의도 | 판정 |
|---|---|---|---|:--:|
| `/api/cron/subscription-renewal` | `10 18 * * *` | 익일 **03:10** | 매일 KST 새벽 갱신 배치 | 정상 (−9h 보정됨) |
| `/api/cron/individual-question-expiry` | `40 18 * * *` | 익일 **03:40** | 갱신 30분 후 만료 스캔 | 정상 (−9h 보정됨) |
| `/api/cron/account-deletion` | `0 * * * *` | 매시 정각 | 주기형 | 정상 (시간대 무관) |
| `/api/cron/notification-outbox` | `* * * * *` | 매분 | 주기형 | 정상 (시간대 무관, 캘리브레이션 #3) |
| pg_cron `subscription_settlement_refresh_hourly` | `0 * * * *` | 매시 정각 | 주기형 + `[now()−45일, now())` 롤링 창 | 정상 (시간대 무관) |
| pg_cron `nice_auth_token_sweep_daily` | `20 16 * * *` | **01:20** | 매일 새벽 토큰 스윕 | 정상 (−9h 보정됨, 본문은 순수 간격) |

> 스케줄 자체에는 시간대 결함이 없다. 다만 `subscription-renewal`·`individual-question-expiry` 라우트가 받는 수동 `?at=` 파라미터는 모호 항목 #1로 남는다(무오프셋 입력 시 UTC 해석).

## 부록 C. 감사 범위의 한계 (미수행·잔여)

1. **(선택 B) `ssambership-app` Flutter 표시 계층 — 미수행.** 지시서가 선택 항목으로 둔 대상이며, 본 세션에서 해당 저장소 첨부(`add_repo`)가 권한 정책으로 거부되어 접근하지 못했다. `DateTime.parse` 후 `.toLocal()` 유무와 `intl` 포맷의 기기 로컬 의존 여부는 **미판정 상태로 남는다.** 웹과 동일 DB(UTC 저장)를 읽으므로, 앱이 `.toLocal()` 없이 표시한다면 웹의 표시 계층 결함(버그표 #9~#12 계열)과 같은 유형이 존재할 가능성이 높다 — 별도 세션에서 저장소를 첨부해 확인할 것을 권고한다.
2. **라이브 함수 필터의 사각지대.** 시간 패턴(`now()`·`current_date`·`at time zone`·`date_trunc` 등) 기반으로 79본을 추출했으므로, `interval` 산술만 쓰고 위 패턴이 없는 함수는 1차 덤프에서 빠질 수 있다. 실제로 `process_subscription_renewal`이 그 사례였고 **개별 조회로 원문을 확보해 판정에 반영**했다(버그표 #1). 동일 유형의 잔여 누락 가능성은 낮으나 0은 아니다.
3. **정지 상태 프로젝트 미조회.** 라이브 조회는 활성 프로젝트(`ssambership-staging`)를 대상으로 했다. 운영 DB가 별도라면 동일 스냅샷 대조가 한 번 더 필요하다.
4. **실데이터 대조는 하지 않았다.** 읽기 전용 감사 범위상 스키마·함수·정책 원문만 확인했고, 실제 행 값(예: `payout_runs.run_date` 실적, 잘못 저장된 `app_notices` 행 수)은 조회하지 않았다. 모호 항목의 확인 방법에 해당 질의를 적어 두었다.
