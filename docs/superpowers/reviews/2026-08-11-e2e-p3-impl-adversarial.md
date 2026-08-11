# 敵対的レビュー: Phase 3 E2E 短縮 実装

**対象 range:** `9ebfe82..29d33f1`（Task 9 base → Phase 3 close HEAD）  
**照合:** live `/home/dev/projects/kondate`（read-only on product/e2e; 本ファイルのみ書込）  
**Spec:** `docs/superpowers/specs/2026-08-11-e2e-runtime-reduction-design.md` §7, §9  
**補助証拠:** `.superpowers/sdd/e2e-p3-task{9,10-11,12,13}-report.md` / 各 task review  
**姿勢:** 著者は green CI を欲する。quota 破壊・SKIP_RECREATE 汚染・auth 経路空洞化・compose 漏洩・dual-pass 二重計上・Mailpit 死経路・tooling false green を優先して突く。

---

## Summary

Phase 3 の本線実装（E2E 専用 `GLOBAL_DAILY_AI_LIMIT=500`、per-test global truncate 0、`workers: 2` + `fullyParallel: true`、生成/race/reused の file-level serial、ephemeral `generateLink`、Mailpit 成功 path 残存、`CI=true`×`SKIP_RECREATE=1` exit 2、CI restore 省略、通常 compose 20 / preflight 不変）は **現行ツリーでは意図どおり動く**。攻撃チェックリストの「workers×test ごと truncate で枠破壊」「SKIP_RECREATE が GHA で有効」「compose.e2e 500 が preflight/通常 compose に混入」は **現状コードでは反証**できる。

一方、**C2 fail-closed の半分（per-test truncate 0）は CI ゲートに載っておらず**、workers 定数の tooling は **`workers: 20` を許す弱い正規表現**のままである。最終 close SHA での **同一 SHA 2 連続 full green は未実施**で、Task 13 の 1 回 full は retry 消化あり。generateLink 既定は製品 magic-link callback 成功を踏まず、Mailpit ≥1 の **機械ガードが無い**。

**Critical な現行破壊（枠 corruption / CI での SKIP 誤許可 / 製品 limit 改変）は見つからなかった。**  
判定は **PASS_WITH_RESIDUALS**（ドリフト耐性とゲート閉包が Spec 文言より弱い）。

---

## Attack scenarios (validated / refuted)

