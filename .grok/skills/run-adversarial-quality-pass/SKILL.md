---
name: run-adversarial-quality-pass
description: >
  コードベース全体を機能単位および E2E フロー単位で敵対的にレビューし、
  クリーンコンテキストで擬陽性を除外したうえで Minor 以上を修正・コミットし、
  指摘ゼロまで繰り返してから run-ci-local で完了確認する品質パス。
  /run-adversarial-quality-pass 実行時、または「敵対的レビュー」「品質パス」
  「機能単位レビュー」「E2E まで徹底レビュー」「Minor 以上ゼロまで」
  「adversarial quality pass」と言われたときに使う。
---

# run-adversarial-quality-pass

コードベース全体に対し、**機能単位 + E2E フロー単位**で敵対的レビュー→独立再検証（finding-adjudicator）→修正→コミット→再レビューを繰り返し、**完了ゲートをすべて満たした**うえで **`run-ci-local` がグリーン**かつ **working tree が clean** になるまで進めるオーケストレーション skill。

あなた（オーケストレーター）は計画・委譲・最終判定・報告を担当する。**発見・真偽判定・修正・再レビュー・CI 実行を同一コンテキストで兼任しない。**

## 目標

1. 潜在バグ、リグレッション、仕様想定バグ、データ不整合、セキュリティ問題を洗い出す
2. 指摘をクリーンコンテキストで再検証し、擬陽性を除外する
3. 擬陽性でない **Minor 以上**を修正し、適切にコミットする
4. 完了ゲート（成立 Minor+ ゼロ、Critical/Important の未確定・不正棄却・deferred なし等）を満たすまで繰り返す
5. E2E を含む `run-ci-local` がオールグリーンであることを確認して完了する

## 正本と制約

- **実装が仕様の正**: `src/`、`netlify/functions/`、`shared/`、`supabase/migrations/`、テスト、`e2e/`
- 運用ドキュメント索引: `docs/README.md`（`docs/archive/` は既定で読まない）
- 履歴の設計/計画が必要な考古学のみ: `docs/archive/superpowers/specs|plans`（実装と矛盾したら実装を正）
- プロセス: `CLAUDE.md`、`AGENTS.md`、`SubAgents.md`
- **ロック契約を再解釈・緩和しない。** origin、quota、RLS、TTL、モデル allowlist 等に触れる変更は先にユーザー報告
- Node/npm は Docker 経由（`docker compose run --rm --no-deps app …`）。`db:test` / `e2e` はホストの `docker compose` / `./scripts/run-e2e.sh`
- コマンドを `&&` / `;` で連結しない（1 コマンド = 1 ツール呼び出し）。assert ブロック等、既存 skill/workflow がまとめる例外のみ可
- **禁止**: `git push`、PR 作成、本番/staging デプロイ、`--no-verify`、force push、破壊的 git（ユーザー明示なし）
- 重大セキュリティ問題・破壊的変更が必要な場合は **修正前にユーザーへ報告**して停止判断を仰ぐ
- **テストの「安定化」**: 同一コードで間欠的にだけ落ちる場合に限る。アサーション削除、期待値の緩和、RLS/quota/origin/モデル allowlist の弱体化で「通す」ことは禁止。ロック契約に触れるテスト失敗は修正前にユーザー報告
- 過度に大きな変更は避け、1 論理変更 = 1 コミットで段階的に進める
- 進捗が停滞したら計画を見直し、ユーザーへ報告する

## 役割名（SubAgents と混同しない）

この skill 内の名前を使う。**`SubAgents.md` の Task Verifier（Docker コマンド再実行役）と「verifier」を同一視しない。**

