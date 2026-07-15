# 쌤버십 웹(ssambership_web) 코드 리뷰 보고서

> 작성일: 2026-07-15 · 브랜치: `claude/code-review-markdown-repos-g18cv7`
>
> 다중 에이전트 코드 리뷰: 영역별 병렬 정독 후 발견사항마다 적대적 3중 검증(재현성·악용영향·설계의도)을 거쳐, 반박(REFUTED)된 항목은 제외했습니다. 아래는 CONFIRMED/PLAUSIBLE로 살아남은 발견만 담습니다.

## 요약

| 심각도 | 건수 |
|---|---|
| 🔴 치명(critical) | 1 |
| 🟠 높음(high) | 7 |
| 🟡 중간(medium) | 17 |
| ⚪ 낮음(low) | 16 |
| **합계** | **41** |

## 아키텍처 개요

쌤버십 웹은 Next.js 16 App Router 위에 **역할별 라우트 그룹 4개**로 화면을 분리한 단일 앱이다: `app/(public)`(멘토 찾기·커뮤니티·법적 고지 등 비로그인 영역), `app/(student)`(구독·질문방·개별질문·지갑), `app/(mentor)`(대시보드·정산·프로필), `app/(admin)/admin/(console)`(관리자 콘솔). 각 그룹의 `layout.tsx`가 `lib/auth/routeGuard.ts`의 `requireRole()`을 호출해 서버 컴포넌트 레벨에서 역할을 강제하고, 루트 `middleware.ts`는 인증을 직접 수행하지 않고 `x-pathname`/`x-return-to` 헤더만 주입해 로그인 복귀 경로와 layout 내 경로 분기(예: `(student)` layout의 지갑·차단설정 예외 처리)를 지원한다. 총 766개 TS/TSX 파일, `"use server"` 파일 46개 규모다.

비즈니스 로직은 `lib/` 아래 **도메인 이름 그대로의 모듈 30여 개**로 구성된다(`customRequest` 49파일, `admin` 43, `mentor` 38, `qna` 27, `community` 21, `subscribe` 14, `cash` 6, `toss` 2 등). Supabase 접근은 `lib/supabase`의 3클라이언트 체계 — 쿠키 기반 anon 서버 클라이언트(`server.ts`), `"server-only"`가 걸린 service-role 클라이언트(`admin.ts`), 브라우저 클라이언트(`client.ts`) — 로 분리되며, service-role 사용처는 40개 파일로 추적 가능하다.

DB 스키마는 `supabase/migrations`(CLI 추적) 없이 **`supabase/sql/`의 수동 번호제 SQL 119번대 파일**로 운영된다. `INDEX.md`가 파일별 목적·적용 메모를 정본 관리하고, 번호 중복(002 계열 3개)은 `README_002_apply_order.md`로 적용 순서를 별도 문서화하며, `bundles/`에 001–069 구간 합본이 있다. 마이그레이션 이력 자체가 RLS 잠금(023/025/028), 수수료 정본화(090/095/096: 5%·15%·15%), 에스크로(054–057), 정산 배치(106–114) 등 보안·정산 강화의 연대기 역할을 한다.

결제 흐름은 이중 구조다. **(1) 실결제(토스)는 캐시 충전에만** 쓰인다: 클라이언트 SDK 결제 → `app/api/toss/confirm`(Toss 승인 API 호출, 금액·허용 패키지·orderId의 사용자 일치 검증) → service-role RPC `record_cash_topup`(orderId를 `cash_ledger.idempotency_key`로 멱등 처리). `app/api/toss/webhook`은 서명 검증 후 Toss 결제 조회 API로 상태·금액을 재검증해 confirm 유실분을 보정하는 고아결제 복구 경로이며 `admin_action_logs`에 감사 기록을 남긴다. **(2) 플랫폼 내 금전 이동은 전부 지갑 차감**으로, 구독(`record_subscription_cash_debit`, `sub_debit_<paymentId>` 멱등 키), 맞춤의뢰 에스크로(hold/payout/refund/dispute_split), 개별질문(hold/release) 등 SECURITY DEFINER RPC로 DB에 집중돼 있다. 정기결제는 `app/api/cron/subscription-renewal`이 `CRON_SECRET` timing-safe 비교 + `SUBSCRIPTION_RENEWAL_ENABLED` 킬스위치로 보호된 배치로 수행하고, 충전 직후 `past_due` 구독을 best-effort로 복구하는 훅(`lib/toss/cashTopupFromPayment.ts`)이 붙어 있다.

### 잘 된 점

- 금전 경로의 DB RPC 집중과 멱등성 설계 — 충전(cash_ledger.idempotency_key=orderId), 구독 차감(sub_debit_<paymentId> + on conflict do nothing), 에스크로·환불·분쟁 분배가 전부 service-role 전용 SECURITY DEFINER RPC(019~/054~/091~)로 단일화되어 앱 코드가 잔액을 직접 UPDATE하는 경로가 없다. 023/024는 RPC를 service_role 전용으로 REVOKE까지 해 클라이언트 직접 호출을 봉쇄했다.
- 토스 웹훅의 다층 방어 — raw body 서명 검증(verifyTossWebhookSignature) 후에도 웹훅 페이로드를 신뢰하지 않고 Toss 결제 조회 API로 status=DONE·orderId·paymentKey·금액 일치를 재검증한 뒤에만 원장을 기록하며(app/api/toss/webhook/route.ts:103-127,172), 허용 충전 패키지 화이트리스트(isAllowedChargePayKrw)를 confirm·webhook 양쪽 서버에서 검사한다. confirm/webhook이 lib/toss/cashTopupFromPayment.ts 하나를 공유해 로직 중복이 없다.
- 라우트 그룹 layout 단위 역할 격리 — (student)/(mentor)/(admin) 각 layout이 requireRole을 강제하고, 미들웨어는 인증 없이 헤더 주입만 담당해 책임이 명확하다. 크론 엔드포인트는 timingSafeEqual 비교 + 환경변수 킬스위치라는 운영 안전장치를 갖췄다(app/api/cron/subscription-renewal/route.ts:8-32).
- 마이그레이션 운영의 문서화 수준 — supabase/sql/INDEX.md가 119개 파일 전부의 목적·유형·적용 메모를 표로 정본화하고, 번호 충돌(002 계열)은 README_002_apply_order.md로 의존성 기반 적용 순서를 명시했다. 수수료 15/5/15, 무료질문 정책, RLS 강화가 각각 독립 마이그레이션으로 남아 정책 변경 이력이 추적 가능하다.
- lib 도메인 모듈화와 서버 경계 — 도메인별 모듈(subscribe/cash/toss/qna/customRequest 등)이 화면(app)과 분리되어 있고, service-role 클라이언트는 "server-only" import로 클라이언트 번들 유출 시 빌드가 실패하도록 했다(lib/supabase/admin.ts:1). 결과 타입도 { ok: true } | { ok: false, code, message } 유니언으로 일관된다.
- 구독 체크아웃의 서버측 금액 재산정 — 클라이언트가 보낸 amountCents를 신뢰하지 않고 mentor_plans 행 → 권장가 폴백 순으로 서버에서 차감액을 재계산해 불일치 시 400으로 거부하며(app/api/subscribe/checkout/route.ts:68-92), 0원 차감 방어(resolveMentorPlanDebitAmount)까지 있다. CLAUDE.md의 가격 밴드 잠금값 설계와 코드가 일치한다.

### 구조적 리스크

- 금전 핵심 경로의 런타임 스키마 탐사 패턴 — 구독 체크아웃(lib/subscribe/subscribeCheckoutService.ts:32-35)이 SUB_TABLES=["subscriptions","mentor_subscriptions","user_subscriptions"], PAY_TABLES 후보를 매 요청 프로브하고 pickExistingColumn(lib/qna/safeSelect.ts)으로 컬럼 존재를 추측하며 행을 Record<string,unknown>으로 다룬다. TypeScript strict 규칙이 사실상 무력화되고, 체크아웃 1회당 탐사 쿼리 수 배가 늘며, 운영 DB에 레거시 테이블이 남아 있으면 결제 판단(활성 구독 존재 여부 등)이 조용히 달라질 수 있다. Supabase 타입 생성(generated types) 도입으로 대체할 구조다.
- 마이그레이션 적용 상태의 코드 외부 의존 — supabase/migrations(CLI 이력) 없이 SQL Editor 수동 적용에 의존하고, 어떤 파일이 프로덕션에 적용됐는지는 파일 주석("staging 적용됨")과 INDEX.md 메모, 운영자 기억으로만 확인된다. DRAFT 파일(002_app_core_schema_draft, 036)이 실적용 파일과 같은 폴더에 섞여 있고 번호 중복(002×3, 032/033/034/039 각 2개, 053b/073b)이 누적돼, 신규 환경 재구축이나 repo-DB 드리프트 검증이 사람 손에 달려 있다. bundles도 001-069까지만 있어 070 이후는 합본조차 없다.
- 비즈니스 정본값의 TS-SQL 이중 정의 — 수수료 15/5/15는 SQL(090/095/096)에, 가격 밴드·카탈로그는 TS(lib/subscribe/mentorPlanPricing.ts, subscribePlanCatalog.ts)에 각각 존재해 수동 동기화가 필요하다. CLAUDE.md 2026-07-12 개정 이력이 보여주듯 이미 한 차례 가격 체계가 갈아엎어졌고, 다음 개정 때 한쪽만 바뀌면 표시가와 실차감액이 어긋나는 구조다(현재는 폴백 체인으로 완충).
- package.json이 선언한 거버넌스 스크립트의 부재 — check:frozen-canon, inventory:routes, inventory:actions, dep:baseline, screenshots가 참조하는 scripts/check-frozen-canon.mjs 등 5개 파일이 실제 scripts/에는 없고 generate-review-report.mjs만 존재한다. docs/architecture/frozen-canon.json 등 산출물은 남아 있어, 잠금값 자동 검증 체계가 문서상으로만 존재하고 실행은 불가능한 상태다.
- layout 가드의 헤더 주입 의존 — (student) layout이 x-pathname 값으로 게스트 허용·플래그 분기를 수행하는데(app/(student)/layout.tsx:31-49), 이 값은 middleware.ts의 matcher 정규식이 해당 요청을 커버할 때만 세팅된다. 헤더 부재 시 빈 문자열로 기본 가드가 적용돼 fail-closed이긴 하나, matcher 변경·정적 확장자 추가 같은 미들웨어 수정이 원거리의 인증 분기 동작을 바꾸는 암묵적 결합이며 회귀 테스트 없이는 감지가 어렵다.
- 보상 로직의 앱 레이어 분산 — 결제 성공 후 원장 누락 보정(repairMissingSubscriptionCashLedgerIfNeeded), 충전 후 past_due 복구(recoverPastDueAfterTopup, 예외를 삼킴), room 생성 service-role 재시도 등 부분 실패 보정이 DB 트랜잭션이 아닌 앱 코드의 다단계 best-effort로 흩어져 있다. 각 단계는 멱등 키로 이중 차감은 막았지만, 실패 관측이 console.error뿐이어서(에러 트래킹 부재) 중간 상태(결제 succeeded·구독 미생성 등)가 누적돼도 운영자가 알기 어렵다.
- 레거시 라우트·저장소 위생 — (student)/questions→/question-room 리다이렉트, (public)/community의 shorts/shortform 병존, cash-history vs wallet/ledger 등 구세대 경로가 잔존해 CLAUDE.md 라우트 표와 실제 트리가 이미 어긋나 있고, 루트에 build_check.txt·tsc_check.txt·review_*.txt·files.zip·tsconfig.tsbuildinfo 같은 빌드 산출물이 커밋돼 있어 리뷰 노이즈와 의도치 않은 내용물 유출 여지가 있다.

## 영역별 총평

**인증·인가** — 웹 인증·인가 골격은 전반적으로 견고하다. 모든 app/(admin) server action이 첫 동작으로 requireRole("admin")을 호출하고(직접 모더레이션은 guarded helper에 위임), app/(mentor) layout+페이지가 requireRole("mentor")를 이중으로 걸며, app/api 라우트는 QnA 세션 actor·역할 검사·CRON_SECRET(timingSafeEqual)·Toss 웹훅 서명·주문 소유자 확인으로 보호된다. 수평 접근도 assertRoomParty/canAccessOrder/노트 author 검증으로 차단되고, users.role UPDATE 자가승격은 트리거 119로 막혀 있다. 다만 트리거 119가 커버하지 못하는 신규 가입 INSERT 경로에서 클라이언트가 넘긴 app_role='admin'이 그대로 관리자 역할로 기록되는 치명적 수직 권한 상승 구멍이 하나 존재한다. 이 외 커뮤니티 조회수 증가 엔드포인트의 인증 부재가 경미한 무결성 이슈로 확인됐다.

**결제·캐시·정산** — 결제·캐시·정산의 핵심 경로는 전반적으로 견고하다: 지갑 증감은 전부 service_role 전용 SECURITY DEFINER RPC(019/020/054~057/068/070)로 원장 멱등키(on conflict do nothing)+음수 잔액 가드(balance_cents >= 금액)와 함께 처리되고, 웹훅은 HMAC 서명 검증과 토스 재조회 대조를 갖췄으며, 플랜 카탈로그·가격 밴드·수수료 상수(15/5/15%)는 잠금값과 일치한다. 다만 (1) 토스 confirm 라우트가 인증·패키지 검증 전에 실승인(카드 청구)을 실행하고 실패 시 취소하지 않는 점, (2) 분쟁 분배 RPC(057)에 폐기된 20% 수수료가 잔존해 멘토가 과소 지급되는 점, (3) subscriptions 평생 1행 유니크와 insert 전용 체크아웃이 충돌해 재구독이 불가능한 점이 우선 수정 대상이다. 그 외 갱신 정산 환불 가드의 payment_id 매칭 공백, 초기 billing event 기록의 침묵 실패 등 정합성 리스크가 중간 수위로 확인됐다.

