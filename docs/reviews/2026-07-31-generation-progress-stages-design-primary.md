# 一次レビュー: 献立作成中の段階進捗表示 設計

| 項目 | 値 |
|------|-----|
| 対象 | `docs/superpowers/specs/2026-07-31-generation-progress-stages-design.md`（`e7d5bd8`） |
| 日付 | 2026-07-31 |
| 種別 | 設計書の一次レビュー（read-only・実装しない） |
| 判定 | **Approve with changes** |
| 二次検証 | `docs/reviews/2026-07-31-generation-progress-stages-design-secondary.md` |
| 敵対的 | `docs/reviews/2026-07-31-generation-progress-stages-design-adversarial.md` |

**照合した正本・実装**

- 対象設計: `docs/superpowers/specs/2026-07-31-generation-progress-stages-design.md`
- UI: `src/features/generation/components/generation-status-panel.tsx`
- 状態機械: `src/features/generation/model/generation-machine.ts`
- 復旧: `src/features/generation/hooks/use-generation-recovery.ts`
- 契約: `shared/contracts/generation.ts`（processing + `startedAt`）
- a11y: `src/app/accessibility.test.tsx` L565–593
- panel 試験: `generation-status-panel.test.tsx`（`NOW` + 古い `startedAt`）
- MVP: 生成状態 UI・根拠のない進捗率非表示

---

## Verdict: **Approve with changes**

方針 A（クライアント経過時間・契約非変更・`submitting`/`processing` のみ）はコード実態と整合する。主待ちが同期 POST 中の `submitting` である認識も `use-generation-recovery` と一致する。

実装計画に進む前に、**sticky アンカー**・**同期初期評価**・**フック配線**・**既存 a11y/panel テスト追随**を設計本文（または plan の Locked interfaces）に固定すること。

---

## Findings table

| ID | Severity | Section | Title |
|----|----------|---------|-------|
| D1 | **Critical** | §3.3 / §4.2 | `anchorMs: null` の sticky 未定義で submitting が elapsed≈0 固定になり得る |
| D2 | Important→**Minor**（二次） | §4.2 / §4.3 | フックが文言だけ返すと `data-progress-stage` と L1 が不一致になり得る |
| D3 | **Important** | §4.3 | early-return 構造に対するフック呼び出し位置が未ロック |
| D4 | **Important** | §6 / §7 | `accessibility.test.tsx` が未記載で、現行固定 copy assert が実装直後に壊れる |
| D5 | **Important** | §6.1 | panel テストの frozen `NOW` + 古い `startedAt` で常に最終帯になる指針がない |
| D6 | Minor→**Reject**（二次） | §3 / 現状 copy | processing 現行文面との差分は表置換として意図的 |
| D7 | **Minor** | ヘッダ / §10 | 「Approved」と「最終確認」のプロセス表現が食い違う |

---

## Detailed findings

### [D1] sticky アンカー未定義 — **Critical**

**Where:** §3.3 L2、§4.2 `anchorMs: number | null` と「null で now フォールバック」。

**Why:** 主待ちは POST 完了まで `submitting`。`elapsed = now - (anchorMs ?? Date.now())` を毎 tick 評価すると常に ≈0 で stage0 固定。受け入れ「10 秒で AI 帯へ」が死ぬ。

**Required lock:** submitting は phase 入場時に 1 回 `Date.now()` を capture。`null→now` は sticky（毎 tick 差し替え禁止）。`active` false→true または submitting 再入場でのみリセット。

---

### [D2] フック API と `data-progress-stage` — **Minor**（二次で降格）

**Where:** §4.2 戻り値が文言のみ、§4.3 `data-progress-stage` は任意。

**Why:** コアは message だけで足りる。index を付けるなら戻り値を `{ message, stageIndex }` に揃えるとよいが、任意属性前提では Important 未満。

---

### [D3] Rules of Hooks / パネル配線 — **Important**

**Where:** `generation-status-panel.tsx` の phase 早期 return（L220–）。

**Why:** 分岐内だけで hook を呼ぶと Rules of Hooks 違反。`active` を片 phase だけ true にすると L1（前進のみ）も壊れる（敵対的 D-I3 と一体）。

**Required lock:** phase 分岐**前**で常に  
`active = phase === "submitting" || phase === "processing"` で単一 hook。submitting→processing で active を落とさない。

---

### [D4] a11y テスト未棚卸し — **Important**

**Where:** `src/app/accessibility.test.tsx` L591–593。旧 processing 固定文 + `startedAt: 2026-07-11`（fake timers なし）→ 実装後は常に stage4。

**Why:** §6/§7 に無く、フル `vitest run` で落ちる。ランタイム欠陥ではないが実装 Task の必須変更。

**Required lock:** §7 に変更対象として追加。固定旧文言を相対時刻 or stage 非依存 assert に更新。

---

### [D5] panel テストの時刻前提 — **Important**

**Where:** `generation-status-panel.test.tsx` の `NOW = 2026-07-20` + `startedAt = 2026-07-11`。

**Why:** 新規の段階 assert を足すと常に最終帯。相対 `startedAt`（`NOW - 0` / `-10s` / `-60s`）を §6.1 に書く。

---

### [D6] 現行 processing copy との差 — **Reject**

§4.3 が進捗1行の置換を明記。L3 の表が正。意図的。

---

### [D7] 承認状態の表記 — **Minor**

ヘッダ Approved と §10「最終確認」の整理。

---

## What the design gets right

1. サーバ status に下位ステージが無い認識が契約と一致。
2. 主待ち = `submitting`（同期 POST）の切り分けが実装と一致。
3. 所有境界・L6（契約/DB/Function 非変更）が明確。
4. L1 前進のみは phase 跨ぎに必要。
5. a11y 方針（単一 `role="status"` + polite）と完了％非採用が MVP と整合。
6. プライバシー L8。
7. E2E 時間 assert を必須にしない判断が健全。

---

## 再レビュー条件

二次検証の統合 ID（V-C1 / V-C2 / V-I1〜I4）を設計または plan Locked interfaces に反映した差分。
