# 利用回数コピー簡素化（低リテラシー向け）設計

| 項目 | 値 |
|------|-----|
| 文書 | `docs/superpowers/specs/2026-07-29-quota-copy-simplification-design.md` |
| 日付 | 2026-07-29 |
| 状態 | **Draft — ユーザーレビュー待ち** |
| 関連 | MVP `2026-07-11-kondate-mvp-design.md` §10.3 / §11.2、無料版文言 `2026-07-28-season-freemium-quota-design.md` Feature 2 |
| 先行議論 | 確認画面の「作成あと3回」「問い合わせあと6回」並記がユーザーに不明瞭 |
| 敵対的レビュー | 本セッション実施（ADV-1〜11）。本設計に Must 反映済み |

---

## Overview

エンドユーザー向けの**利用回数・上限・失敗**の日本語を簡素化する。  
内部の成功枠（3）・外部 attempt 枠（6）・短時間枠（4/10分）・global（20）の**数値・判定・API 形は変更しない**。変えるのは**見せ方と `issueMessages` / 同文言のサーバー failure copy**。

目標体験:

1. 普段は「今日あと何回くらい作れそうか」が**1数字**で分かる。
2. 仕組み（成功と通信の二枠、失敗も attempt に入る等）は**教えない**。
3. ブロック時は**行動**（いつ再挑戦できるか）だけ伝える。
4. 作成回数を使い切ったのか、受付を止めているのかは**トーンだけ分け**、内部用語は出さない。

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

### 既存指摘との関係

| 過去 ID | 内容 | 本設計の扱い |
|---------|------|----------------|
| C-I12 / I-G2 | 確認が成功残だけだと attempt／短期が弱い | **意図は維持**: 受付不能を事前に隠さない（CTA 無効 + バナー）。**手段は破棄**: 常時 dual 残数 |
| I-X1 / C-I13 | 「AI通信試行」等は主婦向けでない | **主根拠の一つ**として採用 |
| §10.3 | 成功残に加え attempt 受付可否・短期再開を平易表示 | **解釈を改訂**（下記 Locked）。残 M 回の第二数字は出さない |
| §11.2 | 成功3は常に保証されない（attempt 6 との相互作用） | ロジック維持。表示は保証口調を弱める（ADV-1） |

### 人間と合意済みのロック（再導出禁止）

| # | 決定 |
|---|------|
| L1 | 確認画面の**常時**表示は success 残の**1行のみ**。attempt 残の常時行は出さない |
| L2 | attempts 逼迫時（例: 残り1）の**事前警告は出さない**。押してから失敗・上限で知る |
| L3 | **`issueMessages`（API が返す日本語）まで直す**。UI だけの差し替えにしない |
| L4 | 作成 0 と attempt 0 は **CTA 無効は同じ**だが、**ユーザー向けトーンは分ける**（「作成上限」≠「受付停止」）。仕組み語は使わない |
| L5 | 数値・DB・予約ロジック・`GET /api/usage/today` の shape は変更しない |
| L6 | `formatFreeTierQuotaCopy`（文頭「無料版は」）は個人枠の制限説明に継続適用。global 混雑文には付けない |
| L7 | 有料課金 UI・枠数値の変更・attempt 枠の廃止は非スコープ |

---

## Goals & Non-Goals

### Goals

- 確認・再生成・生成終端で、**第二の残数行**（問い合わせ／AI通信試行）を出さない。
- 主残数の口調を「作成できます」から**受け付け**系へ寄せ、3回保証に読めないようにする。
- ブロック時バナーと `issueMessages` の quota 系を、低リテラシー向けの固定文言に揃える。
- 失敗で success を消費していないとき、「作成回数は減っていません」を**二重表示せず1か所**で示す。
- `issueMessages` と Function 側 `failureCopy` の**文言単一ソース**を維持または確立する（ドリフト禁止）。

### Non-Goals

- 成功3 / attempt6 / 短時間4 / global20 の値変更や窓アルゴリズム変更。
- attempts 残が少ないときの事前ソフト警告（L2 で明示却下）。
- 枠の仕組みを教えるヘルプ画面・ツールチップ。
- 英語 UI、課金プラン比較。
- `usage/today` レスポンスのフィールド削除（クライアントが内部判定に使い続ける）。

