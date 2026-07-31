# 敵対的コードレビュー結果 — 2026-07-25

対象: 作業ツリーの現状（`main` @ `242455d` + 未コミット変更 25 ファイル + 新規マイグレーション 1 本）。

サブエージェント 5 体による並列レビュー。担当領域は (1) 未コミット差分全体、(2) `netlify/functions/**`、
(3) `supabase/**` / DB スキーマ、(4) `src/**` フロントエンド、(5) `shared/**` / `e2e/**` / インフラ設定。

**本レポートは指摘のみで、修正は一切行っていない。**

集計: **Critical 3 / Important 16 / Minor 17 / 要確認 8**

---

## サマリ（優先度順）

| # | 重要度 | 指摘 | 場所 |
|---|--------|------|------|
| C-1 | Critical | `public.user_feedback` が原因で pgTAP が 2 本失敗（DB 検証ゲートが赤） | `supabase/migrations/20260725120000_user_feedback.sql` |
| C-2 | Critical | 生成ファイル `database.generated.ts` が手編集されている（ハード禁止事項違反） | `src/shared/types/database.generated.ts:2264` |
| C-3 | Critical | `.dockerignore` の抜けで `.env.local` / `*.log` / `.netlify` がイメージ層に入る | `.dockerignore` |
| I-1 | Important | フィードバック 5 件/24h 上限が TS 側でも SQL 側でも無検証になった | `submit-feedback.test.ts` / 新 migration |
| I-2 | Important | 短期レート制限 4 回/600s が固定タンブリング窓でバーストを許す | `20260711002000_ai_control_and_quota.sql:508` |
| I-3 | Important | `Retry-After` を上限クランプなしで永続化・UI 返却 | `_shared/openrouter.ts:86` |
| I-4 | Important | CSP `connect-src https://*.supabase.co` が exfiltration 経路を残す | `netlify.toml:31` |
| I-5 | Important | `user_feedback` に保持ポリシーが無く自由記述が無期限に残る | `20260725120000_user_feedback.sql` |
| I-6 | Important | 新規マイグレーションに pgTAP テストが 0 本 | `20260725140000_*.sql` |
| I-7 | Important | advisory lock キーが `save_generation_draft` と完全衝突 | 新 migration `:150` |
| I-8 | Important | 緊急献立の遷移中止ロジックが削除時に失われた（挙動＋テストの回帰） | `planner-route.tsx:301` |
| I-9 | Important | 「今はAIを使わない」が永続化されず `/privacy` 往復が無限に続く | `privacy-api.ts:41` |
| I-10 | Important | `/login` に認証済みガードが無い／Google ボタンに二重送信ガードが無い | `login-page.tsx` |
| I-11 | Important | 買い物リストのクエリキーだけ userId で名前空間化されていない | `use-shopping-list.ts:25` |
| I-12 | Important | `isMateriallySameMenu` が同一 role の複数料理を 1 対 1 対応させない | `shared/safety/deduplicate.ts:54` |
| I-13 | Important | 緊急献立のメイン食材照合が逆方向 `includes` で過剰マッチ | `filter-emergency-menus.ts:198` |
| I-14 | Important | レース検証 E2E の最終 `release()` にアサーションが無い | `shopping-list-races.spec.ts:109` |
| I-15 | Important | タッチターゲット検査が高さのみで 44×44 の幅を見ていない | `mobile-accessibility.spec.ts:28` |
| I-16 | Important | `tools/e2e-function-server.test.mjs` がどのゲートからも実行されない | `vitest.config.ts:22` |
| I-17 | Important | `createGenerationDeps` の `process.env` 差し替えは並行安全でない | `generation-service.ts:493` |
| I-18 | Important | `docs/testing/database-access-matrix.md` が pgTAP と乖離 | 同 doc `:48,:193` |

---

## Critical

### [C-1] `public.user_feedback` が原因で pgTAP が 2 本失敗する（DB 検証ゲートが現在赤）

- **場所**: `supabase/migrations/20260725120000_user_feedback.sql:5-27`
  （落ちるのは `supabase/tests/database/rls_inventory.test.sql:32-40` と
  `supabase/tests/database/account_deletion.test.sql:28-51`）
- **問題**: 2 系統のインベントリ assert に引っかかる。
  1. `rls_inventory` assert(3) は「`public` かつ `user_id` 列を持つテーブルには必ず `pg_policy` が 1 件以上ある」ことを要求する。`user_feedback` は `user_id uuid not null` を持ち RLS 有効だが、ポリシーを 1 本も作っていない（migration `:21` のコメントどおり「ポリシー無し＝deny」の意図的設計）。除外条件が入っていない。
  2. `account_deletion` の逆インベントリ assert は「`public` の base table で `user_id` 列を持つのに expected リスト（24 件）に無いもの」を空集合と主張する。`user_feedback` は expected に含まれていない。
- **再現/影響**: `docker compose --profile test run --rm db-test` で 2 本 fail。未コミット差分は `rls_inventory.test.sql` を触っている（assert(7) の routine 一覧のみ更新）のに assert(3) は放置されており、**この差分の検証ゲートが通らない状態でコミットされようとしている**。
- **根拠**（実測）:
  ```
  $ grep -n "policy\|enable row level" supabase/migrations/20260725120000_user_feedback.sql
  21:-- ブラウザ向け policy/grant は置かず、service_role のみが Data API 外で操作する。
  22:alter table public.user_feedback enable row level security;   ← create policy が 0 件
  $ grep -n "user_feedback" supabase/tests/database/account_deletion.test.sql
  （ヒット 0 件）
  ```
