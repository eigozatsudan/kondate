# 2次検証: PWA 実装

- **役割:** 独立 secondary verifier（1次・敵対・実装の著者コンテキスト非共有。本ファイルのみ書込）
- **日付:** 2026-08-16
- **Worktree:** `/home/dev/projects/kondate/.worktrees/pwa-installable-app-shell`
- **Branch:** `feat/pwa-installable-app-shell`
- **HEAD:** `048c4c88`
- **Base..Head:** `560f07c4`..`048c4c88`
- **Diff 正本:** `.superpowers/sdd/review-560f07c4..048c4c88.diff`
- **照合 spec:** [`docs/superpowers/specs/2026-08-16-pwa-installable-app-shell-design.md`](../specs/2026-08-16-pwa-installable-app-shell-design.md)
- **照合 plan:** [`docs/superpowers/plans/2026-08-16-pwa-installable-app-shell.md`](../plans/2026-08-16-pwa-installable-app-shell.md)
- **入力:**
  - 1次: [`2026-08-16-pwa-installable-app-shell-impl-primary.md`](./2026-08-16-pwa-installable-app-shell-impl-primary.md)（REVISE / C0 I2 M4）
  - 敵対: [`2026-08-16-pwa-installable-app-shell-impl-adversarial.md`](./2026-08-16-pwa-installable-app-shell-impl-adversarial.md)（PASS_WITH_RESIDUALS / C0 I0）
- **手法:** live ソースと契約文面の静的再照合。Chrome BIP 時刻は MDN / web.dev / Chrome 公式ブログで独立確認。製品コードは変更していない。全件テストは再実行していない。

---

## Summary

許可リスト SW・案内カード・E2E dismiss・CSP / Auth / Precache の骨格は Spec / Plan に載っている。敵対が突いた 16 不変のうち、実装が壊したものは無い。Cache へのユーザーデータ混入、API / callback 横取り、CSP 緩和、Auth ロック再定義は成立しない。

差し戻しは 2 点だけ。どちらも漏洩ではない。

1. **I1 CONFIRMED。** `preventDefault` 済み BIP を描画後に購読しないため、初回訪問の Android 主経路「インストールする」が出ない。敵対 false-lead #1 は契約の読み違いで **過却下**。
2. **I2 CONFIRMED。** Plan Task 5 が要求した `heading.first()` の名前否定（またはユニット相当）が無い。既存 assert は visible だけなので dismiss 回帰が false-green になる。

M1–M4 は実在するが任意。新 Important / Critical は立てない。

**Verdict: `FIX_THEN_OK`**

---

## Verdict

| 項目 | 値 |
| --- | --- |
| **判定** | **`FIX_THEN_OK`** |
| **Critical** | **0** |
| **Important must-fix** | **I1, I2** |
| **Minor（任意）** | **M1–M4（いずれも実在）** |
| **却下** | なし（重大度の降格もなし） |
| **敵対 16 不変** | 実装破壊なし。I1 だけ過却下 |

骨格は正しい。must-fix は購読 1 本と見出し否定 1 本。設計のやり直しではない。1次の REVISE と同じ穴を指すが、修正範囲が閉じているので `FIX_THEN_OK` とする。

---

## Cross-walk

| ID | 出典 | 元重大度 | 二次判定 | 二次重大度 |
| --- | --- | --- | --- | --- |
| **I1** | 1次 | Important | **CONFIRMED** | Important |
| **I2** | 1次 | Important | **CONFIRMED** | Important |
| **M1** | 1次 | Minor | **CONFIRMED** | Minor（任意） |
| **M2** | 1次 | Minor | **CONFIRMED** | Minor（任意） |
| **M3** | 1次 | Minor | **CONFIRMED** | Minor（任意） |
| **M4** | 1次 | Minor | **CONFIRMED** | Minor（任意） |
| 敵対 Critical / Important | 敵対 | 0 | **同意**（I1 を Important として拾い直す以外、新 Important なし） | — |
| 敵対 false-lead #1（BIP 遅延は契約） | 敵対 | 却下 | **過却下** → I1 | Important |
| 敵対残差 §2.3（13 件） | 敵対 | residual | **同意**。実装が悪化させていない | residual |
| 新 Important | — | — | **なし** | — |

---

## I1 — CONFIRMED Important

