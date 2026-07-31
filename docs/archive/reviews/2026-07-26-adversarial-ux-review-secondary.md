# 敵対的 UX レビュー — 二次深掘り結果（2026-07-26）

対象: 一次レポート `docs/archive/reviews/2026-07-26-adversarial-ux-review.md`（`main` @ `9fdc2a3`）  
手法: **一次と別コンテキスト**の読み取り専用サブエージェント 3 体による再判定  
（一次の 4 体レビューアとはスレッド共有なし）

| 二次エージェント | 担当 | 成果物 |
|------------------|------|--------|
| s1 | C-1, C-2, I-A1…I-A6 | `/tmp/grok-1000/ux-review-05f1c454/secondary/s1-auth-onboarding.md` |
| s2 | C-3, C-4, I-G1…I-G8 | `…/secondary/s2-planner-generation.md` |
| s3 | C-5, C-6, I-H*, I-X* | `…/secondary/s3-history-shopping-copy.md` |

**目的:** 指摘の追認・格下げ・格上げ・棄却、反証の洗い出し、設計原文との突合、修正時に壊してはいけない境界の明確化。  
**本ドキュメントは指摘の再判定のみ。修正は行っていない。**

---

## 1. 二次判定サマリ

### Critical の再判定

| ID | 一次 | 二次 verdict | 二次後 severity | 要点 |
|----|------|--------------|-----------------|------|
| **C-1** | Critical | **CONFIRMED**（「完全閉じ込め」表現は過大） | **Critical 維持** | ページ内脱出なしは確定。ただしブラウザ戻る→Welcome、未ガードの `/planner` は技術的出口あり。ペルソナ＋設計「あとで設定」で Critical 妥当 |
| **C-2** | Critical | **CONFIRMED** | **Critical 維持・強化** | 受け入れ条件 L644「元ブラウザを失った場合も安全にやり直せる」の**明文ミス**。deposited だけ TTL→login が無い |
| **C-3** | Critical | **CONFIRMED**（a/b 分割） | **Critical 維持** | 製品ルール（緊急は家族対象必須）は設計どおり。問題は**誤った未登録帰属**と、review は mode 対応なのに**失敗 CTA が無条件**なこと |
| **C-4** | Critical | **DOWNGRADED** | **Important** | ProgressIndicator 未接続は設計ギャップ。死路・データ損失・信頼破壊ではない |
| **C-5** | Critical | **UPHELD + 範囲拡大** | **Critical 維持・強化** | 履歴だけでなく **結果 invalid・買い物ゲート** も raw `issue.message`。invalid 時は人間向け `currentLabelWarnings` が空になる構造 |
| **C-6** | Critical（束ね） | **SPLIT** | **ゲート語: Important / 常時注意: Important（高）** | 「安全確認」は設計 L155 も使う**工程語**。保証禁止（§221）との混同あり。常時 DISCLAIMER 欠落は仕様違反だが Critical 級の行き止まりではない |

### 二次後の Critical リスト（トリアージ用）

1. **C-5** — `member_1` / `egg` 等の露出（履歴・結果・買い物）  
2. **C-3** — idea（および対象不適格）で「家族未登録」と嘘 + 失敗パネル無条件緊急リンク  
3. **C-2** — deposited にやり直しなし（受け入れ条件違反）  
4. **C-1** — オンボーディングにページ内「あとで／やめる」なし（任意ラベルとの矛盾）

**Critical から外す:** C-4（→ Important）、C-6 一体の Critical（→ Important 2 件に分解）

### Important の一括

| 群 | 二次結果 |
|----|----------|
| I-A1…I-A6 | **全 CONFIRMED**。I-A1 の「OpenRouter 削除」は設計 §16 L632 と衝突 → **言い換え問題**。I-A5 はドメイン上 unconfirmed 完了は合法 → **ラベル問題**。I-A6 はシェル無しでやや**過小評価**されていた |
| I-G1…I-G8 | **全 CONFIRMED Important**。I-G6 はクライアントに既に `dishIds` あり（安い修正）。I-G5 は**誤文言がテスト固定** |
| I-H1…I-H9 | **全 Uphold**。I-H4 はサーバ version でデータ破壊は防げるが UX Important は残る。I-H5 は設計がデフォルト全チェックを要求していない |
| I-X1…I-X5 | **Uphold**。I-X4 は CSS 契約ギャップは実在するが、現行長い日本語ラベルでの 320px 幅不足は**未実測で過大** |

**棄却された一次指摘:** なし（修正案「緊急を家族なしで出すべき」だけは設計と衝突するため**却下**）

---

## 2. 各 Critical の深掘り結論

### C-1 オンボーディング脱出

**再現:** Welcome `onStartHousehold` → `in_progress` → `/onboarding`（AppShell 外）→ 主 CTA のみ。`setProgress` 型が `"in_progress"|"complete"` のみで **skipped を呼べない**。

**反証（一次が弱かった点）:**

