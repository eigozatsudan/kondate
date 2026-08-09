# 献立「全体の段取り」材料まとめタブ 設計

**日付:** 2026-08-09  
**状態:** 敵対レビュー反映後（改訂）  
**適用面:** `MenuResult` が描画するすべての結果画面  
（`/menus/:menuId` の詳細本文 **および** 生成直後の結果画面。いずれも `MenuSteps` を共有）

## 1. 目的と非目的

### 目的

- `MenuResult` 内の **「全体の段取り」** ブロック（`MenuSteps`）で、タブ切替により次の2つを見られるようにする。
  1. **段取り** — 既存の調理タイムライン（現状どおり）
  2. **材料まとめ** — 献立の全料理を合わせた材料の一覧（調理前の材料チェック用）
- 同名・合算可能な単位の材料は **1行に数量合算** する。
- 数量が合算できない行でも、**同一表記の重複は1行に畳む**。
- 並びは **売り場区分（`storeSection`）順**。

### 適用画面（意図的な共有）

| 面 | 経路 | 本機能 |
| --- | --- | --- |
| 献立詳細 | `/menus/:menuId` → `HouseholdMenuDetailBody` / idea 詳細 → `MenuResult` → `MenuSteps` | **載せる** |
| 生成結果 | 生成完了後の結果 UI（同じ `MenuResult` → `MenuSteps`） | **載せる** |

`MenuSteps` は `src/features/generation/components/menu-result.tsx` から import されている共有部品である。  
**タブ化は `menu-steps.tsx` に置き、両面に同時に出すのが正**とする（調理前チェックは生成直後にも有用。呼び出し側ラップで片方だけ出す設計にはしない）。

### 非目的

- 買い物リストの作成・差分・在庫差し引き（既存の買い物フローはそのまま）
- 材料の編集、完了チェック、買い物 CTA の置き換え
- 料理別タブ（`MenuDishes`）内の1品材料表示の削除・統合
- サーバー API / DB / RLS / 契約スキーマの変更
- 別名辞書（aliases）やパントリー状態の参照（本機能はマップ空で正規化のみ）
- 「どの料理で使うか」の出典併記（合算のみ。出典は料理タブ側で確認）

## 2. 背景と現状

| 要素 | 現状 |
| --- | --- |
| 段取り | `src/features/menu-detail/menu-steps.tsx` が `timeline` + `dishes` で cook timeline を表示 |
| 呼び出し | `MenuResult`（生成結果・`/menus/:id` 詳細の両方）が `<MenuSteps />` を共有 |
| 材料 | `MenuDishes` で **選択中の1品** のみ材料リスト |
| 合算（買い物） | `shared/shopping/aggregate.ts` の `buildShoppingDraft` が正規化・合算・**在庫差し引き**・**reviewedShoppingAliases** |

調理前チェックでは「必要量の全体」が欲しい。買い物下書きは在庫で行が消えるため流用しない。

## 3. ユーザー向け仕様

### 3.1 タブ

| タブラベル | 内容 | 初期選択 |
| --- | --- | --- |
| 段取り | 既存の `cook-timeline` | **はい** |
| 材料まとめ | 全料理材料の合算リスト | いいえ |

- 見出し **「全体の段取り」**（`id="timeline-heading"`）を残す。
- **DOM 構造のロック（E2E 互換）:**
  - `h2#timeline-heading` の **直接の親** は従来どおり **`.cook-timeline-panel`** とする。
  - タブ list は `.cook-timeline-panel` **内** で、見出しの直後（または見出しと同パネル内の兄弟）に置く。
  - 段取り tabpanel 内の `ol.cook-timeline` は現状と同型を維持する。
  - 材料まとめ panel は同じ `.cook-timeline-panel` 内の別 tabpanel に置く（見出しの親を差し替えない）。
- household / idea の両方で同じ（材料は `ValidatedMenu.dishes` 由来でモード差なし）。

### 3.2 材料まとめの表示

- 売り場区分ごとに見出し（日本語）+ 材料行のリスト。
- 各行: 材料名 + 数量テキスト。既存の `.menu-result-ingredient-*` 意味クラスを再利用する。
- 空の区分は出さない。
- 合算グループ内のいずれかが `labelConfirmationRequired === true` なら、行に **「ラベル確認」バッジ**（表示のみ。確認 mutation はしない）。
- **空状態:** `ValidatedMenu` 契約上 dishes/ingredients はいずれも `min(1)` のため到達しない。空 UI 分岐は書かない（防御的ガードも不要）。

