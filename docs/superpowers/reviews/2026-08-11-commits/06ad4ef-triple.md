# Triple review: `06ad4ef`

**SHA:** `06ad4ef4a1b0c52133d4e1da298b08813725c4ae`  
**Subject:** `feat(e2e): full で mobile と desktop を同一 wrapper 内並列起動する`（案 B）  
**Parent:** `a7d4bfd`  
**Scope:** `scripts/run-e2e.sh`, `playwright.config.ts`, `compose.yaml` e2e env, tooling, `docs/local-development.md`。  
**既存:** `docs/superpowers/reviews/2026-08-11-e2e-option-b-parallel-{primary,adversarial,secondary}.md`

---

## 1次レビュー

### Summary

full（`--project` 未指定）で setup 1 回直列 → `run_playwright_mobile_desktop_parallel` が mobile\|\|desktop を同一 wrapper 内 `&` 起動。中間 AI reset 廃止（開始 1 回 + E2E GLOBAL 500）。成果物 env 分離。`for_each_child_pid` で dual signal。exit は mobile 非 0 優先。smoke / 明示 project は単発。製品 GLOBAL=20 非接触。wrapper lock は 1 wrapper のまま。

### Findings

| Sev | ID | 内容 |
| --- | --- | --- |
| Critical | — | なし |
| Important | **I1** | dual mobile\|\|desktop の **シグナル配送・body 到達失敗**が tooling で意図的に単 project 回避（当該 SHA）。退行で success argv 比較は緑のまま。 |
| Important | **I2** | process 間では `describe.configure(serial)` が効かず、生成密集が 2 process 同時化し得る（設計/主張 residual。docs は行ロック認識あり）。 |
| Minor | M1 | 成果物 OUTPUT_DIR/HTML_REPORT の tooling pin 不足（実装は妥当）。 |
| Minor | M2 | mobile 優先 exit の dual body mock なし。 |
| Minor | M3 | `reset-e2e-ai-quota.sh` ヘッダが中間 reset 前提のまま（当該 SHA）。 |
| Minor | M4 | `launch_in_progress` 死旗 / ホスト export 汚染 edge。 |

### Verdict (1次): **APPROVE_WITH_NITS**（実装本線可; dual signal は Important residual）

> 既存 primary は Important=0。本 triple は **I1 を Important**（secondary の UPGRADE と一致）。**primary より厳格。**

---

## 敵対的レビュー

| # | 攻撃 | 判定 |
| --- | --- | --- |
| 1 | 中間 reset 廃止 → AI 枠枯渇 | **反証（容量）** — 500 + 開始 truncate。競合待ちは residual |
| 2 | Ctrl-C で片 orphan | **設計は dual PID / 動的未証明（I1）** |
| 3 | mobile 失敗を desktop 成功が上書き | **反証** — mobile_status 優先 |
| 4 | storageState 同時書込 | **反証** — setup 直列; reused は billing-plus 表示系 + serial |
| 5 | container_name 衝突 | **反証** — 未設定 |
| 6 | 製品 20 改変 | **反証** |
| 7 | per-test truncate 再導入 | **tooling 既存で封じ**（40baa1c 後） |
| 8 | workers:20 偽緑 | **反証**（行アンカー済み） |
| 9 | serial で process 間安全と主張 | **攻撃成功（過大主張）** → I2 |

### Verdict (敵対): **PASS_WITH_RESIDUALS**（C0 / I1–I2 / 実装即 FAIL なし）

---

## 2次検証

| ID | 二次 | 重大度 |
| --- | --- | --- |
| Adv I1 / Pri M2 | **CONFIRMED** | **Important residual**（後続 `54f6ba1` で close） |
| Adv I2 | **CONFIRMED** | **Important residual（設計）** — 必須コード変更なし |
| Adv I3 成果物 pin | **DOWNGRADE → Minor** | 実装分離妥当 |
| Adv I4 dual cleanup | **DOWNGRADE → Minor residual** | Compose service kill 慣習 |
| 製品 20 | **CONFIRMED PASS** | — |
| 既存 option-b secondary | **概ね一致** | |

### Verdict (2次): **PASS_WITH_RESIDUALS**（差し戻し不要。I1 follow-up 推奨）

---

## 既存結論との照合

| 既存 | 本 triple |
| --- | --- |
| option-b primary I0 | **矛盾（本 triple I1 Important）** — secondary 支持 |
| option-b adversarial I4 Important | **本 triple は Minor へ down** — secondary 支持 |
| option-b secondary PASS_WITH_RESIDUALS | **一致** |

---

## 最終判定

| 軸 | 結果 |
| --- | --- |
| 製品 quota 20 | **非接触** |
| parallel orphan | **設計 OK / 当該 SHA は dual signal tooling 欠落（I1）** |
| workers 偽緑 | **封じ済み（前段）** |
| **総合** | **PASS_WITH_RESIDUALS** → `54f6ba1` で I1/M1/M3 を埋める |