- **備考**: 発生源は既コミット `20260725120000` だが、2 体のレビュアが独立に検出し、こちらでも静的に確認済み。直し方は「`rls_inventory` に除外条件を足す」か「`using (false)` の明示 deny ポリシーを置く」かの設計判断が要る（後者ならポリシー期待一覧 `rls_inventory.test.sql:305-344` にも追記が必要）。

### [C-2] 生成ファイル `database.generated.ts` が手編集されている

- **場所**: `src/shared/types/database.generated.ts:2264-2278`
- **問題**: `CLAUDE.md` の「No hand-editing generated files … `src/shared/types/database.generated.ts`」に直接違反。証拠は 2 点。
  1. **辞書順違反**: `Functions` は codegen がアルファベット順に出力するが、`insert_user_feedback_rate_limited` だけが `get_ai_usage_today` と `get_current_safety_snapshot` の**間**に挿入されている。再生成でこの位置は起こり得ない（正しくは `get_shopping_mutation_replay` と `lookup_ai_generation_request` の間）。
  2. **postgres-meta が出さない型**: `p_client_path: string | null` は Args に `| null` を持つ唯一のエントリ。本リポジトリの明示コンベンションは `src/shared/types/database.ts` のコメント「Postgres Meta は nullable 引数を非 null として生成するため、overlay で復元する」で、`p_draft_id` などは全て overlay 側で復元されている。
- **再現/影響**: `npm run db:types` を回すと (a) 並び順が正規化されて大差分が出る、(b) `p_client_path` が `string` になり `netlify/functions/submit-feedback.ts:76` の `p_client_path: input.clientPath`（`string | null`）が `exactOptionalPropertyTypes` 下で型エラー。**現在の typecheck green は手編集に依存している**。再生成していないため他のスキーマ型ずれも検出できていない。
- **根拠**: `git diff src/shared/types/database.generated.ts` が「`get_ai_usage_today` の `Args` 1 行書き換え + 直後に 11 行のブロック挿入」だけで、他の並べ替えが一切ない。

### [C-3] `.dockerignore` の抜けで `.env.local` / `*.log` / `.netlify` がイメージ層に焼き込まれる

- **場所**: `.dockerignore`（全 14 行）、`Dockerfile:8`（`COPY --chown=node:node . .`）、`Dockerfile:25`（`COPY . .`）
- **問題**: `.gitignore` は `.env.local` / `.netlify` / `*.log` / `.e2e-function.log` / `.superpowers` を除外しているのに、`.dockerignore` が除外するのは `.env` と `.env.tmp-*` だけ。実測:
  ```
  .git .worktrees node_modules dist coverage playwright-report test-results
  .env .env.tmp-* .run-e2e.lock infra/.supabase-refresh.* infra/.supabase-refresh.lock
  infra/supabase/volumes
  ```
- **再現/影響**:
  1. Vite は `.env` に加え `.env.local` / `.env.[mode].local` を読む。`.env.local` を置いた開発者のイメージにはそれが層として残り、`build` ステージでは `dist` にインライン化される。`scripts/verify-browser-secrets.mjs` の `SCAN_ROOTS = ["src","shared","dist"]` はイメージ層を見ないので検知できない。
  2. `.e2e-function.log`（現に repo root に存在、app コンテナの生ログ）が未検査のまま層に入る。`KONDATE_ASSERT_PRIVACY_LOGS=1` は CI の run-e2e 経路でしか走らない。
  3. `.netlify/` は Netlify CLI のローカル state（site id 等）。
- **備考**: compose は `.:/workspace` を bind mount するので**実行時挙動には影響しない** — 問題はイメージ層に残ること。`tests/tooling/project-config.test.mjs:86-101` は 4 パターンしか両ファイルに要求しておらず、この抜けはテストで固定されていない。

---

## Important

### [I-1] フィードバック 5 件/24h 上限が TS 側でも SQL 側でも一切テストされなくなった

- **場所**: `netlify/functions/_tests/submit-feedback.test.ts:78-87`、`supabase/migrations/20260725140000_*.sql:128-167`
- **問題**: 変更前は `countRecentFeedback.mockResolvedValue(5)` でハンドラ内の閾値ロジック `recentCount >= feedbackDailyLimit` を検証していた。変更後は `submitRateLimited.mockResolvedValue({ rateLimited: true })` になり「モックが返した値を 429 にマップする」ことしか見ていない。`expect(insertFeedback).not.toHaveBeenCalled()` も削除された。実判定は SQL に移ったが、`supabase/tests/database/` に `insert_user_feedback_rate_limited` の機能テストは 0 本。
- **再現/影響**: SQL の `if v_count >= p_limit` を `>` に変えても、`v_since` を誤っても、上限を 5→6 に壊しても、全テストが緑。**アサーションを緩めただけの変更**になっている。
- **根拠**:
  ```diff
  -    countRecentFeedback.mockResolvedValue(5);
  +    submitRateLimited.mockResolvedValue({ rateLimited: true });
       expect(response.status).toBe(429);
  -    expect(insertFeedback).not.toHaveBeenCalled();
  ```

### [I-2] 短期窓 4 回/600s が固定タンブリング窓のため境界跨ぎでバーストを許す

