# 献立作成中の段階進捗表示（体感用） Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `submitting` / `processing` 待ち中に、経過時間に応じた日本語の段階メッセージを切り替え、「止まっている」感を減らす（サーバ stage なし）。

**Architecture:** 純関数の段階表 + sticky アンカー付きフック（同期初期評価・L1 前進のみ・1000ms interval）+ `GenerationStatusPanel` 先頭での単一 hook 配線。契約・DB・Function は触らない。

**Tech Stack:** React 19 / TypeScript strict / Vitest / RTL / fake timers

**仕様書:** `docs/archive/superpowers/specs/2026-07-31-generation-progress-stages-design.md`（Approved・レビュー改訂済み、L0–L14）  
**設計レビュー:** `docs/archive/reviews/2026-07-31-generation-progress-stages-design-primary.md` / `-adversarial.md` / `-secondary.md`  
**計画レビュー:** `docs/archive/reviews/2026-07-31-generation-progress-stages-plan-primary.md` / `-adversarial.md` / `-secondary.md`  
→ **本版 r1 で V-I1〜V-I3 / V-M1〜V-M2 を吸収**

## Plan revision summary (r1)

| ID | 反映 |
|----|------|
| V-I1 | 本番から `!` 除去。`stageMessageAt` + リテラル fallback。Task 1 に lint |
| V-I2 | panel: submitting→processing `rerender` で L1 非後退 it を全文追加 |
| V-I3 | processing 相対 `it.each`（0/10s/35s/60s）+ unmount で `vi.getTimerCount()===0` |
| V-M1 | Task 3: panel RED と a11y 置換を Step 分離 |
| V-M2 | Task 2 typecheck 期待を PASS のみ |
| V-M3 | Global Constraints に StrictMode / R8 一文 |
| P1/D-C1 | narrowing Critical は TS 5.9.3 実測で棄却。配線は `state.phase` 直書きを推奨形として固定 |

## Global Constraints

- Node.js `>=24 <25`。Node/npm は `docker compose run --rm --no-deps app ...`。**コマンドを `&&` / `;` で連結しない**（AGENTS.md）。
- RED → GREEN → focused verify → 日本語 Conventional Commit。**1 Task = 1 単位**（CLAUDE.md）。
- UI・コメント・コミットは日本語。識別子・テスト名は英語。`any` / 未検査 cast 禁止。
- **契約 / DB / Netlify Functions / status shape 変更禁止**（L6）。
- 検証は `format:check`（`format` の write は使わない）。
- `git push` / PR / 本番 deploy / `--no-verify` 禁止。
- プレースホルダ禁止: `// ...`、「同様に」「流用」だけのステップを置かない。
- 進捗にプロンプト・生 AI・内部用語を出さない（L7/L8）。完了％バー禁止（L4）。
- **本番 `src/**` に non-null assertion (`!`) を書かない**（`@typescript-eslint/no-non-null-assertion`。test のみ off）。
- StrictMode 二重 mount で sticky が一瞬リセットされ得るのは設計 R8 許容。追加テスト不要。

## Locked interfaces produced by this plan

| 名前 | 場所 | 契約 |
|------|------|------|
| `GENERATION_PROGRESS_STAGES` | `model/progress-stages.ts` | §3 表と同一 5 要素。`afterMs` 昇順 |
| `stageMessageAt` | 同 | `(index: number) => string`。`!` なし。表外 index は stage0 文言 |
| `selectGenerationProgressStageIndex` | 同 | `(elapsedMs: number) => number`。負・非有限 → 0 |
| `selectGenerationProgressMessage` | 同 | `stageMessageAt(select…Index(elapsed))` |
| `resolveProcessingAnchorMs` | 同 | `(startedAt: string, nowMs: number) => number \| null`。NaN / 未来 5s 超 → null |
| `GENERATION_PROGRESS_TICK_MS` | `hooks/use-generation-progress-message.ts` | `1000` 固定 |
| `useGenerationProgressMessage` | 同 | 下表 Args / 戻り値。V-C1/V-C2/L1 |
| panel wiring | `generation-status-panel.tsx` | early return **前**で hook。`active = state.phase === "submitting" \|\| state.phase === "processing"`。`state.data` は `state.phase === "processing"` 直書きでアクセス |
| `data-progress-stage` | 進捗 `role="status"` 要素 | L1 後 `stageIndex` 必須 |

