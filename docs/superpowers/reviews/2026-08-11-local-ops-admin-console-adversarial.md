# 敵対的レビュー: ローカル専用運用管理コンソール設計

**対象:**  
`docs/superpowers/specs/2026-08-11-local-ops-admin-console-design.md`

**照合ソース（実装・契約を正）:**  
- `docs/testing/database-access-matrix.md`  
- `supabase/migrations/`（`private.ai_*` / `billing_*` / `share_*` / `public.user_feedback`）  
- `compose.yaml` / 既存 `.gitignore` / `.dockerignore` / root `package.json` scripts / `eslint.config.js` / `netlify.toml` / `scripts/ci.sh`  
- `shared/contracts/feedback.ts` / `netlify/functions/_shared/quota-identity.ts`  
- `docs/deployment/README.md` / `docs/deployment/supabase.md`（本番 DB URL 運用）

**敵対姿勢:** 設計を通したい著者バイアスを前提に、未認証ローカル管理面 × 本番 DB 資格情報の blast radius、READ ONLY のバイパス、PII / free-form 露出、誤デプロイ・CI 混入、本番負荷、ネットワーク境界、オペレータ誤接続を優先して突く。編集はせず読取のみ。

---

## Summary

設計の方向（本編と物理分離、`compose.admin.yaml` 単独、GET/SELECT 固定クエリ、DTO で秘匿列除去、email 非表示、Netlify 非載）は意図として理解できる。一方で **第1版が「private 台帳を直接 SELECT」する以上、現状の権限モデルでは接続主体は事実上テーブル所有者（`postgres` / Dashboard の管理者 DB URL）以外に存在しない**。access matrix 上 `private.*` は `service_role: none`（表 GRANT なし・SECURITY DEFINER RPC のみ）であり、service_role JWT やメンテ LOGIN では目的の SELECT が成立しない。

その結果、設計が「スコープ外」とした **DB ロールの read-only 化を避けると、未認証ローカル Web UI が常に書込可能クレデンシャルを保持する**構造になる。アプリの `BEGIN READ ONLY` / `default_transaction_read_only` は **ロールに WRITE がある限りソフト制約**であり、実装バグ・将来の書き込みルート・接続オプション欠落・superuser/owner の `SET` で崩れる。加えて Host 固定やローカル共有秘密がなく、同一マシン上の他ユーザー／プロセス／（環境によっては）DNS rebinding 経由で **feedback 本文と user_id 相関グラフ**が無認証 GET で取れる。

**総合判定: `BLOCK_WITH_CONDITIONS`**

条件を満たすまで人間承認・実装開始は不可。条件の核は (1) **DB 強制の SELECT 専用 LOGIN**（または同等の技術的書込不能）、(2) **ローカル到達面の最小認証 or Host 固定＋起動時危険ロール拒否**、(3) **秘密ファイルと root ツール境界の固定**、(4) **本番負荷を抑えるクエリ契約**。条件充足後は PROCEED_WITH_RESIDUALS に下げられる。

---

## Attack scenarios

