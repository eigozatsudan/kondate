# admin 共有レシピ閲覧設計

- 日付: 2026-08-12
- 状態: **人間承認済み設計**（実装は implementation plan 後）
- 種別: 設計。既存 admin コンソールへの第2スライス追加
- 親設計: [`2026-08-11-local-ops-admin-console-design.md`](./2026-08-11-local-ops-admin-console-design.md)
- 対象: ローカル専用運用管理コンソール（`admin/`）で、緊急共有プール掲載済みレシピを **閲覧のみ** 確認する

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
| 接続 | `.env.admin` は本番を指し得る。実装検証の既定は **local Compose DB** |

既存 admin の不変条件（127.0.0.1 publish、Host allowlist、READ ONLY トランザクション、closed error、本編非混入）はすべて継承する。

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

---

## 3. 背景と現状ギャップ

| 現状 | ギャップ |
| --- | --- |
| 「共有ジョブ」は `private.share_generalization_jobs` の滞留・失敗のみ | 掲載済みプール本文は見えない |
| 親設計 §3.1 / §5.6 は共有レシピ本文を禁止 | 品質目視には構造化閲覧が必要 → **本設計で限定解除** |
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
2. **preview パース失敗時も raw を返さない。** `preview: null` と closed な `previewError` のみ。
3. **一覧 SQL は title 抽出 + メタに留める。** 一覧レスポンスに dishes / steps を載せない。
4. **書込 API を追加しない。** disabled 化は別設計・別経路。
5. **本番接続の扱い:** `.env.admin` が本番 Session pooler を指すことがある。実装中の自動検証・エージェント作業は local DB を既定とし、本番への admin 起動・目視は人間が明示的に行う。
6. **ログ:** title・preview 本文・UUID 以外の識別子・SQL 断片・接続 URL をサーバーログに出さない（path・status・所要・closed code のみ）。
7. **本編 `shared/` パッケージを admin Docker に無理に持ち込まない。** preview 用 Zod は **admin パッケージ内**に置く（本編 contracts への依存を admin 単体境界に増やさない）。

### 4.1 親設計 §3.1 の改訂（本機能に関する文言）

旧: 共有レシピ本文（`menu_payload`）を閲覧対象から常に除外。

新:

> 共有プールの **生 `menu_payload` は API / UI / ログに出さない。**  
> オペレータ品質確認のため、詳細 API はサーバ側で構造化した **preview DTO のみ**返す。  
> 一覧は title 抽出とメタデータに留める。

---

## 5. アーキテクチャ

```
Browser  http://127.0.0.1:5193/shared-recipes
    │  同一 origin + Host allowlist + 任意 Bearer token
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

既存ミドルウェア（host / method / token）・静的配信・pool 設定は変更しない。ルートと query / mapper / schema / 画面のみ追加する。

### 5.1 パッケージ配置

```
admin/
  client/src/pages/SharedRecipesPage.tsx
  client/src/components/Layout.tsx          # ナビ追加
  client/src/app.tsx                        # Route 追加
  server/src/queries/sharedRecipes.ts
  server/src/lib/map-shared-recipe.ts
  server/src/routes/register.ts             # GET 2 本
  shared/schemas.ts                         # list / detail / preview DTO
supabase/migrations/YYYYMMDDHHMMSS_ops_readonly_shared_recipes.sql
supabase/tests/database/ops_readonly_role.test.sql  # 追記
docs/testing/database-access-matrix.md      # 追記
admin/README.md                             # 画面一覧・本番注意の再掲
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
- `service_role` / `authenticated` / PostgREST への表 GRANT は増やさない。

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

注: 引数に `r.menu_payload` と書くため、一覧 SQL にも `menu_payload` 文字列は現れる。秘匿の正は「レスポンスに生 payload を載せない」ことであり、sql-guard は §8 のとおり **`sharedRecipes.ts` のみ** で `menu_payload` を許可する（一覧・詳細とも同ファイル）。

詳細クエリは `menu_payload` 列を SELECT するが、mapper が preview に投影したあと破棄し、DTO に載せない。

---

## 7. API

すべて **GET のみ**。既存 envelope（`ok` + data / closed error）に従う。

