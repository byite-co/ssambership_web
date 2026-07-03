# 05. 개별질문 (채널 2 — 에스크로 단건 Q&A) — 존재 목적 리포트

> 대상 라우트 7개 · 요소 행 105개(상태 사전 7행 포함) · 근거: 코드 실측 + 기획 정본

개별질문(IQ)은 구독 없이 질문 1건당 캐시를 안전결제(에스크로)하는 저관여 단건 거래 채널이다. 공개형(학생이 희망가 제시 → 승인 멘토 선착순 claim)과 지정형(특정 멘토 직접 지정 · 멘토 단가 고정) 2종이 있으며, 라이프사이클은 create hold(학생 지갑 차감) → claim/assigned(배정) → answered(멘토 답변 확정) → released(학생 [해결 완료] 시 지급, 수수료 15%) → 미응답 시 만료 환불(크론)이다. released 질문은 같은 멘토 구독 전환 시 질문방으로 이관된다(`transferReleasedIndividualQuestionsToRoom`).

## 커버 라우트 (검증용 전수 목록)

`docs/architecture/route-inventory.txt` grep(`individual`) 전수 — 7건, 누락 없음.

| # | route-inventory 행 | URL | 화면 ID |
|---|---|---|---|
| 1 | `app/(student)/individual-questions/page.tsx` | `/individual-questions` | `student-iq-list` |
| 2 | `app/(student)/individual-questions/new/page.tsx` | `/individual-questions/new` | `student-iq-new-open` |
| 3 | `app/(student)/individual-questions/[questionId]/page.tsx` | `/individual-questions/[questionId]` | `student-iq-detail` |
| 4 | `app/(student)/mentors/[mentorId]/individual-question/new/page.tsx` | `/mentors/[mentorId]/individual-question/new` | `student-iq-new-direct` |
| 5 | `app/(mentor)/mentor/individual-questions/page.tsx` | `/mentor/individual-questions` | `mentor-iq-list` |
| 6 | `app/(mentor)/mentor/individual-questions/[questionId]/page.tsx` | `/mentor/individual-questions/[questionId]` | `mentor-iq-detail` |
| 7 | `app/api/cron/individual-question-expiry/route.ts` | `/api/cron/individual-question-expiry` | `cron-iq-expiry` |

연결 컴포넌트: `components/individualQuestion/IndividualQuestionViews.tsx`(772줄) · `MentorOwnedIndividualQuestionsSection.tsx`(274줄) · `StudentSentIndividualQuestionsSection.tsx`(268줄) · `OpenQuestionBoard.tsx`(204줄).
연결 lib: `lib/individualQuestion/individualQuestionActions.ts`(606줄) · `individualQuestionQueries.ts` · `individualQuestionFormat.ts` · `individualQuestionPricing.ts` · `individualQuestionExpiryConfig.ts` · `individualQuestionExpiryBatch.ts` · `individualQuestionAttachmentStorage.ts` · `transferIndividualQuestionsToRoom.ts` · `individualQuestionTypes.ts`.

## 상태 사전 (라벨·색·역할별 액션 — `individualQuestionFormat.ts` + `IndividualQuestionViews.tsx` 실측)

기획 정본의 status 6종(escrowed/open/assigned/claimed/answered/released)에 더해 코드는 종료 3종(refunded/expired/canceled)을 표시 처리한다.[^status]

| status | 배지 라벨 | 배지/카드 톤 | 학생에게 보이는 액션 | 멘토에게 보이는 액션 |
|---|---|---|---|---|
| `escrowed` | 「예치중」 | amber | 메시지 「보내기」만 (canCompose) | 메시지 「보내기」만 — 「답변 확정」 없음(assigned/claimed만 허용)[^escrowed] |
| `open` | 「공개중」 | amber | 메시지 「보내기」 (헤드라인 「멘토 답변을 기다리고 있어요」) | (소유 전) 공개 질문 게시판에서 「답변하기」= 선착순 claim |
| `assigned` (지정형 배정) | 「답변중」 | amber | 메시지 「보내기」 | 「보내기」 + 「답변 확정」 (canMentorConfirm) · 칩 「지금 내 차례예요」 |
| `claimed` (공개형 claim) | 「답변중」 | amber | 메시지 「보내기」 | 「보내기」 + 「답변 확정」 · 칩 「지금 내 차례예요」 |
| `answered` | 「답변완료」 | emerald | 「보내기」 + 「해결 완료」(=release, canStudentConfirm) · 칩 「지금 내 차례예요」 | 「보내기」(보충 설명) + 안내 「답변을 확정했어요. 학생이 [해결 완료]를 누르면 안전 보관 중인 캐시가 정산돼요.」 |
| `released` | 「완료」 | blue | 액션 없음(terminal) · 「정산 영수증」 표시 | 액션 없음 · 「정산 영수증」 + 수수료 15% 안내 |
| `refunded` / `expired` / `canceled` | 「환불」/「만료」/「취소」 | slate(중립) | 액션 없음 · 「환불 영수증」 | 액션 없음 · 「환불 영수증」 |

## 화면별 상세

### /individual-questions — 개별질문 목록 (`student-iq-list`)

**바인딩**: `app/(student)/individual-questions/page.tsx` (`force-dynamic`) · 비로그인도 열람 허용 — `getServerUserWithProfile()`만 호출하고 가드 없음(주석: "실제 작성/제출은 /individual-questions/new 가드로 로그인 유도") · 로그인+학생일 때만 `fetchStudentIndividualQuestions`(본인 `student_id`, `created_at` desc, limit 100) · 목록 본체는 `StudentSentIndividualQuestionsSection`(클라이언트).

**화면의 존재 목적**: 채널 2의 학생 허브. 비로그인 유입자에게도 공개형·지정형 2종 진입 카드를 먼저 보여 깔때기 입구 역할을 하고, 로그인 학생에게는 보낸 단건 질문의 상태(에스크로 진행/완료/종료)를 한 화면에서 추적하게 한다.