| # | シナリオ | 判定 | 根拠 |
| --- | --- | --- | --- |
| 1 | 未認証 admin + 本番 DB URL でローカル他ユーザー／マルウェアが全画面 API を GET | **成立** | 設計 §1/§9: アプリ認証なし。`127.0.0.1:5193` は同一ホストの全ローカル UID から到達可。Linux の multi-user / CI runner / 共有ノート PC で feedback body と user_id 台帳が読める。 |
| 2 | DNS rebinding / 悪意ページが `Host: evil` で `/api/*` を叩き PII を外へ送る | **部分成立** | Host / Origin 許可リストなし（設計全文に無し）。現代ブラウザの Private Network Access で一部緩和されるが **設計依存にしていない**。localhost 無認証 API の古典的経路。 |
| 3 | `ADMIN_DATABASE_URL` に Dashboard の `postgres` Session pooler URL を貼る（運用上の自然経路） | **成立** | `docs/deployment/README.md` の `SUPABASE_DB_URL` 例が `postgresql://postgres.<ref>:...@...pooler...:5432/postgres`。設計は同種 URL を想定し、RO ロール新設を §7.3 でスコープ外。 |
| 4 | アプリ READ ONLY をバイパスして UPDATE/DELETE/DDL | **成立（ロールが書込可能なら）** | PG はセッションで `SET default_transaction_read_only = off` 可能。`BEGIN READ ONLY` は **アプリが毎回正しく張る前提**。owner/`postgres` は全表書込可。access matrix: private 表へ届く既存非 owner ロール無し。 |
| 5 | Transaction pooler (`6543`) 誤指定で session 設定や `BEGIN` が期待どおり効かない | **成立しうる** | 設計は Session 推奨のみで **port/ mode の起動 fail-closed 無し**。deployment 文書は 6543 をメンテ URL で明示禁止しているが admin 設計は未固定。 |
| 6 | SQL 注入（filter を文字列連結）で任意 SELECT / 書き込み試行 | **設計上は反証予定・実装依存** | §7.2 は `$1` bind のみと明記。第1版テストに bind 固定がある。**成立条件は実装逸脱**。ただし RO ロールが無いと注入成功時の被害が最大。 |
| 7 | `SELECT *` + mapper 漏れで `request_hmac` / Stripe ID / `identity_key` が API に出る | **部分成立** | 列は設計で禁止。防御は Zod DTO 二重化（§9）。`identity_key` は一覧列に無いが台帳に存在（`20260728150000_identity_daily_quota.sql`）。テスト不足だと漏洩。 |
| 8 | feedback `body` ILIKE と生成一覧の `ORDER BY created_at` が本番 full scan | **成立** | `user_feedback` 索引は `(user_id, created_at desc)` のみ（`20260725120000_user_feedback.sql`）。`body` 索引なし。`ai_generation_requests` の created_at 汎用索引なし（processing 部分索引と identity_day のみ）。 |
| 9 | `.env.admin` が git または Docker build context に混入 | **現状リポジトリで成立しうる** | `.gitignore` は `.env` / `.env.local` / `.deploy.env` のみで **`.env.admin` 未掲載**。`.dockerignore` も同様。設計 §9 は gitignore 追加のみ言及し dockerignore 無し。 |
| 10 | root `format` / `lint` が `admin/` を食い、型プロジェクト外で CI 赤 or 誤フォーマット | **成立** | `package.json` の `format:check` は `find . ... *.ts|tsx|md|...`、`lint` は `eslint .`（`**/*.{ts,tsx}`）。`admin/` を ignores していない。設計 §4.3 の「勝手に食い込ませない」と矛盾。 |
| 11 | Netlify / 本編 dist に admin が混ざる | **概ね反証** | `netlify.toml` publish=`dist`、functions=`netlify/functions`。設計は `admin/` 独立と本編 `src/` 非混入。**compose include しない**方針も本編 `compose.yaml` と整合。 |
| 12 | service_role キーをブラウザや VITE_ に載せる | **設計上反証** | §3: service_role 不使用、`VITE_*` に秘密なし。 |
| 13 | PostgREST で private を公開してしまう | **設計上反証** | 直接 SQL を正とし private 公開を対象外（§2.2）。 |
| 14 | `terminal_details` から生 AI / 献立本文が漏れる | **概ね反証** | `ai_generation_terminal_details_valid` は conflict 時 `{conflictCodes: [...]}` のみ許可（`20260711002000_ai_control_and_quota.sql`）。 |
| 15 | `identity_key` と email の相関（HMAC 逆算） | **直接は反証・残差あり** | `computeQuotaIdentityKey` は HMAC-SHA256（逆算不能）。ただし UI が key を出せば、鍵漏洩時の email 候補検証や user_id 横断相関に使える。設計は非表示が正しい。 |
| 16 | `source_menu_id` / `completed_menu_id` から献立 join | **アプリ経路は反証、DB 経路は成立** | 設計は join 禁止。owner URL があれば `psql` や将来クエリ追加で `public.menus` 等へ到達可能（RLS は table owner で意味が薄い）。 |
| 17 | コンテナが `0.0.0.0` listen + ホスト publish を `5193:5193` と誤記して LAN 露出 | **運用ミスで成立** | 設計概念 YAML は `127.0.0.1:5193:5193`。受け入れ条件に「publish が loopback のみ」の自動テストが無い。 |
| 18 | ローカル DB URL と本番 URL の取り違え | **成立** | ヘッダに host 表示のみ。project-ref allowlist / 色分け / 起動確認プロンプト無し。誤って staging と prod を取り違えても気づきにくい。 |
| 19 | shell 履歴・`docker compose config`・ログに DB URL | **成立しうる** | 設計はログに password を出さないと書くが、compose env_file・オペレータの export 手順の禁止が弱い。 |
| 20 | ダッシュボード N 本の重い集計を同時発行し pooler / CPU を圧迫 | **成立しうる** | 画面 6 + カード単位リンク。timeout 15s のみで statement_timeout / 同時実行上限 / 日付強制範囲が設計に無い。 |

---

## Findings

