# 敵対的コードレビュー 指摘一覧 (2026-07-26)

- 対象: `main` @ `9fdc2a3`（clean tree）
- 方式:
  - **第1セッション**: read-only レビュー 5 領域並列（A–E）。リポジトリは無変更・無コミット。
  - **第2セッション**: 別経路の 5 領域敵対レビュー + 重要指摘 11 件の独立二次レビュー。本ファイルへ
    **重複しない新規分のみ**統合し、既存 ID と実質同一のものは既存項へ二次確認を追記した。
  - **第3セッション**: エンドユーザー UX 敵対レビュー（4 体一次 + 3 体二次深掘り）。観点は主婦・低 IT・片手スマホ・不安定回線。
    詳細一次/二次は `docs/archive/reviews/2026-07-26-adversarial-ux-review.md` と
    `docs/archive/reviews/2026-07-26-adversarial-ux-review-secondary.md`。本ファイルへは**既存 ID と実質同一でないものだけ**を
    末尾採番で統合し、重複は既存項へ「第3セッション」注記を付けた。
  - **第4セッション**: OpenRouter / 生成パイプライン重点の敵対レビュー（一次 4 体 + 二次 1 体 + 深掘り 3 体）。
    作業メモ: `.superpowers/sdd/mvp-adversarial-ai-2026-07-26/`（`00-summary`〜`09-deep-synthesis`）。
    本ファイルへは**既存 ID と実質同一でないものだけ**を末尾採番（A-I9〜A-I12 / A-M5）し、重複は A-C1 / A-I8 等へ吸収した。
- 検証水準:
  - 第1: 領域 A は Docker `app` で照合関数実行、領域 D は `shared/shopping/*` を Node 24 で入出力確認。
    領域 B / C / E は静的読解 + `grep`（DB コンテナ停止中のため SQL 実出力は未実行）。
  - 第2: 静的読解 + コールチェーン追跡。Auth-F2 系は Node WHATWG URL で path collapse を再実測。
    各項の「未確認」表記は第1由来のものを原則残し、二次で覆した箇所だけ本文を更新する。
  - 第3: 静的読解 + 設計 §6/§10/ガイドド突合 + 二次での再判定（Critical 格下げ含む）。実機ブラウザ未実施。
  - 第4: 静的読解 + E2E コールチェーン（OpenRouter → materialize → validate → succeed / SQL finalize / maintenance）。
    アレルゲンは辞書 inventory + 表記行列。実 Netlify 上限・実 OOM は未測（E-U1 と同型の残差）。
- 目的: 他セッションとの統合。**既存 ID は他セッションから参照される前提で変更しないこと。**
  第2由来の新規 ID は各領域の採番を末尾延長する（A-I7〜、B-I5〜、C-I9〜、C-M7）。
  第3由来の新規 ID はさらに末尾延長する（A-C2、B-C1、B-I7〜、C-I12〜、C-M8、D-I16〜、D-M8）。
  第4由来の新規 ID はさらに末尾延長する（A-I9〜A-I12、A-M5）。

## 本ファイルだけで着手する AI 向けの前提（第5セッション: 統合後の再レビューで確認）

- **パス表記**: 見出し直下の 1 本目は基本フルパスだが、本文中の多くは**ベース名のみ**（`review-step.tsx:265` 等）。
  同名ファイルが複数あるものに注意。特に `menu-result.tsx` / `menu-result-api.ts` は
  `src/features/**generation**/{components,api}/` にあり `src/features/menu/` は**存在しない**。
  参照が解決できないときは `grep -rn` で確認してから編集すること。
- **`.worktrees/` を編集しない**: リポジトリ直下に `.worktrees/{fix-ci-app-uid,...}` の作業コピーがあり、
  `grep -rn` が同じコードを複数ヒットさせる。修正対象は**リポジトリルート直下のパスのみ**。
- **参照先の可搬性**: 第4セッションの根拠 `.superpowers/sdd/mvp-adversarial-ai-2026-07-26/**` は
  `.gitignore` 対象（git 管理外）。第3の `docs/archive/reviews/2026-07-26-adversarial-ux-review*.md` も
  **未コミット**。別環境の AI からは読めない可能性があるため、**本ファイルの記述を一次資料として扱う**。
- **ID の癖**: `D-M7` は ID が M でも **Important 相当**（集計も Important 側）。`A-U1` と `E-U1` は
  **同一論点（Netlify 同期 Function の実上限）を 2 領域から記録したもの**で、実質 1 件。
  `A-U2` は `A-C2` へ吸収済みで欠番。
- **CLAUDE.md の制約が優先**: ロック値（5/12/4/600s/45/20s/50s/180s/300s/30日）、オリジン、
  locked interface は**指摘があっても勝手に変えない**。本ファイルが「人間判断」と書いた項目
  （A-C1 の照合方式・辞書 version、A-I7、A-I11 の上限値、A-I12 の N、B-I2、B-I5、E-U1）は
  実装前に人間の決定が要る。
- **テストが誤挙動を固定している箇所**は修正時に必ず書き換えが要る:
  `emergency-menu-page.test.tsx`（C-I6）、`planner-route-conflict.test.tsx:338-352`（C-I14）、
  `household-onboarding-page.test.tsx:499`（C-C1）、`auth-callback-page.test.tsx`（B-C1）、
  `generation-status-panel.test.tsx:25,58`（E-I1）、`004_auth_continuations.test.sql:56-76`（B-I2）、
  `auth-flow.test.ts:41-44` と `e2e/fixtures/auth.ts:39-45`（B-I5）。

## 集計

| 領域 | 範囲 | Critical | Important | Minor | 未確認 |
|---|---|---:|---:|---:|---:|
| A | 安全性（アレルギー/食品安全）・AI 生成 | 2 | 12 | 5 | 1 |
| B | 認証・継続・アカウント削除・プライバシー・RLS | 1 | 10 | 9 | 0 |
| C | ガイド付きプランナー・世帯設定・オンボーディング UX | 2 | 15 | 8 | 0 |
| D | 買い物リスト・パントリー・履歴・再生成 | 2 | 21 | 7 | 0 |
| E | クォータ・レート制限・JST・環境設定・CSP | 0 | 2 | 6 | 1 |
| **計** | | **7** | **60** | **35** | **2** |

第2セッションで追加した Important は A-I7 / A-I8 / B-I5 / B-I6 / C-I9 / C-I10 / C-I11 の 7 件。
D-M7 は二次レビューで Important 相当と確定し本文を拡充（ID は D-M7 のまま、集計上 Important に計上）。
C-M7 は Minor 1 件追加。既存と重複した二次指摘（returnTo 無害化・緊急献立空文言・再生成シート）は
それぞれ B-I3 / C-I6 / D-M7 へ吸収し、新規 ID は採番していない。

第3セッションで追加した Critical は **A-C2** / **B-C1** の 2 件。Important は
B-I7〜B-I10 / C-I12〜C-I15 / D-I16〜D-I20 の 13 件。Minor は B-M9 / C-M8 / D-M8 の 3 件。
既存と重複した UX 指摘（オンボーディング袋小路・ProgressIndicator 未使用・緊急空文言・autosave 無言・
パントリー期限注意・連続タップ・再生成残数・お気に入り詳細・reconcile 既定チェック等）は
C-C1 / C-I1 / C-I6 / C-I9 / D-I6 / D-I13 / D-I14 / D-M5 / D-C2 等へ吸収し、新規 ID は採番していない。
A-U2 は第3で UI 表示が確認できたため **A-C2 に吸収**し未確認から外した（A-U1 のみ残す）。

第4セッションで追加した Important は **A-I9** / **A-I10** / **A-I11** / **A-I12** の 4 件。Minor は **A-M5** の 1 件。
卵・乳の高頻度表記（玉子 / タマゴ / ミルク）とかな折り畳み不足は **A-C1 と同一根**のため新規 ID を採番せず
A-C1 本文へ深掘り行列を追記。finalize の false `succeeded` ログは **A-I8** と同一のため深掘り注記のみ。

## 推奨着手順（影響範囲と回復不能性）

1. **A-C1** アレルゲン取りこぼし（安全性の中核・危険側の誤り。第4で卵・乳の高頻度表記を補強）
2. **A-C2** 再検証 issue が `member_1` / 英語 ID を利用者に出す（信頼破壊・3 画面）
3. **D-C1** 履歴削除で買い物機能が恒久停止（回復導線ゼロ）
4. **D-C2** reconcile が正常項目を無断削除（データ消失）
5. **C-C2** ブロッキングエラーが不可視（機能が使えない）
6. **C-C1** オンボーディング袋小路（新規利用者を直撃）
7. **B-C1** マジックリンク deposited にやり直し無し（受け入れ条件 L644）
8. **B-I5** 未ログイン `/` が初回 `/welcome` をスキップ（新規導線）
9. **B-I3** returnTo path collapse による open redirect（二次で悪用経路を確定）
10. **C-I6** 緊急献立の誤った「未登録」文言 + 失敗パネル無条件導線（第3で強化）
11. **A-I7** 希望条件 hard-fail（試行消費・設計矛盾。人間の方針決定が要る）
12. **A-I8** / **A-I9** 生成終端の ops 契約（ログ誤 success・50s finalizer abort 欠落）
13. **A-I11** / **A-I12** OpenRouter 応答サイズと `safetyTags` 希釈（可用性・スキーマ閉じ）
14. **A-I10** draft submission freeze の 30 日保持欠落（自由入力の死蔵）

A-C1 と A-I1 は同一の照合器・同一の正規化に起因する。**片方だけ直すともう片方が悪化する**ため、
語境界を持つ照合方式と辞書カバレッジをセットで設計し直す必要がある（個別パッチ非推奨）。
第4の結論も同じ: kana fold 単体では「玉子」は直らず、alias 追加だけでは「タマゴ」が残る。
A-C2 の人間向け化は A-C1 の issue 生成経路と隣接するが、**表示用 displayName 組み立て**が主題で照合ロジック本体とは分離して直せる。
A-I9 は A-I11 / A-I12 の巨大応答で増幅されるが、**二重 attempt 後の薄 finalize 窓だけでも独立に成立**する。
---

# 領域 A: 安全性・AI 生成パイプライン

## A-C1 [Critical] アレルゲン照合がかな/カナ表記ゆれと小麦加工品名を取りこぼす

- 照合本体: `shared/safety/allergens.ts:36-44`（`normalizeFoodText`）、`:150-159`（`includes` 判定）
- 辞書実体: `netlify/functions/_shared/current-safety.ts:40-110`
- カタログ: `shared/safety/current-allergen-catalog.v1.ts:24-52`

`normalizeFoodText` は NFKC + `toLocaleLowerCase("ja-JP")` + 記号除去のみで、**ひらがな⇔カタカナを正規化しない**。
照合は正規化後の素の部分一致のため、辞書にない表記は完全に素通りする。

Docker `app` での実測（`normalizeFoodText(text).includes(normalizeFoodText(alias))`）:

| 献立テキスト | alias（辞書の形） | 一致 |
|---|---|---|
| `サーモンのムニエル` | `さけ` / `鮭`（salmon 全 alias） | false / false |
| `サバの味噌煮` | `さば`（mackerel） | false |
| `ざるソバ` | `そば`（buckwheat） | false |
| `クルミパン` | `くるみ`（walnut） | false |
| `うどん` / `パスタ` / `ラーメン` | wheat 全 alias（`小麦`,`小麦粉`,`食パン` 等のみ） | false / false / false |

再現: メンバーに `wheat` を登録 → 生成 → AI が `きつねうどん` / 材料 `うどん` を返す →
`evaluateAllergens`（`allergens.ts:141`）が `direct_allergen_match` を 1 件も出さず →
`validateGeneratedMenu` が ok → `finalize_ai_generation_success` で保存 →
**小麦アレルギー児向け献立として表示される。**

仕様: `2026-07-11-kondate-mvp-design.md:649`「全 text leaf を検査して直接アレルゲンを含む結果を保存しない」、
`:211`「同義語・派生原材料の辞書」。text leaf の列挙（`collectMenuTextSources`）は正しく、**辞書と正規化が不足**。

付随: 同じ正規化を使う main ingredient 照合（`shared/safety/validate-generated-menu.ts:88-98`）も同根で、
「鮭」指定に対し AI の「サーモンのムニエル」が `main_ingredient_missing` になり正しい献立が捨てられる。

防波堤が効いていない: `dictionaryInvalid` 検査（`validate-generated-menu.ts:288-310`）は
「アレルゲンごとに direct・ラベル確認不要・表示名と等しい alias が 1 本」しか要求しないため、
辞書カバレッジが薄くても常に通る。

**第4セッション深掘り（同一 ID・卵/乳の高頻度表記を補強）:**
ランタイム辞書は `currentAllergenAliasManifest`（catalog `displayName` 種 + `additionalAliasValues`）と
migration seed が exact 一致でロックされる。卵 8 alias（`卵`/`鶏卵`/`卵白`/`卵黄`/`たまご` + 加工品 3）、
乳 10 alias（`乳`/`牛乳`/`バター`/`チーズ`/`乳成分` + 加工品 5）。**未収録: `玉子` / `タマゴ` / `エッグ` /
`ミルク` / `みるく`。**

| 献立テキスト | 期待 | 一致 |
|---|---|---|
| `卵` / `卵焼き` / `鶏卵` / `たまご` | egg 検出 | true |
| **`玉子` / `玉子焼き` / `タマゴ`** | egg 検出 | **false** |
| `乳` / `牛乳` / `生乳` | milk 検出 | true（`乳` 部分一致） |
| **`ミルク` / `ミルクティー`** | milk 検出 | **false** |

E2E: OpenRouter Zod は料理名を自由文字列として通す → `materializeAiGeneratedMenu` が verbatim コピー →
`evaluateAllergens` で miss → `validateGeneratedMenu` ok → `repository.succeed` → クライアント `succeeded`。
preflight の `containsAlias` は main/pantry のみで、**AI 本文の 玉子 は送出前に止まらない**。

修正パッケージ（第4推奨・A-I1 とセット）:
1. レビュー済み alias 追加（最低 egg: `玉子`、milk: `ミルク`。fold 無しなら `タマゴ` も）
2. `normalizeFoodText` にカタカナ→ひらがな折り畳み（**fold だけでは玉子は直らない**）
3. **DB migration INSERT と TS manifest を同時更新**（片方だけだと snapshot exact 検査で generation が `internal_error`）
4. RED: 玉子 / タマゴ / ミルク + fold 契約。現行 unit/pgTAP は 鶏卵・卵 中心で玉子でも緑のまま。

