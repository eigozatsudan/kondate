# admin 共有レシピ閲覧設計

- 日付: 2026-08-12
- 状態: **レビュー MF 反映済み・人間再承認待ち**（承認後に implementation plan）
- 種別: 設計。既存 admin コンソールへの第2スライス追加
- 親設計: [`2026-08-11-local-ops-admin-console-design.md`](./2026-08-11-local-ops-admin-console-design.md)（§3.1 / §5.6 / §2.2 を本スライスと **同一変更で必須改訂**）
- 対象: ローカル専用運用管理コンソール（`admin/`）で、緊急共有プール掲載済みレシピを **閲覧のみ** 確認する
- レビュー:
  - [1次](../reviews/2026-08-12-admin-shared-recipes-viewer-primary.md)（**REVISE**）
  - [敵対](../reviews/2026-08-12-admin-shared-recipes-viewer-adversarial.md)（**BLOCK_WITH_CONDITIONS**）
  - [2次](../reviews/2026-08-12-admin-shared-recipes-viewer-secondary.md)（**REVISE_SPEC** / MF-I1…I8 → 本文反映済み）

---

## 1. 結論

オペレータが admin から、`private.shared_emergency_recipes` に掲載された共有レシピを一覧し、**構造化プレビュー**で品質（一般化の崩れ・不自然な手順など）を目視確認できるようにする。

| 項目 | 決定 |
| --- | --- |
| 画面 | 独立ページ「共有レシピ」（既存「共有ジョブ」は維持） |
| 操作 | **GET / SELECT のみ**。active/disabled 変更・削除・再一般化キックはしない |
| 本文 | 生 `menu_payload` JSON は API・UI・ログに **出さない**。詳細はサーバ側の **構造化 preview DTO のみ** |
| フィルタ | **必須日付範囲** + `status` + `meal_type` |
| 識別 | `user_id` / `contributor_user_id` は UUID のみ。email・氏名・`auth.*` は出さない |
| DB | `kondate_ops_readonly` に両表の **SELECT GRANT** を追加（書込 GRANT なし） |
| Token | `/api/shared-recipes` および `/:id` は **`ADMIN_LOCAL_TOKEN` 必須**（未設定時は当該ルートを登録しない） |
| 接続 | `.env.admin` は本番を指し得る。実装検証の既定は **local Compose DB** |

既存 admin の不変条件（127.0.0.1 publish、Host allowlist、READ ONLY トランザクション、closed error、本編非混入）はすべて継承する。共有レシピ API のみ token を親の「推奨」から **必須へ昇格**する。

---

## 2. 目的と対象外

### 2.1 目的

- 共有プールに載っているレシピの **品質目視**（一般化パイプライン成功後の成果物確認）。
- 日付・status・meal_type で絞り、メタと構造化本文を同じコンソールで見る。
- パイプライン滞留監視（共有ジョブ）と、プール掲載内容の確認を **画面として分離**する。

### 2.2 対象外

- status の `active` ↔ `disabled` 切替、削除、再 enqueue。
- 生 `menu_payload` の表示・ダウンロード・ログ出力。
- タイトル / payload の ILIKE キーワード検索（第1版）。
- 本編アプリ・Netlify Functions・共有同意フローの変更。
- PostgREST への `private` 公開、`service_role` への表 GRANT 拡大。
- admin の Netlify / 本番 URL デプロイ。
- 本編 e2e / 本編 CI への admin 組み込み。
- 本番 DB へのエージェント自動接続・本番 migration 適用。
- 製品 `list_active_shared_emergency_recipes` と同等の salt 攪拌・limit 20 境界の再現（admin は直 SELECT。§4.2 残差）。

---

## 3. 背景と現状ギャップ

| 現状 | ギャップ |
| --- | --- |
| 「共有ジョブ」は `private.share_generalization_jobs` の滞留・失敗のみ | 掲載済みプール本文は見えない |
| 親設計 §3.1 / §5.6 は共有レシピ本文を禁止（第1版） | 品質目視には構造化閲覧が必要 → **本設計 + 親改訂で限定解除** |
| `kondate_ops_readonly` に jobs のみ SELECT | recipes / origins に SELECT なし |
| sql-guard が `/menu_payload/i` を全クエリ禁止 | 詳細 SELECT と衝突 → ファイル単位で改訂 |

