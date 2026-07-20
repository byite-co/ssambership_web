# v16(1) 웹·DB 연속 자율 실행 v2 — Phase 체크포인트

> 기준: PR #42 정본 · base HEAD `b54255f` · staging `lbeqxarxothkmzqvpudy` · PR draft 유지.
> 각 Phase는 구현·정적검증(tsc/eslint)·staging 구조검증까지 완료하고, 실브라우저/2세션/실FCM 등
> 환경 제약은 검증 부채(E2E_DEBT / CONCURRENCY_DEBT / WAITING_EXTERNAL_APP)로만 남기고 다음으로 진행.

## SQL 번호 배정 (146~)
| 번호 | 내용 | 종류 |
|------|------|------|
| 146 | 2-1 avatar/document 교차ref 진단 | READ-ONLY(미적용) |
| 147 | 2-2 게시판 idempotency·soft-delete 정본 수렴 | 적용(staging no-op) |

## 알려진 baseline 부채(내 변경 아님)
- eslint `react-hooks/set-state-in-effect`(신규 규칙)가 기존 파일 다수에서 error:
  CommunityHomeFeed.tsx·CommunityShortformGrid.tsx(setPage 리셋), MentorCommunityComposeForm(구 FormSubmitButton import) 등.
  브랜치 HEAD(b54255f)에 이미 존재. `next build`는 eslint 게이트가 아니라 Vercel green 유지.
  이번 작업 파일은 전부 lint-clean. 이 baseline 정리는 별도 스코프.

---

## Phase 2-1 — 프로필 사진·인증서류 분리 ✅ 구현완료
- **상태 확인**: 데이터층 분리는 이미 정상. avatar=`mentor_profiles.profile_image_url`(편집 폼 전용),
  인증서류=`student_id_image_url`(인증/가입 액션 전용). `updateMentorProfile`은 문서 컬럼을 절대 건드리지 않음.
  프로필 편집 UI 5번 섹션은 상태 배지 + 인증 페이지 링크만 노출(학생증 미리보기 없음). 공개 프로필·미리보기 카드는 `photoUrl`만 사용.
- **이번 작업**:
  - `lib/mentor/mentorProfilePayload.ts` — 순수 payload 빌더 추출. core/imagePatch/extras 반환.
    인증서류 컬럼 절대 미포함(`FORBIDDEN_DOCUMENT_COLUMNS`), 학적 잠금 컬럼 UPDATE 제외, avatar 는 imagePatch 단일 키.
  - `mentorProfileMutations.ts` — 인라인 payload 구성을 빌더 호출로 교체(동작 보존).
  - `lib/mentor/__contract__/mentorProfilePayload.contract.test.ts` — 합성 A/B ref 계약 테스트 6건(node:test). **6/6 pass**.
  - `package.json` `test:contract` 스크립트 추가(`node --test --experimental-strip-types`).
  - tsconfig/eslint 에서 `**/__contract__/**` 제외(.ts 확장자 import 전용 하네스).
  - `supabase/sql/146_..._diagnostic.sql` — 교차 ref 진단(READ-ONLY). staging 실행 = **0행**.
- **검증**: tsc 0, eslint 0, 계약테스트 6/6, staging 교차ref 0.
- **부채**: 실브라우저 프로필 편집 왕복 = E2E_DEBT.

## Phase 2-2 — 게시판 중복·이미지·수정·삭제 ✅ 구현완료
- **중복 방지**: `create_idempotency_key`(요청 UUID) + `(author_id, create_idempotency_key)` UNIQUE.
  insert 시 23505 → 기존 글 조회 후 반환(멱등 재생, 중복 업로드분 보상 삭제). 클라: 제출 중 버튼 disable +
  요청 UUID(성공/검증실패 redirect 후 remount 시 새 UUID).
