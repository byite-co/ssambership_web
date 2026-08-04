# remote DB baseline reconstruction — 감사 정본 (2026-08-04)

원격 프로젝트(`lbeqxarxothkmzqvpudy`)의 migration 원장만으로는 DB 를 재현할 수 없다.
이 문서는 그 이유, 복원한 baseline 의 구성, 검증 수준, 그리고 아직 검증되지 않은 것을
구분해 기록한다. **증거 수준을 넘는 표현은 쓰지 않는다.**

---

## 0. 용어 고정 (혼용 금지)

수치는 아래 이름으로만 부른다. 서로 다른 대상이며 섞어 쓰면 보고가 틀린다.

| 용어 | 값 | 의미 |
|---|---|---|
| `BASELINE_SOURCE_PARTS` | 188 | baseline 을 이루는 SQL 조각 수 = 번들 77(섹션 74 + 파일별 주석 전용 선두 조각 3) + 보충 5 + 번호 SQL 106 |
| `BASELINE_APPLY_STAGES` | 114 | `supabase/baseline/apply_order.txt` 의 적용 단계 수(번들 3개는 각 1단계) |
| `ORIGINAL_LEDGER_ENTRIES` | 56 | 부모 원장 그대로의 항목 수 — 재구성이 **바꾸지 않는다** |
| `INTERLEAVE_ENTRIES` | 6 | 재구성이 추가한 이력 항목 |
| `CURRENT_AUGMENTED_REPLAY_STAGES` | 62 | 현재 정본 재생 단계 수 = 56 + 6 |

`scripts/verify/baseline/validate_replay_manifest.sh` 가 이 값들을 기계적으로 강제한다
(어긋나면 nonzero exit).

### 역사적 실행 값과 현재 정본 값은 별개다

preview branch 실측은 **수정 전 manifest(61단계)** 로 실행됐다. 그 기록을 현재 모델의
62단계로 고쳐 쓰지 않는다. 두 값을 항상 분리해 보고한다.

```text
HISTORICAL_PREVIEW_REPLAY_TOTAL: 61          # 실행 당시 manifest (commit 0f98db3)
HISTORICAL_PREVIEW_REPLAY_COMPLETED: 36
HISTORICAL_PREVIEW_FIRST_FAILED_INDEX: 37
HISTORICAL_PREVIEW_MANIFEST_SHA256:
  bc90d94f479bb0453a879f857ad6633befa75914a77ca97e6c1f75f947f4075d
HISTORICAL_PREVIEW_INTERLEAVE_TOTAL: 5

CURRENT_ORIGINAL_LEDGER_TOTAL: 56
CURRENT_INTERLEAVE_TOTAL: 6
CURRENT_AUGMENTED_REPLAY_TOTAL: 62
CURRENT_REPLAY_MANIFEST_SHA256:
  2940ef822f9c3ee92d961afbffce2d687f287e54e6bb36ed66e760c90d4f6172
CURRENT_MODEL_REAL_PLATFORM_STATUS: UNVERIFIED
```

역사적 실행의 36번째/37번째 항목(당시 manifest 기준):

```text
#36 supabase/baseline/ledger_replay/20260731100358_20260730095436_comments_author_label_baseline_convergence.sql  (성공)
#37 supabase/baseline/ledger_replay/20260731100540_20260730095438_comments_author_label_denormalize.sql          (실패)
```

현재 manifest 에서는 `20260729000000` interleave 가 33번째로 삽입돼 이후 항목이 1씩
밀렸다(같은 M13 파일이 현재 38번째). 단계 번호는 manifest 마다 다르므로 **버전 문자열로
식별**한다.

---

## 1. 근본 원인 (실측 확정)

- 부모 원장: 56건, 최초 `20260702065122`.
- 기반 스키마(번호 SQL 001~183 + 번들)는 **원장 밖**에서 SQL Editor 로 수동 적용됐다.
- 진단 branch(`ltktfmgjjdzaxugyoxrg`, 삭제 완료): 원장 1번째 항목의
  `alter table public.users …` 가 42P01(`relation "public.users" does not exist`)로 실패
  → 적용 0/56, 빈 스키마.
