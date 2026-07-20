# v16(1) 웹·DB 잔여 작업 — 자율 실행 체크포인트

> 대상: `ssambership_web` · staging `ssambership-staging`(`lbeqxarxothkmzqvpudy`, schema-only, 0 rows)
> 브랜치: `claude/v16-web-db-autonomous-g7glnb` · PR: 별도(아래 참조)
> 이 문서는 세션 간 진행 상태 체크포인트다. 완전 완료와 검증 부채를 분리해 기록한다.

## 0. 상태 정합성 조사 결과 (선행 발견)

착수 전제와 실제가 크게 달라 먼저 기록한다. 이후 작업은 실제 상태를 기준으로 한다.

1. **브랜치 정합성** — 지정 브랜치 `claude/v16-web-db-autonomous-g7glnb` 는 `main`(bad8694)과 동일(0 commits ahead)한 빈 출발점이었다. PR #42 는 다른 브랜치(`claude/web-app-fixes-bug-rollback-cx52cq` @ b4e8b45)에 있고, 런북이 가정한 122–129 기반(P0-3/P0-4 등)은 미머지 PR #31/#33/#34 에 있으며 `main` 에는 없다. 저장소 SQL 은 **121까지**만 존재.
2. **DB 가 저장소보다 앞섬** — staging 에 `notification_outbox`(lease/retry/dead-letter 완비)·`record_domain_notification`·`anonymize_user_for_deletion` 등이 이미 존재하나, 저장소 어디에도 원본 SQL·코드가 없다. 병렬 세션이 적용한 것으로 추정. → 재생성하지 않고 재사용한다. 신규 파일은 130+ 사용(122–129 예약대 회피).
3. **staging 데이터** — 질문/구독/결제/원장/알림 전부 0 rows. 실데이터 충돌 위험 없음(추가형 DDL·rollback-only fixture 안전). 마이그레이션 트래커(21행)는 일부만 기록 — 실객체 조회가 정본.

## 1. P1-8A 질문방 원자 RPC + 웹 전환 — 구현 완료(단일세션 검증), 동시성 BLOCKED_ENV

### staging 적용 (130)
- `free_question_usage.thread_id` 추가(nullable, FK `question_threads(id) ON DELETE SET NULL`, index) — 기존 "usage 선INSERT → 별도 thread INSERT → 15분 시각근접 짝짓기"(freeQuestionUsage.ts:195) 비원자·오짝 문제 제거.
- 원자 RPC 5종(SECURITY DEFINER, search_path=public, `auth.uid()` 재검사):
  - `qna_create_free_question_thread` — 무료 스레드 생성 + (선택)첫 메시지 + 무료권 소비(thread_id 링크)를 한 트랜잭션으로. 재검사: 당사자·역할·계정상태(banned/suspended)·상호차단·멘토승인·무료자격(만료7일·총7·멘토3). 학생 행 잠금으로 한도 경쟁 직렬화.
  - `qna_append_message` — 메시지 append + 멘토 **첫** 답변만 `answered` 전이 + `record_domain_notification` 로 exactly-once 알림.
  - `qna_confirm_thread` / `qna_flag_wrong_answer` — 학생 전용 상태 전이.
  - `qna_register_attachment` — 당사자 재검사 후 첨부 메타 등록.
- 권한: `revoke ... from public, anon` + `grant execute ... to authenticated, service_role`. 최종 grantees = {authenticated, postgres(owner), service_role}.
- **기존 direct-write 정책·GRANT 유지**(qt_write_via_room/qm_insert/fqu_insert_own/question_attachments_insert_via_room). 앱 신버전 전 direct 정책 제거·revoke·`open→pending` 이관은 **P1-8B(WAITING_EXTERNAL_APP)**.

