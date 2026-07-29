# S2 API 계약 v1.1 개정 지시서 (정본)

- **작성일:** 2026-07-29 (rev 7 — 최종 착수 전 보정 5건: F12 늦은 재생 판정 재작성(`subscription.last_payment_id`=최신 결제 유일 정본·stale room 복구·회귀 테스트 4건), F11 공용 구현부 `core_private.record_cash_topup_impl`/레거시 무음 계약/신규 strict 3층 분리·보안 속성·권한 회수, `HD-1` 게이트를 anon/authenticated INSERT/UPDATE/DELETE 0건으로 확대·service_role moderation 예외 명시, 숏폼 Storage 정책 `sfv_mentor_insert` 1정책/2버킷 실측 정정, V6 `current_plan_amount_cents` 단일 확정. rev 6: 보상 삭제 RPC 폐기·HD-1 전면 잠금·원자적 duplicate·커뮤니티 동결·F0 허용 범위. rev 5: room 컬럼별 표·오류코드 우선순위·M2 retired·A-10 신설. rev 4: topup 정본·6필드 단일 계약. rev 3: NULL-safe·관계 결속·`REVOKE ALL`. rev 2: stale 참조·M8·3자 일치·M0 PUBLIC EXECUTE·M11/M12 분리)
- **세션:** schema-doc-verification (검증 전용 — 이 세션의 DB DDL/DML·코드 변경 0건)
- **판정:**
  - 전체 S2: **GO 유지**
  - S2-1 계약서(`api_web_v1` 계약 v1.0 · `api_app_v1` 계약 v1.0): **REVISE**
  - S2-2 SQL 구현: **임시 NO-GO 유지** (v1.1 계약 확정 전 SQL 작성 금지)
- **다음 세션 산출물:** `api_web_v1 계약 v1.1` + `api_app_v1 계약 v1.1` **문서 2건만**. SQL 0건.
- **근거 문서:** 계약서 v1.0 2건(웹·앱), 1차 검증 보고서, 재검토서, 재검토서 타당성 분석(본 세션), 오너 보정 지시 7건(2026-07-29). **동결 완료:** stale 참조 3건(E절) · `HD-1` = 커뮤니티 직접 쓰기 전면 잠금 + 보상 삭제 RPC 폐기 + 확대 게이트 7단계·service_role moderation 예외(C절) · topup 정본 = `idempotency_key` 단독 + `core_private.record_cash_topup_impl` 3층 분리·보안 속성(A-6) · M2 retired 번호 정책(A-6) · F12 오류코드 4종 + 우선순위 + anomaly 계약 + `last_payment_id` 정본 늦은 재생 판정(A-5) · room 참조 규칙 컬럼별 표(A-5) · 커뮤니티 승인 멘토 한정 + 기존 학생 글 보존 + `sfv_mentor_insert` 1정책/2버킷(A-10) · F0 허용 범위 + V6 `current_plan_amount_cents` 단일 확정(A-9). **v1.1 작성 세션 몫으로 남는 결정은 1종:** F0 계열 V2·V6·V7의 **객체별** 구현 선택 — 단, A-9의 허용 범위(security_invoker 뷰 + 비정규화 / 범위 제한 SECDEF RPC) 안에서만.

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
     - **성공 재생:** 기존 자금 처리를 반복하지 않고, 방을 **조회·복구**한 뒤 `room_id`를 반환. 재생 중 방 복구가 실패하면 **기존 자금 처리를 건드리지 않고** 안정 코드 **`ROOM_ENSURE_FAILED`**로 실패한다 (자금 상태는 성공인 채 유지, 재시도 가능).
     - **사전 검사:** 배포 전에 "기존 succeeded 구독 결제 중 `mentor_student_rooms` 행이 없는 건"을 탐지·보정하는 점검 절차를 v1.1 배포 게이트에 추가
  4. §5.2의 "비노출 스키마가 유일한 구조적 방어" 논리 폐기 — 정본 방어선은 **GRANT(EXECUTE) 기반**이며, 스키마 비노출은 내부 구현부 은닉 수단으로만 기술.

