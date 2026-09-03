# CLAUDE.md — 쌤버십 프로젝트 컨텍스트

> Claude Code·Cursor가 프로젝트 맥락을 이해하기 위한 단일 소스 문서입니다.

## 프로젝트 정의

쌤버십은 학생이 대학생 멘토를 구독하고, 멘토별 질문방에서 질문을 누적하며, 연결노트로 장기 학습 관리를 받는 **구독형 질문 멘토링 + 교육형 커뮤니티** 플랫폼입니다.

웹 본체: 랜딩 · 멘토 찾기 · 질문방 · 커뮤니티(게시판/숏폼) · 맞춤의뢰 · 캐시결제 · 마이페이지 · 멘토·관리자 콘솔

## 기술 스택

- **Frontend:** Next.js 16 (App Router) + React 19 + TypeScript + Tailwind CSS 4
- **Backend:** Supabase (Auth, Postgres, Storage, RLS)
- **결제:** 토스페이먼츠 (`@tosspayments/tosspayments-sdk`)
- **차트:** recharts (멘토 수익·정산 차트 — 관리자 대시보드는 PR-12 에서 차트 없이 오늘 할 일·현황·최근 활동 세 블록)
- **경로:** `D:\dev\ssambership_web`

## 브랜드 컬러 (변경 금지)

| 토큰 | 값 |
|------|-----|
| Primary | `#1A56DB` |
| Secondary | `#3F83F8` |
| Accent | `#F59E0B` |
| Success | `#10B981` |
| Danger | `#EF4444` |
| Background | `#F9FAFB` |

## 절대 잠금값

- **학생 네비:** 멘토 찾기 · 질문방 · 개별 질문 · 커뮤니티 · 맞춤의뢰 · 캐시결제 · 마이페이지
- **멘토 네비:** 질문방 · 맞춤의뢰 · 커뮤니티 · 캐시충전
- **요금제 표기:** 라이트(주4) / 스탠다드(주9, 추천) / 프리미엄(무제한 표기 · 내부 한도 999) — tier id: `limited` / `standard` / `premium`
- **가격(캐시/월, 카탈로그 기본 표시가):** 29,900 / 84,900 / 174,900 — 정본 `lib/subscribe/subscribePlanCatalog.ts` (멘토 플랜 행·권장가 조회가 모두 실패했을 때의 표시 폴백)
- **멘토 가격 밴드(min/권장/max, 캐시):** 라이트 29,900/29,900/69,900 · 스탠다드 84,900/84,900/149,900 · 프리미엄 174,900/174,900/329,900 — 정본 `lib/subscribe/mentorPlanPricing.ts`. **실차감액**은 `mentor_plans` 행 금액 → 없으면 권장가 순으로 결정
- **cap:** 가중치 라이트 1.0 / 스탠다드 2.25 / 프리미엄 4.75 · 멘토 한도 기본 50 — 정본 `subscription_cap_weight()` · `mentor_cap_limit()` (DB RPC, TS 사본 금지)
- **수수료(플랫폼 공제):** 구독 15% · 맞춤의뢰 5% · 개별질문 15% (멘토 수령 85/95/85)
- **질문방:** `mentor_student_rooms` → `question_threads` → `question_messages`
- **연결노트:** room 단위 (`connection_notes`)
- **커뮤니티:** 게시판(`community_posts`) / 숏폼(`shortform_posts`) 분리
- **리뷰:** 동일 멘토 2회 연속 결제 성공 후
- **캐시:** 1캐시 = 1원 · `balance_cents` ÷ 100

