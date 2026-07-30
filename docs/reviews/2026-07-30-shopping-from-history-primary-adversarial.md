# Primary adversarial design review: 買い物リスト履歴導線 + 削除行クリーンアップ

| 項目 | 値 |
|------|-----|
| 対象 | `docs/superpowers/specs/2026-07-30-shopping-from-history-and-cleanup-design.md`（Draft — レビュー中） |
| 日付 | 2026-07-30 |
| 種別 | 設計書に対する敵対的レビュー（実装しない・read-only） |
| 判定 | **Needs revision** — Critical を設計改訂してから実装計画へ |
| 観点 | 既存ルート/実装との矛盾、URL intent 生存、fail-closed の誤適用、削除行 state 機械、idea 境界、低リテラシー UX、§9.2 undo supersede、二重送信 |

**照合した正本・実装**

- MVP `2026-07-11-kondate-mvp-design.md` §9.1–9.2
- Guided planner `2026-07-22-guided-planner-optional-household-design.md`（idea 買い物拒否）
- `src/app/router.tsx`, `src/main.tsx`（StrictMode）
- `src/features/history/components/history-card.tsx`
- `src/features/history/pages/history-detail-page.tsx` / `history-page.tsx`
- `src/features/generation/pages/menu-result-page.tsx`
- `src/features/shopping/pages/shopping-list-page.tsx`, `components/create-list-sheet.tsx`
- `src/features/shopping/hooks/use-shopping-list.ts`
- Soft-delete 契約: `supabase/migrations/20260728142000_shopping_undo_soft_delete.sql`

---

## Verdict: **Needs revision**

方向性（履歴カード CTA + `for=shopping` 文脈維持、削除行の既定非表示）は痛みに対して正しい。API/DB/idea 拒否を触らない Non-Goal も健全。

しかし **カード CTA の遷移先ルートと、auto-open を実装するページが現行コードと食い違う**。このまま実装すると「履歴から選ぶ → 買い物リストを作る」の本線が **CreateListSheet 自動表示に届かない**。加えて、URL から intent を即 strip + React state/ref のみで保持する案は **StrictMode 再マウントで intent 消滅**する。fail-closed を `canCreateShoppingList` 丸ごと（`createList.isPending` / `isFetching` 込み）に掛けると **送信中・再取得中にシートが閉じる**。

削除行の `pendingUndoIds` 遷移表も「再フェッチで pending を空／非 removed のみ残す」と「成功後も確認行を残す」が両立しない。実装前に state 機械を一意に直す必要がある。

---

## Findings table

| ID | Severity | Section | Title |
|----|----------|---------|-------|
| C-1 | **Critical** | §3.2, §4, §5 helper, File touch | CTA は `/menus/:id`、auto-open 実装は `history-detail-page` — ルート不一致で本線が死ぬ |
| C-2 | **Critical** | §4.1 L2/L8, §6 StrictMode | `for` 即 strip + state/ref intent は StrictMode 再マウントで消える |
| C-3 | **Critical** | §4.2.3, L8, 維持する canCreate | fail-closed を `canCreateShoppingList` 全体に掛けると送信中・fetch 中に create シートが閉じる |
| I-1 | Important | §2.3 遷移表 | `pendingUndoIds` の「再フェッチ」行が成功後確認行を殺す／矛盾 |
| I-2 | Important | §3.2, §4, L2 | 買い物文脈中のタイトルリンクが `for` を落とす（低リテラシー本線逸脱） |
| I-3 | Important | §3.1, §6 | idea のみ履歴 + `for=shopping` の行き止まりが未規定 |
| I-4 | Important | §4, File touch, idea 境界 | idea/household 分岐と intent 取り込みの置き場が未ロック（hooks 境界リスク） |
| I-5 | Important | §2.1–2.2, 既存 D-C1 UI | 買い物 gate 失敗時の「履歴を開く」が `for=shopping` 未更新のまま |
| I-6 | Important | §4.2, Risks, D-C1 | 実遷移先が MenuResult なら `forceNewMode` 未配線のまま auto-open し得る |
| I-7 | Important | Spec supersede §9.2, L5 | undo 可視性の supersede は明示されているが「きれいにする＝永久に元に戻せない」低リテラシー説明が不足 |
| M-1 | Minor | §2.3 itemCount | itemCount 修正を履歴詳細だけに限定し MenuResult と非対称（Non-Goal と交差） |
| M-2 | Minor | §8 Testing | StrictMode intent 生存・isPending 中シート維持・ルート到達の必須テストが無い |
| M-3 | Minor | AppShell | `/menus/` は planner 配色のまま — 履歴文脈の視覚連続性が弱い |

