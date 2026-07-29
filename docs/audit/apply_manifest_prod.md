# 운영 적용 정본 매니페스트 (apply_manifest_prod.md)

> **정본(Single Source of Truth)** — 클린설치·운영 배포 시 `supabase/sql/`를 적용하는 **유일한 정본 순서 문서**다.
> 결정 B(2026-07-19, 오너 확정): **번들 폐기 + 운영 apply manifest 방식**을 채택한다.
> 이 문서가 `supabase/bundles/*` 및 `supabase/sql/INDEX.md`보다 우선한다.
> 파일별 세부 판정·중복번호 근거는 동반 문서 `docs/audit/sql_apply_manifest.md`(상세 레퍼런스)를 참조한다.

## 0. 상태·범위

- 대상: fresh/clean 설치와 운영 배포의 적용 순서 정본.
- staging 실적용 이력(권위 있음): `123 · 124 · 125 · 126 · 129` — `docs/audit/sql_apply_manifest.md` 하단 표.
- `supabase_migrations` 원장은 저장소 파일 번호와 드리프트가 크므로 **운영 정의가 우선**하고, 수동 적용은 원장에 가짜 행으로 기재하지 않는다.
- **클린 DB 재현 검증 완료(2026-07-30, 후보 C 정본):** Supabase CLI 2.110.0 / PostgreSQL 17.6 환경에서 정규 적용 후보 **175개**를 §2~§4 순서로 전건 적용해 **175/175 성공**했다. 게이트 결과 G0·G1·G2_STRUCTURAL_REPLAY·G3·G4 PASS / G5 완료. 상세 결과·후보 이력은 §7. (구 "클린 DB 재현 미실행" 검증 부채는 이 검증으로 해소.)

## 1. 번들 폐기 (deprecated)

- `supabase/bundles/bundle_1_base_001_031.sql`
- `supabase/bundles/bundle_2_features_032_061.sql`
- `supabase/bundles/bundle_3_recent_062_069.sql`

위 3개 번들은 **legacy/deprecated — 신규 배포 사용 금지**다. 삭제하지 않고 이력으로 보존한다. **재생성·수정하지 않는다.** 클린설치는 반드시 본 문서(개별 파일 순서)를 사용한다. 번들과 개별 파일이 다르면 개별 파일이 정본이다.

## 2. 적용 원칙

1. 기본 순서 = 파일명 숫자 접두어 오름차순.
2. 같은 숫자 접두어(중복) 및 의존 역전은 §4 예외표로 덮어쓴다.
3. `NNNb_` 파일은 대응 `NNN` 직후에 보정으로 적용.
4. 기존 적용 SQL은 수정·재번호하지 않는다. 보안·수렴 보정은 새 번호로만 추가.
5. **inventory/reference-only 초안·one-off·감사/진단 SQL·운영 시드·지급 스택(게이트, `[DRAFT — DB 미적용]` 포함)은 정규 순차 적용에서 제외**(§3).
6. **기능 플래그 OFF 는 런타임 기능 비활성화일 뿐, schema migration 제외 사유가 아니다.** 플래그 파일(예: `115`·`116`·`151`·`152`)의 스키마도 정규 clean-install 에 포함한다.
7. **본 문서의 manifest 분류가 오래된 SQL 파일 헤더 문구보다 우선한다.** 예: `115`·`116` 헤더의 "라이브 미적용", `167`~`169` 헤더의 "초안·staging 미적용" 은 작성 당시의 역사 문구다. 기존 migration 불변 원칙에 따라 SQL 파일 자체는 수정하지 않으며, 현재 판정은 §3·§7 이 정본이다.
8. 수동 staging 적용은 성공 후에만 `sql_apply_manifest.md`에 기록.

## 3. 정규 적용 제외 (별도 게이트) — 총 15개 파일

