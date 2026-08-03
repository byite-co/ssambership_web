/**
 * 회사·서비스 공통 정보 (약관·개인정보처리방침·환불정책·푸터·고객센터 단일 소스).
 * 명시 의무가 없는 항목(대표자명·주소·전화번호·통신판매업 신고번호·개인정보 보호책임자)은
 * 운영사 방침에 따라 표기하지 않는다.
 */

/** 사업자등록번호 — 환경변수로 override 가능, 기본값은 실번호. */
export const BUSINESS_NO = (process.env.NEXT_PUBLIC_BUSINESS_NO ?? "320-86-03865").trim();

export const COMPANY = {
  /** 상호 */
  name: "(주)바이트",
  /** 서비스명 */
  serviceName: "쌤버십",
  /** 업종 (정보통신업 — 통신판매업 아님) */
  industry: "정보통신업",
  /** 고객센터·개인정보 문의 이메일 (단일 창구) */
  contactEmail: "hello@byite.co.kr",
  /** 고객센터 운영 시간 */
  supportHours: "평일 10:00–18:00 (주말·공휴일 제외)",
  /** 정책 시행일 */
  effectiveDate: "2026년 7월 12일",
} as const;

/**
 * 개인정보처리방침 개정판 시행일 — 방침만 독립적으로 개정하므로
 * COMPANY.effectiveDate(다른 법률 문서 공용)와 분리한다.
 */
export const PRIVACY_EFFECTIVE_DATE = "2026년 8월 10일";
/** 개인정보처리방침 개정 공지일 */
export const PRIVACY_ANNOUNCED_DATE = "2026년 8월 3일";

/** 개인정보 처리위탁 업체 (개인정보처리방침 위탁 고지용) */
export const PROCESSORS: ReadonlyArray<{ name: string; purpose: string }> = [
  { name: "토스페이먼츠(주) (㈜비바리퍼블리카)", purpose: "신용카드·간편결제 등 결제 처리 및 결제 도용 방지" },
  { name: "Supabase, Inc.", purpose: "서비스 운영을 위한 클라우드 인프라·데이터베이스·파일 저장" },
];
