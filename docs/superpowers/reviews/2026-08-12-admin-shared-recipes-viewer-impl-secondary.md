# 2次検証: admin 共有レシピ閲覧 実装

- **役割:** 独立 secondary verifier（1次・敵対の結論に依存せず、Spec / Plan / live を横断再照合）
- **日付:** 2026-08-12
- **対象:** `68d54913`..`672628c1`（HEAD `672628c1`）admin 共有レシピ閲覧実装
- **正本:**
  - Spec: [`docs/superpowers/specs/2026-08-12-admin-shared-recipes-viewer-design.md`](../specs/2026-08-12-admin-shared-recipes-viewer-design.md)（§4 不変条件、§5–10、MF-I1…I8、§13 受け入れ）
  - Plan: [`docs/superpowers/plans/2026-08-12-admin-shared-recipes-viewer.md`](../plans/2026-08-12-admin-shared-recipes-viewer.md)（MF-P1…P4）
  - Diff: `/tmp/admin-shared-recipes-impl-review/full.diff`
- **手法:** live tree 静的再照合のみ。実装編集なし（本ファイルのみ成果物）。
- **照合 live（必須）:**  
  `admin/server/src/{routes/register.ts,queries/sharedRecipes.ts,lib/map-shared-recipe.ts,queries/sql-guard.test.ts,app.test.ts,middleware/token.ts,lib/jst.ts,errors.ts,lib/envelope.ts}`、  
  `admin/shared/schemas.ts` + tests、`admin/client/src/pages/SharedRecipesPage.tsx`、`Layout.tsx`、`app.tsx`、  
  `supabase/migrations/20260812120000_ops_readonly_shared_recipes.sql`、`supabase/tests/database/ops_readonly_role.test.sql`、  
  `docs/testing/database-access-matrix.md`、`admin/README.md`、  
  親設計 `2026-08-11-local-ops-admin-console-design.md` §2.2 / §3.1 / §5.6

---

## Summary

実装は **方向・骨格・主要不変条件をほぼ満たす**。

| 領域 | 二次評価 |
| --- | --- |
| 生 `menu_payload` 非レスポンス | **PASS**（SELECT はサーバ内、mapper 投影、Zod strip、FORBIDDEN、sql-guard basename） |
| preview all-or-nothing / adaptations 固定 | **PASS**（mapper + schema。例外を投げない） |
| counts（MF-I4）SQL 定義 | **PASS**（実装は正）。**回帰テストは欠落** |
| token 必須ルート登録（MF-I2-A） | **PASS**（`localToken` 時のみ register + 404 / Bearer 401 テスト） |
| GRANT / DML 不可 / title EXECUTE / service_role | **PASS**（migration + pgTAP plan 50） |
| UI 一覧・詳細・ナビ | **PASS に近い**（注意文言・フィルタ・in-page detail）。status 視覚・404 文言は弱い |
| 親設計 MF-I1 | **PASS**（live 親 §2.2/§3.1/§5.6 改訂済み。本 diff 範囲外だが Plan どおり） |
| 本編非混入 | **PASS**（diff は admin / supabase / docs/testing / README のみ） |

**Critical は 0。** 権限モデル破綻・生 payload の API 露出・書込 API 追加は見つからない。

ただし次が **Important must-fix** として残る:

1. **UUID 検証が緩く、PG `::uuid` 失敗で 500 になり得る**（Spec §7.2 は不正 400）。
2. **「日付必須」ルートテストが実質 `db_unavailable` を見ており偽 PASS**（Spec §7.1 / §11・MF-P2）。
3. **MF-I4 counts の status 非依存を自動テストで固定していない**（SQL は正しいが Spec §11 未達）。
4. **UI が 404（API 無効）と 404（行不存在）を同一トークン案内に潰す**（Spec §9.1 の固定文言と衝突）。
5. **authenticated / anon の表 SELECT 非拡大を pgTAP で固定していない**（Spec §11「service_role および authenticated/anon」）。

**最終判定: `REVISE_IMPL`**

