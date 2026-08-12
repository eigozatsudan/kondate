# 1次レビュー: admin 共有レシピ閲覧 実装

**対象:** コミット `68d54913`..`672628c1`（HEAD `672628c1`）  
**Diff package:** `/tmp/admin-shared-recipes-impl-review/`（`full.diff` / `commits.txt`）  
**Spec:** `docs/superpowers/specs/2026-08-12-admin-shared-recipes-viewer-design.md`  
**Plan:** `docs/superpowers/plans/2026-08-12-admin-shared-recipes-viewer.md`  
**親設計:** `docs/superpowers/specs/2026-08-11-local-ops-admin-console-design.md`（§2.2 / §3.1 / §5.6）  
**照合:** live ファイル（`admin/**`、migration、pgTAP、matrix、親設計、token middleware / sql-guard / envelope）を diff のみに頼らず確認  
**レビュー種別:** 実装一次（設計適合 / セキュリティ・privacy / クエリ正しさ / sql-guard / token 必須 / preview all-or-nothing / 一覧 raw 非露出 / pgTAP / テスト / 受け入れギャップ / 親改訂）  
**レビュー日:** 2026-08-12  
**編集:** 本ファイルのみ（read-only レビュー。コード変更なし）

---

## Summary

実装は承認済み Spec / Plan の骨格を **高い忠実度** で満たしている。DB は `kondate_ops_readonly` への recipes/origins **SELECT のみ** + title 関数 **EXECUTE** + ops 索引、pgTAP `plan(50)` で DML 不可と `service_role` 非拡大を固定。BFF は `withReadOnly` + 列挙 SELECT、一覧は title 関数引数のみで **SELECT リストに `menu_payload` 列を載せない**、詳細は mapper で構造化 preview に投影して破棄。sql-guard は basename exact `sharedRecipes.ts` のみ `menu_payload` 許可。DTO は `FORBIDDEN_DTO_KEYS` に `menu_payload` / `menuPayload` を追加し、一覧 schema で `preview` キー無しを golden 固定。共有レシピ 2 ルートは `localToken` 設定時のみ register（未設定は WARN + 未登録 → 404）、設定時は既存 Bearer middleware で 401。UI は独立画面・注意文言・日付/status/mealType フィルタ・in-page 詳細 + PreviewPanel。壊れた payload / ネスト null は 500 にせず `previewError` に閉じる（commit `68d54913` 系 + `672628c1`）。

親設計 live の §2.2 / §3.1 / §5.6 は子設計と矛盾しない文言に **既改訂済み**（Plan も「再編集不要」）。本スライス commit 範囲外だが受け入れ §13.10 の正本としては充足。

一方、Spec §11 が求める回帰ネットに穴がある。**日付欠落テストが false-green**（400 の真因が `db_unavailable`）、**counts が status 非依存であることの実行証明が無い**。いずれも Critical（漏洩・権限昇格）ではないが、MF-I4 / 受け入れ検証の固定としては **Important**。実装本体の counts SQL・token 分岐・raw 非露出は live 上正しい。

## Verdict

**REVISE**

| 区分 | 件数 |
| --- | ---: |
| Critical | 0 |
| Important | 2 |
| Minor | 4（参考。判定には使わない） |

---

## Findings

### F1 — Severity: Important · Confidence: 92

- **Location:** `admin/server/src/app.test.ts` L100–111（`rejects shared-recipes without date range`） / `admin/server/src/lib/jst.ts` L80–98（`parseJstDateRange`） / Spec §7.1（`from`/`to` 必須）
- **Why it matters:** テスト名とコメントは「日付範囲無し → 400」を主張するが、`from`/`to` **両方省略**時は親と同型で **直近 7 日にフォールバック**し、`parseJstDateRange` は成功する。その後 `requirePool(null)` が `db_unavailable`（400）を投げるため、**status だけ見てパスする false-green** になる。日付必須の契約も、親 jst の任意省略も、どちらを正とするかがテストで固定されていない。将来 `pool` を渡した結合テストに差し替えた瞬間に「日付無しが通る」ことが露呈し、Spec §7.1 の「必須」解釈と衝突する。
- **Suggestion:**  
  1. 両方省略時の期待を明示する: (A) 親どおり 7 日 default を受容するならテスト名/コメントを直し `error.code` を assert しない、または (B) 共有レシピだけ from/to 必須にするなら route で片側・両方欠落を `date_range_required` にし、**error body の code** を assert。  
  2. 少なくとも `expect((await res.json()).error.code).toBe("…")` で真因を固定する。
