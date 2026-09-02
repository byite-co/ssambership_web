/**
 * 계정 제재(경고·정지·차단) 표시 규칙 — 신고 상세(경고·계정 정지)와 분쟁 상세(제재)가 함께 쓴다(PR-6).
 *
 * 값의 정본은 서버 코드와 DB 다. 이 파일은 그 값을 확인 모달 문장으로 옮길 뿐이며, 계약 테스트가 소스 대조로 어긋남을 잡는다.
 * - 제재 코드 → 계정 상태: `accountStatusCore.sanctionToAccountStatus` — 7d → suspended 7일 · 30d → suspended 30일 · permanent → banned.
 * - 경고 자동 정지: `accountStatusCore.WARNING_AUTO_SUSPEND_THRESHOLD`(3) · `WARNING_AUTO_SUSPEND_DAYS`(7)
 *   = RPC `admin_issue_user_warning` 의 `v_active_count >= 3` → `interval '7 days'`(경고 INSERT 와 같은 트랜잭션).
 * - 정지가 실제로 막는 것(2026-09-02 실측 — `assertAccountActive` 호출부): 질문방 글·답변·연결노트(questionRoomActions) ·
 *   개별 질문(individualQuestionActions) · 커뮤니티 글·댓글·숏폼(community*Actions).
 *   막지 않는 것: 로그인(`resolveEffectiveAccountStatus.canLogin` 호출부 0 · middleware 무처리) · 구독·결제·캐시 충전(게이트 호출 없음).
 *   정지·차단은 `users` 행(status·suspended_until·status_reason·status_changed_*)만 갱신한다 — users 에 상태 반응 트리거가 없어
 *   구독·질문방·주문 행은 바뀌지 않는다. 멘토는 `mentor_directory_v1` 뷰의 `status='active'` 조건으로 멘토 찾기 목록에서 빠진다.
 *   일시 정지는 `suspended_until` 경과 시 자동 해제(lazy 판정), 영구 차단은 수동 해제 전까지 유지.
 *
 * node --test 계약 테스트가 직접 import 하므로 React·`@/`·server-only import 를 두지 않는다.
 */

export const ACCOUNT_SANCTION_CODES = ["7d", "30d", "permanent"] as const;
export type AccountSanctionCode = (typeof ACCOUNT_SANCTION_CODES)[number];

export function isAccountSanctionCode(value: string | null | undefined): value is AccountSanctionCode {
  return (ACCOUNT_SANCTION_CODES as readonly string[]).includes(String(value ?? ""));
}

export const ACCOUNT_SANCTION_LABELS: Readonly<Record<AccountSanctionCode, string>> = {
  "7d": "7일 정지",
  "30d": "30일 정지",
  permanent: "영구 차단",
};

/** 제재 코드 → `users.status` · 정지 일수. `accountStatusCore.sanctionToAccountStatus` 와 같은 표(계약 테스트가 소스 대조). */
export const ACCOUNT_SANCTION_TO_STATUS: Readonly<
  Record<AccountSanctionCode, { nextStatus: "suspended" | "banned"; durationDays: number | null }>
> = {
  "7d": { nextStatus: "suspended", durationDays: 7 },
  "30d": { nextStatus: "suspended", durationDays: 30 },
  permanent: { nextStatus: "banned", durationDays: null },
};

/** 경고 자동 정지 규칙 — `accountStatusCore` 상수 · RPC `admin_issue_user_warning` 본문과 같다. */
export const ACCOUNT_WARNING_AUTO_SUSPEND_THRESHOLD = 3;
export const ACCOUNT_WARNING_AUTO_SUSPEND_DAYS = 7;

export const ACCOUNT_SUSPENDED_BLOCKED_SENTENCE =
  "정지 중에는 질문방 글·답변·연결노트, 개별 질문, 커뮤니티 글·댓글·숏폼 작성이 차단됩니다.";
export const ACCOUNT_SUSPENDED_NOT_BLOCKED_SENTENCE = "로그인·구독·결제는 막히지 않으며, 진행 중인 구독은 유지됩니다.";
export const ACCOUNT_BANNED_SENTENCE = "수동으로 해제하기 전까지 유지됩니다.";

export function accountRoleLabel(role: string | null | undefined): string {
  const r = String(role ?? "").trim().toLowerCase();
  if (r === "student") return "학생";
  if (r === "mentor") return "멘토";
  if (r === "admin") return "관리자";
  return r || "—";
}

function nameOrFallback(name: string | null | undefined): string {
  const s = typeof name === "string" ? name.trim() : "";
  return s || "이름 없음";
}

/**
 * 멘토 정지 시 영향 문장 — `mentor_student_rooms` 의 담당 학생 수. 데이터가 없으면(null) 문장을 생략한다(지시서 §1-2).
 */
