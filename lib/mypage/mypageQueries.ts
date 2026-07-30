import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchRoomsForUser } from "@/lib/qna/questionRoomQueries";
import type { UserRow } from "@/lib/types/user";

/** PageScaffold 하단 연결 포인트 목록 */
export const MYPAGE_DATA_MODEL = [
  "프로필",
  "질문방 안내·바로가기",
  "구독 건수",
  "결제·주문 건수",
  "알림 건수",
  "리뷰·신고(준비 중)",
] as const;

export type MypageMetric = {
  /** empty면 조회는 됐으나 0건, skeleton이면 일시적으로 집계를 불러오지 못한 상태 */
  label: string;
  valueText: string;
  status: "connected" | "empty" | "skeleton";
  detail: string;
};

type CountResult = { n: number; error: null } | { n: null; error: string };

/**
 * S2-2 전환 W4(C10): 정본 테이블·FK 컬럼을 호출부가 명시하는 단일 count 조회.
 * 구 FK 후보 7종 순회·오류 메시지 분기(column/schema cache → 다음 후보)는 제거했다.
 * 조회 오류는 error 로 반환한다(0건·빈 결과로 은폐하지 않는다 — 표시층은 skeleton 상태).
 */
async function countRowsForUser(
  supabase: SupabaseClient,
  table: string,
  column: string,
  userId: string
): Promise<CountResult> {
  const { count, error } = await supabase
    .from(table)
    .select("*", { count: "exact", head: true })
    .eq(column, userId);
  if (error) return { n: null, error: error.message };
  if (count === null) return { n: null, error: "일시적으로 건수를 가져올 수 없어요" };
  return { n: count, error: null };
}

function toMetric(
  table: string,
  label: string,
  r: CountResult
): { metric: MypageMetric; connected: boolean } {
  if (r.error) {
    return {
      connected: false,
      metric: {
        label,
        valueText: "—",
        status: "skeleton",
        detail: "잠시 후 다시 시도하거나, 문제가 계속되면 고객센터로 문의해 주세요",
      },
    };
  }
  return {
    connected: true,
    metric: {
      label,
      valueText: String(r.n),
      status: r.n === 0 ? "empty" : "connected",
      detail: r.n === 0 ? "해당 항목이 아직 없어요" : `총 ${r.n}건이에요`,
    },
  };
}

type ScaffoldRow = { title: string; body: string; status: "skeleton" | "connected" };

export type StudentMypageBundle = {
  profile: UserRow | null;
  profileError: string | null;
  roomCount: { n: number; error: string | null };
  subscriptions: MypageMetric;
  payments: MypageMetric;
  notifications: MypageMetric;
  reviews: MypageMetric;
  reports: MypageMetric;
  scaffoldSummary: ScaffoldRow[];
};

/**
 * 캐시/커뮤니티 모듈을 수정하지 않고, 마이페이지 전용 정본 count 조회만 수행
 */
export async function loadStudentMypageBundle(
  supabase: SupabaseClient,
  userId: string,
  profile: UserRow | null,
  profileError: string | null
): Promise<StudentMypageBundle> {
  const { rows, error: roomErr } = await fetchRoomsForUser(supabase, "student", userId);
  const roomCount = { n: roomErr ? 0 : rows.length, error: roomErr };

  // W4(C10) 정본 고정: subscriptions.student_id · payments.user_id(idx_payments_user) ·
  // notifications.user_id(notif_select_recipient) · reviews.author_id(reviews_select_author) ·
  // content_reports.reporter_id(content_reports_select_reporter). 구 mentor_reviews /
  // reports / abuse_reports fallback(baseline 부재 테이블)은 제거했다.
  const s = toMetric("subscriptions", "구독", await countRowsForUser(supabase, "subscriptions", "student_id", userId));
  const p = toMetric("payments", "결제", await countRowsForUser(supabase, "payments", "user_id", userId));
  const n = toMetric("notifications", "알림", await countRowsForUser(supabase, "notifications", "user_id", userId));
  const reviewsMetric = toMetric("reviews", "리뷰", await countRowsForUser(supabase, "reviews", "author_id", userId)).metric;
  const reportsMetric = toMetric(
    "content_reports",
    "신고",
    await countRowsForUser(supabase, "content_reports", "reporter_id", userId)
  ).metric;

  const subsConn = s.connected;
  const payConn = p.connected;
  const notifConn = n.connected;

  const roleLabel =
    profile?.role === "student" ? "학생" : profile?.role === "mentor" ? "멘토" : profile?.role === "admin" ? "운영" : "계정";
  const scaff: ScaffoldRow[] = [
    {
      title: "프로필",
      body: profile
        ? `닉네임·이름: ${profile.nickname ?? profile.full_name ?? "—"} (${roleLabel})`
        : (profileError ?? "프로필을 불러오지 못했어요."),
      status: profile ? "connected" : "skeleton",
    },
    {
      title: "질문방",
      body: roomCount.error
        ? "질문방 목록을 불러오지 못했어요. 잠시 후 다시 시도해 주세요."
        : `사용 중인 질문방 ${roomCount.n}곳이에요.`,
      status: roomCount.error ? "skeleton" : "connected",
    },
    {
      title: "구독",
      body: s.metric.detail,
      status: subsConn ? "connected" : "skeleton",
    },
    {
      title: "결제",
      body: p.metric.detail,
      status: payConn ? "connected" : "skeleton",
    },
    {
      title: "알림",
      body: n.metric.detail,
      status: notifConn ? "connected" : "skeleton",
    },
    {
      title: "리뷰·신고",
      body: "이용 내역이 생기면 이곳에서 확인하실 수 있어요.",
      status: "skeleton",
    },
  ];

  return {
    profile,
    profileError: profile ? null : (profileError ?? "프로필이 없습니다."),
    roomCount,
    subscriptions: s.metric,
    payments: p.metric,
    notifications: n.metric,
    reviews: reviewsMetric,
    reports: reportsMetric,
    scaffoldSummary: scaff,
  };
}
