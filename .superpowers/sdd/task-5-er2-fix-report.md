# Task 5 ER2 修正レポート

日付: 2026-07-15  
対象: T5-ER2-01 / T5-ER2-02

## 決定

Task 10 が固定する `underSixHardBeanAndNutContext()` の単一ルール fixture と、軟らかい豆製品5件の aggregate 成功条件を優先した。純粋 validator から年齢帯別の食品ルールID網羅 hardcoding を削除した一方、登録アレルゲン辞書の完全性検証と、渡された食品ルールの版整合性検証は維持した。

本番カタログの網羅性は Task 8 の `netlify/functions/_shared/current-safety.ts` DB loader で fail closed に保証する。Task 8 は今回の変更範囲外のため編集しておらず、後続の Task 8 brief/report/ledger で loader の完全性検証を明記・実装する必要がある。

## TDD 証跡

- RED: `docker compose run --rm --no-deps app npx vitest run shared/safety/food-rules.test.ts shared/safety/validate-generated-menu.test.ts --reporter=verbose`
  - T5-ER2-01 で不一致 action が受理され、軟らかい豆製品5件が `safety_context_incomplete` で拒否された（35 passed / 6 failed）。
- 追加 RED: adaptation が別食材を対象にするケースを単独実行し、現状の誤受理を確認した（1 failed）。
- GREEN: 同じ focused 実行で 42 passed。

## 修正内容

- required household constraint の action instruction と recipe/adaptation evidence の双方が、`ingredientId` に対応する食材名を含むことを要求した。
- 純粋 validator の年齢帯別必須食品ルールID一覧を撤去し、Task 10 exact fixture の aggregate matrix を恒久テスト化した。
- 旧 completeness テストは、引き続き純粋 validator が責務を持つ mixed-version 拒否テストへ整理した。

## 検証

- Task 5 focused Vitest: 68 passed
- 全 Vitest: 193 passed
- TypeScript typecheck: exit 0
- ESLint: exit 0（既存の Fast Refresh warning 4件、error 0）
- 対象 Prettier と `git diff --check`: 最終確認をコミット前に実施

