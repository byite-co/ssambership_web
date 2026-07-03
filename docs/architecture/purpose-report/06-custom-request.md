# 06. 맞춤의뢰 (채널 3 — 에스크로 주문·게이트 OFF) — 존재 목적 리포트

> 대상 라우트 24개(page 21 + loading 3, admin/custom-request-orders 제외 — 10번 담당) · 요소 행 286개(액션 카탈로그 10행·상태 사전 24행 포함) · 근거: 코드 실측 + 기획 정본

맞춤의뢰(CR)는 학생이 작업(자소서 첨삭·학습 플랜 등)을 예산·기한과 함께 게시하면, 멘토들이 제안서(제안가·납기·내용·포트폴리오)를 의뢰당 1회 제출하고, 학생이 비교·선택 후 에스크로 결제로 주문을 만드는 채널 3이다. 주문방에서 작업 대기 → 작업 중 → 납품 대기 → (수락 = 완료·멘토 95% 적립·플랫폼 수수료 5% / 수정 요청 최대 2회 / 착수 전 취소 / 분쟁) 순으로 진행되며, 납품 파일 다운로드는 학생 수락(완료) 전 잠긴다. 현재 **운영 게이트 OFF** 상태로, `isCustomRequestFeatureEnabled()`(`lib/shell/featureFlags.ts:5`, `NEXT_PUBLIC_FEATURE_CUSTOM_REQUEST`가 `on/1/true/yes`일 때만 true)가 기본 false다.

## 0. 운영 게이트가 화면 노출에 작용하는 방식 (실측)

게이트는 **개별 CR 라우트에 OFF 분기를 두지 않는다**. 작동 지점은 정확히 2곳뿐이다.

| 지점 | 파일 | OFF일 때 동작 |
|---|---|---|
| 역할별 메인 네비 | `lib/shell/mainNavItems.ts:118` | `sessionRole !== "admin" && !isCustomRequestFeatureEnabled()`이면 네비에서 맞춤의뢰 항목 필터 제거(admin만 상시 노출). 랜딩 게스트 네비도 `:128`에서 동일 필터 |
| 공개 랜딩 배너 | `app/(public)/custom-request/page.tsx:53` | `!isCustomRequestFeatureEnabled()`이면 「맞춤의뢰는 곧 오픈 예정이에요」 + 「지금은 준비 중이라 새 의뢰 등록이 잠시 제한돼요. 이미 진행 중인 주문은 그대로 이용할 수 있어요.」 배너를 본문 위에 추가 렌더(본문은 그대로 노출) |

즉 OFF 상태의 실체는 "진입점 숨김 + 안내 배너"이며, URL 직접 접근 시 모든 학생·멘토 라우트는 역할 가드(`requireRole`)만 통과하면 정상 동작한다(코드 완비). 각주 [G1] 참조.

**핵심 정책 수치 (정본):** 플랫폼 수수료 `CUSTOM_ORDER_PLATFORM_FEE_RATE = 0.05`(멘토 95%, `lib/customRequest/orderSettlementAmounts.ts:9`) · 수정 요청 `MAX_REVISION_REQUESTS_PER_ORDER = 2`(`lib/customRequest/orderRevisionActions.ts:28`) · 금지어 배열 `CUSTOM_REQUEST_BANNED_PHRASES = []` **빈 배열**(`lib/customRequest/bannedPhrases.ts:5` — 차단 전면 폐지, 각주 [G2]) · 연락처 마스킹 `maskContactInText`(저장 시 무조건 적용, 각주 [G3]).

## 커버 라우트 (검증용 전수 목록)

`docs/architecture/route-inventory.txt` grep(`custom-request`) 전수 25건 중 `app/(admin)/admin/(console)/custom-request-orders/page.tsx` 1건 제외(10번 담당) — 24건, 누락 없음.

| # | route-inventory 행 | URL | 화면 ID / 실체 |
|---|---|---|---|
| 1 | `app/(public)/custom-request/page.tsx` | `/custom-request` | `public-custom-request` 공개 허브 |
| 2 | `app/(public)/custom-request/[postId]/page.tsx` | `/custom-request/[postId]` | `public-cr-post-detail` 공개 의뢰 상세 |
| 3 | `app/(public)/custom-request/[postId]/loading.tsx` | (동상) | 스켈레톤 |
| 4 | `app/(public)/custom-request/orders/page.tsx` | `/custom-request/orders` | `student-cr-orders` 학생 주문 목록 |
| 5 | `app/(public)/custom-request/orders/[orderId]/page.tsx` | `/custom-request/orders/[orderId]` | `cr-order-room` 주문방(학생·멘토 공용) |
| 6 | `app/(public)/custom-request/orders/[orderId]/loading.tsx` | (동상) | 스켈레톤 |
| 7 | `app/(public)/custom-request/orders/[orderId]/review/page.tsx` | `/custom-request/orders/[orderId]/review` | redirect 스텁 → 주문방 |
| 8 | `app/(student)/custom-request/new/page.tsx` | `/custom-request/new` | `student-cr-new` 의뢰 등록 |
| 9 | `app/(student)/custom-request/posts/page.tsx` | `/custom-request/posts` | `student-cr-posts` 내 의뢰 목록 |
| 10 | `app/(student)/custom-request/[postId]/applications/page.tsx` | `/custom-request/[postId]/applications` | `student-cr-compare` 제안 비교·선택 |
| 11 | `app/(student)/custom-request/[postId]/applications/loading.tsx` | (동상) | 스켈레톤 |
| 12 | `app/(student)/custom-request/[postId]/applications/waiting/page.tsx` | `/custom-request/[postId]/applications/waiting` | redirect 스텁 → 비교 화면 |
| 13 | `app/(student)/custom-request/orders/[orderId]/complete/page.tsx` | `/custom-request/orders/[orderId]/complete` | `student-cr-complete` 주문 완료 영수증 |
| 14 | `app/(mentor)/mentor/custom-request/page.tsx` | `/mentor/custom-request` | redirect 스텁 → dashboard |
| 15 | `app/(mentor)/mentor/custom-request/dashboard/page.tsx` | `/mentor/custom-request/dashboard` | `mentor-cr-dashboard` |
| 16 | `app/(mentor)/mentor/custom-request/posts/page.tsx` | `/mentor/custom-request/posts` | `mentor-cr-posts` 새 의뢰/제안한 의뢰 |
| 17 | `app/(mentor)/mentor/custom-request/posts/[postId]/page.tsx` | `/mentor/custom-request/posts/[postId]` | `mentor-cr-post-detail` |
| 18 | `app/(mentor)/mentor/custom-request/posts/[postId]/apply/page.tsx` | `/mentor/custom-request/posts/[postId]/apply` | `mentor-cr-apply` 제안서 제출 |
| 19 | `app/(mentor)/mentor/custom-request/orders/page.tsx` | `/mentor/custom-request/orders` | `mentor-cr-orders` 수락된 의뢰 |
| 20 | `app/(mentor)/mentor/custom-request/orders/[orderId]/page.tsx` | `/mentor/custom-request/orders/[orderId]` | redirect 스텁 → 공용 주문방 |
| 21 | `app/(mentor)/mentor/custom-request/orders/[orderId]/room/page.tsx` | `…/room` | redirect 스텁 → 공용 주문방 |
| 22 | `app/(mentor)/mentor/custom-request/orders/[orderId]/files/page.tsx` | `…/files` | redirect 스텁(화면 은퇴) → 공용 주문방 |
| 23 | `app/(mentor)/mentor/custom-request/orders/[orderId]/revision/page.tsx` | `…/revision` | redirect 스텁(화면 은퇴) → 공용 주문방 |
| 24 | `app/(mentor)/mentor/custom-request/orders/[orderId]/waiting-review/page.tsx` | `…/waiting-review` | redirect 스텁(화면 은퇴) → 공용 주문방 |

컴포넌트 전수 범위: `components/customRequest/` 46개 + `components/customRequest/order/` 10개(총 56 파일). 연결 lib: `lib/customRequest/*`(orderLifecycleConstants 상태 라벨맵 등 — 본 리포트에서 소스 수정 없음).

---

## 화면별 상세

### /custom-request — 공개 의뢰 목록·허브 (`public-custom-request`)
**파일:** `app/(public)/custom-request/page.tsx` · **접근:** 공개(requireRole 없음, `getServerUserWithProfile`로 로그인·역할 조회해 CTA/링크만 분기) · **게이트:** `!isCustomRequestFeatureEnabled()`이면 「곧 오픈 예정」 배너 추가 렌더(본문 유지)

맞춤의뢰 서비스의 공개 랜딩 겸 진입 허브. 히어로·이용순서·분야·최근 의뢰 3건·전환 CTA·신뢰 배너로 서비스를 소개하고, 역할(학생/멘토/비로그인)에 맞는 다음 경로로 분기시킨다.

| 요소 (표시 라벨) | 종류 | 소스 | 연결 동작 | 추론한 존재 목적 |
|---|---|---|---|---|
| 「학생 로그인」 | 버튼(CTA) | PageScaffold `ctas` — `!isLoggedIn`일 때만 | `/login/student?next=/custom-request` | 비로그인 방문자 로그인 유도 |
| 「맞춤의뢰는 곧 오픈 예정이에요」 / 「지금은 준비 중이라 새 의뢰 등록이 잠시 제한돼요. 이미 진행 중인 주문은 그대로 이용할 수 있어요.」 | 배너 | 게이트 `!isCustomRequestFeatureEnabled()` | 정적 안내 | 출시 준비 중 고지 — 직접 접근자에게 제한 안내 |
| CustomRequestHero | 히어로 | `role` 전달 | 하위 CTA(아래 표) | 핵심 가치·전환 유도 |
| CustomRequestSteps 「맞춤의뢰, 이렇게 진행돼요」 | 스텝퍼(정적) | 정적 4단계 | 없음 | 이용 흐름 사전 학습 |
| CustomRequestCategoryGrid 「어떤 도움이 필요하신가요?」 | 카드 그리드 | `loadCustomRequestCategories` | 없음(표시 전용) | 취급 분야 전시 |
| CustomRequestPostListTable 「최근 등록된 맞춤의뢰」 | 표 | `loadRecentCustomRequestPosts(supabase, 3)` | 행 제목 → 상세 링크 | 실거래 노출로 신뢰·활성도 전시 |
| 「지금 바로 멘토에게 의뢰해 보세요」 / 「요청을 올리면 멘토들이 제안을 보내드려요. 제안 비교는 무료예요.」 | 배너(다크 CTA) | 정적 | — | 하단 전환 카피(비교 무료 소구) |
| 「의뢰 요청 등록하기」(학생·비로그인) / 「내 진행 의뢰 보기」(멘토) | 버튼 | `isMentor` 분기 | 멘토→`/mentor/custom-request/dashboard`, 그 외→`/custom-request/new` | 역할별 핵심 액션 진입 |
| CustomRequestTrustBanner 「안전하고 올바른 학습 문화를 함께 만들어요」 | 배너 | 정적 | 없음 | 정책·신뢰 고지(아래) |
| 「내 진행 의뢰 대시보드 보기」·「새 의뢰 목록 보기」 | 링크 | `isMentor` 참 분기 | `/mentor/custom-request/dashboard`·`/mentor/custom-request/posts` | 멘토 워크스페이스 진입 |
| 「진행 중인 주문 보기」·「내 의뢰 목록」·「의뢰 요청 등록으로 이동」 | 링크 | 비멘토 분기 | `/custom-request/orders`·`/custom-request/posts`·`/custom-request/new` | 학생 3대 목적지 노출 |

**CustomRequestHero 내부** (`isMentor = role==="mentor"` 분기):

| 요소 (표시 라벨) | 종류 | 소스 | 연결 동작 | 추론한 존재 목적 |
|---|---|---|---|---|
| 「맞춤의뢰」(eyebrow) / 「전문 멘토에게 의뢰하세요」(h1) | 텍스트 | 정적 | — | 헤드라인 |
| 「현직 대학생 멘토의 제안을 받아 골라보세요.」(모바일) / 「요청을 올리면 검증된 현직 대학생 멘토들이 제안을 보내요…」(데스크톱) | 텍스트 | 정적(반응형 분기) | — | 서비스 요약 |
| 「검증된 현직 대학생 멘토」·「여러 제안을 비교하고 직접 선택」·「안전한 에스크로 결제·분쟁 보호」 | 텍스트(체크 3종) | 정적 | — | 3대 강점: 검증·비교·에스크로 |
| 「의뢰 요청 등록하기」/「내 진행 의뢰 보기」 | 버튼(primary) | isMentor 분기 | new / mentor dashboard | 주 전환 |
| 「내 진행 의뢰 보기」/「새 의뢰 목록 보기」 | 버튼(ghost) | isMentor 분기 | orders / mentor posts | 보조 전환 |
| 「받은 제안」·「멘토 3명」·「수학 내신 대비 코치」·「예산 50,000캐시」·「김O준 멘토」 외 목업 카드 | 카드(정적 목업) | 하드코딩 | 없음 | 제안 비교 UX 미리보기(실데이터 아님) |

