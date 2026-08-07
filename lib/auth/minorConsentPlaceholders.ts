export const MINOR_GUARDIAN_CONSENT_TYPE = "minor_guardian_consent" as const;
export const MINOR_CONSENT_VERSION = "legal-placeholder-2026-06-20" as const;

export const MINOR_CONSENT_COPY = {
  title: "보호자 동의 필요",
  description:
    "만 14세 미만 가입자는 법정대리인 동의가 필요합니다. 아래 문구와 본인확인 방식은 법무 확정 후 교체됩니다.",
  checkboxLabel: "법정대리인에게 가입 및 개인정보 처리 동의를 받았습니다.",
  requiredError: "만 14세 미만 가입자는 보호자 동의가 필요합니다.",
  legalSlotLabel: "법무 확정 대기 항목",
  legalSlots: [
    "보호자 동의 고지 문구",
    "보호자 신원확인 방식",
    "동의 항목 및 버전 문구",
  ],
} as const;

export const MINOR_CONSENT_VERIFICATION_METHOD_PLACEHOLDER = "legal_review_pending" as const;

/**
 * D-AU-9: 법정대리인 본인확인(휴대폰/아이핀 등) 연동 전까지는 만 14세 미만 가입을 **차단**한다.
 * 체크박스 하나로 게이트를 여는 placeholder 동의로는 개인정보보호법상 법정대리인 동의를
 * 실질적으로 검증할 수 없어(사후 감사 근거로 쓸 수 없음), 가장 보수적으로 가입 자체를 막는다.
 */
export const MINOR_SIGNUP_BLOCKED_MESSAGE =
  "만 14세 미만은 현재 가입할 수 없습니다. 법정대리인 본인확인 절차 준비가 끝나면 다시 안내드리겠습니다." as const;

export const MINOR_SIGNUP_BLOCKED_COPY = {
  eyebrow: "04 · 보호자 동의",
  title: "만 14세 미만 가입 제한",
  description:
    "법정대리인 동의는 본인확인을 거쳐야 유효합니다. 현재 본인확인 절차 준비 중이라, 만 14세 미만은 가입을 진행할 수 없습니다.",
  guidance: "보호자(법정대리인) 계정으로 이용하시거나, 만 14세 이상이 되면 다시 시도해 주세요.",
} as const;