- 실측 중요 사실: **API 로 만든 branch 는 부모 원장(statements)을 재생**한다
  (실패문이 원장 1번 항목과 자구 일치). 공식 문서는 Git 통합 경로만 서술하므로
  API 경로의 원장 사용은 문서 NOT_COVERED → `UNVERIFIED_PLATFORM_BEHAVIOR`(실측 근거만 기록).

## 2. 플랫폼 사실 (공식 문서)

- `supabase migration repair --status applied <version>`: 추적 테이블만 변경, DDL 실행 없음.
  backdated version 채택 가능(값 제한 서술 없음).
- branch 과금: 시간당 $0.01344(Micro), 존재 시간 기준, Spend Cap 미적용.
- `with_data=false` 의 복사 범위: 문서 NOT_COVERED(실측: 데이터·버킷·auth 미복사).
- **repair 로 등록한 backdated 항목이 미래 branch replay 에 포함되는지: 문서 NOT_COVERED.**
  → 채택 후 신규 branch 로 실측해야 한다(§7 PHASE B).

## 3. 재구성 구성물

| 경로 | 내용 |
|---|---|
| `supabase/baseline/apply_order.txt` | 114 apply stages (번들 3 + 보충 5 + 번호 SQL 106) |
| `supabase/baseline/supplements/` | 저장소 SQL 에 생성문이 없는 부모 실측 객체 복원 5본 |
| `supabase/baseline/ledger_replay/` | 원장 56본 정본(원장 `statements` 추출, manifest md5 56/56 일치) |
| `supabase/baseline/interleaves/` | 실제 이력을 반영한 추가 항목 6본 |
| `supabase/baseline/replay_order_augmented.txt` | 62 replay stages |
| `supabase/baseline/ledger_manifest.tsv` | 원장 정본 대조표(version/name/bytes/md5) |
| `supabase/baseline/adoption_repair_plan.tsv` | Strategy A 로 등록할 version record 목록(§6) |
| `scripts/verify/baseline/` | manifest 검증·라운드트립·인벤토리·비교기·축 checksum·뷰 판별·defacl 프로브 |
| `docs/audit/remote_db_inventory_20260804/` | 부모 구조 인벤토리 + 축 기준값 + 프로브 증거 |

### 핵심 발견: 실제 이력은 interleaved — 단일 pre-ledger baseline 으로는 불가능

`add_individual_question_attachment` 수명: 원장 s17/v2(7/7, `returns uuid`) → **수동 168**
(그 뒤, drop + `returns jsonb`) → 원장 `20260803142559`(jsonb). 168 을 baseline 에 넣으면
s17 이 42P13, 빼면 `20260803142559` 가 42P13 — 어느 쪽도 성립하지 않는다. 따라서 168 은
baseline 이 아니라 **원장 사이 항목**(`20260715000000`)으로 배치했다. 이것이 Strategy A 가
baseline 1건이 아니라 **7건**의 history record 를 요구하는 이유다(§6).

---

## 4. 로컬 검증 (clean PostgreSQL 16, 원격 비접촉)

```text
MANIFEST_VALIDATION: PASS
  ORIGINAL_LEDGER_ENTRIES 56 · INTERLEAVE_ENTRIES 6 · CURRENT_AUGMENTED_REPLAY_STAGES 62
  누락 0 · 경로 중복 0 · version 중복 0 · 순서 역전 0 · 원장 md5 56/56 일치

LOCAL_BASELINE_STATUS: PASS — 빈 DB 에서 114 stages 순차 적용, 오류 0
LOCAL_AUGMENTED_REPLAY_STATUS: PASS — 62/62
DEFACL_PROBE(before/after): PASS
M13_SELFCHECK: PASS
LOCAL_SCHEMA_EQUIVALENCE: EQUIVALENT — 13축 실질 drift 0
  tables 79 · columns 860 · constraints 364 · indexes 240 · views 7 · functions 242 ·
  triggers 95 · policies 220 · table_grants 1319 · buckets 13 · types 1 ·
  publications · default_privileges
VIEW_REAL_DIFF: 0 (7/7 deparse 동등)
PR60_LOCAL_ROUNDTRIP: forward → 15케이스 fixture PASS → rollback(prosrc md5
  58f0c2411d40b2ce3bcec23efa0c88a1 + ACL 정확 복원) → reapply → fixture PASS
```

