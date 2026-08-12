# 敵対的レビュー: admin 共有レシピ閲覧 実装

- **役割:** 独立 adversarial reviewer（実装著者コンテキスト非共有・read-only。本ファイルのみ書込）
- **日付:** 2026-08-12
- **Worktree:** `/home/dev/projects/kondate`
- **HEAD:** `672628c1`
- **Diff 正本:** `/tmp/admin-shared-recipes-impl-review/full.diff`（`68d54913`..`672628c1`）
- **照合 spec:** [`docs/superpowers/specs/2026-08-12-admin-shared-recipes-viewer-design.md`](../specs/2026-08-12-admin-shared-recipes-viewer-design.md)
- **照合 plan:** [`docs/superpowers/plans/2026-08-12-admin-shared-recipes-viewer.md`](../plans/2026-08-12-admin-shared-recipes-viewer.md)
- **親設計（live）:** [`docs/superpowers/specs/2026-08-11-local-ops-admin-console-design.md`](../specs/2026-08-11-local-ops-admin-console-design.md)
- **攻撃焦点:** token 未設定ルート非登録 / 他 API 取り違え、raw `menu_payload` 漏洩、preview all-or-nothing、sql-guard basename、GRANT/pgTAP、origins 過剰露出、IDOR・一覧 dishes 混入、Host/method、日付・limit、mapper 500/raw、親設計矛盾、テスト raw 許容

---

## Summary

共有レシピ閲覧スライスは、設計の主防御（`ADMIN_LOCAL_TOKEN` 未設定時はルート未登録、設定時は既存 Bearer ミドルウェア、GET only + Host allowlist、ops SELECT のみ GRANT、一覧は title 関数＋メタ、詳細は `buildPreviewFromPayload` → Zod 投影のみ、`menu_payload` を DTO に載せない、壊れた payload は `previewError` に閉じる）を **実装上おおむね正しく具体化**している。親設計 §2.2 / §3.1 / §5.6 の live 文言も「生 payload 禁止・構造化 preview のみ」と整合しており、文書分裂による実装反転リスクは **現状反証可能**。

Critical（未認証での raw 本文 GET、書込 GRANT、closed 崩れでの raw 返却）は、live コード上 **成立しなかった**。

一方、次は検証網と契約の穴として残る。

1. **日付必須の偽 green:** 仕様は `from`/`to` 必須だが実装は `parseJstDateRange` の「両方省略 → 直近 7 日」をそのまま使う。route テスト「rejects without date range」は pool null 時の `db_unavailable` 400 でも通る。
2. **成功経路の e2e/route 証明が無い:** raw 非露出は mapper/schema 単体に偏り、mock pool 成功レスポンスでの API envelope 検証が無い。
3. **UUID 形式チェックが緩く**、形式だけ合う非 UUID は PG cast 失敗 → closed 500（raw は出ないが 400 契約と不一致）。
4. **メタ行の Zod 失敗は preview 経路と非対称**（payload は try/catch、list item メタは throw → 一覧全体 500）。

**総合判定: `PROCEED_WITH_CONDITIONS`**

Critical 0。Important を同 PR または即 follow-up で閉じれば `PROCEED`。設計受容残差（深い offset、製品 limit20 非適用、contributor UUID 運用特権、token 任意の他 API）は残る。

---

## Verdict

| 項目 | 値 |
| --- | --- |
| **判定** | **`PROCEED_WITH_CONDITIONS`** |
| **Critical** | **0** |
| **Important** | **3** |
| **Minor（参考）** | 4 |
| **解除条件** | I1（日付必須 + テストを真の契約に合わせる）を同 PR 推奨。I2–I3 は同 PR または短い follow-up。Critical なしのため security BLOCK ではない |

---

## Attack table

