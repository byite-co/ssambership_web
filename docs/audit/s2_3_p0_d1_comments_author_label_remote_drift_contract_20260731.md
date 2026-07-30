# S2-3 P0 D-1 — `comments.author_label` 원격 드리프트 해소 계약 정본 (2026-07-31)

> **세션 성격:** 계약 세션(읽기 전용 조사 + 해소 계약 정본화). 운영·staging DB DDL/DML 0 ·
> `apply_migration` 0 · Data API/PostgREST 설정 변경 0 · schema cache reload 실행 0 ·
> 신규/기존 migration SQL 구현·수정 0 · migration version 채번 0 · 웹·앱 제품 코드 변경 0 ·
> 배포 0 · native build 0 · PR 0. 원격 DB 접근은 **SELECT 기반 읽기 전용**만 수행했다.
> 이 문서 1건 작성·커밋·push 만 수행한다. 실제 수렴 migration 구현·적용은 **다음 세션**
> (baseline 수렴 migration 구현·로컬 왕복 검증)에서만 수행한다.
>
> **브랜치 기록:** 지시서 지정 브랜치 `claude/s2-3-p0-d1-comments-author-label-contract-20260731`
> 를 base commit `26678fc`(S2-2 정본)에서 생성·push했다(push 정책 사전 확인 — 허용 실측).
> 하네스 세션 기본 브랜치 `claude/s2-3-comments-author-label-drift-1lkt8a` 는 사용하지 않았다.

---

## 1. Scope and Repository Ownership

| 항목 | 값 | 판정 |
|---|---|---|
| 주 작업 저장소 | `byite-co/ssambership_web` (`git remote -v` 실측) | **G0 PASS** |
| 이전 정본 브랜치 | `claude/s2-2-remote-rollout-plan-jktelb` — checkout·`pull --ff-only` 후 HEAD `26678fcf27fe20950c65555a42e601968c6d8383` · worktree clean | **G1 PASS** |
| S2-2 정본 문서 | `docs/audit/s2_2_remote_rollout_plan_20260731.md` (554행) 실존 | **G1 PASS** |
| 작업 브랜치 | `claude/s2-3-p0-d1-comments-author-label-contract-20260731` — `26678fc` 에서 신규 생성(동명 선재 브랜치 없음 실측) | **G2 PASS** |
| 앱 기준점 | S2-2 §1.1 기록값 `1c5d6c0190534d8d17381c95cc701b2f87342c0d` (`claude/s2-2-app-transition-m17-gate4-afw0ag` tip) — shallow clone 후 해당 commit 을 **detached HEAD 읽기 전용** checkout (브랜치 생성·수정·commit·push 0) | **G3 PASS** |
| 원격 DB | `lbeqxarxothkmzqvpudy` (ssambership-staging, PostgreSQL 17.6) — S2-2 §3.1 identity 와 일치 | READ_ONLY |

앱 저장소에서 발견된 후속 필요사항은 §16.6 에 **기록만** 했다(이번 세션 앱 구현 0 — 실제로 필수
앱 변경은 없다는 판정).

---

## 2. Canonical Inputs

| 입력 | 위치 | 이 계약에서의 역할 |
|---|---|---|
| S2-2 원격 롤아웃 계획 정본 | `docs/audit/s2_2_remote_rollout_plan_20260731.md` §3.4 D-1 (L140) · §7 R0 ⑦ (L264) · §8.1/#12 (L374) · §8.3 (L385-390) · 오너 결정표 #16 (L520) | D-1 발견 원장·해소 전제 |
| M13 forward | `supabase/sql/20260730095438_comments_author_label_denormalize.sql` (SHA-256 `4d035c88…` — S2-2 §2.1 정본 고정) | 차단 지점·선행조건의 정본 |
| M13 rollback | `supabase/rollback/20260730095438_comments_author_label_denormalize_rollback.sql` (SHA-256 `0d0058df…`) | forward-only 예외 경계 |
| M4 forward | `supabase/sql/20260730095441_api_web_v1_read_views.sql` | V2 의 컬럼 의존(연쇄 차단) |
| 웹 계약 v1.1 | `docs/contracts/api_web_v1_contract_v1_1.md` §6 V2(L684-693) · §10.4(L695-699, L1633-1636) · §20.2(L2303) · §20.3(L2345) · §21.7(L2604-2623) · §22 #8(L2713) · 부록 C-2(L2990) | 컬럼 소유권·게이트·rollback 규칙 |
| 앱 계약 v1.1 | 앱 repo `docs/contracts/api_app_v1_contract_v1_1.md` L239 · L244-253 · L281 | 앱 표면·구버전 호환 규칙 |
| 레거시 SQL 원장 | `supabase/sql/016_p0_community_comments.sql` · `037_p1_community_board_v2.sql` · `051_…backfill.sql` · `129_shortform_author_label.sql` · `163_board_comment_canonical_bridge.sql` · `164_…convergence.sql` | 컬럼 계보 |
| manifest·인덱스·번들 | `docs/audit/sql_apply_manifest.md` · `docs/audit/apply_manifest_prod.md` · `supabase/sql/INDEX.md` · `supabase/bundles/` | 적용 이력·clean-install 산식 |
| 검증기 | `scripts/verify/s2_2_batch_b_verify.sql` · `s2_2_batch_c_verify.sql` · `sql_number_integrity.mjs` | 사후 판정 권위 |

---

## 3. Remote Read-Only Evidence

실측 시각 2026-07-30 UTC · 전 질의 SELECT 전용 · 사용자 콘텐츠 원문·개인정보 무출력.

### 3.1 컬럼 실체 (`pg_attribute`+`pg_attrdef` ↔ `information_schema.columns` 교차 — 완전 일치)

`public.comments` — **정확히 9컬럼**, `attisdropped` 은닉 0, generated/identity 0:

| # | 컬럼 | 타입 | NOT NULL | default | 비고 |
|---|---|---|---|---|---|
| 1 | `id` | uuid | Y | `gen_random_uuid()` | PK |
| 2 | `post_id` | uuid | N | — | FK→`community_posts` CASCADE |
| 3 | `author_id` | uuid | N | — | FK→**`auth.users`** CASCADE |
| 4 | `parent_id` | uuid | N | — | FK→`comments` CASCADE |
| 5 | `content` | text | Y | — | CHECK 제약 **없음** |
| 6 | `like_count` | integer | N | `0` | |
| 7 | `is_deleted` | boolean | N | `false` | |
| 8 | `created_at` | timestamptz | N | `now()` | |
| 9 | `legacy_comment_id` | uuid | N | — | 163 기원 · partial unique index |

**`author_label` 부재 · `author_role` 부재 · `updated_at` 부재.** 컬럼 comment/description 전무.
테이블 소유자 `postgres`, relkind `r`, RLS enabled `true`.

