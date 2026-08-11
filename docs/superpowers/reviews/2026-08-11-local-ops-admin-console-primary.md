# 1次レビュー: ローカル専用運用管理コンソール設計

**対象:** [`docs/superpowers/specs/2026-08-11-local-ops-admin-console-design.md`](../specs/2026-08-11-local-ops-admin-console-design.md)  
**照合先（実装が正）:** `src/` / `netlify/functions/` / `shared/` / `supabase/migrations/` / `compose.yaml` / `.gitignore` / `eslint.config.js` / `package.json` の format・lint・typecheck / `docs/testing/database-access-matrix.md` / `docs/deployment/supabase.md` / privacy 規則（`CLAUDE.md` / `AGENTS.md`）  
**レビュー種別:** 設計一次レビュー（内部一貫性・実装可能性・セキュリティ/プライバシー適合・本番 Supabase 接続の運用現実性）  
**レビュー日:** 2026-08-11  
**編集:** なし（read-only レビュー。本ファイルのみ成果物）

---

## Summary

本設計は、本編 SPA / Netlify Functions と物理分離した **ローカル専用・GET/SELECT のみ** の運用 UI を `admin/` + `compose.admin.yaml` で立て、本番 PostgREST では届かない **`private` 台帳**（生成・全体枠・課金・共有ジョブ）を Postgres 直結で読む、という方向として妥当である。`private` 表は `service_role` にも表 GRANT が無く SECURITY DEFINER RPC 経由が正、という現行 matrix と整合しており、「REST/service_role を第1版の正にしない」判断は実装事実に合っている。識別を `user_id` UUID に限定し、email/氏名/prompt/生 AI/献立本文を出さない、feedback 本文は画面のみ・ログ禁止、ホスト bind を `127.0.0.1`、という privacy/ops の骨格もプロジェクト不変条件と衝突しない。

一方、**実装に入る前に埋めないと実装者ごとに危険な解釈が分かれる穴**が複数ある。(1) 第1版は read-only DB ロールを作らず **書き込み可能な管理者級 DB URL** をアプリの `READ ONLY` だけで抑える残存リスクの運用契約が薄い。(2) 秘匿フィールドの deny リストが `request_hmac` / Stripe subscription 系に偏り、**`identity_key`（正規化 email の HMAC）や `billing_customers` / draft memo / `auth.users` 等の明示禁止が不足**。(3) 「上限付近 user_id」は現行 success 台帳が **`private.ai_identity_daily_usage`（identity_key PK、user_id FK なし）** である事実と噛み合っておらず、閾値も未定義。(4) 本番接続の **`sslmode` / Session pooler 5432 必須・6543 禁止・URL 形**が maintenance 経路ほど固定されていない。(5) 「本編 lint/typecheck に食い込ませない」と書きつつ、現行 root の `eslint .` と `format:check` の `find .` は **`admin/` を自動で巻き込む**。(6) 現行 `.gitignore` の `.env` は **`.env.admin` を無視しない**（設計は追加を要求しているが、例示と受け入れ条件で fail-closed を明文化すべき）。

Critical（このままでは安全に実装不能、または本番データ侵害が設計どおり起きる）までは至らないが、Important が複数 open のため **REVISE** とする。人間承認前に設計へ追記し、implementation plan の Task 0/1 に落とすこと。

## Verdict

**REVISE**

- Critical: 0
- Important: 8
- Minor: 4

---

## Findings

### F1 — Severity: Important

