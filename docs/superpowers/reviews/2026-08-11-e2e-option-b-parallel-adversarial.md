# E2E Option B 敵対的レビュー

**対象:** `06ad4ef4a1b0c52133d4e1da298b08813725c4ae`  
**照合ツリー:** `/home/dev/projects/kondate`（read-only。本ファイルのみ新規）  
**変更面:** `scripts/run-e2e.sh`, `playwright.config.ts`, `compose.yaml`（e2e env 補間）, tooling tests, `docs/local-development.md`  
**姿勢:** 案 B の並列主張を通したい著者バイアスを疑い、AI 枠・シグナル orphan・成果物競合・tooling false green を優先して突く。推測のみは Residual に落とす。

---

## 判定

**PASS_WITH_RESIDUALS**

| 重大度 | 件数 |
| --- | ---: |
| Critical | 0 |
| Important | 4 |
| Minor | 3 |

本線の実装（開始時 1 回 reset + `GLOBAL_DAILY=500`、shell が setup 1 回 → mobile\|\|desktop 並列、exit は mobile 優先、成果物 env 分離、per-test global truncate 禁止の tooling）は **コード上成立**し、列挙した攻撃の多くは **反証または実装で緩和**される。  
一方、**dual-child シグナル／2 one-off cleanup の動的検証が欠落**し、**process 間 serial の過信**と **AI 単一行ロック下の壁時計主張**が残る。現行を即 FAIL にする確定バグは見つからなかったが、案 B の「十分に閉じた」主張は過大。

---

## 攻撃結果

