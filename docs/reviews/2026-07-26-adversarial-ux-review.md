# 敵対的 UX レビュー結果 — 2026-07-26

対象: 実装済み MVP（`main` @ `9fdc2a3`）  
観点: **エンドユーザー（忙しい主婦・低 IT リテラシー・片手スマホ・不安定回線）** が迷わず・怖がらず・詰まらず使えるか  
手法: 読み取り専用サブエージェント 4 体の並列レビュー + 親によるコード照合  
担当分割:

| # | 領域 | 成果物 |
|---|------|--------|
| 1 | 認証 / Welcome / オンボーディング / プライバシー | `/tmp/grok-1000/ux-review-05f1c454/01-auth-onboarding.md` |
| 2 | プランナー / 生成 / 結果 / 緊急献立 | `…/02-planner-generation.md` |
| 3 | 履歴 / 買い物 / 冷蔵庫 / 設定 | `…/03-history-shopping-settings.md` |
| 4 | 文言・a11y・横断パターン | `…/04-copy-a11y-crosscut.md` |

**本レポートは指摘のみ。修正は行っていない。**  
2026-07-25 のコード／セキュリティ向け敵対的レビュー（`docs/reviews/2026-07-25-adversarial-code-review.md`）とは別軸。重複する場合は UX 影響を優先して記載。

設計アンカー: `docs/superpowers/specs/2026-07-11-kondate-mvp-design.md` §1 成功条件・§10 UI/UX、`2026-07-22-guided-planner-optional-household-design.md`。

集計（親が照合し重複を統合後）: **Critical 6 / Important 22 / Minor 14**（下表は優先度の高いものを掲載。全件は各サブレポート参照）。

---

## サマリ（エンドユーザー目線）

実装は「日本語中心・アレルギー保証を避ける・生成の途中復帰・5 タブナビ・44px を意識したボタン」といった骨格を持っている。一方で、**主婦が最初に詰まる／誤解する地点**がまだ残っている。

1. **任意のはずの家族設定に逃げ道がない** — Welcome で「家族情報を登録する」と押すと `/onboarding` に閉じ込められる（下部ナビなし・「あとで」なし）。
2. **マジックリンクをメールアプリ内ブラウザで開いたあとにやり直しがない** — 「元のブラウザへ」とだけ言われて行き止まり。
3. **アイデア献立モードから緊急献立へ行くと「家族が未登録」と嘘を言う** — 家族がいても idea モードでは未ロードなのに理由が誤っている。
4. **ウィザード用 ProgressIndicator は作ってあるのにプランナーで未使用** — 「今どこ／あと何問」が見えない。
5. **履歴の再検査エラーに `member_1` や英語アレルゲン ID がそのまま出る** — アレルギーで詰まっている最中に壊れたアプリに見える。
6. **「安全確認が完了するまで…」など保証隣接語**が買い物ゲートに残る。オンボーディング／買い物リスト既定面には設計が求める常時注意書きが無い。

運用者向け用語（OpenRouter、作成ID、AI通信試行、データベースID、辞書版 `jp-caa-…`）が利用者向け本文に混ざるのは、仕様の「内部 ref を出さない／平易に」に対する系統的なズレである。

---

## Critical（優先対応）

### [C-1] 家族オンボーディングに脱出導線がなく「任意」が嘘になる

- **場所**: `src/features/household/household-onboarding-page.tsx`（開始 UI ~228 行付近、ドラフト中も完了系のみ）、`src/app/router.tsx`（`/onboarding` は AppShell 外）
- **ユーザー像**: Welcome で「家族情報を登録する」を誤タップ／試してやめたくなった。下部ナビなし。ブラウザ「戻る」を知らない／履歴が無いと詰む。
- **証拠**: 主 CTA は「家族設定を始める」「この家族の設定を完了する」のみ。eyebrow は「家族設定（任意）」なのに「あとで設定」「設定せず献立へ」が無い。設計 §10.3 は「あとで設定」を要求。
- **提案**: 全段階に「あとで設定する」「設定せず献立アイデアを考える」を置き、`skipped` / `in_progress` のまま Welcome または planner へ戻せるようにする。

### [C-2] マジックリンク deposited 画面に「やり直す」が無い

- **場所**: `src/features/auth/auth-callback-page.tsx:90-98`
- **ユーザー像**: Gmail アプリ内ブラウザでリンクを開く →「元のブラウザで続けてください」だけ。Chrome タブを閉じた主婦は詰む。
- **証拠**: deposited は説明文のみ。`/login` へのボタンなし。
- **提案**: 具体手順（メールアプリを閉じる → さっきのブラウザタブ）＋「うまくいかないときは最初からやり直す」→ `/login` の 44px ボタン。

### [C-3] アイデアモードの緊急献立が「家族未登録」と誤表示する

