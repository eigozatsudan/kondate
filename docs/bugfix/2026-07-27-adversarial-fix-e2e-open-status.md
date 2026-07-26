# 敵対的レビュー修正ブランチ — E2E 未解消ステータス（main マージ前メモ）

- **作成日**: 2026-07-27
- **用途**: 本ブランチを main にマージしたあと、別タスク／別プロンプトで E2E を追い切るための引き継ぎ資料
- **worktree**: `/home/dev/projects/kondate/.worktrees/fix-adversarial-2026-07-26`
- **branch**: `fix/adversarial-review-2026-07-26`
- **記録時点 HEAD**: `4cea4dff679b34b60dd992a2dc076d0f56f57604`
- **E2E ログ**: `/tmp/kondate-adversarial-fix-review/final-9b/07-e2e.log`  
  （Playwright 最終サマリー行はログ末尾に無く、一覧は runner 出力の `✓`/`✘` から集計。retry 後も fail のものを「失敗」とする）

---

## 1. マージ判断の前提（9 段階検証の現状）

| # | コマンド | 結果（HEAD `4cea4df` 付近） |
|---|---------|------------------------------|
| 1 | `npm run format:check` | **PASS** |
| 2 | `npm run lint` | **PASS** |
| 3 | `npm run typecheck` | **PASS** |
| 4 | `npx vitest run` | **PASS**（140 files / 2142 tests, 1 skipped） |
| 5 | `./scripts/reset-local-db.sh` | **PASS** |
| 6 | `docker compose --profile test run --rm db-test` | **PASS**（23 files / 793 tests） |
| 7 | `./scripts/run-e2e.sh` | **FAIL（本メモの主題）** |
| 8 | `npm run build` | **PASS**（chunk size warning のみ） |
| 9 | `git diff --check` | **PASS** |

**結論**: 静的検証・ユニット・DB は通っている。**E2E だけがゲート落ち**。main へ取り込む場合は「E2E 未解消を既知の follow-up として明示する」前提。

---

## 2. このブランチで閉じたこと（E2E 外）

敵対的レビュー修正一式（要約）:

- アレルゲン照合・区切り跨ぎ（I4）、主材料鮭同義語と非食材境界（I3 / Task 2）
- 買い物差分 D-C2（1 next = 1 操作、remove 既定オフ）
- 生成 finalizer deadline（入口 + SQL `statement_timeout` wrapper I1）
- 生成 CTA: success / attempts / global / **shortWindow**（I2）
- A-C2 residual（表示名・材料文脈）
- B-I2 claim 失敗消去 + 未 deposit 正当ポーリング温存
- openrouter mock fixture の `safetyTags.maxItems: 32` 同期と vitest 全緑
- format/lint 全緑

最終コードレビュー Important 4 件は一次・二次とも **Approved**（残 Minor のみ）。

---

## 3. E2E 集計（記録時点）

| 区分 | 件数（ユニーク title） |
|------|------------------------|
| **PASS** | **27** |
| **FAIL**（retry 後も ✘） | **31** |

Project: `[mobile-chromium]` のみ観測。各失敗は初回 + retry #1 の 2 回 ✘。

**傾向**:

- **idea 系は比較的緑**: idea journey、idea servings 境界、idea history regen、idea wizard a11y など PASS。
- **household / shopping / history(safety) / 設定 CRUD がまとまって赤**。
- 失敗の多くが **8–13 秒台で ✘** → 画面到達タイムアウトや前提ステップ失敗の連鎖が疑わしい（ログに assertion 本文が載っていないため確定診断は未了）。

---

## 4. 失敗一覧（ファイル別）

### 認証・アカウント

| Spec | 結果 |
|------|------|
| `auth-callback-security.spec.ts:115` matching state reaches callback once… | **FAIL** |
| `auth-recovery.spec.ts:16` isolated WebView deposits once… | **FAIL** |
| `auth-recovery.spec.ts:34` Google cancel and expired links… | **FAIL** |
| `account-deletion.spec.ts:14` deletes the account… | **FAIL** |

（同ファイルの cancel / expires_at / reuse 系の一部は PASS）

### 世帯フルジャーニー・設定

| Spec | 結果 |
|------|------|
| `full-journey.spec.ts:11` household journey: welcome through shopping reconciliation | **FAIL** |
| `settings.spec.ts:8` adds, edits, and deletes a household member… | **FAIL** |
| `settings.spec.ts:3` completed fixture opens protected planner | PASS |

### 生成リカバリ・結果 UI

| Spec | 結果 |
|------|------|
| `generation-recovery-results.spec.ts:142` resends same key after POST lost | **FAIL** |
| `…:176` recovers when only POST response lost | **FAIL** |
| `…:232` recovers after tab closed before POST response | **FAIL** |
| `…:280` timeline/tabs/ingredients… at 320px | **FAIL** |
| `…:560` 5-route smoke (skipped user, zero members) | **FAIL** |
| idea mock scenario 選択 / servings 1・20 / wizard a11y 契約 | PASS |

### 履歴

| Spec | 結果 |
|------|------|
| `history-regeneration.spec.ts:18` regenerates whole menu… | **FAIL** |
| `…:35` does not consume success for duplicate output | **FAIL** |
| `…:48` idea history… regenerates as idea without shopping | PASS |
| `history-safety-change.spec.ts:13` revalidates on mount… | **FAIL** |
| `…:103` standard allergen hit returns invalid revalidation… | **FAIL** |

### 冷蔵庫・緊急献立

