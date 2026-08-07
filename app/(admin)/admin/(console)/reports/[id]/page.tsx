import Link from "next/link";
import { PageScaffold } from "@/components/shell/PageScaffold";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import { requireRole } from "@/lib/auth/routeGuard";
import { toAdminDisplayError } from "@/lib/admin/adminDisplayError";
import { updateContentReportStatusAction, updateContentReportModerationAction } from "@/lib/admin/adminReportActions";
import { loadAdminReportEvidence, type AdminReportEvidence } from "@/lib/admin/adminReportEvidence";
import { loadAdminReportNotes } from "@/lib/admin/adminCaseNotes";
import { contentReportStatusLabel } from "@/lib/admin/contentReportLabels";
import { FormSubmitButton } from "@/components/common/FormSubmitButton";
import { AdminCaseNotesPanel } from "@/components/admin/AdminCaseNotesPanel";

const TABLE = "content_reports" as const;

type Props = { params: Promise<{ id: string }> };

function fmtDate(v: unknown): string {
  if (v == null) return "—";
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short" }).format(d);
}

function fieldStr(row: Record<string, unknown> | null, key: string): string | null {
  const v = row?.[key];
  return typeof v === "string" && v.trim().length > 0 ? v : null;
}

function EvidenceSection({ evidence }: { evidence: AdminReportEvidence }) {
  if (evidence.kind === "unsupported") {
    return (
      <p className="text-sm font-semibold text-slate-500">
        이 신고 대상 유형은 미리보기를 지원하지 않습니다. 대상 ID로 직접 확인해 주세요.
      </p>
    );
  }
  if (evidence.kind === "missing") {
    return (
      <p className="text-sm font-semibold text-slate-500">
        대상 콘텐츠를 찾을 수 없습니다. 이미 삭제되었을 수 있습니다.
      </p>
    );
  }
  if (evidence.kind === "error") {
    return (
      <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-900">
        대상 콘텐츠 조회에 실패했습니다. 잠시 후 다시 시도해 주세요.
      </p>
    );
  }

  const statusBadge =
    evidence.status === "hidden" ? (
      <span className="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-bold text-amber-800">숨김</span>
    ) : (
      <span className="rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700">
        {evidence.status ?? "—"}
      </span>
    );

  if (evidence.kind === "community_comment" || evidence.kind === "board_comment") {
    return (
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
          <span className="font-bold text-slate-700">
            {evidence.kind === "board_comment" ? "게시판 댓글" : "커뮤니티 댓글(레거시)"}
          </span>
          {statusBadge}
          <span>작성 {fmtDate(evidence.createdAt)}</span>
          <span className="font-mono">작성자 {evidence.authorId ?? "—"}</span>
        </div>
        <p className="whitespace-pre-wrap rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-800">
          {evidence.body ?? "—"}
        </p>
        {evidence.postId ? (
          <Link
            href={`/community/board/${encodeURIComponent(evidence.postId)}`}
            className="text-xs font-extrabold text-indigo-800 underline"
            prefetch={false}
          >
            원글 보기 →
          </Link>
        ) : null}
      </div>
    );
  }

  if (evidence.kind === "shortform_post") {
    return (
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
          <span className="font-bold text-slate-700">숏폼</span>
          {statusBadge}
          <span>작성 {fmtDate(evidence.createdAt)}</span>
          <span className="font-mono">작성자 {evidence.authorId ?? "—"}</span>
        </div>
        {evidence.title ? <p className="text-base font-black text-slate-900">{evidence.title}</p> : null}
        {evidence.body ? <p className="whitespace-pre-wrap text-sm leading-6 text-slate-700">{evidence.body}</p> : null}
        {evidence.videoUrl ? (
          <video
            controls
            preload="metadata"
            poster={evidence.thumbnailUrl ?? undefined}
            className="max-h-[420px] w-full max-w-[340px] rounded-xl border border-slate-200 bg-black"
            src={evidence.videoUrl}
          />
        ) : evidence.thumbnailUrl ? (
          /* eslint-disable-next-line @next/next/no-img-element -- 단기 서명 URL 미리보기라 next/image 최적화 대상이 아님 */
          <img src={evidence.thumbnailUrl} alt="숏폼 썸네일" className="max-w-[240px] rounded-xl border border-slate-200" />
        ) : (
          <p className="text-sm font-semibold text-slate-500">재생 가능한 영상 링크를 만들지 못했습니다.</p>
        )}
      </div>
    );
  }

  if (evidence.kind === "community_post") {
    return (
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
          <span className="font-bold text-slate-700">커뮤니티 글</span>
          {statusBadge}
          <span>작성 {fmtDate(evidence.createdAt)}</span>
          <span className="font-mono">작성자 {evidence.authorId ?? "—"}</span>
        </div>
        {evidence.title ? <p className="text-base font-black text-slate-900">{evidence.title}</p> : null}
        {evidence.body ? (
          <p className="max-h-64 overflow-y-auto whitespace-pre-wrap rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-800">
            {evidence.body}
          </p>
        ) : null}
        {evidence.imageUrls.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {evidence.imageUrls.map((url: string) => (
              /* eslint-disable-next-line @next/next/no-img-element -- 단기 서명 URL 미리보기라 next/image 최적화 대상이 아님 */
              <img key={url} src={url} alt="게시글 이미지" className="h-40 w-40 rounded-xl border border-slate-200 object-cover" />
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  return null;
}

export default async function AdminReportDetailPage(props: Props) {
  await requireRole("admin");
  const { id } = await props.params;
  const supabase = await createClient();
  const { data, error } = await supabase.from(TABLE).select("*").eq("id", id).maybeSingle();
  const row = data as Record<string, unknown> | null;
  const loadErr = error ? toAdminDisplayError(error.message, "reports") ?? "불러오지 못했습니다." : null;

  // 증거 조회는 서비스롤 우선(숨김·삭제 대기 콘텐츠도 확인해야 함) — 키 없으면 세션 RLS로 폴백.
  let evidenceClient = supabase;
  try {
    evidenceClient = createServiceRoleClient();
  } catch {
    /* session fallback */
  }
  const evidence = row
    ? await loadAdminReportEvidence(evidenceClient, fieldStr(row, "target_type"), fieldStr(row, "target_id"))
    : null;

  // D-AD-13: 신고 케이스 운영 메모 배선 — 분쟁에만 있던 메모 패널을 신고 상세에도 연결해
  // saveContentReportAdminNoteAction 의 도달 불가(DEAD)를 해소한다.
  const reportNotes = row ? await loadAdminReportNotes(supabase, id) : null;

  const status = fieldStr(row, "status") ?? "";

  return (
    <PageScaffold
      hideFooterPlaceholderCards
      eyebrow="관리자 / 신고"
      title="신고 상세"
      description="신고 내용과 대상 콘텐츠를 함께 확인하고, 신고 상태·콘텐츠 조치를 처리합니다."
      ctas={[
        { href: "/admin/moderation", label: "검수 목록", tone: "blue" },
        { href: "/admin", label: "대시보드", tone: "slate" },
      ]}
      sections={[]}
      dataPoints={[]}
    >
      <div className="space-y-4">
        <Link href="/admin/moderation" className="text-sm font-extrabold text-indigo-800 underline" prefetch={false}>
          ← 콘텐츠 검수 목록
        </Link>
        {loadErr ? <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-900">{loadErr}</p> : null}
        {!row && !loadErr ? <p className="text-sm text-slate-600">해당 id의 신고를 찾지 못했습니다.</p> : null}

        {row ? (
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-extrabold text-slate-900">신고 내용</p>
              <span className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-bold text-slate-700">
                {contentReportStatusLabel(status)}
              </span>
            </div>
            <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-xs font-black text-slate-500">사유</dt>
                <dd className="mt-0.5 font-bold text-slate-900">{fieldStr(row, "reason") ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-xs font-black text-slate-500">접수일</dt>
                <dd className="mt-0.5 font-semibold text-slate-800">{fmtDate(row.created_at)}</dd>
              </div>
              <div>
                <dt className="text-xs font-black text-slate-500">신고자</dt>
                <dd className="mt-0.5 font-mono text-xs text-slate-700">
                  {fieldStr(row, "reporter_id") ?? fieldStr(row, "user_id") ?? "—"}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-black text-slate-500">대상</dt>
                <dd className="mt-0.5 font-mono text-xs text-slate-700">
                  {fieldStr(row, "target_type") ?? "—"} · {fieldStr(row, "target_id") ?? "—"}
                </dd>
              </div>
            </dl>
            {fieldStr(row, "description") ? (
              <p className="mt-3 whitespace-pre-wrap rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-800">
                {fieldStr(row, "description")}
              </p>
            ) : null}
            {fieldStr(row, "admin_note") ? (
              <p className="mt-3 rounded-xl border border-indigo-100 bg-indigo-50 p-3 text-xs font-semibold text-indigo-900">
                운영 메모: {fieldStr(row, "admin_note")}
              </p>
            ) : null}
          </section>
        ) : null}

        {evidence ? (
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-sm font-extrabold text-slate-900">신고 대상 콘텐츠</p>
            <div className="mt-3">
              <EvidenceSection evidence={evidence} />
            </div>
          </section>
        ) : null}

        {row ? (
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-sm font-extrabold text-slate-900">처리</p>
            <p className="mt-1 text-xs text-slate-500">
              신고 상태 변경과 콘텐츠 조치(숨김·삭제·복구)를 처리합니다. 콘텐츠 조치는 대상 글·숏폼·댓글에 즉시 반영됩니다.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <form action={updateContentReportStatusAction} className="inline">
                <input type="hidden" name="reportId" value={id} />
                <input type="hidden" name="nextStatus" value="reviewing" />
                <FormSubmitButton idleLabel="검토 중" pendingLabel="…" className="rounded-lg bg-amber-600 px-3 py-2 text-xs font-bold text-white" />
              </form>
              <form action={updateContentReportStatusAction} className="inline">
                <input type="hidden" name="reportId" value={id} />
                <input type="hidden" name="nextStatus" value="resolved" />
                <FormSubmitButton idleLabel="처리 완료" pendingLabel="…" className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white" />
              </form>
              <form action={updateContentReportStatusAction} className="inline">
                <input type="hidden" name="reportId" value={id} />
                <input type="hidden" name="nextStatus" value="dismissed" />
                <FormSubmitButton idleLabel="종결" pendingLabel="…" className="rounded-lg bg-slate-600 px-3 py-2 text-xs font-bold text-white" />
              </form>
              <form action={updateContentReportModerationAction} className="inline">
                <input type="hidden" name="reportId" value={id} />
                <input type="hidden" name="intent" value="hidden" />
                <FormSubmitButton idleLabel="콘텐츠 숨김" pendingLabel="…" className="rounded-lg bg-orange-700 px-3 py-2 text-xs font-bold text-white" />
              </form>
              <form action={updateContentReportModerationAction} className="inline">
                <input type="hidden" name="reportId" value={id} />
                <input type="hidden" name="intent" value="restored" />
                <FormSubmitButton idleLabel="콘텐츠 복구" pendingLabel="…" className="rounded-lg bg-teal-700 px-3 py-2 text-xs font-bold text-white" />
              </form>
              <form action={updateContentReportModerationAction} className="inline">
                <input type="hidden" name="reportId" value={id} />
                <input type="hidden" name="intent" value="deleted" />
                <FormSubmitButton idleLabel="콘텐츠 삭제" pendingLabel="…" className="rounded-lg bg-red-700 px-3 py-2 text-xs font-bold text-white" />
              </form>
            </div>
          </section>
        ) : null}

        {row && reportNotes ? (
          <AdminCaseNotesPanel
            targetKind="content_report"
            targetId={id}
            notes={reportNotes}
            legacyNote={fieldStr(row, "admin_note")}
          />
        ) : null}

        {row ? (
          <details className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <summary className="cursor-pointer text-xs font-bold text-slate-500">원본 데이터(디버그)</summary>
            <pre className="mt-2 max-h-[360px] overflow-auto rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs text-slate-800">
              {JSON.stringify(row, null, 2)}
            </pre>
          </details>
        ) : null}
      </div>
    </PageScaffold>
  );
}
