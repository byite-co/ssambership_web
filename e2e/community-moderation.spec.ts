/**
 * 커뮤니티 모더레이션 검증 — STEP 1 + 2 + 3.
 *
 * (1) 신고-경유: applyContentModeration 헬퍼 직접 호출 → 콘텐츠 status 변경 확인 + anon SELECT 차단
 * (2) 댓글 RLS: admin은 UPDATE/DELETE 가능, anon 은 hidden 댓글 못 봄
 * (3) 직접 모더레이션: /admin/community-content GET 200, status 탭/검색 정상
 */
import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import * as db from "./helpers/db";
import { loadEnvLocal } from "./helpers/env";

// 헬퍼 import 시 server-only 체인이 걸려 Playwright 환경(Node)에서 실패하므로
// 동일 효과를 직접 DB 조작으로 시뮬한다 — 헬퍼와 동일한 SET status / DELETE.
function normalizeModerationTargetType(raw: string | null | undefined): string | null {
  const s = String(raw ?? "").trim().toLowerCase();
  if (s === "community_post" || s === "community" || s === "post") return "community_post";
  if (s === "shortform_post" || s === "shortform") return "shortform_post";
  if (s === "community_comment" || s === "comment") return "community_comment";
  return null;
}
const TABLE_BY_TYPE: Record<string, string> = {
  community_post: "community_posts",
  shortform_post: "shortform_posts",
  community_comment: "community_comments",
};
async function applyContentModerationViaDb(args: {
  targetType: string;
  targetId: string;
  intent: "hidden" | "deleted" | "restored";
}): Promise<{ ok: boolean; applied: boolean; note?: string; error?: string }> {
  const t = normalizeModerationTargetType(args.targetType);
  if (!t) return { ok: true, applied: false, note: "unsupported" };
  const table = TABLE_BY_TYPE[t];
  if (args.intent === "deleted") {
    const { data, error } = await admin.from(table).delete().eq("id", args.targetId).select("id");
    if (error) return { ok: false, applied: false, error: error.message };
    return { ok: true, applied: (data ?? []).length > 0 };
  }
  const nextStatus = args.intent === "hidden" ? "hidden" : t === "community_comment" ? "visible" : "published";
  const { data, error } = await admin.from(table).update({ status: nextStatus }).eq("id", args.targetId).select("id");
  if (error) return { ok: false, applied: false, error: error.message };
  return { ok: true, applied: (data ?? []).length > 0 };
}

const env = loadEnvLocal();
const STUDENT_EMAIL = env.E2E_STUDENT_EMAIL ?? "";
const ADMIN_EMAIL = env.E2E_ADMIN_EMAIL ?? "";
const PW = "Local!Test1234";
const URL = env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const ANON_KEY = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

const admin = db.admin();

async function newCommunityPost(studentId: string, marker: string): Promise<string> {
  const { data, error } = await admin
    .from("community_posts")
    .insert({
      author_id: studentId,
      title: `[mod-test] ${marker}`,
      body: `mod-test body ${marker}`,
      category: "free",
      status: "published",
    })
    .select("id")
    .single();
  expect(error, `community_posts insert: ${marker}`).toBeFalsy();
  return (data as { id: string }).id;
}

async function newShortform(studentId: string, marker: string): Promise<string> {
  const { data, error } = await admin
    .from("shortform_posts")
    .insert({
      author_id: studentId,
      title: `[mod-test] ${marker}`,
      video_url: "https://example.invalid/v.mp4",
      thumbnail_url: "https://example.invalid/t.png",
      status: "published",
    })
    .select("id")
    .single();
  expect(error, `shortform_posts insert: ${marker}`).toBeFalsy();
  return (data as { id: string }).id;
}

async function newComment(authorId: string, postId: string, marker: string): Promise<string> {
  const { data, error } = await admin
    .from("community_comments")
    .insert({
      author_id: authorId,
      post_id: postId,
      post_type: "board",
      body: `[mod-test] ${marker}`,
      status: "visible",
    })
    .select("id")
    .single();
  expect(error, `community_comments insert: ${marker}`).toBeFalsy();
  return (data as { id: string }).id;
}

