# S2-9 / 최종 R0~R7 실행 — W2 병합 전 체크포인트 (오너 지시 운영창 종료)

작성일: 2026-07-31 (UTC) · 세션: 최종 R0~R7 실행 (트리거 "R0 실행 승인")
대상 project: `lbeqxarxothkmzqvpudy` (ssambership-staging — 운영 단일 DB) · DB artifact source: RC `0685b231f1729db72345eea0340e1fc7a1e9ca49`

> 오너 결정에 따라 이번 운영창은 **W2 병합 전에 중단**한다. 본 문서는 체크포인트 정본이다.
> W2 PR 병합·production alias 변경·W2 배포·M9·W3·R3·R4·운영창 연장은 이번 세션에서 수행하지 않았다.

---

## A. 실행 기준

| 항목 | 값 |
|---|---|
| 최초 운영창 시작 | 2026-07-31 **09:39:29 UTC** (18:39:29 KST) — 오너 문구 "R0 실행 승인" 접수 시각 |
| 운영창 종료 예정 | 2026-07-31 **13:39:29 UTC** (22:39 KST) — 연장 없음(오너 금지) |
| checkpoint 확정 | 2026-07-31 **13:09:40 UTC** 재캡처 기준 (문서 커밋 시각은 커밋 메타데이터 참조) |
| 저장소 HEAD (checkpoint 커밋 직전) | `9658d14` (M6 예외 승인 기록 커밋) ← base `0442ce63b6e7f313247f2f107b8da90784ccf6f7` |
| 작업 브랜치 | `claude/s2-8-r0-owner-gate-closure-m6w1md` (감사 브랜치 — 세션 전 구간 유지, W2 브랜치 checkout 0) |
| tracked working tree | `.claude/settings.local.json` 1건 수정 상태(오너 지시로 `apply_migration` 권한 1줄 추가 후 **미커밋 유지**) 외 clean. 제품 코드·migration·W2 브랜치 수정 0 |
| `.claude/settings.local.json` 미커밋 유지 | **YES** (본 checkpoint 커밋에도 미포함) |

## B. 완료 상태

| 게이트 | 판정 | 비고 |
|---|---|---|
| R0 | **PASS** (7/7) | git 게이트·동결·기준선 재캡처(§3.2 완전 일치·드리프트 0)·백업 24h(최신 2026-07-30 17:44:15 UTC, 나이 15h55m)·fixture 계정 확보·MC SHA 재검증·Data API 런타임 = Evidence B 일치 |
| R1 DB 8건 | **PASS** | M0 → M15 → M1 → **MC** → M13 → M4 → M5 → M6 전건 `apply_migration`(name=stem)·내장 게이트 전건 통과. D-1 해소(MC S1 경로)·M13 백필 3/3 |
| D-API-W | **PASS** | exposed schemas += `api_web_v1`·auto-expose ON→OFF(오너, 변경 전후 캡처)·런타임 PGRST106 열거 일치·V1/V3 200·V4 anon 42501 |
| W1 배포 | **PASS** | PR #48 merge commit(오너) → main `37da9e8` → production READY(58초)·smoke 전건 200·**댓글 결함 production 해소 실측**·15분 관찰 오류 0 → **R1 전체 완료 선언 (오너 조건 충족)** |
| M6 승인 예외 | **FAIL_ACCEPTED_OWNER_EXCEPTION** | 자가검증 DO 블록 3개소 중복 괄호 6자 — 기능·상태 영향 0 증명. 정본 기록: `docs/audit/s2_9_m6_applied_bytes_exception_20260731.md` (커밋 `9658d14`). APPLIED_BYTES_MATCH = PARTIAL_ACCEPTED_EXCEPTION_7_OF_8 → M7 이후 4건 전건 일치로 **11/12** |
| M7·M17 | **PASS + 바이트 게이트 일치** | M7 md5 `d8b18fd504052142e7e39a9ea628b644`(30,906B) · M17 md5 `4374f0c6b09aa9c611b57d34281451a9`(19,329B) = RC blob. 10분 관찰 PASS(오너 확인) |
| D-API-A | **PASS (재저장 1회 후)** | 1차 저장 미반영(PGRST106 지속 → BLOCKED 보고) → 오너 재저장 → 12:19:38 UTC 반영. 최종 노출 = `public, graphql_public, api_web_v1, api_app_v1` |
| api_app_v1 검증 | **PASS** | authenticated 실요청 200 (오너 통제 테스트 계정 세션) / **anon 42501** (`permission denied for schema api_app_v1` — ACL 경계 동작) |
| core_private | **PGRST106 거부 유지** | 전 시점 비노출 (checkpoint 재캡처 포함) |
| APP_UI_REMOTE_CANARY | **PASS** (오너 실기기) | Play 내부 테스트 versionCode 9 · D-API-A 반영 후 실행 · 로그인·읽기 화면 정상 · force-update wall·크래시 0 |
| DB Gate 4 canary | **PASS** (4/4) | F2 멱등(동일 room_id·created:false 2회) · F4 replay-first(동일 post_id·2회차 replay:true) · F5 UPDATE_CONFLICT · F6 soft-delete + already_deleted. fixture `s2_rollout_` 1행 생성 → 정리 1행 → 잔여 0 (posts 7·rooms 2 기준선 복원). 30분 관찰 오류 0 |
| M8·M14 | **PASS + 바이트 게이트 일치** | M8 md5 `249f12378f672e007c35760a66a64581`(15,995B) · M14 md5 `59397292484b3d9570e811a86607d203`(7,752B) = RC blob. 직후 게이트 내장 통과 · 10분 관찰 오류 0 |
| 관찰 창 종합 | **7창 전건 PASS** | Batch A 10' · Batch B 10' · Batch C 10' · W1 15' · M7/M17 10' · canary 30' · M8/M14 10' — 전 구간 Vercel 런타임 오류 0·smoke 200 (canary 종료 점검은 rate-limit 1회 후 재시도 성공 — 추정 PASS 없음) |

