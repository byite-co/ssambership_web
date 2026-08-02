# S3-C — Build 13 DB 계약 정본 (2026-08-02)

> 이 문서는 `supabase/sql/20260802024641_build13_db_contract_convergence.sql` 이 확정한
> **서버 정본 계약**이다. S3-D(앱 전환)·S3-E(질문방 신고)는 이 문서의 시그니처·오류코드만
> 사용한다. 임의 확장 금지.
>
> **적용 상태: 로컬 검증 완료 · 운영/staging 미적용(`PRODUCTION_APPLIED: NO`).**

---

## 1. 게시판 글 작성 RPC

### 1.1 시그니처 (앱·웹 완전 동일 — 변경 없음)

```
api_app_v1.community_post_create(
  p_title            text,
  p_body             text,
  p_category         text,
  p_idempotency_key  uuid,
  p_image_refs       text[] DEFAULT '{}',
  p_status           text   DEFAULT 'published'
) RETURNS jsonb
```

웹 표면은 `api_web_v1.community_post_create(...)` — 인자·반환·오류코드가 동일하며 같은
공용 구현부(`core_private.community_post_create_impl`)를 호출한다.

- EXECUTE: `authenticated`(앱), `authenticated` + `service_role`(웹). `anon` 0.
- **`public.community_posts` 직접 INSERT/UPDATE/DELETE 는 계속 불가**(M16 잠금 유지).
  앱은 반드시 이 RPC 만 쓴다. 직접 INSERT 는 `42501`로 실패한다.

### 1.2 반환 envelope

성공:

```json
{ "ok": true, "post_id": "<uuid>", "idempotent_replay": false, "contract_version": 1 }
```

동일 `p_idempotency_key` 재호출(replay) 또는 동시 경합 패자:

```json
{ "ok": true, "post_id": "<동일 uuid>", "idempotent_replay": true, "contract_version": 1 }
```

실패:

```json
{ "ok": false, "code": "<ERROR_CODE>", "contract_version": 1 }
```

### 1.3 지원 역할 (S3-C 변경점)

| 호출자 | 결과 |
|---|---|
| active student | **허용** |
| active mentor (승인 여부 무관) | **허용** |
| admin | 거부 — `ROLE_NOT_ALLOWED` |
| unknown role / `public.users` 행 부재 | 거부 — `ROLE_NOT_ALLOWED` |
| guest / anon | 거부 — EXECUTE 권한 없음(`42501`) |
| banned | 거부 — `ACCOUNT_BANNED` |
| 유효 suspended (`suspended_until` NULL 또는 미래) | 거부 — `ACCOUNT_SUSPENDED` |
| suspended 만료 (`suspended_until` 과거) | **허용** |
| 계정 삭제 write-blocked | 거부 — `ACCOUNT_DELETION_IN_PROGRESS` |

> **폐지:** 종전 "승인 멘토 전용" 제한. `MENTOR_NOT_APPROVED` 는 create 경로에서 더 이상
> 발생하지 않는다.

### 1.4 오류코드 전집합 (create)

| code | 발생 조건 | 신규/변경 |
|---|---|---|
| `AUTH_REQUIRED` | `auth.uid()` 없음 | — |
| `ROLE_NOT_ALLOWED` | role ∉ {student, mentor} (admin·unknown·users 행 부재) | **신설** |
| `ACCOUNT_BANNED` | `users.status = 'banned'` | — |
| `ACCOUNT_SUSPENDED` | 유효 정지 | — |
| `ACCOUNT_DELETION_IN_PROGRESS` | 삭제 job 진행 중 | — |
| `TITLE_REQUIRED` | 제목 공백 | — |
| `CATEGORY_INVALID` | category ∉ {study, school, career, college, free} | — |
| `BODY_TOO_SHORT` | `status='published'` 이고 본문 10자 미만 | — |
| `IMAGE_COUNT_EXCEEDED` | image_refs 6개 이상 | — |
| `IMAGE_REF_INVALID` / `IMAGE_NOT_OWNED` / `IMAGE_OBJECT_NOT_FOUND` / `IMAGE_MIME_NOT_ALLOWED` / `IMAGE_SIZE_EXCEEDED` | 이미지 ref 검증 5종 | — |

**create 경로에서 제거된 코드:** `ROLE_NOT_MENTOR` · `MENTOR_NOT_APPROVED`.

> `p_idempotency_key` 가 NULL 이거나 `p_status` 가 draft/published 가 아니면 envelope 이 아니라
> **SQL 예외**로 전파된다(계약 밖 입력 — 종전 동작 보존).

