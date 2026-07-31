# 敵対的再レビュー: 利用回数コピー簡素化 Implementation Plan（改訂版）

| 項目 | 値 |
|------|-----|
| 対象 | `docs/archive/superpowers/plans/2026-07-29-quota-copy-simplification.md`（Plan revision: 前回 adversarial 反映済み版） |
| 日付 | 2026-07-29 |
| 対照 | 設計 `docs/archive/superpowers/specs/2026-07-29-quota-copy-simplification-design.md`（Approved） |
| 前回 | `docs/archive/reviews/2026-07-29-quota-copy-simplification-plan-adversarial.md`（P-C1〜P-I11） |
| 判定 | **APPROVE** — Critical 0。初回再レビュー後に R-I1〜R-I3 を plan へ取り込み済み（親セッション） |
| 観点 | 設計カバレッジ、前回指摘の解消、false green、export 実現性、コマンド規約、現行コードとの衝突 |

---

## 総評

改訂 plan は前回 Critical 4件と Important の大半を**具体的なテスト本文・export・File map・Step 分離**で潰している。設計の Must（`issueMessages` 正本、`failureCopy` 一致 assert、案 A disabled、success0∧attempts0 は success0 のみ、short/global では常時 success 行維持、retryAt UI Must、横断 grep）は Task 1–5 にマップできる。

`getGenerationFailureCopy` は現行 `generation-service.ts` の `failureCopy: Record<GenerationFailureCode, …>` と `issueMessages`（`satisfies Record<GenerationFailureCode, string>` 経由）の形から**型的に実現可能**。`issueMessages` は未 import だが循環依存は無い（contracts ← service の一方向）。

残る穴は「Task 4 の userId あり retryAt を expect スニペット止まり」「`free-tier.test.ts` が Task 5 grep に引っかかる」程度で、**実装エージェントが plan の確定 JSX / Expected 注記に従えば閉じられる**。plan 再改訂をゲートにする Critical は無い。

---

## 判定

**APPROVE**

- Critical 残: **0**
- 実装開始可。下記 Residual Important は Verifier / 一次レビューで確認推奨（plan 本文の必須差し戻しは不要）。

---

## Residual findings（新規・残差）

| ID | 重大度 | 要約 | 扱い |
|----|--------|------|------|
| **R-I1** | Important | Task 4 Step 1 の **userId あり + `quota.retryAt`** はコメント行のみで、完全な `it` + `expect` が無い。現行は userId 経路でパネル直下 retryAt を出さず Terminal の `data.retryAt` に依存。plan は Terminal から `data.retryAt` を外すため、パネル直下の Must を実装し忘れると **認証済みユーザーで時刻欠落**し得る。request-local 側の `/再開/` だけでは足りない | 実装時に userId 付き failed fixture（既存 `failedState` は `quota.retryAt` あり）で `getByText(/再開/)` または `明日0:00` を assert。レビューで確認 |
| **R-I2** | Important | Task 5 grep `本日あと.*作成できます` は **`shared/copy/free-tier.test.ts`**（ヘルパ単体の旧 body 例）にヒットする。Expected「ヒットなし」と衝突し **false red** になり得る。plan File map は free-tier を任意接頭テストのみ | Task 5 で free-tier 例文を受け付け口調へ更新するか、grep 例外をコメントで明記 |
| **R-I3** | Important（弱） | 設計受け入れの「`formatFreeTierQuotaCopy(attempts0)` が `無料版は本日は` を作らない」は Task 2 で **任意推奨**のまま（前回 P-I6）。wizard の exact 文字列 expect が間接担保 | 任意 Step を実施するか、GREEN 後に一次レビューで接頭結果を目視 |
| **R-M1** | Minor | 再生成 **success0** の作成上限1文は実装 JSX にあるが専用 `it` が無い（attempts0 / shortWindow は全文）。success0∧attempts0 優先もコード上は正しいが未テスト | 余力で1本。なくても disabled 既存 + attempts0 it で大枠は守られる |
| **R-M2** | Minor | Task 3 `does not treat null attemptsRemaining as blocked` は「受け付けられません」非表示のみ。`attemptsBlocked` で disabled だけ立てて文を出さない実装でも green | 理由選択後に submit enabled を足すと堅い |
| **R-M3** | Minor | Task 1 `failureRetryable` スケルトンに `// …` があるが、`Record<GenerationFailureCode, boolean>` なら typecheck が欠落キーを落とす。現行 `retryable` を変えない指示は明確 | 実装時は現行 `failureCopy` から機械転記 |

