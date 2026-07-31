# UI配色・文言リフレッシュ 設計

- 日付: 2026-07-21
- ブランチ: `ui/palette-and-copy-refresh`
- 対象: `src/styles.css` のカラートークン、および画面文言のうち内部語が漏れている箇所

## 背景と目的

ログイン後のUIを実機確認したところ、次の2点が課題として挙がった。

1. 配色がくすんでおり、モダンな印象がない。
2. 項目名の一部に機能内部の語が漏れており、ITに不慣れな利用者に意味が伝わらない。

本設計はこの2点だけを扱う。レイアウト構造、情報設計、ナビゲーション構成は変更しない。

この作業はロードマップ Plans 1–6 の範囲外であり、利用者からの直接依頼として独立ブランチで進める。

## 非目標

- コンポーネント層の新設（`src/shared/ui` へのButton/Card抽出）。筋は良いがリファクタであり、配色刷新とは目的が異なる。
- Tailwind v4 `@theme` への移行と各TSXのユーティリティクラス化。57ファイルに差分が及び、目的に対して過大。
- レイアウト・導線・見出し階層の再設計。

## 方針

既存コードは全画面が `.card` / `.primary-button` / `var(--primary)` といったセマンティックなクラスとカスタムプロパティを経由している。したがって **`src/styles.css` の `:root` トークン値を差し替えるだけで全画面に反映され、TSXの差分はゼロ**になる。文言修正はこれとは独立に、対象ファイルのみをピンポイントで編集する。

## 配色トークン

| トークン | 現在 | 変更後 | 意図 |
|---|---|---|---|
| `background` | `#f7f1e8` | `#f8fafc` | くすんだベージュ → 清潔なライトグレー |
| `--surface` | `#fffaf3` | `#ffffff` | カードを純白にして背景から浮かせる |
| `--text` | `#332c27` | `#1e293b` | 茶系 → 濃いスレート |
| `--muted` | `#6f6258` | `#64748b` | 同上 |
| `--primary` | `#b85f44` | `#f97316` | くすんだテラコッタ → 鮮やかオレンジ |
| `--primary-hover` | `#97462f` | `#ea580c` | |
| `--primary-ink` | （新規） | `#1e293b` | 主色を塗りにしたときの前景色 |
| `--primary-strong` | （新規） | `#c2410c` | 白背景に主色系の文字を置くときの前景色 |
| `--border` | `#d9cabc` | `#e2e8f0` | |
| `--danger` | `#a33b35` | `#dc2626` | |
| `--pantry` | `#5f745f` | `#0f766e` | くすんだ緑 → ティール |

`.card` の影は `0 8px 24px rgb(82 60 43 / 8%)` から `0 1px 3px rgb(15 23 42 / 8%), 0 8px 24px rgb(15 23 42 / 6%)` へ。二段の影で、濃さを増やさずに浮遊感を出す。

### コントラスト比（WCAG AA = 通常文字 4.5:1）

実測値。相対輝度から算出した。

| 組み合わせ | 比 | 判定 |
|---|---|---|
| `--text` `#1e293b` on `background` `#f8fafc` | 14.1:1 | 合格 |
| `--muted` `#64748b` on `--surface` `#ffffff` | 4.76:1 | 合格 |
| `--primary-ink` `#1e293b` on `--primary` `#f97316` | 5.25:1 | 合格 |
| （参考）`#ffffff` on `--primary` `#f97316` | 2.79:1 | **不合格** |
| （参考）`#ffffff` on `#ea580c` | 3.56:1 | **不合格** |

`.primary-button` は現在 `color: #fff` で塗りボタンを描いている。鮮やかなオレンジに白文字を載せると AA を満たせない。ブレインストーミング中に「`#ea580c` なら 4.6:1」と述べたが、これは誤りで、実測は 3.56:1 だった。

対処として **`.primary-button` の前景色を `var(--primary-ink)`（濃いスレート）に変更**し、鮮やかな `#f97316` の塗りを維持したまま 5.25:1 を確保する。オレンジを暗くして白文字を保つ案（`#c2410c` で 5.18:1）も成立するが、利用者が避けたいとしたくすんだテラコッタへ色味が逆戻りするため採らない。

`.secondary-button` と `.text-button` は現在 `color: var(--primary-hover)` を白背景に載せている。`#ea580c` は白背景に対し 3.9:1 で通常文字の AA を割るため、これらの前景色は `var(--primary-strong)` `#c2410c`（白背景に対し 5.18:1）へ差し替える。`--primary-hover` は引き続き `.primary-button:hover` の**背景**にのみ用いる。枠線と背景色には `#f97316` を使ってよい。

