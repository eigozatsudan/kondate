# 献立ひねり軸（noveltyPreference）設計 — 一次レビュー

- 日付: 2026-08-31
- 対象: `docs/superpowers/specs/2026-08-31-menu-novelty-axis-design.md`
- 実施者: 読み取り専用 Reviewer
- 判定: **REVISE — Critical 0 件、Important 3 件、Minor 4 件**

## 1. Verdict

任意軸 `noveltyPreference` を `ingredientPreference` と同じ `.default(null)` で draft/submission に足し、
new_menu の system へ fail-open のひねり段落だけを足し、再生成・安全評価・quota・fingerprint には載せない、
という骨格は現行実装と矛盾しない。`diversity-hints.ts` の prompt 専用 kill-switch（`true as const`）と
`normalizeFoodText` の再利用、Functions 閉じの辞書配置も所有境界に合う。

ただし計画に落とすと、現行の `ingredientPreference` 導入が実際に触った **snapshot 凍結経路** と
**下書き RPC クライアント面** が仕様から抜けている。§3.2 の箇条だけを実装すると UI は保存できても
生成コンテキストは常に `null` になり、ひねり段落が載らない。逆に `20260730120000_ingredient_preference.sql`
の reserve 本体を「なぞって」置き換えると、現行の quality monthly retry 台帳を巻き戻す。
この 2 経路の正本と、DROP する現行 13 引数シグネチャを仕様に固定するまで Plan に進めるべきではない。

## 2. Critical

なし。契約の `.default(null)`、再生成非改変、fingerprint 非入力、`shared/safety` をブラウザへ入れない、
generated types 手編集禁止はいずれも現行ロックと整合する。

## 3. Important

### I-1: 生成到達経路（reserve の snapshot 複写・snapshot RPC・strict パーサ）が未記載

根拠:

- Spec §3.2（67–76 行）は `generation_drafts` / `generation_draft_submission_versions` の列追加と
  `save_generation_draft` の DROP→CREATE だけを列挙する。
- Spec §5.1（100–102 行）は `noveltyPreference === "twist"` で system へ挿入すると書くが、
  実行時の `PromptPreferences` は `context.submission` 由来である。
- 現行の材料軸は **下書き保存だけでは生成に届かない**。
  `supabase/migrations/20260730120000_ingredient_preference.sql` 127–266 行が
  `reserve_ai_generation` の INSERT に `ingredient_preference` を写し、602–656 行が
  `get_ai_generation_submission_snapshot` の RETURNS TABLE に同列を足している。
- 正本の reserve は後続
  `supabase/migrations/20260808120000_quality_monthly_retry_and_usage_stale_cleanup.sql`
  155–165 行で、INSERT 列リストはまだ
  `ingredient_preference, avoid_ingredients, memo, pantry_selections` まで。
- `netlify/functions/_shared/generation-context.ts` 63–81 行の `snapshotRowSchema` は `.strict()`。
  211–226 行の `mapSnapshot` は `ingredientPreference: row.ingredient_preference` だけを
  `plannerSubmissionSchema.parse` に渡す。生成は `generation_drafts` を読まない
  （同ファイル 276 行付近、`generation-context.test.ts` 199–213 行が
  `get_ai_generation_submission_snapshot` のみ・`generation_drafts` 非参照を固定）。
- pgTAP も snapshot の exact JSON を固定している
  （`supabase/tests/database/ai_control_and_quota.test.sql` 1166–1253 行）。

成立条件:

1. 列と `save_generation_draft` だけを足し、reserve INSERT を触らない → snapshot 列は NULL のまま。
   Zod `.default(null)` で submission は常に `null`。`twist` でもひねり段落は載らない。
2. snapshot RPC の戻りに `novelty_preference` を足し、`snapshotRowSchema` を更新しない →
   `.strict()` が余剰キーで落ち、new_menu が 422 になる。

必要な修正:

- 現行 `reserve_ai_generation`（20260808120000 本体）の **INSERT 列リストだけ** に
  `novelty_preference` を足す。関数全体を 20260730120000 の reserve で置き換えない（I-3）。
- `get_ai_generation_submission_snapshot` を現行引数 `(uuid, uuid)` のまま DROP→CREATE し、
  戻りに `novelty_preference` を足す（ingredient_preference.sql 602–656 行と同型）。
- `snapshotRowSchema` と `mapSnapshot` に `novelty_preference` → `noveltyPreference` を足す。
- `ai_control_and_quota.test.sql` の snapshot exact 比較を更新する。
- 実装順序 §8 の「1. migration」に上記 2 RPC を明示する。

### I-2: 下書きのクライアント永続面（RPC overlay / planner-api / autosave 写し）が未記載

根拠:

- Spec §4（81–85 行）は `review-step.tsx` / `planner-labels.ts` / `draft-from-menu.ts` だけ。
- Spec §8（151–158 行）は契約の次が辞書・プロンプト・UI で、draft save クライアントが無い。
- 現行の材料軸は次を同時に足している。
  - `src/shared/types/database.ts` 20–36 行: Postgres Meta が nullable 引数を非 null と誤るため
    `p_ingredient_preference` を overlay で `| null` に戻す。
  - `src/shared/types/database.test.ts` 118–133、169–177 行: 未完成下書きの `satisfies SaveDraftArgs`。
  - `src/features/planner/planner-api.ts` 25–45 行 `mapPlannerDraft`、56 行の明示 SELECT、
    64–82 行 `buildSaveGenerationDraftArgs`（keepalive も同一引数。同ファイル 110–128 行、
    `planner-api.test.ts` 144–158 行が JSON キー集合を exact 比較）。
  - `src/features/planner/use-draft-autosave.ts` 66–80 行 `toDraftInputFields` が
    `ingredientPreference` を明示コピー。ここを忘れると flush が軸を落とす。
  - `src/shared/types/database.generated.ts` 3189–3204 行の現行 Args に
    `p_novelty_preference` は無く、再生成後も overlay 無しだと `null` 送信が型エラー。
- 契約にキーを足すと `PlannerSubmission` を手で組む面が型落ちする。
  現行は `shared/testing/factories.ts` 246・294 行、
  `shared/emergency/filter-emergency-menus.ts` 145 行、
  `src/features/planner/planner-route.tsx` 104 行の空下書きなど。

成立条件: UI で「ひねりたい」を選んでも SELECT / RPC 引数 / autosave 写しのどれかが欠けると、
リロード後は `null`、keepalive は旧 13 引数、型チェックは `database.ts` overlay 不足で落ちる。

必要な修正:

- §3 / §4 / §8 に次を必須面として列挙する。
  `database.ts` の `NullableDraftArgs`、`planner-api.ts`（map / select / RPC / keepalive）、
  `toDraftInputFields`、空下書き、factories、emergency のダミー submission。
- `src/shared/types/database.generated.ts` は再生成のみ、という既存禁止は維持。

### I-3: 「20260730120000 をなぞる」は現行 DROP シグネチャと reserve 正本を誤らせる

根拠:

- Spec §3.2（69 行）「`20260730120000_ingredient_preference.sql` をなぞる 1 本」。
- 同ファイル 19–21 行の DROP は **当時の 12 引数**
  `(bigint, text, text[], text, text, uuid[], smallint, smallint, text, text[], text, jsonb)`。
- 現行 `save_generation_draft` は同ファイル 23–27・120–125 行の **13 引数**
  （`p_ingredient_preference` 込み）。pgTAP も 13 引数を正とする
  （`supabase/tests/database/03_pantry_and_planner_drafts.test.sql` 41–42 行、
  `rls_inventory.test.sql` 284 行）。
- 現行 reserve 正本は 20260808120000（quality monthly retry / usage stale cleanup）。
  20260730120000 の reserve 本体は古い。

成立条件:

1. 20260730 の DROP リストをコピーする → 現行 13 引数関数は残ったまま 14 引数 overload が増える。
   PostgREST の named RPC が曖昧になるか、旧関数が `novelty_preference` を捨てる。
2. 同ファイルの reserve を丸ごと CREATE し直す → 20260808 以降の quota/quality 差分が退行する。

必要な修正:

- DROP 対象は **現行 13 引数** と明記する。
- `save_generation_draft` の GRANT/REVOKE も新シグネチャへ付け替える（なぞる対象はここまで）。
- reserve は「現行関数の INSERT/SELECT リストに 1 列足す」と書き、20260730 本体の再利用を禁止する。
- 既存 pgTAP の位置引数呼び出し（`03_pantry_and_planner_drafts.test.sql`、
  `03a_pantry_and_planner_drafts_hardening.test.sql`）と `rls_inventory` の exact シグネチャ更新を
  §7 の必須に入れる。新規 check テストだけでは `db:test` は通らない。

## 4. Minor

### M-1: 除外リストの件数上限値が無い

根拠: Spec §5.1（98 行）「1 リクエストあたり件数上限定数」、§6（135 行）「上限定数で切り」。
現行の同型は `netlify/functions/_shared/diversity-hints.ts` 10 行 `RECENT_DISH_HINTS_MAX = 24`。
計画時に実装者が別の数を置く。仕様か Plan の Task 0 で整数を固定すれば足りる。

### M-2: 辞書照合が exact normalize か複合語を含むかが未定

根拠: Spec §6（132–133 行）は `normalizeFoodText` で「豚肉／ぶた肉／ブタ」を吸収するとだけ書く。
`shared/safety-pure/normalize-food-text.ts` 26–28 行は NFKC・カナ折り・空白句読点除去であり、
部分一致はしない。`ingredientAliases` に載らない「豚こま切れ」はヒット 0 件で段落だけ残る。
fail-open としては仕様どおりだが、Plan は「alias の完全一致（正規化後）」と書くべき。