**CustomRequestCategoryGrid 내부:** 「분야 선택」/「어떤 도움이 필요하신가요?」/「가까운 분야를 골라 의뢰를 등록해 주세요.」 섹션 헤드 + 분야 카드(「수학」·「영어」·「국어」·「과학」·「사회」·「기타」 — DB `CustomCategoryRow` 있으면 우선, 없으면 `SUBJECT_CATEGORIES` 폴백, N개 반복). 링크 없는 표시 전용 카드 — 취급 분야 전시가 목적.

**CustomRequestPostListTable 내부:**

| 요소 (표시 라벨) | 종류 | 소스 | 연결 동작 | 추론한 존재 목적 |
|---|---|---|---|---|
| 「최근 등록된 맞춤의뢰」 / 「다른 학생들이 등록한 맞춤의뢰 목록입니다.」 | 텍스트 | 정적 | — | 섹션 안내 |
| 「맞춤의뢰를 불러오지 못했어요」 | 오류 상태 | `list.error && !rows.length` | — | 로드 실패 안내 |
| 「모집 중인 맞춤의뢰가 아직 없습니다.」 | 빈 상태 | `!list.rows.length` | — | 데이터 없음 안내 |
| 표 헤더 「카테고리」·「제목」·「예산」·「마감일」·「지원 현황」·「상태」 | 표 | 정적 | — | 비교 열 정의 |
| 의뢰 행 | 표 행(N개 반복) | `mapPostRowToPublicDetail(r)` | 제목 → `/custom-request/{id}` | 상세 진입 |
| 예산(없으면 「확인 중」)·마감(「—」)·「{n}명 지원」 | 텍스트 | `applicationCountLabel` 등 | — | 조건·경쟁도 표시 |
| 상태 배지 | 배지 | `mentorPostStatusToken`→`mentorPostStatusLabelForUi` | — | 모집 상태 |

**CustomRequestTrustBanner 내부:** 「안전·신뢰」/「안전하고 올바른 학습 문화를 함께 만들어요」 + 리스트 「제출용 과제·보고서·논문 등의 작성 대행은 제공하지 않아요.」·「부정행위·표절·복사/붙여넣기 제출을 유도하는 요청은 허용하지 않아요.」·「모든 상담과 거래는 플랫폼 내에서 안전하게 이루어집니다.」 — 정적, 대필 금지(첨삭·코칭 범위) 정책의 공개면 고지.

---

### /custom-request/[postId] — 공개 의뢰 상세 (`public-cr-post-detail`)
**파일:** `app/(public)/custom-request/[postId]/page.tsx` + `loading.tsx` · **접근:** 공개 열람(비로그인 가능). draft는 작성자 본인만 `/custom-request/new?draftId=`로 편집 리다이렉트, 그 외 `notFound()`. 첨부 열람은 로그인 + 멘토/관리자/작성자 학생 한정 · **게이트:** 라우트 내 게이트 분기 없음(네비 숨김만 — §0)

특정 의뢰 게시글의 공개 상세. 의뢰 내용·조건·첨부·진행단계를 보여 주고, 멘토에게는 지원 폼, 작성 학생에게는 받은 제안 배너를 노출한다.

| 요소 (표시 라벨) | 종류 | 소스 | 연결 동작 | 추론한 존재 목적 |
|---|---|---|---|---|
| 「의뢰를 열 수 없어요」 / 「요청하신 맞춤의뢰를 불러오지 못했어요…」 + 「맞춤의뢰」 CTA | 오류 화면 | `post.error && !post.row` | → `/custom-request` | 로드 실패 복귀 |
| 「지금은 볼 수 없는 의뢰예요」 / 「비공개로 전환됐거나 모집이 끝난 의뢰일 수 있어요…」 + 「맞춤의뢰 홈으로」 | 안내 화면 | `!post.row \|\| !post.table` (404 대신 안내) | → `/custom-request` | 열람 불가의 부드러운 처리 |
| (초안 분기) | redirect/notFound | `isDraftCustomRequestPost(post.row)` — 작성자면 `/custom-request/new?draftId=`, 아니면 `notFound()` | — | 미공개 초안 보호 |
| 「지원이 제출되었어요.」 | 알림 | `searchParams.ok === "1"` | — | 멘토 지원 완료 피드백 |
| 오류 배너 | 알림 | `searchParams.error` → `mapDataErrorMessage` | — | 액션 실패 피드백 |
| 「목록/소개」·「멘토 찾기」 | 버튼 | 정적 | `/custom-request`·`/mentors` | 탐색 보조 |

**CustomRequestPublicPostBody 내부** (`profile.role`·`isAuthor`·`appCount`·`allowsApply` 분기):

| 요소 (표시 라벨) | 종류 | 소스 | 연결 동작 | 추론한 존재 목적 |
|---|---|---|---|---|
| CustomRequestLifecycleStepper 「등록」·「비교」·「선택」·「진행」·「완료」 | 스텝퍼(5단계) | `lifecycleStepFromPostRow(row)`, 완료 단계 `✓` | — | 의뢰 생애주기 위치 시각화 |
| 「{n}건」+「의 멘토 제안이 도착했어요.」 + 「제안 비교·선택하기」 | 배너+버튼 | 학생 작성자 & `appCount>0` | `/custom-request/{postId}/applications` | 비교 화면 유도(핵심 전환) |
| 제목·카테고리 배지·부제 | 텍스트/배지 | `mapPostRowToPublicDetail` | — | 의뢰 식별 |
| 「예산」/「마감일」/「상태」/「제출된 지원」 스트립 | 텍스트 | `d.budgetLine`·`d.deadline`·`d.status`·「{n}건」 | — | 핵심 조건 요약 |
| 「요청 내용」(hint 「희망 범위·세부 사항」) + 「결과물 형식」/「목표」 | 섹션 | `d.body`·`deliverableFormat`·`goal`(「—」 아니면 조건부) | — | 의뢰 본문 |
| 「첨부 파일」 + 「다운로드」(N개 반복) | 섹션/버튼 | `canViewAttachments` 참일 때만, `loadPostAttachments` | `downloadCustomRequestPostAttachmentAction`(form) | 자료 열람(권한자 한정 — 비공개 버킷) |
| 「첨부를 불러오지 못했어요…」 / 「등록된 첨부가 없어요.」 | 오류/빈 상태 | `loadError` / 0건 | — | 첨부 상태 안내 |
| 「이용 안내」: 「의뢰 등록은 학생 계정에서 진행돼요.」·「멘토가 제안을 내면 비교한 뒤 한 분을 골라 주문·진행으로 이어갈 수 있어요.」 | 리스트 | 정적 | — | 규칙 고지 |
| 「멘토 지원을 기다리고 있어요」 + 「지원 현황 화면 열기」 | 배너+버튼 | 학생 작성자 & `appCount===0` | applications | 제안 대기 안내 |
| 「이 의뢰에 지원해 보세요」 + MentorApplicationForm | 폼 | 멘토 & 비작성자 & `allowsApply`(`isMentorApplicablePostStatus`) | 제안 제출(멘토 §의 폼 표 참조) | 상세에서 바로 지원 |
| 「멘토 계정으로는 본인이 올린 의뢰에 지원할 수 없어요.」 | 알림 | 멘토 & 작성자 | — | 자기 지원 차단 |
| 「멘토로 로그인」+「하시면 지원을 제출할 수 있어요.」 | 링크 | 비로그인 | `/login/mentor?next=…` | 멘토 지원 유도 |
| 「지금은 새 지원을 받지 않는 단계예요. 모집이 끝났거나 조건이 맞지 않을 수 있어요.」 | 텍스트 | 멘토 & `!allowsApply` | — | 마감 안내 |

**loading.tsx:** 제목 `h-8 w-48` + 카드 `h-40`·`h-32` animate-pulse 스켈레톤 — 상세 로드 중 레이아웃 유지.

---

### /custom-request/orders — 학생 주문 목록 (`student-cr-orders`)
**파일:** `app/(public)/custom-request/orders/page.tsx` · **접근:** `requireRole("student")` · **게이트:** 라우트 내 분기 없음

학생이 자기 맞춤의뢰 주문(결제·진행·납품)을 상태 탭으로 훑고 주문방으로 진입하는 목록.

| 요소 (표시 라벨) | 종류 | 소스 | 연결 동작 | 추론한 존재 목적 |
|---|---|---|---|---|
| 「내 주문 내역」 / 「결제·진행·납품 중인 맞춤의뢰 주문을 한눈에 확인하고 작업방에서 멘토와 대화하세요.」 | 헤더 | 정적 | — | 화면 정의 |
| 「맞춤의뢰 홈」·「새 의뢰 등록」 | 버튼 | 정적 | `/custom-request`·`/custom-request/new` | 허브·재등록 |
| 「주문 목록을 불러오지 못했습니다. {error}」 | 알림 | `fetchStudentCustomRequestOrdersFromPrimaryTable` 오류 | — | 로드 실패 |
| 「진행 중인 주문이 없습니다.」 / 「의뢰를 올리고 멘토들의 제안서를 확인하여 작업을 시작해 보세요.」 + 「의뢰 요청하기」 | 빈 상태 | `enriched.length===0 && !error` | → new | 첫 주문 유도 |
| 탭 「전체」·「작업 대기」·「작업 진행 중」·「납품 검토」·「완료」(+카운트 배지) | 버튼(탭 5개 반복) | StudentCustomRequestOrdersBrowseClient `TABS`+`counts` | 클라이언트 필터 | 상태별 탐색 |
| 「해당 상태의 주문이 없습니다.」 | 빈 상태 | `filtered.length===0` | — | 탭 공백 안내 |
| 주문 카드(제목·상태 배지·멘토·등록일·결제 상태·금액) | 카드(N개 반복) | `enrichStudentCustomOrderListRows` | — | 주문 요약 |
| 상태 배지 — 분쟁 시 「분쟁 접수 · 운영 검토 중」(danger·빨강 좌측 바) | 배지 | `fetchActiveOpenDisputeOrderIdSet` 반영 | — | 분쟁 시각 경고 |
| 「작업방 열기 →」 | 링크 | `card.workroomHref` | `/custom-request/orders/{orderId}` | 주문방 진입 |

**탭 분류 정본** (`lib/customRequest/studentOrderBrowseTabClassify.ts`): 분쟁 최우선(`disputeIds` 포함 시 dispute — 별도 탭 없이 카드 위험 스타일로만 표현) → `orderStatusLabelForUi` 라벨 기준 「완료」/「종료됨」→done, 「납품 대기」→review, 「작업 중」/「수정 요청」→work, 「작업 대기」/「수락됨」→waiting, 그 외 work. 조회는 `custom_request_orders` 단일 테이블 — 학생 FK 후보(`student_id/buyer_id/user_id/…`) OR 필터 후 `canAccessOrder`로 재검증.

---

### /custom-request/orders/[orderId] — 주문방 라우트 래퍼 (`cr-order-room`)
**파일:** `app/(public)/custom-request/orders/[orderId]/page.tsx` + `loading.tsx` · **접근:** 로그인 필수(`!user`→`/login?next=…`), 역할 student/mentor/admin 외 `getPostLoginPath(role)` redirect, 최종 판정은 `canAccessOrder`(당사자) · **게이트:** 라우트 내 분기 없음

학생·멘토가 **동일 URL을 공유**하는 주문방의 래퍼. 데이터 로드·접근 제어·역할별 뷰 결정만 하고 UI는 `OrderRoomView`에 위임한다(내부 전수는 아래 「주문방」 장).

로드 파이프라인: `loadOrderBundle` → `canAccessOrder` → 통과 시 `loadOrderDetailPageData`; **학생이면 `hideStudentPreCompletionDeliverableStoragePaths`로 완료 전 납품 storage 경로를 서버에서 선제 마스킹**(잠금의 1차 방어). 멘토면 `pickOrderStudentId`+`fetchMentorStudentDisplayName`으로 학생 표시명 주입, `getMentorStartDisabledByMissingOrderDdl()`로 스키마 게이트 사유 전달.

| 요소 (표시 라벨) | 종류 | 소스 | 연결 동작 | 추론한 존재 목적 |
|---|---|---|---|---|
| (redirect) 로그인/역할 | redirect | `!user` / 비대상 역할 | login / post-login 경로 | 비인가 차단 |
| 오류·성공 배너 | 알림 | `searchParams.error`(→`mapDataErrorMessage`) / `searchParams.ok` | — | 서버 액션 결과 피드백(redirect 왕복 패턴) |
| eyebrow 「멘토 · 맞춤의뢰」/「주문방」, title 「주문·작업방」/「주문·납품」 | 헤더 | `isMentor` 분기 | — | 역할별 맥락 |
| CTA 「맞춤의뢰 주문 목록」(멘토) / 「맞춤의뢰」·「내 주문 내역」(학생) | 버튼 | `isMentor` 분기 | 각 목록 | 목록 복귀 |
| OrderRoomView | 위임 | `roomBundle`·`detail`·`view`·`actorRole`·`accessDenied`·`mentorStudentDisplayName` 등 | 아래 장 | 주문방 본체 |

