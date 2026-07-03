# 03. 멘토 인증·프로필 (신뢰 인프라 B) — 존재 목적 리포트

> 대상 라우트 9개 · 요소 행 129개 · 근거: 코드 실측 + 기획 정본
>
> 범위: 공개 멘토 디렉터리(목록·상세) + 멘토 측 프로필 편집·학교/전공 인증·학적변경요청·채널·대시보드 잔존물 + 즐겨찾기 API.
> 제외: `mentor/payouts`·리뷰 관리(09번), `mentor/mypage`·활동상태 UI(02번 — 단 lib 판정 로직은 본 문서 말미 사전에 수록).

## 커버 라우트 (검증용 전수 목록)

| # | 라우트 | 파일 | 성격 |
|---|--------|------|------|
| 1 | `/mentors` | `app/(public)/mentors/page.tsx` (+ `loading.tsx`) | 공개 멘토 찾기(목록) |
| 2 | `/mentors/[mentorId]` | `app/(public)/mentors/[mentorId]/page.tsx` (+ `loading.tsx`) | 공개 멘토 상세 |
| 3 | `/mentor/profile` | `app/(mentor)/mentor/profile/page.tsx` | `/mentor/profile/edit`로 redirect |
| 4 | `/mentor/profile/edit` | `app/(mentor)/mentor/profile/edit/page.tsx` | 멘토 프로필 편집(668줄 폼) |
| 5 | `/mentor/verification` | `app/(mentor)/mentor/verification/page.tsx` (272줄) | 학교·전공 인증 상태/제출 |
| 6 | `/mentor/academic-record-change` | `app/(mentor)/mentor/academic-record-change/page.tsx` (209줄) | 학적변경요청 |
| 7 | `/mentor/channel` | `app/(mentor)/mentor/channel/page.tsx` (+ `loading.tsx`) | 준비 중 숨김 — `/mentor/mypage` redirect |
| 8 | `/mentor/dashboard` | `app/(mentor)/mentor/dashboard/loading.tsx`만 존재 | **page.tsx 부재** — 각주 F3 |
| 9 | `/api/mentors/favorites` | `app/api/mentors/favorites/route.ts` | 찜 GET/POST/DELETE API |

멘토 그룹 공통: `app/(mentor)/layout.tsx`가 `requireRole("mentor")` + 캐시결제 경로 차단(`mentorBlockedCashPath` → `/mentor/mypage` redirect) 후 `AppShell area="mentor"` 렌더 — 규칙 6(레이아웃 가드 + 페이지별 중복 호출) 실측 일치.

---

## 화면별 상세

### /mentors — 멘토 찾기 (`public-mentors`)

**바인딩**: `parseMentorsListFilters(searchParams)` → `loadSchoolClassificationCatalogs`(`school_tier_catalog`·`major_category_catalog`, 실패 시 상수 폴백) → `loadPublicMentorsList`(디렉터리 users RPC whitelist → `mentor_profiles` 배치 → reviews 배치 집계 → plans 배치 → 통계 배치 → cap 배치, 서버 메모리 필터·정렬·12개/페이지 슬라이스) + 로그인 시 `loadFavoriteMentorIdsForUser`(`favorites`). 렌더는 `MentorsListBody`.

**화면의 존재 목적**: "검증된 현직 대학생 멘토"라는 신뢰 상품을 학생이 과목·학교군·요금으로 탐색해 구독 결정까지 끌고 가는 마켓플레이스 관문. 서버 필터에서 `verification_status`가 approved 계열이 아니거나 담당 과목 0개인 멘토를 목록에서 원천 제외해(코드 주석 "과목 필수 게이트") "노출 = 승인·활동 준비 완료"라는 품질 보증을 화면 자체가 수행한다.

