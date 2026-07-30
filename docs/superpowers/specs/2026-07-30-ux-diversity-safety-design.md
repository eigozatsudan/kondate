# 献立 UX・多様性ヒント・選択メンバー安全 設計

| 項目 | 値 |
|------|-----|
| 文書 | `docs/superpowers/specs/2026-07-30-ux-diversity-safety-design.md` |
| 日付 | 2026-07-30 |
| 状態 | **Approved for planning**（self-review + 敵対的/二次レビュー 0 Critical / 0 Important / 0 Minor。実装計画待ち） |
| 関連 | MVP `2026-07-11-kondate-mvp-design.md`、ウィザード `2026-07-22-guided-planner-optional-household-design.md`（§5.2 対象ステップの並び・表示を本設計 §5 が supersede）、再生成 Plan 4（`excludedDishSignatures` / `duplicate_output`） |
| ブランチ | `feat/ux-diversity-safety` |
| 後方互換 | **不要**（本番未デプロイ前提。clean 変更可） |

---

## 1. 背景

利用者が次の痛みを報告・要望している。

1. **同じような料理ばかり**生成される（新規生成に「最近の料理を避ける」仕組みが無い）。
2. **入力漏れ・選択漏れの UX が弱い**。未完了時に主ボタンが `disabled` だけだと、押しても何も起きず理由が分からない。
3. **「4. 作る相手」**で「家族に合わせて作る」を選んでも、家族チェックが必須だと分かりにくい。希望する並びは「人数だけ…」を上、「家族に合わせて…」とその下の安全条件ボックス。
4. **アレルギーなしの家族だけを対象にしているのに**「必須の安全条件を満たす献立を作成できません。」（`mandatory_safety_conflict`）が出る。未選択の登録済み家族にはアレルギーがある — **未選択まで効いているように見える／実際に効いている**疑い。

再生成には派生グループと直近履歴の hard 除外があるが、**新規 `new_menu` にはソフトな多様性ヒントが無い**。  
確認画面の安全条件は選択メンバーのみ表示済みだが、audience 画面の「現在の家族・安全条件」は **eligible 全員**を出しており、誤認しやすい。

サーバーの `loadGenerationContext` は既に `targetMemberIds` のみを読む実装である可能性が高い。本設計は **UI 誤認の解消**と **経路監査＋回帰テスト**で「未選択が効く」疑いを閉じ、残る正当 conflict をアレルギーと混同しない説明にする。

---

## 2. 優先順位（上ほど強い）

1. **生成を止めない**（正当な quota / 本物の安全 conflict / 入力不備以外で失敗を増やさない）
2. **選択した家族だけ**が安全条件の正本
3. **未入力・未選択が分かる UX**（ウィザード質問 step の「次へ」＋ 家族追加・編集）
4. **audience の分かりやすさ**（並び・チェック必須）
5. **同じような料理ばかりにならない**（できれば・ソフト）

**多様性は生成成功より弱い。** 履歴ヒントは「できれば避ける」であり、生成不能・アプリ側の失敗クラス増加・成功拒否の原因にしてはならない。

---

## 3. 人間と合意済みのロック