### 1.5 보존 불변

replay-first(멱등 조회가 신규 검증보다 선행) · `(author_id, create_idempotency_key)` UNIQUE 기반
동시 경합 수렴 · 제목/본문 연락처 마스킹 6단계 · `author_label`(nickname → 비면 `쌤버십 사용자`)
· `author_role` 서버 도출 · 이미지 ref 5종 검증 · 클라이언트 `author_*` 불수신.

### 1.6 게시판 글 수정 RPC (F5) — 동일 계약으로 수렴 [보정 §2]

```
api_app_v1.community_post_update(
  p_post_id             uuid,
  p_title               text,
  p_body                text,
  p_category            text,
  p_expected_updated_at timestamptz,
  p_image_refs          text[] DEFAULT '{}',
  p_status              text   DEFAULT 'published'
) RETURNS jsonb
```

웹 표면 `api_web_v1.community_post_update(...)` 동일. 시그니처·`contract_version`(1) 불변.

**지원 역할은 create 와 완전 동일**하다 — active student / active mentor 가 **자기 글**을
수정한다. 멘토 승인은 요구하지 않는다(`MENTOR_NOT_APPROVED` 폐지).

성공:

```json
{ "ok": true, "post_id": "<uuid>", "updated_at": "<timestamptz>",
  "removed_image_refs": ["..."], "contract_version": 1 }
```

`removed_image_refs` = (기존 image_refs) − (신규 image_refs). 클라이언트가 커밋 후
best-effort 로 스토리지에서 지운다.

| 상황 | code |
|---|---|
| 미인증 | `AUTH_REQUIRED` |
| 글 없음 / 타인 글 / 삭제된 글 | `POST_NOT_FOUND_OR_NOT_OWNED` (단일 코드 — 존재 여부를 흘리지 않는다) |
| admin · unknown role · users 행 부재 | `ROLE_NOT_ALLOWED` |
| banned / 유효 suspended / 삭제 진행 | `ACCOUNT_BANNED` / `ACCOUNT_SUSPENDED` / `ACCOUNT_DELETION_IN_PROGRESS` |
| `p_expected_updated_at` 불일치 | `UPDATE_CONFLICT` |
| 제목·카테고리·본문·이미지 | create 와 동일 코드 집합 |

**update 경로에서 제거된 코드:** `ROLE_NOT_MENTOR` · `MENTOR_NOT_APPROVED`.
→ 두 코드는 **어느 커뮤니티 경로에서도 더 이상 발생하지 않는다.**

`public.community_posts` 직접 UPDATE 도 계속 `42501` 이다(M16 잠금 유지 — 사후 검증에서 단언).

소프트 삭제(F6)는 종전대로 작성자 본인이면 역할 무관 허용. 따라서 **학생·멘토가
작성·수정·삭제 전 기능을 동일하게 사용**한다(비대칭 해소).

---

## 2. 직접 UGC write 계정 상태 게이트 [보정 §1 — fail-closed]

`public.ugc_write_allowed()` — **인자 없는 self 전용 판정기**(SECURITY DEFINER,
`search_path=''`, EXECUTE = `authenticated` + `service_role`, `anon`/PUBLIC 0).

**허용 목록(fail-closed)** 이다. 아래 조건이 **전부** 참일 때만 `true`:

1. `auth.uid()` non-null
2. `public.users` 에 자기 행이 실재
3. `role IN ('student','mentor')`
4. `status = 'active'` **또는** `status = 'suspended'` 이면서 `suspended_until <= now()`
   (정지 만료). `suspended_until` 이 NULL 이면 만료가 아니다.
5. `account_deletion_write_blocked(self) = false`

따라서 다음은 **전부 `false`(차단)**:

| 케이스 | 결과 |
|---|---|
| `users` 행 부재 (JWT 는 유효하나 프로필 없음) | 차단 |
| `role = 'admin'` | 차단 |
| `status = 'deleted'` | 차단 |
| unknown status (예: `dormant`) | 차단 |
| `status` NULL / 빈 문자열 | 차단 |
| `banned` | 차단 |
| 유효 `suspended` | 차단 |
| 삭제 write-blocked | 차단 |
| 미인증 | 차단 |

> 종전 "차단 목록"(명시 3상태만 막고 나머지는 허용) 구현은 **폐기**했다.
> `comments` · `community_comments` · `post_reactions` 는 `public.users` 로의 FK 가 없어,
> "행이 없으면 허용"이 그대로 우회로가 되기 때문이다.

