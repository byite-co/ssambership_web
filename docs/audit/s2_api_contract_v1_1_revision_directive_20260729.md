# S2 API 계약 v1.1 개정 지시서 (정본)

- **작성일:** 2026-07-29 (rev 2 — 오너 2차 검증 보정 6건 반영: stale 참조 확정, M8 충돌 해소, F11 전건 대조 7필드, F12 3자 일치·재생·방 확보 트랜잭션 의미, M0 PUBLIC EXECUTE 회수, M11/M12 분리)
- **세션:** schema-doc-verification (검증 전용 — 이 세션의 DB DDL/DML·코드 변경 0건)
- **판정:**
  - 전체 S2: **GO 유지**
  - S2-1 계약서(`api_web_v1` 계약 v1.0 · `api_app_v1` 계약 v1.0): **REVISE**
  - S2-2 SQL 구현: **임시 NO-GO 유지** (v1.1 계약 확정 전 SQL 작성 금지)
- **다음 세션 산출물:** `api_web_v1 계약 v1.1` + `api_app_v1 계약 v1.1` **문서 2건만**. SQL 0건.
- **근거 문서:** 계약서 v1.0 2건(웹·앱), 1차 검증 보고서, 재검토서, 재검토서 타당성 분석(본 세션), 오너 최종 보정 지시 2건(2026-07-29). stale 참조 3건은 오너 제공 v1.0 원문 대조로 확정 완료(E절) — 미확정 항목 없음.

모든 항목은 라이브 DB(`pg_get_functiondef`·`pg_policies`·`information_schema`)와 웹·앱 저장소 코드로 실측 확인됨. 실측 근거는 부록 참조.

---

## A. 확정 결함 및 정정 지시 (구현 전 필수)

### A-1. F4·F5 시그니처는 생성 불가 — 재배열 필수

- **결함(확정):** DEFAULT 인자 뒤에 필수 인자(`p_idempotency_key uuid`, `p_expected_updated_at timestamptz`)가 옴 → `CREATE FUNCTION` 자체가 42P13으로 실패.
- **정정:** 필수 인자를 전부 앞으로, DEFAULT 인자를 전부 뒤로 재배열. 호출부는 named notation(`p_x => ...`) 사용을 계약에 명시.
- **범위:** 웹 계약 §7 **및** `api_app_v1` 계약 §3.3(원출처) 동시 수정. 앱 계약의 Gate 4 "문서 게이트 PASS" 판정도 이 항목으로 소급 무효 — v1.1에서 재게이트.

### A-2. `core_private`는 Data API로 도달 불가 — F10·F11·F12 진입점 재설계

- **결함(확정):** PostgREST는 노출 스키마의 함수만 `.rpc()`로 서빙하며 service_role 키도 스키마 노출 설정을 우회하지 않음(Supabase Custom Schemas 문서). 계약 v1.0은 웹 JS가 `core_private`의 F11·F12를 직접 호출하고, §17 #3에서 F10(`ensure_student_mentor_room`)도 직접 호출하도록 규정 → 전부 호출 불가.
- **정정:**
  1. **원칙:** `core_private`는 **DB 함수끼리만 호출하는 내부 구현부**로 유지. 웹 JS가 부르는 진입점은 전부 `api_web_v1`에 두고 EXECUTE를 service_role 전용으로 GRANT.
  2. **F10 처리 확정(오너 채택):** **F12가 내부에서 `core_private.ensure_student_mentor_room`을 호출하고 응답에 `room_id`를 포함해 반환한다.** 구독 성공 시 질문방 존재를 필수 불변조건으로 승격. §17 #3의 "웹 JS → F10 직접 호출" 행 삭제. (대안이던 `api_web_v1.ensure_student_mentor_room_server`는 채택하지 않음.)
  3. **방 확보의 트랜잭션 의미(오너 확정):**
     - **최초 실행:** 방 확보 실패 시 자금 차감·구독 생성/갱신·원장 기록·결제 상태 변경을 **전부 롤백** (부분 성공 금지)
     - **성공 재생:** 기존 자금 처리를 반복하지 않고, 방을 **조회·복구**한 뒤 `room_id`를 반환
     - **사전 검사:** 배포 전에 "기존 succeeded 구독 결제 중 `mentor_student_rooms` 행이 없는 건"을 탐지·보정하는 점검 절차를 v1.1 배포 게이트에 추가
  3. §5.2의 "비노출 스키마가 유일한 구조적 방어" 논리 폐기 — 정본 방어선은 **GRANT(EXECUTE) 기반**이며, 스키마 비노출은 내부 구현부 은닉 수단으로만 기술.