### 3.3 区分ラベル（文言）

| `storeSection` | ラベル |
| --- | --- |
| produce | 野菜 |
| meat_fish | 肉・魚 |
| dairy_eggs | 乳製品・卵 |
| dry_goods | 乾物 |
| seasonings | 調味料 |
| other | その他 |

実装配置は §5.3。

## 4. 合算アルゴリズム

### 4.1 入力

- `dishes: ValidatedMenu["dishes"]` のみ。
- 別名マップは **空**（`normalizeIngredientName` の NFKC + 空白除去のみ）。  
  買い物の `reviewedShoppingAliases` は渡さない（§4.5）。

### 4.2 グループ化（合算可能）

**合算可能**の条件（意図を明示）:

- `quantityValue !== null` **かつ** `unit !== null`（空文字 unit は契約上来ないが、`normalizeUnit` 後も null なら合算不可）。
- **単位は synonym 表に無くても合算する。**  
  `normalizeUnit` は未登録単位をそのまま返す（例: 「本」「片」「束」）。  
  したがって「本 + 本 = 2本」は成立する。合算キーの単位部分は **`normalizeUnit(unit)` 後の文字列一致**（synonym 解決後の identity）。
- 合算キー = `(normalizedName, normalizedUnit)`。

**読み違え防止:**  
`normalizeUnit(unit) !== null` を「登録済み synonym のみ合算」と解釈してはならない。未登録単位も文字列一致で合算する。

### 4.3 合算不可行の扱いと重複畳み

`quantityValue === null` または `unit === null`（正規化後 null）の行:

1. **数量は足さない**（`quantityText` をそのまま表示）。
2. ただしキー  
   `(normalizedName, normalizedUnit /* null 可 */, quantityText)`  
   が **完全一致** する行は **1行に畳む**（調味料の「塩 少々」×3 品 → 1行）。
3. 畳んだ行の `labelConfirmationRequired` は OR。
4. `displayName` / `storeSection` はグループ内で最初に出現した材料の値。
5. `quantityText` が異なる非数値行（例: 「塩 少々」と「塩 適量」）は **別行のまま**。

### 4.4 合算行のフィールド

| フィールド | 規則 |
| --- | --- |
| `displayName` | グループ内で **最初に出現** した材料名 |
| `quantityValue` | 合算可能行のみ。合計後に `roundQuantityValue`。非合算行は `null` |
| `quantityText` | 合算可能: `` `${formatQuantityValue(sum)}${normalizedUnit}` ``。非合算: 元の `quantityText` |
| `unit` | 合算可能: `normalizeUnit` 後。非合算: 正規化後（null 可） |
| `storeSection` | グループ内 **最初** の材料の区分 |
| `labelConfirmationRequired` | いずれか1件でも true なら true |

#### 数量テキスト整形（既存 `MenuDishes` との差）

- 本機能の合算行は **`formatQuantityValue`** を使う（合算の浮動小数ノイズを milli グリッドで潰す。買い物と同型）。
- 既存 `MenuDishes` の `amount()` は  
  `value === null ? text : \`${String(value)}${unit ?? ""}\``  
  で、`formatQuantityValue` を通さない。
- **同じ画面に2系統が並ぶのは意図的。** 1品表示は従来どおり。合算表示だけ誤差除去を優先する。1品側の `amount()` 統一はこのタスクの非目的。

正規化は既存 `@shared/shopping/normalize` を再利用する。

### 4.5 並び順

1. `storeSections` 定義順（produce → meat_fish → dairy_eggs → dry_goods → seasonings → other）。
2. 同一区分内: 献立上の **出現順**（料理 `position` → 材料 `position`）。
   - グループの代表位置 = グループ内で最初に現れた材料の位置。
   - 合算可能行・非合算（畳み後）行を同じ出現順ルールで並べる。

### 4.6 意図的に買い物と揃えない点

| 項目 | 本機能 | 買い物 `buildShoppingDraft` |
| --- | --- | --- |
| 在庫差し引き | しない | する |
| 足りた行の削除 | しない | する |
| ラベル snapshot 結合 | しない（bool フラグのみ） | する |
| **別名（aliases）** | **空マップ**（表記ゆれは NFKC のみ） | `reviewedShoppingAliases` で「玉ねぎ/たまねぎ」等を1行化 |
| 目的 | 調理前の必要量チェック | 買い出しリスト |

