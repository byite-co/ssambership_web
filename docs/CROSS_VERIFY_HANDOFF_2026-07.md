# CROSS_VERIFY_HANDOFF_2026-07 — 웹×앱 2차 크로스 검증 인계 보고서

> **성격**: 최종 게이트(2차 크로스) 검증의 **부분 완료·인계 스냅샷**. 새 판정 추가가 아니라 현재까지 수행·확인한 것의 고정 기록.
> **중단 사유**: 검증 세션이 정책상 다른 모델로 자동 전환 → 컨텍스트 소실 방지를 위한 디스크 고정.
> **동일 문서**를 웹·앱 양 레포에 커밋한다(레포별 상이 섹션 없음 — 전 인계 공용).

---

## §0 머리말

| 항목 | 값 |
|---|---|
| 웹 기준 커밋 | `2a3cc5a4501b0614984f9f5ff682a91ec8329749` (main 동일) |
| 앱 기준 커밋 | `5b9c607f9ef8bde831aecdfd5b4fceec26361e8f` (master 동일) |
| 인계 브랜치 | 양 레포 `verify/cross-final-2026-07` |
| 검증 환경 | 헤드리스 컨테이너 · Node 22 / Flutter 3.44.6 / **네이티브 Postgres 16(로컬 Supabase 대체)** |
| 운영 DB 접속 | **하지 않음**(정책). 라이브 대조는 마이그레이션 재현본(`ssam_verify`) 한정 |

검증 원칙 준수: 코드·스키마·픽스처 무수정, 산출물은 본 문서뿐. grep 매치만으로 판정하지 않고 파일을 실제로 열어 문맥까지 읽고 판정함. 확인 못 한 것은 '요재확인/미확인(사유)'으로 분류.

---

## §1 Phase별 진척

| Phase | 상태 | % | 요지 |
|---|---|---|---|
| **0** 기준선·빌드 게이트·기존 문서 정독 | ✅ 완료 | 100% | 커밋 해시 고정, 3대 게이트 재현, 앱·웹 QA 문서 전량 정독 |
| **1** DB 계약 정본·스키마 인벤토리(부록 A) | 🟢 부분 | ~90% | 마이그레이션 재현(121/122), 인벤토리·양 레포 접점 추출 완료. 099/reviews 계보 독립검증만 잔여 |
| **2** 클라이언트별 접점 전수(부록 B) | 🟡 재료완비 | ~70% | 웹·앱 touchpoint 파일 완성(§4). **통합 매트릭스 표 미작성** |
| **3** 크로스 정합 10관점 | 🟡 부분 | ~40% | 돈경로·첨부·웹브릿지·주간한도·값어휘(부분) 판정. 잔여 6관점 §5 |
| **4** 레포별 델타 재검증 | 🟡 부분 | ~60% | 앱 QA-01~04·14·09·16 재판정, 웹 이전 P1 2건 해소 확인. 가격필터 버그 등 잔여 |
| **5** 보고서·적대검토·PR | 🟠 인계본만 | 10% | 본 인계 문서 작성. 정식 `CROSS_VERIFY_2026-07.md`·적대검토·최종 PR 미착수 |

---

## §2 빌드 게이트 재현 결과 (그대로 기록)

### 웹 (`/home/user/ssambership_web`, `npm ci` 완료)
- `npx tsc --noEmit` → **통과(exit 0)**.
- `npm run build`(next build) → **성공**. 정적/동적 합 **161 라우트** 생성(`scratchpad/web_routes.txt`에 전량 기록).
- `npm run lint` → **실패(exit 1)**: 118 problems = **에러 44 + 경고 74**. 에러 분류:
  - React 19 룰: `Calling setState synchronously within an effect`(다수), `Cannot call impure function during render`, `Cannot create components during render`.
  - Next 룰: `@next/next/no-html-link-for-pages`(1건, `/custom-request/` `<a>` 사용).
  - TS 룰: `@typescript-eslint/no-explicit-any`(다수), `prefer-const`(r1/r2).
  - 경고: `@typescript-eslint/no-unused-vars` 등.
  - **주의**: `next build`는 통과하나 `next lint`는 실패 → 게이트 관점에서 lint는 **부적합(P2급, 대부분 신규 룰)**. 기능 결함 직결 근거는 미확보(요재확인).

