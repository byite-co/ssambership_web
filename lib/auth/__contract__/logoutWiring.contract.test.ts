import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

// D-13(F1) 정적 tripwire — 로그아웃 GET navigation 재발 방지(소스 스캔).
// 제품 코드(app/components/lib)에서 /logout 은 오직 LogoutButton 의
// <form method="post" action="/logout"> 로만 도달해야 한다.
// F1-R1: GET /logout 핸들러 자체가 존재하지 않는다(405).

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

function collectSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next" || entry === "__contract__" || entry.startsWith(".")) {
      continue;
    }
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...collectSourceFiles(p));
    else if (/\.(ts|tsx)$/.test(entry)) out.push(p);
  }
  return out;
}

function productFiles(): Array<{ rel: string; text: string }> {
  const files: Array<{ rel: string; text: string }> = [];
  for (const dir of ["app", "components", "lib"]) {
    for (const file of collectSourceFiles(join(ROOT, dir))) {
      files.push({ rel: relative(ROOT, file).replaceAll("\\", "/"), text: readFileSync(file, "utf8") });
    }
  }
  return files;
}

test("tripwire: /logout GET navigation 호출부 0건 (Link/anchor/router/window)", () => {
  const FORBIDDEN: Array<{ name: string; re: RegExp }> = [
    { name: 'href="/logout"', re: /href\s*=\s*["'`]\/logout["'`]/ },
    { name: "href={…/logout}", re: /href\s*=\s*\{[^}]*\/logout/ },
    { name: 'router.push("/logout")', re: /router\.push\(\s*["'`]\/logout/ },
    { name: 'router.replace("/logout")', re: /router\.replace\(\s*["'`]\/logout/ },
    { name: 'window.location…"/logout"', re: /location\.(?:assign|replace|href)[(\s=]+["'`]\/logout/ },
    { name: 'redirect("/logout")', re: /redirect\(\s*["'`]\/logout/ },
    { name: 'fetch GET "/logout"', re: /fetch\(\s*["'`]\/logout["'`]\s*\)/ },
  ];
  const offenders: string[] = [];
  for (const { rel, text } of productFiles()) {
    for (const f of FORBIDDEN) {
      if (f.re.test(text)) offenders.push(`${rel}: ${f.name}`);
    }
  }
  assert.deepEqual(offenders, [], `GET /logout 재발 경로 발견:\n${offenders.join("\n")}`);
});

test("F1-R1: app/logout/route.ts 는 GET 을 export 하지 않고 POST 만 export 한다", () => {
  const route = read("app/logout/route.ts");
  assert.ok(!/export\s+(?:async\s+)?function\s+GET\b/.test(route), "GET handler 가 부활함");
  assert.ok(!/export\s+const\s+GET\b/.test(route), "GET handler(const) 가 부활함");
  assert.ok(/export\s+async\s+function\s+POST\b/.test(route), "POST handler 부재");
  assert.ok(route.includes("handleLogoutPost"), "정본 core(handleLogoutPost) 미사용");
});

test("tripwire: 어떤 route GET handler 도 signOut 을 호출하지 않는다", () => {
  const offenders: string[] = [];
  for (const { rel, text } of productFiles()) {
    if (!rel.endsWith("/route.ts") && !rel.endsWith("/route.tsx")) continue;
    if (!/export\s+(?:async\s+)?function\s+GET\b|export\s+const\s+GET\b/.test(text)) continue;
    if (text.includes("signOut")) offenders.push(rel);
  }
  assert.deepEqual(offenders, [], `GET handler 내부 signOut 발견: ${offenders.join(", ")}`);
});

test("정본 배선: 로그아웃 UI 는 전부 LogoutButton(POST form) 을 사용한다", () => {
  const button = read("components/auth/LogoutButton.tsx");
  assert.ok(/action\s*=\s*["']\/logout["']/.test(button), 'form action="/logout" 부재');
  assert.ok(/method\s*=\s*["']post["']/i.test(button), 'form method="post" 부재');
  assert.ok(/type\s*=\s*["']submit["']/.test(button), "submit 버튼 부재");

  const CALLERS = [
    "components/shell/ShellMobileNavMenu.tsx",
    "components/shell/ShellHeaderActions.tsx",
    "components/landing/LandingTopNav.tsx",
    "components/admin/AdminConsoleNav.tsx",
    "components/admin/AdminConsoleTopBar.tsx",
  ];
  for (const rel of CALLERS) {
    assert.ok(read(rel).includes("components/auth/LogoutButton"), `${rel} 이 LogoutButton 을 사용하지 않음`);
  }
});
