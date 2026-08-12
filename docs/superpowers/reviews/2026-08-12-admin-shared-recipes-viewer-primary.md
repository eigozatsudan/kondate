# 1次レビュー: admin 共有レシピ閲覧設計

**対象:** [`docs/superpowers/specs/2026-08-12-admin-shared-recipes-viewer-design.md`](../specs/2026-08-12-admin-shared-recipes-viewer-design.md)  
**照合先（実装が正）:**  
`admin/`（`shareJobs.ts`, `sql-guard.test.ts`, `token.ts`, `db.ts`, `schemas.ts`） /  
`supabase/migrations/20260801190000_share_community_emergency.sql` /  
`supabase/migrations/20260811180000_ops_readonly_role.sql` /  
`docs/testing/database-access-matrix.md` /  
親設計 [`2026-08-11-local-ops-admin-console-design.md`](../specs/2026-08-11-local-ops-admin-console-design.md) §2.2 / §3.1 / §5.6  
**レビュー種別:** 設計一次レビュー（内部一貫性・実装可能性・privacy・本番負荷・親設計衝突・受け入れ）  
**レビュー日:** 2026-08-12  
**編集:** なし（read-only。本ファイルのみ成果物）

---

## Summary

本設計は、既存 admin の「共有ジョブ」（パイプライン監視）と分離した **掲載済みプールの品質目視**を、GET/SELECT のみ・構造化 preview DTO・生 `menu_payload` 非露出・`kondate_ops_readonly` への限定 GRANT で実現する、という方針として **方向は妥当**である。live tree 上のギャップ（ops は jobs のみ SELECT、sql-guard が `/menu_payload/i` 全禁止、親 §3.1 が本文禁止）を認識し、GRANT / sql-guard 例外 / admin 内 preview schema / 本番 `.env.admin` の検証境界まで書いている点は実装可能性が高い。

一方、実装に入る前に設計本文で閉じないと危険な解釈分岐が残る。

1. **親設計 §3.1 / §5.6 の改訂が「任意」扱い**（子 §12.7）なのに、子 §4.1 は禁止リストの意味を変える。二重の正本が残ると sql-guard・レビュー・後続 PR が親を引用して逆行し得る。  
2. **一覧の title 導出が行ごと `menu_payload` を読む**（関数引数）。日付 31 日 × limit 100 でも jsonb ヒープ読みは重く、本番 Session pooler + `statement_timeout=15s` で timeout し得る。負荷契約が索引追加以外に薄い。  
3. **`activeCount` / `disabledCount` と status/mealType フィルタの関係が未定義**。  
4. **preview の adaptations フィールドが「等」で開いている**。DTO 固定が弱い。  
5. **本文相当データを開くのに `ADMIN_LOCAL_TOKEN` は親どおり推奨のまま**。blast radius 上昇に対する昇格が無い。  
6. **origins 既定 JOIN で contributor 再識別**が製品の匿名プール約束と緊張するが、同意/運用メモへの明記が無い。

Critical（このまま実装すると本番データ侵害や破壊が設計どおり起きる）までは至らない。既存 admin の RO ロール・Host allowlist・GET のみを継承しているため、骨格は安全側にある。ただし Important が複数 open のため **REVISE**。

## Verdict

**REVISE**

- Critical: 0  
- Important: 7  
- Minor: 4  

人間承認・implementation plan 前に、下記 Important を設計本文へ反映すること。

---

## Findings

### F1 — Severity: Important

- **Location:** 子設計 §4.1 / §12.7; 親設計 §3.1 L80 / §5.6 L257  
- **Description:** 子は親の「`menu_payload` / 共有レシピ本文を常時除外」を、**生 payload 禁止 + 構造化 preview 許可**へ読み替える。しかし実装順序 §12.7 は親ドキュメント更新を「任意」とする。親の禁止表がそのまま残ると、実装者・後続レビューが親を正として **preview API をリバート対象**と誤認する。  
- **Why it matters:** 本機能の中核は親不変条件の意図的例外。例外の正本が子だけだと access matrix / sql-guard コメント / README が分裂する。  
- **Suggestion:**  
  1. §12.7 を **必須**にする（親 §3.1 表・§5.6「出さない」・§2.2 対象外の一文を同 PR で改訂）。  
  2. 親に「詳細は子設計 `2026-08-12-admin-shared-recipes-viewer-design.md`」へのリンクを置く。  
  3. 受け入れ条件に「親設計と子設計の禁止文言が矛盾しない」を追加。  
