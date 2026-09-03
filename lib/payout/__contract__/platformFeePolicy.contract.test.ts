import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  PLATFORM_FEE_POLICY,
  estimateMentorAmount,
  mentorShareRate,
  mentorSharePercentLabel,
  platformFeeDeductionLabel,
  platformFeePercentLabel,
  platformFeeRate,
  platformFeeSourceKey,
} from "../platformFeePolicy.ts";
import { formatRatePercent } from "../ratePercent.ts";
import {
  PAYOUT_WITHHOLDING_LABEL,
  WITHHOLDING_RATE,
  calcPayoutWithholding,
  computeMentorPayout,
  mentorAmountCents,
  mentorShareRate as computationMentorShareRate,
} from "../payoutComputation.ts";
import { settlementFeeRateLabel } from "../settlementFeeRate.ts";
import { buildFeeLine } from "../../admin/settingsConsole.ts";

// V-5 수수료 계산 모듈 통합 — 정책 요율 정본은 lib/payout/platformFeePolicy.ts 한 곳.
//   • as-built 값(구독 15% · 개별질문 15% · 맞춤의뢰 5%)과 파생값(멘토 몫 · 라벨)이 구 상수·구 산식과 동일
//   • 정책 요율 변경 시뮬레이션: 모듈 값을 바꾸면 미리보기 라벨·설정 화면 한 줄·추정 산식이 전부 따라온다
//   • 소스 스캔 가드(PR-1b 확장): 요율 리터럴·구 상수 식별자·백분율 문구 리터럴 잔존 금지 · 정책 소비처는 등록 목록만 ·
//     적용 요율(정산 행) 컨텍스트는 정책 모듈을 부르지 않는다
//
// 실행: node --test --experimental-strip-types lib/payout/__contract__/platformFeePolicy.contract.test.ts

test("정책 요율(as-built): 구독 15% · 개별질문 15% · 맞춤의뢰 5% — 멘토 몫은 1−요율 파생이며 구 상수 0.85/0.85/0.95 와 같은 double", () => {
  assert.equal(PLATFORM_FEE_POLICY.subscription, 0.15);
  assert.equal(PLATFORM_FEE_POLICY.individualQuestion, 0.15);
  assert.equal(PLATFORM_FEE_POLICY.customRequest, 0.05);
  assert.equal(platformFeeRate("subscription"), 0.15);
  assert.equal(platformFeeRate("individual_question"), 0.15);
  assert.equal(platformFeeRate("custom_request"), 0.05);
  assert.equal(mentorShareRate("subscription"), 0.85);
  assert.equal(mentorShareRate("individualQuestion"), 0.85);
  assert.equal(mentorShareRate("individual_question"), 0.85);
  assert.equal(mentorShareRate("customRequest"), 0.95);
  assert.equal(mentorShareRate("custom_request"), 0.95);
  assert.equal(platformFeeSourceKey("individual_question"), "individualQuestion");
  assert.equal(platformFeeSourceKey("custom_request"), "customRequest");
  assert.equal(platformFeeSourceKey("subscription"), "subscription");
  // payoutComputation 은 같은 함수를 재수출한다(정본 한 곳).
  assert.equal(computationMentorShareRate, mentorShareRate);
  assert.equal(computeMentorPayout(10_000, "custom_request").shareRate, 0.95);
});

test("라벨: 구 상수 문자열과 동일 — '15%' · '5%' · '85%' · '95%' · '15% 공제 (플랫폼 수수료)' · '원천징수 3.3%' · 정산 행 라벨과 같은 포맷터", () => {
  assert.equal(platformFeePercentLabel("subscription"), "15%");
  assert.equal(platformFeePercentLabel("individualQuestion"), "15%");
  assert.equal(platformFeePercentLabel("customRequest"), "5%");
  assert.equal(mentorSharePercentLabel("subscription"), "85%");
  assert.equal(mentorSharePercentLabel("individual_question"), "85%");
  assert.equal(mentorSharePercentLabel("custom_request"), "95%");
  assert.equal(platformFeeDeductionLabel("subscription"), "15% 공제 (플랫폼 수수료)");
  assert.equal(platformFeeDeductionLabel("customRequest"), "5% 공제 (플랫폼 수수료)");
  assert.equal(platformFeeDeductionLabel("individualQuestion"), "15% 공제 (플랫폼 수수료)");
  assert.equal(WITHHOLDING_RATE, 0.033);
  assert.equal(PAYOUT_WITHHOLDING_LABEL, "원천징수 3.3%");
  assert.equal(formatRatePercent(0.055), "5.5%");
  assert.equal(formatRatePercent(0.07), "7%", "부동소수 꼬리(7.000000000000001) 정리");
  assert.equal(formatRatePercent(0), "0%");
  // 적용 요율(정산 행) 라벨과 정책 라벨이 같은 포맷터를 쓴다 — 한 화면에서 두 표기가 갈라지지 않는다.
  assert.equal(settlementFeeRateLabel(PLATFORM_FEE_POLICY.subscription), platformFeePercentLabel("subscription"));
  assert.equal(settlementFeeRateLabel(0.055), formatRatePercent(0.055));
});

