# 푸시 outbox 워커 — 활성 순서·롤백·관측 (App-F1, 2026-08-27)

> 원칙: **additive-only** — 기존 cron 라우트 3개·`record_domain_notification`·트리거·RLS·
> `outboxWorker.ts`·`outboxBackoff.ts` 무수정(PUSH 지시문 B-0). 서비스 계정 JSON 은
> 어떤 파일·로그에도 쓰지 않는다. DB 변경은 마이그레이션 1본(GRANT 1줄)뿐이며
> 적용은 오너 "적용 승인"(O-7) 후 CLAUDE.md 절차(114 패턴).

## 구성 요소

| 파일 | 역할 |
|---|---|
| `app/api/cron/notification-outbox/route.ts` | 분 단위 cron(vercel.json). CRON_SECRET 인증 → 플래그 확인 → service-role 로 `runOutboxBatch` 반복(최대 45초, claimed 0 이면 종료). claim 래퍼가 게이트 2종(F19: `new_order_message`·`new_application`) 즉시 sent 처리 + `notifications` 행 부재 outbox sent 처리(무한 재시도 방지) |
| `lib/notifications/fcmTransport.ts` | FCM HTTP v1 transport — google-auth-library JWT + fetch(`firebase-admin` 금지). 액세스 토큰 모듈 캐시(만료 60초 전 갱신). 순수 빌더 `buildFcmMessage`(data 6키·전부 문자열·부재 생략·link/url 금지)와 판정 `classifyFcmSendFailure`(404/UNREGISTERED=무효, 429/5xx=재시도)는 계약테스트 대상 |
| `supabase/baseline/post_ledger_backfills/20260827100100_device_token_register_grant.sql` | `register_device_token` authenticated EXECUTE GRANT 1줄 — **라이브 미적용(O-7 대기)**. 정본 source 는 이 경로이고 `supabase/migrations/` 사본 + manifest 행은 `build_native_migration_pack.py` 산출물(직접 편집 금지). ★ PUSH-APPLY.md 증적 작성 시 기록: 최초 커밋의 손 배치(migrations 직행)를 CI `validate_native_migration_pack` FAIL 후 backfill 경로 + 생성기 재생성으로 교정했다(2026-08-27) |

플래그 2단(전부 Vercel env, 서버 전용):

- `NOTIFICATION_OUTBOX_WORKER_ENABLED` — 미설정/false 면 라우트가 `{ok:true, disabled:true}` no-op.
- `FCM_TRANSPORT_MODE` — `live` 정확 일치만 실발송. 그 외 전부 dry-run(빌더는 실행, 발송 0, outbox 는 sent 로 흐름).

DB 정본 스위치 `notification_transport_config.push_transport_enabled` 는 **코드가 읽지도 쓰지도 않는다**
(service_role 권한 없음 — F14). 전환은 postgres 롤(SQL 편집기)로만: O-8.

## 활성 순서 (O-8 — 순서 고정, 적대 검증 #30)

1. 이 PR 배포(플래그 기본 OFF — 동작 0).
2. O-7: GRANT 마이그레이션 "적용 승인" → 적용 → `contracts:export`/`verify` → `docs/sprint-push/PUSH-APPLY.md` 증적.
3. Vercel env `NOTIFICATION_OUTBOX_WORKER_ENABLED=true` (FCM_TRANSPORT_MODE 는 dry-run 유지) → 재배포.
4. SQL 편집기(postgres)에서:
   `update public.notification_transport_config set push_transport_enabled = true, updated_at = now();`
5. 관측 쿼리로 outbox 가 pending→sent(0 deliveries — 토큰 0 상태)로 흐르는지 확인.
   ★ 3 전에 4 를 먼저 켜면 outbox 가 pending 으로 누적되어 앱 출시 시점에 오래된 알림이
   한꺼번에 발송된다 — 순서 고정(워커 활성 후 플래그 ON).
6. `FCM_TRANSPORT_MODE=live` → 재배포. 실기 확인은 앱 O-9 와 합동.

## 롤백

- **워커 정지**: `NOTIFICATION_OUTBOX_WORKER_ENABLED=false` → outbox 는 pending 누적만(데이터 손실 없음).
  재개하면 밀린 분부터 처리된다(단, 누적 기간이 길면 오래된 알림 발송 — 재개 전 잔량 확인).
- **발송만 정지**: `FCM_TRANSPORT_MODE=dry-run` → 상태 전이는 계속, 실발송 0.
- **outbox 생성 자체 정지(가장 상류)**: postgres 로 `push_transport_enabled=false`.
- **GRANT 회수**: `revoke execute on function public.register_device_token(text, text) from authenticated;` 1줄.

## 관측 쿼리

```sql
select status, count(*) from notification_outbox group by 1;
select status, count(*) from notification_deliveries group by 1;
-- 토큰 등록 확인(앱 O-9): select platform, revoked_at, count(*) from device_tokens group by 1, 2;
-- dead-letter/재시도 상태: select event_type, status, attempt_count, last_error
--   from notification_outbox where status <> 'sent' order by updated_at desc limit 20;
```

## TODO — O-12 (개인정보처리방침, 오너 문안 승인 대기)

`lib/legal/companyInfo.ts` `PROCESSORS` + 국외이전 항에
"Google LLC — Firebase Cloud Messaging(푸시 알림 발송, 기기 토큰, 미국)" 추가 필요 —
개인정보보호법상 **처리위탁 + 국외 이전 고지** 둘 다. 오너가 승인한 문안 확정 전에는
이 PR 에서 반영하지 않는다(NICE 개정과 같은 커밋에 실어도 됨).