- **Status:** open

### F2 — Severity: Important

- **Location:** §6.3 / §7.1; migration `shared_emergency_recipes` jsonb; ops `statement_timeout=15s`  
- **Description:** 一覧は  
  `private.share_recipe_title_from_payload(r.menu_payload) AS title`  
  のため、**表示は title でもストレージ読みは行全体の jsonb**になる。ops 索引 `(created_at desc, id desc)` は行特定を助けるが payload TOAST 読みは残る。31 日・高流量日・limit 100 で timeout / pool 占有し得る。  
- **Why it matters:** `.env.admin` が本番を指し得る前提で、品質確認の一覧が本番 DB 負荷源になる。  
- **Suggestion:**  
  1. 負荷契約を §7.1 に固定: 一覧はメタ列 + title のみ（現状どおり）であること、**1 リクエストあたりの最大行数 100**、timeout 時は closed error。  
  2. 可能なら将来 follow-up: `title` 生成列 / 物化列（本スライス必須にしないなら「非目標」と明記）。  
  3. 手動受け入れに「local で N 件 seed した一覧が 15s 内」を書く。本番全件 scrape は対象外と明記。  
- **Status:** open

### F3 — Severity: Important

- **Location:** §7.1 レスポンス `activeCount` / `disabledCount`  
- **Description:** 「日付範囲内」とだけあり、`status` / `mealType` フィルタ適用後の件数か、範囲内の status 別総数かが不明。UI サマリの意味が実装者依存になる。  
- **Why it matters:** フィルタ後 0 件なのに activeCount が残る等の矛盾 UX / バグ報告の元。  
- **Suggestion:** 固定する。推奨: **日付範囲に加え、mealType フィルタは counts にも適用。status フィルタは counts には適用せず**、常に範囲内の active/disabled 内訳を出す（ダッシュボード的）。または両方とも「現在の WHERE と同じ」。いずれかを一文で固定。  
- **Status:** open

### F4 — Severity: Important

- **Location:** §7.2 preview `adaptations[]`「等」  
- **Description:** dishes / timeline はフィールド列挙が閉じているが、adaptations は「テキスト中心（… 等）」で開いている。admin 内 Zod の必須キーが決まらない。  
- **Why it matters:** 実装で `z.any()` 相当に流れると raw に近い漏洩や UI ばらつきが起きる。  
- **Suggestion:** adaptations の preview フィールドを列挙固定する。例:  
  `portionText`, `additionalCutting`, `additionalHeating`, `additionalSeasoning`, `servingCheck`, `anonymousMemberRef`, `safetyActions: { kind, instruction }[]`。  
  未知キーは strip。id 系 UUID は §7.2 どおり除外。  
- **Status:** open

### F5 — Severity: Important

- **Location:** §1 / §4 / 親 §6.1; `admin/server/src/middleware/token.ts` L23–25  
- **Description:** 共有本文（構造化後でも再利用価値の高いテキスト）を新たに API に載せるが、`ADMIN_LOCAL_TOKEN` は親どおり **未設定可**。token null なら同一ホスト他 UID が `/api/shared-recipes` を無認証 GET できる。  
- **Why it matters:** feedback 本文よりレシピ構造の再配布価値が高い。親の「推奨」残差の深刻度が上がる。  
- **Suggestion（いずれか）:**  
  1. 共有レシピ API に限り token 必須（未設定ならルート非登録 or 503 closed）。  
  2. または README / 受け入れで「本文画面起動時は token 必須」を **運用 must** とし、設計の残差として明示受容。  
  推奨は 1（技術強制）。  
