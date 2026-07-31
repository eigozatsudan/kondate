# 改訂案: `response_format` の root union 廃止と設計 §4.4.2 の合格単位変更

- 状態: **承認済み（2026-07-27・未実装）**。本書の実装順序に従って `shared/contracts` と設計書本文を改訂する。
- 対象設計書: `docs/archive/superpowers/specs/2026-07-26-paid-openrouter-models-design.md`（§4.4 shortlist / §4.4.2 / Key Decision 5）
- 実測根拠: `docs/archive/bugfix/2026-07-27-plan8-production-gate-evidence.md`
- 実測日: 2026-07-27 / worktree `.worktrees/plan8-paid-openrouter`

## 0. なぜ改訂が要るのか（測定事実）

| 事実 | 根拠 |
|------|------|
| 本番 `menuResponseFormat` は root が `oneOf`。OpenAI strict は root `oneOf` を許可せず **400** | `Invalid schema for response_format 'kondate_menu_generation': In context=(), 'oneOf' is not permitted.` |
| Gemini は同 schema を複雑度上限で **400** | `The specified schema produces a constraint that has too many states for serving.` |
| root を object 化した提案 wire schema (7644 bytes) は `openai/gpt-4.1-nano` / `openai/gpt-5-nano` で **200** | probe 実測 |
| 同 wire schema + **本番プロンプト** で gpt-4.1-nano は **2.2–2.5s** で schema 妥当な JSON を返す（20s 予算に対し十分速い） | probe 実測（5 試行） |
| 一部の mid/低価格帯 open model は 20s 予算内に応答できない（本番 `OPENROUTER_TIMEOUT_MS` も 20s なので本番でも timeout）。一方、llama-3.1-8b / gpt-oss-120b は 20s 内に初回応答したが意味検証で落ちた | 第1・第2ラウンド N=10 |
| 残る失敗は **意味整合**（pantry name/unit の逐語一致・ref 整合）であり、schema 適合ではない | probe: `pantry_name_mismatch` / `pantry_unit_mismatch` / `dangling_ref` |
| 本番 system prompt は「pantry の name/unit を逐語コピーせよ」と指示していないが、materializer は正規化後の完全一致を要求する | `generation-prompt.ts` L102-109/L191-198 と `generation-materializer.ts` L148/L241 |
| `generationRepairCodes` に無い validator コード（例: `servings_mismatch`）は `invalid_provider_menu` に潰れ、**何を直せばよいか repair に伝わらない** | `generation-repair.ts` L93-107 |

要点: **候補モデルの問題ではなく、(1) wire schema の構造、(2) 合格単位の定義、(3) 診断コードの可観測性** の 3 点が Plan 8 のゲート通過を塞いでいる。

## 1. 改訂案 A — `response_format` の root union 廃止

### 現状

```ts
export const aiGenerationResponseSchema = z.discriminatedUnion("outcome", [
  z.object({ outcome: z.literal("success"), menu: aiGeneratedMenuPayloadSchema }).strict(),
  z.object({ outcome: z.literal("constraint_conflict"), conflicts: z.array(generationConflictSchema).min(1).max(12) }).strict(),
]);
const aiGenerationJsonSchema = z.toJSONSchema(aiGenerationResponseSchema, { target: "draft-2020-12" });
// → root: { oneOf: [ ... ] }
```

### 提案

**内部型 `aiGenerationResponseSchema`（discriminated union）は正本のまま変えない。**
provider に送る wire 表現だけを root object 化し、wire → 内部 union のアダプタを 1 本足す。

```ts
/** provider へ送る wire 表現（root object・strict structured outputs 互換） */
export const aiGenerationWireResponseSchema = z
  .object({
    outcome: z.enum(["success", "constraint_conflict"]),
    menu: aiGeneratedMenuPayloadSchema.nullable(),
    conflicts: z.array(generationConflictSchema).max(12).nullable(),
  })
  .strict()
  .refine(
    (value) =>
      value.outcome === "success"
        ? value.menu !== null && (value.conflicts === null || value.conflicts.length === 0)
        : value.conflicts !== null && value.conflicts.length >= 1 && value.menu === null,
    { message: "outcome_branch_mismatch" },
  );

/** wire → 既存 union。分岐不整合は fail-closed（既存の invalid 経路へ落とす） */
export function toAiGenerationResponse(wire: AiGenerationWireResponse): AiGenerationResponse;
```