정규 clean-install 적용 후보 = `supabase/sql/*.sql` 전체 190개 중 아래 **15개**를 제외한 **175개**(2026-07-30 후보 C 검증 PASS — §7).

| 분류 | 파일 | 사유 |
|---|---|---|
| inventory/reference-only | `002_app_core_schema_draft.sql` | 인벤토리 초안 — 헤더가 "바로 적용하지 마세요"인 참고용 파일. 실행 대상 아님(보존). 178개 후보 실측에서 002 중복 정의 실패의 원인(§7) |
| one-off 정리 | `071_individual_question_test_data_cleanup.sql` | 마이그레이션 아님. 운영/클린 적용 전 별도 승인 |
| Storage 감사 | `039_storage_buckets_private_audit.sql` | 점검 SQL(버킷 private 확인). 데이터 변경 아님 |
| READ-ONLY 진단 | `146_p2_1_avatar_document_crossref_diagnostic.sql` | 진단 전용(DDL·DML 없음) — 적용 대상 아님(§146 표 "미적용(진단)") |
| 지급 스택 게이트 | `105 106 107 108 109 110 111 114` (8개, `105`~`110`은 `[DRAFT — DB 미적용]`) | 내부지갑 적립 모델·자금 코드 승인·독립 2세션 검증 전 운영 적용 금지(§5) |
| 지급 게이트 후속 | `153_p2_25_pay_due_payouts_convergence.sql` | 지급 게이트로 제외된 `105·106·107·109·110·111·114`를 필수 선행으로 요구하는 staging 수렴 파일. 지급 스택 승인 전에는 같은 게이트에 묶어 clean-install 제외(§5) |
| 지급 게이트 후속 | `156_p2_25_payout_scheduler_foundation.sql` | `153`과 지급 객체를 필수 선행으로 요구하는 scheduler 기반 파일. 동일 게이트(§5) |
| 운영 시드 | `184_seed_additional_admin.sql` | 특정 운영자 계정 시드(멱등 one-off). 스키마 migration 아님 — 환경별 별도 승인·실행 |
| 예약·결번 | `127`(예약 미생성) · `172`(결번) | §6 예약번호 — 파일이 없어 순서에 없음. 구 예약 `128·130·131`은 파일 생성·적용됨(정규 포함) |

**정규 포함 명시(분류 확정 2026-07-30):**

- `115_account_deletion.sql` · `116_user_blocks.sql` — **정규 clean-install 포함.** 기능 플래그 파일이지만 §2 원칙 6에 따라 스키마는 포함한다. 근거: staging migration 원장 `20260704135803 / 115_account_deletion` · `20260704135524 / 116_user_blocks`, 현 staging 카탈로그에 `public.user_deletion_log` · `public.anonymize_user_for_deletion(uuid,text)` · `public.user_blocks` 실존, `154` 이후 account-deletion migration 이 115 의 함수·객체를 필수 선행으로 사용.
- `167_iq_attachment_unique_question_storage_path.sql` · `168_iq_attachment_register_rpc_idempotent.sql` · `169_iq_attachment_storage_delete_policy.sql` — **정규 clean-install 포함.** 현재 staging historical baseline 에 세 파일과 동일한 객체 효과가 존재하며, fresh install 수렴을 위해 포함한다(정확한 파일↔원장 매핑은 확인되지 않았다 — 상세 근거는 `sql_apply_manifest.md`).
- 위 5개 파일 헤더의 "라이브 미적용"·"초안·staging 미적용" 문구보다 본 분류가 우선한다(§2 원칙 7).

## 4. 순서 예외표 (숫자순 위반·의존)