- **Status:** open

### F6 — Severity: Important

- **Location:** §6.1 / §7.1 origins LEFT JOIN; 製品 `list_active` は contributor 非露出  
- **Description:** 設計は origins を既定 GRANT + 一覧に `contributorUserId` を出す。製品の緊急候補は寄稿者を出さず、同意コピーも「誰が作ったかは出ない」系。ops 再識別は運用特権としてあり得るが **設計が沈黙**している。  
- **Why it matters:** privacy レビューと account-deletion（origin unlink）方針との関係が文書化されないと、後から「なぜ UUID が出る」問題になる。  
- **Suggestion:** §4 に一文: 「ops は品質調査のため contributor UUID と構造化本文を相関し得る。email は出さない。製品 UI の匿名性とは別面。」  
  origins を出さない選択肢を採るなら GRANT/JOIN を外す。  
- **Status:** open

### F7 — Severity: Important

- **Location:** §8 sql-guard; §11 テスト  
- **Description:** sql-guard を「`sharedRecipes.ts` のみ menu_payload 許可」にする方針は良い。一方 DTO 側の `FORBIDDEN_DTO_KEYS`（`admin/shared/schemas.ts`）に **`menuPayload` / `menu_payload` が現状無い**。設計 §8 は DTO テストを要求するが、FORBIDDEN リスト更新を明示していない。  
- **Why it matters:** list/detail schema に誤って raw キーを足したとき、FORBIDDEN 網が拾えない。  
- **Suggestion:** §8 / §11 に `FORBIDDEN_DTO_KEYS` へ `menu_payload` / `menuPayload` 追加と、detail レスポンス fixture で raw 非含有 assert を必須化。  
- **Status:** open

---

### F8 — Severity: Minor

- **Location:** §7.1 offset ページング  
- **Description:** `hasMore` / `total` が無い。既存 admin と同型なら許容だが、深い offset のコストに触れない。  
- **Suggestion:** 親に合わせ offset 固定でよい。深いページは非目標と一行。  
- **Status:** open

### F9 — Severity: Minor

- **Location:** §7.2 `schemaVersion`  
- **Description:** preview に schemaVersion を含めるが、未知 version の扱い（全体 null vs 部分表示）が無い。  
- **Suggestion:** 未知 version は `previewError: "unsupported_schema_version"` 等 closed で落とすか、寛容パース継続かを固定。  
- **Status:** open

### F10 — Severity: Minor

- **Location:** §6.3 title 関数 EXECUTE  
- **Description:** title は TS 側で dishes から算出すれば private 関数 EXECUTE を増やさなくてよい（関数は immutable で安全だが権限面は拡大）。  
- **Suggestion:** 現状の DB 関数方針でよいが、代替（TS 算出）を「不採用理由: 製品 title 規則と一致」と一行残すとよい。  
- **Status:** open

### F11 — Severity: Minor

- **Location:** §9.2 allergens / age_bands「要約」  
- **Description:** 要約の定義（先頭 N 個、件数のみ、カンマ連結）が無い。  
- **Suggestion:** 配列をそのまま表示（既存 admin 密度）で固定するか、`join(", ")` + CSS truncate と書く。  
- **Status:** open

---

## 良い点（維持）

- 独立画面で jobs と責務分離。  
- 生 `menu_payload` を API/UI/ログに出さない二重防御（mapper + Zod）。  
- preview 失敗時に raw を返さない。  
- pantryUsage / labelConfirmations / 内部 UUID を第1版除外。  
- ops は SELECT のみ、service_role 表 GRANT 拡大なし。  
- 本番 `.env.admin` 注意と local 検証既定。  
- 本編 `shared/` を admin Docker に無理に持ち込まない。

---

## 結論

| 項目 | 結果 |
| --- | --- |
| Verdict | **REVISE** |
| Critical | 0 |
| Important | 7（F1–F7） |
| Minor | 4（F8–F11） |
| 次 | 設計改訂 → 敵対・二次と突合 → 人間再承認 → plan |
