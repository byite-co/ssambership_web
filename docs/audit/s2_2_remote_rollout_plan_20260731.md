# S2-2 원격 롤아웃 계획 정본 — 읽기 전용 사전 감사 (2026-07-31)

> **세션 성격:** 계획 세션(읽기 전용 사전 감사). 운영·staging DB DDL/DML 0 · Data API 설정 변경 0 ·
> Vercel 배포/환경변수 변경 0 · 앱 빌드/스토어 제출 0 · PR 0 · migration/rollback/제품 코드 변경 0.
> 이 문서 1건 작성·커밋·push 만 수행했다. 실제 원격 변경은 본 문서 검토와 오너의 별도 명시 승인 후
> **다른 세션**에서만 수행한다.
>
> **브랜치 기록:** 지시서는 신규 브랜치명 `claude/s2-2-remote-rollout-plan-20260731` 을 지정했으나,
> 이 세션의 push 허용 브랜치는 하네스에 의해 `claude/s2-2-remote-rollout-plan-jktelb` 로 고정되어
> 있다. 동일 목적의 지정 브랜치를 base commit `4ba9c00e` 에서 재생성해 사용했다(내용·기준점 동일,
> 이름만 상이 — 타 브랜치 push 금지 규칙 준수).

---

## 1. 정본 identity 표 (§1 하드게이트 — 전건 실측 PASS)

### 1.1 저장소·commit 기준점

| 항목 | 기대값 | 실측값 | 판정 |
|---|---|---|---|
| 웹 base branch | `claude/s2-2-batch-f-final-sl82ck` | 원격 tip 실측 | — |
| 웹 base branch 원격 tip | `4ba9c00e6fd671e4481a5a5c781eec194b6bea6c` | 동일 (`git ls-remote`) | PASS |
| worktree | clean | `nothing to commit, working tree clean` | PASS |
| Batch F 커밋 수 (W4 이후) | 정확히 1 | `b95f74ab..4ba9c00e` = 1커밋, parent = W4 | PASS |
| Batch F 변경 파일 | 정확히 12 | `git diff --name-status` 12건 (M 5 + A 7) | PASS |
| active S2 forward | 16개 | `supabase/sql/20*.sql` 16개 | PASS |
| S2 rollback | 15개 | `supabase/rollback/*.sql` 15개 | PASS |
| M10 rollback | 없음 | `20260730195156` rollback 파일 부재 | PASS |
| clean-install 최종 산식 | 191 | 레거시 190(실파일) − 게이트 제외 15 = 175, +16 = 191 (manifest §3·§8 산식과 일치. 디스크 총계 206 = 190 + 16) | PASS |
| 앱 branch | `claude/s2-2-app-transition-m17-gate4-afw0ag` | 원격 tip = HEAD | PASS |
| 앱 commit | `1c5d6c0190534d8d17381c95cc701b2f87342c0d` | 동일 | PASS |
| 앱 parent(계약 commit) | `bc89de109b53c0500ab03208878085f0dce72abd` | `HEAD^` 동일 | PASS |

### 1.2 문서 identity (행/바이트/SHA-256 실측)

| 문서 | 행 | 바이트 | SHA-256 | 기대값 대비 |
|---|---|---|---|---|
| `docs/contracts/api_web_v1_contract_v1_1.md` (웹 계약 v1.1) | 2,994 | 329,690 | `bd9fc0dd2802c8358bb09f2938e0de7248d8b60703794895708e300f8ef32fa6` | **완전 일치** |
| 앱 `docs/audit/S2_2_APP_TRANSITION_GATE4_20260730.md` | 264 | 18,543 | `4e9b4018aa54ee756a4be84dd7743bd1802458c744f6ea7505d85c5955d82eb8` | **완전 일치** |
| `docs/audit/s2_2_migration_physical_policy_20260730.md` | 624 | 57,757 | `4a06025453e382df2bad002ccf60ce414fc9395036de5f34e417ee8c38866277` | 현재값 기록 |
| `docs/audit/sql_apply_manifest.md` | 293 | 87,773 | `08b89fee7c00435fd57e4666b9ed6b7400dc03801939b823cd2606daf5c351d6` | 현재값 기록 |
| `docs/audit/apply_manifest_prod.md` | 288 | 42,084 | `e3f8dca51531700b26d1a9cdd86aeb672e16a5abdc84f4b1ca609074291b7ca5` | 현재값 기록 |
| `scripts/verify/s2_2_batch_f_verify.sql` | 717 | 42,495 | `22dab7fa17eae4cecac438b2f80734539c6ebc3c98d9b0b29c16ff63cb500e76` | 현재값 기록 |
| `scripts/verify/sql_number_integrity.mjs` | 269 | 12,669 | `eedfdfe214552273b0af5df11add4dce7f83dbad38cb9cd0fd965e255cfc8b4a` | 현재값 기록 |

**S2_2_BATCH_F_CANON: VERIFIED**

---

## 2. S2 forward 16개·rollback 15개 정본 인벤토리 (SHA-256 전건 실측)

배치·checkpoint: A(M0·M15)=@177 → B(M1·M13·M4)=@180 → C(M5·M6·M7)=@183 → D(M17·M8·M14)=@186
→ E(M9)=@187 → F(M11·M12·M16·M10)=@191. M2·M3 retired(파일 없음).

### 2.1 forward (적용 순서 = §20.2.1 위상 정렬 권고 직렬화)

| M | 파일 (`supabase/sql/`) | SHA-256 | 배치 |
|---|---|---|---|
| M0 | `20260729211929_mentor_profile_privileged_column_guard.sql` | `3bb2edd97b921900f93d460f206add873c80b6cbcf1782844b6c5e835184d94c` | A |
| M15 | `20260729211941_weekly_usage_pair_party_guard.sql` | `aabd465b12818d5d17c2326b05331ba42de59ed835a1203f58ca2facb1a4827e` | A |
| M1 | `20260730095435_api_web_v1_schemas.sql` | `97e7f6c28442b96415753b8b8caace7c28d5d393ca57b8d79f2faf5d89de4912` | B |
| M13 | `20260730095438_comments_author_label_denormalize.sql` | `4d035c88c17030a5df3574fc7dee7768bfd2809255a47ad087edf1c4676b94ac` | B |
| M4 | `20260730095441_api_web_v1_read_views.sql` | `301f44beea6805dd143ae3a04ac282b52e905a3e123d865c09399b318a33637e` | B |
| M5 | `20260730105244_core_private_room_ensure.sql` | `47dd392b3b14f8c4cc9a62edb5ab257f61feeb0a766a2839f2f1d044e8da5e62` | C |
| M6 | `20260730105248_api_web_v1_self_rpc.sql` | `0066357d68dcb3ffcf2fb386ddd5ae1d05db88870146f71a780f0169ceb85a98` | C |
| M7 | `20260730105252_api_web_v1_community_rpc.sql` | `504dea03f6af15fc86a041a29fb4f0945b8245734204896dc059ed433770c80c` | C |
| M17 | `20260730112525_api_app_v1_surface.sql` | `6b6134df59430e14dbb88a0160740bc846523fe3273ccdb4b262b51efb142637` | D |
| M8 | `20260730112528_api_web_v1_mentor_rpc.sql` | `bd2c2ce5b23edb4ca5247ff63a694323f7ba2912d778d628336546490ffb0ca2` | D |
| M14 | `20260730112531_api_web_v1_payout_account_rpc.sql` | `b78ae36e58f90e26e2d795f687c93d06f0ee873f9b901919a3a99783780bfd07` | D |
| M9 | `20260730120103_money_rpc.sql` | `3821e05f3a0c8787af180c34bbdafbcfb866a61cc3b25cbf6534783522e115d5` | E |
| M11 | `20260730195147_revoke_mentor_profiles_write.sql` | `53dac5bf5ad382898697b976387f5a61123367fef9a3e035dc863fa68dc356e0` | F |
| M12 | `20260730195150_revoke_mentor_plans_write.sql` | `480585e4c53a16b63ba845aa08b9ff26ef226dc4bc786ca7538ab2bd1e6e844a` | F |
| M16 | `20260730195153_community_direct_write_lockdown.sql` | `fe35212aef96bca15e84a21c16f6a370215174ac5f70ff13348aca9e0c2bce0c` | F |
| M10 | `20260730195156_contract_permission_assertions.sql` | `435ad2527ee3320b55b6660542c082d8bf7f3bc91d197eadd0b76cebd5fb97ac` | F |

