"use client";

/**
 * 멘토 승인 작업대 — 동시 심사 표시(PR-2b §2). Supabase Realtime **Presence** 채널 `admin:mentor-approval` 하나. DB 쓰기 0.
 *
 * - 이 관리자가 지금 보고 있는 지원자(`selectedMentorId`)를 `{ adminId, adminName, mentorId, since }` 로 track 한다.
 *   지원자가 바뀌면 같은 presence 키(adminId)로 다시 track(교체) · 선택이 없으면 untrack · 창을 닫으면 Presence 가 지운다.
 * - 다른 관리자들의 상태는 `sync` 이벤트마다 `presenceState()` 를 평탄화해 컨텍스트로 내려준다(목록 배지 · 상세 안내 · 확인 모달 한 줄).
 * - 채널 구독이 실패하면(`CHANNEL_ERROR`·`TIMED_OUT` — Realtime 비활성·private 전용 설정 등) 조용히 `unavailable` 로 내려간다.
 * - **잠금은 없다.** 이 컨텍스트는 표시 전용이며 결정 버튼의 활성 여부에 관여하지 않는다(담당자가 자리를 비워도 처리할 수 있어야 한다).
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import {
  MENTOR_APPROVAL_PRESENCE_CHANNEL,
  PRESENCE_CONFIRM_DETAIL_LABEL,
  buildPresencePayload,
  flattenPresenceState,
  presenceConfirmLine,
  viewersOfMentor,
  type MentorApprovalPresenceViewer,
} from "@/lib/admin/mentorApprovalPresence";

export type MentorApprovalPresenceStatus = "connecting" | "ready" | "unavailable";

type PresenceContextValue = {
  viewers: MentorApprovalPresenceViewer[];
  status: MentorApprovalPresenceStatus;
};

const PresenceContext = createContext<PresenceContextValue>({ viewers: [], status: "connecting" });

export function useMentorApprovalPresence(): PresenceContextValue {
  return useContext(PresenceContext);
}

/** 확인 모달의 `동시 심사 · 박운영님도 이 지원자를 보고 있습니다` 행. 아무도 없으면 undefined(행 없음). */
export function usePresenceConfirmDetails(mentorId: string | null | undefined): { label: string; value: string }[] | undefined {
  const { viewers } = useMentorApprovalPresence();
  return useMemo(() => {
    const line = presenceConfirmLine(viewersOfMentor(viewers, mentorId));
    return line ? [{ label: PRESENCE_CONFIRM_DETAIL_LABEL, value: line }] : undefined;
  }, [viewers, mentorId]);
}

type Props = {
  adminId: string;
  adminName: string;
  /** 지금 열어 둔 지원자 — null 이면 아무도 보고 있지 않다고 알린다(untrack) */
  selectedMentorId: string | null;
  children: ReactNode;
};

export function MentorApprovalPresenceProvider({ adminId, adminName, selectedMentorId, children }: Props) {
  const [viewers, setViewers] = useState<MentorApprovalPresenceViewer[]>([]);
  const [status, setStatus] = useState<MentorApprovalPresenceStatus>("connecting");
  const channelRef = useRef<RealtimeChannel | null>(null);
  const subscribedRef = useRef(false);
  // 같은 지원자를 계속 보는 동안 since 를 유지한다 — 재track 에도 "3분 전부터" 가 초기화되지 않게.
  const sinceRef = useRef<{ mentorId: string; since: string } | null>(null);

  const trackSelection = useCallback(async () => {
    const channel = channelRef.current;
    if (!channel || !subscribedRef.current) return;
    const mentorId = selectedMentorId?.trim() ?? "";
    if (!mentorId) {
      sinceRef.current = null;
      await channel.untrack();
      return;
    }
    if (!sinceRef.current || sinceRef.current.mentorId !== mentorId) {
      sinceRef.current = { mentorId, since: new Date().toISOString() };
    }
    await channel.track(buildPresencePayload({ adminId, adminName, mentorId, since: sinceRef.current.since }));
  }, [adminId, adminName, selectedMentorId]);

  const trackRef = useRef(trackSelection);
  useEffect(() => {
    trackRef.current = trackSelection;
  }, [trackSelection]);

  useEffect(() => {
    if (!adminId) return;
    const supabase = createClient();
    const channel = supabase.channel(MENTOR_APPROVAL_PRESENCE_CHANNEL, { config: { presence: { key: adminId } } });
    channelRef.current = channel;
    channel.on("presence", { event: "sync" }, () => {
      setViewers(flattenPresenceState(channel.presenceState(), adminId));
    });
    channel.subscribe((state) => {
      const s = String(state);
      if (s === "SUBSCRIBED") {
        subscribedRef.current = true;
        setStatus("ready");
        void trackRef.current();
      } else if (s === "CHANNEL_ERROR" || s === "TIMED_OUT") {
        subscribedRef.current = false;
        setStatus("unavailable");
      } else if (s === "CLOSED") {
        subscribedRef.current = false;
      }
    });
    return () => {
      subscribedRef.current = false;
      channelRef.current = null;
      setViewers([]);
      void supabase.removeChannel(channel);
    };
  }, [adminId]);

  useEffect(() => {
    void trackSelection();
  }, [trackSelection]);

  const value = useMemo(() => ({ viewers, status }), [viewers, status]);
  return <PresenceContext.Provider value={value}>{children}</PresenceContext.Provider>;
}