### 앱 (`/home/user/ssambership-app`)
- `flutter pub get` → 정상(16개 패키지 제약 뒤처짐, 아래 §3 참고).
- `flutter analyze` → "**68 issues**" 이나 **에러 0**. 내역: info(`prefer_const_*`) 67 + warning 1(`asset_does_not_exist`: `.env` 부재 — 픽스처 미존재라 검증용으로 `.env.example`→`.env` 복사 후 테스트 실행. 이 `.env`는 gitignore 유지, 커밋 안 함).
- `flutter test`(기본) → **All tests passed! (331)**.
- `flutter test --dart-define=IQ_CREATE_ENABLED=true` → **All tests passed! (331)**.
  - (참고: QA_REPORT는 283, HANDOFF는 250으로 표기 — 테스트 수가 331로 증가. 문서 스테일.)

### 로컬 DB (Docker 차단 → 폴백)
- `npx supabase start` → **실패**: 모든 supabase 이미지 pull이 레지스트리에서 `Forbidden`(ghcr/ecr/cloudfront). 컨테이너 네트워크 정책 제약.
- **폴백**: 네이티브 **PostgreSQL 16** + 손수 작성한 Supabase 스텁(`scratchpad/stub_supabase.sql`: `auth` 스키마·`auth.uid()`/`auth.role()`/`is_admin` 계열, `storage.buckets`/`storage.objects`+`foldername`/`filename`, 역할 `anon`/`authenticated`/`service_role`, `supabase_realtime` publication).
- **재현 결과**(`scratchpad/replay.sh`, DB명 `ssam_verify`): 웹 `supabase/sql`의 적용대상 122파일을 번호순(002 계열은 `README_002_apply_order.md` 순서 보정, 036 '즉시적용금지 초안' 제외)으로 순차 적용 → **ok=121 / fail=1**.
  - 유일 실패 = `042_reviews_system.sql`(및 연쇄로 `045`): `reviews` 이중정의 계보 이슈(§3 XV-REVIEWS). `004`가 먼저 `reviews(author_id…)`를 만들고 `042`는 `create table if not exists`라 no-op → `042`의 `student_id` 참조 정책이 컬럼 부재로 실패. 이는 **발견**으로 기록(빌드 결함 아님).
- 재현 DB 최종 상태: **테이블 68 · 정책 191(public+storage) · 함수 151(public) · 버킷 12(11 private + `profile-avatars`만 public) · realtime publication 포함 테이블 0**.

---

## §3 확정 발견 목록 (근거 포함)

> 상태 범례: **실증됨**(라이브 재현·쿼리로 확인) / **유력**(코드 정독으로 강한 근거) / **요재확인**(부분 근거·운영 대조 필요).

### 🔴 XV-01 (P0 후보) · 학생/멘토가 스스로 관리자로 권한 상승 — **실증됨** (운영 일치만 미확인)
- **크로스레포**: 아니오(웹 DB 계약). 단 앱·웹 모두 `users.role`을 admin 판정에 신뢰하므로 영향은 공용.
- **근거(정본)**:
  - `users_update_own` 정책(정의 `supabase/sql/001_initial_auth_profile.sql`): `pg_policies` 실측 = `UPDATE {authenticated} USING (id = auth.uid()) WITH CHECK (id = auth.uid())` — **role 컬럼 제약 없음**.
  - CHECK 제약 `users_role_check`: `CHECK ((role = ANY (ARRAY['student','mentor','admin'])))` — **'admin' 허용**.
  - `public.users` 트리거: `trg_users_set_updated`(set_updated_at)만 — **role 변경 방지 트리거·컬럼 REVOKE 부재**(pg_trigger + `\d`).
  - `users` UPDATE 정책을 정의/교체하는 파일은 `001`, `102`뿐. `102_account_status_management.sql`는 `(status, suspended_until)` 인덱스/관리자 상태변경만 — 자가 role 변경 미차단.
  - 이연 초안 `036_p1_prelaunch_rls_tightening.sql`는 `custom_order_revisions`·`disputes`만 다룸 — **users.role 무관**(헤더+grep 확인).
  - `is_admin()`(SECURITY DEFINER) = `select u.role='admin' from public.users u where u.id=auth.uid()`. 웹 `lib/auth/routeGuard.ts:41-58 requireRole('admin')`는 `users` 프로필 role을 신뢰.
- **재현 절차**(ssam_verify, 실행 로그 확인):
  ```sql
  -- 사전(Supabase 기본 재현): grant all on all tables in schema public to anon, authenticated;
  BEGIN;
  select set_config('request.jwt.claim.sub','<학생본인 uuid>', true);
  select set_config('request.jwt.claim.role','authenticated', true);
  set local role authenticated;
  select auth.uid(), public.is_admin();                 -- before = f
  update public.users set role='admin' where id='<학생본인 uuid>';  -- => UPDATE 1
  select role from public.users where id='<학생본인 uuid>';         -- => admin
  select public.is_admin();                             -- after = t
  ROLLBACK;
  ```
  결과: **UPDATE 1 성공, is_admin() before=f → after=t**.
