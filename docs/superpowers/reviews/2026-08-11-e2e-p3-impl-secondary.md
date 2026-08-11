# 2次検証: Phase 3 E2E 短縮 実装

- **役割:** Secondary Reviewer（一次・敵対と非共有コンテキスト）
- **Range:** `9ebfe82..29d33f1`
- **入力:**  
  - Primary: `docs/superpowers/reviews/2026-08-11-e2e-p3-impl-primary.md`  
  - Adversarial: `docs/superpowers/reviews/2026-08-11-e2e-p3-impl-adversarial.md`  
  - Spec: `docs/superpowers/specs/2026-08-11-e2e-runtime-reduction-design.md` §7（§8.1 / §9 を補助）
- **照合:** live tree（read-only）+ Task reports under `.superpowers/sdd/e2e-p3-task*.md`
- **手法:** 静的解析のみ（full E2E / Docker 再実行なし）

## Summary

Phase 3 の **現行振る舞い**（E2E limit 500 / 製品 20、per-test truncate 0、`workers: 2` + `fullyParallel: true`、serial 6 file、generateLink 既定、Mailpit ≥1 残存、CI×SKIP exit 2、CI restore 省略、preflight 不変）は **Spec §7 本線を満たす**。Critical な「今すぐ枠破壊 / CI で SKIP 有効 / 製品 limit 改変 / service role 漏洩」は **反証**できる。

一次の **Important = 0** は、**fail-closed tooling の穴（A1・A2）を過小評価**している。敵対的の **A3・A4 を Important とするのは過大**（A3 は §7.5 禁止形に当たらない；A4 は現行充足のうえ静的ガード欠如は Minor residual）。**A5** はコード欠陥ではなく **完了証跡のプロセス残渣**。

**最終:** **FIX_THEN_OK**  
必須修正は tooling / CI 配線のみ（製品・e2e fixture 挙動の書き換えは不要）。A1+A2 を入れたうえで Phase 3 をゲート完了とみなしてよい。A5 の close SHA full×2 はプロセス推奨（コード差分ではない）。

| Axis | Secondary |
| --- | --- |
| Spec §7.2–7.8 現行実装 | **PASS**（§7.8 項 3 の close SHA 2 連続は未充足 = プロセス） |
| Security / ownership | **PASS** |
| Fail-closed tooling 完全性 | **FAIL soft**（A1 未接続 + A2 正則過弱） |
| Critical 現行破壊 | **なし** |

---

## Cross-walk（Important / Critical 候補）

| ID | 出典 | 主張 | 二次判定 | 再検証後 severity |
| --- | --- | --- | --- | --- |
| **A1** | Adv Important | `e2e-ai-quota-parallel.test.mjs` が CI Local-safe Node に未掲載 | **CONFIRMED** | **Important** |
| **A2** | Adv Important / Pri M2 | `/workers:\s*2/` 等が `workers: 20` を通す | **CONFIRMED** | **Important**（Pri の Minor は過小） |
| **A3** | Adv Important / Pri M4・P2 | generateLink の localStorage が手注入 / 製品 callback バイパス | **PARTIAL → §7.5 違反は FALSE_POSITIVE**；ドリフト residual は **CONFIRMED** | **Minor residual**（Important ではない） |
| **A4** | Adv Important | Mailpit 成功 path の機械ガード無し | **CONFIRMED as residual** | **Minor**（現行 ≥1 は充足） |
| **A5** | Adv Important / Pri M1・P7 | close SHA で同一 SHA full 2 連続未実施 + retry 消化 | **CONFIRMED process residual** | **Important（証跡） / code defect なし** |
| **P1** | Pri | e2e 内 per-test truncate / ensure / reset **0**、shell のみ | **CONFIRMED PASS** | none |
| **P2** | Pri | generateLink ≠ addInitScript 手注入 | **CONFIRMED PASS** | none（A3 と整合） |
| **P3** | Pri | service role が page / VITE に漏れない | **CONFIRMED PASS** | none |
| **P4** | Pri | 製品 limit 20 / max 500 / preflight 不変 | **CONFIRMED PASS** | none |
| **P5** | Pri | serial 6 file、共有 storageState は billing-plus のみ | **CONFIRMED PASS** | none |
| **P6** | Pri | CI+SKIP exit 2；CI restore 無し | **CONFIRMED PASS** | none |
| **P8** | Pri | F7 + ≤10m stretch miss は必須ゲート非破壊 | **CONFIRMED PASS** | none（受容 residual） |
| **P9 / M3** | Pri Minor | shell reset 呼び出しが「1 回以上」しか固定されない | **CONFIRMED** | **Minor** |
| **P10** | Pri | Task 13 flaky 3 本は共有枠汚染ではない | **CONFIRMED residual** | **Minor / process** |
| Critical（双方） | Both | 現行破壊 Critical | **CONFIRMED 空** | none |