| # | 攻撃シナリオ | 判定 | 根拠（コード） |
| --- | --- | --- | --- |
| 1 | AI 共有枠枯渇（中間 reset 廃止） | **反証（容量）/ residual（競合）** | 開始時のみ `reset-e2e-ai-quota.sh`（`run-e2e.sh` L574）。`compose.e2e.yaml` `GLOBAL_DAILY_AI_LIMIT: "500"`。e2e ツリーに per-test truncate 禁止（`e2e-ai-quota-parallel.test.mjs`）。同日 2 回 full も各回開始時 truncate。枯渇は 500 頭打ち前提では主因になりにくい。一方 `reserve_ai_generation` は `private.ai_global_daily_usage` を **usage_day 単一行 `FOR UPDATE`**（migration）— 並列予約は直列化し timeout flaky は残る。 |
| 2 | `FOR UPDATE` で両 project 生成が同時 timeout | **部分成立 → residual** | 上と同じ単一行ロック。`workers: 2` × 2 process = 最大 4 browser。生成密集 file は process 内 serial でも **mobile と desktop は同時に generation-recovery 等を走らせ得る**。コード上の hard bug ではなく負荷依存。 |
| 3 | billing-plus / reusedCompletedPage の mobile+desktop 同時 mutate | **概ね反証** | `reusedCompletedPage` 利用は `billing-plus.spec.ts` のみ。file-level `mode: "serial"` + 表示系は `page.route` mock。`storageState` 書込は setup 直列のみ（`auth.setup.ts`）。読取共有は安全。破壊的 isolation は ephemeral `authenticatedPage`。 |
| 4 | 2×workers=2 = 4 browsers で host Vite / network flaky | **部分成立 → residual** | `playwright.config.ts` が明示（workers×2）。`retries` を local 1 / CI 2 に上げ `ERR_NETWORK_CHANGED` 保険。決定的破綻ではなく flaky 源。 |
| 5 | `docker compose run` 並列で container name 衝突 | **反証（本線）** | `e2e` に `container_name` 無し。project name 固定でも one-off は一意 suffix が通常。ロックは wrapper 多重のみ禁止（`.run-e2e.lock`）。 |
| 6 | cleanup の `compose kill e2e` が片方しか殺さない | **未証明 → residual Important** | cleanup は service 名 1 回 `kill`/`rm`（`run-e2e.sh` L283–296）。Compose が service 配下の全 one-off を対象にする前提。**tooling は dual body 失敗後の kill を動かさない**（失敗 mock は先頭 setup で止まる）。 |
| 7 | mobile 終了後 desktop のみ child_pids 更新窓で orphan | **反証（設計）/ residual（未検証）** | mobile wait 後 `child_pids=$desktop_pid`（L465–467）。dead PID への kill は `\|\| true`。signal は両 wait 完了まで desktop を所有。**ただし dual 中の signal 配送 tooling は意図的に `--project=mobile-chromium` 単一で回避**（`local-development-scripts.test.mjs` L1032）。 |
| 8 | `launch_in_progress` と `signal_pending` race | **反証（本線）/ Minor 死旗** | 並列 path は PID 公開後に `signal_pending` を配送（L453–460）。`launch_in_progress` は **書かれるが一度も読まれない**（死んだフラグ）。配送は pending 経路で成立。 |
| 9 | wait 割り込みで mobile 失敗を desktop 成功が上書き | **反証** | 両 wait 後: `termination_status` → `mobile_status` → `desktop_status`（L472–480）。desktop 成功で mobile 非 0 を消さない。 |
| 10 | `canonicalizeE2EInvocations` が setup 等を誤並べ替え | **反証（本線）** | body 判定は `run`+`e2e`+`--rm`+`--no-deps` かつ `--project=mobile\|desktop-chromium` のみ。setup / kill / logs は対象外。body が 2 未満なら no-op。 |
| 11 | mock `index.mkdir` リークで比較失敗 | **反証** | `readDockerInvocations` は `/^\d+$/` のみ。`*.lock` dir は除外（L201–202）。fixture は `t.after` で root ごと `rm`。 |
| 12 | ホスト export の `OUTPUT_DIR` が setup に汚染 | **部分成立 → Minor** | 並列 body は command 前置き代入で上書き。`run_playwright`（setup / smoke / 単 project）は **env を unset しない**。手動 `export KONDATE_E2E_OUTPUT_DIR=...` が残ると setup 成果物がずれる。通常の wrapper 内汚染は起きない。 |
| 13 | CI と local で report パスが変わり artifact 期待が壊れる | **反証（現状 CI）** | GHA は playwright-report を upload しない（`ci.yml` コメント L97–98）。local docs は split path を明示。 |
| 14 | 中間 reset 廃止で同日 2 回 full が累積 | **反証** | 毎回 L574 で truncate。中間無しは並列の帰結。`reset-e2e-ai-quota.sh` ヘッダは「mobile 完了後にも呼ぶ」と **古い**（Minor）。 |
| 15 | `for_each_child_pid kill -s "$active_signal"` の空 signal / word-split | **反証** | `"$active_signal"` は quote 済み。PID のみ意図的 word-split。`active_signal` は trap で HUP/INT/TERM 設定後に配送。 |
| 16 | list reporter stdout 混線で CI パース失敗 | **反証（本線）/ Minor residual** | CI は exit code。list 出力の機械パース無し。人間可読ログは乱れ得る。 |
| 17 | serial が process 間競合を十分防ぐ | **攻撃成功（過大主張）** | `describe.configure({ mode: "serial" })` は **単一 Playwright process 内**のみ。mobile\|\|desktop は別 process — generation-recovery / full-journey 等が **同時に**走り得る。docs も「AI 共有枠は単一行ロック」と認めている。 |
| 18 | tooling が並列ログ順を正しく検証 | **部分成功** | success 時の argv 集合 + canonicalize は固定。**env（OUTPUT_DIR/HTML_REPORT）・dual signal・body 失敗後 kill は未固定**。 |

---

## Critical Findings

（なし）

確定した本線破壊（exit 上書き、枠の per-test 破壊、CI での SKIP_RECREATE 許可、製品 `GLOBAL_DAILY=20` 改変、storageState 同時書込）はコード照合で再現できなかった。

---

## Important Findings

### I1. dual mobile\|\|desktop のシグナル配送・wait 集約が tooling で未演習

- **信頼度:** 93  
- **箇所:**  
  - `scripts/run-e2e.sh` `run_playwright_mobile_desktop_parallel` L431–481（`child_pids` / `for_each_child_pid`）  
  - `tests/tooling/local-development-scripts.test.mjs` L1031–1033: **「dual mobile/desktop 分岐を避ける」**と明示し `--project=mobile-chromium` のみ  
  - 失敗系 expected: `cleanupE2EContainers=true` のとき `playwrightRuns = [setupRun]` のみ（L413–416）— mock `E2E_STATUS` は先頭 e2e=setup で効き **body 並列に到達しない**  
