/**
 * 관리자 확인 절차 정책 — PRD §5-1 위험 4단계의 순수 로직.
 *
 * `ConfirmSubmitButton`·`AdminConfirmDialog`(클라이언트 컴포넌트)가 소비하고, 계약 테스트가 직접 import 한다.
 * node --test 로 검증해야 하므로 이 파일에는 React·`@/` import·JSX 를 두지 않는다.
 *
 * | 등급          | 대상                    | 다이얼로그 요구                                         |
 * |---------------|-------------------------|---------------------------------------------------------|
 * | critical      | 자금 이동 · 계정 차단/정지 | 대상 요약 + 금액 재표시 + **사유 입력 필수** + 확인        |
 * | destructive   | 되돌릴 수 없는 삭제        | 대상 이름 재입력 + 확인                                   |
 * | stateChange   | 승인·반려·숨김·종결        | 한 줄 확인                                               |
 * | immediate     | 조회·토글                 | 다이얼로그 없음(버튼 그대로)                              |
 */

export const ADMIN_CONFIRM_LEVELS = ["critical", "destructive", "stateChange", "immediate"] as const;
export type AdminConfirmLevel = (typeof ADMIN_CONFIRM_LEVELS)[number];

export type AdminConfirmTone = "danger" | "warning" | "neutral";

export type AdminConfirmLevelSpec = {
  /** 다이얼로그를 띄우는가 — immediate 만 false */
  needsDialog: boolean;
  /** "누구에게서 누구에게로 얼마" summary 문장이 필수인가 — critical·destructive */
  summaryRequired: boolean;
  /** `reasonRequired` 를 지정하지 않았을 때의 기본값 — critical 만 true */
  reasonRequiredDefault: boolean;
  /** 대상 이름 재입력(confirmText)이 필요한가 — destructive */
  confirmTextRequired: boolean;
  /** 다이얼로그·확인 버튼 색조 */
  tone: AdminConfirmTone;
  /** 제목을 넘기지 않았을 때의 다이얼로그 제목 */
  defaultTitle: string;
};

export const ADMIN_CONFIRM_LEVEL_SPECS: Readonly<Record<AdminConfirmLevel, AdminConfirmLevelSpec>> = {
  critical: {
    needsDialog: true,
    summaryRequired: true,
    reasonRequiredDefault: true,
    confirmTextRequired: false,
    tone: "danger",
    defaultTitle: "실행 전 확인",
  },
  destructive: {
    needsDialog: true,
    summaryRequired: true,
    reasonRequiredDefault: false,
    confirmTextRequired: true,
    tone: "danger",
    defaultTitle: "되돌릴 수 없는 작업",
  },
  stateChange: {
    needsDialog: true,
    summaryRequired: false,
    reasonRequiredDefault: false,
    confirmTextRequired: false,
    tone: "warning",
    defaultTitle: "확인",
  },
  immediate: {
    needsDialog: false,
    summaryRequired: false,
    reasonRequiredDefault: false,
    confirmTextRequired: false,
    tone: "neutral",
    defaultTitle: "",
  },
};

/** 사유 최소 길이(trim 후). 경고 발급 서버 검증(2자 이상)과 같은 기준. */
export const ADMIN_CONFIRM_REASON_MIN_LENGTH = 2;

export type AdminConfirmRequirements = {
  level: AdminConfirmLevel;
  needsDialog: boolean;
  /** 사유 입력이 없으면 확인 불가 */
  reasonRequired: boolean;
  /** 이 문자열을 정확히 다시 입력해야 확인 가능. null 이면 재입력 단계 없음 */
  confirmText: string | null;
  tone: AdminConfirmTone;
  title: string;
};

