# 08. 결제·회계 (신뢰 인프라 A — 캐시·충전·원장) — 존재 목적 리포트

> 대상 라우트 12개 · 요소 행 70개 · 근거: 코드 실측 + 기획 정본(CLAUDE.md "1캐시=1원 · balance_cents ÷ 100", 충전 패키지 잠금값)

이 도메인의 존재 목적은 단 하나다: **외부 돈(카드)이 플랫폼 안으로 들어오는 유일한 관문을 좁고 검증 가능하게 유지하는 것.**
충전만 Toss PG 실연동(orderId=`cash-<userId>-<ts>`)이고, 이후 모든 소비(구독/개별질문/맞춤의뢰)는 내부 캐시 이동(service_role RPC)이다. `cash_ledger`는 append-only 원장으로 모든 흐름의 단일 진실이 되고, 이 파일의 모든 화면은 그 원장을 "넣는 문(충전)"과 "읽는 창(사용내역)"으로 양분된다.

## 커버 라우트 (검증용 전수 목록)

route-inventory.txt grep(`wallet|cash|toss|payments`) 전수 — 12개 파일.

| # | 라우트 | 파일 | 성격 |
|---|--------|------|------|
| 1 | `/wallet/charge` | `app/(student)/wallet/charge/page.tsx` | 캐시 충전 본체 (정식 진입) |
| 2 | `/wallet/charge` loading | `app/(student)/wallet/charge/loading.tsx` | Skeleton |
| 3 | `/wallet/charge/success` | `app/(student)/wallet/charge/success/page.tsx` | Toss 리다이렉트 수신 → confirm 호출 → 완료 안내 |
| 4 | `/wallet/charge/fail` | `app/(student)/wallet/charge/fail/page.tsx` | Toss 실패 리다이렉트 수신 → 재시도 안내 |
| 5 | `/wallet/ledger` | `app/(student)/wallet/ledger/page.tsx` | 캐시 사용내역(원장 읽기 전용 창) |
| 6 | `/wallet/ledger` loading | `app/(student)/wallet/ledger/loading.tsx` | Skeleton |
| 7 | `/wallet` | `app/(student)/wallet/page.tsx` | 레거시 → `redirect("/wallet/charge")` (W20/21 정리) |
| 8 | `/cash-history` | `app/(student)/cash-history/page.tsx` | 레거시 → `redirect("/wallet/ledger")` (W20/21 정리) |
| 9 | `/cash` | `app/(public)/cash/page.tsx` | 학생 캐시결제 공개 진입 — `/wallet/charge`와 동일 뷰(`WalletChargePageView`) 재사용 |
| 10 | `/payments` | `app/(public)/payments/page.tsx` | 레거시 → `redirect("/cash")` ("결제 랜딩 흡수: 캐시 충전은 /cash 단일 진입") |
| 11 | `POST /api/toss/confirm` | `app/api/toss/confirm/route.ts` | 결제 승인 + 원장 기록 (동기 경로) |
| 12 | `POST /api/toss/webhook` | `app/api/toss/webhook/route.ts` | 결제 상태 웹훅 백스톱 (비동기 복구 경로) |

접근 제어: `/wallet/charge`·`/cash`는 `requireWalletChargeAccess()`(routeGuard.ts:62) — **학생+멘토 모두 통과**(멘토 캐시충전 네비 잠금값 이행), admin·기타 role은 각자 홈으로 redirect. `/cash`는 추가로 멘토를 `/mentor/mypage`로 보내고 비로그인은 `/login/student?next=/cash`. `/wallet/ledger`는 멘토를 `/wallet/charge`로 밀어냄 — 멘토는 충전만 가능, 소비(원장 열람 포함) 화면 차단.

## 화면별 상세

### /wallet/charge · /cash — 캐시 충전 (`student-wallet-charge-form`)

서버: `loadWalletChargePageData()`(walletRouteData.ts) — 잔액 + DB 패키지 + 원장 80행 + 최근 결제 5행을 `Promise.all` 병렬 로드. 뷰 = `WalletChargePageView`(91줄) → `CashChargeWidget`(223줄, Toss SDK) + `WalletChargeRecentSummary` + `WalletChargeRightSidebar`.

