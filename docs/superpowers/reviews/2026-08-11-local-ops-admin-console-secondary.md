# 2次検証: ローカル専用運用管理コンソール設計

- **役割:** 独立 secondary verifier（1次・敵対的レビューの著者ではない。コンテキスト非共有）
- **日付:** 2026-08-11
- **対象設計:** [`docs/superpowers/specs/2026-08-11-local-ops-admin-console-design.md`](../specs/2026-08-11-local-ops-admin-console-design.md)
- **入力:**
  - 1次: [`2026-08-11-local-ops-admin-console-primary.md`](./2026-08-11-local-ops-admin-console-primary.md)（**REVISE** / C0 I8 M4）
  - 敵対: [`2026-08-11-local-ops-admin-console-adversarial.md`](./2026-08-11-local-ops-admin-console-adversarial.md)（**BLOCK_WITH_CONDITIONS** / C3 I6 M3）
- **照合（live tree）:** `docs/testing/database-access-matrix.md` / `supabase/migrations/` / `.gitignore` / `.dockerignore` / `package.json` / `eslint.config.js` / `shared/contracts/plan-quota.ts` / `shared/contracts/share-quota.ts` / `netlify/functions/_shared/quota-identity.ts` / `docs/deployment/supabase.md` / `docs/deployment/README.md` / `netlify.toml`
- **手法:** 静的再照合のみ。実装・設計本体の編集なし（本ファイルのみ成果物）。`admin/` は未作成。

---

## Summary

方向性（`admin/` + `compose.admin.yaml` 分離、GET/SELECT 固定クエリ、DTO で秘匿列除去、email 非表示、Netlify 非載、`private` は直 Postgres）は **live の access matrix と整合**しており、1次・敵対の「方針そのものは理解できる」評価に同意する。

二次の核:

1. **敵対 C1 の技術事実は CONFIRMED かつ Critical を維持。**  
   `private.*` 台帳は matrix 上 `service_role: none`（表 GRANT なし・SECURITY DEFINER RPC のみ）。メンテ LOGIN も所有表 SELECT 不可（`docs/deployment/supabase.md` §6）。第1版が本番を読むなら接続主体は事実上 **Dashboard 管理者級 DB URL** になる。アプリの `BEGIN READ ONLY` / `default_transaction_read_only` は **権限の代替にならない**。1次 F1 が Important に留めたのは **本番 URL を第1版で許す前提では過小**。
2. **敵対 C2 は事実 CONFIRMED だが Critical は過大 → Important へ DOWNGRADE。**  
   設計の脅威モデルは「同一マシン上の信頼ユーザー」で、認証なしは意図的。ただし **Host allowlist 欠落と multi-user 到達**は設計が軽視しており Important must-fix。local bearer は強く推奨だが、単一オペレータ明示受容なら residual 可。
3. **敵対 C3 は事実 CONFIRMED だが Critical は過大 → Important（1次 F6 と統合）。**  
   現行 `.gitignore` の `.env` は **`.env.admin` に一致しない**。設計は gitignore 追加を既に要求しており、穴は **dockerignore / build context / 受け入れの機械検証の欠落**。
4. 1次 Important（F2–F8）はほぼすべて CONFIRMED。敵対 I1–I5 と重複する根因は統合する。

**最終推奨: `REVISE_SPEC`（本番接続を第1版に含めるなら実質 `BLOCK` 条件付き）**

- 人間承認・implementation plan 着手の前に、下記 **Merged must-fix** を設計本文へ反映すること。
- Critical must-fix: **1 件**（書込可能クレデンシャル問題）。
- Important must-fix（重複排除後）: **9 件**。

---

## Final recommendation

| 判定 | 条件 |
| --- | --- |
| **REVISE_SPEC** | 必須。現状の設計文面のままでは実装者解釈が危険に分岐する。 |
| 本番 URL 第1版 | **C1 を閉じるまで BLOCK**（RO LOGIN 新設、または本番接続禁止＝staging/local のみ、または既存 read RPC 拡張への設計変更）。 |
| C1 を staging-only 等で閉じた後 | Host / deny-list / tooling / 負荷契約など Important 反映後に **APPROVE_WITH_RESIDUALS** へ下げられる。 |