- **攻撃:**  
  1. 並列中 Ctrl-C → 片 child だけ TERM、もう片方が orphan compose/Playwright  
  2. mobile 先終了後の `child_pids` 更新と signal のレース（設計上は desktop のみ残す意図だが、動的テスト無し）  
  3. 将来 `for_each_child_pid` を壊しても **success argv 比較は green** のまま  
- **なぜ Critical でないか:** 静的コードは両 PID を並べて `deliver_signal` する。バグ未実証。  
- **修正要求:**  
  1. mock で setup 成功・body 2 本を `E2E_WAIT_FOR_SIGNAL` 相当で並列待機させ、親 signal 後に **両 docker-e2e 相当 PID が死ぬ**ことを assert  
  2. mobile 失敗・desktop 成功の exit 優先を dual path で固定（現状 success/failure は setup 単段寄り）

### I2. process 間では serial が効かず、案 B は生成密集を 2 倍同時化し得る

- **信頼度:** 90  
- **箇所:**  
  - serial files: `generation-recovery-results`, `full-journey`, `history-regeneration`, `history-safety-change`, `shopping-list-races`, `billing-plus`  
  - `playwright.config.ts` L5–9: workers=2 と「実効ブラウザ並列は最大 workers×2」  
  - `reserve_ai_generation` global row `FOR UPDATE`  
  - `docs/local-development.md` L85: 行ロックで生成予約が直列化し得ると記載  
- **攻撃:** mobile の generation-recovery（serial だが process 内）∥ desktop の同 file または shopping 生成 → 単一行ロック待ち → Function budget / Playwright timeout で **flaky red**。中間 reset 廃止は枯渇対策としては 500 で足りても、**待ち時間**は悪化し得る。  
- **壁時計 ≈ max 主張:** 非 AI の UI 並列では成立しやすい。生成密集区間は **max ではなく直列化した和に近づく**。  
- **修正要求（いずれか）:**  
  1. 生成密集 file を project 間で排他（例: 片 project のみ、または file 名 mutex / 別 suite）  
  2. または「壁時計 ≈ max」を **非 AI 区間**に限定して docs/主張を修正し、full の期待時間を行ロック前提で測り直す  
  3. timeout 予算を並列度に合わせて再検証（値の勝手な締めは禁止 — 計測後に人間確認）

### I3. 成果物分離（OUTPUT_DIR / HTML_REPORT）が tooling で未検証

- **信頼度:** 88  
- **箇所:**  
  - `run-e2e.sh` L439–450: 前置き env で分離  
  - `compose.yaml` L200–201: `${KONDATE_E2E_OUTPUT_DIR:-test-results}` 等  
  - `playwright.config.ts` L19–27  
  - `expectedE2EInvocations` / mock docker は **argv のみ**記録。env を見ない  
- **攻撃:** 将来 env 前置きを消し、両 process が既定 `test-results` / `playwright-report` に書く → HTML report / attachment 競合で flaky または上書き。**canonicalize 付き argv テストは green のまま**。  
- **実装自体:** shell 前置き代入はプロセス局所で正しく、本線の分離は妥当。穴は **退行検知**。  
- **修正要求:** mock docker が env をログするか、`run-e2e.sh` 静的に `KONDATE_E2E_OUTPUT_DIR=test-results/mobile-chromium` と desktop 対称を pin。

### I4. 2 one-off e2e の cleanup 回収が dual 動的に未証明

- **信頼度:** 82  
- **箇所:** `run-e2e.sh` cleanup L283–296（`kill --signal SIGKILL e2e` / `rm --force e2e` 各 1 回）  
- **攻撃:** 並列 interrupted 時に service-level kill が片方の one-off だけ対象、または `--rm` 途中と競合して残存。次 full が古い browser とポート/volume で干渉。  
- **なぜ Critical でないか:** Compose v2 は service ラベルで複数 one-off を kill するのが通常。`container_name` 固定も無い。未実証。  
- **修正要求:** dual wait 中断後に `docker compose ps`/recorder 上で e2e kill が **1 回でも両 client が終了済み**であることを fixture 化。必要なら container id 列挙 kill に強化。

---

## Minor Findings

### M1. `scripts/reset-e2e-ai-quota.sh` ヘッダが案 B 以前のまま

- L4–10: 「mobile 完了後にも本スクリプトを呼び」と記載。実装は **開始時 1 回のみ**（`run-e2e.sh` L574 + 中間無しコメント L622）。  
- **影響:** 保守者が中間 reset を「戻した」と誤読し、並列と両立しない変更を入れ得る。  
- **修正:** ヘッダを「suite 開始時のみ。project 並列のため中間 reset なし。上限は compose.e2e 500」に更新。