**loading.tsx:** 제목 `h-8 w-2/3` + 카드 `h-32`·`h-40`·`h-28` 스켈레톤.

---

### /custom-request/orders/[orderId]/review — redirect 스텁
**파일:** `app/(public)/custom-request/orders/[orderId]/review/page.tsx` · 무조건 `redirect(/custom-request/orders/{orderId})`. 납품 확인·수락·수정요청 진입점을 주문방으로 일원화한 뒤 남긴 구 URL 호환 라우트 — 렌더 요소 없음.

참고: 과거 이 화면의 본문이던 `CustomRequestOrderReviewPanel.tsx`는 현재 어떤 라우트에서도 렌더되지 않는 보존 컴포넌트다(내부: 「납품 확인」 헤더, 「납품 파일」 목록+다운로드 폼 N개 반복[`downloadCustomOrderDeliverableAction`], 「납품 수락 (완료)」[`acceptCustomOrderDeliverableAction`], 「수정 요청」 폼[`submitCustomOrderRevisionRequestAction`], 「분쟁 신청」 폼[`submitCustomOrderDisputeAction`], 「← 주문방으로」, 빈 상태 「등록된 납품이 없습니다.」).

---

### /custom-request/new — 의뢰 등록 (`student-cr-new`)
**파일:** `app/(student)/custom-request/new/page.tsx` (폼: `components/customRequest/CustomRequestNewForm.tsx`) · **접근:** `requireRole("student")` + `profile.role!=="student"`면 `/custom-request` redirect. `draftId` 있으면 `isAuthorOfPost`+`isDraftCustomRequestPost` 검증 실패 시 `/custom-request/posts` redirect · **게이트:** 라우트 내 분기 없음(§0 — 네비에서만 숨김)

학생이 카테고리·제목·본문·마감일·예산·첨부를 입력해 의뢰를 등록(또는 임시저장·이어쓰기)하는 작성 화면. 등록 성공 시 서버 액션이 `/custom-request/{id}/applications`로 보내 제안 수신 흐름을 개시한다.

| 요소 (표시 라벨) | 종류 | 소스 | 연결 동작 | 추론한 존재 목적 |
|---|---|---|---|---|
| 「의뢰 등록하기」 / 「맞춤의뢰 소개」 | 헤더/CTA | PageScaffold | 소개 → `/custom-request` | 맥락·복귀 |
| 오류 배너 | 배너 | `mapDataErrorMessage(sp.error)` | `error` 파라미터 시 | 액션 실패 사유 |
| 「의뢰 이어쓰기」/「의뢰 등록하기」(h2) | 헤더 | `draft?.id` 유무 | — | 신규/이어쓰기 구분 |
| CustomRequestFlowStepper(「카테고리」·「의뢰 내용」·「조건 설정」·「확인」, activeStep=1) | 스텝퍼 | 정적 | — | 작성 단계 안내 |
| CustomRequestPolicyNotice 「맞춤의뢰 운영 범위」 | 배너 | `md:block`(모바일 숨김) | — | 01 공용 사전 참조 — 대필·대행 금지 고지 |
| 「카테고리 선택」 칩(수학·영어·국어·과학·사회·기타) | 입력(6개 반복) | `CATEGORIES` | `setSelectedCat` + hidden `category` | 필수 분류 |
| 미선택 빨간 링 | 검증 표시 | `showIncomplete && !selectedCat` | — | 필수 누락 시각화 |
| 제목 「한 줄로 요약 (최대 100자)」 | 입력 | `subject` maxLength=100 | 「의뢰 제목을 입력해 주세요.」 | 필수 제목 |
| 의뢰 내용(placeholder 「어떤 도움이 필요한지 구체적으로 적어주세요.…」) + 「{n}/2000자」 | 입력(textarea)+카운터 | `body` rows=8 max 2000 | 「의뢰 내용을 입력해 주세요.」 | 필수 본문·분량 안내 |
| 「대필·완성 대행 의뢰는 등록할 수 없습니다」 | 배너(조건부) | `CUSTOM_REQUEST_BANNED_WARNING`, `bannedHit=findRestrictedPhraseInText(subject+body)` | bannedHit 시 렌더+제출 차단 — **단 `findRestrictedPhraseInText`는 항상 null 반환(차단 폐지)이므로 현행 코드에서 이 배너는 발동 불가(사문화)** [G2] | 금지어 경고 UI 잔존물 |
| 「참고 파일 첨부 (선택)」(PDF/PPT/DOCX/이미지 · 최대 N개 · 각 20MB) + 선택 파일 목록/「선택된 파일 없음」 | 입력(file)+리스트 | `postAttachmentFiles` multiple, `selectedFiles.map`(N개 반복) | — | 참고자료 첨부·확인 |
| 마감일 | 입력(date, required) | `deadline` | — | 필수 기한 |
| 예산 프리셋 칩(10,000~200,000 캐시, 5개 반복) / 「직접 입력」 / 「희망 예산 (캐시)」(placeholder 「예: 75,000」, 힌트 「1,000~200,000 캐시 · 멘토 제안 참고용」) | 입력 | `BUDGET_OPTIONS` + custom 모드 | hidden budgetMin/Max | 예산 제시(제안 참고값) |
| 「시험 부정·표절·대리·권리 침해를 요청하지 않겠습니다.」 | 체크(required) | `agreeProhibited` | 서버 검증 | 부정행위 방지 동의 |
| 「의뢰·주문 과정에서 외부로 연락처를 교환하지 않겠습니다.」 | 체크(required) | `agreeNoExternal` | 서버 검증 | 오프플랫폼 차단 동의 |
| 「아래 항목을 완성해 주세요:」 + 누락 목록 | 배너 | `showIncomplete && incompleteFields` | — | 필수 누락 안내 |
| 「임시저장」 | 버튼(submit) | `intent=draft` formNoValidate | `submitCustomRequestNew` → status=draft, `/custom-request/posts?draft=1` | 초안 보관 |
| 「의뢰 등록하기」/「등록 중…」 | 버튼(submit) | `intent=submit`, `disabled=!canSubmit` | `submitCustomRequestNew` → `insertCustomRequestPost`(open)+첨부 업로드 → applications redirect | 정식 등록·매칭 개시 |
| 「요청 작성 팁」(마감·분량·자료 / 학년·과목·단원 / 대필·완성 대행 표현 거절) | 카드 | 정적 aside | — | 품질 좋은 의뢰 유도 |

---

### /custom-request/posts — 내 의뢰 목록 (`student-cr-posts`)
**파일:** `app/(student)/custom-request/posts/page.tsx` (리스트: `CustomRequestStudentPostsList.tsx`) · **접근:** `user` 없으면 `/login/student?next=…`, `role==="mentor"`면 `/mentor/custom-request/posts` redirect; 소유 필터는 `loadStudentCustomRequestPosts(supabase, user.id, 50)` · **게이트:** 라우트 내 분기 없음

학생이 자신이 올린 의뢰를 상태 탭(임시저장~완료)으로 관리하는 허브 — 초안은 이어쓰기/삭제, 정식글은 제안 비교로 진입.

| 요소 (표시 라벨) | 종류 | 소스 | 연결 동작 | 추론한 존재 목적 |
|---|---|---|---|---|
| 「내 의뢰 목록」 / 「의뢰하기」·「메인」 | 헤더/CTA | 정적 | new·`/custom-request` | 맥락·신규 |
| 오류 배너 / 「임시저장 글을 삭제했어요.」 | 배너 | `sp.error` / `sp.deleted==="1"` | — | 액션 피드백 |
| 「아직 등록한 의뢰가 없어요」 + 「첫 의뢰 등록하기」 | 빈 상태 | `rows.length===0` | → new | 최초 작성 유도 |
| 탭 「전체」·「임시저장」·「지원대기」·「진행중」·「완료」 | 버튼(5개 반복) | `studentPostStatusBucket` | `setFilter` | 상태별 필터 |
| 「해당 상태의 의뢰가 없습니다.」 | 빈 상태 | `filtered.length===0` | — | 필터 공백 |
| 임시글 카드(「제목 없는 임시글」 폴백 + 「저장 {시각}」 배지) | 카드(N개 반복) | `isDraftStudentPost(r)` 분기 | — | 초안 식별 |
| 「이어서 작성」 | 링크 | 임시글 | `/custom-request/new?draftId={id}` | 초안 재개 |
| 「삭제」 | 버튼(submit) | `deleteCustomRequestDraftAction`(소유자·draft 검증) | 삭제 후 `?draft=1&deleted=1` | 초안 정리 |
| 정식글 카드(카테고리·상태 배지 + 본문 2줄 미리보기) | 링크 카드(N개 반복) | else 분기 | 전체 클릭 → `/custom-request/{id}/applications` | 제안 비교 진입 |
| 「마감 {D-day}」(임박 시 빨강)·예산·「지원 {n}명」 | 배지 | `formatDeadlineDday`·`formatBudgetRangeCash`·`applicationCountFromRow` | — | 조건·경쟁도 요약 |
| 「이전」/「{page} · {total}」/「다음」 | 페이지네이션 | `totalPages>1`(모바일 5/데스크톱 10) | `setPage` | 분할 열람 |

---

### /custom-request/[postId]/applications — 제안 비교·선택 (`student-cr-compare`)
**파일:** `app/(student)/custom-request/[postId]/applications/page.tsx` + `loading.tsx` (뷰: `ApplicationsCompareView.tsx`, 0건 폴백 겸용) · **접근:** `requireRole("student")` + `isAuthorOfPost` — 비작성자는 화면 내 차단 배너. 작성자+draft면 new로 redirect. `force-dynamic` · **게이트:** 라우트 내 분기 없음

채널 3의 의사결정 핵심 화면 — 멘토 제안들을 **가격·납기·내용·포트폴리오(첨부)** 4축으로 비교해 1명을 선택하면 에스크로 주문으로 이어진다. 지원 0건이면 동일 화면에서 대기 폴백 렌더(구 waiting 라우트 통합).

| 요소 (표시 라벨) | 종류 | 소스 | 연결 동작 | 추론한 존재 목적 |
|---|---|---|---|---|
| 스켈레톤(h-8 + h-40) | 스켈레톤 | loading.tsx | — | 로딩 자리 |
| 「처리에 문제가 있었어요. 잠시 후…」 | 배너 | `searchParams.error` | — | 액션 실패 |
| 「이 맞춤의뢰는 작성자(의뢰하신 본인)만 비교·선정 화면을 열 수 있어요.」 | 배너 | `!authz.ok` | — | 소유자 통제 |
| 요청 요약 스트립(요약·예산·마감일·「지원 {n}건」 + 「요청 상세 보기」) | 카드 | `PostRequestSummaryStrip` | → `/custom-request/{postId}` | 비교 중 의뢰 맥락 고정 |
| CustomRequestLifecycleStepper(active=「비교」) | 스텝퍼 | `CustomRequestStepperShell` | — | 생애주기 위치 |
| 「지원서를 불러오지 못했어요」 | 오류 상태 | `list.error && !rows.length` | — | 조회 실패 |
| 「멘토 지원 대기」 / 「제안이 들어오면 여기서 비교·선택…」 + 지원 「0건」 + 「요청 내용으로 돌아가기」 | 빈 상태 카드 | `!list.rows.length` | → 상세 | 0건 대기 폴백 |
| 「멘토 지원서 목록」 / 「제안 가격·기간·내용을 비교하고 선택해 주세요.」 | 헤더 | 정상 분기 | — | 비교 목적 명시 |
| 「이미 이 의뢰에 대한 주문이 있어요.」 + 「주문 화면으로 이동」 | 배너 | `existingOrderId` 존재 | → `/custom-request/orders/{orderId}` | 중복 주문 방지·회귀 |
| 멘토 카드(아바타·이름·「인증」 배지·지원 상태) | 카드(N개 반복) | `enriched.map`, `formatApplicationStatusForStudent` | 이름/아바타 → `/mentors/{id}` 새 탭 | **비교축 0: 제안자 신원·검증** |
| 학교 라인(university · department) | 텍스트 | `e.display` | — | 멘토 배경 판단 근거 |
| `formatApplicationPriceKrwDisplay` / 「예상 {기간}」 | 배지 | 지원 row | — | **비교축 1·2: 제안가·납기** |
| 제안 미리보기(2줄, `maskContactInText` 적용) | 텍스트 | `getApplicationTextBlocksForCompare` | — | **비교축 3: 제안 내용**(연락처 마스킹) |
| 「포트폴리오·참고 파일」 | 첨부 리스트 | `allowPreview=Boolean(existingOrderId)`, `maskFilenames=!existingOrderId` | 아래 하위 표 | **비교축 4: 포트폴리오** — 선정 전 파일명 마스킹·미리보기 잠금, 선정(주문 존재) 후 해제 [G3] |
| 「연락처: {마스킹} (선정 전 비공개)」 | 텍스트 | `maskRowContact` | — | 선정 전 연락처 차단 |
| 「이 멘토 선택」 | 버튼 | `!existingOrderId && applicationId` | SelectMentorApplicationForm 모달 → `selectMentorApplicationForOrder` | 선정→에스크로 주문 생성 트리거 |
| 「선택 불가」 | 버튼(disabled) | `applicationId` 결측 | — | 데이터 이상 시 차단 |
| 「한 분을 고르면 주문 화면으로 이어져요.」 | 배너 | `!existingOrderId` | — | 다음 단계 예고 |