- **노출면**: 브라우저측 `lib/auth/syncAfterSignUpSession.ts:45` 가 `supabase.from("users").upsert({ id, role: i.role, … })`를 anon/유저스코프 클라이언트로 수행(role이 클라이언트 입력). 가입 이후 임의 UPDATE로도 상승 가능.
- **미확인**: 운영 DB의 정책 실상태가 재현본과 동일한지(운영 접속 금지). 단 마이그레이션 정본상 결함은 명백. **다음 세션에서 적대적 재검증 필수**(§6).
- **권고**: 출시 전 차단. `users` UPDATE에 role 컬럼 변경 금지(트리거 `OLD.role = NEW.role` 강제 또는 컬럼 GRANT 분리), 가입 role은 서버 전용 경로/`auth.users.raw_user_meta_data`→트리거로만 설정.

### 🟠 XV-ATTACH (P1/P2 후보) · 질문방 첨부 계약 웹↔앱 비대칭 — **유력**
- **크로스레포**: 예.
- **웹**: `lib/qna/questionRoomAttachmentDisplay.ts` `buildAttachmentMessageBody` → 메시지 **본문에 마커** `[[img]]{url}` / `[[file]]{filename}|||{url}` 저장. 렌더 `components/qna/QuestionRoomStudentDesignWorkspace.tsx:85 renderMessageContent`가 **본문 마커만 파싱**해 인라인 표시. 추가로 `questionRoomAttachmentStorage.ts:82`가 `question_attachments` 행 best-effort insert(thread_id·message_id·storage_path·file_name·mime_type). 서명 URL TTL `lib/storage/signedStorageUrl.ts` `DEFAULT_TTL_SEC = 60*60*24*7`(**7일**)이 본문 URL에 박혀 저장.
- **앱**: `lib/features/question_room/ui/chat_screen.dart` `_send`는 본문 텍스트만 전송, 이미지는 별도 업로드(`attachment_upload.dart:124` `question_attachments` 행 insert). **본문에 `[[img]]` 마커를 넣지 않음.** 렌더 `live_message_list.dart`가 `question_attachments` 행을 `message_id`로 조인→`MessageImageAttachment`(storage_path에서 **1h 재서명**, `attachment_url_resolver.dart`). `message_bubble.dart`는 본문을 그대로 렌더.
- **판정**:
  - **웹→앱**: 웹이 넣은 `[[img]]{url}` 본문이 앱 말풍선에 **raw 텍스트로 노출**(앱은 마커 파싱 없음). 동시에 웹의 `question_attachments` 행이 있으면 앱은 이미지 썸네일도 표시 → 원문 URL 텍스트 + 썸네일 중복.
  - **앱→웹**: 앱은 본문 마커가 없고 `question_attachments` 행만 → 웹 `renderMessageContent`는 본문만 보므로 **인라인 미표시**. 웹 채팅 표시 경로가 `question_attachments` 테이블을 읽지 않음(grep: 웹의 `question_attachments`는 insert 1곳뿐, 표시 조회 없음).
  - **7일 TTL**: 웹은 만료 후 자기 본문 저장 URL이 깨짐(앱은 1h 재서명이라 무관).
- **미확인/요재확인**: 웹이 `question_attachments`를 다른 화면(비-workspace)에서 읽는지 전수는 부분 확인. 실제 두 클라이언트가 같은 방에서 상호 첨부를 렌더하는 라이브 시나리오는 미실행.
- **권고**: 본문 마커 규약을 양 클라이언트 공통화(둘 다 `question_attachments` 행 기준 렌더로 통일 권장) + 표시시점 재서명 통일.

### 🟠 XV-REFUND (P1 후보) · 환불 승인 RPC 회귀(099) — **요검증**(서브에이전트 발견·미독립검증)
- **크로스레포**: 아니오(웹 DB).
- **주장**: `approve_refund_request_admin`이 `030`(직접 refund_credit)→`056`(에스크로 분기: `record_custom_order_escrow_refund` 위임, 이중지급 방지)→**`099`**로 재정의되며, 099가 "030 본문 verbatim + 구독 가드"라서 **056의 에스크로 분기가 소실** → escrowed 맞춤의뢰 환불이 다시 직접 refund_credit 경로로 흘러 **이중 적립 위험**.
- **상태**: 스키마 인벤토리 서브에이전트의 정독 결과. **본 검증자가 030/056/099 본문 diff와 라이브 최종 함수 본문을 독립 확인하지 못함** → 다음 세션 최우선 검증 대상.
- **권고**: `ssam_verify`에서 `pg_get_functiondef('approve_refund_request_admin')` 확인 + 웹 관리자 환불 경로가 escrowed 주문에 어느 RPC를 태우는지 추적.