| # | 決定 |
|---|------|
| L1 | 多様性は **ソフト誘導のみ**。近さによる hard 拒否（新規への `duplicate_output` 移植）はしない |
| L2 | 多様性のために **追加 AI 送信・repair ループをしない** |
| L3 | 直近は owner の `public.menus` を `created_at desc` で **最大 10 行**（finalize 成功で永続化された献立。下書き・private AI control は含めない）。平坦化 hints は **最大 24 要素**。件数定数はチューニング可。**Zod 必須や失敗条件にしない** |
| L4 | 履歴 load 失敗・タイムアウト・0 件 → **`recentDishHints: []` のまま生成続行**（fail-open） |
| L5 | アプリ側 preflight / `validateGeneratedMenu` / finalize は **多様性を見ない**。近い案でも成功保存・成功回数消費してよい。多様性専用の失敗コード・拒否を **追加しない** |
| L6 | **validation toast / incomplete「次へ」** の対象: 質問 step（meal〜audience）＋ 家族追加・編集。 確認 CTA の incomplete-toast は対象外。**確認サマリーと generation conflict の補助文（§6.2）は別枠で対象内**。 買い物・課金・履歴全体は対象外 |
| L7 | 対象操作が未完了のとき: 主ボタン **押下可** ＋ **トースト** ＋ **インライン `role="alert"`** ＋ **該当 control へ focus（必須）**。§6.3 の操作マトリクスが正本 |
| L8 | 安全条件の正本は **選択 `targetMemberIds` のみ**（送信前に selectable へフィルタ後）。未選択メンバーは AI / preflight / fingerprint / reserve snapshot / finalize に含めない |
| L9 | audience DOM 順: **人数だけ → 家族に合わせて →（household 時）チェック群 → その下に安全サマリー（選択中のみ）** |
| L10 | 方針は **薄い横断 + 既存パターン拡張**（巨大な design system 新設はしない） |
| L11 | 後方互換マイグレーション・旧 draft 回収は不要 |
| L12 | `loadRecentDishHints` は **硬タイムアウト default 200ms**（定数・チューニング可。 本番で Function budget 内なら 200–800ms へ上げてよい。fail-open 意味は不変）。超過は `[]`。ユーザーエラーにも generation fail にもしない |
| L13 | 多様性は定数 `DIVERSITY_HINTS_ENABLED = true`（`netlify/functions/_shared` 内、default **on**）で無効化可。 flag off 時は **`loadRecentDishHints` を呼ばない**・system 多様性段落を省略・payload は `recentDishHints: []`。 hard 拒否はしない。conflict 率が明らかに増えたら off または段落弱体化 |
| L14 | `recentDishHints` は **prompt 専用**。fingerprint / reserve・HMAC identity / quota key に **含めない** |

---

## 4. Goals & Non-Goals

### Goals

- 新規生成の prompt に、最近の料理名ヒントを **任意・fail-open** で載せ、近い案を優先して避けるよう指示する。
- ウィザード**質問 step**で未選択のまま「次へ」したとき、理由が日本語で分かる。
- 家族追加・編集で必須漏れ保存時に、フィールドエラーに加えてトーストで気づける。
- audience で idea / household の優先表示とチェック必須が分かる。
- 未選択家族のアレルギーが原因（またはそう見える状態）で安全エラーになる経路を閉じる。
- 選択のみ・アレルギーなしでも年齢帯等で conflict し得ることを、**未選択家族が原因とは読めない**表示にする。

### Non-Goals

- 多様性 hard 拒否、再生成パイプラインの再設計
- アプリ全体のトースト網羅。**本計画で `useAppToast().show` を validation 用途に呼んでよいのは planner 質問 step と家族追加・編集のみ**。他 surface は新設計なしに繋がない
- idea を「安全確認済み」に見せる表示
- 選択メンバー自身の正当な安全 conflict を success に曲げること
- モデルが多様性だけを理由に `constraint_conflict` を返した場合の **追加パース拒否**（L2 と両立させるため。残留リスクとして受け入れ、L13 で弱める）
- 本番デプロイ・push

---

## 5. Spec supersede（本設計が正になる箇所）

| 対象 | 現行 | 本設計 |
|------|------|--------|
| `audience-step.tsx` ラジオ順 | 家族に合わせて → 人数だけ | **人数だけ → 家族に合わせて** |
| `audience-step.tsx` 安全サマリー位置 | household 時にラジオ**上**、members = eligible 全員 | household 時にチェック群の**下**、members = **選択中のみ** |
| meal / cuisine / audience / ingredients の「次へ」 | incomplete で `disabled` または empty dialog | incomplete でも **押下可**。押下で toast + inline alert + focus |
| ingredient 未選択「次へ」 | alertdialog | **toast + inline に統一**（dialog 廃止） |
| 新規 `new_menu` prompt | 最近の料理なし | **常に `recentDishHints` 配列** + system の fail-open 優先順位 |
| 確認画面安全サマリー | 選択のみ（維持） | 維持。audience と意味を揃える |

**維持するもの**

- household / idea の DB・RPC・RLS・quota・HMAC・fingerprint 契約（選択メンバー集合の意味は変えない）
- 再生成の hard 除外と `duplicate_output`
- idea で家族 safety を読まない境界
- C-I4: 新規 draft を全員 auto-select しない
- `normalizeAudienceForModeChange` の mode 切替リセット
- autosave toast の保存中/保存済み/失敗（validation との重なりは §6.3）
- **ラジオ／人数 UI の表示文言**は現行 `audience-step` を維持（本設計は DOM 順とサマリー範囲・ヒントが主）
- 確認「献立を作る」の usage / 医療 / pantry による `disabled` と既存 alert / alertdialog
- `CurrentSafetySummary` の免責文と「家族設定を変更」リンク（メンバー集合のフィルタ対象外）

---

