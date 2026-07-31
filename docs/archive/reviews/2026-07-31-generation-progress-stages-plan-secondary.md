# 二次検証: 実装計画レビュー `2026-07-31-generation-progress-stages.md`

| 項目 | 値 |
|------|-----|
| 対象計画 | `docs/archive/superpowers/plans/2026-07-31-generation-progress-stages.md`（`80f69c8`） |
| 一次 | `docs/archive/reviews/2026-07-31-generation-progress-stages-plan-primary.md` |
| 敵対的 | `docs/archive/reviews/2026-07-31-generation-progress-stages-plan-adversarial.md` |
| 日付 | 2026-07-31 |
| 種別 | 一次・敵対的 finding の独立二次検証（read-only） |
| 判定 | **Important 改訂後に実装開始可**（Critical 0） |

二次は finding 一覧と **リポジトリ実測**（`npm run typecheck` / `eslint`）で判定した。

---

## 1. 一次 finding

| ID | 二次 Status | 統合 severity |
|----|-------------|---------------|
| P1 phase narrowing Critical | **REJECT** | — |
| P2 本番 `!` lint | **CONFIRMED** | **Important** |
| P3 panel テスト行列 | **CONFIRMED** | **Important** |

### P1 Reject の根拠

`src/features/generation` に plan 同一パターンを置き `npm run typecheck`:

```ts
const phase = state.phase;
const progressAnchorMs =
  phase === "processing" ? state.data.startedAt : null;
```

→ **narrow-check エラーなし**（TS 5.9.3）。  
無ガードの `state.data.startedAt` だけは `TS2339` になることを対照確認。

→ 「写経すると typecheck 必敗」は **本環境では不成立**。Critical にしない。  
（`state.phase === "processing"` 直書きはスタイル推奨に留める。）

### P2 Confirm

```text
eslint: Forbidden non-null assertion (@typescript-eslint/no-non-null-assertion)
```

`strictTypeChecked` 既定 + test のみ off。計画本番の `[0]!` は Task 3 `lint` で落ちる。**Important 妥当。**

### P3 Confirm

設計 §6.1 の 0/10s/60s 帯・unmount が plan 追加 it に不足。**Important 妥当。**

---

## 2. 敵対的 finding

| ID | 二次 Status | 統合 severity |
|----|-------------|---------------|
| D-C1 narrowing Critical | **REJECT**（P1 と同じ） | — |
| D-I1 panel L1 跨ぎ | **CONFIRMED** | **Important** |
| D-I2 §6.1 行列 | **CONFIRMED**（P3 とマージ） | **Important** |
| D-I3 Step 手順 | **DOWNGRADE** | **Minor** |
| D-M1 soft typecheck | **CONFIRMED** | **Minor** |
| D-M2 StrictMode | **CONFIRMED** | **Minor**（R8） |
| Infinity→0 / 旧 startedAt 破壊 | **Reject 維持**（欠陥ではない） | — |

### D-I1 Confirm

hook の L1 試験は panel 配線バグを検知しない。visibility→processing は recovery 実経路。  
**panel `rerender` it は Must。**

---

## 3. 統合 finding 表（実装前ゲート）

| ID | 由来 | Severity | 要約 | plan 改訂 |
|----|------|----------|------|-----------|
| **V-I1** | P2 / D-I4 | **Important** | 本番から `!` を除去（`stageMessageAt` 等） | **Must** |
| **V-I2** | D-I1 | **Important** | submitting→processing panel `rerender` L1 it | **Must** |
| **V-I3** | P3 / D-I2 | **Important** | processing 相対 0/10s/35s/60s + unmount timer 0 | **Must** |
| **V-M1** | D-I3 | Minor | Task 3 の panel RED と a11y 置換を Step 分割 | Should |
| **V-M2** | D-M1 | Minor | Task 2 typecheck 期待を PASS のみに | Should |
| **V-M3** | D-M2 | Minor | StrictMode / R8 を plan に一文 | Optional |
| — | P1 / D-C1 | Reject | narrowing Critical は実測不成立 | No |

**追加 Critical なし。**

---

## 4. Exact locks（plan 改訂文言）

### V-I1 — `!` 禁止

Task 1 実装を例えば次に置換（全文を plan に載せる）:

```ts
function stageMessageAt(index: number): string {
  const stage = GENERATION_PROGRESS_STAGES[index] ?? GENERATION_PROGRESS_STAGES[0];
  if (stage === undefined) {
    return "条件を確認しています";
  }
  return stage.message;
}
```

`selectGenerationProgressMessage` / hook は `stageMessageAt` のみ使い `!` を書かない。  
Task 1 または Task 2 の verify に `npm run lint` を追加してもよい。

### V-I2 — panel L1 跨ぎ

```ts
it("keeps progress stage when phase moves submitting → processing", () => {
  const { rerender } = render(
    <GenerationStatusPanel state={{ phase: "submitting", effect: "submit" }} />,
  );
  act(() => {
    vi.setSystemTime(new Date(NOW.getTime() + 10_000));
    vi.advanceTimersByTime(1_000);
  });
  expect(screen.getByRole("status")).toHaveAttribute("data-progress-stage", "2");

  const processingData: Extract<GenerationStatusData, { status: "processing" }> = {
    status: "processing",
    idempotencyKey: KEY,
    requestId: REQUEST_ID,
    startedAt: new Date(NOW.getTime() + 10_000).toISOString(),
    quota,
  };
  rerender(
    <GenerationStatusPanel
      state={{ phase: "processing", data: processingData, effect: "poll" }}
    />,
  );
  expect(screen.getByRole("status")).toHaveAttribute("data-progress-stage", "2");
  expect(screen.getByRole("status")).toHaveTextContent("AI に献立案を聞いています");
});
```

### V-I3 — 相対行列 + unmount

```ts
it.each([
  [0, 0, "条件を確認しています"],
  [10_000, 2, "AI に献立案を聞いています"],
  [35_000, 3, "組み合わせと段取りを整えています"],
  [60_000, 4, "仕上げの確認をしています"],
] as const)("processing startedAt NOW-%s → stage %s", (agoMs, stage, message) => {
  // ... render processing with startedAt: new Date(NOW.getTime() - agoMs).toISOString()
  // expect status text + data-progress-stage
});

it("clears progress interval on unmount", () => {
  const { unmount } = render(
    <GenerationStatusPanel state={{ phase: "submitting", effect: "submit" }} />,
  );
  unmount();
  expect(vi.getTimerCount()).toBe(0);
});
```

---

## 5. 総合判定

| 項目 | 結論 |
|------|------|
| 計画の方向 | **健全**（設計ロック・TDD 全文） |
| Critical ブロッカー | **なし**（narrowing は棄却） |
| このまま実装開始 | **非推奨** — V-I1〜V-I3 を plan に吸収してから |
| 設計のやり直し | **不要** |

**Verdict:** V-I1 / V-I2 / V-I3 を計画本文に反映した r1 のあと、writing-plans 実行（subagent-driven / inline）に進んでよい。
