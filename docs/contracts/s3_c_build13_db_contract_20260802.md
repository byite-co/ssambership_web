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

### 1.6 범위 밖(S3-C 미변경) — 후속 판단 필요

`api_*_v1.community_post_update`(F5)는 **여전히 승인 멘토 전용**이며 학생 글 수정은
`ROLE_NOT_MENTOR` 로 거부된다. 본 세션 지시 범위가 `community_post_create` 뿐이므로 그대로 두었다.
결과적으로 학생은 **작성·삭제(F6, 역할 무관)는 가능하지만 수정은 불가**한 비대칭 상태다.
게시판 제품 계약상 학생 글 수정을 허용해야 한다면 별도 forward migration 이 필요하다 — 오너 판단 사항.

---

## 2. 직접 UGC write 계정 상태 게이트

`public.ugc_write_allowed()` — **인자 없는 self 전용 판정기**(SECURITY DEFINER,
`search_path=''`, EXECUTE = `authenticated` + `service_role`, `anon`/PUBLIC 0).

차단 3상태: `banned` · 유효 `suspended` · 계정 삭제 write-blocked.
그 외(users 행 부재 포함)는 차단하지 않는다.

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

게시판 글 RPC(create/update/soft_delete)는 구현부에서 동일 3상태를 이미 검사한다.

**제거:** `post_reactions` 의 한글명 중복 정책 2종(`로그인 유저 반응 추가` INSERT/public,
`본인 반응 삭제` DELETE/public). permissive OR 로 게이트를 우회시키던 경로이며, 조건이
authenticated 정책의 진부분집합이라 정당 사용자 권한 손실은 없다.

**게이트를 붙이지 않는 경로(과잉 차단 금지):** content report 접수 · user block/unblock ·
계정 삭제 · 고객지원. banned 사용자도 이 경로들은 계속 사용할 수 있다.

클라이언트 관점 실패 코드: RLS 위반이므로 PostgREST `42501`(`permission denied` /
`new row violates row-level security policy`). 앱은 이를 "현재 계정 상태에서는 작성할 수 없음"
으로 표기한다.

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
```

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

## 5. `custom_*` 공개 SELECT 제거

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

## 6. 검증 자산

| 파일 | 역할 |
|---|---|
| `scripts/verify/fixtures/s3_c_build13_contract_baseline_fixture.sql` | 2026-08-02 운영 read-only 실측을 재현한 오프라인 baseline 스텁 |
| `scripts/verify/s3_c_build13_db_contract_convergence_verify.sql` | forward 행위 검증 54 assertion |
| `scripts/verify/s3_c_build13_db_contract_convergence_rollback_verify.sql` | rollback 복원 검증 13 assertion |
| `scripts/verify/s3_c_local_roundtrip.sh` | fixture → forward → 재적용 → rollback → 재적용 → forward → clean-install 왕복 러너 |
