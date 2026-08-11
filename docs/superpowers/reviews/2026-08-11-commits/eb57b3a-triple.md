# Triple review: `eb57b3a`

**SHA:** `eb57b3a0b87ce73af16733cb6246e7580aa52b16`  
**Subject:** `feat(e2e): setup project と storageState で認証を再利用する`  
**Parent:** `508c6bd`  
**Worktree:** `/home/dev/projects/kondate`  
**Diff authority:** `.superpowers/sdd/review-508c6bd..eb57b3a.diff`  
**重点:** storageState 競合、dependsOn 二重 setup

---

## 1次レビュー

### 要約

Spec §6.3 の採用モデルどおり、Playwright `dependencies` / `dependsOn` を使わず、`run-e2e.sh` が setup project を **1 回** fail-closed で実行して `e2e/.auth/user.json` を書く。表示系 `billing-plus` のみ `reusedCompletedPage` に移行。

### 変更面

| ファイル | 内容 |
| --- | --- |
| `playwright.config.ts` | `setup` project（`testMatch: /auth\.setup\.ts$/`）。mobile/desktop に dependencies **なし** |
| `e2e/specs/auth.setup.ts` | magic-link → seed → `storageState` 保存 |
| `e2e/fixtures/session-auth.ts` | `STORAGE_STATE_PATH` + `reusedCompletedPage` |
| `.gitignore` | `e2e/.auth/` |
| `scripts/run-e2e.sh` | setup 前置 + `e2e_args_only_setup_project` で二重回避 |
| `billing-plus.spec.ts` | 全 7 test → `reusedCompletedPage` |
| tooling | `compose` / `local-development-scripts` が setup 段を固定 |

### Spec §6.3 チェック

| 項目 | 判定 | 根拠 |
| --- | --- | --- |
| shell が setup 1 回 | **OK** | `run_playwright --project=setup \|\| return $?` の後に smoke/full 本体 |
| dependencies なし | **OK** | config に `dependencies` キー無し。コメントで明示 |
| setup 失敗 fail-closed | **OK** | `\|\| return $?`。tooling も失敗時は setup のみ想定 |
| `--project=setup` のみ二重なし | **OK** | `e2e_args_only_setup_project` |
| gitignore `e2e/.auth/` | **OK** | `.gitignore` 追加 |
| tracked なら tooling fail | **未** | Spec 文言あり。本 commit では gitignore のみ（I4 residual） |
| reused ≥1 ファイル | **OK** | `billing-plus` 表示・route mock のみ |
| setup email 一意 | **OK** | `Date.now()` 付き。固定 email の seed 衝突を回避 |

### Findings

#### Important

**I-smoke. smoke が reused 未使用なのに setup を常時実行**  
**Confidence: 92**

- Spec §6.3 smoke 枝: setup は「reused fixture を使う smoke がある場合」。
- 実装は suite 種別に関係なく setup 前置。`billing-plus` は `@smoke` 外（full-only）。
- 正しさ破壊は低。短縮目的への **純粋コスト逆行**。§6.6 必須ではないが Important residual。

**I-track. Spec「tracked なら tooling fail」未実装**  
**Confidence: 86**

- gitignore のみ。`git add -f` を機械的に拒否できない。
- セッショントークン成果物のため Spec が tooling を求めた意図は妥当。

#### Minor

- 素 Playwright で `reusedCompletedPage` を叩くと storageState ENOENT（意図的 fail-closed、サポート経路は `run-e2e.sh`）。
- workers=1 のため `billing-plus` の file serial は未設定でも当面安全（Phase 3 前）。
- setup が使う seed は親 `508c6bd` の portion/spice 欠落を **継承**（本 diff の新バグではないが storageState ユーザも生成契約不完全）。

### 重点

| 焦点 | 結果 |
| --- | --- |
| storageState 競合 | **反証（意図どおり）** — shell 1 writer。mobile/desktop は読取のみ。`dependencies` 無し。only-setup デバッグで二重書込回避。unique email |
| dependsOn 二重 setup | **反証** — `dependencies` 未使用。shell × Playwright 二重を only-setup 分岐で防止 |
| seed と safety | 本 diff は seed 本体非変更。setup 経由で seed を呼ぶ → 親 I1 継承 |
| AI truncate 位置 | 本 diff 非対象 |

### 1次判定: **APPROVE_WITH_CONDITIONS**

setup モデル本体は正しい。I-smoke / I-track は residual。親 I1 は seed 修正コミットで閉じる前提。

---

## 敵対的レビュー

### 攻撃シナリオ

| # | シナリオ | 判定 | 根拠 |
| --- | --- | --- | --- |
| A1 | mobile+desktop が `dependencies: ["setup"]` で setup 二重 → storageState 競合 | **反証** | dependencies なし。shell のみ 1 回 |
| A2 | full 二段実行で setup が 2 回 | **反証** | setup は body の前に 1 回。mobile→desktop は本体のみ |
| A3 | `--project=setup` デバッグ + 通常 wrapper で二重 | **反証** | only_setup_project 早期 return |
| A4 | 固定 email で seed insert 衝突 | **反証** | ランごと一意 email |
| A5 | reused ユーザで破壊的課金 UI が DB を汚す | **現行反証** | billing-plus は page.route mock + 表示。コメントで ephemeral へ戻す注意 |
| A6 | storageState が git に入る | **gitignore 成立 / tooling 未** | A-track residual |
| A7 | setup 失敗後も本体が走る | **反証** | `\|\| return $?` |
| A8 | smoke が setup 失敗で全体死ぬが smoke は setup 不要 | **コスト + 失敗表面増** | I-smoke。壊しは setup 自体の flaky 依存 |
| A9 | `auth.setup.ts` が mobile/desktop の `*.spec` に混入 | **反証** | `testMatch` が setup のみ。ファイル名 `.setup.ts` で default match 外 |

### 敵対判定: **PASS_WITH_RESIDUALS**

Critical な storageState 競合・dependsOn 二重・破壊的 reused 適用は成立しない。residual は smoke コストと tracked tooling。

---

## 2次検証

| 主張 | 判定 | live / package 根拠 |
| --- | --- | --- |
| dependencies なし | **CONFIRMED** | playwright.config setup only testMatch |
| shell setup 1 回 fail-closed | **CONFIRMED** | run-e2e + tooling golden |
| only_setup 二重回避 | **CONFIRMED** | `e2e_args_only_setup_project` |
| billing reused 範囲 | **CONFIRMED** | 表示 + mock。account-deletion 等は ephemeral のまま |
| gitignore | **CONFIRMED** | `e2e/.auth/` |
| I-smoke | **CONFIRMED residual** | 常時 setup。§6.6 外 → hard gate 過大にしない |
| I-track | **CONFIRMED residual** | tooling 未 |
| Critical 過大なし | **CONFIRMED** | 双方 Critical 空が妥当 |

### 2次最終: **APPROVE_WITH_RESIDUALS**

- setup / storageState 実行モデルは **合格**。
- residual: smoke setup コスト、tracked auth tooling、親 seed I1 継承。

---

## 統合結論

| 軸 | 結果 |
| --- | --- |
| Critical | 0 |
| Important residual | smoke 常時 setup / tracked tooling / 親 seed 継承 |
| **Verdict** | **APPROVE_WITH_RESIDUALS**（実行モデル健全） |

PRIMARY_ADVERSARIAL_SECONDARY_COMPLETE
