# PUSH-APPLY.md — App-F1 GRANT 적용 회차 증적 (2026-08-27, 오너 "적용 승인" 후)

> 대상 DB: Supabase `lbeqxarxothkmzqvpudy` (실제 라이브 프로덕션) · 브랜치 `claude/push-outbox-worker`(PR #82)
> 적용 대상: `20260827100100_device_token_register_grant` 1본 — `grant execute on function
> public.register_device_token(text, text) to authenticated;` (GRANT 1줄, 그 외 DDL 0 · 데이터 행 변경 0)
> 승인: 오너 명시 "B-1 GRANT 마이그레이션 적용 승인" · created_by = joseph@byite.co.kr
> 정본 source: `supabase/baseline/post_ledger_backfills/20260827100100_device_token_register_grant.sql`
> (md5 `b0f595c997e991c20c15713a15ebf5b9`, 848B, 말미 개행 1개)

## 0. 경로 교정 이력 (적용 전, 같은 PR)

최초 커밋(ecce84c)은 이 파일을 `supabase/migrations/`에 **손 배치**해 CI
`validate_native_migration_pack`이 FAIL했다(생성기 소유 디렉터리 규칙 위반). 45b5304 에서
`supabase/baseline/post_ledger_backfills/` 정본 경로로 `git mv` + `build_native_migration_pack.py`
재생성(마이그레이션 사본 byte 동일 · manifest 정확히 +1행)으로 교정 — 검증 PASS(files 94 ·
최종 version 20260827100100 · 생성기 `--check` 2종 PASS · manifest checksum 93/93 ·
`validate_replay_manifest.sh` PASS). 로컬 Windows 체크아웃이 autocrlf(CRLF)라 생성기·검증기는
LF 임시 worktree(`-c core.autocrlf=false`)에서 실행해 CI(Linux)와 byte 동일 산출을 확인했다.

## 1. 적용 경로 — db-apply-pending 워크플로 대체 사유

`db-apply-pending` workflow_dispatch(mode=apply, confirmation 정확 일치)를 **main ref**로
트리거(run **33034630422**)했으나 GitHub Environment `supabase-db-adoption` 사람 승인
게이트에서 **waiting** — 세션 내 승인 불가로 취소(conclusion=cancelled 확인). 승인됐더라도
main pack 에는 이 migration 이 없어 "pending 0본" 강제 종료가 예정돼 있었다(S-C-APPLY §1 과
동일 구조: S-B run 32428342011 · S-C run 32522812758 은 비-main ref 가 브랜치 정책으로 즉시
거부). → CLAUDE.md 명문화 폴백 **"MCP 직접 적용 + 원장 등재(authoring 은 저장소에 기존재)"**,
S-B/S-C-APPLY §1 선례 그대로:

- **사전 md5 프로브(SELECT)**: 적용 호출에 임베드할 dollar-quoted 리터럴을 DB에서 `md5()` —
  `b0f595c997e991c20c15713a15ebf5b9` / 848B == 로컬 `md5sum` **바이트 완전 일치** 확인 후 진행.
- **execute_sql 1호출 = GRANT 실행 + `supabase_migrations.schema_migrations` 등재**
  (begin…commit 원자). 등재 형식 선례 준수: statements = 파일 전문 1원소 배열(원장 바이트
  그대로 + 말미 개행), name = `device_token_register_grant`, created_by = 승인자 이메일.

## 2. 적용 결과 — 원장·바이트·권한 정합 (전부 라이브 실측)

- 원장: **93 → 94본**, 최신 `20260827100100`. `md5(array_to_string(statements,''))` =
  `b0f595c997e991c20c15713a15ebf5b9` / 848B / 1원소 배열 == 로컬 파일 (**바이트 정합**).
  name·created_by 등재값 실측 일치.
- `register_device_token(text, text)` EXECUTE: **postgres · service_role · authenticated**
  (`information_schema.routine_privileges` 실측 — GRANT 목적 달성. proacl 순서:
  postgres → service_role → authenticated).
- `revoke_device_token`: postgres · service_role 뿐 — **무변경**(B-8: authenticated GRANT 금지 유지).
- 데이터 행 변경 **0** — GRANT 는 카탈로그 전용이고, 쓰기는 원장 등재 1행(supabase_migrations
  스키마)뿐. 도메인 테이블 무접촉.

## 3. 같은 회차 후속 (B-1 의무)

### 3-a. contracts:export 재수출 → `contracts/snapshots/staging_contract.json`

- 커밋본(LF `d16a0ede72fa538f2c7127a5760a690d`, 151,320B — S-C 3-a 기록과 동일)이
  **py-json 파싱 순서 보존 직렬화(ensure_ascii=False, indent=2 + 말미 개행)로 바이트 재현**됨을
  먼저 증명(S-C 선례 동일).
- 재수출본 = 커밋본 + **functions +1**(`public.register_device_token` — args/returns/secdef/
  config/execute=[authenticated, service_role] 라이브 실측값, body_md5 null·비임계 함수) +
  **$.migrations +1**(jsonb 키 순서 name→version) — **151,750B, md5
  `a7f78283f53e22e850745f2036702f7d`**. functions 정렬(schema,name,args)·migrations version
  오름차순 불변식 검증.
- **의미 동등 증명(온라인 검증의 강화 대체, S-C 3-a 방법)**: 정본 쿼리
  (`contract_snapshot_query.sql`) 출력을 `::jsonb` 정준화한 텍스트의 md5를 서버에서 계산 —
  **`ac54d4da58f6b2cfd8ff40b3179fa2d6` (111,621자/111,727B)** — 재수출본을 동일 규칙(jsonb
  정준 키순서·`", "`/`": "` 구분자)로 정준화한 로컬 md5·문자수·바이트수와 **완전 일치**.
  **VERDICT: IDENTICAL (no drift)**. 참고: 정본 쿼리 pretty 출력 md5
  `3581148429d7d87dc2540d4ff2f4ff44`(189,706자)도 채록(적용 후 3회 조회 전 구간 동일 — DB 안정).
- `npm run contracts:verify`: **source/applied parity OK (94 ledger entries)** · exit 0
  (pack 내 20260827100100 소스 실재 대조).
- 환경 각주: 로컬 psql 부재 + `.env` 의 `SUPABASE_DB_URL` 자격 만료(28P01)로 온라인 export 는
  불가 — 위 정준화 md5 완전 일치가 온라인 검증을 대체한다(S-C 와 동일 상황·동일 방법).

### 3-b. 인벤토리 갱신 — `docs/audit/remote_db_inventory_20260804/functions.json`

- `register_device_token.acl` 에 `{authenticated, EXECUTE}` 추가 — 라이브 proacl 순서
  (postgres → service_role → authenticated) 그대로, 파일 직렬화 규칙(행 단위·무들여쓰기) 보존.
- 잔여 lag(고지, S-B 4-c·S-C 3-b 와 동일): 같은 디렉터리의 다른 축은 20260804 스냅샷 그대로.
  `functions_md5_nocr.tsv` 는 prosrc md5 라 GRANT 와 무관(무변경).

## 4. 미변경 확인

- 라이브 데이터 행 변경 **0** · GRANT 외 DDL **0** · `revoke_device_token` GRANT 금지 유지 ·
  `notification_transport_config` 무접촉(push_transport_enabled 는 여전히 postgres 전용, O-8 대기)
- 앱 계약: 앱(vc23)의 `register_device_token` RPC 호출이 이제 permission denied 없이 동작하는
  전제 충족 — 실기 확인은 O-9(앱 로그인 → `device_tokens` 행 생성) 합동 항목.
