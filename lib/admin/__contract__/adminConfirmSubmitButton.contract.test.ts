// 계약 테스트: ConfirmSubmitButton / AdminConfirmDialog — 위험 4단계 확인 절차(PR-1 §2 · PRD §5-1).
// 실행: node --test --experimental-strip-types lib/admin/__contract__/adminConfirmSubmitButton.contract.test.ts
//
// .tsx 는 node --test 로 import 할 수 없으므로(strip-types 는 JSX 미지원):
//   ① 판정 로직은 lib/admin/adminConfirmPolicy.ts(순수)를 직접 검증한다 —
//      4단계 각각 · critical 에서 사유 없이 확인 불가 · destructive 에서 문자열 불일치 시 확인 불가 · Enter 차단 정책
//   ② 렌더 규칙은 소스 스캔 tripwire 로 고정한다(disputeSanctionLifecycle 과 같은 방식) —
//      확인 버튼 autoFocus 금지 · 다이얼로그 안 <form> 금지 · requestSubmit(button) 으로 formAction/name/value 보존

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ADMIN_CONFIRM_LEVELS,
  ADMIN_CONFIRM_LEVEL_SPECS,
  ADMIN_CONFIRM_REASON_MIN_LENGTH,
  adminConfirmInitialFocus,
  evaluateAdminConfirm,
  resolveAdminConfirmRequirements,
  shouldBlockAdminConfirmEnterKey,
  type AdminConfirmLevel,
} from "../adminConfirmPolicy.ts";

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
/** 주석을 걷어낸 코드만 — 부정 단언(금지 토큰)이 설명 주석에 걸리지 않게 */
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

// ── ① 4단계 각각 ───────────────────────────────────────────────────────────────

test("위험 등급은 정확히 4단계다", () => {
  assert.deepEqual([...ADMIN_CONFIRM_LEVELS], ["critical", "destructive", "stateChange", "immediate"]);
  for (const level of ADMIN_CONFIRM_LEVELS) assert.ok(ADMIN_CONFIRM_LEVEL_SPECS[level], level);
});

test("critical: 다이얼로그 + 사유 필수(기본) + summary 필수 · 재입력 없음", () => {
  const req = resolveAdminConfirmRequirements({ level: "critical" });
  assert.equal(req.needsDialog, true);
  assert.equal(req.reasonRequired, true);
  assert.equal(req.confirmText, null);
  assert.equal(req.tone, "danger");
  assert.equal(ADMIN_CONFIRM_LEVEL_SPECS.critical.summaryRequired, true);
  assert.ok(req.title.length > 0);
});

test("destructive: 다이얼로그 + 대상 이름 재입력 · 사유는 기본 선택", () => {
  const req = resolveAdminConfirmRequirements({ level: "destructive", confirmText: "  숏폼-1234 " });
  assert.equal(req.needsDialog, true);
  assert.equal(req.confirmText, "숏폼-1234", "confirmText 는 trim 저장");
  assert.equal(req.reasonRequired, false);
  assert.equal(ADMIN_CONFIRM_LEVEL_SPECS.destructive.summaryRequired, true);
});

test("stateChange: 한 줄 확인 — 사유·재입력 없음", () => {
  const req = resolveAdminConfirmRequirements({ level: "stateChange" });
  assert.equal(req.needsDialog, true);
  assert.equal(req.reasonRequired, false);
  assert.equal(req.confirmText, null);
  assert.equal(evaluateAdminConfirm(req, { reason: "", typedConfirmText: "" }).ok, true);
});

test("immediate: 다이얼로그 없음 — reasonRequired/confirmText 를 넘겨도 무시", () => {
  const req = resolveAdminConfirmRequirements({ level: "immediate", reasonRequired: true, confirmText: "x" });
  assert.equal(req.needsDialog, false);
  assert.equal(req.reasonRequired, false);
  assert.equal(req.confirmText, null);
  assert.equal(evaluateAdminConfirm(req, { reason: "", typedConfirmText: "" }).ok, true);
});

test("critical 이외 등급은 confirmText 를 받아도 재입력 단계를 만들지 않는다(destructive 전용)", () => {
  for (const level of ["critical", "stateChange"] as AdminConfirmLevel[]) {
    assert.equal(resolveAdminConfirmRequirements({ level, confirmText: "x" }).confirmText, null, level);
  }
});

test("알 수 없는 level 은 가장 보수적인 critical 로 취급한다(확인 없이 실행되는 쪽으로 깨지지 않게)", () => {
  const req = resolveAdminConfirmRequirements({ level: "whatever" as AdminConfirmLevel });
  assert.equal(req.level, "critical");
  assert.equal(req.needsDialog, true);
  assert.equal(req.reasonRequired, true);
});

// ── critical: 사유 없이 확인 불가 ─────────────────────────────────────────────

