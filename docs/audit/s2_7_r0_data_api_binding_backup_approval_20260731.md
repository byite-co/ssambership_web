# S2-7 / R0-A — Data API 현재값·Production Binding·Backup/PITR·원격 적용 승인 회부 정본

작성일: 2026-07-31 (UTC) · 세션 유형: **읽기 전용 조사 + 승인 회부 문서화** (원격 변경 0)

> 본 문서는 S2-7 세션의 유일한 tracked 산출물이다. 이번 세션에서 Supabase 원격 DB 쓰기·Data API 설정 변경·Vercel 변경·restore 실행·PR 생성·main 병합은 **0건**이며, 모든 원격 조회는 SELECT·플랫폼 메타데이터 읽기·라이브 서비스 무해 프로브로 한정했다. secret 원문(anon/publishable key·service_role key·DB password·connection string·토큰)은 본 문서와 커밋에 일절 기록하지 않는다.

---

## 1. Scope and Repository Ownership

| 항목 | 값 |
|---|---|
| 주 작업 저장소 | WEB — `byite-co/ssambership_web` |
| 기준 브랜치 | `claude/s2-5-release-integration-canon-1cn8wi` |
| 기준 커밋 | `79ac1d795a3b6257b01d01493a934327ca2b2e92` (실측 일치) |
| 신규 작업 브랜치 (실제) | `claude/s2-7-r0-data-api-binding-backup-approval-ymbmas` |
| 권고 브랜치명 (과제 명세) | `claude/s2-7-r0-data-api-binding-backup-approval-20260731` |
| 앱 저장소 | `byite-co/ssambership-app` — **READ ONLY** (shallow clone, 변경 0) |
| Supabase | READ_ONLY_ONLY (SELECT·metadata·advisor·라이브 프로브만) |
| Vercel | READ_ONLY_ONLY (team/project/deployment 조회 + 배포 산출물 읽기) |

**브랜치명 매핑 기록:** 하네스가 세션 브랜치명 `claude/s2-7-r0-data-api-binding-backup-approval-ymbmas`를 강제하므로 과제 §0의 이름 매핑 허용 조항에 따라 해당 이름을 사용한다. 하네스가 세션 시작 시 main(`ad076d29`)에 만들어 둔 동명 로컬 포인터는 고유 커밋 0건·원격 미존재 상태였으며, S2-6 선례(§G5)에 따라 기준 커밋 `79ac1d79…`로 재지정해 생성했다(`git checkout -B`, 유실 커밋 0, force push 0).

## 2. Base Canon and Invalidation Gates

| 게이트 | 확인 내용 | 실측 | 판정 |
|---|---|---|---|
| G0 | 저장소 = `byite-co/ssambership_web` | origin remote 일치 | PASS |
| G1 | 기준 HEAD = `79ac1d79…` · working tree clean | 일치 · clean | PASS |
| G2 | `origin/main` = `ad076d296ce46a8f7ae0ec30c13200758862e6af` | 일치 | PASS |
| G2 | merge-base(main, `0685b231…`) = `ad076d29…` · left/right 0/35 | 일치 | PASS |
| G3 | MC forward SHA-256 | `e46cde0106b1d3d8429d30fb73129ea17a3f2d737586153c1bf1630a691f1e12` 일치 | PASS |
| G3 | MC rollback SHA-256 | `2c9067b7681dd8a47a30215b8e10dc419ebbe3e67388ea5e37f30c7dc51c39a1` 일치 | PASS |
| G3 | `node scripts/verify/sql_number_integrity.mjs` | legacy 190 · 제외 15 · S2 forward 17 · rollback 16 · supabase/sql 총 207 · clean-install 192 · PASS | PASS |
| G4 | 앱 S2-6 blocker 승계 (`03495f045630f0eb321a1f9f391e24a436dc41bb`) | §18 참조 — 전건 일치 | PASS |
| G5 | 신규 브랜치 `79ac1d79…`에서 생성 | `git rev-parse HEAD` 일치 | PASS |

`S2_5_RELEASE_CANON_INVALIDATED` 발동 조건 없음. **FINAL_STATE_VERIFIER_CANON: PASS.**

## 3. Supabase Project Identity

MCP 플랫폼 조회(`list_projects`·`get_project`·`list_organizations`·`get_organization`·`get_project_url`) 실측:

| 항목 | 값 |
|---|---|
| project ref | `lbeqxarxothkmzqvpudy` (기대값 일치) |
| project name | `ssambership-staging` |
| organization | `byite` (`ktlczadzlbzwmdbothkr`) · plan = **pro** |
| region | `ap-northeast-2` |
| status | `ACTIVE_HEALTHY` |
| Postgres | 17.6.1.111 (engine 17 · ga) — 서버 실측 `PostgreSQL 17.6 (aarch64)` |
| API URL | `https://lbeqxarxothkmzqvpudy.supabase.co` |
| 조직 내 전체 project | 3개 — 본건 외 `사내전산망`·`scheduler` 2개는 모두 **INACTIVE**·비관련 명칭 |
| 동일 서비스명 production 후보 | **없음** — ssambership 이름의 project는 본건 1개뿐 (별도 production project 부재 재확정) |

