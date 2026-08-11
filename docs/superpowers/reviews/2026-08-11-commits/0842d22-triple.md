# Triple review: `0842d22` feat(e2e): smoke と mobile-only タグを付与する

- **Full SHA:** `0842d22d1f9f77d13f99d5f04e28dde6b4d3e222`
- **Parent:** `f3f27c50e17e84c4ce0ee3130e916e9bdd22cdd0`
- **種別:** 実装（e2e specs の `tag` のみ。runner/CI 未変更）
- **差分の核:** Spec §4.2 必須 path に `@smoke`。`mobile-accessibility` 全定義に `@mobile-only`、320 household のみ `@smoke` 併用。account-deletion / billing に `@smoke` 無し
- **照合:** Spec §4.2 表、exact title 方針（Plan Task 2）、live タグ一覧
- **重点:** smoke セット誤付与 / 必須 title 欠落 / mobile-only 漏れ → desktop 二重実行

---

## 1次レビュー

### Summary

タグ付与は **891431e 反映後の §4.2** と一致する:

| 領域 | 期待 | 付与 |
| --- | --- | --- |
| foundation | 1 | `protects app routes…` |
| oauth-mock | 2 | success + cancel |
| full-journey | 2 | household + idea |
| auth-callback | 2 | cancel + past expires_at |
| auth-recovery | 1 | same-browser |
| generation | 2 | connectionreset resend + result details |
| shopping-list | 1 | preserves protected rows |
| shopping-races | 1 | reuses one idempotency key |
| history-safety | 1 | automatically revalidates… |
| history-regen | 1 | does not consume a success…（#13） |
| menu-pantry | 1 | pantry CRUD…（#9） |
| onboarding / settings | 1 each | 表どおり |
| mobile-a11y | 1 smoke + 全定義 mobile-only | ternary 320 + 5 定義 |
| account-deletion / billing | 0 | タグ無し |

テスト本体ロジックの意味変更は indent/options ラップが主で、アサーション差し替えは見当たらない。  
**この commit 単体では** `KONDATE_E2E_SUITE` / CI が未接続のため、タグは full 実行時の **grepInvert による a11y desktop 除外**に効く。smoke フィルタはまだ走らない。

### Verdict: **APPROVE_WITH_NITS**

### Findings

#### Critical

（なし）

#### Important

| ID | 内容 |
| --- | --- |
| F1 | **静的ガード無し** — この commit 時点で `e2e-smoke-tags.test.mjs` 未追加。タグを別 title に付け替えても CI は検知しない（後続 6de1354/657b845 で本数ガード、33c10be で title 近傍） |
| F2 | mobile-only を 1 本だけ残し他を外す退行を、この commit だけでは機械検知できない |

#### Minor

| ID | 内容 |
| --- | --- |
| M1 | 大きな re-indent で diff が読みづらい。意味差分は tag 追加のみに見えるがレビューコスト高 |
| M2 | suite/CI 未接続のため「smoke タグ」だけでは PR 短縮は起きない — 意図的分割 |

---

## 敵対的レビュー

### Summary

薄い smoke・誤 title・a11y 部分タグ漏れ・account-deletion 誤 smoke を優先。

### Attack scenarios

| # | 攻撃 | 判定 |
| --- | --- | --- |
| 1 | account-deletion に `@smoke` を誤付与 | **反証** — 当該ファイルに無し |
| 2 | #13 / #9 を外し軽い test に `@smoke` | **現行は正しい title**。ガード無しなので **将来 false green 可能** |
| 3 | mobile-a11y の 4 定義から `@mobile-only` を外す | **現行 5 定義すべて付与**。ガード ≥1 相当の穴は後続 tooling 依存 |
| 4 | 320 以外にも `@smoke` を付け smoke 膨張 | 現行 ternary は 320 のみ — 正しい |
| 5 | tag 構文誤りで Playwright が無視 | 公式 `tag: ["@smoke"]` 形式。grepInvert は tag を対象（@playwright/test 1.55+） |
| 6 | 意味アサーションを同時に緩める | **主 diff は wrap** — 緩和は見当たらない |

### Findings

#### Critical

（なし — 付与内容自体は Spec 表どおり）

#### Important

- **I1:** ガード無しのタグ commit は「正しい瞬間写真」。ドリフト耐性は後続 tooling に完全依存
- **I2:** suite 未接続のため、この commit 直後の CI は **full + grepInvert** のみ。smoke の false green はまだ CI 経路に無い

#### Minor

- re-indent ノイズ

---

## 2次検証

### Cross-walk

| 指摘 | 判定 |
| --- | --- |
| §4.2 必須 title 充足 | **PASS（ソース照合）** |
| account-deletion 非 smoke | **PASS** |
| mobile-only 全定義 | **PASS（5 定義）** |
| F1/I1 ガード欠如 | **CONFIRMED** — 中間状態として defer OK |
| ロジック改変 | **反証（主に tag）** |

### Must-fix

**なし**（後続で tooling + suite が来る前提）。

### Final: **APPROVE_WITH_NITS**

**理由:** タグ内容は Spec に忠実。false green の穴は **ガード未導入**というプロセス上の中間リスクであり、付与ミス自体は見えない。

TRIPLE_REVIEW_COMPLETE
