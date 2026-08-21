# S-C-REPORT.md — NICE 통합인증 구현 수행 보고 (가입 강제 게이트 + 보호자 체인)

> 2026-08-21 · 세션: sprint-pay S-C v2 · 브랜치 `claude/new-session-nggfez`
> 대상 DB: Supabase `lbeqxarxothkmzqvpudy` (이름 "ssambership-staging" — **실제 라이브 프로덕션**)
>
> **상태: 적용 완료 (2026-08-21).** §0 게이트에서 정지·보고 후 사용자가 "적용 승인"(+지시 ①~④)으로
> 답해 m8 을 라이브에 적용했고, 같은 회차 후속(스냅샷 재수출·columns.json·지문·verify)까지
> 완료했다 — 적용 경위·증적·①~④ 처리 내역은 `docs/sprint-pay/S-C-APPLY.md`.
> 스테이징 실측 1~6 은 NICE 자격증명·Gabia 프록시·실물 휴대폰이 있는 배포 환경 전제라
> 이 세션에서 수행 불가 — §6 에 실행 절차(변조·원복 SQL 포함)를 기록해 인계한다.

## 0. 정지 지점 (해소 경과)

1. ~~**m8 적용 승인**~~ → **적용 완료** (사용자 "적용 승인" 2026-08-21 · S-C-APPLY.md).
   CAS 락('processing')·보호자 체인(kind)·di_hash self 한정 유니크 라이브 개통.
2. **[잔여 — 오너/운영]** env 등록(§7 표) + Gabia 프록시 가동 + NICE 에 프록시 공인 IP 등록
   (미등록 시 전 호출 1007).
3. **[잔여 — 오너/운영]** 스테이징 실측 1~6(§6) 후 `IDENTITY_GATE_ENABLED=true` 롤아웃(부록 C 순서).

## 1. 수행 내역

### §부록A m8 — 선행 마이그레이션 (authoring 완료 · 적용 대기)

`20260821100100_identity_verifications_kind_guardian.sql`:
- `kind text NOT NULL DEFAULT 'self' CHECK (self|guardian)` 추가 (라이브 0행 실측 — §4)
- status CHECK 재정의: `pending|processing|verified|failed|expired` ('processing' 추가 — CAS 락 전제)
- di_hash 부분 유니크 재정의: `WHERE status='verified' AND di_hash IS NOT NULL AND kind='self'`
  (보호자의 자녀 복수 인증 + 본인 가입 학부모의 self 행 충돌 방지)
- `user_consent_records` 무변경 — consent_type 'minor_guardian_consent' · consent_actor 'guardian' ·
  idempotency_key UNIQUE 라이브 실측 재확인(§4). §3 스펙 그대로 사용.
- pack 재생성(generator-owned 92 = 91+1) · validate 2종 PASS · **fresh PG16 전량 재생 93본 OK**
  (open tx 0, 구조 카운트 불변: tables=84 · functions=218 · policies=175 · buckets=13 — CI 기대치 수정 불요).

### §1~2 모듈 구조 (경로·패턴)

