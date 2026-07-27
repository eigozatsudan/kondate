# Plan 8 response-format 改訂 — クローズまとめと残課題

**日付**: 2026-07-27  
**ブランチ**: `plan8/response-format-revision`  
**最終 HEAD（本まとめ作成時点）**: `cc61b08`  
**Plan**: `docs/superpowers/plans/2026-07-27-paid-openrouter-response-format-revision.md`  
**承認済み改訂**: `docs/superpowers/specs/2026-07-27-paid-openrouter-response-format-revision-proposal.md`  
**親設計**: `docs/superpowers/specs/2026-07-26-paid-openrouter-models-design.md`  
**Live 証跡**: `docs/bugfix/2026-07-27-plan8-production-gate-evidence.md`（第4ラウンドが現行ゲート正本）

---

## 1. 結論（1 行）

**実装 Plan は完了。本番 OpenRouter モデル構成は未確定のまま。本番 ship はブロック。**

| 観点 | 状態 |
|------|------|
| Tasks 6–9（改訂 Plan） | **完了**（検証・両レビュー済み） |
| Live exact 構成 N=10 | **不合格**（合格 0 / 3 構成） |
| 本番 `OPENROUTER_MODELS` 確定 | **不可** |
| 本番デプロイ | **しない** |
| 次 Task（本 Plan 内） | **なし**（handoff 不要） |

---

## 2. この Plan で達成したこと

response-format / 合格単位の改訂を、承認済み設計どおりに実装し、再ゲートまで通した。

| Task | 内容 | 代表コミット |
|------|------|----------------|
| 6 | validator / repair 診断を closed code で欠落なく渡す | `0974743` |
| 7 | root object wire 受理、HTTP 200 限定、19,999/20,000ms と失敗 precedence | `6f86848`, `e7d113e`, `5ca4260` ほか |
| 8 | production-service harness・fresh ledger・exact 順序付き構成ベンチ | `662f1e5` … `c5d4478` |
| 9 | 有料 live N=10 再評価と証跡（合格なしのため推奨 env は未更新） | `cc61b08` |

### ロックを維持したもの（改訂で動かしていない）

- クォータ 3 / 6 / 20
- per-send 20s・送信前残 22s・単位 50s・repair 最大 1
- 単価上限 prompt+completion ≤ $0.50 / 1M
- 公式 base exact: `https://openrouter.ai/api/v1`
- 有料 allowlist（公式 base 上で `:free` / router ID 拒否）
- Gemini 候補外・pantry prompt の本番文言大改訂はスコープ外（改訂提案どおり）

### ローカル品質ゲート（Task 9 提出ゲート）

format / lint / typecheck / vitest / db-test / e2e / build / `git diff --check` は **PASS**（有料実行後に mock env へ戻し、固定名競合を解消したうえで再実行）。

---

## 3. Live ゲート結果（現行・第4ラウンド要約）

実行: `docker compose run --rm --no-deps app node scripts/benchmark-paid-openrouter-models.mjs`  
HEAD（実行時）: `c5d4478` / exit **1** / hard limit **$1**（operator 確認）

| Exact configuration（順序固定） | 結果 | closed failure |
|----------------------------------|------|----------------|
| `["openai/gpt-4.1-nano"]` | unit 1 FAIL | `invalid_ai_response` |
| `["openai/gpt-4.1-nano", "meta-llama/llama-3.1-8b-instruct"]` | unit 1 FAIL（primary+repair） | `invalid_ai_response` |
| `["openai/gpt-4.1-nano", "openai/gpt-oss-120b"]` | unit 1 FAIL（repair timeout） | `generation_timeout` |

- `passedConfigurations`: なし  
- `recommendedConfiguration`: なし  
- README / `docs/runbooks/openrouter.md` の本番推奨: **未更新（正しい no-pass 扱い）**  
- 個別 ID 結果の再結合による推奨構成の合成: **禁止・未実施**

詳細（per-send models / responseModel / excludedModel / elapsed）は証跡 §第4ラウンドを正とする。API キー・prompt・raw model output は証跡に含めない。

---

## 4. 残課題リスト

優先度は「本番 ship を阻む順」。いずれも **本 Plan の未完 Task ではなく、次の設計判断または別 Plan の題材**。

### P0 — 本番ブロック（必須で解く）

1. **N=10 を通る exact 順序付き構成が 0 本**  
   - 現状の 3 構成では production harness 上で 1 単位目から失敗。  
   - 合格が出るまで本番 `OPENROUTER_MODELS` を確定・デプロイしない。

2. **本番推奨 env の未確定**  
   - README / runbook の例は「合格した exact 構成に置換」前提のまま。  
   - 例示 ID を合格扱いしないこと。