**첨부 하위**(ApplicationAttachmentsCompareList → ApplicationAttachmentFileListClient → CustomRequestApplicationFileChip / ApplicationAttachmentLightbox):

| 요소 (표시 라벨) | 종류 | 소스 | 연결 동작 | 추론한 존재 목적 |
|---|---|---|---|---|
| 「포트폴리오·참고 파일」 헤더 | 라벨 | 0건이면 미렌더 | — | 그룹 라벨 |
| 파일 칩(파일명·크기·확장자 썸네일) | 카드(N개 반복) | `attachments.map` | 이미지+`allowPreview`+썸네일 → 라이트박스 | 첨부 열람 |
| 「{filename} 크게 보기」 | 버튼 | `allowPreview && isImage && thumbUrl` | `getApplicationAttachmentPreviewUrlAction` | 이미지 확대 |
| 「선택 후 확인 가능」 | 배지 | `!allowPreview`(선정 전) | — | **선정 전 열람 잠금 표시** |
| 「미리보기」 | 버튼 | `allowPreview && isPdf` | 서명 URL 새 탭(실패 「미리보기를 열 수 없어요.」) | PDF 열람 |
| 라이트박스(「{filename} 미리보기」·「닫기」·「불러오는 중…」) | 모달 | createPortal, Escape/오버레이 닫기 | — | 확대 열람 |

**서버 강제:** `resolveApplicationAttachmentSignedUrl`이 `assertStudentCanPreviewAfterSelection`으로 작성자 학생에게는 **주문(선정) 존재 시에만** 서명 URL 발급 — 미선정 시 「첨부 파일은 멘토 선택 후 확인할 수 있어요.」 redirect. UI 잠금과 서버 검증의 이중 구조.

**SelectMentorApplicationForm:** 「이 멘토 선택」 클릭 → 확인 단계 → `selectMentorApplicationForOrder` 서버 액션 호출(hidden postId·applicationId). 액션이 `insertCustomRequestOrder`(p1: `status`/`state`=pending, `order_status`=open, `payment_status`=unpaid)를 만들고 결제(에스크로 예치) 흐름으로 잇는다.

---

### /custom-request/[postId]/applications/waiting — redirect 스텁
**파일:** `app/(student)/custom-request/[postId]/applications/waiting/page.tsx` · 즉시 `redirect(/custom-request/{postId}/applications)`. 대기/비교 화면이 통합된 뒤 기존 딥링크·알림 호환용으로 남은 라우트 — 자체 UI 없음.

참고(보존 뷰): 구 대기 화면 `CustomRequestApplicationsWaitingView`에는 「멘토 지원 대기」 헤더, 지원 현황 「{n} / 최대 {max}명」, `WaitingCountdown` 마감 카운트다운(일/시간/분/초, `deadlineIso` null이면 「마감일 정보가 없어요.」), 「새로운 지원 알림 설정하기」, 「아직 지원한 멘토가 없어요」 빈 상태, 별점 표시, 「연락처는 선택 후에만 확인할 수 있어요」, 「마감일 자정 이후에는 지원이 마감되며…」 안내가 있다. 현행 applications 페이지는 이 뷰에 `deadlineIso: null`·`applications: []`를 넘겨 비활성 폴백으로만 쓴다.

---

### /custom-request/orders/[orderId]/complete — 주문 완료 (`student-cr-complete`)
**파일:** `app/(student)/custom-request/orders/[orderId]/complete/page.tsx` (뷰: `CustomRequestOrderCompleteView.tsx`) · **접근:** `requireRole("student")` + `canAccessOrder` 실패 시 `/custom-request/orders/{orderId}?error=접근 권한이 없습니다.` redirect · **게이트:** 라우트 내 분기 없음

완료 주문의 결과(멘토·최종 금액·완료일)와 납품 파일·결제 내역을 확인하고 후속 행동(후기·재의뢰·질문방)으로 잇는 종결 화면.

※ 유사 이름의 `order/StudentOrderCompleteView.tsx`(별개 컴포넌트)는 이 라우트가 아니라 **주문방(OrderRoomView.tsx:382)이 학생 뷰·종결 상태에서 조기 반환**하는 완료 화면이다 — 아래 주문방 장에서 전수.

| 요소 (표시 라벨) | 종류 | 소스 | 연결 동작 | 추론한 존재 목적 |
|---|---|---|---|---|
| 「주문 완료」 / 「맞춤의뢰」·「주문방」 | 헤더/CTA | PageScaffold | 주문방 → orders/[orderId] | 맥락·회귀 |
| CircleCheck + 「주문이 완료되었습니다」 | 배너 | 정적 | — | 완료 확정 |
| 「완료 일시 · {completedAtLabel}」 | 배지 | `formatOrderRoomDateTime(completed_at…)` | — | 완료 시각 |
| 주문 요약(선택 멘토·요청 제목·최종 금액(accent)·완료일·마감일) | 표(dl) | `pickAmountLabel`·`computeDurationLabel` 등 | — | 결과 핵심 요약 |
| 「납품 파일」(파일명·크기) + 「다운로드」 | 카드+버튼(submit) | `deliverable.downloadable` 참일 때 form | `downloadCustomOrderDeliverableAction` | 산출물 수령(완료 후라 잠금 해제) |
| 「파일 준비 중이에요.」 / 「등록된 납품 파일이 없어요.」 | 안내/빈 상태 | `!downloadable` / `deliverable==null` | — | 파일 상태 안내 |
| 결제 정보(결제 금액·지급 완료 일시) | 표(dl) | `paid_at ?? completed_at` | — | 학생 관점 영수증(수수료 미표기) |
| 「결제 영수증 보기」 | 버튼 | 핸들러 없음(정적) | — | 영수증 열람 진입(추정 — 미배선) |
| 「이용 후기 작성하기」 | 버튼/링크 | `review.eligible`(`checkReviewEligibility`) | eligible → `/mentors/{id}#reviews`, 아니면 disabled+tooltip(동일 멘토 2회 이용 조건) | 후기 유도 — 리뷰 자격 정책 연동 |
| 「다른 맞춤의뢰 진행하기」 / 「질문방 이용하기」 | 링크 | 정적 | `/custom-request`·`/question-room` | 재이용·교차 유입 |

---

## 멘토 라우트 그룹

> **게이트 실측:** 멘토 CR 라우트 11개 중 어디에도 `isCustomRequestFeatureEnabled` 참조가 없다 — 접근 제어는 `requireRole("mentor")`(redirect 스텁 제외 전 페이지)뿐이고, OFF의 효과는 멘토 네비에서 항목이 숨는 것뿐이다(§0). 별개로 서버 액션 레벨에는 **스키마 게이트** `isCustomRequestOrderStatusDdlInRepo()`(주문 상태 DDL 부재 시 `MENTOR_START_SCHEMA_GATE_MESSAGE`로 차단)가 있다.

### /mentor/custom-request — 루트 디스패처
**파일:** `app/(mentor)/mentor/custom-request/page.tsx` · 즉시 `redirect(/mentor/custom-request/dashboard)`. 대표 URL만 기억한 멘토를 대시보드에 착지시키는 5줄 디스패처 — 표 생략.

### /mentor/custom-request/dashboard — 멘토 CR 대시보드 (`mentor-cr-dashboard`)
**파일:** `app/(mentor)/mentor/custom-request/dashboard/page.tsx` · **접근:** `requireRole("mentor")` · `force-dynamic`

멘토의 CR 활동(할 일·수익·진행)을 집약하는 워크스페이스 홈. 최근 지원·주문·카운트·정산 번들·프로필·활성 분쟁을 병렬 로드해 `MentorCustomRequestDashboardView`에 위임하고, `MentorCustomRequestWorkspaceLayout(active="dashboard", showAuxCards)` 셸로 감싼다.

**MentorCustomRequestWorkspaceLayout / MentorCustomRequestSubNav** (dashboard·posts·orders 3화면 공유 셸):

| 요소 (표시 라벨) | 종류 | 소스 | 연결 동작 | 추론한 존재 목적 |
|---|---|---|---|---|
| 「대시보드」·「새 의뢰 목록」·「제안한 의뢰」·「수락된 의뢰」 | 모바일 탭(4개 반복) | 하드코딩(tone=green) | 각 라우트, active 강조 | 모바일 워크스페이스 네비 |
| 「맞춤의뢰 (멘토용)」 | 헤더 | 정적 | — | 네비 타이틀 |
| 「대시보드」·「새 의뢰 목록」·「제안한 의뢰」·「수락된 의뢰」·「의뢰 가이드」 | 사이드 링크(5개 반복) | navItems, 활성 초록 `#059669` | 각 href(가이드는 `/legal/no-offplatform-contact`) | 데스크톱 상시 네비 + 오프플랫폼 정책 노출 |
| 배지 숫자 | 배지 | `counts[badgeKey]`(open·applied·ordersTotal), `count>0`일 때 | — | 미처리 건수 신호 |
| 「멘토 가이드」 + 「운영 정책 안내」 | 카드(showAuxCards=대시보드 전용) | 정적 | `/legal/no-ghostwriting` | 대필 금지 정책 재확인 |
| 「도움이 필요하신가요?」 + 「알림 센터」 | 카드(동상) | 정적 | `/notifications` | 문의·알림 진입 |

**MentorCustomRequestDashboardView 본문:**

| 요소 (표시 라벨) | 종류 | 소스 | 연결 동작 | 추론한 존재 목적 |
|---|---|---|---|---|
| 「맞춤의뢰 대시보드」 / 「할 일 · 수익 · 진행 현황을 한눈에 확인하세요.」 | 헤더 | 정적 | — | 화면 정의 |
| KPI 「새 의뢰」 | KPI 카드 | `openPoolCount` | — | 지원 가능 신규 풀 |
| KPI 「제안한 의뢰」 | KPI 카드 | `appliedCount` | — | 내 지원 대기 |
| KPI 「수락된 의뢰」 | KPI 카드 | `orderCount` | — | 수주 총량 |
| KPI 「납품 완료」(hint 「납품 대기 N건」 — `deliveryPendingCount>0` 시) | KPI 카드 | `doneCount` | — | 실적+검토 대기 알림 |
| KPI 「이번 달 수익」 + 「이번 달 예상 수익」(캐시, col-span-2) | KPI 카드(5장 `kpiCards.map` 반복) | `monthRevenueCash` | — | 월 수익 동기 부여 |
| 「할 일」 리전 — 「분쟁」 N건(danger) / 「수정 요청」 N건(amber) / 「마감 초과」 N건(danger) / 「마감 임박」 N건(orange) | 액션 링크(각 count>0 조건) | `dashboardCounts`·`todo` | orders(`?tab=work` 등) | 우선순위 큐 — 분쟁 최우선 |
| 「지금 처리할 일이 없어요」 + 「새 의뢰 둘러보기」 | 빈 상태 | `hasTodoItems===false` — 01 공용 사전 참조 | → posts | 유휴 시 탐색 유도 |
| 「안내 사항 · 펼치기」(작업 전 소통/마감 전 납품/3일 내 정산, 3개 반복) | 접이식 | 정적 | — | 운영 유의사항 |
| 「수익」 리전 — 「진행 중 정산」/「완료(정산 예정)」 | 스탯 행 | `expectedSettlementCash`/`paidSettlementCash`(캐시) | — | 정산 단계별 금액 — "정산 예정" 표기 통일 |
| 「정산 내역이 아직 없어요…」 | 대체 문구 | breakdown 없음 | — | 빈 정산 |
| 「정산/수익 관리 →」 | 링크 | 정적 | `/mentor/payouts` | 정산 상세 |
| 「나의 평점」 N.N / 5 + 「리뷰 N개 →」 | 카드 | `avgRating`·`reviewCount`(있을 때) | `/mentor/reviews` | 평판 지표 |
| 「진행 현황」 리전 — 「작업 대기」/「작업 진행 중」/「납품 대기」/「분쟁」(빨강)/「종료됨」 각 N건 | 스탯 행 | `billingCount`·`workCount`(revision 합산)·`deliveryPendingCount`·`disputeCount`·`doneCount` | — | 파이프라인 분포 |
| 「진행 중 의뢰 N」 + 활성 주문 행(제목·「학생 · D-day」·상태 배지) | 카드+리스트(`activeOrders.slice(0,4)` 최대 4개 반복) | order rows | `mentorCustomOrderWorkroomHref(id)` | 진행 주문 바로가기 |
| 「데이터를 불러올 수 없습니다.」 / 「진행 중인 의뢰가 없어요」 | 오류/빈 상태 | `ordersError` / 0건 | — | 상태 안내 |
| 「수락된 의뢰 전체 보기 →」 | 링크 | 정적 | → orders | 전체 목록 |