- **Location:** Spec §3.2 / §7.1–7.3 / §9
- **Description:** 第1版は read-only DB ロール新設をスコープ外とし、`ADMIN_DATABASE_URL`（実質 managed の **管理者級 Postgres 接続** — `private` は owner/スーパー相当でないと SELECT すらできない）に対し、アプリの `default_transaction_read_only = on` と `BEGIN READ ONLY` だけで書込を抑える。PostgreSQL では特権ロールが `SET default_transaction_read_only = off` したうえで書込 TX を開始でき、**アプリバグ・依存ライブラリ事故・誤った ad-hoc クエリ追加**がそのまま本番 DML/DDL になり得る。設計は脅威モデルを「同一マシン上の信頼ユーザー」に置いているが、**接続クレデンシャル自体が migration/deploy 級**であることの残存リスクと、許容する運用条件が §9 に十分書かれていない。
- **Why it matters:** 対象は本番 `private` 台帳と `public.user_feedback`。read-only コンソールの価値提案が「間違っても書けない」に見える一方、第1版の技術的保証はソフト制御のみ。実装者が「SELECT だけ書くから大丈夫」と防御を薄くすると、本番破壊経路が残る。
- **Suggestion:**
  1. §7.3 / §9 に **残存リスクを明示**し、人間承認の前提にする（「アプリ READ ONLY は防御層であり DB 権限の代替ではない」）。
  2. 実装契約: プール作成時に `options=-c default_transaction_read_only=on`、全クエリを **必ず** `BEGIN READ ONLY` … `COMMIT/ROLLBACK` で包む、**生の `pool.query` 直叩き禁止**（ヘルパ一択）、ユニットで「READ ONLY 外の実行経路が無い」ことを固定。
  3. 起動時 canary: `BEGIN READ ONLY` 内で無害な `SELECT 1` のあと、意図的に `CREATE TEMP TABLE` または `UPDATE` 相当が **失敗すること**を確認してから listen（失敗したら process exit）。
  4. 運用: `.env.admin` は `.deploy.env` と分離、chmod 600、共有 PC 禁止を README 受け入れに再掲。将来の RO ロールは follow-up として残す（第1版で必須化はしないが、禁止しない）。
- **Status:** open

### F2 — Severity: Important

- **Location:** Spec §3.4 / §5.2 / §5.5 / §7.2 / §10.2
- **Description:** 秘匿・非露出の列挙が不足している。現行スキーマ上、生成台帳には少なくとも次がある:

  | 列 / 表 | 実装上の意味 | 設計の扱い |
  | --- | --- | --- |
  | `private.ai_generation_requests.identity_key` | `HMAC-SHA256(QUOTA_IDENTITY_HMAC_KEY, normalize(email))` の hex64（`quota-identity.ts`） | **未言及**（一覧列にも出さないリストにも無い） |
  | `request_hmac` / `request_hmac_version` | 正規化コマンド HMAC | `request_hmac` のみ禁止 |
  | `private.billing_customers.stripe_customer_id` | Stripe customer マップ | 課金画面の主表は subscriptions だが **join 禁止が未記載** |
  | `billing_webhook_events.stripe_event_id` | PK | 集計のみ想定だが SELECT * 時に漏洩 |
  | `private.generation_draft_submission_versions.memo` 等 | free-form / 食材 | join 禁止の例が menu/household/profiles に偏る |
  | `private.shared_emergency_recipes.menu_payload` | 共有レシピ本文 | 共有画面は jobs のみだが明示禁止なし |
  | `auth.users` | email 等 | join しないとあるが **auth スキーマ禁止が無い** |

  `terminal_details` は DB 制約上 `constraint_conflict` 時の `{ conflictCodes: [...] }` のみで、設計の「閉じた JSON」は正しい。
- **Why it matters:** identity_key はメールそのものではないが、**同一メールの再登録を横断相関する安定識別子**であり、プロジェクトは生メールを DB に置かない設計（G7）の要である。deny リスト漏れ + `SELECT *` + mapper 穴で API/画面/ログに出ると privacy 不変条件に抵触する。
- **Suggestion:**
  1. §3 に **禁止カラム / 禁止リレーションの正本リスト**を追加する（最低: `identity_key`, `request_hmac*`, 全 `stripe_*` / `*_stripe_*`, `menu_payload`, draft の memo/ingredients/pantry, `auth.*`）。
  2. クエリは **列名を列挙した SELECT のみ**（`SELECT *` 禁止を §7.2 に明文化）。
  3. Zod DTO / mapper テストに identity_key と stripe_customer_id の非含有を必須化（§10.1）。
