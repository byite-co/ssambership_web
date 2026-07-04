# 사용자 차단(user_blocks) 스펙 — UGC 신고+차단 요건 충족
> 저장 위치: `docs/plans/user-blocks-spec.md` · 대상: ssambership_web(main) + 공유 Supabase(앱도 동일 테이블 사용)
> 원칙: **additive-only·플래그 기본 OFF·라이브 DB는 SQL 파일만**(적용 별도 결정, 114 패턴) — Google Play UGC 정책(신고+차단 병존) 대응

## 0. 현황 근거 (실측)
신고(content_reports)는 웹·DB에 구현·정책 존재. 그러나 **사용자간 차단은 없음**: DB에 `user_blocks` 없음, 웹의 '차단'은 전부 관리자 계정 제재(banned)뿐. 공유 DB이므로 차단은 반드시 DB 계층에 만들어 앱·웹이 같은 목록을 쓴다(한쪽만 차단 시 다른 플랫폼에서 노출되는 불일치 방지).

## 1. 신규 SQL — `supabase/sql/116_user_blocks.sql` (파일만 추가, 라이브 미적용)
헤더 `-- ⚠️ 라이브 미적용 — 플래그 ON 배포 시 적용`. 내용:
- 테이블 `user_blocks(blocker_id uuid not null references public.users(id) on delete cascade, blocked_id uuid not null references public.users(id) on delete cascade, created_at timestamptz default now(), primary key(blocker_id, blocked_id), check (blocker_id <> blocked_id))` + `idx_user_blocks_blocker(blocker_id)`.
- RLS enable + 정책: `ub_select_own`(blocker_id=auth.uid() SELECT) · `ub_insert_own`(blocker_id=auth.uid() INSERT) · `ub_delete_own`(blocker_id=auth.uid() DELETE). UPDATE 정책 없음(불변 쌍). admin은 is_admin() SELECT 정책 1개 추가(운영 조회용).
- 관리자·시스템 계정 차단 방지는 v1에서 스킵(정책상 문제 없음 — 차단은 노출 필터일 뿐 상대 기능 제한 아님).

## 2. 헬퍼 — `lib/blocks/userBlocks.ts` (신규)
`fetchBlockedUserIds(client, userId): Promise<string[]>`(세션 클라이언트, RLS 신뢰) · `blockUser/unblockUser` 서버 액션(재검증: 세션·self-block 거부) · `isUserBlocksEnabled()`(플래그 `NEXT_PUBLIC_FEATURE_USER_BLOCKS`, featureFlags.ts 패턴 준용).

## 3. 적용 범위 v1 = 커뮤니티 UGC (질문방·주문방은 v1 제외 — 유료 계약 관계라 별도 정책 필요, 스펙에 명시)
플래그 ON일 때만 필터 활성(OFF면 코드 경로상 기존과 동일한 쿼리·결과):
- 게시판 목록·전체글·상세 댓글, 숏폼 목록·상세 댓글: 조회 직후 `author_id ∉ blockedIds` 필터(목록 쿼리는 `.not('author_id','in',(...))` 가능 시 사용, 불가 시 결과 필터 — 기존 쿼리 함수 시그니처 변경 금지, 래퍼로 감싸기).
- **본인 콘텐츠·관리자 화면은 무영향**(차단 목록은 차단한 사람의 뷰에만 적용).
- 차단해도 상대의 기능은 제한되지 않음(노출 필터) — UI 문구에 명시.

## 4. UI (플래그 OFF면 전부 미렌더)
- 게시글 상세·댓글·숏폼 상세의 기존 신고 버튼 옆 ⋯메뉴에 **'이 사용자 차단'**(확인 다이얼로그: "이 사용자의 게시글·댓글·숏폼이 더 이상 보이지 않아요. 언제든 해제할 수 있어요.").
- 신규 라우트 1개: `app/(student)/settings/blocks/page.tsx` — 차단 목록·해제(멘토도 접근 가능 role 가드 완화 또는 공용 위치, 구현 시 라우트 그룹 규약 따름). 진입: 마이페이지 계정 카드 '차단 관리'.
- 차단된 작성자의 콘텐츠 자리 표시는 v1에서 완전 숨김(placeholder 없음).

## 5. 제약(불가침)
동결 파일 무수정 · 기존 RLS/테이블 무수정(116은 신규만) · 커뮤니티 기존 쿼리 함수는 시그니처 유지(필터는 호출부 래핑) · 라우트 추가는 §4의 1개뿐 · **플래그 OFF에서 기존 커뮤니티 렌더 결과 diff 0**.

## 6. 검증 체크리스트
tsc 0에러·build 그린 · OFF: 메뉴/라우트 미노출, 커뮤니티 결과 기존과 동일 · ON(로컬, 116 로컬 적용): A가 B 차단 → A 피드에서 B의 글·댓글·숏폼 소실, B 화면·타 사용자·관리자 무영향, 해제 시 복원 · RLS: 타인 blocker_id로 insert/select 시도 거부 · self-block 거부 · 신고+차단 병행 동작(같은 메뉴에서 둘 다 접근) · 116은 커밋만, 라이브 적용은 플래그 ON 배포 절차에 포함.
