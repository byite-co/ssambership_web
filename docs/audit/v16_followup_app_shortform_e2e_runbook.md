# v16 후속 — 앱 숏폼 인앱 작성 + 찜 scope E2E 재실행 런북 (2026-07-24)

> 대상: PR #42(웹, head `ae4a645`) × PR #33(앱, head `c28a270`) · staging `lbeqxarxothkmzqvpudy` 전용
> 상태: **READY_NOT_EXECUTED** — 코드·계약테스트·로컬 런타임 부정경로 검증은 완료. 아래 2개 환경 blocker 로
> 이번 실행 컨테이너에서는 인증 성공경로·실기기 E2E 만 미실행.

## 이번 세션에서 실측된 blocker

1. **실행 컨테이너 네트워크 egress 정책**: `*.supabase.co` · `ssambership.com` · `vercel.app` 아웃바운드 차단
   (프록시 403). → staging 로그인(토큰 발급)·Preview 접속이 필요한 모든 성공경로 검증 불가.
   같은 이유로 로컬 `next start` 에서도 bootstrap 성공경로(`auth.setSession→getUser`)는 진행 불가.
2. **Vercel Deployment Protection**: Preview 딸린 요청이 `vercel.com/sso-api` 302 로 보호됨(실측).
   앱 WebView 는 Vercel SSO 를 통과할 수 없으므로 다음 중 하나 필요:
   - 프로젝트 설정에서 Deployment Protection 을 Production 전용으로 변경(권장, 테스트 동안 한시), 또는
   - Protection Bypass for Automation 시크릿 발급 후 최초 진입 URL 에
     `?x-vercel-protection-bypass=<secret>&x-vercel-set-bypass-cookie=true` 부여
     (bootstrap 은 POST 최초 요청이므로 bypass 쿠키 선설정용 GET 진입이 별도로 필요할 수 있음 — 보호 해제가 단순).
   - 우회 시크릿/공유 토큰은 로그·문서·커밋 금지.

이번 세션에서 로컬(`next start`, 빌드 산출물)로 **실검증 완료**한 항목: GET/PUT/PATCH/DELETE 405(+`Allow: POST`,
`Cache-Control: no-store`), Content-Type allowlist 거부, invalid target 거부, 타 프로젝트 JWT 거부(bootstrap_failed),
토큰 URL/본문 반사 0, 브릿지 kind/result enum(유효 200/무효 404), 오류 페이지 미지 code 고정 폴백(입력 반사 0),
세션 없는 `/app/community/shortform/new` → `session_expired` redirect, 앱 표면 HTML 결제/네비 링크 0.

## 재실행 절차 (blocker 해소 후)

사전: staging 멘토/학생 테스트 계정(비밀번호 보유) 준비. Preview 는 stable branch alias 사용:
`https://ssambership-web-git-claude-web-app-fixes-bug-rollb-ed5c0c-byite.vercel.app`
(Preview 환경변수 `NEXT_PUBLIC_SUPABASE_URL` ref = `lbeqxarxothkmzqvpudy` — 2026-07-20 인증 Preview E2E 실주행 기록으로 확인,
변경했다면 재확인).

### A. 웹 단독 — bootstrap 성공경로·쿠키 속성 (curl)

```bash
BASE=https://ssambership-web-git-claude-web-app-fixes-bug-rollb-ed5c0c-byite.vercel.app
SUPA=https://lbeqxarxothkmzqvpudy.supabase.co
# 1) 토큰 발급 (값은 파일로만 — 출력·기록 금지)
curl -s "$SUPA/auth/v1/token?grant_type=password" -H "apikey: $ANON_KEY" -H "Content-Type: application/json" \
  -d '{"email":"<멘토테스트계정>","password":"<비밀번호>"}' > /tmp/tok.json
AT=$(jq -r .access_token /tmp/tok.json); RT=$(jq -r .refresh_token /tmp/tok.json)
# 2) bootstrap 성공: 303 + Location=/app/community/shortform/new + Set-Cookie(HttpOnly; Secure; SameSite=Lax) + no-store
curl -s -o /dev/null -D - -X POST "$BASE/api/app-session/bootstrap" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "access_token=$AT" --data-urlencode "refresh_token=$RT" \
  --data-urlencode "target=shortform_create" | grep -iE "^HTTP|^location|^set-cookie|cache-control"
# 3) 쿠키로 작성 표면 200 (무크롬·폼 렌더): -c/-b 쿠키자 유지
# 4) 학생 계정 토큰으로 2) 반복 → 303 후 작성 표면 접근 시 /app/bridge/error?code=mentor_only
# 5) session refresh 후 속성: 1시간 뒤(또는 만료 강제) 동일 쿠키로 서버 액션 호출 시 재발급 쿠키의
#    HttpOnly 유지 여부 확인 — 전역 기본(@supabase/ssr 0.10.2 httpOnly=false)으로 내려가면
#    라우트 주석에 문서화된 '부트스트랩 발급분 한정 강화' 한계가 실측 확인되는 것(기능 저하 없음).
```

### B. 앱 실기기/에뮬레이터 E2E (섹션 8 시나리오)

```bash
# 내부 테스트 앱은 staging .env 사용. WEB_BASE_URL 은 검증된 stable Preview alias 로 주입.
flutter run --dart-define=WEB_BASE_URL=https://ssambership-web-git-claude-web-app-fixes-bug-rollb-ed5c0c-byite.vercel.app
```

1. 멘토 로그인 → 커뮤니티 > 숏폼 탭: 상단 `숏폼 작성` CTA 확인(학생 계정은 미노출 확인)
2. CTA → WebView: bootstrap POST(폼 인코딩) → 작성 표면(무크롬) 자동 진입 — 재로그인 없음
3. `영상 파일 선택` → 시스템 선택기(mp4) → 파일명 1줄 표시
4. 임시저장 → 앱 복귀 + '임시저장됐어요' → DB `shortform_posts` 1행(draft)·Storage 1객체 확인:
   `SELECT id,status FROM shortform_posts WHERE author_id='<uid>' ORDER BY created_at DESC LIMIT 3;`
5. 다시 작성 진입(draft 는 웹 `?draftId=` 로 이어짐 — 앱 신규 진입은 새 글) → 게시 → 피드 복귀·새 카드·재생 확인
6. 중복 0(더블탭·재시도 후에도 행/객체 수 불변), 교체 시 구 객체 삭제 확인
7. 멘토찾기: 하트 추가 → `찜한 멘토 N` scope → 검색/과목 교집합 → 해제 즉시 제외 → 앱 재시작 후 서버 상태 유지
8. 로그아웃→학생 로그인: 작성 CTA 미노출 + WebView 쿠키 미재사용(작성 재진입 시 학생이면 mentor_only 페이지)
9. 정리: 테스트 계정 소유 행만 삭제(`author_id`/`user_id` 한정) + Storage 동일 경로 객체 삭제 → baseline 재확인

## 판정 기록 위치
- 코드/계약 검증: PR #42 `lib/appSession/__contract__/*` · `lib/community/__contract__/shortformSubmitFields*` (85/85)
- 앱 단위/위젯: PR #33 `test/web_bridge/shortform_compose_bridge_test.dart` 외 (662/662)
