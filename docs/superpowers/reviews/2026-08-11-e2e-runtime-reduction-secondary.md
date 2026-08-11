# 2次検証: E2E 実行時間短縮 Spec/Plan レビュー

**検証者:** Secondary verifier（1次・敵対的レビューの著者ではない）  
**対象:** 1次 `/tmp/grok-1000/e2e-reduction-primary-review-2f2d14bc.md`、敵対的 `/tmp/grok-1000/e2e-reduction-adversarial-review-2f2d14bc.md`  
**照合:** パッケージ Spec/Plan + live tree `/home/dev/projects/kondate`（read-only）  
**日付:** 2026-08-11

## Summary

両レビューの指摘は概ね実装と一致する。**敵対的 C1（PR smoke のみでの merge-time false green）** と **C2（per-test global truncate × workers≥2 の共有枠破壊）** は live tree で裏付けられ、Critical 扱いが妥当である。1次 F8 / F7 は同じ領域の別角度（運用前提の未文書化 / FOR UPDATE 直列化）であり、C1・C2 と重複しつつも独立して残る。

特に依頼された二重確認の結論:

| 論点 | 判定 |
| --- | --- |
| C1 vs F8（PR smoke → main false green） | **両方成立。最終 severity は Critical（sign-off 無し）**。push to main の full は **マージ後**検知。repo 内に branch protection / merge queue の文書・設定は無い |
| C2 vs F7（truncate 破壊 vs FOR UPDATE） | **両方 real・別問題**。C2=並列時カウンタ消失（Critical if order broken）。F7=limit 500 後も行ロックで生成直列（Important residual） |
| F4 `workers: 1` | **CONFIRMED** — `tests/tooling/project-config.test.mjs:161` |
| F1 setup Spec↔Plan 矛盾 | **CONFIRMED** — Spec §6.3 dependsOn vs Plan Task 7 shell 1 回 + 概形に dependencies 残存 |
| 「0 smoke で exit 0」 | 敵対的の **反証を CONFIRMED** — Playwright 1.61.1、repo に `pass-with-no-tests` 無し、0 件は非 0 exit。薄い smoke の false-green 本命は **1–数本だけのタグ**（F3） |
| Plan Task 3 placeholder | **CONFIRMED** — `set -- "$@"` / `extra=` / `:` / `build_playwright_args` コメントのみ。self-review「Placeholder なし」は誤り |

**最終:** 現状のまま全 Task 実装開始は不可。**REVISE_SPEC_PLAN** のうえ、C1 の設計修正または人間 sign-off、Phase 1 向け F1/F2/F3/F5/F9 を閉じてから Phase 1 実装。C2/F4/F7 は Phase 3 着手前に必須。

---

## Cross-walk table