データ正本:

- プール本体: `private.shared_emergency_recipes`（`menu_payload`, `meal_type`, `total_elapsed_minutes`, `status`, `standard_allergen_ids`, `eligible_age_bands`, `created_at`）
- 由来: `private.shared_emergency_recipe_origins`（`recipe_id`, `contributor_user_id`, `source_menu_id`）
- タイトル抽出の製品ロジック: `private.share_recipe_title_from_payload(jsonb)`（main 料理名、なければ dishes 連結、最大 80 字）

共有プール本文はアカウント削除方針上も **匿名 payload として残す**対象であり、個人プロフィールやアレルギー詳細の閲覧とは別物である。ただし運用上は自由記述に近いテキストを含むため、外部共有は禁止する。

---

## 4. 不変条件（本スライス）

親設計の不変条件に加え、本機能固有:

1. **レスポンスに生 `menu_payload` を載せない。** SELECT はサーバ内に閉じ、mapper が preview DTO に投影してから返す。
2. **preview パースは all-or-nothing。** 失敗時は `preview: null` と closed な `previewError` のみ。部分表示・raw 混在はしない。
3. **一覧 SQL は title 抽出 + メタに留める。** 一覧レスポンスに dishes / steps / preview を載せない（テストで固定）。
4. **書込 API を追加しない。** disabled 化は別設計・別経路。
5. **本番接続の扱い:** `.env.admin` が本番 Session pooler を指すことがある。実装中の自動検証・エージェント作業は local DB を既定とし、本番への admin 起動・目視は人間が明示的に行う。起動前に `ADMIN_DATABASE_URL` の host を目視する。
6. **ログ:** title・preview 本文・UUID 以外の識別子・SQL 断片・接続 URL をサーバーログに出さない（path・status・所要・closed code のみ）。
7. **本編 `shared/` パッケージを admin Docker に無理に持ち込まない。** preview 用 Zod は **admin パッケージ内**に置く。
8. **共有レシピ API の token 必須（MF-I2-A）:** `ADMIN_LOCAL_TOKEN` が未設定のとき、`/api/shared-recipes` および `/api/shared-recipes/:id` を **登録しない**（他の既存 API は親どおり token 推奨のまま）。クライアントは Bearer を付与する。未設定で当該 path に来た場合は既存の 404 に任せるか、ルート登録時にだけスキップする（実装は後者推奨: 起動ログに「共有レシピ API 無効: token 未設定」を1行）。
9. **origins 相関（運用特権）:** ops は品質調査のため `contributor_user_id`（UUID）と構造化本文を相関し得る。email・氏名は出さない。製品 UI の寄稿者非表示とは **別面の運用特権**である。

### 4.1 親設計の改訂（必須・同一変更）

親 [`2026-08-11-local-ops-admin-console-design.md`](./2026-08-11-local-ops-admin-console-design.md) の §2.2 / §3.1 / §5.6 を本スライスと **同じ PR / 同じ実装単位で改訂する**（任意ではない）。

正本の意味:

> 共有プールの **生 `menu_payload` は API / UI / ログに出さない。**  
> オペレータ品質確認のため、詳細 API はサーバ側で構造化した **preview DTO のみ**返す。  
> 一覧は title 抽出とメタデータに留める。  
> 詳細は本書および本設計。

### 4.2 残差（人間承認対象・must-fix 後も残る）

| 残差 | 扱い |
| --- | --- |
| 製品 `list_active` の limit 20 / salt 境界を admin は適用しない | 日付必須（≤31 日）・limit≤100 による緩和のみ。単一信頼オペレータ前提。一覧に preview を載せないことはテストで固定（MF-I8） |
| 一覧 title 導出の jsonb TOAST 読み | §7.1 で文書化。生成列化は follow-up |
| disabled 行の ops 可読 | 監査有用。UI で status を明示 |
| 深い offset | 親と同型。非目標 |
| 共有 PC | 起動しない（親受け入れ）。token 必須で同一ホスト他 UID のリスクは低減するがゼロではない |
| 本番 `.env.admin` 誤操作 | §10 + README。エージェントは本番自動接続しない |

---

## 5. アーキテクチャ