1次の「Critical 0 / REVISE」は **Important 群の存在としては正しい**が、**本番 + owner URL + 未認証 UI** の組み合わせでは C1 を Critical に上げる敵対側が妥当。二次は敵対の総合 `BLOCK_WITH_CONDITIONS` を **条件を精緻化したうえで支持**する（C2/C3 の Critical ラベルは落とす）。

---

## Cross-walk（Critical / Important）

| ID | 出典 | 元重大度 | 二次判定 | 二次重大度 | 統合先 | 根拠（live 要約） |
| --- | --- | --- | --- | --- | --- | --- |
| **Adv C1** | 敵対 | Critical | **CONFIRMED** | **Critical** | **MF-C1** | matrix L14–32: `private.*` service_role **none**。maintenance login は表 SELECT 不可（supabase.md §6）。ソフト RO のみでは DML 権限が残る。 |
| **Pri F1** | 1次 | Important | **CONFIRMED / UPGRADE** | **Critical**（本番 URL 時） | **MF-C1** | 同根。canary・helper 一択は C1 解決後も防御層として残す。 |
| **Adv C2** | 敵対 | Critical | **CONFIRMED / DOWNGRADE** | **Important** | **MF-I8** | 認証なしは設計意図。`127.0.0.1` は同一ホスト全 UID 到達可。Host 固定・token 欠落は穴。単一オペレータ脅威モデル下では Critical までは不要。 |
| **Adv C3** | 敵対 | Critical | **CONFIRMED / DOWNGRADE** | **Important** | **MF-I5** | `.gitignore` L4 `.env` のみ・`.env.admin` 無し。`.dockerignore` も同様。設計 §9.6 は gitignore 追加済み意図 → 仕様未完。 |
| **Pri F6** | 1次 | Important | **CONFIRMED** | **Important** | **MF-I5** | C3 と同根。Dockerfile context / dockerignore まで必須。 |
| **Pri F2** | 1次 | Important | **CONFIRMED** | **Important** | **MF-I1** | `identity_key` は台帳 NOT NULL（`20260728150000`）。`quota-identity.ts` は email HMAC。設計 deny に未記載。 |
| **Adv I5** | 敵対 | Important | **CONFIRMED** | **Important** | **MF-I1** | F2 と同根。`SELECT *` 禁止 + 列 allowlist。 |
| **Pri F3** | 1次 | Important | **CONFIRMED** | **Important** | **MF-I2** | success 正本は `ai_identity_daily_usage`（PK identity_key+day、**user_id なし**）。旧 `ai_user_daily_usage` は drop 済み。Free 3 / Plus 10 は `plan-quota.ts`。 |
| **Pri F4** | 1次 | Important | **CONFIRMED** | **Important** | **MF-I3** | deploy 正本: Session **5432**、**6543 禁止**、`sslmode=require|verify-*`（supabase.md §5、README）。設計は「推奨」のみ。 |
| **Adv I3** | 敵対 | Important | **CONFIRMED** | **Important** | **MF-I3** | F4 と同根 + 危険ロール起動検証（C1 とセット）。 |
| **Pri F5** | 1次 | Important | **CONFIRMED** | **Important** | **MF-I4** | `format:check` は `find .`（admin prune 無し）。`lint` は `eslint .`。`eslint.config.js` ignores に `admin` 無し。 |
| **Adv I2** | 敵対 | Important | **CONFIRMED** | **Important** | **MF-I4** | F5 と同根。 |
| **Pri F7** | 1次 | Important | **CONFIRMED** | **Important** | **MF-I6** | 滞留閾値未定義。live 正本: `shareQuota.jobLeaseMinutes = 15`、reaper `interval '15 minutes'`（`20260801190000` L1055–1056）。 |
| **Pri F8** | 1次 | Important | **CONFIRMED** | **Important** | **MF-I7** | 索引: feedback は `(user_id, created_at)` のみ（body 無し）。生成台帳は stale / one_processing / identity_day のみで **汎用 created_at 索引なし**。エラー漏洩・ページング未固定。 |
| **Adv I1** | 敵対 | Important | **CONFIRMED** | **Important** | **MF-I7** | F8 の負荷面と同根。 |
| **Adv I4** | 敵対 | Important | **CONFIRMED** | **Important** | **MF-I9** | 概念 YAML は `127.0.0.1:5193:5193` 正しいが、本編は `compose.test.mjs` で ports 固定する慣習があり admin に無い。 |
| **Adv I6** | 敵対 | Important | **CONFIRMED** | **Important（低）** | **MF-I7 付帯** | pool max / ダッシュボード並列未定義。I1 の負荷契約に吸収可。 |
| Pri F9–F12 | 1次 | Minor | **CONFIRMED** | Minor | residual | JST 境界・FB 注意・a11y・UUID 非リンク。 |
| Adv M1–M3 | 敵対 | Minor | **CONFIRMED** | Minor | residual | prod/staging 誤認・監査ログなし・health 情報。 |

