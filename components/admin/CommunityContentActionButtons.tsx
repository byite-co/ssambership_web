"use client";

/**
 * 커뮤니티 관리 — 행 조치 버튼(PR-11 §1-2). 구 화면의 1클릭 `숨김·복구·삭제` 버튼을 `ConfirmSubmitButton` 으로 바꾼 것. 서버 액션·필드명은 그대로다.
 *
 * | 조치 | 게시판 글                                  | 숏폼 · 댓글                                      |
 * |------|--------------------------------------------|--------------------------------------------------|
 * | 숨김 | stateChange · `복구할 수 있습니다`           | 동일                                             |
 * | 복원 | stateChange                                | stateChange                                      |
 * | 삭제 | destructive · soft-delete · `삭제 후 복구할 수 있습니다` | destructive · 하드 DELETE · 첫 줄 **복구 불가** + `영구 삭제됩니다. 복구할 수 없습니다` |
 *
 * 삭제 모달은 대상 ID(앞 8자) 재입력 + `숨김으로 대신하기`(PR-5 신고 상세와 같은 부품·같은 방식 — 삭제 다이얼로그를 닫고 같은 행의 숨김 트리거를
 * click 해 **숨김 확인 모달만 연다**). 삭제 방식 자체는 바꾸지 않는다 — 화면이 차이를 정직하게 보여줄 뿐이다.
 */
import { useState } from "react";
import { ConfirmSubmitButton } from "@/components/admin/ConfirmSubmitButton";
import {
  directDeleteCommentAction,
  directDeleteCommunityPostAction,
  directDeleteShortformAction,
  directHideCommentAction,
  directHideCommunityPostAction,
  directHideShortformAction,
  directRestoreCommentAction,
  directRestoreCommunityPostAction,
  directRestoreShortformAction,
} from "@/lib/admin/communityModerationActions";
import {
  COMMUNITY_CONTENT_ACTIONS,
  COMMUNITY_CONTENT_DELETE_EFFECT_LABELS,
  COMMUNITY_CONTENT_HARD_DELETE_BANNER,
  COMMUNITY_CONTENT_HIDE_INSTEAD_LABEL,
  COMMUNITY_CONTENT_KIND_LABELS,
  COMMUNITY_CONTENT_RETURN_TO_FIELD,
  COMMUNITY_CONTENT_TARGET_ID_FIELD,
  buildCommunityContentDeleteSummary,
  buildCommunityContentHideSummary,
  buildCommunityContentRestoreSummary,
  communityContentActionButtonId,
  communityContentAvailableActions,
  communityContentDeleteConfirmText,
  communityContentDeleteEffect,
  type CommunityContentActionKey,
  type CommunityContentStatus,
  type CommunityContentType,
} from "@/lib/admin/communityContentConsole";

type Props = {
  type: CommunityContentType;
  targetId: string;
  status: CommunityContentStatus;
  /** 처리 후 돌아올 목록 URL(종류·탭·검색 유지) */
  returnTo: string;
};

type ServerAction = (formData: FormData) => void | Promise<void>;

const ACTIONS_BY_TYPE: Readonly<Record<CommunityContentType, Readonly<Record<CommunityContentActionKey, ServerAction>>>> = {
  posts: { hidden: directHideCommunityPostAction, restored: directRestoreCommunityPostAction, deleted: directDeleteCommunityPostAction },
  shortforms: { hidden: directHideShortformAction, restored: directRestoreShortformAction, deleted: directDeleteShortformAction },
  comments: { hidden: directHideCommentAction, restored: directRestoreCommentAction, deleted: directDeleteCommentAction },
};

const BUTTON = "inline-flex h-8 items-center justify-center rounded-lg px-2.5 text-xs font-bold text-white transition disabled:cursor-not-allowed disabled:opacity-60";
const BUTTON_TONE: Readonly<Record<CommunityContentActionKey, string>> = {
  hidden: "bg-amber-600 hover:bg-amber-700",
  restored: "bg-emerald-600 hover:bg-emerald-700",
  deleted: "bg-red-700 hover:bg-red-800",
};

