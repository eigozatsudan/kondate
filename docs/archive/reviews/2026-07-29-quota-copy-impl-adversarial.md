# 敵対的レビュー: 利用回数コピー簡素化 実装

| 項目 | 値 |
|------|-----|
| 対象 | commits `0353f75..686f29d`（feature: `1075f8f`, `4ea77e9`, `a9c0201`; style: `686f29d`） |
| 日付 | 2026-07-29 |
| 設計正本 | `docs/archive/superpowers/specs/2026-07-29-quota-copy-simplification-design.md`（Approved） |
| Plan | `docs/archive/superpowers/plans/2026-07-29-quota-copy-simplification.md` |
| Diff package | `.superpowers/sdd/review-0353f75..686f29d.diff` |
| 判定 | **APPROVE** |
| 観点 | 設計 L1–L10 / 受け入れ表、文言ドリフト、dual 数字、success0∧attempts0、無料版接頭、failureCopy≡issueMessages、null attempts、retryAt、テストの false green、枠ロジック非変更 |

---

## 総評

実装は設計の利用者向け表示変更を**ほぼ文字どおり**満たしている。攻撃角度（二重 body、`無料版は本日は`、failure message 二重定義、null=0 誤停止、認証済み retryAt 欠落、旧 jargon 残留）をコードとテストの双方から辿った結果、**Critical / Important（confidence ≥ 80）の true positive は 0 件**。

特に強い点:

1. **L3 / D-I7**: `getGenerationFailureCopy` が `issueMessages[code]` を参照し、全 `generationFailureCodes` で一致 assert（`generation-service.test.ts`）。
2. **L1 / L4 / success0∧attempts0**: `review-step.tsx` と `regeneration-sheet.tsx` の双方で `usageRemaining === 0`（または `successBlocked`）時に attempts0 body を出さない。
3. **L8 案 A**: 再生成で `attemptsRemaining === 0` / short-window を submit disabled + 平易1文。
4. **L9**: 利用者向け再開は `明日0:00（日本時間）`（`0時` なし）。
5. **L10**: freemium §2.1 に superseded 注記。
6. **R-I1**: `TerminalQuotaBlock` が userId 有無に関わらず `quota.retryAt` をパネル直下に1回。Terminal は `data.retryAt` を出さない。テストで `getAllByText(/再開/u).toHaveLength(1)`。
7. 利用者向け旧 jargon（`成功回数` / `別の上限` / `AI通信試行` / `問い合わせ` 残数行 等）は `src` / `shared` / `netlify` / `e2e` のリテラルから除去済み（禁止断片は `issueMessages` 全 value で unit 固定）。

枠数値・DB・`usage/today` shape は触っていない（L5）。

---

## 判定

**APPROVE**

| 重大度 | 件数（confidence ≥ 80） |
|--------|-------------------------|
| Critical | **0** |
| Important | **0** |
| Minor（残差・参考、ゲート非対象） | 3 |

マージ / 次工程をブロックする指摘は無い。

---

## Critical

（なし）

---

## Important

（なし）

---

## Attack matrix（実施結果）

| 攻撃角度 | 結果 | 根拠 |
|----------|------|------|
| Spec miss / wrong copy | **PASS** | `issueMessages` の quota/soft-failure 9 キーが設計表と exact 一致（`shared/contracts/generation.ts:942-961` + `generation.test.ts` expectedQuotaMessages） |
| Dual numbers still shown | **PASS** | review 常時は success 1 行のみ（`review-step.tsx:474-479`）。Terminal から AI通信試行・10分残数削除（`generation-status-panel.tsx:40-54`）。再生成 attempt 常時行削除 |
| success0 ∧ attempts0 shows both bodies | **PASS** | review: `attemptsRemaining === 0 && usageRemaining !== 0`（`:491`）。regen: `attemptsBlocked && !successBlocked`（`:309`）。wizard test が両文禁止 |
| free-tier prefix「無料版は本日は」 | **PASS** | attempts0 body は `今日は…`。`formatFreeTierQuotaCopy` → `無料版は今日は…`。`free-tier.test.ts` が `無料版は本日は` を禁止 |
| failureCopy drift from issueMessages | **PASS** | service に message リテラル無し。`getGenerationFailureCopy` + 全 code assert |
| attempts null treated as 0 | **PASS** | review: `=== 0` のみ block / hide（null は `!== 0` で常時行維持）。regen: `attemptsRemaining === 0`。wizard null it + regen null it |
| retryAt missing for authenticated failed path | **PASS** | `TerminalQuotaBlock` が userId 分岐の外で `retryAt` 描画（`:133`）。test: userId 付きで `再開` length === 1 |
| False safety of tests (empty expects) | **PASS** | plan 指摘の空 `it` は実装テストに無し。short-window / attempts0 は全文 expect。forbidden fragments は `contains: false` オブジェクト比較 |
| Security / PII logging | **N/A** | 本差分でログ・永続化パスの追加無し |
| L1–L10 regressions | **PASS** | 下記 Locks 照合 |

### Locks L1–L10

| Lock | 実装 |
|------|------|
| L1 常時 success 1 行 | review / Terminal / regen 達成 |
| L2 attempts>0 逼迫警告なし | 追加警告 UI なし |
| L3 issueMessages まで直す | 達成 + service 参照化 |
| L4 トーン分離 + CTA 同 disable | success0 / attempts0 別文、両方 CTA 無効 |
| L5 数値・API shape 不変 | 差分に DB/quota ロジック変更なし |
| L6 無料版接頭は個人枠のみ | global 混雑文は接頭なし（review + Terminal） |
| L7 課金 UI 非スコープ | 追加なし |
| L8 再生成案 A | disabled + 1 文 |
| L9 明日0:00 | issueMessages / UI バナー一致 |
| L10 freemium superseded | §2.1 注記あり |

