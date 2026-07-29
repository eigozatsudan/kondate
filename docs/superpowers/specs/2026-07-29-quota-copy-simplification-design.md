# 利用回数コピー簡素化（低リテラシー向け）設計

| 項目 | 値 |
|------|-----|
| 文書 | `docs/superpowers/specs/2026-07-29-quota-copy-simplification-design.md` |
| 日付 | 2026-07-29 |
| 状態 | **Approved**（2026-07-29 ユーザー承認。再生成案 A / 敵対的 D-* 反映済み） |
| 関連 | MVP `2026-07-11-kondate-mvp-design.md` §10.3 / §11.2 / §14、無料版文言 `2026-07-28-season-freemium-quota-design.md` Feature 2 |
| 先行議論 | 確認画面の「作成あと3回」「問い合わせあと6回」並記がユーザーに不明瞭 |
| レビュー | 方針 ADV（セッション）; 設計書敵対的 `docs/reviews/2026-07-29-quota-copy-simplification-design-adversarial.md`（D-C1〜 / 再生成 **案 A**） |

---

## Overview

エンドユーザー向けの**利用回数・上限・失敗**の日本語を簡素化する。  
内部の成功枠（3）・外部 attempt 枠（6）・短時間枠（4/10分）・global（20）の**数値・判定・API 形は変更しない**。変えるのは**見せ方と `issueMessages` / Function `failureCopy.message`**。

目標体験:

1. 普段は「今日あと何回くらい作れそうか」が**1数字**で分かる。
2. 仕組み（成功と通信の二枠、失敗も attempt に入る等）は**教えない**。
3. ブロック時は**行動**（いつ再挑戦できるか）だけ伝える。
4. 作成回数を使い切ったのか、受付を止めているのかは**トーンだけ分け**、内部用語は出さない。
5. 確認と再生成で、個人枠の受付不能は**同じように事前に止め**、押してから attempt 上限で落ちる非対称を作らない（**案 A**）。

---

## Background & Motivation

### 現状の痛み

確認画面（`review-step`）例:

```text
無料版は本日あと3回作成できます
無料版はAIへの問い合わせは本日あと6回まで受け付けます
```

制作側は success / attempt の別枠だと分かるが、ターゲット（非エンジニアの家庭利用者）には**同じような制限が違う数字で2行**に見え、意味が取れない。

失敗面（`issueMessages` / `generation-status-panel`）はさらに運用寄り:

- 「献立の成功回数とは別の上限です」
- 「AI通信試行」「10分間の通信試行」
- 「成功回数には含まれません」

再生成シートは success のみ disabled で、**attempts=0 でも送信可**（確認画面と非対称）。

### 既存指摘との関係

| 過去 ID | 内容 | 本設計の扱い |
|---------|------|----------------|
| C-I12 / I-G2 | 確認が成功残だけだと attempt／短期が弱い | **意図は維持**: 受付不能を事前に隠さない（CTA 無効 + 平易文）。**手段は破棄**: 常時 dual 残数 |
| I-X1 / C-I13 | 「AI通信試行」等は主婦向けでない | **主根拠の一つ**として採用 |
| §10.3 / §14 | attempt 残・「別上限」説明・dual 消費表示 | **本設計が利用者向け表示の正**（下記 Supersede）。枠ロジックは §11.2 維持 |
| §11.2 | 成功3は常に保証されない | ロジック維持。表示は保証口調を弱める（完全非保証にはしない → R1） |

### 人間と合意済みのロック（再導出禁止）

