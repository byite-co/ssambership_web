# 알림 canonical event coverage (P1-11C)

> producer 존재 · domain write 와 **동일 transaction** 여부 · recipient · dedup key 확인.
> 원자(atomic) = `record_domain_notification`(SECURITY DEFINER RPC)를 **도메인 write 와 같은 트랜잭션**에서 호출(132 계약).
> best-effort = `insertNotificationBestEffort`(웹, 도메인 write **밖** 별도 insert — 실패해도 도메인 커밋). 원자 아님.

| # | event(type) | producer 위치 | 동일 tx? | recipient | dedup key | 상태 |
|---|---|---|---|---|---|---|
| 1 | question_answered | SQL 142/144 `qna_append_message`·`qna_register_attachment` | ✅ atomic | 학생 | `question_answered:{thread_id}` | 완료 |
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
