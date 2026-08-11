# E2E Option B 二次検証

**対象:** `06ad4ef4a1b0c52133d4e1da298b08813725c4ae`  
**Worktree:** `/home/dev/projects/kondate`  
**入力:**  
- 1次: `docs/superpowers/reviews/2026-08-11-e2e-option-b-parallel-primary.md`（APPROVE_WITH_NITS / C0 I0 M5）  
- 敵対的: `docs/superpowers/reviews/2026-08-11-e2e-option-b-parallel-adversarial.md`（PASS_WITH_RESIDUALS / C0 I4 M3）  
**手法:** live tree 静的再照合のみ（full E2E / Docker 実走なし。コード編集なし）  
**総合判定:** **PASS_WITH_RESIDUALS**

---

## 総合

案 B 本線（setup 1 回 → mobile\|\|desktop 同一 wrapper 並列、開始時 AI reset 1 回のみ、成果物 env 分離、exit は mobile 優先、製品 GLOBAL=20 非接触、signal は `for_each_child_pid`）は **live tree で成立**する。双方レビューとも Critical 0 は妥当。

1次の **Important=0** は、**dual-child シグナル経路が tooling で意図的に回避されている点**をやや過小評価している（Pri M2 → 二次は Important residual）。  
敵対的の **I3 / I4 を Important 固定するのは過大** — 実装本線は妥当で、穴は退行検知・Compose 慣習の未証明に留まる（Minor residual へダウングレード）。  
**I2**（process 間 serial 非効）は事実として CONFIRMED だが、コード欠陥というより案 B の壁時計主張と負荷/flaky residual。docs は既に行ロック直列化を記載済み。

**ブロッカー（実装差し戻し必須の Critical / 実証バグ）: なし。**  
クローズは residual 付きで可。I1 相当の dual signal tooling と成果物 env pin は安価な follow-up として推奨。

---

## 検証サマリ表

| ID | 出典 | 重大度(元) | 二次判定 | 二次重大度 | メモ |
| --- | --- | --- | --- | --- | --- |
| Pri Critical | 1次 | — | **CONFIRMED 空** | none | 偽緑・枠破壊・setup 二重・dependsOn・製品枠改変は再確認でも未検出 |
| Adv Critical | 敵対 | — | **CONFIRMED 空** | none | 同上 |
| **Adv I1** | 敵対 | Important | **CONFIRMED** | **Important（tooling residual）** | dual signal / dual body fail が未演習。バグ未実証 |
| **Pri M2** | 1次 | Minor | **CONFIRMED → UPGRADE** | **Important**（I1 と統合） | 同じ穴。1次 Minor は過小 |
| **Adv I2** | 敵対 | Important | **CONFIRMED** | **Important（設計/主張 residual）** | serial は process 内のみ。生成密集は project 横断同時化し得る |
| **Adv I3** | 敵対 | Important | **CONFIRMED gap / DOWNGRADE** | **Minor** | 実装分離は妥当。退行 pin 不足のみ → Pri M1 と統合 |
| **Pri M1** | 1次 | Minor | **CONFIRMED** | **Minor** | compose/e2e env と prefix が tooling 未固定 |
| **Adv I4** | 敵対 | Important | **PARTIALLY_CONFIRMED / DOWNGRADE** | **Minor residual** | kill 1 回は Compose 慣習として妥当。dual 動的証明なし |
| **Pri M3** | 1次 | Minor | **CONFIRMED** | **Minor** | mobile 優先 exit の dual body mock なし（I1 修正要求の一部） |
| **Pri M4** / **Adv M1** | 両方 | Minor | **CONFIRMED** | **Minor** | `reset-e2e-ai-quota.sh` ヘッダが中間 reset 前提のまま |
| **Pri M5** | 1次 | Minor | **CONFIRMED** | **Minor** | docker mock の `index.lock` を rmdir しない（比較は壊れない） |
| **Adv M2** | 敵対 | Minor | **CONFIRMED** | **Minor** | `launch_in_progress` は書込のみ・読取なし |
| **Adv M3** | 敵対 | Minor | **CONFIRMED** | **Minor** | ホスト export の `KONDATE_E2E_*` 汚染 / list ログ混線 |
| Adv #1 枠枯渇 | 敵対攻撃 | — | **CONFIRMED 反証（容量）** | residual 競合は I2 | 開始 reset 1 + compose.e2e 500 |
| Adv #3 billing-plus | 敵対攻撃 | — | **CONFIRMED 概ね反証** | n/a | reused は billing-plus のみ・表示+route+file serial |
| Adv #5 name 衝突 | 敵対攻撃 | — | **CONFIRMED 反証** | n/a | e2e に `container_name` 無し |
| Adv #9 exit 上書き | 敵対攻撃 | — | **CONFIRMED 反証** | n/a | mobile_status 優先 L475–479 |
| Adv #10 canonicalize | 敵対攻撃 | — | **CONFIRMED 反証** | n/a | body 述語が project 限定 |
| Adv #13 CI report | 敵対攻撃 | — | **CONFIRMED 反証** | n/a | GHA は playwright-report upload なし |

