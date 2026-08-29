# TZ-FIX R2 세션 보고서 — S2 16건 (#2~#17) + #27 승격

> **지시서**: TZ-FIX v1 §3 (2026-08-29) + **v1.1 각주 보정** (① 신규 SQL pack 등재를 R2 화이트리스트에 포함해 같은 PR에서 완결 ② 브랜치 `claude/tz-fix-r2`, R1 머지된 main에서 분기)
> **근거**: `docs/audit/timezone_audit_20260829.md` 버그표 #2~#17·#27 · §6 R2 · **브랜치**: `claude/tz-fix-r2` (origin/main `87e52d1` = R1 머지본에서 분기) · **세션일**: 2026-08-29

---

## 1. 처리 항목·파일 전수

### 1-1. 신설 (§1-2)

| 파일 | 내용 |
|---|---|
| `lib/utils/kstTime.ts` | 지시서 §1-2 원문 그대로 신설 — `formatKoDateTimeKst` · `kstDayString` · `kstDayDiff` · `kstMonthStartInstant`. 다른 신규 파일 없음 |
| `lib/utils/__contract__/kstTime.contract.test.ts` | KST 00:30 / 08:59 / 09:00 / 23:59 경계 4시각 × 각 함수 (4 test) |

### 1-2. G1 — 공지 저장+표시 동시 수정 (#2 · #27, 같은 커밋)

| # | 파일 | 내용 |
|---|---|---|
| #2 | `lib/admin/adminNoticesMutations.ts` | `toTimestamptzOrNull`: 공백 검사 후 datetime-local(`YYYY-MM-DDTHH:mm`) 정규식 검증 → `${t}:00+09:00` 부여. 오프셋(+, Z)·초 포함 값은 그대로 통과. 소비처 무수정 |
| #27 | `lib/admin/adminNoticesQueries.ts` | `formatTs` 본문을 `formatKoDateTimeKst` 위임 (P-A), slice 분기 삭제. 콜사이트(periodLabel·createdLabel) 무수정 |

### 1-3. G2 — 기간 필터 경계 (#3)