### A-3. 컬럼 단위 REVOKE는 무효 — M11·M12 테이블 단위 전면 회수로 교체 (분리 유지)

- **결함(확정·실측):** `anon`·`authenticated`가 `mentor_profiles`·`mentor_plans`에 **테이블 단위** INSERT/UPDATE/DELETE(및 TRUNCATE) 권한 보유. PostgreSQL은 테이블 단위 권한이 있으면 컬럼 단위 REVOKE가 실효 없음 → v1.0의 컬럼 단위 회수는 적용해도 XW-02가 닫히지 않음.
- **정정(오너 확정 — v1.0의 M11·M12 분리 구조 유지, rev 3에서 전면 회수로 강화):** 라이브 권한은 두 역할 모두 7종(SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER)이므로 비SELECT 전부를 회수한다. `REVOKE ALL` + `GRANT SELECT` 형태로 고정:

  ```sql
  -- M11
  REVOKE ALL ON public.mentor_profiles FROM anon, authenticated;
  GRANT SELECT ON public.mentor_profiles TO anon, authenticated;
  -- M12
  REVOKE ALL ON public.mentor_plans FROM anon, authenticated;
  GRANT SELECT ON public.mentor_plans TO anon, authenticated;
  ```
- **적용 게이트:**
  - **M11 전:** ① F7 전환 완료 ② A-4 정산계좌 RPC 적용 + 웹 호출부(`lib/mentor/mentorPayoutAccountActions.ts`) 전환 ③ `syncAfterSignUpWithSession` 백업 upsert 제거 ④ 프로필 직접 쓰기 실측 0건 확인
  - **M12 전:** ① F8 전환 완료 ② 플랜 직접 쓰기 실측 0건 확인
- **참고(실측):** 현재 실효 방어는 전적으로 RLS(`mentor_update_own` 등 own-row 정책)뿐임. TRUNCATE는 RLS 대상이 아니나 PostgREST가 TRUNCATE를 노출하지 않아 즉각적인 HTTP 공격 경로는 아님 — 그러나 "최소 권한·전면 회수" 계약이므로 위 `REVOKE ALL` 형태로 TRUNCATE·REFERENCES·TRIGGER까지 함께 회수한다.

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
- **재생 — 관계 결속(오너 확정, rev 3 / 오류코드·NULL 규칙 rev 4):** 금액 비교와 별도로 다음 결속을 전건 검증한다. 불일치 시 재생 성공을 반환하지 않으며, 관계 계층별로 **안정 오류코드**를 반환한다:

  | 결속 | 검증 | 불일치 코드 |
  |---|---|---|
  | payment–plan | `payments.plan_id = p_plan_id` | `PLAN_BINDING_MISMATCH` |
  | payment–subscription 당사자 | `payments.user_id = subscription.student_id` · `payments.mentor_id = subscription.mentor_id` | `PARTY_BINDING_MISMATCH` |
  | ledger–subscription | `ledger.user_id = payments.user_id` · `ledger.ref_id = subscription.id` | `LEDGER_BINDING_MISMATCH` |
  | room 당사자·참조 | pair(student, mentor) 일치 + 아래 참조 규칙 | `ROOM_REF_MISMATCH` |

  **NULL 규칙:** 위 표의 payment·subscription·ledger 결속은 전부 **필수 관계**로, 어느 쪽이든 NULL이면 일치가 아니라 **해당 코드로 명시 거부**한다 (일반 `=`의 NULL 통과 금지). nullable 호환 관계(room 참조 컬럼)만 `IS NOT DISTINCT FROM` 또는 아래 보정 규칙을 적용한다.
