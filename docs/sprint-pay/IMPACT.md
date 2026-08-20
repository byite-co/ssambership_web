# IMPACT.md — 스프린트 사전 영향도 검토 (S-B 마이그레이션 · S-C 본인인증 게이트 · S-D~F 포트원 결제)

> 지시서 R1 수행 결과. **읽기 전용 검토** — 코드/DB 수정 0건, git 쓰기 0건, DB는 SELECT 계열만 실행.
>
> - 검토 기준: `ssambership_web` HEAD `83a5103` · `ssambership-app` HEAD `316d652` (양쪽 working tree clean)
> - DB: Supabase staging `lbeqxarxothkmzqvpudy` (ssambership-staging, ACTIVE_HEALTHY) — 카탈로그/함수 소스 SELECT 실측
> - **S-B/S-C 지시서 원문 미제공** → R1의 "예정 변경 요약"을 1차 소스로 평가했다. DDL 세부(NOT NULL 여부, FK on delete, 인덱스명)와 게이트 구현 방식(미들웨어 vs 레이아웃)이 확정되면 아래 조건부 판정을 재확인할 것.
> - 파일 인용은 레포 루트 상대경로. DB 인용은 `pg_get_functiondef`/카탈로그 SELECT 실측.

---

## 차단 이슈 (스프린트 착수 전 반드시 해소)

| # | 대상 | 이슈 | 근거 요약 |
|---|------|------|-----------|
| B1 | **S-D** | 포트원 단건결제를 기존 `confirm_subscription_checkout`(또는 v2)에 "그대로 연결"하면 **PG 청구 + 캐시 지갑 차감이 동시에 발생**한다. 정본 RPC에 `record_subscription_cash_debit`(지갑 차감)가 내장돼 있고, v2는 `payments.amount×100 = p_expected_amount_cents = mentor_plans.amount_cents` 3자 일치를 강제한다. PG 결제용 별도 경로(또는 원장 처리 분기 파라미터) 설계 확정 없이는 착수 불가. | 웹 W5 |
| B2 | **S-E** | 정기결제 크론이 **이미 존재**한다: `vercel.json` `/api/cron/subscription-renewal`(매일 18:10 UTC) → `process_subscription_renewal` = **캐시 지갑 차감** 갱신(실패 시 past_due + grace 2일). 빌링키 크론을 추가하면 동일 `subscriptions.current_period_end`를 두 배치가 경쟁 갱신 → **이중 청구/기간 이중 연장** 가능. 관할 분리(구독별 결제수단 판정) 또는 전환 계획이 선행돼야 한다. | 웹 W5·W7 |
| B3 | **S-C** | 게이트 예외 경로 목록이 확정돼야 한다. 특히 **앱 표면**(`/app/bridge/*`, `/app/community/shortform/new`, `/api/app-session/bootstrap`)이 게이트에 걸리면 "앱은 게이트 비대상" 전제가 깨진다(앱 유저는 `identity_verified_at IS NULL`로 정상 사용해야 함). 실존 라우트 기준 전수 목록은 W3 참조. | 웹 W3 |
| B4 | **S-C** | 앱 부팅이 fail-closed로 의존하는 RPC 3종 — `account_deletion_write_blocked`, `account_deletion_status_self`, `get_mobile_app_version_policy` — 에 신규 가드가 403을 내면 **앱 전체가 진입 불가**(blocked 화면)가 된다. 가드 대상에서 반드시 제외. | 앱 A2 |
| B5 | **S-B** | `payments` 8컬럼·`users.identity_verified_at`·`refunds.pg_cancellation_id`는 전부 **NULL 허용(또는 DEFAULT)** 이어야 한다. NOT NULL·무DEFAULT면 기존 부분-컬럼 INSERT(`ssambership_web/lib/subscribe/subscribeCheckoutService.ts:325` 등)가 즉시 실패한다. 또한 적용 직후 `npm run contracts:export` 재수출이 없으면 `contracts:verify`가 `$.migrations` 길이 불일치로 hard fail. | 웹 W2·W8 |
| B6 | **S-B/S-C (조건부)** | NICE 증빙 등으로 **새 Storage 버킷**을 만들 계획이라면: 삭제 사가의 버킷 커버리지(`ACCOUNT_DELETION_ALL_BUCKETS` + 수집 전략)에 등재하지 않으면 `computeUncoveredBuckets`가 잡아 **전 유저 탈퇴 real-run이 전면 차단**된다. R1 요약에는 버킷 추가가 없으므로 현재 계획 기준으로는 비발동. | 웹 W1 |

## S-B/S-C(및 S-D~F) 지시서 수정 제안

**S-B (DB 마이그레이션)**
1. 신규 컬럼 10종 전부 nullable(또는 DEFAULT) 명시. (B5)
2. 삭제 사가 파기 스텝: `identity_verifications`만이 아니라 **`billing_keys`(포트원 측 빌링키 해지 API 연동 포함)와 `nice_auth_tokens`(토큰 파기/만료)** 도 파기·해지 대상에 포함할 것 — 현행 익명화 함수(`anonymize_user_for_deletion`)는 users/mentor_profiles PII만 지우며, 신규 테이블 행은 어떤 스텝도 건드리지 않는다(탈퇴 후 실명·CI/DI·결제수단 잔존).
3. 신규 테이블 4종에 `account_deletion_write_guard`(adg_*) 트리거 부착 여부 결정 — 현행 부착 테이블은 cash_ledger·cash_wallets·community_posts·payments·question_messages·shortform_posts 6종(DB 실측). 미부착 시 탈퇴 진행 중에도 신규 행 삽입 가능.
4. `payments` 신규 pg_* 컬럼의 클라이언트 위조 방어: `payments_insert_intent` 정책(authenticated INSERT)은 `auth.uid()=user_id AND status IN ('pending','processing')` 행 술어만 검사(DB 실측)하고 테이블 단위 INSERT GRANT라 **클라이언트가 인텐트 생성 시 pg_provider/pg_tx_id/receipt_url 등을 임의 선입력 가능**. 서버 확정 경로가 이 컬럼들을 무조건 덮어쓰거나, 컬럼 단위 GRANT로 잠글 것.
5. 적용 후 절차를 지시서에 명문화: `contracts:export` 재수출, `docs/audit/remote_db_inventory_20260804/columns.json` 갱신(비교 스크립트 diff 방지), migration pack 규칙(`build_native_migration_pack.py`) 경유.
6. `payments.billing_key_id` FK가 `billing_keys`를 가리킨다면 같은 마이그레이션 내 **테이블 생성 → 컬럼 추가 순서** 보장.