| 요소 (표시 라벨) | 종류 | 소스 | 연결 동작 | 추론한 존재 목적 |
|---|---|---|---|---|
| "쌤버십" / "멘토 찾기" / "과목·학년·요금으로 멘토를 찾고, 베이직·스탠다드·프리미엄 플랜으로 구독을 시작하세요." | 헤더 텍스트 | 정적 (`MentorsListBody`) | — (모바일은 축약 문구 분기) | 화면 정체성 선언 + 구독 3플랜 존재 예고 |
| "과목, 멘토 이름, 학교 등 검색" | search input `name="q"` | `filters.q` defaultValue | GET `/mentors` 제출(기존 view·sort·grades 등 hidden으로 보존) | 자유 텍스트 탐색 — 이름·소개·과목·학교 blob 부분일치 매칭 |
| "검색" | submit 버튼 | — | 폼 제출 | 검색 실행 |
| "필터" (SlidersHorizontal) | 버튼 (`lg:hidden`) | drawerOpen state | 모바일 하단 시트("상세 필터") 오픈 | 좁은 화면에서 사이드바 필터 접근 보장 |
| "최근 본 멘토 N" | Link | localStorage `ssambership_recent_mentors` (`recentMentorCount`) | `/mentors?view=list` | 재방문 탐색 연속성 — 상세 방문 시 `MentorRecentRecorder`가 기록(최대 20) |
| "찜한 멘토 N" | Link | `favoriteIds.length` | `/mentors?view=list` | 찜 수 노출로 비교·재검토 동선 유도 |
| 정렬 칩 "인기순 · 최신순 · 리뷰많은순 · 가격낮은순" | Link 칩 ×4 반복 | `MENTOR_SORT_OPTIONS` | `?sort=` 패치 href(popular은 파라미터 제거) | 정렬 전환. popular=리뷰수×10+평점, new=users.created_at, price_asc=최저 티어가 기준 |
| 리스트/그리드 토글 (aria-label "리스트 보기"/"그리드 보기") | Link 아이콘 ×2 | `filters.view` | `?view=list|grid` | 밀도 선호 전환 — MentorCard layout 분기 |
| 필터 사이드바 "과목" (전체 + 대분류 라디오) | radio 그룹, N개 반복 | `MENTOR_SUBJECT_OPTIONS`(과목 정본 대분류, `etc` 제외) | GET 제출 시 `subject=` | 대분류 선택 → 소분류 라벨까지 확장해 자유텍스트 `teaching_subjects` 부분일치 매칭 |
| 필터 "학교군" (전체/서연고/서성한/중경외시/건동홍/그외/미분류) | radio 그룹, 7개 반복 | 페이지가 주입한 `catalogs.schoolTiers`(DB 카탈로그, 폴백 `SCHOOL_TIERS`) | `school=` | **인증된** `school_tier`만 매칭(`schoolVerified=false`면 탈락) — 학교군 필터 자체가 인증 인프라 위에서만 동작 |
| 필터 "대상 학년" (중등/고등/N수) | checkbox ×3 반복 | `MENTOR_GRADE_OPTIONS` | `grades=` CSV | 프로필 텍스트 blob 정규식 매칭(중등=중학/중1…, N수=재수/검정) — 전용 컬럼 없는 근사 필터 |
| 필터 "구독 요금" (3~5만/5~10만/10~20만/20만 이상) | radio ×4 반복 | `MENTOR_PRICE_BAND_OPTIONS` | `priceBand=` | 최저 티어가(`minPriceKrw`) 밴드 매칭 — 예산 기반 좁히기 |
| 필터 "전공 계열" (메디컬/교육/인문/사회상경/자연/공학/예체능/기타) | checkbox ×8 반복 | `catalogs.majorCategories`(폴백 `VERIFIED_MAJOR_CATEGORIES`) | `mentorTypes=` CSV | `verified_major_category`(관리자 검증값)만 매칭 — 미인증 멘토 제외 |
| 필터 "추가 필터" (답변 속도 빠른 순/평점 높은 순/기본 정렬 유지) | radio ×3 | `extraSort` state → hidden `sort` | 제출 시 sort=response/rating | 정렬 칩에 없는 숨은 정렬 2종의 진입로(각주 F6) |
| "검색 결과 N명 보기" | submit | `totalCount` | 필터 폼 제출 | 적용 결과 수를 버튼에 선반영해 헛클릭 방지 |
| "초기화" | Link | — | `/mentors` | 전체 필터 리셋 |
| "검색 결과 **N**명 · from–to번째" / "조건에 맞는 멘토 0명" | 카운트 텍스트 | `list.totalCount/page/pageSize` | — | 결과 규모·현재 위치 피드백 |
| "일부 프로필 정보가 누락될 수 있어요." | 경고 텍스트 (profilesError 시) | `list.profilesError` | — | 부분 실패를 숨기지 않는 정직한 degrade |
| "멘토 목록을 불러오지 못했어요" 카드 | 에러 분기 (usersError 시) | `list.usersError` | — | 디렉터리 로드 전면 실패 시 전체 화면 대체 |
| "현재 공개된 멘토 정보만 표시하고 있어요…" | 힌트 박스 | `onlySelfVisibleHint && cards 0` (본인만 보이는 멘토 계정 + 무필터) | — | 멘토 본인 계정이 자기만 조회될 때 "데이터 없음" 오해 방지 |
| 빈 상태 A "조건에 맞는 멘토가 없어요" + "필터 초기화" | 빈 상태 (필터 적용 시) | `mentorsListFiltersApplied()` | `/mentors` | 필터 과다 적용 복구 유도 |
| 빈 상태 B "아직 데이터가 없어요" | 빈 상태 (무필터 0건) | — | `/mentors` | 초기 데이터 부재 안내 |
| 멘토 카드 | `MentorCard` ×페이지당 6(모바일 4) 반복 | `list.cards` → `MentorGrid` 클라이언트 slice | ↓ 하위 표 | 멘토 1명 = 신뢰 신호 묶음 1장 |
| 그리드 페이지네이션 "이전 / p · total / 다음" | 버튼 ×2 | `MentorGrid` state | 클라이언트 slice 페이지 이동 (필터 변경 시 1페이지 리셋) | 서버가 준 12장을 화면 내에서 재분할(각주 F7) |
| "더 많은 멘토 보기" | Link (hasMore 시) | `list.hasMore` | `?page=+1` | 서버 페이지네이션 전진 |
| "이전" + "p / totalPages" | Link+텍스트 | `list.page` | `?page=-1` | 서버 페이지 후진·위치 표시 |
| 우측 "구독제 이용 안내" 카드 (불릿 3 + "자세히 보기 >") | 정적 사이드 카드 | 상수 | `/subscribe` | 구독 모델(주간 질문 한도) 사전 교육 |
| 우측 "찜한 멘토" 카드 (이름 · 학교 · 인증/미인증 · 최저가~) | 목록 ×최대 5 반복 | `favoriteCards`(현재 페이지 카드 ∩ 찜) + "찜 보기 >" | `/mentors/{id}` | 찜 재방문 최단 동선 — 여기서도 인증 여부를 한 단어로 재노출 |
| 로딩 스켈레톤 | `loading.tsx` | — | — | 목록 형태 예고(제목 1 + 바 1 + 카드 3) |

#### 멘토 카드 내부 (`MentorCard` 266줄 — list/grid 2레이아웃 공통 요소)

| 요소 (표시 라벨) | 종류 | 소스 | 연결 동작 | 추론한 존재 목적 |
|---|---|---|---|---|
| 아바타 (사진 or 이름 첫 글자 이니셜) | `MentorAvatar` | `display.photoUrl`, 로드 실패 시 `onError`로 이미지 숨김→이니셜 | — | 사진 없는/깨진 멘토도 빈 칸 없이 식별(멘토 초록 `#059669` 폴백) |
| 하트 찜 토글 (aria "찜하기/찜 해제") | `MentorFavoriteButton` | `initialFavorited` | 비로그인 → `/login?next=프로필`, 로그인 → `POST/DELETE /api/mentors/favorites` + `router.refresh()` | 탐색 중단 없이 후보 저장 — 찜은 로그인 가치 제안으로도 작동 |
| 멘토 이름 | Link/텍스트 | `display.displayName`(`users.full_name`→`nickname`→"멘토") | list 레이아웃은 프로필 링크 | 신원 축 |
| "인증" 배지 (BadgeCheck, 초록 채움) | 조건부 배지 — `mentorIsVerified(verification)`(approved/verified/complete) | `mentor_profiles.verification_status` | — | **멘토 승인(신뢰 인프라 B 핵심)** 시각 보증. 목록엔 승인 멘토만 오르므로 사실상 상시 표시 |
| "구독 마감" 배지 | 조건부 배지 — `card.subscriptionClosed` | `loadMentorCapUsageBatch` cap 판정(boolean만, 수치 비노출) | — | cap 초과 멘토의 기대 관리 — 프로필·찜은 열어두고 결제만 차단 |
| 학교·학번 라인 (예: "○○대 ○○과 22학번") | 텍스트 | `mentorSchoolGradeLine` — `schoolVerified`면 verified_* 값 우선 | — | 학벌·연차 신호. 인증값이 자유입력값을 덮어쓰는 표시 규칙 |
| "✓ 인증" / "참고·미인증" 배지 | 2분기 배지 | `display.schoolVerified`(`mentor_profiles.school_verified`) | — | 학교·전공 **서류 검증** 여부를 이름 옆 학교 문자열에 직접 라벨링 — 자유입력 학교명 과신 방지 |
| 학교군·계열 메타 (예: "서연고 · 공학") | 조건부 텍스트 — `schoolVerified`일 때만 | `school_tier`·`verified_major_category` + 카탈로그 라벨 | — | 검증된 분류값만 노출(미인증이면 빈 문자열) |
| 과목 칩 (list 6개 / grid 4개) | 칩 ×N 반복 | `mentorSubjectChips(subjects||tags)` — 과목 code→정본 라벨 변환, 중복 제거 | — | 필터와 같은 어휘로 전문 분야 스캔 |
| 한줄 소개 (없으면 "한 줄 소개는 준비 중이에요.") | 텍스트 2줄 클램프 | `intro_line`/`bio`/`about` + `mentorIntroFallback` | — | 셀링 포인트 |
| 통계 라인 "답변 만족도 x% · 평균 답변 시간 y · 누적 답변 z개" / "신규 멘토 · 곧 활동 내역이 쌓여요" | 텍스트 | `formatStatLine` — 누적 답변<5면 통계 숨기고 중립 문구, 48시간 이상 응답은 생략 | — | 표본 적은 신규 멘토의 통계 과장·불이익 동시 방지(코드 주석 명시) |
| "구독 요금제" 티어 행 (라이트/스탠다드/프리미엄 + "추천" + 가격 + 주간 라벨) | 행 ×3 반복 (모바일은 대표 1개 + "외 N개 요금제") | `card.tierPrices` — `mentor_plans` 행 없으면 티어 권장가 폴백 | — | 가격을 카드에서 즉시 비교. 추천(스탠다드) 앵커링 |
| "프로필 보기" (grid) / "구독하기" (list) | CTA | — | `/mentors/{id}` / `/subscribe?mentorId=`(비로그인 시 `/login?next=`), 마감 시 비활성 "구독 마감" | 레이아웃별 전환 목표 분리 — grid는 탐색 심화, list는 즉시 결제 진입 |

