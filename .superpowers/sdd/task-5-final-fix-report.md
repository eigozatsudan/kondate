# Task 5 final fix report

Fixer: `/root/task5_final_fix`

独立VALID判定は行わず、`task-5-final-verification.md` の `T5-FFR-01`〜`04` をTDDで修正した。

## 変更パスと回帰テスト

- `T5-FFR-01`: `shared/safety/food-rules.ts`。肯定処理語を含む否定指示を矛盾として扱う。恒久テストは `shared/safety/food-rules.test.ts`。
- `T5-FFR-02`: `shared/safety/food-rules.ts`。年齢別ルールのstructured action本文に、UUIDで指す対象食材名を要求する。恒久テストは `shared/safety/food-rules.test.ts`。
- `T5-FFR-03`: `shared/safety/validate-generated-menu.ts`。`senior` も食品安全ルール完全性のfail-closed対象にする。恒久テストは `shared/safety/validate-generated-menu.test.ts`。
- `T5-FFR-04`: `shared/safety/medical-scope.ts`。高血圧向け減塩食を治療食依頼として検出する。集約境界の恒久テストは `shared/safety/validate-generated-menu.test.ts`。

## 修正前 raw evidence

```text
$ docker compose run --rm --no-deps app npx vitest run shared/safety/food-rules.test.ts shared/safety/validate-generated-menu.test.ts --reporter=verbose
× T5-FFR-01 rejects a negated required safety action
  → expected [] to deeply equal [ ObjectContaining{…} ]
× T5-FFR-02 rejects mitigation text that names a different ingredient
  → expected [] to deeply equal [ ObjectContaining{…} ]
× T5-FFR-03 rejects a senior safety context without applicable food rules
  → expected [ 'main_ingredient_missing' ] to deeply equal ArrayContaining{…}
× T5-FFR-04 rejects a hypertension therapeutic low-sodium request
  → expected true to be false
Test Files  2 failed (2)
Tests       4 failed | 30 passed (34)
exit code: 1
```

## 修正後 raw evidence

```text
$ docker compose run --rm --no-deps app npx vitest run shared/safety/food-rules.test.ts shared/safety/validate-generated-menu.test.ts --reporter=verbose
✓ T5-FFR-01 rejects a negated required safety action
✓ T5-FFR-02 rejects mitigation text that names a different ingredient
✓ T5-FFR-03 rejects a senior safety context without applicable food rules
✓ T5-FFR-04 rejects a hypertension therapeutic low-sodium request
Test Files  2 passed (2)
Tests       34 passed (34)
exit code: 0
```

## 回帰検証

```text
Task 5 suite: 7 files / 59 tests passed, exit 0
全Vitest: 39 files / 184 tests passed, exit 0
typecheck: exit 0
lint: exit 0（scope外の既存 react-refresh warning 4件）
対象5ファイル Prettier: exit 0
git diff --check: exit 0
```

## 未解決

- Mutable内の未解決事項はない。
- リポジトリ全体の `npm run format:check` は、Mutable外かつ未変更の `AGENTS.md` の既存不整形のみで exit 123。`AGENTS.md` は固定スコープに従い変更していない。
- lintの4 warningは `src/features/auth/auth-provider.tsx`、`src/features/household/allergy-editor.tsx`、`src/features/household/household-settings-page.tsx` にある既存 `react-refresh/only-export-components` warningで、いずれもMutable外。
