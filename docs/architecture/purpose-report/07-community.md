# 07. 커뮤니티 (채널 4 — 게시판·숏폼) — 존재 목적 리포트

> 대상 라우트 15개 · 요소 행 118개 · 근거: 코드 실측 + 기획 정본

**채널 정의(기획 정본):** 커뮤니티는 채널 4 — 무료 학습 콘텐츠로 유입·체류를 만들고 멘토 브랜딩→구독 전환을 잇는 **비결제 채널**. 게시판(`community_posts`)과 숏폼(`shortform_posts`) 분리 운영. 조회는 anon 포함 전원(`status='published'`), 작성은 로그인 본인(구독 불요). 댓글 2단·좋아요·신고(`content_reports`)→관리자 검수. 숏폼은 private 버킷+서명 URL(7일, `lib/storage/signedStorageUrl.ts`의 `DEFAULT_TTL_SEC = 60*60*24*7`).

**코드≠기획 각주 (본문에서 ※n로 인용):**
- **※1** 기획은 "멘토 콘텐츠는 검수 후 공개"이나, 코드는 게시판·숏폼 모두 발행 시 즉시 `status='published'`로 저장·공개(`communityBoardActions.ts`, `communityShortformActions.ts`). 검수는 사후 방식: 신고(`content_reports`) → 관리자 `hidden` 처리 → 조회 시 `status==='hidden'`이면 미노출(`communityBoardQueries.ts:294-299`, `communityShortformQueries.ts:154`).
- **※2** 기획 카테고리는 5종(study/school/career/college/free)+all이나, 숏폼 상수 `SHORTFORM_CATEGORIES`에는 `free`(자유)가 없어 4종+all(게시판은 5종+all로 기획과 일치).
- **※3** 기획 "숏폼 업로드 폼(영상·썸네일·태그)"이나, 실제 사용 중인 `CommunityShortformComposeForm`에는 썸네일·태그 입력이 없고 서버 액션도 `thumbnailUrl: null`, `tags: []`로 저장. 썸네일(`name="thumbnail"`)·태그(`name="tags"`) 입력은 **미사용 파일** `CommunityShortformUploadForm.tsx`에만 존재(부록 참조).
- **※4** 폼 라벨은 "영상 (mp4/mov, 최대 3분/500MB)"이고 상수 `SHORTFORM_VIDEO_MAX_SEC=180`이 정의돼 있으나, 서버 검증은 MIME·매직바이트·용량(500MB=`SHORTFORM_VIDEO_MAX_BYTES`)만 수행하고 영상 길이(3분)는 검증하지 않음.
- **※5** 게시판 카드·상세는 해시태그 표시(`#태그`)를 지원하지만, 현행 작성 폼 `CommunityBoardComposeForm`에는 해시태그 입력이 없고 액션이 `hashtags: []`로 저장. 해시태그 입력 UI는 미사용 구형 폼 `CommunityComposeForm`에만 존재.
- **※6** 조회수 집계 방식이 게시판/숏폼 간 상이: 게시판은 클라이언트 `BoardViewTracker`가 sessionStorage 가드로 세션당 1회 `POST /api/community/board/view`, 숏폼은 상세 페이지 서버 렌더 시마다 `incrementShortformView` 호출(세션 가드 없음).

## 커버 라우트 (검증용 전수 목록)

route-inventory.txt `community` grep 17건 중 본 리포트 담당 15건 + 타 리포트 2건.

| # | 라우트 | 파일 | 성격 |
|---|--------|------|------|
| 1 | `/community` | `app/(public)/community/page.tsx` | 커뮤니티 홈 |
| 2 | `/community/board` | `app/(public)/community/board/page.tsx` | 게시판 목록 |
| 3 | `/community/board/[id]` | `app/(public)/community/board/[id]/page.tsx` | 게시판 상세 |
| 4 | `/community/new` | `app/(public)/community/new/page.tsx` | 게시글 작성 (로그인 필요) |
| 5 | `/community/shortform` | `app/(public)/community/shortform/page.tsx` | 숏폼 목록 |
| 6 | `/community/shortform/[id]` | `app/(public)/community/shortform/[id]/page.tsx` | 숏폼 상세 |
| 7 | `/community/shortform/new` | `app/(public)/community/shortform/new/page.tsx` | 숏폼 업로드 (멘토 전용) |
| 8 | `/community/me` | `app/(public)/community/me/page.tsx` | 내 활동 허브 |
| 9 | `/community/posts` | `app/(public)/community/posts/page.tsx` | 레거시 → `/community/board` (permanentRedirect) |
| 10 | `/community/shorts` | `app/(public)/community/shorts/page.tsx` | 레거시 → `/community/shortform` (permanentRedirect) |
| 11 | `/community/shorts/[id]` | `app/(public)/community/shorts/[id]/page.tsx` | 레거시 → `/community/shortform/[id]` (permanentRedirect) |
| 12 | `/community/write` | `app/(public)/community/write/page.tsx` | 레거시 → `/community/new` (permanentRedirect) |
| 13 | `/mentor/community/new` | `app/(mentor)/mentor/community/new/page.tsx` | 작성 진입 분기 redirect |
| 14 | `GET /api/community/posts` | `app/api/community/posts/route.ts` | 게시판 피드 JSON |
| 15 | `POST /api/community/board/view` | `app/api/community/board/view/route.ts` | 게시글 조회수 +1 |
| — | `/admin/community-content` | `app/(admin)/admin/(console)/community-content/page.tsx` | 관리자 리포트 담당 (본 리포트 범위 외) |
| — | `/legal/community-guidelines` | `app/(public)/legal/community-guidelines/page.tsx` | 법적 고지 리포트 담당 (본 리포트 범위 외) |

연결 lib: `lib/community/` 20개 파일(actions·mutations·queries·constants·storage). 컴포넌트: `components/community/` 35개 파일(미사용 7개는 부록).

## 화면별 상세

### 공통 셸 — 전 `/community/*` 화면 (`components/community/CommunityLayoutShell.tsx`)

