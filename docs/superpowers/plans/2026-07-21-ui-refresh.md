# UI配色・文言リフレッシュ Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `src/styles.css` のカラートークンを明るくモダンな配色へ差し替え、あわせて画面文言のうち機能内部の語が漏れている箇所を平易な日本語へ直す。

**Architecture:** 既存コードは全画面が `.card` / `.primary-button` / `var(--primary)` といったセマンティックなクラスとカスタムプロパティを経由している。したがって配色刷新は `:root` のトークン値差し替えだけで全画面に反映され、TSXの差分はゼロになる。文言修正はこれとは独立に、対象ファイルのみをピンポイントで編集する。レイアウト構造・情報設計・ナビゲーション構成は変更しない。

**Tech Stack:** React 19 / Vite 8 / Tailwind CSS 4 / Vitest / Playwright

**仕様書:** `docs/superpowers/specs/2026-07-21-ui-refresh-design.md`

## Global Constraints

- Node.js `>=24 <25` のみ。ESM。TypeScript `strict: true`、ネットワーク/DB境界で `any` や未検査キャストを使わない。
- 全ユーザー向け文言は日本語。コメントとコミットメッセージは日本語、識別子とテスト名は英語。
- モバイルファースト。320 CSS px で横スクロールを発生させない。タッチ領域は 44×44 CSS px 以上。
- 状態表現を色だけに依存させない（設計スペック352行）。文字・太さ・枠による既存の状態表現を削らない。
- 「アレルギー対応済み」「安全」等の保証表現、および安全確認を想起させる緑色チェックは使用しない（設計スペック221行）。
- 安全確認まわりの既存文言（「現在の家族設定で確認しました」「加工品はラベル確認が必要です。AI生成レシピだけでアレルギー対応を保証するものではありません。」等）は**変更しない**。
- 「冷蔵庫」「主菜」「副菜」「汁物」「主食」は日常語であり**変更しない**。
- Nodeコマンドは Docker 経由で実行する: `docker compose run --rm --no-deps app npm ...`。E2Eは `./scripts/run-e2e.sh` をホストで直接実行する（`app` コンテナにDockerソケットは無い）。
- 検証には `format:check` を使う。`format` は `prettier --write .` でファイルを書き換えるため検証手段にならない。
- コミットは Conventional Commit 形式・日本語。1タスク1コミット。

---

## File Structure

| ファイル | 変更内容 |
|---|---|
| `src/styles.css` | `:root` カラートークン、`.card` の影、主色を前景に使う各クラス |
| `src/styles.contrast.test.ts` | 新規。トークンのコントラスト比が AA を満たすことを検証 |
| `src/features/pantry/pantry-page.tsx` | 期限/開封ラベルの「不明」表現 |
| `src/features/pantry/pantry-form.tsx` | 同上 |
| `src/features/planner/planner-page.tsx` | 「対象家族」を含む2文 |
| `src/features/household/household-onboarding-page.tsx` | 「年齢区分」「対象外の食事の確認」 |
| `src/features/household/household-settings-page.tsx` | 同上 |
| `src/features/household/household-settings-schema.ts` | 同上（バリデーションメッセージ） |
| `src/features/household/allergy-editor.tsx` | 「標準29品目」「標準候補」「表示名を確認できない項目」 |
| `src/features/generation/components/generation-status-panel.tsx` | 「現在の利用状況」「受付中」「本日分終了」「履歴・お気に入り」 |
| `src/features/history/pages/history-page.tsx` | 「履歴・お気に入り」 |
| `e2e/fixtures/auth.ts`, `e2e/specs/{onboarding,settings,menu-domain-pantry}.spec.ts` | 変更したラベルを参照するセレクタ |

タスクは「配色（Task 1）」と「文言（Task 2〜6）」に分かれ、文言側は画面単位で分割してある。各タスクは独立してレビュー可能で、相互依存は無い。

---

### Task 1: 配色トークンの差し替え

**Files:**
- Modify: `src/styles.css`
- Test: `src/styles.contrast.test.ts`（新規作成）

**Interfaces:**
- Consumes: なし
- Produces: CSSカスタムプロパティ `--surface` `--text` `--muted` `--primary` `--primary-hover` `--primary-ink` `--primary-strong` `--border` `--danger` `--pantry`。以降のタスクはこれらを参照しない（文言のみを扱う）。

この配色設計はブレインストーミング中に一度コントラスト比を誤ったまま進みかけた。そのためトークン値そのものを検証するテストを先に書く。

- [ ] **Step 1: コントラスト比を検証する失敗するテストを書く**

`src/styles.contrast.test.ts` を新規作成:

```ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const css = readFileSync(fileURLToPath(new URL("./styles.css", import.meta.url)), "utf8");

/** :root ブロックから `--name: #rrggbb;` を読み出す。 */
function token(name: string): string {
  const value = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(css)?.[1];
  if (value === undefined) throw new Error(`token --${name} not found`);
  return value;
}