**Critical 新規: なし**

---

## 前回指摘チェックリスト（P-C* / P-I*）

| ID | 状態 | 証拠（改訂 plan 上） |
|----|------|----------------------|
| **P-C1** | **FIXED** | Global Constraints と Task 1: `getGenerationFailureCopy` export + 全 `generationFailureCodes` で `message === issueMessages[code]`。目視逃げ削除 |
| **P-C2** | **FIXED** | Task 3 Step 1: short-window の `it` に render + disabled + `/しばらく続けて作成を試したため/` + `/以降に再試行してください/`（現行 regen 文と一致） |
| **P-C3** | **FIXED** | Task 2 Step 1-1: 旧両文 it を success0 のみへ書き換え。`not.toHaveTextContent("受け付けられません"|"問い合わせ")` |
| **P-C4** | **FIXED** | Task 5 grep に `本日あと.*作成できます` / `明日0時` / `作成回数の上限` / `問い合わせ回数が上限` 等を追加。コメントはゼロ必須から緩和。※ R-I2 で free-tier 例文の運用注意のみ |
| **P-I1** | **FIXED** | Task 3 Step 4/5: test GREEN と commit を分離。全体も `&&` 連結なし |
| **P-I2** | **FIXED** | Task 2 Step 1-5/6: short のみ・global のみで常時「受け付けます」行 + CTA disabled |
| **P-I3** | **FIXED** | Task 4: request-local の受け付け口調 JSX + テスト expect |
| **P-I4** | **PARTIAL** | 規則「`quota.retryAt` はパネル直下に必ず1行 / Terminal は `data.retryAt` 出さない」は**確定**。テストは request-local 中心で userId 経路がコメント止まり → **R-I1** |
| **P-I5** | **FIXED** | File map に `generation-service.test.ts` / `_tests/generation-status.test.ts` / `generate-menu.test.ts` を列挙。現行 grep では status + service が旧 message ヒット（generate-menu は未ヒットで「grep 時」扱い） |
| **P-I6** | **PARTIAL** | free-tier 接頭回帰は Task 2「任意（推奨）」。設計 Must の直接 assert は非必須のまま → **R-I3** |
| **P-I7** | **FIXED**（テスト弱い） | `attemptsRemaining === 0` のみ止め・null は止めないを本文 + `it`。R-M2 で enabled assert 不足のみ |
| **P-I8** | **FIXED** | Task 5 は vitest をファイル単位で分割実行 |
| **P-I9** | **FIXED** | Task 5 grep 対象に `e2e/`。現行 e2e に旧文言ヒットなし（spot-check） |
| **P-I10** | **FIXED** | Task 4 Step 6: freemium docs を `git add` に明記 |
| **P-I11** | **FIXED** | Spec coverage / Placeholder scan が P-C1–3 等を事実として記載。自己矛盾は解消 |

---

## 設計受け入れ表 vs 改訂 plan

| 設計受け入れ | plan | 再レビュー |
|--------------|------|------------|
| 確認 常時1行・受け付け口調 | Task 2 | OK |
| attempts0 バナー・常時行なし | Task 2 | OK |
| success0∧attempts0 は success0 のみ | Task 2 必須 it 書き換え | OK（P-C3 FIXED） |
| short / global のみ success 行維持 | Task 2 明示 it | OK（P-I2 FIXED） |
| 再生成 attempts0 disabled + 文 | Task 3 全文 | OK |
| 再生成 shortWindow disabled + 文 | Task 3 全文 | OK（P-C2 FIXED） |
| issueMessages 新文 | Task 1 exact 表 | OK |
| failureCopy ≡ issueMessages | export + 全 code assert | OK（P-C1 FIXED） |
| 未減1行 | Task 4 | OK |
| short 失敗 retryAt UI Must | 規則確定 + テスト弱い | 実装規則 OK / テスト **R-I1** |
| 無料版は本日は 禁止 | 間接 + 任意 unit | **R-I3** |
| freemium superseded | Task 4 | OK |
| 枠ロジック非変更 | 全 Task 非編集宣言 | OK |
| コマンド非連結 | Step 分離 | OK |

