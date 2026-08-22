# S-C-APPLY.md — m8 적용 회차 증적 (2026-08-21, 사용자 "적용 승인" 후)

> 대상 DB: Supabase `lbeqxarxothkmzqvpudy` (실제 라이브 프로덕션) · 브랜치 `claude/new-session-nggfez`
> 적용 시각: 2026-08-21 20:2x~20:3x UTC · 승인: 사용자 명시 "적용 승인" (+ 지시 ①~④ 동시 처리)
> 적용 대상: m8 `20260821100100_identity_verifications_kind_guardian` 1본
> (승인 지시 ①·② 반영 후의 최종 바이트 — md5 `692031e03b5c9ad4431eaea131f21c50`, 4,664B, 커밋 1899491)

## 0. 승인 지시 ①~④ 처리 결과 (적용 전 반영)

| # | 지시 | 처리 |
|---|---|---|
| ① | di_hash base64url 확정 — m8에서 컬럼 COMMENT 정정 | m8에 di_hash 컬럼 COMMENT(base64url 무패딩) + 테이블 코멘트의 m2 'hex' 표기 폐기 추가. m2 파일은 원장 바이트 불변이라 무수정 — 정정은 m8 카탈로그 코멘트로만 |
| ② | /account/delete 게이트 예외 + tripwire 고정 | (student) 레이아웃 탈퇴 분기에서 게이트 제외(`!isAccountDeletePath && needsIdentityOnboarding`), `identityGateWiring.contract.test.ts`에 예외 고정 단언 추가. `/settings/blocks`는 종전대로 게이트 대상 |
| ③ | 팝업 pre-open 현행 유지 | 무변경 |
| ④ | guardian consent_version = 기존 관례 최신값 | `GUARDIAN_CONSENT_VERSION = MINOR_CONSENT_VERSION`(`legal-placeholder-2026-06-20`) 연동. **정합 확인 결과**: 최근 약관 개정(시행일 2026-07-12, `COMPANY.effectiveDate` — 약관·개인정보처리방침 공용)은 동의 버전을 승급하지 않았고, 라이브 `user_consent_records` 실측도 동 버전 단일(terms/privacy/marketing 각 7건, 최신 2026-08-09). 법무 문구 확정 시 `MINOR_CONSENT_VERSION` 승급에 자동 연동 |

재검증(①② 코드 변경 후): pack 재생성 + `--check` PASS · validator 2종 PASS · fresh PG16 전량 재생
93본 OK · 계약테스트 **543/543** · lint · tsc · build · 번들 시크릿 grep 0 — 전부 green 후 푸시(1899491).

## 1. 적용 경로 — db-apply-pending 워크플로 대체 사유

`db-apply-pending` workflow_dispatch(mode=apply, confirmation 정확 일치)를 작업 브랜치 ref로
트리거(run **32522812758**)했으나 **5초 내 failure** — S-B 회차(run 32428342011)와 동일하게
GitHub Environment `supabase-db-adoption`의 배포 브랜치 정책이 비-main ref를 러너 배정 전에
거부한다. main ref 실행은 pending 0본(m8이 main에 없음)이라 불가.

→ CLAUDE.md 명문화 폴백 **"MCP 직접 적용 + 같은 세션 역수입(이번엔 authoring이 이미 저장소에
있으므로 원장 등재만)"**, S-B-APPLY §1 선례 그대로:
- **사전 md5 프로브(SELECT)**: 적용 호출에 임베드할 dollar-quoted 리터럴을 DB에서
  `md5()` — `692031e03b5c9ad4431eaea131f21c50` == 로컬 `md5sum` **바이트 완전 일치** 확인 후 진행.
- **execute_sql 1호출 = DDL 전문 실행 + `supabase_migrations.schema_migrations` 등재**
  (begin…commit 원자). 등재 형식 선례 준수: statements = 파일 전문 1원소 배열(원장 바이트
  그대로 + 말미 개행), name = 파일명의 name부(`identity_verifications_kind_guardian`),
  created_by = 승인 사용자 이메일(S-B 7본과 동일 관행).

## 2. 적용 결과 — 원장·바이트·카탈로그 정합 (전부 라이브 실측)

- 원장: **92 → 93본**, 최신 `20260821100100`. `md5(array_to_string(statements,''))` =
  `692031e03b5c9ad4431eaea131f21c50` == 로컬 파일 md5 (**바이트 정합**).
- `identity_verifications.kind`: `text NOT NULL DEFAULT 'self'::text` (ordinal 20) +
  `identity_verifications_kind_check` (self|guardian)
