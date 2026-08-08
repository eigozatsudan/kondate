# Google AdSense 導入 — 見送りの判断記録

- 日付: 2026-08-09
- 状態: **見送り（実装しない）**
- 種別: 判断記録。実装指示ではない

---

## 結論

こんだて日和への Google AdSense 導入を**見送る**。

設計を一度確定させたうえで、一次・二次・敵対的の 3 レビューを通した結果、**広告が表示
される見込みが薄い一方で、アプリ全体のセキュリティ姿勢の劣化は確実に発生する**ことが
判明した。費用対効果が成立しない。

本書は棄却された設計そのものではなく、**なぜ成立しないか**の記録である。将来同じ検討が
起きたときに、ここから再開できるようにしてある。

---

## 1. 決定的な理由：広告掲出先がクローラから到達できない

AdSense は広告を出すページの内容をクローラが取得できることを前提にしている。ログイン
保護下のページに広告を出すには **crawler login** の登録が必要になる。

> "After your account has been activated, you can display Google ads on the pages of your
> site behind a login by creating a crawler login."
>
> — <https://support.google.com/adsense/answer/161351>

登録に必要なのは以下の 4 つで、**認証方式は POST / GET を前提としている**。

1. Restricted directory or URL
2. Login URL — クローラがサインインのために訪れる URL
3. Login method — POST または GET
4. Login parameters — **「サーバがログイン済みアクセス用の Cookie を返す」ような
   URL パラメータのキー・値の組**

### このアプリの認証はこの前提を満たさない（確認済み）

| 確認項目 | 実態 | 出典 |
| --- | --- | --- |
| 公開ルート | `/`（RootGatePage）、`/login`、`/auth/callback`、`*`（404）**のみ** | `src/app/router.tsx:47-53, 154-157` |
| `/history`・`/shopping` | `RequireSession`（`:56`）配下の `AppShell`（`:93`）内 | `src/app/router.tsx:118, 126` |
| `/plus`・`/privacy` | 同じく `RequireSession` 配下 | `src/app/router.tsx:83, 139` |
| セッション保存先 | **`window.localStorage`**（Cookie ではない） | `src/shared/lib/supabase.ts:16` |
| 認証フロー | `flowType: "pkce"`。ログインは JS から Supabase API への XHR | `src/shared/lib/supabase.ts:15` |
| セッション判定 | クライアント側 React コンポーネントが localStorage を読む | `src/features/auth/protected-routes.tsx` |

**帰結**: クローラが認証情報を POST できる「自サイトのログイン URL」が存在せず、
ログイン済みアクセス用の Cookie を返す経路も存在しない。crawler login の登録が
**構造的に成立しない**。

仮にクローラがログインできたとしても、`RequireSession` は JS 実行後に localStorage を
読んで初めてコンテンツを描画するため、到達はさらに困難である。

`signInWithPassword`（メール＋パスワード）自体は実装されている
（`src/features/auth/login-page.tsx:27` の `SHOW_EMAIL_LOGIN = true`）が、これも
Supabase API への XHR であり、Cookie を返す自前のログインエンドポイントではない。

**結果として起きること**: CSP も nonce も広告部品もすべて正しく実装して本番デプロイして
なお、広告枠は空白または公共広告のまま埋まらない可能性が高い。

---

## 2. 一方で、コストは確実に発生する

### 2.1 CSP の緩和はアプリ全体に及び、Plus ユーザーも等しく負担する

AdSense が公式にサポートする CSP は nonce ベースの 1 種類のみ。

> "We only support strict CSP (option 2)." / "More restrictive policies may break without
> notice."
>
> — <https://support.google.com/adsense/answer/16283098>

推奨ポリシー:

```
object-src 'none';
script-src 'nonce-{random}' 'unsafe-inline' 'unsafe-eval' 'strict-dynamic' https: http:;
base-uri 'none';
report-uri …
```

現在の `script-src 'self'` / `style-src 'self'` / `default-src 'self'` から、
`'unsafe-inline' 'unsafe-eval' https: http:` へ緩和することになる。

**CSP ヘッダは Free / Plus を区別せず全員に配信される。** 広告を見ない Plus ユーザーも、
防御が緩んだページを受け取る。見返りはゼロ。ロールバックで環境変数を消しても
**CSP は緩いまま残る**。

### 2.2 Edge Function の新設が必要になり、既存のセキュリティヘッダが消える

nonce はリクエスト毎に生成する必要があり、静的配信では実現できない。Netlify Edge
Function（このリポジトリで初の 1 本）が要る。