---

## Merged must-fix（承認前に設計へ書く）

### Critical

#### MF-C1 — 書込可能クレデンシャルを権限モデルの正にしない（Adv C1 ∪ Pri F1 UPGRADE）

**事実:**

- `docs/testing/database-access-matrix.md`:  
  `private.ai_generation_requests` / `ai_global_daily_usage` / `ai_identity_daily_usage` / `billing_*` / `share_generalization_jobs` 等はすべて  
  `anon/authenticated/service_role = none`（表 GRANT なし、RPC 経由のみ）。
- `public.user_feedback` は browser deny-all + `service_role ALL`。直 SQL なら owner/postgres で読める。
- メンテ LOGIN（`kondate_maintenance_login`）は `run_kondate_maintenance` 専用で **所有表 SELECT 不可**（`docs/deployment/supabase.md` §6）。
- よって設計 §7.3「RO ロール新設はスコープ外 + アプリ READ ONLY」のまま本番を読むと、**接続 URL は管理者級**になる。

**アプリ READ ONLY の限界（PG 事実）:**

- ロールに INSERT/UPDATE/DELETE がある限り、`SET default_transaction_read_only = off` や `BEGIN`（READ WRITE）で書込 TX を開ける（特権/所有者）。
- `BEGIN READ ONLY` は **アプリが毎回正しく張る前提**のソフト制御。SQL 注入・ヘルパ外し・依存バグ時の被害が「漏洩」ではなく「本番破壊」。
- さらに `.env.admin` を読める者は **psql でアプリを迂回**できる。未認証 HTTP 面はそのクレデンシャルをプロセスに常駐させる。

**設計への必須反映（いずれか1つを第1版の正とする）:**

| 選択肢 | 内容 | 備考 |
| --- | --- | --- |
| **A（推奨）** | 本番変更を許容し `kondate_ops_readonly`（仮）LOGIN を新設。対象表・必要列への **SELECT のみ**、書き込み RPC EXECUTE なし、`NOSUPERUSER`、`statement_timeout`、`CONNECTION LIMIT`。起動時に `has_table_privilege(..., 'INSERT'/'UPDATE'/'DELETE')` が真なら **process exit**。 | 設計 §2.2 / §7.3 の「ロール新設スコープ外」を撤回。 |
| **B** | 第1版は **本番 URL 接続を禁止**。local Compose Postgres または staging のみ。UI に環境バッジ。 | 本番 ops は follow-up。 |
| **C** | 直 SELECT をやめ、既存 SECURITY DEFINER **read RPC 群の拡張**で必要な集計だけ返す。 | private 表 GRANT を増やさない。 |

**拒否:** 「アプリ READ ONLY だけで本番 owner URL を常時保持」を権限モデルの正とすること。

**併記（A/B/C いずれでも）:** プールは `options=-c default_transaction_read_only=on`、全クエリは helper 経由の `BEGIN READ ONLY` のみ、起動 canary（READ ONLY 内 DML が失敗すること）を §7/§10 に書く。

---

### Important（重複排除）

#### MF-I1 — 禁止カラム / 禁止リレーション正本 + SELECT 列 allowlist（Pri F2 ∪ Adv I5）

設計 §3.4 の deny が `request_hmac` / Stripe subscription 系に偏る。live で少なくとも:

| 対象 | 根拠 |
| --- | --- |
| `private.ai_generation_requests.identity_key` | NOT NULL hex64。`computeQuotaIdentityKey` = HMAC-SHA256(email)。一覧・詳細・ログに出さない。 |
| `request_hmac` / `request_hmac_version` | 設計は hmac のみ言及。version も出さないか、出すなら意味を固定。 |
| 全 `stripe_*` / `*_stripe_*`（`billing_customers.stripe_customer_id`、`billing_webhook_events.stripe_event_id` 含む） | subscriptions 以外の join 禁止を明記。 |
| draft memo / ingredients / pantry、`shared_emergency_recipes.menu_payload` | 同一 owner URL で読める隣接爆弾。named query から表名禁止。 |
| `auth.*` | email 等。join 禁止をスキーマ単位で。 |

**契約:** named query は **列名列挙 SELECT のみ**（`SELECT *` 禁止を §7.2 に）。Zod DTO + mapper テストで `identity_key` / `stripe_customer_id` / `request_hmac` 非含有を必須化。

`terminal_details` が conflict 時 `{conflictCodes}` のみ、という設計記述は **CONFIRMED 正しい**（`ai_generation_terminal_details_valid`）。

---

#### MF-I2 — 「上限付近 user_id」クエリ契約（Pri F3）

- 製品 success 台帳の正本は `private.ai_identity_daily_usage`（PK `(identity_key, usage_day)`、**user_id 列なし**）。旧 `ai_user_daily_usage` は `20260728150000` で drop。
- 上限値: Free **3** / Plus **10**（`shared/contracts/plan-quota.ts`）。request スナップショットに `quota_success_limit in (3,10)`。

**設計に1本で固定する例（1次提案を支持）:**

1. JST 当日の `private.ai_generation_requests` で `status = 'succeeded'` を `user_id` 集計。
2. 同一ユーザーの直近 request の `quota_success_limit` を上限とみなす。
3. 「付近」= `success_count >= quota_success_limit - 1`（数値固定。80% にするならその式を書く）。
4. **`identity_key` は SELECT しない。** 表示は `user_id` / `success_count` / `limit` のみ。最大 50 件。

---

#### MF-I3 — `ADMIN_DATABASE_URL` fail-closed（Pri F4 ∪ Adv I3）

メンテ経路と同等に設計 §7.1 へ:

- 受理: Shared **Session** pooler **port 5432** + `sslmode=require|verify-ca|verify-full`（本番）。
- 起動 reject: port **6543** / transaction mode。
- ヘッダ表示: パース後の `hostname:port` のみ（password / userinfo / 全 query を返さない）。
- node-pg SSL（`rejectUnauthorized`）を1行で固定（maintenance 既知コメント参照）。
- MF-C1 採用ロール名 allowlist と起動時 `session_user` 検証をセット。
- local 例外（`sslmode=disable`）を許すなら **明示フラグ**でのみ。

---

#### MF-I4 — root tooling と `admin/` の境界（Pri F5 ∪ Adv I2）

現行:

```text
package.json format:check → find . （prune: .git / node_modules / .netlify / infra/supabase/volumes のみ）
package.json lint       → eslint .
eslint.config.js ignores → admin 無し
typecheck               → tsc -b（root references のみ → admin は型チェックされない）
```

設計 §4.3「勝手に食い込ませない」と **現状矛盾**。第1版でどちらかを決める:

- **A（推奨）:** root eslint ignores + format find に `admin/**` prune。admin は `compose.admin.yaml` 経由の独自 format/lint/typecheck/test。
- **B:** admin を root 明示 script / project reference に載せ、e2e/CI 本線には載せない。

「後から」は不可。§11 の「してよい」表に境界変更を含める。

---

#### MF-I5 — `.env.admin` の ignore と Docker 秘密（Pri F6 ∪ Adv C3）

live 証拠:

```text
.gitignore:     .env / .env.local / .deploy.env   ← .env.admin なし
.dockerignore:  .env / .deploy.env / .env.local   ← .env.admin なし
設計 §8.1:      build.context: .  + env_file: .env.admin
```

