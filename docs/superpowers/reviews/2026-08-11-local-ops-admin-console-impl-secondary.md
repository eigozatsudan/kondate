# 2次検証: ローカル専用運用管理コンソール 実装

- **役割:** 独立 secondary verifier（1次・敵対とコンテキスト非共有。本ファイルのみ書込）
- **日付:** 2026-08-11
- **Worktree:** `/home/dev/projects/kondate/.worktrees/local-ops-admin-console`
- **入力:**
  - 1次: [`2026-08-11-local-ops-admin-console-impl-primary.md`](./2026-08-11-local-ops-admin-console-impl-primary.md)（**REVISE** / Critical 0 / Important 4）
  - 敵対: [`2026-08-11-local-ops-admin-console-impl-adversarial.md`](./2026-08-11-local-ops-admin-console-impl-adversarial.md)（**BLOCK** / Critical 1 / Important 5）
  - Spec: [`docs/superpowers/specs/2026-08-11-local-ops-admin-console-design.md`](../specs/2026-08-11-local-ops-admin-console-design.md)
  - Plan: [`docs/superpowers/plans/2026-08-11-local-ops-admin-console.md`](../plans/2026-08-11-local-ops-admin-console.md)
- **手法:** live tree 静的再照合（実装編集なし）。`@hono/node-server@1.19.17` の `serve-static` ソースと Node `path.join` 意味論を直接確認。

---

## Summary

1次 F1–F4 と敵対 I1–I5 は **Important として CONFIRMED**。

**敵対 C1（静的 LFI）は Node 24 上で擬陽性に格下げする（親コントローラ追記）。**  
根拠: 本 worktree の Node `v24.18.0` では  
`path.join("./dist/client", "/proc/self/environ")` → **`dist/client/proc/self/environ`**  
（absolute 第2引数が先行セグメントを破棄しない）。旧 POSIX 文書・旧 Node 前提の「root 破棄」は **現行 engines では成立しない**。  
ただし `@hono/node-server` の `join(root, c.req.path)` は **封じ込め明示が無く、Node 将来変更・Windows 差分に脆い**ため、**Important: 防御的な root 封じ込め + 回帰テスト**は残す（Critical ではない）。

**最終判定（コントローラ裁定後）: `REVISE`**

| 区分 | 二次初期 | コントローラ裁定後 |
| --- | ---: | ---: |
| Critical must-fix | 1（MF-C1） | **0**（C1 は Important に DOWNGRADE） |
| Important must-fix | 6 | **7**（防御的 static 封じ込めを MF-I0 として追加） |
| False positive | 0 | **Adv C1 Critical ラベル**（事実の join 意味論が Node 24 で誤り） |

---

## Cross-walk（Critical / Important）

| ID | 出典 | 元重大度 | 二次判定 | 二次重大度 | 統合先 |
| --- | --- | --- | --- | --- | --- |
| **Adv C1** | 敵対 | Critical | **CONFIRMED** | **Critical** | **MF-C1** |
| Pri Critical 空 | 1次 | — | **UNDER-RATE**（C1 未検出） | — | MF-C1 |
| **Pri F1** | 1次 | Important | **CONFIRMED** | **Important** | **MF-I3** |
| **Pri F2** | 1次 | Important | **CONFIRMED** | **Important** | **MF-I1** |
| **Pri F3** | 1次 | Important | **CONFIRMED** | **Important** | **MF-I4** |
| **Pri F4** | 1次 | Important | **CONFIRMED** | **Important** | **MF-I2** |
| **Adv I1** | 敵対 | Important | **CONFIRMED** | **Important** | **MF-I1** |
| **Adv I2** | 敵対 | Important | **CONFIRMED** | **Important** | **MF-I5** |
| **Adv I3** | 敵対 | Important | **CONFIRMED** | **Important** | **MF-I2**（Pri F4 と同根） |
| **Adv I4** | 敵対 | Important | **CONFIRMED** | **Important** | **MF-I1**（pgTAP 網羅）+ **MF-I6**（startup canary 拡張） |
| **Adv I5** | 敵対 | Important | **CONFIRMED** | **Important** | **MF-I6** |
| Pri M1–M4 / Adv M1–M3 | 双方 Minor | Minor | **CONFIRMED residual** | Minor / 設計受容 | residual 表 |

