# 好みの学習（tasteHints）設計

- 日付: 2026-09-22
- 状態: **人間レビュー待ち**
- 対象: new_menu の system プロンプト合成、集計 SQL 関数 1 本、`profiles` の列 1 本、
  `preference_snapshot` への記録、アカウント設定トグル、献立結果の 1 行表示
- 種別: prompt 専用の任意ヒント追加。**安全評価・quota・fingerprint・検証には一切触れない**

---

## 1. 結論

利用者自身の履歴から「好みのスタイル」を都度集計し、new_menu の system プロンプトへ
**【学習】段落**と `tasteHints` ペイロードを載せる。蓄積用のテーブルは作らない。集計は
`public.get_taste_signals()` 1 本で、`menus` / `dishes` / `dish_ingredients` を RLS 準拠
（`security invoker`）で読む。

「好みに寄せる」と「いつもと違う」は**軸を分けて**両立させる。

| 寄せる軸（exploit） | 避ける軸（explore） |
| --- | --- |
| 味の方向・調理法・所要時間帯・ジャンル傾向 | 直近に出した料理名、同じメイン食材の連続 |

すなわち「和風で煮物寄り・30 分」という**スタイル**は維持したまま、**先週の肉じゃがは出さない**。
この分離は「`likedDishes` は料理名をそのまま出す対象ではなく、傾向を汲む材料である」と system 文で
明示することで実装する。料理名から調理法を構造化して取り出す必要はない（DB に持っていない）。

段落は既存の `DIVERSITY_PARAGRAPH` / `NOVELTY_PARAGRAPH` と同じ **prompt 専用・fail-open** の規約に
従う。学習ヒントと他の制約が両立しないとき、モデルは通常どおり `outcome=success` を返してよく、
学習だけを理由に `constraint_conflict` にしてはならない。

## 2. 目的と対象外

### 2.1 目的

現状、利用者の好みのシグナルは既に貯まっているが**誰も読んでいない**。

| 既存のシグナル | 現在の用途 |
| --- | --- |
| `menus.is_favorite` | 履歴の絞り込み表示のみ |
| `menus.change_reason`（再生成理由） | 再生成時の prompt のみ。以後は未使用 |
| `menus.preference_snapshot.submission` | 結果画面の条件再現のみ |
| `dish_ingredients.name` | 買い物リストのみ |

`diversity-hints.ts` は「直近 10 献立と被らない」ことだけを指示し、**毎回リセットされる**。つまり
「使うほど良くなる」方向の蓄積は現状ゼロである。本設計はその欠けている軸を埋める。

### 2.2 対象外

- 蓄積プロファイル用テーブル、見える／編集できるプロフィール画面。都度集計で足りるか実測してから判断する。
- 明示フィードバック UI（「また作りたい／いまいち」ボタン）。既存の暗黙シグナルのみを使う。
  追加 UI ゼロで、既存利用者にも初日から効くことを優先した。
- 週献立（`weekly-plan`）への適用。生成経路が別であり、効果確認後に検討する。
- 再生成経路（`regenerate_menu` / `regenerate_dish`）。既存 `diversity-hints` と同じく `new_menu` のみ。
- アレルギー評価、food-rules、`validate-generated-menu`、生成ハードゲート。
- fingerprint、quota、provider attempt 予算。学習ヒントはこれらの入力にならない。
- `privacy_consents.notice_version` の更新。新規に保存する個人データは `profiles` の boolean 1 つだけで、
  既存の自分の履歴を自分の生成に使うだけのため据え置く。設定トグルの説明文でその旨を明示する。

## 3. 契約とデータ

### 3.1 `shared/contracts/taste-hints.ts`（新規）

`shared/contracts` はブラウザと Functions の双方から読める。ブラウザは `signalStrength` と
記録形だけを使い、安全権限は一切持たない。

