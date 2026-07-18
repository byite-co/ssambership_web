import Link from "next/link";
import Image from "next/image";
import type { MentorProfileDisplay } from "@/lib/mentor/mentorDisplayFields";
import { mentorSubjectChips } from "@/lib/mentor/mentorPublicProfileDisplay";

export function MentorSubscribeSummaryCard(props: {
  mentorId: string;
  display: MentorProfileDisplay;
}) {
  const { mentorId, display: d } = props;
  // 과목 정본 칩 헬퍼 사용 — 저장된 과목 코드(korean_reading 등)를 한글 라벨로 변환
  const tags = mentorSubjectChips(d.subjects, 6);
  const schoolLine = [d.university, d.department].filter(Boolean).join(" · ");

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-xs font-bold uppercase tracking-wide text-slate-400">선택한 멘토</p>
      <div className="mt-3 flex gap-3">
        {d.photoUrl ? (
          <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-xl border border-slate-100 bg-slate-50">
            <Image src={d.photoUrl} alt="" fill className="object-cover" sizes="64px" unoptimized />
          </div>
        ) : (
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl border border-blue-100 bg-blue-50 text-xl font-black text-blue-600">
            {d.displayName.charAt(0)}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-black text-slate-900">{d.displayName}</h2>
          {schoolLine ? <p className="mt-0.5 text-sm font-medium text-slate-600">{schoolLine}</p> : null}
        </div>
      </div>
      {tags.length > 0 ? (
        <ul className="mt-3 flex flex-wrap gap-1.5">
          {tags.map((tag) => (
            <li
              key={tag}
              className="rounded-lg border border-slate-100 bg-slate-50 px-2 py-0.5 text-xs font-semibold text-slate-700"
            >
              {tag}
            </li>
          ))}
        </ul>
      ) : null}
      <Link
        href={`/mentors/${encodeURIComponent(mentorId)}`}
        className="mt-4 inline-block text-xs font-bold text-blue-600 hover:underline"
      >
        프로필 보기 &rarr;
      </Link>
    </section>
  );
}