function normalizeText(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * props(level · reasonRequired · confirmText · title)를 다이얼로그 요구 사항으로 확정한다.
 * - critical: reasonRequired 기본 true(명시적으로 false 를 넘기면 해제)
 * - destructive: confirmText 가 있으면 재입력 단계. 비어 있으면 재입력 없이 다이얼로그만(타입으로는 필수)
 * - immediate: 다이얼로그 없음 → reason·confirmText 모두 무시
 * 알 수 없는 level 이 들어오면 가장 보수적인 critical 로 취급한다(운영 화면이 확인 없이 실행되는 쪽으로 깨지지 않게).
 */
export function resolveAdminConfirmRequirements(input: {
  level: AdminConfirmLevel;
  reasonRequired?: boolean;
  confirmText?: string | null;
  title?: string;
}): AdminConfirmRequirements {
  const level: AdminConfirmLevel = ADMIN_CONFIRM_LEVELS.includes(input.level) ? input.level : "critical";
  const spec = ADMIN_CONFIRM_LEVEL_SPECS[level];
  if (!spec.needsDialog) {
    return { level, needsDialog: false, reasonRequired: false, confirmText: null, tone: spec.tone, title: "" };
  }
  const reasonRequired = typeof input.reasonRequired === "boolean" ? input.reasonRequired : spec.reasonRequiredDefault;
  const confirmText = spec.confirmTextRequired ? normalizeText(input.confirmText) || null : null;
  const title = normalizeText(input.title) || spec.defaultTitle;
  return { level, needsDialog: true, reasonRequired, confirmText, tone: spec.tone, title };
}

export type AdminConfirmBlocker = "reason" | "confirmText";

export type AdminConfirmEvaluation = {
  ok: boolean;
  blockedBy: AdminConfirmBlocker[];
};

/**
 * 현재 입력 상태로 확인 버튼을 활성화할 수 있는가.
 * - reasonRequired: trim 후 ADMIN_CONFIRM_REASON_MIN_LENGTH 미만이면 불가
 * - confirmText: trim 후 대소문자까지 정확히 같아야 함
 */
export function evaluateAdminConfirm(
  req: AdminConfirmRequirements,
  state: { reason: string; typedConfirmText: string }
): AdminConfirmEvaluation {
  if (!req.needsDialog) return { ok: true, blockedBy: [] };
  const blockedBy: AdminConfirmBlocker[] = [];
  if (req.reasonRequired && normalizeText(state.reason).length < ADMIN_CONFIRM_REASON_MIN_LENGTH) {
    blockedBy.push("reason");
  }
  if (req.confirmText !== null && normalizeText(state.typedConfirmText) !== req.confirmText) {
    blockedBy.push("confirmText");
  }
  return { ok: blockedBy.length === 0, blockedBy };
}

export type AdminConfirmInitialFocus = "reason" | "confirmText" | "cancel";

/**
 * 다이얼로그가 열릴 때 포커스를 둘 곳. **확인 버튼에는 절대 두지 않는다** — Enter 한 번으로 실행되면 안 된다.
 */
export function adminConfirmInitialFocus(req: AdminConfirmRequirements): AdminConfirmInitialFocus {
  if (req.reasonRequired) return "reason";
  if (req.confirmText !== null) return "confirmText";
  return "cancel";
}

/**
 * 다이얼로그 안 keydown 에서 Enter 를 막아야 하는가.
 * - INPUT/SELECT: Enter 가 어떤 실행으로도 이어지지 않도록 막는다(다이얼로그는 form 이 아니지만 이중 안전장치)
 * - TEXTAREA: 줄바꿈이므로 허용
 * - BUTTON: 사용자가 Tab 으로 옮겨 간 뒤 누른 의도적 활성화 — 허용(초기 포커스는 확인 버튼에 오지 않는다)
 * - 그 외(컨테이너 등): 막는다
 * IME 조합 중(isComposing)의 Enter 는 조합 확정이므로 막지 않는다.
 */
export function shouldBlockAdminConfirmEnterKey(input: { key: string; tagName: string; isComposing?: boolean }): boolean {
  if (input.key !== "Enter") return false;
  if (input.isComposing) return false;
  const tag = String(input.tagName ?? "").toUpperCase();
  if (tag === "TEXTAREA" || tag === "BUTTON" || tag === "A") return false;
  return true;
}