모든 커뮤니티 화면이 `CommunityLayoutShell`(서버 컴포넌트, `getServerUserWithProfile`로 로그인 여부만 조회)로 감싸짐. 데스크탑(lg+) 좌측 200px 사이드바 + 본문, 모바일은 사이드바 숨김(`hidden lg:block`) + 상단 탭.

| 요소 (표시 라벨) | 종류 | 소스 | 연결 동작 | 추론한 존재 목적 |
|------------------|------|------|-----------|------------------|
| "홈" / "숏폼" / "게시판" 네비 링크 | 사이드바 링크 (lg+ 전용) | `CommunityLeftSidebar.tsx` `NavLink` | `/community` · `/community/shortform` · `/community/board`, `activeNav`에 파란 활성 스타일 | 채널 4의 두 축(게시판/숏폼)을 한 사이드바에서 상시 전환 — 체류 시간 확보 |
| "내 활동" 네비 링크 | 사이드바 링크, 구분선 아래 분리 | 동일 | `/community/me`, active=`me`/`my-posts`/`scraps` | 소비 화면(홈·숏폼·게시판)과 개인 허브를 시각적으로 구분 |
| "실시간 인기 주제" + 1~5위 목록 ("학습 루틴 공유" 등) | 사이드바 섹션 | `HOT_TOPICS` 상수 `.map()` — 5개 반복 (하드코딩, 링크 없음) | 없음 (정적 표시) | 커뮤니티가 활성화돼 보이게 하는 분위기 조성용 정적 콘텐츠 (추정 — DB 연동 없음) |
| "로그인하면" / "댓글·스크랩 이용" / "로그인" | 사이드바 CTA 카드 | 동일, **비로그인 시에만** (`!props.loggedIn`) | `/login?next=%2Fcommunity` | anon 열람자를 회원 전환시키는 인라인 가입 유도 — 채널 4의 유입→계정 전환 첫 단계 |
| "커뮤니티 메뉴" 모바일 탭 ("홈"/"숏폼"/"게시판"/"내 활동") | 모바일 탭바 | `CommunityLayoutShell` → `MobileNavTabs` (01 공용 사전 참조) | 사이드바와 동일 4개 경로 | 모바일에서 사이드바 대체 — 동일 IA 유지 |

### /community — 커뮤니티 홈 (`app/(public)/community/page.tsx`)

anon 포함 전원 조회. 추천 숏폼=최신순 6개(`listShortformFeed limit 6, sort latest`), 인기 게시글=좋아요 상위 5개·동률 시 최신(`listCommunityPopularPostsForHome`, 주석 "G4.1 … 결정적·랜덤 없음").

| 요소 (표시 라벨) | 종류 | 소스 | 연결 동작 | 추론한 존재 목적 |
|------------------|------|------|-----------|------------------|
| "쌤버십 커뮤니티" / "학습법, 내신, 진로 이야기를 나누고 멘토와 연결해 보세요." | h1 + 설명 | `page.tsx` header | 없음 | 채널 정체성 선언 — "멘토와 연결"이 구독 전환 채널임을 카피로 명시 |
| "함께하는 학습 공간" / "멘토의 숏폼과 게시판 글로 공부 흐름을 이어가 보세요." | 인트로 카드 | `CommunityHomeSections.tsx` | 없음 | 무료 콘텐츠 소비를 학습 루틴으로 프레이밍해 재방문 유도 |
| "추천 숏폼" / "핵심만 담은 학습 영상을 모았습니다." / "더보기 →" | 섹션 카드 헤더 | `CommunitySectionCard` (title/subtitle/action) | "더보기 →" → `/community/shortform` | 홈에서 숏폼 축으로 트래픽 분배 |
| 숏폼 카드 | 카드 그리드 | `props.shortforms.slice(0,6).map()` — **최대 6개 반복** → `CommunityShortformVideoCard` | `/community/shortform/{id}` | 최신 멘토 영상을 첫 화면에 노출해 유입 직후 체류 형성 |
| "숏폼 영상을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요." | 오류 문구 | **`shortformError` 존재 시에만** | 없음 | 로드 실패를 빈 상태와 구분 고지 |
| 숏폼 빈 상태 ("아직 등록된 숏폼 영상이 없습니다.") | 빈 패널 | `CommunityShortformEmptyPanel` `compact`, **items 0건 시** | 없음 | 콜드스타트 시 역할별 안내(아래 숏폼 목록 화면의 동일 컴포넌트 참조) |
| "인기 게시글" / "최근 반응이 좋은 글을 확인하세요." / "게시판 →" | 섹션 카드 헤더 | `CommunitySectionCard` | "게시판 →" → `/community/board` | 홈에서 게시판 축으로 트래픽 분배 |
| 인기 게시글 행 (카테고리 배지 + 제목 + "{작성자} · {날짜}" + 댓글 수) | 리스트 행 | `props.popularPosts.slice(0,5).map()` — **최대 5개 반복** | 제목 → `/community/board/{id}` | 좋아요 상위 글로 "반응 좋은 콘텐츠"를 증명해 게시판 진입 동기 부여 |
| "아직 표시할 인기 게시글이 없어요." | 빈 문구 | **인기 게시글 0건 시** | 없음 | 콜드스타트 빈 상태 |
| "게시글을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요." | 오류 문구 | **`boardError` 존재 시에만** | 없음 | 로드 실패 고지 |

### /community/board — 게시판 목록 (`app/(public)/community/board/page.tsx`)

anon 포함 전원 조회. `?category=`·`?tab=`(정렬)을 서버에서 파싱해 `listCommunityBoardPosts`(status='published', limit 12) 호출 → `CommunityHomeFeed`(client, `paginate` 모드).

