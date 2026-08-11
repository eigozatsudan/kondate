# 1次レビュー: Phase 1 E2E 短縮 実装

- **範囲:** `891431e..5c68150`（5 commits）
- **資料:** Spec `docs/superpowers/specs/2026-08-11-e2e-runtime-reduction-design.md` §4–§5 / Plan Tasks 1–5 / diff package `/tmp/grok-1000/e2e-p1-impl-review-554fd0e9/`
- **手法:** 静的解析のみ（full E2E は再実行していない）
- **live HEAD 照合:** `/home/dev/projects/kondate` の `playwright.config.ts` / `scripts/run-e2e.sh` / tags / tooling / CI

## Summary

Phase 1（タグ・project 役割・`KONDATE_E2E_SUITE`・PR smoke / push full・docs）は **Spec §4–§5 と Plan Tasks 1–5 に概ね忠実**。  
現状ソース上の `@smoke` 付与は §4.2 固定表の必須ファイル×最低本数と **exact title 方針（Plan Task 2）の両方を満たす**。`run-e2e.sh` の smoke 分岐は Plan の完成形どおり **mobile 1 段 + `--grep=@smoke`** で、desktop 段と project 境界 quota reset を踏まない。CI は PR=smoke / push(main)=full、`ci.sh` は full 既定。docs は「PR smoke ≠ acceptance 全量」を明示。

製品契約（quota 値・workers=1・privacy assert・release-checklist の full）は壊していない。Plan 断片にあった unquoted `$smoke_args` を実装が避け、`"$@"` ベースの portable な引数組立になっている点は良い。

残るのは **将来退行に対する tooling の穴**（`@mobile-only` の弱ガード、smoke の title 非固定）と、§5.5 の **full 実測証跡が diff から確認できない**プロセス面。現行ツリー自体は仕様適合であり、マージ阻害の Critical は見ない。

## Verdict: APPROVE_WITH_NITS

## Findings

### Critical

（なし）

### Important

#### F1. `@mobile-only` 静的ガードが `≥1` のみで、desktop 二重実行の退行を取りこぼしうる

- **Confidence:** 88
- **Where:** `tests/tooling/e2e-smoke-tags.test.mjs` L63–69
- **Why:** Spec §4.1 / §5.2 / §5.5 は `mobile-accessibility` 幅マトリクスを **mobile project 専用**にし、desktop で **0 実行**することを完了条件にしている。現行ソースはループ内 5 定義すべてに `@mobile-only` があり正しいが、tooling は

  ```js
  countTagLiteral(source, "@mobile-only") >= 1
  ```

  のみ。例えば household 以外 4 シナリオからタグを外しても tooling は緑のまま、full の desktop 段で a11y 二重実行が部分復活する（Phase 1 の主短縮効果が静かに消える）。
- **Fix suggestion:** 最低でも「`test(` 定義数 × 幅数」に相当する `@mobile-only` 本数、または「幅ループ内の各 `test(` に `tag:` が付き `@mobile-only` を含む」AST/正規表現検査に強化する。320 household の ternary 固定（既にある）は維持。

#### F2. smoke 固定は「ファイル × 最低本数」のみで、Plan が列挙した exact title を機械固定していない

- **Confidence:** 82
- **Where:** `tests/tooling/e2e-smoke-tags.test.mjs` L20–48 / 対比: Spec §4.2・Plan Task 2 title 表
- **Why:** Spec 文言は「必須ファイル × 最低本数」であり現行 tooling はそれに沿う。一方 Plan Task 2 と §4.2 の「含める内容」は **どの test か**まで指定している（例: history-regen の *does not consume a success for duplicate output* = MVP #13、pantry CRUD = MVP #9、generation の connectionreset + result details）。

  現状実装のタグ付けは exact title どおり正しい。しかし tooling は `"@smoke"` リテラル出現回数だけを数えるため、**別 test に付け替えても本数さえ満たせば緑**（PR smoke から e2e-only 重要 path が静かに落ちる false-green）。