**핵심 도메인 워크플로** — 담당 영역(질문방·연결노트·개별질문·맞춤의뢰·구독 전이)의 권한 검증과 상태 머신은 대체로 견고합니다. 방 소유권 검증(assertRoomParty/ensureRoomScope), 개별질문 party 검증, 맞춤의뢰 RPC 잠금(FOR UPDATE)·멱등키, 주간 한도 경계(can_ask = used<limit, 라이트4/스탠다드9/프리미엄999)는 정확합니다. 다만 (1) past_due(유예) 구독이 코드 곳곳에서는 "사용 가능"으로 취급되는데 질문방/연결노트/주간한도 게이트만 status='active'만 인정해 유예 중 유료 학생·멘토가 접근 차단되는 정합성 붕괴, (2) 정지·차단 계정이 질문방 폼에선 막히지만 JSON API 경로에선 계정 상태 검사가 누락되는 우회, (3) 연결노트 편집 만료차단 게이트가 폼이 보낸 roomId를 그대로 신뢰해 다른 방 id로 우회 가능한 점, (4) 맞춤의뢰 수정요청 RPC가 order_status만 갱신하고 primary status 컬럼을 안 바꿔 "수정 요청" 상태가 앱 표시·판정에서 사라지는 상태머신 불일치 등이 발견되었습니다.

**커뮤니티·스토리지·신고** — 커뮤니티·스토리지·신고 영역은 전반적으로 기본기가 갖춰져 있다 — 작성자 검증(author_id eq + RLS cp_update_own/sf_update_own), 업로드 매직바이트·MIME·크기 검증(게시판 이미지), private 버킷 + 표시 시점 서명 URL(BUG-B 수정), dangerouslySetInnerHTML 미사용으로 본문 XSS 없음, 좋아요 중복은 DB 유니크 제약으로 방어, user_blocks 필터도 스펙(v1: 목록·댓글) 범위 내 페이지에 적용돼 있다. 다만 관리자 신고 처리의 '숨김/삭제' 버튼이 content_reports CHECK 제약을 위반해 콘텐츠만 변경되고 신고 처리·감사 로그가 실패하는 정합성 버그, UI가 500MB라 안내하는 숏폼 업로드가 Server Action 25MB 한도에 막히는 기능 결함이 고심각도로 확인됐다. 그 외 게시판 댓글(comments 테이블)의 관리자 모더레이션 경로 부재, 정지 계정 게이트 누락 2곳, hidden input(existingImageUrls·videoUrl)을 통한 외부 URL 무검증 저장·렌더링 등 중간 심각도 이슈가 있다.

**DB 마이그레이션·RLS** — supabase/sql 001~119 전반의 RLS 커버리지는 양호하다 — 생성된 모든 테이블에 RLS가 활성화되어 있고, 돈을 움직이는 코어 RPC(019/020/054~057/068/088/108/109)는 service_role 전용으로 잠겨 있으며 SECURITY DEFINER 함수 전부가 search_path를 고정하고 있다. 그러나 (1) 가입 트리거가 클라이언트 제공 메타데이터의 app_role='admin'을 그대로 수용해 누구나 스스로 admin이 될 수 있는 P0 구멍이 남아 있고(119 가드는 UPDATE만 차단), (2) users/reviews의 UPDATE 정책이 컬럼 제한 없이 열려 있어 정지 해제·리뷰 평점 조작이 가능하며, (3) 후불 정산 시리즈(105~114)가 확정된 뒤에도 091의 authenticated 지급 래퍼가 즉시지급 primitive에 직결된 채 남아 원천징수 3.3% 우회 경로가 된다. 115 계정삭제는 학교인증·학적변경·Storage 객체의 PII를 남긴다.

**프론트엔드 규칙 준수** — 웹 저장소의 프론트엔드는 전반적으로 규칙 준수 수준이 높은 편입니다 — window.alert/alert() 사용 0건, "정산 대기"·"작업전" 등 통일 문구 위반 0건, 서버 비밀의 클라이언트 노출 0건, 요금제 가격·수수료 상수는 정본 파일(subscribePlanCatalog/mentorPlanPricing/mentorPayoutsConstants)로 잘 수렴되어 있고 구독 결제 API도 서버에서 금액을 재검증합니다. 다만 커뮤니티 게시판이 paginate 모드에서 최초 12개 이후 글에 영구히 접근 불가한 실기능 버그가 있고, 랜딩의 금지 문구 "쌤버쉽"+별표 리터럴 노출, 폐기된 "베이직" 표기 잔존(약관 포함), formatCashKrw 우회로 인한 캐시 표기 혼재("N캐시" vs "N 캐시"), 가입 페이지의 개발자 메모 노출 등 사용자 노출 카피·표기 결함이 다수 확인됐습니다. 그 외 정적 인라인 style과 불필요한 'use client', AppToast 타이머 리셋 같은 규칙 위반·엣지 버그는 낮은 위험이지만 정리가 필요합니다.

## 발견사항 목록

| # | 심각도 | 제목 | 위치 |
|---|---|---|---|
| 1 | 🔴 치명 | 회원가입 메타데이터로 admin 역할 자가 승격 (수직 권한 상승) | `supabase/sql/001_initial_auth_profile.sql:99` |
| 2 | 🟠 높음 | 분쟁 예치 분배 RPC가 여전히 20% 수수료를 공제 — 맞춤의뢰 수수료 잠금값 5%와 불일치(멘토 15%p 과소 지급) | `supabase/sql/057_p0_custom_order_dispute_split.sql:35` |
| 3 | 🟠 높음 | 재구독 불가 — subscriptions 평생 1행 유니크(uq_subscriptions_pair)와 insert 전용 신규 구독 생성 로직 충돌 | `lib/subscribe/subscribeCheckoutService.ts:958` |
| 4 | 🟠 높음 | 신고 모더레이션(숨김/삭제) 시 content_reports.status CHECK 제약 위반 — 콘텐츠는 변경되고 신고 처리만 실패 | `lib/admin/adminReportActions.ts:135` |
| 5 | 🟠 높음 | 숏폼 영상 업로드: UI는 500MB 허용이라고 안내하지만 Server Action bodySizeLimit이 25MB — 25MB 초과 업로드 전부 실패 | `next.config.ts:7` |
| 6 | 🟠 높음 | users_update_own 컬럼 무제한 — 정지(suspended)·차단(banned)·삭제(deleted) 상태를 본인이 직접 해제 가능 | `supabase/sql/001_initial_auth_profile.sql:205` |
| 7 | 🟠 높음 | reviews UPDATE 정책 컬럼 무제한 — 멘토가 자기 리뷰의 rating·본문·is_hidden을 직접 조작 가능 | `supabase/sql/042_reviews_system.sql:43` |
| 8 | 🟠 높음 | 091 release 래퍼(authenticated)가 즉시지급 primitive 직결 — 후불 배치·원천징수 3.3% 우회 구멍 | `supabase/sql/091_individual_question_release_refund_wrappers.sql:64` |
| 9 | 🟡 중간 | 토스 결제 승인(confirm)이 사용자 인증·충전 패키지 검증보다 먼저 실행되고, 승인 후 검증 실패 시 결제 취소가 없음 | `app/api/toss/confirm/route.ts:26` |
| 10 | 🟡 중간 | 구독 갱신(renewal) 건은 payment_id가 NULL이라 099 '정산 지급완료 시 환불 차단' 가드가 영구히 매칭 불가 | `supabase/sql/099_subscription_refund_settlement_paid_guard.sql:103` |
| 11 | 🟡 중간 | 초기 구독 billing event 기록 실패가 조용히 무시되어 멘토 정산 원천 데이터가 누락될 수 있음 | `lib/subscribe/subscribeCheckoutService.ts:245` |
| 12 | 🟡 중간 | 구독 활성화(insert)가 캐시 차감보다 먼저 수행되고 롤백이 best-effort 삭제에 의존(ZOMBIE_SUBSCRIPTION_RISK) | `lib/subscribe/subscribeCheckoutService.ts:873` |
| 13 | 🟡 중간 | 정지·차단(suspended/banned) 계정이 질문방 JSON API 경로로 스레드·답변·확정 생성 가능 (계정상태 게이트 누락) | `app/api/question-room/threads/route.ts:42` |
| 14 | 🟡 중간 | 연결노트 수정·삭제의 만료차단 게이트가 폼이 보낸 roomId를 신뢰해 다른 방 id로 우회 가능 | `lib/qna/questionRoomActions.ts:646` |
| 15 | 🟡 중간 | 맞춤의뢰 수정요청 RPC가 order_status만 갱신하고 primary status 컬럼을 안 바꿔 '수정 요청' 상태가 앱에서 소실됨 | `supabase/sql/088_custom_order_status_transition_rpcs.sql:378` |
| 16 | 🟡 중간 | 게시판 댓글 테이블(comments)에 관리자 모더레이션 경로가 전혀 없음 | `lib/admin/communityModerationCore.ts:29` |
| 17 | 🟡 중간 | 정지·차단 계정 게이트(assertAccountActive) 누락 — 숏폼 댓글 작성과 멘토 커뮤니티 작성 경로 | `lib/community/commentActions.ts:53` |
| 18 | 🟡 중간 | 게시글 이미지: 클라이언트가 보낸 existingImageUrls를 검증 없이 저장 — 임의 외부 URL이 모든 조회자에게 <img src>로 렌더링 | `lib/community/communityBoardActions.ts:86` |
| 19 | 🟡 중간 | 숏폼 videoUrl hidden 필드 무검증 저장 + source 폴백 — 임의 외부 URL이 <video src>로 재생 | `lib/community/communityShortformActions.ts:68` |
| 20 | 🟡 중간 | 108 지급 배치에 항목별 예외 격리 없음 — 비정상 1건이 월 전체 지급을 롤백 | `supabase/sql/108_pay_due_payouts_rpc.sql:105` |
| 21 | 🟡 중간 | 115 계정삭제가 학교인증·학적변경·Storage 객체의 PII를 남김 (익명화 불완전) | `supabase/sql/115_account_deletion.sql:89` |
| 22 | 🟡 중간 | 커뮤니티 게시판(paginate 모드)에서 최초 12개 이후의 글에 접근 불가 | `components/community/CommunityHomeFeed.tsx:187` |
| 23 | 🟡 중간 | 랜딩 페이지에 금지 문구 "쌤버쉽" 사용 + 하이라이트 마커(*)가 화면에 그대로 노출 | `components/landing/PublicGuestLanding.tsx:41` |
| 24 | 🟡 중간 | 폐기된 요금제 표기 "베이직"이 사용자 노출 페이지 3곳에 잔존 (잠금값 위반) | `app/(public)/support/page.tsx:31` |
| 25 | 🟡 중간 | 회원가입 페이지에 개발자용 안내 문구(NEXT_PUBLIC_* 환경 변수 등)가 최종 사용자에게 노출 | `app/signup/page.tsx:944` |
| 26 | ⚪ 낮음 | 게시글 조회수 증가 API에 인증·중복 제어 없음 (조회수 조작) | `app/api/community/board/view/route.ts:10` |
| 27 | ⚪ 낮음 | 결제 성공 후 원장 보정(alreadySucceeded 경로)이 결제 시점 금액이 아닌 '현재' 멘토 플랜가로 차감 | `lib/subscribe/subscribeCheckoutService.ts:774` |
| 28 | ⚪ 낮음 | 이용 개시 판정(hasSubscriptionUsageStartedForPair)이 조회 오류 시 false를 반환해 '이용 개시 전 = 전액 환불' 방향으로 fail-open | `lib/subscribe/subscriptionUsageStarted.ts:36` |
| 29 | ⚪ 낮음 | confirm 금액 대조가 토스 응답 totalAmount 누락 시 클라이언트 amount로 폴백되어 공회전 | `app/api/toss/confirm/route.ts:45` |
| 30 | ⚪ 낮음 | past_due(유예) 구독에서 질문방·연결노트·주간한도 접근이 부당하게 차단됨 (grace 정책과 정합성 붕괴) | `lib/subscribe/subscribeCheckoutService.ts:44` |
| 31 | ⚪ 낮음 | 무료 질문권이 스레드 생성 실패 시에도 소진됨 (폼 경로에서 기록이 생성보다 앞섬) | `lib/qna/questionThreadSubscriptionGuard.ts:32` |
| 32 | ⚪ 낮음 | 콘텐츠 신고 무제한 중복 접수 가능 — 동일 사용자·동일 대상 dedup/رate limit 부재 | `lib/community/communityReportActions.ts:68` |
| 33 | ⚪ 낮음 | returnPath 리다이렉트 검증 불일치 — 절대 URL·'//host' 통과로 오픈 리다이렉트 여지 | `lib/community/communityBoardActions.ts:157` |
| 34 | ⚪ 낮음 | 숏폼 category를 검증 없는 타입 단언으로 저장 — 임의 문자열이 category 컬럼에 유입 | `lib/community/communityShortformActions.ts:55` |
| 35 | ⚪ 낮음 | cash_ledger append-only가 'RLS 무정책'에만 의존 — 106식 UPDATE/DELETE 차단 트리거 부재 | `supabase/sql/004_p0_cash_disputes_admin_draft.sql:170` |
| 36 | ⚪ 낮음 | 108 cutoff 계산이 무타임존 timestamp 연산 — DB 타임존(UTC) 기준 전월말로 KST 명세와 9시간 오차 | `supabase/sql/108_pay_due_payouts_rpc.sql:49` |
| 37 | ⚪ 낮음 | formatCashKrw 미사용 수작업 캐시 포맷이 광범위 — "84,900캐시"(무공백)와 "84,900 캐시"(공백) 표기 혼재 | `components/subscribe/SubscribeCheckoutClient.tsx:21` |
| 38 | ⚪ 낮음 | 정적 값 인라인 style 다수 — "Tailwind only · 인라인 style 금지" 규칙 위반 | `components/customRequest/CustomRequestPostListTable.tsx:24` |
| 39 | ⚪ 낮음 | AppToast의 useEffect 의존성이 [props]라 부모 리렌더마다 자동 닫힘 타이머가 리셋됨 | `components/ui/AppToast.tsx:13` |
| 40 | ⚪ 낮음 | 상호작용 없는 순수 표시 컴포넌트 다수에 'use client' 지정 — 서버 컴포넌트 이점 상실 | `components/notices/PublicNoticesList.tsx:1` |
| 41 | ⚪ 낮음 | 브랜드 Primary 정본 충돌 — CLAUDE.md는 #1A56DB(변경 금지), 코드·디자인 토큰은 #2563EB | `styles/design-system-tokens.css:33` |

## 상세 발견사항

