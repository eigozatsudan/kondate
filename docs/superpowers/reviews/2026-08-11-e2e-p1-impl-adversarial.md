# 敵対的レビュー: Phase 1 E2E 短縮 実装

**対象:** commits `f3f27c5..5c68150`（package 表記は `891431e..5c68150`）  
**照合:** `/tmp/grok-1000/e2e-p1-impl-review-554fd0e9/` + live `/home/dev/projects/kondate`（read-only）  
**姿勢:** 著者は green CI を欲する前提。false green、smoke/full 切替破綻、弱いタグガード、CI 式、shell `set --`、PR merge 時の穴を優先して突く。

---

## Summary

Phase 1 の **CI 本線**（PR=`smoke` / push=`full`、`run-e2e.sh` の suite 分岐、Spec §4.2 へのタグ付与、account-deletion 非 smoke、config `grepInvert` の極性）は **意図どおり動く**。攻撃チェックリストの「PR が full のまま」「smoke が desktop 二段」「account-deletion が smoke」「grepInvert 逆付け」「空タグで全件 or 0 件 exit 0」は **現行実装では反証**できる。

一方、**機械ガードは「最低本数」の文字通りを満たすだけで、タイトル固定・distinct test 数・grepInvert 極性を fail-closed にできていない**。また docs の 1 ファイル起動形 `./scripts/run-e2e.sh -- …` は wrapper が `--` を strip しない **既知 residual** のまま文書化されている。

**Critical な切替バグは見つからなかった。** 現状マージを止める実装欠陥は無く、弱い静的ガードと運用 residual を残した **PASS_WITH_RESIDUALS**。

---

## Attack scenarios (validated / refuted)

| # | 攻撃 | 判定 | 根拠 |
| --- | --- | --- | --- |
| 1 | `KONDATE_E2E_SUITE=smoke` でタグ空 / 誤 grep 形 → 全件 or 0 件 green | **反証（本線）** | smoke 時は `set -- --project=mobile-chromium "$@"` の後 `set -- "$@" --grep=@smoke`（`scripts/run-e2e.sh` L424–433）。`pass-with-no-tests` 無し（`playwright.config.ts`）。0 件は非 0 exit（設計レビューでも lock 1.61 系で確認済み）。全件誤実行は `@smoke` 未付与時に **空振り red** 方向。 |
| 2 | `e2e_args_have_grep` / `e2e_args_have_project` の誤検知（file path に `--grep` 等） | **低リスク residual** | case は **完全一致** `--project` / `--grep` / `-g` と **接頭** `--project=*` / `--grep=*` のみ。通常の `e2e/specs/*.spec.ts` では誤検知しない。`--grepInvert` は `--grep=*` に **一致しない**（`=` 無し）。`-g` 単独は値無しでも has_grep=true になり `@smoke` 付与を抑止し得る（開発者誤用）。 |
| 3 | GHA `pull_request && 'smoke' \|\| 'full'` が workflow_dispatch / 逆極性 | **反証（現行 workflow）** | `on:` は `pull_request` と `push: branches: [main]` のみ（`ci.yml` L3–6）。式は PR→`'smoke'`、push→`'full'`。中間値 `'smoke'` は truthy なので `&&`/`\|\|` 落とし穴に当たらない。`workflow_dispatch` は未定義。`project-config.test.mjs` が式を正規表現固定。 |
| 4 | smoke セットが Spec §4.2 必須 title を欠く | **現行は充足 / ガードは弱い** | 実タグは表と一致（#9 pantry CRUD、#13 duplicate success、oauth 2、full-journey 2、cancel+expired、same-browser、connectionreset+result details、protected rows、idempotency、auto revalidate、onboarding、settings member CRUD、320 household a11y）。**ただし** tooling は title を見ない（Findings I1）。 |
| 5 | `grepInvert` 極性逆転 | **実装は正しい / テストは弱い** | `mobile-chromium` → `/@desktop-only/`、`desktop-chromium` → `/@mobile-only/`（`playwright.config.ts` L24–35）。`project-config` の `[\s\S]*?` は **project 境界を跨いで逆極性でも match し得る**（Findings I2）。 |
| 6 | `expectedE2EInvocations` が shell と乖離してテストだけ green | **反証（本線）** | smoke: playwright 1 回・中間 quota reset なし・`--grep=@smoke` 付与。full: mobile→reset→desktop。`local-development-scripts.test.mjs` が mock docker の argv を deepEqual。caller の `--project`/`--grep` 二重付与抑止も別テストあり。 |
| 7 | `./scripts/run-e2e.sh -- e2e/specs/foo.spec.ts` が壊れる | **成立（既知 residual）** | wrapper は `--` を strip しない。entrypoint は `npx playwright test` + 末尾 argv。docs は `--` 付きを推奨（`docs/local-development.md` L74）。`--` 以降の `--project`/`--grep` が option として解釈されないリスク（Findings I3）。 |
| 8 | account-deletion が誤って `@smoke` | **反証** | `e2e/specs/account-deletion.spec.ts` / `billing-plus.spec.ts` に `@smoke` 無し。`e2e-smoke-tags.test.mjs` が count=0 を固定。 |
| 9 | CI が PR=full または push=smoke | **反証** | 上記式 + `ci.sh` は `KONDATE_E2E_SUITE="${KONDATE_E2E_SUITE:-full}"`（release 既定 full）。 |
| 10 | smoke で `--project` 二重注入 | **反証** | has_project 時は project を足さない。full の 2 段は **別プロセス各 1 project**（二重ではなく意図的二段）。 |
| 11 | PR green だけで full 未通過を merge（coverage 穴） | **成立（設計受容 residual）** | Spec §5.3 / docs 注意文どおり。account-deletion・billing 全量・a11y 全幅・race 大半は full/push 依存。Phase 1 は #9/#13 を smoke に入れて C1 を縮小済み。 |