### A-3. 컬럼 단위 REVOKE는 무효 — M11·M12 테이블 단위 전면 회수로 교체 (분리 유지)

- **결함(확정·실측):** `anon`·`authenticated`가 `mentor_profiles`·`mentor_plans`에 **테이블 단위** INSERT/UPDATE/DELETE(및 TRUNCATE) 권한 보유. PostgreSQL은 테이블 단위 권한이 있으면 컬럼 단위 REVOKE가 실효 없음 → v1.0의 컬럼 단위 회수는 적용해도 XW-02가 닫히지 않음.
- **정정(오너 확정 — v1.0의 M11·M12 분리 구조 유지):**
  - **M11:** `REVOKE INSERT, UPDATE, DELETE ON public.mentor_profiles FROM anon, authenticated` — `mentor_profiles` 직접 쓰기 회수
  - **M12:** `REVOKE INSERT, UPDATE, DELETE ON public.mentor_plans FROM anon, authenticated` — `mentor_plans` 직접 쓰기 회수
- **적용 게이트:**
  - **M11 전:** ① F7 전환 완료 ② A-4 정산계좌 RPC 적용 + 웹 호출부(`lib/mentor/mentorPayoutAccountActions.ts`) 전환 ③ `syncAfterSignUpWithSession` 백업 upsert 제거 ④ 프로필 직접 쓰기 실측 0건 확인
  - **M12 전:** ① F8 전환 완료 ② 플랜 직접 쓰기 실측 0건 확인
- **참고(실측):** 현재 실효 방어는 전적으로 RLS(`mentor_update_own` 등 own-row 정책)뿐임. TRUNCATE는 RLS 대상이 아니나 PostgREST가 TRUNCATE를 노출하지 않아 HTTP 경로는 없음 — 위생 차원에서 함께 회수 권장.

### A-4. 정산계좌 전용 RPC 신설 (F7에 통합 금지)

- **배경(확정·실측):** `lib/mentor/mentorPayoutAccountActions.ts:39`가 **세션 클라이언트**로 `mentor_profiles`의 정산계좌 컬럼을 직접 UPDATE하며, `components/mentor/payouts/MentorPayoutAccountPanel.tsx`에 실제 연결된 활성 경로. F7은 payout 컬럼을 의도적으로 제외(U-06 이월)했으므로 A-3의 전면 REVOKE는 이 기능을 파손함.
- **정정:** `api_web_v1.mentor_payout_account_update_self(...)` 신설. 필수 계약:
  - authenticated 전용 (anon·public EXECUTE 회수)
  - 대상 행은 `auth.uid()`에서 자체 도출 (인자로 user_id 받지 않음)
  - 승인된 멘토(`verification_status` 승인 상태) 여부 확인
  - 은행명 allowlist 검증
  - 계좌번호 숫자만·길이 8~24 검증
  - 계좌 원문을 응답에 포함하지 않음
  - 관리자/service_role 조회·수정 경로는 별도 함수로 분리
  - **적용·웹 전환 완료 후** `mentor_profiles` 직접 쓰기 전면 회수(A-3)
- U-06은 이 항목으로 해소 처리.

### A-5. F12 멱등 재생 — 정본 실측 반영 + `payments` 불변 동의 금액 기준

