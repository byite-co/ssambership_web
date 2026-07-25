import { redirect } from "next/navigation";
import { PageScaffold } from "@/components/shell/PageScaffold";
import {
  CustomRequestOrderCompleteView,
  type CustomRequestOrderCompleteViewProps,
} from "@/components/customRequest/CustomRequestOrderCompleteView";
import { requireRole } from "@/lib/auth/routeGuard";
import { loadOrderBundle, pickDisplayField } from "@/lib/customRequest/customRequestQueries";
import { canAccessOrder } from "@/lib/customRequest/orderAccess";
import { pickStoragePathFromDeliverableRow } from "@/lib/customRequest/orderDeliverableFiles";
import {
  loadOrderDetailPageData,
  pickMentorIdFromOrderRow,
} from "@/lib/customRequest/orderDetailQueries";
import {
  formatOrderRoomDate,
  formatOrderRoomDateTime,
} from "@/lib/customRequest/orderLifecycleConstants";
import { mapPostRowToPublicDetail } from "@/lib/customRequest/customRequestPostMappers";
import { checkReviewEligibility } from "@/lib/reviews/checkReviewEligibility";
import { createClient } from "@/lib/supabase/server";

type Row = Record<string, unknown>;

type PageProps = {
  params: Promise<{ orderId: string }>;
};

export const dynamic = "force-dynamic";
export const revalidate = 0;

function parseDate(v: unknown): Date | null {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v;
  if (typeof v === "string" && v.trim()) {
    const d = new Date(v);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return null;
}

function pickTimestamp(row: Row | null, keys: readonly string[]): unknown {
  if (!row) return null;
  for (const k of keys) {
    const v = row[k];
    if (v != null && String(v).trim()) return v;
  }
  return null;
}

function computeDurationLabel(startRaw: unknown, endRaw: unknown): string {
  const start = parseDate(startRaw);
  const end = parseDate(endRaw);
  if (!start || !end) return "—";
  const diffMs = Math.max(0, end.getTime() - start.getTime());
  const days = Math.max(1, Math.ceil(diffMs / 86_400_000));
  return `${days}일`;
}

function formatFileSize(bytes: number | null): string {
  if (bytes == null || !Number.isFinite(bytes)) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function pickDeliverableSize(row: Row): number | null {
  for (const k of ["file_size", "file_size_bytes", "size_bytes", "size"] as const) {
    const v = row[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return null;
}

function pickDeliverableFileName(row: Row): string {
  const name = pickDisplayField(row, ["original_filename", "file_name", "filename", "original_name"]);
  return name !== "—" ? name : "납품 파일";
}

function pickAmountLabel(order: Row | null, headerPriceLine: string): string {
  if (headerPriceLine && headerPriceLine !== "—") return headerPriceLine;
  for (const k of ["agreed_price", "proposed_price", "price", "amount", "total_amount"] as const) {
    const v = order?.[k];
    if (typeof v === "number" && Number.isFinite(v)) {
      return `${v.toLocaleString("ko-KR")}캐시`;
    }
  }
  return "—";
}

function mapCompleteViewProps(
  orderId: string,
  order: Row,
  detail: NonNullable<Awaited<ReturnType<typeof loadOrderDetailPageData>>>,
  mentorId: string | null,
  reviewEligible: boolean,
  reviewTooltip: string
): CustomRequestOrderCompleteViewProps {
  const completedRaw = pickTimestamp(order, ["completed_at", "closed_at", "finished_at", "accepted_at"]);
  const createdRaw = pickTimestamp(order, ["created_at", "opened_at", "started_at"]);
  const paidRaw = pickTimestamp(order, ["paid_at", "payment_completed_at", "payment_paid_at"]);
  const postRow = detail.post.row as Row | null;
  const deadline = postRow ? mapPostRowToPublicDetail(postRow).deadline : "—";

  const latest = detail.latestDeliverable as Row | null;
  const deliverable =
    latest && typeof latest.id === "string"
      ? {
          id: latest.id,
          fileName: pickDeliverableFileName(latest),
          sizeLabel: formatFileSize(pickDeliverableSize(latest)),
          downloadable: Boolean(pickStoragePathFromDeliverableRow(latest)),
        }
      : null;

  const reviewHref = mentorId ? `/mentors/${encodeURIComponent(mentorId)}#reviews` : "/mentors";

  return {
    orderId,
    completedAtLabel: formatOrderRoomDateTime(completedRaw),
    summary: {
      mentorName: detail.header.mentorName,
      requestTitle: detail.header.requestTitle,
      finalAmountLabel: pickAmountLabel(order, detail.header.priceLine),
      durationLabel: computeDurationLabel(createdRaw, completedRaw),
      completedDateLabel: formatOrderRoomDate(completedRaw),
      deadlineLabel: deadline,
    },
    deliverable,
    payment: {
      amountLabel: pickAmountLabel(order, detail.header.priceLine),
      feeLabel: "5%",
      paidAtLabel: formatOrderRoomDateTime(paidRaw ?? completedRaw),
    },
    review: {
      eligible: reviewEligible,
      tooltip: reviewTooltip,
      href: reviewHref,
    },
  };
}

export default async function CustomRequestOrderCompletePage(props: PageProps) {
  const { orderId } = await props.params;
  const { user } = await requireRole("student");
  const supabase = await createClient();

  const bundle = await loadOrderBundle(supabase, orderId);
  const access = canAccessOrder(bundle.order.row, user.id, "student");

  if (!bundle.order.row || !access.ok) {
    redirect(`/custom-request/orders/${orderId}?error=${encodeURIComponent("접근 권한이 없습니다.")}`);
  }

  const detail = await loadOrderDetailPageData(supabase, orderId, bundle);
  const order = bundle.order.row as Row;
  const mentorId = pickMentorIdFromOrderRow(order);

  let reviewEligible = false;
  let reviewTooltip = "구독 또는 개별 질문 이용 이력이 있으면 작성 가능";
  if (mentorId) {
    // 자격 판정은 checkReviewEligibility(=SQL 170 과 동일 기준) 하나만 쓴다.
    // 구 기준의 `subscriptionCount < 2` 재판정은 폐기됐다 — 화면이 서버와 어긋나던 원인.
    const eligibility = await checkReviewEligibility(supabase, user.id, mentorId);
    reviewEligible = eligibility.eligible && (eligibility.mode !== "edit" || eligibility.canEdit);
    if (!reviewEligible) {
      reviewTooltip = eligibility.reason ?? "지금은 후기를 작성할 수 없습니다.";
    }
  }

  const viewProps = mapCompleteViewProps(orderId, order, detail, mentorId, reviewEligible, reviewTooltip);

  return (
    <PageScaffold
      compactHero
      hideHero
      hideFooterPlaceholderCards
      eyebrow="맞춤의뢰"
      title="주문 완료"
      description="의뢰가 성공적으로 마무리되었어요. 납품 파일과 결제 내역을 확인해 주세요."
      ctas={[
        { href: "/custom-request", label: "맞춤의뢰", tone: "slate" },
        { href: `/custom-request/orders/${orderId}`, label: "주문방", tone: "slate" },
      ]}
      sections={[]}
      emptyState=""
      dataPoints={[]}
    >
      <div className="mx-auto w-full max-w-6xl px-3 pb-12 sm:px-4 lg:px-0">
        <CustomRequestOrderCompleteView {...viewProps} />
      </div>
    </PageScaffold>
  );
}