同じ理由で `.eyebrow`（現在 `color: var(--primary)`）と `.nav-item-active`（現在 `color: var(--primary-hover)`）も `var(--primary-strong)` を用いる。

## 文言

### 修正対象

| 現在 | 変更後 | ファイル |
|---|---|---|
| 期限種別不明 | 期限の種類は未登録 | `src/features/pantry/pantry-page.tsx` |
| 開封状態不明 | 開けたかは未登録 | `src/features/pantry/pantry-page.tsx` |
| 不明 | わからない | `src/features/pantry/pantry-form.tsx` |
| 不明として登録 | わからないまま登録 | `src/features/pantry/pantry-form.tsx` |
| 対象家族 | 誰の分を作りますか | `src/features/planner/planner-page.tsx` |
| 年齢区分 | 年齢のめやす | `household-onboarding-page.tsx`, `household-settings-page.tsx`, `household-settings-schema.ts` |
| 対象外の食事の確認 | 食べない食事はありますか | `household-onboarding-page.tsx`, `household-settings-page.tsx`, `household-settings-schema.ts` |
| 標準29品目を検索 | よくあるアレルギーから探す | `src/features/household/allergy-editor.tsx` |
| 標準候補に該当しないことを確認 | 一覧にないアレルギーとして登録 | `src/features/household/allergy-editor.tsx` |
| 表示名を確認できない項目 | 名前を表示できない項目 | `src/features/household/allergy-editor.tsx` |
| 現在の利用状況 | 今日あと何回作れるか | `src/features/generation/components/generation-status-panel.tsx` |
| 受付中 | 作成できます | 同上 |
| 本日分終了 | 今日はここまで | 同上 |
| 履歴・お気に入り | 作った献立 | `history-page.tsx`, `generation-status-panel.tsx` |

### 意図的に変更しないもの

- **「冷蔵庫」「主菜」「副菜」「汁物」「主食」** — いずれも日常語で、内部語ではない。「冷蔵庫」は約20ファイルに散在しており、置換コストが便益に見合わない。
- **安全確認まわりの文言**（「現在の家族設定で確認しました」「加工品はラベル確認が必要です。AI生成レシピだけでアレルギー対応を保証するものではありません。」など） — 設計スペック `2026-07-11-kondate-mvp-design.md` 221行が「アレルギー対応済み」「安全」といった保証表現を禁じている。これらを平易化する過程で保証表現に寄せることは仕様違反にあたるため、原文のまま維持する。
- **エラーメッセージ全般** — すでに「〜できませんでした。通信を確認してください」形式で平易。
- **コードコメント内の「短期窓」** — 画面には出力されない。

### 遵守する既存制約

- 状態表現は色だけに依存させない（スペック352行）。トークン差し替えは既存の文字・太さ・枠による状態表現を変更しないため、この制約は維持される。
- 安全確認を想起させる緑色チェックは使用しない。`--pantry` をティールに変更するが、これは冷蔵庫由来食材のラベル色であり、安全判定の表示ではない。

## 検証

1. `docker compose run --rm --no-deps app npm run lint`、`format:check`、`typecheck`。
2. 文言を変更した各ファイルの単体テストをスコープ実行し、日本語文字列で要素を引いているアサーションを新文言へ追随させる。対象は約8ファイル。
3. **E2E は影響を受ける。** 計画作成時の調査で、「年齢区分」「対象外の食事の確認」「標準候補に該当しないことを確認」が Playwright の `getByLabel` セレクタとして次の5ファイルから参照されていることが判明した。ブレインストーミング時点では無影響と見込んでいたが、これは誤りだった。

   - `e2e/fixtures/auth.ts`（オンボーディングを駆動する共通フィクスチャ）
   - `e2e/specs/onboarding.spec.ts`
   - `e2e/specs/settings.spec.ts`
   - `e2e/specs/menu-domain-pantry.spec.ts`

   `e2e/fixtures/auth.ts` は多くのspecが依存する共通フィクスチャのため、ここを直し損ねるとE2E全体が落ちる。文言変更と同一コミットでセレクタを更新する。
4. dev サーバを起動し、320 CSS px 幅で全5タブを目視。横スクロールが出ないこと、44×44 のタッチ領域が維持されていることを確認。

## リスク

- 文言変更による単体テストの破壊は想定内で、追随作業を検証手順に織り込んである。
- `--pantry` と `--danger` の変更は、それらを参照する箇所のコントラストを個別に確認していない。実装時に該当箇所を洗い出して測定する。