- **이미지 staged/direct upload**: 브라우저가 Storage 로 직접 업로드(RLS cpi_auth_insert_own `{userId}/…`),
  finalize action 은 ref(텍스트)만 수신 → 413(1MB body) 회피. 신규 ref 소유권(`communityImageRefBelongsToUser`)
  서버 재검증(위조 차단). object URL 미리보기 + replace/unmount 시 revoke. 부분 실패 보상 삭제 + 교체 구이미지 차집합 정리.
  순수 ref 유틸 `communityImageRef.ts`(클라·서버·테스트 공용)로 통합.
- **soft-delete**: `deleted_at` 신호. 작성자 삭제 액션 + 관리자 모더레이션 hard DELETE→soft(행 보존·감사),
  복원 시 deleted_at 해제. 목록/상세/스크랩/드래프트 조회 전부 `deleted_at IS NULL` 필터. 삭제 글 상세=not-found.
- **수정·삭제 UI**: 상세에 작성자 전용 수정/삭제 노출(`isAuthor`). 편집 라우트 `/community/board/[id]/edit`
  (`getCommunityBoardPostForEdit` — 본인·미삭제 글만). update 경로가 소유권+deleted_at 서버 재검사.
- **검증**: tsc 0, 변경파일 eslint 0, 계약테스트 11/11(ref 소유권 5건 포함), staging 147 no-op 적용.
- **부채**: 실브라우저 왕복(더블클릭·부분실패·413 회피 실측)=E2E_DEBT. 중복 테스트 글 자동삭제 안 함(ID만 보고 대상).

## Phase 2-3 — 숏폼 413·미리보기·중복 ✅ 구현완료
- **413 회피(staged upload)**: 서버 `createShortformVideoUploadTicketAction`(멘토·계정활성만) → 서명 티켓(path·token,
  service-role 서명·경로는 서버가 본인 userId 로 통제). 브라우저가 `uploadToSignedUrl` 로 Storage 직접 업로드.
  finalize 액션은 `videoRef`(텍스트)만 수신 — body limit 미상향, 새 dependency 없음(기존 Supabase JS).
- **소유권**: finalize 가 `shortformVideoRefBelongsToUser` 로 신규 ref 위조(타인 경로) 거부. 순수 `shortformVideoRef.ts` 공용.
- **미리보기·replace**: 단일 영상 File state(append 아님·replace), `<video>` object URL 미리보기, 교체/언마운트 시 revoke.
- **중복**: 148 `create_idempotency_key` + `(author_id,key)` UNIQUE(staging no-op 수렴). insert 23505→기존행 반환(멱등,
  중복 업로드분 보상 삭제). 클라 요청 UUID + 제출 중 버튼 disable → 더블클릭·재시도 1행. draft status 보존.
- **보상**: finalize 실패 시 신규 미등록 영상 보상 삭제, 교체 성공 후 구영상 차집합 정리(기존 로직 유지).
- **검증**: tsc 0, 변경파일 eslint 0, 계약테스트 16/16(숏폼 ref 5건 포함), staging 148 no-op 적용.
- **부채**: 실브라우저 업로드 왕복(500MB·더블클릭·finalize 실패 보상)=E2E_DEBT.

## Phase 2-4 — 알림·멘토 목록 계약 테스트 ✅ 구현완료
- **순수 추출**: `notificationCursor.ts`(encode/decode·isNotificationReadRow, hub 가 re-export),
  `orderCardsByIds.ts`(favorite/recent 정렬 — scopedMentorsList 중복 제거).
- **계약 테스트(19건, 총 35/35)**:
  - 알림 커서 왕복(+00:00·uuid 무손상, URL-safe), 잘못된 커서 null, 읽음판정(bool·timestamp·1970 sentinel·null col).
  - 카테고리 파싱(all 폴백)·타입목록·href(unread/카테고리 반영, 필터 변경 시 cursor 초기화).
  - 최근 본 멘토: 순서(최신 먼저)·dedup·손상 localStorage→[]·빈 상태·무효 id 무시(localStorage mock).
  - scope 정렬: recent(ids 순서)·favorite(입력정렬 유지)·디렉터리 제외·빈 ids·원본 불변.