---

## 敵対的 I1–I4 の深掘り

### I1 — dual mobile\|\|desktop のシグナル配送・wait 集約が tooling 未演習

**判定: CONFIRMED · Important（tooling residual）· 実証バグではない**

| 主張 | live evidence |
| --- | --- |
| 実装は両 PID を所有 | `scripts/run-e2e.sh` L453–454: `child_pids="$mobile_pid $desktop_pid"`；L66–76 `for_each_child_pid`；L169 `deliver_signal` → 全 child へ |
| mobile wait 後は desktop のみ | L465–467: `child_pids=$desktop_pid` |
| signal テストは dual を避ける | `tests/tooling/local-development-scripts.test.mjs` L1031–1033: コメント「dual mobile/desktop 分岐を避ける」+ `e2eArgs = ["--project=mobile-chromium"]`。L1091+ の force-kill 系も同 |
| 失敗 expected が body に届かない | 同ファイル L413–416: `cleanupE2EContainers=true` のとき `playwrightRuns = [setupRun]` のみ。理由: mock `E2E_STATUS` / `E2E_WAIT_FOR_SIGNAL` が先頭 e2e（setup）に効く |
| 静的 pin はあるが実行なし | `compose.test.mjs` L496–498: `for_each_child_pid` / `run_playwright_mobile_desktop_parallel` 文字列 match のみ |

**なぜ Critical でないか:** 静的に dual 配送は一貫。orphan の実行時再現なし。  
**なぜ Important か（1次 M2 を UPGRADE）:** 案 B の「並列中は両 docker 子へ」契約の唯一の動的経路が意図的にスキップされており、`for_each_child_pid` 退行でも success argv 比較と単 project signal テストは緑のまま。  
**Pri M2 と統合。** Pri M3（exit 優先 dual 未踏）も同一 tooling 拡張で閉じられる。

### I2 — process 間では serial が効かず生成密集が 2 倍同時化し得る

**判定: CONFIRMED · Important residual（コード欠陥ではなく負荷/主張）**

| 主張 | live evidence |
| --- | --- |
| serial files | `e2e/specs/` で `mode: "serial"`: generation-recovery-results, full-journey, history-regeneration, history-safety-change, shopping-list-races, billing-plus（6 本） |
| Playwright serial の範囲 | process / worker 内のみ。別 `docker compose run` = 別 Playwright process |
| workers×2 | `playwright.config.ts` L8–17: 明示コメント「実効ブラウザ並列は最大 workers×2」、`workers: 2` |
| 単一行ロック | migration 例: `ai_global_daily_usage ... for update`（`20260726225640_...sql` L380–381 等）。docs L85 も「生成予約は直列化し得る」 |
| 壁時計 ≈ max | docs L82 が主張。L85 が AI 行ロックで崩れる旨を併記 — **条件付きで正しい** |