---

## Focus revalidation

### A1 — `e2e-ai-quota-parallel.test.mjs` は CI から外れているか

**CONFIRMED · Important**

| 事実 | Live evidence |
| --- | --- |
| ファイル存在・契約内容 | `tests/tooling/e2e-ai-quota-parallel.test.mjs`: (1) e2e ツリーで 3 needles 0、(2) shell reset 残存、(3) workers 2 + fullyParallel |
| `ci.sh` 列挙 | `scripts/ci.sh` L20–25: `compose` / `local-development-scripts` / `project-config` / `e2e-smoke-tags` / `eslint-primitive-rule` のみ。**`e2e-ai-quota-parallel` 無し** |
| `ci.yml` Local-safe Node | `.github/workflows/ci.yml` L40–47: 同上（eslint も無いが、quota-parallel も無い） |
| project-config が共有パスを固定する範囲 | `project-config.test.mjs` L269–278: compose / local-dev / project-config / **e2e-smoke-tags** を CI ソースに match。**e2e-ai-quota-parallel は対象外** |
| 他 tooling が truncate-0 を代替しているか | **していない。** `project-config` は workers/fullyParallel のみ。`compose.test.mjs` は runner に `reset-e2e-ai-quota.sh` 文字列があることと compose 20/500 分割。**`e2e/**` 内 needle 0 は本ファイル専用** |
| 現行 e2e は clean か | `rg` on `e2e/`: `ensureAiQuotaForGeneration` / `resetGlobalAiQuotaForE2e` / `truncate private.ai_global_daily_usage` → **0 hits**。stub `reset-global-ai-quota.ts` は comment + `export {}` のみ |

**「他 fail-closed が走るなら Important ではない」か?**  
**否。** Spec §7.3 の dual fail-closed は (1) per-test truncate 0 **と** (2) workers 定数 2。CI が (2) だけ見ても (1) の再導入を PR Local-safe Node は止めない。full E2E は push 側であり、PR では smoke のみ → **workers=2 のまま truncate を戻す PR が静的ゲートをすり抜け得る**。現行ツリーが clean であることは **実装 PASS** と **ゲート欠落** を両立させる（Phase 1 の「現行正しい・ガード弱い」と同型だが、C2 本線なので Important を維持）。

**Fix（必須）:**
1. `scripts/ci.sh` の `node --test` 列挙に `tests/tooling/e2e-ai-quota-parallel.test.mjs` を追加（`e2e-smoke-tags` 近傍）。
2. `.github/workflows/ci.yml` の Local-safe Node ステップに同パスを追加。
3. `tests/tooling/project-config.test.mjs` の共有 tooling パス assert に同ファイルを追加（smoke-tags と同型）。

---

### A2 — `/workers:\s*2/` は `workers: 20` に match するか

**CONFIRMED · Important**

**Literal JS 解析（再実行不要）:**

対象文字列例: `"  workers: 20,\n"`

