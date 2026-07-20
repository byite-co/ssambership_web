"use client";

import { useMemo, useState } from "react";
import { FormSubmitButton } from "@/components/common/FormSubmitButton";
import { CommunityCategoryChips } from "@/components/community/CommunityCategoryChips";
import { submitMentorCommunityPost } from "@/lib/community/communityComposeActions";
import { COMMUNITY_POST_CATEGORIES } from "@/lib/community/communityBoardConstants";
import { SHORTFORM_CATEGORIES } from "@/lib/community/communityShortformConstants";

type PostType = "board" | "shortform";

export function MentorCommunityComposeForm(props: { errorMessage: string | null }) {
  const [postType, setPostType] = useState<PostType>("board");
  const categories = useMemo(
    () => (postType === "board" ? COMMUNITY_POST_CATEGORIES : SHORTFORM_CATEGORIES),
    [postType]
  );

  return (
    <form action={submitMentorCommunityPost} className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6">
      <h1 className="text-xl font-black text-slate-900">게시물 작성 (멘토)</h1>
      <p className="text-sm text-slate-600">
        게시판 글 또는 숏폼 영상 중 하나를 선택해 등록합니다. 제출 시 멘토 권한이 확인됩니다.
      </p>

      {props.errorMessage ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-950">{props.errorMessage}</div>
      ) : null}

      <label className="block text-sm font-extrabold text-slate-800">
        작성 대상
        <select
          name="postType"
          required
          value={postType}
          onChange={(e) => setPostType(e.target.value as PostType)}
          className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
        >
          <option value="board">게시판 글</option>
          <option value="shortform">숏폼 영상</option>
        </select>
      </label>

      <CommunityCategoryChips
        categories={categories}
        name="category"
        defaultSlug="study"
        resetKey={postType}
      />

      <label className="block text-sm font-extrabold text-slate-800">
        제목
        <input
          name="title"
          required
          className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
        />
      </label>

      <label className="block text-sm font-extrabold text-slate-800">
        본문
        <textarea
          name="body"
          rows={6}
          required
          className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
        />
      </label>

      <label className="block text-sm font-extrabold text-slate-800">
        출처
        <input
          name="source"
          required
          className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
          placeholder="원본·인용 출처 URL 또는 표기"
        />
      </label>

      <label className="flex items-start gap-2 text-sm text-slate-800">
        <input type="checkbox" name="rightsAck" value="on" required className="mt-1" />
        <span>원본 권리·정당한 범위의 이용(인용/2차이용 정책)을 확인했습니다. 무단 복제가 아님을 확약합니다.</span>
      </label>

      <FormSubmitButton
        idleLabel="제출"
        pendingLabel="저장 중…"
        className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white enabled:hover:bg-emerald-500 disabled:cursor-not-allowed disabled:bg-slate-300"
      />
    </form>
  );
}
