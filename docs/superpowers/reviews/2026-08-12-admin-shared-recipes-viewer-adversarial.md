# 敵対的レビュー: admin 共有レシピ閲覧設計

**対象:**  
[`docs/superpowers/specs/2026-08-12-admin-shared-recipes-viewer-design.md`](../specs/2026-08-12-admin-shared-recipes-viewer-design.md)

**照合ソース（実装・契約を正）:**  
- 親 [`2026-08-11-local-ops-admin-console-design.md`](../specs/2026-08-11-local-ops-admin-console-design.md) §2.2 / §3.1 / §5.6 / §6.1  
- `docs/testing/database-access-matrix.md`（shared_emergency_* / list_active）  
- `supabase/migrations/20260801190000_share_community_emergency.sql`  
- `supabase/migrations/20260811180000_ops_readonly_role.sql`  
- `admin/server/src/queries/sql-guard.test.ts`, `shareJobs.ts`, `middleware/token.ts`, `db.ts`  
- `admin/shared/schemas.ts`（`FORBIDDEN_DTO_KEYS`）  
- `shared/contracts` 周辺の share pool LIMIT（製品 `list_active` limit ≤ 20）

**敵対姿勢:** ship バイアスを前提に、本文（構造化後含む）を ops 面へ開く blast radius、親不変条件の片側無効化、GRANT 拡大、sql-guard 穴、scrape、本番負荷、token 任意、origins 再識別を突く。編集なし・読取のみ。  
**レビュー日:** 2026-08-12

---

## Summary

子設計は親 admin の **意図的例外**として共有プールを構造化閲覧する。骨格（ops RO LOGIN 継承、GET only、生 payload 非レスポンス、独立画面）は親 adversarial で BLOCK 解除済みの土台に乗っており、**書込可能クレデンシャル問題を新たに起こすものではない**。

ただし次が残る。

1. **親 §3.1 正本が未改訂のまま実装可能に読める**（子 §12.7「任意」）— プロセスと二重の正。  
2. **token 任意のまま再利用価値の高いレシピ構造が GET 可能** — 親残差の深刻度上昇。  
3. **一覧が title のために行ごと jsonb を読む** — 本番負荷・timeout。  
4. **製品 pool API（limit 20 / salt / active）を admin 直 SELECT が迂回** — 日付+limit はあるが scrape 耐性は弱い。  
5. **origins 既定相関** — 匿名プールの運用再識別。  
6. **sql-guard 例外 + FORBIDDEN_DTO 未更新** — 回帰網の穴。

Critical（設計どおりに本番破壊・無制限 PII 流出が起きる）までは、既存 Host allowlist + RO ロールがあるため上げない。一方、親改訂と本文 API の token/負荷契約を閉じるまで実装着手は危険。

**総合判定: `BLOCK_WITH_CONDITIONS`**

条件充足後は `PROCEED_WITH_RESIDUALS`（単一オペレータ・共有 PC 禁止・本番目視は人間）へ下げられる。

---

## Attack scenarios