차단 조건(ref 불일치·복수 후보 구분 불가·status 비정상·identity 비정상 불일치) 해당 없음.

**SUPABASE_PROJECT_IDENTITY: PASS**

## 4. Remote Database Baseline

전건 SELECT 전용(MCP `execute_sql`). 사용자 콘텐츠·PII 원문 출력 0.

### 4.1 DB identity

current database `postgres` · current user `postgres` · server `PostgreSQL 17.6` · 조회 시각 `2026-07-31 04:10 UTC` · timezone `UTC`. password·connection string 미기록.

### 4.2 객체 census

| 항목 | 실측 |
|---|---|
| public tables | **77** |
| public views | **1** |
| public functions | **194** |
| public policies | **193** |
| storage policies | **42** |
| buckets | **13** (S2-2 기록과 동일 — `profile-avatars`만 public) |
| `api_web_v1` schema | **absent** (기대 일치) |
| `api_app_v1` schema | **absent** (기대 일치) |
| `core_private` schema | **absent** (기대 일치) |

### 4.3 D-1 상태 — `public.comments`

전체 컬럼 실측(9컬럼): `id, post_id, author_id, parent_id, content, like_count, is_deleted, created_at, legacy_comment_id`

| 항목 | 실측 |
|---|---|
| `author_label` | **ABSENT** |
| `author_role` | **ABSENT** |
| `updated_at` | **ABSENT** |
| rows | 3 (S2-3 기록과 정합) |

배포 웹(main `ad076d29`)이 `comments.author_label`을 명시 참조하므로 게시판 댓글 결함은 원격에서 **아직 열려 있다**. → **PRODUCTION_WEB_COMMENT_DEFECT: STILL_OPEN_REMOTE** (§20 참조)

### 4.4 S2 관련 주요 baseline (집계값만)

users 8 · mentor_profiles 2 · subscriptions 2 · payments 2 · cash_wallets 3 · cash_ledger 11 · question_threads 5 · mentor_student_rooms 2 · mentor_plans 6 · community_posts 7 · community_comments 4 · comments 3 · shortform_posts 1 — 기존 기록과 합리적 정합(폭증·소실 없음).

### 4.5 bridge·version 정책

| 객체 | 실측 |
|---|---|
| `public.comments_write_guard` | 존재 (1) |
| `public.cc_write_guard` | 존재 (1) |
| `public.get_mobile_app_version_policy` | 존재 (1) — `(p_platform text) → jsonb` · SECURITY DEFINER |
| `public.mobile_app_version_policies` | 존재 (1) |
| android min/latest | 1 / 1 · store_url NULL |
| ios min/latest | 1 / 1 · store_url NULL |

원장 밖 수동 적용 baseline(157~183 효과)의 대표 객체가 전부 실존 — 존속 확인. 원격 값 변경 0.

**REMOTE_DB_BASELINE: PASS**

## 5. Migration Ledger State

MCP `list_migrations` 실측 **31행**: 최초 `20260702065122 / add_users_notification_enabled` · 최종 `20260720091401 / p2_25_payout_scheduler_foundation_156` — S2-2 §3.3 기록과 **완전 일치**.

| 판정 항목 | 결과 |
|---|---|
| S2 forward 17개(`20260729…`·`20260730…`) ledger 행 | **0건** |
| MC(`20260730095436_comments_author_label_baseline_convergence`) ledger 행 | **ABSENT** |
| M13(`…095438_comments_author_label_denormalize`) ledger 행 | **ABSENT** |
| 동일 ledger name 중복 | 없음 |
| 원장 밖 수동 적용 baseline 존속 | 유지 (§4.5 대표 객체 실존) |

**REMOTE_MIGRATION_LEDGER: UNCHANGED_UNAPPLIED** — 자동 재적용 없음(이번 세션 적용 자체가 금지 범위).

## 6. Data API Current Settings

### 6.1 캡처 수단과 한계

이 세션 환경에는 Supabase Dashboard 로그인 자격·Management API access token이 없어 **Integrations → Data API → Settings 화면 자체는 열 수 없다**. 이에 다음의 직접 실측 수단을 사용했다(§6.3의 금지 방식 4종 미사용):

- **라이브 PostgREST 서비스의 PGRST106 스키마 열거**: 존재하지 않는 schema profile(`Accept-Profile: zzz_probe_nonexistent`)로 리소스 경로(`/rest/v1/comments`)를 요청하면 실행 중인 PostgREST가 자신의 노출 스키마 전체 목록을 오류 hint로 반환한다. 이는 실행 중인 서비스의 현재 설정값 그 자체이며, 과거 스크린샷·코드 기대값·schema 존재 추정·OpenAPI root 열거가 아니다.
- in-database PostgREST config 조회(`pg_db_role_setting`): `pgrst.*` role 설정 **없음** — 본 프로젝트의 Data API 설정은 플랫폼 측(env) 전달 방식임을 확인(SQL로 auto-expose·extra search path를 확인할 수 없음의 근거).