- **오류코드 우선순위(rev 5 — 기존 안정 코드와의 호환 확정):** 라이브 정본의 기존 코드(`SUCCEEDED_NO_SUBSCRIPTION`·`SUCCEEDED_NO_LEDGER`·`LEDGER_FIELD_MISMATCH`, 전부 anomaly 행 + `anomaly_id` 반환)는 **그대로 유지**하며, 새 4종은 "행은 존재하지만 관계가 다른 경우"에만 적용한다. 판정 순서 고정:

  ```text
  1. 구독 행 없음          → SUCCEEDED_NO_SUBSCRIPTION   (기존 유지)
  2. 원장 행 없음          → SUCCEEDED_NO_LEDGER         (기존 유지)
  3. payment–plan          → PLAN_BINDING_MISMATCH
  4. 당사자 불일치         → PARTY_BINDING_MISMATCH
  5. 원장 관계 불일치      → LEDGER_BINDING_MISMATCH
  6. 원장 필드값 불일치    → LEDGER_FIELD_MISMATCH       (기존 유지 — 금액·6필드 값 대조)
  7. 방 참조 충돌          → ROOM_REF_MISMATCH
  ```

  **새 4종의 계약:** 기존 3종과 동일하게 ① anomaly 행 기록 ② 응답에 `anomaly_id` 반환 ③ **트랜잭션 부작용 0**(자금·구독·원장·결제 상태·방 어느 것도 변경하지 않음)을 명시한다. 기존 안정 코드를 새 코드로 덮어쓰는 것을 금지한다.
- **room 참조 규칙 동결(rev 5 — 오너 권장 확정안 채택):** 라이브 구조상 방·구독 모두 `(student_id, mentor_id)` UNIQUE이고, 정본 checkout은 **재구독 시 기존 구독 행을 UPDATE하며 `payment_id`·`last_payment_id`를 새 결제 ID로 교체**한다(원문 실측). 따라서 rev 4의 "참조 컬럼에 다른 값이 있으면 일괄 거부"는 정상 재구독을 막는 결함이었다 — 컬럼별 의미를 다음으로 분리 확정한다:

  | 컬럼 | 정본 의미 | 신규 결제 | 멱등 재생 |
  |---|---|---|---|
  | `student_id, mentor_id` | 방의 불변 정본 | 변경 금지 | 일치 필수 |
  | `subscription_id` | pair에 대응하는 구독 | NULL이면 채움, 다른 값이면 거부 | 일치 필수 |
  | `payment_id` | **가장 최근 성공 checkout** | 현재 결제로 갱신 | 아래 재생 판정 규칙 |

  (`payment_id`를 "최초 방 생성 결제의 불변 참조"로 쓰는 안은 **기각** — 최신 참조 의미론으로 고정하며, 두 의미를 섞지 않는다.) 방 복구(존재하지 않는 방의 재생성) 실패는 A-2 §3(`ROOM_ENSURE_FAILED`, 자금 불변)을 따른다. 실측 참고: 현재 방 2건 중 1건은 두 참조가 NULL — 위 표의 "NULL이면 채움/갱신" 규칙으로 수렴된다.
