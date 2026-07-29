# 敵対的レビュー: 利用回数コピー簡素化 Implementation Plan

| 項目 | 値 |
|------|-----|
| 対象 | `docs/superpowers/plans/2026-07-29-quota-copy-simplification.md`（commit `b37ab72` 時点） |
| 日付 | 2026-07-29 |
| 対照 | 設計 `docs/superpowers/specs/2026-07-29-quota-copy-simplification-design.md`（Approved） |
| 判定 | **ACCEPT_WITH_CHANGES** — Critical を plan 改訂してから実装開始 |
| 観点 | 設計カバレッジ、TDD 完全性、逃げ道・placeholder、コマンド規約、既存テストの落とし穴、false green |

---

## 総評

Task 分割（契約 → 確認 → 再生成 → 終端 → 横断）と設計 L1–L10 への対応意図は妥当。文言スニペットの多くは設計表と一致している。

しかし plan は **writing-plans の「placeholder 禁止」と設計 D-I7（failureCopy ≡ issueMessages の assert）を自分で緩めている**。既存 `planner-wizard.test.tsx` の **success0∧attempts0 で両文を要求するテスト**を RED 手順が更新しきっておらず、実装者が旧期待のまま「両方出す」 gre を通し得る。Task 3 の short-window テストはコメントのみで **空テストが green になり得る**。

方針・設計への敵対的指摘（ADV / D-*）の多くは plan に写っているが、**実装エージェントがゼロ文脈で踏む落とし穴**が残る。

---

## Critical

### P-C1. `failureCopy ≡ issueMessages` が Must なのに plan が「目視で足りる」と逃げる

設計（D-I7 / テスト節）:

> `failureCopy[code].message === issueMessages[code]` を全 `GenerationFailureCode` で assert。message のコピー＆ペースト禁止。

plan Task 1 Step 4:

> export しないなら … **目視 + fixture 更新で担保**  
> generation.test.ts で正本固定で**足りる**

これは設計 Must の弱体化。fixture 更新だけでは **将来どちらかだけ直してドリフト**する。現状 `failureCopy` は module ローカルで、一致テストを書けない構造のまま plan が放置している。

**攻撃:** Task 1 完了コミット後も `failureCopy` に旧文字列が1つ残る → API は旧「別の上限」、契約テストは緑。

**要求（plan に固定）:**

1. `failureCopy` を test から触れる形にする（推奨: `export function getGenerationFailureCopy(code)` または `export { failureCopy }` を test-only ではなく production 可の薄い export）、**または**
2. `shared/contracts` 側に `failureMessages` を置き service は `retryable` map だけ持つ、など **単一 message 表を強制する構造**にし、
3. 単体テストで **全 `generationFailureCodes` について message 一致**を assert（「してもよい」削除）。

「目視」行は plan から削除すること。

---

### P-C2. Task 3 short-window テストが placeholder（空 it が GREEN）

```ts
it("disables submit when short window is blocked", () => {
  // shortWindowRemaining === 0 && shortWindowRetryAt 非 null
  // 待ち文可視 + 別案を作る disabled
});
```

本文が無く **常に pass**。writing-plans の No Placeholders 違反かつ設計受け入れ「再生成 shortWindow ブロック」の RED 欠落。

**要求:** 完全な render + expect を plan に書く（日時は固定 ISO を与え、`getByText` / `toHaveTextContent` で部分一致）。

---

### P-C3. 既存テスト「success0 ∧ attempts0 で両理由」が設計と衝突し、plan RED が更新を指示しきれていない

現行 `planner-wizard.test.tsx`:

```ts
it("成功残と attempts 残が同時に 0 のとき両方の理由を 1 つの警告にまとめる", () => {
  // ...
  expect(...).toHaveTextContent("本日の作成回数の上限に達しています。明日0時…");
  expect(...).toHaveTextContent("AIへの問い合わせ回数が上限です。明日0時…");
});
```

設計: **success0 ∧ attempts0 のとき success0 文のみ**。

