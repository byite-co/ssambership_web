# S-B-APPLY.md — 적용 회차 증적 (2026-08-20, 사용자 "적용 승인" 후)

> 대상 DB: Supabase `lbeqxarxothkmzqvpudy` (실제 라이브 프로덕션) · 브랜치 `claude/sprint-pay-s-b-yrewf3`
> 적용 시각: 2026-08-20 23:2x~23:4x UTC · 승인: 사용자 명시 "적용 승인" (§5 게이트 통과)

## 1. 적용 경로 — db-apply-pending 워크플로 대체 사유

`db-apply-pending` workflow_dispatch(mode=apply, confirmation 정확 일치)를 작업 브랜치 ref로
트리거했으나(run 32428342011), GitHub Environment `supabase-db-adoption`의 **배포 브랜치 정책이
비-main 브랜치를 거부** — 러너 배정 0·스텝 0·2초 내 실패(환경 게이트 전 단계 거부).
main ref 실행은 pending 0본(마이그레이션이 main에 없음)이라 불가.

→ CLAUDE.md가 명문화한 대체 경로 **"MCP apply_migration(또는 CLI 밖 직접 적용) + 같은 세션
역수입"** 으로 전환. 단 apply_migration은 version을 적용 시각으로 재부여하므로(선례
`20260808080056`), authoring version(20260820100100~700)을 보존하기 위해 **execute_sql로
파일 SQL 실행 + `supabase_migrations.schema_migrations` 직접 등재**(마이그레이션당 1호출 =
DDL+등재 원자)를 택했다. 등재 형식은 원장 실측 선례를 따름: statements = 파일 전문 1원소
배열(20260808080056 선례와 동일), name = 파일명의 name부, created_by = 승인 사용자 이메일
(직접 적용 선례의 적용자 기록 관행).

> 후속 운영 제안: `supabase-db-adoption` environment의 배포 브랜치 정책에 작업 브랜치 패턴을
> 허용하거나, 적용을 main 병합 후로 규정하면 워크플로 경로가 복원된다(오너 결정 사항).

## 2. 적용 결과 — 원장·바이트 정합

- 원장: **85 → 92본**, 최신 `20260820100700`. 리모트 92 = 로컬 pack 92 (remote_only/local_only 0).
- **바이트 정합 7/7**: 각 version의 원장 `md5(array_to_string(statements,''))` == 로컬 파일 `md5sum` 완전 일치.

| version | md5 (원장 == 파일) |
|---|---|
| 20260820100100 nice_auth_tokens | `952bd0c76eae3059f8aa7888f8904034` |
| 20260820100200 identity_verifications | `518be72f8166cec64bcfa9bcc17ad485` |
| 20260820100300 billing_keys | `eaa77eb521fa0c75a5adda964a0a70c5` |
| 20260820100400 payments_refunds_pg_columns | `ff6e3f0cebc8bfc6f11905b508eee7bf` |
| 20260820100500 portone_webhook_events | `ee4bd202c646d8951c5ffa9e35669fad` |
| 20260820100600 subscriptions_funding_source | `e122b819c829edc12bc6d32bb8c69e9d` |
| 20260820100700 account_deletion_purge_identity_payment_artifacts | `d31830f94e284b317cc62d65c84ab2d0` |

## 3. 사후 스키마 검증 (라이브 실측 == 로컬 PG16 fresh replay 실측)

- 구조: tables **84** · functions **218** · policies **175** · buckets **13** (재생 기대치와 전 축 일치)
- m6 백필: `funding_source='cash'` **2행**, NULL **0행**
- payments pg_* 7컬럼 + billing_key_id, `users.identity_verified_at` 실재. 신규 트리거 3종
  (adg_identity_verifications·adg_billing_keys·trg_iv_set_updated) 부착.
- 신규 테이블 4종: RLS on · **anon/authenticated GRANT 0행**(information_schema.role_table_grants 실측)
- pg_cron: `nice_auth_token_sweep_daily` 등록(매일 16:20 UTC)
- m7 RPC probe: `account_deletion_purge_identity_payment_artifacts(null)` → `USER_ID_REQUIRED`
  (정상 — 데이터 무접촉 검증)