허용 diff 는 전부 근거와 함께 기록한다(무마 없음):

- **함수 84건 CRLF 아티팩트** — 부모는 SQL Editor 로 적용돼 본문에 CR 이 남아 있다.
  CR 제거 후 md5 일치를 서버측 집계 체크섬(242행)으로 확인.
- **뷰 7건 deparse 서식** — PG16(로컬) vs PG17(부모) `pg_get_viewdef` 출력 차이.
  부모 정의문을 같은 PG16 엔진에 재생성해 재deparse 비교 → `REAL_DIFF 0`.
- **`default_privileges` 의 `m`(MAINTAIN) 플래그** — MAINTAIN 은 PG17 권한으로 PG16 에 없다.
  `m` 제거 후 일치 → 엔진 버전 아티팩트로 계상(`engine_maintain_flag_allowed`).
- **`supabase_admin` 소유 defacl 3행 · `supabase_realtime_messages_publication` · 플랫폼 확장**
  — 플랫폼 관리 객체.

CR 제거로도 불일치한 함수 **32건**은 추측 없이 부모 `pg_get_functiondef` 원문을 md5 검증해
편입했다(저장소 파일과 실제 배포본이 달랐던 지점의 명시적 기록).

### 알려진 한계

```text
BASELINE_END_TO_END_IDEMPOTENCY: NOT_IDEMPOTENT
```

파일 단위 가드는 전수 유지되지만 **세트 전체 재적용은 실패**한다. 로컬 실측
(`scripts/verify/baseline/run_noop_test.sh`)으로 성격을 고정했다:

```text
BASELINE_END_TO_END_IDEMPOTENCY: NOT_IDEMPOTENT
  재적용 불가 2단계:
    078_p0_public_mentor_read_rpc_v2.sql   — cannot change return type of existing function
    111_due_payouts_completion_guard.sql   — cannot drop columns from view
BASELINE_FULL_REAPPLY: UNSAFE_BY_DESIGN
  구조(테이블·컬럼·제약·인덱스·뷰·트리거·정책·grant·버킷·타입·기본권한) 변화: 0
  그러나 함수 ACL 3건이 **넓어진다**:
    public.mentor_directory_list(p_limit integer)
    public.mentor_profiles_for_directory(p_ids uuid[])
    public.mentor_user_public(p_mentor_id uuid)
      service_role:EXECUTE  →  anon:EXECUTE, authenticated:EXECUTE, service_role:EXECUTE
  원인: 078 이 반환타입 충돌로 abort 하면서 **자신의 REVOKE 가 실행되지 않아**,
        앞선 파일(005 계열)이 부여한 anon/authenticated EXECUTE 가 그대로 남는다.
```

즉 전체 재실행은 단순히 "실패"에 그치지 않고 **권한을 넓힌 상태로 끝난다**. 복구는 반드시
**실패 지점부터 재개**해야 하며 전체 재실행은 금지다. `run_noop_test.sh` 가 이 성질을
회귀 검사로 고정한다(ACL 외 축이 하나라도 변하면 실패).

---

## 5. preview branch 실측과 함수 default ACL

### 5-1. 실측 기록 (branch `uszbhvqkdtsbnnwiblga` — 삭제 완료)