| この skill の役割       | 編集                                                                            | 責任                                   | SubAgents / 誤マップ禁止                               |
| ----------------------- | ------------------------------------------------------------------------------- | -------------------------------------- | ------------------------------------------------------ |
| **reviewer**            | 不可                                                                            | 候補発見のみ                           | —                                                      |
| **finding-adjudicator** | 不可                                                                            | 候補の真偽判定（成立/棄却/未確定）のみ | **SubAgents の Verifier / fast-worker にマップしない** |
| **fixer**               | 可                                                                              | 成立指摘の最小修正のみ                 | implementer 相当                                       |
| **re-reviewer**         | 不可                                                                            | 修正後の候補再発見 + クロージャ確認    | reviewer と同型。真偽判定はしない                      |
| **ci-runner**           | 原則不可（`run-ci-local` の修正サイクル中のみコード編集可、**コミットは不可**） | フル `run-ci-local` 実行と step 証跡   | コマンド実行役。finding-adjudicator と兼ねない         |

description プレフィックス例: `[reviewer]` / `[finding-adjudicator]` / `[fixer]` / `[re-reviewer]` / `[ci-runner]`。

## 重大度

| レベル        | 定義                                                                                    | 扱い                                |
| ------------- | --------------------------------------------------------------------------------------- | ----------------------------------- |
| **Critical**  | セキュリティ侵害、データ損失/漏洩、認可バイパス、金銭・quota の不正、安全性保証の誤表示 | 即修正。破壊的/仕様変更なら先に報告 |
| **Important** | 実害のあるバグ、リグレッション、仕様乖離、データ不整合、失敗時の危険なフォールスセーフ  | 必ず修正                            |
| **Minor**     | 実害は限定的だが再現可能・契約違反・エッジの誤り                                        | 必ず修正（完了条件に含む）          |
| **Nit**       | スタイル好み、任意の改善、根拠の薄い提案                                                | 修正しない。記録のみ                |

- 修正キューに載せるのは **finding-adjudicator が「成立」と判定した Critical / Important / Minor** のみ
- Nit は完了をブロックしない
- **重大度の一方的ダウングレード**（例: Critical → Nit）は、failure path を具体的に反証する文が verdict に無い限り禁止

## 完了を阻むオープン事項（ゲーム防止）

次のいずれかが残っている間は **完了宣言禁止**（unit `done` も run 完了も不可。ユーザーが明示 waive した項目のみ例外）:

1. **成立** Critical / Important / Minor が 1 件以上
2. **未確定** Critical または Important（追加証拠を取るかユーザー判断待ち）
3. **棄却** された Critical / Important で、**独立 2 名相当の確認が無い**もの
   - 最低: 別の finding-adjudicator（または親以外の第二 read-only）が棄却理由を再確認し `unit-<slug>-verdict.md` に `reject-confirmed-by:` を残す
4. **`In scope: no` の Critical / Important** が `deferred-criticals.md` に未割当・未 waive のまま
5. re-review の **closure checklist** で prior established finding が `closed` でない
6. `git status --short` が空でない（ユーザーがコミットスキップを明示した場合を除く）
7. `ci-run-log.md` がフル成功を示していない

「成立件数が 0」だけでは完了しない。

## 成果物パス（run 固定）

起動時に run id を決める:

```bash
python3 -c "import uuid; print(uuid.uuid4().hex[:8])"
```

台帳ディレクトリ: `.superpowers/sdd/adversarial-quality-pass-<RUN_ID>/`  
（`.gitignore` の `.superpowers/` により **gitignored**。コミットしない。無ければ作成）

| ファイル                             | 内容                                                                                       |
| ------------------------------------ | ------------------------------------------------------------------------------------------ |
| `plan.md`                            | 単位・優先順位・対象パス・関連設計・E2E spec                                               |
| `ledger.md`                          | 各単位の状態（pending / reviewing / adjudicating / fixing / rereviewing / done / blocked） |
| `unit-<slug>-candidates.md`          | reviewer の候補（親は **severity・重大度を書き換えない**）                                 |
| `unit-<slug>-verdict.md`             | finding-adjudicator の成立/棄却/未確定                                                     |
| `unit-<slug>-fix-report.md`          | fixer の実施内容（Important+ は design 節の引用必須）                                      |
| `unit-<slug>-rereview.md`            | re-reviewer: 新規候補 + closure checklist                                                  |
| `unit-<slug>-rereview-candidates.md` | re-review が出した **新規候補**（未判定。2b へ）                                           |
| `deferred-criticals.md`              | 範囲外とされた Critical/Important の追跡台帳                                               |
| `cycle-log.md`                       | 周回ログ（短い時系列、予算カウンタ）                                                       |
| `ci-run-log.md`                      | `run-ci-local` 各ステップ名 + 終了コード                                                   |
| `final-report.md`                    | 最終報告ドラフト                                                                           |

