# 無料 LP を最初の HTML で読ませる設計

- 日付: 2026-08-16
- 状態: **対話でセクション承認済み。Plan 未作成**
- 種別: 設計。実装指示は後続 Plan
- 対象: `index.html`、新規 `app.html`、`src/features/landing/`、`src/styles.css`、`public/lp-boot.js`、`public/robots.txt`、`vite.config.ts`、`netlify.toml`、`scripts/csp-headers.mjs` / `scripts/emit-deploy-headers.mjs`、`scripts/generate-service-worker.mjs`、関連テスト
- 非対象: `admin/`、Netlify Functions、Supabase、contracts、safety 評価パイプライン、公開レシピ面、Plus LP の公開化
- 前提: [無料ユーザー収益化判断](./2026-08-09-free-tier-monetization-decision.md) の「広告目的の公開 SEO 面は新設しない」は維持する。本書は既存の未ログイン `/` を検索エンジンが読めるようにするだけである。
- 関連: [LP モダン化](./2026-08-09-lp-modernization-design.md)、[PWA シェル](./2026-08-16-pwa-installable-app-shell-design.md)

---

## 1. 結論

未ログインの `/` について、**最初の HTML バイトに無料 LP の本文を載せる**。JavaScript が動く利用者にはその静的 LP を見せない。`/login` など他パスには今と同じ薄いシェルを返す。

| 項目 | 決定 |
| --- | --- |
| 目的 | 検索エンジンが JS なしでも無料 LP を読める |
| 見せ方 | JS ありでは静的 LP を描画前に隠す。ログイン済みは今どおり確認中 → アプリ |
| 配信 | `index.html` が `/`、`app.html` がそれ以外 |
| 文言 | 現行 `FREE_LP_*` が唯一の正本。手書きの二重管理はしない |
| 文言変更 | **しない**（モダン化設計と同じ） |
| ルート行為 | `RootGate` / `RequireSession` / 認証ロック export は変えない |
| CSP | `script-src 'self'` / `style-src 'self'` のまま。インライン禁止 |
| 本番オリジン | ブラウザ向け env に増やさない。絶対 `og:url` / sitemap は置かない |
| 公開コンテンツ面 | 作らない |

---

## 2. 目的と対象外

### 2.1 目的

1. `GET /` の最初の HTML に、現行無料 LP と同じ見出し・リード・手順・3機能・閉じ・CTA がプレーンテキストとして含まれる。
2. JS が動く利用者は静的 LP を見ない。未ログインなら React の `FreeLandingPage`、ログイン済みなら現行の確認中 → `RootEntry`。
3. `/login`・`/auth/callback`・未知 URL・保護ルート用の最初の HTML に LP 本文を載せない。
4. 本番 CSP と PWA シェル（`/` 1 枚、`/index.html` を Precache しない）を壊さない。

### 2.2 対象外

- 公開レシピ一覧、ブログ、緊急プールの検索公開、Plus LP の未ログイン公開
- `RootGate` の振り分け変更、`/` とアプリの URL 分離
- SSR / Edge / User-Agent による HTML 差し替え
- `og:url`、`og:image`、絶対 URL の sitemap、Search Console 運用
- `document.title` のルート別更新
- 広告スクリプト、CSP 緩和、`unsafe-inline`
- Auth ロック export の再定義
- ローカル Vite で Netlify と同じ二文書を技術的に強制すること
- 実 Googlebot / 本番クロールの検証

### 2.3 対話で確定した決定

| 論点 | 決定 |
| --- | --- |
| 狙い | B。無料 LP を検索エンジンに読ませる。公開コンテンツ事業ではない |
| JS 利用者 | 静的 LP を見せない |
| 配信 | `/` だけ LP 入り。他は薄いシェル |
| 実装形 | Vite 二文書 + 同じ文言から静的 HTML を生成 |
| メタ | description / OGP 最小 / 相対 canonical。sitemap なし |
| robots | `/` だけ許可 |

### 2.4 採用しなかった案

- `#root` に LP を入れて React が消す — ログイン済みに LP がちらつく
- クローラにだけ別 HTML — User-Agent 判定は非推奨でキャッシュ事故が起きやすい
- 全 URL 同一 HTML + robots だけ — `/login` などが同じ本文を返す
- ビルド後の文字列置換で二文書化 — 資産 URL とメタのずれを止めにくい
- Edge で `/` だけ挿入 — CSP / ヘッダ面が増え過剰

