# 코드 리뷰 수정 기획 (2026-07)

> 대상: `docs/audit/CODE_REVIEW_2026-07.md`(웹) · `ssambership-app/docs/CODE_REVIEW_2026-07.md`(앱)에서 검증된 발견
> 브랜치: `claude/code-review-markdown-repos-g18cv7`

리뷰에서 확정된 발견을 **① 이번 PR에서 자율 수정**, **② 후속(협의·회귀검증 필요)** 으로 나눈 실행 기획입니다. 자율 수정 대상은 변경 범위가 좁고 검증 가능한 항목만 포함했고, 권한 모델·금전 워크플로처럼 회귀 위험이 큰 항목은 근거와 함께 후속으로 분류했습니다.

## ① 이번 PR에서 수정

| ID | 발견 | 심각도 | 조치 | 검증 |
|---|---|---|---|---|
| B | 가입 메타데이터로 admin 자가 승격 | 🔴 치명 | 신규 마이그레이션 `120` — 가입 트리거가 메타데이터 `app_role`을 `student/mentor`로만 강제(‘admin’ 제거). 기존 트리거 `create or replace`. | SQL 문법·역할 강등 로직 리뷰. admin은 대역외(service_role) 프로비저닝만 허용됨을 주석화 |
| C | 분쟁 분배 RPC 수수료 20% 잔존 | 🟠 높음 | 신규 마이그레이션 `121` — `record_custom_order_dispute_split`를 `v_fee_rate := 0.05`로 재정의(본문 동일, 090과 동일 패턴) | 057 본문과 diff가 `v_fee_rate` 한 줄·주석뿐임을 대조 |
| D | 신고 모더레이션 CHECK 위반 | 🟠 높음 | 신규 마이그레이션 `122` — `content_reports_status_allowed` CHECK에 `'hidden','removed'` 추가(코드의 statusMap 의도 보존) | 032 CHECK와 코드 `statusMap`(hidden/removed) 정합 확인 |
| E | 앱 createThread status 누락 | 🟠 높음 | `question_room_write_repository.dart` — INSERT에 `'status': 'pending'` 추가(웹과 동일) | 웹 `questionRoomMutations.ts:96`과 동일 값·주석 갱신 |
| F | 랜딩 금지어 ‘쌤버쉽’ + 별표 리터럴 노출 | 🟡 중간 | `PublicGuestLanding.tsx` — `*쌤버쉽 …*` → `쌤버십 …`(금지어·마커 제거) | grep으로 금지어 0건 확인 |
| G | 폐기 표기 ‘베이직’ 잔존 | 🟡 중간 | 사용자 노출 3파일(`legal/terms`,`support`,`MentorsListBody`) + 사이드바 주석 → ‘라이트’ | grep으로 사용자 노출 ‘베이직’ 0건 확인 |
| H | 가입 페이지 개발자 메모 노출 | 🟡 중간 | `app/signup/page.tsx` — `NEXT_PUBLIC_*` 환경변수 언급 문장 제거 | 렌더 카피에서 개발자 용어 제거 확인 |

## ② 후속 과제 (협의·회귀검증 필요, 이번 PR 제외)

| ID | 발견 | 심각도 | 보류 사유 / 권고 방향 |
|---|---|---|---|
| — | 재구독 불가(subscriptions 평생 1행 유니크 vs insert 전용) | 🟠 높음 | 금전 체크아웃 경로 변경 → 만료/해지 행 재활성 로직은 결제 상태머신 전반 회귀검증 필요. 유니크 완화 vs upsert 전환 중 택1을 웹 팀과 결정 |
| — | users/reviews UPDATE 정책 컬럼 무제한 | 🟠 높음 | 권한 모델 변경(컬럼 GRANT/REVOKE 또는 트리거). status/role/rating/moderation 컬럼을 사용자 UPDATE에서 제외하는 마이그레이션은 정상 쓰기 경로(예: `syncAfterSignUpSession`의 status upsert)와 충돌 여부를 전수 확인해야 함 |
| — | 숏폼 업로드 25MB 벽 | 🟠 높음 | `serverActions.bodySizeLimit`은 전역이라 500MB로 올리면 서버 메모리 부담. 정석은 숏폼을 서명 URL 직접 업로드로 전환. 아키텍처 결정 필요 |
| — | 091 release 래퍼가 즉시지급 primitive 직결 | 🟠 높음 | 후불 정산 시리즈(108~114)가 DRAFT라 라이브 미적용. 시리즈 확정과 함께 091 래퍼 재지정·grant 회수를 한 묶음으로 처리 |
| — | 정지·차단 상태 게이트/JSON API 누락, past_due 접근 정합성, 연결노트 roomId 신뢰 등 | 🟡 중간 | 도메인 워크플로 다수 파일에 걸친 게이트 정비 — 별도 작업으로 묶어 회귀 테스트와 함께 진행 |
| — | 앱: 정지 자동해제·스크랩 CHECK·과목 FK·세션 평문저장 등 | 🟡 중간 | 앱-웹 계약·보안 항목. Flutter 툴체인 확보 후 `flutter analyze`/테스트와 함께 수정 검증 권장 |

## 검증 방법

- 웹 코드: `tsc --noEmit`(strict) 에러 0 유지, ESLint 신규 에러 0.
- SQL 마이그레이션: 문법·멱등성(`create or replace`, `if not exists`) 확인. 실제 프로덕션 적용은 운영자가 `INDEX.md` 순서에 따라 SQL Editor에서 실행(이 저장소는 CLI 이력 없이 수동 적용).
- 앱 코드: 웹 스키마와의 계약 정합(‘pending’) 확인. (이 환경엔 Flutter 툴체인 없음 — 정적 정합성 검토만.)