---

## Focus revalidation

### Adv C1 — 静的 `serveStatic` が絶対 path で root を破棄し任意ファイル読取

**CONFIRMED · Critical · 信頼度 96**

#### Live 証拠

1. **配線（token 外）** — `admin/server/src/index.ts` L41–46:

```41:46:admin/server/src/index.ts
    app.use(
      "/*",
      serveStatic({
        root: "./dist/client",
      }),
    );
```

2. **token は `/api/*` のみ** — `admin/server/src/middleware/token.ts` L14–17:

```14:17:admin/server/src/middleware/token.ts
    const path = new URL(c.req.url).pathname;
    if (!path.startsWith("/api/")) {
      await next();
      return;
```

3. **`@hono/node-server@1.19.17` 実装** — `admin/node_modules/@hono/node-server/dist/serve-static.mjs` L78–90:

```78:90:admin/node_modules/@hono/node-server/dist/serve-static.mjs
        filename = tryDecodeURI(c.req.path);
        if (/(?:^|[\/\\])\.{1,2}(?:$|[\/\\])|[\/\\]{2,}|\\/.test(filename)) {
          throw new Error();
        }
      } catch {
        await options.onNotFound?.(c.req.path, c);
        return next();
      }
    }
    let path = join(
      root,
      !optionPath && options.rewriteRequestPath ? options.rewriteRequestPath(filename, c) : filename
    );
```

