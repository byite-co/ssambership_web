# 알림 canonical event coverage (P1-11C)

> producer 존재 · domain write 와 **동일 transaction** 여부 · recipient · dedup key 확인.
> 원자(atomic) = `record_domain_notification`(SECURITY DEFINER RPC)를 **도메인 write 와 같은 트랜잭션**에서 호출(132 계약).
> best-effort = `insertNotificationBestEffort`(웹, 도메인 write **밖** 별도 insert — 실패해도 도메인 커밋). 원자 아님.

| # | event(type) | producer 위치 | 동일 tx? | recipient | dedup key | 상태 |
|---|---|---|---|---|---|---|
| 1 | question_answered | SQL 20260801040844 `qna_emit_answer_notification`(RPC 142 계열 + direct-write 트리거 144 계열 수렴) | ✅ atomic | 학생 | `question_answer_message:{message_id}` · `question_answer_attachment:{attachment_id}` (F2/D-12 — 구 `question_answered:{thread_id}` 폐기) | 완료 |
| 2 | subscription_renewal_succeeded | `subscriptionRenewalBatch` | ❌ best-effort | 학생 | (없음) | 웹 배치 — 원자화 후속 |
| 3 | subscription_renewal_failed_insufficient_cash | `subscriptionRenewalBatch` | ❌ best-effort | 학생 | (없음) | 웹 배치 — 원자화 후속 |
| 4 | subscription_renewal_upcoming | `subscriptionRenewalBatch` | ❌ best-effort | 학생 | (없음) | 웹 배치 — 원자화 후속 |
| 5 | subscription_expired | `subscriptionRenewalBatch` | ❌ best-effort | 학생 | (없음) | 웹 배치 — 원자화 후속 |
| 6 | mentor_subscription_price_changed | `mentorProfileMutations` | ❌ best-effort | 활성 구독 학생 | (없음) | 웹 — 원자화 후속 |
| 7 | mentor_termination_notice / refund | `mentorActivityService` | ❌ best-effort | 학생 | (없음) | 웹 — 원자화 후속 |
| 8 | mentor_pause_notice | `mentorActivityService` | ❌ best-effort | 학생 | (없음) | 웹 — 원자화 후속 |
| 9 | new_application (맞춤의뢰 지원) | `customRequestApplicationActions` | ❌ best-effort | 의뢰자 | (없음) | 웹 — 원자화 후속 |
| 10 | new_order_message | `orderMessageActions` | ❌ best-effort | 상대방 | (없음) | 웹 — 원자화 후속 |
| 11 | individual_question_assigned | `individualQuestionActions` | ❌ best-effort | 멘토 | (없음) | 웹 — 원자화 후속 |
| 12 | individual_question_claimed | `individualQuestionActions` | ❌ best-effort | 학생 | (없음) | 웹 — 원자화 후속 |
| 13 | individual_question_answered | `individualQuestionActions` | ❌ best-effort | 학생 | (없음) | 웹 — 원자화 후속 |
| 14 | individual_question_released | `individualQuestionActions` | ❌ best-effort | 학생 | (없음) | 웹 — 원자화 후속 |
| 15 | individual_question_message | `orderMessageActions`/IQ | ❌ best-effort | 상대방 | (없음) | 웹 — 원자화 후속 |
| 16 | individual_question_expired_refunded | `individualQuestionExpiryBatch` | ❌ best-effort | 학생 | (없음) | 웹 배치 — 원자화 후속 |
| 17 | notice / 공지·이벤트 | admin 공지 경로 | ❌ best-effort | 대상군 | (없음) | 웹 — 원자화 후속 |

## 결론
- **원자 producer**: 현재 `question_answered`(질문방) 1건만 도메인 트랜잭션과 원자적. 152 worker(claim/lease/fan-out/설정강제/dead-letter)와 outbox 파이프라인은 이 이벤트로 end-to-end 검증됨.
- **best-effort → atomic 전환(후속)**: 나머지 16 이벤트는 웹 서비스/배치에서 `insertNotificationBestEffort` 로 도메인 write 밖에서 발행된다. 진정한 동일-트랜잭션 원자화는 각 도메인 write 를 DB RPC(SECURITY DEFINER, `record_domain_notification` 호출 포함)로 옮겨야 하므로 **이벤트별 후속 작업**이다(각 1건씩 P1-11C-follow). dedup key 부여도 그 시점에 함께.
- **앱 전용 producer**: 실기기 FCM 발송·device token 등록(register_device_token 호출)·인앱 push 표시는 Flutter 앱 몫 = `WAITING_EXTERNAL_APP`. DB(device_tokens/deliveries/settings)·worker(dry-run)·웹 설정 UI 는 본 Phase 에서 완비.

---

## 갱신 (P1-11 원자화 진행 — 155)