| 요소 (표시 라벨) | 종류 | 소스 | 연결 동작 | 추론한 존재 목적 |
|---|---|---|---|---|
| 「개별 질문」 / 「내 개별 질문」 | eyebrow·h1 | page.tsx:30-32 | — | 화면 정체성 고정 |
| 「지정형·공개형 단건 질문과 답변을 확인하세요.」(모바일) / 「캐시로 안전 결제한 지정형·공개형 단건 질문과 답변 상태를 확인합니다.」(md+) | 부제 | page.tsx:34-37 | — | 2종 유형 + 에스크로 결제 개념을 첫 문장에서 학습시킴 |
| 「개별 질문은 **구독 질문방과 별개**로, 건마다 캐시를 안전 결제해 진행하는 단건 질문이에요. 구독 멘토와의 대화는 질문방에서 이어집니다.」 | 안내 배너 (md 이상 `hidden…md:block`) | page.tsx:40-42 | 「질문방」 링크 → `/question-room` | 채널 1(구독 질문방)과 채널 2의 혼동 방지 · 구독자를 올바른 채널로 회송 |
| 공개형 카드: 「공개형」 「멘토 지정 없이 질문하기」 「가격을 제시해 공개로 올리면, 먼저 잡은 멘토 1명이 답변해요.」 + 배지 「여기서 바로 가능」 | 진입 카드 (파랑 강조 보더 `border-[#2563EB]`) | page.tsx:47-68 | 버튼 「공개형 질문하기」 → `/individual-questions/new` | 공개형을 주 경로로 시각 강조(주석: "주 경로(파랑 강조 보더)") — 멘토를 모르는 신규 유입도 즉시 거래 시작 |
| 지정형 카드: 「지정형」 「특정 멘토에게 묻기」 「원하는 멘토를 직접 골라 1:1로 질문하고 싶을 때.」 | 진입 카드 (회색 보더, 보조) | page.tsx:70-87 | 버튼 「멘토 찾기 →」 → `/mentors` | 지정형 진입은 멘토 프로필 경유가 정본이므로 멘토 찾기로 우회시킴 |
| 「개별 질문 목록을 불러오지 못했습니다. {error}」 | 오류 배너 (조건: `error` 존재) | page.tsx:90-94 | — | 쿼리 실패를 침묵시키지 않고 노출 |
| 비로그인 카드: 「로그인하면 내 개별 질문이 보여요」 「학생 계정으로 로그인하면 보낸 질문과 답변 상태를 확인할 수 있어요.」 | 안내 카드 (조건: `!user`) | page.tsx:103-114 | 버튼 「학생 로그인」 → `/login/student?next=/individual-questions` | 열람은 열되 데이터는 로그인 뒤 — next 파라미터로 복귀 보장 |

#### 하위 컴포넌트 — `StudentSentIndividualQuestionsSection` (조건: `user` 존재)

| 요소 (표시 라벨) | 종류 | 소스 | 연결 동작 | 추론한 존재 목적 |
|---|---|---|---|---|
| 상태 탭 「전체 (N)」「진행 중 (N)」「완료 (N)」「종료 (N)」 | role=tablist 버튼 — `tabs.map()` 1행, 4개 반복 · 모바일 가로 스크롤 1줄 | StudentSent…:157-204 | 클라이언트 필터(서버 재조회 없음) · 탭 변경 시 1페이지 리셋 | 상태 배지 규약 재사용 분류: 진행 중=`isIndividualQuestionAwaitingAnswer`(escrowed/open/assigned/claimed), 완료=`isIndividualQuestionAnswered`(answered/released), 종료=그 외(환불/만료/취소) — 정산 전/후를 한 번에 구분 |
| 상태 배지 (「예치중」~「취소」) | 카드 칩 | SentQuestionCard:60-62 | — | 상태 사전 표 참조 — 카드 좌측 액센트 톤(iqCardTone)과 색 일치 |
| 유형 배지 「지정형」/「공개형」 | 카드 칩 | SentQuestionCard:63-65 | — | `question_type`(open 외=지정형) 표기 |
| 과목·단원 칩 「{과목} · {topic}」 | 카드 칩 (조건: `row.subject` 존재) | SentQuestionCard:66-71 | — | `getSubjectLabel` 정규 라벨로 분류 확인 |
| 「{N}캐시 안전 결제」 | 금액 텍스트 | SentQuestionCard:72 | — | `price_cents`÷100 표기 — 에스크로 금액을 카드에서 상시 노출 |
| 「마감 임박」 배지 | 칩 (조건: awaiting 상태 & 만료 12시간 이내 — `isIndividualQuestionExpiringSoon`) | SentQuestionCard:73 + Format:86-100 | — | 환불 임박을 학생에게 예고 |
| 제목·본문 2줄 미리보기 + 「{N}시간 후 마감」/「{N}일 후 마감」/「곧 마감」/「마감 지남」 | 텍스트 (마감 문구는 awaiting 상태 & `expires_at` 존재 시) | SentQuestionCard:75-79 + Format:103-119 | — | 남은 답변 기한을 사람이 읽는 단위로 환산 |
| 우측 요약 dl 「멘토 {이름}」 「등록일 {일시}」 | 카드 메타 | SentQuestionCard:81-90 | — | 상대·시점 식별(공개형 미claim 시 멘토명은 쿼리 fallback) |
| 질문 카드 전체 | 링크 카드 — `pagedRows.map()` 1행, 페이지당 모바일 4 / 데스크탑 5개 반복 | SentQuestionCard:53-93 | 클릭 → `/individual-questions/{id}` | 상세로의 유일한 진입 |
| 「이전」 「{현재} · {전체}」 「다음」 | 페이지네이션 (조건: totalPages>1) | StudentSent…:234-256 | 클라이언트 페이지 이동 | 최대 100건을 4~5건씩 소화 |
| 빈 상태 「아직 개별 질문이 없습니다」(전체 탭) / 「해당 상태의 질문이 없어요」(그 외 탭) | 안내 카드 (조건: filteredRows 0건) | StudentSent…:206-225 | — | 탭별로 다른 빈 사유 안내 · EmptyState 마크업 복제(모바일 축약 목적, 주석 명기) |

공용: `EmptyState` · `listCardClassName`(ListCard) — 01 공용 사전 참조.

### /individual-questions/new — 공개 질문 등록 (`student-iq-new-open`)

**바인딩**: `requireRole("student")` · form action=`createOpenIndividualQuestionAction`(서버 액션) · hidden `idempotencyKey`=`iq_open:{randomUUID()}` · 자격 카탈로그 `loadSchoolClassificationCatalogs` · 실패 시 `?error=` 플래시로 재진입.

**화면의 존재 목적**: 공개형 작성 폼. 학생이 희망가를 자유 제시하고 답변 자격(학교군·전공계열)을 걸어 공개 게시하면, 제출 즉시 지갑에서 hold(에스크로)가 걸린다(`create_individual_question_with_hold_v2` RPC). "멘토를 모르는 학생"이 가격만으로 거래를 시작하게 하는 채널 2의 주 유입구.

