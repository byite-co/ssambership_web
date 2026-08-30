import type { NextConfig } from "next";

/**
 * Server Actions CSRF 오리진 허용 목록 — **개발 환경 전용**.
 *
 * 문제: Codespaces 포트 포워딩으로 공개 URL(`<name>-<port>.app.github.dev`)에 접속하면
 *   프록시가 `x-forwarded-host` 는 공개 도메인으로, `origin` 은 `localhost:<port>` 로
 *   보낸다. Next 는 Server Action 요청에서 두 값이 일치하는지 검사해 CSRF 를 막으므로
 *   (기본값: 동일 오리진만 허용) 폼 제출이 "Invalid Server Actions request" 로 거부된다.
 *   폼 구현 문제가 아니라 프록시가 헤더를 갈아끼우는 개발 환경 고유 현상이다.
 *
 * 운영(Vercel)에 영향이 없는 이유:
 *   1. 이 목록은 `NODE_ENV !== "production"` 이고 `CODESPACES === "true"` 일 때만 채워진다.
 *      운영 빌드에서는 `allowedOrigins` 키 자체가 설정되지 않아 Next 기본값(동일 오리진만)
 *      그대로다 — 허용 범위가 넓어지지 않는다.
 *   2. 값의 출처가 Codespaces 전용 env(`CODESPACE_NAME`,
 *      `GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN`)라 Vercel 런타임에는 존재하지도 않는다.
 *   3. Vercel 은 배포 도메인으로 직접 서빙하므로 브라우저 `origin` 과 `x-forwarded-host`
 *      가 같은 도메인이다 — 애초에 이 불일치가 발생하지 않는다.
 */
function devServerActionOrigins(): string[] {
  if (process.env.NODE_ENV === "production") return [];
  if (process.env.CODESPACES !== "true") return [];

  const name = process.env.CODESPACE_NAME;
  const domain = process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN;
  const port = process.env.PORT ?? "3000";

  const origins = new Set<string>([
    // 프록시가 실제로 보내는 origin 값(위 로그 실측: `localhost:3000`).
    `localhost:${port}`,
    `127.0.0.1:${port}`,
  ]);
  if (name && domain) {
    // 공개 URL 로 직접 오는 경우(프록시 설정이 바뀌어 origin 이 공개 도메인일 때) 대비.
    origins.add(`${name}-${port}.${domain}`);
  }
  return [...origins];
}

const devOrigins = devServerActionOrigins();

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      /** 맞춤의뢰 납품 파일(최대 20MB) — Server Action FormData */
      bodySizeLimit: "25mb",
      // 운영에서는 이 키가 아예 붙지 않는다(빈 배열이면 스프레드 결과가 없음).
      ...(devOrigins.length > 0 ? { allowedOrigins: devOrigins } : {}),
    },
  },
};

export default nextConfig;
