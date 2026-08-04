# 정식 migration pack (native migration pack) — 구현·검증 기록 (2026-08-05)

관련 정본: `docs/audit/remote_db_baseline_reconstruction_20260804.md`
PR: 웹 #61 (baseline 재구성 · pack 소유) / 웹 #60 (IQ guard 1본 소유)

---

## 0. 이 문서가 다루는 것

지금까지 baseline 재구성물은 `supabase/baseline/**` 아래의 **replay 자산**이었다.
`supabase migrate` 계열 도구가 읽는 경로가 아니므로, 어떤 러너도 이것을 직접 적용할 수 없었다.

이번 작업은 그 자산을 **`supabase/migrations/` 정식 경로의 migration pack** 으로 변환한다.
목표는 하나다 — *에이전트 컨테이너에서 원격 접근이 막혀 있어도, GitHub 러너가 표준
Supabase CLI 로 같은 결과를 재현·적용할 수 있게 만든다.*

이 세션에서 **하지 않은 것**: 부모 history repair · 부모 schema write · PR #60 원격 적용 ·
신규 Preview Branch 생성 · PHASE A/B 원격 실행 · PR 병합 · production deploy · signed build.

```text
PARENT_DB_WRITES: 0
PARENT_LEDGER_ROWS: 56 (변화 없음)
PREVIEW_BRANCHES_CREATED: 0
PR_MERGES: 0
```

---

## 1. pack 구성 (63본)

| 종류 | 개수 | 출처 | version |
|---|---|---|---|
| baseline | 1 | `supabase/baseline/apply_order.txt` 114 stage / 188 source part | `20260701000000` |
| ledger replay | 56 | `supabase/baseline/ledger_replay/**` | 부모 원장 version 그대로 |
| interleave | 6 | `supabase/baseline/interleaves/**` | 역사적 순서 위치에 삽입 |

- 첫 version `20260701000000` — 부모 원장 최초 `20260702065122` 보다 과거.
- 마지막 version `20260804100002`.
- PR #60 의 `20260804113000` 은 이 pack 에 **없다.** PR #60 branch 소유이고,
  두 PR 이 병합되면 같은 디렉터리에서 64본이 된다.

### version 배치 제약 (validator 가 강제)

```text
20260701000000  baseline, 첫 자리
20260715000000  interleave — ledger 20260712060717 뒤 / 20260717044250 앞
20260729000000  interleave — 함수 default ACL 하드닝. M13(20260731100540) 보다 반드시 앞
20260802000000  interleave — 테이블 default ACL 하드닝. M13 뒤
20260804100000 / 100001 / 100002  interleave — 마지막 원장 20260804040019 뒤
```

`20260729000000` 이 M13 앞이어야 하는 이유는 §5-2/5-4 (재구성 정본 문서) 에 있다.
이 순서가 깨지면 M13 이 만드는 trigger 함수에 `PUBLIC EXECUTE` 가 남는다.

---

## 2. 생성기 — 손으로 만들지 않는다

| 스크립트 | 산출물 |
|---|---|
| `scripts/verify/baseline/build_native_baseline_migration.py` | `supabase/migrations/20260701000000_pre_ledger_baseline.sql`, `native_baseline_source_map.tsv`, `native_baseline_manifest.json` |
| `scripts/verify/baseline/build_native_migration_pack.py` | 나머지 62본(binary copy) + `native_migration_pack_manifest.tsv` |

설계 원칙:

- **완전 결정론.** binary I/O 전용. 같은 입력 → 같은 바이트.
- **의미 보존.** 재포맷·parser 재작성·정규화·transaction 문 제거를 하지 않는다.
  BOM 만 제거한다(SQL Editor 가 하던 것과 같다).
- source 사이에는 고정 ASCII separator(`-- >>> NATIVE_BASELINE_PART nnnn | path | section <<<`)만 넣는다.
- 산출물을 직접 편집하면 `--check` 가 SHA 불일치로 실패한다.

