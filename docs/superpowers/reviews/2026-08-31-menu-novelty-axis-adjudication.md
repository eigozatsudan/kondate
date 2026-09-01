# 献立ひねり軸（noveltyPreference）設計 — 指摘裁定

- 日付: 2026-08-31
- 裁定者: 親エージェント
- 対象: 一次レビュー、敵対的レビュー、二次検証
- 最終判定: **REVISE。Critical 0。確定 Important 5 系統を Spec へ反映するまで Implementation Plan 作成は禁止。**

## 1. 裁定方法

各指摘を現行 migration / Function / contract、レビュー間の独立再現、二次検証、親の再照合へ当てた。
同一原因は重複統合し、攻撃の成立条件が現行コードですでに閉じている項目は偽陽性、仕様が明示的に
受容している効きの弱さは受け入れ残差とした。

主要な再現根拠:

- `save_generation_draft` 最終定義（`20260730120000_ingredient_preference.sql` 23–116 行）は
  `public.generation_drafts` だけを更新する。`generation_draft_submission_versions` へは書かない。
- snapshot を書く現行正本は `20260808120000_quality_monthly_retry_and_usage_stale_cleanup.sql`
  155–165 行の `reserve_ai_generation` INSERT。20260808 より後に reserve を再定義する migration は無い。
- snapshot 読取は `get_ai_generation_submission_snapshot` のみ
  （`generation-context.ts` 275–277 行）。`snapshotRowSchema` は `.strict()`（63–81 行）。失敗は
  `invalidRequest()` → HTTP 422（282–283、141–142 行）。
- 現行 `save_generation_draft` は 13 引数。`20260730120000` の DROP は当時の 12 引数。
  Postgres の `DROP FUNCTION` はシグネチャ単位。
- Postgres Meta は RPC の nullable 引数を非 null と誤る。`p_ingredient_preference` は generated が
  `string`、overlay が `| null`（`database.ts` 20–36 行、`database.generated.ts` 3195 行）。
- `PromptPreferences` と `buildBaseGenerationMessages` は kind 非依存。再生成は base の user JSON を使う
  （`generation-prompt.ts` 21–32、353–370、493–543 行）。
- `DIVERSITY_HINTS_ENABLED = true as const`（`diversity-hints.ts` 6 行）。env ではない。
- `normalizeFoodText` 実測（`docker compose run --rm --no-deps app node`）:
  `豚肉`→`豚肉`、`ぶた肉`→`ぶた肉`、`ブタ`→`ぶた`、`ブタ肉`→`ぶた肉`。
  `豚肉 === ぶた肉` は false。`ブタ === ぶた` は true。

## 2. 確定・統合した指摘

| 統合ID | 元ID | 最終severity | 裁定 | Spec へ書くこと |
| --- | --- | --- | --- | --- |
| F-01 | P-I-1 / A-I-01 | Important | 「submission snapshot へ写す」を save に付けたのは誤帰属。save だけ足すと twist は常に null。snapshot RPC だけ足して `.strict()` を更新しないと全 new_menu が 422 | 列 CHECK に加え、現行 20260808 reserve の INSERT 列に `novelty_preference` を足す。`get_ai_generation_submission_snapshot(uuid, uuid)` を DROP→CREATE。`snapshotRowSchema` / `mapSnapshot` を必須面にする。20260730 の reserve 本体は再利用禁止 |
| F-02 | A-I-02 / P-I-2 | Important | UI と契約だけでは twist が persist / 再読込 / 送信で落ちる。generated 再生成だけでは `null` 未選択を型で送れない | overlay に `p_novelty_preference`、`planner-api` の select/map/RPC/keepalive、`toDraftInputFields`、`planner-route` の emptyDraft / toPlannerDraftInput / submissionCandidate、factories、emergency / revalidation 等のダミー submission。`database.generated.ts` 手編集禁止は維持 |
| F-03 | P-I-3 / A-I-03 | Important | 20260730 の 12 引数 DROP をなぞると現行 13 引数が残り overload になる。reserve 本体の丸ごと置き換えは quality monthly retry を巻き戻す | DROP 対象は現行 13 引数をリテラルで書く。CREATE は 14 引数（`p_novelty_preference` 追加）。GRANT/REVOKE、pgTAP 位置引数、`rls_inventory` exact シグネチャを §7 必須にする |
| F-04 | A-I-04 / P-M-4 | Important | `PromptPreferences` 追加は再生成 user JSON を黙って変える。§2.2「再生成は触らない」と §5.1「user payload にも載せる」は現行 builder では両立しない。kill-switch を段落だけにすると dual-channel が残る | 再生成 payload から落とすか、「JSON に残っても段落も効きもしない」と製品として固定する。kill-switch は `true as const`。off 時は段落も preferences キーも落とす（多様性と同型）。`expectExactKeys` をテスト契約にする |
| F-05 | A-I-05 / P-M-2 | Important | 仕様 §6 の「豚肉／ぶた肉／ブタを吸収」は `normalizeFoodText` 単体では偽。新しい正規化関数禁止と組み合わせると、初版から名指し除外が構造的に外れる | 吸収は alias 列挙。照合は正規化後の**完全一致**（部分一致禁止）。複数メインは `stapleDishes` 和集合のち件数上限。上限整数を仕様か Task 0 で固定する |

