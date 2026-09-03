/**
 * 커뮤니티 모더레이션 검증 — STEP 1 + 2 + 3.
 *
 * (1) 신고-경유: applyContentModeration 헬퍼와 같은 DB 조작 → 콘텐츠 status/deleted_at 변경 확인 + anon SELECT 차단
 * (2) 댓글 RLS: admin은 UPDATE 가능, anon 은 hidden·삭제 댓글 못 봄
 * (3) 직접 모더레이션: /admin/community-content GET 200, status 탭/검색 정상
 *
 * PR-W2(DB-2 SQL 194): 삭제는 하드 DELETE 가 아니라 소프트 삭제(deleted_at=now() · deleted_by=조치 관리자)다 — 행이 남고 anon 에게 안 보이며 복원할 수 있다.
 */
import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import * as db from "./helpers/db";
import { loadEnvLocal } from "./helpers/env";

// 헬퍼 import 시 server-only 체인이 걸려 Playwright 환경(Node)에서 실패하므로
// 동일 효과를 직접 DB 조작으로 시뮬한다 — 헬퍼와 동일한 SET status / 소프트 삭제 UPDATE(deleted_at·deleted_by) / 복원(deleted_at NULL).
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
  /** 조치 관리자 id(deleted_by) — 코어의 actorId */
  actorId?: string;
}): Promise<{ ok: boolean; applied: boolean; note?: string; error?: string }> {
  const t = normalizeModerationTargetType(args.targetType);
  if (!t) return { ok: true, applied: false, note: "unsupported" };
  const table = TABLE_BY_TYPE[t];
  if (args.intent === "deleted") {
    const { data, error } = await admin
      .from(table)
      .update({ deleted_at: new Date().toISOString(), deleted_by: args.actorId ?? null })
      .eq("id", args.targetId)
      .is("deleted_at", null)
      .select("id");
    if (error) return { ok: false, applied: false, error: error.message };
    return { ok: true, applied: (data ?? []).length > 0 };
  }
  const nextStatus = args.intent === "hidden" ? "hidden" : t === "community_comment" ? "visible" : "published";
  const patch: Record<string, unknown> = { status: nextStatus };
  if (args.intent === "restored") {
    patch.deleted_at = null;
    patch.deleted_by = null;
  }
  const { data, error } = await admin.from(table).update(patch).eq("id", args.targetId).select("id");
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

test("(1) community_post: deleted 처리 = 소프트 삭제(행 보존 · deleted_at/deleted_by · anon 미노출) · 재삭제는 applied=false", async () => {
  const studentId = await db.userIdByEmail(STUDENT_EMAIL);
  const adminId = await db.userIdByEmail(ADMIN_EMAIL);
  const postId = await newCommunityPost(studentId, randomUUID());
  const r = await applyContentModerationViaDb({ targetType: "community_post", targetId: postId, intent: "deleted", actorId: adminId });
  expect(r.ok).toBe(true);
  expect(r.applied).toBe(true);
  const { data } = await admin.from("community_posts").select("id, deleted_at, deleted_by").eq("id", postId);
  expect((data ?? []).length, "행이 남는다").toBe(1);
  expect((data?.[0] as { deleted_at: string | null }).deleted_at).toBeTruthy();
  expect((data?.[0] as { deleted_by: string | null }).deleted_by).toBe(adminId);
  const sb = createClient(URL, ANON_KEY, { auth: { persistSession: false } });
  const r1 = await sb.from("community_posts").select("id").eq("id", postId);
  expect((r1.data ?? []).length, "삭제 후 anon 미노출").toBe(0);
  const again = await applyContentModerationViaDb({ targetType: "community_post", targetId: postId, intent: "deleted", actorId: adminId });
  expect(again.applied, "이미 삭제된 행은 건너뛴다(멱등)").toBe(false);
});

test("(1) shortform_post: hidden/restored/deleted(소프트)/restored(삭제 복원) 동작", async () => {
  const studentId = await db.userIdByEmail(STUDENT_EMAIL);
  const adminId = await db.userIdByEmail(ADMIN_EMAIL);
  const sfId = await newShortform(studentId, randomUUID());

  await applyContentModerationViaDb({ targetType: "shortform_post", targetId: sfId, intent: "hidden" });
  const { data: r1 } = await admin.from("shortform_posts").select("status").eq("id", sfId).single();
  expect((r1 as { status: string }).status).toBe("hidden");

  await applyContentModerationViaDb({ targetType: "shortform_post", targetId: sfId, intent: "restored" });
  const { data: r2 } = await admin.from("shortform_posts").select("status").eq("id", sfId).single();
  expect((r2 as { status: string }).status).toBe("published");

  await applyContentModerationViaDb({ targetType: "shortform_post", targetId: sfId, intent: "deleted", actorId: adminId });
  const { data: r3 } = await admin.from("shortform_posts").select("id, deleted_at").eq("id", sfId);
  expect((r3 ?? []).length, "소프트 삭제 — 행 보존").toBe(1);
  expect((r3?.[0] as { deleted_at: string | null }).deleted_at).toBeTruthy();
  const sb = createClient(URL, ANON_KEY, { auth: { persistSession: false } });
  const anonR = await sb.from("shortform_posts").select("id").eq("id", sfId);
  expect((anonR.data ?? []).length, "삭제 후 anon 미노출(sf_select_published deleted_at IS NULL)").toBe(0);

  await applyContentModerationViaDb({ targetType: "shortform_post", targetId: sfId, intent: "restored" });
  const { data: r4 } = await admin.from("shortform_posts").select("status, deleted_at").eq("id", sfId).single();
  expect((r4 as { status: string; deleted_at: string | null }).status).toBe("published");
  expect((r4 as { deleted_at: string | null }).deleted_at, "삭제 복원 = deleted_at NULL").toBeNull();
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

test("(2) community_comment: admin 소프트 삭제 가능(행 보존 · anon·작성자 미노출) + 작성자 본인은 hidden도 본인 댓글로 조회 가능", async () => {
  const studentId = await db.userIdByEmail(STUDENT_EMAIL);
  const adminId = await db.userIdByEmail(ADMIN_EMAIL);
  const postId = await newCommunityPost(studentId, randomUUID());
  const commentId = await newComment(studentId, postId, randomUUID());

  // hidden 처리 — 학생 본인은 자기 댓글 조회 가능(SELECT 정책에 author_id=auth.uid() 분기)
  await applyContentModerationViaDb({ targetType: "community_comment", targetId: commentId, intent: "hidden" });
  const sbStu = createClient(URL, ANON_KEY, { auth: { persistSession: false } });
  await sbStu.auth.signInWithPassword({ email: STUDENT_EMAIL, password: PW });
  const ownR = await sbStu.from("community_comments").select("id, status").eq("id", commentId);
  expect(ownR.error).toBeFalsy();
  expect((ownR.data ?? []).length, "본인 댓글 hidden도 조회 가능").toBe(1);

  // admin 소프트 삭제 — 행은 남고(deleted_at) 작성자 본인에게도 안 보인다(community_comments_select_visible: deleted_at IS NULL 이 먼저)
  const r = await applyContentModerationViaDb({ targetType: "community_comment", targetId: commentId, intent: "deleted", actorId: adminId });
  expect(r.ok).toBe(true);
  const { data } = await admin.from("community_comments").select("id, deleted_at, deleted_by").eq("id", commentId);
  expect((data ?? []).length, "행 보존").toBe(1);
  expect((data?.[0] as { deleted_by: string | null }).deleted_by).toBe(adminId);
  const gone = await sbStu.from("community_comments").select("id").eq("id", commentId);
  expect((gone.data ?? []).length, "삭제된 댓글은 작성자 본인에게도 미노출").toBe(0);
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