### 段階表（L3・再導出禁止）

| index | afterMs | message |
|------:|--------:|---------|
| 0 | 0 | 条件を確認しています |
| 1 | 3000 | 献立の指示を組み立てています |
| 2 | 8000 | AI に献立案を聞いています |
| 3 | 30000 | 組み合わせと段取りを整えています |
| 4 | 45000 | 仕上げの確認をしています |

### Hook 契約

```ts
export type GenerationProgressMessageArgs = {
  active: boolean;
  /** finite epoch ms、または null（sticky capture）。NaN を渡さない（panel が正規化） */
  anchorMs: number | null;
};

export type GenerationProgressView = {
  message: string;
  stageIndex: number; // L1 適用後
};

export function useGenerationProgressMessage(
  args: GenerationProgressMessageArgs,
): GenerationProgressView;
```

### Hook アルゴリズム（L9/L10・再導出禁止）

```text
resolvedAnchorMsRef, maxStageIndexSeenRef
on each render:
  if !active:
    clear resolvedAnchorMsRef; maxStageIndexSeenRef = 0
    return { message: stage0, stageIndex: 0 }
  now = Date.now()
  if anchorMs is finite AND anchorMs <= now + 5000:
    resolvedAnchorMsRef = anchorMs          // 外部有効値で上書き（submitting→processing）
  else if resolvedAnchorMsRef is null:
    resolvedAnchorMsRef = now               // sticky 1 回だけ（tick で差し替え禁止）
  elapsed = max(0, now - resolvedAnchorMsRef)
  calculated = selectGenerationProgressStageIndex(elapsed)
  stageIndex = max(calculated, maxStageIndexSeenRef)
  maxStageIndexSeenRef = stageIndex
  message = stageMessageAt(stageIndex)
  return { message, stageIndex }
useEffect when active:
  setInterval 1000ms → force re-render (setState tick)
  cleanup clearInterval
  active false: no interval
```

**禁止:** `elapsed = now - (anchorMs ?? Date.now())` を毎評価すること（elapsed≈0 固定）。  
**禁止:** 初回だけ stage0 を `useState` 初期値にし、1s 後まで直さないこと。  
**禁止:** 本番コードの non-null assertion (`!`)。

## File Structure

| ファイル | 責務 |
|----------|------|
| `src/features/generation/model/progress-stages.ts` | 表・`stageMessageAt`・選択・L2 正規化 |
| `src/features/generation/model/progress-stages.test.ts` | 境界・正規化 |
| `src/features/generation/hooks/use-generation-progress-message.ts` | sticky / 同期評価 / L1 / interval |
| `src/features/generation/hooks/use-generation-progress-message.test.tsx` | fake timers |
| `src/features/generation/components/generation-status-panel.tsx` | 配線・表示 |
| `src/features/generation/components/generation-status-panel.test.tsx` | 相対時刻・L1 跨ぎ・unmount |
| `src/app/accessibility.test.tsx` | processing status 追随 |
| 触らない | `shared/contracts/**`、`netlify/**`、`generation-machine.ts`、poll 2s |

---

### Task 1: 段階表純関数 + L2 正規化（`!` なし）

**Files:**
- Create: `src/features/generation/model/progress-stages.ts`
- Create: `src/features/generation/model/progress-stages.test.ts`
- Test: 同 test ファイル

**Interfaces:**
- Consumes: なし
- Produces: `GENERATION_PROGRESS_STAGES`, `stageMessageAt`, `selectGenerationProgressStageIndex`, `selectGenerationProgressMessage`, `resolveProcessingAnchorMs`

- [ ] **Step 1: 失敗するテストを書く**