```text
BASELINE_ON_REAL_PLATFORM: PASS — 188/188 조각, 누락 0 · 중복 0 · 오류 0 · 미완료 txn 0
  결과: public 77 tables · 194 functions · 184 policies
  (M2 사전 게이트 대상 shortform_view_events 부재 유지 — 선점 없음 확인)

LEDGER_REPLAY_ON_REAL_PLATFORM: PARTIAL — 36/61 성공, 37번째에서 정지
  실패: 20260731100540 (M13 comments_author_label_denormalize)
        S2_M13_SELFCHECK: trigger functions hardening mismatch (matched=0)
  37번 항목은 자체 begin/commit 으로 전량 롤백 — 부분 적용 없음(객체 실측 확인).
```

이 실패는 **재구성 쪽 결함**이었다(원장·부모 문제가 아니다).

### 5-2. 원인: 함수 default ACL 의 전환 시점

- branch(부모 원장만 재생된 신규 프로젝트) 실측
  `pg_default_acl(schema public, objtype f)` = `{postgres=X, anon=X, authenticated=X, service_role=X}`
  → 신규 public 함수는 생성 즉시 세 역할에 EXECUTE 가 **명시 부여**된다.
- M13 은 자기가 만든 트리거 함수 2종에 `REVOKE ALL ON FUNCTION … FROM PUBLIC` 을 실행한 뒤
  그 함수에 anon/authenticated EXECUTE 가 **없어야** 통과하는 자체 검사를 한다.
  `FROM PUBLIC` 회수는 **역할별 명시 부여를 지우지 못한다** → permissive defacl 상태에서는
  구조적으로 통과 불가.
- 부모 '현재' defacl(f) 중 grantor=postgres 행은 `{postgres=X}` 로 hardened 이고,
  함수 소유자가 postgres 이므로 실제 적용되는 것은 이 행이다 → 부모에서는 통과한다.
- 결론: **함수 defacl 하드닝은 M13(20260730095438) 이전에 이미 적용돼 있었다.**
  수정 전 재구성은 이 전환을 `20260802000000` 한 곳에 뭉쳐 뒀고, 로컬 스텁이 함수 defacl 을
  비워 둔 탓에 로컬에서 드러나지 않았다.

### 5-3. PostgreSQL default ACL 의미론 (로컬 PG16 실측 — 모델링 근거)

일반 PostgreSQL 기본값과 Supabase 의 역할별 명시 default ACL 은 **다른 것**이다.
아래는 이 재구성이 의존하는 실측 의미론이다.

- `pg_default_acl` 항목은 내장 기본값(`acldefault`: 함수 = PUBLIC EXECUTE + 소유자)에
  **가산**된다. ALTER DEFAULT PRIVILEGES 로 부여한 역할 항목만 기록되며,
  **내장 PUBLIC EXECUTE 는 default privileges 조작으로 제거되지 않는다.**
- 그래서 하드닝(역할 부여 회수) 직후 신규 함수의 `proacl` 은 NULL(=PUBLIC EXECUTE)이고,
  PUBLIC 제거는 마이그레이션이 객체에 직접 실행하는 `REVOKE … FROM PUBLIC` 이 수행한다.
- 따라서 올바른 판정 기준은 "생성 직후 ACL" 이 아니라
  **"REVOKE FROM PUBLIC 이후 역할별 EXECUTE 가 남는가"** 다 — M13 이 하는 그대로.
- 스텁이 permissive 상태를 만들 때 **소유자(postgres)를 반드시 포함**해야 한다. 소유자를 빼면
  하드닝이 그 행을 통째로 지워 내장 기본값(PUBLIC EXECUTE)으로 되돌아가 여전히 permissive 다.

### 5-4. 반영한 수정과 회귀 검사

1. `scripts/verify/baseline/platform_stub.sql` — 함수/테이블/시퀀스 defacl 을 부모·branch
   실측대로 permissive 하게(소유자 포함) 부여. 이제 로컬이 실제 플랫폼과 같은 조건으로
   M13 게이트를 시험한다.