| ID (primary/adversarial) | Verdict | Final severity | Notes |
| --- | --- | --- | --- |
| **Adv C1** PR smoke → merge false green | **CONFIRMED** | **Critical** | `.github/workflows/ci.yml` L3–6: `pull_request` + `push: branches: [main]`。Task 4 は PR のみ `KONDATE_E2E_SUITE=smoke`。full は merge 後 push。`.github` に branch protection 設定無し、docs にも required check / merge queue の固定無し。MVP #13 `history-regeneration` は matrix 上 **e2e only**（`acceptance-matrix.md` L23）で smoke 0。Spec §9「push に full」は事後検知であり merge 阻止ではない。**「push full があるから Critical ではない」は不成立** |
| **Pri F8** PR smoke 薄さ・運用前提不足 | **PARTIAL** | **Critical**（C1 に統合） | 事実関係は正しいが severity を Important に抑えているのは過小。C1 と同一根因。ドキュメント追記だけでは不十分で、設計変更 or 明示 sign-off が要る |
| **Adv C2** truncate × workers 並列破壊 | **CONFIRMED** | **Critical** | `reset-global-ai-quota.ts` が `truncate private.ai_global_daily_usage`。呼出: `auth.ts`（authenticated/completed/idea）、`history.ts`、`shopping.ts`、generation 系。共有 DB 1 本。Plan は Task 10→11 の文章順のみで、workers>1 時の truncate 残存 fail-closed 無し。Task 11 Files に `project-config` / reset 残存 grep 無し。エージェントが Phase を飛ばすと即災害 |
| **Pri F7** FOR UPDATE 直列化 | **CONFIRMED** | **Important** | C2 とは別。最新 migration でも `select * into v_global from private.ai_global_daily_usage ... for update`（例: `20260729150000_quality_mode_ledgers.sql` L470–471、`20260730120000_ingredient_preference.sql` L386–387）。limit=500 は枯渇緩和だが **予約の壁時計並列は打ち消され得る**。Phase 3「≤10 分」達成リスク。Critical ではない（壊すのは速度/ flaky、枠カウンタ破壊ではない） |
| **Pri F1** setup dependsOn vs shell 1 回 | **CONFIRMED** | **Important** | Spec §6.3: `setup → mobile/desktop dependsOn`。Plan Task 7: shell で setup 1 回 + `dependencies` 外し推奨、一方 config 概形 L502–508 に `dependencies: ["setup"]` 残存。`run-e2e.sh` L401–420 は project 未指定時 **2 プロセス**（mobile → reset → desktop）。dependsOn 付きのまま 2 段だと setup / `user.json` 二重。**アーキ未固定** |
| **Adv I3** setup 二重 + storageState 汚染 | **CONFIRMED** | **Important** | F1 と同一クラスタ。ephemeral タグ強制の静的テスト欠如も妥当 |
| **Pri F2** project filter が fixture グラフを覆いきれない | **CONFIRMED** | **Important** | raw `@playwright/test`: `foundation.spec.ts`, `oauth-mock.spec.ts`, `auth-callback-security.spec.ts`。auth 経由: settings/onboarding/mobile-a11y 等。`authTest.extend`: history/shopping/acceptance。Phase 1 の `@mobile-only` 主対象は auth 経由のため当面動くが、「1 か所集約」契約は未達。Plan は伝播を「確認する」止まり |
| **Adv I7** project-filter auth 限定 | **CONFIRMED** | **Important** | F2 と同根。将来タグ拡大で silent 二重実行 |
| **Pri F3** smoke 静的ガード弱い | **CONFIRMED** | **Important** | Plan Task 2 Step 3: 「`@smoke` ≥1」「mobile-only あり」、必須ファイルリストは **任意**。C1 下では PR ゲート完全性の中心。1–2 本 smoke で green し得る |
| **Adv M1** smoke タグガード弱い | **PARTIAL** | **Important**（F3 に統合） | 内容は正しいが Minor は過小（PR が smoke のみになる前提では Important） |
| **Pri F4** `project-config` workers:1 未更新 | **CONFIRMED** | **Important** | live: `project-config.test.mjs:159–162` が `workers: 1` をハード固定、CI 動的分岐パターンを明示拒否。`playwright.config.ts:12` は `workers: 1`。Task 11 Files に当該ファイル無し → Phase 3 で tooling 即赤 or ピン緩化 |
| **Pri F5** expectedE2EInvocations 未追随 | **CONFIRMED** | **Important** | `local-development-scripts.test.mjs` L287–341 が mobile→reset→desktop と restore を argv 完全固定。smoke 1 段・setup 挿入・CI restore 短縮が Task Files/Step に落ちていない |
| **Adv I5** tooling ピン更新漏れ | **CONFIRMED** | **Important** | F4+F5 と同クラスタ。compose.test.mjs の文字列固定も一致 |
| **Pri F6** seed 必須条件不足 | **CONFIRMED** | **Important** | 現行 `completedOnboardingPage` は UI で member + privacy（`auth.ts` L57–71）。`acceptance.ts` は `privacy_consents` を required family に含む。Task 6 は「migrations を読む」に逃げ RED が薄い |
| **Adv I2** `privacyNoticeVersion` 未固定 | **CONFIRMED** | **Important** | `shared/contracts/domain.ts` L87: `privacyNoticeVersion = "2026-07-29.v1"`。旧 version は生成契約で拒否。Plan Task 6 に version 固定無し。F6 を具体化 |
| **Pri F9** Task 3 shell 疑似コード未完成 | **CONFIRMED** | **Important** | Plan L269–288: `set -- "$@"` no-op、`extra=`、`:` のみ枝、`build_playwright_args` コメント。self-review L763「Placeholder なし」と矛盾 |
| **Adv M3** build_playwright_args 未完成 | **CONFIRMED** | **Important**（F9 に統合） | 同上。Minor 表記は過小（shell 契約の中核） |
| **Pri F10** 並列 flaky ベクトル未閉鎖 | **CONFIRMED** | **Important** | Task 12 方式未選択、@serial 対象薄い、retries CI 2 との緊張。Phase 3 完了条件の前提が弱い |
| **Adv I4** magic-link 成功 path 縮小 | **CONFIRMED** | **Important** | 現行 `authenticatedPage` が毎回 Mailpit。高速化後は setup 1 回 + 少数 ephemeral に縮む。smoke/full に成功 path 固定が要る |
| **Adv I1** smoke が matrix e2e 所有を薄い | **CONFIRMED** | **Critical**（C1 の中身） | pantry / history-regen / account-deletion が full 専用。C1 の修正選択肢に吸収 |
| **Adv I6** GLOBAL limit 500 = product max | **PARTIAL** | **Important**（residual） | `GLOBAL_DAILY_AI_LIMIT_PRODUCT_MAX=500`、preflight は 501 拒否。推奨 500 は「余裕ゼロ」だが、suite 開始 reset + 見積コメントで緩和可能。Critical ではない |
| **Adv I8** Phase 順序・SKIP_RECREATE fail-closed | **CONFIRMED** | **Important** | Task 13 まで後回し。CI+SKIP_RECREATE exit 2 の早期 tooling 化は妥当。C2 とセットで Phase 3 ゲート |
| **Pri F11** docs 地図に smoke 未掲載 | **CONFIRMED** | **Minor** | 発見性。release-checklist は full `./scripts/run-e2e.sh` 維持で機能上正しい |
| **Pri F12** installProjectFilter 型 | **CONFIRMED** | **Minor** | type-only import のノイズ。F2 で config 集約なら消滅 |
| **Pri F13** Phase 1 full ≤22 分 | **CONFIRMED** | **Minor** | 目安管理。完了条件は「短縮 or 説明」逃げあり |
| **Adv M2** desktop a11y / 916 | **CONFIRMED** | **Minor** | 重複排除が主。Critical ではない |
| **Adv M4** storageState コミット事故 | **CONFIRMED** | **Minor** | `.gitignore` 方針は正しい。tracked 検知は I3 に含めれば足りる |
| **Adv #7** 0 smoke exit 0 | **CONFIRMED（反証）** | n/a | lock `@playwright/test@1.61.1`。repo に `pass-with-no-tests` 無し。0 件は非 0 exit が既定。false green 本命は薄いセット（F3） |
| **Adv #6** @mobile-only で desktop レイアウト沈黙 | **CONFIRMED（概ね反証）** | Minor residual | mobile-a11y は viewport ループ。generation が 916 を別途保持する記述は妥当 |
| **Adv #10** acceptance `${String(width)}` verify 破壊 | **CONFIRMED（反証）** | n/a | verify はソース部分一致。runtime 幅制限で title 文字列は壊れない |
| **Adv #11** run-e2e lock vs 1 wrapper 内並列 | **CONFIRMED（反証）** | n/a | lock は wrapper 多重禁止。workers/2 段は想定内 |
| **Adv #13** compose.e2e が GLOBAL limit を載せられない | **CONFIRMED（反証）** | n/a | 既存 force-recreate + e2e env 上書き経路で `GLOBAL_DAILY_AI_LIMIT` 追加は可能。現状 e2e にキー無しは Task 9 前提で正しい |
| **Adv #3** E2E limit 500 で製品 20 が見えない | **PARTIAL** | Important residual | 現状も E2E は truncate で 20 到達を避けている。MVP #17 は unit/pgTAP 所有。新規に「20 証明を捨てる」わけではないが、docs で明示すべき residual |
| **Adv #2** seed が onboarding UI を空洞化 | **PARTIAL** | Important | Spec は onboarding/full-journey household を UI 所有に残す。I2/F6 の seed 品質問題が実害の中心 |
| **Adv #5** Admin 注入で PKCE E2E 空洞化 | **PARTIAL** | Important residual | oauth-mock / auth-callback は raw test で維持予定。成功 magic-link の回数減は I4 |
| **Adv #9** SKIP_RECREATE が CI で有効 | **PARTIAL** | Important | Plan は禁止。実装漏れで成立し得る（I8） |
| **Adv #12** tooling ピン | **CONFIRMED** | Important | I5/F4/F5 と同一 |
| **Adv #14** filter が素の test に効かない | **CONFIRMED** | Important（F2） | 現状 @mobile-only を foundation に付けなければ実害小 |
| **Pri カバレッジ表 Task 4** ゲート順 OK | **CONFIRMED** | n/a positive | `./scripts/run-e2e.sh` 残存なら `extractSharedCiGateOrder` と両立。正しい |
| **製品 limit 不変方針** | **CONFIRMED** positive | n/a | compose.yaml=20、compose.e2e のみ 500 は契約整合 |