### 🟡 XV-REVIEWS (P2 후보) · reviews 테이블 이중정의·스키마 드리프트 — **유력(운영 실형상 요재확인)**
- `004_p0_cash_disputes_admin_draft.sql:150` `reviews(mentor_id→users, author_id→users, rating smallint, body)`.
- `042_reviews_system.sql:2` `create table if not exists reviews(mentor_id→mentor_profiles, student_id→auth.users, subscription_count, rating, content, mentor_reply, is_hidden…)` — 004 선적용 시 **no-op**.
- 재현본 최종 형상 = **004형(author_id)**. 그래서 042의 `student_id` 참조 정책·045의 정책이 재현 replay에서 실패(§2). 웹 `lib/reviews/reviewQueries.ts:184-190 createReview`는 `author_id`로 insert, `reviewRowMapper.ts:24-29`는 `author_id||student_id` 폴백 + `pickExistingColumn("reviews", ["subscription_count"])`로 042 컬럼 부재를 방어.
- **판정**: 웹 코드는 두 형상 모두에 방어적. 다만 **정본이 두 갈래**라 프레시 재구축(004형) vs 운영 수동적용(042형 가능)이 갈릴 수 있음 → 라이브 실형상은 **요재확인**(운영 접속 없이 불가). 앱은 reviews 미사용(touchpoints_app).

### 🟡 XV-PRICE (P2/P3 후보) · 요금제 라벨·가격 드리프트 — **유력**
- 잠금값(CLAUDE.md): `베이직/스탠다드/프리미엄`, **55,000 / 114,900 / 249,900**, tier id `limited/standard/premium`.
- 웹 `lib/subscribe/subscribePlanCatalog.ts:17-36`: label **`라이트`**, cashKrw **29,900 / 84,900 / 179,000**.
- 웹 `lib/subscribe/mentorPlanPricing.ts:12-28`: recommended **55,000 / 114,900 / 249,900**, 밴드 min 39,900/84,900/189,900·max 69,900/149,900/329,900.
- 앱 `lib/features/mentors/format/mentor_price_format.dart:23` = **`라이트`**, `lib/shared/constants/plan_constants.dart`는 라벨/가격 전부 빈값(미확정 규약 준수).
- **판정**:
  - 실제 구독 차감액은 `subscribeCheckoutService`→`mentorPlanDebitAmountCents(planRow, tier)`로 **멘토 플랜 행**에서 유래(카탈로그 29,900 아님) → 결제 금액 오류 근거는 미확보.
  - 그러나 카탈로그 29,900/179,000이 랜딩·구독·비교카드(`app/(student)/subscribe/page.tsx`, `components/subscribe/PlanComparisonCards.tsx`, `components/landing/PublicGuestLanding.tsx`)에서 **표시**될 수 있음 → 잠금값(55,000)과의 **표시 드리프트**. 실 노출 화면 확정은 요재확인.
  - 라벨 `라이트`는 웹·앱 **일치**하나 잠금 `베이직` **위반**(양 클라 동일 위반이라 크로스 불일치는 아님).
- **권고**: 잠금값과 카탈로그 표시가·라벨 통일(정본 확정 후 일괄).

### 🟢 XV-MONEY · 돈 경로 견고(Commerce-Zero 유지) — **실증됨**
- `ssam_verify` GRANT 실측(`has_function_privilege`): `record_subscription_cash_debit`·`record_cash_topup` = anon **f** / authenticated **f** / service_role **t**. `create_individual_question_as_student`(SECURITY DEFINER 래퍼) = authenticated **t**(자기-학생 한정, `092_..._wrappers.sql:150-152` REVOKE public/anon/authenticated → GRANT authenticated).
- 돈 테이블 RLS 활성 실측: `cash_ledger`/`cash_wallets`/`subscriptions`/`payments`/`individual_questions` 전부 relrowsecurity=t. 앱은 캐시/구독 직접 DML 없음(touchpoints_app: 전부 SECURITY DEFINER RPC 위임).
- **예외 1건(유력·요재확인)**: 웹 `lib/account/accountDeletionActions.ts:60-76`가 계정삭제 시 `cash_ledger` INSERT + `cash_wallets` UPDATE(잔액 0화)를 **RPC 아닌 직접 DML·비원자적**으로 수행(웹 접점 서브에이전트 보고). 돈경로 단일화 취지의 국소 예외 → §6에서 재검토.