| # | 決定 |
|---|------|
| L1 | **常時**表示は success 残の**1行のみ**。attempt 残の常時行は出さない（確認・再生成・終端） |
| L2 | attempts **逼迫**（例: 残り1かつ >0）の**事前警告は出さない**。`attemptsRemaining === 0` は blocker（事前 disable + 文）。L2 の範囲は「>0 のときの追加警告を出さない」こと |
| L3 | **`issueMessages`（API が返す日本語）まで直す**。UI だけの差し替えにしない |
| L4 | 作成 0 と attempt 0 は **CTA 無効は同じ**だが、**ユーザー向けトーンは分ける**（「作成上限」≠「受付停止」）。仕組み語は使わない |
| L5 | 数値・DB・予約ロジック・`GET /api/usage/today` の shape は変更しない |
| L6 | `formatFreeTierQuotaCopy`（文頭「無料版は」）は個人枠の制限説明に継続適用。global 混雑文には付けない |
| L7 | 有料課金 UI・枠数値の変更・attempt 枠の廃止は非スコープ |
| L8 | **再生成は案 A**: 確認と揃え、`attemptsRemaining === 0` および short-window ブロック時は **submit disabled + 数字なしの1文**。常時 attempt 残行は出さない |
| L9 | 利用者向け再開時刻表記は **`明日0:00（日本時間）`** に統一（「0時」は使わない） |
| L10 | allowlist の正本は**本設計**。freemium 設計 §2.1 は同一実装列車で `superseded by` 追記する（二又禁止） |

---

## Goals & Non-Goals

### Goals

- 確認・再生成・生成終端で、**第二の残数行**（問い合わせ／AI通信試行）を出さない。
- 主残数の口調を「作成できます」から**受け付け**系へ寄せ、保証口調を弱める（**完全な非保証表現ではない**。attempt 先食いの体感差は R1）。
- ブロック時バナーと `issueMessages` の quota 系を、低リテラシー向けの固定文言に揃える。
- 失敗で success を消費していないとき、「作成回数は減っていません」を**二重表示せず1か所**（UI）で示す。
- `failureCopy[code].message` は **`issueMessages[code]` を参照**し、文字列のコピー＆ペースト二重定義を禁止する。
- 確認と再生成で個人 attempt / 短時間ブロックの事前扱いを揃える（L8）。

### Non-Goals

- 成功3 / attempt6 / 短時間4 / global20 の値変更や窓アルゴリズム変更。
- attempts 残が少ないとき（>0）の事前ソフト警告（L2）。
- 枠の仕組みを教えるヘルプ画面・ツールチップ。
- 英語 UI、課金プラン比較。
- `usage/today` レスポンスのフィールド削除（クライアントが内部判定に使い続ける）。
- 再生成の success 説明文を「受け付け」口調へ統一すること（完成時のみ減る説明は据え置き。L 意図: D-I9）。

### 成功受け入れ表

| シナリオ | 期待 |
|----------|------|
| 確認 step、success 3 / attempts 6 | 「無料版は本日あと3回まで献立の作成を受け付けます」**のみ**。問い合わせ6行は**無い** |
| 確認 step、success 3 / attempts 1 | 同上（事前の逼迫警告なし）。主 CTA は attempts>0 なら有効のまま |
| 確認 step、attempts 0（success>0） | 常時 success 行**なし**。バナー: 受付停止トーン（`今日は…`）。CTA 無効。数字の第二行なし |
| 確認 step、success 0 | 常時 success 行なし。バナー: 作成上限トーン。CTA 無効 |
| 確認 step、shortWindow のみ（success>0, attempts>0） | 常時 success 行**あり**。待ち＋時刻。CTA 無効 |
| 確認 step、global のみ | 常時 success 行**あり**。混雑＋明日0:00。CTA 無効。「無料版は」なし |
| 再生成、通常 | 完成時1回使用＋残り success のみ。attempt 常時行なし |
| 再生成、attempts 0 | submit **disabled** + 受付停止トーン1文（数字なし・無料版接頭） |
| 再生成、shortWindow ブロック | submit **disabled** + 待ち＋時刻（既存平易文） |
| 生成失敗 `user_attempt_limit` | API `message` が新文言。「別の上限」「送信」「通信試行」なし |
| 生成失敗・`quota.consumed=false` | UI に「献立は完成していないので、作成回数は減っていません」**1回のみ**（message 本文に未減を埋め込まない） |
| constraint_conflict・未消費 | 同上の未減1行 |
| short window 失敗 | message は平易短文。**`retryAt` があれば UI が必ず時刻を出す** |
| 終端 `TerminalGenerationUsage` | success 残1行＋必要時の再開/混雑のみ。AI通信試行・10分**残数**行なし |
| `formatFreeTierQuotaCopy(attempts0 body)` | **「無料版は本日は」を生成しない**（body は `今日は…`） |
| unit | 旧文言期待を更新。`issueMessages` 全 failure code の message が `failureCopy` と一致。禁止部分文字列（下記） |

