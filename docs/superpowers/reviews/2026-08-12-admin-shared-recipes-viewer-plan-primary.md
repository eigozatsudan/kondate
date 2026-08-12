# 1次レビュー: admin 共有レシピ閲覧 Implementation Plan

**対象 Plan:** [`docs/superpowers/plans/2026-08-12-admin-shared-recipes-viewer.md`](../plans/2026-08-12-admin-shared-recipes-viewer.md)  
**対象 Spec:** [`docs/superpowers/specs/2026-08-12-admin-shared-recipes-viewer-design.md`](../specs/2026-08-12-admin-shared-recipes-viewer-design.md)  
**照合先（実装が正）:** `admin/`（`register.ts`, `app.ts`, `token.ts`, `sql-guard.test.ts`, `schemas.test.ts`, `shareJobs.ts`） / `supabase/tests/database/ops_readonly_role.test.sql`（`plan(38)`） / `compose.yaml` migrate・db-test / matrix  
**レビュー種別:** Plan 一次（Spec↔Plan 網羅・TDD 実行可能性・欠落コード・権限テスト・token 契約）  
**レビュー日:** 2026-08-12  
**編集:** なし（本ファイルのみ）

---

## Summary

Plan は設計（MF-I1…I8 反映後）を Task 1–6 に落としており、File map・token 必須ルート登録・sql-guard allowlist・FORBIDDEN_DTO・pgTAP の方向は live admin パターンと整合する。private 共有表は RLS off のため、親 admin plan で Critical だった「GRANT だけでは 0 行」問題は **本スライスでは再発しない**。

一方、writing-plans 契約に反する **実装本文の欠落**が複数ある。(1) Task 3 の `listSharedRecipes` / `getSharedRecipe` がコメント骨格のみで counts の SQL が無い。(2) mapper 成功パス golden と Task 4 Bearer テストがコメント止まり。(3) `select plan(N)` の N が「増やす」としか書かれておらず false-plan しやすい。(4) 受け入れの「一覧に preview キー無し」「日付必須 400」のテストが無い。UI 全文の省略は FeedbackPage 参照で許容寄りだが、サーバ側穴は実装者が推測で埋めると counts 定義や raw 露出を踏みやすい。

**Verdict: REVISE**（Critical 0 / Important 5 / Minor 3）

---

## Findings

### F1 — Severity: Important

- **Location:** Plan Task 3 Step 4 `listSharedRecipes` / `getSharedRecipe`  
- **Description:** 関数本体がコメントのみ。設計 §7.1 の counts（日付+mealType、status 非適用）と items WHERE、title 関数、JOIN origins、詳細の `menu_payload` SELECT が **実行可能な SQL として固定されていない**。writing-plans の「コメントで済ませる実装」禁止に抵触。  
- **Why it matters:** counts を status フィルタに誤って掛ける、一覧に payload を載せる、bind 忘れ、などの分岐が実装者ごとに起きる。  
- **Suggestion:** 完全な TypeScript + パラメータ bind SQL を Plan に埋め込む（counts 2 本 or FILTER、list 1 本、detail 1 本）。  
- **Status:** open

### F2 — Severity: Important

- **Location:** Plan Task 3 Step 2 success golden; Task 4 Bearer テスト  
- **Description:**  
  - `never includes menuPayload key in success path` が「fixtures で組み立て」コメントのみ。  
  - `requires bearer for shared-recipes when token configured` がコメントのみ。  
- **Why it matters:** RED→GREEN が回せず、MF-I7 の raw 非露出と token 契約がテストで固定されない。  
- **Suggestion:** 最小妥当 preview 用 fixture オブジェクトと `expect(JSON.stringify(r)).not.toMatch(/menu_payload/i)` を本文に書く。Bearer 無し 401 / 有り（pool null なら 400 db_unavailable 等）の expect を完成させる。  
- **Status:** open

### F3 — Severity: Important

- **Location:** Plan Task 1 Step 2 `plan` 件数  
- **Description:** 「追加 assert 数だけ増やす」のみ。live は `select plan(38)`。Plan 追記は `ok`×11 + `lives_ok`×1 = **+12** → **`plan(50)`** が正しい。N を誤ると pgTAP 全体が失敗または不足 assert で黙る。  
- **Suggestion:** Step 2 に `select plan(50);`（または現行 N + 12 の明示式）を書く。ファイル先頭コメント「6 GRANT 表」も 8 表へ更新指示を入れる。  
- **Status:** open

### F4 — Severity: Important

- **Location:** Plan Task 4 / Spec §13 受け入れ 2–5, 8  
- **Description:** ルートテストが token 未設定 404 中心。欠落:  
  - `from`/`to` 欠落 → 400  
  - 不正 `status` / `mealType` → 400  
  - 詳細 unknown UUID → 404  
  - 一覧 JSON に `preview` / `menu_payload` キーが無い（pool mock または schema 層で固定）  
- **Suggestion:** Task 4 Step 1 に上記ケースを追加。pool が要るものは mock client か、mapper/schema 層で担保する旨を分ける。  
- **Status:** open

### F5 — Severity: Important

- **Location:** Plan Task 3 detail title; Spec §7.2 Detail メタ = ListItem 同型  
- **Description:** 詳細は ListItem 同型のため `title` が必須。Plan の detail コメントは「同上メタ + menu_payload」だが title 関数呼び出しが明示されていない。mapper が payload から title を再計算するのか SQL か未固定。  
- **Suggestion:** detail SELECT にも `private.share_recipe_title_from_payload(r.menu_payload) AS title` を含めると固定する。  
- **Status:** open

### F6 — Severity: Minor

- **Location:** Plan Task 5  
- **Description:** UI が「FeedbackPage を手本」に留まり、列定義・token エラー文言のコピペ可能コードが無い。  
- **Suggestion:** 最低限 props と queryKey、エラー分岐の疑似コードブロックを足す（全文必須ではない）。  
- **Status:** open

### F7 — Severity: Minor

- **Location:** Plan Task 2 `totalElapsedMinutes: z.number().int().positive()`  
- **Description:** DB は 1–15。positive() は整合。問題なし寄り。`title.max(80)` も関数と一致。  
- **Status:** residual / 指摘せずとも可

### F8 — Severity: Minor

- **Location:** Plan Global / Task 1 migrate コマンド  
- **Description:** `docker compose run --rm migrate` は `compose.yaml` に service あり。OK。`npm run db:push` も存在。  
- **Status:** 問題なし（確認メモ）

---

## 良い点

- private 表 RLS off を前提にした GRANT のみ migration（user_feedback 型の policy 欠落を踏まない）
- token 未設定時ルート非登録は設計 MF-I2-A と一致
- sql-guard basename allowlist 方針
- FORBIDDEN に menu_payload 追加
- 本編非混入・本番 apply 禁止・local 検証既定

## Verdict

**REVISE** — F1–F5 を Plan 本文に埋めてから実装開始。
