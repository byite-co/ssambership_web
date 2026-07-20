# v16(1) 웹·DB 연속 자율 실행 v2 — Phase 체크포인트

> 기준: PR #42 정본 · base HEAD `b54255f` · staging `lbeqxarxothkmzqvpudy` · PR draft 유지.
> 각 Phase는 구현·정적검증(tsc/eslint)·staging 구조검증까지 완료하고, 실브라우저/2세션/실FCM 등
> 환경 제약은 검증 부채(E2E_DEBT / CONCURRENCY_DEBT / WAITING_EXTERNAL_APP)로만 남기고 다음으로 진행.

## SQL 번호 배정 (146~)
| 번호 | 내용 | 종류 |
|------|------|------|
| 146 | 2-1 avatar/document 교차ref 진단 | READ-ONLY(미적용) |

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
