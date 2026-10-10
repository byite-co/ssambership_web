# 구독 DB 쓰기 경계 전환 (2026-10)

앱 저장소·결제 UI·바이너리는 수정하지 않는다. 기존 앱 RPC 이름/인자/성공 응답/캐시 재생 계약을 유지하고 웹과 DB만 변경한다. main 기준 84ce0e91 에서 분리한 브랜치다.

## 변경 범위

| 단계 | 처리 |
| --- | --- |
| S01–S03 | 갱신 가격 fallback·plan 조회 N+1 제거. v2 갱신 RPC가 구독/플랜 잠금, binding, 기간·해지·유예 상태, 금액, 차감·원장·이벤트를 결정한다. 구형 RPC는 입력 금액을 무시하고 v2로 위임한다. |
| S02 | 읽기 quote와 사전고지 쓰기 RPC 모두 구독에 연결된 plan_id를 사용한다. notice marker와 알림 트리거도 한 트랜잭션이다. |
| S04–S05 | v3와 기존 v2 모두 공통 checkout 구현 사용. 최초 billing event 실패는 결제 성공·차감·구독·방 변경을 롤백한다. 웹이 미리 만든 pending intent는 보존된다. 앱 내부 intent는 전체 롤백된다. 재구독 시 과거 결제 이벤트를 보존한다. |
| S06 | 해지 예약 만료/유예 만료를 잠금·이벤트·상태전이·알림을 포함하는 단일 RPC로 처리한다. |
| S07 | DB/RPC 제목 120자, topic 80자, 메시지 10,000자, catalog subject 검증. 웹은 한국어 문구, 설치된 앱은 기존 오류 표시 경로로 거부하며 동일 서버 코드를 받는다. |
| S08 | trigger 직접 EXECUTE 회수, 신규 함수 default ACL 제한, search_path 경고 5개 정리. 나머지 SECURITY DEFINER API/RLS/storage/legacy 권한 전수 정리는 별도 의존성 검토가 필요하다. |
| S09 | 17개 컬럼·기존 필터·anon 접근을 보존하는 invoker view + 비노출 스키마의 좁은 definer 읽기 함수. 기존 base table RLS와 권한을 넓히지 않는다. 기존 공개 리뷰 읽기 계약은 유지한다. |
| S10 | 갱신 due scan과 billing event payment/ledger FK 인덱스만 추가. 다른 RLS·인덱스 일괄 변경은 하지 않는다. |
| S11 | main push 웹 검사, TS 금융 쓰기 금지 gate, DB 실패 주입·앱 호환성·실제 2세션 갱신 검증. 웹 repo 검증 artifact 업로드는 비필수. 앱 CI 파일은 수정하지 않는다. |

## 순서와 호환성

1. 금융 migration → hardening migration → 웹 PR 배포 순서. 기존 RPC를 DROP하거나 인자를 변경하지 않는다.
2. 교체할 기존 함수와 뷰는 실측 원문 MD5 gate로 다른 작업의 변경을 탐지한다. 불일치면 migration 전체 중단; gate 값을 임의 갱신해서 덮어쓰지 않는다.
3. staging에 MCP로 적용하면 할당된 원장 version/statements를 같은 세션에서 canonical `post_ledger_backfills`로 역수입하고 pack/manifest를 재생성한다.
4. 웹 코드에는 DB가 소유할 event 생성/상태 보정/금액 결정을 다시 넣지 않는다. 기존 v2/앱은 같은 구현을 사용한다. 최초 이벤트는 결제별 키·unique index로 식별하고 금융 필드는 불변이다. 구형 웹의 중복 initial INSERT는 0행으로 종료되며 직접 billing pointer UPDATE는 기존 포인터를 보존한다. 도메인 definer RPC의 포인터 변경은 정상 동작한다.

## 운영 확인

`scripts/verify/subscription_invariants.sql`은 read-only다. 결과 5개가 모두 0이어야 한다. 이벤트 모수를 함께 확인한다. 실제 갱신 0건인 staging에서 위반 0만으로 동시성/실패 원자성을 검증했다고 보지 않는다.

- 새 가격 조회/plan binding 실패: `price_unavailable`, 차감·성공 이벤트 없음.
- 사전고지 이후 플랜 가격 변경: `price_changed_since_notice`, 자동 차감 중단. 임의로 notice marker를 삭제하거나 금액을 고치지 않는다. 실패 이벤트와 `past_due` 전환을 함께 기록하고 기존 2일 유예를 적용한다. 재시도는 유예를 연장하지 않는다. 유예 내 binding/기존 고지 가격이 복구되면 재시도할 수 있고, 해결되지 않으면 terminal RPC로 만료된다. 변경된 가격의 신규 이용은 웹에서 새로 동의·구독한다.
- `is_active=false`는 신규 가입만 제한하며 기존 구독 갱신은 허용한다.
- terminal invariant는 현재 기간과 같은 이벤트를 비교한다. 과거 terminal 이벤트가 보존된 정상 재구독을 오류로 세지 않는다.
- 앱 재빌드가 없으므로 신규 오류 코드별 한국어 앱 문구 추가와 앱 artifact quota CI 변경은 포함하지 않는다.

## 검증과 되돌리기

로컬 PostgreSQL 17 호환 엔진에서 전체 127본 pack, 실제 실패 trigger와 계약 fixture, rollback 후 재적용을 검증한다. 로컬 엔진은 기존 플랫폼 stub을 쓰고 pgcrypto 설치 선언만 제외하므로 최종 PG17/Supabase 검증은 GitHub의 기존 CLI runner가 담당한다.

