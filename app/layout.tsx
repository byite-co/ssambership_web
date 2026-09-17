import type { Metadata, Viewport } from "next";
import { Geist_Mono } from "next/font/google";
import GoogleTag from "@/components/analytics/GoogleTag";
import { siteUrl } from "@/lib/seo/siteUrl";
import "./globals.css";

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  // 상대 경로 canonical·OG 값을 절대 URL로 확정하기 위한 기준 origin
  metadataBase: new URL(siteUrl()),
  title: {
    default: "쌤버십",
    template: "%s | 쌤버십",
  },
  description:
    "쌤버십은 공부하다 막힌 문제를 대학생 멘토에게 질문하고, 멘토별 질문방에서 답변과 학습 관리를 이어받는 구독형 질문 멘토링 서비스입니다.",
  // canonical 은 의도적으로 루트에 두지 않는다.
  // Next.js 메타데이터는 하위 세그먼트가 alternates 를 선언하지 않으면 부모 값을 그대로
  // 물려주므로, 루트에 canonical: "/" 를 두면 /about·/legal/*·/mentors 등 사이트맵에 실은
  // 모든 URL 이 홈을 canonical 로 가리킨다(= 전부 홈의 중복으로 신고되어 색인에서 탈락).
  // 실측으로 확인한 동작이다. 페이지별 canonical 은 각 페이지가 직접 선언해야 하며,
  // 그 작업 전까지는 canonical 을 아예 내보내지 않는 편이 안전하다.
  // openGraph 는 사이트 공통 값(type · siteName · locale)만 둔다.
  // title · description · url 을 여기에 두면 하위 페이지가 openGraph 를 선언하지 않는 한
  // 이 객체가 통째로 상속되어, 모든 페이지의 og:title/og:description/og:url 이 홈 값으로
  // 고정된다(실측: /about 의 <title> 은 "서비스 소개 | 쌤버십" 인데 og:title 은 "쌤버십").
  // 세 키가 없으면 Next 가 각 페이지의 resolved title/description 으로 og 값을 채운다.
  openGraph: {
    type: "website",
    siteName: "쌤버십",
    locale: "ko_KR",
  },
};

export const viewport: Viewport = {
  themeColor: "#ffffff",
  colorScheme: "light",
  width: "device-width",
  initialScale: 1,
};

// <GoogleTag /> 는 Google Ads 기본 태그 — 운영 배포에서만 렌더(lib/analytics/googleTag.ts 게이트).
// 이 파일에서는 블록 주석(별표 닫힘 토큰)을 쓰지 않는다: seoRoutes 계약 테스트의 주석
// 제거기가 위 "/legal/*" 문자열을 블록 주석 시작으로 오인해 첫 닫힘 토큰까지 지워 버린다.
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ko"
      className={`${geistMono.variable} h-full antialiased scheme-light`}
      style={{ colorScheme: "light" }}
    >
      <body className="min-h-full flex flex-col">{children}</body>
      <GoogleTag />
    </html>
  );
}