`public.community_comments.author_label` = text · NOT NULL · default `'쌤버십 회원'::text`
(ordinal 5) — **M13 게이트 ③ 요건과 정확 일치**(S2-2 D-2 재확인). `post_type`(NOT NULL)·
`updated_at`(NOT NULL, `now()`)·`canonical_comment_id` 실존.

### 3.2 데이터 상태 (집계만)

| 지표 | 값 |
|---|---|
| `comments` 전체 행 | **3** (author_id NULL 0 · is_deleted 0) |
| `comments` 중 `legacy_comment_id IS NOT NULL` | **0** — 3행 전부 직접 INSERT 기원(브리지 미러 아님). 라벨 미전송 클라이언트 경로(현 앱의 `{post_id, author_id, content}` payload)와 정합 |
| `comments.author_label` 데이터 | **원천 부재** — 컬럼이 없으므로 보존 대상 데이터 0 |
| `community_comments` 전체/board | 4 / 3 |
| `cc.author_label` NULL/빈 문자열 | 0 / 0 |
| `cc.author_label` distinct / default(`'쌤버십 회원'`) / max length | 2 / 3 / 6 — 비정상 길이·형식 0 |
| M13 백필 규칙 대비 상이 행(전체 4행 기준) | 3 — M13 적용 시 board 3행이 서버 규칙으로 **의도적으로 덮어써질** 예정(§22 #8 forward-only, 오너 확정 2026-07-30 — 보존 의무 없음) |

### 3.3 의존 객체 (이름 추정 아님 — 정의 실측)

| 객체 유형 | `comments.author_label` 참조 | 근거 |
|---|---|---|
| 함수/프로시저 | **0건** — 비시스템 전 스키마에서 `pg_get_functiondef` 본문에 `author_label` 포함 함수 0 (163/164 브리지 7종 포함 무참조 — 부록 C-2 결함과 정합) | `pg_proc` 전수 스캔 |
| View / MatView | **0건** — 뷰는 `public.due_payouts` 1건뿐(comments 무참조) · matview 0 | `pg_views`·`pg_matviews` |
| View 컬럼 의존 | **0건** | `pg_depend`×`pg_rewrite` (comments 컬럼 단위) |
| 트리거 | comments 4종(`trg_comments_write_guard`·`trg_comments_mirror_to_legacy`·`trg_comments_mirror_delete`·`trg_comments_refresh_count`) · cc 4종(`trg_cc_write_guard`·`trg_cc_sync_board_to_canonical`·`trg_cc_sync_board_delete`·`trg_community_comments_set_updated`) — 전부 enabled `O`, 라벨 컬럼 의존 0 | `pg_trigger` |
| RLS 정책 | comments 7종(`comments_admin_delete/select_all/update`·`comments_delete_own/insert_own/select_visible/update_own`) — 라벨 참조 불가(컬럼 부재) | `pg_policy` |
| 인덱스/제약 | 인덱스 4(pkey·legacy_comment_id partial unique·parent·post_created) · 제약 4(PK+FK3) — CHECK 0 · generated expression 0 | `pg_indexes`·`pg_constraint` |
| 163/164 브리지 | 7함수 전부 실존(게이트 ④ 충족). `cc_sync_board_to_canonical` 만 comments INSERT · `comments_mirror_to_legacy` 만 cc INSERT — 양쪽 INSERT 컬럼 목록에 author_label 없음(각 테이블 default 의존) | `pg_get_functiondef` 표면 스캔 |
| M13 신규 객체 선재 | 0 (함수 2종·트리거 4종 전무 — 게이트 ⑤ 충족) | `pg_proc`·`pg_trigger` |

### 3.4 migration 원장 (`supabase_migrations.schema_migrations`)

- **31행** — 최초 `20260702065122/add_users_notification_enabled`, 최종
  `20260720091401/p2_25_payout_scheduler_foundation_156` (S2-2 §3.3 과 완전 일치).
- **S2 행(≥20260729) 0건** — M13 을 포함한 S2 16종 원격 미적용 확정.
- `author_label` 이름 포함 원장 행 **0건**. comment 관련 1건(`101_community_comments_admin_moderation`)은 무관.
- **016·037·051·129·163·164 원장 행 전무** — 레거시 번호 파일은 전부 원장 밖 경로로 적용됨.
  129(2026-07-19)·163/164(2026-07-21)는 `sql_apply_manifest.md` L205·L226-227 에 수동 staging 적용
  기록이 있으나, **037 의 원격 적용 기록은 어떤 문서에도 없다.** `comments` 테이블 생성 주체·시점을
  확정할 원격 증거 없음 → **UNKNOWN** (수동 적용 단정 금지 원칙 준수).
- M13 이 기대하는 선행 M0(`20260729211929`)도 미적용 — R1 배치 순서 소관(드리프트 아님).

### 3.5 Data API 관련 DB측 실측

`pgrst_ddl_watch`·`pgrst_drop_watch` event trigger **실존** — Supabase 플랫폼의 DDL 시
PostgREST schema cache 자동 reload 장치가 DB 레벨에서 확인됨(§15 판정 근거). Exposed schemas
현재 목록 실측은 S2-2 §4 와 동일하게 이 세션에서도 범위 밖(BLOCKED 유지 — R0 캡처 항목).

---

## 4. Local SQL History

### 4.1 계보 분류 (지시서 §4.1 분류 체계)

| 분류 | 실측 |
|---|---|
| **테이블 생성 원장** | `public.comments` 를 생성하는 파일은 **037 이 유일** — `create table if not exists public.comments (` (037:38), `author_label text not null default '쌤버십 회원'` (037:46), `updated_at timestamptz not null default now()` (037:48), `comments_content_len_chk` (037:49). 016 은 **다른 테이블**(`community_comments`)을 생성(016:10-25, author_label 016:17) |
| **후속 스키마 변경** | `ALTER TABLE (public.)comments` 전수: 163:36-37(`add column if not exists legacy_comment_id` — 드리프트 테이블에도 적용 성공, 원격 9번째 컬럼의 기원) · 037:244(RLS enable) · M13 :123-124(author_role ADD·author_label default 정정 — 게이트 뒤) · M13 rollback :71/:77 · bundle_2:589(RLS 사본). **author_label·updated_at 을 comments 에 ALTER 로 추가하는 파일은 저장소 전체에 0건 · DROP COLUMN author_label 0건** |
| **데이터 백필** | 051 = `community_comments` 오타 백필 + `community_posts.category` 만(051:3-9, comments 무접촉) · M13 §D = comments 전행 + cc board 행(§22 #8 forward-only) |
| **웹 직접 테이블 접근** | §5 참조 |
| **웹 RPC 접근** | M7 :50·221-224(community_posts INSERT RPC — comments 무관) |
| **View·Function·Trigger 의존** | M4 V2 :152-165(`c.author_label` :161·`c.author_role` :162) · M13 함수 2종·트리거 4종 · M10 :340-358(assertion — `comments.author_label` default `'쌤버십 사용자'` 검사 :358) |
| **타입 정의** | 웹: 생성형 Supabase Database 타입 없음(`lib/supabase/client.ts:14` 무타입) — 수기 view-model 만(`CommunityBoardCommentNode.authorLabel`) |
| **계약 문서** | 웹 계약 v1.1 §6/§10.4/§20.2/§20.3/§21.7/§22#8/C-2 · 앱 계약 v1.1 L239·244-253·281 |
| **migration manifest** | `sql_apply_manifest.md`: 016/037/051 은 인벤토리만·적용 기록 없음(L101·125·140), M13 은 local 검증만(L257·290). `apply_manifest_prod.md`: clean-install 후보 C 175 파일에 037 포함(L13) — 신규 DB 에서만 정본 형상 성립. 번들 bundle_2 는 037 사본 포함(:383·391)이나 deprecated(L15-21)·동일 IF NOT EXISTS skip |
| **rollout 문서** | S2-2 §3.4 D-1 · §7 R0 ⑦ · 오너 결정표 #16. `INDEX.md` 는 001-059 만 다루며 author_label 무언급 |

### 4.2 129 의 계보 증언

`129_shortform_author_label.sql` 헤더(129:14-15)가 계보를 명문화한다: *"author_label 은 커뮤니티
게시판(037)·댓글(016)에만 존재했고 shortform_posts 에는 부재였음"* — 즉 저장소 정본 체계에서
`comments.author_label` 의 유일한 도입 경로는 037 의 CREATE 이고, ALTER 경로는 처음부터 없었다.

### 4.3 검증기 의존

`s2_2_batch_b_verify.sql`: T-M13-01(:216-232 — author_label text NOT NULL·default
`'쌤버십 사용자'`)·T-M13-01b(:247-263 트리거 4종)·T-M13-12/13(:163-201 백필 규칙·비대상 불변)·
T-M13-14(:234-245 SECDEF)·spoof 거부(:470·:500·:507-508)·V2 시그니처(:566)·rollback 검사
(:917-951). Batch C :701-702 재확인. `sql_number_integrity.mjs:112` 에 M13 스템 등록.
**드리프트 상태에서는 Batch B 구조 게이트가 첫 항목부터 실패한다.**

---

## 5. Web Caller Impact

### 5.1 현재 배포 웹 (production `main` = `ad076d29`)

| 경로 | 실측 | 원격 컬럼 부재(현 상태)의 실효 |
|---|---|---|
| 게시판 댓글 읽기 | `lib/community/communityBoardQueries.ts:450-451` — `.from("comments").select("id, …, author_label, …")` **명시 컬럼 직접 SELECT** | PostgREST 42703(column does not exist). :457 의 `/relation|does not exist/i` 처리기가 이를 **빈 목록으로 무음 변환** — 게시판 상세에서 댓글이 항상 0건으로 보임 |
| 게시판 댓글 쓰기 | `lib/community/communityBoardMutations.ts:191-197` — `.from("comments").insert({ …, author_label: input.authorLabel })` **클라이언트 산출 라벨 직접 INSERT** (`communityBoardActions.ts:257-270` 에서 라벨 계산) | PGRST204(schema cache 에 author_label 없음) → 댓글 작성 **전건 실패**(사용자에게 오류 노출) |
| 관리자 게시판 댓글 목록 | `app/(admin)/admin/(console)/community-content/page.tsx:242` — `select("*")`+`typeof` 가드 | 라벨 null 표시로 관용 동작(비파괴) |
| 신고 증거·검수 | `lib/admin/adminReportEvidence.ts:126-129` — author_label 미선택 | 무영향 |
| 레거시 `community_comments` 경로 | `communityQueries.ts:190-192`(read)·`communityMutations.ts:95-99`(write) | D-2 — 원격 컬럼 실존, 정상 |

**즉 D-1 은 "미래 M13 차단"에 앞서, production 이 이 프로젝트를 바라보는 한(오너 결정표 #15 의
정황상 단일 후보) 현재 배포 웹의 게시판 댓글 기능을 이미 파괴하고 있는 활성 결함이다.**
수렴 컬럼 추가는 이 두 경로를 즉시 수복한다(읽기: 행 반환 재개 · 쓰기: default/클라이언트 라벨로
성공 재개, M13 이후에는 트리거 권위로 대체).

### 5.2 HEAD (26678fc — W1~W4 포함 미래 코드)

`communityBoardQueries.ts:408-420` — 게시판 댓글을 `api_web_v1.community_comments_v1`(V2) 로
읽고 **fallback 이 없다**. V2 는 M4 산물이고 M4 는 M13 뒤·M13 은 컬럼 뒤다. 즉 W1 이후 웹은 이
계약의 수렴 → M13 → M4 사슬에 hard 의존한다.

### 5.3 판정

- 웹이 컬럼을 직접 읽는가: **YES**(배포 웹 명시 SELECT · HEAD 는 V2 경유)
- 웹이 컬럼을 직접 쓰는가: **YES**(배포 웹 INSERT — M16 lockdown 전까지 잔존, M13 후엔 트리거가 덮어씀)
- 수렴 컬럼 추가로 깨지는 웹 경로: **0건** (추가는 배포 웹에 순수 수복·HEAD 에 선행조건 충족)

**WEB_COMPATIBILITY: PASS**

---

## 6. App Read-Only Compatibility Impact

앱 정본 commit `1c5d6c0`(detached HEAD 읽기 전용) 실측:

| 질문 | 판정 | 근거 |
|---|---|---|
| 앱이 `comments.author_label` SELECT? | **YES(암시적)** — 게시판 댓글은 `comments` 테이블 `select('*')` (`lib/features/community/data/comments_gateway.dart:39`, 테이블 선택 `community_models.dart:230-233`). 명시 컬럼 SELECT 는 테스트 전용(gate4 :601-624) | 직접 확인 |
| 앱이 INSERT/UPDATE? | **NO** — board INSERT payload 는 `{post_id, author_id, content(, parent_id)}` 정확히(`community_write_repository.dart:162-174`; 주석 :126-127 "앱은 라벨을 권위값으로 전송하지 않는다"). 라벨 UPDATE 경로 전무 | 직접 확인 |
| 모델이 컬럼 존재를 필수 가정? | **NO** — `CommunityComment.fromMap` 은 `m['author_label'] as String?` 관용 접근(:217). 키 부재→null→표시 fallback(`communityAuthorName` :5-16, `'멘토'/'학생'/'쌤버십 회원'`). strict 필드는 `id` 뿐 | 직접 확인 |
| JSON decoding 이 컬럼 추가/삭제에 영향? | **NO** — 추가 키 무시·부재 키 null. text 컬럼이므로 비문자열 유입 불가 | 직접 확인 |
| 구버전 앱이 수렴 이후에도 동작? | **YES(계약·기전 근거)** — 라벨 포함 INSERT 는 default(수렴 직후)·트리거 덮어쓰기(M13 후)로 계속 성공(앱 계약 :281 명문 + Gate4 spoof 시나리오 PASS). 유일 파괴 표면은 라벨 UPDATE(M13 후 `COMMENT_PROTECTED_FIELDS_IMMUTABLE` 거부)인데 댓글 수정 기능은 이 트리에 부재 — 단 **스토어 배포본 코드 기준선 미확정(S2-2 §6.1)이라 구버전 전수 단정은 불가(UNKNOWN 잔존, 완충 수단 = version gate `min_supported_build`)** | 계약+실측 |

수렴 migration 자체(컬럼 추가)는 앱의 어떤 상태와도 충돌하지 않는다: 현 원격(부재)에서도 앱은
동작 중이고(라벨 null fallback), 추가 후에는 라벨이 표시되기 시작할 뿐이다.

**APP_COMPATIBILITY: PASS** · 앱 필수 후속 변경 **0건** (선택 항목만 §16.6 기록)

---

## 7. Drift Root Cause

### 7.1 드리프트 상태 비교표 (지시서 §7 정본 표)

| 기준면 | `comments.author_label` 기대 상태 | 실제 상태 | 불일치 | 근거 |
|---|---|---|---|---|
| 원격 DB | 존재 (text·NOT NULL·default `'쌤버십 회원'`) | **부재** (9컬럼 실측) | **YES** | §3.1 (`pg_attribute`↔`information_schema` 교차) |
| 초기 comments 원장 | 037 CREATE 로 도입 | 037 은 `IF NOT EXISTS` — 선재 테이블에서 **전체 skip**, ALTER 폴백 없음 | **YES**(무음 skip) | 037:38-50 · §4.1 |
| 후속 SQL | 없음(추가 경로 부재) | 163 만 `legacy_comment_id` 부분 수렴 — author_label ALTER 경로 저장소 전체 0건 | **YES**(수렴 불가 고착) | 163:36-37 · §4.1 전수 grep |
| SQL apply manifest | 037 원격 적용 기록 | **기록 없음** (016/037/051 인벤토리만) — 129/163/164 만 수동 staging 기록 | **YES**(이력 공백) | `sql_apply_manifest.md` L101·125·140·205·226-227 |
| S2-2 rollout plan | D-1 로 부재 기록 | 본 세션 실측과 **완전 일치** | NO(정합) | S2-2 §3.4 D-1 · §3.2 |
| M13 precondition | 게이트 ① — 존재·text·NOT NULL·default `'쌤버십 회원'` | 원격은 게이트 ① 위반(부재) · ②③④⑤ 는 충족 실측 | **YES**(① 단독) | M13 :56-66 · §3.3 |
| Web API contract | §10.4 ① "선재 컬럼 재사용 — 신규 아님" | 원격에 선재 컬럼이 없어 계약 전제 자체가 위반됨 | **YES** | v1.1 L695-699 · L1633-1636 |
| App API contract | "037 기원 선재 컬럼 — M13 신규 아님" | 동일 위반 | **YES** | 앱 계약 L244-253 |
| 웹 현재 코드 | 배포 웹이 명시 SELECT/INSERT | 원격 부재로 **현재 고장**(무음 빈 목록·쓰기 실패) | **YES**(활성 결함) | §5.1 |
| 앱 현재 코드 | `select('*')` 관용 소비 | 부재 시 null fallback 으로 동작(라벨 미표시) | NO(관용) — 단 기능 저하 | §6 |

### 7.2 근본 원인 판정

1. 원격 `comments` 는 **037 적용 이전에 다른 형상으로 선재**했다. 근거: 037 정본과의 차이가
   결손 3컬럼에 그치지 않는다 — 원격은 `post_id`/`author_id`/`like_count`/`is_deleted`/`created_at`
   가 nullable, `author_id` FK 대상이 `auth.users`(037 은 `public.users` NOT NULL),
   `comments_content_len_chk` CHECK 부재(§3.1). 이는 "037 이 만든 테이블에서 컬럼만 사라진"
   가설을 배제하고 **독립 생성 계보**를 증명한다. 생성 주체·시점은 원장·manifest 에 증거가
   없으므로 **UNKNOWN** 으로 고정한다(수동 적용 단정 금지).
2. 037 은 `CREATE TABLE IF NOT EXISTS` 단일 경로라 선재 테이블에서 **무음 no-op** 이 되었고,
   ALTER 폴백이 없어 정본 형상이 전파되지 않았다.
3. 이후 저장소의 어떤 파일도 `comments.author_label` 을 ALTER 로 추가하지 않는다(§4.1 전수).
   163 의 `legacy_comment_id` 만 `ADD COLUMN IF NOT EXISTS` 로 부분 수렴됐다 — 같은 기법이
   author_label 에는 존재하지 않았다는 것이 고착의 직접 원인.
4. M13·M4·M10·검증기·웹/앱 계약은 전부 로컬 clean-install(037 실행) 형상을 기준으로 정본화되어
   있어, 원격만 이 형상 밖에 남았다.

**DRIFT_ROOT_CAUSE_CANON: PASS** (방향 확정: 로컬 정본이 옳고 원격이 결손 — 원격을 정본으로
수렴시킨다)

---

## 8. M13 Failure Mechanism

### 8.1 정적 분석 (파일·계약 근거)

- **정확한 선행조건**: M13 게이트 ①(:56-66) — `information_schema.columns` 에서
  `comments.author_label` 존재 + `text`/`NO`/default `'쌤버십 회원'::text` 정확 일치.
  불일치 시 `RAISE EXCEPTION 'BATCH_B_BASELINE_OBJECT_MISMATCH: comments.author_label missing'`
  (:61) 또는 형상 상세 메시지(:64).
- **현재 원격 상태**: 부재(§3.1) → 게이트 ① NOT FOUND 분기 확정.
- **충돌 statement**: 게이트 DO 블록(:50-118) 그 자체 — 도달 전 어떤 DDL/DML 도 없다.
  게이트를 가정적으로 통과시켜도 :124 `ALTER COLUMN author_label SET DEFAULT` 와 :204-209
  백필 UPDATE 가 42703(undefined_column) 으로 실패한다.
- **오류 종류**: PL/pgSQL RAISE EXCEPTION — SQLSTATE **P0001**(raise_exception).
- **transaction 전체 rollback**: 파일이 `begin;`(:45)…`commit;`(:325) 단일 트랜잭션이므로
  게이트 예외 시 이후 전 문장이 25P02(in_failed_sql_transaction)로 무시되고 최종 `commit` 은
  ROLLBACK 으로 전환 — **수정 0건**(fail-safe 설계 그대로).
- **이후 migration 진행 불가**: M4 게이트가 `comments.author_role` 부재로 중단
  (`20260730095441…:68-73` — `BATCH_B_BASELINE_OBJECT_MISMATCH: M13 comments.author_role not
  applied`, 컬럼 매트릭스 :87 에 author_label 포함), 계약 위상(v1.1 L2303 `M4 : M1 + M13`)상
  V2·이후 C1 웹 전환 전부 불가. M10 assertion(:358)도 실패. **rollout 은 R1 #4(M13)에서 중단**
  되고 W1 배포(§5.2 HEAD 는 V2 무 fallback)로 진행할 수 없다.

### 8.2 로컬 격리 재현 (이번 세션 실측 — 원격 무접촉)

컨테이너에 선재하는 PostgreSQL 16.13 바이너리로 scratch 클러스터를 만들어(외부 다운로드·Docker
불사용 — 기존 차단 조건 우회 없음) M13 **원문 파일**을 실행했다. PG17 전용 구문이 없어 기전
재현에 유효하며, 정본 왕복 검증(PG17.6)은 다음 세션 소관으로 분리한다.

| Fixture | 구성 | 결과 |
|---|---|---|
| A — 원격 9컬럼 형상만 재현 | §3.1 형상 그대로(FK·RLS 생략) | `ERROR: P0001: BATCH_B_BASELINE_OBJECT_MISMATCH: comments.author_label missing` (게이트 DO 내 RAISE, 파일 :118 지점) → 이후 전 문장 25P02 → `commit` 이 **ROLLBACK** 전환 → 사후 검사: 추가 컬럼 0·함수 0·트리거 0 |
| B — 드리프트 comments + 게이트 ②~⑤ 충족 stub(163/164 이름·개수 일치 stub 함수 7종·트리거 7종·users/cc/seed) | ① M13 실행 → **동일 게이트 ① 중단**(①이 유일 차단 요인임을 실증) ② 수렴 문장 1건 `ALTER TABLE public.comments ADD COLUMN author_label text NOT NULL DEFAULT '쌤버십 회원';` 적용 ③ M13 원문 재실행 → **오류 0 · COMMIT 성공** | 사후: `author_label` default `'쌤버십 사용자'`(정정 완료)·`author_role` text NULL·백필 규칙 일치(닉네임/공백→`'쌤버십 사용자'`/admin→역할 NULL)·shortform 불변·spoof INSERT `'HACKED'`→`'학생하나'` 덮어쓰기·라벨 UPDATE→`COMMENT_PROTECTED_FIELDS_IMMUTABLE` 거부 |
| B — M13 중복 실행 | 성공 상태에서 재실행 | 게이트 ①이 `default='쌤버십 사용자'` 형상 불일치로 중단(**M13 은 재실행 불가가 설계** — §13 에 반영) |

fixture 한계(명시): PG16.13 · 브리지 stub · `anon`/`authenticated` 역할 수동 생성 · FK/RLS 생략.
기전(게이트 판정·트랜잭션 원자성·백필 규칙)은 버전 무관 PostgreSQL 계약이다.

**M13_FAILURE_MECHANISM: VERIFIED** (정적 분석 + 격리 재현 이중 증명 · 원격 쓰기 0)

---

## 9. Resolution Options

| 안 | 내용 | 검토 | 판정 |
|---|---|---|---|
| **A — 원격 형상 흡수** (컬럼 없는 9컬럼 형상을 정본으로 인정, M13·M4·계약 개정) | 컬럼을 정본에서 제거 | 계약 v1.1 §6 V2 shape·§10.4·§21.7 16개 테스트·M13/M4/M10 SHA-256 정본(S2-2 §2)·Batch B/C 검증기·**이미 push 된 W1~W4 웹 코드**(V2 무 fallback)·앱 계약이 전부 컬럼 존재를 전제 — 개정 파급이 전 계층에 미치고, **현재 배포 웹의 활성 고장(§5.1)도 해소하지 못한다** | **기각** |
| **B — 컬럼 데이터 보존 후 제거** | 백업·백필 후 DROP | **보존할 데이터 자체가 없다**(원격 컬럼 부재 — §3.2). 제거 방향의 문제는 A 와 동일. 성립 전제 부재 | **기각** |
| **C — 별도 baseline convergence migration 조건부 수렴** | M13 이전에 신규 migration 1건으로 컬럼을 037 정본 형상으로 조건부 추가 | M13 이전 실행 가능(위상 제약 신설만) · 컬럼 유무 양쪽 안전(분기 §11) · 재실행 안전(§13) · 기존 데이터 보존(ADD COLUMN default 채움 — 행·비대상 컬럼 불변) · **M13 바이트 무수정 유지**(SHA-256 정본 보존) · forward/rollback 책임 경계 명확(§12) · 격리 재현으로 유효성 실증(§8.2 B) | **채택** |

보조 판정 — "M13 을 `IF NOT EXISTS` 로 바꾸면 충분한가": **NO.** M13 은 author_label 을 ADD 하지
않으므로(신규는 author_role 1개 — :123, 계약 L1633-1636) 멱등화할 ADD 자체가 없고, 게이트 ①을
자동 보정으로 바꾸는 것은 fail-safe 설계 폐기 + 정본 SHA-256(S2-2 §2.1)·검증기·manifest identity
파괴 + 기존 SQL 수정 금지 원칙 위반이다.

**단일 정본안: C.** ("상황에 따라 선택" 없음)

---

## 10. Adopted Resolution Contract

> **정본 한 줄:** M13 직전에 신규 **baseline convergence migration(가칭 MC)** 1건을 추가하여
> `public.comments.author_label` 을 037 정본 형상(`text NOT NULL DEFAULT '쌤버십 회원'`)으로
> **조건부 수렴**한다. M13·M4·기존 SQL·계약 문서는 **바이트 무수정**.

| 계약 항목 | 확정값 |
|---|---|
| 수렴 대상 | `public.comments.author_label` **단독** |
| 명시 제외(비차단 잔여 드리프트 — §10.1) | `comments.updated_at` 부재 · nullable 5컬럼 · FK 대상(auth.users) · CHECK 부재 |
| 실행 위치 | R1 배치 내 **M13 직전**(M0·M15·M1 뒤 권장 — 유일 필수 제약은 "M13 이전"). 위상 그래프에 `M13 : MC` 추가, MC 자체 선행조건 없음 |
| M13 수정 여부 | **NO** — 기존 M13 파일·rollback·해시 불변 |
| version 채번 | **이번 세션 미배정**(금지 범위). 다음 세션 배정 — 권고: `20260730095436` 또는 `…095437` stem (M1 `…095435` < MC < M13 `…095438` 사전순 불변식 유지 → clean-install glob 순서에서도 MC 가 M13 앞) |
| 오류 식별자 | 기존 정본 `BATCH_B_BASELINE_OBJECT_MISMATCH` **재사용**(신규 식별자 채번 금지 — Batch B 지시 §8.4 관행) |
| 데이터 보존 | 필수 대상 없음(컬럼 데이터 원천 부재). 행 3건·비대상 컬럼은 ADD COLUMN 특성상 불변 |

### 10.1 비차단 잔여 드리프트의 처분 (은닉 금지 — 명시 기록)

원격 `comments` 의 나머지 037 불일치(§7.2-1)는 **S2 게이트·S2 파일 어디서도 검사·참조하지
않아 비차단**이다(`comments.updated_at` 은 S2-2 D-1 에서 이미 비차단 판정). 이번 수렴 계약의
범위에 **포함하지 않으며**, 오너 결정표 #16 의 부속 잔여 항목으로 이 문서가 기록을 보존한다.
후속 수렴 여부는 별도 오너 결정 사항이다(무단 확장 금지 — 최소 개입 원칙).

---

## 11. Forward Contract

MC forward 는 단일 트랜잭션·상태 분기형으로 다음을 **정확히** 수행한다(다음 세션은 이 표를
재량 없이 SQL 로 옮긴다):

| # | 사전 상태 | 동작 | 결과 |
|---|---|---|---|
| S1 | 컬럼 **부재** (원격 실측 상태) | `ALTER TABLE public.comments ADD COLUMN author_label text NOT NULL DEFAULT '쌤버십 회원';` 정확히 1문장 | 기존 행 default 채움 · 행 수·비대상 컬럼 불변 · M13 게이트 ① 충족 |
| S2 | 존재 + 037 정본 형상(text·NOT NULL·default `'쌤버십 회원'::text`) | **no-op** (NOTICE 기록) | clean-install·성공 후 재실행 경로 |
| S3 | 존재 + **M13 이후 형상**(text·NOT NULL·default `'쌤버십 사용자'::text` **그리고** `author_role` 존재) | **no-op** — default 재설정 **절대 금지**(M13 되돌림 방지 — §8.2 재현에서 필요성 실증) | M13 적용 후 재실행 경로 |
| S4 | 존재 + 타입 ≠ text | `RAISE EXCEPTION 'BATCH_B_BASELINE_OBJECT_MISMATCH: comments.author_label <실측 형상>'` — 수정 0건 중단 | 타입 강제 변환 금지 |
| S5 | 존재 + 그 외 형상(NULL 허용·예상 밖 default·S3 조건 부분 충족 등) | S4 와 동일 중단 | 자동 보정 금지 — 오너 회부 |

공통 규칙:
- **의존 객체**: S1 에서 컬럼 의존 객체는 원리상 존재 불가(§3.3 실측 0) — 처리 절차 불요.
  S2/S3 에서 어떤 객체도 접촉하지 않는다.
- **기존 데이터가 있는 경우**: S1 은 default 채움 외 무접촉(UPDATE 0)·S2/S3 은 완전 무접촉.
- **재실행**: 성공 후 상태는 항상 S2 또는 S3 로 판정되어 no-op — §13.
- **자가 검증(post-check)**: 종료 직전 author_label 존재·text·NOT NULL 그리고
  (default `'쌤버십 회원'` ∧ author_role 부재) ∨ (default `'쌤버십 사용자'` ∧ author_role 존재)
  를 assert. 불일치 시 RAISE(트랜잭션 전체 rollback).
- MC 는 `community_comments`·트리거·함수·GRANT·RLS·데이터에 일절 접촉하지 않는다.

---

## 12. Rollback Contract

**판정: CONDITIONAL** (완전 rollback 아님 · forward-fix 전용도 아님)

| 국면 | rollback 가부 | 내용 |
|---|---|---|
| MC 적용 후 · **M13 미적용** | **조건부 허용** | rollback 파일(다음 세션 작성)은 아래 하드게이트 전건 충족 시에만 `ALTER TABLE public.comments DROP COLUMN author_label;` 수행: ① `author_role` 부재 ② M13 함수 2종·트리거 4종 부재 ③ `api_web_v1.community_comments_v1`(M4 V2) 부재 ④ author_label default = `'쌤버십 회원'::text` ⑤ **전행 `author_label = '쌤버십 회원'`** (수렴 후 유입 행이 비default 라벨을 가진 경우 — 배포 웹 INSERT 재개 등 — 정보 손실 방지를 위해 거부) . 게이트 미충족 시 `RAISE` 중단 — forward-fix 만 허용 |
| **M13 적용 후** | **금지 (forward-fix only)** | 계약 §22 #8·M13 rollback 정본이 author_label 컬럼·정규화 라벨 데이터 보존을 명령 — MC rollback 은 M13 rollback 이 선행돼도 컬럼을 DROP 하지 않는다(라벨 데이터 손실 = 금지 항목). 역순 통합표(S2-2 §8.1 #12)는 `M4 → M13 → **MC** → M1` 로 갱신하되 MC 단계는 위 하드게이트로 자기방어한다 |
| 제3의 DB 일반화 | **제한** | 이 rollback 계약은 "실측 pre-state = 컬럼 부재"인 본 원격에 대해 원상복구를 보장한다. 컬럼이 선재하던 DB(예: clean-install)에서 MC 는 no-op 이므로 rollback 도 no-op 이어야 하나 런타임 추론만으로 "MC 가 추가했는지" 판별할 수 없다 → **R0 ③ 스키마 스냅샷(pre-state 캡처) 대조 없이는 rollback 실행 금지**를 절차 규칙으로 고정한다 |

rollback 불가 국면의 사유 명시: M13 이후 author_label 은 서버 정규화 라벨(보안 데이터 교정
결과)을 보유하며, 계약이 그 보존을 forward-only 로 확정했다(v1.1 L2713 — 오너 확정 2026-07-30).

---

## 13. Idempotency and Partial-State Rules

| 경우 | 기대 결과 |
|---|---|
| 최초 실행(원격 S1) | 컬럼 추가 · COMMIT |
| 실행 중 중단(오류·취소) | 단일 트랜잭션 원자성 — **부분 적용 상태 자체가 존재하지 않음**. 무변경 rollback → 재실행 = 최초 실행 |
| 이미 수렴된 DB 재실행(S2 — clean-install 포함) | no-op PASS |
| M13 까지 적용된 DB 재실행(S3) | no-op PASS · **default 불변**(`'쌤버십 사용자'` 유지) |
| 예상 밖 형상(S4/S5) | 수정 0건 중단 — 반복 실행해도 동일(상태 불변) |
| M13 자체의 재실행 | MC 소관 아님 — M13 게이트 ①이 적용 후 형상 불일치로 차단함을 재현으로 확인(§8.2). S2 절차상 M13 재적용은 계획에 없음 |

MC 는 위 전 경우에서 **몇 번을 어떤 순서로 실행해도 "S1 에서 정확히 1회만 효과"** 를 갖는다.

---

## 14. Lock and Operational Risk

| 항목 | 판정 | 근거 |
|---|---|---|
| lock 수준 | `ALTER TABLE … ADD COLUMN`= **ACCESS EXCLUSIVE**(comments 한정) — 순간 보유 | PostgreSQL 계약 |
| table rewrite | **없음** — constant default 는 PG11+ fast-path(attmissingval), 원격 PG17.6 실측 | §3.5 |
| 소요·차단 창 | 행 3건(§3.2)·의존 0(§3.3) — ms 단위. comments 쓰기(앱 직접 INSERT·브리지)는 그 순간만 대기 | 실측 |
| transaction 범위 | MC 전체 단일 트랜잭션(게이트+ALTER+자가검증) | §11 |
| statement_timeout | 불요(문장 1건·ms) | — |
| lock_timeout | **권고 5s** — 선행 장기 트랜잭션 뒤 lock queue 방치 방지. 초과 시 실패→재실행(§13 안전) | 운영 관행 |
| 적용 전 행 수 확인 | **YES** — §20.3 관행대로 comments·community_comments 행 수 캡처 → 적용 → 직후 행 수 불변 확인 | §17 |
| 적용 경로 | S2-2 §7 공통 규칙 동일 — `apply_migration` 단일 경로(원장 name = 파일 stem) · 임의 execute_sql DDL 금지 | S2-2 §7 |
| 적용 시점 | R0 통과 후 R1 배치 내 M13 직전. **단, §5.1 의 활성 고장(배포 웹 댓글 파괴)** 때문에 오너가 R1 이전 선행 단독 적용을 택할 수 있다 — 이 경우에도 R0 ③(스냅샷)·#16 승인이 선행조건(오너 결정 사항으로 회부, 본 계약은 양쪽 시점 모두 안전함을 보장) | §5.1 |

---

## 15. Data API and Schema Cache Impact

| 항목 | 판정 | 근거 |
|---|---|---|
| Exposed schemas | **무관** — 대상이 기노출 `public` 스키마 내 컬럼 추가. 노출 목록 변경 0. (이 판정은 DB측 사실만으로 성립 — 현재 대시보드 설정 실측 불가(BLOCKED)와 독립이며, 이로써 D-1 을 추측 PASS 처리하지 않는다) | §3.5 |
| schema cache reload | **필요** — 신규 컬럼을 PostgREST 가 인지해야 웹 명시 SELECT/INSERT 가 성공. 원격에 `pgrst_ddl_watch` event trigger 실존(자동 reload 실측) + §20.6.1 정본 절차대로 `NOTIFY pgrst, 'reload schema'` 를 적용 직후 명시 실행(이중 보장) | §3.5 · S2-2 §4 |
| RPC signature | **변화 0** — MC 는 함수를 만들지도 바꾸지도 않는다 | §11 |
| REST 응답 shape | `comments` 를 `select=*` 로 읽는 소비자(현 앱)에 `author_label` 키 **추가** — 앱 decoding 관용성 실측으로 무해(§6). 명시 컬럼 웹 경로는 42703/PGRST204 가 **해소**(수복) | §5·§6 |
| 판정 | **DATA_API_IMPACT: SCHEMA_CACHE_RELOAD** | — |

---

## 16. Implementation Handoff (다음 세션 지시 — 재량 0 목표)

1. **신규 파일 2건**(기존 파일 무수정):
   - `supabase/sql/<stem>_comments_author_label_baseline_convergence.sql` — §11 분기 그대로.
   - `supabase/rollback/<stem>_…_rollback.sql` — §12 하드게이트 그대로.
   - stem 채번: 다음 세션. 권고 `20260730095436` 또는 `…095437`(사전순 M1 < MC < M13 불변식).
     물리 정책(`docs/audit/s2_2_migration_physical_policy_20260730.md`) 채번 규칙 준수.
2. **오류 식별자**: `BATCH_B_BASELINE_OBJECT_MISMATCH` 재사용. 신규 식별자 채번 금지.
3. **정합화(신규 문서/파일로만 — 기존 문서 수정 금지 원칙 유지)**: `sql_number_integrity.mjs`
   스템 등록 방식 검토, `sql_apply_manifest.md`/`apply_manifest_prod.md` 에의 행 추가 방식,
   clean-install 산식 191→192, S2-2 의 "forward 16개"·Batch B 구성(M1·MC·M13·M4)·checkpoint
   재산정 — 이들 파생 갱신의 **정본화 방식 자체를 다음 세션 지시서가 확정**해야 한다(이 문서는
   갱신 필요 사실만 고정).
4. **로컬 왕복 검증(PG17.6 — 정본)**: ① clean-install 경로(037 실행 후 MC=S2 no-op)
   ② 드리프트 재현(**본 문서 §3.1 실측 형상 그대로** fixture — nullable·FK·CHECK 차이 포함) →
   MC(S1) → M13 → M4 연쇄 전건 PASS ③ MC rollback 왕복(하드게이트 포함) ④ 재실행 멱등(S2·S3)
   ⑤ `s2_2_batch_b_verify.sql` 통과. §8.2 의 PG16 stub 재현은 참고용이며 정본 검증을 대체하지
   않는다.
5. **원격 적용은 그 다음 단계** — R0(특히 ③ 스냅샷·⑦ 본 계약 승인 = 오너 결정표 #16) 통과
   전 금지. 적용 직후 §17 체크리스트 실행.
6. **앱 후속 필요사항(기록만 — 필수 0건)**: (a) `CommunityComment` 에 `author_role` 필드가
   없어 라벨 공백 시 역할 기반 fallback('멘토'/'학생')이 발동하지 않음 — 선택 개선(M13 백필+
   NOT NULL default 로 실사용 영향 0) (b) M13 원격 적용 후 Gate 4 M13 그룹 재실행(앱 계약
   L326·L689 — 호출 경로 재검증만, 테스트 권위는 웹 T-M13-01~16) (c) 구버전 스토어 배포본
   기준선 미확정(S2-2 §6.1)은 본 건과 무관하게 잔존 — 라벨 UPDATE 경로 존재가 확인되는 경우에만
   `min_supported_build` 상향으로 차단.

---

## 17. Verification Checklist

### 17.1 이번 세션 산출물 검증 (§12 지시)

- [x] `git status --short` / `git diff --stat` / `git diff --check` / `git diff --name-only` —
  변경 파일 **본 문서 1건** · SQL/제품 코드/앱 변경 0 · whitespace error 0 (커밋 전 실측)
- [x] 원격 DB 변경 0 (SELECT 전용) · migration 적용 0 · Data API/캐시 변경 0 · PR 0

### 17.2 다음 세션 — MC 적용 직후 원격 검증 (읽기 전용)

- [ ] `information_schema.columns`: `comments.author_label` = text · NO · `'쌤버십 회원'::text`
- [ ] `pg_attribute` 교차: attnum 10 신규 · attisdropped 은닉 없음
- [ ] comments·community_comments 행 수 = 적용 전 캡처와 동일(§14)
- [ ] 비대상 컬럼·트리거 7종(§3.3)·정책 7종·인덱스 4종 불변
- [ ] 원장 신규 행 1건(name = MC stem) — 기존 31행 무수정
- [ ] PostgREST: `NOTIFY pgrst, 'reload schema'` 후 comments REST 응답에 author_label 노출 ·
  배포 웹 댓글 읽기/쓰기 수복(§5.1 두 경로) smoke
- [ ] 이후 M13 진행 시: M13 자체 게이트 ①~⑤·직후 자가검증 ①~⑥ 전건 PASS(§8.2 B 재현과 동형)

---

## 18. Final Verdict

### 18.1 규명 질문 17건 판정표 (지시서 §6)

| # | 질문 | 판정 | 근거 |
|---|---|---|---|
| 1 | 원격 `comments` 에 `author_label` 존재? | **NO — 부재 확정** | §3.1 교차 실측 |
| 2 | 로컬 정본 baseline 이 존재를 기대? | **YES** | 037:46 · clean-install 175 포함 · 계약 §10.4 ① |
| 3 | M13 이 부재 전제로 ADD COLUMN 수행? | **NO** — 존재를 요구·신규는 author_role 1개뿐 | M13 :56-66·:123 · L1633-1636 |
| 4 | M13 그대로 실행 시 중단? | **YES** — P0001·수정 0건·전체 ROLLBACK | §8 (정적+재현) |
| 5 | 컬럼이 정상 기능에 실사용? | **YES** — 배포 웹 명시 SELECT/INSERT·계약 V2·M13 백필 대상·앱 표시 경로 | §5·§6 |
| 6 | 웹이 직접 읽거나 쓰는가? | **YES**(읽기·쓰기 모두 — 배포 웹) | §5.1 |
| 7 | 앱이 직접 읽거나 쓰는가? | **읽기 YES(암시적 `*`) · 쓰기 NO** | §6 |
| 8 | 기존 행에 보존할 데이터 존재? | **NO** — 컬럼 부재로 원천 부재(행 자체는 불변 보존) | §3.2 |
| 9 | 컬럼 삭제 시 정보 손실? | 현 상태 해당 없음(삭제 대상 부재). 수렴·M13 이후 삭제는 손실 **YES → 금지**(§12) | §12 |
| 10 | 컬럼 유지 시 계약 위반·중복 스키마? | **NO** — 유지가 곧 정본. cc.author_label 과의 이중화는 163/164+M13 이 계약으로 관리하는 의도된 비정규화 | §2 계약 |
| 11 | M13 `IF NOT EXISTS` 화로 충분? | **NO** | §9 보조 판정 |
| 12 | 별도 convergence migration 필요? | **YES** | §9·§10 |
| 13 | convergence 가 M13 보다 앞? | **YES** — `M13 : MC` 위상 신설 | §10 |
| 14 | M13 자체 수정 필요? | **NO** | §10 |
| 15 | rollback 원상복구 가능? | **조건부 YES** — M13 이전 하드게이트 충족 시만·이후 forward-fix only | §12 |
| 16 | 구버전 웹·앱 호환성 창 필요? | **NO** — 순수 additive·배포 웹은 즉시 수복·앱 관용 실증·구버전 라벨 INSERT 는 default/트리거 흡수 | §5·§6 |
| 17 | PostgREST/Data API cache 갱신 필요? | **YES** — schema cache reload(자동 장치 실측+명시 NOTIFY). exposed schema·RPC signature 변화 0 | §15 |

### 18.2 상태 블록

```
P0_D1_REMOTE_DRIFT_FACT: VERIFIED
COMMENTS_AUTHOR_LABEL_REMOTE_STATE: ABSENT
COMMENTS_AUTHOR_LABEL_CANONICAL_STATE: RETAIN     # 정본 유지 — 원격을 정본으로 수렴(추가)
DRIFT_ROOT_CAUSE_CANON: PASS                      # 선재 이형 테이블 + 037 IF NOT EXISTS skip + ALTER 경로 부재 (생성 주체 UNKNOWN)
M13_FAILURE_MECHANISM: VERIFIED                   # 정적 분석 + PG16 격리 재현 (원격 쓰기 0)
ADOPTED_RESOLUTION: C안 — M13 직전 신규 baseline convergence migration(MC)로
                    comments.author_label text NOT NULL DEFAULT '쌤버십 회원' 조건부 수렴 (M13 무수정)
BASELINE_CONVERGENCE_MIGRATION_REQUIRED: YES
M13_CHANGE_REQUIRED: NO
EXISTING_DATA_PRESERVATION_REQUIRED: NO           # 컬럼 데이터 원천 부재 (행·비대상 컬럼 불변은 설계 보장)
WEB_COMPATIBILITY: PASS                           # 수렴은 배포 웹 활성 고장의 수복이기도 하다
APP_COMPATIBILITY: PASS                           # 1c5d6c0 무변경 · 구버전은 계약·트리거 흡수 (배포본 기준선 UNKNOWN 잔존)
ROLLBACK_CLASS: CONDITIONAL                       # M13 이전 하드게이트 충족 시만 DROP · 이후 forward-fix only
DATA_API_IMPACT: SCHEMA_CACHE_RELOAD
FINAL_CONTRACT_CANON: PASS
READY_FOR_BASELINE_CONVERGENCE_IMPLEMENTATION: YES
READY_FOR_REMOTE_ROLLOUT: NO                      # 계약 세션 고정 판정 — 승인·구현·검증은 후속 세션
```

*작성: 2026-07-31 S2-3 계약 세션 — 변경 파일 정확히 1건(본 문서). 원격 DB 는 SELECT 만 수행 ·
앱 저장소는 정본 commit 읽기 전용 · 격리 재현은 세션 컨테이너 내 일회용 scratch 클러스터(폐기).*