- JSON Schema は `z.toJSONSchema(aiGenerationWireResponseSchema)` から生成し、`menuResponseFormat.json_schema.schema` に載せる。
  `refine` は JSON Schema に出ない（分岐整合は Zod 側で fail-closed に担保する）。
- `min(1)` は wire では表現しない（nullable 配列の最小長は strict 実装間で解釈差があるため）。**Zod 側 refine で 1 本以上を強制**する。
- `$schema` キーは wire schema から除去する（probe では root object 化と同時に外して 200 を確認済み。単独寄与は未切り分け）。

### 影響範囲

| 箇所 | 変更 |
|------|------|
| `shared/contracts/generation.ts` | wire schema + アダプタ追加。既存 union と `AiGenerationResponse` は不変 |
| `netlify/functions/_shared/openrouter.ts` | full_menu 経路を wire schema → adapter に変更し、20s を同期 parse 中も閉じる単調時計 guard を追加 |
| `netlify/functions/_shared/openrouter.test.ts` | 19,999ms / 20,000ms 境界、遅い JSON/schema/adapter、body failure 競合の契約を追加 |
| `tools/openrouter-mock/fixtures/menu-response-format.json` と mock 応答 | 新 wire 形へ追随（`openrouter-mock.test.ts` が正本ミラーを検証） |
| `scripts/benchmark-paid-openrouter-models.mjs` / `benchmark-app-response-gate.ts` | wire→union アダプタ経由に変更（ゲート条件そのものは不変） |
| `netlify/functions/_shared/generation-service.ts` / materializer / validator | **変更不要**（内部型が変わらないため） |
| `dishRegenerationAiOutputSchema`（replacement_dish） | **変更不要**（元から root object） |

### 非目標

- **Gemini 対応は本改訂の範囲外**。root object 化後 (7644 bytes) でも `too many states` で 400 のままであることを実測済み。
  Gemini を候補に入れるには schema 縮小という別作業が要る。本改訂で開くのは OpenAI 系。

### 検証済み / 未検証

- 検証済み: 提案 wire schema が gpt-4.1-nano / gpt-5-nano で 200。本番プロンプトとの組み合わせで 2.2–2.5s。
- **未検証: この改訂だけでは N=10 合格に至らない。** 残る失敗は意味整合（下記 B/C が要る）。
  `openai/gpt-5-nano` は `provider: { require_parameters: true }` 下で chat が 404（要件を満たす provider 無し）。
  `require_parameters` はロック維持のため、gpt-5-nano は候補から外れる。

## 2. 改訂案 B — 設計 §4.4.2 の合格単位を本番経路に合わせる

### 現行文の問題

現行 §4.4.2 は「残存候補 ID ごとに N=10 回 chat し、10 回すべて HTTP 200・20s 未満・materialize/validate 通過」を要求する。
これは **単一 ID による repair なしの初回一発**を要求している。しかし本番の 1 生成フローは
`generation-service.ts` で **primary + 必要時 repair の最大 2 外部送信**であり、初回の materialize/validate 失敗は
`kind: "invalid"` として repair に回る設計（設計 §5.2 が明記する「1 回の生成フローは最大 primary + repair の 2 外部送信」）。
さらに本番では初回の実応答モデルが分かる場合、そのモデルを repair の送信候補から除外する。したがって合否は個別 ID
ではなく、実際に ship する **exact な順序付き `OPENROUTER_MODELS` 構成**に対して判定しなければならない。

### 改訂案（差し替え文）

