# 敵対的レビュー: admin 共有レシピ閲覧 Implementation Plan

**対象:** [`docs/superpowers/plans/2026-08-12-admin-shared-recipes-viewer.md`](../plans/2026-08-12-admin-shared-recipes-viewer.md)  
**Spec:** [`docs/superpowers/specs/2026-08-12-admin-shared-recipes-viewer-design.md`](../specs/2026-08-12-admin-shared-recipes-viewer-design.md)  
**姿勢:** ship バイアスで「コメント実装」「false-green テスト」「GRANT 拡大」「sql-guard 穴」を突く。  
**レビュー日:** 2026-08-12  
**編集:** なし

---

## Summary

Plan は設計の骨格を Task 化しているが、**実行可能な SQL/テストが抜けたまま GREEN を宣言する経路**が残る。特に Task 3 の query がコメントのみ、mapper 成功 golden と Bearer テストが未完成、pgTAP `plan(N)` が曖昧、という組み合わせは「権限付与したつもり・生 payload が出ないつもり」の **文書上の安心**を生む。sql-guard の basename allowlist は方向正しいが、実装時に `sharedRecipes.ts` 以外へ SQL を逃がすと回帰する。

Critical（計画どおりに本番破壊や無制限 PII が設計必然で起きる）は、ops RO + 既存 Host/token 骨格があるため付けない。  
**総合: `BLOCK_WITH_CONDITIONS`**（実装開始前に Important を Plan に埋める）

---

## Attack scenarios

| # | シナリオ | 判定 | 根拠 |
| --- | --- | --- | --- |
| 1 | コメント実装のまま list が `select menu_payload` を一覧に載せ DTO が緩い | **成立しうる** | Task 3 body が未固定。実装者裁量。 |
| 2 | counts に status を掛け UI サマリが嘘 | **成立しうる** | SQL 未記載。設計 MF-I4 がコード化されていない。 |
| 3 | sql-guard allowlist を全廃止して menu_payload 全面解禁 | **成立しうる** | Plan は方針のみ。テストが「sharedRecipes 以外禁止」を明示しているのは良いが、削除 PR を止めない。 |
| 4 | FORBIDDEN にキーを足すだけ・strip 実行証明なし | **部分成立** | 既存 schemas.test は dirty parse strip がある。Plan 新規は toContain + list stringify のみで detail 不足。 |
| 5 | token null で 404 を確認したあと、token ありで Bearer 無しを未テストのまま ship | **成立しうる** | Task 4 第2テストがコメント。ただし createTokenGuard は全 /api に効くため **実装が register する限り 401 は既存で守られる**（回帰は register を token 外に置く変更）。 |
| 6 | pgTAP plan 件数誤りで新 assert が走らない / 過剰 | **成立** | N 未固定。 |
| 7 | service_role に誤 GRANT を migration に混ぜる | **migration ミスで成立** | Plan SQL スケッチは ops のみ。pgTAP の not privilege は抑止になる。 |
| 8 | private 表に RLS が後から入り 0 行 | **現状反証** | matrix RLS off。将来は設計どおり policy が要る。Plan の責任外。 |
| 9 | has_function_privilege 文字列が解決せず false negative | **低** | 他テストで `'schema.fn(args)'` 形式が使われる。失敗時 lives_ok で EXECUTE 実走が補完。 |
| 10 | 本番 `.env.admin` で Task 手動検証 | **運用** | Global Constraints で禁止済み。 |

---

## Findings

### Critical

なし。

### Important

#### I1. Task 3 SQL 未記載 → 実装が設計 counts/秘匿を外す

- **信頼度:** 93  
- **修正要求:** list（counts + items）と detail の完全 SQL を Plan に固定。一覧 SELECT リストに `menu_payload` 列を **出さない**（title 関数引数のみ）。

#### I2. テストが false-green しやすい穴

- **信頼度:** 90  
- **修正要求:** mapper 成功 fixture + stringify 禁止; Bearer 401 完成; plan(50); 一覧に preview キー無し。

#### I3. detail の title 経路未固定

- **信頼度:** 85  
- **修正要求:** detail も title 関数を SELECT。

#### I4. sql-guard 改訂手順で一時的に全禁止を外すリスク

- **信頼度:** 80  
- **修正要求:** PR 内で「ALWAYS + allowlist」の最終形のみを示し、「FORBIDDEN から menu_payload を消して終わり」にしないことを Step に明記（現状 Plan は最終形あり → 文言強化で足りる）。

### Minor

#### M1. Task 5 UI コード省略 — Feedback 参照で実装可能。残差。

#### M2. register.ts 先頭コメント「6 画面」更新指示が無い。

#### M3. rls_inventory 非更新 — 表 GRANT は service_role 不変。任意。

---

## BLOCK 解除条件

- [ ] I1 完全 SQL  
- [ ] I2 完成テスト + plan(50)  
- [ ] I3 detail title  
- [ ] I4 sql-guard 最終形の明示（現状ほぼ満たす）

---

## メタ

**BLOCK_WITH_CONDITIONS** / Critical 0 / Important 4 / Minor 3