「安全を保証しない」（design ~221 / ~421）はオムライス型の暗示・加工品差・混入向けであり、
既に `たまご` を載せる辞書の高頻度表記漏れを残差扱いにしない（第4 二次: Important クラスの根は A-C1）。

## A-C2 [Critical] 再検証・安全 issue の利用者向け本文が `member_1` と英語アレルゲン ID をそのまま出す

> 第3セッション（UX 敵対・二次で Critical 維持・到達面を拡大）。A-M1（永続化）と根は同じだが、
> **主婦が読むアラート本文**が設計 §6 L221 / §10.3 L372 の禁止に直接触れる点が Critical。

- 生成: `shared/safety/allergens.ts:184-188`
  `` `${member.anonymousRef} の登録アレルゲン ${allergenId} が残っています` ``
- 同型: `revalidation-adapter.ts:176-180`（パントリー名スナップショット）、`food-rules.ts:786-789`
  （`${required} を満たす工程がありません` — `cut_small` 等の英語制約 ID）
- 構造: `revalidation-service` が `!ok` のとき `issues` を raw のまま返し **`currentLabelWarnings = []`**
  （人間向け DTO は valid 時だけ）。ラベル警告経路（日本語名・表示名）は invalid では使われない。
- 利用者到達面（いずれも `issue.message` を verbatim）:
  - 履歴詳細 `history-detail-page.tsx:630-636`
  - 献立結果 `menu-result-page.tsx:649-655`
  - 買い物ゲート `use-shopping-list.ts:85-88` → `join("。")`

再現: 家族条件変更後に履歴または結果を開く / 買い物リストを開く → ブロックアラートに
`member_1 の登録アレルゲン egg が残っています` 等 → 壊れたアプリに見える・アレルギー信頼が崩れる。

仕様: design L221「未解決の確認は member_1、egg、DB path ではなく『○○さん・卵・主菜の…』」、L372。
修正方向: サーバで catalog `displayName` + メンバー表示名スナップショットから本文を組む、または
structured issue + クライアント辞書。履歴・結果・買い物の **3 消費面**を同時に直す。
A-M1 の DB 永続化も同一組み立てに揃えればよい。

## A-I1 [Important] 部分一致の誤検知でリカバリ不能になる

`shared/safety/allergens.ts:150-159`（語境界なしの `includes`）。実測:

| 献立テキスト | alias | 一致 | 被害 |
|---|---|---|---|
| `豆乳スープ` | `乳`（milk） | true | 乳アレルギー家庭で豆乳料理が常に不合格 |
| `鶏もも肉のソテー` | `もも`（peach） | true | もも アレルギーで鶏もも肉が常に不合格 |
| `やわらかになるまで煮る` | `かに`（crab） | true | 一般的な手順文が不合格 |
| `食べやすいから小さく切る` | `いか`（squid） | true | 同上 |
| `コンロのそばで冷ます` | `そば`（buckwheat） | true | 同上 |

再現: `peach` 登録 → AI が `鶏もも肉のソテー` → `direct_allergen_match` → 修理送信は
`{code, path}` のみで語を伝えない（`generation-repair.ts:93-107`）→ AI は同じものを返す →
`fail("invalid_ai_response")` →「献立を正しく確認できませんでした」（`generation-service.ts:225-228`）のみ表示。
**1 操作で外部送信 2 回を消費**するため 12/日・4/600s を数回で使い切る。UI に回避手段が存在しない。

## A-I2 [Important] 食品安全ルール `forbidden` も境界なし部分一致

`shared/safety/food-rules.ts:823-828` / 定義 `shared/safety/current-food-safety-rules.v1.ts:63-78`（`matchTerms:["餅","もち"]`）。
`requires_tag` 側は `doesIngredientMatchTerm` / `hasStructuredSourceTerm` で食材境界を厳密に見るのに、
`forbidden` 側だけが素の `includes` に落ちる。実測 `normalizeFoodText("もちもち食感のうどん").includes("もち")` → true。

再現: 5 歳以下を含む献立で AI が `description:"もちもち食感のうどん"` → `age_shape_rule` で破棄 →
A-I1 と同じ行き止まり。`hard_beans_and_reviewed_nuts_under_6` も「アーモンドは使いません」のような否定文を拾う。

## A-I3 [Important] 「アレルギー未確認」で履歴再検証・緊急献立が HTTP 500（救済コードが到達不能）

- RPC `supabase/migrations/20260716000300_current_safety_snapshot.sql`（`allergy_status in ('none','registered')` で絞り、件数不一致なら `unavailable`）
- `netlify/functions/_shared/current-safety.ts:133`（Zod `refine(v => v !== "unconfirmed")`）、`:191-192`（`HttpError(500,"safety_context_failed")`）
- 呼び出し元: `revalidation-adapter.ts:329,488,616` / `emergency-menus.ts:120`

結果、`revalidation-adapter.ts:339-345` の `allergy_unconfirmed` issue と
`shared/emergency/filter-emergency-menus.ts:150-164` の `current_safety_unavailable` 分岐は**デッドコード**。

再現: 家族設定でアレルギー状態を「未確認」に戻す → 履歴からその献立を開く → `POST /api/menus/:menuId/revalidate`
→ **500 /「現在の安全条件を読み込めませんでした」**。原因も直し方も示されない。`/emergency-menus` も同様。

仕様: design `:314`「候補を表示しない」、`:315`「条件に合う緊急献立がありません と案内する」。
生成経路（`generation-context.ts:143-154`）だけが 422 で正しく閉じており、**経路間で挙動が割れている**。

## A-I4 [Important] 自由記述メモが `menus.safety_snapshot` へ永続化される

`generation-context.ts:408-415`（`requestText: [...mainIngredients, ...avoidIngredients, memo].join("\n")`）→
`:428` → `generation-service.ts:647` → `generation-repository.ts:301`。
`requestText` は `createCurrentSafetyFingerprint` の入力ではなく、**混入させる技術的必然性がない**。

再現: メモに家族の名前など機微情報を書いて生成成功 → `menus.safety_snapshot->>'requestText'` に残存。

仕様: CLAUDE.md「Never log or persist names, emails, allergies, free-form conditions, prompts, or raw AI output」、
design `:479`（safety_snapshot=家族条件 / preference_snapshot=献立希望）の責務分離、`:481`。
※ `preference_snapshot` 側の memo は `:479` の意図された保存先と読める。問題は safety_snapshot への重複混入。

## A-I5 [Important] 自由登録アレルギーが破棄され生成を恒久ブロック

`current-safety.ts:366`（`hasUnmappedCustomAllergy` に潰し、`custom.name`/`custom.aliases` を破棄）→
`generation-context.ts:378`（`throwGenerationFailure("unmapped_custom_allergy")`）。
RPC 側（`20260716000300_current_safety_snapshot.sql`）は name/aliases を返しているのに TS が使わない。

再現: design `:205` の手順どおり自由登録アレルギーを 1 件追加 → そのメンバー対象の生成が**常に 422**。
文言は「確認できませんでした」のみで、唯一の回避策（自由登録の削除）を示さない。

仕様: design `:119`「送信できるのは…確認済み自由登録語」。`generation-prompt.ts:139-160` の
`GenerationPromptDto` に該当フィールドが存在しない。`:118` の「検査可能か」を「常に検査不能」と実装している。

## A-I6 [Important] 修理診断が空振りし外部送信 2 回を無駄に消費

`generation-repair.ts:93-107` / `generation-service.ts:904-915`。`toRepairDiagnostics` は message と path を捨て
code + 固定パスのみに潰す（プライバシー面では正しい判断）。prompt には最初から `allergenIds` と
`requiredSafetyConstraints` が入っているため、同じ情報の再送で直る見込みは低い。
**未確認**: 「診断が code のみ」はコード上確定、「そのため直らない」は論理的帰結であり実測ではない。

## A-I7 [Important] 希望条件（苦手・辛さ・食べやすさ・量）が hard-fail し、設計の「結果内で明示」と矛盾する

- 設計: `docs/archive/superpowers/specs/2026-07-11-kondate-mvp-design.md` §6
  「アレルギーと選択した安全制約は必須、苦手食材・辛さ・希望する食べやすさは希望として区別する。…
  希望条件の未達は結果内で明示する。」必須未達のみ `constraint_conflict`。
- 実装: `shared/safety/validate-generated-menu.ts:414-465` が portion / spice / ease / dislikes を
  `member_preference_mismatch` で **blocking** にし、`generation-service.ts` は修理 1 回の後
  `invalid_ai_response` で終端する。
- 結果 UI: `menu-result.tsx` に希望未達の表示経路が無い（pantry の `unusedReason` のみ soft 経路が存在する）。
- ガイドドプランナー設計は本論点を上書きしていない。Plan 3 テストが hard-fail を固定しているが、
  設計権威との衝突であり「意図的な安全ロック」ではない（二次レビュー CONFIRMED）。

再現: 家族に苦手・辛さなし・食べやすさ等を設定 → AI が安全は満たすが希望表現が正規表現に合わない /
dislike トークンを材料に含む → 外部送信 1〜2 回消費 →「献立を正しく確認できませんでした」のみ。
必須アレルギー・`required_safety_action` は別コードで hard のまま（安全 fail-open ではない）。

修正方向: soft 未達は非 blocking の gap として成功 envelope に載せ結果内で日本語表示。
文脈欠損（preference 行欠落）だけ hard を維持。Plan 3 固定テストを設計に合わせて更新。
**人間判断**: soft gap 実装 vs 設計を hard-fail に改訂。

## A-I8 [Important] SQL 正規の finalize `constraint_conflict` が terminal ログ上は `succeeded` になる

`generation-service.ts` の `succeedOrConflict`（おおよそ `:737-745`）は `repository.succeed` の戻りを見ず、
hydrate 後に常に `emitTerminalLog("info", "succeeded")` する。指紋 / パントリー再検査の SQL 原子経路
（`20260724120000_finalize_fingerprint_constraint_conflict.sql` / `20260724123000_finalize_pantry_recheck.sql`）は
**throw せず** `constraint_conflict` 行を返す。raise→409 経路だけは `conflict()` 経由で `warn` /
`constraint_conflict` を正しくログする。

ユーザー envelope は hydrate により正しい（`generation-service.test.ts` の hydrate テストが status を固定）。
`logGenerationEvent` は ops 用でクォータやプライバシーカウンタを動かさない。被害は成功率・競合率の
ダッシュボード歪みと、race 検知の遅れ。

修正方向: hydrate 後の `status.status` で分岐してログ。既存 hydrate テストに log アサーションを追加。

**第4セッション深掘り（同一 ID・影響境界を精密化）:**
- succeed の戻り値は破棄。hydrate の `status` はクライアントへ返すだけ。
- non-raise の `source_menu_changed` → `failed` も同様に誤って `succeeded` ログしうる。
- `generation-service.test.ts`「hydrates when finalize…constraint_conflict」は status のみ断言し **log 未検証**。
- `scripts/assert-privacy-logs.mjs` は `succeeded` / `constraint_conflict` 双方を許可し、
  **code ↔ 台帳一致は検査しない** → CI で検知不能。
- 影響は ops のみ（UI・quota・保持は正しい）。それでも closed terminal code 契約のため **Important 維持**
  （Minor へ降格しない）。特に allergy-first / current_safety_changed の誤 success ラベルが問題。

## A-I9 [Important] provider 返却後に 50s finalizer abort が無く、成功保存が予算超過し得る

> 第4セッション（深掘り conf 92）。E 領域の「20s×2+2s で 50s 内に収まる」確認は **pre-`markSent` 側**に限定され、
> 本項は post-provider を対象にする。E-U1（プラットフォーム実上限）とは独立の **アプリ自己予算契約**。

設計 §11.4（design `:423-431`）:
- 同期 Function 総予算 50s（auth・reserve・prompt・DB 保存含む）
- 各 `markSent` 前に 20s provider + 2s finalization reserve
- **finalizer も残 deadline で abortし、50 秒後に成功保存を続けない**
- 送信済み attempt は返さない / タイムアウト後の background 保存なし

実装（`generation-service.ts`）:
- `requestStartedAtMonotonicMs` は handler 入口で取得（`generate-menu.ts:36` / `generate-dish.ts:29`）
- pre-send: `remainingMs() < REQUIRED_SEND_BUDGET_MS`（22s）と `timeoutForAttempt` は実装済み
- **post-provider**: `composeCandidate` → materialize / `validateGeneratedMenu` → `succeedOrConflict` に
  `remainingMs()` 再検査も deadline abort も無い

再現シナリオ（pre-send は緑のまま）:
1. auth/reserve/load に数秒
2. 1st attempt 最大 ~20s → invalid → repair 条件成立
3. 2nd attempt 最大 ~20s → wall ~45–48s
4. finalize（行ロック・指紋再検査・複数表 persist）が遅延 → **50s 超過後も `finalize_ai_generation_success` し得る**

A-I11 / A-I12 の巨大応答は返却**後**の CPU を食い本項を増幅するが、通常サイズの二重 attempt 薄窓だけでも成立。
プラットフォーム kill 時は `processing` が最大 **180s**（stale reaper）のまま。`sent_count` は戻さない（設計どおり）。

修正方向: `remainingMs() <= 0`（または小さな floor）なら `repository.fail(requestId, "generation_timeout", null)` し
**succeed を呼ばない**。送信後 fail は SQL 上 unsent のみ解放（sent は維持）。ユニットで
「deadline 超過時 succeed 未呼び出し」を固定。pre-send ゲートは維持。

## A-I10 [Important] `generation_draft_submission_versions` が retention 掃除されず自由入力が死蔵する

> 第4セッション（深掘り conf 94）。A-I4（`menus.safety_snapshot` への memo 混入）とは別経路。
> 同クラス: 以前の `user_feedback` 無期限（`20260726120000` で 30 日掃除追加済み）。

- 表: `private.generation_draft_submission_versions`（memo ≤200、main/avoid 配列、pantry jsonb 等）
  `20260711002000_ai_control_and_quota.sql:59-83` ほか
- insert: `reserve_ai_generation` 内、**active-processing / 枠拒否より前**に
  `INSERT … ON CONFLICT DO NOTHING`（quota deny でも freeze が残る）
- `ai_generation_requests` → freeze の FK に **ON DELETE CASCADE 無し**（request 削除で freeze は残る）
- `run_kondate_maintenance` カテゴリ（base + `20260726120000`）に submission 掃除は無い
  （feedback だけ追加済み）。regeneration snapshots は request CASCADE で消えるとコメントされているが freeze は対象外