---

## What the design gets right (non-exhaustive)

1. **問題設定が実装と一致**: empty の「履歴から選ぶ」は `href="/history"`（`shopping-list-page.tsx` L91–93）。カードに買い物 CTA 無し（`history-card.tsx`）。`hideRemovedItems` は useState のみ（同 L50, L197–200）で再マウント復活 — 痛みの記述は正確。
2. **idea 拒否を UI だけで緩めない**: L3/L4 とサーバー `idea_menu_not_supported` 維持は guided-planner 設計と整合。カード非表示は正しい第一線。
3. **soft-delete / API 非変更**: L6 と migration `20260728142000`（manual も soft-delete）方針と矛盾しない。表示ルールだけの修正は安全側。
4. **進捗から removed 除外を維持**: 現行 `progressItems = filter(!isRemovedByUser)` を壊さないと明記。
5. **CreateListSheet 契約を変えない**: key / itemCount / 呼び出し側のみ — 所有境界が明確。
6. **auto-open 1 回・reconcile と競合しない**: `shoppingSheet === null` 前提は妥当。
7. **クエリ値 fail-open**: 未知 `for` を無視は壊れにくい。

---

## Detailed findings

### [C-1] CTA 遷移先と auto-open 実装ページのルート不一致 — **Critical**

**Where**: §3.2 HistoryCard CTA → `/menus/${id}?for=shopping`; §4 実装は `history-detail-page.tsx`; File touch も同ファイルのみ; helper `menusPathForShopping` → `/menus/...?for=shopping`; Non-Goal「生成直後の menu-result は変更しない」。

**Code today**

| Path | Component | `router.tsx` |
|------|-----------|--------------|
| `/menus/:menuId` | **`MenuResultPage`** | L77–78 |
| `/history/:menuId` | **`HistoryDetailPage`** | L89–90 |

`history-card.tsx` L64–66 のタイトルリンクは既に **`/menus/${representative.id}`**（MenuResult）。e2e の一部は `/history/${menuId}` を叩くが、一覧 UI の本線ではない。

**Why it's real**

設計どおり実装すると:

1. カード CTA が `/menus/:id?for=shopping` へ行く  
2. マウントされるのは **MenuResultPage**  
3. auto-open / intent 消費は **HistoryDetailPage にだけ**書かれている  
4. Non-Goal が MenuResult 変更を禁止しているように読める  

→ 利用者は安全確認後もシートが自動で開かず、「案1」が成立しない。実装者が Non-Goal を守って history-detail だけ直すと、**誰も通らないルートだけが賢くなる**。

**Not a false positive**: ルーターとカードの href は固定。helper 名 `menusPathForShopping` も `/menus` 固定。設計文書内で「詳細 = history-detail」と「リンク = /menus」が同時に書かれている自己矛盾。

**Concrete design fix**（どちらかをロックし、他を削除）:

**Option A（現状カードに合わせる・推奨）**

- カード CTA / helper: `/menus/:menuId?for=shopping` のまま  
- auto-open・intent・fail-closed・itemCount・idea+for メッセージの**正本実装先は `menu-result-page.tsx`（Household/Idea body）**  
- `history-detail-page.tsx` は同一契約の**パリティ**（e2e `/history/:id` 用）と明記するか、触らないなら「未配線・本線外」と書く  
- Non-Goal を改訂: 「生成フローが付ける `?recovered=1` 等の導線は触らない。**履歴由来の `?for=shopping` は MenuResult で処理する**」

**Option B（履歴詳細ルートへ寄せる）**