**file:line:** `src/features/pwa/android-install-prompt.ts:15-35` / `src/features/pwa/home-screen-install-card.tsx:59-97` / `src/features/pwa/home-screen-install-section.tsx:24-58` / `src/main.tsx:16-19`

### コードがしていること

`listenForAndroidInstallPrompt` は `createRoot` より前で `beforeinstallprompt` を取り、**常に** `preventDefault()` してから `held` に置く（`android-install-prompt.ts` L15-19, `main.tsx` L16-19）。listen 時刻自体は Spec §8.5 / Plan Task 2 / Key Decision 9 どおり。

カードと設定は `peekAndroidInstallPrompt()` を **そのレンダーの一回読み** するだけ。`useAndroidInstallPrompt` は peek の非購読ラップで、どちらからも呼ばれていない。

```33:35:src/features/pwa/android-install-prompt.ts
export function useAndroidInstallPrompt(): AndroidInstallPrompt | null {
  return peekAndroidInstallPrompt();
}
```

ユニットは `injectAndroidInstallPromptForTests` を **render 前** に置く（`home-screen-install-card.test.tsx` L124-133）。描画後到着は見ていない。本機能 E2E の Android ケースは手順文だけを見る（`pwa-install-tip.spec.ts` L19-27）。E2E は Vite DEV で `registerServiceWorker` が即 return するため、BIP は飛ばない。

### Chrome の BIP 時刻（1次を鵜呑みにせず確認）

MDN `beforeinstallprompt`: **発火時刻の保証は無い**。「usually on page load」。公式サンプルはハンドラ内で `preventDefault` したあと **その場でボタンを出す**。

web.dev *Installation prompt*: 同じくハンドラ内で `preventDefault` → 保持 → `showInAppInstallPromotion()`。

Chrome ブログ *Revisiting Chrome's installability criteria*（2023-12-05）: メニューからの手動インストールは SW `fetch` 要件を外した（mobile 108 / desktop 112）。**一方「install prompt を出すアルゴリズムは、いまも `fetch()` ハンドラの存在を要求する」**。BIP / ミニインフォバー側は SW 待ちのまま。

web.dev *What does it take to be installable?*（2024-09-19）: BIP 前条件に **タップ 1 回 + 30 秒閲覧** の engagement heuristic が残っている。これが現行 Android Chrome で生きていれば、初回 paint より後になることは確定する。

この実装では `registerServiceWorker` が fire-and-forget（`register-service-worker.ts` L5-10）。`install` は `addAll(PRECACHE_URLS)`（`/`・manifest・icons・全 JS/CSS）。初回訪問では SW が未 install。BIP は SW の fetch ハンドラが揃ったあと（加えて heuristic が生きていれば 30s+tap のあと）に飛ぶ。React のカード初回描画（Auth 復元後の `/planner`）より後になるのが初回訪問の本線。

イベント到着後は `held` に入るが、カードを再描画する購読が無い。`useLocation` / `useAuth` の偶発更新を待つだけ。着地した `/planner` に留まるユーザーには「インストールする」が出ない。

`preventDefault` 済みなので Chrome の既定 UI も出ない。残るのは手順 2 文（メニュー操作）だけ。Spec §8.4 の主経路は「BIP を保持しているときだけ `インストールする`。手順リストは出さない」。

### 「peek 正本」は遅延到着を捨てる契約ではない

Plan Task 2 の `peekAndroidInstallPrompt()` を「カードの Android ボタン正本」としたのは、**カードが独自に listen しない / どのオブジェクトの `prompt()` を呼ぶか** の API 形。`useAndroidInstallPrompt` の「peek の薄いラップでも可」も同じ。inject-before-render はテスト手順であり、描画後 BIP を無視せよとは書いていない。

Spec §8.5 はモジュール初期化で取れ、surface で listen を遅らせるな、自動 dismiss するな、とだけ言う。Key Decision 9 は「フック mount 待ちで Android 主経路を殺さない」。早期 listen + `preventDefault` + 非購読は、フック待ちより主経路を確実に殺す。

設定は新規マウント時に peek し直すので、BIP 後に `/settings` へ行けばボタンは出る。クライアント遷移でカードが再 render しても出る。それは偶発フォールバックであり、§8.4 の初回カード主経路ではない。

### 直し方（1次と同じで足りる）

`held` の変化を `useSyncExternalStore`（または listen 内の購読者）でカード / 設定に伝える。BIP 到着後はボタンを出し、手順を消す。テストは listen → render（手順が見える）→ `dispatchEvent` → 「インストールする」が出て手順が消える、を 1 本。`userChoice` / `appinstalled` での自動 dismiss は今どおりしない。