```text
BASELINE_SOURCE_PARTS: 188   (executable 185 · comment-only 3)
BASELINE_APPLY_STAGES: 114
BASELINE_OUTPUT_BYTES: 1,115,384
BASELINE_OUTPUT_SHA256: ec71936927af655158374768fc4354e438f73f6c96370ac406f72b5909e92ce9
APPLY_ORDER_SHA256: 62de26ba89a600790ea8760e47ca31ba1d131d952c8dfbc7074ea92db9cfc862
GENERATOR_DETERMINISM: PASS (재실행 후 diff 0)
```

### baseline 은 원자적이지 않다 — 헤더에 못 박았다

원본 source 안에 자체 `BEGIN/COMMIT` 쌍이 다수 있다. 이 파일 하나를 트랜잭션으로 감싸도
내부 `COMMIT` 이 바깥 트랜잭션을 끊는다. 그래서 헤더에 다음을 명시한다.

```text
BASELINE_ATOMICITY: NOT_GUARANTEED
BASELINE_FAILURE_RECOVERY: DISCARD_FRESH_DATABASE_AND_RECREATE
BASELINE_SAME_DB_RETRY: PROHIBITED
```

전량 재적용도 안전하지 않다(`run_noop_test.sh` 가 특성화한 하자: 078 이 자기 `REVOKE` 전에
중단되면 mentor 함수 3개의 ACL 이 넓어진다). baseline 은 **신규 DB 전용**이다.

---

## 3. 정적 검증 — `validate_native_migration_pack.py`

`--with-pr60 <dir>` 을 주면 64본 통합 pack 을 검증한다.

검사 항목: 파일 수 · version 형식/오름차순/중복 · 생성기 `--check` · ordering 제약 ·
`adoption_repair_plan.tsv` 7행 대조(ddl=no·schema=no·대응 파일 존재) · manifest checksum ·
금지 내용 · 비원자성 경고 존재.

```text
NATIVE_MIGRATION_PACK_VALIDATION (63본): PASS
NATIVE_MIGRATION_PACK_VALIDATION (64본, --with-pr60): PASS
```

### 금지 내용 패턴을 좁힌 이유 (오탐 1건)

초기 패턴은 부모 project ref 문자열 자체를 금지했다. 그런데 그 문자열은 원본 source 의
**출처 주석**("staging `<ref>` read-only 실조회")에 들어 있고, migration 은 source 와
바이트가 같아야 하므로 주석을 지우는 것은 허용되지 않는다. ref 는 대시보드 URL 에 노출되는
공개 식별자이므로 그 자체가 비밀이 아니다.

→ 실제로 위험한 형태만 차단하도록 좁혔다: endpoint URL(`<ref>.supabase.co|in`) ·
access token(`sbp_…`) · JWT 형태 · 자격증명 포함 연결 문자열 · `SUPABASE_*` 비밀값 대입.
ref 주석 언급 횟수는 정보성으로 보고한다(현재 2개 파일).

---

## 4. 로컬 회귀 (clean PostgreSQL 16 · 원격 비접촉)

`scripts/verify/baseline/run_native_pack_replay.sh` — stub → pack 63본을 version 순으로 적용.

```text
MIGRATIONS_APPLIED: 63/63
OPEN_TRANSACTIONS_AFTER: 0
STRUCTURE: tables=79  functions=213  policies=178  buckets=13
M13 trigger fn: proacl={postgres=X/postgres}  anon=false  auth=false   (2/2)
mentor fn:      anon=false  auth=false  service_role=true              (3/3)
13축 정규화 비교 vs 부모 인벤토리: EQUIVALENT (실질 drift 0)
```

PR #60 왕복(`--pr60`):

```text
baseline 함수 본문 md5: 58f0c2411d40b2ce3bcec23efa0c88a1
forward → FULLSCHEMA FIXTURE PASS
rollback → md5·ACL 정확 복원
reapply → FIXTURE PASS
```

