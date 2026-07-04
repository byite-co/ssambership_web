# 계정 삭제(회원 탈퇴) 스펙 — PII 익명화 + 원장 보존
> 저장 위치: `docs/plans/account-deletion-spec.md` · 대상: ssambership_web(main) + 공유 Supabase · 앱(Flutter)도 동일 RPC 사용
> 원칙: **기존 레포 무영향(additive-only)** — 기능 플래그 기본 OFF, 동결 파일 불가침, 라이브 DB는 SQL 파일만 추가(적용은 별도 결정, 114 패턴 동일)

## 0. 설계 확정 근거 (라이브 DB 실측, 2026-07-04)
`public.users`를 FK로 참조하는 테이블 **84개**(CASCADE 41 / SET NULL 34 / RESTRICT·NO ACTION 9 — settlement_items·payout_run_items·orders·disputes·withdrawals 등). 그리고 **`public.users` → `auth.users` FK가 ON DELETE CASCADE**다. 즉 auth 사용자를 하드 삭제하면 public.users가 지워지고 CASCADE 41개 테이블(원장·거래 포함 연쇄)이 파괴된다. 따라서:
- **어떤 행도 물리 삭제하지 않는다.** `cash_ledger`(append-only RLS)·payments·settlement·payout·refunds·orders는 세법·회계·분쟁 대응상 보존.
- 탈퇴 = ① `public.users` 등 **PII 컬럼 익명화** ② **auth soft-delete**(`auth.admin.deleteUser(uid, /*shouldSoftDelete*/ true)` — 행 보존·로그인 불가) ③ 상태 마킹.
- PII 스코프(실측): `users.full_name, nickname, email, grade_level, birth_date` + `mentor_profiles`의 소개/학교/사진 계열 + 아바타 스토리지 객체.

## 1. 신규 SQL — `supabase/sql/115_account_deletion.sql` (파일만 추가, 라이브 미적용)
파일 헤더에 `-- ⚠️ 라이브 미적용 — 기능 플래그 ON 배포 시점에 적용 (114 패턴)` 명시. 내용:
1) `user_deletion_log`(id, user_id, requested_at, reason text null, snapshot jsonb) — 감사용, RLS: service_role 전용(정책 없음=기본 거부, payout_runs 패턴).
2) RPC `anonymize_user_for_deletion(p_user_id uuid, p_reason text)` — SECURITY DEFINER·**service_role 전용**(anon/authenticated EXECUTE REVOKE):
   - 가드: 대상 존재·이미 deleted 아님.
   - `users`: full_name→'탈퇴회원', nickname→'탈퇴회원_'||left(p_user_id::text,8), email→(NOT NULL이면) 'deleted_'||p_user_id||'@removed.invalid' (nullable이면 null), birth_date/grade_level→null.
   - `mentor_profiles`(존재 시): 소개·학교명·전공·프로필 사진 경로 등 PII 컬럼 null/익명 문구(컬럼은 구현 시 실스키마 조회로 확정 — 임의 추정 금지).
   - `account_status`(기존 102 체계) → 'deleted' (허용값에 없으면 CHECK 확장 포함).
   - `user_deletion_log` insert(멱등: 동일 user 재호출 시 no-op 반환).
   - **금지**: cash_ledger·payments·settlement·payout·orders·subscriptions·reviews·community 콘텐츠의 UPDATE/DELETE 일절 금지. 게시물·리뷰 작성자 표기는 조인 표시 계층에서 자동으로 '탈퇴회원'이 되게 둔다.
3) 스토리지: 아바타 객체 삭제는 RPC가 아닌 서버 액션에서 storage API로(경로: 기존 profile-avatars 규약).

## 2. 서버 액션 — `lib/account/accountDeletionActions.ts` (신규)
`requestAccountDeletion(formData)`:
1) 세션 확인 + **비밀번호 재인증**(signInWithPassword 재검증) — 실패 시 에러 리다이렉트.
2) **사전조건 검사(모두 통과해야 진행, 미충족 시 사유별 안내 리다이렉트)**
   - 학생: active/past_due 구독 0 · escrow 진행중 IQ(open/assigned/claimed/answered) 0 · 진행중 CR 주문(터미널 외) 0 · open/under_review 분쟁 0 · 지갑 잔액 0 **또는** "잔액 소멸 동의" 체크(동의 시 잔액은 원장에 `forfeit_on_deletion` 사유의 상계 라인으로 0화 — service_role, append-only 준수).
   - 멘토: 구독자 보유 시 **기존 활동 해지 플로우(mentor-activity-terminating) 선행 필수** 안내 후 차단 · 진행중 답변/주문/분쟁 0 · 미지급 정산 잔액 처리 동일.
