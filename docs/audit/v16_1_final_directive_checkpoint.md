# v16(1) 최종 연속 실행 — Section 0~7 체크포인트

> 기준: PR #42 정본 · base HEAD `618e9cd` · staging `lbeqxarxothkmzqvpudy` · PR draft 유지 ·
> production/앱 무접근 · 실사용자 금융/Storage 무변경(모든 검증 rollback-only) · 신규 PR 금지.
> SQL 정본 번호 154~.

## Section 0 — 브랜치 정리 ✅
- PR #44(preview E2E 결함 스택)는 이미 **closed(merge 아님)**. P0-3·P0-4·P2-24 기능은 PR #42 에
  독립 재구현으로 수렴(147/148 + 프로필 payload 분리 + 165dd62 배지). "PR #42 수렴 완료" 코멘트 게시.
- 게시판 중복 테스트 글 4건 자동 삭제 안 함(오너 판단). 이후 변경 전부 PR #42.

## Section 2 — P1-10 운영 어댑터 완결 ✅ (기능 OFF)
- **154 Storage gate 전면화**: RESTRICTIVE 정책(INSERT·UPDATE) 추가 → locked 유저의 모든 버킷
  INSERT/UPDATE/upsert/overwrite/move/copy 를 한 번에 차단(개별 버킷 정책 재작성 없이). service_role 무영향.
- **154 lease/claim**: `account_deletion_jobs.lease_owner/leased_until` + `account_deletion_claim`(미lease/만료만
  원자 lease, SKIP LOCKED — 동시 worker 중복 처리 0) + `account_deletion_reclaim_expired`.
- **154 write gate 보정**: forfeit(정당한 삭제 write)는 트랜잭션 GUC `ssambership.deletion_worker='on'`일 때만 우회.
  그 외 locked 유저 지갑/원장 write 는 계속 차단.
- **154 forfeit 원자 RPC**: `account_deletion_forfeit_and_anonymize` — storage_purged 에서만, 잔액 0원 몰수 라인
  (append-only 멱등) + 익명화(115) 단일 트랜잭션.
- **worker**: `accountDeletionWorker` 에 `SessionRevokeAdapter`(dry-run 기본) 추가 — locked 직후 세션 revoke,
  성공 전 다음 단계 금지, 실패 시 재시도. purge 계획 snapshot 은 결과로 반환.
- **검증**: staging 154 적용 + rollback fixture 6항목(gate 정상차단·forfeit GUC 우회·lease 중복0·reclaim·
  state gate·잔액 0 몰수) 전부 통과, 실데이터 무변경. tsc 0.
- **부채**: 실 GoTrue admin transport·앱 세션 폐기 미들웨어 = WAITING_EXTERNAL_APP(플래그 OFF 컷오버).

## Section 1 — P1-11 알림 17종 원자화 ✅ (17/17 — staging 적용만 PENDING)
- **원자 완료 7종(전 세션)**: question_answered(142) + 개별질문 6종(155 트리거). staging fixture 6종 검증.
- **원자 완료 10종(본 세션, 157/158/159)**: 구독 4(157 — billing event INSERT/전이·subscriptions→expired 트리거) ·
  멘토 4(158 — mentor_profiles 전이 fan-out·refunds INSERT·mentor_plans 가격 fan-out, 동일 tx 다중 tier 는 txid dedup) ·
  맞춤의뢰 2(159 — applications/order_messages INSERT). 상세 표: `docs/audit/notification_event_coverage.md`.
- 웹 best-effort 전면 제거: `notificationInsert.ts`(insertNotificationBestEffort/fetchUserDisplayName) 삭제 +
  호출부 5파일 정리(이중 발송 0). 멘토 종료 환불 본문의 금액 100배 표기 오류(cents 를 캐시로 출력)를 트리거에서 교정.
- **검증**: 로컬 스크래치 PG16 에 정본 132+157+158+159 적용 + rollback-only fixture **24 assertion 전부 PASS**
  (`scripts/verify/local_notification_trigger_check.sh` — 원자 롤백·멱등·fan-out 범위·무발화 조건·캐시/이름 표기).
- **부채**: staging 적용 = `READY_NOT_EXECUTED`(이 세션 staging secret 부재). 적용 순서 **SQL 먼저, 웹 나중**
  (`docs/audit/production_apply_runbook.md` §1 경고). staging 적용 후
  `scripts/verify/fixtures/notification_atomization_157_159_fixture.sql` 재실행. 가격 변경 "다른 tx 재알림"은 2트랜잭션 실측 항목.

## Section 4 — P2-25 지급 scheduler 기반 ✅ (기본 OFF)
- **156**: `payout_settings`(scheduler_enabled 기본 false·싱글턴) + `payout_reconciliation_report`(READ-ONLY 대상/제외/오류)
  + `run_scheduled_payout`(enabled 아니면 무조건 dry-run·실지급 금지, enabled 라야 실지급, 153 멱등으로 배치 중복 봉쇄).
- cron 미설정(staging 기본 disabled). 실지급은 명시 enable + dry_run=false 만.
- **검증**: staging 156 적용 + `run_scheduled_payout(today)` = scheduler_enabled=false·dry_run=true·payout_run_items 0(무변경).

## Section 3 — P1-11 worker·P2-17 통합 검증 ✅ (152 fixture 로 검증됨)
- 152 rollback fixture 가 이미 검증: 복수 worker claim 중복 0(claim_w1=1/w2=0)·lease 만료 회수·invalid token revoke·
  dead-letter(max)·설정 OFF 수신자 delivery 0(suppressed)·토큰별 delivery UNIQUE·계정 전환 재소유(register_device_token).