> 이것은 psql 기반 replay 다. **Supabase CLI migration runner 검증이 아니다.**
> 둘을 같은 증거로 취급하지 않는다.

---

## 5. GitHub 러너 실행 경로

에이전트 컨테이너에는 Docker 데몬도, Supabase CLI 도, `*.supabase.co` egress 도 없다.
그래서 "실제 CLI runner 가 이 pack 을 적용하는가" 는 **이 컨테이너에서 검증 불가**다.
그 검증을 러너로 넘긴다.

### 5-1. `.github/workflows/db-migration-pack-verify.yml` (secret 불필요)

| job | 하는 일 |
|---|---|
| `static` | 생성기 재실행 후 `git diff --quiet`(비결정론/직접편집 탐지) · pack validator · replay manifest validator · workflow validator(+selftest) · secret 스캔(+selftest) · 산출물 artifact |
| `pg17-cli-replay` | pinned `supabase/setup-cli@v1` (버전 `2.111.0`) · `--help` 캡처(명령을 기억으로 추측하지 않는다) · `config.toml major_version=17` 확인 · **pack 대피 → 빈 스택 기동 → 플랫폼 초기 상태 실측 → 전제 확립 → pack 복원 후 `supabase migration up`** · `supabase migration list` · `verify_local_stack_state.sh` · `supabase stop` · artifact |

#### 왜 pack 을 먼저 치웠다가 다시 넣는가

`supabase start` 는 `supabase/migrations` 를 **자동 적용**한다. 그러면 적용 전 플랫폼 상태를
관측할 기회가 사라진다. pack 안의 자체 검사들이 바로 그 초기 상태를 전제하므로(§5-3),
pack 을 잠시 치우고 빈 스택을 띄워 초기 상태를 실측한 뒤 되돌려 놓고
`supabase migration up` 으로 적용한다. 적용은 여전히 **실제 CLI migration runner** 가 한다.

`permissions: contents: read`, secret 참조 0. PR 마다 자동 실행된다.

### 5-2. `verify_local_stack_state.sh` — 러너에서 실제로 무엇을 확인하나

1. `server_version` 이 17 인가
2. `supabase_migrations.schema_migrations` 의 version 집합이 **저장소 파일 집합과 정확히 일치**하는가
   (기대 개수를 하드코딩하지 않고 파일에서 유도한다 — 63본이든 64본이든 동작한다)
3. 첫 version 이 `20260701000000` 인가
4. `idle in transaction` 0 인가 (baseline 내부 트랜잭션 누수 탐지)
5. 구조 카운트 4종이 PG16 실측치와 같은가
6. M13 trigger 함수 2개에 anon/authenticated EXECUTE 가 없는가
7. mentor 함수 3개가 anon/auth 없음 · service_role 있음인가
8. PR #60 미포함 pack 이면 IQ 함수 본문 md5 가 baseline 값인가
9. 13축 인벤토리 덤프

### 5-3. 실제 CLI runner 1차 실행이 찾아낸 것 — 로컬 스택 ≠ 호스팅 프로젝트

`pg17-cli-replay` 의 첫 실행은 `supabase start` 도중 **원장 migration 자신의 자체 검사**에서
멈췄다. 우리가 쓴 코드가 아니라 부모에서 실제로 실행됐던 migration 이 낸 예외다.

```text
BATCH_F_M11_BASELINE_ACL_MISMATCH:
  expected <role> <priv> on public.mentor_profiles = true, measured false
```

M11 은 `public.mentor_profiles` 에 `anon`·`authenticated` 의 테이블 권한 7종이 모두 있어야
통과한다. 그 권한은 명시적 GRANT 가 아니라 **테이블 생성 시점의 default privilege** 로 붙는다.

| 환경 | public default ACL (테이블) | M11 |
|---|---|---|
| 부모 프로젝트 / Preview Branch (PHASE A 실측, PG17.6) | permissive | 통과 (replay 38/62 지점까지 확인) |
| `supabase start` 로컬 스택 (PG17) | **동일하지 않다** | **실패** |
| PG16 + `platform_stub.sql` | permissive (모델) | 통과 |