| Pattern | `workers: 2` | `workers: 20` | `workers: 21` | `workers: 12` | 備考 |
| --- | --- | --- | --- | --- | --- |
| `/workers:\s*2/u`（e2e-ai-quota L92） | match | **match** | **match** | no | `\s*` の後の `2` が `20`/`21` の先頭桁に消費される。アンカーも `\b` も無し |
| `/workers: 2/u`（project-config L186） | match | **match** | **match** | no | 空白固定でも同様に部分一致 |
| `/workers:\s*1\b/u` doesNotMatch | — | 無関係 | 無関係 | — | `20` を拒否しない |
| `/workers:\s*2\b/u`（提案） | match | **no** | **no** | no | `2` の直後が word char `0` なら boundary 不成立 |

**Live 使用箇所:**
- `tests/tooling/project-config.test.mjs` L186: `assert.match(config, /workers: 2/u);`（**CI 実行対象**）
- `tests/tooling/e2e-ai-quota-parallel.test.mjs` L92: `/workers:\s*2/u`
- `tests/tooling/compose.test.mjs` L546: docs 向け `/workers:\s*2/u`

**現行 `playwright.config.ts` L15 は literal `workers: 2`** のため今は green かつ正しい。欠陥は **「定数 2 を強制する」と称する assert が 20 を許す**こと。Spec §7.4「workers **2**（定数）。安定後 3〜4 は別 PR」に対し、CI 上の fail-closed が偽。

**Fix（必須）:** 行単位の厳密マッチに置換。例:

```js
assert.match(config, /^\s*workers:\s*2\s*,?\s*$/mu);
assert.doesNotMatch(config, /^\s*workers:\s*(?!2\b)\d+/mu);
assert.match(config, /^\s*fullyParallel:\s*true\s*,?\s*$/mu);
```

`project-config.test.mjs` / `e2e-ai-quota-parallel.test.mjs` /（任意）`compose.test.mjs` docs ピンを揃える。

---

### A3 — generateLink localStorage は §7.5 違反か

**§7.5 違反としては FALSE_POSITIVE · ドリフト residual は CONFIRMED Minor**

**Spec §7.5 原文の境界:**
- **採用:** Admin `generateLink`（magiclink）で URL を取得しブラウザで開く。Mailpit 非経由。
- **不採用:** session 形状の手注入（**`addInitScript`**）。
- **維持:** Mailpit 成功 path ≥1；oauth/cancel/expired は UI 維持；失敗時 fail-closed。

**Live `loginAsNewUser`（`e2e/fixtures/auth.ts` L199–313）:**
1. Node のみ `createServiceAdmin()`（`.env` の `SERVICE_ROLE_KEY`、page 非渡与）。
2. `admin.auth.admin.generateLink({ type: "magiclink", ... })`。
3. `normalizeGenerateLinkActionUrl` → `page.goto(action_link)` → GoTrue verify の **実** `access_token` / `refresh_token` を `framenavigated` で捕捉。
4. publishable + user JWT で `/auth/v1/user` 検証。
5. 製品 key `browserSupabaseSessionStorageKey` へ **実トークン**の session JSON を `page.evaluate` → `localStorage.setItem`。
6. clean `/planner`。**`addInitScript` なし。Mailpit フォールバックなし（throw のみ）。**

**製品制約:** `src/shared/lib/supabase.ts` `detectSessionInUrl: false`（implicit fragment を SPA が消費しない）→ GoTrue hash を storage に載せる glue は **採用方式の必然**。

| 解釈 | 二次結論 |
| --- | --- |
| localStorage 書込 = 常に「手注入」で §7.5 違反 | **REJECT** — Spec が禁じるのは addInitScript による session 形状の事前手注入。実トークンの storage bridge は採用経路 |
| 製品 `/auth/callback` + token_hash 成功 path を ephemeral 大半が踏まない | **CONFIRMED residual** — カバレッジ非対称。Mailpit setup/recovery が製品寄りを担保。仕様上の必須ではない |
| session JSON 手組みによる shape drift | **CONFIRMED Minor residual** — 単一ヘルパに閉じている現状は許容。監視は A4 とセットで十分 |

