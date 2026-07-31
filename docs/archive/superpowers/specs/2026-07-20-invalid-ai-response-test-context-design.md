# Task 14 E2E `invalid_ai_response` 修正設計

## 目的

Plan 3 Task 14 の `generation-recovery-results.spec.ts` が、正常なローカル
OpenRouter mock応答を受信しているにもかかわらず `invalid_ai_response` で終端する問題を、
productionの安全検証を緩めずに解消する。

## 確認済みの根本原因

E2E Function ServerからローカルOpenRouter mockまでのHTTP経路は到達している。
失敗した生成ledgerにはprimaryとrepairの両model ID、2回の送信、repair実行済みが記録されて
いるため、OpenRouter envelope、`message.content`、AI応答schemaの解析は成功している。

失敗は、その後のmaterialize・決定論的validator境界で発生する。固定 `success` fixtureは
次の条件を前提にしている。

- 食事区分は朝食。
- 主菜と副菜の2品構成。
- 対象メンバーは小麦アレルギー登録済みで、しょうゆのラベル確認が必要。

一方、現在のE2E入力は夕食かつアレルギーなしである。この組み合わせでは少なくとも
`meal_type_mismatch`、夕食の必須料理区分不足、不要なlabel confirmationが検出され、
primaryとrepairの同一固定応答が両方とも拒否される。サービスは設計どおり、最終的に
`invalid_ai_response` を返す。

## 採用する修正

固定mockやproduction validatorを変更せず、E2Eの前提データを固定 `success` fixtureへ合わせる。

1. `completeMinimumPlanner()` が設定画面で対象メンバーの呼び名を設定する。
2. 同じメンバーを「アレルギー登録済み」とし、小麦を登録する。
3. plannerの食事区分を朝食にする。
4. メイン食材「鶏肉」とジャンル「和食」は維持する。
5. 自動保存完了後に生成を開始する。

これにより、固定fixtureのラベル確認表示をE2Eで実際に検証しつつ、安全validatorの契約を
そのまま保つ。

## E2E同期設計

ブラウザの接続断を再現するテストでは、固定時間待ちを成功条件にしない。POST到達、応答、
またはgeneration statusのterminal状態という観測可能な条件を同期点にする。

- 初回POST喪失: 初回abort完了を待ってreloadし、同じidempotency keyで再送されたことを
  正確に2回のPOSTとして確認する。
- POST応答喪失: サーバー側の処理を成立させつつクライアント応答だけを失わせ、status APIが
  terminalになることを待ってから復旧を確認する。
- タブ破棄: POSTがサーバーへ到達したことを同期点にしてタブを閉じ、再オープン後に保存済み
  pending commandからstatusを回収する。

Playwrightの `route.fetch()` はこの環境で誤った404を返す場合があるため、必要なケースを除いて
`route.continue()` とresponse/status観測を優先する。任意の数秒待機だけでDB永続化を推測しない。

## 変更範囲

対象はTask 14の検証ハーネスに限定する。

- `e2e/specs/generation-recovery-results.spec.ts`
- `tools/e2e-function-server.mjs`
- `tools/e2e-function-server.test.mjs`
- `netlify/functions/_shared/generation-adversarial.integration.test.ts`

既存の未コミット差分は破棄せず、内容を個別に検証して必要な部分だけ残す。

## 非対象

- productionの `openrouter.ts`、materializer、validatorの挙動変更。
- 固定 `success` fixtureの意味変更。
- `/menus/:menuId` のrouter結線。これはPlan 3 Task 15の責務として維持する。
- schema、migration、RLS、quota契約の変更。
- 実OpenRouterへの通信。

## エラー処理と安全性

productionログへAI応答、prompt、家族情報、アレルギー情報を追加しない。調査用ログが必要に
なった場合も、固定コード・request ID・model ID以外を出力せず、コミット前に削除する。
validatorを迂回したり、`invalid_ai_response` を成功へ読み替えたりしない。

## テスト戦略

1. 現在のE2Eが `invalid_ai_response` で失敗するRED証拠を保持する。
2. E2E前提を固定fixtureへ合わせ、生成APIが `succeeded` へ到達することをfocused実行で確認する。
3. E2E Function Serverのルートと任意path parameter対応をNodeテストで確認する。
4. adversarial統合テストが実local HTTP mock境界を通り、全terminal scenarioを拒否することを
   focused Vitestで確認する。
5. format、lint、typecheck、full Vitest、DB reset、pgTAP、E2E、build、diff-checkを順番に実行する。

Task 15未実装の `/menus/:menuId` だけが残る場合は、生成成功との境界を実測で区別し、Task 14の
成功として過大報告しない。
