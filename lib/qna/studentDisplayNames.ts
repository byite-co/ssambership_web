import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * 표시명(학생 닉네임) 조회 공용 규약 (D-QR-7 / D-IQ-6).
 *
 * 멘토 세션은 public.users 를 직접 못 읽으므로 정본 RPC get_mentor_student_nicknames 로
 * 배치 조회한다. 문제는 구 호출부들이 RPC error 를 구조분해조차 하지 않아, 권한·배포 오류로
 * 조회가 실패해도 전원 '이름 미설정'/'학생' 으로 조용히 강등된 것이다(운영·사용자 모두 실패를
 * 인지 못 함). 이 헬퍼는 **빈 결과와 조회 오류를 구분**해 error 플래그를 함께 돌려준다 —
 * 호출부는 error 일 때 '표시 실패' 상태를 노출하고, 정상 빈 결과일 때만 익명 라벨로 강등한다.
 *
 * 순수 판정(buildDisplayNameMap)과 supabase 어댑터(fetchStudentDisplayNames)를 분리해
 * 계약 테스트가 네트워크 없이 이름 폴백·오류 구분을 고정할 수 있게 한다.
 */

export type StudentDisplay = { displayName: string; initial: string };
export type StudentDisplayResult = { byId: Record<string, StudentDisplay>; error: boolean };

export const ANON_STUDENT_LABEL = "이름 미설정";

type NameRow = { id?: unknown; full_name?: unknown; nickname?: unknown };

/** RPC 행들에서 id→표시명 맵을 만든다. full_name → nickname 순 폴백, 없으면 익명 라벨. */
export function buildDisplayNameMap(ids: string[], rows: NameRow[]): Record<string, StudentDisplay> {
  const out: Record<string, StudentDisplay> = {};
  for (const id of ids) {
    const row = rows.find((u) => u.id === id);
    const full = row && typeof row.full_name === "string" ? row.full_name.trim() : "";
    const nick = row && typeof row.nickname === "string" ? row.nickname.trim() : "";
    const name = full || nick || ANON_STUDENT_LABEL;
    out[id] = { displayName: name, initial: name.slice(0, 1) || "?" };
  }
  return out;
}

/**
 * supabase 어댑터. error(RPC 실패·예외)를 **삼키지 않고** 반환한다.
 * 빈 id 목록은 error:false + 빈 맵. RPC 오류·예외는 error:true + (익명 라벨로 채운) 맵.
 */
export async function fetchStudentDisplayNames(
  supabase: SupabaseClient,
  ids: string[],
): Promise<StudentDisplayResult> {
  const idList = [...new Set(ids.filter(Boolean))];
  if (idList.length === 0) return { byId: {}, error: false };
  try {
    const { data, error } = await supabase.rpc("get_mentor_student_nicknames", { p_student_ids: idList });
    if (error) return { byId: buildDisplayNameMap(idList, []), error: true };
    return { byId: buildDisplayNameMap(idList, (data as NameRow[]) ?? []), error: false };
  } catch {
    return { byId: buildDisplayNameMap(idList, []), error: true };
  }
}