**Fix:** コード必須変更なし。任意: session 書込を一箇所コメント維持 / Mailpit 静的固定（A4）でドリフト監視。

---

### A4 — Mailpit ≥1 の静的ガード欠如は Important か

**CONFIRMED residual · Minor（Important へ昇格しない）**

| 条件 | Live |
| --- | --- |
| Spec §7.5 / §7.8「Mailpit 成功 path ≥1」 | **充足** |
| setup | `e2e/specs/auth.setup.ts` → `requestMagicLinkAndReadUrl` |
| full / smoke 回帰 | `auth-recovery.spec.ts` same-browser `@smoke` + 非 smoke 1 本が Mailpit |
| tooling に `requestMagicLinkAndReadUrl` ≥1 assert | **無し**（Adv 事実は正しい） |

現行が要件を満たしている以上、欠如は **退行耐性の穴**であり、**今の実装欠陥ではない**。A1 と違い「dual C2 の半分が CI で一度も走らない」ほどの本線リスクではない（setup 削除や recovery の generateLink 化はレビューで目立ちやすい）。  
**Severity: Minor。** follow-up で tooling 固定は有用だが FIX_THEN_OK の must-fix にはしない。

**任意 Fix:** tooling で `e2e/specs` 内 `requestMagicLinkAndReadUrl` ≥1、かつ setup または `@smoke` から到達することを固定。

---

### A5 — 同一 SHA 2 連続 full green

**CONFIRMED process residual · コード欠陥なし**

| 証跡 | 内容 |
| --- | --- |
| Task 11 report（`7e6fa8b` 作業 tree） | full×2 EXIT 0（mobile 68 + desktop 53、workers=2） |
| Task 12 report | full×1；2 連続は未実施と明記 |
| Task 13 report（`29d33f1`） | full×1；mobile 1 flaky + desktop 2 flaky（retry 後 EXIT 0）；**本 SHA 2 連続未実施**を自認 |
| Spec §7.8 項 3 / §8.1 | 同一 SHA で full 2 連続；retry 増なら調査 |

これは **実装バグではなく完了ゲートの証跡ギャップ**。generateLink（Task 12）と CI cleanup（Task 13）後に flaky プロファイルが変わり得る、という一次 M1 の読みは妥当。  
**workers=1 への逃げは無し（tooling が拒否）** — プロセス残渣として正しい扱い。

**Action（プロセス、コード差分なし）:** Phase 3 正式クローズ宣言前に HEAD で `./scripts/run-e2e.sh` を **2 連続**。flaky タイトル（430px layout / isolated WebView auth-recovery / settings member edit）を切り分け。必須コード変更ではない。

---

## Primary 候補（P*）の再検証要約

| ID | 二次 |
| --- | --- |
| **P1** truncate 0 | **CONFIRMED PASS** — e2e 0 hits；shell `run-e2e.sh` L473 + L531 の 2 呼び出し |
| **P2** §7.5 | **CONFIRMED PASS** — A3 と一致 |
| **P3** service role | **CONFIRMED PASS** — `auth.ts` / `seed-onboarding.ts` / `acceptance.ts` が Node `.env`；evaluate は storageKey + sessionJson のみ |
| **P4** 製品契約 | **CONFIRMED PASS** — `compose.yaml` `"20"`；`compose.e2e.yaml` `"500"` + 必須コメント；`plan-quota` max 500；preflight 501 reject |
| **P5** serial | **CONFIRMED PASS** — `describe.configure({ mode: "serial" })` ×6: races, billing-plus, full-journey, generation-recovery, history-regeneration, history-safety-change。`reusedCompletedPage` 参照は billing-plus のみ |
| **P6** SKIP/CI | **CONFIRMED PASS** — `run-e2e.sh` L22–25 exit 2（lock 前）；L258–259 CI restore 省略；`local-development-scripts` が実行論証 |
| **P7** = A5 | 上記 |
| **P8** F7 / stretch | **CONFIRMED 受容** — Spec §7.4/§7.8 項 6 明示；reports 15–20m 帯・行ロック説明済み |
| **P9** | M2→**A2 Important**；M3→**Minor CONFIRMED**（`assert.match(runE2e, /reset-e2e-ai-quota\.sh/)` は回数非固定。live は 2 回） |
| **P10** flaky | **CONFIRMED residual** — タイトルは layout / WebView / settings。共有 AI truncate race の形ではない。serial 追加は将来レバー |