| # | 攻撃 | 判定 | 根拠 |
| --- | --- | --- | --- |
| 1 | workers=2 のまま test/fixture が global truncate → 他 worker の枠破壊 | **現行は反証 / 将来ゲート弱い** | `e2e/**` に `ensureAiQuotaForGeneration` / `resetGlobalAiQuotaForE2e` / `truncate private.ai_global_daily_usage` **0**（grep）。許可は `scripts/reset-e2e-ai-quota.sh` + `run-e2e.sh` の suite 開始・mobile→desktop 境界のみ。**ただし** `tests/tooling/e2e-ai-quota-parallel.test.mjs` は **ci.sh / ci.yml の Local-safe Node 列挙に未掲載**（A1）。 |
| 2 | tooling が `workers: 20` を定数 2 と誤認して green | **成立（false green 穴）** | `/workers:\s*2/u` と `/workers: 2/u` は `workers: 20` にも match。`workers:\s*1\b` 禁止だけでは 20 を拒否しない（A2）。現行 config は literal `workers: 2`。 |
| 3 | `KONDATE_E2E_SKIP_RECREATE=1` + `CI=true` で dirty full が走る | **反証（GHA 本線）** | `run-e2e.sh` L22–25: 同時指定で lock 前に exit 2。`local-development-scripts` が Docker 0 回 + code 2 を固定。GHA `env.CI: "true"`。 |
| 4 | SKIP_RECREATE がドキュメント/値の取り違えで CI に滑る | **低リスク residual** | 許可は厳密に `SKIP=1` かつ `CI=true` のみ拒否。`CI=1` / `SKIP=true` は拒否もスキップもされない（通常 recreate 維持）。`ci.sh` は **CI を export しない**ため、ローカル `ci.sh` 経路では restore 省略が効かず（安全側・壁時計だけ冗長）。 |
| 5 | compose.e2e の 500 / mock OpenRouter が通常 local compose や preflight に漏れる | **反証（本線）** | `compose.yaml` は `GLOBAL_DAILY_AI_LIMIT: "20"`。`compose.e2e.yaml` のみ `"500"` + コメント。`compose.test.mjs` が 20/500 分割を固定。preflight は env 検証で compose.e2e を読まない。ローカル cleanup は `compose.yaml` のみで auth/app force-recreate 復元。 |
| 6 | generateLink の localStorage 書込が session 手注入 / ユーザ混線 | **§7.5 禁止形は反証 / 製品 path 乖離は residual** | `addInitScript` 無し。Admin `generateLink` → 実 `action_link` open → GoTrue verify の実トークン → `/auth/v1/user` 検証 → 製品 key `kondate.auth.supabase` へ書込。service role は page 非経由。`authEmail` は title+browser+workerIndex+timestamp。失敗時 Mailpit フォールバック無し。製品は `detectSessionInUrl: false` のため storage bridge は必要。**製品 callback（token_hash）は踏まない**（A3）。 |
| 7 | Mailpit 成功 path が generateLink 既定化で死ぬ | **現行は反証 / ガード無し** | `auth.setup.ts` + `auth-recovery`（same-browser は `@smoke`）が `requestMagicLinkAndReadUrl`。full は setup 必須。smoke は setup 省略だが recovery `@smoke` が Mailpit を踏む。tooling は Mailpit 残存を固定しない（A4）。 |
| 8 | shell 二段 mobile→desktop × fullyParallel で同一 test 二重計上 / 枠二重消費の誤解 | **設計意図（壁時計 residual）** | full は **別 Playwright プロセス**で mobile 全件 → quota reset → desktop 全件。`fullyParallel` は project 内並列のみ。viewport 契約上の 2 段であり「1 回実行を 2 回数えるバグ」ではない。壁時計は 2 段+再create が残る（≤10 分 stretch 未達の主因の一部）。 |
| 9 | serial 漏れで race / reused storageState が並列汚染 | **主要候補は反証 / 非 serial 生成は許容 residual** | file-level `describe.configure({ mode: "serial" })`: races, billing-plus (reused), full-journey, generation-recovery, history-regeneration, history-safety-change。`shopping-list` / `mobile-accessibility` は ephemeral ユーザ分離。共有状態汚染より **F7 行ロック + 生成密集** が flaky 源（A5）。 |
| 10 | 最終 SHA で flaky を retry で隠し「2 連続 green」と称する | **部分成立** | Task 11 作業 tree で full×2 EXIT 0（報告）。Task 12/13 は各 full×1。Task 13: mobile 1 flaky + desktop 2 flaky（retry 後 green）。§7.8「同一 SHA 2 連続」を close SHA で満たしていない（A5）。 |
| 11 | global 行ロックで workers≥2 が速度の偽約束 | **既知 residual（Spec 受容）** | §7.4 F7 / §9。limit 500 は枯渇緩和。予約は単一行 `FOR UPDATE` で直列化し得る。実測 wrapper ~15–20m、stretch ≤10m 未達は報告どおり。 |
| 12 | 製品 auth 形状変更で generateLink だけ green / Mailpit だけ red（または逆） | **residual（ドリフト）** | ephemeral 大半が generateLink+storage。Mailpit は setup/recovery のみ。session JSON 手組みは supabase-js 同型を目指すが callback 経路とは別（A3）。 |

---

## Findings

### Critical

（なし — 現行ツリーで workers×per-test truncate の実 corruption、GHA での SKIP_RECREATE 有効化、通常 compose/preflight の limit 改変、service role の page 漏洩は確認できず。）

---

### Important

