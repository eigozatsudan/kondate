# こんだて日和 ホーム画面案内の簡易化設計

- 日付: 2026-08-17
- 状態: **敵対レビュー MF 反映済み・Plan 作成済み**（I1–I4 / I6 / I7 / M1–M3。I5 は残差）
- 実装計画: `docs/superpowers/plans/2026-08-17-pwa-install-tip-simplification.md`
- 種別: 設計。出荷済み PWA 案内の手順文を、短い見出し＋記号図にする
- 親: [PWA インストール可能アプリシェル](./2026-08-16-pwa-installable-app-shell-design.md)（出す条件・BIP・SW・dismiss の正本）
- 関連: [メール 6 桁番号ログイン](./2026-08-16-email-otp-login-design.md)（案内の短縮・図解を本スライスへ分離していた）
- レビュー: [敵対](../reviews/2026-08-17-pwa-install-tip-simplification-adversarial.md)
- 対象: `src/features/pwa/` の案内 copy / カード / 設定節、関連 Vitest、`e2e/specs/pwa-install-tip.spec.ts`
- 非対象: Service Worker、manifest、アプリアイコン、CSP、Auth ロック、ログイン画面、LP、eligibility、dismiss キー名

---

## 1. 結論

ライトユーザーが「ホームに置く」を文章の長手順で迷わないようにする。iPhone は **3 操作のまま短い見出し＋記号**。Android は **取れたら「インストールする」**。取れないときだけ同じ型の 2 行。カードと設定は同じ見た目。

| 項目 | 決定 |
| --- | --- |
| iPhone | 3 行。`共有` / `ホーム画面に追加` / `追加`。視覚番号＋小さな SVG＋見出し |
| Android 主 | `beforeinstallprompt` 保持時は手順を出さず `インストールする` だけ |
| Android 副 | BIP が無いとき 2 行。`メニュー` / `ホーム画面に追加`。同じ型 |
| 面 | カードと設定は同一の手順コンポーネント＋同一の presentation helper |
| 図 | 単純なインライン SVG。`currentColor` のみ。実機スクショ・webp は置かない |
| レイアウト | 縦の `ol`。横一列にしない。320 CSS px で横スクロールしない |
| 行 | ボタンにも heading にもしない。押すのは Safari / Chrome の本物の UI |
| 継承 | 出す条件、dismiss キー、BIP の listen / `prompt()` 1 回、in-app 一文、自動 dismiss しない |

親 Spec §8.4 の **手順文面だけ** を本文書が上書きする。§8.1–8.3（出す条件）、§8.5（BIP）、§8.7（設定の置き場）は親のまま。

---

## 2. 目的と対象外

### 2.1 目的

1. iPhone で共有ボタンと「ホーム画面に追加」がどれか、記号で分かる。
2. Android では可能なとき 1 タップの `インストールする` を主にする。
3. カードを閉じたあとも、設定で同じ短い手順が見られる。

### 2.2 対象外

- iOS に本物のインストール API を足すこと（無い）
- BIP が来るまで Android カードを隠すこと
- 見た目だけの偽ボタン（押せない「インストールする」）
- 手順を 2 枚にまとめること、今の長文を残して図だけ足すこと
- Safari / Chrome の画面を模した大きなイラスト、実機スクリーンショット
- 見出し・リード・わかりました・インストールする・other 一文の変更
- 出す path、standalone 非表示、既存ユーザーの出し分け、dismiss キー名
- `userChoice` / `appinstalled` での自動閉じ
- SW / Precache / manifest / CSP / Auth ロック 4 export
- ログイン・LP・ウェルカム・オンボーディングへの案内
- Instagram / LINE / Facebook in-app に Safari 3 手順を出すこと
- 位置語（下 / 上 / 右上）を見出しに戻すこと（§2.3）

### 2.3 受け入れ残差（直さない）

