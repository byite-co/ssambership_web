import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { CANONICAL_SITE_ORIGIN, normalizeSiteOrigin, siteUrl } from "../siteUrl.ts";
import { PUBLIC_SITEMAP_ROUTES, buildPublicSitemapUrls } from "../publicRoutes.ts";

// ─────────────────────────────────────────────────────────────────────────────
// 네이버 서치어드바이저 SEO 계약 회귀 감시
//
// 배경 1 — 도메인 일치:
//   서치어드바이저는 "등록한 사이트 URL"과 robots.txt·sitemap.xml 이 알리는 URL 이
//   정확히 같아야 소유확인·수집이 유지된다. 우리 정본은 apex(https://ssambership.com)
//   하나뿐이고 www 는 금지다. 배포 환경변수(NEXT_PUBLIC_SITE_URL)에 www 나 후행
//   슬래시가 섞여 들어와도 출력은 apex 로 고정돼야 하므로, 정규화 함수와 사이트맵
//   URL 생성 결과를 함께 묶어 감시한다.
//
// 배경 2 — robots 접두사 매칭 함정:
//   robots.txt 의 Disallow 는 접두사 매칭이다. 멘토 콘솔을 막으려고 "/mentor" 를
//   적으면 공개 페이지인 멘토 찾기 "/mentors" 까지 통째로 색인에서 사라진다.
//   반드시 후행 슬래시를 붙인 "/mentor/" 여야 한다. 이 함정은 사람 눈으로 diff 를
//   봐도 잘 안 보여서, 아래 4번 테스트가 일반화된 형태(어떤 disallow 항목도 공개
//   사이트맵 경로를 접두사로 막지 않는다)로 상시 감시한다.
//
// 실행: node --test --experimental-strip-types "lib/**/__contract__/*.contract.test.ts"
//   → 번들러가 없으므로 "@/" 별칭을 쓸 수 없다. 같은 이유로 next 타입에 의존하는
//     app/robots.ts · app/sitemap.ts 는 import 하지 않고 소스 텍스트로 정적 검증한다.
// ─────────────────────────────────────────────────────────────────────────────

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const APP_DIR = join(REPO_ROOT, "app");
const ROBOTS_PATH = join(REPO_ROOT, "app", "robots.ts");
const SITEMAP_PATH = join(REPO_ROOT, "app", "sitemap.ts");

/** 사이트맵에 절대 들어와서는 안 되는 라우트그룹(로그인·권한 전용 표면). */
const PRIVATE_ROUTE_GROUPS = ["(admin)", "(mentor)", "(student)"] as const;

/** 지시서 확정값 — 멘토 상세·커뮤니티 상세는 색인하지 않는다. */
const INDEX_FLAGS = ["INDEX_MENTOR_DETAIL", "INDEX_COMMUNITY_POST"] as const;

/** 주석을 줄 구조 보존한 채 공백화한다(문자열 안의 `//` 도 지워지는 러프 러너 — 정적 검사 전용). */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/\/\/[^\n]*/g, (m) => " ".repeat(m.length));
}

/** import 선언을 제거한다 — 모듈 경로("@/lib/community/...")가 라우트 문자열로 오검출되는 것을 막는다. */
function stripImports(src: string): string {
  return src.replace(/import[\s\S]*?from\s*["'][^"']+["']\s*;?/g, "");
}

function readSource(path: string): string {
  assert.ok(existsSync(path), `${path} 가 없다 — SEO 라우트 계약의 검사 대상 파일이다`);
  return readFileSync(path, "utf8");
}

/**
 * app/ 를 재귀 walk 해 page.tsx 를 모으고, 라우트그룹 `(...)` 세그먼트를 제거한
 * 실제 라우트 경로 → 파일 경로(저장소 상대, `/` 구분자) 배열 맵을 만든다.
 * app/page.tsx 는 "/" 로 매핑된다.
 */