Create `src/features/generation/model/progress-stages.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  GENERATION_PROGRESS_STAGES,
  resolveProcessingAnchorMs,
  selectGenerationProgressMessage,
  selectGenerationProgressStageIndex,
  stageMessageAt,
} from "./progress-stages";

describe("GENERATION_PROGRESS_STAGES", () => {
  it("locks five stages in ascending afterMs order with exact copy", () => {
    expect(GENERATION_PROGRESS_STAGES).toEqual([
      { afterMs: 0, message: "条件を確認しています" },
      { afterMs: 3_000, message: "献立の指示を組み立てています" },
      { afterMs: 8_000, message: "AI に献立案を聞いています" },
      { afterMs: 30_000, message: "組み合わせと段取りを整えています" },
      { afterMs: 45_000, message: "仕上げの確認をしています" },
    ]);
  });
});

describe("stageMessageAt", () => {
  it("returns stage 0 copy for out-of-range indexes without throwing", () => {
    expect(stageMessageAt(0)).toBe("条件を確認しています");
    expect(stageMessageAt(4)).toBe("仕上げの確認をしています");
    expect(stageMessageAt(99)).toBe("条件を確認しています");
    expect(stageMessageAt(-1)).toBe("条件を確認しています");
  });
});

describe("selectGenerationProgressStageIndex", () => {
  it.each([
    [0, 0],
    [2_999, 0],
    [3_000, 1],
    [7_999, 1],
    [8_000, 2],
    [29_999, 2],
    [30_000, 3],
    [44_999, 3],
    [45_000, 4],
    [120_000, 4],
    [-1, 0],
    [Number.NaN, 0],
    [Number.POSITIVE_INFINITY, 0],
  ] as const)("elapsed %s → index %s", (elapsed, index) => {
    expect(selectGenerationProgressStageIndex(elapsed)).toBe(index);
  });
});

describe("selectGenerationProgressMessage", () => {
  it("returns the message for the selected index", () => {
    expect(selectGenerationProgressMessage(10_000)).toBe("AI に献立案を聞いています");
    expect(selectGenerationProgressMessage(35_000)).toBe(
      "組み合わせと段取りを整えています",
    );
  });
});

describe("resolveProcessingAnchorMs", () => {
  const now = Date.parse("2026-07-31T12:00:00.000Z");

  it("returns parsed epoch for a valid past startedAt", () => {
    const started = "2026-07-31T11:59:25.000Z";
    expect(resolveProcessingAnchorMs(started, now)).toBe(Date.parse(started));
  });

  it("returns null for invalid startedAt", () => {
    expect(resolveProcessingAnchorMs("not-a-date", now)).toBeNull();
  });

  it("returns null when startedAt is more than 5s in the future", () => {
    expect(resolveProcessingAnchorMs("2026-07-31T12:00:10.000Z", now)).toBeNull();
  });

  it("accepts startedAt within 5s future skew", () => {
    const started = "2026-07-31T12:00:04.000Z";
    expect(resolveProcessingAnchorMs(started, now)).toBe(Date.parse(started));
  });
});
```

- [ ] **Step 2: テストを実行し、未実装で失敗することを確認する**

Run:

```bash
docker compose run --rm --no-deps app npm test -- --run src/features/generation/model/progress-stages.test.ts
```

Expected: FAIL（module not found または export 不足）

- [ ] **Step 3: 最小実装を書く（V-I1: `!` なし）**

Create `src/features/generation/model/progress-stages.ts`:

```ts
/**
 * 献立作成待ちの体感用段階表。
 * サーバ工程（プロンプト / OpenRouter / repair）と一致しない。契約・status には載せない。
 */

export type GenerationProgressStage = {
  readonly afterMs: number;
  readonly message: string;
};

export const GENERATION_PROGRESS_STAGES: readonly GenerationProgressStage[] = [
  { afterMs: 0, message: "条件を確認しています" },
  { afterMs: 3_000, message: "献立の指示を組み立てています" },
  { afterMs: 8_000, message: "AI に献立案を聞いています" },
  { afterMs: 30_000, message: "組み合わせと段取りを整えています" },
  { afterMs: 45_000, message: "仕上げの確認をしています" },
] as const;

/** stage0 と同じ文言。noUncheckedIndexedAccess 用のリテラル fallback（! 禁止）。 */
const FALLBACK_PROGRESS_MESSAGE = "条件を確認しています" as const;

/**
 * 段階 index から文言を返す。範囲外は stage0 文言。
 * 本番コードでは non-null assertion を使わない（V-I1）。
 */
export function stageMessageAt(index: number): string {
  const stage = GENERATION_PROGRESS_STAGES[index] ?? GENERATION_PROGRESS_STAGES[0];
  if (stage === undefined) {
    return FALLBACK_PROGRESS_MESSAGE;
  }
  return stage.message;
}

/** 経過 ms から段階 index を返す（L1 ガードなし。表示 max はフック側）。 */
export function selectGenerationProgressStageIndex(elapsedMs: number): number {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) {
    return 0;
  }
  let index = 0;
  for (let i = 0; i < GENERATION_PROGRESS_STAGES.length; i += 1) {
    const stage = GENERATION_PROGRESS_STAGES[i];
    if (stage === undefined) {
      break;
    }
    if (elapsedMs >= stage.afterMs) {
      index = i;
    } else {
      break;
    }
  }
  return index;
}

export function selectGenerationProgressMessage(elapsedMs: number): string {
  return stageMessageAt(selectGenerationProgressStageIndex(elapsedMs));
}

/**
 * processing の startedAt を hook 向け anchor に正規化する（V-I4 / L2）。
 * NaN または now より 5s 超未来は null（hook が sticky now にフォールバック）。
 * 遠過去はそのまま（最終帯になり得る・意図的）。
 */
export function resolveProcessingAnchorMs(startedAt: string, nowMs: number): number | null {
  const parsed = Date.parse(startedAt);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  if (parsed > nowMs + 5_000) {
    return null;
  }
  return parsed;
}
```

- [ ] **Step 4: テストが通ることを確認する**

Run:

```bash
docker compose run --rm --no-deps app npm test -- --run src/features/generation/model/progress-stages.test.ts
```

Expected: PASS

- [ ] **Step 5: lint（本番 `!` が無いこと）**

Run:

```bash
docker compose run --rm --no-deps app npm run lint -- --no-error-on-unmatched-pattern src/features/generation/model/progress-stages.ts
```

Expected: PASS（`no-non-null-assertion` 違反なし）

※ プロジェクトの lint CLI がファイル引数を受けない場合は次を使う:

```bash
docker compose run --rm --no-deps app npx eslint src/features/generation/model/progress-stages.ts
```

- [ ] **Step 6: Commit**

```bash
git add src/features/generation/model/progress-stages.ts src/features/generation/model/progress-stages.test.ts
git commit -m "feat: 献立作成待ちの体感用段階表と L2 正規化を追加"
```

---

### Task 2: 進捗メッセージフック（sticky / 同期評価 / L1）

**Files:**
- Create: `src/features/generation/hooks/use-generation-progress-message.ts`
- Create: `src/features/generation/hooks/use-generation-progress-message.test.tsx`
- Test: 同 test ファイル

**Interfaces:**
- Consumes: `stageMessageAt`, `selectGenerationProgressStageIndex`（Task 1）
- Produces: `GENERATION_PROGRESS_TICK_MS`, `GenerationProgressMessageArgs`, `GenerationProgressView`, `useGenerationProgressMessage`

- [ ] **Step 1: 失敗するテストを書く**

Create `src/features/generation/hooks/use-generation-progress-message.test.tsx`:

```tsx
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stageMessageAt } from "../model/progress-stages";
import {
  GENERATION_PROGRESS_TICK_MS,
  useGenerationProgressMessage,
} from "./use-generation-progress-message";

const NOW = Date.parse("2026-07-31T12:00:00.000Z");

describe("useGenerationProgressMessage", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns stage 0 when inactive", () => {
    const { result } = renderHook(() =>
      useGenerationProgressMessage({ active: false, anchorMs: null }),
    );
    expect(result.current).toEqual({
      stageIndex: 0,
      message: stageMessageAt(0),
    });
  });

  it("evaluates past anchor synchronously on first render without advancing timers (V-C2)", () => {
    const anchorMs = NOW - 35_000;
    const { result } = renderHook(() =>
      useGenerationProgressMessage({ active: true, anchorMs }),
    );
    expect(result.current.stageIndex).toBe(3);
    expect(result.current.message).toBe("組み合わせと段取りを整えています");
  });

  it("sticks null anchor and advances stages over wall time (V-C1)", () => {
    const { result } = renderHook(() =>
      useGenerationProgressMessage({ active: true, anchorMs: null }),
    );
    expect(result.current.stageIndex).toBe(0);

    act(() => {
      vi.setSystemTime(NOW + 3_000);
      vi.advanceTimersByTime(GENERATION_PROGRESS_TICK_MS);
    });
    expect(result.current.stageIndex).toBe(1);
    expect(result.current.message).toBe("献立の指示を組み立てています");

    act(() => {
      vi.setSystemTime(NOW + 10_000);
      vi.advanceTimersByTime(GENERATION_PROGRESS_TICK_MS);
    });
    expect(result.current.stageIndex).toBe(2);
    expect(result.current.message).toBe("AI に献立案を聞いています");
  });

  it("does not reset elapsed to zero on each tick when anchorMs is null", () => {
    const { result } = renderHook(() =>
      useGenerationProgressMessage({ active: true, anchorMs: null }),
    );
    act(() => {
      vi.setSystemTime(NOW + 10_000);
      vi.advanceTimersByTime(GENERATION_PROGRESS_TICK_MS);
    });
    expect(result.current.stageIndex).toBe(2);
    act(() => {
      vi.advanceTimersByTime(GENERATION_PROGRESS_TICK_MS);
    });
    expect(result.current.stageIndex).toBe(2);
  });

  it("never moves backward when anchor jumps forward (L1)", () => {
    const { result, rerender } = renderHook(
      ({ anchorMs }: { anchorMs: number | null }) =>
        useGenerationProgressMessage({ active: true, anchorMs }),
      { initialProps: { anchorMs: NOW - 40_000 as number | null } },
    );
    expect(result.current.stageIndex).toBe(3);

    rerender({ anchorMs: NOW });
    expect(result.current.stageIndex).toBe(3);
    expect(result.current.message).toBe("組み合わせと段取りを整えています");
  });

  it("keeps forward progress when switching from sticky null to startedAt=now", () => {
    const { result, rerender } = renderHook(
      ({ anchorMs }: { anchorMs: number | null }) =>
        useGenerationProgressMessage({ active: true, anchorMs }),
      { initialProps: { anchorMs: null as number | null } },
    );
    act(() => {
      vi.setSystemTime(NOW + 10_000);
      vi.advanceTimersByTime(GENERATION_PROGRESS_TICK_MS);
    });
    expect(result.current.stageIndex).toBeGreaterThanOrEqual(2);

    rerender({ anchorMs: Date.now() });
    expect(result.current.stageIndex).toBeGreaterThanOrEqual(2);
  });

  it("resets to stage 0 when becoming inactive", () => {
    const { result, rerender } = renderHook(
      ({ active }: { active: boolean }) =>
        useGenerationProgressMessage({ active, anchorMs: NOW - 40_000 }),
      { initialProps: { active: true } },
    );
    expect(result.current.stageIndex).toBe(3);

    rerender({ active: false });
    expect(result.current.stageIndex).toBe(0);
    expect(result.current.message).toBe(stageMessageAt(0));
  });
});
```

- [ ] **Step 2: テストを実行し、未実装で失敗することを確認する**

Run:

```bash
docker compose run --rm --no-deps app npm test -- --run src/features/generation/hooks/use-generation-progress-message.test.tsx
```

Expected: FAIL（module not found）

- [ ] **Step 3: 最小実装を書く（`stageMessageAt` のみ・`!` なし）**

Create `src/features/generation/hooks/use-generation-progress-message.ts`:

```ts
import { useEffect, useRef, useState } from "react";
import {
  selectGenerationProgressStageIndex,
  stageMessageAt,
} from "../model/progress-stages";

/** 経過再評価間隔（L12）。「約」ではない。 */
export const GENERATION_PROGRESS_TICK_MS = 1_000 as const;

export type GenerationProgressMessageArgs = {
  active: boolean;
  /**
   * finite な epoch ms、または null。
   * null = sticky クライアント now を 1 回 capture（tick 差し替え禁止・V-C1）。
   * processing は panel が resolveProcessingAnchorMs 済みの値を渡す。
   */
  anchorMs: number | null;
};

export type GenerationProgressView = {
  message: string;
  /** L1 適用後の表示 index */
  stageIndex: number;
};

function isUsableAnchor(anchorMs: number, nowMs: number): boolean {
  return Number.isFinite(anchorMs) && anchorMs <= nowMs + 5_000;
}

/**
 * 献立作成待ちの体感用進捗文言。
 * 同期初期評価（V-C2）・sticky null（V-C1）・前進のみ（L1）。
 */
export function useGenerationProgressMessage(
  args: GenerationProgressMessageArgs,
): GenerationProgressView {
  const { active, anchorMs } = args;
  const resolvedAnchorMsRef = useRef<number | null>(null);
  const maxStageIndexSeenRef = useRef(0);
  const [, setTick] = useState(0);

  // 描画ごとに同期計算する（初回を stage0 固定にしない・V-C2）
  let stageIndex = 0;
  let message = stageMessageAt(0);

  if (!active) {
    resolvedAnchorMsRef.current = null;
    maxStageIndexSeenRef.current = 0;
  } else {
    const nowMs = Date.now();
    if (anchorMs !== null && isUsableAnchor(anchorMs, nowMs)) {
      resolvedAnchorMsRef.current = anchorMs;
    } else if (resolvedAnchorMsRef.current === null) {
      resolvedAnchorMsRef.current = nowMs;
    }
    const resolved = resolvedAnchorMsRef.current ?? nowMs;
    const elapsedMs = Math.max(0, nowMs - resolved);
    const calculated = selectGenerationProgressStageIndex(elapsedMs);
    stageIndex = Math.max(calculated, maxStageIndexSeenRef.current);
    maxStageIndexSeenRef.current = stageIndex;
    message = stageMessageAt(stageIndex);
  }

  useEffect(() => {
    if (!active) {
      return undefined;
    }
    const id = window.setInterval(() => {
      setTick((n) => n + 1);
    }, GENERATION_PROGRESS_TICK_MS);
    return () => {
      window.clearInterval(id);
    };
  }, [active]);

  return { message, stageIndex };
}
```

- [ ] **Step 4: テストが通ることを確認する**

Run:

```bash
docker compose run --rm --no-deps app npm test -- --run src/features/generation/hooks/use-generation-progress-message.test.tsx
```

Expected: PASS

- [ ] **Step 5: typecheck + lint**

Run:

```bash
docker compose run --rm --no-deps app npm run typecheck
```

Expected: PASS

Run:

```bash
docker compose run --rm --no-deps app npx eslint src/features/generation/hooks/use-generation-progress-message.ts
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/features/generation/hooks/use-generation-progress-message.ts src/features/generation/hooks/use-generation-progress-message.test.tsx
git commit -m "feat: 献立作成進捗の sticky・同期評価フックを追加"
```

---

### Task 3: GenerationStatusPanel 配線 + panel / a11y テスト

**Files:**
- Modify: `src/features/generation/components/generation-status-panel.tsx`
- Modify: `src/features/generation/components/generation-status-panel.test.tsx`
- Modify: `src/app/accessibility.test.tsx`
- Test: 上記 test ファイル

**Interfaces:**
- Consumes: `useGenerationProgressMessage`, `resolveProcessingAnchorMs`（Task 1–2）
- Produces: submitting/processing の進捗1行 + `data-progress-stage`

- [ ] **Step 1: panel の失敗テストを追加する（a11y はまだ触らない・V-M1）**

`generation-status-panel.test.tsx` の既存 `NOW` / `beforeEach`（fake timers + `setSystemTime(NOW)`）を維持したまま、`describe("GenerationStatusPanel"` 内に次を追加する。

import に `act` が無ければ追加:

```ts
import { act, render, screen } from "@testing-library/react";
```

追加する it（全文）:

```ts
  it("shows sticky progress stages while submitting", () => {
    render(<GenerationStatusPanel state={{ phase: "submitting", effect: "submit" }} />);
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("条件を確認しています");
    expect(status).toHaveAttribute("data-progress-stage", "0");

    act(() => {
      vi.setSystemTime(new Date(NOW.getTime() + 10_000));
      vi.advanceTimersByTime(1_000);
    });
    expect(screen.getByRole("status")).toHaveTextContent("AI に献立案を聞いています");
    expect(screen.getByRole("status")).toHaveAttribute("data-progress-stage", "2");
  });

  it.each([
    [0, 0, "条件を確認しています"],
    [10_000, 2, "AI に献立案を聞いています"],
    [35_000, 3, "組み合わせと段取りを整えています"],
    [60_000, 4, "仕上げの確認をしています"],
  ] as const)(
    "processing startedAt NOW-%s → stage %s synchronously (V-I3)",
    (agoMs, stage, message) => {
      const processingData: Extract<GenerationStatusData, { status: "processing" }> = {
        status: "processing",
        idempotencyKey: KEY,
        requestId: REQUEST_ID,
        startedAt: new Date(NOW.getTime() - agoMs).toISOString(),
        quota,
      };
      render(
        <GenerationStatusPanel
          state={{ phase: "processing", data: processingData, effect: "poll" }}
        />,
      );
      const status = screen.getByRole("status");
      expect(status).toHaveTextContent(message);
      expect(status).toHaveAttribute("data-progress-stage", String(stage));
      expect(screen.getByRole("heading", { name: "献立を作っています" })).toBeVisible();
    },
  );

  it("keeps progress stage when phase moves submitting → processing (V-I2)", () => {
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
      // サーバ開始が「いま」に見えるアンカー → 計算上は stage0 だが L1 で stage2 を維持
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

  it("clears progress interval on unmount (V-I3)", () => {
    const { unmount } = render(
      <GenerationStatusPanel state={{ phase: "submitting", effect: "submit" }} />,
    );
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
```

既存 processing テストの `startedAt: "2026-07-11T00:00:00.000Z"` は**進捗 assert に使わない**（見出し・補足・onClear のまま残してよい）。

- [ ] **Step 2: panel テストを実行し、新規 it が失敗することを確認する**

Run:

```bash
docker compose run --rm --no-deps app npm test -- --run src/features/generation/components/generation-status-panel.test.tsx
```

Expected: 新規 it が FAIL（`data-progress-stage` 欠如 / 固定文言のまま）

- [ ] **Step 3: GenerationStatusPanel を配線する**

`generation-status-panel.tsx` の import に追加:

```ts
import { resolveProcessingAnchorMs } from "../model/progress-stages";
import { useGenerationProgressMessage } from "../hooks/use-generation-progress-message";
```

`export function GenerationStatusPanel(...)` 本体の**先頭**（最初の `if (state.phase === "checking")` より前）に（**`state.phase` 直書き**・V-I1 配線）:

```ts
  const progressActive =
    state.phase === "submitting" || state.phase === "processing";
  const progressAnchorMs =
    state.phase === "processing"
      ? resolveProcessingAnchorMs(state.data.startedAt, Date.now())
      : null;
  const { message: progressMessage, stageIndex: progressStageIndex } =
    useGenerationProgressMessage({
      active: progressActive,
      anchorMs: progressAnchorMs,
    });
```

**禁止:** `const phase = state.phase` に逃がしてから `state.data` に触る必要はないが、触る場合も `state.phase === "processing"` で narrow できる形を維持する。`as` / `any` 禁止。

`submitting` 分岐を置換:

```tsx
  if (state.phase === "submitting") {
    return (
      <div className="gen-status-panel" data-phase="submitting">
        <div className="gen-status-indicator" aria-hidden="true" />
        <p
          role="status"
          aria-live="polite"
          data-progress-stage={String(progressStageIndex)}
        >
          {progressMessage}
        </p>
      </div>
    );
  }
```

`processing` 分岐の進捗1行だけ置換（見出し・補足・RecoveryLinks はそのまま）:

```tsx
        <p
          role="status"
          aria-live="polite"
          data-progress-stage={String(progressStageIndex)}
        >
          {progressMessage}
        </p>
```

checking / offline / 終端では `progressMessage` を DOM に出さない。

- [ ] **Step 4: panel テストを通す**

Run:

```bash
docker compose run --rm --no-deps app npm test -- --run src/features/generation/components/generation-status-panel.test.tsx
```

Expected: PASS