- Critical must-fix: **0**
- Important must-fix 候補: **5**（MF-R1…R5）
- コア閲覧機能・秘匿境界は十分近い。上記を閉じれば **ACCEPT** に下げられる。

---

## Verdict: **REVISE_IMPL**

| 判定 | 条件 |
| --- | --- |
| **REVISE_IMPL** | 必須。MF-R1…R5 を実装 or テストで閉じてから完了扱いにする。 |
| 修正後 | **ACCEPT**（残差は §4.2 の scrape / jsonb TOAST / 共有 PC / 本番 `.env.admin` のみ）。 |
| **BLOCK** | 不要。Critical データ漏えい・GRANT 拡大・書込 API は確認されない。 |

---

## Spec/Plan チェックリスト

凡例: **pass** / **fail** / **partial**。根拠は live path。

### 不変条件・MF-I（Spec §4 / §15）

| ID | 項目 | 結果 | 根拠 |
| --- | --- | --- | --- |
| §4.1 / MF-I | 生 `menu_payload` をレスポンスに載せない | **pass** | `sharedRecipes.ts` 一覧は title 関数引数のみ、詳細は `mapSharedRecipeDetail` が preview のみ。`sharedRecipesResponseSchema` / `sharedRecipeDetailSchema` に raw キー無し。`schemas.test.ts` golden strip。 |
| §4.2 / MF-I5 | preview all-or-nothing | **pass** | `buildPreviewFromPayload`: 失敗時 `preview: null` + closed `previewError`。try/catch で 500 化しない。 |
| §4.3 | 一覧に dishes/steps/preview を載せない | **pass** | list SELECT 列 + `sharedRecipeListItemSchema`。`schemas.test.ts` で `"preview"` 非出現。 |
| §4.4 | 書込 API なし | **pass** | `register.ts` は GET 2 本のみ。`apiGetOnly` 継承。 |
| §4.5 / §10 | 検証は local 既定・本番注意 | **pass** | `admin/README.md` 検証既定・host 目視・token 必須。 |
| §4.6 | ログに title/preview/UUID 外識別子を出さない | **pass** | `fail`/`envelope` は closed body のみ。token 無効は固定 1 行 warn。 |
| §4.7 | preview Zod は admin 内 | **pass** | `admin/shared/schemas.ts`。本編 `shared/safety` 非 import。 |
| §4.8 / MF-I2-A | token 必須・未設定時ルート非登録 | **pass** | `register.ts` L203–264。`app.test.ts` 404 / 401。起動 warn。 |
| §4.9 / MF-I6 | origins UUID 相関・email 非露出 | **pass** | `contributor_user_id` / `source_menu_id` のみ。email SELECT なし。 |
| MF-I1 | 親設計同一単位改訂 | **pass** | live 親 §2.2/§3.1/§5.6 改訂済み（本 range の diff 外・Plan 明記どおり）。 |
| MF-I3 | 一覧 jsonb 負荷の緩和 | **pass** | 日付≤31・`clampLimit` max 100・ops `statement_timeout` 親継承。生成列は非目標。 |
| MF-I4 | counts = 日付+mealType、status は items のみ | **pass（実装）** / **partial（検証）** | `listSharedRecipes` countWhere に status 無し。**自動テストなし → MF-R3**。 |
| MF-I7 | sql-guard + FORBIDDEN + pgTAP | **partial** | basename allowlist・FORBIDDEN 追加・ops DML 不可・service_role 無 SELECT は **pass**。authenticated/anon 無 SELECT は **未 assert → MF-R5**。 |
| MF-I8 | scrape 残差・一覧に preview 無し | **pass** | 設計残差のまま。一覧 preview 無しは schema テストで固定。 |

### API / SQL / DB（Spec §6–8, Plan Task 1–4）

