// 계약 테스트: AdminPageLayout — 관리자 전용 페이지 틀(PR-1 §1).
// 실행: node --test --experimental-strip-types lib/admin/__contract__/adminPageLayout.contract.test.ts
//
// .tsx 는 node --test 로 import 할 수 없어 소스 스캔 tripwire 로 고정한다.
// 고정하는 것:
//   ① props 는 title · description? · actions? · children 만 — PageScaffold 의 안내 카드용 props
//      (sections/emptyState/loadingState/errorState/dataPoints/ctas/hideFooterPlaceholderCards) 를 받지 않는다
//   ② "준비 중"·"로딩"·"오류"·"참고" 안내 카드를 렌더하는 경로가 없다
//   ③ PageScaffold 를 import 하지 않고(서비스 화면 공용 — 손대지 않음), Server Component 다
//   ④ 이관 범위 허용 목록(PR-2 멘토 승인 · PR-3 환불) · PageScaffold 사용 12화면은 그대로

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const SRC = read("components/admin/AdminPageLayout.tsx");
/** 주석을 걷어낸 코드만 — 부정 단언이 설명 주석에 걸리지 않게 */
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const CODE = stripComments(SRC);

test("props 계약: title · description? · actions? · children 만 받는다", () => {
  assert.ok(SRC.includes("title: string;"));
  assert.ok(SRC.includes("description?: ReactNode;"));
  assert.ok(SRC.includes("actions?: ReactNode;"));
  assert.ok(SRC.includes("children: ReactNode;"));
  for (const forbidden of [
    "sections",
    "emptyState",
    "loadingState",
    "errorState",
    "dataPoints",
    "ctas",
    "hideFooterPlaceholderCards",
    "compactHero",
    "hideHero",
    "eyebrow",
  ]) {
    assert.ok(!new RegExp(`\\b${forbidden}\\??:`).test(SRC), `안내 카드용 prop ${forbidden} 금지`);
  }
});

test("안내 카드 렌더 경로 없음: '준비 중'·'로딩'·'오류'·'참고'·'표시 중' 문구가 JSX 에 없다", () => {
  for (const word of ["준비 중", "로딩", "오류", "참고", "표시 중"]) {
    assert.ok(!CODE.includes(word), `안내 카드 문구 '${word}' 가 코드에 있음`);
  }
  assert.ok(!/<article\b/.test(CODE), "카드 그리드(article) 없음");
});

test("PageScaffold 를 import 하지 않고, 'use client' 없는 Server Component 다", () => {
  assert.ok(!CODE.includes("PageScaffold"), "PageScaffold import/참조 금지(코드 기준)");
  assert.ok(!SRC.includes('components/shell/PageScaffold"'));
  assert.ok(!SRC.startsWith('"use client"'));
  assert.ok(SRC.includes("export function AdminPageLayout("));
  assert.ok(/<h1\b/.test(SRC), "h1 제목");
  assert.ok(SRC.includes("{children}"));
});

test("PageScaffold 본체는 이 PR 에서 손대지 않았다(서비스 화면 31곳 공용) — props 계약 원형 유지", () => {
  const scaffold = read("components/shell/PageScaffold.tsx");
  for (const prop of ["eyebrow?", "ctas?", "sections?", "emptyState?", "dataPoints?", "loadingState?", "errorState?", "hideFooterPlaceholderCards?", "compactHero?", "hideHero?"]) {
    assert.ok(scaffold.includes(prop), `PageScaffold prop ${prop} 유지`);
  }
  assert.ok(scaffold.includes('section.status === "connected" ? "표시 중" : "준비 중"'));
});

function walk(dir: string, out: string[]) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

/**
 * 이관 범위: AdminPageLayout · AdminStatusPill 을 import 하는 파일은 멘토 승인 작업대(PR-2)와 환불 화면(PR-3)뿐이다.
 * 다른 관리자 화면은 아직 이관하지 않았다(PR-4 이후). 새 화면을 이관할 때 이 허용 목록을 갱신한다.
 */
const PR2_LAYOUT_PILL_IMPORTERS = [
  "app/(admin)/admin/(console)/mentor-approval/page.tsx",
  "components/admin/MentorApprovalQueueList.tsx",
  "components/admin/MentorApprovalReviewPanel.tsx",
  // PR-3 환불 관리
  "app/(admin)/admin/(console)/refunds/page.tsx",
  "app/(admin)/admin/(console)/refunds/[id]/page.tsx",
  "components/admin/RefundQueueTable.tsx",
  // PR-5 콘텐츠 검수(목록·신고 상세) · 학적 변경 · 맞춤의뢰 주문
  "app/(admin)/admin/(console)/moderation/page.tsx",
  "app/(admin)/admin/(console)/reports/[id]/page.tsx",
  "components/admin/ContentReportQueueList.tsx",
  "app/(admin)/admin/(console)/academic-record-changes/page.tsx",
  "components/admin/AcademicRecordChangeQueueList.tsx",
  "components/admin/AcademicRecordChangeReviewPanel.tsx",
  "app/(admin)/admin/(console)/custom-request-orders/page.tsx",
];

test("이관 범위: AdminPageLayout/AdminStatusPill 을 import 하는 관리자 파일은 멘토 승인 작업대(PR-2)·환불 화면(PR-3)·PR-5 세 화면뿐이다", () => {
  const files = [...walk(join(ROOT, "app", "(admin)"), []), ...walk(join(ROOT, "components", "admin"), [])];
  const importers = files
    .filter((f) => !/components\/admin\/(AdminPageLayout|AdminStatusPill)\.tsx$/.test(f))
    .filter((f) => /components\/admin\/(AdminPageLayout|AdminStatusPill)"/.test(readFileSync(f, "utf8")))
    .map((f) => f.slice(ROOT.length).replace(/\\/g, "/"))
    .sort();
  assert.deepEqual(importers, [...PR2_LAYOUT_PILL_IMPORTERS].sort());
});

test("PageScaffold 를 쓰는 관리자 화면은 10곳이다(PR-3 환불 목록·상세 2화면 · PR-5 신고 상세·맞춤의뢰 주문 2화면 이관, 나머지 그대로)", () => {
  const files = walk(join(ROOT, "app", "(admin)"), []);
  const users = files.filter((f) => readFileSync(f, "utf8").includes("<PageScaffold")).map((f) => f.slice(ROOT.length + 1).replace(/\\/g, "/"));
  assert.equal(users.length, 10, users.join("\n"));
  assert.ok(!users.some((f) => /\/refunds\//.test(f)), "환불 목록·상세는 PageScaffold 를 쓰지 않는다");
  assert.ok(!users.some((f) => /\/(moderation|reports|academic-record-changes|custom-request-orders)\//.test(f)), "PR-5 세 화면(+신고 상세)은 PageScaffold 를 쓰지 않는다");
});
