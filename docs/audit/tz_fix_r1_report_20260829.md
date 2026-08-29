# TZ-FIX R1 세션 보고서 — 구독 +1개월 기간 산출 KST 교정 (버그표 #1)

> **지시서**: TZ-FIX v1 §2 (2026-08-29) · **근거**: `docs/audit/timezone_audit_20260829.md` 버그표 #1 · §6 R1
> **브랜치**: `claude/tz-fix-r1` (origin/main `da88acf`에서 분기) · **세션일**: 2026-08-29

---

## 1. 처리 항목·파일 전수

| 구분 | 파일 | 내용 |
|---|---|---|
| 신규 SQL | `supabase/sql/185_tz_fix_subscription_month_kst.sql` | 라이브 원문 기준 `confirm_subscription_checkout` + `process_subscription_renewal` 2본 replace — 월 산술 식만 KST 환산으로 치환 (같은 파일·같은 적용 단위, 감사 §6 R1 동시 배포 제약 준수) |
| TS 폴백 | `lib/subscribe/subscriptionsTable.ts` | `addMonthsClampedUtc` → `addMonthsClampedKst` 리네임 + P-F 산술(epoch+9h 분해 → 월 가감 → 말일 clamp → −9h 복원) 재작성. 구 함수 삭제(잔존 0 — grep 확인). 내부 헬퍼 `daysInUtcMonth` → `daysInCalendarMonth` 리네임(순수 달력 함수, 동작 동일) |
| 콜사이트 | `lib/subscribe/subscribeCheckoutService.ts` | import(15행)·`fallbackPeriodEndIso`(81행) 2곳 갱신. **전 저장소 grep으로 콜사이트 정확히 2곳뿐임을 수정 전·후 재확인** (`addMonthsClampedUtc` 잔존 0) |
| 신규 계약테스트 | `lib/subscribe/__contract__/subscriptionMonthKst.contract.test.ts` | 27케이스 — 2026년 12개월 각 1일 × KST 02:00/09:00 (24) + 월말 clamp 3 (1/31→2/28 · 3/31→4/30 · 8/31→9/30, KST 02:00) |
| 세션 보고서 | `docs/audit/tz_fix_r1_report_20260829.md` | 본 문서 |

grep 절차 도출분: 없음 (R1은 grep 화이트리스트 확장 절차가 없는 회차 — 콜사이트 확인 grep만 수행).

### SQL 185 치환 상세 (월 산술 식만 — 그 외 라인 라이브 원문 바이트 그대로)

- `confirm_subscription_checkout` 4곳: `now()+interval '1 month'` → `((now() at time zone 'Asia/Seoul' + interval '1 month') at time zone 'Asia/Seoul')` (insert values 2 + on conflict update 2)
- `process_subscription_renewal` 2곳: `v_period_start + interval '1 month'` → `((v_period_start at time zone 'Asia/Seoul' + interval '1 month') at time zone 'Asia/Seoul')` (신규 이벤트 분기 1 + coalesce 폴백 1)
- 무변경 확인: PAYMENT_STALE 30분 · grace 2일(순수 상대 간격) · 멱등 키(`sub_debit_…`, `idempotency_key`) · 함수 시그니처·반환 스키마 · SECURITY DEFINER · search_path

## 2. 드리프트/미처리 항목

- **드리프트: 0건.** 감사 「대표 근거 인용」 #1 (`131_p1_13_subscription_checkout_atomic.sql:93`) 및 068:119 인용 라인 원문 일치 확인. `subscriptionsTable.ts` 55~56행 원문도 감사 인용과 일치.
- **미처리 항목: 0건.**

## 3. 계약 테스트: 기준선 → 최종

| 시점 | build | lint | 계약 테스트 |
|---|---|---|---|
| 기준선 (수정 전, origin/main) | PASS | PASS | **561 pass / 0 fail** |
| 최종 (수정 후) | PASS | PASS | **564 pass / 0 fail** (561 + 신규 3 test/27 케이스) |

- 신규 실패 0. **기존 테스트 기대값 갱신 0건** — 구 UTC 월 산술을 고정한 기존 테스트 없음을 grep으로 확인(§5에 사전 신고된 2건은 R2 파일 대상이라 R1 해당 없음).

## 4. 라이브 대조 결과 (R1-3)

라이브(staging `lbeqxarxothkmzqvpudy`) 접근은 **읽기 전용 조회만** 수행했다 (`pg_get_functiondef`·md5·SELECT). DB 적용 없음 → CLAUDE.md hotfix 역수입 절차 **비발동** (baseline pack 무접촉).

### 4-1. 라이브 원문 기준 확인

| 함수 | 라이브 `pg_get_functiondef` md5 (2026-08-29 추출) | 크기 |
|---|---|---|
| `confirm_subscription_checkout` | `1c378160aec0e4d0a321da340e246b65` | 8,468 B |
| `process_subscription_renewal` | `ff4fb7f274d10a55be66ad3c554eb3d9` | 7,293 B |