- **場所**: `supabase/migrations/20260711002000_ai_control_and_quota.sql:508-518`（呼び元 `_shared/generation-repository.ts:239` `markSent`）
- **問題**: 窓起点を `floor(epoch/600)*600` で丸めた固定窓で `sent_count >= 4` のみ判定。スライディング窓でないため境界前後で実効上限が倍になる。
- **再現/影響**: 10:09:55〜59 に 4 回（窓 A）→ 10:10:00〜04 にさらに 4 回。約 10 秒で計 8 回の外部 AI 送信が通る。仕様「4 回/10 分」のバースト抑止が境界近傍で 2 倍に緩む。日次 12 回上限が残るため被害は限定的。
- **根拠**: `v_window_started_at := to_timestamp(floor(extract(epoch from p_now) / 600.0) * 600.0);` … `if v_window.sent_count >= 4 then`

### [I-3] OpenRouter の `Retry-After` を上限クランプなしで永続化・返却

- **場所**: `_shared/openrouter.ts:86-100` → `generation-service.ts:877,937` → `generation-repository.ts:274-282`
- **問題**: 外部プロバイダが完全制御するヘッダを上限クランプなしで台帳に書き、`quota.retryAt` としてクライアントへ返す。数値形式・HTTP-date 形式のどちらにも上限がなく、下限 `parsed >= now` しか無い。
- **再現/影響**: `Retry-After: Fri, 01 Jan 2100 00:00:00 GMT` や `999999999` で「2100 年まで再試行不可」と表示される。外部入力が UI の可用性表示を任意に汚染できる。
- **根拠**: `const target = now + Number(retryAfter) * 1_000;` / `return date.toUTCString() === retryAfter && parsed >= now ? date.toISOString() : null;`

### [I-4] CSP `connect-src` のワイルドカードが exfiltration 経路を残す

- **場所**: `netlify.toml:31`
- **問題**: サーバ env は本番で `https://<20文字ref>.supabase.co` の完全一致しか受理しない（`_shared/env.ts:9,152-169`）のに、ブラウザ CSP は任意の Supabase プロジェクトへの通信を許可している。
- **再現/影響**: XSS や依存関係汚染時、攻撃者の無料 Supabase プロジェクト（例 `https://aaaaaaaaaaaaaaaaaaaa.supabase.co`）へトークンや家族設定を `fetch` で送出できる。
- **根拠**: `connect-src 'self' https://*.supabase.co wss://*.supabase.co` 対 `const managedSupabaseOrigin = /^https:\/\/([a-z0-9]{20})\.supabase\.co$/u;`
- **判断の分岐**: 別レビュアはこの値が `docs/archive/superpowers/plans/2026-07-11-kondate-mvp-06-hardening-deployment.md:972` の逐語値と一致するため指摘から除外している。**計画書の literal 値なので、変更する前に人間の判断が要る**（CLAUDE.md「計画の literal 値は勝手に締めない」）。ここでは「計画書自体にこの緩さがある」ことの提起として残す。

### [I-5] `public.user_feedback` に保持ポリシーが無く、自由記述本文が無期限に残る

- **場所**: `supabase/migrations/20260725120000_user_feedback.sql:5-18`、`20260724110606_maintenance_cleanup.sql:240-273`
- **問題**: `run_kondate_maintenance` は 4 カテゴリ（stale 予約 / 生成台帳 / shopping mutation / auth continuation）しか掃除せず、`user_feedback` は対象外。`body`（10〜2000 文字の自由記述）と `client_path` の削除契機はアカウント削除の cascade のみで、TTL 相当の列も無い。
- **再現/影響**: CLAUDE.md「Never log or persist names, emails, allergies, free-form conditions …」および 30 日保持方針と緊張関係にある。利用者が本文に氏名・アレルギー・症状を書けば無期限に蓄積する。
- **要確認**: フィードバック機能は `docs/archive/superpowers/specs/` に仕様記述が見当たらず、Plan 由来でない後付けに見える。自由記述の永続化が設計上許容されているかの裏取りが必要。

### [I-6] 新規マイグレーションに pgTAP テストが 1 本も無い

- **場所**: `supabase/migrations/20260725140000_usage_today_global_limit_and_feedback_rate.sql:8-172`
- **問題**: (a) `get_ai_usage_today` の `p_global_limit` 伝播、(b) `insert_user_feedback_rate_limited` の 5 件目まで成功 / 6 件目 `feedback_rate_limited` / 24h 境界外で再成功、のいずれにも DB テストが無い。既存 `ai_control_and_quota.test.sql:2693` は `has_function` と 2 引数呼び出しの検証のみで `p_global_limit` を通らない。`user_feedback` に対し `authenticated` で `select`/`insert` が実際に拒否されることを示す negative test も無い。
- **再現/影響**: マイグレーション先頭コメント自身が警告している「旧 2 引数 overload 残存」リグレッションを pgTAP が検出できない。
- **根拠**: `grep -rn "insert_user_feedback_rate_limited\|user_feedback" supabase/tests/` のヒットは `rls_inventory.test.sql:263` の grant 一覧の文字列のみ（実測確認済み）。

### [I-7] advisory lock キーが `save_generation_draft` と完全衝突する

- **場所**: 新 migration `:150`
- **問題**: `pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0))` は `save_generation_draft`（`20260722130029_target_mode_storage.sql:130-132`）のキーと**文字列として同一**。advisory lock は DB 全体で単一の 64bit 名前空間。他の並行制御（`reserve_ai_generation` 等）は `user_id || ':' || idempotency_key` で名前空間を分けており、無印 `user_id` を使うのは draft autosave とこの新関数だけ。
- **再現/影響**: 同一利用者のフィードバック送信と planner の下書き自動保存が、無関係なのに相互に直列化される。各関数が 1 ロックのみのためデッドロックは起きないが、原因の分かりにくい待ちになる。