パスは run 中に再生成せず固定する。サブエージェントには **ファイルパス** を渡し、巨大な raw diff/log を親コンテキストへ貼らない。

**親の禁止**: `*-candidates.md` の本文・Severity・In scope を「正規化」名目で改変しない。重複排除が必要なら **別ファイル** `unit-<slug>-dispatch-notes.md` に追記するだけにする。candidates の内容ハッシュまたは行数を verdict 先頭に記録させる。

## 予算（グローバル上限）

`cycle-log.md` でカウントする。いずれかに達したら **偽のゼロ収束を装わず** ユーザーへエスカレーション（途中版 `final-report.md`）:

| 上限                        | 既定値          | 意味                                                                            |
| --------------------------- | --------------- | ------------------------------------------------------------------------------- |
| 全 unit スイープ            | **2**           | Phase 2 を全 unit なめる回数（初回 + 1 再スイープ）。以降は残件を報告           |
| unit 内 fix↔adjudicate 往復 | **5** / unit    | 同一 unit での 2b→2c→2e→2b サイクル                                             |
| 同一 fingerprint 修正失敗   | **3**           | path + failure-path 要約の fingerprint。3 回失敗で自動棄却せず **ユーザー報告** |
| fix コミット総数            | **40** / run    | 超えたら残件付きで停止                                                          |
| 依存 reopen 回数            | **6** / run     | contracts/auth/safety/quota 由来の他 unit 再オープン                            |
| `run-ci-local` 修正サイクル | skill 既定（3） | 超えれば打ち切り報告                                                            |

「同一指摘」の判定は文言一致ではなく **fingerprint**（主な `File` + failure path の正規化キー）で行う。リネームして周回を逃れることを禁止。

## 全体フロー

```
0. 前提確認（WIP / 他 run / 独立 subagent 可否）
1. 分解・設計索引・優先順位 → plan.md（必須 unit の削除はユーザー明示 waive のみ）
2. for each unit (優先順):
     a. 敵対的レビュー (fresh reviewer) → candidates.md
     b. 独立再検証 (fresh finding-adjudicator) → verdict.md   ← 擬陽性除外。省略禁止
     c. 成立 Minor+ を修正 (fresh fixer) + 関連テスト
     d. コミット（論理単位）※ run-ci-local はコミットしない
     e. fresh re-review → rereview.md（closure）+ 新規は rereview-candidates.md
     f. 新規候補があれば → 必ず b（adjudicate）→ 成立分のみ c
        ※ re-review から c へ直結しない
3. 予算内で全 unit の完了ゲートを満たすまで 2 を周回
4. working tree clean を確認後、クリーンコンテキストで run-ci-local（ci-runner）
5. CI 失敗:
     - ci-runner は修正してよいがコミットしない
     - 親が diff をレビューし Phase 2（b→c→d→e→f）でコミット + 再審査
     - ci-run-log を更新して 4 へ
6. 完了ゲート + clean tree + ci-run-log 成功 → 最終報告
```

**禁止ショートカット**: re-review → fix、CI 緑 → 未コミットのまま完了、成立ゼロのみ見て Critical 未確定を無視。

---

## Phase 0 — 前提

1. リポジトリルート（`compose.yaml` があること）
2. `git status --short` と `git log --oneline -15`
3. 他の `adversarial-quality-pass-*` 台帳に非 terminal 状態が無いか確認。並行 run や所有不明 dirty tree なら停止
4. `.superpowers/sdd/progress.md` 等で **進行中 Plan Task** がある場合はユーザーに優先順位を確認（Task 完了前の横断コミットは衝突し得る）
5. 設計・機能マップ入口:
   - `src/features/*`
   - `netlify/functions/*` + `_shared/*`
   - `shared/contracts` / `shared/safety`
   - `supabase/migrations`
   - `e2e/specs/*`
