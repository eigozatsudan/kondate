# Plan 2 readiness remediation 引継ぎプロンプト

以下を新しいエージェントへの最初のプロンプトとして渡してください。

---

`fix/plan2-readiness-remediation` ブランチの作業を再開してください。旧環境のworktreeや絶対パスが存在することを前提にしないでください。

## ブランチ取得時の注意

停止時点のローカル実装HEADは次です。

```text
755b020 fix: 全称除外句の連言食材を解決
```

この引継ぎ文書は、その次のdocs commitとして作成されています。停止時点ではローカルブランチが `origin/fix/plan2-readiness-remediation` より先行しているため、別環境からremoteを取得する場合は、まず人間が最新ローカルブランチをpush済みか確認してください。remoteが `755b020` とこの文書のcommitを含まない場合、古い `147daf4` から作業を再開しないでください。

リポジトリ:

```text
git@github.com:eigozatsudan/kondate.git
```

remote更新後に新規cloneから始める場合:

```bash
git clone git@github.com:eigozatsudan/kondate.git
cd kondate
git fetch origin fix/plan2-readiness-remediation
git switch --track origin/fix/plan2-readiness-remediation
```

既存cloneでローカルブランチがある場合:

```bash
git fetch origin fix/plan2-readiness-remediation
git switch fix/plan2-readiness-remediation
```

取得後、必ず次を個別に確認してください。

```bash
git branch --show-current
git status --short
git log -5 --oneline
```

期待するブランチは `fix/plan2-readiness-remediation`、実装ベースは `6de9b97bc8c0b8c266b197de9abe4f5a1687796a` です。

## 最初に読むもの

1. `AGENTS.md`
2. `SubAgents.md`
3. `docs/superpowers/plans/2026-07-16-plan2-readiness-remediation.md`
4. この引継ぎ文書

`main` のサブエージェント設定は、次のmerge commitで取り込み済みです。

```text
55756a4 Merge branch 'main' into fix/plan2-readiness-remediation
```

`.codex/agents/{explorer,fast-worker,implementer,reviewer}.toml`、`.codex/config.toml`、`.codex/rules/default.rules`、更新済み `AGENTS.md` / `SubAgents.md` を使用してください。現在のCodex surfaceでcustom agent種別・model・live permissionをdispatch時に指定できない場合は、指定できたと仮定せず、役割とread-only制約をpromptで明示し、その技術的制約を報告してください。

## 作業規約

- Node/npm/npxはDocker Composeの `app` service経由で実行する。
- Docker、Git、検証コマンドを `&&` や `;` で結合しない。
- TaskごとにImplementer、Verifier、Reviewerの3役を分離する。
- Implementerは常に1体だけとし、同じworktreeに別の親セッションがないことを確認してから起動する。
- VerifierとReviewerは読み取り専用。Verifierは実行前後のstaged diff、unstaged diff、untracked一覧を比較する。
- 一次Reviewerと候補の二次検証は、コンテキストを共有しない別Reviewerにする。
- 各production修正はREDを観測してから最小GREENにする。
- コメントとcommit messageは日本語にする。
- `.superpowers/sdd/progress.md` とtask reportはgitignoredであり、fresh cloneには存在しない。存在しなければ、この文書とGit履歴から再構築する。

## 現在の停止地点

Task 1、3、4、5は完了済みです。Task 2の主要実装と残存境界修正も実装済みですが、最後のfix round 6に対する独立VerifierとReviewerはまだ実行していません。したがって、Task 2を完了扱いにせず、まず次節のclosureを実施してください。

Task 2残存修正のcommit列:

```text
62245c6 fix: 食品安全ルールの残存境界を修正
595766f fix: 必須安全ルールの食材結合を厳格化
9cdf056 fix: 修飾付き魚名の工程検出を修正
10d5777 fix: 汎用魚語の複数食材矛盾を検出
68a2510 fix: 全称指示の別食材矛盾転嫁を防止
eb09f98 fix: 魚語境界と全称除外判定を修正
755b020 fix: 全称除外句の連言食材を解決
```

`55756a4` のmain mergeは `10d5777` と `68a2510` の間にあります。Task 2だけをレビューする際は、main由来の約2000行を混ぜないよう差分を分割してください。

既レビュー済みのTask 2 package:

```text
147daf4..10d5777
55756a4..68a2510
68a2510..eb09f98
```

最後の未レビュー差分:

```text
eb09f98..755b020
```

## 最初に行うTask 2 closure

### 1. review packageを作る

インストール済み `superpowers:subagent-driven-development` skillの `scripts/review-package` を使い、次のrangeをpackage化してください。

```text
eb09f98..755b020
```

絶対パスは環境ごとに異なるため、この文書の旧環境パスを再利用しないでください。

### 2. Verifierを先に実行する

clean baselineを確認してから、読み取り専用Verifierに次を1コマンドずつ順番に実行させてください。

```bash
docker compose run --rm --no-deps app npx vitest run shared/safety/food-rules.test.ts
docker compose run --rm --no-deps app npx vitest run
docker compose run --rm --no-deps app npm run typecheck
docker compose run --rm --no-deps app npx eslint shared/safety/food-rules.ts shared/safety/food-rules.test.ts
docker compose run --rm --no-deps app npx prettier --check shared/safety/food-rules.ts shared/safety/food-rules.test.ts
git diff --check
```

Implementerの停止前検証は次のとおりです。これは独立Verifierの代わりにはなりません。