- **늦은 과거 결제 재생 판정(rev 7 — 오너 확정, rev 6 규칙 폐기):** rev 6의 "`room.payment_id` = 재생 중인 payment → 일반 멱등 성공" 판정은 폐기한다 — P1 성공 → P2 성공 후 방 갱신만 누락된 stale 상태(`room.payment_id=P1`, `subscription.last_payment_id=P2`)에서 P1 재생이 방을 P1에 방치하는 결함이 있었다. **최신 결제의 유일한 정본은 `FOR UPDATE`로 잠근 `subscription.last_payment_id`**로 고정하며, `created_at`·`updated_at` 등 시각 비교로 최신성을 추론하지 않는다. 판정 순서 확정:

  ```text
  C = 잠근 subscription.last_payment_id
  P = 재생 중인 payment_id

  1. C가 NULL이 아니어야 한다.
  2. C가 가리키는 payment가 succeeded이고 동일 student/mentor pair인지 검증한다.

  3. room.subscription_id:
     - NULL이면 현재 subscription.id로 보정
     - 현재 subscription.id와 다르면 ROOM_REF_MISMATCH
     - 같으면 유지

  4. room.payment_id:
     - C와 같으면 유지
     - NULL이면 C로 보정
     - P와 같고 P != C이면 stale room으로 판정해 C로 보정
     - P도 C도 아닌 값이면 ROOM_REF_MISMATCH

  5. P = C:
     - 최신 결제의 일반 멱등 재생

  6. P != C:
     - P 자체가 succeeded
     - P가 동일 student/mentor pair
     - P의 payment·subscription·ledger 결속이 모두 일치
     위 조건을 통과한 경우에만 늦은 과거 결제 재생으로 멱등 성공
  ```

  room 보정은 자금·원장·구독·결제 상태를 변경하지 않는 **참조 복구만** 허용한다. `ROOM_REF_MISMATCH`는 기존 오류 우선순위·anomaly 계약을 유지한다 (anomaly 행 기록 · `anomaly_id` 반환 · 자금·구독·원장·결제·방 상태 변경 0건).

  **필수 회귀 테스트 4건(v1.1 테스트 절에 추가):**

  ```text
  A. P1 성공 → P2 성공 → P1 재생, room=P2
     → ok:true, idempotent:true / room=P2 유지 / 자금 부작용 0, anomaly 0

  B. P1 성공 → P2 성공 뒤 room=P1(stale) → P1 재생
     → ok:true, idempotent:true / room을 P2로 복구 / 자금 부작용 0, anomaly 0

  C. P1 성공 → P2 성공 뒤 room.payment_id=NULL → P1 재생
     → ok:true, idempotent:true / room을 P2로 복구 / 자금 부작용 0, anomaly 0

  D. room.payment_id가 P도 C도 아닌 제3 결제
     → ROOM_REF_MISMATCH + anomaly_id / 모든 상태 변경 0
  ```

  **실측 한계 명시:** 현재 라이브 DB에는 pair당 succeeded 결제가 최대 1건이므로 P1→P2 상황은 실데이터로 확인된 것이 아니다 — 계약 fixture로 검증할 **미래 경계 조건**이다.
- **실데이터 확인(2026-07-29):** 현재 구독 결제 2건 모두 `payments.amount = 29,900(KRW)` · `mentor_plans.amount_cents = 2,990,000` · `payments.amount × 100 = amount_cents` 관계 성립.
- **DB 계약 명시(오너 지시):** 라이브 `payments.amount`는 numeric이며 통화·정수 CHECK가 없음(실측: subscription 결제 2건 모두 `currency='KRW'`·`amount=29900`·소수 0건). 위 KRW·정수 규칙을 v1.1의 DB 계약(문서 차원)으로 명시하고, CHECK 제약 추가 여부는 S3 후보로 기재.
- **부수 기록:** 현행 정본의 "재생 시 현재가 대조" 동작 자체가 XW-04 인접의 잠재 결함임을 v1.1 AS-IS 절에 사실로 기재.

### A-6. F11 — topup 정본 확정(`idempotency_key` 단독) + 6필드 NULL-safe 대조 + 테스트 충전 분리

- **topup 정본 확정(오너 채택, rev 4):** 정본 공인 문서 `docs/sql/topup-ref-id-canon.md`를 **전부 유지**한다 — 주문 정본은 `idempotency_key`(=`orderId`, UNIQUE 제약 실재), `ref_id`는 NULL이 정상, **신규 DDL 불요**, `record_cash_topup` 3인자 유지. 이 정본과 충돌하는 v1.0의 **`ref_text` 컬럼·M2·4인자 F11은 전부 제거**한다 (`p_idempotency_key = p_order_ref`를 강제하는 이상 `ref_text`는 같은 문자열의 중복 저장일 뿐 새 추적 정보를 제공하지 않음). rev 2의 7필드 목록과 rev 3의 "신설 전 6필드/신설 후 7필드" 이중 계약은 **본 항으로 대체**한다 — F11은 선행 스키마가 갖춰진 **한 가지 계약**으로만 배포한다.
- **확정 계약:**
  1. `api_web_v1`의 F11 진입점은 **3인자 envelope wrapper** — `order_ref`를 그대로 멱등키로 사용(`p_idempotency_key = p_order_ref`, 별도 인자 아님)
  2. Toss 주문 참조 형식 `^cash-(.+)-(\d+)$` 강제
  3. V5의 topup `order_ref`는 **`idempotency_key`에서 반환**