| 出口 | 有無 |
|------|------|
| ページ内「あとで」 | なし（テストが旧 defer 文言の**非表示を固定** `household-onboarding-page.test.tsx:499`） |
| ブラウザ戻る → Welcome 二択 | 通常の first-run ではあり（`navigate` が replace でない） |
| 直接 `/planner` | 可（`RequireCompletedOnboarding` 撤廃済み） |
| ルート `/` | `in_progress` → Welcome |

**強化点:** リロード／`returnTo=/onboarding` で履歴に Welcome が無いと戻る出口も消える。

**修正制約:** RPC 遷移 `in_progress → skipped|complete` のみ。`RequireCompletedOnboarding` を戻さない。skip 時も draft 削除しない。

---

### C-2 deposited やり直し

**再現:** `kind === "deposited"` は説明文のみ。他コールバック（expired / error / awaiting TTL）は `/login` へ誘導するのに、**deposited だけ端末 UI**。

**設計原文（強化根拠）:**

- §5 L176: 元ブラウザを利用できない場合は**最初からやり直し**、WebView 単独続行禁止  
- 受け入れ L644: **元ブラウザを失った場合も安全にやり直せる**

**修正制約:** WebView 内で session を作らない。continuation を再消費しない。`/login` への replace ＋新規 magic link / Google。

---

### C-3 idea 緊急の誤文言

**分割判定:**

| 側面 | 判定 |
|------|------|
| (a) 家族がいても「未登録」と表示 | **Critical 確定**（idea では household 未ロードのため真偽すら判定不能） |
| (b) 緊急は対象家族必須 | **製品ルールとして正しい**（§9.3 / guided §7 idea→家族不在 empty は設計承認） |
| 失敗パネルが無条件 `/emergency-menus` | **Critical を支える不一致**（review-step は idea 時に切替案内のみ） |

**範囲拡大:** household で選択が全員不適格でも**同じ「未登録」文字列**（idea 限定ではない）。

**テストが欠陥を固定:** `emergency-menu-page.test.tsx` が idea → 未登録 copy を期待。

**却下する直し方:** 安全フィルタを緩めて idea に緊急候補を出すこと。

**正しい直し方:** 分岐文言（idea / 真に未登録 / 選択不適格）＋ `RecoveryLinks` の mode 対応。

---

### C-4 ProgressIndicator（格下げ）

- 共有 UI・テスト・CSS は揃っているが planner は import ゼロ  
- 「1. 食事」…「5. 確認」で**部分的**に位置は分かる  
- 設計 §6.4（文字＋バー）には非準拠  
- **Critical ではない** — 認知負荷・設計ギャップとして **Important**

---

### C-5 issue.message 内部 ID（範囲拡大）

**生成元（人間向け化なし）:**

```
evaluateAllergens → `${anonymousRef} の登録アレルゲン ${allergenId} が残っています`
evaluateFoodSafetyRules → `${required} を満たす工程がありません`  // cut_small 等
scanPantryNameSnapshotIssues → allergens と同型
```

**構造的問題:** `revalidation-service` が `!ok` のとき `currentLabelWarnings = []` にし、**唯一の表示経路が raw `message`**。ラベル警告の DTO（日本語名・表示名）は valid 時しか埋まらない。

**利用者に届く面:**

| 面 | 経路 |
|----|------|
| 履歴詳細 | `issues.map` → `issue.message` |
| 献立結果 | 同上 |
| 買い物ゲート | `issues.map(m => m.message).join("。")` |

**設計:** §6 L221 / §10.3 L372 — 内部 ref・英語 ID を利用者本文に出さない。

**修正方向:** サーバで displayName 組み立て、または structured issue + クライアント辞書。履歴だけ直しても買い物・結果が残る。

---

### C-6 安全語彙（分割・格下げ）

| サブ | 二次 severity | 理由 |
|------|---------------|------|
| 「安全確認が完了するまで…」（買い物ゲート） | **Important** | 設計 L155 が同種の工程語を使用。保証表現禁止との同一視は過大。ただし主婦には医療確認に読める → 書き換え推奨 |
| 初回設定に常時非保証なし | **Important（高）** | §221 の 4 面のうち欠落。プライバシー／結果／履歴にはある |
| 買い物既定面に常時非保証なし | **Important** | 条件付き警告 ≠ 常時 DISCLAIMER |

利用者向け「安全確認」文字列は **実質 1 箇所**（`shopping-list-page.tsx:187`）。同ページの「現在の家族設定で再確認しています」が良い対比例。

---

## 3. Important で二次が厚くした点

### 認証・初回