---

## Merged must-fix before implement (deduplicated)

優先度順。Critical / Important のみ。

### Critical（実装・Phase ゲート前に必須）

1. **C1 / F8 / I1 — PR マージ判定と full/受け入れ E2E の関係を設計で閉じる**  
   - 現状: PR=smoke、full は main **push 後**のみ。branch protection 文書・設定は repo に無い。  
   - いずれか **1 つを Spec に固定**し、Plan Task 4/5 に落とす:  
     - **(A)** PR でも full（smoke はローカル/任意）  
     - **(B)** 拡張 smoke（最低: pantry 1 + history-regen 1。account-deletion は重いなら full + staging-evidence 正式移管を matrix Notes に書く）  
     - **(C)** 人間 sign-off: 「PR smoke のみで merge 可。main 事後 red の revert SLA / required 運用」を Spec §5.3・§9・`docs/local-development.md` に明記し、GitHub の required status が **PR verify のみ**である前提を隠さない  
   - 「push に full を残す」だけでは **BLOCK 解除条件を満たさない**（敵対的修正要求を採用）。

2. **C2 / 関連 I5・I8 — workers と per-test global truncate の fail-closed 結合**  
   - Task 10 完了前に workers>1 を入れない技術ゲート:  
     - tooling/grep: `resetGlobalAiQuotaForE2e` / `ensureAiQuotaForGeneration` の test 本体・fixture 入口呼び出しが suite/shell 境界以外 0  
     - Task 11 Files に `tests/tooling/project-config.test.mjs` と上記 grep テストを必須列挙  
   - Phase 3 を 1 PR にまとめるか、workers 変更 PR で truncate 残存なら fail。

