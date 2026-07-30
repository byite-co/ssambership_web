# S2-4 — MC `comments.author_label` baseline convergence 구현·PG17.6 로컬 왕복 검증 (2026-07-31)

> **세션 성격:** 구현·로컬 검증 세션. S2-3 P0 D-1 해소 계약(C안)을 재량 없이 SQL 로
> 이식하고, 격리 로컬 PostgreSQL 17.6 에서 clean-install 192 · 원격 드리프트 fixture ·
> rollback 왕복·거부 경로를 전건 검증했다. **원격 DB 접근 0** (staging·production
> SELECT 포함 전무) · `apply_migration` 0 · Data API/schema cache 변경 0 · 웹·앱 제품
> 코드 변경 0 · 기존 SQL/계약/manifest 문서 수정 0 · 배포 0 · PR 0.
> 이 세션의 산출물은 **로컬 정본**이며, 원격 적용은 R0(특히 ③ 스냅샷·⑦ 오너 결정표
> #16 승인) 통과 후의 후속 세션 소관이다.

---

## 1. Scope and Repository Ownership

| 항목 | 값 | 판정 |
|---|---|---|
| 주 작업 저장소 | `byite-co/ssambership_web` (`git remote -v` 실측) | **G0 PASS** |
| 기준 브랜치 | `claude/s2-3-p0-d1-comments-author-label-contract-20260731` — checkout·`pull --ff-only` 후 HEAD `8913eea023e102bef199c9dd0020fa1b6064587a` · worktree clean | **G1 PASS** |
| 작업 브랜치 | `claude/s2-4-comments-author-label-baseline-convergence-lnk6xs` — 기준 커밋 `8913eea` 에서 생성. 지시서 명칭 `…-20260731` 은 하네스 세션 브랜치명으로 매핑됨(원격 동명 브랜치 부재 실측 — 덮어쓰기·force push 0) | **G2 상당 PASS** |
| 앱 저장소 | `byite-co/ssambership-app` | **NOT_ACCESSED** (S2-3 APP_COMPATIBILITY PASS 확정 — 재검증 불요, 충돌 신규 증거 0) |
| 원격 DB | — | **NOT_ACCESSED** (SELECT 포함 접근 0 — 전 검증은 로컬 스크래치 클러스터) |

## 2. Base Canon

| 입력 | 확인 |
|---|---|
| S2-3 계약 문서 `docs/audit/s2_3_p0_d1_comments_author_label_remote_drift_contract_20260731.md` | 실존·**506행** 일치. §10~§17 을 구현 기준으로 사용 |
| M1 forward `20260730095435_api_web_v1_schemas.sql` | SHA-256 `97e7f6c28442b96415753b8b8caace7c28d5d393ca57b8d79f2faf5d89de4912` — S2-2 §2.1 정본과 일치·**바이트 무수정** |
| M13 forward `20260730095438_comments_author_label_denormalize.sql` | SHA-256 `4d035c88c17030a5df3574fc7dee7768bfd2809255a47ad087edf1c4676b94ac` — 일치·무수정 |
| M4 forward `20260730095441_api_web_v1_read_views.sql` | SHA-256 `301f44beea6805dd143ae3a04ac282b52e905a3e123d865c09399b318a33637e` — 일치·무수정 |
| M1/M13/M4 rollback 3종 | `3834a675…` · `0d0058df…` · `97a368ac…` — S2-2 §2.2 정본과 전건 일치·무수정 (**G3 PASS — CANONICAL_SQL_DRIFT 없음**) |
| 변경 전 물리 무결성 | `node scripts/verify/sql_number_integrity.mjs` — legacy 190 · 제외 15 · S2 forward 16 · rollback 15 · 총 206 · clean-install 191 **PASS** (**G4 PASS**) |

## 3. Fixed MC Timestamp Exception

- MC 물리 timestamp = **`20260730095436`** (파일 stem `20260730095436_comments_author_label_baseline_convergence`).
- 순서 불변식 **M1(20260730095435) < MC(20260730095436) < M13(20260730095438) < M4(20260730095441)** 충족 — clean-install glob·ledger 정렬 모두에서 MC 가 M13 앞.
- 저장소 전체 충돌 검사: 동일 timestamp·stem 파일 0 (S2-3 문서의 권고 기재 1건뿐 — **MC_TIMESTAMP_COLLISION 없음**).
- **이는 기존 timestamp 정책(물리 정책 §5 `supabase migration new` 채번)의 일반 변경이 아니다. S2-3 P0 D-1 해소 계약 §10 이 지정한 과거 삽입 슬롯의 일회성 고정값이며, MC 단일 삽입 예외다.** 현재 시각 채번은 M13 뒤 timestamp 를 생성해 정본 순서를 위반하므로 사용하지 않았다.

## 4. Changed File Inventory (정확히 5개 — 허용 목록 일치)

| # | 파일 | 구분 |
|---|---|---|
| 1 | `supabase/sql/20260730095436_comments_author_label_baseline_convergence.sql` | 신규 (MC forward, 133행) |
| 2 | `supabase/rollback/20260730095436_comments_author_label_baseline_convergence_rollback.sql` | 신규 (MC rollback, 146행) |
| 3 | `scripts/verify/s2_4_comments_author_label_baseline_convergence_verify.sql` | 신규 (MC 전용 검증기, 341행) |
| 4 | `docs/audit/s2_4_comments_author_label_baseline_convergence_local_verification_20260731.md` | 신규 (본 문서) |
| 5 | `scripts/verify/sql_number_integrity.mjs` | 수정 (MC 등록·산식 갱신 — 기존 검사 약화 0) |

기존 SQL·계약·manifest·S2-2/S2-3 감사 문서·웹/앱 제품 코드 변경 **0**.

## 5. Forward Implementation

단일 트랜잭션 · `set local lock_timeout = '5s'` · 대상 `public.comments.author_label` 단독 ·
DML 0 · 다른 컬럼/함수/트리거/정책/인덱스/GRANT 접촉 0 · `community_comments` 접촉 0 ·
column comment 0 · `NOTIFY` 0 · `IF NOT EXISTS` 은닉 0.

- **테이블 게이트:** `public.comments` 부재 → `BATCH_B_BASELINE_OBJECT_MISMATCH` 중단.
- **상태 분기(S2-3 §11 그대로):**
  - **S1** (author_label 부재 ∧ author_role 부재): `ALTER TABLE public.comments ADD COLUMN author_label text NOT NULL DEFAULT '쌤버십 회원';` 정확히 1문장. author_label 부재 ∧ author_role 존재는 부분 M13 상태로 간주해 자동 수정 없이 중단.
  - **S2** (text·NOT NULL·`'쌤버십 회원'::text`·author_role 부재·비generated/identity): NOTICE 후 no-op.
  - **S3** (text·NOT NULL·`'쌤버십 사용자'::text`·author_role 존재): NOTICE 후 no-op — default 되돌림·author_role 삭제·M13 객체 접촉 절대 없음.
  - **S4** (타입 ≠ text): 수정 0건 중단 — 강제 변환 없음.
  - **S5** (그 외 — nullable·default 부재/예상 밖·부분 M13·generated/identity): 수정 0건 중단 — 자동 보정 없음.
- **post-check:** commit 직전 (A) baseline 정본 ∧ author_role 부재 또는 (B) M13 후 형상 ∧ author_role 존재 중 하나가 아니면 `S2_MC_SELFCHECK` 예외 → 전체 rollback (식별자는 M13 의 `S2_M13_SELFCHECK` 관행을 따른 자가검증 전용 — 게이트 오류 식별자는 정본 `BATCH_B_BASELINE_OBJECT_MISMATCH` 재사용, 신규 게이트 식별자 채번 0).

## 6. Rollback Implementation

등급 **CONDITIONAL** · 단일 트랜잭션 · `lock_timeout 5s` · 실패 시 수정 0건.

- **적용 가능 전제(헤더 절차 규칙):** MC 적용 전 `comments.author_label` 이 **부재**했던 DB 한정. clean-install 처럼 컬럼 선재 DB 에서는 실행하지 않으며, 운영 실행은 R0 ③ 스키마 스냅샷으로 pre-state 부재가 증명된 경우에만 허용.
- **M13 원장 이력 방어(우선 평가):** `supabase_migrations.schema_migrations` 조회 가능 시 `version='20260730095438'` 또는 name(스템/전체 스템 두 표기) 매칭 행 존재 → `BATCH_B_BASELINE_OBJECT_MISMATCH: M13_APPLIED_FORWARD_FIX_ONLY` 로 거부 — **M13 rollback 선행 여부와 무관**. 원장 스키마가 없는 환경은 구조 하드게이트가 독립 차단하며, 이 경우에도 M13 이력 유무를 추정 PASS 처리하지 않는다(운영은 원장 실측 선행).
- **no-op 게이트:** 컬럼 이미 부재 → NOTICE 후 no-op.
- **구조 하드게이트(전건 충족 시에만 DROP):** ① author_role 부재 ② M13 함수 2종·트리거 4종 부재 ③ `api_web_v1.community_comments_v1` 부재 ④ author_label = text·NOT NULL·`'쌤버십 회원'::text` ⑤ 전 행 `author_label = '쌤버십 회원'` (비default·NULL·빈 문자열 1행이라도 있으면 거부).
- **동작:** `ALTER TABLE public.comments DROP COLUMN author_label;` (RESTRICT) 후 컬럼 부재 자가검증.

## 7. SQL Integrity Delta (`scripts/verify/sql_number_integrity.mjs`)

- Batch B 순서 검사: `M1 < M13 < M4` → **`M1 < MC < M13 < M4`** (MC 등록 — id `MC`, stem `comments_author_label_baseline_convergence`, rollback required).
- 산식: S2 forward 16→**17** · rollback 15→**16** · 총수 206→**207** · clean-install 191→**192** (= 190 − 15 + 17).
- 유지된 불변 검사(약화·삭제 0): 레거시 190 불변 · 제외 15 불변 · 신규 번호 중복 0 · timestamp 중복 0 · `supabase/migrations/` 잔존 0 · forward:rollback 1:1 · M10 rollback 0 · rollback 의 `supabase/sql` 배치 금지 · 허용 밖 S2 stem 거부 · batch 내/간 순서.
- 변경 후 실행 결과: **PASS** (forward 17 · rollback 16 · clean-install 192).

## 8. PG17.6 Environment

- 정본 검증 클러스터: **PostgreSQL 17.6** (`show server_version` = `17.6` 실측). 바이너리 출처: npm `@embedded-postgres/linux-x64@17.6.0-beta.15` (컨테이너에서 Supabase 공식 이미지 `postgres:17.6.1.143` pull 이 프록시 정책으로 차단되어 동일 PG 17.6 순정 바이너리로 대체 — 외부 차단 우회 0).
- 격리: 세션 컨테이너 내 일회용 스크래치 클러스터(unix socket · port 55432) — 원격 연결 0, 세션 종료 시 폐기.
- 플랫폼 기반 재현(스크래치 전용 스텁 — 저장소 무반입): Supabase roles(anon/authenticated/service_role/authenticator) · `auth` 스키마(users, uid/role/jwt/email) · `extensions`+pgcrypto · `storage`(buckets/objects/foldername) · `supabase_realtime` publication · `supabase_migrations.schema_migrations` 원장(패치 fixture 용). auto-expose OFF(신규 클라우드 기본) — 물리 정책 §9.7 선례와 동일 조건. Batch F 적용 전 「운영 baseline 재현」(3테이블 GRANT ALL−MAINTAIN + 한글명 정책 2종 + community_posts service_role grant — Batch F 검증기 헤더 절차) 1회 수행.
- psql 클라이언트는 시스템 16.13 — 판정은 전부 서버측 SQL 로 수행(서버 17.6 이 권위). PG16 재현(S2-3 §8.2)은 참고 자료로만 취급했고 본 세션 정본 검증을 대체하지 않았다.

## 9. Clean-Install 192 Result (Scenario A)

fresh DB → 플랫폼 스텁 → **baseline 후보 C 175/175** (시작 고정 순서·033 이동·중복 규칙 — `apply_manifest_prod.md` §2~§4) → Batch A 2 → M1 → **MC(#179)** → M13 → M4 → Batch C·D·E 7 → 운영 baseline 재현 → Batch F 4(M10 assertion 포함) = **192/192 전건 적용 성공**.

- MC 는 **S2 분기 NOTICE 후 no-op** (clean-install 경로 — 037 author_label 선재).
- MC 적용 전후: comments 컬럼 형상 md5·전행 데이터 md5·트리거/정책/인덱스 md5 **완전 동일** (MC 검증기 phase `post_s2` 2/2 PASS).
- M13·M4 정상 COMMIT · **기존 `s2_2_batch_b_verify.sql` forward 39/39 ALL PASS** (fixture 잔여 0).
- 최종 M10(`contract_permission_assertions`) assertion **PASS** (192번째 파일로 무오류 COMMIT).
- clean-install pre-state 는 author_label **선재**이므로 MC rollback 은 실행하지 않았다:
  **`MC_ROLLBACK_CLEAN_INSTALL: NOT_EXECUTED_PRESTATE_PRESENT`**

## 10. Remote Drift Fixture Result (Scenario B)

S2-3 §3.1 실측 형상 재현: baseline+Batch A+M1 위에서 `public.comments` 를 외과 변형 —
`author_label`·`updated_at` 부재 · `comments_content_len_chk` 부재 · `post_id/author_id/like_count/is_deleted/created_at` nullable · `author_id` FK 대상 `auth.users`(CASCADE) → 컬럼 집합
`id,post_id,author_id,parent_id,content,like_count,is_deleted,created_at,legacy_comment_id`
정확히 9컬럼. 데이터는 **합성 fixture 만**(comments 3행 직접 INSERT 기원·legacy_comment_id NULL 0행 · community_comments 4행 = board 3 default label + shortform 1 — §3.2 집계 정합. 사용자 개인정보·원격 실값 복제 0). 브리지 미러는 fixture 구성 중 `app.comment_sync` 스위치로 차단해 「직접 INSERT 기원」 상태를 재현했다. (잔여 차이 기록: 외과 변형 특성상 pg_attribute attnum 에 dropped-column 공백이 남아 ordinal 값은 원격과 다르다 — MC·M13·M4 는 ordinal 을 참조하지 않아 판정 무영향.)

| 단계 | 결과 |
|---|---|
| MC 적용 | **S1 분기 — 컬럼 추가** NOTICE. 행 3→3 · 비대상 9컬럼 md5 동일 · 트리거/정책/인덱스 md5 동일 · 형상 text NOT NULL `'쌤버십 회원'::text` · author_role 부재 · **updated_at 미생성**(out-of-scope 불가침) — MC 검증기 `post_s1` **4/4 PASS** |
| MC post-check | A 형상으로 통과(파일 내장 자가검증) |
| M13 적용 | **무오류 COMMIT** — default `'쌤버십 사용자'::text` 정정 · author_role 추가 · 백필 결과 `드리프트닉1/student · 드리프트닉2/mentor · (공백닉)→쌤버십 사용자/student` — M13 규칙 정확 일치 · 행 수 불변 |
| M4 적용 | **무오류 COMMIT** — `api_web_v1.community_comments_v1` 생성 |
| MC 재적용 | **S3 분기 no-op** — default `'쌤버십 사용자'` 유지 · author_role/M13 함수 2종·트리거 4종 정의 md5 불변 · catalog·data 불변 — MC 검증기 `post_s3` **3/3 PASS** |

기존 Batch B verifier 는 canonical baseline 의 `updated_at` 포함 hash 를 전제하므로 Scenario A 에서 판정했고, Scenario B 에서 `updated_at` 을 임의 추가하지 않았다(MC 전용 검증기도 해당 컬럼 존재를 가정하지 않음 — 전행 비교는 `to_jsonb` 동적 캡처).

## 11. S1~S5 State Matrix (전건 실측)

| 분기 | fixture | 기대 | 실측 | 판정 |
|---|---|---|---|---|
| S1 | 드리프트(부재+role 부재) | ADD COLUMN 1문장 | 추가·불변식 4종 PASS (B·C 재현 2회) | **PASS** |
| S2 | clean-install(A) · 수렴 후 재실행(C) | no-op | NOTICE 확인·catalog/data md5 동일 | **PASS** |
| S3 | M13 적용 후(B) | no-op·default 유지 | NOTICE 확인·`'쌤버십 사용자'` 유지·M13 객체 md5 불변 | **PASS** |
| S4 | author_label `varchar(120)` | 거부·수정 0 | P0001 `BATCH_B_BASELINE_OBJECT_MISMATCH`·catalog/data 불변 | **PASS** |
| S5-nullable | text NULL default 정본 | 거부·수정 0 | 동일 식별자 거부·불변 | **PASS** |
| S5-bad_default | text NOT NULL `'다른기본값'` | 거부·수정 0 | 동일 | **PASS** |
| S5-partial_m13 | label 부재+author_role 존재 | 거부·수정 0 | 동일(부분 M13 메시지) | **PASS** |

## 12. Rollback Gate Matrix (전건 실측 — 각 fixture 독립 초기화)

| 게이트 | fixture | 기대 | 실측 | 판정 |
|---|---|---|---|---|
| 정상 경로 (RB-01·02) | 드리프트+MC (pre-M13·pre-state 부재) | DROP 성공·완전 왕복 | 성공 — 부재 복원·catalog/data/trg/pol/idx md5 가 MC 이전 기준선과 **완전 일치** | **PASS** |
| RB-03 비default 라벨 행 | 1행 `'변조라벨'` | 거부 | 거부·수정 0 | **PASS** |
| RB-04 author_role 존재 | 컬럼 추가 | 거부 | 거부·수정 0 | **PASS** |
| RB-05 M13 함수 | 동명 stub 함수 | 거부 | 거부·수정 0 | **PASS** |
| RB-05b M13 트리거 | 동명 트리거(함수 검사와 독립 격리) | 거부 | 거부·수정 0 | **PASS** |
| RB-06 M4 View | `community_comments_v1` stub | 거부 | 거부·수정 0 | **PASS** |
| RB-07 M13 ledger | 원장 행 `20260730095438/comments_author_label_denormalize` | 거부 | `M13_APPLIED_FORWARD_FIX_ONLY` 거부·수정 0 | **PASS** |
| RB-03b 형상 불일치 | NOT NULL 훼손 | 거부 | 거부·수정 0 | **PASS** |
| RB-08 재실행 no-op | rollback 완료 상태 재실행 | NOTICE no-op | no-op·catalog/data 불변 | **PASS** |

**Scenario C 왕복:** 부재 → (MC) 정본 컬럼 → (rollback) 부재 → (MC) 정본 컬럼 → (MC) no-op — 각 단계 행 수·비대상 컬럼·트리거·정책·인덱스 불변 확인.

**Scenario E (M13 이후 forward-fix only):** 드리프트 → MC → M13(+원장 fixture 행) → **M13 rollback 정본 파일 성공**(author_role 제거·default `'쌤버십 회원'` 복원·정규화 라벨 데이터 보존) → **MC rollback 시도 = 원장 이력 방어로 거부**(M13 rollback 선행에도 불구) → author_label 컬럼·정규화 라벨(`드리프트닉1,드리프트닉2,쌤버십 사용자`) **보존 실측**.

## 13. M13→M4 Chain Result

- Scenario A(clean-install): MC(S2 no-op) → M13 → M4 정상 — Batch B verifier 39/39.
- Scenario B(드리프트): MC(S1 수렴) → **M13 게이트 ①~⑤ 통과·무오류 COMMIT** → **M4 게이트 통과·V2 생성** → MC 재실행 S3 no-op. S2-3 §8 의 차단 기전(게이트 ① P0001)이 MC 로 해소됨을 정본 PG17.6 에서 재확증.

## 14. Batch B Verification Result

`scripts/verify/s2_2_batch_b_verify.sql` (무수정) — Scenario A 에서 M4 적용 직후 forward phase 실행: **39/39 ALL PASS · fixture 잔여 0** (M1 경계 5 · T-M13-01~14 · M4 V1~V5 19 항목 전건). 러너 GUC 스냅샷은 검증기 정본 표현식과 문자 그대로 동일하게 M13 직전 캡처.

## 15. Manifest Delta (append-only — 기존 manifest 문서 무수정)

본 절이 MC 에 대한 append-only manifest delta 정본이다. `docs/audit/sql_apply_manifest.md` ·
`docs/audit/apply_manifest_prod.md` 는 당시 191 정본의 역사 기록으로 유지한다.

### 15.1 파일 정체성

| 항목 | 값 |
|---|---|
| logical_id | **MC** |
| forward file | `supabase/sql/20260730095436_comments_author_label_baseline_convergence.sql` |
| forward basename | `20260730095436_comments_author_label_baseline_convergence.sql` |
| forward SHA-256 | `e46cde0106b1d3d8429d30fb73129ea17a3f2d737586153c1bf1630a691f1e12` |
| rollback file | `supabase/rollback/20260730095436_comments_author_label_baseline_convergence_rollback.sql` |
| rollback basename | `20260730095436_comments_author_label_baseline_convergence_rollback.sql` |
| rollback SHA-256 | `2c9067b7681dd8a47a30215b8e10dc419ebbe3e67388ea5e37f30c7dc51c39a1` |

### 15.2 적용 순서

Forward 전건: **M0 → M15 → M1 → MC → M13 → M4 → M5 → M6 → M7 → M17 → M8 → M14 → M9 → M11 → M12 → M16 → M10**.

Rollback 역순 중 Batch B 구간: **M4 → M13 → MC → M1** — 단, **M13 적용 이력이 존재하면 MC rollback 실행 금지**(원장 방어 + 구조 하드게이트가 자기방어).

### 15.3 산식

기존 baseline **175** + S2 forward **17** = 최종 clean-install **192**. S2 rollback **16**(M10 없음) — rollback 은 clean-install 불포함.

### 15.4 환경별 상태 (본 세션 종료 시)

| 환경 | 상태 |
|---|---|
| LOCAL | **LOCAL_PASS** |
| STAGING | **UNAPPLIED** |
| PRODUCTION | **UNAPPLIED** |

ledger version 은 원격 적용 전 예측·기입하지 않는다. ledger name 만 고정: **`20260730095436_comments_author_label_baseline_convergence`**.

## 16. SHA-256 Inventory (본 세션 산출·수정분)

| 파일 | SHA-256 |
|---|---|
| `supabase/sql/20260730095436_comments_author_label_baseline_convergence.sql` | `e46cde0106b1d3d8429d30fb73129ea17a3f2d737586153c1bf1630a691f1e12` |
| `supabase/rollback/20260730095436_comments_author_label_baseline_convergence_rollback.sql` | `2c9067b7681dd8a47a30215b8e10dc419ebbe3e67388ea5e37f30c7dc51c39a1` |
| `scripts/verify/s2_4_comments_author_label_baseline_convergence_verify.sql` | `1d87357a2e9b4bd82c5a0619718a4ab81b754c6be24d6548c73384105289594c` |
| `scripts/verify/sql_number_integrity.mjs` (수정 후) | `e62fa19e8cfad98c953888dc7260933f115558a6cc5934bac6a8cdcf404b2ac5` |

불변 대조(무수정 확인): M1 `97e7f6c2…` · M13 `4d035c88…` · M4 `301f44be…` · 대응 rollback 3종 — §2 표와 동일.

## 17. Remaining Remote Preconditions

원격 적용(후속 세션) 전 필수 선행 — 본 세션은 어느 것도 수행하지 않았다:

1. 오너 결정표 **#16** — S2-3 해소 계약(=MC) 승인.
2. **R0 ③** 스키마 스냅샷 — 특히 MC rollback 의 pre-state 부재 증명 캡처.
3. Data API 현재 설정 실측·백업(S2-2 §4 BLOCKED 항목) — MC 자체는 노출 목록 변경 0, 적용 직후 schema cache reload 필요(S2-3 §15 — `pgrst_ddl_watch` 자동 + `NOTIFY pgrst` 명시 이중 보장, **NOTIFY 는 MC 파일 밖 운영 절차**).
4. production 웹 Supabase project binding 확인 · backup/PITR 확인 · 구버전 스토어 앱 기준선 확인.
5. 적용 경로: `apply_migration` 단일 경로 · ledger name = §15.4 고정값 · 적용 직후 S2-3 §17.2 읽기 전용 체크리스트.
6. 비차단 잔여 드리프트(`updated_at` 부재·nullable 5컬럼·FK 대상·CHECK — S2-3 §10.1)는 본 수렴 범위 밖 — 오너 결정 사항으로 존속.

## 18. Project Progress and Remaining Work

- 세션 시작 전 완료 실행 단위 13개 → 본 세션(S2-4 MC 구현·로컬 왕복 검증) 완료로 **14개**.
- 활성 P0 결함(원격 `comments.author_label` 부재 → 배포 웹 댓글 읽기/쓰기 고장)은 **원격에 여전히 열려 있다** — 본 세션은 로컬 수복 정본(MC)을 완성했을 뿐 원격 적용을 하지 않았다: `PRODUCTION_WEB_COMMENT_DEFECT: STILL_OPEN_REMOTE` · `LOCAL_FIX_ARTIFACT_READY: YES`.
- 잔여 작업 순서: ① 웹·앱 브랜치 통합 및 배포 정본 확정 ② 앱 signed native build·최소 버전·구버전 차단 게이트 ③ Data API 실측·백업·최종 원격 적용 승인 ④ 운영 R0~R7 적용·배포·사후 검증 ⑤ (필요 시) iOS 파이프라인 ⑥ (필요 시) 앱스토어 제출·심사.
- 전체 진행도 재산정: 약 **94%** (시작 전 약 93% — MC blocker 1건 해소, 원격 적용·통합·빌드 미완).

## 19. Final Verdict

```
MC_TIMESTAMP: 20260730095436 (M1 < MC < M13 < M4 — PASS)
MC_FORWARD_IMPLEMENTATION: PASS
MC_ROLLBACK_IMPLEMENTATION: PASS (CONDITIONAL 등급 — 계약 §12 그대로)
MC_S1_ABSENT_ADD: PASS
MC_S2_BASELINE_NOOP: PASS
MC_S3_POST_M13_NOOP: PASS
MC_S4_WRONG_TYPE_REJECT: PASS
MC_S5_UNEXPECTED_SHAPE_REJECT: PASS (nullable·bad_default·partial_m13 전건)
MC_ROLLBACK_PRE_M13: PASS (완전 왕복 — 기준선 md5 일치)
MC_ROLLBACK_POST_M13_GUARD: PASS (원장 방어 — M13 rollback 선행에도 거부)
MC_DATA_PRESERVATION: PASS (행 3→3 · 비대상 md5 불변 · 정규화 라벨 보존)
MC_IDEMPOTENCY: PASS (S2·S3 no-op + RB-08 no-op)
POSTGRES_VERSION: 17.6 (정본 검증 전건)
PG17_6_CLEAN_INSTALL_192: PASS (192/192)
PG17_6_REMOTE_DRIFT_FIXTURE: PASS
M13_CHAIN: PASS  ·  M4_CHAIN: PASS
S2_BATCH_B_VERIFY: PASS (39/39 · 무수정)
SQL_NUMBER_INTEGRITY: PASS (legacy 190 · 제외 15 · forward 17 · rollback 16 ·
                            총 207 · clean-install 192)
MC_ROLLBACK_CLEAN_INSTALL: NOT_EXECUTED_PRESTATE_PRESENT
APP_REPOSITORY: NOT_ACCESSED  ·  REMOTE_DB: NOT_ACCESSED
PRODUCTION_WEB_COMMENT_DEFECT: STILL_OPEN_REMOTE
LOCAL_FIX_ARTIFACT_READY: YES
READY_FOR_REMOTE_FIX_AFTER_R0: YES
READY_FOR_REMOTE_APPLY: NO (승인·R0 선행 — §17)
READY_FOR_BRANCH_INTEGRATION: YES
FINAL_VERDICT: PASS
```

*작성: 2026-07-31 S2-4 구현 세션 — 변경 파일 정확히 5건(§4). 원격 DB·앱 저장소 접근 0 ·
검증은 세션 컨테이너 내 일회용 PG17.6 스크래치 클러스터(폐기)에서 수행.*