- **I-A1:** OpenRouter **名の開示は設計必須**（L632）。問題は `member_1`・DB ID・生回答の平易化  
- **I-A2:** `MagicLinkState` に `expired` 型があるが LoginPage 未使用（未完成の痕跡）  
- **I-A3:** auth flow は localStorage に残り得るが **sent UI は rehydrate しない**  
- **I-A4:** RootEntry だけ refetch ボタンがあり、Welcome/onboarding はなし（パターン不統一がテストで Root のみ固定）  
- **I-A5:** unconfirmed 完了は SQL/設計上合法。ボタン「完了」が誤解を招く  
- **I-A6:** `/privacy` も AppShell 外で、タブに「緊急」が無い → テキスト言及だけの導線は特に弱い

### 献立・生成

- **I-G2 追加:** `usageRemaining === 0` でも主ボタンが disabled にならない → 「0回」表示と矛盾し得る  
- **I-G5:** 緊急 flush 失敗＝生成失敗文言が **conflict テストで固定**  
- **I-G6:** `dishIds` は既にクライアントにある。緊急 UI の「使用先」がテンプレ  
- **I-G8 vs C-3:** 候補ゼロ（対象あり）と 対象ゼロ（理由嘘）は別バグ

### 履歴・買い物・横断

- **I-H4:** 毎タップ新規 UUID は二重タップ抑止にならない。version conflict は**事後**救済のみ  
- **I-H5:** 設計は「承認した差分だけ」— **デフォルト全チェックは実装都合**  
- **I-X4:** `button`/`.button-link` は 44×44、`a.primary-button` は min-width なし。現状ラベルでは幅は足りている可能性が高い

---

## 4. 一次が見落とした／過小だったこと

1. C-5 が **買い物・結果** にも及ぶ  
2. food-rules の英語制約 ID（`cut_small` 等）も同パイプライン  
3. invalid 時に人間向け警告を**意図的に空にする**構造  
4. C-2 がソフト UX ではなく **受け入れ条件 L644**  
5. C-3 が idea 専用ではなく **対象不適格 household も同文言**  
6. 複数の悪い文言が **テストでロック**されている（idea 未登録、緊急=生成 flush、onboarding defer 非表示）  
7. deposited は awaiting_completion より **出口が悪い**（後者は TTL→login）

## 5. 一次が過大だったこと

1. C-1 の「URL/戻る以外に出口なし」— 技術的には `/planner` 等あり  
2. C-4 Critical — Important が妥当  
3. C-6 一体 Critical — 工程語と保証禁止の混同  
4. I-A1 で OpenRouter を欠陥扱い — 開示義務  
5. I-A5 をドメインバグ扱い — ラベル問題  
6. I-X4 を現行 320px の実害として断言 — 未実測

---

## 6. 横断パターン（二次で確定）

1. **任意家族リデザインの縁が未完了** — Welcome 二択は良いが onboarding／privacy 出口は旧ファネル感  
2. **AppShell 外ルート**（login / callback / welcome / onboarding / privacy）はローカル CTA 必須  
3. **人間向け化の二系統** — ラベル警告 DTO は正しく、validation `issue.message` は内部診断のまま  
4. **失敗リカバリの一貫性欠如** — review は idea 対応、status panel は MVP 文言の直訳で無条件緊急  
5. **テストが悪い UX を防衛** — 修正時はテスト書き換えが前提

---

## 7. 修正トリアージ（二次確定版）

### P0（Critical 維持・先に直す）

1. **C-5** — issue の人間向け組み立て（3 消費面）  
2. **C-3** — 空状態分岐文言 + RecoveryLinks の mode 対応 + テスト更新  
3. **C-2** — deposited に「最初からやり直す」→ `/login`  
4. **C-1** — onboarding に skip/あとで + `setProgress` の skipped 対応 + テスト更新  

### P1（Important・夕食前の誤解を減らす）

- I-G2 / I-G3 / I-X1（上限の二系統を平易に、0 回で主ボタン制御）  
- I-G5（緊急 flush 専用文言 + テスト）  
- I-G6（dishIds → 使用先表示）  
- I-A1 平易化（OpenRouter は残す）  
- I-A6 緊急ボタン  
- I-H1 sticky + changedDetails 日本語  
- C-6 分割分（ゲート語書き換え + 常時 DISCLAIMER）  

### P2（設計準拠・磨き）

- C-4 ProgressIndicator  
- I-G1 保存ステータス、I-G4 作成ID 言い換え  
- I-A2…I-A5、I-H2…I-H9、I-X*  

---

## 8. 成果物パス

```
docs/archive/reviews/2026-07-26-adversarial-ux-review.md          # 一次
docs/archive/reviews/2026-07-26-adversarial-ux-review-secondary.md # 本二次

/tmp/grok-1000/ux-review-05f1c454/secondary/
  s1-auth-onboarding.md
  s2-planner-generation.md
  s3-history-shopping-copy.md
```

二次の Critical 再判定は、各エージェント報告を親が設計原文・主要コードパスと突合して採用している。

---

## 統合先

実装トリアージ用の統合一覧（他セッションの A–E 指摘と ID 安定にマージ済み）:

`docs/archive/bugfix/2026-07-26-adversarial-review-findings.md`（第3セッション節・対応表あり）