## C. 원격 상태 재캡처 (2026-07-31 13:09:40 UTC)

| 항목 | 값 |
|---|---|
| migration ledger | **43행** (31 baseline + S2 12) |
| S2 적용 순서 (ledger 실측) | M0 → M15 → M1 → MC → M13 → M4 → M5 → M6 → M7 → M17 → M8 → M14 (파일 stem 12건 — 정본 위상 순서와 정확 일치) |
| Exposed schemas | `public, graphql_public, api_web_v1, api_app_v1` (PGRST106 열거 실측) |
| Automatically expose new tables | **OFF** (오너 Dashboard 캡처 — D-API-W 시점 ON→OFF 전환) |
| Extra search path | `public, extensions` (기본값 유지 — 오너 캡처) |
| core_private | **미노출** — PGRST106 거부 실측 |
| 스키마 census | api_web_v1: view 5 + fn 12 · api_app_v1: view 1 + fn 5 · core_private: fn 5 (view 0) |
| production main SHA | `37da9e8dbacc7ff9698c5197b09e1fad188a8055` (PR #48 W1 merge — W2 미반영) |
| Vercel production | `dpl_9W4hWaWqGGYbeTH7Pus4hdPizJ8g` READY · alias `ssambership.com`·`www.ssambership.com`·`ssambership-web.vercel.app` — **W1 그대로, alias 변경 0** |
| W2 PR | **#49** · https://github.com/byite-co/ssambership_web/pull/49 · OPEN · base `main` · head `20b67e9f81183d8286a8baacbd907b515677bbe1`(정본 일치) · MERGEABLE / CLEAN |
| W2 미병합·미배포 확인 | main tip = `37da9e8` 불변 · production deployment = W1 빌드 유지 — **W2 병합 0·배포 0** |
| fixture 잔여 | **0** (`s2_rollout_%` 0행 · posts 7·rooms 2·comments 3 = 기준선) |
| runtime 오류·PGRST | Vercel 런타임 오류 0 (전 관찰 구간) · api_web_v1 V1 200 · PGRST106/002 잔존 오류 0 |
| 병합 안전성 근거 | tree(main `37da9e8`) = tree(W1 `609dafbd`) 동일 + W1 ⊂ W2 → 충돌 없는 merge commit 보장 |

## D. 명시적 잔여 작업 (순서 고정)

1. W2 PR #49 **merge commit** 병합 (squash/rebase 금지 · head `20b67e9f` 불변 확인 후)
2. Vercel production READY 도달 확인
3. W2 smoke(글 작성 F4 멱등·프로필 저장·정산계좌) + **15분 관찰**
4. M9 적용 — RC blob 직접 전달(canon SHA `3821e05f…`·42,068B) · 사전 F12 검사(succeeded 구독 결제 중 room 부재 건) · apply 직후 ledger md5 대조(기대 `5abb094e0c457330a1dd2a3b52285177`)
5. W3 PR(`602cc53d`) 생성 → merge commit 병합 → 배포 → smoke(소액 충전 F11 duplicate 재생·구독 확정 멱등) + **15분 관찰** — **차감 오류 1건 = 즉시 중단 + write freeze**
6. R3 직접 쓰기 0 증명 (pg_stat_statements + 정적 증거 — M11·M12 선행요건)
7. 조건 충족 시 R4: M11 → M12 (각 직후 게이트 + 10분 관찰)
8. 최종 감사문서·판정·push (이 브랜치의 미push 커밋 2건 포함 — 별도 승인 필요)

R5(M16)·R6(M10)·R7(W4)은 본 rollout 범위 밖 유지 (#10 미해소·오너 금지 — M16 선적용 금지·min_supported_build 변경 금지·Play production release 금지).

## E. 재개 계약

- 다음 세션은 **새 운영창 승인 없이 원격 쓰기 금지** (읽기 전용 재검증만 허용).
- 재개 시 본 checkpoint 기준선(§C)부터 read-only 재검증: HEAD·ledger 43행·노출 4스키마·auto-expose OFF·production `37da9e8`·PR #49 상태.
- W2 PR #49의 **base/head 불변 확인 후에만 병합** (head ≠ `20b67e9f` 시 중단·보고).
- rollback은 별도 오너 승인 필요 (§8 역순표 준수 · 제품 rollback 선행 원칙).
- 차기 승인 문구 (정확히 이 문구만 유효):

```
W2 병합 및 R2 잔여~R4 실행 승인 — 새 운영창 2시간
```

## 부록 — 금지 준수 확인 (이번 세션)

W2 병합 0 · production alias 변경 0 · W2 배포 0 · M9 적용 0 · W3 PR/병합 0 · R3 착수 0 · R4 적용 0 · 운영창 연장 0 · 관찰시간 단축 0 · 추정 PASS 0 · ledger 수정/삭제/repair 0 · execute_sql DDL 우회 0 · M6 rollback/재적용 0 · checkpoint push 0 · 추가 PR 0 (W2 PR #49는 오너 허용 범위 6 내 생성).