3) service_role로 RPC 호출 → 아바타 삭제 → `auth.admin.deleteUser(uid, true)`(soft) → 전체 로그아웃(signOut scope: global) → `/goodbye` 안내 페이지로.
※ soft-delete 사용자의 재가입: 동일 이메일 재가입 정책은 스펙 외(추후 결정) — 코드 주석으로 남길 것.

## 3. UI (플래그 `NEXT_PUBLIC_FEATURE_ACCOUNT_DELETION`, 기본 OFF)
- 신규 라우트 2개: `app/(student)/account/delete/page.tsx`(멘토는 동일 페이지 role 분기 렌더 — 라우트는 (public) 성격이나 로그인 가드), `app/(public)/goodbye/page.tsx`.
- 진입: 학생 마이페이지·멘토 마이페이지 하단 "계정" 카드에 '회원 탈퇴' 링크(플래그 ON일 때만 렌더 — OFF면 DOM에도 없음).
- 삭제 페이지 구성: 사전조건 결과 리스트(미충족 항목은 해결 경로 링크) → 보존·익명화 고지문(아래 §5 문구) → 사유 선택(선택) → 비밀번호 입력 → "위 내용을 이해했으며 탈퇴합니다" 체크 → 2단 확인 버튼.

## 4. 기존 문구 교체 (플래그 ON 배포와 **동시** 커밋, OFF 동안은 미교체)
- `app/(public)/support/page.tsx:87-91` FAQ "학생·멘토 계정을 바꾸거나 탈퇴하려면?" 답변 → "탈퇴는 마이페이지 하단 '회원 탈퇴'에서 직접 할 수 있어요. 거래·정산 기록은 법령에 따라 익명화되어 보존됩니다." (이메일 문의 문구 제거)
- `app/(public)/legal/` 전체에서 `탈퇴` grep → 이메일 문의 방식 서술을 자가 탈퇴 경로로 교체(파일 최소 수정), `legal/privacy`에 "탈퇴 시 개인정보는 익명화하며, 전자상거래·세법상 거래기록은 별도 보존" 항목 추가.

## 5. 고지문(페이지·정책 공용 문구)
"탈퇴 시 이름·닉네임·이메일 등 개인정보는 즉시 익명화되며 로그인이 영구 차단됩니다. 결제·캐시 원장·정산·주문 기록은 관련 법령(전자상거래법·세법)에 따라 익명 상태로 보존됩니다. 작성한 게시글·후기는 '탈퇴회원' 표기로 남으며, 삭제를 원하면 탈퇴 전에 직접 삭제해 주세요. 남은 캐시는 환불 신청을 먼저 진행하거나, 소멸에 동의해야 탈퇴할 수 있습니다."

## 6. 제약(불가침)
동결 파일(weeklyQuestionUsage.ts·questionRoomThreadService.ts·QuestionRoomStudentThreadForm.tsx) 무수정 · 기존 RLS/트리거/함수 무수정(115는 신규 객체만) · cash_ledger 계열 무접촉(잔액 소멸 상계 라인 1건 예외, append-only 준수) · 라우트 추가는 §3의 2개뿐(라우트 인벤토리 diff에 그 2개만) · **플래그 OFF 상태에서 기존 화면 스냅샷/동작 diff 0**.

## 7. 검증 체크리스트
tsc 0에러·build 그린 · 플래그 OFF: 마이페이지에 진입점 미노출 + /account/delete 접근 시 404 또는 마이페이지 리다이렉트 · 플래그 ON(로컬): 사전조건 각 케이스(활성구독/진행 IQ/진행 주문/분쟁/잔액) 차단 메시지 확인 → 전조건 통과 계정으로 탈퇴 → users 행 존속+PII 익명 확인, cash_ledger 행수 불변 확인, auth 로그인 불가 확인, 게시글 작성자 '탈퇴회원' 표기 · RPC를 authenticated로 직접 호출 시 거부(권한 테스트) · 115는 **커밋만 하고 라이브 미적용**(운영 적용은 플래그 ON 배포 절차에 포함).
