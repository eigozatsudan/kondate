# 敵対的レビュー: 利用回数コピー簡素化設計

| 項目 | 値 |
|------|-----|
| 対象 | `docs/archive/superpowers/specs/2026-07-29-quota-copy-simplification-design.md`（commit `fd9d429` 時点） |
| 日付 | 2026-07-29 |
| 種別 | 設計書に対する敵対的レビュー（実装レビューではない） |
| 判定 | **ACCEPT_WITH_CHANGES** — Critical を設計改訂してから実装計画へ |
| 観点 | 親仕様衝突、文言の欺瞞・文法、画面間非対称、二重表示、実装あいまいさ、低リテラシー、回帰 |

---

## 総評

方向性（1数字・仕組み非教育・API 文言まで平易化）は妥当で、先セッション ADV-1〜11 の多くは文書に取り込まれている。  
ただし **親 MVP 仕様の supersede 範囲が §10.3 の一部に留まり、§10.3 失敗条項・§14 エラー表示・状態表示（attempt 残の必須表示）と正面衝突したまま**である。実装者が「本設計優先」と読んでも、レビューアは MVP 本文を根拠に差し戻せる。

また「blocker 中は常時 success 行を消す」「再生成は disabled 既存維持」「無料版は本日は…」など、**実装時に解釈が割れやすい穴**と、**低リテラシー向けにして逆に読みにくい接頭**が残る。

---

## Critical

### D-C1. 親仕様 supersede が不完全（§10.3 後半・§14・失敗状態）

本設計は「§10.3 の解釈改訂」と書くが、MVP 本文には本設計が**明示的に破る**条文が他にもある。

| MVP 箇所 | 要求（要約） | 本設計 |
|----------|--------------|--------|
| §10.3 L367 | 失敗時は成功に含まれないことと **attempt は別上限へ含まれることを区別表示**し、**成功残・attempt 残・再試行時刻を必ず表示** | attempt 消費は説明しない・attempt 残は出さない |
| §14 個人上限 | 「今日は3回利用しました…」 | 回数リテラルなしの新文 |
| §14 attempt 上限 | 「AIへの送信上限」「成功回数とは別の上限」 | 受付停止トーンのみ |
| §14 全体上限 | 「成功回数には含まれません」入り | 混雑＋明日0:00。未減は UI 行へ |
| §14 モデル混雑 | 「成功回数には含まれません。**AIへの送信回数には含まれます**」＋**成功・attempt 残** | 短文のみ。attempt 残なし |
| §14 不正AI / timeout | 送信済み attempt 消費結果と各残数 | 未減1行＋success 主表示。attempt 残なし |
| 生成状態 L144 付近 | `failed` で成功残・**外部 attempt 残**・再試行時刻 | attempt 残削除 |

**攻撃:** 実装 PR の「設計準拠レビュー」で、レビューアが MVP を正として **本変更を仕様違反**と判定できる。  
**要求:** Supersede 節を拡張し、少なくとも次を **条文単位で「本設計が正／旧文は破棄」** と列挙する。

- §10.3 の失敗時 dual 説明・attempt 残必須表示
- §14 の該当 bullet 全文（個人 / attempt / 短期 / 全体 / モデル混雑 / 不正応答 / timeout）
- 必要なら「状態 API のクライアント表示」節の attempt 残必須

「§10.3 の解釈」だけでは不十分。**文書タイトル上の supersede 表を親仕様パッチと同等の厳密さにする。**

---

### D-C2. 無料版接頭 ×「本日は」で **「無料版は本日は…」** になり読みにくい

attempts0 バナー body（設計 L143 / allowlist L210）:

```text
本日は新しい献立の作成を受け付けられません。…
→ formatFreeTierQuotaCopy →
無料版は本日は新しい献立の作成を受け付けられません。
```

「は」が連続し、音読・視線ともに粗い。低リテラシー向け簡素化の主目的に逆行する（ADV-8 の延長）。

**要求（いずれか固定）:**

1. body を `今日は新しい献立の作成を受け付けられません。…` にし「は」重複を避ける  
2. または接頭ルールを「文頭が『本日』のときだけ別形」などにする（複雑なので非推奨）  
3. または attempts0 だけ接頭なし（L6 との例外を明記）

推奨は **1（「今日は…」）** で L6 を維持。

---

### D-C3. 再生成シート: attempts=0 でも submit 可能のまま（確認画面と非対称）

現行 `regeneration-sheet.tsx`:

```ts
submitDisabled = … || successBlocked || …;
// attemptsRemaining === 0 は disabled に含まれない
```