**修正は必須ではない。** 推奨は (a) docs の「≈ max」を非 AI 主因に限定して明確化、および/または (b) 実測 full で timeout 群発時に生成 file の project 間排他を検討。値の勝手な timeout 締めは禁止（人間確認後）。

### I3 — 成果物分離（OUTPUT_DIR / HTML_REPORT）が tooling 未検証

**判定: CONFIRMED gap · DOWNGRADE Important → Minor（Pri M1 と統合）**

| 層 | live evidence |
| --- | --- |
| shell 前置き | `run-e2e.sh` L439–450: mobile/desktop 各 `KONDATE_E2E_OUTPUT_DIR` / `HTML_REPORT` |
| compose 補間 | `compose.yaml` L198–201 |
| playwright 参照 | `playwright.config.ts` L19–27 |
| tooling pin | **無し。** `compose.test.mjs`「privilege-dropping entrypoint」L374–386 は user/entrypoint/LOCAL_* のみ。`KONDATE_E2E_*` を assert しない。docker mock は argv のみ（L119） |

**実装本線は正しい**（プロセス局所の前置き代入）。穴は退行検知。実害は artifact 上書き・診断困難が主で、suite 偽緑本線ではない → 1次の Minor が妥当。敵対的 Important は過大。

### I4 — 2 one-off e2e の cleanup 回収が dual 動的に未証明

**判定: PARTIALLY_CONFIRMED · DOWNGRADE Important → Minor residual**

| 主張 | live evidence |
| --- | --- |
| cleanup は service 名 1 回 | `run-e2e.sh` L283–296: `kill --signal SIGKILL e2e` / `rm --force e2e` 各 1 回 |
| container_name 固定なし | `compose.yaml` e2e に `container_name` 無し（grep 0） |
| dual body 失敗後 kill の mock | 到達しない（I1 と同じく setup fail-closed / success 時は kill 省略） |

Compose v2 が service ラベル配下の multiple one-off を kill するのは通常動作。**未実証だが反証材料も無く、実装 API 選択は正しい。** Important 固定は「証明不足」を欠陥扱いに寄せすぎ。残 residual として dual 中断 fixture は価値あるが必須ブロッカーではない。

---

## 確定 Important（ブロッカー候補）

実装差し戻し必須の **ブロッカー Important は無し**。以下は **信頼 residual / follow-up 候補**:

1. **I1 ∪ Pri M2（UPGRADE）— dual-child シグナル・wait 集約の tooling 欠落**  
   - mock で setup 成功後、body 2 本を待機させ、親 SIGTERM 後に両 e2e 相当 PID 終了を assert。  
   - 任意で mobile 非 0 / desktop 0 の exit 優先（Pri M3）を同 path で固定。

2. **I2 — process 間 serial 非効 + AI 行ロック下の壁時計条件付き**  
   - コード変更必須ではない。docs 主張の明確化と、実測 flaky 時の project 間排他検討。

---

## 確定 Minor

| 統合 ID | 内容 |
| --- | --- |
| **Pri M1 ∪ Adv I3** | compose e2e env と `test-results/{mobile,desktop}-chromium` prefix を tooling で pin |
| **Pri M3** | mobile 優先 exit の dual body 回帰なし（I1 拡張で可） |
| **Pri M4 ∪ Adv M1** | `scripts/reset-e2e-ai-quota.sh` L9–10「mobile 完了後にも」が嘘。開始時 1 回のみ（`run-e2e.sh` L574, L622） |
| **Pri M5** | `installDockerRecorder` の `index.lock` 未 rmdir。`readDockerInvocations` は `/^\d+$/` のみなので比較は安全 |
| **Adv M2** | `launch_in_progress` 死旗（L50, 226–230, 436–455。読取箇所 0） |
| **Adv M3** | `run_playwright` がホスト export の `KONDATE_E2E_*` を unset しない；list reporter 2 本 stdout 混線（CI は exit 依存） |
| **Adv I4** | dual cleanup 動的未証明（Compose 1 回 kill 慣習） |