- 再読: `get_ai_generation_submission_snapshot` は request join 必須 → 台帳削除後は**孤児ストレージ**
- アカウント削除は `user_id → auth.users CASCADE` で消える

仕様: design §11.2「下書き本文、自由入力、prompt、生AI応答は保持しない」／§12 生成 ledger に自由入力を載せない。
freeze は live 生成の整合用であり、台帳 TTL を超える監査保持の根拠はない。

修正方向: 未参照 freeze を `captured_at` 基準 30 日で batch 削除し maintenance の新カテゴリに載せる。
request_id CASCADE への再設計は multi-request 共有 freeze（ON CONFLICT DO NOTHING）と衝突しうるため別判断。

## A-I11 [Important] OpenRouter 応答本文にバイト上限がなく Function 可用性を脅かす

> 第4セッション（深掘り conf 93）。inbound 8KiB / mock 1MiB との非対称。

`openrouter.ts` は HTTP 200 後に `rawBody = await response.text()`（おおよそ `:180-188`）し、
続いて envelope `JSON.parse` → unbounded `choices`/`content` の Zod → content の二段目 `JSON.parse` →
AI 出力スキーマ。`AbortController` は **時間**（最大 20s）のみで、**サイズは無制限**。

脅威: ユーザーが base URL を触れない（本番 exact / mock exact）ため、敵対・異常・供給網の free provider が
巨大 200 body を返すケース。文字列 + 二重 parse + Zod でピークメモリが膨らみ、Netlify Function の
可用性を落とす。プラットフォーム既定メモリはリポジトリ未記載のため OOM は確度 85 前後だが
Important の可用性リスクとして扱う。

対照: `http.ts` inbound 8KiB / generation parse 65KiB、`tools/openrouter-mock/server.mjs` 受信 1MiB。

修正方向: stream 読取 + 固定上限（推奨 **1MiB**、mock 揃えは人間判断）超過で
`OpenRouterCallError("invalid_ai_response")`（修理適格の invalid 経路へ）。
併せて `responseSchema` に `choices.max(1)` 等。ロック契約の書き換えではなく新規定数。

## A-I12 [Important] AI / 永続メニューの `safetyTags` 配列に `.max()` がなくスキーマが希釈される

> 第4セッション（深掘り conf 91）。**安全判定の証拠には使われない**（design §11.3・`food-rules` は body-bound action）。
> A-I11 の body cap 後も、上限内に大量の合法タグを詰められるため **独立 fix**。

無上限サイト:
- `shared/contracts/ai-generation-output.ts` adaptation / menu `safetyTags`
- `shared/contracts/generation.ts` 同型（永続・validated）
- peer は `safetyActions.max(20)` / `dishes.max(5)` / `labelConfirmations.max(200)` 等
- DB `menu_member_adaptations.safety_tags text[]` に cardinality CHECK 無し

fixture / mock の観測最大長は **3**。Plan 3 転写も max 無し → **N の人間承認**が要る（推奨 **32**）。
コストは copy / JSON / DB 行 / API 応答肥大であり、false-safe ではない。

修正方向: 4 箇所に `.max(N)`、任意で要素長 max と DB CHECK。`menuResponseFormat` / mock 再生成。
ユニットで N+1 拒否。

## A-M1〜A-M5 [Minor]

- **A-M1** 再検証 issue に allergen ID が入ったまま `menu_revalidations.issues` へ永続化（`allergens.ts:163`, `revalidation-adapter.ts:176-181,628-641`）。匿名 ref + 固定カタログ ID のみ。
  **第3**: 利用者表示は **A-C2** として昇格・拡大。本項は永続化レイヤの記録として残す。
- **A-M2** 未知モデル ID 時に `OpenRouterCallError` を modelId 無しで投げ、台帳にモデルが残らず修理で同じモデルを再指名（`generation-service.ts:838-839`）。`openrouter.ts:196-199` が先に弾くため到達は限定的。
- **A-M3** 緊急献立が好み（苦手・量・辛さ）を無視（`filter-emergency-menus.ts:116-123`）。意図的だが体験として未説明。
- **A-M4** 緊急献立で pantry ID が 1 件でも不正だと全 pantry 名を黙って破棄（`emergency-menus.ts:127-131`）。
- **A-M5**（第4）遷移 RPC（`mark_ai_global_sent` / `finalize_ai_generation_*` / `reserve_ai_repair_call` 等）が
  `p_request_id` のみで **owner `p_user_id` 未束縛**。EXECUTE は service_role のみ。ホットパスは
  `reserved.request_id`（サーバ発行）を使いクライアント供給 id ではない。exploit には Functions の
  confused-deputy が別途必要。次回 AI control migration で `WHERE id AND user_id` を足す防御深化。

## A-U1 [未確認]

- **A-U1** `FUNCTION_TOTAL_BUDGET_MS=50000` と Netlify 同期 Function の実上限（E-U1 と同一論点）。
  **第4**: アプリ側 post-provider abort 欠落は **A-I9** として分離確定。本項は**プラットフォーム**が 50s を許すか、
  という未確認のまま残す。
- ~~**A-U2**~~ → **A-C2 に吸収**。`menu_revalidations.issues` の `message` は履歴・結果・買い物 UI で
  表示されることを第3セッションで確認。`age_shape_rule` の英語 `required` も同パイプライン。

## A: 確認して問題なしだった点

`logger.ts` の `createSafeLogger` は許可フィールドのみ、`netlify/**`・`shared/**` に他の `console.*` なし /
`generation-prompt.ts` の外部送信 DTO に PII・DB UUID なし、`< > U+2028 U+2029` をエスケープ /
`materializeAiGeneratedMenu` は AI 出力中の UUID を拒否しラベル確認をサーバー側で上書き /
現行安全条件が過去スナップショットより優先される経路（`revalidation-adapter.ts:329`,
`regeneration-context.ts:530-546`, `20260724120000_...sql:108-127`）/ idea モードの分離 /
「安全である」と断定する文言は 0 件 / `openrouter.ts` は `:free` 以外と `openrouter/auto` を拒否 /
**第4追加**: 応答 `model` の allowlist 再検証、Retry-After 24h clamp、mock ヘッダの local-only、
reserve→`markSent`→HTTP の順序、repair 最大 1 回、枠 5/12/tumbling 4/global 1..45 の原子性、
structured `safetyTags` を安全証拠にしない body-bound action、ブラウザから OpenRouter 非呼び出し、
pending generation の ID/TTL/owner のみ、緊急献立が同一 `validateGeneratedMenu` を使うこと。

---

# 領域 B: 認証・継続・アカウント削除・プライバシー・RLS

## B-C1 [Critical] マジックリンク deposited 画面に「最初からやり直す」が無い

> 第3セッション（UX 二次で Critical 維持・受け入れ条件 L644 の明文ミスとして強化）。

`src/features/auth/auth-callback-page.tsx:90-98`。`kind === "deposited"` のとき h1 + 説明 1 文のみで、
`/login` へのボタン・リンク・TTL 後遷移が無い。

他コールバック分岐との非対称:
- `complete` → returnTo へ navigate
- `awaiting_completion` → TTL 後 `/login`（`unbound_callback`）
- `expired` / `error` → `/login` + エラー state
- **deposited だけ**端末 UI（セッションも作らない設計は正しい）

再現: Chrome で magic link 開始 → Gmail アプリ内 WebView でリンク →「元のブラウザで続けてください」→
元タブを閉じた／どれが元か分からない → **画面上のやり直し手段が無い**。

仕様: design §5 L176「元ブラウザを利用できない場合は…最初からやり直し、WebView 単独で続行させない」、
受け入れ L644「元ブラウザを失った場合も安全にやり直せる」。案内メッセージは実装済み、**再開 CTA が欠落**。

修正制約: WebView 内で session を作らない。continuation を再消費しない。
「最初からやり直す」→ `/login`（replace）で新規 magic link / Google。番号付き手順を併記。
テスト `auth-callback-page.test.tsx` は deposited 文言のみ固定 — 再試行 CTA を要求するよう更新。

## B-I1 [Important] 継続復帰ポーリング(2秒)が claim の IP レート制限(20/60s)を自壊させログイン不能ループを作る

- `src/features/auth/auth-continuation-recovery.ts:44`（`setInterval(..., 2_000)`）
- `netlify/functions/auth-continuation-claim.ts:100`（`windowLimit:20, windowSize:60, aggregateBy:["ip"]`）
- `src/features/auth/auth-gateway.ts:226-241`（claim 失敗時のフロー破棄条件）

2 秒間隔＝30 回/分に対し上限 20 回/60 秒。**未完了フローが 1 本残るだけで約 40 秒で IP バケットが枯渇**する。
`auth-gateway.ts:226-241` は `claimed === true` のときだけ `clearAuthFlow` するため、404（正常な待機）かつ
callback-owner マーカ無しではフローが TTL 300 秒フル残存し、ポーリングも 300 秒続く。

再現: 「Googleで続ける」→ Google 側で操作をやめ `/auth/callback` を通らずに復帰 → 40 秒で 429 →
`resumeFlow` は 429 を awaiting と判定しない（B-I4）ため毎回 error でフローが消えない → 再ログインの claim も
429 → `unbound_callback` → 新フローがまた残る。**数分続く「何度やってもログインできない」状態。**
CGNAT/共有 IP では他の利用者も巻き添え。

仕様 §644「キャンセル・元ブラウザ喪失でも安全にやり直せる」に反する。20/60s は Locked 値のため
**修正はクライアントのポーリング間隔と失敗時のフロー破棄条件側**（値の変更は人間の確認が要る）。
**未確認**: 超過時ステータスが 429 であることはプラットフォーム挙動でリポジトリ内テストに固定されていない。

## B-I2 [Important] claim 失敗時に code / continuation を消去していない（仕様の明文と矛盾）

`supabase/migrations/20260711000330_auth_continuations.sql:104-115`（失敗経路は副作用ゼロで `return`）。
テストが現行挙動側を固定: `supabase/tests/database/004_auth_continuations.test.sql:56-76`。

仕様 §177「成功・**失敗**後はcodeとcontinuationを消去する」／§475「claim成功・**失敗**・期限切れ時にcodeを消去する」。
実装は成功時と期限切れ時のみ。secret は 256bit（`^[A-Za-z0-9_-]{43}$`）で総当たりは非現実的なため Critical ではないが、
**仕様が DoS を承知で厳格側を選んだ箇所を黙って緩めている**。人間の確認が要る。

## B-I3 [Important] returnTo 無害化が経路によって不揃い（path collapse で open redirect を二次確認）

- `src/features/auth/auth-provider.tsx:74` — ガードが `startsWith("/")` のみ（`//…` を通す）
- `src/features/auth/auth-gateway.ts:220-225` — サーバ由来 returnTo を `sanitizeReturnPath` に通さず返す
- `src/features/auth/auth-callback-page.tsx:45` — 同じく生値
- 対比: `auth-continuation-completion.ts:23,38,49` は読み書き両方で無害化済み

サーバ受け入れ規則 `z.string().regex(/^\/[^/]/u)` と DB 制約 `check (return_to ~ '^/[^/]')` は
先頭 `//` は弾くが **未正規化の `..//` を通す**。

**第2セッション二次レビュー（CONFIRMED）**: 第1で「悪用経路は未確認」としていたが、
`sanitizeReturnPath` 自身が path collapse 後に protocol-relative を**出力しうる**ことが確定した。

| 入力 | sanitize 結果 | 備考 |
|---|---|---|
| `//evil.example` | `/planner` | 既存ユニットでカバー |
| `/\evil.example` | `/planner` | WHATWG で origin が変わり拒否（一次の backslash 単独仮説は不成立） |
| **`/planner/..//evil.example`** | **`//evil.example`** | 同一 origin のまま pathname が `//…` になる |
| `/x/..//evil.example` 等 | 同上クラス | 空セグメント + `..` の組み合わせ |

再現（ログイン済み）:

1. `/privacy?returnTo=/planner/..//evil.example` → 同意または「今はAIを使わない」→ `navigate("//evil.example")`
2. `/login?returnTo=/planner/..//evil.example` → 認証済みなら `<Navigate to="//evil.example" />`
3. recovery の `location.assign` + `startsWith("/")` は、既に `//…` になった値を off-origin へ送れる

completion listener は二重 sanitize で `//` 入力を `/planner` に落とすため一部経路は救われるが、
login / privacy の一回 sanitize と recovery の弱いガードは残る。`createAuthFlow` 経由で collapse 済み
`//…` を create API に送るとサーバが拒否するが、クライアントだけの `navigate`/`Navigate` は API を経由しない。

修正方向（1 行では足りない）:

1. URL 正規化**後**の pathname が `/^\/[^/]/` を満たすこと（`//` 先頭・`\`・危険な `..` を拒否）
2. claim / recovery / すべての `location.assign`・`navigate` 直前で再 sanitize
3. Function + DB 側も post-normalize 規則に揃える

## B-I4 [Important] `resumeFlow` が 404 以外の失敗をすべて terminal error に潰す

`src/features/auth/auth-gateway.ts:228-240`。`awaiting_completion` への分岐が
`error.status === 404` に限定され、429 / 5xx / ネットワーク例外はすべて `kind:"error"` → `/login` へ
`authError:"unbound_callback"`。

再現: WebView で magic link を開き code を deposit → 元ブラウザのタブが待機中 → claim が 429（B-I1 由来）→
待機タブが `/login` に落ち `clearAuthFlow`（`auth-callback-page.tsx:71,77`）で **secret ごとフローを破棄**。
サーバ側に有効な code が残っているが回収する secret がもう存在しない（300 秒待つ以外に手段なし）。

仕様 §176 / §644。修正方向: 5xx / 429 / ネットワーク例外は「保留（リトライ可）」、404 と明示的認証失敗だけを terminal に。

## B-I5 [Important] 未ログインの裸 `/` が `returnTo=/planner` になり、初回 `/welcome` をスキップする

- `auth-flow.ts:39-44` — `sanitizeReturnPath("/")` は `/^\/[^/]/` に合わず **`"/planner"` を返す**
  （コメントは「`/` は planner への Navigate のみ」とあるが、HEAD では `/` は `RootEntryPage`）
- `protected-routes.tsx:11-13` — 未認証時に常に現在 path を `returnTo` 化
- `login-page.tsx:34-35` — `returnTo` **省略時のみ** `/welcome`。正規化済み `/planner` が来るとそちらが勝つ
- `root-entry-page.tsx` — status 分岐（`not_started|in_progress` → `/welcome`）は**認証済みで `/` に着地したときだけ**
- `auth-flow.test.ts:41-44` が `"/"` → `"/planner"` を固定
- `e2e/fixtures/auth.ts:39-45` が magic-link 後に `/planner` 着地することを明記し、welcome 検証のため
  **手動で `goto("/")` する回避**を入れている

再現: セッション無しで `/` を開く → `/login?returnTo=%2Fplanner` → Google / magic link 完了 →
`onboarding_status` が `not_started` のまま `/planner`。設計上の初回画面（「献立アイデアを考える」/
「家族情報を登録する」）を見ない。

仕様: ガイドドプランナー §5.1 / §7.2（`/` は status で `/welcome` または `/planner` に分岐。開始画面は `/welcome`）。
認可バイパスではないが、新規ユーザーの一次導線が壊れている。

修正方向: 未ログインの裸 `/` を continuation 安全なまま RootEntry に戻す（例: `returnTo` に `/` を通せるよう
Function/DB 契約と sanitize を揃える、または RequireSession が root のときだけ post-auth 用エントリへマップ）。
`complete|skipped` ユーザーを誤って常時 `/welcome` に送らないこと。ユニット・e2e の「`/` → planner」ロックを更新。

**人間判断**: ブックマーク `/` の復帰ユーザーを常に RootEntry にするか、深いリンク優先か。

## B-I6 [Important] ウィンドウ focus 時の `getSession` エラーでセッションを強制クリアする

`src/features/auth/auth-provider.tsx:44-47,56-57`:

```ts
const { data, error } = await client.auth.getSession();
setSession(error === null ? data.session : null);
// focus のたびに refreshSession
```

`error !== null` なら直前の認証済み `session` を捨てる。`RequireSession` は `session === null` で
`/login?returnTo=…` へ硬リダイレクトする。`onAuthStateChange` の SIGNED_OUT と、ソフトな getSession 失敗が
区別されていない。ユニットは focus 成功パスのみ（`auth-provider.test.tsx:31-56`）。

再現: ログイン状態で `getSession` が一時エラーを返す状況を作る → `window` に `focus` → ログイン画面へ。
モバイルのアプリ切替で focus が頻繁に飛ぶ前提だと、不安定通信ユーザーを直撃する。

修正方向: getSession **エラー時は直前 session を保持**（必要なら再試行バナー）。
クリアは `error === null && session === null`、または SIGNED_OUT など確定サインアウト時のみ。

## B-I7 [Important] プライバシー説明文が `member_1` / データベース ID / 運用者用語で書かれている

> 第3セッション。OpenRouter **名そのものの削除は設計 L632 と衝突**（二次で確認）。問題は平易さ。

`src/features/privacy/privacy-copy.ts:1-17` / `privacy-notice-page.tsx`。
本文に `member_1のような呼び方`、`データベースID`、`未検証のAI生回答`、`OpenRouter`、`フォールバック`。
§10.3 L359 / L631 は「平易な 3 項目」。L632 は OpenRouter とフォールバックの**説明義務**（削除不可）。
L221 の内部 ref 禁止は主に安全確認 UI だが、初回同意画面で `member_1` を教えるのも主婦ペルソナに不適切。

修正方向: 「『家族1』のような仮の番号」「内部の会員番号は送らない」「AI が返したそのままの文章は保存しない」。
OpenRouter は残しつつ括弧最小限 or 補足。consent RPC / version key は触らない（文言のみ）。

## B-I8 [Important] マジックリンク期限切れが送信済み画面に戻らずメール再入力を強いる

> 第3セッション。

`auth-callback-page.tsx:70-75` → `/login` + `authError: magic_link_expired`。
`login-page.tsx` は常に idle フォーム（`:168-221`）。`MagicLinkState` に `{ status: "expired"; email }`
（`magic-link-state.ts:7`）があるが **LoginPage は未使用**。送信済みカード（宛先・再送待ち・変更・Google）に復元されない。

仕様: L174 送信後は同一画面で状態・再送・変更・Google、L644 期限切れでも安全にやり直せる。
Google 切替は同一エラーカード上にある（部分適合）。メール prefill と re-sent 文脈が欠ける。

## B-I9 [Important] マジックリンク「送信済み」UI がリロードで消え再送カウントを失う

> 第3セッション。

`login-page.tsx` の `MagicLinkState` はコンポーネント state のみ。auth flow は localStorage に残り得るが
**sent UI は rehydrate しない**。不安定回線でリロード → 送ったか分からない・再送連打・Google 並行試行。

修正方向: 短寿命 sessionStorage（email, resendAvailableAt）+ 明示「キャンセルしてやり直す」。秘密は載せない。

## B-I10 [Important] プライバシー「今はAIを使わない」後に緊急献立への操作導線が無い

> 第3セッション。二次でやや強化（`/privacy` は AppShell 外で下部ナビも無い）。

`privacy-notice-page.tsx:98-101` — 文面「緊急献立は利用できます」のみ、`/emergency-menus` への button/link なし。
`onSkip` は `navigate(returnTo)` のみ。ガイドド L83「緊急献立への既存導線は維持」、MVP L633。
タブに「緊急」項目が無いため、シェル外プライバシー画面では発見不能に近い。

修正方向: 副ボタン「AIなしの緊急献立を見る」→ `/emergency-menus`。同意は付けない。
idea 下書き時は C-I6 の誤文言に接続しうる点に注意。

## B-M1〜B-M9 [Minor]

- **B-M1** secret 比較が定数時間でない（`20260711000330_...sql:106`）。入力が 256bit ランダムのため実用上悪用不可。
- **B-M2** ログアウトが `signOut({scope:"local"})`（`src/features/auth/auth-cleanup.ts:14`）でサーバ側リフレッシュトークンが有効なまま。意図的だが削除経路と非対称。`global` 優先 + 失敗時 local フォールバックが安全。
- **B-M3** `netlify/functions/_shared/auth.ts:15-19` が `data.user` の null 未チェック。401 であるべき応答が 500 になる（認可バイパスではない）。
- **B-M4** 30 日スイープが 250 行/カテゴリ/時 固定（`netlify/functions/maintenance-cleanup.ts:35` + `@hourly`）。6,000 行/日/カテゴリ超で 30 日超の行が残り続ける。`shopping_mutations` と `user_feedback` は利用者数に比例するため監視項目。
- **B-M5** `user_feedback` が設計仕様書に無い後付けテーブル（`20260725120000_user_feedback.sql`）。実装上の取り扱い（RLS deny_all・service_role のみ・30 日保持・本文非ログ）は適切だが、**仕様書に載っていない PII 保管先が 1 つ増えている**点は人間の確認が要る。
- **B-M6** `rls_inventory.test.sql:288` が `kondate_maintenance_executor` を検査対象に含めない。現状の権限は健全と個別確認済み。
- **B-M7** アカウント削除の不変条件が `user_id` 列を持つテーブル限定（`20260724075916_account_deletion.sql` と `account_deletion.test.sql`）。期待テーブル一覧が手書きで 2 箇所更新が要る。現時点の漏れはなし。
- **B-M8** `completeCallback` が state 照合前に deposit を投げる／`error_code` だけで期限切れ扱い（`auth-gateway.ts:157,170-177`）。サーバ側 state hash 不一致で 404 になるため実害は UI 撹乱のみ。
- **B-M9**（第3）ログイン／callback の「認証」「認証情報」が IT 用語（`login-page.tsx:130`, `auth-callback-page.tsx:95`）。「ログインの確認」「ログイン用の情報」へ。

## B: 確認して問題なしだった点

全 Function の userId は Bearer 由来で body の user_id は不使用（`delete-account.ts:18,26,28` ほか全本追跡）/
`getSupabaseAdmin()` 経路は必ず `p_user_id` か `.eq("user_id", userId)` を伴う /
member 系は複合 FK `(member_id, user_id)` で越境不可 / `rls_inventory.test.sql` が grant・policy を
双方向差分で固定し PUBLIC EXECUTE 残りも捕捉 / AES-GCM は毎回ランダム IV + AAD 束縛 + 32byte 鍵検証 /
single-use は `for update` + `check (claimed_at is null or encrypted_code is null)` /
300s TTL は DB・Function・ブラウザの三点で強制 / token fragment 拒否 / safeLog は許可フィールドのみ /
`VITE_` 秘密は存在自体を拒否 / CSRF は Bearer 方式 + `requireOrigin` で不成立 /
削除後の残存トークンは GoTrue 検証と FK で無害化。

---

# 領域 C: ガイド付きプランナー・世帯設定・オンボーディング UX

主基準: `docs/archive/superpowers/specs/2026-07-22-guided-planner-optional-household-design.md`

## C-C1 [Critical] `/onboarding` に離脱導線が 1 つもない

`src/app/router.tsx:43-50`, `src/features/household/household-onboarding-page.tsx:67-75,214-248,250-465`。
ページ内の `navigate` は `:75`（完了成功後の `/planner`）1 箇所のみ。戻るリンク・スキップボタンは存在せず、
`/onboarding` は router 上 **`AppShell` の外**（`router.tsx:43`）なので下部ナビも出ない。
主 CTA は `disabled={!canComplete}`（`:428`）で 3 項目すべて答えるまで押せない。

再現: 初回ログイン → `/welcome` →「家族情報を登録する」（`welcome-route-page.tsx:49-54` が `in_progress` を書く）
→ `/onboarding` → 「アレルギーまで登録したくない」と思っても**押せる離脱操作が画面上に存在しない**。
逃げ道はブラウザバックか URL 手入力のみ（standalone 表示ではバック UI すら無いことがある）。

仕様: §3.2「家族を1人も登録していない利用者が、ログインから献立生成と結果確認まで完了できる」、§5.1-3。
§8.1 は `in_progress → skipped` を**許可遷移として明記**しているが、`setOnboardingStatus(...,"skipped")` の
呼び出しは `welcome-route-page.tsx:45` と `planner-route.tsx:656` の 2 箇所だけで、どちらも `/onboarding` から到達できない。

**第3セッション（CONFIRMED Critical、表現のみ限定）:**
- 技術的出口は存在する: Welcome からの `navigate` が replace でないため戻る→Welcome 二択、未ガードの `/planner`、
  `/` → Welcome。**ページ内 CTA の欠如**が Critical の核（低 IT・standalone）。
- `HouseholdOnboardingApi.setProgress` が `"in_progress"|"complete"` のみで **skipped を呼べない**型になっている。
- テスト `household-onboarding-page.test.tsx:499` が旧「残りはあとで設定して完了」の**非表示を固定**。
- リロード / `returnTo=/onboarding` で履歴に Welcome が無いと戻る出口も消える。
- 修正: 両段階に「あとで」/「設定せずアイデア」→ `skipped` または Welcome。RPC 遷移だけ使う。

## C-C2 [Critical] 生成をブロックするエラーの「直す操作」が折り畳まれた `<details>` 内に隠れている

`src/features/planner/components/review-step.tsx:265`（`<details className="wizard-details">` — `open` 属性なし）,
`:144-152,391-394,373-388`。

`hasUnavailablePantrySelections`（`:145-147`）と `medicalBlocked`（`:149-150`）は `generateDisabled`（`:152`）に入る。
エラー文は `<details>` の**外**（`:391-394`）だが、直す入力（`pantry-selector.tsx:136-149` の解除ボタン、
`review-step.tsx:355-367` の自由メモ）は**すべて内側**（`:265-390`）。`details` は既定で閉じている。

ケース A: 別端末で冷蔵庫から食材を削除 → 確認画面で赤字「解除してから献立を作ってください」＋ CTA グレーアウト →
**解除ボタンが見えない**。エラー文はどこで解除するかを示さない。
ケース B: 自由メモの医療・治療食判定も同様にメモ欄が閉じた中にある。

さらに `timeLimitMinutes`/`budgetPreference`/`avoidIngredients`/`memo`/`pantrySelections` の field error 表示
（`:293,324,350,368,384`）もすべて `<details>` 内。submit で `planner-route.tsx:561` が `setStep("review")` しても
review は既にマウント済みで `<details>` は閉じたまま、かつ `:558` は field error があるとき上部 alert を出さない設計。
**エラーが上にも下にも一切出ず、ボタンが無反応に見える。**

仕様: §11「画面上部のalertだけに依存しない」「submit時のfocus順は review 内を
`timeLimitMinutes → budgetPreference → avoidIngredients → memo → pantrySelections`」（折り畳み内は focus 不可）。

## C-I1 [Important] 仕様指定の共通 UI 部品 4/5 が本番未使用

`src/shared/ui/wizard/{wizard-frame,progress-indicator,choice-card,review-row}.tsx` — 本番参照 0 件
（`InlineNotice` のみ history-detail / menu-result で使用）。実ステップは
`meal-step.tsx:33`, `ingredient-step.tsx:105`, `cuisine-step.tsx`, `audience-step.tsx:97`, `review-step.tsx:163` が
生の `<section className="card stack">` + `<h2>` で自前実装。

結果:
- **全 5 画面に「質問 N / 5」も進捗バーも無い**（`ProgressIndicator` は `role="progressbar"` 実装済みだが描画先が無い）。
- `/planner` 配下に **`<h1>` が存在しない** → `app-shell.tsx:120-132` のルート遷移時 h1 フォーカス契約が毎回空振り。見出し階層も `h2` 群だけになる。
- §6.3 の明朝質問見出し未達（`--question-font` の適用先は未使用の `.wizard-title`＝`styles.css:445` ほか、実ステップの `<h2>` は `.page-frame h2`＝`:795` でゴシック）。
- §6.3 の 150〜200ms 遷移未達（`.wizard-transition`＝`styles.css:612` は `WizardFrame` 専用で未使用、ステップ切替は瞬間置換）。

仕様: §6.4, §3.2, §11, §6.3。

**第3セッション:** UX 一次は ProgressIndicator 未使用を Critical としたが、**二次で Important に格下げ**（死路ではなく認知負荷）。
見出し「1. 食事」…「5. 確認」は部分的な位置表示。本項 C-I1 に吸収し、Critical 新規 ID は採番しない。

## C-I2 [Important] ウィザード周辺リンクが `<a href>` で SPA を破棄する

`audience-step.tsx:151`, `current-safety-summary.tsx:15`, `emergency-menu-page.tsx:175,192,199,224`。
同リポジトリの history/menu-result は `import { Link } from "react-router"` を使っているのにここだけ素の `<a href>`。
`use-draft-autosave.ts:155-159` の debounce は 600ms、`:169-180` の unmount flush は React cleanup 依存で、
ドキュメント遷移では走らない。

再現: 「3. ジャンル」で和食を選んで 0.3 秒後に「家族を追加する」をタップ → `/settings` へフルリロード →
**debounce 中の保存が飛ぶ** → 家族追加後も `/planner` へ戻る `returnTo` が無い。
`emergency-menu-page.tsx:199` の「家族設定へ（任意）」は C-C1 の袋小路へ送る。

仕様: §5.1（privacy 往復は `planner-route.tsx:402-421` で `flushDraft()` 済みなのに家族設定往復だけ非対称）、§5.2。

## C-I3 [Important] アイデアモード選択中も「現在の家族・安全条件」が表示され続ける

`src/features/planner/components/audience-step.tsx:101` —
`{eligibleMembers.length > 0 && <CurrentSafetySummary members={eligibleMembers} />}` に `value.targetMode` 条件が無い。
`review-step.tsx:158-161,167` は `targetMode === "household"` のときだけ出す正しい実装で、**同一画面群で判断が割れている**。

再現: 家族 2 人登録済み → 「4. 作る相手」で「人数だけ指定してアイデアを見る」を選ぶ → それでも上部に
家族名・年齢帯・アレルギー・安全条件が全員分表示されたまま（`current-safety-summary.tsx:5-13`）。
利用者は「アイデアモードでも家族のアレルギーは見てくれている」と読むが、サーバー側は一切読まない（設計 §9.3）。
**誤認が最も危険な側（安全だと思わせる側）に倒れている。**

仕様: §3.1, §3.2「アイデアモードを家族向け安全確認済みと表示しない」, §5.4。

## C-I4 [Important] 新規下書きが「家族モード・全員選択」で自動的に埋まる

`src/features/planner/planner-route.tsx:82-95`（`sanitizeDraft(null, ...)`）。
`targetMode: targetMemberIds.length > 0 ? "household" : null` がそのまま `setValue`（`:284`）され、
以降どの入力変更でも `useDraftAutosave` が `targetMode:"household"` + 全メンバー ID を DB 下書きへ書く。

再現: 家族 3 人登録済み・下書き無しで `/planner` → 「1. 食事」で夕食を選んだ時点で autosave が household + 3 人を保存
（利用者はまだ対象質問を見ていない）→ 「4. 作る相手」に着くと既に回答済み・「次へ」が有効 →
流し読みで進むと家族の年齢帯・アレルギー・好みが AI へ送られる。

仕様: §5.2「選んだ場合は…」、§8.3「質問途中の下書きはモードと人数を**未選択状態として保存する**」。

## C-I5 [Important] メイン食材の自由入力が「追加」を押さないと消える／Enter でも確定しない

`ingredient-step.tsx:42,161-198,253-268`。入力値はローカル `useState`（`:42`）のみで、親への通知は
`tryAddIngredient` → `onChange`（`:84`）だけ。`<input>`（`:164-180`）に `onKeyDown`/`form`/`onSubmit` は無い。

再現: 「合いびき肉」をタイプ → スマホの確定キー → **何も起きない** → 入力欄に文字が残っているので入ったと判断 →
「次へ」→ `value.length === 0` で「メイン食材を選んでください」ダイアログ（`:258-261,269-304`）。
**画面に自分の入力が見えているのに「選んでください」と言われる。** 戻る操作でローカル state は消える。

副次: `tryAddIngredient` は重複・空を `"duplicate_or_empty"` で返すが**フィードバックが一切無い**（`:77-79`, `:186-194`）。

## C-I6 [Important] 緊急献立の空状態コピーが事実と違うことを言う

`emergency-menu-page.tsx:111-121,134-141,183-202`。`shouldLoadHouseholdTargets` は `targetMode !== "idea"`（`:114`）。
idea 下書きでは家族一覧を読まないので `hasEligibleHouseholdMembers === false` → `:190-201` の固定文言
「**対象の家族が登録されていないため**、緊急献立を表示できません。家族設定は任意です。」

`hasEligibleHouseholdMembers` は変数名に反し **mode/filter 後の target 集合が空か** であり、
名簿に家族がいるかではない（`:141`）。候補 API を打たない fail-closed 自体は正しい。

再現:

1. 家族 3 人登録済みで idea 下書き → 緊急献立 →「家族が登録されていない」+ `/onboarding`（真因は idea）
2. アレルギー「未確認」や対象外のみ → 適格 0 → 同じ文言（名簿はある）
3. household 選択 ID がすべて不適格にフィルタされ、他に適格メンバーがいてもバックフィルしない → 同じ文言
   （テスト `emergency-menu-page.test.tsx:389-426` が同一 substring を固定）

仕様: MVP §9.3（未確認等では候補を出さない・空は正直に）/ ガイドド § は idea・下書きなしを
「家族不在 empty」と書けるが、**登録済みだが未完了・選択フィルタ**まで「未登録」と言う根拠はない。
確認画面側は `review-step.tsx:534-538` で正しい理由を言えている。
併記の「家族設定へ（任意）」は C-C1 の袋小路へ送る。

**第2セッション二次**: 同一欠陥を Hist-F1 として CONFIRMED。idea 文言は設計に一部根拠があるが、
未確認アレルギー / フィルタ経路は誤表示として Important 維持。新規 ID は採番せず本項に吸収。

**第3セッション二次（CONFIRMED、severity面を強化）:**
- 製品ルール「緊急は対象家族必須」自体は §9.3 / ガイドド §7 で正しい。**嘘の帰属**が欠陥。
- `generation-status-panel.tsx` の `RecoveryLinks`（`:70-78`）が **targetMode を見ず常に**「15分緊急献立を見る」を出す。
  review-step は idea 時に切替案内のみ（正しい）— **同一ジャーニーで失敗パスだけ悪い**。
- UX 二次は「誤帰属 + 無条件 CTA」を Critical 級の信頼破壊と判定。本ファイルでは ID を変えず
  **C-I6 のまま拡充**（着手順では C-C1 直後に扱う）。idea 以外に候補を出すべき、という直し方は設計と衝突するため却下。
- テスト `emergency-menu-page.test.tsx` が idea → 未登録 substring を固定（修正時に書き換え必須）。

修正方向: 原因分岐 — (1) idea → モード説明 + `/planner` (2) メンバーはいるが適格 0 → アレルギー/対象外完了導線
(3) 選択だけ全滅 → 対象の見直し (4) 真の 0 人 → 現行文言。失敗パネルの RecoveryLinks も mode 対応。

## C-I7 [Important] submit 後の field error focus が仕様順に実装されていない

`planner-route.tsx:549-562`（`firstInvalidStep` で `setStep()` するだけ。`firstInvalidField` は
`model/planner-wizard.ts:133-138` が返しているのに route 側で未使用）,
`audience-step.tsx:46-48,89-95`（`servingsSelectRef` focus は「次へ」経路のみ）, `review-step.tsx:133-135`（見出しのみ）。

再現: 別タブで対象家族を「未確認」に戻す → `planner-route.tsx:302-319` が `targetMode` を null に戻す →
「献立を作る」→ `setStep("audience")` → focus は見出しに飛び、エラーのある `targetMode` ラジオには飛ばない。
review 内 field error は C-C2 のとおり見えない。

仕様: §11「対象質問内を `targetMode → targetMemberIds → servings`、review 内を（略）」。

## C-I8 [Important] `.wizard-chip` に折返しガードが無く 320px で横スクロールが出得る

`src/styles.css:250-258`。`.wizard-chip` は `max-width:100%` も `overflow-wrap:anywhere` も `min-width:0` も持たない。
同ファイルの兄弟クラスは全部持っている（`.wizard-option`＝`:198-210`、`.wizard-option-meta/-description`＝`:231-235`、
`.wizard-title` 系＝`:453-461`）。`.wizard-chip-row` は `flex-wrap:wrap`（`:243-248`）だが flex item の既定
`min-width:auto` は min-content 幅までしか縮まない。食材の自由入力は 80 文字まで許可（`ingredient-step.tsx:13`）。

再現: 320px 幅で区切りの無い長い文字列を 40〜80 文字入れて「追加」→ チップ「〈長い文字列〉を外す」が
`.card`（padding 20px×2）内 248px を超えて溢れる → **ページ全体が横スクロール。**

仕様: §3.2, §11「320px幅と200%拡大で横スクロールを発生させない」。

## C-I9 [Important] 下書き autosave の失敗・成功が画面に出ず、再試行 UI も無い

- `use-draft-autosave.ts` — 非競合エラーで `setState("error")`、成功で `"saved"`
- `planner-route.tsx:480-481` — `autosave.state` は **`"saving"` のときだけ** `isSaving` に使い、
  `"error"` / `"saved"` は未参照。wizard へ状態も渡さない
- 競合時だけ `DraftConflictChrome`（再試行あり）。世帯オンボーディングは 保存中/保存済み/失敗 を出す

生成 submit / privacy 往復 / 緊急献立遷移前の **flush 失敗**は別メッセージになる（二次確認済み）が、
編集中の debounce 保存失敗は沈黙のまま。ガイドド §10「自動保存に失敗した場合は…再試行できる状態を表示」、
MVP §7.2「保存中、保存済み、保存失敗を画面に短く表示」に未達。flush だけでは本項を閉じない。

再現: `/planner` で回答を変える → `savePlannerDraft` を通信断などで失敗させる → 操作は再び有効になるが
保存失敗表示なし → 再読込で直前の食事/食材/対象が消える。

修正方向: `autosave.state` を wizard に渡し短く表示。`error` 時は `flush` 再試行 CTA。

**第3セッション:** UX I-G1 と同一。`saving` 中の操作 disabled に理由表示も無い点を再確認。新規 ID なし。

## C-I10 [Important] 選択中の家族が利用不可になっても対象ステップへ戻さない

`planner-route.tsx:302-318` の live sanitize は適格 ID で filter し、0 件なら `targetMode: null` にするが
**`setStep("audience")` しない**。初期ロード時だけ `firstIncompletePlannerStep` で step を決める（`:290-295`）。
idea へ自動降格しない点と緊急遷移中止は守っている。

再現: household で確認画面まで進む → 別タブで選択メンバーを削除 / アレルギー未確認 / 対象外にする →
effect が ID を削る（または mode null）→ **画面は review のまま**「未選択」や人数減が黙って起き、
生成ボタンを押すまで原因に気付きにくい。

仕様: ガイドド §10「家族モードで選択した家族が削除、未完了、利用不可になった場合は対象ステップへ戻す」。
C-I7 は submit 後 focus 順の話で、**live 変更時に step 自体が戻らない**点が本項。

修正方向: 選択 ID が減った・mode が null になったら `setStep("audience")` + 必要なら理由 alert。
食事/食材/ジャンルの回答は保持。

## C-I11 [Important] 安全要約が禁止文言「登録アレルギーあり」に落ちうる

MVP §7.1: 「『登録アレルギーあり』のような件数・有無だけの要約にしない。」

`planner-route.tsx:145-152` の `allergyLabel` 構築（`memberSafetyText` は結合のみ）:

| `allergy_status` | 名前解決 | 表示 |
|---|---|---|
| `none` | — | アレルギーなし |
| `unconfirmed` | 0 | アレルギー未確認（禁止文言ではない） |
| `registered` | >0 | 具体名 |
| **`registered`** | **0** | **登録アレルギーあり** |

`registered` + 名前 0 は主に標準 `allergen_id` のカタログ miss（client Map に無い）。
custom confirmed は DB CHECK で通常名前あり。設定画面の allergy editor は「名前を表示できない項目」と
より良い残余を使う。対象選択 UI では名前解決失敗でも `blockedReason` にせず**選択可能なまま**
存在のみラベルになりうる。

修正方向: 禁止コピーを削除。行単位で「名前を表示できない項目」等へ。可能なら unresolved は
選択不可 / 安全クエリ error 扱いで fail-closed。

## C-I12 [Important] 確認画面の「本日あとN回」が成功残だけ・0 回でも主 CTA が有効

> 第3セッション。再生成シート側の同型は **D-I14**。本項は **planner review の生成前**。

`planner-route.tsx:488-492` が `usageRemaining = success.remaining` と short-window `retryAt`（残 0 のときのみ）を渡し、
`review-step.tsx:419-430` は「本日あとN回作成できます」+ 任意の 10 分窓メッセージ。
attempt 残・global 可否・「AI への問い合わせ」系の平易説明が無い。
`generateDisabled`（`:152`）に `usageRemaining === 0` が含まれず、0 回表示でも主ボタンが有効に見える。

仕様: §10.3 — 成功残に加え外部 call attempt の受付可否・短期再開時刻も平易に。
生成後の status panel は dual residual を出す（用語は C-I13）— 生成**前**だけ薄い。

## C-I13 [Important] 生成失敗・処理中の文言が成功枠と問い合わせ枠を分けず、「作成ID」と運用用語を出す

> 第3セッション。

- 失敗: `generation-status-panel.tsx:150,166` は `!quota.consumed` のときだけ「成功回数には含まれません」。
  attempt 消費時の「AI への問い合わせは使った」ペアが無い。設計 §14 混雑時は両方を明示。
- 残数ラベル: 「AI通信試行」「アプリ全体」（`:35-37`）— 主婦向けでない。
- 処理中/オフライン: 「同じ**作成ID**で…」（`:130,139`）と書くが UUID は表示しない → コードを探してしまう。
  §10.3 の「生成 ID にもとづく状態」は内部追跡で足り、利用者向け ID 語は不要。

修正方向: 成功/問い合わせの二文、JST 再開時刻、作成ID 語を「戻っても続きから確認します」へ。

## C-I14 [Important] 緊急献立オープン前の flush 失敗が「生成を開始しませんでした」と言う

> 第3セッション。**テストが誤文言を固定**。

`planner-route.tsx:443-447` — 緊急遷移前の保存失敗で生成 flush と**同じ文字列**。
`planner-route-conflict.test.tsx:338-352` が「生成と同じ保存エラー」を要求。

再現: 「AIを使わない緊急献立を見る」→ 保存失敗 → 生成していないのに生成失敗文。

修正方向: 「条件を保存できなかったため、緊急献立を開けませんでした…」+ テスト更新。

## C-I15 [Important] 献立結果の冷蔵庫利用に「使用料理」が無く、クライアントは `dishIds` を既に持つ

> 第3セッション。緊急 UI には「使用先」あり。

`src/features/generation/api/menu-result-api.ts:234` が `pantryUsage[].dishIds` を構築済み。
`src/features/generation/components/menu-result.tsx:517-541` は name / planned / inventory / shortage のみ。
緊急: `emergency-menu-page.tsx:372-381` が料理名で 使用先 を出す。

仕様: §10.3 各冷蔵庫食材の**使用料理**と予定量。安い表示ギャップ。

## C-M1〜C-M8 [Minor]

- **C-M1** 7〜20 人分が `<select>`（仕様 §5.2 は数値入力）、空値ラベルが `選ばない`（`audience-step.tsx:230-250`）だが idea モードで人数は必須。
- **C-M2** `pantry-selector.tsx:88` の `<h2>` が `review-step.tsx:164` の `<h2>` と同レベル。`h3` が適切。
- **C-M3** `PantrySelector` が `.card` を入れ子で描画（`pantry-selector.tsx:87` in `review-step.tsx:268`）。320px で内側幅が 248→208px まで痩せる。
- **C-M4** `app-shell.tsx:12-21,24-31` の `sectionForPath` に `/emergency-menus` の分岐が無く上部バーが「こんだて日和」になる。下部ナビにも該当なし。
  **第3:** `/menus/:id` でも下部ナビ active が付かない点は **D-I19**。
- **C-M5** 「次へ」の空入力ガードがステップごとに違う（`ingredient-step.tsx:256-261` だけ有効のままダイアログ、他は disabled）。押せない理由が meal/cuisine/audience では示されない。
- **C-M6** `/welcome` のエラー状態だけ再試行ボタンが無い（`welcome-route-page.tsx:30-38` vs `root-entry-page.tsx` の `RetryableProfileAlert`）。
  **第3:** オンボーディング `membersQuery` 失敗（`household-onboarding-page.tsx:204-211`）も同様にボタン無し。同一パターンで揃える。
- **C-M7** 確認の「変更」後の戻るラベルが「やめる」なのに draft を破棄しない（`planner-wizard.tsx:154-167`）。
  `onChange` は即 `onDraftChange` 済みで、戻るも「確認に戻る」も review へ行くだけ。設計 §5.3 は回答保持を要求し
  キャンセル破棄は要求しない。安全害は無く二次で Important → **Minor**。リネームか、edit 開始時 snapshot で真の破棄。
- **C-M8**（第3）アレルギー「未確認」のまま「この家族の設定を完了する」が有効（ドメイン・SQL 上は合法: 生成対象外）。
  警告文はあるが主ボタンが「完了」のため使えると誤解。コピーを「保存（未確認の家族はまだ選べません）」等へ。
  hard-disable は設定画面・RPC との方針合わせが要る。

## C: 確認して問題なしだった点

`sanitizeDraft` は idea を household へ降格させず、household の対象 0 件でも idea へ自動降格しない（§10 適合）/
確認画面のアイデア注意文は主操作の直前（§5.3 適合）/ privacy 往復前に `flushDraft()` + `setQueryData`（§5.1 適合）/
idea 確定時の `skipped` 書込は await + 失敗時 step 据置 + submit 側安全網（§10 適合）/
二重送信ガード（`isSubmitting` 同期 set、`confirmingIdeaAudienceRef`、`emergencyOperationIdRef`）/
下書き競合は自動上書きせず明示解決 UI / 44px タップ領域は C-I8 の折返し以外は充足。

---

# 領域 D: 買い物リスト・パントリー・履歴・再生成

※ 元レポートのヘッダは Important 13 と記載していたが、本文の列挙は I1〜I15 の 15 件。
第2セッション統合後は D-M7 を Important 相当に拡充したため、**Important 16（I1〜I15 + D-M7）/ Minor 6** が正。
第3セッション後は **Important 21（+ D-I16〜D-I20）/ Minor 7（+ D-M8）**。D-M7 は引き続き Important 相当。

## D-C1 [Critical] 履歴を削除すると使用中の買い物リストが永久に操作不能になり回復導線が無い

`netlify/functions/_shared/shopping-service.ts:228-240`, `shopping-adapter.ts:438-449`,
`supabase/migrations/20260711004000_shopping_lists.sql:78`, `src/features/shopping/pages/shopping-list-page.tsx:83`,
`src/features/history/pages/history-detail-page.tsx:447-452,706`, `src/features/history/components/history-card.tsx:119-131`

`shopping_list_sources.menu_id` は `on delete set null`。`delete_menu_group`
（`20260711003000_history_regeneration.sql:168`）は買い物リスト参照を一切確認せず `menus` を削除する。
以後 `revalidateActiveShoppingList` は `sources.some(s => s.menuId === null)` で必ず `unverifiable` を返し、
`useShoppingSafetyGate` が恒久的に `blocked` になる。

抜け出す操作が存在しない:
- 買い物リスト画面: `safetyBlocked = safetyGate.blocked || query.isFetching` でチェック・編集・追加・削除・「家にある」・undo が全 disabled。**リストを破棄／アーカイブする操作はコードベース全体に存在しない**（`grep -rn "archiv" src/` は型定義のみ）。
- 履歴詳細画面: `shoppingBlocked = !actionsEnabled || shoppingGate.blocked || ...` により **「買い物リストを作る」まで disabled**。`mode:"new"` で作り直せば復旧できるのに、その導線が同じゲートで塞がれている。

再現: 献立 A から買い物リスト作成 → 履歴で A を削除 → 買い物リストが全ボタン不可 →
別の献立 B の「買い物リストを作る」も不可 → **買い物機能がアカウント単位で恒久的に死ぬ。**

仕様: §9.2 は *使用中リストへの操作* を閉じる要件であって *新規リスト作成* まで閉じる要件ではない。
§9.1「過去の履歴は利用者が削除できる」と組み合わせると到達可能な行き止まり。
削除確認ダイアログ（`history-card.tsx:127`）も買い物リストへの影響を一切告げていない。

## D-C2 [Critical] reconcile 差分で正常な未チェック項目が既定チェック付きの削除候補になる

`shared/shopping/diff.ts:56-65,78,103-109`, `src/features/shopping/components/reconcile-list-sheet.tsx:27,119-135,150-155`

protected row（チェック済み等）が完全一致キーで候補を見つけられなかったとき、`takeCandidateByName` が
numeric/ambiguous を問わず同じ正規化名の候補をバケットから奪う。奪われた候補は後続の未 protected 行の
完全一致検索から消え、その行が `remove` に落ちる。処理順は `current.items` の並び順（= PostgREST の非決定な行順、D-I10）依存。
`ReconcileListSheet` は `remove` の全 itemId を**初期状態でチェック済み**にする。

**第3セッション:** UX は「削除候補がデフォルト全チェック」を Important として指摘。
設計 §9.2 は承認 UI を要求するが **default checked は義務付けていない**（実装都合）。
本 Critical（誤った remove 候補生成）と一体で直す。新規 ID なし。

実行して確認した入出力 — 現在のリスト: `i-checked`「にんじん 適量」(isChecked=true) / `i-plain`「にんじん 100g」、
新 draft: にんじん 150g（1 件）:

```
add:    [ [ 'k1_review_i-checked', '150g', pantryCheckRequired=true ] ]
remove: [ 'i-plain' ]
replace: []
```

→ 既定のまま「選んだ変更を反映」で `i-plain` が DB から DELETE され（`20260711004000_...sql:584-590`）、
代わりに「在庫量を確認」付きの重複行が増える。

仕様: §9.2「利用者が承認した差分だけを反映し、チェック済み項目、手動編集、手動追加、利用者が外した項目を無断で消さない」。
**protected row を守る救済ロジックが protected でない正常行を犠牲にしている。** 既存 `diff.test.ts` はこの相互作用を未カバー。

## D-I1 [Important] 小数合算で `quantityText` が浮動小数の生値になる

`shared/shopping/aggregate.ts:63,74`。入力 みりん 大さじ0.1 + 大さじ0.2 →
実行結果 `[ 0.30000000000000004, '0.30000000000000004大さじ' ]`。
`quantity_text` の DB 制約は 60 文字以内なので弾かれず保存される。

## D-I2 [Important] `numeric(12,3)` 丸めと JS 浮動小数の差で「変わっていない replace」が永久に出続ける

`shared/shopping/diff.ts:110-124`, `20260711004000_shopping_lists.sql:52`。
D-I1 の 0.30000000000000004 は 0.300 に丸めて保存 → 次回 preview で `0.3 !== 0.30000000000000004` → `replace` 生成。
実行結果 `replace: [ [ '0.30000000000000004大さじ', '->', '0.30000000000000004大さじ' ] ]` —
**表示上まったく同じ文字列の「数量・内容変更 1件」**。反映しても同じく丸められるため永遠に消えない。1/3 個（0.333）等も同様。

## D-I3 [Important] 単位が NFKC 正規化されず全角/半角で合算されない

`shared/shopping/normalize.ts:5`（名前だけ NFKC）, `aggregate.ts:60,91`（`unit` は生値比較）。
入力 にんじん 100`g` / にんじん 100`ｇ` → 実行結果は 2 行に分離。
パントリー照合（`sameUnit = sameName.filter(c => c.unit === item.unit)`）にも及び、冷蔵庫に「100ｇ」と登録していると
献立の「100g」と単位不一致になり `pantryCheckRequired: true`（自動減算されない）。
仕様 §9.2「同じ正規化名かつ同じ単位で安全に換算できる材料だけを合算する」— 「同じ単位」の判定に正規化が無い。

## D-I4 [Important] 元の `quantityText` を捨てて機械的に組み立て直す

`aggregate.ts:74`。入力 しょうゆ `quantityValue:2, quantityText:"大さじ2", unit:"大さじ"`（合算相手なし）→
実行結果 `'2大さじ'`。合算が発生していない単独項目まで無条件に上書きし、
「大さじ2」「小さじ1/2」「1/2個」が「2大さじ」「0.5小さじ」「0.5個」になる。

## D-I5 [Important] 期限切れの冷蔵庫在庫でも無条件に自動減算し、被覆されると項目ごと消える

`shopping-adapter.ts:479-486`（`select("name,quantity,unit")` のみで `expires_on` を読まない）, `aggregate.ts:88-109`。
実行結果（在庫 カレールー1箱 / 献立 カレールー1箱）: `items: 0`。
3 ヶ月前に期限切れのカレールーが登録されていると買い物リストから**行ごと消え**、買い忘れる。
「在庫があるので外しました」という表示も出ない。
仕様 §8 は期限切れ在庫を*使わせない*方向に倒しているのに、買い物リスト側だけが有効在庫として減算している。

## D-I6 [Important] パントリー画面に期限切れの注意表示がない

`src/features/pantry/pantry-page.tsx:265-270`。`expiresOn` を素の日付文字列で出すだけで、期限切れ行と来月期限の行が同一の見た目。
仕様 §8「期限日は…並べ替えと**注意表示**にだけ使用し」。並べ替え（`pantry-api.ts:59`）はあるが注意表示が未実装。
コピー「並べ替えと注意表示のための入力」（`:194`）が約束する注意表示が無い。**第3 再確認・新規 ID なし。**

## D-I7 [Important] 「削除」→「元に戻す」した項目が以後の献立差分から永久に除外される

`20260711004000_shopping_lists.sql:702-721`, `shared/shopping/diff.ts:20-21`。
`remove` は `is_removed_by_user=true, is_manually_edited=true` を立てるが、`undo` は `is_manually_edited` を戻さない。
`protectedItem()` は `isManuallyEdited` も protected 判定に含む。
再現: 誤って削除 → すぐ「元に戻す」→ 見た目は元通り → 以後の差分反映でこの行だけ数量が更新されない（`add` に別行が増えるだけ）。
理由が利用者に一切分からない。`mark_at_home` も同じ経路。

## D-I8 [Important] 手動追加項目の「家にある」「削除」は物理削除で undo できない

`20260711004000_shopping_lists.sql:702-715`, `src/features/shopping/components/shopping-item-row.tsx:24-39,80-99`。
`is_manual` の行は `remove`/`mark_at_home` のどちらでも `delete from public.shopping_items`。
行が消えるので undo 行は描画されず、`undo` を叩いても `shopping_item_not_found`。
再現: 手動で「牛乳」を追加 → 誤って「家にある」→ 即座に消滅、復旧不能。派生項目では undo できるため非対称。
仕様 §9.2「…と**誤操作を戻す undo** を用意する」。

## D-I9 [Important] 「家にある」と「削除」がサーバー側で完全に同一挙動

`20260711004000_shopping_lists.sql:702-715`。`remove` と `mark_at_home` の case 節は 1 文字も違わない。
UI は 2 ボタンを出す（`shopping-item-row.tsx:80-99`）が、実行後の表示はどちらも「◯◯をリストから外しました」で区別不能。
§9.2 は「家にある」を在庫由来の除外として独立に定義しており、意味が失われている。

## D-I10 [Important] 買い物リストの表示順が不定でチェックのたびに行が動き得る

`src/features/shopping/api/shopping-api.ts:90-102`, `shopping-adapter.ts:254-268`, `shopping-list-page.tsx:210`。
埋め込みクエリ `shopping_items(...)` に `order` 指定が無い。PostgREST は order 未指定なら物理順を返し、
Postgres の UPDATE は行を新しい位置へ書き直す。
再現: 野菜セクション先頭の「にんじん」をチェック → `refetch` 後に同セクション末尾へ移動。§10.3 の片手操作前提と噛み合わない。

## D-I11 [Important] 履歴一覧に日時が一切表示されない

`src/features/history/model/group-history.ts:63-64,70-72`, `components/history-card.tsx:59-92`。
`createdAt`/`selectedAt` をソートには使っているのに、`HistoryCard` はタイトル・案数・モードバッジ・説明文しか描画しない。
§9.1「新しい順に履歴表示し」は満たすが、日付が見えないため並び順の根拠が分からない（JST 以前に日時表示が無い）。

## D-I12 [Important] 買い物リスト画面に「元の献立が更新された」表示が無い

`shopping-list-page.tsx` 全体, `history-detail-page.tsx:714-735`。
差分確認の導線（`fetchReconcilableMenuSource` →「買い物リストとの差分を確認」）は**履歴詳細画面にしかない**。
再生成後も買い物リスト画面には旧版由来である合図が何も出ない。§9.2 の到達性が低い。

## D-I13 [Important] 連続タップで `list_version_conflict` になりチェックが黙って巻き戻る

`shopping-list-page.tsx:100-134`。`mutate()` は描画時点の `list.version` を送るが `useShoppingList` に楽観的更新が無く、
`mutate_shopping_item` は毎回 `version=version+1` する（`20260711004000_...sql:725`）。
再現: 3 項目を素早く連続チェック → 1 件目だけ成功、2・3 件目は「別の画面で更新されました。最新の内容を読み込みました」で
チェックが外れる。加えて `safetyBlocked = ... || query.isFetching` により refetch 中は全ボタン disabled。

**第3セッション:** UX I-H4 と同一。サーバ version はデータ破壊を防ぐが、in-flight disable が無く
`idempotencyKey: crypto.randomUUID()` はタップごとに新規のため二重タップを抑止しない。新規 ID なし。

## D-I14 [Important] 再生成シートの残数が成功枠だけを見て、読込中・エラー時に「残り0回」と嘘をつく

`history-detail-page.tsx:147,418`, `components/regeneration-sheet.tsx:137`（`usage.data?.success.remaining ?? 0`）。
1. `useUsageToday` が pending の間と失敗時に「現在残り0回」と表示（実際は 5 回残っている）。エラー表示も無い。
2. `attempts`（12/日）・`shortWindow`（4/10分）・`globalAvailable` を無視。生成画面
   （`generation-status-panel.tsx:35-39`）とプランナー（`planner-route.tsx:489`）は表示しているのに再生成シートだけ捨てている。

再現: 10 分以内に 4 回外部送信済み（成功 1 回）→ 履歴詳細が「残り4回」→「別案を作る」→ `user_short_window_limit` で失敗。
§11.2 は usage-today にこれら全部を含めることを要求しており、API は返しているが UI が捨てている。

**第3セッション:** 送信ボタンが `remaining === 0` でも disabled にならない点を再確認（`isSubmitting` のみ）。
生成前 review 側の薄い dual-limit は **C-I12**。

## D-I15 [Important] アレルゲン警告だけが変わった項目は差分に現れない

`shared/shopping/diff.ts:110-124`。replace 判定は `quantityValue`/`quantityText`/`storeSection` の 3 つのみで、
`labelWarnings` と `displayName` を見ない。
実行結果（数量同一・新版で小麦警告が付いたカレールー）: `add:0 replace:0 remove:0` → 差分シートは「変更 0 件」で、
既存項目に新しいラベル警告が引き継がれない。`pantryCheckRequired` も比較対象から漏れている。
仕様 §9.2「…**加工品ラベル警告の差分**を表示する」。

## D-M7 [Important] 再生成シートが安全再検査後も開き、送信が未処理の Promise 拒否になる

> 第1セッションでは Minor として短記。第2セッション二次レビュー（Hist-F2）で race 全体を再確認し
> **Important 相当**と確定。ID は D-M7 のまま（参照安定）。集計上 Important に含む。

- ゲート: `actionsEnabled` / `canRegenerate` は `phase === "checked"` かつ actionable のときのみ
  （`menu-result-page.tsx` household / `history-detail-page.tsx` household）
- シート: `sheetMode` はローカル state でゲートと非連動。ボタンは open 時だけ `disabled={!actionsEnabled}`
- 再検査トリガ: focus / visibility / online / Realtime / **60s ポーリング**（`use-menu-revalidation.ts`）
- 送信: `onSubmitReason` が `await startWhole|startDish` のみで **try/catch 無し**。
  `canRegenerate === false` は `Promise.reject(new Error("revalidation_required"))`
  （`use-regeneration.ts:48-59`）。`setSheetMode(null)` は成功時のみ → シート残留
- 技術的には catch 握りつぶしではなく **unhandled rejection**（console）。ユーザー向け UI は無し
- idea 経路は `canRegenerate` 常時 true のため本 race の対象外。結果画面と履歴詳細の **household 両方**

再現: 献立結果で「まるごと別案」シートを開く → タブ blur/focus または 60s 待機で再検査 →
外側ボタンは disabled・レシピは隠れるがシートは残る →「別案を作る」→ 遷移も alert も無し。

仕様: MVP §9.1 — 安全再検査中は再生成を disabled / fail closed。
修正方向（close-on-disable **だけでは不足**）: (1) `!actionsEnabled` で `setSheetMode(null)`
(2) `revalidation_required` を catch して `role="alert"` (3) シート内送信もゲート連動。
reject を resolve に変えて成功風にシートを閉じるのは不可。

## D-I16 [Important] 履歴「条件が変わっています」が sticky でなく、何が変わったか日本語化されない

> 第3セッション。

`history-detail-page.tsx:570-571,643-645` — `role="status"` の通常 `<p>`。sticky クラス無し。
`changedDetails`（`preference_changed` / `pantry_item_removed` 等）は `revalidation-api.ts` で検証されるが UI 未マップ。
設計 L370: 画面上部へ警告を**固定**。`status === "changed"` かつ issues 空では操作は有効のまま（正しい）だが、
「何が変わったか」が無いとアレルギー失敗と誤読しやすい。

## D-I17 [Important] 「新しいリストにする」が既存使用中リストの行方を説明しない

> 第3セッション。

`create-list-sheet.tsx:40-50` — ラジオラベルのみ。append vs new の**選択は存在する**が、
今日の未購入リストがどうなるか（アーカイブ／置換）が不可視。§9.2 は無断上書き禁止を要求し選択 UI は満たすが、
低 IT 利用者は「作成する」で半チェック済みリストを消す恐れ。

## D-I18 [Important] 家族メンバー削除の確認が「設定だけを削除」で不可逆性を弱く伝える

> 第3セッション。

`household-settings-page.tsx:1608-1627` — 「この家族の設定だけを削除します。」/「家族だけを削除」。
「元に戻せません」やアレルギー・献立への影響の明示が無い。アカウント削除（フレーズゲート + 不可逆文）と非対称。
誤削除後のアレルギー再構成コストが高い。

## D-I19 [Important] `/menus/:id` で下部ナビのどのタブも active にならない

> 第3セッション。

`app-shell.tsx` の NavLink `to="/planner"` はデフォルト end 一致のため `/menus/:id` にマッチしない。
`sectionForPath` は `/menus/` を planner セクションとして色付けするが、**下部ナビの `nav-item-active` は 0**。
履歴から献立を開いたあと向きが分からなくなる。C-M4（emergency の上部バー）と隣接。

## D-I20 [Important] 買い物ゲートの「安全確認」語と、初回設定・買い物既定面の常時非保証注意の欠落

> 第3セッション。UX 一次は Critical 束ねだったが、**二次で Important に分割**（工程語と保証禁止の混同を是正）。

1. **ゲート語** `shopping-list-page.tsx:187`「**安全確認**が完了するまで買い物操作はできません。」
   設計 L155 も再生成ゲートで「安全確認が終わるまで」と工程語を使う。§221 が禁じるのは
   「アレルギー対応済み」「安全」保証と緑チェック。ただし主婦には医療確認完了に読める。
   同ページの「現在の家族設定で再確認しています」（`:196`）へ寄せる。
2. **常時 DISCLAIMER** §221 は初回設定・生成結果・履歴・買い物リスト。結果/履歴/privacy はあり。
   オンボーディングと買い物**既定**面（警告 0 件の通常リスト）に常時非保証 1 行が無い。
   条件付きラベル警告 ≠ 常時注意。

## D-M8 [Minor] 原材料確認 UI に辞書版 `jp-caa-…` が露出する

> 第3セッション。

`menu-result.tsx:493-495`「辞書版 {dictionaryVersion}」。§10.3 L372 の英語/内部 ID 禁止に近い。
監査用はストレージに残し、主婦向け「原材料表示の確認」本文から外す。

## D-M1〜D-M6 [Minor]

- **D-M1** `approval.addKeys` の重複を弾かず同一項目が二重追加（`diff.ts:137`, `shared/contracts/shopping.ts:164`）。改造クライアント限定。
- **D-M2** 正規化エイリアス表の抜け（`shared/shopping/reviewed-aliases.ts`）。実行確認: 「じゃが芋」「タマネギ」「玉ネギ」が未登録で別項目のまま。
- **D-M3** 合算時に売り場・表示名が先勝ちで捨てられる（`aggregate.ts:70-72`）。ねぎ(produce)+ねぎ(other) → produce のみ残る。
- **D-M4** 手動追加フォームの「表示する分量」が既定値 `"数量未入力"` のまま残る（`shopping-list-page.tsx:36,147-158`）。数値・単位から表示文字列を組む補助が無い。
- **D-M5** household 履歴詳細にお気に入りボタンが無い（`history-detail-page.tsx` の `IdeaDetailBody`:304-327 にはある）。履歴カード側には両方あるため非対称。§9.1。
  **第3 再確認**（UX I-H2）。新規 ID なし。
- **D-M6** 進行中 pending があると再生成理由が黙って捨てられる（`use-regeneration.ts:64-67,97-100`）。説明が出ない。

## D: 誤検出として棄却した仮説（コードで確認済み）

list-level 警告の取りこぼし（`aggregate.ts:111-118` の添付条件で必ず item 側に付く。実行確認済み）/
replace と remove の同一 itemId 二重承認（`computeShoppingDiff` はどちらか一方しか生成しない）/
所有権チェック漏れ（全 RPC が `user_id` か `auth.uid()` でスコープ、`apply_shopping_*` 等は service_role のみ）/
usage-today の数値不一致（`get_ai_usage_today` は予約側と同じ定義。ズレは UI 側 = D-I14）/
短期窓の固定タンブリング窓（design §11.2 が明示的に固定した既知の制約）。

---

# 領域 E: クォータ・レート制限・JST・環境設定・CSP

## 突き合わせ結果の総括

仕様アンカー値（5 / 12 / 4 / 600s / 45 / 20000ms / 50000ms / 180s / 300s / 300000ms / 30日）は
`shared/contracts/generation.ts`・`netlify/functions/_shared/env.ts`・`.env.example`・`compose.yaml`・
`scripts/preflight-production.mjs`・SQL の**全層で一致**。オリジン（`127.0.0.1:5173` / `127.0.0.1:8000` /
`kong:8000` / exact 20 字 ref）も 4 箇所の正規表現が同一（`env.ts:9`, `public-env.ts:4`,
`scripts/csp-headers.mjs:8`, `preflight-production.mjs:13`）。CSP directive 本体は plan 6 と逐語一致。
既報 `docs/archive/reviews/2026-07-25-adversarial-code-review.md` の I-3 / I-4 / Minor 1〜3 は解消済みと確認。

**問題なしと確認**: TOCTOU（`pg_advisory_xact_lock` + カウンタ 3 行 `for update`、`20260711002000_...sql:342-345,406-411`）/
JST 日境界（TS `Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Tokyo"})` と SQL `at time zone 'Asia/Tokyo'` の
双方が日付演算で翌日を求め、月末・年末・閏年で破綻しない）/ 失敗生成のカウント整合 /
**pre-`markSent` の** タイムアウト予算（20s×2 + 2s = 42s の見積り、`AbortController` が fetch と body 読取の
**時間**打ち切りに配線）/ 秘密の露出（`src/` から `netlify/functions/**` への import 0 件、`VITE_` 秘密は二重拒否、
`OPENROUTER_MOCK_SCENARIO` はローカル mock base URL 厳密一致でのみ有効）。