게이트가 결합된 정책 7종:

| 테이블 | 정책 | cmd |
|---|---|---|
| `comments` | `comments_insert_own` | INSERT |
| `comments` | `comments_update_own` | UPDATE |
| `community_comments` | `community_comments_insert_authenticated` | INSERT |
| `post_reactions` | `post_reactions_insert_own` | INSERT |
| `post_reactions` | `post_reactions_delete_own` | DELETE |
| `shortform_reactions` | `shortform_reactions_insert_own` | INSERT |
| `shortform_reactions` | `shortform_reactions_delete_own` | DELETE |

게시판 글 RPC(create/update/soft_delete)는 구현부에서 자체 계정 게이트를 수행한다.

**제거:** `post_reactions` 의 한글명 중복 정책 2종(`로그인 유저 반응 추가` INSERT/public,
`본인 반응 삭제` DELETE/public). permissive OR 로 게이트를 우회시키던 경로이며, 조건이
authenticated 정책의 진부분집합이라 정당 사용자 권한 손실은 없다.

**게이트를 붙이지 않는 경로(과잉 차단 금지):** content report 접수 · user block/unblock ·
계정 삭제 · 고객지원. banned·deleted 사용자도 이 경로들은 계속 사용할 수 있다.

클라이언트 관점 실패 코드: RLS 위반이므로 PostgREST `42501`.

> **잔여 비대칭(오너 인지 사항):** 위 fail-closed 허용 목록은 helper 를 쓰는 7개 정책에만
> 적용된다. 게시판 글 RPC(create/update)의 계정 게이트는 지시서가 열거한
> banned / 유효 suspended / 삭제 진행 3상태만 거부하므로, 이론상 `status='deleted'` 같은
> 값이면 댓글은 못 달아도 글은 쓸 수 있다. 운영 `public.users.status` 는 `NOT NULL
> DEFAULT 'active'` 이고 CHECK 제약이 없으며 현재 실존 값이 `active` 뿐이라 **현시점
> 도달 불가**다. 게시판 RPC 까지 허용 목록으로 통일하려면 별도 판단이 필요하다.

---

## 3. `content_reports` 필드 무결성 계약 (S3-E 필독)

정책 `content_reports_insert_reporter` (INSERT, `authenticated`) WITH CHECK:

```
reporter_id = auth.uid()
AND status      = 'pending'
AND admin_note  IS NULL
AND resolved_by IS NULL
AND resolved_at IS NULL
AND target_type IN ('community_post','shortform','shortform_post',
                    'community_comment','board_comment','user')
AND (target_type <> 'user' OR public.report_target_user_valid(target_id))
```

`public.report_target_user_valid(uuid)` (SECDEF · `authenticated`/`service_role` EXECUTE)
는 다음이 **전부** 참일 때만 true — `target_id` non-null · `target_id <> auth.uid()`
(자기 신고 금지) · `public.users` 에 해당 행 실재. `public.users` RLS 가 authenticated
에게 자기 행만 보여주므로 SECDEF 가 아니면 계약이 정반대로 뒤집힌다.

- 위 조건을 어기는 커스텀 REST 호출은 **조용한 정규화가 아니라 `42501` 명시 거부**다.
- `status` 는 컬럼 DEFAULT `'pending'` 이므로 정상 클라이언트는 필드를 보내지 않으면 된다.
- **`admin_note` / `resolved_by` / `resolved_at` / `status` 를 요청 바디에 포함하지 말 것.**
- 관리자 UPDATE 경로(`content_reports_update_admin`)는 불변 — 관리자는 종전대로
  status·admin_note·resolved_* 를 갱신한다.

### 3.1 질문방 신고 계약 (`target_type = 'user'`)

- **DB 제약:** `content_reports` 에는 `target_type` 열거 CHECK 가 없다
  (`content_reports_target_type_nonempty` 만 존재). 따라서 `'user'` 는 **제약 추가 없이 저장 가능**
  하며, 본 migration 의 INSERT 정책 화이트리스트가 허용 집합의 정본이다.
- **필드:** `target_type='user'`, `target_id = 신고 대상 사용자 UUID`, `reporter_id = auth.uid()`,
  `reason` 은 기존 커뮤니티 신고와 동일한 사유 문자열, `description` 은 500자 이내 선택.