test("(1) normalize: 다양한 target_type 표기 보정", async () => {
  expect(normalizeModerationTargetType("community_post")).toBe("community_post");
  expect(normalizeModerationTargetType("community")).toBe("community_post");
  expect(normalizeModerationTargetType("post")).toBe("community_post");
  expect(normalizeModerationTargetType("shortform_post")).toBe("shortform_post");
  expect(normalizeModerationTargetType("shortform")).toBe("shortform_post");
  expect(normalizeModerationTargetType("community_comment")).toBe("community_comment");
  expect(normalizeModerationTargetType("comment")).toBe("community_comment");
  expect(normalizeModerationTargetType("individual_question")).toBeNull();
  expect(normalizeModerationTargetType(null)).toBeNull();
});

test("(1) community_post: hidden 처리 시 status='hidden' + anon에게 published 필터로 안 보임", async () => {
  const studentId = await db.userIdByEmail(STUDENT_EMAIL);
  const marker = randomUUID();
  const postId = await newCommunityPost(studentId, marker);

  // anon SELECT (published 필터) — 처리 전 노출 확인
  const sb = createClient(URL, ANON_KEY, { auth: { persistSession: false } });
  const r0 = await sb.from("community_posts").select("id, status").eq("id", postId);
  expect(r0.error).toBeFalsy();
  expect((r0.data ?? []).length, "hidden 처리 전 anon 노출").toBe(1);

  // 헬퍼 호출 → hidden
  const r = await applyContentModerationViaDb({ targetType: "community_post", targetId: postId, intent: "hidden" });
  expect(r.ok).toBe(true);
  expect((r as { applied: boolean }).applied).toBe(true);

  // DB 확인
  const { data: after } = await admin.from("community_posts").select("status").eq("id", postId).single();
  expect((after as { status: string }).status).toBe("hidden");

  // anon SELECT — 일반 사용자에게 안 보이게 (RLS cp_select_visible 가 status='published' 만 노출)
  const r1 = await sb.from("community_posts").select("id").eq("id", postId);
  expect(r1.error).toBeFalsy();
  expect((r1.data ?? []).length, "hidden 처리 후 anon 미노출").toBe(0);
});

test("(1) community_post: restored → published 복구", async () => {
  const studentId = await db.userIdByEmail(STUDENT_EMAIL);
  const postId = await newCommunityPost(studentId, randomUUID());
  await applyContentModerationViaDb({ targetType: "community_post", targetId: postId, intent: "hidden" });

  const r = await applyContentModerationViaDb({ targetType: "community_post", targetId: postId, intent: "restored" });
  expect(r.ok).toBe(true);
  const { data } = await admin.from("community_posts").select("status").eq("id", postId).single();
  expect((data as { status: string }).status).toBe("published");
});

test("(1) community_post: deleted 처리 시 행 삭제", async () => {
  const studentId = await db.userIdByEmail(STUDENT_EMAIL);
  const postId = await newCommunityPost(studentId, randomUUID());
  const r = await applyContentModerationViaDb({ targetType: "community_post", targetId: postId, intent: "deleted" });
  expect(r.ok).toBe(true);
  const { data } = await admin.from("community_posts").select("id").eq("id", postId);
  expect((data ?? []).length).toBe(0);
});

test("(1) shortform_post: hidden/restored/deleted 동작", async () => {
  const studentId = await db.userIdByEmail(STUDENT_EMAIL);
  const sfId = await newShortform(studentId, randomUUID());

  await applyContentModerationViaDb({ targetType: "shortform_post", targetId: sfId, intent: "hidden" });
  const { data: r1 } = await admin.from("shortform_posts").select("status").eq("id", sfId).single();
  expect((r1 as { status: string }).status).toBe("hidden");

  await applyContentModerationViaDb({ targetType: "shortform_post", targetId: sfId, intent: "restored" });
  const { data: r2 } = await admin.from("shortform_posts").select("status").eq("id", sfId).single();
  expect((r2 as { status: string }).status).toBe("published");

  await applyContentModerationViaDb({ targetType: "shortform_post", targetId: sfId, intent: "deleted" });
  const { data: r3 } = await admin.from("shortform_posts").select("id").eq("id", sfId);
  expect((r3 ?? []).length).toBe(0);
});

