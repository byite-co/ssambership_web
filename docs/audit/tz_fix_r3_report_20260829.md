# TZ-FIX R3 세션 보고서 — S3 19건 (#18~#26, #28~#31, #33~#37) + 문서 2건

> **지시서**: TZ-FIX v1 §4 (2026-08-29) + **각주 3건** (① #25 SQL pack 등재 화이트리스트 포함 ② 브랜치 `claude/tz-fix-r3`, R2 머지본 분기 ③ G10에 `sla/page.tsx` 1건 추가 — #11 계열 변형)
> **근거**: `docs/audit/timezone_audit_20260829.md` 버그표 해당 행 · §6 R3 · **브랜치**: `claude/tz-fix-r3` (origin/main `2826714` = R2 머지본에서 분기) · **세션일**: 2026-08-29

---

## 1. 처리 항목·파일 전수

### G7 — 재파싱·필터 (#18 · #36)

| # | 파일 | 내용 |
|---|---|---|
| #18 | `lib/disputes/disputeListQueries.ts` | `AdminDisputeListItem`에 `createdAtIso: string` **additive 필드 추가**(원본 timestamptz ISO, 기존 필드 무수정) |
| #18 | `components/admin/AdminDisputesWorkspace.tsx` | 날짜 필터를 표기 문자열 재파싱(항상 Invalid → 전 행 필터 아웃)에서 `createdAtIso` 비교로, 경계 `T00:00:00+09:00`/`T23:59:59.999+09:00` |
| #36 | `components/cash/WalletLedgerPageBody.tsx` | 프리셋(1/3/6개월) 경계 — 로컬 자정 → KST 달력 −N개월(말일 clamp, **R1 정본 `addMonthsClampedKst` 재사용**) 후 KST 자정 instant. R2 G2 커밋과 충돌 없이 R3에서 수행(G7 규정대로 보고) |

### G8 — 일 경계·D-day (#19 #20 #21)

| # | 파일 | 내용 |
|---|---|---|
| #19 | `lib/admin/adminDashboardExtended.ts` | `dayKey` → `kstDayString`, 오늘/어제/7일 창 → KST 자정 instant + 24h 산술(P-E, KST 무DST) |
| #20 | `lib/mentor/dashboard/mentorHubDashboardQueries.ts` | `isCreatedToday` → `kstDayString(d) === kstDayString(now)` |
| #21 | `lib/customRequest/mentorCustomOrderBrowseDisplay.ts` · `lib/customRequest/studentPostDisplay.ts` · `lib/mentor/dashboard/mentorHubDashboardDisplay.ts` | 사본 3곳의 로컬 자정 절단 → `kstTime.kstDayDiff` 호출로 통합(신규 파일 0 — §4 규정) |

### G9 — ISO slice 표기 (#28 #29 #30, P-C)

| # | 파일 | 내용 |
|---|---|---|
| #28 | `lib/admin/adminQueries.ts` | `period_start/end` slice(0,10) → `formatKoreanDate` (부재 시 "" 유지) |
| #29 | `lib/admin/adminQueries.ts` | `완료:` slice(0,19) → `완료(KST): ${formatKoDateTimeKst(…)}` — 라벨에 KST 명시(지시대로) |
| #30 | `lib/mentor/mentorActivityActions.ts` | 토스트 복귀 예정일 slice(0,10) → `formatKoreanDate` |

### G10 — Intl/toLocale·로컬 getter 표기 (#22 #23 #24 #33 #34 #35 + 각주③)

| # | 파일 | 내용 |
|---|---|---|
| #22+#24 | `lib/customRequest/orderLifecycleConstants.ts` | `formatOrderRoomDate`(435)·`formatOrderRoomDateTime`(455) — P-B(epoch+9h → UTC getter), `YYYY.MM.DD (HH:mm)` 포맷 유지. **파급(§5-2 예고분)**: `OrderDeliverablesPanel`·`OrderDisputesPanel` 소비 화면도 표기 정상화 — QA-14 |
| #23 | `components/mentor/mypage/MentorActivityControls.tsx` | 로컬 `fmt` 삭제 → 호출부 4곳(44·46·113·127행) `formatKoreanDate` 교체 (감사 권고 그대로) |
| #24 잔여 | `lib/customRequest/mentorCustomRequestDisplay.ts` | `formatDateYMDOrDash` — P-B |
| #33 | `lib/notices/publicNoticesQueries.ts` | `formatDate` — P-A(`timeZone` 추가, '년 월 일' 유지) |
| #34 | `lib/mypage/studentActiveSubscriptions.ts` | `formatSubscriptionStartedAt` → 정본 `subscriptionDisplay.formatSubscriptionDate` 위임 (동일 포맷·Asia/Seoul). 소비처 같은 파일 236행뿐 확인 |
| #35 | `components/admin/AdminDashboardView.tsx` · `components/mentor/MentorProfileEditForm.tsx`(223행 — 238행 `suppressHydrationWarning` 지점의 표시원, 동일 처리) · `components/customRequest/CustomRequestStudentPostsList.tsx` | 각 포매터 `timeZone: "Asia/Seoul"` 추가. **refs 4파일 중 `AdminMentorApprovalWorkspace.tsx`는 R2 #11 선처리 완료 — 확인만(무수정)** |
| 각주③ | `app/(admin)/admin/(console)/sla/page.tsx` | `fmt`에 `timeZone` 추가 (P-A, #11 계열 변형 — R2 검수 발견분) |

### #31 — 지급 일정 위젯 (§4 화이트리스트 주의 준수)

- `lib/mentor/mentorPayoutsDisplay.ts`: `formatPayoutDateLabel`(로컬 getter → KST 벽시계+요일)·`buildPayoutScheduleInfo`(23일 판정·월 라벨·진행률 → `kstDateString`/`kstYearMonth`/`nextYearMonth`) **교체만** — orphan 코드 삭제 0.

### G11 — SQL·게이트 잔여 (#25 · #37) + v1.1 각주①

- **#25** `supabase/sql/187_tz_fix_consent_minor_age_kst.sql` (신규): 라이브 원문 기준 `handle_new_auth_user_consent_records` replace — `current_date` → `(now() at time zone 'Asia/Seoul')::date` **1곳만** (자가 diff 1라인). 멱등 키(`signup:…`) 무변경. R2 G5와 별개 파일이므로 **신규 번호 SQL 별도 1본**(같은 파일 합본 아님 — 보고서 명시 규정).
- **각주①**: `post_ledger_backfills/20260829100300_…`(187과 바이트 일치) + 생성기 재생성(migrations 사본·manifest, generator-owned 97 → 98) + `validate_native_migration_pack.py` **PASS** · `validate_replay_manifest.sh` **PASS**.
- **#37** `lib/auth/signupValidation.ts`: **자동 해소 확인 — 무수정.** `isFutureBirthDate`는 R2 #15에서 KST 정본이 된 `todayParts`(→`kstTodayParts`) 경유뿐이고, 파일 내 잔여 로컬 달력 비교 0 (grep: `getFullYear/getMonth/getDate` 0건).

### G12 — 문서·위생 (#26)

- `supabase/sql/153`·`156` **파일 머리 주석 1블록만** 추가("라이브는 20260827100200에서 KST 패치됨 — 재적용 금지") — **SQL 본문 무수정** (diff는 선두 주석 라인뿐).
- `supabase/sql/INDEX.md`에 미반영 31본(감사 시점 기준) 사실 + 153·156 재적용 금지 **1줄** 추가.
- **【선택】 모호 #1 (cron `parseAt` 무오프셋 400 검증): 미수행** — 순수 검증이지만 행동 추가이므로 §4 규정("미수행도 가능")에 따라 제외. `app/api/cron/**` 무접촉.

### 확인만 (R2 선처리)

- **#27** `adminNoticesQueries.formatTs` → `formatKoDateTimeKst` 위임 상태 확인 ✓ · **#32** verification/academic-record-change 2페이지 위임 상태 확인 ✓ — 본 회차 무수정.

## 2. 드리프트/미처리 항목

- **드리프트: 0건.** #18(:76)·#19(:83)·#20(:61)·#21(:66)·#22(:455)·#23(:16)·#24(:435)·#25(087:87 상당 라이브 식)·#28(:963)·#29(:1073)·#30(:51)·#31(:83)·#33(:26)·#34(:92)·#35(:41)·#36(:27) 인용 라인 원문 대조 후 수정.
- **미처리(사유 기록)**: ① 감사 #35의 파일 수는 8이나 버그표 refs가 4파일만 식별 — 지시 G10도 "4파일"로 한정. refs 밖 후보(예: `DisputeDetailView`·`MentorReviewsCarousel/List`·`payoutUi`·`individualQuestionFormat`의 timeZone 미지정 포매터 — R2 검수 스윕에서 관찰)는 **화이트리스트 밖이라 §0-4 절차대로 무수정·기록만** (후속 회차 후보). ② `mentorCustomOrderBrowseDisplay`·`mentorHubDashboardDisplay`의 `dateStr`(deadline 앞 10자)은 감사 판정 밖(마감값이 date-only 문자열이면 정확) — 무수정.

## 3. 계약 테스트: 기준선 → 최종

| 시점 | build | lint | 계약 테스트 |
|---|---|---|---|
| 기준선 (origin/main `2826714`) | PASS | PASS | **572 pass / 0 fail** |
| 최종 (수정 후) | PASS | PASS | **572 pass / 0 fail** |

- 신규 실패 0 · **기존 기대값 갱신 0건** · 신규 테스트 0건(§4 화이트리스트에 신규 계약테스트 없음 — kstDayDiff/kstDayString은 R2 kstTime 계약테스트가 이미 고정).

## 4. 라이브 대조·SQL 증적 (#25)

라이브(staging `lbeqxarxothkmzqvpudy`) 접근은 **읽기 전용 조회만**. MCP `apply_migration` 미사용 — 역수입 절차 비발동.

- 라이브 `handle_new_auth_user_consent_records` def md5 `833a94c880ea8000d049d67eb83a1f46` (3,300 B) · body md5 `86f4512b04f460f6e980e21ba5049cf8` (3,121 B, CRLF).
- **감사 경고대로 라이브는 저장소 087(3,044 B)보다 최신 패치 상태 — 087을 베이스로 쓰지 않았다.** 저장소에 바이트 일치 소스가 없어 base64 2분할 추출 → 로컬 재조립 → **md5·크기 전건 일치 확인** 후 기계 치환(수기 전사분은 md5 게이트 통과).
- 자가 diff: 변경 1라인(`current_date` 식) — 그 외 전 라인·CRLF·멱등 키 바이트 그대로. 헤더 재구성 md5 일치(시그니처·SECURITY DEFINER·search_path 불변).
- 로컬 PostgreSQL 16.13 실행: 187 적용 성공(secdef 유지). 의미 확인 — UTC 2026-08-28 20:00 instant의 판정 기준일이 구 `current_date`(UTC) `2026-08-28` → 신 KST `2026-08-29`.

## 5. 스코프 가드 출력 원문 (§0-4)

```
$ git diff --name-only 2826714..HEAD
app/(admin)/admin/(console)/sla/page.tsx
components/admin/AdminDashboardView.tsx
components/admin/AdminDisputesWorkspace.tsx
components/cash/WalletLedgerPageBody.tsx
components/customRequest/CustomRequestStudentPostsList.tsx
components/mentor/MentorProfileEditForm.tsx
components/mentor/mypage/MentorActivityControls.tsx
docs/audit/tz_fix_r3_report_20260829.md
lib/admin/adminDashboardExtended.ts
lib/admin/adminQueries.ts
lib/customRequest/mentorCustomOrderBrowseDisplay.ts
lib/customRequest/mentorCustomRequestDisplay.ts
lib/customRequest/orderLifecycleConstants.ts
lib/customRequest/studentPostDisplay.ts
lib/disputes/disputeListQueries.ts
lib/mentor/dashboard/mentorHubDashboardDisplay.ts
lib/mentor/dashboard/mentorHubDashboardQueries.ts
lib/mentor/mentorActivityActions.ts
lib/mentor/mentorPayoutsDisplay.ts
lib/mypage/studentActiveSubscriptions.ts
lib/notices/publicNoticesQueries.ts
supabase/baseline/native_migration_pack_manifest.tsv
supabase/baseline/post_ledger_backfills/20260829100300_tz_fix_consent_minor_age_kst.sql
supabase/migrations/20260829100300_tz_fix_consent_minor_age_kst.sql
supabase/sql/153_p2_25_pay_due_payouts_convergence.sql
supabase/sql/156_p2_25_payout_scheduler_foundation.sql
supabase/sql/187_tz_fix_consent_minor_age_kst.sql
supabase/sql/INDEX.md
```

→ R3 화이트리스트(G7~G12 명시 파일 · 신규 SQL 1본 · 세션 보고서) + **각주①로 승인된 pack 등재 산출물 3본** + **각주③ sla 1본**의 부분집합. 금지 목록(§0-3) 무접촉 — 087·157·158·103·131·143·145·068·100 무수정, 153·156은 머리 주석만.

## 6. §5 매트릭스 대비 신규 발견 파급

1. **#23 빈 값 표기**: 구 로컬 `fmt`는 파싱 불가 시 `""`, `formatKoreanDate`는 `"—"` — 4개 호출부 전부 존재 가드(`info.X ? … : ""`) 뒤라 실노출 차이는 파싱 불가 값일 때뿐(정상 데이터 무영향).
2. **#31 `nextPayoutDateIso` instant 이동**: 구 값은 서버 로컬 자정(UTC 배포 시 23일 00:00 UTC), 신 값은 **23일 00:00 KST** instant — 소비처는 orphan 위젯 + `formatPayoutDateLabel`(KST 표기)뿐, 값 정상화 방향.
3. 그 외 **0건** — §5-2 예고 파급(#22·#24의 Deliverables/Disputes 패널)은 예정대로 QA-14 확인 대상.

## 7. 검증 (기계 검증 요약)

- build·lint PASS · 계약 572/572 (기준선 동일, 신규 실패 0).
- pack 검증기 2종 PASS · 187 3사본 `cmp` 바이트 일치 · 로컬 PG16 실행 검증(§4).
- 독립 적대적 검증: 수행 중 — 완료 시 본 절에 결과를 추기한다(후속 커밋). 발견 사항 발생 시 수정 커밋을 같은 PR에 포함한다.
- CI 1차 실행에서 2건 실패 → 근본 수정 후 재푸시(`2174039`): ① Vercel 빌드 — #34 위임 시 `formatSubscriptionDate` 중복 import(기존 다중 import에 이미 존재, 로컬 빌드 캐시가 가려 미검출) 제거, 캐시 삭제 후 build·tsc·lint·계약 572/572 재검증 + 터치 파일 20본 중복 import 0 스캔. ② pack 생성기 결정론 — #26의 153·156 머리 주석이 baseline 재조립 소스로 유입되므로 생성기 2종 재실행 산출물(주석 2블록 + 체크섬·오프셋 메타데이터만 — diff 검수) 커밋. **§0-4 기록**: `pre_ledger_baseline.sql`·`native_baseline_source_map.tsv`·`native_baseline_manifest.json`은 화이트리스트 밖이나 #26(화이트리스트 내) 수정에 CI가 강제하는 생성기 소유 부수 산출물 — 표준 경로 재생성으로만 변경, 직접 편집 0.

## 8. 후속

- **TZ-FIX 3회차 완결.** 사람 QA: 지시서 §6 QA-01~15 전건 (특히 R3분: QA-12 분쟁 필터 · QA-13 '오늘' 카드 · QA-14 표기 스팟체크 · QA-10 생년월일 경계).
- DB 적용: 머지 후 `db-apply-pending` 1회 — pending 차집합 = `20260829100100`(R1 #1) · `20260829100200`(R2 #14) · `20260829100300`(R3 #25) 중 미적용 전량.
- 후속 회차 후보(스코프 외 기록): 감사 망 밖 timeZone 미지정 포매터 잔여분(§2), `monthBounds` 반개구간 정밀화(R2 보고서 §6-1), orphan 위젯(#20 KPI·#31 사이드바·#34 API 라벨) 정리.