test("critical: 사유가 비어 있으면 확인 불가 · 공백만 있어도 불가 · 최소 길이 미만도 불가", () => {
  const req = resolveAdminConfirmRequirements({ level: "critical" });
  assert.deepEqual(evaluateAdminConfirm(req, { reason: "", typedConfirmText: "" }), { ok: false, blockedBy: ["reason"] });
  assert.equal(evaluateAdminConfirm(req, { reason: "   ", typedConfirmText: "" }).ok, false);
  assert.equal(evaluateAdminConfirm(req, { reason: "x".repeat(ADMIN_CONFIRM_REASON_MIN_LENGTH - 1), typedConfirmText: "" }).ok, false);
  assert.equal(evaluateAdminConfirm(req, { reason: "중복 결제 확인됨", typedConfirmText: "" }).ok, true);
});

test("critical: reasonRequired=false 를 명시하면 사유 없이 확인 가능(다이얼로그는 유지)", () => {
  const req = resolveAdminConfirmRequirements({ level: "critical", reasonRequired: false });
  assert.equal(req.needsDialog, true);
  assert.equal(evaluateAdminConfirm(req, { reason: "", typedConfirmText: "" }).ok, true);
});

test("stateChange 에 reasonRequired=true 를 주면 사유 필수로 격상된다", () => {
  const req = resolveAdminConfirmRequirements({ level: "stateChange", reasonRequired: true });
  assert.equal(evaluateAdminConfirm(req, { reason: "", typedConfirmText: "" }).ok, false);
  assert.equal(evaluateAdminConfirm(req, { reason: "사유", typedConfirmText: "" }).ok, true);
});

// ── destructive: 문자열 불일치 시 확인 불가 ──────────────────────────────────

test("destructive: 재입력 불일치·부분 일치·대소문자 불일치는 확인 불가, 정확히 일치(양끝 공백 허용)만 가능", () => {
  const req = resolveAdminConfirmRequirements({ level: "destructive", confirmText: "Post-42" });
  assert.deepEqual(evaluateAdminConfirm(req, { reason: "", typedConfirmText: "" }), { ok: false, blockedBy: ["confirmText"] });
  assert.equal(evaluateAdminConfirm(req, { reason: "", typedConfirmText: "Post-4" }).ok, false);
  assert.equal(evaluateAdminConfirm(req, { reason: "", typedConfirmText: "post-42" }).ok, false);
  assert.equal(evaluateAdminConfirm(req, { reason: "", typedConfirmText: "Post-42 " }).ok, true);
  assert.equal(evaluateAdminConfirm(req, { reason: "", typedConfirmText: "Post-42" }).ok, true);
});

test("destructive + reasonRequired: 둘 다 막히면 blockedBy 에 둘 다 담긴다", () => {
  const req = resolveAdminConfirmRequirements({ level: "destructive", confirmText: "X", reasonRequired: true });
  assert.deepEqual(evaluateAdminConfirm(req, { reason: "", typedConfirmText: "" }).blockedBy, ["reason", "confirmText"]);
  assert.equal(evaluateAdminConfirm(req, { reason: "사유", typedConfirmText: "X" }).ok, true);
});

// ── Enter 키로 실행되지 않음 ───────────────────────────────────────────────────

test("초기 포커스는 절대 확인 버튼이 아니다(사유 → 재입력 → 취소)", () => {
  assert.equal(adminConfirmInitialFocus(resolveAdminConfirmRequirements({ level: "critical" })), "reason");
  assert.equal(adminConfirmInitialFocus(resolveAdminConfirmRequirements({ level: "destructive", confirmText: "x" })), "confirmText");
  assert.equal(adminConfirmInitialFocus(resolveAdminConfirmRequirements({ level: "stateChange" })), "cancel");
  assert.equal(
    adminConfirmInitialFocus(resolveAdminConfirmRequirements({ level: "destructive", confirmText: "x", reasonRequired: true })),
    "reason"
  );
  for (const level of ADMIN_CONFIRM_LEVELS) {
    const focus: string = adminConfirmInitialFocus(resolveAdminConfirmRequirements({ level, confirmText: "x" }));
    assert.notEqual(focus, "confirm", level);
  }
});

test("Enter 차단 정책: INPUT/SELECT/컨테이너에서 막고, TEXTAREA(줄바꿈)·BUTTON(의도적 활성화)·IME 조합 중은 허용", () => {
  assert.equal(shouldBlockAdminConfirmEnterKey({ key: "Enter", tagName: "INPUT" }), true);
  assert.equal(shouldBlockAdminConfirmEnterKey({ key: "Enter", tagName: "select" }), true);
  assert.equal(shouldBlockAdminConfirmEnterKey({ key: "Enter", tagName: "DIV" }), true);
  assert.equal(shouldBlockAdminConfirmEnterKey({ key: "Enter", tagName: "TEXTAREA" }), false);
  assert.equal(shouldBlockAdminConfirmEnterKey({ key: "Enter", tagName: "BUTTON" }), false);
  assert.equal(shouldBlockAdminConfirmEnterKey({ key: "Enter", tagName: "INPUT", isComposing: true }), false);
  assert.equal(shouldBlockAdminConfirmEnterKey({ key: " ", tagName: "INPUT" }), false);
  assert.equal(shouldBlockAdminConfirmEnterKey({ key: "a", tagName: "DIV" }), false);
});