6. 台帳ディレクトリ作成、`cycle-log.md` に開始 HEAD と予算カウンタ初期値を記録
7. **独立サブエージェントの可否**を判定:
   - 技術的 read-only または役割分離できる subagent が使える → 通常モード
   - **使えない** → 敵対的分離を偽装せず **停止**するか、ユーザーが明示した **degraded モード**（完了宣言不可・最終報告に `degraded: true`）のみ。通常の「完了」は degraded では出さない

未コミット変更が **この skill 以外の WIP** の可能性がある場合は止め、ユーザー判断を仰ぐ。

---

## Phase 1 — 分解とレビュー計画

### 設計索引（必須）

1. **まず実装と契約**（`src/features/*`、`netlify/functions/*`、`shared/contracts`、`shared/safety`）を unit にマップする
2. 運用 docs（`docs/README.md` の表）を必要なら読む。`docs/archive/` は実装と過去決定の突き合わせが必要な unit だけに限定
3. コードがあるのに契約/テストが薄い unit は、その旨を `plan.md` に明示し、関連テスト・E2E を最低限紐づける

### 既定の機能単位（Kondate）

存在・責務に応じて統合・分割してよい。ただし次は **必須セット**（ユーザーが文書で明示 waive しない限り plan から削除・後回し不可）:

- `auth-session`
- `household-safety`
- `generation-ai`
- `shared-contracts-infra`

| 優先 | slug                     | 主な対象                                                               | 関連設計 / E2E の例                               |
| ---: | ------------------------ | ---------------------------------------------------------------------- | ------------------------------------------------- |
|    1 | `auth-session`           | `src/features/auth/**`, auth-continuation Functions, session/callback  | auth-callback-security, auth-recovery, oauth-mock |
|    2 | `household-safety`       | household, allergen, current-safety, RLS 周辺                          | onboarding, settings, history-safety-change       |
|    3 | `generation-ai`          | generation feature, generate-*, OpenRouter, quota, repair, materialize | generation-recovery-results, full-journey         |
|    4 | `planner-guided`         | planner wizard, draft, route limits                                    | full-journey, menu-domain-pantry                  |
|    5 | `history-revalidation`   | history, revalidate, regeneration                                      | history-*, history-safety-change                  |
|    6 | `shopping`               | shopping feature + shopping-list Functions                             | shopping-list, shopping-list-races                |
|    7 | `billing-entitlement`    | billing feature + Stripe Functions                                     | billing-plus + paid-plan design                   |
|    8 | `pantry-emergency-flyer` | pantry, emergency, flyer                                               | menu-domain-pantry, emergency design              |
|    9 | `account-privacy`        | account, privacy, delete-account, feedback                             | account-deletion, privacy                         |
|   10 | `landing-welcome-shell`  | landing, welcome, app shell/router, public-env                         | foundation, mobile-accessibility                  |
|   11 | `shared-contracts-infra` | `shared/**`, logger, http, env, maintenance                            | tooling / privacy log asserts                     |
|   12 | `e2e-crosscutting`       | 複数 unit を跨ぐ E2E とレース/回復シナリオ                             | full-journey 他、残差                             |

優先の原則:

1. **セキュリティ・認可・安全性**（auth, household safety, RLS）
2. **金銭・quota・AI 境界**（billing, generation）
3. **データ整合・競合**（shopping races, generation recovery）
4. その他機能 → UI/コピー → 横断 E2E

各 unit の `plan.md` エントリに必ず書く:

- 対象パス（include）
- 読み取り専用の依存（contracts, design 節）
- 除外（生成物・ロック export の再定義禁止など）
- 重点脅威（下記チェックリストから）
- 関連テスト（focused vitest）
- **関連 E2E spec パス**（あれば）。plan に載せた E2E は unit `done` 前に **少なくとも 1 回**実行する（最終 CI への全先送り禁止）
- 関連設計ドキュメントのパス

