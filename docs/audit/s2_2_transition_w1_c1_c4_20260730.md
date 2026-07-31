# S2-2 웹 전환 W1 — C1~C4 로컬 구현·검증 실행 기록 (2026-07-30 KST)

> 정본: `docs/contracts/api_web_v1_contract_v1_1.md`(SHA-256 `bd9fc0dd…f32fa6`) §6 V1~V7 ·
> §7 F1/F2/F3 · §8 · §9 · §17(#1·#2·#4·#6·#7·#9·#14·#15·#16) · §20.4 C1~C4.
> 이 문서는 W1 실행 기록 1건이며(지시 §9 허용 신규 파일), 계약·manifest·Batch A~E
> 산출물은 수정하지 않았다.

## 1. 기준점 하드게이트 (실측 — 전건 일치)

- base branch/commit: `claude/s2-2-batch-e-20260730` = `11b6cc5a55e1987adfa3cd06203d1ae91a671bf2`,
  worktree clean, 원격 tip 동일 커밋.
- 정본 정체성 6종(웹 계약 2,994행/329,690B `bd9fc0dd…` · 물리 정책 538행/49,490B
  `54babe01…` · apply_manifest_prod 273행/39,032B `48647693…` · sql_apply_manifest
  293행/83,486B `625c3871…` · M9 forward `3821e05f…` · M9 rollback `c89af2f1…`) 전건 일치.
- 작업 브랜치: `claude/s2-2-transition-w1-c1-c4-20260730` (부모 `11b6cc5…`).

## 2. 수정 전 호출부 인벤토리 (전수 검색 — 분류 포함)

### 2.1 C2 — `weeklyQuestionUsage` / `get_weekly_question_usage`

| 호출부 | 내용 | 분류 |
|---|---|---|
| `lib/qna/weeklyQuestionUsage.ts:113` | `rpc("get_weekly_question_usage")` + JS fallback(구독 프로빙·`question_threads` 직접 집계·`pickExistingColumn`) | **C2 전환** |
| `app/api/question-room/weekly-usage/route.ts:30,45` | 학생 세션(공유 함수 경유) | **C2 전환**(F1 self) |
| `lib/qna/questionRoomStudentContext.ts:189` (`loadWeeklyUsageByMentorIds`) | 학생 세션 목록 스냅샷 | **C2 전환**(F1 self) |
| `lib/qna/questionThreadSubscriptionGuard.ts:62` · `lib/qna/questionRoomThreadService.ts:85` | 학생 세션 사전 게이트(주간 검사 분기는 student 한정) | **C2 전환**(F1 self) |
| `app/(mentor)/mentor/question-room/[roomId]/page.tsx:109` · `…/thread/[threadId]/page.tsx:108` | 멘토 세션이 `(studentId, 멘토)` 로 호출 — 계약 §7 F1(rev 8 A-8)이 명시한 pair-party 유지 대상 | **유지**(레거시 + M15 가드) |
| `lib/qna/weeklyQuestionUsageServer.ts:12` | service_role 서버 경로(M15 가드 통과 대상) | **유지**(레거시) |

### 2.2 C3 — `freeQuestionRoom` / 방 확보

| 호출부 | 내용 | 분류 |
|---|---|---|
| `lib/qna/freeQuestionRoom.ts:46` | JS 승인·자격 게이트 + `ensureMentorStudentRoom`(service_role 직접 INSERT·컬럼 프로빙·23505 재조회) | **C3 전환**(F2) |
| `app/(student)/question-room/page.tsx:35` | 유일 호출부(학생 세션) | **C3 전환** |
| `lib/subscribe/subscribeCheckoutService.ts:763,870,940` (`ensureMentorStudentRoom`·`ensureMentorStudentRoomWithServiceRetry`) | 구독 확정 시 방 확보 — 계약 §17 #3: **F12 내부 F10 호출로 흡수**(웹 JS→F10 직접 경로 없음) | **다른 전환 단계(C8)** |

### 2.3 C4 — `questionRoomRpc.createThread`

| 호출부 | 내용 | 분류 |
|---|---|---|
| `lib/qna/questionRoomRpc.ts:94` (`createQuestionThreadViaRpc`) | `rpc("qna_create_question_thread")` raise 방식 | **C4 전환**(F3 envelope) |
| `lib/qna/questionRoomThreadService.ts:120` · `lib/qna/questionRoomActions.ts:223` | 공유 함수 경유(학생 세션) | **C4 전환**(투명) |
| `questionRoomRpc.ts:125,149,164,182` (`qna_append_message`/`confirm`/`flag`/`register_attachment`) | 계약 §17 #5 | **유지** |

### 2.4 C1 — 읽기 경로 (V1~V7)

| 호출부 | 현재 객체 | 신규 | 분류 |
|---|---|---|---|
| `lib/community/communityBoardQueries.ts` — `listCommunityBoardPosts`(:206) + `listCommunityBoardPostsLegacy`(:252, 폴백) · `listCommunityPopularPostsForHome`(:287, 인라인 폴백) · `getCommunityBoardPost`(:320) · `getCommunityBoardDraft`(:354) · `getCommunityBoardPostForEdit`(:394) · `listUserScrapPosts`(:537, dead) | `community_posts` 직접 SELECT + 레거시 폴백 | **V1** | **C1 전환** |
| `lib/community/communityQueries.ts` — `listBoardPosts`(:65) · `loadMyCommunityBoardPosts`(:92) · `countMyCommunityBoardPosts`(:138) · `getBoardPost`(:173, dead) | `community_posts` + `firstReadableTable`/`selectOrdered` 프로빙 | **V1** | **C1 전환** |
| `lib/community/communityBoardQueries.ts` — `loadBoardComments`(:450) | `comments` 직접 SELECT + `users` 라벨 보강 조회 | **V2** | **C1 전환** |
| `lib/auth/mentorPublicRead.ts:76,110,138` | RPC 3종(`mentor_directory_list_v2`·`mentor_profiles_for_directory_v2`·`mentor_user_public_v2`) | **V3** | **C1 전환**(간접 호출부 20여 곳 투명 승계) |
| `lib/cash/cashQueries.ts` — `fetchWalletBalanceByUserId`(:34) · `fetchCashLedgerForUser`(:53) | `wallets/…/cash_wallets`·`cash_ledger/…` 테이블·FK 프로빙 + 재정렬 폴백 | **V4·V5** | **C1 전환** |
| `lib/mypage/studentActiveSubscriptions.ts` — `loadActiveSubscriptionsForStudent`(:168) · `countActiveSubscriptionsForStudent`(:254) | `subscriptions` 직접 SELECT | **V6 RPC** | **C1 전환** |
| `lib/subscribe/subscribePageQueries.ts:151-258` — `fetchSubscriptionForPair`·`fetchLatestPaymentProbe`(SUB_TABLES/PAY_TABLES 프로빙) | 결과 필드가 모든 호출부에서 미사용(사장) 실측 | (제거) | **C1 전환**(프로빙 삭제) |
| `lib/mentor/subscriptionSettlementItems.ts` — `loadSubscriptionSettlementRowsForMentor`(:106) | `subscription_settlement_items` 직접 SELECT + **service_role 무음 fallback**(:117) | **V7 RPC** | **C1 전환**(fallback 제거) |

### 2.5 비활성·테스트 전용 / 범위 밖 직접 접근(변경 없음 — 기록만)

- e2e 전용 직접 접근: `e2e/**`(service_role) — 테스트 전용.
- dead code 중 전환에 포함: `listUserScrapPosts`·`getBoardPost`·`getShortformPost`(숏폼은 미전환).
- 관리자·service_role 경로(계약 §17/§18 유지): `adminCommunityContentQueries`·`adminReportEvidence`(comments 이중 조회)·`loadSubscriptionSettlementRowsForAdmin`·`refreshSubscriptionSettlementItemsBestEffort`·정산 배치·`subscriptionRenewalBatch` 등.

## 3. 전환 내역 (C1~C4)

공통: `lib/apiWebV1/rpc.ts` 신설 — `api_web_v1` 스키마 상수·envelope 정규화(§8 —
`ok` 부재를 성공으로 간주하지 않음, 사전 밖 예외 전파 유지, fallback 부재).

- **C2**: `weeklyQuestionUsage.ts` 재작성 — `fetchWeeklyQuestionUsageSelf`(F1
  `weekly_question_usage_self(p_mentor_id)`) / `fetchWeeklyQuestionUsagePairParty`
  (레거시 유지 경로 — JS fallback 없음) 분리. 구 JS fallback(구독 페어 프로빙·
  `question_threads` 직접 집계·`pickExistingColumn`·`QUESTION_THREADS_ROOM_FK_CANDIDATES`)
  전부 제거. 무료 질문권 스냅샷은 RPC 실패 폴백이 아니라 **정본 판정(활성 구독 없음)**
  에 따른 표시 경로로만 유지(`free_question_usage` 는 V1~V7 대상 아님).
- **C3**: `freeQuestionRoom.ts` 재작성 — F2 `ensure_free_question_room(p_mentor_id)`
  단일 호출(학생 세션). JS 승인·자격 게이트, service_role 직접 INSERT, 컬럼 프로빙,
  23505 재조회 전부 제거(자격·원자성은 F2→F10 서버 판정 — 계약 §7 F2 오류코드 12종 매핑).
- **C4**: `createQuestionThreadViaRpc` — F3 envelope 사용(`ok:false → code` /
  `FREE_QUOTA_*` 수렴 코드 그대로 기존 문구 매핑 / 사전 밖 예외는 error 경로 유지).
- **C1**: §2.4 표 그대로 — V1(폴백 2종·프로빙 제거, `image_refs` 정본 키, deleted
  필터 view 소유), V2(정본 `comments` 만 — `users` 보강 조회 제거, `body` 수렴,
  `author_label` 비정규화 신뢰), V3(구 RPC 3종 → 1 view + adapter: 행 존재 = 승인
  판정식 통과이므로 `verification_status='approved'` 합성, `full_name` 등 PII 비수신),
  V4/V5(프로빙·재정렬 폴백 제거, `order_ref` 를 원장 참조 표시 1순위로 추가 — W3
  가시화), V6(RPC 자체 당사자 판정 — `student_id` 인자 사용 중단), V7(RPC 자체 판정 —
  service_role 무음 fallback 제거, 내부 참조 컬럼 비노출).

행동 변화(계약 준수에 따른 것 — 기록):

1. 게시판 카드 `hashtags` 는 빈 배열이 된다 — V1 에 해시태그 필드가 없다(계약 §17 #6
   — `community_hashtags` 경로는 V1 미포함, §23 U-12).
2. 랜딩·me 목록의 board 읽기가 V1 노출 조건(미삭제 AND (published OR 본인))을 따른다
   (구 경로는 무필터 — T-SEC-10 방향의 교정).
3. V3 소비부의 프로필 행에 `is_open_for_subscriptions`·`avg_rating`·`review_count` 가
   실릴 수 있게 됐다(정본 필드 — 구 RPC 는 미제공).
4. V7 소비 행에서 `payment_id`·`ledger_id`·`billing_event_id`·`student_id`·`mentor_id`·
   `updated_at` 이 사라졌다(§6 V7 의도된 비노출; 소비부는 `billing_at` 폴백 체인으로 무영향).

## 4. 검증 결과

| 항목 | 결과 |
|---|---|
| TypeScript typecheck (`npx tsc --noEmit`) | **0 오류** |
| lint (`npm run lint`) | **0 오류** |
| 계약 단위 테스트 (`npm run test:contract`) | **271/271 PASS** |
| production build (`npm run build`) | **성공** |
| `git diff --check` | 통과 |
| 정본 해시 불변(계약·manifest 3건·M9 2건·Batch A~E SQL) | **불변**(변경 파일 목록에 `supabase/**`·`docs/contracts/**`·manifest 0건) |
| fixture 잔여 | **0** (`s2w1-vf-%` 삭제 실측) |
| 원격 DB·운영 Data API 변경 | **0건** |

### 4.1 격리 로컬 Data API 게이트 (`D_API_W_LOCAL`)

격리 로컬 스택(@187 = Batch E 완료 상태) + **독립 PostgREST v12.2.3 컨테이너**
(repo `supabase/config.toml` 무변경 — `PGRST_DB_SCHEMAS="public,graphql_public,api_web_v1"`,
`core_private`·`api_app_v1` 비노출, 로컬 한정 임시 기동 후 제거):

| 검증 | 결과 |
|---|---|
| V1 `community_posts_v1` (anon) · V2 `community_comments_v1` (anon) · V4/V5 (학생 JWT) | **200** |
| V3 `mentor_directory_v1` (anon) — 승인 멘토 행 반환 | **200** |
| V6 `my_subscriptions_self` · V7 `mentor_settlement_self` (학생 JWT) | **200** |
| F1 `weekly_question_usage_self` (학생 JWT) | `{ok:true, contract_version:1, …}` |
| F2 `ensure_free_question_room` (학생 JWT) | `{ok:true, created:true, entitlement:"free", room_id}` |
| F3 `qna_create_question_thread` (학생 JWT) | `{ok:true, path:"free", used_free_quota:true, thread_id, message_id}` |
| `core_private` 직접 REST (`Content-Profile: core_private`) | **거부 — PGRST106** (노출 목록 밖) |
| F1 anon 호출 | **401** (EXECUTE 0) |
| 정상 계약 요청에서 `PGRST106`/`PGRST002` | **0건** |

로컬 한정 보정: V1·V2·V4·V5 는 invoker view 라 기반 테이블의 클라이언트 GRANT 를
그대로 쓰는데, 로컬 auto-expose 기본값에는 라이브의 레거시 SELECT grant 가 없다
(Batch A 검증기 이래 반복 실측). 라이브 상태 재현을 위해 로컬 스택 한정으로
`community_posts`·`comments`(anon·authenticated)·`cash_wallets`·`cash_ledger`
(authenticated) SELECT 를 부여했고 검증 후 원상 회수했다. 운영·스테이징 접근 0건.

## 5. C10 에 남긴 프로빙·직접 읽기 잔여 목록 (이번 범위 밖 — 후속 단계)

- 공용 helper 자체: `lib/qna/safeSelect.ts`(`pickExistingColumn`·`rowsFromSupabaseData`) —
  전체 삭제는 C10.
- `lib/subscribe/subscribeCheckoutService.ts`: `SUB_TABLES` 프로빙·`findActiveSubscriptionForPair`
  (checkout·qna 사전 게이트 사용 — F12 전환(C8) 때 정리; V6 는 `student_id` 를 반환하지
  않아 멘토 측 페어 판정 대체 불가), `ensureMentorStudentRoom`(C8 — F12 흡수),
  payments intent 컬럼 프로빙(C8), `fetchRoomsForUser`.
- `lib/qna/questionThreadSubscriptionGuard.ts`·`questionRoomThreadService.ts` 의
  `findActiveSubscriptionForPair`·`mentor_student_rooms` 직접 조회(사전 게이트 UX —
  집행 정본은 F2/F3 서버측; W2/C10 후보).
- `lib/community/communityQueries.ts` `firstReadableTable`/`selectOrdered` — 숏폼 4함수
  한정 잔존(V1 대상 아님). `lib/cash/cashQueries.ts` `firstReadableTable` —
  `fetchCashTopupPackages`·`fetchRecentPaymentsForUser`(계약 view 없음 — 유지).
- `lib/mypage/studentActiveSubscriptions.ts` `fetchUsageCountersBySubscriptionId`
  (`subscription_usage_counters` 프로빙 — 계약 밖).
- `lib/subscribe/subscribePageQueries.ts` `fetchPromotionsProbe`(promotions 계열 — 계약 밖).
- `lib/mentor/mentorPayoutsQueries.ts`(`custom_order_settlement_items`·`subSummary`
  프로빙 — V7 대상 아님), `lib/mentor/publicMentorsListQueries.ts` 통계 프로빙
  (`mentor_stats`·`reviews_summary` 계열 + `mentor_profiles` 통계 컬럼 직접 읽기).
- qna 방·스레드·알림·리뷰·IQ·맞춤의뢰·관리자 직접 읽기 일체(계약 §17 유지 행).

## 6. 판정

```text
S2_2_TRANSITION_W1_C1_CODE: PASS_LOCAL
S2_2_TRANSITION_W1_C2: PASS_LOCAL
S2_2_TRANSITION_W1_C3: PASS_LOCAL
S2_2_TRANSITION_W1_C4: PASS_LOCAL
D_API_W_LOCAL: PASS
D_API_W_REMOTE: NOT_STARTED
C10_GLOBAL_PROBING_REMOVAL: NOT_STARTED
S2_2_TRANSITION_W1: COMPLETE
READY_FOR_S2_2_TRANSITION_W2: YES
READY_FOR_S2_2_BATCH_F: NO
```

이 완료는 **웹 C1~C4 코드의 로컬 전환 완료만** 뜻한다 — 앱 전환·운영 Data API 노출
(D-API-W 원격)·배포·Batch F 완료를 의미하지 않는다. 운영 반영은 D-API-W(플랫폼 단계)
이후에만 가능하다.