## 4. 같은 회차 후속 절차 (B5·W8 의무)

### 4-a. contracts:export 재수출 → `contracts/snapshots/staging_contract.json`
- 정본 쿼리(`contract_snapshot_query.sql`)를 라이브에 실행(SELECT), 출력 md5
  `1b987cc0793d805412a508f812ec99d7` 대조 후 export 정규화(2-space·개행 — 기존 커밋본이
  py-json 동일 직렬화로 바이트 재현됨을 먼저 증명)로 기록. 151,219바이트.
- **델타 분해**: S-B의 스냅샷 기여는 `migrations` +7 **뿐**. functions(164→168)·
  policies(178→175)·table_grants(127→129) 변화는 전부 **S-B 이전(0806~0807 백필 wave)
  미재수출 부채**였다(구 스냅샷은 원장 56본 시점 — 0802 이후 29본 미반영 상태로 방치).
  m7 함수는 스냅샷 비대상(service_role 전용 — 의도 실증), 신규 테이블 grant 행 0(의도 실증).
- `npm run contracts:verify`: offline 파리티 **OK (92 ledger entries)** ·
  `--input`(라이브 출력) 온라인 **`VERDICT: IDENTICAL (no drift)`** · exit 0.

### 4-b. verify 파리티 결함 수정 (`scripts/contracts/verify_remote_contract.mjs`)
- 잠복 결함: 소스 파리티 검사가 `supabase/sql/`만 탐색 — 0802 이후 authoring이
  interleaves/post_ledger_backfills/pack으로 이동한 뒤로는 재수출 즉시 오탐 hard fail
  (31본 "without source file"). 구 스냅샷이 0801 이전(56본)에서 멈춰 있어 드러나지 않았다.
- 수정: 탐색 대상을 `supabase/sql` ∪ `supabase/migrations`(통합 pack — build --check가
  source 동일성 강제) ∪ `supabase/baseline/post_ledger_backfills` 3곳으로 확장.
  수정 후 92본 전량 파리티 OK, legacy 경고 25건도 소멸.

### 4-c. 인벤토리 갱신 — `docs/audit/remote_db_inventory_20260804/columns.json`
- 933 → **988행** (+55: 신규 테이블 4종 43 + payments 8 + refunds 2 + subscriptions 1 + users 1).
- 검증: 영향 8테이블 전 행(126행)의 정준화 문자열 md5 — 라이브 DB 계산값과 로컬 갱신본
  계산값 **`d3729173b2775dbe18da33d89eb8541f` 동일**.
- 잔여 lag(고지): 같은 감사 디렉터리의 tables/constraints/indexes/functions/triggers/grants
  축은 20260804 스냅샷 그대로다(지시서는 columns.json만 갱신 지시). 차기 인벤토리 재캡처
  회차에서 전 축 갱신 권장.

### 4-d. 스키마 지문 (parent_schema_fingerprint 15축, 적용 후 실측)

```
tables=84
columns=927
constraints=381
indexes=253
views=1
functions=218
triggers=99
policies=175
buckets=13
md5_tables=b1d9934382026e508a0657895e02d90a
md5_functions=3bf1869e08603318b63069ff18a4b75b
md5_function_acl=42811686af18c516975127b4997fea37
md5_policies=51071c281b290a140e81f1a9f622728a
md5_columns=bc8d133b5245ddd3bfcff0424fe4f268
md5_default_acl=691879ac99f0ee7480171c91896262e6
```

(DDL 적용 회차이므로 지문 변경이 정상 — 전후 증적 용도. counts 축은 로컬 재생 기대치와 일치.)

## 5. 미변경 확인

- Storage 버킷 신설 0 (buckets=13 불변) · Toss 캐시 생태계·`cash-` orderId 규약 무접촉
- 라이브 데이터 변경 = m6 백필 UPDATE 2행이 전부(§ 절대 규칙 준수)
