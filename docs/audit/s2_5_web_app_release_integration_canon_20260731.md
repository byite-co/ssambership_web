# S2-5 — 웹·앱 Release Integration Canon 및 단계별 배포 정본 (2026-07-31)

> 본 문서는 S2-5 세션의 유일한 tracked 산출물이다. 이번 세션에서는 병합·배포·원격 DB 접근을 일절 수행하지 않았으며, 두 저장소의 release lineage를 실측해 운영 투입 가능한 정본으로 확정한다.
>
> 검증 시각: 2026-07-31T03:35Z (UTC) · 검증 환경: Claude Code 원격 세션 (linux)

---

## 1. Scope and Repository Ownership

| 항목 | 값 |
|------|-----|
| 주 작업 저장소 | **WEB** — `byite-co/ssambership_web` |
| 참고 저장소 (READ ONLY) | `byite-co/ssambership-app` — 별도 디렉터리 clone, 커밋·push·파일 수정 0건 |
| 웹 기준 브랜치 | `claude/s2-4-comments-author-label-baseline-convergence-lnk6xs` |
| 웹 기준 커밋 | `0685b231f1729db72345eea0340e1fc7a1e9ca49` |
| 신규 작업 브랜치 (실제) | `claude/s2-5-release-integration-canon-1cn8wi` |
| 권고 브랜치명 (과제 명세) | `claude/s2-5-web-app-release-integration-canon-20260731` |
| 원격 DB | NOT_ACCESSED (Supabase MCP 도구 미사용) |
| Vercel | NOT_ACCESSED |
| PR 생성 | 0 |
| 기본 브랜치 병합 | 0 |

**브랜치명 매핑 기록:** 하네스가 세션 브랜치명 `claude/s2-5-release-integration-canon-1cn8wi`를 강제하므로 과제 §0의 이름 매핑 허용 조항에 따라 해당 이름을 사용한다. 하네스가 세션 시작 시 main(`ad076d29`)에 자동 생성해 둔 동명 로컬 포인터는 고유 커밋 0건·원격 부재 상태였으며, 이를 기준 커밋 `0685b231…`로 재지정해 생성했다(원격 force push 아님, 유실 커밋 0). 신규 브랜치의 시작점이 `0685b231…`임은 `git rev-parse HEAD`로 실측 확인했다.

---

## 2. Base Commit Gates

시작 하드게이트 G0~G5 전건 통과 실측치.

| 게이트 | 항목 | 기대값 | 실측값 | 판정 |
|--------|------|--------|--------|------|
| G0 | 저장소 | `byite-co/ssambership_web` | origin = `…/byite-co/ssambership_web` | PASS |
| G1 | 기준 브랜치 HEAD | `0685b231f1729db72345eea0340e1fc7a1e9ca49` | 동일 (`git pull --ff-only` 후 Already up to date) | PASS |
| G1 | working tree | clean | clean | PASS |
| G2 | `origin/main` | `ad076d296ce46a8f7ae0ec30c13200758862e6af` | 동일 | PASS |
| G2 | merge-base(main, RC) | `ad076d29…` | 동일 | PASS |
| G2 | left/right count | 0 / 35 | 0 / 35 | PASS |
| G3 | `origin/master` (앱) | `b0ea4051baf9993dcbad5e94a8b26c51c7d6de43` | 동일 | PASS |
| G3 | merge-base(master, 1c5d6c0) | `b0ea4051…` | 동일 | PASS |
| G3 | left/right count (앱) | 0 / 13 | 0 / 13 | PASS |
| G3 | 앱 worktree | clean | clean | PASS |
| G4 | MC forward SHA-256 | `e46cde0106b1d3d8429d30fb73129ea17a3f2d737586153c1bf1630a691f1e12` | 동일 | PASS |
| G4 | MC rollback SHA-256 | `2c9067b7681dd8a47a30215b8e10dc419ebbe3e67388ea5e37f30c7dc51c39a1` | 동일 | PASS |
| G5 | SQL 물리 무결성 | legacy 190 · 제외 15 · S2 forward 17 · rollback 16 · clean-install 192 | 전건 일치, `sql_number_integrity.mjs` PASS | PASS |

