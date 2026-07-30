import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { mentorProfilesAdminReadClient } from "@/lib/admin/mentorProfilesAdminRead";
import {
  adminAppNoticeTypeLabel,
  adminContentTargetDisplay,
  adminOperationalStatusLabel,
} from "@/lib/admin/adminOperationalLabels";
import { contentReportStatusLabel } from "@/lib/admin/contentReportLabels";
import { adminDisputeStatusLabel } from "@/lib/admin/disputeLabels";
import { orderEventKindLabelForUi } from "@/lib/customRequest/orderLifecycleConstants";

type JsonRow = Record<string, unknown>;

const RLS_RETRY = /permission|row-level|rls|policy|denied|42501/i;

export type AdminActivityLogEntry = {
  key: string;
  occurredAtIso: string;
  occurredAtLabel: string;
  categoryLabel: string;
  targetLine: string;
  /** 내부 target_type·ID 등 — 툴팁으로만 */
  targetTooltip?: string | null;
  actorLine: string;
  statusLine: string;
  /** 원문 status — 툴팁으로만 */
  statusTooltip?: string | null;
  summaryLine: string;
  detailHref: string | null;
  detailLabel: string | null;
};

export type AdminUnifiedActivityResult = {
  entries: AdminActivityLogEntry[];
  /** 일부 소스만 실패한 경우 */
  partial: boolean;
  /** 운영자용 한 줄 안내(내부 오류 원문 없음) */
  loadWarning: string | null;
};

export type LoadAdminUnifiedActivityOpts = {
  /** requireRole 이후에만 전달. 세션 RLS 실패 시 동일 SELECT 재시도 */
  adminBypassClient?: SupabaseClient;
  limit?: number;
};

function formatTsKo(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short" }).format(d);
}

function shortId(v: unknown): string {
  if (v == null || v === "") return "—";
  const s = String(v);
  return s.length > 14 ? `${s.slice(0, 12)}…` : s;
}

/** UUID 등 긴 식별자 — 앞 8자만(감사 로그 등) */
function idPrefix8(v: unknown): string {
  if (v == null || v === "") return "—";
  const s = String(v).trim();
  if (!s) return "—";
  if (s.length <= 8) return s;
  return `${s.slice(0, 8)}…`;
}