**必須:**

1. `.gitignore` **と** `.dockerignore` に `.env.admin`（コメント: 「`.env` では不十分」）。
2. 受け入れ: `git check-ignore -v .env.admin` がヒット。
3. Dockerfile は `context: ./admin` または root context でも secret を ignore + **明示 COPY** のみ。build-arg に秘密を載せない。`env_file` はランタイムのみ。

---

#### MF-I6 — 共有ジョブ滞留閾値（Pri F7）

live 正本:

- `shared/contracts/share-quota.ts`: `jobLeaseMinutes: 15`
- `reap_stale_share_jobs`: `v_threshold := v_now - interval '15 minutes'`、`status = 'running' AND coalesce(heartbeat_at, claimed_at) < v_threshold`
- index: `share_generalization_jobs_running_heartbeat_idx`（running 部分）

**設計固定例:**  
滞留 = `status = 'running' AND coalesce(heartbeat_at, claimed_at) < now() - interval '15 minutes'`。  
pending 長期放置を別カードにするかは明記。サマリ SQL を §6 か §7 に疑似コード1本。

---

#### MF-I7 — 本番負荷・ページング・エラー契約（Pri F8 ∪ Adv I1 ∪ Adv I6）

live:

- `user_feedback`: index `(user_id, created_at desc)` のみ。**body 用 index なし** → `ILIKE '%q%'` は seq scan。
- `ai_generation_requests`: `one_processing` / `stale(processing_expires_at)` / `identity_day` のみ。**汎用 `created_at` 降順索引なし**。

**設計固定:**

1. 日付範囲 **必須**（最大窓を数値で。例: 一覧 7d 既定・上限 31d）。
2. feedback 本文キーワードは第1版 **外す**か、最小文字数 + 結果上限 + timeout 内切り上げ。`pg_trgm` 無しで本番 ILIKE 全表は禁止に近い。
3. 生成一覧も `created_at` 範囲必須 + `ORDER BY created_at DESC, id DESC` + LIMIT。ops 用部分索引を足すなら **migration をスコープに書く**（「索引なしで投げる」をやめる）。
4. セッション `statement_timeout`（5–15s）をロールまたは接続 options で固定。API 目安 15s と整合。
5. エラー JSON は closed code + 日本語固定 message のみ（SQL/関係名/`err.message` を返さない）。
6. pool `max` を小さく（例 2–4）。ダッシュボードは単一集約 SQL またはサーバ側1本に寄せ、クライアント並列度を制限（I6 吸収）。

---

#### MF-I8 — ローカル HTTP 面の最小硬化（Adv C2 DOWNGRADE）

設計の「アプリ認証なし・同一マシン信頼ユーザー」は **残してよい**。ただし次は Important:

1. BFF で `Host` を `127.0.0.1:5193` / `localhost:5193` のみ許可（DNS rebinding 対策。設計全文に現状なし）。
2. README / 受け入れ: 共有 PC・他 UID がいる環境では起動しない、を §10.2 に昇格。
3. feedback 全文: 既定は先頭 80 字、全文は明示アクション（1次 F10 と整合して強化）。
4. **推奨 residual:** `ADMIN_LOCAL_TOKEN`（高エントロピー）を `/api/*` で要求。単一オペレータ + Host 固定を人間が明示受容するなら token なしも可だが、その旨を §9 に残す。

Primary が C2 相当を Minor（F10）に留めたのは **過小**。二次は Important。

---

#### MF-I9 — compose 公開面のソース固定（Adv I4）

- `compose.admin.yaml` の ports を **`127.0.0.1:5193:5193` 固定**する tooling テスト（本編 `tests/tooling/compose.test.mjs` 慣習に合わせる）。
- 受け入れ §10.2 に「publish が loopback のみ」を機械検証可能な形で追加。
- `ADMIN_BIND_HOST` はコンテナ内 listen 用であり、ホスト publish を LAN に開けないことを文書化。

---

## Residuals / Minor（設計改訂で触れれば尚良いが承認ブロッカーではない）

