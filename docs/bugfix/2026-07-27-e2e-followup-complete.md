# E2E follow-up 完了記録（敵対的レビュー main 取込後）

- **完了日**: 2026-07-27
- **E2E全緑確認時の実装HEAD**: `752e24f`
- **初回完了記録 commit**: `6641603`
- **前提 merge**: `a067cff`（敵対的レビュー修正 → main）
- **範囲**: E2E 追従 + E2E プロファイルの mock 強制（製品ロジックの仕様緩和なし）

---

## 結果サマリ

| ゲート | 結果 |
|--------|------|
| format:check | PASS |
| lint | PASS |
| typecheck | PASS |
| vitest | PASS（140 files / 2142 tests, 1 skipped） |
| reset-local-db | PASS |
| db-test | PASS（23 files / 793 tests） |
| `./scripts/run-e2e.sh` | PASS（mobile 59 + desktop 59） |
| build | PASS（chunk size warning のみ） |
| git diff --check | PASS |

---

## 初回レビュー対象のE2Eフォロー5コミット（a067cff 以降）

1. `90bdc91` — `test: E2EをC-I4 audienceとa11y文言に追従させる`
2. `dd5dd53` — `fix: E2Eプロファイルでopenrouter-mockを強制する`
3. `0033efc` — `test: pantry E2Eの緊急用家族選択をC-I4に合わせる`
4. `752e24f` — `test: pantry E2Eの追加条件details開閉と長尺timeoutを直す`
5. `6641603` — `docs: E2E follow-up 完了と9段階ゲート結果を記録する`

---

## 根因クラスと対応

| クラス | 内容 | 対応 |
|--------|------|------|
| C-I4 audience | household はメンバー自動選択しない。E2E が auto-select 前提 | `selectHouseholdAudienceWithMember` + 各 fixture/spec 明示チェック |
| DangerZone | region 名 `危険な操作` | E2E セレクタ更新 |
| Auth copy/CTA | ログイン用の情報 / 期限切れ CTA | E2E 文言・ボタン名追従 |
| C-I6 idea 緊急 | idea 専用 empty 文言 | E2E assert 更新 |
| Auth callback | 認証済みだと error UI 非表示 | 失敗ケース前に storage/cookie クリア |
| OpenRouter env | ホスト `.env` が実 API を指すと生成 E2E が不安定 | `compose.e2e.yaml` で mock 固定 |
| pantry details | `open` 空文字を閉じ扱い → 誤クローズ | `HTMLDetailsElement.open` + pantry 見出し待ち |
| pantry multi-member | 緊急用家族の auto-select 仮定 | 明示 check + 家族1 uncheck 順 |

**やらなかったこと**: C-I4 の auto-select 復活、D-C1/D-C2 ゲートの巻き戻し、仕様曲げの force-pass、git push / PR。

---

## 診断・レビュー成果物（gitignored 含む）

- `.superpowers/sdd/e2e-mismatch-diagnosis.md`
- `.superpowers/sdd/e2e-followup-task1-report.md`
- `.superpowers/sdd/e2e-followup-secondary-review.md`（I1 対応後 APPROVED）
- フル E2E ログ: `/tmp/kondate-e2e-full-after-fix.log`