| 파일 | 규칙 |
|---|---|
| **시작 순서(고정)** | `001` → `002_p0_subscriptions_questions_draft` → `003_p0_custom_request_draft` → `002_custom_request_orders_status` → 이후 정본 순서(숫자순+본 표). `002_app_core_schema_draft` 는 실행하지 않는다(§3 inventory/reference-only) |
| `002_custom_request_orders_status.sql` | `003_p0_custom_request_draft.sql` 이후 |
| `033_p1_admin_reviews_moderation.sql` | `042_reviews_system.sql` 이후 |
| `033_question_threads_topic.sql`, `034_mentor_favorites.sql`, `032_*`, `039_*` 중복 | `sql_apply_manifest.md` §숫자 접두어 중복 표 기준 |
| `042_reviews_system.sql`(클린설치 교정본) → `123_reviews_converge.sql` → `126_reviews_rls_hardening.sql` | 리뷰 정본 수렴 순서. 클린설치는 교정 042 반영 후 123·126 순 |
| `053b`, `073`/`073b` | 대응 정규번호 직후 보정 |
| 지급 스택 적용 순서(게이트 승인 시) | `105 → 106 → 107 → 109 → 110 → 111 → 114 → 108` (§5) |

## 5. 지급 스택 (내부지갑 적립 모델) — 게이트

확정 적용 순서: **`105 → 106 → 107 → 109 → 110 → 111 → 114 → 108`**.

- **게이트 범위 = `105~111 · 114 · 153 · 156`.** `153`(P2-25 지급 수렴)·`156`(P2-25 scheduler 기반)은 게이트로 제외된 지급 객체를 필수 선행으로 요구하므로 같은 게이트에 묶어 정규 clean-install 에서 제외한다(§3). 게이트 승인 시 위 확정 순서 적용 후 `153 → 156` 순으로 적용한다.
- 현행 확정 모델 = **즉시 내부지갑 적립**(실은행 송금 아님).
- 자금 코드 승인 + staging fixture + 독립 2세션 경쟁 검증 전 **운영 적용 금지**.
- P2-25 필수 교정(주문/settlement ID 분리, `(source_type,source_id)` 전역 UNIQUE, `108` ON CONFLICT/RETURNING, 실 INSERT 행만 합산, 중복 자동삭제 금지·대사)과 함께만 확정.
- P1-13 refund approval ↔ payout settlement lock 상호배제 선구현.
- `112_mentor_directory_rpc_photo_highschool.sql`·`113_individual_question_subject_gate.sql`는 지급 스택이 **아니며** 정규 순번(숫자 위치)으로 적용.

## 6. 예약 번호 (보존)

| 번호 | 예정 |
|---|---|
| `127` | P1-8 질문방 원자 RPC |
| `128` | P1-9 `approve_refund_request_admin` 에스크로 분기 복원 |
| `130` | P2-14 숏폼 scrap reaction CHECK+RLS |
| `131` | P1-13 구독 생성/재활성화 RPC |

`132_notification_outbox_foundation.sql` = P1-11F 알림 outbox foundation(적용됨). **클린설치에서 127(P1-8)·131(P1-13)보다 선행** 적용해야 한다(도메인 RPC 가 `record_domain_notification` 호출).

`133`(P2-15)·`134`(P2-24 bio)·`135`(P3-2 리뷰 통계 RPC) 적용됨. 다음 신규 임의번호는 예약(131 P1-13)을 건너뛴 **`136`**부터.

### 136–138 (P1-8A / P3-8 / P3-9 수렴 — staging 적용됨)

원래 PR #43(main 기반)에서 130·131·132 로 staging 선적용됐으나 이 브랜치의 130(scrap)·132(outbox)와 충돌하고 131 은 P1-13 예약이라, 정본 브랜치에서 **136·137·138** 로 수렴한다. staging 실객체 = 아래 정본 파일과 일치(멱등 재적용 안전).