#### A1. C2 fail-closed（per-test truncate 0）tooling が CI ゲートに未接続

- **Severity:** Important  
- **Confidence:** 95  
- **Where:**  
  - 存在: `tests/tooling/e2e-ai-quota-parallel.test.mjs`  
  - 未掲載: `scripts/ci.sh` Local-safe Node 列挙、`.github/workflows/ci.yml` 同ステップ  
  - 対照: `e2e-smoke-tags.test.mjs` / `project-config.test.mjs` は CI に固定済み  
- **Attack:**  
  1. `ensureAiQuotaForGeneration` や fixture 内 `truncate private.ai_global_daily_usage` を再導入  
  2. `workers: 2` のまま PR → **CI Local-safe Node は green**（project-config は workers のみ見る）  
  3. full E2E で worker 間枠破壊 flaky / 稀に偽 green（枠が空に戻る）  
- **現行:** e2e ツリーは clean。穴は **将来の退行を CI が止めない**こと。  
- **Fix:**  
  1. `ci.sh` と `ci.yml` の `node --test` 列挙に `tests/tooling/e2e-ai-quota-parallel.test.mjs` を追加  
  2. `project-config.test.mjs` の「shared tooling パス」assert に同ファイルを追加（smoke-tags と同様）

#### A2. workers 定数 tooling が `workers: 20` を許可する（regex 過弱）

- **Severity:** Important  
- **Confidence:** 92  
- **Where:**  
  - `tests/tooling/project-config.test.mjs` L186: `/workers: 2/u`  
  - `tests/tooling/e2e-ai-quota-parallel.test.mjs` L92: `/workers:\s*2/u`  
  - `tests/tooling/compose.test.mjs` docs ピン L546: 同様  
- **Attack:** `workers: 20`（または `12`）に変更 → match 成功 → tooling green。GoTrue / mock / 行ロック競合で flaky 爆発、または調査なしの「速さ」追求。Spec §7.4 は定数 **2**（3–4 は別 PR）。  
- **Fix:** 行アンカー付き厳密マッチ例:

```js
assert.match(config, /^\s*workers:\s*2\s*,?\s*$/mu);
assert.doesNotMatch(config, /^\s*workers:\s*(?!2\b)\d+/mu);
```

`fullyParallel:\s*true` も同様に行単位で固定。

#### A3. generateLink 既定が製品 magic-link 成功 callback をバイパス（coverage / 形状 drift）

- **Severity:** Important（品質・ドリフト。秘密漏洩ではない）  
- **Confidence:** 88  
- **Where:** `e2e/fixtures/auth.ts` `loginAsNewUser` L199–313; 製品 `src/shared/lib/supabase.ts` `detectSessionInUrl: false`  
- **Why:**  
  - Spec §7.5 の禁止は `addInitScript` 手注入。現行は実 GoTrue verify トークンの storage bridge で **禁止形は満たす**。  
  - しかし ephemeral 大半は **SPA `/auth/callback` + token_hash 成功 path を通らない**。Mailpit 経路（setup / auth-recovery）だけが製品寄り。  
  - session JSON を fixture が組み立てるため、supabase-js 永続 shape や AuthProvider の読み方変更で **generateLink だけ壊れ続け / または製品だけ壊れて E2E 緑** の非対称が起き得る。  
- **False-green リスク:** 「ログインできる」は証明するが「ユーザーがメールリンクを踏んだときと同じ成功 path」は証明しない。  
- **Fix（いずれか）:**  
  1. generateLink の `hashed_token` + 製品 callback URL（token_hash）へ寄せ、storage 手書きを減らす  
  2. または tooling で Mailpit 成功 test の title/tag を固定し、callback 成功 1 本を fail-closed（A4 とセット）  
  3. session 書込を `supabase.auth.setSession` 相当の単一ヘルパに閉じ、shape 変更点を 1 箇所に

#### A4. Mailpit 成功 path ≥1 の機械ガードが無い