---

## Findings

### Critical

（なし — CI 本線の smoke/full 切替・必須タグの現行付与・account-deletion 除外・grepInvert 実装極性に、再現確実な破壊的欠陥は確認できなかった。）

---

### Important

#### I1. `@smoke` ガードが「リテラル出現回数」であり、distinct test / exact title を固定しない

- **信頼度:** 90  
- **箇所:** `tests/tooling/e2e-smoke-tags.test.mjs` L10–48  
- **攻撃:**  
  1. 必須ファイル内で `tag: ["@smoke", "@smoke"]` を 1 test に付ける → min=2 を **1 本**で満たす  
  2. コメントや無関係文字列に `"@smoke"` を並べて count を水増し  
  3. Spec の title（例: MVP #13 `does not consume a success for duplicate output`）を外し、軽い別 test にだけ `@smoke` を付ける  
- **結果:** tooling と PR smoke は green のまま、§4.2 の意図パスが PR から消える（false green merge）。  
- **現行:** 実ソースの title は表と一致しており **今は穴が開いていない**。穴は **将来の意図的/事故的ドリフト**。  
- **修正案:**  
  - test 定義単位で `tag` 配列内の `@smoke` を数える（1 test 内の重複は 1）  
  - 可能なら required **exact title** リストを assert  
  - 少なくとも `tag:\s*\[[^\]]*"@smoke"` の test 件数 ≥ min

#### I2. `grepInvert` 極性テストが project 境界を跨いで false green し得る

- **信頼度:** 88  
- **箇所:** `tests/tooling/project-config.test.mjs` L159–168  
- **攻撃:** mobile に `/@mobile-only/`、desktop に `/@desktop-only/` と **逆転**しても、  
  `name: "mobile-chromium"[\s\S]*?grepInvert: /@desktop-only/` が desktop 側の定義まで伸びて match する。  
- **結果:** a11y が desktop で再実行され Phase 1 の主短縮が消え、または mobile から a11y が消える、を tooling が検知しない。  
- **現行 config は正しい。**  
- **修正案:** project ブロック単位でパースするか、mobile ブロック直後の `grepInvert` が desktop-only であることを非跨ぎ正規表現 / AST で固定。

#### I3. docs の 1 ファイル起動が `--` 付きで、option が playwright に届かない residual

- **信頼度:** 90  
- **箇所:** `docs/local-development.md` L74; `scripts/run-e2e.sh`（`--` strip 無し）; `compose.yaml` e2e entrypoint  
- **攻撃 / 誤用:**  
  `./scripts/run-e2e.sh -- e2e/specs/foo.spec.ts --project=mobile-chromium`  
  や smoke 併用時に `--` の後へ `--grep=@smoke` が回ると、CLI によっては **file filter だけ / option 無視 / 0 件**。  