| 모듈 | 내용 | server-only |
|---|---|---|
| `lib/nice/crypto.ts` | kdf(base64url_nopad(pbkdf2(ticket, transaction_id, iterators, 64, sha256)) → symKey=[0,32)·hmacKey=[48,80)) / verifyIntegrity(HMAC-SHA256, timing-safe) / decryptResult(iv 16·tag 16 분리, AES-256-GCM) / 토큰 만료 해석 | 무부착(순수 — §3 주기) |
| `lib/nice/client.ts` | 토큰 캐시(만료 5분 버퍼, `nice_auth_tokens` 1행 저장) + auth/url·auth/result 호출. 1003/1004 → 사용 토큰 폐기·재발급 후 **1회만** 재시도. **result 에 실제 사용한 토큰을 반환**(복호화 키 재료 계약). Basic 헤더 = base64url 무패딩. `svc_types:["M"]`·`method_type:"GET"` 고정. `X-Proxy-Key` 부착. 1007 즉시 중단 안내 로그 | 부착 |
| `lib/identity/identityCrypto.ts` | 저장 암호화 코어: `'v1:'+base64(iv‖cipher‖tag)` AES-256-GCM(iv 12byte 고정) / `diHashWithKey` = base64url(HMAC-SHA256) | 무부착(순수) |
| `lib/identity/encryption.ts` | env 키 로딩(IDENTITY_DATA_KEY 32byte base64 강제 · IDENTITY_HASH_KEY 16자+) → encryptIdentityField/decryptIdentityField/diHash | 부착 |
| `lib/identity/age.ts` | **birthdate 인자 순수함수** — KST 만나이(fullAgeAtKst)·만14세 미만·보호자 만19세 판정, yyyymmdd↔ISO | 무부착(순수 — 지시서 §2 "순수함수로 분리") |
| `lib/identity/service.ts` | startVerification(전이 규칙·스로틀 10분 5회·행 생성) / CAS 락 / completeVerification(무결성→복호→반영, **result 수신 후 DB 쓰기 1회 재시도**·전 쓰기 멱등) / 온보딩 상태 판정+부분실패 자가치유 | 부착 |
| `lib/identity/identityGateFlag.ts` | `IDENTITY_GATE_ENABLED` 판정('true' 만 ON) + `needsIdentityOnboarding(profile)` | 무부착(플래그 판정 — 시크릿 아님) |
| `lib/identity/identityGate.ts` | `requireVerifiedIdentity(userId)` 머니패스 가드(fail-closed) + 403 응답 헬퍼(message 선두 `IDENTITY_REQUIRED`) | 부착 |
| `app/api/identity/start/route.ts` | POST · 로그인 필수 · student/mentor 만 · vid httpOnly 쿠키 이중화 | (라우트) |
| `app/api/identity/return/route.ts` | GET+POST · CAS 락 · 30분 pending 만료 · processing 10분 고착 복구 · 결과 HTML(opener→postMessage(APP_ORIGIN)+close / 무opener→`/onboarding/verify?status&code` 이동 — 동일창 정식 지원) · enc_data/개인정보 HTML/URL 미포함 | (라우트) |
| `app/onboarding/verify` `/guardian` | 루트 전용 라우트(그룹 레이아웃 밖 — 구조적 게이트 비대상). 서버가 상태 판정(verified→홈 / guardian_required→보호자 페이지). postMessage `event.origin===location.origin` 검증. DI_CONFLICT "기존 계정 존재" UX. 보호자 페이지에 법정대리인 고지문("법정대리인 본인임을 확인하며 진행" 포함, `/legal/minor-consent` 링크) | (페이지) |

**server-only 부착 범위 주기(부록 C 이탈 1건):** 부록 C 는 `lib/nice/*`·`lib/identity/*` 전 모듈 부착을
지시했으나, §5 유닛 게이트(node:test)가 직접 import 해야 하는 **순수 계산 3파일**(crypto.ts ·
identityCrypto.ts · age.ts — env/DB/네트워크 접근 0, 키 재료는 전부 인자)은 무부착으로 분리했다.
`server-only` 패키지는 미설치 상태로 Next 컴파일러 별칭으로만 동작해 node:test 에서 import 자체가
불가능하다(기존 관례 동일: accountDeletionWorker 무부착·Adapters 부착). env·DB·NICE 를 만지는 5개
모듈 전부 부착했고, 순수 모듈의 env/fetch/supabase 무접근은 계약테스트가 강제한다
(`identityGateWiring.contract.test.ts` "server-only 경계").

### §3 플로우 구현 세부

- **start 전이 규칙**: self = `identity_verified_at IS NULL && verified self 행 없음` / guardian =
  `verified self 존재 + self.birthdate 만14세 미만(KST) + verified guardian 없음`. 그 외 403.
  스로틀: 동일 유저 행 생성 10분당 5회(429 THROTTLED).
- **vid 이중화**: 쿼리 우선 + start 가 `nice_identity_vid` httpOnly 쿠키(30분, path=/api/identity).
- **CAS**: `update … set status='processing' where id=vid and status='pending'` returning — 0행이면
  현재 status 기준 HTML 만(재호출 금지·3033 예방). processing 10분 초과는 조회 시
  failed/`STUCK_PROCESSING` 전환(크래시 고착 방지).
