import eslint from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "dist",
      ".netlify",
      "coverage",
      "playwright-report",
      "test-results",
      "infra/supabase",
      ".worktrees",
      "src/shared/types/database.generated.ts",
      "eslint.config.js",
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    files: ["**/*.{js,mjs}", "**/*.d.mts"],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unsafe-assignment": "error",
      "@typescript-eslint/no-unsafe-return": "error",
    },
  },
  {
    files: ["**/*.test.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-non-null-assertion": "off",
    },
  },
  {
    // browser は safety 本体（allergens / fingerprint / hard gate）をバンドルしない。
    // pure UX 前チェックのみ @shared/safety-pure/* を許可（CLAUDE.md ownership）。
    // emergency 評価モジュール（filter / idea-context / fixtures / share-*）も禁止し
    // contracts のみ許可（S15: 間接 safety 引き込み DiD）。
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@shared/safety", "@shared/safety/*"],
              message:
                "Browser must import pure modules from @shared/safety-pure/* only; @shared/safety/* is Functions-oriented.",
            },
            {
              group: ["@shared/emergency/*", "!@shared/emergency/contracts"],
              message:
                "Browser must import @shared/emergency/contracts only; evaluation modules (filter-emergency-menus, idea-context, fixtures, share-*) are Functions-oriented.",
            },
          ],
        },
      ],
    },
  },
);