2. interleave 분리 —
   `20260729000000_public_defacl_functions_hardening.sql`(함수, M13 이전) /
   `20260802000000_public_defacl_hardening.sql`(테이블·시퀀스).
3. `scripts/verify/baseline/defacl_probe.sql` 신설 — 하드닝 직전/직후에 프로브 함수를 만들어
   M13 과 동일한 `REVOKE … FROM PUBLIC` 을 적용한 뒤 역할별 EXECUTE 잔존 여부를 단언한다.
   프로브 함수는 캡처 즉시 DROP 되어 인벤토리에 남지 않는다.
   `run_roundtrip.sh` 가 매 실행마다 자동 수행한다(`PROBE=0` 으로 비활성 가능).
4. `default_privileges` 를 비교 축에 추가 — 최종 defacl 상태를 부모 실측값과 직접 대조한다.

프로브 실측 결과(전문: `docs/audit/remote_db_inventory_20260804/defacl_probe_evidence.txt`):

```text
phase=before (하드닝 직전)
  DEFAULT_ACL_EVIDENCE  defaclrole=postgres schema=public objtype=f
    defaclacl={postgres=X, anon=X, authenticated=X, service_role=X}
    grantor=postgres  grantee=anon|authenticated|postgres|service_role  privilege=EXECUTE
  PROBE_FUNCTION_EVIDENCE  proacl@create = {=X, postgres=X, anon=X, authenticated=X, service_role=X}
  PROBE_AFTER_REVOKE_PUBLIC proacl = {postgres=X, anon=X, authenticated=X, service_role=X}
    anon=t authenticated=t service_role=t   ← branch 에서 M13 이 실패한 조건, 로컬 재현 성공

phase=after (하드닝 직후)
  PROBE_FUNCTION_EVIDENCE  proacl@create = (null = implicit PUBLIC)
  PROBE_AFTER_REVOKE_PUBLIC proacl = {postgres=X}
    anon=f authenticated=f service_role=f · m13_proacl_condition=t   ← M13 통과 조건 충족
```

```text
UNVERIFIED_ON_REAL_PLATFORM: 위 수정본의 branch 재생은 아직 실측되지 않았다.
  → PHASE A(§7)로 62단계 완주를 확인해야 한다.
```

### 5-5. PHASE A 실측 (2026-08-04, branch `ydoryiaexclkowbvkiep` — 삭제 완료)

수정본을 실제 플랫폼(PostgreSQL 17.6)에서 검증했다. 원자료:
`docs/audit/remote_db_inventory_20260804/phase_a_preview_20260805/`

```text
BASELINE_REAL_PLATFORM: PASS — 188/188 조각 · 114/114 stages
  gaps 0 · duplicates 0 · errors 0 · open transactions 0
  결과 public: tables 77 · functions 194 · policies 184 · buckets 12
  선점 금지 객체 4종 부재 확인 · mobile_app_version_policies marker 존재
AUGMENTED_REPLAY_REAL_PLATFORM: PARTIAL — 38/62 (시간 게이트로 중단, 실패 아님)
M13_SELFCHECK(ledger version 20260731100540): PASS   ← 직전 세션 실패 지점
```

**함수 defacl 하드닝 가설이 실측으로 확정됐다.**

| 시점 | `pg_default_acl`(postgres, public, objtype=f) |
|---|---|
| branch 생성 직후 | `{postgres=X, anon=X, authenticated=X, service_role=X}` |
| step 33(`20260729000000`) 직후 | `{postgres=X/postgres}` — 부모 실측값과 일치 |

step 38 직후 트리거 함수 2종 모두 `proacl={postgres=X/postgres}` 이고 anon/authenticated/
service_role/PUBLIC EXECUTE 가 전부 false → 자체 검사 ③ matched=2 (직전 세션 matched=0 실패).
즉 `20260729000000` 은 M13 통과에 **필요충분**했고, 그 파일의 `UNVERIFIED_ON_REAL_PLATFORM`
경고는 해소됐다. 또한 branch 초기 defacl 이 **소유자(postgres)를 포함한** permissive 행이라는
점이 platform_stub 교정(§5-3)이 실플랫폼과 일치함을 입증했다.