### 2.2 rollback (M10 제외 15개 — clean-install glob 불포함, 장애 시 오너 승인 후 1건 명시 선택)

| 대응 M | 파일 (`supabase/rollback/`) | SHA-256 |
|---|---|---|
| M0 | `20260729211929_mentor_profile_privileged_column_guard_rollback.sql` | `a6fbea2a93360eebfaea61f8e4d1c27d2beac7e32d50fe2a36ba9184d887d35e` |
| M15 | `20260729211941_weekly_usage_pair_party_guard_rollback.sql` | `42f5266d270b71b4caa6730e505665423342d0a2588199330781d4d3e0eb6363` |
| M1 | `20260730095435_api_web_v1_schemas_rollback.sql` | `3834a675b7c317ddd2f7b74e5d13f1a8993524d4764c876b0cea3bf1ce63467e` |
| M13 | `20260730095438_comments_author_label_denormalize_rollback.sql` | `0d0058df855cdf14bd245692005d3050185b3dfdc22bde851102a5dd685af663` |
| M4 | `20260730095441_api_web_v1_read_views_rollback.sql` | `97a368ac2db28d4b7799b3e3d2f573d4a6c68aeadabcb33aea0ca837de1127f2` |
| M5 | `20260730105244_core_private_room_ensure_rollback.sql` | `959fa1202957be49bf106f018d7cd32ba95a6bcfa056ea1fdede997f6079a55d` |
| M6 | `20260730105248_api_web_v1_self_rpc_rollback.sql` | `4d33e8b8768000402900231b5acf5a73a35d4054105702fd037e73696e0f3011` |
| M7 | `20260730105252_api_web_v1_community_rpc_rollback.sql` | `209cae74feb545992f6731356d7c4ebb9a1f6ed52fa59ee7232ccd853559c8bd` |
| M17 | `20260730112525_api_app_v1_surface_rollback.sql` | `16ade4bd15aa49051255f859e5a4d628ce7a0cd8a32560327212b65c3c3b0258` |
| M8 | `20260730112528_api_web_v1_mentor_rpc_rollback.sql` | `34b88c4a499c79d256cac0e0ec8a2cc81e78aa47551d01c83b5425747d3ae8cf` |
| M14 | `20260730112531_api_web_v1_payout_account_rpc_rollback.sql` | `b972088905f84306d3837b8711799c31552b9229ecf08e19f146eee3c857900e` |
| M9 | `20260730120103_money_rpc_rollback.sql` | `c89af2f1d94dc367946ba6e3d7fc1849d6979cc53f33c4fa9d634d728015de0f` |
| M11 | `20260730195147_revoke_mentor_profiles_write_rollback.sql` | `a0cc1c7699feb06f56ac77bcc4f12c6bb324a940d5367b6d33913563ea4fc204` |
| M12 | `20260730195150_revoke_mentor_plans_write_rollback.sql` | `cb68fc2f51c6381375b488f6f6cdaa996c938ca9d972356d2a0310bf9e1fe255` |
| M16 | `20260730195153_community_direct_write_lockdown_rollback.sql` | `98930c34b172d42d77e4ffda9bea1130b789093b595a0638ef3e2e1f1f0e4e76` |

---

## 3. 원격 DB 기준선 (읽기 전용 실측 — 2026-07-30 UTC)

### 3.1 project identity

