# Plan 8 有料 OpenRouter — 実装完了記録

- **Branch**: `plan8/paid-openrouter-models`
- **Worktree**: `.worktrees/plan8-paid-openrouter`
- **Base**: `6641603` (main, E2E follow-up 後)
- **HEAD**: 作業完了時の tip を `git log -1` で確認

## Commits (概要)

| SHA | 内容 |
|-----|------|
| 451ab28 | Plan 二次検証改訂の取り込み |
| 21611b6 | Task1 docs: MVP/roadmap/CLAUDE |
| 1d96f76 | Task2: 有料 allowlist 契約 |
| ca9da95 | Task3: クォータ 3/6/20 |
| b1139d8 | Task4: privacy 2026-07-26.v1 |
| 55ebecc | Task3 fix: repair global fixture 21 |
| 9373ad1 | Task5: ベンチゲート + 運用 docs |
| 4afcefe | E2E GLOBAL 共有枠リセット + fixture 整合 |

## 検証

| ゲート | 結果 |
|--------|------|
| format/lint/typecheck | PASS |
| vitest | PASS |
| db-test (reset 後) | 793 想定 — 実行時確認 |
| E2E full | mobile 58+1flaky / desktop 59 (exit 0) |
| build | PASS |
| Live N=10 有料ベンチ | **BLOCKED**（funded key なし）— 本番 ship 不可 |

## 設計ロック維持

- structured AND, exact mock base, 3/6/20, privacy 互換なし, auto 禁止

## 本番 ship 条件

Task5 の live N=10 ゲート合格 + key total limit 解消まで production 有効化しない。
