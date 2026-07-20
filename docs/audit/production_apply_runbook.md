# Production 적용 런북 (SQL 122~159) — ⚠️ 실적용 금지, 준비 문서

> 이 문서는 **production 에 적용하지 않는다**. staging(`ssambership-staging`)에만 적용·검증된 정본 SQL 의
> production 적용 순서·전/후 점검·롤백 구분·진단 쿼리를 정리한 준비 문서다. 실적용은 오너 승인 후.
> 정본 매니페스트: `docs/audit/apply_manifest_prod.md`. 신규 번호 유일성: `node scripts/verify/sql_number_integrity.mjs`.

## 0. 번호 충돌 주의(레거시)
파일명 번호가 중복된 레거시 구간이 있다(병렬 p0/p1 트랙). **파일명 번호가 아니라 아래 명시 순서로 적용**한다.
`002`(app_core / custom_request_orders_status / p0_subscriptions), `032`(weekly_question_usage / admin_content_reports),
`033`(admin_reviews / question_threads_topic), `034`(mentor_favorites / admin_disputes), `039`(custom_request_compat / storage_audit).
→ 146+ 신규 구간은 중복 없음(정본). clean-DB 적용은 `apply_manifest_prod.md`의 순서를 따른다.

## 1. 적용 순서 (146~159, 신규 정본)
전부 **신규 객체만 추가**(기존 applied 정의 무수정). 순서 의존:
1. `146` avatar/document 교차ref 진단 — READ-ONLY(미적용, 진단만).
2. `147` 게시판 idempotency·soft-delete (037 이후).
3. `148` 숏폼 idempotency (038 이후).
4. `149` 질문첨부 Storage INSERT 자격 (049·141·142·136 이후).
5. `150` refund billing_event FK + live-refund 정밀화 (064·069·142 이후).
6. `151` 회원탈퇴 saga + write gate (001·115 이후). **기능 플래그 OFF**.
7. `152` 알림 delivery worker + 설정 (132 이후). **실 FCM 없음**.
8. `153` 지급 스택 수렴(전역 UNIQUE·dry-run RPC) (106·107·109·110·111·114 이후).
9. `154` 회원탈퇴 운영 어댑터(RESTRICTIVE storage gate·lease·forfeit) (151·115 이후).
10. `155` 개별질문 알림 원자화 트리거 (132 이후).
11. `156` 지급 scheduler 기반(기본 OFF) (153·107 이후).
12. `157` 구독 4종 알림 원자화 트리거 (132·064·068 이후. 헬퍼 notification_* 를 158/159 가 사용 → 157 선행).
13. `158` 멘토 4종 알림 원자화 트리거 (157·132·103·069·067 이후).
14. `159` 맞춤의뢰 2종 알림 원자화 트리거 (157·132·003 이후).

> ⚠️ **157~159 는 staging 미적용**(이 세션에 staging secret 부재). staging 적용 →
> `scripts/verify/fixtures/notification_atomization_157_159_fixture.sql`(rollback-only) 재검증 →
> 그 다음에만 웹 배포. **웹이 best-effort 알림을 제거했으므로 SQL 이 웹보다 먼저 적용돼야 한다**
> (순서 위반 시 구독/멘토/의뢰 알림 10종 미생성 창이 생긴다 — 금융/도메인 write 는 무영향).
> 로컬 검증: `scripts/verify/local_notification_trigger_check.sh` = 스크래치 PG16 에서 24 assertion PASS.

## 2. 단계별 pre-check / post-check
| SQL | pre-check | post-check |
|---|---|---|
| 147/148 | 대상 테이블 존재·중복 idempotency 없음 | UNIQUE·deleted_at 컬럼 존재, 기존 행 무영향 |
| 149 | 149 헬퍼 선행(qra_*·qna_subscription_has_live_refund) 존재 | qra_storage_insert_party 정책에 eligibility conjunct 포함 |
| 150 | refunds 0 NULL billing_event(§4 진단) | FK 존재, 신규 refund 경로가 billing_event_id 기록 |
| 151/154 | account_deletion_jobs 0행(플래그 OFF) | write gate 트리거·RESTRICTIVE 정책·lease 컬럼 존재, 0 job 무영향 |
| 152 | notification_outbox(132) 존재 | device_tokens·deliveries·settings·claim RPC 존재 |
| 153/156 | payout_run_items 중복 0(§4 진단), 105~114 적용 상태 | 전역 UNIQUE, pay_due dry-run 기본, scheduler_enabled=false |
| 155 | individual_questions 트리거 미존재 | 트리거 3개 존재, 전이 시 알림 원자 |
| 157 | 132 helper·notification_* 헬퍼 미존재 | billing event/subscriptions 트리거 3개+헬퍼 3개 존재, fixture A 절 PASS |
| 158 | 157 헬퍼 존재 | mentor_profiles/refunds/mentor_plans 트리거 4개 존재, fixture B 절 PASS |
| 159 | 157 헬퍼 존재 | applications/order_messages 트리거 2개 존재, fixture C 절 PASS |