### 2.5 受け入れ残差（直さない）

| 残差 | 扱い |
| --- | --- |
| ローカル Vite の履歴フォールバックは全パスに `index.html` を出し得る | 見た目は boot + CSS で隠れる。二文書の保証は Netlify publish だけ |
| `robots.txt` の `$` を知らないクローラは `/` も拒否し得る | 対象は Google / Bing 系。第1版では変えない |
| JS なしで `/login` を開くと薄いシェルのまま | 既存 SPA の残差。対象外 |
| オフラインナビのフォールバック文書は LP 入り `/` | 現行 SW と同じ。JS が隠してルーターが動く |
| 検索順位・リッチリザルト | 保証しない。読めるようにするだけ |
| `/app.html` を直接開くと React の 404 | リンクしない。`noindex` と robots で索引しない |

---

## 3. 現状

| 現状 | ギャップ |
| --- | --- |
| `index.html` は `<title>こんだて日和</title>` と空の `#root` | LP 本文・description・canonical が無い |
| `createRoot` が `#root` を空にしてから描く | 最初の HTML に React LP は無い |
| `/` は `RootGate`。未ログインは lazy な無料 LP | クローラはセッション確認待ちまたは空シェルを見得る |
| `netlify.toml` の `/*` → `/index.html` 200 | 全パスが同じシェルを返す |
| `robots.txt` / sitemap / OGP なし | 索引方針が無い |
| CSP は `script-src 'self'` / `style-src 'self'` | インラインで隠すことはできない |
| SW は `/` をシェルとし、中身は `dist/index.html` のバイト | `/index.html` という URL は Precache しない（Pretty URL の 301 回避） |
| 保護ルート・緊急献立・共有レシピは認証必須 | 公開本文に使えない。使わない |

---

## 4. 配信

Vite の入力を 2 枚にする。どちらも `src/main.tsx` を読む。

| ファイル | 公開 URL | 中身 |
| --- | --- | --- |
| `index.html` | `/` | 現行ヘッド（manifest / アイコン / theme-color / referrer）+ §6 のメタ + `lp-boot.js` + `#kondate-public-lp` + `#root` + `main.tsx` |
| `app.html` | ファイルが無いパスへの 200 フォールバック | 現行と同じ薄いシェル。`#kondate-public-lp` も LP メタも `lp-boot.js` も無い |

Netlify は実在ファイルをリライトより先に返す（shadowing）。

1. `/` → publish 直下の `index.html`（ディレクトリ索引。`/` を `/index.html` へリライトしない）
2. `/assets/*`、`/sw.js`、`/robots.txt`、`/lp-boot.js`、`/manifest.webmanifest`、`/icons/*` → 実在ファイル
3. `/api/emergency-menus` → 現行どおり Function
4. その他 → `/*` を `/app.html` へ **200**。**`force` は付けない**

`force` を付けると `/` まで `app.html` になり、公開本文が消える。禁止。

`/app.html` を直接開いた場合はファイルが実在するのでそのまま返り、React Router の path は `/app.html` で 404 になる。製品リンクは張らない。

ローカル Vite は単一入口の履歴フォールバックのままにしてよい。E2E の正は「JS で動くアプリ」であり、Netlify と同じ二文書ではない。

---

## 5. 構成要素

各単位は一つだけの責務を持ち、定数と HTML 文字列と隠匿を混ぜない。

| 単位 | 責務 | 使い方 | 依存 |
| --- | --- | --- | --- |
| `src/features/landing/free-landing-copy.ts` | `FREE_LP_*` 文言の正本 | React LP と静的 HTML 生成の両方が import する | なし（文字列と配列だけ） |
| `src/features/landing/build-public-landing-html.ts` | 静的 LP の HTML 文字列を返す純関数 | Vite が `index.html` の `#kondate-public-lp` を埋める。テストが本文を照合する | copy モジュール。画像 URL は引数 |
| `FreeLandingPage` | JS 利用者向けの現行 LP | `RootGate` から lazy 表示。文言は copy モジュール。見た目クラスは変えない | copy、既存 CSS、React Router `Link` |
| `public/lp-boot.js` | `document.documentElement.classList.add("kondate-js")` | `index.html` の `<head>` で同期読み込み | DOM だけ。失敗しても throw しない |
| `src/styles.css` の隠匿規則 | `html.kondate-js #kondate-public-lp { display: none; }` | 両 HTML が読むエントリ CSS。遅延 chunk に置かない | なし |
| Vite プラグイン（`vite.config.ts` 内） | `index.html` にだけ静的 LP を挿入する | `app.html` は触らない。挿入失敗はビルド失敗 | builder と画像のソース path |
| `scripts/generate-service-worker.mjs` | Precache に `/lp-boot.js` を足す | `/` の中身は引き続き `dist/index.html` のバイト | 既存 CACHE_NAME 計算 |
| `scripts/csp-headers.mjs` | `/app.html` に `X-Robots-Tag: noindex` | `/*` には noindex を付けない | 既存 `_headers` emit |
| `public/robots.txt` | `/` だけ索引許可 | 静的コピー | なし |