- **Status:** open

### F2 — Severity: Important · Confidence: 88

- **Location:** `admin/server/src/queries/sharedRecipes.ts` L26–43（counts WHERE） vs L45–55（items WHERE） / Spec §7.1 counts 定義（MF-I4）・§11 route test「counts が status フィルタに依存しないこと」 / 受け入れ §13.2
- **Why it matters:** live SQL は counts に `status` を入れず、items にのみ入れる実装で **設計どおり正しい**。しかし `listSharedRecipes` の unit / mock-pool テストが無く、route テストも validation と token に限定されている。MF-I4 はレビューで固定された中核分岐であり、将来の「WHERE 共通化」リファクタで counts に status が混入しても **false-green のまま**残る。Spec §11 が明示する受け入れネットの欠落。
- **Suggestion:** `listSharedRecipes` に mock `PoolClient`（query 呼び出しと SQL/params を記録）の unit を 1 本追加し、`status: "active"` 指定時に (1) counts 用 SQL/params に status が無い (2) list 用には status がある、を assert。または handler 結合で同一 filter の counts が status 有無で不変であることを固定。
- **Status:** open

---

## Minor（参考・判定外 / confidence は参考値）

### M1 — 詳細 404 / 一覧 HTTP body の結合テスト不足 · ~78

- **Location:** `app.test.ts`（非 UUID → 400 のみ） / Spec §11「詳細 404」「一覧 body に preview キー無し」  
- 404 は `getSharedRecipe` null → `notFound()` で実装済み。preview 非露出は `schemas.test.ts` の list schema golden で固定済み。route 層の 404・シリアライズ結合は Plan も pool 依存で弱い。実装欠陥ではなく回帰ネットの薄さ。

### M2 — UUID 形式チェックが緩く、不正 36 文字で 500 になり得る · ~80

- **Location:** `register.ts` L247 `/^[0-9a-f-]{36}$/i` → `$1::uuid`  
- `------------------------------------` 等は regex を通り PG cast 失敗 → `fail` → `internal_error` 500。Spec は不正 400。親 `generations/:id` は形式チェック無しで同様。closed 500 で秘匿は守られる。`z.string().uuid()` 等へ寄せるとよい。

### M3 — disabled の視覚明示が弱い · ~70

- **Location:** `SharedRecipesPage.tsx` status 列 `render: (r) => r.status` / Spec §9.2  
- 文字列表示のみ。バッジ色や `font-semibold text-amber-*` 等は未実装。運用上は読めるが「視覚的に明示」は弱い。

### M4 — preview 主要文字列の長さ上限が Zod に無い · ~65

- **Location:** `shared/schemas.ts` preview 各 `z.string()` / Spec §7.2「長さ上限」  
- 構造・必須・strip・all-or-nothing は満たす。instruction 等の max は未設定。DB 由来・statement_timeout で緩和される残差。

---

## 設計との差分表（満たした / 未達）