- **duplicate 전건 대조 — 기존 6필드, NULL-safe:** 멱등 충돌 후 기존 원장 행을 **`FOR UPDATE`로 재조회**하고 다음 6필드를 전부 대조, 하나라도 다르면 `LEDGER_FIELD_MISMATCH`:

  ```text
  user_id           -- IS NOT DISTINCT FROM (p_user_id)
  delta_cents       -- IS NOT DISTINCT FROM (p_amount_cents)
  reason            -- IS NOT DISTINCT FROM 'cash_topup'
  ref_type          -- IS NOT DISTINCT FROM 'topup'   (라이브 topup 원장 4행 전부 'topup' — 2026-07-29 실측)
  ref_id            -- IS NULL (topup 정본 상태)
  idempotency_key   -- = p_order_ref (NOT NULL 강제 후 비교)
  ```

  일반 `=`·`<>`는 한쪽이 NULL이면 NULL을 반환해 불일치를 놓치므로 nullable 필드에 금지.
- **duplicate 판정의 원자성 — 공용 구현부와 레거시 함수 분리(rev 7 — 오너 확정):** 현행 `public.record_cash_topup(uuid,bigint,text)`의 계약은 `RETURNS void` · `SECURITY DEFINER` · service_role 전용 EXECUTE · `ON CONFLICT DO NOTHING RETURNING id` · **duplicate이면 지갑 미갱신·무음 반환**(실측)이다. F11의 엄격 대조를 공용 구현부에서 바로 예외로 던지면 이 무음 duplicate 계약이 깨지므로, 세 층으로 분리 확정한다. **사전 SELECT로 신규/duplicate를 추정하는 구현은 금지**(동시 호출에서 둘 다 신규로 오판).
  1. **공용 구현부 `core_private.record_cash_topup_impl(uuid,bigint,text)`** — 같은 트랜잭션에서: ① `INSERT … ON CONFLICT DO NOTHING RETURNING id` ② 신규 INSERT일 때만 지갑 갱신 ③ duplicate에서는 지갑 갱신 금지 ④ duplicate 행을 `FOR UPDATE`로 재조회 ⑤ 최소 반환:

     ```text
     ledger_id · inserted · user_id · delta_cents · reason · ref_type · ref_id · idempotency_key
     ```

  2. **기존 공개 함수 `public.record_cash_topup(uuid,bigint,text) RETURNS void`** — 기존 시그니처·service_role 전용·duplicate 무음 반환을 그대로 유지. 공용 구현부 반환값은 폐기하고, duplicate mismatch를 새로 외부에 노출하지 않는다.
  3. **신규 F11** — `inserted=false`일 때만 위 6필드 NULL-safe 대조 수행: 완전 일치 → `duplicate:true`, 하나라도 불일치 → `LEDGER_FIELD_MISMATCH`. duplicate에서 지갑 증분 0.
- **보안 속성(rev 7 — v1.1 명세 의무):** 공용 구현부·외부 wrapper 각각에 대해 **함수명 · 입력/출력 시그니처 · owner · schema · `SECURITY INVOKER`/`SECURITY DEFINER` · `search_path` · GRANT · REVOKE**를 전건 명세한다.
  - `core_private.record_cash_topup_impl`은 **`SECURITY INVOKER`**로 두고 모든 객체 참조를 schema-qualified로 작성
  - `core_private` 스키마와 내부 구현 함수는 **`PUBLIC`·`anon`·`authenticated`·`service_role`의 직접 USAGE/EXECUTE를 명시 회수**
  - 외부 wrapper만 `SECURITY DEFINER`, `PUBLIC`·`anon`·`authenticated` EXECUTE 회수 후 **service_role만 허용**
  - **함수 생성과 권한 회수는 같은 마이그레이션에서** 수행