---

## Spec supersede（本設計が利用者向け表示の正）

実装・レビューは本表を優先する。枠の**数値・判定・保持**は MVP §11.2 および release 固定値のまま。

### §10.3（操作上の配慮）

| 旧（MVP 本文の要求） | 新（本設計） |
|----------------------|--------------|
| 生成ボタン近くに成功残に加え attempt 受付可否等を平易表示 | **成功残 N のみ常時**。attempt は残数表示せず、0 のとき disable + 受付停止文 |
| 失敗時は成功に含まれないことと **attempt が別上限に含まれることを区別表示**し、成功残・**attempt 残**・再試行時刻を**必ず**表示 | 未消費時のみ「作成回数は減っていません」。**attempt 消費・attempt 残は表示しない**。再試行時刻は `retryAt` があるとき UI で表示 |
| 短期枠の残回数表示 | 残 K は出さない。`retryAt` があるときだけ待ち文 |

### 生成状態表示（MVP の failed 表示要求）

| 旧 | 新 |
|----|-----|
| `failed` で成功残・**外部 attempt 残**・再試行時刻を表示 | 成功残（受け付け口調）・再試行時刻（あれば）。**attempt 残は出さない** |

### §14（エラー処理と表示）— 利用者向け message の正

| 種別 | 旧 MVP 文言の扱い | 本設計の正（issueMessages / 同等 UI） |
|------|-------------------|----------------------------------------|
| 個人成功上限 | 「今日は3回利用しました…」は**破棄**（回数リテラル禁止） | `本日の作成上限に達しています。明日0:00（日本時間）以降にお試しください。` |
| 利用者 attempt 日次上限 | 「AIへの送信」「別の上限」は**破棄** | `今日は新しい献立の作成を受け付けられません。明日0:00（日本時間）以降にお試しください。` |
| 短期 rate limit | 具体的再開時刻を要求 | message は待ち促し。**時刻は UI が `retryAt` で必ず表示**（確認バナーは文中に日時可） |
| 全体上限 | 「成功回数には含まれません」入りは**破棄** | `ただいま混雑しています。明日0:00（日本時間）以降にお試しください。`（未減は UI 行） |
| モデル混雑・停止 | 「送信回数には含まれます」＋ attempt 残は**破棄** | `AIが混み合っています。` + 未減 UI 行 + 再開情報（あれば） |
| 不正 AI / timeout / internal | 旧「成功回数には含まれません」埋め込みは**破棄** | 短文 + 未減 UI 行 |
| 緊急献立への導線 | 維持 | 既存 RecoveryLinks 等を維持（本設計で削除しない） |

### 無料版 allowlist

`2026-07-28-season-freemium-quota-design.md` §2.1 の旧表は**本設計 §「無料版 allowlist」が正**。  
実装列車で freemium 設計に次を追記する（L10）:

```text
§2.1 allowlist 本文は 2026-07-29-quota-copy-simplification-design に superseded。
```

---

## Proposed Design

### 表示原則

```text
[通常]  主数字 = success.remaining のみ（受け付け口調）
[事前]  attemptsRemaining > 0 の逼迫警告は出さない（L2）
[ブロック] success==0 / attempts==0 / shortWindow / global で CTA 無効
           （確認・再生成とも。再生成に global が無い場合は usage 供給範囲に従う）
[常時行 hide] usageRemaining===0 または attemptsRemaining===0 のときだけ
              常時 success 残行を出さない（short/global のみでは消さない）
[複数 body]  同時に複数理由が立っても body は出してよい（隠さない）。
              ただし success0 と attempts0 が同時なら success0 文のみ出す
[失敗後] issueMessages 平易文 +（未消費なら）作成回数未減 1 行
         retryAt があれば時刻行 Must
         usage 主数字は success のみ
```

### 画面別

#### 1. `review-step`（確認）

