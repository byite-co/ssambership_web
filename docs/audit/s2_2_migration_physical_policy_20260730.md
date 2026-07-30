# S2 신규 migration 물리 정책 정본 (s2_2_migration_physical_policy_20260730.md)

> **오너 결정일: `2026-07-30`.** S2-2 착수 전 프리플라이트(읽기 전용)가 보고한 blocker 2건
> (`MIGRATION_VERSION_LEDGER_POLICY_UNRESOLVED` · `ROLLBACK_STORAGE_POLICY_UNRESOLVED`)을
> 오너 결정으로 해소하고, M0~M17 SQL 구현에 적용할 **물리 경로·불변 식별자·rollback·manifest 편입 정책**을 정본화한다.
> 이 문서는 정책 정본이며, 이 문서를 만든 세션은 SQL·rollback 파일을 생성하지 않았다(Batch A SQL 작성은 별도 세션).
> 요약본: `apply_manifest_prod.md` §9 · 기록 양식: `sql_apply_manifest.md` 「S2 환경별 적용 대조표·rollback 인벤토리」.

## 0. 판정

```text
MIGRATION_VERSION_LEDGER_POLICY_UNRESOLVED: RESOLVED
ROLLBACK_STORAGE_POLICY_UNRESOLVED: RESOLVED
S2_2_MIGRATION_PHYSICAL_POLICY: PASS
READY_FOR_S2_2_BATCH_A: YES
```

`READY_FOR_S2_2_BATCH_A`는 Batch A SQL **작성 착수** 가능을 뜻하며, 운영 DB 적용 승인·제품 배포 승인이 아니다.

## 1. 기준점 (정본 정체성)

| 항목 | 값 |
|---|---|
| repository | `byite-co/ssambership_web` |
| base branch | `claude/s2-2-manifest-canon-20260730-te2s4b` |
| base commit | `ebcacedce76d97c94ec895841831d0e5b876c637` |
| 웹 계약 (본 정책 정본화 시점 스냅샷 — 역사 기록) | `docs/contracts/api_web_v1_contract_v1_1.md` — 2,951행 / 317,396B / SHA-256 `0c444434bf9ca4e275a21f656a9f98dae2808b6c1c7fbc832a01de59b6d5ae94` |
| 웹 계약 (**현행 정본** — M13 정합 보정 2026-07-30, §9.2) | `docs/contracts/api_web_v1_contract_v1_1.md` — **2,994행 / 329,690B / SHA-256 `bd9fc0dd2802c8358bb09f2938e0de7248d8b60703794895708e300f8ef32fa6`** — 이 SHA가 앱 계약 재동기화(계약 §19.5) 인수인계 기준값이다 |
| 운영 manifest (본 정책 반영 직전 스냅샷) | `docs/audit/apply_manifest_prod.md` — 193행 / 25,926B / SHA-256 `a4cba0a124f422542e2605cf1209806ddcdc729bfa0f5a798d9ba11229daf62f` |
| 상세 manifest (본 정책 반영 직전 스냅샷) | `docs/audit/sql_apply_manifest.md` — 241행 / 67,008B / SHA-256 `0c65d7109bb07d9509ad3a747aa2c2d3802af734ddf02fcc962e7cca01bf57a9` |

- 두 manifest는 본 정책을 반영하는 커밋에서 S2 절이 추가되므로, 위 SHA는 **반영 직전(base commit) 스냅샷**이다. "계약서는 본 커밋에서 무변경이며 위 SHA가 계속 유효하다(앱 계약 재동기화 불발생)"는 **정책 정본화 시점(2026-07-30 초기)의 역사 기록**이다 — 이후 **M13 정합 보정(오너 승인 2026-07-30, §9.2)으로 계약서가 수정**되어 현행 정본 SHA는 위 표의 `bd9fc0dd…`이며, **앱 계약 재동기화가 필요한 상태**다(`APP_CONTRACT_RESYNC_REQUIRED: YES`).
- 프리플라이트 실측 근거(2026-07-30): ① Supabase MCP `apply_migration` 입력은 `project_id`·`name`·`query` 3종뿐 — **version 지정 입력 없음**(도구 스키마 + MCP 서버 소스 `api-platform.ts`의 body `{name, query}` 실측). ② 원장 `version`은 서버가 적용 시점에 채번(staging 선례 `20260704135803 / 115_account_deletion`). ③ Supabase CLI 2.110.0 — `supabase migration new`는 `supabase/migrations/<timestamp>_<name>.sql`만 생성. ④ 저장소에 `supabase/migrations/`·`supabase/rollback/` 부재, rollback 파일 관행 0건.