### 🟢 웹 이전(2026-06-19 functional_coverage) P1 2건 해소 — **실증됨(코드 정독)**
- routeGuard `profile===null` 미차단(P1, functional_coverage:179) → **해소**: `lib/auth/routeGuard.ts:46-48` `if (!profile) redirect(...)`.
- toss 웹훅 payload 로그 노출(P1, :180) → **완화**: `app/api/toss/webhook/route.ts:58-66 webhookLogData`가 orderId/status/totalAmount/method + `maskPaymentKey`만 로깅(전체 payload 미기록).

### 🟢 앱 QA 재판정 (QA_REPORT_2026-07 대비 델타) — **실증됨(재스캔)**
- **QA-02**(raw `$e` 13화면 노출) → **해소**: `grep '(\$e)' lib/` = **0건**. 공용 헬퍼 `lib/shared/errors/friendly_error.dart` 존재(`friendlyError(e)`), 화면들이 이를 사용.
- **QA-04**(알림 읽음 owner 필터 부재) → **해소**: `notifications_repository.dart markRead/markAllRead`에 `.eq('user_id', uid)` 존재. DB `notif_update_recipient_read` 정책(다중 owner 컬럼: user_id/recipient_id/student_id/mentor_id/target_user_id/owner_id) 실측 확인.
- **QA-03**(README·HANDOFF IQ 자기모순) → **해소**: `README.md:8`이 "개별질문(IQ)은 2026-07 하단 1급 탭 승격"으로 갱신.
- **QA-16**(notif 헤더 스테일 주석) → **잔존(P3)**: `notifications_screen.dart:70` 주석 "CR·환불·IQ 이중 방어 제외"가 여전. 단 `classifyNotificationType`은 `individual_question`/`iq_`를 `individualQuestion` 종류로 분류하고 `inAppScope`에 포함 → **동작은 정확**, 주석만 오해소지.
- **QA-09**(dead code) → **잔존(P2)**: `health_repository.dart`·`empty_screen.dart`·`onboarding_screen.dart` 존재. `openSubscribeWeb`/`openRechargeWeb` 정의 존재하나 **호출부 0건**(grep) — 재배선 시 컴플라이언스 재위반 위험.
- **QA-14**(deprecated `withOpacity`) → **잔존(P3)**: 5곳(`skeleton.dart:44`·`status_pill.dart:70`·`app_badge.dart:27`·`initial_avatar.dart:37`·`cash_section.dart:95`).
- **시크릿·로그 재스캔**: `print`/`debugPrint` **0건**, 하드코딩 JWT/`sk_live`/`service_role` **0건**(lib/·android/·ios/).

### 🟢 서브에이전트 오판 교정 · 웹브릿지 10경로 전부 실존 — **실증됨**
- 앱 접점 추출이 5경로(`/subscriptions`·`/mentor/profile`·`/account/delete`·`/mentor/reviews`·`/support`)를 "웹에 없음"이라 보고했으나, `next build` 161-라우트 매니페스트(`scratchpad/web_routes.txt`) 대조 결과 **10경로 전부 실존**: `/subscribe`·`/wallet/charge`·`/subscriptions`·`/mentor/payouts`·`/mentor/profile`·`/legal/terms`·`/legal/privacy`·`/support`·`/mentor/reviews`·`/account/delete`. → 웹브릿지 경로 참조무결 **정합**.

### 🟡 주간 질문 한도 서버강제 부재(CANON A2) — **실증됨**
- `get_weekly_question_usage(uuid,uuid)` = SECURITY DEFINER **존재**(ssam_verify). `098_weekly_usage_count_on_create.sql`가 소비시점을 '작성(created_at)'으로 확정.
- `question_threads` INSERT **트리거 없음**(pg_trigger: `trg_qt_set_updated`만) → 한도는 **앱계층 검사만**. 웹(`questionRoomThreadService`)·앱(`new_question_screen.dart:68-84` can_ask=false 차단, RPC 실패 시 보수적 진행) 둘 다 클라측 검사 → **직접 INSERT 우회 가능**(양 클라 코드가 이 한계를 주석으로 인지). 쓰기 경로는 양측 직접 DML로 **대칭**.
- **권고**: 서버측 강제(INSERT 트리거/전용 RPC)는 출시 후 백엔드 보강(P2).

