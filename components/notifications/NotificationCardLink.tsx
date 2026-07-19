"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { markNotificationReadByIdAction } from "@/lib/notifications/notificationReadActions";

/**
 * P2-26: 알림 클릭 시 client wrapper 에서 **읽음 처리(멱등) 후 이동**한다.
 * - 서버 <Link> 만으로 읽음을 기대하지 않는다(클릭=읽음+이동).
 * - 읽음 API(markNotificationReadByIdAction)는 멱등. 중복 클릭은 navigating 플래그로 차단.
 * - 이동 경로는 내부 경로만 허용(외부/protocol-relative 차단). href 자체도 resolveNotificationHref 가
 *   이미 내부 경로만 반환하지만 방어적으로 재확인한다.
 * - 읽음 실패 시에도 이동은 진행(사용자 흐름 우선)하고 오류는 구조화 로그로 남긴다.
 */
export function NotificationCardLink(props: {
  href: string;
  notificationId: string;
  unread: boolean;
  className?: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const [navigating, setNavigating] = useState(false);

  const safeHref =
    typeof props.href === "string" && props.href.startsWith("/") && !props.href.startsWith("//")
      ? props.href
      : "/";

  const handleClick = async (e: React.MouseEvent<HTMLAnchorElement>) => {
    // 새 탭/수정키 클릭은 기본 동작(브라우저) 유지.
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    if (navigating) return; // 중복 클릭 방지
    setNavigating(true);
    try {
      if (props.unread && props.notificationId) {
        const r = await markNotificationReadByIdAction(props.notificationId);
        if (!r.ok) {
          console.error("[notification] 읽음 처리 실패(이동은 진행)", { id: props.notificationId });
        }
      }
    } catch (err) {
      console.error("[notification] 읽음 처리 예외(이동은 진행)", err);
    }
    router.push(safeHref);
  };

  return (
    <a href={safeHref} onClick={handleClick} className={props.className} aria-busy={navigating || undefined}>
      {props.children}
    </a>
  );
}