## 6. 機能設計

### 6.1 多様性ヒント（ソフト・fail-open）

#### いつ効くか

| 対象 | 効く？ |
|------|--------|
| `new_menu`（idea / household） | はい |
| 再生成（whole / dish） | **いいえ**（既存 hard 除外のまま。本設計は触らない） |
| 緊急献立・チラシ週間など | **いいえ** |

#### データ流

```
loadExecutionContext(new_menu)
  → loadGenerationContext と loadRecentDishHints を並列開始してよい
  → hints は 200ms で打ち切り、失敗・timeout は []
  → GenerationExecutionContext に recentDishHints を載せる（常に配列）
  → buildGenerationMessages（**new_menu のみ** diversity 合成）
       new_menu user payload に recentDishHints を **常に配列で載せる**（空なら `[]`）
       new_menu system に優先順位と「多様性では conflict にしない」（L13 で無効化可。CORE 恒久改変禁止）
  → OpenRouter → validate / succeed
       // アプリ側は多様性チェックなし
```

#### `recentDishHints` 要素（最小・匿名）

| フィールド | 規則 |
|------------|------|
| `dishName` | 必須。空・空白のみは要素ごと捨てる |
| `role` | あれば載せる。無または空なら **キー省略**（`null` は載せない） |

**載せない:** メンバー表示名、アレルギー、memo、詳細材料リスト。

#### 取得の fail-open（実装ロック）

| 状況 | 挙動 |
|------|------|
| DB エラー / reject / parse 失敗 | value-free ログ（error class のみ）。**`[]` で続行** |
| 硬タイムアウト 200ms | `[]`。timed_out ログ可。ユーザーエラーにしない |
| 献立 0 件 | `[]` |
| 一部料理名欠損 | 取れた分だけ |
| menus 上限 | owner の `public.menus` を `created_at desc` **最大 10 行** |
| 平坦化上限 | dishes の name/role を平坦化し **最大 24 要素**。超過は **古い menu 側から切る** |
| meal_type フィルタ | **しない**（明記） |
| mode 混在 | idea / household 過去献立を混ぜてよい |

**クエリ境界:**

- `regeneration-adapter` の `loadRecent` と同じく **owner 境界の Supabase client** で `menus` を `.eq("user_id", userId)` する
- admin/service-role を使う場合も **必ず `user_id` 等式**を付ける
- `dishes` の name / role（と並び用の最小列）だけを embed/select する
- **`loadStoredMenu` フル aggregate は使わない**
- 失敗時に HttpError を throw **しない**（再生成 `loadRecent` の 503 とは別関数）

#### プロンプト優先順位（system 明示）

1. アレルギー・必須安全・must_use・品数・時間  
2. 利用者 preferences（メイン食材・避けたい等）  
3. **最近の料理に近くないこと（ヒント）**  
4. 季節  

必須文意:

- 可能なら `recentDishHints` の料理名・役割が近い案は避ける
- 避けられない・履歴空・他制約と両立できない場合は **通常どおり `outcome=success`**
- **多様性だけを理由に `constraint_conflict` にしない**

#### system 文の置き場（実装ロック）

- 多様性は **`kind === "new_menu"` のときだけ**適用する。再生成（`regenerate_menu` / `regenerate_dish`）の system / user payload は **変更しない**
- 共有 `GENERATION_SYSTEM_PROMPT_CORE` 文字列を恒久改変して再生成にも載せる実装は **禁止**
- **system 合成レシピ（実装ロック）:** 既存 CORE 末尾の季節ブロックを **論理的に分離**してよい（構造リファクタ。再生成にも載る diversity の恒久埋め込みは禁止のまま）:
  `CORE_BODY + (kind==="new_menu" && DIVERSITY_HINTS_ENABLED ? DIVERSITY_PARAGRAPH : "") + SEASON_BLOCK + (idea ? IDEA_EXTRA : "")`
- 合成は **`buildGenerationMessages` 側**で `kind` を見て行う。`buildBaseGenerationMessages` に diversity を直書きしない
- Vitest: new_menu+flag on では diversity が season **より前**；regen では diversity 段落も `recentDishHints` キーも無し
- L13 off では **`loadRecentDishHints` を呼ばない**。new_menu の user payload は `recentDishHints: []`。system 多様性段落なし
- L13 on かつ new_menu では load（fail-open）し、配列は空または最大 24。system 多様性段落あり
- `recentDishHints` キーは **new_menu の user payload にのみ**付ける（常に配列）。再生成 user メッセージにキーを足さない
- フラグ識別子: `DIVERSITY_HINTS_ENABLED`（default `true`）。置き場: `netlify/functions/_shared` 定数