### M-3: 確認画面の field 名前空間とコンポーネントテストが未列挙

根拠: Spec §4 はラベルと `review-step.tsx` 配置のみ。
現行は `PlannerFieldName` / `ReviewFieldErrors` / `stepByField` に `ingredientPreference` を持つ
（`src/features/planner/model/planner-wizard.ts` 16–28・109–146 行、
`review-step.tsx` 86–96 行）。未登録だと Zod issue が画面に出ない。
`planner-wizard.test.tsx` 920–958 行が「材料の使い方」の選択を固定しているので、
2 択を足すなら同テストの更新が必要。E2E 1 本だけでは不足。

### M-4: kill-switch off 時の user payload

根拠: Spec §5.1（100–102 行）は system 挿入条件を `twist` かつ kill-switch on とし、
同時に「user payload にも載せる」と書く。多様性は off 時に段落も `recentDishHints` も消す
（`generation-prompt.ts` 498–515 行、`generation-prompt-diversity-off.test.ts` 62–76 行）。
`noveltyPreference: "twist"` を JSON に残すと、段落無しでもモデルが反応し得る。
off 時は system も preferences キーも落とす、と一言あれば足りる。

## 5. 確認したが問題にしない事項

- `shared/contracts/planner.ts` 92–94・127–128 行の
  `ingredientPreference: z.enum(...).nullable().default(null)` とコメント（導入前 snapshot の 422 回避）は
  Spec §3.1 の必須理由と一致。`planner.test.ts` 58–92 行がキー欠損 → `null` を固定。
- `null` と `"standard"` を同挙動（段落なし）にする判断は、材料軸の `auto`/`null` が
  CORE_PREFIX で「モデル判断」（`generation-prompt.ts` 125–132 行）なのに対し、本軸は
  未指定＝段落なしでよい。再生成は `buildSystemPrompt` のまま（238–253 行 vs 再生成 525–543 行）。
- fingerprint は安全コンテキストだけを sha256 する（`shared/safety/fingerprint.ts` 42–72 行）。
  好み軸は入力にならない。quota / integrity_context も target_mode / servings / member ids のみ
  （`generation-integrity-context.ts` 9–16・46–52 行）。Spec §2.2 / §5.3 の「触らない」は現行どおり。
- `validate-generated-menu` 経路に `ingredientPreference` 参照は無い。本軸を足しても評価入力にはならない。
- kill-switch は env ではなく `DIVERSITY_HINTS_ENABLED = true as const`
  （`diversity-hints.ts` 6 行）と `HOUSEHOLD_KITCHEN_PROMPT_ENABLED` 同型。
  Spec の `NOVELTY_HINTS_ENABLED` はこのパターンで正しい。off テスト専用ファイルも同型でよい。
- `buildNewMenuSystemPrompt` は `generation-prompt.ts` 241 行に実在（未 export）。
  多様性段落の直後挿入は現行合成
  `` `${coreBody}${diversity}${SEASON}${modeExtra}` ``（252 行）と噛み合う。
- 辞書を `netlify/functions/_shared/` に閉じ `shared/` を経由しない判断は所有境界どおり。
  `normalizeFoodText` は `shared/safety-pure` から Functions が import してよい。
- UI の `.field select` は `src/styles.css` 1229–1238 行で `min-height: 48px`、wizard 追加条件は
  縦積み（`review-step.tsx` 523–524 行）。320px 横スクロール回避と 44px は既存スタイルに乗せる前提で足りる。
- `draft-from-menu.ts` 10–26 行は任意条件を明示コピーしており、新キーを 1 行足す指定は妥当。
- temperature 非送信（Spec §2.2）は対象外として正しい。送信 body を触らない制約は維持すべき。
- 2 パス生成を採らない（Spec §9）は `function-budget` / 同期 60s と整合。計画で復活させない。

## 6. Recommendations (advisory, do not block)

- 除外上限は `RECENT_DISH_HINTS_MAX` に倣い、例: 主菜名 16 件、のような整数を Task 0 で固定する。
- `buildNoveltyParagraph(mainIngredients): string` を `NOVELTY_PARAGRAPH` 定数と分けて書く。
  静的な fail-open 規約と、リクエストごとの名指しリストは別関数の方が
  `buildNewMenuSystemPrompt` の引数を増やさずに済む
  （現行は `(targetMode, diversityEnabled)` のみ。241–253 行）。
- 初版カタログの 20〜30 語は Plan 本文に列を固定する（仕様は範囲のままでよい）。
- 確認画面の未選択ラベルは既存 `ingredientPreferenceLabel(null) === "指定なし"` に合わせると
  実装が割れない。
- E2E は「ひねりたいを選んで下書き RPC が `p_novelty_preference=twist` を送る」までを本線にし、
  生成 `success` は既存 full-journey のモック経路に乗せる方が、OpenRouter 実成功 1 本より安定する。