즉 `platform_stub.sql` 이 모델링해 온 "permissive 초기 상태" 는 호스팅 프로젝트의 사실이지
로컬 스택의 사실이 아니다. 이 차이는 지금까지 관측된 적이 없었다 — 실제 CLI runner 를
돌려 보고서야 드러났다.

대응은 두 갈래다.

1. **실측한다.** `capture_platform_baseline.sh` 가 pack 적용 전에 role 목록·`pg_default_acl`
   전량·schema 권한을 덤프하고, 결정적으로 **probe 테이블을 새로 만들어** 그 ACL 을 측정한다
   (3 role × 7 권한 = 21줄). 결과는 `pg17-evidence/` 에 남는다.
2. **전제를 확립한다.** `local_stack_preconditions.sql` 이 migration 실행 role 의 default
   privilege 를 호스팅 실측값에 맞춘다. 멱등이고, 확립 직후 새 테이블로 14/14 를 스스로 검증한다.

> 이 파일은 **모델링이지 pack 의 일부가 아니다.** `supabase/migrations` 에 들어가지 않고
> 부모 프로젝트에는 절대 실행하지 않는다. 이 파일이 필요하다는 사실 자체가 실측 결과다.

#### 이 진단 스크립트를 만들며 잡은 자체 결함 2건 (둘 다 '침묵이 성공처럼 보이는' 유형)

* probe 권한 질의가 `ORDER BY position 2 is not in select list` 로 깨졌는데, 그 결과
  `=false` 가 0건이 되어 **RESTRICTIVE 를 PERMISSIVE 로 오판**했다. → probe 가 정확히 21줄을
  냈는지 먼저 확인하고, 아니면 그 실행의 판정을 무효로 만든다.
* probe 테이블을 `create table if not exists` 로 만들었더니, 앞선 실행이 남긴 테이블을
  재사용해 **그 시점의 낡은 ACL** 을 측정했다(전제를 확립한 뒤에도 계속 RESTRICTIVE 로 보고).
  → default privilege 는 생성 시점에만 적용되므로 매번 drop 후 새로 만든다.

두 결함 모두 로컬 PG16 에서 before/after 시나리오를 실제로 돌려 재현·수정했다.

### 5-4. 이 검사 스크립트 자체를 어떻게 검증했나

`scripts/verify/baseline/run_local_stack_emulation.sh` — `supabase start` 가 불가능한 이 환경에서
로컬 스택의 최소 조건(TCP DB + pack 전량 적용 + history 채움)을 PG16 으로 재현하고
`verify_local_stack_state.sh` 를 실제로 돌린다.

```text
STACK_EMULATION: PASS
  → 63/63 적용, FAIL 라인 정확히 1건 = server_version(PG16 이므로 당연)
  → 나머지 8개 검사군 전부 통과
```

**한계(중요):** 이것으로 증명된 것은 *"검사 스크립트가 올바로 판정한다"* 뿐이다.
서버는 PG16 이고 history 는 CLI 가 아니라 이 스크립트가 채웠다.
PostgreSQL 17 + 실제 CLI runner 검증은 아직 실행되지 않았다.

```text
PG17_CLI_RUNNER_VERIFICATION: NOT_RUN_IN_THIS_ENVIRONMENT (러너에서 실행 필요)
```

---

## 6. 원격 적용 workflow — 4중 게이트

부모를 건드릴 수 있는 워크플로는 두 개뿐이다.

| 파일 | 대상 |
|---|---|
| `.github/workflows/db-adoption-repair.yml` | Strategy A history record 7건 등록/되돌림 |
| `.github/workflows/db-apply-pr60.yml` | PR #60 guard 1본 적용/롤백 |

게이트:

