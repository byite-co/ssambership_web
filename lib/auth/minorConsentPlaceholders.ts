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
 * S-C: D-AU-9 원천 차단 해제 — NICE 본인인증(보호자 체인) 연동으로 만 14세 미만 가입을
 * 다시 허용한다. 가입 시점에는 동의를 받지 않고(placeholder 체크박스 게이트 폐지 유지),
 * 가입 직후 온보딩에서 본인 인증 → 보호자(법정대리인) 휴대폰 본인인증 순으로 동의를
 * 검증·기록한다(user_consent_records — 실질 검증 가능한 사후 감사 근거).
 * 보호자 인증 완료 전까지는 identity 게이트가 서비스 이용을 막는다.
 */
export const MINOR_CONSENT_VERIFICATION_METHOD_NICE_CHAIN = "nice_guardian_chain_post_signup" as const;

export const MINOR_SIGNUP_GUARDIAN_CHAIN_COPY = {
  eyebrow: "04 · 보호자 동의",
  title: "만 14세 미만은 가입 후 보호자 인증이 필요해요",
  description:
    "법정대리인 동의는 보호자 휴대폰 본인인증으로 확인해요. 가입을 마친 뒤 본인 인증 → 보호자 인증 순서로 안내해 드려요.",
  guidance: "보호자 인증이 완료될 때까지 서비스 이용이 제한돼요. 보호자(법정대리인)님과 함께 진행해 주세요.",
} as const;