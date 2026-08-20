# S-B-REPORT.md — 결제 스프린트 DB 마이그레이션 일괄 수행 보고

> 2026-08-20 · 세션: sprint-pay S-B v2 · 브랜치 `claude/sprint-pay-s-b-yrewf3`
> 대상 DB: Supabase `lbeqxarxothkmzqvpudy` (이름 "ssambership-staging" — **실제 라이브 프로덕션**)
>
> **상태: §5 적용 승인 게이트에서 정지.** DB 에는 SELECT 계열만 실행했고 DDL 은 미적용이다.
> 사용자가 정확히 "적용 승인"이라고 답한 경우에만 db-apply-pending 절차로 적용한다.

## 0. 브랜치 주기(注記)

지시서의 작업 브랜치는 `claude/sprint-pay-s-b` 이나, 세션 하네스가 지정·프로비저닝한 실제
브랜치는 **`claude/sprint-pay-s-b-yrewf3`** (origin/main 787fcd2 기준)이다. 모든 작업·푸시는
이 브랜치로 했다(하네스 지정 외 브랜치 푸시 금지 규칙).

## 1. 수행 내역

### §0 입력 확보
- `origin/claude/new-session-b6kool` 의 IMPACT.md(R1 감사, 272줄)를 `docs/sprint-pay/IMPACT.md` 로
  이관 — 작업 브랜치 첫 커밋. CLAUDE.md 마이그레이션 규칙(pack 절차·db-apply-pending) 숙지.
- ssambership-app 체크아웃 미제공 → **A1 재현은 IMPACT A1 판정 인용으로 대체** (§1 게이트 참조).

### §1 Phase 0 착수 게이트 — 전 항목 PASS
상세는 `docs/sprint-pay/S-B-GATE.md`. 요약: 원장 정합(리모트 85 = 로컬 85, diff 0 · 최신
`20260808092007`) · W1(사가 strict 관문 = 버킷 커버리지, user FK 레지스트리 부재, users 익명화
비삭제 — 테이블 4종 추가 무영향 실증) · B1/B2(v2→정본 confirm 위임·지갑 차감 내장·30분
PAYMENT_STALE·3자 일치·갱신 멱등키·funding 분기 후보 4곳 기록) · B5(SEMANTIC_DRIFT 경로와
부분-컬럼 INSERT 4지점 실측) · C2 잔여(DDL 이름 25종 × 6카탈로그 충돌 0 · pg_cron 설치 확인).

### §3 마이그레이션 7본 (authoring: `supabase/baseline/post_ledger_backfills/`)