#### 平坦化順序

- 各 menu（`created_at desc`・最大 10）について dishes を `position` 昇順（同値は id 昇順）で走査する
- `dishName` が空・空白のみの要素は **先に捨て**、有効要素だけを新しい menu から詰める
- 有効要素が **24 に達した時点で打ち切る**（古い menu 側は載せない）
- `role` は非空のときだけキーを載せる（`null` / 空キー禁止）
- 200ms 超過時は呼び出し側に `[]`。可能なら `AbortSignal` で cancel（必須ではない）。timeout 後に遅延 resolve した hints は **採用しない**

#### 検証・quota・残留リスク

- preflight / `validateGeneratedMenu` / finalize に多様性を **追加しない**
- 近い案でも成功保存・成功回数を消費してよい
- 追加の AI 送信・repair トリガにしない
- モデルが指示に反して diversity 由来の `constraint_conflict` を返した場合は **既存 conflict 処理のまま**（新コードで success に曲げない）。これは残留リスクとし、L13 で system 文を弱められるようにする
- 多様性パスは **新しいユーザー向け失敗クラスを追加しない**
- `recentDishHints` は fingerprint / reserve・HMAC / quota に **載せない**（L14）

---

### 6.2 「4. 作る相手」UI と選択メンバー安全

#### レイアウト（DOM 順 = 読み上げ順）

1. 見出し「4. 作る相手」
2. ラジオ（上から）  
   - 人数だけ指定してアイデアを見る  
   - 家族に合わせて作る  
3. `targetMode === "idea"` → 人数 UI  
4. `targetMode === "household"` →  
   - 常時ヒント（チェック必須）  
   - 家族チェック一覧  
   - **その下**に「現在の家族・安全条件」（**選択中のみ**）

#### チェック必須 UX

| 状態 | 挙動 |
|------|------|
| household・0 人 | ヒント:「献立に合わせる家族を1人以上選んでください」（視覚的に強調してよい） |
| 0 人で「次へ」 | 押下可。toast + インライン `role="alert"` + チェック群 focus **必須** |
| 1 人以上 | 次へで完了。常時ヒントは **短い note（`aria-describedby`）に格下げ**して残す（長い段落を重ねない） |
| 利用可能 0 | 現状どおり household disabled + 理由 + 家族追加リンク |

#### チェック行とサマリー

- 一覧のアレルギー／年齢表示は **選ぶ判断用**。サマリー注記の直後に固定1行:  
  「一覧の表示は選ぶときの参考です。チェックしていない人の条件は献立に入りません。」
- 選択 0: サマリー見出しは出し、**メンバー行は出さない**。本文固定文「家族を選ぶと、その人の条件がここに表示されます。」
- 選択あり: 選択 ID のみ（`review-step` と同じフィルタ）
- **draft 永続化も selectable のみ**（blocked / 非 eligible を autosave・sanitize で落とし、draft に残さない）。既存 C-I4 / sanitize 経路を維持・強化
- 注記（必須・選択 1 人以上）:「ここに出ている条件だけが献立に使われます。選んでいない家族は含まれません。」
- **維持（必須・選択人数に依存しない）:** リンク「家族設定を変更」（`/settings`、C-I2）と免責「AI生成だけでアレルギーの安全は保証できません。加工品の表示と家庭内の混入を確認してください。」
- idea 時: サマリー非表示（免責も audience では出さない）

#### 不変条件（クライアント＋サーバー）

生成時の安全入力は、すべて次と一致する（**いずれも selectable のみ。draft も常に selectable のみを永続**）:

1. クライアント state の `targetMemberIds`（selectable のみ）  
2. 永続化された draft / submission の `target_member_ids`  
3. reserve snapshot の `target_member_ids`  
4. `loadGenerationContext` の members / dislikes / safety  
5. fingerprint 入力メンバー集合  
6. prompt の `members`  
7. preflight / `validateGeneratedMenu` の members  
8. finalize の `p_target_members`  

送信直前にもう一度 selectable フィルタを通す（二重防御）。draft に非 selectable を残す設計は取らない。

#### 経路監査チェックリスト（Task 完了条件・必須）

各項目 pass/fail を検証記録に残す。**fail 時のみ最小修正。pass ならコード変更なしでよい。**

