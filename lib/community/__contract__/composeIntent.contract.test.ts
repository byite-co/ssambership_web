// 계약 테스트: 작성기 intent 전달 — QA-A3(임시저장이 공개 발행됨) 회귀 방지.
//
// 근본 원인: 두 작성기 모두 "업로드(await) → requestSubmit 재진입" 2단계 제출을 쓰는데,
// await 사이 재렌더로 상단바 제출 버튼이 disabled 가 된다. HTML 의 entry list 구성은
// 비활성 컨트롤을 건너뛰므로 submitter 의 name=intent 값이 FormData 에 실리지 않고,
// 서버가 기본값 publish 로 떨어져 임시저장분이 공개된다. 이 테스트는 그 상황을
// FormData 수준에서 재현해 hidden 캡처가 의도를 보존하는지 고정한다.

import test from "node:test";
import assert from "node:assert/strict";
import { resolveComposeIntent } from "../composeIntent.ts";

/** 상단바 버튼이 disabled 라 entry list 에서 빠진 상태 — hidden 캡처만 남는다. */
function fdDisabledSubmitter(captured: string): FormData {
  const f = new FormData();
  f.append("title", "t");
  f.append("intent", captured); // 폼 안 hidden (disabled 될 수 없다)
  return f;
}

/** JS 비활성(점진 향상) — submitter 값이 먼저 오고 hidden 은 빈 값이다. */
function fdNoJs(submitter: string): FormData {
  const f = new FormData();
  f.append("intent", submitter); // 상단바 버튼(트리順 앞)
  f.append("title", "t");
  f.append("intent", ""); // 폼 안 hidden — 캡처 전이라 빈 값
  return f;
}

test("QA-A3: submitter 가 disabled 로 빠져도 hidden 캡처가 draft 를 지킨다", () => {
  const f = fdDisabledSubmitter("draft");
  assert.equal(resolveComposeIntent(f.getAll("intent")), "draft");
});

test("QA-A3 대조군: 캡처가 비어 있으면 publish 로 떨어진다(그게 결함의 모습이었다)", () => {
  const f = fdDisabledSubmitter("");
  assert.equal(resolveComposeIntent(f.getAll("intent")), "publish");
});

test("JS 비활성 경로: submitter draft + 빈 hidden → draft", () => {
  assert.equal(resolveComposeIntent(fdNoJs("draft").getAll("intent")), "draft");
});

test("JS 비활성 경로: submitter publish + 빈 hidden → publish", () => {
  assert.equal(resolveComposeIntent(fdNoJs("publish").getAll("intent")), "publish");
});

test("get() 단건 조회로는 못 지킨다 — getAll 첫 유효값 규칙이 필요한 이유", () => {
  // 구 서버 코드는 formData.get("intent") 를 썼다. JS 비활성 경로에서 hidden 이
  // 앞에 오도록 마크업이 바뀌기만 해도 빈 문자열을 집어 publish 로 떨어진다.
  const f = new FormData();
  f.append("intent", ""); // 빈 hidden 이 먼저
  f.append("intent", "draft"); // 실제 클릭 의도
  assert.equal(f.get("intent"), ""); // ← 구 방식이 보던 값
  assert.equal(resolveComposeIntent(f.getAll("intent")), "draft"); // ← 현행
});

test("미지값·비문자는 건너뛴다(방어)", () => {
  assert.equal(resolveComposeIntent(["DRAFT", new Blob(["x"]), null, "draft"]), "draft");
  assert.equal(resolveComposeIntent([]), "publish");
});
