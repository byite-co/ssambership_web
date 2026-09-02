# 앱 골격 유지 정돈 목록 — 타이포 토큰 통일 · 공통 위젯화 · 간격 토큰화

| 항목 | 내용 |
|---|---|
| **문서 종류** | 정돈 작업 목록 (오너 승인용 · 코드 미착수) |
| **작성일** | 2026-09-02 (KST) |
| **저장 위치** | `docs/plans/app-skeleton-cleanup-checklist.md` |
| **대상** | Flutter 앱 `byite-co/ssambership-app` `master @ 635ae738` (`lib/` 228파일 · `test/` 175파일) |
| **근거** | 코드 정적 열람(grep/sed)만. Flutter SDK 없는 환경이라 `flutter analyze/test` **미실행**. 앱 구조정본(2026-09-02)의 §4~§5를 출발점으로 삼되, 모든 수치·위치는 이 문서 작성 시 다시 셌다 |
| **작업 성격** | 조사·목록화만. **앱 코드는 한 줄도 수정하지 않았다** |

> **읽는 법**: 항목마다 **기계적**(렌더 결과가 픽셀 단위로 같음 — 승인만 받으면 바로 진행) 과 **결정 필요**(값·굵기·색이 바뀜 — 오너가 §10에서 고른 뒤 진행) 를 나눴다. `파일:줄`은 `635ae738` 기준이다. 골격(화면 구조·네비게이션·위젯 트리 의미·동작)을 바꾸는 항목은 이 목록에 넣지 않았고 §12에 따로 적었다.

---

## 0. 결론 요약

| | 값 |
|---|---|
| 항목 수 | **67** (타이포 13 · 반경/간격 17 · 오류 뷰 6 · 입력창 8 · 로딩 8 · 잔재 15) |
| 판정 | **기계적 33** (픽셀 동일, 승인만 받으면 진행) · **결정 30** (값이 바뀜, §10에서 골라야 함) · **기록만 4** (바꾸지 않는 것을 명시) |
| 골격 위반 제안 | **0건** (검토자 판정 기준, §11) |

1. **"타이포 토큰 통일"은 기계적 스윕이 아니다.** 정본 `AppType`은 모든 스타일에 행간(`height` 1.25~1.45)과 고정폭 숫자를 넣지만 구 `AppTypography`와 인라인 `TextStyle`은 Material 기본(행간 1.43)을 상속한다. 그래서 구 토큰 28곳(IQ 4파일)의 치환은 **한 건도 픽셀 동일이 아니고**, 오너가 §3-3 매핑표를 승인해야 시작할 수 있다. 실제로 기계적으로 할 수 있는 것은 구 토큰 파일 삭제(T4) 하나다.
2. **기계적 물량은 간격과 공용 위젯 3종에 있다.** 스케일 위의 `EdgeInsets` 64곳·`SizedBox` 122곳(값 동일 토큰 치환), 오류 뷰 21곳 → `ErrorState` 1개, 입력창 17곳 → `appInputDecoration` 헬퍼 1개, 로딩 32+9곳 → `LoadingState`·`InlineSpinner`. 이 넷을 끝내면 화면마다 베낀 코드 약 300줄이 사라지고 픽셀은 하나도 안 움직인다.
3. **결정 항목은 세 가지 질문으로 묶인다.** (i) 스케일 밖 값(반경 8/10/14/18 · 간격 2/6/10/14 · 입력 패딩 14/10/12 · FAB 여유 88/96 · 배너 그림자)에 **토큰을 신설**(픽셀 동일)할지 **가까운 값으로 스냅**(1~4px 이동)할지, (ii) 타이포 매핑표를 그대로 승인할지, (iii) 아이콘 계열(`_rounded` 48종 vs 비-rounded 40종 64회)을 통일할지. 나머지는 마이크로 위젯 4개의 거취다.
4. **재발 방지는 린트가 아니라 grep이다.** `flutter_lints`에는 리터럴 `TextStyle`/`Colors`/미사용 public 위젯을 잡는 규칙이 없다. `deprecated_member_use`를 warning으로 승격하고(그래서 `withOpacity` 5곳이 CI를 통과해 살아남았다) CI에 grep 스텝을 두는 것이 정직한 가드다(D14).
5. **구조정본과 다른 실측**: `withOpacity` 1곳 → **5곳**, 반경 리터럴 14곳 → `lib/design/` 밖 **13곳**(+`quota_bar` 1), `AppType` 61파일 → `lib/design/` 밖 **54파일**, 오류 뷰는 "약 20파일"이 아니라 **정확히 21곳/20파일**이고 그중 19곳이 바이트 단위 같은 트리.

---

## 1. 원칙 — "골격 유지"의 뜻

1. **화면 수·이동·탭·구조를 바꾸지 않는다.** 정돈은 화면 안의 리터럴을 토큰으로, 화면마다 베낀 코드를 공용 위젯으로 바꾸는 일이다.
2. **기계적 항목의 기준은 픽셀 동일성이다.** 크기·굵기·색·행간·반경·패딩 중 하나라도 달라지면 기계적이 아니다. 그 항목은 "결정 필요"로 내려가고, 무엇이 얼마나 달라지는지 숫자로 적는다.
3. **사용자에게 보이는 문구는 바꾸지 않는다.** 오류 문구·버튼 라벨·힌트는 그대로 둔다(카피 정리는 별도 트랙).
4. **테스트가 정본이다.** 565개 위젯 테스트가 fake 주입으로 기기 없이 돈다. 항목마다 그 사이트를 찾는 테스트(문구·타입)를 적고, 공용 위젯으로 감싸도 `find.byType`·`find.text`가 그대로 통과하는지 밝힌다.
5. **삭제는 참조 0건일 때만.** dead 코드는 `lib/`·`test/` 양쪽 참조 0건을 grep으로 확인한 것만 지운다.

## 2. 방법

- 대상 범위: `lib/` 전체. 단 토큰 정본인 `lib/design/`은 "토큰을 쓰는 쪽"이 아니라 "토큰 자체"이므로 집계에서 제외하고, 그 안의 shim·미사용 위젯만 §8에서 다룬다.
- 집계 명령은 각 절 끝에 그대로 적어 재현 가능하게 했다.
- 축(axis) 6개: 타이포(§3) · 반경·간격(§4) · 오류 뷰(§5) · 입력창(§6) · 로딩(§7) · 잔재·일관성(§8). 각 축을 한 번 조사하고, 조사와 무관한 검토자가 파일:줄·수치·"기계적" 판정을 반박하는 방식으로 두 번 확인했다.

---

## 3. 타이포 토큰 통일

### 3-1. 실측 사실

