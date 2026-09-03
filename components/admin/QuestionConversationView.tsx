/**
 * 질문 상세 — 대화 전문(§4). **구독질문(`question_threads`)과 개별질문(`individual_questions`)을 하나의 컴포넌트**로 그린다. 상단 경로와 요약만 다르다. Server Component.
 *
 * - 좌: 메시지 시간순(작성자 = `author_id` ↔ `users` 실명/닉네임 + 역할 라벨) · 메시지에 연결된 첨부는 말풍선 안, 단독 첨부는 시간순 독립 항목 ·
 *   구독질문이면 방의 **필기 주석**(`scan_annotations` — 방 단위라 첨부 위에 겹칠 수 없어 별도 이미지 블록) · 학생 확인 줄.
 * - 우: 요약(학생·멘토·과목·상태·오답노트/숙달) · 품질 지표(첫 답변 · 답변 길이 · 왕복 · 확인까지) · 개별질문이면 가격·안전결제·지정/공개·자격 조건.
 * - 조치 버튼 없음(읽기 전용). 열람 기록은 페이지가 남긴다.
 */
import Link from "next/link";
import type { ReactNode } from "react";
import { AdminStatusPill } from "@/components/admin/AdminStatusPill";
import { QuestionAttachmentGallery, type QuestionGalleryItem } from "@/components/admin/QuestionAttachmentGallery";
import { StatusBadge } from "@/components/design-system/StatusBadge";
import { accountDetailPath } from "@/lib/admin/accountDetailConsole";
import type { DocumentViewerSource } from "@/lib/admin/documentViewerModel";
import {
  EMPTY_CONVERSATION,
  ESCROW_STATE_LABELS,
  PARTY_ROLE_LABELS,
  formatAnswerLength,
  formatDurationKo,
  formatIndividualPriceKrw,
  individualTypeLabel,
  sortByCreatedAt,
  threadBadges,
  type PartyRole,
} from "@/lib/admin/questionDrilldownConsole";
import type { QuestionAttachmentView, QuestionConversation } from "@/lib/admin/questionDrilldownQueries";
import { formatKoDateTimeKst } from "@/lib/utils/kstTime";
import { cn } from "@/lib/utils/cn";

type Props = {
  conversation: QuestionConversation;
  refreshSource: (storedRef: string) => Promise<DocumentViewerSource>;
};

const ROLE_STYLE: Record<PartyRole, { badge: "success" | "info" | "warning" | "neutral"; border: string }> = {
  mentor: { badge: "success", border: "border-emerald-200 bg-emerald-50/40" },
  student: { badge: "info", border: "border-blue-200 bg-blue-50/40" },
  admin: { badge: "warning", border: "border-amber-200 bg-amber-50/40" },
  unknown: { badge: "neutral", border: "border-slate-200 bg-slate-50" },
};

function toGalleryItem(a: QuestionAttachmentView, caption: string | null): QuestionGalleryItem {
  return { id: a.id, label: a.fileName, caption, isImage: a.isImage, source: a.source };
}

function Row(props: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-slate-100 py-1.5 text-xs last:border-b-0">
      <dt className="shrink-0 font-bold text-slate-500">{props.label}</dt>
      <dd className="min-w-0 text-right font-semibold text-slate-900">{props.children}</dd>
    </div>
  );
}

type TimelineItem = { key: string; createdAt: string | null; node: ReactNode };