- **결함(확정·실측):** v1.0 [C4]의 "정본은 succeeded면 금액 비교 없이 재생 반환(실측)"은 **오측**. `confirm_subscription_checkout` 원문은 재생 경로에서도 `mentor_plans`를 FOR UPDATE로 잠근 뒤 **현재** `amount_cents`로 기존 원장 `delta_cents`를 대조하고, 불일치 시 `LEDGER_FIELD_MISMATCH` 반환 + **anomaly 행 기록**. 따라서 가격 변경 후 정당한 재시도가 오탐되며, v1.0 설계([C4] 위임)와 T-CONC-09 기대값(`ok:true, idempotent:true`)은 실제 정본에 대해 실패.
- **정정:** v1.1 F12는 재생 판정을 정본 위임이 아니라 **결제 시점 불변 동의 금액** 기준으로 자체 수행. 다음 검증을 계약에 명시:

  ```text
  payments.kind = 'subscription'
  payments.currency = 'KRW'
  payments.amount > 0
  payments.amount = trunc(payments.amount)   -- 정수 원 단위
  intent_amount_cents = payments.amount × 100
  ```

- **최초 실행 — 3자 일치(오너 확정):**

  ```text
  payments.amount × 100
  = p_expected_amount_cents
  = 잠근(FOR UPDATE) mentor_plans.amount_cents
  ```

  셋 중 하나라도 불일치하면 자금 처리 없이 거절.
- **재생 — 금지·허용 규칙(오너 확정):**
  - 현재 플랜 가격을 **읽지 않음**
  - 기존 정본 함수(`confirm_subscription_checkout`)를 **다시 호출하지 않음**
  - `payments.amount × 100`과 **기존 원장 행만** 비교
  - T-CONC-09 기대값을 "가격 변경 후 재생 = `ok:true, idempotent:true`, anomaly 기록 없음"으로 재작성.
- **DB 계약 명시(오너 지시):** 라이브 `payments.amount`는 numeric이며 통화·정수 CHECK가 없음(실측: subscription 결제 2건 모두 `currency='KRW'`·`amount=29900`·소수 0건). 위 KRW·정수 규칙을 v1.1의 DB 계약(문서 차원)으로 명시하고, CHECK 제약 추가 여부는 S3 후보로 기재.
- **부수 기록:** 현행 정본의 "재생 시 현재가 대조" 동작 자체가 XW-04 인접의 잠재 결함임을 v1.1 AS-IS 절에 사실로 기재.

### A-6. F11 — duplicate 필드 대조 강제 + 테스트 충전 분리

- **정정 1 (duplicate 전건 대조 — 7필드 확정):** F11 재생 경로는 기존 원장 행의 다음 7개 필드를 **전부 명시적으로** 대조하고, 하나라도 불일치 시 `LEDGER_FIELD_MISMATCH`:

  ```text
  user_id
  delta_cents
  reason
  ref_type
  ref_id
  ref_text
  idempotency_key
  ```

  이와 **별도로** `p_idempotency_key = p_order_ref` 강제를 유지한다. (정본 checkout이 `sub_debit` 원장에 쓰는 확립된 관행의 확장.)
- **정정 2 (테스트 충전 분리, 오너 확정):** 형식 allowlist 확장으로 `cash_topup_...`을 수용하는 안은 **기각**. 정리:
  - Toss confirm/webhook → **F11** (`^cash-(.+)-(\d+)$` 주문 참조 강제)
  - 개발·스테이징 테스트 충전(`walletTopupActions.ts`, 키 형식 `cash_topup_{uid}_{ts}_{hex}`) → **기존 `record_cash_topup` 유지**
  - §17 #13에서 `walletTopupActions.ts`를 F11 전환 대상에서 **제외**
  - production에서는 현행대로 테스트 충전 강제 비활성
  - 이 결함의 성격: 운영 결제 장애가 아니라 개발·스테이징 테스트 경로 장애(전환 시 항상 `ORDER_REF_INVALID`).

### A-7. M0 — 재기술 (확정 사실만) + 필수화 유지