そのため買い物では1行・材料まとめでは2行、または数量が在庫差で食い違う、という差は **accepted**。UI コメントで目的差を一言書く。

## 5. コンポーネントと所有権

### 5.1 分割

| 単位 | パス（案） | 役割 |
| --- | --- | --- |
| 合算純関数 | `src/features/menu-detail/build-menu-ingredients-summary.ts` | dishes → 合算行配列 |
| 材料リスト表示 | `src/features/menu-detail/menu-ingredients-summary.tsx` | 区分見出し + 行の描画 |
| タブコンテナ | `src/features/menu-detail/menu-steps.tsx` | タブ状態 + 段取り / 材料 panel |

- `MenuResult` は現状どおり `<MenuSteps timeline={...} dishes={...} />` のみ（**props 追加不要**）。両適用面に自動で載る。
- **タブ選択 state は `MenuSteps` 内のローカル state とする（意図的）。**  
  `MenuDishes` は選択を親 `MenuResult` に持ち上げているが、本タブは他コンポーネントと共有しないためローカルで足りる。流儀の非対称は許容。

### 5.2 所有権境界

- **browser only:** `src/features/menu-detail/*`、区分ラベルの `src/shared/` 配置（§5.3）
- **再利用可:** `@shared/shopping/normalize`（dual-surface 済み）
- **触らない:** `shared/contracts/*`、`shared/shopping/aggregate.ts`、`netlify/functions/*`、`MenuDishes` の1品材料ロジック、買い物 create/reconcile の業務ロジック
- **本タスクで直す:** E2E のスコープなし `getByRole("tab" | "tabpanel")`（§7）

### 5.3 区分ラベルの配置（依存方向）

**決定:** `categoryLabel` を **feature 間 import（menu-detail → shopping）にはしない。**

| 手順 | 内容 |
| --- | --- |
| 1 | `src/shared/ui/` または `src/shared/lib/` 相当の薄いモジュールへ `categoryLabel` を移す（例: `src/shared/ui/store-section-label.ts`）。`StoreSection` 型は既存どおり `@shared/contracts/shopping`（または generation の storeSections）から取る |
| 2 | `src/features/shopping/category-label.ts` は **re-export のみ** に変更し、既存 shopping import を壊さない |
| 3 | menu-detail は **移動後の `src/shared/...` を直接 import** |

二重定義を避けつつ、menu-detail → shopping の新規 feature 依存を作らない。

### 5.4 スタイリング制約（lint）

- `src/features/**/*.tsx` は **生 Tailwind ユーティリティ禁止**（eslint）。`menu-detail` は ignores 対象外。
- `menu-ingredients-summary.tsx` / 拡張後の `menu-steps.tsx` は:
  - 配色・余白・レイアウト: `Surface` / `Stack` / `Inset` 等の UI プリミティブ
  - 材料リスト・タブ: 既存 **意味クラス**（`.menu-result-tabs`、`.menu-result-ingredient-*`、`.cook-timeline-*`）を `styles.css` 経由で流用
- 新規 utility class をコンポーネントに直書きしない。

## 6. アクセシビリティとモバイル

- `role="tablist"` / `role="tab"` / `role="tabpanel"` を使う（セグメント切替への逃げはしない）。
- **tablist の `aria-label` は固定文言: `献立の段取りと材料`**（E2E スコープ用の安定セレクタ。変更しない）。
- 料理タブ list は既存どおり `aria-label="料理"`。E2E は必ず **tablist 名でスコープ**する。
- `aria-selected`、`aria-controls`、`aria-labelledby`
- roving tabindex（選択タブのみ `tabIndex=0`）。←→ / Home / End は `MenuDishes` と同型
- タッチターゲット 44×44 CSS px、320 CSS px で横スクロールなし
- 既存 `.menu-result-tabs` パターンを流用（§5.4）

## 7. テスト計画

### 純関数

- 同名・同単位の数量合算
- 「g」と「グラム」の合算（unit synonym）
- **未登録単位「本」+「本」→ 合算**（synonym 表外でも文字列一致）
- 同名でも単位違い → 別行
- `quantityValue: null` → 数量は足さない
- **同一 `(normalizedName, unit, quantityText)` の非合算行は1行に畳む**（例: 塩 少々 ×3）
- 非合算で `quantityText` が違う → 別行（少々 vs 適量）
- 区分順と出現順
- `labelConfirmationRequired` の OR