- **[보정 §4] 대상 무결성:** `target_id` 는 **반드시 실재하는 다른 사용자**여야 한다.
  자기 자신(`target_id = auth.uid()`), 존재하지 않는 UUID, NULL 은 모두 `42501` 거부.
  다른 `target_type` 은 이 검사를 받지 않는다(콘텐츠는 soft-delete·삭제 레이스에서
  접수 자체가 막히면 안 되기 때문).
- **차단되지 않는 것:** banned·deleted reporter 도 정상 상대를 신고할 수 있다
  (과잉 차단 금지). 관리 필드 위조 거부는 `user` 신고에도 동일하게 적용된다.
- **관리자 콘솔 동작:** `lib/admin/communityModerationCore.ts` 의
  `normalizeModerationTargetType('user')` → `null` → `applied:false`
  ("지원되지 않는 신고 대상 유형 — 신고 상태만 변경됩니다."). 즉 **신고 행은 접수·조회되고
  관리자 큐에 뜨지만, 자동 콘텐츠 조치(hide/delete/restore)는 수행되지 않는다.** 관리자는
  신고 상태만 전이시킨다. 사용자 제재는 별도 계정 상태 경로다.
- **금지:** 위 6개 값 외의 자유 텍스트 `target_type` 사용. 필요하면 신규 forward migration 으로
  화이트리스트를 확장한다.

---

## 4. `account_deletion_write_blocked(uuid)` self 제한

시그니처·반환형·EXECUTE 대상(`authenticated` + `service_role`) 불변.

| 호출 문맥 | 인자 | 결과 |
|---|---|---|
| 최종 사용자 JWT (`auth.uid()` non-null) | 자기 UUID | 종전대로 boolean |
| 최종 사용자 JWT | 타인 UUID 또는 NULL | **`42501` `ACCOUNT_DELETION_PROBE_FORBIDDEN`** |
| service_role 키 · 내부 worker · postgres 직결 (`auth.uid()` NULL) | 임의 UUID | 종전대로 boolean |

기존 호출자(스토리지 정책 5종 · `account_deletion_write_guard()` · `core_private` 구현부 ·
`api_web_v1` self RPC 3종)는 전부 자기 UUID 를 전달하므로 회귀 없음.
앱이 자기 `userId` 로 호출하는 경로도 그대로 동작한다.

---

## 5. 질문방 서버 차단·계정 상태 게이트 [보정 §3]

대상 정본 RPC 2종(시그니처·반환·SECDEF·ACL 전부 불변):

```
public.qna_append_message(p_thread_id uuid, p_body text) RETURNS jsonb
public.qna_register_attachment(p_thread_id uuid, p_storage_path text,
                               p_file_name text DEFAULT NULL,
                               p_mime_type text DEFAULT NULL,
                               p_message_id uuid DEFAULT NULL) RETURNS jsonb
```

**해소한 결함(S3-E 실측):** append 는 `banned` 만 검사했고 상호 차단 검사가 없었다.
attachment 등록은 계정 상태 검사 자체가 없었고 역시 상호 차단 검사가 없었다.

**게이트 위치:** 방 당사자(`v_is_mentor`) 확정 **직후**, `THREAD_LOCKED` · mentor
approval · 구독/환불 · storage 검증 · 모든 INSERT·상태 전이보다 **먼저**. 따라서 차단 시

- `question_messages` row **0**
- `question_attachments` row **0**
- `answered` 전이 **0**
- 알림 **0** (알림은 두 테이블의 AFTER INSERT 트리거이므로 INSERT 미도달 = 미발화)

**게이트 순서와 오류코드**(두 함수 동일 · 모두 `RAISE` — 기존 규약 유지):

| 순서 | 검사 | code |
|---|---|---|
| 1 | `public.users` 자기 행 실재 | `ACCOUNT_NOT_ACTIVE` |
| 2 | `status = 'banned'` | `ACCOUNT_BANNED` |
| 3 | 유효 `suspended`(`suspended_until` NULL 또는 미래) | `ACCOUNT_SUSPENDED` |
| 4 | `status` ∉ {active, suspended} (deleted·unknown·빈값) | `ACCOUNT_NOT_ACTIVE` |
| 5 | `account_deletion_write_blocked(auth.uid())` | `ACCOUNT_DELETION_IN_PROGRESS` |
| 6 | `qna_users_blocked(student_id, mentor_id)` | `BLOCKED` |