test("추정 산식은 구 호출부와 동일 — floor(gross × 0.85) · floor(gross × 0.95) · floor(n × (1 − 0.05)) · 소수 입력 절사 없음 · payoutComputation 과 정합", () => {
  const grosses = [0, 1, 7, 19, 999, 9_999, 29_900, 84_900, 174_900, 100_000, 120_000, 4_999_999, 12_345_600];
  for (const g of grosses) {
    assert.equal(estimateMentorAmount(g, "individual_question"), Math.floor(g * 0.85), `IQ ${g}`);
    assert.equal(estimateMentorAmount(g, "subscription"), Math.floor(g * 0.85), `구독 ${g}`);
    assert.equal(estimateMentorAmount(g, "custom_request"), Math.floor(g * 0.95), `맞춤의뢰 ${g}`);
    assert.equal(estimateMentorAmount(g, "customRequest"), Math.floor(g * (1 - 0.05)), `대시보드 구 산식 ${g}`);
    assert.equal(estimateMentorAmount(g, "subscription"), mentorAmountCents(g, "subscription"), `mentorAmountCents ${g}`);
    assert.equal(estimateMentorAmount(g, "custom_request"), mentorAmountCents(g, "custom_request"), `mentorAmountCents ${g}`);
  }
  // 대시보드 진행 중 주문 금액은 소수일 수 있다 — 구 산식과 같이 입력을 절사하지 않는다.
  assert.equal(estimateMentorAmount(12_345.5, "custom_request"), Math.floor(12_345.5 * 0.95));
  assert.equal(estimateMentorAmount(10_000, "individual_question"), 8_500);
  assert.equal(estimateMentorAmount(120_000, "custom_request"), 114_000);
  // 원천징수 헬퍼(원 단위)는 구 mentorPayoutsConstants.calcPayoutWithholding 그대로.
  assert.equal(calcPayoutWithholding(9_500), 313);
  assert.equal(calcPayoutWithholding(0), 0);
  assert.equal(calcPayoutWithholding(-5), 0);
  assert.equal(calcPayoutWithholding(30.5), 1, "원 단위 소수 입력은 절사하지 않는다(cents 헬퍼와 다름)");
});

test("정책 요율 변경 시뮬레이션: 모듈 값을 30/30/20 으로 바꾸면 라벨·설정 화면 한 줄·멘토 몫·추정 금액이 전부 따라온다", () => {
  const changed = { subscription: 0.3, individualQuestion: 0.3, customRequest: 0.2 } as const;
  assert.equal(platformFeePercentLabel("subscription", changed), "30%");
  assert.equal(platformFeePercentLabel("customRequest", changed), "20%");
  assert.equal(mentorSharePercentLabel("subscription", changed), "70%");
  assert.equal(mentorSharePercentLabel("custom_request", changed), "80%");
  assert.equal(platformFeeDeductionLabel("individual_question", changed), "30% 공제 (플랫폼 수수료)");
  assert.equal(buildFeeLine(changed), "구독 30% · 개별질문 30% · 맞춤의뢰 20%");
  assert.equal(buildFeeLine(PLATFORM_FEE_POLICY), "구독 15% · 개별질문 15% · 맞춤의뢰 5%");
  // 1 − 0.2 는 이진 부동소수에서 0.7999999999999999… 다 — 십진 정리로 리터럴과 같은 double 이 되어 floor 가 1원 어긋나지 않는다.
  assert.equal(mentorShareRate("customRequest", changed), 0.8);
  assert.equal(mentorShareRate("subscription", changed), 0.7);
  assert.equal(estimateMentorAmount(10_000, "custom_request", changed), 8_000);
  assert.equal(estimateMentorAmount(10_000, "subscription", changed), 7_000);
  // 기본값은 그대로다(시뮬레이션이 정본을 바꾸지 않는다).
  assert.equal(platformFeePercentLabel("subscription"), "15%");
});

