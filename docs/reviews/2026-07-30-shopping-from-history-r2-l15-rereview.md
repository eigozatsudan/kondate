# L15 re-review: C-F1 closure (deferred unmount clear)

| 項目 | 値 |
|------|-----|
| 対象 | `docs/superpowers/specs/2026-07-30-shopping-from-history-and-cleanup-design.md`（**R2+L15**） |
| 日付 | 2026-07-30 |
| 種別 | Critical-only re-review of **C-F1** after L15 |
| 前提 | R2 final `…-r2-final-rereview.md`（C-F1 open） |
| 判定 | **Ready for implementation planning** |

---

## 1. Verdict: **Ready for implementation planning**

L15 locks the deferred schedule/cancel unmount clear that R2 final required as **Fix A**. That removes the only remaining Critical (C-F1). No new Critical opens.

Open residual at Critical: **0**.

---

## 2. C-F1 adjudication

| Prior claim | L15 disposition |
|-------------|-----------------|
| Sync unmount `clearShoppingIntentCycle` kills `sheetExpected` before StrictMode remount | **Fixed** — unmount only `scheduleIntentClear` (`setTimeout(0)` / microtask); remount same `menuId` calls `cancelPendingIntentClear` |
| sticky intent if unmount clear omitted | **Fixed** — real leave has no remount cancel → timeout clears cycle |
| Testing must assert both StrictMode restore and real-leave sticky ban | **Fixed** — §8 rows for StrictMode schedule+cancel, real leave schedule-only, helper unit |

**Why the sequence now works**

```text
StrictMode: unmount → schedule(clear) → same-turn remount → cancel → storage lives → shouldRestoreSheet
Real leave: unmount → schedule(clear) → no remount → timeout → clear → for=なし re-entry no auto-open
```

React 18+ StrictMode effect re-invoke runs cleanup then setup **before** the next macrotask, so `setTimeout(0)` is cancelled in time. Real navigation remounts only after a later turn, so the clear fires. This matches R2 final Fix A and is implementable via the locked `shopping-intent.ts` Map/timer helpers.

**Confidence C-F1 closed:** 92

---

## 3. New Critical scan (L15 only)

| Candidate | Result | Why |
|-----------|--------|-----|
| Fast leave→same-menu remount cancels clear → sticky | **Not Critical** | Needs same-turn remount without StrictMode; user Back / second navigate is a later task after `setTimeout(0)` |
| menuId change clears wrong key / leaks sticky | **Not Critical** | Design: old id schedules, new id separate keys; cancel is per-menuId |
| Success/cancel sync clear + unmount schedule double-clear | **Not Critical** | Idempotent removes |
| `setTimeout(0)` vs microtask ambiguity | **Not Critical** | Primary path is timer + `clearTimeout`; microtask needs a cancel flag but same contract; unit tests lock behavior |
| §7 still says `consumed` | **Minor only** | §1 / L9 / L13 / L15 are authoritative; non-blocking for planning |

No new Critical.

---

## 4. Planning notes (non-blocking)

1. Implement `scheduleIntentClear` / `cancelPendingIntentClear` only in `shopping-intent.ts`; wire MenuResult + HistoryDetail mount/unmount effects per L15.
2. Prefer `setTimeout(0)` + `Map<menuId, timerId>` as the design sketch shows; if microtask is used, cancel must be flag/generation-based, not `clearTimeout`.
3. Keep §8 helper tests as the contract gate before page-level StrictMode tests.
4. Optional cleanup: §7 “consumed” wording → `didAutoOpen` (M-F1 class residual).

---

## Summary

| Severity | Open |
|----------|-----:|
| Critical | 0 |
| Important | 0 (out of scope for this pass) |

**Design status: Ready for implementation planning** — C-F1 is closed by L15 deferred unmount clear; no new Critical found.
