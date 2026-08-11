# Triple review: `657b845` ci: PR の E2E を smoke、それ以外を full にする

- **Full SHA:** `657b8457a9e43e7ec569ede5c235f7acac9d95db`
- **Parent:** `6de13543e9f5b94839f5f3724e44f985d5f2d34c`
- **種別:** CI / ゲート配線
- **差分の核:**
  - `.github/workflows/ci.yml`: `KONDATE_E2E_SUITE: ${{ github.event_name == 'pull_request' && 'smoke' || 'full' }}`
  - `scripts/ci.sh`: `KONDATE_E2E_SUITE="${KONDATE_E2E_SUITE:-full}"`
  - 両系統の node:test 列挙に `e2e-smoke-tags.test.mjs`
  - privacy / mock / `PLAYWRIGHT_DISABLE_TRACE` は維持
- **重点:** 式の極性・PR が full のまま / push が smoke / smoke false green merge / ゲート順破壊

---

## 1次レビュー

### Summary

Spec §5.3 の CI 表どおり。`on:` が `pull_request` と `push: branches: [main]` のみなら式は PR→smoke、push→full。中間値 `'smoke'` は truthy で `&&`/`||` の落とし穴に当たらない。`ci.sh` は release 既定 full。`./scripts/run-e2e.sh` 呼び出しは維持 → 共有ゲート順テストと両立。

**設計 residual C1 がここで runtime 化:** PR green は smoke のみ。full は merge 後 push。891431e で文書化した運用前提が実装に載る。

### Verdict: **APPROVE_WITH_NITS**（設計 residual 付き）

### Findings

#### Critical

（なし — Spec 受容済みの merge-time 穴を **再導入した破壊バグではない**。ガードが極端に弱い場合のみ Important が Critical に昇格しうるが、当時の本数ガード + 正しいタグ付与で本線は成立。）

#### Important

| ID | 内容 |
| --- | --- |
| F1 | **設計 residual:** PR smoke ≠ acceptance 全量。account-deletion 等は PR 非実行。docs 注意は次 commit。branch protection は repo 外 |
| F2 | smoke 静的ガードが本数中心のまま（6de1354 から未強化）→ PR 経路で wrong-title false green の残存リスク |
| F3 | `project-config` が CI 式をピンする前提 — 式改変退行は tooling で検知する必要あり（実装後はピンあり） |

#### Minor

| ID | 内容 |
| --- | --- |
| M1 | `workflow_dispatch` 未定義 — 手動再実行は PR/push 経由のみ |
| M2 | docs がまだ smoke 注意を書いていない瞬間がある（次 5c68150） |

---

## 敵対的レビュー

### Summary

「PR を smoke にした」フリで full のまま / 逆極性 / privacy 外し / ゲート順スキップを突く。

### Attack scenarios

| # | 攻撃 | 判定 |
| --- | --- | --- |
| 1 | 式が常に full | **反証** — `event_name == 'pull_request' && 'smoke' \|\| 'full'` |
| 2 | 式が常に smoke（push も） | **反証** — push は PR でない → full |
| 3 | `&&`/`\|\|` で空文字 | **反証** — 中間 `'smoke'` truthy |
| 4 | E2E から privacy assert 削除 | **反証** — env 維持 |
| 5 | run-e2e を npx playwright 直に差し替え | **反証** — `./scripts/run-e2e.sh` 維持 |
| 6 | e2e-smoke-tags を CI 列挙から外す | **本 commit は追加**。外す退行は project-config ピンで後検知 |
| 7 | PR green だけで壊れた full を merge | **成立（設計 residual）** — Spec 受容。拡張 smoke で縮小済み |
| 8 | 薄い smoke セットで PR green | **ガード弱なら成立** — F2 |

### Findings

#### Critical

（なし — 式・privacy・wrapper 本線は健全）

#### Important

- **I1:** merge-time residual（F1）— コード欠陥ではなく運用条件
- **I2:** 本数ガードの false green（F2）
- **I3:** 当時の grepInvert 極性テスト跨ぎ residual（config は正しい）

#### Minor

- M1/M2

---

## 2次検証

### Cross-walk

| 指摘 | 判定 |
| --- | --- |
| PR=smoke / push=full 式 | **PASS** |
| ci.sh full 既定 | **PASS** |
| privacy / mock / trace off | **PASS** |
| e2e-smoke-tags を CI 実行 | **PASS** |
| C1 residual | **CONFIRMED as design, not regression** |
| F2 ガード | **CONFIRMED residual** |

### Must-fix

**なし**（Spec どおりの配線）。docs 注意とガード強化は後続。

### Final: **APPROVE_WITH_NITS**

**理由:** CI 切替は仕様通りで誤極性なし。残る Important は **既知の merge residual** と **smoke ガード強度**。

TRIPLE_REVIEW_COMPLETE
