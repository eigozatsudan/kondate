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
  {
    /*
     * プリミティブ経由を強制する（2026-08-08 UI/UX モダン化）。
     * 配色・余白・レイアウトは src/shared/ui のプリミティブが唯一の供給源。
     * 生ユーティリティ直書きを許すと二重スタイル系統が再拡大するため塞ぐ。
     * min-h-11 / min-w-11 は 44px 契約の実装なので禁止しない。
     * 例外リストはフェーズ移行が済んだディレクトリから順に削る。
     * フェーズ対象外（billing 等）は恒久除外として残す。
     */
    files: ["src/features/**/*.tsx"],
    ignores: [
      // Phase 3 で移行: 結果・詳細
      "src/features/menu-detail/**",
      "src/features/history/**",
      // 本プロジェクトのスコープ外（設計書 §1）。移行しないため恒久的に除外する。
      "src/features/billing/**",
      "src/features/landing/**",
      "src/features/welcome/**",
      "src/features/auth/**",
      "src/features/household/**",
      "src/features/privacy/**",
      "src/features/account/**",
      "src/features/emergency/**",
      "src/features/flyer/**",
      "src/features/shopping/**",
      "**/*.test.tsx",
    ],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          // 子孫セレクタ。> による直下限定だと className={"…"} や
          // 三項演算子の中の文字列が素通りする。
          selector:
            "JSXAttribute[name.name='className'] Literal[value=/(^|\\s)(bg-|text-(red|amber|green|blue|stone|slate|gray|zinc|neutral)-|text-(ink|ink-muted|white|black|canvas|line)(\\s|$)|border-(red|amber|green|blue|stone|slate|gray)-|flex(-|\\s|$)|grid(-|\\s|$)|grid-cols-|items-|justify-|gap-|space-[xy]-|w-[0-9]|rounded-|absolute(\\s|$)|fixed(\\s|$)|sticky(\\s|$)|p[xytblr]?-[0-9]|m[xytblr]?-[0-9])/]",
          message:
            "配色・余白・レイアウトは src/shared/ui のプリミティブ（Surface / Stack / Inset / Button / PageHeader）を使うこと。生 Tailwind ユーティリティの直書きは禁止（min-h-11 / min-w-11 は可）。",
        },
        {
          // テンプレートリテラル内の静的部分も同じ規則で塞ぐ。
          // Literal 側と禁止集合を揃える（border- / absolute / fixed / sticky の抜けを塞ぐ）。
          selector:
            "JSXAttribute[name.name='className'] TemplateElement[value.raw=/(^|\\s)(bg-|text-(red|amber|green|blue|stone|slate|gray|zinc|neutral)-|text-(ink|ink-muted|white|black|canvas|line)(\\s|$)|border-(red|amber|green|blue|stone|slate|gray)-|flex(-|\\s|$)|grid(-|\\s|$)|grid-cols-|items-|justify-|gap-|space-[xy]-|w-[0-9]|rounded-|absolute(\\s|$)|fixed(\\s|$)|sticky(\\s|$)|p[xytblr]?-[0-9]|m[xytblr]?-[0-9])/]",
          message:
            "配色・余白・レイアウトは src/shared/ui のプリミティブを使うこと。テンプレートリテラル内でも生 Tailwind ユーティリティは禁止。",
        },
      ],
    },
  },
);