### 🔴 치명 (critical)

#### 1. 🔴 회원가입 메타데이터로 admin 역할 자가 승격 (수직 권한 상승)

| | |
|---|---|
| **심각도** | 치명 (critical) |
| **분류** | privilege-escalation |
| **위치** | `supabase/sql/001_initial_auth_profile.sql:99` |
| **판정** | 확정(CONFIRMED) · web-auth,web-sql |

**문제**

신규 가입 시 auth.users에 AFTER INSERT로 걸린 트리거 handle_new_auth_user()가 클라이언트가 넘긴 raw_user_meta_data.app_role 값을 그대로 public.users.role에 기록한다. 허용 집합에 'admin'이 포함되어 있어(=student/mentor로 강등하지 않음), 공개 anon 키로 supabase.auth.signUp({ email, password, options: { data: { app_role: 'admin' }}}) 를 직접 호출하면 role='admin' 프로필이 생성된다. 웹의 requireRole("admin")과 /admin/login은 public.users.role === 'admin' 만 확인하고 이메일 도메인·2차 검증이 없으므로, 공격자는 본인 소유 이메일을 인증한 뒤 관리자 콘솔 전체와 모든 admin server action(환불 승인·정산 해제·제재·모더레이션 등)에 접근할 수 있다. UPDATE 자가승격은 트리거 119(trg_users_role_guard, BEFORE UPDATE)로 차단되지만, 이 벡터는 신규 INSERT 경로라 119가 발동하지 않는다. signup 폼(buildSignupUserMetadata)이 role을 student/mentor로 제한하는 것은 정상 UI 경로일 뿐, 서버/DB가 admin을 거부하지 않으므로 실질 방어가 없다.

**근거 코드**

```
r := lower(trim(m->>'app_role'));
  if r is null or r = '' then
    r := 'student';
  end if;
  if r not in ('student', 'mentor', 'admin') then
    r := 'student';
  end if;
  ...
  insert into public.users ( id, role, ... ) values ( NEW.id, r, 'active', ... )
  on conflict (id) do update set role = excluded.role, ...
```

**권고**

트리거에서 메타데이터 기반 role을 student/mentor로만 강제하라. 예: `if r not in ('student','mentor') then r := 'student'; end if;` (즉 'admin'을 허용 집합에서 제거). admin 프로비저닝은 signup 메타데이터가 아니라 service_role 또는 SQL 콘솔 등 대역외 경로로만 수행해야 한다. on conflict do update의 role=excluded.role도 동일하게 admin 승격 통로가 되지 않도록 강등 규칙을 적용할 것. 이미 존재하는 계정 중 이 경로로 생성된 admin 여부도 감사 필요.

---

### 🟠 높음 (high)

#### 2. 🟠 분쟁 예치 분배 RPC가 여전히 20% 수수료를 공제 — 맞춤의뢰 수수료 잠금값 5%와 불일치(멘토 15%p 과소 지급)

| | |
|---|---|
| **심각도** | 높음 (high) |
| **분류** | fee-consistency |
| **위치** | `supabase/sql/057_p0_custom_order_dispute_split.sql:35` |
| **판정** | 확정(CONFIRMED) · web-pay |

**문제**

CLAUDE.md 잠금값과 090_custom_order_fee_5pct.sql은 맞춤의뢰 플랫폼 수수료를 5%(멘토 95%)로 확정했으나, 090은 accept_custom_order_deliverable_atomic만 교체했고 record_custom_order_dispute_split(057)의 v_fee_rate := 0.20은 그대로 남아 있다. 관리자가 분쟁을 분할 해결하면 멘토는 배정 gross의 80%만 지급받아(186~188행: floor(p_mentor_gross_won * 0.20) 공제) 정상 정책(95%) 대비 15%p 손해를 본다. 이 RPC는 lib/customRequest/customOrderDisputeSplitService.ts에서 실제로 호출되는 라이브 경로이며, 057은 108~114 같은 DRAFT가 아니다.

**근거 코드**

```
-- 057_p0_custom_order_dispute_split.sql
  v_fee_rate numeric := 0.20;
...
  v_platform_fee_won := floor(p_mentor_gross_won * v_fee_rate)::integer;
  v_mentor_net_won := p_mentor_gross_won - v_platform_fee_won;
  v_mentor_cents := v_mentor_net_won::bigint * 100;
```

**권고**

090과 동일한 방식으로 record_custom_order_dispute_split을 create or replace 하여 v_fee_rate를 0.05로 교체하는 후속 SQL(예: 0xx_custom_order_dispute_split_fee_5pct.sql)을 추가하고, 함수 comment의 '20% 공제' 문구도 함께 갱신한다.

---

#### 3. 🟠 재구독 불가 — subscriptions 평생 1행 유니크(uq_subscriptions_pair)와 insert 전용 신규 구독 생성 로직 충돌

| | |
|---|---|
| **심각도** | 높음 (high) |
| **분류** | correctness |
| **위치** | `lib/subscribe/subscribeCheckoutService.ts:958` |
| **판정** | 확정(CONFIRMED) · web-pay |

**문제**

subscriptions에는 (student_id, mentor_id) 평생 1행 유니크 인덱스가 존재한다(002_p0_subscriptions_questions_draft.sql:99, 064:15의 'No change to uq_subscriptions_pair lifetime one-row model' 주석으로 라이브 확인). 그런데 finalizeSubscriptionCheckout의 insertSubscriptionRow는 무조건 새 행 insert만 시도하고, 23505는 isSchemaNotReadyError에 해당하지 않아 legacy 후보 테이블(mentor_subscriptions 등, 실존하지 않음)로 폴백 후 전부 실패한다. 만료(markExpired)·해지(approve_refund의 status='canceled') 시 기존 행은 삭제되지 않으므로, UI가 '재구독 가능'(subscriptionDisplay.ts:84)과 resubscribeHref(/subscribe?mentorId=...)로 유도하는 재구독 결제가 항상 'subscriptions 생성 실패: duplicate key...'로 실패한다. 차감 이전 단계라 금전 손실은 없지만 핵심 구매 동선이 깨진다.

**근거 코드**

```
// insertSubscriptionRow — 평생 1행 유니크에 대한 upsert/재활성화 없음
const canonical = await admin
  .from(SUBSCRIPTIONS_TABLE)
  .insert(buildSubscriptionsInsertPayload({ ... }))
  .select("id")
  .maybeSingle();
...
if (canonical.error && isSchemaNotReadyError(canonical.error)) { /* 23505는 여기 해당 안 됨 */ }

-- 002_p0_subscriptions_questions_draft.sql:99
create unique index if not exists uq_subscriptions_pair on public.subscriptions (student_id, mentor_id);
```

**권고**

insertSubscriptionRow에서 23505(uq_subscriptions_pair) 발생 시 기존 (student_id, mentor_id) 행을 조회해 status가 expired/canceled면 새 payment_id·plan·기간 필드로 UPDATE(재활성화)하는 분기를 추가하거나, upsert(onConflict: 'student_id,mentor_id') 경로로 전환한다. 재활성화 시 billing 기간 필드를 buildInitialSubscriptionPeriodFields로 재설정해야 한다.

---

#### 4. 🟠 신고 모더레이션(숨김/삭제) 시 content_reports.status CHECK 제약 위반 — 콘텐츠는 변경되고 신고 처리만 실패

| | |
|---|---|
| **심각도** | 높음 (high) |
| **분류** | correctness |
| **위치** | `lib/admin/adminReportActions.ts:135` |
| **판정** | 확정(CONFIRMED) · web-comm |

**문제**

updateContentReportModerationAction은 먼저 applyContentModeration(service role)으로 실제 게시물을 숨김/삭제한 뒤, 신고 행 status를 statusMap에 따라 'hidden'/'removed'로 업데이트한다. 그러나 content_reports에는 status in ('pending','reviewing','resolved','rejected','dismissed') CHECK 제약(032_p1_admin_content_reports.sql:25-27)이 있어 'hidden'/'removed' 업데이트는 항상 23514로 실패한다. 결과: (1) 콘텐츠는 이미 숨김/삭제됐는데 관리자는 오류 화면을 보고, (2) 신고는 pending으로 남아 재시도 시 모더레이션이 반복 실행되며, (3) redirect(errUrl)로 빠져나가 tryInsertAdminReportNote·logAdminAction(감사 로그)·revalidatePath가 전부 건너뛰어진다. AdminContentReportsTable.tsx:210-215의 '숨김'/'삭제' 버튼이 이 경로를 그대로 호출한다.

**근거 코드**

```
const statusMap: Record<string, string> = {
  hidden: "hidden",
  deleted: "removed",
  restored: "resolved",
};
...
const { data, error } = await supabase.from(TABLE).update(patch).eq("id", reportId).select("id");
if (error) redirect(errUrl(safeMsg(error.message)));

-- 032_p1_admin_content_reports.sql
constraint content_reports_status_allowed check (
  status in ('pending', 'reviewing', 'resolved', 'rejected', 'dismissed')
)
```

**권고**

statusMap을 CHECK 제약이 허용하는 값으로 매핑(예: hidden/deleted → 'resolved', 처리 내용은 admin_note·logAdminAction detail에 기록)하거나, 제약에 'hidden','removed'를 추가하는 마이그레이션을 작성하고 contentReportStatusLabel에도 라벨을 추가한다. 또한 콘텐츠 변경 전에 신고 상태 업데이트 가능 여부를 먼저 검증해 부분 실패(콘텐츠만 변경)를 없앤다.

---

#### 5. 🟠 숏폼 영상 업로드: UI는 500MB 허용이라고 안내하지만 Server Action bodySizeLimit이 25MB — 25MB 초과 업로드 전부 실패

| | |
|---|---|
| **심각도** | 높음 (high) |
| **분류** | runtime-bug |
| **위치** | `next.config.ts:7` |
| **판정** | 확정(CONFIRMED) · web-comm |

**문제**

숏폼 업로드는 Server Action FormData로 영상 파일을 전송한다(submitShortformUploadAction → uploadShortformVideo, 한도 SHORTFORM_VIDEO_MAX_BYTES=524,288,000=500MB, 버킷 file_size_limit도 500MB). 업로드 폼 카피도 '영상 (mp4/mov, 최대 3분/500MB)'(CommunityShortformComposeForm.tsx:98)라고 안내한다. 그러나 next.config.ts의 serverActions.bodySizeLimit이 '25mb'라서 25MB를 넘는 요청은 액션에 도달하기 전에 프레임워크가 거부한다. 3분짜리 일반 화질 영상은 대부분 25MB를 초과하므로 핵심 숏폼 업로드 플로우가 사실상 동작하지 않고, 사용자는 'video_size' 같은 친화적 에러 대신 원인 불명의 실패를 본다.

**근거 코드**

```
serverActions: {
  /** 맞춤의뢰 납품 파일(최대 20MB) — Server Action FormData */
  bodySizeLimit: "25mb",
}

// communityShortformConstants.ts:14
export const SHORTFORM_VIDEO_MAX_BYTES = 524288000;
// CommunityShortformComposeForm.tsx:98
<p ...>영상 (mp4/mov, 최대 3분/500MB)</p>
```

**권고**

숏폼 영상은 Server Action 경유 업로드 대신 Supabase Storage 서명 업로드 URL(createSignedUploadUrl)로 클라이언트 직접 업로드하도록 바꾸거나, bodySizeLimit을 실제 한도에 맞게 상향한다. 어느 쪽이든 UI 안내(500MB)와 실효 한도를 일치시킨다.

---

#### 6. 🟠 users_update_own 컬럼 무제한 — 정지(suspended)·차단(banned)·삭제(deleted) 상태를 본인이 직접 해제 가능

| | |
|---|---|
| **심각도** | 높음 (high) |
| **분류** | security/authorization-bypass |
| **위치** | `supabase/sql/001_initial_auth_profile.sql:205` |
| **판정** | 확정(CONFIRMED) · web-sql |

**문제**

users_update_own 정책은 id=auth.uid()만 검사하고 컬럼 제한이 없어, 로그인 세션이 살아 있는 사용자가 PostgREST로 자신의 status/suspended_until/status_reason을 임의 갱신할 수 있다. 102는 '핵심 액션 차단은 RLS가 아니라 앱 서버 액션 가드에서 수행'(102:8)이라고 명시하는데, 그 앱 가드가 읽는 users.status 자체가 사용자 손에 있으므로 정지·차단이 강제력을 잃는다. 115의 계정삭제(status='deleted')도 같은 경로로 되돌릴 수 있다. 119는 role 컬럼만 가드하며 status는 방치되어 있다(119 헤더 스스로 '컬럼 제한 없이 본인 행 UPDATE 허용'을 인지하면서 role만 조치).

**근거 코드**

```
create policy "users_update_own" on public.users
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));
-- 102_account_status_management.sql:8 '핵심 액션 차단은 RLS 가 아니라 앱 서버 액션 가드에서 수행'
```

**권고**

119와 같은 패턴의 BEFORE UPDATE 트리거로 status/suspended_until/status_reason/status_changed_* 변경을 service_role·admin·무JWT 세션으로 제한하거나, authenticated의 UPDATE를 컬럼 단위 GRANT(nickname 등 프로필 컬럼만)로 좁힌다.

---

#### 7. 🟠 reviews UPDATE 정책 컬럼 무제한 — 멘토가 자기 리뷰의 rating·본문·is_hidden을 직접 조작 가능

| | |
|---|---|
| **심각도** | 높음 (high) |
| **분류** | security/data-integrity |
| **위치** | `supabase/sql/042_reviews_system.sql:43` |
| **판정** | 확정(CONFIRMED) · web-sql |

**문제**

reviews_update_mentor_reply는 '멘토 답글' 용도라고 주석되어 있으나 USING/WITH CHECK 모두 auth.uid()=mentor_id만 검사하고 갱신 컬럼을 제한하지 않는다. 멘토는 자신에 대한 모든 리뷰 행을 UPDATE할 수 있으므로 rating(004:154, 1~5 check), body/content, 그리고 관리자 모더레이션 컬럼인 is_hidden·is_blinded·moderation_state(033)까지 PostgREST로 직접 고칠 수 있다 — 나쁜 리뷰를 5점으로 바꾸거나 is_hidden=true로 숨겨 avg_rating·노출을 조작하는 경로다. 004의 rev_update_own(author 또는 admin, 004:267-270)도 이후 어떤 마이그레이션에서도 drop되지 않아, 작성 학생이 관리자가 숨긴(is_hidden=true) 자기 리뷰를 스스로 해제할 수도 있다.

