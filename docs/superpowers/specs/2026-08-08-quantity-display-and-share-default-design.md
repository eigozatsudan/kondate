# 分量表記の読みやすさ + 共有同意既定オン 設計

**日付:** 2026-08-08  
**ブランチ / worktree:** `fix/quantity-display-and-share-default`  
**状態:** 改訂設計（敵対レビュー必須パッチ織り込み）承認後

## 1. 目的と非目的

### 目的

1. 初回 `/privacy` の匿名共有チェックを **既定オン（pre-checked）** にし、協力オプトインを増やしつつ任意性は維持する。
2. 生成材料の分かりにくい計量（例: オリーブ油 15大さじ、牛乳 30大さじ、こしょう 1少々）を **保存データ時点で** 読みやすくする。

### 非目的

- 既存 DB 献立・買い物行の一括マイグレーション
- 手順文（`steps.instruction`）の機械的な単位置換
- 材料カテゴリ（液体 / 粘体）分岐
- `0.5個` → `1/2個` の分数化
- カップ換算、英語単位（tbsp 等）の合法化
- 共有同意の必須化、`shareConsentVersion` バンプ
- 共有 RPC 失敗時の UX 強化（既存 best-effort 据え置き）

## 2. 旧仕様の supersede

| 旧（`2026-08-01-community-emergency-share-design`） | 新（本設計が正） |
| --- | --- |
| 任意・**既定オフ** | 任意・**既定オン（pre-checked）** |
| 「推奨トーンや既定オンにしない」 | **既定オン条項のみ撤回**。推奨トーン（「ぜひ」等）は依然禁止 |

- 旧 spec 本文は考古学用に残し、**本ファイルが同意既定に関する正**とする。
- README・現行コメント・テストを新仕様に合わせる。

## 3. 共有同意既定オン

### 3.1 同意の解釈

- チェックは pre-checked。同意のプロダクト上の行為は **「確認して進む」押下時点**。
- そのとき共有チェックが on → `upsert_my_share_consent(version, true)`。
- off → 共有 RPC を呼ばない（DB 行なし = 未同意。現行どおり）。
- primary 有効条件は **AI 説明チェックのみ**（共有はゲートにしない）。
- 設定トグル・revoke・既提供残存の意味は変更しない。
- `shareConsentVersion` はバンプしない（同意内容の版は同じ。UI 既定のみ変更）。

### 3.2 UI / コピー

| 項目 | 内容 |
| --- | --- |
| 初期 state | `shareChecked = true` |
| チェックラベル | 現行 `匿名で緊急候補に役立ててよい` を維持 |
| 必須追加 | 「**最初からチェックが入っています。不要なら外してください。**」 |
| 推奨トーン | 「ぜひ」「おすすめ」等は禁止 |
| 設定画面 | 保存済み状態の表示のみ。既存ユーザー DB は触らない |

### 3.3 失敗時

- 共有 upsert 失敗は無言 best-effort（AP12）。privacy 同意は保存・遷移する。
- 既定オンにより「同意したつもり」が増えるリスクは accepted（本タスクで共有失敗バナーは足さない）。

## 4. 分量正規化

### 4.1 方式

- **D:** 生成プロンプト誘導 + materialize 時のサーバー正規化。
- 最終権威は **サーバー pure 正規化**。プロンプトは予防のみ。
- 表示層は換算しない（保存 triple を正）。

### 4.2 配置

| 要素 | 置き場 |
| --- | --- |
| pure | `shared/shopping/quantity-display.ts` + test |
| unit synonym | `shared/shopping/normalize.ts` の `UNIT_SYNONYMS` 拡張 |
| 呼び出し | `generation-materializer.ts`、`regeneration-context.ts` の dish materialize |
| 表示 | `menu-result` の `amount()` は変更しない（二重ロジック禁止） |

### 4.3 `normalizeUnit` 拡張

| 入力例 | canonical |
| --- | --- |
| 大さじ / 大匙 | `大さじ` |
| 小さじ / 小匙 | `小さじ` |

- tbsp / tsp は **載せない**（英語単位を合法化しない）。

### 4.4 換算定数と閾値

| 単位 | 係数 | 閾値（`roundQuantityValue` 後） |
| --- | --- | --- |
| 大さじ | ×15 → `ml` | `> 3` で換算 |
| 小さじ | ×5 → `ml` | `> 3` で換算 |

