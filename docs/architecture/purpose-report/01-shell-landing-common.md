# 01. 셸·랜딩·공통 컴포넌트 — 존재 목적 리포트

> 대상 라우트 19개 · 요소 행 96개 · 근거: 코드 실측 + 기획 정본(CLAUDE.md·frozen-canon)

본 문서는 "존재 목적 전수 리포트"의 1번 파일로, 앱 전체를 감싸는 셸(헤더·네비·푸터), 루트 랜딩(`/`), 공개 정적 페이지(법적 고지 10종·고객센터·공지사항), dev 디자인시스템 미리보기, 그리고 **다른 리포트 파일들이 참조할 공용 컴포넌트 사전**을 다룬다. 개선 제안·평가는 하지 않으며, 각 요소가 "왜 존재하는가"만 추론한다.

---

## 커버 라우트 (검증용 전수 목록)

- app/layout.tsx (루트 레이아웃)
- app/page.tsx (`/` 랜딩)
- app/(public)/layout.tsx (공개 영역 셸)
- app/(student)/layout.tsx (학생 영역 셸 — 셸 관점 요약)
- app/(mentor)/layout.tsx (멘토 영역 셸 — 셸 관점 요약)
- app/(admin)/layout.tsx (관리자 세그먼트 가드 — 셸 관점 요약)
- app/(public)/legal/terms/page.tsx
- app/(public)/legal/privacy/page.tsx
- app/(public)/legal/refund/page.tsx
- app/(public)/legal/community-guidelines/page.tsx
- app/(public)/legal/copyright/page.tsx
- app/(public)/legal/minor-consent/page.tsx
- app/(public)/legal/no-ghostwriting/page.tsx
- app/(public)/legal/no-offplatform-contact/page.tsx
- app/(public)/legal/mentor-guide/page.tsx
- app/(public)/legal/payout-guide/page.tsx
- app/(public)/support/page.tsx
- app/(public)/notices/page.tsx
- app/dev/design-system/page.tsx

(route-inventory.txt 대조 완료 — 위 항목 전부 인벤토리에 존재. `app/(admin)/admin/(console)/layout.tsx`는 관리자 콘솔 리포트 담당 범위이므로 여기서는 언급만 한다.)

---

## 공용 컴포넌트 사전

> 이 섹션의 정의는 1회만 작성되며, 02~N번 리포트는 여기를 참조한다.

### AppShell (components/shell/AppShell.tsx)

**존재 목적**: 랜딩(`/`)을 제외한 모든 화면의 단일 프레임. "어느 역할로 로그인했든 상단 헤더(로고·주요 메뉴·계정 액션)가 동일한 구조로 나온다"를 보장하는 컴포넌트로, `area`(public/student/mentor/admin)와 `sessionRole`을 받아 역할별 네비 배열(`getMainNavForRole`)과 우측 액션(게스트=로그인/회원가입, 관리자=뱃지+로그아웃, 학생·멘토=프로필 필+로그아웃)을 조립한다. 이것이 없으면 4개 거래 채널 사이를 오가는 상시 진입점(잠금 네비)이 화면마다 제각각 구현되어 절대 잠금값(학생/멘토 네비)이 깨진다.

| 요소 (표시 라벨) | 종류 | 소스 | 연결 동작 | 추론한 존재 목적 |
|---|---|---|---|---|
| "쌤버십" 로고 | 링크 | BrandLogo (variant="shell") | `/` 이동 | 어느 화면에서든 랜딩으로 복귀하는 브랜드 앵커 |
| 주요 메뉴 링크 | 네비 링크 | ShellHeaderInner | 역할별 items N개 반복(데이터: `getMainNavForRole(sessionRole)`) | 잠금 네비 상시 노출 — 거래 채널 간 이동 |
| (게스트) "로그인" / "회원가입" | 버튼형 링크 | ShellHeaderGuestActions | `/login` / `/signup` | 비로그인 방문자를 가입 전환 경로로 상시 유도 |
| (학생·멘토) 프로필 필 | 링크 | ShellHeaderActionsDesktop | 학생→`/mypage`, 멘토→`/mentor/profile/edit` | 내 계정 홈으로 1클릭 진입 + 현재 로그인 역할 확인 |
| (관리자) 역할 뱃지 "관리자" | 뱃지 | ShellHeaderAdminActions → RoleBadgeOnly | 표시 전용 | 운영 계정으로 접속 중임을 명시(오조작 방지) |
| "로그아웃" | 링크(`<a>`) | ShellHeaderActions* | `/logout` (서버 라우트) | 세션 종료 — `<a>`로 풀 페이지 이동시켜 세션 상태를 확실히 갱신(추정) |
| "메뉴 열기"/"메뉴 닫기" 햄버거 | 버튼(토글) | ShellHeaderInner | `ShellMobileNavMenu` 개폐 (lg 미만만, Escape로 닫힘) | 모바일에서 잠금 네비 전체를 접근 가능하게 유지 |

### ShellHeaderInner (components/shell/ShellHeaderInner.tsx)

**존재 목적**: AppShell 헤더의 클라이언트 부분. `usePathname()` 기반 활성 하이라이트(`isMainNavItemActive`)와 모바일 메뉴 open 상태만 담당한다. 서버 컴포넌트인 AppShell에서 상호작용(현재 경로 감지·토글)을 분리해 "Server Component 기본" 규칙을 지키기 위해 존재.

| 요소 (표시 라벨) | 종류 | 소스 | 연결 동작 | 추론한 존재 목적 |
|---|---|---|---|---|
| 네비 링크(활성 시 accent 밑줄) | 링크 | items `.map()` N개 반복 | 각 href 이동, `aria-current="page"` | 현재 위치를 시각·접근성 양쪽으로 알림 |

### ShellHeaderActions (components/shell/ShellHeaderActions.tsx)

**존재 목적**: 헤더 우측 계정 영역의 4가지 변형(Desktop/Mobile/Guest/Admin)을 한 파일에 모아 역할별 계정 UI 정책을 한 곳에서 관리. 모바일 변형은 프로필 아이콘+로그아웃만 남겨 좁은 폭에서 햄버거와 공존하게 한다.

### ShellMobileNavMenu (components/shell/ShellMobileNavMenu.tsx)

**존재 목적**: lg 미만에서 헤더 아래로 펼쳐지는 전체 메뉴 시트. 데스크톱 네비와 동일한 items 배열을 받아 렌더하므로 "모바일에서만 메뉴가 누락되는" 불일치를 구조적으로 차단한다.

| 요소 (표시 라벨) | 종류 | 소스 | 연결 동작 | 추론한 존재 목적 |
|---|---|---|---|---|
| 메뉴 항목 | 링크(행) | items `.map()` N개 반복(데이터: 역할별 네비) | 이동 + `onClose` | 터치 타깃 h-12 확보한 모바일 네비 |
| "로그인" / "회원가입" | 버튼형 링크 | 비로그인 시만 | `/login` / `/signup` | 모바일 게스트도 전환 CTA 접근 가능 |
| "로그아웃" | 링크 | 로그인 시만 | `/logout` | 모바일 세션 종료 |