```
Browser  http://127.0.0.1:5193/shared-recipes
    │  同一 origin + Host allowlist + Bearer (共有レシピ API は必須)
    ▼
admin BFF (Hono, GET only)
    │  named query + BEGIN READ ONLY
    │  session_user = kondate_ops_readonly
    ▼
Postgres
    private.shared_emergency_recipes      (SELECT)
    private.shared_emergency_recipe_origins (SELECT)
    private.share_recipe_title_from_payload (EXECUTE, 一覧 title 用)
```

既存ミドルウェア（host / method）・静的配信・pool 設定は変更しない。共有レシピ 2 ルートのみ token 必須の登録条件を追加する。

### 5.1 パッケージ配置

```
admin/
  client/src/pages/SharedRecipesPage.tsx
  client/src/components/Layout.tsx          # ナビ追加
  client/src/app.tsx                        # Route 追加
  server/src/queries/sharedRecipes.ts       # basename 固定（sql-guard allowlist）
  server/src/lib/map-shared-recipe.ts
  server/src/routes/register.ts             # GET 2 本（token 必須時のみ）
  shared/schemas.ts                         # list / detail / preview DTO + FORBIDDEN 更新
supabase/migrations/YYYYMMDDHHMMSS_ops_readonly_shared_recipes.sql
supabase/tests/database/ops_readonly_role.test.sql  # 追記
docs/testing/database-access-matrix.md      # 追記
admin/README.md                             # 画面一覧・本番注意・token 必須
親設計 2026-08-11-local-ops-admin-console-design.md  # §2.2 / §3.1 / §5.6 必須改訂
```

---

## 6. DB 変更

### 6.1 GRANT

```sql
grant select on private.shared_emergency_recipes to kondate_ops_readonly;
grant select on private.shared_emergency_recipe_origins to kondate_ops_readonly;
grant execute on function private.share_recipe_title_from_payload(jsonb)
  to kondate_ops_readonly;
```

- INSERT / UPDATE / DELETE は付与しない。
- 表に RLS が無い前提（現行 migration）。RLS が後から入る場合は ops 用 SELECT policy を別途足す（現状は不要）。
- `service_role` / `authenticated` / `anon` / PostgREST への表 GRANT は増やさない（pgTAP で `not has_table_privilege('service_role', …, 'select')` 等を維持・追加）。

### 6.2 索引

```sql
create index if not exists shared_emergency_recipes_ops_created_id_idx
  on private.shared_emergency_recipes (created_at desc, id desc);
```

`origins` は PK `recipe_id` のため追加不要。既存 `shared_emergency_recipes_active_meal_idx` は active 部分索引のまま残す。

### 6.3 一覧 title（固定）

一覧 SELECT は次で固定する:

```sql
private.share_recipe_title_from_payload(r.menu_payload) AS title
```

製品と同じ title 規則。ops に当該関数の EXECUTE のみ追加する。  
（代替の TS 算出は不採用: 製品 title 規則と一致させるため DB 関数を正とする。）

注: 引数に `r.menu_payload` と書くため、一覧 SQL にも `menu_payload` 文字列は現れる。秘匿の正は「レスポンスに生 payload を載せない」ことであり、sql-guard は §8 のとおり **basename `sharedRecipes.ts` のみ** で `menu_payload` を許可する。

**負荷（MF-I3）:** title 導出は表示が title でも **行の `menu_payload`（jsonb / TOAST）読みを伴う**。緩和は日付 ≤31 日・`limit` ≤100・ops `statement_timeout=15s`。timeout / 失敗時は closed error のみ（title・payload をログに出さない）。生成列・物化 title は本スライス非目標（follow-up）。

詳細クエリは `menu_payload` 列を SELECT するが、mapper が preview に投影したあと破棄し、DTO に載せない。

---

## 7. API

すべて **GET のみ**。既存 envelope（`ok` + data / closed error）に従う。  
**登録条件:** `ADMIN_LOCAL_TOKEN` が non-empty のときのみ下記 2 ルートを register する。

| Path | 用途 |
| --- | --- |
| `GET /api/shared-recipes` | 一覧 + status 件数サマリ |
| `GET /api/shared-recipes/:id` | メタ + 構造化 preview |

### 7.1 一覧 `GET /api/shared-recipes`

**Query**