### P1 — 失敗クラスに応じた次設計（人間がテーマを1つ選ぶ）

| ID | テーマ | 第4ラウンドからの根拠 | 注意 |
|----|--------|----------------------|------|
| R1 | **候補モデル / exact 構成の差し替え** | nano 単独でも `invalid_ai_response`。2 本構成でも 10/10 未達 | 設計 shortlist と構成リストの改訂が先。再結合禁止 |
| R2 | **prompt / materialize 整合の改訂** | 過去ラウンドでも pantry 名単位・duplicate_ref 等が主因だった。wire 通過後の意味検証失敗が残る | locked contracts / 本番文言に波及し得る。設計承認必須 |
| R3 | **単価上限 $0.50/1M の見直し** | 上位帯へ候補を広げたい場合のみ | §4.1.7 ロック変更。ゲート緩和ではない |
| R4 | **closed code だけの追加診断**（合否に使わない） | `invalid_ai_response` の内訳を診断コード粒度で切り分ける | raw output 禁止。課金・hard limit 再確認。合格推定に使わない |

**推奨しないこと**

- 時間 20s/50s や quota 3/6/20 を「通すため」に緩める  
- 合格していない構成を合成して本番 allowlist にする  
- 同じ 3 構成を根拠なく繰り返して課金する  

### P2 — 運用・統合（任意・後回し可）

| ID | 項目 | 状態 |
|----|------|------|
| O1 | 本ブランチの main への取り込み方針 | 未決。実装（wire/harness）は有用だが、**モデル未確定のまま ship しない**条件を PR/マージ説明に明記する必要あり |
| O2 | 有料実行用 `.env` の扱い | Task 9 後 worktree は **mock に復元済み**。次回 live 時のみ funded key + 公式 URL + hard limit 確認 |
| O3 | 複数 worktree の Compose 固定名競合 | Task 9 検証で `plan8-paid-openrouter` を down して解消。並行スタック時は固定名を奪い合う |
| O4 | 証跡ドキュメントの履歴節 | 第1ラウンド節は履歴ラベル済み。旧「次アクション」は第4ラウンド反映済み。追加の整理は任意 |

### 明示的にスコープ外のまま残しているもの

- Gemini 系の schema 複雑度問題の本対応  
- pantry prompt の本番大改訂（R2 を別 Plan で採る場合のみ対象）  
- OpenRouter 以外のプロバイダ移行  

---

## 5. Plan クローズ判定

| 判定項目 | 結果 |
|----------|------|
| 改訂 Plan の全 Task（6–9）実施 | **Yes** |
| 設計どおり no-pass 時に ship しない | **Yes** |
| 本番モデル構成の確定 | **No**（残課題 P0） |
| 本 Plan を「実装完了・本番未確定」で閉じる | **Yes（本ドキュメントをもってクローズ）** |

**クローズ文言**

> Plan 8 response-format 改訂は、承認済み改訂 A/B/C の実装と live 再ゲート証跡まで完了した。  
> live exact 構成 N=10 は合格 0 のため本番 OpenRouter 構成は未確定であり、本番 ship はブロックのままとする。  
> 以降の作業は本 Plan の Task 継続ではなく、§4 残課題からテーマを選んだ **新規設計 / 別 Plan** とする。

---

## 6. 次の人間判断（クローズ後の入口）

どれか **1 つ**を次テーマに選ぶ（複数並行は課金と設計衝突のリスク）。

1. **R1** — 候補 ID / exact 構成の再選定設計  
2. **R2** — prompt / materialize 整合の設計  
3. **R3** — 単価上限ロック見直しの設計  
4. **R4** — 秘密を出さない診断手順だけの短い設計  
5. **O1** — 実装ブランチの取り込み方針だけ決める（ship は別）  
6. 本線を離れ、他 Plan（例: 素材クイック選択）へ戻る  

選んだテーマが決まるまで、有料 N=10 の再実行と本番 env 更新は行わない。

---

## 7. 参照索引

| 種類 | パス |
|------|------|
| 改訂提案（承認） | `docs/superpowers/specs/2026-07-27-paid-openrouter-response-format-revision-proposal.md` |
| 実装 Plan | `docs/superpowers/plans/2026-07-27-paid-openrouter-response-format-revision.md` |
| 親設計（有料モデル） | `docs/superpowers/specs/2026-07-26-paid-openrouter-models-design.md` |
| Live 証跡 | `docs/bugfix/2026-07-27-plan8-production-gate-evidence.md` |
| Runbook | `docs/runbooks/openrouter.md` |
| ベンチ | `scripts/benchmark-paid-openrouter-models.mjs` |