- `identity_verifications_status_check`: `pending|processing|verified|failed|expired`
  ('processing' 포함 — CAS 락 개통)
- `identity_verifications_di_hash_verified_uniq`: `WHERE status='verified' AND di_hash IS NOT NULL
  AND kind='self'` (kind 한정 재정의)
- di_hash 컬럼 COMMENT: base64url 무패딩 문구 실재 (① 반영 확인)
- 데이터 행 변경 0 (적용 전 0행 재확인 — DDL·코멘트만)

## 3. 같은 회차 후속 (B5·W8 의무)

### 3-a. contracts:export 재수출 → `contracts/snapshots/staging_contract.json`

- 커밋본이 **py-json 파싱 순서 보존 직렬화(indent=2 + 말미 개행)로 바이트 재현**됨을 먼저 증명
  (S-B 4-a 선례와 동일 · 구 md5 `268eff5d83714f9df15e0c966b593f28`).
- 재수출본 = 커밋본 + `$.migrations` **+1**(m8 항목, jsonb 키 순서 name→version) — 151,320바이트,
  md5 `d16a0ede72fa538f2c7127a5760a690d`.
- **의미 동등 증명(온라인 검증의 강화 대체)**: 정본 쿼리(`contract_snapshot_query.sql`) 출력을
  `::jsonb` 정준화한 텍스트의 md5를 서버에서 계산 — **`88e9c9f6a3b3e7eae6267e165878c6f1`
  (111,311자)** — 재수출본을 동일 규칙(jsonb 정준 키순서·`", "`/`": "` 구분자)로 정준화한 로컬
  md5와 **완전 일치**. jsonb 동등성은 verify 스크립트의 semantic diff와 동치이며 중첩 순서까지
  포함하므로 **VERDICT: IDENTICAL (no drift)** 에 해당한다. 참고: 정본 쿼리의 pretty 출력
  md5 `28fee24a6cca71c412183429dcfb8f9a`(189,164자)도 채록.
- `npm run contracts:verify`: offline 파리티 **OK (93 ledger entries)** · exit 0
  (verify의 소스 파리티가 pack 내 m8 소스 실재를 확인).

### 3-b. 인벤토리 갱신 — `docs/audit/remote_db_inventory_20260804/columns.json`

- 988 → **989행** (+1: `identity_verifications.kind` ordinal 20, `'self'::text` NOT NULL —
  라이브 information_schema 실측값 그대로, 파일 직렬화 규칙(indent=0·무말미개행) 보존).
- 검증: identity_verifications 전 20행 정준화 문자열 md5 — 라이브 계산 == 로컬 갱신본 계산
  **`5cb2ff8825dd91846244f8d711715d67` 동일**.
- 잔여 lag(고지, S-B 4-c와 동일): 같은 디렉터리의 tables/constraints/indexes/… 축은 20260804
  스냅샷 그대로(지시서는 columns.json만 갱신 지시).

### 3-c. 스키마 지문 (15축, 적용 후 라이브 실측)

```
tables=84            (불변)
columns=928          (927 → +1 kind)
constraints=382      (381 → +1 kind CHECK; status CHECK는 drop+add 상쇄)
indexes=253          (불변 — di_hash 유니크는 동일명 재생성)
views=1  functions=218  triggers=99  policies=175  buckets=13   (전부 불변)
md5_tables=b1d9934382026e508a0657895e02d90a        (S-B 값 유지)
md5_functions=3bf1869e08603318b63069ff18a4b75b     (S-B 값 유지)
md5_function_acl=42811686af18c516975127b4997fea37  (S-B 값 유지)
md5_policies=51071c281b290a140e81f1a9f622728a      (S-B 값 유지)
md5_columns=57b193ea8e677eaafa94a14a8ebcb406       (bc8d… → 변경: +kind, DDL 회차 정상)
md5_default_acl=691879ac99f0ee7480171c91896262e6   (S-B 값 유지)
```

고정 기대치 4축(`verify_local_stack_state.sh`: tables 84 · functions 218 · policies 175 ·
buckets 13)은 전부 불변 — **CI 기대치 수정 불요**(부록 A 예측 실증). `run_local_stack_emulation`
STRICT 축은 런타임 상호 대조라 pack(93본) 기준으로 자체 수렴.

## 4. 미변경 확인

- 라이브 데이터 행 변경 **0** (m8 = DDL·코멘트만, identity_verifications 0행) · Storage 버킷 신설 0
- Toss 캐시 생태계·기존 RPC 무접촉 · `user_consent_records` 무변경(부록 A 결정 유지)
