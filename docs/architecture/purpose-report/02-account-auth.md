# 02. 계정·인증·마이페이지 — 존재 목적 리포트

> 대상 라우트 11개 · 요소 행 90개(+자산 대조 34행) · 근거: 코드 실측 + 기획 정본

기획 기준(모든 추론의 축): 쌤버십은 학생/멘토/관리자 3역할 체제이며 가입으로 admin을 얻을 수 없다. 계정 레이어의 존재 목적은 (1) 역할을 가입 시점에 확정해 4개 거래 채널의 진입 경로를 가르고, (2) 멘토 인증(신뢰 인프라)의 원천 서류를 가입 단계에서 수집하며, (3) 가입 즉시 무료 질문권 7개(7일·멘토당 3개) 퍼널로 학생을 서비스 본체(구독 질문방)에 유입시키는 것이다. 만 14세 미만 법정대리인 동의 문구는 legal placeholder 상태(코드 상수 `MINOR_CONSENT_VERSION = "legal-placeholder-2026-06-20"`)로 사실 표기한다.

## 커버 라우트 (검증용 전수 목록)

route-inventory.txt 대조 결과(admin/login은 10번 파일 담당 — 제외):

| # | 라우트 | 바인딩 파일 | 형태 |
|---|--------|-------------|------|
| 1 | `/signup` | `app/signup/page.tsx` | 'use client' 페이지 (1005줄) |
| 2 | `/login` | `app/login/page.tsx` | Server Component |
| 3 | `/login/student` | `app/login/student/page.tsx` | Server Component |
| 4 | `/login/mentor` | `app/login/mentor/page.tsx` | Server Component |
| 5 | `/logout` | `app/logout/route.ts` | GET Route Handler |
| 6 | `/forgot-password` | `app/(public)/forgot-password/page.tsx` | Server Component + server action |
| 7 | `/auth/update-password` | `app/(public)/auth/update-password/page.tsx` | Server Component + 클라이언트 폼 |
| 8 | `/home` | `app/(student)/home/page.tsx` | redirect 전용 (6줄) |
| 9 | `/mypage` | `app/(student)/mypage/page.tsx` (+ `loading.tsx`) | Server Component |
| 10 | `/mentor/mypage` | `app/(mentor)/mentor/mypage/page.tsx` | Server Component (519줄) |
| 11 | `GET /api/mypage/active-subscriptions` | `app/api/mypage/active-subscriptions/route.ts` | API Route |

연결 자산 전수: `components/auth/` 21개 파일(icons 1 + illustrations 6 포함), `components/mypage/` 4개, `components/home/` 5개, `lib/auth/` 14개, `lib/mypage/` 2개, `lib/home/` 2개. 미사용·빈 파일은 문서 말미 "자산 전수 대조"에서 처리.

---

## 화면별 상세

### /signup — 회원가입 (`auth-signup`)

**바인딩**: app/signup/page.tsx ('use client', 1005줄) — `Suspense`로 감싼 `SignupPageContent`. 하위: `AuthPageLayout`(signupLayout), `SignupStepBar`, `StudentSignupForm`, `MentorSignupForm`, `SignupTrustBlock`, `MentorSubjectCheckboxes`.

**화면의 존재 목적**: 역할(학생/멘토)을 가입 시점에 비가역적으로 확정하는 단일 관문. 학생은 무료 질문권 7개 퍼널의 시작점이라 최소 입력(닉네임·생년월일)으로 마찰을 줄이고, 멘토는 신뢰 인프라(대학 인증)의 원천 서류(학생증)를 가입 단계에서 곧바로 수집해 관리자 승인 큐(`verification_status: "pending"`)로 넘긴다. 만 14세 미만 학생에게는 법정대리인 동의 게이트를 세운다. 가입 성공 시 `supabase.auth.signUp` metadata(`buildSignupUserMetadata`) + 세션 존재 시 `syncAfterSignUpWithSession`으로 `users`/`mentor_profiles` upsert와 `student-id-images` 버킷 업로드까지 수행한다.

#### 공통 프레임 (모든 스텝)

| 요소 (표시 라벨) | 종류 | 소스 | 연결 동작 | 추론한 존재 목적 |
|---|---|---|---|---|
| "← 이전으로" | 링크 | page.tsx headerPrefix | `/` 이동 | 가입 이탈 시 랜딩 복귀 경로 확보 |
| "회원가입" | h1 | AuthPageLayout title | — | 화면 정체성 고지. 스텝별 설명문(`stepDescription`)이 부제로 교체됨 |
| "1. 역할 선택 / 2. 정보 입력 / 3. 가입 완료" | 스텝바 | SignupStepBar (3개 반복) | 현재 스텝 강조, 완료 스텝 "✓" | 3단계 진행률 시각화로 가입 중도 이탈 방지 |
| (에러 배너, role="alert") | 조건부 문단 | page.tsx `error` state | 검증/서버 오류 첫 메시지 표시 | `alert()` 금지 규칙 하의 인라인 오류 피드백 |
| "안내 사항" 카드 | 정보 카드 | SignupTrustBlock | 본문 내 "개인정보처리방침" 링크 → `/legal/privacy` | 멘토 인증 절차·스팸메일 주의 사전 고지로 문의 감소 (step 3에서는 숨김) |
| "안전한 연동" 카드 | 정보 카드 | SignupTrustBlock | — | 계정·첨부 파일 보안과 비밀번호 8자 정책 고지 |
| "이미 계정이 있으신가요? 로그인" | 링크 | page.tsx 하단 (step≠3) | `/signup` → `/login` | 중복 가입 방지·기존 사용자 분기 |

#### STEP 1 — 역할 선택 (학생/멘토 분기 결정)

