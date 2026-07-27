/**
 * 전체 화면 스크린샷 — 데스크탑(1440) + 모바일(390).
 * 시드 계정으로 로그인해 공개/학생/멘토/관리자 화면을 캡처.
 * 막히는 화면은 기록 후 다음으로(멈추지 않음).
 *
 * 실행: npx playwright test screenshots --reporter=list
 * 저장: screenshots/desktop/*.png , screenshots/mobile/*.png
 */
import { test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { ACCOUNTS, login } from "./helpers/auth";
import { admin } from "./helpers/db";

/** firstId 에서 쓰는 최소 표면 — supabase 빌더 깊은 제네릭 대신 구조 타입으로 고정. */
type FirstIdQuery = {
  eq(column: string, value: unknown): FirstIdQuery;
} & PromiseLike<{ data: Array<{ id?: string }> | null }>;

async function firstId(table: string, filter?: (q: FirstIdQuery) => FirstIdQuery): Promise<string | null> {
  try {
    let q = admin().from(table).select("id").limit(1) as unknown as FirstIdQuery;
    if (filter) q = filter(q);
    const { data } = await q;
    const row = (data as Array<{ id?: string }> | null)?.[0];
    return row?.id ?? null;
  } catch {
    return null;
  }
}

const VIEWPORTS = [
  { tag: "desktop", width: 1440, height: 900 },
  { tag: "mobile", width: 390, height: 844 },
];

async function capture(page: Page, dir: string, name: string, route: string, results: string[]): Promise<void> {
  try {
    await page.goto(route, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.waitForTimeout(1600);
    await page.screenshot({ path: join(dir, `${name}.png`), fullPage: true });
    results.push(`OK   ${name}  (${route})`);
  } catch (e) {
    results.push(`FAIL ${name}  (${route})  ${(e as Error).message.split("\n")[0]}`);
  }
}

for (const vp of VIEWPORTS) {
  test.describe(`screenshots-${vp.tag}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test(`capture ${vp.tag}`, async ({ page, context }) => {
      test.setTimeout(900_000);
      const dir = join(process.cwd(), "screenshots", vp.tag);
      mkdirSync(dir, { recursive: true });
      const results: string[] = [];

      // 동적 ID 수집
      const mentorId = await (async () => {
        try {
          const { data } = await admin().from("users").select("id").eq("email", "local.mentor.priced@ssam.test").maybeSingle();
          return (data as { id?: string } | null)?.id ?? null;
        } catch {
          return null;
        }
      })();
      const studentId = await (async () => {
        try {
          const { data } = await admin().from("users").select("id").eq("email", "local.student@ssam.test").maybeSingle();
          return (data as { id?: string } | null)?.id ?? null;
        } catch {
          return null;
        }
      })();
      const boardId = await firstId("community_posts");
      const shortId = await firstId("shortform_posts");
      const roomId = studentId ? await firstId("mentor_student_rooms", (q) => q.eq("student_id", studentId)) : null;

      // ── 공개(로그아웃) ──
      await context.clearCookies();
      const publicRoutes: Array<[string, string | null]> = [
        ["public-landing", "/"],
        ["public-mentors", "/mentors"],
        ["public-mentor-detail", mentorId ? `/mentors/${mentorId}` : null],
        ["public-community", "/community"],
        ["public-community-shortform", "/community/shortform"],
        ["public-community-board-detail", boardId ? `/community/board/${boardId}` : null],
        ["public-community-shortform-detail", shortId ? `/community/shortform/${shortId}` : null],
        ["public-login-student", "/login/student"],
        ["public-login-mentor", "/login/mentor"],
        ["public-login-admin", "/admin/login"],
        ["public-signup", "/signup"],
      ];
      for (const [name, route] of publicRoutes) {
        if (route) await capture(page, dir, name, route, results);
        else results.push(`SKIP ${name} (id 없음)`);
      }

      // ── 학생 ──
      await context.clearCookies();
      try {
        await login(page, ACCOUNTS.student);
        const studentRoutes: Array<[string, string | null]> = [
          ["student-mypage", "/mypage"],
          ["student-subscriptions", "/subscriptions"],
          ["student-refunds", "/support/refunds"],
          ["student-wallet-charge", "/wallet/charge"],
          ["student-wallet-ledger", "/wallet/ledger"],
          ["student-question-room", "/question-room"],
          ["student-question-room-detail", roomId ? `/question-room/${roomId}` : null],
          ["student-custom-request", "/custom-request"],
          ["student-notifications", "/notifications"],
        ];
        for (const [name, route] of studentRoutes) {
          if (route) await capture(page, dir, name, route, results);
          else results.push(`SKIP ${name} (id 없음)`);
        }
      } catch (e) {
        results.push(`FAIL student-login ${(e as Error).message.split("\n")[0]}`);
      }

      // ── 멘토 ──
      await context.clearCookies();
      try {
        await login(page, ACCOUNTS.mentor);
        const mentorRoutes: Array<[string, string]> = [
          ["mentor-dashboard", "/mentor/dashboard"],
          ["mentor-mypage", "/mentor/mypage"],
          ["mentor-profile-edit", "/mentor/profile/edit"],
          ["mentor-verification", "/mentor/verification"],
          ["mentor-question-room", "/mentor/question-room"],
          ["mentor-payouts", "/mentor/payouts"],
          ["mentor-custom-request-dashboard", "/mentor/custom-request/dashboard"],
        ];
        for (const [name, route] of mentorRoutes) await capture(page, dir, name, route, results);
      } catch (e) {
        results.push(`FAIL mentor-login ${(e as Error).message.split("\n")[0]}`);
      }

      // ── 관리자 ──
      await context.clearCookies();
      try {
        await login(page, ACCOUNTS.admin);
        const adminRoutes: Array<[string, string]> = [
          ["admin-dashboard", "/admin/dashboard"],
          ["admin-users", "/admin/users"],
          ["admin-mentor-activity", "/admin/mentor-activity"],
          ["admin-sla", "/admin/sla"],
          ["admin-refunds", "/admin/refunds"],
          ["admin-refunds-mentor-sla", "/admin/refunds?type=subscription_mentor_suspended&sort=deadline"],
          ["admin-moderation", "/admin/moderation"],
          ["admin-disputes", "/admin/disputes"],
          ["admin-mentor-approval", "/admin/mentor-approval"],
          ["admin-community-content", "/admin/community-content"],
          ["admin-reviews", "/admin/reviews"],
          ["admin-custom-request-orders", "/admin/custom-request-orders"],
          ["admin-settlements", "/admin/settlements"],
          ["admin-notices", "/admin/notices"],
          ["admin-audit-logs", "/admin/audit-logs"],
          ["admin-settings", "/admin/settings"],
        ];
        for (const [name, route] of adminRoutes) await capture(page, dir, name, route, results);
      } catch (e) {
        results.push(`FAIL admin-login ${(e as Error).message.split("\n")[0]}`);
      }

      const okCount = results.filter((r) => r.startsWith("OK")).length;
      console.log(`\n===== [${vp.tag}] 캡처 결과 (성공 ${okCount}) =====`);
      for (const r of results) console.log(r);
    });
  });
}