| 요소 (표시 라벨) | 종류 | 소스 | 연결 동작 | 추론한 존재 목적 |
|------------------|------|------|-----------|------------------|
| "게시판" / "공부법, 해설, 후기, 학습 팁을 카테고리별로 모아 봤어요." | 헤더 카드 | `page.tsx` | 없음 | 화면 정체성 — 게시판이 학습 콘텐츠 축임을 명시 |
| "불러오는 중…" | Suspense fallback | `page.tsx` `<Suspense>` | 없음 | 서버 데이터 대기 중 로딩 표시 |
| 정렬 탭 "전체" / "최신" / "인기" | 탭 링크 (role=tablist "게시판 정렬") | `CommunityBoardSortTabs.tsx` — `COMMUNITY_BOARD_SORT_TABS.map()` **3개 반복** | `?tab=latest`·`?tab=popular` 세팅("전체"는 tab 삭제), scroll:false | 소비 목적별 진입(신규글 확인 vs 검증된 인기글). "인기"=like→view→comment→created 내림차순(`applyBoardFeedSort`) |
| 카테고리 칩 "전체"/"학습법"/"내신"/"진로"/"대학생활"/"자유" — **6종** | 필터 칩 (nav "카테고리") | `CommunityHomeFeed.tsx` — `COMMUNITY_POST_CATEGORIES.map()` **6개 반복**. 모바일 가로 스크롤 1줄·데스크탑 flex-wrap | `onTab()` → `?category={slug}` router.push ("전체"=`all`은 **param 삭제**) | 카테고리 5종+all 필터. **`all`은 DB에 저장되지 않는 UI 필터 전용 값** — 저장 시엔 `normalizeCommunityPostCategory`가 5종만 허용(잘못된 값은 `free`로 폴백) |
| 게시글 카드 | 리스트 행 | `visiblePosts.map()` — **페이지당 최대 10개(모바일 5개) 반복** → `CommunityPostCard` | 아래 카드 행 참조 | 피드 본체 |
| ├ 작성자 아바타(이니셜 원) + 작성자명 + 역할 배지("멘토"/"학생"/"관리자"/"사용자") + 날짜 + 카테고리 배지 | 카드 메타 | `CommunityPostCard.tsx`, 배지는 `AuthorRoleBadge` — **`authorRole` 존재 시에만** | 없음 | 멘토 글임을 즉시 식별시켜 멘토 브랜딩(채널 4 핵심 고리) 강화 |
| ├ 제목 + 2줄 발췌(`line-clamp-2`) + 첫 이미지 썸네일(있으면) | 카드 본문 링크 | 동일, 썸네일은 **`imageUrls[0]` 존재 시에만** | `/community/board/{id}` | 클릭 전 콘텐츠 가치 미리보기 |
| ├ "#태그" 목록 | 해시태그 | `p.hashtags.map()` — **N개 반복, 존재 시에만** ※5 | 없음 (링크 아님) | 주제 식별 표시 (추정 — 검색·필터 연동 없음) |
| ├ "좋아요 N" · 댓글 수 · "조회 N" | 반응 카운터 | 동일 (`toLocaleString("ko-KR")`) | 없음 | 사회적 증거로 클릭 우선순위 판단 지원 |
| └ "읽기" | 버튼형 링크 | 동일 | `/community/board/{id}` | 명시적 상세 진입 CTA |
| "아직 게시글이 없어요" / "이 카테고리에 첫 번째 글을 작성해보세요." / "글 작성하기" | 빈 상태 | `CommunityHomeFeed`, **posts 0건 시** | "글 작성하기" → `/community/new` | 빈 카테고리를 작성 유도 기회로 전환 |
| "이전" / "{현재} · {전체}" / "다음" | 페이지네이션 | **`paginate=true`(게시판)이고 totalPages>1일 때** — 이미 로드된 배열의 클라이언트 페이지네이션 | page state 증감, 경계에서 disabled | 새 fetch 없이 12개 로드분 내 탐색 (홈 피드는 대신 IntersectionObserver 무한 스크롤 + `GET /api/community/posts` — 본 화면은 paginate 모드) |
| "+ 글쓰기" | 플로팅 FAB (우하단 고정) | `CommunityHomeFeed` 하단 `<Link>` | `/community/new` (비로그인이면 그 페이지에서 `/login?next=` redirect) | 어느 스크롤 위치에서든 작성 진입 — UGC 생산 극대화 |

### /community/board/[id] — 게시판 상세 (`app/(public)/community/board/[id]/page.tsx` + `CommunityBoardDetail.tsx` 280줄)

anon 조회 가능(`getCommunityBoardPost` — `status==='hidden'`/`'draft'`는 "게시글을 찾을 수 없습니다." 처리 ※1). 상호작용(`canInteract`)은 로그인 시에만. 작성자가 멘토면 `loadFavoriteMentorIdsForUser`로 찜 상태 조회.