### /mentors/[mentorId] — 멘토 상세 (`public-mentor-detail`)

**바인딩**: `loadPublicMentorBundle`(users 공개행 → role≠mentor면 차단 → `mentor_profiles`+미디어+리뷰 요약+plans 병렬) → 뷰어 role 분기(`getServerUserWithProfile`) → 학생이면 `checkReviewEligibility`·무료질문권 잔여, 로그인 시 찜 여부 → **승인 게이트**: 본인·관리자 외에는 `mentorVerificationStatusAllowsActivity` 불통과 시 "아직 승인되지 않은 멘토 프로필입니다." 차단 → `loadMentorCapUsage`·`loadMentorAvgResponseHours`(RPC)·개별질문 단가 병렬. 렌더는 `PublicMentorDetailBody`(344줄).

**화면의 존재 목적**: 목록 카드가 던진 신뢰 신호를 서류 인증·통계·후기·요금제까지 전개해 "이 멘토에게 돈을 낼 이유"를 완결하는 전환 페이지. 승인 전 멘토는 본인/관리자에게만 미리보기를 허용해 공개 디렉터리의 품질 보증을 상세에서도 반복 강제한다.

| 요소 (표시 라벨) | 종류 | 소스 | 연결 동작 | 추론한 존재 목적 |
|---|---|---|---|---|
| (비가시) 최근 본 멘토 기록 | `MentorRecentRecorder` | — | localStorage 기록 후 null 렌더 | 목록 "최근 본 멘토 N" 카운트의 공급원 |
| "404" / "표시 불가" + "멘토 찾기로" | `PublicMentorNotFoundBody` 3분기 | bundle `not_found`·`not_mentor`·미승인 게이트 | `/mentors` | 존재하지 않음/멘토 아님/미승인을 각각 정직하게 구분 차단 |
| "← 멘토 찾기로 돌아가기" | Link | — | `/mentors` | 탐색 루프 복귀 |
| "공유하기" | 버튼 | `navigator.share` → 실패 시 클립보드 + AppToast "링크가 복사되었어요." | — | 입소문 유통 (규칙 9: alert 금지 → AppToast 실측 일치) |
| "찜하기 N" | 버튼 (`MentorDetailHeaderActions`) | `initialFavorited` | 목록 카드와 동일 API 토글, 비로그인 → `/login?next=` | 상세에서도 저장 동선 유지. N은 favoriteCount 미전달 시 0/1 자체표시(추정: 소셜프루프 자리) |
| 프로필 사진 120px / 이니셜 폴백 | 이미지 | `display.photoUrl` | — | 대면 신뢰 |
| 이름 + "인증" 배지 | h1 + 조건부 배지(`mentorIsVerified`) | `verification_status` | — | 카드 배지의 확대 재확인 |
| 학교·학번 라인 + "✓ 인증"/"참고·미인증" + 학교군·계열 메타 | 텍스트+배지 | 목록 카드와 동일 로직 재사용 | — | 목록→상세 신뢰 표기 일관성(같은 헬퍼 공유) |
| 과목 칩 ×최대 8 | 칩 반복 | `mentorSubjectChips` | — | 전문 분야 상세 |
| 신뢰 배지 4칸: "○○대 인증/학교·전공 미인증" · "멘토 승인"(인증 완료/승인 검토 중) · "활동 인증"(우수 멘토/활동 검증 예정) · "★x.x 리뷰 N개 / 신규 멘토" | 배지 그리드 ×4 반복 | `schoolVerified`·`verified`·리뷰≥3 분기 | — | 신뢰 인프라 2축(학교 서류 + 플랫폼 승인) + 활동·평판을 한 블록에 요약. "활동 인증"은 verified 재사용(추정: 전용 데이터 없는 자리표시) |
| "멘토 소개" + 폴백 "멘토 소개가 곧 업데이트될 예정이에요…" + "인증 상태: {한글}" | SurfaceCard | `intro` + `mentorVerificationKo` | — | 소개 하단에 인증 상태 한글 병기 — raw 영어 status 비노출 원칙 |
| 통계 4카드: "누적 답변 수 N개+ / 연결 학생 수 N명+ / 평균 답변 시간 / 답변 만족도 x% 또는 멘토 등급 '신규 멘토'" | 카드 ×3~4 반복 | `mentor_profiles` 통계 컬럼 + 리뷰 평균 + RPC 응답시간 | — | 리뷰<3이면 만족도% 대신 "리뷰가 쌓이면 공개돼요", 48시간 이상 응답 칸은 통째 숨김 — 신규 보호 + 저성과 비공개(코드 주석 명시) |
| "멘토링 과목" 칩 ×최대 16 / "등록된 과목 정보가 아직 없어요." | `MentorDetailSubjectTabs` | subjects+tags+department 병합 칩 | — | 과목 전체 전개(카드는 축약본) |
| "대표 콘텐츠" 가로 캐러셀 (영상/PDF/자료 배지, 조회·저장 수) + "전체 보기 >" / 빈 상태 "아직 등록된 콘텐츠가 없어요" | `MentorContentsSection` ×최대 12 반복 | `mentor_media` 계열 probe | `#contents` 앵커 | 실력 증빙 콘텐츠 진열 — 전체 보기는 자기 앵커(전용 목록 화면 부재, 사실 표기) |
| "학생 후기" ★평균 (총N) + 카드 4개×도트 페이지 + "전체 보기 >" / "아직 공개된 후기가 없어요." | `MentorReviewsCarousel` (클라이언트 fetch `/api/reviews?mentorId=`) | reviews API(마스킹 이름·별점·학년과목) | `#reviews` 앵커, `reviews-updated` 이벤트로 재로드 | 구매 직전 사회적 증거. 작성 직후 실시간 갱신(09번 작성 모달과 이벤트 연동) |
| "리뷰 작성" 섹션 (배너+모달) | 조건부 — `viewer.role === "student"` | `ReviewEligibilityBanner`·`ReviewWriteModal` | 09번 담당 상세 — 자격: 동일 멘토 2회 연속 결제 규칙 | 학생에게만 작성 진입 노출 (01 공용 사전 참조) |
| CTA "지금 {이름} 멘토와 함께 공부를 시작하세요!" + "구독하기"/"구독 마감" | `MentorDetailCTASection` | `subscriptionClosed` 분기 | `/subscribe?mentorId=` | 본문 종단 전환 지점 |
| "무료 질문권 사용하기 [N]" / "무료 질문 7개 받기" | CTA Link | `freeQuestionRemaining`(학생 로그인 시) + `FREE_QUESTION_POLICY_SHORT`("멘토당 최대 3개… 가입 시 7개 지급, 7일간 유효") | 로그인 → `/question-room?mentorId=`, 비로그인 → `/login/student?next=` | 결제 전 무료 체험 훅 — 잔여 수 노출로 소진 심리 자극 |
| "개별 질문하기 · {가격}" / "이 멘토는 개별 질문을 받지 않아요" | CTA 2분기 | `individualQuestionPriceCents`(멘토가 단가 미설정=null이면 차단) | `/mentors/{id}/individual-question/new`(비학생은 로그인) | 구독 외 단건 수익 경로 — 편집 폼 "비워 두면 받지 않음" 규칙의 소비면 |
| 보장 배지 4칸 "안전한 연결·검증된 멘토·안심 결제·환불 보장" | 정적 ×4 반복 | `GUARANTEES` 상수 | — | 결제 불안 해소 카피 |
| 사이드바 "구독 요금제" + `PlanComparisonCards`(radio-rail) + "구독하기 →" | `MentorDetailSubscribeSidebar` (sticky) | `byTier`(멘토 plans) / `selectedTier` state(기본 standard) | `/subscribe?mentorId=&plan={tier}` | 스크롤 내내 따라오는 결제 패널 — 티어 선택값을 구독 딥링크에 실어 보냄 (PlanComparisonCards는 01 공용 사전 참조) |
| 사이드바 "구독 마감" 박스 "…프로필 열람과 찜은 계속 가능해요." | 조건부 | `subscriptionClosed` | — | 마감이어도 관계 형성(찜)은 열어둠 |
| 사이드바 개별 질문 행 "개별 질문 · 구독 없이 1건씩 {가격}/1건 · 질문하기 →" / "이 멘토는 개별 질문을 받지 않아요." | 조건부 2분기 | 단가 존재 여부 | 개별질문 작성 | 코드 주석: 구독(主)보다 한 단계 낮은 보조 표시로 의도적 축소 |
| "구독 혜택" 불릿 3 (연결노트·1:1 맞춤 답변·해지 후 열람) + "추가 질문은 구독을 통해서…" | 정적 ×3 반복 | `BENEFITS` 상수 | — | 구독 가치 요약 — 연결노트(신뢰 인프라 A) 교차 홍보 |
| 로딩 스켈레톤 | `[mentorId]/loading.tsx` | — | — | 상세 골격 예고 |

