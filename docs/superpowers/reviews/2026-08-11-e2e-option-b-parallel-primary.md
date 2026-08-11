# E2E Option B (mobile||desktop 並列) 1次レビュー

**対象 commit:** `06ad4ef4a1b0c52133d4e1da298b08813725c4ae`  
**題:** feat(e2e): full で mobile と desktop を同一 wrapper 内並列起動する（案 B）  
**Worktree:** `/home/dev/projects/kondate`  
**判定:** APPROVE_WITH_NITS  
**Critical:** 0 / **Important:** 0 / **Minor:** 5

読み取り根拠: `git show` 相当の当該コミット差分と、変更 7 ファイルの現行内容（編集なし）。

---

## 要約

案 B の中核は diff 上で満たされている。

| 意図 | 実装根拠 |
| --- | --- |
| full（`--project` 未指定）で setup 1 回直列 → mobile\|\|desktop 同一 wrapper 並列 | `run-e2e.sh` `run_e2e_commands`: setup の後 `run_playwright_mobile_desktop_parallel`；`playwright.config.ts` に `dependencies` なし |
| 壁時計 ≈ max(mobile, desktop) | 両 `docker compose run` を `&` 起動してから順に `wait`（収穫順だけで実行は並列） |
| 中間 AI 枠 reset 廃止 | suite 開始の `reset-e2e-ai-quota.sh` 1 回のみ；`expectedE2EInvocations` も `quotaReset` 1 回；旧直列+中間 reset パターンを `compose.test.mjs` が `doesNotMatch` |
| 成果物 project 分離 | 並列起動時に `KONDATE_E2E_OUTPUT_DIR` / `KONDATE_E2E_HTML_REPORT` を prefix；`compose.yaml` e2e が補間してコンテナへ；`playwright.config.ts` が env 参照 |
| シグナルは両 docker 子へ | `for_each_child_pid` + `child_pids`；grace/ALRM/2 回目 KILL も同経路 |
| smoke / 明示 `--project` は 1 process | smoke 分岐と `e2e_args_have_project` 分岐が `run_playwright` 単発のまま |
| 製品 GLOBAL=20 / preflight 非接触 | `compose.yaml` app の `"20"` 維持；E2E 上書きは既存 `compose.e2e.yaml` `"500"`；本 diff は e2e サービス env 追加のみ |
| wrapper 多重禁止 | `.run-e2e.lock` / `try_acquire_lock` 不変；docs も「別 wrapper 拒否・wrapper 内並列は想定内」 |

実装を壊し得る Critical/Important（偽緑・枠破壊・シグナル孤児・setup 二重・dependsOn 復活・製品枠変更）は、対象 diff からは検出できなかった。残るのは tooling ピンの穴・並列専用シグナルの単体未カバー・関連スクリプトのコメント陳腐化など Minor と residual である。

---

## Findings

### Critical

（なし）

### Important

（なし）

### Minor

#### M1. 成果物分離（compose env / 並列 prefix）が tooling で固定されていない

- **場所:** `compose.yaml` e2e.environment / `scripts/run-e2e.sh` `run_playwright_mobile_desktop_parallel` / `tests/tooling/compose.test.mjs`（e2e サービス assert）
- **Why it matters:** 並列時の test-results / html report 競合防止が案 B の明示要件。`compose.yaml` の `KONDATE_E2E_*` 行や run-e2e の prefix を落としても、現行 `compose.test.mjs` の e2e サービス検査（user/entrypoint/LOCAL_* のみ）と docker 引数ログ（env 非記録）では検知できない。実害は主に artifact 上書きと診断困難で、偽緑より運用 nit。
- **Evidence:**  
  - 実装は `compose.yaml` L198–201 と `run-e2e.sh` L439–451 で分離している。  
  - `compose.test.mjs`「runs e2e through the same privilege-dropping entrypoint」は `KONDATE_E2E_OUTPUT_DIR` / `HTML_REPORT` を assert しない。  
  - docker mock は argv のみ記録し、prefix env は `expectedE2EInvocations` に出ない。