1. `generation-context` の member / dislike / safety load  
2. `buildGenerationMessages` / prompt members  
3. preflight / `validateGeneratedMenu` 入力の members  
4. reserve snapshot の `target_member_ids` と submission 一致  
5. fingerprint 入力メンバー集合  
6. finalize `p_target_members`  

#### household `constraint_conflict` 表示と `mandatory_safety_conflict`

- 修正目標: **未選択アレルギー起因（およびそう見える UI）の除去**
- 選択メンバーのみでも、`requiredSafetyConstraints` / 年齢帯だけで conflict し得る
- `generationConflictCopy.mandatory_safety_conflict` 本体は **変更しない**
- 年齢帯・切り方等の必須安全を、未選択のアレルギーと混同しない日本語にする
- 選択者自身の正当な安全 conflict は既存どおり残す

**補助文（固定・時制中立・両 surface 同一文言）:**  
「献立には今回選んだ家族の条件だけが使われます。」

**surface 別の表示条件（分割ロック）:**

| Surface | 出す条件 |
|---------|----------|
| 確認 (`review-step`) | `draft.value.targetMode === "household"` のみ（`kind` 不要）。 選択 0 人でも出す（サマリーが空固定文のときも **そのブロック直下**）。idea では出さない |
| 生成結果 (`GenerationStatusPanel`) | `constraint_conflict` 分岐内、かつ **有効 kind === `"new_menu"`**、かつ `targetMode === "household"`。idea / `regenerate_*` / 判定材料欠落は出さない |

生成結果側: `conflicts[].code` を問わず、conflicts 一覧の直前または直後に補助文を **ちょうど1回**（各 conflict 行には繰り返さない）。

**配置（実装ロック）:**

1. 確認: **`review-step` 内**で `CurrentSafetySummary` の **直下**（sibling）。**共有 `CurrentSafetySummary` 本体に埋め込まない**（audience に漏れない）
2. 生成結果: `GenerationStatusPanel` の `constraint_conflict` 分岐のみ

**生成結果の kind / targetMode 正本（実装ロック）:**

`new_menu` の HTTP リクエスト / status スキーマに `targetMode` を足すことは **必須にしない**。代わりに **pending と寿命を共有する client メタ**に載せる。

| 材料 | 規則 |
|------|------|
| `pending.kind` | terminal / in-flight で pending がある間は **kind の唯一の正本** |
| `pending` メタの `targetMode` + `idempotencyKey` | `new_menu` の `createPendingGeneration` / `savePendingGeneration` と **同一ストレージ・同一 TTL・同一 clear 経路**で永続する（localStorage pending と一緒）。キー名は実装でよいが **legacy sessionStorage `generation-target-mode` は使わない** |
| status HTTP | `kind`/`targetMode` 追加は必須にしない |
| live draft | in-flight の正本に **しない**（submit 後に書き換えられ得る） |

**write / clear マトリクス:**

| イベント | pending メタ（targetMode 等） |
|----------|-------------------------------|
| `new_menu` の `savePendingGeneration` / create | **Upsert** `{ kind: "new_menu", targetMode, idempotencyKey }`（clear-only 禁止） |
| `regenerate_*` の `savePendingGeneration` | **Clear** targetMode メタ、または kind を regenerate に上書きして helper 非対象にする |
| `clearGeneration` | Clear |
| RecoveryLinks 等で pending clear | **メタも同時 clear** |
| 結果離脱 | Clear |

**表示アルゴリズム（GenerationStatusPanel）:**

```
if status !== constraint_conflict: no helper
kind = pending?.kind ?? null   // pending 無し terminal では helper なしでよい（fail-closed）
meta = loadPendingMeta()       // pending と同一ストア
if meta?.idempotencyKey !== pending?.request.idempotencyKey: no helper
if kind === "new_menu" && meta?.targetMode === "household": show helper once
else: no helper
```

reload / 復帰後も pending TTL 内なら helper を出せる。§12.3b に **recovery/reload 経路**を含む。

**回帰テスト必須:**

1. same-session household `new_menu` conflict → 補助文 1  
2. reload 後も household `new_menu` conflict → 補助文 1  
3. 続けて `regenerate_*` conflict → 補助文 0  

#### 下書き

- C-I4・`normalizeAudienceForModeChange` を維持  
- E2E / a11y の順序・セレクタを更新  

---

### 6.3 トースト UX（ウィザード質問 step ＋ 家族）

#### 操作マトリクス（L7 の正本）