### /mentor/profile — 프로필 허브 (redirect)

**바인딩**: 없음 — `redirect("/mentor/profile/edit")`.
**화면의 존재 목적**: 코드 주석 명시 — "멘토 프로필은 편집 화면 하나로 통일(중복 요약 대시보드 제거). 기존 요약 정보(완성도·공개 상태)는 편집 화면 상단 배너로 흡수됨." 구 링크·북마크 호환용 잔존 경로.

### /mentor/profile/edit — 멘토 프로필 관리 (`mentor-profile-edit`)

**바인딩**: `requireRole("mentor")` → `mentor_profiles` 본인 행 + `users` 행 + 미디어 샘플(8) + `fetchPlansForMentor`→`assignPlansByTier` + 개별질문 단가(cents→캐시 ÷100 프리필). 제출은 서버액션 `submitMentorProfileEdit` → `updateMentorProfile`(mentor_profiles upsert — **university_name·department_name 의도적 제외**로 인증값 잠금 유지, `mentor_plans` upsert `onConflict: mentor_id,plan_tier`, 개별질문 단가는 SECURITY DEFINER RPC `set_individual_question_price`, 가격 변경 시 활성 구독자에게 "멘토 구독 요금이 변경됐어요" 알림) → `/mentors` 포함 revalidate → `?ok=1` redirect.

**화면의 존재 목적**: 멘토가 공개 상품(프로필)을 스스로 구성하는 유일한 화면. 좌측 폼–우측 "학생에게 보이는 화면" 실시간 미리보기의 2열 구조로 "입력 = 즉시 상점 진열"임을 체감시키고, 인증값(학교·학과)은 잠금 + 학적변경요청 유도로 신뢰 데이터의 셀프 훼손을 차단한다.