export function QuestionConversationView({ conversation, refreshSource }: Props) {
  const c = conversation;
  const messageIds = new Set(c.messages.map((m) => m.id));
  const linked = new Map<string, QuestionAttachmentView[]>();
  const standalone: QuestionAttachmentView[] = [];
  for (const a of c.attachments) {
    if (a.messageId && messageIds.has(a.messageId)) linked.set(a.messageId, [...(linked.get(a.messageId) ?? []), a]);
    else standalone.push(a);
  }

  const items: TimelineItem[] = [
    ...c.messages.map((m): TimelineItem => {
      const style = ROLE_STYLE[m.authorRole];
      const own = linked.get(m.id) ?? [];
      return {
        key: `m-${m.id}`,
        createdAt: m.createdAt,
        node: (
          <article className={cn("rounded-2xl border px-4 py-3", style.border)} data-message-id={m.id} data-author-role={m.authorRole}>
            <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs">
              <span className="flex items-center gap-1.5">
                {m.authorId ? (
                  <Link href={accountDetailPath(m.authorId)} className="font-extrabold text-slate-900 hover:underline" prefetch={false}>
                    {m.authorName}
                  </Link>
                ) : (
                  <span className="font-extrabold text-slate-900">{m.authorName}</span>
                )}
                <StatusBadge label={PARTY_ROLE_LABELS[m.authorRole]} tone={style.badge} size="sm" />
              </span>
              <time className="tabular-nums text-slate-500" dateTime={m.createdAt ?? undefined}>
                {formatKoDateTimeKst(m.createdAt)}
              </time>
            </header>
            <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-slate-800">{m.body || <span className="text-slate-400">(본문 없음)</span>}</p>
            {own.length ? <QuestionAttachmentGallery className="mt-2" items={own.map((a) => toGalleryItem(a, null))} refreshSource={refreshSource} /> : null}
          </article>
        ),
      };
    }),
    ...standalone.map(
      (a): TimelineItem => ({
        key: `a-${a.id}`,
        createdAt: a.createdAt,
        node: (
          <article className="rounded-2xl border border-slate-200 bg-white px-4 py-3" data-standalone-attachment={a.id}>
            <header className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <span className="font-extrabold text-slate-700">첨부</span>
              <time className="tabular-nums text-slate-500" dateTime={a.createdAt ?? undefined}>
                {formatKoDateTimeKst(a.createdAt)}
              </time>
            </header>
            <QuestionAttachmentGallery className="mt-2" items={[toGalleryItem(a, null)]} refreshSource={refreshSource} />
          </article>
        ),
      })
    ),
  ];
  const timeline = sortByCreatedAt(items);
  const badges = c.thread ? threadBadges({ is_wrong_answer: c.thread.isWrongAnswer, mastery_status: c.thread.masteryStatus }) : [];
  const statusTable = c.kind === "thread" ? "question_threads" : "individual_questions";
  const kindLabel = c.kind === "thread" ? "구독 질문" : `개별질문 · ${individualTypeLabel(c.individual?.questionType)}`;
  const annotationItems: QuestionGalleryItem[] = c.annotations.map((an) => ({
    id: `an-${an.id}`,
    label: an.annotated ? "필기 주석" : "스캔 원본",
    caption: `${PARTY_ROLE_LABELS[an.authorRole]} · ${an.authorName} · ${formatKoDateTimeKst(an.createdAt)}`,
    isImage: true,
    source: an.source,
  }));

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]" data-question-conversation={c.id} data-question-kind={c.kind}>
      <section className="space-y-3" aria-label="대화 전문">
        <p className="text-xs font-semibold text-slate-600" data-question-path>
          {kindLabel}
          {c.subjectLabel ? ` · ${c.subjectLabel}` : ""}
          {c.topic ? ` · ${c.topic}` : ""}
          {` · ${formatKoDateTimeKst(c.createdAt)}`}
        </p>
        {timeline.length ? (
          <ol className="space-y-3" data-message-count={c.messages.length}>
            {timeline.map((it) => (
              <li key={it.key}>{it.node}</li>
            ))}
          </ol>
        ) : (
          <p className="rounded-2xl border border-dashed border-slate-200 bg-white px-5 py-8 text-center text-sm font-bold text-slate-600">{EMPTY_CONVERSATION}</p>
        )}
        {c.thread?.confirmedAt ? (
          <p className="border-t border-slate-200 pt-3 text-xs font-bold text-emerald-800" data-confirmed-at={c.thread.confirmedAt}>
            학생이 확인함 · {formatKoDateTimeKst(c.thread.confirmedAt)}
          </p>
        ) : null}
        {c.kind === "thread" ? (
          <section className="rounded-2xl border border-slate-200 bg-white p-4" aria-label="필기 주석" data-scan-annotations={c.annotations.length}>
            <h3 className="text-xs font-black text-slate-700">
              필기 주석 <span className="tabular-nums text-slate-500">{c.annotations.length}건</span>
            </h3>
            <p className="mt-0.5 text-[11px] text-slate-500">스캔 첨삭(scan_annotations)은 방 단위 기록이라 특정 질문·첨부에 묶이지 않습니다 — 이 방의 주석을 시간순으로 보입니다.</p>
            {annotationItems.length ? (
              <QuestionAttachmentGallery className="mt-3" items={annotationItems} refreshSource={refreshSource} size="md" />
            ) : (
              <p className="mt-2 text-xs text-slate-500">이 방에는 필기 주석이 없습니다.</p>
            )}
          </section>
        ) : null}
      </section>

      <aside className="space-y-3" aria-label="요약">
        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm" data-question-summary>
          <h3 className="text-xs font-black text-slate-700">요약</h3>
          <dl className="mt-2">
            <Row label="학생">
              {c.party.studentId ? (
                <Link href={accountDetailPath(c.party.studentId)} className="text-blue-700 hover:underline" prefetch={false} data-party="student">
                  {c.party.studentName}
                </Link>
              ) : (
                c.party.studentName
              )}
            </Row>
            <Row label="멘토">
              {c.party.mentorId && c.party.mentorName ? (
                <Link href={accountDetailPath(c.party.mentorId)} className="text-blue-700 hover:underline" prefetch={false} data-party="mentor">
                  {c.party.mentorName}
                </Link>
              ) : (
                <span className="text-slate-400">{c.kind === "individual" ? "아직 배정 전" : "—"}</span>
              )}
            </Row>
            <Row label="과목">{c.subjectLabel ?? "—"}</Row>
            <Row label="상태">
              <AdminStatusPill table={statusTable} column="status" value={c.status} size="sm" />
            </Row>
            {badges.length ? (
              <Row label="표시">
                <span className="inline-flex flex-wrap justify-end gap-1">
                  {badges.map((b) => (
                    <StatusBadge key={b.label} label={b.label} tone={b.tone} size="sm" />
                  ))}
                </span>
              </Row>
            ) : null}
            {c.thread?.viewCount != null ? <Row label="조회 수">{c.thread.viewCount}</Row> : null}
          </dl>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm" data-question-metrics>
          <h3 className="text-xs font-black text-slate-700">품질 지표</h3>
          <dl className="mt-2">
            <Row label="첫 답변">{formatDurationKo(c.metrics.firstAnswerMs)}</Row>
            <Row label="답변 길이">{formatAnswerLength(c.metrics.answerLength)}</Row>
            <Row label="왕복">{c.metrics.roundTrips}회</Row>
            <Row label="확인까지">{c.kind === "thread" ? formatDurationKo(c.metrics.confirmMs) : "—"}</Row>
          </dl>
        </section>

        {c.individual ? (
          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm" data-individual-summary>
            <h3 className="text-xs font-black text-slate-700">개별질문</h3>
            <dl className="mt-2">
              <Row label="가격">{formatIndividualPriceKrw(c.individual.priceCents)}</Row>
              <Row label="안전결제">{ESCROW_STATE_LABELS[c.individual.escrow]}</Row>
              <Row label="유형">{individualTypeLabel(c.individual.questionType)}</Row>
              <Row label="자격 조건">{c.individual.requirementLabel}</Row>
              <Row label="마감">{c.individual.expiresAt ? formatKoDateTimeKst(c.individual.expiresAt) : "—"}</Row>
              <Row label="답변 시각">{c.individual.answeredAt ? formatKoDateTimeKst(c.individual.answeredAt) : "—"}</Row>
              {c.individual.releasedAt ? <Row label="지급 시각">{formatKoDateTimeKst(c.individual.releasedAt)}</Row> : null}
              {c.individual.refundedAt ? <Row label="환불 시각">{formatKoDateTimeKst(c.individual.refundedAt)}</Row> : null}
            </dl>
          </section>
        ) : null}
        <p className="text-[11px] text-slate-400">읽기 전용 화면입니다. 신고 접수·멘토 안내는 후속 PR.</p>
      </aside>
    </div>
  );
}