- **Fix suggestion（推奨・Phase 1 追補でも可）:** ファイルごとに必須 title 部分文字列（または完全 title）の allowlist を assert。例:

  ```js
  // history-regeneration: title 近傍に tag: ["@smoke"] があること
  assert.match(source, /does not consume a success for duplicate output[\s\S]{0,120}["']@smoke["']/u);
  ```

  本数下限は併用のまま。

#### F3. Spec §5.5「full を 1 回以上計測し desktop a11y 0 実行を確認」の証跡が実装 diff から確認できない

- **Confidence:** 85（プロセス／完了ゲート）
- **Where:** Plan Task 5 Step 2 / Spec §5.5 最終項。コード変更には含まれない。
- **Why:** 実装コミット群はタグ・runner・CI・docs まで揃っているが、レビュー package と diff には smoke/full の `N passed (T)` や desktop で mobile-accessibility が filter された list 証跡が無い。コード上は `grepInvert: /@mobile-only/` + 全 a11y へのタグ付与で **0 実行になる設計**だが、§5.5 の完了条件としては実測確認が残る。
- **Fix suggestion:** Verifier / 人間が `KONDATE_E2E_SUITE=smoke` と full を各 1 回走らせ、PR 説明または handoff に壁時計と desktop 側 a11y 非実行を記録（ログ本体は git に載せない）。未実施なら Phase 1 完了宣言を保留。

### Minor

#### F4. `@mobile-only` / `@smoke` のカウントがコメントや非 tag リテラルにも反応しうる

- **Confidence:** 70（参考・閾値付近のため対応任意）
- **Where:** `countTagLiteral`（単純 `["']@smoke["']`）
- **Why:** コメントや文字列定数に `"@smoke"` を書くと本数が水増しされる。実害は低いが F2 と合わせて title 近傍マッチの方が堅い。

#### F5. `e2e_args_have_grep` は `-g=*` 連結形を検出しない

- **Confidence:** 65
- **Where:** `scripts/run-e2e.sh` `e2e_args_have_grep`
- **Why:** `--grep` / `--grep=*` / 単独 `-g` は検出。Playwright 常用はカバー済み。`-g@smoke` のような非標準連結だけ二重付与しうる。実運用影響は小さい。

---

## Spec §5.5 checklist

| 条件 | 判定 | 根拠 |
| --- | --- | --- |
| §4.2 必須ファイル×最低本数が tooling で固定され、smoke が下限を満たす | **PASS（現行ソース）** / tooling は本数のみ（F2） | `e2e-smoke-tags.test.mjs` の 14 ファイル表 + live tags 照合。account-deletion / billing-plus は `@smoke` 0 |
| `KONDATE_E2E_SUITE=smoke` で mobile のみ・`@smoke` のみ（desktop 段なし） | **PASS** | `run-e2e.sh` L424–434; `local-development-scripts.test.mjs` smoke golden（playwright 1 回・中間 reset なし） |
| `mobile-accessibility` が desktop project で 0 実行（config `grepInvert`） | **PASS（設計）** / 退行ガード弱（F1） | `playwright.config.ts` desktop `grepInvert: /@mobile-only/`; 全 a11y test に `@mobile-only` |
| PR workflow が smoke、push / `ci.sh` 既定が full | **PASS** | `ci.yml`: `event_name == 'pull_request' && 'smoke' \|\| 'full'`; `ci.sh`: `KONDATE_E2E_SUITE:-full` |
| tooling（compose / expectedE2EInvocations smoke 分岐 / CI ゲート順 / smoke タグ）が緑であること | **PASS（静的）** | テスト追加・更新を diff で確認。本レビューでは Docker 再実行なし |
| docs に PR smoke ≠ acceptance 全量が書かれている | **PASS** | `docs/local-development.md` 注意文; README / docs/README 追記 |
| full を 1 回以上計測し desktop a11y 0 を確認（≤22 分は stretch） | **未確認（F3）** | 実装 diff に計測証跡なし |

