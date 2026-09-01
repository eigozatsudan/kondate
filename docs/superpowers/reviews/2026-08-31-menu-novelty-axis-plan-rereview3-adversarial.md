# 献立ひねり軸 Implementation Plan — デルタ再レビュー（敵対的）

- 日付: 2026-08-31
- 対象: `docs/superpowers/plans/2026-08-31-menu-novelty-axis.md` @ `72e4429f`
- 姿勢: 本文を一字一句貼る。improvisation 無し。
- 判定: **攻撃 1–8 は不成立。9（git add 列挙）と 10（keepalive toEqual キー）は成立し得るが、同じ Step の禁止文 / fail-closed により Important までは届かない。**

## 不成立（前回 Important の再攻撃）

| 攻撃 | 結果 |
| --- | --- |
| 9b PASS が overlay 前 | 不成立。9a が先、赤許容。9b が唯一の全 PASS |
| コピー 3 箇所へ定数 null | 不成立。(ii) 表が写経。機械的 null 禁止 |
| Task 2 が 1 行足して wipe / TS1117 | 不成立。3 分岐。定数 null は置き換え。写経済みは触らない |
| UUID `f9` 衝突 | 不成立。テスト SQL に `f9` ゼロ件 |
| 3185 直後へ貼る | 不成立（校正）。終端 `$idea_finalize$;` を探せとある。live `:3488` |
| スタブ自作禁止 | 不成立。新設指示 |
| Step 13 が null で planner-api を緑 | 不成立。削除済み |
| draft-from-menu 表漏れ → wipe | Minor。heuristic が copy。Task 5 の「足す」は TS1117 |

## 成立したが Important にしない

**git add 列挙に route / autosave が無い。** 貼り付けブロックは `git add` のあと `git commit`。ただし同じ Step が「列挙だけに頼らない」「未追加が無いことを確認してから」と書く。無視して commit すると tree が赤。本文に従えば止まる。

**keepalive `toEqual`。** 9a が `p_novelty_preference` を足すと `planner-api.test.ts:144` が落ちる。9b は `noveltyPreference: null` を足せと書く。誤キーでは PASS しない。vitest の差分が `p_novelty_preference` を出す。偽緑にはならない。

## Assessment

前回の 3 系統は閉じた。実装開始を止める攻撃は残っていない。