設計 §2:

> 既存の disabled 条件を維持。**必要なら**受付停止トーンの1文を追加

- 確認 step は attempts=0 で **CTA 無効 + バナー**（C-I12 残差の修正済み）
- 再生成は attempts=0 で **押せてサーバー失敗**（L2 と一致し得るが、確認との非対称は仕様バグに見える）
- 「必要なら」は実装者逃げ道で、受け入れ表に scenarios が無い

**攻撃:** 履歴から別案 → 問い合わせ枠尽き → 理由入力して送信 → 失敗。確認では押せないのに再生成では押せる。

**要求:** 次のいずれかを **Locked 決定**として書く（「必要なら」禁止）。

| 案 | 内容 |
|----|------|
| A（推奨・確認と揃える） | attempts=0 / shortWindow ブロック時は submit disabled + 受付停止/待ちの1文（数字なし） |
| B（L2 徹底） | 再生成も押してから知る。確認の事前 disabled も将来的に揃えたいが本設計では確認は維持、再生成は B と明記し非対称を意図的と書く |

黙って「既存維持」は **D-I14 / C-I12 系の再発**になる。

---

## Important

### D-I1. 「blocker 活性中は常時 success 行を出さない」が広すぎる

矛盾解消は **success>0 ∧ attempts=0** 用に書かれているが、Must 文言は **あらゆる** `hasActiveUsageBlocker` に適用される。

| blocker | success 行を消す影響 |
|---------|----------------------|
| attempts=0 | 矛盾解消として妥当 |
| success=0 | もともと常時行は `!== 0` で出ない。無害 |
| shortWindow のみ | 「あと2回受け付け」が消え、待ち文だけ。待ち明け後の見込みが消える |
| global のみ | 同様。個人残が見えない |

短時間待ち中に「待ち明け後も今日あと何回か」が消えるのは、簡素化というより **情報欠落**。

**要求:** 規則を狭める。

```text
常時 success 行を隠すのは
  hasActiveUsageBlocker かつ (usageRemaining === 0 || attemptsRemaining === 0)
のときだけ。
shortWindow / global のみのときは常時 success 行を残してよい。
```

---

### D-I2. 複数 blocker 同時でバナー本文が2〜3本並ぶ

既存どおり success0 ∧ attempts0 ∧ short 等で **body が複数**出る。  
簡素化のゴール「普段は1数字」に対し、最悪時は:

- 作成上限文  
- 受付停止文  
- 短時間待ち文  
- （global なら）混雑文  

低リテラシーでは「全部今日ダメ？」と読める。Critical ではないが、設計が「同時に複数でも理由を隠さず」と旧コメントを踏襲しているなら **優先順位（1本文＋他は出さない）** を決めるか、**複数可を明示受容**する。

**要求:** 「複数 body 同時表示を許容する / 優先度表で1本にする」を一文で固定。

推奨優先度例: shortWindow（すぐ行動可能） > success0 = attempts0 > global。  
または success0 と attempts0 が同時なら **success0 文だけ**（作成上限の方が理解しやすい）。

---

### D-I3. global の「いつ戻るか」が経路で不一致

| 経路 | 文言 |
|------|------|
| review 事前 `globalAvailable === false` | しばらくしてから（**日次尽きたのか一時混雑か不明**） |
| `issueMessages.global_daily_limit`（新） | **明日0:00** |

global 日次20は JST 日次リセットが正なら、事前バナーが「しばらく」は**楽観的すぎる／不正確**。  
本設計は global 事前を「既存どおり」とし、API だけ明日0:00にしている。

**要求:** global 事前バナーも `明日0:00（日本時間）` 系に揃えるか、「混雑（アプリ全体の本日分）」と日次であることを示す。既存維持のままなら **不正確コピーとして Residual に書く**。

---

### D-I4. `user_short_window_limit` の issueMessage から時刻が消える

新文: 「しばらくしてから再度お試しください。」  
review バナーは `retryAt` 付き。status パネルも retryAt 行を残す想定。

**穴:** status API が message だけ見せ、UI が `quota.retryAt` を描画し損ねた経路では **いつ待てばいいか不明**（§14 は具体的再開時刻を要求していた）。

**要求:**  

- UI: `retryAt` がある code では **必ず時刻行を出す**（message に埋め込まない方針と両立）  
- 受け入れ表に「short window 失敗で再開時刻が見える」を1行追加  
- issueMessage 単体に時刻を入れない判断は明記のうえ、UI 義務を Must にする

---

### D-I5. 「受け付けます」はまだ保証に読める（ADV-1 残）