| 요소 (표시 라벨) | 종류 | 소스 | 연결 동작 | 추론한 존재 목적 |
|------------------|------|------|-----------|------------------|
| "캐시결제" 배지 | pill 배지 | WalletChargePageView.tsx:29 | — | 학생 네비 잠금값 "캐시결제" 항목과 현재 위치를 1:1로 못박는 앵커 |
| "캐시를 충전하고 결제 준비를 마무리하세요" | h1 | 동 파일:33 | — | 이 화면이 소비가 아닌 "준비(충전)" 단계임을 선언 — 소비는 구독/의뢰 화면의 몫 |
| "{displayName}님, 충전 금액과 결제 수단을 확인한 뒤 캐시를 충전할 수 있어요." | 부제 (md+ 전용, 모바일은 "충전 금액과 결제 수단을 확인하세요." 축약) | 동 파일:37–42 | displayName = full_name → nickname → email 앞부분 → "회원" 폴백 | 돈이 오가는 화면에서 "내 계정이 맞다"는 심리적 확인 |
| "현재 잔액 / 사용 가능 / 보너스 / 소멸 예정" 4칸 스트립 | 요약 스트립 (`.map` 아님, 4칸 하드코딩) | 동 파일:45–62 · `parseWalletBalanceBreakdown()` | 각 칸 "N캐시" 표시 | 충전 전 기준점 제시. bonus/expiring은 지갑 row의 `bonus_cents`·`expiring_cents` 등 후보 컬럼 탐색 — 컬럼 부재 시 0 고정 (추정: 현 스키마는 `balance_cents`만 실재, 보너스/소멸은 표시 틀 선행 구축) |
| "잔액 일부를 불러오지 못했습니다. 충전은 가능하지만, 사용 내역을 함께 확인해 주세요." | 경고 배너 | 동 파일:63–67 | 조건: `data.balance.error` truthy | 잔액 조회 실패가 충전을 막지 않게 분리 — 돈 넣는 문은 항상 열어둠 |
| `?error=` 배너 | 오류 배너 | 동 파일:76–80 · `mapDataErrorMessage()` | 조건: URL `?error=` 존재 | success 페이지·서버 액션이 redirect로 되던진 실패 사유를 충전 화면에서 소화 |
| "충전 금액 선택" + "필요한 금액을 선택하면 보너스와 예상 잔액을 바로 확인할 수 있어요." | 섹션 헤딩 | CashChargeWidget.tsx:186–188 | — | 패키지 선택이 1단계임을 구조화 |
| 패키지 카드 "30,000원 → 30,000캐시" | 선택 카드 버튼 `.map` 1행 — **5개 반복** (30,000 / 60,000 / 120,000 / 200,000→220,000 / 300,000→340,000) | 동 파일:190–228 · `CASH_CHARGE_PACKAGES`(chargePackages.ts, "보고서 잠금 충전 패키지" 주석) | 클릭 시 `selectedPayKrw` 갱신 + 오류/안내 초기화 | 자유 금액 입력을 원천 봉쇄한 화이트리스트 — 서버 `isAllowedChargePayKrw()`와 동일 상수를 공유해 "화면에 보이는 금액만 승인 가능"을 성립 |
| "보너스 +20,000캐시 (10%)" | 카드 내 보너스 라벨 | 동 파일:219–224 | 조건: `pkg.bonusKrw > 0` (200,000·300,000원 2종만) | 고액 충전 유도 — 결제금액≠지급캐시를 카드에서부터 정직하게 분리 표기 |
| 선택 체크 아이콘 (Check) | 상태 아이콘 | 동 파일:208–212 | 조건: `selectedPayKrw === pkg.payKrw` | 단일 선택 상태의 시각 확정 |
| "결제 수단" — "신용/체크카드" | 선택 버튼 `.map` 1행 — 렌더는 **1개**(`.filter((m) => m.ready)` 적용) | 동 파일:235–267 · `payMethods` 배열 | 클릭 시 `paymentMethod` 설정 | 사실 표기: 코드에는 "간편결제"·"무통장입금"이 `ready: false`로 정의되고 "준비 중" 배지 렌더 분기까지 있으나, `filter(ready)` 때문에 **화면에는 카드만 노출**됨 — 카드 단일 활성, 간편·계좌는 코드 스텁(미노출) |
| "충전 후 예상 잔액" — "{N}원 결제 + 보너스 {B}캐시 = 지급 {C}캐시" + 큰 숫자 "{잔액+지급}캐시" | 산식 + 예상 잔액 | 동 파일:272–292 | `projectedBalance = currentBalance + selected.cashKrw` (보너스 항은 `bonusKrw > 0`일 때만) | 결제 전 "얼마 내고 얼마 받아 얼마가 되는가"의 회계 3항을 결제창 열기 전에 확정 고지 |
| "준비 중인 결제 수단입니다. 현재는 신용/체크카드만 이용할 수 있어요." | info 배너 (`role="status"`) | 동 파일:120–124, 294–298 | 조건: `info` state — 카드 외 수단 선택 시도 시 | 미구현 수단을 오류가 아닌 안내로 처리 |
| "결제창을 열지 못했습니다…" / "결제 설정이 준비되지 않았습니다…" | error 배너 (`role="alert"`) | 동 파일:126–158, 300–304 | 조건: SDK 로드 실패·clientKey 부재 등. 사용자 취소(`cancel|취소|USER_CANCEL`)는 오류로 안 띄움 | 취소와 장애를 구분 — 취소는 정상 이탈이므로 침묵 |
| "캐시 충전하기" (로딩 시 "결제창 여는 중…") | 주 CTA 버튼 | 동 파일:306–313 → `handleCharge()` | `loadTossPayments(clientKey)` → `payment.requestPayment({ method:"CARD", orderId:`cash-${userId}-${Date.now()}`, successUrl:/wallet/charge/success, failUrl:/wallet/charge/fail })` | **외부 돈이 들어오는 유일한 트리거.** orderId에 userId를 박아 서버(confirm·webhook)가 "누구의 충전인지"를 클라이언트 주장 없이 주문번호만으로 복원하게 함 |
| "최근 사용 내역" + "최근 캐시 충전과 사용 흐름입니다." | 섹션 헤딩 | WalletChargeRecentSummary.tsx:498–502 | — | 충전 직후 반영 확인 동선을 같은 화면에 배치 |
| "사용내역 전체 >" | 링크 | 동 파일:504–506 | → `/wallet/ledger` | 미리보기(5행)→전체 원장으로의 관문 |
| 최근 내역 표 (헤더: 내역 · 일시 · 금액 · 잔액) | 테이블 `.map` 1행 — **최대 5개 반복** (sm+ 데스크탑 전용, 모바일은 동일 데이터 카드 리스트) | 동 파일:516–588 · ledgerRowDisplay.ts | 아이콘: 충전=CreditCard·구독제=BookOpen·맞춤의뢰=ClipboardList·기타=Circle. 금액: credit이면 `+` 접두·검정, 차감은 빨강(`#dc2626`) | delta 부호와 색으로 "들어온 돈/나간 돈"을 원장 그대로 재현 — 잔액 열은 `balance_after_cents ÷ 100` |
| "내역을 불러오지 못했습니다." / "최근 사용 내역이 없습니다." | 오류/빈 상태 | 동 파일:509–512 | 조건: `error` / `rows` 0건 | 원장 읽기 실패를 명시(무단 빈 화면 금지) |
| "이번 달 사용 요약" + 총액 + 막대 3종 (맞춤의뢰 / 구독제 / 개별질문 · 기타) | 우측 사이드바 카드, 막대 `.map` 1행 — **3개 반복** | WalletChargeRightSidebar.tsx:629–665 | 이번 달 원장에서 차감(`!ledgerIsCredit`)만 합산, `ledgerUiKind()`로 3분류 | "충전한 돈이 어디로 갔는가"를 소비 3경로(구독/CR/IQ) 축으로 요약 — 충전 화면에서 소비 구조를 되비추는 거울 |
| "유의사항" — "충전 캐시는 결제 즉시 반영됩니다." 외 2줄 + "고객센터 바로가기 >" | 안내 카드 + 링크 | 동 파일:667–680 | → `/support` | 즉시 반영·보너스 조건·문의 채널의 사전 고지(분쟁 예방) |