| # | シナリオ | 判定 | 根拠 |
| --- | --- | --- | --- |
| 1 | 親 §3.1 を改訂せず子だけ ship し、後続が親を正に preview をリバート or 二重解釈 | **成立** | 子 §4.1 は改訂文言、§12.7 は親更新「任意」。親 L80 はなお「常時除外」。 |
| 2 | `ADMIN_LOCAL_TOKEN` 未設定で同一ホスト他 UID が構造化レシピを全 GET | **成立** | `token.ts` L23–25: token null なら通過。子は token 昇格なし。 |
| 3 | offset 連打 + 広い日付でプール全文（構造化）を scrape | **部分成立** | 日付必須・limit≤100 はある。製品 `list_active` の 20 件/salt 境界は無い。累積 pool は日次 cap を超えて残り得る。 |
| 4 | 一覧 SQL が `share_recipe_title_from_payload(r.menu_payload)` で jsonb 全読 → 15s timeout / pool 占有 | **成立しうる** | title のためでも TOAST 読み。ops timeout 15s。索引は created_at 系のみ。 |
| 5 | 詳細 SELECT の `menu_payload` が mapper バグで JSON に残る | **部分成立** | 設計は mapper+Zod 二重。`FORBIDDEN_DTO_KEYS` に menu_payload 未掲載（現状 schemas）。テスト不足で漏洩。 |
| 6 | sql-guard の allowlist をファイル名偽装・別 path にコピーして回避 | **成立しうる** | basename 一致のみだと `../sharedRecipes.ts` やリネーム漏れに依存。実装契約が弱いと穴。 |
| 7 | origins JOIN で contributor × 本文を相関（同意の「誰が作ったか出ない」と緊張） | **成立（運用特権）** | 設計が既定 JOIN。製品 list_active は contributor 非露出。 |
| 8 | GRANT を誤って service_role / authenticated に広げる | **migration ミスで成立** | 設計は ops のみと明記。pgTAP で他ロール表 GRANT 不増加を要求しているが SQL スケッチに REVOKE 確認が薄い。 |
| 9 | preview schema が緩く `z.record(z.unknown())` になり raw 相当 | **成立しうる** | adaptations「等」、admin 専用 schema で「厳格すぎない」とある。下限の閉じが弱い。 |
| 10 | 本番 `.env.admin` 接続で実装検証・seed・手動が本番を叩く | **運用で成立** | 子 §10 は注意済み。エージェント自動接続禁止は良いが、開発者が compose.admin をそのまま up する経路は残る。 |
| 11 | disabled 行の本文が常時読める（kill switch 後も ops 全文） | **成立（意図しうる）** | status フィルタ任意。監査には有用。悪用時は「消したつもり」が ops に残る。 |
| 12 | PostgREST で private pool が読める | **反証** | REVOKE ALL + matrix。admin 直 SQL が新しい読み口。 |
| 13 | title 関数の DML 副作用 | **反証** | immutable、search_path 固定。 |
| 14 | email が origins 経由で出る | **反証（追加実装が要る）** | auth.* 非 join。UUID のみ。 |
| 15 | 書込 API で disabled 化を誤実装 | **設計上反証** | GET only。実装逸脱時のみ。 |

---

## Findings

### Critical

なし（既存 `kondate_ops_readonly` + Host allowlist + GET only を継承。新規 owner URL 問題は起こさない）。

---

### Important（BLOCK 解除の実質条件）

#### I1. 親設計正本の未改訂を許すと禁止リストが分裂する

- **信頼度:** 94  
- **箇所:** 子 §4.1 / §12.7; 親 §3.1 L80 / §5.6  
- **説明:** 子は禁止の意味を「生 payload 禁止・構造化可」に変えるが、親表が「常時除外」のまま残る経路を §12.7 が「任意」で残している。  
- **修正要求:** 親 §3.1 / §5.6 / 必要なら §2.2 を **同一実装 PR 必須**で改訂。子 §12.7 の「任意」を削除。受け入れに矛盾ゼロを追加。

#### I2. 本文相当 API で token が任意のまま — blast radius 上昇を技術的に抑えていない

- **信頼度:** 91  
- **箇所:** 子 §1; `token.ts` L23–25; 親 §6.1  
- **説明:** 構造化 dishes/steps は feedback 以上に再利用可能。loopback 他 UID の curl でダンプ可能。  
- **修正要求:**  
  1. **推奨:** `/api/shared-recipes*` は `ADMIN_LOCAL_TOKEN` 必須（未設定時はルートを載せない or 起動時 warn+該当 API 403）。  
  2. 受容するなら設計 §4 に「残差: token 任意のまま本文相当を公開。共有 PC 禁止が唯一の補償」と明示し人間承認。

#### I3. 一覧の title 導出による本番 jsonb 読み負荷

- **信頼度:** 88  
- **箇所:** 子 §6.3 / §7.1; ops statement_timeout 15s  
- **説明:** title 関数は payload 全体を引数に取る。一覧でも TOAST 読み。31 日 × 100 行で timeout し得る。  
- **修正要求:** 負荷を受け入れ条件に書く。必要なら list 既定 limit を下げる（例 50 厳守）/ 日付上限再掲。将来 title 列は follow-up。timeout 時 closed error（payload をログに出さない）。

#### I4. 製品 pool 境界迂回（scrape）

- **信頼度:** 86  
- **箇所:** `list_active_shared_emergency_recipes` limit≤20; 子 §7.1 offset  
- **説明:** admin は active/disabled・広い日付・offset で構造化本文を順に取れる。日付必須は緩和だが hard cap（例: 1 セッションあたりの詳細取得数）は無い。  
- **修正要求:** 第1版は「単一オペレータの目視」残差として明記で可。強化するなら詳細 API の短い rate limit または UI のみ連続取得。少なくとも **一覧に preview を載せない**（設計どおり）をテストで固定。