---

## I2 — CONFIRMED Important

**file:line:** `e2e/specs/mobile-accessibility.spec.ts:256` / Plan Task 5 Step 2 / Spec 受け入れ 9

```256:256:e2e/specs/mobile-accessibility.spec.ts
      await expect(page.getByRole("heading").first()).toBeVisible({ timeout: 30_000 });
```

名前否定は無い。`ホーム画面に置く` を「first heading ではない」と固定するユニットも、`src/features/pwa/` / `src/app/layouts/` に無い。

Plan Task 5 Step 2 原文: `mobile-accessibility.spec.ts` の `heading.first()` が「ホーム画面に置く」ではないこと（**名前で否定**）を、当該テストを回すか **ユニット相当で固定する**。

「回す」だけでは足りない。既存 assert は visible だけなので、カード `h2` が document 順の先頭になっても GREEN のまま。AppShell は Outlet 直前にカードを置く（`app-shell.tsx` L228-230）。カード見出しは `h2`「ホーム画面に置く」（§8.4）。`getByRole("heading")` は h1/h2 を両方取る。dismiss が効かないと first はカードになる。

`completedOnboardingPage` は `loginAsNewUser` 既定 seed + `seedCompletedOnboardingState` の context `addInitScript` で守られている（`e2e/fixtures/auth.ts` L327-328、`e2e/fixtures/seed-onboarding.ts` L52）。**今は** history 見出しで通る。効かなくなってもこのテストは落ちない。受け入れ 9 / §9.2 が要求している観測点は「dismiss がある」ではなく「first heading がカード名でない」。

直し方: 当該行に `await expect(page.getByRole("heading").first()).not.toHaveAccessibleName("ホーム画面に置く")` を足す。または dismiss 済みの AppShell / history 相当ルートで、document 順の最初の heading がカード名でないことをユニットで固定する。

（参考: AppShell のプログラムフォーカスは `main h1` / `h1` だけを見る（`app-shell.tsx` L184）。カードは `h2` なので §8.6「フォーカスはカード出現で奪わない」は侵していない。I2 は E2E 見出し契約の話であり、フォーカス契約の話ではない。）

---

## M1–M4 — 実在・任意

### M1 CONFIRMED Minor

`shouldShowInstallTip` の exact 集合は `/planner` `/generation` `/pantry` `/history` `/shopping` `/plus`（`install-tip-eligibility.ts` L3-11）。テストの true は `/planner` と `/menus/x` `/plus` `/emergency-menus` `/emergency-menus/x` だけ（`install-tip-eligibility.test.ts` L39-43）。`/generation` `/pantry` `/history` `/shopping` の true と `/login` `/auth/callback` の false は未固定。実装は §8.3 どおり。回帰ネットが薄いだけ。任意。

### M2 CONFIRMED Minor

`readNavigatorPlatform` がカード L21-25 と設定 L11-15 で二重。片方が `navigator.platform` 直読みに戻ると iPadOS だけ面が割れる。挙動バグではない。任意。

### M3 CONFIRMED Minor

設定テストは BIP なし手順だけ（`home-screen-install-section.test.tsx` L40-47）。§8.7 の「BIP があるとき設定でもインストールするを出してよい」は未カバー。`registerServiceWorker` の PROD ガードにユニットが無い。実装は読める。任意。I1 を直すなら設定側の遅延 BIP テストを同じ変更に載せてよい。

### M4 CONFIRMED Minor

`pathname.startsWith("/emergency-menus")` は `/emergency-menusfoo` にも一致する。Plan Task 1 Step 3 の文言どおり。現行 router にその path は無く、未知 path は AppShell 外の `*` 404（`router.tsx` L157-161）なのでカードは載らない。`/menus/` と `/history/` は trailing slash 付きで狭い。将来の隣接ルート向け。任意。

---

## 敵対レビュー

### 16 不変 — 過却下は I1 だけ