- **Status:** open

### F3 — Severity: Important

- **Location:** Spec §5.4「上限付近」
- **Description:** 「当日 success が上限付近の **user_id 一覧**（最大 50）」とだけあり、次が未定義:

  1. **集計ソース** — 製品の freemium/Plus 日次 success は `private.ai_identity_daily_usage`（PK `(identity_key, usage_day)`、**user_id 列なし**）。旧 `ai_user_daily_usage` 体系から identity へ移行済み（`20260728150000_identity_daily_quota.sql` / plan-aware で cap 最大 10）。
  2. **上限の定義** — Free 3 / Plus 10 は `shared/contracts/plan-quota.ts` と request スナップショット `quota_success_limit` に存在するが、「付近」が 80% なのか `limit-1` なのか、Plus と Free をどう混在させるか不明。
  3. **user_id への写像** — identity 台帳から user_id は直接取れない。`ai_generation_requests` の当日 `succeeded` 件数で近似するか、identity_key を出さず user_id のみに畳む手順が必要。
- **Why it matters:** このままでは実装者が identity_key を画面に出す、誤った表を scan する、または常に空のパネルを出す、のいずれかになりやすい。ops 上の主目的（枠逼迫ユーザーの把握）が満たせない。
- **Suggestion:** 設計にクエリ契約を1本で固定する。例:

  - JST 当日の `private.ai_generation_requests` で `status = 'succeeded'` を `user_id` 集計し、同一ユーザーの直近 request の `quota_success_limit`（3 or 10）を上限とみなす。
  - 「付近」= `success_count >= quota_success_limit - 1`（または `>= ceil(0.8 * limit)`）を数値で固定。
  - **identity_key は SELECT しない**。表示は user_id と success_count と limit のみ。
  - 代替として identity 台帳を使うなら画面キーは identity ではなく、相関に必要な最小の user_id 導出手順を書く（identity_key 露出は禁止）。
- **Status:** open

### F4 — Severity: Important

- **Location:** Spec §4.1 / §7.1 / §8.3
- **Description:** 本番接続は「Session pooler 推奨」とあるのみ。現行デプロイ正本（`docs/deployment/supabase.md` / `docs/deployment/README.md` / maintenance-db）では次が **必須級**として固定されている:

  - **Shared Session pooler port `5432`**（例: `postgres.<ref>@aws-0-…pooler.supabase.com:5432/postgres`）
  - Direct `db.<ref>.supabase.co` は IPv6 のみになりがち（README の既知つまずき）
  - **`sslmode=require|verify-ca|verify-full`**
  - **port `6543` / transaction mode 禁止**（セッション GuC や TX 意味論が壊れる）
  - URL・パスワードをログ/ヘッダ/エラーに出さない

  設計のヘッダ「接続先 host（パスワード無し）」は良いが、**URL パース失敗時のエラーメッセージ**、起動時バリデーション、Docker コンテナからの到達（DNS/TLS）が未規定。`pg` の SSL と Supavisor の自己署名連鎖は maintenance-db コメントでも既知論点。
- **Why it matters:** 実装者が Direct URL や transaction pooler をそのまま使うと、ローカル Docker から繋がらない / READ ONLY セッション設定が期待通り効かない / TLS エラーで「DB が死んでいる」と誤診する。運用コンソールの受け入れ条件 1–2 が環境依存で flip する。
- **Suggestion:**
  1. §7.1 に `ADMIN_DATABASE_URL` の **受理形**を maintenance に準拠して列挙（Session 5432 + sslmode 必須。6543 は起動時 reject）。
  2. ローカル検証用に、本編スタックの `postgresql://postgres:…@host.docker.internal:54322` 等を使う場合の例外（`sslmode=disable` は **local 明示フラグ**でのみ）を書くか、第1版は本番 URL のみと割り切る。
  3. ヘッダ表示は `URL` パース後の `hostname:port` のみ。password / search params を絶対に返さない（DTO で固定）。
  4. node-pg の SSL 方針（`rejectUnauthorized` をどうするか）を設計か plan の Task に1行で固定。maintenance 実装の既知コメントを参照。