비고: `loadWalletChargePageData`가 병렬 로드하는 `packages`(DB 테이블 `cash_topup_packages` 후보 프로브)와 `payments`는 현 `WalletChargePageView`에서 **미표시** — 화면 패키지는 하드코딩 상수 `CASH_CHARGE_PACKAGES`가 정본(추정: DB 패키지 테이블은 후속 전환 대비 선행 조회).

### /wallet/charge/success — 충전 완료 (`student-wallet-charge-success`)

`requireRole("student")`¹. **화면이자 confirm 트리거**: 렌더 전에 서버에서 `fetch(\`${baseUrl}/api/toss/confirm\`)`를 쿠키 동봉 POST — 실패 시 `/wallet/charge?error=…` redirect(성공 화면을 아예 보여주지 않음). paymentKey/orderId/amount 쿼리 누락·비정상 시 "결제 정보가 올바르지 않습니다."로 즉시 되돌림.

| 요소 (표시 라벨) | 종류 | 소스 | 연결 동작 | 추론한 존재 목적 |
|------------------|------|------|-----------|------------------|
| CheckCircle2 아이콘 + "충전이 완료됐습니다" | h1 + 상태 아이콘 | success/page.tsx:76–79 | confirm 200 응답 후에만 도달 | "완료"라는 단어를 승인+원장 기록이 실제 끝난 뒤에만 노출 — 낙관적 UI 배제 |
| "{N}원 결제 완료" / "{C}캐시 적립" | 결과 요약 2행 | 동 파일:81–85 · `findChargePackageByPayKrw(payKrw)` | 결제원화≠지급캐시 분리 표기 | 회계 항등식(낸 돈 vs 받은 캐시)의 최종 영수 확인 |
| "+ {B}캐시 보너스 추가 적립!" | 보너스 강조 | 동 파일:87–91 | 조건: `bonusKrw > 0` | 보너스 지급 사실의 명시적 확정(원장 분쟁 예방) |
| "총 {C}캐시 지급" | 보조 캡션 | 동 파일:92 | — | 적립+보너스 합계의 단일 숫자 확정 |
| "현재 잔액 {T}캐시" | 잔액 확인 | 동 파일:94–97 · `fetchWalletBalanceByUserId` 재조회 | confirm 후 DB 재조회 값 | 클라이언트 계산이 아닌 원장 반영 후 실잔액 — "정말 들어갔다"의 증거 |
| "사용 내역 보기 →" | 주 CTA | 동 파일:100–105 | → `/wallet/ledger` | 충전 행이 원장에 찍힌 것을 직접 확인시키는 동선 |
| "충전 페이지로" | 보조 CTA | 동 파일:106–111 | → `/wallet/charge` | 추가 충전 회귀 |
| 좌측 "내 캐시" 사이드바 (사용 가능/보너스/소멸 예정 dl + "충전 혜택" 2건 + "자주 묻는 질문" `.map` 1행 — 3개 반복) | 사이드바 | WalletChargeSidebar.tsx (FAQ: "캐시는 어디에 사용하나요?" 등 3문항) | 조건: `balanceError` 시 잔액 대신 실패 문구 | 완료 화면에서도 잔액 맥락 유지 + 환불·유효기간 FAQ 선제 응답 |

