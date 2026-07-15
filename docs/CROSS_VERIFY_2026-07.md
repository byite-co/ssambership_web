# CROSS_VERIFY_2026-07 — 웹×앱 2차 크로스 검증 (최종)

> 성격: 출시 전 최종 게이트 2차 크로스 검증의 **완료본**. 인계 스냅샷(`CROSS_VERIFY_HANDOFF_2026-07.md`)을 잇고, 그 사이 머지된 픽스(XV-01·XV-ATTACH·BUG-B)를 반영해 재기준화·재검증한 결과다.
> 원칙: 발견·재현·문서화만. 이 검증 자체는 제품 코드·스키마를 수정하지 않았다(산출물은 본 문서). 판정 근거는 파일:라인 / 마이그레이션 파일명 / 재현 DB 쿼리결과 / 실행 로그.
> 상태 범례: **CONFIRMED**(재현 DB·직접 검증) / **PLAUSIBLE**(서브에이전트 정독 근거, file:line 제시·미독립재현) / **미확인**(사유).

## §0 머리말

| 항목 | 값 |
|---|---|
| 웹 기준 커밋 | `378e6e5` (main; SQL 117·118·119 포함) |
| 앱 기준 커밋 | `c1b005f` (master; 첨부 v2 포함) |
| 재현 DB | 네이티브 PostgreSQL 16 · `ssam_verify`(웹 SQL 001..119 순차 재적용; **SQL120 미적용**=미머지 #31) |
| 재현 결과 | 적용 122건 중 **ok=121·fail=1**(fail=`042_reviews`—#31/SQL120 미머지 계보, 기지) |
| 인벤토리(재현 DB) | 테이블 68 · 정책 191(public+storage) · 함수 152 · realtime publication 포함 **1**(question_attachments만) |
| 운영 DB 접속 | 없음(정책). 라이브 대조는 재현 DB 한정 |

---

## §1 판정 요약 — **NO-GO** (XV-01 라이브 P0 미해결)

> 개정(적대 검토 반영): 초판은 XV-01을 SQL119로 폐쇄됐다고 보아 '조건부 GO'로 판정했으나, **독립 적대 검토가 가입(INSERT) 경로의 잔존 P0를 발견**했고 재현 DB로 실증됨(§2 XV-01, §적대검토 반영). 게이트를 **NO-GO**로 정정한다.

**미해결 P0 1건 — XV-01(가입 시 admin 자가 provisioning).** SQL119 가드는 `users` UPDATE 경로만 막고, 가입 트리거 `handle_new_auth_user()`는 클라이언트 가입 메타데이터의 `app_role='admin'`을 그대로 수용한다(필터가 `'admin'`을 화이트리스트). → **미인증 인터넷 사용자가 가입만으로 admin 계정을 만들 수 있다**(재현 DB 실증). 이 픽스 전에는 출시 불가.

- **XV-SCRAP(P1)** — 숏폼 스크랩이 DB CHECK 위반으로 상시 실패(CONFIRMED). 출시 전 '숨김 또는 DB 허용' 결정.
- **XV-REFUND(P2-잠재)** — 099 에스크로 분기 소실은 실재하나, `refunds`행에 `custom_request_order_id`를 세팅하는 경로가 제품에 없어(앱 insert 2곳 전부 구독 전용 + DB 함수 insert 0) **현재 도달 불가**. 맞춤의뢰 환불/분쟁환불 흐름을 출시하기 전 SQL 픽스 필요.

근거 요약: RLS 실효성 24개 시나리오 구멍 0 · 시크릿 누출 0 · 돈테이블 직접쓰기 차단 확인 · 캐시/에스크로 이동은 service_role RPC 단일경로 유지. 그러나 위 XV-01(권한 경계)이 게이트를 지배한다. 아래 §2.

---

## §2 발견 목록

### P0 (출시 차단) — 미해결 1

- **XV-01 · admin 권한 자가 provisioning — 🔴 미해결(가입 INSERT 경로)·CONFIRMED.**
  - **UPDATE 경로는 SQL119로 폐쇄됨**(부분): `trg_users_role_guard`(BEFORE UPDATE, `when old.role is distinct from new.role`)가 재현 DB에서 ① authenticated 학생 자가 `role='admin'` UPDATE → `ROLE_CHANGE_FORBIDDEN` 차단 ② role 무변경 UPDATE 통과 ③ service_role 변경 통과. 여기까지는 정상.
  - **그러나 가입(INSERT) 경로가 무방비**: `handle_new_auth_user()`(SQL `001`, `AFTER INSERT ON auth.users`, SECURITY DEFINER)가 `r := lower(trim(m->>'app_role'))`로 **클라이언트 가입 메타데이터**를 읽고, 유일한 필터 `if r not in ('student','mentor','admin') then r:='student'` — 즉 **`'admin'`을 명시적으로 허용**. SQL119는 UPDATE 트리거라 신규 가입 시 public.users **INSERT에는 발화하지 않음**.
  - **재현(재현 DB 실증)**: `insert into auth.users(..., raw_user_meta_data => '{"app_role":"admin"}')` → `public.users.role = admin`, `is_admin() = t`.
  - **도달성**: 웹 `lib/auth/buildSignupUserMetadata.ts` 가 `app_role: o.role` 를 `supabase.auth.signUp({ options:{ data }})`(`app/signup/page.tsx:344-347`)로 전송. GoTrue `/signup`은 임의 `options.data`로 공개 호출 가능하며 TS `Exclude<AppRole,"admin">`는 서버 통제가 아님 → **미인증 공격자가 signup 엔드포인트에 `app_role:"admin"`을 직접 실어 admin 계정 생성 가능.** `users` CHECK는 admin 허용, `users_insert_own` WITH CHECK는 `id=auth.uid()`만, BEFORE INSERT 가드 부재 → 다른 층에서도 안 걸림.
  - **조치(P0)**: `handle_new_auth_user()`의 role 허용목록에서 `'admin'` 제거(→ `('student','mentor')`만) 그리고/또는 `users`에 BEFORE INSERT role 가드 추가. admin은 서버 전용 경로로만 승격.
  - (초판 오판 사유: XV-01 검증이 UPDATE 벡터만 재현하고 가입/INSERT 벡터를 놓침 — 적대 검토가 교정.)

### P1 (출시 전 처리 권고)

- **XV-SCRAP · 숏폼 스크랩이 DB CHECK 위반으로 상시 실패 — CONFIRMED.**
  - 근거: DB `shortform_reactions_type_check = CHECK (type = 'like')`(재현 DB 실측) — scrap 불허. 그런데 앱 `community_write_repository.dart:62` `toggleShortformReaction`이 `type='scrap'`을 insert(`shortform_detail_screen.dart:102-114`에서 scrap 토글). → 매 스크랩 탭마다 `23514 check_violation`, 앱 catch가 `_scrapped` 상태를 revert(`:114`). **스크랩이 '되는 척' 하고 실패**. 웹은 숏폼 like만(scrap 없음) → 웹·DB는 정합, 앱만 계약 위반.
  - (기존 `docs/RELEASE_TRIAGE.md` D8 "조건부 차단"이 이번에 CONFIRMED로 확정.)
  - 조치(택1, 출시 전 결정): 앱에서 숏폼 스크랩 버튼 숨김 / DB CHECK에 `'scrap'` 추가(서버). 데이터 손상·보안 위험은 아님.

### P2 (다음 마일스톤)

- **XV-REFUND · 맞춤의뢰 에스크로 환불 회귀(잠재, 현재 도달 불가) — CONFIRMED(회귀)·도달성 반증됨.**
  - 회귀 실재: `056:177`이 `approve_refund_request_admin`을 에스크로 분기 포함(`:257-260` `perform record_custom_order_escrow_refund(...)`, 주석 "no refund_credit double pay")으로 재정의했으나, `099`가 헤더대로 *"Full 030 approve body reproduced verbatim + subscription guard만 삽입"* → 030 기반이라 **056 에스크로 분기 소실**(재현 DB 최종 함수에 `record_custom_order_escrow_refund` 호출 없음).
  - **그러나 현재 도달 불가(적대 검토 반증)**: 이중지급의 두 번째 크레딧은 `custom_request_order_id`가 설정된 `refunds`행이 있어야 발화하는데, 제품의 `refunds` insert 2곳(`subscriptionCancelActions.ts:230`, `mentorActivityService.ts:203`)이 **전부 `subscription_id`+구독 request_type만 세팅, `custom_request_order_id` 미설정**이고, `refunds`에 insert 하는 DB 함수도 **0건**(재현 DB 확인). 즉 099의 `r.custom_request_order_id is not null` 분기는 실사용 refunds에 대해 **dead**.
  - **판정: 잠재 회귀(P2)**, 라이브 이중지급 아님. 단 맞춤의뢰 환불/분쟁환불 흐름을 도입하는 순간 활성화되므로 그 전에 SQL로 056 분기 재적용 필요.

- **XV-REALTIME · 실시간 채팅 메시지가 실제로는 비실시간 — CONFIRMED.** 재현 DB `supabase_realtime` publication에 **`question_attachments`만** 포함(SQL117 §E `:134`가 첨부만 add). `question_messages`·`question_threads` 미포함. 앱 `thread_realtime.dart:46-82`는 3개 테이블 모두 구독하나 메시지·상태변경 이벤트는 발화 안 됨 → 첨부만 실시간, 새 메시지/상태는 재조회 폴백(앱 docstring 명시)으로만 반영. 웹은 realtime 미사용(폴백 설계). 조치: `question_messages`·`question_threads`를 publication에 추가(SQL 1줄) 시 실시간 채팅 완성. **미포함이어도 앱은 폴백 동작**이라 P2.
- **XV-PRICE · 요금제 라벨 드리프트(`베이직`↔`라이트`) — CONFIRMED.** 실제 카탈로그 라벨은 `라이트`(`subscribePlanCatalog.ts:17`)이고 CLAUDE.md canon도 `라이트`로 개정됨. 그러나 `베이직` 잔존: 약관 `app/(public)/legal/terms/page.tsx:95`, FAQ `app/(public)/support/page.tsx:31,45`(2026-07 legal PR에서 유입), 멘토 목록 헤더 `components/mentor/MentorsListBody.tsx:63`, 비교카드 주석 `components/subscribe/PlanComparisonCards.tsx:17`. tier id(`limited/standard/premium`)는 전부 정합. 조치: `베이직`→`라이트` 카피 일괄 교체(사용자 노출 텍스트 3곳 + 주석 1곳).
- **XV-QUERY-1 · 질문 목록 정렬 비대칭 — PLAUSIBLE.** 웹 `questionRoomQueries.ts:177-186` `updated_at desc` vs 앱 `question_room_read_repository.dart:38-44` `created_at desc` → 같은 방의 스레드가 웹/앱에서 다른 순서. UX 불일치.
- **XV-QUERY-2 · 멘토 목록 기본 정렬·정렬메뉴 비대칭 — PLAUSIBLE.** 웹 기본 `인기순`(`publicMentorsListQueries.ts:356-360`) vs 앱 기본 `최신순`(`mentors_screen.dart:43`), 정렬 옵션 집합도 상이(앱 '별점높은순' 웹 미노출 등). 첫 화면 노출 멘토 순서 다름.
- **XV-CASH-FORFEIT · 계정삭제 캐시 몰수 비원자성 — PLAUSIBLE(이월).** `accountDeletionActions.ts:59-70` `cash_ledger` 직접 INSERT 후 별도 `cash_wallets` UPDATE(`:75`) — 비트랜잭션·UPDATE 결과 미확인. idempotency_key(`:67`)+`if(forfeitRow)` 가드로 완화되나 중간 실패 시 원장↔지갑 불일치 가능. (돈 경로 단일화 취지의 국소 예외.)
- **XV-CR-NOTIF · 맞춤의뢰 알림이 앱 질문방에 노출 — CONFIRMED(적대 검토 재확인).** 웹 `orderMessageActions.ts:289` `type="new_order_message"` → 앱 `classifyNotificationType`(`app_notification.dart:35-68`)의 CR 제외 토큰집합(`custom_request`/`custom_order`/`refund`/`cr_`) 어디에도 매칭 안 됨 → 그 다음 `t.contains('message')`가 질문방으로 분류 → 숨겨야 할 CR 알림이 앱 질문방에 노출.
- **XV-REVIEWS-POLICY · reviews INSERT 정책 이중 → 자격검증 우회(DB층) — CONFIRMED.** 최종 reviews에 permissive INSERT 정책 2개 활성: `rev_ins`(author_id=auth.uid())와 `reviews_insert_student`(author_id+`check_review_eligibility`). Postgres OR 결합이라 약한 `rev_ins`가 자격검증을 우회(앱/웹은 코드에서 자격 검증). 데이터형상은 정합(author_id, 004형)이라 **출시 비차단**. SQL120(미머지 #31)이 정책 정리에 해당하나 필수는 아님.

### P3 (사소)

- **XV-HEIC — 완화 확인(교차대조로 오탐 강등).** 앱 업로드가 `image/heic` 허용(`attachment_upload.dart:21`)하나, 웹 v2가 `isWebRenderableImageMime`로 HEIC 제외 → **파일칩 다운로드로 강등**(`questionRoomAttachmentsQueries.ts:18-24`), 깨진 `<img>` 아님. XV-ATTACH v2로 방어됨. (잔여: 앱 업로드를 jpeg 재인코딩으로 바꿀지는 선택.)
- **XV-SUB-PENDING — PLAUSIBLE.** 웹 `subscriptionDisplay.ts`가 DB 허용값 `pending` 미처리 → 영문 "pending" 라벨 노출, 앱은 '대기 중'.
- **XV-MENTOR-NOTICE — PLAUSIBLE.** `mentor_pause_notice`/`mentor_termination_notice`(`mentorActivityService.ts:296,131`)가 앱 classify에서 `note`≠`notice` 키워드 불일치로 숨김 처리 → 구독영향 알림이 앱에서 조용히 누락.
- **XV-TIER-PARSER — PLAUSIBLE.** 웹 tier 파서 `subscribePageQueries.ts:56`(`/limited|리미티드|라이트|light/`)가 `베이직` 미포함 → '베이직' 제목 플랜은 `limited` 매핑 실패(라벨 통일 시 동반 정리 필요).
- **XV-ENV-EXAMPLE — CONFIRMED.** 웹은 `.env.example` 미제공(앱은 제공), 키명 규약 상이(웹 `NEXT_PUBLIC_SUPABASE_URL` vs 앱 `SUPABASE_URL`) — 무해.
- **XV-ATTACH-AUTHOR-NULL — CONFIRMED.** `question_attachments` INSERT 정책(SQL117)이 `author_id IS NULL OR author_id=auth.uid()` — NULL 허용. 방 참여 EXISTS는 강제라 크로스테넌트 안전, 타인 author_id 위조는 차단. 무결성 완화 뉘앙스.
- **XV-SHORTFORM-FREE — PLAUSIBLE.** 웹 숏폼 카테고리에 `free` 없음, 앱 공용 라벨맵엔 존재. DB 무제약·숏폼은 웹 생성(4슬러그 화이트리스트)이라 잠복.

### 미확인

- 운영 DB 실상태(XV-REFUND·XV-REVIEWS·XV-REALTIME publication의 운영 반영 여부, 099·117 등 프로덕션 적용 시점) — 운영 접속 금지로 재현 DB 정본 기준. 오너 SELECT 대조 필요.
- 로컬 Supabase 풀스택(realtime·storage·edge 실동작) — Docker 이미지 pull 차단으로 네이티브 PG 폴백. edge function `send-push` 미배포·`device_tokens` 미존재는 확인(푸시 골격 상태).
- 빌드: 앱 `flutter test`(첨부 v2 반영분)·웹 `next build`는 이번 재검증 턴에서 미재실행(직전 baseline 통과 기록 유지) — 코드 델타는 머지 PR들의 게이트에서 통과 기록.

---

## §3 부록

### 부록 A — 스키마 인벤토리 (재현 DB `ssam_verify`, 요약)

- 테이블 68 · 정책 191(public+storage) · 함수 152 · 트리거 다수(신규 `trg_users_role_guard` 포함) · 뷰 `due_payouts` · **realtime publication 포함 테이블 1 = `question_attachments`**(SQL117 §E).
- 버킷 12(11 private + `profile-avatars` public). 돈이동 코어 RPC는 service_role 전용 GRANT(캐시 debit/topup, 에스크로 hold/payout/refund), IQ 생성/청구/답변 래퍼는 authenticated 자기한정.
- 미머지 SQL: **120**(reviews 정본화, #31 백로그) — 재현 DB 미적용. 108/109/110(후불정산 DRAFT)은 여전히 미적용 기록.
- (전체 인벤토리 원본: 스크래치패드 `inventory_schema.md` — 세션 한정, 소실 시 동일 방법 재생성.)

### 부록 B — 접점 매트릭스 (요약)

- 웹 접점: `.from()` 리터럴 345 + 동적/스키마프로브 189 · `.rpc()` 32종 · storage 11버킷 · realtime **0** · edge function **0**.
- 앱 접점: 27 명명 테이블 · RPC 15종 · 버킷 4 · realtime 채널 1(질문방 3테이블 구독) · edge function 1(미배포).
- 돈경로 대칭성: 캐시·에스크로 이동은 양측 모두 service_role RPC 위임(앱 직접 DML 없음) — **Commerce-Zero 유지**. 예외: 웹 `accountDeletionActions`의 캐시 몰수 직접 DML(§2 XV-CASH-FORFEIT).
- (원본: 스크래치패드 `touchpoints_web.md`·`touchpoints_app.md`.)

## §4 RLS 판정표 (재현 DB 실측, 24개 시나리오)

| # | 시나리오 | 기대 | 실측 | 근거 |
|---|---|---|---|---|
| 1 | 학생A → 학생B의 rooms/threads/messages/attachments 열람 | DENY | **DENY(0행)** | live-sim |
| 2 | 방 당사자(학생·멘토)의 자기 thread/msg/att 열람 | ALLOW | **ALLOW** | live-sim |
| 3 | question_attachments INSERT: author=self / 타인 / 비참여 thread | A/D/D | **ALLOW/DENY/DENY** | live-sim(§P3 author=NULL 허용) |
| 4 | notifications UPDATE: 소유자 / 비소유자 | A/D | **ALLOW / DENY(0행)** | live-sim(`notif_update_recipient_read`) |
| 5 | subscriptions: 본인read/타인read/직접write | A/D/D | **ALLOW/DENY/DENY** | live-sim(write 정책 부재=잠금) |
| 6 | cash_wallets/cash_ledger 직접 write, 타인 wallet read | DENY | **DENY** | live-sim |
| 7 | device_tokens 소유자 R/W | (존재 시) | **미존재**(to_regclass NULL) | 앱 `_tableExists=false`와 정합 |
| 8 | storage 3버킷(question-room-attachments/scan-annotations/individual-question-attachments) 경로격리 | DENY(비참여) | **DENY(정적판정)** | 정책SQL+bucket public=false |

RLS 구멍 **0건**. 저심각 1건: question_attachments INSERT의 author_id NULL 허용(크로스테넌트 안전). 하드닝 메모: subscriptions/cash/rooms write 차단이 "permissive write 정책 부재(기본거부)"에 의존 → 향후 write 정책 추가 시 회귀 위험, 회귀테스트 권장. scan-annotations는 DELETE 정책 부재(service-role 전용).

## §5 기존 보고 대비 델타

**해결(머지로):**
- **XV-01**(P0 권한상승) → SQL119로 **UPDATE 경로만 폐쇄**. **가입(INSERT) 경로는 미해결(라이브 P0, §2)** — 부분 해결.
- **XV-ATTACH**(첨부 계약 비대칭) → 첨부 v2(웹#28/앱#27)+SQL117: 본문 마커 폐지·`question_attachments` 단일정본 렌더·표시시점 재서명(7일 부패 소멸). **단 realtime는 첨부만 반영 → XV-REALTIME 잔여**.
- **BUG-B**(커뮤니티 이미지 7일 부패) → 웹#29+SQL118: ref 저장+표시시점 서명.
- **XV-HEIC** → v2 웹 파일칩 강등으로 완화(P3).

**잔존/신규:**
- **신규 XV-REFUND**(P1) — 099 에스크로 분기 소실(이번 재기준화에서 CONFIRMED, 이전엔 '요검증'이었음).
- **신규 XV-SCRAP**(P1) — 숏폼 scrap DB CHECK 위반(RELEASE_TRIAGE D8이 CONFIRMED로).
- **신규 XV-REALTIME**(P2) — publication 메시지/스레드 누락.
- **잔존 XV-PRICE**(P2) — 라벨 방향 반전(과거 canon '베이직' vs 코드 '라이트' → 이번엔 canon '라이트'로 개정됐으나 legal/FAQ 카피가 '베이직'으로 역드리프트).
- **XV-REVIEWS** — 데이터형상 정합 확정(출시 비차단), 정책 이중은 P2 하드닝.

## §6 미실행·미확인 목록 (사유)

- 운영 DB 대조(정책·함수·publication의 프로덕션 반영 시점) — 운영 접속 금지.
- 로컬 Supabase 풀스택 realtime/storage/edge 실동작 — Docker 이미지 차단(네이티브 PG 폴백).
- 앱 `flutter test`·웹 `next build` 재검증 턴 미재실행(머지 PR 게이트 통과 기록 원용).
- PLAUSIBLE 표기 발견(XV-QUERY-1/2·CR-NOTIF·CASH-FORFEIT·SUB-PENDING·MENTOR-NOTICE·TIER-PARSER·SHORTFORM-FREE)은 서브에이전트 정독 근거(file:line)만 있고 개별 런타임 재현은 미수행.

## §7 출시 전 잔여 액션 (우선순위)

1. **XV-01(P0·출시 차단)** — `handle_new_auth_user()`의 role 허용목록에서 `'admin'` 제거(→ `('student','mentor')`), 그리고/또는 `users` BEFORE INSERT role 가드 추가. **미인증 admin provisioning을 막기 전엔 NO-GO.**
2. **XV-SCRAP(P1)** — 숏폼 스크랩: 앱 버튼 숨김 또는 DB CHECK에 `'scrap'` 추가. 출시 전 택1.
3. **XV-REALTIME(P2)** — `question_messages`·`question_threads`를 `supabase_realtime` publication에 추가(실시간 채팅 완성). 미적용이어도 폴백 동작.
4. **XV-REFUND(P2·잠재)** — 맞춤의뢰 환불/분쟁환불 흐름을 도입하기 전에 056 에스크로 분기를 099 위에 재적용하는 SQL. (현재 도달 불가라 즉시 차단 아님.)
5. **XV-PRICE(P2)** — `베이직`→`라이트` 카피 교체(약관·FAQ·MentorsListBody·PlanComparisonCards 주석) + tier 파서 정리.
6. **XV-CR-NOTIF/MENTOR-NOTICE(P2/P3)** — 앱 `classifyNotificationType` 키워드 분류 보정(CR 알림 노출·구독영향 알림 누락).
7. **XV-QUERY-1/2(P2)** — 질문목록/멘토목록 정렬 규약 통일.
8. **XV-CASH-FORFEIT(P2)** — 계정삭제 캐시 몰수를 원자적 RPC로.
9. (선택) **SQL120/#31** — reviews 정책 이중 정리(하드닝).

---

## §8 독립 적대 검토 반영 내역

초판(commit `4f4ecf3`/`420a232`) 작성 후, 새 컨텍스트의 독립 적대 검토를 1회 수행했다. 검토는 재현 DB·양 레포로 6개 load-bearing 주장을 반증 시도했고, 아래 2건의 **판정 오류를 잡아 반영**했다(둘 다 검토 지적 후 본 검증자가 재현 DB로 직접 재확인).

| # | 초판 | 적대 검토 판정 | 반영 |
|---|---|---|---|
| 1 | XV-01 "SQL119로 폐쇄·P0 미해결 0" | **OVERSTATED** — SQL119는 UPDATE만 가드. `handle_new_auth_user()`가 가입 메타 `app_role='admin'`을 허용 → 미인증 admin provisioning. 재현: `auth.users` INSERT(app_role=admin) → `users.role=admin`, `is_admin()=t` | **XV-01 라이브 P0로 재개**, 게이트 **조건부 GO → NO-GO** |
| 2 | XV-REFUND "P1·라이브 이중지급·near NO-GO" | **OVERSTATED(도달성)** — 회귀는 실재하나 `custom_request_order_id`를 세팅하는 `refunds` insert가 제품에 없음(앱 2곳 구독전용 + DB 함수 0) → 099 에스크로 분기 dead | **P1 → P2(잠재)** 강등, 도달성 반증 명기 |
| 3 | XV-SCRAP(P1) | CONFIRMED-AS-WRITTEN(버튼 미숨김, 상시 실패) | 유지 |
| 4 | XV-REALTIME(P2) | CONFIRMED-AS-WRITTEN(publication=attachments만, 대체 전달 없음) | 유지 |
| 5 | XV-QUERY-1 / XV-CR-NOTIF | CONFIRMED-AS-WRITTEN(스팟체크) | XV-CR-NOTIF PLAUSIBLE→CONFIRMED, 제외 토큰집합 문구 정정 |
| 6 | 게이트 "조건부 GO" | NOT DEFENSIBLE(P0 오폐쇄 + P1 과대) | §1 NO-GO로 정정 |

검토가 확인해 준 것(변경 불요): RLS 24시나리오 구멍 0 · 시크릿 누출 0 · XV-SCRAP·XV-REALTIME·정렬비대칭·CR-NOTIF 근거 정확.

---

_(끝) 본 검증은 재현 DB(`ssam_verify`) 정본 기준이며, '미확인'은 통과로 승격하지 않았다. 제품 코드·스키마 변경 0건, 산출물은 본 문서뿐이다. 적대 검토 반영으로 게이트는 **NO-GO**(XV-01 가입 경로 P0)로 확정됐다._
