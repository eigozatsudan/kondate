# Plan 2 readiness remediation 引継ぎプロンプト

以下を新しいエージェントへの最初のプロンプトとして渡してください。

---

GitHubのremoteブランチ `origin/fix/plan2-readiness-remediation` を取得し、そのブランチの作業を再開してください。旧環境のworktreeや絶対パスが存在することを前提にしないでください。

リポジトリ:

```text
git@github.com:eigozatsudan/kondate.git
```

新規cloneから始める場合:

```bash
git clone git@github.com:eigozatsudan/kondate.git
cd kondate
git fetch origin fix/plan2-readiness-remediation
git switch --track origin/fix/plan2-readiness-remediation
```

既存cloneを使う場合:

```bash
git fetch origin fix/plan2-readiness-remediation
git switch fix/plan2-readiness-remediation
```

ローカルブランチがまだない場合は、最後のコマンドの代わりに次を実行してください。

```bash
git switch --track origin/fix/plan2-readiness-remediation
```

取得後、必ず次を確認してください。

```bash
git branch --show-current
git status --short
git log -3 --oneline
```

## 最初に読むもの

1. リポジトリの `AGENTS.md`（特にDocker実行、Taskごとのレビュー、最終検証順序）
2. `docs/superpowers/plans/2026-07-16-plan2-readiness-remediation.md`
3. この引継ぎ文書

使用ブランチは `fix/plan2-readiness-remediation`、実装ベースは
`6de9b97bc8c0b8c266b197de9abe4f5a1687796a` です。

## 最重要の注意

- 旧環境には `docs/superpowers/plans/2026-07-11-kondate-mvp-02-menu-domain-pantry.md` のユーザー所有未コミット変更がありましたが、remoteにはpushされていません。新環境でその差分を再作成しないでください。既存clone側に同じローカル変更がある場合は、編集・stage・commitせず保護してください。
- この引継ぎ文書の直前のcommit `4b3a2b6 test: 安全判定の残存境界を再現` は、意図的に3件のREDテストをコミットした地点です。production修正はまだありません。
- Node/npm/Vitest/Prettier等は必ずDocker経由で実行してください。コマンドは結合せず1回1コマンドです。
- 各指摘は一次レビューとは別のエージェントで再現・検証済みです。TDDで直し、修正後は別エージェントのfresh adversarial reviewを行ってください。

## 現在のRED（まずここから再開）

実行コマンド:

```bash
docker compose run --rm --no-deps app npx vitest run shared/safety/food-rules.test.ts
```

現状は `167 tests / 164 pass / 3 fail` です。失敗はすべて意図した回帰テストです。

1. `具体魚語 たい を同音異義の加工食品 めんたいこ へ適用しない`
   - `めんたいこ` が具体魚term `たい` の任意中間substringに一致し、`required_safety_action` と `age_shape_rule` を誤発火します。
   - 元レビューの `明太子` 例は読み仮名変換されないためREJECTEDです。直す対象は自然なひらがな表記 `めんたいこ` です。
   - `たい焼き` / `さけるチーズ` の個別除外追加を続けるのではなく、具体魚名のingredient境界を構造化してください。
   - `たい` / `さけ` / `鯛` / `サケ`、`真鯛`、`塩鮭`、`たらの切り身`、切り身・フィレ形は維持します。

2. `必須工程ルールは実食材へ結び付かない説明文中の魚語同音表現を無視する`
   - ごはん・にんじんだけの料理説明 `温かいうちに食べたい` がterm `たい` に一致し、骨ルールの `age_shape_rule` を誤発火します。
   - `requires_tag` の非ingredient sourceだけ、specific termなら同じ料理の実ingredientへ同termで結合できる場合、generic termなら同一ruleの具体ingredient候補へ展開できる場合に限定してください。
   - `forbidden` ruleの料理名・工程本文検出まで同じfilterで弱めるとfail-openになるため、変更対象を分離してください。

3. `安全な全称工程と別食材の局所的な逆状態を対象食材の矛盾として混同しない`
   - `すべての食材は小さく切る。にんじんは丸ごと盛り付ける` で、後半はにんじんだけの逆状態なのに、ぶどうへ `safety_action_contradiction` が4件転嫁されます。
   - 現在はsource全体で `hasUniversalIngredientScope(source.text)` と `hasActionContradiction(source.text, kind)` を独立評価しています。
   - 全称scopeと非否定の逆状態occurrenceが同じ文・同じ局所節にある場合だけ、料理内全ingredientへ展開してください。
   - 危険な対照 `すべての食材は丸ごと盛り付ける` は引き続き矛盾にし、名前付き別食材の矛盾は他食材へ転嫁しないでください。

