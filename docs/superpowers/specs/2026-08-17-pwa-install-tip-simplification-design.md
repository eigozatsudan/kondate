# こんだて日和 ホーム画面案内の簡易化設計

- 日付: 2026-08-17
- 状態: 設計。人間レビュー待ち
- 種別: 設計。出荷済み PWA 案内の手順文を、短い見出し＋記号図にする
- 親: [PWA インストール可能アプリシェル](./2026-08-16-pwa-installable-app-shell-design.md)（出す条件・BIP・SW・dismiss の正本）
- 関連: [メール 6 桁番号ログイン](./2026-08-16-email-otp-login-design.md)（案内の短縮・図解を本スライスへ分離していた）
- 対象: `src/features/pwa/` の案内 copy / カード / 設定節、関連 Vitest、`e2e/specs/pwa-install-tip.spec.ts`
- 非対象: Service Worker、manifest、アイコン、CSP、Auth ロック、ログイン画面、LP、eligibility、dismiss キー名

---

## 1. 結論

ライトユーザーが「ホームに置く」を文章の長手順で迷わないようにする。iPhone は **3 操作のまま短い見出し＋記号**。Android は **取れたら「インストールする」**。取れないときだけ同じ型の 2 行。カードと設定は同じ見た目。

| 項目 | 決定 |
| --- | --- |
| iPhone | 3 行。`共有` / `ホーム画面に追加` / `追加`。番号＋小さな SVG＋見出し |
| Android 主 | `beforeinstallprompt` 保持時は手順を出さず `インストールする` だけ |
| Android 副 | BIP が無いとき 2 行。`メニュー` / `インストール`。同じ型 |
| 面 | カード（`ホーム画面に置く`）と設定（`ホーム画面に追加`）で同一コンポーネント |
| 図 | 単純なインライン SVG。`currentColor`。実機スクショ・webp は置かない |
| レイアウト | 縦の `ol`。横並びカードにしない。320 CSS px で横スクロールしない |
| 行 | ボタンにしない。押すのは Safari / Chrome の本物の UI |
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

### 2.3 受け入れ残差（直さない）

| 残差 | 扱い |
| --- | --- |
| iOS は共有シートの 3 操作が必要 | 文は短くするが操作は消さない |
| BIP は初回 paint より後に来ることがある | 購読済み。来るまで 2 行、来たらボタン。native infobar は `preventDefault` のまま |
| Firefox / WebView / in-app | 手順記号は出さない。親どおり generic 一文 |
| インストール後も「わかりました」までカードが残る | 親 §8.5。自動 dismiss しない |
| カードが Outlet を押し下げ、手順が 3 行でも主 CTA が沈む | overlay にしない。横並びにしないので幅は守る |
| CriOS / FxiOS | 親どおり `ios` の 3 行 |
| 実機のホーム追加・実 SW | CI 対象外。親と同じ |

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
export const INSTALL_TIP_ANDROID_STEPS = ["メニュー", "インストール"] as const;
```

見出し・リード・閉じる・インストールする・other 一文の定数名と値は親 §8.4 のまま。

---

## 5. UI

### 5.1 手順行

カードと設定で同じ `HomeScreenInstallSteps` を使う。window / UA は読まない。親が次の 1 引数だけ渡す。

```ts
export function HomeScreenInstallSteps(props: { kind: "ios" | "android" | "none" }): JSX.Element | null
```

| `kind` | 描画 |
| --- | --- |
| `ios` | iOS 3 行 |
| `android` | Android 2 行 |
| `none` | `null`（`list` を出さない） |

親の対応:

| 条件 | `kind` | 親が同時に出すもの |
| --- | --- | --- |
| ios かつ Safari 手順可 | `ios` | なし |
| android かつ BIP なし かつ Chrome 手順可 | `android` | なし |
| android かつ BIP あり | `none` | `インストールする` |
| ios in-app / android WebView・Firefox・in-app / other | `none` | generic 一文 |

- 要素は `<ol>`。各 `<li>` は番号（リストマーカー）＋ SVG ＋見出し。
- 見出し文字列に「1.」を重ねない（読み上げが二重になる）。
- 縦積み。3 枚や 2 枚を横一列にしない。
- 行は `<button>` にしない。`min-h-11` は閉じる / インストールするだけ。
- SVG は 24–32 CSS px、`aria-hidden="true"`、`currentColor`（本文色 `#26211e`）。
- 新しい色トークンを足さない。新規 CSS セレクタを足す場合だけ `src/styles.contrast.test.ts` に追加する。Tailwind と既存 `stack` で足りるなら新規セレクタは作らない。
- 320 CSS px で `document` 幅を超えない。