### Critical

#### C1. private 台帳 SELECT には現状 owner/`postgres` 相当が必須なのに、DB 強制 READ ONLY をスコープ外にしている（ソフト READ ONLY の虚構）

- **信頼度:** 96  
- **箇所:** 設計 §3.2, §7.1–7.3, §13; `docs/testing/database-access-matrix.md` L14–31; migrations の `revoke all on private.*`  
- **説明:**  
  - `private.ai_generation_requests` / `ai_global_daily_usage` / `billing_*` / `share_generalization_jobs` は **service_role 表 SELECT なし**（RPC のみ）。  
  - メンテ LOGIN（`kondate_maintenance_login`）は `run_kondate_maintenance` 専用で **所有表 SELECT 不可**（`docs/deployment/supabase.md` §6）。  
  - よって第1版の `ADMIN_DATABASE_URL` は事実上 **管理者 DB パスワード付き URL**になる。  
  - そのロールは INSERT/UPDATE/DELETE/（環境により）DDL が可能。アプリの `BEGIN READ ONLY` は:
    - 実装が1経路でも外すと無効  
    - セッションで `default_transaction_read_only` を戻せば次トランザクションから無効（特権ユーザー）  
    - SQL 注入や依存ライブラリバグ時の被害が「情報漏洩」ではなく「本番破壊・改ざん・削除」  
  - 設計はこれを「望ましいが第1版スコープ外」と明記しており、**未認証 UI と組み合わせた残留リスクを過少評価**している。  
- **修正要求（BLOCK 解除の必須条件）:**  
  1. **本番変更を許容して** `kondate_ops_readonly`（仮）LOGIN を新設する設計に切り替える: `NOSUPERUSER` / `NOBYPASSRLS` 不要なら明示、`CONNECTION LIMIT`、`statement_timeout`、**対象表・必要列への SELECT のみ**、DEFAULT PRIVILEGES に乗らないよう固定。書き込み RPC の EXECUTE は REVOKE。  
  2. 起動時に `SELECT rolsuper, rolbypassrls FROM pg_roles` / `has_table_privilege(..., 'INSERT'|'UPDATE'|'DELETE')` を検査し、**書込可能なら process を落とす**。  
  3. 第1版でロール新設がどうしても不可なら、**本番 URL 接続自体を禁止**しローカル/staging のみ、または **psql ではなく既に存在する read RPC 群の拡張**に設計を戻す（現状の「private 直 SELECT + アプリ RO」は不可）。

#### C2. 未認証のローカル HTTP 面が、本番 free-form feedback と user_id 相関グラフの無防備な読み出し口になる

- **信頼度:** 93  
- **箇所:** 設計 §1, §5.3, §5.4, §6, §9.1; `public.user_feedback.body`（10–2000 文字 free-form）  
- **説明:**  
  - API はすべて GET、認証ヘッダなし、CORS なし、**Host 許可リストなし**、共有 secret なし。  
  - 同一マシンの他ユーザーは `curl http://127.0.0.1:5193/api/feedback` で本文全文を取得可能。  
  - 画面群は `user_id` で生成失敗・枠逼迫・課金 status・共有 job・feedback 本文を横断できる。email を出さなくても **運用者以外の第三者が UUID グラフ + 自由記述**を持てる。  
  - プロジェクトの privacy 方針（ログに body を出さない、名前/メール/アレルギーを残さない）と、**無認証の運用 UI が body を返す**ことは緊張関係にあり、設計の「信頼ユーザー前提」一文では足りない。  
- **修正要求（いずれか必須、推奨は併用）:**  
  1. 起動時に生成する **高エントロピーの local bearer**（`.env.admin` の `ADMIN_LOCAL_TOKEN`）を全 `/api/*` で要求。ブラウザは memory のみ（localStorage でも可だが共有 PC では弱い）。  
  2. BFF で `Host` を `127.0.0.1:5193` / `localhost:5193` のみ許可（DNS rebinding 対策）。  
  3. feedback 詳細は **明示クリック + マスク（既定は先頭 80 字のみ、全文は別アクション）**、コピー時の注意。  
  4. README に「共有 PC・社給で他 UID がいる環境では起動しない / 起動中はセッションロック」を受け入れ条件へ昇格。

#### C3. 秘密ファイル `.env.admin` が現行 ignore 規則の穴に落ちる（git / Docker context）

