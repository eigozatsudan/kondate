# Triple review: `54f6ba1`

**SHA:** `54f6ba1ba1ae61e02d05420450ff74f978488add`  
**Subject:** `test(e2e): 案 B P1–P3 dual signal tooling と成果物 pin・docs 修正`  
**Parent:** `7efeea9`  
**Scope:** `tests/tooling/local-development-scripts.test.mjs`, `compose.test.mjs`, `e2e-ai-quota-parallel.test.mjs`, `scripts/reset-e2e-ai-quota.sh`, `docs/local-development.md` 等（案 B secondary 推奨 P1–P3）。

---

## 1次レビュー

### Summary

option-b secondary の推奨 follow-up を実装:

| P | 内容 | live 根拠 |
| --- | --- | --- |
| **P1** | dual body signal: setup 成功 → body 2 待機 → 親 signal → 両 PID 死亡 | `forwards signal to both mobile and desktop body processes` + `E2E_WAIT_SKIP_FIRST` / `E2E_BODY_READY_DIR` |
| **P1b** | mobile 非 0 優先 / desktop fail 経路 | `prefers mobile non-zero…` / `returns desktop status when mobile…` |
| **P2** | 成果物 env pin | `compose.test.mjs` KONDATE_E2E_* 既定補間 + run-e2e prefix 文字列 |
| **P3** | reset ヘッダ / docs 壁時計主張の明確化 | `reset-e2e-ai-quota.sh` 案 B 契約; `local-development.md` 非 AI ≈ max + 行ロック |

`expectedE2EInvocations` に `bodyRan` を追加し、dual body 失敗後の argv 集合を固定。docker mock が project 別 `E2E_STATUS_MOBILE/DESKTOP` と並列 index 原子化を持つ。

製品 20 非接触。workers/truncate ゲート維持。

### Findings

| Sev | ID | 内容 |
| --- | --- | --- |
| Critical | — | なし |
| Important | — | なし（I1 本線を閉じた） |
| Minor | M1 | dual **force-kill / watchdog ignore** は依然 `--project=mobile-chromium` 単一。2 本同時 ignore は未演習。 |
| Minor | M2 | dual interrupted 後の `compose kill e2e` が両 one-off を回収する動的証明は弱い（service-level kill 慣習 + bodyRan 時 kill 期待は argv レベル）。 |
| Minor | M3 | I2 process 間生成競合 / 行ロックは設計 residual のまま（意図どおり未 mutex）。 |
| Minor | M4 | `launch_in_progress` 死旗は任意 nit のまま。 |

### Verdict (1次): **APPROVE_WITH_NITS**

---

## 敵対的レビュー

| # | 攻撃 | 判定 |
| --- | --- | --- |
| 1 | dual signal tooling を bypass して for_each_child_pid 退行 | **反証（本線）** — dual signal テストが両 PID 死亡を要求 |
| 2 | mobile fail を desktop 成功で上書き | **反証** — 明示 status テスト |
| 3 | 成果物 prefix 削除で両 process が同一 dir | **反証（静的）** — compose/run-e2e pin |
| 4 | 中間 reset 復活コメントで誤誘導 | **反証** — reset ヘッダ更新済み |
| 5 | 製品 20 / workers 20 偽緑 | **反証** — 本 diff 非破壊 + 既存ゲート |
| 6 | mock が body 2 を待たず偽緑 | **低 residual** — `waitForReadyPids(dir, 2)` 必須 |
| 7 | parallel orphan が force-kill 経路のみ残る | **部分 residual（M1）** — 通常 1 回 signal は dual で閉じた |

### Verdict (敵対): **PASS_WITH_RESIDUALS**（C0 / I0; Minor residual のみ）

---

## 2次検証

| 主張 | 二次 |
| --- | --- |
| I1 closed | **CONFIRMED** — dual signal + mobile prefer exit |
| P2 pin | **CONFIRMED** |
| P3 docs/reset ヘッダ | **CONFIRMED** |
| I2 未解消 | **CONFIRMED intentional residual** |
| 製品 20 | **CONFIRMED PASS** |
| option-b secondary クローズ条件 | **充足**（推奨 P1–P3 完了） |

### Verdict (2次): **APPROVE_AS_IS**（ブロッカーなし）

---

## 既存結論との照合

| 既存 | 本 triple |
| --- | --- |
| option-b secondary P1–P3 推奨 | **本 commit が実装** — 矛盾なし |
| option-b adv I1 Important | **当該 SHA 以降 CLOSE**（実装 residual ではなくゲート充足） |

---

## 最終判定

| 軸 | 結果 |
| --- | --- |
| 製品 quota 20 | **非接触** |
| parallel orphan | **通常 dual signal は tooling で証明**；force-kill dual は Minor residual |
| workers 偽緑 | **非接触・既存封じ** |
| **総合** | **APPROVE_WITH_NITS** |