### [I-8] 緊急献立の保存待ち中に対象家族が対象外になっても遷移を中止しない（削除に伴う回帰）

- **場所**: `src/features/planner/planner-route.tsx:301-313, 417-451`
- **問題**: 削除された `planner-page.tsx`（`git show HEAD:src/features/planner/planner-page.tsx` の 146-166 行）は適格性変化時に緊急献立遷移を能動中止していた:
  ```ts
  if (activeOperationRef.current === "emergency") {
    operationGenerationRef.current += 1;
    activeOperationRef.current = "idle";
    setIsOpeningEmergencyMenus(false);
    setGenerationError("作る相手の条件が変わったため、緊急献立への移動を中止しました。");
  }
  ```
  新 `planner-route.tsx` の同等 effect は `setValue(...)` で選択を同期するだけ。`emergencyOperationIdRef` が進むのは unmount 時（`:276`）のみで、`openEmergencyMenus` の非同期本体（`:429-443`）は `flushDraft()` 後に無条件 `navigate("/emergency-menus")` する。
- **再現/影響**: review で緊急献立を押す → `flushDraft()` 中に他タブの家族更新で対象が blocked 化 → 中止も文言も無くそのまま遷移。`EmergencyMenuPage` 側が `emergency-menu-page.tsx:131-141` で再フィルタするため**安全ホールではない**が、「対象 0 件」画面へ黙って落ちる不可解な挙動になる。
- **根拠**: 削除された `planner-page.test.tsx` に「緊急献立の保存待ち中に対象家族が対象外になった場合は遷移を中止して選択を同期する」というテストが存在した。現行 `planner-route*.test.tsx` / `planner-wizard.test.tsx` に代替は 0 件。**挙動とテストが同時に消えている**。
- **注**: 削除された 1027 行のうち、これ以外の主要契約（8 件上限・80 文字 NFKC、20 人上限、draft 競合、flush 待ち、対象 0 件 guard）は移行先を確認済みで、実質的なカバレッジ喪失はこの 1 点のみ。

### [I-9] 「今はAIを使わない」で拒否が永続化されず `/privacy` へ往復し続ける

- **場所**: `src/features/privacy/privacy-notice-page.tsx:38-40`、`privacy-api.ts:41-43`、`planner-route.tsx:394,569-572`
- **問題**: 変数名は `hasAcceptedOrDeclinedPrivacy`（同意**または拒否**）だが、実体は
  ```ts
  export function hasCurrentPrivacyConsent(row: PrivacyConsentRow | null): boolean {
    return row?.notice_version === privacyNoticeVersion;
  }
  ```
  で行の有無しか見ない。行を作るのは `acceptCurrentPrivacyConsent`（同意）だけ。拒否を記録する API は存在せず、`onSkip` は `navigate(returnTo, {replace:true})` するだけ。
- **再現/影響**: 「献立を作る」→ `/privacy?returnTo=…` →「今はAIを使わない」→ `/planner?resume=review` → また「献立を作る」→ また `/privacy`。同意するまで無限往復し、planner 側に理由表示は無い。AI をブロックすること自体は fail-closed で正しいが、識別子が示す設計と実装が食い違い「押しても何も起きない」に見える。
- **根拠**: `grep -rn "declined" src/features/privacy` は 0 件。

### [I-10] `/login` に認証済みユーザーのガードが無い／Google ボタンに二重送信ガードが無い

- **場所**: `src/app/router.tsx:19-24`、`src/features/auth/login-page.tsx:26-33,163-165,184`
- **問題**: `/login` は `RequireSession` の外側の独立ルートで、`LoginPage` は `useAuth()` を参照しない。他の入口（`root-entry-page.tsx:60-63`、`welcome-page.tsx:53-55`、`generation-page.tsx:31-33`）は全て状態依存の `<Navigate>` を持つのに `/login` だけ無い。
- **再現/影響**: ログイン済みで `/login` を直接開く／ログイン直後に「戻る」で戻ると、有効セッションがあるのにフォームが出続け、前進導線が OAuth 再実行か URL 手打ちしかない。加えて「Googleで続ける」に pending/disabled が無く、連打で `auth-flow.ts:212-233` が `POST /api/auth/continuations` を複数発行し localStorage に未使用 flow を残す（メール送信側 `:184` は `disabled={state.status === "sending"}` を持つのに非対称）。

### [I-11] 買い物リストのクエリキーだけ userId で名前空間化されていない

- **場所**: `src/features/shopping/hooks/use-shopping-list.ts:25-27`、`menu-result-page.tsx:470`、`history-detail-page.tsx:460`
- **問題**: 他 feature は全て所有者 ID を含む（`pantryKeys.list(userId)`、`historyKeys.groups(userId)`、`usageTodayQueryKey(userId, jstDay)`、`["menu-result", userId, menuId]` …）。買い物だけ `["shopping","active"]` / `["shopping","reconcile-target", menuId, listId]` で userId が無い。`QueryClient` は `src/main.tsx:19` で router/auth の外側に 1 個だけ生成され、`queryClient.clear`/`removeQueries` の呼び出しは（テストを除き）0 件。
- **再現/影響**: 同一ドキュメントのままユーザーが切り替わる経路（`auth-callback-page.tsx:46` は SPA 遷移）で、前ユーザーの買い物品目（ユーザー入力文字列）が `staleTime: 30_000` の間描画され得る。実運用の主経路は全てフルリロードなので現状は踏みにくいが、規約がここだけ破れ防御が 1 枚しか残っていない。