| 項目 | 結果 | 根拠 |
| --- | --- | --- |
| GRANT SELECT recipes/origins | **pass** | `20260812120000_ops_readonly_shared_recipes.sql` |
| EXECUTE title 関数 | **pass** | 同 migration + pgTAP |
| ops created_at,id 索引 | **pass** | `shared_emergency_recipes_ops_created_id_idx` |
| DML GRANT なし | **pass** | migration に INSERT/UPDATE/DELETE なし + pgTAP |
| service_role 表 SELECT 非拡大 | **pass** | pgTAP 2 assert |
| 一覧 SQL title 関数 + LEFT JOIN origins | **pass** | `sharedRecipes.ts` L61–82 |
| 詳細 SQL menu_payload + mapper 破棄 | **pass** | `getSharedRecipe` + `mapSharedRecipeDetail` |
| Query: from/to・status・mealType・limit≤100 | **partial** | enum/limit は **pass**。from/to「必須」は親 `parseJstDateRange` の双方省略=既定7日で **fail/部分** → **MF-R2** |
| :id UUID 不正 400 / 不存在 404 | **partial** | 明らかな非 UUID は 400。`/^[0-9a-f-]{36}$/i` は **36 文字の hex+`-` なら通過**し、PG cast 失敗時 **500 経路** → **MF-R1**。不存在 404 は結合テストなし（Plan も defer） |
| 並び created_at DESC, id DESC | **pass** | list SQL |
| sql-guard basename exact | **pass** | `sql-guard.test.ts` `ALLOW_MENU_PAYLOAD_BASENAME` |
| FORBIDDEN menu_payload/menuPayload | **pass** | `schemas.ts` L305–306 + test |
| access matrix notes | **pass** | `database-access-matrix.md` recipes/origins |
| pgTAP plan(50) | **pass** | `ops_readonly_role.test.sql` |

### UI / README（Spec §9–10, Plan Task 5–6）

| 項目 | 結果 | 根拠 |
| --- | --- | --- |
| ナビ「共有レシピ」 | **pass** | `Layout.tsx` |
| Route `shared-recipes` | **pass** | `app.tsx` |
| 注意文言（外部共有禁止） | **pass** | `SharedRecipesPage` 一覧・詳細 |
| サマリ active/disabled | **pass** | Stat + API counts |
| フィルタ 日付/status/mealType | **pass** | DateRangeFilter + select |
| テーブル列（status 含む） | **partial** | 列は揃う。**disabled の視覚強調なし**（Minor） |
| in-page 詳細 + preview パネル | **pass** | dishes/timeline/adaptations 固定フィールド |
| previewError 時 raw 非表示 | **pass** | ラベル + code のみ |
| 書込 UI なし | **pass** | 閉じる・UUID 表示のみ |
| token 未設定時の固定案内 | **partial** | エラー後の動的文言のみ。**404 を token 案内に潰す** → **MF-R4** |
| README token 必須・本番注意・画面一覧 | **pass** | `admin/README.md` |

### 受け入れ条件（Spec §13）

| # | 結果 | 注 |
| --- | --- | --- |
| 1 一覧（token 時） | **pass** | 実装・ナビ・API |
| 2 フィルタ + counts 定義 | **partial** | 実装 pass / テスト partial（MF-R3） |
| 3 構造化プレビュー | **pass** | |
| 4 生 payload 非露出 | **pass** | |
| 5 壊 payload / 未知 version → previewError | **pass** | mapper unit |
| 6 ops SELECT・DML 不可・service_role | **partial** | service_role pass; auth/anon 未固定（MF-R5） |
| 7 書込 UI/API なし | **pass** | |
| 8 token 未設定で API 不可 | **pass** | |
| 9 local 検証可能 | **pass**（文書）。手動 seed 一覧は本レビュー未実行 |
| 10 親設計矛盾なし | **pass** | live 親と子一致 |

### Plan MF-P

| ID | 結果 | 注 |
| --- | --- | --- |
| MF-P1 完全 SQL・counts・一覧に payload 列なし | **pass** | |
| MF-P2 テスト束 | **partial** | token/enum/FORBIDDEN/preview 無しは pass。日付必須テストが偽、counts・detail 404 欠落 |
| MF-P3 detail title 関数 | **pass** | |
| MF-P4 6→8 表・6→7 画面コメント | **pass** | |

---

## Findings

### Critical

なし。

---

### Important（must-fix 候補）

#### MF-R1 — `:id` UUID 検証が緩く、不正入力が 500 になり得る

