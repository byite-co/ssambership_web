import type { SupabaseClient } from "@supabase/supabase-js";
// W4(C10): custom_request_applications 정본 테이블·mentor_id 정본 컬럼 고정(003, 187 baseline) — 프로빙 제거
import { pickDisplayField } from "@/lib/customRequest/customRequestQueries";
import { pickOrderStudentId } from "@/lib/customRequest/orderRoomMutations";
import { maskStudentName } from "@/lib/reviews/reviewDisplay";

type Row = Record<string, unknown>;

type MentorStudentNameFields = { full_name: string | null; nickname: string | null };

/** nickname > maskStudentName(full_name) > "의뢰자" — UUID 노출 없음 */
export function formatMentorStudentDisplayName(user: MentorStudentNameFields | null | undefined): string {
  if (!user) return "의뢰자";
  if (user.nickname?.trim()) return user.nickname.trim();
  if (user.full_name?.trim()) return maskStudentName(user.full_name, user.nickname);
  return "의뢰자";
}

/** 멘토 세션 — get_mentor_student_nicknames RPC로 단일 학생 표시명 조회(실패 시 "의뢰자"). */
export async function fetchMentorStudentDisplayName(
  supabase: SupabaseClient,
  studentId: string | null | undefined
): Promise<string> {
  const sid = typeof studentId === "string" ? studentId.trim() : "";
  if (!sid) return "의뢰자";
  // W4(C10): RPC 오류를 무음으로 삼키지 않고 로그로 표면화. 반환값 "의뢰자"는 표시 전용 강등
  // (멘토 화면의 학생 표시명 마스킹 기본값)이며 성공이 아님 — 조회 자체는 정본 RPC(058/140) 단일 경로.
  try {
    const { data, error } = await supabase.rpc("get_mentor_student_nicknames", {
      p_student_ids: [sid],
    });
    if (error) {
      console.error("[fetchMentorStudentDisplayName] rpc failed", error.message);
      return "의뢰자";
    }
    const row = ((data as Row[]) ?? []).find((u) => u.id === sid);
    if (!row) return "의뢰자";
    return formatMentorStudentDisplayName({
      full_name: typeof row.full_name === "string" ? row.full_name : null,
      nickname: typeof row.nickname === "string" ? row.nickname : null,
    });
  } catch (e) {
    console.error("[fetchMentorStudentDisplayName] rpc threw", e instanceof Error ? e.message : e);
    return "의뢰자";
  }
}

function pickApplicationIdFromOrderRow(r: Row): string | null {
  for (const k of ["application_id", "custom_request_application_id", "selected_application_id", "bid_id"] as const) {
    const v = r[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

function pickPostIdFromOrderRow(r: Row): string | null {
  for (const k of ["post_id", "custom_request_post_id", "request_id", "custom_request_id"] as const) {
    const v = r[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

/**
 * 대시보드·수락된 의뢰 목록 — 주문 행에 post/application/학생 닉네임 힌트를 merge(표시 전용).
 * 학생 이름은 get_mentor_student_nicknames RPC(멘토 주문 연결 학생만). RLS로 post가 막히면 application 마감만 보강될 수 있음.
 */
export async function enrichMentorDashboardOrderRows(
  supabase: SupabaseClient,
  mentorId: string,
  orders: Row[]
): Promise<Row[]> {
  if (orders.length === 0) return orders;

  const appIds = [...new Set(orders.map(pickApplicationIdFromOrderRow).filter(Boolean))] as string[];
  const postIds = [...new Set(orders.map(pickPostIdFromOrderRow).filter(Boolean))] as string[];
  const studentIds = [...new Set(orders.map((o) => pickOrderStudentId(o)).filter(Boolean))];

  const appsById = new Map<string, Row>();
  if (appIds.length > 0) {
    // W4(C10): custom_request_applications.mentor_id 정본 고정 — 테이블/컬럼 프로빙 제거.
    // 오류는 로그로 표면화 후 보강 생략 — 표시 전용 강등(제목·마감 힌트 merge), 성공 아님.
    const { data, error } = await supabase
      .from("custom_request_applications")
      .select("*")
      .in("id", appIds)
      .eq("mentor_id", mentorId);
    if (error) {
      console.error("[enrichMentorDashboardOrderRows] applications query failed", error.message);
    }
    for (const row of (data as Row[] | null) ?? []) {
      const id = typeof row.id === "string" ? row.id : "";
      if (id) appsById.set(id, row);
    }
  }

  // D-CR-7: slice(0,12) 절단 제거 — custom_request_posts 를 in(postIds) 단일 배치로 조회해
  // 13번째 이후 주문의 제목·마감 힌트 누락(빈 제목)을 막는다. RLS로 막힌 post 는 조용히 생략(표시 전용 강등).
  const postsById = new Map<string, Row>();
  if (postIds.length > 0) {
    const { data, error } = await supabase
      .from("custom_request_posts")
      .select("*")
      .in("id", postIds);
    if (error) {
      console.error("[enrichMentorDashboardOrderRows] posts query failed", error.message);
    }
    for (const row of (data as Row[] | null) ?? []) {
      const pid = typeof row.id === "string" ? row.id : "";
      if (pid) postsById.set(pid, row);
    }
  }

  const usersById = new Map<string, { full_name: string | null; nickname: string | null }>();
  if (studentIds.length > 0) {
    const { data, error } = await supabase.rpc("get_mentor_student_nicknames", {
      p_student_ids: studentIds,
    });
    if (error) {
      // W4(C10): 표시 전용 강등(학생 표시명 힌트) — 오류를 로그로 표면화, 성공 아님.
      console.error("[enrichMentorDashboardOrderRows] nickname rpc failed", error.message);
    }
    for (const u of (data as Row[] | null) ?? []) {
      const id = typeof u.id === "string" ? u.id : "";
      if (id) {
        usersById.set(id, {
          full_name: typeof u.full_name === "string" ? u.full_name : null,
          nickname: typeof u.nickname === "string" ? u.nickname : null,
        });
      }
    }
  }

  return orders.map((order) => {
    const merged: Row = { ...order };
    const appId = pickApplicationIdFromOrderRow(order);
    const app = appId ? appsById.get(appId) : null;
    const postId = pickPostIdFromOrderRow(order);
    const post = postId ? postsById.get(postId) : null;

    if (post) {
      const title = pickDisplayField(post, ["title", "subject", "goal"]);
      if (title !== "—") merged.post_title = title;
    }

    if (app) {
      const due = pickDisplayField(app, ["proposed_due", "delivery_at", "due_proposed"]);
      if (due !== "—" && pickDisplayField(merged, ["deadline", "due_at", "due_date", "close_at"]) === "—") {
        merged.deadline = due;
      }
    }

    const sid = pickOrderStudentId(order);
    const user = sid ? usersById.get(sid) : null;
    if (user) {
      merged.student_name = formatMentorStudentDisplayName(user);
    } else if (sid) {
      merged.student_name = sid.length > 10 ? `의뢰자 ····${sid.slice(-6)}` : `의뢰자 ${sid}`;
    }

    return merged;
  });
}