// ── 소스 스캔 가드 (PR-1b adminSettlementFeeRate 가드 확장) ──────────────────────
const ROOT = process.cwd();
const SCAN_DIRS = ["app", "lib", "components"];
const EXT = new Set([".ts", ".tsx"]);
const POLICY_FILE = "lib/payout/platformFeePolicy.ts";

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "__contract__" || entry.startsWith(".")) continue;
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) yield* walk(p);
    else if (EXT.has(p.slice(p.lastIndexOf(".")))) yield p;
  }
}

function rel(file: string): string {
  return file.slice(ROOT.length + 1).replace(/\\/g, "/");
}

/**
 * 주석을 공백으로 지우고, `strings` 면 문자열 리터럴(" ' `)도 지운다 — 줄 번호 유지. 템플릿 리터럴의 ${…} 식은 코드로
 * 남긴다. JSX 텍스트는 코드다(백분율 문구 가드가 잡는다).
 */
function stripSource(src: string, opts: { strings: boolean }): string {
  const out: string[] = [];
  const n = src.length;
  let i = 0;
  const blank = (ch: string) => (ch === "\n" ? "\n" : " ");
  const consumeQuoted = (q: string) => {
    out.push(opts.strings ? " " : q);
    i++;
    while (i < n && src[i] !== q && src[i] !== "\n") {
      if (src[i] === "\\" && i + 1 < n) {
        out.push(opts.strings ? " " : src[i], opts.strings ? " " : src[i + 1]);
        i += 2;
        continue;
      }
      out.push(opts.strings ? " " : src[i]);
      i++;
    }
    if (i < n && src[i] === q) {
      out.push(opts.strings ? " " : q);
      i++;
    }
  };
  while (i < n) {
    const c = src[i];
    const c2 = src[i + 1];
    if (c === "/" && c2 === "/") {
      while (i < n && src[i] !== "\n") {
        out.push(" ");
        i++;
      }
      continue;
    }
    if (c === "/" && c2 === "*") {
      out.push(" ", " ");
      i += 2;
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) {
        out.push(blank(src[i]));
        i++;
      }
      if (i < n) {
        out.push(" ", " ");
        i += 2;
      }
      continue;
    }
    if (c === '"' || c === "'") {
      consumeQuoted(c);
      continue;
    }
    if (c === "`") {
      out.push(opts.strings ? " " : c);
      i++;
      while (i < n && src[i] !== "`") {
        if (src[i] === "\\" && i + 1 < n) {
          out.push(opts.strings ? " " : src[i], opts.strings ? " " : src[i + 1]);
          i += 2;
          continue;
        }
        if (src[i] === "$" && src[i + 1] === "{") {
          out.push("$", "{");
          i += 2;
          let depth = 1;
          while (i < n && depth > 0) {
            const d = src[i];
            if (d === "{") depth++;
            else if (d === "}") {
              depth--;
              if (depth === 0) break;
            }
            if (d === '"' || d === "'") {
              consumeQuoted(d);
              continue;
            }
            out.push(d);
            i++;
          }
          if (i < n) {
            out.push("}");
            i++;
          }
          continue;
        }
        out.push(opts.strings ? blank(src[i]) : src[i]);
        i++;
      }
      if (i < n) {
        out.push(opts.strings ? " " : "`");
        i++;
      }
      continue;
    }
    out.push(c);
    i++;
  }
  return out.join("");
}

function lineOf(src: string, index: number): number {
  return src.slice(0, index).split("\n").length;
}

function lineText(src: string, index: number): string {
  const start = src.lastIndexOf("\n", index - 1) + 1;
  const end = src.indexOf("\n", index);
  return src.slice(start, end === -1 ? src.length : end);
}

function scanAll(re: RegExp, opts: { strings: boolean }, skip: (file: string) => boolean = () => false): string[] {
  const offenders: string[] = [];
  for (const dir of SCAN_DIRS) {
    for (const file of walk(join(ROOT, dir))) {
      const r = rel(file);
      if (skip(r)) continue;
      const src = stripSource(readFileSync(file, "utf8"), opts);
      const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
      for (const m of src.matchAll(g)) {
        offenders.push(`  ${r}:${lineOf(src, m.index ?? 0)} ${m[0]}  ←  ${lineText(src, m.index ?? 0).trim().slice(0, 100)}`);
      }
    }
  }
  return offenders;
}