- **Spec:** §7.2「`:id` は UUID。不正は 400、不存在は 404」
- **live:** `register.ts` L247–248  
  `if (!id || !/^[0-9a-f-]{36}$/i.test(id))`  
  例: `------------------------------------` や hyphen 配置不正の 36 文字は通過し、`where r.id = $1::uuid` で PostgreSQL が `invalid input syntax for type uuid` を投げ得る。`fail` は非 `AdminClosedError` を **500 `internal_error`** に閉じる（漏えいはしないが契約違反）。
- **攻撃/敵対:** 同一ホストで Bearer を持つオペレータ（または token 漏洩時）が closed 契約を 500 にずらす。データ漏えいにはならない。
- **修正:** `z.string().uuid()` 相当（RFC 版/バリアントまで）で 400。または `badRequest` 前に strict UUID。回帰: 上記偽 UUID → 400、存在しない正当 UUID → 404（mock pool 可）。

#### MF-R2 — 「日付必須」ルートテストが偽 PASS（Spec §7.1 / §11・MF-P2）

- **Spec:** §7.1 `from`/`to` **必須**。§11 route test「日付必須」。
- **live:**
  - `parseJstDateRange`: 双方省略時は直近 7 日にフォールバック（`jst.ts` L91–94）。
  - `app.test.ts`「rejects shared-recipes without date range」は **pool null → `db_unavailable` 400** を見ており、`date_range_required` を検証していない（テスト内コメントもそれを認める）。
  - 片側のみ省略は 400（正しい）が、テスト未記載。
- **影響:** 受け入れ回帰が嘘をつく。UI は常に from/to を送るため運用実害は小さいが、**API 直叩きで日付なし一覧**が通る（親他画面と同型）。
- **修正（どちらかを固定）:**
  1. **Spec どおり:** 共有レシピルートだけ双方省略を `date_range_required` 400 にし、テストで code を assert。
  2. **親同型を採用:** Spec/Plan を「双方省略は既定 7 日」に改訂し、テスト名と assert（例: 片側省略 400、双方省略は 200 または db 到達）を直す。  
  二次推奨は **(1)**（子 Spec の表が「必須」と明記）。

#### MF-R3 — counts が status フィルタに依存しないことの自動テスト欠落（MF-I4）

- **Spec:** §7.1 固定定義、§11「counts が status フィルタに依存しないこと」。
- **live SQL:** **正しい**（`listSharedRecipes` の counts に status を入れない）。
- **テスト:** route / query unit いずれにも **status=active でも activeCount+disabledCount が両 status を含む** 証明がない。
- **影響:** 将来のリファクタで items WHERE を counts にコピーすると silent regression。
- **修正:** mock `PoolClient` で `listSharedRecipes` に status 付き呼び出し、count 用 SQL/params に status が無いこと、または 2 クエリ結果の意味を fixture で固定。

#### MF-R4 — UI が 404 を常に token 案内へ潰す（Spec §9.1）

- **Spec:** §9.1 token 未設定時は固定文言「`ADMIN_LOCAL_TOKEN` が必要です」。行不存在は 404（API）。
- **live:** `SharedRecipesPage.formatApiError` が  
  `リソースが見つかりません` / `404` をまとめて  
  「共有レシピ API が無効か…ADMIN_LOCAL_TOKEN の設定を確認」に変換。
- **結果:** token 設定済みで存在しない id を開いた場合も **token 設定を疑わせる**。API 無効（ルート未登録）と not_found を区別できない。
- **修正:**  
  - ルート未登録: 一覧初回 404 + `not_found` かつ token 未保存なら固定「ADMIN_LOCAL_TOKEN が必要です」。  
  - 詳細 not_found: 「対象の共有レシピが見つかりません」。  
  - 401: 現行どおり Bearer 案内。  
  可能なら一覧ロード前に「token 未入力」を静的表示（sessionStorage 空）。

#### MF-R5 — authenticated / anon の recipes/origins SELECT 非拡大が pgTAP 未固定（Spec §11 / MF-I7 付帯）