- **Severity:** Important  
- **Confidence:** 90  
- **Where:** Spec §7.5 / §7.8 vs `tests/tooling/*`（`requestMagicLinkAndReadUrl` 出現 0 assert）  
- **Attack:**  
  1. setup を generateLink に置換  
  2. auth-recovery の Mailpit test から `@smoke` を外す / 削除  
  3. → full/smoke とも Mailpit 非経由のみ。tooling green のまま製品メール導線が死ぬ。  
- **現行:** setup + recovery が残存。smoke は recovery 依存。  
- **Fix:** tooling で例:  
  - `e2e/specs` 内に `requestMagicLinkAndReadUrl` が ≥1  
  - かつ `@smoke` 付き test または setup project から参照されることを固定

#### A5. §7.8「同一 SHA 2 連続 full green」が close SHA で未充足 + retry 消化

- **Severity:** Important（ゲート証拠 / flaky residual）  
- **Confidence:** 85  
- **Where:**  
  - Task 11 report: 作業 tree で full×2 EXIT 0（commit 前）  
  - Task 12: full×1  
  - Task 13 `29d33f1`: full×1、mobile 1 flaky + desktop 2 flaky（retry 後 green）  
- **Why:** Spec §8.2 / §7.8 は **同一 SHA** 2 連続と flaky 調査を要求。generateLink + CI cleanup 後の合成 SHA では 2 連続証拠が無い。retry 成功は EXIT 0 だが「決定論維持」方針と緊張。  
- **Fix:** `29d33f1`（または follow-up HEAD）で `./scripts/run-e2e.sh` を 2 連続。flaky タイトルを切り分け（layout 430px / isolated WebView / settings edit）。workers を 1 に戻して逃げるのは不可。

---

### Minor

#### M1. `ci.sh` が `CI=true` を export しない

- **Confidence:** 80  
- **Effect:** ローカル release `ci.sh` では Task 13 の restore 省略が効かず、直後 `down --volumes` と二重。安全性は上（dirty 残存しにくい）。GHA 本線は `CI: "true"` で意図どおり。  
- **Fix（任意）:** `ci.sh` で `export CI=true` して GHA と揃える、または docs に「restore 省略は GHA の CI=true 前提」と明記（現状 local-development は概ね記載済み）。

#### M2. SKIP_RECREATE が env を force-recreate せずに載せるため limit/mock 取り違え

- **Confidence:** 82  
- **Effect:** 開発専用として docs / exit 2 で封じ済み。ローカルで `SKIP=1` 連打すると auth rate-limit や **旧 app env（limit 20 のまま等）**が残り、並列 full が枯渇 flaky に見える。  
- **Fix:** 既定 recreate を維持（現状）。docs に「limit 500 を確実にするなら SKIP しない」を 1 行足す程度。

#### M3. `@serial` タグ未使用（`describe.configure` のみ）

- **Confidence:** 78  
- **Effect:** Spec 表の `@serial` タグ実行意味は Phase 3 で `mode: "serial"` 実装に置換されており機能は満たす。タグベースの静的一覧は作れない。  
- **Fix:** 任意でタグ併用、または docs で「serial は describe.configure が正」と明記。

#### M4. `reset-e2e-ai-quota.sh` ヘッダコメントが「local 20 のみ」前提のまま

- **Confidence:** 75  
- **Effect:** E2E は 500 でも suite 累積・同日再実行のため truncate は正当。コメントが古いと「500 なら shell reset 不要」と誤読され得る。  
- **Fix:** E2E 500 / 製品 20 の二面と「累積・二段 project」理由を 1 段落更新。

#### M5. dual-pass（mobile→desktop）壁時計が stretch 未達の主因として残り続ける

- **Confidence:** 80  
- **Effect:** バグではない。workers 並列の効果を 2 project 段が打ち消す。§7.6 shard 不採用と整合。  
- **Fix:** 計測 PR 説明で「list reporter の project 別」と F7 を併記（Task 13 report は既に近い）。

---