| 条件 | 表示 |
|------|------|
| 常時 success 行 | `usageRemaining !== null && usageRemaining !== 0` **かつ** `usageRemaining !== 0` の blocker 理由が success0/attempts0 でないこと。すなわち **`usageRemaining > 0 && attemptsRemaining !== 0`**（attempts 未取得 `null` は既存どおり誤停止しない: 常時行は success のみ見てよいが、attempts===0 のときは出さない） |
| 常時文 | `無料版は` + `本日あと{n}回まで献立の作成を受け付けます` |
| attempt 常時行 | **削除** |
| success0 body | `無料版は` + `本日の作成上限に達しています。明日0:00（日本時間）以降にお試しください。` |
| attempts0 body | `無料版は` + `今日は新しい献立の作成を受け付けられません。明日0:00（日本時間）以降にお試しください。`（**「本日は」禁止** → 「無料版は本日は」を避ける） |
| success0 ∧ attempts0 | **success0 body のみ**（attempts0 body は出さない） |
| global false | `ただいま混雑しています。明日0:00（日本時間）以降にお試しください。`（「無料版は」なし。「しばらく」は使わない） |
| shortWindow | 現行の待ち＋**JST 日時**文を維持（通信試行語なし） |

バナー title「いまは新しい献立を作れません」は維持（接頭なし）。  
`hasActiveUsageBlocker` 判定ロジックは維持。

**常時 success 行の実装条件（確定）:**

```text
showSuccessRemaining =
  usageRemaining !== null
  && usageRemaining > 0
  && attemptsRemaining !== 0   // null は「未取得」で行は出してよい。0 のときだけ隠す
```

#### 2. `regeneration-sheet`（案 A）

| 条件 | 表示・操作 |
|------|------------|
| success 残あり | 据え置き: `別の献立が完成した場合に1回使用・現在残り{n}回`（無料版接頭）。受け付け口調へは**変えない** |
| success 不明 | 据え置き: `別の献立が完成した場合に1回使用します` |
| attempt 常時行 | **削除** |
| successRemaining === 0 | submit disabled（既存）+ 作成上限トーン1文（確認と同趣旨・無料版接頭可） |
| attemptsRemaining === 0 | submit **disabled（新規 Must）** + 受付停止トーン1文（確認の attempts0 と同文・無料版接頭） |
| shortWindow ブロック | submit **disabled（新規 Must）** + 待ち＋時刻（既存平易文） |
| success0 ∧ attempts0 | success0 文のみ（確認と同じ優先） |

`submitDisabled` に含める（確定）:

```text
successRemaining === 0
|| attemptsRemaining === 0
|| (shortWindowRemaining === 0 && shortWindowRetryAt !== null)
// 既存: submitting / !actionsEnabled / loading / error / expiredUnconfirmed
```

`attemptsRemaining === null`（未取得）では attempt 理由で止めない（確認の null 方針と揃える）。  
loading / error 時は既存どおり送信不可。

#### 3. `generation-status-panel` / `TerminalGenerationUsage`

| 削除 | 残す・置換 |
|------|------------|
| `AI通信試行：本日あと{m}回` | なし |
| `10分間の通信試行：あと{k}回` | なし。`shortWindow.retryAt` または `quota.retryAt` があるときだけ待ち・再開文 |
| `成功回数：本日あと{n}回` | `無料版は本日あと{n}回まで献立の作成を受け付けます` |
| 読込失敗「最新のAI通信試行残数を…」 | `本日の作成回数を確認できません。再読み込みしてください` |
| `!quota.consumed` の「成功回数には含まれません」 | `献立は完成していないので、作成回数は減っていません` |

`アプリ全体：作成できます / 今日はここまで` は維持（無料版接頭なし）。  
request-local フォールバックも success 残は受け付け口調に揃える。

**Must:** `user_short_window_limit` 等で `retryAt` が response にあるとき、message に時刻が無くても **UI が時刻行を描画**する。

#### 4. 契約メッセージ `issueMessages` + Function `failureCopy`

**正本:** `shared/contracts/generation.ts` の `issueMessages`。

**サーバー Must:**

```text
failureCopy[code].message === issueMessages[code]
// message 文字列を service に再定義しない。issueMessages を import して参照する。
// retryable フラグは service ローカルでよい。
```

