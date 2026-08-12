# 2次検証: admin 共有レシピ閲覧設計

- **役割:** 独立 secondary verifier（1次・敵対の著者コンテキストに依存せず、live tree で再照合）
- **日付:** 2026-08-12
- **対象設計:** [`docs/superpowers/specs/2026-08-12-admin-shared-recipes-viewer-design.md`](../specs/2026-08-12-admin-shared-recipes-viewer-design.md)
- **入力:**
  - 1次: [`2026-08-12-admin-shared-recipes-viewer-primary.md`](./2026-08-12-admin-shared-recipes-viewer-primary.md)（**REVISE** / C0 I7 M4）
  - 敵対: [`2026-08-12-admin-shared-recipes-viewer-adversarial.md`](./2026-08-12-admin-shared-recipes-viewer-adversarial.md)（**BLOCK_WITH_CONDITIONS** / C0 I8 M4）
- **照合（live tree）:** 親 admin 設計 §3.1/§5.6、`20260801190000_share_community_emergency.sql`、`20260811180000_ops_readonly_role.sql`、`admin/server/src/middleware/token.ts`、`admin/server/src/queries/sql-guard.test.ts`、`admin/shared/schemas.ts`、`docs/testing/database-access-matrix.md`
- **手法:** 静的再照合のみ。設計本体の編集なし（本ファイルのみ成果物）。

---

## Summary

方向性（独立「共有レシピ」画面、GET/SELECT、生 `menu_payload` 非レスポンス、構造化 preview、ops への限定 GRANT、本編非混入、本番 `.env.admin` 注意）は **live の admin 骨格と整合**し、1次・敵対の「方針は理解できる」評価に同意する。

二次の核:

1. **Critical は双方とも 0 で妥当。** 親コンソールで導入済みの `kondate_ops_readonly` を拡張するだけであり、owner URL + ソフト RO 問題の再発ではない。敵対が Critical を上げなかった判断を **CONFIRMED**。
2. **総合は 1次 REVISE と敵対 BLOCK_WITH_CONDITIONS を統合して `REVISE_SPEC`（条件付きで plan 着手可）。** 「BLOCK」は親 admin 初版のような権限モデル破綻ではなく、**設計文面の穴を閉じてから plan へ**の意味。
3. **親設計改訂必須（Pri F1 = Adv I1）は CONFIRMED・最優先。** 子 §12.7「任意」は削除すべき。
4. **token 昇格（Pri F5 = Adv I2）** は Important CONFIRMED。技術強制が望ましいが、単一オペレータ残差として明示受容も二次は許容（その場合は設計 §4 に残差 boilderplate 必須）。
5. **一覧 jsonb 負荷（Pri F2 = Adv I3）** CONFIRMED。Critical ではないが本番接続前提では must-document。
6. **counts 定義（Pri F3）** は敵対に無いが **CONFIRMED** — 実装分岐の実害あり。
7. **adaptations / preview 閉じ（Pri F4 = Adv I7）** CONFIRMED。
8. **origins privacy（Pri F6 = Adv I5）** CONFIRMED。
9. **sql-guard + FORBIDDEN_DTO（Pri F7 = Adv I6）** CONFIRMED。live `FORBIDDEN_DTO_KEYS` に menu_payload 無しを再確認。
10. **scrape（Adv I4）** は親の日付+limit 契約下の残差。Important 低 — §4 残差明記で plan 可。
11. **pgTAP 他ロール（Adv I8）** CONFIRMED — §11 に具体 assert を足す。

**最終推奨: `REVISE_SPEC`**

- 人間再承認・implementation plan 前に下記 **Merged must-fix** を設計本文へ反映すること。
- Critical must-fix: **0**
- Important must-fix（重複排除後）: **8**

---

## Final recommendation