### /wallet/charge/fail — 결제 실패 (`student-wallet-charge-fail`)

`requireRole("student")`¹ + `StudentDashboardShell`(01 공용 사전 참조) 래핑. Toss failUrl 리다이렉트가 `?code=&message=`를 실어옴.

| 요소 (표시 라벨) | 종류 | 소스 | 연결 동작 | 추론한 존재 목적 |
|------------------|------|------|-----------|------------------|
| "결제 실패" | h1 | WalletChargeFailClient.tsx:449 | — | 실패의 즉시 선언 — 캐시 미지급 상태의 오해 차단 |
| "결제에 실패했습니다: {message}" | 사유 본문 | 동 파일:450–453 | message 기본값 "결제가 취소되었거나 승인되지 않았습니다."(서버 페이지에서 폴백) | PG가 준 실패 사유를 그대로 전달 — 재시도 판단 재료 |
| "코드: {code}" | 보조 코드 | 동 파일:452 | 조건: `code` 쿼리 존재 시 | CS 문의 시 Toss 오류코드 대조용 |
| "3초 후 충전 페이지로 이동합니다." | 자동 이동 안내 | 동 파일:442–445, 454 | `useEffect`로 3000ms 후 `router.replace("/wallet/charge")` | 실패를 막다른 길로 두지 않는 자동 재시도 동선 |
| "충전 페이지로 돌아가기" | 링크 | 동 파일:455–457 | → `/wallet/charge` | 3초를 기다리지 않는 즉시 재시도 |

