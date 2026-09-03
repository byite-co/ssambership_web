"use client";

/**
 * 상세 상단 안내 — `박운영님이 3분 전부터 보고 있습니다`(PR-2b §2-2). 결정은 잠기지 않는다는 말을 같이 둔다.
 * Presence 채널을 못 쓰는 환경에서는 작은 회색 문구로만 알린다(기능만 빠지고 심사는 그대로).
 */
import { useEffect, useState } from "react";
import { useMentorApprovalPresence } from "@/components/admin/MentorApprovalPresenceProvider";
import { PRESENCE_UNAVAILABLE_MESSAGE, presenceDetailNotice, viewersOfMentor } from "@/lib/admin/mentorApprovalPresence";

const TICK_MS = 30_000;

export function MentorApprovalPresenceNotice({ mentorId }: { mentorId: string }) {
  const { viewers, status } = useMentorApprovalPresence();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), TICK_MS);
    return () => window.clearInterval(t);
  }, []);

  if (status === "unavailable") {
    return (
      <p className="mt-2 text-[11px] text-slate-400" data-presence-unavailable>
        {PRESENCE_UNAVAILABLE_MESSAGE}
      </p>
    );
  }
  const notice = presenceDetailNotice(viewersOfMentor(viewers, mentorId), now);
  if (!notice) return null;
  return (
    <p role="status" data-presence-notice className="mt-2 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-xs font-bold text-sky-900">
      {notice} · 결정 버튼은 잠기지 않습니다.
    </p>
  );
}