| 判定 | 条件 |
| --- | --- |
| **REVISE_SPEC** | 必須。現状文面のまま plan に入ると親正本・token・DTO・counts が実装者分岐する。 |
| must-fix 反映後 | **APPROVE_WITH_RESIDUALS**（共有 PC 禁止、token を残差受容した場合その旨、本番目視は人間、一覧 jsonb 読みの負荷残差、scrape は単一オペレータ前提）。 |
| 実装開始 | 改訂設計のコミット後。migration/GRANT は local 検証既定を維持。 |

1次の REVISE と敵対の BLOCK_WITH_CONDITIONS は **矛盾しない**（敵対の BLOCK は条件付きで、Critical 0）。二次は **REVISE_SPEC** ラベルで統一する。

---

## Cross-walk（Critical / Important）

| ID | 出典 | 元重大度 | 二次判定 | 二次重大度 | 統合先 | 根拠（live 要約） |
| --- | --- | --- | --- | --- | --- | --- |
| Adv Critical | 敵対 | — | なし | — | — | RO ロール継承。C0 不在問題は対象ファイル存在を二次で確認済み。 |
| **Pri F1** | 1次 | Important | **CONFIRMED** | Important | **MF-I1** | 親 §3.1 L80 なお menu_payload 常時除外。子 §12.7 任意。 |
| **Adv I1** | 敵対 | Important | **CONFIRMED** | Important | **MF-I1** | 同根。 |
| **Pri F5** | 1次 | Important | **CONFIRMED** | Important | **MF-I2** | `token.ts` L23–25 null 通過。 |
| **Adv I2** | 敵対 | Important | **CONFIRMED** | Important | **MF-I2** | 同根。昇格 or 残差明示。 |
| **Pri F2** | 1次 | Important | **CONFIRMED** | Important | **MF-I3** | title 関数が menu_payload を読む。 |
| **Adv I3** | 敵対 | Important | **CONFIRMED** | Important | **MF-I3** | 同根。 |
| **Pri F3** | 1次 | Important | **CONFIRMED** | Important | **MF-I4** | counts と filter の関係が設計に無い。 |
| **Pri F4** | 1次 | Important | **CONFIRMED** | Important | **MF-I5** | adaptations「等」。 |
| **Adv I7** | 敵対 | Important | **CONFIRMED** | Important | **MF-I5** | 同根 + all-or-nothing。 |
| **Pri F6** | 1次 | Important | **CONFIRMED** | Important | **MF-I6** | origins 既定 JOIN。 |
| **Adv I5** | 敵対 | Important | **CONFIRMED** | Important | **MF-I6** | 同根。 |
| **Pri F7** | 1次 | Important | **CONFIRMED** | Important | **MF-I7** | FORBIDDEN に menu_payload 無し。 |
| **Adv I6** | 敵対 | Important | **CONFIRMED** | Important | **MF-I7** | 同根 + basename allowlist。 |
| **Adv I4** | 敵対 | Important | **CONFIRMED** | Important（低） | **MF-I8** | 製品 limit 20 迂回。日付+100 で緩和済み → 残差明記で可。 |
| **Adv I8** | 敵対 | Important | **CONFIRMED** | Important | **MF-I7 付帯 / MF-I7b** | pgTAP 他ロール。MF-I7 のテスト節に吸収可。 |
| Pri F8–F11 | 1次 | Minor | **CONFIRMED** | Minor | residual | offset / schemaVersion / title EXECUTE / 要約表示。 |
| Adv M1–M4 | 敵対 | Minor | **CONFIRMED** | Minor | residual | disabled 可読・version・誤接続・title 80 字。 |

**棄却・ダウングレード:** なし。敵対に Critical 無しは維持。scrape（I4）のみ「低」として残差寄り。

---

## Merged must-fix（承認前に設計へ書く）

### Important

#### MF-I1 — 親設計を必須改訂（Pri F1 ∪ Adv I1）

- 親 §3.1: 生 `menu_payload` は API/UI/ログ禁止。構造化 preview は子設計の詳細 API のみ許可、と書き換え。
- 親 §5.6: 「出さない」を jobs 画面の話に限定し、共有レシピ画面へのリンクを追加。
- 子 §12.7 の「任意」を削除し **必須**。