- worker 오케스트레이터(outboxWorker.runOutboxBatch, dryRunTransport)·순수 backoff(outboxBackoff) 계약테스트 56/62 포함.
- P2-17: 설정 저장 실패 시 성공 UI 금지(NotificationSettingsPanel ok 분기). 실기기 FCM·앱 딥링크·권한 = WAITING_EXTERNAL_APP.
- 부채: 오케스트레이터 mock-transport 단위 테스트는 `@/` alias node:test 제약으로 미실행(tsc·152 fixture·backoff 테스트로 대체 검증).

## Section 5 — 저장소 전체 lint ✅ (0 error · 0 warning — LINT_DEBT 해소)
- **최종(2026-07-20 후속 세션)**: `npx eslint .` = **0 error · 0 warning** (기존 38 error·66 warning 전량 해소).
- error 38: no-explicit-any 14(구조 타입·불필요 캐스트 제거) · set-state-in-effect 20(위 안전 변환 패턴 =
  렌더 중 파생 리셋 + matchMedia 는 신규 `lib/hooks/useMediaQuery`(useSyncExternalStore·SSR 스냅샷 데스크탑) +
  fetch-on-mount 는 순수 fetch/apply 분리 후 IIFE 에서 await 이후 반영·cancelled 가드) ·
  static-components 2(ConnectionNotesPanel 중첩 컴포넌트 모듈 호이스트 — 편집 textarea remount 결함도 함께 제거) ·
  purity 1 · no-html-link 1(<Link> 전환).
- warning 62: FormSubmitButton 구경로 심 import 19 전 지점 재지정 · `_` 접두 미사용 컨벤션 채택(표준 ignorePattern,
  완화 아님) + 실제 미사용 심볼 제거 · exhaustive-deps 4(구조분해/useMemo) · no-img 2(서명 URL·아바타 —
  기존 관례대로 사유 주석 + 지점별 disable) · 기존 set-state-in-effect disable 3개도 파생 리셋으로 전환·제거.
- 검증: tsc 0 · next build green(84/84 정적 생성) · 계약테스트 62/62. 브라우저 실측은 인증 Preview E2E 부채에 합류
  (변환 패턴은 React 공식 권장 형태라 회귀 리스크 낮음 — 그래도 Preview 확인 목록에 페이지네이션 리셋·모바일 pageSize 포함 권장).

## Section 6 — 검증 환경 준비 ✅ (스크립트·구조)
- ⚠️ **정정(2026-07-20 후속 세션)**: 이 섹션의 스크립트 2종은 기록과 달리 **이전 커밋(7a84ac4)에 포함되지 않았다**
  (커밋 메시지·본 문서만 기록, 파일 누락). 후속 세션에서 기술대로 재작성해 실제 커밋했다.
- `scripts/verify/sql_number_integrity.mjs`(오프라인): 146+ 신규 번호 중복 0 확인(실행 결과: 다음 빈 번호 160,
  레거시 중복 002/032/033/034/039 보고, 146+ 중복 0), 위반 시 exit 1.
- `scripts/verify/two_session_concurrency.sh`: psql 2세션 harness 골격. DATABASE_URL 없으면 `READY_NOT_EXECUTED`(exit 0),
  staging ref 가드·pg_backend_pid 상이 검증, 6 시나리오(p0-5·p1-8·p1-13·p1-10·p1-11·p2-25)는 fixtures/ 에 시나리오별
  SQL 을 추가하는 구조(미작성 시 SKIP 정직 보고).
- **신규**: `scripts/verify/local_notification_trigger_check.sh` + `fixtures/local_stub_schema.sql` +
  `fixtures/notification_atomization_157_159_fixture.sql` — 로컬 PG16 스크래치 클러스터에서 정본 132+157~159 실구동,
  rollback-only 24 assertion PASS. root 환경이면 postgres 사용자로 자동 강등, 종료 시 클러스터 삭제.
- clean-DB 전체 체인: Supabase CLI 부재 = `BLOCKED_ENV` 유지(알림 스택만 로컬 실구동으로 부분 해소).
  인증 Preview E2E = `READY_NOT_EXECUTED`(e2e/ 준비됨).

## Section 7 — Production 준비 문서 ✅
- `docs/audit/production_apply_runbook.md`: 146~159 적용 순서·pre/post·롤백 구분·진단 쿼리(mentor_plans null·refund billing NULL·
  payout dup·storage orphan·outbox dead·deletion stuck)·staging 진단 스냅샷(전부 0)·레거시 번호 충돌 명시.
  157~159 는 staging 미적용 상태와 "SQL 먼저, 웹 나중" 배포 순서를 §1 에 경고로 명시.

## 세션 환경 제약 (2026-07-20 후속 세션)
- **원격 push 불가 = BLOCKED_ENV**: git relay·GitHub API(contents write) 모두 403(조직 정책 — 이 세션의 GitHub
  통합에 쓰기 권한 없음). 우회 금지 원칙에 따라 커밋은 로컬 브랜치(`claude/web-app-fixes-bug-rollback-cx52cq`)에
  보존하고 format-patch 번들을 오너에게 전달 — 오너/원계정 세션에서 `git am` 적용 후 push.
- **staging secret 부재**: 157~159 staging 적용·rollback fixture 실행 = READY_NOT_EXECUTED
  (로컬 스크래치 PG16 실구동 24 assertion PASS 로 사전 검증 완료).
