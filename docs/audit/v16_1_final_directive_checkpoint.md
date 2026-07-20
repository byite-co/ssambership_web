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

## Section 1 — P1-11 알림 17종 원자화 (진행: 7/17 완료)
- **원자 완료 7종**: question_answered(142) + 개별질문 6종(155 트리거). domain write 와 동일 트랜잭션 원자·멱등.
  웹 best-effort 알림·미사용 심볼 제거. staging fixture 6종 검증.
- **남은 10종**: 구독 4·맞춤의뢰 2·멘토 4. `docs/audit/notification_event_coverage.md` 에 트리거 기반 후속 계획 명시
  (subscription_billing_events / order 메시지·mentor_applications INSERT / refunds INSERT / mentor_plans UPDATE fan-out).
  재무 RPC 본문 재작성 없이 트리거만 추가하는 안전 경로. 이번 세션은 IQ 6종만 원자화(재무 알림 mis-wiring 방지).

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

## Section 5 — 저장소 전체 lint 부채
- **현황**: `npx eslint .` = 38 error·66 warning. **전부 기존 파일**(신규 규칙 `react-hooks/set-state-in-effect` 등,
  브랜치 HEAD 이전부터 존재). **이번 세션 변경 파일은 전부 lint-clean**(경고 포함 0).
- **안전 수정**: e2e prefer-const(2건) 적용. 위험한 --fix(빈 줄·disable 제거) 되돌림.
- **미완(정직 보고)**: 나머지는 ~18개 인터랙티브 UI 컴포넌트의 set-state-in-effect(페이지네이션 리셋·matchMedia 초기화·
  prop 동기화)·no-explicit-any(query 콜백)·no-html-link 다. **브라우저 검증 없이 "기능 변화 없이" 대량 리팩터는 회귀 위험**이라
  세션 내 전량 0 화는 보류. 안전 변환 패턴(React 렌더 중 파생 리셋: `const key=…; const [prev,setPrev]=useState(key);
  if(prev!==key){setPrev(key);setPage(1)}`)을 각 파일에 적용하는 브라우저 검증 동반 후속으로 분리. = LINT_DEBT(pre-existing).
- `next build`는 eslint 게이트가 아니라 Vercel Ready 유지(빌드 영향 없음).

## Section 6 — 검증 환경 준비 ✅ (스크립트·구조)
- `scripts/verify/sql_number_integrity.mjs`(오프라인): 146+ 신규 번호 중복 0 확인, 레거시 중복(002/032/033/034/039) 보고.
- `scripts/verify/two_session_concurrency.sh`: psql 2세션 harness 골격. DATABASE_URL 없으면 `READY_NOT_EXECUTED`.
  6 시나리오(p0-5·p1-8·p1-13·p1-10·p1-11·p2-25) pg_backend_pid 상이 검증 포함.
- clean-DB: Supabase CLI·로컬 PG 부재 = `BLOCKED_ENV`(오프라인 번호검사만). 인증 Preview E2E = `READY_NOT_EXECUTED`(e2e/ 준비됨).

## Section 7 — Production 준비 문서 ✅
- `docs/audit/production_apply_runbook.md`: 146~156 적용 순서·pre/post·롤백 구분·진단 쿼리(mentor_plans null·refund billing NULL·
  payout dup·storage orphan·outbox dead·deletion stuck)·staging 진단 스냅샷(전부 0)·레거시 번호 충돌 명시.