> **개정 2026-07-12 (XV-PRICE 확정):** 요금제 잠금값을 현행 웹 코드 기준으로 정본화했다. 표기 "베이직"→**"라이트"**, 단일 고정가(구 55,000/114,900/249,900) 체계를 폐기하고 **카탈로그 표시가 + 멘토 가격 밴드** 2층 구조로 전환(구 고정가 3종은 밴드의 **권장가·실차감 폴백**으로 존속). 이 개정 이전 값을 인용한 문서(`docs/architecture/purpose-report/*` 각주 등)는 당시 감사 스냅샷으로 그대로 둔다.
>
> **개정 2026-07-18 (권장가 하향):** 오너 확정으로 권장가를 라이트 29,900 · 스탠다드 84,900 · 프리미엄 174,900으로 변경(구 55,000/114,900/249,900 폐기). min은 권장가와 동일하게 하향, max와 카탈로그 표시가(프리미엄 179,000→174,900)도 정합화. 멘토 가격 저장 시 밴드를 서버에서 강제한다(경고만 하던 구 동작 폐기).
>
> **개정 2026-09-03 (DB-1 캡 구조):** 오너 확정으로 cap 가중치 1.0/2.5/4.5 → **1.0/2.25/4.75**, 멘토 한도 기본 28 → **50** (`supabase/sql/190_cap_structure_limit_50_weights.sql`, pack `20260903100100`). 정본은 DB 함수이며 `mentor_plans.cap_weight` 는 그 함수값을 따르는 참조 컬럼이다. 같은 배치에서 학교 인증 규칙(자동 판정 = `pending` 잠정, 관리자 확정 = `reviewed_by` 채움 · SQL 192)과 분쟁 분배 수수료(정산 행 `fee_rate` · SQL 191)를 함께 정본화했다.
>
> **개정 2026-09-03 (DB-2 등급 정정·소프트 삭제):** 오너 확정으로 학교 등급 자동 판정 폴백을 `미분류` → **`그외`**로 바꾸고(`미분류`는 대학명을 못 읽은 경우만 — `school_tier_suggest()` · SQL 193), 확정된 등급도 관리자가 같은 확정 RPC(`approve_mentor_school_verification_admin`)로 **정정**할 수 있게 했다(이전 등급·확정자는 `admin_action_logs` `school_tier_corrected`). 숏폼 · 숏폼 댓글 · 게시판 댓글(`shortform_posts` · `community_comments` · `comments`)은 게시판 글과 같은 **소프트 삭제(`deleted_at` · `deleted_by`)** 로 통일하고 하드 DELETE 를 트리거로 거부한다(SQL 194 · anon/authenticated 읽기 정책·뷰·RPC 에 `deleted_at IS NULL`). `school_tier_mappings` 는 제거(SQL 195). 적용 전 미분류 확정 19건은 `그외`로 일괄 정정.

## 라우트 구조 (실제)

```
/                              랜딩 (app/page.tsx)
/mentors                       멘토 찾기
/mentors/[mentorId]            멘토 상세
/subscribe                     구독
/question-room                 학생 질문방
/question-room/[roomId]        질문방 상세
/community                     커뮤니티 홈
/community/shortform           숏폼 목록
/community/shortform/[id]      숏폼 상세
/community/board/[id]        게시판 상세
/custom-request                맞춤의뢰
/wallet/charge                 캐시 충전
/wallet/ledger                 캐시 원장
/mypage                        마이페이지

/mentor/dashboard              멘토 대시보드
/mentor/question-room          멘토 질문방
/mentor/profile/edit           프로필 관리
/mentor/payouts                정산
/mentor/custom-request/dashboard  맞춤의뢰 대시보드

/admin/dashboard               관리자 대시보드
/admin/mentor-approval         멘토 승인
/admin/moderation              콘텐츠 검수
/admin/disputes                신고·분쟁
/admin/refunds                 환불
/admin/notices                 공지·이벤트
```

레거시 단축: `/dashboard` → 멘토/관리자 role별 redirect 페이지 참고

## 완료된 주요 UI (2026-05)

- 학생: 질문방 3단, 마이페이지, 랜딩, 구독·캐시결제, 멘토 찾기(필터/그리드)
- 멘토: 대시보드 KPI, 질문방 3단, 맞춤의뢰 대시보드, 프로필 편집
- 관리자: 대시보드(recharts), 멘토 승인, 콘솔 사이드바 240px
- 커뮤니티: 숏폼 v2, 게시판 v2

## 핵심 DB 테이블·컬럼 (확인된 패턴)

| 테이블 | 주요 컬럼 |
|--------|-----------|
| `users` | `id`, `role`, `full_name`, `nickname`, `email`, `grade_level` |
| `mentor_profiles` | `user_id`, `university_name`, `department_name`, `teaching_subjects`, `verification_status`, `avg_rating`, `review_count` |
| `subscriptions` | `student_id`, `mentor_id`, `plan_id`, `status` |
| `mentor_student_rooms` | `student_id`, `mentor_id` |
| `question_threads` | `room_id`, `title`, `status`, workflow 필드 |
| `question_messages` | `thread_id`, `body`, `author_id` |
| `connection_notes` | room FK, `body`, `status` |
| `comments` / `community_comments` | 게시판 댓글 정본 / 레거시·숏폼 댓글 — `deleted_at`·`deleted_by` (소프트 삭제 · DB-2) · `comments.is_deleted` = 숨김 OR 삭제 |
| `cash_wallets` | `balance_cents` (minor = 원×100) |
| `cash_ledger` | `delta_cents`, append-only |
| `custom_request_orders` | `mentor_id`, `title`, `status` |
| `shortform_posts` | `video_url`, `thumbnail_url`, `category`, `deleted_at`·`deleted_by` (소프트 삭제 · DB-2) |
| `content_reports` | 관리자 검수 큐 |