// ── ② 렌더 규칙 tripwire ──────────────────────────────────────────────────────

test("AdminConfirmDialog: 확인 버튼에 autoFocus 없음 · 다이얼로그 안 <form> 없음 · 버튼은 type=button · Enter 차단 배선", () => {
  const src = read("components/admin/AdminConfirmDialog.tsx");
  const code = stripComments(src);
  assert.ok(src.startsWith('"use client"'), "클라이언트 컴포넌트여야 함");
  assert.ok(!/autoFocus/.test(code), "autoFocus 금지 — Enter 한 번으로 실행되면 안 된다");
  assert.ok(!/<form\b/.test(code), "다이얼로그 안에 <form> 이 있으면 Enter 가 submit 을 일으킨다");
  assert.ok(!/type="submit"/.test(code), "다이얼로그 버튼은 모두 type=button");
  assert.ok(src.includes("adminConfirmInitialFocus(requirements)"), "초기 포커스 정책 미사용");
  assert.ok(src.includes("shouldBlockAdminConfirmEnterKey("), "Enter 차단 정책 미사용");
  assert.ok(src.includes("evaluateAdminConfirm(requirements"), "확인 가능 판정 미사용");
  assert.ok(src.includes('role="dialog"') && src.includes('aria-modal="true"') && src.includes("aria-labelledby"), "a11y 속성");
  assert.ok(src.includes('e.key === "Escape"'), "Esc 닫기");
  assert.ok(src.includes("disabled={!canConfirm}"), "판정 실패 시 확인 버튼 비활성");
});

test("ConfirmSubmitButton: 버튼 교체형 — formAction/name/value/form 보존 + requestSubmit(button) + 사유 hidden input", () => {
  const src = read("components/admin/ConfirmSubmitButton.tsx");
  assert.ok(src.startsWith('"use client"'));
  assert.ok(src.includes("ownerForm.requestSubmit(button)"), "submitter 보존 재제출 누락");
  for (const attr of ["formAction", "name", "value", "form"]) {
    assert.ok(new RegExp(`\\b${attr}=\\{`).test(src), `${attr} passthrough 누락`);
  }
  assert.ok(src.includes("e.preventDefault()"), "트리거 클릭은 제출이 아니라 다이얼로그 열기");
  assert.ok(src.includes('<input type="hidden" name={reasonFieldName} value={reason}'), "사유 hidden input 누락");
  assert.ok(src.includes("useFormStatus()"), "pending 연동 누락");
  assert.ok(src.includes("resolveAdminConfirmRequirements({ level, reasonRequired, confirmText, title: dialogTitle })"));
  // immediate 는 다이얼로그 없이 기존 버튼과 동일(type=submit)
  assert.ok(src.includes("if (!requirements.needsDialog)") && src.includes('type="submit"'));
  // props 계약: level 4종 + critical/destructive 의 summary 필수 + destructive 의 confirmText 필수
  assert.ok(src.includes('level: "critical"; summary: string'));
  assert.ok(src.includes('level: "destructive"; summary: string; confirmText: string'));
  assert.ok(src.includes("onConfirm?: (reason?: string) => Promise<void>"));
});

test("PR-1 범위: 아직 어떤 관리자 화면·액션도 ConfirmSubmitButton/AdminConfirmDialog 를 import 하지 않는다", () => {
  // 화면 이관은 PR-2(멘토 승인)부터다. 이 tripwire 는 PR-2 에서 의도적으로 갱신한다.
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(tsx?|mts)$/.test(name)) files.push(full);
    }
  };
  walk(join(ROOT, "app", "(admin)"));
  walk(join(ROOT, "components", "admin"));
  const importers = files.filter((f) => {
    const rel = f.slice(ROOT.length);
    if (/components\/admin\/(ConfirmSubmitButton|AdminConfirmDialog)\.tsx$/.test(rel)) return false;
    const src = readFileSync(f, "utf8");
    return /components\/admin\/(ConfirmSubmitButton|AdminConfirmDialog)"/.test(src);
  });
  // ConfirmSubmitButton 자신이 AdminConfirmDialog 를 import 하는 것만 허용
  assert.deepEqual(importers.map((f) => f.slice(ROOT.length)), []);
});