**원자 producer 로 전환 완료 (7/17)**: `question_answered`(142) + 개별질문 6종 —
`individual_question_assigned/claimed/answered/released/expired_refunded/message`.
방식: **domain 테이블 AFTER 트리거**(`155_p1_11_iq_notification_atomization.sql`)가 domain write(RPC·웹 직접 write 무관)와
같은 트랜잭션에서 `record_domain_notification` 호출 → 원자·멱등((recipient,event_key) UNIQUE). 웹 best-effort 헬퍼·호출 제거
(`individualQuestionActions.ts`·`individualQuestionExpiryBatch.ts`). staging fixture 6종 전부 검증(domain write 롤백 시 알림 0).

**남은 10종 — 동일 트리거 패턴 후속 계획**:
- 구독 4종(renewal_succeeded/failed_insufficient_cash/upcoming/expired): `process_subscription_renewal`(RPC)·
  `subscription_billing_events`/`subscriptions` write 대상. billing event INSERT / subscriptions status 전이 트리거로 원자화.
  dedup key = `{event}:{subscription_id}:{period_end}`(주기별 1건).
- 맞춤의뢰 2종(new_order_message/new_application): `order_room_messages`/`mentor_applications` AFTER INSERT 트리거.
- 멘토 3종(termination_notice/refund/pause_notice): 다중 수신자 fan-out — `subscriptions` 상태 전이 또는 `refunds` INSERT
  트리거로 수신자별 1건. termination_refund 는 `refunds` INSERT(request_type='subscription_mentor_suspended') 트리거가 자연스러움.
- mentor_subscription_price_changed: `mentor_plans` UPDATE 트리거에서 활성 구독자 fan-out.
이들은 재무 RPC 본문을 재작성하지 않고 트리거만 추가하므로 안전하다. best-effort 호출은 트리거 추가와 동시에 제거해야 이중 발송이 없다.

---

## 갱신 (P1-11 원자화 완결 — 157/158/159) : canonical 17/17 원자

**전 17종 원자 producer 전환 완료.** 방식은 155 와 동일 — domain 테이블 AFTER 트리거가 domain write 와
같은 트랜잭션에서 `record_domain_notification`(132) 호출. 원자·멱등((recipient,event_key) UNIQUE).

| 이벤트 | 트리거(SQL) | domain write | recipient | event_key |
|---|---|---|---|---|
| subscription_renewal_upcoming | 157 `trg_sbe_notify_insert` | billing event 예고 마커 INSERT(renewal/skipped/pre_renewal_notice_sent) | 학생 | `{event}:{sub}:{period_end date}` |
| subscription_renewal_succeeded | 157 `trg_sbe_notify_*` | billing event renewal/succeeded 전이(068 RPC) | 학생 | `{event}:{sub}:{period_end date}` |
| subscription_renewal_failed_insufficient_cash | 157 `trg_sbe_notify_*` | billing event renewal_failed/failed 전이(068 RPC). 재시도에도 주기당 1건 | 학생 | `{event}:{sub}:{period_end date}` |
| subscription_expired | 157 `trg_sub_notify_expired` | subscriptions status→expired 전이(만료·해지예약 공통) | 학생 | `{event}:{sub}:{expired date}` |
| mentor_termination_notice | 158 `trg_mp_notify_activity` | mentor_profiles activity_status→terminating | 활성 구독 학생 fan-out | `{event}:{sub}:{effective date}` |
| mentor_pause_notice | 158 `trg_mp_notify_activity` | mentor_profiles activity_status→paused | 활성 구독 학생 fan-out | `{event}:{sub}:{pause_until date}` |
| mentor_termination_refund | 158 `trg_refund_notify_mentor_termination` | refunds INSERT(request_type=subscription_mentor_suspended) | 학생 | `{event}:{refund_id}` |
| mentor_subscription_price_changed | 158 `trg_mplan_notify_price_*` | mentor_plans amount_cents INSERT/변경 | 활성 구독 학생 fan-out | `{event}:{mentor}:{sub}:{txid}` (동일 tx 다중 tier = 1건) |
| new_application | 159 `trg_cra_notify_new_application` | custom_request_applications INSERT | 의뢰 글 작성자(자기 지원 무발화) | `{event}:{application_id}` |
| new_order_message | 159 `trg_com_notify_new_order_message` | custom_order_messages INSERT | 주문 상대방(제3자 작성 무발화) | `{event}:{message_id}` |

웹 best-effort 헬퍼 전면 제거: `insertNotificationBestEffort`·`fetchUserDisplayName`·`notificationInsert.ts` 삭제,
호출부 5파일(subscriptionRenewalBatch/mentorActivityService/mentorProfileMutations/customRequestApplicationActions/orderMessageActions) 정리.
멘토 종료 환불 본문의 금액 표기 오류(cents 를 캐시로 그대로 출력 — 100배)를 트리거에서 `cents÷100` 으로 교정.