| 요소 (표시 라벨) | 종류 | 소스 | 연결 동작 | 추론한 존재 목적 |
|------------------|------|------|-----------|------------------|
| "게시글을 불러오지 못했습니다." / "게시글을 찾을 수 없습니다." | 오류/부재 문구 | `page.tsx`, **로드 실패 / UUID 불일치·hidden·draft 시** | 없음 | 실패와 부재(검수 숨김 포함)를 구분 고지 |
| (조회수 트래커) | 비표시 클라이언트 컴포넌트 | `BoardViewTracker` — **post 존재 시에만** 마운트 | sessionStorage `bv:{postId}` 가드 후 `POST /api/community/board/view` 1회 (keepalive, best-effort) | 세션당 1회만 조회수 +1 — 새로고침·좋아요 후 리다이렉트로 인한 중복 집계 방지 ※6 |
| 작성자 아바타 + 작성자명 + 역할 배지 + 날짜 | 상세 헤더 | `CommunityBoardDetail` header, 배지는 **`authorRole` 존재 시** | 없음 | 콘텐츠 신뢰 판단 근거 |
| 멘토 찜 버튼 | 토글 버튼 | `MentorFavoriteButton` (01 공용 사전 참조) — **작성자가 멘토(`authorMentorId`)일 때만** 표시, 비로그인 클릭 시 `loginNext=returnPath` | 멘토 찜(=팔로우 통합) 토글 | **채널 4의 전환 고리 그 자체** — 글 읽고 멘토를 찜하면 멘토 찾기→구독 퍼널로 연결 |
| 제목 + 본문(`whitespace-pre-wrap`) | 본문 | `pickPostBody(row)` (body/content 등 컬럼 폴백) | 없음 | 콘텐츠 본체 |
| 본문 이미지 | 이미지 그리드 | `images.map()` — **N개 반복(최대 5장), 존재 시에만**; URL은 private 버킷 `community-post-images` 서명 URL(7일) | 없음 | 학습 자료(필기·해설 사진) 전달, 비공개 버킷 정책 준수 |
| "#태그" 목록 | 해시태그 | `hashtags.map()` — **N개 반복, 존재 시** ※5 | 없음 | 주제 표시 |
| "좋아요 {N}" | 토글 버튼 (활성 시 파란 배경) | **로그인 시** form → `toggleCommunityPostReactionAction` (`type=like`); **비로그인 시 카운트만 표시** | `post_reactions` 토글 후 returnPath로 redirect | 반응 누적 → 홈 "인기 게시글"·"인기" 정렬의 랭킹 원천 |
| "스크랩" / "스크랩 취소" | 토글 버튼 | **로그인 시에만** form → 동일 액션 (`type=scrap`) | 스크랩 토글 | 나중에 다시 볼 학습 글 저장 → `/community/me` 스크랩 탭과 연동 예정(현재 탭은 placeholder) |
| "조회 {N}" | 카운터 | `post.viewCount` | 없음 | 도달 규모 표시 |
| "신고" (접힘) → 사유 select("부적절한 내용"/"스팸·광고"/"욕설·비방"/"개인정보 노출"/"기타") + "상세 설명 (선택)" + "신고 접수" | details 접이식 신고 폼 | **로그인 시에만**. `REPORT_REASONS.map()` **5개 반복** → `submitCommunityContentReportAction` | `content_reports` insert (`target_type='community_post'`), 성공 시 `?reportOk=1` | anon 공개 채널의 자정 장치 — 신고를 관리자 검수 큐로 보냄 ※1 |
| "신고가 접수되었습니다." / "신고 접수에 실패했습니다." | StateBanner (success/error) | **`?reportOk=1` / `?reportError=` 시** | 없음 | 신고 처리 결과 피드백 (`window.alert` 금지 규칙 준수) |
| "댓글 {N}" | 섹션 제목 | `post.commentCount` | 없음 | 대화량 표시 |
| "외부 연락처·대필 요청은 정책상 제한됩니다." / "댓글 등록에 실패했습니다." | StateBanner (error) | **`?commentError=policy` / 기타 코드 시** | 없음 | 신뢰·안전 필터(`sanitizeTrustSafetyText`) 차단 사유 고지 — 플랫폼 외부 거래 방지 |
| 댓글 입력("댓글을 입력해 주세요.", maxLength 2000) + "댓글 등록" | 폼 | **로그인 시** → `submitBoardCommentAction` | `community_post_comments` insert (계정 활성 검사 + 금지어·연락처 마스킹 후) | 무료 사용자도 참여 가능한 대화층 — 체류·재방문 동력 |
| "로그인 후 댓글을 작성할 수 있어요." | 안내 + 링크 | **비로그인 시** | "로그인" → `/login?next={returnPath}` | 참여 욕구를 가입 전환으로 연결 |
| 댓글 아이템 (작성자명 + 날짜 + 내용 + "좋아요 {N}") | 재귀 리스트 | `comments.map()` → `CommentItem` — **N개 반복, replies 재귀로 2단**(depth 0→1, `ml-6 border-l-2` 들여쓰기) | 없음 (댓글 좋아요는 카운트 표시만) | 기획의 "댓글 2단" 구현 — 질문·답변형 대화 구조 |
| ├ "삭제" | 인라인 폼 버튼 | **`node.isOwn`(본인 댓글)이고 로그인 시** → `deleteBoardCommentAction` | soft delete (`softDeleteBoardComment`) | 본인 발언 철회권 |
| └ "답글" (접힘) → "답글 작성" textarea + "등록" | details 접이식 폼 | **depth 0(최상위 댓글)에서만** → `submitBoardCommentAction` (`parentId` 포함) | 대댓글 insert | 2단 제한 강제 — depth 1에는 답글 버튼 자체가 없음 |
| "← 커뮤니티 홈" | 하단 링크 | `CommunityBoardDetail` 말미 | `/community` | 상세→홈 회귀 동선 |

### /community/new — 게시글 작성 (`app/(public)/community/new/page.tsx` + `CommunityBoardComposeForm.tsx`)

**비로그인 시 `redirect("/login?next=/community/new")`** — 작성은 로그인 본인(구독 불요, 역할 제한 없음). `?draftId=` 있으면 본인 소유 draft(`getCommunityBoardDraft`, `author_id` 일치 + `status='draft'`)를 로드해 이어쓰기.