- **場所**: `src/features/emergency/emergency-menu-page.tsx:111-141, 183-201`；失敗時 CTA `generation-status-panel.tsx:70-78`
- **ユーザー像**: 「人数だけ指定してアイデア」で生成失敗 →「15分緊急献立を見る」。家族は登録済み。
- **証拠**: `targetMode === "idea"` では household をロードせず `targetMemberIds = []`。空表示は常に「対象の家族が登録されていないため…」。review-step は idea 時に緊急 CTA を出さないが、**生成失敗パネルは無条件で `/emergency-menus` を出す**。
- **提案**: idea 時は「緊急献立は家族向けです。『家族に合わせて作る』に切り替えてから」＋ planner への導線。真に未登録のときだけ未登録文言。

### [C-4] ウィザード ProgressIndicator がプランナーで未使用

- **場所**: `src/shared/ui/wizard/progress-indicator.tsx` / `wizard-frame.tsx` は存在。`src/features/planner/**` に import ゼロ。各 step は「1. 食事」…見出し番号のみ。
- **ユーザー像**: 中断後 step 3 に戻ったとき「あと何問で作れるか」が分からない。
- **証拠**: guided planner 設計は ProgressIndicator を要求。共有 UI はテスト済みだが planner 経路に未接続。
- **提案**: 各ステップに `ProgressIndicator`（または `WizardFrame`）を載せ `totalSteps={5}` を固定表示。

### [C-5] 履歴 invalid の issue が `member_1` / 英語アレルゲン ID を露出

- **場所**: UI `history-detail-page.tsx:630-637`（`issue.message` をそのまま表示）；生成元 `shared/safety/allergens.ts:187` ほか
- **メッセージ例**: `` `${member.anonymousRef} の登録アレルゲン ${allergenId} が残っています` ``
- **ユーザー像**: 条件変更後に履歴を開きブロックされた。`member_1` と `egg` のような文字列が出て信頼が崩れる。
- **提案**: 表示名＋アレルゲン日本語名で組み立てる（結果画面のラベル確認と同パターン）。内部 ref は API 内部に閉じる。

### [C-6] 「安全確認」語と注意書きの配置ギャップ

- **場所**: 買い物 `shopping-list-page.tsx:187` 「**安全確認**が完了するまで買い物操作はできません。」
- **設計**: §6 / §221 は保証表現と「安全確認済み」系を禁じ、非保証注意を**初回設定・結果・履歴・買い物リスト**に常時。
- **証拠**: オンボーディング本文に加工品／保証できない注意なし。買い物は警告があるときのみ注意が付き、既定リスト面に常時 DISCLAIMER が無い。結果／履歴は DISCLAIMER あり。
- **提案**: ゲート文言を「家族設定の再確認が終わるまで…」に。オンボーディングと買い物に結果と同趣旨の常時非保証 1 行。

---

## Important（ユーザーが困るか誤解する）

### 認証・初回

| ID | 要約 | 場所の目安 |
|----|------|------------|
| I-A1 | プライバシー文が `member_1` / データベースID / OpenRouter / AI生回答 | `privacy-copy.ts` |
| I-A2 | マジックリンク期限切れで sent 画面に戻らずメール再入力 | `auth-callback-page` → `login-page` |
| I-A3 | 送信済み UI がリロードで消える（再送カウント失念） | `login-page` state only |
| I-A4 | Welcome／onboarding の通信エラーに「再読み込み」ボタン無し | `welcome-route-page`, onboarding |
| I-A5 | アレルギー「未確認」のまま「設定を完了」可能（献立では使えない） | onboarding `canComplete` |
| I-A6 | 「今はAIを使わない」後に緊急献立へのボタン無し | `privacy-notice-page` |

### 献立・生成

| ID | 要約 | 場所の目安 |
|----|------|------------|
| I-G1 | オートセーブ状態が UI に出ない（conflict 時だけ説明） | `use-draft-autosave` / planner-route |
| I-G2 | 確認画面の「本日あとN回」が成功残のみ。attempt／短期窓が弱い | `review-step` |
| I-G3 | 失敗時「成功回数には含まれません」と attempt 消費の対が不完全 | `generation-status-panel` |
| I-G4 | 「作成ID」と書いて実 ID は見せない → 探してしまう | 同上 processing/offline |
| I-G5 | 緊急献立オープン失敗が「生成を開始しませんでした」と誤コピー | `planner-route` flush |
| I-G6 | 結果の冷蔵庫利用に**使用料理**が無い（緊急側には 使用先 あり） | `menu-result.tsx` |
| I-G7 | 確認サマリが「家族 N 人」で名前を出さない | `review-step` |
| I-G8 | 緊急候補ゼロ時、緩められない／設定へ誘導が弱い | `emergency-menu-page` |

### 履歴・買い物・設定