- カードのタイトルと CTA を **`/history/:menuId`**（CTA のみ `?for=shopping`）へ変更  
- helper を `historyPathForMenu(menuId)` / `historyPathForShoppingMenu(menuId)` に改名  
- File touch は history-detail のみでよい  
- AppShell の history 配色と一致する利点を Risks に書く  
- 既存 `/menus/` ブックマーク互換を Non-Goal or リダイレクト方針で一言

どちらかを L 番号で固定し、File touch・Testing・§4 見出しを一致させること。

---

### [C-2] `for` 即 strip + state/ref だけでは StrictMode で intent が消える — **Critical**

**Where**: §4.1 steps 1–2「intent 記録直後、シート成否を待たず replace で `for` 除去」; §6「StrictMode 二重 effect | ref で 1 回に制限」; L2/L8。

**Code today**: `src/main.tsx` L17–24 でアプリ全体が `<StrictMode>`。認証 callback は既に StrictMode 再マウント耐性テストを持つ（`auth-callback-page.test.tsx`）— 本リポジトリは同クラスのバグを既知としている。

**Attack sequence**

1. 遷移: `/menus/:id?for=shopping`（または Option B の history）  
2. マウント1: effect が `shoppingIntent=true`、`replace` で `for` 削除  
3. StrictMode: unmount → **state/ref 初期化** → remount  
4. マウント2: URL に `for` 無し、intent 初期 false  
5. `canCreate` が true になっても auto-open しない  

§6 の「ref で 1 回」は **同一 mount 内の二重 effect** には効くが、**state がリセットされる remount** には効かない。即 strip と組み合わせると意図が消える。

本番でも effect 内 strip 後に親 key 変更やエラー境界で remount すれば同様。

**Not a false positive**: React 19 + Vite の標準 StrictMode。設計が「除去は成否を待たない」と明示している。

**Concrete design fix**（いずれか一つを L としてロック）:

1. **session 一回券（推奨）**  
   - `sessionStorage` キー例: `shopping-intent:v1:${menuId}` = `"1"`（PII なし）  
   - `for=shopping` 検知時に set → すぐ strip 可  
   - 詳細マウントは URL **または** storage を intent 源とする  
   - 消費: auto-open 成功 / ユーザーキャンセル / 作成成功 navigate / idea 拒否表示確定 / メニュー ID 不一致時 delete  
   - TTL 不要（タブ単位）。ログアウト時の既存 session 掃除に indirection で触れるなら keys を列挙  

2. **strip を遅延**  
   - `for` を **auto-open 試行完了または明示キャンセルまで残す**  
   - ただし StrictMode remount では `for` が残るため **シートが二度開く**可能性 → `sessionStorage` の `auto-opened:${menuId}` で抑制  

3. **history state**  
   - `navigate(..., { state: { shoppingIntent: true } })` をカードから使い、URL `for` は共有/再読込用の副経路  
   - カードは `Link state` 必須と書く（`<a href>` 直書き禁止を §2.1 と整合）

Testing に「StrictMode 下で auto-open が 1 回成功する」を必須行として追加（auth-callback と同型）。

---

### [C-3] fail-closed を `canCreateShoppingList` 全体に掛けると送信中にシートが閉じる — **Critical**

**Where**: §4.2.3「`canCreateShoppingList` が false に転じたとき … create シートを閉じる」; 維持節の定義  
`canCreateShoppingList = actionsEnabled && !shoppingListBusy && !createList.isPending`;  
`shoppingListBusy = isFetching || !isSuccess || …`（`history-detail-page.tsx` L523–526, `menu-result-page.tsx` L515–517）。

**Why it's real**

| イベント | `canCreate` | 設計どおり close すると |
|----------|-------------|-------------------------|
| ユーザーが「作成する」→ `createList.isPending=true` | **false** | シート unmount。`pending` UI・キャンセル不能。二重送信防止の disabled ボタンも消える |
| フォーカス復帰で `useShoppingList` が `isFetching` | **false** | 開いたシートが突然閉じる |
| 再検証が `checking` に戻る（60s / Realtime） | `actionsEnabled` false → **false** | これは意図した fail-closed（D-M7 同型） |

L8「確認が閉じたらシートも閉じる」の「確認」は家族安全再確認を指すはずだが、本文は **既存ボタン disable 用の合成フラグ全体**に close を結び付けている。