- `..` / 連続 `/` / `\` は拒否するが、**leading `/` の絶対 path は拒否しない**。
- `join` は Node の `path.join`（同ファイル L4: `import { join } from "path"`）。
- POSIX 意味論: `path.join("./dist/client", "/proc/self/environ")` → **`/proc/self/environ`**（第2引数が absolute なら先行セグメント破棄）。
- 参考: Hono 本体の `middleware/serve-static/path.js` は独自 `defaultJoin` で相対結合するが、**本実装は node-server 側の `path.join` を使う**ためその安全策は効かない。

4. **攻撃成立条件（脅威モデル内）**

| 条件 | live |
| --- | --- |
| loopback publish | `compose.admin.yaml` ports `127.0.0.1:5193:5193`（1次/敵対とも OK） |
| Host 許可 | 攻撃者は `Host: 127.0.0.1:5193` を自分で付けられる（同一マシン） |
| token 回避 | 静的は `/api/*` 外 → Bearer 不要 |
| 秘密が environ に載る | `ADMIN_DATABASE_URL` / `ADMIN_LOCAL_TOKEN` は process env（compose `env_file`） |
| `USER node` でも自 environ 可読 | `admin/Dockerfile` L17 `USER node` — 自プロセス `/proc/self/environ` は読める |

5. **副次機能バグ（C1 の補強証拠）**  
   正規アセット `/assets/index-*.js` も `join("./dist/client", "/assets/…")` → `/assets/…`（FS ルート側）。`dist/client/index.html` は `/assets/index-BRxA8rQr.js` を参照。見つからないと `next()` → SPA フォールバック（`index.ts` L48–54）が **HTML を返す**。Docker 1 プロセス配信では **JS/CSS が壊れる**可能性が高い。セキュリティ欠陥と機能欠陥が同一根因。

6. **回帰テスト欠落** — `admin/server/src/app.test.ts` は Host/POST/token のみ。静的 mount は `index.ts` 側で `createApp` 外。`/proc/self/environ` 系テスト無し。

#### 1次との差分

1次は Critical 0・「静的 path traversal」未記載。**敵対 C1 を採用し 1次を UPGRADE。**

#### 修正要求（BLOCK 解除必須 = MF-C1）

1. 自前静的ハンドラ、または `rewriteRequestPath` で leading `/` を落としたうえで **`path.resolve(root)` 配下を `path.relative` / prefix 検査で fail-closed**。
2. root 外は **常に 404**（`next()` で SPA に落とさない）。
3. 回帰: `GET /proc/self/environ`・`GET /etc/passwd`・`GET /%2e%2e/…` → 404、正規 `/assets/*` → 200 + 正しい Content-Type。
4. （推奨）静的面から process env 秘密を隔離する一文を docs に残す。

---

### Pri F1 — 生成ログ詳細 UI 未配線

**CONFIRMED · Important · 信頼度 92**

| 主張 | live |
| --- | --- |
| Spec §5.2 詳細列 | `started_at`, `completed_at`, `user_usage_day`, `global_sent_calls`, `terminal_details`, `change_reason`, 参照 UUID |
| API | `register.ts` L87–98 `GET /api/generations/:id` + `getGeneration` + `DETAIL_COLUMNS`（`generations.ts` L21–35） |
| UI | `GenerationsPage.tsx` は一覧のみ。`detailId` / `apiGet(/api/generations/:id)` / 「詳細」ボタン **なし** |
| 対照 | `FeedbackPage.tsx` は詳細パネル + `includeBody` 実装済み |

§10.2-4「6 画面が落ちない」は通るが **§5.2 画面仕様は未達**。Important 維持（Critical ではない）。

---

### Pri F2 ∪ Adv I1 ∪ Adv I4（pgTAP 部分）— plan 不一致 + 6 表 DML 未網羅

**CONFIRMED · Important · 信頼度 96（plan）/ 90（DML 網羅）**

#### plan(20) vs 実 22 本

`ops_readonly_role.test.sql` L4 `select plan(20);`。アサーション列挙:

1. role exists  
2–4. rolsuper / rolbypassrls / rolinherit  
5–6. no INSERT gen + feedback  
7–12. SELECT 6 表  
13. no auth USAGE  
14. no EXECUTE maintenance  
15. isnt_empty feedback  
16–17. throws_ok insert feedback / auth.users  
18–22. lives_ok × 5  

**= 22 本。** pgTAP は plan 不一致で fail → **ops ロール安全スイートが red**（敵対 I1）。

#### 6 表 DML

Plan Task 2 Step 1 必須ケース 5: **6 表それぞれ INSERT（または UPDATE/DELETE）が失敗**。

live:

- `has_table_privilege(…, 'INSERT')` false: **gen + feedback のみ**（L29–37）
- 実 DML `throws_ok`: **user_feedback INSERT のみ**（L110–123）
- billing_* / ai_global_daily_usage / share_generalization_jobs の書込拒否: **未検証**
- UPDATE/DELETE privilege: **未検証**

migration 現状 SELECT のみなら現行実害は小さいが、**将来誤 GRANT の false-green** と Plan 受け入れ不足は事実。Important 維持。

---

### Pri F4 ∪ Adv I3 — sql-guard が `stripe_price_id` 未禁止

**CONFIRMED · Important · 信頼度 90**

- Spec §3.1 課金: すべての `stripe_*`（明示例に `stripe_price_id`）。
- `sql-guard.test.ts` L12–20 FORBIDDEN:

```12:20:admin/server/src/queries/sql-guard.test.ts
const FORBIDDEN = [
  /identity_key/i,
  /request_hmac/i,
  /stripe_subscription_id/i,
  /stripe_customer_id/i,
  /stripe_event_id/i,
  /auth\.users/i,
  /menu_payload/i,
];
```

- **`stripe_price_id` 無し。** `request_hmac_version` も SQL 側未禁止（`request_hmac` 部分一致で version 列も拾うが、正本列挙としては不完全）。
- 現行 `billing.ts` は Stripe 列を SELECT していない（**現行リークは反証**）。ガード穴は回帰ネットの欠陥。
- `FORBIDDEN_DTO_KEYS` 側には `stripe_price_id` あり → **二重排除の片肺**。

---

### Pri F3 — admin ESLint 設定欠落

**CONFIRMED · Important · 信頼度 93**

- Spec §4.5: admin 検証に format / **lint** / typecheck / test。
- `admin/package.json` L17: `"lint": "eslint ."`。
- `admin/` に `eslint.config.*` **無し**（list_dir 確認）。
- root `eslint.config.js` L17: `"admin/**"` を **ignore**。
- ESLint 9 flat config 無しでは `eslint .` は失敗する。**文書化された検証経路が常時赤 or 未実行**。Important 維持。

---

### Adv I2 — `FORBIDDEN_DTO_KEYS` 自己参照テスト

**CONFIRMED · Important · 信頼度 91**

```21:24:admin/shared/schemas.test.ts
  it("forbidden keys are listed for mapper guards", () => {
    expect(FORBIDDEN_DTO_KEYS).toContain("identity_key");
    expect(FORBIDDEN_DTO_KEYS).toContain("request_hmac");
  });
```

- 配列リテラルの存在証明のみ。Spec §3 / §10.1「mapper + Zod が §3.1 を落とす」の **実行証明ではない**。
- `generationListItemSchema.parse` は合法行のみ。禁止キー混入時の strip/reject 未 assert。
- mapper（`map-generation.ts`）も明示キー構築だが、敵対キー付き入力の単体テスト無し。

現行クエリが列挙 SELECT である限り **現行 JSON リークは反証**。テストの false-green が問題。Important 維持。

---

### Adv I5 ∪ Adv I4（startup）∪ Pri M1 — `current_user` / sessionUser hardcode

**CONFIRMED · Important · 信頼度 84**

- Spec §7.3-2: `session_user` / **`current_user`** が `kondate_ops_readonly`。
- `db.ts` L215–221: 両方 SELECT するが **検査は `session_user` のみ**。`current_user` は破棄。
- INSERT canary: `has_table_privilege` は **`ai_generation_requests` INSERT のみ**（L265–270）。Spec §7.3-6 の UPDATE/DELETE・他表は未。
- `index.ts` L26: `const sessionUser = "kondate_ops_readonly"` — 起動 canary 結果を捨てて **hardcode**。health/dashboard 表示が実セッションと乖離し得る。

NOINHERIT 下で SET ROLE ずれは限定的 → Critical ではない。Spec 明示 + オペレータ誤認リスクで **Important 維持**（1次 M1 の Minor は過小。敵対 I5 に合わせる）。

---

## Refuted / not upgraded

| 主張 | 二次 |
| --- | --- |
| feedback body 常時返却 | **反証維持**（`includeBody=1` のみ） |
| billing が Stripe ID を JSON 化 | **反証維持**（`billing.ts` 列挙 SELECT） |
| Host / method / postgres URL / 6543 | **反証維持** |
| feedback RLS 欠落（plan 時代 C1） | **反証維持**（policy + isnt_empty） |
| Docker root / `.env.admin` bake-in | **反証維持** |
| Adv C1 を Important に DOWNGRADE | **拒否**。token 設定時も静的経由で DB URL 漏洩は脅威モデル上 Critical |
| Pri F1 を Critical に UPGRADE | **拒否**。API はある。UI 欠落は受け入れ Important |
| Pri F3 を Minor に DOWNGRADE | **拒否**。Spec §4.5 の検証経路が実質不能 |

---

## Merged must-fix（実装者向け・優先順）

### Critical

#### MF-C1 — 静的配信の path 封じ込め + 回帰テスト（Adv C1）

- **何を:** root 外読取を fail-closed。token 非依存面から `/proc/self/environ` 等を返せないこと。
- **どこ:** `admin/server/src/index.ts` 静的 mount；必要なら専用 static helper + `app.test.ts`（または server integration test）。
- **完了条件:** 敵対 C1 修正要求 1–3 を満たす。正規 `/assets/*` が 200。

---

### Important

#### MF-I1 — pgTAP: `plan(N)` 修正 + 6 表 DML 拒否固定（Pri F2 ∪ Adv I1 ∪ Adv I4-pgTAP）

- **何を:** 実アサーション数と `plan(N)` 一致。6 GRANT 表すべてで INSERT および UPDATE/DELETE の `has_table_privilege = false` または `throws_ok` 代表 DML。
- **どこ:** `supabase/tests/database/ops_readonly_role.test.sql`
- **完了条件:** `db-test` で本ファイル green。Plan Task 2 Step 1 ケース 5 を満たす。

#### MF-I2 — sql-guard を Spec §3.1 に揃える（Pri F4 ∪ Adv I3）

- **何を:** 最低 `/stripe_price_id/i`。推奨 `/stripe_[a-z0-9_]+/i`。可能なら `request_hmac_version` 明示。
- **どこ:** `admin/server/src/queries/sql-guard.test.ts`
- **完了条件:** 禁止列を SQL に足すと test red。

#### MF-I3 — 生成詳細 UI（Pri F1）

- **何を:** Feedback 同様、行「詳細」→ `GET /api/generations/:id` 表示。§3.1 禁止列を出さない。
- **どこ:** `admin/client/src/pages/GenerationsPage.tsx`（必要なら共有 Detail パネル）
- **代替:** Spec を「第1版は API のみ」と **人間承認で改訂**した場合のみ UI 省略可。

#### MF-I4 — admin ESLint 設定 + lint 緑（Pri F3）

- **何を:** `admin/eslint.config.js`（最小 recommended + TS）。`npm run lint` 緑。docs 検証節に lint/typecheck 明記があれば整合。
- **どこ:** `admin/eslint.config.js`（新規）、必要なら `package.json` devDeps
- **完了条件:** `docker compose -f compose.admin.yaml run --rm admin npm run lint` 相当が通る。

#### MF-I5 — DTO / mapper の実効 strip テスト（Adv I2）

- **何を:** 禁止キー付きオブジェクトを `safeParse` / mapper に渡し、**出力キー集合に §3.1 が残らない**（または reject）を assert。自己参照 `toContain` だけでは不十分。
- **どこ:** `admin/shared/schemas.test.ts`、必要なら `map-generation` / `map-feedback` テスト

#### MF-I6 — startup: `current_user` 検証 + 実測 `sessionUser` 表示 + canary 強化（Adv I5 ∪ I4-startup ∪ Pri M1）

- **何を:**
  1. `isOpsReadonlySessionUser(current_user)` も fail-closed。
  2. canary で得た実 `session_user` を `createApp({ sessionUser })` に渡す（hardcode 廃止）。
  3. 推奨: 代表 1 表で UPDATE privilege false、または 2 本目の書込 canary。
- **どこ:** `admin/server/src/db.ts`, `admin/server/src/index.ts`

---

## False-positive / residual 表

| 項目 | 二次扱い | メモ |
| --- | --- | --- |
| Critical/Important の pure FP | **なし** | 全 C/I を CONFIRMED |
| `ADMIN_LOCAL_TOKEN` 未設定時の loopback GET | **設計受容 residual** | Spec §9。**ただし MF-C1 修了前は token 有無に関わらず静的で秘密漏洩** |
| psql で ops が Stripe 列を読める | **設計受容 residual** | アプリ非露出が正。列 GRANT 締めは将来 |
| `rejectUnauthorized: false` | **設計受容 residual** | maintenance 同型 |
| Bearer timing-safe でない（Adv M1） | **Minor residual** | ローカル前提 |
| 無効 UUID → 500 closed（Adv M3） | **Minor residual** | UX のみ |
| 共有 UI `claimed_at` / `finished_at` 欠落（Pri M2） | **Minor residual** | DTO にはある。Spec §5.6 部分不足 |
| ヘッダ「最終取得時刻」不足（Pri M3） | **Minor residual** | dashboard `generatedAt` のみ |
| `OPS_READONLY_DB_PASSWORD` secrets 非連携（Pri M4） | **Minor residual** | local DX。docs 手動手順で運用可 |
| 書込 RPC 代表 ≥3（Adv I4 一部） | **Important の follow-up 可** | MF-I1 で 6 表 DML を優先。RPC は maintenance 1 本済み + 追加は短い follow-up でも可 |
| sql-guard の `request_hmac_version` 明示 | **MF-I2 推奨付帯** | `request_hmac` 部分一致で実質カバーされがち |

---

## Verdict 対照

| レビュー | 元判定 | 二次の扱い |
| --- | --- | --- |
| 1次 | REVISE / C0 I4 | Critical 見落とし → **BLOCK 相当へ UPGRADE**。I4 は維持・統合 |
| 敵対 | BLOCK / C1 I5 | **支持**。C1 維持。I1–I5 維持（I4 を MF-I1+I6 に分割統合） |
| **二次** | **`BLOCK`** | MF-C1 修了まで PROCEED 不可。MF-C1 + MF-I1…I6 消化後に APPROVE 相当 |

---

## メタ

- 編集: 本ファイルのみ
- 実行: 静的照合のみ（admin プロセスへの実 HTTP exploit は未実施。`path.join` / serve-static ソース / token 境界 / ファイル配置で十分）
- 総合: **`BLOCK`** / must-fix **MF-C1, MF-I1, MF-I2, MF-I3, MF-I4, MF-I5, MF-I6**