### /wallet/ledger — 캐시 사용내역 (`student-wallet-ledger`)

`StudentDashboardShell`(01 공용 사전 참조, `activeTab="wallet"`, `hideRightRail`) 안에 본문 640px 고정 폭. 서버가 원장 최대 250행을 내리고 필터·페이지네이션은 클라이언트(`WalletLedgerPageBody`, 395줄)에서 수행. 페이지 크기 데스크탑 15 / 모바일 8(`matchMedia` 767px).

| 요소 (표시 라벨) | 종류 | 소스 | 연결 동작 | 추론한 존재 목적 |
|------------------|------|------|-----------|------------------|
| "캐시 사용내역" + "충전·구독·맞춤의뢰 등 캐시 흐름을 확인합니다." | h1 + 부제 | ledger/page.tsx:48–51 | — | 원장 = 충전·소비 전 흐름의 단일 열람 창구 선언 |
| "충전하기" / "사용내역" 탭 | 탭 nav | WalletLedgerPageBody.tsx:139–158 | 충전하기 → `/wallet/charge` · 사용내역 활성(`aria-current="page"`) | 지갑 2대 기능(넣기/보기)의 상호 왕복 |
| "현재 잔액" 카드 — "현재 잔액 {N}캐시" | 요약 카드 | 동 파일:160–163 · `formatWalletRowDisplay()` (`balance_cents ÷ 100`) | 오류 시 "—" | 아래 원장 행들의 합이 수렴해야 할 기준 숫자 |
| "기간" 필터 칩 — "1개월 / 3개월 / 6개월 / 직접설정" | 칩 버튼 `.map` 1행 — **4개 반복** (모바일 가로 스크롤 한 줄) | 동 파일:166–194 | 선택 시 클라이언트 필터 + 페이지 1로 리셋. 초기값 URL `?period=` | 원장을 시간 축으로 절단 — 회계 조회의 1차 축 |
| "시작 / 종료" date 입력 + "적용" | 커스텀 기간 폼 | 동 파일:195–223 | 조건: `period === "custom"`. 적용 시 `?period=custom&from=&to=` URL push | 임의 구간 조회를 URL로 고정(공유·재현 가능한 조회) |
| "유형" 필터 칩 — "전체 / 충전 / 구독 / 맞춤의뢰 / 기타" | 칩 버튼 `.map` 1행 — **5개 반복** | 동 파일:226–254 · `ledgerUiKind()` | 선택 시 클라이언트 필터. 초기값 URL `?kind=` | 소비 3경로+충전의 유형 축 절단 — 사이드바 요약과 동일 분류 체계 |
| 원장 표 (헤더: 날짜 · 구분 · 내역 · 금액 · 잔액) | 테이블 `.map` 1행 — **페이지당 최대 15개(모바일 8개) 반복** (sm+ 표 / 모바일 카드 이중 렌더) | 동 파일:279–355 | 구분 배지 = "충전/구독/맞춤의뢰/기타". 내역 = `ledgerReasonLabel`→`LEDGER_TYPE_KO` 한국어 사유("캐시 충전", "구독 결제", "맞춤의뢰 안전 결제", "개별 질문 답변 지급", "환불 승인" 등 19종 매핑). 금액 = `delta_cents ÷ 100`, credit이면 `+` 접두·검정, 차감은 빨강(`text-red-600`). 잔액 = `balance_after_cents ÷ 100` | append-only 원장의 화면 사영 — 부호·사유·행별 잔액으로 모든 캐시 이동을 사후 검증 가능하게 함. `ref_type` 원시 키를 노출하지 않고 한국어 사유로 번역하는 것이 `ledgerRowDisplay.ts`의 존재 이유 |
| "아직 사용 내역이 없어요" + "캐시를 충전하고 멘토 서비스를 이용해보세요." + "캐시 충전하기" CTA | 빈 상태 (ReceiptText 아이콘) | 동 파일:260–273 | 조건: 원장 0건. CTA → `/wallet/charge` | 빈 원장을 온보딩 진입점으로 전환 |
| "선택한 조건에 맞는 내역이 없어요" | 필터 빈 상태 | 동 파일:274–275 | 조건: 원장은 있으나 필터 결과 0건 | "데이터 없음"과 "조건 불일치"의 구분 — 원장 유실 오해 방지 |
| "사용 내역을 불러오지 못했습니다." | 오류 | 동 파일:258–259 | 조건: `data.ledger.error` | 조회 실패의 명시 |
| "이전 / {n} / {N} / 다음" | 페이지네이션 | 동 파일:357–379 | 조건: `totalPages > 1`. 페이지 크기 전환 시 현재 페이지 클램프 | 최대 250행 원장의 분할 열람 |
| "캐시 충전하러 가기 →" | 하단 링크 | 동 파일:384–386 | → `/wallet/charge` | 열람 끝의 충전 회귀 동선 |