| 名 | 必須 | 規則 |
| --- | --- | --- |
| `from`, `to` | はい | JST 暦日 `YYYY-MM-DD`。server が `[start, next)` UTC に変換。範囲上限 **31 日** |
| `status` | いいえ | `active` \| `disabled`。**一覧行の WHERE にのみ適用**（counts には適用しない） |
| `mealType` | いいえ | `breakfast` \| `lunch` \| `dinner`。**一覧行と counts の両方に適用** |
| `limit` | いいえ | 既定 50、上限 **100**（サーバ強制） |
| `offset` | いいえ | 既定 0。`hasMore` / `total` は第1版非目標（親と同型 offset） |

**並び:** `created_at DESC, id DESC`

**counts 定義（MF-I4・固定）:**

> `activeCount` / `disabledCount` は **日付範囲 + `mealType` フィルタ後**の `status` 別件数。  
> `status` クエリは **一覧 `items` にのみ**適用し、counts には適用しない。

**レスポンス（概念）**

```ts
{
  generatedAt: string; // ISO
  activeCount: number;
  disabledCount: number;
  items: SharedRecipeListItem[];
}
```

**ListItem 列**

| フィールド | 由来 |
| --- | --- |
| `id` | recipes.id |
| `createdAt` | recipes.created_at |
| `status` | recipes.status |
| `mealType` | recipes.meal_type |
| `totalElapsedMinutes` | recipes.total_elapsed_minutes |
| `title` | title 関数（最大 80 字。詳細の料理名全文とは一致しない場合あり） |
| `standardAllergenIds` | recipes.standard_allergen_ids（配列そのまま。UI は CSS truncate 可） |
| `eligibleAgeBands` | recipes.eligible_age_bands（同上） |
| `contributorUserId` | origins（NULL 可） |
| `sourceMenuId` | origins（NULL 可） |

JOIN: `LEFT JOIN private.shared_emergency_recipe_origins o ON o.recipe_id = r.id`

### 7.2 詳細 `GET /api/shared-recipes/:id`

- `:id` は UUID。不正は 400、不存在は 404。
- SELECT に `menu_payload` を含めるが、mapper が preview に変換後に破棄。
- **all-or-nothing:** パース成功時のみ `preview` オブジェクト + `previewError: null`。失敗時は `preview: null` + closed `previewError`（部分表示しない）。
- `previewError` の closed 値:
  - `invalid_menu_payload` — 構造・型が preview schema を満たさない
  - `unsupported_schema_version` — 既知 `schemaVersion` 以外（第1版で受理するのは製品現行 `"2026-07-11.v1"` のみ）

**Detail メタ:** ListItem と同型（第1版で追加メタは増やさない）。

**preview 投影（品質目視用・admin 内 Zod・フィールド固定）**

| ブロック | 含める（これ以外は strip） |
| --- | --- |
| ルート | `schemaVersion`, `menuId`, `mealType`, `cuisineGenre`, `servings`, `totalElapsedMinutes`, `safetyTags` |
| `dishes[]` | `role`, `position`, `name`, `description`, `cookingTimeMinutes`, `ingredients[]`（`name`, `quantityText`, `unit`, `storeSection`）, `steps[]`（`position`, `instruction`） |
| `timeline[]` | `position`, `startMinute`, `durationMinutes`, `instruction` |
| `adaptations[]` | `portionText`, `additionalCutting`, `additionalHeating`, `additionalSeasoning`, `servingCheck`, `anonymousMemberRef`, `safetyActions[]`（`kind`, `instruction` のみ） |

**preview から除外（第1版・固定）**

- 生 jsonb / 未投影キー / passthrough
- `pantryUsage`（家庭保存食の紐づけ）
- `labelConfirmations`
- dish / ingredient / step / adaptation / timeline の **UUID id フィールド**
- adaptations の dishId / branchBeforeRecipeStepId 等の参照 UUID

パースは admin 専用 preview schema。本編 `validatedMenuSchema` の superRefine 全項目は持ち込まない。必須は上表の object 構造・配列・主要文字列の存在と長さ上限。未知キーは strip。必須欠落は all-or-nothing で失敗。

---

## 8. sql-guard と秘匿

