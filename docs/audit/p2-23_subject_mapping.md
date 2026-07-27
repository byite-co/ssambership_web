# P2-23 과목 FK 정책 — 조사·구현 결과 (결정 A: 정본 매핑 추가)

> 결정 A(2026-07-19): 정본 매핑 추가 방식. 자유 문자열을 FK 컬럼에 그대로 저장 금지.
> 자유과목 허용 방식 미채택. Flutter 저장소 무접근(앱 인수인계 계약만 참조).

## 1. 웹 라벨 ↔ 운영 `subjects.code` 대조

- 운영 `public.subjects`(staging): **35행** (code PK · label · sort_order · parent_code).
- 웹 정본 `lib/subjects/subjectCatalog.ts` `SUBJECT_CATALOG`: **35항목**.
- **완전 일치**: 두 집합의 code·label·parent가 동일. 웹 선택지(`SUBJECT_SELECT_GROUPS`)의 모든 옵션이 유효 code.
- **누락 과목 없음** → catalog 확장 DRAFT·`DECISION_REQUIRED` 항목 **없음**.

## 2. 매핑 안전성 (기존 코드)

- `normalizeSubjectCode(input)` = code passthrough → 현재 라벨→code → 레거시 라벨→code → **null**. `?? input` 폴백 없음.
- `subjectCodesFromText(...)` = 매칭 실패 토큰을 **버림**(자유 문자열 저장 안 함).
- `question_threads.subject`(비 FK): `questionRoomMutations`가 `subjectCode` 있을 때만 저장 → 이미 code 기반.

## 3. 구현 (이번 커밋)

- **결함**: 개별질문 작성 액션(`individualQuestionActions.ts` direct·open)이 **폼 원문 `subject`를 `p_subject`로 그대로 전달** → `individual_questions.subject`에 자유 문자열 저장 가능.
- **수정**: 두 액션에서 `subject = normalizeSubjectCode(optionalText(...))`로 **정본 code(또는 null)만 전달**. 미매핑 입력은 null(자유 문자열 저장 금지).

## 4. DB FK 드리프트 (WAITING_EXTERNAL_APP — 미적용)

- `060_ai_readiness_question_schema.sql`은 `individual_questions.subject text references public.subjects(code)`로 **FK**를 의도하나, **staging 실 스키마에는 FK 부재**(드리프트). 컬럼은 nullable text.
- staging `individual_questions` = **0행**이라 FK 복원 자체는 기술적으로 안전.
- 그러나 FK 복원은 **모든 클라이언트(앱 포함)** 의 IQ 생성에 code 강제를 적용한다. 앱이 비정본 subject를 보내면 write가 거부될 수 있어, 앱 subject-code 계약 확인 전에는 **적용 보류(WAITING_EXTERNAL_APP)**.
- 권장: 앱 인수인계 문서에서 "IQ subject = subjects.code 정본" 계약을 확인한 뒤, 새 번호(132+)로 `alter table public.individual_questions add constraint ... foreign key (subject) references public.subjects(code)` 복원. **임의 적용하지 않음.**

## 5. 잔여
- 웹 정규화는 정적 검증 완료. 실제 IQ 생성 런타임 E2E는 인증환경 부재로 검증 부채.
- `custom_request_posts.subject`는 자유 텍스트(비 FK, 의뢰 설명용)로 설계상 정본 code 대상 아님.