### カバレッジ監査

- すべての `src/features/*` トップレベルがいずれかの unit に含まれること
- 主要な `netlify/functions/*.ts` がいずれかに含まれること
- すべての `e2e/specs/*.spec.ts` が少なくとも 1 unit の plan に現れること（`e2e-crosscutting` でも可）
- 孤児があれば plan に追加するか、ユーザー waive を記録

計画の短い一覧をユーザーに見せる。**必須セットの削除・後回しはユーザーの明示的同意があるときだけ。** 同意なく「UI だけ」等へ縮小して完了してはならない。

---

## Phase 2 — 単位ごとのサイクル

**1 unit = 1 レビューサイクル。** 同時に複数 fixer を走らせない（single-writer）。  
read-only の reviewer / finding-adjudicator は、対象が重複せず書き込みも無いなら並列可。  
技術的 read-only を確認できない場合は **全役割を直列**にし、各 read-only 役の直後に `git status --short` が汚れていないことを確認する。

### 2a. 敵対的レビュー（fresh reviewer）

- `description`: `[reviewer] unit <slug>`
- `capability_mode`: `read-only`（指定できる場合。不可なら直列 + dirty チェック）
- プロンプトには **この unit の対象パス・設計パス・重点脅威・成果物パス** だけを渡す
- **渡してはいけないもの**: 親の「直したつもり」履歴、他 unit の長い要約、期待する結論、`don't flag X`

Reviewer 指示の要点（プロンプトに含める）:

```
あなたは敵対的 reviewer。コードを変更しない。真偽の最終判定もしない（候補のみ）。
各候補に一意 ID（C1, C2, …）を振り、次を必須とする:
- ID, Severity: Critical | Important | Minor | Nit
- File: path:line（可能な範囲）
- Failure path: 具体的な失敗経路または反例
- Evidence: 根拠となるコード/設計箇所
- How to confirm: 再現または確認手順
- In scope: yes/no
  - no の場合でも Critical/Important は必ず書き、理由を書く
    （親が deferred-criticals.md に転記する。黙殺禁止）

重点:
1. 潜在バグ・エッジケース（null、レース、TTL、再送、部分失敗）
2. リグレッションリスク（呼び出し側契約、idempotency、状態機械）
3. 仕様と実装の乖離（実装・契約・テストを正とする。archive design は参考のみ）
4. データ不整合（RLS、所有権、snapshot vs current safety）
5. セキュリティ（認証・認可、インジェクション、秘密、IDOR、continuation）

Kondate 特有:
- アレルギー/安全性は "safe" 保証を出さない
- current household safety が historical snapshot に勝つ
- 機密をログ/永続化しない
- OpenRouter は Functions のみ。本番 allowlist に :free / openrouter/auto を入れない
- ロック interface を再定義しない

結果を unit-<slug>-candidates.md にだけ書く。
```

**空候補**: 候補が 0 件（または Nit のみ）でも `candidates.md` に「Minor+ 候補なし」と 1 行書き、2b で trivial verdict を残す。

**In scope: no の Critical/Important**: 親が即座に `deferred-criticals.md` へ転記し、別 unit へ割当 or ユーザー waive まで run 完了をブロックする。

### 2b. 独立再検証（fresh finding-adjudicator）— 省略禁止

**別の** read-only サブエージェント。reviewer の推論過程や「成立してほしい」圧力を渡さない。  
**SubAgents の Verifier（コマンドランナー）にこの役割を割り当てない。**

- `description`: `[finding-adjudicator] unit <slug>`
- 渡すもの: 対象パス、設計パス、`unit-<slug>-candidates.md`（または rereview-candidates）、verdict 出力パス
- 各候補を **成立 / 棄却 / 未確定** に分類
- 成立条件: 静的トレース・最小再現・既存テスト・設計の明文のいずれかで根拠が取れる
- 棄却時は **明確な理由** + failure path の反証。Critical/Important の棄却は後述の二重確認対象
- 未確定は推測で成立にしない。必要な追加証拠を書く
- **未確定 Critical / Important がある unit は `done` にできない**（`blocked` またはユーザー判断待ち）
- Nit へのダウングレードは failure path 反証付きのみ