### 成功受け入れ表

| シナリオ | 期待 |
|----------|------|
| 確認 step、success 3 / attempts 6 | 「無料版は本日あと3回まで献立の作成を受け付けます」**のみ**。問い合わせ6行は**無い** |
| 確認 step、success 3 / attempts 1 | 同上（事前の逼迫警告なし）。主 CTA は attempts>0 なら有効のまま（既存判定） |
| 確認 step、attempts 0（success>0） | バナー: 受付停止トーン。問い合わせ残0の数字説明は無い |
| 確認 step、success 0 | バナー: 作成上限トーン |
| 再生成シート | 完成時1回使用＋残り success のみ。attempt 常時行なし |
| 生成失敗 `user_attempt_limit` | API `message` が新文言。画面に「別の上限」「送信」教育なし |
| 生成失敗・`quota.consumed=false` | 「作成回数は減っていません」系が**1回**（メッセージ本文と別行の二重なし） |
| 終端 `TerminalGenerationUsage` | success 残1行＋必要時の再開/混雑のみ。AI通信試行・10分残の数字行なし |
| unit / 既存テスト | 旧「AIへの問い合わせ」「AI通信試行」「成功回数には含まれません」期待を更新して緑 |

---

## Spec supersede（MVP §10.3）

次の解釈を本設計が正とする（実装・レビューはこちらを優先）:

| 旧（運用上の読み） | 新（本設計） |
|--------------------|--------------|
| 成功残 N と attempt 残 M を常時併記 | **成功残 N のみ常時**。attempt は残数表示しない |
| 「受付可否を平易に」＝残回数の説明 | **今作れるか / 無効か / いつ再挑戦か**を平易に |
| 失敗時に success と attempt の消費を対で説明 | success 未消費だけ「作成回数は減っていません」。attempt 消費は説明しない |
| 短期枠を「10分間の通信試行：あとK回」 | 残 K は出さない。`retryAt` があるときだけ待ち文 |

§11.2 の枠定義・「成功3保証なし」は**変更しない**。表示が保証に読めないよう L1 の受け付け口調で緩和する（ADV-1 の残差は Residual 参照）。

無料版 allowlist（`2026-07-28-season-freemium-quota-design.md` §2.1）は本設計の表で**差し替え**する。実装 PR で freemium 設計の表を追記改訂するか、本設計を正と注記する。

---

## Proposed Design

### 表示原則

```text
[通常]  主数字 = success.remaining のみ
[事前]  attempts 逼迫の追加文は出さない（L2）
[ブロック] success==0 / attempts==0 / shortWindow / global で CTA 無効
           理由文はトーン分け（L4）。残 M 回は出さない
[失敗後] issueMessages の平易文 +（未消費なら）作成回数は減っていない 1 行
         usage 再取得の主数字は success のみ（終端パネル）
```

### 画面別

#### 1. `review-step`（確認）

| 条件 | 表示 |
|------|------|
| `usageRemaining !== null && usageRemaining !== 0` | `無料版は本日あと{n}回まで献立の作成を受け付けます` |
| `attemptsRemaining !== null && attemptsRemaining !== 0` | **行ごと削除**（常時 attempt 行なし） |
| `usageRemaining === 0` | バナー body: `無料版は本日の作成上限に達しています。明日0:00（日本時間）以降にお試しください。` |
| `attemptsRemaining === 0` | バナー body: `無料版は本日は新しい献立の作成を受け付けられません。明日0:00（日本時間）以降にお試しください。` |
| `globalAvailable === false` | 既存どおり混雑文。「無料版は」なし |
| `shortWindowRetryAt !== null` | 既存の待ち＋時刻文を維持（「通信試行」語は使わない。現行 review 文が既に平易なら維持） |

バナー title「いまは新しい献立を作れません」は維持。  
`hasActiveUsageBlocker` 判定（success0 / attempts0 / global / short）は**ロジック維持**。

#### 2. `regeneration-sheet`

