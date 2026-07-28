# openai/gpt-5.6-luna を本番経路で使えるようにする（2026-07-28）

## 症状

`provider.require_parameters: true` 下で chat が **404**  
`No endpoints found that can handle the requested parameters`  
→ 台帳上は `model_unavailable`。

## 原因切り分け

| リクエスト | 結果 |
|------------|------|
| plain / menu schema **のみ** | 200 |
| menu schema + **require_parameters** + **temperature: 0.2** | **404** |
| menu schema + require_parameters + **temperature なし** | **200** |
| require_parameters + temperature のみ | 404 |

Models API 上の `openai/gpt-5.6-luna` の `supported_parameters` に **`temperature` が無い**。  
`require_parameters: true` は「送ったパラメータをすべてサポートする endpoint だけ」に限定するため、  
本番が送っていた `temperature: 0.2` が **ルーティング不能**の直接原因。

schema 自体や `require_parameters` のロックが原因ではなかった。

## 修正

`netlify/functions/_shared/openrouter.ts`: リクエスト body から **`temperature` を削除**。

- `require_parameters: true` 維持
- strict `response_format` 維持
- 決定性は schema / prompt 側で担保

## 修正後の live

| 確認 | 結果 |
|------|------|
| ルーティング | `responseModel: openai/gpt-5.6-luna`（404 解消） |
| N=1 closed（初回） | たまに `dangling_ref`（参照不整合） |
| **N=10 単独** | **PASS 10/10** primary_success（~6–14s） |
| N=10 `luna + gpt-4.1-nano` | FAIL u5（primary dangling 後 nano repair も conflict） |
| quality サンプル | 成功時は照り焼き＋副菜など **手順・材料が厚い**（4.1-mini 級） |

→ **本番候補として単独 freeze 可。**  
recommended: `OPENROUTER_MODELS=openai/gpt-5.6-luna`（$3.50/1M）

## freeze 更新

- `paidOpenRouterModelConfigurations` 先頭に `["openai/gpt-5.6-luna"]`
- 予備: gpt-4.1-mini / mercury-2 / mercury+nano / grok-4.3

## 回帰

- `openrouter.test.ts`: temperature 非送信を固定
- 既存モデル（mercury / 4.1-mini 等）は temperature 無しでも require+schema で 200 を確認済み（切り分け時 mercury 対照）