- **완료 반영**(전 쓰기 멱등 + 1회 재시도): di_hash 충돌 검사(타 유저 verified self) → 행 verified
  (ci/di/폰번호는 암호문 컬럼만) → self 14세 이상: `users.identity_verified_at·birth_date·full_name`
  갱신 / 14세 미만: birth_date·full_name 만 / guardian: 만19세 검사·`GUARDIAN_SELF`(di 동일) 검사 →
  `user_consent_records` insert(consent_type=minor_guardian_consent, actor=guardian, is_minor=true,
  guardian_consent=true, guardian_ref=행 id, `idempotency_key=vid` upsert-ignore) →
  `users.identity_verified_at` (보호자 이름·생일로 자녀 users 를 덮지 않음). 유니크 23505 → DI_CONFLICT.
- **자가치유**: verified 행은 있는데 users 반영이 유실된 이중 DB 실패를 `/onboarding/verify` 서버
  렌더가 재적용(멱등) — 유저 재인증(재과금) 없이 복구.
- **팝업**: 클릭 핸들러에서 **동기 window.open**(about:blank, 지시서 피처 문자열) 후 start 응답
  authUrl 로 이동 — fetch 지연으로 user gesture 를 잃지 않는 표준 구현(지시서 의도 = gesture 보존).
  팝업 차단 시 동일창 진행 폴백(실측 6 대상).
- **에러코드 매핑**: 1007 중단 안내 로그 / 1003·1004 재발급 1회 / 3032 → 행 expired·재시도 유도 /
  3033 → 재호출 금지·failed / 3025·3027 → token-ticket 바인딩 점검 플래그 로그 / 그 외 원문 코드만
  failure_code 저장. 토큰 `expires_in` 은 epoch ms 정본 + 단위 오판 방어 해석(유닛 고정).

### §부록B 게이트 2겹

- **웹 게이트 = (student)·(mentor) 그룹 레이아웃** (`needsIdentityOnboarding` → `/onboarding/verify`).
  `middleware.ts` 무수정(x-pathname 계약 유지 — 계약테스트로 고정). (student) 4분기 전부 삽입
  (게스트 열람 IQ 목록은 로그인 시에만 판정). 루트 전용 라우트·`/api/*`·(public)/(admin)·`/legal/*`·
  `/onboarding/*`·크론·웹훅·앱 표면(`/app/bridge/*`·`/app/community/shortform/new`·
  `/api/app-session/bootstrap`)은 그룹 레이아웃을 타지 않아 **구조적으로 비대상** — 앱 표면 무접촉은
  계약테스트가 추가 감시.
- **머니패스 서버 가드** `requireVerifiedIdentity(userId)` 4 진입점:
  ① 구독 생성 `app/api/subscribe/checkout/route.ts` → **HTTP 403 + message `IDENTITY_REQUIRED: …`**
  (앱 매퍼 선두 토큰 계약) ② 개별질문 결제 `createDirectIndividualQuestionAction` ·
  ③ `createOpenIndividualQuestionAction` ④ 맞춤형 주문 `selectMentorApplicationForOrder` ·
  멘토 지원 `submitMentorCustomRequestApplication` (서버 액션 3곳은 `/onboarding/verify` redirect).
  판독 실패는 fail-closed. **DB/RPC 레벨 가드 0** — 앱 부팅 fail-closed 3종·IQ 에스크로·지갑 뷰
  무접촉(가드 파일 `.rpc(` 0 을 계약테스트로 강제).
- **플래그 종속**: 게이트(레이아웃+가드)만 `IDENTITY_GATE_ENABLED==='true'` 종속. 인증 플로우
  (`/onboarding/*`·`/api/identity/*`)는 상시 활성. 기본 OFF → 배포 후 실측 → ON(부록 C 순서).

### §부록C 나머지

- `USER_SELECT`(getCurrentProfile)·`UserRow` 에 `identity_verified_at` 수동 추가.
- **가입 만 14세 미만 원천차단(D-AU-9) 해제**: 제출 차단 제거, 차단 고지(red) → 보호자 체인 사전
  안내(blue)로 교체. 가입 메타는 `guardian_consent=false`(가입 시점 동의 미수집 — 체인이 기록),
  `guardian_verification_method='nice_guardian_chain_post_signup'`.