**근거 코드**

```
-- 멘토 답글 (본인 리뷰에만)
create policy "reviews_update_mentor_reply" on public.reviews
  for update to authenticated
  using ((select auth.uid()) = mentor_id)
  with check ((select auth.uid()) = mentor_id);
```

**권고**

멘토 답글은 SECURITY DEFINER RPC(mentor_reply/mentor_replied_at만 set)로 옮기고 reviews_update_mentor_reply·rev_update_own 정책을 drop하거나, BEFORE UPDATE 트리거로 mentor 세션에서는 mentor_reply 외 컬럼 변경(OLD.rating IS DISTINCT FROM NEW.rating 등)을 거부.

---

#### 8. 🟠 091 release 래퍼(authenticated)가 즉시지급 primitive 직결 — 후불 배치·원천징수 3.3% 우회 구멍

| | |
|---|---|
| **심각도** | 높음 (high) |
| **분류** | consistency/payout-design |
| **위치** | `supabase/sql/091_individual_question_release_refund_wrappers.sql:64` |
| **판정** | 확정(CONFIRMED) · web-sql |

**문제**

release_individual_question(uuid)은 authenticated에 GRANT된 클라이언트 래퍼로, 돈을 실제로 움직이는 release_individual_question_payout을 직접 호출한다. 후불 정산 시리즈(108/109/110/111/114)는 '확정=mark_individual_question_released(돈 X), 지급=23일 배치(108, 원천징수 3.3% 공제)'로 분리했고 109:188-192는 앱 코드를 mark_...로 교체하라고 명시했지만, 091 래퍼의 위임 대상 변경이나 grant 회수는 119까지 어떤 마이그레이션에도 없다. 이 시리즈 적용 후 학생이 기존 RPC 이름을 호출하면 즉시지급이 일어나고 release_ledger_id가 설정되어 due_payouts(111:74)에서 빠지므로, 108의 'wh:{...}' 원천징수 라인이 영원히 생성되지 않는다 — 멘토가 3.3% 공제 없이 85% 전액을 수령하는 정합성 구멍이다(payout_run_items 스냅샷도 누락).

**근거 코드**

```
v_res := public.release_individual_question_payout(p_question_id);  -- 091:64 (즉시지급 primitive)
...
grant execute on function public.release_individual_question(uuid)
  to authenticated;  -- 091:77-78
-- 109:190-191: 현행 release_individual_question_payout ← 즉시지급 / 변경: mark_individual_question_released ← 확정만
```

**권고**

108/109/110 적용 세트에 '091 래퍼의 위임 대상을 mark_individual_question_released로 교체'하는 마이그레이션을 포함시킬 것. 시그니처·이름을 유지한 채 본문만 교체하면 앱 무변경으로 후불 전환이 완성된다.

---

### 🟡 중간 (medium)

#### 9. 🟡 토스 결제 승인(confirm)이 사용자 인증·충전 패키지 검증보다 먼저 실행되고, 승인 후 검증 실패 시 결제 취소가 없음

| | |
|---|---|
| **심각도** | 중간 (medium) |
| **분류** | payment-flow |
| **위치** | `app/api/toss/confirm/route.ts:26` |
| **판정** | 확정(CONFIRMED) · web-pay |

**문제**

confirm 라우트는 요청 파라미터 존재 여부만 확인한 뒤(11행) 곧바로 토스 /v1/payments/confirm을 호출한다(26행). 허용 패키지 검증(isAllowedChargePayKrw, 50행)과 세션·orderId 소유자 검증(54~62행)은 모두 토스 승인(=실제 카드 청구) '이후'에 수행되며, 검증 실패 시 400/401만 반환할 뿐 토스 결제취소 API를 호출하지 않는다. 클라이언트가 SDK 호출 금액을 임의 값(예: 1,000원)으로 변조해 결제하면 카드가 실제로 청구된 뒤 invalid_package로 거절되고, 웹훅 복구 경로(recordCashTopupFromTossOrder)도 동일한 isAllowedChargePayKrw에서 거부하므로 청구된 돈이 캐시로 적립되지 못한 채 방치된다(수동 환불 필요). 비로그인 호출로도 타인 paymentKey의 승인 트리거가 가능하다.

**근거 코드**

```
const tossRes = await fetch("https://api.tosspayments.com/v1/payments/confirm", { ... body: JSON.stringify({ paymentKey, orderId, amount }) });
...
if (!isAllowedChargePayKrw(confirmedWon)) {           // 승인 후에야 패키지 검증
  return NextResponse.json({ error: "invalid_package", ... }, { status: 400 });
}
const supabase = await createClient();
const { data: { user } } = await supabase.auth.getUser(); // 승인 후에야 인증
const userIdFromOrder = orderId.match(/^cash-(.+)-(\d+)$/)?.[1];
if (!user || !userIdFromOrder || user.id !== userIdFromOrder) {
  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
```

**권고**

토스 confirm 호출 전에 (1) supabase.auth.getUser()로 세션 확인 및 orderId의 userId 일치 검증, (2) isAllowedChargePayKrw(amount) 검증을 먼저 수행해 실패 시 승인 자체를 막는다. 승인 이후 단계에서 검증이 실패하는 경로가 남는다면 토스 결제취소(/v1/payments/{paymentKey}/cancel)를 호출해 청구를 되돌리는 보상 로직을 추가한다.

---

#### 10. 🟡 구독 갱신(renewal) 건은 payment_id가 NULL이라 099 '정산 지급완료 시 환불 차단' 가드가 영구히 매칭 불가

| | |
|---|---|
| **심각도** | 중간 (medium) |
| **분류** | double-loss-guard |
| **위치** | `supabase/sql/099_subscription_refund_settlement_paid_guard.sql:103` |
| **판정** | 확정(CONFIRMED) · web-pay |

**문제**

099 가드는 subscription_settlement_items를 r.payment_id로 매칭하지만, 갱신 결제는 payments 행 없이 process_subscription_renewal(068)이 billing event를 payment_id 없이 생성하고(121~152행 insert 컬럼에 payment_id 없음), 095의 정산행도 e.payment_id(=NULL)를 복사한다. 따라서 갱신 기간 정산행은 payment_id가 항상 NULL이어서 'paid' 상태여도 가드에 절대 걸리지 않는다. 후불 지급 배치(108, 현재 DRAFT)가 가동되면 '멘토 지급완료 + 학생 환불 승인' 이중 손실을 막지 못한다. 또한 requestSubscriptionProratedRefundAction은 갱신 환불에서 paymentId를 최초 결제 id로 폴백(subscriptionCancelActions.ts:229)하므로, 승인 시 이미 소진된 최초 payments 행이 'refunded'로 오기록된다.

**근거 코드**

```
-- 099: 가드가 payment_id 로만 매칭
select s.status into v_settlement_status
from public.subscription_settlement_items s
where s.payment_id = r.payment_id
  and s.status = 'paid'

-- 068 renewal insert: payment_id 컬럼 자체가 없음
insert into public.subscription_billing_events (subscription_id, student_id, mentor_id, event_type, status, period_start, period_end, billing_at, amount_cents, plan_tier, plan_id, idempotency_key, attempt_count, created_at)

// subscriptionCancelActions.ts:229 — 갱신 환불도 최초 payment 로 폴백
const paymentId = stringValue(billingEvent?.payment_id) ?? stringValue(loaded.row.payment_id);
```

**권고**

refunds에 환불 대상 billing_event_id(또는 settlement item id)를 저장하고, 099 가드를 billing_event_id 매칭(subscription_settlement_items.billing_event_id)으로 바꾼다. 갱신 환불에서는 refunds.payment_id를 최초 결제 id로 폴백하지 말고 NULL로 두되, 구독 취소는 subscription_id 기준으로 수행하도록 approve RPC를 보강한다.

---

#### 11. 🟡 초기 구독 billing event 기록 실패가 조용히 무시되어 멘토 정산 원천 데이터가 누락될 수 있음

| | |
|---|---|
| **심각도** | 중간 (medium) |
| **분류** | settlement-integrity |
| **위치** | `lib/subscribe/subscribeCheckoutService.ts:245` |
| **판정** | 확정(CONFIRMED) · web-pay |

**문제**

recordInitialSubscriptionBillingEvent는 subscription_billing_events upsert 실패 시 console.error 후 그냥 return하고, 호출부(finalizeSubscriptionCheckout 905행)도 결과를 확인하지 않는다. 구독 활성화·학생 캐시 차감은 이미 완료된 상태에서 이 이벤트만 누락되면, 멘토 구독 정산의 유일한 원천인 refresh_subscription_settlement_items(095, subscription_billing_events 기반)가 해당 결제의 정산행을 영영 생성하지 못한다. 결과적으로 학생은 차감됐는데 멘토 정산(85%)이 조용히 누락되고, 재시도 경로는 학생이 우연히 complete를 재호출하는 경우뿐이다.

**근거 코드**

```
const { data: eventRow, error: eventError } = await admin
  .from("subscription_billing_events")
  .upsert(payload, { onConflict: "idempotency_key" })
  .select("id")
  .maybeSingle();

if (eventError || !eventRow) {
  if (!isSchemaNotReadyError(eventError)) {
    console.error("[recordInitialSubscriptionBillingEvent] event upsert failed", { subscriptionId, error: eventError });
  }
  return;   // 실패해도 상위로 전파하지 않음
}
```

**권고**

이벤트 기록 실패를 반환값으로 전파해 최소한 admin_action_logs 등 복구 큐에 적재하거나, 별도 배치(정산 refresh 전에 sub_debit_* 원장이 있는데 billing event가 없는 결제를 스캔해 backfill)를 마련해 침묵 누락을 없앤다.

---

#### 12. 🟡 구독 활성화(insert)가 캐시 차감보다 먼저 수행되고 롤백이 best-effort 삭제에 의존(ZOMBIE_SUBSCRIPTION_RISK)

| | |
|---|---|
| **심각도** | 중간 (medium) |
| **분류** | atomicity |
| **위치** | `lib/subscribe/subscribeCheckoutService.ts:873` |
| **판정** | 확정(CONFIRMED) · web-pay |

**문제**

finalizeSubscriptionCheckout은 subscriptions에 status='active' 행을 먼저 insert(873~880행)한 뒤에야 캐시 차감 RPC를 호출한다(882~890행). 차감 실패 시 tryDeleteSubscriptionById로 삭제를 시도하지만 이는 best-effort이며, 삭제 실패 시 코드 스스로 'ZOMBIE_SUBSCRIPTION_RISK'만 로그로 남긴다(1062행). 서버 프로세스가 insert와 debit 사이에서 중단되거나 삭제가 RLS/FK로 실패하면, 결제 없이 활성 구독(질문방 접근 권한 포함)이 남는다. 구독 생성+차감이 단일 DB 트랜잭션이 아니라 애플리케이션 레벨 2단계로 분리되어 있는 구조적 문제다.

**근거 코드**

```
const subInsert = await insertSubscriptionRow(supabase, { studentId, mentorId, planId, planTier, paymentId, payTable });
...
const debit = await repairMissingSubscriptionCashLedgerIfNeeded(supabase, { mode: "newSubscription", ... });
if (!debit.ok) {
  await tryDeleteSubscriptionById(supabase, subId);   // best-effort
  return { ok: false, error: debit.error, code: "db" };
}
...
console.error("[tryDeleteSubscriptionById] ZOMBIE_SUBSCRIPTION_RISK subId:", subId);
```

**권고**

019 record_subscription_cash_debit를 확장해 '구독 insert + 원장 차감 + payments 상태 갱신'을 하나의 SECURITY DEFINER RPC 트랜잭션으로 묶거나, 최소한 subscriptions를 status='pending'으로 만든 뒤 차감 성공 시에만 active로 전환하는 2-phase 순서로 바꿔 결제 없는 active 구독이 생기지 않게 한다.

---

#### 13. 🟡 정지·차단(suspended/banned) 계정이 질문방 JSON API 경로로 스레드·답변·확정 생성 가능 (계정상태 게이트 누락)

| | |
|---|---|
| **심각도** | 중간 (medium) |
| **분류** | authorization |
| **위치** | `app/api/question-room/threads/route.ts:42` |
| **판정** | 확정(CONFIRMED) · web-domain |

**문제**

질문방 폼 서버액션(createQuestionThreadAction/createQuestionMessageAction/saveConnectionNoteAction 등)은 첫머리에서 assertAccountActive(questionRoomActions.ts:187,273,561…)로 정지·차단 계정을 차단한다. 그러나 동일 작업을 수행하는 JSON API 경로(POST /api/question-room/threads → createStudentQuestionThread → assertStudentCanCreateThread, PATCH .../answer, .../confirm)는 어느 단계에서도 assertAccountActive를 호출하지 않는다. getQnaApiSession도 role만 검사한다. 따라서 관리자가 정지·영구차단한 학생/멘토가 API 엔드포인트를 직접 호출하면 질문 스레드 생성·답변·확인 완료를 그대로 수행할 수 있어, 폼에만 적용된 제재가 우회된다.

**근거 코드**

```
const result = await createStudentQuestionThread(
  session.supabase,
  session.user.id,
  roomId,
  title,
  subject,
  topic
);
// createStudentQuestionThread / assertStudentCanCreateThread 어디에도 assertAccountActive 없음
// 반면 lib/qna/questionRoomActions.ts:187: const acctGate = await assertAccountActive(supabaseAcct, user.id);
```

**권고**

getQnaApiSession 또는 createStudentQuestionThread/markQuestionThreadAnsweredForMentor/confirmQuestionThreadForStudent 진입부에 assertAccountActive를 추가해 폼·API 두 경로의 제재를 일치시킨다.

---

#### 14. 🟡 연결노트 수정·삭제의 만료차단 게이트가 폼이 보낸 roomId를 신뢰해 다른 방 id로 우회 가능

| | |
|---|---|
| **심각도** | 중간 (medium) |
| **분류** | authorization |
| **위치** | `lib/qna/questionRoomActions.ts:646` |
| **판정** | 확정(CONFIRMED) · web-domain |

**문제**