| # | 二次 | 根拠（再照合） |
| --- | --- | --- |
| 1 ユーザーデータ Cache | 反証を支持 | Precache は固定 URL + Vite `.js`/`.css`。`src/pwa/` に `cache.put` / グローバル `caches.match(` / `skipWaiting` / `clients.claim` 無し。ナビ成功は `fetch` を返す |
| 2 API / callback | 反証を支持 | 判定順は非 GET → 他 origin → API/callback → navigate（`service-worker-routing.ts` L32-43）。passthrough は `respondWith` しない（`service-worker.ts` L44） |
| 3 禁止 API | 反証を支持 | ナビ失敗は `caches.open(CACHE_NAME)` → `cache.match(SHELL_URL)` |
| 4 `/index.html` / フォント Precache | 反証を支持 | generator 契約。二次は生成物を再ビルドしていない（敵対と同じ） |
| 5 SHELL `/` | 反証を支持 | `SHELL_PATH = "/"` |
| 6 CSP / Workbox / `build` 文字列 | 反証を支持 | `CSP_STATIC_DIRECTIVES` 非変更。`package.json` L11 は `tsc -b && vite build` |
| 7 Auth / owned | 反証を支持 | `isOwnedBrowserStorageKey`（`auth-cleanup.ts` L122-138）に本キー無し。`auth-cleanup.test.ts` が logout / 削除後 `"1"` を固定 |
| 8 E2E addInitScript | 反証を支持 | `seedPwaInstallTipDismissed` → context `addInitScript`。`loginAsNewUser` / `auth.setup`（最初の goto 前）/ `session-auth`（`newContext` 直後）/ `seed-onboarding` / `oauth-mock` / `auth-recovery`。本機能 spec だけ opt-out |
| 9 BIP listen 時刻 | listen 自体は契約どおり | `main.tsx` L16-19。**描画購読の欠落は I1**（敵対はここを false-lead にした） |
| 10 DEV 非登録 | 反証を支持 | `if (!import.meta.env.PROD) return` |
| 11 既存ユーザー出し分け | 反証を支持 | `shouldShowInstallTip` は 5 条件。アカウント年齢なし |
| 12 敵対ストレージ / path | 反証を支持 | `"1"` exact。`setItem` throw はメモリ dismiss |
| 13 waiting × 旧 SW | 反証を支持 | 自 `CACHE_NAME` のみ。グローバル match 無し |
| 14 ログ | 反証を支持 | PWA / SW ソースに `console.*` 無し。登録失敗は空 `catch` |
| 15 カード path | 反証を支持 | `/login` `/welcome` `/onboarding` `/privacy` `/` は AppShell 外。`/settings` は `shouldShowInstallTip` false |
| 16 設定両分岐 | 反証を支持 | 空家族 L1618-1619、家族あり L2360-2361。読込中 L1551-1552 には置かない |

### false-lead #1 は過却下

敵対は「plan / spec が peek をカード正本に固定したので、native infobar を消してボタンが遅れるのは契約の帰結」とした。上の I1 どおり、peek 正本は API 形であり遅延到着の無視ではない。クライアント遷移後の再 render でボタンが出ることも、初回 `/planner` 滞在の主経路を救わない。

false-lead 2–6（`loginAsNewUser` seed 順、`auth-callback-security` が heading を見ない、`isAuthCallbackPath` の exact、`/emergency-menus` startsWith、`getItem` throw 非包み）は契約どおり。昇格しない。

### §2.3 残差

13 件は仕様受容。実装が悪化させていない。must-fix にしない。§9.3 の本番 Precache「200 かつ非 redirect」は手動受け入れのまま。

新 Important は立てない。検討して棄却したもの: カード `h2` が AppShell の遷移フォーカスを奪う可能性 → `tryFocusHeading` は `h1` だけなので不成立。

---

## Must-fix set（実装者へ）

1. **I1** — `held` を購読し、描画後 BIP でも「インストールする」を出して手順を消す。遅延 `dispatchEvent` のテストを 1 本。自動 dismiss はしない。
2. **I2** — `heading.first()` が「ホーム画面に置く」ではないことを E2E またはユニットで固定する。

M1–M4 は任意。I1 修正に乗せるなら M3 の設定 BIP を優先してよい。

---

## 満たしている契約（差し戻し対象外）

1次の「満たしている契約」表に同意する。検出 / 資格 / dismiss キー / copy / カード Outlet 直前 / 設定両分岐 / BIP の createRoot 前 listen / E2E addInitScript / manifest / アイコン / `_headers` / シェル `/` / フォント非 Precache / 自 CACHE_NAME / `skipWaiting` 等禁止 / CSP 非緩和 / Auth ロック非再定義 / メモリ dismiss。欠けているのは I1 の描画購読と I2 の見出し否定だけ。
