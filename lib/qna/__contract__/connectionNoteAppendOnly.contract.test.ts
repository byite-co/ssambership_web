// 계약 테스트: 연결노트는 작성·목록만 — 수정·삭제 UI·서버 액션 폐기(웹 PR-2 §5-1 · 설계상 폐기).
// 실행: node --test --experimental-strip-types lib/qna/__contract__/connectionNoteAppendOnly.contract.test.ts
//
// 정책(cn_update · cn_delete)은 DB-6 이 걷는다 — 여기서는 웹 표면(패널·액션)의 재등장만 막는다.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

test("연결노트 수정·삭제 서버 액션 0 · 작성(saveConnectionNote) 경로는 유지", () => {
  const actions = read("lib/qna/questionRoomActions.ts");
  assert.ok(!actions.includes("export async function updateConnectionNoteAction"), "updateConnectionNoteAction 재등장");
  assert.ok(!actions.includes("export async function deleteConnectionNoteAction"), "deleteConnectionNoteAction 재등장");
  assert.ok(!/from\(["']connection_notes["']\)[\s\S]{0,120}?\.(update|delete)\(/.test(actions), "connection_notes 직접 UPDATE/DELETE 재등장");
  assert.ok(actions.includes("saveConnectionNote"), "작성 경로가 사라짐");
});

test("패널: 수정 폼·삭제 버튼 0 · 작성 모달·'내 노트 있으면 추가 버튼 숨김' 유지", () => {
  const panel = read("components/qna/ConnectionNotesPanel.tsx");
  for (const forbidden of ["updateConnectionNoteAction", "deleteConnectionNoteAction", "Pencil", "Trash2", "window.confirm", "editingId", "editable:"]) {
    assert.ok(!panel.includes(forbidden), `수정·삭제 UI 잔재: ${forbidden}`);
  }
  assert.ok(panel.includes("QuestionRoomNewNoteModal"), "작성 모달이 사라짐");
  assert.ok(panel.includes("const canAdd = opts.viewerRole === opts.side && opts.cards.length === 0;"), "내 노트가 있으면 추가 버튼 숨김 규칙이 사라짐");
});
