# 웨이브 1 · 개별질문(IQ) 첨부 서버 계약 — 적용 계획서

> **상태: 초안 · staging 미적용.** 이 문서와 함께 커밋된 `supabase/sql/167~169` 는
> 어느 것도 실행되지 않았다. 본 세션(트랙 3)에서 staging 에 실행한 문장은 **SELECT 뿐**이며,
> DDL·DML·fixture·storage 객체 변경은 0건이다.
>
> - 대상 프로젝트: `lbeqxarxothkmzqvpudy` (ssambership-staging) — read-only
> - 실조회 일자: 2026-07-25
> - 기점 커밋: `6062dcc3799be3a2b467661c98db1fb309741693` (PR #42 브랜치 HEAD)
> - **정본 브랜치: `wave1/server-sql-draft`** — 웨이브 1 프롬프트·트랙 5 대조·W3 인계가 모두
>   이 이름을 참조한다. 동일 커밋이 하네스 지정 브랜치 `claude/wave1-server-sql-draft-thwz4h`
>   에도 올라가 있으나(양쪽 내용 동일), 그쪽은 W3 완료 후 오너가 정리할 잔여물이다.
>
> **개정 2026-07-25 (22차 판정 반영 델타 4건):**
> ① §4-5 `iqa_select_party` 서술 정정 — 실재하는 **테이블 RLS** 정책명이며 "실명이 아니다"는
> 과잉 정정이었다. ② 가드 개수 표기를 실측 **5종**으로 통일(초판 4종·5종 혼재).
> ③ §5-4 파급 강도 완화 — 168 선행은 기능 정지가 아니라 **모호-수렴 경로로의 강등**이므로
> "동시 배포 필수" → "**168 후 A3 근접 후속**". ④ §5-5 경로 정규화 불변식 각주 신설 +
> §3-3 케이스 F 추가. 델타 4건 모두 문서·주석 한정이며 **SQL 실행 로직은 무변경**이다.

---

## 1. 적용 순서와 사유

| 순서 | 파일 | 성격 | 선행 의존 |
|------|------|------|-----------|
| 1 | `167_iq_attachment_unique_question_storage_path.sql` | DDL — UNIQUE 제약 신설 | 없음 |
| 2 | `168_iq_attachment_register_rpc_idempotent.sql` | 함수 교체 — 멱등 계약 | **167 필수** |
| 3 | `169_iq_attachment_storage_delete_policy.sql` | RLS 정책 신설 | 없음(순서상 뒤) |

### 167 → 168 이 **강제**인 이유

168 의 `INSERT ... ON CONFLICT (question_id, storage_path) DO NOTHING` 은 해당 컬럼 집합을
커버하는 UNIQUE 제약/인덱스를 arbiter 로 추론한다. 167 이 없으면 PostgreSQL 은
**42P10** (`there is no unique or exclusion constraint matching the ON CONFLICT specification`)
을 던진다. 이는 "멱등이 안 걸리는" 정도의 열화가 아니라 **모든 첨부 등록이 실패**하는 기능 정지다.

→ 168 스크립트 §0 에 arbiter 존재 검증 DO 블록을 넣어, 167 미적용 상태에서는 트랜잭션이
`ABORT_168` 로 중단되도록 했다. 순서 사고를 배포 시점에 잡는다.

### 169 를 마지막에 두는 이유

169 는 167·168 에 **기술적으로 의존하지 않는다**(독립 적용 가능). 다만 169 의 핵심 조건인
"등록 행이 없을 것"이 `individual_question_attachments` 를 참조하므로, 등록 경로가 멱등으로
안정된 뒤에 보상 삭제를 여는 편이 의미가 분명하다. 순서는 논리적 정합성 때문이지 의존성이 아니다.

### 되돌림 순서 (역순 강제)

앱 배선(App-A3) → **168 → 167** 역순. 167 을 먼저 지우면 168 이 살아 있는 동안 42P10 이 난다.
169 는 언제든 독립적으로 되돌릴 수 있다.

---

## 2. 각 SQL 의 6단계 절차 계획

세 파일 모두 아래 6단계를 **파일 단위로 완주**한 뒤 다음 번호로 넘어간다.
(167 을 1~6 완료 → 168 을 1~6 완료 → 169 를 1~6 완료. 세 개를 한꺼번에 적용하지 않는다.)

| 단계 | 내용 | 산출물 |
|------|------|--------|
| 1. read-only preflight | 적용 직전 실태 재조회. §4 쿼리를 그대로 재실행해 본 문서 수치와 대조. 불일치 시 중단 | 집계 스냅샷 |
| 2. rollback-only 재현 | 트랜잭션 안에서 **적용 전 결함을 실증**하고 `rollback` 으로 전량 폐기. §3 시나리오 사용 | 재현 로그 |
| 3. 적용 | 스크립트 실행. 각 파일은 `begin; ... commit;` 으로 감싸져 있고 §0 가드가 선행 | NOTICE 로그 |
| 4. fixture | 적용 후 기대 동작을 트랜잭션 픽스처로 검증하고 `rollback`. §3 시나리오 재사용 | 검증 로그 |
| 5. baseline 복원 | 픽스처가 남긴 행·객체가 0인지 확인. §4 집계를 재실행해 적용 전 수치와 동일함을 입증 | 대조표 |
| 6. manifest 기록 | 적용 커밋 해시·실행 시각·NOTICE 전문·§5 대조표를 적용 이력에 기록 | manifest 항목 |

### 단계 2·4 의 공통 규율

- **rollback-only**: 모든 픽스처는 `begin; ... rollback;` 안에서만 돈다. `commit` 금지.
- storage 객체는 트랜잭션으로 되돌릴 수 없다. 169 픽스처가 실제 객체 업로드를 요구하면
  그 부분은 별도 정리 절차(업로드한 객체 경로를 기록 → 검증 후 명시적 삭제)를 따르고,
  정리 완료를 §4-6 집계 재실행으로 입증한다.
- 기존 오염/고아 행은 **어떤 단계에서도 자동 수정하지 않는다**(§5 참조).

---

## 3. rollback-only fixture 설계 (실행 금지 — 설계만)

> 아래는 W3 적용 세션이 사용할 시나리오다. 본 세션에서는 **하나도 실행하지 않았다.**

### 3-1. 중복 차단 (167)

```
begin;
  -- 준비: 당사자 컨텍스트에서 첨부 1행 INSERT (경로 P, 질문 Q)
  -- 기대 1: 동일 (Q, P) 재INSERT → 23505 unique_violation, conname='uq_iqa_question_storage_path'
  -- 기대 2: (Q, P') 다른 경로 → 성공
  -- 기대 3: (Q', P) 다른 질문 + 같은 경로 → 성공 (제약은 조합 단위지 경로 단독이 아님)
rollback;
```

검증 포인트: 위반 시 **conname 이 오류에 실려야** 한다. 호출자·픽스처가 원인을 특정하는 근거다.

### 3-2. 멱등 히트 (168)

```
begin;
  -- 1회차: add_individual_question_attachment(Q, P, 'a.png', 'image/png', null)
  --   기대: status='created', idempotent_hit=false, attachment_id=X
  -- 2회차: 완전히 동일한 인자로 재호출
  --   기대: status='existing', idempotent_hit=true, attachment_id=X (1회차와 동일 uuid)
  --   기대: 테이블 행 수 증가 0
  -- 3회차: 같은 (Q,P) + 다른 file_name/mime_type/message_id
  --   기대: status='existing', attachment_id=X, message_id_mismatch=true
  --   기대: 기존 행의 file_name·mime_type·message_id 가 **갱신되지 않음**
  -- 4회차: 경로 앞뒤 공백만 다른 ' P ' 로 호출
  --   기대: btrim 정규화로 status='existing' (신규 행 생성 안 됨)
rollback;
```

가드 회귀 검증(토큰 문자열이 계약이므로 전수 확인):

| 시나리오 | 기대 SQLSTATE | 기대 토큰 |
|----------|---------------|-----------|
| 미인증 호출 | 28000 | `AUTH_REQUIRED` |
| storage_path='' 또는 공백 | 22023 | `INVALID_INPUT: storage_path is required` |
| 비당사자 호출 | 42501 | `NOT_QUESTION_PARTY` |
| 경로 첫 세그먼트 ≠ question_id | 22023 | `STORAGE_PATH_MISMATCH` |
| 타 질문 소속 message_id | 22023 | `MESSAGE_NOT_IN_QUESTION` |

### 3-3. 조건부 삭제 (169)

```
-- storage 객체가 필요하므로 트랜잭션만으로는 완결되지 않는다. 객체 경로를 기록하고
-- 검증 후 명시적으로 정리한다.
  -- 케이스 A: 본인 업로드 + 미등록 객체        → DELETE 성공 기대
  -- 케이스 B: 본인 업로드 + 등록 완료 객체      → DELETE 거부 기대 (등록 첨부 보존)
  -- 케이스 C: 타인 업로드 객체                  → DELETE 거부 기대 (owner_id 불일치)
  -- 케이스 D: 본인 업로드지만 질문 당사자 아님   → DELETE 거부 기대 (party 조건)
  -- 케이스 E: owner_id NULL 인 기존 5객체       → DELETE 거부 기대 (fail-closed, 의도된 동작)
  -- 케이스 F: 앞뒤 공백 포함 경로로 업로드 후 등록
  --   → storage 객체명(원문)과 등록 행 storage_path(btrim 결과)가 **일치하는지** 확인.
  --     불일치면 앱 findRegistered 가 0건을 보고 보상 삭제로 흐를 수 있다(§5-5).
  --     확인식: storage.objects.name = individual_question_attachments.storage_path
```

**케이스 E 는 현 staging 의 고아 4건이 이 정책으로 정리되지 **않음**을 확인하는 시나리오다.**
정리를 원한다면 별도 결정이 필요하다(§5-3).

---

## 4. preflight 실측 결과 (본 세션 실행 · SELECT 전용)

> 모든 조회는 **집계(COUNT 등)와 카탈로그 메타데이터만** 반환했다.
> 개별 행 값, 사용자 개인정보, storage 경로 원문, signed URL, 토큰은 **일절 출력하지 않았다.**

### 4-0. 대상 테이블 스키마

```sql
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'individual_question_attachments'
ORDER BY ordinal_position;
```

| column | type | nullable | default |
|--------|------|----------|---------|
| id | uuid | NO | `gen_random_uuid()` |
| question_id | uuid | NO | — |
| message_id | uuid | YES | — |
| storage_path | text | NO | — |
| file_name | text | YES | — |
| mime_type | text | YES | — |
| created_at | timestamptz | NO | `now()` |

### 4-1. (question_id, storage_path) 중복 실태

```sql
SELECT
  (SELECT count(*) FROM public.individual_question_attachments)                AS total_rows,
  (SELECT count(*) FROM (
      SELECT question_id, storage_path
      FROM public.individual_question_attachments
      GROUP BY question_id, storage_path
      HAVING count(*) > 1) d)                                                  AS dup_combo_count,
  (SELECT coalesce(sum(c),0) FROM (
      SELECT count(*) AS c
      FROM public.individual_question_attachments
      GROUP BY question_id, storage_path
      HAVING count(*) > 1) d2)                                                 AS rows_in_dup_combos,
  (SELECT count(*) FROM (
      SELECT storage_path
      FROM public.individual_question_attachments
      GROUP BY storage_path
      HAVING count(*) > 1) d3)                                                 AS dup_storage_path_only_count;
```

| total_rows | dup_combo_count | rows_in_dup_combos | dup_storage_path_only_count |
|---|---|---|---|
| **1** | **0** | **0** | **0** |

> **판정: 167 의 UNIQUE 생성은 즉시 가능**하다. 중복 정리 전략이 필요 없다.

### 4-2. 손상 행 실태

```sql
SELECT
  count(*)                                                                          AS total_rows,
  count(*) FILTER (WHERE question_id IS NULL)                                       AS null_question_id,
  count(*) FILTER (WHERE storage_path IS NULL)                                      AS null_storage_path,
  count(*) FILTER (WHERE btrim(coalesce(storage_path,'')) = '')                     AS blank_storage_path,
  count(*) FILTER (WHERE storage_path IS NOT NULL AND storage_path <> btrim(storage_path)) AS untrimmed_storage_path,
  count(*) FILTER (WHERE message_id IS NULL)                                        AS null_message_id,
  count(*) FILTER (WHERE file_name IS NULL OR btrim(file_name) = '')                AS missing_file_name,
  count(*) FILTER (WHERE mime_type IS NULL OR btrim(mime_type) = '')                AS missing_mime_type,
  count(*) FILTER (WHERE q.id IS NULL)                                              AS orphan_question_fk
FROM public.individual_question_attachments a
LEFT JOIN public.individual_questions q ON q.id = a.question_id;
```

| 항목 | 값 |
|------|-----|
| total_rows | 1 |
| null_question_id | **0** |
| null_storage_path | **0** |
| blank_storage_path | **0** |
| untrimmed_storage_path | **0** |
| null_message_id | 1 *(nullable 컬럼 — 손상 아님)* |
| missing_file_name | 0 |
| missing_mime_type | 0 |
| orphan_question_fk | **0** |

> `question_id` 는 `NOT NULL uuid` 이므로 NULL·빈 문자열이 **스키마상 불가능**하다.
> v19·v20 클라이언트가 AMBIGUOUS 로 방어하는 대상은 서버 실태 기준 **0건**이다.
> 클라이언트 방어는 유지하되(무해), 서버 오염 정리 작업은 불필요하다.

### 4-3. 등록 RPC 현황

```sql
SELECT
  p.oid::regprocedure::text                                   AS signature,
  pg_get_function_identity_arguments(p.oid)                   AS identity_args,
  pg_get_function_result(p.oid)                               AS result_type,
  p.prosecdef                                                 AS security_definer,
  p.provolatile                                               AS volatility,
  p.proacl::text                                              AS proacl,
  has_function_privilege('anon',          p.oid, 'EXECUTE')   AS exec_anon,
  has_function_privilege('authenticated', p.oid, 'EXECUTE')   AS exec_authenticated,
  has_function_privilege('service_role',  p.oid, 'EXECUTE')   AS exec_service_role,
  pg_get_functiondef(p.oid)                                   AS definition
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE p.proname = 'add_individual_question_attachment'
ORDER BY 1;
```

| 항목 | 실측값 |
|------|--------|
| signature | `add_individual_question_attachment(uuid,text,text,text,uuid)` |
| identity_args | `p_question_id uuid, p_storage_path text, p_file_name text, p_mime_type text, p_message_id uuid` |
| result_type | **uuid** |
| security_definer | true (`SET search_path TO 'public'`) |
| volatility | `v` (volatile) |
| proacl | `{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}` |
| exec_anon | **false** |
| exec_authenticated | **true** |
| exec_service_role | **true** |

정의 본문 요지(전문 대조 완료): **가드 5종** —
`AUTH_REQUIRED`(28000) → `INVALID_INPUT: storage_path is required`(22023) →
`NOT_QUESTION_PARTY`(42501) → `STORAGE_PATH_MISMATCH`(22023) → `MESSAGE_NOT_IN_QUESTION`(22023)
— 이후 **ON CONFLICT 절 없는 plain INSERT** 후 `returning id into v_id; return v_id;`.

가드 개수 실측(초판의 "4종" 표기를 5종으로 통일):

```sql
SELECT (length(pg_get_functiondef(p.oid))
        - length(replace(pg_get_functiondef(p.oid), 'raise exception', '')))
       / length('raise exception') AS raise_sites
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname='public' AND p.proname='add_individual_question_attachment';
```

→ `raise_sites = 5`. 168 은 이 5종의 조건·메시지 토큰·SQLSTATE 를 전부 보존한다.

> **재확인 결과: 기존 실측 기준(plain INSERT · 멱등 인자 없음)과 일치.**
> 부수 확인 — 저장 시 `btrim` 이 적용되지 않는다(빈 문자열 검사에만 사용). 168 에서 보완.

### 4-4. 제약·인덱스 현황

```sql
-- (a) constraints
SELECT conname, contype, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = 'public.individual_question_attachments'::regclass
ORDER BY contype, conname;

-- (b) indexes  ※ UNIQUE 가 constraint 없이 index 로만 존재할 수 있어 양쪽을 모두 조회
SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public' AND tablename = 'individual_question_attachments'
ORDER BY indexname;
```

**constraints (3건)**

| conname | contype | definition |
|---------|---------|------------|
| `individual_question_attachments_pkey` | p | `PRIMARY KEY (id)` |
| `individual_question_attachments_question_id_fkey` | f | `FOREIGN KEY (question_id) REFERENCES individual_questions(id) ON DELETE CASCADE` |
| `individual_question_attachments_message_id_fkey` | f | `FOREIGN KEY (message_id) REFERENCES individual_question_messages(id) ON DELETE SET NULL` |

**indexes (3건)**

| indexname | indexdef |
|-----------|----------|
| `individual_question_attachments_pkey` | `CREATE UNIQUE INDEX ... USING btree (id)` |
| `idx_iqa_question_created` | `CREATE INDEX ... USING btree (question_id, created_at DESC)` |
| `idx_iqa_message` | `CREATE INDEX ... USING btree (message_id)` |

> **판정: (question_id, storage_path) 를 커버하는 UNIQUE 는 constraint·index 어느 형태로도 없다.**

### 4-5. Storage 정책 현황

```sql
-- (a) 버킷 설정
SELECT id, name, public, file_size_limit, allowed_mime_types
FROM storage.buckets WHERE id = 'individual-question-attachments';

-- (b) 이 버킷 관련 정책
SELECT policyname, cmd, permissive, roles::text AS roles, qual, with_check
FROM pg_policies
WHERE schemaname = 'storage' AND tablename = 'objects'
  AND (coalesce(qual,'') LIKE '%individual-question-attachments%'
       OR coalesce(with_check,'') LIKE '%individual-question-attachments%'
       OR policyname LIKE 'iqa%')
ORDER BY cmd, policyname;

-- (c) storage.objects 전체 DELETE/ALL 정책 (버킷 무관 정책의 누출 여부 확인)
SELECT policyname, cmd, roles::text AS roles, qual
FROM pg_policies
WHERE schemaname = 'storage' AND tablename = 'objects' AND cmd IN ('DELETE','ALL')
ORDER BY policyname;
```

**(a) 버킷**: `public=false` · `file_size_limit=20971520` (20MB) ·
`allowed_mime_types` 9종 (png/jpeg/webp/gif, pdf, zip, docx, pptx, json) — **private·20MB 재확인 완료**

**(b) 이 버킷 정책 3건 — DELETE 0건**

| policyname | cmd | roles | 조건 |
|------------|-----|-------|------|
| `iqa_storage_read_party` | SELECT | authenticated | `bucket_id='individual-question-attachments' AND user_is_party_for_individual_question_storage_path(name)` |
| `iqa_storage_insert_party` | INSERT | authenticated | with_check 동일 식 |
| `iqa_storage_update_party_annotations` | UPDATE | authenticated | 위 식 + `split_part(name,'/',2)='annotations'` |

> **명명 구분 (2026-07-25 판정 후 재실측·정정):**
> `iqa_select_party` 는 **실재하는 정책명이다.** 다만 storage 정책이 아니라 **테이블 RLS 정책**이다.
> 초판 보고에서 "실명이 아니다"라고 쓴 것은 과잉 정정이었다 — 아래가 실측이다.
>
> ```sql
> SELECT schemaname, tablename, policyname, cmd, roles::text, qual, with_check
> FROM pg_policies
> WHERE schemaname='public' AND tablename='individual_question_attachments';
> ```
>
> | schemaname | tablename | policyname | cmd | roles | qual |
> |---|---|---|---|---|---|
> | public | individual_question_attachments | **`iqa_select_party`** | SELECT | {authenticated} | `user_is_individual_question_party(question_id)` |
>
> (이 테이블의 **유일한** 정책이다. 앱의 findRegistered = 당사자 SELECT 가 의존하는 것이 바로 이것이며,
>  앱 코드 주석도 이 이름을 참조한다.)
>
> storage 쪽 SELECT 정책명은 이와 **별개로** `iqa_storage_read_party` 다.
> 169 초안은 storage 쪽 실명 규약(`iqa_storage_*`)을 따라 `iqa_storage_delete_unregistered_owner`
> 로 명명했고, 테이블 RLS 정책 `iqa_select_party` 는 **일절 건드리지 않는다**.

**(c) storage.objects 전체 DELETE 정책 6건 — 이 버킷 커버 0건**

`cpi_auth_delete_own`(community-post-images) ·
`custom_order_message_attachments_storage_delete_uploader_or_adm` ·
`pa_auth_delete_own`(profile-avatars) ·
`qra_storage_delete_unregistered_owner`(question-room-attachments) ·
`sfv_mentor_delete_own`(shortform-videos/thumbnails) ·
`student_id_images_delete_own`

> **DELETE 정책 0건 재확인 완료.** 버킷 무관 정책의 누출도 없다.

참조 헬퍼 정의(169 설계 근거):

```sql
SELECT p.oid::regprocedure::text, p.prosecdef, pg_get_function_result(p.oid), pg_get_functiondef(p.oid)
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname='public'
  AND p.proname IN ('user_is_party_for_individual_question_storage_path',
                    'user_is_individual_question_party');
```

- `user_is_party_for_individual_question_storage_path(text)` → boolean, STABLE SECURITY DEFINER.
  경로 첫 세그먼트를 uuid 로 파싱해 `user_is_individual_question_party` 에 위임.
- `user_is_individual_question_party(uuid)` → boolean, STABLE SECURITY DEFINER.
  `student_id` / `designated_mentor_id` / `claimed_mentor_id` / admin 중 하나면 true.
- `individual_question_uuid_from_storage_path(text)` → uuid, IMMUTABLE, 파싱 실패 시 null 반환.

### 4-6. 고아 객체 실태

```sql
SELECT
  (SELECT count(*) FROM storage.objects o
     WHERE o.bucket_id = 'individual-question-attachments')                    AS bucket_objects_total,
  (SELECT count(*) FROM storage.objects o
     WHERE o.bucket_id = 'individual-question-attachments'
       AND NOT EXISTS (SELECT 1 FROM public.individual_question_attachments a
                       WHERE a.storage_path = o.name))                         AS orphan_objects,
  (SELECT count(*) FROM public.individual_question_attachments a
     WHERE NOT EXISTS (SELECT 1 FROM storage.objects o
                       WHERE o.bucket_id = 'individual-question-attachments'
                         AND o.name = a.storage_path))                         AS rows_without_object,
  (SELECT count(*) FROM storage.objects o
     WHERE o.bucket_id = 'individual-question-attachments' AND o.owner IS NULL) AS objects_null_owner;
```

| bucket_objects_total | orphan_objects | rows_without_object | objects_null_owner |
|---|---|---|---|
| 5 | **4** | 0 | **5** |

**소유자 컬럼 viability 추가 조회**

```sql
SELECT
  count(*)                                                  AS objects_total,
  count(*) FILTER (WHERE owner IS NULL)                     AS null_owner,
  count(*) FILTER (WHERE owner_id IS NULL)                  AS null_owner_id,
  count(*) FILTER (WHERE btrim(coalesce(owner_id,'')) = '') AS blank_owner_id,
  count(DISTINCT split_part(name, '/', 1))                  AS distinct_first_segment,
  count(*) FILTER (WHERE split_part(name,'/',2) = 'annotations') AS annotation_objects
FROM storage.objects WHERE bucket_id = 'individual-question-attachments';
```

| objects_total | null_owner | null_owner_id | blank_owner_id | distinct_first_segment | annotation_objects |
|---|---|---|---|---|---|
| 5 | 5 | 5 | 5 | 5 | 0 |

**버킷 간 대조 — NULL owner 가 systemic 인지 판정**

```sql
SELECT bucket_id, count(*) AS objects,
       count(*) FILTER (WHERE owner_id IS NULL OR btrim(owner_id) = '') AS null_or_blank_owner_id,
       count(*) FILTER (WHERE owner IS NULL) AS null_owner
FROM storage.objects GROUP BY bucket_id ORDER BY bucket_id;
```

| bucket_id | objects | null_or_blank_owner_id | null_owner |
|-----------|---------|------------------------|------------|
| community-post-images | 64 | 0 | 0 |
| custom-order-deliverables | 2 | 0 | 0 |
| custom-request-application-attachments | 2 | 0 | 0 |
| custom-request-post-attachments | 2 | 0 | 0 |
| **individual-question-attachments** | **5** | **5** | **5** |
| profile-avatars | 1 | 0 | 0 |
| question-room-attachments | 7 | 0 | 0 |
| student-id-images | 1 | 0 | 0 |

> **판정:** `individual-question-attachments` 는 8개 버킷 중 **유일하게** owner_id 가 전부 비어 있다.
> 다른 7개 버킷(총 79객체)은 NULL 0건 — 클라이언트 업로드 경로에서 owner_id 는 정상 기록된다.
> 따라서 이 NULL 은 systemic 결함이 아니라 **fixture/service_role 시드 흔적**으로 판단한다.
> → 169 의 `owner_id = auth.uid()::text` 조건은 **향후 정상 업로드에 대해 유효**하다.
> → 다만 **기존 5객체(고아 4건 포함)는 이 정책으로 삭제되지 않는다**(fail-closed). §5-3 참조.

---

## 5. 미해결 · 오너/판정자 결정 필요 사항

> 아래 3건은 **자동 수정 금지 규율**에 따라 본 세션에서 손대지 않았다. 결정 전까지 열려 있다.

### 5-1. 중복 행 — 해당 없음 (결정 불필요)

(question_id, storage_path) 중복 0건이므로 167 은 정리 없이 적용 가능하다.
*만약* W3 적용 시점 재조회에서 중복이 발견되면 167 이 `ABORT_167` 로 중단되며, 그때의 선택지는:

- **옵션 A** — 최신 1행 유지, 나머지 삭제 후 UNIQUE 생성 (데이터 손실 있음)
- **옵션 B** — UNIQUE 를 partial index 로 우회 (168 arbiter 로는 부적합 → 168 재설계 필요)
- **옵션 C** — 적용 보류, 중복 유입 원인부터 규명

권장은 A 이지만 **삭제를 수반하므로 오너 승인 없이 실행 금지**.

### 5-2. 손상 행 — 해당 없음 (결정 불필요)

`question_id` NULL·빈 문자열·FK 고아 모두 0건. 스키마상 NULL 이 불가능한 컬럼이다.
v19·v20 의 클라이언트측 AMBIGUOUS 방어는 서버 실태와 무관하게 무해하므로 **존치 권장**.

### 5-3. 고아 storage 객체 4건 — **결정 필요**

버킷 객체 5건 중 4건이 등록 행 없는 고아이며, 5건 전부 owner_id 가 비어 있다.

- 169 정책은 이들을 **삭제하지 못한다**(owner_id 조건 fail-closed). 이는 의도된 안전 동작이다.
- 정리를 원한다면 선택지:
  - **옵션 A** — 그대로 둔다. 5건·소량이고 private 버킷이라 노출 위험 없음. **(권장)**
  - **옵션 B** — service_role 로 1회성 정리. 정리 대상 경로를 오너가 사전 확인해야 하며,
    fixture 시드일 가능성이 높아 다른 검증 자산을 깨뜨릴 수 있다.
  - **옵션 C** — 169 에서 owner_id 조건을 빼고 party 조건만 남긴다.
    **비권장** — 질문 당사자 누구나 남의 업로드 중간산출물을 지울 수 있게 되어 안전성이 후퇴한다.

### 5-4. 168 의 반환 타입 변경 — **배포 조율 필요(단, 기능 정지는 아님)**

반환이 `uuid` → `jsonb` 로 바뀐다. 구 호출자는 반환값을 uuid 로 직접 읽는다.

> **파급 강도 정정 (2026-07-25 판정 · 앱 저장소 `e95b259` 호출부 코드 대조):**
> 초판은 "서버만 먼저 적용하면 기존 앱의 첨부 등록 경로가 **깨진다**"고 썼으나, 이는 과장이었다.
> 실제 구앱 동작은 다음과 같다.
>
> 1. register 콜백이 RPC 반환을 `id is! String` 으로 검사 → jsonb(Map) 수신 시 `AppError` 를 던진다.
> 2. `AppError` 는 `PostgrestException` 이 아니므로 `isDefiniteRegisterFailure = false`.
> 3. upload core 가 **모호(AMBIGUOUS) 분기 → findRegistered(당사자 SELECT)** 로 수렴한다.
> 4. 서버 INSERT 는 **이미 성공**했으므로 행이 발견되고 → `registered` 반환 = **등록 성공**으로 끝난다.
>    (core 원문 주석: "서버 INSERT 는 성공했었다 — DB 행이 정본")
>
> 즉 168 선행 시 구앱은 기능 정지가 아니라 **매 등록이 모호-수렴 경로로 강등**된다
> (등록당 SELECT 1회 추가, 수렴 SELECT 가 일시 실패하면 AMBIGUOUS UX 노출).
> 중복 생성 0 · 데이터 무손실 — v18/v19 수렴 설계가 정확히 이 시나리오를 흡수한다.

**따라서 배포 요건은 "동시 배포 필수" 가 아니라 "168 적용 후 App-A3 를 근접 후속으로"** 다.
강등 구간(모호-수렴으로 도는 기간)을 짧게 유지하는 것이 목표이며, 두 배포를 하나의 창구에
묶어야 할 정도의 경직된 제약은 아니다. W3 의 배포 조율 부담은 그만큼 가볍다.

- 여전히 유효한 점: 둘을 **하나의 계획으로 묶어 관리**해야 한다(순서·관측 지표 공유).
- 대안(비채택) — 새 이름의 함수를 병행 추가하고 구 함수를 남기는 방식.
  호출 경로가 둘로 갈라져 "서로 다른 계약 동시 구현" 금지 규율에 저촉되므로 채택하지 않았다.
- 강등 구간 관측 지표(권장): findRegistered 수렴 경로 진입률. 168 적용 직후 급증 → A3 배포 후 0 수렴.

### 5-5. 경로 정규화 불변식 — **A3 배선 정본에 명시 필요**

168 이 저장 직전 `btrim` 을 도입하므로, 앞뒤 공백이 있는 경로가 유입되면 **storage 객체명(원문)과
등록 행 storage_path(trim)가 갈라진다**. 그 상태에서 앱 findRegistered 가
`.eq('storage_path', 원문)` 으로 조회하면 0건을 보고 **보상 삭제로 흐를 여지**가 있다.

- **현 실위험 0**: 앱 생성 경로는 `{questionId}/{ts}-{salt}.{ext}` 형식이고, preflight 실측
  미trim 행 0건(§4-2). 아래는 회귀 방지용 명문화다.
- **A3 배선 정본에 1줄 명시**: 경로 무공백 불변식(파일명·확장자 sanitize 포함)을 지키거나,
  업로드·조회 경로에 서버와 **동일한 정규화(btrim)** 를 적용할 것.
- **더 강한 권장**: RPC 반환의 `storage_path` 는 서버가 확정한 정규화 결과다.
  앱이 이후 조회·삭제 판정에 자신이 만든 원문 대신 **이 반환값을 정본으로 사용**하면 불일치가
  원천 차단된다.
- W3 fixture 보강: §3-2 4회차(공백 경로 멱등 히트)가 RPC 레벨을 커버하므로,
  여기에 **"객체명 ↔ 행 경로 일치" 확인 한 줄**을 더하면 완결된다(§3-3 케이스 F).

---

## 6. 범위 밖으로 남긴 것 (의도적)

- **cash_ledger·Toss·결제 관련 SQL** — 트랙 2가 코드 레벨로 진행 중. 본 세션 작성 0건.
- **무료질문 room ensure · 리뷰 자격 RPC · 과목 제한 SQL** — 후속 웨이브 W3 소관. 작성 0건.
- **기존 SQL 001~166 및 웹 앱 코드** — 무수정. 본 세션이 만든 파일은 167·168·169와 이 문서뿐이다.
- **139 스타일의 storage 객체 존재·owner 대조를 168 에 추가** — 현 버킷의 owner_id 전량 NULL
  실태에서 정상 경로까지 막으므로 의도적으로 넣지 않았다(169 에서 별도로 다룸).