> #### 4.4.2 レイテンシ/形状ゲート
>
> §4.4.1 を通過した ID から、ship 候補となる **1～2 ID の exact な順序付き
> `OPENROUTER_MODELS` 構成**を作る。構成ごとに、実 `menuResponseFormat`・
> **本番 `buildGenerationMessages` が非 PII の固定入力から生成するプロンプト**・
> `require_parameters: true` で **N = 10 単位**を実行する。配列の要素と順序が異なる構成の結果を流用してはならない。
>
> **1 単位 = production service harness を通した本番 1 生成フロー**とする。harness は
> `runGeneration` 相当の単調時計、pre-send guard、repository の
> `markSent` / `reserveRepair` / finalize 遷移を含める:
>
> harness は本番 DB / 本番 quota ledger へ書き込まない。`markSent` / `reserveRepair` / finalize の
> 本番と同じ遷移意味論を実装した隔離 in-memory/test repository を使い、**各単位の開始時に fresh ledger
> へ初期化**する。1 単位内では成功 3 / attempt 6 / global 20 の判定意味論を維持する一方、構成間・単位間で
> 日次カウンタを累積させない。これにより quota 拒否をモデル品質 FAIL に混入させない。このベンチ上の隔離は
> 証跡採取方法だけの規定であり、本番の 3 / 6 / 20 ロックは変更しない。
>
> - primary は当該 exact 構成の配列を `models` として 1 回送る。`composeCandidate` が
>   `kind: "valid"` なら finalize し、単位成功とする。`kind: "conflict"` は
>   `constraint_conflict` で終端し、repair しない。
> - body / transport failure は次の優先順位で分類する。Abort/deadline が成立している場合、または最終の
>   単調時計 elapsed が `timeoutMs` 以上の場合は、他の検出済みエラーより
>   `OpenRouterCallError("generation_timeout")` を優先し、repair しない。byte cap 検出後の
>   `reader.cancel()` 待機中に Abort した競合も `generation_timeout` とする。
> - timeout が成立していない場合に限り、次の初回失敗を repair 適格とする:
>   - HTTP 200 応答の body が byte cap を超えた場合、および JSON / response envelope schema /
>     wire schema / wire→内部 adapter が不正な場合の
>     `OpenRouterCallError("invalid_ai_response")`
>   - materializer / validator の失敗を含む `composeCandidate(...).kind === "invalid"`
> - raw envelope から取得できた `model` が当該送信の `models` 配列外なら
>   `model_unavailable` とし、repair しない。この判定を response envelope schema 検査より先に行うため、
>   response envelope schema が不正でも取得済み `model` が送信外なら `invalid_ai_response` ではなく
>   `model_unavailable` とする。
> - timeout が成立していない場合に限り、非 2xx、fetch の transport 失敗、
>   Abort 以外の body stream 読取失敗、上記モデル不一致は `model_unavailable` とする。
>   `generation_timeout` / `model_unavailable` / `constraint_conflict` は repair しない。
> - repair 適格でも外部 repair 送信は最大 1 回とする。初回の実応答モデルが既知なら、
>   exact 構成からその ID を除外した順序付き配列を repair の `models` とする。
>   除外後にモデルが残らなければ repair を送らず単位失敗とする。初回の実応答モデルが不明なら、
>   本番どおり除外せず exact 構成を repair の `models` とする。repair 後の invalid / conflict /
>   call error は再 repair せず、単位失敗とする。
>
> 合格条件（すべて必須・緩和禁止）:
>
> - 各送信の 20s 境界は、本番 `sendMenuGeneration` と同じく **`AbortController` を作成して
>   `setTimeout` を開始した時点から、body 読取、JSON / response envelope / model 検査、
>   wire parse、adapter を完了し、`finally` で timer を解除するまで**とする。timer 開始後の
>   response format 選択など、fetch 前の処理も含める。各送信は HTTP 200 かつこのクライアント計測で
>   20s 未満でなければならない。materialize / validate は 20s 境界に含めない。
> - Abort timer だけに依存しない。timer 開始時刻を単調時計で記録し、body / JSON / response envelope /
>   model / wire / adapter の処理完了直後かつ成功 return 前に最終 elapsed を検査する。
>   `elapsed >= timeoutMs` なら `OpenRouterCallError("generation_timeout")` として fail-closed にする。
>   同期 JSON/schema/adapter 処理中に Abort callback が発火できず、その後 `finally` が timer を解除する場合も
>   超過を合格させない。この契約は本番 `openrouter.ts` と production service harness の双方に実装する。
>   19,999ms は境界内、20,000ms は失敗とし、遅い JSON/schema/adapter と
>   byte cap 検出後の `reader.cancel()` 待機中 Abort の競合をテストする。
> - 50s 境界は handler の `requestStartedAt` から始め、context load、preflight、ledger、
>   primary / repair、materialize / validate、finalize までを含める。単位は
>   `FUNCTION_TOTAL_BUDGET_MS = 50,000` 内に終端しなければならない。
> - primary と repair の**各送信前**に、本番と同じ
>   `REQUIRED_SEND_BUDGET_MS = 22,000`（20s + `FINALIZE_RESERVE_MS = 2,000`）以上の残予算を要求する。
> - `envelope.model` は、その送信で実際に渡した `models` 配列に含まれなければならない。
> - 本番と同形の response schema + `aiGenerationResponseSchema`（wire 経由の場合はアダプタ適用後）
> - `materializeAiGeneratedMenu` + `validateGeneratedMenu` 成功
> - **10 単位すべて成功**
>
> 単なる fetch 2 回の elapsed 合計では合格にしない。証跡には、評価した exact 構成の配列順序、
> 単位内の各送信で渡した `models` 配列、各実応答モデル、除外モデル、初回成功 / repair 後成功 /
> 失敗の別、失敗コードを残す。**N=10 を通過した exact 構成だけ**を、その順序のまま
> `OPENROUTER_MODELS` へ提案する。

