# 10. 관리자 콘솔 (운영 계층) — 존재 목적 리포트

> 대상 라우트 33개 · 요소 행 216개 · 근거: 코드 실측 + 기획 정본

관리자는 플랫폼 신뢰 통제의 집행자다. 멘토 승인(학교인증·학적변경 검토), 콘텐츠 검수(신고 큐), 분쟁 중재(예치금 분배 RPC), 환불 승인/거절, 리뷰 숨김, 계정 상태(정지·경고), 공지·이벤트, 감사로그가 그 수단이다. 모든 admin 서버 액션은 첫 줄 `requireRole("admin")`(lib/admin 내 34곳 실측), 조치는 `admin_action_logs`에 감사 기록(`lib/admin/adminActionLog.ts` `logAdminAction`)된다. 감사 문서 기준 알려진 사실: notices=생성(draft) 전용(수정·삭제 없음), settings=순수 스텁, settlements=읽기전용 의도(지급 실행 컨트롤 없음), `AdminActionPlaceholders`는 대부분 dead code(실노출은 settlements 상세 슬롯 1개).

## 커버 라우트 (검증용 전수 목록)

`docs/architecture/route-inventory.txt`의 `^app/(admin)` 33개 전수.

| # | 파일 | URL / 역할 |
|---|------|-----------|
| 1 | `app/(admin)/layout.tsx` | `/admin/*` 세그먼트 가드 (login 제외 `requireRole("admin")`) |
| 2 | `app/(admin)/admin/login/page.tsx` | `/admin/login` 관리자 로그인 |
| 3 | `app/(admin)/admin/(console)/layout.tsx` | 콘솔 쉘 (`AdminConsoleShell`) + 2차 `requireRole("admin")` |
| 4 | `app/(admin)/admin/(console)/page.tsx` | `/admin` → `/admin/dashboard` 리다이렉트 |
| 5 | `.../dashboard/page.tsx` | `/admin/dashboard` 관리자 대시보드 |
| 6 | `.../mentor-approval/page.tsx` | `/admin/mentor-approval` 멘토 승인 |
| 7 | `.../mentor-approvals/page.tsx` | `/admin/mentor-approvals` → `/admin/mentor-approval` 리다이렉트 |
| 8 | `.../mentor-approvals/[id]/page.tsx` | `/admin/mentor-approvals/[id]` 멘토 승인 상세(cap 조정) |
| 9 | `.../mentors/page.tsx` | `/admin/mentors` → `/admin/mentor-approvals` 리다이렉트 |
| 10 | `.../mentor-activity/page.tsx` | `/admin/mentor-activity` 멘토 활동 관리 |
| 11 | `.../academic-record-changes/page.tsx` | `/admin/academic-record-changes` 학적변경 요청 |
| 12 | `.../school-classifications/page.tsx` | `/admin/school-classifications` 학교군·전공계열 분류 |
| 13 | `.../users/page.tsx` | `/admin/users` 계정 관리 (265줄) |
| 14 | `.../moderation/page.tsx` | `/admin/moderation` 콘텐츠 검수 |
| 15 | `.../reports/page.tsx` | `/admin/reports` → `/admin/moderation` 리다이렉트 |
| 16 | `.../reports/[id]/page.tsx` | `/admin/reports/[id]` 신고 상세 |
| 17 | `.../community-content/page.tsx` | `/admin/community-content` 커뮤니티 직접 관리 (315줄) |
| 18 | `.../reviews/page.tsx` | `/admin/reviews` 리뷰 관리 |
| 19 | `.../reviews/[reviewId]/page.tsx` | `/admin/reviews/[reviewId]` 리뷰 상세 |
| 20 | `.../custom-request-orders/page.tsx` | `/admin/custom-request-orders` 맞춤의뢰 주문 운영 (199줄) |
| 21 | `.../disputes/page.tsx` | `/admin/disputes` 신고·분쟁 관리 |
| 22 | `.../disputes/loading.tsx` | 분쟁 목록 Skeleton |
| 23 | `.../disputes/[id]/page.tsx` | `/admin/disputes/[id]` 분쟁 상세(예치 분배) |
| 24 | `.../disputes/[id]/loading.tsx` | 분쟁 상세 Skeleton |
| 25 | `.../refunds/page.tsx` | `/admin/refunds` 환불 관리 (510줄) |
| 26 | `.../refunds/loading.tsx` | 환불 목록 Skeleton |
| 27 | `.../refunds/[id]/page.tsx` | `/admin/refunds/[id]` 환불 상세 |
| 28 | `.../refunds-settlement/page.tsx` | `/admin/refunds-settlement` → `/admin/refunds` 리다이렉트 |
| 29 | `.../settlements/page.tsx` | `/admin/settlements` 정산 관리 (183줄, 읽기전용 의도) |
| 30 | `.../sla/page.tsx` | `/admin/sla` SLA 대시보드 |
| 31 | `.../notices/page.tsx` | `/admin/notices` 공지 및 프로모션 |
| 32 | `.../audit-logs/page.tsx` | `/admin/audit-logs` 감사 로그 |
| 33 | `.../settings/page.tsx` | `/admin/settings` 시스템 설정 (스텁) |

**리다이렉트 5종의 존재 목적 (구 URL 보존)**

| 요소 (표시 라벨) | 종류 | 소스 | 연결 동작 | 추론한 존재 목적 |
|---|---|---|---|---|
| (UI 없음) `/admin` → `/admin/dashboard` | redirect | `(console)/page.tsx` | `redirect()` | 콘솔 루트 진입 시 기본 화면 지정 — 사이드바·CTA가 `/admin`을 링크해도 대시보드로 수렴 |
| (UI 없음) `/admin/reports` → `/admin/moderation` | redirect | `reports/page.tsx` (`ReportsLegacyRedirect`) | `redirect()` | 신고 큐 구 URL 보존 — 신고 목록이 "콘텐츠 검수"로 개편된 뒤에도 북마크·내부 링크(`/admin/reports/[id]`의 "← 신고 목록" 등) 유지 |
| (UI 없음) `/admin/mentor-approvals` → `/admin/mentor-approval` | redirect | `mentor-approvals/page.tsx` (`MentorApprovalsLegacyRedirect`) | `redirect()` | 복수형 구 URL 보존 — 상세(`/admin/mentor-approvals/[id]`)는 그대로 두고 목록만 단수형 통합 화면으로 수렴 |
| (UI 없음) `/admin/mentors` → `/admin/mentor-approvals` | redirect | `mentors/page.tsx` | `redirect()` | 주석 원문 "예상 URL `/admin/mentors` — 실제 멘토 운영 메뉴는 멘토 승인으로 통합됨" — 추측성 진입 URL을 승인 화면으로 흡수 (2단 리다이렉트로 최종 `/admin/mentor-approval` 도달) |
| (UI 없음) `/admin/refunds-settlement` → `/admin/refunds` | redirect | `refunds-settlement/page.tsx` | `redirect()` | 주석 원문 "환불·정산 통합 경로 별칭" — 사이드바 라벨 "환불·정산"에 대응하는 합성 URL을 환불 화면으로 수렴 |

---

## 화면별 상세

### (공통) `/admin/*` 세그먼트 가드 — `app/(admin)/layout.tsx`

**바인딩**: `headers()`의 `x-pathname` → `/admin/login` 여부 판정, 그 외 전부 `requireRole("admin")`.
**화면의 존재 목적**: 콘솔의 모든 화면이 렌더 전에 관리자 권한을 통과하게 하는 1차 방벽. `(console)/layout.tsx`의 2차 호출과 합쳐 이중 가드가 되며, 각 페이지의 service_role RLS 우회 사용(`// [보안 주석]` 반복)을 정당화하는 전제다.

| 요소 (표시 라벨) | 종류 | 소스 | 연결 동작 | 추론한 존재 목적 |
|---|---|---|---|---|
| (UI 없음) 로그인 경로 예외 | 조건 분기 | `layout.tsx:10-13` | `pathname === "/admin/login"`이면 가드 생략 | 비로그인 관리자가 로그인 화면 자체에는 도달 가능해야 함 |

### /admin/login — 관리자 로그인

**바인딩**: `getServerUserWithProfile()` — 이미 admin이면 `resolvePostLoginPath`로 즉시 redirect. `?error=`, `?next=` 쿼리 소비(`safeInternalNextPath`로 내부 경로만 허용).
**화면의 존재 목적**: 일반 회원 로그인과 분리된 운영자 전용 진입점(다크 테마 `bg-slate-950`로 학생·멘토 화면과 시각적으로 구분). `next` 파라미터로 가드에서 튕긴 원래 목적지 복귀를 보장한다.

| 요소 (표시 라벨) | 종류 | 소스 | 연결 동작 | 추론한 존재 목적 |
|---|---|---|---|---|
| "관리자 로그인" (h1) / "쌤버십 운영자 전용 페이지입니다. 관리자 계정으로 로그인해주세요." | 제목·안내 | page.tsx:29-32 | — | 일반 사용자의 오진입 차단 안내 |
| (에러 배너) `{err}` | 조건부 알림 | page.tsx:34-38 | `?error=` 존재 시에만 렌더, `role="alert"` | 로그인 실패 사유의 redirect 왕복 전달 |
| hidden `next` | hidden input | page.tsx:41-43 | `nextSafe`가 있고 `/admin/login`으로 시작하지 않을 때만 렌더 | 로그인 후 원래 목적지 복귀 + 로그인 페이지 자기참조 루프 방지 |
| "이메일" | input(email, required) | page.tsx:45-56 | form 필드 | 관리자 계정 식별자 입력 |
| "비밀번호" | input(password, required) | page.tsx:59-69 | form 필드 | 자격 증명 입력 |
| "관리자 로그인" | submit 버튼 | page.tsx:71-76 | `adminEmailLoginAction` (`lib/auth/adminLoginActions`) | 이메일·비밀번호 검증 후 admin role 세션 성립 |

### (console) layout — 콘솔 쉘·사이드바 네비

**바인딩**: `requireRole("admin")` → `profile`을 `AdminConsoleShell`에 주입. 쉘 = 사이드바(`AdminConsoleNavSidebar`, lg 이상) + 모바일 상단 네비(`AdminConsoleNavTop`, lg 미만) + 상단 바(`AdminConsoleTopBar`, lg 이상) + `<main>`.
**화면의 존재 목적**: 일반 `AppShell`과 분리된 운영 백오피스 프레임(주석 원문 "관리자 콘솔 전용 쉘 — 일반 AppShell과 분리"). 사이드바 240px(접힘 72px)는 기획 정본(콘솔 사이드바 240px)과 일치. 네비 항목은 `adminConsoleNavConfig.ts`의 `ADMIN_CONSOLE_NAV` 16개 — 관리자 업무(신뢰 통제)의 전체 지도를 한 열에 고정한다.

사이드바 메뉴 16개 (`.map()` 1행 — `NavLinks`가 16개 반복, `adminNavItemIsActive`로 현재 경로 강조):