```text
focused Vitest: 183/183 PASS
full Vitest: 55 files / 511 tests PASS
typecheck: PASS
target ESLint: PASS
target Prettier: PASS
git diff --check: PASS
```

### 3. 一次Reviewerとfresh closure Reviewerを実行する

Round 6の変更は、次の構造的不具合をTDD修正しています。

```text
すべての食材はにんじんとぶどうを除いて丸ごと盛り付ける
```

旧実装は、末尾の `ぶどう` だけを除外集合へ登録し、先頭の `にんじん` を全称対象として誤flagしました。`755b020` は、`を除いて`直前の除外句全体を解決し、連言 `と` で結ばれた実ingredient occurrencesを後方走査して一括登録します。

一次Reviewerでは、次を確認してください。

- 先頭と末尾の両方が除外される。
- 単一除外では除外食材だけを除き、非除外食材への危険な全称指示はfail-closedになる。
- `すべての食材は小さく切るがにんじんは丸ごと盛り付ける` の逆状態を他食材へ転嫁しない。
- `すべての食材は丸ごと盛り付ける` は引き続き矛盾になる。
- 魚語境界、`requires_tag` source結合、generic複数候補、`forbidden`本文検出を回帰させていない。

一次Reviewerがcleanでも、別のcontext-clean Reviewerで、同義語の無限列挙ではなく構造的不変条件だけを対象にfresh closure reviewを実行してください。新規候補が出た場合は、別ReviewerでVALID/REJECTEDを検証してから、VALIDだけをImplementerへまとめて戻してください。

### 4. Task 2を閉じる

Verifier PASS、一次Reviewer Approved、fresh closure Reviewerの `NO NEW CANDIDATES` が揃った場合だけ、`.superpowers/sdd/progress.md` にTask 2完了を記録してください。記録後に `/compact` 相当のコンテキスト圧縮を行い、設計書とコードを照合してTask 6への悪影響がないことを確認してください。

## Task 2で修正済みの構造的不変条件

- `めんたいこ`、`たい焼き`、`鯛焼き`、`さけるチーズ`等の加工食品substringを具体魚へ誤一致させない。
- `たい` / `さけ` / `鯛` / `サケ`、`真鯛`、`塩鮭`、`たらの切り身`、切り身・フィレ形を維持する。
- `requires_tag` の非ingredient sourceは、構造的なterm occurrenceとscope済み実ingredient候補をAND結合する。
- generic魚sourceは同一ruleの具体ingredient候補へ展開し、複数候補の解決済みpairを矛盾判定まで保持する。
- `forbidden` ruleは `requires_tag` filterを通さず、料理名・説明・工程本文の検出を弱めない。
- 全称scope、逆状態occurrence、明示的な別食材binding、全称集合からの除外を区別する。

## その後のTask 6

`docs/superpowers/plans/2026-07-16-plan2-readiness-remediation.md` のTask 6を、そのままTDDで実行してください。

- `shared/emergency/contracts.ts` と `contracts.test.ts` を新設する。
- browser-safeなZod schema/DTOだけを `contracts.ts` へ移す。
- server filterは `shared/emergency/filter-emergency-menus.ts` に残す。
- browser側importを `@shared/emergency/contracts` へ変更する。
- `node:crypto`、fingerprint、server validatorをclient bundleから切り離す。
- contract source-boundary testをRED→GREENにする。
- `foundation.spec.ts` の白画面を解消し、全E2Eを実行する。

Task 6用briefはgitignored領域に作成済みでしたが、fresh cloneにはありません。planのTask 6を `task-brief` scriptで再抽出してください。

## Task 7と最終ゲート

全体lintには、停止時点で次の既知問題が残っています。

```text
src/features/planner/use-draft-autosave.ts
@typescript-eslint/no-floating-promises
onConflict?.()
```

Task 7の最終ゲート前に、挙動を変えずPromise処理を明示し、関連テストを確認して日本語commitにしてください。

最終検証は更新済み `AGENTS.md` の順番で、必ず別コマンドとして実行します。

1. format check
2. lint
3. typecheck
4. full Vitest
5. `./scripts/reset-local-db.sh`
6. DB pgTAP
7. full E2E
8. build
9. `git diff --check`

`main` mergeで検証scriptにもコメント・拒否境界の変更が入っています。repo script実行前に、対象scriptと呼び出し先の差分を確認し、破壊的操作・外部送信・secret参照がないことを確認してください。

## ユーザー所有Plan 2差分

旧環境にあった次のユーザー所有未コミット差分はremoteへpushされず、現在のworktreeにも存在しません。

```text
docs/superpowers/plans/2026-07-11-kondate-mvp-02-menu-domain-pantry.md
```

この差分を推測で再作成しないでください。既存clone側で同じ未コミット変更を見つけた場合は、編集・stage・commitせず保護してください。Task 7では、存在しない旧差分を捏造せず、現在追跡されているPlan 2文書へ実際の検証証拠だけを追記してください。

## ローカル環境

新しいworktreeでは `.env` が引き継がれません。`docker compose` が `KONDATE_COMPOSE_PROJECT_NAME` 未設定で停止した場合は、script差分を確認したうえで次を実行してください。

```bash
./scripts/generate-local-secrets.sh --force
docker compose run --rm --no-deps app npm ci
```

`.env` はgitignoredのローカル専用認証情報です。commitしないでください。固定portと固定Supabase container名があるため、別checkoutのstackと同時起動しないでください。

---
