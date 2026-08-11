# 2026-08-11 コミット単位 三重レビュー INDEX

**対象日:** 2026-08-11（`git log --since=2026-08-11 --until=2026-08-12`）  
**件数:** 32 commits  
**形式:** 各 SHA に `1次 → 敵対的 → 2次` を1ファイル（`<sha>-triple.md`）  
**注意:** 判定は **当該コミット時点** の差分。後続 fix で閉じたものは 2次/注記で「live では閉鎖」と記載。

---

## 横断サマリ

| 帯 | SHA 範囲 | 結果概要 |
| --- | --- | --- |
| 朝 auth residual | `ca17622`–`6a80fcb` | `ca17622` 単体は後着 exchange 穴（**後続 `bfad919` で閉鎖**）。他は APPROVE 系 |
| マジックリンク | `e37497d`–`c7570ac` | `e37497d` 単体 **FAIL**（`sb` fragment 等、**後続 `a87f895` で閉鎖**）。以降 APPROVE |
| planner type | `89c89bf` | APPROVE |
| E2E Phase1 docs→impl | `a3423b1`–`33c10be` | docs 初版のみ実装開始 BLOCK。実装本線は nits。`33c10be` でガード強化 |
| E2E Phase2 | `508c6bd`–`9ebfe82` | seed I1 → `9ebfe82` で閉鎖。setup/storageState は dependsOn なし |
| E2E Phase3 + 案 B | `98e3519`–`927c244` | A1/A2 → `40baa1c`。案 B dual signal → `54f6ba1`。製品 GLOBAL=20 非接触 |

**現行 HEAD（`927c244`）で未閉鎖の Critical 製品破壊: なし（時系列上の穴は同日内 fix で連鎖閉鎖）。**

---

## コミット一覧（時系列）