- **회귀 테스트(rev 7):** ① 기존 3인자 함수 신규 호출 ② 기존 3인자 함수 동일 duplicate ③ 기존 3인자 함수 충돌 duplicate ④ 동시 호출 ⑤ 지갑 증분 정확히 1회 ⑥ 신규 F11에서만 동일 duplicate와 충돌 duplicate 구분.
- **M2 번호 정책(rev 5 — 오너 확정):** M2 제거 후 이후 번호를 당기지 않는다. stale 참조 재발 방지를 위해 **`M2: retired / no migration`으로 논리 슬롯을 남기고 M3~M12의 기존 논리 ID를 유지**한다. v1.1 부록의 객체 합계는 `column 1 → column 0`으로 정정한다 (F11은 위치·시그니처만 바뀌므로 **함수 수에는 계속 포함**).
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

- **정정:** 공개 라벨 함수 형태의 F0를 폐기하고, 라벨 도출 로직을 관계가 이미 확인된 조회(뷰·함수) 내부로 좁힘.
- **허용 선택 범위(rev 6 — 오너 확정):** exposed schema의 일반 SECURITY DEFINER 뷰는 기반 RLS를 우회할 수 있으므로, v1.1이 허용하는 구현은 다음 둘뿐이다:
  1. **`security_invoker = true` 뷰** + 필요한 라벨의 비정규화 컬럼
  2. **관계를 내부에서 검증하는 범위 제한 SECURITY DEFINER RPC**

  **금지:** 임의 UUID를 받는 라벨 함수, 일반(invoker 미지정) SECURITY DEFINER 뷰.
- **객체별 결정:** V2·V6·V7은 성격이 다르므로 하나의 선택으로 일괄 처리하지 말고 **객체별로** 위 허용 범위 안에서 결정한다 (v1.1 작성 세션 몫).
- **V6 필드명 단일 확정(rev 7):** V6 값의 실질 의미는 라이브 `mentor_plans`에서 읽는 **현재 플랜 가격**이므로 **`current_plan_amount_cents` 하나로 확정**한다 (선택지로 남기지 않음). `next_renewal_amount_cents`는 실제 다음 결제 금액을 별도 고정·스냅샷하는 계약이 생겼을 때 **additive 필드로만** 검토하며 v1.1에서는 사용하지 않는다.

### A-10. 커뮤니티 작성은 멘토 전용 — 제품 정책 반영 (rev 5 신설)

- **결함(확정·실측):** 확정 제품 정책은 **"커뮤니티 게시글 작성은 멘토만, 학생·비로그인·관리자 작성 CTA 제거"**이나, 앱 계약 v1.0의 `ROLE_NOT_ALLOWED`(= 학생·멘토가 아님)는 학생 작성을 허용하는 정의이고, 라이브 RLS도 역할 검사 없이 로그인 사용자 INSERT를 허용한다 (`cp_write_self`: authenticated 본인 작성 · 레거시 `로그인 유저 게시글 작성`: `auth.uid() = author_id`).
- **정정(v1.1 필수 반영):**
  1. F4 create는 **`users.role = 'mentor'`만 허용**, 위반 오류코드는 **`ROLE_NOT_MENTOR`**
  2. 관리자도 **일반 작성 경로에서는 거부** (관리자 공지 경로는 별도 계약)
  3. 웹·앱 RPC 전환 완료 후 `community_posts`의 직접 INSERT/UPDATE 권한과 레거시 정책(`cp_write_self` · `로그인 유저 게시글 작성`) 회수 — C절 hard DELETE 게이트와 같은 "RPC 제공 → 전환 배포 → 회수" 순서 적용
  4. 앱 계약의 `ROLE_NOT_ALLOWED` 설명을 멘토 전용 기준으로 수정 (F절 공용 함수 대조표에 포함)