updateConnectionNoteAction/deleteConnectionNoteAction는 노트를 id로 불러올 때 author_id 한 컬럼만 조회하고, 그 노트가 실제로 form의 roomId에 속하는지 검증하지 않는다. 반면 '구독 만료 시 편집 차단' 게이트 assertConnectionNoteWriteAllowed(roomId, actor)는 폼이 보낸 roomId의 구독 상태를 본다. 따라서 노트를 만료된 방(roomB)에서 작성한 사용자가 자신이 여전히 활성 구독을 가진 다른 방(roomA)의 id를 폼에 넣으면, 게이트는 roomA(active)를 보고 통과시키고 실제로는 roomB 소속 노트를 수정/삭제한다. RLS(cn_update/cn_delete)는 author_id=auth.uid() + 노트 실제 방의 당사자만 검사하므로 통과되어, '만료 후 연결노트 읽기전용' 정책이 앱 레벨에서 우회된다. (타인 노트 조작은 author_id 제약으로 불가.)

**근거 코드**

```
const noteGate = await assertConnectionNoteWriteAllowed(supabase, roomId, actor); // roomId는 폼 값
...
const { data: noteRow } = await supabase
  .from("connection_notes")
  .select("author_id")            // 노트의 실제 room FK를 조회/검증하지 않음
  .eq("id", noteId)
  .maybeSingle();
```

**권고**

노트 조회 시 room FK(mentor_student_room_id 등)도 함께 select해 form roomId와 일치하는지 확인하거나, assertConnectionNoteWriteAllowed에 노트의 실제 room을 넘겨 구독 상태를 판정한다.

---

#### 15. 🟡 맞춤의뢰 수정요청 RPC가 order_status만 갱신하고 primary status 컬럼을 안 바꿔 '수정 요청' 상태가 앱에서 소실됨

| | |
|---|---|
| **심각도** | 중간 (medium) |
| **분류** | state-machine |
| **위치** | `supabase/sql/088_custom_order_status_transition_rpcs.sql:378` |
| **판정** | 확정(CONFIRMED) · web-domain |

**문제**

주문 테이블은 status/state/order_status/stage를 모두 갖고, 앱의 primaryOrderStatusColumnKey는 status→state→order_status 순으로 첫 비어있지 않은 컬럼을 primary로 읽는다. 주문 insert는 status='pending', order_status='open'을 넣어 primary=status가 된다. custom_order_mentor_deliver는 order_status='delivered'와 함께 primary(status)도 'delivered'로 미러링한다. 그러나 custom_order_student_request_revision은 order_status='revision_requested'만 갱신하고 status는 'delivered'로 방치한다. 그 결과 학생이 수정요청을 해도 normalizedPrimaryOrderStatus는 여전히 'delivered'를 반환한다. 이로 인해 (a) orderStatusLabelForUi/타임라인(orderWorkspaceCurrentStepIndex)은 '수정 요청'(step3) 대신 '납품 대기'(step2)로 오표시되어 수정요청 상태가 UI에서 사라지고, (b) isOrderStatusAllowingStudentAccept('delivered')=true라 재납품 전에도 학생이 그대로 '수락(완료·정산 지급)'을 할 수 있다. 재수정 요청은 RPC의 order_status='delivered' 가드가 막지만 앱 게이트는 통과시켜 raw 에러로 떨어진다.

**근거 코드**

```
update public.custom_request_orders
  set order_status = 'revision_requested'   -- status/state/stage(primary) 미갱신
  where id = p_order_id
    and order_status = 'delivered';
-- 대비: custom_order_mentor_deliver 는
--   status = case when v_primary_col='status' then 'delivered' else status end 로 primary 미러링
```

**권고**

custom_order_student_request_revision도 deliver RPC처럼 primary 컬럼(status/state/stage)을 'revision_requested'로 미러링하거나, 앱 normalizedPrimaryOrderStatus가 delivered↔revision 하위상태는 order_status를 우선 읽도록 정렬을 일치시킨다.

---

#### 16. 🟡 게시판 댓글 테이블(comments)에 관리자 모더레이션 경로가 전혀 없음

| | |
|---|---|
| **심각도** | 중간 (medium) |
| **분류** | moderation-gap |
| **위치** | `lib/admin/communityModerationCore.ts:29` |
| **판정** | 확정(CONFIRMED) · web-comm |

**문제**

게시판 v2 댓글은 public.comments 테이블에 저장된다(insertBoardComment/loadBoardComments). 그러나 모더레이션 코어의 대상 매핑은 community_posts/shortform_posts/community_comments 3개뿐이고, community_comment는 숏폼·레거시용 community_comments 테이블로만 연결된다. 관리자 콘솔(adminCommunityContentQueries.ts:158, community-content 페이지)도 같은 3개 테이블만 다루며, 신고 접수(submitCommunityContentReportAction)는 board/shortform 게시물만 대상이라 댓글 신고 자체가 불가하다. DB 차원에서도 comments에는 작성자 본인용 RLS(comments_update_own/delete_own, 037_p1_community_board_v2.sql:256-265)만 있고 관리자 정책이 없어, 게시판 댓글의 욕설·개인정보 노출을 운영자가 제품 내에서 숨기거나 삭제할 방법이 없다.

**근거 코드**

```
const TARGET_TABLE_BY_TYPE: Record<ModerationTargetType, string> = {
  community_post: "community_posts",
  shortform_post: "shortform_posts",
  community_comment: "community_comments",
};
// 게시판 댓글은 communityBoardMutations.ts:150 supabase.from("comments").insert({...}) 에 저장됨
```

**권고**

ModerationTargetType에 board_comment(→ comments 테이블)를 추가하고 hidden 처리 방식(comments는 status 컬럼이 없고 is_deleted만 있음)을 정의한다. 신고 접수 액션과 관리자 콘텐츠 목록에도 게시판 댓글을 포함하고, 필요 시 comments에 관리자 RLS 정책(또는 service role 경로)을 추가한다.

---

#### 17. 🟡 정지·차단 계정 게이트(assertAccountActive) 누락 — 숏폼 댓글 작성과 멘토 커뮤니티 작성 경로

| | |
|---|---|
| **심각도** | 중간 (medium) |
| **분류** | policy-bypass |
| **위치** | `lib/community/commentActions.ts:53` |
| **판정** | 확정(CONFIRMED) · web-comm |

**문제**

게시판 글 작성(communityBoardActions.ts:59), 게시판 댓글(communityBoardActions.ts:180), 숏폼 업로드(communityShortformActions.ts:46)는 모두 assertAccountActive로 suspended/banned 계정을 차단한다. 그러나 숏폼 댓글 작성 액션 submitCommunityCommentAction(commentActions.ts)과 멘토 커뮤니티 작성 액션 submitMentorCommunityPost(communityComposeActions.ts:24-27, requireRole은 role만 검사하고 account status는 보지 않음)에는 이 게이트가 없다. 관리자가 계정을 정지시켜도 해당 사용자는 숏폼 댓글을 계속 달 수 있고, 정지된 멘토는 /mentor/community/new 경로로 게시판 글·숏폼을 계속 게시할 수 있어 제재가 우회된다.

**근거 코드**

```
// commentActions.ts — 게이트 없이 바로 insert
const supabase = await createClient();
const { data: profile } = await getUserProfileById(supabase, user.id);
...
const r = await insertCommunityComment(supabase, user.id, {...});

// 비교: communityBoardActions.ts:180
const acctGate = await assertAccountActive(supabase, user.id);
```

**권고**

submitCommunityCommentAction과 submitMentorCommunityPost에도 다른 커뮤니티 작성 액션과 동일하게 assertAccountActive 게이트를 추가한다(실패 시 account_blocked 에러 코드로 리다이렉트).

---

#### 18. 🟡 게시글 이미지: 클라이언트가 보낸 existingImageUrls를 검증 없이 저장 — 임의 외부 URL이 모든 조회자에게 <img src>로 렌더링

| | |
|---|---|
| **심각도** | 중간 (medium) |
| **분류** | input-validation |
| **위치** | `lib/community/communityBoardActions.ts:86` |
| **판정** | 확정(CONFIRMED) · web-comm |

**문제**

게시글 작성/수정 액션은 hidden input existingImageUrls의 JSON 배열을 파싱해 비어있지 않은 문자열이면 전부 image_urls로 저장한다. 표시 시 resolveCommunityImageUrl은 community-post-images ref가 아니면 http(s) 원문을 그대로 반환(communityImageStorage.ts:62-63)하고, CommunityBoardDetail.tsx:139에서 <img src={url}>로 렌더링한다. 즉 로그인한 아무 사용자나 업로드 검증(MIME 화이트리스트·5MB 제한·매직바이트 검사)을 전부 우회해 임의 외부 이미지(추적 픽셀로 조회자 IP 수집, 검수 후 내용이 바뀔 수 있는 외부 호스팅 콘텐츠)를 글에 삽입할 수 있다. javascript: 스킴은 http(s) 프리픽스 검사로 차단되지만, 외부 URL 자체는 무제한 통과한다.

**근거 코드**

```
const parsed = JSON.parse(existingImagesRaw) as unknown;
if (Array.isArray(parsed)) {
  imageRefs.push(...parsed.filter((u): u is string => typeof u === "string" && u.trim().length > 0));
}
// communityImageStorage.ts:62-63
const raw = typeof stored === "string" ? stored.trim() : "";
return raw.startsWith("http://") || raw.startsWith("https://") ? raw : null;
```

**권고**

서버 액션에서 existingImageUrls 각 항목이 parseCommunityImageRef로 파싱되는 정상 ref(community-post-images/{본인 userId}/...)인지 검증하고, 그 외 문자열은 버린다. 편집 대상 draft 행에 실제로 저장돼 있던 값과 대조하는 방식이면 더 안전하다. 하위호환용 http 폴백은 자사 Supabase 호스트 도메인으로 한정한다.

---

#### 19. 🟡 숏폼 videoUrl hidden 필드 무검증 저장 + source 폴백 — 임의 외부 URL이 <video src>로 재생

| | |
|---|---|
| **심각도** | 중간 (medium) |
| **분류** | input-validation |
| **위치** | `lib/community/communityShortformActions.ts:68` |
| **판정** | 확정(CONFIRMED) · web-comm |

**문제**

submitShortformUploadAction은 파일이 없으면 formData의 videoUrl 문자열을 검증 없이 그대로 video_url로 저장한다(원래는 임시저장 영상 ref 왕복용 hidden input이지만 클라이언트가 임의 값으로 변조 가능). 표시 시 resolveShortformStorageUrl은 shortform-videos ref가 아니면 http(s) 원문을 그대로 통과시켜(communityShortformStorage.ts:49) CommunityShortformDetailView.tsx:27-28의 <video src>로 재생된다. 업로드 경로의 MIME/500MB/매직바이트 검증이 전부 우회된다. 추가로 pickVideo(communityShortformQueries.ts:50)는 video_url이 없으면 출처 표기용 source 컬럼까지 videoUrl로 폴백해, 멘토 컴포즈(insertMentorShortformPost — video_url 없이 published로 insert) 글에서는 임의 출처 URL이 그대로 영상 src가 된다.

**근거 코드**

```
let videoUrl = String(formData.get("videoUrl") ?? "").trim();
...
if (!videoUrl && status === "published") err(returnPath, "video");

// communityShortformStorage.ts:49
if (!ref) return raw.startsWith("http://") || raw.startsWith("https://") ? raw : null;
// communityShortformQueries.ts:50
for (const k of ["video_url", "videoUrl", "source_url", "source"] as const) {
```

**권고**

videoUrl은 isShortformStoredVideoRef를 통과하고 경로 첫 세그먼트가 본인 userId인 경우(또는 getShortformDraft로 조회한 본인 draft의 기존 값과 일치하는 경우)에만 수용한다. pickVideo의 source/source_url 폴백은 제거하거나 신뢰 도메인 화이트리스트로 제한한다.

---

#### 20. 🟡 108 지급 배치에 항목별 예외 격리 없음 — 비정상 1건이 월 전체 지급을 롤백

| | |
|---|---|
| **심각도** | 중간 (medium) |
| **분류** | reliability/batch-robustness |
| **위치** | `supabase/sql/108_pay_due_payouts_rpc.sql:105` |
| **판정** | 확정(CONFIRMED) · web-sql |

**문제**

pay_due_payouts_for_run의 루프는 채널 primitive를 perform으로 호출할 뿐 BEGIN...EXCEPTION 블록이 없다. 그런데 record_custom_order_escrow_payout(055)은 payment_status가 escrowed/paid가 아니면 'PAYMENT_NOT_ESCROWED'(055:71-73), hold 원장이 없으면 'ESCROW_HOLD_MISSING'(055:86-88)을 raise한다. due_payouts(111/114)의 CR 브랜치는 payment_status='refunded'만 제외하므로(111:51) unpaid·빈 문자열 등 레거시 행이 뷰에 남을 수 있고, 그 1건이 raise되는 순간 트랜잭션 전체가 롤백되어 그 달 모든 멘토의 지급이 실패한다. 멱등키 덕에 이중지급은 없지만, 문제 행이 정리될 때까지 배치가 영구 실패하는 가용성 결함이다.

**근거 코드**

```
if rec.source_type = 'custom_request' then
      perform public.record_custom_order_escrow_payout(rec.source_id);  -- 108:105 (예외 격리 없음)
-- 055:71-73: if v_pay not in ('escrowed', 'paid') then raise exception 'PAYMENT_NOT_ESCROWED';
```

**권고**

루프 본문을 begin ... exception when others then (해당 건 skip 카운트+로그) end 서브블록으로 감싸 항목별로 격리하거나, due_payouts CR 브랜치에 o.payment_status in ('escrowed','paid') 조건을 추가해 055의 raise 전제조건과 뷰를 정합시킨다.

---

#### 21. 🟡 115 계정삭제가 학교인증·학적변경·Storage 객체의 PII를 남김 (익명화 불완전)

| | |
|---|---|
| **심각도** | 중간 (medium) |
| **분류** | privacy/data-retention |
| **위치** | `supabase/sql/115_account_deletion.sql:89` |
| **판정** | 확정(CONFIRMED) · web-sql |

**문제**