test("가드: 구 수수료 상수 식별자(MENTOR_*_SHARE · *_PLATFORM_FEE_LABEL · mentorPayoutsConstants · PAYOUT_WITHHOLDING_RATE)가 app/lib/components 에 없고 상수 파일이 삭제됐다", () => {
  assert.ok(!existsSync(join(ROOT, "lib/mentor/mentorPayoutsConstants.ts")), "lib/mentor/mentorPayoutsConstants.ts 가 남아 있다(V-5 삭제 대상)");
  const offenders = scanAll(
    /\bMENTOR_(?:SUBSCRIPTION|CUSTOM_REQUEST|INDIVIDUAL_QUESTION)_(?:PLATFORM_)?SHARE\b|\b(?:SUBSCRIPTION|CUSTOM_REQUEST|INDIVIDUAL_QUESTION)_PLATFORM_FEE_LABEL\b|mentorPayoutsConstants|\bPAYOUT_WITHHOLDING_RATE\b/,
    { strings: false }
  );
  assert.deepEqual(offenders, [], "구 수수료 상수 식별자 잔존 — lib/payout/platformFeePolicy.ts 파생 함수로 바꾸라:\n" + offenders.join("\n"));
});

/** 요율이 아닌 것으로 확인된 리터럴 — 파일 + 그 줄에 반드시 있어야 하는 문맥 + 이유. 새 항목은 이유와 함께 등록한다. */
const RATE_LITERAL_ALLOW: ReadonlyArray<{ file: string; context: string; reason: string }> = [
  { file: "lib/admin/accountDetailConsole.ts", context: "Math.abs(total - usedCap) < 0.05", reason: "정원 합계 부동소수 오차 허용치(요율 아님)" },
];

test("가드: 요율 리터럴 0.15 / 0.05 / 0.85 / 0.95 는 lib/payout/platformFeePolicy.ts 밖의 코드(문자열·주석 제외)에 없다", () => {
  const offenders = scanAll(/(?<![\w.])0\.(?:15|05|85|95)\b/, { strings: true }, (r) => r === POLICY_FILE).filter((line) => {
    const m = /^ {2}(\S+):\d+ .*  ←  (.*)$/.exec(line);
    if (!m) return true;
    return !RATE_LITERAL_ALLOW.some((a) => a.file === m[1] && m[2].includes(a.context));
  });
  assert.deepEqual(offenders, [], "요율 리터럴 발견 — 정책 요율은 PLATFORM_FEE_POLICY, 적용 요율은 정산 행 fee_rate 로:\n" + offenders.join("\n"));
  // 허용 목록의 문맥이 실제로 남아 있는지(목록이 사문화되면 알린다).
  for (const a of RATE_LITERAL_ALLOW) {
    assert.ok(stripSource(readFileSync(join(ROOT, a.file), "utf8"), { strings: true }).includes(a.context), `${a.file}: 허용 문맥 '${a.context}' 이 사라졌다 — 목록에서 지우라`);
  }
});

test("가드: 수수료 백분율 문구 리터럴('15%' '85%' '95%' · 수수료 문맥의 '5%')이 코드·문자열·JSX 텍스트에 없다 — 라벨은 정책 모듈 함수로", () => {
  const percent = scanAll(/\b(?:15|85|95)%/, { strings: false }, (r) => r === POLICY_FILE);
  const five = scanAll(/\b5%/, { strings: false }, (r) => r === POLICY_FILE).filter((line) => /수수료|공제|fee|Fee/.test(line));
  const offenders = [...percent, ...five];
  assert.deepEqual(offenders, [], "수수료 백분율 문구 리터럴 발견 — platformFeePercentLabel / mentorSharePercentLabel / platformFeeDeductionLabel 로:\n" + offenders.join("\n"));
});

/** 정책 요율 소비처(등록 목록) — 정산 행이 없는 미리보기·안내·설정 표시만. 새 소비처는 이유와 함께 등록한다. */
const POLICY_CONSUMERS: ReadonlyArray<{ file: string; reason: string }> = [
  { file: "lib/payout/payoutComputation.ts", reason: "멘토 몫 파생(정책 → 지급 계산 유틸)" },
  { file: "lib/mentor/mentorPayoutLinesCore.ts", reason: "성과 목록·개별질문 라인: 정산 행 우선, 없으면 정책 추정 + '예상'(§2)" },
  { file: "lib/mentor/dashboard/mentorHubDashboardQueries.ts", reason: "진행 중 주문 예상 수익(정산 행 없음)" },
  { file: "lib/customRequest/orderStudentActions.ts", reason: "수락 흐름 RPC 요율 ?? 정책(주문 이벤트 기록용, §2)" },
  { file: "app/(admin)/admin/(console)/settings/page.tsx", reason: "시스템 설정 수수료 한 줄(읽기 전용 표시)" },
  { file: "components/mentor/payouts/MentorPayoutsLeftSidebar.tsx", reason: "멘토 정산 사이드바 공제·멘토 몫 안내" },
  { file: "components/mentor/payouts/MentorPayoutsRightPanel.tsx", reason: "멘토 정산 안내 수수료 문구" },
  { file: "components/mentor/payouts/MentorPayoutsKpiCards.tsx", reason: "KPI 카드 공제 안내" },
  { file: "components/mentor/payouts/MentorPayoutsHeroCard.tsx", reason: "소스별 수익 칸 공제 안내" },
  { file: "components/individualQuestion/IndividualQuestionViews.tsx", reason: "개별질문 상세 멘토 안내 문구" },
  { file: "app/(public)/legal/terms/page.tsx", reason: "약관 제16조 수수료율 문구" },
];