> `ACCOUNT_NOT_ACTIVE` 는 본 보정에서 **신설**한 코드다. 지시서가 요구한 "users 자기 행
> 존재" 검사를 기존 4종 코드로는 표현할 수 없어 fail-closed 코드 1종을 추가했다.
> S3-D/S3-E 는 이 코드를 "현재 계정 상태로는 질문방에 쓸 수 없음"으로 처리한다.

**차단은 양방향**이다 — `qna_users_blocked` 는 `(blocker, blocked)` 를 순서 무관으로 보므로
학생이 멘토를 차단하든 멘토가 학생을 차단하든 **양쪽 모두** append·attachment 가 막힌다.
차단 해제 즉시 정상 복귀한다.

**보존 불변(회귀 검증 완료):** thread `FOR UPDATE` · `THREAD_NOT_FOUND` ·
`NOT_ROOM_PARTY` · `THREAD_LOCKED` · `MENTOR_NOT_APPROVED` ·
`SUBSCRIPTION_REFUND_PENDING`(활성 구독 `FOR UPDATE` + live pending refund) ·
`STORAGE_PATH_REQUIRED` · `STORAGE_PATH_MISMATCH` · `STORAGE_OBJECT_NOT_OWNED` ·
`MESSAGE_THREAD_MISMATCH` · `BODY_REQUIRED` · INSERT · `answered` 전이 ·
알림 트리거 의미(멘토 행 1건 = 알림 1건) · 반환 envelope.

---

## 6. `custom_*` 공개 SELECT 제거

제거된 permissive `USING (true)` / role=`public` SELECT 정책 4종:

| 테이블 | 정책명 |
|---|---|
| `custom_order_deliverables` | `누구나 납품 읽기` |
| `custom_order_messages` | `누구나 메시지 읽기` |
| `custom_request_applications` | `누구나 지원서 읽기` |
| `custom_request_posts` | `누구나 의뢰 읽기` |

유지: `cdel_select` · `cmsg_all_party` · `cra_select` · `crp_select`(당사자·관리자).
결과: anon 은 4개 테이블에서 0행, 당사자·관리자 조회는 불변.

---

## 7. 검증 자산

| 파일 | 역할 |
|---|---|
| `scripts/verify/fixtures/s3_c_build13_contract_baseline_fixture.sql` | 2026-08-02 운영 read-only 실측을 재현한 오프라인 baseline 스텁 |
| `scripts/verify/s3_c_build13_db_contract_convergence_verify.sql` | forward 행위 검증 117 assertion |
| `scripts/verify/s3_c_build13_db_contract_convergence_rollback_verify.sql` | rollback 복원 검증 18 assertion |
| `scripts/verify/s3_c_local_roundtrip.sh` | fixture → forward → 재적용 → rollback → 재적용 → forward → clean-install 왕복 러너 |

---

## 8. 별도 플랫폼 게이트 — Data API 노출

`api_app_v1` 은 Supabase **Exposed schemas** 설정에 포함돼야 앱이 PostgREST 로 RPC 를
호출할 수 있다. 이는 SQL migration 이 아니라 플랫폼 콘솔 단계(D-API-A)이며,
**본 migration 은 노출 설정을 변경하지 않는다.**

```
DATA_API_EXPOSURE_REQUIRED: YES
DATA_API_EXPOSURE_VERIFIED: NO
```

운영 적용 시 순서: ① forward migration 적용 → ② `api_app_v1` Data API 노출 확인/설정 →
③ 앱에서 RPC 호출 검증. ②를 건너뛰면 게시판 작성은 계속 실패한다(원인이 SQL 이 아님).

---

## 9. 신설·폐지 오류코드 요약 (S3-D/S3-E 인수인계)

| code | 상태 | 발생 지점 |
|---|---|---|
| `ROLE_NOT_ALLOWED` | **신설** | community_post_create · community_post_update |
| `ACCOUNT_NOT_ACTIVE` | **신설** | qna_append_message · qna_register_attachment |
| `BLOCKED` | 질문방 append/attachment 로 **확대** | qna RPC 2종 (기존 thread 생성 경로에만 존재) |
| `ACCOUNT_SUSPENDED` | qna append/attachment 로 **확대** | qna RPC 2종 |
| `ACCOUNT_DELETION_IN_PROGRESS` | qna append/attachment 로 **확대** | qna RPC 2종 |
| `ROLE_NOT_MENTOR` | **폐지** | 커뮤니티 create·update 어디서도 발생하지 않음 |
| `MENTOR_NOT_APPROVED` | 커뮤니티 경로에서 **폐지** | 질문방 mentor approval 게이트에서는 계속 유효 |
