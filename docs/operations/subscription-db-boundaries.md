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
4. 웹 코드에는 DB가 소유할 event 생성/상태 보정/금액 결정을 다시 넣지 않는다. 기존 v2/앱은 같은 구현을 사용하므로 웹 롤아웃 중에도 최초 이벤트가 원자적으로 기록된다.

## 운영 확인

`scripts/verify/subscription_invariants.sql`은 read-only다. 결과 5개가 모두 0이어야 한다. 이벤트 모수를 함께 확인한다. 실제 갱신 0건인 staging에서 위반 0만으로 동시성/실패 원자성을 검증했다고 보지 않는다.

- 새 가격 조회/plan binding 실패: `price_unavailable`, 차감·성공 이벤트 없음.
- 사전고지 이후 플랜 가격 변경: `price_changed_since_notice`, 자동 차감 중단. 임의로 notice marker를 삭제하거나 금액을 고치지 않는다. 운영자가 가격/고지 이력을 확인한 후 재고지·적용 시점을 결정해야 한다.
- `is_active=false`는 신규 가입만 제한하며 기존 구독 갱신은 허용한다.
- terminal invariant는 현재 기간과 같은 이벤트를 비교한다. 과거 terminal 이벤트가 보존된 정상 재구독을 오류로 세지 않는다.
- 앱 재빌드가 없으므로 신규 오류 코드별 한국어 앱 문구 추가와 앱 artifact quota CI 변경은 포함하지 않는다.

## 검증과 되돌리기

로컬 PostgreSQL 17 호환 엔진에서 전체 125본 pack, 실제 실패 trigger와 계약 fixture, rollback 후 재적용을 검증한다. 로컬 엔진은 기존 플랫폼 stub을 쓰고 pgcrypto 설치 선언만 제외하므로 최종 PG17/Supabase 검증은 GitHub의 기존 CLI runner가 담당한다.

- `scripts/verify/fixtures/subscription_boundaries.sql`: 테스트 데이터와 강제 실패 트리거는 모두 ROLLBACK. 원장/지갑/결제/방/구독, 재생/재구독, 웹/앱 오류 코드, anon directory 필터를 실제 실행한다.
- `scripts/verify/subscription_concurrency.py`: 폐기 가능한 로컬 Supabase만 사용. A의 미커밋 갱신에 B가 실제 advisory lock 대기함을 관측하고, 이후 성공 재생과 차감 정확히 1회를 확인한다.
- rollback은 웹 호출부를 먼저 되돌린 뒤 hardening → financial 순서로 실행한다. 성공 결제·원장·이벤트 데이터는 지우지 않는다. hardening rollback은 의도적으로 종전 ACL/뷰 보안 설정까지 복원하므로 긴급 복구에만 사용한다.
