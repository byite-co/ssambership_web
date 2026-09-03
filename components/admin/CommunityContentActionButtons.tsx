"use client";

/**
 * 커뮤니티 관리 — 행 조치 버튼(PR-11 §1-2 · PR-W2 소프트 삭제 통일). 구 화면의 1클릭 `숨김·복구·삭제` 버튼을 `ConfirmSubmitButton` 으로 바꾼 것. 서버 액션·필드명은 그대로다.
 *
 * | 조치 | 게시판 글 · 숏폼 · 댓글(전부 같다)                                                      |
 * |------|-----------------------------------------------------------------------------------------|
 * | 숨김 | stateChange · `복구할 수 있습니다`                                                        |
 * | 복원 | stateChange — 숨김 복원과 삭제됨 탭의 삭제 복원이 같은 서버 액션(deleted_at NULL)           |
 * | 삭제 | stateChange · 소프트 삭제(deleted_at/deleted_by) · `삭제 후 복구할 수 있습니다` · 재입력 없음 |
 *
 * 삭제 모달의 `숨김으로 대신하기`(PR-5 신고 상세와 같은 부품·같은 방식 — 삭제 다이얼로그를 닫고 같은 행의 숨김 트리거를 click 해
 * **숨김 확인 모달만 연다**)는 그대로 둔다. 하드 DELETE 배너·대상 ID 재입력은 DB-2(SQL 194) 소프트 삭제 전환으로 없앴다.
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
  COMMUNITY_CONTENT_DELETE_EFFECT_LABEL,
  COMMUNITY_CONTENT_HIDE_INSTEAD_LABEL,
  COMMUNITY_CONTENT_KIND_LABELS,
  COMMUNITY_CONTENT_RETURN_TO_FIELD,
  COMMUNITY_CONTENT_TARGET_ID_FIELD,
  buildCommunityContentDeleteSummary,
  buildCommunityContentHideSummary,
  buildCommunityContentRestoreSummary,
  communityContentActionButtonId,
  communityContentAvailableActions,
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
                level="stateChange"
                summary={buildCommunityContentDeleteSummary(type)}
                details={[targetRow, { label: "삭제 방식", value: COMMUNITY_CONTENT_DELETE_EFFECT_LABEL }]}
                body={
                  canHideInstead ? (
                    <button
                      type="button"
                      onClick={hideInstead}
                      className="w-full rounded-xl border-2 border-amber-400 bg-amber-50 px-3 py-2 text-sm font-extrabold text-amber-900 transition hover:bg-amber-100"
                      data-community-content-hide-instead
                    >
                      {COMMUNITY_CONTENT_HIDE_INSTEAD_LABEL} — 복구할 수 있습니다
                    </button>
                  ) : null
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