## 直前までに完了したこと

- Task 1: medical request textを全planner項目で共通投影し、serverの空文字fail-openを修正。
- Task 2: current-safety RPC統合、骨リスクcatalog具体魚追加、安全actionのsource/dish/ingredient/member結合、否定・疑問・矛盾・全称・ownerless・generic魚境界を多数TDD修正。現在は上記3 REDのみが残っています。
- Task 3: current-safety snapshotの決定的順序を含め完了。
- Task 4: draft conflictを自動解除せず、明示的な「最新の下書きを読み込む」操作とreset tokenで解決。進行中生成もAbort。
- Task 5: 緊急献立遷移前flush、pending排他、cache同期、old/new revision競合、member safety再取得中止、client/server件数契約、E2E保存待機を修正。`68026fc` 後のclosure reviewは `NO NEW CANDIDATES`。

主な後半コミット:

```text
68026fc fix: 緊急献立遷移の競合条件を強化
3a6f132 fix: 安全工程の食材結合文法を厳格化
c3d08b0 fix: 安全工程の逆状態検出を補強
66f6a98 fix: 食材総称と安全工程の逆状態判定を補強
4c5d007 fix: 食材総称と全称安全指示の境界を補強
5a57ba6 fix: 魚食材と安全工程の境界判定を修正
4b3a2b6 test: 安全判定の残存境界を再現
```

全履歴は次で確認できます。

```bash
git log --oneline --reverse 6de9b97bc8c0b8c266b197de9abe4f5a1687796a..HEAD
```

## Task 2を閉じる条件

1. 上記3件をTDDでGREENにする。
2. focused test、full Vitest、typecheck、対象lint、Prettier、`git diff --check` を実行する。
3. 日本語Conventional Commitでproduction修正をcommitする。
4. 別エージェントで、同義語の無限列挙ではなく設計§4のacceptance criteriaと構造的不整合に限定したfresh adversarial reviewを行う。
5. 新規の妥当な候補があれば、別エージェントで二次検証してから修正する。候補なしになったらTask 2完了を記録する。

## その後のTask 6

`docs/superpowers/plans/2026-07-16-plan2-readiness-remediation.md` のTask 6をそのまま実行します。

- `shared/emergency/contracts.ts` を新設し、browser-safeなZod schema/DTOだけを移す。
- server filterは `shared/emergency/filter-emergency-menus.ts` に残す。
- browser側importを `@shared/emergency/contracts` へ変更し、`node:crypto` / fingerprint / validation codeをclient bundleから切り離す。
- contract source-boundary testをRED→GREENで追加する。
- `foundation.spec.ts` と全E2Eで白画面が解消したことを確認する。
- 設計どおり `AGENTS.md` のPrettierも行うが、ユーザー所有Plan 2文書は触らない。

既知のE2E環境症状:

- Task 5対象E2Eは、最初にSupabase REST unhealthy、その後はテスト開始時 `127.0.0.1:5173 ERR_CONNECTION_REFUSED` で失敗し、変更したroute本体へ到達しませんでした。
- E2E再試行が残したunhealthyなone-off `app-run-*` 5個は削除済みです。
- Task 6のbrowser import split後、script差分を確認してからE2Eを再実行してください。

## Task 7と既知の最終ゲート問題

全体lintには現在、今回差分外の次が1件残っています。

```text
src/features/planner/use-draft-autosave.ts:128
@typescript-eslint/no-floating-promises
onConflict?.()
```

Task 7の最終ゲート前に、挙動を変えずPromise処理を明示し、関連テストを確認して日本語コミットしてください。

最終検証は `AGENTS.md` 指定順に、必ず別コマンドで実行します。

1. format check
2. lint
3. typecheck
4. full Vitest
5. `./scripts/reset-local-db.sh`
6. DB pgTAP
7. full E2E
8. build
9. `git diff --check`

repo script実行前には、scriptまたは呼び出し先の未確認差分を確認し、破壊的操作・外部送信・secret参照がないことを確認してください。

## 新環境の作業ツリー期待値

remoteブランチをfresh cloneした直後の `git status --short` は空であるべきです。

旧環境または既存cloneにユーザー所有の次の変更が残っている場合は、その1件だけを保護し、今回の作業へ含めないでください。

```text
 M docs/superpowers/plans/2026-07-11-kondate-mvp-02-menu-domain-pantry.md
```

---