잔존 위험: `supabase_admin` grantor 의 defacl(f) 행은 끝까지 permissive 하다 — 마이그레이션이
만드는 함수의 소유자가 postgres 인 동안에만 무해하다.

```text
STILL_UNVERIFIED_ON_REAL_PLATFORM: replay 39~62 · 부모↔branch 13축 동등성 · PR #60 왕복
  → 다음 PHASE A 세션에서 신규 branch 로 이어서 수행한다.
```

---

## 6. 운영 채택 계획 — Strategy A (history-only)

계획 정본: `supabase/baseline/adoption_repair_plan.tsv`
(열: order / version / kind / source_path / expected_current_status / requested_status /
ddl_executed / schema_change_expected / notes)

```text
STRATEGY_A_BASELINE_RECORDS: 1        (20260701000000 — 원장 최초 20260702065122 보다 과거)
STRATEGY_A_INTERLEAVE_RECORDS: 6      (20260715000000 · 20260729000000 · 20260802000000 ·
                                       20260804100000 · 20260804100001 · 20260804100002)
STRATEGY_A_TOTAL_HISTORY_RECORDS: 7
STRATEGY_A_EXPECTED_DDL: 0
STRATEGY_A_EXPECTED_SCHEMA_DIFF: 0
STRATEGY_A_EXPECTED_HISTORY_ONLY_MUTATION: YES
```

> 이전 문서의 "추적 테이블 1행 INSERT 뿐" 은 **오기였다.** interleave 가 6건이므로
> 등록 대상은 baseline 1 + interleave 6 = **7개 version record** 다.
> 이 수치는 manifest 에서 계산되며 `validate_replay_manifest.sh` 가 계획서와 manifest 의
> version 집합 일치를 강제한다.

### 실행 절차 (별도 승인 후, 이 세션에서는 실행하지 않음)

1. **실행 전 반드시** 설치된 CLI 에서 문법을 확인한다: `supabase migration repair --help`
   (이 컨테이너에는 CLI 가 없다 — `SUPABASE_CLI_SYNTAX_VERIFIED: NOT_POSSIBLE_IN_THIS_ENV`).
   복수 version 을 한 번에 지정할 수 있는지도 그 출력으로 확인한다.
2. `adoption_repair_plan.tsv` 의 7개 version 을 `--status applied` 로 등록한다.
   비밀값(access token·DB password·service key)은 명령 예시·로그 어디에도 남기지 않는다.
3. 등록 전/후 `supabase_migrations.schema_migrations` 행 수를 비교해 **정확히 +7** 인지 확인한다.
4. 스키마 diff 0 을 확인한다(`scripts/verify/baseline/axis_checksums.sql` 전/후 대조).

### 롤백 (version 단위)

```text
supabase migration repair --status reverted <version>
```

- 이것은 **history record 상태만 되돌린다.**
- DDL 롤백이 아니며, 스키마 객체를 되돌리지 않는다.
- 되돌릴 대상은 위 7개 version 뿐이다.

### Strategy A 의 핵심 미확인 위험

`migration repair` 는 추적 테이블에 version/name 을 기록한다. **그 레코드가 branch replay 에
필요한 `statements` 를 포함하는지는 문서 NOT_COVERED** 다. 만약 포함하지 않으면, repair 후
새로 만든 branch 는 등록된 7건에 대해 실행할 문장이 없어 baseline 이 재현되지 않을 수 있다.
이 위험은 오직 **PHASE B 실측**으로만 해소된다.

### Strategy B (원장 스쿼시) — 권장하지 않음