### コンポーネント（Vitest）

- 初期表示は「段取り」タブ（既存タイムライン見出し・`ol.cook-timeline`・**見出しの親が `.cook-timeline-panel`**）
- 「材料まとめ」切替で合算行・区分見出しが見える
- tablist `aria-label="献立の段取りと材料"`
- キーボードでタブ移動できる

### E2E（本タスク必須）

タブ追加により **既存 E2E が strict 失敗または検知力喪失する**。次を **本タスクのスコープに含める**:

| ファイル | 修正内容 |
| --- | --- |
| `e2e/specs/generation-recovery-results.spec.ts` | スコープなし `getByRole("tab")` / `getByRole("tabpanel")` を **`getByRole("tablist", { name: "料理" })` 配下**に限定。`expectContainedHorizontally` の tabpanel も料理 tablist の panel を対象にする。見出し `全体の段取り` の親探索が `.cook-timeline-panel` を掴めることを維持（実装が §3.1 の DOM ロックを守る） |
| `e2e/specs/full-journey.spec.ts` | `getByRole("tab").first()` を料理 tablist スコープ付きに修正 |

加えて可能なら、材料まとめタブの表示・320px 横はみ出しを既存 `expectContainedHorizontally` 系に1本足す（§6 の検証）。

### 回帰

- 既存 `menu-steps` / `menu-result` テストをタブ導入後も通す
- 料理別材料・買い物 CTA は変更しない

### 提出前検証（実装時）

次を **必須**とする（いずれもプロジェクト定番経路）:

1. `docker compose run --rm --no-deps app npm run format:check`
2. `docker compose run --rm --no-deps app npm run lint`
3. `docker compose run --rm --no-deps app npm run typecheck`
4. `docker compose run --rm --no-deps app npx vitest run`（焦点: menu-detail / 関連 + category-label 移動の shopping テスト）
5. **`./scripts/run-e2e.sh`**（少なくとも generation-recovery-results / full-journey が含むスイート。失敗時は修正して再実行）

`db:test` は本機能では契約・DB 不変のため必須としない。

## 8. リスクと緩和

| リスク | 緩和 |
| --- | --- |
| 生成結果と `/menus` の両面にタブが出る | **意図どおり**（§1）。片面だけにしない |
| E2E strict 失敗 / 誤クリック | tablist `aria-label` 固定 + E2E を tablist スコープに直す（§7 必須） |
| 見出し親 DOM 変化で E2E が別要素を掴む | `h2` の親を `.cook-timeline-panel` にロック（§3.1） |
| 買い物と行数・数量がズレる | 在庫非控除 + **aliases 空**を §4.6 で明記。コメントで目的差 |
| 調味料の重複行 | 非合算行の完全一致畳み（§4.3） |
| menu-detail → shopping 依存 | categoryLabel を `src/shared` へ移し re-export（§5.3） |
| 生 Tailwind lint | UI プリミティブ + 意味クラスのみ（§5.4） |
| 合算で料理別が分からなくなる | 要件どおり。1品詳細は `MenuDishes` |

## 9. 成功基準

1. `MenuResult` を使う **生成結果画面と `/menus/:menuId` の両方**で、「段取り」「材料まとめ」を切り替えられる。
2. 材料まとめは全料理の材料を、合算・重複畳み規則どおり・売り場区分順で表示する。
3. 初期表示は従来どおり段取りタイムラインが見え、`h2#timeline-heading` の親が `.cook-timeline-panel` である。
4. 料理タブ用 E2E が tablist スコープ修正後も緑。材料まとめタブ追加による strict 失敗・誤検知がない。
5. 320px 幅で新 tablist / 材料 panel が横スクロールを起こさない（既存 E2E ヘルパまたは同等）。
6. API・買い物業務ロジック・1品材料 UI に意図しない回帰がない。
7. 純関数・コンポーネントの焦点テストと必須検証コマンド（§7）が緑。

## 10. 改訂履歴

| 日付 | 内容 |
| --- | --- |
| 2026-08-09 | 初版（brainstorming 承認） |
| 2026-08-09 | 敵対レビュー反映: 適用面共有の明記、E2E 必須化、非合算重複畳み、aliases 差分、単位合算意図、categoryLabel の shared 移設、lint/空状態/数量整形/ローカル state/a11y 検証 |