/** 16進色の1チャンネル分をガンマ補正した値。offset は r=1, g=3, b=5。 */
function channel(hex: string, offset: number): number {
  const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

/** sRGB 16進色の相対輝度（WCAG 2.1 定義）。 */
function luminance(hex: string): number {
  return 0.2126 * channel(hex, 1) + 0.7152 * channel(hex, 3) + 0.0722 * channel(hex, 5);
}

function contrast(foreground: string, background: string): number {
  const a = luminance(foreground);
  const b = luminance(background);
  const [light, dark] = a > b ? [a, b] : [b, a];
  return (light + 0.05) / (dark + 0.05);
}

describe("color token contrast", () => {
  const white = "#ffffff";

  it("keeps body text readable on the page background", () => {
    expect(contrast(token("text"), "#f8fafc")).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps muted text readable on card surfaces", () => {
    expect(contrast(token("muted"), token("surface"))).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps primary-button label readable on the primary fill", () => {
    expect(contrast(token("primary-ink"), token("primary"))).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps primary-coloured text readable on white", () => {
    expect(contrast(token("primary-strong"), white)).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps error text readable on card surfaces", () => {
    expect(contrast(token("danger"), token("surface"))).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps pantry-accent text readable on card surfaces", () => {
    expect(contrast(token("pantry"), token("surface"))).toBeGreaterThanOrEqual(4.5);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

```bash
docker compose run --rm --no-deps app npm test -- --run src/styles.contrast.test.ts
```

期待: FAIL。`token --primary-ink not found` および `token --primary-strong not found`（未定義のトークンを参照しているため）。`text` と `muted` は現行の茶系トークンで比率自体は満たす可能性があるが、`primary-ink` / `primary-strong` の2件は必ず落ちる。落ちる理由がトークン未定義であることを確認する。

- [ ] **Step 3: `:root` のトークンを差し替える**

`src/styles.css` の `:root` ブロックを次の内容に置き換える:

```css
:root {
  color: #1e293b;
  background: #f8fafc;
  font-family: "Noto Sans JP", "Hiragino Kaku Gothic ProN", "Yu Gothic", system-ui, sans-serif;
  font-synthesis: none;
  text-rendering: optimizeLegibility;
  --surface: #ffffff;
  --text: #1e293b;
  --muted: #64748b;
  --primary: #f97316;
  --primary-hover: #ea580c;
  --primary-ink: #1e293b;
  --primary-strong: #c2410c;
  --pantry: #0f766e;
  --danger: #dc2626;
  --border: #e2e8f0;
}
```

- [ ] **Step 4: テストが通ることを確認**

```bash
docker compose run --rm --no-deps app npm test -- --run src/styles.contrast.test.ts
```

期待: PASS（6件）。

- [ ] **Step 5: 主色を前景に使うクラスを修正する**

`--primary` `#f97316` に白文字を載せると 2.79:1、`--primary-hover` `#ea580c` でも 3.56:1 で AA を満たさない。前景としての主色は用途で使い分ける。

`.primary-button` の `color: #fff;` を差し替える:

```css
.primary-button {
  border: 1px solid var(--primary);
  color: var(--primary-ink);
  background: var(--primary);
}
```

`.secondary-button` と `.text-button` の前景色を `--primary-strong` に差し替える:

```css
.secondary-button {
  border: 1px solid var(--primary);
  color: var(--primary-strong);
  background: transparent;
}

.text-button {
  border: 0;
  color: var(--primary-strong);
  background: transparent;
  text-decoration: underline;
}
```

`.eyebrow` と `.nav-item-active` も同様に:

```css
.eyebrow {
  color: var(--primary-strong);
  font-weight: 700;
}
```

```css
.nav-item-active {
  border-top-color: var(--primary);
  color: var(--primary-strong);
}
```

`--primary-hover` は `.primary-button:hover` の**背景**にのみ用いる。既存の `.primary-button:hover { background: var(--primary-hover); }` は変更しない。

- [ ] **Step 6: カードの影とナビ背景を新しい背景色に合わせる**

`.card` の影を二段にして、濃さを増やさずに浮遊感を出す:

```css
.card {
  border: 1px solid var(--border);
  border-radius: 18px;
  background: var(--surface);
  padding: 20px;
  box-shadow:
    0 1px 3px rgb(15 23 42 / 8%),
    0 8px 24px rgb(15 23 42 / 6%);
}
```

`.bottom-nav` の背景は旧クリーム色 `rgb(255 250 243 / 96%)` のままだと新しい白背景から浮くため差し替える:

```css
.bottom-nav {
  position: fixed;
  z-index: 10;
  right: 0;
  bottom: 0;
  left: 0;
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  border-top: 1px solid var(--border);
  background: rgb(255 255 255 / 96%);
  backdrop-filter: blur(8px);
}
```

- [ ] **Step 7: 検証を実行**

```bash
docker compose run --rm --no-deps app npm test -- --run src/styles.contrast.test.ts
docker compose run --rm --no-deps app npm run typecheck
docker compose run --rm --no-deps app npm run lint
docker compose run --rm --no-deps app npm run format:check
```

期待: すべて成功。`styles.css` 以外に差分は無いため既存の単体テストは影響を受けないが、念のため `git diff --stat` で変更が `src/styles.css` と新規テストの2ファイルに収まっていることを確認する。

- [ ] **Step 8: 320px 幅で目視確認**

```bash
docker compose up -d --wait
```

ブラウザで `http://127.0.0.1:5173` を 320 CSS px 幅で開き、ログイン後に献立・冷蔵庫・履歴・買い物・設定の5タブを確認する。チェック項目:

- 横スクロールが発生しない。
- 下部ナビの選択中タブが、色だけでなく上部の枠線と文字色の両方で判別できる。
- 主ボタンの文字が背景に埋もれない。

- [ ] **Step 9: コミット**

```bash
git add src/styles.css src/styles.contrast.test.ts
git commit -m "$(cat <<'EOF'
feat: 配色トークンを明るいベースと鮮やかな主色へ差し替える

くすんだベージュ/テラコッタから、白ベースと鮮やかなオレンジへ移行する。
主色に白文字を載せるとAAを満たさないため、塗り用の前景色と白背景用の
前景色をトークンとして分離した。コントラスト比は新規テストで検証する。
EOF
)"
```

---

### Task 2: 冷蔵庫画面の「不明」表現

**Files:**
- Modify: `src/features/pantry/pantry-page.tsx:17-26`
- Modify: `src/features/pantry/pantry-form.tsx:18-28`

**Interfaces:**
- Consumes: なし
- Produces: なし（表示文字列のみ）

「期限種別不明」「開封状態不明」は内部のenum名をそのまま日本語化した語で、利用者には意味が伝わらない。実態は「未登録」である。

調査済み: これらの文字列を参照する単体テスト・E2Eは存在しない。したがってこのタスクに追随更新は発生しない。

- [ ] **Step 1: 変更前に参照が無いことを再確認**

```bash
grep -rn "期限種別不明\|開封状態不明\|不明として登録" src e2e
```

期待: `src/features/pantry/pantry-page.tsx` と `src/features/pantry/pantry-form.tsx` のみがヒットする。テストファイルやE2Eがヒットした場合は、そのアサーションも同時に更新すること。

- [ ] **Step 2: `pantry-page.tsx` のラベルを修正**

```tsx
const expiryLabels = {
  use_by: "消費期限",
  best_before: "賞味期限",
  other: "期限",
  unknown: "期限の種類は未登録",
} as const;
const openedLabels = {
  unopened: "未開封",
  opened: "開封済み",
  unknown: "開けたかは未登録",
} as const;
```

- [ ] **Step 3: `pantry-form.tsx` の選択肢を修正**

```tsx
const expirationLabels = {
  use_by: "消費期限",
  best_before: "賞味期限",
  other: "その他",
  unknown: "わからない",
} as const;
const openedLabels = {
  unopened: "未開封として登録",
  opened: "開封済みとして登録",
  unknown: "わからないまま登録",
} as const;
```

- [ ] **Step 4: 冷蔵庫画面のテストを実行**

```bash
docker compose run --rm --no-deps app npm test -- --run src/features/pantry
```

期待: PASS。落ちた場合は該当アサーションを新文言へ追随させる。

- [ ] **Step 5: 検証とコミット**

```bash
docker compose run --rm --no-deps app npm run typecheck
docker compose run --rm --no-deps app npm run lint
docker compose run --rm --no-deps app npm run format:check
git add src/features/pantry
git commit -m "$(cat <<'EOF'
fix: 冷蔵庫画面の「不明」表記を未登録と分かる語に直す

「期限種別不明」「開封状態不明」は内部のenum名由来の語で意味が伝わらない。
実態が未入力であることが分かる表現に置き換える。
EOF
)"
```

---

### Task 3: 献立画面の「対象家族」

**Files:**
- Modify: `src/features/planner/planner-page.tsx:157`
- Modify: `src/features/planner/planner-page.tsx:208`

**Interfaces:**
- Consumes: なし
- Produces: なし（表示文字列のみ）

「対象家族」は単独ラベルではなく2つの文の中にある。見出しは既に「献立を作る家族」で平易なため、この2文だけを直す。

`src/features/planner/planner-page.test.tsx`、`planner-route.test.tsx`、`planner-route-limits.test.tsx`、`src/features/emergency/emergency-menu-api.test.ts` が「対象家族」を含む文字列を参照している。テストを先に直して落とし、実装で通す。

- [ ] **Step 1: 参照箇所を洗い出す**

```bash
grep -rn "対象家族" src
```

期待: 実装2件（`planner-page.tsx:157`, `:208`）とテスト4ファイル。各テストが上記2文のどちらを参照しているかを確認する。

- [ ] **Step 2: テスト側のアサーションを新文言へ書き換える（RED）**

該当テストの期待文字列を次のとおり置き換える。

- `"対象家族の条件が変わったため、緊急献立への移動を中止しました。"`
  → `"作る相手の条件が変わったため、緊急献立への移動を中止しました。"`
- `"対象家族は20人までです。選択中の家族を外すと追加できます。"`
  → `"選べる家族は20人までです。誰かを外すと追加できます。"`

- [ ] **Step 3: テストが失敗することを確認**

```bash
docker compose run --rm --no-deps app npm test -- --run src/features/planner src/features/emergency/emergency-menu-api.test.ts
```

期待: FAIL。実装がまだ旧文言を返すため、期待文字列との不一致で落ちる。

- [ ] **Step 4: 実装を修正（GREEN）**

`planner-page.tsx:157`:

```tsx
      setGenerationError("作る相手の条件が変わったため、緊急献立への移動を中止しました。");
```

`planner-page.tsx:208`:

```tsx
          ) && <p>選べる家族は20人までです。誰かを外すと追加できます。</p>}
```

- [ ] **Step 5: テストが通ることを確認**

```bash
docker compose run --rm --no-deps app npm test -- --run src/features/planner src/features/emergency/emergency-menu-api.test.ts
```

期待: PASS。

- [ ] **Step 6: 検証とコミット**

```bash
docker compose run --rm --no-deps app npm run typecheck
docker compose run --rm --no-deps app npm run lint
docker compose run --rm --no-deps app npm run format:check
git add src/features/planner src/features/emergency
git commit -m "$(cat <<'EOF'
fix: 献立画面の「対象家族」を平易な言い回しに直す

「対象」は機能側の語で利用者に伝わらないため、誰の分を作るかが分かる
表現に置き換える。
EOF
)"
```

---

### Task 4: 家族設定の「年齢区分」「対象外の食事の確認」

**Files:**
- Modify: `src/features/household/household-onboarding-page.tsx:205,252,254,359,361,429`
- Modify: `src/features/household/household-settings-page.tsx:790,911,931`
- Modify: `src/features/household/household-settings-schema.ts:16,18`
- Modify: `e2e/fixtures/auth.ts:94,96`
- Modify: `e2e/specs/onboarding.spec.ts:7,10,12`
- Modify: `e2e/specs/settings.spec.ts:15,16,18,21`
- Modify: `e2e/specs/menu-domain-pantry.spec.ts:70,72`
- Test: `src/features/household/household-onboarding-page.test.tsx`, `src/features/household/household-settings-page.test.tsx`

**Interfaces:**
- Consumes: なし
- Produces: なし（表示文字列のみ）

これが最も影響範囲の広いタスク。「年齢区分」「対象外の食事の確認」は `<span>` 表示と `aria-label` の両方に現れ、Playwright の `getByLabel` セレクタとしても使われている。とくに `e2e/fixtures/auth.ts` は多くのspecが依存する共通フィクスチャで、ここを直し損ねるとE2E全体が落ちる。

置換対象:

- 「年齢区分」→「年齢のめやす」
- 「年齢区分を選んでください」→「年齢のめやすを選んでください」
- 「対象外の食事の確認」→「食べない食事はありますか」
- 「対象外の食事の確認を選んでください」→「食べない食事があるか選んでください」
- 「対象外の食事」（`<legend>`）→「食べない食事」

- [ ] **Step 1: 全参照箇所を洗い出す**

```bash
grep -rn "年齢区分\|対象外の食事" src e2e
```

期待: 実装3ファイル、単体テスト2ファイル、E2E4ファイル。この一覧を作業対象として控える。

- [ ] **Step 2: 単体テストのアサーションを新文言へ書き換える（RED）**

`household-onboarding-page.test.tsx` と `household-settings-page.test.tsx` の中で、旧文言を `getByLabelText` / `getByText` などに渡している箇所を次のとおり置き換える。長い文字列から先に置換すること（「年齢区分」を先に置換すると「年齢区分を選んでください」が壊れる）。

1. `年齢区分を選んでください` → `年齢のめやすを選んでください`
2. `対象外の食事の確認を選んでください` → `食べない食事があるか選んでください`
3. `対象外の食事の確認` → `食べない食事はありますか`
4. `年齢区分` → `年齢のめやす`
5. `対象外の食事` → `食べない食事`

- [ ] **Step 3: テストが失敗することを確認**

```bash
docker compose run --rm --no-deps app npm test -- --run src/features/household
```

期待: FAIL。実装がまだ旧ラベルを描画するため、要素が見つからない旨で落ちる。

- [ ] **Step 4: `household-settings-schema.ts` のメッセージを修正（GREEN）**

```ts
    ageBand: z.enum(ageBands, "年齢のめやすを選んでください"),
    allergyStatus: z.enum(allergyStatuses, "アレルギーの確認を選んでください"),
    unsupportedDietStatus: z.enum(unsupportedDietStatuses, "食べない食事があるか選んでください"),
```

- [ ] **Step 5: `household-onboarding-page.tsx` を修正**

`:205` の導入文:

```tsx
        <p>年齢のめやす、アレルギー、食べない食事の3項目から始めます。</p>
```

`:252-254` の年齢セレクト:

```tsx
          <span>年齢のめやす</span>
          <select
            aria-label="年齢のめやす"
```

`:359-361` の対象外の食事セレクト:

```tsx
          <span>食べない食事はありますか</span>
          <select
            aria-label="食べない食事はありますか"
```

`:429` の注意文:

```tsx
          食べない食事を確認するまで、このメンバーは献立生成に使えません。
```

- [ ] **Step 6: `household-settings-page.tsx` を修正**

`:790`:

```tsx
          <span>年齢のめやす</span>
```

`:911`:

```tsx
          <span>食べない食事はありますか</span>
```

`:931`:

```tsx
            <legend>食べない食事</legend>
```

- [ ] **Step 7: 単体テストが通ることを確認**

```bash
docker compose run --rm --no-deps app npm test -- --run src/features/household
```

期待: PASS。

- [ ] **Step 8: E2Eのセレクタを更新**

`e2e/fixtures/auth.ts:94,96`、`e2e/specs/onboarding.spec.ts:7,10,12`、`e2e/specs/menu-domain-pantry.spec.ts:70,72` の `getByLabel("年齢区分")` を `getByLabel("年齢のめやす")` に、`getByLabel("対象外の食事の確認")` を `getByLabel("食べない食事はありますか")` に置き換える。

`e2e/specs/settings.spec.ts` は3箇所:

```ts
  await expect(page.getByRole("alert")).toContainText("年齢のめやすを選んでください");
  await expect(page.getByLabel("年齢のめやす")).toBeFocused();
  await page.getByLabel("年齢のめやす").selectOption("age_3_5");
```

および:

```ts
  await page.getByLabel("食べない食事はありますか").selectOption("none");
```

- [ ] **Step 9: 旧文言が残っていないことを確認**

```bash
grep -rn "年齢区分\|対象外の食事" src e2e
```

期待: ヒット0件。

- [ ] **Step 10: 検証**

```bash
docker compose run --rm --no-deps app npm run typecheck
docker compose run --rm --no-deps app npm run lint
docker compose run --rm --no-deps app npm run format:check
```

E2Eは出力が大きいため、エージェントのBashツールで直接回さず、次のコマンドを人間に依頼して結果の要約を貼ってもらう:

```bash
./scripts/run-e2e.sh
```

期待: 全spec PASS。フィクスチャを直したため、オンボーディングを経由する全specに影響が及ぶ点に注意。

- [ ] **Step 11: コミット**

```bash
git add src/features/household e2e
git commit -m "$(cat <<'EOF'
fix: 家族設定の項目名を日常語に直す

「年齢区分」「対象外の食事の確認」は制度用語寄りで意味が取りにくいため、
何を聞かれているか分かる表現に置き換える。ラベルをセレクタに使っている
E2Eフィクスチャとspecも同時に追随させる。
EOF
)"
```

---

### Task 5: アレルギー編集の「標準」表現

**Files:**
- Modify: `src/features/household/allergy-editor.tsx:82,84,146,153,186`
- Modify: `e2e/specs/settings.spec.ts:31`
- Test: `src/features/household/allergy-editor.test.tsx`, `src/features/household/household-settings-page.test.tsx`

**Interfaces:**
- Consumes: なし
- Produces: なし（表示文字列のみ）

「標準29品目」「標準候補」は食品表示法の用語で、一般利用者には通じない。「表示名を確認できない項目」は内部のデータ欠損状態をそのまま出している。

置換対象:

- 「標準29品目を検索」→「よくあるアレルギーから探す」
- 「標準候補に該当しないことを確認」→「一覧にないアレルギーとして登録」
- 「表示名を確認できない項目」→「名前を表示できない項目」

- [ ] **Step 1: 全参照箇所を洗い出す**

```bash
grep -rn "標準29品目を検索\|標準候補に該当しないことを確認\|表示名を確認できない項目" src e2e
```

期待: 実装1ファイル、単体テスト2ファイル、E2E1ファイル。

- [ ] **Step 2: 単体テストのアサーションを新文言へ書き換える（RED）**

`allergy-editor.test.tsx` と `household-settings-page.test.tsx` で旧文言をセレクタに渡している箇所を次のとおり置き換える。

1. `標準29品目を検索` → `よくあるアレルギーから探す`
2. `標準候補に該当しないことを確認` → `一覧にないアレルギーとして登録`
3. `表示名を確認できない項目` → `名前を表示できない項目`

- [ ] **Step 3: テストが失敗することを確認**

```bash
docker compose run --rm --no-deps app npm test -- --run src/features/household
```

期待: FAIL。要素が見つからない旨で落ちる。

- [ ] **Step 4: 実装を修正（GREEN）**

`:82-84` の検索フィールド:

```tsx
        <span>よくあるアレルギーから探す</span>
        <input
          aria-label="よくあるアレルギーから探す"
```

`:146` と `:153` のチェックボックス:

```tsx
            aria-label="一覧にないアレルギーとして登録"
```

```tsx
          一覧にないアレルギーとして登録
```

`:186` のフォールバック表示:

```tsx
          const displayName = name ?? "名前を表示できない項目";
```

- [ ] **Step 5: テストが通ることを確認**

```bash
docker compose run --rm --no-deps app npm test -- --run src/features/household
```

期待: PASS。

- [ ] **Step 6: E2Eのセレクタを更新**

`e2e/specs/settings.spec.ts:31`:

```ts
  await page.getByLabel("一覧にないアレルギーとして登録").check();
```

- [ ] **Step 7: 旧文言が残っていないことを確認**

```bash
grep -rn "標準29品目\|標準候補\|表示名を確認できない" src e2e
```

期待: ヒット0件。

- [ ] **Step 8: 検証とコミット**

```bash
docker compose run --rm --no-deps app npm run typecheck
docker compose run --rm --no-deps app npm run lint
docker compose run --rm --no-deps app npm run format:check
```

E2Eは Task 4 と同じ理由で人間に `./scripts/run-e2e.sh` の実行を依頼する。

```bash
git add src/features/household e2e
git commit -m "$(cat <<'EOF'
fix: アレルギー編集の「標準」表現を一般語に直す

「標準29品目」「標準候補」は食品表示法の用語で一般利用者に通じないため、
一覧から探す/一覧に無い、という操作が分かる表現に置き換える。
EOF
)"
```

---

### Task 6: 利用状況パネルと履歴の見出し

**Files:**
- Modify: `src/features/generation/components/generation-status-panel.tsx:32,36,111`
- Modify: `src/features/history/pages/history-page.tsx:21,45,56`
- Test: `src/features/generation/components/generation-status-panel.test.tsx`, `src/features/history/pages/history-page.test.tsx`

**Interfaces:**
- Consumes: なし
- Produces: なし（表示文字列のみ）

「現在の利用状況」「受付中」「本日分終了」は、利用者にとって知りたい「今日あと何回作れるか」を抽象化しすぎている。「履歴・お気に入り」は機能名の羅列で、中身が献立であることが分からない。

置換対象:

- `aria-label="現在の利用状況"` →「今日あと何回作れるか」
- 「アプリ全体受付：{受付中/本日分終了}」→「アプリ全体：{作成できます/今日はここまで}」
- 「履歴・お気に入りを見る」→「作った献立を見る」
- 履歴画面の `<h1>履歴・お気に入り</h1>` →「作った献立」

- [ ] **Step 1: 全参照箇所を洗い出す**

```bash
grep -rn "現在の利用状況\|受付中\|本日分終了\|履歴・お気に入り" src e2e
```

期待: 実装2ファイルと、それらのテスト。E2Eにヒットがあれば同時に更新対象へ加える。

- [ ] **Step 2: 単体テストのアサーションを新文言へ書き換える（RED）**

`generation-status-panel.test.tsx` と `history-page.test.tsx` で旧文言を参照している箇所を次のとおり置き換える。

1. `履歴・お気に入りを見る` → `作った献立を見る`
2. `現在の利用状況` → `今日あと何回作れるか`
3. `アプリ全体受付` → `アプリ全体`
4. `受付中` → `作成できます`
5. `本日分終了` → `今日はここまで`
6. `履歴・お気に入り` → `作った献立`

長い文字列から先に置換すること（`履歴・お気に入り` を先に置換すると `履歴・お気に入りを見る` が壊れる）。

- [ ] **Step 3: テストが失敗することを確認**

```bash
docker compose run --rm --no-deps app npm test -- --run src/features/generation/components/generation-status-panel.test.tsx src/features/history/pages/history-page.test.tsx
```

期待: FAIL。

- [ ] **Step 4: `generation-status-panel.tsx` を修正（GREEN）**

`:32`:

```tsx
    <section aria-label="今日あと何回作れるか">
```

`:36`:

```tsx
      <p>アプリ全体：{data.globalAvailable ? "作成できます" : "今日はここまで"}</p>
```

`:111`:

```tsx
          作った献立を見る
```

- [ ] **Step 5: `history-page.tsx` の見出しを修正**

`:21`、`:45`、`:56` の3箇所すべてを次に置き換える:

```tsx
      <h1>作った献立</h1>
```

3箇所は loading / empty / list の各分岐にあり、いずれも同じ見出しを描画している。すべて同じ文言に揃えること。

- [ ] **Step 6: テストが通ることを確認**

```bash
docker compose run --rm --no-deps app npm test -- --run src/features/generation src/features/history
```

期待: PASS。履歴詳細やお気に入り操作のテストにも旧見出しへの参照が無いか、この広めのスコープで確認する。

- [ ] **Step 7: 検証とコミット**

```bash
docker compose run --rm --no-deps app npm run typecheck
docker compose run --rm --no-deps app npm run lint
docker compose run --rm --no-deps app npm run format:check
git add src/features/generation src/features/history
git commit -m "$(cat <<'EOF'
fix: 利用状況と履歴の見出しを具体的な語に直す

「現在の利用状況」「履歴・お気に入り」は抽象的で中身が分からないため、
今日あと何回作れるか、何の一覧かが伝わる表現に置き換える。
EOF
)"
```

---

## 全体の最終確認

全タスク完了後に一度だけ実行する。

- [ ] **旧文言の残存が無いことを確認**

```bash
grep -rn "期限種別不明\|開封状態不明\|不明として登録\|対象家族\|年齢区分\|対象外の食事\|標準29品目\|標準候補\|表示名を確認できない\|現在の利用状況\|本日分終了\|履歴・お気に入り" src e2e
```

期待: ヒット0件。

- [ ] **安全確認まわりの文言が変わっていないことを確認**

```bash
git diff main...HEAD -- src | grep -E '^[-+].*(保証|安全|対応済み|ラベル確認|現在の家族設定)'
```

期待: ヒット0件。ヒットした場合は設計スペック221行に違反している可能性があるため、内容を確認して差し戻す。

- [ ] **全体検証**

```bash
docker compose run --rm --no-deps app npm test -- --run
docker compose run --rm --no-deps app npm run typecheck
docker compose run --rm --no-deps app npm run lint
docker compose run --rm --no-deps app npm run format:check
```

出力が大きい場合はファイルへリダイレクトし、失敗行だけを読む。

E2Eは人間に `./scripts/run-e2e.sh` の実行を依頼し、要約を受け取る。

---

### Task 1b: 機能ごとのパステル面

**Files:**
- Modify: `src/app/layouts/app-shell.tsx`
- Modify: `src/styles.css`
- Test: `src/styles.contrast.test.ts`（既存を拡張）
- Test: `src/app/layouts/app-shell.test.tsx`（新規作成）

**Interfaces:**
- Consumes: Task 1 のトークン（`--text` `--muted` `--surface` ほか）
- Produces: CSSカスタムプロパティ `--section-tint`、および `AppShell` が描画する `data-section` 属性。値は `planner` / `pantry` / `history` / `shopping` / `settings` / `other` の6種。

Task 1 の白ベースに、機能ごとの淡い色面を重ねる。カードは白のまま淡い面から浮かせ、主ボタンは濃い塗りを維持して押すべき場所を明確に保つ。

現状「どの機能の画面か」をCSSに伝える仕組みが無い。`AppShell` が `useLocation` でパスから機能を判定し、ラッパー要素の `data-section` に出す方式を採る。ルーティング定義は変更しない。

セクションとパスの対応（`src/app/router.tsx` の定義に基づく）:

| `data-section` | パス | 面の色 |
|---|---|---|
| `planner` | `/planner`, `/generation`, `/menus/:menuId` | `#fff1e6` 淡いオレンジ |
| `pantry` | `/pantry` | `#e6f4f1` 淡いミント |
| `history` | `/history`, `/history/:menuId` | `#efebfb` 淡いラベンダー |
| `shopping` | `/shopping` | `#fdf0f3` 淡いピンク |
| `settings` | `/settings` | `#f1f5f9` 淡いグレー |
| `other` | 上記以外（`/emergency-menus` など） | `#f8fafc` 既定の背景色 |

`/emergency-menus` に固有の色を与えないのは意図的。緊急献立は安全性に隣接する画面で、色による含意を持たせない。

**`--muted` の変更が必要。** 現行の `#64748b` は最も明るい面 `#fff1e6` の上で 4.30:1 となり AA（4.5:1）を割る。`#475569` に下げると全パステル面で 6.7:1 以上になる。白背景でも 7.58:1 で、`--text` `#1e293b` との視覚的な区別は保たれる。

- [ ] **Step 1: コントラストテストを拡張する（RED）**

`src/styles.contrast.test.ts` の `describe` ブロックの末尾に次を追加する。既存の6件は変更しない。

```ts
  const tints = {
    planner: "#fff1e6",
    pantry: "#e6f4f1",
    history: "#efebfb",
    shopping: "#fdf0f3",
    settings: "#f1f5f9",
  } as const;

  for (const [section, tint] of Object.entries(tints)) {
    it(`keeps body text readable on the ${section} tint`, () => {
      expect(contrast(token("text"), tint)).toBeGreaterThanOrEqual(4.5);
    });

    it(`keeps muted text readable on the ${section} tint`, () => {
      expect(contrast(token("muted"), tint)).toBeGreaterThanOrEqual(4.5);
    });

    it(`declares the ${section} tint in the stylesheet`, () => {
      expect(css).toContain(`[data-section="${section}"]`);
      expect(css.toLowerCase()).toContain(tint);
    });
  }
```

- [ ] **Step 2: テストが失敗することを確認**

```bash
docker compose run --rm --no-deps app npm test -- --run src/styles.contrast.test.ts
```

期待: FAIL。`declares the ... tint` の5件が `[data-section=...]` 未定義で落ち、`keeps muted text readable on the planner tint` が 4.30:1 で落ちる。

- [ ] **Step 3: `--muted` を下げ、面の色を定義する（GREEN）**

`src/styles.css` の `:root` 内の `--muted` を差し替える:

```css
  --muted: #475569;
```

`:root` ブロックの直後に、既定値とセクション別の面を追加する:

```css
:root {
  --section-tint: #f8fafc;
}

[data-section="planner"] {
  --section-tint: #fff1e6;
}

[data-section="pantry"] {
  --section-tint: #e6f4f1;
}

[data-section="history"] {
  --section-tint: #efebfb;
}

[data-section="shopping"] {
  --section-tint: #fdf0f3;
}

[data-section="settings"] {
  --section-tint: #f1f5f9;
}

.app-section {
  min-height: 100vh;
  background: var(--section-tint);
}
```

- [ ] **Step 4: `AppShell` のテストを書く（RED）**

`src/app/layouts/app-shell.test.tsx` を新規作成する。既存のテストがどう `AppShell` を描画しているかを `src/app/router.test.tsx` で確認し、そのプロバイダ構成（QueryClientProvider、認証、MemoryRouter 等）に合わせること。テストの骨子:

```tsx
it("marks the pantry section on the pantry route", () => {
  // /pantry を初期エントリにして AppShell を描画する
  expect(document.querySelector("[data-section]")).toHaveAttribute("data-section", "pantry");
});

it("marks nested menu routes as the planner section", () => {
  // /menus/abc を初期エントリにして AppShell を描画する
  expect(document.querySelector("[data-section]")).toHaveAttribute("data-section", "planner");
});

it("falls back to other for routes without a section", () => {
  // /emergency-menus を初期エントリにして AppShell を描画する
  expect(document.querySelector("[data-section]")).toHaveAttribute("data-section", "other");
});
```

- [ ] **Step 5: テストが失敗することを確認**

```bash
docker compose run --rm --no-deps app npm test -- --run src/app/layouts/app-shell.test.tsx
```

期待: FAIL。`data-section` 属性がまだ描画されていない。

- [ ] **Step 6: `AppShell` に `data-section` を実装する（GREEN）**

`src/app/layouts/app-shell.tsx` に `useLocation` を追加インポートし（`react-router` から。`react-router/dom` ではない）、パスから機能を判定する関数を追加する:

```tsx
/** パスから配色セクションを決める。ルーティング定義は変えずに面の色だけを切り替える。 */
function sectionForPath(pathname: string): string {
  if (pathname === "/planner" || pathname === "/generation" || pathname.startsWith("/menus/")) {
    return "planner";
  }
  if (pathname === "/pantry") return "pantry";
  if (pathname === "/history" || pathname.startsWith("/history/")) return "history";
  if (pathname === "/shopping") return "shopping";
  if (pathname === "/settings") return "settings";
  return "other";
}
```

`AppShell` の返り値のラッパー `<div>` を差し替える。既存の `<Outlet />` と `<nav>` の構造・順序は変更しない:

```tsx
  const location = useLocation();
  return (
    <div className="app-section" data-section={sectionForPath(location.pathname)}>
      <Outlet />
```

- [ ] **Step 7: テストが通ることを確認**

```bash
docker compose run --rm --no-deps app npm test -- --run src/styles.contrast.test.ts src/app/layouts/app-shell.test.tsx
```

期待: PASS（コントラスト21件、AppShell 3件）。

- [ ] **Step 8: 既存テストへの影響を確認**

`AppShell` にラッパー要素が増えたため、DOM構造に依存する既存テストが落ちる可能性がある。

```bash
docker compose run --rm --no-deps app npm test -- --run src/app
```

期待: PASS。落ちた場合は、構造を戻すのではなく、テスト側のクエリを新しい構造に追随させる。

- [ ] **Step 9: 検証とコミット**

```bash
docker compose run --rm --no-deps app npm run typecheck
docker compose run --rm --no-deps app npm run lint
docker compose run --rm --no-deps app npm run format:check
git add src/styles.css src/styles.contrast.test.ts src/app/layouts
git commit -m "$(cat <<'EOF'
feat: 機能ごとの淡い色面を敷く

献立・冷蔵庫・履歴・買い物・設定を淡い色面で区別し、白いカードを
その上に浮かせる。面はAppShellがパスから判定してdata-sectionに出す。
淡いオレンジ面の上で従来のmutedが4.5:1を割るため、mutedを一段暗くした。
EOF
)"
```