- **확정 사실(실측·문서):**
  - `mentor_profiles.cap_limit` 기본값 `28` NOT NULL → INSERT용 `WHEN (new.cap_limit IS NOT NULL)`은 **항상 참** → 함수가 모든 INSERT에서 불필요하게 실행됨
  - PostgreSQL(17 문서 기준)에서 INSERT 트리거의 `OLD`는 **NULL**이며, `TG_OP` 분기 전에 `OLD`를 비교하는 v1.0 구조는 잘못됨
  - "정상 가입이 전부 실패한다"는 단정은 **삭제** — 가입 성공 여부는 이후 `auth.jwt()` NULL 평가 통과 여부에 달려 있어 실제 가입 테스트 없이 확정 불가
- **정정:** `TG_OP` 선분기(INSERT/UPDATE 분리) + 민감 필드 비교는 `IS DISTINCT FROM` 사용, INSERT 발화 조건은 `new.cap_limit IS DISTINCT FROM 28` 등 기본값 대비로 재작성. 하드코딩 28의 취약성(기본값 변경 시 드리프트)은 주석으로 명시.
- **PUBLIC EXECUTE 회수(필수, 오너 확정):** 트리거 함수 생성과 **동일 트랜잭션**에서 수행:

  ```sql
  REVOKE ALL ON FUNCTION public.enforce_mentor_profile_privileged_guard()
  FROM PUBLIC;
  ```
- **필수화 유지:** authenticated가 `mentor_profiles` UPDATE 권한을 보유한 실측 상태에서 자기 행 `verification_status`·`cap_limit` 조작이 열려 있으므로 M0는 권장이 아닌 **필수** 마이그레이션. (A-3 전면 REVOKE 이후에도 심층 방어로 유지.)

### A-8. XW-01 — NULL-safe 당사자(pair-party) 검증으로 확정

- **결함(확정·실측):** F1 신설만으로 레거시 `get_weekly_question_usage`의 IDOR는 닫히지 않음. 단, 재검토서의 `p_student_id = auth.uid()` 하드닝은 웹 **멘토** 질문방 2곳(`app/(mentor)/mentor/question-room/[roomId]/page.tsx:109`, `.../thread/[threadId]/page.tsx:108`)이 `(studentId, user.id=멘토)`로 호출하므로 파손 유발 — **student self가 아니라 pair party가 정답**.
- **정정(오너 확정 형태 고정):**

  ```sql
  IF (auth.jwt() ->> 'role') IS DISTINCT FROM 'service_role'
     AND auth.uid() IS DISTINCT FROM p_student_id
     AND auth.uid() IS DISTINCT FROM p_mentor_id
  THEN
    RAISE EXCEPTION 'NOT_PAIR_PARTY'
      USING ERRCODE = '42501';
  END IF;
  ```

  `IN`·일반 `<>`는 NULL로 인해 예기치 않게 통과할 수 있으므로 금지. `IS DISTINCT FROM`만 사용.
- **유지 확인(실측 완료):** ① `qna_create_question_thread`(학생 본인 생성) 유지 ② `qt_direct_write_guard`(학생 본인 직접 생성) 유지 ③ 웹 멘토 질문방(멘토 ID = `auth.uid()`) 유지 ④ anon·제3자 차단. service_role(`weeklyQuestionUsageServer.ts`, e2e admin) 통과. anon EXECUTE 회수(U-08)는 별도 유지.

### A-9. F0 — 관계 확인된 조회 내부로 축소

- **정정:** 공개 라벨 함수 형태의 F0를 폐기하고, 라벨 도출 로직을 관계가 이미 확인된 조회(뷰·함수) 내부로 좁힘. 대가(V2·V6·V7의 SECURITY DEFINER 뷰화 또는 비정규화 컬럼)를 v1.1 §에 명시하고 선택지를 고정할 것.

---

## B. 공용 구현부 명세 의무

