/**
 * 감사 로그 액션 사전(PR-10 §2-2) — `admin_action_logs.action_type` → 운영자 한글 라벨 + 계열(필터 그룹).
 *
 * - 코드가 기록하는 고정 액션과 템플릿 계열(`review_${action}` · `refund_bulk_${decision}` · `dispute_${sanction}` ·
 *   `content_report_${intent}` · `community_${intent}_${targetType}` · `notice_{created|updated|activated|deactivated}_${resource}`)을
 *   전부 전개해 등재한다. 계약 테스트(`auditLogConsole.contract.test.ts`)가 소스를 스캔해 코드가 쓰는 모든 action_type 이 여기 있는지 대조한다.
 * - 화면에 코드값을 노출하지 않는다: 모르는 값은 `기타 조치` 로 그리고 원시 값은 툴팁으로만 둔다(`resolveAdminActionType`).
 * - 화면별 부분 사전(`accountActionLogLabel` · `disputeActionLogLabel`)은 이 사전에 위임한다 — 라벨은 한 곳.
 * - 시스템 행(웹훅·배치 — `admin_id` NULL)도 여기 등재한다(`paysync_webhook` · `webhook_recovery` · `school_verification_bulk_confirmed`).
 *
 * node --test 계약 테스트가 직접 import 하므로 React·`@/` import 를 두지 않는다.
 */
import { resolveAdminStatus } from "./adminStatusDictionary.ts";

export const ADMIN_ACTION_GROUPS = [
  { key: "mentor_approval", label: "멘토 승인" },
  { key: "school_verification", label: "학교 인증" },
  { key: "academic_record", label: "학적 변경" },
  { key: "account", label: "계정" },
  { key: "mentor_activity", label: "멘토 활동·정원" },
  { key: "dispute", label: "분쟁" },
  { key: "content_report", label: "콘텐츠 신고" },
  { key: "community", label: "커뮤니티" },
  { key: "review", label: "리뷰" },
  { key: "refund", label: "환불" },
  { key: "settlement", label: "정산" },
  { key: "question_view", label: "질문 열람" },
  { key: "notice", label: "공지·이벤트" },
  { key: "settings", label: "시스템 설정" },
  { key: "classification", label: "분류 관리" },
  { key: "system", label: "시스템(웹훅·배치)" },
] as const;

export type AdminActionGroupKey = (typeof ADMIN_ACTION_GROUPS)[number]["key"];

export type AdminActionTypeEntry = {
  /** 운영자에게 보이는 한글 라벨 */
  label: string;
  group: AdminActionGroupKey;
};

function entry(label: string, group: AdminActionGroupKey): AdminActionTypeEntry {
  return { label, group };
}

// ── 템플릿 계열 전개 ────────────────────────────────────────────────────────────

/** `review_${action}` — adminReviewActions.ts ACTION_SET */
export const REVIEW_ACTION_VALUES = ["hide", "restore", "blind", "review"] as const;
/** `refund_bulk_${decision}` — refundActions.ts */
export const REFUND_BULK_DECISION_VALUES = ["approve", "reject"] as const;
/** `dispute_${sanction}` — adminDisputeSanctionActions.ts */
export const DISPUTE_SANCTION_VALUES = ["7d", "30d", "permanent", "hold", "complete"] as const;
/** `content_report_${intent}` — adminReportActions.ts MODERATION_INTENTS · `community_${intent}_…` — communityModerationCore.ts */
export const MODERATION_INTENT_VALUES = ["hidden", "deleted", "restored"] as const;
/** `community_${intent}_${targetType}` — communityModerationCore.ts ModerationTargetType */
export const COMMUNITY_TARGET_TYPE_VALUES = ["community_post", "shortform_post", "community_comment", "board_comment"] as const;
/** `notice_{created|updated|activated|deactivated}_${resource}` — adminNoticesActions.ts */
export const NOTICE_RESOURCE_VALUES = ["notice", "promotion"] as const;
export const NOTICE_ACTION_VERBS = ["created", "updated", "activated", "deactivated"] as const;

const REVIEW_ACTION_LABELS: Record<(typeof REVIEW_ACTION_VALUES)[number], string> = {
  hide: "리뷰 숨김",
  restore: "리뷰 복구",
  blind: "리뷰 블라인드",
  review: "리뷰 검토 처리",
};

const MODERATION_INTENT_LABELS: Record<(typeof MODERATION_INTENT_VALUES)[number], string> = {
  hidden: "숨김",
  deleted: "삭제",
  restored: "복구",
};

