import { NextResponse } from "next/server";
import { logAdminAction } from "@/lib/admin/adminActionLog";
import { serviceRoleOrNull, QUESTION_READ_UNAVAILABLE_MESSAGE } from "@/lib/admin/questionDrilldownQueries";
import {
  QUESTION_EXPORT_OVER_LIMIT_MESSAGE,
  buildQuestionExportLog,
  parseQuestionExportRequest,
  questionExportFileName,
  questionExportKind,
  questionExportResultOf,
  questionExportRows,
  renderQuestionExportCsv,
} from "@/lib/admin/questionExportConsole";
import { loadQuestionExportRecords } from "@/lib/admin/questionExportQueries";
import { getServerUserWithProfile } from "@/lib/auth/getServerUserWithProfile";

/**
 * 질문 내보내기(PR-13 §2) — `GET /api/admin/question-export?scope=…&id=…&include=body,attachments,metrics`
 *
 * - 관리자 세션만(쿠키 세션 → `users.role = admin`). 아니면 401/403 — 로그도 남기지 않는다(관리자 조치가 아니다).
 * - 읽기는 PR-8 과 같은 service_role 경로(`loadQuestionExportRecords`). 상한 200건 — 넘으면 400 + 안내 문구.
 * - ★ 감사 로그: **시도마다 `admin_action_logs` 1건**(`question_export`) — 성공·0건·상한 초과·조회 실패 전부. CSV 를 만들기 전에 기록한다.
 * - CSV 는 서버가 조립해 스트리밍한다(BOM + CRLF · `text/csv; charset=utf-8` · attachment). 캐시 금지.
 */
export const dynamic = "force-dynamic";

function json(status: number, body: Record<string, unknown>) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function contentDisposition(fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7E]/g, "_").replace(/"/g, "");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

export async function GET(req: Request) {
  const { user, profile, error: authError } = await getServerUserWithProfile();
  if (authError || !user) return json(401, { ok: false, error: "로그인이 필요합니다." });
  if (profile?.role !== "admin") return json(403, { ok: false, error: "관리자만 이용할 수 있습니다." });

  const parsed = parseQuestionExportRequest(new URL(req.url).searchParams);
  if (!parsed.ok) return json(400, { ok: false, error: "내보내기 범위가 올바르지 않습니다.", code: parsed.code });

  const db = serviceRoleOrNull();
  if (!db) return json(500, { ok: false, error: QUESTION_READ_UNAVAILABLE_MESSAGE });

  const { scope, includes } = parsed;
  const kind = questionExportKind(scope.kind);
  const loaded = await loadQuestionExportRecords(db, scope);
  const result = questionExportResultOf({ error: loaded.error, overLimit: loaded.overLimit, count: loaded.records.length });
  const rowCount = result === "ok" ? loaded.records.reduce((sum, r) => sum + questionExportRows(r, includes).length, 0) : 0;

  // ★ 시도마다 1건 — 다운로드가 실패해도 남는다(§2-4).
  const log = buildQuestionExportLog({ scope, includes, count: loaded.records.length, totalCount: loaded.totalCount, rowCount, result, error: loaded.error });
  await logAdminAction(db, { adminId: user.id, actionType: log.actionType, targetType: log.targetType, targetId: log.targetId, detail: log.detail });

  if (loaded.error) return json(500, { ok: false, error: loaded.error });
  if (loaded.overLimit) return json(400, { ok: false, error: QUESTION_EXPORT_OVER_LIMIT_MESSAGE, totalCount: loaded.totalCount });

  const encoder = new TextEncoder();
  const chunks = renderQuestionExportCsv(loaded.records, kind, includes);
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      const next = chunks.next();
      if (next.done) controller.close();
      else controller.enqueue(encoder.encode(next.value));
    },
  });
  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": contentDisposition(questionExportFileName(scope, new Date().toISOString())),
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
