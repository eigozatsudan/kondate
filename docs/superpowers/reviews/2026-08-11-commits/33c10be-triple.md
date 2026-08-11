# Triple review: `33c10be` fix(e2e): Phase1 レビュー指摘を反映しタグガードを強化する

- **Full SHA:** `33c10bef0f6cbee7455cc1e45beb46017ab2039a`
- **Parent:** `5c68150e0d8508c33ceb02f87f0f0f9f4a504768`
- **種別:** fix（tooling + runner DX。製品ランタイム非変更が主）
- **差分の核（live との差分から復元）:**
  1. `e2e-smoke-tags.test.mjs`: Spec §4.2 **required title 近傍に `@smoke`** を assert。`@mobile-only` を **定義数 ≥5** に引き上げ
  2. `project-config.test.mjs`: grepInvert を project ブロック単位で捕捉し極性 + 非共有を固定（跨ぎ false green 縮小）
  3. `run-e2e.sh`: 先頭の裸 `--` を 1 個 strip
  4. docs: 1 ファイル起動の `--` 無し形 / strip 説明の整合（live `local-development.md`）
- **重点:** ガード強化が十分か・過剰か・false green 残存・runner 退行

---

## 1次レビュー

### Summary

Phase 1 実装レビューの **F1/F2/I1/I2/I3** を直接潰す追補。

| 以前の穴 | 本 commit の応答 |
| --- | --- |
| smoke 本数のみ | title 断片 allowlist + 近傍 `@smoke` |
| mobile-only ≥1 | ≥ `mobileAccessibilityTestDefs`（5） |
| grepInvert 跨ぎ match | `use:[\s\S]*?grepInvert` を project 名直後ブロックで capture |
| docs `--` | wrapper strip + docs 両形 |

CI 本線（PR smoke / push full）やタグ付与そのものは壊していない。account-deletion 0 smoke 維持。

### Verdict: **APPROVE**

### Findings

#### Critical

（なし）

#### Important

| ID | 内容 |
| --- | --- |
| F1 residual | title 窓 ±400 と部分文字列 — 極端に離れた tag 配置や title 改名で brittle / すり抜けの余地は残る。distinct test 単位の AST までは未到達 |
| F2 residual | `countTagLiteral` は依然コメントにも反応。title 近傍テストが主防御 |

#### Minor

| ID | 内容 |
| --- | --- |
| M1 | `-g=*` 未検出は未修正（稀） |
| M2 | strip は先頭 1 個のみ — 意図的。中間の `--` は対象外 |

---

## 敵対的レビュー

### Summary

「ガード強化」ラベルで **まだすり抜けるか**、strip が smoke 引数を壊すか、title リストが不完全で必須 path が落ちるかを突く。

### Attack scenarios

| # | 攻撃 | 判定 |
| --- | --- | --- |
| 1 | 軽い test に `@smoke`、必須 title から外す | **本数は gre でも title 近傍で red** — 大幅改善。窓外に tag を置けば理論すり抜け |
| 2 | `tag: ["@smoke","@smoke"]` で本数 2 | title リストが別 test を要求すれば **足りない title で red** |
| 3 | mobile-only を 1 本だけ残す | **≥5 で red** |
| 4 | grepInvert 極性逆転 | ブロック単位 capture + notEqual で **検知改善**。use 無し異常整形は別 |
| 5 | strip が `--grep=@smoke` を落とす | **反証** — 先頭トークンがちょうど `--` のときだけ |
| 6 | strip 後に path が option 扱い | path は位置引数 — 意図どおり改善 |
| 7 | title リストに無い必須を漏らす | 現行リストは §4.2 主要 exact title を網羅。追加 path 時はリスト更新必須 |
| 8 | acceptance `${String(width)}` title 破壊 | 断片がソースリテラルどおり — verify と両立 |

### Findings

#### Critical

（なし）

#### Important residual

- **I1:** ±400 窓と非 AST — 高度なすり抜けは残るが **意図的/事故的ドリフトの本命は塞いだ**
- **I2:** merge residual（PR smoke ≠ full）は設計のまま — 本 commit の対象外

#### Minor

- M1/M2

---

## 2次検証

### Cross-walk（Phase1 bulk 指摘 → 本 commit）

| Phase1 ID | 本 commit | 二次判定 |
| --- | --- | --- |
| F2 / I1 wrong-title green | title 近傍 | **CLOSED 本命** / residual 窓 |
| F1 / I4 mobile-only ≥1 | ≥5 | **CLOSED** |
| I2 grepInvert 跨ぎ | ブロック capture | **CLOSED 本命** |
| I3 docs `--` | strip + docs | **CLOSED** |
| I5 design residual | 非対象 | 残置（正しい） |
| F3 実測証跡 | 非コード | プロセス — 本 commit 非対象 |

### Must-fix

**なし。**

### Final: **APPROVE**

**理由:** Phase 1 の tooling/DX 指摘を適切に閉じ、CI 本線を壊さない。残 residual は高度すり抜けと設計受容のみ。

TRIPLE_REVIEW_COMPLETE