```ts
export const tasteSignalStrengths = ["weak", "medium", "strong"] as const;
export type TasteSignalStrength = (typeof tasteSignalStrengths)[number];

export const tasteAvoidAxes = [
  "time_over",
  "flavor_mismatch",
  "child_unfriendly",
  "ingredient_repeat",
] as const;

/** 集計窓と減衰。SQL 関数と Function 側の唯一の正本とする */
export const TASTE_WINDOW_DAYS = 90 as const;
export const TASTE_WINDOW_MENUS = 50 as const;
export const TASTE_HALF_LIFE_DAYS = 30 as const;

/** signalStrength の境界（窓内の献立件数） */
export const TASTE_STRENGTH_MEDIUM_MIN = 5 as const;
export const TASTE_STRENGTH_STRONG_MIN = 15 as const;

/** prompt 肥大を防ぐ各上限 */
export const TASTE_LIKED_DISHES_MAX = 12 as const;
export const TASTE_LIKED_GENRES_MAX = 2 as const;
export const TASTE_LIKED_INGREDIENTS_MAX = 8 as const;
export const TASTE_OVERUSED_INGREDIENTS_MAX = 3 as const;
export const TASTE_AVOID_AXES_MAX = 2 as const;

export const tasteHintsSchema = z
  .object({
    likedDishes: z
      .array(
        z.object({
          dishName: z.string().min(1).max(100),
          role: z.enum(dishRoles).optional(),
        }),
      )
      .max(TASTE_LIKED_DISHES_MAX),
    likedGenres: z.array(z.enum(["japanese", "western", "chinese"])).max(TASTE_LIKED_GENRES_MAX),
    likedIngredients: z.array(z.string().min(1).max(100)).max(TASTE_LIKED_INGREDIENTS_MAX),
    overusedIngredients: z.array(z.string().min(1).max(100)).max(TASTE_OVERUSED_INGREDIENTS_MAX),
    avoidAxes: z.array(z.enum(tasteAvoidAxes)).max(TASTE_AVOID_AXES_MAX),
    signalStrength: z.enum(tasteSignalStrengths),
  })
  .strict();

export type TasteHints = z.infer<typeof tasteHintsSchema>;

/** preference_snapshot へ記録する形。ブラウザはこれだけを読む */
export const tasteHintsRecordSchema = z
  .object({
    applied: z.literal(true),
    strength: z.enum(tasteSignalStrengths),
  })
  .strict();
```

`dishRoles` は `shared/contracts/generation.ts` の既存 export を使う（再定義しない）。
`likedGenres` に `"any"` は入れない。ジャンル未指定は嗜好のシグナルではない。

### 3.2 `preference_snapshot` への記録

`PreferenceSnapshot` 型（`shared/safety/generation-context.ts`）は既知キー以外を許容する。
したがって**マイグレーション無しで**次を追加する。

```ts
tasteHints: { applied: true; strength: TasteSignalStrength } | undefined
```

未適用はキーを載せないことで表し、`applied: false` は書かない（`undefined` と二重表現にしない）。

読み側は `tasteHintsRecordSchema.safeParse` で再検証し、失敗・欠落は「未適用」に倒す
（`sourceSubmission` と同じ安全側の扱い）。導入前の既存 `preference_snapshot` にキーが無いことが
正常系である。

### 3.3 マイグレーション `20260922120000_taste_learning.sql`

```sql
alter table public.profiles
  add column taste_learning_enabled boolean not null default true;
```

`grant select, update on public.profiles to authenticated` と `profiles_update_own` ポリシーは
既存であり、テーブル単位の grant は新しい列にも及ぶ。**追加の grant・ポリシー・RPC は不要**で、
ブラウザから直接 update できる。

## 4. 集計関数 `public.get_taste_signals()`

```sql
create or replace function public.get_taste_signals(
  p_now timestamptz default pg_catalog.now()
) returns jsonb
language sql
stable
security invoker
set search_path = ''
```

- `security invoker`。`menus` / `dishes` / `dish_ingredients` には所有者 select ポリシーが既にあり、
  他人の行は RLS が落とす。`SECURITY DEFINER` は使わない（権限を広げる理由がない）。
- `grant execute ... to authenticated`、`revoke ... from public, anon`。
- 引数に `user_id` を取らない。`(select auth.uid())` のみを使う。
- `profiles.taste_learning_enabled = false` のとき、および窓内の献立が 0 件のときは `null` を返す。
  トグルの評価をデータ境界に置き、呼び出し側の分岐漏れで有効化されない形にする。

### 4.1 窓と減衰

```
窓    : created_at >= p_now - interval '90 days' を created_at desc で 50 件
減衰  : weight = power(0.5, 経過日数 / 30.0)   -- 半減期 30 日
```

