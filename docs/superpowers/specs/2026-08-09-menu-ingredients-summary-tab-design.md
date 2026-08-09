# 献立「全体の段取り」材料まとめタブ 設計

**日付:** 2026-08-09  
**状態:** 設計承認済み（brainstorming 完了）  
**画面:** `/menus/:menuId`（`MenuResult` → `MenuSteps`）

## 1. 目的と非目的

### 目的

- `/menus/:menuId` の **「全体の段取り」** ブロック内で、タブ切替により次の2つを見られるようにする。
  1. **段取り** — 既存の調理タイムライン（現状どおり）
  2. **材料まとめ** — 献立の全料理を合わせた材料の一覧（調理前の材料チェック用）
- 同名・合算可能な単位の材料は **1行に数量合算** する。
- 並びは **売り場区分（`storeSection`）順**。

### 非目的

- 買い物リストの作成・差分・在庫差し引き（既存の買い物フローはそのまま）
- 材料の編集、完了チェック、買い物 CTA の置き換え
- 料理別タブ（`MenuDishes`）内の1品材料表示の削除・統合
- サーバー API / DB / RLS / 契約スキーマの変更
- 別名辞書（aliases）やパントリー状態の参照
- 「どの料理で使うか」の出典併記（合算のみ。出典は料理タブ側で確認）

## 2. 背景と現状

| 要素 | 現状 |
| --- | --- |
| 段取り | `src/features/menu-detail/menu-steps.tsx` が `timeline` + `dishes` で cook timeline を表示 |
| 材料 | `MenuDishes` で **選択中の1品** のみ材料リスト |
| 合算（買い物） | `shared/shopping/aggregate.ts` の `buildShoppingDraft` が正規化・合算・**在庫差し引き** |

調理前チェックでは「必要量の全体」が欲しい。買い物下書きは在庫で行が消えるため流用しない。

## 3. ユーザー向け仕様

### 3.1 タブ

| タブラベル | 内容 | 初期選択 |
| --- | --- | --- |
| 段取り | 既存の `cook-timeline` | **はい** |
| 材料まとめ | 全料理材料の合算リスト | いいえ |

- セクションの存在感は維持する（「全体の段取り」見出し、または同等のセクションラベルを残す）。
- household / idea の両方で同じ（材料は `ValidatedMenu.dishes` 由来でモード差なし）。

### 3.2 材料まとめの表示

- 売り場区分ごとに見出し（日本語）+ 材料行のリスト。
- 各行: 材料名 + 数量テキスト。既存の `.menu-result-ingredient-*` 見た目を再利用する。
- 空の区分は出さない。
- 合算グループ内のいずれかが `labelConfirmationRequired === true` なら、行に **「ラベル確認」バッジ**（表示のみ。確認 mutation はしない）。
- 材料が1件もない場合（異常系）: 「材料はありません」程度の短文。`role="alert"` にはしない。

### 3.3 区分ラベル（文言）

買い物リストと同文言にする。

| `storeSection` | ラベル |
| --- | --- |
| produce | 野菜 |
| meat_fish | 肉・魚 |
| dairy_eggs | 乳製品・卵 |
| dry_goods | 乾物 |
| seasonings | 調味料 |
| other | その他 |

## 4. 合算アルゴリズム

### 4.1 入力

- `dishes: ValidatedMenu["dishes"]` のみ。
- 別名マップは **空**（`normalizeIngredientName` の NFKC + 空白除去のみ）。

### 4.2 グループ化

| 条件 | 扱い |
| --- | --- |
| `quantityValue !== null` かつ `normalizeUnit(unit) !== null` | **合算可能**。キー = `(normalizedName, normalizedUnit)` |
| それ以外 | **合算しない**。元の `quantityText` をそのまま1行として確定 |

### 4.3 合算行のフィールド

| フィールド | 規則 |
| --- | --- |
| `displayName` | グループ内で **最初に出現** した材料名 |
| `quantityValue` | 合計後に `roundQuantityValue` |
| `quantityText` | `` `${formatQuantityValue(sum)}${unit}` ``（買い物と同型） |
| `unit` | `normalizeUnit` 後の単位 |
| `storeSection` | グループ内 **最初** の材料の区分 |
| `labelConfirmationRequired` | いずれか1件でも true なら true |

正規化は既存 `@shared/shopping/normalize` を再利用する（`normalizeIngredientName` / `normalizeUnit` / `roundQuantityValue` / `formatQuantityValue`）。