- **Suggested fix:** `compose.test.mjs` で e2e environment に  
  `KONDATE_E2E_OUTPUT_DIR: "${KONDATE_E2E_OUTPUT_DIR:-test-results}"` 等を pin。任意で run-e2e 文字列に `test-results/mobile-chromium` / `desktop-chromium` の存在を pin。

#### M2. 並列中の dual-child シグナル配送が単体テスト未カバー

- **場所:** `scripts/run-e2e.sh` `for_each_child_pid` / `run_playwright_mobile_desktop_parallel`；`tests/tooling/local-development-scripts.test.mjs` の signal 系（`--project=mobile-chromium` 固定）
- **Why it matters:** 案 B の「並列中は両 docker 子へ配送」は実装上 `child_pids` 経由で妥当に見えるが、signal / force-kill / cleanup の既存テストは意図的に単一 project に閉じている。将来 `for_each_child_pid` を単一 PID のみに戻しても signal テストは緑のまま。
- **Evidence:**  
  - 実装: `deliver_signal` → `for_each_child_pid`；並列開始後 `child_pids="$mobile_pid $desktop_pid"`；mobile wait 後は desktop のみに縮小。  
  - テスト: `E2E runner restores the base stack after every forwarded signal` 等が `e2eArgs = ["--project=mobile-chromium"]` とコメント「dual mobile/desktop 分岐を避ける」。
- **Suggested fix:** mock で full（project 未指定）成功待ち中に wrapper へ SIGTERM し、2 本の e2e `run` 待機プロセスへ配送されたこと（または両 index が終了したこと）を 1 ケース追加。timeout/grace は既存どおり短く。

#### M3. mobile 優先 exit 集約の回帰テストがない

- **場所:** `scripts/run-e2e.sh` L475–480；`expectedE2EInvocations` の failure 経路
- **Why it matters:** コメント契約は「mobile 非 0 を優先、次に desktop」。実装は単純で正しそうだが、failure 用 mock（`E2E_STATUS`）は先頭 e2e＝setup に効くため、並列 body 両方を走らせたうえで mobile 失敗を優先する経路は単体で踏まれない。
- **Evidence:**  
  - 実装: mobile_status → desktop_status の順で return。  
  - `expectedE2EInvocations(..., cleanupE2EContainers=true)` は full 失敗時 `playwrightRuns = [setupRun]` のみ（setup fail-closed）。  
  - 成功 full は mobile+desktop の 2 body を期待し `canonicalizeE2EInvocations` で順不同を吸収。
- **Suggested fix:** mock で setup 成功後、mobile/desktop の index ごとに異なる `E2E_STATUS`（または `DOCKER_FAIL_AT`）を返し、exit が mobile 側になることだけでも固定する。

#### M4. `reset-e2e-ai-quota.sh` ヘッダコメントが中間 reset 前提のまま（対象 diff 外）

- **場所:** `scripts/reset-e2e-ai-quota.sh` L9–10（本 commit の変更ファイル外）
- **Why it matters:** 「mobile 完了後にも本スクリプトを呼ぶ」は案 B 以前の契約。実装（run-e2e 開始時 1 回）と docs/local-development は一致しているが、隣接スクリプトの説明が嘘のまま残り、後続 agent が中間 reset を「復活すべき」と誤読し得る。
- **Evidence:**  
  - `reset-e2e-ai-quota.sh`: 「スイート開始時に加え、mobile 完了後にも」。  
  - `run-e2e.sh` L16 / L622: 中間 reset なしを明記；呼び出しは L574 の 1 回のみ。
- **Suggested fix:** ヘッダを「suite 開始時のみ（project 境界 reset は廃止。E2E は GLOBAL_DAILY=500）」に更新。本 commit の必須修正ではない。

#### M5. docker mock の index 原子化は良いが lock dir を残す

