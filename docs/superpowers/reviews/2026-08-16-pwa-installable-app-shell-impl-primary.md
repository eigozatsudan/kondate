# 1次レビュー: PWA 実装
**対象:** feat/pwa-installable-app-shell `560f07c4..048c4c88`
**照合:** Spec + Plan
**Verdict:** REVISE

## Summary

許可リスト型シェルと案内 UI の骨格は Spec / Plan に高い忠実度で載っている。検出・資格・dismiss キー、固定日本語 copy、AppShell カードと設定の両分岐マウント、manifest / アイコン / MIME、`/` シェル、フォント非 Precache、API / callback の passthrough、自 `CACHE_NAME` のみ、`skipWaiting` / `clients.claim` / 実行時 `cache.put` / グローバル `caches.match` なし、CSP 非緩和、Auth ロック非再定義、案内キーを `isOwnedBrowserStorageKey` に足さない、E2E 既定 dismiss の addInitScript 入口、BIP の `createRoot` 前 listen、はいずれも実装と一致する。

差し戻し理由は 2 点だけ。Android 主経路の「インストールする」が、`preventDefault` 済みの BIP を描画後に拾えず出ないこと（§8.4 / §8.5）。受け入れ 9 / Plan Task 5 が要求した `heading.first()` の名前否定が無いこと。どちらも漏洩・認可バイパス・ユーザーデータ Cache 混入ではない。

`.superpowers/sdd/task-*-review.md` は未検証主張として扱い、ソースと diff で再照合した。全件テストは再実行していない。

## Verdict (counts)

| 区分 | 件数 |
| --- | ---: |
| Critical | 0 |
| Important | 2 |
| Minor | 4 |

**REVISE** — I1 / I2 を直すまで完了としない。

## Findings

### Critical

なし。Cache Storage に API / 認可 code / ユーザーデータを載せる経路、CSP 緩和、`skipWaiting` / `clients.claim`、owned 掃除による dismiss 消滅、`@shared/safety` のブラウザ import は見当たらない。

### Important

#### I1 — Android BIP を保持しても「インストールする」が出ない
- **id:** I1
- **file:line:** `src/features/pwa/android-install-prompt.ts:15-35` / `src/features/pwa/home-screen-install-card.tsx:59-97` / `src/features/pwa/home-screen-install-section.tsx:24-58`
- **what's wrong:** `listenForAndroidInstallPrompt` は `createRoot` より前で `preventDefault` してモジュール変数へ置く（listen タイミング自体は §8.5 / Plan どおり）。カードと設定は `peekAndroidInstallPrompt()` を **そのレンダーの一回読み** するだけで、`held` 更新を購読しない。`useAndroidInstallPrompt` も peek の薄いラップで、どちらからも呼ばれていない。ユニットは `injectAndroidInstallPromptForTests` を **render 前** に置くので、描画後到着は見ない。
- **why it matters:** 本番では SW 登録（`registerServiceWorker` は fire-and-forget）と `addAll` が終わったあとで BIP が飛ぶ。初回訪問ではカードはすでに Android 手順リストを描いている。その後イベントが来ても再描画しない。`preventDefault` 済みなので Chrome の既定インストール UI は抑えられ、Spec §8.4 / §8.5 の主経路「インストールする」（手順リストなし）は出ない。手順文面からのメニュー操作は残るが、BIP を取る理由が空振りする。Plan が peek を「ボタン正本」にしたのは API 形であり、遅延到着を無視せよとは書いていない（plan-mandated ではない）。
- **how to fix:** `held` の変化を `useSyncExternalStore`（または listen 内の購読者）でカード / 設定に伝える。BIP 到着後はボタンを出し、手順リストを消す。テストは listen → render（手順が見える）→ `dispatchEvent` → 「インストールする」が出て手順が消える、を 1 本足す。`userChoice` / `appinstalled` での自動 dismiss は今どおりしない。

#### I2 — `heading.first()` がカード `h2` でないことの固定が無い
- **id:** I2
- **file:line:** `e2e/specs/mobile-accessibility.spec.ts:256` / Plan Task 5 Step 2
- **what's wrong:** 既存 assert は `getByRole("heading").first()` が visible なことだけ。Plan Task 5 は「名前が『ホーム画面に置く』ではない」まで落とすか、ユニット相当で固定すると書いた。実装 diff にその否定も、同等のユニットも無い。`completedOnboardingPage` 経由の addInitScript は正しく見えるので、**今の既定 dismiss が効いていれば** このテストは history 見出しで GREEN になる。効かなくなってもカード `h2` が first として visible のため **false-green** のまま通る。
- **why it matters:** Spec 受け入れ 9 と §9.2 は、既存 E2E の `heading.first()` がカードに侵されないことを受け入れ条件にしている。fixture 側の dismiss 実装は §9.2 の入口（`loginAsNewUser` の context seed、`auth.setup` の最初の goto 前、`session-auth` の `newContext` 直後、`auth-recovery` / `oauth-mock`）を概ね閉じている。それでも Task 5 が要求した観測点は「dismiss がある」ではなく「first heading がカードではない」。ここを固定しないと dismiss 回帰が heading 契約を静かに壊す。
- **how to fix:** 当該テストに `await expect(page.getByRole("heading").first()).not.toHaveAccessibleName("ホーム画面に置く")` を足す。または AppShell の history 相当ルートで、dismiss 済みのとき document 順の最初の heading がカード名でないことをユニットで固定する。fixture があるからロック不要、とはしない。

