# 결함 110건 수정 매니페스트 (2026-08-07)

done 103 · partial 1 · skipped 4 · ops 1 · deferred 1 · pending 0 = **110** (중복·누락 0)

> 개정 2026-08-07(적대적 리뷰 반영): D-CM-4 skipped→done(v2 전환) · D-IQ-6 done→partial · D-CR-6 done→skipped · D-DB-1 ops→done(원격 적용 완료).

| ID | 심각도 | 웨이브 | 배치 | 상태 | 위치 |
|----|----|----|----|----|----|
| D-AD-1 | bug | Wave 1 | L4 | done | L·admin |
| D-AD-2 | bug | Wave 1 | L4 | done | L·admin |
| D-AD-3 | risk | Wave 1 | L4 | done | L·admin |
| D-AD-4 | risk | Wave 1 | L4 | done | L·admin |
| D-AD-5 | smell | Wave 1 | L4 | done | L·admin |
| D-AD-6 | bug | Wave 1 | L4 | done | L·admin |
| D-AD-7 | risk | Wave 1 | L4 | done | L·admin |
| D-AD-8 | smell | Wave 1 | L4 | done | L·admin |
| D-AD-9 | smell | Wave 1 | L4 | done | L·admin |
| D-AD-10 | smell | Wave 1 | L4 | done | L·admin |
| D-AD-11 | smell | Wave 1 | L4 | done | L·admin |
| D-AD-12 | risk | Wave 1 | L4 | done | L·admin |
| D-AD-13 | smell | Wave 1 | L4 | done | L·admin |
| D-AU-1 | bug | Wave 1 | L7 | done | L·auth |
| D-AU-2 | risk | Wave 1 | L7 | done | L·auth |
| D-AU-3 | risk | Wave 0 | W0-A | done | wave0 (PR#69) |
| D-AU-4 | risk | Wave 1 | L7 | done | L·auth |
| D-AU-5 | smell | Wave 1 | L7 | done | L·auth |
| D-AU-6 | smell | Wave 1 | L7 | done | L·auth |
| D-AU-7 | smell | Wave 1 | L7 | done | L·auth |
| D-AU-8 | smell | Wave 1 | L7 | done | L·auth |
| D-AU-9 | risk | Wave 1 | L7 | done | L·auth |
| D-AU-10 | risk | Wave 1 | L7 | done | L·auth |
| D-AU-11 | smell | Wave 1 | L7 | done | L·auth |
| D-AU-12 | smell | Wave 1 | L7 | done | L·auth |
| D-CM-1 | bug | Wave 1 | L1 | done | L·community |
| D-CM-2 | smell | Wave 1 | L1 | done | L·community |
| D-CM-3 | risk | Wave 0 | W0-D | done | L·community |
| D-CM-4 | risk | Wave 0 | W0-D | done | wave1-fixup — 웹 게시판 조회수 v2 RPC 전환(skip 사유였던 'v2 부재'는 오판) |
| D-CM-5 | risk | Wave 1 | L1 | done | L·community |
| D-CM-6 | bug | Wave 1 | L1 | done | L·community |
| D-CM-7 | bug | Wave 1 | L1 | done | L·community |
| D-CM-8 | smell | Wave 1 | L1 | done | L·community |
| D-CM-9 | risk | Wave 1 | L1 | done | L·community |
| D-CM-10 | smell | Wave 1 | L1 | done | L·community |
| D-CM-11 | risk | Wave 1 | L1 | done | L·community |
| D-CM-12 | smell | Wave 1 | L1 | done | L·community |
| D-CM-13 | smell | Wave 1 | L1 | done | L·community |
| D-CM-14 | risk | Wave 1 | L1 | done | L·community |
| D-CM-15 | smell | Wave 1 | L1 | done | L·community |
| D-CM-16 | smell | Wave 1 | L1 | done | L·community |
| D-CM-17 | smell | Wave 1 | L6 | done | L·student |
| D-CR-1 | risk | Wave 1 | L8 | done | L·customrequest |
| D-CR-2 | smell | Wave 1 | L8 | done | L·customrequest |
| D-CR-3 | risk | Wave 1 | L8 | done | L·customrequest |
| D-CR-4 | smell | Wave 1 | L8 | done | L·customrequest |
| D-CR-5 | smell | Wave 1 | L8 | done | L·customrequest |
| D-CR-6 | smell | Wave 1 | L8 | skipped | wave1-review — React cache()는 요청 간 무효(적중 0). 요청 간 캐시 도입은 후속 |
| D-CR-7 | bug | Wave 1 | L8 | done | L·customrequest |
| D-CR-8 | smell | Wave 1 | L8 | done | L·customrequest |
| D-CR-9 | smell | Wave 1 | L8 | done | L·customrequest |
| D-DB-1 | bug | Wave 2 | OPS-1 | done | OPS 실행 완료 — db-apply-pending run 31175134612, pending 9본 적용·사후검증·스모크 5종 통과 (2026-08-07) |
| D-DB-2 | risk | Wave 0 | W0-B | done | wave0 (PR#69) |
| D-DB-3 | risk | Wave 2 | OPS-2 | ops |  |
| D-DB-4 | risk | Wave 0 | W0-C | done | wave0 (PR#69) |
| D-DB-5 | smell | Wave 2 | OPS-3 | deferred | 오너 결정(2026-08-07): 이번 라운드 미도입 — C14(푸시)와 함께 후속 라운드 검토 |
| D-IQ-1 | bug | Wave 1 | L3 | done | L·iq |
| D-IQ-2 | risk | Wave 1 | L3 | done | L·iq |
| D-IQ-3 | risk | Wave 1 | L3 | done | L·iq |
| D-IQ-4 | risk | Wave 1 | L3 | done | L·iq |
| D-IQ-5 | smell | Wave 1 | L3 | done | L·iq |
| D-IQ-6 | smell | Wave 1 | L3 | partial | L·iq — 멘토측 RPC 배선만. RPC 인가 스코프가 개별질문 당사자 관계 미포함 + 학생측 멘토 표시명 미배선 → 스코프 확장 마이그레이션(직렬 레인, 오너 큐) |
| D-IQ-7 | smell | Wave 1 | L3 | done | L·iq |
| D-IQ-8 | smell | Wave 1 | L3 | done | L·iq |
| D-MT-1 | bug | Wave 1 | L5 | done | L·mentor |
| D-MT-2 | smell | Wave 1 | L5 | done | L·mentor |
| D-MT-3 | bug | Wave 1 | L5 | done | L·mentor |
| D-MT-4 | smell | Wave 1 | L5 | done | L·mentor |
| D-MT-5 | bug | Wave 0 | W0-C | done | wave0 (PR#69) |
| D-MT-6 | smell | Wave 1 | L5 | done | L·mentor |
| D-MT-7 | risk | Wave 1 | L5 | done | L·mentor |
| D-MT-8 | bug | Wave 1 | L5 | done | L·mentor |
| D-MT-9 | risk | Wave 1 | L5 | done | L·mentor |
| D-MT-10 | smell | Wave 1 | L5 | done | L·mentor |
| D-MT-11 | smell | Wave 1 | L5 | done | L·mentor |
| D-MT-12 | risk | Wave 1 | L5 | done | L·mentor |
| D-MT-13 | smell | Wave 1 | L5 | done | L·mentor |
| D-MT-14 | risk | Wave 1 | L5 | done | L·mentor |
| D-QR-1 | risk | Wave 1 | L2 | done | L·qna |
| D-QR-2 | risk | Wave 1 | L2 | done | L·qna |
| D-QR-3 | smell | Wave 1 | L2 | done | L·qna |
| D-QR-4 | smell | Wave 1 | L2 | done | L·qna |
| D-QR-5 | smell | Wave 1 | L2 | done | L·qna |
| D-QR-6 | smell | Wave 1 | L2 | skipped | wave1-qna |
| D-QR-7 | smell | Wave 0 | W0-E | done | L·qna |
| D-QR-8 | smell | Wave 1 | L2 | done | L·qna |
| D-QR-9 | bug | Wave 1 | L2 | done | L·qna |
| D-QR-10 | risk | Wave 1 | L2 | done | L·qna |
| D-QR-11 | bug | Wave 1 | L2 | done | L·qna |
| D-QR-12 | smell | Wave 1 | L2 | skipped | wave1-qna |
| D-QR-13 | smell | Wave 1 | L2 | skipped | wave1-qna |
| D-QR-14 | smell | Wave 1 | L2 | done | L·qna |
| D-ST-1 | smell | Wave 1 | L6 | done | L·student |
| D-ST-2 | bug | Wave 1 | L6 | done | L·student |
| D-ST-3 | smell | Wave 1 | L6 | done | L·student |
| D-ST-4 | smell | Wave 1 | L6 | done | L·student |
| D-ST-5 | bug | Wave 1 | L6 | done | L·student |
| D-ST-6 | smell | Wave 1 | L6 | done | L·student |
| D-ST-7 | risk | Wave 1 | L6 | done | L·student |
| D-ST-8 | bug | Wave 1 | L6 | done | L·student |
| D-ST-9 | smell | Wave 1 | L6 | done | L·student |
| D-ST-10 | risk | Wave 0 | W0-B | done | wave0 (PR#69) |
| D-ST-11 | risk | Wave 1 | L6 | done | L·student |
| D-ST-12 | smell | Wave 1 | L6 | done | L·student |
| D-ST-13 | bug | Wave 1 | L6 | done | L·student |
| D-ST-14 | risk | Wave 1 | L6 | done | L·student |
| D-ST-15 | smell | Wave 1 | L6 | done | L·student |
| D-ST-16 | smell | Wave 1 | L6 | done | L·student |
| D-ST-17 | smell | Wave 1 | L6 | done | L·student |
| D-ST-18 | smell | Wave 1 | L6 | done | L·student |
## 오너 결정 로그 (2026-08-07)

원격 실측 근거: `users.status` = NOT NULL · default `'active'` · CHECK {active, suspended, banned, deleted} · 현재 데이터 전원 active.

1. **W0-A 미지 status 델타 — 거부 채택 + CHECK 4종 정합.** allowlist는 '미지값 방어'가 아니라 DB CHECK 4종에 정확히 맞춘다: `active`만 통과(만료된 `suspended` 포함), `suspended`/`banned`/`deleted`는 명시 거부. NULL→active 정규화와 CHECK 밖 값 거부는 제약상 도달 불가 방어선으로 유지(무해). `dormant`는 이 DB에 없는 상태값이므로 문서·테스트 예시로 쓰지 않는다. → wave0 `138e946` 반영.
2. **W0-B verification_status 실노출 — 하지 않음(현행 유지 확정).** 상수 유지 + 뷰 불변식 계약 + 회귀 테스트가 정답. 부재 기반 차단(승인 멘토만 행 존재)으로 이미 완결. 향후 '검증 진행 중' 배지류 기능이 생기면 마이그레이션+개인정보 검토가 붙는 직렬 레인으로 재상정.
3. **D-DB-1 순서 — 즉시, #69/#70 병합 전 적용.** 절차: ① 승인 경로(workflow_dispatch·Environment 승인·dry-run 선행 — PR #71 `db-apply-pending.yml`) ② '적용 시점 미적용 전량' 기준(9본 고정 아님) ③ 적용 후 원격 스모크 5종(정산 성공·삭제글 미노출·중복신고 멱등·학생메시지 알림·차단목록 RPC) ④ 그 다음 #69→#70 직렬 병합(매 병합 게이트). D-DB-3(유출 비밀번호 보호 토글)은 같은 창에 대시보드에서 실행.
4. **부속 — D-DB-5 Realtime: 이번 라운드 미도입(보류).** 현행 새로고침/revalidate 기반은 결함이 아니라 설계. 도입은 화면별 UX 재설계가 붙는 기획 안건으로, C14(푸시)와 같은 묶음으로 후속 라운드에서 판단.

## 적대적 리뷰 라운드 (2026-08-07)

done 103건 전수를 9배치 병렬 적대적 리뷰 + 발견별 반박 검증(30 에이전트)으로 점검했다. 발견 21건 중 **확정 18건(이슈 14개) · 반박 기각 3건**.

- **수정 반영(이 커밋)**: D-CM-3(익명 조회수 붕괴 → 헤더 해시 익명키), D-CM-4(게시판 조회수 v2 전환), D-QR-8(redirect 쿼리 보존), D-QR-9(멘토 상세 무료체험 정렬·배지 실배선), D-QR-11(만료차단 fail-open 제거 — 쌍 기반 구독 이력 판정), D-AD-6(제재 순서 역전 교정 + 오류 원문 URL 제거), D-AD-2(sanction_7d/30d 전이 가능화), D-AD-4(service-role 미try 잔존 1곳), D-MT-3(당월 경계 필터), D-MT-10(뱃지-목록 술어 통일), D-ST-9(사문 'response' 정렬 일괄 제거), D-AU-4(unban 보상 실패 로깅 + 거짓 주석 교정). 회귀 고정 계약 테스트 32건 신설(467→499).
- **재분류**: D-IQ-6 → partial(위 표 참조) · D-CR-6 → skipped.
- **후속 안건(오너 큐)**: ① D-IQ-6 완결 — `get_mentor_student_nicknames` 인가 스코프에 개별질문 당사자 관계 추가(마이그레이션·직렬 레인) ② 탈퇴 실패 종결 건 unban 보상 스윕 ③ 정산 월 귀속 기준(created_at vs paid_at) 확정 ④ 멘토 정렬 'rating'→'review' 매핑 사문 경로.