親は **成立した Minor 以上** だけを修正キューに載せる。Nit と棄却は修正しない（棄却 Critical/Important は二重確認と最終報告義務あり）。

**候補 0 件**: verdict に `no Minor+ candidates` と書き、修正スキップ。re-review はコード変更が無い場合スキップ可（その旨を ledger に記録）。

### 2c. 修正（fixer）

成立指摘が 0 かつ完了ゲート（unit 分）を満たせば 2e へ（変更が無ければ 2e スキップ可）。

ある場合:

1. SuperPowers 系を活用:
   - `superpowers:systematic-debugging`
   - `superpowers:test-driven-development`（可能なら失敗テストを先に）
   - `superpowers:verification-before-completion`
2. **原則 fresh fixer subagent**。親の直接修正は **既に 2b で成立した Minor のみ**かつ 1 ファイル程度の機械的修正に限る。**Critical / Important の親 fix 禁止**
3. 最小差分。ロック契約・設計緩和・eslint-disable・アサーション削除で「通すだけ」は禁止
4. Important+ の `fix-report` に **design パス + 節** を引用。quota/RLS/origin/models 変更は実装前にユーザー確認
5. 関連 focused テスト:

```bash
docker compose run --rm --no-deps app npx vitest run <related-files>
docker compose run --rm --no-deps app npm run typecheck
docker compose run --rm --no-deps app npm run lint
docker compose run --rm --no-deps app npm run format:check
```

- plan に載せた **unit 関連 E2E** がある場合、unit `done` 前に実行（環境変数は `run-ci-local` の E2E ステップに合わせる）
- `supabase/migrations/**` を触ったら、db-test 前にプロジェクト手順で migrate/apply（`docker compose run --rm migrate` 等。CLAUDE/AGENTS に従う）
- 巨大ログはファイルへリダイレクトして要約のみ読む

### 2d. コミット

- 1 論理変更につき 1 コミット
- Conventional Commits + **日本語**（`AGENTS.md`）
- プレフィックス: `fix:` / `security:` / `test:` / 必要な最小の `refactor:`
- コミット前:
  - `git diff --check`
  - `git status --short`
  - ステージ内容に `.env`、鍵、`*.pem`、秘密らしき文字列が無いこと
  - 可能なら `git diff --cached` を目視
- ユーザーがコミット不要と明示した場合のみスキップ（その場合も完了時は dirty を最終報告に明記し、通常完了とはしない）

**`run-ci-local` / ci-runner はコミットしない。** CI 由来の修正は親が 2d でコミットする。

### 2e. 修正後 re-review（fresh re-reviewer）

コード変更が無い unit はスキップ可。

- `description`: `[re-reviewer] unit <slug>`
- 渡すもの:
  - 対象パス、設計パス
  - 修正の file list / commit range（パス参照）
  - **prior established finding の ID リストと 1 行要約のみ**（fixer の自己評価・「直ったはず」は渡さない）
  - 出力: `unit-<slug>-rereview.md` および新規候補があれば `unit-<slug>-rereview-candidates.md`
- 必須出力:
  1. **Closure checklist**: 各 prior ID について `closed` / `still-open` / `uncertain`（根拠 1 行）。`still-open` / `uncertain` は unit を `done` にできない
  2. **新規候補**は candidates 形式（未判定）。「成立」と書いてはならない
- 新規候補がある → **必ず 2b（finding-adjudicator）** → 成立分のみ 2c。**2c 直結禁止**

### 2f. 単位完了条件（すべて）

