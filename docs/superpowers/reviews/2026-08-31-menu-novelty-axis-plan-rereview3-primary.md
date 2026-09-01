# 献立ひねり軸 Implementation Plan — デルタ再レビュー（一次）

- 日付: 2026-08-31
- 対象: `docs/superpowers/plans/2026-08-31-menu-novelty-axis.md` @ `72e4429f`
- Spec: 未変更（APPROVE のまま）
- 判定: **APPROVE — Critical 0、Important 0。R-01 / R-02 / R-03 は閉じた。残は Minor。**

## 前回残件

| ID | 判定 | 根拠 |
| --- | --- | --- |
| R-01 | **Closed** | Step 9 → 9a overlay（赤でよい）→ 9b 唯一の全 PASS。(i) 定数 null / (ii) 3 箇所写経。Task 2 は 3 分岐 + 空判定。Step 13 旧文削除。Files に overlay / factories / route / autosave |
| R-02 | **Closed** | `…f9` は `supabase/tests/database/` にゼロ件。f7 は pantry_recheck `:3663` / `:3756`。貼る位置は `$idea_finalize$;`（live `:3488`）。grep-and-shift 削除 |
| R-03 | **Closed** | 「自作しない」撤回。`clientWithRpc` 隣へ `from().select()` を新設。`getPlannerDraft` import。live は rpc 専用のまま |

## Minor

- Step 14 `git add` 列挙に `planner-route.tsx` / `use-draft-autosave.ts` が無い。同じ Step の status sandwich が正。
- Task 2 サンプルが `makeBrowserClientStub` のまま。本文が新設指示。
- Task 5 `draft-from-menu` の「1 行を足す」に 3 分岐が無い。9b の「運んでいるなら写す」で先に写る。重複は TS1117。
- keepalive `toEqual` は `p_novelty_preference: null` が要る。9b の「`noveltyPreference: null` を足す」は schema 向け。

## Assessment

実装開始してよい。