| 번호 | 정본 파일 | 내용 | staging | 의존 |
|---|---|---|---|---|
| `136` | `136_p1_8a_question_room_atomic_rpc.sql` | P1-8A 질문방 원자 RPC 5종(`qna_create_question_thread`(무료/구독 서버분기)+무료 wrapper+append+confirm+wrong+register) · `free_question_usage.thread_id`(FK SET NULL + **UNIQUE**) · `question_attachments.storage_path` **UNIQUE** · execute={authenticated,service_role} | 적용됨 | **`132`(record_domain_notification) 선행 필수** |
| `137` | `137_p3_8_realtime_messages_threads.sql` | P3-8 realtime publication 에 `question_messages`·`question_threads` 추가(멱등) | 적용됨 | 136 후 |
| `138` | `138_p3_9_student_nickname_rpc_anon_revoke.sql` | P3-9(부분) `get_mentor_student_nicknames` anon/public EXECUTE 회수 | 적용됨 | — |

- 클린설치 순서: `132`(P1-11F outbox) → `136`(P1-8A) → `137`(P3-8) → `138`(P3-9). **staging-only 의존 없음**(record_domain_notification·notification_outbox 는 132 로 저장소에 존재).
- P1-8A 전환 정책: 기존 direct-write 정책·GRANT·049 storage·`open` 상태 **유지**. direct 정책 제거·open→pending 최종 이관 = **P1-8B(WAITING_EXTERNAL_APP)**.
- pending-refund lock 경계(설계 §2 결정 C)는 P1-13 billing-event 정본 확정 시 helper 로 교체 = **WAITING_P1_13**.
- 검증: rollback-only fixture(무료/구독 경로·UNIQUE·attachment 경로검증·멘토 첫답 answered+exactly-once·주간한도·비당사자) 전부 PASS, baseline 0행. 독립 2세션 동시성 = **BLOCKED_ENV**. 실인증 브라우저 E2E = 미실행(검증 부채).

### 131 / 139 / 140 (P1-13 · P1-8A 첨부 계약 · P3-9 완결 — staging 적용됨)

| 번호 | 정본 파일 | 내용 | staging | 의존 |
|---|---|---|---|---|
| `131` | `131_p1_13_subscription_checkout_atomic.sql` | **P1-13** 구독·결제 원자 상태기계. `confirm_subscription_checkout(payment,plan,idem)` service_role 전용 — pending 확정(TTL 30분)·processing 거부·성공별칭 정본화·멘토/플랜/결제/구독 pair 잠금·금액 mentor_plans 정본 재계산·구독 생성/재활성화+지갑차감+payment succeeded 원자·원장 금액 불일치 격리(구조화 실패). `payments.plan_id`+camelCase `metadata.planId` 백필, `mentor_profiles.is_open_for_subscriptions` 정본. | 적용됨 | 019/023(cash debit)·067(mentor_plans)·064(billing period) |
| `139` | `139_p1_8a_attachment_storage_contract.sql` | P1-8A 첨부 Storage 계약: 등록 RPC 에 storage 객체 존재+bucket+owner_id 대조 추가, 업로드 INSERT 정책에 thread 소속+쓰기가능 상태 조건, 보상 DELETE 정책 신설(owner+미등록만). | 적용됨 | 049·136 |
| `140` | `140_p3_9_student_nickname_subscription_room_scope.sql` | **P3-9 완결** `get_mentor_student_nicknames` 인가를 활성구독 OR 질문방 당사자로 재정의(custom_order-only 제외). | 적용됨 | 138 |

