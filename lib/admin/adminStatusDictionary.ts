/**
 * 관리자 상태 사전 — 화면 7곳이 각자 들고 있던 enum→라벨→색 매핑(분석 §2-3, 22곳)을 한 곳에 모은 정본.
 *
 * 구조: `{ [table.column]: { [enumValue]: { label, tone, risk? } } }`
 * - 값 집합은 DB CHECK 제약과 1:1 이어야 한다(계약 테스트 `adminStatusDictionary.contract.test.ts` 가
 *   `docs/audit/remote_db_inventory_20260804/constraints.json` + 마이그레이션 SQL 과 대조한다).
 * - `mentor_profiles.verification_status` 는 CHECK 가 없으므로 **이 사전이 유일한 허용 목록**이다.
 * - `payments.status` 의 성공 동의어 5종(succeeded·paid·success·complete·captured)은 모두 "결제 완료" 하나로 정규화한다.
 * - 톤 5종(neutral·info·success·warning·danger)은 DS `StatusBadge` 의 tone 과 이름이 같다(`AdminStatusPill` 이 그대로 넘긴다).
 * - 사전에 없는 값은 `resolveAdminStatus` 가 **throw 하지 않고** neutral 톤 + 원시 값으로 돌려준다.
 *
 * 이 파일은 node --test 계약 테스트가 직접 import 하므로 React·`@/` import 를 두지 않는다.
 */

export const ADMIN_STATUS_TONES = ["neutral", "info", "success", "warning", "danger"] as const;
export type AdminStatusTone = (typeof ADMIN_STATUS_TONES)[number];

/**
 * 해당 상태로 전이시키는(또는 그 상태에서 되돌리기 어려운) 조치의 위험도 — 분석 §2-2 의 상/중.
 * high: 자금 이동·계정 차단·하드 삭제 등 되돌릴 수 없음 · medium: 터미널 상태 전이·계정 정지.
 * 없으면 되돌릴 수 있는 일반 상태.
 */
export type AdminStatusRisk = "high" | "medium";

export type AdminStatusEntry = {
  /** 운영자에게 보이는 한글 라벨 */
  label: string;
  tone: AdminStatusTone;
  risk?: AdminStatusRisk;
};

export type AdminStatusColumnDictionary = Readonly<Record<string, AdminStatusEntry>>;
export type AdminStatusDictionary = Readonly<Record<string, AdminStatusColumnDictionary>>;

const PAYMENT_SUCCEEDED: AdminStatusEntry = { label: "결제 완료", tone: "success" };

/** `payments.status` 에서 "결제 완료" 로 정규화되는 동의어 — 사전과 테스트가 공유한다. */
export const PAYMENT_SUCCEEDED_SYNONYMS = ["succeeded", "paid", "success", "complete", "captured"] as const;

