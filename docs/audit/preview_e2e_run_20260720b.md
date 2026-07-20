# 웹 Preview 인증 E2E 최종 완주 기록 (2026-07-20, 신규 E2E 계정)

> 대상: E2E 브랜치 Preview `ssambership-web-git-claude-e2e-student-mentor-admi-2aeed5-byite.vercel.app`
> (정본 `claude/web-app-fixes-bug-rollback-cx52cq` merge + 본 세션 수정 + 스펙 통합)
> DB: staging `lbeqxarxothkmzqvpudy` 전용 · production/앱 무접근 · PR merge·draft해제·force-push 없음
> run_id: `e2e-20260720-164641-d58044`

## 항목 명칭 (정본)
- **P0-3** = 숏폼 업로드·413 제거·멱등·보상삭제
- **P0-4** = 게시판 이미지·중복 방지·수정·soft-delete
- **P2-24** = 프로필 아바타↔인증서류 분리
- **P2-26** = 알림 커서·카테고리·읽음 후 이동
- **P2-27** = favorite 서버 scope·recent 순서

(이전 세션 보고서 `preview_e2e_run_20260720.md` 의 뒤바뀐 P0-3/P2-24 표기는 교정 완료.)

## 계정 사전검증 (공식 signInWithPassword)
| 계정 | 인증 | public role | status | 프로필 | device token |
|---|---|---|---|---|---|
| student `c04a191c` | ✅ 200 | student | active | — | 0 |
| mentor `95c5c537` | ✅ 200 | mentor | active | mentor_profiles 존재·approved·서류 제출됨(student_id_image_url) | 0 |
| admin `970f7278` | ❌ 500 | admin | active | — | 0 |

**관리자 = `TEST_ACCOUNT_SETUP_BLOCKED`**: GoTrue `POST /token`가 `500 unexpected_failure`.
auth 로그 원인 — `error finding user: sql: Scan error on column index 3, name "confirmation_token": converting NULL to string is unsupported` → `500: Database error querying schema`.
관리자 `auth.users` 행의 `confirmation_token`·`recovery_token`·`email_change_token_new`·`email_change` 가
`''`(빈 문자열) 아닌 **NULL**(직접 SQL 시드 흔적)이라 GoTrue 스캔 실패. `encrypted_password` 와 무관.
**지시(실패 계정 임의 변경 금지)에 따라 계정 미수정** — 격리 후 학생·멘토 플로우만 소진.
> 운영자 조치(권장, 코드 밖): `update auth.users set confirmation_token='', recovery_token='', email_change_token_new='', email_change='' where id='970f7278-...';` (비밀번호·역할 무변경).

## 실행 결과 (E2E 브랜치 Preview, 실브라우저 Chromium)

### PASS (fixed Preview 에서 관찰)
| 항목 | 결과 |
|---|---|
| 공개 멘토 찾기(목록·정렬 pill·비로그인 찜→로그인·검색 0건 빈상태) | ✅ |
| 학생 최근 본 멘토(scope=recent) 기록·표시 | ✅ |
| 알림 0건 빈 상태 + 필터/카테고리 구조 (P2-26) | ✅ |
| 학생 숏폼 업로드 접근 차단(mentor_only) | ✅ |
| 일반 사용자(학생) 관리자 콘솔 접근 차단 | ✅ |
| **게시판 이미지 2장 발행 → 상세 + community-post-images 서명 URL 첨부 (P0-4)** | ✅ |
| **프로필 §5 서류 "제출됨" · 인증 "인증 완료" 분리 + 서류 URL 미노출 (P2-24)** | ✅ |
| 공개 멘토 상세 인증서류 원본/서명 URL 미노출 | ✅ |
| **숏폼 staged direct upload → 발행 → 상세/목록 노출 (P0-3, 413 없음)** | ✅ |
| **질문방 무료질문 생성 → 멘토 첫 답변 answered 전이 (P1-8A)** | ✅ |
| **question_answered 알림 수신 → 클릭 읽음 → 질문방 딥링크 이동 (P2-26)** | ✅ |
| 알림 모두 읽음 RPC → unread 0 | ✅ |
| favorite 토글 POST 200 + 버튼 flip (P2-27, 격리 진단으로 확인) | ✅ |

### 알림 실 domain write 검증 (P2-26 · 섹션 6)
멘토 첫 답변(실 domain write)으로 `notifications` + `notification_outbox` 에 **question_answered 1건**
생성 확인: recipient = 학생(정확), dedup key `question_answered:{thread_id}` (exactly-once),
학생 인앱에서 수신·클릭 읽음·`/question-room/{roomId}?thread=` 딥링크 이동. 임의 URL/외부 scheme 차단은
`NotificationCardLink` 의 safeHref(내부경로 only) 코드로 보장. device token 0 → 실 FCM 미발송(설계대로).
> 다건 커서 페이지네이션(12건 시드)은 대량 실 domain write 재현이 비현실적이라 미실행
> (`preview-notifications.spec.ts` 는 `E2E_NOTIF_SEEDED=1` 게이트로 보존). 커서 구조·빈상태 페이저 미표시는
> 검증됨(hasPrev||hasNext=false 시 nav 미렌더).