| 요소 (표시 라벨) | 종류 | 소스 | 연결 동작 | 추론한 존재 목적 |
|------------------|------|------|-----------|------------------|
| "← 뒤로" | 상단바 링크 | `CommunityComposeTopBar` (`backHref="/community/board"`) | `/community/board` | 작성 이탈 동선 |
| "임시저장" | 상단바 submit (`intent=draft`, `formNoValidate`) | 동일 → `submitCommunityBoardPostAction` | `status='draft'` 저장 후 `?draft=1&draftId=` redirect → "임시저장됨" AppToast (01 공용 사전 참조) | 미완성 글 보존 — 본문 10자 검증을 draft에는 미적용(published에만) |
| "올리기" | 상단바 submit (`intent=publish`) | 동일 | `status='published'` 저장 후 `/community/board/{id}` redirect ※1 | 발행 즉시 공개 — 상세로 이동해 결과 확인 |
| 오류 배너 ("외부 연락처·대필 요청은 정책상 제한됩니다." / "제목을 입력해 주세요." / "본문은 최소 10자 이상입니다." / "이미지 업로드에 실패했습니다." / "이미지는 최대 5장까지입니다." / "저장에 실패했습니다. 다시 시도해 주세요.") | 인라인 오류 | **`?error=` 코드(policy/title/body/upload/images/기타)별 매핑 시** | 없음 | 서버 검증(금지어·연락처 → `findRestrictedPhraseInText`+`maskContactInUserText`, 계정 정지 gate 포함) 실패 사유 안내 |
| "제목" | 필수 input | form, draft 로드 시 `defaultValue` | submit payload | 목록 노출 제목 |
| "카테고리" 칩 ("학습법"/"내신"/"진로"/"대학생활"/"자유" — **5종, "전체" 제외**) | 단일선택 칩 + hidden input | `CommunityCategoryChips` — `categories.filter(c => c.slug !== "all")` 후 `.map()` **5개 반복**, 기본 `study` | 선택값을 `<input type="hidden" name="category">`에 반영 | **작성 시엔 `all`이 원천 배제됨** — `all`은 목록 필터 전용이라는 규칙을 폼 구조로 강제 |
| "본문 (올리기 시 최소 10자)" | textarea rows 8 | form | submit payload | 콘텐츠 본체 — draft는 10자 미만 허용임을 라벨로 표현 |
| "이미지 (최대 5장)" + "이미지 첨부" 드롭존 ("클릭하거나 파일을 끌어다 놓으세요") | 파일 드롭존 | `CommunityFileDropzone` (`accept="image/jpeg,image/png,image/webp,image/gif"`, multiple, max 5=`COMMUNITY_IMAGE_MAX`) | 선택 시 "{N}개 선택 · {파일명}" 표시; 서버에서 장당 5MB·매직바이트 검증 → private 버킷 `community-post-images` 업로드 → 서명 URL(7일) 저장 | 학습 자료 이미지 첨부 — Storage 비공개 정책(public=false) 준수 |
| "기존 {N}장 유지 · 새로 선택하면 추가됩니다." | 안내 문구 | **draft에 imageUrls 존재 시에만** (+hidden `existingImageUrls` JSON) | submit 시 기존 URL 병합 | 이어쓰기에서 이미지 유실 방지 |

### /community/shortform — 숏폼 목록 (`app/(public)/community/shortform/page.tsx`)

anon 포함 전원 조회. `listShortformFeed`(limit 48, `status==='published'`만 필터)를 `CommunityShortformGrid`가 클라이언트 페이지네이션(새 fetch 없음).

| 요소 (표시 라벨) | 종류 | 소스 | 연결 동작 | 추론한 존재 목적 |
|------------------|------|------|-----------|------------------|
| "숏폼" / "멘토의 짧은 학습 영상을 둘러보세요." | 헤더 카드 | `page.tsx` | 없음 | 숏폼 축 정체성 — 공급자가 멘토임을 명시 |
| 정렬 탭 "최신" / "인기" / "전체" | 탭 링크 (role=tablist "숏폼 영상 탭") | `CommunityShortformTabs` — `TABS.map()` **3개 반복** | `?tab=latest`·`?tab=popular` ("전체"는 기본 경로). "인기"=like→view→created 내림차순 | 게시판과 동일한 소비 목적별 진입 |
| 카테고리 칩 "전체"/"학습법"/"내신"/"진로"/"대학생활" — **5종(자유 없음 ※2)** | 필터 칩 (nav "카테고리") | `CommunityShortformCategoryTabs` — `SHORTFORM_CATEGORIES.map()` **5개 반복**, 모바일 가로 스크롤 | `?category={slug}` ("전체"=`all`은 param 삭제 — **UI 필터 전용, 저장 안 됨**) | 영상 주제 필터 |
| 숏폼 카드 | 그리드 (1→sm:2→md:3열) | `visible.map()` — **페이지당 최대 6개(모바일 4개) 반복** → `CommunityShortformVideoCard` | `/community/shortform/{id}` | 피드 본체 |
| ├ 9:15 세로 썸네일(없으면 video preload=metadata, 그것도 없으면 "영상" placeholder) + 재생 아이콘 오버레이 | 카드 미디어 | `CommunityShortformVideoCard.tsx` — URL은 private 버킷(`shortform-videos`/`shortform-thumbnails`) 서명 URL(7일)로 resolve | 카드 전체 링크 | 숏폼 포맷(세로 영상) 시각 언어 + 비공개 버킷 정책 준수 |
| └ 제목(2줄) + 작성자명 + 역할 배지 + ♥ 좋아요 수 + "조회 {N}" + 날짜 | 카드 메타 | 동일, 배지는 **`authorRole` 존재 시** | 없음 | 멘토 브랜딩 + 사회적 증거 |
| "숏폼 목록을 불러오지 못했습니다." / "등록된 숏폼이 없습니다." | 오류/빈 문구 | **error 시 / items 0건 시** | 없음 | 실패·콜드스타트 구분 고지 |
| "이전" / "{현재} · {전체}" / "다음" | 페이지네이션 | `CommunityShortformGrid`, **totalPages>1일 때** | page state 증감 | 48개 로드분 내 클라이언트 탐색 |
| "+ 숏폼 올리기" | 플로팅 FAB | `CommunityShortformUploadFab` (client) | **비로그인** → `/login?next=/community/shortform/new` · **로그인+비멘토** → AppToast "숏폼 업로드는 멘토만 가능합니다." · **멘토** → `/community/shortform/new` | 업로드 진입을 역할별 3분기 — 멘토 전용 공급 규칙을 목록 화면에서 즉시 안내 |

### /community/shortform/[id] — 숏폼 상세 (`app/(public)/community/shortform/[id]/page.tsx` + `CommunityShortformDetailView.tsx`)

anon 조회 가능(`getShortformDetail` — `status==='hidden'`은 미노출 ※1). 상세 렌더 시 서버에서 `incrementShortformView` 호출 ※6.

