# 敵対的レビュー修正 — E2E 未解消ステータス（main 取込後フォロー用）

- **作成日**: 2026-07-27
- **用途**: 別タスク／別プロンプトで E2E を追い切るための引き継ぎ資料
- **merge**: `fix/adversarial-review-2026-07-26` → **main**（ローカル merge commit `a067cff`）
- **記録時の fix HEAD**: `4cea4dff679b34b60dd992a2dc076d0f56f57604`（E2E 集計）／ docs 追加 `f3ed30f`
- **旧 worktree（参考）**: `/home/dev/projects/kondate/.worktrees/fix-adversarial-2026-07-26`
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

## 8. 関連ログ・成果物パス

| 内容 | パス |
|------|------|
| E2E 実行ログ（本メモ集計元） | `/tmp/kondate-adversarial-fix-review/final-9b/07-e2e.log` |
| 9 段階その他ログ | `/tmp/kondate-adversarial-fix-review/final-9b/0{1..9}-*.log` |
| 最終レビュー指摘 | `/tmp/kondate-final-code-review-findings-00fe337.md` |
| I1–I4 修正 report（fix worktree 側 gitignored の可能性） | `.superpowers/sdd/final-review-fix-4-important-report.md` |

---

## 9. 明示的にやらないこと（このメモのスコープ外）

- 本メモ作成時点での E2E 修正実装
- remote への `git push`（人間が必要なら別途）
- 失敗 31 本の assertion 本文の完全再取得（ログに未出力）

---

## 10. 他実装プロンプトへそのまま貼る短文

```text
【E2E follow-up — 敵対的レビュー修正は main 取込済み】

作業場所: /home/dev/projects/kondate（branch main、merge commit a067cff 以降）
実装は SuperPowers（subagent-driven-development + TDD）を使うこと。
Node/npm は docker compose run --rm --no-deps app 経由。コマンドは && で連結しない。

既知:
- 敵対的レビュー修正（安全照合・買い物差分・finalizer deadline・生成 CTA・claim 失敗消去等）は
  format/lint/typecheck/vitest(2142)/db-test(793)/build まで PASS。
- E2E のみ未解消: PASS 27 / FAIL 31（mobile-chromium、多くは retry 後も失敗）。
- 詳細一覧: docs/bugfix/2026-07-27-adversarial-fix-e2e-open-status.md
- ログ: /tmp/kondate-adversarial-fix-review/final-9b/07-e2e.log

傾向:
- idea 系は比較的緑（idea journey / idea history regen / idea a11y 等）。
- household full-journey、settings CRUD、shopping（races 含む）、history-safety、
  household wizard+result a11y、生成リカバリ数本が赤。

依頼:
1. まず単発で失敗の「最初のユーザー可視点」を特定する:
   ./scripts/run-e2e.sh -- e2e/specs/settings.spec.ts:8
   または full-journey household（e2e/specs/full-journey.spec.ts:11）
   必要なら Playwright trace / screenshot。
2. 仕様変更への E2E 未追従を優先確認:
   - D-C1: 献立結果の買い物 create は shoppingGate から分離
   - D-C2: reconcile の remove は既定オフ
   - A-C2: 安全 issue 文言（危険な操作 / 表示名・材料文脈）
   - getMenuResult の includePreferenceGaps: true
3. クラス単位で修正→再実行し、最後に ./scripts/run-e2e.sh 全緑。
4. 完了条件: E2E 全緑 + AGENTS.md の必須9段階を独立コマンドで順実行。
5. git push / PR はしない。コミットは日本語 Conventional Commits。
```