### 6.2 현재값

```
CURRENT_EXPOSED_SCHEMAS:
public, graphql_public

CURRENT_AUTO_EXPOSE:
UNKNOWN  (Dashboard 전용 토글 — 이번 세션 접근 수단 부재. 최종 실행 세션에서 변경 전 필수 캡처)

CURRENT_EXTRA_SEARCH_PATH:
UNKNOWN  (동일 사유. 참고: extensions schema에 anon/authenticated USAGE는 존재 — Supabase 기본 구성과 정합)

CURRENT_DATA_API_URL_REF:
lbeqxarxothkmzqvpudy  (Data API URL = https://<ref>.supabase.co/rest/v1 정상)

Data API enabled:
YES  (라이브 응답 — RPC 200 · PGRST106 정상 오류 계약)
```

프로브 실측(2026-07-31 04:1x UTC):

| 프로브 | 응답 |
|---|---|
| `Accept-Profile: zzz_probe_nonexistent` | 406 PGRST106 — "Only the following schemas are exposed: **public, graphql_public**" |
| `Accept-Profile: core_private` | 406 PGRST106 — 동일 목록 (core_private **비노출** 실측) |
| `Accept-Profile: api_web_v1` | 406 PGRST106 — 동일 목록 (api_web_v1 **미노출** — S2 적용 전 기대 일치) |

API key 화면 상당 확인(MCP `get_publishable_keys` — 원문 미기록): 활성 legacy anon key **존재**(disabled=false) · 활성 publishable key **존재**(disabled=false). secret/server key는 이번 세션 조회 수단 미사용(원문 노출 방지) — 존재 여부 UNKNOWN으로 남기며 최종 세션 Dashboard 캡처 항목에 포함한다.

**DATA_API_CURRENT_STATE: VERIFIED** — 핵심 현재값(노출 스키마 정확 목록·URL·enabled·활성 key 존재)은 실행 중 서비스에서 직접 실측. 단 **auto-expose 토글·extra search path 2개 항목은 UNKNOWN**으로, D-API-W 실행 전 오너 Dashboard 캡처가 선행조건이다(§17 잔여 전제).

## 7. Current Data API Smoke

`POST /rest/v1/rpc/get_mobile_app_version_policy` · body `{"p_platform":"android"}` · publishable key 사용(로그·문서 원문 0):

- HTTP **200**
- 응답: `min_supported_build=1` · `latest_build=1` (정수) · `store_url=null` · `platform="android"` · 개인정보 필드 없음
- PGRST002 없음 · PGRST106 없음

**CURRENT_PUBLIC_RPC_SMOKE: PASS** · **DATA_API_OPENAPI_ANON_ENUMERATION_USED: NO**

## 8. Target D-API-W and D-API-A Contract

이번 세션 설정 변경 0. 아래는 목표 정본이며 실제 변경은 최종 R0~R7 세션에서 오너 승인 후 수행한다.

| 단계 | 실행 시점 | 목표 Exposed schemas | 영구 금지 |
|---|---|---|---|
| **D-API-W** | M1·MC·M13·M4·M5·M6 적용·DB 검증 후 · W1 배포 전 | `public` + `api_web_v1` | `core_private` |
| **D-API-A** | M17 적용·DB 검증 후 · 신규 앱 remote smoke 전 | `public` + `api_web_v1` + `api_app_v1` | `core_private` |

- **Automatically expose 목표: OFF** — 신규 객체 노출을 명시적 GRANT·계약으로 통제, 실수 생성된 public 객체의 자동 접근 방지, S2 migration의 명시적 권한 계약과 정합. 현재 토글값이 ON이더라도 이번 세션에서 변경하지 않는다.
- **Extra search path 목표: 현재 기본값 유지** — 명시적 계약 없이 추가 schema 금지.
- **schema cache**: DB 객체 생성·변경 후 `NOTIFY pgrst, 'reload schema'` 실행 절차 확정 — 이번 세션 미실행.
- **현재값 대비 델타 주기**: 현재 노출 목록에는 `graphql_public`(플랫폼 GraphQL 기본)이 포함되어 있다. D-API-W/A 목표 목록은 REST 노출 계약이며, `graphql_public`은 플랫폼 기본 구성으로 존치한다(제거는 별도 오너 결정 사항 — 본 계약의 차단 대상은 `core_private` 노출 여부다). 최종 세션에서 설정 저장 시 목표 목록 + `graphql_public` 존치로 입력한다.

