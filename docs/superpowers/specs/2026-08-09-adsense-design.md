# Google AdSense 導入 設計書

- 日付: 2026-08-09
- 状態: 設計確定（実装未着手）
- 前提: `docs/superpowers/plans/2026-08-08-ui-modernization/` の Phase 0〜4 が**すべて完了した後**に着手する

---

## 1. 目的と非目的

### 目的

Free ユーザー向けに Google AdSense の広告を表示し、収益源を追加する。同時に「広告が消える」ことを
こんだて日和 Plus の訴求点として機能させる。

### 非目的（やらないこと）

- 管理画面からの広告設定（パブリッシャー ID / スロット ID の UI 入力、掲出位置の切り替え）。
  ID はビルド時の環境変数で持つ。
- EEA / 英国 / スイス向けの同意管理（Google 認定 CMP）。日本国内向けの開示のみ行う。
- AdSense 以外の広告ネットワーク、アフィリエイト、自社運用枠。
- 広告収益の計測ダッシュボード。AdSense の管理画面を使う。
- 既存機能の変更。広告は既存画面に**追加**されるだけで、既存の導線・操作を変えない。

---

## 2. 調査で確定した制約

設計判断の根拠。**ここを読まずに実装方針を変えないこと。**

### 2.1 iframe への広告設置はポリシー違反（確定）

当初「広告だけを別ドキュメント（`/ads/slot.html`）に隔離し、アプリ本体の CSP を維持する」案を
検討したが、Google の AdSense ポリシー FAQ が明示的に禁じている。

> "Is it violating program policy if I place ads on iframe pages in my site or app? **Yes, it does
> violate our policies.** Firstly, you're not allowed to place ads in a frame within another page."
>
> — <https://support.google.com/adsense/answer/3394713>

例外は Google の個別承認が必要。**この案は棄却した。**

### 2.2 パス単位の CSP 緩和は SPA では成立しない（確定）

`netlify.toml:34-37` が `/*` → `/index.html` の SPA fallback を持つ。CSP はドキュメント読み込み時に
確定し、クライアント側のルート遷移では再適用されない。

- `/` に着地（厳しい CSP）→ `/history` へ画面遷移 → 広告はブロックされたまま
- `/history` に直接着地（緩い CSP）→ `/settings` へ遷移 → 緩い CSP がアプリ全体に残る

防御としても機能としても成立しない。**この案も棄却した。**

### 2.3 AdSense が公式サポートする CSP は nonce ベースのみ（確定）

> "We only support strict CSP (option 2)." / "More restrictive policies may break without notice."
>
> — <https://support.google.com/adsense/answer/16283098>

推奨ポリシー:

```
object-src 'none';
script-src 'nonce-{random}' 'unsafe-inline' 'unsafe-eval' 'strict-dynamic' https: http:;
base-uri 'none';
report-uri …
```

配信ドメインが随時変わるため、**ドメイン許可リスト方式は非サポート**（採用すると予告なく広告配信が
停止し得る）。`style-src` / `img-src` / `frame-src` / `connect-src` は文書化されていないが、現行の
`default-src 'self'` 配下では広告 iframe・画像・ビーコンがすべて落ちるため、いずれも緩和が要る。

**帰結: CSP 緩和はアプリ全体に及ぶ。緩和範囲は最小化できない。**

### 2.4 `'strict-dynamic'` が与える設計上の利点

`'strict-dynamic'` は「nonce 付きスクリプトが動的に生成したスクリプト」を自動的に信頼する。
アプリのバンドルが nonce 付きで動いていれば、そこから `document.createElement("script")` で読み込む
AdSense ローダーに nonce を渡す必要がない。

**帰結: AdSense のローダーを `index.html` に静的に置く必要がない。広告を出さない Plus ユーザーの
ブラウザには Google のスクリプトを一切ロードしない構成にできる。** §4.3 でこれを要件化する。

---

## 3. 確定した製品仕様

| 項目 | 決定 |
| --- | --- |
| 表示対象 | **Free ユーザーのみ。** Plus は広告なし |
| 掲出画面 | **`/history`（履歴一覧）** と **`/shopping`（買い物リスト）** の 2 画面のみ |
| 掲出位置 | いずれもリストの**末尾に 1 枠**。項目の間には挟まない |
| 同意管理 | 日本向けの開示のみ。CMP は導入しない |
| 設定 UI | なし。ID はビルド時の環境変数 |
| 実施順序 | UI モダン化 Phase 0〜4 の**完了後** |