| 요소 (표시 라벨) | 종류 | 소스 | 연결 동작 | 추론한 존재 목적 |
|------------------|------|------|-----------|------------------|
| "숏폼을 불러오지 못했습니다." | 오류 문구 | **로드 실패 시** | 없음 | 실패 고지 |
| "숏폼을 찾을 수 없어요" / "삭제되었거나 존재하지 않는 콘텐츠예요." / "숏폼 목록으로" | 부재 상태 (VideoOff 아이콘) | **UUID 불일치·미존재·hidden 시** | "숏폼 목록으로" → `/community/shortform` | 죽은 링크(레거시 shorts 링크 포함)에서 목록 복귀 |
| 9:16 세로 플레이어 (`<video controls playsInline poster>`; videoUrl 없으면 썸네일, 둘 다 없으면 "영상 준비 중") | 비디오 플레이어 | `CommunityShortformDetailView` — 서명 URL(7일)로 재생 | 재생 컨트롤 | 콘텐츠 본체 — private 버킷이므로 서명 URL 필수 |
| 제목 + 역할 배지 + "{작성자} · {날짜}" + 설명(있으면) | 메타 | 동일, 설명은 **`description` 존재 시** | 없음 | 멘토 브랜딩 표시 |
| "#태그" 목록 | 해시태그 | `v.tags.map()` — **N개 반복, 존재 시** ※3 | 없음 | 주제 표시 (현행 업로드 폼은 태그 미저장이므로 사실상 레거시 데이터용, 추정) |
| "좋아요 {N}" | 토글 버튼 / 링크 | **로그인 시** form → `toggleShortformLikeAction`; **비로그인 시** 같은 모양의 `/login?next=` 링크 | 좋아요 토글 후 returnPath redirect; 실패 시 `?likeError=not_ready` | 인기 정렬 랭킹 원천 + 비로그인 클릭을 가입 전환으로 회수 |
| "좋아요 기능은 DB 적용 후 사용할 수 있어요." | 경고 배너 | **`?likeError=` 존재 시** (`toggleShortformLike` 실패 = 반응 테이블 미배포 폴백) | 없음 | 스키마 미배포 환경에서 기능 상태를 정직하게 고지 |
| "조회 {N}" | 카운터 | `v.viewCount` | 없음 | 도달 규모 표시 |
| "공유 (준비 중)" | disabled 버튼 | 정적 | 없음 (disabled) | 공유 기능 예고 자리표시 (추정 — 구현 없음) |
| "댓글" 섹션 + textarea(maxLength 1000) + "등록" | 폼 | **로그인(`canComment`) 시** → `submitCommunityCommentAction` (`postType="shortform"`) | `community_comments` insert (금지어·연락처 필터 후) — **게시판과 달리 단층(2단 답글 없음)** | 숏폼에도 참여층 제공 |
| "로그인 후 댓글을 작성할 수 있어요." | 안내 + "로그인" 링크 | **비로그인 시** | `/login?next={returnPath}` | 참여→가입 전환 |
| 댓글 아이템 (작성자명 + 본문) | 리스트 | `props.comments.map()` — **N개 반복** | 없음 | 대화 표시 |
| "← 숏폼 목록" | 하단 링크 | 말미 | `/community/shortform` | 목록 회귀 동선 |

숏폼 상세에는 게시판과 달리 화면 내 신고 폼이 없음(신고 액션 자체는 `postVariant="shortform"`을 지원 — 미사용 `CommunityPostDetail`에만 UI 존재, 부록 참조).

### /community/shortform/new — 숏폼 업로드 (`app/(public)/community/shortform/new/page.tsx` + `CommunityShortformComposeForm.tsx`)

**이중 가드:** 비로그인 → `/login?next=`, 로그인+비멘토 → `redirect("/community/shortform?error=mentor_only")`. 서버 액션에서도 `profile?.role !== "mentor"` 재검사(+계정 활성 gate) — 멘토 전용 공급을 페이지·액션 양쪽에서 강제. `?tab=board` 레거시 쿼리는 `legacyShortformTabRedirect`로 `/community/new`에 위임.

| 요소 (표시 라벨) | 종류 | 소스 | 연결 동작 | 추론한 존재 목적 |
|------------------|------|------|-----------|------------------|
| "← 뒤로" / "임시저장" / "올리기" | 상단바 | `CommunityComposeTopBar` (`backHref="/community/shortform"`) | 게시글 작성과 동일 패턴 — draft/publish intent → `submitShortformUploadAction` | 작성 UX를 게시판과 통일 |
| 오류 배너 ("외부 연락처·대필 요청은 정책상 제한됩니다." / "멘토 계정만 업로드할 수 있어요." / "권리 보유 확인이 필요합니다." / "영상 업로드가 필요합니다." / "영상은 최대 500MB까지입니다." / "저장에 실패했습니다.") | 인라인 오류 | **`?error=` 코드(policy/mentor_only/rights/video·video_upload/video_size/기타)별** | 없음 | 서버 검증 실패 사유 안내 |
| "제목 (최대 100자)" | 필수 input (`maxLength=100`=`SHORTFORM_TITLE_MAX`) | form | submit payload | 목록 노출 제목 |
| "카테고리" select ("학습법"/"내신"/"진로"/"대학생활" — 4종 ※2) | select | `SHORTFORM_CATEGORIES.filter(c => c.slug !== "all").map()` **4개 반복**, 기본 `study` | submit payload | 작성 시 `all` 원천 배제 — 게시판 칩과 동일 규칙을 select로 구현 |
| "영상 (mp4/mov, 최대 3분/500MB)" + "영상 파일 선택" 드롭존 ("클릭하거나 영상 파일을 끌어다 놓으세요") | 파일 드롭존 | `CommunityFileDropzone` (`accept="video/mp4,video/quicktime,video/webm"`, **저장된 draft 영상 없을 때만 required**) | 서버에서 MIME·매직바이트·500MB 검증 ※4 → private 버킷 `shortform-videos` 업로드, `{bucket}/{path}` 참조 저장 | 핵심 미디어 업로드 — 비공개 버킷 정책 준수 |
| "임시저장된 영상이 있습니다. 새 파일을 선택하면 교체됩니다." | 안내 | **draft에 videoUrl 존재 시** (+hidden `videoUrl`) | 재업로드 없이 재사용 | 대용량 재업로드 방지 |
| "설명 (최대 500자)" | textarea (`maxLength=500`=`SHORTFORM_DESC_MAX`) | form | submit payload ※3 (썸네일·태그 입력은 없음) | 영상 보조 설명 |
| "출처 (선택)" | input | form | submit payload | 인용·2차이용 출처 명시 유도 |
| "영상 및 콘텐츠의 권리를 보유하며 정책에 맞게 올립니다. (올리기 시 필수)" | 체크박스 (`rightsAck`) | form — **publish 시에만 서버 필수**(미체크 → `?error=rights`) | submit payload | 저작권 리스크를 업로더 확약으로 이전 |
| "미리보기" 패널 ("업로드한 영상의 미리보기가 여기에 표시됩니다.") | 우측 aside 9:16 프레임 | **파일 선택 시 파일명 표시**, 그 외 안내 문구 | 없음 | 세로 포맷 규격 시각 안내 (실제 영상 미리보기는 아님) |
| "업로드 팁" 목록 ("유익한 내용 …" 등 4항) | aside 목록 | `UPLOAD_TIPS.map()` — **4개 반복** (정적) | 없음 | 콘텐츠 품질 가이드 — 검수 없는 즉시 공개(※1)를 사전 가이드로 보완 (추정) |
| "업로드 시 장점" 목록 ("정기적으로 우수 콘텐츠가 선정돼요" / "배지 및 랭킹에 반영돼요") | aside 목록 | `UPLOAD_BENEFITS.map()` — **2개 반복** (정적) | 없음 | 멘토 공급 동기 부여 — 콘텐츠 공급이 멘토 브랜딩 보상으로 돌아온다는 약속 (배지·랭킹 구현 근거는 미확인, 추정) |
| 발행/임시저장 결과 | redirect | publish → `/community/shortform/{id}` · draft → `?draft=1&draftId=` + "임시저장됨" AppToast | — | 게시판과 동일한 발행 완주 경험 |