### UserNameWithRoleBadge / RoleBadgeOnly (components/shell/UserNameWithRoleBadge.tsx)

**존재 목적**: "사용자명 + 역할 뱃지(학생/멘토/관리자)" 표기의 단일 정의. 멘토는 이름 그대로, 학생·관리자는 "○○ 님" 접미 — 호칭 정책을 컴포넌트에 고정해 화면별 표기 흔들림을 막는다. 이름 해석은 `resolveShellUserDisplayName`(nickname → display_name → full_name → 이메일 앞부분 → "사용자")로 위임. `RoleBadgeOnly`는 관리자 콘솔처럼 이름 없이 뱃지만 필요한 자리용.

### PageScaffold (components/shell/PageScaffold.tsx)

**존재 목적**: 페이지 상단 히어로(eyebrow·제목·설명·CTA 칩)와 하단 플레이스홀더 카드(안내/로딩/오류)·참고 목록을 표준화한 페이지 골격. 백엔드 연결 전 화면도 "제목 + 준비 중/표시 중 상태 + 이동 링크"라는 일관 골격을 갖게 해, 실데이터 연결 전후로 레이아웃이 흔들리지 않게 하는 스캐폴딩 장치다. `compactHero`는 맞춤의뢰 주문방처럼 얇은 컨텍스트 바가 필요한 화면용, `hideFooterPlaceholderCards`는 실데이터 연결이 끝난 화면이 플레이스홀더를 떼는 스위치.

| 요소 (표시 라벨) | 종류 | 소스 | 연결 동작 | 추론한 존재 목적 |
|---|---|---|---|---|
| eyebrow·제목·설명 | 헤더 텍스트 | props | 표시 전용 (eyebrow가 제목과 같으면 자동 숨김) | 페이지 정체성 고지 + 중복 꼬리표 제거 |
| CTA 칩 | 링크 | `ctas` `.map()` N개 반복 | 각 href 이동 | 연관 화면으로의 수평 이동 |
| 섹션 카드 ("표시 중"/"준비 중" 뱃지) | 카드 | `sections` `.map()` N개 반복 | 표시 전용 | 어떤 블록이 실데이터인지 연결 상태 고지 |
| "안내"/"로딩"/"오류" 카드 | 플레이스홀더 카드 | `hideFooterPlaceholderCards=false`일 때만 | 표시 전용 | 미연결 화면의 상태 시나리오를 미리 문서화(추정) |
| "참고" 목록 | 목록 | `dataPoints` `.map()` N개 반복 | 표시 전용 | 실데이터 연결 포인트 메모 |

### ResponsivePageColumns (components/shell/ResponsivePageColumns.tsx)

**존재 목적**: 본문+사이드바 2단 화면의 공용 반응형 래퍼. 데스크톱 그리드 클래스는 호출부 값을 그대로 받아 픽셀 단위 보존하고, 모바일에서는 항상 본문이 위로 오는 단일 컬럼으로 재배치한다(좌측 사이드바는 CSS order로만 복원). 데이터·가드에 관여하지 않는 순수 레이아웃 계약이라, 반응형 규칙 11(grid-cols-1→md→lg)을 페이지마다 재발명하지 않게 한다.

### BrandLogo (components/brand/BrandLogo.tsx)

**존재 목적**: 학사모 모양 SVG 아이콘 + "쌤버십" 워드마크의 단일 정의. `variant="landing"|"shell"`로 글자 크기만 달라진다. 로고를 컴포넌트로 고정해 금지 표기(웰버십·쌤버쉽 등) 혼입을 원천 차단하고, 모든 로고 클릭이 `/`(게스트 랜딩)로 통일되게 한다.

### FormSubmitButton (components/common/FormSubmitButton.tsx)

**존재 목적**: `useFormStatus()` 기반 서버 액션 제출 버튼. pending 동안 자동 disabled + `pendingLabel` 표시로 **중복 제출 방지**와 진행 피드백을 모든 폼에서 동일하게 제공한다. 캐시 차감·결제·승인 같은 멱등하지 않은 서버 액션이 많은 서비스 특성상, "두 번 눌러 두 번 결제"를 막는 최소 안전장치가 공용화된 것. `name`/`value`를 받아 한 폼의 여러 제출 버튼(승인/반려 등)도 지원.

### EmptyState — 공용 2종

**① components/common/EmptyState.tsx (레거시·현행 표준)**
**존재 목적**: CLAUDE.md 규칙 8("빈 상태: EmptyState")의 구현체. 기본형은 점선 테두리 세로 카드(제목+설명+행동 children), `compact`형은 [아이콘 타일][제목·설명][행동] 가로 한 줄. `iconTone`(blue=브랜드/mentor=초록/neutral=회색)으로 "누구의 빈 상태인가"까지 표현한다. 데이터 0건이 오류처럼 보이지 않게 하고, 빈 화면마다 다음 행동을 제시하는 전환 장치.

**② components/design-system/EmptyState.tsx (DS v1)**
**존재 목적**: 디자인시스템 v1의 재설계판 — lucide 아이콘(기본 Inbox) + 중앙 정렬, ""0/—/준비 중"을 크게 노출하지 않음" 원칙 구현. index.ts 주석이 명시하듯 기존 화면은 아직 import하지 않으며 `@/components/design-system` 경로로만 쓰는 차세대 후보. 두 개가 공존하는 이유는 프로덕션 화면 무변경 원칙 하에 DS를 점진 도입하기 위함.

### StatusBadge — 공용 2종

**① components/common/StatusBadge.tsx**
**존재 목적**: **질문방 스레드 상태 전용** 배지. `pending`("답변 대기")·`in_progress`("진행 중")·`complete`("답변 완료") 3톤이 라벨·아이콘·색상까지 고정돼 있어, 스레드 카드·채팅 헤더·목록 row 어디서든 질문 워크플로 상태가 동일하게 읽힌다. `legacyToneToStatusBadgeTone`은 과거 amber/blue/emerald 표기를 이 정본으로 흡수하는 마이그레이션 헬퍼.

**② components/design-system/StatusBadge.tsx (DS v1, 별칭 `Badge`)**
**존재 목적**: 라벨 자유 입력 + `kind`(active/pending/success/error/info/default)→tone 자동 매핑의 **범용** 상태 pill. 맞춤의뢰("모집 중"·"분쟁") 등 질문방 3상태로 표현 불가한 도메인 상태를 위해 존재. ①이 "라벨까지 잠근 도메인 정본", ②가 "시각 패턴만 잠근 범용 API"로 역할이 갈린다.

### AppToast (components/ui/AppToast.tsx)

**존재 목적**: CLAUDE.md 규칙 9("`window.alert` 금지")의 대체재. 하단 중앙 고정, 기본 2.8초 후 자동 dismiss, `role="status"`로 스크린리더에 공지. 액션 결과 피드백(저장됨·복사됨 등)을 흐름을 끊지 않고 전달하는 단일 패턴을 제공한다.

### Avatar (components/common/Avatar.tsx)