| 残差 | 扱い |
| --- | --- |
| iOS は共有シートの 3 操作が必要 | 文は短くするが操作は消さない |
| 位置語（下 / 上 / 右上）を出さない | 記号は形だけ。上下の場所は伝えない。発見失敗は残差 |
| BIP なし Android のメニューに `アプリをインストール` と出ることがある | 副経路の見出しは `ホーム画面に追加`（no-BIP の本命）。インストール可は BIP ボタンが主 |
| BIP は初回 paint より後に来ることがある | 購読済み。来るまで 2 行、来たらボタン。native infobar は `preventDefault` のまま |
| Firefox / WebView / in-app | 手順記号は出さない。親どおり generic 一文 |
| インストール後も「わかりました」までカードが残る | 親 §8.5。自動 dismiss しない |
| カードが Outlet を押し下げ、手順が 3 行でも主 CTA が沈む | overlay にしない。横並びにしないので幅は守る |
| CriOS / FxiOS | 親どおり `ios` の 3 行 |
| 実機のホーム追加・実 SW | CI 対象外。親と同じ |
| BIP あり経路は E2E 不能（DEV は SW 非登録） | 受け入れ 2 はユニット専用 |

---

## 3. 変えない契約

次は親 Spec / 現行実装のまま。再定義しない。

- `shouldShowInstallTip` の 5 条件と path 集合
- `detectInstallSurface` / `canUseIosSafariInstallSteps` / `canUseAndroidChromeInstallSteps`
- `kondate:preferences:pwa-install-tip-dismissed`（`"1"` のみ真。logout で消さない）
- カードは AppShell の Outlet 直前。モーダルにしない。フォーカスを奪わない
- 設定は空家族 / 家族ありの両方。読込中 early return には置かない
- `listenForAndroidInstallPrompt` は `createRoot` より前。描画後 BIP は `useSyncExternalStore` で拾う
- `prompt()` は同一 BIP で 1 回。失敗は swallow。held は消さず手順へ戻さない
- カード見出し `ホーム画面に置く`、設定見出し `ホーム画面に追加`（exact name で区別）
- リード `ホーム画面に置くと、次からすぐ開けます。`
- 閉じる `わかりました`（`type="button"`、`min-h-11`）
- Android ボタン `インストールする`
- other / in-app 一文 `お使いのブラウザのメニューから、「ホーム画面に追加」または「アプリをインストール」を選んでください。`
- ユーザー向けに `PWA` / `Service Worker` / `キャッシュ` と書かない
- Auth ロック 4 export を import / 再定義しない

---

## 4. 文言（本スライスが上書きする分）

`src/features/pwa/install-tip-copy.ts` の手順配列だけを次に替える。引用符付きの長文は捨てる。

```ts
export const INSTALL_TIP_IOS_STEPS = ["共有", "ホーム画面に追加", "追加"] as const;
export const INSTALL_TIP_ANDROID_STEPS = ["メニュー", "ホーム画面に追加"] as const;
```

- Android 2 行目に単独の `インストール` を置かない（ボタン `インストールする` の部分文字列になり、no-BIP の実メニューともずれる）。
- 見出し・リード・閉じる・インストールする・other 一文の定数名と値は親 §8.4 のまま。

---

## 5. UI

### 5.1 presentation helper

カードと設定は window を読まず、次の純関数の戻りだけを描く。eligibility / BIP モジュールは編集しない。

```ts
export type HomeScreenInstallPresentation =
  | { steps: "ios"; body: "none" }
  | { steps: "android"; body: "none" }
  | { steps: "none"; body: "prompt" }
  | { steps: "none"; body: "generic" };

export function resolveHomeScreenInstallPresentation(input: {
  surface: InstallSurface;
  safariStepsOk: boolean;
  androidChromeStepsOk: boolean;
  hasAndroidPrompt: boolean;
}): HomeScreenInstallPresentation
```

| 条件 | 戻り |
| --- | --- |
| ios かつ Safari 手順可 | `{ steps: "ios", body: "none" }` |
| ios かつ in-app | `{ steps: "none", body: "generic" }` |
| android かつ BIP あり | `{ steps: "none", body: "prompt" }` |
| android かつ BIP なし かつ Chrome 手順可 | `{ steps: "android", body: "none" }` |
| android かつ BIP なし かつ WebView / Firefox / in-app | `{ steps: "none", body: "generic" }` |
| other | `{ steps: "none", body: "generic" }` |

親の描画:

| `body` / `steps` | 出すもの |
| --- | --- |
| `steps !== "none"` | `<HomeScreenInstallSteps kind={steps} />` |
| `body === "prompt"` | `インストールする`（手順も generic も出さない） |
| `body === "generic"` | other 一文（手順もボタンも出さない） |
| `body === "none"` かつ steps あり | 手順だけ |

カードは `shouldShowInstallTip` が false ならこれまでどおり `null`（helper を呼ぶ前に return してよい）。設定は常に helper の戻りを描く。

`HomeScreenInstallSteps` は手順専用:

```ts
export function HomeScreenInstallSteps(props: {
  kind: "ios" | "android" | "none";
}): JSX.Element | null
```

`kind="none"` は `null`。generic / prompt は親が helper の `body` で出す。

### 5.2 手順行

- 要素は `<ol role="list">`。各 `<li>` は **視覚番号（`aria-hidden`）＋ SVG ＋ラベル**。
- Tailwind preflight / `list-style: none` を使う（番号は視覚専用 span）。`role="list"` を必ず付ける（Safari/VoiceOver がリストを落とす既知退行。`src/styles.css` の `ul.ui-stack` 注記と同じ）。
- ラベル文字列に「1.」を書かない。accessible name は §4 の語だけ（`1. 共有` にしない）。
- ラベルは `<span>` のみ。`<h2>` / `<h3>` にしない（設定見出し `ホーム画面に追加` と衝突させない）。
- 縦積み。3 枚や 2 枚を横一列にしない。
- 行は `<button>` にしない。`min-h-11` は閉じる / インストールするだけ。
- SVG は 24 CSS px、`flex-shrink: 0`、`aria-hidden="true"`、`data-icon` は §5.3。`fill` / `stroke` は `currentColor` のみ（hex / 新トークン禁止）。
- 新しい色トークンを足さない。新規 CSS セレクタを足す場合は `src/styles.contrast.test.ts` に追加する。
- **320 CSS px 契約（内容幅は page-frame + card padding で 248px）:**
  - ルートと各 `li` に `min-width: 0`
  - ラベルは折り返してよい。`white-space: nowrap` 禁止
  - `overflow-wrap: anywhere` は手順ルートに置く（設定カードにも効かせる）
  - 視覚番号は `list-style-position: outside` にしない（16px ガターへはみ出さない）
  - 子に固定幅の横クラスタを置かない

### 5.3 記号（固定）

実機 UI の模写ではない。次の形と `data-icon` に固定する。

| 面 | 見出し | `data-icon` | SVG |
| --- | --- | --- | --- |
| iOS 1 | 共有 | `ios-share` | 上辺が開いた四角＋上向き矢印 |
| iOS 2 | ホーム画面に追加 | `ios-add-home` | 四角の中にプラス |
| iOS 3 | 追加 | `ios-confirm-bar` | 角丸の水平バー 1 本。垂直線なし。**チェックマーク禁止** |
| Android 1 | メニュー | `android-menu` | 縦 3 点 |
| Android 2 | ホーム画面に追加 | `android-add-home` | 四角の中にプラス（iOS 2 と同形でよい） |

SVG は React コンポーネントとして `src/features/pwa/` に置く。`public/` に画像を足さない。

---

## 6. 部品

| ファイル | 役割 |
| --- | --- |
| `install-tip-copy.ts` | §4 の短い配列。他定数は据え置き |
| `home-screen-install-presentation.ts`（新規） | `resolveHomeScreenInstallPresentation` |
| `home-screen-install-steps.tsx`（新規） | `kind` だけ受けて §5.2 の `ol` または `null` |
| `install-step-icons.tsx`（新規） | 5 種の SVG。装飾専用 |
| `home-screen-install-card.tsx` | helper の戻りだけ描く。BIP / dismiss はそのまま |
| `home-screen-install-section.tsx` | 同上。設定見出しはそのまま |

カードと設定が手順 DOM も presentation 分岐も二重実装しない。eligibility / BIP モジュールは編集しない。

---

## 7. 失敗時

- `localStorage.setItem` throw: 親どおり同一マウントでは閉じる。リロード後はフラグ無しなら再表示。
- `prompt()` reject: 親どおり unhandledrejection にしない。ボタンは disabled。手順 2 行へ戻さない。
- BIP 未到着: Android は 2 行。到着後は 2 行を消して `インストールする`。
- SVG 欠落や未知 surface を足さない。分岐は §5.1 の表だけ。