const DICTIONARY = {
  /** CHECK payments_status_check (baseline) — 10값. 성공 동의어 5종은 한 라벨. */
  "payments.status": {
    pending: { label: "결제 대기", tone: "warning" },
    processing: { label: "처리 중", tone: "info" },
    succeeded: PAYMENT_SUCCEEDED,
    paid: PAYMENT_SUCCEEDED,
    success: PAYMENT_SUCCEEDED,
    complete: PAYMENT_SUCCEEDED,
    captured: PAYMENT_SUCCEEDED,
    failed: { label: "결제 실패", tone: "danger" },
    canceled: { label: "결제 취소", tone: "neutral" },
    refunded: { label: "환불됨", tone: "neutral", risk: "high" },
  },

  /**
   * CHECK 없음 — 이 사전이 유일한 허용 목록(지시서 §3). 라벨은 멘토 승인 목록(M1·M2) 기준.
   * PR-2 정합(오너 확정): 재제출 요청 값은 코드가 실제로 쓰는 `under_review`(requestMentorDocumentsAction)다.
   * 데이터 정본이 추정으로 적었던 `resubmit_required` 는 이 컬럼에 쓰는 코드가 없어(학교 인증·학적 변경 테이블 전용 값) 제거했다.
   */
  "mentor_profiles.verification_status": {
    unsubmitted: { label: "미제출", tone: "neutral" },
    pending: { label: "승인 대기", tone: "warning" },
    under_review: { label: "재제출 요청", tone: "warning" },
    approved: { label: "승인 완료", tone: "success" },
    rejected: { label: "반려", tone: "danger", risk: "medium" },
  },

  /**
   * CHECK disputes_status_check (SQL 120) — 9값.
   * PR-6 후속(오너 확정): 라벨을 분쟁 화면 탭 표기와 통일 — 접수·진행→열림 · 에스컬레이션→상위 이관 · 종결→기각 · 7일/30일 정지→제재 7일/30일 ·
   * 영구 차단→영구 제재. 분쟁 탭은 이 사전 라벨을 그대로 파생한다. (`disputeLabels.ts` 는 PR-10 부터 이 사전에 위임한다)
   */
  "disputes.status": {
    open: { label: "열림", tone: "warning" },
    under_review: { label: "검토 중", tone: "info" },
    escalated: { label: "상위 이관", tone: "warning" },
    on_hold: { label: "보류", tone: "warning" },
    resolved: { label: "해결", tone: "success" },
    dismissed: { label: "기각", tone: "neutral" },
    sanction_7d: { label: "제재 7일", tone: "danger", risk: "medium" },
    sanction_30d: { label: "제재 30일", tone: "danger", risk: "medium" },
    sanction_permanent: { label: "영구 제재", tone: "danger", risk: "high" },
  },

  /** CHECK subscriptions_status_check (SQL 064) — 7값. 라벨은 subscriptionDisplay.ts 의 사용자 표기와 정합. */
  "subscriptions.status": {
    pending: { label: "결제 대기", tone: "warning" },
    active: { label: "이용 중", tone: "success" },
    past_due: { label: "결제 실패(연체)", tone: "danger" },
    cancel_scheduled: { label: "만료 예정", tone: "warning" },
    canceled: { label: "해지", tone: "neutral" },
    expired: { label: "만료", tone: "neutral" },
    refunded: { label: "환불 완료", tone: "neutral", risk: "high" },
  },

  /** CHECK refunds_status_check (baseline) — 4값. 라벨은 PR-3 환불 화면 지시서 §1(대기 · 완료 · 반려 · 취소). */
  "refunds.status": {
    pending: { label: "대기", tone: "warning" },
    succeeded: { label: "완료", tone: "success", risk: "high" },
    rejected: { label: "반려", tone: "danger", risk: "medium" },
    canceled: { label: "취소", tone: "neutral" },
  },

  /**
   * CHECK content_reports_status_allowed (SQL 120) — 7값.
   * PR-5 후속(오너 확정): 라벨을 콘텐츠 검수 화면 탭 표기와 통일 — 접수→대기 · 거절→반려 · 종결→기각. 탭은 이 사전 라벨을 그대로 쓴다.
   */
  "content_reports.status": {
    pending: { label: "대기", tone: "warning" },
    reviewing: { label: "검토 중", tone: "info" },
    resolved: { label: "해결", tone: "success" },
    rejected: { label: "반려", tone: "neutral" },
    dismissed: { label: "기각", tone: "neutral" },
    hidden: { label: "숨김 처리", tone: "warning" },
    removed: { label: "삭제 처리", tone: "danger", risk: "high" },
  },

  /** CHECK individual_questions_status_check (baseline) — 9값. */
  "individual_questions.status": {
    escrowed: { label: "예치 완료", tone: "info" },
    assigned: { label: "멘토 지정", tone: "info" },
    open: { label: "공개 모집", tone: "warning" },
    claimed: { label: "멘토 수락", tone: "info" },
    answered: { label: "답변 완료", tone: "success" },
    released: { label: "정산 완료", tone: "success", risk: "high" },
    expired: { label: "기간 만료", tone: "neutral" },
    refunded: { label: "환불 완료", tone: "neutral", risk: "high" },
    canceled: { label: "취소", tone: "neutral" },
  },

  /**
   * CHECK question_threads_status_check (baseline 032) — 6값. pending/answered/confirmed 가 현행 3단계, open/closed/archived 는 레거시 호환(컬럼 주석).
   * PR-8 등재 — 관리자 질문 드릴다운(멘토별 화면 질문 탭 · 질문 상세 요약)이 쓴다. 학생·멘토 화면 라벨(`questionThreadStatus.ts`)은 그대로 둔다.
   */
  "question_threads.status": {
    pending: { label: "답변 대기", tone: "warning" },
    answered: { label: "답변 완료", tone: "info" },
    confirmed: { label: "학생 확인", tone: "success" },
    open: { label: "열림", tone: "neutral" },
    closed: { label: "종료", tone: "neutral" },
    archived: { label: "보관", tone: "neutral" },
  },

  /** CHECK question_threads_mastery_status_check (baseline) — 4값. 학생 본인만 토글하는 숙달 상태. PR-8 등재(배지 — `unknown` 은 배지 없음). */
  "question_threads.mastery_status": {
    unknown: { label: "미판정", tone: "neutral" },
    wrong: { label: "오답", tone: "danger" },
    review: { label: "복습 필요", tone: "warning" },
    mastered: { label: "숙달", tone: "success" },
  },

  /**
   * CHECK 인라인(baseline 089 `status in (...)`) — 4값. 학적 변경 요청 화면(PR-5)의 탭 값과 1:1.
   * 재제출 값은 mentor_school_verifications 와 같은 `resubmit_required`(mentor_profiles 의 under_review 와 다르다).
   */
  "mentor_academic_record_change_requests.status": {
    pending: { label: "대기", tone: "warning" },
    approved: { label: "승인", tone: "success" },
    rejected: { label: "반려", tone: "danger", risk: "medium" },
    resubmit_required: { label: "재제출 요청", tone: "warning" },
  },

  /**
   * CHECK 없음(컬럼 `status`·`state`·`order_status`·`stage` 4종 동의어 — 데이터 정본 §8-3 정리 전) — **코드가 쓰는 값 8종만** 등재한다.
   * 집합은 관리자 집계(`countAdminCustomRequestOrdersByStatus`)·맞춤의뢰 주문 화면 탭과 같고, 라벨은 그 탭 표기 그대로.
   * 레거시 동의어(canceled·accepted·done·finished·closed·in_progress·submitted 등 — `orderLifecycleConstants.ts` 관용)는
   * 등재하지 않는다 → neutral 폴백. 기능이 열리고 정본 컬럼이 정해지면 그때 재검토한다.
   */
  "custom_request_orders.status": {
    pending: { label: "대기", tone: "warning" },
    open: { label: "작업 중", tone: "info" },
    delivered: { label: "납품 대기", tone: "warning" },
    revision_requested: { label: "수정 요청", tone: "warning" },
    completed: { label: "완료", tone: "success" },
    disputed: { label: "분쟁", tone: "danger", risk: "medium" },
    cancelled: { label: "취소", tone: "neutral" },
    refunded: { label: "환불", tone: "neutral", risk: "high" },
  },

  /** CHECK mentor_school_verifications_status_check (SQL 174) — 5값. 라벨은 AdminMentorApprovalWorkspace(M2). */
  "mentor_school_verifications.status": {
    pending: { label: "심사 대기", tone: "warning" },
    resubmit_required: { label: "재제출 요청", tone: "warning" },
    approved: { label: "승인 완료", tone: "success" },
    rejected: { label: "반려", tone: "danger" },
    superseded: { label: "대체됨", tone: "neutral" },
  },

  /**
   * CHECK mentor_school_verifications_school_tier_check (baseline · 079 로 '건동홍' 추가) — 6값.
   * 코드가 이미 한글 표기라 라벨 = 코드. 멘토 승인 작업대 ③ 학교 등급 드롭다운의 허용 목록(PR-2 §6).
   */
  "mentor_school_verifications.school_tier": {
    서연고: { label: "서연고", tone: "info" },
    서성한: { label: "서성한", tone: "info" },
    중경외시: { label: "중경외시", tone: "info" },
    건동홍: { label: "건동홍", tone: "info" },
    그외: { label: "그외", tone: "neutral" },
    미분류: { label: "미분류", tone: "neutral" },
  },

  /** CHECK mentor_school_verifications_verified_major_category_check (baseline 인라인) — 8값. 라벨 = 코드. */
  "mentor_school_verifications.verified_major_category": {
    메디컬: { label: "메디컬", tone: "neutral" },
    교육: { label: "교육", tone: "neutral" },
    인문: { label: "인문", tone: "neutral" },
    사회상경: { label: "사회상경", tone: "neutral" },
    자연: { label: "자연", tone: "neutral" },
    공학: { label: "공학", tone: "neutral" },
    예체능: { label: "예체능", tone: "neutral" },
    기타: { label: "기타", tone: "neutral" },
  },

  /** CHECK users_status_allowed (security_identity_profile_lockdown) — 4값. 라벨은 users/page.tsx(M16). */
  "users.status": {
    active: { label: "정상", tone: "success" },
    suspended: { label: "일시 정지", tone: "warning", risk: "medium" },
    banned: { label: "영구 차단", tone: "danger", risk: "high" },
    deleted: { label: "탈퇴", tone: "neutral", risk: "high" },
  },

  /** CHECK app_notices_type_allowed (baseline) — 4값. 라벨은 adminNoticesQueries.ts(NOTICE_TYPE_LABEL). */
  "app_notices.type": {
    notice: { label: "공지", tone: "info" },
    event: { label: "이벤트", tone: "success" },
    maintenance: { label: "점검", tone: "warning" },
    update: { label: "업데이트", tone: "neutral" },
  },

  /** CHECK app_notices_display_mode_allowed (20260830140804) — 2값. */
  "app_notices.display_mode": {
    page: { label: "목록 노출", tone: "neutral" },
    popup: { label: "팝업 노출", tone: "info" },
  },

  /**
   * CHECK 없음(baseline `target text null`) · 현행 행 전부 NULL. 구 코드는 자유 문자열 입력(`타겟/노출 화면(문자)`) 한 곳뿐이고 읽는 곳이 없었다
   * (PR-10 §1-1 확인) → PR-10 부터 공지 폼이 이 3값(노출 대상 역할)만 쓴다. **이 사전이 유일한 허용 목록**이다. NULL 은 `all` 로 읽는다
   * (`noticeConsole.resolveNoticeTarget`). PR-10b 팝업이 역할별 노출에 그대로 쓴다.
   */
  "app_notices.target": {
    all: { label: "전체", tone: "neutral" },
    student: { label: "학생", tone: "info" },
    mentor: { label: "멘토", tone: "success" },
  },

  /**
   * CHECK 인라인(20260830100100 paysync_invoices) — 4값. PR-9 충전 관리 탭·행 배지가 쓴다(대기 · 완료 · 만료 · 취소).
   * 08-04 인벤토리 이후(08-30) 신설 테이블 — 계약 테스트는 마이그레이션 SQL 로만 대조한다.
   */
  "paysync_invoices.status": {
    pending: { label: "대기", tone: "warning" },
    paid: { label: "완료", tone: "success", risk: "high" },
    expired: { label: "만료", tone: "neutral" },
    canceled: { label: "취소", tone: "neutral" },
  },

  /** CHECK payout_runs_status_check (baseline 106) — 2값. PR-9 정산 지급 이력 탭이 쓴다. */
  "payout_runs.status": {
    executing: { label: "실행 중", tone: "info" },
    completed: { label: "완료", tone: "success", risk: "high" },
  },

  /**
   * CHECK 없음(123_reviews_converge `moderation_state text not null default 'visible'`) — **이 사전이 유일한 허용 목록**이다.
   * 값 4종은 `adminReviewActions` 가 쓰는 것 전부(setModerationState visible·hidden·blinded + reviewDone enum reviewed). PR-11 리뷰 관리 등재.
   * 화면 표시는 `is_blinded` > `is_hidden` > `moderation_state` 순으로 접은 유효 상태(`reviewConsole.reviewEffectiveState`)에 이 라벨을 쓴다.
   */
  "reviews.moderation_state": {
    visible: { label: "공개", tone: "success" },
    hidden: { label: "숨김", tone: "warning" },
    blinded: { label: "블라인드", tone: "danger" },
    reviewed: { label: "검토 완료", tone: "info" },
  },

  /**
   * CHECK 2개의 교집합(037 `community_posts_status_chk` 3값 · 구 `community_posts_status_check` 4값 — `deleted` 는 3값 쪽이 막는다) — 3값.
   * 삭제됨은 status 가 아니라 `deleted_at IS NOT NULL`(147 soft-delete)로 판정한다. PR-11 커뮤니티 관리 등재.
   */
  "community_posts.status": {
    draft: { label: "임시", tone: "neutral" },
    published: { label: "게시", tone: "success" },
    hidden: { label: "숨김", tone: "warning" },
  },

  /** CHECK shortform_posts_status_chk (038) — 3값. 숏폼은 soft-delete 컬럼이 없다(관리자 삭제 = 하드 DELETE). */
  "shortform_posts.status": {
    draft: { label: "임시", tone: "neutral" },
    published: { label: "게시", tone: "success" },
    hidden: { label: "숨김", tone: "warning" },
  },

  /**
   * CHECK 2개의 교집합(016 `community_comments_status_chk` 2값 · 20260803 `community_comments_status_check` 3값 — `deleted` 는 2값 쪽이 막는다) — 2값.
   * 게시판 댓글 정본(`comments.is_deleted`)과 브리지(163·164)로 양방향 동기(visible ↔ false · hidden ↔ true).
   */
  "community_comments.status": {
    visible: { label: "게시", tone: "success" },
    hidden: { label: "숨김", tone: "warning" },
  },

  /**
   * CHECK account_deletion_jobs_state_check (151 create table 인라인 · 인벤토리 등재) — 9값. PR-13 탈퇴 요청 현황이 쓴다.
   * 사전 표기(지시서 §1-2): 대기 · 잠금 · 삭제 중 · 파일 삭제됨 · 마무리 · 인증 해제 · 완료 · 취소 · 실패.
   * 활성 6값(pending~auth_soft_deleted)은 `lib/account/accountDeletionJobStates.ts`(SQL 175 미러)와 같은 집합이다.
   */
  "account_deletion_jobs.state": {
    pending: { label: "대기", tone: "warning" },
    locked: { label: "잠금", tone: "info" },
    purging: { label: "삭제 중", tone: "info" },
    storage_purged: { label: "파일 삭제됨", tone: "info" },
    finalized: { label: "마무리", tone: "info" },
    auth_soft_deleted: { label: "인증 해제", tone: "info" },
    completed: { label: "완료", tone: "success", risk: "high" },
    canceled: { label: "취소", tone: "neutral" },
    failed: { label: "실패", tone: "danger" },
  },
} as const;