| # | 攻撃シナリオ | 判定 | 根拠 |
| --- | --- | --- | --- |
| 1 | `ADMIN_LOCAL_TOKEN` 未設定で `/api/shared-recipes` を GET し構造化本文を読む | **反証** | `register.ts` L203–264: `if (deps.config.localToken)` のときのみ 2 GET 登録。null 時は warn のみ。`app.test.ts` で 404 固定。 |
| 2 | token 未設定時に他 API（share-jobs 等）と取り違えて本文相当を取る | **反証（本スライス）** | share-jobs は job メタのみ（既存）。shared-recipes は未登録。token null 時の他 API 開放は **親設計受容残差**（本文 API ではない）。 |
| 3 | token 設定済み・Bearer 欠落で shared-recipes を読む | **反証** | `createTokenGuard` が `/api/*`（health 除く）に Bearer 要求。route テスト 401。 |
| 4 | raw `menu_payload` が API JSON に載る | **現行経路は反証** | 一覧 SELECT に列として出さない（title 引数のみ）。詳細は `mapSharedRecipeDetail` が preview のみ parse。`sharedRecipesResponseSchema` / `sharedRecipeDetailSchema` に raw キー無し。FORBIDDEN に `menu_payload`/`menuPayload`。 |
| 5 | UI / クライアントが raw を描画・保持 | **反証** | `SharedRecipesPage` は型付きフィールドのみ。`PreviewPanel` は固定キー。`apiGet` は `data` のみ返却。raw キーを JSON.stringify しない。 |
| 6 | ログに title / preview / payload が出る | **反証** | 業務経路に payload の `console.*` なし。register は token 未設定 warn のみ。 |
| 7 | preview 部分表示・壊れた dish だけ出す | **反証** | `buildPreviewFromPayload`: null 要素事前検査 + `safeParse` 失敗で全体 `preview: null` + `invalid_menu_payload`。try/catch で throw しない。 |
| 8 | sql-guard を basename すり替え / 他 query に `menu_payload` 混入 | **概ね反証 / 回帰網に穴** | allowlist exact `sharedRecipes.ts`。他 `.ts` は `/menu_payload/i` 禁止。**非再帰 readdir**（サブdir は未走査）→ I3 / M 系。runtime 強制は無し（テスト回帰のみ）。 |
| 9 | GRANT 過剰（INSERT/UPDATE/DELETE/広 EXECUTE） | **反証（migration + pgTAP）** | migration は SELECT 2 表 + title EXECUTE のみ。pgTAP: 両表 DML 否定、service_role SELECT 否定、`plan(50)` と assert 本数一致（50）。 |
| 10 | pgTAP 偽 green（plan 不一致・SELECT だけ lives_ok） | **概ね反証** | plan(50)=50 本。DML は has_table_privilege で INSERT/UPDATE/DELETE。service_role 表 SELECT 否定あり。authenticated/anon は本ファイル未追記だが既存 `share_community_emergency.test.sql` が維持。 |
| 11 | origins で email / 氏名結合 | **反証** | JOIN は origins の UUID 列のみ。`auth.*` 非 join。FORBIDDEN に `email`。 |
| 12 | contributor_user_id 過剰露出 | **設計受容（運用特権）** | spec §4.9 / MF-I6。UUID のみ。製品 UI の寄稿者非表示とは別面。 |
| 13 | IDOR 的に他ユーザー識別子 / 一覧に dishes・steps 混入 | **IDOR は設計上非該当 / 混入は反証** | ops は全行 SELECT 可（単一運用）。一覧 DTO に dishes/steps/preview 無し。dirty list parse テストで preview strip。 |
| 14 | Host spoof / POST で書込 | **反証** | 既存 `createHostGuard` + `apiGetOnly`。shared-recipes も同一 stack（`app.ts`）。 |
| 15 | 日付範囲未強制・limit 超過・深い offset | **部分成立** | limit≤100・offset 数値検証・範囲≤31 日は有効。**両方省略時 7 日デフォルト**で「必須」契約は破れる（I1）。深い offset は spec 残差。 |
| 16 | mapper 例外で 500 に raw / Zod 詳細 | **反証（closed）** | `fail` / `onError` は非 `AdminClosedError` を `internal_error` に正規化。preview 構築は catch。メタ Zod 失敗も raw は出ない（I 系は可用性）。 |
| 17 | 親設計未改訂で禁止リスト分裂 | **反証（live）** | 親 §2.2/§3.1/§5.6 に共有レシピ例外・token 必須・preview のみが反映済み。本 diff 範囲外でも worktree 正本は整合。 |
| 18 | テストが raw キーを意図せず許す | **部分反証** | list dirty parse + mapper golden は strip を実行証明。FORBIDDEN の `toContain` 単独は弱いが dirty が補完。**detail schema の dirty parse と API 成功経路は未カバー**（I2）。 |

---

## Findings

### Critical

なし。