| 操作 | incomplete 時 | focus 先（必須） | 備考 |
|------|---------------|------------------|------|
| meal「次へ」 | 押下可 + toast + inline alert + focus | 食事 `radiogroup` 内の先頭操作可能 control | |
| ingredients「次へ」 | 同上 | メイン食材の入力欄。無ければ先頭の未選択チップ | empty dialog 廃止 |
| cuisine「次へ」 | 同上 | ジャンル `radiogroup` 内の先頭操作可能 control | |
| audience mode 未選択 | 同上 | モード `radiogroup` 内の先頭操作可能 control | |
| audience household 0 人 | 同上 | メンバーチェック群内の先頭操作可能 checkbox | |
| audience idea servings null | 同上 | 人数チップ群の先頭。servings が 7+ で select に載る値なら select 優先 | |
| 家族保存・完了 | 押下可 + field error + toast + focus | 先頭 invalid field（schema 順） | |
| 確認「献立を作る」 | usage / 医療 / pantry 等の既存 `disabled` **維持** | validation focus 追加なし | **validation toast を新規追加しない**。disabled 理由は隣接の既存日本語 alert で常時説明 |
| 親の `disabled`（autosave 中・生成送信中） | 全ボタン disabled 可 | — | incomplete とは別 |

incomplete 時は `onNext` / 保存成功コールバックを **呼ばない**（親の advance を発火させない）。

**例外（マトリクス正本の注記）:** autosave **error（retry あり）表示中**は、上表の「toast」を出さず **inline alert + focus のみ**（§6.3 autosave 関係）。

#### 共通コンポーネント

- 配置: `src/shared/ui/app-toast.tsx`（`AppToastProvider` / `useAppToast`）。ルート近くで Provider を1回だけマウント  
- 見た目トークン（色・padding・radius）は `.autosave-toast` 系を流用してよい。validation 用は **別 class**（例: `.app-toast`）で `z-index: 20` を付与し、autosave の 15 を上書き依存にしない  
- 新カラー体系は作らない  
- API: `useAppToast().show({ message: string, tone: "error" | "info", durationMs?: number })`  
- default `durationMs` = **6000**。**hover / focus 中は dismiss しない（必須）**。WCAG 2.2.1  
- **SR 戦略（固定）:**  
  - ウィザード: インライン = `role="alert"`（直るまで）。validation toast error = `role="status"` + `aria-live="polite"`  
  - 家族フォーム: **フォームレベル `role="alert"` は先頭エラー1つ**（またはエラー要約1つ）。各 field は `aria-invalid` + `aria-describedby`。toast は `status`  
  - autosave error は既存どおり `role="alert"` のまま。autosave error 中に incomplete 押下すると alert が2つになり得る → **受け入れ済み残留**（retry を隠さないことを優先）  
- 同時表示: validation toast は **最新 1 件**（後勝ち）  
- autosave との関係:  
  - autosave z-index = **15**、validation `.app-toast` z-index = **20**（ロック）  
  - autosave **error（retry あり）表示中は validation toast を出さず、inline alert のみ**（retry を隠さない）  
  - autosave saving/saved の上には validation を重ねてよい  
  - validation toast にアクションは置かない（pointer-events 不要）  
  - 本設計の validation toast が出る surface に modal/alertdialog を同時表示しない（ingredient empty dialog 廃止後）

#### エラーライフサイクル（必須）

1. incomplete 押下で step ローカルの `errorMessage` / fieldErrors をセットし toast を出す（autosave error 中は toast 省略・inline のみ）  
2. 当該 step / フォームが valid になったら **インライン（とフォーム alert）を必ずクリア**  
3. `onNext` 成功・家族保存成功時は validation toast を **即座に dismiss**（duration 待ちしない）  
4. step 離脱・ルート離脱（戻る・完了）でも validation toast と inline をクリア  
5. **toast のみ**になる経路は禁止。status 行が無いネットワーク失敗では **永続 `role="alert"` 行を必須**（toast は任意）。ウィザード incomplete は常に永続 inline があるため toast は 6s で消えてよい  

#### ウィザード質問 step の toast 文言

| Step | 未完了 | toast / inline 文言 |
|------|--------|---------------------|
| 食事 | 未選択 | 食事の時間帯を選んでください |
| 食材 | 0 件 | メイン食材を1つ以上選んでください（**empty dialog 廃止**） |
| ジャンル | 未選択 | ジャンルを選んでください |
| 相手 | mode 未選択 | 作る相手の選び方を選んでください |
| 相手 household | 0 人 | 献立に合わせる家族を1人以上選んでください |
| 相手 idea | servings null | 人数を選んでください |

