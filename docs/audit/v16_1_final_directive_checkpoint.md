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