### [I-12] `isMateriallySameMenu` が同一 role の複数料理を 1 対 1 対応させない

- **場所**: `shared/safety/deduplicate.ts:51-57`（特に `:54`）
- **問題**: `right.dishes.find((candidate) => candidate.role === dish.role)` は常に「最初に見つかった同 role の料理」を返す。左に同 role が複数あると全部が右の同じ 1 品と比較され、one-to-one マッチングにならない。件数一致しか見ておらず、消費済み候補を除外する仕組み（`shared/shopping/diff.ts:47-65` の `takeCandidate` のような）が無い。
- **再現/影響**: left = `[{side,"A"},{side,"A"}]`, right = `[{side,"A"},{side,"B"}]` で `every` が 2 回とも "A" と比較して true → 「実質同一」と判定され再生成が棄却される。left/right を入れ替えると false になり、**引数順に依存する非対称な述語**になっている。`ai-generation-output.ts:130` は dishes 1〜5 品・role 5 値なので同 role 重複は普通に起こる。

### [I-13] 緊急献立のメイン食材照合が逆方向 `includes` で過剰マッチする

- **場所**: `shared/emergency/filter-emergency-menus.ts:198-203`
- **問題**: `candidateName.includes(mainIngredient) || mainIngredient.includes(candidateName)` の第 2 項は「候補の食材名がユーザー指定食材の部分文字列である」だけでマッチ扱いにする。候補側は調味料など短い語（"塩" "米" "油" "水"）を含むため、ほぼ任意の指定に対し true になる。
- **再現/影響**: `mainIngredients=["塩鮭"]` 指定 → 鮭を含まない fixture でも "塩" があれば `"塩鮭".includes("塩")` で true。`"玄米"×"米"`、`"米油"×"油"` も同様。逆に `emptyReason: "main_ingredient_no_match"` はほぼ発火せず、`:214-222` の空理由の出し分けが意味を失う。
- **根拠**: 同ファイル `:193` のコメントは「料理名と材料名だけを対応根拠にする」と境界を絞る意図を明示している。対比として `shared/safety/food-rules.ts:148-199` は総称語の過剰一致を避けるため `doesGenericIngredientMatch` / `doesConcreteFishIngredientMatch` で明示的に食材境界を検査しており、ここだけ素の双方向部分一致。

### [I-14] レース検証 E2E の最終 `release()` にアサーションが無い

- **場所**: `e2e/specs/shopping-list-races.spec.ts:105-109`
- **問題**: 前半（`:81-88`）は解放ごとに観測点を置いている（`reload.release()` → まだ disabled、`sourceRevalidation.release()` → enabled）。後半のアレルギー追加分岐は `allergyReload.release()` 後に assert が 1 つあるだけで、最後の `allergyRevalidation.release()`（`:109`）の後にアサーションが 1 つも無くテストが終わる。
- **再現/影響**: 「くるみを新規登録したあと安全再検証が完了しても買い物操作は解放されない（fail closed のまま）」という、このテストが主張したい最終状態が一切検証されていない。再検証完了後に全項目が enabled に戻る回帰が入っても緑のまま通る。

### [I-15] タッチターゲット検査が高さのみで 44×44 の幅を見ていない

- **場所**: `e2e/specs/mobile-accessibility.spec.ts:21-31`（特に `:28`）、同 `:210`
- **問題**: `assertMajorActionHeights` は `boundingBox()` を取得しておきながら `box?.height` しか検査せず `box?.width` を見ていない。
- **再現/影響**: グローバル制約は「44×44 CSS px touch targets」。高さ 44px・幅 24px のアイコンボタンや、320px 幅で分割された短ラベルボタン（`追加`, `次へ`）は幅不足でも 320/375/430 の全サイズで緑になり、E2E 上 44×44 が担保されていると誤認される。

### [I-16] `tools/e2e-function-server.test.mjs` がどのゲートからも実行されない

- **場所**: `vitest.config.ts:21-25`、`scripts/ci.sh:20-32`
- **問題**: `vitest.config.ts:22` が `"tools/e2e-function-server.test.mjs"` を `exclude` している一方、`scripts/ci.sh` の `node --test` 明示列挙にも含まれていない。他の `tools/**/*.test.mjs` は vitest の `include` で拾われている。除外理由のコメントも無い（`:23` のコメントは下の maintenance-db 統合テストに対するもの）。
- **再現/影響**: `tools/e2e-function-server.mjs` は `tools/run-e2e-app.mjs` 経由で E2E 実行時の `/api/*` を丸ごと担う。その唯一のユニットテストが CI でもローカルでも走らず、E2E 基盤の回帰は E2E 全体が落ちるまで気づけない。
- **根拠**: `find tools scripts tests -name '*.test.mjs'` の 15 件のうち、ci.sh 列挙 12 件 + vitest include 2 件 = 14 件が実行対象。残り 1 件がこれ。

### [I-17] `createGenerationDeps` の `process.env` 差し替えは並行安全でない