/** 적용 요율(정산 행·지급 스냅샷) 컨텍스트 — 정책 모듈을 부르면 안 된다(행이 있는데 상수로 계산 = 결함). */
const APPLIED_RATE_CONTEXT_FILES = [
  "lib/admin/adminSettlementItems.ts",
  "lib/admin/adminQueries.ts",
  "lib/admin/settlementConsole.ts",
  "lib/admin/settlementConsoleQueries.ts",
  "lib/admin/adminDisputeEscrowSplitQueries.ts",
  "lib/admin/adminDisputeActions.ts",
  "lib/admin/disputeConsole.ts",
  "lib/mentor/mentorSettlementSchema.ts",
  "lib/mentor/mentorSettlementDisplay.ts",
  "lib/mentor/mentorSettlementService.ts",
  "lib/mentor/subscriptionSettlementItems.ts",
  "lib/mentor/mentorPayoutsService.ts",
  "lib/payout/settlementFeeRate.ts",
  "components/admin/PayoutRunHistory.tsx",
  "components/admin/SettlementMentorPanel.tsx",
  "components/admin/SettlementCurrentPanel.tsx",
  "components/disputes/DisputeEscrowSplitPanel.tsx",
  "components/mentor/payouts/MentorPayoutsSettlementTable.tsx",
  "app/(admin)/admin/(console)/disputes/[id]/page.tsx",
];

test("가드: 정책 모듈 소비처는 등록 목록과 정확히 일치한다(미리보기·안내·설정만) · 적용 요율(정산 행) 컨텍스트는 정책 모듈을 부르지 않는다", () => {
  const importers: string[] = [];
  for (const dir of SCAN_DIRS) {
    for (const file of walk(join(ROOT, dir))) {
      const r = rel(file);
      if (r === POLICY_FILE) continue;
      const code = stripSource(readFileSync(file, "utf8"), { strings: false });
      if (/platformFeePolicy/.test(code)) importers.push(r);
    }
  }
  const expected = POLICY_CONSUMERS.map((c) => c.file).sort();
  assert.deepEqual(importers.sort(), expected, "정책 요율 소비처가 등록 목록과 다르다 — 정산 행이 있는 컨텍스트면 행 요율을 쓰고, 미리보기면 이유와 함께 POLICY_CONSUMERS 에 등록하라");
  for (const r of APPLIED_RATE_CONTEXT_FILES) {
    const p = join(ROOT, r);
    assert.ok(existsSync(p), `${r} 가 없다 — 목록을 갱신하라`);
    const code = stripSource(readFileSync(p, "utf8"), { strings: false });
    assert.ok(!/platformFeePolicy|estimateMentorAmount\(|mentorShareRate\(|platformFeeRate\(/.test(code), `${r}: 적용 요율 컨텍스트에서 정책 모듈 호출(V-5 결함 유형) — 정산 행 fee_rate 를 쓰라`);
  }
  // 혼합 컨텍스트 2곳은 행 우선 구조여야 한다.
  const core = stripSource(readFileSync(join(ROOT, "lib/mentor/mentorPayoutLinesCore.ts"), "utf8"), { strings: false });
  assert.ok(core.includes("if (runItem) {") && core.includes("if (settlement) return"), "매퍼가 정산 행을 먼저 쓰지 않는다");
  const accept = stripSource(readFileSync(join(ROOT, "lib/customRequest/orderStudentActions.ts"), "utf8"), { strings: false });
  assert.ok(/atomic\.feeRate\s*\?\?\s*platformFeeRate\(/.test(accept), "수락 흐름은 RPC 요율 ?? 정책 구조여야 한다");
});