単体テスト: 全 `GenerationFailureCode` について上記一致を assert。

変更対象（本文固定）:

| code | 新 message（確定） |
|------|-------------------|
| `user_daily_limit` | `本日の作成上限に達しています。明日0:00（日本時間）以降にお試しください。` |
| `user_attempt_limit` | `今日は新しい献立の作成を受け付けられません。明日0:00（日本時間）以降にお試しください。` |
| `user_short_window_limit` | `短い時間に何度も作成を試したため、少し待つ必要があります。しばらくしてから再度お試しください。` |
| `global_daily_limit` | `ただいま混雑しています。明日0:00（日本時間）以降にお試しください。` |
| `model_unavailable` | `AIが混み合っています。` |
| `invalid_ai_response` | `献立を正しく確認できませんでした。` |
| `generation_timeout` | `作成に時間がかかりました。` |
| `internal_error` | `献立を作成できませんでした。` |
| `duplicate_output` | `元の献立とほぼ同じ案だったため保存しませんでした。` |

**意図的に本文から外す語:**

- 成功回数 / 別の上限 / AIへの送信 / 通信試行 / 問い合わせ / attempt
- 「成功回数には含まれません」（UI の `!quota.consumed` 行に集約）
- 回数リテラル（「3回利用」等）

その他の `issueMessages`（同意・アレルギー等）は対象外（維持）。

#### 5. 無料版 allowlist（正本・本設計）

`formatFreeTierQuotaCopy` を掛ける対象（葉）:

| 箇所 | body（接頭前） |
|------|----------------|
| review / Terminal 常時 | `本日あと{n}回まで献立の作成を受け付けます` |
| success0（確認・再生成） | `本日の作成上限に達しています。明日0:00（日本時間）以降にお試しください。` |
| attempts0（確認・再生成） | `今日は新しい献立の作成を受け付けられません。明日0:00（日本時間）以降にお試しください。` |
| short-window（日時動的） | 現行平易文 |
| regeneration 完成時1回 | 現行2文 |
| failure_code ラップ | `user_daily_limit` / `user_attempt_limit` / `user_short_window_limit` のみ |

**表示削除（allowlist からも外す）:**

- `AIへの問い合わせは本日あと{n}回まで受け付けます`
- `AI通信試行：本日あと{n}回`
- `10分間の通信試行：あと{n}回`

**denylist（ラップしない）:**

- `献立は完成していないので、作成回数は減っていません`
- 読込失敗・確認中の状態文
- global 混雑文
- `アプリ全体：…`

### データフロー（判定は変更なし・表示のみ）

```text
GET /api/usage/today
  → success / attempts / shortWindow / global
  → CTA・disabled に attempts を使う（確認・再生成）
  → 常時ラベルには success のみ

POST generate | regenerate / status failed
  → failure_code + message（issueMessages）
  → パネル: message + !consumed なら未減1行 + retryAt なら時刻
  → TerminalGenerationUsage: usage/today（success 主表示）
```

### エラー・境界

| ケース | 扱い |
|--------|------|
| usage 未取得 | 既存: 確認中 / 失敗文。attempt 専用エラー語にしない |
| success>0 ∧ attempts=0 | 常時 success 行なし + 受付停止バナー + CTA 無効 |
| short/global のみ | 常時 success 行あり + 各 body + CTA 無効 |
| 失敗 message と未減行 | message に未減を書かない。UI が `!consumed` のときだけ |
| short window message | 時刻なし。UI が `retryAt` を Must 表示 |
| 旧クライアント | SPA 再デプロイ前提 |

### テスト

**契約ガード（Must）:**

- 全 `GenerationFailureCode` で `failureCopy[code].message === issueMessages[code]`
- `issueMessages` の全 value および本設計が列挙する UI 固定文について、次の部分文字列を**含まない**（ユーザー向け）:
  - `成功回数` / `別の上限` / `AIへの送信` / `通信試行` / `問い合わせ` / `attempt`
- 接頭後に `無料版は本日は` が**現れない**（attempts0 body が `今日は`）

**UI / Function fixture:**