### 레거시 리다이렉트 3종 + loading 2종

| 요소 (표시 라벨) | 종류 | 소스 | 연결 동작 | 추론한 존재 목적 |
|------------------|------|------|-----------|------------------|
| (화면 없음) `/wallet` | redirect | wallet/page.tsx | → `/wallet/charge` | 주석 "W20/21: 정식 진입은 /wallet/charge (기존 URL 유지 + redirect)" — 구 URL 북마크·외부 링크 보존 |
| (화면 없음) `/cash-history` | redirect | cash-history/page.tsx | → `/wallet/ledger` | 주석 "W20/21: 사용 내역은 /wallet/ledger 로 정리" |
| (화면 없음) `/payments` | redirect | (public)/payments/page.tsx | → `/cash` | 주석 "결제 랜딩 흡수: 캐시 충전은 /cash 단일 진입" — 결제 진입점 단일화 |
| 충전 Skeleton | loading.tsx | wallet/charge/loading.tsx | 헤더 1 + 카드 2 펄스 블록 | 코딩 규칙 10(주요 라우트 loading.tsx) 이행 |
| 원장 Skeleton | loading.tsx | wallet/ledger/loading.tsx | 헤더 + 필터 바 + 표 자리 펄스 3블록 | 상동 — 원장 250행 조회 대기 은폐 |

### POST /api/toss/confirm — 결제 승인 + 원장 기록 (`api-toss-confirm`)

UI 없음. `/wallet/charge/success` 페이지가 서버에서 쿠키 동봉 호출하는 **동기 확정 경로**.