- **場所**: `netlify/functions/_shared/generation-service.ts:493-509`
- **問題**: コメントは「並行リクエストで環境変数を奪い合わないよう」と書くが、`process.env` はプロセス共有の単一可変状態で、`await` を跨ぐ差し替え/復元はインターリーブで壊れる。
- **再現/影響**: A が `scenario=A` → B が `scenario=B` → A の fetch が B のシナリオを送る。さらに B の `finally` が "A" を復元し、以後の無シナリオ要求にも漏れ残る。本番 base URL では `readLocalMockScenario`/`isExactLocalMockBaseUrl` の二重ガードで送出されないためセキュリティ影響はローカル/E2E 限定だが、E2E フレークの原因になり、かつ**コメントの主張が誤り**。

### [I-18] `docs/testing/database-access-matrix.md` が pgTAP と乖離

- **場所**: `docs/testing/database-access-matrix.md:48,193`（対応する `rls_inventory.test.sql:262-263`）
- **問題**: `rls_inventory.test.sql` は冒頭で「expected_* CTEs are … documented in `docs/testing/database-access-matrix.md`」と宣言し、アサーション名も `routine EXECUTE grants match database-access-matrix`。SQL 側の values は更新されたが doc は旧内容のまま。
  - `:193` は `get_ai_usage_today(p_user_id uuid, p_now timestamptz)` で `p_global_limit integer` が欠落。
  - `insert_user_feedback_rate_limited` の行が無い。
  - `:48` の `user_feedback` 行は `free-form body rate-limited in Netlify` だが、本変更で rate limit は SQL の SECURITY DEFINER 関数へ移動している。
- **再現/影響**: doc とテストが権威を分け合う構造のため、この doc を根拠に権限監査した人が誤ったシグネチャ／欠落関数を「正」と扱う。

---

## Minor

### DB / マイグレーション

1. **`greatest(p_global_limit, 1)` が NULL を silently 1 に潰す** — 新 migration `:41`。Postgres の `greatest()` は NULL を無視するため `p_global_limit => null` で `v_global_limit = 1` になり `globalAvailable` が実質常に false。現行呼び出し元は env 検証済み整数を渡すため実害なし。
2. **`p_window_seconds` が未検証** — 新 migration `:141-147`。`p_limit` には `< 1` の raise があるが `p_window_seconds` には無い。0 以下なら `v_since` が未来になり `count(*)` が常に 0、null なら比較が unknown でやはり 0 → レート制限が無効化。呼び出しは service_role のみなので現時点で外部からは踏めない。
3. **`p_global_limit` の検証が `reserve_ai_generation` と非対称** — 予約側は `not between 1 and 45 → raise 'invalid_quota_configuration'` で release-locked 値を強制するのに、表示側は `greatest(..., 1)` で黙って丸めるだけ。設定ミス時に「usage-today は残枠あり、予約 RPC は例外」の食い違いが出る。
4. **`drop function` + `create function` によるデプロイ順序依存と非冪等性** — 新 migration `:6-8`。マイグレーション適用前に新 Function コード（`usage-today.ts:18-21`）が先にデプロイされると PGRST202。`create or replace` でないため再適用で `42723`。同ファイル後半の `insert_user_feedback_rate_limited`（`:128`）は `create or replace` を使っており**ファイル内でも不統一**。
5. **`rls_inventory.test.sql:263` の期待値も辞書順から外れた位置に挿入** — 集合比較なので機能上は無害だが、`database.generated.ts` と同じ挿入位置ミスで、両者が同一の手作業由来であることを裏づける。

### サーバサイド

6. **`returnTo` 検証 `^\/[^/]` がバックスラッシュ始まりを許す** — `auth-continuation-create.ts:19-22`、`auth-continuation-claim.ts:26-28`。`//evil.com` は弾くが `/\evil.com` は通過し WHATWG URL 正規化で `https://evil.com/` になる。ブラウザ側 `sanitizeReturnPath`（`auth-flow.ts:39-53`）が origin 比較で潰すため実害なしだが、多層防御の欠落。
7. **`emergency-menus` が認証より先に入力検証し、未認証者へ Zod fieldErrors を返す** — `emergency-menus.ts:60-77`。他ハンドラは全て `requireUser` → `parseJson` の順。`_tests/emergency-menus.test.ts:171-187` の `expect(authenticate).not.toHaveBeenCalled()` がこの順序を意図として固定しているため、設計意図か取り違えかコード上判別できない。
8. **`markSent` の `sent` 既定値が fail-open** — `generation-repository.ts:246-254`。`sent: extras.success ? (extras.data.sent ?? processing) : processing` は「不明なら送った扱いで続行」。現行 SQL は必ず `sent` を返すため実害なしだが、直上コメントの「fail-closed」と実装が不一致。
9. **未検査キャスト `primaryCode as GenerationFailureCode`** — `generation-context.ts:628`。優先度配列に `GenerationFailureCode` 外のコードを足すと `failureCopy[code]` が undefined になり `generation-service.ts:394` で TypeError → 500。CLAUDE.md の「型境界で unchecked cast を置かない」に反する。
10. **`parseJsonRequest` の Content-Type 完全一致** — `_shared/http.ts:32`。`application/json; charset=utf-8` が `invalid_request` になり auth-continuation 3 本が失敗し得る。`parseJson`（生成・買い物系）には同検査がなく境界が不揃い。

### フロントエンド

