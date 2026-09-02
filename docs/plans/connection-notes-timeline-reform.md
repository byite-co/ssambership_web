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

1. **DB 변경은 작다.** 제약 제거 1문(`alter table public.connection_notes drop constraint connection_notes_room_author_unique`)으로 누적 구조가 열리고, 정렬 인덱스 1개와 (권장안) 정책 제거 2문이 따른다. 컬럼·기존 트리거·데이터는 손대지 않는다. 라이브 행이 **0건**(방도 0건)이라 데이터 정리는 필요 없고, 지금이 가장 싼 시점이라는 인계 문서의 판단은 실측으로 확인됐다.
2. **진짜 위험은 DB가 아니라 이미 배포된 앱이다.** 스토어 앱(1.0.0+19)의 저장 함수 `upsertMyNote`는 "내 노트 중 최신 1건을 UPDATE하고 **나머지 내 노트를 전부 DELETE**"한다. 제약을 지우고 타임라인에 내 노트가 여러 장 쌓인 뒤 구버전 앱에서 저장을 한 번 누르면, 그 사용자의 과거 노트가 사라진다. 이 경로는 코드로 확인했다(§5).
3. 따라서 순서가 곧 안전장치다. **① 제약 제거(무해) → ② 앱 신버전 배포 → ③ 강제 업데이트 게이트 상향 → ④ 웹·앱 UI에서 여러 장 허용.** ④를 ③ 앞에 두면 위험이 열린다. 단 게이트는 **콜드 스타트에서만** 평가되므로(§5-2) 순서만으로는 구멍이 남고, 서버가 스스로 막는 방어(§5-3: **authenticated의 UPDATE·DELETE 정책을 제거한 엄격한 append-only** — 트리거·함수 없이 `drop policy` 2문)를 함께 넣는 것을 권장한다 — 오너 결정 #2. 초안의 "수정 15분 창"은 구앱이 저장 순간에 UPDATE 대상을 다시 고르기 때문에 다른 기기에서 남긴 노트를 덮어쓰는 창이 남아(§5-3 표) 권장에서 내렸다.
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
- 탈퇴한 작성자의 노트 본문 잔존(현행: 행 유지·상대 열람 가능) — 결정 #12
- 노트 신고·검수 화면(현재 없음) — 결정 #14
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

제약을 추가한 마이그레이션 원문(`supabase/migrations/20260806033452_connection_notes_room_author_unique.sql`)의 주석: *"C16: 연결노트는 (방, 작성자)당 1장이 계약인데 DB 제약이 없어 앱이 중복 내성·자가치유 삭제(e9f1311)로 방어하고 있었다. 유일성 정본을 DB로 올린다(적용 시점 행 0건)."* (주석이 인용한 커밋 `e9f1311`은 웹·앱 저장소 어느 쪽 이력에도 없다 — `git log --all` 0건; 앱의 삭제 로직 자체는 현행 코드로 확인했다) — 즉 **앱의 "자가치유 삭제"가 먼저 있었고 제약이 나중에 올라갔다.** 제약을 지우면 앱의 삭제 로직이 다시 유일한 "정리자"가 되는데, 이것이 §5의 위험이다.