- 감사 확정대로 라이브는 저장소 131·143·145·068·100보다 최신 상태였다(체크아웃은 anomaly 처리 포함 본, 저장소 구본과 md5 불일치). 구본 파일은 베이스로 쓰지 않았다.
- 라이브 2본의 전문이 `supabase/baseline/interleaves/20260804100002_as_applied_function_bodies.sql` 내 두 statement와 **바이트 단위 일치**함을 md5로 확인 → 185는 그 바이트에서 기계적 치환으로 생성(수기 전사 0). 자가 diff 결과 **변경 라인은 함수당 2라인(총 4라인), 전부 월 산술 식** — 헤더(인자·returns) diff 0 (R1-3-3 충족).
- 갱신 함수 본문의 CRLF 개행도 원문 그대로 보존.

### 4-2. 27케이스 TS ↔ 신규 SQL 식 패리티 (읽기 전용 SELECT 실측)

- 12개월 × KST 02:00/09:00 (24) + 월말 clamp 3 = 27케이스 전건에서 `addMonthsClampedKst` 산출 instant == 라이브 SELECT의 새 SQL 식 산출 instant (**27/27 일치**).
- 매월 `days_0200 = days_0900 = 해당 KST 월 일수` 확인 (예: 3월 결제 31 = 31, 2월 28 = 28). **KST 3/1 02:00 결제 = 3/1 09:00 결제 = 31일** — 버그표 #1의 증상(02:00 결제 28일) 해소를 실측으로 확인.
- clamp: 1/31 02:00 → 2/28 02:00 (2026 평년) · 3/31 → 4/30 · 8/31 → 9/30 (전부 KST 동시각 유지).

## 5. 스코프 가드 출력 원문 (§0-4)

```
$ git diff --name-only da88acf..HEAD
docs/audit/tz_fix_r1_report_20260829.md
lib/subscribe/__contract__/subscriptionMonthKst.contract.test.ts
lib/subscribe/subscribeCheckoutService.ts
lib/subscribe/subscriptionsTable.ts
supabase/sql/185_tz_fix_subscription_month_kst.sql
```

→ R1 화이트리스트(§2 R1-4)의 부분집합. 역수입 미발동이므로 baseline pack 산출물 없음. 금지 목록(§0-3) 파일 무접촉.

## 6. §5 매트릭스 대비 신규 발견 파급

**0건.** (#1 의도 파급 QA-01~04는 §6 사람 QA 체크리스트 대상.)

## 7. 적용 경로 메모 (후속 — 코드 아님)

- 185는 **저장소 표준 경로(`db-apply-pending`) 적용 전제**로 작성했다(파일 머리 주석 명시). 이 워크플로는 `supabase/migrations/` pack의 pending 차집합을 적용하므로, **적용 회차에서 185를 pack에 등재(timestamp version 부여 + `build_native_migration_pack.py` 재생성)하는 작업이 별도로 필요**하다. 이 등재 산출물은 R1 화이트리스트 밖(「역수입 시」 조건부)이라 본 세션에서는 수행하지 않고 기록만 남긴다 (§0-4 절차).
- MCP `apply_migration`으로 적용할 경우에는 CLAUDE.md 역수입 절차를 같은 세션에서 완수할 것.
- TS 폴백과 SQL 2본은 같은 배포로 나가야 한다(감사 §6 R1 동시 배포 제약 — 본 PR 1개에 동봉됨).

## 8. 적대적 검증 (세션 내 자체 검증)

4관점 독립 검증(SQL 치환 정합 · TS 산술 · 스코프 준수 · 테스트 판별력)을 수행했다. **4/4 반증 실패(전건 통과), blocker 0건.**

1. **SQL**: 185를 로컬 PostgreSQL 16.13에서 실제 실행 — 파싱·생성 성공, `at time zone`이 `+`보다 강하게 결합해 의도대로 파스됨을 문법 차원에서 확인, 시그니처·SECURITY DEFINER·search_path 불변, 세션 TZ(UTC/Asia/Seoul/America/New_York)와 무관하게 동일 결과. 감사 피벗 케이스(2026-03-01 02:00 KST)가 28일 → 31일로 교정됨을 실행으로 재확인.
2. **TS**: 독립 Intl(Asia/Seoul) 레퍼런스 대비 56,012케이스 퍼즈(2024~2033 임의 instant·경계시각·months 0/±1/±2/±6/±12/±25·윤년 clamp) 불일치 0. 로컬 PG 실측 5,769케이스 TS↔SQL 식 epoch(ms) 패리티 불일치 0. `tsc --noEmit` clean.
3. **스코프**: 변경 집합 = 화이트리스트 5파일과 정확히 일치, 금지 목록 무접촉. 185에서 KST 치환 6곳을 역치환하면 라이브 일치 baseline 본문이 바이트 단위로 복원됨을 역방향으로도 확인.
4. **테스트 판별력**: 구 `addMonthsClampedUtc`(git HEAD 원문)로 27케이스를 돌리면 3개 test 블록 전부 실패(첫 실패가 정확히 감사 버그 — 3/1 02:00 KST 28일), KST 09:00 케이스는 신구 모두 통과 — 회귀 판별력 확인. 기대값은 함수와 무관한 kstInstant 구성이라 동어반복 아님.