- **P1-13 웹 전환**: `finalizeSubscriptionCheckout` 의 직접 subscription INSERT + debit + markSucceeded 3단계 → `confirm_subscription_checkout` 단일 RPC. 금액은 RPC 가 mentor_plans 정본에서 재계산(구 recommended-price 폴백 대체 — **미가격 mentor_plans 행 멘토는 명시적 오류 = 검증 대상**).
- **P1-13 검증**: rollback-only fixture(pending→active+debit+succeeded·멱등 무이중차감·processing/stale/insufficient/closed 거부·금액 mentor_plans 정본·plan_id/metadata 백필) 전부 PASS, baseline 0행. **독립 2세션 = `CONCURRENCY_VALIDATION_DEBT`**(단일세션 상태기계만 검증). 실지갑·실결제·실원장 무변경. `insertSubscriptionRow` 등 구 3단계 helper 는 미호출 dead-code(경고)로 잔존 — 별도 정리 대상.
- 상태: P1-13 = `IMPLEMENTED_STAGING_WITH_CONCURRENCY_DEBT`(완전 완료 아님). P1-8A = `IMPLEMENTED_STAGING_WITH_CONCURRENCY_DEBT`. P3-9 = 완료(anon revoke + 인가 재정의).

### 144 / 145 (v2 Phase1 반려 보정 — staging 적용됨)

| 번호 | 정본 파일 | 내용 | staging |
|---|---|---|---|
| `144` | `144_p1_8a_direct_write_eligibility.sql` | 1-1 직접 thread 생성 한도우회 봉쇄(BEFORE 가드 전 자격 강제 + AFTER 트리거 무료 usage thread_id 원자 소비 + 구버전 standalone usage no-op) · 1-2 콘텐츠 없는 answered 거부 + 멘토 첫 콘텐츠 self-gating answered exactly-once(AFTER) · 1-3 업로드 자격에 양방향 차단. 가드=INVOKER, answered 헬퍼=self-gating DEFINER. | 적용됨 |
| `145` | `145_p1_13_anomaly_persistence.sql` | 1-5 금융 anomaly 영속. service-role 전용 `subscription_checkout_anomalies`(RLS deny). `confirm_subscription_checkout` 가 불일치를 RAISE 대신 anomaly INSERT + `{ok:false,code,anomaly_id}` 반환(금융 변경 0, anomaly 만 커밋). 금융 write 도중 오류는 subtransaction 롤백 후 anomaly 기록. 웹은 data.ok 검사. | 적용됨 |

- 검증: **144** rollback-only(직접 소비·4th 거부·legacy no-op·status-only 거부·멘토 콘텐츠 answered exactly-once·RPC 무영향) PASS. **145** rollback-only(happy·ledger tamper→anomaly+금융불변·succeeded-no-sub anomaly) PASS + **committed 별도 트랜잭션 영속성 검증 후 합성데이터 정리**(anomalies/payments/users 0 복원).
- **1-6(P1-13 race)**: 143 에서 이미 충족(mentor_profiles FOR UPDATE 로 학생 간 cap 소비 직렬화 + advisory pair lock + uq_subscriptions_pair UNIQUE/ON CONFLICT, 고정 잠금 순서). 독립 2세션 실측만 debt.
- **1-4(pending refund billing-event 정본 FK)**: refunds 에 billing_event_id 정본 컬럼 없음 → 현행 subscription_id+request_type 기준(142) 유지, billing-event 정본 FK 는 refund 생성 경로(069 등) 조사·수정 필요 = 후속(아래 Phase 상태 참조).

### 146 / 147 / 148 / 149 / 150 (v2 Phase2 + Phase1 후속 — staging)

| 번호 | 정본 파일 | 내용 | staging |
|---|---|---|---|
| `146` | `146_p2_1_avatar_document_crossref_diagnostic.sql` | **P2-24(=구 P0-3 라벨정정: 프로필 avatar·인증서류 분리) 진단(READ-ONLY, 미적용)**. avatar↔student_id 동일 객체 교차 ref 탐지만. 자동수정·삭제 금지. staging 실행 = 0행. | 미적용(진단) |
| `147` | `147_p2_2_community_board_idempotency_softdelete.sql` | **P0-4 게시판**: `community_posts.create_idempotency_key` + `(author_id,key)` UNIQUE(index) + `deleted_at` + 활성 부분 인덱스. 전부 IF NOT EXISTS. | 적용됨(no-op) |
| `148` | `148_p2_3_shortform_idempotency.sql` | **P0-3 숏폼**: `shortform_posts.create_idempotency_key` + `(author_id,key)` UNIQUE(index). IF NOT EXISTS. | 적용됨(no-op) |
| `149` | `149_p1_8a_storage_insert_eligibility.sql` | 질문 첨부 Storage INSERT 자격 게이트(qra_path_upload_eligible). | 적용됨 |
| `150` | `150_p1_13_refund_billing_event_fk.sql` | `refunds.billing_event_id` FK + live-refund 판정 정밀화. | 적용됨 |