**DATA_API_TARGET_CONTRACT: PASS** (권고 정본 확정 — 승인은 §15 #4·#5)

## 9. Grants, RLS and Exposure Separation

5계층을 분리해 기록하며, 한 계층의 PASS를 다른 계층의 증거로 대체하지 않는다.

| 계층 | 현재 실측 | S2 목표 상태의 검증 방법 (최종 세션) |
|---|---|---|
| 1. Dashboard Exposed schemas | `public, graphql_public` (라이브 열거) | Dashboard 저장 직후 PGRST106 열거 재실측 |
| 2. Schema USAGE | public/graphql_public/storage/extensions에 anon·authenticated·service_role USAGE = true | `core_private`: 외부 role USAGE **없음**을 `has_schema_privilege`로 확인 |
| 3. Table/View/Routine GRANT | S2 대상 객체 미존재(적용 전) | M10 assertion checkpoint + 계약별 GRANT 실측 |
| 4. RLS / security_invoker | public 77테이블 정책 193 (§10 advisor 참조) | V1~V7 invoker 계약(V3 예외 포함) 개별 확인 |
| 5. PostgREST schema cache | RPC 200 (캐시 정상) | 객체 변경 후 `NOTIFY pgrst` → smoke 재실행 |

`core_private` 이중 차단 계약(영구): ① Data API Exposed schemas에 미포함(현재도 비노출 실측 — §6.2) ② 외부 role(anon·authenticated) schema USAGE 미부여(M1 계약). Exposed-schema PASS ≠ 권한 PASS ≠ RLS PASS ≠ cache PASS — 각각 별도 게이트로 최종 세션에서 재검증한다.

## 10. Supabase Advisor Results

읽기 전용 실측 (2026-07-31 UTC):

| Advisor | ERROR | WARN | INFO |
|---|---|---|---|
| Security | **0** | 171 | 10 |
| Performance | **0** | 93 | 111 |

Security 내역: `authenticated_security_definer_function_executable` 101 · `anon_security_definer_function_executable` 63 · `function_search_path_mutable` 5 · `public_bucket_allows_listing` 1(`profile-avatars` — S2-2 §3에서 이미 정본화된 기지 항목) · `auth_leaked_password_protection` 1 · `rls_enabled_no_policy` INFO 10(운영자 전용 테이블들 — RLS enabled + 정책 0 = deny-all, 노출 아님).

차단 조건 대조: 노출 schema의 **RLS 미설정(disabled) 테이블 0** · `core_private` 외부 접근 가능성 해당 없음(schema 미존재·비노출) · S2 대상 객체와 직접 충돌하는 critical advisor 0. SECDEF 함수 실행 가능 WARN 164건은 기존 public RPC 표면의 기지 사항으로, S2 전환(core_private 이관·M0 PUBLIC EXECUTE 회수·M10 assertion)이 축소 방향의 해소 경로다 — 이유 없는 blocker 승격 없음, 신규 blocker 0.

**SECURITY_ADVISOR: WARN(비차단)** · **PERFORMANCE_ADVISOR: WARN(비차단)**

## 11. Vercel Production Binding

### 11.1 코드 기준 env 이름 (저장소 전수 검색 — 기억 아님)

| 용도 | 변수 (우선순위 순) | 근거 |
|---|---|---|
| URL | `NEXT_PUBLIC_SUPABASE_URL` → `SUPABASE_URL` | `lib/supabase/server.ts`·`client.ts`·`admin.ts`·`appSurfaceServer.ts` 등 |
| 공개 key | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` → `NEXT_PUBLIC_SUPABASE_ANON_KEY` → `SUPABASE_ANON_KEY` | 동일 |
| 서버 key | `SUPABASE_SERVICE_ROLE_KEY` | `lib/supabase/admin.ts`·`adminWriteClient.ts` 등 |
| (스크립트 전용) | `SUPABASE_DB_URL` | `scripts/verify/w5f-concurrency.mjs` — 런타임 비참조 |

`lib/supabase/admin.ts`의 URL도 `NEXT_PUBLIC_SUPABASE_URL`을 읽으므로, **production의 모든 Supabase 트래픽 대상 project는 URL 계열 변수 1계보로 결정**된다.

### 11.2 Vercel project identity (읽기 전용)

| 항목 | 실측 |
|---|---|
| team | `byite` (`team_9wQHbXANVNEThyJrl87TWyYl`) |
| project | `ssambership-web` (`prj_1esRN0q6npJ4BJUEqFeloX9kTTOf`) |
| production domains | `ssambership.com` · `www.ssambership.com` (+ `ssambership-web.vercel.app` 계열 alias) |
| production deployment | `dpl_7PkNtBrAaKs2GjcDxDKvHg1X8o5a` · target=production · READY · 2026-07-28T12:41Z |
| production source | Git `main` @ **`ad076d296ce46a8f7ae0ec30c13200758862e6af`** — S2-5 기록과 일치 |
| 최근 20개 배포 | 전건 preview(target=null) — production 재배포 없음 |

**WEB_PRODUCTION_BASE_MOVED: NO**

### 11.3 Production env binding (비밀 노출 0)

Vercel MCP에 env 조회 도구가 없어 env 화면 열거는 불가. 대신 **production deployment가 실제로 서빙 중인 산출물**을 직접 읽어 binding을 실측했다: production alias `ssambership-web.vercel.app`(= `dpl_7PkNtBrA…`의 alias 목록에 포함)의 응답 HTML에서 Supabase host를 추출한 결과 —

- 검출된 Supabase project ref: **`lbeqxarxothkmzqvpudy` 정확히 1종** (서로 다른 ref 혼재 없음)
- `NEXT_PUBLIC_*`는 빌드 시 산출물에 소성되므로, 이는 production 배포에 주입된 URL 계열 env의 직접 증거다.
- key 원문·기타 secret은 추출·기록하지 않았다.
- 한계 기록: ① `ssambership.com` 직접 fetch는 세션 네트워크 정책으로 차단되어(proxy CONNECT 403) production alias 경유로 실측(동일 deployment) ② Vercel env의 scope(Production/Preview 분리)·암호화 여부는 env API 부재로 미실측 — 산출물 실측이 이를 대체하며, scope 화면 캡처는 최종 세션 오너 확인 항목으로 남긴다 ③ `SUPABASE_SERVICE_ROLE_KEY`의 값 검증은 정의상 불가(비밀)·불필요 — 대상 project는 URL 1계보로 결정(§11.1).

**WEB_PRODUCTION_PROJECT_BINDING: PASS**

### 11.4 앱 binding 분리

S2-6에서 앱 `.env` 부재 확인됨 — **APP_PRODUCTION_PROJECT_BINDING: BLOCKED_PENDING_S2_6** 유지. 웹 binding PASS로 대체하지 않는다.

## 12. Backup and PITR Evidence

Dashboard(Database → Backups) 화면과 Management API 모두 이번 세션에서 접근 수단이 없다(오너 로그인·access token 부재, Supabase MCP에 backups 조회 도구 없음). 따라서 backup 실증은 **미확인**으로 판정하며, 존재 추정으로 PASS 처리하지 않는다.

| 항목 | 값 |
|---|---|
| PROJECT_PLAN | **pro** (조직 plan 실측 — plan 계약상 daily backup 포함 대상이나, 이는 계약 추정이지 실측 아님) |
| backup 방식 | UNKNOWN (PITR add-on 여부 미확인) |
| latest successful backup | UNKNOWN |
| retention | UNKNOWN |
| restore 가능 상태 | UNKNOWN |
| backup 오류 여부 | UNKNOWN |
| 보조 증거 | `archive_mode=on` · `archive_timeout=120s` · `wal_level=logical` (SELECT 실측) — WAL 아카이빙 동작 중이라는 플랫폼 인프라 방증일 뿐, 고객 복구 가능성·retention의 증거로 사용하지 않는다 |

**RECOVERY_MODE: NONE_OR_UNVERIFIED** · restore 실행 0 · PITR 설정 변경 0

## 13. Recovery Gate and RPO

3항 분리 판정:

| 항목 | 판정 |
|---|---|
| BACKUP_EXISTS | UNVERIFIED |
| RESTORE_AVAILABLE | UNKNOWN |
| RPO_ACCEPTED | AWAITING_OWNER (RPO 수용 문구 없음) |

**RECOVERY_GATE: BLOCKED** · **BACKUP_PITR_GATE: BLOCKED**

해소 경로(오너 액션 — 세션 불요): Dashboard → Database → Backups에서 ① backup 방식(PITR/Daily) ② latest successful backup timestamp ③ retention ④ restore 버튼 활성 상태를 캡처하고, Daily라면 "최대 약 24시간 RPO 수용" 문구를, PITR이라면 retention·복구 시간 범위 수용 문구를 명시한다. 이 캡처·수용 문구가 확보되면 #3은 별도 세션 없이 RESOLVED로 전환 가능하다.

**Storage 한계 (명시):** DB backup에는 **Storage 객체 원본(bytes)이 포함되지 않는다**. 이번 S2 migration은 Storage 객체 원본을 삭제하지 않으므로 migration 승인 판정과는 분리하되, 최종 운영 복구계획에는 ① DB schema/data recovery ② Storage object bytes recovery ③ Storage metadata recovery를 별도 항목으로 기록해야 한다. **STORAGE_OBJECT_BYTES_COVERED_BY_DB_BACKUP: NO.**

## 14. Schema-Only Snapshot

`pg_dump --schema-only`는 DB password/connection string이 세션에 없어 안전하게 실행할 수 없다(MCP `execute_sql`은 dump 불가). 원문 credential 조회·기록을 시도하지 않았다.

**SCHEMA_ONLY_DUMP: NOT_EXECUTED** · **SCHEMA_ONLY_DUMP_SHA256: N/A**

대체 근거: §4의 객체 census + §5 ledger 대조 + S2-2/S2-3의 SELECT 기반 카탈로그 실측이 baseline 증거를 구성한다. 최종 세션에서 오너가 DB credential을 세션에 제공하는 경우에만 schema-only dump(데이터 0행·repo 밖 임시 경로·SHA-256만 기록·종료 전 삭제)를 수행한다.

## 15. Owner Decision Table Delta

| # | 항목 | 이번 세션 판정 | 근거 |
|---|---|---|---|
| 3 | Backup/PITR restore point | **BLOCKED** | §12·§13 — 세션에 증거 수단 자체가 부재. 오너 Dashboard 캡처 + RPO 수용 문구로 해소 |
| 4 | Data API exposed schemas 변경 승인 | **UNRESOLVED** | 권고안 확정(§8: D-API-W `public+api_web_v1` · D-API-A `+api_app_v1` · `core_private` 영구 비노출 · `graphql_public` 존치) — 명시 승인 문구 없음 |
| 5 | Automatically expose 상태 | **UNRESOLVED** | 권고안 OFF 확정(§8) — 현재값 UNKNOWN(§6) · 명시 승인 문구 없음 |
| 15 | Production 웹 Supabase binding | **RESOLVED** | §11 실측 성공 — production 산출물이 `lbeqxarxothkmzqvpudy` 단일 ref |
| 16 | D-1/MC 원격 적용 승인 | **AWAITING_EXPLICIT_OWNER_APPROVAL** | §16 packet 완성 — 이번 세션 입력에 명시 승인 문구 없음(과제 실행 지시 ≠ DB 적용 승인) |

### 나머지 운영 결정 회부 (#2·#6·#11~#14)

| # | 항목 | 현재 상태 | 필요한 결정 | 권고안 | 승인자 | 승인 여부 | 미승인 시 차단 단계 |
|---|---|---|---|---|---|---|---|
| 2 | rollout 시간창 | 미정 | R0~R7 실행 시간대·순서별 창 | 트래픽 최저 시간대(KST 심야 02:00~06:00) · R1~R4는 동일 창 연속, M16은 별도 창 | 오너 | 미승인 | R0 실행 |
| 6 | synthetic fixture / 전용 테스트 계정 | 미정 | 원격 smoke용 계정·데이터 방식 | 전용 테스트 계정 2종(학생·멘토) 사전 발급, 실사용자 데이터 미사용, smoke 후 정리 절차 포함 | 오너 | 미승인 | W1 이후 원격 smoke |
| 11 | 단계별 DB 적용 승인자 | 미정 | 각 M단계 apply 승인 주체 | 오너 단독(문서화된 승인 문구 필수), 세션은 게이트 결과만 제시 | 오너 | 미승인 | R1 시작 |
| 12 | 단계별 웹·앱 배포 승인자 | 미정 | W1~W3·앱 release 승인 주체 | 오너 단독 — Vercel production promote·스토어 제출 모두 | 오너 | 미승인 | W1 배포 |
| 13 | rollback 최종 결정자 | 미정 | 이상 징후 시 rollback 발동 권한 | 오너 단독 발동 + 사전 정의된 자동 차단 조건(§S2-2 rollback 역순표) 병행 | 오너 | 미승인 | R1 시작 (rollback 계약 없이는 forward 금지) |
| 14 | 단계별 monitoring 관찰 시간 | 미정 | 각 단계 후 관찰 창 | R1/MC/M13: 30분 · W1~W3: 각 60분 · M11·M12: 30분 · M16: 24시간(구버전 cutoff 영향) | 오너 | 미승인 | 각 단계 전환 |

## 16. MC Remote Apply Approval Packet

| 항목 | 값 |
|---|---|
| MC_FORWARD_FILE | `supabase/sql/20260730095436_comments_author_label_baseline_convergence.sql` |
| MC_FORWARD_SHA256 | `e46cde0106b1d3d8429d30fb73129ea17a3f2d737586153c1bf1630a691f1e12` (G3 재실측 일치) |
| MC_ROLLBACK_FILE | `supabase/rollback/20260730095436_comments_author_label_baseline_convergence_rollback.sql` |
| MC_ROLLBACK_SHA256 | `2c9067b7681dd8a47a30215b8e10dc419ebbe3e67388ea5e37f30c7dc51c39a1` (재실측 일치) |
| 적용 위치 | **M1 직후 · M13 직전** (M1 → MC → M13 → M4) |
| apply_migration name | `20260730095436_comments_author_label_baseline_convergence` |
| 대상 project | `lbeqxarxothkmzqvpudy` (identity §3 PASS) |
| 사전 조건 실측 | ledger에 MC/M13 부재(§5) · `comments.author_label` 원격 부재 재확인(§4.3) · MC 5분기 forward의 대상 상태 = S2-3/S2-4 검증 시나리오와 동일 |
| 검증기 | `scripts/verify/s2_4_comments_author_label_baseline_convergence_verify.sql` (RC `0685b231…` 동봉) |
| 원본 검증 | S2-4 로컬 격리 PG17.6 전건 PASS (docs/audit/s2_4_…_local_verification_20260731.md) |

**MC_APPROVAL_PACKET: COMPLETE**

**OWNER_DECISION_16: AWAITING_EXPLICIT_OWNER_APPROVAL** — 오너의 명시적 승인 문구(파일명 또는 SHA 지칭 + "적용 승인" 상당)가 확보될 때까지 MC는 적용하지 않는다. §20의 활성 결함에도 불구하고 **MC 단독 긴급 적용은 하지 않으며**, 승인 후에도 M1 → MC → M13 → M4 순서·ledger 기록·rollback 계약·R0 gate를 우회하지 않는다.

## 17. Pre-M16 Readiness

S2-6 blocker와 분리한 pre-M16 범위(R1 비파괴 기반 → D-API-W → W1 → R2 → D-API-A → W2 → W3 → R4[M11·M12]) 판정 — 실제 적용은 기존 rollout plan 호환성 매트릭스를 따른다:

| YES 조건 | 상태 |
|---|---|
| Supabase identity PASS | ✅ PASS (§3) |
| remote baseline PASS | ✅ PASS (§4) |
| ledger unchanged | ✅ UNCHANGED_UNAPPLIED (§5) |
| Data API current state VERIFIED | ✅ VERIFIED — 단 auto-expose·extra search path 캡처 잔존 (§6) |
| Data API 목표 승인 (#4·#5) | ❌ UNRESOLVED |
| web production binding PASS | ✅ PASS (§11) |
| backup/PITR gate PASS | ❌ BLOCKED (§13) |
| MC 승인 #16 RESOLVED | ❌ AWAITING |
| 적용·rollback 승인자 확정 (#11~#13) | ❌ 미확정 |

**READY_FOR_PRE_M16_REMOTE_APPLY_APPROVAL: NO** — 기술 실측 5항은 전건 확보. 잔여는 전부 **오너 액션**(backup 캡처·RPO 수용, 승인 4건, 승인자 지정)이며 추가 기술 세션 없이 해소 가능하다.

## 18. S2-6 Blocker Interaction

앱 저장소 읽기 전용 승계 (`claude/s2-6-android-signed-release-8yym8y` @ `03495f045630f0eb321a1f9f391e24a436dc41bb` — shallow clone HEAD 실측 일치):

| 항목 | 승계 확인 |
|---|---|
| APP_NATIVE_RELEASE_GATE | **BLOCKED** (audit §17 실측) |
| OLD_APP_M16_CUTOFF_GATE | **BLOCKED_UNKNOWN_STORE_BASELINE** |
| OWNER_DECISION_9 | RESOLVED (audit §16) |
| versionCode | `0.1.0+4` 유지 (pubspec 실측) |
| signed artifact | 없음 (RELEASE_AAB/APK_BUILD: BLOCKED) |

**독립 범위 (S2-6와 무관하게 진행 가능):** R1·MC·M13·D-API-W·W1·R2·D-API-A·W2·W3·R4(M11·M12) — 구버전 웹·구버전 앱과의 호환은 S2-2 호환성 매트릭스로 이미 판정됨. 이번 세션의 잔여 오너 액션(§17)만 해소되면 S2-6와 병행 가능.

**종속 범위 (S2-6 해소 전 금지):** M16(구앱 cutoff — store baseline 미확인) · 앱 release · 최종 M10 재검증 이후 단계. **READY_FOR_M16: NO · READY_FOR_APP_RELEASE: NO** 유지.

앱 저장소 변경 0 (브랜치 생성·파일 수정·build·commit·push·PR·병합 전부 미수행).

## 19. Remaining Rollout Preconditions

1. **오너 액션 (세션 불요)** — backup/PITR Dashboard 캡처 + RPO 수용(#3), Data API 목표 승인(#4·#5), MC 적용 승인(#16), 승인자·시간창·모니터링 창 확정(#2·#11~#14), synthetic fixture 방식(#6), Data API auto-expose/extra search path 현재 토글 캡처(§6 잔존), secret/server key 활성 여부 캡처(§6).
2. **S2-6 오너 환경 재실행 (APP)** — keystore·production `.env`·Android SDK 36·Play Console·기기. 기준 `1c5d6c0190534d8d17381c95cc701b2f87342c0d`, blocker 참고 `03495f04…`.
3. **최종 R0~R7 실행 세션 (WEB+원격)** — R0 재캡처(이 문서 §4~§7 절차 재사용) → 승인된 순서 적용.

**2026 Data API 변경 대응 기록:** automatic exposure change considered: **YES** · current project toggle captured: **NO** (Dashboard 접근 수단 부재 — §6.1) · explicit GRANT strategy: **PASS** (S2 신규 객체 전건 명시 GRANT + Exposed schemas 계약, auto-expose 비의존, M10 assertion) · October 2026 enforcement risk: **ADDRESSED** (전략 차원 — 토글 실측 캡처만 잔존).

## 20. Project Progress and Remaining Work

**활성 결함:** production 웹 게시판 댓글 — `comments.author_label` 원격 부재 재확인(§4.3). 배포 웹이 해당 컬럼을 명시 참조하므로 결함은 활성 상태다. 해소는 MC 단독 긴급 적용이 아니라 승인된 M1 → MC → M13 → M4 체인으로 수행한다(§16). **PRODUCTION_WEB_COMMENT_DEFECT: STILL_OPEN_REMOTE.**

- 세션 시작 전 완료 실행 단위: **15개** / 진행도 약 95%
- 이번 세션(S2-7): **부분 완료 (차단)** — 기술 실측 게이트(identity·baseline·ledger·Data API 현재값·smoke·binding·advisor·MC packet·S2-6 승계)는 전건 완료. backup/PITR 실측·auto-expose 캡처·schema dump·오너 승인 4건이 세션 외부 요인(자격·승인)으로 BLOCKED
- 세션 완료 후 완료 실행 단위: **15개 유지** (S2-7은 완료로 계상하지 않음 — 단 잔여분은 전부 오너 액션으로 축소됨)
- 전체 진행도: **약 95~96%** (기술 조사 범위는 사실상 소진 — 잔여는 오너 승인·오너 환경 작업·최종 실행)
- 최소 잔여 세션: **3개** — ① S2-6 오너 환경 재실행(APP) ② (필요 시) S2-7 보완은 세션이 아닌 오너 캡처·승인으로 갈음 가능 ③ 최종 R0~R7 실행. 오너 캡처·승인이 문서로 확보되면 실질 잔여 세션은 **2개**

진행도 산정 근거: Data API 현재값 실측 완료(노출 스키마·URL·enabled·smoke) / production binding 실측 완료(PASS) / recovery 수단 **미확인(BLOCKED)** / 해소된 owner decision: #15 (+#9는 S2-6에서 기해소) / 열린 앱 blocker: S2-6 signed build 일체 / 열린 원격 blocker: backup 실측·승인 4건·승인자 미확정 / production 활성 결함: comments.author_label 1건.

## 21. Final Verdict

**이번 세션 최종 판정: BLOCKED (부분 완료)** — 기술 실측 전건 성공, 차단 사유는 전부 세션 권한 밖(오너 자격·명시 승인).

핵심 근거:

1. 기준 canon 불변 전건 재확증 — base `79ac1d79`·main `ad076d29`·RC `0685b231`·MC SHA 2종·integrity 192 PASS.
2. Supabase identity PASS — `lbeqxarxothkmzqvpudy` 단일 후보·ACTIVE_HEALTHY·PG17.6, 별도 production project 부재 재확정.
3. 원격 baseline PASS·ledger UNCHANGED_UNAPPLIED — S2 17건·MC·M13 원장 전무, `comments.author_label` 부재로 production 댓글 결함 활성 재확인.
4. Data API 현재값: 실행 중 서비스에서 노출 스키마 **`public, graphql_public`** 직접 열거(금지 방식 미사용), RPC smoke 200/정수 응답. auto-expose·extra search path는 Dashboard 접근 수단 부재로 UNKNOWN — 유일한 Data API 잔여 캡처.
5. Vercel production: main `ad076d29` 불변(BASE_MOVED: NO), production 산출물이 `lbeqxarxothkmzqvpudy` 단일 ref — binding PASS·#15 RESOLVED.
6. Backup/PITR: 세션에 Dashboard·Management API 수단이 없어 **NONE_OR_UNVERIFIED / BLOCKED** — 존재 추정 PASS 금지 원칙 적용. 오너 캡처 + RPO 수용 문구로 해소 가능(세션 불요).
7. MC 승인 packet COMPLETE — 파일·SHA 2종·적용 위치·ledger name·사전조건 실측 동봉. #16은 명시 승인 문구 부재로 AWAITING 유지(과제 실행 지시를 승인으로 해석하지 않음).
8. pre-M16 준비도 NO — 기술 5항 전건 확보, 잔여는 오너 액션 6건. M16·앱 release·전체 rollout은 무조건 NO 유지.

```
FINAL_STATE_VERIFIER_CANON:        PASS
SUPABASE_PROJECT_IDENTITY:         PASS
REMOTE_DB_BASELINE:                PASS
REMOTE_MIGRATION_LEDGER:           UNCHANGED_UNAPPLIED
DATA_API_BASELINE:                 VERIFIED (auto-expose·extra search path 캡처 잔존)
CURRENT_PUBLIC_RPC_SMOKE:          PASS
WEB_PRODUCTION_BASE_MOVED:         NO
WEB_PRODUCTION_PROJECT_BINDING:    PASS
APP_PRODUCTION_PROJECT_BINDING:    BLOCKED_PENDING_S2_6
BACKUP_PITR_GATE:                  BLOCKED
SCHEMA_ONLY_DUMP:                  NOT_EXECUTED
MC_APPROVAL_PACKET:                COMPLETE
OWNER_DECISION_3:                  BLOCKED
OWNER_DECISION_4:                  UNRESOLVED
OWNER_DECISION_5:                  UNRESOLVED
OWNER_DECISION_15:                 RESOLVED
OWNER_DECISION_16:                 AWAITING_EXPLICIT_OWNER_APPROVAL
PRODUCTION_WEB_COMMENT_DEFECT:     STILL_OPEN_REMOTE
READY_FOR_R0_EXECUTION:            NO
READY_FOR_PRE_M16_REMOTE_APPLY_APPROVAL: NO
READY_FOR_S2_6_OWNER_ENV_RERUN:    YES
READY_FOR_M16:                     NO
READY_FOR_APP_RELEASE:             NO
READY_FOR_FULL_R0_R7:              NO
READY_FOR_REMOTE_ROLLOUT_APPROVAL: NO
READY_FOR_REMOTE_ROLLOUT:          NO
```