## Storage 버킷 (public = false 필수)

| bucket | 용도 |
|--------|------|
| `student-id-images` | 학생증 |
| `custom-order-deliverables` | 납품 파일 |
| `custom-request-post-attachments` | 의뢰 첨부 |
| `community-post-images` | 게시판 이미지 (signed URL) |
| `shortform-videos` / `shortform-thumbnails` | 숏폼 (signed URL) |

점검 SQL: `supabase/sql/039_storage_buckets_private_audit.sql`  
`SELECT id, name, public FROM storage.buckets ORDER BY id;`

## 마이그레이션 hotfix 역수입 규칙

MCP `apply_migration`(또는 CLI 밖 직접 적용)으로 비상 hotfix를 DB에 적용한 세션은 **같은 세션에서 저장소 역수입까지 완료해야 한다.** 원장(`supabase_migrations.schema_migrations`)에만 있고 저장소 pack에 없는 version은 `db-apply-pending`의 remote_only 가드를 hard fail시켜 DB 수정 경로 전체를 잠근다.

역수입 절차:
1. 원장에서 본문 추출 — `select statements from supabase_migrations.schema_migrations where version='<v>'`
2. `supabase/baseline/post_ledger_backfills/<원장version>_<name>.sql` 로 등재 (원장 바이트 그대로 + 말미 개행 1개, md5 대조)
3. `python3 scripts/verify/baseline/build_native_migration_pack.py` 재실행 (migrations 사본·manifest는 생성기 소유 — 직접 편집 금지)
4. `validate_native_migration_pack.py` · `validate_replay_manifest.sh` PASS 확인 후 커밋

> 실제 사례: `20260808092007_account_deletion_server_cancel_window_30d` — 2026-08-08 소스 없이 원장에만 적용된 hotfix(탈퇴 취소 유예 30분→30일). 이 1본 포함 원장 4본 불일치로 `db-apply-pending`이 hard fail하며 DB 적용 경로 전체가 잠겼고, 2026-08-09 원장 화해 PR에서 역수입으로 해소했다.

## 코딩 규칙

1. TypeScript strict
2. Server Component 기본 · `'use client'`는 상호작용만
3. Tailwind only · 인라인 style 금지
4. Supabase RLS 필수
5. **관리자 server action:** 첫 줄 `await requireRole("admin")` (또는 `const { user } = await requireRole("admin")`)
6. **멘토 페이지:** `app/(mentor)/layout.tsx`에서 `requireRole("mentor")` + 페이지별 중복 호출
7. **표시 통일:** `formatKoreanDate()` · `formatCashKrw()` → `@/lib/utils/formatDisplay`
8. **빈 상태:** `EmptyState` (`@/components/common/EmptyState`)
9. **피드백:** `window.alert` 금지 · `AppToast` 또는 인라인 toast
10. **로딩:** `loading.tsx` + Skeleton / Suspense (주요 라우트)
11. **반응형:** `grid-cols-1` → `md:grid-cols-2` → `lg:grid-cols-3`

## 금지·통일 문구 (UI 카피)

사용 금지: 선생님, 강사님, 수강생, 과외, 커패니티, 웰버십, 쌤버쉽, `>MENTOR<`, `alert()`  
통일: **멘토**, **학생**, **캐시**, **정산 예정** (not 정산 대기), **작업 중** (not 작업전)

## 맞춤의뢰 금지어

`["대필","대신 써줘","대신 작성","복붙","복사 붙여넣기","그대로 써줘","제출용"]`

## 환경변수 (테스트)

```
NEXT_PUBLIC_TOSS_CLIENT_KEY=test_ck_...
TOSS_SECRET_KEY=test_sk_...
TOSS_WEBHOOK_SECRET=    # Toss 대시보드 > 웹훅 설정에서 발급 (TOSS_SECRET_KEY와 별도)
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```