- [ ] **Step 5: a11y の旧固定文言 assert を置換する（V-M1・配線後）**

`src/app/accessibility.test.tsx` の processing ケースを次に置換する（fake timers は使わず、**表のいずれかの文言**を許容し、見出しと axe を維持）:

```tsx
  it("generation processing exposes 献立を作っています heading or status", async () => {
    const startedAt = new Date().toISOString();
    const { container } = render(
      <main className="page-frame stack">
        <GenerationStatusPanel
          state={{
            phase: "processing",
            effect: "poll",
            data: {
              status: "processing",
              idempotencyKey: "key-1",
              requestId: "req-1",
              startedAt,
              quota: {
                consumed: false,
                remaining: 3,
                userDailyLimit: 3,
                limitKind: "user",
                retryAt: null,
              },
            },
          }}
        />
      </main>,
    );
    await expectAccessible(container);
    expect(screen.getByRole("heading", { name: "献立を作っています" })).toBeVisible();
    const status = screen.getByRole("status");
    expect(status).toBeVisible();
    // 旧固定文は廃止。段階表のいずれかの体感文言。
    expect(status.textContent ?? "").toMatch(
      /条件を確認しています|献立の指示を組み立てています|AI に献立案を聞いています|組み合わせと段取りを整えています|仕上げの確認をしています/,
    );
  });
```

- [ ] **Step 6: a11y テストを通す**

Run:

```bash
docker compose run --rm --no-deps app npm test -- --run src/app/accessibility.test.tsx
```

Expected: PASS

- [ ] **Step 7: 関連ユニット + ゲートをまとめて通す**

Run（1 コマンドずつ）:

```bash
docker compose run --rm --no-deps app npm test -- --run src/features/generation/model/progress-stages.test.ts src/features/generation/hooks/use-generation-progress-message.test.tsx src/features/generation/components/generation-status-panel.test.tsx src/app/accessibility.test.tsx
```

```bash
docker compose run --rm --no-deps app npm run typecheck
```

```bash
docker compose run --rm --no-deps app npm run lint
```

```bash
docker compose run --rm --no-deps app npm run format:check
```

```bash
git diff --check
```

Expected: すべて PASS

- [ ] **Step 8: Commit**

```bash
git add src/features/generation/components/generation-status-panel.tsx src/features/generation/components/generation-status-panel.test.tsx src/app/accessibility.test.tsx
git commit -m "feat: 献立作成中に体感用の段階進捗文言を表示する"
```

---

## Spec coverage (self-review)

| 設計要求 | Task |
|----------|------|
| §3 段階表 L3 | Task 1 |
| select index/message・負数/非有限 | Task 1 |
| resolveProcessingAnchorMs V-I4 | Task 1 |
| 本番 `!` 禁止 V-I1 | Task 1–2 |
| sticky null V-C1 L9 | Task 2 |
| 同期初期評価 V-C2 L10 | Task 2 |
| L1 前進のみ・active false リセット | Task 2 + Task 3 V-I2 |
| interval 1000ms L12 | Task 2 |
| `{ message, stageIndex }` L13 | Task 2 |
| panel 先頭単一 hook V-I1 L11 | Task 3 |
| submitting/processing 表示・data-progress-stage | Task 3 |
| processing 相対 0/10/35/60s V-I3 | Task 3 |
| unmount interval 掃除 V-I3 | Task 3 |
| submitting→processing L1 panel V-I2 | Task 3 |
| checking/offline/終端非変更 | Task 3 |
| a11y 追随 V-I2 設計 | Task 3 Step 5–6 |
| L6 契約非変更 | 全 Task |
| R1–R8 許容 | 実装変更なし |

**Placeholder scan:** なし（全文コード掲載。`// ...` コメントのみのステップなし）。  
**Type consistency:** Task 1 の `stageMessageAt` を Task 2 が import。Task 3 は `resolveProcessingAnchorMs` + hook。

## Execution Handoff

Plan r1 complete and saved to `docs/archive/superpowers/plans/2026-07-31-generation-progress-stages.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — 1 Task ごとに新規サブエージェント、Task 間でレビュー  
2. **Inline Execution** — このセッションで executing-plans に従いチェックポイント付き実行  

どちらで進めますか？