| Path | 用途 |
| --- | --- |
| `GET /api/shared-recipes` | 一覧 + 範囲内 status 件数 |
| `GET /api/shared-recipes/:id` | メタ + 構造化 preview |

### 7.1 一覧 `GET /api/shared-recipes`

**Query**

| 名 | 必須 | 規則 |
| --- | --- | --- |
| `from`, `to` | はい | JST 暦日 `YYYY-MM-DD`。server が `[start, next)` UTC に変換。範囲上限 **31 日** |
| `status` | いいえ | `active` \| `disabled` |
| `mealType` | いいえ | `breakfast` \| `lunch` \| `dinner` |
| `limit` | いいえ | 既定 50、上限 100 |
| `offset` | いいえ | 既定 0 |

**並び:** `created_at DESC, id DESC`

**レスポンス（概念）**

```ts
{
  generatedAt: string; // ISO
  activeCount: number;   // 日付範囲内
  disabledCount: number; // 日付範囲内
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
| `title` | title 関数 |
| `standardAllergenIds` | recipes.standard_allergen_ids |
| `eligibleAgeBands` | recipes.eligible_age_bands |
| `contributorUserId` | origins（NULL 可） |
| `sourceMenuId` | origins（NULL 可） |

JOIN: `LEFT JOIN private.shared_emergency_recipe_origins o ON o.recipe_id = r.id`

### 7.2 詳細 `GET /api/shared-recipes/:id`

- `:id` は UUID。不正は 400、不存在は 404。
- SELECT に `menu_payload` を含めるが、mapper が preview に変換後に破棄。
- パース成功: `preview` オブジェクト、`previewError: null`
- パース失敗: `preview: null`、`previewError: "invalid_menu_payload"`

**Detail メタ:** ListItem と同型 + 必要なら同一フィールドの再掲のみ（第1版で追加メタは増やさない）。

**preview 投影（品質目視用・admin 内 Zod）**

| ブロック | 含める |
| --- | --- |
| ルート | `schemaVersion`, `menuId`, `mealType`, `cuisineGenre`, `servings`, `totalElapsedMinutes`, `safetyTags` |
| `dishes[]` | `role`, `position`, `name`, `description`, `cookingTimeMinutes`, `ingredients[]`（`name`, `quantityText`, `unit`, `storeSection`）, `steps[]`（`position`, `instruction`） |
| `timeline[]` | `position`, `startMinute`, `durationMinutes`, `instruction` |
| `adaptations[]` | テキスト中心（`portionText`, cutting/heating/seasoning, `servingCheck`, `safetyActions[].instruction`, `anonymousMemberRef` 等） |

**preview から除外（第1版・固定）**

- 生 jsonb / 未投影キー
- `pantryUsage`（家庭保存食の紐づけ）
- `labelConfirmations`（冗長。主対象は dishes / timeline / adaptations）
- dish / ingredient / step / adaptation / timeline の **UUID id フィールド**（UI は name / instruction / position 中心。ペイロードを薄くする）

パースは **厳格すぎて常に null** にならないよう、admin 専用 preview schema で「表示に必要な形」を閉じる。本編 `validatedMenuSchema` の superRefine 全項目を admin に持ち込まない。必須は object 構造・配列・主要文字列フィールドの存在と長さ上限。

---

## 8. sql-guard と秘匿

| ルール | 内容 |
| --- | --- |
| 許可ファイル | `admin/server/src/queries/sharedRecipes.ts` **のみ** `menu_payload` 文字列を SQL に含めてよい（一覧 title 引数 + 詳細 SELECT） |
| 他 query ファイル | 現行どおり `/menu_payload/i` 禁止を維持 |
| 禁止パターン改訂 | グローバル一律禁止を「`sharedRecipes.ts` 以外で禁止」に変更。加えて **レスポンス DTO / mapper テスト**で raw `menuPayload` キーが無いことを保証 |
| DTO テスト | list/detail/preview schemas に `menuPayload` および生 jsonb ルートキーが無いこと |
| 既存禁止 | `identity_key`, `request_hmac*`, `stripe_*`, `auth.users` は維持 |

---

## 9. UI

### 9.1 ナビ・ルート

- Layout: `{ to: "/shared-recipes", label: "共有レシピ" }`（「共有ジョブ」の近傍）
- `app.tsx`: `<Route path="shared-recipes" element={<SharedRecipesPage />} />`

### 9.2 一覧

- 見出し: 「共有レシピ」
- 注意: 「共有プールの匿名化済み本文です。外部共有・スクショ・チャット貼付をしないでください。」
- サマリ: 範囲内 active / disabled 件数
- フィルタ: 日付（共通 `DateRangeFilter`）、status、meal_type
- テーブル列: `created_at`, `status`, `meal_type`, `title`, `elapsed`, allergens 要約, age_bands 要約, contributor (`UuidText`), `id` (`UuidText`)
- 行選択で詳細パネルを開く（feedback と同型の in-page detail）

### 9.3 詳細パネル

- メタ一覧（status, meal_type, elapsed, allergens, age_bands, created_at, id, contributor, source_menu_id）
- 構造化プレビュー:
  - ヘッダ（ジャンル・人数・合計時間・safetyTags）
  - 料理カード（材料・手順）
  - タイムライン
  - 取り分け / 安全指示
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
| 本番での目視 | 人間が自分の admin 起動で実施。エージェントはユーザー明示指示があるまで本番 URL で admin を起動しない |
| 本番 SELECT | 書込はできないが、構造化後とはいえ本番プール本文を閲覧する。UI 注意と README を再掲 |

`admin/README.md` の画面一覧に「共有レシピ」を追加し、上記注意を 1 段落で書く。

---

## 11. テスト

| 層 | 内容 |
| --- | --- |
| pgTAP (`ops_readonly_role`) | 両表 SELECT 可、INSERT/UPDATE/DELETE 不可。title 関数 EXECUTE 可。他ロールへの表 GRANT が増えていないこと（inventory 方針に合わせる） |
| admin unit | mapper: 正常 payload → preview、壊れた payload → null + `invalid_menu_payload` |
| schemas | list/detail DTO の round-trip。raw `menuPayload` キー無し |
| sql-guard | 許可ポリシー更新後、他 query に `menu_payload` が無いこと |
| route test | 日付必須・enum 不正 400、詳細 404、一覧フィルタが query に渡ること（既存 app.test パターン） |
| 手動（local） | seed または publish 済み行で一覧→詳細の目視 |

本編 e2e には載せない。admin の format / lint / typecheck / test は admin パッケージ境界で実行。

---

## 12. 実装順序（plan 用の骨子）

1. migration（GRANT + index + title 関数 EXECUTE）と pgTAP / access matrix
2. admin `shared/schemas.ts` に list/detail/preview DTO
3. `queries/sharedRecipes.ts` + `map-shared-recipe.ts` + sql-guard 改訂
4. routes 登録 + route/unit tests
5. `SharedRecipesPage` + Layout / app ルート
6. README 更新
7. 親設計ドキュメントへの一文クロスリンク（任意・同一 PR でも可）

本編 `src/` / `netlify/functions/` は触らない。

---

## 13. 受け入れ条件

1. admin ナビから「共有レシピ」を開き、日付範囲内の掲載行が一覧できる。
2. `status` / `mealType` フィルタが効く。
3. 行を選ぶと構造化プレビュー（料理名・材料・手順等）が見える。
4. ネットワークレスポンスと UI のいずれにも生 `menu_payload` オブジェクトが載らない。
5. 壊れた payload でも 500 にせず、preview なしメッセージになる。
6. ops ロールは recipes/origins を SELECT できるが DML はできない（pgTAP）。
7. 書込 UI / 書込 API が存在しない。
8. 検証は local DB で再現可能。本番接続は人間の明示操作に限定できる。

---

## 14. 決定ログ

| 決定 | 内容 |
| --- | --- |
| 主目的 | プール品質の目視確認 |
| 深さ | 構造化プレビュー（生 JSON なし） |
| 操作 | 閲覧のみ |
| フィルタ | 日付 + status + meal_type |
| 配置 | 独立画面（共有ジョブは維持） |
| preview schema | admin パッケージ内（本編 shared 非依存） |
| title | 製品関数 `share_recipe_title_from_payload` を ops から EXECUTE |
| 本番 `.env.admin` | 注意対象。自動検証は local 既定 |
