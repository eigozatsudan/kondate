# Triple review: `5c68150` docs: E2E の smoke/full の使い方を追記する

- **Full SHA:** `5c68150e0d8508c33ceb02f87f0f0f9f4a504768`
- **Parent:** `657b8457a9e43e7ec569ede5c235f7acac9d95db`
- **種別:** docs only（`docs/local-development.md` / `docs/README.md` / `README.md`）
- **差分の核:** smoke/full/1 ファイルのコマンド表、**「PR smoke ≠ acceptance 全量」**注意、README 検証一覧への 1 行
- **重点:** 正確性・誤誘導・退行（コードなし）

---

## 1次レビュー

### Summary

Spec §5.4 の必須 docs を満たす。PR smoke が full の代替でないこと、full が push / ci.sh / release 側であることを明記。発見性のため docs/README の local-development 行に smoke/full を括弧追記。

### Verdict: **APPROVE_WITH_NITS**

### Findings

#### Critical

（なし）

#### Important

| ID | 内容 |
| --- | --- |
| F1 | 1 ファイル起動例が `./scripts/run-e2e.sh -- e2e/specs/foo.spec.ts --project=…` の **`--` 付き**。当時の `run-e2e.sh` は先頭 `--` を strip しない → **docs が嘘を教え、file filter / option が効かない**（Phase1 敵対 I3）。CI 本線は無引数のため非影響 |

#### Minor

| ID | 内容 |
| --- | --- |
| M1 | caller が任意 `--grep` を smoke と併用したときの乖離は未記載 |
| M2 | release-checklist は full のまま — 正しい（変更不要） |

---

## 敵対的レビュー

### Summary

docs で「PR で十分」と読ませる誤誘導、危険なコマンド例、製品 cap を E2E 500 と混同させる文を突く。

### Attack scenarios

| # | 攻撃 | 判定 |
| --- | --- | --- |
| 1 | 注意文が無く PR smoke を全量と誤認 | **反証** — 注意文あり |
| 2 | release を smoke に誘導 | **反証** — full を release 相当と記載 |
| 3 | `--` 付き例で開発者 full 相当を踏ませる | **成立** — F1。実測で full 相当になった報告あり（Task 5 report 系） |
| 4 | 秘密や計測ログを docs に載せる | **反証** — コマンド表のみ |
| 5 | 誤った env 名 | **反証** — `KONDATE_E2E_SUITE` 正しい |

### Findings

#### Critical

（なし）

#### Important

- **I1:** `--` 付き 1 ファイル例（F1）— DX と「短縮したつもり full」の時間浪費・誤診断

#### Minor

- M1

---

## 2次検証

### Cross-walk

| 指摘 | 判定 |
| --- | --- |
| PR smoke ≠ 全量 | **PASS** |
| full の位置づけ | **PASS** |
| F1/I1 `--` | **CONFIRMED** — 33c10be で strip + docs 両形が後続修正 |
| Critical docs 嘘（CI 本線） | **無し** |

### Must-fix

**I1 は Important residual** — Phase 1 完了を止めないが、docs 単独 commit としては次の fix が望ましい（33c10be で対応済み）。

### Final: **APPROVE_WITH_NITS**

**理由:** 必須の運用注意は正しい。有害な `--` 例が唯一の実質指摘。

TRIPLE_REVIEW_COMPLETE