現行手動オープンはシートを `isPending` で閉じない（`pending={createList.isPending}` でボタン disable のみ）。設計はそれを悪化させる。

**Not a false positive**: フラグ定義が設計本文に再掲され、§4.2.3 が同じ識別子を close 条件に使っている。

**Concrete design fix**

閉じる条件を **安全ゲート専用**に分離してロックする:

```text
// 開く（ボタン・auto-open）
canOpenCreateSheet =
  actionsEnabled && !shoppingListBusy && !createList.isPending

// 開いたあとに強制クローズ（fail-closed）
mustCloseCreateSheet =
  !actionsEnabled
  // 任意: menu が household でなくなった / unmount
  // 含めない: createList.isPending, shoppingList.isFetching のみの busy
```

- auto-open 前提: `canOpenCreateSheet && shoppingSheet===null && !autoOpened && intent`  
- close effect: `mustCloseCreateSheet && shoppingSheet==="create"` → null  
- reconcile も `!actionsEnabled || shoppingGate.blocked` 等、**mutate 不可の安全理由**に限定（`isPending` で閉じない）  
- `safetyBlocked={!canOpenCreateSheet}` は現行どおりボタン disable に使い、**unmount 条件と同一視しない**

Testing: 「submit 中 isPending でもシートが残る」「actionsEnabled false で閉じる」を分けて必須化。

---

### [I-1] `pendingUndoIds` 遷移表の自己矛盾 — **Important**

**Where**: §2.3 遷移表。

| 行 | 内容 |
|----|------|
| 初回マウント / **再フェッチ** | pending を空、**またはサーバでまだ removed でない id だけ残す** |
| 成功後 refetch | server-removed かつ pending 残存なら確認行を**継続** |

「再フェッチ」が mutation 後の refetch を含むなら、前者の「removed でない id だけ残す」は **成功直後に pending から removed id を落とす** → 確認行が瞬時消滅し、L5 と「きれいにする」以外の Undo が実質消える。

「まだ removed でない」は日本語として non-removed を残す意味であり、意図（removed を pending 表示）の逆。

**Concrete fix**

遷移を次のように書き直す:

```text
mount: pendingUndoIds = ∅

remove/at_home 送信開始: pendingUndoIds.add(id)

mutate 成功 + refetch 後:
  // pending は触らない（server-removed ∩ pending が確認行）

mutate 失敗:
  pendingUndoIds.delete(id)

undo 成功:
  pendingUndoIds.delete(id)

「リストをきれいにする」:
  pendingUndoIds = ∅

refetch / Realtime 更新（同一マウント）:
  // 原則 pending をクリアしない
  // 任意 prune: id ∉ items または (!isRemovedByUser && 最後の操作が自分の undo 以外)
  // 「non-removed だけ残す」は禁止

unmount: 破棄（永続化しない）
```

「楽観的に確認行」は、**送信開始時点では item がまだ `!isRemovedByUser` のため通常行のまま**であることも一文で固定する（確認行は成功後）。必要なら local optimistic `isRemovedByUser` を別 L で採用するか否かを決める。

---

### [I-2] 買い物文脈中のタイトルリンクが intent を捨てる — **Important**

**Where**: §3.2「タイトルリンクは従来どおり `/menus/:id`（`for` なし）」; L1 バナーは CTA を押せと書く。

**Why**: 低リテラシー利用者は大きなタイトルを押しがち。`for=shopping` バナー表示中でもタイトルは intent なし詳細へ。auto-open も案内も無く、作成ボタンはアクション群の中盤（現状の痛みそのもの）。

**Not FP**: 設計が意図的に「見返し導線を汚さない」と書いているが、L1 の目的（買い物文脈を途切れさせない）と衝突。

**Concrete fix**

- `for===shopping` のときタイトル Link も **`...PathForShopping(id)`** と同じクエリを付ける  
- 通常閲覧（`for` なし）のタイトルは現状維持  
- またはタイトルを CTA と同一先にし、カード全体の主タップを買い物作成にしない場合はタイトル横に「内容を見る」secondary を置く

---

### [I-3] idea のみ履歴 + 買い物意図の行き止まり — **Important**

