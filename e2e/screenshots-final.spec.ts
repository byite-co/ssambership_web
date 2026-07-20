/**
 * 상태별 전체 화면 스크린샷 v2 — 데스크탑(1440) + 모바일(390).
 * 각 화면의 상태별 + 학생/멘토/관리자 시점 + 폼/빈상태/약관까지.
 * 모바일 가로 overflow(scrollWidth>390) 자동 검출 → 보고.
 * 막히는 화면은 기록 후 다음으로(멈추지 않음).
 *
 * 실행: npx playwright test screenshots-v2 --reporter=list
 * 저장: screenshots_final/desktop/*.png , screenshots_final/mobile/*.png
 * 결과: screenshots_final/result-<viewport>.json (성공/실패/overflow)
 */
import { test } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { admin } from "./helpers/db";

const PW = "Local!Test1234";

const VIEWPORTS = [
  { tag: "desktop", width: 1440, height: 900 },
  { tag: "mobile", width: 390, height: 844 },
];

type Vp = (typeof VIEWPORTS)[number];
type Target = { name: string; route: string | null; prep?: (page: Page) => Promise<void> };

const okList: string[] = [];
const failList: string[] = [];
const overflowList: string[] = [];
const skipList: string[] = [];
const notFoundList: string[] = []; // P9: 404/빈 껍데기 화면

async function expectFilled(page: Page, sel: string, value: string): Promise<void> {
  const loc = page.locator(sel).first();
  for (let i = 0; i < 5; i++) {
    const v = await loc.inputValue().catch(() => "");
    if (v === value) return;
    await loc.fill(value).catch(() => undefined);
    await page.waitForTimeout(300);
  }
}

async function loginAs(page: Page, email: string, role: "student" | "mentor" | "admin"): Promise<void> {
  const path = role === "admin" ? "/admin/login" : `/login/${role}`;
  await page.goto(path, { waitUntil: "domcontentloaded" });
  const emailIn = page.locator('input[type="email"]').first();
  await emailIn.waitFor({ state: "visible", timeout: 30_000 });
  await page.waitForTimeout(1800);
  await emailIn.fill(email);
  await page.locator('input[type="password"]').first().fill(PW);
  await expectFilled(page, 'input[type="email"]', email);
  await page.waitForTimeout(250);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 30_000 }).catch(() => undefined);
  await page.waitForTimeout(1800);
  if (page.url().includes("/login")) throw new Error(`로그인 실패: ${email} — ${page.url()}`);
}