const COMMUNITY_TARGET_LABELS: Record<(typeof COMMUNITY_TARGET_TYPE_VALUES)[number], string> = {
  community_post: "게시글",
  shortform_post: "숏폼",
  community_comment: "커뮤니티 댓글",
  board_comment: "게시판 댓글",
};

const NOTICE_RESOURCE_LABELS: Record<(typeof NOTICE_RESOURCE_VALUES)[number], string> = {
  notice: "공지",
  promotion: "프로모션",
};

const NOTICE_VERB_LABELS: Record<(typeof NOTICE_ACTION_VERBS)[number], string> = {
  created: "등록",
  updated: "수정",
  activated: "활성화",
  deactivated: "비활성화",
};

function disputeSanctionLabel(code: (typeof DISPUTE_SANCTION_VALUES)[number]): string {
  switch (code) {
    case "7d":
      return `제재 · ${resolveAdminStatus("disputes", "status", "sanction_7d").label}`;
    case "30d":
      return `제재 · ${resolveAdminStatus("disputes", "status", "sanction_30d").label}`;
    case "permanent":
      return `제재 · ${resolveAdminStatus("disputes", "status", "sanction_permanent").label}`;
    case "hold":
      return "보류";
    case "complete":
      return "해결(보류 건 완료)";
  }
}

function expandTemplates(): Record<string, AdminActionTypeEntry> {
  const out: Record<string, AdminActionTypeEntry> = {};
  for (const a of REVIEW_ACTION_VALUES) out[`review_${a}`] = entry(REVIEW_ACTION_LABELS[a], "review");
  for (const d of REFUND_BULK_DECISION_VALUES) out[`refund_bulk_${d}`] = entry(d === "approve" ? "환불 일괄 승인" : "환불 일괄 반려", "refund");
  for (const s of DISPUTE_SANCTION_VALUES) out[`dispute_${s}`] = entry(disputeSanctionLabel(s), "dispute");
  for (const i of MODERATION_INTENT_VALUES) out[`content_report_${i}`] = entry(`신고 콘텐츠 ${MODERATION_INTENT_LABELS[i]} 처리`, "content_report");
  for (const i of MODERATION_INTENT_VALUES) {
    for (const t of COMMUNITY_TARGET_TYPE_VALUES) {
      out[`community_${i}_${t}`] = entry(`${COMMUNITY_TARGET_LABELS[t]} ${MODERATION_INTENT_LABELS[i]}`, "community");
    }
  }
  for (const v of NOTICE_ACTION_VERBS) {
    for (const r of NOTICE_RESOURCE_VALUES) {
      out[`notice_${v}_${r}`] = entry(`${NOTICE_RESOURCE_LABELS[r]} ${NOTICE_VERB_LABELS[v]}`, "notice");
    }
  }
  return out;
}

// ── 고정 액션 ───────────────────────────────────────────────────────────────────