| 요소 (표시 라벨) | 종류 | 소스 | 연결 동작 | 추론한 존재 목적 |
|---|---|---|---|---|
| 「공개 질문 등록」 + 배지 「공개형」 + 「멘토를 지정하지 않고 질문과 가격을 공개하면, 승인된 멘토 중 먼저 가져간 1명이 답변합니다.」 | h1·배지·부제 | new/page.tsx:37-42 | — | 선착순 claim 규칙을 제출 전에 고지 |
| 「{error}」 | 오류 플래시 (조건: `?error=`) | new/page.tsx:45-49 | — | 서버 액션 redirect 오류 표출(캐시 부족·자격 조건 오류 등) |
| 요약 dl: 「질문 방식 / 공개형 · 먼저 답변하는 멘토 1명」 「제시 금액 / 자유롭게 제시하세요」 「답변 자격 / 선택 안 하면 전체 허용」 | 3칸 안내 | new/page.tsx:51-64 | — | 폼 규칙 3가지를 입력 전 요약 |
| `idempotencyKey` | hidden input | new/page.tsx:67 | RPC `p_idempotency_key` — 재제출 시 `already_exists`로 이중 결제 차단 | 에스크로 결제의 멱등 보장 |
| 「과목」 select — 「선택 안 함」 + 과목 옵션 | 폼 필드 (선택) | new/page.tsx:70-80 | `SubjectSelectOptions` — 01 공용 사전 참조 | 멘토측 게시판의 과목 칩 필터 소스가 됨 |
| 「단원·개념 (선택)」 placeholder 「예: 함수의 극한, 문학 개념어」 | 폼 필드 | new/page.tsx:81-89 | — | 과목보다 세밀한 매칭 힌트 |
| fieldset 「답변 자격 조건」 — 「조건을 걸면 학교·전공 인증이 승인된 멘토만 답변을 맡을 수 있어요.」 | 필드 그룹 | new/page.tsx:92-129 | — | 공개형의 품질 통제 장치(자격 미달 claim은 RPC가 `mentor_qualification_not_met`로 거절) |
| 「학교군」 select — 「조건 없음(전체 허용)」 + `qualificationCatalogs.schoolTiers.map()` 1행, N개 반복(DB 카탈로그) | 폼 필드 | new/page.tsx:98-112 | 서버에서 `catalogHasCode` 재검증 | 임의 코드 주입 방지 + 학교군 자격 제한 |
| 「전공계열」 select — 「조건 없음(전체 허용)」 + `majorCategories.map()` 1행, N개 반복 | 폼 필드 | new/page.tsx:113-127 | 동일 재검증 | 전공계열 자격 제한 |
| 「제시 금액」 input — `type=number` `min=1` `step=1` `required` placeholder 「5000」(`OPEN_INDIVIDUAL_QUESTION_PRICE_PLACEHOLDER_CASH`) + 「금액은 자유롭게 제시할 수 있어요(0보다 큰 캐시). 금액이 높을수록 답변이 빨라질 수 있어요.」 | 폼 필드 — step 1원(=1캐시) 단위 | new/page.tsx:131-146 | 서버: `positiveIntegerValue`로 양수 정수만 통과 → `amountCentsFromCashKrw`(×100)로 cents 저장[^price] | 희망가 자유 제시(최소/최대 강제 없음 — 액션 주석 "금액 자유화") · 가격이 답변 속도 인센티브임을 명시 |
| 「제목」 input (`required` 2~120자) | 폼 필드 | new/page.tsx:148-159 | 저장 전 `maskContactInUserText` 연락처 마스킹 | 게시판 노출용 한 줄 요약 |
| 「질문 내용」 textarea (`required` min 5, rows 9) placeholder 「풀이 과정, 막힌 지점, 원하는 설명 방식을 적어 주세요.」 | 폼 필드 | new/page.tsx:161-171 | 동일 마스킹 | 본문 — 멘토는 claim 후에만 열람 |
| 「첨부 파일」 — 「파일 선택」 「JPG, PNG, PDF · 클릭하거나 파일을 끌어다 놓으세요」 + 「내가 올린 파일은 언제든 다시 볼 수 있어요. 다른 멘토에게는 답변을 맡기 전까지 공개되지 않습니다.」 | 파일 드롭존 (`CommunityFileDropzone` — 01 공용 사전 참조) | new/page.tsx:173-184 | 생성 성공 후 `uploadIndividualQuestionAttachment`(비공개 버킷) · 업로드 실패 시 `?warning=`으로 상세 이동(질문 자체는 유지) | 문제 사진 첨부 + claim 전 비공개 원칙 고지 |
| 「취소」 | 링크 | new/page.tsx:187-192 | → `/individual-questions` | 결제 전 이탈 경로 |
| 「안전 결제하고 공개 등록」 / pending 「결제 처리 중...」 | 제출 버튼 (`FormSubmitButton` — 01 공용 사전 참조) | new/page.tsx:193-197 | `createOpenIndividualQuestionAction` → RPC `create_individual_question_with_hold_v2`(지갑 hold + status `open`) → `expires_at`=+48h(`IQ_OPEN_EXPIRY_HOURS`) → `/individual-questions/{id}?created=1` | 제출=결제임을 버튼 문구로 확정(이중 확인 없음) · 실패 시 「캐시가 부족해요. 충전 후 다시 질문해 주세요.」 등 코드별 한국어 매핑 |

### /mentors/[mentorId]/individual-question/new — 지정형 질문 작성 (`student-iq-new-direct`)

**바인딩**: `requireRole("student")` · `loadPublicMentorBundle`(멘토 없으면 프로필로 redirect) + `fetchMentorIndividualQuestionPrice`(`mentor_individual_question_pricing.amount_cents`) 병렬 로드 · `canSubmit = 승인 멘토 && 단가 존재`일 때만 폼 렌더 · hidden `idempotencyKey`=`iq_direct:{uuid}` · action=`createDirectIndividualQuestionAction`.

**화면의 존재 목적**: 지정형 작성 폼. 공개형과 달리 가격 입력이 없고 멘토가 프로필에 설정한 단가가 고정 적용된다 — 멘토 프로필에서 넘어온 학생이 그 멘토와 1:1 단건 거래를 맺는 경로이며, 구독 전 "이 멘토 답변 품질 체험"의 성격을 가진다(released 후 구독 전환 시 질문방 이관으로 연결).

