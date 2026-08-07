// 작성기(게시판·숏폼) 공용 intent 계약 — 순수 모듈(node/브라우저/테스트 공용).
//
// 왜 별도 모듈인가:
//   두 작성기 모두 "업로드(await) → requestSubmit 재진입 → 네이티브 제출"의 2단계 제출을 쓴다.
//   그런데 await 사이에 React 가 busy=true 로 재렌더하면서 상단바의 제출 버튼이
//   `disabled` 가 된다. HTML 의 entry list 구성은 **비활성 컨트롤을 건너뛰므로**,
//   requestSubmit(submitter) 로 그 버튼을 넘겨도 name=intent 값이 FormData 에 실리지 않는다.
//   그러면 서버가 기본값 publish 로 떨어져 **임시저장이 공개 발행된다**(QA-A3).
//
//   → 해결: 최초 submit 시점의 intent 를 폼 안의 hidden input 에 박아둔다. hidden 은
//     disabled 가 되지 않으므로 항상 실린다. 다만 JS 비활성(점진 향상) 경로에서는
//     hidden 이 빈 값이고 submitter 값만 오므로, 서버는 **getAll 의 첫 유효값**을 취한다.
//     빈 문자열·비문자는 건너뛰므로 두 경로 어느 쪽이든 실제 클릭 의도가 보존된다.

export type ComposeIntent = "draft" | "publish";

/**
 * `formData.getAll("intent")` 값들 중 첫 번째 유효값("draft"|"publish")을 채택한다.
 * 유효값이 하나도 없으면 publish(기존 기본값 유지).
 */
export function resolveComposeIntent(values: unknown[]): ComposeIntent {
  for (const v of values) {
    if (v === "draft" || v === "publish") return v;
  }
  return "publish";
}