### /mentor/custom-request/posts — 새 의뢰 목록 / 제안한 의뢰 (`mentor-cr-posts`)
**파일:** `app/(mentor)/mentor/custom-request/posts/page.tsx` · **접근:** `requireRole("mentor")`

공개 모집 의뢰 브라우즈(open 탭)와 내 제안 추적(applied 탭, `?tab=applied`)의 이중 화면. open 목록은 **이미 지원한 postId 제외**(`appliedPostIds.has(id)` 필터 — 의뢰당 1회 정책의 목록면 반영).

| 요소 (표시 라벨) | 종류 | 소스 | 연결 동작 | 추론한 존재 목적 |
|---|---|---|---|---|
| 「새 의뢰 목록」 / 「제안한 의뢰」 | 헤더(탭 분기) | `isApplied` | — | 탭별 화면명 |
| 「전체」·「공부·과제」·「진로·입시」·「자기소개서」·「기타」 + 건수 배지 | 카테고리 탭(5개 반복, open 전용) | `CATEGORY_TABS`·`categoryCounts` | `?cat=<id>` | 분류 필터 |
| 「전체는 노출 중인 모든 의뢰 수이고…」 | 안내 | 정적(데스크톱) | — | 카운트 의미 설명 |
| MentorOpenPostListSection | 위임(open 탭) | `categoryFilteredRows` | 아래 | 모집 카드 리스트 |
| 「제안한 의뢰」 + 건수 배지 + MentorAppliedListSection | 위임(applied 탭) | `applied.items` | 아래 | 지원 추적 |
| 「맞춤의뢰 소개 보기」 | 링크 | 정적 | `/custom-request` | 소개 회귀 |

**MentorOpenPostListSection:**

| 요소 (표시 라벨) | 종류 | 소스 | 연결 동작 | 추론한 존재 목적 |
|---|---|---|---|---|
| 「모집 목록을 잠시 불러올 수 없어요」 | 상태 카드 | `listStatus==="rpc_unavailable"` | — | RPC 폴백 |
| 「모집 중인 맞춤의뢰가 아직 없어요」 | 빈 상태 — 01 공용 사전 참조 | rows 0 | — | 빈 모집 |
| 의뢰 카드(분류칩·상태칩·시간(「방금 전」/「N분·시간·일 전」)·제목·요약·「예상 {budget}」(없으면 「예상 금액 협의」)·「마감 {deadline}」·「제안하기」) | 카드(`visibleRows.map` 반복 — 데스크톱 5/모바일 4) | `mapPostRowToPublicDetail` | 카드→`posts/{id}`, 제안하기→`posts/{id}/apply` | 수주 기회 카드·즉시 제안 진입 |
| 「이전」/「{현재}·{총}」/「다음」 | 페이지네이션 | `totalPages>1`(클라 slice) | — | 분할 열람 |

**MentorAppliedListSection:**

| 요소 (표시 라벨) | 종류 | 소스 | 연결 동작 | 추론한 존재 목적 |
|---|---|---|---|---|
| 「지원 이력을 불러오지 못했어요」 | 상태 카드 | `listFailed` | — | 실패 폴백 |
| 「아직 제출하신 제안서가 없습니다」 + 「새 의뢰 목록 보러가기」 | 빈 상태 — 01 공용 사전 참조 | 0건 | → posts | 탐색 유도 |
| 지원 카드(제목·「제안 날짜 · N시간 전」·상태 배지) | 카드(N개 반복, 2열) | `items.map` | 해당 의뢰 상세 | 지원 상태 추적 |
| 상태 배지(공백/「상태 확인 필요」→「제안서 제출됨」 폴백) | 배지 | `mentorApplicationStatusLabelForUi` | — | 매칭 진행 상태 |

> **미배선:** `MentorCustomRequestPostsFilterPanel.tsx`(「검색 및 필터」 — 키워드 검색·카테고리 5종·학교급 5종·희망 전공 select·「예상 금액 (캐시)」 최소/최대·마감일 select·「적용하기」/「초기화」)는 posts 페이지에서 import되지 않는 정적 UI(핸들러 없음). 실제 필터는 상단 카테고리 탭뿐. 상세 필터 화면의 사전 제작물로 추정.

### /mentor/custom-request/posts/[postId] — 의뢰 상세 (`mentor-cr-post-detail`)
**파일:** `app/(mentor)/mentor/custom-request/posts/[postId]/page.tsx` · **접근:** `requireRole("mentor")`, draft/미존재 `notFound()`

멘토가 제안 여부를 판단하는 의뢰 상세. post·이미 지원 여부(`mentorHasApplicationForPost`)·첨부·내 지원 첨부를 병렬 로드해 `MentorCustomRequestDetailCard`에 위임. `?submitted=1`이면 제출 완료 힌트.

| 요소 (표시 라벨) | 종류 | 소스 | 연결 동작 | 추론한 존재 목적 |
|---|---|---|---|---|
| 「멘토 / 맞춤의뢰 · 의뢰 목록」 | breadcrumb | 정적 | → posts | 경로 회귀 |
| 「지원서가 제출되었습니다…」 | 힌트 | `submitted` | — | 제출 피드백 |
| 제목·과목·카테고리 헤더 + 「예산」/「마감일」(D-day)/「등록일」 스트립 | 헤더/스트립 | `mapPostRowToPublicDetail`(값 있는 항목만) | — | 거래 조건 판단 |
| 「요청 내용」(+「결과물 형식」·「목표」 조건부) | 섹션 | `d.body` 등 | — | 작업 범위 파악 |
| 첨부 파일 섹션 | 표/버튼 | `PostAttachmentFileSection` | 다운로드 | 참고 자료 |
| 「이용 안내」(제안 1회 제한·선택 시 주문 연결) | 리스트 | 정적 | — | 규칙 고지 |
| 「이미 제안서를 제출했어요」 + 「첨부한 포트폴리오·참고 파일」 목록 + 「제안한 의뢰에서 상태 확인하기 →」 | 조건부 섹션 | `alreadyApplied` | `?tab=applied` | **1회 제한** 후속 안내 |
| 「지금은 이 의뢰에 제안할 수 없는 단계예요…」 | 경고 | `!canApply && !alreadyApplied`(`isMentorApplicablePostStatus`) | — | 모집 종료 안내 |
| 「목록으로 돌아가기」 / 「제안서 작성하기」 | 링크 | `canApply`일 때 후자 노출 | posts / apply | 회귀·제안 진입 |

### /mentor/custom-request/posts/[postId]/apply — 제안서 제출 (`mentor-cr-apply`)
**파일:** `app/(mentor)/mentor/custom-request/posts/[postId]/apply/page.tsx` · **접근:** `requireRole("mentor")`, draft/미존재 `notFound()`

제안가·납기·내용·포트폴리오를 입력하는 폼. `showForm = !already && open` — **이미 지원했거나 모집 불가 status면 폼 자체를 숨긴다**(1회 제한의 화면면).

| 요소 (표시 라벨) | 종류 | 소스 | 연결 동작 | 추론한 존재 목적 |
|---|---|---|---|---|
| 「지원서 작성」 + 「제안 가격·예상 납기·제안 내용을 입력해 주세요.」 | 헤더 | 정적 | — | 화면 목적 |
| 오류 alert | 배너 | `mapDataErrorMessage(err)` | — | 제출 실패 사유 |
| 「이미 이 의뢰에 제출하신 지원이 있습니다…」 | 경고 | `already` | — | 1회 제한 안내 |
| 「현재 지원할 수 없는 의뢰입니다…」 | 안내 | `!open && !already` | — | 모집 종료 |
| MentorPostReadonlySummary(「지원 대상 의뢰」·상태 배지·「희망 예산」·「희망 납기」·「희망 전공·분야」 — 각 조건부) | 요약 카드 | post.row | — | 제안 기준 확인 |
| **MentorApplicationForm** — 「제안 금액(캐시)」(number, 힌트 「희망 예산 {budget}」) / 「예상 납기(완료 예정일)」(date, 힌트 「희망 납기 {deadline}」) / 「제안 내용」(textarea, placeholder 「범위, 진행 방식…」) / 「추가 메모(선택)」 / 「포트폴리오·참고 파일 (선택)」(multiple, 「최대 N개·각 20MB·학생 비교 화면 표시」 힌트) + 선택 파일 목록(N개 반복)/「선택된 파일 없음」 | 폼 | props postSummary, hidden postId·returnContext | `submitMentorCustomRequestApplication` | **비교 4축 입력의 공급면** — 「제안가·납기·제안 내용은 의뢰자(학생)의 비교 화면에 표시돼요.」 고지 포함 |
| 「제출 후에는 동일 의뢰에 다시 제출할 수 없어요.」 | 텍스트 | 정적 | — | 1회 제한 재고지 |
| 「지원서 제출하기」/「제출 중…」 | 버튼(submit) | FormSubmitButton | 동상 액션 | 제안 확정 |

**서버 검증**(`submitMentorCustomRequestApplication`): `requireRole("mentor")` → `assertMentorApprovedForAction`(승인 멘토만) → 필수값 → `sanitizeTrustSafetyText`(연락처 마스킹 — 금지어 차단은 폐지 [G2]) → 첨부 MIME/매직바이트 검증 → `insertMentorApplication` — **의뢰당 1회는 선-중복조회 + DB unique(23505) 이중으로 `ALREADY_APPLIED` 차단**, 실패 메시지 「이미 이 의뢰에 제출하신 지원이 있습니다. 중복 제출은 할 수 없습니다.」 → 학생에게 `new_application` 알림.

### /mentor/custom-request/orders — 수락된 의뢰 (`mentor-cr-orders`)
**파일:** `app/(mentor)/mentor/custom-request/orders/page.tsx` · **접근:** `requireRole("mentor")`

수주(학생이 제안을 수락해 성사된 주문)를 단계 탭으로 관리하는 목록. 주문 최대 80건 + `enrichMentorDashboardOrderRows` 보강 + 활성 분쟁 세트 + `classifyMentorOrderBrowseTab` 집계 후 클라이언트에 위임. `?tab=`으로 초기 탭.

| 요소 (표시 라벨) | 종류 | 소스 | 연결 동작 | 추론한 존재 목적 |
|---|---|---|---|---|
| 「수락된 의뢰」 + 「의뢰자가 제안을 수락한 의뢰 목록입니다.」 | 헤더 | 정적 | — | 화면 정의 |
| 「주문 목록을 불러오지 못했습니다. {error}」 | 알림 | ordersResp.error | — | 로드 실패 |
| 「수락된 의뢰가 없습니다」 + 「새 의뢰 목록 보기」 | 빈 상태 — 01 공용 사전 참조 | 0건 | → posts | 수주 0 → 탐색 |
| 탭 「전체」·「작업 대기」·「작업 진행 중」·「납품 대기」·「종료됨」 + 건수 배지 | 탭(5개 반복) | `TABS`+`tabCounts`(**revision은 「작업 진행 중」에 합산**) | `setTab` | 단계별 관리 |
| 「이 단계에 해당하는 의뢰가 없어요」 + 「새 의뢰 보기」 | 빈 상태 — 01 공용 사전 참조 | filtered 0 | → posts | 탭 공백 |
| 주문 카드(제목·「{학생} · 수락 {날짜} · {결제라인}」·상태 배지, 분쟁 시 좌측 빨강 보더) | 카드(`paged.map` 반복 — 데스크톱 10/모바일 5) | `mentorCustomOrderDisplayTitle` 등 + `disputeSet` | `mentorCustomOrderWorkroomHref(id)`(=공용 주문방) | 수주 진입점·위험 신호 |
| 결제라인 색상 | 텍스트 톤 | `paymentLabelClassName` | — | 결제 상태 시각화 |
| 「이전」/「{현재} / {총}」/「다음」 | 페이지네이션 | `totalPages>1` | — | 분할 열람 |

