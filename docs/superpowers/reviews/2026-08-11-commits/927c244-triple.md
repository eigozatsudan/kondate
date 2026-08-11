# Triple review: `927c244`（docs/skill-only）

**SHA:** `927c244c397a6b9bff5cc6eac52f6386082d6342`  
**Subject:** `docs(skill): run-ci-local を案 B E2E と現行 ci.yml に追従する`  
**Parent:** `54f6ba1`  
**Scope:** `.grok/skills/run-ci-local/SKILL.md`  
**Lens:** 記録の正確性・秘密非含有・現行 `ci.yml` / 案 B との一致。

---

## 1次レビュー

### Summary

`run-ci-local` skill を現行 CI / 案 B に追従:

- Local-safe Node 列挙に `e2e-smoke-tags` / `e2e-ai-quota-parallel` を含む（**ci.yml と一致**）
- full = setup → mobile\|\|desktop 並列; smoke = mobile + @smoke
- AI reset 開始 1 回 / E2E GLOBAL 500 / 製品 20 を触らない禁止を明記
- 成果物 split path / 行ロック residual / SKIP+CI 禁止
- `ci.sh` が eslint-primitive-rule を追加し得る差分を「yml 優先・差分報告」と記載

### Accuracy vs live

| 項目 | skill | live | 一致 |
| --- | --- | --- | --- |
| Local-safe 列挙（e2e-ai-quota-parallel） | あり | `ci.yml` L48 | **OK** |
| full 並列モデル | 案 B | `run-e2e.sh` | **OK** |
| smoke 1 段 | あり | あり | **OK** |
| 製品 20 変更禁止 | 明記 | compose 20 | **OK** |
| workers 調査なし CI 分岐禁止 | 明記 | tooling | **OK** |
| per-test truncate 復活禁止 | 明記 | tooling | **OK** |
| `CI` 既定立てない（local restore） | 明記 | skill 意図 | **OK** |
| 秘密・トークン | 無し | — | **OK** |

### Findings

| Sev | ID | 内容 |
| --- | --- | --- |
| Critical | — | なし |
| Important | — | なし |
| Minor | M1 | skill step 7 の一列 `node --test …` は AGENTS の「1 コマンド」方針と両立（単一 docker run）。長いが **ci.yml と同一**が正。 |
| Minor | M2 | `ci.sh` の eslint-primitive 追加は skill が「差分報告」と書くのみ — 実行時に人間/agent が気づく必要。 |

### Verdict (1次): **APPROVE_AS_IS**

---

## 敵対的レビュー

| # | 攻撃 | 判定 |
| --- | --- | --- |
| 1 | skill が製品 GLOBAL=20 を上げるよう誘導 | **反証** — 修正禁止に明記 |
| 2 | workers を CI で 1 に落とす逃げを推奨 | **反証** — 禁止 |
| 3 | per-test truncate 復活を「速さのため」推奨 | **反証** — 禁止 |
| 4 | Local-safe から e2e-ai-quota-parallel を落とす | **反証** — 列挙必須 + 表で役割記載 |
| 5 | シークレット手順の漏洩 | **反証** — generate-local-secrets のみ; 値なし |
| 6 | 案 B 以前の直列二段を手順に残す | **反証** — mobile\|\|desktop 明記 |

### Verdict (敵対): **PASS**

---

## 2次検証

| 主張 | 二次 |
| --- | --- |
| ci.yml 追従 | **CONFIRMED** |
| 案 B 記述 | **CONFIRMED** |
| 秘密非含有 | **CONFIRMED** |
| 製品 20 / workers / truncate 境界 | **CONFIRMED** |

### Verdict (2次): **APPROVE_AS_IS**

---

## 既存結論との照合

実装レビュー（option-b / p3）の follow-up 文書。矛盾なし。

---

## 最終判定

| 軸 | 結果 |
| --- | --- |
| 秘密非含有 | **PASS** |
| 記録正確性（案 B + ci.yml） | **PASS** |
| 製品 quota 20 非接触の運用誘導 | **PASS**（禁止を明文化） |
| **総合** | **APPROVE_AS_IS** |