---

## 現行コード spot-check（plan 前提の健全性）

| 箇所 | 観察 | plan との関係 |
|------|------|----------------|
| `generation-service.ts` `failureCopy` | module ローカル、message 生文字列、`issueMessages` 未 import | Task 1 の参照化 + export が必要かつ十分 |
| `shared/contracts/generation.ts` `issueMessages` | 全 `GenerationFailureCode` + conflict。quota/soft に旧運用語 | Task 1 exact 表と一致する改訂対象 |
| `review-step.tsx` | dual 常時行、attempts0 を success0 と併記、global に「しばらく」、`0時` | Task 2 の `showSuccessRemaining` と `attemptsRemaining === 0 && usageRemaining !== 0` が設計どおりの修正 |
| `planner-wizard.test.tsx` 961–980 | 両文要求の旧 it が存続 | Task 2 RED が明示的に置換 |
| `regeneration-sheet.tsx` | submitDisabled は success のみ。short 文は既にあるが disabled なし。attempt 常時行あり | 案 A の RED が成立 |
| `regeneration-sheet` short 文 | `しばらく続けて作成を試したため、…以降に再試行してください` | Task 3 期待と一致 |
| `generation-status-panel.tsx` | dual 残数、未減「成功回数には…」、failed+userId で panel 直下 retryAt なし | Task 4 の一本化規則が必須 |
| `_tests/generation-status.test.ts` / service test / generation-page | 旧 message / AI通信試行 expect | File map 通り更新対象 |
| `e2e/` | 旧利用回数リテラルなし | grep のみで可 |
| `getGenerationFailureCopy` | 未存在。既存 export 関数群と同パターンで追加可 | 循環なし |

---

## false-green / placeholder 再スキャン

| リスク | 結果 |
|--------|------|
| 空 `it` | なし（Placeholder scan と本文一致） |
| 「目視で足りる」 | なし |
| 旧 wizard 両文 it 放置 | Task 2 が書き換え Must |
| failureCopy ドリフト | 全 code assert Must |
| Task 5 複数 path 一発 vitest | 分割済み |
| `&&` commit | 分離済み |
| Task 4 expect 断片 | 既存 describe への差し込み前提。userId+retryAt のみ弱い（R-I1） |
| free-tier 旧「作成できます」例 | Task 5 false red（R-I2） |

---

## `getGenerationFailureCopy` 実現性

```text
issueMessages[code]           // Record 上 GenerationFailureCode を網羅
failureRetryable[code]        // 現行 failureCopy.*.retryable を転記
→ { message, retryable }

呼び出し: failureCopy[code] → getGenerationFailureCopy(code)
（または内部 alias。message リテラル禁止）
```

- `generationFailureCodes` は既に service が import。
- テストは既存 `_shared/generation-service.test.ts` から同モジュール export を import 可能（現行も service を広く import）。
- plan のフォールバック（export した object を `message: issueMessages[code]` で組み立て）も型的に同等。

---

## コマンド規約

全 Task の docker / git は **1 Step = 1 コマンド**。前回 P-I1（Task 3 の `&&`）は解消。Global Constraints 再掲あり。問題なし。

---

## 結論

| 項目 | 値 |
|------|-----|
| Verdict | **APPROVE** |
| Open Critical | **0** |
| Open Important（非ゲート） | R-I1（userId+retryAt テスト）、R-I2（free-tier.test vs Task5 grep）、R-I3（P-I6 任意のまま） |
| 実装可否 | **可**。前回 ACCEPT_WITH_CHANGES の最小改訂セットは満たした |

実装エージェントへの短い注意:

1. Task 4 で **userId 付き failed** でも `quota.retryAt` がパネルに1行出ることをテストかレビューで必ず確認する（Terminal から `data.retryAt` を外した副作用）。
2. Task 5 前に `shared/copy/free-tier.test.ts` の「作成できます」例文を受け付け口調へ合わせるか、意図的例外として記録する。
3. Task 1 の `failureRetryable` は現行 `failureCopy` 全キーを機械転記し、retryable 真偽を変えない。