| 요소 (표시 라벨) | 종류 | 소스 | 연결 동작 | 추론한 존재 목적 |
|---|---|---|---|---|
| 「{멘토명} 멘토에게 질문하기」 + 배지 「지정형」 + 「구독 질문권과 별개로 캐시를 안전 결제해 단건 질문을 보냅니다. 답변 완료 시 결제 금액이 멘토에게 지급됩니다.」 | h1·배지·부제 | direct new/page.tsx:56-61 | — | 수신자 고정 + 채널 1과의 구분 + 에스크로 규칙 고지 |
| 「{error}」 | 오류 플래시 (조건: `?error=`) | :64-68 | — | 결제 실패·승인 오류 표출 |
| 요약 dl: 「담당 멘토 / {이름}」 「개별 질문 단가 / {N캐시 또는 '미설정'}」 「진행 방식 / 등록 시 안전 결제 · 답변 완료 시 지급」 | 3칸 안내 | :70-85 | 단가는 `fetchMentorIndividualQuestionPrice` 실측값 | 고정가·에스크로 흐름을 입력 전 요약 |
| 차단 카드 「이 멘토는 아직 개별 질문 단가를 설정하지 않았어요.」(승인+단가 없음) / 「승인 완료된 멘토에게만 개별 질문을 보낼 수 있어요.」(미승인) + 「멘토 프로필로 돌아가기」 | 안내 카드 (조건: `!canSubmit` — 폼 대신 렌더) | :87-98 | 링크 → `/mentors/{mentorId}` | 결제 불가 상태를 폼 진입 전에 차단(서버 액션에서도 동일 검증 이중화) |
| hidden `mentorId` / `idempotencyKey` | hidden input | :101-102 | RPC 파라미터 · 멱등키 | 수신 멘토 고정 + 이중 결제 방지 |
| 「과목」 select / 「단원·개념」 input | 폼 필드 (선택) | :105-124 | `SubjectSelectOptions` — 01 공용 사전 참조 | 공개형과 동일 분류 필드(단, 자격 조건 fieldset은 없음 — 수신자가 이미 특정됨) |
| 「제목」 input (2~120자) / 「질문 내용」 textarea (min 5) | 폼 필드 (`required`) | :127-150 | 저장 전 연락처 마스킹 | 공개형과 동일 본문 구조 |
| 「첨부 파일」 — 「파일 선택」 「JPG, PNG, PDF · 20MB 이하 · 클릭하거나 끌어다 놓으세요」 | 파일 드롭존 (01 공용 사전 참조) | :152-163 | 생성 후 업로드 · 실패 시 `?warning=` | 문제 사진 첨부(공개형과 달리 20MB 제한 문구 명시) |
| 「취소」 | 링크 | :166-171 | → `/mentors/{mentorId}` | 프로필로 복귀 |
| 「{N캐시} 안전 결제하고 질문 보내기」 / pending 「결제 처리 중...」 | 제출 버튼 | :172-176 | `createDirectIndividualQuestionAction` → 승인·단가 재검증 → RPC `create_individual_question_with_hold`(hold + 배정) → `expires_at`=+72h(`IQ_DIRECT_EXPIRY_HOURS`, status `assigned`) → 멘토에게 알림 「새 개별 질문이 도착했어요」 → `/individual-questions/{id}?created=1` | 결제 금액을 버튼에 그대로 박아 청구액 오인 방지 · 지정형은 생성 즉시 배정(assigned)이라 별도 claim 단계 없음 |

### /individual-questions/[questionId] — 학생 상세 (`student-iq-detail`)

**바인딩**: `requireRole("student")` · `fetchIndividualQuestionDetail` — 없으면 `notFound()`, `student_id !== user.id`면 목록으로 redirect(본인 것만) · `fetchIndividualQuestionTransfer`(구독방 이관 매핑, RLS로 본인 것만) · 렌더는 `IndividualQuestionViews.tsx`의 `IndividualQuestionDetailView`(actor="student") 단일 컴포넌트 · `?created/resolved/sent/warning` → 플래시.

**화면의 존재 목적**: 단건 에스크로 거래의 학생측 진행 화면. "지금 무슨 상태고 누구 차례인지"를 큰 문장으로 앞세우고(주석: "큰 상태 문장이 주인공"), 답변 확인의 종착 액션인 [해결 완료](=release, 멘토 지급)를 answered 상태에서만 노출한다. 종료 후에는 영수증으로 결과를 고정 표시한다.

