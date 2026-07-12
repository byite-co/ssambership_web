import { FREE_QUESTION_PER_MENTOR_LIMIT, FREE_QUESTION_TOTAL_LIMIT } from "@/lib/mentor/freeQuestionPolicy";
export type AuthLoginRole = "student" | "mentor";

export const loginLandingCopy: Record<
  AuthLoginRole,
  {
    badge: string;
    title: string;
    line1: string;
    line1Mobile: string;
    line2: string;
    benefits: { line1: string; line2: string }[];
    signupCta: string;
    ctaLabel: string;
    loginPath: string;
  }
> = {
  student: {
    badge: "질문하고 배우는 학생이신가요?",
    title: "학생 로그인",
    line1: "멘토와 질문·학습을 이어가는 학생을 위한 화면으로 들어가요.",
    line1Mobile: "학생용 화면으로 들어가요.",
    line2: "이어서 화면에서 이메일·비밀번호로 로그인할 수 있어요.",
    benefits: [
      { line1: `가입 시 무료 질문권 ${FREE_QUESTION_TOTAL_LIMIT}장`, line2: "제공" },
      { line1: "무료 질문은 한 멘토당", line2: `최대 ${FREE_QUESTION_PER_MENTOR_LIMIT}개` },
      { line1: "여러 멘토에게", line2: "나눠서 사용 가능" },
    ],
    signupCta: "학생 회원가입",
    ctaLabel: "학생으로 로그인",
    loginPath: "/login/student",
  },
  mentor: {
    badge: "답하고 성장하는 멘토이신가요?",
    title: "멘토 로그인",
    line1: "질문방·콘텐츠·정산까지 멘토 활동을 이어갈 수 있어요.",
    line1Mobile: "멘토 활동을 시작해요.",
    line2: "이어서 화면에서 이메일·비밀번호로 로그인할 수 있어요.",
    benefits: [
      { line1: "질문방 관리 및", line2: "답변 작성" },
      { line1: "연결노트·콘텐츠", line2: "작성 및 업로드" },
      { line1: "정산 확인 및", line2: "수익 관리" },
    ],
    signupCta: "멘토 회원가입",
    ctaLabel: "멘토로 로그인",
    loginPath: "/login/mentor",
  },
};

export const loginFormHeadline: Record<AuthLoginRole, { title: string; description: string }> = {
  student: {
    title: "학생 로그인",
    description: "가입하신 이메일과 비밀번호를 입력해 주세요.",
  },
  mentor: {
    title: "멘토 로그인",
    description: "멘토 프로필과 연동된 이메일·비밀번호로 계속하세요.",
  },
};