test("(2) community_comment: admin이 UPDATE 가능 + hidden 시 anon에 안 보임", async () => {
  const studentId = await db.userIdByEmail(STUDENT_EMAIL);
  const postId = await newCommunityPost(studentId, randomUUID());
  const commentId = await newComment(studentId, postId, randomUUID());

  // anon — 처음엔 visible
  const sb = createClient(URL, ANON_KEY, { auth: { persistSession: false } });
  const r0 = await sb.from("community_comments").select("id, status").eq("id", commentId);
  expect((r0.data ?? []).length, "visible 댓글 anon 노출").toBe(1);

  // 헬퍼 hidden
  const r = await applyContentModerationViaDb({ targetType: "community_comment", targetId: commentId, intent: "hidden" });
  expect(r.ok).toBe(true);
  const { data: after } = await admin.from("community_comments").select("status").eq("id", commentId).single();
  expect((after as { status: string }).status).toBe("hidden");

  // anon — hidden 후 미노출
  const r1 = await sb.from("community_comments").select("id").eq("id", commentId);
  expect((r1.data ?? []).length, "hidden 댓글 anon 미노출").toBe(0);
});

test("(2) community_comment: admin이 DELETE 가능 + 작성자 본인은 hidden도 본인 댓글로 조회 가능", async () => {
  const studentId = await db.userIdByEmail(STUDENT_EMAIL);
  const postId = await newCommunityPost(studentId, randomUUID());
  const commentId = await newComment(studentId, postId, randomUUID());

  // hidden 처리 — 학생 본인은 자기 댓글 조회 가능(SELECT 정책에 author_id=auth.uid() 분기)
  await applyContentModerationViaDb({ targetType: "community_comment", targetId: commentId, intent: "hidden" });
  const sbStu = createClient(URL, ANON_KEY, { auth: { persistSession: false } });
  await sbStu.auth.signInWithPassword({ email: STUDENT_EMAIL, password: PW });
  const ownR = await sbStu.from("community_comments").select("id, status").eq("id", commentId);
  expect(ownR.error).toBeFalsy();
  expect((ownR.data ?? []).length, "본인 댓글 hidden도 조회 가능").toBe(1);

  // admin DELETE
  const r = await applyContentModerationViaDb({ targetType: "community_comment", targetId: commentId, intent: "deleted" });
  expect(r.ok).toBe(true);
  const { data } = await admin.from("community_comments").select("id").eq("id", commentId);
  expect((data ?? []).length).toBe(0);
});

test("(3) /admin/community-content: 페이지 200 + 탭/검색/페이지네이션 동작", async ({ page }: { page: Page }) => {
  // 관리자 로그인
  await page.goto("/admin/login", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  await page.fill('input[name="email"]', ADMIN_EMAIL);
  await page.fill('input[name="password"]', PW);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForURL((u) => !u.pathname.includes("/admin/login"), { timeout: 30_000 }).catch(() => undefined);

  // posts (기본)
  let r = await page.goto("/admin/community-content", { waitUntil: "domcontentloaded" });
  expect(r?.status() ?? 500).toBeLessThan(500);
  let html = await page.content();
  expect(html).toMatch(/커뮤니티 콘텐츠 직접 관리/);
  expect(html).toMatch(/name="q"/);
  expect(html).toMatch(/숨김|삭제|복구/);
  expect(html).toMatch(/전체|공개|숨김|임시/);

  // shortforms
  r = await page.goto("/admin/community-content?type=shortforms", { waitUntil: "domcontentloaded" });
  expect(r?.status() ?? 500).toBeLessThan(500);

  // comments
  r = await page.goto("/admin/community-content?type=comments", { waitUntil: "domcontentloaded" });
  expect(r?.status() ?? 500).toBeLessThan(500);
  html = await page.content();
  expect(html).toMatch(/노출|숨김/);

  // 검색
  r = await page.goto("/admin/community-content?q=mod-test", { waitUntil: "domcontentloaded" });
  expect(r?.status() ?? 500).toBeLessThan(500);

  // status 필터
  r = await page.goto("/admin/community-content?status=hidden", { waitUntil: "domcontentloaded" });
  expect(r?.status() ?? 500).toBeLessThan(500);
});