### 3.1 掲出位置をこの 2 画面に限った理由

- **`/generation`（生成待ち）には置かない。** UI モダン化 Phase 2 が「待ち時間体験の改善」を目的と
  しており、真っ向から衝突する。待たされている最中の広告は体験を最も損なう。
- **`/pantry` には置かない。** 食材の登録・編集が主の作業画面で操作密度が高い。
- `/shopping` は店頭でのチェック操作が密で誤クリックリスクが高いことを設計時に指摘したうえで、
  掲出対象として採用した。**リスト項目の間に挟まないこと**でリスクを抑える（§4.4）。

### 3.2 実施順序の理由

`/history` は UI モダン化 **Phase 3 の改修対象**。同じファイルを 2 つの計画が同時に触ると、
Phase 3 側の検証が破綻する。`/shopping` はどの Phase の対象でもないが、トラックを 2 本に
分けない判断として、全 Phase 完了後にまとめて着手する。

---

## 4. アーキテクチャ

### 4.1 全体像

```
リクエスト
  ↓
netlify/edge-functions/csp-nonce.ts   ← 新設。nonce 生成・HTML 置換・CSP ヘッダ上書き
  ↓
dist/index.html（nonce 埋め込み済み）
  ↓
アプリバンドル（nonce 付きで実行）
  ↓
AdSlot が mount（Free かつ env 設定済みかつリストが非空のときだけ）
  ↓
ad-client が AdSense ローダーを動的 import（'strict-dynamic' により nonce 不要）
```

### 4.2 nonce 配信層（新設 Netlify Edge Function）

このリポジトリに Edge Function は現存しない（`netlify/` 配下は `functions` のみ）。**これが初の 1 本**
になる。

**`netlify/edge-functions/csp-nonce.ts`**

1. リクエスト毎に暗号論的乱数から nonce を生成する
2. `context.next()` で静的レスポンスを取得する
3. `content-type` が `text/html` の場合**のみ**、本文中のプレースホルダ `__CSP_NONCE__` を実 nonce に
   置換する。HTML 以外は本文に触れず素通しする
4. CSP ヘッダを**上書き**して返す

**必須要件: CSP ヘッダは追加ではなく置換する。** 同名の CSP ヘッダが 2 つ存在すると両方の制約が
積算され、必ず壊れる。

**HTML 側の nonce プレースホルダ**は Vite の `html.cspNonce` 設定で埋め込む。`index.html` の
`<script type="module">` は Vite がビルド時に生成するため、手書きの nonce 属性では追随できない。

**`_headers` との関係**: `scripts/emit-deploy-headers.mjs` が生成する `dist/_headers` の CSP は
HTML 以外のレスポンスに対して引き続き有効。HTML ドキュメントの CSP は Edge Function を単一の
正本とする。

### 4.3 広告部品 `src/features/ads/`（ブラウザ専用）

| ファイル | 責務 |
| --- | --- |
| `use-ads-enabled.ts` | `useEntitlement` を見て Free のみ `true`。**判定確定前は `false`** |
| `ad-slot.tsx` | 枠の描画。`placement` を受け取り列挙済み固定クラスへマップ |
| `ad-client.ts` | AdSense ローダーの遅延読み込み（プロセスで 1 回だけ）と `adsbygoogle.push` |
| `ads-config.ts` | `VITE_ADSENSE_CLIENT_ID` / スロット ID の読み取りと検証 |

**`AdSlot` が描画されない条件（いずれか 1 つでも該当すれば `null` を返す）**

1. `useAdsEnabled()` が `false`（Plus、または entitlement 取得中）
2. 環境変数が未設定
3. 親から渡される「リストが空」フラグが `true`

**`ad-client.ts` の要件**

- ローダーの読み込みは **`useAdsEnabled()` が `true` の `AdSlot` が初めて mount したとき**に行う。
  モジュールの top-level で読み込んではならない（Plus ユーザーのブラウザに Google のスクリプトが
  ロードされてしまう。§2.4 の利点を捨てることになる）
- 読み込みは冪等。複数の `AdSlot` が同時に mount しても 1 回だけ
- `document.createElement("script")` で生成する。`'strict-dynamic'` により nonce は不要