- **Status:** open

### F5 — Severity: Important

- **Location:** Spec §4.3 / §11 / §12.4
- **Description:** 「本編の typecheck / lint / e2e に **勝手に食い込ませない**」とあるが、現行 root スクリプトは次のとおり **リポジトリ全体を対象**にする:

  - `package.json` `format:check`: `find .`（prune は `.git` / `node_modules` / `.netlify` / `infra/supabase/volumes` のみ）→ **`admin/**` の ts/tsx/json/md を検査**
  - `lint`: `eslint .` — `eslint.config.js` の ignores に `admin` 無し。`**/*.{ts,tsx}` が **strictTypeChecked + projectService** で admin を拾う → root `tsconfig` 参照外ファイルで **CI/ローカル lint が赤**になりやすい
  - `typecheck`: `tsc -b` は root references のみなので admin は **型チェックされない**（意図とは一致しうるが lint と非対称）

  設計は admin 単体 vitest を許容するが、**root ゲートとの境界変更（ignore 追加 vs admin を root に載せる）**が未決定。
- **Why it matters:** 実装 PR で本編の `npm run lint` / `format:check` が突然失敗する、または admin を ignore し忘れて型なしコードが本編 CI に混ざる、の両方があり得る。「食い込ませない」と「root が全ツリーを見る」は現状矛盾する。
- **Suggestion:** 設計 §4.3 / §11 で **どちらかに決める**:

  - **推奨 A:** root `eslint.config.js` ignores に `admin/**`、`format:check` の find に `-path './admin' -prune`（または admin 内 node_modules も prune）。admin は `docker compose -f compose.admin.yaml` 経由の独自 script で format/lint/typecheck/test。
  - **B:** admin を root の明示 script / tsconfig project reference に載せ、engines/prettier だけ共有（本編 e2e には載せない）。

  「後から足す」ではなく **第1版の必須境界**として書く。
- **Status:** open

### F6 — Severity: Important

- **Location:** Spec §7.1 / §8.1 / §9.6 / 現行 `.gitignore`
- **Description:**

  1. 現行 `.gitignore` は `.env` / `.env.local` / `.deploy.env` 等のみ。**`.env` パターンは `.env.admin` に一致しない**（git の ignore 規則）。設計は「`.gitignore` に追加」と書いており方向は正しいが、受け入れ条件 §10.2 に **機械的検証が無い**。
  2. `compose.admin.yaml` 概念例は `build.context: .`（リポジトリルート）。`admin/Dockerfile` の COPY 範囲が未規定だと、**ルートの `.env` / `.env.admin` / `.deploy.env` をイメージ層に焼く**事故が起きやすい。
- **Why it matters:** 本番 DB パスワードを含む `.env.admin` のコミットやイメージ配布は、ローカル専用という前提を一瞬で破る。
- **Suggestion:**
  1. `.gitignore` に **`.env.admin` を明示**（コメントで「`.env` では不十分」と残す）。必要なら `.env.admin.*` も。
  2. 受け入れに「`git check-ignore -v .env.admin` がヒットすること」「`.env.admin.example` に実値を書かない」を追加。
  3. Dockerfile は **`COPY admin/package.json` 等の明示コピー**または `context: ./admin` に固定。`.dockerignore` で `.env*` / `.deploy.env` / `node_modules` を除外。`env_file` はランタイム注入のみ（build-arg に秘密を載せない）。
- **Status:** open

### F7 — Severity: Important

