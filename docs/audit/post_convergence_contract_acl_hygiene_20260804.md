# 수렴 후속 — 계약 도구 복구 · IQ RPC 실행권한 위생 (2026-08-04)

앱 수렴 PR #42 병합 이후의 **웹·DB 후속 위생** 작업 기록이다. 앱 코드·버전·Play·
production 은 이 작업 범위가 아니다. 선행 정본: `docs/audit/full_contract_convergence_result_20260804.md`.

## A. 기준점

| 항목 | 값 |
|------|-----|
| 앱 PR #42 | **merged** (merge commit `08c0caa`, PR head `d08a858`, merged 2026-08-04T03:29:56Z) |
| 앱 master | `08c0caa6d1697d06bd1aeac5dcdf664959408466` (PR #42 병합 포함) |
| 앱 PR #42 CI | success (`analyze · test · appbundle`) |
| 웹 시작 main | `1c6059c141c301d0a680aff9f9deeab61f892de3` |
| 웹 작업 브랜치 | `claude/post-convergence-contract-acl-hygiene-20260804` (main 기준) |
| staging project | `lbeqxarxothkmzqvpudy` (production 아님) |

## B. superseded 앱 PR 정리

관계: #38 + #39 + #40 → #41 → #42. 네 PR 모두 head SHA 가 task 제공값과 정확히 일치하고,
현재 `origin/master` 의 **조상(ancestor)** 이며 `git cherry origin/master` 미병합 등가 커밋 **0건**
(squash/재작성 없음 — 전 커밋이 master 이력에 존재). 기능 표면도 master content 에서 확인:
#38 게시판 create RPC·직접 INSERT 제거, #39 잔액 보유 탈퇴 동의·strict parser, #40 질문방
신고·차단·BLOCKED mapper, #41 ACCOUNT_NOT_ACTIVE·게시글 수정 RPC·vc 통합.

| PR | head | 포함 검증 | 조치 |
|----|------|-----------|------|
| #41 | `1dc5e61` | ancestor + cherry 0 + 기능표면 | comment + **closed** |
| #38 | `bd4bd49` | ancestor + cherry 0 + 기능표면 | comment + **closed** |
| #39 | `8ec1a7f` | ancestor + cherry 0 + 기능표면 | comment + **closed** |
| #40 | `98f2927` | ancestor + cherry 0 + 기능표면 | comment + **closed** |

- **직접 병합 0**: master 의 유일한 merge-into-master 커밋은 `08c0caa`(#42) 뿐이다.
  `8fa0705`/`67bdc2c`/`f41885c` 는 PR #41 통합 브랜치 **내부**의 `--no-ff` 결합 커밋으로,
  master 로의 직접 병합이 아니다.
- **GitHub 자동 표기 주의**: #42 병합으로 네 PR 의 head 커밋이 master 조상이 되며, GitHub 이
  `merged:true` 로 **자동 표기**(closed_at=merged_at=03:29:58, #42 병합 2초 후)했다. 이는
  ancestry 자동 감지이지 별도 merge 액션이 아니다. remote 브랜치는 삭제하지 않았다.

## C. WEB-TOOLING-001 — 계약 도구 추적 복구

- **원인**: `package.json` 의 `contracts:export`·`contracts:verify` 가 참조하는
  `scripts/contracts/*` 가 `.gitignore` 의 `scripts/*` 광역 규칙에 걸려 미추적 →
  CI checkout(추적 파일만 존재)에서 모듈 부재로 실패.
- **복구**: 파일은 로컬 디스크에 미추적 상태로 존재 → 정본 snapshot 구조·package script
  계약과 대조 후 사용(재구현 아님). §7.3 안전 계약에 맞춰 하드닝:
  - `contract_snapshot_query.sql` — SELECT/카탈로그 전용(DML/DDL 0), 함수 body_md5·grant·
    policy hash 만(민감 row 미반환).
  - `export_remote_contract.mjs` — `--input`(egress 차단 환경)·`--out` 지원, 기본 출력은 OS
    임시 경로(committed 미덮어쓰기), 읽기전용 psql(`default_transaction_read_only=on`),
    atomic rename + 실패 시 partial 제거, 최상위 키 결정론적 순서, 비밀값 미출력.
  - `verify_remote_contract.mjs` — offline(스냅샷 존재·ledger↔source parity) + online semantic
    diff, 판정 IDENTICAL/METADATA_ONLY_DRIFT/SEMANTIC_DRIFT(후자만 non-zero), 스냅샷 복사 금지.
- **.gitignore**: `scripts/*` 유지 + `!scripts/contracts/`·`!scripts/contracts/**` 예외만 추가
  (다른 `scripts/**` 는 계속 차단).
- **회귀 가드**: `lib/contracts/__contract__/contractToolingPresence.contract.test.ts`
  (script 존재·참조 파일 실재·SQL write 문 0·gitignore 예외·node --check·기본 미덮어쓰기·
  drift non-zero·비밀 미출력).

## D. DB-GRANT-HYGIENE-001 — iq_append_message 실행권한 최소화

- **대상**: `public.iq_append_message(p_question_id uuid, p_body text)` (overload 1건, exact).
- **사전 상태**(staging read-only 실측): SECURITY DEFINER, `proacl=NULL`(기본 PUBLIC EXECUTE),
  anon/authenticated/service_role EXECUTE 모두 true. `prosrc_md5=81aa22313dc8ad3054c2a25310f75e7c`,
  `functiondef_md5=fb6d27a2dddd8066a36cb19258804c3a`, `search_path=public`, owner postgres.
- **migration**(권한만): `revoke all privileges ... from public, anon` +
  `grant execute ... to authenticated, service_role`. 본문·인자·반환형·SECURITY DEFINER·
  search_path 미변경(CREATE OR REPLACE 없음). 정합 표준 = M2 가 `shortform_view_record_v2` 에
  적용한 위생과 동일. forward `supabase/sql/20260804035019_iq_append_message_execute_acl_hardening.sql`,
  rollback `supabase/rollback/20260804035019_..._rollback.sql`.
- **사후 상태**(staging read-only 실측): anon EXECUTE **false**, authenticated·service_role
  **true**, `proacl = postgres|authenticated|service_role`. `prosrc_md5`·`functiondef_md5`·
  secdef·args·returns·search_path **전부 불변**. 타 함수(qna_append_message,
  answer_individual_question 등) ACL 불변.
- **rollback 검증**: effective PUBLIC EXECUTE 의미 복원(카탈로그 NULL 직접 UPDATE 아님).

## E. staging

| 항목 | 값 |
|------|-----|
| ledger version | `20260804040019` |
| ledger name | `20260804035019_iq_append_message_execute_acl_hardening` |
| 적용 횟수 | 정확히 1회 |
| ledger rows(총) | 55 → **56** |
| business data write | **0** (ACL DDL + ledger 1행만) |
| Auth/Storage/notification/삭제 job mutation | 0 |
| production | 미접촉 |

## F. snapshot · 파리티

- 이전 snapshot sha256: `fb1c454218d3b5041626fcdd7dff926481b6a3c4369e75790ff652cf1c2cfc90`
- 현재 snapshot sha256: `c2fb49f11165198939488f82edf4561ffc782845b8ef4c2bfb6217c95e8b05a0`
- 갱신 방식: 복구한 exporter 로 staging 실측 재수출(`--input` = staging 쿼리 출력) → committed 교체.
  **수동 편집 아님**.
- 허용 diff(정확히 2건): `iq_append_message.execute` `["-"]`→`["authenticated","service_role"]` ·
  migrations +1행. 그 외 함수 body/ACL·table grant·policy·view·publication·bucket **변화 0**.
- 비허용 diff 수: **0**.
- verify(committed vs staging): **VERDICT: IDENTICAL**. source/applied parity OK(56).

### Gate 3 (웹 branch ↔ staging)
`WEB_BRANCH_STAGING_CONTRACT_PARITY: PASS` · `MIGRATION_LEDGER_PARITY: PASS` ·
`UNAPPLIED_WEB_MIGRATIONS: 0` · `UNSOURCED_STAGING_MIGRATIONS: 0`(strict-era; 23 legacy-era 는
정책상 경고 유지).

### Gate 4 (앱 master ↔ 변경 계약)
앱은 authenticated 세션으로 `iq_append_message(p_question_id, p_body)` 호출(반환 jsonb strict).
authenticated EXECUTE 유지 · signature/return 불변 · anon 의존 없음 →
`APP_MASTER_WEB_STAGING_CONTRACT_PARITY: PASS` · `APP_CODE_CHANGES_REQUIRED: NO`.

## G. 테스트

| 검사 | 결과 |
|------|------|
| `npx tsc --noEmit` | 0 error |
| `npm run lint` | 0 error |
| `npm run test:contract` | **380/380 pass** (신규 tooling presence 7 + iq ACL guard 3 포함) |
| `npm run build` | PASS |
| `node --check` exporter/verifier | PASS |
| `npm run contracts:export` (`--input`) | PASS |
| `npm run contracts:verify` (offline / online) | parity OK / **IDENTICAL** |
| 로컬 migration 왕복 | baseline→forward→rollback→re-forward→clean 전부 PASS; body md5·secdef·search_path·signature·return 불변; anon 거부·authenticated 허용·BODY_REQUIRED 게이트 실증 |

## H. 산출물 · 미실행

- 커밋 3: (1) 계약 도구 추적 복구 (2) iq_append execute ACL 하드닝 (3) snapshot 갱신 + 본 문서.
- **미실행(범위 밖)**: PR merge · production 배포 · 앱 코드/versionCode · Play 업로드 · release AAB ·
  계정 삭제 worker · 함수 본문 변경 · 타 함수 권한 변경 · production DB 접근.