**第4セッションで上記を限定**: post-provider finalizer abort 欠落は **A-I9**、`response.text()` の
**サイズ**無制限は **A-I11**、`safetyTags` 希釈は **A-I12**。pre-send ゲート自体の誤認ではない。

## E-I1 [Important] 生成上限の「明日H:MM」表示が本番では絶対に出ない

`src/features/generation/components/generation-status-panel.tsx:8-14`（判定 `:12`、利用 `:173`）:

```ts
const isTomorrow = retryAt === getNextJstMidnight(now).toISOString();
```

`getNextJstMidnight(...).toISOString()` は `"2026-07-26T15:00:00.000Z"` 形式（`shared/time/jst.ts:18-20`）。
一方サーバの `quota.retryAt` は `jsonb_build_object('retry_at', p_request.retry_at)`
（`20260711002000_ai_control_and_quota.sql:216`）で作られ、PostgreSQL の timestamptz→jsonb 変換は
DateStyle=ISO で**オフセット表記**（`"2026-07-26T15:00:00+00:00"`）を出す。値は
`generation-repository.ts:71,89` と `shared/contracts/generation.ts:521,737`（`z.iso.datetime({offset:true})`）を
**無変換で**通過するため UI 到達時も `+00:00` のまま。`===` は決して成立せず `isTomorrow` は常に false。

