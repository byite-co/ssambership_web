"use client";

/** 목록 행 배지 — 다른 관리자가 이 지원자를 열고 있으면 `박운영 심사 중`(PR-2b §2-2). 없으면 아무것도 그리지 않는다. */
import { useMentorApprovalPresence } from "@/components/admin/MentorApprovalPresenceProvider";
import { StatusBadge } from "@/components/design-system/StatusBadge";
import { presenceListBadgeLabel, viewersOfMentor } from "@/lib/admin/mentorApprovalPresence";

export function MentorApprovalPresenceBadge({ mentorId }: { mentorId: string }) {
  const { viewers } = useMentorApprovalPresence();
  const label = presenceListBadgeLabel(viewersOfMentor(viewers, mentorId));
  if (!label) return null;
  return <StatusBadge label={label} tone="info" size="sm" className="shrink-0" />;
}