| ルール | 内容 |
| --- | --- |
| 許可ファイル | **basename が exact `sharedRecipes.ts` のファイルのみ** `menu_payload` 文字列を SQL に含めてよい（path 末尾一致。別名コピー不可） |
| 他 query ファイル | 現行どおり `/menu_payload/i` 禁止を維持 |
| FORBIDDEN_DTO_KEYS | `menu_payload` および `menuPayload` を **追加**（既存 identity/stripe/hmac 等は維持） |
| DTO / golden test | list/detail のシリアライズ JSON に `"menu_payload"` / `"menuPayload"` が出現しないこと |
| 既存禁止 | `identity_key`, `request_hmac*`, `stripe_*`, `auth.users`, `SELECT *` は維持 |

---

## 9. UI

### 9.1 ナビ・ルート

- Layout: `{ to: "/shared-recipes", label: "共有レシピ" }`（「共有ジョブ」の近傍）
- `app.tsx`: `<Route path="shared-recipes" element={<SharedRecipesPage />} />`
- token 未設定時: ナビは出してよいが API が無いため、画面に「`ADMIN_LOCAL_TOKEN` が必要です」と固定文言（secret は出さない）

### 9.2 一覧

- 見出し: 「共有レシピ」
- 注意: 「共有プールの匿名化済み本文です。外部共有・スクショ・チャット貼付をしないでください。」
- サマリ: `activeCount` / `disabledCount`（§7.1 の定義どおり。status フィルタ中でも内訳は範囲+mealType の全 status）
- フィルタ: 日付（共通 `DateRangeFilter`）、status、meal_type
- テーブル列: `created_at`, `status`（disabled を視覚的に明示）, `meal_type`, `title`, `elapsed`, allergens（配列 join または CSS truncate）, age_bands（同様）, contributor (`UuidText`), `id` (`UuidText`)
- 行選択で詳細パネルを開く（feedback と同型の in-page detail）
- 深い offset の UI は非目標（次ページが空なら打ち切りでよい）

### 9.3 詳細パネル

- メタ一覧（status, meal_type, elapsed, allergens, age_bands, created_at, id, contributor, source_menu_id）
- 構造化プレビュー:
  - ヘッダ（ジャンル・人数・合計時間・safetyTags）
  - 料理カード（材料・手順）
  - タイムライン
  - 取り分け / 安全指示（§7.2 の固定フィールドのみ）
- `preview === null`: 「構造を解釈できません」+ `previewError` 表示。raw は出さない
- アクション: 閉じる、UUID コピーのみ。disabled ボタンは置かない

スタイル・密度は既存 admin（デスクトップ運用）に合わせる。本編 mobile-first / 44px 必須は適用しない。

---

## 10. 接続先と検証の安全境界

| 状況 | 方針 |
| --- | --- |
| `.env.admin` | 本番 Session pooler を指し得る。コミット対象外のまま |
| 実装・CI 相当の自動検証 | **local Compose DB**（`ADMIN_ALLOW_INSECURE_LOCAL_DB=1` + local URL）を既定 |
| migration | local で apply + pgTAP。本番 apply は人間の runbook（エージェントは本番に触らない） |
| 本番での目視 | 人間が自分の admin 起動で実施。起動前に host 目視。エージェントはユーザー明示指示があるまで本番 URL で admin を起動しない |
| 本番 SELECT | 書込はできないが、構造化後とはいえ本番プール本文を閲覧する。UI 注意と README を再掲 |
| Token | 共有レシピ API 利用時は `.env.admin` に `ADMIN_LOCAL_TOKEN` 必須 |

`admin/README.md` の画面一覧に「共有レシピ」を追加し、本番接続注意・token 必須・共有 PC 禁止を再掲する。

---

## 11. テスト

| 層 | 内容 |
| --- | --- |
| pgTAP (`ops_readonly_role`) | 両表 SELECT 可、INSERT/UPDATE/DELETE 不可。title 関数 EXECUTE 可 |
| pgTAP / inventory | **`service_role`（および authenticated/anon）に recipes/origins の表 SELECT が増えていない**こと |
| admin unit | mapper: 正常 payload → preview、壊れた payload → null + `invalid_menu_payload`、未知 schemaVersion → `unsupported_schema_version` |
| schemas | list/detail round-trip。`FORBIDDEN_DTO_KEYS` に `menu_payload` / `menuPayload`。シリアライズ golden で raw キー無し |
| sql-guard | basename `sharedRecipes.ts` のみ許可。他 query に `menu_payload` 無し |
| route test | token 無しでルート未登録 or 401/404 方針どおり、日付必須・enum 不正 400、詳細 404、counts が status フィルタに依存しないこと、一覧 body に preview キー無し |
| 手動（local） | 複数件 seed で一覧が statement_timeout 内に返ること、一覧→詳細の目視 |

