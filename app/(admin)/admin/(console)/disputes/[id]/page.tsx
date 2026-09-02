import Link from "next/link";
import type { ReactNode } from "react";
import { AdminCaseNotesPanel } from "@/components/admin/AdminCaseNotesPanel";
import { AdminPageLayout } from "@/components/admin/AdminPageLayout";
import { AdminStatusPill } from "@/components/admin/AdminStatusPill";
import { DisputeNextActions } from "@/components/admin/DisputeNextActions";
import { EmptyState } from "@/components/common/EmptyState";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/routeGuard";
import { loadDisputeById } from "@/lib/disputes/disputeQueries";
import { toAdminDisplayError } from "@/lib/admin/adminDisplayError";
import { loadAdminDisputeEscrowSplitPanelState } from "@/lib/admin/adminDisputeEscrowSplitQueries";
import { loadAdminDisputeNotes } from "@/lib/admin/adminCaseNotes";
import { loadAdminDisputeDeliverables } from "@/lib/admin/adminDisputeDeliverables";
import { countMentorStudentRooms } from "@/lib/admin/mentorRoomCount";
import {
  DISPUTE_BASE_PATH,
  DISPUTE_KIND_LABELS,
  buildDisputeDetailTitle,
  disputeActionLogLabel,
  disputeAllowedActions,
  disputeDetailFlashOkMessage,
  disputeElapsed,
  disputeElapsedToneClass,
  disputeResolveRoute,
  disputeShortRef,
  resolveDisputeKind,
} from "@/lib/admin/disputeConsole";
import { loadDisputeOrderContext, loadDisputeParties } from "@/lib/admin/disputeConsoleQueries";
import { normalizedPrimaryOrderStatus, paymentStatusLabelForUi } from "@/lib/customRequest/orderLifecycleConstants";
import { formatCashKrw, formatKoreanDate } from "@/lib/utils/formatDisplay";
import { formatKoDateTimeKst } from "@/lib/utils/kstTime";
import { cn } from "@/lib/utils/cn";

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

type Row = Record<string, unknown>;

function pick(value: string | string[] | undefined): string {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value) && typeof value[0] === "string") return value[0].trim();
  return "";
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/** 정지 해제 예정일(7일·30일) 표기 — 서버에서 한 번 계산해 클라이언트 모달에 넘긴다(실제 값은 액션 실행 시각 기준). */
function suspendUntilLabels(now = Date.now()): Record<"7d" | "30d", string> {
  const at = (days: number) => formatKoreanDate(new Date(now + days * 86_400_000).toISOString());
  return { "7d": at(7), "30d": at(30) };
}

const BACK_LINK = "rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-extrabold text-slate-700 hover:bg-slate-50";

function Section(props: { title: string; children: ReactNode; aside?: ReactNode; tone?: "default" | "warning" }) {
  return (
    <section className={cn("rounded-2xl border bg-white p-4 shadow-sm", props.tone === "warning" ? "border-amber-300" : "border-slate-200")} aria-label={props.title}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-black tracking-tight text-slate-900">{props.title}</h2>
        {props.aside}
      </div>
      <div className="mt-3 text-sm text-slate-800">{props.children}</div>
    </section>
  );
}

function RowLine(props: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-slate-100 py-1.5 last:border-b-0">
      <dt className="shrink-0 text-xs font-bold text-slate-500">{props.label}</dt>
      <dd className="text-right font-semibold text-slate-800">{props.children}</dd>
    </div>
  );
}

/**
 * 관리자 · 분쟁 상세(PR-6 §2-3 · 패턴 B). 좌: 접수 주장 · 주문 정보 · 주문 이력 · 결제 이력 · 납품물 증거 / 우: 케이스 노트 · 다음 조치 · 처리 이력.
 * 다음 조치는 현재 상태에서 가능한 전이만 보인다(규칙은 서버 액션 게이트에서 읽는다 — `disputeAllowedActions`).
 * (admin)/layout.tsx + (console)/layout.tsx 의 이중 requireRole("admin") 가드 아래에 있다.
 */
