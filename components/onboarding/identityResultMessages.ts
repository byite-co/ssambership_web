// S-C: 본인인증 결과 status/code → 온보딩 화면 안내 매핑 (클라이언트 안전 — 순수 데이터).
// 코드 원문은 서버(return HTML/postMessage)가 보내는 토큰만 — 개인정보 없음.

export type IdentityResultTone = "success" | "error" | "info";
export type IdentityResultAction = "retry" | "guardian" | "login_existing" | "none";

export type IdentityResultView = {
  tone: IdentityResultTone;
  title: string;
  description: string;
  action: IdentityResultAction;
};

const GENERIC_RETRY_DESCRIPTION =
  "본인 명의 휴대폰이 필요합니다. 통신사 정보를 확인한 뒤 잠시 후 다시 시도해 주세요.";

export function identityResultView(status: string | null, code: string | null): IdentityResultView | null {
  if (!status) return null;
  const c = code ?? "";

  if (status === "verified") {
    if (c === "GUARDIAN_REQUIRED") {
      return {
        tone: "info",
        title: "본인 인증이 완료되었어요",
        description: "만 14세 미만은 보호자(법정대리인) 인증까지 완료해야 이용할 수 있어요.",
        action: "guardian",
      };
    }
    return {
      tone: "success",
      title: "본인인증이 완료되었어요",
      description: "잠시 후 서비스로 이동합니다.",
      action: "none",
    };
  }

  if (status === "closed") {
    return {
      tone: "info",
      title: "인증이 취소되었어요",
      description: "인증 창이 닫혔어요. 다시 시도해 주세요.",
      action: "retry",
    };
  }

  if (status === "expired") {
    return {
      tone: "error",
      title: "인증 시간이 초과되었어요",
      description: "처음부터 다시 시도해 주세요.",
      action: "retry",
    };
  }

  if (status === "processing") {
    return {
      tone: "info",
      title: "인증 결과를 처리 중이에요",
      description: "잠시 후 화면을 새로고침해 상태를 확인해 주세요.",
      action: "retry",
    };
  }

  // status === "failed" (및 그 외)
  if (c === "DI_CONFLICT") {
    return {
      tone: "error",
      title: "이미 가입된 계정이 있어요",
      description:
        "같은 명의로 본인인증을 완료한 계정이 이미 있습니다. 기존 계정으로 로그인해 주세요. 이 계정으로는 가입을 진행할 수 없어요.",
      action: "login_existing",
    };
  }
  if (c === "GUARDIAN_NOT_ADULT") {
    return {
      tone: "error",
      title: "보호자는 만 19세 이상이어야 해요",
      description: "법정대리인(보호자) 본인 명의 휴대폰으로 다시 인증해 주세요.",
      action: "retry",
    };
  }
  if (c === "GUARDIAN_SELF") {
    return {
      tone: "error",
      title: "보호자 본인 명의로 인증해 주세요",
      description: "가입자 본인 명의 휴대폰으로는 보호자 인증을 진행할 수 없어요.",
      action: "retry",
    };
  }
  if (c === "GUARDIAN_NOT_APPLICABLE") {
    return {
      tone: "error",
      title: "보호자 인증 대상이 아니에요",
      description: "본인 인증부터 순서대로 진행해 주세요.",
      action: "retry",
    };
  }
  if (c === "STUCK_PROCESSING") {
    return {
      tone: "error",
      title: "인증 처리가 중단되었어요",
      description: "일시적인 오류로 처리가 끊겼어요. 다시 시도해 주세요.",
      action: "retry",
    };
  }
  return {
    tone: "error",
    title: "인증을 완료하지 못했어요",
    description: GENERIC_RETRY_DESCRIPTION,
    action: "retry",
  };
}

/** /api/identity/start 실패 응답(error 코드) → 안내 */
export function identityStartErrorView(errorCode: string | null, message: string | null): IdentityResultView {
  if (errorCode === "THROTTLED") {
    return {
      tone: "error",
      title: "인증 시도가 너무 잦아요",
      description: message ?? "10분 후 다시 시도해 주세요.",
      action: "none",
    };
  }
  if (errorCode === "ALREADY_VERIFIED" || errorCode === "SELF_ALREADY_VERIFIED") {
    return {
      tone: "success",
      title: "이미 인증이 완료되었어요",
      description: "화면을 새로고침해 주세요.",
      action: "none",
    };
  }
  return {
    tone: "error",
    title: "인증을 시작하지 못했어요",
    description: message ?? "본인인증 기관 연결에 실패했습니다. 잠시 후 다시 시도해 주세요.",
    action: "retry",
  };
}
