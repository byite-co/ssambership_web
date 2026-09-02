# 연결노트 개편안 — 누적 타임라인 전환 (유니크 제약 제거)

| 항목 | 내용 |
|---|---|
| **문서 종류** | 개편안 (오너 승인용 · 코드 미착수) |
| **작성일** | 2026-09-02 (KST) |
| **저장 위치** | `docs/plans/connection-notes-timeline-reform.md` |
| **대상** | 공유 Supabase(`lbeqxarxothkmzqvpudy`) · Flutter 앱(`byite-co/ssambership-app`) · 웹(`byite-co/ssambership_web`) |
| **근거 커밋** | 앱 `635ae738` (2026-08-27) · 웹 `7de04c6` (main, 2026-09-02) · DB 라이브 실측 2026-09-02 |
| **확정 전제(오너)** | `connection_notes_room_author_unique` **제거** · 누적 타임라인으로 전환 · 1차는 **텍스트만**(손글씨 제외) · 기존 화면 골격 유지 |
| **작업 성격** | 이 문서는 조사·설계만. **코드·DB는 한 줄도 수정하지 않았다.** 마이그레이션 SQL은 §12 초안이며 파일로 만들지 않았다 |

> **읽는 법**: 코드·DB에서 확인된 사실만 "현황"에 적었다. 확인하지 못한 것은 `미확인`, 오너가 골라야 하는 것은 **결정 #n**으로 표시했다. 실행은 §9 순서를 따르되, 각 단계의 게이트 조건을 만족하기 전에는 다음 단계로 넘어가지 않는다.

---

## 0. 결론 요약

1. **DB 변경은 한 문장이다.** `alter table public.connection_notes drop constraint connection_notes_room_author_unique` 한 줄이면 누적 구조가 열린다. 컬럼·RLS·트리거는 손대지 않는다. 라이브 행이 **0건**(방도 0건)이라 데이터 정리는 필요 없고, 지금이 가장 싼 시점이라는 인계 문서의 판단은 실측으로 확인됐다.
2. **진짜 위험은 DB가 아니라 이미 배포된 앱이다.** 스토어 앱(1.0.0+19)의 저장 함수 `upsertMyNote`는 "내 노트 중 최신 1건을 UPDATE하고 **나머지 내 노트를 전부 DELETE**"한다. 제약을 지우고 타임라인에 내 노트가 여러 장 쌓인 뒤 구버전 앱에서 저장을 한 번 누르면, 그 사용자의 과거 노트가 사라진다. 이 경로는 코드로 확인했다(§5).
3. 따라서 순서가 곧 안전장치다. **① 제약 제거(무해) → ② 앱 신버전 배포 → ③ 강제 업데이트 게이트 상향 → ④ 웹·앱 UI에서 여러 장 허용.** ④를 ③ 앞에 두면 위험이 열린다. 단 게이트는 **콜드 스타트에서만** 평가되므로(§5-2) 순서만으로는 구멍이 남고, 서버가 스스로 막는 방어(§5-3: **수정은 15분 창, 삭제는 불가**, `created_at` 불변 트리거)를 함께 넣는 것을 권장한다 — 오너 결정 #2.
4. 웹 쓰기 경로는 **이미 append(INSERT)** 다. 웹이 1장으로 보이는 이유는 패널의 "내 노트 추가" 버튼을 숨기는 UI 조건 한 줄 때문이다. 앱은 UPDATE 구조라 저장 함수를 바꿔야 한다.
5. 손글씨(`ink_path`·`ink_thumb_path`·버킷 `connection-note-ink`)는 컬럼·버킷·경로 규약만 남아 있고 저장·표시 코드가 0건이다. 이번 개편에서 건드리지 않는다(컬럼 유지, 기능 없음).

---

## 1. 전제와 범위

### 1-1. 결정된 것 (바꾸지 않는다)
- 유니크 제약 제거 → 한 작성자가 한 방에 노트를 **여러 장** 남긴다.
- 방(`mentor_student_rooms`) 단위 타임라인. 학생·멘토 노트가 한 흐름에 섞인다.
- 1차는 텍스트만. 손글씨 미포함.
- 기존 화면 골격 유지: 앱 `ConnectionNotesScreen`(풀스크린), 방 홈 2종의 미리보기 카드, 웹 질문방 3단 우측 레일(`ConnectionNotesPanel`)은 **자리·구조 그대로**, 안의 내용 모델만 바뀐다.

### 1-2. 이 문서가 정하는 것
- DB DDL과 저장소 마이그레이션 절차(§4, §12)
- 구클라이언트 방어와 배포 순서(§5, §9)
- 앱·웹 변경 파일 목록과 테스트(§6~§8)
- 오너가 골라야 할 항목(§10)

### 1-3. 범위 밖 (이번에 하지 않는다)
- 손글씨 저장·표시, 잉크 버킷 정책 변경
- 노트 알림(상대가 노트를 남기면 푸시/인앱 알림) — §11에 후속으로 기록
- 관리자 콘솔의 노트 열람 화면(현재 없음)
- 연결노트 독립 통합뷰(`/notes`는 질문방으로 redirect 중 — 그대로)
- 구독 만료 시 편집 차단 정책 자체 — **웹 서버 액션에만 존재**하고 앱 경로에는 없다(§2-2·§2-4). 이 비대칭을 DB로 옮길지는 결정 #8로 분리하고, 1차에서는 현행 그대로 둔다

---

## 2. 현황 — 코드·DB 실측

### 2-1. DB (라이브, 2026-09-02 조회)

| 항목 | 값 |
|---|---|
| 행 수 | `connection_notes` **0건** · `mentor_student_rooms` **0건** · `author_id is null` 0건 |
| 컬럼 | `id uuid pk` · `mentor_student_room_id uuid not null` (FK rooms, **on delete cascade**) · `body text null` · `author_id uuid null` (FK users, **on delete set null**) · `author_role text null` · `created_at/updated_at timestamptz not null default now()` · `ink_path text null` · `ink_thumb_path text null` |
| 제약 | `connection_notes_pkey` · `connection_notes_mentor_student_room_id_fkey` · `connection_notes_author_id_fkey` · **`connection_notes_room_author_unique UNIQUE (mentor_student_room_id, author_id)`** ← 제거 대상 |
| 인덱스 | `connection_notes_pkey` · `connection_notes_room_author_unique`(제약이 만든 unique index) · `idx_cn_author (mentor_student_room_id, author_id)` · `idx_cn_msr (mentor_student_room_id, updated_at desc)` |
| RLS | `cn_select`: 방 당사자(student_id/mentor_id) 열람 · `cn_insert`: `author_id = auth.uid()` **AND** 방 당사자 · `cn_update`/`cn_delete`: `author_id = auth.uid()` **AND** 방 당사자 |
| 트리거 | `trg_cn_set_updated` (before update → `set_updated_at()`) |
| Storage | 버킷 `connection-note-ink` `public=false` (호출 코드 0건) |
| 원장(`schema_migrations`) | `20260702083003 create_connection_note_ink_bucket_and_policies` · `20260702083017 add_ink_columns_to_connection_notes` · **`20260806033452 connection_notes_room_author_unique`** |