## 2. P-2 — stable migration identity 1:1 (오너 결정: 수정 가안 채택)

### 2.1 구 규칙 폐기

구 문구 「저장소 파일 version = `apply_migration` version = `supabase_migrations` 원장 version」(숫자 version 3자 동일성)은 **폐기한다**. 이유:

1. `apply_migration`은 `name`·`query`만 받고 version을 지정할 수 없다.
2. 원장 version은 서버가 적용 시점에 생성한다.
3. staging과 production의 실제 적용 시점이 다르므로, 하나의 파일 timestamp가 두 환경 원장 version과 동시에 일치할 수 없다.
4. 적용 후 파일 개명·migration repair·원장 PATCH는 금지 정책과 충돌한다.

이 교체는 **동일성 요구의 완화가 아니라**, 현행 `apply_migration` 인터페이스에서 **실제 검증 가능한 불변 식별자**로의 교체다.

### 2.2 새 정본 규칙 — 불변 식별자 3종

S2 신규 migration의 불변 식별자는 다음 3종이다.

```text
1. repository file basename
2. ledger name
3. repository file SHA-256
```

구체 규칙:

```text
forward file:
supabase/sql/<FILE_TS>_<STEM>.sql

apply_migration name:
<FILE_TS>_<STEM>

rollback file:
supabase/rollback/<FORWARD_FILE_TS>_<STEM>_rollback.sql

rollback apply_migration name:
<FORWARD_FILE_TS>_<STEM>_rollback
```

- ledger `version`은 **환경별 서버 자동 채번값으로 수용**한다.
- ledger `name`은 파일 basename에서 `.sql`만 제거한 값과 **정확히 같아야** 한다.
- 동일 환경에서 하나의 ledger name은 **정확히 한 행**에만 대응해야 한다.
- staging과 production의 ledger version이 달라도 **정상**이다.
- 파일 SHA-256은 환경별 적용 대조표에 기록한다.
- 적용 직전 동일 ledger name 존재 여부를 확인한다. 동일 name이 이미 존재하면 **자동 재적용하지 않고 중단**한다.
- 파일명과 SHA-256은 최초 커밋 이후 **불변**이다. 적용 후 파일 개명 금지.
- migration repair·원장 PATCH·수동 원장 행 삽입·삭제 금지.
- 운영 DB 임의 `execute_sql` DDL 금지.

## 3. 환경별 ledger mapping 규칙

적용 실적은 `sql_apply_manifest.md`의 「S2 환경별 적용 대조표」에 환경(staging·production)별 1행으로 기록한다. 필수 열:

```text
logical_id
file_path
file_basename
sha256
environment
ledger_version
ledger_name
applied_at
verification_result
```

- `ledger_version`은 적용 직후 원장 조회값(예: `list_migrations`)을 그대로 옮긴다 — 예측·선기입 금지.
- 파일이 실제로 생성·적용되기 전에는 timestamp·SHA-256·ledger version을 기입하지 않는다(invent 금지) — `미생성`/`미적용`으로 둔다.

## 4. drift 재활성 조건 (`MIGRATION_HISTORY_DRIFT`)

다음 중 하나라도 발생하면 `MIGRATION_HISTORY_DRIFT`를 즉시 재활성한다.

1. 동일 환경에서 같은 ledger name이 2행 이상 존재
2. 하나의 파일이 같은 환경의 복수 ledger name에 대응
3. ledger name과 파일 basename 불일치
4. 적용 기록 SHA-256과 저장소 SHA-256 불일치
5. 적용 후 파일명·본문 변경
6. migration repair·원장 PATCH·수동 원장 조작
7. 운영 DB에 S2 DDL을 `execute_sql`로 직접 적용
8. 적용했으나 환경별 mapping 기록이 없음

## 5. timestamp 생성·이동 절차 (Batch A부터 적용)

S2 forward migration은 계약(§20.1)대로 UTC timestamp 파일명을 사용한다. **파일명 timestamp를 사람이 임의 입력하지 않는다.**

1. `supabase migration new <stem>`으로 timestamp 파일명을 생성한다.
2. 생성된 파일을 즉시 `supabase/sql/`로 이동한다.
3. `supabase/migrations/`에 동일 파일이나 복사본을 남기지 않는다.
4. 이동 후 `supabase/migrations/`가 비었는지 확인한다.
5. 한 migration씩 순차 생성해 timestamp 중복을 방지한다.
6. 파일을 이동한 뒤부터 basename을 불변으로 취급한다.