| # | SHA | subject | 1次 | 敵対 | 2次/総合 | 文書 |
| ---: | --- | --- | --- | --- | --- | --- |
| 1 | `ca17622` | 認証 residual recovery / soft 残渣 | REQUEST_CHANGES | FAIL | live は `bfad919` で閉鎖 → APPROVE_WITH_NITS | [triple](./ca17622-triple.md) |
| 2 | `bfad919` | residual exchange 後着抑止 | APPROVE_WITH_NITS | PASS_WITH_RESIDUALS | APPROVE_WITH_NITS | [triple](./bfad919-triple.md) |
| 3 | `2025a74` | planner leave-flush / saving | APPROVE_WITH_NITS | PASS_WITH_RESIDUALS | APPROVE_WITH_NITS | [triple](./2025a74-triple.md) |
| 4 | `f7e2218` | onboarding CAS 後 form 正本 | APPROVE_WITH_NITS | PASS_WITH_RESIDUALS | APPROVE_WITH_NITS | [triple](./f7e2218-triple.md) |
| 5 | `fc33edd` | history revalidation キー | APPROVE | PASS | APPROVE | [triple](./fc33edd-triple.md) |
| 6 | `6a80fcb` | PKCE error fragment 誤写防止 | APPROVE_WITH_NITS | PASS_WITH_RESIDUALS | APPROVE_WITH_NITS | [triple](./6a80fcb-triple.md) |
| 7 | `e37497d` | マジックリンク token_hash + 確認 | FAIL | FAIL 系 | **当該 SHA FAIL**（`a87f895` で閉鎖） | [triple](./e37497d-triple.md) |
| 8 | `a87f895` | ML レビュー指摘 fix | APPROVE | PASS | APPROVE | [triple](./a87f895-triple.md) |
| 9 | `c7570ac` | iOS 長押しプレビュー注意 | APPROVE | PASS | APPROVE | [triple](./c7570ac-triple.md) |
| 10 | `89c89bf` | navigate Promise\<void\> | APPROVE | PASS | APPROVE | [triple](./89c89bf-triple.md) |
| 11 | `a3423b1` | E2E 短縮 Spec/Plan | REVISE | BLOCK (C1/C2) | 実装開始 BLOCK（次 docs で緩和） | [triple](./a3423b1-triple.md) |
| 12 | `891431e` | Spec/Plan レビュー反映 | APPROVE_WITH_NITS | PASS 系 | APPROVE_WITH_NITS | [triple](./891431e-triple.md) |
| 13 | `f3f27c5` | grepInvert mobile/desktop | APPROVE_WITH_NITS | PASS 系 | APPROVE_WITH_NITS | [triple](./f3f27c5-triple.md) |
| 14 | `0842d22` | smoke / mobile-only タグ | APPROVE_WITH_NITS | PASS 系 | APPROVE_WITH_NITS | [triple](./0842d22-triple.md) |
| 15 | `6de1354` | KONDATE_E2E_SUITE | APPROVE_WITH_NITS | PASS 系 | APPROVE_WITH_NITS | [triple](./6de1354-triple.md) |
| 16 | `657b845` | CI PR=smoke / else full | APPROVE_WITH_NITS | PASS 系 | APPROVE_WITH_NITS | [triple](./657b845-triple.md) |
| 17 | `5c68150` | docs smoke/full | APPROVE_WITH_NITS | PASS 系 | APPROVE_WITH_NITS | [triple](./5c68150-triple.md) |
| 18 | `33c10be` | Phase1 レビュー反映 | APPROVE | PASS 系 | APPROVE | [triple](./33c10be-triple.md) |
| 19 | `508c6bd` | seed completed onboarding | REVISE | BLOCK_WITH_CONDITIONS | I1 → `9ebfe82` で閉鎖 | [triple](./508c6bd-triple.md) |
| 20 | `eb57b3a` | setup + storageState | APPROVE_WITH_CONDITIONS | PASS_WITH_RESIDUALS | APPROVE_WITH_RESIDUALS | [triple](./eb57b3a-triple.md) |
| 21 | `ab45e94` | AI 枠を生成直前のみ | APPROVE_WITH_NITS | PASS_WITH_RESIDUALS | APPROVE_AS_IS | [triple](./ab45e94-triple.md) |
| 22 | `9ebfe82` | Phase2 レビュー fix | APPROVE | PASS | APPROVE | [triple](./9ebfe82-triple.md) |
| 23 | `98e3519` | E2E GLOBAL_DAILY 500 | APPROVE_WITH_NITS | PASS | APPROVE_AS_IS | [triple](./98e3519-triple.md) |
| 24 | `7e6fa8b` | workers + truncate 廃止 | APPROVE_WITH_NITS | PASS_WITH_RESIDUALS | FIX_THEN_OK → `40baa1c` | [triple](./7e6fa8b-triple.md) |
| 25 | `aa83c7c` | Admin generateLink | APPROVE_WITH_NITS | PASS | APPROVE_AS_IS | [triple](./aa83c7c-triple.md) |
| 26 | `29d33f1` | CI restore 短縮 / Phase3 close | APPROVE_WITH_NITS | PASS_WITH_RESIDUALS | FIX_THEN_OK → `40baa1c` | [triple](./29d33f1-triple.md) |
| 27 | `40baa1c` | Phase3 A1/A2 fix | APPROVE_AS_IS | PASS | APPROVE_AS_IS | [triple](./40baa1c-triple.md) |
| 28 | `a7d4bfd` | docs Phase3 reviews | APPROVE_WITH_NITS | PASS | APPROVE_AS_IS | [triple](./a7d4bfd-triple.md) |
| 29 | `06ad4ef` | 案 B mobile\|\|desktop 並列 | APPROVE_WITH_NITS | PASS_WITH_RESIDUALS | PASS_WITH_RESIDUALS（I1 → `54f6ba1`） | [triple](./06ad4ef-triple.md) |
| 30 | `7efeea9` | docs 案 B reviews | APPROVE_AS_IS | PASS | APPROVE_AS_IS | [triple](./7efeea9-triple.md) |
| 31 | `54f6ba1` | 案 B P1–P3 tooling | APPROVE_WITH_NITS | PASS_WITH_RESIDUALS | APPROVE_AS_IS | [triple](./54f6ba1-triple.md) |
| 32 | `927c244` | run-ci-local skill | APPROVE_AS_IS | PASS | APPROVE_AS_IS | [triple](./927c244-triple.md) |

---

## 時系列で閉じたブロッカー（当該 SHA では FAIL、同日後続で閉鎖）

| 穴 | 導入 | 閉鎖 |
| --- | --- | --- |
| residual exchange 後着 session 差し替え | `ca17622` | `bfad919` |
| GoTrue `sb` fragment → unbound 誤写 | `e37497d` | `a87f895` |
| Spec C1/C2（smoke 穴・truncate×workers） | `a3423b1` | `891431e` + Phase3 実装 |
| seed portion/spice 欠落 | `508c6bd` | `9ebfe82` |
| workers regex / CI 配線（A1/A2） | `7e6fa8b`–`29d33f1` | `40baa1c` |
| dual signal tooling 欠落（案 B I1） | `06ad4ef` | `54f6ba1` |

---

## residual（現行 HEAD でも許容として残るもの）

- AI 共有枠 **単一行 FOR UPDATE**（生成の process 間直列化、壁時計 ≈ max は非 AI 主因）
- PR smoke ≠ full の設計 residual
- force-kill dual / Compose 両 one-off の動的証明の一部 Minor
- generateLink glue / fragment-only 理論 residual 等（各 triple 参照）