function buildRouteMap(): Map<string, string[]> {
  const map = new Map<string, string[]>();

  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const child = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(child);
        continue;
      }
      if (entry.name !== "page.tsx") continue;

      const relFile = child.slice(REPO_ROOT.length).split("\\").join("/");
      const segments = child
        .slice(APP_DIR.length + 1)
        .split(/[\\/]/)
        .slice(0, -1) // page.tsx 자신 제거
        .filter((seg) => !(seg.startsWith("(") && seg.endsWith(")"))); // 라우트그룹은 URL 에 없다
      const route = segments.length === 0 ? "/" : `/${segments.join("/")}`;

      const bucket = map.get(route);
      if (bucket) bucket.push(relFile);
      else map.set(route, [relFile]);
    }
  };

  walk(APP_DIR);
  return map;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. 사이트맵 경로 실재 검증
// ─────────────────────────────────────────────────────────────────────────────

test("PUBLIC_SITEMAP_ROUTES 18개는 전부 실재하는 app/**/page.tsx 라우트다 — 오타·삭제된 경로를 사이트맵에 남기면 수집기가 404 만 긁어간다", () => {
  assert.equal(
    PUBLIC_SITEMAP_ROUTES.length,
    18,
    `공개 사이트맵 경로는 18개로 확정됐다(현재 ${PUBLIC_SITEMAP_ROUTES.length}개) — 개수를 바꾸려면 지시서·이 계약을 함께 갱신하라`,
  );

  for (const route of PUBLIC_SITEMAP_ROUTES) {
    assert.ok(route.startsWith("/"), `사이트맵 경로는 선행 슬래시를 포함해야 한다: ${JSON.stringify(route)}`);
  }

  const routeMap = buildRouteMap();
  const missing = PUBLIC_SITEMAP_ROUTES.filter((route) => !routeMap.has(route));
  assert.deepEqual(
    missing,
    [],
    "실제 page.tsx 가 없는 사이트맵 경로 — 경로 오타이거나 라우트가 삭제됐다:\n" +
      missing.map((r) => `  ${r}`).join("\n"),
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. 비공개 라우트그룹 혼입 차단
// ─────────────────────────────────────────────────────────────────────────────

test("PUBLIC_SITEMAP_ROUTES 에 (admin)·(mentor)·(student) 라우트그룹 경로가 하나도 없다 — 로그인 전용 화면을 색인시키면 빈 페이지·리다이렉트만 노출된다", () => {
  const routeMap = buildRouteMap();
  const offenders: string[] = [];

  for (const route of PUBLIC_SITEMAP_ROUTES) {
    for (const file of routeMap.get(route) ?? []) {
      const group = PRIVATE_ROUTE_GROUPS.find((g) => file.includes(`/${g}/`));
      if (group) offenders.push(`${route} → ${file} (${group})`);
    }
  }

  assert.deepEqual(
    offenders,
    [],
    "비공개 라우트그룹 소속 경로가 공개 사이트맵에 섞였다:\n" + offenders.map((o) => `  ${o}`).join("\n"),
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. 오리진 정규화(www·후행 슬래시 제거, localhost 보존)
// ─────────────────────────────────────────────────────────────────────────────

test("normalizeSiteOrigin()·siteUrl() 은 www·후행 슬래시를 떼고 apex 로 수렴한다 — 서치어드바이저 등록 도메인과 한 글자라도 다르면 소유확인이 깨진다", () => {
  assert.equal(CANONICAL_SITE_ORIGIN, "https://ssambership.com", "정본 오리진은 apex 고정값이다");

  assert.equal(normalizeSiteOrigin("https://www.ssambership.com/"), CANONICAL_SITE_ORIGIN, "www + 후행 슬래시 → apex");
  assert.equal(normalizeSiteOrigin("https://www.ssambership.com"), CANONICAL_SITE_ORIGIN, "www → apex");
  assert.equal(normalizeSiteOrigin("https://ssambership.com/"), CANONICAL_SITE_ORIGIN, "후행 슬래시 제거");
  assert.equal(normalizeSiteOrigin(undefined), CANONICAL_SITE_ORIGIN, "미설정이면 정본 apex 폴백");
  assert.equal(normalizeSiteOrigin(null), CANONICAL_SITE_ORIGIN, "null 이면 정본 apex 폴백");
  assert.equal(normalizeSiteOrigin(""), CANONICAL_SITE_ORIGIN, "빈 문자열이면 정본 apex 폴백");

  // 로컬 개발 오리진은 보존해야 한다 — 여기서까지 apex 로 덮으면 개발 서버의 절대 URL 이 깨진다.
  const local = normalizeSiteOrigin("http://localhost:3000");
  assert.ok(local.includes("localhost:3000"), `localhost 오리진이 보존되지 않았다: ${local}`);
  assert.notEqual(local, CANONICAL_SITE_ORIGIN, "localhost 를 운영 apex 로 덮으면 안 된다");
  assert.ok(!local.endsWith("/"), `정규화 결과에 후행 슬래시가 남았다: ${local}`);

  // siteUrl() 은 모듈 로드 시점이 아니라 호출 시점에 env 를 읽어야 한다
  // (빌드 캐시된 상수로 굳으면 배포 환경변수 교정이 반영되지 않는다).
  const original = process.env.NEXT_PUBLIC_SITE_URL;
  try {
    process.env.NEXT_PUBLIC_SITE_URL = "https://www.ssambership.com/";
    assert.equal(siteUrl(), CANONICAL_SITE_ORIGIN, "env 의 www 오리진을 apex 로 정규화해야 한다");

    process.env.NEXT_PUBLIC_SITE_URL = "";
    assert.equal(siteUrl(), CANONICAL_SITE_ORIGIN, "env 가 비면 정본 apex 폴백");
  } finally {
    if (original === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
    else process.env.NEXT_PUBLIC_SITE_URL = original;
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. robots.ts disallow 회귀 방지
//
//    Disallow 는 접두사 매칭이다. "/mentor" 한 글자(후행 슬래시) 차이로 공개 페이지
//    "/mentors"(멘토 찾기)까지 수집 금지가 되어 유입 경로가 통째로 사라진다.
//    그래서 "/mentor/" 존재 + "/mentor" 부재를 못박고, 나아가 어떤 disallow 항목도
//    공개 사이트맵 경로를 접두사로 삼키지 않는지 일반화해 감시한다.
// ─────────────────────────────────────────────────────────────────────────────

test("app/robots.ts 의 disallow 는 '/mentor/'(후행 슬래시)를 쓰고 '/mentor' 를 쓰지 않는다 — 접두사 매칭으로 공개 페이지 '/mentors' 까지 막히는 사고 방지", () => {
  const robotsSrc = stripComments(readSource(ROBOTS_PATH));

  const blocks = [...robotsSrc.matchAll(/disallow\s*:\s*\[([\s\S]*?)\]/g)];
  assert.ok(blocks.length > 0, "app/robots.ts 에서 disallow 배열 리터럴을 찾지 못했다 — 배열 형태를 유지하라");

  const disallow: string[] = [];
  for (const block of blocks) {
    for (const literal of (block[1] ?? "").matchAll(/"([^"]*)"|'([^']*)'/g)) {
      const value = literal[1] ?? literal[2] ?? "";
      if (value.length > 0) disallow.push(value);
    }
  }
  assert.ok(disallow.length > 0, "disallow 배열이 비어 있다 — 콘솔·API 경로 차단이 사라졌다");

  assert.ok(disallow.includes("/mentor/"), `disallow 에 "/mentor/" 가 없다 — 멘토 콘솔이 수집 대상이 된다: ${disallow.join(", ")}`);
  assert.ok(
    !disallow.includes("/mentor"),
    'disallow 에 "/mentor"(후행 슬래시 없음)가 들어왔다 — 접두사 매칭으로 공개 페이지 "/mentors" 까지 차단된다',
  );

  // 일반화된 회귀 감시: 어떤 disallow 항목도 공개 사이트맵 경로를 접두사로 막으면 안 된다.
  // (사이트맵에 실어 보내면서 robots 로 막는 자기모순 = 서치어드바이저 수집 오류로 직결)
  const conflicts: string[] = [];
  for (const rule of disallow) {
    for (const route of PUBLIC_SITEMAP_ROUTES) {
      if (route === rule || route.startsWith(rule)) conflicts.push(`disallow ${JSON.stringify(rule)} → ${route}`);
    }
  }
  assert.deepEqual(
    conflicts,
    [],
    "robots 가 공개 사이트맵 경로를 차단한다(사이트맵과 robots 의 자기모순):\n" +
      conflicts.map((c) => `  ${c}`).join("\n"),
  );

  const sitemapField = /sitemap\s*:\s*(?:\[\s*)?(["'`])([\s\S]*?)\1/.exec(robotsSrc);
  assert.ok(sitemapField, "app/robots.ts 에 sitemap 필드가 없다 — 수집기에 사이트맵 위치를 알릴 수 없다");
  assert.ok(
    (sitemapField[2] ?? "").endsWith("/sitemap.xml"),
    `robots 의 sitemap 값이 "/sitemap.xml" 로 끝나지 않는다: ${sitemapField[2]}`,
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. 사이트맵 URL 의 apex 고정 + app/sitemap.ts 와의 정적 결합
// ─────────────────────────────────────────────────────────────────────────────

test("사이트맵 URL 은 전부 apex 로 나가고 app/sitemap.ts 는 경로를 자체 하드코딩하지 않는다 — www 혼재·중복 정의는 도메인 소유확인과 색인을 동시에 망친다", () => {
  const urls = buildPublicSitemapUrls(CANONICAL_SITE_ORIGIN);
  assert.equal(urls.length, 18, `사이트맵 URL 은 18개여야 한다(현재 ${urls.length}개)`);
  for (const url of urls) {
    assert.ok(url.startsWith(CANONICAL_SITE_ORIGIN), `apex 로 시작하지 않는 사이트맵 URL: ${url}`);
    assert.ok(!url.includes("www."), `사이트맵 URL 에 www 가 섞였다: ${url}`);
  }

  // env 가 www 로 잘못 설정돼도 실제 출력 경로(siteUrl → buildPublicSitemapUrls)는 apex 여야 한다.
  const original = process.env.NEXT_PUBLIC_SITE_URL;
  try {
    process.env.NEXT_PUBLIC_SITE_URL = "https://www.ssambership.com";
    for (const url of buildPublicSitemapUrls(siteUrl())) {
      assert.ok(url.startsWith(CANONICAL_SITE_ORIGIN), `env 가 www 일 때 apex 로 정규화되지 않았다: ${url}`);
      assert.ok(!url.includes("www."), `env 가 www 일 때 www 가 그대로 새어나갔다: ${url}`);
    }
  } finally {
    if (original === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
    else process.env.NEXT_PUBLIC_SITE_URL = original;
  }

  // 정적 결합 검사: 위 함수 검증이 실제 sitemap.xml 출력에 대한 검증이 되려면,
  // app/sitemap.ts 가 반드시 buildPublicSitemapUrls·siteUrl 을 경유해야 한다.
  const sitemapRaw = readSource(SITEMAP_PATH);
  const sitemapSrc = stripComments(sitemapRaw);

  assert.match(
    sitemapSrc,
    /import\s*{[^}]*\bbuildPublicSitemapUrls\b[^}]*}\s*from\s*["'][^"']*publicRoutes["']/,
    "app/sitemap.ts 가 lib/seo/publicRoutes 의 buildPublicSitemapUrls 를 import 하지 않는다",
  );
  assert.match(sitemapSrc, /\bbuildPublicSitemapUrls\s*\(/, "app/sitemap.ts 가 buildPublicSitemapUrls 를 호출하지 않는다");
  assert.match(
    sitemapSrc,
    /import\s*{[^}]*\bsiteUrl\b[^}]*}\s*from\s*["'][^"']*siteUrl["']/,
    "app/sitemap.ts 가 lib/seo/siteUrl 의 siteUrl 을 import 하지 않는다",
  );
  assert.match(sitemapSrc, /\bsiteUrl\s*\(/, "app/sitemap.ts 가 siteUrl() 을 호출하지 않는다 — 오리진이 하드코딩됐을 수 있다");

  // 경로 목록의 정본은 PUBLIC_SITEMAP_ROUTES 하나뿐이다(2중 정의 = 조용한 불일치).
  const sitemapBody = stripImports(sitemapSrc);
  const hardcoded = PUBLIC_SITEMAP_ROUTES.filter((route) => route !== "/" && sitemapBody.includes(route));
  assert.deepEqual(
    hardcoded,
    [],
    "app/sitemap.ts 가 라우트 경로를 직접 하드코딩했다 — 정본은 PUBLIC_SITEMAP_ROUTES 이며 여기서는 참조만 하라:\n" +
      hardcoded.map((r) => `  ${r}`).join("\n"),
  );

  // 확정값: 멘토 상세·커뮤니티 상세는 색인하지 않는다(false 고정).
  const seoSources = [SITEMAP_PATH, ROBOTS_PATH, join(REPO_ROOT, "lib", "seo", "publicRoutes.ts")]
    .filter((p) => existsSync(p))
    .map((p) => stripComments(readFileSync(p, "utf8")))
    .join("\n");

  for (const flag of INDEX_FLAGS) {
    assert.match(
      seoSources,
      new RegExp(`${flag}\\s*(?::[^=\\n]+)?=\\s*false\\b`),
      `${flag} 가 false 로 선언돼 있지 않다 — 상세 페이지 색인은 확정 금지값이다`,
    );
    assert.doesNotMatch(
      seoSources,
      new RegExp(`${flag}\\s*(?::[^=\\n]+)?=\\s*true\\b`),
      `${flag} 가 true 로 뒤집혔다 — 확정값 위반`,
    );
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. robots.ts 오리진의 siteUrl() 결합
//
//    5번이 sitemap.ts 에 대해 거는 결합 검사와 짝을 이룬다. 이 검사가 없으면
//    robots.ts 의 sitemap 필드를 "https://www.ssambership.com/sitemap.xml" 로
//    하드코딩해도 1~5번이 전부 통과한다 — 정규화 안전장치를 우회한 www 유출이
//    계약을 초록불로 통과하는 구멍이었다.
// ─────────────────────────────────────────────────────────────────────────────

test("app/robots.ts 는 오리진을 siteUrl() 로만 얻는다 — 하드코딩된 www·프리뷰 도메인이 sitemap 필드로 새는 것을 막는다", () => {
  const robotsSrc = stripComments(readSource(ROBOTS_PATH));

  assert.match(
    robotsSrc,
    /import\s*{[^}]*\bsiteUrl\b[^}]*}\s*from\s*["'][^"']*siteUrl["']/,
    "app/robots.ts 가 lib/seo/siteUrl 의 siteUrl 을 import 하지 않는다",
  );
  assert.match(robotsSrc, /\bsiteUrl\s*\(/, "app/robots.ts 가 siteUrl() 을 호출하지 않는다 — 오리진이 하드코딩됐을 수 있다");

  // 소스 어디에도 리터럴 호스트가 박혀 있으면 안 된다(오리진 계산의 단일 정본은 siteUrl 뿐).
  assert.doesNotMatch(robotsSrc, /www\./, "app/robots.ts 에 www 리터럴이 있다 — 네이버 도메인 검증에 걸린다");
  assert.doesNotMatch(
    robotsSrc,
    /["'`]https?:\/\/[^"'`]+/,
    "app/robots.ts 에 절대 URL 리터럴이 있다 — 오리진은 siteUrl() 하나로만 얻어야 한다",
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. 사이트맵 경로 중복 차단
//
//    개수 단언(20)만으로는 "한 경로를 복붙 중복시키고 다른 경로를 떨어뜨리는" 편집을
//    잡지 못한다. 개수는 그대로라 1·5번이 통과하고, 사이트맵은 중복 URL 을 제출하면서
//    한 페이지를 조용히 잃는다.
// ─────────────────────────────────────────────────────────────────────────────

test("PUBLIC_SITEMAP_ROUTES 에 중복 경로가 없다 — 개수만 맞고 한 경로가 조용히 사라지는 편집을 잡는다", () => {
  const duplicates = PUBLIC_SITEMAP_ROUTES.filter((route, i) => PUBLIC_SITEMAP_ROUTES.indexOf(route) !== i);
  assert.deepEqual(duplicates, [], `중복된 사이트맵 경로: ${duplicates.join(", ")}`);

  const urls = buildPublicSitemapUrls(CANONICAL_SITE_ORIGIN);
  assert.equal(new Set(urls).size, urls.length, "생성된 사이트맵 URL 에 중복이 있다");
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. 상세 라우트 noindex 의 실제 집행
//
//    5번의 INDEX_* 플래그 검사는 sitemap.ts 안의 "동작 없는 상수" 를 볼 뿐이다.
//    확정값(INDEX_MENTOR_DETAIL=false / INDEX_COMMUNITY_POST=false)을 실제로 집행하는
//    것은 아래 4개 상세 페이지의 meta robots 이므로, 그쪽을 직접 감시한다.
//    (지우면 5번은 여전히 통과한다 — 그 구멍을 메우는 테스트다.)
//
//    follow 는 true 여야 한다: 색인만 막고 링크 추적은 허용해 목록 페이지의 크롤 경로가
//    끊기지 않게 한다. 기존 app/dev/design-system 등의 follow: false 와 다른 값이다.
// ─────────────────────────────────────────────────────────────────────────────

const NOINDEX_DETAIL_PAGES = [
  "app/(public)/mentors/[mentorId]/page.tsx",
  "app/(public)/community/board/[id]/page.tsx",
  "app/(public)/community/shortform/[id]/page.tsx",
] as const;
// app/(public)/community/shorts/[id]/page.tsx 는 의도적으로 제외한다 — permanentRedirect 로
// 308 을 반환해 HTML <head> 자체가 없으므로 meta robots 가 전송되지 않는다(죽은 선언).
// 색인 차단의 실효는 목적지 /community/shortform/[id] 의 noindex 가 진다.

test("멘토 상세·커뮤니티 상세 4개 라우트는 robots noindex(follow: true)를 선언한다 — 확정값 INDEX_* = false 를 실제로 집행하는 유일한 지점이다", () => {
  for (const rel of NOINDEX_DETAIL_PAGES) {
    const src = stripComments(readSource(join(REPO_ROOT, rel)));

    assert.match(
      src,
      /robots\s*:\s*{[^}]*\bindex\s*:\s*false\b/,
      `${rel} 에 robots.index=false 선언이 없다 — 상세 페이지가 색인 대상이 된다`,
    );
    assert.match(
      src,
      /robots\s*:\s*{[^}]*\bfollow\s*:\s*true\b/,
      `${rel} 의 robots.follow 가 true 가 아니다 — 목록 페이지의 크롤 경로가 끊긴다`,
    );
  }

  // 상세 라우트는 사이트맵에도 들어 있으면 안 된다(제출과 noindex 의 자기모순).
  const detailRoutes = ["/mentors/[mentorId]", "/community/board/[id]", "/community/shortform/[id]", "/community/shorts/[id]"];
  for (const route of detailRoutes) {
    assert.ok(!PUBLIC_SITEMAP_ROUTES.includes(route), `noindex 라우트가 사이트맵에 실렸다: ${route}`);
  }
  for (const route of PUBLIC_SITEMAP_ROUTES) {
    assert.ok(!route.includes("["), `사이트맵에 동적 세그먼트 경로가 섞였다: ${route}`);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. 리다이렉트 전용 스텁의 사이트맵 혼입 차단
//
//    1번의 "실재 검증" 은 page.tsx 파일 존재만 본다. 그래서 본문 없이 redirect()·
//    permanentRedirect() 만 하는 스텁도 실재 페이지로 통과시켰다 — 실제로 초판에는
//    /pricing(→ /mentors, 307)과 /community/shorts(→ /community/shortform, 308)가
//    사이트맵에 실려 있었고, 두 목적지는 같은 사이트맵 안에 이미 있었다.
//    서치어드바이저·GSC 는 이런 URL 을 "리다이렉트된 페이지" 로 수집 제외 처리한다.
//    두 경로는 제거했고, 아래 테스트가 같은 회귀의 재발을 막는다.
// ─────────────────────────────────────────────────────────────────────────────

test("사이트맵 경로의 page.tsx 는 리다이렉트 전용 스텁이 아니다 — 200 이 아닌 URL 을 제출하면 '리다이렉트된 페이지' 로 수집 제외된다", () => {
  const routeMap = buildRouteMap();
  const offenders: string[] = [];

  for (const route of PUBLIC_SITEMAP_ROUTES) {
    for (const file of routeMap.get(route) ?? []) {
      const src = stripComments(readSource(join(REPO_ROOT, file)));
      const hit = /\b(?:permanentRedirect|redirect)\s*\(/.exec(src);
      if (hit) offenders.push(`${route} → ${file} (${hit[0].trim()})`);
    }
  }

  assert.deepEqual(
    offenders,
    [],
    "리다이렉트 전용 스텁이 사이트맵에 섞였다 — 목적지 경로만 제출하라:\n" +
      offenders.map((o) => `  ${o}`).join("\n"),
  );
});