再現: 同一 JST 日に 5 回成功 → 6 回目 → `failure_code='user_daily_limit'`, `retry_at = 翌0:00 JST` →
UI は `再開: 0:00` と表示（「明日」が付かない）→ 利用者は「今日の 0:00＝既に過ぎている」と読み、即再試行を繰り返す。

**テストが欠陥を隠している**: `generation-status-panel.test.tsx:25` が
`retryAt: getNextJstMidnight(NOW).toISOString()` と**クライアント側関数で合成した値**を渡すため、
サーバが出しえない形式でのみ緑になる（`:58` の `expect(screen.getByText(/明日0:00/))`）。
**未確認**: DB コンテナ停止中のため `jsonb_build_object` の実出力文字列は未実行確認。上記は PostgreSQL の
変換仕様と、コード上に正規化処理が 1 箇所も存在しないことからの静的確定。

## E-I2 [Important] Acceptance matrix 行 17 のクォータ証拠が無関係なテストを指している

`docs/testing/acceptance-matrix.md:27`。「Quotas 5/12/4/global; 30-day cleanup; usage/today」に対する pgTAP 証拠が
`ai_control_and_quota.test.sql` の **`the locking helper accepts the exact current fingerprint`**（同ファイル `:406`）で、
内容は安全性フィンガープリント検査であり無関係。
roadmap `:403` は「Concurrent 5-success/12-daily/4-per-600s/45-global gates」を required proof boundary と定める。