### 5.2 記号（固定）

実機 UI の模写ではない。次の形に固定する。

| 面 | 見出し | SVG |
| --- | --- | --- |
| iOS 1 | 共有 | 上辺が開いた四角＋上向き矢印（iOS 共有に似せる） |
| iOS 2 | ホーム画面に追加 | 四角の中にプラス |
| iOS 3 | 追加 | 角丸の短いバー（確認ボタンの形）。**チェックマークは使わない**（完了・安全の誤読を避ける） |
| Android 1 | メニュー | 縦 3 点 |
| Android 2 | インストール | 下向き矢印つきトレイ |

SVG は React コンポーネントとして `src/features/pwa/` に置く。`public/` に画像を足さない。

---

## 6. 部品

| ファイル | 役割 |
| --- | --- |
| `install-tip-copy.ts` | §4 の短い配列。他定数は据え置き |
| `home-screen-install-steps.tsx`（新規） | `kind` だけ受けて §5 の `ol` または `null` |
| `install-step-icons.tsx`（新規） | 5 種の SVG。装飾専用 |
| `home-screen-install-card.tsx` | 手順の `ol` 重複をやめ、`HomeScreenInstallSteps` を呼ぶ。BIP / dismiss はそのまま |
| `home-screen-install-section.tsx` | 同上。設定見出しはそのまま |

カードと設定が手順 DOM を二重実装しない。eligibility / BIP モジュールは編集しない（購読の使い方は今のまま）。

---

## 7. 失敗時

- `localStorage.setItem` throw: 親どおり同一マウントでは閉じる。リロード後はフラグ無しなら再表示。
- `prompt()` reject: 親どおり unhandledrejection にしない。ボタンは disabled。手順 2 行へ戻さない。
- BIP 未到着: Android は 2 行。到着後は 2 行を消して `インストールする`。
- SVG 欠落や未知 surface を足さない。分岐は §5.1 の表だけ。

---

## 8. テスト

### 8.1 ユニット

| 対象 | 固定すること |
| --- | --- |
| `install-tip-copy` | iOS 3 語・Android 2 語が §4 の exact。旧長文は含まない。`PWA` 文字なし。見出し / リード / わかりました / インストールする / other 一文は親のまま |
| `HomeScreenInstallSteps` | `kind="ios"` で 3 項目の `listitem`（`共有` `ホーム画面に追加` `追加`）。`kind="android"` で 2 項目。`kind="none"` は `null` で `list` 無し |
| アイコン | 各 SVG が `aria-hidden`。チェックマーク path を「追加」に使わない |
| カード | iOS で短い 3 語が見える。旧「画面の下（または上）の共有ボタンをタップします」は無い。わかりました 44px。BIP あり Android はボタンのみで `メニュー` が無い。描画後 BIP で 2 行が消える |
| 設定 | 同じ短い語。見出しは `ホーム画面に追加` |
| in-app | Instagram / LINE / Facebook で 3 語も `list` も出ず、other 一文だけ |

既存の BIP 1 回消費・設定側 disabled・`setItem` throw のカードテストは残す。期待文字列だけ短い語に更新する。

### 8.2 E2E

`e2e/specs/pwa-install-tip.spec.ts` のみ。

1. iPhone SE UA: カード見出しと `共有` が見える。わかりましたでカード消。`/settings` に `ホーム画面に追加` と `共有`。
2. Android UA（BIP 無しの DEV）: カード見出しと `メニュー` が見える。旧「右上のメニューを開きます」は見えない。

`@smoke` は付けない。実機インストールは CI 外。

---

## 9. 受け入れ

1. iPhone のカードと設定で、3 つの短い見出しと記号が見える。長文 3 行は残っていない。
2. Android で BIP があるとき、手順は無く `インストールする` だけ。
3. Android で BIP が無いとき、`メニュー` / `インストール` の 2 行がある。
4. 320 CSS px で横スクロールしない。下タブは覆わない。
5. 出す条件・dismiss・ログアウト後のキー残存・SW / CSP は親のまま。
6. ユーザー向けに `PWA` と出ない。

---

## 10. 実装順（Plan 用の骨格）

1. copy の RED → 短い配列に差し替え。
2. SVG ＋ `HomeScreenInstallSteps` の RED / GREEN。
3. カードと設定を共有部品へ置換。旧長文アサートを更新。
4. E2E の Android 文字列を `メニュー` に更新。
5. フォーカス済み Vitest と当該 E2E。