- **Spec:** §11「`service_role`（**および authenticated/anon**）に recipes/origins の表 SELECT が増えていない」
- **live:** service_role のみ assert。migration コメントは「拡大しない」だが **auth/anon の not has_table_privilege が無い**。
- **影響:** 将来の誤 GRANT を service_role 以外で見逃す。現状 migration は ops のみなので **現行は安全**。
- **修正:** pgTAP に 4 assert 追加（recipes/origins × authenticated/anon）。`plan` を 50→54 等に更新。

---

### Minor / residual

| ID | 内容 | 扱い |
| --- | --- | --- |
| M1 | 一覧 `status` 列が plain text。Spec §9.2「disabled を視覚的に明示」未達 | CSS 色分け推奨。Important にしない |
| M2 | Stat ラベル「active（全体）」が日付範囲内・mealType 後の件数であることがやや誤解を招く | 文言調整 |
| M3 | `sharedRecipeDetailSchema` が preview / previewError の XOR を refine しない | mapper が保証。スキーマ強化は任意 |
| M4 | preview 文字列に max 長がほぼ無い（Spec「長さ上限」文言 vs Plan も max なし） | 単一オペレータ残差。必要なら follow-up |
| M5 | 詳細 404（存在しない正当 UUID）の自動テスト欠落 | Plan も defer。mock で null 返却を推奨（MF-R1 と同時可） |
| M6 | 製品 limit 20 / salt 非適用 | Spec §4.2 / MF-I8 承認残差 |
| M7 | 一覧 title の jsonb TOAST 読み | MF-I3 文書化済み残差 |
| M8 | 共有 PC・本番 `.env.admin` | 親+README 残差 |
| M9 | 親設計改訂が本 commit range 外 | Plan 許容。live 整合は確認済み |

---

## 攻撃経路横断（敵対視点の二次要約）

| 経路 | 判定 |
| --- | --- |
| レスポンスへの生 `menu_payload` 混入 | **遮断**（列選択 + pick + Zod + FORBIDDEN + list schema） |
| sql-guard 迂回で他 query に payload | **遮断**（basename exact） |
| token 無しで構造化本文 GET | **遮断**（ルート非登録 → 404。設定時は middleware 401） |
| status/mealType 注入 | **遮断**（enum gate + bind） |
| limit 引き上げ scrape | **緩和**（≤100・日付≤31）。MF-I8 残差 |
| ops 経由 DML | **遮断**（GRANT + READ ONLY 親） |
| service_role への表 SELECT 拡大 | **現状なし** + pgTAP。auth/anon は MF-R5 |
| 偽 UUID でエラーメッセージに SQL/payload | **closed 500**（本文非露出）。契約は MF-R1 |
| UI 経由の外部共有 | **運用注意のみ**（仕様どおり） |

---

## 推奨修正順序

1. **MF-R1** — strict UUID + 回帰（400/404）。低コスト・契約直撃。  
2. **MF-R2** — 日付必須をルートで enforce **または** Spec/テストを親同型に正直化。偽 PASS を消す。  
3. **MF-R3** — counts の status 非依存を unit で固定（MF-I4 の再発防止）。  
4. **MF-R4** — UI エラー分岐（token 無効 vs not_found vs 401）。  
5. **MF-R5** — pgTAP auth/anon SELECT 否定（plan 件数更新）。  
6. Minor（M1 disabled 視覚、M2 ラベル）は任意。

---

## 結論表

| 項目 | 値 |
| --- | --- |
| Verdict | **REVISE_IMPL** |
| Critical | **0** |
| Important must-fix（MF-R） | **5**（R1…R5） |
| Minor / residual | 9 |
| コア不変条件（生 payload・token・GRANT・all-or-nothing） | **概ね充足** |
| 次アクション | MF-R1…R5 修正 → 焦点 test → 再二次 or 親が ACCEPT 判定 |

---

## 本レビューの範囲外

- Docker 上での `npm test` / `db-test` 実実行（静的照合のみ）。
- 1次・敵対レビュー文書のクロスウォーク（指示どおり未参照で独立判定）。
- 本番 DB への接続・目視。