本編 e2e には載せない。admin の format / lint / typecheck / test は admin パッケージ境界で実行。

---

## 12. 実装順序（plan 用の骨子）

1. **親設計** §2.2 / §3.1 / §5.6 の改訂（本スライスと同一単位・必須）
2. migration（GRANT + index + title 関数 EXECUTE）と pgTAP / access matrix
3. admin `shared/schemas.ts` に list/detail/preview DTO + FORBIDDEN 更新
4. `queries/sharedRecipes.ts` + `map-shared-recipe.ts` + sql-guard 改訂
5. routes 登録（token 必須条件）+ route/unit tests
6. `SharedRecipesPage` + Layout / app ルート
7. README 更新

本編 `src/` / `netlify/functions/` は触らない。

---

## 13. 受け入れ条件

1. admin ナビから「共有レシピ」を開き、日付範囲内の掲載行が一覧できる（`ADMIN_LOCAL_TOKEN` 設定時）。
2. `status` / `mealType` フィルタが一覧に効く。counts は §7.1 定義どおり（status 非依存・mealType 依存）。
3. 行を選ぶと構造化プレビュー（料理名・材料・手順等）が見える。
4. ネットワークレスポンスと UI のいずれにも生 `menu_payload` / `menuPayload` オブジェクトが載らない。
5. 壊れた payload や未知 schemaVersion でも 500 にせず、preview なし + closed `previewError` になる（部分表示なし）。
6. ops ロールは recipes/origins を SELECT できるが DML はできない（pgTAP）。service_role 等への表 SELECT が増えていない。
7. 書込 UI / 書込 API が存在しない。
8. `ADMIN_LOCAL_TOKEN` 未設定時は共有レシピ API が利用できない。
9. 検証は local DB で再現可能（複数件 seed の一覧が timeout しない）。本番接続は人間の明示操作に限定できる。
10. 親設計 §3.1 / §5.6 の文言が本設計と矛盾しない。

---

## 14. 決定ログ

| 決定 | 内容 |
| --- | --- |
| 主目的 | プール品質の目視確認 |
| 深さ | 構造化プレビュー（生 JSON なし） |
| 操作 | 閲覧のみ |
| フィルタ | 日付 + status + meal_type |
| counts | 日付+mealType 後の status 別。status クエリは items のみ |
| 配置 | 独立画面（共有ジョブは維持） |
| preview schema | admin パッケージ内。adaptations フィールド固定。all-or-nothing |
| title | 製品関数 `share_recipe_title_from_payload` を ops から EXECUTE |
| Token | 共有レシピ API のみ `ADMIN_LOCAL_TOKEN` 必須（MF-I2-A） |
| 親設計 | 同一単位で必須改訂（MF-I1） |
| 本番 `.env.admin` | 注意対象。自動検証は local 既定 |
| scrape 残差 | 製品 limit 20 非適用。日付・limit 緩和 + 単一オペレータ（MF-I8） |

---

## 15. レビュー MF 反映チェック

| ID | 内容 | 反映箇所 |
| --- | --- | --- |
| MF-I1 | 親改訂必須 | §4.1 / §12.1 / 親設計本文 |
| MF-I2 | token 必須 A | §1 / §4.8 / §5 / §7 / §10 / §13.8 |
| MF-I3 | 一覧 jsonb 負荷 | §6.3 / §7.1 / §13.9 |
| MF-I4 | counts 定義 | §7.1 |
| MF-I5 | adaptations 固定 + all-or-nothing | §4.2 / §7.2 |
| MF-I6 | origins privacy | §4.9 |
| MF-I7 | sql-guard basename + FORBIDDEN + pgTAP | §8 / §11 |
| MF-I8 | scrape 残差 | §4.2 / §2.2 |