anonymize_user_for_deletion은 users와 mentor_profiles 두 테이블만 익명화한다. 그러나 (a) mentor_school_verifications(077:18-33)에는 verified_university_name·verified_department_name·document_storage_ref(재학 증빙 문서)가, (b) mentor_academic_record_change_requests(089:21-24)에는 requested_university_name·change_reason·document_storage_ref가 그대로 남는다. (c) mentor_profiles.student_id_image_url을 null로 만들 뿐 student-id-images 버킷의 학생증 이미지 객체 자체는 삭제하지 않아 고아 PII 파일이 영구 잔존한다(001:242-244 비공개 버킷이지만 service_role·경로 노출 시 접근 가능). 물리삭제 금지·원장 보존(스펙 §1-2)은 타당하나, 이 세 곳은 원장·거래와 무관한 순수 PII다.

**근거 코드**

```
-- 115: users PII 익명화 + mentor_profiles PII 익명화만 수행 (89-103행)
-- 077:24 verified_university_name text, 077:33 document_storage_ref text (미익명화)
-- 089:21 requested_university_name text, 089:23 document_storage_ref text (미익명화)
-- 115:97 student_id_image_url = null  ← URL만 제거, storage.objects 의 실제 파일은 잔존
```

**권고**

RPC에 mentor_school_verifications·mentor_academic_record_change_requests의 이름/문서참조 컬럼 null 처리와, document_storage_ref·학생증 경로의 storage.objects 행 삭제(delete from storage.objects where bucket_id=... and name like p_user_id||'/%')를 추가. auth.users 측 email 제거는 서버(Auth Admin API) 절차로 문서화.

---

#### 22. 🟡 커뮤니티 게시판(paginate 모드)에서 최초 12개 이후의 글에 접근 불가

| | |
|---|---|
| **심각도** | 중간 (medium) |
| **분류** | runtime-bug |
| **위치** | `components/community/CommunityHomeFeed.tsx:187` |
| **판정** | 확정(CONFIRMED) · web-front |

**문제**

/community/board 페이지는 CommunityHomeFeed를 paginate 모드로 렌더링하는데(app/(public)/community/board/page.tsx:23에서 limit 12, :53에서 paginate), paginate 모드에서는 무한스크롤 sentinel(<div ref={sentinelRef}>, 214행)이 아예 렌더링되지 않아 IntersectionObserver 효과(113-124행)가 sentinelRef.current=null로 조기 반환되고 loadMore가 절대 호출되지 않습니다. 카테고리 전환 시 클라이언트 fetch도 limit:"12" 고정(76행)이라, 서버가 nextCursor를 내려줘도 소비하는 코드가 없습니다. 결과적으로 게시판은 카테고리·정렬당 최초 12개 글만 표시 가능하고(데스크탑 10개/페이지 기준 최대 2페이지), 13번째 이후의 과거 글은 어떤 경로로도 열람할 수 없습니다. 페이지네이션 버튼이 있어 전체 열람이 가능한 것처럼 보이는 만큼 명백한 기능 결함입니다.

**근거 코드**

```
// 187행: paginate 분기 — 이 안에서는 sentinel이 렌더링되지 않음
{paginate ? (
  totalPages > 1 ? ( ... 이전/다음 버튼 ... ) : null
) : (
  <>
    <div ref={sentinelRef} className="h-8" aria-hidden />  // 214행: 비-paginate에서만 존재
// 113-124행
useEffect(() => {
  const el = sentinelRef.current;
  if (!el) return;               // paginate 모드에서는 항상 여기서 반환
  const io = new IntersectionObserver(... void loadMore() ...);
```

**권고**

paginate 모드에서 currentPage가 마지막 로드분에 근접하면 cursor 기반 loadMore를 호출해 posts를 이어 붙이거나, 게시판 페이지를 서버 사이드 페이지네이션(searchParams의 page/cursor로 listCommunityBoardPosts 재조회)으로 전환해 nextCursor가 실제로 소비되도록 수정하세요.

---

#### 23. 🟡 랜딩 페이지에 금지 문구 "쌤버쉽" 사용 + 하이라이트 마커(*)가 화면에 그대로 노출

| | |
|---|---|
| **심각도** | 중간 (medium) |
| **분류** | banned-phrase |
| **위치** | `components/landing/PublicGuestLanding.tsx:41` |
| **판정** | 확정(CONFIRMED) · web-front |

**문제**

CLAUDE.md 금지·통일 문구 규칙상 "쌤버쉽"(브랜드 오기)은 사용 금지인데, 공개 랜딩의 프리미엄 플랜 혜택 문구에 그대로 들어가 있습니다. 추가로 렌더링부(193-202행)는 isHighlight 판정에만 별표를 쓰고 텍스트에서 별표를 제거하지 않아, 실제 화면에는 "*쌤버쉽 피드백 리포트 제공*"이 리터럴 별표까지 포함해 노출됩니다. 최다 노출 페이지(비로그인 랜딩)의 카피 결함입니다.

**근거 코드**

```
// 41행
premium: ["질문 무제한", "1:1 질문방 이용", "연결노트 기능", "*쌤버쉽 피드백 리포트 제공*"],
// 193-202행: 별표를 제거하지 않고 b를 그대로 렌더
const isHighlight = b.startsWith("*") && b.endsWith("*");
...
  {b}
```

**권고**

문구를 "쌤버십 피드백 리포트 제공"으로 수정하고, 렌더링 시 isHighlight일 때 b.slice(1, -1)로 별표를 제거해 출력하거나 데이터 구조를 { text, highlight } 형태로 바꾸세요.

---

#### 24. 🟡 폐기된 요금제 표기 "베이직"이 사용자 노출 페이지 3곳에 잔존 (잠금값 위반)

| | |
|---|---|
| **심각도** | 중간 (medium) |
| **분류** | lock-value-violation |
| **위치** | `app/(public)/support/page.tsx:31` |
| **판정** | 확정(CONFIRMED) · web-front |

**문제**

CLAUDE.md 개정 2026-07-12(XV-PRICE)에 따라 표기 "베이직"은 "라이트"로 정본화되었고 정본 카탈로그(lib/subscribe/subscribePlanCatalog.ts:17)도 label: "라이트"입니다. 그러나 고객센터 페이지(support/page.tsx:31, :45 "베이직은 주 4회"), 이용약관(app/(public)/legal/terms/page.tsx:95 "베이직(주 4회)"), 멘토 찾기 헤더(components/mentor/MentorsListBody.tsx:63 "베이직·스탠다드·프리미엄 플랜으로")에 구 표기가 남아 실제 구독 화면(라이트)과 명칭이 불일치합니다. 특히 이용약관은 법적 고지 문서라 표기 불일치의 파급이 큽니다.

**근거 코드**

```
// app/(public)/support/page.tsx:31
에서 관심 있는 멘토를 고른 뒤 구독 플랜을 선택하면 질문방이 열립니다. 플랜은 베이직·스탠다드(추천)·프리미엄으로
// app/(public)/legal/terms/page.tsx:95
<>구독 요금제는 <strong>베이직(주 4회)</strong>, <strong>스탠다드(주 9회, 추천)</strong>, ...
// components/mentor/MentorsListBody.tsx:63
<span className="hidden md:inline">과목·학년·요금으로 멘토를 찾고, 베이직·스탠다드·프리미엄 플랜으로 구독을 시작하세요.</span>
```

**권고**

세 파일의 "베이직"을 "라이트"로 일괄 교체하고, 가급적 SUBSCRIBE_PLAN_CATALOG의 label을 참조해 하드코딩을 없애세요. 약관 문구는 개정 이력 관리가 필요하면 시행일 각주와 함께 갱신하세요.

---

#### 25. 🟡 회원가입 페이지에 개발자용 안내 문구(NEXT_PUBLIC_* 환경 변수 등)가 최종 사용자에게 노출

| | |
|---|---|
| **심각도** | 중간 (medium) |
| **분류** | ui-copy-bug |
| **위치** | `app/signup/page.tsx:944` |
| **판정** | 확정(CONFIRMED) · web-front |

**문제**

실서비스 가입 화면의 약관 동의 블록에 개발자 대상 메모가 그대로 렌더링됩니다: 944행 "약관·개인정보 링크는 `NEXT_PUBLIC_*` 환경 변수로 붙일 수 있어요.", 946-948행 "학생/멘토 가입 흐름에 맞는 색 톤으로 정리했어요.", 1002-1004행은 환경 변수 미설정 시 "문서 URL은 `NEXT_PUBLIC_LEGAL_TERMS_URL` · `NEXT_PUBLIC_LEGAL_PRIVACY_URL`로 연결할 수 있어요."를 사용자에게 표시합니다. 내부 구현 세부(환경 변수명)가 노출되고 카피 품질을 크게 해칩니다.

**근거 코드**

```
// app/signup/page.tsx:943-948
<p className="mt-1.5 text-sm leading-relaxed text-slate-600">
  필수에 동의해야 가입이 완료돼요. 약관·개인정보 링크는 `NEXT_PUBLIC_*` 환경 변수로 붙일 수 있어요.
</p>
<p className={`mt-0.5 text-xs sm:text-sm ${sub}`}>
  {isSky ? "학생 가입 흐름" : "멘토 가입 흐름"}에 맞는 색 톤으로 정리했어요.
</p>
// :1002-1004
{!termsUrl && !privacyUrl && (
  <p className="text-sm text-slate-500">문서 URL은 `NEXT_PUBLIC_LEGAL_TERMS_URL` · `NEXT_PUBLIC_LEGAL_PRIVACY_URL`로 연결할 수 있어요.</p>
)}
```

**권고**

944행과 946-948행의 개발자 메모 문장을 사용자용 카피로 교체·삭제하고, URL 미설정 폴백(1002-1004행)은 /legal/terms·/legal/privacy 내부 라우트로 기본 링크를 제공하도록 바꾸세요.

---

### ⚪ 낮음 (low)

#### 26. ⚪ 게시글 조회수 증가 API에 인증·중복 제어 없음 (조회수 조작)

| | |
|---|---|
| **심각도** | 낮음 (low) |
| **분류** | integrity |
| **위치** | `app/api/community/board/view/route.ts:10` |
| **판정** | 확정(CONFIRMED) · web-auth,web-comm |

**문제**

POST /api/community/board/view 는 로그인 검사가 전혀 없고 postId UUID 형식만 검증한 뒤 increment_community_post_view RPC를 호출한다. 해당 RPC는 SECURITY DEFINER이며 anon·authenticated 모두에게 execute 권한이 부여돼 있어(037_p1_community_board_v2.sql:165), 인증되지 않은 누구든 임의의 유효한 게시글 UUID로 이 엔드포인트를 반복 호출해 조회수를 임의로 부풀릴 수 있다. 서버 측 세션당/시간당 중복 방지가 없고 클라이언트(BoardViewTracker)의 '세션당 1회' 규약에만 의존한다. 금전·데이터 손상은 없으나 커뮤니티 노출 순위 지표 무결성을 훼손한다.

**근거 코드**

```
export async function POST(req: Request) {
  let postId = "";
  try {
    const body = (await req.json()) as { postId?: unknown };
    postId = typeof body?.postId === "string" ? body.postId : "";
  } catch { return NextResponse.json({ ok: false }, { status: 400 }); }
  if (!isCommunityPostUuid(postId)) { return NextResponse.json({ ok: false }, { status: 400 }); }
  const supabase = await createClient();
  await incrementPostView(supabase, postId);
```

**권고**

조회수 증가에 서버 측 최소 방어를 추가한다. 최소한 로그인 사용자로 제한하거나, (뷰어당) 짧은 TTL 중복 억제(예: 사용자/IP+postId 조합의 최근 조회 기록 확인) 또는 rate limit을 적용해 무제한 반복 증가를 막을 것. 지표 신뢰가 중요치 않다면 수용 가능한 트레이드오프이나, 최소한 로그인 요구를 권장.

---

#### 27. ⚪ 결제 성공 후 원장 보정(alreadySucceeded 경로)이 결제 시점 금액이 아닌 '현재' 멘토 플랜가로 차감

| | |
|---|---|
| **심각도** | 낮음 (low) |
| **분류** | amount-integrity |
| **위치** | `lib/subscribe/subscribeCheckoutService.ts:774` |
| **판정** | 유력(PLAUSIBLE) · web-pay |

**문제**

payments가 이미 succeeded인 complete 재호출 분기에서 원장(sub_debit_*)이 없으면 repairMissingSubscriptionCashLedgerIfNeeded(mode: alreadySucceeded)가 planRowHint 없이 호출되어(774~781행), fetchPlansForMentor로 '지금 시점'의 mentor_plans 금액을 조회해 그 금액으로 record_subscription_cash_debit를 실행한다(308~327, 342~386행). 결제 행에는 intent 생성 시점 금액이 amount 컬럼에 저장돼 있으나(574행 base[amtCol] = amount) 보정에는 사용되지 않는다. 결제 성공과 보정 사이에 멘토가 가격을 변경했다면 학생은 결제(성공 표시) 시점에 안내받은 금액과 다른 금액을 차감당한다.

**근거 코드**

```
const ledgerRepair = await repairMissingSubscriptionCashLedgerIfNeeded(supabase, {
  mode: "alreadySucceeded",
  studentId,
  paymentId,
  mentorId,
  planTier,
  subscriptionId: subIdForRoom,
  // planRowHint 없음 → 내부에서 현재 mentor_plans 재조회
});
...
const plans = await fetchPlansForMentor(supabase, mentorId);   // 현재가 조회
const debitCheck = resolveMentorPlanDebitAmount(planRow, planTier, mode);
```

**권고**

보정 차감액은 결제 행의 기록 금액(amtCol 값 × 100) 또는 결제 metadata에 저장된 intent 금액을 우선 사용하고, 플랜 현재가는 결제 기록이 전혀 없을 때의 최후 폴백으로만 쓰도록 순서를 바꾼다.

---

#### 28. ⚪ 이용 개시 판정(hasSubscriptionUsageStartedForPair)이 조회 오류 시 false를 반환해 '이용 개시 전 = 전액 환불' 방향으로 fail-open

| | |
|---|---|
| **심각도** | 낮음 (low) |
| **분류** | refund-policy |
| **위치** | `lib/subscribe/subscriptionUsageStarted.ts:36` |
| **판정** | 확정(CONFIRMED) · web-pay |

**문제**