`本日あと3回まで献立の作成を受け付けます` は「作成できます」より弱いが、非エンジニアにはなお **「3回作れる」** に聞こえる。R1 で受容済みだが、設計本文の Goals は「3回保証に読めないようにする」と断言しており **R1 と Goals が矛盾**。

**要求:** Goals の文言を「保証口調を弱める（完全な非保証表現ではない。R1）」に修正するか、より弱い固定案を1つ選ぶ。

例: `本日の作成枠の残り表示: あと3回` / `完成した献立として数えられるのは本日あと3回まで`（長い）。

現状維持なら **Goals を嘘にしない**こと。

---

### D-I6. freemium 設計の改訂手順が「または」のまま

> 実装 PR で freemium 設計の表を追記改訂するか、本設計を正と注記する。

承認済み freemium allowlist と本設計が並立すると **正本が2つ**。

**要求:** 実装前にどちらか必須。

1. 本設計を allowlist の正とし、freemium 設計 §2.1 に「superseded by 2026-07-29…」を **同列車で追記**  
2. または freemium 表を本設計の表で置換する Task を plan に固定

---

### D-I7. `failureCopy` と `issueMessages` の構造差

- `issueMessages`: `Record<code, string>`
- `failureCopy`: `Record<code, { message, retryable }>`

「正本 import」は message 文字列の共有であり、retryable は service 側に残る。設計は「二重定義を解消できるなら」と弱い。

**要求:** 実装契約を固定。

```text
message 文字列の唯一のソースは issueMessages（または shared の同一定数）。
failureCopy[code].message は issueMessages[code] を参照する（コピー＆ペースト禁止）。
retryable は service ローカルのまま。
単体テストで全 GenerationFailureCode について message 一致を assert。
```

「できるなら」は削除。

---

### D-I8. 確認バナーと issueMessages の時刻表記ゆれ

| 場所 | 表記 |
|------|------|
| 現行 review バナー | 明日**0時**（日本時間） |
| 本設計の新文 | 明日**0:00**（日本時間） |
| MVP §14 | 明日0:00 |

設計は 0:00 に寄せているが、**受け入れ表が旧 UI テストの「0時」を更新する**と明記していない。実装漏れで混在し得る。

**要求:** プロジェクト内ユーザー向けは **0:00（日本時間）** に統一と明記。テスト更新リストに含める。

---

### D-I9. 再生成の success コピーが「受け付け」口調に未揃い

確認・終端は「受け付けます」に寄せるが、再生成は:

`別の献立が完成した場合に1回使用・現在残りN回`

これはむしろ **完成時だけ減る** が分かって良い。一方「残りN回」は success で、attempt 切れとまた乖離（R1）。設計が意図的に据え置きなら **「再生成は完成条件付きの success 説明を維持。受け付け口調への統一はしない」** と書く。

---

### D-I10. 禁止部分文字列テストの範囲が曖昧

> 必要なら新文言の exact / 禁止部分文字列

**要求:** 契約テストで少なくとも次を **failed したら赤**にする（実装のガードレール）。

禁止（issueMessages 全 value および主要な UI 固定文）:

- `成功回数`
- `別の上限`
- `AIへの送信`
- `通信試行`
- `問い合わせ`（「AIへの問い合わせ」）
- `attempt`（英字・ユーザー向け）

許可が必要な内部コメント・テスト名は対象外と明記。

---

## Minor

### D-M1. メタデータの自己矛盾

ヘッダ: 「敵対的レビュー … 本設計に Must 反映済み」  
本レビューは **未反映の Critical あり**。状態を「Draft — 敵対的レビュー指摘反映待ち」へ更新すべき。

### D-M2. 成功受け入れ表に欠けるケース

- success>0 ∧ attempts=0 で **常時 success 行が無い**こと  
- shortWindow のみ blocker で success 行の扱い（D-I1 後）  
- 再生成 attempts=0（D-C3 後）  
- short window 失敗で retryAt 可視（D-I4）  
- `formatFreeTierQuotaCopy` 後に「無料版は本日は」が**生成されない**こと（D-C2）

### D-M3. `role="status"` とバナー `role="alert"` の併存

blocker 時に常時行を消すなら alert だけになり改善。short/global で常時行を残すと status + alert が並ぶ — 許容でよいが、スクリーンリーダーで二重読み上げ、は Residual 程度。

### D-M4. `duplicate_output` から「今回は回数に含まれません」を削除

未減は UI 行に集約で一貫。ただし constraint_conflict でも同じ UI 行が出るか受け入れに1行あるとよい。