> **PR #44 실험 번호 → 정본 수렴 기록**: 임시 stacked PR #44 가 게시판/숏폼 멱등키·soft-delete 구조를 실험 번호
> `144_community_shortform_idempotency_softdelete.sql` 로 **staging 에 선(先)적용**했다. 정본(PR #42)은 그 구조를
> **정본 번호 `147`(게시판)·`148`(숏폼)** 로 재작성해 수렴한다. 두 정본 파일은 전부 `IF NOT EXISTS`·동일 객체명
> (`community_posts_author_idem_key`·`idx_cp_active_created`·`shortform_posts_author_idem_key`)이라 **staging 은
> 재실행해도 no-op**(구조·이름 동일). PR #44 의 `144_...` 실험 파일은 정본에 가져오지 않는다(수퍼시드). PR #44 는 close.

### 151 / 152 (v2 Phase3·Phase4 — staging 적용됨, 기능 플래그 OFF)

| 번호 | 정본 파일 | 내용 | staging |
|---|---|---|---|
| `151` | `151_p1_10_account_deletion_saga.sql` | **P1-10 회원탈퇴 saga**(플래그 OFF): `account_deletion_jobs` 상태기계 + write-gate 트리거(지갑/결제/질문/커뮤니티 + Storage INSERT conjunct) + 상태전이 RPC. **0 job 이면 write gate 무영향**. 실 삭제 없음(dry-run). | 적용됨 |
| `152` | `152_p1_11c_notification_delivery_worker.sql` | **P1-11C**: `device_tokens`(RLS·재소유) + `notification_deliveries`(토큰별 UNIQUE) + `notification_settings`(RLS·P2-17) + claim(SKIP LOCKED·lease)/reclaim/backoff·dead-letter/설정강제 fan-out RPC. 실 FCM 없음(worker dry-run). | 적용됨 |
| `157` | `157_p1_11_subscription_notification_atomization.sql` | **P1-11**: 구독 4종 알림 원자화 트리거(예고 마커·renewal 성공/실패 전이·expired 전이) + 표시 헬퍼 4종. 132/064/068 이후 적용, 158/159 선행. | 적용됨(2026-07-20) |
| `158` | `158_p1_11_mentor_notification_atomization.sql` | **P1-11**: 멘토 4종 알림 원자화 트리거(terminating/paused fan-out·suspended 환불·가격 변경 fan-out). 157 이후. | 적용됨(2026-07-20) |
| `159` | `159_p1_11_custom_request_notification_atomization.sql` | **P1-11**: 맞춤의뢰 2종 알림 원자화 트리거(새 지원서·주문 메시지). 157 이후. | 적용됨(2026-07-20) |
| `160` | `160_p1_11_notification_helper_acl_hardening.sql` | **P1-11 후속**: 157 표시 헬퍼 2종 anon/authenticated EXECUTE revoke(기본 권한 노출 표면 제거). 157 이후. | 적용됨(2026-07-20) |

> 두 파일 모두 신규 객체만 추가(기존 무수정). 151 write gate·152 worker 는 각각 rollback-only fixture 로 staging 검증(전이·취소·gate·claim/lease/설정/invalid-token/dead-letter). production 배포는 각 기능 플래그 ON 시점.

### 141 / 142 / 143 (P1-8A/P1-13 최종 보안·금융 마감 감사 — staging 적용됨)

| 번호 | 정본 파일 | 내용 | staging |
|---|---|---|---|
| `141` | `141_p1_8a_direct_write_guards.sql` | 앱 호환 direct-write 우회 방어. 판별: qna_* RPC(owner=postgres)는 `current_user='postgres'`, 직접 write 는 `'authenticated'` → **SECURITY INVOKER** 가드 트리거로 구분. `question_threads`(role-correct status/first_answered/wrong 전이) · `question_messages`/`question_attachments`(종료 스레드·경로/owner 위조) 직접 write 거부. 업로드 INSERT 정책에 계정 활성+멘토 승인 추가. | 적용됨 |
| `142` | `142_p1_8a_pending_refund_lock.sql` | pending-refund lock 즉시 연동. create(구독 경로)·student append·student attachment 는 활성 구독 `FOR UPDATE` 후 별도 statement 로 두 canonical 유형(subscription_prorated/subscription_mentor_suspended) live pending refund 검사 → 있으면 거부. 무료·멘토 미적용. | 적용됨 |
| `143` | `143_p1_13_state_machine_hardening.sql` | `confirm_subscription_checkout` 완전성: pair advisory xact lock(빈 pair 봉쇄)+UNIQUE/ON CONFLICT · 학생활성·멘토승인·cap(신규/재활성)·payment kind·mentor 존재 게이트 · 성공/원장 **전필드** 멱등(user_id·ref_type·ref_id·delta·reason·idem_key) · succeeded인데 구독/원장 불일치 시 구조화 실패 격리(부분커밋 없음). | 적용됨 |

- 검증(rollback-only, 전부 PASS, baseline 복원): **141** RPC 무영향·student fake answered 거부·종료 스레드 메시지 거부·직접 owner/경로 위조 거부. **142** create/student-append pending-refund 거부·무refund 정상·멘토 무영향. **143** happy·전필드 멱등·ledger tamper 격리·succeeded-no-sub 격리·정지학생/미승인멘토/cap초과/비구독kind 거부.
- **최종 판정**: **P1-8A = `IMPLEMENTED_WITH_CONCURRENCY_DEBT`** (Storage OR-우회 0, 직접 write 우회 서버 트리거로 봉쇄, pending-refund 연동 완료; 독립 2세션 first-answered/한도 경쟁 실측만 부채). **P1-13 = `IMPLEMENTED_WITH_CONCURRENCY_DEBT`** (구조적 잠금: pair advisory lock + uq_subscriptions_pair UNIQUE/ON CONFLICT 검증; 독립 2세션 실측만 부채). Part 5 dead-code 제거로 eslint warning 0.
- 잔여 노트: P1-13 가격은 mentor_plans 정본만 사용(미가격 플랜 멘토 명시적 오류=배포 전 검증). pending-refund 는 refunds.subscription_id+request_type 기준(P1-13 billing-event 정본 확정 시 last_billing_event_id helper 로 교체 가능). direct 정책·open→pending 최종 제거 = P1-8B(WAITING_EXTERNAL_APP).

## 7. 클린 DB 재현 검증 (2026-07-30 — 후보 C PASS)

검증 환경: **Supabase CLI 2.110.0 / PostgreSQL 17.6** (fresh local stack, `supabase db reset` 후 순차 적용).

- 정규 적용 후보: **175개** (§3 제외 15개를 뺀 `supabase/sql/*.sql`. 목록 산정·포함 근거는 `sql_apply_manifest.md` §clean-install 적용 집합).
- 결과: **175/175 적용 성공.** 마지막 파일 = `183_p1_10_account_deletion_verify_object_owners.sql`.
- 게이트: **G0·G1·G2_STRUCTURAL_REPLAY·G3·G4 PASS / G5 완료.**
- 후보 이력: 178개(=175 + `002_app_core_schema_draft` + `153` + `156`)는 002 중복 정의로 실패 → 177개(002 초안 제외)는 `153`의 지급 객체 부재로 실패 → **175개(`153`·`156` 추가 제외) 전건 PASS = 후보 C 정본**. 상세는 `sql_apply_manifest.md` §후보 검증 이력.
- 적용 후 대조(운영·재검증 시): `docs/audit/db_permission_audit_queries.sql` 실행 → `docs/audit/db_expected_state.md` 대조. 클린설치 리뷰 정본 = 교정 `042` → `123` → `126`(§4).
- 판정: `MANIFEST_POLICY_CLASSIFICATION_DEBT: RESOLVED` · `SAFE_TEST_ENV_UNAVAILABLE: RESOLVED` · `Data API baseline: RESOLVED` · `G0~G5: PASS` · `READY_FOR_S2_2_GO: YES` — 단 `READY_FOR_S2_2_GO`는 M0~M17 구현 브랜치·migration version 배정에 착수할 수 있다는 의미이며, **운영 DB 적용 승인이나 제품 배포 완료를 의미하지 않는다.**

## 8. 001–183 정본 순서 (요약)

- **001–085:** 시작 순서(고정, §4): `001` → `002_p0_subscriptions_questions_draft` → `003_p0_custom_request_draft` → `002_custom_request_orders_status` → 이후 정본 순서. `002_app_core_schema_draft` 는 실행하지 않는다(§3). 나머지는 `docs/audit/sql_apply_manifest.md`의 「전체 SQL 파일 목록」·「Fresh DB 권장 적용 흐름」·「숫자 접두어 중복」표를 그대로 사용(파일별 의존 주석 포함). 본 문서 §3·§4 예외를 우선 적용. 039 감사·071 one-off 제외.
- **086–104:** 숫자순. 금융/에스크로/개별질문/구독 후속(086 정산항목, 088 주문상태전이 RPC, 090 맞춤의뢰 5%, 091 개별질문 환불 래퍼, 094 IQ 가격, 095 구독 15%, 096 IQ 15%, 098 주간사용량 생성시집계, 099 구독환불 settlement-paid 가드, 101 댓글 관리자 모더레이션, 102 계정상태, 103 멘토 활동정지, 104 경고). one-off·DRAFT 없음.
- **105–114:** 지급 스택(§5 게이트 = `105~111·114`) 제외 + 정규(112·113)만 순차 적용.
- **115–121:** 숫자순 **전건 정규 포함**(115 계정삭제, 116 차단 — 기능 플래그와 무관하게 스키마 포함(§3), 117 첨부 v2 백필, 118 이미지 ref 백필, 119 users role 가드, 120 관리자 콘솔, 121 멘토 플랜 밴드 클램프).
- **122–126, 129:** staging 수동 적용 완료(권위 = `sql_apply_manifest.md` 하단 표). 클린설치 시 122 → (교정 042) → 123 → 124 → 125 → 126 → 129 순, 리뷰 정본 수렴 규칙 준수.
- **127:** 예약(미생성) · **172:** 결번. 구 예약 `128·130·131`은 생성·적용됨(§6 해소 경과 참조) — 정규 순번으로 포함.
- **130–183:** 숫자순. 단 §3 제외 반영 — `146`(READ-ONLY 진단)·`153`·`156`(지급 게이트 후속) 제외, `167~169` 포함(§3), 클린설치 시 `132`(outbox) 는 `136` 이전 선행(§6). 정규 적용의 마지막 파일 = `183_p1_10_account_deletion_verify_object_owners.sql`. `184`는 운영 시드로 정규 집합 제외(§3).

> 이 문서는 순서·정책의 정본이고, 파일별 1줄 설명·중복 근거의 상세는 `sql_apply_manifest.md`가 보조한다. 두 문서가 다르면 **순서·정책은 본 문서**, **파일별 상세는 sql_apply_manifest.md**가 정본이다.