### §4.4 shortlist / Key Decision 5 の改訂対象

今回の再ベンチで承認対象とする exact shortlist は次の 3 ID とし、設計 §4.4 の候補一覧、
§12 Key Decision 5、`scripts/benchmark-paid-openrouter-models.mjs` の `candidateModelIds` を同じ集合へ改訂する。

1. `openai/gpt-4.1-nano`
2. `meta-llama/llama-3.1-8b-instruct`
3. `openai/gpt-oss-120b`

`openai/gpt-5-nano` は `require_parameters: true` 下で要件を満たす provider がなく 404、
Gemini 系は schema 複雑度上限、実測で 20s を超えたその他のモデルは固定時間予算を満たさないため除外する。
少なくとも次の exact な順序付き構成を、それぞれ独立した N=10 の対象にする。

1. `["openai/gpt-4.1-nano"]`
2. `["openai/gpt-4.1-nano", "meta-llama/llama-3.1-8b-instruct"]`
3. `["openai/gpt-4.1-nano", "openai/gpt-oss-120b"]`

単体 ID の合否を後から組み合わせたり、個別合格 ID から最大 2 本を選んだりしてはならない。
合格した exact 構成だけが、その順序を維持した `OPENROUTER_MODELS` の提案候補になる。

### 変更しないもの（明示）

20s/送信・50s/単位・180s、成功 3 / attempt 6 / global 20、structured_outputs **AND** response_format、
単価上限は当時 $0.50/1M（**R3 で改訂。現行 P*=$4.00/1M**）、router 禁止、exact mock 例外、privacy `2026-07-26.v1`、推奨は最大 2 本 — 単価以外は不変。

本改訂は「1 試行」の定義と合格単位を本番フローに一致させるだけで、時間予算・クォータ・許可規則のいずれも緩めない。
なお §5.2 の帰結（成功 3 回を毎回 repair 込みで達成すると attempt 6 をちょうど使い切る）は変わらないため、
repair 前提のモデルを選ぶと利用者の実効成功回数が減る。**証跡には初回成功率も必ず残す**こと（選定材料）。

## 3. 改訂案 C — repair 診断コードの可観測性（B の前提）