- **信頼度:** 90  
- **箇所:** 設計 §7.1, §9.6, §8.1（`env_file: .env.admin`, build `context: .`）; 実装 `.gitignore` L4–10; `.dockerignore` L8–12  
- **説明:**  
  - 現行 `.gitignore` は `.env` 完全一致であり **`.env.admin` は追跡対象になり得る**。  
  - `.dockerignore` も `.env` / `.deploy.env` のみ。`context: .` のとき Docker デーモンへ **`.env.admin` が build context として送られる**（イメージに COPY しなくても socket 経由で広がる）。  
  - 設計は gitignore 追加だけを書き、dockerignore / `compose config` 漏洩 / example との取り違えを固定していない。  
- **修正要求:**  
  - `.gitignore` と `.dockerignore` の両方に `.env.admin` を必須記載（設計の「してよい」表と受け入れ条件に明記）。  
  - admin Dockerfile の build context を **`admin/` に限定**するか、root context でも secret を ignore。  
  - tooling テストで「`.env.admin` が ignore されていること」を固定（本編の secret ガード思想に合わせる）。

---

### Important

#### I1. 本番負荷: 索引のない `ILIKE body` と生成台帳の新しい順一覧

- **信頼度:** 88  
- **箇所:** 設計 §5.2–5.3; `20260725120000_user_feedback.sql` L17–18; `ai_generation_requests` 索引（stale / one_processing / identity_day のみ）  
- **説明:** 運用者が日付未指定や広い範囲 + 本文キーワードで叩くと、pooler 経由で本番 Postgres に sequential scan + `ILIKE '%q%'` が走る。生成ログも `created_at` 降順 + status フィルタが第1版の主操作なのに、それに効く索引が migration 上見当たらない。timeout 15s は **接続を15秒占有する**だけでも十分有害。  
- **修正要求:**  
  - 日付範囲を **必須**（最大 7d/31d など）にし、サーバで強制。  
  - feedback キーワード検索は第1版から外すか、`pg_trgm` 等を入れないなら **id/user_id/category のみ**。  
  - 生成一覧は `created_at` 範囲必須 + LIMIT、必要なら **ops 用の部分索引を migration で追加**する前提を設計に書く（「索引なしで本番に投げる」をやめる）。  
  - セッション `statement_timeout` をロール既定で 5–15s に固定。

#### I2. root `format` / `lint` が `admin/` を必ず噛む（設計の隔離主張と矛盾）

- **信頼度:** 92  
- **箇所:** 設計 §4.3, §11; `package.json` L13–15; `eslint.config.js` ignores; `scripts/ci.sh` L40–41  
- **説明:** CI と AGENTS 検証は root の `format:check` と `eslint .` を走らせる。`admin/` 追加直後から **admin の TS が root tsconfig projectService に載り失敗**するか、逆に root ルールでフォーマットされ admin 独立 package 前提が崩れる。設計は「勝手に食い込ませない」と書くが **具体的 ignore / 別 script が無い**。  
- **修正要求:**  
  - root eslint/prettier の ignore に `admin/**` を入れる **または** admin を明示ワークスペース化し root から `npm run lint --workspace=admin` と分離。  
  - どちらにするかを設計 §4.3/§11 に決め、CI への「第1版は載せない」と整合させる。

#### I3. 接続文字列の fail-closed 検証が無い（transaction mode / 危険ロール / 誤プロジェクト）

- **信頼度:** 86  
- **箇所:** 設計 §7.1, §8; 比較: `docs/deployment/supabase.md` のメンテ URL 禁止事項  
- **説明:** メンテ経路は port `6543` 禁止・`session_user` 固定・timeout 検証まで文書化されている。admin は「Session pooler 推奨」だけで、起動時に:
  - port ≠ 6543  
  - user ∈ allowlist（RO ロール名）  
  - `current_database` / host の project-ref 表示と確認  
  が無い。オペレータが `.deploy.env` の `SUPABASE_DB_URL` をそのまま貼る運用が最短経路。  
- **修正要求:** C1 のロールとセットで URL パース検証・起動時 `SELECT session_user, current_setting('transaction_read_only')` を受け入れ条件へ。

#### I4. Docker 公開面の「必ず 127.0.0.1」が人間任せ

- **信頼度:** 84  
- **箇所:** 設計 §8.1 概念 YAML; 受け入れ §10.2  
- **説明:** 概念例は正しいが、実装で `ports: ["5193:5193"]` と書くと LAN 公開。compose をテストする tooling（本編は `tests/tooling/compose.test.mjs` でポートを固定）が admin に無い。  
- **修正要求:** `compose.admin.yaml` の ports を **ソーステストで `127.0.0.1:5193:5193` 固定**。`ADMIN_BIND_HOST` をホスト側から不用意に変えられないことを文書化。