---

## Spot-check（現行ファイル）

### `shared/contracts/generation.ts`

- 対象 9 キーの message は設計表どおり。
- 禁止断片（成功回数 / 別の上限 / AIへの送信 / 通信試行 / 問い合わせ / attempt）を value に含まない（unit 固定）。

### `netlify/functions/_shared/generation-service.ts`

- `failureRetryable` は flag のみ。message は `issueMessages[code]`。
- `toGenerationStatus` failed 分岐: `error: { code, ...getGenerationFailureCopy(code) }`（`:347`）。
- `Record<GenerationFailureCode, boolean>` により欠番は typecheck で落ちる。

### `src/features/planner/components/review-step.tsx`

```text
showSuccessRemaining =
  usageRemaining !== null && usageRemaining > 0 && attemptsRemaining !== 0
```

- 常時文: `本日あと{n}回まで献立の作成を受け付けます` + 無料版接頭。
- success0 / attempts0 / global / shortWindow の body と接頭規則が設計どおり。
- `hasActiveUsageBlocker` 判定は維持（数値ロジック非変更）。

### `src/features/history/components/regeneration-sheet.tsx`

- `submitDisabled` に `attemptsBlocked` / `shortWindowBlocked` を追加（L8）。
- success0 優先で attempts0 文を抑制。
- success 説明文（完成時1回・残り n）は据え置き（D-I9 / Non-Goal）。

### `src/features/generation/components/generation-status-panel.tsx`

- `NotConsumedNotice`: `献立は完成していないので、作成回数は減っていません`（message 本文に未減を埋め込まない）。
- Terminal: success 受け付け口調 + global + shortWindow 待ちのみ。
- failed: quota 3 code のみ `formatFreeTierQuotaCopy(message)`（allowlist 維持）。
- **改善**: 旧実装は userId あり経路で request-local `quota.retryAt` を出さなかった。本変更でパネル直下に一本化（R-I1 解消）。

---

## Residual / Minor（confidence < 80・ゲート非対象）

以下は true positive の欠陥としては弱い。記録のみ。

| ID | 重大度 | confidence | 分類 | 内容 | 理由（なぜ ≥80 にしないか） |
|----|--------|------------|------|------|---------------------------|
| M1 | Minor | 70 | possible FP / テストギャップ | 再生成 **success0** の作成上限1文（`regeneration-sheet.tsx:302-308`）に専用 `it` が無い。success0∧attempts0 優先も未テスト | 実装は設計表どおり。plan Task 3 の Must it は attempts0 / shortWindow / null。disabled は successBlocked 既存。回帰リスクは低 |
| M2 | Minor | 65 | possible FP / テスト弱さ | regen `does not treat null attemptsRemaining as blocked` は文言非表示のみで、`toBeEnabled()` を直接 assert しない | 誤って null を block すると attempts0 文が出て fail する。実装は `=== 0`。実質ガードあり |
| M3 | Minor | 55 | possible FP / 冗長 UX | 認証済み short-window 失敗時、failure message（待ち促し）+ Terminal shortWindow 待ち文 + パネル `再開:` が並び得る | 設計が message 無時刻 + UI retryAt Must + Terminal shortWindow を併記許容。仕様内 |

### 意図的非指摘

- `generation-page.tsx:25` コメントの「AI 通信試行残数」— 利用者向けリテラルではない（plan: コメント歴史語はゼロ必須でない）。
- Terminal が success remaining=0 でも受け付け行を出す — 設計の hide 条件は確認画面の常時行に限定。
- 再生成 success 文が「受け付け」口調でない — Non-Goal / D-I9。
- freemium §2.1 旧表の残置 — L10 は superseded 注記で足りる。
- Task 3 と Task 4 が同一 commit（`a9c0201`）— プロセス上の統合であり製品欠陥ではない。
- MVP §10.3/§14 旧文との衝突 — 本設計の Supersede が正（実装レビューの差し戻し根拠にしない）。

---

## 受け入れ表照合（要約）

| シナリオ | 実装 | テスト |
|----------|------|--------|
| 確認 success3 / attempts6 → 受け付け1行のみ | ✓ | wizard |
| attempts0 → 受付停止 + 常時行 hide + CTA off | ✓ | wizard |
| success0 | ✓ | wizard |
| success0∧attempts0 → success0 のみ | ✓ | wizard |
| short/global のみ → 常時行残る | ✓ | wizard |
| 再生成 attempts0 / shortWindow disable | ✓ | regen tests |
| issueMessages 新文言 + 禁止断片 | ✓ | contracts test |
| failureCopy ≡ issueMessages | ✓ | service test |
| 未減 UI 1 行 | ✓ | status-panel test |
| 無料版は本日は 禁止 | ✓ | free-tier.test |
| retryAt userId あり | ✓ | status-panel test |
| e2e duplicate_output 新文言 | ✓ | history-regeneration.spec |

---

## 結論

**Verdict: APPROVE**

- Critical: **0**
- Important: **0**
- 設計 L1–L10・受け入れ表・plan Must（一致 assert / 案 A / success0 優先 / retryAt / 横断 jargon 除去）を満たす。
- Residual M1–M3 は任意改善。修正必須の true positive は無い。