plan Task 2 Step 1 はサンプル期待を並べるが、**この it の改名・期待差し替えを明示していない**。実装者が「両方まとめる」タイトルのまま両文を残すと、設計違反でテストは旧仕様 green。

**要求:** Task 2 RED に次を必須ステップとして書く。

- 当該 it を「success0 のみ出す」に書き換え（attempts0 文は **出ない**）
- 併せて旧「0時」「作成回数の上限」「問い合わせ」期待を全置換（ファイル内 grep リスト）

---

### P-C4. 禁止部分文字列テストが `issueMessages` 全件に `attempt` 等を掛ける — 現状は通るが、スコープ説明不足で実装が誤緩和し得る

plan は全 `generationIssueCodes` に fragment 禁止を掛ける。現状の conflict / allergy 文に該当断片は無い想定でよい。

問題は別:

- **ユーザー向け UI 固定文**（未減行・確認バナー）は契約テストの対象外
- Task 5 grep はコード残留用で、**禁止リストと grep リストが不一致**（例: `作成できます` は確認の旧常時文に残るが Task 5 に無い）

更に危険: 実装者が false positive を恐れて **禁止テストを issueMessages の quota キーだけに狭める**逃げを plan が許容しているように読める（「必要なら」系は Task 1 初期案に近い）。

**要求:**

1. 契約テスト: `issueMessages` 全 value の禁止断片（現状のまま Must）
2. Task 5 grep に少なくとも追加:  
   `本日あと.*作成できます` / `明日0時` / `作成回数の上限` / `問い合わせ回数が上限` / `成功回数：`
3. UI 固定文の禁止は各 Task の expect で担保する旨を明記

---

## Important

### P-I1. Task 3 Step 4 が `docker … && git commit` で AGENTS / Global Constraints に違反

Global Constraints: 「コマンドは連結しない」。  
Task 3 Step 4 は test と commit を `&&` 連結。Task 2/1 は分離しているのに Task 3 だけ違反。

**要求:** 別 Step に分離。

---

### P-I2. shortWindow のみ / global のみで「常時 success 行が残る」テストが欠ける

設計受け入れ・Spec coverage 表は Task 2 担当と書くが、RED サンプルに:

- shortWindowRetryAt あり + success 3 + attempts 5 → **「受け付けます」可視**かつ CTA disabled  
- global false 同様

が無い。実装が `hasActiveUsageBlocker` 全体で success 行を消す（旧案の広い hide）でもテストが落ちない。

**要求:** Task 2 に明示 it を2本。

---

### P-I3. request-local フォールバック（userId なし）の実装がコメント止まり

設計: userId なしでも success 残は受け付け口調。  
plan Task 4: `// request-local fallback の success 行も受け付け口調に` のみ。

現行:

```tsx
formatFreeTierQuotaCopy(`成功回数：本日あと${...}回`)
// + retryAt 行
```

**要求:** 置換後の正確な JSX を plan に書く。未減文の置換も conflict / failed の両 branch にコードで示す。

---

### P-I4. failed + `user_short_window_limit` で retryAt 必須の受け入れが Task 4 に落ちていない

設計: message に時刻なし → **UI が `retryAt` を Must 表示**。

Task 4 の TerminalGenerationUsage は `usage/today` の shortWindow.retryAt / data.retryAt に依存。  
**request-local 経路**は `state.data.quota.retryAt` あり。  
userId ありでも usage 取得前は時刻が無い一瞬がある。

更に: failed の `error.message` だけ見て Terminal が success 残だけ出す構成で、**quota.retryAt を failed パネル直下に出さない**と、usage の shortWindow.retryAt が null のレースで時刻欠落。

**要求:** Task 4 に受け入れ it または実装規則:

```text
failed / conflict で state.data.quota.retryAt != null のとき、
Terminal 有無にかかわらず再開時刻を1行出す（request-local と dual でも可）。
```

---

### P-I5. File map / Task 1 のテストパスが曖昧

