# 献立ひねり軸 — R-01 クロージャ敵対的レビュー (a2a7a4fb)

- 日付: 2026-08-31
- 対象: `docs/superpowers/specs/2026-08-31-menu-novelty-axis-design.md`（commit `a2a7a4fb`）
- 実施者: 読み取り専用 Reviewer（R-01 閉じを攻撃。製品コード・仕様は編集しない）
- 判定: **APPROVE — Critical 0 件、Important 0 件、Minor 1 件**

直前の計画ブロッカーは R-01 のみだった。改訂は §8 を「契約・migration・サーバー読み取り面を
単一 commit」に固定し、§3.3 に `.strict()` / `parse(data: unknown)` を書き、§7 に
`mapSnapshot` → `PlannerSubmission` round-trip を必須化した。仕様どおり進めると
**typecheck 緑の中間 commit で全 new_menu が 422 になる経路は残らない。**

---

## 1. Verdict

R-01 は閉じた。旧 §8 の「1. migration / 2. 契約 / 3. mapSnapshot（1 と同じ Task）」という
番号リストは消え、契約を 1+3 から外す読みは本文に無い。`.strict()` 422 は「分割してはならない」
と「契約より先の `mapSnapshot` 更新は 422」で明示禁止である。

未 export の `mapSnapshot` は round-trip の入口を仕様が指名していない（Minor）。ただしそれは
**仕様が schema 単体で足りると書いていた旧穴の再開ではない。** 422 を GREEN にするには
§8 の単一 commit 禁則と §7 の round-trip 本文の両方を無視する必要がある。

契約+migration+型再生成を Task 1 に束ねても、新しい本番破壊の typecheck 緑中間は開かない。
generated 再生成を overlay より先に置くと typecheck が赤で止まる。14 引数 RPC と旧 13 引数
ブラウザの並走は Task 間の想定残差であり、今回の束ねが新規に作ったものではない。

---

## 2. 攻撃シナリオ

1. 旧 §8 の番号リストや §3.2 / §3.3 の残番号が、契約なしの `mapSnapshot` commit を再び指示するか
2. Task 1 の 4 箇条を 4 commit と読み、TDD の RED で `mapSnapshot` だけを先に積めるか
3. `mapSnapshot` 未 export のまま、§7 の round-trip を `snapshotRowSchema` 単体や契約テストで
   偽 GREEN にできるか
4. 契約+migration+pgTAP+型再生成の同一 Task が、overlay 無し generated 以外の本番 422 を新しく
   作るか（型再生成のみは typecheck 赤）
5. 14 引数 `save_generation_draft` が旧ブラウザ 13 引数と並走して下書き保存を殺すか
   （Task 間の既知並走か、今回の束ねの新規か）
6. `draftShape` を Task 1 で広げたあと、Task 2 前の `mapPlannerDraft` が `.strict()` で
   下書き GET を 422 にするか
7. 既存 `generation-context.test.ts` の `toEqual` が `null` 期待のままで twist 複写をロックせず、
   仕様の必須面から外れるか

---

## 3. Critical

なし。安全評価・quota / HMAC / ログ allowlist / 再生成 `PromptPreferences` 共有は R-01 デルタの
対象外のまま。F-01〜F-05 を再開する本文変更は無い。

---

## 4. Important

なし。R-01 の成立条件（仕様が契約を `mapSnapshot` と別段に置き、typecheck が余剰キーを黙認し、
必須テストが `snapshotRowSchema` で止まる）は 3 点とも改訂本文で潰れている。

---

## 5. Minor

### M-01: round-trip の公開入口（export または `loadGenerationContext`）が未固定

`mapSnapshot` と `snapshotRowSchema` はどちらも
`netlify/functions/_shared/generation-context.ts` の非 export である（63 行、211 行）。
§7 は「`mapSnapshot` に通し」「`snapshotRowSchema` 単体では不足」と書くが、**どう import するか**
を書いていない。

実装者の素直な経路は既存 `generation-context.test.ts` と同じ `loadGenerationContext`（export 済み、
291–294 行で本番 `mapSnapshot` を呼ぶ）か、テスト用に `mapSnapshot` を export するかである。
どちらも 422 と twist 保持を本番コードでロックする。

仕様が入口を固定しない残差は、mapper をテスト側に複製して `plannerSubmissionSchema.parse` だけ
通す読みである。これは契約未更新の 422 はまだ落とすが、本番 `mapSnapshot` がキーを写さない
silent `null` は落とさない。計画ブロッカーではない。Task 0 で
「`loadGenerationContext` 経由、または `mapSnapshot` をテスト用に export」と一文あれば足りる。

---

## 6. 成立しない攻撃

### A1. 残番号が契約なし `mapSnapshot` commit を再指示する — 成立しない

旧 R-01 の根は §8 が **2. 契約** を 1+3 の外に置き、「各段は Conventional Commit で閉じる」と
書いていたことである。`a2a7a4fb` の §8 は次に置き換わっている。

- 冒頭: 「Task 1 は契約・migration・サーバー読み取り面を 1 つの commit で閉じる。分割してはならない。」
- 理由: 契約より先の `mapSnapshot` は new_menu 全体 422。逆に migration より先の `mapSnapshot` は
  RPC が返さない列を読む。3 つは同時にしか正しくならない。