`menus_owner_created_idx (user_id, created_at desc)` が既にあり、窓は index だけで引ける。

### 4.2 軸の導出

| 出力 | 導出 |
| --- | --- |
| `likedDishes` | `is_favorite = true` の献立の `dishes(name, role)` を weight 降順。同名は 1 つに畳む |
| `likedGenres` | `cuisine_genre`（`any` を除く）を weight 合計で降順、上位 2 件 |
| `likedIngredients` | `is_favorite = true` の献立の `dish_ingredients.name` を weight 合計で降順、上位 8 件 |
| `overusedIngredients` | 窓内全体の `preference_snapshot->'submission'->'mainIngredients'` の weight 合計上位 1–3 件 |
| `avoidAxes` | `parent_menu_id is not null` の `change_reason` を weight 合計で降順、上位 2 件を写像 |
| `signalStrength` | 窓内の献立件数。1–4=`weak` / 5–14=`medium` / 15 以上=`strong` |

`is_selected = true` は弱い正のシグナルとして `likedDishes` / `likedGenres` の weight に
係数 0.3 で加算する（`is_favorite` は 1.0）。採用しただけと★を付けたことを同じ強さで扱わない。

`change_reason` から避ける軸への写像:

```
simpler              -> time_over           所要時間を短めに寄せる
different_flavor     -> flavor_mismatch     味付けの冒険を控える
child_friendly       -> child_unfriendly    子どもが食べやすい方へ寄せる
different_ingredient -> ingredient_repeat   食材の使い回しを避ける
custom               -> 写像しない（自由文は読まない）
```

`change_reason_custom` は自由記述であり、**読まない・載せない**。

## 5. Function 側

### 5.1 `netlify/functions/_shared/taste-hints.ts`（新規）

`diversity-hints.ts` と同型に保つ。

```ts
export const TASTE_HINTS_ENABLED = true as const;
export const TASTE_SYSTEM_MARKER = "【学習】" as const;
export const TASTE_HINTS_TIMEOUT_MS = 200 as const;

export async function loadTasteHints(input: {
  ownerClient: unknown;
  timeoutMs?: number;
}): Promise<TasteHints | null>;
```

- owner-scoped client（`createUserScopedSupabase(user.accessToken)`）で `get_taste_signals` を RPC する。
- 戻り値を `tasteHintsSchema.safeParse`。失敗・タイムアウト・`null`・例外はすべて `null`。**決して throw しない**。
- 200ms の race は `loadRecentDishHints` と同じ実装形（遅延 resolve は採用しない、late reject を握り潰す）。

### 5.2 安全フィルタ `filterTasteHintsForSafety()`

`loadGenerationContext` と `loadTasteHints` は `Promise.all` で並列に走るため、フィルタは
**両方が揃った後**、`generation-service.ts` の配線箇所で適用する。

現行の制約に一致する語を落とす。落とす対象は `likedDishes[].dishName` と `likedIngredients`。

| 出典 | 取り方 |
| --- | --- |
| 当日の避けたい食材 | `context.submission.avoidIngredients` |
| 家族の苦手 | `context.memberPreferences[].dislikes` |
| 登録アレルゲン | `context.safety.members[].allergenIds` を `allergenDictionary` で別名展開 |
| 自由登録アレルギー | `context.safety.members[].customAllergies[].name / aliases` |

照合は `normalizeFoodText` + `foodTextContainsAlias`（`shared/safety/allergens.ts`）を再利用する。
idea モード（`safety: null`）ではアレルゲン由来の語が無く、`avoidIngredients` のみで落とす。

> **これは安全ゲートではない。** 過去の好みを現在の制約に持ち込まないための prompt 衛生であり、
> 実際の安全判定は従来どおり `validate-generated-menu` と生成ハードゲートが担う。
> 本フィルタが素通りしても安全性は下がらない。

CLAUDE.md の *Current household safety constraints always override historical snapshots* に対応する
のがこの節である。

### 5.3 プロンプト合成 `generation-prompt.ts`

`buildNewMenuSystemPrompt` に `tasteEnabled` を足し、段落を `diversity` と `novelty` の間に置く。

```
CORE_BODY + DIVERSITY? + TASTE? + NOVELTY? + SEASON + mode extra
```