- `netlify/functions/_shared/generation-service.test.ts` は存在  
- 加えて `_tests/generation-status.test.ts`, `_tests/generate-menu.test.ts` が旧 message を hardcode（grep 済み）

plan は「無ければ _tests」と書くが、**既知ヒットを File map に列挙していない**。実装者が Step 5 grep を飛ばすと Task 1 GREEN が部分的。

**要求:** File map に既知パスを列挙し、Task 1 Step 5 の Expected を「これらを含むゼロヒット」に。

---

### P-I6. `formatFreeTierQuotaCopy` 後の「無料版は本日は」非生成がテストされない

設計受け入れ表の行が plan のどの Task にも exact assert が無い（UI 経由の getByText で間接的には attempts0 文があるが、**ヘルパ単体 or 明示コメント**が無い）。

**要求:** Task 2 または shared/copy に1行:

```ts
expect(formatFreeTierQuotaCopy("今日は新しい献立の作成を受け付けられません。…")).not.toMatch(/無料版は本日は/u);
```

（body が `今日は` であることの固定。）

---

### P-I7. 再生成 `attemptsRemaining === 0` と `null` の境界

plan:

```ts
const attemptsBlocked = usage.attemptsRemaining === 0;
```

`null === 0` は false → 未取得で止めない。設計どおり。  
しかし **error: true** のとき既存は disabled。attempts が 0 と error の組み合わせは問題なし。

**穴:** `attemptsRemaining: 0` かつ `loading: true` は通常来ないが、来たら loading で disabled。OK。

明記推奨: `attemptsRemaining === null` では attemptsBlocked にしない（確認の null 方針と揃える）— plan 本文に1文。

---

### P-I8. Task 5 の vitest 複数ファイル指定がシェル1コマンドとして正しいか

```bash
docker compose run --rm --no-deps app npm test -- --run \
  shared/contracts/... \
  ...
```

プロジェクトの vitest が複数パスを受け付けるなら OK。受け付けない場合 false 失敗。  
**要求:** 1ファイルずつか、`npm test -- --run "quota-copy pattern"` の実プロジェクト慣習を plan に合わせる（現状 monorepo は複数パス可が多いが未検証と注記）。

---

### P-I9. e2e / acceptance が「触らない」寄りすぎ

設計: E2E が旧文言を掴んでいれば更新。  
plan: Task 5 に e2e なし。grep でも `e2e/` を対象外。

現状 e2e に旧文言が無い可能性は高いが、**adversarial としては `e2e` を Step 1 grep に含める**のが安い。

---

### P-I10. freemium 設計 superseded が Task 4 の feat コミットに同居

文書だけを feat に混ぜると履歴が濁る。許容範囲だが、Task 4 を UI と docs で分けるか、commit message に docs を含める現状で **docs 変更を必ず add する**と明記。

---

### P-I11. Spec coverage の自己矛盾

| 行 | 問題 |
|----|------|
| 「failureCopy ≡ issueMessages \| 1」 | P-C1 で実質未担保 |
| 「short/global のみでは success 行維持 \| 2」 | テスト手順なし（P-I2） |
| 「Placeholder scan: なし」 | P-C2 が placeholder |

self-review が虚偽 → 実装前に plan 改訂で直すこと。

---

## Minor

### P-M1. Task 1 の `expect(text.includes(fragment), msg)`  

Vitest の asymmetric 第2引数は版依存。plan は読み替え注記あり → OK だが最初から:

```ts
expect({ code, fragment, text }).toEqual({ code, fragment, text: expect.not.stringContaining(fragment) });
```

の方がコピペ事故が少ない。

### P-M2. regeneration test helper の `attemptsRemaining: 12`

旧 12 枠の名残。動作には支障ないが、実装時に 6 に直すと読みやすい（必須ではない）。

### P-M3. Task 2 が `planner-route*.test.tsx` を File map に入れていない

現状 grep 上、文言は wizard 側が主。route が usage を渡すだけなら不要。確認済みなら「route テストに文言なし」と注記。