| 요소 (표시 라벨) | 종류 | 소스 | 연결 동작 | 추론한 존재 목적 |
|---|---|---|---|---|
| 상단 배너 "프로필 완성도 N%" + "공개 중/비공개" + "인증 {한글}" + "아래에서 항목을 채우면 공개 프로필이 더 또렷해져요." | 배너 (page.tsx) | intro·university·department·subjects·tags 5항목 채움수/5 ×100, `subOpen`, `mentorVerificationKo` | — | 구 요약 대시보드 흡수분 — 완성도 게이미피케이션 + 공개·인증 상태 상시 확인 |
| "멘토 프로필 관리" + "기본 정보·소개·과목·요금제·인증 서류를 관리하세요." + "마지막 저장: {일시/기록 없음}" | 헤더 | `row.updated_at` | — | 화면 범위 목차 + 저장 이력 안심 |
| "성공적으로 저장되었습니다." / 에러 배너 | 조건부 배너 | `?ok=1` / `?error=` (`mapDataErrorMessage`) | — | redirect 기반 제출 결과 피드백 |
| §1 "기본 정보" [필수] — "프로필 사진" 원형 미리보기 + "사진 변경" + "권장 사이즈: 400x400px (JPG, PNG, WEBP) 최대 5MB" | 숨김 file input + 버튼 | `photoPreview`(objectURL) ?? `initial.photoUrl` | 클라이언트 검증(이미지 3형식·5MB, 위반 시 인라인 에러) — 실제 업로드는 제출 시 `uploadMentorAvatar`(profile-avatars 버킷) | 첫인상 자산 관리 — 검증 실패를 제출 전에 잡음 |
| "이름" (`nickname`, placeholder "닉네임을 입력해주세요", max 20) | input | `formData.nickname` ← displayName | onChange → 미리보기 즉시 반영 | 공개 표시명 |
| "학번 (예: 22학번)" (`grade`, max 20) | input | `formData.grade` | 〃 | 현직 연차 신호(카드 학교 라인에 합성) |
| "전공(학과) *" + 🔒 "잠금" 배지 + "학과 정보는 인증값이라 직접 수정할 수 없어요. 변경이 필요하면 요청해 주세요." + [학적변경요청] | **readOnly** input + Link | `formData.department` | `/mentor/academic-record-change` | 인증 데이터 잠금 UX의 핵심 — 서버 mutation도 컬럼 제외로 이중 방어 |
| "출신 고등학교 *" (max 40) | input | `formData.highSchool` | 미리보기 반영 | 학생과의 접점(같은 지역·고교) 신호 |
| "대학교 *" + 🔒 "잠금" + 동일 안내 + [학적변경요청] | **readOnly** input + Link | `formData.university` | `/mentor/academic-record-change` | 전공 필드와 동일한 잠금 쌍 |
| §2 "소개" [필수] — "한줄 소개 *" (max 50 + "n/50" 카운터) | input | `formData.intro` | 미리보기 반영 | 카드·상세의 헤드라인 원본 |
| "상세 소개 *" (`bio`, rows 6, max 500 + 카운터, placeholder "멘토링 스타일, 경력, 강점을…") | textarea | `formData.bio`(초기값 항상 "") | — | 상세 서사 의도 — **단 서버액션이 `bio`를 읽지 않아 저장되지 않음**(각주 F4) |
| §3 "전공 및 과목" [필수] — "담당 과목" + "가르치는 과목을 모두 선택하세요…" | `MentorSubjectCheckboxes`(대분류 펼침 체크) | `subjectCodesFromText(formData.subjects)` — 토글 시 code CSV 재조합, 레거시 자유텍스트는 첫 토글 전 보존 | hidden `name="subjects"`로 제출(→ mutation이 split→text[]) | 자유텍스트→정본 code 마이그레이션을 강제 변환 없이 점진 수행 (01 공용 사전 참조) |
| 과목 0개 경고 "활동(구독 공개)하려면 담당 과목을 1개 이상 지정하세요. 과목을 설정하기 전에는 멘토 찾기에 노출되지 않고 새 구독을 받을 수 없어요." | 조건부 배너 — `subjectCodes.length === 0` | — | — | 목록 서버 필터(과목 필수 게이트)의 원인을 편집 화면에서 사전 고지 |
| (비가시) hidden `tags` | hidden input | `initial.tags` 그대로 | — | 태그 편집 UI 부재 — 기존값 보존 통과(사실 표기) |
| §4 "요금제 설정" — "구독 요금은 멘토가 직접 설정할 수 있어요. 권장 범위를 벗어나면 경고만 표시되고 저장은 가능합니다." | 안내 | — | — | 소프트 가드레일 선언 |
| 티어 카드 ("라이트 주 4개 질문" / "스탠다드 주 9개 질문"+**추천** 강조 테두리 / "프리미엄 질문 무제한") + "월 구독 캐시" number input + "범위 min~max" | 카드 ×3 반복 | `SUBSCRIBE_PLAN_CATALOG` + `mentorPlanCashKrw`(기존 plan행 or 권장가) + `mentorSubscriptionPriceRule` — **라이트 39,900/55,000/69,900 · 스탠다드 84,900/114,900/149,900 · 프리미엄 189,900/249,900/329,900 (min/권장/max 캐시)** | 제출 시 `subscriptionPriceKrw_{tier}` — 서버는 1 이상 정수만 통과("구독 요금은 1캐시 이상 숫자로 입력해 주세요.") | 멘토별 가격 자율 + 권장가 앵커(기획 정본 가격 = recommended). 각주 F1 |
| 가격 인라인 경고 "1캐시 이상 입력해 주세요." / "권장 범위 밖이에요. 그래도 저장할 수 있어요." | 조건부 ×티어 | `invalid` / `isOutsideMentorPriceGuide` | — | 하드 검증(양수)과 소프트 검증(권장 범위)의 분리 — 저장은 범위 밖도 허용(각주 F5) |
| "개별 질문 답변 단가" + "구독과 별개" 배지 + "…비워 두면 지정형 개별 질문을 받지 않습니다." + "답변 단가 (캐시)" input (placeholder "예: 5000") | 점선 강조 카드 | `individualQuestionPrice` state ← cents÷100 | 제출 시 RPC `set_individual_question_price`(cents 저장, 미입력=변경 없음) | 단건 상품 가격 셀프 설정 — 빈 값=판매 안 함이 상세 CTA 분기의 원천 |
| §5 "인증 서류" — "학생증 업로드 상태: {한글}" + 이미지 미리보기 / "아직 업로드된 학생증이 없어요." + "인증 서류 제출하기 >" | 상태 박스 + Link | `mentorVerificationKo(initial.verification)`, 미리보기 src=`initial.photoUrl` | `/mentor/verification` | 인증 흐름으로의 허브 링크 — 단 미리보기 이미지가 프로필 사진 URL을 재사용(각주 F4) |
| (비가시) hidden `subscribeOpen="on"` | 조건부 hidden — `formData.subOpen && subjectCodes.length > 0` | 코드 주석 "과목 0개면 구독 공개를 켜지 않는다(저장은 통과, 구독만 닫힘)" | 제출 시 `accepts_subscriptions` 계열 갱신 | 과목 필수 게이트의 저장측 강제 — 켜짐 상태여도 과목 0개면 서버에 off로 전달 |
| §6 "대표 콘텐츠 설정" [선택] — "커뮤니티 게시글 추가"·"숏폼 영상 추가" (disabled, "준비 중") + "대표 콘텐츠 연결 기능은 준비 중입니다." | disabled 버튼 ×2 + 안내 | 정적 | — | 로드맵 예고 자리 — 기능 미출시를 명시(추정: 채널 기능과 함께 복구 예정) |
| "현재 등록된 대표 콘텐츠 (N)" 썸네일 그리드 / "등록된 콘텐츠가 없습니다…" | 그리드 ×N 반복 | `query.media.rows`(mentor_media 계열) | 삭제 버튼은 type="button" 무동작(사실 표기) | 기등록분 확인용 열람 |
| "입력한 정보는 프로필(채널)에 공개되며, 언제든지 수정할 수 있습니다." | 안내 | 정적 | — | 공개 범위 고지 |
| "취소" / "저장하기"("저장 중…") + "변경 사항은 저장 즉시 반영됩니다." | 버튼 2 | `FormSubmitButton` | 취소는 type="button" 무동작(사실 표기) · 저장은 폼 제출 | 제출 종단 (FormSubmitButton은 01 공용 사전 참조) |
| 우측 "학생에게 보여지는 프로필 미리보기" + "실제 학생들이 보는 화면이에요." | 헤더 | — | — | 편집–결과 동기화 인지 |
| 미리보기 카드: "학생에게 보이는 화면" 리본 · 아바타 · 이름 + 인증 배지(한글) · 학교/학과/고교 칩 · 소개 · 과목 칩 4 · "평점 {x.x/신규} · 리뷰 N건 · 구독 받기 가능/비공개" 3스탯 · "학교·전공"/"학년" · "구독 요금제" 3티어 미니카드 · "대표 콘텐츠" 슬롯 ≤3 · "소개" · footerNote "실제 학생에게 보이는 공개 프로필과 동일한 요약입니다." | `MentorPublicProfilePreviewCard` (variant="preview") | `previewDisplay`(입력 state 실시간 합성) + `stats.byTier` | 입력 즉시 리렌더 | WYSIWYG — 평점 없으면 "신규", 리뷰 0건 표기로 빈 프로필도 형태 유지(코드 주석 "빈 값을 휑하게 두지 않고") |