function asMetaRecord(meta: unknown): Record<string, unknown> | null {
  if (meta && typeof meta === "object" && !Array.isArray(meta)) {
    return meta as Record<string, unknown>;
  }
  if (typeof meta === "string") {
    try {
      const o = JSON.parse(meta) as unknown;
      if (o && typeof o === "object" && !Array.isArray(o)) return o as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  return null;
}

/** 행·metadata에서 소문자 이벤트 키 후보 하나 */
function resolveOrderEventKey(row: JsonRow): string {
  const m = asMetaRecord(row.metadata);
  const fromMeta = m
    ? String(m.event ?? m.kind ?? m.type ?? m.event_type ?? "")
        .trim()
        .toLowerCase()
    : "";
  const ev = String(row.event ?? "").trim().toLowerCase();
  const kd = String(row.kind ?? "").trim().toLowerCase();
  return ev || kd || fromMeta || "";
}

/** 감사 로그용 한 줄 요약(원문 JSON·metadata 전체 출력 금지) */
const ORDER_EVENT_AUDIT_SUMMARY_KO: Record<string, string> = {
  payment_confirmed: "결제가 확인되었습니다.",
  order_started: "멘토가 작업을 시작했습니다.",
  deliverable_submitted: "멘토가 납품 파일을 제출했습니다.",
  deliverable_accepted: "학생이 납품물을 수락했습니다.",
  settlement_item_created: "정산 항목이 생성되었습니다.",
  revision_requested: "학생이 수정 요청을 보냈습니다.",
  dispute_opened: "분쟁이 접수되었습니다.",
  dispute_created: "분쟁이 접수되었습니다.",
  message_created: "주문 관련 메시지가 등록되었습니다.",
};

function orderEventMetadataSuffix(meta: Record<string, unknown> | null, eventKey: string): string {
  if (!meta) return "";
  const parts: string[] = [];
  const ver = meta.version ?? meta.deliverable_version;
  if (typeof ver === "number" && Number.isFinite(ver)) {
    parts.push(`${ver}차`);
  } else if (typeof ver === "string" && String(ver).trim()) {
    const vs = String(ver).trim();
    if (vs.length <= 12) parts.push(vs);
  }
  if (eventKey === "revision_requested" || eventKey === "message_created") {
    const note = meta.note ?? meta.body ?? meta.message ?? meta.comment ?? meta.reason;
    if (typeof note === "string" && note.trim()) {
      parts.push(clipText(note, 40));
    }
  }
  const delId = meta.deliverable_id;
  if (
    delId != null &&
    String(delId).trim() !== "" &&
    (eventKey === "deliverable_submitted" || eventKey === "deliverable_accepted")
  ) {
    parts.push(`납품 ${idPrefix8(delId)}`);
  }
  if (parts.length === 0) return "";
  return ` · ${parts.join(" · ")}`;
}

function buildOrderEventAuditSummary(row: JsonRow): string {
  const key = resolveOrderEventKey(row);
  const meta = asMetaRecord(row.metadata);
  const suffix = orderEventMetadataSuffix(meta, key);
  const sentence = key ? ORDER_EVENT_AUDIT_SUMMARY_KO[key] : "";
  if (sentence) return `${sentence}${suffix}`;
  if (key) {
    if (/^[0-9a-f-]{36}$/i.test(key.trim())) {
      return suffix ? `주문 이벤트${suffix}` : "주문 이벤트 기록";
    }
    const label = orderEventKindLabelForUi(key);
    return label !== "기록" ? `${label}${suffix}` : `이벤트: ${key.replace(/_/g, " ")}${suffix}`;
  }
  return suffix ? `주문 이벤트${suffix}` : "주문 이벤트 기록";
}

function buildOrderEventActorLine(row: JsonRow): string {
  const meta = asMetaRecord(row.metadata);
  if (!meta) return "—";
  const actor =
    meta.actor_id ?? meta.user_id ?? meta.author_id ?? meta.created_by ?? meta.sender_id ?? meta.student_id ?? meta.mentor_id;
  if (actor == null || String(actor).trim() === "") return "—";
  return `관련 ${idPrefix8(actor)}`;
}

function clipText(v: unknown, max: number): string {
  if (v == null) return "—";
  const t = String(v).trim();
  if (!t) return "—";
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

function firstTs(row: JsonRow, keys: readonly string[]): string {
  for (const k of keys) {
    const v = row[k];
    if (v != null && String(v).trim()) return String(v);
  }
  return new Date().toISOString();
}

async function withReadFallback<T>(
  primary: SupabaseClient,
  bypass: SupabaseClient | undefined,
  run: (c: SupabaseClient) => Promise<{ data: T | null; error: { message: string } | null }>
): Promise<{ data: T | null; error: string | null }> {
  const first = await run(primary);
  if (!first.error) return { data: first.data, error: null };
  if (bypass && RLS_RETRY.test(first.error.message)) {
    const second = await run(bypass);
    return { data: second.data, error: second.error?.message ?? null };
  }
  return { data: first.data, error: first.error.message };
}

// W4(C10): 스키마 부재류 에러(MISSING 정규식)를 무시하던 분기 제거 — 9개 소스 테이블은 전부 187 baseline 에
// 실존하므로 어떤 실패든 partial=true 로 표면화한다(스키마 드리프트를 무음으로 삼키지 않음).
function markPartial(partial: { v: boolean }, err: string | null): void {
  if (err) partial.v = true;
}

export async function loadAdminUnifiedActivityLog(
  sessionClient: SupabaseClient,
  opts?: LoadAdminUnifiedActivityOpts
): Promise<AdminUnifiedActivityResult> {
  const limit = Math.min(50, Math.max(1, opts?.limit ?? 50));
  const perSource = Math.min(20, Math.ceil(limit / 3));
  const bypass = opts?.adminBypassClient;
  const mpClient = mentorProfilesAdminReadClient(sessionClient);
  const partial = { v: false };
  const entries: AdminActivityLogEntry[] = [];

  // W4(C10): reviews.moderated_at·moderation_state·moderated_by 실존(033/123 SQL, 187 baseline 실측) — 컬럼 프로빙 제거, 고정 select.
  const reviewSelect = "id, body, moderation_state, moderated_at, moderated_by, mentor_id, author_id, created_at";

  // admin_action_logs — 관리자 조치의 정본 감사 트레일(logAdminAction 기록)
  {
    const { data, error } = await withReadFallback(sessionClient, bypass, async (c) => {
      const { data: d, error: e } = await c
        .from("admin_action_logs")
        .select("id, admin_id, action_type, target_type, target_id, detail, created_at")
        .order("created_at", { ascending: false })
        .limit(perSource);
      return { data: d as JsonRow[] | null, error: e };
    });
    markPartial(partial, error);
    for (const row of (data ?? []) as JsonRow[]) {
      const id = String(row.id ?? "");
      const iso = firstTs(row, ["created_at"]);
      const actionType = String(row.action_type ?? "").trim();
      const targetType = String(row.target_type ?? "").trim();
      const detail = asMetaRecord(row.detail);
      const note = detail && typeof detail.note === "string" ? detail.note : "";
      entries.push({
        key: `adminaction:${id}`,
        occurredAtIso: iso,
        occurredAtLabel: formatTsKo(iso),
        categoryLabel: "관리자 조치",
        targetLine: targetType ? `${targetType} · ${shortId(row.target_id)}` : shortId(row.target_id),
        targetTooltip: [targetType, row.target_id == null ? "" : String(row.target_id)].filter(Boolean).join(" · ") || null,
        actorLine: `관리자 ${idPrefix8(row.admin_id)}`,
        statusLine: actionType || "—",
        statusTooltip: actionType || null,
        summaryLine: note ? clipText(note, 140) : "관리자 조치가 기록되었습니다.",
        detailHref: null,
        detailLabel: null,
      });
    }
  }

  // content_reports
  {
    const { data, error } = await withReadFallback(sessionClient, bypass, async (c) => {
      const { data: d, error: e } = await c
        .from("content_reports")
        .select("id, status, reporter_id, target_type, target_id, reason, description, updated_at, created_at, resolved_by")
        .order("updated_at", { ascending: false })
        .limit(perSource);
      return { data: d as JsonRow[] | null, error: e };
    });
    markPartial(partial, error);
    for (const row of (data ?? []) as JsonRow[]) {
      const id = String(row.id ?? "");
      const iso = firstTs(row, ["updated_at", "created_at"]);
      const tt = String(row.target_type ?? row.subject_type ?? row.resource_type ?? "").trim();
      const { label: tgtLabel } = adminContentTargetDisplay(tt);
      const tidRaw = row.target_id ?? row.target_uuid;
      const tidStr = tidRaw != null && String(tidRaw).trim() ? String(tidRaw).trim() : "";
      const statusRaw = typeof row.status === "string" ? String(row.status).trim() : "";
      entries.push({
        key: `report:${id}`,
        occurredAtIso: iso,
        occurredAtLabel: formatTsKo(iso),
        categoryLabel: "콘텐츠 신고",
        targetLine: tidStr ? `${tgtLabel} · ${shortId(tidRaw)}` : tgtLabel,
        targetTooltip: [tt, tidStr].filter(Boolean).join(" · ") || null,
        actorLine: `신고자 ${shortId(row.reporter_id)}`,
        statusLine: contentReportStatusLabel(statusRaw),
        statusTooltip: statusRaw || null,
        summaryLine: clipText(row.reason ?? row.description, 140),
        detailHref: "/admin/reports",
        detailLabel: "신고 관리",
      });
    }
  }

  // disputes
  {
    const { data, error } = await withReadFallback(sessionClient, bypass, async (c) => {
      const { data: d, error: e } = await c
        .from("disputes")
        .select("id, status, student_id, mentor_id, custom_request_order_id, body, updated_at, created_at, resolved_by")
        .order("updated_at", { ascending: false })
        .limit(perSource);
      return { data: d as JsonRow[] | null, error: e };
    });
    markPartial(partial, error);
    for (const row of (data ?? []) as JsonRow[]) {
      const id = String(row.id ?? "");
      const iso = firstTs(row, ["updated_at", "created_at"]);
      const st = String(row.status ?? "").trim();
      entries.push({
        key: `dispute:${id}`,
        occurredAtIso: iso,
        occurredAtLabel: formatTsKo(iso),
        categoryLabel: "분쟁",
        targetLine: `의뢰 주문 ${shortId(row.custom_request_order_id)}`,
        targetTooltip: row.custom_request_order_id != null ? String(row.custom_request_order_id) : null,
        actorLine: `학생 ${shortId(row.student_id)} · 멘토 ${shortId(row.mentor_id)}`,
        statusLine: adminDisputeStatusLabel(st),
        statusTooltip: st || null,
        summaryLine: clipText(row.body, 140),
        detailHref: `/admin/disputes/${encodeURIComponent(id)}`,
        detailLabel: "분쟁 상세",
      });
    }
  }

  // refunds
  {
    const { data, error } = await withReadFallback(sessionClient, bypass, async (c) => {
      const { data: d, error: e } = await c
        .from("refunds")
        .select("id, status, user_id, amount_cents, payment_id, custom_request_order_id, created_at")
        .order("created_at", { ascending: false })
        .limit(perSource);
      return { data: d as JsonRow[] | null, error: e };
    });
    markPartial(partial, error);
    for (const row of (data ?? []) as JsonRow[]) {
      const id = String(row.id ?? "");
      const iso = firstTs(row, ["created_at"]);
      const cents = row.amount_cents;
      const amt =
        typeof cents === "number" && Number.isFinite(cents)
          ? `${(cents / 100).toLocaleString("ko-KR")}원(표시용)`
          : "금액 확인 필요";
      const st = String(row.status ?? "").trim();
      entries.push({
        key: `refund:${id}`,
        occurredAtIso: iso,
        occurredAtLabel: formatTsKo(iso),
        categoryLabel: "환불",
        targetLine: `결제 ${shortId(row.payment_id)} · 주문 ${shortId(row.custom_request_order_id)}`,
        targetTooltip: [row.payment_id, row.custom_request_order_id].filter(Boolean).map(String).join(" · ") || null,
        actorLine: `신청자 ${shortId(row.user_id)}`,
        statusLine: adminOperationalStatusLabel(st),
        statusTooltip: st || null,
        summaryLine: `${amt} · 승인·정산은 별도 메뉴에서 수동 처리합니다.`,
        detailHref: `/admin/refunds?refundId=${encodeURIComponent(id)}`,
        detailLabel: "환불 관리",
      });
    }
  }

  // reviews
  {
    const { data, error } = await withReadFallback(sessionClient, bypass, async (c) => {
      const { data: d, error: e } = await c
        .from("reviews")
        .select(reviewSelect)
        .order("created_at", { ascending: false })
        .limit(perSource);
      return { data: d as JsonRow[] | null, error: e };
    });
    markPartial(partial, error);
    for (const row of (data ?? []) as JsonRow[]) {
      const id = String(row.id ?? "");
      const hasMod = row.moderated_at != null && String(row.moderated_at).trim() !== "";
      const iso = firstTs(row, hasMod ? ["moderated_at", "created_at"] : ["created_at"]);
      const cat = hasMod ? "리뷰 조치" : "리뷰";
      const modState = String(row.moderation_state ?? "").trim();
      entries.push({
        key: `review:${id}`,
        occurredAtIso: iso,
        occurredAtLabel: formatTsKo(iso),
        categoryLabel: cat,
        targetLine: `멘토 ${shortId(row.mentor_id)} · 작성자 ${shortId(row.author_id)}`,
        targetTooltip: [row.mentor_id, row.author_id].filter(Boolean).map(String).join(" · ") || null,
        actorLine: hasMod ? `조치자 ${shortId(row.moderated_by)}` : `작성자 ${shortId(row.author_id)}`,
        statusLine: modState ? adminOperationalStatusLabel(modState) : "—",
        statusTooltip: modState || null,
        summaryLine: clipText(row.body, 140),
        detailHref: "/admin/reviews",
        detailLabel: "리뷰 관리",
      });
    }
  }

  // order_events
  {
    const { data, error } = await withReadFallback(sessionClient, bypass, async (c) => {
      const { data: d, error: e } = await c
        .from("order_events")
        .select("id, custom_request_order_id, event, kind, metadata, created_at")
        .order("created_at", { ascending: false })
        .limit(perSource);
      return { data: d as JsonRow[] | null, error: e };
    });
    markPartial(partial, error);
    for (const row of (data ?? []) as JsonRow[]) {
      const id = String(row.id ?? "");
      const iso = firstTs(row, ["created_at"]);
      const eventKey = resolveOrderEventKey(row);
      entries.push({
        key: `order_event:${id}`,
        occurredAtIso: iso,
        occurredAtLabel: formatTsKo(iso),
        categoryLabel: "주문·의뢰 이벤트",
        targetLine: `의뢰 주문 ${idPrefix8(row.custom_request_order_id)}`,
        targetTooltip: row.custom_request_order_id != null ? String(row.custom_request_order_id) : null,
        actorLine: buildOrderEventActorLine(row),
        statusLine: clipText(orderEventKindLabelForUi(eventKey || String(row.kind ?? row.event ?? "")), 32),
        statusTooltip: [row.event, row.kind].filter(Boolean).map(String).join(" / ") || eventKey || null,
        summaryLine: buildOrderEventAuditSummary(row),
        detailHref: null,
        detailLabel: null,
      });
    }
  }

  // app_notices
  {
    const { data, error } = await withReadFallback(sessionClient, bypass, async (c) => {
      const { data: d, error: e } = await c
        .from("app_notices")
        .select("id, title, type, is_active, created_by, updated_by, updated_at, created_at")
        .order("updated_at", { ascending: false })
        .limit(perSource);
      return { data: d as JsonRow[] | null, error: e };
    });
    markPartial(partial, error);
    for (const row of (data ?? []) as JsonRow[]) {
      const id = String(row.id ?? "");
      const iso = firstTs(row, ["updated_at", "created_at"]);
      entries.push({
        key: `notice:${id}`,
        occurredAtIso: iso,
        occurredAtLabel: formatTsKo(iso),
        categoryLabel: "공지",
        targetLine: clipText(row.title, 80),
        targetTooltip: typeof row.title === "string" ? row.title : null,
        actorLine: `최종 ${shortId(row.updated_by ?? row.created_by)}`,
        statusLine: row.is_active === true ? "활성" : "비활성",
        statusTooltip: null,
        summaryLine: `유형 ${adminAppNoticeTypeLabel(String(row.type))}`,
        detailHref: "/admin/notices",
        detailLabel: "공지·프로모션",
      });
    }
  }

  // promotion_campaigns
  {
    const { data, error } = await withReadFallback(sessionClient, bypass, async (c) => {
      const { data: d, error: e } = await c
        .from("promotion_campaigns")
        .select("id, title, is_active, created_by, updated_by, updated_at, created_at")
        .order("updated_at", { ascending: false })
        .limit(perSource);
      return { data: d as JsonRow[] | null, error: e };
    });
    markPartial(partial, error);
    for (const row of (data ?? []) as JsonRow[]) {
      const id = String(row.id ?? "");
      const iso = firstTs(row, ["updated_at", "created_at"]);
      entries.push({
        key: `promo:${id}`,
        occurredAtIso: iso,
        occurredAtLabel: formatTsKo(iso),
        categoryLabel: "프로모션",
        targetLine: clipText(row.title, 80),
        targetTooltip: typeof row.title === "string" ? row.title : null,
        actorLine: `최종 ${shortId(row.updated_by ?? row.created_by)}`,
        statusLine: row.is_active === true ? "활성" : "비활성",
        statusTooltip: null,
        summaryLine: "캠페인 변경 기록",
        detailHref: "/admin/notices",
        detailLabel: "공지·프로모션",
      });
    }
  }

  // mentor_profiles
  {
    const { data, error } = await mpClient
      .from("mentor_profiles")
      .select("user_id, verification_status, university_name, updated_at, created_at")
      .order("updated_at", { ascending: false })
      .limit(perSource);
    markPartial(partial, error?.message ?? null);
    for (const row of (data ?? []) as JsonRow[]) {
      const uid = String(row.user_id ?? "");
      const iso = firstTs(row, ["updated_at", "created_at"]);
      const ver = String(row.verification_status ?? "").trim();
      entries.push({
        key: `mentor_profile:${uid}`,
        occurredAtIso: iso,
        occurredAtLabel: formatTsKo(iso),
        categoryLabel: "멘토 인증·프로필",
        targetLine: `멘토 ${shortId(uid)}`,
        targetTooltip: uid || null,
        actorLine: shortId(uid),
        statusLine: adminOperationalStatusLabel(ver),
        statusTooltip: ver || null,
        summaryLine: clipText(row.university_name, 120),
        detailHref: "/admin/mentor-approvals",
        detailLabel: "멘토 승인",
      });
    }
  }

  // verification_logs
  {
    const { data, error } = await withReadFallback(sessionClient, bypass, async (c) => {
      const { data: d, error: e } = await c
        .from("verification_logs")
        .select("id, user_id, log_type, status, memo, created_at")
        .order("created_at", { ascending: false })
        .limit(perSource);
      return { data: d as JsonRow[] | null, error: e };
    });
    markPartial(partial, error);
    for (const row of (data ?? []) as JsonRow[]) {
      const id = String(row.id ?? "");
      const iso = firstTs(row, ["created_at"]);
      const vSt = String(row.status ?? "").trim();
      entries.push({
        key: `ver_log:${id}`,
        occurredAtIso: iso,
        occurredAtLabel: formatTsKo(iso),
        categoryLabel: "인증·검증 로그",
        targetLine: `사용자 ${shortId(row.user_id)}`,
        targetTooltip: row.user_id != null ? String(row.user_id) : null,
        actorLine: shortId(row.user_id),
        statusLine: adminOperationalStatusLabel(vSt),
        statusTooltip: vSt || null,
        summaryLine: `${clipText(row.log_type, 40)} · ${clipText(row.memo, 100)}`,
        detailHref: "/admin/mentor-approvals",
        detailLabel: "멘토 승인",
      });
    }
  }

  entries.sort((a, b) => (a.occurredAtIso < b.occurredAtIso ? 1 : a.occurredAtIso > b.occurredAtIso ? -1 : 0));
  const sliced = entries.slice(0, limit);

  return {
    entries: sliced,
    partial: partial.v,
    loadWarning: partial.v
      ? "일부 출처는 불러오지 못했습니다. 표시된 항목만 최근 순으로 보여 드립니다."
      : null,
  };
}
