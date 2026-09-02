/**
 * 멘토 승인 작업대 — ① 신원 블록의 순수 판정(PR-2 §4).
 *
 * 가입 이름(`users.full_name`)과 본인인증 실명(`identity_verifications.verified_name`)을 나란히 놓고
 * 일치 여부를 판정한다. 상태는 다음 다섯 가지로 나눈다.
 *   match     — verified 행이 있고 공백 제거 후 이름이 같다(조용한 확인)
 *   mismatch  — verified 행이 있으나 이름이 다르다(위험색)
 *   pending   — verified 행은 없고, 30분 안의 pending/processing 행이 있다("인증 진행 중")
 *   lapsed    — 시도는 했으나 전부 실패·만료(또는 30분 넘긴 pending)
 *   none      — `identity_verifications` 행이 아예 없다("인증 시도 없음")
 *
 * 미인증(pending·lapsed·none)이어도 승인을 잠그지 않는다 — 경고 문장만 띄운다(§4).
 * 전화번호는 복호하지 않는다(lib/identity/encryption.ts: 평문·복호 결과를 밖으로 내보내지 않는다) —
 * 암호문 존재 여부만 "등록됨/미등록" 으로 표시한다.
 *
 * node --test 계약 테스트가 직접 import 하므로 React·`@/` import 를 두지 않는다.
 */

/** lib/identity/service.ts 의 PENDING_TTL_MS 와 같은 값 — 그 이후의 pending 은 return 조회 시 expired 로 전환된다. */
export const IDENTITY_PENDING_TTL_MS = 30 * 60_000;

export const IDENTITY_UNVERIFIED_WARNING = "본인인증이 완료되지 않았습니다 — 승인 후 인증 안내가 발송됩니다";

export type MentorIdentityRowLite = {
  kind?: string | null;
  status: string | null;
  verified_name: string | null;
  birthdate: string | null;
  verified_at: string | null;
  created_at: string | null;
  mobile_no_enc?: string | null;
};

export type MentorIdentityReviewKind = "match" | "mismatch" | "pending" | "lapsed" | "none";

export type MentorIdentityReview = {
  kind: MentorIdentityReviewKind;
  /** verified 행이 있는가(match·mismatch) */
  verified: boolean;
  registeredName: string;
  verifiedName: string | null;
  birthdate: string | null;
  verifiedAt: string | null;
  /** 암호문(mobile_no_enc)이 저장돼 있는가 — 평문은 다루지 않는다 */
  phoneRegistered: boolean;
  /** 판정에 쓴 최신 행의 status(진단용) */
  latestStatus: string | null;
};

export type MentorIdentityTone = "success" | "danger" | "warning" | "neutral";

/** 이름 비교 정규화 — NFKC + 모든 공백 제거. 대소문자는 그대로(한글 실명 비교). */
export function normalizeNameForMatch(value: string | null | undefined): string {
  return String(value ?? "").normalize("NFKC").replace(/\s+/g, "");
}

export function namesMatchIgnoringWhitespace(a: string | null | undefined, b: string | null | undefined): boolean {
  const na = normalizeNameForMatch(a);
  const nb = normalizeNameForMatch(b);
  return na.length > 0 && na === nb;
}

function timeOf(iso: string | null | undefined): number {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? 0 : t;
}

function isSelfRow(row: MentorIdentityRowLite): boolean {
  // kind 컬럼이 없던 시절 행(null)은 본인 인증으로 본다(20260821 마이그레이션 default 'self').
  return row.kind == null || row.kind === "self";
}

/**
 * 행 목록(한 멘토의 identity_verifications, kind 무관하게 넘겨도 됨) + 가입 이름 → 신원 판정.
 * `now` 는 pending 유효기간 판정용(테스트에서 고정).
 */
export function resolveMentorIdentityReview(
  rows: readonly MentorIdentityRowLite[],
  registeredName: string | null | undefined,
  now: number = Date.now()
): MentorIdentityReview {
  const self = rows.filter(isSelfRow);
  const registered = String(registeredName ?? "").trim();
  const phoneRegistered = self.some((r) => typeof r.mobile_no_enc === "string" && r.mobile_no_enc.trim().length > 0);

  const verifiedRows = self.filter((r) => r.status === "verified").sort((a, b) => timeOf(b.verified_at ?? b.created_at) - timeOf(a.verified_at ?? a.created_at));
  if (verifiedRows.length > 0) {
    const v = verifiedRows[0];
    const match = namesMatchIgnoringWhitespace(registered, v.verified_name);
    return {
      kind: match ? "match" : "mismatch",
      verified: true,
      registeredName: registered,
      verifiedName: v.verified_name?.trim() || null,
      birthdate: v.birthdate ?? null,
      verifiedAt: v.verified_at ?? null,
      phoneRegistered,
      latestStatus: "verified",
    };
  }

  const base = {
    verified: false as const,
    registeredName: registered,
    verifiedName: null,
    birthdate: null,
    verifiedAt: null,
    phoneRegistered,
  };

  if (self.length === 0) {
    return { ...base, kind: "none", latestStatus: null };
  }

  const latest = [...self].sort((a, b) => timeOf(b.created_at) - timeOf(a.created_at))[0];
  const inFlight = self.find(
    (r) => (r.status === "pending" || r.status === "processing") && now - timeOf(r.created_at) < IDENTITY_PENDING_TTL_MS
  );
  if (inFlight) {
    return { ...base, kind: "pending", latestStatus: inFlight.status };
  }
  return { ...base, kind: "lapsed", latestStatus: latest?.status ?? null };
}

/** ① 신원 블록의 일치 배지 라벨 */
export function identityReviewLabel(kind: MentorIdentityReviewKind): string {
  switch (kind) {
    case "match":
      return "일치";
    case "mismatch":
      return "불일치";
    case "pending":
      return "인증 진행 중";
    case "lapsed":
      return "인증 만료·실패";
    case "none":
    default:
      return "인증 시도 없음";
  }
}

/** 좌측 목록 행의 본인인증 배지(완료 / 진행 중 / 없음 · 만료) */
export function identityListBadgeLabel(kind: MentorIdentityReviewKind): string {
  switch (kind) {
    case "match":
    case "mismatch":
      return "인증 완료";
    case "pending":
      return "인증 진행 중";
    case "lapsed":
      return "인증 만료";
    case "none":
    default:
      return "인증 없음";
  }
}

export function identityReviewTone(kind: MentorIdentityReviewKind): MentorIdentityTone {
  switch (kind) {
    case "match":
      return "success";
    case "mismatch":
      return "danger";
    case "pending":
      return "warning";
    case "lapsed":
    case "none":
    default:
      return "neutral";
  }
}

/** 미인증(경고 배너·승인 모달 문장 대상)인가 */
export function isIdentityUnverified(kind: MentorIdentityReviewKind): boolean {
  return kind === "pending" || kind === "lapsed" || kind === "none";
}

/** 전화번호 표시 — 복호 없이 등록 여부만 */
export function identityPhoneDisplay(phoneRegistered: boolean): string {
  return phoneRegistered ? "등록됨" : "미등록";
}