| # | version | 내용 |
|---|---------|------|
| m1 | `20260820100100_nice_auth_tokens` | NICE 기관토큰 캐시(user FK 없음 — 사가 비대상) + pg_cron 일일 스윕 `nice_auth_token_sweep_daily`(16:20 UTC): 만료+1일 토큰 DELETE + identity_verifications stale pending(24h) → expired. 로컬 재생 가드(pg_cron 부재 시 skip — settlement 선례) |
| m2 | `20260820100200_identity_verifications` | 본인인증 결과(암호문 `*_enc` = `v1:`+base64(iv‖ct‖tag) AES-256-GCM, `di_hash` = HMAC-SHA256 hex — 평문 CI/DI/전화 컬럼 금지, raw jsonb 없음). verified 부분 유니크(di_hash)로 중복계정 차단. + `users.identity_verified_at`(nullable·무DEFAULT, 테이블 GRANT 승계로 클라이언트 SELECT 노출 인지·허용) + adg 가드 + `trg_iv_set_updated` |
| m3 | `20260820100300_billing_keys` | 포트원 빌링키(구독 전용). active 1키 부분 유니크. 평문 저장 결정("V2 API Secret 없이는 단독 사용 불가") 헤더 명기. + adg 가드 |
| m4 | `20260820100400_payments_refunds_pg_columns` | payments 8컬럼(pg_provider/pg_tx_id/pg_method/pg_receipt_url text, pg_paid_at timestamptz, pg_fail_code/pg_fail_message text, billing_key_id uuid FK→billing_keys — m3 후행 순서 보장) + refunds 2컬럼(pg_cancellation_id text, pg_cancelled_at timestamptz). **전부 nullable·무DEFAULT**(B5). 헤더에 external_id(Toss/내부)↔pg_tx_id(포트원 V2) 별개 도메인 매핑 규칙 + "#4 방어: pg_* 는 서버 확정 경로가 포트원 단건조회 값으로 전량 덮어쓴다(클라이언트 선입력 불신)" 명기 |
| m5 | `20260820100500_portone_webhook_events` | 웹훅 수신 원장. webhook_id UNIQUE 멱등. adg 비부착(감사 로그 성격 — 수신은 항상 성공; 자금 반영은 기존 adg_payments 가 차단) |
| m6 | `20260820100600_subscriptions_funding_source` | funding_source text(nullable·무DEFAULT) + CHECK(cash|pg) + 기존 행 전부 'cash' 백필 UPDATE(실측 2행 — 유일하게 허용된 라이브 UPDATE, 적용 시점 실행). "NULL 은 'cash' 로 해석(방어적)" 명기. 발화 트리거는 trg_subs_set_updated(updated_at)뿐이고 웹 정렬은 created_at — 무영향 실측 |
| m7 | `20260820100700_account_deletion_purge_identity_payment_artifacts` | 파기 RPC: SECURITY DEFINER·EXECUTE service_role 전용. identity_verifications·billing_keys 전행 DELETE(멱등), 삭제 전 active 빌링키 수 반환. **파기 게이트**: `account_deletion_write_blocked` 통과 시에만(오호출 NO_ACTIVE_DELETION 거부 — 과삭제 방지) |

- 신규 테이블 4종 전부 `account_deletion_jobs` 선례: **RLS enable + 정책 0 + anon/authenticated
  GRANT 0**(revoke all) = service_role 전용. Storage 버킷 신설 0 (절대 규칙 준수 — W1/B6 비발동).
- 각 파일 헤더: 설계 결정·매핑 규칙·**롤백 노트(대응 DROP 문 주석, 실행 금지)** 포함.