### /community/me — 내 활동 허브 (`app/(public)/community/me/page.tsx`)

`?tab=` 4종(`overview`/`posts`/`drafts`/`scraps`, 잘못된 값은 overview — `parseCommunityMeTab`). **비로그인 시** 히어로("커뮤니티" / "내 활동" / "내 게시글·스크랩은 로그인 후 이용할 수 있어요.") + `LoginRequiredState` (01 공용 사전 참조)만 표시. 로그인 시 게시판·숏폼 내 글을 병합 로드(각 120건, 병합 200건 상한).

| 요소 (표시 라벨) | 종류 | 소스 | 연결 동작 | 추론한 존재 목적 |
|------------------|------|------|-----------|------------------|
| 히어로 "내 활동" + 역할별 설명 (멘토: "작성한 글·숏폼과 활동 요약을 탭으로 나눠 확인해 보세요." / 로그인 일반: "참여한 활동과 내 글을 탭에서 확인하세요.") | `CommunityPageHero` | `meDescription(role, loggedIn)` 분기 | 없음 | 역할별로 허브의 쓸모를 다르게 안내(멘토=공급자 관리, 학생=참여 확인) |
| [overview] "내 게시글" 섹션 + "더 보기 >" | 섹션 카드 | `CommunityMeOverviewSections` — 최근 5건 `MePostsList` | "더 보기 >" → `/community/me?tab=posts` | 요약→탭 상세 동선 |
| [overview] "임시저장" 섹션 + "더 보기 >" | 섹션 카드 | 최근 3건 `MeDraftsList` | `/community/me?tab=drafts` | 미완성 글 복귀 유도 |
| [overview] "스크랩" 섹션 ("스크랩한 게시글을 모아 볼 수 있어요.") | 섹션 카드 | 정적 안내 | `/community/me?tab=scraps` | 스크랩 허브 예고 |
| [posts/drafts 공통] 항목 행: "게시판"/"숏폼" 종류 배지 + 제목 + 날짜 | 리스트 행 | `items.map()` — **N개 반복** (`MePostsList`/`MeDraftsList`), published 게시글은 상세 링크·draft는 링크 없음 | published → `/community/board/{id}` 또는 `/community/shortform/{id}` | 두 콘텐츠 축을 한 목록에서 구분 표시 |
| [drafts] "이어서 작성" | 행 버튼 | `MeDraftsList` — draft별 `continueHref` | `/community/new?draftId=` 또는 `/community/shortform/new?draftId=` | draft를 작성 폼으로 되살리는 유일한 복귀 경로 |
| [posts, 멘토] "게시글 작성" / [drafts] "새 글 작성" | CTA 버튼 | `CommunityMeTabPanels` — **멘토 posts 탭은 파란 버튼, 학생·관리자 탭엔 작성 CTA 없음**(주석 "student · admin · 기타 로그인 — 작성 CTA 없음") | `/community/new` | 공급자(멘토)에게만 작성을 능동 권유 — 코드 주석으로 의도 명시 |
| [scraps] "스크랩한 콘텐츠 목록은 데이터 연결 후 이 탭에 표시될 예정이에요." | placeholder 패널 | 정적 | 없음 | 스크랩 토글(게시판 상세)은 이미 저장 중이나 목록 조회 미구현 — 예정 기능 정직 고지 |
| "게시글 {N}개 · 숏폼 {N}개" | 카운트 라인 | `countLine(boardCount, shortformCount)` — **카운트 로드 성공 시** | 없음 | 활동량 요약 |
| "목록을 불러오지 못했어요. 잠시 후 다시 시도해 주세요." 등 | 오류 문구 | **`loadFailed` 시** 탭별 표시 | 없음 | 부분 실패 고지 |
| "숏폼·게시판은 왼쪽 메뉴에서 바로 열 수 있어요." | NavHint | 각 패널 말미 | 없음 | 허브에서 소비 화면 복귀 안내 |

### /mentor/community/new — 멘토 작성 진입 분기 (`app/(mentor)/mentor/community/new/page.tsx`)

