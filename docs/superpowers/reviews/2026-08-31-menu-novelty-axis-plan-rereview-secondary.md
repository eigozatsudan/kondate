# 献立ひねり軸 Implementation Plan — 再レビュー（二次）

- 日付: 2026-08-31
- 対象: `docs/superpowers/plans/2026-08-31-menu-novelty-axis.md` @ `66a5d0fc`
- 一次・敵対的とは別スレッド
- 判定: **REVISE。P-01/P-03/P-05/P-06 は本文上 Closed。P-02 ai_control と P-04 commit/GREEN が Open。**

## 二次レンズ（主張された GREEN が live で通るか）

- P-01: Step 6 どおりなら inventory / 03a privilege は通る。
- P-03: `plan(43)+3 = 46` は persist is / throws_ok / count の 3 本と一致。
- P-05: live は select。full-journey は success 見出しまで行く。
- P-06: select 文字列の expect は F-02 をロックする。ヘルパーは自作が要るが要求は閉じている。
- P-02: `03_pantry` の 4/5 は `finish()` 直前 revision 4 と一致。ai_control `:1253` 付近は JWT 無し。save は `22023`。`:1990` の DO が正しい手本。
- P-04: Step 4「契約テスト PASS」は `parse(incompleteDraft).toEqual(incompleteDraft)` が default 注入で落ちる。Step 14 の commit は factories を載せない。

## 残 Important

1. ai_control は新 owner + `set_config` JWT + 新 idempotency。draft `3000…0001` / key `2000…0001` 禁止。
2. `incompleteDraft` を Step 1 または 3 で更新して Step 4 を成立させる。Step 9b が触ったパスを Task 1 `git add` に列挙する。

## Assessment

easy パッチは入った。残る 2 本の GREEN がまだ嘘。デルタだけ再レビューすれば足りる。