11. **`/privacy` 内の「運営者のプライバシー説明」リンクが自分自身を指す** — `privacy-notice-page.tsx:73` の `<a href="/privacy" target="_blank">`。押すと同じ同意画面が新タブで開く。`rel="noreferrer"` はあるのでセキュリティ問題は無し。
12. **SPA 内リンクに生の `<a href>`** — `emergency-menu-page.tsx:175,192,199,224`、`shopping-list-page.tsx:74,77`、`current-safety-summary.tsx:15`、`audience-step.tsx:151`。`history-page.tsx` 等は `Link` を使っており不統一。押す度にドキュメント全体を再取得し `QueryClient`/`AuthProvider`/生成復旧フックが作り直される。※`generation-status-panel.tsx:60-88` は `:49-50` のコメントで意図的と明記されており対象外。
13. **買い物の追加/編集フォームが送信中に無効化されない** — `shopping-list-page.tsx:434,347` は `disabled={safetyBlocked}` のみで、`safetyBlocked` は POST 中 false。連打で 2 本 POST が飛ぶが両方同じ `expectedListVersion` なので OCC が重複を防ぐ。ただし利用者には実態と異なる「別の画面で更新されました」が出る。
14. **`DangerZone` の `aria-label` が英語** — `account-settings-section.tsx:28` の `aria-label="DangerZone"`。日本語コピー規約に反し支援技術にだけ英語が露出。見出し「危険な操作」があるので `aria-labelledby` で足りる。
15. **`aria-label` と `aria-labelledby` の同時指定** — `account-settings-section.tsx:123-127`。`aria-labelledby` が勝ち「アカウント設定」は無視される。
16. **ルート遷移後の h1 フォーカスがローディング画面で働かない** — `app-shell.tsx:120-132` は rAF 1 フレームだけ待って `main h1` を探すが、`shopping-list-page.tsx:48-52`、`planner-route.tsx:460-466`、`protected-routes.tsx:9` はいずれも h1 を持たない。実機ではフォーカスが直前のナビリンクに残る。
17. **`usageTodayQueryKey` の JST 日付がレンダー時評価** — `use-usage-today.ts:14-25`（`use-generation-recovery.ts:340,347,352` も同様）。`/planner` を開いたまま JST 0:00 を跨ぐと前日の残数が出続け、サーバ実残数と食い違う。
18. **`CreateListSheet` の初期モードが遅れて届く `activeList` に追従しない** — `create-list-sheet.tsx:22`。シート表示時に `activeList` 未取得だと `mode` が `"new"` に固定され、直後に現れるラジオ群で「新しいリストにする（＝既存をアーカイブ）」が既定選択になる。呼び出し側 `menu-result-page.tsx:815-824` は `key` によるリマウントをしていない。

### shared / インフラ

19. **買い物リスト集約の数量が浮動小数のまま連結され表示文字列が壊れる** — `shared/shopping/aggregate.ts:63,74`、`diff.ts:86,92`。丸めも量子化もせず `${String(quantityValue)}${unit}` を `quantityText` にする。0.1 + 0.2 で `"0.30000000000000004g"` が表示され、`diff.ts:111-112` は `quantityText` の文字列一致で replace 要否を判定するため誤検出も起こる。`shared/contracts/shopping.ts:13` は `.max()` も `.multipleOf(0.001)` も持たない（`pantry.ts:22` / `regeneration.ts:107-109` は課している）。
20. **`getByText("2案")` は部分一致で "12案" にもヒットする** — `e2e/specs/full-journey.spec.ts:100`。同じ差分の `:78-80` は role + 完全 name で絞っており、ここだけ緩い。`{ exact: true }` かアンカー付き正規表現が必要。
21. **`npm test` が watch モードのまま公開されている** — `package.json:17` の `"test": "vitest"`。`docker compose run --rm --no-deps app npm test` を素で叩くと TTY 無しで watch に入りハングする。CI では使われていない。
22. **`Dockerfile` の `build` ステージが root 実行かつどこからも参照されていない** — `Dockerfile:24-26`。`USER node` を持つ `development` ではなく `dependencies`（root）から派生し `COPY . .`（chown なし）+ `npm run build` を root で実行する。`grep -n "target:" compose*.yaml` は `development` と `e2e` のみで、本番ビルドは `netlify.toml:2` の Netlify 側。死んだステージが C-3 の被害面だけ増やしている。
23. **`e2e` サービスの `network_mode: host`** — `compose.yaml:172-190`。他サービスは全ポートを `127.0.0.1:` に固定しているが `e2e` だけホストのネットワーク名前空間を共有し `user: "0:0"` で起動する。`playwright.config.ts:6-10` のコメントどおり設計判断ではあるが、隔離度が非対称。

---

## 要確認（未確定 — 実行/仕様確認が必要）