| 요소 (표시 라벨) | 종류 | 소스 | 연결 동작 | 추론한 존재 목적 |
|------------------|------|------|-----------|------------------|
| 파라미터 검증 (`paymentKey/orderId/amount`) | 입력 게이트 | confirm/route.ts:9–14 | 결여 시 400 `invalid_params` | 최소 요건 미달 요청 조기 차단 |
| Toss `/v1/payments/confirm` 호출 | 외부 PG 승인 | 동 파일:26–42 (`TOSS_SECRET_KEY` Basic 인증) | 실패 시 400 "결제 승인에 실패했습니다." | **승인의 진실은 Toss 서버** — 클라이언트가 가져온 쿼리값을 절대 신뢰하지 않음 |
| 금액 일치 검증 | 회계 게이트 | 동 파일:44–48 | Toss 응답 `totalAmount ≠ amount` → 400 "결제 금액이 일치하지 않습니다." | 금액 변조(쿼리 조작) 차단 — 리포트 배경의 "confirm 라우트 금액검증" 실체 |
| 패키지 화이트리스트 검증 | 회계 게이트 | 동 파일:50–52 · `isAllowedChargePayKrw()` | 5개 패키지 외 금액 → 400 "허용되지 않은 충전 금액입니다." | 실결제 금액조차 정의된 패키지가 아니면 거부 — 지급 캐시 산정(`cashKrwForPayKrw`)의 유일 근거 유지 |
| 세션 = orderId 소유자 검증 | 인증 게이트 | 동 파일:54–63 | `orderId.match(/^cash-(.+)-(\d+)$/)` 의 userId ≠ 세션 user.id → 401 | 타인의 orderId로 내 지갑에 충전(또는 역방향)하는 교차 공격 차단 |
| `record_cash_topup` RPC (service_role) | 원장 기록 | 동 파일:65–88 · `recordCashTopupFromTossOrder()` (`p_amount_cents = cashKrw × 100`, `p_idempotency_key = orderId`) | 실패 시 500 `ledger_failed` | RLS를 우회하는 유일 승인 경로를 service_role RPC 한 점으로 수렴 — `cash_ledger`는 append-only이므로 이 삽입이 곧 회계 확정 |
| 멱등 응답 `{ ok, duplicate: true }` | 멱등 게이트 | 동 파일:90–92 · `hasCashTopupForOrderId()` (idempotency_key=orderId 선조회) | 중복이면 기록 없이 성공 응답 | success 페이지 새로고침·웹훅 선행 처리와의 이중 지급 방지 — orderId 1건 = 원장 1행 불변식 |
| past_due 구독 자동 복구 | 후처리 | cashTopupFromPayment.ts:12–22 (`recoverPastDueAfterTopup`, best-effort — 예외 삼킴) | 충전 성공 직후 해당 학생의 past_due 구독 즉시 복구 | "잔액 부족으로 끊긴 구독은 충전 즉시 살아난다" — 충전의 제품적 보상을 회계 확정과 원자적으로 연결 |
| `revalidatePath` 3종 (/wallet, /wallet/charge, /wallet/ledger) | 캐시 무효화 | confirm/route.ts:94–96 | 신규 기록 시에만 | 충전 직후 화면 잔액·원장의 즉시 일치 |

### POST /api/toss/webhook — 웹훅 백스톱 (`api-toss-webhook`)

UI 없음. **confirm과 둘 다 필요한 이유**: confirm은 사용자가 successUrl 리다이렉트로 돌아와야만 실행된다 — 브라우저 이탈·네트워크 단절·탭 닫힘이면 결제는 됐는데 원장 기록이 유실된다. 웹훅은 Toss가 서버로 직접 쏘는 두 번째 통지로 이 고아 결제를 회수한다. 두 경로가 같은 `recordCashTopupFromTossOrder()`(idempotency_key=orderId)를 공유하므로 어느 쪽이 먼저 와도 정확히 1회만 기록된다.

| 요소 (표시 라벨) | 종류 | 소스 | 연결 동작 | 추론한 존재 목적 |
|------------------|------|------|-----------|------------------|
| HMAC 서명 검증 | 인증 게이트 | webhook/route.ts:131–137 · verifyTossWebhookSignature.ts (`TOSS_WEBHOOK_SECRET`으로 HMAC-SHA256(rawBody), `Toss-Signature`/`X-Toss-Signature` 헤더, base64/hex·`v1:` 접두 허용, `timingSafeEqual`) | 불일치 → 401 `invalid_signature` | 인증 세션이 없는 엔드포인트에서 "Toss가 보냈다"를 암호학적으로만 신뢰 — 위조 웹훅으로 무료 충전하는 공격의 차단선 |
| 이벤트 필터 (`PAYMENT_STATUS_CHANGED` + `status === "DONE"` + orderId `cash-` 접두) | 스코프 게이트 | 동 파일:146–162 | 불일치 시 200 `{ skipped }` (재전송 폭주 방지 위해 오류 아님) | 캐시 충전 주문만 처리 — 다른 결제 이벤트에 200을 돌려 Toss 재시도 루프 차단 |
| Toss 결제 재조회 검증 | 회계 게이트 | 동 파일:106–128 (`GET /v1/payments/{paymentKey}` 후 status=DONE·orderId·paymentKey·금액 4중 대조) | 불일치 시 `{ recovered: false, skipped: <code> }` | 웹훅 본문조차 신뢰하지 않음 — 서명이 유효해도 금액·주문 실체를 Toss 원본 API로 재확인 |
| `recordCashTopupFromTossOrder()` 재사용 | 원장 기록 (confirm과 동일 함수) | 동 파일:196–200 | duplicate면 `{ recovered: false, duplicate: true }` — confirm이 이미 처리한 정상 케이스 | 두 경로의 회계 로직을 단일 함수로 물리적으로 통일 — 로직 분기로 인한 이중 지급/누락 계열 버그의 구조적 봉쇄 |
| `admin_action_logs` `webhook_recovery` 기록 | 감사 로그 | 동 파일:202–235 · `logWebhookCashTopupRecovery()` (성공/실패/예외 3계열, paymentKey는 앞 4자 마스킹) | 복구 성공 시 `{ recovered: true }` | "리다이렉트가 유실됐고 웹훅이 살렸다"는 사건 자체를 관리자 감사 큐에 남김 — 백스톱 작동 빈도의 운영 관측 |