async function capture(page: Page, dir: string, vp: Vp, t: Target): Promise<void> {
  const label = `[${vp.tag}] ${t.name}`;
  if (!t.route) {
    skipList.push(`${label} (id 없음)`);
    return;
  }
  try {
    await page.goto(t.route, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.waitForTimeout(1300);
    if (t.prep) await t.prep(page).catch(() => undefined);
    await page.waitForTimeout(300);
    // P9: 404 / 빈 껍데기 감지(스크린샷은 계속 찍되 목록에 기록).
    const body = await page
      .evaluate(() => {
        const txt = (document.body?.innerText || "").trim();
        return { head: txt.slice(0, 300), len: txt.length };
      })
      .catch(() => ({ head: "", len: 0 }));
    if (/this page could not be found|페이지를 찾을 수 없|찾을 수 없습니다|404 not found/i.test(body.head)) {
      notFoundList.push(`${label} (${t.route}) 404/notfound`);
    } else if (body.len < 40) {
      notFoundList.push(`${label} (${t.route}) empty-shell(len=${body.len})`);
    }
    // P9: 긴 fullPage 캡처 시 sticky/fixed 헤더가 중복 스티칭되는 문제 — 실제 sticky/fixed만 static으로.
    await page
      .evaluate(() => {
        document.querySelectorAll("*").forEach((el) => {
          const pos = getComputedStyle(el).position;
          if (pos === "sticky" || pos === "fixed") (el as HTMLElement).style.position = "static";
        });
      })
      .catch(() => undefined);
    await page.waitForTimeout(150);
    await page.screenshot({ path: join(dir, `${t.name}.png`), fullPage: true });
    let extra = "";
    if (vp.tag === "mobile") {
      const sw = await page.evaluate(() => document.documentElement.scrollWidth).catch(() => 0);
      if (sw > vp.width + 2) {
        extra = `  ⚠OVERFLOW ${sw}px`;
        overflowList.push(`${t.name} (${t.route}) scrollWidth=${sw}>${vp.width}`);
      }
    }
    okList.push(`OK   ${label}  (${t.route})${extra}`);
  } catch (e) {
    failList.push(`FAIL ${label}  (${t.route})  ${(e as Error).message.split("\n")[0]}`);
  }
}

async function captureAll(page: Page, dir: string, vp: Vp, targets: Target[]): Promise<void> {
  for (const t of targets) await capture(page, dir, vp, t);
}

async function byEmail(email: string): Promise<string | null> {
  try {
    const { data } = await admin().from("users").select("id").eq("email", email).maybeSingle();
    return (data as { id?: string } | null)?.id ?? null;
  } catch {
    return null;
  }
}

async function resolveIds() {
  const a = admin();
  const studentId = await byEmail("local.student@ssam.test");
  const mentorPriced = await byEmail("local.mentor.priced@ssam.test");
  const mentorUnpriced = await byEmail("local.mentor.unpriced@ssam.test");
  const sm1 = await byEmail("seed.mentor1@ssam.test");
  const sm2 = await byEmail("seed.mentor2@ssam.test");
  const sm4 = await byEmail("seed.mentor4@ssam.test");
  const sm5 = await byEmail("seed.mentor5@ssam.test");
  const sm6 = await byEmail("seed.mentor6@ssam.test");

  const rooms: Record<string, string | null> = { priced: null, empty: null, expired: null };
  if (studentId) {
    const { data } = await a.from("mentor_student_rooms").select("id,mentor_id").eq("student_id", studentId);
    for (const r of (data as Array<{ id: string; mentor_id: string }> | null) ?? []) {
      if (r.mentor_id === mentorPriced) rooms.priced = r.id;
      else if (r.mentor_id === mentorUnpriced) rooms.empty = r.id;
      else if (r.mentor_id === sm1) rooms.expired = r.id;
    }
  }

  const threads: Record<string, string | null> = { pending: null, answered: null, confirmed: null };
  if (rooms.priced) {
    const { data } = await a.from("question_threads").select("id,title,status").eq("mentor_student_room_id", rooms.priced);
    for (const t of (data as Array<{ id: string; title: string; status: string }> | null) ?? []) {
      if (t.title === "[v2] thread-answered") threads.answered = t.id;
      else if (t.title === "[v2] thread-confirmed") threads.confirmed = t.id;
      else if (t.title === "[local-seed-rich] thread-1") threads.pending = t.id;
    }
  }

  const iq: Record<string, string | null> = { open: null, assigned: null, claimed: null, answered: null, released: null };
  if (studentId) {
    const { data } = await a
      .from("individual_questions")
      .select("id,status,created_at")
      .eq("student_id", studentId)
      .order("created_at", { ascending: false });
    for (const r of (data as Array<{ id: string; status: string }> | null) ?? []) {
      if (r.status in iq && !iq[r.status]) iq[r.status] = r.id;
    }
  }

  const cr: Record<string, string | null> = {
    open: null, pending: null, delivered: null, revision_requested: null, completed: null, disputed: null,
  };
  if (studentId && mentorPriced) {
    const { data } = await a
      .from("custom_request_orders")
      .select("id,status")
      .eq("student_id", studentId)
      .eq("mentor_id", mentorPriced);
    for (const r of (data as Array<{ id: string; status: string }> | null) ?? []) {
      if (r.status in cr && !cr[r.status]) cr[r.status] = r.id;
    }
  }

  let crPost: string | null = null;
  if (studentId) {
    const { data } = await a
      .from("custom_request_posts")
      .select("id")
      .eq("student_id", studentId)
      .order("created_at", { ascending: false })
      .limit(1);
    crPost = (data as Array<{ id: string }> | null)?.[0]?.id ?? null;
  }

  const boardPost = await (async () => {
    const { data } = await a.from("community_posts").select("id").eq("title", "[v2] 댓글많은 글").maybeSingle();
    return (data as { id?: string } | null)?.id ?? null;
  })();
  const shortPost = await (async () => {
    const { data } = await a.from("shortform_posts").select("id").like("title", "[v2]%").limit(1);
    return (data as Array<{ id: string }> | null)?.[0]?.id ?? null;
  })();

  const disputeId = await (async () => {
    // 학생/멘토 양시점 열람 가능하도록 local.student 주문의 분쟁을 우선 선택.
    if (studentId) {
      const { data: myOrders } = await a.from("custom_request_orders").select("id").eq("student_id", studentId);
      const orderIds = ((myOrders as Array<{ id: string }> | null) ?? []).map((o) => o.id);
      if (orderIds.length) {
        const { data: scoped } = await a.from("disputes").select("id").in("custom_request_order_id", orderIds).limit(1);
        const sid = (scoped as Array<{ id: string }> | null)?.[0]?.id;
        if (sid) return sid;
      }
    }
    const { data } = await a.from("disputes").select("id").limit(1);
    return (data as Array<{ id: string }> | null)?.[0]?.id ?? null;
  })();
  const reportId = await (async () => {
    const { data } = await a.from("content_reports").select("id").eq("status", "pending").limit(1);
    return (data as Array<{ id: string }> | null)?.[0]?.id ?? null;
  })();
  const refundId = await (async () => {
    const { data } = await a.from("refunds").select("id").limit(1);
    return (data as Array<{ id: string }> | null)?.[0]?.id ?? null;
  })();
  const reviewId = await (async () => {
    const { data } = await a.from("reviews").select("id").limit(1);
    return (data as Array<{ id: string }> | null)?.[0]?.id ?? null;
  })();
  const approvalId = sm4; // pending mentor user_id == approvals row id (mentor_profiles.user_id)

  // cancel/past_due 구독 id (환불 폼 deep-link 용)
  let cancelSubId: string | null = null;
  if (studentId && sm2) {
    const { data } = await a.from("subscriptions").select("id").eq("student_id", studentId).eq("mentor_id", sm2).limit(1);
    cancelSubId = (data as Array<{ id: string }> | null)?.[0]?.id ?? null;
  }

  return {
    studentId, mentorPriced, mentorUnpriced, sm1, sm2, sm4, sm5, sm6,
    rooms, threads, iq, cr, crPost, boardPost, shortPost,
    disputeId, reportId, refundId, reviewId, approvalId, cancelSubId,
  };
}

type Ids = Awaited<ReturnType<typeof resolveIds>>;

// ─────────────────────────── 타깃 정의 ───────────────────────────
function publicTargets(d: Ids): Target[] {
  return [
    { name: "public-landing", route: "/" },
    { name: "public-mentors", route: "/mentors" },
    { name: "public-mentor-detail", route: d.mentorPriced ? `/mentors/${d.mentorPriced}` : null },
    { name: "public-pricing", route: "/pricing" },
    { name: "public-payments", route: "/payments" },
    { name: "public-cash", route: "/cash" },
    { name: "public-community", route: "/community" },
    { name: "public-community-board", route: "/community/board" },
    { name: "public-community-board-detail", route: d.boardPost ? `/community/board/${d.boardPost}` : null },
    { name: "public-community-posts", route: "/community/posts" },
    { name: "public-community-shortform", route: "/community/shortform" },
    { name: "public-community-shortform-detail", route: d.shortPost ? `/community/shortform/${d.shortPost}` : null },
    { name: "public-community-shorts", route: "/community/shorts" },
    { name: "public-custom-request", route: "/custom-request" },
    { name: "public-custom-request-detail", route: d.crPost ? `/custom-request/${d.crPost}` : null },
    { name: "public-notices", route: "/notices" },
    { name: "public-support", route: "/support" },
    { name: "legal-terms", route: "/legal/terms" },
    { name: "legal-privacy", route: "/legal/privacy" },
    { name: "legal-refund", route: "/legal/refund" },
    { name: "legal-community-guidelines", route: "/legal/community-guidelines" },
    { name: "legal-copyright", route: "/legal/copyright" },
    { name: "legal-minor-consent", route: "/legal/minor-consent" },
    { name: "legal-no-ghostwriting", route: "/legal/no-ghostwriting" },
    { name: "legal-mentor-guide", route: "/legal/mentor-guide" },
    { name: "legal-no-offplatform-contact", route: "/legal/no-offplatform-contact" },
    { name: "legal-payout-guide", route: "/legal/payout-guide" },
    { name: "auth-login-student", route: "/login/student" },
    { name: "auth-login-mentor", route: "/login/mentor" },
    { name: "auth-signup", route: "/signup" },
    { name: "auth-forgot-password", route: "/forgot-password" },
    { name: "auth-update-password", route: "/auth/update-password" },
    { name: "error-404", route: "/__no_such_route_xyz__" },
  ];
}

function studentTargets(d: Ids): Target[] {
  const fillCustomReq = async (page: Page) => {
    await page.locator("input").first().fill("[데모] 미적분 오답노트 첨삭 의뢰").catch(() => undefined);
    const ta = page.locator("textarea").first();
    await ta.fill("이차함수·미분 단원 오답 10문항 풀이 과정을 단계별로 첨삭 받고 싶습니다.").catch(() => undefined);
  };
  const fillCharge = async (page: Page) => {
    const amt = page.locator('input[type="number"], input[inputmode="numeric"]').first();
    await amt.fill("50000").catch(() => undefined);
  };
  return [
    { name: "student-home", route: "/home" },
    { name: "student-mypage", route: "/mypage" },
    { name: "student-subscriptions-all-states", route: "/subscriptions" },
    { name: "student-questionroom-list", route: "/question-room" },
    { name: "student-questionroom-rich", route: d.rooms.priced ? `/question-room/${d.rooms.priced}` : null },
    { name: "student-questionroom-empty", route: d.rooms.empty ? `/question-room/${d.rooms.empty}` : null },
    { name: "student-questionroom-expired", route: d.rooms.expired ? `/question-room/${d.rooms.expired}` : null },
    { name: "student-thread-pending", route: d.rooms.priced && d.threads.pending ? `/question-room/${d.rooms.priced}/thread/${d.threads.pending}` : null },
    { name: "student-thread-answered", route: d.rooms.priced && d.threads.answered ? `/question-room/${d.rooms.priced}/thread/${d.threads.answered}` : null },
    { name: "student-thread-confirmed", route: d.rooms.priced && d.threads.confirmed ? `/question-room/${d.rooms.priced}/thread/${d.threads.confirmed}` : null },
    { name: "student-notes", route: "/notes" },
    { name: "student-iq-list", route: "/individual-questions" },
    { name: "student-iq-open", route: d.iq.open ? `/individual-questions/${d.iq.open}` : null },
    { name: "student-iq-assigned", route: d.iq.assigned ? `/individual-questions/${d.iq.assigned}` : null },
    { name: "student-iq-claimed", route: d.iq.claimed ? `/individual-questions/${d.iq.claimed}` : null },
    { name: "student-iq-answered", route: d.iq.answered ? `/individual-questions/${d.iq.answered}` : null },
    { name: "student-iq-released", route: d.iq.released ? `/individual-questions/${d.iq.released}` : null },
    { name: "student-iq-new-form", route: "/individual-questions/new" },
    { name: "student-iq-new-designated-form", route: d.mentorPriced ? `/mentors/${d.mentorPriced}/individual-question/new` : null },
    { name: "student-wallet", route: "/wallet" },
    { name: "student-wallet-charge-form", route: "/wallet/charge" },
    { name: "student-wallet-charge-filled", route: "/wallet/charge", prep: fillCharge },
    { name: "student-wallet-ledger", route: "/wallet/ledger" },
    { name: "student-cash-history", route: "/cash-history" },
    { name: "student-subscribe-form", route: d.mentorPriced ? `/subscribe?mentorId=${d.mentorPriced}&plan=standard` : "/subscribe" },
    { name: "student-subscribe-success", route: "/subscribe/success" },
    { name: "student-subscribe-fail", route: "/subscribe/fail" },
    { name: "student-subscribe-cancelled", route: "/subscribe/cancelled" },
    { name: "student-custom-request-posts", route: "/custom-request/posts" },
    { name: "student-custom-request-new-form", route: "/custom-request/new" },
    { name: "student-custom-request-new-filled", route: "/custom-request/new", prep: fillCustomReq },
    { name: "student-custom-request-applications", route: d.crPost ? `/custom-request/${d.crPost}/applications` : null },
    { name: "student-custom-request-applications-waiting", route: d.crPost ? `/custom-request/${d.crPost}/applications/waiting` : null },
    { name: "student-cr-order-pending", route: d.cr.pending ? `/custom-request/orders/${d.cr.pending}` : null },
    { name: "student-cr-order-open", route: d.cr.open ? `/custom-request/orders/${d.cr.open}` : null },
    { name: "student-cr-order-delivered", route: d.cr.delivered ? `/custom-request/orders/${d.cr.delivered}` : null },
    { name: "student-cr-order-revision", route: d.cr.revision_requested ? `/custom-request/orders/${d.cr.revision_requested}` : null },
    { name: "student-cr-order-completed", route: d.cr.completed ? `/custom-request/orders/${d.cr.completed}` : null },
    { name: "student-cr-order-disputed", route: d.cr.disputed ? `/custom-request/orders/${d.cr.disputed}` : null },
    { name: "student-cr-order-complete-page", route: d.cr.completed ? `/custom-request/orders/${d.cr.completed}/complete` : null },
    { name: "student-cr-order-review", route: d.cr.completed ? `/custom-request/orders/${d.cr.completed}/review` : null },
    { name: "student-support-refunds", route: "/support/refunds" },
    { name: "student-support-refunds-form", route: d.cancelSubId ? `/support/refunds?subscriptionId=${d.cancelSubId}` : null },
    { name: "student-support-disputes", route: "/support/disputes" },
    { name: "student-support-dispute-detail", route: d.disputeId ? `/support/disputes/${d.disputeId}` : null },
    { name: "student-support-reports", route: "/support/reports" },
    { name: "student-notifications", route: "/notifications" },
  ];
}

function emptyStudentTargets(): Target[] {
  return [
    { name: "empty-questionroom", route: "/question-room" },
    { name: "empty-iq", route: "/individual-questions" },
    { name: "empty-notifications", route: "/notifications" },
    { name: "empty-wallet-ledger", route: "/wallet/ledger" },
    { name: "empty-subscriptions", route: "/subscriptions" },
    { name: "empty-custom-request-posts", route: "/custom-request/posts" },
    { name: "empty-notes", route: "/notes" },
    { name: "empty-mypage", route: "/mypage" },
  ];
}

function mentorTargets(d: Ids): Target[] {
  return [
    // NOTE: /mentor/dashboard 는 page.tsx 없음(404) — 멘토 홈은 /mentor/mypage. 캡처 제외.
    { name: "mentor-mypage", route: "/mentor/mypage" },
    { name: "mentor-profile", route: "/mentor/profile" },
    { name: "mentor-profile-edit", route: "/mentor/profile/edit" },
    { name: "mentor-verification-approved", route: "/mentor/verification" },
    { name: "mentor-questionroom-list", route: "/mentor/question-room" },
    { name: "mentor-questionroom-rich", route: d.rooms.priced ? `/mentor/question-room/${d.rooms.priced}` : null },
    { name: "mentor-thread-pending", route: d.rooms.priced && d.threads.pending ? `/mentor/question-room/${d.rooms.priced}/thread/${d.threads.pending}` : null },
    { name: "mentor-thread-answered", route: d.rooms.priced && d.threads.answered ? `/mentor/question-room/${d.rooms.priced}/thread/${d.threads.answered}` : null },
    { name: "mentor-thread-confirmed", route: d.rooms.priced && d.threads.confirmed ? `/mentor/question-room/${d.rooms.priced}/thread/${d.threads.confirmed}` : null },
    { name: "mentor-iq-list", route: "/mentor/individual-questions" },
    { name: "mentor-iq-assigned", route: d.iq.assigned ? `/mentor/individual-questions/${d.iq.assigned}` : null },
    { name: "mentor-iq-claimed", route: d.iq.claimed ? `/mentor/individual-questions/${d.iq.claimed}` : null },
    { name: "mentor-iq-answered", route: d.iq.answered ? `/mentor/individual-questions/${d.iq.answered}` : null },
    { name: "mentor-iq-released", route: d.iq.released ? `/mentor/individual-questions/${d.iq.released}` : null },
    { name: "mentor-custom-request", route: "/mentor/custom-request" },
    { name: "mentor-cr-dashboard", route: "/mentor/custom-request/dashboard" },
    { name: "mentor-cr-orders", route: "/mentor/custom-request/orders" },
    { name: "mentor-cr-order-open", route: d.cr.open ? `/mentor/custom-request/orders/${d.cr.open}` : null },
    { name: "mentor-cr-order-delivered", route: d.cr.delivered ? `/mentor/custom-request/orders/${d.cr.delivered}` : null },
    { name: "mentor-cr-order-revision", route: d.cr.revision_requested ? `/mentor/custom-request/orders/${d.cr.revision_requested}` : null },
    { name: "mentor-cr-order-completed", route: d.cr.completed ? `/mentor/custom-request/orders/${d.cr.completed}` : null },
    { name: "mentor-cr-order-disputed", route: d.cr.disputed ? `/mentor/custom-request/orders/${d.cr.disputed}` : null },
    { name: "mentor-cr-order-files", route: d.cr.delivered ? `/mentor/custom-request/orders/${d.cr.delivered}/files` : null },
    { name: "mentor-cr-order-room", route: d.cr.open ? `/mentor/custom-request/orders/${d.cr.open}/room` : null },
    { name: "mentor-cr-order-revision-form", route: d.cr.revision_requested ? `/mentor/custom-request/orders/${d.cr.revision_requested}/revision` : null },
    { name: "mentor-cr-order-waiting-review", route: d.cr.delivered ? `/mentor/custom-request/orders/${d.cr.delivered}/waiting-review` : null },
    { name: "mentor-cr-posts", route: "/mentor/custom-request/posts" },
    { name: "mentor-cr-post-detail", route: d.crPost ? `/mentor/custom-request/posts/${d.crPost}` : null },
    { name: "mentor-cr-post-apply-form", route: d.crPost ? `/mentor/custom-request/posts/${d.crPost}/apply` : null },
    { name: "mentor-payouts", route: "/mentor/payouts" },
    { name: "mentor-payouts-detail", route: "/mentor/payouts/detail" },
    { name: "mentor-reviews", route: "/mentor/reviews" },
    { name: "mentor-channel", route: "/mentor/channel" },
    { name: "mentor-community-new", route: "/mentor/community/new" },
    { name: "mentor-academic-record-change", route: "/mentor/academic-record-change" },
    { name: "mentor-support-disputes", route: "/mentor/support/disputes" },
    { name: "mentor-support-dispute-detail", route: d.disputeId ? `/mentor/support/disputes/${d.disputeId}` : null },
  ];
}

// 관리자 캡처는 현재 비활성(보존용) — 재활성 시 _ 접두 제거 후 타깃 목록에 합류.
function _adminTargets(d: Ids): Target[] {
  return [
    { name: "admin-dashboard", route: "/admin/dashboard" },
    { name: "admin-users", route: "/admin/users" },
    { name: "admin-mentors", route: "/admin/mentors" },
    { name: "admin-mentor-approval", route: "/admin/mentor-approval" },
    { name: "admin-mentor-approvals", route: "/admin/mentor-approvals" },
    { name: "admin-mentor-approvals-detail", route: d.approvalId ? `/admin/mentor-approvals/${d.approvalId}` : null },
    { name: "admin-mentor-activity", route: "/admin/mentor-activity" },
    { name: "admin-sla", route: "/admin/sla" },
    { name: "admin-moderation", route: "/admin/moderation" },
    { name: "admin-community-content", route: "/admin/community-content" },
    { name: "admin-reports", route: "/admin/reports" },
    { name: "admin-reports-detail", route: d.reportId ? `/admin/reports/${d.reportId}` : null },
    { name: "admin-reviews", route: "/admin/reviews" },
    { name: "admin-reviews-detail", route: d.reviewId ? `/admin/reviews/${d.reviewId}` : null },
    { name: "admin-disputes", route: "/admin/disputes" },
    { name: "admin-disputes-detail", route: d.disputeId ? `/admin/disputes/${d.disputeId}` : null },
    { name: "admin-refunds", route: "/admin/refunds" },
    { name: "admin-refunds-mentor-sla", route: "/admin/refunds?type=subscription_mentor_suspended&sort=deadline" },
    { name: "admin-refunds-detail", route: d.refundId ? `/admin/refunds/${d.refundId}` : null },
    { name: "admin-refunds-settlement", route: "/admin/refunds-settlement" },
    { name: "admin-custom-request-orders", route: "/admin/custom-request-orders" },
    { name: "admin-settlements", route: "/admin/settlements" },
    { name: "admin-notices", route: "/admin/notices" },
    { name: "admin-audit-logs", route: "/admin/audit-logs" },
    { name: "admin-settings", route: "/admin/settings" },
    { name: "admin-school-classifications", route: "/admin/school-classifications" },
    { name: "admin-academic-record-changes", route: "/admin/academic-record-changes" },
  ];
}

for (const vp of VIEWPORTS) {
  test.describe(`screenshots-v2-${vp.tag}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test(`capture ${vp.tag}`, async ({ page, context }) => {
      test.setTimeout(3_600_000); // 60분
      const dir = join(process.cwd(), "screenshots_final", vp.tag);
      mkdirSync(dir, { recursive: true });

      const d = await resolveIds();

      // 공개(로그아웃)
      await context.clearCookies();
      await captureAll(page, dir, vp, publicTargets(d));

      // 학생(리치)
      await context.clearCookies();
      try {
        await loginAs(page, "local.student@ssam.test", "student");
        await captureAll(page, dir, vp, studentTargets(d));
      } catch (e) {
        failList.push(`FAIL [${vp.tag}] student-login ${(e as Error).message.split("\n")[0]}`);
      }

      // 빈 상태 학생
      await context.clearCookies();
      try {
        await loginAs(page, "seed.student4@ssam.test", "student");
        await captureAll(page, dir, vp, emptyStudentTargets());
      } catch (e) {
        failList.push(`FAIL [${vp.tag}] empty-student-login ${(e as Error).message.split("\n")[0]}`);
      }

      // 멘토(리치, priced)
      await context.clearCookies();
      try {
        await loginAs(page, "local.mentor.priced@ssam.test", "mentor");
        await captureAll(page, dir, vp, mentorTargets(d));
      } catch (e) {
        failList.push(`FAIL [${vp.tag}] mentor-login ${(e as Error).message.split("\n")[0]}`);
      }

      // 멘토 활동중단/인증 상태 (개별 로그인)
      const mentorStateLogins: Array<[string, Target]> = [
        ["seed.mentor1@ssam.test", { name: "mentor-activity-terminating", route: "/mentor/mypage" }],
        ["seed.mentor2@ssam.test", { name: "mentor-activity-paused", route: "/mentor/mypage" }],
        ["seed.mentor4@ssam.test", { name: "mentor-verification-pending", route: "/mentor/verification" }],
        ["seed.mentor5@ssam.test", { name: "mentor-verification-rejected", route: "/mentor/verification" }],
        ["seed.mentor6@ssam.test", { name: "mentor-verification-unsubmitted", route: "/mentor/verification" }],
      ];
      for (const [email, t] of mentorStateLogins) {
        await context.clearCookies();
        try {
          await loginAs(page, email, "mentor");
          await capture(page, dir, vp, t);
        } catch (e) {
          failList.push(`FAIL [${vp.tag}] ${t.name}-login ${(e as Error).message.split("\n")[0]}`);
        }
      }

      // 관리자(admin) — 프로젝트 원칙상 캡처 제외(미접근).

      // 결과 저장
      const summary = {
        viewport: vp.tag,
        ok: okList.filter((r) => r.includes(`[${vp.tag}]`)).length,
        fail: failList.filter((r) => r.includes(`[${vp.tag}]`)),
        overflow: vp.tag === "mobile" ? overflowList : [],
        skip: skipList.filter((r) => r.includes(`[${vp.tag}]`)),
        notFound: notFoundList.filter((r) => r.includes(`[${vp.tag}]`)),
      };
      writeFileSync(join(process.cwd(), "screenshots_final", `result-${vp.tag}.json`), JSON.stringify(summary, null, 2));
      console.log(`\n===== [${vp.tag}] OK=${summary.ok} FAIL=${summary.fail.length} SKIP=${summary.skip.length} OVERFLOW=${summary.overflow.length} NOTFOUND=${summary.notFound.length} =====`);
      for (const r of summary.fail) console.log(r);
      for (const r of summary.overflow) console.log("OVERFLOW " + r);
      for (const r of summary.notFound) console.log("NOTFOUND " + r);
      for (const r of summary.skip) console.log(r);
    });
  });
}