user ペイロードは `new_menu` のときだけ `tasteHints` キーを載せる。`recentDishHints` と違い
後方互換の制約が無いため、**無効時・null 時はキーごと出さない**（`noveltyExcludedDishes` と同じ扱い）。

`sanitizeTasteHints()` を prompt 側に置き、次を行う。

1. 各上限での切り詰め（契約の定数を唯一の正本とする）
2. `recentDishHints` に出ている料理名を `likedDishes` から落とす
   — **好きだが最近出した料理はスタイルだけ汲んで料理は変える**。軸分けの実装本体である
3. 空になった `likedDishes` / 全フィールドが空のヒントはキーごと落とす

### 5.4 【学習】段落

`TASTE_SYSTEM_MARKER` 始まりで、優先順位を明示する。

```
1) アレルギー・必須安全・must_use・品数・時間
2) 当日の preferences（メイン食材・避けたい等）
3) tasteHints の「スタイル」        <- 新規
4) recentDishHints（最近と近い案を避ける）
5) 季節
```

段落に必ず含める指示:

- `likedDishes` は**味の方向・調理法・手間の傾向を汲む材料**であり、そのまま出す料理の指定ではない。
  同じ料理名を再び出すためのリストとして使わないこと。
- `signalStrength` が `weak` のときは参考程度に留め、当日の preferences を優先すること。
- `avoidAxes` は献立全体の寄せ方であり、`constraint_conflict` の理由にしないこと。
- `overusedIngredients` は連続を避ける対象であり、禁止食材ではないこと。
- 学習ヒントと他の制約が両立しないときは通常どおり `outcome=success` を返すこと。

### 5.5 配線 `generation-service.ts`

```ts
const tasteEnabled = isTasteHintsEnabled(TASTE_HINTS_ENABLED);
const tastePromise = tasteEnabled ? loadTasteHints({ ownerClient }) : Promise.resolve(null);
const [generationContext, recentDishHints, rawTasteHints] = await Promise.all([
  loadGenerationContext(user, requestId, command.request),
  hintsPromise,
  tastePromise,
]);
const tasteHints = rawTasteHints === null
  ? null
  : filterTasteHintsForSafety(rawTasteHints, generationContext);
```

- kill-switch off のときは **load 自体を呼ばない**（内部 early-return に頼らない。L13 と同じ規約）。
- 直列化しない。`Promise.all` の 3 本目として足すだけで、Function 総予算への追加は 0ms が期待値、
  最悪でも 200ms のタイムアウトで頭打ちになる。
- 成功時、`preferenceSnapshot` に `tasteHints: { applied: true, strength }` を載せる。
  `null` のときはキーを載せない。

## 6. UI

### 6.1 設定トグル

`src/features/account/account-settings-section.tsx` に 1 項目追加する。RLS 越しに
`profiles.taste_learning_enabled` を直接 update する（RPC を作らない）。

```
好みの学習                                    [ ON ]
これまでに作った献立と★の傾向から、次の提案を調整します。
新しく保存される情報はありません。
```

OFF にすると `get_taste_signals` が `null` を返すため、集計クエリ自体が空振りで終わる。

### 6.2 結果画面の 1 行

`menu-result-api.ts` が `preference_snapshot` を読む既存 select に相乗りし、
`MenuResultViewModel.tasteHintsApplied: boolean` を投影する。表示は `MenuHero`
（所要時間・人数・モデル名を出している場所）に 1 行。

```
✨ いつもの好みを反映しました
```

- `strength === "weak"` では**出さない**。履歴 2 件の利用者に「いつもの好み」と言わない。
- 履歴詳細から再訪しても同じ列を読むため表示が一貫する。
- 導入前の献立はキーが無く `false` になる。既存履歴の表示は変わらない。

## 7. 不変条件

1. `tasteHints` は fingerprint（`safety_fingerprint` / `createCurrentSafetyFingerprint`）、quota、
   attempt 予算、`validate-generated-menu` の入力に**現れない**。
2. `regenerate_menu` / `regenerate_dish` の messages に `tasteHints` キーと【学習】マーカーは現れない。
3. `TASTE_HINTS_ENABLED` が false のとき、段落・キー・RPC のすべてが出ない。
4. `taste_learning_enabled = false` の利用者では `get_taste_signals` が `null` を返す。
5. 他人の `menus` は RLS により集計に入らない。
6. `change_reason_custom` と `memo` の自由記述は集計にも prompt にも入らない。
7. 新規に永続化するのは `profiles.taste_learning_enabled` と `preference_snapshot.tasteHints` のみ。
   料理名・食材名は既存の自分の行を読むだけで、新しい保存先を作らない。

