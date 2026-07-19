# 운영 적용 정본 매니페스트 (apply_manifest_prod.md)

> **정본(Single Source of Truth)** — 클린설치·운영 배포 시 `supabase/sql/`를 적용하는 **유일한 정본 순서 문서**다.
> 결정 B(2026-07-19, 오너 확정): **번들 폐기 + 운영 apply manifest 방식**을 채택한다.
> 이 문서가 `supabase/bundles/*` 및 `supabase/sql/INDEX.md`보다 우선한다.
> 파일별 세부 판정·중복번호 근거는 동반 문서 `docs/audit/sql_apply_manifest.md`(상세 레퍼런스)를 참조한다.

## 0. 상태·범위

- 대상: fresh/clean 설치와 운영 배포의 적용 순서 정본.
- staging 실적용 이력(권위 있음): `123 · 124 · 125 · 126 · 129` — `docs/audit/sql_apply_manifest.md` 하단 표.
- `supabase_migrations` 원장은 저장소 파일 번호와 드리프트가 크므로 **운영 정의가 우선**하고, 수동 적용은 원장에 가짜 행으로 기재하지 않는다.
- **검증 부채:** 이 환경에는 `supabase` CLI가 없어 `supabase db reset` + 순차 적용의 **클린 DB 재현을 실행하지 못했다.** 이 부재는 코드·DRAFT 작성을 막는 HARD STOP이 아니다. 단, CLI 환경 확보 전에는 클린 DB 재현을 PASS로 기록하지 않는다(재현 명령은 §7).

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
5. **DRAFT(`[DRAFT — DB 미적용]`)·one-off·기능플래그·지급 스택은 정규 순차 적용에서 제외**(§3).
6. 수동 staging 적용은 성공 후에만 `sql_apply_manifest.md`에 기록.

## 3. 정규 적용 제외 (별도 게이트)

| 분류 | 파일 | 사유 |
|---|---|---|
| DRAFT 미적용 | `105 106 107 108 109 110` (지급 스택 초안) | `[DRAFT — DB 미적용]`. 지급 스택 게이트(§5)에서만 취급 |
| one-off 정리 | `071_individual_question_test_data_cleanup.sql` | 마이그레이션 아님. 운영/클린 적용 전 별도 승인 |
| Storage 감사 | `039_storage_buckets_private_audit.sql` | 점검 SQL(버킷 private 확인). 데이터 변경 아님 |
| 지급 스택 | `105 106 107 108 109 110 111 114` | 내부지갑 적립 모델·자금 코드 승인·독립 2세션 검증 전 운영 적용 금지(§5) |
| 예약(미생성) | `127 128 130 131` | §6 예약번호 — 파일 생성 전까지 순서에 없음 |

## 4. 순서 예외표 (숫자순 위반·의존)

| 파일 | 규칙 |
|---|---|
| `002_custom_request_orders_status.sql` | `003_p0_custom_request_draft.sql` 이후 |
| `033_p1_admin_reviews_moderation.sql` | `042_reviews_system.sql` 이후 |
| `033_question_threads_topic.sql`, `034_mentor_favorites.sql`, `032_*`, `039_*` 중복 | `sql_apply_manifest.md` §숫자 접두어 중복 표 기준 |
| `042_reviews_system.sql`(클린설치 교정본) → `123_reviews_converge.sql` → `126_reviews_rls_hardening.sql` | 리뷰 정본 수렴 순서. 클린설치는 교정 042 반영 후 123·126 순 |
| `053b`, `073`/`073b` | 대응 정규번호 직후 보정 |
| 지급 스택 적용 순서(게이트 승인 시) | `105 → 106 → 107 → 109 → 110 → 111 → 114 → 108` (§5) |

## 5. 지급 스택 (내부지갑 적립 모델) — 게이트

확정 적용 순서: **`105 → 106 → 107 → 109 → 110 → 111 → 114 → 108`**.

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

다음 신규 임의번호는 위 예약을 건너뛴 **`132`**부터.

## 7. 클린 DB 재현 (검증 부채 — 미실행)

`supabase` CLI 부재로 아래를 **실행하지 못함**. CLI 환경 확보 시 실행하고, 그 전에는 PASS로 기록하지 않는다.

```
# CLI 환경에서:
supabase db reset                       # 로컬 스택 초기화
# 본 문서 §2~§4 순서로 supabase/sql/*.sql 를 numeric+예외표 순 적용
#   (DRAFT·one-off·지급스택·감사 SQL 제외)
# 클린설치 리뷰 정본 = 교정 042 → 123 → 126
# 적용 후 docs/audit/db_permission_audit_queries.sql 실행 →
#   docs/audit/db_expected_state.md 대조
```

## 8. 001–129 정본 순서 (요약)

- **001–085:** `docs/audit/sql_apply_manifest.md`의 「전체 SQL 파일 목록」·「Fresh DB 권장 적용 흐름」·「숫자 접두어 중복」표를 그대로 사용(파일별 의존 주석 포함). 본 문서 §3·§4 예외를 우선 적용.
- **086–104:** 숫자순. 금융/에스크로/개별질문/구독 후속(086 정산항목, 088 주문상태전이 RPC, 090 맞춤의뢰 5%, 091 개별질문 환불 래퍼, 094 IQ 가격, 095 구독 15%, 096 IQ 15%, 098 주간사용량 생성시집계, 099 구독환불 settlement-paid 가드, 101 댓글 관리자 모더레이션, 102 계정상태, 103 멘토 활동정지, 104 경고). one-off·DRAFT 없음.
- **105–114:** 지급 스택(§5 게이트) + 정규(112·113). 순차 적용 대상에서 지급 스택 제외.
- **115–121:** 숫자순(115 계정삭제, 116 차단, 117 첨부 v2 백필, 118 이미지 ref 백필, 119 users role 가드, 120 관리자 콘솔, 121 멘토 플랜 밴드 클램프).
- **122–126, 129:** staging 수동 적용 완료(권위 = `sql_apply_manifest.md` 하단 표). 클린설치 시 122 → (교정 042) → 123 → 124 → 125 → 126 → 129 순, 리뷰 정본 수렴 규칙 준수.
- **127·128·130·131:** 예약(미생성).

> 이 문서는 순서·정책의 정본이고, 파일별 1줄 설명·중복 근거의 상세는 `sql_apply_manifest.md`가 보조한다. 두 문서가 다르면 **순서·정책은 본 문서**, **파일별 상세는 sql_apply_manifest.md**가 정본이다.
