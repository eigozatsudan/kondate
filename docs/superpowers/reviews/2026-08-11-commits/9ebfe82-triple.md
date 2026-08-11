# Triple review: `9ebfe82`

**SHA:** `9ebfe8297495acdf262f50554f95a3ba1a4dfa8b`  
**Subject:** `fix(e2e): Phase2 レビュー指摘を反映し seed と setup を直す`  
**Parent:** `ab45e94`  
**Child (next):** `98e3519`（Phase 3 Task 9 — E2E GLOBAL 上書き）  
**Worktree:** `/home/dev/projects/kondate`  
**Diff authority:**  
- Phase 2 package 状態（`ab45e94`）対比 + 修正後 leaf（seed / run-e2e / tooling）  
- 進捗: `.superpowers/sdd/progress.md` — *Phase2 impl review+fix … fixed; commit 9ebfe82*  
- 専用 `review-ab45e94..9ebfe82.diff` は worktree に無し。leaf 照合で再構成  
**重点:** seed と safety 修正、setup/smoke、storageState tooling

---

## 1次レビュー

### 要約

Phase 2 実装レビュー（1次 REVISE / 敵対 BLOCK_WITH_CONDITIONS / 2次 FIX_THEN_OK）の **must-fix** を閉じる修正コミット。

| p2 ID | 指摘 | 本 commit での扱い |
| --- | --- | --- |
| **I1 / P0** | seed に portion/spice なし | **修正** — adult 既定 `regular`/`regular` + 生成契約コメント |
| **I2** | smoke が reused 無しで setup 常時 | **修正** — smoke は setup 省略（reused が smoke に載るまで） |
| **I4 / P1** | tracked `e2e/.auth` tooling fail | **部分** — `project-config` で gitignore 必須化。`git ls-files` は app に git が無いため見送りコメント |
| **I3** | regen ensure | **未**（defer 可のまま） |
| **M1/M2** | profile 0 行 / planner 弱 assert | **未**（defer） |

### 修正 leaf（照合）

#### 1. `e2e/fixtures/seed-onboarding.ts`

```ts
// portion_size / spice_level は DB CHECK では任意だが
// requireCompleteMember / complete_household_member は非 null 必須
portion_size: "regular",
spice_level: "regular",
```

- `defaultsForAgeBand("adult")` と一致。
- UI 再編集に頼らない seed 意味を回復。

#### 2. `scripts/run-e2e.sh`

- smoke 分岐: setup 前置を **外し**、mobile + `@smoke` のみ。
- コメント: reused が smoke に載ったら setup を戻す。
- full のみ `run_playwright --project=setup \|\| return $?`。
- `e2e_args_only_setup_project` / dependencies なしは維持。

#### 3. tooling

- `local-development-scripts.test.mjs`: smoke = setup **省略** にゴールデン更新。
- `project-config.test.mjs`: `e2e/.auth/` が `.gitignore` に必須。tracked `ls-files` はコメントで非実施理由を固定。

### Findings（本 commit 後の残渣）

#### Important residual（非ブロッキング）

**R1. tracked `e2e/.auth` の `git ls-files` fail は未**  
gitignore assert は force-add を止めきれない。Spec §6.3 完全文言より弱いが、主ゲートは ignore 必須化で改善。

**R2. I-regen / M1 / M2 は未着手**  
Phase 2 二次の defer 一覧どおり。実害低。

#### Minor

- smoke 省略は Spec 括弧条件と整合。reused を smoke に載せ忘れた場合の検知はコメント依存。

### 重点

| 焦点 | 結果 |
| --- | --- |
| storageState 競合 | モデル不変。smoke が setup を書かない → full 専用 writer のまま。競合リスク **増えない** |
| dependsOn 二重 setup | 不変・無し |
| seed と safety | **I1 閉鎖**。privacy / service role 境界は維持 |
| AI truncate 位置 | 本 commit 非対象（`ab45e94` のまま） |

### 1次判定: **APPROVE**

p2 hard must-fix（I1）と重要な residual（I2）を閉じた。R1 は Important 低め residual。

---

## 敵対的レビュー

### 攻撃シナリオ

| # | シナリオ | 判定 | 根拠 |
| --- | --- | --- | --- |
| A1 | portion/spice 修正漏れで生成契約なお不一致 | **反証** | insert に regular/regular。generation-context と RPC が要求する non-null を満たす |
| A2 | 誤った default（例: child small）で fixture 不整合 | **反証** | adult + 家族1 表示と UI adult defaults 一致 |
| A3 | smoke で setup 省略 → 将来 `@smoke`+reused が silent red | **残存（コメント依存）** | 現状 billing-plus は full-only。reused を smoke に載せる PR で setup 復帰が必要 |
| A4 | smoke 省略で setup 失敗を隠す | **反証** | smoke は setup 不要。full は依然 fail-closed setup |
| A5 | gitignore のみで `git add -f` が通る | **成立（R1）** | ls-files tooling 未。ignore 必須化で誤設定は検出 |
| A6 | setup モデル退行（dependencies 復活） | **反証** | 本 fix は smoke 分岐と seed が中心。dependencies 追加なし |
| A7 | seed が allergy を「安全」と誤保証 | **反証** | none は最低 seed。生成系は小麦等を別途付与 |

### 敵対判定: **PASS**

Critical なし。p2 BLOCK 条件（I1）は閉じた。R1 は低め residual。

---

## 2次検証

| p2 指摘 | 2次（本 commit 後） | 根拠 |
| --- | --- | --- |
| I1 portion/spice | **CLOSED** | seed insert + 契約コメント。adult defaults 一致 |
| I2 smoke setup | **CLOSED** | run-e2e smoke 省略 + tooling ゴールデン |
| I4 tracked tooling | **PARTIAL → residual R1** | gitignore 必須化あり。ls-files なし |
| I3 regen ensure | **OPEN defer** | ab45e94 と同じ |
| M1/M2 | **OPEN defer** | 未 |
| service role / privacy | **仍健全** | 変更なし・境界維持 |
| setup 二重 / dependsOn | **仍反証** | モデル不変 |
| Critical 過大なし | **CONFIRMED** | |

### 2次最終: **APPROVE**

- Phase 2 ゲート上の **FIX 必須（I1）は充足**。
- I2 も閉じた（二次が hard gate にしなかった項目だが修正済み）。
- R1/I3/M* は defer 可のまま Phase 3 以降へ。

---

## 統合結論

| 軸 | 結果 |
| --- | --- |
| Critical | 0 |
| Important closed | I1 seed portion/spice、I2 smoke setup |
| Important residual | R1 tracked ls-files 未、I3 regen ensure |
| **Verdict** | **APPROVE**（Phase 2 fix として完了） |

### Phase 2 コミット列との関係

| SHA | 役割 | 本 fix 後の位置づけ |
| --- | --- | --- |
| `508c6bd` | seed 導入 | I1 はここで入り、本 commit で閉鎖 |
| `eb57b3a` | setup/storageState | モデル健全。I2 は本 commit で閉鎖 |
| `ab45e94` | AI truncate 移動 | 中核健全。regen residual 継続 |
| **`9ebfe82`** | **レビュー修正** | Phase 2 完了の締め |

PRIMARY_ADVERSARIAL_SECONDARY_COMPLETE