**존재 목적**: 이름 이니셜 + 배경색 아바타의 단일 정의. `role` 지정 시 역할 고정색(멘토=초록 `#ECFDF5/#047857`, 학생=파랑) — 질문방처럼 두 역할이 대화하는 화면에서 발화자 역할을 색으로 즉시 구분하기 위한 House Style 규칙. role 미지정 시 이름 해시로 쿨톤 파스텔 자동 배정(브랜드 밖 색 제외), `photo`가 있으면 사진 우선·로드 실패 시 이니셜 폴백. 프로필 사진이 없는 초기 사용자층에서도 목록이 비어 보이지 않게 한다.

### LoadingState (components/common/LoadingState.tsx)

**존재 목적**: 스피너 + "불러오는 중입니다." 한 줄 카드. 페이지 단위 `loading.tsx`/Skeleton 이 아닌, 카드·패널 단위 부분 로딩 자리를 통일 표기하기 위한 최소 단위.

### ErrorState (components/common/ErrorState.tsx)

**존재 목적**: 빨간 톤 인라인 오류 카드(선택 제목+메시지). 쿼리 실패를 화면 전체 에러로 승격시키지 않고 해당 블록만 오류 표기로 대체해, 나머지 화면(네비·다른 데이터)은 계속 쓸 수 있게 하는 부분 실패 표현.

### AccessDeniedState (components/common/AccessDeniedState.tsx)

**존재 목적**: 역할 가드에 걸린 사용자에게 "접근이 제한되었습니다" + 사유 + 탈출 링크("홈으로")를 제공. requireRole 기반 3역할 분리 구조에서 잘못 들어온 사용자를 오류 화면이 아니라 자기 영역으로 되돌리는 안내판.

### LoginRequiredState (components/common/LoginRequiredState.tsx)

**존재 목적**: 비로그인 접근 시 "로그인이 필요합니다" + **"학생 로그인"**(`/login/student?next=현재경로`) / **"멘토 로그인"**(`/login/mentor`) 2버튼. `next` 파라미터로 로그인 후 원래 목적지로 복귀시켜, 게스트에게 공개된 목록(개별 질문 등)에서 액션 시점에만 로그인을 요구하는 깔때기 설계를 지탱한다. 로그인 입구가 역할별로 분리된 서비스 구조를 그대로 반영.

### PaymentRequiredState (components/common/PaymentRequiredState.tsx)

**존재 목적**: 앰버 톤 "결제·구독 확인이 필요합니다" 카드 + "구독·결제 화면으로" 링크. 구독 만료·캐시 부족 등 결제 게이트에 걸린 상태를 오류가 아닌 "다음 행동이 있는 상태"로 표현해, 차단 지점을 재결제 전환 지점으로 바꾼다.

### SearchEmptyState (components/common/SearchEmptyState.tsx)

**존재 목적**: "조건에 맞는 결과가 없습니다." 한 줄 + 선택적 힌트. 필터·검색 결과 0건(데이터는 있으나 조건이 좁음)을 데이터 자체가 없는 EmptyState와 구분하기 위해 별도 존재 — 사용자가 "필터를 풀면 된다"고 인지하게 한다.

### PolicyNotice (components/common/PolicyNotice.tsx)

**존재 목적**: 제목 + 본문 children의 회색 `<aside>` 정책 고지 박스. 결제·환불·금지어 등 화면 내 국지적 정책 안내를 본문과 시각적으로 분리된 동일 포맷으로 싣는 그릇.

### FileUploadUnavailableNotice (components/common/FileUploadUnavailableNotice.tsx)

**존재 목적**: "파일·영상 업로드는 저장소·검수 백엔드가 연결된 화면에서만 활성화됩니다" 고정 문구 한 줄. private 버킷 + 검수 전제인 업로드 정책상, 백엔드 미연결 화면에 가짜 업로드 버튼을 두지 않는다는 원칙을 사용자에게 설명하는 자리표시자.

### SiteFooter (components/common/SiteFooter.tsx)

**존재 목적**: 공개 영역((public) 레이아웃·랜딩) 하단의 사이트 푸터. 4컬럼(브랜드 소개 / "서비스" / "고객 지원" / "멘토 지원") + 하단 법적 링크 줄로, 헤더 네비에 없는 보조 동선 — 특히 **멘토 획득 깔때기**("멘토 가입하기"·"멘토 가이드"·"정산 안내")와 **법적 고지 의무**(이용약관·개인정보처리방침·환불 정책)를 전 페이지에서 접근 가능하게 한다. 사업자등록번호는 `NEXT_PUBLIC_BUSINESS_NO` 환경변수가 비어 있으면 노출하지 않음(플레이스홀더 금지).

| 요소 (표시 라벨) | 종류 | 소스 | 연결 동작 | 추론한 존재 목적 |
|---|---|---|---|---|
| "쌤버십" 로고 + 소개문 | 브랜드 블록 | BrandLogo | `/` 이동 | 푸터에서도 브랜드 정체성 반복 |
| "서비스": "멘토 찾기"·"질문방"·"커뮤니티" | 링크 3개 반복(데이터: SERVICE_LINKS) | FooterColumn | 각 채널 이동 | 핵심 채널 보조 동선 |
| "고객 지원": "자주 묻는 질문"·"공지사항"·"고객센터"·"서비스 소개" | 링크 4개 반복(데이터: SUPPORT_LINKS) | FooterColumn | `/support`·`/notices`·`/support#contact`·`/` | 문의·공지 진입로(헤더에 없는 유일한 상시 진입점) |
| "멘토 지원": "멘토 가입하기"·"멘토 가이드"·"정산 안내" | 링크 3개 반복(데이터: MENTOR_LINKS) | FooterColumn | `/signup`·`/legal/mentor-guide`·`/legal/payout-guide` | 공급자(멘토) 획득 깔때기 |
| "이용약관"·"개인정보처리방침"(강조)·"환불 정책"·"고객센터" | 링크 4개 반복(데이터: LEGAL_LINKS) | 하단 줄 | `/legal/*`·`/support#contact` | 법적 고지 의무 충족 — 개인정보처리방침만 font 강조(법령 관행)(추정) |
| "(주)쌤버십 | 사업자등록번호: …" | 텍스트 | 환경변수 조건부 | 표시 전용 | 사업자 정보 고지(값 없으면 미노출) |

### MobileNavTabs (components/common/MobileNavTabs.tsx)

**존재 목적**: 모바일 전용(`lg:hidden`) 가로 스크롤 칩 탭. 데스크톱 좌측 사이드바(마이페이지·멘토 콘솔 등)를 모바일에서 본문을 밀어내지 않는 한 줄 탭으로 변환하는 통일 패턴. `tone="blue"|"green"`으로 학생/멘토 영역 액센트를 따른다.

### AppShell·PageScaffold 연결 lib — lib/shell/*