`verify-acceptance-matrix` は file 実在と title 部分一致しか見ないため**通ってしまう**。
枠到達テスト自体は存在する（短期窓 5 回目 `user_short_window_limit`: 同 `:2480-2541` / repair attempt 上限:
`:2852-2902` / global 1..45: `:928`）ため、欠落は**トレーサビリティ**。ただし「同時実行」ゲートは
`ai_control_and_quota_races.test.sql` にもクォータ上限ケースが 0 件で、行 17 の proof boundary は満たされていない。

## E-M1〜E-M6 [Minor]

- **E-M1**（元 E-3）`scripts/emit-deploy-headers.mjs:43` の context 既定が `deploy-preview` で fail-open。`netlify.toml:10` の production command は `--context` を渡さず Netlify の `CONTEXT` 供給に完全依存する。`CONTEXT` 無しで同じ `dist/` をデプロイすると production 成果物に `https://*.supabase.co` ワイルドカード CSP（`csp-headers.mjs:17`）が焼かれ、plan 6 が I-4 で閉じた exfiltration 経路が復活する。`preflight:production` は `buildDeployHeadersFile({context:"production"})` をその場で再計算するだけで実 `dist/_headers` を読まないため検知できない（`preflight-production.mjs:25-32,263`）。
- **E-M2**（元 E-4）`USER_DAILY_EXTERNAL_CALL_LIMIT` / `USER_SHORT_WINDOW_EXTERNAL_CALL_LIMIT` / `USER_SHORT_WINDOW_SECONDS` はランタイム参照 0 件（`env.ts:63-71,187-189`）。実効値は SQL のハードコード（`20260711002000_...sql:430,519,509-511,534`）のみ。`releaseLockedInteger` が env 側ドリフトを拒否するので fail-closed だが、リリース値改訂時に SQL 側 4 箇所を見落とす経路になる。
- **E-M3**（元 E-6）`shared/time/jst.test.ts:4-8` が月中 1 ケースのみで、月末・年末・閏日の境界を踏んでいない。現時点の欠陥ではなく将来変更に対する保護の欠落。
- **E-M4**（元 E-7、既報 Minor 17 のキャリーオーバー・`9fdc2a3` 時点未修正）`use-usage-today.ts:14-25` の `jstDay: string = jstDayKey()` がレンダー時評価。`/planner` を開いたまま JST 0:00 を跨ぐと前日キーの `staleTime:30_000` キャッシュを参照し続け「本日あと0回」を表示し続ける。サーバは `private.ai_jst_day(clock_timestamp())` で新しい日を返すため表示と実挙動が一致しない。**E-I1 と合わせると「リセット時刻が今日として表示され、日が変わっても残数が更新されない」二重の不整合。**
- **E-M5**（元 E-8）`verify-browser-secrets.mjs:19-28,79-83` の値スキャンは `env[key]` が非空のときだけ有効で、CI では本番実キーが無いため空振り。実効的に守っているのは `FORBIDDEN_NAMES` の名前スキャンのみ。加えて `netlify.toml:10` の production command に `verify:browser-secrets` が無く、本番ビルドでは一度も走らない。
- **E-M6**（元 E-9）`20260711002000_ai_control_and_quota.sql:408-409` の `ai_global_daily_usage` 単一行 `for update` により、全利用者の全新規生成予約が 1 行の行ロックを直列に待つ。ロック保持区間に `cleanup_stale_ai_generations`（`:380`）と `cleanup_ai_generation_requests`（`:484`）を含む。45/日では実害は無く、ロック順の矛盾もないためデッドロックも不成立。`GLOBAL_DAILY_AI_LIMIT` 引き上げ時の既知制約として記録。