| 条件 | 表示 |
|------|------|
| success 残あり | 既存: `別の献立が完成した場合に1回使用・現在残り{n}回`（無料版接頭） |
| success 不明 | 既存: `別の献立が完成した場合に1回使用します` |
| attempts 常時行 | **削除** |
| short window ブロック | 既存の待ち文を維持（平易） |
| attempts 0 で submit | 既存の disabled 条件を維持。必要なら受付停止トーンの1文をバナー相当で追加（数字なし） |

#### 3. `generation-status-panel` / `TerminalGenerationUsage`

| 削除 | 残す・置換 |
|------|------------|
| `AI通信試行：本日あと{m}回` | なし |
| `10分間の通信試行：あと{k}回` | なし。`shortWindow.retryAt` があるときだけ待ち文 |
| `成功回数：本日あと{n}回` | `無料版は本日あと{n}回まで献立の作成を受け付けます` |
| 読込失敗「最新のAI通信試行残数を…」 | `本日の作成回数を確認できません。再読み込みしてください` |
| `!quota.consumed` の「成功回数には含まれません」 | `献立は完成していないので、作成回数は減っていません` |

`アプリ全体：作成できます / 今日はここまで` は global の平易表示として維持（無料版接頭なし）。必要なら「混み合い」語彙への微修正は可だが必須ではない。

request-local フォールバック（userId なし）も success 残1行に同じ口調で揃える。

#### 4. 契約メッセージ `issueMessages` + Function `failureCopy`

**正本:** `shared/contracts/generation.ts` の `issueMessages`（および非 conflict 定義）。  
**サーバー:** `netlify/functions/_shared/generation-service.ts` の `failureCopy` は **同一文字列**であること。実装時は正本 import を優先し、二重定義を解消できるなら解消する（挙動同一が必須）。

変更対象（本文固定）:

| code | 新 message（確定） |
|------|-------------------|
| `user_daily_limit` | `本日の作成上限に達しています。明日0:00（日本時間）以降にお試しください。` |
| `user_attempt_limit` | `本日は新しい献立の作成を受け付けられません。明日0:00（日本時間）以降にお試しください。` |
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

`user_daily_limit` の旧文「今日は3回利用しました」は、将来枠が変わっても嘘にならないよう**回数リテラルを本文に埋め込まない**（残数は usage UI 側）。

その他の `issueMessages`（同意・アレルギー等）は本設計の対象外（文言維持）。

#### 5. 無料版 allowlist 更新

`formatFreeTierQuotaCopy` を掛ける対象（葉）:

| 箇所 | body |
|------|------|
| review-step 常時 | `本日あと{n}回まで献立の作成を受け付けます` |
| review-step success0 | `本日の作成上限に達しています。明日0:00（日本時間）以降にお試しください。` |
| review-step attempts0 | `本日は新しい献立の作成を受け付けられません。明日0:00（日本時間）以降にお試しください。` |
| review-step short-window | 現行平易文（日時動的） |
| Terminal / status success 残 | 常時と同じ受け付け文 |
| regeneration 完成時1回 | 現行2文 |
| failure_code ラップ | `user_daily_limit` / `user_attempt_limit` / `user_short_window_limit` のみ（global・model 混雑は**ラップしない**） |

**allowlist から外す（表示自体削除）:**

- `AIへの問い合わせは本日あと{n}回まで受け付けます`
- `AI通信試行：本日あと{n}回`
- `10分間の通信試行：あと{n}回`（残数行）

**denylist 更新:**

- `成功回数には含まれません` → 新文 `献立は完成していないので、作成回数は減っていません` も**ラップしない**
- 読込失敗の新文もラップしない

### データフロー（変更なし）

```text
GET /api/usage/today
  → success.remaining / attempts.remaining / shortWindow / globalAvailable
  → クライアントは判定・CTA に attempts を使う
  → 常時ラベルには success のみ出す

POST generate / status failed
  → failure_code + message（issueMessages 由来）
  → パネルは message 表示 + !consumed なら作成回数未減の1行
  → TerminalGenerationUsage は usage/today 再取得（success 主表示）
```