| ID | 要約 | 場所の目安 |
|----|------|------------|
| I-H1 | 「条件が変わっています」が sticky でなく、`changedDetails` の日本語化なし | history-detail |
| I-H2 | 家族向け履歴詳細に「お気に入り」操作が無い | history-detail household strip |
| I-H3 | 「新しいリストにする」が既存リストの行方を説明しない | create-list-sheet |
| I-H4 | 買い物の check/削除等に in-flight 無効化が無く二重タップ | shopping-list-page / item-row |
| I-H5 | 突合シートで「削除候補」がデフォルト全チェック | reconcile-list-sheet |
| I-H6 | 冷蔵庫は「注意表示」と書いてソートのみ・期限切れ強調なし | pantry-page |
| I-H7 | 家族削除が「設定だけを削除」で不可逆性が弱い | household-settings |
| I-H8 | 再生成シートの残り回数が load 前 `?? 0`、0 でも送信可 | regeneration-sheet / detail |
| I-H9 | `/menus/:id` で下部ナビのどれも active にならない | app-shell NavLink |

### 文言・a11y 横断

| ID | 要約 | 場所の目安 |
|----|------|------------|
| I-X1 | 「AI通信試行」「10分間の通信試行」が運用用語 | generation-status-panel, review-step |
| I-X2 | ラベル確認 UI に `辞書版 jp-caa-…` | menu-result |
| I-X3 | ローディングが timeout／再試行／h1 不統一 | protected-routes, shopping, etc. |
| I-X4 | `a.primary-button` が global の min-width 44px を継承しない | styles.css vs anchors |
| I-X5 | ログイン「認証」「認証情報」が IT 用語 | login / callback |

---

## Minor（品質・一貫性）

- Welcome の h1「どちらから始めますか？」がスライド中も固定（M）
- AppShell 外画面も bottom-nav 用下 padding を確保しスクロール増（M）
- 追加条件に「（任意）」ラベルなし（M）
- メイン食材ステップが 1 問に 3 タスクで密度高い（M）
- 料理タブ selected に太字を足すと屋外視認が良い（M）
- 履歴に「お気に入りだけ」フィルタなし（M）
- 買い物 empty が raw `<a href>` でフルリロード（M）
- 履歴詳細ロード失敗に retry なし（M）
- create/reconcile が true modal でなく折りたたみ下に埋もれる（M）
- 冷蔵庫削除が `window.confirm` のみ（M）
- 設定フォームが 1 ページに過密（M）
- チェック済み買い物行の opacity 0.56 は低視力に厳しい可能性（M）
- MenuResult 単体バナーは「保証しない」が弱く、親ページ依存（M）
- 「確認済み」チップは原材料確認の意味だが「安全」に読まれる残余リスク（M）

---

## 良い点（ユーザー目線で効いているもの）

- ログイン: Google 上・メール下、送信後の宛先・再送・変更・Google 切替の骨格
- Welcome の二択（家族／アイデア）と onboarding 完了・skipped 後の `/planner` 誘導
- プライバシー未同意でも生成を黙殺せず「説明を見る」へ誘導
- 生成: 偽の進捗率なし、二重送信抑制、leave-return 用の状態機械、失敗時の履歴／緊急導線（idea 誤表示を除く）
- 安全: 結果・履歴の DISCLAIMER、idea カードで「安全確認済み」系をテスト禁止
- ラベル確認は表示名＋アレルゲン日本語（member_1 を出さない経路がある）
- 買い物: 家にある／元に戻す、通路 sticky、削除確認文化
- アカウント削除: フレーズ入力の破壊的操作ゲート
- 下部ナビ 5 項目・ラベル付き・色以外の active 表現
- 本文 12px 未満を避けるトークン、多くの button に 44px フロア

---

## 修正の推奨順（エンドユーザー影響）

1. **即時**: C-1 オンボーディング脱出、C-2 deposited やり直し、C-3 idea→緊急の誤文言と CTA、C-5 history issue の人間向け文言、C-6 安全確認語と注意書き配置  
2. **次**: C-4 ProgressIndicator 接続、I-A1 プライバシー平易化、I-G1 保存ステータス、I-G2/I-G3/I-X1 上限・失敗の平易な二系統説明、I-G4 作成ID 言い換え、I-H1 sticky＋何が変わったか、I-H3/I-H5 買い物破壊、I-H4 二重タップ防止  
3. **磨き**: ローディング統一、anchor の 44×44、冷蔵庫期限強調、お気に入り詳細、nav active for `/menus/:id`、用語（認証→ログイン確認）

---

## 検証範囲外

- 実機 320–375 CSS px での視覚確認・Gmail アプリ内 WebView 実機
- 長時間生成ポーリングの体感（30–50s）
- スクリーンリーダー通し読み
- 2026-07-25 コードレビューのインフラ／RLS／クォータ実装の再監査（別ドキュメント）

---

## サブレポートパス

```
/tmp/grok-1000/ux-review-05f1c454/01-auth-onboarding.md
/tmp/grok-1000/ux-review-05f1c454/02-planner-generation.md
/tmp/grok-1000/ux-review-05f1c454/03-history-shopping-settings.md
/tmp/grok-1000/ux-review-05f1c454/04-copy-a11y-crosscut.md
```

親照合で Critical はすべてコード上再現確認済み（C-1〜C-6）。

**二次深掘り:** `docs/reviews/2026-07-26-adversarial-ux-review-secondary.md`  
（C-4 を Important へ格下げ、C-6 を Important へ分割、C-5 の到達面を結果・買い物へ拡大、など。）