- **場所:** `tests/tooling/local-development-scripts.test.mjs` `installDockerRecorder`（`mkdir "$DOCKER_LOG_DIR/$index.lock"`）
- **Why it matters:** 並列 docker の index 競合防止としては正しい。lock dir は解放されないが、`readDockerInvocations` が `/^\d+$/` のみ読むため比較は壊れない。tmp fixture 破棄前提の nit。
- **Evidence:** L116–119 で lock mkdir、write 後に `rmdir` なし；L201–203 で numeric のみ filter。
- **Suggested fix:** 任意で write 後に `rmdir "$DOCKER_LOG_DIR/$index.lock"`。実害なしなら放置可。

---

## 確認済みの良い点

1. **setup 二重なし / dependsOn なし**  
   shell が `--project=setup` を fail-closed で 1 回；`playwright.config.ts` に `dependencies` なし；`e2e_args_only_setup_project` で setup 単独デバッグの二重起動を回避。

2. **wait / status 集約**  
   両プロセスを最後まで走らせてから status を見る（片方が先に落ちても他方を打ち切らない）。exit は mobile 非 0 優先 → desktop → 0。`termination_status` があればそれを優先（`run_child` と同型）。

3. **child_pids ライフサイクル**  
   起動直後に両 PID 登録 → mobile wait 後は desktop のみ → `clear_child_pids` → `cancel_watchdog`。シグナル配送対象が「生きている所有子」に追従する。

4. **lock と cleanup**  
   checkout lock は wrapper 単位のまま（並列は 1 wrapper 内）。失敗/中断時の `kill`/`rm` e2e サービス名回収と、成功時 `--rm` 前提の非 kill は従来契約を維持。CI restore 省略・SKIP_RECREATE 拒否も維持。

5. **AI 枠**  
   製品 compose `GLOBAL_DAILY_AI_LIMIT: "20"` 不変；E2E 500 は既存 override；e2e ツリーの per-test truncate 禁止 tooling が並列関数名まで更新済み；開始時 reset 1 回が `expectedE2EInvocations` 配列で構造的に固定。

6. **tooling 契約の追随**  
   - `canonicalizeE2EInvocations` / `assertE2EInvocationsEqual` で body run 順不同を吸収。  
   - docker mock index の mkdir 原子化。  
   - 旧 `run_playwright mobile → reset → run_playwright desktop` の退行を `doesNotMatch`。  
   - smoke / 明示 project / 先頭 `--` 剥がしの期待が並列化後も整合。

7. **ドキュメント**  
   `docs/local-development.md` が full 並列・成果物パス・reset 1 回・workers×2・別 wrapper 禁止と一致。製品 20 / E2E 500 表も維持。

8. **storageState 読み取り共有**  
   setup が並列前に `e2e/.auth/user.json` を書く；本体は read-only。`billing-plus` は表示 + `page.route` かつ file serial。破壊的系は ephemeral のまま（本 diff 外の既存設計）。

9. **単一 project の既定パス**  
   `run_playwright` は env 未設定時 compose 既定 `test-results` / `playwright-report`；playwright.config の `??` フォールバックと一致。

---

## 未検証（このレビューが実行していないこと）

- `./scripts/run-e2e.sh` 実 full / smoke の壁時計・flaky（real Docker / Playwright 未実行）
- 並列中 SIGINT の実コンテナ回収（kill e2e が one-off 2 本を同時に止めることの runtime 確認）
- workers×2 process 下での global AI 行ロック待ち・auth メールバーストの実測
- `format:check` / `lint` / `typecheck` / `node --test tests/tooling/*` の実行（静的読取のみ）
- `git push` / deploy / 本番 preflight の実行（対象外・禁止事項）

---

## residual（推測・既知制約。Finding 非カウント）

- 生成系は `private.ai_global_daily_usage` 単一行ロックのため、project 並列でも予約は直列化し得る（docs 記載済み。壁時計短縮は UI 系が主）。
- 同一 storageState ユーザを mobile/desktop が同時に開くのは案 B で新たに重なり得るが、reused 利用は現状 billing-plus（表示系）に限定。
- ホストに `KONDATE_E2E_OUTPUT_DIR` が export されたまま単一 `--project` 実行すると既定パスが上書きされる（運用 edge）。
- `scripts/reset-e2e-ai-quota.sh` コメント陳腐化は M4 参照（diff 外）。