| 항목 | 실측값 |
|---|---|
| project ref | `lbeqxarxothkmzqvpudy` — **기존 기록과 일치, 실제 identity 대조 완료** |
| project name | `ssambership-staging` (조직 `ktlczadzlbzwmdbothkr`, ap-northeast-2, ACTIVE_HEALTHY) |
| PostgreSQL | `PostgreSQL 17.6 on aarch64` (플랫폼 버전 17.6.1.111) — 로컬 검증 PG17.6 과 메이저·마이너 일치 |
| API URL | `https://lbeqxarxothkmzqvpudy.supabase.co` |
| 별도 production project | **없음** — 계정 내 다른 2개 프로젝트(사내전산망·scheduler)는 무관·INACTIVE. 즉 이 "staging" 명칭 프로젝트가 사실상 운영 단일 DB다(도메인 `ssambership.com` 이 바라보는 대상인지의 최종 확인은 Vercel 환경변수 열람 금지로 이 세션에서 미실측 — 오너 결정표 #15) |
| dev branch | Supabase branching 미사용(list_branches 가 branching 미활성 오류 반환) |

### 3.2 카탈로그·인프라 기준선 스냅샷

| 항목 | 실측값 |
|---|---|
| public 스키마 | function 194 · view 1 · table 77 · policy 193 · trigger 82(비내부) |
| S2 대상 스키마 | `api_web_v1`·`api_app_v1`·`core_private` **전부 미존재** — 부분 적용·예상 밖 S2 객체 0건(대표 함수·트리거·컬럼 전수 부재 확인) |
| extensions | pg_cron 1.6.4 · pg_stat_statements 1.11 · pgcrypto 1.3 · plpgsql 1.0 · supabase_vault 0.3.1 · uuid-ossp 1.1 |
| cron.job | **0건** — 적용 중 스케줄 간섭 없음 |
| Realtime publication | `supabase_realtime` = `question_attachments`·`question_messages`·`question_threads` 3건 — S2 forward 는 이 3테이블 DDL 무접촉(간섭 없음) |
| Storage buckets | 13개 — `profile-avatars` 만 public=true, 나머지 12개 private(CLAUDE.md 필수 private 목록 전건 준수). S2 는 Storage 정책 무변경 |
| 데이터 규모 | users 8 · mentor_profiles 2 · subscriptions 2 · payments 2 · cash_wallets 3 · cash_ledger 11 · question_threads 5 · rooms 2 · mentor_plans 6 · community_posts 7 · community_comments 4 · comments 3 · shortform_posts 1 — **사실상 사전 오픈 규모**(잠금·백필 소요시간 무시 가능 수준) |
| backup/PITR | 이 세션의 도구로는 조회 불가(플랫폼 콘솔 항목) — R0 필수 확인·오너 결정표 #3 |

### 3.3 migration ledger 대조표

`supabase_migrations.schema_migrations`(list_migrations) 실측 **31행**: 최초 `20260702065122`,
최종 `20260720091401 / p2_25_payout_scheduler_foundation_156`.

| 판정 항목 | 결과 |
|---|---|
| S2 신규 16개(`20260729…`·`20260730…`)의 원장 존재 | **0건 — S2 는 원격 원장에 전무(미적용 확정)** |
| historical baseline 동결분과 S2 파일명 충돌 | 없음(타임스탬프·이름 충돌 0) |
| 원장 밖 적용(수동 DDL) | **있음** — 원장은 156 에서 끝나지만 157~183 구간의 대표 함수 19종(157 `notification_display_name` … 183 `account_deletion_verify_object_owners`, 161 `account_deletion_status_self`, 162 `get_mobile_app_version_policy`, 163/164 브리지 `comments_write_guard`·`cc_write_guard` 등)이 **전부 실존**. 즉 원격 실효 상태 ≈ 로컬 clean-install 175 상당이며, 원장 행만 미기재. **기존 migration repair·원장 재작성은 금지 범위** — 그대로 두고, S2 적용분만 원장 신규 행으로 기록한다 |
| 지급 게이트(105~111·114·153·156) | 153·156 은 원장에 있음(staging 특성). clean-install 정본 판정(§3 제외 15개)은 변경하지 않는다 |

### 3.4 드리프트 판정 — S2 forward 사전 게이트 대조 실측

| # | 실측 | S2 게이트 영향 | 판정 |
|---|---|---|---|
| D-1 | **`public.comments` 에 `author_label`·`updated_at`·`author_role` 부재** (실측 컬럼 9개: id·post_id·author_id·parent_id·content·like_count·is_deleted·created_at·legacy_comment_id). 037 정본 형상(author_label text NOT NULL default '쌤버십 회원' + updated_at)과 불일치 — 037 의 `create table if not exists` 가 선재 테이블에 의해 skip 된 형상. 163 의 `legacy_comment_id` 는 존재 | **M13 사전 게이트 ①에서 `BATCH_B_BASELINE_OBJECT_MISMATCH: comments.author_label missing` 으로 수정 0건 중단(fail-safe 설계 확인).** M13 이 막히면 M4(V2 가 `c.author_label`·`c.author_role` 참조)·이후 전 단계가 막힌다. `comments.updated_at` 은 S2 파일 어디서도 참조하지 않음(비차단) | **R1 차단 — 오너 결정 필요.** 해소는 별도 baseline 수렴 migration(예: `comments.author_label text NOT NULL DEFAULT '쌤버십 회원'` 추가) 신규 작성·검증 후에만 가능하며 **이번 세션 금지 범위** |
| D-2 | `community_comments.author_label` = text · NOT NULL · default `'쌤버십 회원'` | M13 게이트 ③ 요건과 **정확 일치** | PASS 예상 |
| D-3 | `community_posts` 쓰기 정책 실측 6종 = `cp_write_self`·`로그인 유저 게시글 작성`·`cp_update_own`·`cp_update_self`·`본인 게시글 수정`·`cp_delete_own` (+SELECT 3종: `cp_select_own`·`cp_select_published`·`누구나 게시글 읽기`) | M16 DROP 대상 6종과 **이름·개수 정확 일치**(M16 은 대시보드 생성 한글명 2종을 이미 반영해 설계됨). 사전 게이트 "정확히 6·identity 일치·SELECT 최소 2종" 충족 | PASS 예상 |
| D-4 | `mentor_profiles`·`mentor_plans`·`community_posts` relacl = `anon/authenticated=arwdDxtm` (**8권한 — PG17 `MAINTAIN` 포함**) | M11 사전 게이트는 표준 7종의 `has_table_privilege` 전부 true 만 검사(초과분 무검사) → **통과 예상**. 단 rollback 은 계약 §22 #6 정본 6종만 GRANT — `MAINTAIN` 은 비복원(§8.4 알려진 비대칭) | PASS 예상 (rollback 비대칭 기록) |
| D-5 | M13 이 참조하는 `trg_community_comments_set_updated` 트리거 실존 | 백필 구간 DISABLE/ENABLE 가능 | PASS 예상 |
| D-6 | 162 버전 정책: `mobile_app_version_policies` 테이블·`get_mobile_app_version_policy` RPC **실존**, 행 = ios/android 각 `min_supported_build=1`·`latest_build=1`·store_url NULL | 앱 저장소 문서(`APP_V16_MIN_VERSION_SERVER_REQUIREMENT.md`, 07-21, `WAITING_SERVER_GATE`)는 **낡은 상태** — 서버 게이트는 이미 배포됨. M16 cutoff 의 서버측 수단은 존재. 구버전 배포 빌드가 이 게이트를 포함하는지는 별개(§7) | 인프라 존재 확인 |

**REMOTE_DB_BASELINE: VERIFIED_READ_ONLY** (보정 없이 조회만 수행. 단 D-1 이 R1 착수를 차단하는
P0 선행 결함 — 오너 결정표 #16 해소 전 DB 적용 금지)

---

## 4. Data API 현재/목표 비교

### 4.1 실측 결과와 한계

이 세션의 컨테이너 egress 정책이 `*.supabase.co` HTTPS CONNECT 를 403 으로 거부해(프록시 정책
거부 — 재시도 금지 항목) **PostgREST 실요청·Exposed schemas 현재 목록·Automatically expose new
tables 상태·Extra search path 를 실측하지 못했다.** 과거 스크린샷으로 PASS 처리하지 않는다는
지시에 따라 아래와 같이 판정한다.

| 항목 | 현재 상태 | 목표 상태 |
|---|---|---|
| Exposed schemas 전체 목록 | **미실측(BLOCKED — 네트워크 정책)**. DB측 간접 사실: `api_web_v1`·`api_app_v1`·`core_private` 스키마 자체가 DB에 미존재하므로 현재 노출 자체가 불가능. 계약 §20.6.1 실측 기록상 `pgrst.db_schemas` 는 role `rolconfig` 로 읽을 수 없음(플랫폼 레벨) — 대시보드/Management API 로만 확인 가능 | `public`(기존 유지) + `api_web_v1`(D-API-W) + `api_app_v1`(D-API-A). **`core_private` 절대 미노출** |
| Automatically expose new tables | 미실측(BLOCKED) — R0 에서 캡처 | OFF 권장(로컬 재현 시 auto-expose OFF 보정 절차가 물리 정책 §9.7 에 존재 — 원격 실값은 오너 캡처로 확정) |
| Extra search path | 미실측(BLOCKED) — R0 에서 캡처 | 변경 없음(기본값 유지) |
| config reload vs schema cache reload | — | **구분 절차(§20.6.1):** ① Exposed schemas 변경 = 대시보드 저장 → 플랫폼 config 반영 확인. ② DB 객체 생성·변경 = `NOTIFY pgrst, 'reload schema'`. `ALTER ROLE authenticator SET pgrst.db_schemas` 는 사용 금지(플랫폼 설정과 이원화 드리프트) |
| 정상 조건 | — | `api_web_v1`·`api_app_v1` 요청에서 **PGRST106(schema not exposed)·PGRST002(schema cache 미로드) 0건** |
| 거부 조건 | — | `core_private` 를 Accept-Profile/Content-Profile 로 직접 요청 시 **PGRST106 등 schema 비노출 오류로 거부** |
| GRANT/RLS vs 노출 | — | **별도 게이트로 분리 기록:** GRANT·RLS 는 SQL(M계열·M10 assertion)이 판정, Data API 노출은 플랫폼 단계(D-API-W/A) 증거로만 판정(§21.10 — M10 은 노출 목록을 판정하지 않음). 스키마 미노출이어도 GRANT 가 있으면 DB 직결 경로에선 접근 가능하므로 두 겹 모두 각각 검증한다 |

**DATA_API_BASELINE: BLOCKED** (세션 네트워크 정책상 실측 불가 — R0 에서 대시보드 캡처로 해소.
설정은 일절 변경하지 않았다)

---

## 5. 웹 배포 기준선·경로

### 5.1 실측

| 항목 | 실측값 |
|---|---|
| Vercel team / project | `byite`(`team_9wQHbXANVNEThyJrl87TWyYl`) / `ssambership-web`(`prj_1esRN0q6npJ4BJUEqFeloX9kTTOf`, Next.js, node 24.x, region iad1) |
| **현재 production** | `ssambership.com`·`www.ssambership.com` = `dpl_7PkNtBrAaKs2GjcDxDKvHg1X8o5a` ← **`main` tip `ad076d296ce46a8f7ae0ec30c13200758862e6af`** (PR #47 merge, READY) |
| 배포 방식 | GitHub 연동 자동배포 — `main` push = production, 기타 브랜치 push = preview |
| 빌드 게이트 | W1~W4·Batch F 5개 커밋 전건 **preview 빌드 READY 실측**(turbopack) — 빌드 성공 증거 확보. 이외 별도 CI 필수 게이트는 미확인(오너 확인) |
| production 환경변수 | **열람 금지 범위 — 미실측.** production 이 참조하는 Supabase project 의 최종 확인은 오너 몫(계정 내 활성 프로젝트가 `lbeqxarxothkmzqvpudy` 단 1개라는 정황만 기록) |
| 무관 프로젝트 | `ssambership-full`·`byite-website` — 본 계획 범위 밖 |

### 5.2 제품 commit 배포 매트릭스 (커밋 체인 실측: 완전 선형)

`main(ad076d2, 현 production)` ⊂ `W1` → `W2` → `W3` → `W4` → `Batch F` (전 구간 fast-forward 가능,
main→Batch F 32커밋). **각 단계 커밋이 전부 원격 브랜치 tip 으로 실존**함을 ls-remote 로 확인했다.

| 단계 | commit | 브랜치(원격 tip 일치) | 내용 | DB 선행조건 | rollback 목표 commit |
|---|---|---|---|---|---|
| 현행 | `ad076d29` | `main` | production 기준점 | — | — |
| W1 | `609dafbd380575abb62f970e0cff5323def82e61` | `claude/s2-2-transition-w1-c1-c4-20260730` | C1~C4 (읽기·질문방 RPC) | M4·M5·M6 + **D-API-W** | `ad076d29` |
| W2 | `20b67e9f81183d8286a8baacbd907b515677bbe1` | `claude/s2-2-transition-w2-c5-c6-c11-20260730` | C5·C6·C11 (쓰기 전환) | M7·M8·M14 | `609dafbd` |
| W3 | `602cc53d74b4e36a94bdae239d4726efc325189b` | `claude/s2-2-transition-w3-c7-c8-20260730` | C7·C8 (자금) | M9 | `20b67e9f` |
| W4 | `b95f74ab2e00d0b7bfdba508baf4928775912eea` | `claude/s2-2-transition-w4-c9-c10-l20rej` | C9·C10 (fail-closed·프로빙 제거) | **M10 이후**(계약 순서 보존) | `602cc53d` |
| Batch F | `4ba9c00e6fd671e4481a5a5c781eec194b6bea6c` | `claude/s2-2-batch-f-final-sl82ck` | SQL·문서만(제품 코드 diff 0) — 웹 동작은 W4 와 동일 | — | `b95f74ab` |

- **안전한 단계별 배포 실제 방식(권고):** 각 단계에서 해당 브랜치를 `main` 으로 PR·review·merge
  (선형 체인이므로 순서대로 fast-forward 병합 가능) → Vercel 이 production 자동배포. merge 방식
  (PR squash/merge/rebase)과 review 절차는 오너 결정표 #1. **단계별 web rollback = 직전 단계
  commit 으로 재배포**(Vercel "Redeploy previous deployment" 또는 revert PR — 둘 중 정본 선택은
  오너 결정표 #1). Batch F 커밋은 제품 코드 무변경이므로 웹 배포 단위는 W4 까지다.
- 이번 세션은 PR·merge·배포를 일절 수행하지 않았다.

**WEB_RELEASE_PATH: RESOLVED** (경로·commit·rollback 목표 전건 특정. PR/review 방식만 오너 확정 대기)

---

## 6. 앱 배포·구버전 호환성

### 6.1 실측 (앱 repo `1c5d6c0`, Flutter)

| 항목 | 실측 |
|---|---|
| 스택·버전 | Flutter(Dart), `pubspec.yaml version: 0.1.0+4` (versionCode 4 — 이번 전환 브랜치에서 **의도적으로 미범프**) |
| Android | `applicationId com.ssambership.edu`, compileSdk 36/minSdk 24. **release 서명은 `android/key.properties`+keystore(레포·CI 부재, 오너 로컬 전용)에 의존** — keystore 부재 시 release 태스크가 GradleException 으로 차단(디버그 서명 AAB 방지 설계). CI(flutter-ci.yml)는 analyze+test 게이트 + `NOT-for-submission` AAB 만 생성. **signed native build 는 어떤 환경에서도 아직 미생산**(Gate 4 세션은 SDK 다운로드 자체가 egress 차단 — `BLOCKED_BY_ENV`, 대체 증거로 `flutter build web --release` 성공만 확보) |
| iOS | Xcode 자동 서명이나 `DEVELOPMENT_TEAM` 미설정·fastlane 없음·CI 없음 — macOS 수동 워크플로 문서(`docs/IOS_BUILD.md`)만 존재. 번들 ID 가 Android 와 불일치(`com.ssambership.app`) — 스토어 등록 전 정리 필요 |
| Gate 4 | `APP_GATE_4_LOCAL: PASS` — 로컬 스택 23/23(F2 멱등·동시 5호출 방 1행, F4 T-CONC-10 replay-first Storage DELETE 0, F5 `UPDATE_CONFLICT`, F6 soft-delete replay, M13 라벨 스푸핑 덮어쓰기, `core_private` PGRST106 거부 등) + `flutter test` 922 pass. `D_API_A_REMOTE: NOT_STARTED`·`READY_FOR_S2_2_BATCH_F: NO` 명시 |
| 직접 쓰기 | 앱 신규 커밋 기준 `community_posts` 직접 INSERT/UPDATE/DELETE **0건**(전부 `api_app_v1` F4/F5/F6·View), DB hard DELETE 보상 **제거 완료**(Storage 보상만 유지) |
| release branch 전략 | 미확정 — 현 브랜치는 작업 브랜치이고 기본 브랜치(main/master)는 이 세션에서 미조회(shallow 단일 브랜치 clone). CI 트리거는 `master` 대상 | 
| 강제 업데이트 수단 | **양측 모두 존재:** 클라이언트 게이트(`lib/core/version_gate/` — `min_supported_build` 정수 비교·force/recommend·fetch 실패는 차단 아님) + 서버(`mobile_app_version_policies` 실존, 현재 ios/android min=1·latest=1·store_url NULL) |
| 구버전 사용량·버전 분포 확인 방법 | **없음(미구현)** — DB 에 앱 버전 로깅 테이블 없음. Play Console/App Store Connect 통계 또는 별도 계측 필요(오너 결정표 #10) |
| 구버전 앱의 community_posts 직접 쓰기 | **판단 불가 — 배포된 구버전 빌드의 코드 기준선(스토어에 실제 배포된 커밋)이 미확정.** 전환 전 코드는 직접 INSERT + hard DELETE 보상을 포함했음이 Gate 4 문서 §2 에 실측돼 있으므로, 배포본이 전환 전 코드라면 직접 쓰기 트래픽이 존재한다고 가정해야 한다 |

### 6.2 게이트 판정 (지시서 §3.4 기준)

Android signed native build 미성공 + 구버전 차단 정책 미확정이므로:

```
APP_NATIVE_RELEASE_GATE: BLOCKED
OLD_APP_M16_CUTOFF_GATE: BLOCKED
```

해소 조건:
- **APP_NATIVE_RELEASE_GATE 해소:** 오너 환경(keystore + production .env)에서
  `flutter build appbundle --release` 성공 + versionCode 증분(+5 이상) + (iOS 병행 시) Xcode 팀
  설정·`flutter build ipa` 성공. 어느 하나라도 없으면 유지.
- **OLD_APP_M16_CUTOFF_GATE 해소:** ① 현재 스토어 배포본의 코드 기준선·버전 분포 확인 수단 확보
  ② 배포본이 버전 게이트를 포함하는지 확인(미포함이면 `min_supported_build` 상향으로도 차단 불가
  — 이 경우 차단은 M16 자체의 권한 회수가 유일한 수단이며 구버전 UX 는 오류 노출) ③ cutoff 기준
  (`min_supported_build` 를 신규 빌드 번호로 상향할 시점·유예 기간) 오너 확정. **M16 은 두 게이트가
  모두 해소되기 전에는 운영 적용 금지.**

---

## 7. R0~R7 단계별 원격 롤아웃 실행표

공통 규칙: 실행 경로는 전 단계 **`apply_migration`(원장 name = 파일 stem) 단일 경로**(임의
execute_sql DDL 금지 — 계약 §22 #9 는 rollback 에도 동일 적용). 각 단계 종료 시 증거(원장 행·
검증 출력·대시보드 캡처)를 `docs/audit/` 후속 문서에 보존한다. 승인 담당자는 오너 결정표 #11·#12
확정 전까지 전 단계 **오너 단독**으로 간주한다. DB 적용 전 필수 공통 선행 = R0 완료 + **D-1
드리프트 해소**(§3.4).

### R0 — 통합·동결·복구 준비 (미통과 시 DB 적용 금지)

| 항목 | 내용 |
|---|---|
| 목적 | 기준선 동결·복구 수단 확보·승인 체계 확정 |
| 작업 | ① 웹 5개 브랜치·앱 1개 브랜치의 PR/review/integration 방식 확정(#1) ② 운영 변경 동결 선언(스키마·정책·대시보드 설정 수동 변경 금지) ③ DB 기준선 재캡처(§3.2 스냅샷 + `pg_dump --schema-only` 권장) + migration ledger 캡처 + **Data API 설정 화면 캡처(Exposed schemas·auto-expose·Extra search path — §4 BLOCKED 해소)** ④ backup/PITR 확인·restore point 생성(#3) ⑤ synthetic fixture 계정 승인(#6) ⑥ rollout 시간창·담당자·중단 연락선 확정(#2·#11~#13) ⑦ **D-1 해소용 baseline 수렴 migration 별도 세션 작성·로컬 검증·승인** |
| 성공 기준 | 위 7건 전부 증거화 |
| 중단 기준 | backup/restore 수단 미확보 또는 D-1 미해소 |
| rollback | 해당 없음(상태 변경 없음) |

### R1 — 비파괴 기반과 웹 읽기 표면

| # | 적용 | 파일·SHA-256(§2.1) | 선행조건 | 잠금·영향 | 검증(읽기 전용/최소 쓰기) | 성공 기준 | 중단 기준 | rollback(역순) |
|---|---|---|---|---|---|---|---|---|
| 1 | M0 | `20260729211929…` | R0 | mentor_profiles 트리거 추가(순간 잠금) | 게이트 내장 + 트리거 2종 존재 | 내장 게이트 PASS | 게이트 예외 발생 | M0 rollback |
| 2 | M15 | `20260729211941…` | 없음(M0 병행 가능) | 함수 교체 | pair-party 가드 동작 확인 | 동일 | 동일 | M15 rollback |
| 3 | M1 | `20260730095435…` | M0 | 스키마 2종 신설(무접촉) | `api_web_v1`·`core_private` PUBLIC 권한 0 실측 | M4 이전 게이트 충족 | 권한 0 실패 | M1 rollback |
| 4 | M13 | `20260730095438…` | M0 + **D-1 해소** | comments 3행·community_comments board 행 백필 UPDATE(수 ms) + 트리거 설치 | §20.3 「M13 적용 직후」 ①~⑤ | 전건 PASS | `BATCH_B_BASELINE_OBJECT_MISMATCH` 등 게이트 예외 | M13 rollback (**§22 #8 forward-only: 라벨 백필 미복원 — 트리거·author_role·default 만 복원**) |
| 5 | M4 | `20260730095441…` | M1+M13 | View 5종 신설 | V1~V5 GRANT 매트릭스 | 생성·GRANT 일치 | 뷰 컬럼 오류 | M4 rollback |
| 6 | D-API-W | 플랫폼 단계(SQL 아님) | M1(권고: M4 후)·**C1 이전** | PostgREST config 반영 | §20.6.2: 노출 목록에 api_web_v1 포함·core_private 미포함 캡처 + 실요청 PGRST106/002 0 | 실요청 성공 | PGRST106/002 지속 | Exposed schemas 에서 제거→config 반영 확인 |
| 7 | W1 배포(C1~C4) | commit `609dafbd` | M4·M5·M6 적용 후가 정본 — **주의: C2~C4 는 M5·M6 필요이므로 W1 배포는 R2 의 M5·M6 이후로 이동하거나, M5·M6 을 R1 에 앞당겨 적용 후 배포**(권고: M5·M6 을 R1 말미에 포함) | 웹 재배포 | smoke: 커뮤니티 목록·멘토 찾기·지갑 조회 | 오류율 기준선 유지 | 5xx/PGRST 급증 | production 을 `ad076d29` 로 재배포 |

> W1 순서 주의는 계약 권고 직렬화(C1 은 M4 뒤, C2~C4 는 M5·M6 뒤)와 "웹 배포 단위 = W1 커밋
> 1개(C1~C4 동시)" 사이의 실무 차이다. **정본 판정: W1 커밋을 배포하기 전에 M5·M6 까지 적용을
> 완료한다**(그래프 위반 없음 — M5:M1, M6:M5).

### R2 — 공용 구현·앱 표면·웹 쓰기 전환

| # | 적용 | 파일·commit | 선행조건 | 검증 | 중단 기준 | rollback |
|---|---|---|---|---|---|---|
| 1 | M5 | `20260730105244…` | M1 | F10 동시성(T-CONC-01 상당은 브랜치/로컬에서 기실행 — 원격은 존재·GRANT 확인) | 게이트 예외 | M5 rollback(M6·M9·M17 rollback 후에만) |
| 2 | M6 | `20260730105248…` | M5 | F1·F2·F3·F9·V6·V7 identity | 동일 | M6 rollback |
| 3 | M7 | `20260730105252…` | M1 | B-1~B-4·F4/F5/F6 존재·GRANT | 동일 | M7 rollback(M16·M17 rollback 후에만) |
| 4 | M17 | `20260730112525…` | M5+M7, §20.3 M17 이전 ①~⑤(community_posts 기반 컬럼 전수 대조 포함) | 「M17 적용 직후」 ①~⑦(api_app_v1 7객체·anon 0·core_private 복제 0) | `UNEXPECTED_EXISTING_CONTRACT_OBJECT` | M17 rollback(§8.2 플랫폼 선행 절차 필수) |
| 5 | D-API-A | 플랫폼 단계 | M17 직후 검증 전건 PASS | api_app_v1 실요청 성공 + core_private PGRST106 거부 캡처 | PGRST106/002 지속 | 노출 제거→config 반영 |
| 6 | 신규 앱 배포 + Gate 4 canary | 앱 commit `1c5d6c0` 기반 release 빌드(버전 +5 이상) | **APP_NATIVE_RELEASE_GATE 해소** + D-API-A + 스토어 검수 | Gate 4 대표 시나리오를 운영 canary(내부 테스트 트랙/단계적 출시)로 재현 | 시나리오 실패 | 스토어 단계적 출시 중단·구버전 유지(앱은 store rollback 불가 — 하위 §11) |
| 7 | M8 | `20260730112528…` | M1 | F7/F8 identity·밴드 상수 | 게이트 예외 | M8 rollback(M11·M12 rollback 후에만) |
| 8 | M14 | `20260730112531…` | M1 | F13 identity·마스킹 | 동일 | M14 rollback(M11 rollback 후에만) |
| 9 | W2 배포(C5·C6·C11) | `20b67e9f` | M7·M8·M14 + D-API-W | smoke: 글 작성(F4 멱등)·프로필 저장·정산계좌 | 쓰기 실패율 급증 | production 을 `609dafbd` 로 |
| 10 | M9 | `20260730120103…` | M5 + §20.3 M9 이전(F12 사전 검사: succeeded 구독 결제 중 room 부재 건 탐지 — 원격 실측 후 보정) | F11 3층·F12 존재·service_role 전용 | 사전 검사 미통과 | M9 rollback(코드 우선 — §22 #3) |
| 11 | W3 배포(C7·C8) | `602cc53d` | M9 | smoke: 테스트 소액 충전(F11 duplicate 재생)·구독 확정 멱등 | 차감 오류 1건이라도 발생 | production 을 `20b67e9f` 로 + **write freeze**(§8.7) |

### R3 — 직접 쓰기 제거 증명 (증거 없이 M11·M12·M16 진행 금지)

실제 배포 상태에서 증명할 항목과 방법:

| 증명 항목 | 방법(읽기 전용/최소 쓰기) |
|---|---|
| 웹 community_posts/mentor_profiles/mentor_plans/payout 직접 쓰기 0 | W2 코드 정적 증거(감사 문서) + 운영 관측: pg_stat_statements 에서 해당 테이블 직접 INSERT/UPDATE/DELETE 문(비 RPC 경로) 검색·API 로그 표본 |
| 앱 community_posts 직접 쓰기 0 · DB hard DELETE 보상 0 | 신규 앱 코드 증거(Gate 4 §2·§3) + **구버전 트래픽 관측**(아래) |
| 허용 service_role 예외 목록·실호출량 | 예외 목록(W2·W4 감사 문서의 C-경로 7종 + `communityModerationCore.ts`) 대비 pg_stat_statements 호출량 대조 |
| 앱 Gate 4 대표 시나리오 | canary 트랙에서 F2 멱등·F4 replay-first·F5 충돌·F6 soft-delete 재현 |
| 응답 유실 replay-first | F4 동일 멱등키 재호출 → 같은 post_id·행 1건·Storage DELETE 0 |
| 결제·구독 멱등·차감·room 수렴 | F11 duplicate 무음 재생·F12 재생 Phase 판정·room_id 수렴(synthetic fixture — 오너 결정표 #6 승인 계정만) |
| 구버전 앱 버전 분포·직접 쓰기 트래픽 | **현재 수단 없음(#10 미해소 시 R3 BLOCKED)** — Play/App Store 통계 또는 `get_mobile_app_version_policy` 호출 로그 근사 |

### R4 — 권한 축소 (W2·앱 전환 실배포 후에만)

| # | 적용 | 선행조건 | 검증 | rollback |
|---|---|---|---|---|
| 1 | M11 | §20.3 M11 이전 ①~④(F7·C6 전환 + M14·C11 전환 + 백업 upsert 제거 + 직접 쓰기 0 실측) | 내장 직후 게이트(SELECT-only) + 웹 프로필 저장 smoke | M11 rollback(GRANT 6종 복원 — MAINTAIN 비복원 유의) |
| 2 | M12 | F8·C6 전환 + 플랜 직접 쓰기 0 실측 | 동일(mentor_plans) | M12 rollback |

### R5 — HD-1 최종 잠금 (하나라도 없으면 M16 = BLOCKED 유지)

| 필수 선행조건 | 상태(계획 시점) |
|---|---|
| 신규 앱 native signed build 성공 | **BLOCKED**(§6.2) |
| 신규 앱 배포 완료 | 미착수 |
| Gate 4 canary PASS(운영) | 미착수(로컬만 PASS) |
| 구버전 직접 쓰기 트래픽 0 또는 강제 최소 버전 적용 | **BLOCKED**(#10) |
| old app rollback/차단 전략 확정 | 미확정(#10) |
| M16 rollback 정책 6종 복원 SQL 검증 | 로컬 왕복 검증 PASS(Batch F — 정책 6종 원문 재생성 포함). 원격 정책 6종 이름 실측 일치(§3.4 D-3) |
| §14.7 확대 게이트 7단계 + M17 + D-API-A + 앱 Gate 4 | 계약 §20.3 M16 행 — "M17 적용 직후 M16 실행 금지" 명시 |
| 오너 명시 승인 | 대기 |

적용: M16 (`20260730195153…`). 내장 사전 게이트(정책 6종 identity·ACL 7종·F4/F5/F6 존재·
service_role 기준선 캡처)와 직후 게이트(SELECT-only·쓰기 정책 0·SELECT 정책 불변·svc 불변)가
파일에 내장돼 있다.

### R6 — 최종 assertion

| # | 적용 | 내용 |
|---|---|---|
| 1 | M10 (`20260730195156…`) | **상태 0 읽기 전용 checkpoint — rollback 파일 없음(§22 #2).** M10 자신 제외 active predecessor 15개(M0·M1·M4~M9·M11~M17) 전건 적용 + 플랫폼(D-API-W/A)·제품 전환 게이트 완료 후 실행. 검사 A~J(스키마 경계·api_web_v1 14fn/5view·core_private 6fn 외부 0·api_app_v1 7객체·SECDEF census). **M10 은 Data API 노출 목록·HTTP 를 판정하지 않는다(§21.10)** — 그 증거는 D-API 플랫폼 단계에서 별도 보존. 실패 시: 상태 변경이 없으므로 rollback 불요 — 원인 교정 후 재실행 |

### R7 — 최종 웹 전환

| # | 적용 | 내용 |
|---|---|---|
| 1 | W4/Batch F 배포(C9·C10) | production 을 `4ba9c00e`(제품 코드는 W4 `b95f74ab` 와 동일)로. **계약 순서 보존: C9·C10 은 M10 이후** |
| 2 | 검증 | account-status fail-closed(§11.5 — 조회 오류·행 부재 시 active 0) · runtime schema probing 0(프로빙 helper 6종 삭제 확인) · permission-error fallback 0 · 최종 모니터링 + synthetic smoke(#6 계정) |
| 3 | 종료 판정 | 모니터링 관찰 시간(#14) 경과 후 "rollback 가능 시간창 종료"를 오너가 선언 — 이후 rollback 은 §8 역순 표가 아닌 사고 대응 절차로 전환 |

---

## 8. rollback 계획 (역순 통합표)

### 8.1 정본 역순 (계약 §22 #2 — §20.2.1 역방향, M10 은 대상 아님)

제품 rollback 이 **항상 DB rollback 보다 선행**한다(§22 #4 — 반대 순서는 즉시 장애).

| 역순 | 단계 | 실행 내용 |
|---|---|---|
| 1 | W4/BatchF 웹 → W3 | production 재배포 `602cc53d` (C9·C10 회수) |
| 2 | M16 | rollback: community_posts GRANT 복원 + **정책 6종 원문 재생성**(한글명 2종 포함) |
| 3 | M12 → M11 | GRANT 복원 migration(§22 #6 — 비SELECT 6종·역할 2종 문자 그대로) |
| 4 | W3 웹 → W2 | `20b67e9f` (C7·C8 회수 — 코드 우선 §22 #3) |
| 5 | M9 | F12·F11(v2) DROP + 레거시 020 구 본문 복원 |
| 6 | W2 웹 → W1 | `609dafbd` (C5·C6·C11 회수) |
| 7 | M14 → M8 | F13·F7/F8 DROP |
| 8 | **앱 호출부 복원 → api_app_v1 호출 0 실측 → D-API-A 노출 제거 → config 반영 확인 → M17 DROP(wrapper→View→schema) → schema cache reload** | §22 M17 필수 선행 6단계 — **노출이 남은 스키마를 먼저 DROP 금지** |
| 9 | M7 → M6 → M5 | 공용 구현·self RPC·F10 DROP (M17 rollback 완료 후에만) |
| 10 | W1 웹 → 현행 | `ad076d29` (C1~C4 회수) |
| 11 | D-API-W 노출 제거 → config 반영 확인 | — |
| 12 | M4 → M13 → M1 | View DROP → M13 부분 복원(§8.4) → 스키마 DROP |
| 13 | M15 → (M0 는 되도록 남긴다 — §20.5) | — |

각 rollback 실행도 `apply_migration` 단일 경로(원장 신규 행 append — forward 행 삭제·수정·
reverted 처리 금지). 목표 지점까지 되돌린 뒤 **M10 상당 읽기 전용 assertion 재실행 의무**(§22 #2).

### 8.2 Data API 역순 상세

`노출 제거 → 플랫폼 config 반영 확인 → 객체 DROP → NOTIFY pgrst, 'reload schema'` 순서를 어떤
경우에도 유지한다. **core_private 는 rollback 전 과정에서도 절대 노출하지 않는다.**

### 8.3 M13 forward-only 예외 (§22 #8)

rollback 범위 = ① snapshot 보호 트리거 제거 ② INSERT 트리거 2종 제거 ③ 트리거 함수 2종 제거
④ `comments.author_role` 제거 ⑤ `author_label` default 를 `'쌤버십 회원'` 으로 복원 — 까지만.
**라벨 백필 데이터는 복원하지 않는다**(과거 클라이언트 제공 라벨은 신뢰 불가 — 오너 확정
2026-07-30). 선재 컬럼 DROP·163/164 DROP·CASCADE·행 삭제 금지.

### 8.4 aclitem 표기 순서·실효 권한 대조법

- REVOKE ALL 후 GRANT 를 다시 쌓으면 `pg_class.relacl` 의 **aclitem 배열 문자 순서가 원본과
  달라진다**(추가 순서대로 기록). 문자열 비교로 "복원 실패" 를 판정하지 않는다.
- **정본 대조법:** ① `aclexplode(relacl)` 로 (grantee, privilege) 집합 전개 후 집합 비교, 또는
  ② `has_table_privilege(role, table, priv)` 역할×권한 매트릭스 실측 비교(Batch F 검증기의
  "aclitem 순서 정규화 대조 diff 0" 방식과 동일 원리).
- **알려진 비대칭(사전 승인 필요):** 원격 baseline 은 `arwdDxtm`(PG17 `MAINTAIN` 포함)이나
  rollback 은 계약 §22 #6 정본 6종+SELECT 만 복원 → rollback 후 anon/authenticated 의
  `MAINTAIN` 은 미복원. 실효 영향은 VACUUM/ANALYZE 류 유지보수 명령 뿐으로 클라이언트 역할에
  불필요(보안 강화 방향)하며, 대조 시 이 1비트 차이를 "승인된 차이" 로 기록한다.

### 8.5 결제·구독 데이터 rollback 금지/보존

- **데이터 rollback 은 없다**(§22 #8): F4~F8 이 만든 글·프로필·요금제 행, F11/F12 가 만든
  `payments`·`cash_ledger`·`subscriptions`·room 행은 정상 업무 데이터 — 어떤 rollback 에서도
  삭제·역기재하지 않는다. `cash_ledger` 는 append-only(§12.1) — 보정이 필요하면 역방향 행
  append 만 허용(오너 승인).
- M9 rollback 은 코드 우선 + 함수 DROP + 레거시 구 본문 복원뿐이며 데이터 무접촉(§22 #3).

### 8.6 rollback 중 호환성 매트릭스

§10 표를 사용한다. 핵심: 레거시 `public` 표면은 S2 전 구간에서 회수되지 않으므로(§22 #5,
M11/M12/M16 의 테이블 GRANT 회수 제외) **구 웹(W_n-1)·구 앱은 M11/M12/M16 적용 전까지 항상
동작한다.** M11/M12/M16 적용 후에 제품을 되돌릴 때는 반드시 해당 M 의 rollback 을 함께 역순
실행해야 한다(권한이 없는 구 코드 직접 쓰기가 42501 로 실패하므로).

### 8.7 발동 임계값·write freeze·PITR 선택 조건

| 항목 | 기준(오너 확정 전 권고 초안 — #13) |
|---|---|
| rollback 발동 | ① 자금 경로(F11/F12) 오차감·이중차감 **1건** ② 핵심 플로우(로그인·질문방·결제) 실패율이 기준선 대비 유의 급증 ③ PGRST106/002 가 reload 후에도 지속 ④ M계열 내장 게이트 예외 |
| write freeze | 자금 오류 원인 미상 시 즉시: 웹 결제·충전 진입 차단(제품 레벨) — DB 레벨 동결은 오너 승인 후 |
| backup/PITR 복구 선택 | rollback migration 으로 되돌릴 수 없는 손상(예: 백필 오적용으로 인한 데이터 훼손, 원장 불일치)이 확인된 경우에만. **restore 는 전체 DB 시점 복구이므로 이후 유입 데이터 손실을 오너가 명시 승인해야 한다.** 현 데이터 규모(§3.2)에서는 손실 창이 작으나 결제 데이터 1건이라도 있으면 원칙 동일 |

---

## 9. 검증기 census 결함 판정 (§5)

Batch F 보고의 구 배치 검증기 실패 4건(@187 실측 — B 38/39·C 22/23·D 11/13)을 전수 역기입한다.
**원인은 Batch F(M11·M12·M16·M10)가 아니라 Batch E(M9)의 함수 census 갱신**이며, @187 과 @191 의
수치는 동일하다(M11/M12/M16 은 함수·뷰를 만들지 않고 M10 은 읽기 전용).

| # | 검증기 | assertion ID | SQL 위치 | 기대 census | 현재(@187=@191) | 자기 배치 checkpoint 판정 | 최종 상태 권위 |
|---|---|---|---|---|---|---|---|
| 1 | Batch B | `M1 / 05 census api_web_v1=5 views/0 fn · core_private=0/0` | `scripts/verify/s2_2_batch_b_verify.sql:123-134` | api_web_v1+core_private fn 합 **0** | **20** (14+6) | @180 에서 PASS | M10 `M10_B_WEB expected 14`(`…195156….sql:83`) |
| 2 | Batch C | `M7 / 03c census api_web_v1=5뷰/9fn · core_private=5fn/0rel` | `s2_2_batch_c_verify.sql:119-128` | api_web_v1 fn **9** · core_private fn **5** | **14** · **6** | @183 에서 PASS | M10 `expected 14` / `M10_C_PRIV expected 6`(`:186`) |
| 3 | Batch D | `T-CON / 03 core_private 복제 0 + T-CON-07` | `s2_2_batch_d_verify.sql:103-110` | core_private fn **5** | **6** | @186 에서 PASS | M10 `expected 6` |
| 4 | Batch D | `M8/M14 / 06 F7·F8·F13 identity+…census 12fn` | `s2_2_batch_d_verify.sql:147-164` | api_web_v1 fn **12** | **14** | @186 에서 PASS | M10 `expected 14` |

- 함수 census 타임라인: B 후 0/0 → C 후 9/5 → D 후 12/5 → **E(M9) 후 14/6** → F 후 14/6(불변).
  M9 신설 3건 = `core_private.record_cash_topup_impl`(:155) · `api_web_v1.record_cash_topup_v2`(:255)
  · `api_web_v1.subscription_checkout_confirm_v2`(:332).
- **기능·보안 회귀가 아닌 이유:** 실패 4건은 전부 "자기 배치 시점의 함수 개수" 를 고정 상수로
  박아둔 census 비교이며, 각 assertion 의 기능·identity·GRANT 하위 조건(예: D#4 의 `v_cnt=3`
  F7/F8/F13 identity 절)은 최종 상태에서도 성립한다. 물리 정책 §9.7(L565-569)이 4건을 명시
  목록으로 확정("설계상 실패·기능·보안 회귀 0").
- **권장 원칙(채택):** 각 배치 verifier 는 해당 checkpoint(@180/@183/@186)에서 실행하고, 최종
  상태의 권위는 **Batch F verifier(23/23) + M10 assertion + phase-independent 기능 테스트**다.
- **완결 집합 선언:** 위 4행이 허용 실패의 전부다. 향후 재실행에서 **이 4행 외의 red 가 하나라도
  나오면 실제 회귀로 간주**하고 `FINAL_STATE_VERIFIER_CANON_UNRESOLVED` 로 차단한다.

**FINAL_STATE_VERIFIER_CANON: PASS** (설명되지 않은 red 0건 · 이번 세션 검증기 코드 무수정)

---

## 10. 웹·앱·DB 호환성 매트릭스

DB 상태 축: S0=현행(S2 미적용) · S_R1=M0~M4(+M5·M6)+D-API-W · S_R2=+M7~M17+D-API-A+M9 ·
S_R4=+M11·M12 · S_R5=+M16 · S_R6/7=+M10(상태 동일).

| 제품 \ DB | S0 | S_R1 | S_R2 | S_R4 | S_R5 이후 |
|---|---|---|---|---|---|
| 현행 웹(`ad076d29`) | ✅ | ✅ (레거시 표면 불변) | ✅ | ⚠️ 프로필·플랜 직접 쓰기 42501 (읽기 정상) | ⚠️ + 커뮤니티 쓰기 42501 |
| W1 | ❌ (V/F 부재) | ✅ | ✅ | ⚠️ 상동 | ⚠️ 상동 |
| W2 | ❌ | ⚠️ C5·C6·C11 실패 | ✅ | ✅ | ✅ |
| W3 | ❌ | ⚠️ | ✅ | ✅ | ✅ |
| W4/BatchF | ❌ | ⚠️ | ✅(계약상 C9·C10 은 M10 후 배포 원칙 — 기술적으로는 S_R2 에서 동작) | ✅ | ✅ |
| 구버전 앱(직접 쓰기 빌드) | ✅ | ✅ | ✅ | ✅ (community 는 아직 열림) | **❌ 쓰기 전면 42501 — M16 이 유일 차단 지점** |
| 신규 앱(`1c5d6c0`) | ❌ (api_app_v1 부재) | ❌ | ✅ (M17+D-API-A 후) | ✅ | ✅ |

읽기 경로는 전 조합에서 유지된다(레거시 SELECT 불회수·V/View 는 추가형). ⚠️ = 부분 기능 저하,
❌ = 핵심 플로우 실패. **결론: 각 웹 배포는 대응 M 적용 직후로, M11 이후의 제품 rollback 은 반드시
해당 M rollback 과 동행해야 한다.**

---

## 11. 구버전 앱 / M16 위험 분석

1. **구버전 앱은 M16 이전까지 계속 직접 쓰기가 가능하다** — M11/M12 는 커뮤니티에 무관하므로
   구버전 앱의 게시글 INSERT·보상 hard DELETE 는 M16 적용 순간까지 살아 있다. M16 적용 순간
   구버전 앱의 글쓰기는 42501 로 즉사하며, 구버전에는 이 오류의 UX 처리가 없다.
2. **앱은 웹과 달리 즉시 rollback 이 불가능하다** — 스토어 배포는 전파에 시간이 걸리고 구버전
   재배포는 versionCode 역행 불가. 따라서 앱 전환은 "신규 배포 → 점진 확대(단계적 출시) →
   구버전 소멸 관측 → M16" 순서만 안전하다.
3. **cutoff 수단은 이미 서버·클라이언트 양측에 존재**(§3.4 D-6 + §6.1): `min_supported_build`
   상향으로 강제 업데이트 화면 전환. 단 **현재 스토어 배포본이 버전 게이트 코드를 포함하는지
   미확정** — 미포함 빌드에는 이 수단이 통하지 않으며, 그 경우 M16 의 권한 회수가 사실상의
   차단이 된다(오류 UX 감수 여부는 오너 판단).
4. **관측 공백:** 구버전 사용량·버전 분포·직접 쓰기 트래픽을 잴 수단이 현재 없다. 스토어 콘솔
   통계 확보 또는 임시 계측(예: PostgREST 로그·pg_stat_statements 표본) 확정 전에는 R3 의
   "구버전 직접 쓰기 0" 증명이 성립하지 않는다.
5. **iOS 는 배포 파이프라인 자체가 미구축**(팀 미설정·수동 워크플로) + Android/iOS 번들 ID
   불일치 — 스토어 검수 리드타임(수일)을 rollout 시간창에 반영해야 한다.
6. 결론: **M16 은 APP_NATIVE_RELEASE_GATE·OLD_APP_M16_CUTOFF_GATE 해소 전 운영 적용 금지**
   (지시서 §3.4 판정 유지).

---

## 12. 오너 결정표 (추정 금지 — 전건 미확정은 UNRESOLVED)

| # | 결정 항목 | 상태 | 비고 |
|---|---|---|---|
| 1 | 웹·앱 PR/review/integration 방식 | **UNRESOLVED** | 웹은 선형 체인이라 순차 PR fast-forward 병합 가능(§5.2). 앱 기본 브랜치·병합 절차 미확정 |
| 2 | 운영 rollout 시간창 | **UNRESOLVED** | — |
| 3 | backup/PITR restore point 승인 | **UNRESOLVED** | 플랜·PITR 가용 여부 자체가 콘솔 확인 필요(§3.2) |
| 4 | Data API exposed schemas 변경 승인(D-API-W/A) | **UNRESOLVED** | 현재 목록 캡처(R0)와 함께 |
| 5 | Automatically expose new tables 상태 변경 여부 | **UNRESOLVED** | 현재 상태 미실측(§4) |
| 6 | 단계별 synthetic fixture 사용 승인 | **UNRESOLVED** | 운영 DB 에 fixture 계정 생성·정리 절차 포함 |
| 7 | Android signed build 환경 | **UNRESOLVED** | keystore·production .env 는 오너 로컬 전용(§6.1) |
| 8 | iOS build·배포 환경 | **UNRESOLVED** | DEVELOPMENT_TEAM·번들 ID 정리 포함 |
| 9 | 앱 최소 버전·강제 업데이트 정책 | **UNRESOLVED** | `min_supported_build` 상향 시점·유예 |
| 10 | 구버전 앱 M16 cutoff 기준 | **UNRESOLVED** | 버전 분포 관측 수단 확보가 선행 |
| 11 | 단계별 DB 적용 승인자 | **UNRESOLVED** | — |
| 12 | 단계별 web/app 배포 승인자 | **UNRESOLVED** | — |
| 13 | rollback 최종 결정자 | **UNRESOLVED** | 발동 임계값(§8.7 초안) 승인 포함 |
| 14 | 모니터링 관찰 시간 | **UNRESOLVED** | R7 종료 판정 기준 |
| 15 | production 웹이 참조하는 Supabase project 확정 | **UNRESOLVED** | 환경변수 열람 금지로 미실측(§3.1) — 정황상 `lbeqxarxothkmzqvpudy` 단일 후보 |
| 16 | **D-1 comments 드리프트 해소 방식** | **UNRESOLVED** | baseline 수렴 migration 승인(별도 세션 작성·검증) — R1 착수 전 필수 |

---

## 13. 운영 적용 금지 범위 (본 계획이 승인되기 전·후 공통)

- 오너의 별도 명시 승인 없는 운영·staging DB DDL/DML, `apply_migration`, 임의 `execute_sql` DDL
- Data API Exposed schemas·auto-expose·search path 변경
- Vercel production 배포·환경변수 변경 / 앱 빌드 업로드·스토어 제출
- 기존 migration 파일 수정·재번호·repair, 원장 행 삭제·수정·reverted 처리, 기존 branch 이동·재작성
- M16: APP_NATIVE_RELEASE_GATE·OLD_APP_M16_CUTOFF_GATE 해소 전 적용 금지
- M10 이전에 M10 실행 금지(활성 predecessor 15개 + 플랫폼·제품 게이트 완료 후에만)
- R0 미통과(특히 backup/restore 수단·D-1 해소) 상태의 어떤 DB 적용도 금지
- `core_private` 노출 — 전 단계·rollback 중 포함 영구 금지
- secret/env/key 파일 열람·기록 금지(이 세션 준수 — Vercel env 미열람, 키는 publishable key 만 사용)

---

## 14. 최종 판정

```
S2_2_BATCH_F_CANON: VERIFIED
REMOTE_DB_BASELINE: VERIFIED_READ_ONLY        # 단 D-1(comments.author_label 부재)이 R1 차단 — §3.4
DATA_API_BASELINE: BLOCKED                    # 세션 네트워크 정책으로 실측 불가 — R0 캡처로 해소, 설정 무변경
WEB_RELEASE_PATH: RESOLVED
APP_NATIVE_RELEASE_GATE: BLOCKED
OLD_APP_M16_CUTOFF_GATE: BLOCKED
FINAL_STATE_VERIFIER_CANON: PASS
REMOTE_ROLLOUT_PLAN: COMPLETE
READY_FOR_REMOTE_ROLLOUT_APPROVAL: NO         # BLOCKED 게이트 3종 + 오너 결정표 16건 해소 전 승인 회부 불가
READY_FOR_REMOTE_ROLLOUT: NO                  # 계획 세션 고정 판정 — 실제 원격 변경은 별도 세션·별도 승인
```

*작성: 2026-07-31 계획 세션 — 변경 파일 정확히 1건(본 문서). SQL·rollback·제품 코드·계약서 변경 0 ·
운영/staging DB 쓰기 0 · Data API 변경 0 · 배포 0 · PR 0.*