| 요소 | 종류 | 소스 | 연결 동작 | 추론한 존재 목적 |
|---|---|---|---|---|
| `publicMainNav`/`studentMainNav`/`mentorHeaderNav`/`adminMainNav`/`landingGuestNav` | 상수 배열 | lib/shell/mainNavItems.ts | AppShell·LandingTopNav 데이터 | 절대 잠금 네비를 데이터로 고정 — UI가 아닌 배열이 정본 |
| `getMainNavForRole()` | 함수 | mainNavItems.ts | 역할별 배열 선택 + 멘토=캐시결제 제거·학생=정산 제거·맞춤의뢰 feature flag 필터 | "멘토는 캐시 소비 화면 접근 불가, 맞춤의뢰는 게이트 OFF" 정책을 네비 계층에서 강제 |
| `mentorBlockedCashPath()` / `MENTOR_BLOCKED_CASH_PATHS` | 함수/상수 | mainNavItems.ts | (public)·(mentor) 레이아웃에서 `/cash`·`/wallet/ledger` 접근 시 `/mentor/mypage`로 redirect | 네비 숨김만으로는 못 막는 URL 직접 진입까지 차단(수익자=멘토가 소비자 결제 화면에 못 들어가게) |
| `isMainNavItemActive()` / `mainNavAudience()` | 함수 | lib/shell/mainNavActive.ts | 경로→활성 메뉴 판정(별칭 라우트 포함: /questions, /cash-history 등) | 리다이렉트·별칭 경로에서도 활성 탭이 어긋나지 않게 하는 단일 판정기 |
| `isCustomRequestFeatureEnabled()` | 함수 | lib/shell/featureFlags.ts | `NEXT_PUBLIC_FEATURE_CUSTOM_REQUEST` 읽기, 기본 OFF | 맞춤의뢰 "라우트·데이터 보존 + 노출만 차단" 운영 게이트의 스위치 |
| `shellUserHeaderDisplay()` / `resolveShellUserDisplayName()` | 함수 | lib/shell/userHeaderDisplay.ts | 이름 폴백 체인 + 역할 뱃지 문자열 + 프로필 href 결정 | "닉네임이 '멘토'인 계정" 같은 역할 혼동 이름을 걸러내고 헤더 표기를 한 곳에서 결정 |

### 랜딩 전용 컴포넌트 — components/landing/*

**LandingLayout (LandingLayout.tsx)** — **존재 목적**: `/`만을 위한 전용 프레임(NoticeBanner → LandingTopNav → main → SiteFooter). 일반 화면의 AppShell(본문 max-w-7xl 패딩)과 달리 풀블리드 섹션형 랜딩을 담기 위해 별도 존재.

**LandingTopNav (LandingTopNav.tsx)** — **존재 목적**: 랜딩 상단 헤더. AppShell 헤더와 같은 잠금 네비를 쓰되(`getLandingNavForProfile`), 로그인한 멘토에게는 "질문방" href를 `/mentor/question-room`으로 치환해 역할에 맞는 목적지로 보낸다. 모바일 드로어는 배경 오버레이(portal)까지 갖춘 랜딩 전용 변형.

**LandingMainNav (LandingMainNav.tsx)** — **존재 목적**: 랜딩 데스크톱 중앙 네비. `LANDING_NAV_ITEMS` re-export는 구 코드 하위 호환용(@deprecated 명시).

**NoticeBanner (NoticeBanner.tsx)** — **존재 목적**: 헤더 위 프로모션 스트립. 출시 프로모션("1주일 무료 + 무료 7질문")을 첫 화면 최상단에서 고지해 가입 전환을 밀어 올리고, "자세히 보기"로 `/notices`에 트래픽을 연결한다. 닫기 버튼은 클라이언트 state로만 숨김(새로고침 시 재노출 — 저장 안 함).

**PublicGuestLanding / HomeLanding** — 화면별 상세의 `/` 항목 참조.

### 공지·법적 고지·고객센터 컴포넌트

**PublicNoticesList (components/notices/PublicNoticesList.tsx)** — **존재 목적**: 공개 공지 아코디언 목록. type별 뱃지(공지/이벤트/점검/업데이트) + "중요" 뱃지(isPinned)로 공지 성격을 스캔 가능하게 하고, `<details>` 네이티브 아코디언으로 JS 없이도 본문 개폐가 동작한다.

**PolicyDraftBanner (components/legal/PolicyDraftBanner.tsx)** — **존재 목적**: "서비스 운영 정책 안내 초안입니다. 법률 자문을 대체하지 않으며…" 한 줄 고지. 법무 확정 전 공개된 정책 페이지가 확정 약관으로 오인되는 법적 리스크를 차단하는 면책 배너 — legal 8종 페이지 최상단에 공통 삽입된다.

**SupportFaqAccordion / SupportContactSection (components/support/SupportFaqAccordion.tsx)** — **존재 목적**: FAQ 단일 열림 아코디언(첫 항목 기본 open — 접힌 벽처럼 보이지 않게(추정))과 고객센터 연락 블록(`id="contact"` — 푸터의 `/support#contact` 딥링크 착지점). CS 채널이 이메일뿐인 초기 운영 단계에서 문의를 FAQ로 먼저 흡수해 운영 부하를 줄이는 구조.

### 과목 정본 위젯 — components/subjects/ (2)

**MentorSubjectCheckboxes** — **존재 목적**: 멘토 담당과목 입력을 과목 정본(`lib/subjects/subjectCatalog`) code 체크박스로 강제. 자유 텍스트 과목 입력을 막아 멘토 찾기 필터·매칭이 동일한 코드 체계 위에서 돌게 한다. 대분류 아코디언 + 선택 수 뱃지로 긴 목록을 관리.

**SubjectSelectOptions** — **존재 목적**: 같은 정본을 `<select>`용 `<option>/<optgroup>`으로 렌더. 훅 없는 순수 출력이라 서버·클라이언트 어느 폼에도 꽂을 수 있다 — 입력 UI가 달라도 값 체계는 하나라는 보장.

### 디자인시스템 v1 — components/design-system/ (간단 정의)