| 항목 | 값 |
|---|---|
| 정본 `AppType`(`lib/design/typography_tokens.dart`) 사용 | **216회 / 215줄 / 54파일** (`lib/design/` 밖; `settings_section.dart:209`가 한 줄에 2회) |
| 구 `AppTypography`(`lib/design/tokens/typography.dart`) 사용 | **28곳 / 4파일** — 전부 개별질문(IQ): `iq_detail_screen` 15 · `iq_create_screen` 5(프로덕션 도달 불가 화면) · `iq_widgets` 5 · `mentor_iq_list_screen` 3. 토큰별 `caption` 21 · `body` 6 · `cardTitle` 1 · `titleLarge`/`title`/`sectionTitle`/`meta` **0** |
| 두 체계의 구조적 차이 | `AppType`은 전 스타일에 **`height`(1.25~1.45)와 고정폭 숫자**를 넣고, `AppTypography`는 둘 다 없이 Material 3 기본(`bodyMedium` height 1.43 · letterSpacing 0.25)을 상속한다. 굵기도 다르다(w500/w700 vs w400/w600). `caption`은 색까지 다르다(`#475569` vs `#64748B`) |
| **결론** | **`AppTypography → AppType` 치환은 한 건도 픽셀 동일이 아니다.** 이 축은 기계적 스윕이 아니라 **매핑표 승인(결정 #T-1)** 이다 |
| 인라인 `TextStyle(` (토큰 `copyWith` 제외, `lib/design/` 밖) | **32곳 / 24파일** — 오류 문구 `const TextStyle(color: ColorTokens.danger)` 크기 없음 **21** · danger+13px 3(dead 화면) · secondary 색만 2 · `Colors.white/white70` 2 · 크기 리터럴 3(12.5 / 12 / 12+w700) · 굵기만 w800 1 |
| Pretendard 등록 굵기 | 400/500/600/700 4종(`pubspec.yaml`). **w800은 등록 밖** — `lib/design` 안에도 5곳(`typography.dart:13`, `quota_text.dart:27`, `chip_scroll.dart:74`, `initial_avatar.dart:45`, `primary_button.dart:47`) + 테스트 `board_filter_chip_test.dart:15`가 w800을 단언 |
| 스타일 없는 `Text()` | 대략 130곳 이상(`Text(` 409줄 vs `style:` 277줄) — M3 기본 14/w400/h1.43. 전수 조사 안 함, 이 목록 범위 밖 |

### 3-2. 항목

판정: **기계적** = 픽셀 동일 · **결정** = 렌더가 바뀜(달라지는 것을 적음).

| # | 항목 | 위치 | 현재 → 제안 | 판정 | 달라지는 것 | 테스트 영향 | 순서 |
|---|---|---|---|---|---|---|---|
| T1 | `AppTypography.caption` → `AppType.caption` | 21곳 / 4파일 (`iq_detail_screen.dart:973, 986, 1185, 1204, 1216, 1279, 1284, 1328, 1340, 1345, 1350, 1492, 1513` · `iq_widgets.dart:99, 103, 159` · `mentor_iq_list_screen.dart:232, 244, 258` · `iq_create_screen.dart:445, 564`) | 12/w500/`#475569` → 12/w400/`#64748B`/h1.4/tnum. `:1284`는 `.copyWith(color: danger)` 유지. 4파일 모두 `typography_tokens.dart` import 추가 | **결정** | 굵기 w500→w400, 색 더 옅게(대비 7.58→4.76, 12px AA 유지), 행간 17.16→16.8px, 숫자 고정폭 | IQ 테스트 7파일이 이 화면을 렌더하지만 전부 `find.text` — 스타일 단언 없음 | 1 |
| T2 | `AppTypography.body` → `AppType.body` (또는 카드 제목 2곳은 `cardTitle`) | 6곳 (`iq_create_screen.dart:435, 439, 447` · `iq_detail_screen.dart:1549` · `iq_widgets.dart:83, 147`) | 14/w500 → 14/w400/h1.45. `iq_widgets:83/147`은 `IqQuestionCard`/`IqOpenQuestionCard` **제목** — 값 기준 `body`(가벼워짐) vs 역할 기준 `cardTitle`(15/w600) **결정 #T-2** | **결정** | w500→w400 또는 14→15/w600 | 6파일, 스타일 단언 없음 | 2 |
| T3 | `AppTypography.cardTitle` → `AppType.cardTitle` | 1곳 (`iq_detail_screen.dart:980`, 상세 헤더 제목) | 15/w700 → 15/w600/h1.3 | **결정** | Bold→SemiBold, 행간 21.45→19.5px(1줄 ellipsis라 재배치 없음) | 4파일, 스타일 단언 없음 | 3 |
| T4 | 구 import 4곳 교체 후 `lib/design/tokens/typography.dart` 삭제 | `mentor_iq_list_screen.dart:5` · `iq_create_screen.dart:8` · `iq_detail_screen.dart:13` · `iq_widgets.dart:4` | T1~T3 완료 후 `git rm`. 다른 참조 0건(`lib/`·`test/`·docs·scripts) | **기계적** | 없음 | 없음(컴파일만) | 4 |
| T5 | 오류 문구 `const TextStyle(color: ColorTokens.danger)` (크기 없음) | 21곳 / 20파일 — `mentors_screen.dart:421, 445` · `board_list_view.dart:115` · `my_activity_view.dart:82` · `shortform_feed_view.dart:99` · `s3_data_inspector.dart:137`(dev) · `notifications_screen.dart:427` · `mypage_screen.dart:217` · `mentor_iq_list_screen.dart:195` · `iq_create_screen.dart:407` · `iq_detail_screen.dart:815` · `student_iq_list_screen.dart:147` · `mentor_room_home_screen.dart:81` · `student_room_home_screen.dart:105` · `mentor_inbox_screen.dart:176` · `mentor_question_list_screen.dart:103` · `mentor_answer_screen.dart:547` · `chat_screen.dart:534` · `connection_notes_screen.dart:126` · `question_list_screen.dart:121` · `question_room_screen.dart:395` | 현재 렌더 = M3 `bodyMedium` 상속 14/w400/danger/h1.43/ls0.25. 제안 `AppType.body.copyWith(color: ColorTokens.danger)`. **대안**: 이미 토큰 색만 쓰므로 "승인된 형태"로 선언하고 두기(**결정 #T-3**). 19곳은 `Center > Padding(24) > Text` 동일 골격이라 §5 공용 오류 뷰가 들어오면 이 줄들이 함께 사라진다 | **결정**(서브픽셀) | 행간 1.43→1.45(+0.28px/줄), 숫자 고정폭. 크기·굵기·색 동일 | 20개 테스트 파일이 문구로 찾음(`find.text`) — 스타일 무관 | 5 (§5와 함께) |
| T6 | danger + `fontSize: 13` | 3곳 `iq_create_screen.dart:457, 509, 517` (프로덕션 도달 불가 화면) | 13px은 어느 체계에도 없음 → `caption`(12) 또는 `body`(14) `.copyWith(color: danger)` **결정 #T-4** | **결정** | 13→12 또는 14 | 없음(dead 화면, 테스트 4파일은 렌더만) | 11 |
| T7 | secondary 색만 | 2곳 `login_screen.dart:152` · `attachment_viewer_screen.dart:135` | `AppType.body.copyWith(color: ColorTokens.secondary)` (14 유지) | **결정**(서브픽셀) | 행간 1.43→1.45 | `attachment_viewer_test.dart` 문구 단언 없음 | 6 |
| T8 | 크기 12.5 | 1곳 `message_file_attachment.dart:48` | `AppType.caption.copyWith(color: ColorTokens.primary)` (12) | **결정** | 12.5→12, 행간 17.9→16.8px — 긴 파일명 ellipsis 지점 변동 가능 | 없음 | 7 |
| T9 | PDF 페이지 선택 순번 배지 12/w700/white | 1곳 `pdf_page_select_screen.dart:224-228` (22px 원) | `AppType.caption.copyWith(color: Colors.white, fontWeight: w700)` 또는 정당한 리터럴로 두기. `CountBadge`로 바꾸면 안 됨(형태·패딩 다름 = 구조 변경) | **결정** | 행간 1.43→1.4(원 안 세로 정렬 ~0.36px) | `pdf_scan_flow_test.dart`는 `find.text('1')`류 — 스타일 무관 | 9 |
| T10 | PDF 페이지 번호 `TextStyle(fontSize: 12)` | 1곳 `pdf_page_select_screen.dart:236` | `AppType.caption.copyWith(color: ColorTokens.primary)`(진한 색 유지) vs `AppType.caption`(회색으로) **결정 #T-5** | **결정** | 행간 또는 색 | 〃 | 8 |
| T11 | 굵기만 w800 + `AppAccent` | 1곳 `question_list_screen.dart:316-318` (26px 단계 원) | `AppType.body.copyWith(color: accent, fontWeight: w700)` — 번들이 실제로 그릴 수 있는 굵기를 선언. `InitialAvatar`로 교체 금지(크기·배경 다름) | **결정** | 선언 w800→w700(렌더 글리프는 Bold 700으로 동일할 것으로 예상, 런타임 미확인), 행간 +0.28px | 3파일, 단계 숫자 스타일 단언 없음 | 10 |
| T12 | 검은 첨부 뷰어 위 `Colors.white`/`white70` | 2곳 `iq_detail_screen.dart:1599, 1611` | 타이포 토큰 해당 없음. on-dark 텍스트 색 토큰이 없으므로 §8 색 항목으로 이관, 이 축에서는 그대로 | **보류** | — | 3파일, 스타일 무관 | 12 |
| T13 | 토큰 위에 **리터럴 굵기·행간을 덧씌우는** `copyWith` (검토자가 추가 발견) | `conversation_bubble.dart:143, 152`(`height: ConversationMetrics.bodyHeight` = **1.35** — 어느 토큰에도 없는 행간, 말풍선 전부) · `login_screen.dart:128`(caption + **w600**) · `mentor_inbox_screen.dart:287`(caption + w600) · `cash_section.dart:96`(body + **w700**) · (`lib/design/theme.dart:73` 하단 탭 라벨 12/w600, height 없음 — 디자인 계층 내부) | 3-1의 "인라인 32곳"에는 잡히지 않는 같은 부류. 12/w600 "강조 캡션"이 2곳, 14/w700 "강조 본문"이 1곳, 1.35 행간이 말풍선 계열 — `AppType.captionStrong`(12/w600)·`bodyStrong`(14/w700) 토큰 신설 vs 리터럴 승인 **결정 #T-7**. 말풍선 1.35는 `ConversationMetrics`가 이미 상수로 관리하고 테스트가 단언하므로 그대로 | **결정** | (토큰 신설 시) 픽셀 동일 | `conversation_bubble_test` | 13 |

### 3-3. 매핑표 (결정 #T-1 — 오너 승인 필요)

| `AppTypography` | 값 | → `AppType` | 값 | 달라지는 것 | 현재 사용 |
|---|---|---|---|---|---|
| `titleLarge` | 22/w800 | `display` | 24/w700/h1.25 | +2px, 굵기 ↓ | 0 |
| `title` | 18/w700 | `title` | 17/w600/h1.3 | −1px, 굵기 ↓ | 0 |
| `sectionTitle` | 16/w700 | `title` | 17/w600/h1.3 | +1px, 굵기 ↓ | 0 |
| `cardTitle` | 15/w700 | `cardTitle` | 15/w600/h1.3 | 굵기 ↓ | 1 |
| `body` | 14/w500 | `body` | 14/w400/h1.45 | 굵기 ↓ | 6 |
| `caption` | 12/w500/`#475569` | `caption` | 12/w400/`#64748B`/h1.4 | 굵기 ↓ **+ 색 옅어짐** | 21 |
| `meta` | 12/w500/muted | `caption` | 12/w400/muted/h1.4 | 굵기 ↓ | 0 |

모든 행이 추가로 **고정폭 숫자**를 얻고 상속 행간 1.43을 잃는다. 근본 원인: `AppType`이 `height`를 갖는 반면 스타일 없는 `Text()`·인라인 사이트는 M3 기본 1.43을 쓴다. "진짜 기계적" 이행을 원하면 `AppType`에 height 없는 변형을 추가해야 하는데, 그것은 정돈이 아니라 **토큰 설계 변경**이다(결정 #T-6).

검토자 판정: T1~T12 **전부 확인**(파일:줄·수치 재현), 기계적/결정 판정 전부 동의. 수치 정정 1건(위 216/215), 누락 6곳(T13으로 편입). 골격 위반 제안 0건.

### 3-4. 재현

```
cd ssambership-app
grep -rn "AppTypography\." lib --include=*.dart | grep -v "^lib/design/"          # 28
grep -rl "AppType\." lib --include=*.dart | grep -v "^lib/design/" | wc -l        # 54
grep -rn "TextStyle(" lib --include=*.dart | grep -v "^lib/design/" | grep -v copyWith   # 32
grep -rln "tokens/typography.dart" lib test                                        # 4 (+정의 파일)
```

## 4. 반경·간격 토큰화

### 4-1. 실측 사실 (`lib/design/` 밖)

| 항목 | 값 |
|---|---|
| 반경 리터럴 `BorderRadius/Radius.circular(N)` | **13곳 / 12파일** (+ `lib/design/widgets/quota_bar.dart:53`의 `999` 1곳). 값 분포 **8×6 · 10×3 · 12×2 · 14×1 · 18×1**. `AppShape`는 20/16/12/12/999 — **8·10·14·18은 토큰이 없다** |
| `EdgeInsets.*` 수치 리터럴 | **138곳 / 55파일**(괄호 균형 다줄 스캔; 한 줄 grep은 110/51). 수치 인자 218개 중 스케일 {0,4,8,12,16,20,24,32} **162**, 스케일 밖 **56**(2×6 · 3×2 · 6×16 · 10×18 · 14×10 · 18×1 · 88×2 · 96×1). **전부 스케일인 사이트 91곳/41파일(기계적)**, 스케일 밖 값을 하나라도 가진 사이트 47곳/28파일 |
| `SizedBox(height\|width: N)` 스페이서 | **199곳 / 54파일**. 스케일 **122곳/46파일(기계적)**, 스케일 밖 **77곳/34파일**(10×28 · 6×21 · 14×11 · 2×7 · 3×4 · 5×3 · 18×2 · 28×1). dev 전용 라우트에 26곳 |
| `EdgeInsets.all(24)` | **27곳 / 24파일** — 20곳은 `Center > Padding(24) > Text(danger)` 오류 뷰(§5), 6곳 Column형 전면 상태 화면, 1곳 빈 목록 패딩 |
| 레거시 shim `lib/design/tokens/dimens.dart` | importer **3**(`app_badge`·`primary_button`·`secondary_button`). `AppRadius` 3회 사용, `AppSpace` **0회** |
| `BoxShadow` 리터럴 | **1곳** `version_gate_screens.dart:163-168`(권장 업데이트 배너: `0x1A0F172A`, blur 12, y4 — `cardShadow`보다 진하고 넓음) |
| 스타일 단언 테스트 | `test/shared/conversation_bubble_test.dart:96-107`가 `ConversationMetrics.tailRadius`만 단언 — 아래 어떤 항목도 건드리지 않음 |

### 4-2. 항목

| # | 항목 | 위치 | 현재 → 제안 | 판정 | 달라지는 것 | 테스트 영향 | 순서 |
|---|---|---|---|---|---|---|---|
| S1 | 값이 이미 토큰과 같은 반경 리터럴 | `message_image_attachment.dart:51`(12) · `version_gate_screens.dart:161`(12) · `quota_bar.dart:53`(999) | `AppShape.buttonRadius`(=12) / `AppShape.pillRadius`. 이미지 클립의 12에 의미 있는 이름을 원하면 `AppShape.thumb=12` 별칭 추가(값 동일) | **기계적** | 없음 | `message_image_attachment_test` · `force_update_screen_test` 통과 | 2 |
| S2 | 반경 **8** | 6곳 `reaction_bar.dart:82` · `iq_create_screen.dart:575` · `chat_input_bar.dart:156` · `ink_toolbar.dart:307, 313` · `pdf_page_select_screen.dart:169` | (a) `AppShape.chip=8` 신설 후 치환(픽셀 동일) / (b) 12로 스냅(+4px) **결정 #S-1** | **결정** | (b)면 36~72px 소형 요소 모서리가 눈에 띄게 둥글어짐 | 8파일 렌더, 단언 없음 | 3 |
| S3 | 반경 **10** | 3곳 `mypage_section.dart:79` · `iq_detail_screen.dart:1507` · `message_file_attachment.dart:33` | (a) `AppShape.thumb=10` / (b) 12로 스냅(+2px) **결정 #S-2** | **결정** | (b) 파일 칩·썸네일 외곽 2px | 4파일 | 4 |
| S4 | 반경 **14** — `AppCard`(20) 위 `InkWell` 클립 불일치 | 1곳 `iq_widgets.dart:67` | (a) `AppShape.cardRadius`(20)로 맞춤 / (b) 리터럴 유지 **결정 #S-3**. (`AppCard`의 자체 `onTap`으로 합치는 것은 트리 변경이라 제외) | **결정** | 탭 잉크 리플의 모서리만 14→20, 정지 상태 동일 | `iq_requirement_display_test` | 5 |
| S5 | 바텀시트 상단 반경 **18** | 1곳 `report_sheet.dart:32` | (a) `AppShape.sheet=18` + `sheetRadius` / (b) 20으로 스냅 **결정 #S-4**. 다른 시트(`scan_source_sheet.dart:11`)는 M3 기본 28 — 둘을 맞추는 건 픽셀 변경이라 제외 | **결정** | (b) +2px | 없음 | 6 |
| S6 | 스케일 안 `EdgeInsets` 리터럴 | 64곳(전부 스케일 91곳 − `all(24)` 27곳). 상위 파일: `mentors_screen` 9 · `board_detail_screen` 5 · `mentor_iq_list_screen` 5 · `question_room_screen` 5 · `question_list_screen` 5 · `version_gate_screens` 4 · … 반복형: `fromLTRB(screenH, 12, screenH, 24)` ×5, `fromLTRB(8,8,8,8)` ×2, `symmetric(vertical: 0)` ×3, `mypage_screen.dart:245`는 리터럴 20과 `AppSpacing`을 혼용 | 같은 값 토큰으로 1:1 치환(4→`s4`, 8→`s8`/`titleBody`, 12→`s12`/`cardGap`, 16→`s16`/`cardPad`, 20→`screenH`, 24→`s24`/`section`, 32→`s32`). `fromLTRB(8,8,8,8)`→`all(s8)`, `symmetric(vertical:0)`→`EdgeInsets.zero`. `const` 유지. import 없는 파일에 `spacing_tokens.dart` 추가(33파일은 이미 import) | **기계적** | 없음(값 동일 const). 별칭 이름만 취향 | 7파일 렌더, 단언 없음 | 7 |
| S7 | 스케일 밖 **10** (`EdgeInsets`) | 18인자 / 17곳 — `only(bottom: 10)` ×4(`board_post_card:93`, `iq_widgets:64, 133`, `live_message_list:262`), `only(top: 10)` ×4(`free_question_entry_section:174, 183, 201, 220`), `mypage_section:81`, `iq_detail_screen:956, 1168`, `message_file_attachment:30`, 입력 contentPadding 14/10 ×3(S8), `widget_gallery:178`(dev). `conversation_bubble.dart:37`은 이미 `ConversationMetrics.padding` 상수 → 제외 | (a) `AppSpacing.s10` 신설(픽셀 동일, 단 `spacing_tokens.dart:3`의 "4단계 스텝" 규칙과 충돌) / (b) 목록 간격 10→`cardGap`(12), 행 패딩 10→`s8`/`s12` 스냅 **결정 #S-5** | **결정** | (b) 목록·행 리듬 ±2px, 거의 전 화면 | 4파일 | 9 |
| S8 | 입력 contentPadding **14/12**·**14/10** | 8곳 `login_screen:205` · `free_question_compose_screen:83` · `profile_edit_screen:140` · `new_question_screen:214`(14/12) · `board_detail_screen:607` · `shortform_detail_screen:665` · `chat_input_bar:114`(14/10) · `new_question_screen:183`·`chat_input_bar:60`(14 단독) | (a) `AppSpacing.inputPadH=14`, `inputPadV=12`, `composerPadV=10` + 공용 `inputContentPadding` 상수 — §6 입력 헬퍼와 함께 도입(픽셀 동일) / (b) 14→16, 10→12 스냅 **결정 #S-6** | **결정** | (b) 입력창 8개가 2~4px 커짐 | `chat_input_bar_test` · `mentor_annotate_wiring_test` | 10 (§6과 함께) |
| S9 | 마이크로 인셋 **6 / 2 / 3** (`EdgeInsets`) | 24인자 / 20곳 — `ink_toolbar:110, 268, 342` · `my_activity_view:124` · `iq_widgets:208` · `mentors_screen:162, 268, 276` · `cash_section:87, 112` · `mentor_question_list_screen:154, 174` · `question_list_screen:287` · `chat_input_bar:76` · `reaction_bar:84` · `iq_create_screen:605, 628` · `mentor_card:92` · `conversation_bubble:123, 168` | (a) `s2`·`s6` 신설(3은 토큰 없음 → 유지) / (b) 4 또는 8로 스냅 / (c) `// optical nudge` 주석으로 예외 선언 **결정 #S-7** | **결정** | (b) 배지·타임스탬프·툴바 셀 1~2px | 3파일 | 12 |
| S10 | `EntranceCard` 패딩 18 | 1곳 `entrance_card.dart:32` — `AppCard` 기본 `cardPad`(16)를 덮어쓰는 유일한 카드 | (a) `padding:` 인자 제거 → 16 / (b) 18 유지 **결정 #S-8** | **결정** | (a) 질문방 첫 타일 안쪽 2px | `entrance_card_test` | 13 |
| S11 | FAB 여유 하단 패딩 **88 / 96** | `board_list_view:134`(88) · `shortform_feed_view:127`(88) · `question_list_screen:131`(96) | (a) `AppSpacing.fabClearance=88` + `fabClearanceTall=96`(픽셀 동일) / (b) 하나로 통일(한 목록 끝 8px 변동) **결정 #S-9** | **결정** | (b) 목록 마지막 항목이 FAB에 가리거나 여백 증가 | `small_viewport_states_test` | 14 |
| S12 | 스케일 안 `SizedBox` 스페이서 | 122곳 / 46파일 (8 ×61, 12 ×34 …). 파일별 상위: `iq_detail_screen` 13 · `iq_create_screen` 12 · `version_gate_screens` 7 · `iq_widgets` 7 · `question_list_screen` 7 · `mentor_detail_screen` 6 · `mentor_card` 6 · `student_subscription_section` 6 … | `const SizedBox(height: 8)` → `const SizedBox(height: AppSpacing.s8)` 등 1:1. `Gap`·`Column(spacing:)` 전환은 트리 변경이라 **하지 않음** | **기계적** | 없음 | 5파일 렌더 | 8 |
| S13 | 스케일 밖 `SizedBox` 스페이서 | 77곳 / 34파일 — **14** ×11은 전면 상태 화면의 아이콘→제목 간격(`version_gate_screens:70, 119` · `blocked_screen:33` · `question_list_screen:264, 271` · `iq_create_screen:460` · `student_iq_list_screen:177` · `mentor_detail_screen:304` · `mentor_dashboard_section:54` · `mentor_card:48` · `profile_section:26`), **10** ×28·**6** ×21은 행·아이콘 간격, 2/3/5는 미세 조정, 18 ×2·28 ×1 단발 | S7/S9와 같은 갈림: (a) `s2/s6/s10/s14` 신설 / (b) 값별 스냅 **결정 #S-5·#S-7과 함께 값 단위로 결정**. 14 간격 사이트는 §5 공용 상태 뷰가 소유하게 되므로 거기서 한 번에 결정 | **결정** | (b) 최대 77곳 1~4px | 4파일 | 11 |
| S14 | 오류/상태 뷰 패딩 `EdgeInsets.all(24)` | 27곳 / 24파일(위치는 §5 표와 동일 + `version_gate_screens:64, 113` · `blocked_screen:24` · `board_detail_screen:139` · `mentors_screen:438` · `notifications_screen:421` · `question_list_screen:260`) | 사이트별 토큰화 **하지 않음** — §5 공용 오류 위젯이 `EdgeInsets.all(AppSpacing.s24)`를 한 번만 갖는다. §5가 미뤄지면 임시로 `all(AppSpacing.s24)` 치환(픽셀 동일, 같은 줄을 두 번 만지는 비용) **결정 #S-10** | **기계적** | 없음 | `small_viewport_states_test` 등 | 15 (§5 뒤) |
| S15 | shim `dimens.dart` 삭제 | `app_badge.dart:4, 28` · `primary_button.dart:3, 46` · `secondary_button.dart:3, 51` | `AppRadius.pill`→`AppShape.pillRadius`, `AppRadius.button`→`AppShape.buttonRadius`, import를 `../shape_tokens.dart`로, `git rm lib/design/tokens/dimens.dart`. 값은 위임이라 동일 | **기계적** | 없음 | `note_author_badge_test` · `action_button_color_test` 통과 | **1** |
| S16 | 코드와 어긋난 주석 | `dimens.dart:11`("카드 16") · `dimens.dart:22`(스케일에 20 누락) · `app_card.dart:8`("반경 16") | `app_card.dart:8` → "반경 20(`AppShape.card`) · 내부 패딩 16(`AppSpacing.cardPad`)". `dimens.dart` 두 줄은 S15로 사라짐 | **기계적** | 없음 | 없음 | **1** |
| S17 | 유일한 `BoxShadow` 리터럴(권장 업데이트 배너) | `version_gate_screens.dart:163-168` | (a) `AppShape.floatingShadow`(현재 값 그대로) 신설 / (b) `AppShape.cardShadow`로 스냅(더 옅고 좁게 — `shape_tokens.dart:34`가 "무거운 그림자 금지"를 명시) **결정 #S-11** | **결정** | (b) 배너 부양감 감소 | `force_update_screen_test` | 16 |

### 4-3. 이 축에서 제외한 것
- 자식이 있는 `SizedBox` 치수 상자 14곳(스피너 16~22, 아바타 48, 썸네일 160, 빈 상태 120/240/360) — 간격이 아니라 **크기**. 스피너 크기 토큰은 §7에서 다룬다.
- `Icon(size:)`·`Container(width/height:)`·`Wrap(spacing:)`·`Border(width:)` 리터럴 — 새 토큰 군(아이콘·아바타 크기)이 필요한 별개 결정.
- `lib/design/` 내부의 컴포넌트 고유 치수 20줄(`status_pill`·`count_badge`·`app_badge`·`chip_scroll`·`empty_state`…) — 디자인 계층 소유.
- `ConversationMetrics`(말풍선 14/10·간격 10·꼬리 4)는 이미 상수화돼 있고 테스트가 단언 — 변경 없음.
- dev 전용 라우트(`lib/features/dev`: `EdgeInsets` 8곳 · `SizedBox` 26곳)를 기계적 패스에 포함할지는 **결정 #S-12**.

### 4-4. 재현
```
cd ssambership-app
grep -rnE '(BorderRadius|Radius)\.circular\([0-9]+(\.[0-9]+)?\)' lib --include=*.dart | grep -v '^lib/design/'   # 13
grep -rnE 'EdgeInsets\.(all|symmetric|only|fromLTRB)\([^)]*[0-9]' lib --include=*.dart | grep -v '^lib/design/'  # 110 (한 줄); 다줄 포함 138
grep -rnE 'EdgeInsets\.(all|symmetric|only|fromLTRB)\($' lib --include=*.dart | grep -v '^lib/design/' | wc -l     # 39 (줄 끝에서 괄호 여는 호출)
grep -rn 'EdgeInsets.all(24)' lib --include=*.dart | grep -v '^lib/design/' | wc -l                              # 27
grep -rnE 'SizedBox\((height|width): *[0-9]+\)' lib --include=*.dart | grep -v '^lib/design/' | wc -l             # 199
grep -rnE 'SizedBox\((height|width): *[0-9]+\)' lib --include=*.dart | grep -v '^lib/design/' | grep -vE '(4|8|12|16|20|24|32)\)' | wc -l  # 77
grep -rn 'tokens/dimens.dart' lib; grep -rnE '\b(AppRadius|AppSpace)\.' lib test                                  # 3 / 3+0
grep -rn 'BoxShadow(' lib --include=*.dart | grep -v shape_tokens.dart                                            # 1
```

## 5. 오류 뷰 공통 위젯

### 5-1. 실측 사실

| 항목 | 값 |
|---|---|
| `const TextStyle(color: ColorTokens.danger)` 오류 문구 | **21곳 / 20파일** — 19곳은 `Center > Padding(EdgeInsets.all(24)) > Text(msg, textAlign: center, danger)` **동일 트리**, 2곳은 재시도 버튼 변형 |
| 사설(private) 오류 클래스 | `_ErrorView`(`mentors_screen.dart:409-426`) · `_ErrorView`(`question_room_screen.dart:384-400`) · `_ErrorBox`(`s3_data_inspector.dart:125-142`, dev) — 세 개가 **빈 줄 하나·클래스명만 다른 같은 코드** · `_RetryView`(`mentors_screen.dart:429-453`, `OutlinedButton` 재시도) |
| 재시도 변형 2종 | A `_RetryView`: `Column[Text, SizedBox(12), OutlinedButton('다시 시도')]` · B `notifications_screen.dart:418-430`: `Column[Text, SizedBox(8), TextButton('다시 시도')]` |
| 텍스트 스타일 | 크기·행간 미지정 → Material `bodyMedium` 상속(14/w400/h1.43/ls0.25). **`AppType.body`로 바꾸면 행간 1.45·고정폭 숫자로 달라진다** — 공용 위젯은 `const TextStyle(color: danger)`를 그대로 품어야 픽셀 동일 |
| `friendlyError()` | 오류 렌더 23회 중 19회가 `'…\n${friendlyError(e)}'` 한 문자열 |
| 테스트 | 8개 테스트 파일이 이 상태를 **문구로**(`find.text`/`textContaining`) 찾고, `Center`/`Padding`/`Column` 타입으로 찾는 곳은 **0** — 메시지 `Text`가 정확히 1개, 라벨 '다시 시도'가 그대로면 안전 |

### 5-2. 항목

| # | 항목 | 위치 | 현재 → 제안 | 판정 | 테스트 영향 | 순서 |
|---|---|---|---|---|---|---|
| E1 | 공용 위젯 신설 `lib/design/widgets/error_state.dart` — `ErrorState` | 신규 파일 (`EmptyState`와 짝) | `ErrorState({required String message, VoidCallback? onRetry, String retryLabel = '다시 시도', ErrorRetryVariant retryVariant = outlined, EdgeInsets padding = EdgeInsets.all(AppSpacing.s24)})`. `onRetry == null`이면 **`Text` 하나만**(Column 없음), 있으면 `Column(min)[Text, SizedBox(s12 또는 s8), OutlinedButton 또는 TextButton]`. 메시지 스타일은 `const TextStyle(color: ColorTokens.danger)` 유지(`AppType.body` 금지). `test/widgets/error_state_test.dart`를 `empty_state_test.dart` 본떠 추가 | **기계적** | 없음(신규) | 1 |
| E2 | 사설 클래스 3개 → `ErrorState`, 클래스 삭제 | 호출 `mentors_screen.dart:215` · `question_room_screen.dart:225` · `s3_data_inspector.dart:109, 262, 335` / 정의 3곳(53줄) | `_ErrorView(message: …)` → `ErrorState(message: …)` 인자·문자열 그대로. dev 화면의 raw `${snap.error}` 문자열도 그대로(카피 변경 아님) | **기계적** | `mentors_screen_scope_test` 문구 단언 통과 | 2 |
| E3 | `_RetryView` → `ErrorState(onRetry:)` | `mentors_screen.dart:239`(호출) · `:428-453`(정의, 26줄) | `ErrorState(message: '찜한 멘토를 불러오지 못했어요.', onRetry: _loadFavorites)` — 기본 `outlined` 변형이 `OutlinedButton` + 간격 12를 그대로 재현 | **기계적** | `mentors_screen_scope_test`가 `find.text('다시 시도')` 탭 + 문구 exact — 라벨·문구 리터럴 유지 | 3 |
| E4 | 인라인 오류 뷰 16곳 → `ErrorState(message:)` | `board_list_view.dart:110` · `my_activity_view.dart:77` · `shortform_feed_view.dart:94` · `mypage_screen.dart:212` · `mentor_iq_list_screen.dart:190` · `student_iq_list_screen.dart:142` · `iq_create_screen.dart:401` · `iq_detail_screen.dart:809` · `mentor_room_home_screen.dart:76` · `student_room_home_screen.dart:100` · `mentor_inbox_screen.dart:170` · `mentor_question_list_screen.dart:98` · `mentor_answer_screen.dart:542` · `chat_screen.dart:529` · `connection_notes_screen.dart:121` · `question_list_screen.dart:115` | 8줄 트리 → `return ErrorState(message: '<동일 문자열 식>');` + import. 문자열 식(`'\n'` 결합·`friendlyError`) 그대로 복사. `mypage`는 `detail` 계산 줄 유지. 주변 가드 조건(`snap.hasError || snap.data == null` 등)은 **손대지 않음**. 순감 ~112줄 | **기계적** | 6개 테스트 파일 문구 단언 통과 | 4 |
| E5 | 알림 첫 로드 오류(`TextButton` + 간격 8) → `ErrorState(onRetry:, retryVariant: text)` | `notifications_screen.dart:418-430` | `text` 변형이 `SizedBox(s8)` + `TextButton`을 그대로 냄 | **기계적** | `notifications_screen_test:462-467` `textContaining` + `find.text('다시 시도')` 탭 — 통과 | 5 |
| E6 | **옮기지 않는** 오류·경고 표시 (기록용) | `settings_section.dart:140-155` · `cash_section.dart:40-48` · `mypage_screen.dart:249-258`(좌측 정렬 caption + TextButton) · `attachment_viewer_screen.dart:128-137`(secondary 색, 중앙 정렬 없음) · `board_detail_screen.dart:536` · `shortform_detail_screen.dart:599`(목록 안 caption) · `shortform_detail_screen.dart:551-585`(영상 스크림) · `shortform_compose_screen.dart:189-196`(`_Notice`) · `free_question_entry_section.dart:181-196`(`SecondaryButton` 재시도) · 폼 안 안내(`login_screen:124-133` · `iq_create:453-459, 504-519` · `iq_detail:1282-1285` · `account_delete:316-324`) | 전면 중앙 패턴이 아니다. `ErrorState`로 바꾸면 정렬(좌→중앙)·패딩(4/0/10→24)·크기(12/13→14)·색(secondary→danger)·버튼 종류가 바뀐다 → **이 축에서 제외** | (제외) | `wallet_stale_test`·`settings_section_test`가 문구와 `widgetWithText(TextButton, '다시 시도')`를 단언 — 건드리면 깨짐 | — |

### 5-3. 결정 필요
- **#E-1 재시도 버튼 모양**: 두 변형(`OutlinedButton`+12 / `TextButton`+8)을 `retryVariant`로 **둘 다 유지**(픽셀 동일, 권장) vs 하나로 통일(한 화면이 눈에 띄게 바뀜).
- **#E-2 메시지 스타일**: `const TextStyle(color: danger)` 유지(권장, 픽셀 동일) vs `AppType.body.copyWith(color: danger)`(행간 1.43→1.45, 고정폭 숫자) — §3 결정 #T-3과 같은 질문.
- **#E-3 dev 화면** `s3_data_inspector`도 옮길지(기계적, 18줄 삭제) 아니면 dev는 손대지 않을지.
- **#E-4 이름**: `ErrorState`(`EmptyState`와 짝, 권장) vs `ErrorView`(현재 사설 클래스명).

### 5-4. 이 축에서 제외한 것
- 재시도가 없는 19곳에 재시도를 **추가**하는 것(동작 변경). 아이콘·제목/본문 분리·`EmptyState`풍 원 추가(재설계).
- 카피 통일('불러오지 못했습니다' vs '불러오지 못했어요', 주어 없는 '불러오지 못했어요.', dev의 raw 오류) — 8개 테스트가 문구를 단언하므로 바이트 그대로 둔다.
- 같은 `Center > Padding(24) > Column` 골격이지만 오류가 아닌 화면(`blocked_screen`, `version_gate_screens`, `board_detail _goneBody`, 미사용 `EmptyScreen`) — 빈 상태·간격 축.
- 스낵바 기반 실패 피드백(`friendlyError` 63회 중 44회가 `_snack`/`SnackBar`) — 별개 패턴.

### 5-5. 재현
```
cd ssambership-app
grep -rn "TextStyle(color: ColorTokens.danger)" lib --include=*.dart | grep -v "^lib/design/"   # 21
grep -rn "class _ErrorView\|class _RetryView\|class _ErrorBox" lib                                  # 4
grep -rln "불러오지 못했\|다시 시도" test | wc -l                                                      # 8 (문구 단언 파일)
```

## 6. 입력창 공통 장식

### 6-1. 실측 사실

| 항목 | 값 |
|---|---|
| `InputDecoration(` 생성 (`lib/design/` 밖) | **17곳 / 14파일** → `TextField` 22곳(`TextFormField` 0) + `DropdownButtonFormField` 1 |
| 사설 `_decoration()` 헬퍼 | **5개**(`profile_edit:131` · `new_question:205` · `free_question_compose:74` · `login:170` · `board_write:203`), 호출 11곳 |
| 변형 5종 | **V1** 힌트만 + `filled`/`fillColor: elevated`/`OutlineInputBorder(inputRadius, BorderSide.none)`/`contentPadding 14·12` (헬퍼 3, 필드 6) · **V1L** 라벨(`labelText` + `labelStyle: AppType.caption`, **contentPadding 없음**) (헬퍼 2, 필드 4 + 드롭다운 1) · **V2** 댓글·채팅 바(V1 + `contentPadding 14·10`, 인라인 3) · **V3** 검색(V1 + `prefixIcon` + `contentPadding vertical 0`, 인라인 3) · **V4** Material 기본 `OutlineInputBorder()`(IQ 5곳, `isDense` 2) · **V5** `AppCard` 안 `InputBorder.none`(연결노트 1) |
| 헬퍼 동일성 | `profile_edit` ≡ `new_question` 바이트 동일, `free_question`은 `const` 하나만 다름(런타임 동일). **`login`은 `profile_edit`와 다르다**(label+labelStyle, contentPadding 없음) — V1L |
| `_inputBar()` | `board_detail:579-621` ≡ `shortform_detail:637-679` **43줄 바이트 동일**(diff 0) |
| 테마 | `ThemeData.inputDecorationTheme` **없음**. focused/enabled/error border 변형 **0곳** — 단일 `border`가 전 상태에 쓰인다 |
| 테스트 | `TextField`/`enterText`를 만지는 테스트 20파일, decoration 필드를 단언하는 곳 **0**. `chat_input_test:39, 58`은 TextField의 `dy`를 측정(패딩이 같으면 불변) |

### 6-2. 항목

| # | 항목 | 위치 | 현재 → 제안 | 판정 | 테스트 영향 | 순서 |
|---|---|---|---|---|---|---|
| I1 | `lib/design/input_decoration.dart` 신설(V1) + 힌트형 헬퍼 3개 삭제 | 정의 `profile_edit_screen.dart:131-142` · `new_question_screen.dart:205-216` · `free_question_compose_screen.dart:74-85` / 호출 `profile_edit:93, 103` · `new_question:142, 156` · `free_question:103, 113` | `class AppInputPadding { field = symmetric(h14, v12); bar = symmetric(h14, v10); search = symmetric(v0); }` + `InputDecoration appInputDecoration({String? hint, Widget? prefixIcon, EdgeInsets contentPadding = AppInputPadding.field})` = hint · filled · `ColorTokens.elevated` · `OutlineInputBorder(AppShape.inputRadius, BorderSide.none)` · contentPadding. **focused/enabled/error border를 추가하지 않는다**(오늘 없음). 6곳 `appInputDecoration(hint: '…')`. (§4 S8의 14/12/10 토큰과 같은 값 — 함께 도입) | **기계적** | `profile_grade_field_test` · `new_question_submit_test` · `free_question_entry_test` 통과 | 1 |
| I2 | 라벨형 헬퍼 `appLabeledInputDecoration` (V1L) + 헬퍼 2개 삭제 | 정의 `login_screen.dart:170-178` · `board_write_screen.dart:203-214` / 호출 `login:112, 122` · `board_write:270(드롭다운), 286, 295` | `appLabeledInputDecoration({required String label, String? hint})` = `labelText` + `labelStyle: AppType.caption` + V1 채움/테두리, **contentPadding 없음**(Material 기본이 떠 있는 라벨 공간을 확보). I1 헬퍼에 14/12를 넘겨 합치면 필드가 줄고 라벨이 잘린다 → 별도 헬퍼 | **기계적** | `board_write_screen_test` · `board_post_create_rpc_test`. `login`은 위젯 테스트 없음 | 2 |
| I3 | V2 댓글·채팅 바 → `appInputDecoration(hint, contentPadding: AppInputPadding.bar)` | `board_detail_screen.dart:598-607` · `shortform_detail_screen.dart:656-665` · `chat_input_bar.dart:106-115` | 세로 10 유지. `minLines/maxLines/textInputAction/onSubmitted/enabled`는 그대로 | **기계적** | 6파일; `chat_input_test` dy 측정 불변 | 3 |
| I4 | V3 검색 3곳 → `appInputDecoration(hint, prefixIcon: Icon(search_rounded, muted), contentPadding: AppInputPadding.search)`; 선택적으로 `AppSearchField` | `mentors_screen.dart:144-154` · `mentor_inbox_screen.dart:141-150` · `question_room_screen.dart:193-203` (감싸는 `Padding(fromLTRB(screenH, 12, screenH, 8)) > TextField(style: body, onChanged)`도 3곳 동일) | 1단계 decoration 치환(기계적). 2단계 `lib/design/widgets/app_search_field.dart`(같은 서브트리, `onChanged` 콜백만 받음) — 호출부는 `(v) => setState(() => _query = v.trim())` 유지 | **기계적** | `mentors_screen_scope_test:142` `find.byType(TextField)` — 안쪽에 실제 `TextField`가 있어 그대로 매치 | 4 |
| I5 | 바이트 동일 `_inputBar()` 2개 → `CommentInputBar` | `board_detail_screen.dart:579-621`(호출 `:518`) · `shortform_detail_screen.dart:637-679`(호출 `:485`) | `lib/features/community/ui/widgets/comment_input_bar.dart` `CommentInputBar({controller, busy, onSend})` — 같은 서브트리(`SafeArea > Container(8,8,8,8, surface, 상단 border) > Row[Expanded(TextField V2), IconButton(send_rounded, busy ? muted : accent)]`). `onSubmitted: (_) => onSend()`와 `busy` 게이팅(아이콘 색·`onPressed`) 둘 다 유지 | **기계적** | `board_detail_test` · `cache_invalidation_test` · `shortform_detail_test` | 5 |
| I6 | (선택) 얇은 `AppTextField` 래퍼 — V1/V1L/V2/V3 16곳 | `login:103, 115` · `profile_edit:90, 100` · `new_question:139, 151` · `free_question:100, 108` · `board_write:283, 289` · `board_detail:591` · `shortform_detail:649` · `chat_input_bar:98` · `mentors_screen:141` · `mentor_inbox:138` · `question_room_screen:190` | 16곳 전부 `style: AppType.body`. 래퍼는 순수 pass-through(`controller, minLines, maxLines=1, keyboardType, textInputAction, onSubmitted, onChanged, obscureText, autofillHints, enabled, inputFormatters`). **V4·V5에는 적용 금지.** `build`가 실제 `TextField`를 반환하므로 `find.byType(TextField)`·`.at(n)` 순서 불변 | **기계적** (프롭 누락 시 동작 변경 — `autofillHints`·`obscureText` 주의) | 12파일 | 6 (I1~I4 뒤) |
| I7 | V4 IQ 화면의 Material 기본 `OutlineInputBorder()` | `iq_create_screen.dart:469, 479, 489` · `iq_detail_screen.dart:1239, 1358` | 반경 4·1px 외곽선·채움 없음·`isDense`. V1로 바꾸면 반경 4→12, 외곽선 제거, `#F1F5F9` 채움, 패딩 변경 → **결정 #I-2**. 기계적 패스에서는 그대로 | **결정** | `iq_attachments_test:108-110` · `iq_annotate_flow_test:148-150`가 `widgetWithText(TextField, '제목')` 등 라벨 문자열로 찾음 — 라벨/힌트 문자열은 남겨야 함 | 7 |
| I8 | V5 연결노트 카드 안 편집기 `InputBorder.none` | `connection_notes_screen.dart:179-181` | 의도된 "카드 안 편집기" 변형으로 **기록만**. (연결노트 개편안과 무관하게 이 축에서는 불변) | (제외) | — | 8 |

### 6-3. 결정 필요
- **#I-1 `ThemeData.inputDecorationTheme` 정의 여부**: 정의하면 V1 사이트가 `filled/fillColor/border`를 생략할 수 있지만 **전역**이라 V4 5곳·V5·드롭다운·Material 다이얼로그 입력까지 재도장된다 → 기계적 패스 밖. 
- **#I-2 V4 IQ 5곳**을 Material 기본으로 둘지 V1/V1L로 스냅할지(I7).
- **#I-3 V1L(라벨 + 기본 패딩) vs V1(힌트 + 14/12)** 두 모양 유지(제안) vs 하나로 수렴(떠 있는 라벨이 사라지거나 필드 높이 변화).
- **#I-4 V2 세로 10 vs V1 12** 2px 차이 유지(제안) vs 통일.
- **#I-5 포커스·오류 테두리** 추가 여부 — 오늘 0곳, 추가는 디자인 변경.
- **#I-6 드롭다운 2종**(`board_write:268` 채움형 vs `new_question:182-199` 수제 Container) 통일 여부 — 픽셀·구조 변경.

### 6-4. 이 축에서 제외한 것
- `new_question_screen.dart:182-199` 과목 드롭다운(수제 Container + `DropdownButtonHideUnderline`) — `InputDecoration`이 아님.
- IQ 화면 `TextField`의 `style:` 부재와 `AppTypography` — §3.
- 필드 주변 패딩 리터럴(검색 래퍼 `fromLTRB(screenH, 12, screenH, 8)`, 댓글 바 `8,8,8,8`, 채팅 바 `6,6,6,8`·`16,14,16,16`) — §4.
- `login_screen.dart:204-210` `_NoticeBanner`(입력이 아닌 배너), `chat_input_bar.dart:139-199` 첨부 미리보기.
- 필드 위 별도 `Text(caption)` 라벨 패턴(profile_edit·new_question·free_question) vs decoration `labelText`(login·board_write·iq_create) — 두 라벨 방식의 수렴은 트리 변경.
- 같은 파일들에 중복된 `_snack` 헬퍼 4개 — 피드백 축.

### 6-5. 재현
```
cd ssambership-app
grep -rn "InputDecoration(" lib --include=*.dart | grep -v "^lib/design/" | wc -l      # 17
grep -rn "TextField(" lib --include=*.dart | grep -v "^lib/design/" | wc -l            # 22
grep -rn "InputDecoration _decoration" lib                                              # 5
grep -rn "inputDecorationTheme\|focusedBorder\|errorBorder\|enabledBorder" lib | wc -l  # 0
diff <(sed -n '579,621p' lib/features/community/ui/board/board_detail_screen.dart) <(sed -n '637,679p' lib/features/community/ui/shortform/shortform_detail_screen.dart) && echo identical
```

## 7. 로딩 표시 통일

### 7-1. 실측 사실

| 항목 | 값 |
|---|---|
| `CircularProgressIndicator` | **46줄 / 31파일**(dev 전용 `s3_data_inspector` 3줄 포함) |
| 분류 | (a) 전면 `const Center(child: CircularProgressIndicator())` **24** + 같은 Center를 `Padding`/`SizedBox`로 감싼 섹션 로더 **5** · (b) 인라인 `SizedBox(N, N, child: CPI(strokeWidth: 2))` **9**(크기 16×2 · 18×2 · 20×4 · 22×1) · (c) 목록 꼬리 페이징 **3** · (d) `Stack` 오버레이 **1** · 이미지 로더/`InteractiveViewer` 안 맨 스피너 **2** · 게이트 화면 브랜드 파랑(`color: ColorTokens.accent`) **2** |
| `Skeleton`(`lib/design/widgets/skeleton.dart`) | 프로덕션 **0** · 테스트 **0** · dev 갤러리 3곳만. 단일 펄스 사각형이라 스피너 1:1 대체 불가(화면별 자리표시 구성이 필요) |
| 버튼 진행 상태 | `PrimaryButton`/`SecondaryButton`에 `loading` 파라미터 **없음**. `PrimaryButton` 9곳이 `_busy ? '…중…' : label` 라벨 교체 + `onPressed: null`(문구 5종: 등록/수정/로그인/저장/처리 중). 텍스트형 로더 3곳 별도 |
| 기존 사설 로딩 클래스 | `_Spinner`(`message_image_attachment.dart:100-108`, 22px) · `VersionGateLoading`(`version_gate_screens.dart:196-205`) |
| 테스트 | `find.byType(CircularProgressIndicator)` 단언 3줄(3파일) — 래퍼 안에 실제 CPI가 남으면 통과. `tester.tap(find.text('등록 중…'))` 2곳(`free_question_entry_test:344` · `board_post_create_rpc_test:567`)은 **문구가 사라지면 깨진다** |
| `withOpacity` | `skeleton.dart:44` 1곳(이 축) + 4곳(§8). `withValues(alpha:)`는 이미 3곳에서 사용 중(`theme.dart:61-62`, `home_shell.dart:237`) → 실효 최소 Flutter는 3.27 이상인데 `pubspec.yaml:8`은 `>=3.22.0` |

### 7-2. 항목

| # | 항목 | 위치 | 현재 → 제안 | 판정 | 테스트 영향 | 순서 |
|---|---|---|---|---|---|---|
| L1 | `LoadingState` 신설 + 전면 로더 24곳 이관 | `lib/design/widgets/loading_state.dart`(신규) / `scan_annotation_screen:240` · `mentors_screen:212, 236` · `board_list_view:107` · `my_activity_view:73` · `shortform_feed_view:91` · `shortform_compose_screen:201` · `blocked_users_screen:59` · `s3_data_inspector:106`(dev) · `notifications_screen:416` · `mypage_screen:207` · `mentor_iq_list_screen:187` · `iq_create_screen:398` · `iq_detail_screen:806` · `student_iq_list_screen:139` · `mentor_room_home_screen:73` · `student_room_home_screen:97` · `mentor_inbox_screen:167` · `mentor_question_list_screen:95` · `mentor_answer_screen:539` · `chat_screen:526` · `connection_notes_screen:118` · `question_list_screen:112` · `question_room_screen:222` | `class LoadingState({Color? color}) → Center(child: CircularProgressIndicator(color: color))`. `CPI(color: null)`은 무인자 생성과 같다(테마 primary). `return const Center(child: CircularProgressIndicator());` → `return const LoadingState();`. `const` 유지(린트). `mentor_inbox:167`·`question_room:222`의 `&& !snap.hasData` 깜빡임 가드 조건은 **그대로** | **기계적** | `anon_browse_test` · `small_viewport_states_test` — `byType(CPI)`는 안쪽 CPI에 매치 | 1 |
| L2 | 래퍼가 있는 8곳 — 래퍼는 두고 안쪽만 `LoadingState()` | `board_detail_screen:532` · `shortform_detail_screen:595`(`Padding(12)`) · `iq_detail_screen:1487`(`SizedBox(120)`) · `s3_data_inspector:258, 331`(dev, `Padding(8)`) · `board_list_view:143` · `shortform_feed_view:134`(목록 꼬리 `Padding(vertical: 16)`) · `shortform_compose_screen:207`(Stack 오버레이) | 래퍼 상수(12/8/16/120)는 호출부에 남긴다(`LoadingState.section()`류 named 생성자로 흡수할지는 **결정 #L-5**, 렌더 동일). Stack 안 `Center`는 어차피 Stack 크기로 확장 | **기계적** | `anon_browse_test` | 2 |
| L3 | `InlineSpinner(size:)` 신설 + 인라인 9곳 (각자 크기 그대로) | `lib/design/widgets/inline_spinner.dart`(신규) / `scan_annotation_screen:215-217`(18) · `pdf_page_select_screen:105-107`(18), `:185-188`(20) · `message_image_attachment:104-106`(`_Spinner` 22) · `attachment_viewer_screen:86-88`(16) · `iq_detail_screen:1299-1301`(16) · `board_detail_screen:682-684, 709-711`(20) · `settings_section:131-133`(20) | `InlineSpinner({required double size, double strokeWidth = 2}) → SizedBox(size, size, CPI(strokeWidth))`. `size`는 **필수**(기본값을 두면 나중에 9곳이 조용히 바뀐다). 주변 `Center`/`_placeholder` 유지. `_Spinner`는 삭제하고 2곳 호출을 `InlineSpinner(size: 22)`로 | **기계적** | `message_image_attachment_test` · `attachment_viewer_test` · `scan_annotation_screen_test` · `pdf_scan_flow_test` | 3 |
| L4 | 게이트 로딩 브랜드 파랑 → `LoadingState(color: ColorTokens.accent)` | `version_gate_screens.dart:202` | `body: LoadingState(color: ColorTokens.accent)`. 테마 primary는 역할색이라 **색을 바꾸면 멘토 게이트가 초록이 된다** → 색 유지. `splash_screen.dart:25`는 `Column` 안 맨 스피너라 `Center`를 넣으면 레이아웃이 바뀜 → 문서화된 예외로 둔다 | **기계적** | `version_gate_shell_test` | 4 |
| L5 | 맨 `const CircularProgressIndicator()` 3곳 — 리터럴 유지(예외 기록) | `notifications_screen:464`(이미 `Center` 안 삼항) · `attachment_viewer_screen:103`(`InteractiveViewer` 자식) · `:116`(`Image.network` `loadingBuilder`) | `LoadingState`로 감싸면 `Center`가 추가돼 자식 크기(36×36 → 제약 채움)·이중 센터링이 바뀐다 → **손대지 않음**. 위젯 doc 주석에 예외 3곳 명기 | (제외) | `attachment_viewer_test` | 5 |
| L6 | `PrimaryButton`에 `loading:` 추가 vs 라벨 교체 9곳 | `primary_button.dart:11` · `secondary_button.dart:13` / `free_question_compose:117` · `board_write:302` · `login:136` · `profile_edit:113` · `account_delete:356, 401, 433` · `new_question:160` · `connection_notes:186` | `PrimaryButton({…, bool loading = false})` — `loading`이면 `onPressed: null` 강제 + busy 자식. 자식 모양이 **결정 #L-3**: (i) `Text(busyLabel ?? label)`(픽셀 동일이나 사이트별 busy 문구가 그대로 필요 → 통일 효과 미미) · (ii) `InlineSpinner(18)`만 · (iii) 스피너 + 라벨. (ii)/(iii)는 시각 변경 + 접근성 라벨 변화 | **결정** | `free_question_entry_test:344` · `board_post_create_rpc_test:567`이 `tap(find.text('등록 중…'))` — 문구가 사라지면 `Bad state: No element`(`warnIfMissed: false`는 경고만 끈다) → `find.byType(PrimaryButton)`으로 고쳐야 함. `action_button_color_test`는 idle/disabled 색만 단언 | 6 |
| L7 | 린트: `skeleton.dart:44 withOpacity(t)` → `withValues(alpha: t)` | `lib/design/widgets/skeleton.dart:44` | 같은 0.35~0.70 펄스(`withOpacity`는 8bit 반올림, `withValues`는 float — 차이 ≤1/255, `theme.dart:61-62`가 이미 같은 trade). 프로덕션 소비자 0이어도 경고 없이 컴파일되게 | **기계적** | 없음 | 7 |
| L8 | 전면 로더를 스피너 → `Skeleton`으로 재도장 | (L1 이후 `LoadingState` 한 곳) | **지금 하지 않는다.** L1/L2로 모든 (a)/(c) 사이트가 `LoadingState`를 거치게 되면 재도장은 파일 하나의 결정이 된다(`LoadingState({placeholder})` 또는 `LoadingState.list()`). 채택 시 24곳 중 어디를 스켈레톤으로 하고 어디를 스피너로 둘지(게이트·오버레이·댓글 섹션은 스피너 유지)도 골라야 한다 | **결정 #L-1** | `Skeleton`은 인스턴스마다 `AnimationController`(반복 애니메이션) — `pumpAndSettle`이 끝나지 않는 테스트가 생길 수 있어 화면별 검증 필요. `byType(CPI)` 단언 2건 갱신 | 8 |

### 7-3. 결정 필요
- **#L-1** 전면 로더 스피너 유지 vs 화면별 스켈레톤 설계 후 `LoadingState` 경유 재도장(L8, 시각 변경).
- **#L-2** 인라인 스피너 크기 16/18/20/22 그대로(`InlineSpinner(size:)`) vs 하나로 스냅(예: 버튼 슬롯 18·자리표시 20 — 16·22 사이트 2~4px 변화).
- **#L-3** `PrimaryButton.loading` 렌더 (i)/(ii)/(iii) — (ii)/(iii)는 시각 변경 + 테스트 2줄 수정.
- **#L-4** busy 문구 5종(등록/수정/로그인/저장/처리 중) 통일 여부 — 카피 변경.
- **#L-5** 섹션 로더 5곳·목록 꼬리 2곳의 래퍼(`Padding(12)`/`Padding(vertical:16)`)를 named 생성자로 흡수할지 — 렌더 동일, 이름·가독성 문제.
- **#L-6** `LoadingState`가 `color:`를 노출할지(소비자는 `VersionGateLoading` 1곳) vs `version_gate_screens:202`를 `splash`처럼 리터럴로 둘지.

### 7-4. 이 축에서 제외한 것
- 깜빡임 가드 정렬(`mentor_inbox:163-167`·`question_room:218-222`는 `&& !snap.hasData`, 나머지 20곳은 `connectionState != done`만) — 스피너가 **언제** 보이는지가 바뀌는 동작 변경.
- `RefreshIndicator` 6곳(pull-to-refresh) — 다른 어포던스. `LinearProgressIndicator` 0곳.
- 텍스트형 로더 '불러오는 중…' 3곳(`mentor_detail_screen:348` · `new_question_screen:195` · `live_message_list:180`, `live_message_list_earlier_test:162-163`이 단언) — 스피너로 바꾸면 카피·시각 변경.
- 로더 옆 오류 뷰 — §5.
- `pubspec.yaml:8` `flutter: ">=3.22.0"` 하한이 실제(3.27+)보다 낮음 — 매니페스트 정정, UI 아님(§8 참고 항목).

### 7-5. 재현
```
cd ssambership-app
grep -rn "CircularProgressIndicator" lib --include=*.dart | wc -l                                    # 46
grep -rln "CircularProgressIndicator" lib --include=*.dart | wc -l                                   # 31
grep -rn "const Center(child: CircularProgressIndicator())" lib --include=*.dart | wc -l             # 25 (24 return + 1 Stack 자식)
grep -rn "strokeWidth: 2" lib --include=*.dart | wc -l                                               # 9
grep -rn "Skeleton(" lib --include=*.dart | grep -v "^lib/design/widgets/skeleton.dart"              # widget_gallery 3곳
grep -rn "중…" lib --include=*.dart | grep "label:" | wc -l                                          # 9
grep -rn "byType(CircularProgressIndicator)" test | wc -l                                            # 3
```

## 8. 잔재 정리·일관성

### 8-1. 실측 사실

| 항목 | 값 |
|---|---|
| 미사용·dev 전용 위젯 | `EmptyScreen` 생성자 호출 **0**(갤러리에도 없음) · `Skeleton` 3곳·`SlideOverPanel` 1곳 — 전부 `lib/features/dev/widget_gallery.dart`, 라우터는 `kDevToolsEnabled`(= `!kReleaseMode`)일 때만 등록 → **릴리즈 빌드 도달 불가** |
| `withOpacity(` | **5곳**(구조정본은 1곳으로 과소 집계): `skeleton.dart:44` · `status_pill.dart:80` · `app_badge.dart:27` · `initial_avatar.dart:37` · `cash_section.dart:114`. `withValues(alpha:)`는 이미 3곳 사용, CI Flutter **3.44.6** 고정. analyzer는 `deprecated_member_use`를 **info**로만 보고해 CI 게이트(`error|warning`)를 통과한다 → 살아남은 이유 |
| 아이콘 | `Icons.*` **88종 / 159회** — `_rounded` 48종(95회) · `_outlined/_outline` 21종(30회) · 접미사 없음 19종(34회). **같은 글리프를 두 계열로 쓰는 것 11쌍**(`close`↔`close_rounded` 등). 테스트 16파일 35줄이 `find.byIcon`으로 비-rounded 글리프를 고정 |
| `Colors.*` (`lib/design/` 밖) | **8파일 / 24줄** — 전부 정당한 예외(미디어 뷰어 흑백·잉크 펜 프리셋·`transparent`·이미지 오버레이 칩·`#0F172A` 원 위 흰 숫자) |
| raw `Color(0x…)` (`lib/design/` 밖) | **3곳** — 스크림 `0x66000000` ×2(`shortform_detail:559` · `thumbnail_view:47`) · 배너 그림자 `0x1A0F172A`(`version_gate_screens:165`) |
| 사설 마이크로 위젯 | `_ReadOnlyBadge`·`InitialAvatarLike`·`_EmptyQuestions`는 **픽셀 동일 공용 대체물이 없다**. `_BrandSymbol`(76px) vs 스플래시 `Image`(96px)는 **있다**(크기만 다른 같은 에셋). `_AvatarWithDot`는 이미 `InitialAvatar`를 감싼 래퍼(중복 아님) |
| 코드와 어긋난 주석 | **7곳**(`README.md:12` · `app_card.dart:8` · `dimens.dart:11` · `mentors_screen.dart:1-3, 26` · `mentor_card.dart:13` · `mentor_detail_screen.dart:30`) |
| 린트 | `flutter_lints 4.0.0` + 규칙 4개, `analyzer:` 절 없음. **리터럴 `TextStyle`/`Colors`/`Color(0x…)`나 미사용 public 클래스를 잡는 린트는 없다**(`unused_element`는 private만) |

### 8-2. 항목

| # | 항목 | 위치 | 현재 → 제안 | 판정 | 테스트 영향 | 순서 |
|---|---|---|---|---|---|---|
| D1 | `EmptyScreen` 삭제 | `lib/design/widgets/empty_screen.dart` | `git rm`. 정본은 `EmptyState`. 부수 효과: `Icons.widgets_outlined` 1종 소멸 | **기계적** | 없음 | 1 |
| D2 | `Skeleton`·`SlideOverPanel` 처리 | `skeleton.dart` · `slide_over_panel.dart` / `widget_gallery.dart:135-139, 144` | (A) 카탈로그로 유지 + 헤더 주석 "프로덕션 호출부 없음 — 갤러리 전용" · (B) `lib/features/dev/widgets/`로 이동(import 2줄) · (C) 삭제 + 갤러리 섹션 제거. 셋 다 릴리즈 렌더 동일. `SlideOverPanel` 주석이 "연결노트·학생정보"용이라 연결노트 개편이 쓸 수 있음 → **결정 #D-1** | **기계적** | 없음 | 7 |
| D3 | `withOpacity` → `withValues(alpha:)` 5곳 | 8-1의 5곳 | 8bit 양자화 결과 동일(0.12→31, 0.16→41, 0.20→51). 테스트에 `withOpacity` 비교 0건 | **기계적** | `status_tone_color_test` 통과 | 2 |
| D4 | 아이콘 계열 통일(`_rounded`) | 비-rounded 64회(dev·도달불가 5회 포함): `close` ×6(`version_gate_screens:184` · `slide_over_panel:65` · `board_write_screen:233, 242` · `iq_create:606` · `chat_input_bar:188`) · `attach_file` ×5 · `search_off` ×3 · `favorite_border` ×3 · `refresh` ×2 · `play_circle_fill` ×2 · `undo`·`redo`·`system_update_alt`·`open_in_new`·`more_vert`·`front_hand`·`bookmark`·`bookmark_border`·`auto_fix_normal`·`arrow_drop_down`·`add` … + `_outlined` 21종 | 글리프가 바뀌므로 전부 **결정 #D-2**. 선택지: (a) 40종/64회 전부 `_rounded`(테스트 35줄 동반 수정) · (b) **같은 글리프 두 계열 혼용 11쌍(26곳)만** 정리 · (c) 그대로. 주의: `_outlined` 계열은 `_outlined_rounded`가 없어 `_rounded`로 가면 **외곽선→채움**으로 바뀐다(`help_outline`·`lock_outline`·`delete_outline`·`play_circle_outline`·`favorite_border`·`bookmark_border`처럼 base 이름 자체에 outline/border가 든 6종만 외곽선 유지). 토글 쌍(`favorite`/`favorite_border`, `bookmark`/`bookmark_border`)은 함께 이동 | **결정** | 16파일 35줄 `find.byIcon` | 12 |
| D5 | `_ReadOnlyBadge`('조회만') | `cash_section.dart:106-118` | 패딩 8/2 · `muted`@16% · `AppType.caption`. 가장 가까운 `AppBadge`는 패딩 8/3 · `secondary`@12% · 11/w700 — 전 축이 다름. (a) 유지 · (b) `AppBadge`로 스냅(시각 변경) · (c) 값 동일 `AppBadge.muted` 변형 추가(호출부 1곳을 위한 API 확장) **결정 #D-3**. D3의 `withOpacity`만 기계적 | **결정** | `wallet_stale_test` | 10 |
| D6 | `InitialAvatarLike`(단계 숫자 원) | `question_list_screen.dart:301-321`(호출 `:291`) | 화면 파일 안의 public 클래스, 호출 1곳. `InitialAvatar(size: 26)`는 배경(`elevated` vs accent@20%)·글자 크기(~14 vs 10.9)가 달라 대체 불가. 기계적 부분: private `_StepNumber`로 개명·`super.key` 제거(렌더 동일). 스냅은 **결정 #D-4** | **기계적**(개명) | `question_list_actions_test` · `small_viewport_states_test` 렌더만 | 8 |
| D7 | `_AvatarWithDot` | `mentor_inbox_screen.dart:298-320` | `InitialAvatar(48)` + 경고 점 오버레이 래퍼 — 중복 아님. 변경 없음(두 번째 호출부가 생기면 승격) | (제외) | — | 13 |
| D8 | `_EmptyQuestions` vs `EmptyState` | `question_list_screen.dart:254-275` | `ListView(24)` + 44px muted 아이콘 + 3단계 행 — `EmptyState`(`Center/Padding(32)` + 88px accentSoft 원 + 46px accent 아이콘, 자식 슬롯 없음)와 구조·색·스크롤이 다름 → 유지. 수렴하려면 `EmptyState(children:)` 슬롯 추가 + 시각 변경 수용 **결정 #D-5**. `ListView`→`Center` 교체는 소형 뷰포트 스크롤(골격)을 바꾼다 | **결정** | `question_list_actions_test` · `small_viewport_states_test` | 11 |
| D9 | `BrandMark(size)` 공용 위젯 | `login_screen.dart:85, 182-195`(`_BrandSymbol` 76px) · `splash_screen.dart:18-23`(96px) | `lib/design/widgets/brand_mark.dart` `BrandMark({required double size})` → `Image.asset(brandLogoAsset, size, size, FilterQuality.medium)`. `Image.asset`은 내부적으로 `AssetImage`라 같은 위젯. 에셋 경로는 파라미터로 받아 `lib/design`→`lib/shared/constants` 의존을 피할 수 있음 | **기계적** | 없음(두 화면 테스트 없음) | 6 |
| D10 | `Colors.*` 24줄 — 교체 대신 **허용 표식** | 8-1의 8파일 | 각 줄 끝에 한 가지 정확한 문자열 `// design-allow: <사유>`(미디어 뷰어 흑백 / 잉크 펜 프리셋 / transparent / 이미지 오버레이 칩)를 붙이고 D14의 CI grep이 그 줄을 제외. 값 동일 스왑 1건 가능: 역할색 위 흰 글자 `primary_button.dart:41` → `AppAccent.of(context).onAccent`(`0xFFFFFFFF`). `pdf_page_select:225`는 `ColorTokens.primary` 위라 `Colors.white` + 표식 유지 | **기계적**(주석) | 없음 | 5 |
| D11 | raw `Color(0x…)` 3곳 → 값 동일 토큰 | `shortform_detail:559` · `thumbnail_view:47` · `version_gate_screens:163-169` | `ColorTokens.scrim = Color(0x66000000)`(신설) · `AppShape.floatingShadow = [BoxShadow(0x1A0F172A, blur 12, y4)]`(신설, §4 S17 (a)와 동일) | **기계적** | `force_update_screen_test` · `version_gate_shell_test` · `shortform_*_test` 렌더 | 4 |
| D12 | 주석 정정 7곳 | `README.md:11-12`("네이티브 폴더 없음" — `android/`·`ios/` 존재, CI가 AAB 빌드) · `app_card.dart:8`·`dimens.dart:11`("카드 16" → 20; 16은 `block`) · `mentors_screen.dart:26`·`mentor_card.dart:13`·`mentor_detail_screen.dart:30`("'구독하기'는 웹 브릿지" — CTA 자체가 제거돼 `CommerceNoticeCard` 안내) · `mentors_screen.dart:1-3`(자기 자신이 불필요하다고 적은 TODO) | 주석·문서만 | **기계적** | `build_version_test`는 `app_constants.dart`만 읽음 | 3 |
| D13 | `AppConstants.appVersion = '1.0.0'` 상수 | `app_constants.dart:18-19` · `settings_section.dart:244` | 보고만. `build_version_test:53-65`가 pubspec `versionName`과 일치를 고정(무단 drift 불가), `settings_section_test:103`·`android_signed_workflow_contract_test:142`가 리터럴 고정. (a) 유지 · (b) `package_info_plus` 런타임 값(+빌드번호 표시 시 '1.0.0 (19)') — 의존성·비동기·테스트 3개 재작성 **결정 #D-6** | **결정** | 3파일 | 14 |
| D14 | 회귀 방지 가드 | `analysis_options.yaml` · `.github/workflows/flutter-ci.yml` | (1) `analyzer: errors: deprecated_member_use: warning` — CI가 이미 실패시키는 등급으로 승격(먼저 로컬 `flutter analyze`로 다른 deprecation이 없는지 확인). (2) `flutter pub get` 뒤 CI 스텝 "design-token guard": `withOpacity(` 0건 · `lib/design/` 밖 `Colors.*`(단 `design-allow` 제외) 0건 · `Color(0x…)`가 토큰 파일 밖 0건 · `lib/design/widgets/*.dart`의 public 클래스가 `lib/`(dev 제외)에서 참조 0건이면 실패. (3) 아이콘 `_rounded` 강제는 D4 결정 **후에만**(지금 켜면 64건 실패) | **기계적** | 없음 | 9 |
| D15 | `dimens.dart` shim 삭제 | (§4 S15와 동일) | 〃 | **기계적** | 〃 | 6 |

### 8-3. 결정 필요
- **#D-1** `Skeleton`·`SlideOverPanel`: 카탈로그 유지 / dev로 이동 / 삭제 — 연결노트 개편이 `SlideOverPanel`을 쓸 가능성 고려.
- **#D-2** 아이콘 계열: 전량 `_rounded`(64곳 + 테스트 35줄) / 혼용 11쌍만 / 그대로.
- **#D-3** `_ReadOnlyBadge`: 유지 / `AppBadge` 스냅 / `AppBadge.muted` 변형.
- **#D-4** `InitialAvatarLike`: 개명만 / `InitialAvatar(26)`로 스냅.
- **#D-5** `_EmptyQuestions`: 유지 / `EmptyState(children:)` 확장.
- **#D-6** 설정 화면 버전 표기: 상수 유지 / `package_info_plus`.
- **#D-7** `Colors.*` 허용 표식 방식: 줄 단위 `design-allow` 주석 / CI 스텝에 경로 허용 목록.

### 8-4. 재현
```
cd ssambership-app
grep -rn "EmptyScreen\|empty_screen" lib test                                   # 정의만
grep -rn "Skeleton(\|SlideOverPanel" lib | grep -v "^lib/design/widgets/"      # widget_gallery 4곳
grep -rn "withOpacity(" lib | wc -l                                            # 5
grep -rhoE "Icons\.[a-zA-Z0-9_]+" lib | sort | uniq -c | sort -rn | wc -l      # 88
grep -rhoE "Icons\.[a-zA-Z0-9_]+" lib | grep -vE "_rounded$" | wc -l          # 64
grep -rn "Colors\." lib | grep -v "^lib/design/" | wc -l                       # 24
grep -rnE "Color\(0x[0-9A-Fa-f]{8}\)" lib | grep -v "^lib/design/"             # 3
grep -rn "byIcon(" test | grep -vE "_rounded" | wc -l                          # 35
```

---

## 9. 실행 순서 제안

원칙: **PR 하나 = 한 축의 기계적 항목** → 오너 답을 받은 결정 항목은 별도 PR. 기계적 PR은 순서를 바꿔도 되지만 아래 순서가 충돌이 가장 적다(뒤 PR이 앞 PR의 토큰·위젯을 쓴다).

| PR | 내용 | 항목 | 효과 | 선행 |
|---|---|---|---|---|
| ① 삭제·주석·린트 | dead 위젯·shim 삭제, 주석 정정, deprecation 스왑, 값 동일 토큰 2개 신설, 허용 표식, CI grep 가드 | D1 · D3 · D12 · D15(=S15) · S16 · L7 · D11(=S17(a)) · D10 · D14(1)(2) · T4는 **제외**(T1~T3 결정 뒤) | 파일 2개 삭제, 픽셀 0 | 로컬 `flutter analyze`로 다른 deprecation 확인 |
| ② 간격·반경 기계적 | 스케일 위 `EdgeInsets`·`SizedBox` 토큰 치환, 값 동일 반경 치환 | S6 · S12 · S1 (S14는 ③ 뒤로) | 186곳 리터럴 → 토큰, 픽셀 0 | ① (shim 삭제 후) |
| ③ 오류 뷰 | `ErrorState` 신설 + 21곳 이관 | E1 → E2 · E3 · E4 · E5 | 사설 클래스 4개·인라인 16곳 소멸(~190줄), T5의 21곳도 함께 사라짐 | ② (S24 토큰 사용) |
| ④ 입력창 | `appInputDecoration`/`appLabeledInputDecoration` + `AppInputPadding` 토큰(=S8(a)) + `CommentInputBar` | I1 → I2 · I3 · I4 · I5 (I6은 선택) | 헬퍼 5개·`_inputBar` 2개 소멸 | ② |
| ⑤ 로딩 | `LoadingState`·`InlineSpinner` | L1 → L2 · L3 · L4 | 32+9곳 통과점 확보(L8 재도장은 결정 뒤) | — |
| ⑥ 마이크로 | `BrandMark`, `_StepNumber` 개명 | D9 · D6(개명) | — | — |
| ⑦~ 결정 배치 | 오너 답을 받은 항목만, 축별로 | §10 | 값이 바뀌므로 §11-4 스크린샷 대조 | 각 답변 |

②~⑤는 서로 독립이라 병렬 가능. 전체 기계적 물량은 6 PR, 합쳐서 대략 **+700/−1,100줄** 규모(공용 위젯 4파일 신설 vs 중복 제거).

## 10. 오너 결정 필요 항목

축별 상세는 §3-3 · §4-2/4-3 · §5-3 · §6-3 · §7-3 · §8-3. 여기서는 답만 고르면 되도록 모았다. "권장"은 골격·테스트·리스크 기준의 내 의견이다.

| # | 질문 | 선택지 | 권장 |
|---|---|---|---|
| T-1 | `AppTypography → AppType` 매핑표(§3-3) 승인 | 승인 / 행별 수정 | **승인** — IQ 4파일에 한정, `caption` 색 옅어짐만 실기기 1회 확인 |
| T-2 | IQ 카드 제목(`iq_widgets:83, 147`) | `body`(값 기준) / `cardTitle`(역할 기준) | **`cardTitle`** |
| T-3 · E-2 | 오류 문구 스타일 | `const TextStyle(color: danger)` 유지 / `AppType.body.copyWith` | **유지** — `ErrorState`가 그대로 품는다(픽셀 동일) |
| T-4 | dead 화면의 13px | `caption`(12) / `body`(14) | **`caption`** |
| T-5 | PDF 페이지 번호 | 진한 색 유지(`copyWith`) / `caption` 회색 | **유지** |
| T-6 | height 없는 `AppType` 변형 신설 | 신설 / 안 함 | **안 함** — 토큰 설계 변경 |
| T-7 | 12/w600 캡션 2곳 · 14/w700 본문 1곳 | `captionStrong`·`bodyStrong` 신설 / 리터럴 승인 | **신설**(픽셀 동일) |
| S-1 | 반경 8 (6곳) | `AppShape.chip=8` 신설 / 12로 스냅 | **신설** — 36~72px 요소라 +4px 체감 큼 |
| S-2 | 반경 10 (3곳) | `thumb=10` 신설 / 12로 스냅 | **12로 스냅** — 3곳, +2px, 단계 수 줄임(눈 확인) |
| S-3 | `AppCard` 위 `InkWell` 반경 14 | 20으로 맞춤(리플만) / 유지 | **20** |
| S-4 | 시트 상단 18 | `sheet=18` 신설 / 20 | **신설** — 다른 시트(28)와의 통일은 별개 |
| S-5 · S-7 · S13 | 스케일 밖 간격 2/3/6/10/14 | `s2/s6/s10/s14` 신설 / 값별 스냅 / 리터럴 예외 | **신설**(주석 "미세 조정 스텝") — 49+곳 스냅은 전 화면 리듬 변경 |
| S-6 | 입력 패딩 14/12·14/10 | `AppInputPadding` 토큰(④와 함께) / 16·12 스냅 | **토큰** |
| S-8 | `EntranceCard` 18 | 16(기본) / 18 유지 | **16** — 카드 1개, 눈 확인 |
| S-9 | FAB 여유 88/96 | 두 토큰 / 하나로 | **두 토큰** |
| S-10 | `all(24)` 임시 토큰화 | ③ 전에 함 / 안 함 | **안 함** — ③이 흡수 |
| S-11 · D11 | 배너 그림자 | `floatingShadow` 신설 / `cardShadow` | **신설** |
| S-12 | dev 라우트 포함 | 포함 / 제외 | **포함**(같은 sed) |
| E-1 | 재시도 버튼 2변형 | `retryVariant`로 둘 다 / 하나로 | **둘 다** |
| E-3 | dev `s3_data_inspector` 이관 | 포함 / 제외 | **포함** |
| E-4 | 위젯 이름 | `ErrorState` / `ErrorView` | **`ErrorState`** |
| I-1 | `inputDecorationTheme` 정의 | 정의 / 안 함 | **안 함** — 전역 재도장 |
| I-2 | IQ V4 5곳 | Material 기본 유지 / V1·V1L 스냅 | **유지**(IQ 정리 트랙에서) |
| I-3 · I-4 | V1L vs V1, V2 10 vs 12 | 유지 / 수렴 | **유지** |
| I-5 | 포커스·오류 테두리 | 추가 / 안 함 | **안 함**(디자인 변경) |
| I-6 | 드롭다운 2종 | 유지 / 통일 | **유지** |
| L-1 | 전면 로더 스켈레톤 재도장 | 지금 / 나중 / 안 함 | **나중** — `LoadingState` 통과점 확보 후 개편 트랙 |
| L-2 | 인라인 스피너 크기 | 그대로 / 통일 | **그대로** |
| L-3 · L-4 | `PrimaryButton.loading` · busy 문구 | (i)/(ii)/(iii) · 통일 | **보류** — 개편 트랙(시각·카피) |
| L-5 · L-6 | 섹션 로더 named 생성자 · `color:` 노출 | — | **호출부 유지 · 노출** |
| D-1 | `Skeleton`·`SlideOverPanel` | 카탈로그 유지 / dev 이동 / 삭제 | **유지**(A) — 연결노트 개편이 쓸 수 있음 |
| D-2 | 아이콘 계열 | 전량 `_rounded` / 혼용 11쌍만 / 그대로 | **11쌍만**(26곳 + 테스트) |
| D-3 · D-4 · D-5 | `_ReadOnlyBadge` · `InitialAvatarLike` · `_EmptyQuestions` | 유지 / 스냅·확장 | **유지**(개명만) |
| D-6 | 설정 버전 표기 | 상수 / `package_info_plus` | **상수** |
| D-7 | `Colors.*` 허용 표식 | 줄 단위 `design-allow` / 경로 목록 | **줄 단위** |

## 11. 검증 방법

골든 테스트가 없다(`matchesGoldenFile`·`goldens/`·`flutter_test_config.dart` 0건). 그래서 "픽셀 동일"을 자동으로 증명할 수단이 없고, 아래 네 겹으로 대신한다.

| 겹 | 무엇을 | 어떻게 |
|---|---|---|
| 1 | 컴파일·정적 | `flutter analyze` 에러·경고 0 (CI 게이트, info는 비차단 — `.github/workflows/flutter-ci.yml:59-69`). shim·구 토큰 파일 삭제 후 dangling import가 없는지 여기서 잡힌다 |
| 2 | 위젯 테스트 전량 | `flutter test` 565개. 이 목록의 항목들은 문구(`find.text`)로 찾는 테스트만 스치고 스타일을 단언하는 테스트는 `board_filter_chip_test`(w800)·`conversation_bubble_test`(tailRadius) 2개뿐 — 둘 다 이 목록이 건드리지 않는 값이다. 공용 위젯으로 감싸는 항목(§5~§7)은 감싼 안쪽에 같은 타입(`Text`·`TextField`·`CircularProgressIndicator`)이 남으므로 `find.byType`도 그대로 통과한다 |
| 3 | 잔존 리터럴 0건 | §3-4·§4-4의 grep을 기계적 항목 완료 후 다시 돌려 **기대 수치가 0(또는 결정으로 남긴 예외 수)** 인지 확인. 이 grep 묶음을 `scripts/` 또는 CI 스텝으로 고정하면 재발을 막는다(§8 린트 항목) |
| 4 | 눈으로 | 결정 항목(값이 바뀌는 것)만 실기기·시뮬레이터에서 전후 스크린샷 대조. 기계적 항목은 1~3으로 충분하다 |

작업 단위 권고: **축 하나 = PR 하나**, 기계적 항목 먼저 → 결정 항목은 오너 답을 받은 뒤 별도 커밋. 한 PR 안에서 기계적·결정 항목을 섞으면 "무엇 때문에 화면이 달라졌는지"를 되짚기 어렵다.

## 12. 이 목록에 넣지 않은 것 (골격을 바꾸므로)

| 발견 | 왜 제외했나 |
|---|---|
| `SizedBox` 스페이서 → `Gap` 또는 Flutter 3.27 `Column/Row(spacing:)` | 위젯 트리 변경 |
| 스타일 없는 `Text()` 약 130곳 → `AppType.body` | 행간 1.43→1.45가 전 화면에 걸림 — 별도 결정 |
| 로더 깜빡임 가드 정렬(`&& !snap.hasData` 2곳 vs `connectionState != done` 20곳) | 스피너가 보이는 **시점**이 바뀜(동작) |
| 오류 뷰에 재시도 추가 · 아이콘/제목 추가 · 카피 통일('불러오지 못했습니다' vs '…못했어요') | 동작·디자인·문구 변경. 8개 테스트가 문구 단언 |
| `iq_create_screen.dart` 삭제(프로덕션 도달 불가, `iq_create_boundary_test`가 진입 0을 계약) | 기능 그래프 결정. 지우면 T6·D4의 사이트 여럿이 함께 사라지므로 **먼저 결정하면 목록이 줄어든다** |
| `_EmptyQuestions`의 `ListView` → `EmptyState`의 `Center` | 소형 뷰포트 스크롤 동작 변경 |
| 필드 라벨 두 방식(위 `Text(caption)` vs `labelText`) 수렴 · 드롭다운 2종 통일 | 트리·픽셀 변경 |
| `ThemeData.inputDecorationTheme`·`textTheme` 정의 | 전역 재도장 |
| 아이콘 크기·아바타 크기·`Container` 치수·`Border` 두께 토큰 군 | 새 토큰 체계가 필요한 별개 결정 |
| `lib/design/` 내부 컴포넌트 치수 20줄 · `ConversationMetrics` | 디자인 계층 소유, 테스트 단언 |
| 두 바텀시트(18 vs Material 28) 통일 | 픽셀 변경 |
| `use_colored_box`/`use_decorated_box` 린트 | `Container` 트리를 바꿔 `find.byType(Container)` 테스트 깨짐 |
| `pubspec.yaml` `flutter: ">=3.22.0"` 하한(실효 3.27+) 상향 | 매니페스트 정정 — UI 아님. 별도 커밋 권고 |
| 스낵바 `_snack` 헬퍼 4곳 중복 · `ScaffoldMessenger` 패턴 | 피드백 축(이번 목록 밖) |
| `AppConstants.appVersion` 런타임화 | 의존성·비동기·테스트 3개(D13 참고) |
| `docs/APP_FEATURE_STATUS.md`·`README.md` 본문 갱신 | D12의 주석 정정 외 문서 개정은 별도 |