### 4.4 掲出位置の具体

| 画面 | ファイル | 位置 |
| --- | --- | --- |
| 履歴一覧 | `src/features/history/pages/history-page.tsx` | 履歴カード一覧の**直後** |
| 買い物リスト | `src/features/shopping/pages/shopping-list-page.tsx` | 買い物項目一覧の**直後** |

- **リスト項目の間には挟まない。** `/shopping` はチェック操作が密で誤クリックリスクが高い。
- 広告枠と直近の操作要素の間に十分な余白を取る。UI モダン化で導入済みの `Stack` プリミティブの
  間隔トークンを使う。

---

## 5. 固定契約

実装者はここを破ってはならない。破る必要が生じたら実装を止めて人間に相談する。

### 5.1 inline style 禁止（既存契約の継承）

緩和後の CSP でも `style-src` に `'unsafe-inline'` を入れる必要が生じるが、**アプリ自身のコードは
引き続き inline style を書かない**。`AdSlot` の枠サイズは `.ad-slot--history` のような列挙済み
固定クラスで持つ。

理由: `'unsafe-inline'` は AdSense が注入する style のために必要になるだけであり、アプリ側が
inline style を書き始める許可ではない。既存の判断（`src/styles.css:721`「inline style 禁止のため
CSS へ移設」）を覆さない。

### 5.2 広告にアプリの状態を渡さない

`AdSlot` および `ad-client` は、献立・アレルギー・家族設定・ユーザー ID を含むアプリの状態を
**一切参照しない**。受け取ってよいのは `placement` と「リストが空か」のフラグのみ。

理由: CLAUDE.md の「名前・メール・アレルギー・自由記述・プロンプト・生の AI 出力を
ログ・永続化しない」制約は、第三者への送信にも及ぶ。

### 5.3 環境変数が無ければ広告は存在しない

`VITE_ADSENSE_CLIENT_ID` 未設定時、`AdSlot` は `null` を返し、ローダーも読み込まない。

理由: ローカル開発・Vitest・Playwright では広告が存在しない状態が既定になり、**既存の e2e が
無傷で通る**。この性質が検証戦略（§7）の土台になる。

### 5.4 `connect-src` の Supabase 完全一致検証を残す

`scripts/csp-headers.mjs` の `assertProductionCspMatchesSupabaseUrl()` は、本番 CSP の `connect-src` が
`'self' <supabase> <wss>` と完全一致することを要求し、ワイルドカードを拒否する。

AdSense のために `connect-src` に Google のドメインを足す必要があるが、**Supabase オリジンが
正確に 1 つだけ含まれること・`*.supabase.co` を含まないことの検証は残す。** 検証を丸ごと削除しては
ならない。`connect-src` 生成部を共有モジュールへ切り出し、Edge Function 側の CSP に対して同じ検証を
かける形に組み替える。

### 5.5 `base-uri` は `'none'` へ

現在 `'self'`。Google の推奨に合わせて `'none'` にする。これは厳格化なので既存機能への影響はない
（このアプリは `<base>` を使っていない）。

### 5.6 開示なしに広告を出さない

§6 の開示文の追加は、広告を有効化するコミットと**同じ変更群に含める**。開示が後追いになっては
ならない。

---

## 6. 開示（`privacy-copy.ts`）

現在の開示文には Cookie・広告・第三者送信の記述が**一つもない**（`src/features/privacy/privacy-copy.ts`
全 77 行を確認済み）。

`privacySections` に「広告について」を追加し、以下を含める。

- **第三者 Cookie の利用**: Google および提携先が Cookie を使い、このアプリや他サイトの閲覧に
  基づいて広告を表示すること
- **送信先と目的**: 改正電気通信事業法の外部送信規律が求める「送信される情報の内容・送信先・
  利用目的」。送信先が Google であることを明示する
- **オプトアウト経路**: Google の広告設定ページへの導線
- **Plus では広告が出ないこと**: 既存の「有料プランとお支払い」節と整合させる
- **献立・アレルギー・家族設定は広告に渡らないこと**（§5.2 の裏づけ）

`privacy-copy.ts` は `privacy-copy.test.ts` と `privacy-notice-page.test.tsx` が参照する単一ソース
なので、文言追加は必ずテスト側の期待更新とセットになる。