### 참고 · 스레드 FK 컬럼 정합
- 라이브 `question_threads` FK 컬럼 = `mentor_student_room_id`(information_schema 실측). 앱은 `mentor_student_room_id` 직접 사용(정합). 웹은 후보목록 `[room_id, mentor_student_room_id, …]`(`lib/qna/questionThreadRoomRef.ts`)로 방어 — 첫 후보 `room_id`는 라이브에 없고 2순위가 매칭. 고아 참조 아님.

### 참고 · 의존성 취약점(요약)
- 웹 `npm audit --omit=dev`: **4건(moderate 1 / high 3)**. high = `next`(다수 advisory: DoS·middleware bypass·cache poisoning·XSS), `ws`(fix 가능), `xlsx`(fix 없음). → next 업그레이드 권고(P2).
- 앱 `flutter pub outdated`: 메이저 뒤처짐 `go_router 14→17`, `flutter_dotenv 5→6`, `flutter_lints 4→6`, `flutter_launcher_icons 0.13→0.14`. 보안 이슈 아님(P3).

---

## §4 이미 구축한 검증 자산 (부록 B 재료 · 위치·요약)

> ⚠️ 아래 원본 파일은 세션 스크래치패드(`/tmp/claude-0/-home-user/a097b8af-3501-5c6b-ac1d-a7017be7816f/scratchpad/`)에 있어 **세션·컨테이너 종료 시 소실 가능**. 다음 세션은 아래 요약을 기준으로 재생성하거나, 동일 방법으로 재추출할 것.

### (A) 스키마 인벤토리 — `scratchpad/inventory_schema.md`
- 테이블 67 정의(최종 63 + 미적용 4: `payout_runs`/`payout_run_items`/`user_deletion_log`/`user_blocks`) · RLS 정책 공개 ~120 + storage.objects 32 · 함수 ~85(돈이동 코어 21, authenticated 래퍼 8) · 버킷 12(11 private, `profile-avatars`만 public=true, `097`) · 트리거 ~45 · 뷰 1(`due_payouts`) · **realtime publication ALTER 0건**.
- 미적용/이연 파일(파일 주석 인용): `002_app_core_schema_draft`(참고DRAFT·적용금지), `036`(초안·즉시적용금지), `071`(one-off), `105`·`107`(DRAFT-미적용), `108`·`109`·`110`("★★★ DRAFT — DB 미적용 / 실행 금지 ★★★" 후불정산 배치), `115`·`116`("⚠️ 라이브 미적용 — 기능플래그 ON 배포 시 적용"). `106`은 헤더 DRAFT이나 `114`가 "라이브 기적용" 서술 → **모순(요재확인)**.
- **"서버 경화 SQL 2건" 지목 불일치**: 정확히 '2건'으로 열거한 정본 기록 **부재**. 문자적 후보 = 앱 `supabase/migrations/` 2파일(`20260707T0100_add_iq_attachment_rpc.sql`·`20260707T1130_add_iqa_storage_update_policy_annotations.sql`)이나 HANDOFF.md:59 기준 **둘 다 운영 적용 완료**. 실제 미적용 서버 SQL은 웹 **108/109/110(3건)**. → 다음 세션이 오너에게 '2건'의 정확한 지시대상 확인 필요.
- 인벤토리 서브에이전트 지목 Top(미독립검증 포함): ①환불 RPC 회귀(099, §3 XV-REFUND) ②reviews 이중정의(§3 XV-REVIEWS) ③앱 전용 운영객체(`add_individual_question_attachment` RPC·`iqa_storage_update_party_annotations` 정책)가 **웹 정본 트리에 없음** → 프레시 재구축 시 누락. 또 앱 HANDOFF가 주장하는 `connection_notes.ink_path/ink_thumb_path` 컬럼 DDL이 **양 레포 어디에도 없음**(무기록 드리프트 후보). ④수수료 비대칭: CR 분쟁분배 RPC(`057`)만 `v_fee_rate:=0.20` 잔존(구독 095=15%, IQ 096=15%, CR 090=5%). ⑤`profile-avatars`가 `039` private 감사 밖 유일 public 버킷.