### §4.2 smoke セット照合（live）

| 領域 | 期待 | 実装 title / 本数 | 結果 |
| --- | --- | --- | --- |
| foundation | 全（1） | `protects app routes…` `@smoke` | OK |
| oauth-mock | 2 | success + cancel | OK |
| full-journey | 2 | household + idea | OK |
| auth-callback | 2 | cancel + past expires_at | OK |
| auth-recovery | 1 | same-browser | OK |
| generation | 2 | connectionreset resend + result details | OK |
| shopping-list | 1 | preserves protected rows | OK |
| shopping-races | 1 | reuses one idempotency key | OK |
| history-safety | 1 | automatically revalidates on mount… | OK |
| history-regen | 1 | does not consume a success…（#13） | OK |
| menu-pantry | 1 | pantry CRUD…（#9） | OK |
| onboarding | 1 | 全 test | OK |
| settings | 1 | adds, edits, and deletes… | OK |
| mobile-a11y | 1（320 household のみ） | ternary `@mobile-only`+`@smoke` | OK |
| account-deletion / billing | 0 | タグなし | OK |

**合計 smoke 定義:** 18 本 × mobile 1 project（Spec の 14–22 本レンジ内）。

### その他ゲート整合

- **privacy / mock:** CI E2E ステップに `KONDATE_ASSERT_PRIVACY_LOGS=1`・`PLAYWRIGHT_DISABLE_TRACE=1`・`LOCAL_MOCK_MODELS` 維持。
- **release-checklist:** `./scripts/run-e2e.sh` のまま（smoke 差し替えなし）。
- **grepInvert 単一入口:** fixture `beforeEach` / 散発 `test.skip` なし。config のみ。
- **Playwright タグ × grep:** 公式どおり `tag` は `--grep` / project `grepInvert` の対象（@playwright/test ^1.55）。
- **shell 移植性:** smoke 引数は `set -- --project=… "$@"` / `set -- "$@" --grep=@smoke`。Plan 例の unquoted 展開バグを回避。不正 suite は exit 2 + cleanup 経路を tooling で固定。

## Positive notes

1. **CI 偽 green の主経路を塞いでいる:** PR を smoke に落とす一方、§4.2 拡張セットに MVP #9 / #13 と auth クリティカル path を残し、Spec C1（merge-time 穴の縮小）に沿っている。account-deletion / billing を full のみに隔離した判断も明確。
2. **runner 契約が golden テストされている:** `expectedE2EInvocations(..., "smoke")` で playwright 1 回・中間 quota reset なし・caller の `--project`/`--grep` 二重付与なしを固定。compose 文字列ピンと project-config の suite 分岐 assert が重層。
3. **実装が Plan の shell 落とし穴を避けている:** unquoted `$smoke_args` ではなく `"$@"` ベース。full 経路（mobile → reset → desktop、失敗時も両段実行）を維持。
4. **ドキュメントが運用前提を隠さない:** 「PR smoke ≠ 受け入れ全量」「full は push / ci.sh / release」を local-development に明記。
5. **差分の本体変更がタグ付けに閉じている:** 大規模 spec の diff は indent + `tag` 付与が中心で、テスト主張の書き換えは見えない（静的レビュー範囲）。

## 推奨フォロー（マージ後でも可、F3 のみ完了前推奨）

1. smoke / full 実測を 1 回ずつ記録（F3）— Phase 1 完了宣言の前に推奨。  
2. tooling 強化（F1・F2）— 退行耐性。必須でなければ follow-up Issue。  
3. 任意: acceptance-matrix Notes に「#9/#13 の 1 本は smoke」を 1 行（Spec §5.4 任意）。

---

PRIMARY_REVIEW_COMPLETE