#### MF-I2 — 本文相当 API の token 方針（Pri F5 ∪ Adv I2）

次のいずれか **一方を設計で固定**:

- **A（推奨）:** `/api/shared-recipes` および `/:id` は `ADMIN_LOCAL_TOKEN` 必須。未設定時は当該ルートを登録しない、または 403 closed。
- **B:** 親どおり token 任意を維持し、§4 に残差「同一ホスト他 UID が構造化レシピを GET し得る。共有 PC 禁止が補償」を人間承認対象として明記。

#### MF-I3 — 一覧 jsonb 読み負荷（Pri F2 ∪ Adv I3）

- §7.1 に: title 導出は行の `menu_payload` 読みを伴うこと、limit≤100・日付≤31 日・timeout 15s・失敗時 closed（本文非ログ）。
- 受け入れ: local で複数件 seed した一覧がタイムアウトしないこと。

#### MF-I4 — counts とフィルタ（Pri F3）

固定例（推奨を設計にそのまま書く）:

> `activeCount` / `disabledCount` は **日付範囲 + mealType フィルタ後**の status 別件数。`status` クエリは一覧行にのみ適用し、counts には適用しない。

#### MF-I5 — preview adaptations を閉じる（Pri F4 ∪ Adv I7）

- フィールド列挙固定（portionText, additionalCutting/Heating/Seasoning, servingCheck, anonymousMemberRef, safetyActions.kind/instruction）。
- パースは **all-or-nothing**: 失敗時 `preview: null` + closed `previewError`（部分表示しない）。

#### MF-I6 — origins 相関の privacy 一文（Pri F6 ∪ Adv I5）

§4 に:

> ops は品質調査のため `contributor_user_id`（UUID）と構造化本文を相関し得る。email・氏名は出さない。製品 UI の寄稿者非表示とは別面の運用特権である。

#### MF-I7 — sql-guard と FORBIDDEN_DTO（Pri F7 ∪ Adv I6 ∪ Adv I8）

- allowlist: basename `sharedRecipes.ts` のみ `menu_payload` トークン可。
- `FORBIDDEN_DTO_KEYS` に `menu_payload` / `menuPayload`。
- detail シリアライズに raw キーが無い golden test。
- pgTAP: ops SELECT 可・DML 不可、**service_role 等への表 SELECT が増えていない**こと。

#### MF-I8 — scrape 残差（Adv I4）

§4 残差:

> 製品 `list_active` の limit 20 / salt 境界は admin に適用しない。日付・limit による緩和のみ。単一信頼オペレータ前提。一覧に preview を載せないことはテストで固定。

---

## Residuals（must-fix 後も残る）

| 残差 | 扱い |
| --- | --- |
| 共有 PC・同一ホスト他 UID | 親と同様。token A 採択で低減 |
| 本番 `.env.admin` 誤操作 | §10 + README。エージェントは本番自動接続しない |
| 一覧の jsonb TOAST 読み | MF-I3 で文書化。title 列化は follow-up |
| disabled 行の ops 可読 | 監査有用。UI で status 明示 |
| 深い offset | 親と同型。非目標 |

---

## 1次・敵対のプロセス注記

初回サブエージェント実行時、作業ブランチが `main` で設計コミット（`production` 上 `f62042dc`）が未マージだったため **ファイル不在の偽 BLOCK** が出た。二次は worktree に設計本文（360 行）を復元したうえで照合した。レビュー成果物としては **本文付き 1次・敵対（本ディレクトリの primary/adversarial）を正**とし、不在判定の出力は採用しない。

---

## 結論

| 項目 | 結果 |
| --- | --- |
| 最終判定 | **REVISE_SPEC** |
| Critical must-fix | 0 |
| Important must-fix | 8（MF-I1 … MF-I8） |
| 次アクション | 設計本文へ MF 反映 → 人間再承認 → writing-plans |
| 実装 | MF 未反映のまま開始しない |