### /mentor/verification — 인증 상태 (`mentor-verification`, 272줄)

**바인딩**: `requireRole("mentor")` → `mentor_profiles` 본인 행 + `users` 행 + `fetchLatestMentorSchoolVerification`(`mentor_school_verifications` 최신 1행). 제출은 `submitMentorSchoolVerificationAction` — 매직바이트 검증(JPG/PNG/PDF) → **비공개 버킷 `student-id-images`** 업로드 → `mentor_school_verifications` insert(status "pending", insert 실패 시 업로드 롤백) → `?schoolDoc=` / `?schoolDocError=` redirect.

**화면의 존재 목적**: 신뢰 인프라 B의 멘토측 절반 — 서류 제출과 관리자 검토 결과(4상태)를 한 화면에서 왕복시키는 인증 워크플로 허브. pending 중 재제출 잠금으로 심사 큐 오염을 막고, 검증값(관리자 입력)을 멘토에게 회신해 "내 프로필의 학교·전공이 왜 이 값인지"를 설명한다.

| 요소 (표시 라벨) | 종류 | 소스 | 연결 동작 | 추론한 존재 목적 |
|---|---|---|---|---|
| PageScaffold "멘토 / 인증 상태" + "학생증·운영 검토 결과를 확인합니다. 승인·반려·재제출 안내는 운영자 검토 후 이 화면에 반영됩니다." | 헤더 | 정적 (모바일 축약 분기) | — | 화면 계약 선언 (PageScaffold는 01 공용 사전 참조) |
| 제출 성공/실패 배너 | 조건부 ×2 | `?schoolDoc=` / `?schoolDocError=` | — | 서버액션 redirect 결과 표시 |
| "학교·전공 인증 상태를 불러오지 못했습니다. {사유}" | 조건부 배너 | `schoolVerification.error` + `mapDataErrorMessage` | — | 조회 실패 degrade |
| **상태 히어로** — 아이콘 타일 + "멘토 인증" 칩 + 상태 배지 + 헤드라인 + "{표시명} · {안내}" | 5분기 섹션 (`verificationHeroMeta`) | `mentor_school_verifications.status` | — | 상태별 분기: **approved**="인증 완료 / 학교·전공 인증이 완료됐어요 / 검증값이 프로필에 반영됐어요. 멘토 활동을 시작할 수 있어요."(초록) · **rejected**="반려 / 서류가 반려됐어요 / 아래 사유를 확인하고 다시 제출해 주세요"(빨강) · **resubmit_required**="재제출 필요 / 서류 재제출이 필요해요"(주황) · **pending**="검토 중 / 서류를 심사하고 있어요 / 관리자 검토 중 · 보통 1~2일"(주황) · **null**="미제출 / 아직 제출된 서류가 없어요"(회색). 코드 주석: "멘토 초록 정체성 유지: 진행/대기=주황, 반려=빨강, 완료=초록" |
| "멘토 프로필 행을 찾지 못했습니다. 프로필 편집에서 정보를 저장해 주세요." | 조건부 경고 — `!row` | `mentor_profiles` 부재 | — | 프로필 미생성 계정의 선행 조치 유도 |
| "학교 인증 / 학교·전공 인증" 섹션 헤더 + "재학증명서, 졸업증명서, 합격증 등… 관리자가 서류를 확인한 뒤 검증값을 입력합니다." | 섹션 | 정적 | — | 허용 서류 예시 + 검증값이 관리자 입력임을 고지 |
| [pending 분기] "학교·전공 증명 서류 제출 완료 · 최근 제출 {일시}" + "검증값" 박스 | 조건부 | `schoolRow.created_at`, `verifiedValueSummary`(대학·학과·계열·학교군 join, 없으면 "관리자 입력 전이라 검증값은 비어 있습니다.") | — | 심사 중 현황 요약 |
| [pending 분기] `<details>` "다른 서류로 다시 제출 →" + "현재 심사 중이라, 새 서류 제출은 검토 결과가 나온 뒤 가능해요." + 비활성 폼 | 접이식 | `canSubmitSchoolDocument = status !== "pending"` | 펼쳐도 dropzone·버튼 disabled | 재제출 욕구는 수용하되 실행은 잠금 — 코드 주석 "심사 대기 중에는 재제출을 잠근다" |
| [비pending 분기] "최근 제출" ("아직 제출된 서류가 없습니다.") / "검증값" 2칸 | 정보 그리드 | `schoolRow` | — | 이력·결과 확인 |
| [비pending 분기] "반려 사유" 박스 | 조건부 — `schoolRow.reject_reason` | 관리자 입력 사유 | — | 재제출 성공률을 올리는 실패 원인 회신 |
| "학교·전공 증명 서류" 드롭존 ("파일 선택" / "JPG, PNG, PDF · 클릭하거나 파일을 끌어다 놓으세요") + "제출한 서류는 비공개 저장소에 보관되고, 관리자 확인 후 인증됩니다." | `CommunityFileDropzone` | accept jpg/png/pdf | 제출 폼 | 개인정보 서류의 비공개 보관 고지(Storage 정본: student-id-images public=false) (드롭존은 01 공용 사전 참조) |
| "학교·전공 인증 서류 제출" / "…다시 제출"("제출 중…") | `FormSubmitButton` (초록 `#059669`) | 기제출 여부로 라벨 분기, pending이면 disabled | `submitMentorSchoolVerificationAction` | 최초/재제출을 같은 폼으로 — 매 제출이 새 pending 행 append |

### /mentor/academic-record-change — 학적변경요청 (`mentor-academic-record-change`, 209줄)

**바인딩**: `requireRole("mentor")` → `mentor_profiles` 본인 행(현재 대학명) + `fetchLatestMentorAcademicRecordChange`(`mentor_academic_record_change_requests` 최신 1행). 제출은 `submitMentorAcademicRecordChangeAction` — 학교명 필수 → 서류 매직바이트 검증 → `student-id-images` 버킷 업로드 → status "pending" insert(실패 시 업로드 롤백) → `?ok=`/`?error=` redirect.

