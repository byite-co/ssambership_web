# S2-9 최종 원격 rollout 실행 — R0~R4 완주 감사 정본

작성일: 2026-07-31 (UTC) · 대상: `lbeqxarxothkmzqvpudy` (ssambership-staging — 운영 단일 DB)
DB artifact source: RC `0685b231f1729db72345eea0340e1fc7a1e9ca49` · 감사 브랜치: `claude/s2-8-r0-owner-gate-closure-m6w1md`

> 트리거 "R0 실행 승인" (1차 창 09:39:29~13:39:29 UTC — W2 병합 전 체크포인트로 종료)
> + "W2 병합 및 R2 잔여~R4 실행 승인 — 새 운영창 2시간" (2차 창 13:14:56 UTC 기산).
> 체크포인트 정본: `docs/audit/s2_9_checkpoint_pre_w2_merge_20260731.md` (`196cada`) ·
> M6 예외 정본: `docs/audit/s2_9_m6_applied_bytes_exception_20260731.md` (`9658d14`).

---

## 1. 실행 결과 총괄 — R0~R4 전 단계 PASS

| 단계 | 내용 | 판정 |
|---|---|---|
| R0 | 동결·기준선 재캡처·복구 게이트 7건 | **PASS** (드리프트 0 · 백업 15h55m · fixture 계정 확보) |
| R1 | M0·M15·M1·**MC**·M13·M4·M5·M6 + D-API-W + W1(`609dafbd`→PR #48) | **PASS** (D-1 해소·댓글 결함 production 해소 실측) |
| R2 | M7·M17 + D-API-A + canary(DB Gate4 4/4 + 실기기) + M8·M14 + W2(`20b67e9f`→PR #49) + M9 + W3(`602cc53d`→PR #50) | **PASS** |
| R3 | 직접 쓰기 0 증명 — 런타임 delta 0(기준선 118→118) + 정적 증거(배포 트리 `f46ecb8` 사용자 세션 직접 쓰기 0 · service_role 의도 예외 4파일 = M11 목록과 일치) | **PASS** |
| R4 | M11 → M12 (baseline ACL 7종 게이트 → REVOKE ALL + GRANT SELECT → SELECT-only·컬럼 잔여 0 게이트) | **PASS** |

## 2. 원격 DB 최종 상태

| 항목 | 값 |
|---|---|
| migration ledger | **46행** = baseline 31 + **S2 15건** (name=stem 전건) |
| S2 적용 순서 (ledger 실측) | M0 → M15 → M1 → MC → M13 → M4 → M5 → M6 → M7 → M17 → M8 → M14 → M9 → M11 → M12 — **정본 위상 순서와 정확 일치** |
| 적용 바이트 정합 | **14/15 canon md5 완전 일치** · M6 1건 = 6자 편차 오너 승인 예외(FAIL_ACCEPTED_OWNER_EXCEPTION — 기능·상태 영향 0 증명) |
| Exposed schemas | `public, graphql_public, api_web_v1, api_app_v1` · auto-expose **OFF** · extra search path 기본값 |
| core_private | **비노출 유지** (PGRST106 — 전 구간 실측) |
| 스키마 census | api_web_v1: view 5 + fn 14 · api_app_v1: view 1 + fn 5 · core_private: fn 6 (외부 EXECUTE 0) |
| ACL 최종 | `mentor_profiles`·`mentor_plans` = anon/authenticated **SELECT-only(r)** · service_role 불변 · `community_posts` 불변(M16 범위 밖) |
| 미적용 (범위 밖 유지) | **M16·M10** — #10(OLD_APP_M16_CUTOFF_CASE B/C) 미확정 + 오너 금지. M10은 predecessor에 M16 포함으로 실행 불가 |

## 3. 웹 production 최종 상태

| 항목 | 값 |
|---|---|
| main | `f46ecb8` (PR #48 W1 → #49 W2 → #50 W3 — 전건 merge commit·squash/rebase 0·stage SHA ancestry 보존) |
| Vercel production | `dpl_7eC47xoJzvRKgb5xtW4zT2Szz2HK` READY · alias `ssambership.com` 외 — W3 코드 서빙 중 |
| 잔여 웹 단계 | W4(`b95f74ab`)·Batch F(`4ba9c00e`)는 **M10 이후 계약** — 이번 rollout 범위 밖 |

## 4. 관찰·smoke 총괄 (관찰 생략 0 · 추정 PASS 0)

| 창 | 시간 | 결과 |
|---|---|---|
| Batch A/B/C·M7/M17·M8/M14·R4(M11/M12) | 10분 × 5 | 전건 오류 0 |
| W1·W2·W3 배포 | 15분 × 3 | 전건 오류 0 · smoke 200 |
| canary (DB Gate4 + 오너 실기기 versionCode 9) | 30분 | 오류 0 · F2/F4/F5/F6 PASS · APP_UI_REMOTE_CANARY PASS |

**자금 smoke (W3)**: F11 신규 +100 cents(잔액 2,020,000→2,020,100) → duplicate 재생 잔액 불변·동일 ledger_id·해당 멱등키 원장 정확 1행 / F12 기존 결제(`26a6d1a4…`) 재생 `idempotent:true` — 잔액·ledger(12행)·anomaly(0) 전부 불변, 실제 결제 재실행 0. **차감 오류 0 — write freeze 미발동.**
잔존 기록: smoke 원장 1행(+100 cents, `cash-c04a…-1785505488`)은 append-only 계약(§8.5)상 보존 — 오너 테스트 계정(byite.co.kr student)의 정상 업무 데이터로 분류. 그 외 fixture 잔여 0 (`s2_rollout_` 0행·posts 7·rooms 2·comments 3 기준선).

**M11/M12 사후 실증**: F7 프로필 저장 `ok:true`(SECDEF 생존) · authenticated 직접 UPDATE 42501 거부(mentor_profiles·mentor_plans 모두) · anon SELECT 200 유지 · F8 밴드 밖 `PLAN_PRICE_OUT_OF_BAND` 정확 거부.

## 5. 프로세스 기록

- 적용 경로: 전 15건 `apply_migration` 단일 경로 · RC blob 바이트 사용 · **apply 직후 ledger md5 ↔ blob md5 대조를 단계 게이트로 수행** (M6 예외 이후 절차 강제 — 재발 0).
- execute_sql 사용 범위: 읽기 전용 검증·fixture 정리 DML(계약 #6)·통계 조회만 — DDL 우회 0.
- ledger 수정·삭제·repair 0 · rollback 실행 0 · 운영창 연장 0.
- D-API 변경은 전건 오너 Dashboard 수행(D-API-W 1회 · D-API-A 재저장 포함 2회) — 캡처 오너 보관.
- 테스트 세션: 오너 통제 계정 magiclink 발급 — 토큰 원문 미출력·미기록.

## 6. 잔여 작업 (이번 rollout 종료 후)

1. **R5 (M16)**: BLOCKED 유지 — 선행: OLD_APP_M16_CUTOFF_CASE(B/C) 확정(#10)·구버전 직접 쓰기 트래픽 관측 또는 강제 최소 버전 적용·오너 명시 승인. `min_supported_build` 변경 금지 유지.
2. **R6 (M10)**: M16 이후에만 (predecessor 15개 전건 필요).
3. **R7 (W4 `b95f74ab` → Batch F `4ba9c00e`)**: M10 이후에만.
4. Play production release 금지 유지 · 앱 단계적 출시·구버전 소멸 관찰은 별도 트랙.

## 7. 최종 판정

```
R0_GATE:                     PASS
R1_COMPLETION_GATE:          PASS (M6 오너 예외 반영)
R2_COMPLETION_GATE:          PASS
R3_DIRECT_WRITE_ZERO:        PASS (runtime delta 0 · 정적 0)
R4_COMPLETION_GATE:          PASS
APPLIED_BYTES_MATCH:         14_OF_15_PLUS_ACCEPTED_EXCEPTION (M6)
MIGRATION_LEDGER_STRUCTURE:  PASS (46행 · S2 15 · name=stem · repair 0)
DATA_API_STATE:              4_SCHEMAS_EXPOSED · AUTO_EXPOSE_OFF · CORE_PRIVATE_SEALED
PRODUCTION_WEB:              W3 (f46ecb8) · 런타임 오류 0
MONEY_PATH:                  F11/F12 LIVE · 차감 오류 0 · anomaly 0
PRODUCTION_WEB_COMMENT_DEFECT: CLOSED (M13+MC+W1 — production 실측)
READY_FOR_M16:               NO  (#10 미확정 — 변경 없음)
READY_FOR_R5_R7:             NO  (M16 종속)
S2_PRE_M16_ROLLOUT:          COMPLETE
```