さらに Netlify の Custom Headers は Edge Function のレスポンスに適用されない。
`/*` に Edge Function を置くと `netlify.toml:41-53` の以下が HTML から消える。

- `Referrer-Policy: strict-origin-when-cross-origin`
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Permissions-Policy`
- **`/auth/callback` の `Referrer-Policy: no-referrer`**

最後の 1 つはコメントに「C8: OAuth/magic の初回 URL に code が載る。callback からの
Referer 中継を抑える」と明記されたセキュリティ対策であり、CSP では代替できない。

### 2.3 既存ガードが 2 本落ちる

| ファイル | 内容 |
| --- | --- |
| `scripts/csp-headers.test.mjs:74-78` | `assert.doesNotMatch(csp, /unsafe-inline/u)` |
| `tests/tooling/project-config.test.mjs:346-351` | `CSP_STATIC_DIRECTIVES` の文字列一致 ＋ `unsafe-inline` 不在 |

どちらも AdSense 導入で確実に赤になる。既存アサーションの書き換えが必要になり、
このリポジトリでは停止・相談事由にあたる。

### 2.4 開示義務が発生する

現在の開示文（`src/features/privacy/privacy-copy.ts`、全 77 行）には Cookie・広告・
第三者送信の記述が**一つもない**。AdSense を入れると改正電気通信事業法の外部送信規律の
対象になり、送信先・目的・オプトアウト経路の開示が必要になる。

---

## 3. 検討したが成立しなかった実装案

### 3.1 広告を iframe に隔離してアプリ本体の CSP を守る案 → ポリシー違反

> "Is it violating program policy if I place ads on iframe pages in my site or app?
> **Yes, it does violate our policies.** Firstly, you're not allowed to place ads in a frame
> within another page."
>
> — <https://support.google.com/adsense/answer/3394713>

引用元ページに例外規定の記載はない。

### 3.2 広告ページだけ CSP を緩める案 → SPA では成立しない

`netlify.toml:34-37` が `/*` → `/index.html` の SPA fallback を持つ。CSP はドキュメント
読み込み時に確定し、クライアント側のルート遷移では再適用されない。

- 厳しい CSP のページに着地して遷移 → 広告はブロックされたまま
- 緩い CSP のページに着地して遷移 → 緩い CSP がアプリ全体に残る

防御としても機能としても成立しない。

### 3.3 ドメイン許可リストで最小限だけ緩める案 → Google が非サポート

配信ドメインが随時変わるため、Google は許可リスト方式をサポートしない。採用すると
ある日予告なく広告が出なくなる。しかもその日が来るまでテストは緑なので、事前に
検出できない。

---

## 4. 将来 AdSense を再検討する場合の前提条件

以下が**すべて**満たされない限り、この判断は変わらない。

1. **未ログインで閲覧できるコンテンツ面が存在すること。** 現状の公開ルートは
   `/`・`/login`・`/auth/callback`・404 のみで、いずれも広告を載せる内容がない。
   レシピ閲覧のような公開面を新設する場合、それは「現在の機能のまま」という前提を
   超える別プロジェクトになる。
2. アプリ全体の CSP 緩和を、Plus ユーザーへの影響を含めて許容できること。
3. Edge Function 導入に伴う既存セキュリティヘッダの喪失に対処できること
   （特に `/auth/callback` の `no-referrer`）。
4. 広告収益が上記のコストを上回る見込みが立つこと。

**1 が最も重い。** ログイン必須の私的な献立ツールという製品の性質そのものが、
ディスプレイ広告と噛み合っていない。

---

## 5. この判断に至った経緯

1. 対話で製品仕様を確定（Free のみ／`/history` と `/shopping`／日本向け開示のみ／
   UI モダン化 Phase 0〜4 完了後）
2. 設計書を作成しコミット（`987f1c8`）
3. 一次レビュー・二次検証・敵対的レビューを独立したクリーンコンテキストで実施
4. 敵対的レビューが「掲出先 2 画面が認証ゲート内にありクローラが到達できない」ことを
   指摘。設計書の §10（未解決事項）にも挙がっていなかった
5. Google の crawler login 要件とこのアプリの認証実装を照合し、構造的に成立しないことを
   確認
6. 見送りを決定

初版設計書には他にも、`_headers` の適用範囲の誤認、Edge Function と Custom Headers の
相互作用の見落とし、`'strict-dynamic'` に関する論証の飛躍、既存ガード 2 本の見落としが
あった。いずれも本書では修正済みまたは §2 に事実として記載してある。