**탭 분류 정본**(`lib/customRequest/mentorOrderBrowseTabClassify.ts`): ①분쟁 → dispute ②결제 미확정(`isOrderRowPaymentConfirmedForMentorWork` false) → billing(작업 대기 — **결제 확인 전에는 착수 불가**) ③종결 → done ④`revision_requested` → revision ⑤delivered/waiting_review 계열 → delivery ⑥그 외 work. `mentorCounts.ts`의 `fetchMentorWorkspaceCounts`가 open(이미 지원 제외)·applied·billing·work·delivery·revision·done·dispute·todo(마감 초과/임박)를 병렬 산출.

### /mentor/custom-request/orders/[orderId] · /room · /files · /revision · /waiting-review — redirect 스텁 4종
**파일:** 각 5~13줄 · **접근:** 가드 없음(리다이렉트 대상인 공용 주문방이 수행) · 모두 `redirect(/custom-request/orders/{orderId})`

| 라우트 | 존재 목적 |
|---|---|
| `orders/[orderId]` | 멘토 앱 경로 관습(`/mentor/...`) 호환 별칭 — 주문 상세 UI를 멘토 그룹에 중복 구현하지 않고 공용 주문방으로 일원화 |
| `orders/[orderId]/room` | 구 "멘토 작업방" URL 호환 — 실제 주문방은 (public) 공용 URL. OrderRoomView는 이 파일에서 import되지 않음 |
| `orders/[orderId]/files` | 구 "작업 파일" standalone 화면 은퇴 — 파일 업로드/재납품이 주문방 인라인 패널(OrderDeliverablesPanel)로 통합된 뒤 깨진 링크 방지용으로 잔존 |
| `orders/[orderId]/revision` | 구 "수정 요청" 화면 은퇴 — 주문방 수정요청 패널로 통합 |
| `orders/[orderId]/waiting-review` | 구 "납품 검토 대기" 화면 은퇴 — 주문방에서 단계 확인으로 통합 |

**보존 컴포넌트 3종(현재 어떤 라우트에서도 미배선 — 삭제 대신 보존):**
- `MentorOrderFilesView` — 「작업 파일」 + 「상태: {label} · 마감: {label}」, 진행 스텝퍼(주문 생성→작업 중→파일 업로드→학생 확인→완료 및 정산), 「파일을 드래그 앤 드롭…」+「파일 선택」(PDF/PPT/DOC/PNG/JPG/ZIP·최대 100MB → `uploadMentorOrderWorkFileAction`), 「업로드된 파일」 목록(N개 반복, 「최종본」/「검토 요청」 배지, `v{n} · {size} · {날짜}`), 「다운로드」(`downloadCustomOrderDeliverableAction`), 「미리보기」(비활성 title=「준비 중」 — (추정) 향후 기능), 「파일 업로드 가이드」, 「납품하기」(`markMentorOrderDeliveredForReviewAction`), 「작업방으로 돌아가기」.
- `MentorOrderRevisionView` — 「수정 요청」+D-day, 「학생이 수정을 요청했어요…」, 「수정 요청 내용」, 「이전 납품 파일」 목록(N개 반복), 「수정 가능 횟수」 「수정 {used}/{max}회 사용」, 「최대 수정 횟수를 초과했습니다.」, 「파일 업로드하고 재납품하기」(→주문방 `#deliverables` 앵커), 「의뢰 요약」·「빠른 메뉴」.
- `MentorOrderWaitingReviewView` — 「진행 단계」 스텝퍼(activeIndex=3), 「납품 대기」+「검토 대기」 배지, 「납품 파일」/「등록된 납품 파일이 없어요.」, 「학생 검토 기간」+`DeliveryReviewCountdown`(「{n}일 {hh}시간 {mm}분 남음」, null이면 「검토 기간 정보를 불러올 수 없어요.」), 「검토 기간 내 응답 없으면 자동 완료 처리됩니다.」, 「안내사항」(자동 정산 3영업일 등).
- 공용 `MentorOrderProgressStepper`(steps.map N개 반복, done=✓·current=accent) — 위 3뷰의 단계 표시기.

---

## 주문방 (OrderRoomView) — 섹션별 전수

`components/customRequest/OrderRoomView.tsx`(986줄). `props.view==="mentor"`면 `OrderRoomViewMentor`(초록 톤)로 완전 분기, `"student"`면 본체(파랑 톤). 자식 패널(`order/` 하위)과 가드 함수는 공유 — 가드 8종이 역할·view·주문 status·`payment_status`·활성 분쟁을 조합해 각 버튼의 `*DisabledReason: string|null`을 만들고, null이면 활성·문자열이면 비활성 사유가 된다. **학생 뷰는 종결 상태면 `StudentOrderCompleteView`로 조기 반환**(378–383행). 공통 진입 가드: `accessDenied` → 권한 안내 배너, 주문 row 없음 → 에러 문구, `detail` 없음 → null.

### 요약 헤더 / 상태 히어로 (OrderSummaryHeader.tsx 내 OrderRoomPageHeader 계열)

큰 상태 문장과 "지금 누구 차례"를 사람 말로 보여 주는 상단부. 학생=카드형 header, 멘토=breadcrumb+플랫 히어로.

| 요소 (표시 라벨) | 종류 | 소스 | 연결 동작 | 추론한 존재 목적 |
|---|---|---|---|---|
| 「맞춤의뢰 · {category}」(eyebrow) | 텍스트 | `detail.header.category` | — | 화면 정체성 |
| 상태 헤드라인(예 「멘토가 결과물을 보냈어요」) | 제목 | status별 `statusHero` 분기 | — | 상황을 문장으로 전달 |
| 상태 배지 — 분쟁 시 「운영팀 확인 중」 오버라이드 | 배지 | `inDispute ? "운영팀 확인 중" : orderStatusLabelForUi(norm)` | — | 표준 상태 표시 |
| 「{금액} 안전 보관 중」(멘토 종결 시 「정산 완료」) | 에스크로 pill | `detail.header.priceLine`+`heroTerminal` | — | **예치 중임을 상시 안심 신호로** |
| 「지금 내 차례예요」/「멘토를 기다리는 중」/「운영팀 확인 중」(멘토: +「학생을 기다리는 중」·「거래 종료」) | 차례 pill | `turn`/`heroTurn` 파생값 | — | 행동 주체(턴) 안내 |
| (멘토) 상태 아이콘 타일(분쟁=경고빨강·수정=연필주황·납품=전송초록·기본=서류가방) | 아이콘 | `heroIcon` 분기 | — | 상태 시각 앵커 |
| 학생판 페이지 타이틀 「5.주문 완료🎉」/「4.납품 확인·검토」/「주문방/납품」 | 헤더 | `isCompleted`/`isReview` 분기 | 뒤로가기 Link | 단계별 맥락 제목 |
| 정보 5열(요청 제목·선택된 멘토·제안 금액·예상 소요 기간(하드코딩 「2일」 [G5])·최종 마감일) | 표 | `detail.header` (「제안 금액」·「결제 금액」 모두 `priceLine` 동일 값 — (추정) 별도 컬럼 미도입 임시 표기) | — | 주문 핵심 정보 |
| 「요청 상세 보기」/「이용 후기 작성하기」 | 버튼(비활성) | `cursor-not-allowed` + title=「추후 연결 예정」 | 없음 | 향후 연결 예정 자리 |
| (멘토) breadcrumb + 의뢰 제목 | 헤더 | `backHref`·`requestTitle` | 뒤로가기 | 경로 표시(중복 타이틀 제거) |

### 진행 타임라인 / 스텝퍼

| 요소 (표시 라벨) | 종류 | 소스 | 연결 동작 | 추론한 존재 목적 |
|---|---|---|---|---|
| 5단계 「작업 대기」·「작업 중」·「납품 대기」·「수정 요청」·「완료」 | 스텝퍼 | `ORDER_ROOM_TIMELINE_STEPS.map()`(5개 반복) | — | 진행 위치 시각화 |
| 현재 단계 인덱스 | 계산값 | `orderWorkspaceCurrentStepIndex(norm, terminal, hasDeliverable)` — terminal→4, revision_requested→3, 납품·검토 계열/납품물 존재→2, open/in_progress→1, pending/unpaid→0 | — | status→단계 매핑 정본 |
| (학생, 분쟁 시) 「운영팀 확인 중」 + 「진행이 잠시 멈췄어요…」 | 배너 | `paused=inDispute`, 단계는 리셋하지 않고 유지 | — | 분쟁 중 "일시 정지" 표현 |
| (학생 사이드바) 단계별 날짜 + 「현재 단계」 배지 + 「실시간 흐름」 pulse | 타임라인 | `dateForStep`: `created_at`/`in_progress_at`/`delivered_at`/`revision_requested_at`/`completed_at` 후보 | — | 단계별 시각 기록 |
| (멘토 사이드바) OrderStepStripMentor | 타임라인(5개 반복) | 동일 스텝 정본 | — | 멘토 톤 진행 표시 |

### 메시지 / 채팅 (OrderProgressSection)

학생 「멘토와 대화」 / 멘토 「학생과 대화」 — 결정(액션)과 분리 배치된 소통 채널.

| 요소 (표시 라벨) | 종류 | 소스 | 연결 동작 | 추론한 존재 목적 |
|---|---|---|---|---|
| 「주문방 채팅」 / 「대화 내용은 안전한 거래를 위해 저장됩니다.」 | 헤더 | 정적 | — | 기록 고지(분쟁 대비) |
| 메시지 버블 | 목록(N개 반복) | `sortedMsgRows.map()`(created_at 오름차순) | — | 대화 이력 |
| 발신자 「의뢰 학생」/「{mentorName} 멘토」(멘토뷰: 「나」/학생 표시명 — 기본 「의뢰자」) | 텍스트 | `orderPartyLabelForMessage`+`mentorStudentDisplayName` | — | 발신 주체 구분 |
| 날짜 구분선·시각 | 표식 | `formatMessageGroupDate`·`formatMessageTime` | — | 시간 맥락 |
| 첨부 미리보기 칩 | 파일 칩(N개 반복) | `messageAttachmentsByMessageId`, `signedUrl` 있을 때만 새 탭 | 다운로드 | 첨부 수발신 |
| 입력창 + 「전송」 + 클립 | 폼 | `showComposer = !orderTerminal && hasOrderPartyAccess && orderId` | `submitCustomOrderRoomMessageAction`(max 4000자, 첨부 pdf/png/jpg/webp/zip/docx/pptx) | 메시지·파일 전송 — 서버에서 연락처 자동 마스킹 [G3] |
| (종료+빈 채팅) 「이미 종료된 주문 대화방입니다.」 | 안내 | `orderTerminal` — 01 공용 사전 참조(EmptyState) | — | 종료 주문 입력 차단 |

### 납품 파일 패널 (OrderDeliverablesPanel) — 잠금/해제 포함

학생 헤더 hint 「수락 전에는 다운로드·미리보기가 잠겨 있어요」 — **수락 전 잠금이 이 패널의 핵심 계약**.

| 요소 (표시 라벨) | 종류 | 소스 | 연결 동작 | 추론한 존재 목적 |
|---|---|---|---|---|
| 「납품 완료물」/「파일 보관함」(멘토: 「납품 파일」·「총 N건」) | 헤더 | 정적+`rows.length` | — | 섹션 표기 |
| 납품 행 — 「{n}차 납품」 배지 + 「상태: {label}」 + 파일명·크기 | 목록(N개 반복) | `deliverables.rows.map()`, `deliverableVersionLabelKorean` | — | 버전별 납품 이력 |
| **「다운로드 받기」** | 폼 버튼 | `dl && canDownload && !studentDownloadBlocked` — `studentDownloadAllowed = actorRole!=="student" \|\| studentCanDownloadDeliverable(order)` | `downloadCustomOrderDeliverableAction`(hidden orderId·deliverableId) | 파일 수령 |
| **「다운로드」(비활성) + 「수락(완료) 후 다운로드할 수 있어요.」** | 잠금 UI | `studentDownloadBlocked = actorRole==="student" && !studentDownloadAllowed` | disabled | **수락 전 잠김의 시각 표현** |
| 「아직 등록된 납품물이 없습니다.」 / 오류 문구 | 빈/오류 | 0건 / 테이블 부재 | — | 상태 안내 |
| (멘토) 「신규 납품 등록」 — 파일 input·「납품 설명(옵션)」·「제출하기」 | 폼 | `showMentorForm = mentor && !orderTerminal && !mentorDeliverableBlockReason`(학생 뷰는 false 하드코딩) | `submitMentorOrderDeliverableAction`(multipart, 최대 20MB) | 납품·재납품 등록 |
| (멘토) 등록 불가 사유 박스 | 안내 | `mentorDeliverableBlockReason`(결제 미확정·분쟁·terminal·status) | 폼 대체 | 불가 사유 설명 |