**実装前に確認すること**: 外部送信規律が要求する記載事項の正確な範囲と、AdSense のプライバシー
ポリシー要件の現行文言は、**一次情報を確認してから確定させる**。記憶で書かない。

---

## 7. 検証戦略

このリポジトリの最大の事故パターンは、**dev / jsdom / Playwright が全部緑で本番だけ落ちる**こと。
CSP 変更はまさにその類型なので、検証を 3 層に分ける。

### 層 1: 純関数のテスト

`scripts/csp-headers.test.mjs` を拡張する。

- 生成される CSP に `'strict-dynamic'` と nonce プレースホルダが含まれること
- `connect-src` の Supabase 完全一致検証が**維持**されていること（§5.4）
- `base-uri 'none'` であること

Edge Function の nonce 置換ロジックを純関数として切り出し、別途テストする。

- HTML でないレスポンスを本文に触れず素通しすること
- CSP ヘッダを追加ではなく**置換**すること
- プレースホルダが実 nonce に置換され、同一レスポンス内で一致していること

### 層 2: 広告部品の単体テスト

- Free のとき描画される
- Plus のとき描画されない
- **entitlement 取得中は描画されない**
- 環境変数未設定で描画されない
- リストが空のとき描画されない
- `style` 属性を一切出力しない
- ローダーが top-level で読み込まれない（Plus のみのレンダリングで `createElement("script")` が
  呼ばれないこと）

### 層 3: preview デプロイでの実地確認（本命）

層 1・2 が全部緑でも、**実際に広告が出るかは本番同等の CSP 下でしか分からない。**
Netlify の deploy-preview に AdSense の環境変数を設定し、実機で以下を確認する。

1. ブラウザコンソールに CSP 違反が出ていないこと
2. 広告が実際に描画されること
3. **Plus アカウントで `pagead2.googlesyndication.com` へのリクエストが 1 本も出ていないこと**
   （ネットワークタブで確認）
4. 320px 幅で横スクロールが発生しないこと

**この 4 項目の実機確認を完了条件に含める。層 1・2 だけで「完了」と報告してはならない。**

### 既存の検証フロー

`AGENTS.md` §8 の 9 ステップは従来どおり全通過が必要。§5.3 により既存 e2e は無傷で通るはず。
通らない場合、それは広告が意図せず有効になっている兆候なので、テストではなく実装を疑う。

---

## 8. 受け入れ基準

- [ ] Free ユーザーの `/history` と `/shopping` にそれぞれ広告が 1 枠表示される
- [ ] Plus ユーザーにはどの画面でも広告が表示されず、Google へのリクエストも発生しない
- [ ] entitlement 取得中に広告枠の分だけレイアウトがずれない
- [ ] リストが空のとき広告枠が出ない
- [ ] 環境変数未設定のビルド（ローカル・CI）で広告が存在せず、既存 e2e が全通過する
- [ ] 本番 CSP に Supabase オリジンが正確に 1 つだけ含まれ、`*.supabase.co` を含まない
- [ ] `/privacy` に広告と第三者 Cookie の開示が表示される
- [ ] 320px 幅で横スクロールが発生しない
- [ ] 広告枠と直近の操作要素の間に誤タップを避ける余白がある
- [ ] `AGENTS.md` §8 の 9 ステップが全通過する
- [ ] §7 層 3 の実地確認 4 項目が完了している

---

## 9. ロールバック

広告を止める最短経路は **Netlify の環境変数 `VITE_ADSENSE_CLIENT_ID` を削除して再デプロイ**する
こと（§5.3 により広告が存在しない状態に戻る）。コード変更を revert する必要はない。

CSP 変更まで戻す場合は、Edge Function の追加と `csp-headers.mjs` の改修をまとめて revert する。
広告部品の追加とは別コミットに分け、この単位で revert できるようにする。

---

## 10. 未解決事項（実装前に確定させること）

1. 外部送信規律および AdSense のプライバシーポリシー要件の**現行の正確な要求事項**（§6）
2. `@netlify/vite-plugin` を使ったローカル開発で Edge Function がどう振る舞うか。
   `vite.config.ts:11-38` が既に netlify dev の CSP ヘッダを剥がす回避策を持っているため、
   nonce 注入との干渉を確認する必要がある
3. AdSense の広告ユニット形式（レスポンシブ / 固定サイズ）。320px 幅での見え方から決める