### rollback-only fixture (14/14 PASS, 전부 롤백)
스레드 pending+trim / 첫 메시지 링크 / usage.thread_id 링크 / 멘토 첫답 answered 전이 / notification·outbox 각 1행 / 2번째 답변 무전이·알림 미증가(exactly-once) / 오답 플래그 / confirm / confirm 후 append=THREAD_LOCKED / 멘토 무료한도 4번째=FREE_QUOTA_MENTOR_EXHAUSTED / 비당사자=NOT_ROOM_PARTY. baseline 0 rows 복원 확인.

### 웹 전환
- `lib/qna/questionRoomRpc.ts`(신규) — 타입드 래퍼 + 에러코드→문구 매핑.
- `createQuestionThreadAction` — 활성 구독 없는 학생 새 스레드는 원자 RPC 경로. 활성 구독 경로는 기존 주간한도 게이트 유지.
- `freeQuestionUsage.loadFreeQuestionThreadIdsInRoom` — `thread_id` 정본 링크 우선, 레거시(null) 행만 시각근접 폴백. `thread_id` 컬럼 미적용 DB 폴백 포함.
- 정적 게이트: `tsc --noEmit` 0, eslint(변경파일) 0, `next build` green.

### 검증 부채
- 독립 2세션 동시성(무료한도·첫답변·첨부 재시도 경쟁) 실측 = **BLOCKED_ENV**(단일 MCP 커넥션). 단일세션 논리 경쟁(잠금/멱등)은 fixture 로 확인.
- 실인증 브라우저 E2E(폼 제출 런타임) = 미실행(인증 E2E 환경 부재). 정적·DB 검증까지 완료.
- append/confirm/wrong/attachment RPC 의 웹 전환은 DB 준비 완료·웹 호출부 미전환(현행 direct-write 유지). 잔여 P1-8A 웹 전환 대상.

## 2~7. 후속 단계 상태

| 단계 | 상태 | 사유/필요 |
| --- | --- | --- |
| P1-13 구독·결제 원자 상태기계 | 미착수 | 금융 상태기계 신규 적용은 실데이터 대사(현재 0행이나 정본 계보 불명)·독립 2세션·오너 정책 확인 선행 권장. 저장소에 payments/subscriptions 정본 계보가 불완전(DB-앞섬). |
| P1-10 회원탈퇴 saga + P2-22 | 부분 존재 | `anonymize_user_for_deletion`·`115_account_deletion` 이 DB 에 존재. durable job 상태기계·write/storage gate 계약은 미완. 실삭제 금지 유지. |
| P1-11 outbox worker 잔여 + P2-17 | foundation 존재 | `notification_outbox`(lease/retry/dead-letter)·`record_domain_notification` 존재. worker claim/lease/dead-letter 소비자·mock 검증 미완. P2-17 소비자 부재로 WAITING. |
| P3-8 realtime | **완료** | 131 적용. `supabase_realtime` 에 `question_messages`·`question_threads` 추가(기존 attachments만) → 3테이블 멤버십 확인. SELECT RLS 로 당사자만 수신. |
| P3-9 학생명 RPC | **부분 완료** | 132 적용(PII RPC anon/public EXECUTE 회수). 나머지(활성구독/질문방 당사자 기준으로 노출 인가 재정의)는 현행 `custom_request_orders` 기준과 다른 집합으로의 기능 변경 → DEFERRED_PRODUCT_DECISION. |
| P2-25 지급 스택 | 미착수 | `105–114` 존재. 정적·동시성 검증 통과 전 적용 금지 규칙. 독립 2세션 부재. |
| 검증 부채(P0-1~5, P2-24) | 유지 | E2E 인증환경 부재로 상태 유지. |

## 안전 상태
- DB target: `lbeqxarxothkmzqvpudy`(staging)만. production 무접근.
- 적용: 130 (추가형, 재실행 안전). rollback: fixture 전부 롤백, baseline 0 rows.
- 금융 원장·지갑·정산 무변경. Storage 무변경. 기존 정책·GRANT 무완화.
- PR: draft 유지.