### Important（Phase 着手前に Spec/Plan 改訂）

3. **F1 / I3 — setup 実行モデルを 1 方式に収束**  
   - 推奨固定: full は shell 二段維持中、`run-e2e.sh` が `--project=setup` を **1 回だけ** → mobile → reset → desktop。mobile/desktop から `dependencies` **削除**。  
   - Spec §6.3 を書き換え、Task 7 概形から `dependencies: ["setup"]` を消す。  
   - `expectedE2EInvocations` に setup 段を必須反映（F5）。  
   - smoke 時: setup 1 回 or ephemeral のみ、を 1 行で固定。  
   - `@ephemeral-auth` 必須ファイル allowlist の静的テスト。

4. **F2 / I7 — project skip の単一入口**  
   - 推奨: config の `grepInvert`（mobile: `@desktop-only`、desktop: `@mobile-only`）、または全 spec を共通 base `test` に寄せ + raw import 禁止 tooling。  
   - `installProjectFilter` 採用なら auth / history / shopping / acceptance **全 export** + raw 3 ファイル移行を Task 1 必須チェックリスト化（「確認する」禁止）。

5. **F3 / M1 — smoke セット機械的固定**  
   - `e2e-smoke-tags.test.mjs` で Spec §4.2 の **必須ファイル × 最低本数**（または exact title）。任意を削除。  
   - 可能なら smoke 実行予定件数下限（例 ≥12）fail-closed。

6. **F9 / M3 / F5（smoke 分岐）— Task 3 を実装可能 shell に書き切る**  
   - `build_playwright_args` 完成形、`--grep=@smoke` 形式固定、不正 suite exit 2、smoke 1 段 / full 2 段 / 明示 `--project`・`--grep` 優先を tooling ゴールデン化。  
   - Plan self-review「Placeholder なし」を撤回するか残プレースホルダ一覧を末尾に置く。

7. **F4 — Task 11 に project-config 契約更新**  
   - `workers: 1` ピンを「定数 2（または許可集合）+ 調査なし CI 分岐禁止」の新契約へ。`fullyParallel: true` も同様。