---

## 8. テスト

部分一致で `追加` / `インストール` / `ホーム画面に追加` を取ってはいけない。

### 8.1 ユニット

| 対象 | 固定すること |
| --- | --- |
| `install-tip-copy` | §4 の exact 配列。旧長文は含まない。`PWA` 文字なし。Android[1] は `インストールする` の部分文字列にしない。見出し / リード / わかりました / インストールする / other 一文は親のまま |
| `resolveHomeScreenInstallPresentation` | §5.1 の 6 行を全部。ios Safari / ios in-app / android BIP / android Chrome 手順 / android WebView / other |
| `HomeScreenInstallSteps` | `kind="ios"` は `getAllByRole("listitem")` の **順序** と **exact accessible name** が `共有` / `ホーム画面に追加` / `追加`。name に数字を含まない。`kind="android"` は `メニュー` / `ホーム画面に追加`。`kind="none"` は `null` で `queryByRole("list")` 不在 |
| アイコン | 各 SVG が `aria-hidden` と §5.3 の `data-icon`。`ios-confirm-bar` に斜め 2 本のチェック型 path を置かない。`fill` / `stroke` は `currentColor` のみ |
| カード | presentation の 4 系統: iOS Safari = 3 listitem exact。Android BIP = `インストールする` かつ `list` 無し。描画後 BIP で list 消滅。in-app = other 一文かつ `list` 無し。わかりました 44px。旧長文は無い。否定は `queryByRole("list")` と `共有` / `メニュー`（other / ボタンに含まれない語）だけ |
| 設定 | helper と同じ。見出しは `getByRole("heading", { name: "ホーム画面に追加", exact: true })`。手順ラベルは heading ではない。desktop other = generic 一文 |
| 320 | 手順ルートが `min-w-0` と折り返し可。`whitespace-nowrap` を持たない |

既存の BIP 1 回消費・設定側 disabled・`setItem` throw のカードテストは残す。期待文字列だけ更新する。BIP 後の否定に `queryByText("インストール")` を使わない。

### 8.2 E2E

`e2e/specs/pwa-install-tip.spec.ts` のみ。BIP あり経路は書かない（受け入れ 2 はユニット専用）。

1. iPhone SE UA、続けて **viewport 320**: カード `h2`「ホーム画面に置く」。`getByRole("listitem", { name: "共有", exact: true })` ほか 3 語。`svg[aria-hidden="true"]` が 3。`document.documentElement.scrollWidth <= 320`。わかりましたでカード消。`/settings` は `getByRole("heading", { name: "ホーム画面に追加", exact: true })` と `listitem` `共有`。`getByText("ホーム画面に追加")` は使わない。
2. Android UA（BIP 無しの DEV）: カード見出し、`listitem` `メニュー` と `ホーム画面に追加`（exact）。旧「右上のメニューを開きます」は見えない。`getByText("インストール")` は使わない。

`@smoke` は付けない。実機インストールは CI 外。iPhone SE の既定 375 を 320 の代用にしない。

---

## 9. 受け入れ

1. iPhone のカードと設定で、3 つの短い見出しと記号が見える。長文 3 行は残っていない。
2. Android で BIP があるとき、手順は無く `インストールする` だけ（**ユニットで固定**。E2E 対象外）。
3. Android で BIP が無いとき、`メニュー` / `ホーム画面に追加` の 2 行がある。
4. viewport 320 で `document` が横スクロールしない。下タブは覆わない。
5. 出す条件・dismiss・ログアウト後のキー残存・SW / CSP は親のまま。
6. ユーザー向けに `PWA` と出ない。

---

## 10. 実装順（Plan 用の骨格）

1. copy の RED → 短い配列に差し替え（Android 2 行目は `ホーム画面に追加`）。
2. presentation helper の RED / GREEN（§5.1 の 6 行）。
3. SVG ＋ `HomeScreenInstallSteps` の RED / GREEN（exact listitem、`data-icon`、320 クラス）。
4. カードと設定を helper へ置換。旧長文アサートと部分一致クエリを更新。
5. E2E: exact listitem、設定は heading role、viewport 320。
6. フォーカス済み Vitest と当該 E2E。
