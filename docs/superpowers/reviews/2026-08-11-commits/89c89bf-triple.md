# Triple review: `89c89bf`

- **SHA:** `89c89bf6d53397bdbad53735635c4bac09f7aa8c`
- **Subject:** `fix: update navigate function type to support Promise<void> in planner leave flush`
- **Parent:** `c7570ac94933ce35b80cae0375d10566a42df64a`
- **手法:** `planner-leave-flush.ts` の型と呼び出し側（`navigateAfterPlannerLeaveFlush` / AppShell / tests）の整合。認証コミット列とは独立。
- **独立評価:** 型・await 互換のみ。leave-flush 本体ロジックの再設計は対象外。

---

## 1次レビュー

### Summary

`navigateAfterPlannerLeaveFlush` の `navigate` 引数型を  
`(to: string) => void` から **`(to: string) => void | Promise<void>`** に広げ、`await navigate(to)` する。

背景: React Router の `NavigateFunction` は `void | Promise<void>` を返し得る。`void` 固定だと呼び出し側で `@typescript-eslint/no-misused-promises` 等が発火しうる。コメントもその意図を日本語で説明。

挙動:

- `proceed` のときだけ navigate（blocked 時 stay）— 変更なし。
- `await navigate` は navigate が Promise を返す場合に settle を待つ。`void` のときは即解決。

セキュリティ・認証・quota に非接触。planner leave の「失敗を黙殺しない」契約を壊さない。

### Verdict: **APPROVE**

### Findings

#### Critical / Important

（なし）

#### Minor

##### F1. navigate が reject したとき leave-flush 呼び出し側へ伝播

- **Confidence:** 60
- **Where:** `await navigate(to)` in `navigateAfterPlannerLeaveFlush`
- **Why:** 以前 `void` 呼び出しだと fire-and-forget 気味。await 後は reject が呼び出しの Promise に載る。AppShell の NavLink 経路は `runPlannerLeaveFlush` を直接使い `void navigate` しており本ヘルパと別。本ヘルパ利用者は try/catch を持つか確認が必要だが、RR navigate が通常 throw しない前提では実害は低い。
- **Fix:** 必要なら内部 try/catch で proceed 後の navigate 失敗を握りつぶさず status 化。現状 defer 可。

##### F2. テストが async navigate を明示していない

- **Confidence:** 55
- **Where:** `planner-leave-flush.test.ts`
- **Why:** `vi.fn()` は同期。`Promise.resolve` を返す navigate の await を固定するテストは無い。型修正の回帰価値は限定的。
- **Fix:** 任意で async navigate mock を 1 本。

---

## 敵対的レビュー

**姿勢:** 型緩和が「何でも await して進む」抜け道や二重 navigate を生まないか。

### Attack / failure matrix

| # | シナリオ | 判定 | 根拠 |
| --- | --- | --- | --- |
| A1 | blocked なのに navigate | **反証** | `result === "proceed"` のときだけ navigate。 |
| A2 | 二重 leave / 連打 | **本 diff 非悪化** | AppShell は `navLeavingRef`。本ヘルパ単体に in-flight ガードは無いが型変更前と同じ。 |
| A3 | open redirect via `to` | **呼び出し側責任** | ヘルパは `to: string` をそのまま渡す。既存 NavLink `item.to` はアプリ内 path。本 diff が外部 URL を新たに受けない。 |
| A4 | Promise navigate 未 await で flush 前に unmount | **緩和方向** | await により flush 成功後の遷移完了を待ちやすい。 |
| A5 | 型を広げて危険な navigate 実装を注入 | **低** | テストダブルのみ。実行時は RR navigate。 |
| A6 | auth / magic-link 経路への波及 | **反証** | planner leave のみ。auth-gateway の `navigate: assign` とは別。 |

### Adversarial verdict: **PASS**

---

## 2次検証

| ID | 主張 | 判定 | 根拠 |
| --- | --- | --- | --- |
| 型互換 | RR NavigateFunction と整合 | **CONFIRMED** | live `navigate: (to) => void \| Promise<void>` + コメント。`await navigate(to)`。 |
| blocked 契約 | 維持 | **CONFIRMED** | proceed 分岐のみ。tests: blocked 時 not called。 |
| F1 reject 伝播 | 稀 | **CONFIRMED Minor** | must-fix ではない。 |
| F2 テスト薄い | 任意 | **CONFIRMED Minor** | |
| A3 open redirect | 新規なし | **CONFIRMED** | |
| A6 auth 非接触 | **CONFIRMED** | ファイル `planner-leave-flush.ts` のみ想定。 |

### Must-fix

**なし。**

### 2次 Verdict: **APPROVE**

---

## 総合（本ファイル）

| 観点 | 結果 |
| --- | --- |
| 1次 | APPROVE |
| 敵対 | PASS |
| 2次 | APPROVE |
| **最終** | **APPROVE** |
