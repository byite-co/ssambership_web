# P1-8A 질문방 원자 RPC·웹 전환 — 설계 DRAFT (staging 적용·웹 전환 보류)

> 상태: **설계 완료 · staging 미적용 · 웹 미전환**. 착수 조건(아래 §6)이 확보되기 전 적용하지 않는다.
> 보류 사유: (1) 할당량 소비의 **동시성 정확성은 독립 2세션 실측 필수**(§10, 단일 세션 PASS 금지) — 현 환경 불가.
> (2) 웹 전환은 라이브 질문방 write 경로 교체라 **런타임 E2E** 필요 — 현 환경(인증 세션) 불가.
> (3) pending-refund lock 경계는 **P1-13 billing-event 정본** 위에 완성(결정 C 계약으로 경계까지만 구현 가능).

## 0. 착수 시 확인된 실상태(2026-07-19, staging)

- `question_threads`(0행): `id·mentor_student_room_id(NN)·title·status(nullable text)·topic·subject·is_wrong_answer(NN)·mastery_status(CHECK unknown/wrong/review/mastered)·first_answered_at·confirmed_at·view_count`.
- `question_messages`(0행), `connection_notes`.
- `free_question_usage`(0행): `id·student_id(NN)·mentor_id(NN)·created_at` — **thread_id 없음**.
- `question_attachments`(0행): `id·thread_id(NN)·message_id·storage_path(NN)·file_name·mime_type·author_id·created_at` — **storage_path UNIQUE 없음**.
- 기존 RPC: `check_free_question_usage_limits()`(secdef, authenticated 실행), `add_individual_question_attachment(...)`(개별질문용, 질문방 아님). **질문방 create/append/confirm/register RPC 부재.**
- 웹 write: `lib/qna/questionRoomMutations.ts`가 **스키마 탐침 후보 INSERT**(`insertWithCandidates`/`buildThreadPayloads`/`buildMessagePayloads`)로 직접 INSERT. `status:'pending'` 강제.
- **0행이라 중복/백필 HARD STOP 없음** → 마이그레이션 자체는 그린필드.

## 1. 스키마 변경(0행 안전, `127_question_thread_rpcs.sql`에 포함 예정)

- `free_question_usage.thread_id`: **nullable 추가 → FK(no CASCADE) → 신규 필수 기록(RPC) → (0행이라 백필 없음) → NOT NULL + UNIQUE(thread_id)**. 6단계이나 0행이라 실질 add+RPC-required+제약. **CASCADE 금지**(runbook).
- `question_attachments`: `UNIQUE(storage_path)` 추가(0행 → 중복 대사 불필요). `author_id NOT NULL` 승격은 신규 RPC 기록 확립 후.
- `question_threads.status`: 전이 집계 대상 상태(`pending/open/answered/confirmed`) forward 상태를 주간 사용량에 포함(098 확장).

## 2. RPC 계약(SECURITY DEFINER·service_role 전용; 직접 우회 정책은 앱 전환 후 제거)

### 2.1 `create_question_thread_with_usage(p_room_id, p_title, p_subject, p_topic, p_actor)` → jsonb
- `auth.uid()`·room으로 학생·멘토 서버 도출(폼 신뢰 안 함).
- **자격 분기**: 활성 구독 경로 vs 무료질문권 경로.
  - 구독 경로: `subscription FOR UPDATE` + advisory lock(멘토별) → 주·멘토별 한도 동시 검사.
  - 무료 경로: 학생 전체 lock(무료권 총한도) + 멘토별 검사(`check_free_question_usage_limits` 로직 정본화).