- `scripts/verify/fixtures/subscription_boundaries.sql`: 테스트 데이터와 강제 실패 트리거는 모두 ROLLBACK. 원장/지갑/결제/방/구독, 재생/재구독, 웹/앱 오류 코드, anon directory 필터를 실제 실행한다.
- `scripts/verify/subscription_concurrency.py`: 폐기 가능한 로컬 Supabase만 사용. A의 미커밋 갱신에 B가 실제 advisory lock 대기함을 관측하고, 이후 성공 재생과 차감 정확히 1회를 확인한다.
- rollback은 웹 호출부를 먼저 되돌린 뒤 hardening → financial 순서로 실행한다. 성공 결제·원장·이벤트 데이터는 지우지 않는다. hardening rollback은 의도적으로 종전 ACL/뷰 보안 설정까지 복원하므로 긴급 복구에만 사용한다.

## staging 반영 결과 (2026-10-08 UTC)

- `20261008003644_subscription_financial_boundaries`: 적용 완료, 원장 원문 MD5 `4c8dc202f0177ef2e6fc3407139dddf0`와 canonical 파일 일치.
- `20261008003700_subscription_compatible_hardening`: 적용 완료, 원장 원문 MD5 `a5550a7b7fa14ea94b1cd931eb79ab70`와 canonical 파일 일치.
- 정합성 5개 모두 위반 0. 실제 데이터 모수는 initial succeeded 1건, renewal/terminal 0건이다. 실패·동시성은 CI의 합성 데이터로 별도 검증했다.
- 공개 디렉터리 17컬럼/75행, invoker view, anon SELECT 및 projection EXECUTE 유지. 신규 금융 RPC는 anon/authenticated EXECUTE 0, trigger 직접 EXECUTE도 0. 실제 anon 역할에서 목록 75행, users/mentor_profiles/인증 원본 행은 모두 0건을 확인했다.
- Security Advisor의 definer view ERROR와 mutable search_path 5개 경고는 사라졌다. 나머지 definer 함수 호출 경고(anon 37, authenticated 119)와 service-only RLS 무정책 INFO 17은 별도 분류 대상이다.
- [PG17 전체 pack·실패·2세션 갱신 CI](https://github.com/byite-co/ssambership_web/actions/runs/37708299266), [웹 lint·tsc·1,244 계약 테스트](https://github.com/byite-co/ssambership_web/actions/runs/37708299298): 모두 성공.
- PR #138에서 웹 호출부와 정확한 staging 원장 version을 함께 관리한다. 웹 main 병합/서비스 배포는 아직 수행하지 않았다.

## 적대적 검토 후속 수정

- 가격 차단은 `renewal_failed/failed` 이벤트와 `past_due` 전환을 원자 처리한다. 차감은 0이며 캐시 부족용 알림은 발행하지 않는다. 최초 유예 만료 뒤 정상 terminal 전이를 거친다.
- `claim_subscription_renewal_batch`는 가장 오래 전에 선택한 due 구독을 우선하고 `FOR UPDATE SKIP LOCKED`로 선택 시간을 커밋한다. 후속 RPC 오류나 작업 중단이 있어도 같은 50건이 계속 앞을 점유하지 않는다. 각 금융 RPC의 잠금·멱등·상태 재검증은 그대로 적용된다.
- 최초 이벤트 키는 `sub_initial:<subscription_id>:<payment_id>`다. 기존 이벤트는 키만 변경하며 중복 payment 이력이 있으면 migration을 중단한다. 과거 이벤트를 삭제하거나 합치지 않는다.
- 결제 후 지연된 구형 웹의 event upsert 및 별도 포인터 UPDATE를 실제 `service_role`로 검증한다. 최초 이벤트 복구 기간은 원본 debit의 `created_at`과 당시 checkout의 KST 1개월 규칙을 사용하며 현재 구독 기간을 참조하지 않는다.
- `subscription_review_regressions.sql`: 두 pending intent → A 확정 → B 확정 → 지연된 A 후속 쓰기, 갱신 후 최초 이벤트 복구, 정상 가격 변경 API, 미결제 질문 차단, 유예 불연장·만료, 상태 실패 시 이벤트 rollback.
- `subscription_batch_fairness.mjs`: 실제 TS 배치와 DB를 연결한다. 막힌 50건 뒤 정상 1건이 다음 배치에서 갱신되고, 미해결 50건은 유예 후 만료됨을 검증한다.
- 후속 rollback은 웹의 claim 호출을 먼저 되돌린 뒤 적용한다. 기존 금융 데이터와 결제별 키는 보존하며, 최초 금융/hardening migration의 rollback보다 먼저 실행한다.

- staging 후속 적용: `20261008020145_subscription_review_fixes`, 원장 MD5 `ae057f98ec9e80496b4bbbf547e0dcee`. 로컬 기존 1,244 계약 테스트·lint·typecheck, 전체 pack·회귀 SQL, 실제 TS 51건 배치, rollback 후 재적용을 통과했다.

- PG17의 실제 TS 배치 검사에서 DB 마이크로초 → JS 밀리초 정규화로 정상 갱신까지 거부되는 문제가 추가로 검출됐다. 웹은 DB 시각을 원형으로 보내며 키의 날짜만 UTC로 변환한다. DB는 구형 웹의 동일 밀리초 값을 잠근 원본 시각으로 결속하고 저장 기간을 반올림하지 않는다. 다른 밀리초는 기존대로 거부한다.
- 정밀도 후속 staging 적용: `20261008021536_subscription_timestamp_compatibility`, 원장 MD5 `ee56fca10119d1e3661d8c6dbdfc943b`. fixture에 321µs를 명시하여 호환 엔진에서도 재현되도록 했고, 구형 RPC·성공 재생·원본 기간 보존·다른 기간 거부를 검증한다. rollback은 정밀도 → review_fixes → 기존 financial/hardening의 역순을 따른다(웹 호출부를 먼저 되돌린다).