### 4.4 並び順

1. `storeSections` 定義順（produce → meat_fish → dairy_eggs → dry_goods → seasonings → other）。
2. 同一区分内: 献立上の **出現順**（料理 `position` → 材料 `position`）。
   - 合算グループの代表位置 = グループ内で最初に現れた材料の位置。
   - 合算不可行も同じ出現順で同列に並べる（「合算の後ろに全部」ではない）。

### 4.5 意図的に買い物と揃えない点

| 項目 | 本機能 | 買い物 `buildShoppingDraft` |
| --- | --- | --- |
| 在庫差し引き | しない | する |
| 足りた行の削除 | しない | する |
| ラベル snapshot 結合 | しない（bool フラグのみ） | する |
| 目的 | 調理前の必要量チェック | 買い出しリスト |

## 5. コンポーネントと所有権

### 5.1 分割

| 単位 | パス（案） | 役割 |
| --- | --- | --- |
| 合算純関数 | `src/features/menu-detail/build-menu-ingredients-summary.ts` | dishes → 合算行配列 |
| 材料リスト表示 | `src/features/menu-detail/menu-ingredients-summary.tsx` | 区分見出し + 行の描画 |
| タブコンテナ | `src/features/menu-detail/menu-steps.tsx` | タブ状態 + 段取り / 材料 panel |

`MenuResult` は現状どおり `<MenuSteps timeline={...} dishes={...} />` を渡すだけで足りる（props 追加不要が望ましい）。

### 5.2 所有権境界

- **browser only:** `src/features/menu-detail/*`
- **再利用可:** `@shared/shopping/normalize`（dual-surface 済み）
- **触らない:** `shared/contracts/*`、`shared/shopping/aggregate.ts`、`netlify/functions/*`、`MenuDishes` の1品材料、買い物 create/reconcile

### 5.3 区分ラベルの実装方針

- **正:** `src/features/shopping/category-label.ts` の `categoryLabel` を import して使う（二重定義しない）。
- 今回は `shared/` へのラベル共通化リファクタはしない（YAGNI）。

## 6. アクセシビリティとモバイル

- `role="tablist"` / `role="tab"` / `role="tabpanel"`
- `aria-selected`、`aria-controls`、`aria-labelledby`
- tablist の `aria-label` 例: 「献立の段取りと材料」
- roving tabindex（選択タブのみ `tabIndex=0`）。←→ / Home / End は `MenuDishes` と同型
- タッチターゲット 44×44 CSS px、320 CSS px で横スクロールなし
- 既存 `.menu-result-tabs` パターンを流用

## 7. テスト計画

### 純関数

- 同名・同単位の数量合算
- 「g」と「グラム」の合算（unit synonym）
- 同名でも単位違い → 別行
- `quantityValue: null` → 合算せず `quantityText` 維持
- 区分順と出現順
- `labelConfirmationRequired` の OR

### コンポーネント

- 初期表示は「段取り」タブ（既存タイムライン見出し・リスト構造が残る）
- 「材料まとめ」切替で合算行・区分見出しが見える
- キーボードでタブ移動できる

### 回帰

- 既存 `menu-steps` / `menu-result` テストをタブ導入後も通す
- 料理別材料・買い物 CTA は変更しない

### 提出前検証（実装時）

Docker `app` 経由の `format:check` / lint / typecheck / 焦点 Vitest。E2E・db:test は本機能だけでは必須としない（契約・API 不変のため）。

## 8. リスクと緩和

| リスク | 緩和 |
| --- | --- |
| 買い物合算と数量がズレて見える | 目的差をコメントで明記。在庫非控除が正 |
| タブ追加で既存セレクタが壊れる | 「全体の段取り」系の見出し/構造を残す。role ベースクエリを維持 |
| 合算で料理別が分からなくなる | 要件どおり。1品詳細は `MenuDishes` を使う |
| 区分ラベル二重定義 | 文言表を1箇所に寄せ、コメントで買い物と揃える旨を書く |

## 9. 成功基準

1. `/menus/:menuId` の全体段取りブロックで「段取り」「材料まとめ」を切り替えられる。
2. 材料まとめは全料理の材料を、合算規則どおり・売り場区分順で表示する。
3. 初期表示は従来どおり段取りタイムラインが見える。
4. API・買い物・1品材料 UI に回帰がない。
5. 純関数・コンポーネントの焦点テストが緑。