- **동결(rev 6 — 오너 권장 확정안 채택, 실측: 게시글 멘토 4·학생 3 전부 published):**
  - **신규 작성 = 승인 멘토만.** 역할 불일치 → `ROLE_NOT_MENTOR`, 멘토지만 미승인 → `MENTOR_NOT_APPROVED`. 승인 판정은 기존 `individual_question_user_is_approved_mentor(auth.uid())`와 동일 헬퍼 사용(정본 checkout과 동일 기준).
  - **기존 학생 글:** 열람 유지 · 수정 금지 · 작성자 본인의 F6 soft-delete 허용 · 관리자 moderation은 별도 경로 유지. 파괴적 정리(일괄 삭제·비공개화) 금지.
  - **숏폼(rev 7 실측 정정):** 현재 INSERT는 이미 멘토 전용. 정책 실재는 다음과 같다 — `shortform_posts` INSERT 정책 **`sf_insert_mentor` 1건**, Storage INSERT 정책은 버킷별 2건이 아니라 **`sfv_mentor_insert` 1건이 `shortform-videos`·`shortform-thumbnails` 2버킷을 함께 포괄**(2026-07-29 `pg_policies` 실측). 두 정책 모두 동일 승인 헬퍼로 정합화하되, `sfv_mentor_insert` 수정 시 기존 조건 4종을 반드시 보존한다: ① 대상 버킷 제한 ② 사용자 폴더 소유권(`storage.foldername(name)[1] = auth.uid()`) ③ `NOT account_deletion_write_blocked(auth.uid())` ④ authenticated 역할 범위.

---

## B. 공용 구현부 명세 의무

