# APPLY.md — 정산 원천징수 hotfix 적용 회차 증적 (20260827100200·20260827100300, 소급 작성)

> 대상 DB: Supabase `lbeqxarxothkmzqvpudy` (실제 라이브 프로덕션)
> 적용: **2026-08-27 별도 세션**(MCP `apply_migration` hotfix — 수정패키지 「정산 0원/원천징수 수정패키지」 §3)
> 증적 채록: **2026-08-29 소급**, 이 세션 라이브 실측 · 브랜치 `claude/new-session-jo2llo` (PR #84)
> 적용 대상 2본: `20260827100200_withholding_cash_unit_and_mentor_settlement_rpc` ·
> `20260827100300_mentor_settlement_rpc_v2_due_payouts_parity`

**소급 고지**: S-B·S-C 회차와 달리 적용 세션이 증적을 남기지 않아, 본 문서는 적용 2일 후
라이브 실측으로 소급 작성했다. 적용 시각·경위는 수정패키지 문서(§1·§3)와 원장 메타데이터에서
복원했고, 아래 프로브는 전부 2026-08-29 UTC 시점의 실측값이다.

## 1. 적용 경로 (소급 요약)

- 수정패키지 §3: MCP `apply_migration` 으로 prod 선적용된 **hotfix 클래스**. `apply_migration` 이
  자동 부여한 version(`20260827050921`, `20260827052542`)을 기존 규약(`YYYYMMDD1001…`)에 맞춰
  **`100200`·`100300` 으로 정정**(원장 메모). 두 마이그레이션의 검증 블록(DO)은 함수·grant
  구조만 SELECT 확인 — 실패 시 전체 롤백, 데이터 무의존.
- CLAUDE.md hotfix 역수입 규칙에 따른 저장소 역수입은 PR
  [#84](https://github.com/byite-co/ssambership_web/pull/84) 커밋 `9729aa8` 로 완료:
  `post_ledger_backfills` 등재 2본 → 생성기 재실행 → **pack 96본 = 원장 96본**,
  `validate_native_migration_pack.py`·`validate_replay_manifest.sh` PASS, CI pg17 fresh replay
  green (run 33046795597 — 구조 카운트 221/84/175/13 재현).

## 2. md5 프로브 대조 — 원장 ↔ 저장소 정본 (라이브 실측)

원장 총 **96본**, 두 version 모두 `statements` **1원소**, `created_by = 21jundragon@gmail.com`,
`idempotency_key = null`.

**바이트 관계(이번 회차 고유)**: S-B·S-C 는 파일 전문(말미 개행 포함)을 등재해 원장 md5 == 파일
md5 였으나, 이번 회차는 `apply_migration` 이 **말미 개행 없이** 등재했다. 저장소 정본
(backfill)은 CLAUDE.md 역수입 규칙대로 "원장 바이트 그대로 + 말미 개행 1" 이므로 프로브 식은
`md5(statements[1] || chr(10)) == 파일 md5sum` 이다.

| version | 원장 `md5(array_to_string(statements,''))` | 원장+개행 md5 == 파일 md5sum | bytes (원장 / 파일) |
|---|---|---|---|
| 20260827100200 withholding_cash_unit_and_mentor_settlement_rpc | `84ce93d90b71578a264e3eaa3ebf978f` | `f0ec5bd3067ade6da6f2aede4956d811` ✓ | 12,198 / 12,199 |
| 20260827100300 mentor_settlement_rpc_v2_due_payouts_parity | `e04440fd54f33a3b369a26689669aa08` | `32b44ed2376fb6184ab07b882e701a0a` ✓ | 11,841 / 11,842 |

sha256(파일) 교차 채록: `90b17a47d4795845d6ce0ff0b51fca246bd55b82a4398710a148e451eef89e17` ·
`710f0d0132b8886922558de56d1985240d53e8ca02b75845832540512ab148f3`
(수정패키지 첨부본·서버 `sha256(statements[1]||chr(10))` 계산값과 3자 일치).

## 3. 함수 프로브 — 신설 3종·본문 치환 2종 (라이브 실측)

| function | body md5(prosrc) | SECDEF | EXECUTE (anon/auth/svc) | calc 호출 | KST cutoff | 0.033 잔존 |
|---|---|---|---|---|---|---|
| calc_withholding_cents | `fa1ac64b083bcf9cf9e989ff65adb571` | ✗ | ✗ / ○ / ○ | (자신) | — | ○(정의 자체) |
| mentor_settlement_lines | `1df0625968aebbb848c9b6deca44ae64` | ○ | ✗ / ○ / ✗ | ○ | ○ | ✗ |
| mentor_settlement_summary | `cce884020b5c68ac0210c6018c60d1b7` | ○ | ✗ / ○ / ✗ | ○ | ○ | ✗ |
| pay_due_payouts_for_run | `c263c32fe1f9e51b67f7ae3d84a6a9c3` | ○ | ✗ / ✗ / ○ | ○ | ○ | ✗ |
| payout_reconciliation_report | `8ad35f24f6baa5532835c6c4f75195bc` | ○ | ✗ / ✗ / ○ | ○ | ○ | ✗ |

- 치환 2종(`pay_due_payouts_for_run`·`payout_reconciliation_report`)은 마이그레이션 검증 블록
  조건 그대로: `calc_withholding_cents` 호출 ○ · `at time zone 'Asia/Seoul'` ○ · 인라인 `0.033` ✗.
- 신설 RPC 2종은 `search_path=public` 고정 SECURITY DEFINER · authenticated 전용(anon ✗) —
  마이그레이션 GRANT 절과 일치. 기능 실측(테스트 멘토 2026-08: confirmed 0 · accruing
  148,665/4,905/143,760 · `calc_withholding_cents(14866500)=490500`)은 PR #84 본문 「검증」 참조.

## 4. 스키마 지문 (15축, 라이브 실측 2026-08-29)

```
tables=84            (불변)
columns=928          (불변 — S-C 값)
constraints=382      (불변 — S-C 값)
indexes=253          (불변)
views=1  triggers=99  policies=175  buckets=13   (불변)
functions=221        (218 → +3: calc_withholding_cents, mentor_settlement_lines, mentor_settlement_summary)
md5_tables=b1d9934382026e508a0657895e02d90a        (S-B 이래 유지)
md5_functions=c5db6928410b9e3302d736f2ffff883a     (변경 — 함수 +3·본문 치환 2, 회차 성격상 정상)
md5_function_acl=271d782966533ab94370f47b6a2ff6f3  (변경 — 신설 3종 GRANT; 직전 문서화 값은 S-C 42811686…이나 사이 B-1 회차(register_device_token GRANT)가 지문 미기록이라 단독 귀속 불가)
md5_policies=51071c281b290a140e81f1a9f622728a      (S-B 이래 유지)
md5_columns=57b193ea8e677eaafa94a14a8ebcb406       (S-C 값 유지)
md5_default_acl=691879ac99f0ee7480171c91896262e6   (S-B 이래 유지)
```

고정 기대치 4축(`verify_local_stack_state.sh`)은 **functions 218→221 갱신 필요** — PR #84 커밋
`9729aa8` 에서 델타 주석과 함께 반영 완료, CI pg17 replay 가 fresh 재생으로 동일 값 재현.

## 5. contracts:export 재수출 → `contracts/snapshots/staging_contract.json`

- 커밋본(B-1 회차, 원장 94본 시점 — md5 `a7f78283f53e22e850745f2036702f7d`, 151,750B)이
  **py-json 파싱 순서 보존 직렬화(indent=2 + 말미 개행)로 바이트 재현**됨을 먼저 재증명
  (S-B 4-a·S-C 3-a 선례와 동일).
- 재수출본 = 커밋본 + `$.migrations` **+2** + `$.functions` **+3**(신설 RPC — 섹션 멤버십
  실측 172 = 169+3, 그 외 드리프트 0) — **153,394바이트, md5 `ffd0890891f9d39a01b0a1b468318fe5`**.
  함수 3항목의 계약 형상(args/returns/SECDEF/config/EXECUTE)은 §3 표와 정합, `body_md5` null
  (critical 목록 비대상).
- **의미 동등 증명(egress 차단 — S-C 3-a "온라인 검증의 강화 대체" 선례)**: 정본 쿼리
  (`contract_snapshot_query.sql`) 출력을 `::text` 정준화한 텍스트의 md5 를 서버에서 계산 —
  **`5ea58314546189e755f82f0e5de6d81b` (112,943자)** — 재수출본을 동일 규칙(jsonb 정준
  키순서·`", "`/`": "` 구분자)로 정준화한 로컬 md5 와 **완전 일치**. jsonb 동등성은 verify
  스크립트의 semantic diff 와 동치이므로 **VERDICT: IDENTICAL (no drift)** 에 해당한다.
  참고: 정본 쿼리 pretty 출력 md5 `4cad05881eb32e102cc171f197890a04`(191,650자)도 채록.
- `npm run contracts:verify`: offline 파리티 **OK (96 ledger entries)** · exit 0.
- `npm run test:contract`: **561/561 PASS** (재수출 후 재실행).

## 6. 미변경 확인·잔여

- 라이브 데이터 행 변경 **0** (2본 모두 DDL·함수 치환·GRANT 뿐 — 검증 블록은 SELECT 만).
  Storage 버킷 신설 0 (buckets=13 불변) · Toss 캐시 생태계 무접촉.
- 인벤토리 `docs/audit/remote_db_inventory_20260804/columns.json` 갱신 불요(컬럼 변경 0).
- 잔여(수정패키지 §5 체크리스트 — 이 회차 밖): `payout_settings.scheduler_enabled` 활성 시점 ·
  `run_scheduled_payout('2026-09-23')` 호출 경로 · 지급 직전 `payout_reconciliation_report`
  최종 확인 · 가격 20원 단위 강제 여부 오너 결정(PR #84 「후속」).