- `lib/cash/cashQueries.ts`: `fromTs`/`toTs` → `T00:00:00+09:00` / `T23:59:59.999+09:00`.
- `components/cash/WalletLedgerPageBody.tsx`: '직접설정' 분기 재필터 동일 오프셋 + 서버·클라 상호 참조 주석. (**#36 프리셋 분기는 R3 지시대로 이번 회차 무수정** — G7 규정에 따라 보고.)

### 1-4. G3 — 월 경계 집계 (#4~#8, P-D)

| # | 파일 | 내용 |
|---|---|---|
| #4 | `lib/mentor/mentorPayoutsService.ts` | `ymKey` 본문 → `kstYearMonth` 위임 (currentYm·inYm 자동 정상화) |
| #4 | `lib/mentor/dashboard/mentorHubDashboardQueries.ts` | hub `monthLabel` → `kstYearMonth(now)` 기반 |
| #4 | `lib/mentor/mentorSettlementService.ts` | **무수정** — 감사 ref :88은 이미 `kstYearMonth` (감사 시점 da88acf 원문과 현행 바이트 동일 확인, 구 로더와의 대조 앵커로 인용된 것) |
| #5 | `app/(mentor)/mentor/mypage/page.tsx` | `monthKey` → `kstYearMonth` 위임, 5개월 버킷 시드 → `listRecentYearMonths`, 조회 gte 하한 → `kstMonthBounds(...).fromIso` |
| #6 | `lib/mentor/mentorPayoutsQueries.ts` | `monthBounds()` 본문 → `kstMonthBounds(kstYearMonth(now))` 위임. 함수명·반환 형태 유지 |
| #7 | `components/cash/WalletChargeRightSidebar.tsx` | `monthStart` → `kstMonthStartInstant(now)` |
| #8 | `app/(mentor)/mentor/individual-questions/page.tsx` | 연·월 비교 → `kstYearMonth(released_at) === kstYearMonth(now)` |

**#6 파급**: `lib/mentor/settlementPeriodTotals.ts` 소비 + 계약테스트 `settlementPeriodTotals.contract.test.ts` — **실행 결과 6/6 통과, 기대값 갱신 불필요(0건)**. 경계가 인자 주입식이라 UTC 값을 고정한 기대치가 없었다. §6에 경계 의미 변화 기재.

### 1-5. G4 — 표시 계층 (#9 #10 #11 #12 #13)

- **#9** `lib/cash/ledgerRowDisplay.ts`: `formatKoDateTime` Intl 옵션에 `timeZone: "Asia/Seoul"` 1키 추가 (지시 명시 P-A 변형). 소비처 4곳 무수정.
- **#10** `lib/notifications/notificationRowDisplay.ts`: `formatNotificationTime` toLocaleString에 `timeZone` 추가 (short 포맷 유지).
- **#11** grep `Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short" })` → **정확히 19파일 히트** (지시 예상과 일치). 각 로컬 포매터의 **가드(빈 값·파싱 불가)는 바이트 그대로 두고 마지막 Intl 라인만 `formatKoDateTimeKst` 위임** — 콜사이트·JSX 무수정. 전수:
  1. `app/(admin)/admin/(console)/community-content/page.tsx`
  2. `app/(admin)/admin/(console)/custom-request-orders/page.tsx`
  3. `app/(admin)/admin/(console)/disputes/[id]/page.tsx` (인라인 JSX 1곳 — `formatKoDateTimeKst(f.createdAt)` 치환)
  4. `app/(admin)/admin/(console)/mentor-activity/page.tsx`
  5. `app/(admin)/admin/(console)/refunds/page.tsx`
  6. `app/(admin)/admin/(console)/reports/[id]/page.tsx`
  7. `app/(admin)/admin/(console)/settlements/page.tsx`
  8. `app/(admin)/admin/(console)/users/page.tsx`
  9. `app/(mentor)/mentor/academic-record-change/page.tsx` (**#32 — R2 선처리**)
  10. `app/(mentor)/mentor/verification/page.tsx` (**#32 — R2 선처리**)
  11. `components/admin/AdminAcademicRecordChangeWorkspace.tsx`
  12. `components/admin/AdminContentReportsTable.tsx`
  13. `components/admin/AdminMentorApprovalWorkspace.tsx`
  14. `components/admin/AdminReviewsTable.tsx`
  15. `components/mentor/MentorReviewsManage.tsx`
  16. `lib/admin/adminCaseNotes.ts`
  17. `lib/admin/adminUnifiedActivityLog.ts`
  18. `lib/cash/ledgerRowDisplay.ts` (#9로 처리 — timeZone 키)
  19. `lib/disputes/disputeListQueries.ts`
  치환 후 잔존 패턴(무 timeZone) 0 grep 확인.
- **#12** `communityShortformQueries.ts` · `communityBoardQueries.ts` · `communityQueries.ts`: 폴백 포매터 3본 `timeZone` 추가 (각자 포맷 유지). `communityQueries.ts:268`은 347 포매터의 소비처라 자동 해소.
- **#13** `lib/auth/accountStatus.ts`: `formatUntil` → `formatKoreanDate` 위임 (YYYY.MM.DD 포맷 동일), **null 반환 가드 유지**. 소비처 내부 2곳 무수정.

### 1-6. G5 — SQL 알림 본문 (#14) + v1.1 pack 등재

- `supabase/sql/186_tz_fix_mentor_notification_body_kst.sql` (신규): 라이브 원문 기준 `mp_notify_activity_transition` replace.
  - **멱등 키 보존**: `v_date_key` 산출식(UTC `YYYY-MM-DD`)·`v_key` 조립식 2곳 **바이트 불변** (자가 diff 증적 §4).
  - **본문 날짜만**: `v_body_date` 변수 신설 → `notification_date_label(coalesce(NEW.termination_effective_at|pause_until, now()))` (157 정본) — 본문 2곳 치환.
- **v1.1 각주①**: `supabase/baseline/post_ledger_backfills/20260829100200_tz_fix_mentor_notification_body_kst.sql`(186과 바이트 일치) + `build_native_baseline_migration.py`·`build_native_migration_pack.py` 재생성(`supabase/migrations/20260829100200_…` + manifest, generator-owned 96 → 97). `validate_native_migration_pack.py` **PASS** · `validate_replay_manifest.sh` **PASS** · 3사본 `cmp` 일치.
- MCP `apply_migration` 미사용(역수입 절차 비발동) — 적용은 머지 후 `db-apply-pending`.

### 1-7. G6 — 게이트 (#15 #16 #17)

- **#15** `lib/auth/minorAgeGate.ts`: `todayParts` 본문 → 정본 `kstTodayParts`(`lib/identity/age.ts`) 위임. `parseBirthDateParts` 무수정. 소비처(`signupValidation.ts`·`signup/page.tsx`) 무수정 — 둘 다 버그 당사자. **#37(isFutureBirthDate)도 todayParts 경유라 함께 해소됨** (R3에서 잔여 확인만).
- **#16+#17** `lib/mentor/mentorActivity.ts`: `canRequestNormalRest`의 `setMonth` 산술 → **R1 정본 `addMonthsClampedKst(now, −6)` 재사용** (P-F 동일 산술 — §1-1 중복 구현 금지 원칙, 신규 파일 0). `setMonth` 코드 잔존 0 grep 확인. SQL `103`은 무수정 (comment 메타데이터뿐).
- 계약테스트 신설 `lib/mentor/__contract__/mentorActivityRestKst.contract.test.ts`: 지시 3케이스(2026 평년 2월 경계 · 8/31 −6개월 = 2/28 clamp · KST 08:59/09:01 분기) + 기존 계약(null/파싱불가 허용) 유지 확인.

## 2. 드리프트/미처리 항목

- **드리프트: 0건.** #2·#3·#4·#5·#6·#7·#8·#9·#10·#11·#12·#13·#14·#15·#16·#17·#27 전건에서 감사 「대표 근거 인용」 라인 원문 일치 확인 후 수정.
- **미처리(무수정) 항목**: ① `lib/mentor/mentorSettlementService.ts` — 감사 시점부터 이미 KST 정본 사용(대조 앵커), 수정 불요. ② `WalletLedgerPageBody.tsx`의 프리셋(1/3/6개월) 경계 = **#36, R3 담당** — G7 규정("어느 쪽이든 보고")에 따라 R3로 남김.

## 3. 계약 테스트: 기준선 → 최종

| 시점 | build | lint | 계약 테스트 |
|---|---|---|---|
| 기준선 (origin/main `87e52d1`) | PASS | PASS | **564 pass / 0 fail** |
| 최종 (수정 후) | PASS | PASS | **572 pass / 0 fail** (564 + kstTime 4 + mentorActivityRestKst 4) |

- 신규 실패 0. **기존 테스트 기대값 갱신 0건** — §5에 사전 신고된 `settlementPeriodTotals`는 실행 결과 6/6 통과로 갱신 불요(경계 인자 주입식), 월 산술 고정 테스트는 R1의 `subscriptionMonthKst`뿐이며 무접촉.
- 신설 테스트는 구 구현에서 실패함(판별력)을 별도 검증 — §7.

## 4. 라이브 대조·SQL 증적 (#14)

라이브(staging `lbeqxarxothkmzqvpudy`) 접근은 **읽기 전용 조회만** (`pg_get_functiondef`·md5). 역수입 절차 비발동.

- 라이브 `mp_notify_activity_transition` def md5 `11b614c5a2acd21558f2e0684f7a9101` (2,215 B) · body md5 `6997d4cc0929bb72a2d29ee4f17eb5a9` (2,043 B) — **저장소 158의 함수 본문과 바이트 단위 일치** 확인 → 186은 그 바이트에서 기계 치환으로 생성(수기 전사 0). 헤더 재구성도 md5 일치.
- 자가 diff: 추가 3라인(`v_body_date` 선언 1 + 대입 2) + 본문 문자열 2라인 치환 — **그 외 전 라인(멱등 키 2곳 포함) 바이트 불변**.
- 라이브 `notification_date_label` 존재 확인(157 정본, def md5 `adf5b5bcdef8a96eda25fb845ffcfb0d`) + replay baseline(`20260701000000`)에도 포함 — CI 리플레이 선행성 충족.
- 로컬 PostgreSQL 16.13 실행 검증: 186 적용 성공(SECURITY DEFINER 유지), KST 새벽 케이스(UTC 8/28 15:30 = KST 8/29 00:30)에서 본문 라벨 `2026년 8월 29일` vs 구 UTC 키 날짜 `2026-08-28` — 하루 보정 확인, null → `예정일`.

## 5. 스코프 가드 출력 원문 (§0-4)

```
$ git diff --name-only 87e52d1..HEAD
app/(admin)/admin/(console)/community-content/page.tsx
app/(admin)/admin/(console)/custom-request-orders/page.tsx
app/(admin)/admin/(console)/disputes/[id]/page.tsx
app/(admin)/admin/(console)/mentor-activity/page.tsx
app/(admin)/admin/(console)/refunds/page.tsx
app/(admin)/admin/(console)/reports/[id]/page.tsx
app/(admin)/admin/(console)/settlements/page.tsx
app/(admin)/admin/(console)/users/page.tsx
app/(mentor)/mentor/academic-record-change/page.tsx
app/(mentor)/mentor/individual-questions/page.tsx
app/(mentor)/mentor/mypage/page.tsx
app/(mentor)/mentor/verification/page.tsx
components/admin/AdminAcademicRecordChangeWorkspace.tsx
components/admin/AdminContentReportsTable.tsx
components/admin/AdminMentorApprovalWorkspace.tsx
components/admin/AdminReviewsTable.tsx
components/cash/WalletChargeRightSidebar.tsx
components/cash/WalletLedgerPageBody.tsx
components/mentor/MentorReviewsManage.tsx
docs/audit/tz_fix_r2_report_20260829.md
lib/admin/adminCaseNotes.ts
lib/admin/adminNoticesMutations.ts
lib/admin/adminNoticesQueries.ts
lib/admin/adminUnifiedActivityLog.ts
lib/auth/accountStatus.ts
lib/auth/minorAgeGate.ts
lib/cash/cashQueries.ts
lib/cash/ledgerRowDisplay.ts
lib/community/communityBoardQueries.ts
lib/community/communityQueries.ts
lib/community/communityShortformQueries.ts
lib/disputes/disputeListQueries.ts
lib/mentor/__contract__/mentorActivityRestKst.contract.test.ts
lib/mentor/dashboard/mentorHubDashboardQueries.ts
lib/mentor/mentorActivity.ts
lib/mentor/mentorPayoutsQueries.ts
lib/mentor/mentorPayoutsService.ts
lib/notifications/notificationRowDisplay.ts
lib/utils/__contract__/kstTime.contract.test.ts
lib/utils/kstTime.ts
supabase/baseline/native_migration_pack_manifest.tsv
supabase/baseline/post_ledger_backfills/20260829100200_tz_fix_mentor_notification_body_kst.sql
supabase/migrations/20260829100200_tz_fix_mentor_notification_body_kst.sql
supabase/sql/186_tz_fix_mentor_notification_body_kst.sql
```

→ R2 화이트리스트(§3 말미: kstTime 신규 · G1~G6 명시 파일 · #11 grep 19파일 · 신규 SQL 1본 · 계약테스트 2본 · 보고서) + **v1.1 각주①로 승인된 pack 등재 산출물 3본**의 부분집합. 금지 목록(§0-3) 파일 무접촉 — 특히 157·158·103 무수정.

## 6. §5 매트릭스 대비 신규 발견 파급

1. **#6 경계 의미 변화 (값 방향은 정상화)**: `monthBounds().end`가 「당월 말일 23:59:59.999(UTC)」에서 「익월 1일 00:00:00(+09:00)」으로 바뀌었다. 소비처 `aggregateSettlementTotalsInPeriod`는 양끝 포함 비교이므로, **정확히 익월 1일 00:00:00.000 KST instant에 생성된 행이 당월에도 집계되는 이론상 경계**(1ms 미만 창)가 생긴다. 당월 단일 조회라 실질 영향 없음 — 정밀 반개구간 전환은 후속 회차 후보로 기록.
2. **계약테스트 러너 제약 발견**: `node --test`는 `@/` 경로 별칭을 해석하지 못하므로, 계약테스트 의존 그래프에 속한 파일(`accountStatus.ts`·`mentorActivity.ts`)의 신규 import는 상대경로(`.ts` 확장자)로 작성했다(기존 관례와 동일 — `accountStatus.ts`의 기존 상대 import 참조).
3. 그 외 **0건** — 버그표 밖 소비처 파급은 §5-2 예고분(#6 · #22/#24는 R3) 외 신규 없음.

## 7. 검증 (기계 검증 요약)

- 신설 `kstTime` 4 test·`mentorActivityRestKst` 4 test 포함 전 계약 572/572 PASS, build·lint PASS.
- SQL 186: 라이브 원문 재구성 md5 일치 → 기계 치환 → 자가 diff(본문 날짜 외 불변) → 로컬 PG 16.13 실행 검증 (§4).
- #11 치환 후 잔존 무-timeZone 패턴 0 grep · `setMonth` 코드 잔존 0 grep · 구 함수명 잔존 0 grep.
- 독립 적대적 검증 완료 — **반증 실패(REFUTED: no), blocker 0건**:
  1. diff 전 hunk 리뷰: 위임·timeZone 키·KST 산술 패턴 외 변경 0, 금지 목록 무접촉 재확인.
  2. SQL 186 역방향 검증: v_body_date 3처 추가를 역치환하면 158 본문이 **바이트 단위 재현**(2,043 B). 로컬 PG 트리거 스모크: 멱등 키는 UTC 날짜(`…:2026-08-28`) 유지, 본문만 KST(`2026년 8월 29일`).
  3. 판별력: 신설 mentorActivityRestKst 3개 실질 케이스 전부 구 구현(origin/main)에서 실패, null/파싱불가 계약은 신구 동일(동작 보존).
  4. KST 산술 퍼즈: 4,800 instant(경계 시각 포함) × 실행 TZ 4종(UTC·Asia/Seoul·America/New_York·Pacific/Kiritimati)에서 kstTime 4함수가 독립 Intl 레퍼런스와 전건 일치. `canRequestNormalRest` 임계 ±1ms 2,200케이스 정확 일치.
  5. `toTimestamptzOrNull` 동작 표: 공백→null · datetime-local→`+09:00` 부여(PG 파싱 instant 검증) · 오프셋/Z/초/date-only 무변경 통과.
  6. `tsc --noEmit` 0 · eslint clean · 계약 572/572 재확인. 버그표 2차 근거 위치 전수가 수정된 공용 함수의 콜사이트임을 교차 확인(독립 잔존 0).

## 8. 후속 (사람 QA · R3)

- **기존 행 표시 유의 (§0-5 예정 사항)**: 배포 전 저장된 `app_notices`/`promotion_campaigns` 행은 +9h 오저장 instant를 유지하며, #27 표시 정상화로 관리자 화면에 그 오차가 **가려지지 않고 드러난다**(약 9시간 늦은 노출기간으로 보임). 지시서 §0-5(데모 데이터 −9h 백필 금지, 출시 전 초기화 전제)에 따라 보정하지 않음 — 데모 데이터 초기화로 해소.

- 사람 QA: QA-05~11·13~14 중 R2 해당분 (지시서 §6).
- R3 인계: #27·#32는 **R2 선처리 완료** — R3에서 확인만. #36은 R3 수행. #37은 #15로 사실상 해소 — R3에서 잔여 로컬 비교 확인만.
- DB 적용: 머지 후 `db-apply-pending` 1회 실행으로 `20260829100200`(#14) 적용 (R1의 `20260829100100`이 아직 미적용이면 함께 pending 차집합으로 적용됨).