**S-C (본인인증 게이트)**
7. `full_name`·`birth_date` 덮어쓰기는 **service_role(또는 SECURITY DEFINER) 경로 필수** — `users`에 authenticated UPDATE GRANT가 아예 없다(테이블 ACL `authenticated=arm`, DB 실측). `users_update_own` RLS 정책은 존재하나 GRANT 부재로 사실상 사문. `users_protected_columns_guard` 트리거는 full_name/birth_date를 보호하지 않고 service_role 경로는 통과시키므로 서버 덮어쓰기는 막히지 않는다.
8. 게이트 판독 컬럼 사용을 위해 `lib/auth/getCurrentProfile.ts:7`의 `USER_SELECT` 고정 문자열과 `lib/types/user.ts` `UserRow`에 `identity_verified_at` 수동 추가 필요(생성 타입 없음 → 자동 반영 경로 없음).
9. 만 14세 미만 보호자 인증 체인은 **가입 정책 변경을 동반**해야 한다 — 현행 가입은 만 14세 미만을 원천 차단한다(`app/signup/page.tsx:301-306`, D-AU-9 "본인확인 연동 전까지 차단"). 게이트만 만들면 14세 미만 유저가 애초에 존재하지 않는다.
10. `IDENTITY_REQUIRED` 에러는 HTTP 403 + **메시지 선두 대문자 토큰**으로 실을 것(예: message가 `IDENTITY_REQUIRED`로 시작). 앱 에러 매퍼가 전부 `PostgrestException.message` 선두 토큰만 읽는다(앱 A2). 앱 측 case 추가는 별도 작업으로 등록.
11. 게이트 활성화 순간 **기존 유저 전원이 `identity_verified_at IS NULL`** → 전원 강제 온보딩. 기능 플래그/단계 롤아웃/공지 계획을 지시서에 포함할 것.
12. "머니패스"라는 어휘는 웹·앱 코드 어디에도 없다(전수 grep 0건). S-C 원문에서 대상 기능(테이블/RPC/라우트)을 실명으로 특정해야 서버 가드 범위를 검증할 수 있다. 특히 **IQ 에스크로 RPC(캐시 소비)가 가드 대상에 포함되는지**가 앱 영향의 갈림길(앱 A3).

**S-D~F (포트원)**
13. 캐시 충전 orderId 규약 `cash-{uuid}-{ts}`가 3중으로 잠겨 있다(클라 regex 단일 소스 + 웹훅 `orderId.startsWith("cash-")` 게이트 + DB `record_cash_topup_v2`의 `^cash-(.+)-([0-9]+)$` 검증). 포트원 paymentId를 그대로 흘리면 전부 기각 — 포트원용 참조 형식을 별도 정의하거나 규약 개정을 명시할 것.
14. `confirm_subscription_checkout`의 `PAYMENT_STALE`(pending 30분 초과 거부)이 PG 웹훅 지연·비동기 승인과 충돌 가능 — PG 경로의 상태기계(pending/processing/succeeded/failed)와 시효 정책을 별도 정의.
15. 환불: 현행 `approve_refund_request_admin`은 DB 캐시 환급 전용이고 **PG 취소 API 호출 코드는 레포에 0건** — 포트원 취소 연계는 완전 신규 표면이며 `refunds.pg_cancellation_id` 기록 주체(관리자 액션? 웹훅?)를 지시서에 명시할 것.
16. 신규 포트원/NICE 서버 모듈에는 `import "server-only"`를 직접 부착할 것 — 신규 테이블 4종은 service_role로만 접근 가능한데, 경계를 기계적으로 강제하는 장치가 없다(`.dependency-cruiser.cjs:8` "어떤 규칙도 error 심각도를 갖지 않는다").
17. env 정책: 빌드타임 env 검증이 전무(전부 런타임 실패)하고, `NEXT_PUBLIC_*`는 빌드 시 인라인되어 **빌드 시점 미설정 = 배포본 영구 결손**. 포트원 키 6종+(secret/store id/channel key/webhook secret 등) 도입 시 배포 체크리스트 필수.

---

## 웹 레포 (ssambership_web)

### W1. 삭제 사가 레지스트리 strict성 — [위험도: 낮음] (버킷 신설 시나리오만 높음)

**판정: "테이블 4종 추가"만으로는 기존 탈퇴 플로우가 실패하지 않는다.** 사가의 strict 화이트리스트는 "user FK를 가진 테이블 목록"이 아니라 **Storage 버킷 커버리지**에 존재한다.

근거:
- 사가 상태기계는 DB 함수가 전이만 검증: `pending→locked→purging→storage_purged→finalized→auth_soft_deleted→completed` (DB 실측 `pg_get_functiondef(public.account_deletion_advance)` — 허용 전이 5쌍 외 `INVALID_TRANSITION` 예외).
- 파기 실행은 웹 워커가 오케스트레이션: `lib/account/accountDeletionWorker.ts:242-345` — 스텝은 ① Storage 객체 삭제(계획 기반) ② `forfeitWalletAndAnonymize`(지갑 몰수+users/mentor_profiles 익명화, `lib/account/accountDeletionAdapters.ts:463-476` → RPC `account_deletion_forfeit_and_anonymize`) ③ auth soft-delete. **"user_id FK 테이블을 순회 삭제"하는 루프나 테이블 레지스트리는 존재하지 않는다.**
- `account_deletion_verify_object_owners`는 테이블 검증이 아니라 **Storage 객체 소유자 3값 판정**('target'/'other'/'none') 함수다 (DB 실측 — `storage.objects`만 조회).
- users 행 자체는 삭제가 아니라 **익명화**된다 (DB 실측 `anonymize_user_for_deletion`: `full_name='탈퇴회원'`, `birth_date=null` 등 + `status='deleted'`) → 신규 테이블이 users를 FK로 참조해도(on delete 무엇이든) 삭제 충돌 자체가 발생하지 않는다.
- strict 관문의 실체: `lib/account/accountDeletionPurgePlan.ts:7-8` "수집 경로가 없는 버킷이 하나라도 남으면 real-run 자체를 금지" + `lib/account/accountDeletionBucketCoverage.ts:31-45` `ACCOUNT_DELETION_ALL_BUCKETS`(13종 정적 목록) − 커버리지 계산(`:161-180` `computeUncoveredBuckets`) → `lib/account/accountDeletionWorker.ts:145-166` `planBlockReason`이 `uncovered_buckets`로 차단.