- **CI 本線は無引数なので非影響。** 開発者焦点実行と docs が嘘を教える。  
- **修正案:** wrapper 先頭で `--` を 1 個 strip する、または docs を  
  `./scripts/run-e2e.sh e2e/specs/foo.spec.ts --project=mobile-chromium` に直し tooling でその形を固定。

#### I4. `@mobile-only` ガードが「≥1」のみで、幅マトリクス全件を強制しない

- **信頼度:** 85  
- **箇所:** `e2e-smoke-tags.test.mjs` L63–69; `mobile-accessibility.spec.ts`（現行は各 test に付与済み）  
- **攻撃:** 1 本だけ `@mobile-only` を残し他を外す → desktop で a11y 二重実行が復活しても tooling green。  
- **修正案:** ソース上の `test(` 数と `@mobile-only` 付与数の一致、または幅ループ内 5 シナリオすべてに tag があることを固定。

#### I5. PR smoke ≠ acceptance 全量（設計どおりの merge-time 穴）

- **信頼度:** 95（設計受容）  
- **箇所:** Spec §5.3; `ci.yml` L84–86; docs 注意文  
- **内容:** account-deletion / billing-plus / a11y 全幅 / race 大半は PR で走らない。full は main push の **事後検知**。  
- **Phase 1 緩和:** #9/#13 を smoke に入れ済み。docs に「PR smoke は全量代替ではない」と明記済み。  
- **残る条件:** branch protection / merge queue で push full を必須にするかは **repo 外運用**。実装欠陥ではなく residual。

---

### Minor

#### M1. caller が任意 `--grep` を付けると smoke でも `@smoke` を付けない

- **信頼度:** 80  
- **意図的**（明示引数優先）。CI は無引数。開発者が `KONDATE_E2E_SUITE=smoke --grep=foo` とすると「smoke」名と実フィルタが乖離。docs に 1 行あるとよい。

#### M2. `e2e_args_have_grep` が `-g=pattern` を検知しない

- **信頼度:** 75（参考）  
- Playwright が受けても has_grep=false → `--grep=@smoke` が追加され二重 grep になり得る。実害は稀。

#### M3. compose.test の suite 検証が文字列ピン中心

- **信頼度:** 80  
- smoke が desktop 二段を踏まないことの **実行論証**は `local-development-scripts` 側。compose 側だけ見ると弱いが、二重に固定されているので Minor。

---

## Checklist 結果（要約）

| 項目 | 結果 |
| --- | --- |
| 1 smoke 空タグ / 誤 grep | 本線 OK（0 件は red、`--grep=@smoke` 付与） |
| 2 e2e_args_have_* エッジ | 本線 OK / 極端 path は residual |
| 3 GHA 式 | PR smoke / push full で正しい |
| 4 §4.2 titles | **現行ソースは一致** / ガードは title 非固定 |
| 5 grepInvert 極性 | **実装 OK** / テスト弱い |
| 6 expectedE2EInvocations | shell と一致（mock 実行で固定） |
| 7 `--` file filter | **既知 residual（docs が推奨形）** |
| 8 account-deletion smoke | 無し（ガードあり） |
| 9 CI PR/push 逆 | 無し |
| 10 二重 --project | smoke 本線で無し |

---

## Verdict: **PASS_WITH_RESIDUALS**

**理由:**

- Phase 1 の成功条件（suite 切替、PR/push 分岐、§4.2 現行タグ、mobile-only 実装、tooling 緑の構造、docs 注意文）は **実装として満たしている**。  
- 敵対的に成立する **CI 本線の false green 切替バグ**は確認できず、BLOCK 相当の欠陥は無し。  
- 残るのは (I1)(I2)(I4) の **弱い静的ガード**、(I3) の docs/wrapper residual、(I5) の設計受容 merge 穴。いずれも「今すぐ切替が壊れている」ではなく **ドリフト耐性 / DX / 運用**。

**推奨フォロー（非ブロッカー、優先順）:**

1. smoke ガードを distinct test / exact title へ強化（I1）  
2. grepInvert 極性 assert を project 局所化（I2）  
3. docs から有害な `--` を除去、または wrapper で strip（I3）  
4. `@mobile-only` をマトリクス全件相当に固定（I4）

ADVERSARIAL_REVIEW_COMPLETE