1. `workflow_dispatch` **전용** — push/PR/schedule 로 트리거되지 않는다.
2. GitHub Environment `supabase-db-adoption` 승인(사람).
3. `mode` 기본값 `dry-run`. dry-run 은 부모에 **접속조차 하지 않고** 실행될 명령만 출력한다.
4. `confirmation` 문자열 정확 일치.

```text
REPAIR   : REPAIR_7_HISTORY_RECORDS_ON_lbeqxarxothkmzqvpudy
REVERT   : REVERT_7_HISTORY_RECORDS_ON_lbeqxarxothkmzqvpudy
APPLY    : APPLY_PR60_20260804113000_TO_lbeqxarxothkmzqvpudy
ROLLBACK : ROLLBACK_PR60_20260804113000_ON_lbeqxarxothkmzqvpudy
```

필요한 Environment secret: `SUPABASE_DB_URL` (부모 Postgres 연결 문자열) — 단 하나.
두 워크플로는 같은 `concurrency.group` 을 쓰고 `cancel-in-progress: false` 다
(부모 대상 동시 실행 금지, 진행 중 작업을 끊지 않음).

### 6-1. CLI 계약을 기억으로 추측하지 않는다

두 워크플로 모두 실행 전에 `--help` 를 캡처하고, 자기가 쓸 플래그(`--status`, `--db-url`)가
실제로 존재하는지 검사해 없으면 **실행 전에 실패**한다. CLI 계약이 바뀌면 부모를 건드리기 전에 멈춘다.

### 6-2. 사전·사후 불변식

`db-adoption-repair.yml`:

| 시점 | 검사 |
|---|---|
| 사전 | ledger 행 수 56(repair) / 63(revert) · 대상 7 version 의 존재/부재 · repair plan 7행 ddl=no·schema=no · 대응 migration 파일 존재 · pack validator 재실행 |
| 사후 | ledger 행 수 63(repair) / 56(revert) · **변경분이 계획된 7건과 정확히 일치** · schema 지문 무변경 |

`db-apply-pr60.yml`:

| 시점 | 검사 |
|---|---|
| 사전 | 통합 pack 64본 · 마지막 version 이 `20260804113000` · source↔migration SHA-256 일치 · guard 마커 존재 · ledger 63(apply)/64(rollback) |
| 사후 | ledger delta 정확히 1건 · 함수 본문 md5 변화(apply) / 복원(rollback) · 본문에 `MESSAGE_AUTHOR_MISMATCH` 존재(apply) · 불변 축 13개 무변경 |

### 6-3. `parent_schema_fingerprint.sh` — 무해성 강제 도구

읽기 전용 SELECT 15축(개수 9 + 정규화 md5 6). 결정론(모든 집계 `order by` 고정).

로컬 PG16 에서 실측 확인:

```text
FINGERPRINT_DETERMINISM: PASS (동일 DB 2회 → 15축 동일)
HISTORY_ONLY_CHANGE → FINGERPRINT: 무변경        (repair 무해성 모델 성립)
PR60_FORWARD → 불변 축 13개 무변경 · md5_functions 만 변화
                                                  (db-apply-pr60.yml 사후 검증 모델과 일치)
```

> 표현 규칙: 전후가 같아도 "schema 가 전혀 변하지 않았다" 가 아니라
> **`NO_CHANGE_DETECTED_ON_CAPTURED_AXES`** 로 읽는다.

---

## 7. workflow 정적 검증 — `validate_db_workflows.py`

워크플로도 검증 대상이다. R1~R12 를 강제한다.

```text
R1  workflow_dispatch 전용        R7  permissions: contents: read
R2  environment 승인 게이트        R8  concurrency + cancel-in-progress: false
R3  mode 기본값이 dry-run          R9  금지 토큰 0 (force push/history rewrite/전량적용
R4  confirmation 기본값이 빈 문자열      플래그/파괴적 DDL/history 테이블 직접 조작/
R5  confirmation 상수가 env 와            db reset/하드코딩 secret)
    입력 설명 양쪽에 존재           R10 모든 action 이 고정 버전 pin
R6  불일치 시 exit 1 게이트 존재    R11 Supabase CLI 버전 고정(latest 금지)
                                   R12 검증 전용 워크플로는 secret 참조 0
```