## Checklist vs Spec §7 / §9

| 項目 | 結果 |
| --- | --- |
| §7.2 E2E limit 500 / 通常 20 / preflight 不変 | **OK**（compose + tooling） |
| §7.3 per-test truncate 0 | **実装 OK** / **CI 接続欠落（A1）** |
| §7.3 workers 定数 + CI 三項禁止 | **実装 OK** / **regex 過弱（A2）** |
| §7.4 fullyParallel + serial 候補 | **OK**（主要 file serial） |
| §7.4 F7 行ロック residual | **文書化済み・受容** |
| §7.5 generateLink 既定 | **OK**（禁止形 addInitScript なし） |
| §7.5 Mailpit ≥1 | **現行 OK** / **静的ガードなし（A4）** |
| §7.5 fail-closed no Mailpit fallback | **OK** |
| §7.7 SKIP_RECREATE + CI exit 2 | **OK** + 実行テストあり |
| §7.7 CI restore 省略 | **OK**（`CI=true`） |
| §7.8 2 連続 full green | **Task 11 証拠のみ / close SHA 未（A5）** |
| §7.8 ≤10 分 stretch | **未達・説明済み** |
| §9 workers×truncate | 現行反証 / A1 で将来穴 |
| §9 SKIP_RECREATE in CI | 反証 |
| §9 E2E 500 vs 製品 20 混同 | コメント + docs OK |

---

## 反証できた良い点（回帰していないもの）

1. **Task 10+11 同一変更セット** — truncate 0 と workers 2 が同じ実装線上にあり、順序破れの即時 corruption は現状起きない。  
2. **shell 境界 reset 維持** — suite 開始 + mobile→desktop。  
3. **authEmail の workerIndex** — 並列 ephemeral の email 衝突を緩和。  
4. **reusedCompletedPage は billing-plus のみ + serial** — storageState 共有汚染の主戦場を封じている。  
5. **service role は Node `.env` のみ** — page.evaluate に渡さない。  
6. **SKIP_RECREATE の実行論証** — mock docker で exit 2 / skip recreate シーケンスを固定。  
7. **製品 preflight max 500 定義を E2E のために緩めていない** — ENV 上書きのみ。  
8. **setMockScenario は page-local route** — グローバル mock 上書き競争ではない。

---

## Verdict: **PASS_WITH_RESIDUALS**

### 理由

- Phase 3 の **現行振る舞い**（枠分離、並列定数、serial 配置、generateLink 既定、SKIP/CI fail-closed、compose 分離）は攻撃シナリオに対して **本線で耐えている**。  
- Critical な「今すぐ枠が壊れる / CI が dirty SKIP を許す / 製品 limit が書き換わる」欠陥は確認できなかった。  
- 残るのは **ゲート閉包の穴（A1–A2）**、**auth カバレッジ非対称（A3–A4）**、**最終 SHA の flaky / 2 連続証拠不足（A5）**。これらは「今の実装が即 false green で製品を壊す」より **ドリフトと再導入耐性**の問題。

### マージ／Phase 3「完全クローズ」前に推奨（優先順）

1. **A1:** `e2e-ai-quota-parallel.test.mjs` を `ci.sh` + `ci.yml` + project-config の共有パス assert に載せる（C2 を CI で閉じる）。  
2. **A2:** workers/fullyParallel を行単位の厳密正規表現に。  
3. **A5:** close HEAD で full 2 連続；flaky 3 本を切り分け。  
4. **A4（+A3 の一部）:** Mailpit 成功 path の静的固定。

### 受容してよい residual

- F7 行ロックによる生成直列化と ≤10 分 stretch 未達  
- shell mobile→desktop 二段の壁時計  
- SKIP_RECREATE の開発専用 dirty リスク（exit 2 + docs 済み）  
- generateLink の storage bridge（製品 `detectSessionInUrl: false` 前提の必要悪；A3 は監視）

---

ADVERSARIAL_REVIEW_COMPLETE
