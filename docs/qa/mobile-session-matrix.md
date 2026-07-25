# 모바일 세션 재현 시나리오 (QA-Q2 / 검증항목 3-8)

> **이 문서는 준비 산출물이며, 실행·적용은 후속 웨이브에서 승인 후 직렬 수행한다.**
> 트랙 4 세션에서 staging 에 실행한 비-SELECT 문은 0건 · 실기기 QA 는 미실행이다.
> 계정 별칭은 `qa-accounts-plan.md` §0 규약(`qa-student-01` · `qa-mentor-01`)을 따른다.
> 기점: `byite-co/ssambership_web` PR #42 브랜치 HEAD `6062dcc`.

---

## 1. 목적 (3-8 = 모바일 로그인 유지)

「Android Chrome 등 모바일 웹에서 로그인이 유지되지 않는다」는 보고를 **재현 가능한 절차**로
바꾸고, 원인 계층(쿠키 속성 / chunk 분할 / 표면 차이 / 기기 정책)을 분리해 판정한다.

쌤버십 웹에는 **세션 표면이 두 개**이고 쿠키 속성이 서로 다르다. 3-8 을 재현할 때
어느 표면인지 먼저 확정하지 않으면 판정이 뒤섞인다.

| 표면 | 진입 | 쿠키를 쓰는 주체 | 정본 코드 |
|---|---|---|---|
| **일반 모바일 웹** | 모바일 브라우저 `/login` | **브라우저 JS**(`createBrowserClient`) | `lib/supabase/client.ts` |
| **앱 WebView** | 앱 → `POST /api/app-session/bootstrap` | **서버**(Set-Cookie) | `lib/appSession/appSurfaceCookies.ts` |

---

## 2. 시나리오 M1 — 일반 모바일 웹 로그인 유지

**대상**: Android Chrome (주) · iOS Safari (참고)
**계정**: `qa-student-01` (학생 표면) · `qa-mentor-01` (멘토 표면) 각각 1회씩

### 2-1. 재현 절차

| # | 조작 | 관찰 |
|---|---|---|
| 1 | 브라우저 데이터 초기화(쿠키·사이트 데이터 전체 삭제) | 시작 상태 확정 |
| 2 | `https://<QA도메인>/login` 접속 → 학생 탭 → 이메일·비밀번호 로그인 | 로그인 성공 → `/mypage` 진입 |
| 3 | **즉시** 개발자도구로 쿠키 스냅샷 (§4) | `sb-<ref>-auth-token*` 존재 |
| 4 | 앱 전환 없이 새로고침 3회 | 세션 유지 |
| 5 | 탭을 백그라운드로 보내고 **5분** 뒤 복귀 → 새로고침 | 세션 유지 |
| 6 | 브라우저를 **완전 종료**(최근 앱에서 스와이프) 후 재실행 → 사이트 재방문 | **여기가 3-8 의 핵심 관측점** |
| 7 | **1시간** 경과 후 재방문 (access token 만료 후 refresh 경로) | refresh 회전 성공 여부 |
| 8 | **24시간** 경과 후 재방문 | 장기 유지 여부 |
| 9 | 각 시점마다 §4 쿠키 스냅샷 + §5 판정표 기록 | |

### 2-2. 분기 관찰 (원인 분리용)

| 분기 | 조작 | 의미 |
|---|---|---|
| B-1 | Chrome **시크릿 탭**으로 2~6 반복 | 확장/설정이 아니라 기본 동작인지 |
| B-2 | Chrome 설정 → *쿠키 및 사이트 데이터* → **"Chrome 종료 시 쿠키 삭제"** OFF 확인 | 기기 정책이 원인인지 |
| B-3 | Chrome 설정 → *제3자 쿠키 차단* 상태 기록 | 1P 쿠키라 무관해야 정상 |
| B-4 | Android **데이터 절약/절전 모드** OFF 로 재시도 | 백그라운드 종료가 원인인지 |
| B-5 | 동일 절차를 **데스크톱 Chrome** 으로 수행 | 모바일 고유 문제인지 |

### 2-3. 기대 동작

- 2~5: 세션 유지(로그인 화면으로 튕기지 않음)
- 6: **유지되어야 한다.** `@supabase/ssr` 이 쓰는 auth 쿠키는 세션 쿠키가 아니라
  `maxAge` 가 설정된 영속 쿠키(기본 400일)다. 브라우저 종료 후 사라진다면
  ① `maxAge`/`expires` 미설정 ② 기기 정책(B-2) ③ chunk 유실(§3-2) 중 하나다.