- 番号 1 は **Task 1（単一 commit）** で、契約 / migration / `snapshotRowSchema`+`mapSnapshot` /
  契約テスト・pgTAP・round-trip を箇条書きしている。番号 2 はクライアント永続面であり、契約ではない。
- 末尾: 「上記 4 要素を分けて commit しない。」

§3.2 の 1–6 は「migration 1 本で次をすべて行う」の内部手順であり Task 分割ではない。
§3.3 の「次を同じ Task 内で行う」箇条は schema と `mapSnapshot` だけだが、直後に
`submissionCommonShape` を **先行必須** とし、順序は §8 に委ねる。§8 は同一 commit である。
「先行必須」を別 Task と読んでも順序は契約が先であり、危険順（`mapSnapshot` が先）ではない。

TDD の RED → GREEN を 2 commit と読む余地は、AGENTS.md / 本仕様とも「段を 1 Conventional Commit
で閉じる」で潰れる。RED だけを積むならテストであり `mapSnapshot` 本体はまだ無い。本体を契約なしで
積む RED は「4 要素を分けて commit しない」違反であり、仕様が指示する経路ではない。

### A2. 必須テストが schema 単体のまま GREEN し、422 commit を通す — 成立しない

旧穴は §7 が「`snapshotRowSchema` が新しい列を含む行を parse できること」**だけ**だったこと。
改訂 §7 は round-trip を別箇条で必須化し、schema 単体では後段の
`plannerSubmissionSchema.parse` 失敗を検知しないと否定する。`standard` / `twist` / `null` の
3 値を要求する。§8 Task 1 のテスト面も「契約テスト、pgTAP、`mapSnapshot` round-trip」である。

422 を typecheck 緑で通すには、同一 commit から契約を外し、かつ round-trip を schema 単体で
すり替える、という二重の本文無視が要る。仕様どおりの経路ではない。

既存 `loadGenerationContext` テスト（`generation-context.test.ts` 198–227 行）は本番
`mapSnapshot` を既に呼ぶ。fixture に `novelty_preference` を足し `mapSnapshot` がキーを渡し、
契約が未更新なら 291–294 行が `invalidRequest()` → テスト RED。焦点を schema 単体に狭める読みは
§7 / §8 がもう許していない。入口の指名不足は M-01 に落とす。

### A3. 契約+migration+型再生成の同一 Task が新しい本番 422 を作る — 成立しない

検証した中間状態:

| 中間 | 実行時 | ゲート |
| --- | --- | --- |
| 型再生成あり・overlay なし | ブラウザはまだ 13 引数 | `buildSaveGenerationDraftArgs` の戻りが `SaveDraftArgs`（`database.ts` 29–37、179–181 行）。generated が `p_novelty_preference: string` を必須にすると欠落で **typecheck 赤**。ユーザー指定どおり Important にしない |
| 契約あり・`mapPlannerDraft` 未更新（Task 2 前） | `plannerDraftSchema.parse` にキー無し | `.default(null)` で欠損は null。`.strict()` 422 にはならない。twist が GET で落ちるのは Task 2 の対象であり、全 new_menu 422 ではない |
| 契約あり・`mapSnapshot` がキーを写さない | 生成は常に null | `.default(null)` で 422 にならない。round-trip が twist 保持を要求するので、本番 mapper を通せば RED。入口不足は M-01 |
| RPC 14 引数・旧ブラウザ 13 引数 | 下書き保存が失敗し得る | **Task 間の既知並走**。旧 §8 も migration をクライアント永続より前に置いていた。今回の束ねが新規に開いた穴ではない |
| Functions と DB のデプロイ競合 | schema 先行 or RPC 先行で 422 し得る | git の同一 commit 制約の外。R-01 の対象（typecheck 緑の git 中間）ではない。旧仕様でも schema と RPC は同一 Task だった |

`SubmissionSnapshotRow` overlay は `servings` だけを `| null` に戻す（`database.ts` 137–139 行）。
novelty の Returns を overlay しないのは現行 `ingredient_preference` と同型。実行時の正は
`snapshotRowSchema` の `.nullable()`。ここから 422 は出ない。

### A4. 既存 Minors を Important に上げる — しない

overlay 識別子 `SaveDraftNullableArgKeys`、`true as const`、user キー名、14 引数 GRANT /
`rls_inventory`、「隣に」配置、再生成 system マーカー、除外件数上限は前回どおり Minor / Task 0。
R-01 クロージャの攻撃対象外。重大度を上げない。

---

## 7. R-01 が閉じた根拠（再開しない）

| 旧成立条件 | `a2a7a4fb` |
| --- | --- |
| §8 が契約を 1+3 の外に置く | Task 1 単一 commit に契約を含む。番号 2 はクライアント |
| `parse(data: unknown)` で typecheck が余剰キーを黙認 | 本文が「型では守れないため順序（§8）で守る」と固定。順序は同一 commit |
| §7 が `snapshotRowSchema` 単体 | round-trip を別必須にし、schema 単体では不足と否定。Task 1 テスト面に round-trip を列挙 |
| 中間 commit が全 new_menu HTTP 422 | 仕様が指示する経路からは消えた。残るのは本文無視か、Task 間の既知 RPC/ブラウザ並走 |

F-01〜F-05 は再開しない。