8. **F6 / I2 — seed 契約の固定**  
   - 参照: `acceptance.ts` admin、`profiles.onboarding_status`、`household_members` ≥1、`privacy_consents.notice_version = privacyNoticeVersion`（`2026-07-29.v1`）。  
   - seed 後 planner 滞在・welcome 非リダイレクトの RED。service key を page に渡さない。UI onboarding owning は seed 不使用をチェックリスト化。

9. **F7 / I6 — Phase 3 リスク表と成功指標の分解**  
   - Spec §9 に global usage **行ロック直列化**を追加。  
   - 成功指標を「workers≥2 full green」と「生成系 serial / UI 並列で短縮」に分解。≤10 分未達時の主因候補に行ロックを明記。  
   - compose.e2e に「500 は製品 max 到達可能な ENV 値であり運用推奨 20 とは別」コメント。1 suite 最大外部送信 × safety factor を数値コメント。

10. **F10 / I4 — 認証高速化方式と serial / magic-link 成功 path**  
    - Task 12 を Phase 3 前半で **1 方式固定**（推奨: Admin generateLink）。  
    - `@serial` 候補ファイル一覧（shopping-list-races、同一 storageState describe、history-safety 相互依存）。  
    - Mailpit 成功 path を `@smoke` または full 固定で最低 1 本。

11. **I8 — SKIP_RECREATE と CI 同時禁止を早期に**  
    - 導入 Task と同時に exit 2 + tooling。Task 13 まで遅延しない。

### Phase 1 のみ先行する場合の最小セット

C1 解決（または人間 sign-off）+ **F2, F3, F9, F5（smoke 分岐）** + Task 4 後の「PR smoke ≠ acceptance 全量」docs 1 行。  
F1/F6 は Phase 2 前、C2/F4/F7/F10 は Phase 3 前。

---

## Safe to defer (Minor / residual with sign-off)

| 項目 | 条件 |
| --- | --- |
| F11 docs/README 索引に smoke 括弧追記 | Phase 1 docs と同時でよいがブロッカーではない |
| F12 filter 型 import | F2 方針決定後 |
| F13 Phase 1 full ≤22 を stretch 明記 | 期待値管理のみ |
| M2 desktop 固有 CSS / `@desktop-only` 将来 | 追加回帰が必要になったとき |
| M4 storageState tracked 検知 | I3 実装時に同梱可 |
| Adv #3 quota theater residual | MVP #17 unit/pgTAP 所有の再確認 + docs「local 20 / E2E 500」を sign-off |
| Adv residual: account-deletion / billing を smoke 外 | C1 選択肢とセットで人間承認 |
| Adv residual: workers=2 flaky 残差 | Phase 3「2 連続 green」+ 原因調査基準 |
| Adv residual: CI cleanup で restore 省略 | GHA `down --volumes` 前提を docs 明記（Task 13） |
| I6 500=max の余裕 | 見積コメントと suite reset で運用。max 自体は触らない |

---

## Final recommendation

**REVISE_SPEC_PLAN**

続けて:

1. **即時:** Spec/Plan を改訂し、Critical C1・C2 と Important F1/F2/F3/F9/F5 を文書と Task Files/Step に反映。  
2. **C1 が (C) sign-off の場合のみ:** 人間の明示承認を Spec に記録したうえで  
   **IMPLEMENT_PHASE1_ONLY_AFTER**  
   - F2（filter 単一入口）  
   - F3（smoke 必須セット固定）  
   - F9 + smoke 用 expectedE2EInvocations / compose ゴールデン  
   - docs に「PR green ≠ acceptance 全量 / merge 前提」  
3. **Phase 2:** F1 setup 単一モデル + F6/I2 seed 契約を閉じてから Task 6–8。  
4. **Phase 3:** C2 fail-closed + F4 project-config + F7 リスク分解 + F10/I4 方式固定の後に Task 9–13。

**IMPLEMENT_ALL_AS_IS は不可。**  
製品契約（compose.yaml=20、preflight、privacy assert、acceptance title）を壊す Critical は見当たらないが、**CI ゲート形骸化（C1）と並列枠破壊（C2）** はこのまま Task 実行に入ると agentic 実装で再現しやすい。

1次の **REVISE** と敵対的の **BLOCK_WITH_CONDITIONS** は整合する。2次は敵対的の Critical 2 件を採用し、1次 Important 群を dedupe したうえで Phase 分割実装を認める。

SECONDARY_REVIEW_COMPLETE