| 요소 (표시 라벨) | 종류 | 소스 | 연결 동작 | 추론한 존재 목적 |
|---|---|---|---|---|
| eyebrow 「개별 질문 · 지정형/공개형」 + 상태 배지 | 칩 | Views:433-438 | — | 유형·상태를 헤더에서 즉시 식별 |
| 히어로 헤드라인 — released 「답변을 받았어요」 / refunded 「안전 보관 중이던 캐시를 돌려받았어요」 / expired·canceled 「답변 기간이 지났어요」 / answered 「멘토가 답변했어요. 확인해 주세요」 / claimed 「멘토가 답변을 준비하고 있어요」 / open 「멘토 답변을 기다리고 있어요」 / 그 외(assigned·escrowed) 「멘토 답변을 기다리고 있어요」 | h1 + 안내 문장(상태별 guide, 모바일 축약 병행) | Views:396-405, 437-449 | — | 상태 코드를 사람 말로 번역 — 학생 행동(확인·대기)을 문장으로 지시 |
| 「{N}캐시 안전 보관 중」 / 「정산 완료」(released) / 「환불 완료」(refunded·expired·canceled) | ShieldCheck 칩 | Views:382-384, 478-481 | — | 에스크로 자금의 현재 위치를 상시 표시(주석: "주문방과 통일") |
| 「지금 내 차례예요」(answered) / 「멘토를 기다리는 중」(그 외 진행) / 「거래 종료」(terminal) | 차례 칩 | Views:415-424, 482-494 | — | 턴 기반 UX — 학생이 행동해야 할 시점을 한 칩으로 |
| 플래시 「질문이 전달됐어요. 안전 보관 중인 캐시는 해결 완료를 누르기 전까지 보관돼요.」(created) / 「해결 완료했어요. 안전 보관 중이던 캐시가 멘토에게 정산됐어요.」(resolved) / 「메시지를 보냈어요.」(sent) + `?warning=`(첨부 실패) | 플래시 배너 (조건: 쿼리 파라미터) | page.tsx:39-45 + Views:498-503 | — | 결제·정산 직후 결과 확인 |
| 이관 배너 「이 개별 질문은 구독 질문방으로 이어졌어요. 이어서 대화하려면 구독 질문방에서 확인하세요.」 + 「구독 질문방에서 보기 →」 | 배너 (조건: `transfer` 존재 · 링크는 roomId+threadId 있을 때) | Views:505-519 | 링크 → `/question-room/{roomId}/thread/{threadId}` | 채널 2→채널 1 전환 완결 — released IQ가 구독 전환 시 이관됐음을 알리고 대화 연속성 제공(`transferReleasedIndividualQuestionsToRoom` 결과) |
| 질문 카드 — 라벨 「질문 내용」 + 칩 「답변 멘토/담당 멘토 {이름}」(공개형/지정형 분기) + 제목·본문 + 칩 「과목 {…}」「단원 {…}」「등록 {일시}」 + 첨부 | 고정 카드 | Views:522-537 | 첨부: 이미지=썸네일 새 탭, 파일=칩 링크, signedUrl 없으면 「열람 불가」 — `attachments.map()` 1행, N개 반복 | 대화가 길어져도 원 질문·첨부를 상단 고정(주석 명기) |
| 대화 섹션 — 제목 「받은 답변」(released)/「대화」 + 힌트 + 「{N}건」 카운트 | 섹션 헤더 | Views:542-560 | — | 종료 후엔 "받은 답변"으로 리프레이밍 |
| 메시지 버블 — `detail.messages.map()` 1행, N개 반복 · 본인=오른쪽 파랑 / 상대=왼쪽 흰색 · 발신자 「나/멘/학」 이니셜 + 「나/멘토/학생 · {일시}」 + 메시지별 첨부 | 버블 목록 | Views:561-595 | 발신자 역할은 질문 행의 id로 판별(주석: RLS로 상대 users 행을 못 읽는 문제 회피) | 단건 거래 내 보충 문답 이력 |
| 빈 대화 「멘토가 답변하면 여기에 표시돼요.」 / terminal 시 「이 질문은 종료되어 더 이상 메시지를 주고받을 수 없어요.」 | 빈 상태 (조건: messages 0건) | Views:596-613 | — | 상태별 기대치 설정 |
| 메시지 입력바 — textarea placeholder 「멘토에게 보낼 메시지를 작성하세요.」 + 「파일 첨부」 + 「보내기」/「전송 중...」 | 폼 (조건: `canCompose` = 비terminal) | Views:618-648 | `sendIndividualQuestionMessageAction` — party만 허용·status 불변·연락처 마스킹·상대 알림 → `?sent=1` | 질문 보완·재질문(상태 전이 없는 순수 대화) |
| [해결 완료] 박스 — 「멘토 답변이 도착했어요. 내용을 확인하고 도움이 됐다면 아래 [해결 완료]를 눌러 주세요. 누르기 전까지 캐시는 안전하게 보관돼요.」 + 칩 「완료 시 정산」 + 버튼 「해결 완료」/「처리 중...」 | 폼 (조건: `canStudentConfirm` = actor student & status `answered`) | Views:681-704 | `confirmIndividualQuestionAnswerAction` → 본인·answered 검증 → RPC `release_individual_question_payout`(멱등, 지갑 직접 조작 금지 주석) → 멘토 알림 「학생이 답변을 확정했어요」 → `?resolved=1` | 에스크로 release의 유일한 학생 트리거 — 학생 확인 없이는 지급되지 않는 안전결제 핵심[^fee] |
| 영수증 — 「정산 영수증」(released)/「환불 영수증」(refunded·expired·canceled) + 행 「안전 결제 금액」「결제 일시」「정산 완료 일시」(released & released_at)/「환불 일시」(refunded_at)「상태」 | 정적 dl (조건: terminal) | Views:707-758 | — | 종료 거래의 금액·일시를 서버값으로 고정 표기(주석: "금액·일시는 서버값") |
| 「← 내 개별 질문 목록」 | 링크 | Views:761-767 + page.tsx:51-52 | → `/individual-questions` | 목록 복귀 |

### /mentor/individual-questions — 멘토 목록 + 공개 질문 게시판 (`mentor-iq-list`)

**바인딩**: `requireRole("mentor")`(레이아웃 가드에 더한 페이지별 중복 호출) + `assertMentorApprovedForAction` — 미승인이면 두 목록 모두 빈 배열로 대체 · 승인 시 `fetchMentorOwnedIndividualQuestions`(designated 또는 claimed가 본인, limit 100)와 `fetchOpenIndividualQuestionsForMentor`(RPC `list_open_individual_questions_for_mentor`, limit 80) 병렬 로드 · `force-dynamic` · 요약 스트립 수치는 로드된 목록에서 계산(주석: "데이터 로직 미터치").

**화면의 존재 목적**: 멘토측 채널 2 작업대. 위쪽은 "내가 맡은 질문"(지정형+claim한 공개형)의 답변 대기/완료 관리, 아래쪽은 공개 질문 게시판 — 선착순 claim으로 추가 수익 기회를 잡는 수주(受注) 보드. 승인 게이트로 미승인 멘토의 거래 참여를 원천 차단한다.