## 8. テスト

| 層 | ファイル | 見るもの |
| --- | --- | --- |
| pgTAP | `supabase/tests/database/taste_signals.test.sql` | 他人の menus を読まない／窓と減衰／`weak`/`medium`/`strong` 境界／OFF で null／0 件で null／列の default true と自己更新のみ可 |
| Function | `netlify/functions/_shared/taste-hints.test.ts` | Zod 検証／上限と重複畳み込み／タイムアウト・失敗・不正形で `null`／OFF で RPC を呼ばない／安全フィルタ（アレルゲン別名・カスタム・苦手・avoid）／idea モード |
| Function | `generation-prompt.test.ts` 追記 | 段落とキーの有無／`recentDishHints` との重複落とし／`signalStrength` による文面差／空ヒントでキーごと消える |
| Function | `generation-prompt-taste-off.test.ts`（新規） | kill-switch off で段落もキーも出ない（既存 2 本と同型） |
| Function | `generation-service.test.ts` 追記 | `Promise.all` 並列／**fingerprint に載らない**／`preference_snapshot` への記録／再生成経路に出ない |
| src | `menu-result-api.test.ts` | `tasteHintsApplied` の投影、キー欠落・壊れた形で `false` |
| src | `menu-hero.test.tsx` | `weak` 非表示、`medium`/`strong` 表示 |
| src | `account-settings-section.test.tsx` | トグル往復と失敗時の復帰 |

**最重要は不変条件 1 の否定テスト**である。ここが漏れて fingerprint が揺れると、既存の
再検証・買い物リスト整合が壊れる。

## 9. 実装順

各 Task で RED → GREEN → 焦点検証 → 日本語 Conventional Commit。

```
Task 1  migration: profiles.taste_learning_enabled + get_taste_signals() + pgTAP
Task 2  shared/contracts/taste-hints.ts（Zod 契約・上限定数・strength 境界）
Task 3  netlify/functions/_shared/taste-hints.ts（ローダ + 安全フィルタ）
Task 4  generation-prompt: 【学習】段落 + tasteHints キー + kill-switch
Task 5  generation-service: 配線 + preference_snapshot への記録
Task 6  UI: アカウント設定トグル
Task 7  UI: menu-result 投影 + MenuHero の 1 行
```

検証は毎 Task スコープを絞って Docker 経由で回す。

```bash
docker compose run --rm --no-deps app npx vitest run <files>
docker compose run --rm --no-deps app npm run typecheck
docker compose run --rm --no-deps app npm run lint
docker compose run --rm --no-deps app npm run format:check
docker compose --profile test run --rm db-test
```

作業ブランチは `main`（人間の指示による。CLAUDE.md の既定 `production` ではない）。

## 10. 決定事項と未決

### 10.1 このセッションで決めたこと

| 論点 | 決定 |
| --- | --- |
| 学習の出口 | 生成結果の中身。画面はほぼ変えない |
| シグナル | 既存の暗黙シグナルのみ。明示フィードバック UI は作らない |
| 算出方式 | 都度集計。蓄積テーブルを作らない |
| 好み と ひねり の両立 | 軸を分ける（スタイルは寄せる／具体の料理は避ける） |
| 透明性 | 結果に 1 行 + アカウント設定に ON/OFF |
| 提供範囲 | 全員・デフォルト ON |

### 10.2 未決（実装前に確認したいもの）

- 数値はすべて提案値である。半減期 30 日、窓 90 日 / 50 件、strength 境界 5・15、
  上限 12 / 2 / 8 / 3 / 2、`is_selected` の係数 0.3。運用で調整する前提だが、
  初期値としてこれでよいか。
- `signalStrength` を利用者に見せるか（現案は見せない。1 行の出し分けにのみ使う）。

### 10.3 効果を見てから判断すること

- 週献立への適用
- 再生成経路への適用
- 都度集計の実測レイテンシが 200ms に収まらない場合のキャッシュ行の追加
- 見える／編集できるプロフィール画面