export default async function AdminDisputeDetailPage(props: PageProps) {
  await requireRole("admin");
  const { id } = await props.params;
  const sp = (await props.searchParams) ?? {};
  const flashOk = disputeDetailFlashOkMessage(pick(sp.ok));
  const flashErrRaw = pick(sp.error) || null;
  const flashErr = flashErrRaw ? (toAdminDisplayError(flashErrRaw, "disputes") ?? "처리에 실패했습니다. 잠시 후 다시 시도해 주세요.") : null;

  const supabase = await createClient();
  // [보안 주석] service_role로 RLS 우회 — 이중 requireRole("admin") 가드 아래의 관리자 업무상 의도된 경로(이관 전과 동일).
  let adminBypass: ReturnType<typeof createServiceRoleClient> | undefined;
  try {
    adminBypass = createServiceRoleClient();
  } catch {
    adminBypass = undefined;
  }
  const bundle = await loadDisputeById(supabase, id, { adminBypassClient: adminBypass });
  const row = bundle.dispute.row;

  if (!row) {
    const loadError = toAdminDisplayError(bundle.dispute.error, "disputes");
    return (
      <AdminPageLayout
        title="분쟁 상세"
        description="분쟁 한 건의 주장·주문·결제 이력을 확인하고 예치금 처리와 제재를 결정합니다."
        actions={
          <Link href={DISPUTE_BASE_PATH} className={BACK_LINK} prefetch={false}>
            ← 분쟁 목록
          </Link>
        }
      >
        {loadError ? (
          <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-900">
            {loadError}
          </p>
        ) : (
          <EmptyState title="해당 분쟁을 찾을 수 없습니다" description="삭제되었거나 주소가 잘못되었을 수 있습니다. 목록에서 다시 선택해 주세요." />
        )}
      </AdminPageLayout>
    );
  }

  const readClient = adminBypass ?? supabase;
  const status = str(row.status);
  const studentId = str(row.student_id) || null;
  const mentorId = str(row.mentor_id) || null;
  const submittedBy = str(row.submitted_by) || null;
  const orderRow = bundle.customOrder.row as Row | null;
  const orderId = str(row.custom_request_order_id) || str(orderRow?.id) || null;
  const kind = resolveDisputeKind(row);
  const createdAt = str(row.created_at) || null;

  const [parties, adminNotes, escrow, deliverables, orderContext] = await Promise.all([
    loadDisputeParties(supabase, [studentId, mentorId, submittedBy]),
    loadAdminDisputeNotes(readClient, id),
    loadAdminDisputeEscrowSplitPanelState(readClient, id, row, orderRow),
    orderId ? loadAdminDisputeDeliverables(readClient, orderId) : Promise.resolve({ files: [], error: null }),
    orderId
      ? loadDisputeOrderContext(supabase, {
          orderId,
          postId: str(orderRow?.post_id) || str(orderRow?.custom_request_post_id) || null,
          studentId,
          mentorId,
        })
      : Promise.resolve(null),
  ]);
  const mentorRoomCount = mentorId ? await countMentorStudentRooms(readClient, mentorId) : null;

  const student = studentId ? { id: studentId, name: parties.get(studentId)?.name ?? studentId.slice(0, 8) } : null;
  const mentor = mentorId ? { id: mentorId, name: parties.get(mentorId)?.name ?? mentorId.slice(0, 8) } : null;
  const submitterLabel = submittedBy
    ? submittedBy === studentId
      ? "학생"
      : submittedBy === mentorId
        ? "멘토"
        : (parties.get(submittedBy)?.name ?? submittedBy.slice(0, 8))
    : "—";

  const allowed = disputeAllowedActions(status);
  const elapsed = disputeElapsed(createdAt, status);
  const escrowLine =
    escrow.kind === "split_form"
      ? `예치금 ${formatCashKrw(escrow.form.holdGrossWon, { unit: "원" })} 보관 중`
      : escrow.kind === "completed"
        ? "예치금 처리 완료"
        : escrow.kind === "no_hold"
          ? "예치 내역 없음"
          : "예치금 정보 없음";
  const orderStatusNorm = orderRow ? normalizedPrimaryOrderStatus(orderRow) : "";
  const paymentStatus = str(orderRow?.payment_status);

  return (
    <AdminPageLayout
      title={buildDisputeDetailTitle({
        orderRef: orderId ? disputeShortRef(orderId) : "",
        disputeRef: disputeShortRef(id),
        studentName: student?.name ?? "",
        mentorName: mentor?.name ?? "",
      })}
      description={
        <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
          <span>{DISPUTE_KIND_LABELS[kind]}</span>
          <span aria-hidden="true">·</span>
          <span>접수 {formatKoreanDate(createdAt)}</span>
          <span aria-hidden="true">·</span>
          <span>
            경과{" "}
            <span className={cn("rounded-md border px-1.5 py-0.5 text-[11px] font-bold tabular-nums", disputeElapsedToneClass(elapsed.tone))}>{elapsed.label}</span>
          </span>
          <span aria-hidden="true">·</span>
          <span>{escrowLine}</span>
          <span aria-hidden="true">·</span>
          <AdminStatusPill table="disputes" column="status" value={status} size="sm" />
        </span>
      }
      actions={
        <>
          <Link href={DISPUTE_BASE_PATH} className={BACK_LINK} prefetch={false}>
            ← 분쟁 목록
          </Link>
          <Link href="/admin/refunds" className={BACK_LINK} prefetch={false}>
            환불 관리
          </Link>
        </>
      }
    >
      {flashOk ? (
        <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-900">
          {flashOk}
        </p>
      ) : null}
      {flashErr ? (
        <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-900">
          처리 실패 — {flashErr} 이 화면에서 같은 버튼으로 다시 시도할 수 있습니다.
        </p>
      ) : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="space-y-4">
          <Section title="접수 주장" aside={<span className="text-[11px] font-semibold text-slate-500">제출 {submitterLabel} · {formatKoDateTimeKst(createdAt)}</span>}>
            <blockquote className="whitespace-pre-line rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-800">{str(row.body) ? `“${str(row.body)}”` : "접수 내용 없음"}</blockquote>
            <dl className="mt-3">
              <RowLine label="학생">{student ? student.name : "—"}</RowLine>
              <RowLine label="멘토">{mentor ? mentor.name : "—"}</RowLine>
              {str(row.admin_note) ? <RowLine label="운영 메모(구 단일)">{str(row.admin_note)}</RowLine> : null}
            </dl>
            <p className="mt-3 text-[11px] leading-relaxed text-slate-500">
              상대 측 주장·첨부 파일 필드는 분쟁 데이터에 없습니다. 상대 측 입장은 주문방 메시지와 아래 납품물 증거로 확인합니다.
            </p>
          </Section>

          <Section
            title="주문 정보"
            aside={orderRow ? <AdminStatusPill table="custom_request_orders" column="status" value={orderStatusNorm} size="sm" /> : null}
          >
            {orderId ? (
              <dl>
                <RowLine label="주문">
                  {disputeShortRef(orderId)}{" "}
                  <Link href={`/custom-request/orders/${encodeURIComponent(orderId)}`} className="ml-1 text-xs font-extrabold text-blue-700 underline" prefetch={false}>
                    작업방 열기
                  </Link>
                </RowLine>
                <RowLine label="의뢰 제목">{orderContext?.title ?? "—"}</RowLine>
                <RowLine label="결제 상태">{paymentStatus ? paymentStatusLabelForUi(paymentStatus) : "—"}</RowLine>
                <RowLine label="예치금">{escrowLine}</RowLine>
                {bundle.refund.row ? (
                  <RowLine label="환불 요청">
                    <Link
                      href={`/admin/refunds/${encodeURIComponent(str((bundle.refund.row as Row).id))}`}
                      className="text-xs font-extrabold text-blue-700 underline"
                      prefetch={false}
                    >
                      환불 상세 {disputeShortRef(str((bundle.refund.row as Row).id))}
                    </Link>
                  </RowLine>
                ) : null}
              </dl>
            ) : (
              <p className="text-xs text-slate-600">
                연결된 맞춤의뢰 주문이 없습니다.{bundle.subscription.row ? " 구독 분쟁입니다 — 환불은 환불 관리에서 처리합니다." : ""}
              </p>
            )}
          </Section>

          <Section title="주문 이력" aside={orderContext ? <span className="text-[11px] font-semibold text-slate-500">{orderContext.events.length}건</span> : null}>
            {!orderContext ? (
              <p className="text-xs text-slate-600">연결된 주문이 없어 이력이 없습니다.</p>
            ) : orderContext.eventsError ? (
              <p className="text-xs font-bold text-amber-900">주문 이력을 불러오지 못했습니다.</p>
            ) : orderContext.events.length ? (
              <ol className="divide-y divide-slate-100">
                {orderContext.events.map((e) => (
                  <li key={e.id} className="flex items-center justify-between gap-3 py-1.5 text-xs">
                    <span className="shrink-0 tabular-nums text-slate-500">{e.atLabel}</span>
                    <span className="min-w-0 flex-1 truncate text-right font-bold text-slate-800">{e.label}</span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-xs text-slate-600">기록된 주문 이력이 없습니다.</p>
            )}
          </Section>

          <Section title="결제 이력" aside={orderContext ? <span className="text-[11px] font-semibold text-slate-500">캐시 원장 {orderContext.ledger.length}건</span> : null}>
            {!orderContext ? (
              <p className="text-xs text-slate-600">연결된 주문이 없어 결제 이력이 없습니다.</p>
            ) : orderContext.ledgerError ? (
              <p className="text-xs font-bold text-amber-900">결제 이력을 불러오지 못했습니다.</p>
            ) : orderContext.ledger.length ? (
              <ul className="divide-y divide-slate-100">
                {orderContext.ledger.map((l) => (
                  <li key={l.id} className="flex items-center justify-between gap-3 py-1.5 text-xs">
                    <span className="shrink-0 tabular-nums text-slate-500">{l.atLabel}</span>
                    <span className="min-w-0 flex-1 truncate text-slate-800">
                      {l.label}
                      <span className="ml-1 text-[10px] font-bold text-slate-500">{l.partyLabel}</span>
                    </span>
                    <span className={cn("shrink-0 font-extrabold tabular-nums", l.credit ? "text-emerald-700" : "text-slate-900")}>{l.deltaLabel}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-slate-600">캐시 원장 이력이 없습니다(레거시·미결제 주문일 수 있습니다).</p>
            )}
          </Section>

          <Section title="납품물 증거" aside={<span className="text-[11px] font-semibold text-slate-500">링크는 5분 동안 유효</span>}>
            {deliverables.error ? (
              <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-bold text-amber-900">납품물 목록을 불러오지 못했습니다.</p>
            ) : deliverables.files.length === 0 ? (
              <p className="text-xs font-semibold text-slate-500">{orderId ? "제출된 납품물이 없습니다." : "연결된 맞춤의뢰 주문이 없어 납품물이 없습니다."}</p>
            ) : (
              <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                {deliverables.files.map((f) => (
                  <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-slate-900">
                        {f.fileName ?? "파일명 없음"}
                        {f.version != null ? <span className="ml-2 text-xs font-extrabold text-slate-500">{f.version}차</span> : null}
                      </p>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {f.status ?? "—"} · {f.mimeType ?? "형식 미상"}
                        {f.createdAt ? ` · ${formatKoDateTimeKst(f.createdAt)}` : ""}
                      </p>
                    </div>
                    {f.signedUrl ? (
                      <a href={f.signedUrl} target="_blank" rel="noreferrer" className="shrink-0 rounded-lg bg-[#1A56DB] px-3.5 py-1.5 text-xs font-extrabold text-white hover:bg-[#1747B8]">
                        파일 열기
                      </a>
                    ) : (
                      <span className="shrink-0 text-xs font-semibold text-slate-400">링크 생성 불가</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>

        <div className="space-y-4">
          <AdminCaseNotesPanel targetKind="dispute" targetId={id} notes={adminNotes} legacyNote={str(row.admin_note) || null} />

          <DisputeNextActions
            disputeId={id}
            status={status}
            allowed={allowed}
            resolveRoute={disputeResolveRoute(status)}
            student={student}
            mentor={mentor}
            mentorRoomCount={mentorRoomCount}
            untilLabels={suspendUntilLabels()}
            escrow={escrow}
          />

          <Section title="처리 이력" aside={<span className="text-[11px] font-semibold text-slate-500">감사 로그 {bundle.modLogs.rows.length}건</span>}>
            {bundle.modLogs.rows.length ? (
              <ul className="max-h-64 divide-y divide-slate-100 overflow-y-auto">
                {bundle.modLogs.rows.map((r, i) => {
                  const log = r as Row;
                  const at = str(log.created_at) || null;
                  return (
                    <li key={str(log.id) || String(i)} className="flex items-center justify-between gap-3 py-1.5 text-xs">
                      <span className="shrink-0 tabular-nums text-slate-500">{formatKoDateTimeKst(at)}</span>
                      <span className="min-w-0 flex-1 truncate text-right font-bold text-slate-800">{disputeActionLogLabel(str(log.action_type))}</span>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-xs text-slate-600">표시할 처리 이력이 없습니다.</p>
            )}
          </Section>
        </div>
      </div>
    </AdminPageLayout>
  );
}