---

### Important

#### I1. 共有レシピ一覧の日付「必須」が未強制で、route テストが偽 green

- **信頼度:** 92  
- **箇所:**  
  - spec §7.1: `from`/`to` **必須**  
  - `admin/server/src/routes/register.ts` L209: `parseJstDateRange({ from: q.from, to: q.to })`  
  - `admin/server/src/lib/jst.ts` L91–94: 両方省略時は直近 7 日にフォールバック  
  - `admin/server/src/app.test.ts` L100–111: 「rejects without date range」が **status 400 のみ** assert。コメント自身が「両方省略は既定7日 → pool null なら `db_unavailable`」と認めている  
- **攻撃 / 影響:**  
  1. 認証済み攻撃者（または token 設定済ループバック他 UID）が `GET /api/shared-recipes`（クエリ無し）で **暗黙 7 日窓**の一覧を取れる。  
  2. 31 日上限と limit≤100 があるため全歴史 scrape ではないが、**仕様の「必須日付」契約と scrape 緩和前提がテスト上証明されない**。  
  3. 将来 `requirePool` を先にすると、両方省略が **200 成功**になりテストはなお 400 を期待して red、または「400 なら何でもよい」偽 green のまま放置される。  
- **修正要求:**  
  1. shared-recipes 専用に `from`/`to` 欠落（片方または両方）を `date_range_required` で 400 にする（親 API の 7 日デフォルトを共有しない）、**または** spec を「省略時 7 日」に改訂して必須を撤回。  
  2. テストは **pool 有無に依存せず** `error.code === "date_range_required"`（または改訂後の契約）を assert。`db_unavailable` では合格にしない。

#### I2. raw 非露出の証明が mapper/schema 単体に偏り、API 成功経路が未固定

- **信頼度:** 86  
- **箇所:**  
  - `admin/server/src/app.test.ts` shared-recipes: 404/401/400 のみ。成功 body なし  
  - `map-shared-recipe.test.ts` / `schemas.test.ts`: unit で strip は証明  
  - `sharedRecipeDetailSchema` への dirty `menu_payload` parse テスト無し  
- **攻撃 / 影響:**  
  将来 `ok(c, row)` や `...row` を detail に混ぜる退行があっても、**現行 route スイートは green のまま**。unit が残っていれば検知し得るが、register 層の結合が切れると仕様の受け入れ条件 4（ネットワークレスポンスに raw 無し）を CI が担保しない。  
- **修正要求:**  
  1. mock `Pool` / `withReadOnly` 差し替え、または query 層を inject し、detail 成功 JSON に `menu_payload` / `menuPayload` / 予期せぬ jsonb 塊が無いことを assert。  
  2. 一覧成功 body に `preview` / dishes / steps が無いことも同経路で固定。  
  3. `sharedRecipeDetailSchema.parse({ ...合法, menu_payload: {...} })` の strip を schemas テストに追加。

#### I3. sql-guard が queries 直下の非再帰 basename のみ — 配置逃げの回帰穴

- **信頼度:** 80  
- **箇所:** `admin/server/src/queries/sql-guard.test.ts` L35–37 `readdirSync(here)`（非再帰）、L51–54 basename exact  
- **攻撃 / 影響:**  
  現行 tree は flat で `sharedRecipes.ts` のみが `menu_payload` を含むため **現行リークは反証**。しかし `queries/foo/bar.ts` や別ディレクトリの query モジュールに SQL を移すと **ガードが走査せず**、FORBIDDEN も runtime 強制しない。plan 敵対の「ファイル名 allowlist 依存」が実装後も構造として残る。  
- **修正要求:**  
  1. queries 配下を再帰走査する、または import グラフ上の全 query モジュールを列挙。  
  2. allowlist は basename に加え **リポジトリ相対 path の exact** を推奨。  
  3.（任意）起動時または test で `listSharedRecipes`/`getSharedRecipe` 以外から `menu_payload` 列 alias が SELECT リストに出ない静的検査。

---

### Minor（参考・信頼度 &lt; 80 または設計受容）