### P-M4. コメント内の「成功回数」  

`generation-status-panel.tsx` 先頭コメント等。Task 5 Expected「コード・テストは不可」は厳しすぎてコメント修正まで要求するか曖昧。**ユーザー向け文字列リテラルとテスト期待のみゼロ**と緩和した方が実装可能。

### P-M5. Execution Handoff の問いかけが plan 本文に残存

実装計画として配布するなら末尾の「どちらで進めますか？」は運用ノイズ。任意で削除。

### P-M6. AGENTS「1コマンド1呼び出し」と plan の複数 docker 連続 Step

Step 分割はできている。エージェントが `&&` でまとめるリスクを Global Constraints に再掲済み — OK。

---

## 設計受け入れ表 vs plan（ギャップ一覧）

| 設計受け入れ | plan |
|--------------|------|
| 確認 常時1行 | Task 2 サンプルあり |
| attempts0 バナー・常時行なし | サンプルあり。既存 it 更新不足（P-C3） |
| success0∧attempts0 は success0 のみ | coverage のみ。RED 不足（P-C3） |
| short のみ success 行維持 | coverage のみ（P-I2） |
| global のみ success 行維持 + 0:00 | 0:00 文サンプルあり。success 行維持なし（P-I2） |
| 再生成 attempts0 disabled | Task 3 完全 |
| 再生成 shortWindow | **空 it（P-C2）** |
| issueMessages 新文 | Task 1 |
| failureCopy 一致 | **逃げ（P-C1）** |
| 未減1行 | Task 4 |
| short 失敗 retryAt | 弱い（P-I4） |
| 無料版は本日は 禁止 | 間接のみ（P-I6） |
| freemium superseded | Task 4 |

---

## 指摘サマリ

| ID | 重大度 | 要約 |
|----|--------|------|
| **P-C1** | Critical | failureCopy 一致 assert を目視に弱体化 |
| **P-C2** | Critical | short-window 再生成テストが空 |
| **P-C3** | Critical | success0∧attempts0 既存テストが両文要求のまま |
| **P-C4** | Critical/Imp | 禁止リストと Task5 grep の穴・緩和リスク |
| **P-I1** | Important | `&&` 連結コミット |
| **P-I2** | Important | short/global で success 行維持のテスト欠 |
| **P-I3** | Important | request-local JSX 未記載 |
| **P-I4** | Important | failed retryAt Must が薄い |
| **P-I5** | Important | 既知 fixture パス未列挙 |
| **P-I6** | Important | 無料版は本日は の明示テスト欠 |
| **P-I7–11** | Imp/Minor | null 境界・e2e・coverage 虚偽等 |

---

## 判定

**ACCEPT_WITH_CHANGES**

実装開始前に plan を改訂すること。最小セット:

1. **P-C1** failureCopy 一致をテスト可能な形で Must 化  
2. **P-C2** short-window 再生成テストを全文  
3. **P-C3** wizard の両文 it を success0 のみに書き換え指示  
4. **P-I1** コマンド分離  
5. **P-I2** short/global success 行 it  
6. **P-I3 / P-I4** 終端の request-local と retryAt をコードで固定  
7. self-review「Placeholder なし」を事実に合わせる  

方針・Task 順序・設計文言そのものは支持する。上記は **plan の実行可能性と false green 防止**のための修正である。

---

## 根拠（検証した現行コード）

- `planner-wizard.test.tsx` 961–980: success0∧attempts0 で問い合わせ文を要求  
- `regeneration-sheet.tsx` submitDisabled: success のみ（案 A 未実装）  
- `generation-service.ts` failureCopy 生文字列二重定義  
- `_tests/generation-status.test.ts` / `generation-service.test.ts`: 旧「成功回数には含まれません」  
- `generation-status-panel.tsx`: dual 残数・request-local `成功回数：`  
- 設計 Accepted の L8 / D-I7 / 受け入れ表
