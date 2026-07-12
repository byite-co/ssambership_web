// 클라이언트/서버 공용(순수). node 전용 import 금지.
//
// 질문방 첨부 v2 계약(§2, XV-ATTACH 수정안 기획서):
//  - 첨부의 유일한 정본은 question_attachments 행 — 본문 마커([[img]]/[[file]]) 폐지.
//  - 서명 URL은 표시 시점 발급(서버 로더가 1h TTL로 채움) — 어디에도 영속 저장 금지.
//  - 렌더 병합: message_id 연결(linked)은 해당 말풍선 내부, 단독(standalone)은 created_at 시간순 독립 행.

/** 표시용 첨부 뷰 모델(서버 로더가 서명 URL까지 채워 내려줌). */
export type ThreadAttachmentView = {
  id: string;
  threadId: string;
  messageId: string | null;
  /** 발신자(신규 데이터부터 기록). null = 레거시 → 중립(중앙) 카드. */
  authorId: string | null;
  /** 렌더 시점 발급된 단기(1h) 서명 URL. 발급 실패 시 null → 파일명 칩만 표시. */
  url: string | null;
  isImage: boolean;
  fileName: string;
  createdAt: string;
};

/** 목록 미리보기용 경량 정보(서명 URL 불필요). */
export type AttachmentPreviewInfo = {
  isImage: boolean;
  fileName: string;
  createdAt: string;
};

export function isImageMime(mime: string | null | undefined): boolean {
  return typeof mime === "string" && mime.toLowerCase().startsWith("image/");
}

/** 계약 §2-7: 마지막 활동이 첨부일 때의 목록/미리보기 라벨(웹·앱 동일 문구). */
export function attachmentPreviewLabel(a: { isImage: boolean; fileName: string }): string {
  return a.isImage ? "📷 사진" : `📎 ${a.fileName || "파일"}`;
}

export type SplitThreadAttachments = {
  linkedByMessageId: Record<string, ThreadAttachmentView[]>;
  standalone: ThreadAttachmentView[];
};

/**
 * 계약 §2-4: 메시지 id 집합과 대조해 linked/standalone 으로 분리.
 * message_id 가 있어도 현재 메시지 목록에 없으면(다른 스레드 등 방어) standalone 취급.
 */
export function splitThreadAttachments(
  attachments: readonly ThreadAttachmentView[],
  messageIds: ReadonlySet<string>
): SplitThreadAttachments {
  const linkedByMessageId: Record<string, ThreadAttachmentView[]> = {};
  const standalone: ThreadAttachmentView[] = [];
  for (const a of attachments) {
    if (a.messageId && messageIds.has(a.messageId)) {
      (linkedByMessageId[a.messageId] ??= []).push(a);
    } else {
      standalone.push(a);
    }
  }
  return { linkedByMessageId, standalone };
}

/** 시간순 타임라인 병합용 항목(메시지 or 단독 첨부). */
export type ChatTimelineItem =
  | { kind: "message"; key: string; time: number; message: Record<string, unknown> }
  | { kind: "attachment"; key: string; time: number; attachment: ThreadAttachmentView };

function toEpoch(v: unknown): number {
  if (typeof v === "string" || typeof v === "number") {
    const t = new Date(v).getTime();
    if (Number.isFinite(t)) return t;
  }
  return 0;
}

/** 메시지 + standalone 첨부를 created_at 기준으로 병합(계약 §2-4). 안정 정렬. */
export function buildChatTimeline(
  messages: readonly Record<string, unknown>[],
  standalone: readonly ThreadAttachmentView[]
): ChatTimelineItem[] {
  const items: ChatTimelineItem[] = [];
  for (const m of messages) {
    items.push({
      kind: "message",
      key: `m-${String(m.id ?? "")}`,
      time: toEpoch(m.created_at),
      message: m,
    });
  }
  for (const a of standalone) {
    items.push({ kind: "attachment", key: `a-${a.id}`, time: toEpoch(a.createdAt), attachment: a });
  }
  return items
    .map((it, idx) => ({ it, idx }))
    .sort((x, y) => (x.it.time - y.it.time) || (x.idx - y.idx))
    .map((w) => w.it);
}