**검증기 자체의 탐지력도 시험한다.** `--selftest` 는 12종의 변형을 주입하고 전부 검출되는지 본다.

```text
DB_WORKFLOW_VALIDATION: PASS
DB_WORKFLOW_SELFTEST:   PASS (변형 12/12 검출 + 워크플로 삭제 검출)
  R1 push 트리거 추가 / R2 environment 제거 / R3 기본값 execute / R4 confirmation 기본값 주입 /
  R5 상수 변조 / R7 permissions 확대 / R8 cancel-in-progress true / R9 전량적용 플래그 주입 /
  R10 action pin 해제 / R11 CLI latest / R12 검증 워크플로 secret 참조 / YAML 파손
```

R9 는 토큰 수준 금지라서, 해당 워크플로에는 그 토큰이 **부정문으로도** 등장하지 않는다
(문서화는 이 파일과 워크플로 주석에서 우회 표현으로 한다).

### 7-1. secret 스캔도 규칙을 시험한다 — `scan_repo_secrets.py`

첫 CI 실행에서 인라인 grep 기반 secret 스캔이 **오탐으로 실패**했다. 걸린 문자열은
`verify_local_stack_state.sh` 의 로컬 스택 기본 접속 문자열이었다:

```text
DB_URL="${LOCAL_DB_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"
```

이것은 `supabase start` 가 모든 개발자 머신에 동일하게 띄우는 문서화된 루프백 기본값이지
비밀이 아니다. 문자열을 조립해 숨기는 대신 **규칙을 정확하게** 고쳤다.

허용 예외는 하나뿐이다 — 자격증명이 `postgres:postgres` 이고 호스트가 루프백
(`127.0.0.1` / `localhost` / `[::1]`)인 경우. 비밀번호가 다르거나 호스트가 원격이면 차단된다.
`${{ secrets.X }}` 나 `$VAR` 같은 **참조**도 값이 아니므로 통과시킨다.

```text
SECRET_SCAN_SELFTEST: PASS — 11 케이스
  허용: 루프백 기본값(2) · secret 참조(2) · 환경변수 참조 · project ref 주석 언급
  차단: 다른 비밀번호 · 원격 호스트 · access token · JWT 형태 · 비밀값 대입
SECRET_SCAN: PASS (186 파일)
```

같은 실행에서 R12 도 오탐을 냈다(`scan_repo_secrets.py` 파일명이 `secrets.` 로 매칭).
GitHub 의 실제 참조 형태 `${{ secrets.NAME }}` 만 보도록 좁혔다.

### 7-2. selftest 표본은 리터럴로 두지 않는다

처음에는 selftest 표본을 문자열 리터럴로 넣었다. push 가 **GitHub push protection 에
거부**됐다 — 합성 `sbp_…` 표본을 실제 Supabase Personal Access Token 으로 판정했기 때문이다
(`GH013`). 예외 허용 URL 로 뚫는 대신 표본을 **런타임에 조립**하도록 바꿨다.

그 결과 이 스캐너 파일 자체도 스캔 대상에 그대로 남는다(제외 규칙 불필요). 토큰 모양
리터럴이 저장소 어디에도 없으므로 push protection 과 자체 스캔이 서로 충돌하지 않는다.

---

## 8. PR #60 쪽 변경

PR #60 branch 는 guard SQL 을 두 곳에 둔다.

```text
supabase/sql/20260804113000_iq_attachment_message_author_guard.sql        (리뷰 정본)
supabase/migrations/20260804113000_iq_attachment_message_author_guard.sql (실행 정본)
```

둘은 바이트가 같아야 한다. `scripts/verify/check_pr60_native_migration_sync.sh` 가 강제한다.