#### I5. 秘匿列・PII 列の allowlist が「出さない」列挙中心で、SELECT 列 allowlist が弱い

- **信頼度:** 82  
- **箇所:** 設計 §5.2–5.6, §7.2; 台帳列 `identity_key`, `request_hmac`, billing Stripe IDs, draft 側 `memo`  
- **説明:** 禁止列の列挙は有用だが、クエリが `SELECT *` や join 追加に寄せると mapper 頼みになる。`generation_draft_submission_versions.memo` や `shared_emergency_recipes.menu_payload` は **同じ URL 権限で読める隣接爆弾**。  
- **修正要求:** 各 named query は **列名 allowlist の SQL**のみ。server テストで SQL 文字列に `*` や禁止表名が無いことを固定。`identity_key` を禁止列に明示追加。

#### I6. 同時ダッシュボードクエリと connection プール上限が未定義

- **信頼度:** 80  
- **箇所:** 設計 §5.1, §6  
- **説明:** 6 API を UI が並列 fetch し得る。pool サイズ・同時クエリ上限・グローバル日次表への負荷方針が無い。  
- **修正要求:** pool `max` を小さく（例: 2–4）、ダッシュボードは **単一 SQL またはサーバ側集約1本**にまとめる、クライアント並列度を制限。

---

### Minor

#### M1. ヘッダの接続 host 表示だけでは prod/staging 誤認が残る

- **信頼度:** 78（参考・80 未満のため必須ではない）  
- **修正案:** project-ref の allowlist を `.env.admin` に書き、不一致なら起動失敗。UI に「PROD」赤バッジは既にあるので ref 全文（秘密でない部分）を出す。

#### M2. 監査ログ対象外は意図的だが、インシデント時に「誰が何を見たか」が残らない

- **信頼度:** 75  
- **残差として受容可。** ただし C2 の local token を入れるなら token の指紋だけ local file に残す選択肢あり。

#### M3. `GET /api/health` の DB 成否が存在証明になる

- **信頼度:** 70  
- **修正案:** 未認証なら health は process only。DB チェックは token 必須。

---

## 攻撃して反証・低リスクと判定したもの（二次検証用）

1. **PostgREST で private を晒す設計ではない** — 直接 SQL を正とし、private 公開を対象外と明記。access matrix の「no Data API」方針と衝突しない。  
2. **service_role / anon をブラウザに載せる設計ではない** — §3.6。  
3. **Netlify への誤デプロイ経路は現状弱い** — `netlify.toml` は `dist` + `netlify/functions` のみ。admin を root build に繋がない限り成果物に入らない。  
4. **`terminal_details` からの本文漏洩はスキーマ上ほぼ不可** — conflictCodes のみ。  
5. **CORS を広く開ける設計ではない** — 同一 origin 固定は妥当（ただし Host 固定が無い点は C2）。  
6. **本編 `compose.yaml` への常時依存は設計上回避** — 概念どおり include/depends_on しない。  
7. **email を join して表示する仕様ではない** — ただし owner URL なら `auth.users` は手で読める（アプリ外残差）。  
8. **identity_key から email の直接逆算は HMAC により不可** — 鍵と候補リストがあれば検証は可能（I5 で非表示を固定すれば十分）。

---

## BLOCK 解除条件（チェックリスト）

実装計画に入る前に設計改訂で以下を **必須** とする:

- [ ] **C1:** SELECT 専用 DB LOGIN（または本番接続禁止）を第1版スコープに入れる。アプリ READ ONLY のみを「権限モデルの正」にしない。  
- [ ] **C2:** `/api/*` に local token または同等、および `Host` allowlist。feedback 全文の扱いを強化。  
- [ ] **C3:** `.gitignore` **と** `.dockerignore` に `.env.admin`。可能なら build context を `admin/` に限定。  
- [ ] **I1:** 日付範囲必須・ILIKE 制限・statement_timeout / 索引方針。  
- [ ] **I2:** root format/lint と admin の境界を具体的 ignore または workspace で固定。  
- [ ] **I3–I5:** URL/ロール起動検証、compose ポートのソーステスト、SQL 列 allowlist。

すべて反映された改訂設計を再レビューし、残る共有 PC リスクや owner 以外での `auth.users` 手読み等は **PROCEED_WITH_RESIDUALS** として文書化してよい。

---

## メタ

- レビュー種別: 設計に対する敵対的レビュー（実装前）  
- 編集: なし（本ファイルの新規作成のみが成果物）  
- 総合: **BLOCK_WITH_CONDITIONS** / Critical **3**