| 요소 (표시 라벨) | 종류 | 소스 | 연결 동작 | 추론한 존재 목적 |
|---|---|---|---|---|
| 「개별 질문」 / 「나에게 온 개별 질문」 + 「학생이 캐시를 예치하고 지정한 단건 질문에 답변합니다.」 | eyebrow·h1·부제 | page.tsx:58-68 | — | 에스크로 수익 채널임을 명시 |
| 「단가 설정」 | 헤더 버튼(에메랄드) | page.tsx:61-66 | → `/mentor/profile/edit` | 지정형 수주의 전제(단가 미설정 시 지정형 접수 불가)를 헤더 상시 노출 |
| 「승인 완료 후 개별 질문에 답변할 수 있어요. 현재 상태를 확인해 주세요.」 | 배너 (조건: `!approval.ok`) | page.tsx:71-75 | — | 미승인 멘토 차단 사유 고지 |
| 「{flashError}」 / 「개별 질문 목록을 불러오지 못했습니다. {error}」 | 오류 배너 (조건: `?error=` / 쿼리 실패) | page.tsx:76-85 | — | claim 실패(선착순 패배 등) 복귀 메시지 표출 |
| 요약 스트립 「답변 대기 {N}」(assigned·escrowed) 「진행 중 {N}」(claimed·answered) 「이번 달 완료 {N}」(released & 당월) | KPI 3칸 — `cells.map()` 1행, 3개 반복 (조건: approval.ok) | page.tsx:44-52, 87-93 + Views:45-95 | — | 오늘 할 일(주황)·진행(초록)·실적(중립)의 색 위계(주석 명기) |
| 섹션 「내가 맡은 질문」 + 빈 상태 「아직 맡은 개별 질문이 없습니다」 「학생이 멘토를 지정하거나 공개 질문에 답변을 맡으면 이곳에 표시됩니다.」 | 섹션 (조건: rows 0건 — `IndividualQuestionListCards` 빈 분기) | page.tsx:95-108 | — | 수주 방법 2가지(지정/claim)를 빈 상태에서 교육 |
| `MentorOwnedIndividualQuestionsSection` (하위 표) | 클라이언트 섹션 (조건: rows>0) | page.tsx:110-114 | — | 아래 하위 표 |
| `OpenQuestionBoard` (하위 표) | 에메랄드 박스 섹션 | page.tsx:118-122 | — | 아래 하위 표 |

#### 하위 — `MentorOwnedIndividualQuestionsSection` (내가 맡은 질문)

| 요소 (표시 라벨) | 종류 | 소스 | 연결 동작 | 추론한 존재 목적 |
|---|---|---|---|---|
| 유형 탭 「전체 (N)」「지정형 (N)」「공개형 (N)」 | role=tablist — `tabs.map()` 1행, 3개 반복 | MentorOwned…:193-241 | 클라이언트 필터 · 탭 변경 시 두 목록 모두 1페이지 리셋 | 수주 경로별(직접 지정 vs claim) 분리 관리 |
| 「답변 대기 ({N})」 목록 | 소제목+`PagedQuestionList` | :244-255 | `isIndividualQuestionAwaitingAnswer` 필터 | 아직 답변 의무가 남은 건 우선 배치 |
| 「답변 완료·종료 ({N})」 목록 | 소제목+목록 (조건: settledRows>0) | :257-270 | 나머지 상태 | 이력 열람(없으면 섹션 자체 미노출) |
| `OwnedQuestionCard` — 상태 배지·유형 배지·과목 칩·「{N}캐시 안전 결제」·「마감 임박」·제목·본문 2줄·마감 문구·「학생 {이름}」·「등록일」 | 링크 카드 — `paged.map()` 1행, 페이지당 모바일 4/데스크탑 5개 반복 | :48-94 | 클릭 → `/mentor/individual-questions/{id}` | 학생측 카드와 동일 규약(주석: "클라이언트 분류용 복제") — 상대 라벨만 「학생」 |
| 「이전」「{N} · {M}」「다음」 | 페이지네이션 (조건: totalPages>1) | :123-145 | 클라이언트 페이지 이동 | 목록 분량 제어 |
| 빈 상태 「답변할 질문이 없어요」 / 「완료된 질문이 없어요」 | EmptyState (01 공용 사전 참조) | :110-111, 252-253, 266-267 | — | 목록별 빈 사유 구분 |

#### 하위 — `OpenQuestionBoard` (공개 질문 게시판 · 필터/정렬 클라이언트 처리)

| 요소 (표시 라벨) | 종류 | 소스 | 연결 동작 | 추론한 존재 목적 |
|---|---|---|---|---|
| 「공개 질문 게시판」 + 「대기 {N}건」 + 「답변하고 싶은 공개 질문을 골라 먼저 답변을 맡아보세요」 + 「학생 신원과 본문은 답변을 맡기 전에는 공개되지 않아요」 | 보드 헤더 | OpenQuestionBoard:94-111 | — | 선착순 규칙과 claim 전 비공개 원칙을 보드 입구에서 고지 |
| 과목 칩 「전체」 + `subjects.map()` 1행, N개 반복 — rows에 실제 등장하는 과목만(주석: "지어내지 않음") | 필터 버튼 | :114-124 | 클라이언트 필터 | 자기 과목 질문만 빠르게 훑기 |
| 정렬 select 「최신순」「마감임박순」「금액높은순」 | select (aria-label 「정렬」) | :125-134 | 클라이언트 정렬 — expiring=expires_at 오름차순(없으면 맨 뒤), price=price_cents 내림차순 | 수익(금액) vs 긴급(마감) 관점 전환 |
| 질문 카드 — 과목·단원 칩 + 마감 칩(「{N}시간 후 마감」 등, 임박 시 rose) + 「학생 신원 비공개」 + 「{N}캐시」 큰 금액 + 「안전 결제」 + 제목 + 「본문과 첨부는 답변을 맡은 뒤에만 열람할 수 있어요.」 + 「등록 {일시}」 | 카드 — `visibleRows.map()` 1행, N개 반복 (lg 2열) | :143-199 | — | 제목·과목·금액·기한만으로 수주 판단(본문 비공개는 어뷰징 방지)[^blind] |
| 「답변하기」 / pending 「확인 중...」 | claim 제출 버튼(hidden `questionId`) | :188-195 | `claimOpenIndividualQuestionAction` → 승인 게이트 → RPC `claim_individual_question_v2`(원자적 선착순 배정) → `expires_at`=+48h(claimed) → 학생 알림 「멘토가 답변을 맡았어요」 → `/mentor/individual-questions/{id}?claimed=1` · 패배 시 「이미 다른 멘토가 답변을 맡았어요. 목록을 새로 확인해 주세요.」, 자격 미달 시 「…학교군·전공계열 자격을 가진 멘토만 답변할 수 있어요.」 | 선착순 claim의 유일한 트리거 — "맡기" 경쟁을 버튼 1개로 수렴 |
| 빈 보드 「답변할 수 있는 공개 질문이 없습니다」 + 「단가 설정」 버튼 | EmptyState (01 공용 사전 참조 · 조건: rows 0건) | :66-83 | → `/mentor/profile/edit` | 공개 질문이 없을 때도 지정형 수주 준비(단가 설정)로 유도 |
| 「선택한 과목의 공개 질문이 없습니다.」 | 안내 (조건: 필터 결과 0건 & rows>0) | :138-141 | — | 필터 결과 없음과 데이터 없음을 구분 |