- **Location:** Spec §5.6 / §6 `GET /api/share-jobs`
- **Description:** 「長時間 claimed かつ heartbeat が古い滞留ジョブ」とあるが、**時間閾値・対象 status・並び**が未定義。実装スキーマでは `status = 'running'` のとき `claimed_at` / `heartbeat_at` NOT NULL 制約があり、index は `share_generalization_jobs_running_heartbeat_idx`（`heartbeat_at` where running）が存在する。worker 側の lease / heartbeat 間隔（Functions の share-generalize-worker）との数値整合が設計に無い。
- **Why it matters:** ダッシュボードの「滞留」カードが実装者依存のマジックナンバーになり、false positive/negative で運用判断を誤る。
- **Suggestion:** worker 実装の lease/heartbeat を読んで **具体秒**を設計に固定する（例: `status = 'running' AND heartbeat_at < now() - interval '5 minutes'`）。pending の長期放置を別カードにするかも明記。サマリ SQL を §6 か §7 に疑似コードで1本。
- **Status:** open

### F8 — Severity: Important

- **Location:** Spec §5 全般 / §7.2 / API エラー方針
- **Description:** 実装可能性の細部ギャップ:

  1. **明示列 vs 実列:** 生成一覧の列（`quality_mode`, `repair_attempted`, `actual_model_ids`, `global_sent_calls`, `user_usage_day` 等）は現行 `ai_generation_requests` と整合。ただし `personal_quota_disabled` / `quota_*_limit` / `identity_key` の扱いは未定義（出すなら意味、出さないなら deny）。
  2. **feedback 本文検索:** `ILIKE` + bind は良いが、本番 `user_feedback` に body 用 index は無く full scan。件数・timeout（15s）との関係、最低文字数、rate が未記載。
  3. **API エラー:** health は汎用文言だが、他 endpoint が `err.message`（SQL 断片・関係名）を JSON に載せると schema 情報漏洩。
  4. **ページング:** 既定 50 / 上限 100 のみで offset/cursor、`created_at` tie-break（`id`）が無い。生成台帳に **汎用 `created_at` index が無い**（stale / identity_day / unique idempotency のみ）ため、本番で「新しい順 50 件」が seq scan になり得る。
- **Why it matters:** 実装・性能・エラー時 privacy が plan Task に落ちず、レビュー時の手戻りになる。
- **Suggestion:**
  - エラー応答は closed code + 日本語の固定 message のみ（SQL/pg code は server ログに出さないか、code のみ）。
  - ページングは `ORDER BY created_at DESC, id DESC` + keyset か offset を明示。
  - 生成一覧は「直近 N 日」デフォルト（例: 7 日）を必須化し、全表 scan を避ける。
  - feedback キーワードは最小 2–3 文字、timeout 内で切り上げ、結果上限を一覧と共有。
- **Status:** open

### F9 — Severity: Minor

- **Location:** Spec §5 共通 / §6
- **Description:** 「日付・本日は JST」は良いが、フィルタの日付範囲が **JST 暦日 → timestamptz 境界**（`[start, next)`）で切るのか、ブラウザローカルなのかが API 契約として書かれていない。`private.ai_jst_day()` が DB にあることの利用可否も未言及。
- **Why it matters:** ダッシュボード「当日」と生成ログの日付フィルタが 1 日ずれると運用で不信感が出る。
- **Suggestion:** 全 API の日付クエリは **JST 日付文字列 `YYYY-MM-DD`** を受け、server で `Asia/Tokyo` 境界に変換と明記。クライアントは解釈しない。
- **Status:** open

### F10 — Severity: Minor

- **Location:** Spec §3.10 / §5.3
- **Description:** `user_feedback.body` の画面表示は意図的で、ログ禁止と一致。ただし free-form のため **利用者自身が氏名・連絡先・アレルギーを本文に書く**可能性があり、ローカル画面にそれが映る。設計の脅威モデル（信頼オペレータ）上は許容だが、オペレータ向け注意が無い。
- **Why it matters:** スクリーンショット共有や端末共有時の二次漏洩。
- **Suggestion:** UI に「本文は利用者の自由記述。外部共有・スクショ・チャット貼付をしない」短文を出す。詳細 API レスポンスをブラウザ拡張が読むリスクは脅威モデルに1行。
- **Status:** open