G4 대상 4개 파일 전건 존재 확인:

- `supabase/sql/20260730095436_comments_author_label_baseline_convergence.sql`
- `supabase/rollback/20260730095436_comments_author_label_baseline_convergence_rollback.sql`
- `scripts/verify/s2_4_comments_author_label_baseline_convergence_verify.sql`
- `docs/audit/s2_4_comments_author_label_baseline_convergence_local_verification_20260731.md`

---

## 3. Web Main and Final RC Ancestry

```
WEB_MAIN_SHA     = ad076d296ce46a8f7ae0ec30c13200758862e6af
WEB_FINAL_RC_SHA = 0685b231f1729db72345eea0340e1fc7a1e9ca49
WEB_MAIN_TO_RC   = AHEAD_35_BEHIND_0
```

`git merge-base --is-ancestor <앞> <뒤>` 8개 인접 구간 전건 exit code 0 실측:

```
ad076d29 → 609dafbd  OK   (main → W1)
609dafbd → 20b67e9f  OK   (W1 → W2)
20b67e9f → 602cc53d  OK   (W2 → W3)
602cc53d → b95f74ab  OK   (W3 → W4)
b95f74ab → 4ba9c00e  OK   (W4 → Batch F)
4ba9c00e → 26678fcf  OK   (Batch F → S2-2 rollout plan)
26678fcf → 8913eea0  OK   (S2-2 → S2-3 D-1 contract)
8913eea0 → 0685b231  OK   (S2-3 → S2-4 final RC)
```

**WEB_LINEAR_ANCESTRY: PASS** — merge-base 단절·우회 계보 없음. main 대비 divergence 0.

---

## 4. Web Stage Commit Matrix