제약을 추가한 마이그레이션 원문(`supabase/migrations/20260806033452_connection_notes_room_author_unique.sql`)의 주석: *"C16: 연결노트는 (방, 작성자)당 1장이 계약인데 DB 제약이 없어 앱이 중복 내성·자가치유 삭제(e9f1311)로 방어하고 있었다. 유일성 정본을 DB로 올린다(적용 시점 행 0건)."* — 즉 **앱의 "자가치유 삭제"가 먼저 있었고 제약이 나중에 올라갔다.** 제약을 지우면 앱의 삭제 로직이 다시 유일한 "정리자"가 되는데, 이것이 §5의 위험이다.

RLS 관찰: 네 정책 모두 "행 단위 작성자 본인 + 방 당사자" 검사다. **(방, 작성자) 유일성을 전제로 한 정책은 없다** → 제약을 지워도 RLS는 그대로 유효하다.

### 2-2. 앱 (`635ae738`) — 단일 편집 구조

| 확인 항목 | 코드 사실 | 근거 |
|---|---|---|
| 저장 | `upsertMyNote(roomId, body)`: 내 노트(`author_id = uid`)를 `updated_at desc`로 조회 → 있으면 **최신 1건 UPDATE**(`body`, `updated_at`) → 성공 후 **나머지 내 노트를 `delete().inFilter('id', …)`로 best-effort 삭제**(실패 무시) → 없으면 INSERT(`mentor_student_room_id, author_id, author_role, body`) | `lib/features/question_room/data/question_room_write_repository.dart:194-248` |
| 저장 주석 | *"★ 중복 내성(2026-08 실측): DB에 (room, author) UNIQUE가 없어 … 최신 1건을 갱신 대상으로 삼고, 성공 후 내 나머지 중복 행은 best-effort로 정리한다"* | 같은 파일 `:189-193` |
| 작성자 역할 | `_currentAuthorRoleCode()`: student/mentor만 허용, admin/guest는 `AppError('이 계정은 연결노트를 작성할 수 없어요.')` | `:252-262` |
| 조회 | `notes(roomId)`: 방 전체 행, `updated_at desc`, **limit 없음**. 메시지용 커서 페이징(`recentMessages`/`messagesBefore`, `messageCursorBeforeFilter` — `created_at`·`id`만 참조)이 같은 파일에 있어 노트에도 그대로 쓸 수 있다 | `question_room_read_repository.dart:258-265` · `:220-252, 302` |
| 화면 | `ConnectionNotesScreen`: '상대 노트' 카드(작성일 오름차순) + '내 노트' 편집기(`TextField` minLines 3 · maxLines 8, `mine.first.body`로 1회 시드) + `PrimaryButton('내 노트 저장')`. 삭제 없음 | `ui/connection_notes_screen.dart:131-191` |
| 방 홈 미리보기(학생) | `latestMentorNote` = `authorRole == mentor`인 첫 행(최근 수정순) | `ui/mentor_room_home_screen.dart:45-60` |
| 방 홈 미리보기(멘토) | `myNote ??=` 내 행 · `studentNote ??=` `authorRole == student`인 첫 행 — 두 미리보기 모두 **"목록이 최신 우선"이라는 전제**에 기대고 있다(주석 "notes 는 최근 수정순") | `ui/mentor/student_room_home_screen.dart:52-65` |
| 모델 | `ConnectionNote` — `body`, `authorId`, `authorRole(student/mentor/unknown)`, `inkPath`, `inkThumbPath`, `hasInk` | `data/models/connection_note.dart` |
| 라벨 | `QuestionRoomLabels.noteAuthorRole` → '학생' / '멘토' / '작성자 미상' | `shared/labels/question_room_labels.dart:48-57` |
| 구독 가드 | **없음.** 저장 경로에 구독 상태 검사가 없다 → 앱에서는 RLS(방 당사자)만이 쓰기 게이트 | grep `subscription` in write repo/screen → 0건 |
| 실시간 | 노트에 대한 realtime 구독 없음. 저장 후 `_reload()`로 재조회 | `connection_notes_screen.dart:76-79, 89-92` |
| 버전 게이트 | `VersionGateShell`이 라우터 **위**에 얹혀 `forceUpdate`면 어떤 라우트에도 못 들어간다(로그인 전·후 무관). 정책은 RPC `get_mobile_app_version_policy(p_platform)`(anon EXECUTE)에서 읽는다. 원천 테이블 `mobile_app_version_policies(platform pk, min_supported_build, latest_build, minimum_version_name, store_url, message)` — RLS on·정책 0·anon/authenticated 권한 revoke → **service_role(SQL)로만 갱신**. 판정 정본은 build 정수(`min_supported_build`)이고 `minimum_version_name`은 표시용 — 앱도 `currentBuild < policy.minSupportedBuild`면 `GateForceUpdate`(`version_gate_decision.dart:38`). 현재 앱 build **19**(`pubspec.yaml` `version: 1.0.0+19`). 상향 선례: 마이그레이션 `20260806075353`이 `latest_build`를 16으로 올렸다(콘솔 UPDATE를 원장에 역수입) | `lib/core/version_gate/version_gate_shell.dart:7-12, 40-44` · `supabase_version_policy_port.dart:6-9, 22-25` · `supabase/sql/162_mobile_app_version_policy.sql:8-27` · `supabase/migrations/20260806075353_mobile_version_policy_latest_build_16.sql` |
| 테스트 | `test/screens/connection_notes_save_test.dart`(상대 노트 렌더 + '내 노트 저장' → `onSaveNote(body)`) · `connection_notes_boundary_test.dart`(빈/공백 차단·trim·10k자·이모지) · `test/widgets/note_author_badge_test.dart`(배지 라벨·`fromMap`) · `small_viewport_states_test.dart:203-235`(320×568에서 로딩·빈·에러 3상태 **overflow 없음** — 새 레이아웃도 통과해야 함) · `conversation_ui_layering_test.dart:20-45`(`lib/shared/conversation_ui`에 `connection_note`·`ConnectionNote` 등장 금지 — 타임라인이 `ConversationBubble`을 쓰더라도 **역방향 import 금지**) · `contracts/outbound_api_manifest_test.dart:91,133`(`.from('connection_notes')`·버킷 `connection-note-ink` 리터럴을 **테이블·RPC·버킷 집합**으로 고정. 작업 종류(update/delete)는 고정하지 않음 → append 전환으로 갱신 불필요. 단 `'connection-note-ink'` **상수 정의가 `lib/`에 남아 있어야 하고**(`:274-278`) — `InkStoragePaths`를 "dead code"로 지우면 깨진다 — append를 RPC로 바꾸면 `kExpectedRpcNames`에 추가해야 한다) | — |

### 2-3. 웹 (`7de04c6`) — 이미 append, UI가 1장으로 제한