```text
PR60_NATIVE_MIGRATION_SYNC: PASS
  SHA-256 일치: 86ce0bf66eddc5fb…   size 9,759B
  version 20260804113000 migration 정확히 1개
  MESSAGE_AUTHOR_MISMATCH 가드 존재
```

PR #60 branch 에 migration 이 1본뿐인 것이 정상이다 — 나머지 63본은 PR #61 소유이고,
PR #61 이 main 에 병합된 뒤에야 같은 디렉터리에서 합쳐진다.

---

## 9. 실행 순서 (사람이 하는 일)

```text
1. PR #61 리뷰·병합            (pack 63본이 main 에 들어온다)
2. PR #60 리뷰·병합            (64본이 된다)
3. GitHub Environment `supabase-db-adoption` 생성 + 승인자 지정
   secret: SUPABASE_DB_URL
4. db-migration-pack-verify.yml 실행 → PG17 + 실제 CLI runner 결과 확인
   ← 여기가 PG17_CLI_RUNNER_VERIFICATION 을 NOT_RUN 에서 벗어나게 하는 지점이다
5. db-adoption-repair.yml  mode=dry-run        → 출력 검토
6. db-adoption-repair.yml  mode=execute-repair → ledger 56 → 63
7. PHASE B: 신규 Preview Branch 를 만들어 repair 된 원장이 실제로 재현되는지 실측
   ← §6 "Strategy A 의 핵심 미확인 위험"(repair record 가 statements 를 갖는가)은
     오직 이 단계로만 해소된다
8. db-apply-pr60.yml  mode=dry-run → mode=apply → ledger 63 → 64
```

4번 전에 6번을 실행하지 않는다. 7번 전에 8번을 실행하지 않는다.

---

## 10. 아직 확인되지 않은 것 (PASS 로 표기하지 않는다)

```text
PG17_CLI_RUNNER_VERIFICATION:        NOT_RUN   (러너 필요)
PARENT_REPAIR_EXECUTION:             NOT_RUN   (승인 필요)
PHASE_B_BRANCH_REPRODUCTION:         NOT_RUN   (repair 이후에만 가능)
REPAIR_RECORD_CONTAINS_STATEMENTS:   UNKNOWN   (문서 NOT_COVERED · PHASE B 로만 판정)
PR60_REAL_AUTH_PATH:                 BLOCKED_AUTH (이 컨테이너 egress 차단)
WORKFLOW_ACTUAL_EXECUTION:           NOT_RUN   (정적 검증만 수행)
```

---

## 11. 도구 목록 (이번 세션 추가분)

| 스크립트 | 역할 |
|---|---|
| `build_native_baseline_migration.py` | baseline 1본 결정론 생성(`--check` 로 stale/직접편집 탐지) |
| `build_native_migration_pack.py` | 63본 pack 생성(binary copy) + manifest |
| `validate_native_migration_pack.py` | pack 정적 검증(`--with-pr60` 로 64본) |
| `run_native_pack_replay.sh` | clean PG16 에 pack 적용 + PR60 왕복 |
| `verify_local_stack_state.sh` | 러너의 `supabase start` 결과 검증(9개 검사군) |
| `run_local_stack_emulation.sh` | 위 스크립트 자체를 PG16 으로 시험 + fingerprint 모델 검증 |
| `parent_schema_fingerprint.sh` | 읽기 전용 15축 schema 지문(무해성 강제) |
| `capture_platform_baseline.sh` | pack 적용 전 플랫폼 초기 상태 실측(probe 21줄 강제) |
| `local_stack_preconditions.sql` | 로컬 스택을 호스팅 초기 상태로 정렬(모델링 · pack 아님) |
| `validate_db_workflows.py` | 워크플로 R1~R12 정적 검증 + `--selftest` |
| `scan_repo_secrets.py` | 값 기준 secret 스캔(루프백 로컬 기본값만 허용) + `--selftest` |
| `check_pr60_native_migration_sync.sh` (PR #60) | source↔migration 바이트 동기화 강제 |