### /mentor/individual-questions/[questionId] — 멘토 상세 (`mentor-iq-detail`)

**바인딩**: `requireRole("mentor")` + `assertMentorApprovedForAction`(미승인 즉시 목록 redirect) · `fetchIndividualQuestionDetail` — 소유 검증: 지정형은 `designated_mentor_id`, 공개형은 `claimed_mentor_id`가 본인일 때만(아니면 redirect) · 렌더는 학생과 동일한 `IndividualQuestionDetailView`(actor="mentor") · `?answered/claimed/sent` → 플래시.

**화면의 존재 목적**: 멘토측 답변 작업 화면. 메시지 전송(대화)과 [답변 확정](answered 전이)을 분리해 — 보충 설명은 계속 보내되, "확정"이라는 명시적 액션으로만 학생 확인 단계로 넘어가게 한다. 지급은 어디까지나 학생 [해결 완료] 시점(액션 주석: "지급은 학생 [해결됨] 때").

| 요소 (표시 라벨) | 종류 | 소스 | 연결 동작 | 추론한 존재 목적 |
|---|---|---|---|---|
| 히어로 아이콘 타일 — answered=주황 / refunded·expired·canceled=중립 / released·진행=초록 | 아이콘 (멘토 분기 전용 레이아웃) | Views:386-393, 452-455 | — | 조치 대기(주황) 여부를 색으로 앵커(주석: "주문방과 동일 원리") |
| eyebrow 「개별 질문 · 지정형/공개형」 + 상태 배지 + 헤드라인 — released 「답변이 완료됐어요」 / refunded 「질문이 환불됐어요」 / expired 「답변 기간이 지났어요」 / answered 「답변을 확정했어요」 / claimed 「답변을 맡았어요」 / 그 외(assigned·escrowed) 「학생 질문이 도착했어요」 + 상태별 guide 문장 | 헤더 | Views:406-411, 456-474 | — | 멘토 관점의 다음 행동(작성→확정→대기)을 문장으로 지시 |
| 「{N}캐시 안전 보관 중/정산 완료/환불 완료」 + 「지금 내 차례예요」(assigned·claimed) / 「학생 확인을 기다리는 중」(그 외 진행) / 「거래 종료」(terminal) | 에스크로·차례 칩 | Views:477-494 | — | 답변 의무 구간(내 차례)을 명확화 |
| 플래시 「답변을 확정했어요. 학생이 [해결 완료]를 누르면 안전 보관 중인 캐시가 정산돼요.」(answered) / 「메시지를 보냈어요.」(sent) / 「공개 질문 답변을 맡았어요. 이제 답변을 작성할 수 있습니다.」(claimed) | 배너 (조건: 쿼리 파라미터) | page.tsx:46-54 | — | claim·확정 직후 다음 단계 안내 |
| 질문 카드 (칩 「학생 {이름}」) + 본문·첨부 — claim 후이므로 전문 열람 가능 | 고정 카드 | Views:522-537 | — | 답변 작성 중 원 질문 상시 참조 |
| 대화 버블 + 빈 상태 「학생 질문을 확인하고 답변을 보내 보세요.」 — 본인 버블은 에메랄드 | 목록 (`messages.map()` 1행, N개 반복) | Views:561-613 | — | 학생 화면과 동일 구조, 액센트만 멘토=초록 |
| 메시지 입력바 — placeholder 「학생에게 보낼 답변·메시지를 작성하세요.」 + 「파일 첨부」 + 「보내기」 | 폼 (조건: 비terminal) | Views:618-648 | `sendIndividualQuestionMessageAction`(answered·released 전만 — released/정산 후엔 「정산이 완료된 질문입니다.」 거절) | 답변 본문·보충 설명 전송(전송만으로는 상태 불변) |
| [답변 확정] 박스 — 「답변을 모두 작성했다면 확정해 학생 확인을 요청하세요.」 + 칩 「학생 확정 시 정산」 + 버튼 「답변 확정」/「처리 중...」 | 폼 (조건: `canMentorConfirm` = actor mentor & status `assigned` 또는 `claimed`) | Views:651-672 | `confirmIndividualQuestionAnswerByMentorAction` → 소유·상태 재검증 → `status=answered, answered_at=now` 조건부 update → 학생 알림 「답변이 등록되었어요」(본문: "[해결됨]을 누르면 예치 캐시가 멘토에게 지급돼요") → `?answered=1` | answer 단계의 명시적 완료 선언 — 만료 환불 대상에서 벗어나고(answered는 크론 제외) 학생 확인 턴으로 넘김 |
| 대기 안내 「답변을 확정했어요. 학생이 [해결 완료]를 누르면 안전 보관 중인 캐시가 정산돼요. 보충 설명은 계속 보낼 수 있어요.」 | 배너 (조건: actor mentor & status `answered`) | Views:674-678 | — | 정산 지연이 학생 확인 대기 때문임을 설명해 문의 예방 |
| 영수증 + 「플랫폼 수수료(15%) 차감 후 실수령액은 [정산] 페이지에서 확인할 수 있어요.」 | dl + 각주 (조건: terminal · 수수료 문구는 멘토 & released만) | Views:707-758 | — | 표시 금액(학생 결제액)과 실수령액(85%)의 차이를 정산 페이지로 위임[^fee] |
| 「← 개별 질문 목록」 | 링크 | page.tsx:44-45 | → `/mentor/individual-questions` | 목록 복귀 |

### /api/cron/individual-question-expiry — 만료 환불 크론 (`cron-iq-expiry`)

**바인딩**: `GET` 핸들러 · `CRON_SECRET`을 `Authorization: Bearer` 또는 `x-cron-secret` 헤더로 검증(`timingSafeEqual` — 타이밍 공격 방지) · `INDIVIDUAL_QUESTION_EXPIRY_ENABLED` 환경변수 킬 스위치 · `?at=` ISO 시각 주입 가능(기본 now) · service role로 `runIndividualQuestionExpiryBatch` 실행.

**화면의 존재 목적**: 에스크로의 안전판. 멘토가 기한 내 답변하지 않은 hold 자금을 학생에게 자동 환불해 "돈이 묶인 채 방치되는" 최악의 신뢰 실패를 기계적으로 차단한다. 이 크론이 있어야 "답변 없으면 환불"이라는 채널 2의 약속이 성립한다.