- 7: access token 만료 시 refresh 로 자동 재발급 → 쿠키 값이 **회전**하되 이름·속성은 동일
- 8: 유지

---

## 3. 시나리오 M2 — 앱 WebView 경유 세션 (bootstrap POST)

**대상**: Android WebView (앱 내장 브라우저)
**계정**: **`qa-mentor-01` 만** — 이 경로는 mentor 전용이다(아래 게이트 참조).

### 3-1. bootstrap 흐름 (`app/api/app-session/bootstrap/route.ts`)

```
앱(Flutter, Supabase 세션 보유)
  │
  │ WebView.postUrl( POST /api/app-session/bootstrap )
  │   Content-Type: application/x-www-form-urlencoded  (또는 application/json)
  │   body: access_token=… & refresh_token=… & target=shortform_create
  │   ※ 토큰은 body 로만. URL·로그·응답 어디에도 싣지 않는다.
  ▼
서버 검증 (순서 고정)
  1) parseBootstrapBody      — Content-Type allowlist · 본문 16KiB 상한 · 필수 필드 · target enum
  2) bootstrapProjectRefMatches — 토큰 발급 프로젝트 ref == 웹 Supabase ref (교차 프로젝트 이식 차단)
  3) supabase.auth.setSession   — 쿠키는 격리 버퍼(pendingCookies)에만 기록
  4) supabase.auth.getUser      — auth 서버 왕복 재검증(위조·만료 토큰 차단)
  5) assertAppSurfaceAccountActiveStrict — 계정 게이트(fail-closed)
  6) strictMentorRoleDecision   — mentor role 게이트
  ▼
성공: 303 redirect → /app/community/shortform/new
      + Set-Cookie (hardenAppSurfaceCookieWrites 로 속성 강제)
실패: 303 redirect → /app/bridge/error?code=…   ※ Set-Cookie 0개(버퍼 폐기)
```

**메서드**: `POST` 전용. GET/PUT/PATCH/DELETE 는 `405` + `Allow: POST`.
**캐시**: 모든 응답에 `Cache-Control: no-store`.
**target**: 현재 `shortform_create` **1종뿐**. 결제·구독·충전 target 은 존재하지 않는다.

### 3-2. 재현 절차

| # | 조작 | 기대 |
|---|---|---|
| 1 | 앱 데이터 초기화 → `qa-mentor-01` 로 앱 로그인 | 앱 세션 확보 |
| 2 | 앱에서 숏폼 작성 진입(WebView bootstrap 발생) | `/app/community/shortform/new` 도달 |
| 3 | WebView 쿠키 스냅샷 (§4-2) | `HttpOnly` **true** |
| 4 | WebView 를 닫고 다시 숏폼 작성 진입 | 재부트스트랩 성공 |
| 5 | 앱 완전 종료 → 재실행 → 숏폼 작성 진입 | 성공 |
| 6 | **1시간** 후 재진입 (refresh 회전 경로) | 성공 · 쿠키 속성 **불변**(HttpOnly 유지) |

### 3-3. 오류 분기 (전부 **기대 동작** — FAIL 아님)

| 조작 | 기대 결과 |
|---|---|
| `qa-student-01` 토큰으로 bootstrap | `/app/bridge/error?code=mentor_only` · **Set-Cookie 0개** |
| 만료·위조 토큰 | `code=bootstrap_failed` · Set-Cookie 0개 |
| 정지/탈퇴 진행 계정 | `code=account_blocked` · Set-Cookie 0개 |
| `target` 미지원 값 | `code=invalid_request` · Set-Cookie 0개 |
| GET 으로 호출 | `405` + `Allow: POST` |
| 다른 Supabase 프로젝트 토큰 | `code=bootstrap_failed` |

> **핵심 불변식**: 어떤 실패 응답에도 `Set-Cookie` 헤더가 **0개**여야 한다.
> 하나라도 붙으면 쿠키 버퍼 격리가 깨진 것 — 즉시 FAIL.

### 3-4. 앱 표면 경로 allowlist

`/app/community/shortform/new` · `/app/bridge/complete` · `/app/bridge/error` 3개뿐이다.
WebView 에서 `/subscribe`·`/wallet/charge` 로 이동이 되면 결제 분리 정책 위반 → FAIL.

---

## 4. 쿠키·chunk 속성 확인 방법 (개발자도구 기준)

### 4-1. Android Chrome — 원격 디버깅

1. 기기: 설정 → 휴대전화 정보 → 빌드번호 7회 탭 → 개발자 옵션 → **USB 디버깅 ON**
2. PC: Chrome 에서 `chrome://inspect/#devices` → 기기 승인 → 대상 탭 **inspect**
3. DevTools → **Application** → *Storage* → **Cookies** → `https://<QA도메인>`

