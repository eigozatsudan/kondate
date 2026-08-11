# Triple review: `6de1354` feat(e2e): KONDATE_E2E_SUITE で smoke/full を切り替える

- **Full SHA:** `6de13543e9f5b94839f5f3724e44f985d5f2d34c`
- **Parent:** `0842d22d1f9f77d13f99d5f04e28dde6b4d3e222`
- **種別:** 実装（`scripts/run-e2e.sh` + tooling。CI workflow の PR=smoke は **まだ**）
- **差分の核:**
  - `KONDATE_E2E_SUITE=full|smoke`（未設定 full）。不正値 exit 2
  - smoke: mobile 1 段 + `--grep=@smoke`（`--project`/`--grep` 既存時は二重付与しない）
  - full: 従来の mobile → quota reset → desktop
  - `e2e_args_have_grep` 追加
  - `expectedE2EInvocations` の suite 分岐、compose 文字列ピン、`e2e-smoke-tags.test.mjs` 新規（本数ガード）
- **重点:** smoke が desktop を踏む / 空タグ green / suite 誤解釈 / tooling と shell 乖離

---

## 1次レビュー

### Summary

Plan Task 3 の完成形に沿う。smoke は **desktop 段と project 境界 reset を踏まない**。`set --` で portable に引数組立（Plan 断片の unquoted 展開を避けている）。`e2e-smoke-tags` が §4.2 必須ファイル×最低本数を固定し、account-deletion/billing の `@smoke` 0 も固定。320 household の ternary 文字列もピン。

**CI はまだ full 既定のまま**（次の 657b845）。ローカルで `KONDATE_E2E_SUITE=smoke` が可能になる。

### Verdict: **APPROVE_WITH_NITS**

### Findings

#### Critical

（なし — 切替ロジックの破壊的欠陥は見えない）

#### Important

| ID | 内容 |
| --- | --- |
| F1 | smoke ガードが **リテラル出現回数**のみ。`tag: ["@smoke","@smoke"]` やコメント水増し、wrong-title 付け替えで min を満たせる（false green 耐性不足） |
| F2 | `@mobile-only` は `≥1` のみ — 幅マトリクス全件を強制しない |
| F3 | `e2e_args_have_grep` は `-g=pattern` 連結形を未検出（稀）。単独 `-g` 値無しで `@smoke` 付与抑止し得る |

#### Minor

| ID | 内容 |
| --- | --- |
| M1 | caller が任意 `--grep` を付けると smoke 名と実フィルタが乖離（意図的・明示優先） |
| M2 | docs 未更新（5c68150 担当） |

---

## 敵対的レビュー

### Summary

smoke で全件 or 0 件 green、full が壊れ desktop が消える、tooling だけ green を突く。

### Attack scenarios

| # | 攻撃 | 判定 |
| --- | --- | --- |
| 1 | smoke でタグ 0 → exit 0 | **反証** — pass-with-no-tests 無し。0 件は非 0 exit |
| 2 | smoke で desktop 二段 | **反証** — smoke 枝は 1 回 `run_playwright` 後 return |
| 3 | 不正 suite が silent full | **反証** — case で full\|smoke 以外 return 2 |
| 4 | `--project` 二重 | **反証** — has_project 時は付与しない |
| 5 | expectedE2EInvocations が shell と乖離 | **本線は固定** — smoke golden が argv deepEqual 方向 |
| 6 | 本数だけ満たす薄い smoke | **成立（ガード弱）** — F1 |
| 7 | CI がまだ full のまま | **この commit では正しい中間** — 657b845 前は PR も full |

### Findings

#### Critical

（なし）

#### Important

- **I1:** count ベース smoke ガード（F1 と同）
- **I2:** mobile-only ≥1（F2 と同）
- **I3:** 先頭 `--` strip 無し — この commit の docs も未更新だが、開発者慣習で 1 ファイル起動が壊れる residual（後の 5c68150 で docs が悪化し、33c10be で strip）

#### Minor

- M1/M2 同上

---

## 2次検証

### Cross-walk

| 指摘 | 判定 |
| --- | --- |
| smoke 1 段 + `@smoke` | **PASS** |
| 不正 suite exit 2 | **PASS** |
| 二重 project/grep 抑止 | **PASS** |
| full 二段維持 | **PASS**（この時点の直列 full） |
| F1/F2 ガード弱 | **CONFIRMED residual** — 33c10be で強化 |
| Critical 切替バグ | **無しで一致** |

### Must-fix

**なし**（CI 切替前の中間として green 可能。ガード強化は follow-up）。

### Final: **APPROVE_WITH_NITS**

**理由:** suite 切替本線は Spec §4.3 どおり。false green 本命は **薄い/誤 title smoke の静的ガード弱さ**で、実行時 0 件 green ではない。

TRIPLE_REVIEW_COMPLETE
