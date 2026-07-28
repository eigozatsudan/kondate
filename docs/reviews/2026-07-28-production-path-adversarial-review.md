# 敵対的レビュー: 本番経路コード変更（2026-07-28）

**範囲:** `dca058f..219d953` のうち本番に効く差分  
package: `.superpowers/sdd/review-package-prod-path-dca058f-219d953.md`

| 変更 | ファイル |
|------|----------|
| temperature 非送信 | `openrouter.ts` |
| 品数/内部構造 → `invalid_menu_structure` | `generation-materializer.ts` |
| 品数・役割 prompt 契約 | `generation-prompt.ts` |
| P\*=$4 | `verify-openrouter-models.mjs` 他 |
| freeze / recommended models | `benchmark-paid-openrouter-models.mjs` |

**一次レビュー:** feature-dev:code-reviewer（独立）  
**二次レビュー:** feature-dev:code-reviewer（独立・deep）

---

## 総合判定

| 時点 | 判定 |
|------|------|
| レビュー直後 | **REVISE**（一次 C-1） / 二次 **APPROVE_WITH_NITS** |
| C-1 修正後（本記録） | **APPROVE_WITH_NITS**（残は運用・ドキュメント） |

---

## Critical（修正済み）

### C-1. temperature 削除と openrouter-mock の dual-contract 破綻

**一次 verdict:** Critical  
**根拠:** 本番 body から `temperature` を外した一方、mock が exact keys + `temperature === 0.2` を要求 → ローカル Functions→mock が 4xx → `model_unavailable`。

**修正（同セッション）:**
- `tools/openrouter-mock/server.mjs`: expected keys から `temperature` 削除、値チェック削除
- `server.test.mjs`: 有効 request を本番と同型に。`temperature` は **extra field として拒否**
- vitest `tools/openrouter-mock/server.test.mjs` **34 pass**
- vitest `openrouter.test.ts` **73 pass**

---

## Important（コード論理は安全・運用注意）

### I-1. luna 単独 freeze = repair 相手なし（二次）

- N=10 単独 PASS は設計上合法
- 失敗時は exclude 後 eligible 0 → `invalid_ai_response`（2-ID の安全網なし）
- N=10 は **idea のみ**（household 未カバー）
- **運用:** env は意図した exact config を明示。dual を載せるなら **その dual 自体の N=10 PASS** が必要（luna+nano は FAIL 済み）

### I-2. `modelListRules` 散文が $0.5 のまま（二次）→ **修正済み**

- 実行時は `maxPromptPlusCompletionUsdPerMillion = 4` が正本
- `scripts/openrouter-models-contract.mjs` の `modelListRules` を **≤ 4.00** に更新

---

## 一次・二次が合意した「問題なし」

| 項目 | 結論 |
|------|------|
| temperature 省略 + require_parameters 維持 | luna 404 の正しい原因対処。決定性は schema/prompt 側（残差: 品質ばらつき） |
| `invalid_menu_structure` へ切替 | fail-closed 維持。repair 集合内。誤成功パスなし |
| 品数 early check vs schema superRefine | **同一** `dinner?3:2` |
| P\*=4 検証ゲート | 定数・境界テスト更新済み |
| 本番 body の他パラメータ | temperature 級の地雷は現状なし（stream は非原因） |
| 敵対的 menu（1 品 / pantry 捏造 / UUID） | 既存 fail コードで拒否 |

---

## Minor

1. dinner 品数の materializer 単体テストが薄い（breakfast under-count 中心）
2. Plan 3 歴史文書が materializer 構造失敗を `invalid_provider_menu` と記載（docs 債務）
3. probe が temperature 付きのまま → **本番同型に修正済み**（false exclusion 防止）
4. 品質レビュー doc に luna 404 の古い記述が残る可能性（履歴として可）

---

## 仕様適合チェックリスト

| 制約 | 結果 |
|------|------|
| OpenRouter は Functions のみ | PASS |
| require_parameters: true | PASS |
| strict response_format | PASS |
| SO AND RF デプロイゲート | PASS |
| free/router 拒否 | PASS |
| materialize fail-closed | PASS |
| 品数 朝/昼 2・夕 3 | PASS |
| P\* 単一 export = 4 | PASS |
| Functions ↔ mock dual-contract | **PASS（C-1 修正後）** |

---

## 残リスク（出荷前の運用）

1. `OPENROUTER_MODELS` を freeze 済み exact 構成に合わせる（推奨: luna 単独、または 4.1-mini / mercury）
2. 本番相当 body で smoke（temperature 無し）
3. household を同時出荷するなら idea 以外の smoke を別途
4. P\*=4 で機械通過が増える → **N=10 未通過 ID を env に載せない**運用を維持

---

## 一次 vs 二次

| 論点 | 一次 | 二次 |
|------|------|------|
| temperature 修正の本番正しさ | 概ね PASS | CONFIRM |
| mock dual-contract | **Critical** | 本レビューでは mock を深追いせず、二次は ops nits 中心 → **一次が正、修正実施** |
| structure code remap | 非 Important | CONFIRM safe |
| luna 単独推奨 | 非 Important | Important 運用残差 |
| modelListRules $0.5 | — | Important 散文 → 修正 |

**結論:** Critical C-1 を修正したうえで、本番経路コードは **出荷可能な品質（残は運用 Nits）**。

---

## 二次再レビュー（C-1 修正後・2026-07-28）

**package:** `.superpowers/sdd/review-package-c1-fix-219d953-2f784cb.md`  
**対象 commit:** `2f784cb`（mock dual-contract + modelListRules + probe）

| レビュー | 判定 | C-1 |
|----------|------|-----|
| 二次（deep） | **APPROVE** | **CLOSED** |
| 新鮮一次相当 | **APPROVE** | **CLOSED** |

### 再確認したこと

| チェック | 結果 |
|----------|------|
| 本番 body keys == mock expectedBodyKeys | **PASS**（5 keys・exact set） |
| mock が temperature を extra として 400 | **PASS**（テストあり） |
| require_parameters / stream / free models / response_format | **PASS**（緩めず維持） |
| 本番・e2e 経路が temperature を再送信しない | **PASS**（repo 走査） |
| modelListRules ≤ $4.00 | **PASS** |
| probe の temperature 削除 | **PASS** |

### 残 Minor のみ

1. Plan 3 歴史文書が temperature 必須を記載（docs 債務）
2. probe の `max_tokens: 32` は本番に無い（診断の意図的差分。mock には当たらない）

### 検証

```
vitest tools/openrouter-mock/server.test.mjs + openrouter.test.ts → 107 pass
```

**最終判定（本番経路 + C-1 修正）: APPROVE**（残は運用・docs nits）。