### (B) 웹 접점 — `scratchpad/touchpoints_web.md`
- `.from()` 704(앱코드 534: 리터럴 345 + 동적/스키마프로브 189, e2e 170). `.rpc()` 58(고유 32종). storage 28콜/11버킷. **realtime 0**(웹은 `.channel`/`postgres_changes` 전무). **edge function 0**(`supabase/functions` 부재). auth 23(대부분 `lib/auth/getCurrentUser.ts:12`로 수렴, `admin.deleteUser` soft-delete `accountDeletionActions.ts:96`).
- 판정후보: ①`accountDeletionActions.ts:60-76` 유일 비-RPC 지갑쓰기(§3 XV-MONEY 예외) ②수수료 분배가 앱코드에 있음(`orderSettlementService.ts:161` 5% split 직접 insert; `refunds` insert `subscriptionCancelActions.ts:230`·`mentorActivityService.ts:203`) ③런타임 스키마 프로빙 189건(약한 계약, 무성 폴백) ④`syncAfterSignUpSession.ts:45` 클라이언트 `users.upsert(role)` → §3 XV-01 노출면 ⑤CLAUDE.md 버킷 문서 스테일(5버킷 미문서화, `profile-avatars` 의도적 public). ⑥긍정: 시크릿이 클라 번들에 안 샘(service_role `server-only`), 16 API 라우트·47 서버액션 전부 auth 체크, admin 액션 `requireRole("admin")` 커버(일부는 공용 헬퍼 경유). zod 없음(전부 수동 검증).

### (C) 앱 접점 — `scratchpad/touchpoints_app.md`
- 테이블 접점 60(리터럴 55/16파일 + 변수테이블 4), 27 명명 테이블. RPC 15종. 버킷 4. realtime 포트 1. edge function 1(미배포).
- RPC: mentor_directory_list_v2, mentor_profiles_for_directory_v2, get_mentor_avg_response_hours, mentor_user_public_v2, get_mentor_student_nicknames, get_weekly_question_usage, list_open_individual_questions_for_mentor, create_individual_question_as_student, claim_individual_question_as_mentor, answer_individual_question, release_individual_question, refund_individual_question, add_individual_question_attachment, increment_community_post_view, increment_shortform_post_view.
- 버킷/경로: `question-room-attachments` `{roomId}/{threadId}/{ts}_{safeName}`(upsert:false), `individual-question-attachments` `{questionId}/{ts}-{salt}.{ext}` + annotations upsert, `scan-annotations` `{roomId}/{attachmentId}/ink.json`(upsert), `connection-note-ink`(상수만·런타임 미사용).
- realtime: `question_thread_$threadId` 채널만(question_messages INSERT thread_id eq, question_threads UPDATE id eq).
- 게이트 기본값: `kIndividualQuestionEnabled=true`(순수 const), `kIndividualQuestionCreateEnabled=false`(IQ_CREATE_ENABLED), `kSubscriptionManageLinkEnabled=false`(SUBS_MANAGE_LINK_ENABLED), `WEB_BASE_URL` 기본 `https://ssambership-web.vercel.app`; push `_tableExists=false`·`_deployed=false`(둘 다 휴면).
- 판정후보(미독립검증 포함): ①직접 돈 DML 없음(에스크로 전부 DEFINER RPC)이나 open IQ의 `p_amount_cents` 클라 공급 ②`question_threads.status` 직접 UPDATE(`.eq('id')`만) — 학생/멘토 역할분리 앱계층뿐 ③thread INSERT 쿼터 무강제(§3) ④커뮤니티 insert에 `status:'published'/'visible'/'pending'` 클라 지정 ⑤`mentor_student_room_id`(앱) vs 웹문서 `room_id`(§3 참고에서 정합 확인) ⑥notifications가 `is_read`·`read` 양쪽 기록 ⑦plan 라벨 `limited='라이트'` vs 잠금 '베이직'(§3 XV-PRICE) ⑧멘토가 학생 subscriptions 읽음(`student_room_home_screen:72`) — 학생전용 RLS 하 무성 빈결과 ⑨IQ release/refund가 create 게이트 OFF 스토어빌드에서도 도달 가능.

### (D) 기타 재현 산출물
- `scratchpad/stub_supabase.sql`(Supabase 스텁), `scratchpad/replay.sh`(재현 스크립트), `scratchpad/replay_log_final.txt`(적용 로그), `scratchpad/web_routes.txt`(161 라우트), `scratchpad/web_build.txt`·`web_lint_full.txt`.
- 라이브 재현 DB: 네이티브 Postgres `ssam_verify`(동일 컨테이너 유지 시 재사용 가능; `sudo -u postgres psql -d ssam_verify`).

---

## §5 미확인·미실행 목록 (사유)