1. **pgTAP の実失敗は静的解析による予測** — C-1 は 2 体が独立に導出し、こちらでも `create policy` 0 件・inventory 未登録を実測確認したが、実際の赤は `docker compose --profile test run --rm db-test` で確定させること。
2. **C-1 の直し方の設計判断** — `rls_inventory.test.sql` に除外条件を足すか、`user_feedback` に `using (false)` の明示 deny ポリシーを置くか。後者ならポリシー期待一覧（`rls_inventory.test.sql:305-344`）にも追記が要る。
3. **`user_feedback` の自由記述保存が仕様上許容されているか** — `docs/archive/superpowers/specs/` にフィードバック機能の仕様記述が見当たらない。I-5 と併せて人間の判断が要る。
4. **`netlify.toml` の `/api/*` ルーティング非対称性** — `netlify.toml:19-26`。`/api/emergency-menus` にだけ `[[redirects]]` があり、その後に SPA catch-all。他 16 本は `config.path` 宣言のみ。Netlify v2 `config.path` と netlify.toml redirect の評価順をリポジトリ内の材料で確認できず、`scripts/smoke-production.mjs` / `verify-production-deploy.mjs` / `preflight-production.mjs` のいずれにも `/api/*` 到達性検査が無い。ローカル E2E は Vite の `server.proxy`（`vite.config.ts:66`）を通るのでこの差を踏めない。→ redirect が不要な重複か、他 16 本にも必要で本番で catch-all に吸われるか、実デプロイでの確認が必要。
5. **`tsconfig.json` の project references と `composite`** — `tsconfig.json:3` は 2 プロジェクトを `references` に持つが、どちらにも `"composite": true` が無い。一般則では参照先に必要。TS 5.9 の緩和挙動なのか、警告付きで通っているだけなのか要確認。
6. **`shared/safety/fingerprint.ts` の `node:crypto` とブラウザ bundle 境界** — `tsconfig.app.json:27-35` は `include` に `shared` を含む。現状 `src/` からの `@shared/safety` 参照は `medical-scope` と型のみの 3 箇所で fingerprint に触れていないが、この境界を lint/テストで固定しているか（`shared/emergency/contracts.test.ts:10` の類似テストは emergency 限定）。
7. **`WelcomePage.runStart` の `finally` によるボタン再活性化** — `welcome-page.tsx:76-78`。成功時 `onStartIdea` 内の `void navigate("/planner")` が解決を待たないため、遷移完了前に `setPendingAction(null)` が走り一瞬ボタンが再び押せる。二重実行まで至るかは実機未確認。
8. **`e2e/fixtures/shopping.ts:44` の無条件 `page.goto("/privacy?returnTo=%2Fplanner")`** — 初回設定分岐内なので同意未取得のはずだが、`completeMinimumOnboarding` が内部で privacy 同意を済ませるケースがあると直後の `getByRole("checkbox", …)` が見つからず落ちる。

---

## 確認して問題が無かった主な点（記録）

- **`planner-page.tsx` / `placeholder-page.tsx` の削除**: 参照残りは 0 件（`src` `e2e` `netlify` `shared` `index.html`）。router 登録・import ともに残存なし。`PlannerPage` 識別子は `planner-route.tsx:171` に再定義済み。削除された 1027 行のカバレッジも I-8 の 1 点を除き全て移行先を確認。
- **`mode=new` でも `activeListId`/`expectedListVersion` を渡す修正**（`menu-result-page.tsx:835-841` / `history-detail-page.tsx:816-822`）: SQL 側 `apply_shopping_draft` の new 分岐が OCC ペアを要求しており、contract も許容する。**修正は正しい**（2 体が独立に確認）。
- **認可**: 全 `/api/*` が `requireUser()`（`auth.getUser(accessToken)` の実検証）を通る。service-role RPC は必ず bearer 由来の `p_user_id` を渡し SQL 側に所有者句がある。body の `userId` は `{ ...body, userId: user.userId }` の順で必ず上書き。IDOR は見つからず。
- **クォータの原子性**: `pg_advisory_xact_lock` + `SELECT … FOR UPDATE` で原子化されており read-modify-write レースなし。失敗終端は未送信予約を確実に解放。
- **`resolveGenerationIntegrityContext()`** がクライアント申告の `targetMode`/`servings`/`targetMemberIds`/`sourceMenuVersion` を全て `.eq("user_id", userId)` で再解決し信用しない。
- **OpenRouter**: 応答は必ず Zod 通過。`:free` 以外・`openrouter/auto` は env パースと `sendMenuGeneration` の二重拒否 + 応答 `modelId` の許可リスト再検証。
- **PII**: ログは `_shared/logger.ts` の許可フィールドのみ。`logger.ts` 以外に `console.*` 直呼びなし。`handleError` も閉じたコード／固定文言のみ。流出経路は見つからず。
- **auth-continuation**: SQL 側で TTL・ワンタイム（claim 時に `encrypted_code = null`）・deposit 上書き禁止を強制。AES-GCM の AAD に `continuationId\norigin` を束縛。
- **SECURITY DEFINER**: 全マイグレーション走査で `set search_path` の付与漏れなし。`private` スキーマは `config.toml` / `PGRST_DB_SCHEMAS` のいずれでも非公開。新規 2 関数も `revoke all from public, anon, authenticated` + `grant execute to service_role` が揃っている。
- **フロント型安全**: `any` / `as unknown as` / `!` 断定・`dangerouslySetInnerHTML` はいずれも 0 件。`VITE_` は公開値のみで `public-env.ts` が Zod 検証。React Router 8 Data Mode の import 分離も遵守（`RouterProvider` は `main.tsx:3` の `react-router/dom` のみ）。
- **タッチ領域の実装側**: `.primary-button` 等はいずれも `min-height: 44px`（`styles.css:1513` の 40px は 720px 以上専用の装飾バー）。※検査側の穴は I-15。
- **`DeleteAccountDialog`**: ネイティブ `<dialog>` + `showModal()` でフォーカストラップ、確認フレーズ厳密一致、`onCancel` の Esc 抑止まで揃っている。
- **`shared/time/jst.ts`**: 日本に DST が無く、`getNextJstMidnight` の境界も正しい。
- **`compose.yaml` の `command` 追加**: `Dockerfile:16` の `CMD` とバイト一致。
- **`README.md` の変更**: mailpit ポート、ログイン文言、参照ドキュメントの存在、Realtime 利用、全体クォータ 45 のいずれも実装・roadmap と一致。