## 3. 롤백 구분
- **롤백 가능(안전)**: 146(진단 no-op), 155/157/158/159(트리거 drop — 단 웹 best-effort 도 제거된 상태라
  트리거만 drop 하면 해당 알림이 멎는다 → 롤백 시 웹도 함께 롤백), 156(신규 테이블·함수 drop), 152 신규 테이블 drop(데이터 없을 때).
- **롤백 주의(구조 의존)**: 147/148 UNIQUE·컬럼(다른 코드가 참조 시작하면 drop 위험), 149/151/154 정책·트리거(원복 시 gate 해제).
- **롤백 불가/신중**: 150 FK(데이터 참조 후), 153 전역 UNIQUE(지급 스냅샷 존재 시). → forward-fix 우선.

## 4. 진단 쿼리 (production 적용 전 실행 · 자동 수정 금지)
```sql
-- (a) mentor_plans.amount_cents 누락(구독 실차감 폴백 위험)
select id, mentor_id, plan_tier from public.mentor_plans where amount_cents is null or amount_cents <= 0;

-- (b) refund billing_event_id NULL 레거시(150 current-event 게이트 대상 밖)
select id, subscription_id, request_type, status, created_at from public.refunds
 where billing_event_id is null and request_type in ('subscription_prorated','subscription_mentor_suspended')
 order by created_at desc;

-- (c) 지급 중복(같은 source 가 2개 이상 payout_run_items — 전역 UNIQUE 전 잔재)
select source_type, source_id, count(*) c from public.payout_run_items group by 1,2 having count(*) > 1;

-- (d) Storage orphan(DB 미참조 객체) — 버킷별 list 와 참조 컬럼 차집합(운영 스크립트로 페이지네이션)
--     예: community_posts.image_urls / shortform_posts.video_url / mentor_profiles.student_id_image_url·profile_image_url
--     에 없는 storage.objects.name 을 버킷별로 집계. (대량이면 배치 · 자동삭제 금지)

-- (e) outbox dead-letter 모니터링
select id, event_type, attempt_count, last_error, updated_at from public.notification_outbox
 where status = 'dead' order by updated_at desc limit 100;

-- (f) account_deletion stuck job(진행 중 오래 정체)
select user_id, state, attempts, last_error, leased_until, updated_at from public.account_deletion_jobs
 where state not in ('completed','canceled','failed')
   and updated_at < now() - interval '1 hour' order by updated_at asc;

-- (g) avatar↔document 교차 ref(146 진단, 0행 기대)
--     supabase/sql/146_p2_1_avatar_document_crossref_diagnostic.sql 참조.
```

## 5. 모니터링 상시 항목
- outbox dead-letter 증가율((e)), delivery 실패율.
- account_deletion stuck job((f)) — lease 만료 회수(`account_deletion_reclaim_expired`)·재시도 backoff.
- payout: `run_scheduled_payout` 은 scheduler_enabled=false 인 한 dry-run(실지급 0). enable 은 오너 명시 승인 시만.

## 6. 실행하지 못한 검증(환경 부채)
- **독립 2세션 동시성**: `scripts/verify/two_session_concurrency.sh` — DATABASE_URL secret 필요 = `READY_NOT_EXECUTED`.
  구조(전역 UNIQUE·advisory·lease·SKIP LOCKED)는 단일세션 rollback fixture 로 검증됨.
- **clean-DB 재현(전체 체인)**: Supabase CLI 미설치 = `BLOCKED_ENV`(auth/storage 스키마·role 에뮬레이션 필요).
  단, 로컬 PG16 확보로 **알림 스택(132+157+158+159)은 스크래치 DB 실구동 검증 완료**
  (`scripts/verify/local_notification_trigger_check.sh`, 스텁 스키마 = `scripts/verify/fixtures/local_stub_schema.sql`).
  전체 001~159 체인은 CI 격리 Docker(pinned CLI) 또는 fresh Supabase 에서 `apply_manifest_prod.md` 순서 적용 권장.
- **인증 Preview E2E**: 실 멘토 로그인 환경 부재 = `READY_NOT_EXECUTED`. Playwright 시나리오(`e2e/`)·fixture 준비됨,
  Vercel Preview + 실 로그인에서 오너 확인 권장(숏폼 direct upload·게시판 이미지/멱등/soft-delete·프로필 분리·알림 pagination·favorite/recent).

## 7. staging 진단 스냅샷 (2026-07-20, READ-ONLY)
| 항목 | staging 결과 |
|---|---|
| mentor_plans.amount_cents 누락 | 0 |
| refund billing_event_id NULL(구독환불) | 0 |
| payout 중복 source | 0 |
| outbox dead-letter | 0 |
| account_deletion 진행 중 job | 0 |
| avatar↔document 교차 ref(146) | 0 |
| 146+ 신규 SQL 번호 중복 | 0 (sql_number_integrity.mjs) |

→ staging baseline 깨끗. production 적용 전 동일 진단을 production 에서 재실행(값이 다르면 자동수정 금지·오너 보고).
