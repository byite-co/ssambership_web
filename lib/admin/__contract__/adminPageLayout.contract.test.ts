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
  // PR-2b: 오늘 내가 처리한 건(현재 상태 배지)
  "components/admin/MentorApprovalTodayPanel.tsx",
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
  // PR-6 분쟁 목록·상세 · 신고 상세의 신고당한 사용자 블록
  "app/(admin)/admin/(console)/disputes/page.tsx",
  "app/(admin)/admin/(console)/disputes/[id]/page.tsx",
  "components/admin/DisputeQueueTable.tsx",
  "components/admin/ContentReportTargetUserPanel.tsx",
  // PR-7 계정 목록·계정 상세 허브
  "app/(admin)/admin/(console)/users/page.tsx",
  "app/(admin)/admin/(console)/users/[id]/page.tsx",
  "components/admin/AccountListTable.tsx",
  "components/admin/AccountDetailHeader.tsx",
  "components/admin/AccountMentorTab.tsx",
  "components/admin/AccountStudentTab.tsx",
  // PR-8 질문 · 연결노트 드릴다운(멘토별 화면 · 질문 상세 2라우트의 공통 틀 · 개별질문 탭 · 멘토별 질문 탭 · 대화 전문)
  "app/(admin)/admin/(console)/question-rooms/[roomId]/page.tsx",
  "components/admin/QuestionDetailScreen.tsx",
  "components/admin/AccountIndividualQuestionsTab.tsx",
  "components/admin/QuestionRoomThreadList.tsx",
  "components/admin/QuestionConversationView.tsx",
  // PR-9 정산 관리(3탭) · 충전 관리(조회 전용)
  "app/(admin)/admin/(console)/settlements/page.tsx",
  "components/admin/PayoutRunHistory.tsx",
  "app/(admin)/admin/(console)/topups/page.tsx",
  "components/admin/TopupQueueTable.tsx",
  // PR-10 공지·이벤트(유형·대상 배지) · 감사 로그 · 시스템 설정
  "app/(admin)/admin/(console)/notices/page.tsx",
  "components/admin/NoticeListTable.tsx",
  "app/(admin)/admin/(console)/audit-logs/page.tsx",
  "app/(admin)/admin/(console)/settings/page.tsx",
  // PR-11 커뮤니티 관리 · 리뷰 관리(목록·상세) · 등급 분류 · 멘토 활동
  "app/(admin)/admin/(console)/community-content/page.tsx",
  "components/admin/CommunityContentList.tsx",
  "app/(admin)/admin/(console)/reviews/page.tsx",
  "app/(admin)/admin/(console)/reviews/[reviewId]/page.tsx",
  "components/admin/ReviewQueueList.tsx",
  "app/(admin)/admin/(console)/school-classifications/page.tsx",
  "components/admin/SchoolClassificationPanels.tsx",
  "app/(admin)/admin/(console)/mentor-activity/page.tsx",
  // PR-12 대시보드(오늘 할 일 · 현황 · 최근 활동) · SLA 대시보드(건별 기한 4종 — 상태 배지)
  "app/(admin)/admin/(console)/dashboard/page.tsx",
  "app/(admin)/admin/(console)/sla/page.tsx",
  // PR-13 탈퇴 요청 현황(목록 · 상세 — 상태 배지는 account_deletion_jobs.state 사전)
  "app/(admin)/admin/(console)/deletions/page.tsx",
  "app/(admin)/admin/(console)/deletions/[id]/page.tsx",
  "components/admin/AccountDeletionQueueTable.tsx",
  "components/admin/AccountDeletionJobDetail.tsx",
];

test("이관 범위: AdminPageLayout/AdminStatusPill 을 import 하는 관리자 파일은 멘토 승인 작업대(PR-2)·환불 화면(PR-3)·PR-5 세 화면·PR-6 분쟁 화면·PR-7 계정 화면·PR-8 질문 드릴다운·PR-9 정산·충전 화면·PR-10 공지·감사 로그·설정 화면·PR-11 커뮤니티·리뷰·등급 분류·멘토 활동 화면·PR-12 대시보드·SLA 화면·PR-13 탈퇴 요청 화면뿐이다", () => {
  const files = [...walk(join(ROOT, "app", "(admin)"), []), ...walk(join(ROOT, "components", "admin"), [])];
  const importers = files
    .filter((f) => !/components\/admin\/(AdminPageLayout|AdminStatusPill)\.tsx$/.test(f))
    .filter((f) => /components\/admin\/(AdminPageLayout|AdminStatusPill)"/.test(readFileSync(f, "utf8")))
    .map((f) => f.slice(ROOT.length).replace(/\\/g, "/"))
    .sort();
  assert.deepEqual(importers, [...PR2_LAYOUT_PILL_IMPORTERS].sort());
});

test("PageScaffold 를 쓰는 관리자 화면은 0곳이다 — 콘솔 28라우트 전부 공통 부품 위(PR-12 에서 마지막 SLA 이관 · 대시보드·로그인은 처음부터 PageScaffold 미사용)", () => {
  const files = walk(join(ROOT, "app", "(admin)"), []);
  const users = files.filter((f) => readFileSync(f, "utf8").includes("<PageScaffold")).map((f) => f.slice(ROOT.length + 1).replace(/\\/g, "/"));
  assert.equal(users.length, 0, users.join("\n"));
  const importers = files.filter((f) => stripComments(readFileSync(f, "utf8")).includes("components/shell/PageScaffold")).map((f) => f.slice(ROOT.length + 1).replace(/\\/g, "/"));
  assert.deepEqual(importers, [], "관리자 라우트 트리에 PageScaffold import 0");
  assert.ok(!users.some((f) => /\/(sla|dashboard)\//.test(f)), "PR-12 SLA·대시보드는 PageScaffold 를 쓰지 않는다");
  assert.ok(!users.some((f) => /\/(reviews|mentor-activity|community-content|school-classifications)\//.test(f)), "PR-11 네 화면은 PageScaffold 를 쓰지 않는다");
  assert.ok(!users.some((f) => /\/(notices|audit-logs|settings)\//.test(f)), "PR-10 공지·감사 로그·설정은 PageScaffold 를 쓰지 않는다");
  assert.ok(!users.some((f) => /\/settlements\//.test(f)), "PR-9 정산 관리는 PageScaffold 를 쓰지 않는다(준비 중 카드 제거)");
  assert.ok(!users.some((f) => /\/users\/|\/mentor-approvals\//.test(f)), "PR-7 계정 목록·상세와 구 멘토 승인 상세(리다이렉트)는 PageScaffold 를 쓰지 않는다");
  assert.ok(!users.some((f) => /\/disputes\//.test(f)), "PR-6 분쟁 목록·상세는 PageScaffold 를 쓰지 않는다");
  assert.ok(!users.some((f) => /\/refunds\//.test(f)), "환불 목록·상세는 PageScaffold 를 쓰지 않는다");
  assert.ok(!users.some((f) => /\/(moderation|reports|academic-record-changes|custom-request-orders)\//.test(f)), "PR-5 세 화면(+신고 상세)은 PageScaffold 를 쓰지 않는다");
});