インラインは既存 `errorMessage` / `fieldErrors` を再利用。押下時にローカル state で message をセットしてよい。

#### 家族追加・編集

対象: オンボーディング家族フォーム ＋ 設定の家族編集（同一 schema 系）。

| 操作 | 挙動 |
|------|------|
| 必須未入力で保存・完了 | field error **必須** + toast 文言は **先頭 field の message**（無ければ「入力内容を確認してください」） |
| 先頭 invalid focus | **必須** |
| アレルギー登録ありで 0 件 | 既存メッセージを field/inline に出し、**同じ意味の toast** |
| ネットワーク保存失敗 | 画面内に `role="alert"` の status 行がある画面は **toast 省略**。status 行が無い操作は **永続 alert 行を必須**（toast のみにしない） |

成功 toast は必須にしない（既存「保存済み」で足りる）。

#### 文言原則

- 短く、次アクションが分かる  
- 英語 code を出さない  
- toast と inline は同じ意味  

---

## 7. アーキテクチャ境界

| 層 | 変更の置き場 |
|----|----------------|
| Functions 内 private DTO | `recentDishHints` 形状（**ブラウザ共有 contracts に出さない**。必要になるまで private） |
| `netlify/functions/_shared` | hints load（fail-open）、`buildGenerationMessages`、execution context 拡張、多様性 system 文フラグ |
| `src/shared/ui` | toast プリミティブ |
| `src/features/planner` | wizard 質問 steps、audience レイアウト、validation 配線、household 確認サマリー補助文（copy 本体は触らない） |
| `src/features/household` | 保存時 validation toast |
| `src/features/generation` | household 時の constraint_conflict 補助文（copy 本体は触らない） |
| `e2e` | セレクタ・順序追随 |
| DB / マイグレーション | **原則不要**（経路監査 fail 時のみ） |

所有境界は既存どおり。hints 取得は **サーバーのみ**。ブラウザに OpenRouter や service key を出さない。

---

## 8. エラーハンドリング

| 領域 | 方針 |
|------|------|
| 多様性 load 失敗 / timeout | 生成続行。ユーザー向けエラーにしない |
| モデルが diversity 由来 conflict | 既存 conflict 処理。多様性専用コードは追加しない。L13 で system 弱体化可 |
| wizard 質問 step 未完了 | toast + inline alert + focus。遷移しない |
| 家族 validation | field + toast + focus。保存しない |
| 選択メンバーの正当な安全 conflict | 既存 `generationConflictCopy` + §6.2 補助文 |
| 未選択混入バグ | 監査 fail 時のみ最小修正 + 回帰テスト |

プライバシー: ログに名前・アレルギー・自由文・raw AI を出さない。hints ログに料理名を出さない（件数・timed_out のみ可）。

---

## 9. テスト戦略

### Vitest（受け入れ対応）

| 受け入れ | テスト |
|----------|--------|
| §12.1 | meal/cuisine/ingredients/audience: incomplete 押下で **通常は toast + inline alert + focus**、complete で onNext、成功時 toast dismiss。 **autosave error(retry) 表示中は inline(+focus) のみで合格**。focus 先は §6.3 マトリクス |
| §12.2 | audience DOM 順、サマリー = 選択のみ、idea でサマリーなし、チェック必須ヒント |
| §12.3a | メンバー A なしアレルギー・B あり、draft=A のみ → context / prompt / **preflight** / **fingerprint** に B が出ない |
| §12.3b | (1) review-step: draft household 時に固定補助文（CurrentSafetySummary 本体には埋めない） (2) GenerationStatusPanel: pending.kind===new_menu かつ targetMode household で固定補助文ちょうど1回。 idea / regenerate_* / pending・判定材料欠落は補助文なし。 **new_menu conflict のあと regenerate conflict で補助文 0** |
| §12.4 | load 失敗・timeout でも messages 構築・生成依存が止まらない；hints 空配列 |
| §12.5 | `validateGeneratedMenu` / 成功経路が diversity を理由に拒否しない（diversity assertion を success ゲートに置かない）。近い recentDishHints でも success 可の単体 |
| §12.6 | household form 必須漏れで toast + field error + focus |
| §12.7 | 監査 1–6 の pass/fail を検証記録に残す（自動テスト不要可・Task 報告で可） |
| L13 off | `DIVERSITY_HINTS_ENABLED === false` → load 非呼び出し・`recentDishHints: []`・system 多様性段落なし・生成続行 |
| 再生成非影響 | regen messages に多様性段落も `recentDishHints` キーも載らない |
| その他 | toast 1 件制限、autosave error 中は validation toast 抑制、hints 24 cap / 200ms timeout、hints 非 fingerprint |

