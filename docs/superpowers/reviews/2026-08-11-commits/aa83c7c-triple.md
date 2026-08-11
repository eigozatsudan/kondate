# Triple review: `aa83c7c`

**SHA:** `aa83c7ccdcbbabc26e68393fc02baf2189bc4e2d`  
**Subject:** `feat(e2e): 使い捨て認証を Admin generateLink 経路にする`  
**Parent:** `7e6fa8b`  
**Scope (Task 12):** 主に `e2e/fixtures/auth.ts`（`loginAsNewUser` / `authenticatedPage` 既定）。  
**既存:** `.superpowers/sdd/e2e-p3-task12-review.md`; p3-impl A3/A4。

---

## 1次レビュー

### Summary

ephemeral 認証を Admin `generateLink`（magiclink）→ 実 action_link open → GoTrue verify の実トークン → 製品 key への storage bridge → clean `/planner` に切替。`addInitScript` session 手注入なし。失敗時 Mailpit フォールバックなし。setup + auth-recovery の Mailpit 成功 path を維持。service role は Node `.env` のみ。

### Spec §7.5

| 要件 | 判定 |
| --- | --- |
| generateLink 既定 | **PASS** |
| addInitScript 禁止形 | **PASS**（無し） |
| Mailpit ≥1 | **PASS**（setup + recovery @smoke） |
| fail-closed | **PASS**（throw のみ） |
| UI oauth/callback 維持 | **PASS** |

### Findings

| Sev | ID | 内容 |
| --- | --- | --- |
| Critical | — | なし |
| Important | — | なし（§7.5 違反なし） |
| Minor | M1 | 製品 `/auth/callback` + token_hash 成功 path を ephemeral 大半が踏まない（coverage 非対称）。 |
| Minor | M2 | Mailpit 成功 path の静的 tooling ガード無し（現行充足）。 |
| Minor | M3 | 本 SHA full×2 未実施（プロセス residual）。 |

### Verdict (1次): **APPROVE_WITH_NITS**

---

## 敵対的レビュー

| # | 攻撃 | 判定 |
| --- | --- | --- |
| 1 | session 形状の完全手捏造（addInitScript） | **反証** |
| 2 | service role が page / VITE へ漏洩 | **反証** — evaluate は storageKey + sessionJson のみ |
| 3 | generateLink 失敗 → 黙って Mailpit | **反証** |
| 4 | Mailpit path 死滅 | **現行反証** / 静的ガード無し（M2） |
| 5 | 製品 20 改変 | **N/A（非接触）** |
| 6 | workers 偽緑 | **本 commit 非対象** |

### Verdict (敵対): **PASS**（A3 を §7.5 違反と読むのは **FALSE_POSITIVE**）

---

## 2次検証

| 主張 | 二次 |
| --- | --- |
| §7.5 適合 | **CONFIRMED PASS** |
| p3-adv A3 Important | **DOWNGRADE → Minor residual**（coverage）— secondary 支持 |
| A4 Important | **DOWNGRADE → Minor** |
| 既存 task12-review | **一致** |

### Verdict (2次): **APPROVE_AS_IS**

---

## 既存結論との照合

| 既存 | 本 triple |
| --- | --- |
| task12-review APPROVE | **一致** |
| p3-adv A3 Important | **矛盾 → 本 triple は Minor**（p3-secondary と一致） |

---

## 最終判定

| 軸 | 結果 |
| --- | --- |
| 製品 quota 20 | **非接触** |
| parallel orphan / workers 偽緑 | **対象外** |
| 秘密 / service role | **PASS** |
| **総合** | **APPROVE_WITH_NITS** |