| 요소 (표시 라벨) | 종류 | 소스 | 연결 동작 | 추론한 존재 목적 |
|---|---|---|---|---|
| "대시보드" | nav 링크 | adminConsoleNavConfig.ts:3 | `/admin/dashboard` (`/admin`도 active 매칭) | 운영 현황 요약 진입점 — 당일 이슈를 먼저 보게 하는 기본 랜딩 |
| "멘토 승인" | nav 링크 | :4 | `/admin/mentor-approval` | 공급자(멘토) 품질 게이트 — 학교인증 심사 큐 상시 접근 |
| "계정 관리" | nav 링크 | :5 | `/admin/users` | 제재 집행(정지·차단·경고)의 단일 진입점 |
| "멘토 활동" | nav 링크 | :6 | `/admin/mentor-activity` | 멘토 이탈·중단 이벤트의 정산 보류 심사 진입점 |
| "학적변경 요청" | nav 링크 | :7 | `/admin/academic-record-changes` | 승인 후에도 학적이 변하는 멘토의 재검증 큐 |
| "분류 관리" | nav 링크 | :8 | `/admin/school-classifications` | 심사 기준 데이터(학교군·전공계열 catalog) 유지보수 |
| "콘텐츠 검수" | nav 링크 | :9 | `/admin/moderation` | 신고 기반 검수 큐 — 커뮤니티 신뢰 유지의 주 채널 |
| "커뮤니티 관리" | nav 링크 | :10 | `/admin/community-content` | 신고 없이도 선제 조치가 필요한 콘텐츠의 직접 검색·조치 |
| "리뷰 관리" | nav 링크 | :11 | `/admin/reviews` | 멘토 평판 데이터(리뷰)의 노출 통제 |
| "맞춤의뢰 주문" | nav 링크 | :12 | `/admin/custom-request-orders` | 분쟁·환불의 원천인 주문 상태의 읽기 전용 파악 |
| "신고·분쟁" | nav 링크 | :13 | `/admin/disputes` | 금전이 걸린 분쟁 중재(예치 분배·제재) 진입점 |
| "환불·정산" | nav 링크 | :14 | `/admin/refunds` | 환불 승인/거절 큐 — 라벨이 정산까지 포괄(별칭 `/admin/refunds-settlement` 참조) |
| "SLA 대시보드" | nav 링크 | :15 | `/admin/sla` | 처리 기한(특히 멘토중단 환불 5일) 준수 감시 |
| "이벤트 관리" | nav 링크 | :16 | `/admin/notices` | 공지·프로모션 발신 — 화면 제목은 "공지 및 프로모션"(라벨과 상이)¹ |
| "활동 로그" | nav 링크 | :17 | `/admin/audit-logs` | 조치의 사후 검증(감사) 진입점 — 화면 제목은 "감사 로그"¹ |
| "시스템 설정" | nav 링크 | :18 | `/admin/settings` | 요금제·수수료 등 정책 설정의 예약 자리(현재 스텁) |

¹ 코드≠기획 각주: 네비 라벨("이벤트 관리", "활동 로그")과 해당 화면 제목("공지 및 프로모션", "감사 로그")이 다르다. 코드 실측 사실만 기록.

쉘 나머지 요소:

| 요소 (표시 라벨) | 종류 | 소스 | 연결 동작 | 추론한 존재 목적 |
|---|---|---|---|---|
| "쌤버십 Admin" / "운영 백오피스" (접힘 시 "S") | 브랜드 링크 | AdminConsoleNav.tsx:38-47 | `/admin/dashboard` | 어느 화면에서든 대시보드 복귀 + 운영 영역임을 표기 |
| "메뉴 접기" / (접힘 시 화살표) | 토글 버튼 | AdminConsoleNav.tsx:68-76 | `useState(collapsed)` — 240px↔72px | 넓은 표(환불 min-w 1120px 등)를 위한 가로 공간 확보 |
| "로그아웃" (사이드바 하단·모바일 상단·탑바) | 링크 | AdminConsoleNav.tsx:64, :90 / AdminConsoleTopBar.tsx:21-26 | `/logout` | 운영 세션 즉시 종료 — 관리자 계정 탈취 리스크 축소 (추정) |
| "운영" 배지 | 배지 | AdminConsoleTopBar.tsx:15-17 | — | 현재 세션이 운영 권한임을 상시 상기 |
| (관리자 이름+역할 배지) | 표시 | AdminConsoleTopBar.tsx:20 / AdminConsoleNav.tsx:89 | `UserNameWithRoleBadge` — 01 공용 사전 참조 | 조치 주체(누구로 로그인했는지) 확인 |

### /admin/dashboard — 관리자 대시보드

**바인딩**: `loadAdminDashboardExtended(supabase)` (`lib/admin/adminDashboardExtended.ts`) — `users` 생성일 카운트(오늘/어제/7일), `cash_ledger.delta_cents` 절대값 합산(일별, 5000행 한도, ÷100로 원 환산), `loadAdminDashboardSummary`(승인 대기 멘토·미처리 신고·분쟁 처리중·환불 대기), `content_reports` 최근 5건. `schedule`은 빈 배열 고정(주석 원문 "실데이터 연동 전까지 하드코딩 일정 제거"). 뷰는 `AdminDashboardView`(client, recharts).
**화면의 존재 목적**: 운영자가 로그인 직후 "오늘 처리해야 할 신뢰 통제 업무의 양"을 수치로 보는 화면. KPI 4장이 각각 담당 큐로 링크되어 대시보드=업무 분배기 역할을 한다.