| ID | 内容 | 二次 |
| --- | --- | --- |
| Pri F9 | 日付フィルタは JST `YYYY-MM-DD` → server で `Asia/Tokyo` 境界。`private.ai_jst_day()` 利用可否 | 推奨（API Task 前） |
| Pri F10 | feedback free-form のオペレータ注意 UI | MF-I8 に一部吸収 |
| Pri F11 | デスクトップ UI のキーボード最低限 | plan で可 |
| Pri F12 | UUID はコピー用テキストのみ・メニュー導線なし | スコープクリープ防止 |
| Adv M1 | project-ref allowlist / PROD 誤認 | residual |
| Adv M2 | 監査ログなし | 設計意図として受容可 |
| Adv M3 | 未認証 health が DB 存在証明 | token 採用時は health を process-only に |

---

## 過大評価・正しく反証された攻撃

### 二次が「過大」と判断したもの

1. **Adv C2 を Critical 固定** — 未認証 local GET の事実は正しいが、設計が明示した単一信頼オペレータモデルと衝突する「前提の否定」に近い。Host 固定 + 運用受け入れ強化で Important に落とすのが比例的。local token を BLOCK 必須にすると第1版が過剰に重くなる（ただし推奨）。
2. **Adv C3 を Critical 固定** — `.env.admin` が ignore されないのは **現行リポジトリの事実**だが、設計は既に gitignore 追加を要求。未実装ファイルの穴というより **仕様の不完全**（dockerignore / context / check-ignore）。Important で十分。実装時に ignore し忘れると Critical 事故になる、という警告としては正しい。
3. **1次が C1 を Important に留めたこと** — 逆方向の過小。ソフト RO + canary は防御層として有効だが、**owner URL を未認証プロセスに載せる**ことを「人間向け明記で足りる」とするのは、本番データ破壊半径に対して甘い。二次は敵対寄りに UPGRADE。

### 敵対が正しく反証し、二次も同意するもの

| 攻撃 | 二次 |
| --- | --- |
| PostgREST で private を晒す | **反証** — 直 SQL 正・private 公開は対象外 |
| service_role / anon をブラウザ・`VITE_*` に載せる | **反証** — §3.6 |
| Netlify / 本編 `dist` への admin 混入 | **概ね反証** — `netlify.toml` publish=`dist`、functions=`netlify/functions`。root build に繋がない限り入らない |
| `terminal_details` から生 AI / 献立本文 | **概ね反証** — conflictCodes のみ CHECK |
| CORS を広く開ける | **反証** — 同一 origin（Host 固定は別途 MF-I8） |
| 本編 `compose.yaml` 常時依存 | **反証** — 設計どおり include/depends_on なし |
| email を join して表示 | **アプリ経路は反証**（owner URL の手読みは残差） |
| `identity_key` から email 直接逆算 | **反証**（HMAC）。鍵+候補での検証は I5 で非表示固定すれば足りる |

### 1次の Positive notes への同意

- 配置分離・DB URL 選択理由（private 非 REST）・GET のみ・UUID 識別・受け入れの検証可能性は **二次も支持**。
- `terminal_details` / 生成一覧列の大半が実スキーマと整合する、という1次スキーマ照合も **CONFIRMED**。

---

## 推奨する設計改訂順序（承認前）

1. **MF-C1**（本番を読むか・RO ロールか・staging のみか）— これで第1版の blast radius が決まる  
2. **MF-I1 + MF-I2**（privacy と画面仕様の中核）  
3. **MF-I3 + MF-I5 + MF-I8 + MF-I9**（接続・秘密・ローカル到達面）  
4. **MF-I4**（root tooling 境界）  
5. **MF-I6 + MF-I7**（滞留閾値・負荷・エラー）  
6. Minor（JST・UUID 非リンク等）

改訂後、deny リスト・URL バリデーション・C1 選択肢の抜けを **別エージェントで再確認**してから implementation plan へ。

---

## メタ

- レビュー種別: 設計二次検証（実装前）  
- 編集: 本ファイルの新規作成のみ  
- Critical must-fix: **1**（MF-C1）  
- Important must-fix（重複排除）: **9**（MF-I1–I9）  
- 総合: **REVISE_SPEC** / 本番接続を残すなら **BLOCK until MF-C1**