`RootGatePage` / `AuthProvider` / `createRoot` のマウント先（`#root`）は変えない。静的 LP は `#root` の外（先に置く）である。

---

## 6. 静的 LP とメタ

### 6.1 本文

`buildPublicLandingHtml` は次をこの順で出す。現行 `FreeLandingPage` と同じ構造・同じクラス名・同じ禁止語制約。

1. ブランド（見出しにしない）
2. 単一の `h1` = `FREE_LP_H1`
3. リード / 補足
4. CTA 2 本。静的側は `<a href="/login">`（React 側は今どおり `Link`）
5. ヒーロー画像（`alt=""`、幅 1280、高さ 720）
6. 「はじめての使い方」
7. 「無料でできること」3 項目（各画像 `alt=""`、幅 640、高さ 640）
8. 閉じ + CTA 再掲

文言・属性を HTML に入れるときは `&` `"` `<` `>` をエスケープする。定数でも手連結の生挿入はしない。

画像 src はソース path を渡す。

- `/src/features/landing/assets/free-hero.webp`
- `/src/features/landing/assets/free-benefit-family.webp`
- `/src/features/landing/assets/free-benefit-menu.webp`
- `/src/features/landing/assets/free-benefit-pantry.webp`

Vite の HTML パイプラインがハッシュ付き URL に書き換える。React の `import` と同じ 4 ファイルを指す。

ソース `index.html` には空の `<div id="kondate-public-lp"></div>` を `#root` の前に置く。プラグインが中身を埋める。ビルド後に中身が空、または `FREE_LP_H1` が無ければ失敗する。

静的 HTML には `hidden`、`aria-hidden`、インライン `style`、`display:none` を書かない。

### 6.2 `/` にだけ足すメタ

`index.html` のみ。

- `<meta name="description" content="{FREE_LP_LEAD}">`
- `<meta property="og:title" content="{FREE_LP_BRAND}">`
- `<meta property="og:description" content="{FREE_LP_LEAD}">`
- `<meta property="og:locale" content="ja_JP">`
- `<meta name="twitter:card" content="summary">`
- `<link rel="canonical" href="/">`

`og:url` / `og:image` / sitemap は置かない（絶対 origin が要るため）。

`app.html` に description・OGP・canonical・静的 LP を付けない。

### 6.3 robots

`public/robots.txt` の全文は次だけとする。

```
User-agent: *
Allow: /$
Disallow: /
```

`$` は「`/` そのものだけ許可」。`/assets/` も拒否してよい。本文は最初の HTML に揃っている。

`/app.html` は `_headers` で次を付ける。

```
/app.html
  X-Robots-Tag: noindex
```

既存の `/sw.js` MIME、`/manifest.webmanifest` MIME、`/*` の CSP は維持する。

---

## 7. 隠匿と描画順

`index.html` の `<head>` で `/lp-boot.js` をモジュールではない同期 `<script src="/lp-boot.js">` として読む。本文は次のとおり。

```js
document.documentElement.classList.add("kondate-js");
```

`#kondate-public-lp` の有無は見ない（head 実行時点ではまだ無い）。

CSS は `src/styles.css` に置く。`free-landing-page.css` にだけ置くと遅延 chunk 待ちでチラつく。

```css
html.kondate-js #kondate-public-lp {
  display: none;
}
```

想定順（`/`・JS あり）:

1. `lp-boot.js` が `kondate-js` を付ける
2. エントリ CSS が静的 LP を非表示にする
3. 本体がパースされる（利用者は LP を見ない）
4. `createRoot(#root)` が走る。静的 LP は `#root` の外なので残るが非表示
5. `RootGate` が現行どおりセッションを解決する