**history-safety-change の `addInitScript`:** L140–147 は `__KONDATE_E2E_REVALIDATE_POLL_MS` の E2E seam のみ。**session 手注入ではない**（§7.5 無関係）。

---

## Adversarial Minors（相互作用のみ）

| ID | 二次 |
| --- | --- |
| Adv M1 `ci.sh` が `CI=true` を export しない | **CONFIRMED Minor** — ローカル ci.sh は restore 省略が効かず安全側。GHA は `env.CI` 前提 |
| Adv M2 SKIP dirty env | **CONFIRMED 既知** — exit 2 + docs で封じ済み |
| Adv M3 `@serial` タグ未使用 | **CONFIRMED intentional** — `describe.configure` が実行意味の正 |
| Adv M4 reset スクリプト旧コメント | **CONFIRMED Minor** — 文書 |
| Adv M5 dual-pass 壁時計 | **CONFIRMED 設計 residual** — バグではない |

Primary M5（生成 file の serial 外）: **CONFIRMED 許容** — Spec 必須候補はカバー済み。

---

## Confirmed fixes required（implementer）

### Must-fix（FIX_THEN_OK の条件）

1. **A1 — CI に C2 truncate 半を接続**  
   - **Files:**  
     - `scripts/ci.sh` — `node --test` 列に `tests/tooling/e2e-ai-quota-parallel.test.mjs`  
     - `.github/workflows/ci.yml` — Local-safe Node に同パス  
     - `tests/tooling/project-config.test.mjs` — script/workflow 双方への path assert（`e2e-smoke-tags` と同型）  
   - **Verify:** `node --test tests/tooling/project-config.test.mjs`（または focused Local-safe 列）が緑。

2. **A2 — workers 定数の正則を厳密化**  
   - **Files:**  
     - `tests/tooling/project-config.test.mjs`（CI 本線）  
     - `tests/tooling/e2e-ai-quota-parallel.test.mjs`  
     - 任意: `tests/tooling/compose.test.mjs` docs ピン  
   - **Change:** 行アンカー + `2` の word-boundary / negative lookahead。`workers: 20` / `12` / `21` で **red**、`workers: 2` で **green** を確認。  
   - **Do not** change live `playwright.config.ts` の `workers: 2`（既に正しい）。

### Not required as code must-fix

| ID | 扱い |
| --- | --- |
| **A3** | 変更不要（§7.5 適合）。任意で shape ヘルパ集約コメント維持 |
| **A4** | 任意 tooling（Minor）。must-fix 外 |
| **A5** | **プロセス:** close 宣言前に HEAD で full×2。コード PR 条件ではない |
| **M3** | 任意: `run-e2e.sh` 内 `reset-e2e-ai-quota.sh` 出現 ≥2 |
| F7 / ≤10m / dual-pass | 受容 residual（文書済み） |

---

## Verdict: **FIX_THEN_OK**

| 項目 | 内容 |
| --- | --- |
| Critical | **0** |
| Must-fix Important | **A1, A2**（tooling/CI のみ） |
| 過大指摘 | Adv **A3**（§7.5 違反）、Adv **A4**（Important 昇格） |
| 過小指摘 | Primary の **Important=0**（A1/A2 を nits に落としすぎ） |
| プロセス | **A5** — formal close 前 full×2 推奨 |
| 本線実装 | Spec §7 振る舞い **PASS** — 製品コードの REVISE 不要 |

A1+A2 適用後は **APPROVE_AS_IS 相当**（残は Minor / process residual）。workers=1 ロールバックや generateLink 全面書き換えは **不要かつ非推奨**。

---

SECONDARY_REVIEW_COMPLETE