**화면의 존재 목적**: 편집 폼에서 잠근 학교 정보의 유일한 합법 변경 통로. "학교 정보는 멘토의 신뢰·정산과 직결되어 임의 변경이 막혀 있습니다"(화면 카피)라는 정책을 서류 기반 관리자 승인 프로세스로 집행 — 편입·졸업·전과라는 정당한 변동과 학벌 위조를 절차로 분리한다.

| 요소 (표시 라벨) | 종류 | 소스 | 연결 동작 | 추론한 존재 목적 |
|---|---|---|---|---|
| PageScaffold "멘토 / 학적변경요청" + "학교 정보는 멘토가 직접 수정할 수 없습니다. 편입·졸업·전과 등으로 학교가 바뀌었다면 증명 서류를 제출해 주세요…" + CTA "프로필로 돌아가기" | 헤더 | 정적 | `/mentor/profile/edit` | 진입 맥락(편집 폼 잠금 배지) 복귀 동선 |
| ok/error/조회 실패 배너 ×3 | 조건부 | `?ok=`·`?error=`·`latest.error` | — | 제출·조회 피드백 |
| "현재 등록된 학교 {대학명 / 등록된 학교 정보가 없습니다.}" + "잠금됨 · 직접 수정 불가" 배지 + "학교 정보는 멘토의 신뢰·정산과 직결되어 임의 변경이 막혀 있습니다…" | 정보 카드 | `mentor_profiles.university_name` | — | 변경 대상의 현재값 확정 + 잠금 사유 설명 |
| "학적변경요청" 섹션 + 상태 배지 ("변경 완료"/"반려"/"재제출 필요"/"심사 대기"/"미제출") | 5분기 배지 (`statusLabel`·`statusBadgeClass`) | `requests.status` | — | 검증 화면과 동일한 4상태+미제출 문법 재사용 — 워크플로 학습 비용 절감 |
| "최근 제출 {일시 / 아직 제출된 요청이 없습니다.}" / "요청한 학교명 {값 / 아직 요청 전이에요}" | 정보 2칸 | `row.created_at`·`requested_university_name` | — | 진행 중 요청 요약 |
| "반려 사유: {사유}" | 조건부 | `row.reject_reason` | — | 실패 원인 회신 |
| "변경하려는 학교명 *" (placeholder "예: 서울대학교", max 40) | input | `row.requested_university_name` defaultValue | 서버 필수 검증("변경하려는 학교명을 입력해 주세요.") | 목표값 명시 — 승인 시 관리자가 반영할 원본 |
| "변경 사유 (선택)" (placeholder "예: 편입 / 졸업 / 전과 등", max 100) | input | — | 선택 제출 | 심사 판단 보조 |
| "학적 변동 증명 서류 *" 드롭존 + "…관리자만 열람합니다." | `CommunityFileDropzone` (required) | jpg/png/pdf | 제출 폼 | 증빙 강제 + 열람 범위 고지 (01 공용 사전 참조) |
| "학적변경요청 제출" / (pending 시) "심사 대기 중" | `FormSubmitButton` | `canSubmit = status !== "pending"` — 폼 전체(입력 포함) disabled | `submitMentorAcademicRecordChangeAction` | 중복 요청 차단 — 버튼 라벨 자체가 잠금 사유 |
| "학교·전공 최초 인증은 [인증 상태] 화면에서 진행할 수 있어요." | 안내 + Link | — | `/mentor/verification` | 최초 인증 vs 변경 요청의 관할 구분 |

### /mentor/channel — 멘토 채널 (redirect)

**바인딩**: `requireRole("mentor")` 후 `redirect("/mentor/mypage")`.
**화면의 존재 목적**: 코드 주석 명시 — "멘토 채널(공개 미디어 모아보기)은 미완성(준비 중)으로 출시에서 숨김. 북마크·구 링크 대비 멘토 마이페이지로 리다이렉트. 채널 기능 완성 시 복구." `loading.tsx`(스켈레톤)와 완성형 본문 `MentorChannelPageBody`(숏폼/해설/대표 자료/대표 콘텐츠(기타) 4버킷 그룹 목록, `groupChannelItemsByBucket`)·`lib/mentor/mentorChannelQueries.ts`는 잔존하나 **어느 페이지도 import하지 않는 대기 자산**(각주 F3). 편집 폼 §6 "준비 중"과 같은 로드맵의 소비면.

### /mentor/dashboard — 멘토 대시보드 (잔존물)

**바인딩**: 없음 — **`page.tsx` 부재, `loading.tsx`(스켈레톤 3블록)만 존재** → 실제 접근 시 404.
**화면의 존재 목적**: CLAUDE.md 라우트 정본에는 "/mentor/dashboard 멘토 대시보드"로 등재되어 있으나, 코드상 페이지 본체가 없다. 완성형 UI `components/mentor/dashboard/` 8파일("멘토 대시보드 / 질문방 · 맞춤의뢰 · 수익을 한눈에 확인하세요" 헤더 + SideNav + KPI 카드 + 진행 주문 테이블 + 열린 의뢰 도넛 + 키워드 + 우측 패널)은 orphan이며, 그 데이터 로더(`lib/mentor/dashboard/mentorHubDashboardQueries.loadMentorHubDashboardData`)만 `/mentor/mypage`(02번 담당)가 재사용 중 — 대시보드가 마이페이지로 흡수된 이행기 잔존물로 판단(추정). 각주 F3.

### /api/mentors/favorites — 찜 API (`api-mentor-favorites`)

**바인딩**: 세 메서드 모두 `getServerUserWithProfile`로 인증(401 "로그인이 필요합니다."), `favorites` 테이블 조작.
**화면의 존재 목적**: 목록 카드·상세 헤더의 하트 토글이 페이지 리로드 없이 저장 관계를 만들 수 있게 하는 최소 REST 표면. role 제한 없음 — 로그인 사용자 누구나 찜 가능.

| 요소 | 종류 | 소스 | 연결 동작 | 추론한 존재 목적 |
|---|---|---|---|---|
| `GET` | route handler | `loadFavoriteMentorIdsForUser` | `{ ok, mentorIds[] }` (favorites 테이블 부재 시 빈 목록으로 무해화) | 클라이언트 동기화용 전체 찜 id |
| `POST {mentorId}` | route handler | `addMentorFavorite` — insert, duplicate/unique 에러는 성공 처리(멱등) | 400 "mentorId가 필요합니다." / 500 "찜하기에 실패했습니다." | 찜 추가. 코드 주석: mentor_profiles 사전검사를 제거(RLS mentor_select_own에 막혀 학생 찜이 항상 500) — FK가 무결성 보장 |
| `DELETE ?mentorId=` | route handler | `removeMentorFavorite` | 500 "찜 해제에 실패했습니다." | 찜 해제 |

---

## 연결 lib 사전 (본 담당 화면들이 공유하는 규칙 계층)