학원법 별표4 분기에서 usageStarted=false면 전액 환불이 산정된다(subscriptionRefundProration.ts 94~103행). 그런데 판정 함수는 room 조회 오류(30~37행)·thread count 오류(46~52행) 시 모두 false를 반환하므로, DB 일시 오류가 곧 '이용 개시 전' 판정 → 전액 환불 금액으로 refunds 행이 생성된다. 반대로 mentorId가 없는 이상 데이터는 보수적으로 true 처리하는 것(subscriptionCancelActions.ts 205~212행)과 방향이 어긋난다. 관리자 승인 단계가 남아 있어 즉시 손실은 아니지만, 승인 화면에 표시되는 금액 자체가 과대 산정된다.

**근거 코드**

```
if (roomErr) {
  console.warn("[hasSubscriptionUsageStartedForPair] room lookup", { ... });
  return false;   // 오류 → '이용 개시 전' 취급 → 전액 환불 브래킷
}
...
if (threadErr) {
  console.warn("[hasSubscriptionUsageStartedForPair] thread count", { ... });
  return false;
```

**권고**

조회 오류 시에는 보수적으로 true(이용 개시로 간주)를 반환하거나, 오류를 상위로 전파해 환불 신청을 '판정 불가'로 중단시킨다. 판정 결과와 함께 오류 여부를 반환해 호출부가 정책을 선택하게 하는 것도 방법이다.

---

#### 29. ⚪ confirm 금액 대조가 토스 응답 totalAmount 누락 시 클라이언트 amount로 폴백되어 공회전

| | |
|---|---|
| **심각도** | 낮음 (low) |
| **분류** | amount-validation |
| **위치** | `app/api/toss/confirm/route.ts:45` |
| **판정** | 확정(CONFIRMED) · web-pay |

**문제**

confirmedWon = Number(tossData.totalAmount ?? amount)로 계산하므로, 토스 응답에 totalAmount가 없으면 클라이언트가 보낸 amount가 그대로 confirmedWon이 되어 다음 줄의 'confirmedWon !== amount' 대조가 항상 통과한다. 이후 isAllowedChargePayKrw와 토스 confirm 자체의 금액 검증이 있어 실제 악용 여지는 좁지만, 서버측 금액 재검증이라는 이 코드의 목적 자체가 무력화되는 경로다(웹훅 라우트는 같은 상황에서 payment_amount_missing으로 거절하는 것과 대비된다).

**근거 코드**

```
const tossData = (await tossRes.json()) as { method?: string; totalAmount?: number };
const confirmedWon = Number(tossData.totalAmount ?? amount);   // totalAmount 없으면 클라이언트 값 신뢰
if (!Number.isFinite(confirmedWon) || confirmedWon !== amount) { ... }
```

**권고**

웹훅 라우트와 동일하게 totalAmount가 없거나 0 이하면 그대로 실패 처리(예: payment_amount_missing 400)하고, 클라이언트 amount로의 폴백을 제거한다.

---

#### 30. ⚪ past_due(유예) 구독에서 질문방·연결노트·주간한도 접근이 부당하게 차단됨 (grace 정책과 정합성 붕괴)

| | |
|---|---|
| **심각도** | 낮음 (low) |
| **분류** | correctness |
| **위치** | `lib/subscribe/subscribeCheckoutService.ts:44` |
| **판정** | 확정(CONFIRMED) · web-domain |

**문제**

구독 갱신 결제 실패 시 process_subscription_renewal(068)은 구독을 status='past_due' + grace_until=now+2일로 두고, 학생에게 '기한까지 충전하면 구독이 유지됩니다'라고 안내한다. 실제로 코드베이스 대다수(studentSubscriptionManagement.ts:247 canUsePeriod, mentorActivityService.ts:25, subscriptionCancelActions.ts:49, 계정삭제 preconditions 등)는 past_due를 'active'와 동급의 유효 구독으로 취급한다. 그러나 질문방 접근 판정의 단일 소스인 isRowSubscriptionActive()는 'active' 하나만 인정하고, 이를 쓰는 findActiveSubscriptionForPair가 assertThreadCreationSubscriptionAllowed(questionThreadSubscriptionGuard.ts:29)·assertStudentCanCreateThread·연결노트 게이트(connectionNoteSubscriptionGuard.ts:51 status='active'만)·get_weekly_question_usage(098, status='active'만)에서 모두 사용된다. 결과적으로 2일 유예 기간 동안 유료 학생은 새 질문 생성이 막히고(무료권으로 강등→대개 소진), 멘토는 답변이 막히며, 연결노트는 읽기전용이 되고, 주간 한도는 limit=0으로 표시된다. 안내와 정반대로 유예 중 핵심 유료기능이 즉시 잠긴다.

**근거 코드**

```
function isRowSubscriptionActive(row: Row): boolean {
  const st = String(
    row.status ?? row.state ?? row.subscription_status ?? ""
  )
    .toLowerCase()
    .trim();
  return st === "active";
}
// 대비: lib/subscribe/studentSubscriptionManagement.ts:247
//   const canUsePeriod = status === "active" || status === "past_due";
```

**권고**

질문방/연결노트/주간한도 게이트가 참조하는 활성 판정에 past_due(그리고 grace_until 미경과 조건)를 포함시키거나, findActiveSubscriptionForPair에 '유예 포함' 옵션을 두어 다른 모듈(canUsePeriod 등)과 동일한 유효 구독 집합을 쓰도록 통일한다. get_weekly_question_usage(098)의 status='active' 필터도 past_due 포함으로 맞춘다.

---

#### 31. ⚪ 무료 질문권이 스레드 생성 실패 시에도 소진됨 (폼 경로에서 기록이 생성보다 앞섬)

| | |
|---|---|
| **심각도** | 낮음 (low) |
| **분류** | correctness |
| **위치** | `lib/qna/questionThreadSubscriptionGuard.ts:32` |
| **판정** | 확정(CONFIRMED) · web-domain |

**문제**

폼 경로 createQuestionThreadAction은 무활성구독·신규스레드일 때 assertThreadCreationSubscriptionAllowed 안에서 assertFreeQuestionAllowedAndRecord로 free_question_usage 행을 먼저 insert(=차감)한 뒤, 별도로 createQuestionThread를 호출한다. 이후 createQuestionThread가 실패하면(스키마/DB 오류 등) 무료 질문권(멘토당 3회·총 7회·가입7일 만료)은 이미 차감되었는데 스레드는 생성되지 않아 학생이 무료권 1회를 손실한다. API 경로(createStudentQuestionThread)는 반대로 스레드 생성 성공 후 recordFreeQuestionUsage를 호출해 이 문제가 없다. 두 경로의 차감 순서가 불일치한다.

**근거 코드**

```
if (actor === "student" && options?.isNewThread) {
  const free = await assertFreeQuestionAllowedAndRecord(supabase, studentId, mentorId); // 여기서 이미 차감
  if (!free.ok) { return { ok: false, userMessage: free.userMessage }; }
  return { ok: true, usedFreeQuota: true };
}
// 이후 createQuestionThreadAction: const result = await createQuestionThread(...) 실패해도 롤백 없음
```

**권고**

폼 경로도 API 경로처럼 스레드 생성 성공 후에 무료권을 기록하도록 순서를 바꾸거나, createQuestionThread 실패 시 방금 insert한 free_question_usage 행을 보상 삭제한다.

---

#### 32. ⚪ 콘텐츠 신고 무제한 중복 접수 가능 — 동일 사용자·동일 대상 dedup/رate limit 부재

| | |
|---|---|
| **심각도** | 낮음 (low) |
| **분류** | abuse-resistance |
| **위치** | `lib/community/communityReportActions.ts:68` |
| **판정** | 확정(CONFIRMED) · web-comm |

**문제**

submitCommunityContentReportAction은 (reporter_id, target_type, target_id)에 대한 중복 검사나 속도 제한 없이 content_reports에 insert한다. DB에도 유니크 제약이 없다(032_p1_admin_content_reports.sql). 같은 사용자가 같은 게시물에 대해 폼 반복 제출만으로 신고 행을 무한히 쌓아 관리자 검수 큐(/admin/reports, pending 카운트)를 오염시킬 수 있고, 대상 게시물 존재 여부도 확인하지 않아 임의 UUID로 유령 신고를 만들 수 있다.

**근거 코드**

```
const { error } = await supabase.from(TABLE).insert({
  reporter_id: user.id,
  target_type,
  target_id: targetId,
  reason,
  description: descriptionOut,
});
```

**권고**

미해결 상태(pending/reviewing) 기준 (reporter_id, target_type, target_id) 부분 유니크 인덱스를 추가하고, 액션에서 기존 미해결 신고가 있으면 reportOk로 멱등 처리한다. 대상 게시물 존재 확인도 insert 전에 수행한다.

---

#### 33. ⚪ returnPath 리다이렉트 검증 불일치 — 절대 URL·'//host' 통과로 오픈 리다이렉트 여지

| | |
|---|---|
| **심각도** | 낮음 (low) |
| **분류** | input-validation |
| **위치** | `lib/community/communityBoardActions.ts:157` |
| **판정** | 확정(CONFIRMED) · web-comm |

**문제**