### Minor

#### M1 — 資格テストが「出す」exact path を一部しか固定していない
- **id:** M1
- **file:line:** `src/features/pwa/install-tip-eligibility.test.ts:39-43` / `src/features/pwa/install-tip-eligibility.ts:4-20`
- **what's wrong:** 実装の exact 集合は `/planner` `/generation` `/pantry` `/history` `/shopping` `/plus`。テストの true ケースは `/planner` と `/menus/x` `/plus` `/emergency-menus` `/emergency-menus/x` だけ。`/generation` `/pantry` `/history` `/shopping` の欠落と、`/login` `/auth/callback` の false は未固定。実装自体は §8.3 どおり。
- **why it matters:** 将来 exact 集合から本体画面を落とすと、Plan Task 1 の「出す path」がテストを通ったまま消える。
- **how to fix:** Plan が列挙した exact / prefix を true 側に足し、`/login` と `/auth/callback` を false 側に足す。

#### M2 — `readNavigatorPlatform` の重複
- **id:** M2
- **file:line:** `src/features/pwa/home-screen-install-card.tsx:21-25` / `src/features/pwa/home-screen-install-section.tsx:11-15`
- **what's wrong:** iPadOS 判定用の `Reflect.get(navigator, "platform")` がカードと設定で二重定義。
- **why it matters:** 片方が `navigator.platform` 直読みに戻ると、iPadOS だけ面が割れる。挙動バグではない。
- **how to fix:** `install-surface.ts` に寄せて 1 関数にする。

#### M3 — 設定の Android+BIP と SW 登録の未テスト
- **id:** M3
- **file:line:** `src/features/pwa/home-screen-install-section.test.tsx:66-73` / `src/features/pwa/register-service-worker.ts:5-10`
- **what's wrong:** 設定は BIP なし手順だけ。§8.7 の「BIP があるとき設定でもインストールするを出してよい」経路は未カバー。`registerServiceWorker` の PROD ガードにユニットが無い。
- **why it matters:** 設定の BIP 分岐を壊しても GREEN。DEV 登録禁止は 11 行の実装で読めるが、回帰ネットはソース読解頼み。
- **how to fix:** 設定テストに inject 済み Android を 1 本。登録は `import.meta.env.PROD` を stub して register 呼び出し有無を見る、または現状の短さを許容する。

#### M4 — `/emergency-menus` 接頭が隣接 path まで true
- **id:** M4
- **file:line:** `src/features/pwa/install-tip-eligibility.ts:19`
- **what's wrong:** `pathname.startsWith("/emergency-menus")` は `/emergency-menusfoo` にも一致する。現行 router にその path は無い。`/menus/` と `/history/` は trailing slash 付きで狭い。
- **why it matters:** 将来の隣接ルートがカード対象になる。実害は今は無い。
- **how to fix:** `pathname === "/emergency-menus" || pathname.startsWith("/emergency-menus/")` に揃える。

## 満たしている契約（差し戻し対象外）

| 項目 | 判定 |
| --- | --- |
| 検出 §8.2 / 資格 §8.3 / dismiss キー §8.1 | 一致。owned 掃除にキーを足していない。logout 後残存を `auth-cleanup.test.ts` が固定 |
| copy §8.4（PWA 文字なし、カード h2 / 設定 h2 分離、iOS 3 / Android 2 / other 1） | exact。カードに共通リードあり |
| カードは Outlet 直前、設定は空家族・家族ありの Plan 直前、読込中 early return には置かない | 一致 |
| BIP listen は `createRoot` より前。自動 dismiss なし | 一致（描画購読だけが I1） |
| E2E 既定 dismiss は context `addInitScript`。`evaluate(setItem)` を正本にしない | `loginAsNewUser` / `auth.setup` / `session-auth` / `seed-onboarding` / `auth-recovery` / `oauth-mock` を確認。本機能 spec だけ opt-out |
| manifest §6.1 / index.html §6.2 / アイコン寸法と紙色+テラコッタ椀 | 一致。写真・文字なし |
| `_headers` §7.5、`CSP_STATIC_DIRECTIVES` 非変更、グローバル `[[headers]]` に CSP なし | 一致 |
| SW 判定順 §7.3、シェル `/`、フォント / `/index.html` 非 Precache、自 CACHE_NAME、network-first HTML | 一致。generator は時計・乱数なし |
| `package.json` の `build` 文字列、`vite-plugin-pwa` / Workbox なし | 一致 |
| Auth ロック export 非再定義、`@shared/safety` 非 import | 一致 |
| メモリ dismiss（setItem throw でも同一マウントでは閉じ、空 storage 再マウントでは再表示） | カードテストあり |
