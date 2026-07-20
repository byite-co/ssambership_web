import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // node:test 계약 테스트(.ts 확장자 import·strip-types 전용) — 앱 린트 대상 아님.
    "**/__contract__/**",
  ]),
  // 의도적 미사용 심볼 컨벤션 — `_` 접두는 "의도적으로 안 씀" 표기(rest 제외 destructure·자리표시 인자 등).
  // 규칙 완화가 아니라 typescript-eslint 표준 컨벤션 채택(실수 미사용은 여전히 경고).
  {
    name: "unused-vars-underscore-convention",
    files: ["**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],
    },
  },
  // 모듈 경계 규칙 (모듈 등기부: docs/architecture/modules.md §5–6)
  // 개발 중 즉시 피드백용 warn — 기계 강제는 dependency-cruiser(Phase 2)가 담당.
  {
    name: "module-boundaries",
    files: ["app/**/*.{ts,tsx}", "components/**/*.{ts,tsx}", "lib/**/*.{ts,tsx}"],
    ignores: ["components/qna/FormSubmitButton.tsx"],
    rules: {
      "no-restricted-imports": [
        "warn",
        {
          paths: [
            {
              name: "@/components/qna/FormSubmitButton",
              importNames: ["FormSubmitButton"],
              message:
                "구경로 심(deprecated)입니다. @/components/common/FormSubmitButton 에서 import하세요.",
            },
          ],
          patterns: [
            {
              group: ["@/lib/*/internal/*", "@/components/*/internal/*"],
              message:
                "타 모듈의 internal/ 딥 import는 금지입니다. 모듈 공개 표면(폴더 최상위 파일)을 사용하세요.",
            },
          ],
        },
      ],
    },
  },
]);

export default eslintConfig;