- `supabase/migrations/`와 `supabase/sql/`에 같은 SQL을 **이중 보존하는 것은 금지**한다.
- 정본 경로는 계속 `supabase/sql/`이며, **CLI는 timestamp 생성에만 사용**한다.
- clean-install·로컬 검증은 기존 manifest 기반 175개 적용 후 S2 forward를 순서대로 추가하는 방식이다(`supabase db reset`의 migrations 자동 적용 경로를 쓰지 않는다).
- 생성 순서는 §9 물리 계획표의 「권고 생성 순서」(= §20.2.1 위상 정렬)를 따른다 — timestamp의 사전순이 적용 순서와 일치하게 유지한다.
- (참고) 본 문서 작성 세션에서는 `supabase migration new`를 실행하지 않았다 — 절차 기록만이다.

## 6. P-3 — rollback 정본 경로 (오너 결정: A안 채택)

rollback 정본 경로를 다음으로 확정한다.

```text
supabase/rollback/
```

해석·규칙:

- SQL 정본의 소유 저장소는 계속 `ssambership_web`이다.
- 계약 §19.5 #9의 `supabase/sql` 경로는 **M17 forward SQL 정본 경로**다(rollback 경로 규정이 아니다).
- rollback은 forward clean-install과 **구조적으로 분리**하기 위해 `supabase/rollback/`에 둔다.
- `supabase/sql/*.sql` 또는 미래 재귀 glob에 rollback이 포함되지 않아야 한다.
- rollback 파일은 정규 clean-install 파일 수에 포함하지 않는다.
- rollback은 장애 시 **오너 승인 후 파일 하나를 명시적으로 골라** `apply_migration`으로 실행한다.
- rollback도 원장에 **새 행으로 append**한다. forward 원장 행을 삭제·수정·reverted 처리하지 않는다.
- 원시 Management API의 선택적 `rollback` 필드는 사용하지 않는다.
- M10은 상태 0 checkpoint이므로 rollback 파일을 만들지 않는다.
- rollback 실행 순서·역의존의 정본은 계약 §22(§20.2.1 역방향)이며, rollback 완료 후 M10 상당의 읽기 전용 assertion을 재실행한다(§22 #2).
- rollback 실행의 ledger name은 `<FORWARD_FILE_TS>_<STEM>_rollback`(§2.2) — 적용 직전 동일 name 존재 확인·중단 규칙은 forward와 동일하게 적용한다.

## 7. rollback 인벤토리 형식

rollback 파일 실체는 `sql_apply_manifest.md`의 「S2 rollback 인벤토리」에 기록한다. 필수 열:

```text
logical_id
forward_file
rollback_file
forward_sha256
rollback_sha256
rollback_preconditions
rollback_order
verification_assertion
```

## 8. manifest 편입 정책·최종 산식

기존 정본은 유지한다.

```text
기존 baseline: 175개
기존 제외: 15개
S2 forward: 16개
S2 rollback: 15개 — clean-install 불포함
최종 정규 forward 적용 파일: 175 + 16 = 191개
```

- Batch별 로컬 PG17 검증 PASS 후 해당 forward만 manifest에 편입한다.
- rollback은 별도 인벤토리에만 기록한다.
- D-API-W·D-API-A·C1~C11은 SQL 파일 수에 포함하지 않는다.
- M10은 forward 16개에 포함하고 rollback 15개에는 포함하지 않는다.
- 기존 175개 순서·제외 15개·후보 C 판정은 변경하지 않는다.

## 9. M0~M17 물리 계획표

> **M0~M17은 논리 ID이며 물리 timestamp가 아니다.** `<TSn>` = 권고 생성 순서 n번째에 §5 절차로 채번되는 UTC `YYYYMMDDHHMMSS`. **Batch A(M0·M15)는 2026-07-30(KST) 세션에서 §5 절차로 실채번·구현·로컬 검증 완료됐다(§9.1 역기입 — 상태 `LOCAL_PASS`, 원격 미적용).** **Batch B(M1·M13·M4)도 2026-07-30(KST) 세션에서 §5 절차로 실채번·구현·로컬 검증 완료됐다(§9.3 역기입 — 상태 `LOCAL_PASS`, 원격 미적용).** 나머지 미생성 S2 forward는 **M5~M12·M14·M16·M17, 총 11개**이며 timestamp·SHA-256·ledger version은 현재 **미생성**이다(invent 금지). M2·M3는 retired 슬롯 — 파일을 만들지 않는다. D-API-W·D-API-A·C1~C11은 SQL 파일이 아니다.

| 논리 ID | 계약 filename stem | 직접 선행조건 | 권고 생성 순서 | forward 물리 경로 형식 | rollback 경로 형식 | rollback 여부 | 구현 batch |
|---|---|---|---:|---|---|---|---|
| M0 | mentor_profile_privileged_column_guard | 없음 | 1 | `supabase/sql/20260729211929_mentor_profile_privileged_column_guard.sql` (**실채번 TS1=20260729211929** — §9.1) | `supabase/rollback/20260729211929_mentor_profile_privileged_column_guard_rollback.sql` | 있음 | A |
| M15 | weekly_usage_pair_party_guard | 없음 | 2 | `supabase/sql/20260729211941_weekly_usage_pair_party_guard.sql` (**실채번 TS2=20260729211941** — §9.1) | `supabase/rollback/20260729211941_weekly_usage_pair_party_guard_rollback.sql` | 있음 | A |
| M1 | api_web_v1_schemas | M0 | 3 | `supabase/sql/20260730090043_api_web_v1_schemas.sql` (**실채번 TS3=20260730090043** — §9.3) | `supabase/rollback/20260730090043_api_web_v1_schemas_rollback.sql` | 있음 | B |
| M13 | comments_author_label_denormalize (**정본 재정의 — §9.2**) | M0 | 4 | `supabase/sql/20260730090046_comments_author_label_denormalize.sql` (**실채번 TS4=20260730090046** — §9.3) | `supabase/rollback/20260730090046_comments_author_label_denormalize_rollback.sql` | 있음(단, `author_label` 컬럼·정규화 라벨 보존 — forward-only 예외 §9.2) | B |
| M4 | api_web_v1_read_views | M1+M13 | 5 | `supabase/sql/20260730090049_api_web_v1_read_views.sql` (**실채번 TS5=20260730090049** — §9.3) | `supabase/rollback/20260730090049_api_web_v1_read_views_rollback.sql` | 있음 | B |
| M5 | core_private_room_ensure | M1 | 6 | `supabase/sql/<TS6>_core_private_room_ensure.sql` | `supabase/rollback/<TS6>_core_private_room_ensure_rollback.sql` | 있음 | C |
| M6 | api_web_v1_self_rpc | M5 | 7 | `supabase/sql/<TS7>_api_web_v1_self_rpc.sql` | `supabase/rollback/<TS7>_api_web_v1_self_rpc_rollback.sql` | 있음 | C |
| M7 | api_web_v1_community_rpc | M1 | 8 | `supabase/sql/<TS8>_api_web_v1_community_rpc.sql` | `supabase/rollback/<TS8>_api_web_v1_community_rpc_rollback.sql` | 있음 | C |
| M17 | api_app_v1_surface | M5+M7 | 9 | `supabase/sql/<TS9>_api_app_v1_surface.sql` | `supabase/rollback/<TS9>_api_app_v1_surface_rollback.sql` (§22 순서: 노출 제거→config 반영→DROP) | 있음 | D |
| M8 | api_web_v1_mentor_rpc | M1 | 10 | `supabase/sql/<TS10>_api_web_v1_mentor_rpc.sql` | `supabase/rollback/<TS10>_api_web_v1_mentor_rpc_rollback.sql` | 있음 | D |
| M14 | api_web_v1_payout_account_rpc | M1 | 11 | `supabase/sql/<TS11>_api_web_v1_payout_account_rpc.sql` | `supabase/rollback/<TS11>_api_web_v1_payout_account_rpc_rollback.sql` | 있음 | D |
| M9 | money_rpc | M5 | 12 | `supabase/sql/<TS12>_money_rpc.sql` | `supabase/rollback/<TS12>_money_rpc_rollback.sql` (레거시 구 본문 복원 포함 — §22 #3) | 있음 | E |
| M11 | revoke_mentor_profiles_write | 전환 게이트(M8+C6 · M14+C11 · 백업 upsert 제거 · 직접 쓰기 0건) | 13 | `supabase/sql/<TS13>_revoke_mentor_profiles_write.sql` | `supabase/rollback/<TS13>_revoke_mentor_profiles_write_rollback.sql` (GRANT 문자 그대로 복원 — §22 #6) | 있음 | F |
| M12 | revoke_mentor_plans_write | 전환 게이트(M8+C6 · 플랜 직접 쓰기 0건) | 14 | `supabase/sql/<TS14>_revoke_mentor_plans_write.sql` | `supabase/rollback/<TS14>_revoke_mentor_plans_write_rollback.sql` (동일 원칙) | 있음 | F |
| M16 | community_direct_write_lockdown | M7+M17+D-API-A+웹·앱 전환+앱 Gate 4+§14.7 7단계 | 15 | `supabase/sql/<TS15>_community_direct_write_lockdown.sql` | `supabase/rollback/<TS15>_community_direct_write_lockdown_rollback.sql` (GRANT+정책 6종 복원) | 있음 | F |
| M10 | contract_permission_assertions | M11+M12+M15+M16+M17 (활성 predecessor 15개 전건) | 16 | `supabase/sql/<TS16>_contract_permission_assertions.sql` | 해당 없음 | 없음 (상태 0 checkpoint) | F |

### 9.1 Batch A 실체 역기입 (2026-07-30 KST — `LOCAL_PASS`)

Batch A(M0·M15)는 §5 절차대로 `supabase migration new`로 timestamp를 실채번(사람 임의 입력 0)한 뒤
`supabase/sql/`로 이동해 구현했고(`supabase/migrations/` 잔존 0), 격리 로컬 스택
(Supabase CLI 2.110.0 / PostgreSQL 17.6, 운영·staging 반입 0)에서 baseline 후보 C 175개
적용(175/175) 후 forward 2건을 순차 적용해 **177/177 PASS**, 반복 검증기
(`scripts/verify/s2_2_batch_a_verify.sql`) **38/38 PASS**, rollback(M15→M0) 후
**forward 전 카탈로그 기준선 완전 복원**(mentor_profiles 트리거 집합·weekly 함수
functiondef md5 `d0d31620671c6f9707a7b9d324d1ed35`·prosrc SHA-256
`b5c39e0a47328fecedc848f35cf0493dee524778879cedccbf9af15fef90b2d8`·ACL 동일), 재적용 후
재검증 **38/38 PASS**를 확인했다. 상태 = **`LOCAL_PASS`** — staging·production 원장에는
**미적용**이며 ledger version/name 기록은 원격 적용 시점에만 한다(§3).

| 논리 ID | timestamp | forward 파일 | forward SHA-256 | rollback 파일 | rollback SHA-256 | 상태 |
|---|---|---|---|---|---|---|
| M0 | `20260729211929` | `supabase/sql/20260729211929_mentor_profile_privileged_column_guard.sql` | `3bb2edd97b921900f93d460f206add873c80b6cbcf1782844b6c5e835184d94c` | `supabase/rollback/20260729211929_mentor_profile_privileged_column_guard_rollback.sql` | `a6fbea2a93360eebfaea61f8e4d1c27d2beac7e32d50fe2a36ba9184d887d35e` | `LOCAL_PASS` |
| M15 | `20260729211941` | `supabase/sql/20260729211941_weekly_usage_pair_party_guard.sql` | `aabd465b12818d5d17c2326b05331ba42de59ed835a1203f58ca2facb1a4827e` | `supabase/rollback/20260729211941_weekly_usage_pair_party_guard_rollback.sql` | `42f5266d270b71b4caa6730e505665423342d0a2588199330781d4d3e0eb6363` | `LOCAL_PASS` |

- timestamp 는 UTC `YYYYMMDDHHMMSS`(2026-07-29T21:19Z대 = KST 2026-07-30 06:19대 채번). `TS1(M0) < TS2(M15)` 충족.
- 미생성 잔여 S2 forward는 **M5~M12·M14·M16·M17, 총 11개**다(invent 금지 — 위 §9 계획표의 `<TSn>` 형식 유지). M0·M15는 Batch A, M1·M13·M4는 Batch B(§9.3)에서 생성·`LOCAL_PASS` 완료됐고 M2·M3는 retired다.
- 상세 ledger mapping·rollback 인벤토리 실체는 `sql_apply_manifest.md` 「S2 환경별 적용 대조표·rollback 인벤토리」에 기록.

### 9.2 M13 정본 재정의 역기입 (baseline 정합 보정 — 오너 승인 2026-07-30)

**Batch B 사전 게이트 실패·해소 근거:** Batch B 착수 세션의 read-only 실측(후보 C 175 + Batch A M0·M15 적용 후 PG17.6)에서
`public.comments.author_label`이 **037 기원 선재 컬럼**(`text NOT NULL DEFAULT '쌤버십 회원'`)으로 확인되어
`BATCH_B_BASELINE_OBJECT_MISMATCH`로 중단(수정 0건 보고)됐고, 오너가 권고안을 승인해 웹 계약을 보정했다
(`BATCH_B_BASELINE_OBJECT_MISMATCH: RESOLVED_IN_CONTRACT`). M13의 물리 역할은 다음으로 확정된다.

- **선재 재사용:** `comments.author_label`(037)·`community_comments.author_label`(016)은 선재 컬럼 — M13은 DROP하지 않고
  `comments.author_label`의 default만 `'쌤버십 사용자'`로 정정한다(NOT NULL 유지).
- **신규 컬럼:** `comments.author_role text NULL` **정확히 1개**(구 "신규 column 2" 집계 폐기).
- **트리거:** 함수 2종(`public.comments_set_author_label()`·`public.community_comments_set_author_label()` — SECDEF·
  `search_path=''`·PUBLIC EXECUTE 회수) + 트리거 4종(canonical INSERT 설정·canonical snapshot UPDATE 보호·
  legacy board INSERT 설정·legacy board snapshot UPDATE 보호). legacy 쪽은 `post_type='board'` 한정 — shortform 무영향.
- **브리지 불변:** 163/164 함수 본문은 교체하지 않는다 — 권위는 DB BEFORE INSERT trigger > 브리지 입력 > 클라이언트 입력 > default.
- **백필:** `comments` 전행 + `community_comments` board 행 1회 정규화(양 테이블 라벨 backfill). shortform·행 수·비대상 컬럼 불변.
- **rollback:** 트리거 4종·함수 2종·`author_role` 제거 + `author_label` default `'쌤버십 회원'` 복원까지만.
  **`author_label` 컬럼은 보존**하고, backfill된 라벨은 **forward-only 보안 정규화**로 유지한다(과거 클라이언트 라벨 미복원 —
  "전 데이터 원복" 요구의 명시적 예외, 계약 §22 #8).
- **계약 정본:** 상세는 웹 계약 §6 V2·§10.4·§20.2 M13·§20.3 게이트·§21.7 T-M13-01~16·부록 C-2. 본 보정으로 웹 계약이 수정되어
  **현행 정본 = 2,994행 / 329,690B / SHA-256 `bd9fc0dd2802c8358bb09f2938e0de7248d8b60703794895708e300f8ef32fa6`**(본 보정 커밋) —
  **앱 계약 재동기화 필요 상태**(`APP_CONTRACT_RESYNC_REQUIRED: YES`, 완료 전 S2-2 Batch B는 BLOCKED 유지).
- Batch A(M0·M15)의 `LOCAL_PASS` 실적·파일 SHA-256(§9.1)은 본 보정과 무관하게 불변이다.

### 9.3 Batch B 실체 역기입 (2026-07-30 KST — `LOCAL_PASS`)

Batch B(M1·M13·M4)는 §5 절차대로 `supabase migration new`로 timestamp를 실채번(사람 임의 입력 0,
채번 순서 M1→M13→M4)한 뒤 `supabase/sql/`로 이동해 구현했고(`supabase/migrations/` 잔존 0),
격리 로컬 스택(Supabase CLI 2.110.0 / **PostgreSQL 17.6** — 컨테이너 레지스트리 egress 차단 환경이라
supabase/postgres:17.6.1.143 이미지 대신 **PG 17.6 소스 빌드 + supabase 동등 role·auth·storage·
default-privilege 부트스트랩** 스크래치 스택으로 재현, 운영·staging 반입 0)에서 다음을 확인했다.

- baseline 후보 C 175개(175/175) + Batch A 2개 = **177/177 PASS** 재현 후, M13 사전 구조 게이트
  (§9.2 — `comments.author_label` 037 선재·`author_role` 부재·163/164 브리지 정본) 전건 실측 일치.
- Batch B forward 3건 순차 적용(M1→M13→M4) = **180/180 PASS**.
- 반복 검증기(`scripts/verify/s2_2_batch_b_verify.sql`, 3-phase): baseline **8/8** ·
  forward **78/78**(M1 경계 / M13 카탈로그·T-M13-02~14 / M4 V1~V5 필드·타입·옵션·필터·GRANT·행동 /
  V3 의도적 SECDEF 예외 / PII 0 / View DML 0 / `core_private` 외부 USAGE 0 / fixture 잔여 0) ·
  rollback **10/10**(T-M13-15·16 포함) — T-M13-01~16 전 16종 커버.
- 백필 fixture(스푸핑 라벨 canonical 2·legacy board 1·shortform 2·브리지 미러 포함) 명시 검증
  **7/7 PASS** + 행 수·shortform 바이트·비대상 컬럼(md5) **불변 확인**(016 `updated_at` 트리거는
  백필 구간만 비활성화, 브리지는 163/164 자체 재귀 방지 GUC 로 억제 — 본문 무수정).
- rollback 왕복(M4→M13→M1) 후 forward 전 기준선과 카탈로그·ACL·트리거·함수·행 수·비대상 데이터
  **완전 일치** — 유일한 차이는 **M13 forward-only 라벨 backfill 유지**(§9.2·계약 §22 #8 승인 예외).
- 동일 파일 2차 forward 재적용(180/180) 후 forward 검증 **78/78 재PASS**, roundtrip fixture 잔여 **0**.
- `supabase db lint`(schema public, level error): **오류 0** (V3 SECDEF 뷰는 `api_web_v1` 소속·계약 승인
  예외로 분류). `git diff --check` 통과. `node scripts/verify/sql_number_integrity.mjs` 통과
  (Batch B 산식 갱신: 총 195 · clean-install 180 · rollback 5).

상태 = **`LOCAL_PASS`** — staging·production 원장에는 **미적용**이며 ledger version/name 기록은
원격 적용 시점에만 한다(§3). **운영 적용·Data API(Exposed schemas) 변경은 미실행**이다(D-API-W 는
Batch B 이후 별도 플랫폼 단계 — 계약 §20.6).

| 논리 ID | timestamp | forward 파일 | forward SHA-256 | rollback 파일 | rollback SHA-256 | 상태 |
|---|---|---|---|---|---|---|
| M1 | `20260730090043` | `supabase/sql/20260730090043_api_web_v1_schemas.sql` | `9587c4a54dc1c851672bd0dca3767953955450684d1fd559007f9b128e6905fb` | `supabase/rollback/20260730090043_api_web_v1_schemas_rollback.sql` | `5dbfb606ac753edabf28ff5176dca23c6b364987e92789340d18ca30a6f13765` | `LOCAL_PASS` |
| M13 | `20260730090046` | `supabase/sql/20260730090046_comments_author_label_denormalize.sql` | `843051b85ba9f475b813fdb050fb45d71b188fce79b9ada5664cd9c38730fd4e` | `supabase/rollback/20260730090046_comments_author_label_denormalize_rollback.sql` | `176dc280d39b406c2df68a648ba9af44b4762bccace4600c54d600d97b4c8838` | `LOCAL_PASS` |
| M4 | `20260730090049` | `supabase/sql/20260730090049_api_web_v1_read_views.sql` | `23dce61aac4a1452f9abcd411105f77b3ec2dc58e56ab3a1e02c92ad0510b167` | `supabase/rollback/20260730090049_api_web_v1_read_views_rollback.sql` | `738af51fa311ad6339ef644cfeb0c274ebde30fc91ef66edbc4e848f83d3689c` | `LOCAL_PASS` |

- timestamp 는 UTC `YYYYMMDDHHMMSS`(2026-07-30T09:00Z대 = KST 2026-07-30 18:00대 채번).
  `TS1(M0) < TS2(M15) < TS3(M1) < TS4(M13) < TS5(M4)` 충족. 적용 순서 M1→M13→M4 · rollback 역순 M4→M13→M1.
- **현재 정규 clean-install: 기존 baseline 175 + Batch A 2 + Batch B 3 = 180** ·
  rollback 인벤토리 5 (최종 목표 191·15 와 혼동 금지). ledger version = **미적용**.
- M1 의 `ALTER DEFAULT PRIVILEGES … REVOKE EXECUTE FROM PUBLIC`(계약 §5.3.3)은 실측상 per-schema
  기본 ACL 이 전역 기본에 additive 만 가능해 카탈로그 항목을 남기지 않는다 — 실효 방어는 계약
  §5.3 주의 1 의 **함수별 명시 REVOKE**(M13 함수 2종에서 이행·검증됨)이며, 검증기는
  "per-schema 기본 ACL 의 PUBLIC 추가 부여 0"을 상시 assertion 한다.
- 상세 ledger mapping·rollback 인벤토리 실체는 `sql_apply_manifest.md` 「S2 환경별 적용 대조표·rollback 인벤토리」에 기록.

## 10. Batch A~F 계획표

| batch | 논리 ID | 선행조건 | 생성 파일 | rollback | 검증 | 다음 batch 진입 조건 | 끼는 비-SQL 단계 |
|---|---|---|---:|---:|---|---|---|
| **A** | M0·M15 | 없음 | 2 | 2 | 로컬 PG17: baseline 175 위 적용 + 트리거 3분기(service_role/JWT無/admin)·INSERT 가드·pair-party 가드 유지 4종 + rollback 적용→forward 재적용 왕복 | replay 177/177 PASS + T-SEC-02·03·14, T-PERM-14 상당 + manifest 편입 | 없음 |
| **B** | M1·M13·M4 | A 완료(M0) | 3 | 3 | 스키마 PUBLIC 권한 0건 실측(§20.3 M4 게이트) + V1~V5 필드 계약(T-CON) + M13 백필 정확성 + catalog assertion(스키마 존재·default privilege) | replay PASS + T-PERM-01·02 상당 | 이후 운영에서 D-API-W → C1 |
| **C** | M5·M6·M7 | B 완료 | 3 | 3 | T-CONC-01(F10 2세션) · T-CON-05~08 · T-CONC-10 canonical(웹 표면 replay-first) + `core_private` 외부 EXECUTE 0 assertion | replay PASS + 동시성 테스트 통과 | C2·C3·C4(M6 후) · C5(M7 후) |
| **D** | M17·M8·M14 | C 완료(M17: M5+M7) | 3 | 3 | §20.3 「M17 이전」 5항(기반 컬럼 전수 대조·부분 객체 부재) + 「M17 적용 직후」 7항(wrapper 5종 identity argument·PUBLIC/anon 0·구현부 복제 0) + F7/F8/F13 계약 | replay PASS + M17 직후 게이트 전건 | 이후 운영에서 D-API-A → 앱 F4/F5/F6·Gate 4 → C6(M8 후)·C11(M14 후) |
| **E** | M9 (단독 — 자금 최고위험 격리) | C 완료(M5) | 1 | 1 | T-TOP 01~06 + T-REP A~H + T-FIN + T-CONC-02·03·04·08·09 + F12 배포 전 사전 검사 설계 | replay PASS + 자금 테스트 전건 | C7·C8(M9 후) |
| **F** | M11·M12·M16·M10 | D·E 완료 + C1~C11 전환 + D-API-A + 앱 Gate 4 + 직접 쓰기·호출 0건 실측(운영 게이트) | 4 | 3 (M10 없음) | M11/M12/M16 회수 후 T-PERM-09·10·15 + M10 assertion을 predecessor 15개 전건 적용된 로컬/브랜치 DB에서 PASS + rollback 대칭 복원 왕복 | M10 PASS = S2 SQL 구간 종결 | C9·C10은 F 이전/병행 |

- M10 구현 시 assertion 본문을 재실행 가능한 별도 검증 스크립트로도 정본화할 것(rollback 후 재검증 §22 #2를 원장 중복 기재 없이 수행하기 위함 — Batch F 설계 조건).
- 첫 구현 세션 범위는 **Batch A(M0+M15) 한정**, 파일 생성 순서는 M0 → M15로 고정한다. M1은 Batch B로 분리한다(신규 스키마·전역 default privilege 변경은 검증 축이 달라 위험·검증 격리 관점에서 분리).

## 11. 금지·불변 사항 요약

- 기존 175개 SQL 수정·재번호 금지. 제외 15개·순서 예외표·후보 C 판정 불변.
- 적용 후 파일 개명·본문 변경 금지(§4 drift).
- migration repair·원장 PATCH·수동 원장 행 삽입·삭제 금지.
- 운영 DB 임의 `execute_sql` DDL 금지 — 배포는 검토된 단일 경로(`apply_migration`)만.
- rollback을 forward clean-install glob·파일 수에 포함하는 해석 금지.
- `supabase/migrations/`·`supabase/sql/` 이중 보존 금지.
- 계약서(`api_web_v1_contract_v1_1.md`)는 **본 정책 문서 자체로는** 수정되지 않았다(역사 기록). 단, **M13 정합 보정(2026-07-30 오너 승인, §9.2)으로 계약서가 수정**되어 현행 정본 SHA는 `bd9fc0dd…`(§1 표)이며 **앱 계약 재동기화가 필요**하다.