toggleCommunityPostReactionAction은 postId·type이 유효하면 성공 경로에서 returnPath를 아무 검증 없이 redirect(returnPath)로 사용한다(https://evil.example 같은 절대 URL 그대로 통과; startsWith('/') 검사는 invalid 분기(148행)에만 있음). submitBoardCommentAction(169행)과 submitCommunityCommentAction·submitCommunityContentReportAction은 startsWith('/')만 검사해 protocol-relative '//evil.example'이 통과한다. 같은 저장소의 userBlocksActions.safeReturnTo(s.startsWith('/') && !s.startsWith('//'))가 이미 올바른 기준을 보여주는데 커뮤니티 액션들은 이를 따르지 않는다. Server Action의 same-origin 검사로 외부 사이트발 악용은 제한되지만 방어 기준이 파일마다 달라 위험하다.

**근거 코드**

```
// 성공 경로 — 검증 없음 (toggleCommunityPostReactionAction)
revalidatePath(returnPath);
...
redirect(returnPath);

// 비교: userBlocksActions.ts:18
return s.startsWith("/") && !s.startsWith("//") ? s : "/community";
```

**권고**

userBlocksActions의 safeReturnTo와 동일한 검증(선두 '/', '//' 금지)을 공용 헬퍼로 추출해 커뮤니티 액션 전체(toggle/comment/report/delete)의 returnPath 처리에 일괄 적용한다.

---

#### 34. ⚪ 숏폼 category를 검증 없는 타입 단언으로 저장 — 임의 문자열이 category 컬럼에 유입

| | |
|---|---|
| **심각도** | 낮음 (low) |
| **분류** | input-validation |
| **위치** | `lib/community/communityShortformActions.ts:55` |
| **판정** | 확정(CONFIRMED) · web-comm |

**문제**

submitShortformUploadAction은 formData의 category를 SHORTFORM_CATEGORIES 멤버십 검사 없이 as ShortformCategorySlug로 단언해 insertShortformPost에 전달하고, DB에도 category CHECK 제약이 없어 임의 문자열이 저장된다. 게시판 쪽은 normalizeCommunityPostCategory로 정규화하는 것과 대조적이다. 잘못된 category의 글은 카테고리 탭(eq 필터)에서 사라져 '전체'에서만 보이고, 카테고리 통계·인덱스(idx_sf_category_created)를 오염시킨다.

**근거 코드**

```
const category = String(formData.get("category") ?? "study") as ShortformCategorySlug;
// communityShortformMutations.ts:32
category: input.category === "all" ? "study" : input.category,
```

**권고**

communityComposeActions.ts:53-54처럼 SHORTFORM_CATEGORIES.find로 화이트리스트 검증 후 불일치 시 'study'로 폴백하는 정규화를 이 액션에도 적용한다.

---

#### 35. ⚪ cash_ledger append-only가 'RLS 무정책'에만 의존 — 106식 UPDATE/DELETE 차단 트리거 부재

| | |
|---|---|
| **심각도** | 낮음 (low) |
| **분류** | defense-in-depth/append-only |
| **위치** | `supabase/sql/004_p0_cash_disputes_admin_draft.sql:170` |
| **판정** | 확정(CONFIRMED) · web-sql |

**문제**

cash_ledger는 SELECT 정책(cled_select)만 있고 쓰기 정책이 없어 authenticated/anon의 직접 변조는 현재 막혀 있다. 그러나 이는 '정책 부재'에 기댄 소극적 방어로, 같은 저장소의 payout_run_items(106:66-84)가 명시적 BEFORE UPDATE/DELETE 차단 트리거(payout_run_items_block_mutation)로 불변성을 강제하는 것과 대비된다. 원장은 향후 실수로 넓은 정책·GRANT가 추가되거나 SECURITY DEFINER 함수가 오작성되면 곧바로 수정·삭제가 가능해지는 반면, 차단 트리거가 있으면 service_role 경유 실수까지 한 겹 더 막는다. CLAUDE.md가 cash_ledger를 append-only로 잠금 명시한 만큼 방어 계층 불일치다.

**근거 코드**

```
alter table public.cash_ledger enable row level security;
create policy "cled_select" on public.cash_ledger
  for select to authenticated
  using ( user_id = (select auth.uid()) );
-- insert / update / delete: policy 없음 = RLS 기본 거부 ... (트리거 차단은 없음; 대비: 106:76-84 trg_pri_no_update/trg_pri_no_delete)
```

**권고**

106의 payout_run_items_block_mutation 패턴을 재사용해 cash_ledger에 BEFORE UPDATE/DELETE 차단 트리거를 추가한다(원장 수정이 정말 필요한 예외는 보정 라인 INSERT로 처리하는 관례를 강제).

---

#### 36. ⚪ 108 cutoff 계산이 무타임존 timestamp 연산 — DB 타임존(UTC) 기준 전월말로 KST 명세와 9시간 오차

| | |
|---|---|
| **심각도** | 낮음 (low) |
| **분류** | correctness/timezone |
| **위치** | `supabase/sql/108_pay_due_payouts_rpc.sql:49` |
| **판정** | 확정(CONFIRMED) · web-sql |

**문제**

v_cutoff는 date_trunc('month', p_run_date::timestamp) - interval '1 second'로 계산해 timestamptz인 completion_ts와 비교한다. p_run_date::timestamp는 무타임존 값이고 비교 시 세션 TimeZone(Supabase 기본 UTC)으로 해석되므로, 주석의 '전월 말 23:59:59'는 실제로는 UTC 월말 = KST 기준 당월 1일 08:59:59가 된다. KST 1일 00:00~08:59에 완료된 건이 전월 지급분으로 당겨지는 등 월 귀속이 명세와 어긋난다(이중지급은 없고 귀속 시점 오차만 발생). 111/114 뷰의 now() 방어와도 기준이 미세하게 어긋난다.

**근거 코드**

```
-- 전월 말 23:59:59 — 이 시점까지 '완료된' 건만 지급 대상(미래 accruing 배제).
  v_cutoff timestamptz := date_trunc('month', p_run_date::timestamp) - interval '1 second';
```

**권고**

명세가 KST라면 date_trunc('month', p_run_date::timestamptz at time zone 'Asia/Seoul') at time zone 'Asia/Seoul' - interval '1 second' 형태로 명시 타임존 연산으로 교체하고, 의도한 기준(UTC/KST)을 주석·payout_runs.cutoff_end에 일관 기록.

---

#### 37. ⚪ formatCashKrw 미사용 수작업 캐시 포맷이 광범위 — "84,900캐시"(무공백)와 "84,900 캐시"(공백) 표기 혼재

| | |
|---|---|
| **심각도** | 낮음 (low) |
| **분류** | format-inconsistency |
| **위치** | `components/subscribe/SubscribeCheckoutClient.tsx:21` |
| **판정** | 확정(CONFIRMED) · web-front |

**문제**

코딩 규칙 7은 캐시 표기를 formatCashKrw(@/lib/utils/formatDisplay, 출력 "N 캐시" — 공백 포함)로 통일하도록 하지만, 학생 결제 동선 다수가 로컬 헬퍼로 "N캐시"(무공백)를 직접 조립합니다: SubscribeCheckoutClient.tsx:21-22(fmtCash), app/(student)/wallet/charge/success/page.tsx:21, app/(student)/custom-request/orders/[orderId]/complete/page.tsx:84, components/cash/WalletChargeSidebar.tsx:21, components/cash/WalletChargePageView.tsx:47-59, components/cash/CashChargeWidget.tsx 다수, lib/individualQuestion/individualQuestionFormat.ts:5, lib/cash/ledgerRowDisplay.ts:60·101. 반면 멘토 정산 화면은 formatCashKrw("N 캐시")와 MentorRevenueChart.tsx:14의 "N 캐시"를 써서 같은 앱 안에서 금액 단위 표기가 두 가지로 갈립니다.

**근거 코드**

```
// components/subscribe/SubscribeCheckoutClient.tsx:21-23
function fmtCash(n: number): string {
  return `${n.toLocaleString("ko-KR")}캐시`;
}
// lib/utils/formatDisplay.ts (정본): return `${n.toLocaleString("ko-KR")} ${unit}`;  → "84,900 캐시"
// components/mentor/mypage/MentorRevenueChart.tsx:14
return unit === "원" ? `${v.toLocaleString("ko-KR")}원` : `${v.toLocaleString("ko-KR")} 캐시`;
```

**권고**

공백 유무 중 한 가지를 formatCashKrw의 정본 출력으로 확정한 뒤, 로컬 fmtCash류를 모두 제거하고 formatCashKrw 호출로 치환하세요. ledgerRowDisplay·individualQuestionFormat처럼 cents 입력인 곳은 minorUnitsToDisplayCash + formatCashKrw 조합으로 통일할 수 있습니다.

---

#### 38. ⚪ 정적 값 인라인 style 다수 — "Tailwind only · 인라인 style 금지" 규칙 위반

| | |
|---|---|
| **심각도** | 낮음 (low) |
| **분류** | rule-violation |
| **위치** | `components/customRequest/CustomRequestPostListTable.tsx:24` |
| **판정** | 확정(CONFIRMED) · web-front |

**문제**

런타임 계산값이 아닌 완전 정적 스타일이 인라인 style로 작성된 곳이 여럿입니다: CustomRequestPostListTable.tsx:24(fontSize/marginTop), app/(public)/custom-request/page.tsx:63·75·81·95(background "#f3f6fc", padding 상수), CustomRequestTrustBanner.tsx:4·9(flex), CustomRequestHero.tsx:129(marginBottom: 0), 그리고 community/mentor 계열 10여 개 파일의 style={{ backgroundColor: PRIMARY }}(PRIMARY는 "#2563EB" 상수라 bg-[#2563EB]로 대체 가능). 진행률 막대의 동적 width처럼 불가피한 경우와 달리 이들은 모두 Tailwind arbitrary 값으로 치환 가능한 정적 값입니다. CommunityHomeFeed.tsx:235-239와 WalletLedgerPageBody.tsx:388-392의 <style jsx global> 역시 [&::-webkit-scrollbar]:hidden 유틸리티로 대체 가능합니다.

**근거 코드**

```
// components/customRequest/CustomRequestPostListTable.tsx:24
<h2 style={{ fontSize: 24, marginTop: 0 }}>최근 등록된 맞춤의뢰</h2>
// app/(public)/custom-request/page.tsx:75
<section className="band" style={{ background: "#f3f6fc", paddingBottom: 40 }}>
// components/community/CommunityHomeFeed.tsx:227 (PRIMARY = "#2563EB" 상수)
style={{ backgroundColor: PRIMARY }}
```

**권고**

정적 인라인 style을 Tailwind 클래스(text-2xl, bg-[#f3f6fc], pb-10, bg-[#2563EB] 등)로 치환하고, style jsx global의 스크롤바 숨김은 [&::-webkit-scrollbar]:hidden arbitrary variant로 옮기세요. 동적 width/색상만 인라인 허용 예외로 남기세요.

---

#### 39. ⚪ AppToast의 useEffect 의존성이 [props]라 부모 리렌더마다 자동 닫힘 타이머가 리셋됨

| | |
|---|---|
| **심각도** | 낮음 (low) |
| **분류** | useEffect-bug |
| **위치** | `components/ui/AppToast.tsx:13` |
| **판정** | 확정(CONFIRMED) · web-front |

**문제**

AppToast는 앱 전역 피드백 정본 컴포넌트인데, effect 의존성이 props 객체 자체입니다. props는 매 렌더 새 객체이고 onDismiss도 사용처에서 인라인 화살표 함수(예: CommunityBoardComposeForm.tsx:107 onDismiss={() => setToast(null)})로 전달되므로, 부모가 리렌더될 때마다(예: 토스트가 떠 있는 동안 폼 입력으로 키 입력마다 리렌더) 기존 타이머가 정리되고 전체 duration으로 다시 시작됩니다. 사용자가 계속 타이핑하면 토스트가 2.8초를 훨씬 넘겨 계속 떠 있게 됩니다.

**근거 코드**

```
useEffect(() => {
  const t = window.setTimeout(() => props.onDismiss(), props.durationMs ?? 2800);
  return () => window.clearTimeout(t);
}, [props]);
```

**권고**

의존성을 [props.durationMs]로 좁히고 onDismiss는 ref에 담아 호출하거나(onDismissRef.current()), 최소한 [props.durationMs, props.message]로 제한해 부모 리렌더에 타이머가 흔들리지 않게 하세요.

---

#### 40. ⚪ 상호작용 없는 순수 표시 컴포넌트 다수에 'use client' 지정 — 서버 컴포넌트 이점 상실

| | |
|---|---|
| **심각도** | 낮음 (low) |
| **분류** | rule-violation |
| **위치** | `components/notices/PublicNoticesList.tsx:1` |
| **판정** | 확정(CONFIRMED) · web-front |

**문제**

코딩 규칙 2('use client'는 상호작용만)에 반해, 훅·이벤트 핸들러가 전혀 없는 표시 전용 컴포넌트들이 클라이언트 컴포넌트로 선언되어 있습니다. 자동 검사로 확인된 예: PublicNoticesList(네이티브 <details>만 사용), QuestionThreadWorkflowBadge, AdminDataTable, AdminConsoleTopBar, AdminNoticesFormSkeleton, MentorPayoutsKpiCards/SettlementTable/PerformanceTable, CustomRequest 계열 뷰 다수 등 약 25개 파일. 이들은 서버 렌더 가능한데도 클라이언트 번들에 포함되어 JS 페이로드와 하이드레이션 비용을 늘립니다(recharts 사용 차트 컴포넌트는 정당한 예외).

**근거 코드**

```
// components/notices/PublicNoticesList.tsx:1-12 — 훅/핸들러 없음
"use client";

import type { PublicNoticeItem } from "@/lib/notices/publicNoticesQueries";
...
export function PublicNoticesList(props: { items: PublicNoticeItem[] }) {
  if (!props.items.length) return null;
```

**권고**

recharts 등 브라우저 전용 라이브러리를 쓰지 않고 훅·이벤트 핸들러가 없는 컴포넌트에서 'use client' 지시문을 제거해 서버 컴포넌트로 되돌리세요. 클라이언트 부모에서 import되는 경우엔 지시문이 없어도 자동으로 클라이언트 번들에 포함되므로 제거해도 무방합니다.

---

#### 41. ⚪ 브랜드 Primary 정본 충돌 — CLAUDE.md는 #1A56DB(변경 금지), 코드·디자인 토큰은 #2563EB

| | |
|---|---|
| **심각도** | 낮음 (low) |
| **분류** | doc-code-mismatch |
| **위치** | `styles/design-system-tokens.css:33` |
| **판정** | 확정(CONFIRMED) · web-front |

**문제**

CLAUDE.md 브랜드 컬러 표는 Primary #1A56DB를 '변경 금지'로 잠갔지만, 실제 코드는 #2563EB를 448곳에서 PRIMARY로 사용하고 #1A56DB는 7곳(구 페이지 잔존)뿐입니다. ssambership_house_style.md:17은 #2563EB를 플랫폼 기본색으로, 디자인 토큰(--brand)도 #2563EB로 정의해 두 정본 문서가 서로 충돌합니다. 코드가 house style을 따르는 것은 일관적이므로 코드 결함이라기보다 정본 문서 불일치이며, 남은 #1A56DB 7곳(app/(student)/account/delete/page.tsx:72·88, app/(public)/about/page.tsx:60·112, app/(public)/goodbye/page.tsx:17, components/support/StudentSupportTabs.tsx:28 등)은 화면 간 미세한 색 불일치를 만듭니다.

**근거 코드**

```
/* styles/design-system-tokens.css:33 */
--brand: #2563EB;
/* ssambership_house_style.md:17 */
- **플랫폼/기본 (Blue) `#2563EB`** — 브랜드 + 공개 사이트 + 학생 공간 공유.
/* CLAUDE.md 브랜드 컬러(변경 금지): Primary #1A56DB */
```

**권고**

CLAUDE.md 브랜드 컬러 표를 house style(#2563EB 기준)로 개정하거나 반대로 코드를 #1A56DB로 되돌릴지 정본을 하나로 확정하고, 확정 후 잔존 #1A56DB 7곳을 정본 색으로 통일하세요.

---

## 검토 방법과 한계

- **범위**: 이 보고서는 `ssambership_web` 저장소를 대상으로 한 정적 코드 리뷰입니다. 실제 운영 DB에 어떤 마이그레이션이 적용됐는지, 런타임 동작이 어떤지는 코드만으로 단정할 수 없으므로, 각 발견은 배포 전 실환경에서 재현·확인이 필요합니다.
- **DB 관련 발견**: 웹 저장소의 SQL 마이그레이션은 CLI 이력 없이 수동 번호제로 관리되어, 특정 SQL이 프로덕션에 적용됐는지는 파일 주석·`INDEX.md`에 의존합니다. RLS/RPC 관련 발견은 "해당 SQL이 라이브"라는 전제에서의 결함이며, 후불 정산(108~114) 등 DRAFT 표기 항목은 아직 미적용 초안일 수 있음을 심각도에 반영했습니다.
- **검증 방식**: 각 발견은 리뷰 에이전트가 파일을 정독해 1차 도출한 뒤, 별도 검증 에이전트가 인용 파일·줄을 다시 열어 재현성/악용영향/설계의도 3개 렌즈로 적대적으로 확인했습니다. 다수결로 REFUTED된 항목(예: 숏폼 썸네일 업로드 검증, signOut 예외 정리)은 이 목록에서 제외했습니다.

## 부록 A: 정적 분석 결과

이 저장소에서 직접 실행한 결과입니다.

### TypeScript (`tsc --noEmit`, strict)

에러 **0건** — 통과.

### ESLint (`eslint .`)

총 **118건** (에러 44 · 경고 74). 규칙별 분포:

| 규칙 | 유형 | 건수 | 메모 |
|---|---|---|---|
| React Compiler: effect 내 동기 setState (cascading renders) | error | 24 | 초기화 effect가 렌더 직후 setState를 동기 호출 — 파생 상태는 렌더 중 계산 또는 `useMemo`로 이전 권장 |
| `@typescript-eslint/no-explicit-any` | error | 14 | 결제·구독 경로의 런타임 스키마 탐사(`Record<string,unknown>`) 패턴과 맞물린 타입 회피 |
| React Compiler: 렌더 중 `Date.now()` 호출(impure) | error | 1 | `components/cash/CashChargeWidget.tsx:49` — orderId 생성이 렌더 본문에 있음 |
| `prefer-const` | error | 2 | |
| `@next/next/no-html-link-for-pages` | error | 1 | `<a>` 대신 `<Link>` |
| `@typescript-eslint/no-unused-vars` | warning | 42 | |
| `no-restricted-imports` (deprecated `@/components/qna/FormSubmitButton`) | warning | 23 | 구경로 심 — 신경로로 일괄 치환 필요 |
| `react-hooks/exhaustive-deps` | warning | 5 | `WalletLedgerPageBody`, `QuestionRoomWeeklyUsageBar` 등 — 본문 발견 14·15번과 연관 |
| `@next/next/no-img-element` | warning | 2 | `<img>` → `next/image` |

`no-explicit-any` 14건과 effect 내 setState 24건은 위 "구조적 리스크"의 런타임 스키마 탐사 패턴·보상 로직 분산과 뿌리가 같습니다. deprecated 임포트 23건은 기계적 치환으로 즉시 해소 가능합니다.
