# Plan 8 クローズ記録（敵対レビュー是正）

**Plan ID:** 8  
**日付:** 2026-07-24  
**HEAD（記録時）:** 実装は `b9cc4ca`（Task 4 安全網）以降の main 系列。クローズ判断時点の tip はセッション終了時の `git log` を正とする。

**関連:**
- 実装 plan（作業中ドラフト）: セッション内で作成した `2026-07-24-plan7-adversarial-remediation.md` の内容に基づく（worktree から消失した場合は本 close と `.superpowers/sdd/plan8-*.md` を権威とする）
- 最終レビュー: `.superpowers/sdd/plan8-final-review.md`
- 設計: `docs/superpowers/specs/2026-07-22-guided-planner-optional-household-design.md` §5.3, §5.4, §8.3, §9.3, §10

## 人間承認

| 項目 | 決定 |
| --- | --- |
| Task 4 plan ロック差分 | **A: 現行 HEAD を正とする**（ensureQueryData + generate 時 safety net を受け入れ） |
| フル E2E 再実行 | **しない**（人間指示） |

## Task 4 受け入れ表（A 確定後）

設計 §10 を満たしたうえで、実装の正本は次とする。

| 状況 | 振る舞い（確定） |
| --- | --- |
| audience で idea を次へ | `ensureIdeaOnboardingSkipped` を **await**。成功後に review へ |
| profile 未キャッシュ | `queryClient.ensureQueryData` → `getProfile` で権威取得。成功時のみ write |
| `not_started` \| `in_progress` | `setOnboardingStatus(..., "skipped")` |
| `complete` \| `skipped` | 書込 no-op。先へ進む |
| profile 取得失敗 / 未知状態 | write しない。audience 残留 + `role` 相当のエラー表示（fail-closed） |
| RPC 失敗 | audience 残留 + 再試行可能なエラー |
| `/planner` 直入のみ | write しない |
| review generate（idea） | **safety net** として再度 `ensureIdeaOnboardingSkipped`（resume で audience を踏まない経路）。失敗時は生成開始しない |
| household 経路 | 上記 idea 専用処理を呼ばない |

**旧 plan ロックとの差分（意図的に廃案）:**
- 「cache miss なら絶対に書かない」→ **ensureQueryData で取得してから書く**
- 「review submit から skipped を完全削除」→ **idempotent な generate 時 safety net を残す**

## Task 完了サマリ

| Task | 所見 | 代表コミット |
| --- | --- | --- |
| 1 I1 再生成 mode | live≠snapshot → `source_menu_changed`（version 直後）；preference → `invalid_request` | `badbaa1` / `cd73b7c` / `dce261e` |
| 2 I2 favorite | `isFavorite` + useEffect 同期 | `506386f` |
| 3 I3 disclaimer | idea note を生成ボタン直前 + DOM 順序テスト | `0128de8` |
| 4 I4 skipped | A 確定（ensureQueryData + resume 安全網） | `ec5a2d4` / `b9cc4ca` / lint `22b2e46` |
| 5 I5 履歴 household | 結果画面同等配線 + create/resume/actions テスト | `5ff1747` / `34d4fb2` |

## ゲート記録（AGENTS.md §8）

| 段 | 結果 | 備考 |
| --- | --- | --- |
| format:check | PASS | |
| lint | PASS | error 0 / warning 2（history beginRecheck / shopping-list-page） |
| typecheck | PASS | |
| full Vitest | PASS | 1770 + 1 skip |
| DB reset | PASS | |
| pgTAP | PASS | 733 |
| full E2E | **未再実行（人間指示）** | 先行 run は途中失敗・プロセス終了あり。本 close では再実行しない |
| build | PASS | |
| git diff --check | PASS | |

## 残差（非ブロッカー）

- Task 5: reconcile **apply** の unit 断言は preview までが厚い（production は配線済み）— Minor
- Task 1: commit 分割トポロジ — Minor
- Plan 8 外: regen privacy 再検査、200% zoom E2E、PR 用スクショ取得
- フル E2E は人間判断でスキップ。将来 CI / 手動で緑を確認することを推奨

## クローズ判定

- **製品:** I1–I5 は設計適合。Task 4 は A により plan 受け入れを HEAD に整合。
- **プロセス:** 人間が E2E 再実行を明示的に不要と判断したため、Plan 8 を **complete（E2E 再実行なし）** として ledger に記録する。

**Plan 8: complete（ratify A, no E2E re-run）**