- **검증**: tsc 0, 변경파일 eslint 0, 계약테스트 35/35.
- **부채**: read-before-navigation·비로그인·서버 favorite 필터 왕복 실브라우저=E2E_DEBT.

## Phase 1 후속(비차단) ✅ 구현완료
### 질문 첨부 Storage INSERT 자격 (149)
- `qra_path_upload_eligible(name)` + Storage INSERT 정책 conjunct 추가. 등록 RPC 호출 없이 quota 소모하는
  업로드를 차단: 학생은 (활성구독 && pending 환불 없음) 또는 (구독없음 && 경로 thread=본인 무료질문 스레드)만 허용.
  멘토 업로더 미영향. RLS with_check 는 비잠금 best-effort(최종 원자 잠금·환불검사는 등록 RPC).
- staging 적용 완료. 141/142 미수정.

### refund billing event 정본 FK (150)
- `refunds.billing_event_id uuid` FK → subscription_billing_events(id) ON DELETE SET NULL + 부분 인덱스.
- 웹 신규 refund 경로 2곳(구독 취소·멘토 종료)이 current billing event id 기록.
- `qna_subscription_has_live_refund` 를 current billing event 기준으로 정밀화(billing_event_id NULL 레거시는
  안전하게 계속 카운트 — 추정 백필 금지). production 배포 전 NULL 진단 쿼리 파일 주석에 포함.
- staging refunds=0행(신규 컬럼 안전). 064/069/142 미수정.

## SQL 번호 추가
| 149 | Storage INSERT 자격 게이트 | 적용 |
| 150 | refund billing_event FK + 게이트 정밀화 | 적용 |

## Phase 3 — P1-10 회원탈퇴 saga + P2-22 ✅ 구조·mock 검증완료 (기능 플래그 OFF)
- **151 saga DB**: `account_deletion_jobs`(service_role 전용, RLS deny). 상태기계
  pending→locked→purging→storage_purged→finalized→auth_soft_deleted→completed(+canceled/failed).
  attempts·last_error·next_attempt_at·cancelable_until·dry_run. RPC: request/cancel/advance/record_error/worker_claim.
  pending 만 취소(window 내), locked 이후 취소 금지, pending→locked 은 cancelable 경과 후, locked→purging 원자,
  전이표 강제(storage_purged 전 finalized 금지), advance 멱등.
- **write gate**: `account_deletion_write_blocked`(locked 이상) + 범용 트리거 → cash_wallets·cash_ledger·payments·
  question_messages·community_posts·shortform_posts INSERT/UPDATE 차단. Storage INSERT 정책(qra·community·shortform)에
  deletion conjunct 추가. **0 job 이면 전부 무영향(기능 OFF 안전)**.
- **worker(dry-run 기본)**: `accountDeletionWorker.runAccountDeletionJob` 어댑터 주입(실/테스트 분리). 
  purge 계획=DB refs ∪ 버킷 인벤토리 합집합·dedup(`accountDeletionPurgePlan`), 삭제결과 검사(잔여)·빈상태 재검증
  (Storage 성공 전 finalized 금지), 지갑 forfeit+익명화 원자 경계, auth soft-delete 재시도. dry-run 은 파괴 단계 전 정지.
- **P2-22**: `resolveEffectiveAccountStatus` 순수 — suspended_until 만료 자동해제, role 실패=transient error(active 폴백 금지),
  locked/purging=deletion_in_progress, 완료계열=deleted, canLogin 계약.
- **검증**: staging 151 적용 + rollback-only fixture 12항목 전부 통과(전이·취소·write gate·멱등·record_error, 실데이터 무변경).
  계약테스트 12건(status 8·purge 4, 총 47/47). tsc 0, eslint 0. account_deletion_jobs staging 0행 유지.
- **부채**: 앱 경로 배선(삭제 요청 UI·세션 폐기·effective status 소비자·실 Storage/auth 어댑터)=WAITING_EXTERNAL_APP(플래그 ON 컷오버).
  실 삭제 실행 없음(dry-run·mock).