---

## 棄却 / ダウングレード

| 元 | 二次 | 理由 |
| --- | --- | --- |
| Adv I3 Important | **Minor** | 成果物分離の **実装は成立**。欠落は pin のみ。偽緑本線ではない |
| Adv I4 Important | **Minor residual** | service-level kill は正しい Compose API。反証なし・実証バグなし |
| Pri M2 Minor | **Important**（UPGRADE） | dual 契約の動的ガードが意図的に無い点は Important residual |
| 中間 reset 廃止 → 即枯渇 | **棄却（容量）** | `compose.e2e.yaml` `GLOBAL_DAILY_AI_LIMIT: "500"` + suite 開始 truncate 1 回。競合待ちは I2 |
| mobile 失敗を desktop が上書き | **棄却** | L475–479 |
| storageState 同時書込 | **棄却** | setup 直列；reused は billing-plus 表示系のみ |
| container_name 衝突 | **棄却** | 未設定 |
| canonicalize が setup を並べ替え | **棄却** | body project 述語限定 |

---

## 統合 residual

1. **dual signal / dual fail cleanup の動的未証明**（I1, I4）— 設計は妥当、実行証明なし  
2. **生成密集 × project 並列 × 単一行 FOR UPDATE**（I2）— flaky / 壁時計が max でなく和に寄る区間  
3. **成果物 env 退行を tooling が止めない**（M1/I3）  
4. **隣接コメント陳腐化**（reset ヘッダ、死旗 `launch_in_progress`）  
5. **ホスト export / ログ混線**（M3）— 通常 wrapper 内では問題にならない edge  
6. **同一 SHA full 実測・Compose CLI 版差** — 本二次も未実行。実測 red 群発時は I2 再評価  

---

## 推奨アクション（優先度付き）

| 優先 | アクション | 実装する？ |
| --- | --- | --- |
| **P1** | full（project 未指定）で setup 成功 → body 2 待機 → 親 signal → 両 child 終了を tooling 化（I1）。任意で mobile fail 優先 exit（M3） | **推奨（follow-up）**。案 B クローズの必須条件ではないが、信頼を大きく上げる |
| **P2** | `compose.test.mjs` で e2e env に `KONDATE_E2E_OUTPUT_DIR` / `HTML_REPORT` の default 補間を pin。任意で run-e2e に `test-results/mobile-chromium` 等の文字列 pin（M1/I3） | **推奨（安価）**。すぐやる価値あり |
| **P3** | `reset-e2e-ai-quota.sh` ヘッダを「suite 開始時のみ。中間 reset 廃止。E2E GLOBAL=500」に更新（M4）。docs「≈ max」を非 AI 主因 + 行ロック注記で一本化（I2） | **推奨（docs/コメントのみ）** |
| P4 | `launch_in_progress` 削除 or 実読取（M2）；mock lock `rmdir`（M5）；setup 前の `KONDATE_E2E_*` unset（M3） | 任意 nit |
| P5 | 生成 file の project 間 mutex / suite 分割 | **いまはしない**。full 実測で timeout 群発が出たら I2 再レビュー |

---

## クローズ可否

| 観点 | 結論 |
| --- | --- |
| 実装本線（案 B） | **クローズ可** |
| Critical / 実証バグ | **なし** |
| 1次 APPROVE_WITH_NITS | **概ね支持**（M2 のみ Important residual へ格上げ） |
| 敵対的 PASS_WITH_RESIDUALS | **支持**（I3/I4 は Minor へ下げる。I1/I2 は residual Important として残す） |
| 次作業 | 必須コード修正なし。P1–P3 を任意 follow-up。実測 full は人間/Verifier 領域 |

**最終ラベル:** **PASS_WITH_RESIDUALS**（差し戻しなし。Important residual 2 = dual signal tooling + process 間生成競合/主張）