export function mentorSanctionImpactSentence(roomCount: number | null | undefined): string | null {
  if (typeof roomCount !== "number" || !Number.isFinite(roomCount)) return null;
  const n = Math.max(0, Math.trunc(roomCount));
  if (n === 0) return "담당 학생이 없어 질문방 영향은 없습니다. 멘토 찾기 목록에서는 빠집니다.";
  return `담당 학생 ${n}명의 질문방이 영향받습니다 — 멘토 답변이 막히고 멘토 찾기 목록에서 빠집니다.`;
}

export type AccountSanctionSummaryInput = {
  name: string;
  /** 학생 · 멘토 */
  roleLabel: string;
  code: AccountSanctionCode;
  /** 정지 해제 예정일 표기(예: 2026.09.10) — 영구 차단이면 무시 */
  untilLabel: string | null;
  /** 대상이 멘토일 때만 담당 학생 수 — null 이면 문장 생략 */
  mentorRoomCount: number | null;
  isMentor: boolean;
};

/**
 * 정지·차단 확인 summary — 줄바꿈으로 여러 문장. 마지막 문장들은 실제 동작(위 주석)을 그대로 적는다.
 *   김OO 학생 계정을 7일 정지합니다. 2026.09.10까지 정지되며 그 뒤 자동 해제됩니다.
 *   정지 중에는 … 차단됩니다.
 *   로그인·구독·결제는 막히지 않으며, 진행 중인 구독은 유지됩니다.
 *   (멘토) 담당 학생 N명의 질문방이 영향받습니다 — …
 */
export function buildAccountSanctionSummary(input: AccountSanctionSummaryInput): string {
  const who = `${nameOrFallback(input.name)} ${input.roleLabel}`.trim();
  const lines: string[] = [];
  if (input.code === "permanent") {
    lines.push(`${who} 계정을 영구 차단합니다. ${ACCOUNT_BANNED_SENTENCE}`);
  } else {
    const days = ACCOUNT_SANCTION_TO_STATUS[input.code].durationDays ?? 0;
    const until = input.untilLabel ? ` ${input.untilLabel}까지 정지되며 그 뒤 자동 해제됩니다.` : "";
    lines.push(`${who} 계정을 ${days}일 정지합니다.${until}`);
  }
  lines.push(ACCOUNT_SUSPENDED_BLOCKED_SENTENCE);
  lines.push(ACCOUNT_SUSPENDED_NOT_BLOCKED_SENTENCE);
  if (input.isMentor) {
    const impact = mentorSanctionImpactSentence(input.mentorRoomCount);
    if (impact) lines.push(impact);
  }
  return lines.join("\n");
}

/**
 * 경고 확인 summary — `김OO 님에게 경고를 기록합니다. 누적 경고 N회.` + 자동 정지 규칙.
 * 이번 경고로 임계치(3회)에 닿으면 RPC 가 7일 자동 정지까지 같은 트랜잭션으로 수행하므로 그 사실을 먼저 적는다.
 * 누적 횟수를 못 읽었으면(null) 그 사실을 드러낸다.
 */
export function buildAccountWarningSummary(input: { name: string; activeWarningCount: number | null }): string {
  const who = nameOrFallback(input.name);
  if (input.activeWarningCount == null) {
    return [
      `${who} 님에게 경고를 기록합니다. 누적 경고 횟수를 확인하지 못했습니다.`,
      `경고 ${ACCOUNT_WARNING_AUTO_SUSPEND_THRESHOLD}회 누적 시 계정이 ${ACCOUNT_WARNING_AUTO_SUSPEND_DAYS}일 자동 정지됩니다.`,
    ].join("\n");
  }
  const n = Math.max(0, Math.trunc(input.activeWarningCount));
  const next = n + 1;
  const lines = [`${who} 님에게 경고를 기록합니다. 누적 경고 ${n}회.`];
  if (next >= ACCOUNT_WARNING_AUTO_SUSPEND_THRESHOLD) {
    lines.push(
      `이번 경고로 ${next}회가 되어 계정이 ${ACCOUNT_WARNING_AUTO_SUSPEND_DAYS}일 자동 정지됩니다(경고 ${ACCOUNT_WARNING_AUTO_SUSPEND_THRESHOLD}회 누적 규칙). 더 긴 정지가 필요하면 '계정 정지'를 쓰세요.`
    );
  } else {
    lines.push(`경고 ${ACCOUNT_WARNING_AUTO_SUSPEND_THRESHOLD}회 누적 시 계정이 ${ACCOUNT_WARNING_AUTO_SUSPEND_DAYS}일 자동 정지됩니다.`);
  }
  return lines.join("\n");
}