- **pending-refund 경계(결정 C)**: `subscription FOR UPDATE` 후 **별도 SQL**에서 현재 `last_billing_event_id`의 live refund(`subscription_prorated`/`subscription_mentor_suspended`) 재조회 → pending이면 거부. (P1-13 billing-event 정본 확정 시 helper 교체.)
- account status·block·mentor 승인/활성 재검사.
- 스레드 + 첫 메시지 **한 트랜잭션**, 초기 `pending`. 생성 시점부터 forward 상태를 주간 사용량 집계.
- 무료 경로면 `free_question_usage`에 `thread_id` 포함 1건 기록(멱등).
- 반환: thread_id·message_id·소비 경로.

### 2.2 `append_question_message(p_thread_id, p_body, p_actor)` → jsonb
- 학생·멘토 공통. `thread FOR UPDATE`. 허용 상태 `pending/open/answered`만.
- **멘토 첫 메시지만 answered 전이**(승자 1인). 첫 answered 승자만 `record_domain_notification`(P1-11F)로 `question_answered` outbox 1회.

### 2.3 `confirm_question_answer(p_thread_id)` → answered→confirmed(학생 전용).
### 2.4 `flag_question_wrong_answer(p_thread_id, p_flag)` → 오답 플래그(`is_wrong_answer`/`mastery_status`).
### 2.5 `register_question_attachment(p_thread_id, p_storage_path, p_file_name, p_mime, p_message_id)` → jsonb
- `thread FOR UPDATE`, 첨부 INSERT, 첫 멘토 첨부 answered 전이, `UNIQUE(storage_path)`, **객체 owner·경로 thread ID 검증**.
- `question_attachments` 직접 INSERT revoke, storage INSERT 정책은 **제거하지 말고**(049 유지) thread 상태·당사자·자격 검증 정책으로 **교체**, 미등록 객체 owner-DELETE 정책 추가.

## 3. 전환기 방어(앱 신버전 전 direct 정책 유지)

- `qt_write/update`·`qm_insert`·`fqu_insert_own` 직접 우회는 **앱 전환 전 제거 금지**. 전환기 서버 트리거로 한도·상태 우회 차단.
- 049 Storage INSERT 정책 문자 그대로 제거 금지. `author_id IS NULL` 첨부 중복 자동정리 금지.

## 4. 웹 전환(적용·검증 후)

- `questionRoomMutations.ts` 분리 INSERT → 생성 RPC.
- `questionRoomActions.ts` 메시지 직접 INSERT → append RPC.
- `questionRoomThreadService.ts` 확인/오답 → 전용 RPC.
- `questionRoomAttachmentStorage.ts` 직접 첨부 INSERT → register RPC(+ 실패 시 미등록 Storage 객체 보상 삭제).
- 구조화 서버 오류 매핑. **스키마 탐침 후보 로직 제거.**

## 5. 배포 순서(runbook §8)

1. 098에 open 집계 포함 → 2. RPC + 전환기 서버 트리거 배포 → 3. 웹 전환 → 4. 앱 신버전(외부) → 5. 최소버전 강제(WAITING_EXTERNAL_APP) → 6. direct 정책·권한 제거(WAITING_EXTERNAL_APP) → 7. 잔여 open→pending 이관 → 8. open 0 확인 후 호환 제거.

## 6. 착수(=staging 적용) 조건 — 현재 미충족

1. **독립 2 DB 세션** 동시성 실측 환경(구독/무료 한도 경쟁, first-answered 승자 1인). 단일 세션 PASS 금지.
2. **런타임 E2E**(인증 학생·멘토 세션)로 웹 전환 검증.
3. **P1-13 billing-event 정본**(pending-refund lock helper 최종 교체) — 최소한 경계 helper 확정.
4. 위 충족 시 `127_question_thread_rpcs.sql` 작성·적용, 이어 웹 4파일 전환, `apply_manifest_prod.md`에서 132(P1-11F) 선행 확인.

## 7. WAITING / 미검증
- direct policy drop·legacy open 최종 제거·최소앱버전 강제 = **WAITING_EXTERNAL_APP**.
- 동시성·런타임 = **검증 부채**(PASS 위조 금지).
