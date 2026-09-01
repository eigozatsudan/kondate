# 献立ひねり軸 Implementation Plan — デルタ再レビュー裁定（72e4429f）

- 日付: 2026-08-31
- 裁定者: 親エージェント
- 対象: デルタ再レビュー一次・二次・敵対的、親の live 再照合
- 最終判定: **APPROVE。Critical 0。Important 0。R-01 / R-02 / R-03 は閉じた。実装開始してよい。**

## 1. 裁定方法

`72e4429f` の計画本文だけを、前回裁定の R-01 / R-02 / R-03 と live へ当てた。Spec は触っていない。一次・二次は APPROVE。敵対的は git add 列挙と keepalive `toEqual` を Important とした。親は overlay 順、コピー 3 箇所、`$idea_finalize$;` `:3488`、`f9` 未使用、`planner-api.test.ts:22`、keepalive `:144-158`、`draft-from-menu.ts:10-25` を再読した。

## 2. 前回残件

| ID | 裁定 | 理由 |
| --- | --- | --- |
| R-01 | **Closed** | 9 → 9a overlay（赤でよい）→ 9b 唯一の全 PASS。(i)/(ii) 分離。Task 2 は 3 分岐 + 空判定必須。Step 13 旧文削除。Files に overlay / factories / rls_inventory / route / autosave |
| R-02 | **Closed** | owner / idempotency `…f9`。live テスト SQL にゼロ件。f7 使用済みを本文が名指し。貼る位置は `$idea_finalize$;` の後ろ。grep-and-shift 削除。`repeat('f',64)` は一意制約なし |
| R-03 | **Closed** | 読み取りスタブをこのファイルへ最小限新設。`getPlannerDraft` を import。汎用モック禁止。live は `clientWithRpc` のみという記述と一致 |

## 3. 敵対的 9 / 10 の格下げ

| 攻撃 | 裁定 | 理由 |
| --- | --- | --- |
| Step 14 `git add` が route / autosave を落とす | **Minor** | 同じ Step が「列挙だけに頼らない」「未追加が無いことを確認してから commit」と書く。無視した commit は tree 赤（fail-closed）。前回も sandwich を正として Closed |
| keepalive `toEqual` が `noveltyPreference` キー | **Minor** | 誤キーでは 9b vitest が落ちる。偽緑ではない。差分は `p_novelty_preference`。旧 9c の「必要なら足す」が 9a へ移るときに落ちた |

「同じ Step の後段文を無視する」攻撃は Important にしない、という前回からの校正を維持する。

## 4. Minor（直さなくても実装可）

1. Step 14 の `git add` に `src/features/planner/use-draft-autosave.ts` と `planner-route.tsx`（および 9b が触った他フィクスチャ）を足すか、`git add -u` にする。
2. 9a または 9b に「keepalive の `toEqual` へ `p_novelty_preference: null`」と書く。camelCase ルールは schema parse に限る。
3. Task 2 サンプルを `clientWithRpc` 隣の 1 本の `from().select()` に揃える。`incompleteTargetDraft` を行フィクスチャにする。
4. Task 2 `Files:` の `:104/:145/:1776` と commit 文の「route の 3 箇所を写す」を、空判定 + 写経検算へ合わせる。
5. Task 5 `draft-from-menu` も「既に写経済みなら足さない」。

## 5. 再開しないもの

安全 / quota / HMAC 入力 / PromptPreferences / 2-pass / temperature / 漢字畳み / radio / 13 引数 DROP / JWT が DO 内 / `repeat('f',64)` unique。

## 6. 修正後判定

**APPROVE。** Spec は APPROVE のまま。Plan も APPROVE。実装を開始してよい。Minor は実装中に直してもよいが、再レビュー待ちにはしない。