**Where**: §3.1 バナー「アイデアは使えません」; §6「カードが無ければ既存 empty フィルタ UI」; L3。

**Why**: 履歴が idea ばかり（または household がお気に入りフィルタで消えたのではなく **リスト上に household CTA が 1 つも無い**）とき、バナー + idea カード群だけでは次の一手が「献立を（家族向けに）作る」に届きにくい。§6 はフィルタ empty のみ言及。

**Concrete fix**

`for=shopping` かつ「表示中カードに household CTA が 0」のとき、バナー下または list 下に固定:

- 文言: 「買い物リストに使えるのは「家族に合わせた献立」だけです」  
- primary: 「家族向けの献立を作る」→ `/planner`  
- secondary: 「買い物に戻る」→ `/shopping`  
（idea カードは残してよいが CTA は出さない）

Testing 行を追加。

---

### [I-4] idea/household 分岐と intent 処理の置き場が未ロック — **Important**

**Where**: §4.1–4.3; 実装は `HistoryDetailPage` / `MenuResultPage` とも **aggregate 取得後に Idea*Body と Household*Body へ分岐**し、idea 側は買い物 hooks を mount しない（`history-detail-page.tsx` L145–155, guided-planner 契約）。

**Why**: intent を Household だけに書くと idea+`for=shopping` の §4.3 メッセージが実装されない。親で shopping hooks を足すと idea 境界違反。  
C-1 のルート選択後も、**親で searchParams だけ読み、mode 分岐後に props で intent を渡す**必要がある。

**Concrete fix**

§4 に手順を固定:

1. ルートページ（MenuResult または HistoryDetail）が `hasShoppingIntent` を解決（C-2 の永続化込み）  
2. `for` strip は親の責任  
3. `targetMode==="idea"` → Idea body に `shoppingIntent: boolean` を渡し、hooks なしで status + 履歴/買い物リンクのみ  
4. household → 既存 shopping hooks + auto-open  
5. idea で shopping query / sessionStorage command を **開始しない**（0 件を Testing で固定）

---

### [I-5] D-C1 回復リンクが `for=shopping` 未更新 — **Important**

**Where**: §2.1–2.2 は empty / 「別の献立から作る」のみ; 実装 `shopping-list-page.tsx` L226–232 は gate 失敗時「履歴を開く」→ **`/history`**（クエリなし）。

**Why**: 削除献立で gate blocked の利用者が履歴へ行く主経路が、本設計の文脈付き導線から外れる。D-C1 自体が「履歴から別の献立で新しいリスト」を要求している。

**Concrete fix**

§2 に明示:

- safety error カードの「履歴を開く」→ **`/history?for=shopping`**  
- empty の「履歴から選ぶ」と同 helper  
- Testing 1 行

---

### [I-6] MenuResult 経路では `forceNewMode` が未配線 — **Important**

**Where**: 維持「forceNewMode（D-C1）」; Risks「既存 D-C1 forceNew 変更せず CreateListSheet に委譲」。

**Code**: `forceNewMode={shoppingGate.blocked}` は **`history-detail-page.tsx` L913 のみ**。`menu-result-page.tsx` の CreateListSheet は **prop 未渡し**（default false）。

**Why**: C-1 Option A で MenuResult に auto-open すると、壊れた active list がある利用者が append 既定のままシートを見うる（D-C1 再発）。設計は「維持」と書くが本線ページに存在しない。

**Concrete fix**

- Option A: MenuResult の CreateListSheet に `forceNewMode={shoppingGate.blocked}` を **本設計の必須**として File touch に入れる（auto-open 有無に関わらず）  
- Option B: history-detail のみなら現状で足りるが、カード遷移を `/history` に変える前提を再掲  

---

### [I-7] §9.2 undo supersede と低リテラシー向け説明不足 — **Important**

**Where**: Spec supersede「誤操作を戻す undo を同一画面表示中に限定」; L5; Risks「手動追加で回復」。

**Why**: supersede 自体は文書化されている（親衝突の隠蔽ではない）。しかし:

- 「リストをきれいにする」後は **元に戻す UI が二度と出ない**（soft-delete は残るが操作不能に等しい）  
- 手動再追加は出典・合算・ラベル警告を復元しない  
- 低リテラシー向けに、きれいにするボタン近傍の結果説明が設計に無い  