| 항목 | 사유 | 재개 방법 |
|---|---|---|
| 운영 DB 실상태 대조(XV-01 role, XV-REVIEWS 실형상, 106/114 모순, 스토리지 public 이력) | 정책상 **운영 접속 금지** | 오너가 SELECT 전용 쿼리로 대조(앱 `docs/DB_VERIFY_QUERIES.md` 패턴) |
| 로컬 Supabase 풀스택(realtime·storage·edge 실동작) | Docker 이미지 pull **Forbidden**(네트워크 정책) | 이미지 접근 가능 환경에서 `npx supabase start` |
| **Phase 3 잔여 6관점** | 시간·중단 | 아래 §6 재개지시 |
| — 값어휘 enum 3자 diff(전 도메인) | 부분만(라벨·status 일부) | `scratchpad/lens_enum.md`(백그라운드 에이전트 진행분, **미검토** — 완료 시 참고) |
| — RLS 실효성 표(역할별 JWT) | 미실행 | `scratchpad/lens_rls.md`(백그라운드 에이전트 진행분, **미검토**) |
| — 실시간·푸시 3자 대조(완결) | publication 0·device_tokens 부재만 확인, 앱 폴백 경로 상세 미완 | thread_realtime.dart + send-push 명세 |
| — 조회규약(정렬·페이지네이션·타임존) | 미착수 | 양 클라 목록 쿼리 order/range 비교 |
| — 환경변수 계약 3자 + 시크릿 재스캔(웹) | 앱측만 부분 | `.env.example`↔`app_config.dart`↔README, 웹 `.env*`↔config.toml |
| — 인증·세션·탈퇴 정합(완결) | 부분 | middleware.ts ↔ entry_guard.dart, /account/delete ↔ 앱 안내 |
| **Phase 2 통합 매트릭스 표** | 재료(§4 B·C)만 완비 | 행=DB객체 / 열=웹R·웹W·앱R·앱W·RLS·비고 로 조립 |
| XV-REFUND(099) 독립 검증 | 서브에이전트 발견만 | ssam_verify `pg_get_functiondef` + 웹 환불경로 추적 |
| XV-REVIEWS 운영 실형상 | 재현본은 004형 | 운영 대조 |
| **XV-01 적대적 재검증** | 실증됐으나 반증 미시도 | §6 ① |
| 가격필터 '0명' 버그 수정상태 | 코드 위치만 파악, 판정 미완 | `publicMentorsListQueries.ts` priceBand 블록 + tierPrices 충전경로 |
| lint 44에러 기능영향 | 룰 분류만 | 대표 파일 정독 |

---

## §6 다음 세션 재개 지시 (인계)

우선순위 순. 각 항목에 시작점 명시.

1. **XV-01 적대적 재검증 + 심각도 확정** (최우선)
   - 반증 시도: (a) authenticated에 `users.role` 컬럼-레벨 REVOKE가 있는지(`\dp public.users`, `information_schema.column_privileges`) (b) admin 판정이 `users.role` 외 소스(JWT app_metadata 등)에 의존하는지(`lib/auth/*`, `is_admin()`) (c) 회원가입 서버경로가 role을 서버측 재설정하는지.
   - 재현은 §3 XV-01 SQL 블록 그대로. 반증 실패 시 **P0 확정**, 운영 일치는 오너 대조로.
2. **Phase 3 잔여 6관점** — §5 표의 재개방법대로. 백그라운드 산출물 `scratchpad/lens_enum.md`·`lens_rls.md`가 존재하면 **검토 후** 채택(미검토 상태이므로 근거 재확인 필수).
3. **부록 B 통합 매트릭스** + **XV-REFUND(099)·XV-REVIEWS** 독립 검증(§4 A·B·C 재료 + ssam_verify).
4. **정식 보고서 완성**: `docs/CROSS_VERIFY_2026-07.md`(태스크 §5 구조: 판정요약 GO/조건부GO/NO-GO · 발견목록 · 부록A/B · RLS판정표 · 델타 · 미실행 · 잔여액션) → **독립 적대 검토 1회**(새 컨텍스트) → 반영내역 기록 → 양 레포 PR.
   - 현 잠정 게이트 심증: **조건부 NO-GO** — XV-01(P0 후보)이 운영에서 확인되면 출시 차단. 확정 전까지 GO 불가.

### 재개용 환경 메모
- 웹 `npm ci` 완료. 앱 `flutter pub get` 완료, 검증용 `.env`(gitignore) 존재.
- Flutter SDK: `/opt/flutter/bin`. Postgres 재현 DB `ssam_verify` 기동 중(재부팅 시 `service postgresql start` 후 `scratchpad/replay.sh` 재실행).
- 재현 스크립트가 042/045를 004형 reviews 기준으로 통과시키려면 `scratchpad/replay.sh`의 reviews 계보 처리 주석 참고(현재는 순수 번호순).

---

_(끝) 본 인계 문서는 현재까지 수행·확인한 것만의 고정 기록이며, '요재확인/미확인'은 통과로 승격하지 않았다. 이번 작업에서 제품 코드·스키마 변경 0건, 산출물은 본 문서뿐이다._
