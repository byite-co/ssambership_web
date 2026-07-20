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