- 3 は残す。3.001 は換算。非有限・`<= 0` は換算しない。

### 4.5 Triple 同時更新

正規化が走ったら必ず:

- スプーン→ml: `quantityValue` / `unit="ml"` / `quantityText=\`${formatQuantityValue(ml)}ml\``
- 定性: `quantityValue=null` / `unit=null` / `quantityText` = 固定語のみ

### 4.6 権威順位（1 ingredient）

**Step A — 定性（最優先）**

許可セット: `少々` / `適量` / `ひとつまみ` / `適宜`

検知:

1. `normalizeUnit(unit)` が定性セット、または
2. `quantityText`（NFKC・trim 後）全体が「任意の数 + 定性語のみ」（部分一致で `少し多め` 等は潰さない）

→ 固定語へ。value/unit null。return。

**衝突:** text が定性固定語のみ（数なし）→ 定性優先。数値付きスプーン or value/unit がスプーン → 数値系（B）。text の矛盾する「適量」等は捨てて value+unit から再生成。

**Step B — スプーン → ml**

1. **P1:** unit が 大さじ/小さじ のとき  
   - `quantityValue` が有限正 → その値で丸め後 `> 3` なら ml 化  
   - value が null / 非有限 / `≤0` → **同種スプーンの text をパース**して補完し、同様に ml 化（M2-1: `value:null, unit:大さじ, text:15大さじ`）  
   - text のスプーン種別が unit と食い違う（例: unit 大さじ + text `10小さじ`）→ 無変換  
2. **P2:** unit が null（または normalize 後 null）のとき、text 全体をパース（`N大さじ` / `大さじN` / 小さじ同型、大匙・小匙含む）。  
   - パース成功かつ丸め後 `> 3` なら ml 化  
   - 数値の優先: `quantityValue` が有限かつ `> 0` ならそれを使い、さもなくば text から得た数を使う  
   - （`value:15, unit:null, text:"15大さじ"` のような AI 欠けを拾う。unit が `g` 等の非スプーンのときは text を権威にしない）  
3. それ以外 → 無変換  

**意図的に無変換のまま残す例:** `1/2大さじ`、`大さじ約15`、unit=`g` と矛盾 text、unit と text のスプーン種別不一致、英語 `tbsp`（非目的・残渣）。

### 4.7 materialize 適用順序

```
1. 既存 pantry bind（G5/G17/G4）
2. pantryRef !== null → 正規化スキップ
   pantryRef === null → normalizeIngredientQuantity(...)
3. 以降は正規化後の値のみを正本
```

- full_menu: `materializeAiGeneratedMenu`
- dish 再生成: `materializeDishRegenerationCandidate` の `mapLocalDish` 内（pantry bind 後）

### 4.8 プロンプト

- 買い足しで大さじ/小さじがおおむね 4 以上 → ml または g
- 少々・適量・ひとつまみ・適宜に数字を付けない
- pantry の name/unit 換算禁止は **入力 pantry に限る** と書き分け
- 材料と手順の言い回しを大きく食い違わせない（best-effort）
- 英語単位禁止は現状維持

### 4.9 表示・買い物・共有

- UI: 保存 triple 表示
- 買い物: 正規化後 unit でキー
- 共有 lock: 正規化後 menu を正本
- 既存献立: 再生成まで旧表記

## 5. Accepted risks

| ID | 内容 |
| --- | --- |
| R1 | 粘体（味噌等）が ml になり得る |
| R2 | 手順に旧単位が残る |
| R3 | 既存メニューは旧表記 |
| R4 | 旧大さじ行と新 ml 行が買い物で別キー |
| R5 | 共有 upsert 失敗が無言 |
| R6 | pre-checked は弱い同意になりうる（コピー補強で緩和） |
| R7 | 分数・曖昧 text・非スプーン unit 付き矛盾 triple は無変換 |
| R8 | 一品再生成時、retained の非 pantry も mapLocalDish 経由で正規化され得る（派生メニュー側の改善。ソース行の DB は不変） |

## 6. 成功条件

- 新規生成で「30大さじ」「15大さじ」級が ml で保存・表示される
- 「1少々」が「少々」になる
- pantry 連動分量は単位換算されない
- 初回 privacy で共有が既定 checked、外せる、任意のまま
- 旧「既定オフ」の README / テストが新仕様と矛盾しない