二次検証が A-I-03 本文を「現行 14 引数」と読んだ点は、敵対的レビューの誤記ではない。敵対的 I-03 は「現行関数が残ったまま別シグネチャが増える」と書いており、新しい CREATE が 14 引数になる、という読みで成立する。overload 指摘自体は確定（F-03）。

## 3. 偽陽性・重複・受け入れ残差

| 項目 | 裁定 | 理由 |
| --- | --- | --- |
| P-I-2 | **Duplicate** | F-02（A-I-02）へ統合 |
| A-I-01 | **Duplicate** | F-01（P-I-1）へ統合 |
| A-I-03 | **Duplicate** | F-03（P-I-3）へ統合。引数本数の補助説明の揺れは根を消さない |
| P-M-2 / P-M-4 | **Duplicate** | F-05 / F-04 へ包含 |
| 安全ハードゲート迂回（novelty を validate に載せない） | **False positive** | 「載せない」は安全を弱めない。アレルゲン・food-rules・必須 role・時間は現行のまま発火する |
| novelty-only `constraint_conflict` で他ゲート無効化 | **False positive** | CORE は閉じた conflict 理由。モデルが success でアレルゲン違反を返しても server validate が落とす |
| safety fingerprint / quota / HMAC への混入 | **False positive** | fingerprint はメンバー安全のみ。HMAC canonical は下書きフィールド値を含めない。quota は identity 日次台帳 |
| 導入前 snapshot のキー欠損 422 | **False positive** | `.default(null)` は `ingredientPreference` と同型で足りる。ただし F-01 の `.strict()` 余剰キーは別問題 |
| プロンプト注入で除外リスト汚染 | **False positive** | 除外は静的 `stapleDishes`。user 文字列をカタログへ連結しなければ既存メイン食材と同程度 |
| bidi / Cf による辞書回避 | **False positive** | `normalizeFoodText` は `\p{Cf}` を落とす |
| 空 `mainIngredients` + twist | **False positive** | submission は min 1 |
| RPC SQL インジェクション / `"creative"` | **False positive** | ingredient_preference と同型の CHECK + `22023` で足りる |
| プロンプト・除外リストのログ漏洩 | **False positive** | `SafeLogEvent` に prompt / 食材名キーは無い。enum 追加は新しい自由文列を作らない |
| カタログのブラウザ import | **False positive** | Functions 閉じは所有境界どおり。`src/` から `netlify/functions/_shared` を import する経路は無い |
| temperature / 2 パス | **False positive** | 仕様が対象外として正しく閉じている |
| overlay 不要 | **False positive（反論側）** | テーブル Row は nullable だが RPC Args は generated が `string`。未選択 `null` 送信に overlay が要る |
| `.strict()` は余剰キーを落とすだけ | **False positive（反論側）** | Zod `.strict()` は未知キーを拒否し、422 になる |
| 後続 migration が reserve を置き換えた | **False positive（反論側）** | 20260808 が最終 |
| A-M-04 `role=side` 付け替え | **Accepted residual** | hard gate 対象外。仕様 §9 の効きの弱さと一致。Important に上げない。一文で「検証しない」と書いてよい |
| 結果画面にひねり非表示 | **Accepted residual** | 仕様 §2.2 の製品判断。定番が返っても失敗と気づかないのは fail-open の帰結 |
| 辞書の隙間（豚こま肉 等） | **Accepted residual** | 完全一致 + alias 手列挙でも残る。2 パスに進まない判断は維持 |
| P-M-1 除外件数上限が未固定 | **Minor（計画非停止）** | Task 0 で整数を固定すれば足りる。F-05 の照合契約とは別 |
| P-M-3 field 名前空間 / wizard テスト | **Minor** | 未登録でも nullable enum なら 422 にはなりにくい。§4/§7 にテストパスを足す |
| A-M-01 「隣に」横並び | **Minor** | 現行追加条件は縦積み。仕様は「次の `.field`」と書く |
| A-M-02 未選択ラベル | **Minor** | `null === standard` なので機能バグではない。材料の使い方の「指定なし」に合わせるか明示する |
| A-M-03 kill-switch を env と読む | **Minor** | F-04 の off 時 dual-channel とは別。`true as const` と一文あれば足りる |
| A-M-05 `selected_only` + twist | **Minor** | 既存 soft 制約と同型。preferences 内の優先を一文あると実装が割れない |

敵対的レビュー §6 の「成立しない攻撃」は、親の再照合でも成立しなかった。これらを Spec の必須修正にしない。

## 4. 人間判断として残すもの

次は偽陽性ではないが、repository だけでは値を決められない。Spec 改訂時に人間が選ぶ。

1. 再生成 user JSON に `noveltyPreference` を残すか、明示的に落とすか（F-04）。
2. 除外リストの 1 リクエストあたり件数上限の整数（P-M-1 / F-05 の切り）。
3. 確認画面を「指定なし / いつもの / ひねりたい」の 3 状態にするか、2 択のまま未選択を視覚化しないか（A-M-02）。

## 5. 修正後判定

F-01〜F-05 を Spec 本文に固定し、§8 実装順序と §7 テスト面をそれに合わせてから、Implementation Plan に進んでよい。
安全評価・quota・fingerprint・temperature・2 パス・結果画面非表示は、現行 Spec の対象外判断を維持する。