발동 조건: **새 Storage 버킷을 커버리지 전략 없이 ALL_BUCKETS에 등재하면 전 유저 탈퇴가 차단**되고, 등재하지 않으면 스키마 지문 `buckets` 축 드리프트(`scripts/verify/baseline/run_local_stack_emulation.sh:106` STRICT 축) + 탈퇴 시 해당 버킷 미파기(개인정보 잔존). 테이블 추가만으로는 비발동.

부수 판정(중간, 컴플라이언스): 신규 4테이블의 행은 현행 사가 어느 스텝도 파기하지 않는다 → R1의 "identity_verifications 파기 스텝 추가"는 타당하며, billing_keys·nice_auth_tokens까지 확장 권고(수정 제안 #2). 파기 스텝을 `account_deletion_forfeit_and_anonymize`/`anonymize_user_for_deletion` 수정으로 구현하면 함수 본문 md5를 보는 계약 스냅샷 축(W8 참조)에 걸릴 수 있음 — 해당 함수가 critical 목록에 있는지는 미확인.

### W2. `select('*')`/타입 생성 파급 — [위험도: 없음] (nullable 전제 하)

**판정: ① 생성 타입 재생성 없이 빌드가 깨지는 구조가 아니다(생성 타입 자체가 없음). ② unknown key에 strict한 런타임 파서는 0건이다.**

근거:
- Supabase 생성 타입 파일 부재 — `database.types*`/`gen types` 스크립트 전수 탐색 0건, `package.json`에 타입 생성 명령 없음. 행 타입은 수동 2패턴: `type Row = Record<string, unknown>`(25개 파일, 예 `lib/subscribe/subscribeCheckoutService.ts:23`)와 수동 `UserRow`(`lib/types/user.ts:1-6` — 주석 "컬럼 늘어나면 동기화").
- `payments` 조회 전수 6지점: 유일한 리터럴 `select("*")`는 `lib/cash/cashQueries.ts:121-128`(반환 `Record<string, unknown>[]`), 나머지는 명시 컬럼/head-count. `users`는 행 반환 `select('*')` **0건**(유일 히트는 `lib/admin/adminDashboardExtended.ts:54-55` head-count). 레포 전체 `select("*")` 133지점 전수 확인 — 전부 키 개별 접근 소비.
- zod/yup 등 스키마 파서 0건 — `lib/validations/index.ts:1` `// 추후 zod 추가 예정`이 전부. `.strict()`/`.passthrough()` 0건.
- 신규 컬럼을 "쓰려면" `USER_SELECT`(`lib/auth/getCurrentProfile.ts:6-7`)·`UserRow` 수동 갱신 필요(수정 제안 #8).

발동 조건: 신규 컬럼이 NOT NULL·무DEFAULT일 때만 — `lib/subscribe/subscribeCheckoutService.ts:325`(부분 컬럼 INSERT)와 e2e 3곳 즉시 실패 (차단 이슈 B5).

### W3. 미들웨어/게이트 삽입 지점 충돌 — [위험도: 중간]

**현행 미들웨어의 역할 (실측, `middleware.ts` 전문 21줄):** `x-pathname`/`x-return-to` 헤더 주입 **단 하나**. Supabase 세션 접근 0, 리다이렉트 0. matcher는 정적 자산 제외 **`/api/*` 포함 전 경로**(`middleware.ts:18-20`).

**① users 행 생성 시점 → 무한 리다이렉트 위험: 낮음.**
- `public.users` 행은 **DB 트리거가 동기 생성**한다: `auth.users`의 `on_auth_user_created` 트리거 → `handle_new_auth_user()`가 `raw_user_meta_data`로 `public.users` INSERT (DB 실측 functiondef + `supabase/migrations/20260717044250_fix_xv01_signup_admin_provisioning.sql:12-56`). 웹 코드의 users insert/upsert는 **0건**이고 가입 후엔 검증만 한다(`lib/auth/syncAfterSignUpSession.ts:27-50`).
- 소셜 로그인(OAuth) 콜백은 **존재하지 않는다** — `signInWithOAuth`/`exchangeCodeForSession`/`auth/callback` 전수 grep 0건. 인증은 email+password 단일. 따라서 "콜백 직후 users 행 부재 → 게이트 선행" 경로 자체가 없다.
- 잔여 위험: 게이트가 `/onboarding/verify` 자신·NICE 콜백을 예외에 넣지 않으면 자기 자신으로 순환. 또한 게이트 판독 실패(profile null)를 "미인증"으로 처리하면 로그인 직후 일시적 세션 지연 시 오리다이렉트 — `requireRole`은 profile null이면 로그인으로 보낸다(`lib/auth/routeGuard.ts:41-58`)는 기존 관례를 따를 것.

**② 게이트 예외에서 빠지면 안 되는 경로 전수 (현재 라우트 트리 실존 기준):**
- 인증/계정: `/login`, `/login/student`, `/login/mentor`, `/admin/login`, `/signup`, `/forgot-password`, `/auth/update-password`, `/logout`(POST 전용 route), (신설) `/onboarding/verify` + NICE 표준창 콜백 라우트
- **앱 WebView 표면(게이트 비대상 필수)**: `/app/bridge/complete`, `/app/bridge/error`, `/app/community/shortform/new`, `/api/app-session/bootstrap` (차단 이슈 B3)
- 크론(3, `vercel.json` 실측): `/api/cron/subscription-renewal`, `/api/cron/individual-question-expiry`, `/api/cron/account-deletion` (인증은 CRON_SECRET — 세션 없음)
- 웹훅: `/api/toss/webhook` (+ 신설 포트원 웹훅). `/api/webhooks/*` 디렉토리는 **실존하지 않음** — R1이 가정한 경로명과 다르다.
- 결제 승인: `/api/toss/confirm`(세션 기반) — 미인증 유저의 "인증 → 충전" 순서를 강제할지 정책 결정 필요
- 그 외 `/api/*` 15종(reviews/mentors/question-room/mypage/community 등): JSON API에 리다이렉트 응답을 섞으면 클라이언트 fetch가 깨진다 → **게이트는 페이지 전용으로 설계**하고 API는 서버 가드(403)로 분리 권고
- 이미지/파일 프록시 route: **없음**(signed URL은 전부 서버 액션에서 발급 — `lib/storage/signedStorageUrl.ts:12` 등). 헬스체크 route: **없음**.
- 정책 판단 필요: `(public)` 그룹 40라우트(랜딩·커뮤니티 열람·legal 문서 등) — 특히 `/legal/*`는 온보딩 화면에서 열람할 약관류이므로 예외 권장.

**③ 삽입 위치 관련 실측:**
- 레이아웃 게이트에 얹는 경우: 레이아웃은 6개뿐이고 **루트 전용 라우트**(`/`, `/login/*`, `/signup`, `/dev/*`, `/app/*`)는 그룹 레이아웃을 타지 않는다. `(student)` 레이아웃은 이미 `x-pathname` 기반 4분기 조건부 게이트(`app/(student)/layout.tsx:30-89`)라 삽입 지점이 명확한 반면, `(public)` 레이아웃은 가드가 아니다(`app/(public)/layout.tsx:15-21`).
- 미들웨어에 얹는 경우: 현행 미들웨어는 세션을 전혀 읽지 않으므로 Supabase 클라이언트 도입 + matcher 재설계가 동반된다(아키텍처 전환 규모). 기존 `x-pathname` 계약(레이아웃 4곳+routeGuard가 의존)은 유지해야 한다.

발동 조건: 게이트 예외 목록 누락(특히 앱 표면·크론·웹훅·온보딩 자신) 또는 API 라우트에 페이지 리다이렉트 적용 시.

### W4. full_name/birth_date 덮어쓰기 충돌 — [위험도: 낮음]

**판정: 유저가 `full_name`·`birth_date`를 수정할 수 있는 경로가 웹·앱 어디에도 없다 → "인증 후 유저가 다시 수정"하는 양방향 오염 시나리오는 현행 코드로는 불가능.**

근거:
- DB 계층: `users` 테이블 ACL `authenticated=arm`(INSERT+SELECT, **UPDATE 없음**), 컬럼 attacl 전부 null (DB 실측 pg_class.relacl/pg_attribute.attacl). `users_update_own` 정책은 있으나 GRANT 부재로 직접 UPDATE는 권한 오류. 셀프 프로필 RPC는 `api_web_v1.user_profile_update_self(p_nickname, p_grade_level)` → `core_private.user_profile_update_self_impl` — **nickname·grade_level만** 갱신 (DB 실측 functiondef).
- 웹 UI: 학생 마이페이지는 표시 전용(`app/(student)/mypage/page.tsx:59-61`), 학생 프로필 편집 라우트/서버 액션 자체가 미발견. 멘토 프로필 편집 폼의 `nickname` 입력은 서버 액션이 읽지 않는 dead input(`components/mentor/MentorProfileEditForm.tsx:295-305` vs `lib/mentor/mentorProfileEditActions.ts:39-47`)이고 저장은 `mentor_profiles` 전용 RPC. `users` write는 관리자 status 계열 2곳뿐(`lib/admin/accountStatusActions.ts:77-79`, `lib/admin/accountStatusCore.ts:44-56` — PII 미포함). 회귀 방지 계약테스트 존재(`lib/contracts/__contract__/outboundSurface.contract.test.ts:61-63`).
- `birth_date`는 가입 시 1회 auth 메타로만 유입(`lib/auth/buildSignupUserMetadata.ts:36` → DB 트리거), 이후 수정 경로 없음.
- 닉네임/표시명 분리: `nickname`이 셀프 수정 가능한 표시명, `full_name`은 분리돼 있음. 단 **학생 화면 표시명은 full_name 우선**(`app/(student)/mypage/page.tsx:59`, `components/mypage/ProfileSummaryCard.tsx:18`) — NICE 덮어쓰기 후 화면에 실명(인증값)이 표시된다. 멘토는 nickname 우선(`app/(mentor)/mentor/mypage/page.tsx:165`)으로 우선순위가 반대(기존 사실).

발동 조건: (역방향) S-C 구현자가 덮어쓰기를 authenticated 컨텍스트로 시도하면 GRANT 부재로 실패 — service_role 경로 필수(수정 제안 #7). `users_protected_columns_guard`는 id/role/status/약관류만 보호하며 서버 경로(`current_user not in ('anon','authenticated')`)는 통과(DB 실측).

### W5. 기존 결제·캐시 플로우와 신규 PG 병존 — [위험도: 높음]

**호출부 전수 (프로덕션):**
- `confirm_subscription_checkout`: JS 직접 호출 **0건** — 계약테스트가 부활을 금지(`lib/subscribe/__contract__/subscribeCheckoutWiring.contract.test.ts:18`). 정본은 `subscription_checkout_confirm_v2`(`lib/subscribe/subscribeCheckoutService.ts:545-551`, service_role) — 내부에서 정본 RPC를 호출한다(DB 실측).
- `record_cash_topup`(레거시): `lib/cash/walletTopupActions.ts:97-101` 1건 — 테스트 충전 전용(프로덕션 기본 차단 게이트 `:48-56`). 운영 Toss 충전 정본은 `record_cash_topup_v2`(`lib/toss/cashTopupFromPayment.ts:55-59`).
- `record_subscription_cash_debit`: JS 직접 호출 **0건**(계약테스트 금지, e2e 2곳만) — DB 내부에서 `confirm_subscription_checkout`이 호출(DB 실측).
- EXECUTE 권한: 위 자금 RPC 전부 `service_role` 전용(DB 실측 proacl — authenticated EXECUTE 없음).

**UI 노출 실측:** 유저에게 노출된 결제 경로는 2개뿐이다.
1. 캐시 충전 = Toss 카드 1종(`components/cash/CashChargeWidget.tsx:76-80`, 금액 5종 allowlist `lib/cash/chargePackages.ts:10-16`) → 승인 코어 `lib/toss/confirmCashTopupServer.ts:41` → `record_cash_topup_v2`.
2. 구독 결제 = **PG 없이 캐시 지갑 즉시 차감**(`components/subscribe/SubscribeCheckoutClient.tsx:70-78` → `/api/subscribe/checkout` → v2 RPC).
3. 갱신 = 크론 `/api/cron/subscription-renewal` → `process_subscription_renewal` — 지갑 차감, 잔액 부족 시 `past_due`+grace 2일 (DB 실측 functiondef).

**이중 결제/상태 불일치 가능 조합 판정:**
- (a) **포트원 단건결제 + 기존 confirm 재사용 = 이중 차감** — 정본 RPC가 지갑 차감을 내장하므로 PG 성공 후 이 RPC를 부르면 캐시도 차감된다. v2의 3자 금액 일치(`payments.amount×100 = expected = mentor_plans.amount_cents`)와 `kind='subscription'` 강제, `PAYMENT_STALE`(pending 30분) 규칙도 PG 비동기 흐름과 충돌. → 차단 이슈 B1.
- (b) **갱신 이중화** — 기존 캐시 갱신 크론과 신규 빌링키 크론이 같은 구독을 경쟁 갱신. `process_subscription_renewal`은 멱등키(`subscription_billing_events.idempotency_key`) 기반이라 **자기 자신은 멱등**이지만, 다른 멱등키를 쓰는 신규 경로와는 서로를 모른다. → 차단 이슈 B2.
- (c) **orderId 규약 충돌** — `cash-{uuid}-{ts}`가 3중 잠금: 코어 regex(`lib/toss/tossTopupCore.ts:24` — 사본 금지 계약테스트), 웹훅 게이트(`app/api/toss/webhook/route.ts:156` `startsWith("cash-")`), DB 검증(`record_cash_topup_v2`의 `^cash-(.+)-([0-9]+)$` + 소유자 uuid 대조, DB 실측). 포트원 참조를 그대로 넣으면 `ORDER_REF_INVALID`/`ORDER_REF_OWNER_MISMATCH`로 전부 기각.
- (d) **클라이언트 인텐트 선입력** — `payments_insert_intent`(authenticated INSERT)의 with_check는 `auth.uid()=user_id AND status IN ('pending','processing')`뿐(DB 실측) → 신규 pg_* 컬럼을 클라이언트가 임의 값으로 선입력 가능(수정 제안 #4).
- (e) **환불** — PG 취소 API 호출 코드 0건(Toss 호출은 confirm/조회 2종뿐). 현행 환불은 DB 캐시 환급(`lib/admin/refundActions.ts:124`) — 포트원 취소 연계는 신규 표면(수정 제안 #15).
- (f) 탈퇴 진행 중 결제: `payments`에 `adg_payments`(account_deletion_write_guard) 트리거가 있어 삭제 진행 유저의 payments 쓰기는 `ACCOUNT_DELETION_IN_PROGRESS` 예외(DB 실측) — 포트원 웹훅 처리기가 이 예외를 다뤄야 함.

발동 조건: S-D~F가 기존 RPC/크론/orderId 규약을 재사용하는 설계로 착수하는 즉시.

### W6. RLS 전제 검증 — [위험도: 없음~낮음]

- 신규 테이블 4종 이름의 웹 레포 참조: **0건** (코드/SQL 419본/문서, `--no-ignore --hidden` 포함 전수 grep). `portone`/`iamport` 히트도 문서 2건뿐이며 그 문서가 "구현 0건"을 명시(`docs/contracts/api_web_v1_contract_v1_1.md:407`).
- service_role 격리: 단일 팩토리 `lib/supabase/admin.ts:1,12-22`(`import "server-only"` + env 부재 시 throw). 소비 47파일 중 46개가 자체 마커(`server-only` 13 / `"use server"` 21 / 서버 컴포넌트·라우트 12) 보유, 1건(`lib/subscribe/subscribeCheckoutService.ts`)만 자체 마커 없음(전이적으로는 안전 — admin.ts의 server-only가 클라이언트 번들 편입 시 빌드 실패). `'use client'` 파일에서 admin 모듈 import **0건**(실증 grep).
- 참고 패턴: `account_deletion_jobs`가 이미 "RLS on + 정책 0 + anon/authenticated GRANT 0 = service_role 전용" 선례(`lib/account/accountDeletionAdapters.ts:26-34` 주석 + DB 실측). 신규 4종도 **정책 0개뿐 아니라 GRANT 0**까지 맞춰야 완결.

발동 조건: 신규 모듈이 server-only 없이 4종 테이블을 만질 때 — CI가 막지 못함(`.dependency-cruiser.cjs:8` 비차단, 수정 제안 #16).

### W7. 크론/배포 설정 충돌 — [위험도: 낮음~중간]

- `vercel.json` 전문 실측: `crons` 3개뿐, rewrites/headers/functions 키 없음 → S-E 크론 **추가 자체는 충돌 없음**. 단 내용상 충돌은 B2(갱신 이중화).
- 크론 인증 규약 일관: `CRON_SECRET` + timing-safe, 미설정 시 항상 401(fail-closed) — 신규 크론이 복제할 패턴 3개 실존. (`app/api/cron/subscription-renewal/route.ts:15-27` 등)
- env 구조: **빌드타임 검증 전무** — next.config.ts에 env 블록 없음, zod/assertEnv 0건, 모듈 로드 시점 throw 0건. 누락 시 전부 런타임 실패이며 `NEXT_PUBLIC_*`만 "빌드 시점 인라인 → 미설정 시 배포본 영구 결손"의 제3 양상. `TOSS_WEBHOOK_SECRET` 미설정이면 웹훅 전면 401(`lib/toss/verifyTossWebhookSignature.ts:41-46`). `.env.example`은 7키만 기재하고 CRON_SECRET 등 5종+ 미기재.

발동 조건: 포트원 키를 배포 env에 누락한 채 배포 — 빌드는 성공하고 런타임에서만 실패(수정 제안 #17).

### W8. 기존 테스트 파급 — [위험도: 중간] (전부 절차로 해소 가능)

**컬럼 추가만으로 깨지는 것 (실측):**
| 게이트 | 근거 | 성격 |
|---|---|---|
| `contracts:verify` (수동/운영) | `scripts/contracts/verify_remote_contract.mjs:142,150-152` — 스냅샷 diff `SEMANTIC_DRIFT` fail. 컬럼 자체가 아니라 스냅샷의 `migrations` 배열 길이(`scripts/contracts/contract_snapshot_query.sql:117-120`)가 +N | **hard fail** → `contracts:export` 재수출 필수 |
| 스키마 지문 | `scripts/verify/baseline/parent_schema_fingerprint.sh:22,45-46` — `columns=` 카운트·`md5_columns` 축 변경 | 지문 대조 절차(`db-apply-pending`은 diff를 증적으로만 남김 — `\|\| true`) |
| 인벤토리 비교 | `scripts/verify/baseline/compare_schema_inventory.py:78` + `docs/audit/remote_db_inventory_20260804/columns.json` | json 갱신 필요 |
| 로컬 스택 STRICT | `scripts/verify/baseline/run_local_stack_emulation.sh:106` — columns/md5_columns/buckets 축 포함 | pack 재생성과 함께 수렴 |
| (조건부) critical 함수 md5 | `contract_snapshot_query.sql:50` — `users_protected_columns_guard`가 critical 목록에 포함. `identity_verified_at`을 보호컬럼에 넣는 등 재정의 시 body_md5 드리프트 | 재수출로 해소 |

**컬럼 추가에 안전한 것 (실측):** CI 게이트 `web-contract-tests.yml`(lint+tsc+test:contract)은 DB 무접속 소스 텍스트 스캔 — 69개 계약테스트 전부. DB 내 컬럼 검증 SQL은 `column_name IN (...)` 카운트 방식이라 추가에 안전(`supabase/sql/20260730120103_money_rpc.sql:96-99` 등). 스냅샷 매처 0건. e2e payments INSERT는 부분 컬럼(nullable 전제 하 안전).

발동 조건: S-B 적용 후 `contracts:export`·inventory 갱신을 같은 회차에 하지 않으면 다음 운영 검증에서 hard fail (차단 이슈 B5 후단).

---

## 앱 레포 (ssambership-app)

### A1. 모델 파싱 strict성 — [위험도: 없음]

**판정: 컬럼 추가 시 unknown key로 파싱이 던지는 구조가 아니다 — 전면 무시 구조.**

근거 (대표 3곳 이상 실증):
- 직렬화는 100% 수동 `fromMap` + `map['키']` 인덱싱. json_serializable/build_runner/freezed **미설치**(pubspec dev_dependencies 전량 확인, `*.g.dart` 0건, `part` 지시자 0건, build.yaml 부재 → `disallow_unrecognized_keys` 설정 자체가 존재 불가).
- `users` 조회는 전수 3곳, 전부 **명시 select**라 신규 컬럼이 응답에 실리지도 않는다: `lib/core/auth/auth_service.dart:221-225`(`role, nickname, full_name, status, suspended_until` → `:289-293` 키 인덱싱), `lib/core/auth/account_status.dart:140-147`(`status, suspended_until`), `lib/features/mypage/data/mypage_repository.dart:70-79`(`email, grade_level`, 실패도 삼킴).
- unknown key 내성이 **테스트로 고정**돼 있다: `test/mentors/mentor_directory_repository_test.dart:127-132` — 모르는 키(`full_name`)를 행에 밀어넣어도 파싱 통과를 검증.
- `payments`: 앱 접근 **0건**(테이블·뷰·RPC 전 경로 — `.from()` 리터럴 24종 전수에 부재, 계약 매니페스트 `test/contracts/outbound_api_manifest_test.dart:77-110`에도 없음).
- fromMap 전수 22개 중 DB 행 파서에서 throw 0건(유일한 throw 파서는 Storage 잉크 문서 `lib/core/ink/ink_document.dart:81` — DB 무관, 그마저 "상위 버전 관대").

발동 조건: 없음(추가 한정). 단 컬럼 **삭제/개명**은 비널러블 캐스트 39곳에서 TypeError — 이번 범위 밖 참고.

### A2. 403/신규 에러코드 내성 — [위험도: 중간]

**판정: 크래시·무한로딩·무한재시도 어느 것도 아니다. 동작은 ① 일반 오류 문구 오안내("잠시 후 다시 시도" — 재시도로 해결 불가한 상황) ② 9곳에서 조용한 빈 상태. 단, 부팅 의존 RPC 3종에 403이 가면 앱 전면 차단.**

근거:
- 공통 계층: `AppError` + `friendlyError`(`lib/shared/errors/friendly_error.dart:11-14`) — 미지 예외는 전부 "요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요."
- HTTP 상태코드 분기는 앱 전체 1곳(404, Storage)뿐, `403` 리터럴 분기 0건. `IDENTITY_REQUIRED` 참조 0건(전수 grep). 에러 매퍼는 전부 `PostgrestException.message` **선두 대문자 토큰**만 추출(`lib/features/question_room/data/qna_error_mapper.dart:85-90`, `lib/features/individual_question/data/iq_error_mapper.dart:69-74`) → 서버가 code 필드에만 실으면 인식 불가(수정 제안 #10).
- 자동 재시도는 앱 전체 정확히 1곳·조건부 1회(`40001` 첨부 등록 충돌, `lib/features/individual_question/data/iq_attachment_upload_core.dart:425-440`) → 403 재시도 스톰 위험 0.
- 무한로딩: FutureBuilder 21개 중 19개 hasError 처리, 로딩 플래그도 catch에서 해제 — 실측상 무한로딩 패턴 부재. 대신 **조용한 흡수 9곳**(지갑 잔액 `lib/features/mypage/data/mypage_repository.dart:147-150`, 캐시 내역, 주간 사용량, 차단 목록 `blocked_users_screen.dart:55-67` 등) — 403 시 "빈 값/미표시"로 나타나 원인 추적 불가.
- **전면 차단 경로(핵심)**: 부팅 게이트가 `account_deletion_write_blocked`·`account_deletion_status_self` 실패를 `AccountState.fetchFailed`로(`lib/core/auth/account_status.dart:242-265`), role 조회 실패와 함께 `AccessState.blocked`로 수렴(`lib/core/auth/auth_service.dart:98-100`) → 전 화면이 `/blocked`(`lib/app/entry_guard.dart:49-50`). `get_mobile_app_version_policy` 실패도 진입 보류(`lib/core/version_gate/version_gate_shell.dart:45-46`). → 차단 이슈 B4.

영향 화면 목록(가드 범위에 따라): 마이페이지(지갑·내역·정산 — 조용한 미표시), IQ 상세(확정/환불 스낵바 오안내), 질문방 CTA(주간 사용량 null → 보수 처리), 차단 목록(빈 상태 오표시). 발동 조건: 서버 가드가 앱이 호출하는 RPC/뷰(특히 `my_wallet_v1`·`my_cash_ledger_v1`·IQ RPC)에 403을 낼 때.

### A3. 앱의 결제·캐시 기능 노출 여부 — [위험도: 없음~낮음]

**판정: "결제는 웹 신설" 전제와 충돌 없음 — 앱은 Commerce-Zero가 실증되고 계약테스트로 잠겨 있다. 단 "기충전 캐시 소비"(IQ 에스크로)는 앱에 실존한다.**

근거:
- `record_cash_topup`·`subscription_checkout_confirm`은 **금지어 목록**에 등재되어 계약테스트가 0건을 강제(`test/contracts/outbound_api_manifest_test.dart:139-149`). checkout/충전 화면 0건, 잔액 부족 시 링크 없는 안내 문구만(`lib/features/individual_question/ui/iq_create_screen.dart:514-516`).
- 웹 브릿지가 여는 URL 전수 확인 — `/subscribe`·`/wallet/charge`는 **의도적으로 부재**(`lib/core/web_bridge/web_bridge_config.dart:22-23` "구매 유도 경로는 두지 않는다"), 서버 알림의 `/wallet/charge` 링크도 따라가지 않음(`lib/features/notifications/data/notification_types.dart:134-135`).
- 게이트 밖 동작: 구독 관리·정산 웹 링크는 기본 off 플래그(`lib/core/commerce/commerce_policy.dart:9-39`).
- **잔존 캐시 이동 경로(주의)**: IQ `release_individual_question`(정산)·`refund_individual_question`(환불) 호출이 앱에 있다(`lib/features/individual_question/data/individual_question_repository.dart:22-31`, 트리거는 상세화면 버튼). 지갑 조회는 `api_web_v1.my_wallet_v1`/`my_cash_ledger_v1` 뷰. → "머니패스류" 가드 범위에 이들이 포함되면 앱 학생 흐름이 깨진다(수정 제안 #12).

발동 조건: S-C 서버 가드가 IQ 에스크로 RPC·지갑 뷰까지 덮을 때만.

### A4. 게이트 비대상 확인 — [위험도: 없음]

**판정: 전제 성립 — 앱은 회원가입이 없고(로그인만), `identity_verified_at`이 null이어도 앱 코드가 그 컬럼의 존재/값을 일절 가정하지 않는다.**

근거:
- `auth.signUp(` 앱 코드 0건(유일 히트는 웹을 서술한 문서), auth 호출 전수 3건 = `signInWithPassword`(`lib/core/auth/auth_service.dart:304-316`)·`signOut` 2곳. OAuth/OTP 0건. 라우트 전량 6개(`lib/app/entry_guard.dart:14-19`)에 가입 라우트 없음. "가입은 웹" 명문화(`lib/features/auth/login_screen.dart:19,146-151`).
- `identity_verified_at`·`birth_date` 참조 0건(전수 grep). `full_name`은 2곳 읽되 널러블+폴백 완비(`auth_service.dart:289-293`, `student_lookup_repository.dart:19-34`), `grade_level`도 null 정규화(`mypage_repository.dart:84`).
- users 직접 쓰기 0건 — 계약테스트로 SELECT 전용 강제(`test/contracts/outbound_api_manifest_test.dart:298-299`).

발동 조건: 없음(웹 전용 게이트 전제 하).

### A5. Realtime/구독 채널 민감도 — [위험도: 없음~낮음]

**판정: 컬럼 추가에 영향받는 채널 없음.**

근거:
- 구독 전수 7개(채널 3개): `question_messages`/`question_threads`/`question_attachments`(`lib/features/question_room/data/thread_realtime.dart:44-89`), `individual_question_messages`/`_attachments`/`individual_questions`(`lib/features/individual_question/data/iq_realtime.dart:56-100`), `notifications`(`lib/features/notifications/data/notifications_realtime.dart:49-65`). **payments/users 구독 없음.**
- payload 파싱 3곳 모두 화이트리스트 키 캐스팅 + try/catch 무시(파싱 실패 시 재조회 폴백, 예 `thread_realtime.dart:55-61`). `.stream()` 미사용.
- DB 측 교차 확인: `supabase_realtime` publication에 등재된 테이블은 IQ/질문방/notifications 7종뿐 — **payments·users는 publication에 없다**(DB 실측 `pg_publication_tables`).

발동 조건: 없음(추가 한정). 컬럼 삭제/개명 시에만 필수 키 소실로 실시간이 조용히 죽는 경로 존재(참고).

---

## 공통

### C1. 마이그레이션 정합 (로컬 파일 vs 리모트 히스토리) — [위험도: 없음] (실측 완료)

- 실측 방법: 리모트 원장 `supabase_migrations.schema_migrations` SELECT + 로컬 `supabase/migrations/*.sql` 파일명 대조(supabase CLI 로그인 불가 환경이라 `supabase migration list` 대신 동등한 원장 SELECT·집합 diff로 실측).
- 결과: **리모트 85본 = 로컬 85본, remote_only 0 · local_only 0** (버전 완전 일치, `20260701000000`~`20260808092007`). CLAUDE.md의 hotfix 사례(`20260808092007`)도 `supabase/baseline/post_ledger_backfills/`(21본)로 역수입 완료 상태.
- 함의: `db-apply-pending`의 remote_only 가드 발동 조건 없음 — S-B는 깨끗한 원장 위에서 시작한다. 단 S-B 적용은 반드시 pack 절차(`build_native_migration_pack.py` — migrations 사본·manifest는 생성기 소유) 경유(CLAUDE.md 규칙).

### C2. S-B DDL 정적 검토 (이름 충돌·FK 대상·제약) — [위험도: 낮음] + 일부 미확인

DB 카탈로그 SELECT 실측 결과:
- **이름 충돌 없음**: `nice_auth_tokens`/`identity_verifications`/`billing_keys`/`portone_webhook_events` — pg_class(전 relkind)·pg_proc·pg_type 히트 0. 유사명 기존 객체(`verification_logs`, `mentor_school_verifications`, `subscription_billing_events`)와도 불충돌.
- **컬럼 충돌 없음**: `payments` 현행 16컬럼에 예정 8컬럼(pg_provider, pg_tx_id, method, receipt_url, paid_at, fail_code, fail_message, billing_key_id) 전부 부재. `users.identity_verified_at` 부재(추가 가능). `refunds.pg_cancellation_id` 부재. 참고: `payments.external_id`(기존)와 `pg_tx_id`의 의미 중복 소지 — 매핑 규칙 문서화 권장.
- **S-C 전제 성립**: `users.birth_date`(date, nullable)·`full_name`(text) 실존.
- **FK 대상 실존**: `public.users(id)`, `public.payments(id)` — `payments.billing_key_id → billing_keys` FK는 생성 순서만 주의(수정 제안 #6).
- **GRANT 승계 확인**: `users`/`payments` ACL은 테이블 단위(컬럼 attacl 전무) → 신규 컬럼은 자동으로 기존 SELECT 범위에 포함된다. 게이트의 `identity_verified_at` 판독에 추가 GRANT 불요(반대로 클라이언트에게도 보인다 — 민감도 낮다고 판단되나 S-B에서 인지할 것). UPDATE는 여전히 불가(GRANT 자체가 없음).
- **트리거 간섭 없음**: `users`의 기존 트리거(`users_protected_columns_guard`·role 가드·updated_at)는 신규 컬럼 추가와 무충돌(보호 목록에 미포함, DB 실측).
- **[미확인]** 인덱스명·제약명·정책명 충돌, NOT NULL/DEFAULT/on delete 세부 — S-B DDL 원문 미제공으로 검증 불가. DDL 확정 시 `pg_class relkind='i'`·`pg_constraint` 대조 1회 필요.

---

## 미확인 목록 (근거를 얻지 못해 판정 보류한 것)

1. **S-B/S-C 지시서 원문** — 미제공. 본 문서는 R1 요약 기준이며, DDL 세부·게이트 구현 방식·"머니패스" 대상 기능 정의는 원문 확인 후 재검증 필요.
2. **"머니패스"의 실체** — 웹·앱 레포 전수 grep 0건(`머니패스`/`moneypass`/`money_pass`/`moneyPass`). 대상 테이블/RPC/라우트를 특정할 수 없어 서버 가드 범위 검증 불가(수정 제안 #12).
3. **contract 스냅샷 critical 함수 목록 전체** — `scripts/contracts/contract_snapshot_query.sql`의 critical 목록에 `users_protected_columns_guard` 포함은 확인했으나 전체 목록은 미열람. 사가 함수(`anonymize_user_for_deletion` 등) 수정 시 body_md5 드리프트 여부는 그 목록 확인 후 판정.
4. **프로덕션 프로젝트 상태** — 검토는 지시서가 지정한 staging(`lbeqxarxothkmzqvpudy`) 한정. 프로덕션 원장 정합·스키마는 미확인.
5. **Vercel 배포 환경별 env 실제 설정값** — 레포 밖 정보(vercel 대시보드). crons가 어느 배포에 걸려 있는지, CRON_SECRET/SUBSCRIPTION_RENEWAL_ENABLED 실값은 미확인(코드상 fail-closed 구조만 확인).
6. **포트원 웹훅 서명 규격과 기존 검증 코드의 호환** — 기존 HMAC 검증은 Toss 전용 1곳뿐이라는 사실만 확인. 포트원(Standard Webhooks) 검증은 신규 구현 전제로만 평가.

---

## 부록: 검토 방법 요약

- 웹/앱 레포: 전수 grep·파일 정독(수정 0). 조사 서브에이전트 5개(전부 읽기 전용) 병행 후 핵심 파일(`middleware.ts`, `lib/account/accountDeletion{Worker,Adapters,PurgePlan,BucketCoverage,RunnerConfig}.ts`)은 본 세션이 직접 재독해 검증.
- DB(staging): `pg_get_functiondef`(사가 5종·자금 RPC 7종·트리거 함수 3종), information_schema.columns, pg_constraint(FK 전수), pg_trigger, pg_policies, pg_class.relacl/pg_attribute.attacl, pg_publication_tables, cron.job, schema_migrations 집합 diff — 전부 SELECT.
- 산출물 위치: 레포 오염 방지를 위해 두 레포 밖(`/home/user/IMPACT.md`)에 생성. git 스테이징/커밋 없음.