| 모듈 | 핵심 계약 | 존재 목적 |
|---|---|---|
| `mentorVerificationGate.ts` | 승인 인정 status = `approved`/`verified`/`active`. `assertMentorApprovedForAction`은 실패 시 "관리자 승인 완료 후 이용할 수 있습니다…" | "승인 전 활동 제한"의 단일 판정점 — 목록 노출·상세 공개·(타 도메인) 액션 가드가 모두 이 Set 참조 |
| `mentorDisplayFields.ts` | `buildMentorProfileDisplay` — `school_verified`면 verified_* 컬럼이 자유입력값을 덮음. `mentorVerificationKo` — raw status→한글(미지 영어는 "미인증" 폴백) | 인증값 우선 표시 + 상태 문자열 한글화의 표준 어휘 |
| `mentorPublicProfileDisplay.ts` | 과목 칩 정본 라벨 변환, "✓ 인증"/"참고·미인증" 배지, 학교군·계열 메타(인증 시만) | 목록·상세·미리보기 3화면의 신뢰 표기 문법 통일 |
| `subscribe/mentorPlanPricing.ts` | 티어별 min/권장/max: 라이트 39,900/55,000/69,900 · 스탠다드 84,900/114,900/149,900 · 프리미엄 189,900/249,900/329,900. `isOutsideMentorPriceGuide`는 경고만 | 멘토 가격 자율 + 권장가(기획 정본 가격) 앵커 — cents(×100) 저장·캐시 표시 변환 포함 |
| `mentorSubscribeOpen.ts`(+Actions) | 기본 OPEN(true), 명시적 false만 차단. 토글 액션은 flag 컬럼만 갱신 후 `/mentors` 포함 revalidate | 멘토 self "신규 구독 받기" 스위치 — UI 소비면은 /mentor/mypage(02번) |
| `mentorActivity.ts`(+Actions/Service) | 활동상태 4종: `active`/`terminating`(종료 2주 공지)/`terminated`/`paused`(최대 7일, 복귀일 경과 시 자동 active). 일반 휴식은 6개월 1회. `mentorAcceptsNewSubscriptions` = active만 | 활동중단·정지 정책의 판정 계층 — 신청 UI·상태 카드는 /mentor/mypage(02번 담당), 관리자 뷰는 /admin/mentor-activity(08번대) |
| `mentorFavorites.ts` | favorites 테이블 CRUD, 테이블 부재·중복 무해화 | 찜 저장소 |
| `freeQuestionPolicy.ts` | 총 7개 · 멘토당 3개 · 가입 후 7일 유효 | 상세 CTA 무료 문구의 정본 상수 |
| `schoolClassificationCatalog.ts` | 학교군·전공계열 카탈로그를 DB(`school_tier_catalog`·`major_category_catalog`)에서 로드, 실패 시 상수 폴백. `school_tier_mappings`로 학교명→학교군 정규화 매칭 | 분류 어휘의 운영 가변화(관리자 카탈로그 편집) + 코드 폴백 안전망 |
| `recentMentorsStorage.ts` | localStorage 최대 20개 최근 열람 | 비로그인 포함 재탐색 연속성 |

---

## 각주 — 코드 ≠ 기획 정본 차이 · 사실 특이사항

- **F1 (요금제 라벨)**: CLAUDE.md 절대 잠금값은 "베이직(주4)/스탠다드(주9)/프리미엄(FUP)" 표기이나, 코드 정본 `subscribePlanCatalog`의 라벨은 **"라이트"**/스탠다드/프리미엄 (tier id `limited`/`standard`/`premium`은 정본과 일치). 멘토 찾기 헤더 카피만 "베이직·스탠다드·프리미엄"으로 남아 있어 같은 화면 안에서 헤더(베이직)와 카드(라이트) 표기가 갈린다. 사실 표기.
- **F2 (평점 소스)**: CLAUDE.md는 `mentor_profiles.avg_rating`·`review_count`(denormalized)를 정의하나, 목록·상세 코드는 이 컬럼을 읽지 않고 `reviews_summary` 계열 뷰 우선 → 없으면 `reviews` 계열 원본을 배치 집계(목록은 최대 2,500행, 상세는 평균용 500행 샘플)한다. 뷰가 없으면 사실상 실시간 집계라 stale 문제는 없지만, 대량 리뷰 시 500/2,500행 컷 초과분은 평균에서 누락될 수 있고, denormalized 컬럼은 이 화면군에서 미사용 자산이다. 사실 표기.
- **F3 (잔존물)**: ① `/mentor/dashboard`는 `loading.tsx`만 있고 `page.tsx`가 없어 404 — `components/mentor/dashboard/` 8파일은 orphan(데이터 로더만 mypage가 재사용). ② `/mentor/channel`은 redirect로 숨김 — `MentorChannelPageBody`·`mentorChannelQueries`는 미참조. ③ `MentorSearchBar`·`MentorSortBar`·`MentorFilterPanel`·`MentorResultsSummaryBar`·`MentorProfileHubPreview`·`MentorReviewList` 6개 컴포넌트도 어느 화면에서도 import되지 않는 구세대 목록 UI 잔존물.
- **F4 (편집 폼 미배선 2건)**: ① "상세 소개 *"(bio, 필수 표시·500자 카운터)는 name="bio"로 전송되지만 `submitMentorProfileEdit`가 해당 키를 읽지 않아 **저장되지 않음**(코드 주석 "Actual bio column would need to be added…"도 잔존). ② §5 "학생증 미리보기" `<img>`의 src가 `initial.photoUrl`(프로필 사진 컬럼 `profile_image_url`/`avatar_url`)을 재사용 — 학생증 파일이 아닌 프로필 사진이 표시된다. 사실 표기.
- **F5 (가격 검증 위계)**: 서버는 "1캐시 이상 정수"만 강제하고 min/max 권장 범위는 클라이언트 경고로만 존재 — 범위 밖 가격도 저장·공개된다("경고만 표시되고 저장은 가능"이 화면 카피로 명문화된 의도적 설계).
- **F6 (숨은 필터·정렬)**: `verifiedOnly`(`?verified=1`)·`verification=` 필터와 `price_desc` 정렬은 파서·매처에 구현되어 있으나 이를 만들어내는 UI 컨트롤이 없음(URL 직접 진입 전용). `rating`·`response` 정렬은 정렬 칩이 아닌 사이드바 "추가 필터" 라디오를 통해서만 도달 가능.
- **F7 (이중 페이지네이션)**: 서버 12개/페이지("더 많은 멘토 보기" = `?page=`)와 `MentorGrid` 클라이언트 slice(데스크탑 6·모바일 4, "이전/다음" 버튼)가 공존 — 한 서버 페이지가 화면에서 1~3클라이언트 페이지로 재분할된다. 코드 주석이 "새 fetch 없음, 받은 배열만 쪼갠다"고 명시한 의도적 구조.
