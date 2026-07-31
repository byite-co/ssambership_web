// W4(C10): pickExistingColumn(후보 컬럼 순회 런타임 프로빙) 삭제 — 전 호출부(226건 인벤토리)가
// 정본 테이블·컬럼 단일 조회로 전환 완료, 활성 호출자 0. 아래 helper 들은 DB 왕복이 없는
// in-memory 행 유틸리티만 남긴다(런타임 스키마 프로빙 아님).

/** 이미 조회된 행에서 표시용 문자열 필드를 고른다(in-memory — DB 왕복·오류 변환 없음). */
export function getStringField(row: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = row[k];
    if (typeof v === "string" && v.trim()) return v;
  }
  return null;
}

function isSupabaseRow(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !("error" in value && (value as { error?: unknown }).error === true);
}

/** Supabase `.select()` 결과 배열을 안전하게 Record 행 배열로 정규화 */
export function rowsFromSupabaseData(data: unknown): Record<string, unknown>[] {
  if (!Array.isArray(data)) return [];
  return data.filter(isSupabaseRow);
}