**검증**: 로컬 스크래치 PG16 에서 정본 132+157+158+159 적용 + rollback-only fixture 24 assertion 전부 PASS
(`scripts/verify/local_notification_trigger_check.sh`). **staging(lbeqxarxothkmzqvpudy) 적용 완료(2026-07-20)** —
157→158→159 커밋 전문 그대로 적용 + 후속 160(표시 헬퍼 ACL revoke). staging 에서 동일 fixture **24 assertion
전부 PASS**, 새 트랜잭션 baseline 대조 전 항목 일치(실사용자 알림·금융 무변경). 상세: `docs/audit/sql_apply_manifest.md`.
production 은 미적용 — 적용 순서는 runbook §1(SQL 먼저, 웹 나중)을 따른다.

**잔여 앱 부채(WAITING_EXTERNAL_APP)**: 실기기 FCM 발송·device token 등록·앱 딥링크(변동 없음).

---

## 갱신 (F2/D-12 — 질문방 답변 알림 행 단위 계약 · 2026-08-01)

**개정 사유(운영 QA D-12):** 구 계약은 `question_answered` 알림을 멘토 **최초 답변 상태 전이에 결합**해
발행했고 dedup key 가 `question_answered:{thread_id}` **스레드 단위**였다. 그 결과 (1) `first_answered_at`
이 설정된 스레드의 후속 멘토 답변은 알림 생성 함수 자체가 실행되지 않았고, (2) 최초 답변 조건만 제거해도
후속 알림이 스레드 키 UNIQUE 에 무음 흡수됐다. **과거 문서의 "두 번째 답변 알림 미증가 = exactly-once"
표현은 더 이상 정본이 아니다** — 그것은 스레드 단위 exactly-once(=D-12 결함)를 정답으로 고정한 서술이었다.

**신 정본 계약 (`supabase/sql/20260801040844_qna_answer_notification_per_event.sql`):**

| 항목 | 계약 |
|---|---|
| 첫 답변 상태 전이(pending/open→answered + `first_answered_at`) | **스레드 단위 exactly-once** (기존 유지) |
| 답변 알림 | **멘토 답변 이벤트(메시지 행 / 단독 첨부 행) 단위 exactly-once** |
| 멘토 메시지 event_key/dedup_key | `question_answer_message:{message_id}` |
| 멘토 단독 첨부(message_id IS NULL) event_key/dedup_key | `question_answer_attachment:{attachment_id}` |
| 메시지 연결 첨부 | 메시지 이벤트에 합류 — **추가 알림 0** (텍스트+첨부 한 답변 = 알림 1) |
| 학생 메시지/첨부 · 거부된 쓰기 · 기존 과거 행 · 동일 행 재처리 | 알림 0 |
| 알림 소스 단일화 | 신규 helper `qna_emit_answer_notification(thread_id, message_id, attachment_id)` — RPC 2종(`qna_append_message`/`qna_register_attachment`)과 direct-write AFTER 트리거 2종(`qm/qa_direct_answered_after`)이 모두 이 helper 로 수렴. `qna_apply_answered_transition` 은 전이 전용으로 축소 |
| 원자성 | 132 결정 C 유지 — helper 는 도메인 트랜잭션 내 PERFORM, 실패 시 도메인 write 까지 전체 롤백 |
| 함수 identity | `qna_append_message`/`qna_register_attachment`/`qna_apply_answered_transition` 의 시그니처·반환형·SECDEF·search_path·EXECUTE ACL 불변 |
| 과거 데이터 | 구 `question_answered:{thread_id}` 키 행은 백필·삭제하지 않음 |

**검증(2026-08-01, 로컬 스크래치 PG16 — `scripts/verify/local_qna_answer_notification_check.sh`):**
기준선(132+136+139+141+142+144)에서 D-12 실측 재현(두 번째 답변 알림 +0) → forward 적용 후
rollback-only fixture(`scripts/verify/fixtures/qna_answer_notification_per_event_fixture.sql`) **64 assertion
전부 PASS**(최초/후속/3번째 답변 각 +1·행 재처리 +0·단독 첨부 +1·연결 첨부 +0·학생 이벤트 +0·비당사자/잠금
거부·직접쓰기 경로 동일 계약·중복 키 0) + 독립 2세션 동시성(메시지 2·알림 2·outbox 2·전이 1회·중복 키 0)
+ rollback 후 카탈로그 서명(함수 def md5·ACL·트리거) 기준선 완전 복원 + 재적용 재검증 PASS.
**staging·production 원장 미적용** — 원격 적용은 별도 승인 단계다.