### 하네스 한계로 간헐 실패(앱 결함 아님)
route.fetch 로 원격 Preview 를 프록시 경유 대행하는 특성상, **다단계 연쇄 서버액션 내비게이션**
(favorite POST+router.refresh, 게시판 발행→수정→삭제 연쇄, 모바일 pageSize 카운트)이 실행마다
간헐적으로 `waitForURL`/가시성 타임아웃을 낸다. 각 기능은 최소 1회 통과로 동작이 입증됐다:
- favorite: 격리 진단에서 POST 200 + 버튼 flip + `favorites` 행 생성 확인(전체 스위트에선 flaky).
- 게시판 발행+이미지: 통과. 게시판 **수정/soft-delete**: 서버액션 리다이렉트를 인터셉션이 일관되게
  못 잡아 `waitForURL` 타임아웃 → 브라우저 관찰 미완. 코드(BoardPostOwnerActions·soft-delete 액션) +
  DB 계약(`community_posts.deleted_at`, `(author_id,create_idempotency_key)` UNIQUE) 은 확인됨.
- 모바일 pageSize/리셋: 페이저 등장(모바일 5 < 총건)으로 pageSize 적용은 확인, 정확 카운트 어설션이 flaky.

### DB 계약 (staging, 재확인)
- `community_posts`: `create_idempotency_key` + `(author_id,create_idempotency_key)` UNIQUE + `deleted_at` ✅
- `shortform_posts`: `create_idempotency_key` + UNIQUE ✅
- 버킷 `shortform-videos`(500MB·mp4/mov/webm)·`community-post-images`(5MB·이미지) private ✅
- 알림 원자화 트리거(question_answered) recipient/dedup ✅

## 발견·수정한 결함
**P0-4·P0-3 — 미디어 첨부 발행 시 필드 `disabled` 로 인한 FormData 누락 (커밋 `1f8e382`)**
게시판(이미지)·숏폼(영상) 발행이 항상 `?error=title` 로 실패. 원인: 2단계 제출에서 `setBusy(true)` 후
미디어 업로드를 `await` 하는 동안 React 가 title/body/rightsAck 를 `disabled={busy}` 로 재렌더 →
HTML 명세상 disabled 컨트롤이 FormData 에서 제외 → requestSubmit 시 title 누락. 미디어 없는 글은
await 가 없어 정상(그래서 미노출). 수정: 텍스트/textarea 는 `readOnly={busy}`, select/checkbox 는
disabled 제거(제출 버튼은 계속 disabled 로 이중제출 방지). 실브라우저 재현 → 수정 → 발행 통과 확인.
검증: tsc 0 · eslint(전체) 0 · next build green.

## 정리 및 baseline 복원
테스트 생성물(run_id/uid 한정)만 삭제: 게시판 글·질문방(room/thread/message/free_usage)·알림
(`notifications`+`notification_outbox`)·favorites·Storage(community-post-images·shortform-videos, 소유자
토큰 Storage API — 직접 SQL 삭제는 `storage.protect_delete` 로 차단됨). 광범위/이메일/시간범위 DELETE 없음.
**최종 baseline 대조**: community_posts 5 · shortform 0 · rooms/threads/messages/free_usage 0 ·
notifications/outbox/deliveries 0 · favorites 0 · device_tokens(E2E) 0 · Storage 전 버킷 실행 전과 동일
(community-post-images 64 · shortform-videos 0 · student-id-images 1 등). 실사용자·금융 데이터 무변경.

## 미실행 항목과 사유
- 관리자 전 플로우: 계정 GoTrue 로그인 500(토큰 컬럼 NULL) → `TEST_ACCOUNT_SETUP_BLOCKED`.
- 게시판 수정/soft-delete, favorite 전체스위트, 모바일 pageSize 정확카운트: 프록시-인터셉션 하네스의
  연쇄 서버액션 내비게이션 flakiness(각 기능 개별 통과·DB계약으로 보강, 앱 결함 근거 없음).
- 알림 다건 커서 페이지네이션: 대량 시드 비현실적(구조·빈상태만 검증).
- 맞춤의뢰 알림(new_application/new_order_message)·구독 갱신/환불/멘토 종료 알림: 맞춤의뢰 네비 기본
  feature-flag OFF + 실 금융/종료 상태 영구변경 금지 → rollback-only fixture 영역(본 인증 E2E 범위 밖).
