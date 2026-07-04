/**
 * 의존 그래프 기준선 설정 (모듈화 기획서 Phase 0)
 *
 * 현 단계는 "측정"만 한다 — 순환(no-circular)을 info 심각도로 나열해
 * docs/architecture/dep-baseline.json 스냅샷의 근거를 만든다.
 * 계층 규칙·예외 원장·admin 클라이언트 허용목록·동결 파일 이동 감지는
 * Phase 2(경계 강제 배선)에서 이 파일에 추가된다. 그 전까지 어떤 규칙도
 * error 심각도를 갖지 않는다(빌드·CI 비차단).
 */
module.exports = {
  forbidden: [
    {
      name: "no-circular",
      comment:
        "순환 의존 측정용(기준선). Phase 2에서 예외 원장 등재분 외 신규 순환을 error로 승격 예정.",
      severity: "info",
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.json" },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default", "types"],
      mainFields: ["module", "main", "types", "typings"],
    },
  },
};