### D-M5. Plan 8 / paid-openrouter 設計が `issueMessages.user_daily_limit` の旧文・3回リテラルに言及

クロスリファレンスの stale。本設計の Related に「旧回数リテラル文は破棄」と書くか、実装時に参照設計へ注記。

### D-M6. L2 と「確認では attempts=0 で事前 disable」の関係

L2 は「逼迫（残1）は事前警告しない」。attempts=0 の事前 disable は L2 と矛盾しないが、文書上 L2 の適用範囲が「逼迫」だけか「あらゆる attempt 起因」か一瞬迷う。  
**L2 スコープ:** `attemptsRemaining > 0` のときの追加警告を出さない。`=== 0` は blocker 表示対象、と明記するとよい。

---

## 矛盾・あいまいさチェックリスト（設計内）

| 項目 | 状態 |
|------|------|
| L1 常時1行 vs 複数バナー body | 通常時 OK。ブロック時は D-I2 |
| L2 押して知る vs attempts=0 事前 disable | 意図的なら D-M6 で明確化可 |
| L2 vs 再生成が押せる | D-C3 |
| Goals「保証に読めない」vs R1 | D-I5 |
| § supersede 範囲 | D-C1 |
| 無料版は本日は | D-C2 |
| failureCopy 単一化 | D-I7「できるなら」が弱い |
| freemium 正本 | D-I6 |
| global しばらく vs 明日0:00 | D-I3 |
| blocker 中 success 行 | D-I1 が広すぎ |

---

## 指摘サマリ

| ID | 重大度 | 要約 | 設計改訂の要否 |
|----|--------|------|----------------|
| D-C1 | Critical | MVP §10.3失敗・§14 等の supersede 不足 | **必須** |
| D-C2 | Critical | 「無料版は本日は」読みにくさ | **必須**（文言 or 接頭規則） |
| D-C3 | Critical | 再生成 attempts=0 の disabled / 文が「必要なら」 | **必須**（A or B 固定） |
| D-I1 | Important | blocker 全種で success 行隠しが過剰 | 必須推奨 |
| D-I2 | Important | 複数バナー body | 方針固定 |
| D-I3 | Important | global 再開時刻の経路差 | 揃える or Residual |
| D-I4 | Important | short window 時刻は UI Must | 必須推奨 |
| D-I5 | Important | Goals と R1 の矛盾 | 文言修正 |
| D-I6 | Important | freemium 正本が二又 | 必須 |
| D-I7 | Important | failureCopy 単一化が弱い | 必須 |
| D-I8 | Important | 0時 vs 0:00 | 統一明記 |
| D-I9 | Minor/Imp | 再生成コピー非統一 | 意図明記 |
| D-I10 | Important | 禁止文字列テスト | 具体化 |
| D-M1〜6 | Minor | メタ・受け入れ表・L2 スコープ等 | 推奨 |

---

## 判定

**ACCEPT_WITH_CHANGES**

- プロダクト方針（L1–L7）自体は支持する。  
- **D-C1, D-C2, D-C3 を設計書に反映するまで実装計画に進まない**ことを推奨。  
- D-I1, D-I4, D-I6, D-I7 は実装ブレ直結のため、同じ改訂ラウンドで潰すのが安い。

---

## 改訂時の最小パッチ案（設計者向け）

1. **Supersede 表を拡張**（D-C1）— §10.3 L367、§14 該当 bullet、failed 表示の attempt 残必須を「破棄／本設計の表が正」。  
2. **attempts0 body** を `今日は新しい献立の作成を受け付けられません。…` に変更（D-C2）。  
3. **再生成:** 案 A で attempts=0 と shortWindow を disabled + 1文（D-C3）。  
4. **success 行 hide 条件を縮小**（D-I1）。  
5. **failureCopy.message ≡ issueMessages** を Must + 全 code テスト（D-I7）。  
6. **freemium §2.1 superseded 追記を同一 plan の Task に**（D-I6）。  
7. Goals を R1 整合に（D-I5）。  
8. 受け入れ表に D-M2 の行を追加。

---

## 本レビューが検証した根拠（抜粋）

- 対象設計全文  
- MVP `2026-07-11-kondate-mvp-design.md` §10.3 / §11.2 / §14 / 状態表示  
- `review-step.tsx` blocker / 現行文言（0時）  
- `regeneration-sheet.tsx` `submitDisabled` が success のみ  
- `generation-service.ts` `failureCopy` と `issueMessages` の二重定義  
- freemium 設計 §2.1 allowlist  
- 先セッション ADV と Residual R1–R4