- `review-step` / `planner-wizard` / `regeneration-sheet`（disabled 条件含む） / `generation-status-panel` / `generation-page`
- `generation-service` / generate-menu / generation-status の message 期待
- freemium ヘルパ自体は変更なし。呼び出し元・allowlist コメント更新
- E2E が旧文言を掴んでいれば更新

---

## Residual risks（受容）

| ID | リスク | 緩和 | 受容理由 |
|----|--------|------|----------|
| R1 | success 残表示中に attempt を先に使い切り、体感「あとN回」が実現しない | 受け付け口調；attempts=0 で事前停止；逼迫（>0）は警告しない | ユーザー決定（L2）+ §11.2 |
| R2 | 受付停止と作成上限の違いが一部ユーザーに伝わらない | L4 トーン分離 | 仕組み説明よりマシ |
| R3 | サポートが画面から枠種別を読み取れない | failure_code は API/ログ | ユーザー画面優先 |
| R4 | C-I12 再燃（attempt 残が見えない） | disable + 平易 blocker / 失敗文。dual number に戻さない | 意図的 |
| R5 | 複数バナー body が並ぶと重い | success0∧attempts0 は1本化。他は併記許容 | 理由を隠さない方を優先 |
| R6 | 「受け付けます」がなお保証に聞こえる | Goals で完全非保証を主張しない | R1 と一体 |

---

## PR / 実装分割（案）

同一リリース必須（L3 / L10）:

1. **契約**: `issueMessages` 改訂 + `failureCopy` 参照化 + 一致・禁止文字列テスト  
2. **UI**: review / regen（案 A disabled）/ status panel  
3. **文書**: freemium §2.1 に superseded 追記  

---

## 敵対的レビュー反映チェック

### 方針 ADV（セッション）

| ADV | 反映 |
|-----|------|
| ADV-1 過大表示 | 受け付け口調 + R1/R6。完全非保証は Goals で主張しない |
| ADV-2 同一文言統合 | L4。success0∧attempts0 は success0 のみ |
| ADV-3 C-I12 | Supersede + 事前 disable 維持 |
| ADV-4 issueMessages | L3・表 |
| ADV-5 TerminalUsage | 第二数字削除 |
| ADV-6 再生成 | L8 案 A |
| ADV-7 無限再試行 | 未減1行のみ |
| ADV-8 無料版冗長 | title 接頭なし；attempts0 は「今日は」 |
| ADV-9 閾値 | L2 で >0 警告なし |
| ADV-10 テスト | 禁止文字列・一致テスト Must |
| ADV-11 global | 混雑 + 0:00。接頭なし |

### 設計書レビュー（D-*）

| ID | 反映 |
|----|------|
| D-C1 | Supersede を §10.3 失敗・状態・§14 まで拡張 |
| D-C2 | attempts0 body を `今日は…` に変更 |
| D-C3 | **案 A** を L8 で固定 |
| D-I1 | 常時行 hide を success0/attempts0 に限定 |
| D-I2 | 複数 body 許容 + success0∧attempts0 は1本 |
| D-I3 | global 事前も明日0:00 に揃え |
| D-I4 | retryAt UI Must |
| D-I5 | Goals を R1 整合に修正 |
| D-I6 | L10 freemium superseded 必須 |
| D-I7 | failureCopy 参照 Must + 全 code テスト |
| D-I8 | L9 で 0:00 統一 |
| D-I9 | 再生成 success 文は据え置きと明記 |
| D-I10 | 禁止部分文字列を列挙 |
| D-M1 | 状態・レビュー欄を更新 |
| D-M2 | 受け入れ表を拡充 |
| D-M6 | L2 スコープを >0 のみと明記 |

---

## Self-review（改訂後）

1. **Placeholder:** なし。文言・disabled 条件は固定。  
2. **Internal consistency:** L2（逼迫は警告しない）と L8（0 は事前停止）は両立。常時行 hide は D-I1 どおり狭い。  
3. **Scope:** 表示と message。quota ロジック非対象。  
4. **Ambiguity:** 案 A / failureCopy 参照 / freemium 正本 / 0:00 / hide 条件を Locked 化済み。  
5. **親仕様:** Supersede 表が §14 まで及ぶ。§11.2 数値は触らない。