現行は削除行を出し続けるため undo に再到達できた。行動変化としては大きい。

**Concrete fix**

- きれいにするボタンの説明を固定: 例「外した項目の表示を消します。まちがえて消したときは、その場の「元に戻す」を先に押してください」  
- または初回のみ `role="status"` で同旨  
- supersede 表に「API undo は残るが、非表示行には UI から到達しない」を明記  
- Non-Goal に「removed 行の一覧復活 UI」を明示  

（MVP §9.2 の「undo を用意」との関係は supersede で足りる。文言不足が Important。）

---

### [M-1] itemCount 非対称 — **Minor**

履歴詳細のみ `filter(!isRemovedByUser)`。MenuResult は Non-Goal だが C-1 Option A なら同一バグが本線に残る。Option A 採用時は両ページで必須に格上げ。

### [M-2] Testing ギャップ — **Minor**（C/I 修正後は必須化）

不足: StrictMode intent、isPending 中シート維持、到達ルート（`/menus` vs `/history`）、household CTA 0 件 empty、D-C1 リンクの `for=shopping`、idea で shopping network 0。

### [M-3] AppShell 配色 — **Minor**

`/menus/` は planner section（`app-shell.tsx` L13–14）。履歴タブから来た買い物意図でも chrome が「献立」色。Option B なら自然に history 色。Option A なら許容と Risks に一行。

---

## Security / privacy

- クエリ `for=shopping` に PII なし — 可  
- sessionStorage 一回券を使う場合も menu UUID とフラグのみにし、献立タイトル・アレルギーを載せないこと（C-2 fix に明記済み）  
- idea 経路で shopping hooks / pending command を mount しない — I-4 で再ロック必要  
- ログ要件の変更なし — 問題なし  

## Product-abuse / double-submit

- create の idempotency / pending command は既存維持 — 可  
- C-3 未修正だと pending 中 unmount により UX 上の再タップ誘導が起きうる  
- カード二重タップは同一詳細 + auto-open 1 回で概ね可（C-2 修正後）  

## Consistency with locked contracts

| 契約 | 判定 |
|------|------|
| idea 買い物 422 / UI 非表示 | 設計は維持。I-4 で mount 境界を明文化すれば可 |
| soft-delete / fingerprint / from-menu API | 変更なし — 可 |
| MVP §9.2 undo | supersede あり — 文言 I-7 |
| MVP §9.1 履歴の再検査後まで買い物無効 | auto-open が `canCreate` 待ち — 可（C-3 修正後） |
| D-C1 forceNew | I-6 で本線ページへ必須化が必要 |
| D-M7 シート close | 意図は良いが条件が広すぎ — C-3 |

---

## Required design edits before planning

1. **C-1**: `/menus`+MenuResult vs `/history`+HistoryDetail を L で単一選択。File touch・helper・Non-Goal・Testing を一致。  
2. **C-2**: intent の StrictMode 耐性（sessionStorage または strip 遅延 + 一回券）。即 strip + useState/ref only を禁止。  
3. **C-3**: `mustCloseCreateSheet` を `!actionsEnabled`（安全理由）に限定。`isPending` / 単なる `isFetching` で unmount しない。  
4. **I-1**: pendingUndoIds 遷移表を一意化（成功後 refetch で pending を落とさない）。  
5. **I-2–I-6**: 文脈付きタイトル、idea-only empty、intent 置き場、D-C1 リンク、forceNewMode 本線配線。  
6. **I-7**: きれいにする副作用の平易コピー。  
7. Revision Summary に本レビュー ID と disposition を追記。

---

## Summary

| Severity | Count |
|----------|------:|
| Critical | 3 |
| Important | 7 |
| Minor | 3 |

**Design status: Needs revision** — Review-ready ではない。  
C-1（ルート/実装ページ不一致）と C-2（intent 消滅）と C-3（送信中シート close）を設計本文で解かない限り実装 Task に入るべきではない。削除行の方向性（既定非表示 + セッション確認行）と idea 非対応維持は支持できるが、state 機械（I-1）の修正も計画前に必要。
