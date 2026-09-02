/**
 * 관리자 상태 배지 — 상태 사전(`lib/admin/adminStatusDictionary.ts`)을 조회해 DS `StatusBadge` 로 그린다.
 *
 * 이름이 `AdminStatusBadge` 가 아닌 이유: `components/admin/AdminStatusBadge.tsx` 는 이미 "최근 50건" 류의
 * 목록 표본 힌트 칩으로 3화면(settlements·reviews·refunds)이 쓰고 있어(분석 §2-3) 그대로 두고,
 * 후속 PR 에서 `AdminListSampleHint` 로 개명한다. 지시서 §3 의 `AdminStatusBadge` 계약(table·column·value)은 이 컴포넌트가 구현한다.
 *
 * 사전에 없는 값이 오면 throw 하지 않고 neutral 톤으로 원시 값을 표시한다 — 운영 화면이 깨지면 안 된다.
 * Server/Client 어디서든 사용 가능(상태 없음). (PR-1: 신설만 — 아직 어떤 화면도 쓰지 않는다.)
 */
import { StatusBadge } from "@/components/design-system/StatusBadge";
import { resolveAdminStatus } from "@/lib/admin/adminStatusDictionary";

export type AdminStatusPillProps = {
  /** 사전 키의 테이블(예: "refunds") */
  table: string;
  /** 사전 키의 컬럼(예: "status") */
  column: string;
  /** enum 값 — null/undefined/미등재 값도 안전 */
  value: unknown;
  size?: "sm" | "md";
  className?: string;
};

export function AdminStatusPill({ table, column, value, size = "sm", className }: AdminStatusPillProps) {
  const resolved = resolveAdminStatus(table, column, value);
  return <StatusBadge label={resolved.label} tone={resolved.tone} size={size} className={className} />;
}
