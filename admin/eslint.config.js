/**
 * admin パッケージ専用 ESLint flat config。
 * ルート eslint は admin/** を ignore するため、ここは独立して npm run lint する。
 * 依存は eslint 同梱の @eslint/js と globals のみ（typescript-eslint 無しの最小構成）。
 * TS は構文をパースできないため lint 対象外とし、型は tsc (typecheck) に委ねる。
 */
import js from "@eslint/js";
import globals from "globals";

export default [
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "coverage/**",
      // TypeScript は typecheck で担保。parser 追加なしの最小 config。
      "**/*.{ts,tsx}",
    ],
  },
  {
    files: ["**/*.{js,mjs,cjs}"],
    ...js.configs.recommended,
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        ...globals.node,
      },
    },
  },
];