| Spec | 結果 |
|------|------|
| `menu-domain-pantry.spec.ts:167` waits for latest draft save before emergency | **FAIL** |
| `…:390` pantry CRUD… all reviewed meals | **FAIL** |
| `…:632` incompatible current allergy → no-candidate | **FAIL** |

### モバイル a11y

| Spec | 結果 |
|------|------|
| household wizard + result @ 320/375/430 | **FAIL**（3 viewport） |
| history detail both modes @ 320/375/430 | **FAIL**（3 viewport） |
| start / idea wizard+result / shell majors | PASS |

### 買い物リスト

| Spec | 結果 |
|------|------|
| `shopping-list-races.spec.ts` 5 本すべて | **FAIL** |
| `shopping-list.spec.ts:17` retains checked/manual after history deletion | **FAIL** |
| `shopping-list.spec.ts:33` shows server-owned diff… | **FAIL**（ログ末尾。最終サマリー無しのため suite 完了断定は弱い） |

---

## 5. 成功している E2E（参考）

- foundation ルート保護・viewport
- idea full journey + idea history regen
- idea generation servings 境界・wizard a11y/keyboard/reduced-motion
- oauth-mock success/cancel
- onboarding partial resume → planner
- settings: completed fixture → planner
- auth-callback: cancel / expires_at / reuse の一部
- same-browser recovery の一部
- mobile: start / idea / shell majors

→ **「idea パスは動くが、household 安全・買い物・設定 CRUD・生成リカバリが死んでいる」** 切り分けが次の第一歩。

---

## 6. 疑わしい原因クラス（未検証仮説）

調査順の提案（実装プロンプト用）:

1. **household 設定 UI 契約ずれ**  
   - vitest では DangerZone 名を `"危険な操作"` に更新済み。E2E が旧アクセシブルネーム／ボタン文言を掴んでいる可能性。
2. **買い物 gate / reconcile 既定（D-C1 / D-C2）**  
   - create は gate から分離、remove 既定オフ。E2E が旧「gate で create 不可」「remove 既定選択」を前提にしていないか。
3. **生成結果 API `includePreferenceGaps: true`**  
   - クライアントは gaps 付き取得。E2E mock / 結果表示待ちがズレていないか。
4. **履歴 revalidation / アレルゲンメッセージ**  
   - A-C2 文言変更（`家族N`・displayName・材料文脈）で E2E の期待文字列不一致。
5. **WebView claim / continuation**  
   - B-I2 精緻化（未 deposit 温存）後も E2E が落ちている → 別要因 or タイムアウト連鎖の可能性大。
6. **共通: ログイン〜世帯セットアップ到達失敗**  
   - 失敗時間帯が短いものが多く、後段 assert 以前に落ちている可能性。**最初に 1 本（`settings.spec.ts:8` または `full-journey` household）の trace/screenshot を取る**のが最短。

---

## 7. 推奨フォローアップ手順

```text
1. worktree で HEAD を確認し docker compose up -d --wait
2. 単発:
   ./scripts/run-e2e.sh -- e2e/specs/settings.spec.ts:8
   （または full-journey household 1 本）
3. Playwright trace / screenshot / video から「最初のユーザー可視失敗」を特定
4. 失敗クラス（セレクタ / 文言 / ゲート / API）ごとに E2E 更新 or 製品バグ修正
5. クラス単位で再実行 → 最後に ./scripts/run-e2e.sh 全件
6. 全緑後に AGENTS.md の 9 段階を再走査
```

**注意**: `user_feedback` pgTAP は global 汚染で間欠 FAIL し得る。db-test 前は `./scripts/reset-local-db.sh` を正とする。

---

## 8. 他実装プロンプトに貼る短文（コピー用）

```text
前提: branch fix/adversarial-review-2026-07-26（または main 取込後）で
敵対的レビュー修正は unit/lint/typecheck/db-test/build まで PASS。
E2E のみ未解消。詳細は docs/bugfix/2026-07-27-adversarial-fix-e2e-open-status.md。

依頼: E2E の household / shopping / history-safety / settings CRUD 失敗を
トレース起点で修正する。idea 系は多く PASS しているので、まず
settings.spec.ts:8 と full-journey household の失敗点を特定すること。
D-C1/D-C2（買い物 create と remove 既定）、A-C2 文言、preferenceGaps 付き
getMenuResult、DangerZone「危険な操作」など仕様変更に E2E が追従していない
可能性を優先確認。完了条件は ./scripts/run-e2e.sh 全緑 + AGENTS.md 9段階。
```

---

## 9. 関連ログ・成果物パス

| 内容 | パス |
|------|------|
| E2E 実行ログ（本メモ集計元） | `/tmp/kondate-adversarial-fix-review/final-9b/07-e2e.log` |
| 9 段階その他ログ | `/tmp/kondate-adversarial-fix-review/final-9b/0{1..9}-*.log` |
| 最終レビュー指摘 | `/tmp/kondate-final-code-review-findings-00fe337.md` |
| I1–I4 修正 report | `.superpowers/sdd/final-review-fix-4-important-report.md` |
| progress | `.superpowers/sdd/progress.md` |

---

## 10. 明示的にやらないこと（このメモのスコープ外）

- 本メモ作成時点での E2E 修正実装
- main への push / PR 作成（人間操作）
- 失敗 31 本の assertion 本文の完全再取得（ログに未出力）

必要なら次セッションで **1 本だけ** `PWDEBUG` / `--trace on` 付き再実行から再開する。
