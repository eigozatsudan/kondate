/**
 * Phase 3（Spec §7.3）: test / fixture からアプリ全体 AI 日次枠を truncate しない。
 *
 * 並列 workers 下で fixture や test 本体が共有カウンタを空にすると、
 * 他 worker が予約済みの枠が消え、枯渇・偽 red / 稀に偽 green になる。
 *
 * 許可される境界は shell のみ:
 * - `scripts/reset-e2e-ai-quota.sh`（`scripts/run-e2e.sh` が suite 開始・project 境界で呼ぶ）
 *
 * 枯渇回避は `compose.e2e.yaml` の E2E 専用 GLOBAL_DAILY_AI_LIMIT（製品 max）に依存する。
 * 製品 `compose.yaml` の limit や preflight は変えない。
 *
 * 本モジュールは意図的に truncate 実装を持たない。import して呼ばないこと。
 * fail-closed tooling が e2e ツリー内の旧ヘルパ名と SQL truncate 呼び出し 0 を固定する。
 */

export {};