| 요소 (표시 라벨) | 종류 | 소스 | 연결 동작 | 추론한 존재 목적 |
|------------------|------|------|-----------|------------------|
| (UI 없음 — 즉시 redirect) | 서버 redirect | 코드 주석 "드롭다운 작성 화면 → 분리된 작성 경로로 redirect" | `?tab=shortform` → `/community/shortform/new` · 그 외 → `/community/new` (`communityComposePath`, `draftId` 쿼리 보존) | **작성 진입 분기의 정본:** 과거 멘토 콘솔의 통합(드롭다운) 작성 화면을 폐기하고, 게시글은 `/community/new`(전 역할)·숏폼은 `/community/shortform/new`(멘토 전용)로 분리된 현행 체계에 구 진입점을 위임. 멘토 네비·북마크의 기존 링크가 깨지지 않게 유지 |

### 레거시 리다이렉트 4종 — 구 URL 보존 (`permanentRedirect`, HTTP 308)

| 요소 (표시 라벨) | 종류 | 소스 | 연결 동작 | 추론한 존재 목적 |
|------------------|------|------|-----------|------------------|
| `/community/posts` | permanentRedirect 페이지 | `posts/page.tsx` | → `/community/board` | 구 게시판 목록 URL 보존 — 외부 공유 링크·북마크·검색엔진 색인이 개편 후에도 유효하도록 영구(308) 이전 |
| `/community/shorts` | permanentRedirect 페이지 | `shorts/page.tsx` | → `/community/shortform` | 구 숏폼 목록 URL 보존 (구 명칭 "shorts" → 현행 "shortform") |
| `/community/shorts/[id]` | permanentRedirect 페이지 (동적) | `shorts/[id]/page.tsx` — `params`의 `id`를 그대로 전달 | → `/community/shortform/{id}` | 구 숏폼 상세 딥링크 보존 — 개별 영상 공유 링크가 가장 오래 살아남는 URL이므로 id 단위 이전 |
| `/community/write` | permanentRedirect 페이지 | `write/page.tsx` | → `/community/new` | 구 작성 URL 보존 |
| (보조) `/community/shortform/new?tab=board` | 쿼리 레거시 redirect | `legacyShortformTabRedirect` (`communityComposeTab.ts`) | → `/community/new` (`draftId` 등 나머지 쿼리 보존) | 통합 작성 화면 시절의 `?tab=` 링크까지 신 체계로 흡수 |

### API 2종 (`app/api/community/**`)

| 요소 (표시 라벨) | 종류 | 소스 | 연결 동작 | 추론한 존재 목적 |
|------------------|------|------|-----------|------------------|
| `GET /api/community/posts` (`?category&tab&cursor&limit`) | JSON API | `posts/route.ts` → `listCommunityBoardPosts` (limit 1~24 클램프, published만) | `CommunityHomeFeed`의 카테고리/정렬 전환·무한 스크롤 fetch가 유일한 소비처 | 서버 렌더 이후의 피드 갱신을 커서 기반으로 제공 — 실패 시에도 `{posts:[], error:"load_failed"}` 200 반환해 클라이언트 UI를 깨뜨리지 않음 |
| `POST /api/community/board/view` (`{postId}`) | JSON API | `board/view/route.ts` → `incrementPostView`. 코드 주석 "카운팅 외 부수효과 없음(데이터 변경 없음)" | `BoardViewTracker`가 세션당 1회 호출. UUID 검증 실패 400, 카운트 실패도 200 (best-effort) | 조회수를 서버 렌더에서 분리해 새로고침·액션 redirect로 인한 중복 집계 방지 ※6 |

### 부록 — 미사용(오펀) 컴포넌트 7개 (`components/community/`)

앱 라우트에서 import되지 않음(코드 실측: `app/`·`components/` 전체 grep 0건). 개편 이전 버전의 잔존물로 추정 — 존재 목적은 "과거 화면의 원형 보존"(추정).

| 요소 (표시 라벨) | 종류 | 소스 | 연결 동작 | 추론한 존재 목적 |
|------------------|------|------|-----------|------------------|
| `CommunityPostDetail` (415줄) | 미사용 상세 컴포넌트 | 자체에 댓글 폼 + 신고 폼(사유 5종 select, `postVariant` 가변) + "좋아요 (준비 중)" disabled 버튼 포함 | (연결 없음) | 게시판/숏폼 공용이던 구 상세 화면의 원형 — 현행은 `CommunityBoardDetail`/`CommunityShortformDetailView`로 분리 (추정) |
| `CommunityComposeForm` | 미사용 작성 폼 | "게시글 작성"/"숏폼 업로드" 내부 탭 + 해시태그 입력("#태그 입력 후 Enter"/"추가") + "임시저장"/"발행하기" | (연결 없음) | 탭 통합형 구 작성 화면 ※5 — 현행은 경로 분리 (추정) |
| `CommunityShortformUploadForm` (237줄) | 미사용 업로드 폼 | "썸네일 (선택)" 파일 입력 + "태그" 입력(최대 5) 포함 | (연결 없음) | 썸네일·태그를 받던 구 업로드 폼 ※3 (추정) |
| `MentorCommunityComposeForm` | 미사용 멘토 폼 | "게시물 작성 (멘토)" + "작성 대상" select("게시판 글"/"숏폼 영상") + "출처" 필수 + 권리 확약 체크 → `submitMentorCommunityPost` | (연결 없음) | `/mentor/community/new`가 redirect 전용이 되기 전의 드롭다운 작성 화면 (추정) |
| `CommunityMeTabNav` | 미사용 탭 내비 | "전체"/"내 게시글"/"임시저장"/"스크랩" 4탭 `.map()` | (연결 없음) | 내 활동 탭 UI 구버전 — 현행 me 페이지는 overview 링크·사이드바로 대체 (추정) |
| `CommunityHomeIntroStrip` | 미사용 안내 카드 | "커뮤니티 안내" + 숏폼/게시판 분리 설명 | (연결 없음) | 홈 개편 전 안내 배너 (추정) |
| `CommunityBoardEmptyPanel` | 미사용 빈 패널 | "아직 등록된 게시글이 없습니다." + 역할별 문구 | (연결 없음) | 현행 게시판 빈 상태는 `CommunityHomeFeed` 내장 UI가 담당 (추정) |