### §3-m7 웹 워커 배선 (`lib/account/`)
- `accountDeletionWorker.ts`: `DeletionDeps.purgeIdentityPaymentArtifacts` 신설,
  storage_purged 단계에서 **익명화(forfeit) 직전** 호출(파기가 익명화보다 앞서야 "익명 유저의
  실명 CI/DI 잔존" 반쪽 상태가 없다). active 빌링키 미해지 파기는
  `billing_keys_purged_without_revocation` marker 로그(userId 포함 — 수동 해지 조치용).
  `TODO(S-D): 포트원 빌링키 해지 API 를 DB 파기 앞에 삽입` 주석 명기.
- `accountDeletionAdapters.ts`: `makePurgeIdentityPaymentArtifacts`(비-ok → 예외 →
  record_error·backoff 재시도, fail-closed) + `buildDeletionDeps` 배선.
- 계약테스트: 시퀀스 고정 갱신 + 신규 3건(파기 실패 시 forfeit·finalized 진행 0 / marker 로그
  1건·meta 검증 / 정상 경로 무소음) + dry-run 파기 0회 단언.

### §4 리포 검증 — 전부 green

| 검증 | 결과 |
|------|------|
| `build_native_migration_pack.py` 재생성 + `--check` | PASS (generator-owned 91 = 기존 84 + 신규 7 · backfill 28) |
| `validate_native_migration_pack.py` | PASS |
| `validate_replay_manifest.sh` | PASS (STRATEGY_A_EXPECTED_SCHEMA_DIFF 0) |
| 생성기 결정론(재실행 git diff 0 — CI static 동등) | PASS |
| `validate_db_workflows.py` (+ --selftest) | PASS |
| `scan_repo_secrets.py` (+ --selftest) | PASS (249 files) |
| `npm run lint` | clean |
| `tsc --noEmit` | clean |
| `npm run test:contract` | **516/516 pass** (계정삭제 워커 42 포함) |
| `run_native_pack_replay.sh` (fresh PG16 + platform stub, psql 전량 재생) | **92본 전부 적용 OK** (신규 7본 = #86~92, open tx 0, 구조 실측 tables=84·buckets=13) |
| 단위 playwright 스펙 4종(account-status/refund-bracket/refund-sla/mentor-activity) | 21/21 pass |

미실행·사유: DB 를 쓰는 e2e(subscription-renewal-sim 등)는 공유 라이브 DB 대상 설계라
**승인 전 DB 쓰기 금지 규칙과 충돌 → 의도적으로 실행하지 않았다.** Supabase CLI runner 경유
PG17 재생은 CI `db-migration-pack-verify` 가 PR 에서 수행한다(psql 재생과 별개 증거 — 스크립트
주석 계약 준수).

## 2. 적용 계획 (§5 — 승인 후에만, 같은 회차 완료 의무)

1. CLAUDE.md db-apply-pending 절차로 7본 순차 적용 (m1→m7 version 순 — m3→m4 FK 순서 내장)
2. 즉시 `npm run contracts:export` 재수출 (미수행 시 `$.migrations` 길이 불일치 SEMANTIC_DRIFT hard fail — B5)
3. `docs/audit/remote_db_inventory_20260804/columns.json` 갱신 (compare_schema_inventory diff 방지)
4. 스키마 지문 절차 수행 → 결과 커밋 → `contracts:verify` green 확인

**롤백 노트**: 각 마이그레이션 파일 헤더에 대응 DROP 문을 주석으로 포함(실행 금지).
역순(m7→m1) 참고: m7 함수 DROP → m6 제약+컬럼 DROP → m5 테이블 → m4 컬럼(FK 포함) →
m3 테이블(m4 FK 선삭제 필요) → m2 테이블+users 컬럼+트리거 → m1 크론 unschedule+테이블.
단 m6 백필('cash')은 컬럼 DROP 으로만 되돌릴 수 있다(값 원복 불요 — 전부 NULL→'cash' 단방향).

## 3. 미해결·후속 TODO (S-C~F 인계)

1. **S-D: 포트원 빌링키 해지 API 삽입** — m7 파기 스텝의 DB 삭제 **앞에** 해지 호출을 넣을 것
   (현재는 해지 클라이언트 부재로 DB 파기만 — active 키 미해지 파기는 marker 로그로 추적 가능).
2. **14세 미만 정책 미결** — 현행 가입은 만 14세 미만 원천 차단(IMPACT #9). 보호자 인증 체인은
   가입 정책 변경 동반 필요 — 이번 스키마는 그 결정을 선점하지 않는다.
3. **NICE IP 전략 미확정** — NICE 측 IP 허용목록/고정 egress 요건 미확정. S-C 연동 전 결정 필요.
4. **funding_source 소비 분기 구현(S-C~E)** — 분기 지점 후보 4곳은 S-B-GATE.md [B1·B2] 절에 기록
   (갱신 배치 SELECT 2곳 + past_due 복구, DB 갱신 RPC status 가드 직후, 확정 RPC 호출 지점,
   NULL='cash' 해석).
5. **포트원 웹훅 수신 라우트(S-D)** — m5 는 저장소만. Standard Webhooks 서명 검증·adg_payments
   `ACCOUNT_DELETION_IN_PROGRESS` 예외 처리(IMPACT W5-(f))는 신규 구현.
6. **payments pg_* 컬럼 잠금 후속 검토** — #4 방어는 "서버 확정 경로가 전량 덮어쓰기" 규칙으로
   채택(m4 헤더). 컬럼 단위 GRANT 잠금은 채택하지 않았다 — S-D 확정 경로 구현 시 재평가.
7. **e2e(DB 쓰기) 스위트** — 적용 승인·CI 통과 후 운영 검증 회차에서 실행 권장.

## 4. 산출물

- PR: `claude/sprint-pay-s-b-yrewf3` → `main` (머지 금지 — 생성까지만)
- `docs/sprint-pay/IMPACT.md` (이관) · `docs/sprint-pay/S-B-GATE.md` · 본 보고서
- 마이그레이션 7본 + pack 재생성(91본) + 워커 파기 스텝 + 계약테스트