**기록할 컬럼 (값 자체는 기록 금지 — 토큰이다)**

| 컬럼 | 일반 웹 기대 | 앱 WebView 기대 |
|---|---|---|
| Name | `sb-<project-ref>-auth-token` (+ chunk `.0` `.1` …) | 동일 |
| Value | **기록 금지**(길이만: `1024` 초과 시 chunk 분할됨) | **기록 금지** |
| Domain | QA 도메인 | 동일 |
| Path | `/` | `/` (강제) |
| Expires / Max-Age | **`Session` 이 아니어야 함**(날짜가 찍혀야 함) | 라이브러리 값 보존 |
| HttpOnly | **false** (브라우저 JS 가 씀) | **true** (강제) |
| Secure | true (https) | **true** (강제) |
| SameSite | `Lax` | **`Lax`** (강제) |

> 앱 표면 4속성(`httpOnly:true` · `secure:true` · `sameSite:'lax'` · `path:'/'`)은
> `APP_SURFACE_COOKIE_ATTRIBUTES` 로 **frozen** 되어 있고, 최초 발급뿐 아니라
> refresh 재발급·회전·삭제(`maxAge=0`)에도 동일 적용된다. `maxAge` 만 라이브러리 값을 보존한다.
> **일반 웹 표면은 이 모듈을 쓰지 않는다** — 전역 기본값(`httpOnly` 미강제)이 유지된다.
> 즉 「일반 웹은 HttpOnly=false」가 **정상**이며 결함이 아니다.

### 4-2. chunk 쿠키 확인 (세션 유실의 주요 원인)

Supabase 세션 쿠키는 4KB 브라우저 한도를 넘으면 `…auth-token.0`, `.1`, … 로 분할된다.
**일부 chunk 만 살아남으면 세션 복원이 조용히 실패한다.**

| 확인 | 방법 | 판정 |
|---|---|---|
| chunk 개수 | Cookies 목록에서 `auth-token` 으로 시작하는 항목 수 | 로그인 직후와 재방문 시 **동일해야** 함 |
| chunk 연속성 | 이름 접미사가 `.0 .1 .2 …` 로 **빠짐없이** 이어지는지 | 중간 결번 = FAIL |
| 속성 일치 | 모든 chunk 의 HttpOnly/Secure/SameSite/Path/Expires 가 **동일**한지 | 하나라도 다르면 FAIL |
| 총 바이트 | 각 Value 길이 합계 | 4096B 근처면 chunk 경계 이슈 의심 |

DevTools **Network** 탭에서도 교차 확인한다:
- 로그인 응답 / bootstrap 303 응답의 **Response Headers → `Set-Cookie`** 개수와 속성
- 재방문 첫 요청의 **Request Headers → `Cookie`** 에 chunk 가 전부 실려 갔는지

> ⚠️ `Set-Cookie`/`Cookie` 헤더 **값**은 캡처·붙여넣기 금지(토큰 원문). 이름·속성·개수만 기록한다.

### 4-3. Android WebView — 원격 디버깅

WebView 디버깅은 앱이 `WebView.setWebContentsDebuggingEnabled(true)` 를 켠 빌드에서만
`chrome://inspect` 에 뜬다. QA 빌드에서 이 플래그가 켜져 있는지 앱 트랙(트랙 1)에 확인한다.
꺼져 있으면 M2 의 §4 쿠키 확인은 **BLOCKED** 로 두고, 대신 §3-3 의 리다이렉트 결과
(도달 경로 · 오류 code)로만 판정한다.

### 4-4. iOS Safari — Web Inspector

1. 기기: 설정 → Safari → 고급 → **웹 속성(Web Inspector) ON**
2. Mac: Safari → 개발자용 메뉴 → 기기 선택 → 대상 페이지
3. **Storage** 탭 → Cookies → §4-1 과 같은 항목 기록
4. ITP(Intelligent Tracking Prevention) 주의: 1P 쿠키라도 **7일 미방문 시 삭제**될 수 있다.
   장기 유지(8일 이상) FAIL 은 ITP 정상 동작일 수 있으므로 그렇게 기록한다.

---

## 5. 기기·브라우저 매트릭스