v1.0이 참조만 하고 정의하지 않은 공용 구현부(공용 검증기·공용 원장 기록기 등)는 v1.1에서 **함수명·시그니처·스키마 위치·GRANT까지** 전건 명세한다. "시그니처 확정" 게이트(§10 #3)는 공용 구현부 포함으로 재정의하며, 미명세 상태로는 게이트 통과 불가.

## C. 커뮤니티 hard DELETE — 단계 게이트

- **실측:** 앱 `lib/features/community/data/community_write_repository.dart:204-210`이 `community_posts.delete()`를 실행 — 단, **생성 실패 보상 전용** 내부 경로(공개 API·UI·라우트 없음). 즉시 DELETE 회수 시 이 보상 흐름이 파손됨.
- **게이트 순서(변경 금지):** ① 보상 삭제 대체 RPC 제공 → ② 앱 전환 배포·보급 → ③ `community_posts` DELETE 권한·`cp_delete_own` 정책 회수.
- **마이그레이션 번호 정정(오너 확정):** v1.0의 **M8은 F7·F8 멘토 RPC 마이그레이션이므로 그대로 유지**한다. hard DELETE 회수는 M8에 얹지 말고 **별도 게이트·별도 마이그레이션(`HD-1` 또는 새 M번호)**으로 추가한다. v1.0 922행의 `§20 M8 선택 항목` 참조는 삭제.

## D. blocker 재분류 확정

- **B-07 해제(실측):** 앱 프로필 수정은 `lib/features/mypage/data/profile_edit_repository.dart:30`의 `users` UPDATE 단일 호출뿐, `mentor_profiles` 쓰기 없음.
- **B-01·B-03·B-05:** S2 blocker에서 해제(마이그레이션 M0~M12를 막지 않음).
- **B-04 동결(오너 확정):** v1에서는 **"금지어 검사 폐지, `POLICY_RESTRICTED`는 예약 코드이며 발생하지 않음"**으로 한쪽 동결. F4/F5 공용 검증부는 마스킹만 수행. 오너가 금지어를 복원하면 additive 개정으로 처리.

## E. stale 참조 정정 (3건 — 확정)

v1.0 계약서 원문(오너 제공, 2026-07-29) 대조로 3건이 확정됐다. 정책명 불일치가 아니라 **마이그레이션 번호 오참조**다:

| # | v1.0 위치 | 현재 표기 | 정정 |
|---|---|---|---|
| 1 | 945행 (F7) | `컬럼 REVOKE(§20 M9)` | `§20 M11` |
| 2 | 1315행 | `S2 후반 M9` | `M11·M12` |
| 3 | 1754행 (payments 프로빙 제거) | `§20 M10` | `§20.4 C10` |

아래 라이브 정책명 표는 **참고 부록**으로 유지한다 (v1.1의 정책·트리거·함수 인용 기준, 2026-07-29 `pg_policies` 측정):

| 테이블 | cmd | 라이브 정책명 (정본) |
|---|---|---|
| `community_posts` | DELETE | `cp_delete_own` (authenticated) |
| `community_posts` | INSERT | `cp_write_self` + 레거시 `로그인 유저 게시글 작성`(public) |
| `community_posts` | UPDATE | `cp_update_own` · `cp_update_self` + 레거시 `본인 게시글 수정`(public) |
| `community_posts` | SELECT | `cp_select_own` · `cp_select_published` + 레거시 `누구나 게시글 읽기`(public) |
| `shortform_posts` | DELETE | `sf_delete_own` |
| `shortform_posts` | UPDATE | `sf_update_own` · `sp_update_self` |

- 정정 규칙: v1.1의 모든 정책·트리거·함수 인용은 위처럼 **라이브 측정값**으로 기재하고, 레포 SQL 파일의 역사적 이름을 인용하지 않는다.
- 재측정 쿼리: `SELECT tablename, policyname, cmd, roles FROM pg_policies WHERE tablename IN ('community_posts','shortform_posts') ORDER BY 1,3,2;`
- 한국어 레거시 정책(public 롤)의 존치·정리 여부는 S3 후보로 기재.

## F. `api_app_v1` 계약 v1.1 동기화 항목

1. F4/F5 시그니처 재배열 (A-1과 동일 — 앱 계약 §3.3이 원출처)
2. `SUBSCRIPTION_REFUND_PENDING` 오류 코드 정합화
3. 응답 envelope 가정 재기술 (웹 계약과 동일 구조로)
4. Gate 4 재게이트 (A-1 소급 무효 반영)
5. 주간 사용량 조회의 pair-party 가드(A-8) 반영 — 앱 호출(자기 학생 ID)은 영향 없음을 명기
6. **공용 커뮤니티 내부 함수 대조표(오너 확정):** 웹·앱 계약이 공유하는 커뮤니티 내부 함수의 **이름·시그니처·오류코드·GRANT가 웹 계약과 동일**함을 증명하는 대조표를 앱 계약 v1.1에 추가

## G. 다음 세션 지시

1. **산출물:** `api_web_v1 계약 v1.1`, `api_app_v1 계약 v1.1` 문서 2건. **SQL 작성·적용 금지** (S2-2는 v1.1 게이트 통과 후 별도 세션).
2. 본 지시서 A~F를 전건 반영하고, 각 항목에 "반영 절 번호"를 역기입해 추적 가능하게 할 것.
3. E절의 stale 참조 3건(945행·1315행·1754행)은 확정 정정값으로 교체 완료 여부를 게이트에서 확인할 것 (본 지시서 rev 2에서 원문 대조 확정 — 미확정 항목 아님).
4. 자금 함수 3종(`confirm_subscription_checkout`·`record_cash_topup`·renewal)의 본문 분기 순서는 요약 전재가 아니라 **원문 기준 재기술** ([C4] 오측 재발 방지).
5. 게이트: A-1~A-9 반영 + B 공용 구현부 전건 명세 + C의 hard DELETE 별도 마이그레이션 신설(M8 불변) + F 동기화 완료 시 S2-1 REVISE 해제, S2-2 NO-GO 해제 심사 가능.

---

## 부록 — 본 세션 실측 근거 (2026-07-29, 전부 읽기 전용)

| # | 실측 | 결과 요지 |
|---|---|---|
| 1 | `pg_get_functiondef('confirm_subscription_checkout')` | 재생 경로가 plan FOR UPDATE 후 현재 `amount_cents`로 원장 `delta_cents` 대조, 불일치 시 `LEDGER_FIELD_MISMATCH` + anomaly 기록 |
| 2 | `information_schema.role_table_grants` | `anon`·`authenticated` 모두 `mentor_profiles`·`mentor_plans` 테이블 단위 INSERT/UPDATE/DELETE/TRUNCATE 보유 |
| 3 | `information_schema.columns` | `mentor_profiles.cap_limit` default `28` NOT NULL · `payments.amount` numeric · `payments.currency` default `'KRW'` NOT NULL |
| 4 | 라이브 subscription 결제 2건 | 모두 `currency='KRW'`·`amount=29900`·소수 0건 (통화·정수 CHECK는 부재) |
| 5 | 웹 코드 | 멘토 질문방 2곳이 `fetchWeeklyQuestionUsageWithFallback(supabase, studentId, user.id)` 호출 (`app/(mentor)/mentor/question-room/[roomId]/page.tsx:109` · `.../thread/[threadId]/page.tsx:108`) |
| 6 | 웹 코드 | `lib/mentor/mentorPayoutAccountActions.ts:39` 세션 클라이언트 `mentor_profiles` 직접 UPDATE, `MentorPayoutAccountPanel.tsx`에 연결된 활성 경로 |
| 7 | 앱 코드 | `lib/features/community/data/community_write_repository.dart:204-210` `community_posts.delete()` — 보상 전용 내부 경로 |
| 8 | 앱 코드 | `lib/features/mypage/data/profile_edit_repository.dart:30` — `users` UPDATE 단일 호출 (B-07 해제 근거) |
| 9 | `pg_policies` | E절 표의 라이브 정책명 목록 |
| 10 | 외부 문서 | PostgreSQL 17 Trigger Functions(INSERT 시 `OLD`=NULL) · Supabase Custom Schemas(service role도 Data API 스키마 노출 설정을 우회하지 않음) |