JS なしではクラスが付かない。静的 LP が見え、`main.tsx` は動かない。CTA は通常の `/login` リンクである。

---

## 8. Service Worker

既存契約を維持する。

- シェル URL は `/`
- Precache に `/index.html` を入れない
- `/` の中身は `dist/index.html` のバイト（LP 入りになる）。`CACHE_NAME` は既存どおりそのバイトをハッシュする
- `FIXED_PRECACHE_URLS` に `/lp-boot.js` を追加する
- `/app.html` は Precache しない
- シェル URL は `/` のまま。PWA 設計が書いていた `/* → /index.html` は、本書では `/* → /app.html` に置き換わる。キャッシュする文書は `/`（`index.html` のバイト）であり、フォールバック先ファイル名だけが変わる
- navigate は今どおり network-then-shell。オフライン時はキャッシュした `/` を返す

`lp-boot.js` を入れないままだと、オフラインで起動スクリプトだけ欠け、JS 利用者に静的 LP が見える。

---

## 9. 壊れ方

| 失敗 | 扱い |
| --- | --- |
| 静的 LP の生成または `index.html` への挿入失敗 | ビルド失敗。空の `#kondate-public-lp` を出荷しない |
| `app.html` が dist に無い | ビルド失敗。リライトだけ先行させない |
| `lp-boot.js` 欠落 | ビルドまたは SW 生成が失敗（precache ファイル必須） |
| `/*` に `force` がある | テストで落とす。手動でも付けない |
| CSP に `unsafe-inline` が入る | 既存 tooling テストが落とす。入れない |
| copy と React と静的 HTML の本文不一致 | 単体テストが落とす |

中途半端な「シェルだけ二文書」「メタだけ付いた空 LP」は成功にしない。

---

## 10. テスト

実装前に RED で固定する。

### 10.1 静的 HTML と React の一致

- `buildPublicLandingHtml` の出力に `FREE_LP_H1`、`FREE_LP_LEAD`、手順、3機能、閉じ、`href="/login"` がある
- 禁止語（現行 LP テストの `Plus` / `plus` / `安全` / `絶対` / `保証` / `無制限` / `何回でも`）が無い
- `FreeLandingPage` の可視テキストと、静的 HTML からタグを除いたテキストが同じ
- 画像 4 枚の `alt=""` と幅・高さが React 版と同じ

### 10.2 二文書と配信

- ビルド成果物または同等の emit フィクスチャで、`index.html` に `#kondate-public-lp`、description、相対 canonical がある
- 同 `app.html` に LP 本文も description も無い
- `netlify.toml` の `/*` が `/app.html` へ 200 で、`force` が無い
- `robots.txt` が §6.3 の全文と一致する
- emit した `_headers` に `/app.html` の `X-Robots-Tag: noindex` がある

### 10.3 隠匿と SW

- `lp-boot.js` が `html` に `kondate-js` を付ける
- `src/styles.css` に `html.kondate-js #kondate-public-lp` の `display: none` がある
- Precache に `/` と `/lp-boot.js` があり、`/app.html` と `/index.html` が無い
- `/` の中身は `dist/index.html` のバイト、という既存テストを維持する

### 10.4 回帰

- `RootGate` / 無料 LP / ログインの既存テストの行為は変えない
- E2E は JS ありで現行どおり LP 見出しが見え、ログインへ進める。静的ノード `#kondate-public-lp` は JS ありでは `not.toBeVisible`
- 触った範囲の `format:check` / lint / typecheck / 焦点テストは Docker の `app` で通す

### 10.5 やらない検証

実 Googlebot、Search Console、本番 origin の絶対 sitemap、リポジトリ全スイートの勝手な実行。

---

## 11. 実装順（Plan 用の骨格）

1. copy モジュール切り出しと、builder + 一致テスト（RED → GREEN）
2. `lp-boot.js`、CSS 隠匿、boot テスト
3. `app.html` + Vite 二入力 + `index.html` への挿入（失敗でビルドを落とす）
4. `netlify.toml` リライト、`robots.txt`、`_headers` の noindex
5. SW precache に `/lp-boot.js`
6. 既存 LP / RootGate / SW / tooling / 焦点 E2E の更新と検証

認証・課金・安全ゲート・公開レシピは触らない。
