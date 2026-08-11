# Triple review: `ab45e94`

**SHA:** `ab45e94ec4a219ec85693454212e2f0ae7bbccc9`  
**Subject:** `refactor(e2e): AI 共有枠リセットを生成直前のみにする`  
**Parent:** `eb57b3a`  
**Worktree:** `/home/dev/projects/kondate`  
**Diff authority:** `.superpowers/sdd/review-eb57b3a..ab45e94.diff`  
**重点:** AI truncate 位置

---

## 1次レビュー

### 要約

Phase 2 §6.5: auth fixture 入口の **毎回** `private.ai_global_daily_usage` truncate をやめ、外部 AI 送信（generate）直前の `ensureAiQuotaForGeneration()` のみにする。製品 `GLOBAL_DAILY_AI_LIMIT` は不変。旧名は deprecated alias。

### 変更面

| ファイル | 内容 |
| --- | --- |
| `reset-global-ai-quota.ts` | `ensureAiQuotaForGeneration` 本体 + `resetGlobalAiQuotaForE2e` alias |
| `auth.ts` | authenticated / completed / idea から truncate **削除** |
| `history.ts` | seedGenerated* が ensure を呼ぶ（リネーム） |
| `shopping.ts` | `generateShoppingMenu` ensure |
| `full-journey` / `generation-recovery` / `mobile-accessibility` / `shots/flows` | generate 直前 ensure |

### Spec §6.5 / §6.6 チェック

| 項目 | 判定 | 根拠 |
| --- | --- | --- |
| fixture 入口 truncate なし | **OK** | 3 fixture から削除 |
| 生成直前 ensure | **主要 OK** | seed 生成ヘルパ + 主要 generate click 経路 |
| 製品 limit 不変 | **OK** | truncate のみ。compose 非接触 |
| 非生成 test が枠を触らない | **OK** | settings 等は ensure 無しで成立（report 検証あり） |
| 再生成ヘルパ ensure | **ギャップ** | `requestWhole/DishRegeneration` / `regenerateWholeMenu` は未 |

### Findings

#### Important（低め / residual）

**I-regen. 再生成ヘルパが `ensureAiQuotaForGeneration` を呼ばない**  
**Confidence: 82**

- 契約文言は「外部 AI 送信直前」。再生成も外部送信。
- 現行 callers は同一 test 内で直前 seed/初回 generate が ensure 済み。workers=1・GLOBAL 20 では 2–3 回で枯渇しにくい。
- Phase 2 完了ブロッカーではない。回帰しやすい契約抜けとして記録。

#### Minor

- `completeMinimumPlanner` の ensure は settings 編集の前（「送信直前」より早い）。workers=1 では実害低。
- deprecated alias 残置は互換意図どおり。

### 重点

| 焦点 | 結果 |
| --- | --- |
| storageState / dependsOn | **非対象**（本 diff は e2e fixture/spec の AI 枠のみ） |
| seed と safety | 非対象（親 seed の I1 は未修正のまま残存） |
| AI truncate 位置 | **fixture 入口除去 OK**。主要 generate に配置。regen residual |

### 1次判定: **APPROVE_WITH_NITS**

§6.5 の中核は満たす。I-regen は Minor 寄り Important residual。

---

## 敵対的レビュー

### 攻撃シナリオ

| # | シナリオ | 判定 | 根拠 |
| --- | --- | --- | --- |
| A1 | 非生成 test が入口 truncate で枠を空にする（無駄 / 将来並列で他 worker 破壊） | **反証（本 commit）** | 入口削除済み。Phase 3 並列時の本 truncate 自体が危険になるのは別 Phase |
| A2 | 生成経路で ensure 欠落 → mid-suite `global_daily_limit` | **主要経路は反証 / regen は残存** | seed/full-journey/shopping/mobile/recovery はカバー |
| A3 | ensure が製品 limit を書き換える | **反証** | `truncate private.ai_global_daily_usage` のみ |
| A4 | alias 経由で fixture が再導入される | **現状反証** | 入口から削除。alias は同一関数 |
| A5 | shots が ensure 無しで枠枯渇 | **反証** | `advanceToReviewWithHousehold` に ensure |
| A6 | idea servings 経路だけ ensure 忘れ | **反証** | generation-recovery idea に追加 |
| A7 | completeMinimumPlanner の ensure が generate と遠い | **弱成立** | 同一ヘルパ内で後続 click。workers=1 では実害低 |

### 敵対判定: **PASS_WITH_RESIDUALS**

Critical な入口 truncate 退行・製品 limit 改変は反証。regen ギャップは residual。

---

## 2次検証

| 主張 | 判定 | 根拠 |
| --- | --- | --- |
| fixture 入口 0 truncate | **CONFIRMED** | auth.ts 三箇所削除 |
| 初回 generate ensure 配置 | **CONFIRMED** | history/shopping/full-journey/recovery/mobile/shots |
| I-regen | **CONFIRMED residual** | request*Regeneration / regenerateWholeMenu に ensure 無し。callers は直前 seed 依存 |
| 製品 limit 非接触 | **CONFIRMED** |
| Critical 過大なし | **CONFIRMED** |
| Task 8 初回「Findings なし」 | **PARTIAL** | 再生成ギャップを Minor/residual として記録すべきだったが、ブロッカー昇格は過大 |

### 2次最終: **APPROVE_AS_IS**（Phase 2 完了条件上）

- §6.5 中核合格。
- I-regen は Phase 3 前の任意強化 / Phase 3 で per-test ensure 廃止時に自然消滅する経路。

---

## 統合結論

| 軸 | 結果 |
| --- | --- |
| Critical | 0 |
| Important residual | regen ensure 欠落（低実害） |
| **Verdict** | **APPROVE_WITH_NITS / PASS_WITH_RESIDUALS** |

PRIMARY_ADVERSARIAL_SECONDARY_COMPLETE