### F11 — Severity: Minor

- **Location:** Spec §4.4 / §5
- **Description:** 本編の mobile-first / 44px を適用しない判断は用途的に妥当。キーボード操作「最低限」の具体（フォーカス可視、表の横スクロール、`/` フォーカス等）が無い。
- **Why it matters:** 実装の UI 品質のばらつきのみ。セキュリティ非関連。
- **Suggestion:** plan で「表は横スクロール可、行クリックで詳細、filter は submit 明示」程度で足りる。
- **Status:** open

### F12 — Severity: Minor

- **Location:** Spec §6 API 表 / §5.1
- **Description:** 画面は 6、API は health + 6 リソースで対応は取れている。生成詳細の UUID 参照（`completed_menu_id` 等）を「中身を辿らない」は良いが、**クリック可能な内部リンクを UI が貼ってしまう**と将来の実装が join したくなる。
- **Why it matters:** スコープクリープの芽。
- **Suggestion:** UUID は monospace のコピー用テキストのみ、メニュー詳細画面への導線は作らないと明記。
- **Status:** open

---

## スキーマ照合メモ（実装が正）

設計が触る主オブジェクトと現行実装の対応（問題なければ OK）:

| 設計上のソース | 実装 | メモ |
| --- | --- | --- |
| `private.ai_generation_requests` | あり。status は `processing\|succeeded\|failed\|constraint_conflict` | 一覧列は概ね実在。`identity_key` NOT NULL を deny に追加要 |
| `terminal_details` | conflict 時のみ `{conflictCodes}` | 設計どおり閉じている |
| `private.ai_global_daily_usage` | `usage_day`, `reserved_count`, `sent_count` | ダッシュボードと一致 |
| `public.user_feedback` | category / body / client_path / user_id | RLS deny-all + service_role GRANT。**直 SQL なら postgres で読める** |
| `private.billing_subscriptions` | status / period / past_due / cancel_at_period_end / stripe_* | stripe 列の非露出は必須 |
| `private.billing_webhook_events` | `stripe_event_id`, `event_type`, … | 集計は event_type のみ |
| `private.share_generalization_jobs` | status / failure_code / skip_reason / models / contributor_user_id | 列一致。滞留閾値のみ不足 |
| `private` の service_role 表 GRANT | **none**（matrix 通り） | 直 Postgres URL 方針は正しい |

成功日次の **user 単位**正本は identity 台帳側（F3）。

---

## Positive notes

1. **配置と起動の分離**（`admin/` + `compose.admin.yaml`、本編 `depends_on` なし、Netlify/CI 非接続）は所有境界が明確で、本編リリース経路を汚しにくい。
2. **PostgREST ではなく DB URL**を選んだ理由が、`private` 非公開という実装事実に根ざしており説得力がある。service_role 鍵を増やさない判断も鍵面で妥当。
3. **GET のみ・名前付きクエリ・Zod DTO・mapper 二重化・ログに query string / feedback 本文を残さない**は、プロジェクトの SafeLog / free-form 方針と整合。
4. **識別を UUID に限定**し、献立・下書き・prompt・生 AI を対象外にしたスコープは、運用 UI として最小権限の思想に近い。
5. 受け入れ条件に「ブラウザ NW に DB URL が出ない」「書き込みメソッド拒否」を入れている点は検証可能で良い。

---

## 推奨する設計改訂の順序（承認前）

1. F2 禁止リスト + F3 上限付近クエリ契約（privacy と画面仕様の中核）
2. F4 接続 URL 契約 + F1 残存書込リスクの人間向け明記 / canary
3. F5 root tooling 境界 + F6 `.env.admin` / Docker 秘密
4. F7 滞留閾値 + F8 エラー/ページング/スキャン範囲
5. Minor（F9–F12）は plan でも可だが、JST 境界（F9）は API を書く Task より前が望ましい

改訂後、二次レビュー（別エージェント）で deny リストと接続バリデーションの抜けを再確認することを推奨する。