### M2. `launch_in_progress` が死んだフラグ

- 代入のみ（L50, 226–230, 436–455）。配送制御は `signal_pending` + `has_active_children`。  
- **影響:** 読者が「launch 中は特別扱い」と誤解。信号契約のレビューコスト増。  
- **修正:** 削除するか、本当に launch 窓で使うなら read する。

### M3. ホストに残った `KONDATE_E2E_*` export / list ログ混線

- setup/smoke 経路は env をクリアしない（I3 の軽微版）。  
- 2 process の list reporter が同一 stdout に交錯 — CI は exit 依存のためゲートは壊れない。  
- **修正:** setup 前に `KONDATE_E2E_OUTPUT_DIR` / `HTML_REPORT` を空に export、または docs に「export しないこと」。

---

## False positives を避けた理由

| 疑い | 落とす理由 |
| --- | --- |
| mobile 失敗を desktop が上書き | L475–479 で mobile 優先。明示的に反証。 |
| 中間 reset 無し → 即 global 枯渇 | 500 + 開始 truncate + per-user ephemeral。枯渇は主因にしない（競合待ちは I2）。 |
| storageState 同時書込 | setup 直列。billing-plus は mock 表示 + serial。 |
| canonicalize が setup を並べ替え | 述語が body project に限定。 |
| CI artifact パス破壊 | CI が report を upload しない。 |
| container_name 衝突 | 未設定。通常 Compose one-off 一意。 |
| `kill -s "$active_signal"` word-split | signal は quote 済み。 |
| workers: 20 偽緑 | 現行 tooling は行アンカー `^\s*workers:\s*2\s*,?\s*$`（p3 指摘は本線で閉じ済み）。 |
| e2e-ai-quota-parallel が CI 外 | `ci.sh` / `ci.yml` / project-config に掲載済み。 |

---

## Residual risks（コード静的照合だけでは閉じない）

1. **同一 SHA での案 B full ×2 実測 green** — 本レビューは実行していない。行ロック + 4 browser の flaky は実測領域。  
2. **Compose 実装差** — `kill e2e` が全 one-off を確実に殺すかは daemon/CLI 版依存（I4）。  
3. **生成系テスト追加** — 500 を超える送信見積や修復リトライ増で、中間 reset 無しが初めて枯渇する可能性。  
4. **auth メール 1000** — compose.e2e の `GOTRUE_RATE_LIMIT_EMAIL_SENT: "1000"`。並列で ephemeral 認証が倍増しても setup 1 回化で緩和されているが、上限再接近は計測依存。  
5. **案 B の壁時計 ≈ max** — 非 AI では妥当。AI 密集区間は I2 の通り偽約束になり得る（docs L85 は認識済み）。

---

## 案 B 主張への判定まとめ

| 主張 | 判定 |
| --- | --- |
| 1. mobile\|\|desktop で壁時計 ≈ max | **条件付き** — 非 AI は近い。生成密集は行ロックで崩れる（I2） |
| 2. 中間 AI reset なしでも GLOBAL 500 で足りる | **容量は妥当 / 競合は残る** |
| 3. 成果物分離で競合なし | **実装は妥当 / 退行テスト不足（I3）** |
| 4. シグナルが両 process に届き orphan なし | **設計は妥当 / dual 未検証（I1, I4）** |
| 5. tooling が並列ログ順を正しく検証 | **argv 順のみ。env・signal・dual fail は不足** |
| 6. serial が process 間競合を十分防ぐ | **過大 — process 内のみ（I2）** |
| 7. cleanup が 2 one-off を回収 | **想定は妥当 / dual 動的未証明（I4）** |
| 8. storageState 共有読みが安全 | **成立**（setup 直列・reused は表示系） |

---

## 完了条件への含意

- **Critical 0** のため、案 B 実装を即差し戻す根拠は無い。  
- **Important 4** は「案 B を十分に閉じて信頼する」前に、少なくとも **I1（dual signal tooling）と I3（成果物 env pin）** を埋める価値が高い。I2 は主張修正または生成 file の project 間排他がない限り residual として release 判断に残す。  
- 推測で FAIL にしていない。実測 full で timeout 群発が出た場合は I2 を Critical に格上げして再レビューすること。