export type AdminStatusDictionaryKey = keyof typeof DICTIONARY;

export const ADMIN_STATUS_DICTIONARY: AdminStatusDictionary = DICTIONARY;

export const ADMIN_STATUS_DICTIONARY_KEYS: readonly AdminStatusDictionaryKey[] = Object.keys(
  DICTIONARY
) as AdminStatusDictionaryKey[];

/** 사전 키 형식 `table.column` */
export function adminStatusDictionaryKey(table: string, column: string): string {
  return `${String(table).trim()}.${String(column).trim()}`;
}

/** 해당 컬럼의 허용 값 목록(사전 순). 사전에 없는 컬럼이면 빈 배열. */
export function adminStatusAllowedValues(table: string, column: string): string[] {
  const col = ADMIN_STATUS_DICTIONARY[adminStatusDictionaryKey(table, column)];
  return col ? Object.keys(col) : [];
}

export type AdminStatusResolution = AdminStatusEntry & {
  /** 사전에 등재된 값이었는가 */
  known: boolean;
  /** 입력 원시 값(trim). 비어 있으면 "" */
  raw: string;
};

const EMPTY_LABEL = "—";

/**
 * 표시용 라벨·톤을 구한다. **절대 throw 하지 않는다.**
 * - 정확히 일치 → 그 항목 · 대소문자만 다르면 소문자로 재시도(예: "PENDING")
 * - 사전에 없는 값·모르는 컬럼 → neutral 톤 + 원시 값 그대로(비어 있으면 "—")
 */
export function resolveAdminStatus(table: string, column: string, value: unknown): AdminStatusResolution {
  const raw = value === null || value === undefined ? "" : String(value).trim();
  const col = ADMIN_STATUS_DICTIONARY[adminStatusDictionaryKey(table, column)];
  if (col && raw) {
    const exact = col[raw];
    if (exact) return { ...exact, known: true, raw };
    const lowered = col[raw.toLowerCase()];
    if (lowered) return { ...lowered, known: true, raw };
  }
  return { label: raw || EMPTY_LABEL, tone: "neutral", known: false, raw };
}
