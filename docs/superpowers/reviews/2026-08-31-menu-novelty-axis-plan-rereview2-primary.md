# 献立ひねり軸 Implementation Plan — 再々レビュー（一次）

- 日付: 2026-08-31
- 対象: `docs/superpowers/plans/2026-08-31-menu-novelty-axis.md` @ `6455863a`
- Spec: 未変更（APPROVE のまま）
- 判定: **REVISE — Critical 0。案 A の Task 境界と DO の形は入った。残 Important は Step 9b の PASS ゲート、コピー関数への null、UUID `…f7` 衝突、P-06 の「スタブ自作禁止」。**

## 作者が閉じたと主張した点

| ID | 判定 | 根拠 |
| --- | --- | --- |
| R-01 案 A 配置 | **部分 Closed** | overlay / `p_novelty_preference` / Args fixture は Task 1 Step 9c。`incompleteDraft` は Step 1。Step 14 に factories と overlay パスと `git status --short`。Task 2 overlay RED は削除 |
| R-01 全緑 | **Open** | Step 9b が overlay 前に typecheck PASS を要求。Args は `noveltyPreference: null` では緑にならない（9c 自身がそう書いている） |
| R-02 DO 形 | **部分 Closed** | 自己完結 DO、JWT、`save(0,…,'twist')`、専用 idempotency、`selected_only` 非接触。`reserve` 引数は live `:1995–2003` と一致 |
| R-02 貼り付け | **Open** | owner / idempotency `…f7` は同ファイル `$pantry_recheck$` が使用中 |
| GRANT / plan(47) | **Closed** | live `20260730120000:120-125` と `plan(43)+4` |
| P-06 | **Open（実行）** | 「既存 `from().select()` を再利用、自作しない」は live `planner-api.test.ts` にそのスタブが無い |

## Important

1. **Step 9 → 9b PASS → 9c。** regen 後 `SaveDraftArgs` は `p_novelty_preference: string` 必須。overlay は 9c。9b の処方は camelCase `null` だけ。
2. **9b の「エラー全部へ null」** が `toDraftInputFields` / `toPlannerDraftInput` / `submissionCandidate` を定数 null にする。Task 2 は同じ行へ「1 行足す」。
3. **`1000…f7` / `3000…f7`** は live `:3663` / `:3756`。貼ると `auth.users` PK または `(user_id, idempotency_key)` で止まる。
4. **P-06。** live は `clientWithRpc` のみ。`getPlannerDraft` 未 import。サンプルが invent したチェーンを次の文が禁止する。

## Assessment

実装開始は、9b/9c を一つの緑ゲートにし、コピー関数は `ingredientPreference` と同型の写経、UUID を未使用帯へ、GET スタブを自作可と書いてから。