`toRepairDiagnostics` は `generationRepairCodes` に無いコードを `invalid_provider_menu` に潰す。
実測では prompt を変えた途端に全試行が `invalid_provider_menu` になり、**どの検査で落ちたか特定できなくなった**。
この状態では B の repair 単位を導入しても「何を直せば通るのか」が測定不能。

提案:

1. materializer の `outputError(...)` は既に引数が `GenerationRepairCode` 型であり、閉じた
   `generationRepairCodes` の外を返せない。この型制約を維持し、列挙との包含関係を型/テストで固定する。
2. validator の `MenuValidationIssue.code` は現在の `string` ではなく、閉じた列挙または union を正本にする。
   その**全コード**が `generationRepairCodes` に包含されることを型/テストで必須化する。現存する
   `servings_mismatch` を `generationRepairCodes` に追加し、repair 診断の path は `menu.servings` とする。
3. `netlify/functions/_shared/benchmark-app-response-gate.ts` は validator 失敗を固定文字列
   `validate_generated_menu_fail` に潰さず、`validation.issues[].code` **だけ**を raw code として
   ベンチ証跡へ渡す。そのテストも同じ契約へ更新する。
4. raw code は上記の内部閉集合に属するコードだけとする。path / message / prompt / 生 AI 出力は
   raw 証跡に保存せず、未知値を自由文字列として保存する経路も作らない。本番ログ・永続化は現状どおり
   コードのみとし、privacy 制約は変えない。

### C の影響範囲

| 箇所 | 変更 |
|------|------|
| `shared/contracts/generation.ts` | `MenuValidationIssue.code` の閉じた列挙/union を正本化 |
| `shared/safety/validate-generated-menu.ts` とテスト | validator が正本コードを返すこと、`servings_mismatch` / `menu.servings` を固定 |
| `netlify/functions/_shared/generation-repair.ts` とテスト | validator 全コードを `generationRepairCodes` に包含し、診断 path を固定 |
| `netlify/functions/_shared/benchmark-app-response-gate.ts` / `benchmark-app-response-gate.test.ts` | `validation.issues[].code` だけを raw code として証跡へ渡す |

## 4. 付随論点（本改訂では決めない）

本番 system prompt は pantry の `name`/`unit` 逐語一致を要求していないのに materializer は要求する。
逐語コピーを促す追加指示を probe で試したが、単独では合格に至らず失敗コードが `invalid_provider_menu` に
潰れて評価不能だった。**C を入れて可観測性を得た後に、別途プロンプト改訂として扱う**のが順序として正しい。

## 5. 実装順序（提案）

| 段 | 内容 | ゲート |
|----|------|--------|
| 1 | C: materializer/validator の診断コード網羅性 + ベンチ証跡の閉じた raw code 保持 | 既存 unit/pgTAP + `node --test` 緑 |
| 2 | A: wire schema + アダプタ + mock fixture + openrouter.ts 差し替え、単調時計 guard 追加 | 既存テスト・E2E 緑、19,999/20,000ms・遅い parse/adapter・byte-cap/Abort 競合テスト緑 |
| 3 | B: §4.4.2、§4.4 shortlist、Key Decision 5 を差し替え、`candidateModelIds` とベンチを構成単位の production service harness へ変更 | harness の同じ単調時計境界・失敗 precedence を含むベンチ自己テスト緑 |
| 4 | exact 3-ID shortlist から上記 3 構成を再ベンチ | N=10 を通過した exact 構成 ≥1 → その順序のまま本番提案 |

各段は既存の per-Task workflow（RED → GREEN → 検証 → レビュー → 日本語 Conventional Commit）に従う。

## 6. 残リスク

- **合格構成はまだ実証できていない。** A だけでは通らないことは実測済み、B+C 後に通る保証はない。
  4 段目で 0 構成なら、次は単価上限（§4.1.7）または候補帯そのものの見直しに戻る。
- A は `shared/contracts` の locked interface に触る。内部型を変えない設計にしているが、
  mock fixture・E2E・contract テストに広く波及する。
- Gemini 系は本改訂後も候補にできない（schema 複雑度）。