| 확인 항목 | 코드 사실 | 근거 |
|---|---|---|
| 쓰기 | `saveConnectionNote`: **INSERT**(`mentor_student_room_id, body, author_id, author_role`). 주석 *"작성자별 카드를 유지하기 위해 매 저장마다 새 노트를 append"* | `lib/qna/questionRoomMutations.ts:42-70` |
| 서버 액션 | `saveConnectionNoteAction`: `requireQnaActor` → `assertAccountActive` → `assertMentorStudentRoomParty` → **`assertConnectionNoteWriteAllowed`(활성 구독 또는 진짜 무료방만)** → INSERT → `revalidatePath` → `?kind=note&ok=` 복귀. `updateConnectionNoteAction` / `deleteConnectionNoteAction`도 같은 게이트 + 작성자 본인 검사 + RLS | `lib/qna/questionRoomActions.ts:489-655` |
| 조회 | `fetchConnectionNotesForRoom`: `select *`, `updated_at desc`, **limit 없음** | `lib/qna/questionRoomQueries.ts:176-188` |
| 패널 | `ConnectionNotesPanel`: 헤더(함께한 기간·함께한 질문) + **2열**('학생의 노트' / '멘토의 노트'). 카드마다 본인이면 수정(인라인 폼)·삭제(`window.confirm`). **`canAdd = viewerRole === side && cards.length === 0`** — 내 노트가 1장이라도 있으면 '내 노트 추가' 버튼을 숨긴다. 주석: *"연결노트는 (room, author) 당 1개 — DB unique(connection_notes_room_author_unique)와 정합"* | `components/qna/ConnectionNotesPanel.tsx:147-151` |
| 모달 | `QuestionRoomNewNoteModal`: placeholder *"멘토에게 전달할 배경·목표를 짧게 남겨 주세요."* — 멘토가 열어도 같은 문구(학생 중심 카피) | `components/qna/QuestionRoomNewNoteModal.tsx:55-58` |
| 레거시 | 상세 4개 페이지가 `initialNoteText = extractNoteText(bundle.notes.rows[0])`를 계산해 `QuestionRoomWorkspace`에 넘기고, 워크스페이스가 `studentNoteText`/`mentorNoteText`(작성자별 **첫 1건**)를 memo로 만들어 구형 3단 레이아웃(`:270` 이하, '학생 참고 메모' 섹션 `:504-512`)에 렌더한다. 그런데 `surface="detail"` 호출 4곳은 전부 `roomId`(라우트)·`currentUserId`(세션)를 넘기므로 `:207`/`:238`의 신형 워크스페이스 분기에서 반환되고, **`:270` 이하 구형 렌더는 방어적 fallthrough — 실사용 도달 경로 없음** | `components/qna/QuestionRoomWorkspace.tsx:83, 111, 152-163, 166-270, 504-512` · `app/(student)/question-room/[roomId]/page.tsx:113,128` 외 3곳 |
| 오류 매핑 | 현행 제약 아래서 두 번째 INSERT는 `23505`(unique_violation)인데, `userFacingActionError`는 `violates`를 포함한 raw를 일반 문구로 치환한다. UI가 버튼을 숨겨 실제로는 도달하지 않는 경로 | `lib/qna/questionRoomActions.ts:32-45` |
| 계정 삭제 | `accountDeletionBucketCoverage`: 버킷 `connection-note-ink`를 `connection_notes.author_id` 소유 · `ink_path/ink_thumb_path` 경로로 등재. 행 수와 무관 | `lib/account/accountDeletionBucketCoverage.ts:105-111` |
| e2e | `e2e/connection-note-guard.spec.ts`: 가드 PASS/차단 4시나리오 + 만료 후 읽기 RLS. 마지막 테스트가 `connection_notes`에 학생 노트 1건을 **정리 없이 INSERT**한다 — 현행 제약에서는 2회차 실행부터 INSERT가 조용히 실패(오류 미검사)하고 이전 행으로 통과. 제약 제거 후에는 실행마다 행이 누적된다 → 정리 추가 필요(§8) | `e2e/connection-note-guard.spec.ts:191-197` |
| 관리자 | 관리자 콘솔에 연결노트를 읽는 코드 없음 | grep `connection_notes` in `app/(admin)`, `lib/admin` → 0건 |
| 문서 | `CLAUDE.md` 핵심 테이블 표의 `connection_notes` 행이 `status` 컬럼을 적고 있으나 **라이브에 `status` 컬럼은 없다** → 개편 PR에서 행 정정 권고(§7-3) | `CLAUDE.md` "핵심 DB 테이블" |

### 2-4. 두 클라이언트의 계약이 이미 다르다

| | 앱 | 웹 |
|---|---|---|
| 저장 의미 | 내 노트 1장을 고쳐 쓴다(UPDATE) | 새 장을 덧붙인다(INSERT) |
| 여러 장 방지 | 코드(최신 1건 갱신 + 나머지 삭제) | UI(버튼 숨김) |
| 수정·삭제 | 없음(덮어쓰기만) | 본인 카드 수정·삭제 |
| 구독 가드 | 없음 | 있음 |

제약이 "두 계약의 접착제" 역할을 하고 있었다. 제약을 지우면 이 차이가 그대로 사용자에게 드러나므로, 개편은 **두 클라이언트를 같은 계약(append)으로 맞추는 작업**이기도 하다.

---

## 3. 목표 모델 — 방 단위 누적 타임라인