### E2E

- audience 並びと household 1 人選択  
- 未選択「次へ」で **inline alert と toast と focus**（autosave error を出さない経路で実施）  
- 多様性は Vitest 優先でよい  

### pgTAP

- スキーマ不変なら追加必須なし  
- 監査で SQL 修正した場合のみ  

### ゲート

Task ごとに focused Vitest、typecheck、lint、format:check、`git diff --check`。  
Plan 完了時はプロジェクトの §8 ゲートに従う。

---

## 10. 実装順

1. shared toast + スタイル接続（z-index・autosave 共存ルール込み）  
2. wizard 質問 step incomplete UX（meal → cuisine → ingredients → audience）  
3. audience 並び・選択サマリー・ヒント／注記文言  
4. 家族 form validation toast  
5. 安全経路監査チェックリスト実行（＋ fail 時のみ最小修正）＋ §12.3a 回帰  
6. household 補助文: 確認サマリー + generation view-model の `targetMode` 保持 + `GenerationStatusPanel`（§12.3b）  
7. `recentDishHints` fail-open load + prompt + `DIVERSITY_HINTS_ENABLED`  
8. E2E / a11y 追随（focus 含む）  

コミット: Conventional Commits・日本語。**push / 本番 deploy しない。**

---

## 11. リスク

| リスク | 緩和 |
|--------|------|
| 多様性が失敗を増やす | fail-open・200ms cap・検証非介入・prompt 優先順位・追加 AI なし・L13 無効化 |
| モデルが diversity conflict | 既存処理のまま残留。system 弱体化 |
| hints トークン膨張 | menus 10・hints 24 cap |
| toast と autosave retry の衝突 | autosave error 中は validation toast 抑制 |
| ingredient dialog 廃止で E2E 破壊 | セレクタ更新 |
| 年齢制約とアレルギーの混同 | 選択分のみ表示・補助文・§12.3b |
| toast 二重実装 | shared 1 箇所。validation 呼び出しは planner/household のみ |

---

## 12. 受け入れ条件

1. 質問 step で未選択の「次へ」に反応があり、**toast と inline alert と該当 control focus** で何を直すか日本語で分かる。 **例外:** autosave error(retry) 表示中は inline + focus のみ（toast なし）で合格。  
2. audience で idea が上、household の下に安全ボックス、チェック必須が分かる。  
3a. アレルギーあり家族を選ばなければ、その条件は prompt / preflight / fingerprint に入らない（テスト固定）。  
3b. 確認は draft household で固定文。生成結果は pending.kind===new_menu かつ pending メタ targetMode household の constraint_conflict で固定文ちょうど1回（**reload 復帰後も含む**）。idea / 再生成 / メタ欠落は補助文なし。new_menu conflict 後の regenerate でも補助文なし。  
4. 新規生成は履歴ヒントを載せ得るが、**履歴なし・load 失敗・timeout でも生成可能**。  
5. アプリ側は多様性だけで success を落とさない。新しい多様性失敗クラスを追加しない。  
6. 家族追加・編集の必須漏れで toast + field error + focus が出る。  
7. 経路監査チェックリスト 1–6 が pass（または fail 修正済み）として記録されている。  

---

## 13. レビュー方針

- 設計: self-review → クリーンコンテキスト敵対的レビュー → **Critical / Important / Minor ゼロ**まで修正  
- 実装 Task ごと: 通常レビュー + 敵対的レビューを同様にゼロまで  

---

## 14. 参照実装（現状の錨）

- `src/features/planner/components/audience-step.tsx`
- `src/features/planner/components/review-step.tsx`（選択のみサマリー）
- `src/features/planner/components/ingredient-step.tsx`（step id `ingredients`。empty gate → 本設計で置換）
- `src/features/planner/planner-route.tsx`（C-I4 sanitize）
- `netlify/functions/_shared/generation-context.ts`（targetMemberIds のみ load）
- `netlify/functions/_shared/generation-prompt.ts`
- `netlify/functions/_shared/regeneration-adapter.ts`（loadRecent は参考。fail-open 版は別）
- `shared/contracts/generation.ts`（`mandatory_safety_conflict` copy）
- `src/styles.css`（`.autosave-toast`、z-index 15）
- `src/features/household/household-settings-schema.ts`