- finding-adjudicator 上の **成立** Minor+ が 0
- **未確定** Critical / Important が 0（またはユーザー waive 記録済み）
- Critical / Important の棄却は二重確認済み
- re-review closure がすべて `closed`（変更が無かった unit は N/A）
- 新規 rereview-candidates が空、またはすべて 2b 済みで成立 0
- deferred-criticals にこの unit 起因の未割当 Critical/Important が無い
- plan 記載の focused + 関連 E2E がパス
- 関連変更がコミット済み（またはユーザー skip）
- `ledger.md` を `done` に更新

---

## Phase 3 — 全体周回

1. `ledger.md` と deferred / 未確定を集計
2. 修正が他 unit に影響しうる場合（contracts、auth、safety、quota）は依存 unit を再オープン（予算の reopen 上限内）
3. fingerprint 同一の修正失敗が 3 回、または予算上限 → **ユーザー報告**（自動棄却でゼロに見せない）
4. 全 unit `done` かつ run レベルの完了阻害事項が 0 なら Phase 4

停滞報告: 対象 unit、fingerprint、試した修正、阻害理由、選択肢。

---

## Phase 4 — 最終検証（run-ci-local）

Phase 4 開始条件:

- Phase 3 の集計がグリーン相当
- **`git status --short` が空**（ユーザー明示の dirty 許容がある場合を除く）

### クリーンコンテキスト（必須定義）

次を満たすこと:

1. `.grok/skills/run-ci-local/SKILL.md` を **この時点で read_file し直す**
2. **fresh な ci-runner サブエージェント**に実行を委譲する（必須。親の直接実行は、subagent が技術的に使えない degraded 時のみ）
3. ci-runner へのプロンプトに含めてよいもの: リポジトリルート、`run-ci-local` の skill パス、`ci-run-log.md` の書き先  
   **含めてはいけないもの**: 各 unit の指摘要約、「もう直した」、候補の成立/棄却経緯
4. `ci-run-log.md` に **run-ci-local の各ローカルステップ名と終了コード**を記録。欠落ステップがある場合は成功とみなさない

### ネスト時のコミット方針（厳守）

| 主体                       | コード編集                | コミット       |
| -------------------------- | ------------------------- | -------------- |
| ci-runner / `run-ci-local` | その skill が許す範囲で可 | **しない**     |
| 親（quality-pass）         | Phase 2 経由で可          | **する**（2d） |

CI 失敗時:

1. ci-runner が診断・修正（run-ci-local の打ち切り条件に従う）
2. 親が `git status` / diff を確認。ロック契約緩和・テスト骨抜きなら破棄してユーザー報告
3. 正当な修正は **影響 unit を Phase 2 に戻す**（最低 2b が必要な新規リスクがあればフルサイクル。単純なら fix-report + 2d + 関連 unit の re-review）
4. **コミット後**に tree clean を確認してから `run-ci-local` を再実行
5. dirty のまま「CI グリーン」を完了にしない

E2E を `run-ci-local` から切り離して「もう十分」としない。

---

## Phase 5 — 最終報告

`final-report.md` を書き、ユーザーへ同じ内容を要約する。

### 必須セクション

1. **完了判定** — 完了ゲート一覧の yes/no / `run-ci-local` / HEAD / tree clean / degraded 有無
2. **レビュー範囲** — unit 一覧、必須セット、ユーザー waive
3. **主要な修正** — コミットハッシュと 1 行（重要度順）
4. **棄却した候補** — 件数・代表・Critical/Important 棄却の二重確認状況・verdict パス
5. **deferred-criticals** — 割当・waive・残件
6. **実行した検証** — focused / unit E2E / `ci-run-log.md` 要約
7. **未解決・残余リスク** — Nit、ユーザー waive 済み項目
8. **成果物パス** — 台帳ディレクトリ
9. **予算消費** — スイープ数、コミット数、reopen 数

---

## サブエージェント分離ルール（厳守）