원장 56행 삭제·재등록은 이력 파괴, 진행 중 PR 의 version 충돌, 복구 불가 위험을 수반하며
Strategy A 와 같은 재현성 외에 얻는 것이 없다.

---

## 7. Preview Branch 검증은 2단계다 (1회로 끝나지 않는다)

### PHASE A — 채택 **전**, 수정 모델 검증 (부모 history 무접촉)

목표: 수정된 baseline/replay 모델이 실제 Supabase PostgreSQL 17 환경에서 완주하는가.

1. baseline source 188/188 적용
2. baseline apply stages 114/114 완료
3. original ledger 56/56 완료
4. interleave 6/6 완료
5. augmented replay 62/62 완료
6. gaps 0 · 7. duplicates 0 · 8. open transactions 0
9. 부모 현재 구조와 full inventory equivalence · 10. unexpected parent diffs 0
11. PR #60 forward · 12. fixture · 13. rollback · 14. 기준 함수 MD5 복원 · 15. reapply
16. Preview Branch 삭제
17. 부모 history/schema 무변경 확인

PHASE A 합격이 증명하는 것: **모델이 실플랫폼에서 완주 가능**하고 PR #60 이 그 위에서 왕복 가능.
PHASE A 가 증명하지 **못하는** 것: repair 이후 새 branch 가 history 를 올바르게 소비하는지,
부모 history 채택의 성공, production rollout 승인.

### PHASE B — 채택 **후**, branch 재현 검증

선행 조건: PHASE A PASS · PR #61 사람 리뷰 · repair 대상 version 목록 확정 ·
부모 history write 별도 승인 · repair 전/후 증거 확보.

1. 부모에 history-only repair 적용
2. 예상 version record 수(7)와 실제 증가 행 수 일치 확인
3. DDL/schema diff 0 확인
4. 신규 Preview Branch 생성
5. branch 가 baseline + interleave + ledger 를 올바르게 재현하는지 확인
6. 빈 branch·부분 스키마가 아님을 확인
7. 부모 현재 구조와 equivalence
8. branch 삭제
9. 부모 무변경(또는 승인된 history-only 변경만) 확인

**PHASE B 통과 전에는 `REPRODUCIBLE_REMOTE_DB_BASELINE: PRESENT` 를 선언할 수 없다.**

```text
PHASE_A_PREVIEW_VALIDATION: OWNER_APPROVAL_REQUIRED
STRATEGY_A_PARENT_REPAIR: NOT_APPROVED
PHASE_B_POST_ADOPTION_VALIDATION: NOT_YET_ELIGIBLE
```

---

## 8. 부모 무변경 증거의 수준 (과대 표현 금지)

preview branch 세션에서 부모에 대한 쓰기는 0 이었고, 세션 시작·정리 후 채취한
**sentinel** 에서 변화가 검출되지 않았다. 그러나 이는 DB 전체의 동일성 증명이 아니다.

```text
PARENT_CHANGE_DETECTION: NO_CHANGE_DETECTED_ON_CAPTURED_SENTINELS
PARENT_SENTINEL_CHECK: PASS
PARENT_FULL_AXIS_PRE_POST_COMPARISON: PASS   (2026-08-04 PHASE A 세션에서 실제 수행)
PARENT_BYTE_IDENTICAL: NOT_PROVEN            (이 표현은 계속 쓰지 않는다)
```

2026-08-04 PHASE A 세션은 `axis_checksums_v2.sql`(13축)을 **세션 시작(16:07:51Z)과
branch 삭제 후(18:11:16Z)** 각각 실행해 두 벌을 산출물로 남겼다. 13축 전부 개수·md5 동일:

```text
tables 79 · columns 860 · constraints 364 · indexes 240 · views 7 · functions 242 ·
triggers 95 · policies 220 · table_grants 1319 · buckets 13 · types 1 ·
publications 2 · default_privileges 6        → differing axes: 0
원자료: docs/audit/remote_db_inventory_20260804/phase_a_preview_20260805/parent_{pre,post}_axes.json
```

