# Plan 8 有料 OpenRouter — コード実装済み / 本番ゲート未完了

- **状態**: **コード実装済み。本番ゲート（live N=10）未完了のため本番有効化不可。**
- 設計 §4.4.2: 1 本も live 合格しない間は実装を「完了」としない。本書は **コード列の到達点** を記録する。
- **Branch**: `plan8/paid-openrouter-models`
- **Worktree**: `.worktrees/plan8-paid-openrouter`
- **Base**: `6641603` (main, E2E follow-up 後)
- **HEAD**: 作業時 tip を `git log -1` で確認

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
| ad45610+ | 敵対レビュー: pricing fail-closed / upgrade-safe migration / app gate 厳密化 等 |

## 検証

| ゲート | 結果 |
|--------|------|
| format/lint/typecheck | コード列で PASS 済み（再検証は HEAD で） |
| vitest / node:test | コード列で PASS 済み |
| db-test (reset 後) | upgrade path テスト含む再実行が必要 |
| E2E full | 共有枠リセット後 exit 0 実績あり |
| build | PASS 実績あり |
| Live N=10 有料ベンチ | **実施済み・不合格（2026-07-27, PASS 0 本, exit 1）** — 証跡は [2026-07-27-plan8-production-gate-evidence.md](2026-07-27-plan8-production-gate-evidence.md)。本番 ship 不可 |

## 設計ロック維持

- structured AND, exact mock base（非 mock では mock/ と :free 拒否）, 3/6/20, privacy 互換なし, auto 禁止
- ベンチは materialize/validate + model 一致 + 全経路 elapsed を要求

## 本番 ship 条件（未達）

1. upgrade-safe migration 適用可能な DB 状態（ローカル pgTAP は 2026-07-27 に PASS）
2. funded key で remote verify + **修正版 live N=10** 合格
   （2026-07-27 実施: funded key・total limit $1 設定済みで実行したが **PASS 0 本**。候補 ID
   入れ替えまたは設計改訂を経て再実行が必要）
3. 合格 ID 最大 2 本のみ本番 `OPENROUTER_MODELS`
4. 3/6/20・公式 base・app 再作成を確認
