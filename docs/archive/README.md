# docs/archive — 履歴アーカイブ

**エージェント向け: 既定ではこのツリーを読まない。**

MVP 配送と後続イテレーションの設計書・実装計画・敵対的レビュー・ゲート証跡を
git 上に残すための保管場所である。現行の仕様判断には使わない。

- 現行の正: **実装**と `docs/` 直下の運用文書（[../README.md](../README.md)）
- 実装とこのアーカイブが矛盾する場合: **実装を正**とする
- アーカイブ内の相互リンクは移動後に `docs/archive/...` へ寄せてあるが、
  文中の「当時の正本」表現はそのまま残していることがある

## レイアウト

| パス | 内容 |
| --- | --- |
| `superpowers/specs/` | 設計書・提案・当時の設計レビュー |
| `superpowers/plans/` | 実装計画・roadmap・Task 計画 |
| `superpowers/reviews/` | Superpowers 初期の設計敵対的レビュー |
| `reviews/` | 実装・設計に対する一次/二次/敵対的レビュー |
| `bugfix/` | Plan 8 ゲート証跡、モデル snapshot、closeout メモ |
| `bugfix/artifacts/` | スクリプトが書き出す JSON / 決定記録（機械生成） |

OpenRouter カタログ snapshot や quality review の出力先も
`bugfix/artifacts/` のまま（スクリプトがここへ書く）。