| ID | 内容 | メモ |
| --- | --- | --- |
| M1 | `:id` の UUID 検査が `/^[0-9a-f-]{36}$/i` で、ハイフンだらけ等は PG cast 失敗 → closed **500**（spec は不正 id **400**） | raw は出ない。可用性・契約のみ。 |
| M2 | `mapSharedRecipeListItem` の Zod 失敗（異常 status / elapsed 0 等）は try/catch されず **一覧全体 500**。payload 破損だけ previewError に閉じる非対称 | 秘匿より可用性。1 行毒で list DoS。 |
| M3 | `sharedRecipeDetailSchema` が preview / previewError の XOR を refine しない | mapper は排他。契約の二重化不足。 |
| M4 | preview 文字列に max 長が無い（巨大 instruction でレスポンス肥大） | 品質目視 API の性質上受容しうる。単一オペレータ残差。 |
| M5 | 深い offset・製品 limit20 非適用・contributor 相関 | spec §4.2 設計受容残差。 |
| M6 | FORBIDDEN の `toContain("menu_payload")` 単独は自己参照 | dirty list parse が補完。I2 で detail を足せば十分。 |

---

## Refuted attacks（証拠付き）

| 主張 | 反証 |
| --- | --- |
| token 未設定で共有レシピ API が開く | `registerApiRoutes` の `if (deps.config.localToken)` + 404 テスト |
| Bearer 無しで token 設定時に読める | グローバル `createTokenGuard` + 401 テスト |
| 一覧レスポンスに preview / dishes | `sharedRecipesResponseSchema` + dirty strip テスト + list SQL 列 |
| 詳細が raw `menu_payload` を返す | `mapSharedRecipeDetail` が preview のみ; Zod に raw キー無し |
| 壊れた payload で 500 + スタック | `buildPreviewFromPayload` try/catch → `invalid_menu_payload` |
| pantryUsage / dish UUID が preview に残る | pick 明示 + mapper golden（UUID / pantryUsage 不在） |
| ops が recipes/origins に DML 可 | migration SELECT only + pgTAP INSERT/UPDATE/DELETE false |
| service_role に表 SELECT が増えた | migration 非付与 + pgTAP `not has_table_privilege(service_role, …)` |
| email が origins から出る | SELECT 列に email 無し・auth 非 join |
| Host / method が共有レシピだけ緩い | 同一 middleware stack、ルート固有の免除なし |
| 親 §3.1 が「常時除外」のまま | live 親設計が preview 例外・token 必須に改訂済み |
| limit 無制限 | `clampLimit` max 100 |
| title 関数 EXECUTE で権限昇格 | `immutable` + `search_path = pg_catalog`、DML 無し |
| 静的 LFI で token 窃盗（親 C1） | 本スライスは `safe-static` 継続（index.ts）。本 diff で bare serveStatic 再導入なし |

---

## 修正優先度（実装者向け）

1. **同 PR 強く推奨:** I1 日付必須（または spec 改訂）+ 偽 green テスト修正  
2. **同 PR または短い follow-up:** I2 API 成功経路の raw 非露出 assert  
3. **follow-up 可:** I3 sql-guard 再帰/ path exact、M1 UUID 厳密化、M2 list 行単位 fail-soft  

---

## 解除条件

| 条件 | 状態 |
| --- | --- |
| Critical 不在 | **充足** |
| I1 日付契約とテストの一致 | **未充足**（PROCEED_WITH_CONDITIONS の主条件） |
| I2 成功経路 raw 非露出の CI 固定 | **未充足（推奨）** |
| I3 sql-guard 配置逃げ耐性 | **未充足（follow-up 可）** |
| 設計受容残差（offset / 製品 limit / contributor / 他 API の token 任意） | **文書化済み・残置可** |

I1 を閉じ、I2 を最低限（detail 成功 JSON に raw キー無し）入れた時点で **判定を `PROCEED` に下げてよい**（adversarial 視点）。

---

## メタ

- レビュー種別: **implementation** に対する敵対的レビュー  
- 編集: 本ファイルのみ（product code 不変）  
- live 読取: `admin/server/src/routes/register.ts`, `queries/sharedRecipes.ts`, `lib/map-shared-recipe.ts`, `queries/sql-guard.test.ts`, `shared/schemas.ts`, `app.test.ts`, `client/.../SharedRecipesPage.tsx`, migration / pgTAP / 親設計  
- 総合: **`PROCEED_WITH_CONDITIONS`** / Critical **0** / Important **3** / Minor **6**（表）  
- 真偽の最終裁定はしない。Finding は攻撃者視点の候補。