## E-U1 [要確認] `FUNCTION_TOTAL_BUDGET_MS=50000` と Netlify 同期 Function の実行上限

`netlify/functions/_shared/env.ts:75`、`netlify.toml`（`[functions]` timeout 設定なし）、
`docs/deployment/netlify.md:42`、仕様 `2026-07-11-kondate-mvp-design.md:425`。

仕様は「同期 Function 1 回あたり総実行時間を 50 秒以内」と定めるが、リポジトリ内に同期 Function の上限を
50 秒へ引き上げる設定も、50 秒が許容される根拠も無い。一方 `docs/runbooks/openrouter.md:35` は
maintenance について「25 秒、プラットフォーム上限 30 秒の下」と記しており、**同一リポジトリ内で
「上限 30 秒」認識と「50 秒予算」が並存している**。

成立した場合: 1 回目 20 秒 → repair → 2 回目 20 秒 = 42 秒でプラットフォームが 26〜30 秒で打ち切り →
クライアントは 502/504、DB は `processing` のまま（180 秒後に解放）、`markSent` 済み attempt はカウントされたまま →
利用者から見ると「何も出ないのに 12 回枠が減る」。

**未確認**: 実上限はリポジトリ内の材料から確定できない。staging での 40 秒超 Function 完走確認、または
Netlify 側設定の提示が要る。仕様値は再導出禁止対象のため、変更提案ではなく人間への確認事項。

---

# 横断メモ

- **A-C1 / A-I1 / A-I2 / D-I3 / D-M2** はすべて「日本語テキスト正規化と語境界」の同一根。安全性側（`shared/safety`）と買い物側（`shared/shopping`）で正規化の実装が別々に存在し、どちらもカナ正規化を欠く。統一した正規化ユーティリティの設計判断が要る。**第4**は卵・乳の 玉子/タマゴ/ミルク 行列と「fold と alias は両方必須」を A-C1 に補強した。
- **A-I3 / C-I6 / D-I14** は「状態を説明せず汎用文言・固定文言・既定値で誤魔化す」共通パターン。仕様が定めた説明分岐がデッドコード化しているか、UI が API の返す情報を捨てている。C-I6 は第2・第3セッションでも再確認済み（第3は失敗パネル無条件導線を追加）。
- **A-C2**（第3）は「ラベル警告 DTO は人間向け・validation `issue.message` は内部診断」の二系統分裂。invalid 時に `currentLabelWarnings` を空にする構造が、履歴・結果・買い物の 3 面で同時に露呈する。
- **A-I8 / A-I9 / A-I11 / A-I12**（第4 中心）は生成 Function の ops・予算・provider 境界。A-I11/A-I12 は A-I9 の finalize 窓を増幅するが、いずれも独立に成立。A-I8 は UI/quota に影響しない。
- **A-I4 / A-I10** は自由入力の保持ポリシー。A-I4 は `menus.safety_snapshot` への誤混入、A-I10 は private freeze の 30 日掃除欠落。いずれも design「自由入力は保持しない」と緊張。
- **B-I1 / B-I4** は連鎖する（B-I4 が B-I1 のループを閉じさせない）。片方だけ直すと症状が変わるだけなので同時に扱う。
- **B-I3 / B-I5** はともに `sanitizeReturnPath` が chokepoint。B-I5（裸 `/` → planner）と B-I3（path collapse → `//host`）を直すときは同一関数の入出力契約をまとめて設計する。
- **B-I5 / C-C1** は初回導線で連鎖しうる。welcome をスキップした利用者が後から `/onboarding` に入ると袋小路（C-C1）に落ちやすい。
- **B-C1 / B-I8 / B-I9**（第3）はマジックリンク復帰の「端末に閉じた state」。deposited は再開 CTA 無し、期限切れは sent UI 非復元、送信済みはリロードで消滅。§644 とまとめて設計する。
- **C-I9 / C-I10 / C-I11**（第2）はプランナーの「黙って状態が変わる / 黙って保存が落ちる / 安全表示が曖昧」群。C-I2（`<a href>` で SPA 破棄）と合わせて autosave の信頼性をまとめて見る。
- **C-I12 / C-I13 / D-I14**（第3）はクォータ・二重上限の利用者向けストーリーが面ごとに違う（review は成功残のみ、失敗 panel は jargon、再生成は `?? 0`）。一本の平易な二系統説明に揃える。
- **C-I6 / B-I10**（第3）は緊急献立導線の一貫性。privacy はテキストのみ、失敗 panel は無条件リンク、review は mode 対応。idea 利用者を誤った「未登録」に送らない。
- **A-I7** は設計 §6 と Plan 3 テストロックの衝突。A-I6（修理空振り）と合わせると希望 soft-miss でも外部送信 2 回を消費しうる。
- **D-M7 / D-I14** は再生成シート周りの UX。D-I14 は残数の嘘、D-M7 はゲート再クローズ後の死んだ操作。
- **E-I1 / E-I2 / D-C2** は「テストが実データ契約を再現していないため緑のまま」の共通パターン。第3 でも C-I6 / C-I14 / C-C1 の**悪い文言・挙動をテストが固定**している点を再確認。第4 の A-I8（log 未断言）・A-C1（玉子未カバー）も同型。
- **AppShell 外ルート**（login / callback / welcome / onboarding / privacy）は下部ナビが無い。第3 の C-C1 / B-C1 / B-I10 はいずれも**ページ内ローカル CTA** が必須、という同じ型。
- 第1〜第4とも read-only。**修正は未着手**。人間の設計判断が特に要るのは A-C1 の照合方式と辞書 version、B-I2 の仕様どおり厳格化、E-U1 の実上限確認、**A-I7 の soft gap vs 設計改訂**、**B-I5 の post-auth 復帰先**、**A-I12 の safetyTags.max N**、**A-I11 の body 上限定数**。

## 第2セッションとの対応表（重複吸収の記録）

| 第2 ID | 二次判定 | 本ファイル |
|---|---|---|
| Auth-F1 | CONFIRMED Important | **B-I5**（新規） |
| Auth-F2 | CONFIRMED Important（path collapse） | **B-I3** に吸収・悪用経路確定 |
| Auth-F3 | CONFIRMED Important | **B-I6**（新規） |
| Planner-F1 | CONFIRMED Important | **C-I9**（新規） |
| Planner-F2 | CONFIRMED Important | **C-I10**（新規） |
| Planner-F3 | CONFIRMED Important | **C-I11**（新規） |
| Planner-F4 | CONFIRMED Minor | **C-M7**（新規） |
| AI-F1 | CONFIRMED Important | **A-I7**（新規） |
| AI-F2 | CONFIRMED Important | **A-I8**（新規） |
| Hist-F1 | CONFIRMED Important | **C-I6** に吸収 |
| Hist-F2 | CONFIRMED Important | **D-M7** に吸収・Important 相当へ拡充 |

## 第3セッション（UX 敵対）との対応表

詳細: `docs/archive/reviews/2026-07-26-adversarial-ux-review.md` /
`docs/archive/reviews/2026-07-26-adversarial-ux-review-secondary.md`

| UX 一次 ID | 二次判定 | 本ファイル |
|---|---|---|
| C-1 オンボーディング脱出 | CONFIRMED Critical（出口表現は限定） | **C-C1** に吸収・注記 |
| C-2 deposited やり直し | CONFIRMED Critical | **B-C1**（新規） |
| C-3 idea 緊急「未登録」 | CONFIRMED Critical（誤帰属+無条件 CTA） | **C-I6** に吸収・強化（ID は Important のまま） |
| C-4 ProgressIndicator | DOWNGRADED → Important | **C-I1** に吸収 |
| C-5 issue.message 内部 ID | UPHELD Critical（3 面） | **A-C2**（新規 Critical）。A-M1/A-U2 連動 |
| C-6 安全確認語 + DISCLAIMER | SPLIT → Important | **D-I20**（新規） |
| I-A1 プライバシー jargon | CONFIRMED Important（OpenRouter は残す） | **B-I7**（新規） |
| I-A2 期限切れ → idle | CONFIRMED Important | **B-I8**（新規） |
| I-A3 sent リロード消失 | CONFIRMED Important | **B-I9**（新規） |
| I-A4 Welcome/onboarding 再試行 | CONFIRMED Important | **C-M6** に吸収・オンボーディングも記載 |
| I-A5 未確認でも完了 | CONFIRMED（ドメイン合法・ラベル問題） | **C-M8**（新規 Minor） |
| I-A6 privacy 緊急導線 | CONFIRMED Important | **B-I10**（新規） |
| I-G1 autosave 無言 | CONFIRMED Important | **C-I9** に吸収 |
| I-G2 review 上限薄い | CONFIRMED Important | **C-I12**（新規） |
| I-G3/I-G4 失敗・作成ID | CONFIRMED Important | **C-I13**（新規） |
| I-G5 緊急 flush 文言 | CONFIRMED Important | **C-I14**（新規） |
| I-G6 使用料理欠落 | CONFIRMED Important（dishIds 既存） | **C-I15**（新規） |
| I-G7 対象が人数のみ | CONFIRMED（部分緩和） | 新規採番せず（CurrentSafetySummary あり。必要なら C-I15 と同時に） |
| I-G8 緊急候補ゼロ | CONFIRMED Important | **C-I6** 隣接（pre-request 嘘 vs post-request 空は別）— 新規 ID なし |
| I-H1 sticky / changedDetails | Uphold Important | **D-I16**（新規） |
| I-H2 お気に入り詳細 | Uphold Important | **D-M5** に吸収 |
| I-H3 新リスト説明 | Uphold Important | **D-I17**（新規） |
| I-H4 二重タップ | Uphold Important | **D-I13** に吸収 |
| I-H5 reconcile 既定チェック | Uphold Important | **D-C2** に吸収 |
| I-H6 パントリー注意 | Uphold Important | **D-I6** に吸収 |
| I-H7 家族削除文言 | Uphold Important | **D-I18**（新規） |
| I-H8 再生成残数 | Uphold Important | **D-I14** に吸収 |
| I-H9 menus nav | Uphold Important | **D-I19**（新規） |
| I-X1 AI通信試行 | Uphold Important | **C-I13** に含む |
| I-X2 辞書版 | Uphold Important | **D-M8**（新規 Minor） |
| I-X3 ローディング不統一 | Uphold Important | 新規 ID なし（C-M6 / RootEntry パターンの横断。修正時に揃える） |
| I-X4 a.primary-button min-width | Partial（契約ギャップ・実害未測） | 新規 ID なし（CSS 契約債務。320px 実害は未確定） |
| I-X5 認証語彙 | Uphold mild | **B-M9**（新規 Minor） |

## 第4セッション（AI / OpenRouter 重点）との対応表

詳細: `.superpowers/sdd/mvp-adversarial-ai-2026-07-26/`（`00-summary.md`〜`09-deep-synthesis.md`）

| 第4 ID | 深掘り判定 | 本ファイル |
|---|---|---|
| AI-1 玉子/タマゴ/ミルク + kana fold | CONFIRMED Important（一次 Critical から降格維持） | **A-C1** に吸収・卵/乳行列と修正パッケージを追記 |
| AI-2 finalize ログ false `succeeded` | CONFIRMED Important（ops のみ） | **A-I8** に吸収・深掘り注記 |
| AI-3 post-provider 50s finalizer abort 欠落 | CONFIRMED Important | **A-I9**（新規） |
| AI-4 draft submission freeze 無期限 | CONFIRMED Important | **A-I10**（新規）。A-I4 とは別経路 |
| AI-5 OpenRouter body 無上限 | CONFIRMED Important | **A-I11**（新規） |
| AI-6 `safetyTags` 無 max | CONFIRMED Important | **A-I12**（新規） |
| AI-M1 遷移 RPC が request_id のみ | PARTIAL Medium | **A-M5**（新規 Minor） |

第4で「問題なし」と再確認し新規 ID を付けなかったもの（抜粋）: `:free` / `openrouter/auto` 拒否、
応答 model allowlist、本番 base URL exact、Retry-After 24h clamp、reserve→markSent→HTTP、
repair 最大 1 回、枠原子性、safetyTags を安全証拠にしない、ブラウザ OpenRouter 非使用、
tumbling 短期窓（設計ロック済み）。