**잠금의 코드 강제(3중):** ① 라우트 래퍼의 `hideStudentPreCompletionDeliverableStoragePaths`(완료 전 storage 경로 자체를 학생 페이로드에서 제거) ② UI `studentCanDownloadDeliverable(order)`(`orderLifecycleConstants.ts:117` — 허용 `completed`/`accepted`/`finished`, 차단 `cancelled`/`refunded`/`rejected`/`disputed` 등, **`delivered` 등 검토 중·`paid`는 false**, 그 외 `completed_at`/`accepted_at` 존재 시 true) ③ 서버 `downloadCustomOrderDeliverableAction`이 동일 함수로 재검증 후 「수락(완료) 후에 다운로드할 수 있어요」 차단 → 통과 시 서명 URL(TTL 600초, http(s) 경로 거절·`validateDeliverableStoragePath` 3세그먼트 검증). 멘토·admin은 잠금 없음.

### 수정요청 패널 (OrderRevisionsPanel)

| 요소 (표시 라벨) | 종류 | 소스 | 연결 동작 | 추론한 존재 목적 |
|---|---|---|---|---|
| 「수정 요청 내역」 + 「납품·검토 중 …수정 사항이 여기 누적…」 | 헤더 | 정적 | — | 섹션 표기 |
| 「수정 {max}회 중 {n}회 남음」 | 카운터 | `computeRevisionUsageLocal`(used=납품수-1, max=2), `showRevisionUsage=inReviewStage` | — | **잔여 2회 가시화** |
| 수정요청 폼(textarea `requestNote` max 8000 + 「수정 요청 보내기」) | 폼 | student && `studentRevisionRequestDisabledReason==null` | `submitCustomOrderRevisionRequestAction` | 수정 요청 전송 |
| 막힌 사유 박스(2회 소진 시 「수정 요청은 최대 2회…」) | 안내 | `studentRevisionRequestDisabledReason` | 폼 대체 | 한도·단계 불가 사유 |
| 요청 내역(날짜+본문) | 목록(N개 반복) | `revisions.rows.map()` | — | 요청 이력 |
| 「수정 요청이 아직 없습니다.」 / 오류 | 빈/오류 — 01 공용 사전 참조 | 0건 / error | — | 상태 안내 |

### 분쟁 패널 (OrderDisputesPanel)

학생 「문제가 있나요?」 / 멘토 「문제 해결」 아래 배치, `id="order-disputes"`로 액션 바와 앵커 연결.

| 요소 (표시 라벨) | 종류 | 소스 | 연결 동작 | 추론한 존재 목적 |
|---|---|---|---|---|
| 「결제·납품 문제 해결」 + 역할별 설명(「…진행 중이면 작업 단계가 일시 보류」) | 헤더 | `actorRole` 분기 | — | 정책 안내 |
| 신청 폼(textarea `disputeBody` max 8000 + 「문제 해결 요청하기」) | 폼 | (student\|mentor) && `openDisputeApplicationDisabledReason==null` | `submitCustomOrderDisputeAction` | 분쟁 접수 |
| 막힌 사유 박스 | 안내 | disabledReason 문자열 | 폼 대체 | 접수 불가 사유 |
| 접수 내역(날짜·상태 라벨·본문) + 「(진행 중)」/「분쟁 진행 중」 배지 | 목록(N개 반복) | `disputes.rows.map()`, `hasActiveDisputeForOrderRows` | — | 접수 이력·활성 표식 |
| 「접수된 해결 요청이 없습니다.」 / 오류 | 빈/오류 | 0건 / error | — | 상태 안내 |

### 이벤트 로그 (OrderEventsLogPanel)

| 요소 (표시 라벨) | 종류 | 소스 | 연결 동작 | 추론한 존재 목적 |
|---|---|---|---|---|
| 「진행 로그 · 펼쳐 보기」(멘토: 「시스템 이벤트 로그」) | 접이식(기본 접힘) | `<details>` | — | 감사 기록의 저관여 노출 |
| 이벤트 행(`orderEventKindLabelForUi` 라벨+메시지+시각) | 목록(N개 반복) | `events.rows.map()` | — | 진행 이력 추적 |
| (이벤트 없음) 「현재 상태」 배지 + 「주문 등록」/「마지막 갱신」 | 폴백 | `created_at`·`updated_at` | — | 로그 부재 대체 |
| 부분 오류 문구 | 안내 | `events.error` | — | 로드 실패 |

### 하단 액션 바 (OrderActionBar / OrderActionBarMentor)

현재 단계의 주 액션 1개 + 보조 링크. 모든 노출/활성은 부모가 주입한 `*DisabledReason`과 `orderId` 유무로 결정.

| 요소 (표시 라벨) | 종류 | 소스 | 연결 동작 | 추론한 존재 목적 |
|---|---|---|---|---|
| (종료 주문) 「추가 작업 없음」 + 「완료된 주문입니다. 납품물과 진행 기록을 확인할 수 있어요.」(학생) / 「완료된 주문입니다. 추가 납품이나 상태 변경은 할 수 없어요.」(멘토) | 상태 박스 | `orderTerminal` → `ORDER_ROOM_TERMINAL_*_NOTICE` | — | 종료 시 진행 버튼 전면 대체 |
| **「수락하고 완료하기」**(제출 중 「수락 처리 중…」) | 폼 버튼(PendingSubmitButton) | `canStudentAccept = student·view && !studentAcceptDisabledReason && orderId` | `acceptCustomOrderDeliverableAction` | **완료 확정 — 정산 트리거(멘토 95%)** |
| 「납품 수락은 지금 단계에서 사용할 수 없어요.」 | 비활성 텍스트 | title=`studentAcceptDisabledReason` | — | 수락 불가 사유 |
| **「주문 취소 · 전액 환불」** / 「주문 취소(전액 환불)」(비활성) | 폼 버튼 | `canStudentCancel`(착수 전 pending+escrowed만) | `cancelCustomOrderByStudentAction` | 착수 전 무손실 이탈 |
| 「수정 요청하기」 | 앵커/버튼 | `canStudentRevisionJumps` → `#order-revisions`, 아니면 disabled | 스크롤 | 수정 패널 유도 |
| 「문제 해결 요청하기」 / 「해결 요청 상태 보기」·「문제 해결 진행 중」 | 앵커 | `canDisputeJump`(활성 분쟁 없을 때) / `hasActiveDispute` | `#order-disputes` 스크롤 | 분쟁 진입·현황 |
| **「작업 시작하기」**(멘토) | 폼 버튼 | `canMentorStart = mentor && !mentorStartDisabledReason && orderId`(학생 뷰는 false 하드코딩) | `startCustomOrderWorkAction` | 착수 선언(pending→open) |
| 「※ 지금은 작업을 시작할 수 없습니다.」 | 안내 | `!mentorPrimaryStarts` | — | 착수 불가(결제 미확정 등) |
| 「수정 요청 내역」(멘토) | 앵커 | `canMentorRevisionJump`(분쟁 중 차단) | `#order-revisions` | 수정 내역 이동 |

### (멘토 전용) 정산 내역 블록

`hasRightSettlementBlockContent` 참일 때만: `OrderPaymentSettlementBlock`이 결제·정산 진행 문장(분쟁 시 「정산 보류」, 완료 시 「정산 예정」 단계 문구), `OrderSettlementLineCard`가 「총액(참고)」·「플랫폼」·「멘토」 금액을 `{n}캐시`로 표기 — **5%/95% 분배의 화면면**.

### 정책·안내 존

학생 본체 하단 「안내 및 정책」: `CustomRequestPolicyNotice`·`ContactMaskingNotice`(01 공용 사전 참조)·환불/취소 안내(`/legal/refund`). 학생 사이드바 「안내 사항」 3종 명문: **「파일 수정 요청은 최대 2회까지」·「수락 후에는 추가 수정 요청 불가」**·문제 발생 시 고객센터. 멘토 사이드바는 `MentorOrderRoomGuidanceCollapsible`(「안내 및 정책」 기본 접힘 — 「작업 안내」 4팁 + `CustomRequestStatusBanner`(분쟁 시 「분쟁으로 진행이 제한될 수 있어요」) + 정책·마스킹 고지) — 채팅 집중을 위해 접이식.

### 학생 완료 뷰 (order/StudentOrderCompleteView — OrderRoomView:382 조기 반환)

학생 뷰에서 주문이 종결 상태면 주문방 대신 렌더되는 "거래 완료 영수증+아카이브" 화면.

| 요소 (표시 라벨) | 종류 | 소스 | 연결 동작 | 추론한 존재 목적 |
|---|---|---|---|---|
| 「맞춤의뢰」(eyebrow) + 「거래가 완료됐어요」 + 「완료」 배지 | 헤더 | 정적 | — | 종결 선언 |
| 「결과물·영수증을 한곳에서 확인하세요.」(모바일)/「요청한 작업이 마무리됐어요.…」(데스크톱) | 텍스트 | 반응형 분기 | — | 화면 요약 |
| ✓ 「결제 · 납품 · 정산이 모두 마무리됐어요」 | pill | 정적 | — | 3요소 완결 확언 |
| 「결제 금액」·「완료일」·「담당 멘토」 스트립 | 표 | `pickAmountLabel`·`formatOrderRoomDate`·`{mentorName} 멘토` | — | 핵심 요약 |
| 「진행 단계」(hint 「작업 흐름이 모두 마무리됐어요」) — 「작업 대기」·「작업 중」·「납품 완료」·「주문 완료」 전체 ✓ | 스텝퍼(4개 반복) | `ORDER_STEPS.map()` | — | 완주 시각화 |
| 「받은 결과물」(hint 「최종 납품 파일은 주문 완료 후에도 보관돼요」) + 「납품 완료」 pill | 섹션 | `latestDeliverable` | — | 산출물 보관 안내 |
| 파일 칩(파일명(폴백 「텍스트 납품」)·크기·납품 시각) + 「미리보기」·「다운로드」 | 폼 버튼 2종 | `downloadable`(storage 경로 존재) 시 | `downloadCustomOrderDeliverableAction`(미리보기는 target=_blank) | 완료 후 열린 다운로드 |
| (파일 경로 없음) 「미리보기」 접이식(텍스트 납품 본문/「미리볼 텍스트 납품 내용이 없습니다.」) + 「다운로드」 disabled(title 「이 납품에는 다운로드할 파일 경로가 없습니다.」) | 접이식/버튼 | `!downloadable` | — | 텍스트 납품 대응 |
| 「결제가 완료된 주문이라 다운로드가 열려 있어요.」 / 「등록된 납품 파일이 없어요.」 | 힌트/빈 상태 | deliverable 유무 | — | 잠금 해제 상태 설명 |
| 「결제 영수증」(hint 「학생 결제 내역만 표시돼요」) — 「결제 수단」(기본 「캐시」)·「결제일시」·「결제 상태」 | 표(dl) | `payment_method`·`paid_at ?? completed_at`·`paymentStatusLabelForUi`(폴백 「결제 완료」) | — | 학생면 영수증(수수료 비노출) |
| 「주문 정보」 + 「완료」 pill — 「주문 번호」(short id)·「카테고리」·「주문일」·「완료일」 | 표(dl) | `shortOrderIdForDisplay` 등 | — | 거래 식별 정보 |
| 「주문방 대화 기록」 — 「대화 {n}건 · 대화 보기」 접이식(최근 5건, 「저장된 대화가 아직 없어요.」) | 접이식+목록(`messages.slice(-5).map` 반복) | `detail.messages` | — | 대화 아카이브 |
| 「수정 요청 내역」(hint 「파일 수정 요청은 최대 2회까지 가능해요」) — 요청 목록 / 「수정 요청 없이 완료됐어요.」 | 목록(N개 반복)/빈 상태 | `revisions.map` | — | 수정 이력 아카이브 |
| 「완료 후 안내」 — 「납품 파일은 주문방에서 다시 내려받을 수 있어요.」·「결제 내역은 학생용 영수증 기준으로 표시됩니다.」·「멘토에게 남긴 후기는 멘토 프로필에 반영돼요.」 | 리스트(3개) | 정적 | — | 사후 규칙 안내 |
| 「진행 로그 열기」 접이식(이벤트 라벨+시각 / 「표시할 진행 로그가 아직 없어요.」) | 접이식+목록(N개 반복) | `orderEventKindLabelForUi` | — | 감사 기록 |
| 「← 맞춤의뢰 목록으로 돌아가기」 / 「문제 해결 신청」 / ★「후기 작성하기」 | 링크 3종 | `reviewHref = /mentors/{mentorId}#reviews`(멘토 id 없으면 `/mentors`) | 각 경로(`/custom-request/orders`·`/support`) | 종결 후 3갈래 후속 행동 |

---

## 상태 라벨맵 (orderLifecycleConstants — 파일 수정 없음, 인용)

`ORDER_STATUS_LABEL_MAP`(`lib/customRequest/orderLifecycleConstants.ts:211`) 전체. `orderStatusLabelForUi`는 이 맵, 배지 전용 `orderStatusBadgeLabelForNorm`은 미매핑 토큰을 raw 대신 「준비 중」으로 통일.