| ID | 플랫폼 | 브라우저/표면 | 우선순위 | 대상 시나리오 | 비고 |
|---|---|---|---|---|---|
| **D1** | Android 13+ | **Chrome (최신)** | **필수** | M1 | 3-8 주 재현 대상 |
| **D2** | Android 13+ | **앱 WebView** | **필수** | M2 | mentor 전용 · bootstrap |
| **D3** | iOS 16+ | **Safari** | 참고 | M1 | ITP 영향 별도 판정 |
| D4 | Android 13+ | Samsung Internet | 선택 | M1 | 국내 점유율 |
| D5 | Android 13+ | Chrome 시크릿 | 선택 | M1 / B-1 | 확장·설정 배제 |
| D6 | iOS 16+ | 앱 WebView(WKWebView) | 선택 | M2 | Firebase iOS 설정 선행 필요 |
| D7 | Desktop | Chrome | 대조군 | M1 / B-5 | 모바일 고유성 판정 |

**최소 수행 범위**: D1 · D2 · D3.
**기기별 기록 항목**: OS 버전 · 브라우저 버전 · 앱 build 번호 · 절전/데이터절약 설정 · 쿠키 정책 설정.

> 앱 최소 지원 build 는 `mobile_app_version_policies` 로 강제된다(정수 비교).
> 기기 build 가 정책 미만이면 앱이 업데이트를 요구하므로, M2 실행 전 앱 build 번호를 먼저 기록한다.

---

## 6. 판정 기준

| # | 항목 | PASS | FAIL |
|---|---|---|---|
| P-1 | 새로고침·5분 백그라운드 후 세션 유지 (M1 4~5) | 유지 | 로그인 화면으로 이동 |
| P-2 | **브라우저 완전 종료 후 재방문 세션 유지 (M1 6)** | 유지 | 유실 → **3-8 재현** |
| P-3 | 1시간 후 refresh 회전 성공 (M1 7) | 유지 · 쿠키 이름·속성 불변 | 유실 또는 속성 변화 |
| P-4 | 24시간 후 유지 (M1 8) | 유지 | 유실(iOS 는 ITP 별도 판정) |
| P-5 | auth 쿠키가 세션 쿠키가 아님 | `Expires` 에 날짜 | `Session` |
| P-6 | chunk 연속성·속성 일치 | 결번 0 · 속성 동일 | 결번 또는 속성 불일치 |
| P-7 | 앱 WebView 쿠키 4속성 강제 | HttpOnly·Secure·SameSite=Lax·Path=/ **전부** | 하나라도 불일치 |
| P-8 | refresh 후에도 앱 쿠키 HttpOnly 유지 | true 유지 | 재발급에서 false 로 내려감 |
| P-9 | bootstrap 실패 시 Set-Cookie 0개 | 0개 | 1개 이상 |
| P-10 | bootstrap 비-POST 는 405 | 405 + `Allow: POST` | 그 외 |
| P-11 | 앱 WebView 에서 결제 경로 도달 불가 | 도달 0 | `/subscribe`·`/wallet/charge` 도달 |
| P-12 | 학생 토큰 bootstrap → `mentor_only` | 리다이렉트 정확 | 통과되면 **CRITICAL FAIL** |

---

## 7. DB 무영향 확인

M1·M2 는 **읽기 경로**다. 세션 확보만으로 `public` 테이블 행 수가 변하면 안 된다.
`device-qa-db-crosscheck.md` §3-A 의 **A-1** 을 시나리오 전후로 실행해 5개 값이
완전히 동일한지 확인한다(SELECT 전용).

---

## 8. 결과 기록표 (실행 세션에서 채움)

| 기기 | 시나리오 | P-1 | P-2 | P-3 | P-4 | P-5 | P-6 | P-7 | P-8 | P-9 | P-10 | P-11 | P-12 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| D1 Android Chrome | M1 | | | | | | | — | — | — | — | — | — |
| D2 Android WebView | M2 | | | | | | | | | | | | |
| D3 iOS Safari | M1 | | | | | | | — | — | — | — | — | — |

**쿠키 스냅샷 기록란 (값 금지 · 이름/속성/개수만)**

| 시점 | chunk 개수 | HttpOnly | Secure | SameSite | Path | Expires 유형 |
|---|---|---|---|---|---|---|
| 로그인 직후 | | | | | | |
| 새로고침 후 | | | | | | |
| 브라우저 재실행 후 | | | | | | |
| 1시간 후(refresh) | | | | | | |
| 24시간 후 | | | | | | |

---

## 9. 보안·개인정보 취급

- 토큰·`Set-Cookie`/`Cookie` 헤더 **값**, signed URL 원문은 캡처·기록·공유 금지.
- 기록은 쿠키 **이름·속성·개수·길이**까지만.
- 스크린샷을 남길 때 DevTools 의 Value 컬럼은 **가린 뒤** 저장한다.
- 계정 이메일·비밀번호는 이 문서에 기재하지 않는다(별칭만 사용).