| 요소 (표시 라벨) | 종류 | 소스 | 연결 동작 | 추론한 존재 목적 |
|---|---|---|---|---|
| "어떤 계정으로 가입하시나요?" | h2 | page.tsx step 1 | — | 역할 선택이 가입의 첫 결정임을 명시 |
| "학생으로 가입" 카드 | 선택 버튼(aria-pressed) | `SignupRoleChoiceCard role="student"` | `setRole("student")`, 선택 시 파란 링·체크 아이콘 | 학생 트랙 진입. 혜택 3줄("가입 시 무료 질문권 7장 제공"·"무료 질문은 한 멘토당 최대 3개"·"질문방·맞춤의뢰를 한곳에서 관리")로 무료 질문권 퍼널 소구 — 기획 정본(7개·멘토당 3개)과 일치 |
| "멘토로 가입" 카드 | 선택 버튼(aria-pressed) | `SignupRoleChoiceCard role="mentor"` | `setRole("mentor")`, 선택 시 초록(#059669) 링 | 멘토 트랙 진입. 혜택 3줄("질문방 관리 및 답변 작성"·"요금제 직접 설정"·"정산 확인 및 수익 관리")로 수익 활동 소구 |
| (혜택 불릿) | li ×3 | `signupRoleBenefits[role].map()` — 카드당 3개 반복 | — | 역할별 가치 제안 요약 |
| "다음 — 정보 입력" | 버튼 | page.tsx `goNext()` | role 미선택 시 disabled + 에러 "학생 또는 멘토를 선택해 주세요.", 선택 시 `setStep(2)` | 역할 확정 후에만 폼 진입 허용하는 게이트 |

#### STEP 2 — 공통 헤더 (역할 재확인)

| 요소 (표시 라벨) | 종류 | 소스 | 연결 동작 | 추론한 존재 목적 |
|---|---|---|---|---|
| "선택한 가입 유형" + "학생"/"멘토" | 정보 카드 | page.tsx (role 존재 시) | — | 어떤 폼을 채우는지 재확인시켜 역할 착오 가입 방지 |
| "← 역할 다시 선택" | 버튼 | `goBackToRoleSelect()` | step 1 복귀 + 보호자 동의 상태 초기화 | 역할 변경 퇴로. 미성년 동의 상태를 리셋해 잔존 동의 오염 방지 |
| "1단계에서 가입 유형이 선택되지 않았어요." + "역할 선택으로" | 조건부 경고 + 버튼 | page.tsx (`!role` 시) | step 1 복귀 | 비정상 상태(직접 step 2 도달) 복구 (추정: 방어적 렌더링) |

#### STEP 2 — 학생 폼 (role === "student" 조건부)

섹션 aria-label "학생 회원가입 폼", 헤더 "학생 회원가입" / 킥커 "Student signup".

| 요소 (표시 라벨) | 종류 | 소스 | 연결 동작 | 추론한 존재 목적 |
|---|---|---|---|---|
| "로그인에 쓰는 계정" | h3 + 부제 "이메일과 비밀번호는 이후에도 그대로 사용돼요." | page.tsx | — | 계정 vs 프로필 입력 구획 분리 |
| "이메일 *" | input[type=email] `#sg-email-student` | page.tsx | `studentEmail` state. 검증: 공백/형식(`signupValidation`) | Supabase Auth 로그인 식별자 수집 |
| "비밀번호 *" | input[type=password] `#sg-pw-student` | page.tsx | `SIGNUP_PASSWORD_MIN_LENGTH=8` 미만 시 에러 | 계정 자격 증명. 8자 정책은 `signupValidation` 정본 |
| "비밀번호 확인 *" | input[type=password] `#sg-pw2-student` | page.tsx | 불일치 시 "비밀번호가 서로 일치하지 않습니다.", 정상 시 힌트 "8자 이상, 영문·숫자 조합을 권장해요." | 오타로 인한 계정 잠금 예방 |
| "닉네임 *" (placeholder "서비스에 표시될 호칭") | input `#st-nick` | StudentSignupForm | 힌트 "멘토·학생에게 노출되는 이름이에요." 필수 검증 | 커뮤니티·질문방 공개 표시명. 실명 대신 닉네임으로 학생 보호[^4] |
| "생년월일 *" | input[type=date] `#st-birth-date` (max=오늘) | StudentSignupForm | 힌트 "만 14세 미만 여부를 확인하기 위한 필수 정보입니다." `minorAgeGate.isUnderMinimumSignupAge`(만 14세) 판정 → 보호자 동의 블록 토글 | 미성년 게이트의 입력 원천. 미래 날짜·형식 오류 검증 포함 |
| "소속학교 (선택)" (placeholder "재학·출신 고등학교") | input `#st-school` | StudentSignupForm | `gradeLevel` state → DB `grade_level` 저장[^3] | 멘토 탐색 카드·프로필 노출용 배경 정보 (선택 입력으로 마찰 최소화) |
| "필수 — 서비스 이용약관 및 개인정보 수집·이용에 동의합니다." | 체크박스 1개(연동) | `termsBlock("sky", …)` | 한 체크가 `termsAgree`+`privacyAgree` 동시 세팅. 미동의 시 "필수 약관(이용·개인정보)에 모두 동의해 주세요." | 법적 필수 동의 수집. `NEXT_PUBLIC_LEGAL_TERMS_URL`/`_PRIVACY_URL` 있으면 "이용약관"·"개인정보처리방침" 새 창 링크 노출[^5] |
| "선택 — 이벤트·혜택 알림 수신에 동의합니다." | 체크박스 | termsBlock | `marketingAgree` → metadata `marketing_agreed` | 마케팅 수신 동의를 필수와 분리(정보통신망법 구도) |
| "보호자 동의 안내(초안)" | 링크 | termsBlock 하단 상시 문구 "만 14세 미만은 보호자 동의 절차가 필요할 수 있어요." | `/legal/minor-consent` | 미성년 정책 사전 고지 — "(초안)" 표기로 placeholder임을 화면에서도 사실 표기 |
| "학생으로 가입하기" | 제출 버튼 | page.tsx `handleSignUp("student")` | 검증 → `supabase.auth.signUp` → 세션 있으면 sync 후 step 3, 없으면 `/login/student?message=signup-check-email`로 replace | 가입 확정. 이메일 인증 필요 여부에 따라 두 갈래 후처리 |

##### STEP 2 학생 — 미성년(만 14세 미만) 보호자 동의 (조건부: `role==="student" && (minorConsentPrompt || isUnderMinimumSignupAge(birthDate))`)

| 요소 (표시 라벨) | 종류 | 소스 | 연결 동작 | 추론한 존재 목적 |
|---|---|---|---|---|
| "04 · 보호자 동의" / "보호자 동의 필요" | 섹션 헤더 | `minorGuardianConsentBlock` + `MINOR_CONSENT_COPY` | — | 만 14세 미만 법정대리인 동의(개인정보보호법 제22조의2 구도) 게이트 — 기획 정본 항목 |
| "만 14세 미만 가입자는 법정대리인 동의가 필요합니다. 아래 문구와 본인확인 방식은 법무 확정 후 교체됩니다." | 설명문 | MINOR_CONSENT_COPY.description | — | placeholder 상태의 사실 고지 |
| "법무 확정 대기 항목" + 슬롯 3줄("보호자 동의 고지 문구"·"보호자 신원확인 방식"·"동의 항목 및 버전 문구") | 점선 박스, li ×3 반복 | `MINOR_CONSENT_COPY.legalSlots.map()` | — | 법무 확정 후 교체될 자리를 화면에 명시 (문구 확정 전 오해 방지) |
| "법정대리인에게 가입 및 개인정보 처리 동의를 받았습니다." | 체크박스 | minorGuardianConsentBlock | `guardianConsentAgree`. 미체크 제출 시 "만 14세 미만 가입자는 보호자 동의가 필요합니다." + metadata `guardian_consent`/`consent_version="legal-placeholder-2026-06-20"`/`guardian_verification_method="legal_review_pending"` 기록 | 자기신고형 동의 증적. 검증 방식 미확정이라 placeholder 상수로 버전 봉인 |

#### STEP 2 — 멘토 폼 (role === "mentor" 조건부)

섹션 aria-label "멘토 회원가입 폼", 헤더 "멘토 회원가입" / 킥커 "Mentor signup". 계정 3필드(이메일 `#sg-email-mentor` / 비밀번호 `#sg-pw-mentor` / 비밀번호 확인 `#sg-pw2-mentor`)는 학생과 동일 구조·검증이므로 생략하지 않고 1행으로 요약한다.

| 요소 (표시 라벨) | 종류 | 소스 | 연결 동작 | 추론한 존재 목적 |
|---|---|---|---|---|
| "이메일 *" / "비밀번호 *" / "비밀번호 확인 *" | input ×3 (학생과 동일 검증) | page.tsx | `mentorEmail`/`mentorPassword`/`mentorPasswordConfirm` — 학생 폼과 state 분리 | 역할 카드 간 브라우저 autofill·입력 혼선 방지를 위한 별도 state (추정) |
| "멘토는 대학(재) 인증이 이어집니다. 제출·보관·삭제는 쌤버십·약관·정책 및 서버·파일 저장소 보안 설정에 따릅니다." | 안내문 | MentorSignupForm 상단 | — | 인증 서류 제출 전 보관·삭제 정책 고지 |
| "1 · 기본 / 표시 이름" — "닉네임 *" (placeholder "멘티가 보는 이름") | input `#m-nick` | MentorSignupForm | 필수 검증 "닉네임을 입력해 주세요." | 학생에게 노출될 멘토 표시명 |
| "소개 한 줄 (선택)" (placeholder "예: 수학 개념을 차근차근 잡아드려요") | input `#m-intro` | MentorSignupForm | `intro_line` → mentor_profiles | 멘토 카드 첫인상 문구 — 멘토 찾기 전환율 자산 |
| "2 · 학력 / 대학·고교 정보" — "대학교 *" (placeholder "캠퍼스·분교") | input `#m-uni` | MentorSignupForm | `university_name` (mentor_profiles 정본 컬럼) | 인증 심사·멘토 탐색 필터의 핵심 신뢰 데이터 |
| "학과 *" (placeholder "단과·전공") | input `#m-dept` | MentorSignupForm | `department_name` | 전공 적합성 탐색 축 |
| "출신고교 *" (placeholder "가입·프로필에 반영") | input `#m-hs` | MentorSignupForm | `high_school_name` 필수 | 학생과의 접점(출신고) 매칭 신호 |
| "3 · 전문 분야 / 전공 과목" — "담당 과목 *" | 체크박스 아코디언 | `MentorSubjectCheckboxes` (subjectCatalog 정본, 대분류 `details` N개 반복 · 소분류 체크박스 반복) | 선택 code Set → csv 직렬화(`teachingSubjectsCsv`) → `teaching_subjects` 배열 저장. 힌트 "가르치는 과목을 모두 선택하세요. 대분류를 펼쳐 세부 과목을 고를 수 있어요." | 자유 텍스트 대신 정본 코드 선택으로 과목 데이터 정규화 — 탐색 필터 품질 담보 |
| "4 · 인증 / 학생증 / 재학증명서" — "학생증 업로드 *" ("클릭해 파일을 선택" / "JPG, PNG, PDF — 정면이 선명하도록, 글씨가 읽혀요.") | 파일 드롭존(input[type=file], accept jpg/png/pdf) `#m-student-id` | MentorSignupForm | 선택 시 "선택됨: {파일명}" 표시. 제출 후 `syncAfterSignUpSession`: magic bytes 검증(`validateJpgPngPdfMagicBytes`) → 비공개 버킷 `student-id-images` 업로드 → `mentor_profiles.student_id_image_url` 갱신 | 멘토 인증(신뢰 인프라)의 원천 증빙. 확장자 위장 차단을 위해 매직바이트까지 검사, 버킷은 public=false 정책 |
| "멘토로 가입하기" | 제출 버튼 | `handleSignUp("mentor")` | 검증(6필드+파일+약관) → signUp → `mentor_profiles` upsert `verification_status: "pending"` | 가입과 동시에 관리자 승인 큐 진입 — "가입으로 admin 부여 불가" 원칙 하에서 멘토도 승인 전 활동 제한[^1] |
| (약관 블록, tone "emerald") | 체크박스 2 + 링크 | `termsBlock("emerald", …)` | 학생과 동일한 `termsAgree`/`privacyAgree`/`marketingAgree` state 공유 | 필수·선택 동의 수집 (색 톤만 멘토 그린) |

#### STEP 3 — 가입 완료 (completedRole 조건부)

| 요소 (표시 라벨) | 종류 | 소스 | 연결 동작 | 추론한 존재 목적 |
|---|---|---|---|---|
| "가입을 환영합니다!" | 완료 카드(role="status") | page.tsx step 3 | — | 세션 확보 가입(이메일 인증 불요 환경)의 종착 화면 |
| "이제 멘토를 찾아 질문·학습을 시작해 보세요." + "멘토 찾기" | 문구+CTA (completedRole==="student") | page.tsx | `/mentors` | 무료 질문권 7개 퍼널의 첫 행동을 멘토 탐색으로 유도 |
| "관리자 승인 전까지 멘토 활동은 대기 상태입니다. 프로필을 먼저 작성해 주세요." + "프로필 관리" | 문구+CTA (completedRole==="mentor") | page.tsx | `/mentor/profile/edit` | 승인 대기 시간을 프로필 보강에 쓰도록 유도[^2] |

---

### /login — 로그인 유형 선택 + 듀얼 로그인 (`auth-login-landing`)

**바인딩**: app/login/page.tsx (Server) → `LoginDualRolePanel`('use client') → `LoginRoleCard` ×2 → `RoleLoginForm`. `?next=`를 `initialNext`로 전달.

**화면의 존재 목적**: 학생/멘토를 한 화면에 나란히 세워 역할별 로그인 폼을 동시 제공한다. 역할별 카드가 각각 독립 email/password state를 갖고(`activeRole`이 아닌 카드는 fieldset disabled) 브라우저 autofill이 두 폼에 번지는 것을 차단한다. 로그인 성공 후 `profile.role`을 서버 정본(`public.users`)에서 재확인해 화면 역할과 불일치하면 즉시 signOut — 역할별 내비게이션 잠금값을 로그인 단계에서부터 강제한다.

| 요소 (표시 라벨) | 종류 | 소스 | 연결 동작 | 추론한 존재 목적 |
|---|---|---|---|---|
| (브랜드 로고) + "로그인" + "학생·멘토 계정을 선택하고 이메일로 들어가세요." | 헤더 | page.tsx, `BrandLogo`(01 공용 사전 참조 — 여기선 랜딩 복귀 링크) | 로고 → `/` | 진입 정체성·역할 선택 안내 |
| "학생 로그인" 카드 / "멘토 로그인" 카드 | article ×2 | LoginRoleCard (`loginLandingCopy`) | hover/focus 시 `onActivate`로 활성 전환(활성 카드만 입력 가능) | 역할별 폼 동시 노출 + 오입력 방지 |
| (혜택 불릿) 학생: "가입 시 무료 질문권 7장 제공"·"무료 질문은 한 멘토당 최대 3개"·"여러 멘토에게 나눠서 사용 가능" / 멘토: "질문방 관리 및 답변 작성"·"연결노트·콘텐츠 작성 및 업로드"·"정산 확인 및 수익 관리" | li ×3 반복(카드당) | `benefitLines(role).map()` ← loginRoleContent.ts | — | 로그인 화면에서도 역할 가치 리마인드 (무료 질문권 정책 기획 정본과 일치) |
| "이메일" (placeholder "name@example.com") | input[type=email] `#login-email-student`/`#login-email-mentor` | RoleLoginForm | autoComplete `section-{role} email` | 자격 증명 입력. section- 접두로 카드 간 autofill 격리 |
| "비밀번호" | input[type=password] `#login-pw-student`/`#login-pw-mentor` | RoleLoginForm | autoComplete `section-{role} current-password` | 자격 증명 입력 |
| "비밀번호를 잊으셨나요?" | 링크 | RoleLoginForm | `/forgot-password` | 재설정 플로우 진입 |
| "로그인" | 제출 버튼 | RoleLoginForm `handleSubmit` | `signInWithPassword` → email_confirmed_at 없으면 signOut+"이메일 인증이 아직 완료되지 않았습니다…" → 프로필 role 검사 → `resolvePostLoginPath(next, role)` 계산 후 150ms 뒤 `window.location.assign` (쿠키 레이스 회피용 전체 문서 네비게이션) | 인증 + 역할 검증 + 안전한 next 복귀를 한 번에 처리 |
| "회원가입이 접수됐어요. 이메일을 열고 인증 링크를 눌러 주시면…" | 조건부 안내(role="status") | RoleLoginForm (`?message=signup-check-email`) | — | 가입 직후 이메일 인증 대기 사용자를 위한 후속 안내 |
| "이 화면은 멘토 계정 전용이에요. 학생 계정이면 학생 로그인을 이용해 주세요." (반대 문구 포함) | 조건부 notice(파란 톤, role="status") | RoleLoginForm 역할 불일치 분기 | signOut 후 표시 | 역할 혼동을 에러(빨강)가 아닌 안내 톤으로 교정 |
| (error/success 배너) | 조건부 문단 | RoleLoginForm | `mapSupabaseAuthError`/"로그인에 성공했습니다. 이동합니다." | 인증 실패 한국어화·성공 전환 안내 |
| "계정이 없으신가요? 학생 회원가입/멘토 회원가입" | 링크 | LoginRoleCard 하단 | `/signup` | 미가입자 분기 |

### /login/student · /login/mentor — 역할 고정 로그인 (`auth-login-role`)

**바인딩**: app/login/student/page.tsx · app/login/mentor/page.tsx (각 40줄, Server) → `LoginSingleRoleCard`(LoginDualRolePanel.tsx 내 export, 항상 active·내부 state).

**화면의 존재 목적**: 가드(`requireRole`)와 가입 후속 리다이렉트의 착지점. `loginPathFor()`가 학생 → `/login/student`, 멘토 → `/login/mentor`로 보내므로, 보호 라우트에서 튕긴 사용자가 자기 역할 폼만 보게 해 재로그인 마찰을 줄인다. `?next=` 를 보존해 원래 목적지로 복귀시킨다.

| 요소 (표시 라벨) | 종류 | 소스 | 연결 동작 | 추론한 존재 목적 |
|---|---|---|---|---|
| "← 유형 선택으로" | 링크 | 각 page.tsx | `/login?next=…` (next 보존 인코딩) | 역할 착오 시 듀얼 화면 복귀, 목적지 손실 방지 |
| (브랜드 로고) | 링크 | BrandLogo (01 공용 사전 참조) | `/` | 랜딩 복귀 |
| (단일 역할 카드 전체) | LoginSingleRoleCard | 위 /login 카드와 동일 요소 세트(혜택 3불릿·이메일·비밀번호·"비밀번호를 잊으셨나요?"·"로그인"·"계정이 없으신가요?") | role prop만 고정 | 코드 재사용으로 듀얼/싱글 화면 동작 일치 보장 |

### /logout — 로그아웃 (`auth-logout`)

**바인딩**: app/logout/route.ts (GET, 8줄).

**화면의 존재 목적**: UI 없는 세션 종료 엔드포인트. `supabase.auth.signOut()` 후 `/` 로 redirect — 어떤 화면에서든 `<a href="/logout">` 한 줄로 로그아웃을 연결할 수 있게 한 최소 인터페이스.

| 요소 (표시 라벨) | 종류 | 소스 | 연결 동작 | 추론한 존재 목적 |
|---|---|---|---|---|
| (GET /logout) | Route Handler | route.ts | `signOut()` → `NextResponse.redirect("/")` | 세션 파기 + 랜딩 복귀. 화면 요소 없음 |

### /forgot-password — 비밀번호 재설정 요청 (`auth-forgot-password`)

**바인딩**: app/(public)/forgot-password/page.tsx (Server) + server action `requestPasswordResetAction`(lib/auth/passwordResetActions.ts, "use server"). 레이아웃 `AuthPageLayout`(noCard·loginLayout) + `LoginPageFooter`.

**화면의 존재 목적**: 이메일 기반 재설정 링크 발송(`supabase.auth.resetPasswordForEmail`, redirectTo = `{NEXT_PUBLIC_SITE_URL 또는 호스트 추론}/auth/update-password`). 결과를 쿼리스트링(`?sent=1`/`?error=…`)으로 되돌려 서버 컴포넌트만으로 상태 표시를 완성 — 클라이언트 JS 의존 없는 복구 플로우.

| 요소 (표시 라벨) | 종류 | 소스 | 연결 동작 | 추론한 존재 목적 |
|---|---|---|---|---|
| "← 로그인 유형 선택" | 링크 | headerPrefix | `/login` | 플로우 이탈 경로 |
| "비밀번호 재설정" + "가입에 사용한 이메일을 입력하면 재설정 링크를 보내 드립니다." | h1+설명 | AuthPageLayout | — | 목적 고지 (모바일 축약문 병행) |
| "요청을 접수했습니다. 메일함(스팸 포함)에서 링크를 확인한 뒤…" | 조건부 배너(role="status") | `?sent=1` | — | 발송 완료 확인. 계정 존재 여부를 노출하지 않는 중립 문구 (추정) |
| (에러 배너: "이메일을 입력해 주세요." / "…NEXT_PUBLIC_SITE_URL…확인해 주세요." / 디코딩된 서버 오류) | 조건부 배너 | `?error=empty_email\|missing_site_url\|…` | — | 실패 원인별 복구 안내. 운영 환경변수 미설정까지 화면에서 진단 |
| "이메일" (placeholder "name@example.com") | input[type=email] `#fp-email` required | form | server action으로 POST | 재설정 대상 계정 식별 |
| "재설정 메일 보내기" | 제출 버튼 | form action=`requestPasswordResetAction` | 발송 후 `?sent=1` redirect | 재설정 트리거 |
| "학생 로그인 \| 멘토 로그인" | 링크 ×2 | page.tsx 하단 | `/login/student` · `/login/mentor` | 비밀번호가 기억난 사용자의 즉시 복귀 |
| (푸터: "쌤버십/SsamBership" · "이용약관" · "개인정보처리방침" · "고객센터" · "안전한 결제 시스템" 카드) | LoginPageFooter | env URL 있으면 외부 링크, 없으면 `/legal/*`·`/support#contact` 폴백 | — | 공개 페이지 신뢰 표식. 결제·정산 문구는 신뢰 인프라 소구 |

### /auth/update-password — 새 비밀번호 설정 (`auth-update-password`)

**바인딩**: app/(public)/auth/update-password/page.tsx (Server 프레임) + `UpdatePasswordClient`('use client').

**화면의 존재 목적**: 재설정 메일의 recovery 링크로 생성된 임시 세션에서만 동작하는 비밀번호 교체 폼. `supabase.auth.updateUser({ password })` 성공 시 1.2초 뒤 `/login/student` 로 강제 이동시켜 새 자격 증명으로 재로그인을 유도한다.

| 요소 (표시 라벨) | 종류 | 소스 | 연결 동작 | 추론한 존재 목적 |
|---|---|---|---|---|
| "← 로그인" | 링크 | headerPrefix | `/login` | 이탈 경로 |
| "비밀번호 변경" + "이메일로 받은 재설정 링크를 통해 접속한 경우에만 아래 폼이 동작합니다." | h1+설명 | AuthPageLayout | — | recovery 세션 전제 조건 고지 |
| "새 비밀번호 설정" + "메일의 링크로 이 페이지에 들어온 경우에만 정상 동작합니다. 링크가 만료되었다면 비밀번호 찾기를 다시 요청해 주세요." | 카드 헤더 | UpdatePasswordClient | — | 링크 만료 시 행동 지침 |
| "새 비밀번호" | input[type=password] `#np1` (minLength 8) | UpdatePasswordClient | 8자 미만 시 "비밀번호는 8자 이상으로 설정해 주세요." | 가입과 동일한 8자 정책 유지 |
| "새 비밀번호 확인" | input[type=password] `#np2` | UpdatePasswordClient | 불일치 시 "비밀번호 확인이 일치하지 않습니다." | 오타 방지 |
| "비밀번호 저장" | 제출 버튼 | `updateUser({ password })` | 성공 시 "비밀번호가 변경되었습니다. 잠시 후 로그인 화면으로 이동합니다." → `/login/student`[^6] | 자격 증명 교체 확정 |
| "메일을 못 받았나요?" | 링크 | UpdatePasswordClient 하단 | `/forgot-password` | 재발송 루프 |
| (err/msg 배너) | 조건부 문단 ×2 | state | `mapSupabaseAuthError` 한국어화 | 인라인 피드백 (alert 금지 규칙) |

### /home — (구) 학생 대시보드 리다이렉트 (`student-home-redirect`)

**바인딩**: app/(student)/home/page.tsx (6줄).

**화면의 존재 목적**: 코드 주석 원문 — "(구) 학생 대시보드 폐기 — 마이페이지로 일원화. 기존 링크·북마크는 여기서 흡수해 redirect." 학생 홈이 `/mypage`로 통합된 뒤 구 URL의 하위 호환만 담당한다.

| 요소 (표시 라벨) | 종류 | 소스 | 연결 동작 | 추론한 존재 목적 |
|---|---|---|---|---|
| (없음) | `redirect("/mypage")` | page.tsx | 즉시 이동 | 구 대시보드 URL 흡수 — UI 요소 0개 |

### /mypage — 학생 마이페이지 (`student-mypage`)

**바인딩**: app/(student)/mypage/page.tsx (Server, 253줄) + `loading.tsx`(스켈레톤 2블록) + `MypageSubscriptionsCard`('use client'). 데이터: `getServerUserWithProfile`(비로그인 시 `/login/student?next=/mypage` redirect), `loadStudentMypageBundle`, `countActiveSubscriptionsForStudent`, `fetchWalletBalanceByUserId`, `loadWalletChargePageData`, `individual_questions` 카운트.

**화면의 존재 목적**: 학생의 4개 거래 채널 사용 현황(질문방·구독·개별질문·의뢰/결제)과 결제·회계 인프라(캐시 잔액·원장 프리뷰)를 단일 허브로 집약한다. 학생 네비 잠금값의 "마이페이지" 슬롯 구현체이며, 각 카드가 해당 채널의 상세 라우트로 뻗는 분기점이다.

| 요소 (표시 라벨) | 종류 | 소스 | 연결 동작 | 추론한 존재 목적 |
|---|---|---|---|---|
| "마이페이지" 배지 + "내 학습과 결제를 한곳에서 확인하세요" | 헤더 | page.tsx | — | 허브 정체성 선언 |
| (아바타 이니셜 + "학생 프로필" + 표시명 + 이메일·학교 줄) | 프로필 카드 | page.tsx (`full_name→nickname→email` 폴백, `grade_level·student_status` 조합) | profileLoadError 시 앰버 경고 표시 | 로그인 계정·프로필 상태 확인 |
| "질문방 / 구독 / 개별질문 / 의뢰·결제" 지표 | dl 타일 ×4 (`.map()` 4개 반복) | roomCount·activeSubs·individual_questions 카운트·bundle.payments | — | 4개 거래 채널의 사용량을 숫자로 병렬 표시 (질문방=본체, 개별질문=단건, 의뢰=게이트 OFF 채널, 결제=회계) |
| "진행 중인 질문" + 힌트("구독하면 질문방이 여기 열려요." / "연결된 질문방 N개 · 최근 질문과 답변을 확인하세요.") | 섹션 | SectionTitle + roomText 분기 | 오류 시 "정보를 불러오지 못했습니다." | 서비스 본체(구독 질문방) 현황 요약. 0개 문구가 구독 퍼널로 넛지 |
| "질문방 바로가기" | CTA | page.tsx | `/question-room` | 본체 채널 진입 |
| "개별 질문 보기" | CTA | page.tsx | `/individual-questions` | 단건 에스크로 채널 진입 |
| "구독 현황" 카드 ("활성 구독 중인 멘토와 질문 한도를 확인하세요.") | 클라이언트 카드 | MypageSubscriptionsCard | `GET /api/mypage/active-subscriptions` fetch(no-store), 로딩 스켈레톤 2개 | 활성 구독을 클라이언트에서 지연 로드해 서버 렌더 본문을 가볍게 유지 (추정) |
| (구독 행: 멘토명+상태 배지+플랜 라벨+"현재 기간/다음 결제/남은 질문/질문 리셋" dl ×4) | article 반복 (`items.map()` N개) | SubscriptionRow ← `ActiveSubscriptionCard` | 상태 tone별 배지 색(active=파랑, scheduled/pastDue=앰버) | 구독별 질문 한도·결제 주기를 한 카드로 — 요금제(주4/주9/FUP) 소진 관리 |
| "질문하러 가기" | 행별 CTA | SubscriptionRow | `/question-room?mentorId=…` | 구독 → 질문 행동 직결 |
| "아직 구독 중인 멘토가 없어요" + "멘토 찾기" | 빈 상태 | MypageSubscriptionsCard (EmptyState 미사용, 자체 마크업)[^7] | `/mentors` | 무료 질문권 이후 구독 전환 넛지 |
| "다시 시도" + (Toast "닫기") | 오류 복구 버튼 + 커스텀 토스트(role="alert") | MypageSubscriptionsCard | 재fetch / 토스트 dismiss | window.alert 금지 규칙 하의 오류 피드백 |
| "구독 관리" / "멘토 찾기" | 하단 링크 ×2 | MypageSubscriptionsCard | `/subscriptions` · `/mentors` | 구독 CRUD·탐색 분기 |
| "결제·캐시" 카드 (잔액 "N 캐시" + "최근 내역" 최대 5행) | 우측 레일 섹션 | page.tsx ledgerPreview (`rows.slice(0,5).map()` 반복, `ledgerReasonLabel/ledgerAmountLabel`) | 입금 초록/출금 빨강 표기 | 캐시(1캐시=1원, balance_cents÷100) 잔액·원장 요약 — 결제 인프라 가시화 |
| "충전하기" / "사용내역 전체" | CTA ×2 | page.tsx | `/wallet/charge` · `/wallet/ledger` | 캐시결제 채널 진입 |
| "알림·지원·리뷰" 카드 ("알림 … 센터 →" / "고객지원 분쟁·환불 →" / "리뷰 · 신고" 카운트) | li ×3 | page.tsx + bundle metrics | `/notifications` · `/support/disputes` | 운영·신뢰 보조 기능의 진입점 묶음 |

### /mentor/mypage — 멘토 마이페이지 (`mentor-mypage`)

**바인딩**: app/(mentor)/mentor/mypage/page.tsx (Server, 519줄, `dynamic="force-dynamic"`). 첫 데이터 호출 `await requireRole("mentor")` — (mentor) layout 가드 + 페이지 중복 호출 규칙 준수. 데이터: `loadMentorHubDashboardData`, `mentor_profiles`(verification/activity), `cash_ledger` 월별 합산(`loadRecentMonthlyRevenue`, 최근 5개월·양수 delta만), `loadMentorCapUsage`, `loadMentorSubscribeOpen`, `listMentorReceivedReviews(…, 3)`.

**화면의 존재 목적**: 멘토의 통합 홈(로그인 기본 착지 `getPostLoginPath("mentor") = /mentor/mypage`). 수익(정산 예정 포함)·구독 수용량(cap)·평점이라는 멘토 활동의 3대 지표와, 인증 미완료 시 활동 제한 경고를 한 화면에 모은다. 맞춤의뢰 영역은 "곧 오픈 예정" 배지로 게이트 OFF 상태를 사실 표기한다.

| 요소 (표시 라벨) | 종류 | 소스 | 연결 동작 | 추론한 존재 목적 |
|---|---|---|---|---|
| (아바타 이니셜 + 표시명 + 인증 배지 "인증 완료"/"인증 검토중"/"인증 반려"/"미인증" + "후기 N개 · 평균 X.X") | ProfileHeader | `verificationLabel(verification_status)` 4상태 매핑 | — | 멘토 신뢰 상태(인증)와 평판을 첫 줄에 고정 |
| "승인 대기 중입니다." + "관리자 승인 완료 전에는 질문 답변, 맞춤의뢰 지원, 멘토 찾기 노출, 구독 받기가 제한됩니다.…" + "인증 상태 확인하기 →" | 조건부 경고 섹션 (`verification.tone !== "ok"`) | page.tsx | `/mentor/verification` | 미승인 멘토의 활동 제한 범위를 명시 — 인증 인프라의 UI 측 집행 |
| (활동 상태 컨트롤) | MentorActivityControls (01 공용 사전 참조 아님 — mentor 전용 클라이언트 컴포넌트) | `activity_status/pause_until/termination_effective_at` + `?ok/?error` 플래시 | 일시중지·해지 관련 조작 | 멘토 활동 상태 자기 관리 |
| (구독 오픈 토글) | MentorSubscribeOpenToggle | `loadMentorSubscribeOpen` | 구독 수신 on/off | cap 도달 전 자발적 모집 중단 수단 |
| "이번 달 수익 · N월" + 금액 "N 캐시" + "정산 내역 보기 →" | RevenueCard | revenuePanel.totalExpected | `/mentor/payouts` | 월 수익 요약 → 정산 상세 분기 |
| "진행 중 N / 정산 예정 N" | 보조 지표 ×2 | RevenueCard | — | "정산 예정" 통일 문구(기획 금지어 "정산 대기" 회피) 준수 |
| (월별 수익 차트) | MentorRevenueChart (recharts) | `loadRecentMonthlyRevenue` — cash_ledger 양수 delta_cents÷100, 5개월 버킷 0채움 | — | 수익 추세 시각화. RLS 실패 시 0 배열 폴백으로 UI 불파괴 |
| "진행 중 의뢰" + 배지 "곧 오픈 예정" | 섹션 헤더 | ActiveOrdersSection | — | 맞춤의뢰 게이트 OFF의 사실 표기 — 기획 정본과 일치 |
| "맞춤의뢰는 곧 오픈 예정이에요" / "서비스 준비가 끝나면 여기에서 의뢰를 확인하고 관리할 수 있어요" | 빈 상태 | EmptyOrders (EmptyState 공용 컴포넌트 미사용, 자체 마크업)[^7] | — | 게이트 OFF 중 기대 관리 |
| (의뢰 행: 학생 이니셜·제목·카테고리 배지·"최근 활동 …"·D-day 배지(임박 시 빨강)·상태 배지 + "바로가기 →") | article 반복 (`orders.map()` 최대 3) | OrderList ← MentorHubOrderRow | `order.workroomHref` | 게이트 ON 전환 시 진행 의뢰 3건 미리보기 (데스크탑/모바일 CTA 2벌) |
| "구독 학생" 카드 "N 명" | StatCard | kpis.activeSubscribers | — | 구독(본체 채널) 규모 지표 |
| "평균 평점" 카드 "X.X / 5.0" (+ "리뷰 N개 기준") | StatCard | ratingAvg (null이면 "—" 흐림) | — | 평판 지표 — 리뷰 인프라 연결 |
| "최근 후기" 카드 (★평점·날짜(`formatKoreanDate`)·마스킹된 학생명·본문 1줄) + "후기 전체보기 →" | 카드 + li 반복(`reviews.map()` 최대 3) | listMentorReceivedReviews | `/mentor/reviews` | 최신 평판 모니터링. 학생명 마스킹으로 개인정보 보호 |
| "구독 수용량" 카드 "N %" + 진행바 + "used/limit · 여유 있음/여유 적음/구독 마감" | CapStatCard | loadMentorCapUsage — 100%↑ 빨강, 80%↑ 앰버, 그 외 초록 | — | cap(1.0/2.5/4.5 잠금값) 소진율의 시각적 조기 경보 |

### GET /api/mypage/active-subscriptions — 활성 구독 API (`api-mypage-subscriptions`)

**바인딩**: app/api/mypage/active-subscriptions/route.ts + lib/mypage/studentActiveSubscriptions.ts(262줄).

**화면의 존재 목적**: `/mypage`의 `MypageSubscriptionsCard`가 소비하는 유일한 전용 API. 인증(401)·학생 역할(403, "학생 계정만 이용할 수 있습니다.") 게이트 후 `loadActiveSubscriptionsForStudent`로 구독 행 + 멘토 공개 프로필 + 플랜 tier + `subscription_usage_counters`(남은 질문)를 조인해 표시용 `ActiveSubscriptionCard[]`로 직렬화한다.

| 요소 (표시 라벨) | 종류 | 소스 | 연결 동작 | 추론한 존재 목적 |
|---|---|---|---|---|
| (JSON `{ok, items}` / `{ok:false, error}`) | API 응답 | route.ts | 401 "로그인이 필요합니다." / 403 학생 전용 / 500 폴백 | 구독 카드 데이터 공급 + 역할 격리(멘토·관리자가 학생 API 호출 불가) |

---

## 자산 전수 대조 (components/auth 21개 · mypage 4개 · home 5개 · lib)

| 자산 | 이 장에서의 역할 | 사용처 |
|---|---|---|
| AuthPageLayout.tsx | signup/forgot/update 3화면의 프레임(제목·설명·카드·AuthTopNav 포함) | /signup, /forgot-password, /auth/update-password |
| AuthTopNav.tsx | 상단 고정 네비. `loginPageNav` 모드(md 이상 전용)는 중앙 메뉴 "멘토 찾기·질문방·커뮤니티·캐시결제" 4링크 + "검색" 버튼 + "로그인"/"회원가입" — 중앙 4링크 href는 모두 `/`[^8], 검색 버튼은 동작 미연결(장식) | AuthPageLayout 경유 |
| LoginDualRolePanel.tsx / RoleLoginForm.tsx / loginRoleContent.ts | 로그인 3라우트의 본체 (위 상세 참조) | /login, /login/student, /login/mentor |
| SignupStepBar / StudentSignupForm / MentorSignupForm / SignupTrustBlock | 회원가입 본체 (위 상세 참조) | /signup |
| UpdatePasswordClient.tsx | 새 비밀번호 폼 (위 상세 참조) | /auth/update-password |
| LoginPageFooter.tsx | 약관·고객센터·"안전한 결제 시스템" 푸터 | /forgot-password (로그인 라우트에서는 미사용) |
| RoleSelector.tsx · LoginLandingColumn.tsx · LoginInformationBlock.tsx | **라우트 미사용** — app/ 어디에서도 import되지 않음. LoginInformationBlock은 무료 질문권 정책 상수(`FREE_QUESTION_TOTAL_LIMIT`/`EXPIRY_DAYS`/`PER_MENTOR_LIMIT` = 7장/7일/멘토당 3)를 소비하는 구 시안 잔재(코드 주석 "복제 시안용 노출") | 없음 (추정: 구 시안 보존) |
| icons/AuthBenefitIcons.tsx | 혜택 아이콘 6종 | LoginLandingColumn·RoleSelector(둘 다 미사용 경로) |
| illustrations/ 6파일 (LoginStudent/MentorHero, RoleStudent/MentorCard, Student/MentorAuth) | 히어로·카드 일러스트 | 전부 미사용 컴포넌트(LoginLandingColumn·RoleSelector) 하위 — 현행 라우트 도달 없음 |
| components/mypage/MypageSubscriptionsCard.tsx | /mypage 구독 카드 (위 상세) | /mypage |
| components/mypage/StudentDashboardShell.tsx | 학생 대시보드 3컬럼 셸(좌 프로필·네비 5항목 "마이페이지/구독 현황/캐시 내역/알림/분쟁·환불 현황", 우 캐시 레일) — **/mypage 자체는 사용하지 않고** /subscriptions·/wallet/ledger·/wallet/charge/fail이 사용 (해당 화면은 각 담당 장) | 04/05장 라우트 |
| components/mypage/ProfileSummaryCard.tsx · MypageMetricLine.tsx | **라우트 미사용** — 구 마이페이지 v1 잔재 (추정) | 없음 |
| components/home/HeroSection.tsx · NoticeBanner.tsx · MentorPreviewSection.tsx | **0바이트 빈 파일** | 없음 |
| components/home/MentorDashboardBody.tsx · mentorDashboardDisplay.ts | 멘토 대시보드 KPI 본체 — **현행 라우트에서 import 없음** (구 /home 대시보드 잔재, 추정) | 없음 |
| lib/home/mentorDashboardQueries.ts · threadStats.ts | 살아있는 쿼리 계층: `mentorHubDashboardQueries`(→ /mentor/mypage)·맞춤의뢰 대시보드/주문 페이지가 재사용 | /mentor/mypage 외 |
| lib/auth/signupValidation.ts | 역할별 필드 검증 정본(8자 비밀번호, 멘토 6필수+파일) | /signup |
| lib/auth/minorAgeGate.ts | `MINIMUM_SIGNUP_AGE=14`, 만 나이 계산·미래 생일 거부 | /signup |
| lib/auth/minorConsentPlaceholders.ts | 미성년 동의 placeholder 문구·버전 상수 | /signup |
| lib/auth/buildSignupUserMetadata.ts | signUp metadata 직렬화 — DB 트리거 `handle_new_auth_user()`와 키 계약 | /signup |
| lib/auth/syncAfterSignUpSession.ts | 가입 후 users/mentor_profiles upsert + 학생증 업로드(경고 누적·비차단, 단 "[프로필 저장]"/"[멘토 프로필]"은 차단성) | /signup |
| lib/auth/getPostLoginPath.ts | `safeInternalNextPath`(open redirect 차단: `//`·`://`·`..`·제어문자 거부) + 역할별 기본 경로(학생 `/mypage`·멘토 `/mentor/mypage`·admin `/admin`) + 역할-경로 교차 차단 | 로그인·가드 전반 |
| lib/auth/passwordResetActions.ts | 재설정 메일 server action (위 상세) | /forgot-password |
| lib/auth/routeGuard.ts | `requireRole`(역할별 로그인 경로 + next 보존, 불일치 시 자기 홈으로 추방), `requireWalletChargeAccess`, `requireQnaActor`(formData actor 불신 원칙) | 보호 라우트 전반 |
| lib/auth/getServerUserWithProfile.ts / getCurrentUser.ts / getCurrentProfile.ts | React cache 1회 조회로 auth user + public.users 프로필 결합. getCurrentProfile은 `display_name`·`suspended_until` 컬럼 존재 시에만 select(미적용 환경 보호) | 서버 전반 |
| lib/auth/accountStatus.ts | active/suspended/banned 판정 + 차단 문구. `suspended_until` 경과 시 lazy 자동 해제 | 핵심 액션 가드 |
| lib/auth/adminLoginActions.ts · mentorPublicRead.ts | admin 로그인(10장 담당)·멘토 공개 읽기(3장 담당) — 본 장 범위 밖 표기만 | 타 장 |
| lib/mypage/mypageQueries.ts | `loadStudentMypageBundle` — FK 후보 컬럼 7종을 순차 probe하는 `countRowsForUser`로 스키마 편차에 견디는 카운트(reviews→mentor_reviews, reports→abuse_reports 폴백) | /mypage |
| lib/mypage/studentActiveSubscriptions.ts | 구독 카드 직렬화 + `countActiveSubscriptionsForStudent` | /mypage, API |

---

### 각주 — 코드 ≠ 기획 차이·특기

[^1]: 멘토 가입 폼에는 생년월일 입력·미성년 게이트가 없다(학생 폼 전용). 만 14세 미만 동의 요건이 멘토 트랙에는 코드상 부재 — 대학(재) 인증 전제라 성인으로 간주한 설계로 보임 (추정).
[^2]: `lib/auth/getPostLoginPath.ts`의 `getSignUpSuccessPath`(멘토 기본 `/mentor/profile/edit`)는 정의되어 있으나 signup 페이지는 이를 호출하지 않고 step 3 정적 `<Link>`로 동일 목적지를 안내한다. 세션 없는(이메일 인증 필요) 가입은 step 3 없이 `/login/{role}?message=signup-check-email`로 우회 — `?next=`는 이 경로에만 보존되고 step 3 경로에서는 소실된다.
[^3]: 학생 폼 라벨 "소속학교"의 값은 DB·metadata의 `grade_level` 컬럼에 저장된다(코드 주석 원문: "시안의「학교」· DB·메타 `grade_level`"). 라벨과 컬럼 의미(학년)가 불일치.
[^4]: `StudentSignupFormValues`에 `fullName`·`studentStatus` 필드가 있으나 입력 UI가 없다. 제출 시 `displayName = nickname`이 `full_name`과 `nickname` 양쪽에 저장된다 — 실명 미수집.
[^5]: 약관 체크박스 옆 설명문에 개발자용 문구("약관·개인정보 링크는 \`NEXT_PUBLIC_*\` 환경 변수로 붙일 수 있어요.", "문서 URL은 \`NEXT_PUBLIC_LEGAL_TERMS_URL\`…")가 사용자 화면에 그대로 노출된다. 또한 학생/멘토 폼이 `termsAgree` 등 동의 state를 공유하므로 역할을 오가도 체크 상태가 유지된다.
[^6]: 비밀번호 변경 완료 후 이동지가 역할 무관 `/login/student` 고정 — 멘토 사용자는 도착 후 "이 화면은 학생 계정 전용" 안내를 거쳐 재분기하게 된다.
[^7]: 기획 규칙 8("빈 상태: EmptyState 공용 컴포넌트")과 달리 MypageSubscriptionsCard·mentor mypage의 EmptyOrders는 자체 빈 상태 마크업을 사용한다(EmptyState는 미사용 MentorDashboardBody에서만 import).
[^8]: AuthTopNav `loginPageNav`의 중앙 메뉴 4항목("멘토 찾기"·"질문방"·"커뮤니티"·"캐시결제")은 href가 전부 `/`로, 실제 라우트(`/mentors`, `/question-room`, `/community`, `/wallet/charge`)와 연결되지 않은 장식이다. 코드 주석에 따르면 이 네비는 forgot/update 비밀번호 화면 전용이며 모바일에서는 숨긴다.