| status 키 | 한국어 라벨 | 톤 / 비고 |
|---|---|---|
| `pending` | 작업 대기 | gray · insert 직후 primary — 멘토 착수 허용 유일 상태 |
| `open` | 작업 중 | blue · `ORDER_MENTOR_WORK_STARTED_PRIMARY_STATUS`(착수 후 목표) |
| `in_progress` | 작업 중 | blue |
| `submitted` | 작업 중 | blue |
| `delivered` | 납품 대기 | amber · 학생 검토·수락·수정요청 단계 |
| `in_review` | 납품 대기 | blue |
| `waiting_review` | 납품 대기 | blue |
| `delivered_pending_review` | 납품 대기 | amber |
| `pending_review` | 납품 대기 | blue |
| `redelivered` | 납품 대기 | amber |
| `delivery_submitted` | 납품 대기 | amber |
| `revision_requested` | 수정 요청 | orange · 멘토 재작업 중 |
| `completed` | 완료 | green · 학생 수락 후 primary (terminal) |
| `accepted` | 완료 | green (terminal) |
| `finished` | 완료 | green (terminal) |
| `paid` | 수락됨 | green |
| `unpaid` | 작업 대기 | gray |
| `closed` | 종료됨 | gray (terminal) |
| `cancelled` / `canceled` | 종료됨 | gray (terminal) |
| `disputed` | 종료됨 | red · 화면에서는 「운영팀 확인 중」으로 오버라이드 |
| `refunded` | 종료됨 | gray (terminal) |
| `done` | 종료됨 | green (terminal · threadStats 휴리스틱 유래) |
| `resolved` | 종료됨 | green (terminal) |
| `rejected` | 종료됨 | red (terminal) |

전이 요지: `pending`(insert 시 `order_status=open`·`payment_status=unpaid` 병행) → 멘토 착수 → `open`/`in_progress` → 멘토 납품 → `delivered` → 학생 수락 → `completed`(정산). 곁가지: `delivered`에서 수정 요청 → `revision_requested` → 재납품 → `delivered`; `pending`+`escrowed`에서 학생 직접 취소 → `cancelled`/`refunded`; 활성 분쟁(open/under_review/escalated) 시 전 라이프사이클 액션 잠금. 상태 컬럼은 `status`→`state`→`order_status`→`stage` 순 첫 비어있지 않은 값이 primary(`primaryOrderStatusColumnKey` — 레거시 스키마 편차 흡수).

**결제 라벨** `PAYMENT_STATUS_LABEL_MAP`: `unpaid`/`pending`=「결제 확인 대기」, `paid`/`completed`/`succeeded`=「결제 완료」, `escrowed`=「에스크로」, `failed`=「결제 실패」, `refunded`=「환불됨」, `dispute_resolved`=「분쟁 분배 완료」, `partial_refund`=「부분 환불」, `cancelled`/`canceled`=「결제 취소」.

**이벤트 라벨** `orderEventKindLabelForUi`: `order_started`=작업 시작 · `deliverable_submitted`=납품 등록 · `deliverable_accepted`=납품 수락 · `settlement_item_created`=정산 항목 생성 · `message_created`=메시지 작성 · `revision_requested`=수정 요청 · `dispute_opened`=해결 요청 · `dispute_split_applied`=분쟁 분배 완료 · `payment_confirmed`=결제 확인 · `order_cancelled`=주문 취소.

---

## 액션 카탈로그 (버튼 → 서버 액션 → 검증·효과)

클라이언트 `*DisabledReason` 선차단 + 서버 액션 재검증의 이중 구조.

| 버튼 라벨 | 노출 조건 (역할·status·payment_status) | 서버 액션 | 핵심 검증 / 효과 |
|---|---|---|---|
| **「수락하고 완료하기」** | student, status ∈ 수락 허용 집합(`delivered`·`waiting_review` 등), 납품 1건+, 비terminal, 활성 분쟁 없음 | `acceptCustomOrderDeliverableAction`(orderStudentActions) | 본인 확인 → `mustBlockUnpaidAcceptForProduction`(`escrowed`/`paid` 아니면 차단 — 우회 env는 프로덕션에서 throw) → 분쟁 차단 → 납품 존재 → `accept_custom_order_deliverable_atomic` RPC(완료+정산 단일 트랜잭션) → `splitPlatformAndMentorForGross(gross, 0.05)`로 **플랫폼 5% / 멘토 95%** 정산 기록 → `deliverable_accepted` 이벤트, 지갑·payouts revalidate |
| **「작업 시작하기」** | mentor, status=`pending`, 결제 확정(`paid`/`escrowed`/`succeeded` 등), 분쟁 없음 | `startCustomOrderWorkAction`(orderMentorActions) | `isCustomRequestOrderStatusDdlInRepo` 스키마 게이트 → 배정 멘토 본인 → `isCustomOrderPaymentConfirmed`(미결제 시 「결제 완료 뒤에만」) → `startCustomOrderWorkRpc` → `order_started` 이벤트 |
| **「제출하기」(납품/재납품)** | mentor, 비terminal, `mentorDeliverableBlockReason==null` | `submitMentorOrderDeliverableAction`(orderMentorActions) | 배정 멘토 → 분쟁 차단 → 결제 확정 → status ∈ `open`/`delivered`/`revision_requested` → 파일 검증(20MB·MIME 화이트리스트·매직바이트·경로) → 설명문 `sanitizeTrustSafetyText`(연락처 마스킹) → 비공개 버킷 업로드 → `markCustomOrderDeliveredRpc`(→`delivered`) → `deliverable_submitted` 이벤트 |
| **「수정 요청 보내기」** | student, 납품 1건+, status ∈ 수락 허용, 분쟁 없음, **2회 미소진** | `submitCustomOrderRevisionRequestAction`(orderRevisionActions) | 본인 → 분쟁 차단 → **`custom_order_revisions` count ≥ 2면 「수정 요청 횟수를 초과했습니다. (최대 2회)」** → note ≤8000자·마스킹 → `requestCustomOrderRevisionRpc`(→`revision_requested`) → 이벤트. UI 카운터(`used=납품수-1`)와 서버 카운트 동기 |
| **「주문 취소 · 전액 환불」** | student, status=`pending`(멘토 착수 전), `payment_status=escrowed` | `cancelCustomOrderByStudentAction`(orderStudentActions) | `isOrderStatusBeforeMentorWorkStarted`(pending만 — `open`이면 「작업이 시작되어 직접 취소 불가·분쟁 이용」) → `isOrderPaymentEscrowedForStudentCancel` → `recordCustomOrderEscrowRefundRpc`(전액 반환, `cancelled`+`refunded` 마감) → `order_cancelled` 이벤트 |
| **「문제 해결 요청하기」(분쟁 제기)** | student 또는 mentor, 비terminal, 활성 분쟁 없음(멘토는 납품 후/검토 단계만) | `submitCustomOrderDisputeAction`(orderDisputeActions) | 당사자 매칭 → 종료 주문 차단 → 중복 활성 분쟁 차단(DB partial unique 병행) → body ≤8000 → `maskContactInUserText`(마스킹만) → `disputes` insert(status=`open` 서버 고정) → `dispute_opened` 이벤트. **분쟁 "응답" 폼은 이 화면에 없음** — 후속 조정은 운영 절차(admin 콘솔 — 10번 담당) (추정) |
| **「다운로드 받기」/「다운로드」** | 당사자(student/mentor/admin). **학생은 `studentCanDownloadDeliverable(order)` 참일 때만** | `downloadCustomOrderDeliverableAction`(orderDeliverableDownloadActions) | `canAccessOrder` → 학생 잠금 재검증(「수락(완료) 후에 다운로드할 수 있어요」) → storage 경로 검증 → 서명 URL(600초) redirect |
| **「전송」(메시지)** | 비terminal 당사자 | `submitCustomOrderRoomMessageAction`(orderMessageActions) | `sanitizeTrustSafetyText`(연락처 자동 마스킹 — 금지어 차단은 폐지 [G2]) → max 4000자·첨부 화이트리스트 저장 |
| **「이 멘토 선택」(비교 화면)** | 작성자 student, `!existingOrderId` | `selectMentorApplicationForOrder`(customRequestApplicationActions) | 선정 → `insertCustomRequestOrder`(pending/unpaid) → 에스크로 결제 흐름 개시 |
| **「지원서 제출하기」(멘토)** | 승인 멘토, 미지원 & 모집 status | `submitMentorCustomRequestApplication`(customRequestApplicationActions) | **의뢰당 1회**(선-조회+DB unique `ALREADY_APPLIED`) → 마스킹·첨부 검증 → 학생 알림 |

**연락처 마스킹 적용·해제 실측 [G3]:** `maskContactInText`(contactMasking.ts)가 이메일(난독화 포함)·메신저 도메인(open.kakao.com·t.me·instagram.com 등)·한국어 메신저 키워드+아이디(카카오톡·카톡·오픈채팅·텔레그램·인스타(그램)·디엠)·전화번호(+82·한글 「공일공」 표기 포함)를 `[연락처 비공개]`로 치환한다(보수적 매칭 — 일반 URL·단독 @핸들은 의도적 미차단). **텍스트 마스킹은 저장 시 무조건 적용되며 열람 단계의 해제(unmask) 로직은 없다.** "선택 후 해제"가 코드로 존재하는 부분은 제안 **첨부**뿐 — 비교 화면의 `allowPreview=Boolean(existingOrderId)`·`maskFilenames=!existingOrderId`와 서버 `assertStudentCanPreviewAfterSelection`이 선정(주문 생성) 후 파일명·미리보기를 연다.

---

## 각주 — 코드 ≠ 기획 (사실 표기)

- **[G1] 게이트 작동 범위:** 기획 문구 "게이트 OFF — 곧 오픈 예정, 코드는 완비"에서 OFF의 실제 구현은 **네비 항목 숨김(admin 제외) + 공개 랜딩 배너**뿐이다. 개별 학생·멘토 라우트에는 OFF 분기가 없어 URL 직접 접근은 전 기능 동작한다(배너 문구 「이미 진행 중인 주문은 그대로 이용할 수 있어요」와 정합).
- **[G2] 금지어 배열 빈 상태:** CLAUDE.md의 맞춤의뢰 금지어 7종(`대필`·`대신 써줘` 등)과 달리 `CUSTOM_REQUEST_BANNED_PHRASES = []`(빈 배열), `findBannedPhrase`·`findRestrictedPhraseInText`는 **항상 null**(주석: 과잉 차단 문제로 단어 기반 차단 전면 폐지). `sanitizeTrustSafetyText`도 항상 ok:true + 연락처 마스킹만 수행. 경고 문구 상수 「대필·완성 대행 의뢰는 등록할 수 없습니다」와 NewForm의 경고 배너 분기는 잔존하나 발동 불가(사문화). 대필 금지 정책은 문구 차단이 아니라 TrustBanner·PolicyNotice·동의 체크박스·`/legal/no-ghostwriting` 등 **고지·동의 방식**으로 구현돼 있다.
- **[G3] 연락처 마스킹 해제:** 기획 "선택·결제 후 해제"와 달리 **텍스트 내 연락처는 저장 시점 영구 마스킹(해제 로직 부재)**. 선정 후 해제가 구현된 것은 제안 첨부의 파일명 마스킹·미리보기 잠금(`existingOrderId` 기준)뿐이다. 소통 자체는 선정 후 주문방 채팅으로 열리는 구조.
- **[G4] 멘토 주문 하위 4라우트:** 기획상 개별 화면(room/files/revision/waiting-review)이지만 실코드는 전부 redirect 스텁이고, 대응 View 3종(`MentorOrderFilesView`·`MentorOrderRevisionView`·`MentorOrderWaitingReviewView`)과 `CustomRequestOrderReviewPanel`·`CustomRequestApplicationsWaitingView`(부분)·`MentorCustomRequestPostsFilterPanel`은 미배선 보존 컴포넌트다 — 주문방 단일 화면으로 동선 통합된 흔적.
- **[G5] 임시 표기:** 주문방 학생 헤더의 「예상 소요 기간」은 「2일」 하드코딩, 「제안 금액」/「결제 금액」·「수락일」/「의뢰일」은 각각 동일 값 재사용 — (추정) 전용 컬럼 미도입 상태의 자리 표기.
- **[G6] 정합 확인(기획=코드):** 수수료 5%/멘토 95%(`CUSTOM_ORDER_PLATFORM_FEE_RATE=0.05`, 라벨 「5% 공제 (플랫폼 수수료)」) · 수정 요청 최대 2회(`MAX_REVISION_REQUESTS_PER_ORDER=2`) · 납품 파일 수락 전 잠김(3중 강제) · 제안 의뢰당 1회(이중 강제) · 에스크로 결제·착수 전 전액 환불 — 모두 코드로 일치.