#### I5. origins 既定相関の privacy 沈黙

- **信頼度:** 85  
- **箇所:** 子 §6.1 / §7.1; share 設計の匿名プール  
- **説明:** contributor UUID × 構造化本文が揃う。製品 UI の匿名性とは別。  
- **修正要求:** 設計に運用特権として明記。出さないなら JOIN/GRANT 削除。

#### I6. sql-guard 例外と FORBIDDEN_DTO の片輪

- **信頼度:** 87  
- **箇所:** 子 §8; `sql-guard.test.ts`; `schemas.ts` FORBIDDEN_DTO_KEYS  
- **説明:** ファイル allowlist だけでは不十分。DTO 禁止キーに menu_payload が無い。  
- **修正要求:**  
  - allowlist は **basename 完全一致** `sharedRecipes.ts` のみ。  
  - `FORBIDDEN_DTO_KEYS` に `menu_payload` / `menuPayload`。  
  - detail の golden test: シリアライズ JSON に `"menu_payload"` / `"menuPayload"` が出現しない。

#### I7. preview 契約の「等」と緩いパース方針

- **信頼度:** 84  
- **箇所:** 子 §7.2 adaptations「等」; 「厳格すぎて常に null にならない」  
- **説明:** 下限が無いと passthrough 実装に滑る。  
- **修正要求:** adaptations フィールドを列挙固定。未知キー strip。部分成功（dishes だけ出す）か all-or-nothing かを一文で固定（推奨: all-or-nothing で preview null + code）。

#### I8. migration 誤 GRANT の pgTAP 契約が「方針」止まり

- **信頼度:** 82  
- **箇所:** 子 §6.1 / §11  
- **説明:** service_role 等への表 GRANT 不拡大を文章では言うが、inventory テストへの具体 assert が薄い。  
- **修正要求:** pgTAP に `not has_table_privilege('service_role', 'private.shared_emergency_recipes', 'select')` 等を明示（現行 inventory 方針に合わせる）。ops は SELECT true / INSERT false。

---

### Minor

#### M1. disabled 本文が常時読める

- 監査には有用。UI で status を目立たせ「kill 後も ops 可読」と注意。

#### M2. 未知 schemaVersion

- closed `unsupported_schema_version` を推奨。

#### M3. 本番 compose 誤起動

- README に「起動前に `ADMIN_DATABASE_URL` の host を目視」チェックリスト。

#### M4. title 80 字と全文プレビューの差

- 一覧 title は切り詰め、詳細は全文 — 意図どおり。UI で混同しないこと。

---

## 反証・低リスク

| 項目 | 判定 |
| --- | --- |
| owner/`postgres` URL 必須化の再発 | 反証（既存 ops RO を継承） |
| title 関数 DML | 反証（immutable） |
| PostgREST 既存露出 | 反証 |
| Netlify 混入 | 親分離を維持すれば弱い |
| email 直出し | 反証（auth join 禁止） |
| `.env.admin` gitignore 欠落 | 親実装後は閉じている想定（tree で確認済みなら残差は運用のみ） |

---

## BLOCK 解除条件

実装 plan / migration / admin コード前に:

- [ ] **I1** 親設計を必須改訂（子 §12.7 の任意を削除）  
- [ ] **I2** 本文相当 API の token 方針を技術強制 or 明示残差承認  
- [ ] **I3** 一覧負荷の受け入れ・timeout 契約  
- [ ] **I5** origins 相関の privacy 一文  
- [ ] **I6** sql-guard basename + FORBIDDEN_DTO  
- [ ] **I7** adaptations フィールド固定と all-or-nothing  
- [ ] **I8** pgTAP の他ロール非 GRANT  
- [ ] **I4** scrape 残差を §4 に残差として書くか緩和策

Critical 0 のまま上記 Important を設計に反映し、二次が CONFIRMED すれば **PROCEED_WITH_RESIDUALS**（共有 PC 禁止・本番は人間目視・RO ロール依存）で plan 可。

---

## メタ

- 種別: 設計敵対的レビュー（実装前）  
- 総合: **BLOCK_WITH_CONDITIONS** / Critical **0** / Important **8** / Minor **4**  
- 編集: なし  