const FIXED: Record<string, AdminActionTypeEntry> = {
  // 멘토 승인(mentorApprovalActions.ts)
  mentor_approve: entry("멘토 승인", "mentor_approval"),
  mentor_reject: entry("멘토 반려", "mentor_approval"),
  mentor_request_documents: entry("서류 재제출 요청", "mentor_approval"),
  // 학교 인증(mentorSchoolVerificationReviewActions.ts · DB-1 SQL 192 배치)
  mentor_school_verification_approve: entry("학교 인증 승인", "school_verification"),
  mentor_school_verification_reject: entry("학교 인증 반려", "school_verification"),
  mentor_school_verification_resubmit_required: entry("학교 인증 재제출 요청", "school_verification"),
  school_verification_bulk_confirmed: entry("학교 인증 일괄 확정(배치)", "school_verification"),
  // 학적 변경(mentorAcademicRecordChangeReviewActions.ts)
  mentor_academic_record_change_approve: entry("학적 변경 승인", "academic_record"),
  mentor_academic_record_change_reject: entry("학적 변경 반려", "academic_record"),
  mentor_academic_record_change_resubmit_required: entry("학적 변경 재제출 요청", "academic_record"),
  mentor_academic_record_change_profile_apply_failed: entry("학적 변경 프로필 반영 실패", "academic_record"),
  // 계정(accountStatusActions.ts · contentReportSanction)
  account_status_change: entry("계정 상태 변경", "account"),
  user_warning_issued: entry("경고 발급", "account"),
  // 멘토 활동·정원(mentorActivityAdminActions.ts · mentorCapAdminActions.ts)
  mentor_cap_limit_update: entry("정원 조정", "mentor_activity"),
  mentor_termination_finalized: entry("멘토 활동 종료 확정", "mentor_activity"),
  mentor_abandonment_hold_approved: entry("이탈 정산 보류 승인", "mentor_activity"),
  mentor_settlement_hold_released: entry("정산 보류 해제", "mentor_activity"),
  // 분쟁(adminDisputeActions.ts · bulkActions.ts) — 라벨은 분쟁 상세 처리 이력 표기(PR-6) 그대로
  dispute_under_review: entry("검토 시작", "dispute"),
  dispute_resolved: entry("해결(종결)", "dispute"),
  dispute_dismissed: entry("기각", "dispute"),
  dispute_note_created: entry("케이스 노트", "dispute"),
  dispute_custom_order_split: entry("예치금 분배", "dispute"),
  dispute_bulk_status: entry("일괄 상태 변경", "dispute"),
  // 콘텐츠 신고(adminReportActions.ts)
  content_report_status: entry("신고 상태 변경", "content_report"),
  content_report_note_created: entry("신고 케이스 노트", "content_report"),
  // 환불(refundActions.ts)
  refund_approve: entry("환불 승인", "refund"),
  refund_reject: entry("환불 반려", "refund"),
  // 정산(settlementActions.ts)
  payout_run_execute: entry("정산 실행", "settlement"),
  // 질문 열람(questionDrilldownConsole.ts — PR-8 원칙 3)
  question_body_viewed: entry("질문 본문 열람", "question_view"),
  // 질문 내보내기(questionExportConsole.ts — PR-13 §2-4 · 미성년자 대화 반출 기록)
  question_export: entry("질문 내보내기(CSV)", "question_view"),
  // 시스템 설정(adminTopupPackageActions.ts)
  topup_package_activated: entry("충전 패키지 활성화", "settings"),
  topup_package_deactivated: entry("충전 패키지 비활성화", "settings"),
  // 분류 관리(schoolClassificationActions.ts)
  school_tier_catalog_update: entry("학교 등급 목록 변경", "classification"),
  major_category_catalog_update: entry("전공 계열 목록 변경", "classification"),
  school_tier_mapping_create: entry("학교 등급 매핑 추가", "classification"),
  school_tier_mapping_update: entry("학교 등급 매핑 변경", "classification"),
  // 시스템(admin_id NULL — app/api/paysync/webhook · lib/toss/cashTopupFromPayment)
  paysync_webhook: entry("페이싱크 웹훅 수신", "system"),
  webhook_recovery: entry("결제 웹훅 복구(고아 결제)", "system"),
};

export const ADMIN_ACTION_TYPE_LABELS: Readonly<Record<string, AdminActionTypeEntry>> = { ...FIXED, ...expandTemplates() };

export const ADMIN_ACTION_TYPE_KEYS: readonly string[] = Object.keys(ADMIN_ACTION_TYPE_LABELS);

/** 모르는 action_type 의 화면 표기 — 코드값을 노출하지 않는다(원시 값은 툴팁). */
export const ADMIN_ACTION_UNKNOWN_LABEL = "기타 조치";

export type AdminActionTypeResolution = {
  label: string;
  group: AdminActionGroupKey | null;
  groupLabel: string | null;
  /** 사전에 등재된 값이었는가 */
  known: boolean;
  /** 입력 원시 값(trim) */
  raw: string;
};

export function adminActionGroupLabel(group: AdminActionGroupKey): string {
  return ADMIN_ACTION_GROUPS.find((g) => g.key === group)?.label ?? group;
}

export function isAdminActionGroup(value: unknown): value is AdminActionGroupKey {
  return typeof value === "string" && ADMIN_ACTION_GROUPS.some((g) => g.key === value);
}

/** 계열에 속한 action_type 전부(템플릿 전개 포함) — 서버 필터 `in (...)` 인자. */
export function adminActionTypesForGroup(group: AdminActionGroupKey): string[] {
  return ADMIN_ACTION_TYPE_KEYS.filter((k) => ADMIN_ACTION_TYPE_LABELS[k].group === group);
}

/** 표시용 라벨·계열을 구한다. **절대 throw 하지 않는다.** 미등재 값은 `기타 조치` + known=false. */
export function resolveAdminActionType(actionType: unknown): AdminActionTypeResolution {
  const raw = actionType === null || actionType === undefined ? "" : String(actionType).trim();
  const hit = raw ? ADMIN_ACTION_TYPE_LABELS[raw] : undefined;
  if (hit) return { label: hit.label, group: hit.group, groupLabel: adminActionGroupLabel(hit.group), known: true, raw };
  return { label: ADMIN_ACTION_UNKNOWN_LABEL, group: null, groupLabel: null, known: false, raw };
}

/** 라벨만 — 미등재는 `기타 조치`. */
export function adminActionLabel(actionType: unknown): string {
  return resolveAdminActionType(actionType).label;
}