### 연결 lib · 잔존물 (근거 명세)

| 요소 | 종류 | 소스 | 연결 동작 | 추론한 존재 목적 |
|------|------|------|-----------|------------------|
| `CASH_CHARGE_PACKAGES` 5종 | 잠금 상수 | lib/cash/chargePackages.ts | 위젯 카드·confirm/webhook 화이트리스트·success 보너스 산정이 공유 | 클라이언트 표시와 서버 승인의 단일 정본 — "보고서 잠금" 주석으로 변경 통제 명시 |
| `LEDGER_TYPE_KO` 19종 매핑 | 사유 사전 | lib/cash/ledgerRowDisplay.ts:533–553 | `ref_type`/`type` 원시 키 → "구독 결제"·"맞춤의뢰 안전 결제"·"개별 질문 환불" 등 | 원장 행의 기계 키를 사용자 언어로 번역 — 소비 전 경로(구독/CR/IQ/환불/조정)의 사유가 이 한 사전에 집약 |
| `cashQueries.ts` 테이블 프로브 | 조회 유틸 | firstReadableTable — wallets/cash_wallets 등 후보 순차 시도 | 잔액·원장·패키지·결제 조회 공용 | 스키마 명 변동에도 화면이 깨지지 않는 방어적 조회 (추정: 스키마 확정 전 과도기 설계) |
| `testWalletCashTopupAction` | 서버 액션 | lib/cash/walletTopupActions.ts | `CASH_TOPUP_ALLOW_TEST_CHARGE==="true"` && 비프로덕션에서만 `record_cash_topup` 직접 호출, 프로덕션+플래그 조합은 throw | PG 없이 원장 파이프라인을 검증하는 개발·스테이징 전용 우회로 — 이중 환경 게이트로 운영 유입 차단 |
| `CashTopUpEntry` / `WalletLedgerView`(+`CashLedgerFilterSkeleton`) | 미사용 컴포넌트 | components/cash/ — 현재 어떤 app 라우트에서도 임포트되지 않음 (grep 실측) | — | 구 캐시 화면의 잔존물 (추정: W20/21 개편 이전 세대 뷰) — "필터·탭 — 연결 예정" 플레이스홀더 문구가 남아 있음 |

---

**각주 (코드 ≠ 기획 표기)**

¹ `requireWalletChargeAccess()`는 기획대로 멘토 충전을 허용하지만, `/wallet/charge/success`·`/wallet/charge/fail`은 `requireRole("student")` — 멘토가 충전을 시작하면 Toss 리다이렉트 복귀 지점에서 학생 role 게이트에 걸린다(웹훅 백스톱으로 원장 기록 자체는 회수 가능). 코드 실측 사실만 기록.

² 환불: CLAUDE.md·배경 정본상 관리자 승인 → 캐시 크레딧이며 실 카드 취소는 수동. 본 담당 범위(충전·원장 화면)에는 환불 신청 UI가 없고, 사이드바 FAQ가 "미사용 캐시 환불은 고객센터·분쟁 메뉴를 통해 신청"으로 안내 — 환불 집행 화면은 08 범위 밖(관리자 `/admin/refunds`).

³ 충전 위젯의 `isAuthenticated` prop은 전달되나 컴포넌트 구현에서 구조 분해되지 않음(미사용) — 코드 실측 사실.
