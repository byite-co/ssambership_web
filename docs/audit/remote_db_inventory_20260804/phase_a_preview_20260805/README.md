# PHASE A — Preview Branch 실측 (2026-08-04)

수정된 baseline/replay 모델을 **실제 Supabase 플랫폼(PostgreSQL 17.6)** 에서 검증한 기록.
부모 프로젝트에는 SELECT 만 실행했다(스키마·history write 0).

## 결과 요약

```text
FINAL_STATUS: PHASE_A_PARTIAL

BASELINE_REAL_PLATFORM: PASS
  BASELINE_SOURCE_PARTS: 188/188  (실행 대상 185 + 주석 전용 3)
  BASELINE_APPLY_STAGES: 114/114
  GAPS 0 · DUPLICATES 0 · ERRORS 0 · OPEN_TRANSACTIONS 0
  결과: public tables 77 · functions 194 · policies 184 · buckets 12
  선점 금지 객체 부재 확인(4종) · mobile_app_version_policies marker 존재

AUGMENTED_REPLAY_REAL_PLATFORM: PARTIAL — 38/62
  M13_SELFCHECK: PASS   ← 직전 세션이 실패했던 바로 그 지점
  중단 사유: 시간 게이트(T2). 실패 아님. 39~62 미실행.

FULL_INVENTORY_EQUIVALENCE: NOT_RUN  (replay 미완 → 부모와 비교 불가)
PR60_BRANCH_ROUNDTRIP: NOT_RUN       (T3 게이트에 따라 생략)
REAL_AUTH_STORAGE_E2E: NOT_RUN

PARENT_SENTINEL_PRE_POST: PASS
PARENT_FULL_AXIS_PRE_POST: PASS — 13축 개수·md5 전부 동일
PARENT_SCHEMA_WRITES: 0 · PARENT_HISTORY_WRITES: 0
TEMP_BRANCH_DELETED: YES (마감 38분 전)
```

## 이번 세션의 핵심 성과

**직전 세션 실패 지점(M13, ledger version 20260731100540)이 실플랫폼에서 통과했다.**
원인 가설 — "함수 default ACL 하드닝은 M13 이전에 있었어야 한다" — 이 실측으로 확정됐다.

| 시점 | `pg_default_acl` (postgres, public, objtype=f) |
|---|---|
| branch 생성 직후 | `{postgres=X, anon=X, authenticated=X, service_role=X}` (permissive) |
| step 33 적용 직후 | `{postgres=X/postgres}` (hardened — **부모 실측값과 일치**) |

step 38(M13) 직후 트리거 함수 2종:

```text
comments_set_author_label            proacl={postgres=X/postgres}  anon=f auth=f svc=f public=f
community_comments_set_author_label  proacl={postgres=X/postgres}  anon=f auth=f svc=f public=f
→ M13 자체검사 ③ matched=2 (직전 세션은 matched=0 으로 실패)
```

즉 `20260729000000_public_defacl_functions_hardening.sql` 은 step 38 통과에 **필요충분**했다.
해당 파일의 `UNVERIFIED_ON_REAL_PLATFORM` 경고는 이로써 해소된다.

부수 확인: branch 초기 defacl 이 소유자(postgres)를 포함한 permissive 행이라는 점이
로컬 스텁 교정(소유자 포함)이 실플랫폼과 일치함을 입증했다.

## 잔존 위험

`supabase_admin` grantor 의 defacl(f) 행은 끝까지 permissive 하다. 마이그레이션이 만드는
함수의 소유자가 `postgres` 인 동안에만 무해하며, 다른 소유자로 생성되는 함수는 여전히
역할별 EXECUTE 를 부여받는다.

## 파일

| 파일 | 내용 |
|---|---|
| `branch_identity.json` | branch id/ref/생성시각/비용·마감 게이트 |
| `parent_pre_axes.json` / `parent_post_axes.json` | 부모 13축 checksum (v2 규칙, 세션 전/후) |
| `m13_defacl_evidence.json` | step 33·38 전후 defacl 및 트리거 함수 ACL 실측 |
| `branch_state_final.json` | 중단 시점 branch 상태(비교 불가 라벨 포함) |
| `baseline_parts_manifest.json` | 188 조각 분해(파일·섹션·바이트·md5) |
| `replay_manifest.json` | 62 단계(version·경로·바이트·md5) |
| `checkpoints.txt` | slice 별 checkpoint, 편차, 보안경고 판정 |

## 남은 작업 (다음 세션)

1. augmented replay 39~62 (신규 branch 필요 — 이 branch 는 삭제됨)
2. 부모↔branch 13축 동등성
3. PR #60 왕복(forward/fixture15/rollback/md5·ACL 복원/reapply)
4. 그 뒤에야 PHASE B(Strategy A repair 후 재현) 자격이 생긴다