| 요소 (표시 라벨) | 종류 | 소스 | 연결 동작 | 추론한 존재 목적 |
|---|---|---|---|---|
| "관리자 대시보드" / "운영 현황을 한눈에 확인합니다." | 제목 | AdminDashboardView.tsx:57-58 | — | 화면 정체성 |
| KPI 카드 "오늘 신규 가입" (값+ "어제 대비 ±N%") | KPI 링크 카드 | adminDashboardExtended.ts:91-97 | `/admin/audit-logs` | 플랫폼 성장 맥박 — `users.created_at` 당일 카운트를 어제와 비교해 이상 급증·급감 감지 |
| KPI 카드 "승인 대기 멘토" (sub "승인 대기") | KPI 링크 카드 | :98-104 | `/admin/mentor-approval` | 공급 병목 감시 — 심사 적체 시 즉시 승인 큐로 이동 |
| KPI 카드 "미처리 신고" (sub "검토·대기") | KPI 링크 카드 | :105-111 | `/admin/moderation` | 신뢰 훼손 리스크의 최우선 지표 — 미처리 신고 수 상시 노출 |
| KPI 카드 "금일 캐시 거래액" (sub "원장 기준 추정") | KPI 링크 카드 | :112-118 | `/admin/refunds` | 금전 흐름 규모 파악 — `cash_ledger` 절대값 합산이라 "추정"으로 명시, 이상 거래 시 환불 큐로 연결 |
| KPI 카드 렌더 | `.map()` | AdminDashboardView.tsx:62-72 | `kpis.map` — 4개 반복 | 위 4장 공통 렌더(전체가 Link) |
| "7일 가입·거래 추이" (LineChart: "가입" 좌축 / "거래(원)" 우축) | recharts 차트 | AdminDashboardView.tsx:76-91 | `trend` 7일 루프 집계 | 가입(수요)과 캐시 거래(매출 프록시)를 이중 축으로 겹쳐 성장·과금의 동행 여부를 주 단위로 감시 |
| "문의·신고 처리 상태" (PieChart 도넛: "분쟁 처리중" #2563EB / "신고 대기" #F59E0B) | recharts 차트 | AdminDashboardView.tsx:93-114 / 데이터 :133-136 | `donut.some(v>0)`일 때만 차트, 아니면 "표시할 데이터가 없어요" | 미결 업무의 구성비 — 주석 원문 "실집계만 사용 — KPI(신고 대기·분쟁 처리중)와 수치를 일치시킴. 임의 샘플값 제거." |
| "최근 운영 이슈" 표 (열: 유형/제목/상태/접수시간/담당자) | 테이블 | AdminDashboardView.tsx:117-167 | `issues.map` — 최근 신고 5개 반복, 제목이 `/admin/moderation` 링크 | 최신 접수 건을 대시보드에서 바로 열게 하는 인박스. `assignee`는 "—" 고정(담당자 배정 미구현)² |
| (빈 상태) "아직 최근 운영 이슈가 없어요" | 조건부 행 | :134-139 | `issues.length === 0`일 때 | 큐 클리어 상태 확인 |
| "더 보기 ∨" | 버튼 | AdminDashboardView.tsx:169-172 | `type="button"` — onClick 없음(실측 비동작) | 이슈 목록 확장 자리 (추정) |
| "빠른 작업" 6개: "멘토 승인"·"콘텐츠 검수"·"신고·분쟁 확인"·"리뷰 관리"·"환불 요청 확인"·"이벤트 만들기" | 링크 그리드 | AdminDashboardView.tsx:21-28, 177-189 | `QUICK_LINKS.map` — 6개 반복 | 고빈도 업무 6종의 원클릭 진입 — 사이드바 스크롤 없이 처리 시작 |
| "오늘 일정" + "전체 보기 >" | 목록·링크 | AdminDashboardView.tsx:192-210 | `schedule.map`(현재 항상 빈 배열 → "아직 등록된 일정이 없어요") / 링크 `/admin/notices` | 공지·이벤트 노출 일정과 운영 일정을 겹쳐 볼 자리 — 데이터 연동 전 빈 상태 유지 |
| "+ 일정 추가" | 버튼 | AdminDashboardView.tsx:211-216 | `type="button"` — onClick 없음(실측 비동작) | 일정 등록 기능 예약 자리 (추정) |

² 코드≠기획 각주: 이슈 표에 "담당자" 열이 존재하지만 값은 항상 "—" — 담당자 배정 모델 미연결 상태의 사실 표기.

### /admin/mentor-approval — 멘토 승인

**바인딩**: `requireRole`은 레이아웃 이중 가드. `loadAdminMentorApprovalsListPaged`+`countAdminMentorApprovalsByStatus`(멘토 신청), `loadMentorSchoolVerificationReviewRows`(학교·전공 인증 50건), `loadSchoolClassificationCatalogs`/`loadSchoolTierMappings`(분류·매핑 → 학교군 추천 계산), `mentorProfilesAdminReadClient`(service_role 읽기)로 사용자 표시명, `resolveStudentIdImageSignedUrl`로 학생증·서류 signed URL(300초) 발급. `?ok=`/`?error=` flash 소비(approve/reject/documents + school-approve/school-reject/school-resubmit 6종 메시지).
**화면의 존재 목적**: 멘토 공급의 품질 게이트 그 자체. "멘토 신청 승인"과 "학교·전공 인증 검증"이라는 두 심사를 한 화면(목록+우측 상세 aside)에서 처리해, 서류(학생증·증명서) 확인 → 검증값 입력 → 승인/반려가 끊기지 않게 한다.

| 요소 (표시 라벨) | 종류 | 소스 | 연결 동작 | 추론한 존재 목적 |
|---|---|---|---|---|
| (flash) "승인했습니다." / "반려했습니다." / "추가 서류를 요청했습니다." / "학교·전공 인증을 승인했습니다." 등 | 조건부 배너 | page.tsx:33-50, 128-129 | `?ok=`/`?error=` 존재 시 | redirect 왕복 후 조치 결과 확인 |
| 검색 "멘토 ID/대학·학과/고교/소개로 검색" + 상태 탭 "대기·제출됨·검토 중·승인·반려·전체"(건수) | 공용 툴바 | page.tsx:130-135 | `AdminListToolbar` (01 공용 사전 참조) — GET `?q=&status=` | 심사 큐를 상태별로 분할해 적체 파악 |
| "멘토 승인" / "멘토 가입 승인과 학교·전공 인증 서류를 검토합니다." | 제목 | AdminMentorApprovalWorkspace.tsx:135-136 | — | 화면 정체성 |
| "학교·전공 인증 대기" 표 (열: 멘토/참고 학교/참고 학과/상태/제출일, 건수 배지) | 선택 테이블 | Workspace:141-201 | `schoolVerificationRows.map` — N개 반복, 행 클릭 시 `setSelectedSchoolVerificationId` | 인증 요청 목록에서 심사 대상 1건을 우측 패널로 로드 |
| (빈/오류) "심사 대기 중인 학교·전공 인증이 없습니다." / "학교 인증 요청을 불러오지 못했습니다." | 조건부 | :151-157 | rows 0건 / loadError 시 | 큐 상태 명시 |
| 클라이언트 필터 "전체·대기·승인·반려" | 버튼 4개 | Workspace:88-93, 204-218 | `FILTERS.map` — 4개 반복, `useState(filter)` + 정규식 상태 매칭 | 서버 탭과 별개로 로드된 페이지 안에서 즉시 좁히기 |
| 멘토 신청 표 (열: 이름/학교/학과/신청일/상태) | 선택 테이블 | Workspace:220-252 | `filtered.map` — N개 반복, 행 클릭 시 `setSelectedId` | 승인 대상 신청 1건 선택 |
| (우측 aside 빈 상태) "목록에서 심사할 항목을 선택하세요." | 조건부 | Workspace:257-258 | 선택 없음일 때 | 마스터-디테일 사용법 안내 |
| "학교·전공 검증" 요약 dl ("멘토 자유입력 학교/학과", "제출일", "문서 경로") | 상세 표시 | Workspace:261-290 | `selectedSchoolVerification` 존재 시 | 멘토 자기신고 값과 서류를 나란히 대조 |
| (서류 미리보기 iframe "학교·전공 증명 서류") + "새 창에서 서류 열기" | iframe·링크 | Workspace:292-307 | signed URL 있을 때만, 없으면 "서류 signed URL을 만들 수 없습니다." | 비공개 버킷 서류를 화면 이탈 없이 검토(300초 만료 링크) |
| "학교군 추천: {학교명} → {학교군}" | 조건부 배지 | Workspace:314-321 | `schoolTierSuggestionByVerificationId` 매핑 존재 시 | `/admin/school-classifications`의 매핑 표를 심사 시점에 자동 추천으로 환류 |
| "검증 학교명"(required) / "정규화 학교 키"(placeholder "비우면 학교명 기반으로 자동 생성") / "검증 학과명"(required) / "전공 계열" select / "학교군" select | 승인 폼 입력 | Workspace:323-388 | `majorCategoryOptions.map`·`schoolTierOptions.map` — 각 N개 반복 | 자유입력을 관리자 확정 정본(verified_*)으로 정규화 — 멘토 찾기 필터·등급의 데이터 품질 원천 |
| "검증값 저장 후 승인" | submit | Workspace:389-393 | `approveMentorSchoolVerificationAction` (`mentorSchoolVerificationReviewActions.ts`, 첫 줄 requireRole) | 검증값 저장과 승인 상태 전이를 원자적으로 |
| "재제출 요청" (+ textarea "재제출 요청 사유" required) | submit 폼 | Workspace:397-411 | `requestMentorSchoolVerificationResubmitAction` | 반려 아닌 보완 루프 — 사유 필수로 멘토에게 무엇이 부족한지 전달 |
| "반려" (+ textarea "반려 사유" required) | submit 폼 | Workspace:412-426 | `rejectMentorSchoolVerificationAction` | 인증 거부의 종결 처리 — 사유 필수화로 자의적 반려 방지 |
| (멘토 신청 상세) 이름 + "멘토 승인 상태: …" + 학생증 이미지(or "학생증 이미지 없음") | 상세 표시 | Workspace:431-444 | `selected` 존재 시, img는 signed URL 있을 때만 | 신원(학생증)과 상태를 승인 직전 최종 확인 |
| "승인" (+ input "승인 메모(선택)") | submit 폼 | Workspace:447-453 | `approveMentorApplicationAction` (`mentorApprovalActions.ts`) | 멘토 자격 부여 — 메모는 감사 로그 문맥 |
| "추가 서류 요청" (+ input "추가 서류 요청 사유") | submit 폼 | Workspace:454-460 | `requestMentorDocumentsAction` | 판단 불가 건의 보류·보완 요청 |
| "반려" → 모달 "반려 사유 입력" (textarea required, "취소"/"반려 확정") | 버튼→모달 폼 | Workspace:461-506 | `setRejectOpen(true)` → `rejectMentorApplicationAction` | 되돌리기 어려운 반려를 2단계(모달+사유 필수)로 — 오클릭 방지 |
| 페이지네이션 "총 N건 · a–b 표시" + "← 이전"/"다음 →" | 공용 | page.tsx:150-155 | `AdminListPagination` (01 공용 사전 참조) | 대량 큐 순회 |

### /admin/mentor-approvals/[id] — 멘토 승인 상세 (cap 조정)

**바인딩**: `requireRole("admin")` 명시 호출. `fetchMentorProfileRow`+`getUserProfileById`로 표시 정보, `loadMentorCapUsage(id)`로 cap 사용량. `?capOk`/`?capError` flash. 주석 원문 "`id`는 멘토 `user_id`(uuid)로 해석합니다."
**화면의 존재 목적**: 개별 멘토의 인증 상태 열람 + 구독 수용량(cap) 상한의 관리자 전용 조정. 승인/반려는 여기서 하지 않는다(설명 원문 "승인·반려는 목록 화면의 액션을 사용해 주세요.") — 이 화면의 유일한 쓰기 권한은 cap이다.

| 요소 (표시 라벨) | 종류 | 소스 | 연결 동작 | 추론한 존재 목적 |
|---|---|---|---|---|
| eyebrow "관리자 / 멘토 승인" · "멘토 승인 상세" + CTA "목록"/"공개 프로필" | PageScaffold 헤더 | page.tsx:34-44 | `/admin/mentor-approvals`, `/mentors/[id]` | 심사 화면과 학생이 보는 실제 공개 프로필의 교차 확인 |
| "표시명" + "인증: {상태}" + "서류 이미지·반려 사유 필드는 스키마 확정 후 이 화면에 붙일 수 있어요." | 정보 카드 | page.tsx:51-58 | `buildMentorProfileDisplay`, `mentorVerificationKo` | 신원·인증 상태 확인 — 마지막 문구는 확장 예약 자리의 사실 표기 |
| "구독 수용량 (cap)" — "{used} / {limit}" + "{N}명 구독 중 · {pct}% 사용" + (조건부) "구독 마감" + 게이지 바 | 지표·게이지 | page.tsx:60-79 | `loadMentorCapUsage` — 80% 이상이면 게이지 주황(#e08a2f) | cap(기획 잠금값 1.0/2.5/4.5의 운영 예외 관리) 소진도 시각화 — 만석 여부 즉시 판별 |
| "cap 상한 (관리자만)" number 입력(step 0.5, 0~1000) + "저장" | 폼 | page.tsx:81-101 | `updateMentorCapLimitAction` (`mentorCapAdminActions.ts`) | 표준 요금제 cap을 벗어난 개별 멘토 상한 조정 — 관리자 전용임을 라벨에 명시 |
| (flash) "cap 상한을 저장했습니다." / `{capError}` | 조건부 | page.tsx:102-103 | `?capOk`/`?capError` | 저장 결과 확인 |

### /admin/mentor-activity — 멘토 활동 관리

**바인딩**: `loadMentorActivityEvents({limit:100})` (`mentorActivityQueries.ts`). `?ok=`/`?error=` flash. 이벤트 라벨 5종(`termination_requested`="활동 종료 신청" 등), 상태 4종("기록/검토 대기/보류 확정/구제(해제)").
**화면의 존재 목적**: 멘토가 사라졌을 때 학생 구독료와 멘토 정산 사이의 심판. 설명 원문 "무단 이탈 의심 건은 자동으로 0 처리하지 않고 정산을 보류하며, 여기서 보류 확정 또는 구제(해제)를 결정합니다." — 자동 몰수 금지 원칙을 사람 판단으로 집행한다.

| 요소 (표시 라벨) | 종류 | 소스 | 연결 동작 | 추론한 존재 목적 |
|---|---|---|---|---|
| 섹션 "처리 원칙": "무단 이탈은 정산 자동 0 처리 금지 — 보류 후 관리자가 최종 확인합니다. 불가피한 사유는 구제로 정산을 복원하세요." | 안내 | page.tsx:51-57 | — | 운영 판단 기준의 화면 내 상주 |
| KPI "검토 대기 {N}건" / "전체 이벤트 {N}건" | 카드 2 | page.tsx:70-79 | `pending_review` 필터 카운트 | 심사 적체량 즉시 파악 |
| 이벤트 표 (열: 멘토/이벤트/상태/발생일/처리) | 테이블 | page.tsx:91-165 | `rows.map` — 최대 100개 반복 | 이벤트별 심사 |
| "보류 확정" | submit(행 내) | page.tsx:124-133 | `approveMentorAbandonmentHoldAction` — 조건: `event_type==="abandonment_suspected" && status==="pending_review"` | 무단 이탈 확정 → 해당 정산 보류를 확정 상태로 |
| "구제(해제)" | submit(행 내) | page.tsx:134-143 | `releaseMentorSettlementHoldAction` — 동일 조건 | 소명된 이탈의 정산 복원 — 몰수 오판 교정 장치 |
| "유예 만료 정리(환불 생성)" | submit(행 내) | page.tsx:145-155 | `finalizeMentorTerminationAdminAction` — 조건: `event_type==="termination_requested"` | 활동 종료 유예기간 만료 시 잔여 구독의 환불 요청을 일괄 생성 — `/admin/refunds`의 "멘토중단 ⏱5일" 큐 공급원 |
| (빈/오류) "멘토 활동 이벤트가 아직 없습니다." / "목록을 불러오지 못했습니다." | 조건부 | page.tsx:81-89 | error/0건 분기 | 큐 상태 명시 |

### /admin/academic-record-changes — 학적변경 요청

**바인딩**: `requireRole("admin")` 명시. `loadAdminAcademicRecordChangesListPaged`+`countAdminAcademicRecordChangesByStatus`, `mentorProfilesAdminReadClient`(service_role)로 이름·프로필, `resolveStudentIdImageSignedUrl`로 서류 링크. flash 3종("학적변경요청을 승인하고 학교 정보를 반영했습니다." 등).
**화면의 존재 목적**: 승인은 1회지만 학적(편입·재입학 등)은 변한다 — 이미 활동 중인 멘토의 학교 정보 갱신을 서류 재검증 없이는 허용하지 않는 관문. 안내 원문 "서류를 확인한 뒤 확정 학교명을 입력해 승인하면 멘토 프로필 학교가 갱신됩니다."

| 요소 (표시 라벨) | 종류 | 소스 | 연결 동작 | 추론한 존재 목적 |
|---|---|---|---|---|
| "학적변경 요청" / "멘토가 제출한 학적 변동 증명 서류를 확인하고 학교 정보를 갱신합니다." | 제목 | page.tsx:80-85 | — | 화면 정체성 |
| 검색 "요청 ID/멘토/대학교/사유로 검색" + 상태 탭 "대기·재제출 필요·승인·반려·전체" | 공용 툴바 | page.tsx:86-91 | AdminListToolbar (01 공용 사전 참조) | 재검증 큐 분류 |
| 요청 카드 (멘토명/멘토 ID/제출일 + 상태 배지 "심사 대기"/"재제출 필요") | 카드 | Workspace:67-81 | `rows.map` — N개 반복(카드형, 페이지당 25) | 건별 전체 맥락(현재↔요청↔사유)을 한 카드에 |
| "현재 학교(프로필)" / "요청 학교명" / "변경 사유" 3분할 | 비교 표시 | Workspace:83-96 | — | 변경 전후 대조 — 허위 상향 신고 탐지 근거 |
| "제출 서류" → "서류 열기 (단기 링크)" (없으면 "첨부 서류를 불러올 수 없습니다.") | 링크 | Workspace:98-112 | signed URL 새 창 | 비공개 버킷 증빙의 시한부 열람 |
| "확정 학교명 (승인 시 멘토 프로필에 반영)" input + "승인하고 학교 반영" | 폼 | Workspace:114-134 | `approveMentorAcademicRecordChangeAction` | 요청값 그대로가 아닌 관리자 확정값으로 프로필 갱신 — 표기 정규화 유지 |
| "재제출 요청 사유" input + "재제출 요청" | 폼 | Workspace:136-155 | `requestMentorAcademicRecordChangeResubmitAction` | 서류 불충분 시 보완 루프(placeholder "어떤 서류가 더 필요한지 안내") |
| "반려 사유" input + "반려" | 폼 | Workspace:157-176 | `rejectMentorAcademicRecordChangeAction` | 근거 없는 변경 요청 종결 |
| (빈/오류) "처리할 학적변경요청이 없습니다." / "학적변경요청 목록을 불러오지 못했습니다: …" | 조건부 | Workspace:46-60 | loadError/0건 | 큐 상태 명시 |

### /admin/school-classifications — 학교군·전공계열 분류

**바인딩**: `loadSchoolClassificationCatalogs`/`loadSchoolTierMappings`(includeInactive) — DB catalog 우선, 실패 시 상수 fallback(하단 "현재 옵션 출처: catalog DB / DB + fallback / fallback 상수" 표기). flash "분류표를 저장했습니다." / "학교군 매핑을 저장했습니다."
**화면의 존재 목적**: 멘토 심사의 판단 기준 데이터(학교군·전공계열 코드표, 학교명→학교군 매핑)를 SQL 배포 없이 운영에서 유지보수하는 화면. 단 코드 자체는 못 만든다 — 안내 원문 "새 분류 code 추가는 운영 협의와 SQL 검토가 필요합니다. 이 화면에서는 기존 code의 라벨·순서·활성만 바꿀 수 있습니다."(077 CHECK 제약 호환 유지).

| 요소 (표시 라벨) | 종류 | 소스 | 연결 동작 | 추론한 존재 목적 |
|---|---|---|---|---|
| "학교군·전공계열 분류" + "077 검증값과 호환되는 code를 유지하면서 라벨, 순서, 활성 상태와 학교명 매핑을 관리합니다." + "멘토 심사" 링크 | 헤더 | page.tsx:169-185 | `/admin/mentor-approval` | 기준표 관리 ↔ 실제 심사 화면 왕복 |
| "학교군 catalog" 편집기 (행: code 고정 표시 / "라벨" input / "순서" number / "활성" checkbox / "저장") | 폼 목록 | page.tsx:199-205, CatalogEditor:32-94 | `rows.map` — 행마다 독립 form, `updateSchoolTierCatalogAction` | 학교군 표기·노출 순서 운영 조정(설명 원문 "건동홍은 중경외시와 그외 사이에 배치합니다.") — code는 읽기전용으로 DB 제약 보호 |
| "전공계열 catalog" 편집기 (동일 구조) | 폼 목록 | page.tsx:206-211 | `updateMajorCategoryCatalogAction` | 전공계열 8종의 라벨·순서만 조정(설명 원문 "기존 077 CHECK 값을 유지합니다.") |
| "학교명 → 학교군 매핑" 신규 폼 ("학교명" required, "학교군" select, "메모", "활성", "추가") | 폼 | page.tsx:214-234, MappingForm:96-152 | `upsertSchoolTierMappingAction` | 심사 화면의 "학교군 추천" 자동화 데이터 등록 — 설명 원문 "공개/anon에는 노출하지 않습니다."(내부 기준표) |
| 기존 매핑 행 편집 폼 (hidden mappingId + 동일 필드 + "저장") | 폼 목록 | page.tsx:235-240 | `mappings.rows.map` — N개 반복 | 개별 매핑 수정·비활성화 |
| (경고) "079 catalog 표가 아직 없거나 읽을 수 없어 상수 fallback을 표시합니다." / "매핑 표를 불러오지 못했습니다. 079 SQL 적용 후 다시 확인해 주세요." | 조건부 | page.tsx:189-193, 227-231 | catalogs.errors / mappings.error | 마이그레이션 미적용 환경의 사실 고지 |
| (빈 상태) "등록된 학교군 매핑이 없습니다." | 조건부 | page.tsx:241-244 | rows 0건 | — |

### /admin/users — 계정 관리 (265줄)

**바인딩**: `loadAdminUsersListPaged`+`countAdminUsersByStatus`(`accountStatusQueries.ts`), `effectiveAccountStatus(row)`로 만료 반영 실효 상태 계산. flash는 `warned:` / `warned_suspended:` 접두 파싱("경고가 누적되어 계정을 자동 일시정지했습니다. (누적 N회)"). 경고 임계 `WARNING_AUTO_SUSPEND_THRESHOLD = 3`(`accountStatusCore.ts:6`).
**화면의 존재 목적**: 제재의 최종 집행 화면. 설명 원문 "정지된 계정은 질문 작성·구독·캐시 출금·커뮤니티 작성 등 핵심 활동이 차단됩니다." — 분쟁 제재(`/admin/disputes`의 7d/30d/영구)가 실제로 반영되는 계정 상태를 직접 조회·변경하고, 경고 누적→자동 정지의 단계적 제재를 운용한다.

| 요소 (표시 라벨) | 종류 | 소스 | 연결 동작 | 추론한 존재 목적 |
|---|---|---|---|---|
| 섹션 "정지 정책": "일시 정지는 기간(일)을 지정하면 그 시각 이후 자동 해제됩니다. 영구 차단은 수동 해제 전까지 유지됩니다. 관리자 계정은 변경할 수 없습니다." | 안내 | page.tsx:72-78 | — | 제재 규칙의 화면 상주 — 자동해제/수동해제 구분 |
| KPI "정상 계정 {N}명"(초록) / "일시 정지 {N}명"(주황) / "영구 차단 {N}명"(빨강) | 카드 3 | page.tsx:99-112 | `countAdminUsersByStatus` | 제재 규모의 상시 파악 |
| 검색 "이메일·닉네임·이름·계정 ID로 검색" + 상태 탭 "전체·정상·정지·차단" | 공용 툴바 | page.tsx:114-119 | AdminListToolbar (01 공용 사전 참조) | 특정 사용자 신속 특정(신고·분쟁 후속 조치) |
| 계정 표 (열: 계정/역할/상태/사유 · 가입일/상태 변경) | 테이블 | page.tsx:131-253 | `rows.map` — 페이지당 25개 반복 | 행 단위 제재 처리 |
| (상태 셀 부속) "{일시} 해제" / "⚠ 경고 {n}/3" | 조건부 표시 | page.tsx:167-182 | `suspended_until` 존재 시 / `warning_count>0` 시(3 이상 빨강) | 자동 해제 시점과 자동 정지 임박도 노출 |
| "관리자 (변경 불가)" | 조건부 텍스트 | page.tsx:189-190 | `row.role==="admin"`이면 폼 대신 표시 | 관리자 상호 제재 차단 — 권한 상승 공격면 축소 |
| 상태 select ("정상"/"일시 정지"/"영구 차단") + "정지 일수" number + "사유(선택)" + "상태 적용" | 폼(행 내) | page.tsx:192-226 | `setUserStatusAction` (`accountStatusActions.ts`) | 실효 상태의 직접 전이 — 기간 지정 정지 지원 |
| "경고 사유" input + "⚠ 경고 발급" (title "경고 3회 누적 시 자동 일시정지") | 폼(행 내) | page.tsx:228-247 | `issueUserWarningAction` — 조건: 관리자 아닐 때만 | 즉시 정지보다 낮은 단계적 제재 — 3회 누적 시 자동 정지로 에스컬레이션 |
| (빈/오류) "조건에 맞는 계정이 없습니다." / "목록을 불러오지 못했습니다." | 조건부 | page.tsx:121-129 | — | — |
| 페이지네이션 | 공용 | page.tsx:254-259 | AdminListPagination (01 공용 사전 참조) | — |

### /admin/moderation — 콘텐츠 검수 (신고 큐)

**바인딩**: `loadAdminReportsListPaged`+`countAdminReportsByStatus`(`content_reports`), `mentorProfilesAdminReadClient`(service_role)로 신고자 표시명. flash "콘텐츠를 숨김 처리했습니다."/"삭제 처리했습니다."/"정상 복구했습니다.". 뷰: `AdminModerationWorkspace` → `AdminContentReportsTable`.
**화면의 존재 목적**: 사용자 신고(`content_reports`)를 받아 ① 신고 티켓의 상태(검토 중/처리 완료/종결)와 ② 신고된 콘텐츠 자체의 노출(숨김/삭제/정상)을 분리해 처리하는 검수 본진. 일괄 처리(bulkActions)로 스팸성 다건 신고를 한 번에 정리한다.

| 요소 (표시 라벨) | 종류 | 소스 | 연결 동작 | 추론한 존재 목적 |
|---|---|---|---|---|
| "콘텐츠 검수" / "신고된 게시글·댓글·숏폼을 검수합니다." | 제목 | AdminModerationWorkspace.tsx:17-18 | — | 화면 정체성 |
| 검색 "신고/대상/사유/메모 검색" + 상태 탭 8개 "대기·검토 중·해결됨·기각·거절·숨김·삭제·전체"(건수) | 공용 툴바 | page.tsx:36-45, 64-69 | AdminListToolbar (01 공용 사전 참조) | 신고 수명주기 전 단계의 분할 조회 |
| "선택 항목 일괄" + "검토 중으로" / "처리 완료로" / "종결로" | bulk submit 3 | AdminContentReportsTable.tsx:81-113 | `id="reportBulkForm"` — 행 체크박스가 `form` 속성으로 연결, `bulkUpdateContentReportsAction`(`bulkActions.ts`, reviewing/resolved/dismissed 화이트리스트, resolved/dismissed 시 `resolved_at`/`resolved_by` 기록) | 동일 대상 다건 신고의 일괄 소진 — 허용 상태 외 값은 서버에서 거부 |
| 신고 표 (열: 선택/신고 ID/신고자/대상/사유/상태/접수일/처리) | 테이블 | Table:114-231 | `list.rows.map` — 페이지당 25개 반복 | 건별 검수 |
| (행) 체크박스 "신고 선택" | checkbox | Table:143-152 | 조건: `contentReportRowIsActionable(status)`일 때만 렌더 | 종결 건의 일괄 재처리 방지 |
| (행) "메모(선택)" textarea + "검토 중" / "처리 완료" / "종결" | 폼+submit 3 | Table:173-207 | `updateContentReportStatusAction`(`adminReportActions.ts`) — `nextStatus` 버튼 value로 분기, 조건: actionable일 때만 | 신고 티켓 상태 전이 + 판단 근거 메모 동시 기록 |
| (행) "숨김" / "삭제" / "정상" | submit 3 | Table:208-219 | `updateContentReportModerationAction` — `intent=hidden/deleted/restored` | 티켓이 아니라 신고 대상 콘텐츠의 노출을 직접 변경 — 상태 처리와 별도 form으로 분리 |
| (빈/오류) "접수된 신고가 없습니다." / `adminListFetchFailedCopy("reports")` 문구 | 조건부 | Table:62-74 | error·0건 분기 | 원문 에러 대신 운영자용 문구(기술 메시지 비노출 원칙) |

### /admin/reports/[id] — 신고 상세

**바인딩**: `requireRole("admin")` 명시. `content_reports`에서 `id`로 단건 `select("*")`.
**화면의 존재 목적**: 신고 원본 레코드의 전량 확인(JSON pre 덤프)과 상태 전이. 목록 표가 요약만 보여주므로, 애매한 건의 원문 필드 전체를 보는 확대경. 설명 원문 "상태 변경은 아래 액션이 연결된 경우에만 동작합니다."

| 요소 (표시 라벨) | 종류 | 소스 | 연결 동작 | 추론한 존재 목적 |
|---|---|---|---|---|
| "← 신고 목록" + CTA "목록"/"대시보드" | 링크 | page.tsx:27-36 | `/admin/reports`(→moderation 리다이렉트) | 큐 복귀 동선 |
| (JSON pre) 신고 행 전체 | 표시 | page.tsx:39-45 | row 존재 시, 없으면 "해당 id의 신고를 찾지 못했습니다." | 스키마 변동에도 전 필드 열람 보장 (추정: 스키마 미확정기의 범용 뷰어) |
| "상태 변경" — "검토 중" / "처리 완료" / "종결" (+안내 "버튼은 서버 액션과 동일한 폼을 사용합니다. 권한·스키마에 따라 실패할 수 있어요.") | submit 3 | page.tsx:47-68 | 각각 hidden `nextStatus=reviewing/resolved/dismissed` → `updateContentReportStatusAction` | 목록과 동일 액션의 상세 화면 버전 — 단건 정독 후 즉시 처리 |

### /admin/community-content — 커뮤니티 콘텐츠 직접 관리 (315줄)

**바인딩**: `requireRole("admin")` 명시 + `createServiceRoleClient()` 우선(RLS 우회, 실패 시 세션 클라이언트 fallback). 타입 3종(`posts`/`shortforms`/`comments`)별 `loadAdminCommunity*ListPaged` + `countAdminCommunityByStatus`. 조치 액션 9종(`communityModerationActions.ts`의 directHide/Restore/Delete × 3타입).
**화면의 존재 목적**: 신고 큐를 우회하는 선제 검수. 안내 원문 "신고가 없어도 글·숏폼·댓글을 검색해서 직접 숨김·삭제·복구할 수 있어요. 처리 시 일반 사용자에게는 즉시 안 보이게 됩니다." — 신고가 들어오기 전의 명백한 위반물(스팸·금지어 등)을 관리자가 능동 제거한다.

| 요소 (표시 라벨) | 종류 | 소스 | 연결 동작 | 추론한 존재 목적 |
|---|---|---|---|---|
| 타입 탭 "글" / "숏폼" / "댓글" | 링크 탭 3 | page.tsx:111-160 | `typeTabs.map` — 3개 반복, `?type=` 쿼리 전환 | `community_posts`/`shortform_posts`/`community_comments` 3저장소(기획: 게시판/숏폼 분리)의 단일 콘솔 통합 |
| 검색(타입별 placeholder "글 ID/제목/본문/카테고리/작성자 검색" 등) + 상태 탭 (posts·shortforms: "전체·공개·숨김·임시" / comments: "전체·노출·숨김") | 공용 툴바 | page.tsx:96-116, 162-167 | AdminListToolbar (01 공용 사전 참조) — 탭 구성이 `type==="comments"` 조건 분기 | 타입별 상태 모델 차이(published/draft vs visible)를 반영한 필터 |
| 콘텐츠 표 (열: ID/내용/상태/작성자/생성일/조치, 헤더에 타입명+총건수 배지) | 테이블 | page.tsx:175-305 | `list.rows.map` — 페이지당 25개 반복. 내용 셀은 title→body→description 80자 우선 표시 | 검색 결과의 건별 판단 |
| (행) "조치 사유(선택)" input | input | page.tsx:264-270 | 같은 form의 `reason` | 선제 조치의 근거 기록 — 이의 제기 대응 |
| (행) "숨김" | submit | page.tsx:281-287 | 조건: `status !== "hidden"`일 때. 타입별 `directHide*Action` | 가역 조치 — 원본 보존한 채 노출 차단 |
| (행) "복구" | submit | page.tsx:272-279 | 조건: `status === "hidden"`일 때(숨김과 상호 배타 렌더). 타입별 `directRestore*Action` | 오판·소명 후 원상복구 |
| (행) "삭제" | submit | page.tsx:289-295 | 항상 렌더. 타입별 `directDelete*Action` | 비가역(강) 조치 — 숨김으로 부족한 위반물 제거 |
| (flash) "처리 완료: {ok}" / `{flashErr}` · (빈 상태) "표시할 콘텐츠가 없습니다." · (오류) "목록 조회 실패: …" | 조건부 | page.tsx:127-136, 169-173, 197-202 | — | — |

### /admin/reviews — 리뷰 관리

**바인딩**: `loadAdminReviewsPage(supabase, 50)` — 리뷰 테이블·컬럼 자동 탐지(`meta`: authorColumn/mentorColumn/ratingColumn/bodyColumn + 조치 가능 여부 `plan`). `fetchAdminUsersDisplayByIds`(service_role 읽기)로 작성자·대상 멘토 표시명. flash 4종("리뷰를 숨김 처리했습니다."/"복원했습니다."/"블라인드 처리했습니다."/"검토 완료로 표시했습니다."). `meta` 없으면 `AdminRecordTable` 범용 표로 fallback.
**화면의 존재 목적**: 멘토 평판 데이터의 노출 통제. 화면 스스로 어휘를 정의한다 — 섹션 원문: "숨김 — 리뷰를 공개 화면과 공개 집계에서 제외합니다. (스팸, 테스트, 중복, 무관한 리뷰 등…) 블라인드 — 민감하거나 위반 가능성이 있는 리뷰를 공개 화면에서 제외하고 블라인드 상태로 기록합니다. (개인정보, 욕설, 외부 연락처, 정책 위반 가능 리뷰…) 검토 완료 — 현재 노출 상태를 유지한 채 검토 완료로 표시합니다." 둘 다 비노출이지만 운영 기록상 구분된다는 점이 이 화면의 핵심 설계.

| 요소 (표시 라벨) | 종류 | 소스 | 연결 동작 | 추론한 존재 목적 |
|---|---|---|---|---|
| "리뷰 목록" + 배지 "전체 리뷰 중 생성일 최신순 최대 50건" | 제목+AdminStatusBadge | page.tsx:86-89 | (01 공용 사전 참조) | 표본 범위 명시 — 페이지네이션 없는 화면임을 고지 |
| 리뷰 표 (열: 리뷰 ID/작성자/대상 멘토/평점/내용/노출·상태/작성일/처리) | 테이블 | AdminReviewsTable.tsx:106-231 | `list.rows.map` — 최대 50개 반복. "노출·상태" th title="표시 우선순위: 블라인드 > 숨김 > 검토 완료 > 공개…" | 리뷰(동일 멘토 2회 연속 결제 후 작성이라는 기획 신뢰 장치)의 상태 열람 |
| (행) "숨김" | submit | Table:173-184 | `moderateAdminReviewAction` `action=hide` — 조건: `plan.hide && !hidden && !blind` | 저품질 리뷰의 집계 제외(title에 위 정의 원문 재수록) |
| (행) "블라인드" | submit | Table:185-196 | `action=blind` — 조건: `plan.blind && !blind` | 위반 가능 리뷰의 기록 남는 차단 — 숨김과 운영 의미 구분 |
| (행) "복원" | submit | Table:197-208 | `action=restore` — 조건: 숨김 또는 블라인드 상태일 때 | 조치 해제(title "공개·집계에 다시 포함할 수 있는 상태로 되돌립니다.") |
| (행) "검토 완료" | submit | Table:209-220 | `action=review` — 조건: `plan.reviewDone && !reviewed` | 문제없음 판정의 명시 기록 — 같은 리뷰 재검토 방지 |
| (조치 불가 시) "—" | 조건부 | Table:168-169, 222-223 | `plan`에 조치 컬럼이 없으면(저장소 설정) 버튼 미표시 — 페이지 설명 원문 "조치 버튼은 저장소 설정에 따라 표시되지 않을 수 있습니다." | 스키마 미지원 환경에서의 안전한 축퇴 |
| (fallback) `AdminRecordTable` 범용 표 | 조건부 | page.tsx:90 | `meta` null일 때 | 컬럼 탐지 실패 시에도 원본 데이터 열람 유지 |

### /admin/reviews/[reviewId] — 리뷰 상세

**바인딩**: `requireRole("admin")` 명시. `firstReadableAdminTable(["reviews","mentor_reviews","mentor_review"])`로 테이블 후보 탐색 후 단건 조회.
**화면의 존재 목적**: 리뷰 원본 레코드 전량(JSON) 확인 + 동일 조치 4종의 단건 실행. 목록의 truncate된 본문으로 판단이 어려운 건의 정독 화면.

| 요소 (표시 라벨) | 종류 | 소스 | 연결 동작 | 추론한 존재 목적 |
|---|---|---|---|---|
| "← 리뷰 목록" + CTA "목록"/"신고" | 링크 | page.tsx:33-43 | `/admin/reviews`, `/admin/reports` | 신고 경유 리뷰 검토 동선 |
| (JSON pre) 리뷰 행 전체 / "리뷰 테이블을 찾지 못했습니다." / "해당 id의 리뷰를 찾지 못했습니다." | 표시·조건부 | page.tsx:44-52 | — | 전 필드 열람 |
| "조치" — 버튼 4개 (라벨 원문 `hide` / `restore` / `blind` / `review`) | submit 4 | page.tsx:54-71 | `(["hide","restore","blind","review"]).map` — 4개 반복, `moderateAdminReviewAction` | 목록과 동일 액션의 단건 버전 — 라벨이 영문 raw 값 그대로임(목록 화면의 한국어 라벨과 상이)³ |

³ 코드≠기획 각주: UI 카피 통일 규칙(한국어 라벨) 대비 이 화면 버튼만 영문 action 값을 그대로 노출 — 코드 실측 사실 표기.

### /admin/custom-request-orders — 맞춤의뢰 주문 운영 (199줄)

**바인딩**: `requireRole("admin")` 명시 + service_role 우선(주석 원문 "관리자 운영 목록은 RLS로 막힐 수 있어 service_role을 우선 사용한다."). `loadAdminCustomRequestOrdersListPaged`, `custom_request_posts`에서 제목 join, `countAdminCustomRequestOrdersByStatus`.
**화면의 존재 목적**: 조치 버튼이 하나도 없는 의도적 읽기 전용 화면. 설명 원문 "맞춤의뢰 주문을 읽기 전용으로 확인합니다. 분쟁·환불·정산 처리는 기존 전용 메뉴에서 진행합니다." — 주문 상태(기획 잠금값 "작업 중" 표기 포함)를 파악한 뒤 실제 개입은 분쟁/환불 메뉴로 넘기는 관제탑.

| 요소 (표시 라벨) | 종류 | 소스 | 연결 동작 | 추론한 존재 목적 |
|---|---|---|---|---|
| 검색 "주문/공모/학생/멘토 ID, 상태 검색" + 상태 탭 9개 "전체·대기·작업 중·납품 대기·수정 요청·완료·분쟁·취소·환불" | 공용 툴바 | page.tsx:90-100, 132-137 | AdminListToolbar (01 공용 사전 참조) | 주문 수명주기 전 단계 분할 — "분쟁" 탭이 분쟁 메뉴 진입의 필터 역할 |
| "주문 목록" 표 (열: 주문/상태/금액/학생/멘토/생성일/연결) | AdminDataTable+테이블 | page.tsx:138-189 | `rows.map` — 페이지당 25개 반복. 주문 셀은 공모글 제목+주문 ID 병기 | 주문 실태의 열람 전용 파악 |
| (행) "분쟁 보기" | 링크 | page.tsx:175-182 | `/admin/disputes?orderId={id}` | 이 화면의 유일한 "동작" — 주문→분쟁 큐로의 문맥 이동(조치 위임) |
| (빈/오류) "표시할 주문이 없습니다." / "주문 목록을 불러오지 못했습니다." | 조건부 | page.tsx:127-131, 152-157 | — | — |
| 페이지네이션 | 공용 | page.tsx:190-195 | AdminListPagination (01 공용 사전 참조) | — |

### /admin/disputes — 신고·분쟁 관리

**바인딩**: `requireRole("admin")` 명시 + service_role bypass(try/catch, 주석 원문 "[보안 주석] service_role로 RLS 우회 — 관리자 가드 아래에서만 사용."). `loadAdminDisputesListPaged`+`countAdminDisputesByStatus`, `mapRowToAdminListItem`. flash `?ok=sanction` → "조치를 기록했습니다."
**화면의 존재 목적**: 금전·제재가 걸린 사건의 심리 대기실. 서버 탭(상태 5+전체)과 클라이언트 필터(유형/상태/기간), 일괄 상태 전이, 그리고 행 내 제재 폼(제재 대상 선택→계정 상태 실반영)까지 — 접수에서 제재 집행까지의 목록 단계 전부를 담는다.

| 요소 (표시 라벨) | 종류 | 소스 | 연결 동작 | 추론한 존재 목적 |
|---|---|---|---|---|
| 검색 "분쟁/주문/구독/사용자 ID, 사유 검색" + 상태 탭 "접수·검토 중·운영 검토·해결·종료·전체"(건수, 기본 `open`) | 공용 툴바 | page.tsx:41-59 | AdminListToolbar (01 공용 사전 참조) | 미결(open) 우선 노출이 기본값 — 적체 감시 |
| "신고·분쟁 관리" / "접수된 신고와 분쟁 건을 검토하고 조치합니다." | 제목 | AdminDisputesWorkspace.tsx:95-96 | — | 화면 정체성 |
| 클라이언트 필터 "유형: 전체·신고·분쟁" / "상태: 전체·대기·처리중·완료" / "시작일"·"종료일" date | 버튼 그룹+date 2 | Workspace:16-27, 99-110 | `FilterGroup` × 2 (`filters.map` 반복) + `useState` 4개, `useMemo` 필터링 | 로드된 페이지 내 즉석 슬라이스 — 서버 왕복 없이 기간·유형 교차 조회 |
| "선택 항목 일괄" + "처리중으로" / "완료(resolved)로" | bulk submit 2 | Workspace:113-136 | `id="disputeBulkForm"` + 행 체크박스 `form` 연결, `bulkUpdateDisputesAction`(`bulkActions.ts`) | 유사 분쟁 다건의 상태 일괄 전이 |
| 분쟁 표 (열: 선택/유형/제목·요약/상태/접수일/조치) | 테이블 | Workspace:147-226 | `filtered.map` — 페이지당 25개 반복 | 건별 심리 |
| (행) 체크박스 "분쟁 선택" | checkbox | Workspace:164-172 | `form="disputeBulkForm"` | 일괄 처리 대상 지정 |
| (행) "상세 보기" | 링크 | Workspace:180-185 | `/admin/disputes/[id]` | 예치 분배·메모가 있는 상세로 이동 |
| (행) 제재 폼 — select "제재 대상: 멘토"/"제재 대상: 학생" (title "제재 대상 (정지/차단이 실제 계정에 적용됩니다)") + "메모(선택)" | 폼 입력 | Workspace:194-205 | `applyDisputeSanctionAction`의 `target` | 분쟁의 귀책 당사자 지정 — 제재가 계정에 실반영됨을 title로 경고 |
| (행) 제재 버튼 5개 "완료" / "보류" / "7일" / "30일" / "영구" | submit 5 | Workspace:29-35, 206-218 | `SANCTIONS.map` — 5개 반복, `name="sanction"` value로 분기. 서버(`adminDisputeSanctionActions.ts`): 분쟁 status 갱신(resolved/on_hold/sanction_7d/30d/permanent) + `tryInsertAdminDisputeNote` + `sanctionToAccountStatus`로 실제 계정 정지·차단 적용 + `logAdminAction` | 분쟁 판정과 계정 제재의 원클릭 결합 — 주석 원문 "P1 ④ — 제재 직결: 실제 계정 상태에 반영(7d/30d 정지, permanent 차단)." |
| (빈/오류) "아직 데이터가 없어요…" / "연결된 분쟁 테이블이 없습니다…" / "신고·분쟁 목록을 불러오지 못했습니다." | 조건부 | Workspace:83-90, 138-145 | table null/0건/error 3분기 | — |
| 페이지네이션 · loading.tsx Skeleton | 공용 | page.tsx:61-66 / loading.tsx | — | 큐 순회 / 목록 로딩 체감 개선 |

### /admin/disputes/[id] — 분쟁 상세 (예치금 분배)

**바인딩**: `requireRole("admin")` 명시 + service_role bypass. `loadDisputeById`(분쟁+연계 환불·결제·구독·맞춤의뢰 번들), `loadDisputeActorSummaries`(당사자), `loadAdminDisputeNotes`(운영 메모 타임라인), `loadAdminDisputeEscrowSplitPanelState`(예치 분배 패널 상태 기계: unavailable/completed/no_hold/form), `CUSTOM_ORDER_PLATFORM_FEE_RATE`(맞춤의뢰 수수료 5% — 기획 잠금값) 주입. flash 5종("예치 분배를 완료했습니다. 분쟁·주문 상태가 갱신되었습니다." 등).
**화면의 존재 목적**: 분쟁 중재의 법정. 사건 요약→예치(에스크로) 분배→관련 주문·결제→당사자→상태 조치→운영 메모→원본 필드→처리 이력의 순서로, 맞춤의뢰 예치금을 멘토 몫과 학생 환불로 쪼개는 금전 판결(RPC)을 안전장치(합계 검증, 자동 보정, 서버 재검증)와 함께 실행한다.

| 요소 (표시 라벨) | 종류 | 소스 | 연결 동작 | 추론한 존재 목적 |
|---|---|---|---|---|
| "← 분쟁 관리" / "대시보드" + CTA "분쟁 관리"/"환불 관리"/"대시보드" | 링크 | page.tsx:74-97 | — | 사건 간 이동 동선 |
| "사건 요약" (제목·유형·본문·"우선순위·심각도"·"처리 상태" 배지+raw 병기) | 섹션 | DisputeAdminPageBody.tsx:66-78 | `pickText` 키 후보 탐색 | 판단에 필요한 최소 사실관계 요약 |
| "예치 분배 (에스크로)" 패널 — dl "예치금 (hold gross)" / "결제 상태" / "정산 상태" / "주문"("작업방 열기" 링크) | 상태 패널 | DisputeEscrowSplitPanel.tsx:199-233 | `panelState.kind==="form"`일 때 | 분배 가능 금액과 결제·정산 맥락을 입력 직전에 확정 제시 |
| "멘토 배정 gross (원)" number 입력 (설명 "수수료 공제 전 멘토 몫. 입력 시 학생 환불이 자동 계산됩니다.") | 제어 입력 | Panel:69-87 | `onMentorChange` — clamp(0~hold) 후 학생 환불 = hold − 멘토 자동 설정 | 두 입력의 합이 항상 예치금과 일치하도록 강제 — 초과 분배 원천 차단 |
| "학생 환불 (원)" number 입력 (설명 "수수료 없이 전액 반환. 입력 시 멘토 몫이 자동 계산됩니다.") | 제어 입력 | Panel:89-107 | `onStudentChange` — 역방향 자동 보정 | 학생 관점 입력 지원 — 환불엔 수수료 없음 명시 |
| "멘토 실수령 예상: {금액} (플랫폼 수수료 5% 공제…)" + "합계: {합}/예치금 {hold}" + "일치"/"불일치" + "마지막 입력: …" | 실시간 계산 표시 | Panel:110-130 | `mentorNetFromGrossWon`(수수료 floor 공제), `sumOk` 판정 | 판결 결과의 사전 시뮬레이션 — 멘토 수령 85/95/85 규칙 중 맞춤의뢰 5%를 화면에서 재확인 |
| "예치 분배 실행" | submit (조건부 disabled) | Panel:132-141 | `disabled={!sumOk}` → `applyCustomOrderDisputeSplitAdminAction`(`adminDisputeActions.ts`) — RPC 호출. 안내 원문 "제출 시 서버·RPC가 합계·상호 배타·권한을 다시 검증합니다. 실행 후 분쟁은 해결(resolved) 처리됩니다." | 예치금 분배의 최종 집행 — 클라이언트 합계 검증(disabled) + 서버 RPC 재검증의 이중 안전장치, 실행이 곧 분쟁 종결 |
| (패널 대체 상태) "예치 분배 · 처리 완료"(+"작업방 보기") / "예치 분배" no_hold 메시지 / unavailable 메시지 | 조건부 섹션 3 | Panel:152-196 | `st.kind` 분기 | 이중 분배 방지(completed) · 예치금 없는 주문의 오조작 방지(no_hold) |
| "금전·환불·정산 안내": "…아래 해결·종결 버튼은 분쟁 상태만 바꾸며, 예치 분배와 별개입니다." | 안내 섹션 | Body:82-91 | `/admin/refunds` 링크 포함 | 상태 조치≠금전 집행의 혼동 방지 — 이 화면의 가장 흔한 오해 차단 |
| "관련 주문·결제·구독" (환불/결제/구독/맞춤의뢰 4행) + "환불 관리에서 이 건 검색" | 목록·링크 | Body:93-118 | 연계 refund id 있을 때 `/admin/refunds?refundId=` | 분쟁 판단에 필요한 금전 연계의 원스톱 확인 |
| "관련 사용자" ("접수자(제출)"/"학생·의뢰"/"멘토" + id code) | 목록 | Body:120-129 | `actors` 존재 시 | 당사자 특정 — 제재·연락 대상 확인 |
| "운영 조치" — "검토 중으로" | submit | Body:131-149 | `setDisputeUnderReviewAction` — 조건: disputes 표준 테이블 && status가 open/escalated | 접수 건의 심리 개시 선언 |
| "해결 처리" (title "분쟁을 해결됨으로 표시합니다. 환불은 자동 실행되지 않습니다.") | submit | Body:150-161 | `resolveDisputeAction` — 조건: open/under_review/escalated | 인용 종결 — title로 금전 미실행 재경고 |
| "종결 처리" (title "분쟁을 종결됨으로 표시합니다. 환불·정산은 별도 확인이 필요합니다.") | submit | Body:162-171 | `dismissDisputeAction` — 동일 조건 | 기각 종결 |
| (조치 불가 시) "이미 종료된 분쟁이거나, 상태를 더 바꿀 수 없습니다." / 비표준 테이블 안내 | 조건부 | Body:174-183 | — | 종결 건 재조작 차단 |
| "운영 메모" 패널 — "새 메모" textarea + "메모 추가" + 타임라인 + "기존 단일 메모" | AdminCaseNotesPanel | Body:185-187 / AdminCaseNotesPanel.tsx | `saveDisputeAdminNoteAction`. 안내 원문 "관리자 내부 타임라인으로 저장됩니다. 환불·정산·주문 상태는 변경하지 않습니다." missing 시 "운영 메모 테이블이 아직 적용되지 않았습니다. 084 SQL 적용 후…" | 판단 근거의 시간순 축적 — 담당자 교대·재심 시 문맥 승계 |
| "분쟁 기록(핵심 필드)"/"환불"/"결제"/"구독"/"맞춤의뢰 주문" key-value 카드 5 | DisputeKeyValueList | Body:189-197 | maxKeys 16/8 | 원본 필드의 구조화 열람 |
| "처리 이력(로그)" — "처리 이력 N건" 목록 | 목록 | Body:199-216 | `modLogs.rows.map` — N개 반복 | 과거 조치 감사 추적 |
| loading.tsx Skeleton | 로딩 | disputes/[id]/loading.tsx | — | 번들 조회(다중 테이블)의 로딩 체감 완화 |

### /admin/refunds — 환불 관리 (510줄)

**바인딩**: `loadAdminRefundsListPaged`(status+`requestType`+`sort` 확장 파라미터), `loadAdminDashboardSummary`(정산 예정 건수·금액), `countAdminRefundsByStatus`/`countAdminRefundsByRequestType`, `refundSlaInfo`+`REFUND_SLA_DAYS=5`(`refundSla.ts:5`). flash `?ok`/`?error`, `?refundId=`(분쟁 상세에서 넘어온 포커스).
**화면의 존재 목적**: 학생 돈이 돌아가는 유일한 승인 큐. 승인/거절(건별·일괄)과 함께 "멘토 중단 환불 5일 SLA"를 유형 탭·정렬·SLA 열로 삼중 노출해 기한 초과를 구조적으로 막는다. 설명 원문 "실제 PG·계좌 환불 반영은 결제 연동 상태에 따라 별도 확인이 필요할 수 있습니다."

| 요소 (표시 라벨) | 종류 | 소스 | 연결 동작 | 추론한 존재 목적 |
|---|---|---|---|---|
| KPI "환불 대기 {N}건" / "정산 예정 건수 {N}건" / "정산 예정 금액 {N원}" | 카드 3 | page.tsx:204-221 | `loadAdminDashboardSummary` | 환불(유출)과 정산 예정(지급 대기)을 나란히 — 자금 흐름 양면 파악. "정산 예정" 표기는 기획 통일 문구 준수 |
| (포커스 안내) "연결된 환불 ID `{id}`와 아래 목록의 환불 ID가 같은지 확인해 주세요." | 조건부 배너 | page.tsx:223-227 | `?refundId=` 존재 시 | 분쟁 상세 → 환불 큐 건너올 때 대상 오인 방지 |
| 검색 "환불/사용자/결제/구독 ID, 사유, 메모로 검색" + 상태 탭 "대기·승인·거절·취소·전체"(기본 `pending`) | 공용 툴바 | page.tsx:162-168, 229-234 | AdminListToolbar (01 공용 사전 참조) | 미결 우선 큐 |
| 유형 탭 "전체(대기)" / "구독 잔여(학생)" / "멘토중단 ⏱5일"(건수) | 링크 탭 3 | page.tsx:155-159, 239-260 | `typeTabs.map` — 3개 반복, `refundFilterUrl`이 검색·상태 보존하며 `?type=` 전환 | 환불 사유별 처리 우선순위 분리 — SLA 걸린 멘토중단 유형을 별도 큐로 |
| "기한 임박순 정렬" / "✓ 기한 임박순" | 토글 링크 | page.tsx:261-271 | `?sort=deadline` ↔ `recent` | SLA 잔여일 오름차순 — 초과 임박 건부터 소진 |
| 안내 "멘토 중단 환불은 요청일로부터 5일 이내 처리가 목표입니다. 남은 일수는 아래 표 'SLA' 열에서 확인하세요." | 텍스트 | page.tsx:273-276 | `REFUND_SLA_DAYS` 보간 | 기한 규칙의 화면 상주 |
| "환불 요청 목록" + 배지 "현재 {N}건 매칭" | 제목+AdminStatusBadge | page.tsx:279-285 | (01 공용 사전 참조) | 필터 결과 규모 확인 |
| "선택 항목 일괄" + "일괄 승인" / "일괄 거절" + "{N}건" | bulk submit 2 | page.tsx:310-331 | `id="refundBulkForm"` + 행 체크박스 `form` 연결, `bulkProcessRefundsAction`(`bulkActions.ts`) | 동일 사유 다건(예: 멘토 1명 중단 → 구독자 전원 환불)의 일괄 집행 — 주석 원문 "P1 ③ 일괄 처리" |
| 환불 표 (열: 선택/환불 ID/사용자/환불 금액/상태/SLA/사유/결제 ID/맞춤의뢰 ID/요청일/처리) | 테이블 | page.tsx:333-498 | `rows.map` — 페이지당 25개 반복 | 건별 심사 |
| (행) 체크박스 "환불 선택" | checkbox | page.tsx:363-374 | 조건: `status==="pending"` && id 존재 시만 | 처리 완료 건의 중복 집행 방지 |
| (행) SLA 배지 (초과=빨강/임박=주황/여유=회색, 멘토중단은 "⏱" 접미, title "멘토 중단 환불 — 5일 SLA") | 계산 배지 | page.tsx:389-416 | `refundSlaInfo(created_at, status, now)` | 행 단위 기한 잔여 시각화 — 정렬·탭과 함께 SLA 삼중 방어 |
| (행) 사유 셀 (request_type 대문자 강조 + reason + "메모: {admin_note}") | 조건부 표시 | page.tsx:417-441 | 셋 다 없으면 "—" | 요청 배경과 이전 관리자 판단의 동시 열람 |
| (행) "메모(선택)" input + "환불 승인" | 폼+submit | page.tsx:452-469 | `approveAdminRefundAction`(`refundActions.ts` — RPC·원장 반영, `logAdminAction`) — 조건: pending일 때만 폼 렌더 | 환불 집행 — 캐시 원장(`cash_ledger` append-only)과의 정합은 서버 액션이 담당 |
| (행) "환불 거절" | submit | page.tsx:470-476 | `rejectAdminRefundAction` — 같은 폼의 메모 공유 | 부당 요청 거부 + 사유 기록 |
| (행) "분쟁 관리에서 보기" | 조건부 링크 | page.tsx:482-492 | `dispute_id`/`case_id` 있을 때 `/admin/disputes/[id]` | 분쟁 연계 환불의 사건 문맥 확인 — 예치 분배와의 중복 집행 방지 (추정) |
| (빈/오류) "현재 대기 중인 환불 요청이 없습니다." / "환불 목록을 불러올 수 없습니다…" / "목록을 불러오지 못했습니다." | 조건부 3 | page.tsx:287-304 | error/table null/0건 분기 | — |
| 페이지네이션 · loading.tsx Skeleton | 공용 | page.tsx:499-504 / loading.tsx | — | — |

### /admin/refunds/[id] — 환불 상세

**바인딩**: `requireRole("admin")` 명시. `firstReadableAdminTable(["refunds"])` 후 단건 조회.
**화면의 존재 목적**: 환불 단건의 원본 전량(JSON) 확인과 동일 승인/거절 액션의 단건 실행. 설명 원문 "환불 행을 확인하고 승인·거절 RPC를 호출합니다."

| 요소 (표시 라벨) | 종류 | 소스 | 연결 동작 | 추론한 존재 목적 |
|---|---|---|---|---|
| "← 환불 목록" + CTA "환불 목록"/"분쟁" | 링크 | page.tsx:31-40 | — | 큐 복귀 |
| (JSON pre) 환불 행 전체 / "환불 테이블을 찾지 못했습니다." / "해당 id의 환불 행을 찾지 못했습니다." | 표시·조건부 | page.tsx:42-50 | — | 금액·원장 필드의 전량 검증 |
| "처리" — "메모 (선택)" + "승인" / "메모 (선택)" + "거절" (안내 "RPC·원장 환경에 따라 실패할 수 있습니다.") | 폼 2 | page.tsx:52-75 | `approveAdminRefundAction` / `rejectAdminRefundAction`, `FormSubmitButton`(pending "…") | 정독 후 단건 집행 — 목록과 동일 액션 재사용으로 로직 단일화 |

### /admin/settlements — 정산 관리 (183줄, 읽기전용 의도)

**바인딩**: `refreshSubscriptionSettlementItemsBestEffort()`(구독 정산 항목 최신화 시도) 후 `loadAdminSettlementsList(supabase, 50)` — rows+summary(합계·보류·취소 카운트)+`byMentorHint`. 감사 문서 기준: 읽기전용 의도 — 지급 실행 컨트롤 없음(코드 실측 일치: 이 화면에 submit 요소 0개).
**화면의 존재 목적**: 멘토에게 나갈 돈의 장부 열람. 설명 원문 "지급 실행·재시도는 이 화면에서 자동으로 이루어지지 않으며, 필요 시 외부 정산 절차와 맞춰 수동 처리합니다." — 수수료(구독 15%/맞춤의뢰 5%) 공제 결과와 지급 상태를 검증하는 화면이지 지급 버튼이 아니다.

| 요소 (표시 라벨) | 종류 | 소스 | 연결 동작 | 추론한 존재 목적 |
|---|---|---|---|---|
| 섹션 "정산 요약": "전체 N건 · 지급 대기·보류·지급 가능(멘토 정산금 합계) {원} · 지급 완료(멘토 정산금 합계) {원} · 보류 N건 · 취소 N건" | 요약 | page.tsx:118-125, 139 | `summary` 집계 | 지급 예정 총액의 자금 계획 근거 |
| 섹션 "오류 재처리": "지급 실패 건의 자동 재시도는 이 화면에서 제공하지 않습니다…" (status skeleton) | 안내 | page.tsx:140-144 | — | 미제공 기능의 명시적 사실 고지 |
| 섹션 "멘토별 보기": `{byMentorHint}` (status skeleton) | 안내 | page.tsx:145 | — | 멘토별 집계 뷰의 예약 자리 (추정) |
| "지급 예정 및 지급 내역" + 배지 "최근 정산부터 최대 50건" | 제목+AdminStatusBadge | page.tsx:163-168 | (01 공용 사전 참조) | 표본 범위 명시 |
| "정산 내역 상세" 표 (열 12: 정산 ID/유형/주문·이벤트 ID/멘토/정산 계좌/학생/총 결제금액/플랫폼 수수료/멘토 정산금/상태/지급일/생성일) | 테이블 | page.tsx:45-111 | `rows.map` — 최대 50개 반복. 유형 셀 "구독"/"맞춤의뢰", 상태 배지 `adminSettlementStatusLabel` | 총액→수수료→멘토 정산금의 3열 병기로 수수료 규칙(85/95) 건별 검산 가능 |
| "행별 상세" 슬롯: "이 화면에서는 목록만 제공합니다. 건별 상세·추가 정보는 해당 업무 메뉴에서 열어 확인해 주세요." | AdminDetailPanelSlot | page.tsx:177 / AdminActionPlaceholders.tsx:49-56 | 정적 안내 — `AdminActionPlaceholders` 4개 export 중 유일한 실노출 지점(감사 문서 기준·grep 실측 일치) | 상세 패널 부재의 사실 고지 및 확장 예약 자리 |
| (빈/오류) "정산 대상 내역이 없습니다." / "목록을 불러오지 못했습니다." | 조건부 | page.tsx:154-158, 170-173 | `queryOk` 분기 | — |

### /admin/sla — SLA 대시보드

**바인딩**: `loadSlaDashboard(new Date())`(`slaDashboard.ts`) — 신고 평균 응답시간, 환불 평균 처리시간, 멘토중단 5일 SLA(대기/임박/초과 + 임박순 rows).
**화면의 존재 목적**: 처리 속도의 자기 감시. 개별 큐 화면이 "무엇을"이라면 이 화면은 "얼마나 빨리"를 잰다. 기준 원문 "남은 일수 2일 이하는 임박, 0일 미만은 초과로 강조합니다."

| 요소 (표시 라벨) | 종류 | 소스 | 연결 동작 | 추론한 존재 목적 |
|---|---|---|---|---|
| CTA "멘토중단 환불" | 링크 | page.tsx:28 | `/admin/refunds?type=subscription_mentor_suspended&sort=deadline` | 지표에서 곧장 기한임박 정렬 큐로 — 측정→행동 직결 |
| KPI "신고 평균 응답시간" (+"처리 N건 · 미처리 N건") | 카드 | page.tsx:49-55 | `fmtHours`(분/시간/일 자동 단위) | 검수 반응 속도 — 신뢰 훼손 방치 시간 감시 |
| KPI "환불 평균 처리시간" (+"처리 N건 · 대기 N건") | 카드 | page.tsx:56-62 | — | 금전 반환 속도 감시 |
| KPI "멘토중단 5일 SLA" — "{N}건 대기" + "임박 N · 초과 N" | 카드(경보 배경) | page.tsx:63-78 | 조건부 배경: 초과>0 빨강, 임박>0 주황 | 가장 엄격한 기한의 카드 자체 경보화 |
| "멘토 중단 환불 — 기한 임박순" 표 (열: 환불 ID/요청일/SLA) + "환불 화면에서 처리 →" | 테이블+링크 | page.tsx:81-128 | `sla.mentorSuspended.rows.map` — N개 반복, 톤별 배지 | 초과 위험 건의 실명 목록 — 처리 화면으로 위임(이 화면엔 조치 없음) |
| (빈 상태) "대기 중인 멘토 중단 환불이 없습니다." | 조건부 | page.tsx:91-94 | rows 0건 | SLA 클리어 확인 |

### /admin/notices — 공지 및 프로모션

**바인딩**: `loadAdminNoticesPage(supabase, 50)` — 공지·프로모션 2섹션 병렬 로드(mapped rows + listErrors). 감사 문서 기준: 생성(draft) 전용 — 수정·삭제 없음(코드 실측 일치: 액션은 `submitAdminNoticeDraft` insert 1종, 목록 `AdminNoticesList`에 행 단위 버튼 없음).
**화면의 존재 목적**: 플랫폼→사용자 방향의 공식 발신(공지·프로모션)의 등록과 노출 상태 열람. 폼 안내 원문 "공지·프로모션 저장소에 초안으로 등록됩니다."

| 요소 (표시 라벨) | 종류 | 소스 | 연결 동작 | 추론한 존재 목적 |
|---|---|---|---|---|
| "공지" 목록 표 (열: 제목/유형/노출 위치/노출 상태/노출 기간/생성일, "공지 데이터" 헤더+건수) | 테이블 | page.tsx:50 / AdminNoticesList.tsx:26-66 | `rows.map` — 최대 50개 반복, 노출 상태 배지(`exposure.isOn`) | 현재 무엇이 언제까지 노출 중인지 열람 — 행 조작 UI 없음(감사 문서 기준 사실) |
| "프로모션" 목록 표 (동일 구조) | 테이블 | page.tsx:51 | 동일 | 이벤트성 배너의 동일 열람 |
| (빈/오류) "등록된 공지가 없습니다." / "등록된 프로모션이 없습니다." / 오류 시 `adminNoticesSectionDescription` 문구 / 통합 빈 상태 "등록된 공지 또는 프로모션이 없습니다." | 조건부 | AdminNoticesList.tsx:10-25 / page.tsx:44-47 | — | — |
| "새 공지 또는 프로모션" 폼 — "제목"(required) / "본문·배너 문구(요약)" / "유형"("공지"/"프로모션" select) / "타겟/노출 화면(문자)"(placeholder "예: 홈, 요금제") / "노출 시작"·"노출 종료"(datetime-local) / "활성(비활성은 저장 후 목록에서 조정)" checkbox | 폼 입력 7 | AdminNoticesFormSkeleton.tsx:21-67 | `submitAdminNoticeDraft`(`adminNoticesActions.ts` — requireRole 후 `insertAdminNoticeDraft`, 제목 없으면 "제목을 입력해 주세요." redirect) | 노출 기간·대상까지 지정한 초안 생성. "활성" 라벨의 "저장 후 목록에서 조정" 문구는 코드상 조정 UI가 없어 감사 문서와 함께 사실만 표기⁴ |
| "임시 저장" | submit | Skeleton:68-72 | `FormSubmitButton` pending "처리 중…" | draft 생성의 단일 집행 버튼 |
| (flash) "저장되었습니다. 목록에서 확인할 수 있습니다." / `safeError` | 조건부 | Skeleton:23-24 | `?ok=1`/`?error=` | — |

⁴ 코드≠기획 각주: 페이지 설명 "서비스 공지와 프로모션을 등록·수정합니다."와 체크박스 문구가 수정 기능을 시사하나, 코드에는 생성(draft) 액션만 존재(수정·삭제 액션·버튼 없음 — 감사 문서 기준과 일치).

### /admin/audit-logs — 감사 로그

**바인딩**: `requireRole("admin")` 명시 + service_role bypass. `loadAdminUnifiedActivityLog(supabase, {limit:50})`(`adminUnifiedActivityLog.ts`, 524줄) — 신고·분쟁·환불·리뷰·주문 이벤트·공지 등 다중 소스를 시간순 통합. 로드 실패 시 "운영 로그를 불러오지 못했습니다…" fatal 처리.
**화면의 존재 목적**: 조치의 사후 검증. 설명 원문 "결제·환불·정산·주문 상태는 이 화면에서 바뀌지 않으며, 필요 시 환불·분쟁 등 각 메뉴에서 수동으로 처리합니다." — 관리자 자신을 포함한 최근 변경의 열람 전용 통합 타임라인. 필터에 대해서는 화면이 스스로 사실을 고지한다: 섹션 "보관·검색" 원문 "기간·키워드 검색은 이 화면에서 아직 사용할 수 없습니다. 필요한 경우 각 메뉴에서 해당 건을 직접 찾아 주세요."(즉 감사로그 필터 UI는 현재 부재 — 사실 표기).

| 요소 (표시 라벨) | 종류 | 소스 | 연결 동작 | 추론한 존재 목적 |
|---|---|---|---|---|
| 섹션 "통합 표시": "여러 업무에서 나온 최근 변경·접수를 시간순으로 합쳐 보여 줍니다. 소스마다 가져오는 건수에 한도가 있어 전체 이력과는 다를 수 있습니다." | 안내 | page.tsx:47-51 | — | 표본 한계의 정직한 고지 — 완전 감사가 아님을 명시 |
| 섹션 "보관·검색" (status skeleton) | 안내 | page.tsx:52-56 | — | 필터 미구현의 사실 고지(위 원문) |
| "감사 로그 데이터" 표 (열 7: 일시/유형/대상/처리·관련/상태/요약/상세링크, 건수 배지) | 테이블 | AdminUnifiedActivityLogView.tsx:22-78 | `entries.map` — 최대 50개 반복 | 이질 소스 로그의 공통 스키마 열람 |
| (행) 상세 링크 `{e.detailLabel}` (없으면 "—") | 조건부 링크 | View:61-72 | `e.detailHref`(각 업무 메뉴 상세) | 로그→원사건 화면 점프 — 열람 전용 원칙 유지하며 조치는 위임 |
| (빈/경고) "표시할 운영 로그가 없습니다." / `{loadWarning}` | 조건부 | View:14-20 | — | 부분 로드 실패의 고지 |

### /admin/settings — 시스템 설정 (스텁)

**바인딩**: 없음(정적 렌더, 데이터 조회·액션 0). 감사 문서 기준: 순수 스텁 — 코드 실측 일치(14줄, 인터랙션 요소 0).
**화면의 존재 목적**: 요금제·수수료 같은 잠금값 정책의 미래 설정 지점을 네비게이션에 미리 고정해 두는 예약 화면. 현재는 안내문만 존재한다.

| 요소 (표시 라벨) | 종류 | 소스 | 연결 동작 | 추론한 존재 목적 |
|---|---|---|---|---|
| "시스템 설정" / "플랫폼 운영 설정을 관리합니다." | 제목 | page.tsx:5-7 | — | 화면 정체성(예약) |
| "요금제·수수료·알림 정책 등은 추후 이 화면에서 설정할 수 있습니다." | 안내 | page.tsx:8-10 | — | 스텁임의 명시 — 잠금값(55,000/114,900/249,900, 수수료 15/5/15)의 향후 관리 지점 예고 (추정) |

---

## components/admin 전수 (23개) — 배치·연결 현황

위 화면 표에 이미 상세 기술된 것은 소속 화면만 표기. dead code 판정은 grep 실측(페이지·타 컴포넌트에서 import 0건) + 감사 문서 기준.

| 컴포넌트 | 성격 | 실노출 지점 (코드 실측) |
|---|---|---|
| `AdminConsoleShell` / `AdminConsoleNav`(Sidebar·Top) / `AdminConsoleTopBar` / `adminConsoleNavConfig` | 콘솔 프레임·네비 16항목 | `(console)/layout.tsx` — 전 콘솔 화면 |
| `AdminDashboardView` | 대시보드 뷰(recharts) | `/admin/dashboard` |
| `AdminMentorApprovalWorkspace` (509줄) | 멘토 승인+학교인증 마스터-디테일 | `/admin/mentor-approval` |
| `AdminAcademicRecordChangeWorkspace` | 학적변경 심사 카드 | `/admin/academic-record-changes` |
| `AdminModerationWorkspace` → `AdminContentReportsTable` | 신고 큐(일괄+행 조치) | `/admin/moderation` |
| `AdminDisputesWorkspace` | 분쟁 목록(필터·일괄·제재) | `/admin/disputes` |
| `AdminReviewsTable` | 리뷰 조치 표 | `/admin/reviews` |
| `AdminNoticesList` / `AdminNoticesFormSkeleton` | 공지 목록·draft 폼 | `/admin/notices` |
| `AdminUnifiedActivityLogView` | 통합 로그 표 | `/admin/audit-logs` |
| `AdminCaseNotesPanel` | 운영 메모 타임라인 | `/admin/disputes/[id]` (`DisputeAdminPageBody` 경유) |
| `AdminListToolbar` / `AdminListPagination` | 목록 공용 검색·탭·페이지 — 01 공용 사전 참조 | mentor-approval·moderation·disputes·refunds·users·community-content·custom-request-orders·academic-record-changes (8화면) |
| `AdminStatusBadge` | 표본 힌트 배지("최근 목록" 기본) | reviews·refunds·settlements |
| `AdminRecordTable` | 컬럼 자동선정 범용 표(한국어 헤더 매핑) | reviews의 meta-null fallback |
| `AdminDataTable` | 표 래퍼(제목+건수+overflow) | custom-request-orders |
| `AdminActionPlaceholders` (56줄, export 4) | 비활성 자리 표시 — `AdminApproveRejectRow`("승인(미연결)"/"반려(미연결)"), `AdminModerationPlaceholders`("숨김(미연결)"/"블라인드(미연결)"), `AdminFilterSlot`("검색·기간 필터는 아직 사용할 수 없습니다."), `AdminDetailPanelSlot`("행별 상세") | **대부분 dead code(감사 문서 기준)** — grep 실측: 앞 3개 export는 import 0건, 실노출은 `AdminDetailPanelSlot`의 settlements 상세 슬롯 1개뿐 |
| `AdminQueueGrid` (26줄) | 큐 카드 그리드 | **미사용(코드 실측: 페이지 import 0건)** |
| `AdminMentorApprovalsTable` (173줄) | 승인/반려 버튼 포함 구형 승인 표 | **미사용(코드 실측: 페이지 import 0건 — `AdminMentorApprovalWorkspace`로 대체된 것으로 보임 (추정))** |

## 연결 lib — `lib/admin/*` 액션 파일 15개 (서버 액션 보유 파일 기준)

`accountStatusActions`(상태 적용·경고 발급) · `adminDisputeActions`(검토중·해결·종결·메모·예치분배 RPC) · `adminDisputeSanctionActions`(제재 5종+계정 실반영) · `adminNoticesActions`(draft 생성 단일) · `adminReportActions`(신고 상태·콘텐츠 노출·메모) · `adminReviewActions`(hide/blind/restore/review) · `bulkActions`(신고·분쟁·환불 일괄 3종) · `communityModerationActions`(숨김·복구·삭제 ×3타입 9종) · `mentorAcademicRecordChangeReviewActions`(승인·재제출·반려) · `mentorActivityAdminActions`(보류 확정·구제·유예 만료 정리) · `mentorApprovalActions`(승인·반려·서류요청) · `mentorCapAdminActions`(cap 상한) · `mentorSchoolVerificationReviewActions`(검증 승인·재제출·반려) · `refundActions`(승인·거절) · `schoolClassificationActions`(catalog 2종+매핑 upsert). — 전부 `"use server"` + 첫 줄(권한 확인부) `requireRole("admin")`(총 34곳 실측), 상태 변경 계열은 `logAdminAction`→`admin_action_logs` 기록.
