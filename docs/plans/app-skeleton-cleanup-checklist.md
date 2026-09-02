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

(축별 실측이 끝나면 채운다)

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
| 정본 `AppType`(`lib/design/typography_tokens.dart`) 사용 | **215곳 / 54파일** (`lib/design/` 밖) |
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

(작성 중)

## 8. 잔재 정리·일관성

(작성 중)

---

## 9. 실행 순서 제안

(작성 중)

## 10. 오너 결정 필요 항목

(작성 중)

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

(작성 중)
