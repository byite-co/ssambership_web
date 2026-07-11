import Link from "next/link";
import { Megaphone, UserSearch } from "lucide-react";
import "@/app/(public)/custom-request/landing.css";
import { DirectMentorPickBoard } from "@/components/individualQuestion/DirectMentorPickBoard";
import { StudentSentIndividualQuestionsSection } from "@/components/individualQuestion/StudentSentIndividualQuestionsSection";
import { getServerUserWithProfile } from "@/lib/auth/getServerUserWithProfile";
import { loadDirectMentorBoard } from "@/lib/individualQuestion/directMentorBoard";
import { fetchStudentIndividualQuestions } from "@/lib/individualQuestion/individualQuestionQueries";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function StudentIndividualQuestionsPage() {
  // 비로그인도 목록 화면을 볼 수 있다. 실제 작성/제출은 /individual-questions/new 가드로 로그인 유도.
  const { user, profile } = await getServerUserWithProfile();
  const isStudent = Boolean(user) && (profile == null || profile.role === "student");
  const supabase = await createClient();

  let rows: Awaited<ReturnType<typeof fetchStudentIndividualQuestions>>["rows"] = [];
  let error: string | null = null;
  if (user && isStudent) {
    const result = await fetchStudentIndividualQuestions(supabase, user.id);
    rows = result.rows;
    error = result.error;
  }

  // 지정 질문 멘토 게시판 — 멘토 찾기와 동일한 공개 디렉터리 쿼리 재사용(비로그인도 열람 가능, 단가는 로그인 시 표시).
  const board = await loadDirectMentorBoard(supabase, { pricesVisible: Boolean(user && isStudent) });

  return (
    <div className="cr-landing cr-detail-v5 cr-detail-shell mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 lg:px-8">
      <article className="cr-detail-card">
        <header className="cr-detail-header">
          <span className="eyebrow">개별 질문</span>
          <div className="cr-detail-header-row">
            <h1 className="cr-detail-title">내 개별 질문</h1>
          </div>
          <p className="cr-detail-subtitle">
            <span className="md:hidden">지정형·공개형 단건 질문과 답변을 확인하세요.</span>
            <span className="hidden md:inline">캐시로 안전 결제한 지정형·공개형 단건 질문과 답변 상태를 확인합니다.</span>
          </p>
        </header>

        <p className="hidden rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm font-semibold text-blue-900 md:block md:mb-4">
          개별 질문은 <strong>구독 질문방과 별개</strong>로, 건마다 캐시를 안전 결제해 진행하는 단건 질문이에요. 구독 멘토와의 대화는 <Link href="/question-room" className="font-extrabold underline">질문방</Link>에서 이어집니다.
        </p>

        {/* 작성 진입: 공개형·지정형 모두 이 탭 안에서 바로 진행 */}
        <section className="mb-6 grid items-stretch gap-3 md:grid-cols-2">
          {/* 공개형 — 주 경로(파랑 강조 보더) */}
          <div className="flex h-full flex-col rounded-xl border-2 border-[#2563EB] bg-white px-[1.2rem] py-[1.1rem]">
            <div className="flex items-start justify-between gap-2">
              <span className="flex h-10 w-10 items-center justify-center rounded-[10px] bg-blue-50 text-[#2563EB]">
                <Megaphone className="h-5 w-5" aria-hidden />
              </span>
              <span className="rounded-full bg-blue-50 px-2.5 py-1 text-[11px] font-extrabold text-[#2563EB]">
                여기서 바로 가능
              </span>
            </div>
            <p className="mt-3 text-xs font-extrabold text-[#2563EB]">공개형</p>
            <h2 className="mt-1 text-base font-medium text-slate-900">멘토 지정 없이 질문하기</h2>
            <p className="mt-1 flex-grow text-[13px] leading-6 text-slate-600">
              <span className="md:hidden">공개로 올리면 먼저 잡은 멘토가 답변해요.</span>
              <span className="hidden md:inline">가격을 제시해 공개로 올리면, 먼저 잡은 멘토 1명이 답변해요.</span>
            </p>
            <Link
              href="/individual-questions/new"
              className="mt-4 inline-flex w-full items-center justify-center rounded-xl bg-[#2563EB] px-5 py-2.5 text-sm font-extrabold text-white shadow-sm hover:bg-[#1D4ED8]"
            >
              공개형 질문하기
            </Link>
          </div>
          {/* 지정형 — 아래 멘토 게시판에서 탭 이탈 없이 바로 */}
          <div className="flex h-full flex-col rounded-xl border-[0.5px] border-slate-200 bg-white px-[1.2rem] py-[1.1rem]">
            <div className="flex items-start justify-between gap-2">
              <span className="flex h-10 w-10 items-center justify-center rounded-[10px] bg-slate-100 text-slate-500">
                <UserSearch className="h-5 w-5" aria-hidden />
              </span>
              <span className="rounded-full bg-blue-50 px-2.5 py-1 text-[11px] font-extrabold text-[#2563EB]">
                여기서 바로 가능
              </span>
            </div>
            <p className="mt-3 text-xs font-extrabold text-slate-500">지정형</p>
            <h2 className="mt-1 text-base font-medium text-slate-900">특정 멘토에게 묻기</h2>
            <p className="mt-1 flex-grow text-[13px] leading-6 text-slate-600">
              아래 멘토 게시판에서 원하는 멘토를 골라 1:1로 바로 질문하세요.
            </p>
            <a
              href="#direct-mentor-board"
              className="mt-4 inline-flex w-full items-center justify-center gap-1 rounded-xl border-[1.5px] border-[#2563EB] bg-transparent px-5 py-2.5 text-sm font-extrabold text-[#2563EB] hover:bg-blue-50"
            >
              멘토 지정하고 질문하기 <span aria-hidden>↓</span>
            </a>
          </div>
        </section>

        {error ? (
          <p className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-900">
            개별 질문 목록을 불러오지 못했습니다. {error}
          </p>
        ) : null}

        {user ? (
          <StudentSentIndividualQuestionsSection
            rows={rows}
            emptyTitle="아직 개별 질문이 없습니다"
            emptyDescription="공개 질문을 등록하거나 아래 멘토 게시판에서 지정 질문을 보낼 수 있어요."
            detailBaseHref="/individual-questions"
          />
        ) : (
          <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
            <p className="text-base font-black text-slate-900">로그인하면 내 개별 질문이 보여요</p>
            <p className="mt-2 text-sm text-slate-500">학생 계정으로 로그인하면 보낸 질문과 답변 상태를 확인할 수 있어요.</p>
            <Link
              href="/login/student?next=/individual-questions"
              className="mt-4 inline-flex items-center justify-center rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-extrabold text-white shadow-sm hover:bg-blue-700"
            >
              학생 로그인
            </Link>
          </div>
        )}

        <hr className="cr-detail-divider" />

        {/* 지정 질문 멘토 게시판 — 멘토 화면의 공개 질문 게시판과 대칭(탭 이탈 없이 멘토 지정 → 질문 전송) */}
        <section id="direct-mentor-board" className="scroll-mt-24">
          <div className="rounded-2xl border border-blue-200 bg-blue-50/40 p-4 sm:p-6">
            <DirectMentorPickBoard cards={board.cards} pricesVisible={board.pricesVisible} error={board.error} />
          </div>
        </section>
      </article>
    </div>
  );
}