### エラー・境界

| ケース | 扱い |
|--------|------|
| usage 未取得 | 既存: 確認中 / 確認失敗文。attempt 専用エラー語にしない |
| success>0 かつ attempts=0 | 常時「あとn回受け付け」行は success 残があるので**出る**が、blocker で CTA 無効＋受付停止バナー。**一見矛盾**し得る → 下記 UI 規則で解消 |
| 同上の矛盾解消（Must） | **blocker 活性中は常時の success 残行を出さない**。バナーだけにする。押して知る L2 と両立: 逼迫（残1）ではまだ常時行のみ、attempts=0 になって初めてバナーのみ |
| 失敗メッセージと UI 未減行 | message に未減を書かない。UI が `!consumed` のときだけ1行 |
| 旧クライアントキャッシュ | SPA 再デプロイ前提。API message は新文言のみ |

### テスト

- `shared/contracts/generation.test.ts`: 必要なら新文言の exact / 禁止部分文字列（「別の上限」「通信試行」等）
- `generation-service` / generate-menu / generation-status テストの message fixture
- `review-step` / `planner-wizard` / `regeneration-sheet` / `generation-status-panel` / `generation-page` の可視テキスト
- freemium `free-tier` はヘルパ自体変更なし。呼び出し元期待のみ
- E2E が旧文言を掴んでいれば更新（acceptance は文言非固定なら触らない）

---

## Residual risks（受容）

| ID | リスク | 緩和 | 受容理由 |
|----|--------|------|----------|
| R1 | success 残表示中に attempt を先に使い切り、体感「あと3回」が実現しない | 受け付け口調；attempts=0 でバナー切替；L2 で事前警告はしない | ユーザー決定。§11.2 の意図的相互作用 |
| R2 | 受付停止と作成上限の違いが一部ユーザーに伝わらない | トーン文を分ける（L4） | 仕組み説明よりマシ |
| R3 | サポートが「どちらの枠か」を画面から読み取れない | failure_code は API/ログに残る | ユーザー画面を優先 |
| R4 | C-I12 再燃（「attempt が見えない」） | blocker・失敗・issueMessages で受付不能は隠さない | dual number 回帰はしない |

---

## PR / 実装分割（案）

単一列車でよい規模。分割するなら:

1. **契約**: `issueMessages` + `failureCopy` 単一化とテスト  
2. **UI**: review / regen / status panel + 無料版 allowlist コメント・テスト  

どちらも同一リリースに入れる（L3: API 文言と UI の分断禁止）。

---

## 敵対的レビュー反映チェック

| ADV | 反映 |
|-----|------|
| ADV-1 過大表示 | 受け付け口調 + R1 受容 + attempts=0 時は常時行を隠す |
| ADV-2 同一文言統合の危険 | L4 トーン分離、表で固定 |
| ADV-3 C-I12 | Spec supersede 節 |
| ADV-4 issueMessages | L3・表で全 quota/失敗系を改訂 |
| ADV-5 TerminalUsage | 第二数字削除を Must |
| ADV-6 再生成 | 常時 attempt 行削除 |
| ADV-7 無限再試行誤解 | 未減は1行のみ。attempt 消費は言わない。R1 |
| ADV-8 無料版冗長 | バナー title は接頭なし維持 |
| ADV-9 閾値 | L2 により事前閾値ロジック自体を置かない |
| ADV-10 テスト | 受け入れ表・テスト節 |
| ADV-11 global | 混雑語彙・無料版非接頭を維持 |

---

## Self-review（設計時点）

1. **Placeholder:** なし（文言は表で固定）。short-window の review 本文は「現行維持」とし、実装時に「通信試行」が残っていれば同じ PR で平易文へ揃える。  
2. **Internal consistency:** L2（事前警告なし）と ADV-1 緩和は「口調＋attempts=0 で常時行オフ」で整合。  
3. **Scope:** コピーと表示条件のみ。quota ロジック非対象。  
4. **Ambiguity:** `failureCopy` と `issueMessages` は同一必須と明記。blocker 中は success 常時行を出さないと明記。