| 항목 | 계약 |
|---|---|
| 단위 | `mentor_student_rooms` 1방 = 타임라인 1개 |
| 행 | 노트 1장 = `connection_notes` 1행. 작성자(`author_id`·`author_role`)가 남긴 순서대로 쌓인다 |
| 정렬 키 | 저장소 조회는 **`created_at desc, id desc`**(최신 우선 — 방 홈 미리보기 2종이 "첫 행 = 최신" 전제라 **무변경**), 타임라인 화면은 그 목록을 **뒤집어** 오래된 것 위·최신 아래로 그린다. `updated_at` 정렬 폐기(수정 시 순서가 튀는 것 방지) |
| 쓰기 | INSERT만. 웹: 구독 활성(서버 액션 가드) + 방 당사자(RLS). **앱: 방 당사자(RLS)만** — 구독 규칙이 앱 경로에는 없다(결정 #8) |
| 수정·삭제 | **결정 #2**. 권장: **수정은 작성 후 15분 이내 본인 행만, 삭제는 불가**(append-only 기록) + `created_at` 불변 트리거. 이 조합이 구클라이언트 DELETE 경로를 서버에서 완전히 무력화한다(§5-3) |
| 본문 | 텍스트. 길이 상한 **결정 #3**(권장 2,000자, 클라이언트 강제) |
| 손글씨 | 컬럼 유지, 기능 없음 |
| 조회 | 방 전체(현행과 동일, limit 없음). 페이징은 **결정 #4** |

---

## 4. DB 변경

### 4-1. DDL (본문은 §12)

| 순서 | 문장 | 비고 |
|---|---|---|
| A | 게이트: 제약 존재 여부 확인, 없으면 NOTICE 후 통과 | 멱등 |
| B | `alter table public.connection_notes drop constraint if exists connection_notes_room_author_unique;` | unique index도 함께 제거됨 |
| C | `create index if not exists idx_cn_room_created on public.connection_notes (mentor_student_room_id, created_at);` | 타임라인 정렬용. 기존 `idx_cn_msr`(updated_at desc)·`idx_cn_author`는 유지 |
| D | `comment on table public.connection_notes is '…누적 타임라인…';` | 계약 기록 |
| E | 사후 확인 DO 블록(제약 부재·인덱스 존재) | 실패 시 예외 |
| F-1 | (**결정 #2** 채택 시) `cn_update`를 "작성 후 15분 이내 본인 행"으로 재정의 | 정책 이름 불변(drop/create 같은 이름) |
| F-2 | (**결정 #2** 권장안) `cn_delete` 정책 **제거** → authenticated 삭제 불가. 대안: 15분 창으로 재정의(잔여 위험 §5-3) | 정책 수 176→**175**(제거 시) |
| F-3 | (**결정 #2** 채택 시) `created_at` 불변 트리거 `trg_cn_created_at_immutable` + 함수 `connection_notes_forbid_created_at_change()` — 창 안의 행을 `created_at = now()`로 갱신해 창을 무한 연장하는 우회 차단 | 함수 수 222→**223** |

**바꾸지 않는 것**: 컬럼 전부(잉크 2열 포함) · `cn_select`/`cn_insert` · 기존 트리거 `trg_cn_set_updated` · FK 2종 · 버킷.

### 4-2. 롤백
(방, 작성자) 중복이 0건일 때만 가능하다.
```sql
select mentor_student_room_id, author_id, count(*)
  from public.connection_notes group by 1, 2 having count(*) > 1;  -- 0행이어야 함
alter table public.connection_notes
  add constraint connection_notes_room_author_unique unique (mentor_student_room_id, author_id);
drop index if exists public.idx_cn_room_created;
-- F 채택 시: 085 원문(supabase/sql/085_connection_notes_author_rls.sql)으로 cn_update/cn_delete 재적용
```

### 4-3. 저장소 마이그레이션 절차 (이 저장소의 현행 규약)

`091d949`(iM뱅크, 2026-08-31)·`8ebe231`(TZ-FIX R3)에서 확인한 **3본 동일 파일** 규약을 따른다. 세 파일은 바이트 단위로 같아야 한다(md5 대조 확인: `189_*` = `post_ledger_backfills/20260831100100_*` = `migrations/20260831100100_*`).

| # | 파일 | 소유 | 비고 |
|---|---|---|---|
| 1 | `supabase/sql/190_connection_notes_timeline_drop_unique.sql` | 사람 | 가독용 정본. 189가 현재 마지막 번호 |
| 2 | `supabase/baseline/post_ledger_backfills/2026MMDD100100_connection_notes_timeline_drop_unique.sql` | 사람 | pack 소스. version은 "적용 예정일 + `100100`" 패턴(같은 날 2본째는 `100200`) |
| 3 | `supabase/migrations/2026MMDD100100_…sql` | **생성기** | `python3 scripts/verify/baseline/build_native_migration_pack.py` 가 복사. 직접 편집 금지 |
| 4 | `supabase/baseline/native_migration_pack_manifest.tsv` | 생성기 | 행 1개 추가(현재 102행 → 103) |
| 5 | `docs/audit/sql_apply_manifest.md` | 사람 | 신규 SQL 등재 행 |
| 6 | `docs/audit/db_expected_state.md` | 사람 | `connection_notes` 행에 "(방, 작성자) 유일성 없음 · 타임라인" 추기 |
| 7 | `CLAUDE.md` 핵심 테이블 표 | 사람 | `connection_notes` 행 정정(`status` 없음 → `author_id, author_role, body, created_at`) |

검증(로컬, PR 전): `validate_native_migration_pack.py` · `validate_replay_manifest.sh` PASS, 생성기 재실행 diff 0. CI `db-migration-pack-verify.yml`이 PG17 + Supabase CLI replay로 다시 검증한다. `verify_local_stack_state.sh`의 구조 카운트(tables 85 · functions 222 · policies 176 · buckets 13, `:112-117`)는 A~E만이면 **바뀌지 않는다**(제약·인덱스는 그 카운트에 없다). F를 채택하면 **functions 223(F-3 함수)** · **policies 175(F-2 제거 시)** 로 기대치를 함께 갱신해야 한다(선례: `ea146b5` "로컬 스택 구조 카운트 기대치 갱신"). `run_local_stack_emulation.sh`의 STRICT 축(constraints·indexes md5)은 `PR60_FORWARD`가 설정된 `[6]` 블록에서 PR #60 전후 지문만 대조한다(`:104-117`) — 일반 마이그레이션 추가에는 적용되지 않으므로 기대값 갱신은 없다.

적용: **`db-apply-pending.yml` workflow_dispatch**(dry-run → 승인 → apply, confirmation 문자열). MCP `apply_migration` 직접 적용은 저장소 규칙상 금지(적용하면 같은 세션에서 역수입까지 해야 한다 — `CLAUDE.md` "마이그레이션 hotfix 역수입 규칙").

---

## 5. 구클라이언트 위험과 방어

### 5-1. 무엇이 일어나는가

제약을 지우고, 새 앱/웹으로 내 노트를 3장 남긴 상태에서 **구버전 앱(1.0.0+19)** 이 '내 노트 저장'을 누르면:

1. `existing` = 내 노트 3건(`updated_at desc`)
2. `existing.first`(가장 최근 장)를 편집기 내용으로 **UPDATE** — 편집기는 그 장의 본문으로 시드됐으므로 사실상 "최신 장 수정"
3. `existing.skip(1)` 2건을 **DELETE** — RLS `cn_delete`는 본인 행이면 허용하므로 **성공한다**
4. 결과: 과거 노트 2장 소실. 사용자는 아무 경고도 보지 못한다(best-effort, `catch (_) {}`)

근거: `question_room_write_repository.dart:202-235`. 이 코드는 **제약이 없던 시절의 방어**였고, 제약을 지우면 원래 목적(중복 정리)이 "타임라인 파괴"로 바뀐다. 상대방의 노트는 건드리지 않는다(RLS가 본인 행만 허용). 내 노트가 0장인 방에서는 INSERT 경로(`:237-247`)로 정상 저장되므로, **구앱 사용자는 내 노트가 2장 이상 쌓이기 전까지 아무 이상도 느끼지 못한다** — 조용한 위험이다.

### 5-2. 방어 1 — 순서 (필수)

여러 장이 **존재할 수 있게 되는 순간**을 구버전 앱이 사라진 뒤로 미룬다.

| 단계 | 여러 장이 생길 수 있나 | 구앱이 남아 있나 | 안전 |
|---|---|---|---|
| 제약만 제거 | ✗ (웹 UI 버튼 숨김 · 앱은 UPDATE) | ○ | **안전** |
| + 앱 신버전 배포 | ✗ (신앱만 append, 아직 웹 UI 그대로) | ○ | 안전. 단 신앱으로 2장 남긴 사용자가 **구앱으로 되돌아가면** 위험 — 같은 계정이 구·신 두 기기를 쓰는 경우 |
| + 강제 업데이트 게이트 상향 | ✗ | **✗** | 안전 |
| + 웹·앱 UI 여러 장 허용 | ○ | ✗ | 안전 |

**게이트 상향은 "권장"이 아니라 "강제"여야 한다.** `recommend`는 배너만 얹고 앱 사용을 막지 않는다(`version_gate_shell.dart:47-57`). 게이트는 라우터 위에 있어 `forceUpdate` 상태에서는 저장 화면에 도달할 수 없다(`:7-12`).

상향 방법(현행 인프라, 관리자 UI 없음): 신앱 build를 N(≥20)이라 할 때
```sql
update public.mobile_app_version_policies
   set min_supported_build = N, latest_build = greatest(latest_build, N),
       minimum_version_name = '<신앱 표시 버전>', updated_at = now()
 where platform in ('android', 'ios');
```
`162` 헤더가 "실제 최소 build 상향은 운영 절차로만"이라 못 박았고, 선례 `20260806075353`은 콘솔 UPDATE를 마이그레이션으로 역수입했다. 권장은 처음부터 **마이그레이션(`191`)으로 등재해 `db-apply-pending`으로 적용** — 재현 가능하고 역수입이 필요 없다.

**게이트의 구멍(코드 확인).** 게이트는 `main.dart:55`에서 앱 시작 시 **한 번만** 평가되고 복귀(resume) 시 재검사가 없다. 따라서 (a) 상향 시점에 이미 떠 있는 구앱 세션은 **프로세스를 재시작할 때까지** 계속 저장할 수 있다. (b) 오프라인 콜드 스타트는 직전 통과 build의 캐시로 통과한다(`version_gate_controller.dart:90-95`) — 이후 연결이 돌아오면 저장 가능. (c) 빌드 번호를 못 읽으면 통과(`version_gate_decision.dart:37`), (d) 웹 타깃은 게이트가 아예 없다(`gate_platform.dart:11`). 그러므로 "③ 완료"는 **"모든 구앱이 온라인에서 한 번 재시작한 뒤"** 로 읽어야 하고, 이 구멍을 메우는 것이 §5-3이다.

### 5-3. 방어 2 — 서버 정책 (권장 · **결정 #2**)

순서는 운영 규율에 기대는 방어다. DB가 스스로 막게 하려면 정책을 바꿔야 하는데, **"수정·삭제 모두 15분 창"만으로는 부족하다.** 구앱의 저장 순서는 UPDATE(최신 내 노트) → 성공 시 DELETE(나머지 내 노트)이고, RLS는 거부가 아니라 **필터**라서:

| 상황 | 창 정책(수정·삭제 15분) 아래 구앱 동작 | 결과 |
|---|---|---|
| 최신 내 노트가 15분 지남 | UPDATE 0행 → `.select().single()` 예외 → 레포에서 미포착 → DELETE 블록에 **도달 못 함** → 화면 `catch`가 스낵바 '저장에 실패했어요. 요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.' (`connection_notes_screen.dart:98-103`, `friendly_error.dart:11-14`). 크래시 없음, 편집기 텍스트 유지 | **보존** |
| 최신 내 노트가 15분 이내 | UPDATE 성공(= 정정 창 동작) → DELETE 실행: 15분 지난 행은 0행, **15분 이내 행은 삭제됨** → '노트를 저장했어요.' | **잔여 손실**(최근 15분 내 내 노트) |

잔여 손실을 없애는 조합이 **"수정 15분 창 + 삭제 불가"** 다. `cn_delete` 정책을 제거하면 authenticated는 어떤 행도 지울 수 없고(구앱의 DELETE는 항상 0행, `catch (_)`로 무음), UPDATE는 창 안의 최신 장 1건에만 닿는다 — 즉 구앱이 할 수 있는 최악이 "방금 쓴 내 노트를 고쳐 쓰기"가 된다. 여기에 `created_at` **불변 트리거**(F-3)를 붙여야 하는데, 창 정책의 `WITH CHECK`만으로는 클라이언트가 창 안의 행을 `created_at = now()`로 갱신해 창을 무한히 연장하는 우회를 막지 못하기 때문이다.

- 제품 의미: 타임라인은 "곧 불변"이 된다. 오타는 15분 안에 고치고, 지우기는 없다(잘못 쓴 노트는 정정 노트로 덮는다). 웹의 수정 UI는 창 안에서만, 삭제 UI는 사라진다.
- 비용: 정책 1개 재정의 + 정책 1개 제거 + 트리거 함수 1개 → §4-3의 구조 카운트 기대치 갱신(policies 175 · functions 223).
- 대안(삭제도 15분 창): UI에 삭제가 남지만 위 표의 잔여 손실이 남는다 — 같은 계정이 15분 안에 신·구 두 기기를 번갈아 쓰는 경우에 한정되므로 작지만 0은 아니다.

채택하지 않으면 방어 1만 남는다. 그 경우 §9의 ③(게이트 상향)을 ④ 전에 **반드시** 끝내고, 위 게이트 구멍 때문에 ③과 ④ 사이에 **재시작 유예(권장 48시간 이상)** 를 두어야 하며, 두 기기 병용 사용자의 위험은 그래도 남는다.

---

## 6. 앱 변경 (골격 유지)

| 파일 | 변경 | 골격 |
|---|---|---|
| `data/question_room_write_repository.dart` | `upsertMyNote` → **`appendMyNote(roomId, body)`**: INSERT 블록(`:237-247`)만 남기고 SELECT-existing(`:202-207`)·UPDATE(`:210-218`)·DELETE(`:221-233`) 경로 삭제. `_currentAuthorRoleCode` 유지. 문서 주석(`:185-193`, "UNIQUE 없음" 근거) 교체 | — |
| `data/question_room_read_repository.dart` | `notes(roomId)` 정렬을 `updated_at desc` → **`created_at desc, id desc`**(최신 우선 유지). 미리보기 2종은 그대로 동작. 화면이 `.reversed`로 뒤집는다. 페이징(결정 #4)을 채택하면 `recentMessages`/`messagesBefore`·`MessageCursor(createdAt:, id:)`·`messageCursorBeforeFilter`를 그대로 미러링 | — |
| `ui/connection_notes_screen.dart` | '상대 노트'/'내 노트' 2섹션 → **한 타임라인**(학생·멘토 카드 혼합, 기존 `_NoteCard` + `AppBadge` 작성자 배지 그대로, 내 카드는 `mine` 플래그로 톤만) + 하단 **작성 카드**(기존 `AppCard` + `TextField` + `PrimaryButton`, 라벨 '내 노트 저장' → **'노트 남기기'**, 힌트 문구 교체). 저장 성공 시 **`_editor.clear()`를 명시 호출**한 뒤 `_reload()` — `_seeded`를 지우는 것만으로는 편집기가 비지 않는다(`:140-144`). `mine`/`others` 분리·`_seeded` 삭제. 카드 시각을 `updatedAt`(`:217`) → **`createdAt`**. 빈 상태 `EmptyState` 유지. 생성자 seam(`notesLoader`·`onSaveNote`·`currentUserId`) 유지 — 테스트가 의존 | `Scaffold`·`AppBar('연결노트')`·`ListView` 유지 |
| `ui/mentor_room_home_screen.dart` | **변경 없음** — 조회가 최신 우선을 유지하므로 `break`-on-first(`:50-55`)가 그대로 "최신 멘토 노트" | 카드 유지 |
| `ui/mentor/student_room_home_screen.dart` | **변경 없음** — `??=`(`:58-65`)가 그대로 "최신" | 카드 유지 |
| `shared/labels/question_room_labels.dart` | 변경 없음('학생'/'멘토'/'작성자 미상') | — |
| `data/models/connection_note.dart` | 필드 변경 없음. 주석 `:3` "작성자별 행이 따로 쌓인다" → "방 타임라인, 작성자당 여러 행" (주석만) | — |
| `lib/core/ink/ink_storage_paths.dart` | **삭제 금지**(§2-2 테스트 행). 경로 규약이 `{roomId}/{authorId}/ink.json` 작성자당 1파일이라 여러 장 노트와 호환되지 않는다 — 손글씨를 되살릴 때 노트 id 기준으로 바꿔야 한다는 메모만 남긴다 | — |
| `docs/APP_FEATURE_STATUS.md:142` | "`upsertMyNote` 실쿼리" 설명을 `appendMyNote`·타임라인으로 갱신 | — |
| (선택) 본문 길이 | `TextField(maxLength: 2000)` — **결정 #3** | — |
| (선택) 편집 창 | 앱에 수정·삭제 UI는 **추가하지 않는다**(현행에도 없음). 창 정책은 서버만 | — |
| `ConversationBubble` 사용 여부 | 계층 테스트상 허용(feature → shared 방향)이나 `_NoteCard`(`AppCard` + `AppBadge`)를 유지하는 쪽이 골격 유지·`note_author_badge_test` 계약에 맞다 → 1차는 `_NoteCard` | — |

`docs/SCAN_INK_PLAN.md`(앱 저장소) 참조 주석은 그대로 둔다.

---

## 7. 웹 변경 (골격 유지)

### 7-1. `components/qna/ConnectionNotesPanel.tsx`
- `canAdd` 조건에서 `cards.length === 0` 제거 → **구독 활성 사용자는 항상 추가 가능**(서버 가드가 최종). 주석의 unique 언급 삭제.
- 2열('학생의 노트'/'멘토의 노트') 유지 여부는 **결정 #1**. 권장은 **한 타임라인**(카드의 좌측 색 띠·작성자 라벨이 이미 역할을 구분한다) — 우측 레일·헤더(함께한 기간·함께한 질문)·모바일 토글은 그대로.
- 정렬: 서버 조회 `created_at asc` 기준으로 위→아래.
- 수정·삭제: **결정 #2(b′)** 채택 시 `editable`에 "작성 15분 이내" 조건 추가(서버 정책과 같은 기준, `created_at` 비교 — 서버가 최종 판정이므로 클라이언트 시계 오차는 실패 메시지로만 드러난다) 하고 **삭제 버튼·`deleteConnectionNoteAction` 호출 UI를 제거**(정책이 없으니 DELETE는 0행). 서버 액션 `deleteConnectionNoteAction` 자체는 남겨도 무해하나 dead가 되므로 삭제 권고. (b) 채택 시에는 삭제도 창 조건, 확인은 현행 `window.confirm` 유지(CLAUDE.md 규칙 9는 `alert()`만 금지).
- 카운트 배지: 총 장수.

### 7-2. `components/qna/QuestionRoomNewNoteModal.tsx`
- 제목 '새 노트 작성' → '노트 남기기'(**카피 결정 #5**). placeholder를 역할별로: 학생 *"이번 주 공부에서 막힌 점, 다음 목표를 남겨 주세요."* / 멘토 *"학생에게 남길 피드백·다음 주 계획을 적어 주세요."* (초안, 오너 확정).
- (선택) `maxLength={2000}`.

### 7-3. 조회·액션·문서
- `lib/qna/questionRoomQueries.ts` `fetchConnectionNotesForRoom`: `order("created_at", { ascending: true })`.
- `lib/qna/questionRoomActions.ts`: 변경 없음(INSERT·가드·리다이렉트 계약 그대로). `?kind=note` 복귀·`dNote` 초안 보존 계약(`questionRoomRedirect.contract.test.ts`) 유지.
- 레거시 `initialNoteText`/`studentNoteText`/`mentorNoteText`와 `QuestionRoomWorkspace.tsx:270` 이하 구형 렌더: 실사용 도달 경로가 없다(§2-3). 이번 개편의 필수 범위는 아니며, 상세 4개 페이지의 `extractNoteText(bundle.notes.rows[0])` 계산과 함께 **별도 정리 PR에서 삭제**를 권고한다. 남겨 두면 "첫 1건"이 정렬 변경 후 "가장 오래된 1건"이 되어 의미가 어긋난다.
- `CLAUDE.md` 핵심 테이블 표 `connection_notes` 행 정정 · `docs/architecture/purpose-report/04-subscription-qna.md`의 "연결노트 패널" 절은 감사 스냅샷이므로 그대로 둔다.

---

## 8. 테스트 계획

### 8-1. 앱
| 파일 | 조치 | 내용 |
|---|---|---|
| `test/screens/connection_notes_save_test.dart` | 수정 | 라벨 리터럴 `'내 노트 저장'`(`:52, 55`) → 새 라벨. 추가: 멘토·학생 노트가 한 리스트에 `createdAt` 순, 탭 후 `onSaveNote(body)` 호출 **및** 컨트롤러 텍스트 `''`(편집기 비움) |
| `test/screens/connection_notes_boundary_test.dart` | **수정** | 라벨 리터럴 `'내 노트 저장'`(`:46, 52, 70`)·스낵바 `'노트를 저장했어요.'`(`:55`)가 하드코딩 — 라벨을 바꾸면 반드시 손봐야 한다. 빈/공백 차단·trim·10k자·이모지 케이스 유지 · (결정 #3) 상한 초과 입력 차단 추가 |
| `test/widgets/note_author_badge_test.dart` · `test/labels/question_room_labels_test.dart` | 유지 | 배지 구성·라벨 불변 |
| 신규 `test/screens/connection_notes_timeline_test.dart` | 추가 | 같은 작성자(`currentUserId`) 노트 3장이 **모두** 렌더(구 `mine.first` 시드 회귀 방지), 상대 노트와 `createdAt` 순으로 섞임, 편집기는 비어서 시작 |
| 신규 `test/data/connection_note_append_wire_test.dart` | 추가 | 쓰기 레포에는 클라이언트 주입 seam이 없어(`:49-55` 전역 `SupabaseInit`) 스텁으로 INSERT/UPDATE를 관찰할 수 없다 → `test/data/message_paging_postgrest_wire_test.dart:14-27`의 `MockClient` 패턴을 미러링: `POST /rest/v1/connection_notes` 정확히 1회(body 키 `mentor_student_room_id, author_id, author_role, body`, `Prefer: return=representation`), `PATCH`/`DELETE` 0회 |
| `test/contracts/outbound_api_manifest_test.dart` | 추가(가드) | 테이블·RPC·버킷 집합은 불변. `:298-311`(`from('users')`는 SELECT 전용) 패턴을 본떠 **"`from('connection_notes')` 체인에 `.update(`·`.delete(` 금지"** 가드를 추가 — append-only를 정적으로 잠근다. append를 RPC로 바꾸면 `kExpectedRpcNames`에 추가 |
| `test/contracts/outbound_api_manifest_test.dart` | 유지 | 테이블·RPC·버킷 리터럴 집합만 고정(`:91` `connection_notes`, `:133` `connection-note-ink`). 작업 종류는 고정하지 않으므로 append 전환으로 바뀌지 않는다 |
| `test/screens/small_viewport_states_test.dart` | 유지 | 320×568 로딩·빈·에러 3상태 overflow 없음 — 타임라인+하단 작성 카드 레이아웃이 그대로 통과해야 한다 |
| `test/shared/conversation_ui_layering_test.dart` | 유지 | `lib/shared/conversation_ui`에 `ConnectionNote`를 들이지 않는다(외관 계층 → 노트 화면 방향만 허용) |

### 8-2. 웹
| 파일 | 조치 | 내용 |
|---|---|---|
| `lib/qna/__contract__/connectionNoteFreeRoom.contract.test.ts` | 유지 | 가드 계약 불변 |
| `lib/qna/__contract__/questionRoomRedirect.contract.test.ts` | 유지 | `kind=note`·`dNote` 계약 불변 |
| 신규 `components/qna/__contract__/connectionNotesPanel…` | 추가 | 같은 작성자 카드 N장 렌더 · 내 노트가 있어도 추가 버튼 노출 · (결정 #2) 15분 지난 카드는 수정·삭제 버튼 없음 |
| `e2e/connection-note-guard.spec.ts` | 수정 | 시드 INSERT 전에 해당 방의 `connection_notes` 정리(누적 방지) · 활성 구독에서 같은 학생이 2장 INSERT 성공하는 케이스 추가 |

### 8-3. DB
- 마이그레이션 자체 검증 블록(E)로 제약 부재·인덱스 존재.
- (결정 #2) `scripts/verify/`에 정책 검증 추가: 본인 행이라도 `created_at < now() - 15min`이면 UPDATE/DELETE 0행. 스타일은 `s2_2_batch_d_verify.sql`(트랜잭션 내 fixture → 검증 → rollback).
- 구클라이언트 시뮬레이션: 한 작성자 행 3건 시드(최신 1건은 15분 이내, 2건은 그 이전) → "최신 1건 UPDATE + 나머지 DELETE"를 authenticated 컨텍스트로 실행 → **UPDATE 1행(정정), DELETE 0행**(F-2 채택 시) 확인. `created_at = now()` UPDATE가 트리거로 거부되는지(F-3) 확인.

---

## 9. 배포 순서 (게이트 조건 포함)

| # | 단계 | 게이트(다음으로 넘어가는 조건) |
|---|---|---|
| ① | DB: `190` 적용(제약 제거 + 인덱스 + 결정 #2 시 정책) via `db-apply-pending` | 원장에 version 등재 · pg_constraint에서 제약 부재 확인 · 웹·앱 동작 변화 **없음**(웹 버튼 숨김·앱 UPDATE 그대로) |
| ② | 앱: `appendMyNote` + 타임라인 화면 빌드 → 스토어 심사·배포 | CI(analyze·test) 그린 · 스토어 게시 완료 · 결제 무관 기능이라 심사 리스크 낮음(인계 §5 권고 순서 ①단계에 해당) |
| ③ | 버전 게이트: `mobile_app_version_policies.min_supported_build`를 ②의 build로 상향(**forceUpdate**, §5-2 SQL · 마이그레이션 `191` 권장) | 원장 등재 · `get_mobile_app_version_policy('ios'/'android')` 응답 확인 · 구앱(build 19) 콜드 스타트가 `ForceUpdateScreen`에서 멈추는 것을 테스트 기기로 확인 · 스토어 바이너리의 실제 `buildNumber`가 19인지 확인(§11) |
| ④ | 웹: 패널 `canAdd` 개방 + 타임라인 정렬 + 카피 배포 | 결정 #2 채택 시 ③ 직후 가능. 미채택 시 ③ 후 **재시작 유예 48시간 이상**(게이트는 콜드 스타트에서만 평가) |
| ⑤ | 문서: `db_expected_state.md`·`CLAUDE.md` 행 갱신, 앱 `APP_FEATURE_STATUS.md`, 계약 문서 | — |

결정 #2(수정 15분 창 + 삭제 불가 + `created_at` 불변)를 채택하면 ①에 정책이 포함되어 ④가 ③보다 먼저 가도 데이터 소실은 없다(구앱은 "방금 쓴 노트 고쳐 쓰기" 이상을 할 수 없다). 채택하지 않으면 **③→④ 순서와 재시작 유예가 유일한 방어**다.

클라우드 초기화가 예정돼 있다면 ①은 초기화 **후** 새 pack에 포함된 채로 재적용되면 되고, 초기화 전에 적용해도 행 0건이라 차이가 없다.

---

## 10. 오너 결정 필요 항목

| # | 질문 | 선택지 | 권장 |
|---|---|---|---|
| 1 | 웹 패널 레이아웃 | (a) 2열 유지(학생/멘토 각각 타임라인) · (b) 한 타임라인(역할 색 띠·라벨로 구분) | **(b)** — 학생 노트에 멘토가 답하는 흐름이 한 줄로 읽힌다. 앱도 (b)라 두 클라이언트가 같은 모양 |
| 2 | 수정·삭제 정책 | (a) 현행(본인 행 언제나) · (b) 수정·삭제 모두 15분 창 · (b′) **수정 15분 창 + 삭제 불가** + `created_at` 불변 트리거 · (c) 수정·삭제 모두 불가 | **(b′)** — 오타 정정은 허용하면서 기록은 곧 불변. 구클라이언트의 DELETE 경로를 서버가 **완전히** 무력화한다(§5-3). (b)는 최근 15분 내 노트에 잔여 손실이 남는다 |
| 3 | 본문 길이 상한 | (a) 없음(현행) · (b) 2,000자 클라이언트 강제 · (c) DB CHECK 추가 | **(b)** — DB 변경 최소. 상한값은 조정 가능 |
| 4 | 조회 페이징 | (a) 무제한(현행) · (b) 최근 200장 + '이전 노트 보기' | **(a)로 시작** — 주 4~9 질문 방에서 노트는 그보다 적다. 방당 200장 넘는 사례가 나오면 (b) |
| 5 | 카피 | 버튼 '노트 남기기' · 모달 제목 · 역할별 placeholder(§7-2 초안) | 초안 승인 또는 수정 |
| 6 | 앱 '내 노트' 편집기 위치 | (a) 하단 고정 카드(현행 자리) · (b) 채팅형 입력 바 | **(a)** — 골격 유지 |
| 7 | 강제 업데이트 시점 | ②배포 직후 즉시 · 며칠 유예(recommend) 후 강제 | **즉시** — 결정 #2 미채택이면 더더욱 |
| 8 | 앱 경로의 구독 규칙 | (a) 현행 비대칭 유지(웹만 차단, 앱은 RLS 방 당사자만) · (b) `cn_insert` 술어에 "활성 구독 또는 구독 이력 없는 무료 방" 조건 이관(웹 가드 `assertConnectionNoteWriteAllowed`와 같은 판정을 SQL로) · (c) append RPC 신설 | **1차 (a)** — 현행에도 없던 규칙이라 회귀가 아니다. (b)는 정책 술어에 `subscriptions` 서브쿼리가 들어가는 별도 DB 변경이므로 후속 트랙으로 분리(구클라이언트에도 묶이는 유일한 방법이라는 점은 기록) |

---

## 11. 미확인 항목

| # | 항목 | 확인 방법 |
|---|---|---|
| 1 | 앱 `1.0.0+19`(코드 `635ae738`)가 실제 스토어 배포본과 같은지 — §5의 위험 분석은 이 코드 기준 | 스토어 콘솔 · `mobile_app_version_policies.latest_build` 값 대조 |
| 2 | 클라우드 초기화 일정과 ①의 선후 | 오너 |
| 3 | 스토어 바이너리의 `PackageInfo.buildNumber`가 실제로 19인지(CI가 `--build-number`를 따로 넘기면 다를 수 있다) — ③의 `min_supported_build` 값이 이에 걸린다 | 스토어 콘솔 · CI 워크플로 |
| 4 | Flutter 웹 타깃(`web/` 디렉터리 존재, `kIsWeb` 분기)이 어딘가 배포돼 있는지 — 배포돼 있으면 게이트가 아예 없다 | 오너 |
| 5 | `.select().single()` 0행 시 PostgREST 오류 코드(예상 `PGRST116`) — 라이브러리 소스 미확인. 앱의 `catch` 경로는 코드로 확인됨(§5-3) | 실기기 1회 |
| 6 | 웹 `window.confirm` 삭제 확인 — 결정 #2(b′) 채택 시 삭제 UI 자체가 사라져 무관. (b) 채택 시 `AppToast`/모달로 바꿀지 | 관리자 콘솔 확인 모달 공통화 트랙과 함께 결정 |
| 7 | `supabase_realtime` publication에 `connection_notes`가 포함되는지 — 지금은 무관(앱·웹 모두 realtime 없음), 실시간 타임라인을 원할 때 필요 | DB 조회 |

(초안 시점의 미확인 — outbound manifest·소형 뷰포트/계층 테스트·레거시 memo 도달 여부·로컬 스택 md5·버전 정책 원천·구앱 예외 처리 경로 — 는 코드 열람으로 해소해 §2·§4·§5·§8에 반영했다.)

---

## 12. 부록 — 마이그레이션 SQL 초안 (`190_connection_notes_timeline_drop_unique.sql`)

> 파일로 만들지 않았다. 오너 승인 후 §4-3 절차로 등재한다. `2026MMDD`는 적용 예정일로 채운다. F 블록은 결정 #2 채택 시에만 포함한다.

```sql
-- =============================================================================
-- 190_connection_notes_timeline_drop_unique.sql  (2026-MM-DD)
--
-- Purpose: 연결노트를 "(방, 작성자)당 1장 편집" 에서 "방 단위 누적 타임라인(append)"
--   으로 전환한다. 유일성 제약 connection_notes_room_author_unique 를 제거하고
--   타임라인 정렬용 인덱스를 추가한다. 컬럼·FK·트리거·cn_select·cn_insert 는 불변.
--
-- Base: supabase/migrations/20260806033452_connection_notes_room_author_unique.sql
--   (원장 20260806033452 — 제약 추가 1문). 라이브 실측 2026-09-02: 행 0건.
--
-- Apply: 저장소 표준 경로(db-apply-pending) — MCP apply_migration 직접 적용 금지.
--   pack 등재: supabase/baseline/post_ledger_backfills/2026MMDD100100_connection_notes_timeline_drop_unique.sql
--
-- Rollback: 말미 (R) 블록 — (방, 작성자) 중복 0건 전제로 제약 재생성.
-- =============================================================================

begin;

-- A. 사전 게이트 — 제약이 이미 없으면 통과(멱등). 있으면 진행.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.connection_notes'::regclass
       AND conname  = 'connection_notes_room_author_unique'
  ) THEN
    RAISE NOTICE '190_GATE: connection_notes_room_author_unique already absent - nothing to drop';
  END IF;
END $$;

-- B. 유일성 제약 제거 (제약이 만든 unique index 도 함께 사라진다)
ALTER TABLE public.connection_notes
  DROP CONSTRAINT IF EXISTS connection_notes_room_author_unique;

-- C. 타임라인 정렬 인덱스 (방 단위 created_at 순). idx_cn_author · idx_cn_msr 는 유지.
CREATE INDEX IF NOT EXISTS idx_cn_room_created
  ON public.connection_notes (mentor_student_room_id, created_at);

-- D. 계약 주석
COMMENT ON TABLE public.connection_notes IS
  '연결노트 — mentor_student_rooms 1방 = 누적 타임라인 1개. 한 작성자(author_id)가 여러 행을 append 한다. '
  '(2026-09 개편: 구 (방,작성자) 유일 계약 폐기. 손글씨 ink_path/ink_thumb_path 는 예약 컬럼, 기능 없음)';

-- F. (결정 #2 (b′) 채택 시) 수정 15분 창 + 삭제 불가 + created_at 불변.
--    구클라이언트(build 19)의 '최신 1건 UPDATE + 나머지 DELETE' 경로: UPDATE 는 창 안의 최신 내 노트 1건에만
--    닿고(= 정정), DELETE 는 정책 부재로 항상 0행(앱은 catch(_) 로 무음). 데이터 소실 경로가 사라진다.
-- F-1. cn_update — 작성 후 15분 이내 본인 행만 (이름 085 와 동일)
-- DROP POLICY IF EXISTS "cn_update" ON public.connection_notes;
-- CREATE POLICY "cn_update" ON public.connection_notes
--   FOR UPDATE TO authenticated
--   USING (
--     author_id = (SELECT auth.uid())
--     AND created_at > now() - interval '15 minutes'
--     AND EXISTS (SELECT 1 FROM public.mentor_student_rooms r
--                  WHERE r.id = connection_notes.mentor_student_room_id
--                    AND (SELECT auth.uid()) IN (r.student_id, r.mentor_id))
--   )
--   WITH CHECK (
--     author_id = (SELECT auth.uid())
--     AND EXISTS (SELECT 1 FROM public.mentor_student_rooms r
--                  WHERE r.id = mentor_student_room_id
--                    AND (SELECT auth.uid()) IN (r.student_id, r.mentor_id))
--   );
-- F-2. cn_delete 제거 — authenticated 삭제 불가 (append-only). 대안(잔여 위험 §5-3): 15분 창으로 재정의.
-- DROP POLICY IF EXISTS "cn_delete" ON public.connection_notes;
-- F-3. created_at 불변 트리거 — 창 안의 행을 created_at = now() 로 갱신해 창을 연장하는 우회 차단
-- CREATE OR REPLACE FUNCTION public.connection_notes_forbid_created_at_change()
-- RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
-- BEGIN
--   IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN
--     RAISE EXCEPTION 'connection_notes.created_at is immutable' USING ERRCODE = 'check_violation';
--   END IF;
--   RETURN NEW;
-- END $$;
-- DROP TRIGGER IF EXISTS trg_cn_created_at_immutable ON public.connection_notes;
-- CREATE TRIGGER trg_cn_created_at_immutable
--   BEFORE UPDATE ON public.connection_notes
--   FOR EACH ROW EXECUTE FUNCTION public.connection_notes_forbid_created_at_change();

-- E. 사후 확인
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint
              WHERE conrelid = 'public.connection_notes'::regclass
                AND conname  = 'connection_notes_room_author_unique') THEN
    RAISE EXCEPTION '190_VERIFY: connection_notes_room_author_unique still present';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes
                  WHERE schemaname = 'public' AND tablename = 'connection_notes'
                    AND indexname = 'idx_cn_room_created') THEN
    RAISE EXCEPTION '190_VERIFY: idx_cn_room_created missing';
  END IF;
END $$;

commit;

-- (R) Rollback — 별도 실행. 아래 조회가 0행일 때만.
-- select mentor_student_room_id, author_id, count(*) from public.connection_notes
--   group by 1, 2 having count(*) > 1;
-- alter table public.connection_notes
--   add constraint connection_notes_room_author_unique unique (mentor_student_room_id, author_id);
-- drop index if exists public.idx_cn_room_created;
-- (F 채택 시) supabase/sql/085_connection_notes_author_rls.sql 의 cn_update/cn_delete 원문 재적용,
--   drop trigger if exists trg_cn_created_at_immutable on public.connection_notes;
--   drop function if exists public.connection_notes_forbid_created_at_change();
```

검증 조회(적용 후):
```sql
select conname, pg_get_constraintdef(oid) from pg_constraint
 where conrelid = 'public.connection_notes'::regclass order by 1;
select indexname from pg_indexes where schemaname = 'public' and tablename = 'connection_notes' order by 1;
select policyname, cmd, qual from pg_policies where tablename = 'connection_notes' order by cmd;
```