그럼에도 `byte-identical` 은 쓰지 않는다 — 13축은 구조 축의 정규화 지문이며, 데이터 전체
바이트·시스템 카탈로그 전체·물리 저장 구조·OID/통계/시간 메타데이터를 비교하지 않는다.

채취한 sentinel 축:

- `supabase_migrations.schema_migrations` 행 수(56) 및 최대 version
- guard 함수 `public.add_individual_question_attachment` 의 `md5(prosrc)`
- 주요 객체 수: tables · functions · policies · buckets

`byte-identical` 이라는 표현은 쓰지 않는다. 위 sentinel 은 다음을 비교하지 않는다:
데이터 전체 바이트 · 시스템 카탈로그 전체 바이트 · 물리 저장 구조 · OID/통계/시간 메타데이터.

권장 표현:

> 부모 프로젝트는 세션 시작·cleanup 후 채취한 migration ledger, guard 함수 MD5,
> 주요 객체 수 등 위에 열거한 sentinel 에서 변화가 검출되지 않았다.

### 절차 정착 (2026-08-04 PHASE A 에서 이행 완료)

이전 판에서 "다음 세션이 해야 할 개선" 으로 남겨 뒀던 pre/post 2벌 채취를 실제로 이행했다.
`docs/audit/remote_db_inventory_20260804/parent_axis_checksums.json` 은 여전히 세션 시작
시점 1벌(v1 규칙, 11축)이지만, PHASE A 세션은 **13축 v2**(`axis_checksums_v2.sql`)를
세션 시작 직후와 branch 삭제 후 각각 실행해 두 벌을 남겼다.

이후 모든 PHASE A/B 세션은 같은 절차를 따른다:

1. 세션 시작 직후 부모에 `axis_checksums_v2.sql` 1회 → `parent_pre_axes.json`
2. branch 삭제 후 부모에 동일 파일 1회 → `parent_post_axes.json`
3. 두 벌을 기계 비교해 differing axes 를 보고(0 이어야 PASS)

`byte-identical` 은 두 벌이 모두 있어도 쓰지 않는다.

---

## 9. 환경 제약 (이 컨테이너)

- `*.supabase.co` HTTPS/TCP egress 차단(프록시 403) → 실 JWT REST(Auth 가입·Storage 업로드·
  Data API) 불가 → PR #60 의 실인증 경로 검증은 `BLOCKED_AUTH`.
- Docker 데몬 부재 → Supabase 로컬 스택 불가. 로컬 검증은 scratch PostgreSQL 16 + platform_stub.
- Supabase CLI 미설치 → repair 명령 문법은 실행 세션에서 `--help` 로 확인해야 한다.
- MCP 경유 SQL/관리 작업은 가능(읽기 전용으로만 사용했다).

## 10. 로컬 검증 도구

| 스크립트 | 역할 |
|---|---|
| `validate_replay_manifest.sh` | manifest 정적 검증(개수·존재·중복·순서·md5·SHA-256·repair 계획 일치) |
| `run_roundtrip.sh` | stub → baseline 114 → augmented replay 62 → 인벤토리 → PR60 f/fixture/rollback/reapply. defacl 프로브·M13 마커 포함 |
| `defacl_probe.sql` | 함수 default ACL 하드닝 전/후 회귀 검사(프로브 함수는 자동 정리) |
| `local_inventory.sql` | 로컬 구조 인벤토리(13축, `default_privileges` 포함) |
| `compare_schema_inventory.py` | 부모 인벤토리 대조(허용 diff 는 종류별로 분리 계상) |
| `view_deparse_diag.py` | 뷰 정의 차이가 엔진 버전 서식인지 실질 diff 인지 판별 |
| `axis_checksums.sql` / `parent_axes.py` | 11축 개수+정규 문자열 md5 (대상 DB / 부모 인벤토리) |
| `run_noop_test.sh` | baseline 2회 적용 시 구조 불변 검사 |
