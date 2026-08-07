import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
function read(rel: string): string {
  return readFileSync(ROOT + rel, "utf-8");
}

/**
 * D-QR-1: 오답 플래그 라우트는 살아 있으나 이를 렌더하는 UI 는 의도적으로 미연결이다
 * (컴포넌트·API·DB 는 추후 멘토용으로 보존, 렌더 진입점만 제거 — QuestionRoomStudentDesignWorkspace 주석 참조).
 *
 * 검증되지 않은 잠복 표면이 조용히 되살아나거나 사라지지 않도록 계약으로 고정한다:
 *  1) 라우트 PATCH 핸들러는 존재해야 한다(외부 계약 유지 — 임의 제거 방지).
 *  2) 학생/멘토 세션 재검증(actor 게이트)이 라우트에 남아 있어야 한다.
 *  3) 토글 컴포넌트를 렌더하는 import 진입점은 0 이어야 한다(UI 미연결 계약).
 *     이 값이 0 이 아니게 되면 그것은 '의도된 되살림' 이며 이 테스트를 함께 갱신해야 한다.
 */

const ROUTE = "app/api/question-room/threads/[threadId]/wrong-answer/route.ts";

test("D-QR-1: wrong-answer 라우트 PATCH 핸들러 + actor 게이트 유지", () => {
  const src = read(ROUTE);
  assert.ok(/export\s+async\s+function\s+PATCH\s*\(/.test(src), "PATCH 핸들러가 있어야 한다");
  assert.ok(/session\.actor\s*!==\s*["']student["']/.test(src), "학생 전용 actor 게이트가 있어야 한다");
});

function walk(relDir: string): string[] {
  const out: string[] = [];
  let entries: import("node:fs").Dirent[];
  try {
    entries = readdirSync(ROOT + relDir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const rel = `${relDir}/${e.name}`;
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === ".next") continue;
      out.push(...walk(rel));
    } else if (/\.(ts|tsx)$/.test(e.name)) {
      out.push(rel);
    }
  }
  return out;
}

test("D-QR-1: QuestionThreadWrongAnswerToggle 를 렌더하는 활성 import 진입점은 0", () => {
  const files = [...walk("components"), ...walk("app")];
  const activeImporters: string[] = [];
  for (const rel of files) {
    if (rel.endsWith("QuestionThreadWrongAnswerToggle.tsx")) continue; // 정의 파일 자체 제외
    const src = read(rel);
    for (const line of src.split("\n")) {
      if (!line.includes("QuestionThreadWrongAnswerToggle")) continue;
      // 주석 라인은 미연결(비활성) 상태를 뜻하므로 활성 import 로 세지 않는다.
      const trimmed = line.trim();
      if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) continue;
      if (/import\b/.test(line)) activeImporters.push(`${rel}: ${trimmed}`);
    }
  }
  assert.deepEqual(
    activeImporters,
    [],
    `오답 토글이 다시 렌더에 연결됐다(의도된 되살림이면 이 계약을 갱신하라):\n${activeImporters.join("\n")}`
  );
});