export function CommunityContentActionButtons({ type, targetId, status, returnTo }: Props) {
  // 삭제 다이얼로그를 닫는 유일한 수단 — 트리거를 리마운트한다(ConfirmSubmitButton 은 닫기 API 를 노출하지 않는다).
  const [deleteInstance, setDeleteInstance] = useState(0);
  const available = communityContentAvailableActions(status);
  const actions = ACTIONS_BY_TYPE[type];
  const effect = communityContentDeleteEffect(type);
  const kind = COMMUNITY_CONTENT_KIND_LABELS[type];
  const canHideInstead = available.includes("hidden");

  const hideInstead = () => {
    setDeleteInstance((n) => n + 1);
    document.getElementById(communityContentActionButtonId("hidden", targetId))?.click();
  };

  const targetRow = { label: "대상", value: `${kind} · ${targetId.slice(0, 8)}…` };

  return (
    <div className="flex flex-wrap gap-1.5" data-community-content-actions={targetId}>
      {available.map((key) => {
        const def = COMMUNITY_CONTENT_ACTIONS[key];
        const common = (
          <>
            <input type="hidden" name={COMMUNITY_CONTENT_TARGET_ID_FIELD} value={targetId} />
            <input type="hidden" name={COMMUNITY_CONTENT_RETURN_TO_FIELD} value={returnTo} />
          </>
        );
        if (key === "deleted") {
          return (
            <form action={actions.deleted} className="inline" key={`deleted-${deleteInstance}`}>
              {common}
              <ConfirmSubmitButton
                id={communityContentActionButtonId("deleted", targetId)}
                level="destructive"
                summary={buildCommunityContentDeleteSummary(type)}
                confirmText={communityContentDeleteConfirmText(targetId)}
                details={[targetRow, { label: "삭제 방식", value: COMMUNITY_CONTENT_DELETE_EFFECT_LABELS[effect] }]}
                body={
                  <div className="space-y-2">
                    {effect === "hard_delete" ? (
                      <p className="rounded-xl border border-red-300 bg-red-50 px-3 py-2 text-sm font-black text-red-800" data-community-content-hard-delete-banner>
                        {COMMUNITY_CONTENT_HARD_DELETE_BANNER} — 영구 삭제됩니다. 복구할 수 없습니다.
                      </p>
                    ) : null}
                    {canHideInstead ? (
                      <button
                        type="button"
                        onClick={hideInstead}
                        className="w-full rounded-xl border-2 border-amber-400 bg-amber-50 px-3 py-2 text-sm font-extrabold text-amber-900 transition hover:bg-amber-100"
                        data-community-content-hide-instead
                      >
                        {COMMUNITY_CONTENT_HIDE_INSTEAD_LABEL} — 복구할 수 있습니다
                      </button>
                    ) : null}
                  </div>
                }
                dialogTitle={def.dialogTitle}
                confirmLabel={def.confirmLabel}
                pendingLabel={def.pendingLabel}
                className={`${BUTTON} ${BUTTON_TONE.deleted}`}
              >
                {def.label}
              </ConfirmSubmitButton>
            </form>
          );
        }
        return (
          <form action={actions[key]} className="inline" key={key}>
            {common}
            <ConfirmSubmitButton
              id={communityContentActionButtonId(key, targetId)}
              level="stateChange"
              summary={key === "hidden" ? buildCommunityContentHideSummary(type) : buildCommunityContentRestoreSummary(type, status)}
              details={[targetRow]}
              dialogTitle={def.dialogTitle}
              confirmLabel={def.confirmLabel}
              pendingLabel={def.pendingLabel}
              className={`${BUTTON} ${BUTTON_TONE[key]}`}
            >
              {def.label}
            </ConfirmSubmitButton>
          </form>
        );
      })}
    </div>
  );
}
