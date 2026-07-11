import Link from "next/link";
import { FormSubmitButton } from "@/components/common/FormSubmitButton";
import { SubjectSelectOptions } from "@/components/subjects/SubjectSelectOptions";
import { CommunityFileDropzone } from "@/components/community/CommunityFileDropzone";
import { createDirectIndividualQuestionAction } from "@/lib/individualQuestion/individualQuestionActions";
import { formatIndividualQuestionPrice } from "@/lib/individualQuestion/individualQuestionFormat";

/**
 * 지정형 개별 질문 작성 섹션(요약 dl + 폼) — 서버 컴포넌트.
 * /mentors/[mentorId]/individual-question/new(멘토 프로필 경로)와
 * /individual-questions/direct/[mentorId](개별 질문 탭 경로)가 같은 마크업을 공유한다.
 * origin="iq-tab"이면 서버 액션이 오류 시 탭 내 경로로 돌려보낸다(성공 시 이동은 동일).
 */
export function DirectIndividualQuestionFormSection(props: {
  mentorId: string;
  displayName: string;
  isApproved: boolean;
  amountCents: number | null;
  error: string | null;
  idempotencyKey: string;
  origin?: "iq-tab";
  cancelHref: string;
  fallbackHref: string;
  fallbackLabel: string;
}) {
  const canSubmit = props.isApproved && props.amountCents != null;

  return (
    <>
      {props.error ? (
        <p className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-900">
          {props.error}
        </p>
      ) : null}

      <dl className="grid gap-3 rounded-2xl bg-[#eef4ff] p-4 sm:grid-cols-3">
        <div>
          <dt className="text-xs font-extrabold text-blue-700">담당 멘토</dt>
          <dd className="mt-1 text-sm font-black text-slate-900">{props.displayName}</dd>
        </div>
        <div>
          <dt className="text-xs font-extrabold text-blue-700">개별 질문 단가</dt>
          <dd className="mt-1 text-sm font-black text-slate-900">
            {props.amountCents ? formatIndividualQuestionPrice(props.amountCents) : "미설정"}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-extrabold text-blue-700">진행 방식</dt>
          <dd className="mt-1 text-sm font-black text-slate-900">등록 시 안전 결제 · 답변 완료 시 지급</dd>
        </div>
      </dl>

      {!canSubmit ? (
        <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-5">
          <p className="text-sm font-extrabold text-amber-900">
            {props.isApproved
              ? "이 멘토는 지금 지정 질문을 받지 않아요. 다른 멘토를 지정하거나 공개형으로 질문해 보세요."
              : "승인 완료된 멘토에게만 개별 질문을 보낼 수 있어요."}
          </p>
          <Link
            href={props.fallbackHref}
            className="mt-4 inline-flex rounded-xl border border-amber-200 bg-white px-4 py-2 text-sm font-extrabold text-amber-800"
          >
            {props.fallbackLabel}
          </Link>
        </div>
      ) : (
        <form action={createDirectIndividualQuestionAction} className="mt-6 space-y-5">
          <input type="hidden" name="mentorId" value={props.mentorId} />
          <input type="hidden" name="idempotencyKey" value={props.idempotencyKey} />
          {props.origin ? <input type="hidden" name="origin" value={props.origin} /> : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="text-sm font-extrabold text-slate-900">과목</span>
              <select
                name="subject"
                defaultValue=""
                className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-900 outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-100"
              >
                <option value="">선택 안 함</option>
                <SubjectSelectOptions />
              </select>
            </label>
            <label className="block">
              <span className="text-sm font-extrabold text-slate-900">단원·개념</span>
              <input
                name="topic"
                type="text"
                placeholder="예: 함수의 극한, 문학 개념어"
                className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-100"
              />
            </label>
          </div>

          <label className="block">
            <span className="text-sm font-extrabold text-slate-900">제목</span>
            <input
              name="title"
              type="text"
              required
              minLength={2}
              maxLength={120}
              placeholder="질문 제목을 입력해 주세요"
              className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-100"
            />
          </label>

          <label className="block">
            <span className="text-sm font-extrabold text-slate-900">질문 내용</span>
            <textarea
              name="body"
              required
              minLength={5}
              rows={9}
              placeholder="풀이 과정, 막힌 지점, 원하는 설명 방식을 적어 주세요."
              className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm leading-7 text-slate-900 outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-100"
            />
          </label>

          <div className="block">
            <span className="text-sm font-extrabold text-slate-900">첨부 파일</span>
            <div className="mt-2">
              <CommunityFileDropzone
                name="attachment"
                accept=".jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf"
                buttonLabel="파일 선택"
                hint="JPG, PNG, PDF · 20MB 이하 · 클릭하거나 끌어다 놓으세요"
              />
            </div>
            <span className="mt-1 block text-xs font-semibold text-slate-500">JPG, PNG, PDF 파일 20MB 이하</span>
          </div>

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Link
              href={props.cancelHref}
              className="rounded-xl border border-slate-200 bg-white px-5 py-3 text-center text-sm font-extrabold text-slate-700 hover:bg-slate-50"
            >
              취소
            </Link>
            <FormSubmitButton
              idleLabel={`${formatIndividualQuestionPrice(props.amountCents)} 안전 결제하고 질문 보내기`}
              pendingLabel="결제 처리 중..."
              className="rounded-xl bg-blue-600 px-5 py-3 text-sm font-extrabold text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
            />
          </div>
        </form>
      )}
    </>
  );
}