| 단계 | 정본 commit | 커밋 일시 (UTC) | 역할 | 브랜치 tip 실측 |
|------|-------------|-----------------|------|-----------------|
| 현 production/main | `ad076d296ce46a8f7ae0ec30c13200758862e6af` | 2026-07-28 | 현재 production 기준 (PR #47 merge) | `origin/main` 일치 |
| W1 | `609dafbd380575abb62f970e0cff5323def82e61` | 2026-07-30 13:14 | C1~C4 읽기·질문방 전환 | `origin/claude/s2-2-transition-w1-c1-c4-20260730` 일치 |
| W2 | `20b67e9f81183d8286a8baacbd907b515677bbe1` | 2026-07-30 14:11 | C5·C6·C11 쓰기 전환 | `origin/claude/s2-2-transition-w2-c5-c6-c11-20260730` 일치 |
| W3 | `602cc53d74b4e36a94bdae239d4726efc325189b` | 2026-07-30 14:47 | C7·C8 결제·캐시 전환 | `origin/claude/s2-2-transition-w3-c7-c8-20260730` 일치 |
| W4 | `b95f74ab2e00d0b7bfdba508baf4928775912eea` | 2026-07-30 18:53 | C9·C10 계정 게이트·schema probing 제거 | `origin/claude/s2-2-transition-w4-c9-c10-l20rej` 일치 |
| Batch F | `4ba9c00e6fd671e4481a5a5c781eec194b6bea6c` | 2026-07-30 20:23 | SQL 최종 lockdown·검증·문서 | (RC ancestry 내) |
| S2-2 rollout plan | `26678fcf27fe20950c65555a42e601968c6d8383` | 2026-07-30 21:07 | 원격 롤아웃 계획 정본 | (RC ancestry 내) |
| S2-3 D-1 contract | `8913eea023e102bef199c9dd0020fa1b6064587a` | 2026-07-30 21:51 | MC 드리프트 계약 | (RC ancestry 내) |
| S2-4 final web RC | `0685b231f1729db72345eea0340e1fc7a1e9ca49` | 2026-07-30 22:32 | MC 구현 포함 최종 후보 | `origin/claude/s2-4-comments-author-label-baseline-convergence-lnk6xs` 일치 |

W1~W4·S2-4 stage 브랜치 tip 5건 전건이 정본 SHA와 일치함을 실측했다(tip 이동 없음).

---

## 5. Post-W4 Product-Code Boundary

각 구간 `git diff --name-status` 실측 요약 (최상위 경로별 파일 수):

| 구간 | 변경 요약 |
|------|-----------|
| main → W1 | app/ 4 · lib/ 13 · supabase/ 24 · scripts/ 6 · docs/ 7 |
| W1 → W2 | app/ 1 · components/ 2 · lib/ 14 · docs/ 1 |
| W2 → W3 | app/ 1 · lib/ 7 · docs/ 1 |
| W3 → W4 | app/ 3 · lib/ 62 · docs/ 1 |
| **W4 → 최종 RC** | **docs/ 6 · scripts/verify/ 3 · supabase/sql/ 5 · supabase/rollback/ 4 — 총 18건, 전건 허용 범위 내** |

W4 → 최종 RC 구간 18개 파일 전건이 `docs/`, `scripts/verify/`, `supabase/sql/`, `supabase/rollback/` 범위 안에 있으며, 금지 경로(`app/`, `components/`, `lib/`, `public/`, `middleware*`, `next.config*`, `package.json`, `package-lock.json`) 변경은 **0건**이다.

```
POST_W4_PRODUCT_CODE_DRIFT: NONE
WEB_PRODUCT_CANON          = b95f74ab2e00d0b7bfdba508baf4928775912eea   (최종 웹 제품 동작 정본)
WEB_RELEASE_ARTIFACT_CANON = 0685b231f1729db72345eea0340e1fc7a1e9ca49   (최종 웹 repository artifact 정본)
```

---

## 6. App Master and Product Base Ancestry

READ ONLY 실측 (별도 clone, 앱 변경 0건):

| 항목 | 값 | 판정 |
|------|-----|------|
| 앱 기본 브랜치 | `master` | — |
| `origin/master` | `b0ea4051baf9993dcbad5e94a8b26c51c7d6de43` | 기대값 일치 |
| 제품 전환 계약 commit | `bc89de109b53c0500ab03208878085f0dce72abd` | 존재 확인 |
| 제품 전환 최종 commit | `1c5d6c0190534d8d17381c95cc701b2f87342c0d` | 존재 확인 |
| merge-base(master, 1c5d6c0) | `b0ea4051…` (= master) | PASS |
| master 대비 | 13 ahead / 0 behind | 기대값 일치 |
| ancestry | `b0ea4051 → bc89de10 → 1c5d6c01` 전건 `--is-ancestor` OK | PASS |
| 현재 version (pubspec.yaml) | `0.1.0+4` | 기대값 일치 |
| signed release 상태 | 미생산 | — |
| 앱 worktree 최종 | clean | PASS |

**APP_LINEAR_ANCESTRY: PASS**

---

## 7. Web Release Candidate Canon

```
WEB_FINAL_RC_SHA = 0685b231f1729db72345eea0340e1fc7a1e9ca49
```

- main(`ad076d29`)보다 35 ahead / 0 behind, divergence 없음 (§3).
- W4 이후 제품 코드 변경 0건 (§5) — RC의 제품 동작은 W4(`b95f74ab`)와 동일하며, 이후 tail은 SQL·검증·감사 산출물이다.
- MC forward/rollback 파일 바이트가 S2-4 로컬 검증 당시 SHA-256과 일치 (§2 G4).
- SQL 물리 무결성 192 산식 PASS (§2 G5).
- 본 세션 재검증: `npm run build` PASS · `eslint` PASS · contract test 285/285 PASS (§18 검증 기록은 아래 18절).

**WEB_RELEASE_CANDIDATE_CANON: PASS** — `0685b231…`을 최종 웹 release candidate로 확정한다.

---

## 8. App Product Base Canon

```
APP_PRODUCT_BASE_CANON    = 1c5d6c0190534d8d17381c95cc701b2f87342c0d
APP_RELEASE_CANDIDATE_SHA = PENDING_S2_6
```

- master 대비 13 ahead / 0 behind, 선형 ancestry PASS (§6).
- `1c5d6c0` 기준 `flutter analyze`: **error 0** (warning 1건 — `.env` 자산 부재, secret 미커밋 정책상 예상된 경고 · info 71건 — 스타일 린트).
- `1c5d6c0` 기준 `flutter test`: **922 pass / 0 fail / 1 skip — All tests passed**.
- 다음 signed build 세션(S2-6)의 release branch는 **반드시 이 commit에서 시작**한다. 권고 branch: `claude/s2-6-app-signed-release-version-gate-20260731` (이번 세션에서 생성하지 않음).
- 앱의 최종 release SHA는 versionCode 증가·signed build 검증 완료 전까지 `PENDING_S2_6`으로 둔다.

**APP_PRODUCT_BASE_CANON: PASS**

---

## 9. Adopted Git Integration Strategy

정본 채택 (OWNER_DECISION_1 해소, §15 참조):

| 항목 | 정본 |
|------|------|
| 직접 기본 브랜치 push | **금지** |
| squash merge | **금지** |
| rebase merge | **금지** |
| release commit cherry-pick | **금지** |
| force push | **금지** |
| history rewrite | **금지** |
| 허용 방식 | **GitHub PR + merge commit** |
| fast-forward | 저장소가 검증된 fast-forward 병합을 지원하는 경우 허용 가능 — 단, commit ancestry와 stage SHA가 그대로 보존되어야 함 |

merge commit을 사용하더라도 원래 stage commit(W1~W4·RC SHA)은 ancestry에 남아야 한다.

**금지 이유:** squash/rebase 사용 시 ① W1~W4 정본 SHA 소실, ② 단계별 rollback target 불명확, ③ preview build와 production commit의 증거 연결 상실, ④ S2 감사 문서에 기록된 SHA와 실제 배포 ancestry 불일치, ⑤ 장애 시 복귀 단계 불명확. 따라서 기존 commit을 그대로 보존한다.

---

## 10. Web Staged PR Queue

이번 세션에서는 PR을 생성하지 않았다. 향후 실행 순서만 확정한다.

| PR | head branch | head SHA | base | 병합 선행조건 | rollback target |
|----|-------------|----------|------|----------------|-----------------|
| WEB-PR-1 (W1) | `claude/s2-2-transition-w1-c1-c4-20260730` | `609dafbd380575abb62f970e0cff5323def82e61` | main | R1 DB 기반 완료 · M4·M5·M6 적용·검증 · D-API-W 완료 · api_web_v1 노출 검증 | `ad076d296ce46a8f7ae0ec30c13200758862e6af` |
| WEB-PR-2 (W2) | `claude/s2-2-transition-w2-c5-c6-c11-20260730` | `20b67e9f81183d8286a8baacbd907b515677bbe1` | main | main에 W1 ancestry 존재 · M7·M8·M14 적용·검증 · 대응 RPC smoke PASS | `609dafbd380575abb62f970e0cff5323def82e61` |
| WEB-PR-3 (W3) | `claude/s2-2-transition-w3-c7-c8-20260730` | `602cc53d74b4e36a94bdae239d4726efc325189b` | main | main에 W2 ancestry 존재 · M9 적용·검증 · 결제·캐시 RPC smoke PASS · 중복 승인·멱등성 게이트 PASS | `20b67e9f81183d8286a8baacbd907b515677bbe1` |
| WEB-PR-4 (최종 RC) | `claude/s2-4-comments-author-label-baseline-convergence-lnk6xs` | `0685b231f1729db72345eea0340e1fc7a1e9ca49` | main | main에 W3 ancestry 존재 · W4 배포 선행조건 충족 · M10 최종 assertion PASS · R6 단계 진입 승인 · 최종 web smoke 준비 완료 | `602cc53d74b4e36a94bdae239d4726efc325189b` |

- W4 전용 PR은 별도로 만들지 않는다. 최종 RC PR(WEB-PR-4)이 W4 제품 코드 + Batch F SQL·검증·문서 + S2-2 rollout plan + S2-3 D-1 contract + S2-4 MC forward/rollback·검증을 함께 통합한다.
- 각 PR은 대응 DB·Data API 선행조건 통과 후에만 병합한다.
- production 배포와 Git 병합의 결합: 각 단계의 Vercel production 배포 commit은 해당 병합 후 main tip과 일치해야 하며, preview 검증은 stage SHA 그대로의 build로 수행한다(§9 증거 연결 보존 원칙).

**WEB_PR_QUEUE: W1 → W2 → W3 → FINAL_RC**

---

## 11. Database Artifact Source

```
WEB_DB_ARTIFACT_SOURCE = 0685b231f1729db72345eea0340e1fc7a1e9ca49
```

원격 DB migration은 "main"이 아니라 위 exact commit에서 읽는다. 모든 `apply_migration` 입력은 해당 commit의 파일 바이트와 SHA-256을 사용한다.

원격 적용 중 금지: 작업 디렉터리의 미커밋 SQL 사용 · main의 과거 파일 사용 · 파일 복사 후 수정 · 대시보드 SQL editor 수기 재작성 · 동일 이름 SQL의 다른 내용 적용 · 기존 migration 파일 수정.

MC 적용 파일과 순서:

```
supabase/sql/20260730095436_comments_author_label_baseline_convergence.sql
(SHA-256: e46cde0106b1d3d8429d30fb73129ea17a3f2d737586153c1bf1630a691f1e12)

R1 내 순서: M1 → MC → M13 → M4
```

MC rollback: `supabase/rollback/20260730095436_comments_author_label_baseline_convergence_rollback.sql` (SHA-256: `2c9067b7681dd8a47a30215b8e10dc419ebbe3e67388ea5e37f30c7dc51c39a1`)

---

## 12. App Signed-Release Handoff

다음 앱 세션(S2-6) 인계 명세:

| 항목 | 값 |
|------|-----|
| 실행 저장소 | APP (`byite-co/ssambership-app`) |
| base commit | `1c5d6c0190534d8d17381c95cc701b2f87342c0d` |
| 권고 release branch | `claude/s2-6-app-signed-release-version-gate-20260731` |
| 웹 저장소 | READ_ONLY |
| 현재 version | `0.1.0+4` → versionCode **+5 이상**으로 증가 |

S2-6 실행 순서 (정본):

1. release branch를 `1c5d6c0`에서 생성
2. versionCode를 +5 이상으로 증가
3. production 설정을 secret 노출 없이 주입
4. `flutter analyze`
5. `flutter test`
6. signed Android AAB 생성
7. 실제 서명 검증
8. 최소 버전·구버전 차단 정책 확정
9. native smoke 및 Gate 4 재검증
10. `APP_RELEASE_CANDIDATE_SHA` 확정
11. 이후 PR로 master 병합 (merge commit · squash/rebase 금지)

앱 master 병합은 signed build와 QA를 통과한 동일 SHA 또는 그 SHA를 ancestry로 포함하는 release commit만 허용한다.

앱 병합·스토어 업로드·M16 순서 (정본):

```
signed build → 내부/단계적 배포 → 구버전 기준선·업데이트 게이트 확인
→ 신규 앱 사용 가능 확인 → 구버전 cutoff 승인 → M16 적용
```

**M16을 앱 신규 배포보다 먼저 적용하지 않는다.**

S2-6 참고 실측(이번 세션): `1c5d6c0`에서 Flutter 3.44.8 (Dart 3.12.2) 기준 `flutter pub get` 성공(lockfile 불변), analyze error 0, test 922건 전건 통과. pubspec 제약(`sdk >=3.4.0`, `flutter >=3.22.0`)이지만 `webview_flutter_wkwebview ^3.26.0`이 Dart ^3.12.0을 요구하므로 **Flutter 3.32.0으로는 pub 해결 불가** — S2-6 빌드 환경은 Dart ≥3.12 (Flutter 3.44.x 계열)을 사용해야 한다.

---

## 13. Rollback Commit Matrix

| 단계 | 장애 시 rollback target |
|------|--------------------------|
| WEB-PR-1 (W1) 이후 | `ad076d296ce46a8f7ae0ec30c13200758862e6af` (현 production/main) |
| WEB-PR-2 (W2) 이후 | `609dafbd380575abb62f970e0cff5323def82e61` (W1) |
| WEB-PR-3 (W3) 이후 | `20b67e9f81183d8286a8baacbd907b515677bbe1` (W2) |
| WEB-PR-4 (최종 RC) 이후 | `602cc53d74b4e36a94bdae239d4726efc325189b` (W3) |
| DB MC 단계 | `supabase/rollback/20260730095436_…_rollback.sql` (SHA-256 §11) |
| 앱 (S2-6 이후) | S2-6에서 확정 — base는 `1c5d6c0`, master 복귀점은 `b0ea4051` |

rollback은 해당 target commit으로의 재배포(및 대응 DB rollback 스크립트 적용)로 수행하며, history rewrite·force push로 수행하지 않는다.

---

## 14. Canon Invalidation Conditions

다음 중 하나라도 발생하면 이번 정본을 폐기하고 재검증한다.

**웹:**

- `main`이 `ad076d29`에서 이동
- 최종 RC가 `main`보다 behind 또는 diverged
- `0685b23` 이후 commit 추가
- W4 이후 제품 코드 변경
- 기존 migration 파일 변경
- MC forward/rollback SHA 변경
- 192 산식 변경
- release branch force push
- stage branch tip 이동 (§4 실측 tip 5건 기준)
- preview와 commit SHA 불일치

**앱:**

- `master`가 `b0ea4051`에서 이동
- `1c5d6c0`이 master와 diverged
- 제품 전환 branch force push
- signed build가 다른 base에서 생성
- versionCode가 기존(+4)보다 증가하지 않음
- signing certificate 불일치
- Gate 4 실패
- release commit 이후 제품 코드 변경
- store upload artifact와 release SHA 연결 불가

무효화 시 자동 rebase나 자동 병합으로 해결하지 않는다.

---

## 15. Owner Decision Table Delta

기존 S2-2 오너 결정표 #1 (웹·앱 PR/review/integration 방식: UNRESOLVED) → 본 문서로 정본화:

```
OWNER_DECISION_1: RESOLVED
```

채택 내용:

- **웹:** 단계별 PR + merge commit. W1 → W2 → W3 → 최종 웹 RC. 각 PR은 대응 DB·Data API 선행조건 통과 후 병합. 직접 main push·squash·rebase 금지.
- **앱:** `1c5d6c0`에서 signed release branch 생성. signed build·버전 게이트 통과 후 merge commit으로 master 병합. 직접 master push·squash·rebase 금지.

다음 항목은 이번 세션에서 해결하지 않는다 (미해결 유지):

| # | 항목 | 상태 |
|---|------|------|
| 2 | rollout 시간창 | UNRESOLVED |
| 3 | backup/PITR | UNRESOLVED |
| 4 | Data API exposed schemas 변경 승인 | UNRESOLVED |
| 5 | auto-expose 상태 | UNRESOLVED |
| 6 | synthetic fixture | UNRESOLVED |
| 7 | Android signed build 환경 | UNRESOLVED |
| 8 | iOS 환경 | UNRESOLVED |
| 9 | 앱 최소 버전 정책 | UNRESOLVED |
| 10 | 구버전 cutoff | UNRESOLVED |
| 11 | DB 적용 승인자 | UNRESOLVED |
| 12 | 제품 배포 승인자 | UNRESOLVED |
| 13 | rollback 결정자 | UNRESOLVED |
| 14 | 모니터링 시간 | UNRESOLVED |
| 15 | production Supabase binding | UNRESOLVED |
| 16 | D-1/MC 원격 적용 승인 | UNRESOLVED — 구현·로컬 검증 완료, 오너의 원격 적용 승인 자체는 미완료 |

---

## 16. Remaining Remote Blockers

- production `public.comments.author_label` 부재 → 게시판 댓글 명시 SELECT/INSERT 실패 — **PRODUCTION_WEB_COMMENT_DEFECT: STILL_OPEN_REMOTE** (로컬 해소 산출물은 준비 완료: MC forward/rollback 구현, PG17.6 clean-install 192/192 PASS, 원격 드리프트 fixture PASS, MC→M13→M4 PASS — 원격 미적용)
- Android keystore·production build 환경 미확정
- 앱 versionCode 증가 미실행
- 구버전 스토어 기준선 미확정
- `min_supported_build` 상향 시점 미확정
- Data API exposed schemas 현재값 미확인
- Automatically expose new tables 현재값 미확인
- production 웹 Supabase project binding 미확인
- backup/PITR restore point 미확인
- synthetic fixture 승인 대기
- rollout 시간창·승인자·rollback 결정자 미확정
- 오너 결정표 #16 MC 원격 적용 승인 대기

---

## 17. Project Progress and Remaining Work

- 세션 시작 전 완료 실행 단위: 14개 (Batch A~F 6 · 웹 W1~W4 4 · 앱 제품 전환 1 · S2-2 롤아웃 계획 1 · S2-3 D-1 계약 1 · S2-4 MC 구현·검증 1)
- 이번 세션(S2-5) 완료 시: **15개**
- 전체 진행도: 시작 전 약 94% → **약 95%** (release integration 정본화·오너 결정 #1 해소 반영. 잔여는 앱 signed build, 원격 적용 승인·실행, 배포·사후 검증)

성공 시 최소 잔여 순서:

1. 앱 signed native build·versionCode 증가·최소 버전/구버전 차단 게이트 (S2-6, APP 저장소)
2. Data API 현재값·production binding·backup/PITR 확인 및 최종 원격 적용 승인
3. 운영 R0~R7 migration·웹/앱 배포·사후 검증

선택 잔여: iOS signing·bundle ID·IPA 파이프라인 / Play Store·App Store 제출·심사 대응 / 단계적 출시·구버전 소멸 관측

최소 잔여 세션: **3개**

---

## 18. Final Verdict

본 세션 검증 실행 기록:

| 검증 | 결과 |
|------|------|
| WEB_BUILD (`npm run build`, Next.js production) | PASS |
| WEB_LINT (`npm run lint`, eslint) | PASS (지적 0건) |
| WEB_TEST (`npm run test:contract`) | PASS — 285/285 (plain `npm test` script 부재 → contract test로 대체 실측) |
| SQL_NUMBER_INTEGRITY (`node scripts/verify/sql_number_integrity.mjs`) | PASS — legacy 190 · 제외 15 · S2 forward 17 · rollback 16 · clean-install 192 |
| APP_FLUTTER_ANALYZE (@`1c5d6c0`, Flutter 3.44.8) | PASS — error 0 · warning 1(`.env` 자산 부재, 예상) · info 71 |
| APP_FLUTTER_TEST (@`1c5d6c0`) | PASS — 922 pass / 0 fail / 1 skip |
| WEB_WORKTREE_FINAL | CLEAN (본 문서 1건 외 변경 0) |
| APP_WORKTREE_FINAL | CLEAN (테스트용 임시 빈 `.env` placeholder는 실행 후 즉시 삭제 — 원인: pubspec이 `.env`를 asset으로 선언하나 secret 미커밋 정책으로 파일 부재) |

최종 판정:

```
WEB_LINEAR_ANCESTRY:          PASS
POST_W4_PRODUCT_CODE_DRIFT:   NONE
APP_LINEAR_ANCESTRY:          PASS
WEB_RELEASE_CANDIDATE_CANON:  PASS  (0685b231f1729db72345eea0340e1fc7a1e9ca49)
APP_PRODUCT_BASE_CANON:       PASS  (1c5d6c0190534d8d17381c95cc701b2f87342c0d)
OWNER_DECISION_1:             RESOLVED
RELEASE_INTEGRATION_CANON:    PASS

READY_FOR_APP_SIGNED_BUILD:          YES
READY_FOR_REMOTE_ROLLOUT_APPROVAL:   NO   (오너 결정 #2~#16 미해결)
READY_FOR_REMOTE_ROLLOUT:            NO
FINAL_STATE_VERIFIER_CANON:          PASS
```

웹 `main → W1 → W2 → W3 → W4 → Batch F → S2-2 → S2-3 → S2-4` 전 구간 선형 ancestry, W4 이후 제품 코드 드리프트 0, 앱 `master → 전환계약 → 전환최종` 선형 ancestry가 전건 실측으로 확인되었다. 최종 웹 RC `0685b231…`과 앱 signed build base `1c5d6c0…`을 정본으로 확정하며, 병합은 단계별 PR + merge commit만 허용한다. 실제 병합·배포·원격 DB 적용은 본 세션 범위 밖이며 오너 승인(#16 포함) 이후 별도 세션에서 수행한다.