v1.0이 참조만 하고 정의하지 않은 공용 구현부(공용 검증기·공용 원장 기록기 등)는 v1.1에서 **함수명·시그니처·스키마 위치·GRANT까지** 전건 명세한다. "시그니처 확정" 게이트(§10 #3)는 공용 구현부 포함으로 재정의하며, 미명세 상태로는 게이트 통과 불가.

## C. 커뮤니티 직접 쓰기 전면 잠금 (`HD-1`) — 보상 삭제 RPC 폐기

- **실측:** 앱 `lib/features/community/data/community_write_repository.dart:204-210` + `board_author_gate.dart:183`(`deleteOwnPostForCompensation`)이 `community_posts.delete()`를 실행 — **생성 실패 보상 전용** 내부 경로(공개 API·UI·라우트 없음).
- **보상 삭제 RPC 폐기(rev 6 — 오너 확정):** 대체 RPC는 **만들지 않는다**. F4가 트랜잭션 RPC + `p_idempotency_key` 필수가 되면, 응답 유실·불명확 시 **같은 멱등키로 재호출**하는 것이 정본 복구 경로다(이미 성공했으면 기존 `post_id` 반환, 실패했으면 DB 트랜잭션 롤백이라 지울 행이 없음). authenticated hard-delete API는 새 공격면만 만든다. 이로써 "보상 삭제 RPC 계약"은 잔존 설계 선택에서 **삭제**. 단, **Storage에 먼저 올린 신규 이미지의 보상 삭제는 유지** — 제거 대상은 DB 게시글 hard DELETE뿐.
- **게이트 순서(rev 7 확대 — 변경 금지):** `HD-1`은 `REVOKE ALL`이므로 DELETE만이 아니라 **웹·앱의 anon/authenticated 세션 경로에서 `community_posts` 직접 INSERT/UPDATE/DELETE 전부 0건**을 확인해야 한다. 현재 전환 대상: **웹 = 직접 INSERT·UPDATE**, **앱 = 직접 INSERT·보상 DELETE**.

  ```text
  1. F4/F5/F6 웹·앱 전환
  2. F4 응답 불명확 시 동일 멱등키 재시도 구현
  3. deleteOwnPostForCompensation 제거
  4. 앱 DB 게시글 hard DELETE 제거
  5. 웹·앱 anon/authenticated 세션의 직접 INSERT/UPDATE/DELETE 0건 확인
  6. service_role 관리자 moderation 직접 UPDATE를 의도된 예외로 목록화·회귀 확인
  7. HD-1 적용
  ```

  **service_role 예외(명시):** `lib/admin/communityModerationCore.ts`의 service_role moderation은 유지한다 — `REVOKE … FROM anon, authenticated`의 대상이 아니다. 따라서 "저장소 전체에서 `community_posts` write 0건"처럼 service_role 예외까지 제거하는 잘못된 게이트를 사용하지 않는다.

- **`HD-1` 확정(rev 6 — "hard DELETE 회수"에서 "직접 쓰기 전면 잠금"으로 확장, 별도 CW 마이그레이션 불요):** F4/F5/F6 전환과 앱 보상 DELETE 제거 후 같은 마이그레이션에서:

  ```sql
  REVOKE ALL ON public.community_posts FROM anon, authenticated;
  GRANT SELECT ON public.community_posts TO anon, authenticated;
  ```

  같은 마이그레이션에서 제거할 정책 (2026-07-29 `pg_policies` 실측 전수):

  ```text
  INSERT: cp_write_self · 로그인 유저 게시글 작성
  UPDATE: cp_update_own · cp_update_self · 본인 게시글 수정
  DELETE: cp_delete_own
  ```

  SELECT 정책은 유지. 이후 쓰기는 F4/F5/F6만 통과한다.
- **마이그레이션 번호 정정(오너 확정):** v1.0의 **M8은 F7·F8 멘토 RPC 마이그레이션이므로 그대로 유지**한다. `HD-1`은 M8에 얹지 않는 별도 마이그레이션이다. v1.0 922행의 `§20 M8 선택 항목` 참조는 삭제.

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
7. **`ROLE_NOT_ALLOWED` 재정의(A-10):** 앱 계약의 커뮤니티 작성 오류코드 설명을 멘토 전용(`ROLE_NOT_MENTOR`) 기준으로 수정

## G. 다음 세션 지시

1. **산출물:** `api_web_v1 계약 v1.1`, `api_app_v1 계약 v1.1` 문서 2건. **SQL 작성·적용 금지** (S2-2는 v1.1 게이트 통과 후 별도 세션).
2. 본 지시서 A~F를 전건 반영하고, 각 항목에 "반영 절 번호"를 역기입해 추적 가능하게 할 것.
3. E절의 stale 참조 3건(945행·1315행·1754행)은 확정 정정값으로 교체 완료 여부를 게이트에서 확인할 것 (본 지시서 rev 2에서 원문 대조 확정 — 미확정 항목 아님).
4. 자금 함수 3종(`confirm_subscription_checkout`·`record_cash_topup`·renewal)의 본문 분기 순서는 요약 전재가 아니라 **원문 기준 재기술** ([C4] 오측 재발 방지).
5. **객체별 결정 의무:** F0 계열 V2·V6·V7의 구현을 A-9 허용 범위 안에서 **객체별로** 확정하지 않으면 게이트 통과 불가. (그 외 설계 선택은 본 지시서에서 전부 동결 완료.)
6. **회귀 테스트 의무:** A-5의 늦은 재생 테스트 4건(A~D — stale room 복구·NULL 복구·제3 결제 거부 포함)과 A-6의 회귀 테스트 6건(레거시 신규/동일 duplicate/충돌 duplicate·동시 호출·지갑 증분 1회·F11 strict 구분)을 v1.1 테스트 절에 포함. P1→P2 fixture는 실데이터가 아닌 미래 경계 조건임을 테스트 주석에 명시.
7. 게이트: A-1~A-10 반영 + B 공용 구현부 전건 명세 + C의 `HD-1`(직접 쓰기 전면 잠금, M8 불변) + 5·6항 완료 + F 동기화(공용 함수·시그니처·오류코드·GRANT 대조 포함) 시 S2-1 PASS / S2-2 GO 재선언 심사 가능. SQL 작성은 두 계약 문서의 시그니처·오류코드·GRANT·테스트 대조 통과 뒤에만.

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