- 同一 subagent に発見・真偽判定・修正・合格判定を兼任させない
- finding-adjudicator を SubAgents Verifier / 安価コマンドランナー専用 agent に割り当てない
- 並列は read-only かつ対象非重複に限る。共有パス（例: `shared/contracts`）を含む unit は同時レビューしない
- Implementer/fixer 起動中に、技術的 read-only 未確認の読み取り役を同時走らせない
- custom agent を選べる surface では役割に合わせて選ぶ。選べない場合は generic + 役割制約をプロンプトで固定し、最終報告に一度だけ書く
- **独立 subagent が全く使えない**場合は Phase 0 の degraded / 停止ルールに従う（通常完了不可）

---

## 敵対的チェックリスト（レビュー時のレンズ）

ユニットに応じて該当項目を reviewer プロンプトへコピーする。

**認証・セッション**

- continuation の TTL、単回使用、state 不一致、cancel 経路
- コールバック後の URL サニタイズ、トークン/PII のログ
- 保護ルートのバイパス、期限切れセッションの UX とデータ残留

**認可・RLS・所有権**

- user_id の取り違え、IDOR
- service role の露出範囲
- 共有カタログの write 禁止

**安全性・アレルギー**

- current safety 優先
- 「安全です」保証コピーの混入
- 再検証漏れ、stale メニューでの買い物/再生成

**生成・AI・quota**

- idempotency key 再送、部分障害回復
- budget / timeout / モデル allowlist
- プロンプト・生出力の永続化/ログ
- quota の日次境界（JST）、競合更新

**課金**

- webhook 署名、idempotency、entitlement の elevation/downgrade
- Free/Plus ゲートのクライアント spoof

**買い物リスト・履歴**

- レース、replay、household 変更後の fail-closed
- reconcile の二重適用

**一般**

- パース境界での Zod、any/unchecked cast
- 320px・44px タッチ、日本語コピーの事故（論理バグに限る）
- 生成ファイルの手編集、秘密のコミット

---

## 進捗表示（ユーザー向け）

- `plan: N units ordered (mandatory set intact|waived: …)`
- `unit <slug>: review → adjudicate → fix (k) → commit → re-review → adjudicate(new) → done|blocked`
- `cycle: open established Minor+ = X; open Important+ unresolved = Y; deferred = Z; budget …`
- `final: run-ci-local … tree=clean|dirty`
- 停滞時: `blocked: …` + 判断依頼

---

## 打ち切り・エスカレーション

次ではユーザーに渡して停止（**偽の完了を出さない**）:

- Critical で破壊的変更または仕様変更が必要
- ロック契約と成立指摘が衝突
- 同一 fingerprint が 3 回修正失敗
- グローバル予算超過
- 検証環境が使えない（Docker 等）
- WIP 混在・他 run 並行・所有不明 dirty tree
- 独立 subagent 不可でユーザーが degraded を承認しない
- Critical/Important 未確定・未確認棄却・deferred がユーザー判断待ち
- `run-ci-local` が修正サイクル上限で打ち切り

打ち切り時も `final-report.md` 相当（途中版）と再開手順（台帳パス、次 unit、残ゲート）を書く。  
「レビューは完了・CI のみ未」を成功扱いしない。

---

## 完了条件（すべて必須）

- [ ] 計画した全 unit が `done`（必須セット削除はユーザー waive 記録済み）
- [ ] **成立** Critical / Important / Minor が 0
- [ ] **未確定** Critical / Important が 0（または明示 waive）
- [ ] Critical / Important の棄却が二重確認済みで final-report に載る
- [ ] `deferred-criticals.md` の Critical/Important が割当済み or waive
- [ ] 各変更 unit の re-review **closure** がすべて `closed`
- [ ] 棄却・未確定・Nit の記録が台帳に残っている
- [ ] 成立指摘の修正がコミット済み（スキップ合意時はその旨と dirty 方針）
- [ ] **`git status --short` が空**（スキップ合意時を除く）
- [ ] `ci-run-log.md` が `run-ci-local` 全ステップ成功を示す（欠落なし）
- [ ] 通常モードである（`degraded: true` なら完了宣言不可）
- [ ] 最終報告をユーザーへ出力済み

どれか欠ける場合は完了と宣言しない。