| Spec / 受け入れ | 判定 | 根拠（live） |
| --- | --- | --- |
| §6.1 GRANT SELECT recipes/origins、EXECUTE title、DML なし | **OK** | `20260812120000_ops_readonly_shared_recipes.sql` |
| §6.2 ops 索引 `(created_at desc, id desc)` | **OK** | 同 migration |
| §6.3 一覧 title = 製品関数 | **OK** | `sharedRecipes.ts` L69 / L104 |
| §7.1 counts = 日付+mealType、status は items のみ | **OK（実装）** / テスト不足 F2 | counts WHERE に status 無し |
| §7.1 limit≤100・並び created_at/id DESC | **OK** | `clampLimit` + ORDER BY |
| §7.2 詳細 SELECT に menu_payload、DTO 非露出 | **OK** | get + mapper + Zod strip |
| §7.2 all-or-nothing preview / closed previewError | **OK** | `buildPreviewFromPayload` + tests（null 要素含む） |
| §7.2 preview フィールド固定・UUID/pantry 除外 | **OK** | pick + golden not match |
| §8 sql-guard basename only + FORBIDDEN_DTO | **OK** | `sql-guard.test.ts` / `schemas.ts` L305–307 |
| §8 一覧に preview/raw 無し | **OK** | schema golden + list SQL 列 |
| §4.8 / §7 token 必須（未設定は未登録） | **OK** | `register.ts` L203–263 + app.test 404/401 |
| §9 UI ナビ・ルート・注意・フィルタ・詳細パネル | **OK** | Layout / app / SharedRecipesPage |
| §9.2 disabled 視覚明示 | **部分** | M3 |
| §10 / README token・本番 host 注意 | **OK** | `admin/README.md` |
| §11 pgTAP SELECT/DML/service_role | **OK** | `ops_readonly_role.test.sql` plan(50) |
| §11 authenticated/anon 表 SELECT 非拡大 | **OK（他テスト）** | `share_community_emergency.test.sql` 既存 |
| §11 counts 回帰テスト | **未達** | F2 |
| §11 日付必須 400 の固定 | **不正確** | F1 false-green |
| §13.7 書込 UI/API 無し | **OK** | GET のみ・disabled ボタン無し |
| §13.10 親設計と矛盾しない | **OK** | 親 §2.2 / §3.1 / §5.6 live 改訂済み |
| 親同一単位改訂（§4.1） | **プロセス上は先行改訂** | 本 commit 範囲に親 diff 無し。Plan「既改訂・再編集不要」。live 正本は整合 |

---

## Positive notes

1. **token 必須の二重構造:** ルート未登録（token null）+ 既存 Bearer middleware（token set）。起動 WARN 文言・README 404/401 切り分け（`6a0d7f32` / README）が運用可能。  
2. **raw 非露出の層が厚い:** SELECT 列挙 → mapper 投影のみ → Zod DTO → FORBIDDEN キー → sql-guard basename → schema/mapper golden。一覧 SQL は title 関数引数のみ。  
3. **all-or-nothing が実害を潰している:** `dishes:[null]` 等で TypeError→500 にせず `invalid_menu_payload`（`672628c1`）。未知 schemaVersion は `unsupported_schema_version`。  
4. **counts 実装が MF-I4 どおり:** 2 クエリ分離で status の混入余地が読みやすい。  
5. **権限境界:** service_role 非 SELECT を pgTAP で固定。matrix Notes 更新済み。本編 `src/` / Functions 非接触。  
6. **closed error:** envelope / onError が SQLSTATE・payload を外に出さない。

---

## Residual risks / 受け入れチェック

### Spec 受容・再リトゲートしない

- 製品 `list_active` の limit 20 / salt 非適用（§4.2）。  
- 一覧 title の jsonb TOAST 読み（§6.3 / MF-I3）。生成列は follow-up。  
- 親の token 任意（共有レシピ以外）・共有 PC 残差。  
- `.env.admin` 本番誤接続は人間 host 目視（README）。エージェント自動本番接続は対象外。  
- `rejectUnauthorized: false` 等の親 admin 接続方針。

### 手動受け入れ（local）の確認ポイント

1. `.env.admin` に `ADMIN_LOCAL_TOKEN` + local DB。ナビ「共有レシピ」→ 日付範囲内一覧。  
2. status / mealType フィルタが items に効く。counts が status 変更で変わらず mealType で変わること（F2 自動化推奨）。  
3. 詳細で料理・材料・手順・timeline・adaptations。Network に `menu_payload` / `menuPayload` オブジェクト無し。  
4. 壊した payload / 未知 schemaVersion → preview 無し + closed code。500 にしない。  
5. token 未設定再起動 → `/api/shared-recipes` 404。設定後 Bearer 欠落 → 401。  
6. 書込 UI が無いこと。

### Suggested merge gate

1. F1: 日付テストの真因 assert、または共有レシピ専用の from/to 必須化 + code assert  
2. F2: counts が status 非依存である unit / mock テスト  

上記 Important を閉じれば **PROCEED / APPROVE 相当**。Critical は現状なし。