| 요소 (표시 라벨) | 종류 | 소스 | 연결 동작 | 추론한 존재 목적 |
|---|---|---|---|---|
| 인증 검사 → 401 `{ ok:false, error:"unauthorized" }` | 가드 | route.ts:16-41 | secret 미설정 시에도 전면 거부 | 외부 임의 호출로 인한 환불 트리거 차단 |
| 킬 스위치 → `{ ok:true, disabled:true, message:"INDIVIDUAL_QUESTION_EXPIRY_ENABLED is not true; no-op." }` | 가드 (조건: env ≠ "true"/"1") | route.ts:43-50 | no-op | 배포는 하되 환불 자동화를 운영이 명시적으로 켜는 안전장치 |
| `?at=` 파싱 → 400 `invalid_at` | 파라미터 | route.ts:30-36, 52-55 | 기준 시각 주입 | 재실행·백필·테스트 시 시각 고정 |
| 대상 스캔 — `status in (open, assigned, claimed)` & `expires_at <= at`, `expires_at` 오름차순, limit 100(기본, env `IQ_EXPIRY_BATCH_LIMIT`, 최대 500) | 배치 쿼리 | ExpiryBatch:11, 111-117 + ExpiryConfig:29-31 | — | answered/released/refunded/canceled/escrowed는 제외(주석 명기) — 답변이 확정된 건은 절대 자동 환불하지 않음 |
| 건별 환불 — RPC `refund_individual_question_hold` (멱등키 `iq_refund:{id}`, 내부 `for update` 행 잠금 — 주석 명기) | RPC 호출 | ExpiryBatch:65-95 | 결과 코드 분기: refunded / already_refunded / already_released·hold_missing·not_found=skip | "환불은 반드시 070 RPC만 경유. 지갑 직접 조작 금지"(주석) — release와의 경합을 DB 잠금으로 해소 |
| 환불 알림 「개별 질문이 환불되었어요」 「"{제목}" 질문에 답변이 없어 캐시가 환불되었어요.」 | best-effort 알림 (조건: refunded 성공 시) | ExpiryBatch:44-63 | link → `/individual-questions/{id}` (reason: `expired_no_answer`) | 학생이 지갑 변동 사유를 즉시 인지 — 실패해도 배치 계속 |
| 응답 summary `{ ok, at, scanned, refunded, alreadyRefunded, skipped, errors[] }` | JSON | route.ts:60-63 + ExpiryBatch:15-22 | ok = errors 0건 | 크론 모니터링·재실행 판단 근거 |

**만료 기한(env 기본값, `individualQuestionExpiryConfig.ts`)**: open 48h(`IQ_OPEN_EXPIRY_HOURS`) · claimed 후 48h(`IQ_CLAIMED_ANSWER_HOURS`) · 지정형 assigned 72h(`IQ_DIRECT_EXPIRY_HOURS`). `expires_at`은 생성/claim 액션에서 `setQuestionExpiryBestEffort`로 기록(실패해도 거래 진행 — best-effort).

## 화면 밖 연결 고리 (라우트 없음 · 담당 lib)

| 요소 | 종류 | 소스 | 연결 동작 | 추론한 존재 목적 |
|---|---|---|---|---|
| `transferReleasedIndividualQuestionsToRoom` | 서버 함수(구독 전환 직후 service_role 호출) | transferIndividualQuestionsToRoom.ts:193-245 | 같은 멘토에게 released된 IQ를 스캔 → 질문방에 `question_threads`(status closed) 생성 → 원 질문 본문을 학생 첫 메시지로 보존 → 대화·첨부(storage 복제) 이관 → `individual_question_transfers` 멱등 매핑 기록 | 채널 2→채널 1 전환의 핵심 — 단건 체험에서 쌓인 문답이 구독 후에도 이어지게 해 구독 전환 인센티브를 완성. best-effort(한 건 실패가 구독을 막지 않음, 주석 명기) |
| 알림 6종 (`individual_question_assigned/claimed/answered/message/released/expired_refunded`) | best-effort 알림 삽입 | Actions:129-211 + ExpiryBatch:44-63 | 각 상태 전이 1회 지점에서만 호출(멱등 주석) | 비동기 단건 거래에서 양측이 상대 턴 완료를 놓치지 않게 함 |

---

[^status]: 기획 정본은 status 6종(escrowed/open/assigned/claimed/answered/released)을 정의하나, 코드(`individualQuestionFormat.ts`)는 refunded/expired/canceled 3종을 추가로 라벨링(「환불」「만료」「취소」)한다. 환불 종료 계열이 기획의 "만료 환불"을 상태로 구체화한 것.
[^escrowed]: `escrowed`는 목록 톤·요약 스트립("답변 대기")·awaiting 분류에는 포함되지만, 생성 RPC 경로는 지정형=assigned, 공개형=open으로 직행하고 상세의 「답변 확정」 조건(assigned/claimed)과 크론 대상에서도 빠져 있다 — 실 운용상 과도기/레거시 상태로 보인다 (추정).
[^price]: 공개형 제시 금액 input의 name은 `priceCents`지만 실제 입력 단위는 캐시(=원, step 1)이며, 서버 액션이 `amountCentsFromCashKrw`(×100)로 변환해 cents로 저장한다(액션 주석: "폼 입력은 캐시(=원) 단위"). 필드명과 단위가 불일치하는 지점(코드≠명명). 기획의 "희망가 제시"는 공개형에만 존재하고, 지정형은 멘토 단가 고정으로 가격 입력 필드 자체가 없다.
[^fee]: 기획 정본 "release 시 멘토 85% 즉시 적립, 수수료 15%"의 분배 계산은 본 담당 범위의 코드에는 없고 DB RPC `release_individual_question_payout` 내부에서 수행된다 (추정 — UI에는 「플랫폼 수수료(15%) 차감 후 실수령액」 문구로만 존재하며, CLAUDE.md 잠금값 "개별질문 15%"와 일치).
[^blind]: 공개 게시판의 본문·첨부·학생 신원 비공개는 UI 문구와 RPC(`list_open_individual_questions_for_mentor`)가 제목·과목·금액·기한만 반환하는 구조로 구현된다. claim 없이 답변만 취득하는 무임승차 방지 목적 (추정).

*비고: `IndividualQuestionViews.tsx`의 `OpenIndividualQuestionBrowseCards`는 export되어 있으나 현재 어느 라우트에서도 import되지 않는다 — `OpenQuestionBoard`(필터·정렬 보드)로 대체된 이전 세대 공개 질문 목록 UI (추정).*