RLS 관찰: `cn_select`는 방 당사자만, 쓰기 정책 3개(`cn_insert`/`cn_update`/`cn_delete`)는 "행 단위 작성자 본인 + 방 당사자"를 검사한다. **(방, 작성자) 유일성을 전제로 한 정책은 없다** → 제약을 지워도 RLS는 그대로 유효하다. DB 함수·RPC·트리거 중 `connection_notes` 행을 읽거나 쓰는 것은 없다(`152`의 알림 카테고리 매핑에 `'connection_note%'` 접두사가 있으나 그 이벤트를 내는 곳이 없다).

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
| 실시간 | 노트에 대한 realtime 구독 없음(앱·웹). DB의 `supabase_realtime` publication에도 `connection_notes`가 **없다**(`20260803163322` N1 7테이블 · `137` · `117` 어디에도 미포함 — §11 #7 해소). 저장 후 `_reload()`로 재조회 | `connection_notes_screen.dart:76-79, 89-92` |
| 버전 게이트 | `VersionGateShell`이 라우터 **위**에 얹혀 `forceUpdate`면 어떤 라우트에도 못 들어간다(로그인 전·후 무관). 정책은 RPC `get_mobile_app_version_policy(p_platform)`(anon EXECUTE)에서 읽는다. 원천 테이블 `mobile_app_version_policies(platform pk, min_supported_build, latest_build, minimum_version_name, store_url, message)` — RLS on·정책 0·anon/authenticated 권한 revoke → **service_role(SQL)로만 갱신**. 판정 정본은 build 정수(`min_supported_build`)이고 `minimum_version_name`은 표시용 — 앱도 `currentBuild < policy.minSupportedBuild`면 `GateForceUpdate`(`version_gate_decision.dart:38`). 현재 앱 build **19**(`pubspec.yaml` `version: 1.0.0+19`). 상향 선례: 마이그레이션 `20260806075353`이 `latest_build`를 16으로 올렸다(콘솔 UPDATE를 원장에 역수입) | `lib/core/version_gate/version_gate_shell.dart:7-12, 40-44` · `supabase_version_policy_port.dart:6-9, 22-25` · `supabase/sql/162_mobile_app_version_policy.sql:8-27` · `supabase/migrations/20260806075353_mobile_version_policy_latest_build_16.sql` |
| 테스트 | `test/screens/connection_notes_save_test.dart`(상대 노트 렌더 + '내 노트 저장' → `onSaveNote(body)`) · `connection_notes_boundary_test.dart`(빈/공백 차단·trim·10k자·이모지) · `test/widgets/note_author_badge_test.dart`(배지 라벨·`fromMap`) · `small_viewport_states_test.dart:203-235`(320×568에서 로딩·빈·에러 3상태 **overflow 없음** — 새 레이아웃도 통과해야 함) · `conversation_ui_layering_test.dart:20-45`(`lib/shared/conversation_ui`에 `connection_note`·`ConnectionNote` 등장 금지 — 타임라인이 `ConversationBubble`을 쓰더라도 **역방향 import 금지**) · `contracts/outbound_api_manifest_test.dart:91,133`(`.from('connection_notes')`·버킷 `connection-note-ink` 리터럴을 **테이블·RPC·버킷 집합**으로 고정. 작업 종류(update/delete)는 고정하지 않음 → append 전환으로 갱신 불필요. 단 `'connection-note-ink'` **상수 정의가 `lib/`에 남아 있어야 하고**(`:274-278`) — `InkStoragePaths`를 "dead code"로 지우면 깨진다 — append를 RPC로 바꾸면 `kExpectedRpcNames`에 추가해야 한다) | — |

### 2-3. 웹 (`7de04c6`) — 이미 append, UI가 1장으로 제한

| 확인 항목 | 코드 사실 | 근거 |
|---|---|---|
| 쓰기 | `saveConnectionNote`: **INSERT**(`mentor_student_room_id, body, author_id, author_role`). 주석 *"작성자별 카드를 유지하기 위해 매 저장마다 새 노트를 append"* | `lib/qna/questionRoomMutations.ts:42-70` |
| 서버 액션 | `saveConnectionNoteAction`: `requireQnaActor` → `assertAccountActive` → `assertMentorStudentRoomParty` → **`assertConnectionNoteWriteAllowed`(활성 구독 또는 진짜 무료방만)** → INSERT → `revalidatePath` → `?kind=note&ok=` 복귀. `updateConnectionNoteAction` / `deleteConnectionNoteAction`도 같은 게이트 + 작성자 본인 검사 + RLS | `lib/qna/questionRoomActions.ts:489-655` |
| 조회 | `fetchConnectionNotesForRoom`: `select *`, `updated_at desc`, **limit 없음** | `lib/qna/questionRoomQueries.ts:176-188` |
| 패널 | `ConnectionNotesPanel`: 헤더(함께한 기간·함께한 질문) + **2열**('학생의 노트' / '멘토의 노트'). 카드마다 본인이면 수정(인라인 폼)·삭제(`window.confirm` — 웹 코드베이스 전체에서 **유일한** native confirm). **`canAdd = viewerRole === side && cards.length === 0`** — 내 노트가 1장이라도 있으면 '내 노트 추가' 버튼을 숨긴다. 주석: *"연결노트는 (room, author) 당 1개 — DB unique(connection_notes_room_author_unique)와 정합"*. 날짜 라벨은 `updated_at ?? created_at`. 웹에는 이 UI 조건 말고 **1장 제한을 강제하는 서버 로직이 없다** | `components/qna/ConnectionNotesPanel.tsx:116, 149-151, 242` |
| 모달 | `QuestionRoomNewNoteModal`: `<form action={saveConnectionNoteAction}>` — 성공 후 닫힘/초기화 훅이 **없다**(`QuestionRoomNewQuestionModal`은 `onSuccess={onClose}`를 넘긴다). placeholder *"멘토에게 전달할 배경·목표를 짧게 남겨 주세요."* — 멘토가 열어도 같은 문구. hidden `actor` input(`:63`)은 액션이 읽지 않는 dead 필드(`requireQnaActor`가 정본) | `components/qna/QuestionRoomNewNoteModal.tsx:54-63` · `QuestionRoomNewQuestionModal.tsx:65` |
| 초안 보존 | 페이지가 `?dNote=`를 `draftNoteBody`로 풀어 `QuestionRoomWorkspace` → 두 디자인 워크스페이스로 넘기지만, 둘 다 **prop만 선언하고 쓰지 않는다**(`StudentDesignWorkspace:172`, `MentorDesignWorkspace:163`). 패널·모달에 `defaultBody`가 닿지 않아 **저장 실패 시 입력한 글이 사라진다** | `app/(student)/question-room/[roomId]/page.tsx:68` · `components/qna/QuestionRoomWorkspace.tsx:260` |
| 레거시 | 상세 4개 페이지가 `initialNoteText = extractNoteText(bundle.notes.rows[0])`를 계산해 `QuestionRoomWorkspace`에 넘기고, 워크스페이스가 `studentNoteText`/`mentorNoteText`(작성자별 **첫 1건**)를 memo로 만들어 구형 3단 레이아웃(`:269` 이하, '학생 참고 메모' 섹션 `:505-514`, 구형 노트 폼 `:538-560`)에 렌더한다. 그런데 호출 5곳 중 목록 1곳은 `:166`에서, `surface="detail"` 4곳은 전부 `roomId`(라우트)·`currentUserId`(세션, `requireRole`이 보장)를 넘기므로 `:207`/`:238`에서 반환된다 — **`:269` 이하 구형 렌더는 도달 불가**. 웹에는 방 카드 노트 미리보기도 없다(`loadQuestionRoomListBundle`이 `notes: []`, `:337`) | `components/qna/QuestionRoomWorkspace.tsx:83, 111, 152-163, 166, 207, 238, 269, 505-514, 538-560` · `app/(student)/question-room/[roomId]/page.tsx:113,128` 외 3곳 |
| 오류 매핑 | 현행 제약 아래서 두 번째 INSERT는 `23505`(unique_violation) → `userFacingActionError`(`:37-54`, 정규식에 `violates`)가 "메모를 저장하지 못했습니다…"로 치환 → 리다이렉트 `?error=` → 페이지가 다시 `mapDataErrorMessage()`를 거쳐 **"요청을 처리할 수 없습니다. 잠시 후 다시 시도해 주세요."** 로 세탁. 이 2단 세탁은 노트 액션의 **모든** 오류에 적용된다: 구독 만료 가드 문구·"본인이 작성한 노트만…"·"노트 내용을 입력해 주세요"가 사용자에게 **한 번도 그대로 보이지 않는다**(기존 결함) | `lib/qna/questionRoomActions.ts:37-54, 537` · `lib/utils/mapDataError.ts:50-96` · `app/(mentor)/mentor/question-room/[roomId]/page.tsx:62` |
| 수정·삭제 액션 | `update`/`delete`는 `.eq("id", noteId)`만 하고 **영향 행 수를 확인하지 않는다**. RLS는 오류 없이 필터하므로 정책이 좁아지면 0행 갱신·삭제에도 '노트를 수정했습니다.'가 뜬다 | `lib/qna/questionRoomActions.ts:601, 607, 648` |
| 계정 삭제 | `accountDeletionBucketCoverage`: 버킷 `connection-note-ink`를 `connection_notes.author_id` 소유 · `ink_path/ink_thumb_path` 경로로 등재. 행 수와 무관 | `lib/account/accountDeletionBucketCoverage.ts:105-111` |
| e2e | `e2e/connection-note-guard.spec.ts`: 가드 PASS/차단 4시나리오 + 만료 후 읽기 RLS. 마지막 테스트가 `connection_notes`에 학생 노트 1건을 **정리 없이 INSERT**한다(`cleanupSubscriptionForPair`는 노트를 지우지 않고 `ensureRoom`은 방을 재사용) — 현행 제약에서는 2회차 실행부터 INSERT가 조용히 실패(오류 미검사)하고 이전 행으로 통과. 제약 제거 후에는 실행마다 행이 누적된다 → 정리 추가 필요(§8). 이 스펙을 돌리는 CI 워크플로는 없다(수동) | `e2e/connection-note-guard.spec.ts:24-54, 173-175` |
| 계약 스냅샷 | `contracts/snapshots/staging_contract.json`에 `connection_notes` 정책 md5·grants가 들어 있고 `npm run contracts:verify`(온라인 diff — **CI 워크플로 어디에도 없어 수동**)가 대조한다. `web-contract-tests.yml`은 `tsc --noEmit`을 저장소 전역(`e2e/` 포함)에 돌리므로 e2e 스펙 수정도 타입 검사를 통과해야 한다. 정책을 다시 쓰면(결정 #2) 스냅샷을 **재추출**해야 하고, 새 마이그레이션은 `supabase/sql`·`migrations`·`post_ledger_backfills` 어딘가에 있어야 source/applied 동등성 검사를 통과한다. anon에 테이블 DML grant가 있으나 정책이 전부 `to authenticated`라 RLS로 차단 — 정책 재작성 시 `to authenticated` 유지 | `contracts/snapshots/staging_contract.json:434-462, 4898` · `scripts/contracts/verify_remote_contract.mjs` |
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
| 정렬 키 | 조회는 앱·웹 모두 **`created_at desc, id desc` + 명시적 `limit`**(최신 우선 — 앱 방 홈 미리보기 2종이 "첫 행 = 최신" 전제라 **무변경**; 웹에는 미리보기 소비자가 없음), 타임라인 화면은 그 목록을 **뒤집어** 오래된 것 위·최신 아래로 그린다. `updated_at` 정렬 폐기(수정 시 순서가 튀는 것 방지). **`asc` + limit 없음은 금지** — PostgREST 서버 max-rows(기본 1000)가 **최신** 행을 조용히 잘라낸다 |
| 쓰기 | INSERT만. 웹: 구독 활성(서버 액션 가드) + 방 당사자(RLS). **앱: 방 당사자(RLS)만** — 구독 규칙이 앱 경로에는 없다(결정 #8) |
| 수정·삭제 | **결정 #2**. 권장: **둘 다 불가**(authenticated에 UPDATE·DELETE 정책 없음 — `question_messages`와 같은 append-only, `002_p0:227-248`). 오타·정정은 새 노트로 남긴다. 이 모양만이 구클라이언트의 UPDATE+DELETE 경로를 배포 순서·기기 수와 무관하게 무력화한다(§5-3). 대안(15분 창)의 잔여 위험은 §5-3 표 |
| 본문 | 텍스트. 길이 상한 **결정 #3**(권장 2,000자, 클라이언트 강제) |
| 손글씨 | 컬럼 유지, 기능 없음 |
| 조회 | `created_at desc` **limit 200**(결정 #4) — 현재 인덱스 `idx_cn_msr`는 `updated_at desc`라 새 정렬은 §4의 `idx_cn_room_created`가 받친다. '이전 노트 보기'는 후속 |

---

## 4. DB 변경

### 4-1. DDL (본문은 §12)

| 순서 | 문장 | 비고 |
|---|---|---|
| A | 게이트: 제약 존재 여부 확인, 없으면 NOTICE 후 통과 | 멱등 |
| B | `alter table public.connection_notes drop constraint if exists connection_notes_room_author_unique;` | unique index도 함께 제거됨 |
| C | `create index if not exists idx_cn_room_created on public.connection_notes (mentor_student_room_id, created_at, id);` | 타임라인 정렬용. **`id`를 동률 해소 키로 포함** — 같은 트랜잭션의 INSERT는 `created_at`(=`now()`, 트랜잭션 고정)이 같아 순서가 비결정적이다. 오름차순 btree 하나로 `ORDER BY created_at, id`와 `… DESC, id DESC`(역방향 스캔) 둘 다 받으므로 `DESC` 지정 불필요. 제약이 만든 unique index가 사라져도 `idx_cn_author`(048, 같은 컬럼 목록)가 남아 구앱의 (방, 작성자) 조회 경로는 유지된다. `idx_cn_msr`(`updated_at desc`)는 클라이언트가 `created_at` 정렬로 옮기면 dead가 되지만 **build 19 호환용으로 게이트 상향 전까지 유지** |
| D | `comment on table public.connection_notes is '…누적 타임라인…';` | 계약 기록 |
| E | 사후 확인 DO 블록(제약 부재·인덱스 존재) | 실패 시 예외 |
| F-1 | (**결정 #2** 권장안 (c)) `drop policy if exists "cn_update"` → authenticated UPDATE는 RLS 필터로 **0행**(오류 없음). 구앱의 "최신 내 노트 UPDATE"가 0행이 되어 `.single()` 예외 → DELETE 블록에 도달하지 못한다 | 정책 수 −1 |
| F-2 | (**결정 #2** 권장안 (c)) `drop policy if exists "cn_delete"` → authenticated DELETE는 항상 0행. service_role(계정 삭제 워커·e2e admin)은 RLS 우회라 무영향, FK `on delete set null`(048)도 정책과 무관하게 동작 | 정책 수 176→**174**(functions 222 불변) |
| F-3 | (**대안 (b′)** 채택 시에만, F-1/F-2 대신) `cn_update`를 "작성 후 15분 이내 본인 행"으로 재정의(같은 이름) + `cn_delete` 제거 + `created_at` 불변 트리거 `trg_cn_created_at_immutable`·함수 `connection_notes_forbid_created_at_change()` — `WITH CHECK`에 창을 넣어도 `created_at = now()`로 창을 연장하는 우회는 못 막아 트리거가 필요. **`created_at`만 고정할 것** — `author_id`는 FK `on delete set null`(048)이라 사용자 삭제 시 참조 무결성 동작이 UPDATE로 실행돼 BEFORE UPDATE 트리거를 탄다; `author_id`까지 고정하면 **회원 탈퇴가 깨진다**. 본문은 §12-1 말미 `[ALT-b′]` 블록 | policies 175 · functions 223 |

**바꾸지 않는 것**: 컬럼 전부(잉크 2열 포함) · `cn_select`/`cn_insert` · 기존 트리거 `trg_cn_set_updated` · FK 2종 · 버킷.

### 4-2. 롤백
(방, 작성자) 중복이 0건일 때만 가능하다 — 타임라인이 한 번이라도 쌓이면 **사실상 되돌릴 수 없다**(pack은 forward-only, 189류 backfill에 `supabase/rollback/` 파일 규약도 없다). (R) 블록은 문서용이다.
```sql
select mentor_student_room_id, author_id, count(*)
  from public.connection_notes group by 1, 2 having count(*) > 1;  -- 0행이어야 함
alter table public.connection_notes
  add constraint connection_notes_room_author_unique unique (mentor_student_room_id, author_id);
drop index if exists public.idx_cn_room_created;
comment on table public.connection_notes is null;
-- F(권장안 c): cn_update 는 085:43-66, cn_delete 는 085:67-78 원문으로 재생성
-- 대안 (b′) 였다면 그 전에:
-- drop trigger if exists trg_cn_created_at_immutable on public.connection_notes;
-- drop function if exists public.connection_notes_forbid_created_at_change();
```

### 4-3. 저장소 마이그레이션 절차 (이 저장소의 현행 규약)

`091d949`(iM뱅크, 2026-08-31)·`8ebe231`(TZ-FIX R3)에서 확인한 **3본 동일 파일** 규약을 따른다. 세 파일은 바이트 단위로 같아야 한다(md5 대조 확인: `189_*` = `post_ledger_backfills/20260831100100_*` = `migrations/20260831100100_*`).

| # | 파일 | 소유 | 비고 |
|---|---|---|---|
| 1 | `supabase/sql/190_connection_notes_timeline_drop_unique.sql` | 사람 | 가독용 정본. 189가 현재 마지막 번호 |
| 2 | `supabase/baseline/post_ledger_backfills/2026MMDD100100_connection_notes_timeline_drop_unique.sql` | 사람 | pack 소스(**이 파일이 원본**, 1번은 바이트 동일 사본). version은 **작성(커밋)일** + `100100`(같은 날 2본째 `100200`) — 적용 예정일이 아니다(`20260831100100`은 8/31 커밋, 아직 부모 미적용). 검증기가 "pack 마지막 version = backfill 최대"를 요구하므로(`validate_native_migration_pack.py:138`) **`20260831100100`보다 커야** 하고 PR60(`20260804113000`)보다도 커야 한다. BOM 없음·LF·말미 개행 1개(189 선례; 085 등 구 파일은 BOM이 있다) |
| 3 | `supabase/migrations/2026MMDD100100_…sql` | **생성기** | `python3 scripts/verify/baseline/build_native_migration_pack.py` 가 복사. 직접 편집 금지 |
| 4 | `supabase/baseline/native_migration_pack_manifest.tsv` | 생성기 | 행 1개 추가(현재 102행 → 103; `191`까지면 104) |
| 5 | `docs/audit/sql_apply_manifest.md` | 사람 | 신규 SQL 등재 행 |
| 6 | `docs/audit/db_expected_state.md:39` | 사람 | `connection_notes` 행에 "(방, 작성자) 유일성 없음(설계) · 타임라인 · (권장안) authenticated UPDATE·DELETE 정책 없음(append-only)" 추기 |
| 7 | `CLAUDE.md` 핵심 테이블 표 | 사람 | `connection_notes` 행 정정(`status` 컬럼은 어떤 SQL에도 없다 → `author_id, author_role, body, ink_path, ink_thumb_path`, append-only 명시) · `:40` "room 단위"에 "작성자당 여러 장, 수정·삭제 없음" |
| 8 | `contracts/snapshots/staging_contract.json` | 도구 | F(정책 제거) 적용 후 재추출(`cn_update`·`cn_delete` md5 행이 사라진다) — `npm run contracts:verify`가 정책 md5를 대조한다(CI에 없고 수동) |
| 9 | `scripts/verify/baseline/verify_local_stack_state.sh:56-58, 112-117` | 사람 | 헤더 주석을 "104본 pack(생성기 103 + PR60 1)"으로, "103본→104본(연결노트 타임라인) 델타" 블록 추가 — **A~E만이어도 필요**(관례). F 권장안 (c)면 `:116` policies **174**(functions 222 불변); 대안 (b′)면 `:114` functions 223 · `:116` policies 175 |
| 10 | `scripts/verify/connection_notes_timeline_verify.sql` | 사람 | 신규 검증 스크립트(§8-3) |
| 11 | `docs/audit/db_permission_audit_queries.sql:232-249` (B5) | 사람 | F 권장안 (c)면 기대 정책 집합 {`cn_select`, `cn_insert`}(UPDATE/DELETE 행 0)로, (b′)면 3개(`cn_update`에 `created_at`) + 트리거 존재로 갱신 |
| — | `supabase/sql/INDEX.md` · `docs/audit/apply_manifest_prod.md` | — | **손대지 않음**(059 이후 미관리 / 189 커밋도 미수정) |

검증(로컬, PR 전): `validate_native_migration_pack.py` · `validate_replay_manifest.sh` PASS, 생성기 재실행 diff 0. CI `db-migration-pack-verify.yml`이 PG17 + Supabase CLI replay로 다시 검증한다. `verify_local_stack_state.sh`의 구조 카운트(tables 85 · functions 222 · policies 176 · buckets 13, `:112-117`)는 A~E만이면 **바뀌지 않는다**(제약·인덱스는 그 카운트에 없다). F 권장안 (c)(정책 2개 제거)면 **policies 174**(functions 222 불변), 대안 (b′)면 **functions 223 · policies 175** 로 기대치를 함께 갱신해야 한다(선례: `ea146b5` "로컬 스택 구조 카운트 기대치 갱신"). `run_local_stack_emulation.sh`의 STRICT 축(constraints·indexes md5)은 `PR60_FORWARD`가 설정된 `[6]` 블록에서 PR #60 전후 지문만 대조한다(`:101-117`) — 일반 마이그레이션 추가에는 적용되지 않으므로 기대값 갱신은 없다. `parent_schema_fingerprint.sh`의 constraints·indexes 축은 바뀌지만 `db-apply-pending`은 그 diff를 증적으로만 남기고 강제하지 않는다(`:175`).

적용: **`db-apply-pending.yml` workflow_dispatch**(dry-run → 승인 → apply, confirmation 문자열). MCP `apply_migration` 직접 적용은 저장소 규칙상 금지(적용하면 같은 세션에서 역수입까지 해야 한다 — `CLAUDE.md` "마이그레이션 hotfix 역수입 규칙"). **중요한 성질**: 이 워크플로는 (로컬 pack) − (원장) 차집합 **전량**을 `supabase db push` 한 번으로 적용하고 사후에 원장 = pack 전체를 요구한다(`:130, 154, 169`). 따라서 **`190`만 적용하고 `191`을 main에 미리 넣어 둘 수 없다** — `191`은 ③ 시점에 머지해야 하고, `190`은 아직 미적용인 `189`와 함께 적용된다(§9). CLI `db push`는 원격 마지막 version보다 앞서는 로컬 파일을 `--include-all` 없이는 거부하므로(워크플로는 이 플래그를 넘기지 않는다) version 순서 규칙(위 2번)이 실제로 걸린다.

---

## 5. 구클라이언트 위험과 방어

### 5-1. 무엇이 일어나는가

제약을 지우고, 새 앱/웹으로 내 노트를 3장 남긴 상태에서 **구버전 앱(1.0.0+19)** 이 '내 노트 저장'을 누르면:

1. `existing` = 내 노트 3건(`updated_at desc`)
2. `existing.first`(저장 순간 `updated_at`이 가장 최근인 내 장)를 편집기 내용으로 **UPDATE** — 편집기는 화면 진입 시 한 번만 시드되고(`connection_notes_screen.dart:140-144`) 대상은 저장 시점에 다시 고르므로(`:202-207`), 그 사이 다른 기기에서 남긴 내 노트가 있으면 **그 노트**가 덮어써진다
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

상향 방법(현행 인프라, 관리자 UI 없음): 신앱 build를 N(≥20)이라 할 때 — 선례 `20260806075353`처럼 `greatest()`로 멱등하게(값을 낮추지 않게), 자기 검증 포함(§12-2 `191` 초안)
```sql
update public.mobile_app_version_policies
   set min_supported_build = greatest(min_supported_build, N),
       latest_build         = greatest(latest_build, N),
       minimum_version_name = '<신앱 표시 버전>', updated_at = now()
 where platform in ('android', 'ios')
   and (min_supported_build < N or latest_build < N);
```
`162` 헤더가 "실제 최소 build 상향은 운영 절차로만"이라 못 박았고, 선례 `20260806075353`은 콘솔 UPDATE를 마이그레이션으로 역수입했다. 권장은 처음부터 **마이그레이션(`191`)으로 등재해 `db-apply-pending`으로 적용** — 재현 가능하고 역수입이 필요 없다.

**게이트의 구멍(코드 확인).** 게이트는 `main.dart:55`에서 앱 시작 시 **한 번만** 평가되고 복귀(resume) 시 재검사가 없다. 따라서 (a) 상향 시점에 이미 떠 있는 구앱 세션은 **프로세스를 재시작할 때까지** 계속 저장할 수 있다. (b) 오프라인 콜드 스타트는 직전 통과 build의 캐시로 통과한다(`version_gate_controller.dart:90-95`) — 이후 연결이 돌아오면 저장 가능. (c) 빌드 번호를 못 읽으면 통과(`version_gate_decision.dart:37`), (d) 웹 타깃은 게이트가 아예 없다(`gate_platform.dart:11`). 그러므로 "③ 완료"는 **"모든 구앱이 온라인에서 한 번 재시작한 뒤"** 로 읽어야 하고, 이 구멍을 메우는 것이 §5-3이다.

**게이트 화면의 스토어 버튼(라이브 확인, 2026-09-02).** `mobile_app_version_policies` 현재 행: android `min_supported_build 9 · latest_build 16`, ios `1 · 16`, `minimum_version_name` '1.0.0', **`store_url` 두 행 모두 NULL, `message` 빈 문자열**(§11 #12 해소). 앱의 `ForceUpdateScreen`은 '스토어에서 업데이트' 버튼을 항상 그리지만, 누르면 `validatedStoreUri(storeUrl)`가 빈 문자열에 `null`을 돌려주어 스토어를 열지 않고 스낵바 '스토어를 열 수 없어요. 스토어에서 직접 업데이트해 주세요.'만 띄운다(`version_gate_screens.dart:19-37`, `store_url_policy.dart:21-29`). 즉 **지금 값 그대로 `191`을 적용하면 구앱 사용자는 업데이트 화면에 갇히고 앱 안에서 스토어로 가는 길이 없다.** `191`이 두 플랫폼의 `store_url`과 `message`를 함께 채워야 한다(§12-2에 반영). 값의 형식은 DB CHECK가 강제한다 — `mavp_store_url_chk`(https) + `mavp_store_url_platform_chk`(`20260808080056`: android는 `play.google.com`, ios는 `apps.apple.com`/`itunes.apple.com`)라 틀린 값은 마이그레이션이 실패한다. Play URL은 `applicationId`(`android/app/build.gradle.kts:43` `com.ssambership.edu`)로 정해지고, App Store URL은 숫자 앱 id가 필요하다(§11 #14, 오너).

### 5-3. 방어 2 — 서버 정책 (권장 · **결정 #2**)

순서는 운영 규율에 기대는 방어다. DB가 스스로 막게 하려면 정책을 바꿔야 한다. 구앱의 저장 순서는 **저장 시점에** 내 노트를 다시 SELECT(`updated_at desc`, `question_room_write_repository.dart:202-207`) → 그 첫 행을 UPDATE(`:209-218`) → 성공 시 나머지 내 노트 DELETE(`:221-233`)이고, RLS는 거부가 아니라 **필터**다. 편집기는 화면 진입 시 한 번만 시드되므로(`connection_notes_screen.dart:140-144`, `mine.first`) **UPDATE 대상은 "사용자가 보고 있던 노트"가 아니라 "저장 순간 가장 최근에 갱신된 내 노트"** 다 — 그 사이 같은 계정이 신앱·웹에서 남긴 노트가 있으면 그 노트의 본문이 구앱 편집기 텍스트로 덮어써지고 '노트를 저장했어요.'가 뜬다. 따라서 "수정 창을 좁힌다"는 방어는 창의 길이만큼 덮어쓰기를 남긴다.

| 정책 모양 | 구앱 UPDATE(최신 내 노트) | 구앱 DELETE(나머지 내 노트) | 잔여 손실 | DB 비용 |
|---|---|---|---|---|
| (a) 현행 — 본인 행 언제나 | 성공 | **성공** | 과거 내 노트 전부 삭제 | 0 |
| (b) 수정·삭제 모두 15분 창 | 15분 내 행이면 성공 | 15분 내 행 **삭제** | 15분 내 내 노트 삭제 + 본문 덮어쓰기 | 정책 2 재정의 + 트리거·함수 |
| (b′) 수정 15분 창 + 삭제 불가 + `created_at` 불변 트리거(초안 권장) | 15분 내 행이면 성공 | 0행(`catch (_)` 무음) | **다른 기기에서 15분 내 남긴 내 노트의 본문 덮어쓰기**(시간 한정) | 정책 1 재정의·1 제거 + 함수·트리거 1 → policies 175 · functions 223 |
| (c′) 수정 무제한 + 삭제 불가 | 성공 | 0행 | 다른 기기에서 남긴 최신 내 노트 본문 덮어쓰기(**시간 무제한**) | 정책 1 제거 → 175 |
| **(c) 수정·삭제 모두 불가** | **0행 → `.select().single()` 예외 → 레포 미포착 → DELETE 블록 도달 못 함 → 화면 `catch` 스낵바 '저장에 실패했어요. 요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.'**(`connection_notes_screen.dart:98-103`, `friendly_error.dart:11-14`; 크래시 없음, 편집기 텍스트 유지) | 0행 | **없음** | 정책 2 제거 → **174**, 함수·트리거 0 |

권장은 **(c)**.
1. 어떤 배포 순서·게이트 구멍(§5-2)·두 기기 병용에서도 **기존 행이 바뀌거나 사라질 수 없다.** 구앱이 할 수 있는 것은 "그 방에 내 노트가 0장일 때 첫 노트 INSERT"(정당한 타임라인 항목)뿐이고, 이미 있으면 저장이 실패 스낵바로 끝난다. 순서(§5-2)와 게이트(`191`)는 데이터 안전장치가 아니라 구앱의 "저장 실패" 상태를 끝내는 UX 장치가 된다.
2. 코드베이스 선례: `question_messages`도 `qm_select`/`qm_insert`뿐이다(`supabase/sql/002_p0_subscriptions_questions_draft.sql:227-248`, 주석 "update/delete 없음(append)"). 메시지처럼 노트도 불변인 것이 일관된다.
3. 가장 싼 DDL — 트리거·함수·정책 재정의 없이 `drop policy` 2문. 구조 카운트는 policies 176→174만 움직인다.
4. 제품 의미: 타임라인은 기록이고 오타·정정은 **새 노트**로 남긴다. 웹의 인라인 수정 UI·삭제 UI는 제거된다 — 결정 #2의 유일한 UX 비용은 웹의 기존 인라인 수정 어포던스다(앱에는 원래 없다).

(b′)를 고르면 정정 창은 얻지만 위 표의 시간 한정 덮어쓰기가 남고, 창을 안전하게 만들기 위한 함수·트리거(`created_at`만 고정, `author_id` 고정 금지 — §4-1 F-3)와 웹의 창 판정 헬퍼 공유·`.select("id")` 영향 행 검사(§7-3)가 따라온다. 그 SQL은 §12-1 말미 `[ALT-b′]` 블록에 둔다.

`.single()`이 0행에 예외를 던진다는 것은 postgrest 라이브러리 동작이라 오프라인 확인이 안 됐다(§11 #5). 던지지 않더라도 (c)에서는 DELETE 정책이 없어 손실은 없다 — 예외 여부는 "실패 스낵바 vs 거짓 성공 스낵바"의 UX 차이만 만든다.

채택하지 않으면((a)) 방어 1만 남는다. 그 경우 §9의 ③(게이트 상향)을 ④ 전에 **반드시** 끝내고, 게이트 구멍 때문에 ③과 ④ 사이에 **재시작 유예(권장 48시간 이상)** 를 두어야 하며, 두 기기 병용 사용자의 위험은 그래도 남는다.

---

## 6. 앱 변경 (골격 유지)

| 파일 | 변경 | 골격 |
|---|---|---|
| `data/question_room_write_repository.dart` | `upsertMyNote` → **`appendMyNote(roomId, body)`**: INSERT 블록(`:237-247`)만 남기고 SELECT-existing(`:202-207`)·UPDATE(`:210-218`)·DELETE(`:221-233`) 경로 삭제. `_currentAuthorRoleCode` 유지. 문서 주석(`:185-193`, "UNIQUE 없음" 근거) 교체. 클라이언트 사전 검사: trim 후 빈 본문 거부(현행 `_save` `:83-84`) + 2,000자 초과 거부(`.characters.length`, 결정 #3 — DB CHECK가 없으므로 앱·웹 액션이 각자 막는다) | — |
| `data/question_room_read_repository.dart` | `notes(roomId)` 정렬을 `updated_at desc` → **`created_at desc, id desc` + `.limit(200)`**(최신 우선 유지, 결정 #4). doc 주석 `:256`("최근 수정순") → "최근 작성순". 미리보기 2종은 그대로 동작. 화면이 `.reversed`로 뒤집는다. 페이징(결정 #4)을 채택하면 `recentMessages`/`messagesBefore`·`MessageCursor(createdAt:, id:)`·`messageCursorBeforeFilter`를 그대로 미러링 | — |
| `ui/connection_notes_screen.dart` | '상대 노트'/'내 노트' 2섹션 → **한 타임라인**(학생·멘토 카드 혼합, 기존 `_NoteCard` + `AppBadge` 작성자 배지 그대로, 내 카드는 `mine` 플래그로 톤만) + 하단 **작성 카드**(기존 `AppCard` + `TextField` + `PrimaryButton`, 라벨 '내 노트 저장' → **'노트 남기기'**, 힌트 문구 교체). 저장 성공 시 **`_editor.clear()`를 명시 호출**한 뒤 `_reload()` — `_seeded`를 지우는 것만으로는 편집기가 비지 않는다(`:140-144`). `mine`/`others` 분리·`_seeded` 삭제. 카드 시각을 `updatedAt`(`:217`) → **`createdAt`**. 빈 상태 `EmptyState` 유지 — 단 본문 '질문하고 답변을 확인하면 노트가 쌓여요'(`:159`)는 구 모델(질문·답변에서 노트가 생긴다) 설명이라 '첫 노트를 남겨 보세요'류로 교체(**카피 결정 #5**). 생성자 seam(`notesLoader`·`onSaveNote`·`currentUserId`) 유지 — 테스트가 의존 | `Scaffold`·`AppBar('연결노트')`·`ListView` 유지 |
| `ui/mentor_room_home_screen.dart` | **변경 없음** — 조회가 최신 우선을 유지하므로 `break`-on-first(`:50-55`)가 그대로 "최신 멘토 노트" | 카드 유지 |
| `ui/mentor/student_room_home_screen.dart` | **변경 없음** — `??=`(`:58-65`)가 그대로 "최신" | 카드 유지 |
| `shared/labels/question_room_labels.dart` | 변경 없음('학생'/'멘토'/'작성자 미상') | — |
| `data/models/connection_note.dart` | 필드 변경 없음. 주석 `:3` "작성자별 행이 따로 쌓인다" → "방 타임라인, 작성자당 여러 행" (주석만) | — |
| `lib/core/ink/ink_storage_paths.dart` | **삭제 금지**(§2-2 테스트 행). 경로 규약이 `{roomId}/{authorId}/ink.json` 작성자당 1파일이라 여러 장 노트와 호환되지 않는다 — 손글씨를 되살릴 때 노트 id 기준으로 바꿔야 한다는 메모만 남긴다 | — |
| `docs/APP_FEATURE_STATUS.md:142` | "`upsertMyNote` 실쿼리" 설명을 `appendMyNote`·타임라인으로 갱신 | — |
| (선택) 본문 길이 | `TextField(maxLength: 2000)` — **결정 #3** | — |
| 수정·삭제 | 앱에 수정·삭제 UI는 **추가하지 않는다**(현행에도 없음). 권장안 (c)면 서버도 막는다 | — |
| (선택) 구독 만료 읽기 전용 표시 | 세 진입점이 이미 `SubscriptionSummary? sub`를 들고 있다(`question_list_screen.dart:37`, `mentor_room_home_screen.dart:29, 163`, `mentor/student_room_home_screen.dart:111`) → 화면에 선택 인자로 넘겨 `sub != null && !sub.isActive`면 작성 카드 비활성 + 문장. 딥링크(`sub == null`)는 fail-open이라 **표시 전용, 구속력 없음** — 결정 #8 (a′) | 카드 자리 유지 |
| `ConversationBubble` 사용 여부 | 계층 테스트상 허용(feature → shared 방향)이나 `_NoteCard`(`AppCard` + `AppBadge`)를 유지하는 쪽이 골격 유지·`note_author_badge_test` 계약에 맞다 → 1차는 `_NoteCard` | — |

`docs/SCAN_INK_PLAN.md`(앱 저장소) 참조 주석은 그대로 둔다.

---

## 7. 웹 변경 (골격 유지)

### 7-1. `components/qna/ConnectionNotesPanel.tsx`
- `canAdd`에서 `&& opts.cards.length === 0` 제거(`:151`), 주석(`:149-150`)의 unique 언급 삭제. **단 "서버 가드가 최종이니 항상 보이게"는 부족하다** — 페이지가 모든 액션 오류를 "요청을 처리할 수 없습니다"로 세탁하므로(§2-3 오류 매핑) 구독 만료 사용자가 버튼을 누르면 이유 없는 실패만 본다. → **결정 #9**: (권장) 페이지에서 `assertConnectionNoteWriteAllowed`(또는 `subscriptionContext`)로 **`canWrite`를 서버 계산해 패널에 넘기고**, 불가 시 버튼을 비활성 + 힌트("구독이 만료돼 읽기만 가능해요")로 표시. 페이지 오류 매핑 자체의 수정(액션 문구 허용 목록 또는 `code=` 파라미터)은 별도 PR.
- 2열('학생의 노트'/'멘토의 노트') 유지 여부는 **결정 #1**. 권장은 **한 타임라인**: `columns` 상수(`:277`)의 `NoteColumn` 2개를 `created_at` 정렬 병합 카드 한 `<section>`으로 바꾸고(기존 `NoteItem`·좌측 색 띠·작성자 라벨 재사용), 추가 버튼 1개와 총 장수를 그 섹션 헤더에 둔다(≈60줄). `<aside>` 420px 레일(`:345`)·헤더(함께한 기간·함께한 질문)·모바일 토글(`:326`)·모달 인스턴스는 그대로.
- 카드 목록 구성(정렬·`side` 판정·`editable`)을 **순수 헬퍼 `lib/qna/connectionNoteTimeline.ts`** 로 뽑아낸다 — 이 저장소의 contract 러너가 `lib/**`만 훑고 TSX를 렌더할 수 없어(§8-2) 헬퍼로 빼야 테스트가 된다.
- 정렬: 조회는 `created_at desc, id desc` + `limit 200`, 패널이 뒤집어 위→아래. 카드 id 폴백 ``${aid}-${body.slice(0, 8)}``(`:238`)은 같은 작성자의 여러 장에서 충돌 가능 → `id` 없는 행은 건너뛴다(PK라 실제로는 항상 있음).
- 날짜 라벨: `updated_at ?? created_at`(`:242`) → **`created_at`**. '수정됨' 표시는 두지 않는다 — `trg_cn_set_updated`는 FK `on delete set null`(048)이 실행하는 UPDATE에도 발화해 탈퇴한 작성자의 행이 `updated_at ≠ created_at`이 되므로 마커가 오작동한다((b′)를 골라도 `author_id IS NULL` 행은 제외해야 한다).
- 접근성·헤더: 단일 섹션에 `aria-label`, 비활성 추가 버튼에 `aria-disabled` + `aria-describedby`(힌트 문장). 헤더 문장 '함께 남긴 노트 N개' / 0장 '아직 남긴 노트가 없어요'(카피 결정 #5).
- 모달 상태: 저장 성공(`actionFeedback.kind === 'note' && ok`) 시 **닫고 초기화**하거나 패널을 `formRevision`에 key(두 워크스페이스가 이미 `rev`를 들고 채팅 form에 쓴다 — `QuestionRoomStudentDesignWorkspace.tsx:180, 790` · `QuestionRoomMentorDesignWorkspace.tsx:175, 452`; 리다이렉트마다 `t`가 바뀌므로 `key={`notes-${rev}`}` 한 줄로 모달이 닫힌 채 재마운트된다) — 1장 시절엔 방당 한 번이라 묻혔지만 타임라인에서는 매번 반복된다. 저장 실패 시 `draftNoteBody`를 패널 → 모달 `defaultBody`로 **연결**(결정 #10, 지금은 dead). 구체안: 두 워크스페이스의 `<ConnectionNotesPanel>` 인스턴스(`QuestionRoomStudentDesignWorkspace.tsx:970, 985` · `QuestionRoomMentorDesignWorkspace.tsx:318` `notesPanelProps` → `:328, 331, 337`)에 `key={`notes-${rev}`}` + 패널의 모달 열림 초기값 `useState(props.draftNoteBody !== undefined)` + `defaultBody={props.draftNoteBody}`.
- 수정·삭제: **결정 #2 권장안 (c)** 채택 시 `NoteItem`의 인라인 수정 form(`:61`)·삭제 form(`:114`)·`window.confirm`(`:116`, 코드베이스 유일의 native confirm)·`Pencil`/`Trash2` import(`:4`)·`editable` 필드(`:42, 245`)를 제거한다 — 남기면 RLS 0행에도 '노트를 수정했습니다.'/'삭제했습니다.'로 리다이렉트하는 거짓 성공이 된다(§7-3). (b′) 채택 시 `editable`(`:245`)에 `isWithinNoteEditWindow(created_at, now)`(15분, 헬퍼 공유)를 추가하고 삭제 UI만 제거. (b) 채택 시에는 삭제도 창 조건이고, 확인 UI는 `window.confirm` 대신 카드 안 2단계 인라인 확인('삭제' → '정말 삭제/취소', ≈10줄)을 권장 — `AppToast`는 타이머 토스트라 확인 용도가 아니다.
- 카운트 배지: 총 장수.

### 7-2. `components/qna/QuestionRoomNewNoteModal.tsx`
- 제목 '새 노트 작성' → '노트 남기기'(**카피 결정 #5**). placeholder를 이미 넘어오는 `actor` prop으로 역할별 분기: 학생 *"이번 주 공부에서 막힌 점, 다음 목표를 남겨 주세요."* / 멘토 *"학생에게 남길 피드백·다음 주 계획을 적어 주세요."* (초안, 오너 확정). hidden `actor` input(`:63`)은 소비자가 없으니 제거.
- 성공 문구 `"connection note를 저장했습니다."`(`questionRoomActions.ts:553`) → *"연결노트를 저장했습니다."* (리다이렉트 계약 테스트는 이 문자열을 샘플 값으로만 쓴다).
- `defaultBody`를 초안 복원에 실제로 사용(결정 #10). 결정 #3 (b) 채택 시 `maxLength={2000}`은 필수 — 단 form POST로 우회되므로 서버 액션의 길이 검사가 정본(§7-3).

### 7-3. 조회·액션·문서
- `lib/qna/questionRoomQueries.ts` `fetchConnectionNotesForRoom`(`:176-188`): `.order("created_at", { ascending: false }).order("id", { ascending: false }).limit(200)`. 패널이 뒤집는다.
- `lib/qna/questionRoomActions.ts`: INSERT(`saveConnectionNoteAction` `:489-556`)·가드·리다이렉트 계약은 그대로. 결정 #3 (b)면 여기에 `content.length > 2000` 검사(초과 시 '노트는 2,000자까지 남길 수 있어요.' + `dNote` 초안 보존 리다이렉트)를 넣는다 — textarea `maxLength`는 form POST로 우회된다. **결정 #2 권장안 (c)면 `updateConnectionNoteAction`(`:559-608`)·`deleteConnectionNoteAction`(`:611-655`)을 삭제** — 정책이 없어 항상 0행인데 `:601-607`/`:648`은 영향 행을 보지 않아 '노트를 수정했습니다.'/'삭제했습니다.'로 리다이렉트한다(거짓 성공). ①(190 적용)과 ④(웹 배포) 사이에는 이 거짓 성공이 실제로 노출되므로 ④를 ① 직후로 당기거나 두 액션 제거만 먼저 배포한다. (b′)면 `updateConnectionNoteAction`은 사전 조회(`:589-593`)에서 `created_at`도 읽어 창 밖이면 명시 오류로 거절하고 UPDATE에 `.select("id")`를 붙여 **0행이면 실패 처리**, 삭제 액션은 제거. (b)면 삭제도 같은 처리.
- `?dNote=` 초안 보존: 지금은 dead 경로(§2-3). **결정 #10** — (권장) `draftNoteBody`·`actionFeedback`을 두 디자인 워크스페이스에서 패널로 넘겨 모달 `defaultBody`에 연결 / (대안) `dNote` 배관 전체와 `questionRoomRedirect.contract.test.ts:151-163`의 `dNote` 단언 제거.
- 레거시 `initialNoteText`/`studentNoteText`/`mentorNoteText`와 `QuestionRoomWorkspace.tsx:270` 이하 구형 렌더: 실사용 도달 경로가 없다(§2-3). 이번 개편의 필수 범위는 아니며, 상세 4개 페이지의 `extractNoteText(bundle.notes.rows[0])` 계산과 함께 **별도 정리 PR에서 삭제**를 권고한다. 남겨 두면 "첫 1건"이 정렬 변경 후 "가장 오래된 1건"이 되어 의미가 어긋난다.
- `CLAUDE.md` 핵심 테이블 표 `connection_notes` 행 정정(`status` → `author_id, author_role, body, ink_path, ink_thumb_path`, append-only 명시; `:40` "room 단위"에 "작성자당 여러 장" 추가) · `docs/audit/db_expected_state.md:39`에 "유일 제약 없음(설계) · (권장안) UPDATE·DELETE 정책 없음" 추기 · 정책을 다시 쓰면 `contracts/snapshots/staging_contract.json` 재추출 · `docs/architecture/purpose-report/04-subscription-qna.md`의 "연결노트 패널" 절은 감사 스냅샷이므로 그대로 둔다.
- 별도 정리 PR(개편 필수 아님): `QuestionRoomWorkspace.tsx:152-163, 269-560`의 구형 렌더와 memo, 4개 페이지의 `initialNoteText` 계산·prop(`:111`).

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
| `lib/qna/__contract__/connectionNoteFreeRoom.contract.test.ts` | 유지 | 가드 계약 불변(가드는 노트 행을 읽지 않는다) |
| `lib/qna/__contract__/questionRoomRedirect.contract.test.ts` | 유지 | `kind=note` 계약 불변. 결정 #10에서 `dNote` 배관을 제거하면 `:151-163` 단언도 제거 |
| `lib/qna/__contract__/mentorRoomDetailWiring.contract.test.ts` · `lib/account/__contract__/accountDeletionBucketCoverage.contract.test.ts` | 유지 | 패널·조회 변경과 무관 / 계정 삭제 커버리지는 `author_id` 조인이라 행 수 무관 |
| 신규 `lib/qna/connectionNoteTimeline.ts` + `__contract__/connectionNoteTimeline.contract.test.ts` | 추가 | 패널에서 뽑아낸 순수 헬퍼: 같은 작성자 N행이 모두 카드가 됨 · `created_at`(동률 `id`) 정렬 · `side` 판정(방 id → `author_role` 폴백) · `editable`은 권장안 (c)면 필드 자체를 없애고, (b′)면 `본인 && 15분 이내` · desc+limit 조회를 뒤집는 형태 · `id`가 문자열이 아닌 행은 건너뜀. **`components/` 아래 컨트랙트 테스트는 불가** — 러너가 `lib/**/__contract__/*.contract.test.ts`만 훑고(`package.json:10`) TSX를 렌더할 수 없다 |
| 신규 `lib/qna/__contract__/connectionNotesPanelWiring.contract.test.ts` | 추가 | 소스 텍스트 회귀(패턴: `mentorRoomDetailWiring`): 패널에 `cards.length === 0` 조건·unique 주석이 없을 것 · 조회가 `created_at` + 명시 limit일 것 · 모달이 학생 전용 placeholder를 멘토에게 쓰지 않을 것 |
| 신규 `lib/qna/__contract__/connectionNoteEditWindow.contract.test.ts` | 추가(결정 #2 **(b′)** 채택 시에만) | `isWithinNoteEditWindow` 경계(14:59 허용 · 15:00 거부 · 잘못된 `created_at` 거부) — 패널 `editable`과 액션 사전 검사가 같은 함수를 써서 클라이언트·서버가 어긋나지 않게 |
| `e2e/connection-note-guard.spec.ts` | 수정 | 시드 INSERT 전에 해당 방의 `connection_notes` 정리(`.delete().eq('mentor_student_room_id', roomId)`) · INSERT 오류 `null` 단언 · 제약 제거 후 케이스: 같은 학생이 2장 INSERT 모두 성공 + `created_at` 순 2행 조회 |

### 8-3. DB
- 마이그레이션 자체 검증 블록(E): 제약 부재 · **다른 unique index도 없음** · `idx_cn_room_created` 컬럼 목록 · `idx_cn_author` 생존 · (F 권장안) `pg_policies`가 정확히 {`cn_select` SELECT, `cn_insert` INSERT} 2행이고 `cmd IN ('UPDATE','DELETE')` 행 0 · RLS 활성 · `trg_cn_set_updated` 잔존 — (b′)면 3행 + `cn_update`에 `created_at` + 트리거·함수 ACL. F 문장이 빠져도 통과하는 검증이면 의미가 없다.
- 신규 `scripts/verify/connection_notes_timeline_verify.sql`(패턴 `s2_2_batch_d_verify.sql`: `begin` → 로컬 가드 → fixture → `set_config('request.jwt.claims', …)` + `set local role authenticated` → 검증 → `rollback`): 같은 (방, 작성자) INSERT 2회 성공 · `ORDER BY created_at, id` 결정적 · (F 권장안) 본인 행이라도 UPDATE 0행 · DELETE 0행 · 구앱 시뮬레이션(최신 UPDATE + 나머지 DELETE) 후 **행 수뿐 아니라 각 행의 `body`·`updated_at`이 시드 값과 동일**(카운트만 세면 덮어쓰기를 놓친다) · **fixture 사용자 삭제 시 FK set-null 성공**(행은 남고 `author_id IS NULL`; 정책 제거와 무관함을 확인) · (b′)면 창 안 1행/창 밖 0행 · `set created_at = now()` → 예외 · FK set-null이 트리거에 막히지 않음.
- 구클라이언트 시뮬레이션(권장안 (c)): 한 작성자 행 3건 시드 → "`updated_at` 최신 1건 UPDATE + 나머지 DELETE"를 authenticated 컨텍스트(`set_config('request.jwt.claims', …)` + `set local role authenticated`, 패턴 `s2_2_batch_d_verify.sql:210-213`)로 실행 → **UPDATE 0행 · DELETE 0행 · 3행의 본문·`updated_at` 불변**. (b′)면 최신 1건이 15분 이내일 때 UPDATE 1행(정정)·DELETE 0행, `created_at = now()` UPDATE는 트리거로 거부.

---

## 9. 배포 순서 (게이트 조건 포함)

| # | 단계 | 게이트(다음으로 넘어가는 조건) |
|---|---|---|
| ① | DB: `190` 머지 → `db-apply-pending` apply(미적용 `189`와 **함께** 전량 적용) | 원장에 version 등재 · pg_constraint에서 제약 부재 확인 · (권장안) `pg_policies`가 `cn_select`/`cn_insert` 2행 · 웹 동작 변화 없음(버튼 숨김 그대로) · 구앱은 내 노트가 이미 있는 방에서 '저장'이 실패 스낵바로 끝난다(라이브 0행이라 실제 영향 0) · 웹의 기존 수정·삭제 버튼은 0행에 거짓 성공을 띄우므로 ④를 바로 잇는다(§7-3). **`191`은 이 시점에 main에 있으면 안 된다**(같이 적용돼 전원 강제 업데이트) |
| ② | 앱: `appendMyNote` + 타임라인 화면 빌드 → 스토어 심사·배포 | CI(analyze·test) 그린 · 스토어 게시 완료 · 결제 무관 기능이라 심사 리스크 낮음(인계 §5 권고 순서 ①단계에 해당) |
| ③ | 버전 게이트: `191`을 **양 스토어 게시 완료 후** 머지 → `db-apply-pending` apply (`min_supported_build`를 ②의 build로, **forceUpdate**) | 적용 전 `mobile_app_version_policies` 현재값 읽어 `sql_apply_manifest` 행에 기록(롤백용) · 원장 등재 · `get_mobile_app_version_policy('ios'/'android')` 응답 확인 · 구앱(build 19) 콜드 스타트가 `ForceUpdateScreen`에서 멈추는 것을 테스트 기기로 확인 · 스토어 바이너리의 실제 `buildNumber`가 19인지 확인(§11) · **`store_url`·`message`를 두 플랫폼 행에 채운 채 적용**(현재 둘 다 비어 있어 게이트 화면의 스토어 버튼이 스낵바만 띄운다 — §5-2 · §11 #14) |
| ④ | 웹: 패널 `canAdd` 개방 + 타임라인 정렬 + 카피 배포 | 결정 #2 권장안 (c) 채택 시 **① 직후 어느 때나**(DB가 구앱을 무해화하므로 ②·③과 무관; 거짓 성공 버튼 제거를 위해 오히려 ① 직후가 좋다). (b′)면 ① 직후 가능하나 15분 창 덮어쓰기가 남는다. (a)면 ③ 후 **재시작 유예 48시간 이상**(게이트는 콜드 스타트에서만 평가) |
| ⑤ | 문서: `db_expected_state.md`·`CLAUDE.md` 행 갱신, 앱 `APP_FEATURE_STATUS.md`, 계약 문서 | — |

결정 #2 권장안 (c)(UPDATE·DELETE 정책 제거)를 채택하면 ①에 정책 제거가 포함되어 ④가 ②·③보다 먼저 가도 데이터 소실은 없다(구앱은 기존 행을 바꾸거나 지울 수 없고, 두 번째 저장은 실패 스낵바로 끝난다). (b′)면 15분 창 덮어쓰기만 남는다. (a)면 **③→④ 순서와 재시작 유예가 유일한 방어**다.

클라우드 초기화가 예정돼 있다면 ①은 초기화 **후** 새 pack에 포함된 채로 재적용되면 되고, 초기화 전에 적용해도 행 0건이라 차이가 없다.

---

## 10. 오너 결정 필요 항목

| # | 질문 | 선택지 | 권장 |
|---|---|---|---|
| 1 | 웹 패널 레이아웃 | (a) 2열 유지(학생/멘토 각각 타임라인) · (b) 한 타임라인(역할 색 띠·라벨로 구분) | **(b)** — 학생 노트에 멘토가 답하는 흐름이 한 줄로 읽힌다. 앱도 (b)라 두 클라이언트가 같은 모양 |
| 2 | 수정·삭제 정책 | (a) 현행(본인 행 언제나) · (b) 수정·삭제 모두 15분 창 · (b′) 수정 15분 창 + 삭제 불가 + `created_at` 불변 트리거 · (c′) 수정 무제한 + 삭제 불가 · (c) **수정·삭제 모두 불가**(authenticated UPDATE·DELETE 정책 제거) | **(c)** — 유일하게 잔여 손실 0(§5-3 표). 구앱은 UPDATE 대상을 저장 순간 다시 고르므로 (b′)·(c′)는 다른 기기에서 남긴 내 노트를 덮어쓴다. `question_messages`와 같은 append-only 선례, 트리거·함수 없이 `drop policy` 2문(policies 174). 비용은 웹 인라인 수정 UI 제거(정정은 새 노트로). 초안 권장 (b′)에서 변경 |
| 3 | 본문 길이 상한 | (a) 없음(현행) · (b) 2,000자 클라이언트 강제 · (c) DB CHECK 추가 | **(b)** — DB 변경 최소. 상한값은 조정 가능. (c)를 고르면 단위를 맞춰야 한다: `char_length`는 코드포인트, Flutter `maxLength`/`.characters`는 grapheme이라 이모지 노트가 클라이언트는 통과하고 DB에서 `23514`로 실패할 수 있다(구앱에는 설명 없는 실패 스낵바) |
| 4 | 조회 상한 | (a) 무제한(현행) · (b) `created_at desc` **limit 200** + 클라이언트 반전 · (c) (b) + '이전 노트 보기' 커서 페이징 | **(b)** — 무제한 `asc`는 PostgREST max-rows(기본 1000)에 걸리면 **최신** 노트가 잘리므로 금지. 주 4~9 질문 방에서 200장은 수년치. 넘는 방이 생기면 (c)(앱은 `messagesBefore` 패턴 미러링) |
| 5 | 카피 | 버튼 '노트 남기기' · 모달 제목 · 역할별 placeholder(§7-2 초안) · 앱 빈 상태 본문('질문하고 답변을 확인하면 노트가 쌓여요' → '첫 노트를 남겨 보세요') · (c) 채택 시 안내 문장 '남긴 노트는 수정·삭제할 수 없어요. 고칠 내용은 새 노트로 남겨 주세요.' · 게이트 화면 `message`(§5-2) | 초안 승인 또는 수정 |
| 6 | 앱 '내 노트' 편집기 위치 | (a) 하단 고정 카드(현행 자리) · (b) 채팅형 입력 바 | **(a)** — 골격 유지 |
| 7 | 강제 업데이트 시점 | ②배포 직후 즉시 · 며칠 유예(recommend) 후 강제 | **즉시**(양 스토어 게시 후, `store_url`·`message` 세팅 필수 — §5-2) — (c) 채택 시 게이트는 데이터 안전장치가 아니라 구앱의 "두 번째 저장 실패" 상태를 끝내는 UX 장치. 결정 #2 미채택이면 데이터 안전장치라 더더욱 즉시 |
| 8 | 앱 경로의 구독 규칙 | (a) 현행 비대칭 유지(웹만 차단, 앱은 RLS 방 당사자만) · (a′) (a) + 표시 전용 완화: 세 진입점이 이미 든 `sub`를 화면에 넘겨 만료 시 작성 카드 비활성 + 문장(딥링크는 fail-open, §6) · (b) `cn_insert` 술어에 "활성 구독 또는 구독 이력 없는 무료 방" 조건 이관(웹 가드 `assertConnectionNoteWriteAllowed`와 같은 판정을 SQL로) · (c) append RPC 신설 | **1차 (a) 또는 (a′)** — 현행에도 없던 규칙이라 회귀가 아니다. (a′)는 DB 비용 0으로 웹 문구와 맞출 수 있으나 구속력은 없다. (b)는 정책 술어에 `subscriptions` 서브쿼리가 들어가는 별도 DB 변경이므로 후속 트랙으로 분리(구클라이언트에도 묶이는 유일한 방법이라는 점은 기록) |
| 9 | 웹 추가 버튼의 쓰기 불가 상태 | (a) 항상 노출, 서버 거절에 맡김(지금은 일반 문구로 세탁돼 이유를 모름) · (b) 페이지가 `canWrite`를 서버 계산해 패널에 전달, 불가 시 비활성 + 힌트 · (c) 페이지의 오류 매핑을 고쳐 액션 문구를 통과시킴 | **(b)** 를 개편 PR에, (c)는 별도 PR — 세탁은 노트 외 액션에도 걸린 기존 결함 |
| 10 | `dNote` 초안 보존 | (a) 워크스페이스 → 패널 → 모달 `defaultBody`로 연결 · (b) `dNote` 배관·계약 단언 제거 | **(a)** — 타임라인에서는 저장 시도가 잦아져 실패 시 글 소실이 체감된다 |
| 12 | 탈퇴 사용자 노트 잔존 | (a) 현행 — 행은 남고 `author_id NULL`, 상대는 계속 열람(계정 삭제 워커는 잉크 경로만 정리, `lib/account/accountDeletionBucketCoverage.ts:106-111`) · (b) 탈퇴 시 본문 마스킹/삭제(워커 확장) | **(a)** 1차 — 상대의 학습 기록 보존. 개인정보 정책과 맞춰 후속 |
| 13 | 표기 통일 | 웹 '연결 노트'(`ConnectionNotesPanel.tsx:256, 326` · 워크스페이스 주석) vs 앱·`CLAUDE.md` '연결노트' | **'연결노트'**(CLAUDE.md 통일 문구)로 통일 — 성공 문구의 영문 'connection note'도 제거 |
| 14 | 노트 신고·검수 | 신고 대상 `targetType`에 노트 없음(community_post/comment·mentor_profile·dispute 등만), 관리자 콘솔에 노트 화면 없음 — append-only면 작성자도 못 지운다 | 1차 범위 밖으로 기록. 물량이 생기기 전 `content_reports` 대상 추가 여부 결정 |
| 15 | 중복 제출 완화 | (a) 없음(앱 `_saving`·웹 pending 버튼만) · (b) 웹 액션에 30초 내 같은 본문 dedupe | **(a)** — append-only에서 중복 행은 노이즈일 뿐 손실이 아니다 |
| 11 | 타임라인 표시 순서 | (a) 오래된 것 위·최신 아래(조회 `desc`를 화면에서 뒤집음, 작성 카드는 하단 그대로) · (b) 최신 위(뉴스피드형, 작성 카드를 `ListView` 첫 자식으로) | **(a)** — 골격 유지(작성 카드 자리 불변; 방 홈 미리보기 2종 무변경은 두 안 모두) + 답글이 원 노트 **아래**에 읽힌다. (b)는 화면 구조 변경이고 답글이 원 노트 위에 놓인다 |

---

## 11. 미확인 항목

| # | 항목 | 확인 방법 |
|---|---|---|
| 1 | 앱 `1.0.0+19`(코드 `635ae738`)가 실제 스토어 배포본과 같은지 — §5의 위험 분석은 이 코드 기준 | 스토어 콘솔 · `mobile_app_version_policies.latest_build` 값 대조 |
| 2 | 클라우드 초기화 일정과 ①의 선후 | 오너 |
| 3 | 스토어 바이너리의 `PackageInfo.buildNumber`가 실제로 19인지(CI가 `--build-number`를 따로 넘기면 다를 수 있다) — ③의 `min_supported_build` 값이 이에 걸린다 | 스토어 콘솔 · CI 워크플로 |
| 4 | Flutter 웹 타깃(`web/` 디렉터리 존재, `kIsWeb` 분기)이 어딘가 배포돼 있는지 — 배포돼 있으면 게이트가 아예 없다 | 오너 |
| 5 | `.select().single()` 0행 시 PostgREST 오류 코드(예상 `PGRST116`) — 라이브러리 소스 미확인. 앱의 `catch` 경로는 코드로 확인됨(§5-3). **권장안 (c)에서는 안전과 무관** — DELETE는 정책 부재로 항상 0행이라 예외 여부는 스낵바 종류만 바꾼다 | 실기기 1회 |
| 6 | 웹 `window.confirm` 삭제 확인 — 결정 #2 (c)·(b′) 채택 시 삭제 UI 자체가 사라져 무관. (b) 채택 시 `AppToast`/모달로 바꿀지 | 관리자 콘솔 확인 모달 공통화 트랙과 함께 결정 |
| 7 | ~~`supabase_realtime` publication에 `connection_notes` 포함 여부~~ — **해소**: 포함되지 않는다(`20260803163322` N1 7테이블 · `137` · `117` 확인). 실시간 타임라인을 원할 때 추가 | — |
| 8 | 프로젝트의 PostgREST max-rows 설정값(기본 1000) — 결정 #4의 limit 근거 | Supabase 대시보드 API 설정 |
| 9 | 웹 노트 모달이 서버 액션 리다이렉트 뒤 실제로 열린 채 남는지(React 클라이언트 상태 유지 여부) — 정적으로는 닫는 코드가 없다 | 브라우저 1회 |
| 10 | 웹 액션이 `revalidatePath(room)`만 하는데 멘토 thread 상세 경로 갱신이 충분한지 — 페이지가 searchParams를 동적으로 읽어 문제없을 것으로 보이나 런타임 미확인 | 브라우저 1회 |
| 11 | 부모 원장의 현재 최대 version — `verify_local_stack_state.sh:58` 주석은 "프로덕션 원장 102본, `20260831100100`(189) 미적용"이라 적혀 있다. 지금도 그런지 | `select max(version) from supabase_migrations.schema_migrations` |
| 12 | ~~`mobile_app_version_policies` 현재 행~~ — **해소(2026-09-02 라이브 SELECT)**: android `min 9 · latest 16`, ios `min 1 · latest 16`, `minimum_version_name` '1.0.0', **`store_url` NULL(양쪽) · `message` ''**, `updated_at 2026-08-06`. `191` 자가 검증 "2행, min ≥ N"은 충족 가능하나 `store_url`·`message`가 비어 있어 §5-2의 스토어 버튼 문제가 있다 | 적용 직전 다시 SELECT해 `sql_apply_manifest` 행에 기록 |
| 13 | Supabase CLI 2.111.0 `db push`의 out-of-order 로컬 version 거부(`--include-all`) 동작 — CLI 지식 기반, 저장소 증거는 `--db-url` 존재 검사뿐 | CLI 문서 |
| 14 | 양 스토어의 앱 상세 URL — `191`의 `store_url` 값. Play는 `https://play.google.com/store/apps/details?id=com.ssambership.edu`(`applicationId`로 확정), App Store는 `https://apps.apple.com/kr/app/id<숫자 id>` 형식이라 **숫자 앱 id를 오너가 준다**(bundle id `com.ssambership.app`, `ios/Runner.xcodeproj/project.pbxproj:389`). 강제 업데이트 안내 문구(`message`)도 함께 | 오너 · 스토어 콘솔 |

(초안 시점의 미확인 — outbound manifest·소형 뷰포트/계층 테스트·레거시 memo 도달 여부·로컬 스택 md5·버전 정책 원천·구앱 예외 처리 경로 — 는 코드 열람으로 해소해 §2·§4·§5·§8에 반영했다.)

---

## 12. 부록 — 마이그레이션 SQL 초안

> 파일로 만들지 않았다. 오너 승인 후 §4-3 절차로 등재한다(원본은 `post_ledger_backfills/`, `supabase/sql/`은 바이트 동일 사본, `migrations/`는 생성기). `2026MMDD`는 **작성일**, `DD`는 190·191이 서로 다른 날이어야 한다(§4-3 2번). F 절과 E의 F 검사는 결정 #2(b′) 채택 시에만 포함하고, 미채택이면 F-1~F-3을 지우고 E의 정책 수 기대치를 4로, `cn_update` 창·`cn_delete` 부재·트리거·함수 ACL 검사를 제거한다. 초안은 이 저장소의 SQL 스타일(189)과 PostgreSQL 의미론 기준으로 검토를 거쳤으나, 이 환경에는 PostgreSQL이 없어 **실행은 하지 않았다** — 로컬 스택 재생(`db-migration-pack-verify`)이 첫 실행이다.

### 12-1. `190_connection_notes_timeline_drop_unique.sql`

```sql
-- =============================================================================
-- 190_connection_notes_timeline_drop_unique.sql  (2026-09-DD)
--
-- Purpose: 연결노트를 "(방, 작성자)당 1장 편집" 에서 "방 단위 누적 타임라인(append)" 으로
--   전환한다. UNIQUE 제약 connection_notes_room_author_unique 를 제거하고(제약 소유
--   unique index 도 함께 제거됨 — 같은 컬럼의 idx_cn_author(048) 가 남아 (방, 작성자)
--   조회 경로는 유지), 타임라인 정렬 인덱스 idx_cn_room_created(방, created_at, id) 를
--   추가한다. 컬럼(잉크 2열 포함)·FK 2종·trg_cn_set_updated·cn_select·cn_insert 는 불변.
--   [F 절 — 오너 결정 #2 권장안 (c)] cn_update·cn_delete 정책 제거(F-1, F-2) → authenticated 는
--   INSERT 만 가능한 엄격한 append-only(question_messages 와 같은 모양, 002_p0:227-248).
--   대안 (b′)(수정 15분 창 + 삭제 불가 + created_at 불변 트리거)는 말미 [ALT-b′] 블록.
--
-- Base: supabase/migrations/20260806033452_connection_notes_room_author_unique.sql
--   (원장 20260806033452 — 제약 추가 1문) · RLS 원문 supabase/sql/085_connection_notes_author_rls.sql.
--   라이브 실측 2026-09-02: connection_notes 0행 · mentor_student_rooms 0행.
--
-- Apply: 저장소 표준 경로(db-apply-pending) — MCP apply_migration 직접 적용 금지.
--   pack 등재: supabase/baseline/post_ledger_backfills/2026MMDD100100_connection_notes_timeline_drop_unique.sql
--
-- Rollback: 말미 (R) 블록 — (방, 작성자) 중복 0행 전제로 제약 재생성 + 인덱스 제거
--   + [F] 085 원문 정책 2종 재생성(대안 b′ 였다면 트리거·함수 제거도). 데이터 무접촉.
-- =============================================================================

begin;

-- A. 사전 게이트 — 테이블 실재 · 제약이 있으면 모양(UNIQUE(room, author)) 확인, 없으면 NOTICE(멱등)
DO $$
DECLARE v_def text;
BEGIN
  IF to_regclass('public.connection_notes') IS NULL THEN
    RAISE EXCEPTION '190_GATE: public.connection_notes not present';
  END IF;
  SELECT pg_get_constraintdef(c.oid) INTO v_def
    FROM pg_constraint c
   WHERE c.conrelid = 'public.connection_notes'::regclass
     AND c.conname  = 'connection_notes_room_author_unique';
  IF v_def IS NULL THEN
    RAISE NOTICE '190_GATE: connection_notes_room_author_unique already absent - nothing to drop';
  ELSIF v_def <> 'UNIQUE (mentor_student_room_id, author_id)' THEN
    RAISE EXCEPTION '190_GATE: constraint shape mismatch (%)', v_def;
  END IF;
END $$;

-- B. UNIQUE 제약 제거 — 제약이 소유한 unique index 도 함께 사라진다.
--    (방, 작성자) 조회는 같은 컬럼의 idx_cn_author(048) 가 계속 담당한다.
ALTER TABLE public.connection_notes
  DROP CONSTRAINT IF EXISTS connection_notes_room_author_unique;

-- C. 타임라인 정렬 인덱스 — (방, created_at, id). id 는 같은 트랜잭션에서 생긴 동일
--    created_at 의 결정적 타이브레이커. 오름차순 인덱스 하나로 asc/desc 정렬을 모두
--    지원한다(역방향 스캔) — 클라이언트는 ORDER BY created_at, id 를 같은 방향으로 쓴다.
--    idx_cn_msr(updated_at desc)·idx_cn_author 는 유지(구앱 build 19 가 updated_at 정렬 사용).
CREATE INDEX IF NOT EXISTS idx_cn_room_created
  ON public.connection_notes (mentor_student_room_id, created_at, id);

-- D. 계약 주석 (단일 문자열 리터럴 — COMMENT 는 상수만 허용하며, 줄바꿈으로 분리된
--    인접 리터럴 결합에 기대지 않는다)
COMMENT ON TABLE public.connection_notes IS
  '연결노트 — mentor_student_rooms 1방 = 누적 타임라인 1개. 한 작성자(author_id)가 여러 행을 append 한다. 정렬 (created_at, id). 2026-09 개편(190): 구 (방,작성자) UNIQUE 계약 폐기. 손글씨 ink_path/ink_thumb_path 는 예약 컬럼, 기능 없음.';

-- F. [오너 결정 #2 권장안 (c) — 미채택이면 F 와 E 의 F 검사를 삭제, (b′) 채택이면 말미 ALT-b′ 로 대체]
-- F-1. cn_update 제거 — authenticated 의 UPDATE 는 RLS 필터로 0행(오류 없음). 구앱(build 19)의
--      '최신 내 노트 UPDATE' 가 0행이 되어 .select().single() 이 예외 → 나머지 노트 DELETE 블록에
--      도달하지 못한다(write repo :209-233). 사용자 수정은 없다 — 정정은 새 노트로.
DROP POLICY IF EXISTS "cn_update" ON public.connection_notes;

-- F-2. cn_delete 제거 — authenticated 의 DELETE 는 항상 0행. service_role(계정 삭제 워커·e2e admin
--      클라이언트)은 RLS 우회라 영향 없고, users FK ON DELETE SET NULL(048) 도 정책과 무관하게 동작한다.
--      정책 수 176→174, 함수·트리거 변화 없음(functions 222).
DROP POLICY IF EXISTS "cn_delete" ON public.connection_notes;

-- E. 적용 직후 자가 검증
DO $$
DECLARE v_n int;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint
              WHERE conrelid = 'public.connection_notes'::regclass
                AND conname  = 'connection_notes_room_author_unique') THEN
    RAISE EXCEPTION '190_VERIFY: connection_notes_room_author_unique still present';
  END IF;
  SELECT count(*) INTO v_n FROM pg_indexes
   WHERE schemaname = 'public' AND tablename = 'connection_notes'
     AND indexdef LIKE 'CREATE UNIQUE INDEX%' AND indexname <> 'connection_notes_pkey';
  IF v_n <> 0 THEN
    RAISE EXCEPTION '190_VERIFY: unexpected unique index remains (%)', v_n;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes
                  WHERE schemaname = 'public' AND tablename = 'connection_notes'
                    AND indexname = 'idx_cn_room_created'
                    AND indexdef LIKE '%(mentor_student_room_id, created_at, id)') THEN
    RAISE EXCEPTION '190_VERIFY: idx_cn_room_created missing or wrong columns';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes
                  WHERE schemaname = 'public' AND tablename = 'connection_notes'
                    AND indexname = 'idx_cn_author') THEN
    RAISE EXCEPTION '190_VERIFY: idx_cn_author missing (room, author lookup path lost)';
  END IF;
  -- [F] 정책이 정확히 cn_select(SELECT)·cn_insert(INSERT) 2행이고 UPDATE/DELETE 행은 0, RLS 활성
  SELECT count(*) INTO v_n FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'connection_notes';
  IF v_n <> 2 THEN
    RAISE EXCEPTION '190_VERIFY: connection_notes policy count % (expected 2)', v_n;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies
              WHERE schemaname = 'public' AND tablename = 'connection_notes'
                AND cmd IN ('UPDATE', 'DELETE')) THEN
    RAISE EXCEPTION '190_VERIFY: UPDATE/DELETE policy still present on connection_notes';
  END IF;
  SELECT count(*) INTO v_n FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'connection_notes'
     AND ((policyname = 'cn_select' AND cmd = 'SELECT')
       OR (policyname = 'cn_insert' AND cmd = 'INSERT'));
  IF v_n <> 2 THEN
    RAISE EXCEPTION '190_VERIFY: cn_select/cn_insert missing (%)', v_n;
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.connection_notes'::regclass) THEN
    RAISE EXCEPTION '190_VERIFY: RLS disabled on connection_notes';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                  WHERE tgrelid = 'public.connection_notes'::regclass
                    AND tgname = 'trg_cn_set_updated' AND NOT tgisinternal) THEN
    RAISE EXCEPTION '190_VERIFY: trg_cn_set_updated missing';
  END IF;
END $$;

commit;

-- (R) Rollback — 별도 실행(정식 pack 은 forward-only). 아래 조회가 0행일 때만.
-- select mentor_student_room_id, author_id, count(*) from public.connection_notes
--   group by 1, 2 having count(*) > 1;
-- alter table public.connection_notes
--   add constraint connection_notes_room_author_unique unique (mentor_student_room_id, author_id);
-- drop index if exists public.idx_cn_room_created;
-- comment on table public.connection_notes is null;
-- [F] supabase/sql/085_connection_notes_author_rls.sql 의 cn_update(:43-63)·cn_delete(:67-78) 원문 재생성.
-- [ALT-b′ 였다면 그 전에] drop trigger if exists trg_cn_created_at_immutable on public.connection_notes;
--   drop function if exists public.connection_notes_forbid_created_at_change();
```

**`[ALT-b′]` — 대안 (b′) 채택 시 F-1/F-2 대신 넣는 블록.** E의 F 검사는 "정책 3행 · `cn_update`의 qual/with_check에 `created_at` · `cn_delete` 부재 · 트리거 실재 · 함수가 anon/authenticated에 EXECUTE 불가"로 바꾸고, 구조 카운트 기대치는 policies 175 · functions 223.

```sql
-- F-1. cn_update — 작성 후 15분 이내 본인 행만(정정 창). 같은 이름 재정의(정책 수 불변).
--      USING 이 기존 행을, WITH CHECK 가 갱신 결과 행을 창으로 제한한다. now() 는 STABLE
--      (트랜잭션 시작 시각) 이라 정책식에 허용된다. WITH CHECK 만으로는 created_at 을
--      now() 로 밀어 창을 연장하는 우회를 못 막으므로 F-3 트리거가 필요하다.
DROP POLICY IF EXISTS "cn_update" ON public.connection_notes;
CREATE POLICY "cn_update" ON public.connection_notes
  FOR UPDATE TO authenticated
  USING (
    author_id = (SELECT auth.uid())
    AND created_at > now() - interval '15 minutes'
    AND EXISTS (SELECT 1 FROM public.mentor_student_rooms r
                 WHERE r.id = connection_notes.mentor_student_room_id
                   AND (SELECT auth.uid()) IN (r.student_id, r.mentor_id))
  )
  WITH CHECK (
    author_id = (SELECT auth.uid())
    AND created_at > now() - interval '15 minutes'
    AND EXISTS (SELECT 1 FROM public.mentor_student_rooms r
                 WHERE r.id = mentor_student_room_id
                   AND (SELECT auth.uid()) IN (r.student_id, r.mentor_id))
  );

-- F-2. cn_delete 제거 — authenticated 의 DELETE 는 RLS 필터로 0행(오류 없음). service_role
--      (계정 삭제 워커·e2e admin 클라이언트)은 RLS 우회라 영향 없다. 정책 수 176→175.
DROP POLICY IF EXISTS "cn_delete" ON public.connection_notes;

-- F-3. created_at 불변 트리거 — created_at 만 고정한다. author_id 는 고정하지 않는다:
--      users 삭제 시 FK ON DELETE SET NULL(048) 이 BEFORE UPDATE 트리거를 발화시키므로
--      author_id 를 고정하면 계정 삭제가 실패한다. 함수 수 222→223.
CREATE OR REPLACE FUNCTION public.connection_notes_forbid_created_at_change()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $fn$
BEGIN
  IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'CONNECTION_NOTE_CREATED_AT_IMMUTABLE' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION public.connection_notes_forbid_created_at_change() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_cn_created_at_immutable ON public.connection_notes;
CREATE TRIGGER trg_cn_created_at_immutable
  BEFORE UPDATE ON public.connection_notes
  FOR EACH ROW EXECUTE FUNCTION public.connection_notes_forbid_created_at_change();

-- ▼ E 자가 검증 DO 블록 안에서 권장안의 [F] 검사 4개를 아래 검사로 교체한다.
  -- [ALT-b′] 정책 3종(select/insert/update) · cn_update 창 · cn_delete 부재 · 트리거 실재 · 함수 ACL
  SELECT count(*) INTO v_n FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'connection_notes';
  IF v_n <> 3 THEN
    RAISE EXCEPTION '190_VERIFY: connection_notes policy count % (expected 3)', v_n;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                  WHERE schemaname = 'public' AND tablename = 'connection_notes'
                    AND policyname = 'cn_update' AND cmd = 'UPDATE'
                    AND qual LIKE '%created_at%' AND with_check LIKE '%created_at%'
                    AND qual LIKE '%author_id%' AND qual LIKE '%mentor_student_rooms%') THEN
    RAISE EXCEPTION '190_VERIFY: cn_update window policy shape mismatch';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies
              WHERE schemaname = 'public' AND tablename = 'connection_notes'
                AND policyname = 'cn_delete') THEN
    RAISE EXCEPTION '190_VERIFY: cn_delete still present';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger t
                  WHERE t.tgrelid = 'public.connection_notes'::regclass
                    AND t.tgname = 'trg_cn_created_at_immutable' AND NOT t.tgisinternal) THEN
    RAISE EXCEPTION '190_VERIFY: trg_cn_created_at_immutable missing';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'public' AND p.proname = 'connection_notes_forbid_created_at_change'
                AND (has_function_privilege('anon', p.oid, 'EXECUTE')
                     OR has_function_privilege('authenticated', p.oid, 'EXECUTE'))) THEN
    RAISE EXCEPTION '190_VERIFY: trigger function still executable by anon/authenticated';
  END IF;
```

### 12-2. `191_mobile_app_version_policy_min_build_<N>.sql` (③ 시점에만 머지)

```sql
-- =============================================================================
-- 191_mobile_app_version_policy_min_build_<N>.sql  (2026-MM-DD)
--
-- Purpose: 연결노트 타임라인 전환(190) 후속 — 구앱(build < N, upsertMyNote 의
--   '최신 1건 UPDATE + 나머지 DELETE' 경로)을 강제 업데이트로 차단한다.
--   mobile_app_version_policies.min_supported_build 를 N 으로 상향(앱은
--   currentBuild < min_supported_build 면 GateForceUpdate — version_gate_decision.dart:38).
--   latest_build 도 함께 N 이상으로 맞춰 CHECK mavp_latest_ge_min_chk(latest >= min) 를 지킨다.
--   store_url·message 도 함께 채운다 — 라이브 두 행 모두 비어 있고(2026-09-02), 비어 있으면
--   ForceUpdateScreen 의 '스토어에서 업데이트' 버튼이 스낵바만 띄운다(version_gate_screens.dart:19-37).
--
-- Base: supabase/sql/162_mobile_app_version_policy.sql (테이블·RPC·seed) ·
--   선례 supabase/migrations/20260806075353_mobile_version_policy_latest_build_16.sql (greatest 멱등 UPDATE).
--
-- Apply: db-apply-pending — ★ pending 전량이 함께 적용되므로 이 파일은 신앱 build N 이
--   양 스토어에 게시된 뒤(§9 ③ 시점)에만 main 에 병합한다. 데이터만 변경(DDL 0).
--   pack 등재: supabase/baseline/post_ledger_backfills/2026MMDD100100_mobile_app_version_policy_min_build_<N>.sql
--
-- Rollback: update public.mobile_app_version_policies set min_supported_build = <적용 전 값> …
--   (적용 전 값은 apply 직전 select 로 기록해 둔다). 데이터만.
-- =============================================================================

begin;

-- 멱등: 이미 N 이상이면 no-op. 낮추지 않는다(greatest). trg_mavp_set_updated 가 updated_at 을
-- 채우지만 선례(20260806075353)와 같이 명시한다.
update public.mobile_app_version_policies
   set min_supported_build  = greatest(min_supported_build, N),
       latest_build         = greatest(coalesce(latest_build, 0), N),
       minimum_version_name = '<신앱 표시 버전, 예 1.0.1>',
       -- 스토어 버튼 활성화. 이미 값이 있으면 유지(멱등). 형식은 CHECK mavp_store_url_chk(https) +
       -- mavp_store_url_platform_chk(20260808080056: android=play.google.com, ios=apps.apple.com/itunes.apple.com)
       -- 가 강제하므로 틀린 값은 여기서 실패한다.
       store_url            = coalesce(store_url, case platform
                                when 'android' then 'https://play.google.com/store/apps/details?id=com.ssambership.edu'
                                when 'ios'     then '<App Store 상세 URL, 예 https://apps.apple.com/kr/app/id123456789>'
                              end),
       message              = case when coalesce(message, '') = ''
                                then '<강제 업데이트 안내 문구, 예: 연결노트가 새로워졌어요. 최신 버전으로 업데이트해 주세요.>'
                                else message end,
       updated_at           = now()
 where platform in ('ios', 'android')
   and (min_supported_build < N
        or coalesce(latest_build, 0) < N
        or minimum_version_name is distinct from '<신앱 표시 버전, 예 1.0.1>'
        or store_url is null
        or coalesce(message, '') = '');

-- 자가 검증 — 두 플랫폼 행이 존재하고 min_supported_build >= N. 행 부재는 게이트 무효
-- (RPC 가 min=1 기본값을 돌려준다 — 162) 이므로 실패로 본다. 클린 재생에도 162 seed 2행이 있다.
DO $$
DECLARE v_n int;
BEGIN
  SELECT count(*) INTO v_n FROM public.mobile_app_version_policies
   WHERE platform IN ('ios', 'android')
     AND min_supported_build >= N
     AND latest_build >= min_supported_build
     AND store_url IS NOT NULL
     AND coalesce(message, '') <> '';
  IF v_n <> 2 THEN
    RAISE EXCEPTION '191_VERIFY: version policy rows with min_supported_build >= N and store_url/message set: % (expected 2)', v_n;
  END IF;
END $$;

commit;
```

검증 조회(적용 후):
```sql
select conname, pg_get_constraintdef(oid) from pg_constraint
 where conrelid = 'public.connection_notes'::regclass order by 1;
select indexname, indexdef from pg_indexes where schemaname = 'public' and tablename = 'connection_notes' order by 1;
select policyname, cmd, qual, with_check from pg_policies where tablename = 'connection_notes' order by cmd;
select tgname from pg_trigger where tgrelid = 'public.connection_notes'::regclass and not tgisinternal;
select platform, min_supported_build, latest_build, minimum_version_name, store_url, message from public.mobile_app_version_policies;
```