**존재 목적(공통)**: `/dev/design-system` 미리보기와 신규 화면(주로 맞춤의뢰 계열)을 위한 차세대 프레젠테이션 키트. index.ts가 명시하듯 **기존 프로덕션 화면은 아직 import하지 않는** 격리 도입 전략이며, 토큰(`ds-*`)·역할 액센트(student=#2563EB / mentor=#059669) 기반.

| 요소 | 종류 | 소스 | 연결 동작 | 추론한 존재 목적 |
|---|---|---|---|---|
| Button (variant primary/secondary/ghost, accent auto/student/mentor/neutral) | 버튼 | Button.tsx | onClick 위임 | "primary는 화면당 1곳" 강조 원칙과 역할 액센트를 API로 강제 |
| SurfaceCard (별칭 Card) | 섹션 카드 | SurfaceCard.tsx | 표시 전용 | 상세·섹션용 표준 카드(테두리·그림자 밀도 통일) |
| ListCard / listCardClassName | 목록 카드 | ListCard.tsx | 표시 전용(className 헬퍼는 `<Link>`용) | 좌측 상태색 액센트 바를 가진 클릭형 목록 행 표준 |
| StatNumber / StatRow / LinkButton | KPI 표시·CTA 링크 | StatNumber.tsx·StatRow.tsx | LinkButton은 href 이동 | 대시보드 KPI 숫자 위계(display 크기·tabular-nums) 통일 |
| ProgressTimeline (+ DS_CUSTOM_ORDER_PROGRESS_STEPS) | 단계 타임라인 | ProgressTimeline.tsx | 표시 전용 | 맞춤의뢰 주문의 완료/현재/예정 단계를 목록(가로)·작업방(세로)에서 동일 표기 |
| StatusBadge·EmptyState (DS판) | 상태 pill·빈 상태 | 위 사전 2종 항목 참조 | — | — |

---

## 화면별 상세

### app/layout.tsx — 루트 레이아웃 (전 라우트 공통)

**바인딩**: app/layout.tsx (단독)
**화면의 존재 목적**: 모든 페이지의 HTML 골격. `lang="ko"`, metadata(title "쌤버십 웹"), `colorScheme: light` 강제(라이트 테마 고정 서비스), Geist Mono 폰트 변수, globals.css 로드. 이것이 없으면 문서 언어·뷰포트·전역 스타일이 정의되지 않는다. 역할별 셸은 하위 그룹 레이아웃에 위임하고 자신은 최소한만 담당한다.

| 요소 (표시 라벨) | 종류 | 소스 | 연결 동작 | 추론한 존재 목적 |
|---|---|---|---|---|
| `<html lang="ko" … scheme-light>` | 문서 루트 | RootLayout | — | 한국어 서비스 선언 + 다크모드 무시하고 라이트 고정(브랜드 컬러 체계가 라이트 전제) |
| metadata "쌤버십 웹" / viewport themeColor #ffffff | 메타 | RootLayout | — | 탭 제목·모바일 브라우저 크롬 색 통일 |

### / — 랜딩 (`app/page.tsx`)

**바인딩**: app/page.tsx → LandingLayout(NoticeBanner + LandingTopNav + SiteFooter) → HomeLanding → PublicGuestLanding · 데이터: `loadHomeLandingData()` (lib/landing/landingPageQueries.ts)
**화면의 존재 목적**: 서비스의 유일한 무차별 진입점이자 가입 전환의 최상단 깔때기. "구독형 질문 멘토링"이라는 낯선 모델을 히어로→실적 통계→차별 요소(질문 누적·연결노트·검증 멘토)→요금제→이용 흐름→가입 CTA 순서로 설득한다. 주석 명시대로 **로그인 여부와 무관하게 동일한 게스트 랜딩**을 보여주고(로고 클릭·직접 접속 동일), 로그인 사용자에게는 히어로 CTA만 역할 홈으로 치환한다 — 이 화면이 없으면 비로그인 방문자가 서비스 가치를 이해할 곳도, `/mentors`·`/signup`으로 흘러들 곳도 없다. 데이터 로드 실패 시 `emptyHomeLandingData()` 폴백으로 500을 방지(랜딩은 죽으면 안 되는 화면).

| 요소 (표시 라벨) | 종류 | 소스 | 연결 동작 | 추론한 존재 목적 |
|---|---|---|---|---|
| "공지" 뱃지 + "6월 모의고사 직후 출시 기념! 지금 가입하면 1주일 무료 + 무료 7질문 제공" | 배너 | NoticeBanner.tsx (하드코딩)^주4 | 표시 전용 | 출시 프로모션 1순위 고지 |
| "자세히 보기" | 링크 | NoticeBanner.tsx | `/notices` 이동 | 프로모션 상세를 공지 채널로 연결 |
| 배너 "닫기" | 버튼 | NoticeBanner.tsx | 클라이언트 state로 숨김(비영속) | 배너에 밀린 히어로를 복원할 사용자 제어권 |
| 상단 네비(멘토 찾기/질문방/개별 질문/커뮤니티/캐시결제 …) | 네비 링크 | LandingTopNav → getLandingNavForProfile | N개 반복(데이터: landingGuestNav, 맞춤의뢰는 flag OFF 시 숨김; 멘토 로그인 시 mentorHeaderNav + 질문방 href 치환) | 랜딩에서 바로 각 채널 탐색 허용 |
| "로그인" / "회원가입" | 버튼형 링크 | LandingTopNav (비로그인 시만) | `/login` / `/signup` | 게스트 전환 CTA |
| 프로필 필 + "로그아웃" | 링크 | LandingTopNav (로그인 시만) | 역할별 프로필 href / `/logout` | 로그인 사용자가 랜딩에 와도 계정 동선 유지 |
| "학교·전공 인증 대학생 멘토 구독 멘토링" | eyebrow 텍스트 | PublicGuestLanding | 표시 전용 | 첫 줄에서 카테고리(구독 멘토링)와 신뢰 장치(인증) 동시 선언 |
| "공부는 혼자, 성장은 함께" | H1 | PublicGuestLanding | 표시 전용 | 브랜드 슬로건 — 커뮤니티형 멘토링 포지셔닝 |
| 히어로 primary CTA — 게스트 "멘토 찾기" / 학생 "마이페이지" / 멘토 "질문방 바로가기" | 버튼(CTA) | HomeLanding.tsx (역할 분기) | `/mentors` / `/mypage` / `/mentor/question-room` | 방문자는 핵심 전환 경로(멘토 탐색)로, 기존 사용자는 자기 작업 홈으로 |
| 히어로 secondary CTA — 게스트 "무료 체험 시작하기" / 학생 "질문방 바로가기" / 멘토 "정산 보기" | 버튼(CTA) | HomeLanding.tsx | `/signup` / `/question-room` / `/mentor/payouts` | 탐색이 부담스러운 방문자용 직행 가입 경로 |
| 히어로 이미지 + 플로팅 칩 "새 답변 도착!"·"학습 노트 업데이트"·"멘토 연결 완료" | 이미지·장식 칩 3개 | PublicGuestLanding | 표시 전용 | 질문방 알림·연결노트·매칭이라는 핵심 경험 3가지를 시각 프리뷰로 압축(추정) |
| 통계 "멘토(등록)"·"숏폼 글"·"게시판 글" ("N+" 표기) | 숫자 카드 | STATS 3개 반복(데이터: `fetchLandingPublicStats` — mentor_profiles·shortform_posts·community_posts count) | 표시 전용, **3개 모두 실수치일 때만 섹션 노출** | 사회적 증거 — 단 "준비 중" 하나라도 있으면 통째로 숨겨 초기 빈 수치 역효과 방지 |
| "쌤버십만의 학습 방식" — "질문 카드 누적"·"연결노트"·"검증된 멘토" | 피처 카드 | FEATURES 3개 반복(정적) | 표시 전용 | 단건 Q&A 서비스와의 차별점(누적·기록·인증) 각인 |
| "구독 플랜" — "라이트"·"스탠다드"(추천)·"프리미엄" 카드 | 가격 카드 | SUBSCRIBE_PLAN_CATALOG 3개 반복 + PLAN_BENEFITS^주1 | 표시 전용(가격·주간 한도·혜택) | 가입 전 가격 투명성 — 결제 단계 이탈 감소(추정) |
| "추천" 뱃지 | 뱃지 | plan.recommend=true(스탠다드)일 때만 | 표시 전용 | 기본 선택지 앵커링(잠금값 "스탠다드=추천"과 일치) |
| "지금 구독하기" | 버튼(CTA) ×3 | 플랜 카드별 | `/mentors` 이동 | 구독은 멘토 단위이므로 플랜이 아닌 멘토 선택으로 유도 |
| "이용 흐름" STEP 1~4 — "멘토 찾기"·"구독하기"·"질문하기"·"성장하기" | 스텝 카드 | STEPS 4개 반복(정적) | 표시 전용 | 구독형 멘토링의 사용법을 4단계로 단순화해 진입 장벽 해소 |
| "회원가입하면 무료 질문권 7개 지급!" (+ "최대 3개"·"7일 후 소멸" 조건) | CTA 섹션 헤드 | PublicGuestLanding | 표시 전용 | 마지막 스크롤 지점의 가입 인센티브 + 조건 고지로 분쟁 예방 |
| "안심 구독"·"남은 기간 환불"·"결제 안전 보호" | 신뢰 문구 3줄 | PublicGuestLanding | 표시 전용 | 결제 불안(구독 함정·환불 불가) 선제 해소 — "캐시 예치" 언급은 에스크로 인프라 홍보 |
| "무료로 시작하기" | 버튼(CTA) | PublicGuestLanding | `/signup` 이동 | 페이지 말미 최종 전환 버튼 |

**비고**: `loadHomeLandingData`는 통계 외에도 notices·멘토 카드 14행·숏폼/게시판 4행·플랜 테이블 샘플을 병렬 로드하지만, 현행 `HomeLanding`은 `publicStats`만 소비한다(나머지는 과거/향후 랜딩 블록용 적재로 추정 — `lib/landing/landingDataModel.ts`의 LANDING_DATA_MODEL 5항목이 그 설계 흔적, 현재 미참조).^주4

### app/(public)/layout.tsx — 공개 영역 셸

**바인딩**: app/(public)/layout.tsx → AppShell(area="public") + SiteFooter
**화면의 존재 목적**: 커뮤니티·멘토 찾기·legal·support·notices 등 로그인 없이 볼 수 있는 라우트 전체의 프레임. 로그인 상태를 읽어 **로그인했더라도 공개 화면에서 자기 역할의 헤더**(네비·프로필)를 보게 하고, 멘토가 `/cash`·`/wallet/ledger`(캐시 소비 화면)로 진입하면 `/mentor/mypage`로 redirect해 수수료 수익자와 캐시 소비자 역할 분리를 URL 수준에서 지킨다. `force-dynamic`으로 세션별 헤더가 캐시에 굳지 않게 한다.

| 요소 (표시 라벨) | 종류 | 소스 | 연결 동작 | 추론한 존재 목적 |
|---|---|---|---|---|
| AppShell(area="public", 역할별 sessionRole) | 셸 | layout | 헤더·네비 렌더 | 공개 화면에서도 로그인 역할 유지 |
| 멘토 캐시 경로 가드 | redirect | `mentorBlockedCashPath()` | 멘토 && /cash·/wallet/ledger → `/mentor/mypage` | 멘토의 소비자 결제 화면 진입 차단 |
| SiteFooter | 푸터 | layout | 사전 참조 | 공개 영역 전 페이지 법적 고지·보조 동선 |

### app/(student)/layout.tsx · app/(mentor)/layout.tsx · app/(admin)/layout.tsx — 역할 그룹 셸 (셸 관점 요약)

**화면의 존재 목적**: 세 그룹 레이아웃 모두 "가드 후 AppShell로 감싼다"는 동일 계약의 역할별 변형이다.
- **(student)**: 기본 `requireRole("student")` + `AppShell area="student"`. 예외 2개 — ① `/individual-questions` 목록만 게스트 열람 허용(멘토·관리자는 `getPostLoginPath`로 자기 영역 redirect): 개별질문을 비로그인 전환 깔때기로 쓰는 설계. ② `/wallet`·`/wallet/charge`는 `requireWalletChargeAccess()`로 멘토에게도 허용(멘토도 캐시 **충전**은 가능 — 잠금 멘토 네비의 "캐시충전"과 정합)하고 셸 area를 역할에 맞춰 바꾼다.
- **(mentor)**: `mentorBlockedCashPath` redirect + `requireRole("mentor")` + `AppShell area="mentor"`. CLAUDE.md 규칙 6(레이아웃 가드 + 페이지별 중복 호출)의 레이아웃 측 절반.
- **(admin)**: 셸 없이 `requireRole("admin")` 가드만 수행(단 `/admin/login`은 제외 — 로그인 화면이 가드에 막히는 순환 방지). 실제 콘솔 셸(AdminConsoleShell, 사이드바 240px)은 하위 `(console)/layout.tsx` 담당 — 관리자 리포트 범위.

| 요소 (표시 라벨) | 종류 | 소스 | 연결 동작 | 추론한 존재 목적 |
|---|---|---|---|---|
| requireRole 가드 | 서버 가드 | 각 layout 첫 로직 | 미충족 시 redirect | 역할 영역 침범을 렌더 전에 차단 |
| AppShell(area=역할) | 셸 | (student)/(mentor) | 역할 네비 헤더 | 잠금 네비 자동 적용 |
| `x-pathname` 헤더 분기 | 조건부 | headers() | 경로별 가드 예외 결정 | 레이아웃 하나로 예외 경로(게스트 열람·충전 공용) 처리 |

### /legal/terms · /legal/privacy · /legal/refund · /legal/community-guidelines · /legal/copyright · /legal/minor-consent · /legal/no-ghostwriting · /legal/no-offplatform-contact — 정책 안내 8종 (공통 골격)

**바인딩**: app/(public)/legal/{slug}/page.tsx (각각 단독, 전부 PolicyDraftBanner + 제목 + 리스트/문단 + 관련 링크 1개의 동일 골격)
**화면의 존재 목적**: 플랫폼의 운영 규칙을 사용자가 링크로 확인할 수 있는 주소로 만든 문서 라우트군. 각 문서는 특정 분쟁 유형의 예방·처리 근거가 된다 — 이 페이지들이 없으면 푸터 법적 링크, 결제·작성 화면의 정책 고지, 제재 시 "근거 규칙" 링크가 모두 끊긴다. 8종 전부 PolicyDraftBanner로 "확정 약관 아님"을 고지한다.

| 요소 (표시 라벨) | 종류 | 소스 | 연결 동작 | 추론한 존재 목적 |
|---|---|---|---|---|
| PolicyDraftBanner ("…운영 정책 안내 초안입니다…") | 고지 배너 | 8개 페이지 공통 | 표시 전용 | 법무 확정 전 면책 — 사전 참조 |
| "이용약관 (운영정책 안내 초안)" + 규칙 4항 | 문서 본문 | terms/page.tsx | "개인정보처리방침" 링크 | 본인 명의·대필 금지·외부 연락처 금지 등 최상위 이용 조건 고지 |
| "개인정보처리방침 (안내 초안)" | 문서 본문 | privacy/page.tsx | "이용약관" 링크 | 개인정보 처리 고지 의무 자리(학생증 이미지 등 민감 수집 전제) |
| "환불 정책 (안내 초안)" — 정기 구독/맞춤의뢰/캐시 3분류 | 문서 본문 | refund/page.tsx | "분쟁·문의 흐름"(`/support/disputes`) 링크 | 결제 유형별 환불 조건이 다름을 명시 — 관리자 환불 콘솔의 대외 근거 |
| "커뮤니티 이용규칙 (안내 초안)" | 문서 본문 | community-guidelines/page.tsx | "커뮤니티 홈" 링크 | 검수·신고(content_reports) 제재의 근거 규칙 |
| "저작권·업로드 가이드 (안내 초안)" | 문서 본문 | copyright/page.tsx | "커뮤니티 이용규칙" 링크 | 숏폼·게시판 업로드물의 권리 책임을 작성자에게 귀속 |
| "만 14세 미만 보호자 동의 (안내 초안)" | 문서 본문 | minor-consent/page.tsx | "회원가입" 링크 | 미성년(중·고생) 주 고객층에 대한 법정대리인 동의 정책 예고 |
| "세특·자소서 대필 금지 (운영 범위)" — 허용/금지 구분 | 문서 본문 | no-ghostwriting/page.tsx | "이용약관" 링크 | 맞춤의뢰 금지어 검사와 짝을 이루는 서비스 범위 선언(대필 플랫폼 아님) |
| "외부 연락처 교환 금지 (맞춤의뢰)" | 문서 본문 | no-offplatform-contact/page.tsx | 링크 없음, "맞춤의뢰는 곧 오픈 예정" 문구 | 플랫폼 우회 직거래(수수료 이탈·에스크로 무력화) 금지 근거 |

### /legal/mentor-guide — 멘토 가이드

**바인딩**: app/(public)/legal/mentor-guide/page.tsx (자체 GuideSection 헬퍼, metadata 有, PolicyDraftBanner 없음^주3)
**화면의 존재 목적**: legal 폴더에 있지만 실질은 **멘토 리크루팅 랜딩**. 멘토가 하는 일(4채널)→시작 흐름(가입→인증·심사→프로필→활동)→품질 가이드→수익·정산→운영 규칙 순으로, 예비 멘토가 가입을 결심하고 심사 절차를 이해하게 한다. 공급자(멘토) 없이는 마켓플레이스가 성립하지 않으므로, 푸터 "멘토 지원" 컬럼에서 상시 접근되는 이 문서가 공급자 획득 깔때기의 본문이다. 구체 수치(수수료율 등)는 의도적으로 싣지 않고 로그인 후 화면으로 위임한다.

| 요소 (표시 라벨) | 종류 | 소스 | 연결 동작 | 추론한 존재 목적 |
|---|---|---|---|---|
| "멘토 지원" eyebrow(초록) + "멘토 가이드" | 헤더 | page | 표시 전용 | 멘토 영역 액센트(#059669)로 대상 독자 표시 |
| GuideSection "멘토가 하는 일" (질문방·연결노트·커뮤니티·맞춤의뢰 4항) | 섹션 | page | 표시 전용 | 4개 거래 채널을 멘토 관점에서 소개 |
| GuideSection "시작 흐름" (가입→대학(재) 인증·심사→프로필·요금제→활동) + "멘토 대시보드" 링크 | 섹션 | page | `/mentor/mypage` | 인증→승인 신뢰 인프라를 절차로 예고해 심사 이탈 방지 |
| GuideSection "좋은 답변·콘텐츠 가이드" (5항) | 섹션 | page | 표시 전용 | 답변 품질·대필 금지·외부 연락처 금지 등 행동 규범 사전 교육 |
| GuideSection "수익·정산" | 섹션 | page | "정산 안내"(`/legal/payout-guide`)·"정산 화면"(`/mentor/payouts`) | 수익 모델 소개 + 구체 수치는 정산 화면으로 위임 |
| GuideSection "커뮤니티·운영 규칙" + 관련 링크 3개("이용약관"·"대필 금지 안내"·"환불 정책") | 섹션 | page | `/legal/*` | 정책 문서망으로의 허브 역할 |
| "멘토로 시작하기" aside — "멘토 가입하기"·"멘토 로그인" | 버튼(CTA) 2개 | page | `/signup` / `/login/mentor` | 문서 말미 전환 버튼 — 리크루팅 랜딩의 마감 |

### /legal/payout-guide — 정산 안내

**바인딩**: app/(public)/legal/payout-guide/page.tsx (mentor-guide와 동일한 GuideSection 골격, PolicyDraftBanner 없음^주3)
**화면의 존재 목적**: "멘토가 되면 돈을 어떻게 받나"라는 공급자의 1순위 질문에 비로그인 상태로 답하는 문서. 정산 정의→월 단위 주기·수수료 공제→환불·취소의 익월 반영→"실제 숫자는 로그인 후 정산 대시보드에서만" 순서로, 신뢰 인프라(회계 원칙)를 설명하되 구체 금액은 노출하지 않는 정보 경계를 지킨다. 멘토 획득과 정산 분쟁 예방(조정 반영 원칙 사전 고지)을 겸한다.

| 요소 (표시 라벨) | 종류 | 소스 | 연결 동작 | 추론한 존재 목적 |
|---|---|---|---|---|
| "멘토 지원" eyebrow + "정산 안내" | 헤더 | page | 표시 전용 | 대상·주제 선언 |
| GuideSection "정산이란?" / "정산 주기와 지급" / "환불·취소와 익월 반영" | 섹션 3개 | page | 표시 전용 | 집계→공제→지급→조정이라는 회계 흐름의 대외 설명 |
| GuideSection "실제 금액·일정 확인" + "구독 안내" 링크 | 섹션 | page | `/subscribe` | "비로그인엔 상세 금액 미표시" 경계 고지 |
| "정산 화면에서 확인하기" aside — "정산 화면 보기"·"멘토 로그인" | 버튼(CTA) 2개 | page | `/mentor/payouts` / `/login/mentor` | 실수치가 있는 로그인 화면으로 전환 |
| 하단 문구 "멘토 가입"·"멘토 가이드" 링크 | 링크 | page | `/signup` / `/legal/mentor-guide` | 리크루팅 문서망 순환 |

### /support — 고객센터·FAQ

**바인딩**: app/(public)/support/page.tsx → SupportFaqAccordion + SupportContactSection
**화면의 존재 목적**: 셀프서비스 CS의 1차 관문. 캐시·구독·질문 한도·답변 속도·무료 질문권·환불·계정·맞춤의뢰라는 8개 예상 질문(FAQ_ITEMS 정적 정의)을 아코디언으로 먼저 소화시키고, 해결 안 되는 문의만 이메일로 흘린다. 이 화면이 없으면 푸터 "자주 묻는 질문"·"고객센터" 링크와 환불 정책의 문의 동선이 모두 끊기고, 반복 문의가 전부 이메일로 유입된다.

| 요소 (표시 라벨) | 종류 | 소스 | 연결 동작 | 추론한 존재 목적 |
|---|---|---|---|---|
| "고객 지원" eyebrow + "고객센터" | 헤더 | page | 표시 전용 | 화면 정체성 |
| FAQ 항목 ("캐시는 어떻게 충전하고 사용하나요?" 외) | 아코디언 8개 반복(데이터: FAQ_ITEMS 정적) | SupportFaqAccordion | 개폐(단일 열림), 답변 내 링크 → `/wallet/charge`·`/mentors`·`/subscribe`·`/notices`·`/legal/refund` | 반복 문의 흡수 + 답변에서 해당 기능 화면으로 직접 연결(문의를 이용으로 전환) |
| "1:1 문의 · 고객센터" (`#contact`) | 섹션 | SupportContactSection | 표시 전용(anchor 착지점) | 푸터 `/support#contact` 딥링크의 목적지 |
| "support@ssambership.example" ("추후 공식 주소로 안내됩니다") | mailto 링크 | SupportContactSection | 메일 작성 | 유일한 실문의 채널 — 도메인은 자리표시자^주5 |
| "운영 시간 평일 10:00–18:00" | 텍스트 | SupportContactSection | 표시 전용 | 응답 기대치 관리 |
| "환불 정책" 링크 | 링크 | SupportContactSection | `/legal/refund` | 환불 문의를 정책 문서로 선분류 |

### /notices — 공지사항

**바인딩**: app/(public)/notices/page.tsx → lib/notices/publicNoticesQueries.ts(`loadPublicNotices` — `app_notices`, RLS: is_active+노출 기간) → PublicNoticesList / EmptyState
**화면의 존재 목적**: 점검·업데이트·이벤트의 공식 고지 채널. 랜딩 NoticeBanner "자세히 보기", 푸터 "공지사항", FAQ 답변이 모두 이 주소로 수렴한다. 운영자가 admin 공지 콘솔에서 등록한 내용이 사용자에게 보이는 유일한 공개면으로, 이것이 없으면 점검·프로모션 고지를 배너 하드코딩으로만 해야 한다. 조회 실패를 accessDenied(권한 확인 중)와 0건(등록 없음)으로 구분해 각각 다른 EmptyState 문구를 보여준다.

| 요소 (표시 라벨) | 종류 | 소스 | 연결 동작 | 추론한 존재 목적 |
|---|---|---|---|---|
| "고객 지원" eyebrow + "공지사항" | 헤더 | page | 표시 전용 | 화면 정체성 |
| 공지 행(타입 뱃지 "공지/이벤트/점검/업데이트" + "중요" + 제목 + 날짜 + "내용 보기") | `<details>` 아코디언 | PublicNoticesList — items N개 반복(데이터: app_notices 최신 50행) | 개폐로 본문 표시 | 목록 스캔(뱃지·중요 표시)과 본문 열람을 한 화면에서 |
| "공지를 불러올 수 없습니다" | EmptyState | accessDenied=true일 때만 | 표시 전용 | RLS/권한 오류를 사용자 언어로 완곡 표기 |
| "등록된 공지가 없습니다" | EmptyState | items 0건일 때만 | 표시 전용 | 빈 목록의 정상 상태 표기 |
| "자주 묻는 질문 · 고객센터" | 링크 | page | `/support` | 공지에 없는 의문을 CS 동선으로 연결 |

### /dev/design-system — 디자인시스템 미리보기 (개발 전용)

**바인딩**: app/dev/design-system/page.tsx → components/design-system/* (index.ts 배럴)
**화면의 존재 목적**: DS v1 토큰·컴포넌트의 살아있는 카탈로그. `process.env.NODE_ENV === "production"`이면 `notFound()`로 404 처리되고 네비·사이트맵에도 없음 — 개발자가 실제 렌더 결과(타이포 위계·StatusBadge kind 6종·Button 변형·ProgressTimeline 방향·EmptyState·토큰 값)를 눈으로 검증하는 내부 도구다. 이것이 없으면 DS 컴포넌트 변경의 회귀 확인을 프로덕션 화면에서 해야 해서 "기존 화면 무변경 도입" 전략이 성립하지 않는다.

| 요소 (표시 라벨) | 종류 | 소스 | 연결 동작 | 추론한 존재 목적 |
|---|---|---|---|---|
| production 시 404 | 가드 | `notFound()` | — | 내부 도구의 운영 노출 차단 |
| "Typography & StatNumber" / "StatusBadge" / "Button" / "ProgressTimeline" / "EmptyState" / "Token reference" | 쇼케이스 섹션 6개 | page (정적 샘플 데이터) | 표시 전용 | 각 DS 컴포넌트의 사용례·제약("primary는 화면당 1곳만") 문서화 |

---

## 각주 — 코드 ≠ 기획 정본 차이 및 특이사항

- **^주1 (플랜 표기·가격)**: CLAUDE.md 잠금값은 "베이직(주4)/스탠다드(주9)/프리미엄" · 55,000/114,900/249,900캐시이나, 코드 정본 `lib/subscribe/subscribePlanCatalog.ts`는 "라이트/스탠다드/프리미엄" · **29,900/84,900/179,000캐시**로 상이하다(tier id `limited/standard/premium`와 "스탠다드=추천"은 일치). 랜딩 가격 카드는 코드 정본을 따른다. 어느 쪽이 최신 결정인지는 이 리포트 범위에서 판정하지 않음.
- **^주2 (맞춤의뢰 네비 숨김)**: 잠금 네비에는 "맞춤의뢰"가 포함되나, `getMainNavForRole`/`getLandingNavForProfile`이 feature flag(`NEXT_PUBLIC_FEATURE_CUSTOM_REQUEST`, 기본 OFF)로 admin 외 전 역할에서 임시 제거한다. 라우트·데이터는 보존 — 배경 문서의 "운영 게이트 OFF"와 정합.
- **^주3 (PolicyDraftBanner 적용 범위)**: legal 10종 중 8종만 초안 배너를 달고, mentor-guide·payout-guide 2종은 배너 없이 metadata를 갖춘 완성형 가이드다 — 정책 "초안"과 리크루팅 "가이드"의 성격 차이로 추정.
- **^주4 (랜딩 데이터 미소비)**: NoticeBanner 문구는 하드코딩이며 `loadHomeLandingData`가 병렬 로드하는 notices·멘토 카드·숏폼/게시판/플랜 행은 현행 HomeLanding에서 소비되지 않는다(publicStats만 사용). `lib/landing/landingDataModel.ts`(LANDING_DATA_MODEL)도 앱 코드에서 미참조 — 과거 데이터 랜딩 설계의 잔재 또는 향후 연결 예약(추정).
- **^주5 (기타 실측 특이)**: `components/layout/Header.tsx`는 **0바이트 빈 파일**이고 어디서도 import되지 않는다(사양 명단에는 있으나 실체 없음). 고객센터 이메일은 `support@ssambership.example` 자리표시자. NoticeBanner 닫기는 저장되지 않아 새로고침 시 재노출.

---

*집계 기준: "요소 행"은 본 문서 내 5열 표의 데이터 행. "(추정)" 표기는 코드·기획 문서에서 직접 근거를 찾지 못한 추론에만 사용.*
