# 쌤버십 v16 전체 수정 이력 — 교차 저장소 최종 변경 보고서 (2026-07-24)

> 웹(`ssambership_web`)·DB(staging SQL 157~166)·앱(`ssambership-app`)의 v16 결함 수정
> 전체 이력을 하나로 정리한 **단일 정본 문서**다. Git 이력·기존 audit 문서·SQL manifest·
> CI 결과를 근거로 사실만 재구성했으며, 이 보고서 작성 과정에서 코드·DB·fixture 는
> 일절 변경하지 않았다.

---

## 1. 문서 메타데이터

| 항목 | 값 |
|---|---|
| 작성일 | 2026-07-24 |
| 웹 저장소 | `byite-co/ssambership_web` · 브랜치 `claude/web-app-fixes-bug-rollback-cx52cq` · PR [#42](https://github.com/byite-co/ssambership_web/pull/42) (open·draft·base `main`) |
| 앱 저장소 | `byite-co/ssambership-app` · 브랜치 `claude/flutter-app-remediation-0r2k8p` · PR [#33](https://github.com/byite-co/ssambership-app/pull/33) (open·draft·base `master`) |
| 웹 실측 범위 | 기준점 `7a84ac4`(2026-07-20, 직전 세션 종료 상태) **이후** 32커밋 → 최종 HEAD **`d127255`** (fetch 후 원격 실 HEAD·ancestry 확인, 후보값 정확) |
| 앱 실측 범위 | 기준점 `6b1da7e`(2026-07-19, v16 앱 지시서 커밋) **이후** 44커밋 → 최종 HEAD **`7c0134e`** (후보 `19a6228`의 정상 후손 — 19a6228 뒤에 문서 정정 커밋 `c2163a8`·`7c0134e` 2건이 추가된 상태로 확정) |
| 앱 식별자 | Android package `com.ssambership.edu` · iOS bundle `com.ssambership.app`(플랫폼별 분기, `1e26b35` 문서화) · 현재 version `0.1.0+4` |
| staging | Supabase project `lbeqxarxothkmzqvpudy` — SQL 적용·fixture 는 전부 이 프로젝트에서만 수행 |
| production | **미접근**(DB·배포 모두). SQL 은 production 미적용이 정상 상태(런북 준비 문서만 존재) |
| 조사 방법 | ① 기준점→HEAD 전체 커밋·diff ② PR #42/#33 상태·CI 이력 ③ `docs/audit/*`(manifest·runbook·checkpoint·E2E 기록) ④ SQL 157~166 실파일 ⑤ 앱 session 1·2·3·E2E 문서 ⑥ **현재 소스에서 실제로 살아 있는 최종 구현** 대조 |
| 판정 기준 | 커밋 메시지가 아니라 현재 소스·실측 CI 를 정본으로 한다. `READY_NOT_EXECUTED` 를 PASS 로 바꾸지 않는다. CI 전체 success 와 개별 step outcome 을 분리한다. staging 적용과 production 적용, CI AAB 와 Play 제출용 signed AAB, 코드의 Firebase 통합과 실빌드의 설정 포함 여부를 각각 구분한다. 추정치는 `추정` 으로 표기한다. 이메일·UUID·토큰·비밀번호·anon key·원장 값은 기록하지 않는다(건수만). |

참고: PR #42 전체는 87커밋(249파일)으로, 본 보고서 범위(7a84ac4 이후) 앞에 "7/18 세션
회귀 롤백" 1단계 커밋들이 포함되어 있다. 본 보고서는 v16 결함 수정 구간만 다룬다.

---

## 2. 경영진 요약

**수정 전 핵심 위험.** v16 감사 시점의 제품은 ① 알림이 웹 코드의 best-effort 발송이라
결제·구독 같은 도메인 변경과 알림이 어긋날 수 있었고(이중발송·누락 창), ② 앱은 질문
작성·첨부가 다단계 쓰기라 실패 시 빈 질문·유령 첨부가 남았으며, ③ 앱 로그인 직후 전원이
차단되는 P0(권한 없는 테이블 직접 조회)와 ④ 게시판·숏폼 발행이 항상 실패하는 P0(폼
직렬화 결함)가 실서버·실브라우저 검증에서 드러났다. ⑤ 결제 확인(Toss)은 서버가 자기
자신을 공개 URL 로 다시 호출하는 구조였고, ⑥ 숏폼 테이블에는 학생이 직접 글을 넣을 수
있는 레거시 정책 구멍이 있었다.

**완료된 주요 개선.** 알림 10종을 DB 트리거로 원자화하고(SQL 157~160), 계정 탈퇴·최소
앱버전·게시판 댓글 정본화·요금제 자동 시드까지 서버 계약을 확장했다(SQL 161~166, 전부
staging 적용·검증 완료). 웹은 결제 확인 구조 재설계(외부 승인 호출 전에 인증·소유권·상품
검증을 강제), 앱 전용 세션 부트스트랩(HttpOnly 쿠키·fail-closed 계정 게이트), 숏폼 작성
결함 수렴, 실브라우저 E2E 로 찾은 발행 결함 수정을 마쳤다. 앱은 질문방 원자 RPC 전환,
알림 정본 17종 매핑, FCM 수신 전용 코드, 숏폼 재생·작성(WebView 브릿지), 멘토 찾기
전면 개선, 마이페이지·리뷰·버튼 색 등 QA 4차 결함까지 수렴했다.

**완료 수준.** 웹·DB·앱 모두 **코드 작업은 완료**이고 자동 검증(웹 계약테스트 117/117,
앱 테스트 685/685, 양쪽 CI green)이 통과된 상태다. 실브라우저 Preview E2E 는 학생·멘토
플로우 PASS, 앱 실서버 왕복 E2E 도 PASS 다. **내부 테스트 가능한 상태다** — 웹은 Vercel
Preview 로, 앱은 Play 내부 테스트 트랙(build 3 업로드 기록)으로 배포 가능한 코드다.

**남은 외부 조치.** ① Firebase 설정 파일 2개(Android/iOS) 배치 — 현재 저장소에는 없어
푸시 코드는 휴면 상태이며, **설정을 넣으면 별도 빌드(새 versionCode)가 필요**하다.
② Android/iOS 실기기 QA 와 관리자 QA. ③ production DB 에 SQL 적용(오너 승인 후,
준비 런북 완료). ④ release keystore 서명·Play 제출은 오너 로컬에서만 가능하다.

**출시 전 반드시 확인할 항목.** Toss 실결제 성공 경로 E2E(테스트 키), CR 알림의 서버
푸시 발신 정책(트레이 노출 가능성), 기존 학생 2건의 학년 데이터 정리, production SQL
적용 순서(런북 준수), build 4 의 Play 업로드 여부 확인.

**결제는 웹 전용이다.** 앱에는 결제·구독 구매 경로를 넣지 않았다(결제 SDK 의존성 0,
구매 유도 CTA 0, `/wallet/charge`·`/subscribe` 앱 내 열기 0 — §10 에서 실측 증명).
앱은 Android `com.ssambership.edu`, 현재 versionCode 4(0.1.0+4)다. Firebase 는
**코드에는 통합**(수신 전용)되어 있으나 **설정 파일이 저장소에 없어 이 저장소에서
빌드된 산출물에는 포함되지 않는다** — FCM 활성화에는 설정 배치 + 재빌드가 필요하다.

---

## 3. 전체 타임라인

| # | 구간 (일자) | 주요 커밋 | 한 줄 결과 |
|---|---|---|---|
| 1 | 웹 SQL 157~160·알림 원자화 (07-20) | web `8926395`·`5f9640b`·`111ad29` | 알림 10종을 DB 트리거 원자 발행으로 이관, 웹 best-effort 발송 전면 제거, staging fixture 24/24 PASS |
| 2 | 웹 UI·lint·Preview E2E 수렴 (07-20) | web `8f10b3b`·`791e9f5`~`d2f3d9f`·`1f8e382`·`788cdfe` | eslint 38err/66warn→0/0(구조 개선), 실브라우저 인증 E2E 완주 — P0-3/P0-4 발행 결함 발견·수정, 학생·멘토 PASS |
| 3 | 앱 세션 1 (07-21) | app `590491f`·`f52105e`·`e324527`·`5efc1ce`·`69763dd` | 질문방 쓰기·첨부를 원자 RPC 로 전환, 이미지·페이지네이션·lifecycle·signed URL 하드닝 |
| 4 | 앱 세션 2 (07-21) | app `c780874`·`591d55e`·`c5075b0`·`6ff9031` | 알림 정본 17종·keyset cursor·정직한 설정 저장, FCM 수신 전용·토큰 수명주기·가드된 딥링크 |
| 5 | 앱 세션 3 (07-21) | app `79322f6`·`d6e8213`·`008f8b8` | 탈퇴 요청·취소 UX, 리뷰·개별질문 환불 계약 정렬, 네이티브 준비 기록 |
| 6 | 서버–앱 최종 수렴·SQL 161~164 (07-21) | web `ebe60d8`·`7387382` / app `5ce8489`·`0856f1e`·`dbeb0ab` | 탈퇴 self RPC·최소버전 정책·댓글 브리지(+교차수정 수렴), 앱 3종 전환 완료 |
| 7 | 앱 인증 E2E·AAB 준비 (07-21~22) | app `96859c9`~`86c8651`·`cd558cf`·`c18496c`·`7c5ebb8`·`50cc8c9`·`b645752`·`54e2a67` | 실서버 왕복 E2E 통과(P0 로그인 403 발견·수정), package `com.ssambership.edu` 수렴, versionCode 2→3, 멘토 찾기 전면 개선 |
| 8 | 롤백 후 잠복 결함 복원 — 웹 숏폼 잔여·앱 표면 (07-24) | web `abf9c81`·`0390417`·`ae4a645`·`fb12c93` | 숏폼 작성 잔여 3종(파일명 1줄·File 혼입 구조 차단·intent 보존) 수렴 + 앱 전용 작성 표면·브릿지·bootstrap 신설 |
| 9 | 앱 숏폼 WebView·찜한 멘토 (07-24) | app `003bdc5`·`d9c26f9`·`c28a270` | 숏폼 작성 인앱 WebView(비결제·allowlist), 멘토 찾기 전체/찜 scope, versionCode 4 |
| 10 | SQL 165·HttpOnly·strict 게이트 (07-24) | web `62db3b0`·`101f255`·`9f6a35d`·`0627bf5` | 숏폼 학생 INSERT 우회 정책 2건 제거, 앱 표면 쿠키 HttpOnly 구조(방식 A), fail-closed 계정 게이트 |
| 11 | QA 4차 결함·SQL 166 (07-24) | web `1430bba`·`b1c1d18`·`4660964`·`667275d`·`d127255` / app `d5394c0`·`031a869`·`7b3f4bc`·`19a6228`·`c2163a8`·`7c0134e` | 멘토 승인 시 요금제 자동 시드, Toss self-fetch 제거, 마이페이지 알림·리뷰 게이트·CR 게이트·버튼 색·학년 문구 수렴 + 출시 범위 문서 정정 2건(게시판 작성기 정본·IQ 지원 계약) |
| 12 | 현재 CI·Preview 상태 (07-24) | — | §8 참조 — 웹 Preview READY(d127255)·앱 flutter-ci 전 step success(19a6228), 문서 정정 커밋(c2163a8) CI 는 §8 의 실측 상태 기록 |

---

## 4. 웹 수정 사항

| 영역 | 수정 전 문제 | 최종 수정 | 주요 파일·커밋 | 검증 | 상태 |
|---|---|---|---|---|---|
| 숏폼 signed upload | 대용량 영상이 Server Action body 로 유입(413 위험) | 서명 티켓 발급→Storage 직접 업로드→hidden `videoRef` 만 finalize 전달 | `lib/community/communityShortformActions.ts` · `ae4a645` | 계약테스트(티켓·ref 검증) | 완료 |
| 대용량 File 혼입 구조 차단 | File 이 FormData 로 실릴 수 있는 구조 | picker input 에 `name` 미지정 + `shortformSubmitFields.ts` 가 허용키 10종 문자열만 추출(`formDataHasBinaryEntry` 감사) | `components/community/CommunityShortformComposeForm.tsx`·`lib/community/shortformSubmitFields.ts` · `0390417` | `shortformSubmitFields.contract.test.ts` 7케이스 | 완료 |
| 파일명 중복 표시 | 선택 파일명이 2곳 중복 렌더 | 미리보기 1줄로 정리 | 동일 폼 · `0390417` | 계약테스트·수동 확인 | 완료 |
| draft/publish intent 보존 | busy 재렌더 중 intent 변질 가능 | hidden intent + `resolveShortformIntent(getAll)` 첫 유효값 — JS 활성/비활성 양경로 보존 | 동일 폼 · `0390417` | 계약테스트 | 완료 |
| 업로드 멱등·보상 삭제 | 중복 제출 시 다중 행·고아 Storage 객체 | requestId 멱등키 + DB 실패·replay·교체 시 신규 영상 보상 삭제 | `communityShortformActions.ts` · `ae4a645`·`0390417` | 계약테스트 | 완료 |
| 게시판·숏폼 발행 FormData 결함 (P0-3·P0-4) | 미디어 업로드 await 중 `disabled={busy}` 재렌더 → disabled 컨트롤은 FormData 제외 → 서버가 빈 title 수신, staged 객체 고아 | 텍스트류 `disabled`→`readOnly`, select/checkbox disabled 제거(제출 버튼·멱등 UNIQUE 로 이중제출은 계속 차단) | `CommunityBoardComposeForm.tsx`·`CommunityShortformComposeForm.tsx` · `1f8e382` | 실브라우저 Preview E2E 재발행 PASS | 완료 (후속 `0390417` 이 숏폼측 구조 보강) |
| 알림 생성 원자화 | 웹 best-effort 삽입(도메인 write 와 비원자) | `lib/notifications/notificationInsert.ts` 삭제·호출부 5파일 정리, SQL 157~159 AFTER 트리거로 대체(같은 트랜잭션·event_key 멱등) | `5f9640b`(웹 제거)·`8926395`(SQL) | staging fixture 24/24 · 현재 트리 `insertNotification` 잔존 0 | 완료 (앱 레벨→DB 트리거로 **교체**) |
| 알림 읽음·딥링크·카테고리 | — (유지 대상) | 본인 스코프 읽음·`mark_all_notifications_read` RPC, 내부 경로만 허용하는 딥링크(`safeInternalNextPath`), 카테고리 정리 | `lib/notifications/notificationReadActions.ts`·`notificationDeepLink.ts`·`notificationCategories.ts` | Preview E2E P1-8A/P2-26 PASS | 완료 |
| 멘토 프로필 서류·인증 분리 (P2-24) | 아바타 교체와 인증 서류 흐름 혼재 | 아바타↔서류 분리, 민감 서류 URL 비노출 | Preview E2E 검증 항목 | E2E PASS | 완료 |
| 질문방·첨부·답변 알림 | 다단계 쓰기·비원자 알림 | `qna_*` 원자 RPC 계열 + question_answered 트리거 발행 | `docs/audit/p1-8a_question_room_rpc_plan.md` 계열 SQL·앱 전환(§6) | E2E 실 domain write→알림 수신·읽음·딥링크 PASS | 완료 |
| 앱 전용 숏폼 표면 | 앱에서 웹 전역 셸·결제 경로 노출 위험 | `/app/community/shortform/new`(무chrome)+`/app/bridge/complete`(kind·result 서버 enum, 무효값 404)+`/app/bridge/error`(입력 미반사) | `app/app/**` · `ae4a645`·코어 `abf9c81` | 계약테스트 + 로컬 런타임 부정경로 | 완료 |
| app-session bootstrap | 앱→웹 세션 주입 수단 부재 | `POST /api/app-session/bootstrap` — Content-Type allowlist→크기→필수필드→target enum→프로젝트 ref→setSession→getUser→계정 게이트→role 순 검증, redirect 는 서버 상수만(open redirect 0), 그 외 메서드 405 | `app/api/app-session/bootstrap/route.ts` · `ae4a645`→`101f255`→`0627bf5` | 계약테스트 33+ · 로컬 런타임 재실측 | 완료 (2단계 하드닝으로 **수렴**) |
| 쿠키 버퍼·실패 Set-Cookie 0 | 실패 응답에도 쿠키 부착 위험 | `pendingCookies` 격리 버퍼 — 전 검증 통과한 성공 응답에만 부착, 실패 9종 Set-Cookie 0 실측 | 동일 라우트 · `101f255` | 로컬 런타임 9종 전부 0 | 완료 |
| 앱 표면 HttpOnly refresh 구조 (방식 A) | `@supabase/ssr` 전역 기본 httpOnly=false → 재발급 시 HttpOnly 하락 | `appSurfaceCookies.ts` 고정 속성(HttpOnly/Secure/Lax/Path=/, chunk 동일) + 앱 표면 전용 `createAppSurfaceClient` — 재발급·회전·삭제까지 동일 속성. 전역 웹 helper 불변경 | `lib/appSession/appSurfaceCookies.ts`·`lib/supabase/appSurfaceServer.ts` · `101f255` | 쿠키 계약테스트 12케이스 | 완료 |
| strict account fail-closed gate | 웹 `assertAccountActive` 는 fail-open — 앱 표면 보안 경계 불가 | `appSurfaceAccountGate.ts` 3층 구조 — status allowlist 정확히 2종(active·만료 suspended)만 통과, 삭제는 정본 `account_deletion_status_self` RPC 재사용(`write_blocked=false` 만 통과), 확인 불가=거부. bootstrap·작성 표면·티켓·finalize 배선 | `lib/appSession/appSurfaceAccountGate.ts` · `0627bf5` | table-driven 계약테스트 33케이스 | 완료 (전역 helper 불변경) |
| Toss self-fetch 제거 | success 페이지가 공개 URL(`NEXT_PUBLIC_SITE_URL`?localhost)로 자기 API 를 재호출 + 쿠키 문자열 재전달 | success 페이지·`/api/toss/confirm` 이 **같은 서버 코어**(`confirmCashTopupForCurrentUser`) 직접 호출 | `lib/toss/confirmCashTopupServer.ts`·`tossTopupCore.ts` · `b1c1d18` | 배선 스캔 계약테스트(사이트URL·쿠키·self-fetch 잔존 0) | 완료 (**교체**) |
| Toss 호출 전 검증 강제 | 검증 전 외부 승인 호출 가능 구조 | 입력형식→인증→orderId 파싱→소유자 일치→패키지 allowlist→secret 존재→(그제서야) Toss 승인→응답 status/orderId/금액 재검증→멱등 원장. 비인증·타인 orderId·형식오류·비허용 패키지에서 **Toss fetch 0회** | `lib/toss/tossTopupCore.ts`(포트 주입 순수 코어) · `b1c1d18` | 포트 카운터 계약테스트 15케이스 | 완료 |
| webhook 멱등·past_due 회귀 | (코어 병합 시 회귀 위험) | webhook 은 confirm 코어에 **병합하지 않음** — 서명 검증·DONE·`recordCashTopupFromTossOrder` 계약 불변(범위 내 커밋 0). past_due 간접 복구 회귀 4종(신규 적립 1회·복구 실패 무롤백·중복 멱등·RPC 오류 전파) 고정 | `app/api/toss/webhook/**`(불변)·회귀는 코어 테스트 · `b1c1d18` | 계약테스트 + 소스스캔 보호 | 완료 |
| 학생 가입 학년 필드 | `grade_level` 입력이 "소속학교 (선택)" 라벨로 오표기 → 학교명이 학년 컬럼에 저장 | 라벨 "학년 (선택)"·placeholder "예: 고1, 고2, 고3, 재수"·id `st-grade`. DB 무변경·기존 데이터 자동수정 0(의심 2건 집계만) | `components/auth/StudentSignupForm.tsx` · `4660964` | tsc·계약테스트 회귀 0 | 완료 |
| 가격 문서 정본화 | docstring 등에 구가격 잔존 | 카탈로그 표시가 29,900/84,900/174,900 · 밴드 min/권장/max(29,900~69,900 / 84,900~149,900 / 174,900~329,900) 정본 유지, docstring 예시 교정. 역사 스냅샷은 보존 | `lib/subscribe/subscribePlanCatalog.ts`·`mentorPlanPricing.ts` · `667275d` | 값 변경 없음(문서 정합화) | 완료 |
| eslint 0/0 | 38 error·66 warning | 구조 개선 방식(파생 리셋·useSyncExternalStore·구조 타입 등, disable 남발 없음 — img 2건만 사유 주석) | 59파일 · `8f10b3b` | eslint 0/0 | 완료 |

**계약테스트 현황(현재 트리)**: `lib/**/__contract__/` 7디렉토리·21파일·**117케이스**
(`npm run test:contract` = `node --test --experimental-strip-types`) — 이번 세션 실행
117/117 PASS.

---

## 5. DB·SQL 수정 사항 (157~166)

전 항목 staging(`lbeqxarxothkmzqvpudy`)에만 적용. production 은 미적용(런북 준비 문서만,
§9·§11 참조). 파일 번호 157~166 구간은 중복 없음 — 레거시 번호 중복(002·032·033·034·
039·053/053b·073/073b)은 저장소 저부에만 존재하며 **재번호하지 않았다**(manifest 원칙).
127은 결번(중복 아님).

| SQL | 목적 | 주요 객체·계약 | staging 적용 | fixture/assertion | 후속 보정 |
|---|---|---|---|---|---|
| 157 | 구독 4종 알림 원자화 | 표시 헬퍼 4종 + `sbe_notify_billing_event`·`sub_notify_expired` 트리거 — 도메인 write 와 같은 트랜잭션, `(recipient,event_key)` UNIQUE 멱등, SECURITY DEFINER·search_path 고정 | 2026-07-20 | 구조 assertion 11종 + 공동 fixture 24/24 PASS | 헬퍼 ACL 은 160 이 수렴 |
| 158 | 멘토 4종 알림 원자화 | `mp_notify_activity_transition`·`refund_notify_mentor_termination`·`mplan_notify_price_changed` — 동일 tx 다중 tier 는 `txid_current()` 로 학생당 1건, 환불 금액 cents÷100 교정 | 2026-07-20 | fixture B 절 PASS | 166 시드 INSERT 가 이 트리거를 발화시킴(158 자체는 무수정) |
| 159 | 맞춤의뢰 2종 알림 원자화 | `cra_notify_new_application`·`com_notify_new_order_message` — 자기지원·제3자 무발화, event_key 멱등 | 2026-07-20 | fixture C 절 PASS | — |
| 160 | 157 헬퍼 EXECUTE 권한 수렴 | 객체 변경 없이 `notification_display_name`·`notification_mentor_label` 의 anon/authenticated EXECUTE revoke(기본권한이 부여한 노출 표면 차단) | 2026-07-20 | ACL=postgres/service_role 확인 + fixture 재실행 24/24 PASS | production 적용 시 **157과 한 세트**(런북 명시) |
| 161 | 계정 탈퇴 self RPC 3종 | `account_deletion_request_self`·`cancel_self`·`status_self` — `auth.uid()` 단독·advisory lock 직렬화, raw RPC 는 service_role 전용 유지 | 2026-07-21 | T1~T4+S1~S5 전부 PASS(2세션 동시성 실측은 PENDING — 단일 트랜잭션 한계) | — |
| 162 | 모바일 최소 앱버전 정책 | `mobile_app_version_policies` + `get_mobile_app_version_policy` — build 정수 정본, store_url HTTPS+스토어 호스트 CHECK, 행 부재 시 비차단(min=1) | 2026-07-21 | T1~T4+S1~S4 전부 PASS | — |
| 163 | 게시판 댓글 legacy↔정본 브리지 | 매핑 컬럼+동기화 함수 4종+`comments_write_guard` — GUC 재귀 방지·양방향 멱등·soft-delete 만 | 2026-07-21 | 양 테이블 0행(백필 불필요)·T1~T2+S1~S8 PASS | **164 로 수렴** |
| 164 | 163 교차 수정·삭제 수렴 | 함수 4종 교체(163 파일 무수정)+`cc_write_guard` 신설 — 포인터 우선 FOR UPDATE·post/author 정합·새 행 금지·DELETE 0행=명시 실패 | 2026-07-21 | 결함 A/B/C 선행 재현 확정 후 T1+F1~F15+baseline 전부 PASS | — |
| 165 | 숏폼 학생 직접 INSERT 우회 제거 | 레거시 INSERT 정책 **정확히 2건**(`"멘토만 업로드"`·`sp_write_self`) DROP — permissive OR 결합 우회 차단. canonical `sf_insert_mentor` 부재 시에만 멱등 생성, UPDATE 2·DELETE 1 정책·favorites·storage 불변 | 2026-07-24 | 적용 전 우회 재현(rollback-only)→적용 후 학생 REJECTED:42501·멘토 ALLOWED·정책 수 일치·baseline 복원 전부 PASS | `sp_update_self` 완화는 범위 밖 존치(별도 결정) |
| 166 | 멘토 최초 승인 시 기본 요금제 시드 | `mp_seed_default_plans_on_approval` + AFTER UPDATE 트리거 — 아래 상세 | 2026-07-24 | S1~S5a 전부 PASS + 새 트랜잭션 baseline 일치 | — |

**SQL 166 상세.**
- **발화 조건(정확한 계약)**: `approved→approved` 일반 재저장은 **미발화**(S5a 실증).
  `non-approved→approved` 재승인은 **발화**하되 `ON CONFLICT (mentor_id, plan_tier)
  DO NOTHING` 으로 **누락 tier 만 INSERT** — 기존 tier 의 가격·cap·label·활성 상태는
  UPDATE 하지 않는다(S2: 재승인 시 premium 만 시드, 커스텀 limited 3,500,000 보존).
- **SQL 067 유래 인덱스**: manifest 원문 — "SQL 067 유래 기존 유니크 인덱스
  `uq_mentor_plans_mentor_tier` 실존·정의 검증 PASS(unique·비partial·(mentor_id,
  plan_tier)) — **SQL 166 에 의한 staging index 신규 생성 0**". 오정의·중복 발견 시
  DROP 없이 `SQL166_ABORT` 중단하는 사전검증 설계(부재 환경에서만 방어 생성).
- **기본 tier 3종**: limited 2,990,000 cents/cap 1.0 · standard 8,490,000/2.5 ·
  premium 17,490,000/4.5(label NULL·is_active true) — CLAUDE.md 권장가 잠금값과 정합.
- **backfill 0**: 기존 승인 멘토 2명은 이미 tier 3종 보유 — 소급 시드 없음(조회 보고만).
- **가격 알림 회귀**: 시드 INSERT 에 대한 SQL 158 `mplan_notify_price_changed` fan-out 은
  구독자당 정확히 1건(S2 — type=`mentor_subscription_price_changed`, 과다 발화 없음),
  최초 승인(구독자 0)은 알림 0(S1). SQL 158 은 무수정.
- **baseline 복원**: 새 트랜잭션 대조 — plans 6(승인 멘토 2명×3)·notifications/outbox/
  subscriptions 0·fixture 사용자 0·트리거 1·인덱스 1.
- 권한: SECURITY DEFINER + `search_path=public` + EXECUTE 전량 revoke
  (ACL=postgres/service_role).

---

## 6. 앱 수정 사항

| 영역 | 수정 전 문제 | 최종 구현 | 테스트 | 상태 |
|---|---|---|---|---|
| 질문방 원자 RPC 전환 | thread 생성·메시지·전이·사용량이 다단계 쓰기 → 실패 시 빈 thread | `qna_create_question_thread`·`qna_append_message`·`qna_confirm_thread`·`qna_flag_wrong_answer` 단일 트랜잭션 RPC (`f52105e`·`69763dd`) | `test/data/`·`test/screens/` 6파일 | 완료 |
| 첨부 보상 삭제·멱등 | 유령 첨부·중복 등록 | `qna_register_attachment` 등록 실패 시 고아 객체만 보상 DELETE, `23505` 는 동일 시도 확인 후에만 멱등 수용 | `attachment_upload_rpc_test.dart` | 완료 |
| 계정 상태 fail-closed | `account_deletion_jobs` 직접 SELECT(403) → **전 로그인 차단 P0** | self RPC `account_deletion_status_self` 게이트웨이로 교체, 확인 불가=차단 유지 (`cd558cf`) | `test/auth/` 2파일 + 실서버 E2E | 완료 |
| 탈퇴 self RPC·UX | 직접 DML·취소 UX 부재 | SQL 161 self RPC 위임 + 요청·취소 화면(실삭제는 웹) (`5ce8489`·`79322f6`) | `account_deletion_test.dart` | 완료 |
| 최소버전 게이트 | 구버전 강제 수단 없음 | build 정수 비교 — 강제(차단)/권장(닫기 가능)/통과, `currentBuild==null` fail-open, `package_info_plus` (`0856f1e`) | `test/version_gate/` 7파일 | 완료 |
| 댓글 canonical cutover | 레거시 `community_comments` 단독 | canonical `comments` 전환(SQL 163/164 브리지가 레거시 미러) (`dbeb0ab`) | `comments_contract_test.dart` 등 4파일 | 완료 |
| 알림 17종 매핑 | 부분 문자열 매칭·비정본 모델 | `NotificationEventType` 17종 exact-code(정본 카운트 17) (`591d55e`) | `notification_classify_test.dart` | 완료 |
| 알림 keyset cursor | offset 페이징 | (created_at,id) keyset — CR 게이트 필터가 cursor 앞에 적용돼 경계 중복·누락 0 (`591d55e`·`031a869`) | `cr_gate_test.dart` 경계 검증 | 완료 |
| 알림 설정 저장 | 저장 불완전 | 정직한 그룹 저장, 라벨 `개별질문 알림`(서버 key `order` 호환 유지) | `notification_settings_repository_test.dart` | 완료 |
| CR 알림 미노출 (게이트 OFF) | 맞춤의뢰 2종 노출 | `kGatedNotificationTypeCodes={new_order_message,new_application}` exact 비교·DB 조회 단계 제외 — 서버 17종 계약·producer 불변, 필터 칩·딥링크 미추가 (`031a869`) | `cr_gate_test.dart` 6케이스 | 완료 (푸시 발신 정책은 §11) |
| Firebase·FCM | 웹 초기화 promise 누수 | 수신 전용 게이트웨이·토큰 등록/철회·`POST_NOTIFICATIONS`, 웹은 초기화 자체 생략 (`c5075b0`·`fececa3`) | `test/push/` 3파일 | 코드 완료 — **설정 파일 부재로 휴면** |
| 안전한 딥링크 | 임의 URL 실행 위험 | 탭 수준 고정 목적지(questionRoom/IQ/myPage/stay), 서버 link 의 `/wallet/charge` 미추종 (`c5075b0`) | `test/deeplink/` 2파일 | 완료 |
| 숏폼 재생·좋아요·찜 | 재생 불가·반응 미배선 | `video_player` 포트 실재생 + reaction/scrap 토글 (`5efc1ce`) | `shortform_detail_test.dart` | 완료 |
| 숏폼 작성 WebView | 앱 내 작성 수단 없음 | `shortform_create` 단일 목적 WebView — bootstrap POST(토큰은 form body 만), host exact-match allowlist·4경로 제한, SAF 단일 영상 chooser, `/app/bridge/complete` intercept·pop, draft pop 후 mounted 가드 (`d9c26f9`) | `test/web_bridge/` 2파일 + entry 테스트 | 완료 |
| WebView allowlist·쿠키 위생 | — | `/subscribe`·`/wallet/charge` 명시 차단, 세션 쿠키 위생 모듈 (`d9c26f9`) | `web_session_hygiene_test.dart` | 완료 |
| 찜한 멘토 scope | 찜 목록 진입 수단 없음 | `전체/찜한 멘토` 세그먼트(웹 `?scope=favorite` 동일 의미), 상태모델 분리, 비로그인 시 전체 복귀 (`003bdc5`) | `mentors_screen_scope_test.dart` 등 3파일 | 완료 |
| 멘토 찾기 검색·과목·정렬 | 최신 N명 창에서만 검색 | 공개 멘토 전체(상한 200) 대상 검색/필터/정렬, `MentorSubject` 3분리(한글 label/canonical key/raw) — `수학`+`math` 중복 제거 (`b645752`) | `test/mentors/`·`subject_restrict_test.dart` | 완료 |
| 리뷰 역할 게이트 | 범용 `리뷰 작성` 행 전 역할 노출 | 행 폐기 — 멘토에게만 `받은 리뷰`→웹 `/mentor/reviews`, 인앱 컴포저 없음 (`d5394c0`) | `support_section_review_gate_test.dart` 5케이스 | 완료 |
| 마이페이지 알림 메뉴 | push 라우트 위에서 탭 전환 무반응(숨은 index 만 변경) | pop-with-result(AppTab)→HomeShell 실제 탭 전환, `받은 질문 보기` 동일 수정 (`d5394c0`) | `mypage_navigation_test.dart` 4케이스(실화면 전환) | 완료 |
| 버튼 색 위계 | 멘토 테마에서 액션 CTA 가 초록 | 액션 CTA 고정 파랑 #2563EB(역할 무관), 멘토 정체성 초록 AppAccent #059669 는 배지·탭·장식 전용 (`7b3f4bc`) | `action_button_color_test.dart` | 완료 |
| 학생 학년 바인딩 | (웹 라벨 오표기와 짝) | 앱 바인딩은 `grade_level` 로 이미 정상 — 라벨·초깃값·payload 를 테스트로 고정 (`d5394c0`) | `profile_grade_field_test.dart` | 완료 (코드 변경 없음) |
| 오프라인·lifecycle·pagination·signed URL | dispose 후 setState·만료 URL | 이미지 다운스케일·keyset paginator·mounted 가드·IQ 첨부 1h 재서명 캐시 (`e324527`) | `community_paginator_test.dart` 등 4파일 | 완료 |
| 게시판 작성기 | 구 문서가 "웹 전용·앱은 열람만"으로 오기록 | **앱 네이티브 작성기 유지**(제거·WebView 전환·대규모 재설계 금지). 숏폼 작성만 WebView 브릿지 — 정본 `docs/RELEASE_SCOPE_DECISIONS_2026-07.md` §3(`c2163a8` 정정), `FEATURE_AUDIT.md` §8 수렴(`7c0134e`) | 실서버 E2E 게시판 왕복 PASS | 완료 (제품 결정) |
| 개별질문(IQ) 지원 | 구 문서가 "앱 범위 밖"으로 오기록 | **앱 지원 기능** — 목록·상세(학생·멘토 화면, 하단 5번째 탭)·멘토 답변·첨부(전용 버킷+1h 재서명 캐시)·학생 환불·알림 라우팅(개별질문 탭·필터 칩·설정 그룹). 학생 신규 작성(캐시 예치) 진입점만 스토어 결제정책 검토 완료까지 기본 off(A안, `kIndividualQuestionCreateEnabled`). 캐시충전·결제·구독 시작은 웹 전용 (`d6e8213`·문서 정정 `7c0134e`) | `iq_attachment_url_resolver_test.dart`·`iq_detail_url_cache_test.dart` 등 | 완료 (작성 진입점은 컴파일 타임 flag) |
| 앱 내 결제 경로 0 | — | 결제 SDK 의존성 0(pubspec 실측)·`kInAppPaymentSteeringEnabled=false`·`CommerceNoticeCard` 비상호작용·`/wallet/charge`·`/subscribe` 앱 내 열기 0(전부 차단 컨텍스트) | grep·계약 실측 §10 | 완료 (Commerce-Zero) |

---

## 7. QA 에서 실제로 발견한 결함 (실브라우저·실서버·실기기 QA)

단위·위젯 테스트가 아니라 **실환경 검증이 잡아낸** 결함만 별도 정리한다.

| # | 결함 | 발견 경로 | 최종 수정 |
|---|---|---|---|
| 1 | **게시판·숏폼 발행 항상 실패 (P0-3·P0-4)** — 미디어 업로드 대기 중 disabled 재렌더로 title 등이 FormData 에서 제외 | 실브라우저 Preview 인증 E2E(신규 계정)에서 발행 실패 재현 | **수정** web `1f8e382` → 재발행 PASS 관찰. 후속 `0390417` 구조 보강 |
| 2 | **앱 전 로그인 차단 P0** — 계정상태 3단계가 GRANT 없는 `account_deletion_jobs` 직접 SELECT → 403 → fail-closed 로 전원 차단 | 앱 실서버 왕복 E2E(chromedriver, staging) — 계약 모사 단위테스트로는 미검출 | **수정** app `cd558cf`(self RPC 교체) |
| 3 | 웹 Firebase 초기화 unhandled promise 누수(E2E 존 오염) | 동일 앱 실서버 E2E | **수정** app `fececa3`(웹은 초기화 생략) |
| 4 | 숏폼 임시저장(draft) pop 후 async-after-dispose 크래시 위험 | session3 검증·코드 리뷰 | **수정** app `d9c26f9` mounted 가드 + `e324527` lifecycle 하드닝 |
| 5 | **주입된 E2E 계정 자격증명 실패** — 3계정 `invalid_credentials`(주입 비밀번호↔DB 해시 불일치) | 1차 Preview E2E 세션 | 코드 결함 아님 — **환경 부채**(오너 재설정 필요). 계정 데이터는 원상 유지 |
| 6 | **관리자 GoTrue 500** — 직접 SQL 시드된 관리자 계정의 auth 토큰 컬럼 4종이 `''` 아닌 NULL → Go 스캔 오류 | 2차 Preview E2E(관리자 로그인) | 제품 결함 아님 — `TEST_ACCOUNT_SETUP_BLOCKED`. 수정 SQL 템플릿·정규화 스크립트는 **별도 브랜치**(`claude/admin-account-creation-5zql3q`, PR #45)에 준비, 이번 범위에선 계정 미수정 |
| 7 | 파일명 중복 표시·File 혼입 가능 구조·intent 변질(숏폼 잔여 3종) | QA 재검(v16 후속 지시) | **수정** web `0390417` |
| 8 | 마이페이지 알림 행 무반응(+`받은 질문 보기`) — push 라우트 위 탭 전환 결함 | QA 4차 실사용 검증 | **수정** app `d5394c0` |
| 9 | 리뷰 메뉴 역할 오노출(범용 `리뷰 작성` 행) | QA 4차 | **수정** app `d5394c0` |
| 10 | CR 게이트 위반 — 맞춤의뢰 알림 2종 노출 | QA 4차 | **수정** app `031a869`(DB 단계 exact 제외) |
| 11 | 버튼 색 위계 — 멘토 테마 액션 CTA 초록 | QA 4차 | **수정** app `7b3f4bc` |
| 12 | 학년 필드 학교명 오표기(웹 가입 폼 라벨) — 기존 학생 2건 의심 데이터 | QA 4차 + staging 집계(건수만) | **수정** web `4660964`(카피만). 기존 데이터는 자동수정 0 — 오너 결정 대기 |
| 13 | Toss success localhost self-fetch·검증 순서 결함 | QA 4차 코드 감사 | **수정** web `b1c1d18` |
| 14 | `shortform_posts` RLS 학생 INSERT 우회(레거시 정책 2건) | staging RLS 실조회 감사 | **수정** SQL 165(`62db3b0`) — 적용 전 우회 재현 후 제거 확인 |
| 15 | 댓글 브리지 교차 수정·삭제 수렴 실패(163 결함 A/B/C — 미러 수정 시 중복 행·soft-delete 실패·원본 미반영) | staging rollback-only 재현 fixture | **수정** SQL 164(`7387382`) — F1~F15 PASS |

실기기(Android/iOS) QA 는 미실행(READY_NOT_EXECUTED) — 실기기가 잡을 결함은 아직 관측
범위 밖이다.

---

## 8. 테스트·검증 증거 (전부 이번 조사에서 재확인한 실측값)

| 항목 | 값 | 근거 |
|---|---|---|
| 웹 lint (`npm run lint`) | 오류 0 | 이번 세션 실행 |
| 웹 `npx eslint .` | 0 error·0 warning | 이번 세션 실행(수렴 커밋 `8f10b3b`) |
| 웹 `npx tsc --noEmit` | 오류 0 | 이번 세션 실행 |
| 웹 build | 성공 | 이번 세션 실행 |
| 웹 계약테스트 | **117/117 PASS** (21파일·7디렉토리) | 이번 세션 실행 + 현재 트리 정적 카운트 일치 |
| 앱 `flutter analyze` | 0 error·0 warning·info 71(=baseline) | 이번 세션 실행 + CI step |
| 앱 `flutter test` | **685/685 PASS** (test/ 116파일) | 이번 세션 실행 + CI step |
| 앱 CI (코드 최종 `19a6228` 계열) | run [30089832159](https://github.com/byite-co/ssambership-app/actions/runs/30089832159) **전체 success** — analyze ✅ · test ✅ · **appbundle step 개별 outcome ✅**(비게이트·continue-on-error 이지만 실제 성공) · AAB 아티팩트 업로드 ✅ · 게이트 판정 ✅. 문서 정정 커밋 `c2163a8` run [30091272915](https://github.com/byite-co/ssambership-app/actions/runs/30091272915)도 success | GitHub Actions 실조회 |
| 앱 CI (**최종 HEAD `7c0134e` — 최종 CI**) | run [30091864230](https://github.com/byite-co/ssambership-app/actions/runs/30091864230) **completed·success** (12:06~12:15Z) — analyze ✅ · test ✅ · **appbundle step 실제 outcome ✅**(비게이트지만 성공) · AAB 아티팩트 업로드 ✅ · 게이트 판정(analyze+test 필수 그린) ✅ | GitHub Actions 실조회 (완료 후 기재) |
| Vercel Preview (웹 HEAD `d127255`) | deployment `dpl_Bxxzr8ceCppNhbeYAMApURvBTLWF` — **READY**, PR #42 combined status success | Vercel·GitHub 실조회 |
| staging fixture | SQL 157~166 전 항목 PASS·rollback-only·baseline 복원(§5 표) | `docs/audit/sql_apply_manifest.md` |
| 웹 Preview 인증 E2E | 학생 PASS · 멘토 PASS · 관리자 DEFERRED(계정 문제, §7-6) — P0-3·P0-4·P2-24·P1-8A/P2-26·P2-27 핵심 경로 PASS, baseline 복원 확인 | `preview_e2e_run_20260720(b).md`·checkpoint |
| 앱 실서버 E2E | staging 왕복(로그인→게시판→댓글) PASS, P0 1건 발견·수정(§7-2) | `docs/APP_V16_E2E_REPORT.md`(`86c8651`) |
| READY_NOT_EXECUTED | Toss 성공 E2E · 실기기 QA(Android/iOS) · FCM 실수신 · 관리자 QA · shared refresh lineage 장시간 · 다건 알림 cursor 실데이터 E2E | §11 분류 |

CI AAB 는 파이프라인 증빙 아티팩트(`allowInsecureSigning` opt-in)로 **Play 제출물이
아니다** — 아래 §9.

---

## 9. 릴리스 산출물 이력

기준: Android 이력에 `com.example` 계열 package 는 존재한 적 없다(git 전수 검색 0건) —
"build 1 은 package 오류" 라는 통용 서술의 실체는 아래와 같다.

| build | 코드 시점 | Android package | 상태 |
|---|---|---|---|
| 1 (0.1.0+1) | 기저(`7c5ebb8` 이전) | `com.ssambership.app` | Play Console 이 기대하는 `com.ssambership.edu` 와 불일치 → **업로드 거부**. `7c5ebb8` 가 applicationId·namespace·MainActivity 를 edu 로 수렴 |
| 2 (0.1.0+2) | `50cc8c9` | `com.ssambership.edu` | 업로드되어 versionCode 2 소모 → **superseded**(재업로드 시 "이미 사용됨" 거부 — `54e2a67` 기록) |
| 3 (0.1.0+3) | `54e2a67` | `com.ssambership.edu` | **내부 테스트 트랙 업로드됨** — 근거는 저장소 기록(`c28a270` 커밋 메시지·문서). Play Console 직접 확인은 이번 조사에서 미수행 |
| 4 (0.1.0+4) | `c28a270`(현재 코드) | `com.ssambership.edu` | 다음 업로드용 증가분. **Play Console 업로드 여부 = 미확인**(저장소·CI 만으로 판단 불가, Console 접근 없음) |

- **CI artifact ≠ Play 제출물**: flutter-ci 의 appbundle step 은 `allowInsecureSigning`
  opt-in 파이프라인 검증용이며 워크플로 자체에 "제출용 아님" 명시. 제출용 signed AAB 는
  release keystore(저장소 부재 — gitignore, 오너 로컬 전용)로만 생성 가능하고,
  `c18496c` 가 release 서명 부재 시 fail-fast 를 걸어 debug 서명 AAB 오업로드를 차단한다.
- **Firebase 포함 여부(소스 vs 산출물 구분)**: 앱 **코드에는** firebase_core/
  firebase_messaging 수신 전용 통합이 완료돼 있으나, 저장소에 `google-services.json`
  (Android)·`GoogleService-Info.plist`(iOS)가 **없다**. 따라서 이 저장소에서 빌드된
  산출물(CI AAB 포함)에는 Firebase 설정이 포함되지 않고 FCM 은 휴면이다. build 3 도
  해당 시점 저장소에 설정이 없었으므로 미포함(`추정` — 오너 로컬 빌드에서의 별도 주입
  여부는 확인 불가). **Firebase 활성화에는 설정 파일 배치 + plugin 적용 + 새 versionCode
  재빌드가 필요하다.**
- keystore·`key.properties`·`.env` 의 실제 값·경로 내 비밀정보·인증서 fingerprint 는
  본 보고서에 기록하지 않는다.

---

## 10. 불변·보안 확인 (실측)

| 항목 | 결과 |
|---|---|
| 앱 결제 의존성 | **0** — pubspec 에 in_app_purchase/Toss/Play Billing/PG SDK 없음 |
| 앱 결제 WebView | **0** — WebView 는 `shortform_create` 단일 목적, `isAllowedNavigation` 이 `/subscribe`·`/wallet/charge` 명시 차단 |
| `/wallet/charge`·`/subscribe` 앱 연결 | **0** — `lib/` 내 등장 전부 차단·allowlist 주석 컨텍스트, 앱 내 열기 호출 0. `kInAppPaymentSteeringEnabled=false`, `CommerceNoticeCard` 비상호작용 |
| service_role 앱·클라이언트 노출 | **0** — 앱 표면 게이트는 authenticated self RPC(`account_deletion_status_self`) 재사용, service_role 은 서버 전용 |
| production 접근 | **0** — DB 조회·SQL 적용·배포 승격 전부 staging(`lbeqxarxothkmzqvpudy`) 한정 |
| 시크릿 커밋·출력 | **0** — 토큰·비밀번호·anon key·keystore 값 미기록(본 보고서 포함) |
| force-push / PR merge / draft 해제 | **0 / 0 / 0** — 일반 push 만, PR #42·#33 draft 유지 |
| 민감 서류 URL 앱 노출 | **0** — 웹 전용(아바타↔서류 분리 P2-24), 앱 표면 미노출 |
| 외부 URL allowlist | WebView host exact-match + 4경로 제한, 딥링크는 탭 수준 고정 목적지만 |
| 실패 시 cookie | **0** — bootstrap 실패 응답 9종 Set-Cookie 0 실측, 쿠키는 전 검증 통과 성공 응답에만 부착 |
| RLS·RPC 최종 정본 | 숏폼 INSERT 정책 1(canonical `sf_insert_mentor`)·전체 5, 알림 트리거 SECURITY DEFINER+search_path 고정+EXECUTE 최소화(160), self RPC 3종 authenticated, 승인 시드 함수 EXECUTE 전량 revoke |

---

## 11. 남은 작업 (코드 완료 항목과 외부 작업을 섞지 않음)

| 항목 | 상태 | 비고 |
|---|---|---|
| Firebase Android/iOS 설정 파일 배치(+plugin 적용) | `WAITING_EXTERNAL_CONFIG` | 코드는 완료(수신 전용). 배치 후 **재빌드 필요** |
| FCM 실수신 검증 | `READY_NOT_EXECUTED` | 위 설정 선행 필요 |
| Android/iOS 실기기 QA | `READY_NOT_EXECUTED` | 체크리스트 문서 준비됨 |
| 관리자 QA | `READY_NOT_EXECUTED` + `WAITING_OWNER_INPUT` | 관리자 계정 auth 토큰 컬럼 정규화(운영자 조치, PR #45 준비물) 선행 |
| shared refresh lineage 장시간 검증 | `READY_NOT_EXECUTED` | `SHARED_REFRESH_LINEAGE_READY_NOT_EXECUTED` — 절차 런북 기록 |
| Preview 인증 성공경로(Toss 충전 성공 E2E) | `READY_NOT_EXECUTED` | `TOSS_SUCCESS_E2E_READY_NOT_EXECUTED` — 오너는 Vercel 에 키를 등록했으나 **이번 실행 세션에서 test 접두사·환경값을 안전하게 조회할 수단이 없고 QA 자격증명도 미주입** + egress·Deployment Protection 차단. 절차는 런북에 준비 |
| production SQL 적용(122~166) | `WAITING_OWNER_INPUT` | 런북·순서 계약 준비 완료, 실적용 금지 유지 |
| release keystore 서명·Play 제출 | `WAITING_EXTERNAL_CONFIG` | 오너 로컬 전용(저장소에 서명물 없음) |
| 앱 build 4 Play 업로드 여부 | `WAITING_OWNER_INPUT`(확인 요청) | 저장소·CI 만으로 판단 불가 — **미확인** |
| staging 테스트 데이터 정리 | `COMPLETE` | 전 fixture rollback-only·baseline 복원 실측(§5) |
| 기존 학생 grade_level 정리(의심 2건) | `WAITING_OWNER_INPUT` | 자동 수정 0 — 건수만 집계 |
| CR 알림 서버 푸시 발신 정책 | `WAITING_OWNER_INPUT` | 저장소·CI 산출물로는 배포 빌드의 Firebase 포함 여부 확인 불가 — **Firebase 활성 AAB 에서는 트레이 노출 가능성** 있음("실영향 없음" 단정 금지). 게이트 2종의 발신 여부 결정 필요 |
| 가격 손익분기 재계산 | `WAITING_OWNER_INPUT` | living 손익분기 문서 부재 — 재계산 입력값 필요 시 `RECALC_INPUT_REQUIRED` |
| 163 초기 브리지 함수 4종 | `SUPERSEDED` | SQL 164 가 교체(163 파일 자체는 보존) |
| 웹 best-effort 알림 발송 코드 | `SUPERSEDED` | SQL 157~159 트리거로 대체·삭제 완료 |

---

## 12. 최종 상태표

| 영역 | 코드 완료도 | 검증 완료도 | 현재 상태 | 출시 전 조치 |
|---|---|---|---|---|
| 웹 | 완료 | lint/tsc/build/계약 117·Preview E2E(학생·멘토) PASS | PR #42 draft·Preview READY | Toss 성공 E2E·관리자 QA |
| DB(staging) | 완료(157~166 적용) | fixture·assertion 전부 PASS·baseline 복원 | 정본 상태 | — |
| DB(production) | 적용물 준비 완료(런북) | **미적용·미검증(정상)** | 오너 승인 대기 | 런북 순서대로 적용 + 사전 진단 재실행 |
| 앱 | 완료(0.1.0+4, `com.ssambership.edu`) | analyze 0/0·test 685/685·CI green·실서버 E2E PASS | PR #33 draft | 실기기 QA |
| Firebase/FCM | 코드 완료(수신 전용) | 실수신 미검증 | **설정 파일 부재 — 휴면** | 설정 배치→재빌드→실수신 검증 |
| Android 실기기 | (코드는 앱 열과 동일) | 미실행 | READY_NOT_EXECUTED | 실기기 QA 수행 |
| iOS 실기기 | (코드는 앱 열과 동일, bundle `com.ssambership.app`) | 미실행 | READY_NOT_EXECUTED | 실기기 QA + Firebase iOS 설정 |
| 관리자 QA | 웹 콘솔 코드 완료 | DEFERRED(계정 문제) | TEST_ACCOUNT_SETUP_BLOCKED | 관리자 계정 토큰 정규화 후 수행 |
| Play Store | build 4 코드 준비 | build 3 내부 테스트 업로드 기록·**build 4 업로드 미확인** | 오너 확인 대기 | signed AAB 생성·업로드(오너 로컬) |

### 최종 판정

## `V16_COMPLETE_WITH_SCOPED_VALIDATION_DEBT`

계획된 웹·DB·앱 코드 작업과 staging 검증은 전부 완료됐고 미해결 코드 결함은 없다.
남은 것은 범위가 명시된 검증 부채(Toss 성공 E2E·실기기 QA·FCM 실수신·관리자 QA·
shared refresh lineage)와 외부 조치(Firebase 설정·production SQL·Play 제출·오너
결정 4건)뿐이며, 각각 §11 의 상태로 추적된다.