- `.env.example` 에 NICE/IDENTITY/APP_URL/IDENTITY_GATE_ENABLED 문서화(IMPACT #17 배포 결손 방어).

## 2. 리포 검증 — 전부 green

| 검증 | 결과 |
|---|---|
| `build_native_migration_pack.py` + `--check` | PASS (92 = 91 + m8) |
| `validate_native_migration_pack.py` / `validate_replay_manifest.sh` | PASS / PASS |
| `run_native_pack_replay.sh` (fresh PG16 + stub) | **93본 전부 OK** (m8 = #93, 구조 카운트 불변) |
| `validate_db_workflows.py` (+--selftest) / `scan_repo_secrets.py` (+--selftest) | PASS (251 files) |
| `npm run lint` / `tsc --noEmit` | clean / clean |
| `npm run test:contract` | **542/542 pass** (기존 516 + 신규 26) |
| `npm run build` | 성공 — `/onboarding/*`·`/api/identity/*` 라우트 생성 확인 |

신규 유닛(§5 게이트, `lib/nice/__contract__`·`lib/identity/__contract__`):
- kdf substring 인덱스(0–32/48–80) 고정·결정성 / iv16·tag16 분리 / **GCM 라운드트립**(자체 암호화→복호 일치,
  변조·타 ticket 키 거부, 표준 base64 관대 수용) / 토큰 만료 해석 전 분기
- 저장 암호화 라운드트립('v1:' 접두·iv 랜덤·변조/타키/미지버전 거부) + **diHash 결정성**(base64url 무패딩)
- 만나이 경계값: **오늘(KST) 생일 14세 도달/미달·19세 경계**, UTC-KST 날짜 어긋남, 윤년 2/29, 판정불가 null
- 게이트 배선 tripwire: 플래그 의미론('true' 만)·레이아웃 4분기·머니패스 4 진입점·middleware 무수정·
  403 선두 토큰·server-only 경계·앱 표면 무접촉·NICE 프록시 경유(도메인 하드코드 0)
- 기존 tripwire 2건에 서비스롤 사유 등재(mentorDirectoryView DIRECT_ACCESS_EXEMPT ·
  outboundSurface users 쓰기 면제 — IMPACT #7 service_role 필수 근거 명기)

## 3. 보안 체크리스트

- **클라 번들 grep**: `.next/static` 전체에서 `NICE_CLIENT_ID|NICE_CLIENT_SECRET|NICE_API_BASE|NICE_PROXY_KEY|IDENTITY_DATA_KEY|IDENTITY_HASH_KEY|IDENTITY_GATE_ENABLED` **0건** (전부 서버 전용 유지, `NEXT_PUBLIC_` 승격 0)
- **로그 마스킹**: 신규 코드의 console 출력은 코드·HTTP 상태·supabase error.message 만 —
  enc_data/access_token/ticket/ci/di/전화번호/이름/생년월일 로깅 지점 0 (return 로그도 쿼리 **키 이름만**)
- **원문 비저장**: enc_data 저장 컬럼·raw jsonb 없음(m2 계약 유지). ci/di/폰번호는 `*_enc` 암호문만,
  HTML/URL 에는 status/code 토큰만(sanitize 후) 노출
- 시크릿 커밋 0 (`scan_repo_secrets.py` PASS)

## 4. 라이브 실측 (SELECT 전용 — 2026-08-21)

- 원장 **92본** = 로컬 pack(m8 제외) 92, 최신 `20260820100700` — 깨끗한 원장 위에서 m8 시작
- `identity_verifications` **0행** · `nice_auth_tokens` 0행 → m8 의 NOT NULL DEFAULT 추가 안전 재확인
- status CHECK 실명 **`identity_verifications_status_check`** = m8 DROP 대상과 정확 일치, 정의에
  'processing' 부재 실확인(부록 A 실측 재현) · di_hash 유니크 실명/정의 kind 무구분 실확인
- `identity_verifications.kind` 부재(0) · `user_consent_records` consent_type/actor CHECK 에
  'minor_guardian_consent'/'guardian' 실재, UNIQUE 1건(idempotency_key) — **m8 무변경 결정 유효**

## 5. m8 적용 계획 (수행 완료 — 실측 증적은 S-C-APPLY.md)

1. CLAUDE.md db-apply-pending 절차로 m8 적용. environment 브랜치 정책에 막히면 **S-B 선례 폴백**
   (S-B-APPLY.md §1: execute_sql 로 파일 SQL 실행 + `schema_migrations` 등재 — statements=파일 전문
   1원소 배열, name=파일 name부, created_by=승인 사용자, **md5 바이트 정합 확인**)
2. 즉시 `npm run contracts:export` 재수출 (`$.migrations` 92→93 — 미수행 시 SEMANTIC_DRIFT hard fail)
3. `docs/audit/remote_db_inventory_20260804/columns.json` 갱신 (+1행: identity_verifications.kind)
4. 스키마 지문 재캡처 → 커밋 → `contracts:verify` green 확인
5. (권장) 적용 직후 §4 SELECT 재실행으로 CHECK/유니크 재정의 실측

**롤백 노트**: m8 파일 헤더에 대응 DROP/재정의 문 주석(실행 금지). 0행 테이블이라 데이터 원복 불요.

## 6. 스테이징 실측 1~6 절차 (오너/운영 수행 — 이 세션 실행 불가)

전제: m8 적용 + env 등록 + 프록시 IP 등록 + `IDENTITY_GATE_ENABLED` **off** 배포 상태에서 시작.

1. **성인 self**: 테스트 계정 로그인 → `/onboarding/verify` 수동 진입 → 인증 →
   `select status, kind, di_hash is not null, verified_at from identity_verifications where user_id='<uuid>'`
   verified 확인 + `select identity_verified_at, birth_date, full_name from users where id='<uuid>'` 갱신 확인
2. **DI 충돌**: 두 번째 테스트 계정으로 같은 명의 인증 → 화면 "이미 가입된 계정" UX + 행 failed/`DI_CONFLICT`
3. **return 새로고침**: 성공 직후 팝업 URL 재요청(새로고침) → 서버 로그에 auth/result **재호출 없음** +
   `ALREADY_DONE` HTML (CAS 검증)
4. **게이트**: `IDENTITY_GATE_ENABLED=true` 후 미인증 계정으로 `/question-room` → `/onboarding/verify`
   리다이렉트 / `curl -X POST /api/subscribe/checkout` (미인증 세션) → **403 + message 선두 `IDENTITY_REQUIRED`**
5. **보호자 체인**: 14세 미만 birthdate 는 실인증 재현 불가 → 본인 테스트 계정 한정 변조(기록 의무):
   ```sql
   -- [변조 — staging(이름만 staging 인 라이브) 본인 테스트 계정 한정]
   update public.identity_verifications set birthdate='2013-01-01'
    where user_id='<테스트uuid>' and kind='self' and status='verified';
   update public.users set birth_date='2013-01-01', identity_verified_at=null where id='<테스트uuid>';
   ```
   → `/onboarding/verify` 접근 시 guardian 페이지로 분기 확인 → **제2 명의(가족) 폰**으로 보호자 인증
   성공 경로 실측(본인 폰은 `GUARDIAN_SELF` 거절 실측으로 대체 가능 — 부록 C 보정). 성공 시
   guardian 행 verified + `user_consent_records`(minor_guardian_consent, guardian_ref=행 id,
   idempotency_key=vid) + `users.identity_verified_at` 확인. 원복(전량 기록):
   ```sql
   -- [원복]
   delete from public.user_consent_records where user_id='<테스트uuid>' and consent_type='minor_guardian_consent';
   delete from public.identity_verifications where user_id='<테스트uuid>' and kind='guardian';
   update public.identity_verifications set birthdate='<원래값>'
    where user_id='<테스트uuid>' and kind='self' and status='verified';
   update public.users set birth_date='<원래값>', identity_verified_at=now() where id='<테스트uuid>';
   ```
6. **팝업 차단 폴백**: 브라우저 팝업 차단 상태에서 시작 → 동일창으로 NICE 진행 →
   `/onboarding/verify?status=…&code=…` 복귀 확인 (return 무 opener 분기)

## 7. env (전부 서버 전용 — `.env.example` 반영)

`NICE_CLIENT_ID` · `NICE_CLIENT_SECRET` · `NICE_API_BASE`(Gabia 프록시) · `NICE_PROXY_KEY` ·
`IDENTITY_DATA_KEY`(32byte base64) · `IDENTITY_HASH_KEY` · `APP_URL`(미설정 시
`NEXT_PUBLIC_SITE_URL` 재사용) · `IDENTITY_GATE_ENABLED`(롤아웃 플래그, 기본 off)

## 8. 스펙 주기 — 오너 확정 반영 완료 (2026-08-21 "적용 승인" 지시 ①~④)

1. **di_hash 인코딩 = base64url 확정(①)**: m8 에서 di_hash 컬럼 COMMENT 를 base64url 기준으로
   정정하고 테이블 코멘트의 m2 'hex' 표기를 폐기했다(m2 파일은 원장 바이트 불변 — 무수정).
2. **/account/delete 게이트 예외 등재(②)**: 미인증 유저도 탈퇴 가능 — (student) 레이아웃 예외 +
   tripwire 계약테스트 고정. `/settings/blocks` 는 종전대로 게이트 대상.
3. **팝업 pre-open 현행 유지(③)**: 동기 pre-open(about:blank) → authUrl 이동, 차단 시 동일창 폴백.
4. **guardian consent_version(④)**: 기존 약관 버전 관례의 최신값 `legal-placeholder-2026-06-20`
   (`MINOR_CONSENT_VERSION` 연동 — 승급 시 자동 반영). 정합 확인: 최근 약관 개정(시행 2026-07-12)은
   동의 버전을 승급하지 않았고 라이브 원장도 동 버전 단일(S-C-APPLY §0). 법무 문구 확정 시 일괄 승급.

## 9. 핸드오프 노트 (S-D용)

1. **`requireVerifiedIdentity`** — `lib/identity/identityGate.ts` ·
   `(userId: string) => Promise<{ok:true} | {ok:false; code:"IDENTITY_REQUIRED"; message:string}>` ·
   플래그 OFF 면 무조건 ok · fail-closed. 라우트용 `identityRequiredJsonResponse()`(403, message 선두
   토큰) 동봉. 포트원 결제 신규 표면(빌링키 발급·단건 결제)에도 같은 가드를 삽입할 것.
2. **payments 확장 컬럼 준비 상태**: S-B m4 로 `payments` pg_* 8컬럼(+billing_key_id FK)·`refunds`
   pg_* 2컬럼 라이브 실재(전부 nullable). #4 방어 규칙(서버 확정 경로가 포트원 단건조회 값으로 전량
   덮어쓰기)은 m4 헤더 명기 — S-D 확정 경로 구현 시 준수. `billing_keys`·`portone_webhook_events`
   테이블 준비 완료(m3·m5), 웹훅 수신 라우트는 신규 구현(Standard Webhooks 서명 +
   `ACCOUNT_DELETION_IN_PROGRESS` 예외 — IMPACT W5-(f)).
3. **크론 자리**: `vercel.json` crons 3종(`/api/cron/subscription-renewal` 18:10 UTC ·
   individual-question-expiry · account-deletion) — S-E 빌링키 갱신 크론은 이 배열에 추가하되 **기존
   캐시 갱신 크론과 관할 분리(B2, funding_source 분기)** 선행. 크론 인증은 CRON_SECRET+timing-safe
   패턴 3곳 복제. DB 측 pg_cron `nice_auth_token_sweep_daily`(16:20 UTC)가 토큰 청소 + stale
   pending(24h)→expired 를 담당(m1 — S-C 는 재사용만, 추가 크론 불요).
4. **identity_verifications 접근**: service_role 전용 유지. 웹 신규 소비는 반드시
   `lib/identity/service.ts` 경유(직접 `.from()` 은 tripwire 2건이 잡는다 — 면제 등재 필요).
5. 탈퇴 파기: m7 RPC 가 identity_verifications·billing_keys 전행 파기(웹 워커 배선 완료 — S-B).
   S-D 에서 포트원 빌링키 해지 API 를 DB 파기 **앞에** 삽입(TODO 주석 위치: accountDeletionWorker).

## 10. 산출물

- m8 1본 + pack 재생성(92) · 신규 모듈 9파일 · 라우트 2본 · 온보딩 페이지 2본 + 런처/메시지 2파일 ·
  레이아웃 2곳 게이트 · 머니패스 가드 4 진입점 · USER_SELECT/UserRow · signup 차단 해제 ·
  `.env.example` · 계약테스트 4본(+기존 2본 면제 등재) · 본 보고서
- PR 은 하네스 브랜치 `claude/new-session-nggfez` 푸시까지 (머지·PR 생성은 오너 소관)
