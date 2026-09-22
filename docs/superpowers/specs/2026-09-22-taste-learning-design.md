# 好みの学習（tasteHints）設計

- 日付: 2026-09-22（改訂 2: 実装照合レビュー反映）
- 状態: **人間レビュー待ち**
- 対象: new_menu の system プロンプト合成、集計 SQL 関数 1 本、`profiles` の列 1 本と更新関数 1 本、
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
| お気に入りの料理名が示す味の方向・調理法、所要時間帯、ジャンル（条件付き） | 直近に出した料理名とその食材、同じメイン食材の連続 |

すなわち「煮物寄り・30 分」という**スタイル**は維持したまま、**先週の肉じゃがは出さない**。
この分離は「`likedDishes` は料理名をそのまま出す対象ではなく、傾向を汲む材料である」と system 文で
明示することで実装する。味の方向と調理法は DB に構造化して持っていないため、料理名からモデルに
汲ませる。**構造として保証できるのは所要時間帯とジャンルだけ**であり、味と調理法はヒントに留まる。

段落は既存の `DIVERSITY_PARAGRAPH` / `NOVELTY_PARAGRAPH` と同じ **prompt 専用・fail-open** の規約に
従う。学習ヒントと他の制約が両立しないとき、モデルは通常どおり `outcome=success` を返してよく、
学習だけを理由に `constraint_conflict` にしてはならない。

## 2. 目的と対象外

### 2.1 目的

現状、利用者の好みのシグナルは既に貯まっているが**誰も読んでいない**。

| 既存のシグナル | 現在の用途 |
| --- | --- |
| `menus.is_favorite` | 履歴の絞り込み表示のみ |
| `menus.is_selected` | グループ代表の表示のみ |
| `menus.change_reason`（再生成理由） | 再生成時の prompt のみ。以後は未使用 |
| `menus.preference_snapshot.submission` | 結果画面の条件再現のみ |
| `dish_ingredients.name` | 買い物リストのみ |

`diversity-hints.ts` は「直近 10 献立と被らない」ことだけを指示し、**毎回リセットされる**。つまり
「使うほど良くなる」方向の蓄積は現状ゼロである。本設計はその欠けている軸を埋める。

### 2.2 対象外

- 蓄積プロファイル用テーブル、見える／編集できるプロフィール画面。都度集計で足りるか実測してから判断する。
- 明示フィードバック UI（「また作りたい／いまいち」ボタン）。既存の暗黙シグナルのみを使う。
- 週献立（`weekly-plan`）への適用。生成経路が別であり、効果確認後に検討する。
- 再生成経路（`regenerate_menu` / `regenerate_dish`）。既存 `diversity-hints` と同じく `new_menu` のみ。
- アレルギー評価、food-rules、`validate-generated-menu`、生成ハードゲート。
- fingerprint、quota、provider attempt 予算。学習ヒントはこれらの入力にならない。

## 3. 契約とデータ

### 3.1 `shared/contracts/taste-hints.ts`（新規）

`dishRoles` は `shared/contracts/generation.ts` の既存 export を使う（再定義しない）。

```ts
export const tasteSignalStrengths = ["weak", "medium", "strong"] as const;
export type TasteSignalStrength = (typeof tasteSignalStrengths)[number];

/** 所要時間帯。menus.total_elapsed_minutes から導出する */
export const tasteTimeBands = ["short", "standard", "slow"] as const;

/** 恒常シグナルとして扱える避ける軸は現状これだけ（§4.3） */
export const tasteAvoidAxes = ["child_unfriendly"] as const;

/** 集計窓と減衰。値の意味の正本。SQL 側はリテラルで持ち、pgTAP で境界を固定する（§3.4） */
export const TASTE_WINDOW_DAYS = 90 as const;
export const TASTE_WINDOW_MENUS = 50 as const;
export const TASTE_HALF_LIFE_DAYS = 30 as const;
export const TASTE_SELECTED_WEIGHT = 0.3 as const;
export const TASTE_FAVORITE_WEIGHT = 1.0 as const;

/** signalStrength の境界（窓内の derivation_group_id の個数） */
export const TASTE_STRENGTH_MEDIUM_MIN = 5 as const;
export const TASTE_STRENGTH_STRONG_MIN = 15 as const;

/** 最低出現回数。1 回だけの食材を「好き」「使いすぎ」と言わない */
export const TASTE_LIKED_INGREDIENT_MIN_COUNT = 2 as const;
export const TASTE_OVERUSED_INGREDIENT_MIN_COUNT = 3 as const;
export const TASTE_AVOID_AXIS_MIN_COUNT = 2 as const;

/** likedGenres を出す最低比率（§4.3）。和洋中 3 値のうち 2 つが常に入るのを防ぐ */
export const TASTE_GENRE_MIN_SHARE = 0.35 as const;

/** prompt 肥大を防ぐ各上限 */
export const TASTE_LIKED_DISHES_MAX = 12 as const;
export const TASTE_LIKED_GENRES_MAX = 2 as const;
export const TASTE_LIKED_INGREDIENTS_MAX = 8 as const;
export const TASTE_OVERUSED_INGREDIENTS_MAX = 3 as const;

export const tasteHintsSchema = z
  .object({
    likedDishes: z
      .array(z.object({ dishName: z.string().min(1).max(100), role: z.enum(dishRoles).optional() }))
      .max(TASTE_LIKED_DISHES_MAX),
    likedGenres: z.array(z.enum(["japanese", "western", "chinese"])).max(TASTE_LIKED_GENRES_MAX),
    likedIngredients: z.array(z.string().min(1).max(100)).max(TASTE_LIKED_INGREDIENTS_MAX),
    likedTimeBand: z.enum(tasteTimeBands).nullable(),
    overusedIngredients: z.array(z.string().min(1).max(100)).max(TASTE_OVERUSED_INGREDIENTS_MAX),
    avoidAxes: z.array(z.enum(tasteAvoidAxes)).max(1),
    signalStrength: z.enum(tasteSignalStrengths),
  })
  .strict();

export type TasteHints = z.infer<typeof tasteHintsSchema>;

/** 中身が空なら prompt にも記録にも出さない（§5.6） */
export function hasTasteContent(hints: TasteHints): boolean;

/** preference_snapshot へ記録する形。ブラウザはこれだけを読む */
export const tasteHintsRecordSchema = z
  .object({ applied: z.literal(true), strength: z.enum(tasteSignalStrengths) })
  .strict();
```

`likedGenres` に `"any"` は入れない。ジャンル未指定は嗜好のシグナルではない。

### 3.2 `preference_snapshot` への記録

`PreferenceSnapshot` 型は既知キー以外を許容し、読み側 `menu-result-api.ts` も `z.looseObject` で
読む。したがって**マイグレーション無しで**次を追加する。

```ts
tasteHints: { applied: true; strength: TasteSignalStrength } | undefined
```

未適用はキーを載せないことで表し、`applied: false` は書かない。読み側は
`tasteHintsRecordSchema.safeParse` で再検証し、失敗・欠落は「未適用」に倒す（`sourceSubmission` と
同じ安全側の扱い）。導入前の `preference_snapshot` にキーが無いことが正常系である。

### 3.3 マイグレーション `20260922120000_taste_learning.sql`

```sql
alter table public.profiles
  add column taste_learning_enabled boolean not null default true;
```

**`public.profiles` へのテーブル単位 UPDATE 権限は復活させない。**
`20260712000100_onboarding_completion_boundary.sql` が `profiles_update_own` を drop し
`revoke update on public.profiles from authenticated` を実行しており、以降プロフィールの更新は
`set_onboarding_status` のような**関数経由だけ**である。テーブル単位 UPDATE を戻すと
`onboarding_status` まで利用者が直接書き換えられる状態に戻る。

`menus.is_favorite` 式の列単位 grant（`grant update (taste_learning_enabled)` + 列用ポリシー）でも
書き込み面は 1 列に絞れるが、`profiles` はこのテーブル自身の確立した規約が**関数経由**であるため、
そちらへ揃える。

```sql
create or replace function public.set_taste_learning_enabled(p_enabled boolean)
returns boolean
language sql
security definer
set search_path = ''
as $function$
  update public.profiles
  set taste_learning_enabled = p_enabled
  where user_id = (select auth.uid())
  returning taste_learning_enabled;
$function$;

revoke all on function public.set_taste_learning_enabled(boolean) from public, anon;
grant execute on function public.set_taste_learning_enabled(boolean) to authenticated;
```

SELECT 権限は `20260712000100` 以降も残っているため、トグルの初期表示用の読み取りは
既存の `profiles` select にそのまま相乗りできる。

### 3.4 生成型と SQL 定数の扱い

- 列追加により `src/shared/types/database.generated.ts` の再生成が必要。**手編集は禁止**であり、
  `npm run db:types`（`scripts/generate-database-types.sh`）の成果物を Task 1 に含める。
- SQL 関数は TypeScript の定数を import できない。窓・半減期・境界・最低出現回数は
  **SQL にリテラルで入る**。契約側の定数は「値の意味の正本」であり、実際の同値性は
  pgTAP が境界（89/90 日、49/50 件、4/5 件、14/15 件、最低出現回数の 1 個下と上）を
  固定することで担保する。両者がずれたら pgTAP が落ちる。

## 4. 集計関数 `public.get_taste_signals()`

```sql
create or replace function public.get_taste_signals(
  p_target_mode text,
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
- `p_target_mode` は `'household'` / `'idea'`。`avoidAxes` のモード制限（§4.3）に使う。
- `profiles.taste_learning_enabled = false` のとき、および窓内の献立が 0 件のときは `null` を返す。
  トグルの評価をデータ境界に置き、呼び出し側の分岐漏れで有効化されない形にする。

### 4.1 窓と重み（式を確定する）

```sql
-- 窓: created_at desc で 50 件、かつ 90 日以内
decay(m)  = power(0.5, extract(epoch from (p_now - m.created_at)) / 86400.0 / 30.0)
score(m)  = decay(m) * (
              (case when m.is_favorite then 1.0 else 0.0 end)
            + (case when m.is_selected then 0.3 else 0.0 end)
            )
```

**お気に入りと採用は加算**（両方なら 1.3）、減衰は**乗算**。`score(m) > 0` の献立だけが
「寄せる軸」の母集団になる（★も採用もされていない献立は寄せる軸に寄与しない）。

`menus_owner_created_idx (user_id, created_at desc)` により窓は index だけで引ける。

### 4.2 寄せる軸

| 出力 | 母集団 | 集計 |
| --- | --- | --- |
| `likedDishes` | `score > 0` | `dishes(name, role)` を score 合計降順。同名は 1 つに畳む。最大 12 |
| `likedIngredients` | `score > 0` | `dish_ingredients.name` を score 合計降順。**素の出現 2 回以上**。最大 8 |
| `likedTimeBand` | `score > 0` | `menus.total_elapsed_minutes` の score 加重平均 → `short` ≤20 / `standard` 21–40 / `slow` ≥41。1 値 |
| `likedGenres` | `score > 0` **かつ `submission.cuisineGenre = 'any'`** | score 合計の比率が 0.35 以上のジャンルのみ、最大 2 |

**`likedGenres` の母集団をおまかせ（`any`）に限る理由。** `validate-generated-menu.ts` は
`submission.cuisineGenre !== "any"` のとき生成結果のジャンル不一致を弾く。したがってジャンルを
指定した回のお気に入りは「利用者が自分で選んだジャンル」の写しでしかなく、学習として循環する。
おまかせで生成された献立をお気に入りにしたときだけ、ジャンルは利用者の自由な選好を表す。
加えて 3 値中 2 値が常に入るとヒントにならないため、比率 0.35 の下限を置く。

**`likedTimeBand` は `menus.total_elapsed_minutes` から導出する**（列は存在する）。味の方向と
調理法と違い、これは構造として持っている値であり、モデルの推測に委ねない。

### 4.3 避ける軸（`avoidAxes`）

`change_reason` の保存値は、再生成シートの文言と対応している。

| 保存値 | 画面の文言 | 恒常シグナルか |
| --- | --- | --- |
| `simpler` | もっと簡単に | **いいえ**。その回を簡単にしたい意味であり、常時の時間短縮ではない |
| `different_flavor` | 別の味に | **いいえ**。その回の味を変えたい意味であり、常時の冒険回避ではない |
| `different_ingredient` | 別の食材で | **いいえ**。その回の食材を変えたい意味である |
| `child_friendly` | 子どもが食べやすく | **はい**。家庭の構成に由来し、繰り返されるほど恒常的である |
| `custom` | 自由記述 | 読まない |

改訂前は 4 つすべてを恒常の軸へ写像していたが、文言の意味と向きが合わない。写像するのは
`child_friendly` → `child_unfriendly` のみとし、**窓内で 2 回以上**現れたときだけ載せる
（1 回きりを恒常の好みと扱わない）。`change_reason_custom` と `memo` の自由記述は読まない。

**`p_target_mode = 'idea'` のとき `avoidAxes` は常に空にする。** `regeneration-sheet.tsx` は
idea で `child_friendly` を選択肢から外し、サーバーも拒否する（年齢適合を保証しないため）。
家族モードで押した履歴を idea 生成のプロンプトへ持ち込むと、この約束と衝突する。

### 4.4 使いすぎの検出と強さ

| 出力 | 集計 |
| --- | --- |
| `overusedIngredients` | 窓内**全**献立の `submission.mainIngredients`。**素の出現 3 回以上**かつ score 非依存の decay 合計降順、最大 3 |
| `signalStrength` | 窓内の **`derivation_group_id` の個数**。1–4 = `weak` / 5–14 = `medium` / 15 以上 = `strong` |

`signalStrength` は献立の行数ではなく派生グループで数える。`parent_menu_id is not null` の再生成
子行を数えると、同じ 1 食を作り直しただけで 15 行にすぐ届き、`strong` を名乗ってしまう。

## 5. Function 側

### 5.1 `netlify/functions/_shared/taste-hints.ts`（新規）

`diversity-hints.ts` と同型に保つ。

```ts
export const TASTE_HINTS_ENABLED = true as const;
export const TASTE_SYSTEM_MARKER = "【学習】" as const;
export const TASTE_HINTS_TIMEOUT_MS = 200 as const;

export type TasteHintsOutcome =
  | "disabled_flag"      // kill-switch off
  | "disabled_user"      // taste_learning_enabled = false（関数が null を返す）
  | "no_history"         // 窓内 0 件
  | "timeout"
  | "query_failed"
  | "invalid_shape"      // Zod 失敗
  | "filtered_empty"     // 安全フィルタ・重複落としで空になった
  | "applied";

export async function loadTasteHints(input: {
  ownerClient: unknown;
  targetMode: TargetMode;
  timeoutMs?: number;
}): Promise<{ hints: TasteHints | null; outcome: TasteHintsOutcome }>;
```

- owner-scoped client（`createUserScopedSupabase(user.accessToken)`）で `get_taste_signals` を RPC する。
- 戻り値を `tasteHintsSchema.safeParse`。失敗・タイムアウト・`null`・例外はすべて `hints: null`。
  **決して throw しない**。
- 200ms の race は `loadRecentDishHints` と同じ実装形（遅延 resolve は採用しない、late reject を握り潰す）。
- `disabled_user` と `no_history` は RPC の `null` からは区別できないため、SQL 側の戻り値を
  `null` ではなく `{"reason":"disabled"}` / `{"reason":"no_history"}` の判別可能形にする。

### 5.2 安全フィルタ `filterTasteHintsForSafety()`

`loadGenerationContext` と `loadTasteHints` は `Promise.all` で並列に走るため、フィルタは
**両方が揃った後**、`generation-service.ts` の配線箇所で適用する。

現行の制約に一致する語を `likedDishes[].dishName` と `likedIngredients` から落とす。

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

### 5.3 軸分けの確定 `sanitizeTasteHints()`

プロンプト組み立てではなく**配線側**で実行し、確定した 1 つのオブジェクトを prompt と記録の
両方に使う（§5.6）。

1. `recentDishHints` に出ている料理名を `likedDishes` から落とす。
   — 好きだが最近出した料理は、スタイルだけ汲んで料理は変える。軸分けの実装本体である。
2. **1 で落とした料理にしか現れない食材を `likedIngredients` からも落とす。**
   名前だけ消しても食材が残れば同じ皿に戻る。落ちた料理と残った料理の食材集合の差を取る。
3. 契約の各上限で切り詰める。
4. `hasTasteContent()` が false なら全体を `null` にする（`outcome = "filtered_empty"`）。

### 5.4 プロンプト合成 `generation-prompt.ts`

`buildNewMenuSystemPrompt` に `tasteEnabled` を足し、段落を `diversity` と `novelty` の間に置く。

```
CORE_BODY + DIVERSITY? + TASTE? + NOVELTY? + SEASON + mode extra
```

**既存 `DIVERSITY_PARAGRAPH` の優先順位番号と衝突するため、同時に更新する。** 現在の多様性段落は
「3) 最近の料理に近くないこと、4) 季節」と固定しており、学習段落が「3) 好みのスタイル、
4) 最近の料理」と書くと同じ system 文の中で順序が矛盾する。`DIVERSITY_PARAGRAPH_WITH_TASTE` を
用意し、学習が載るときだけ番号を繰り下げた版を使う。優先順位の文は 1 か所にしか現れないこと
（学習が載るときは学習段落側、載らないときは従来の多様性段落側）をテストで固定する。

```
1) アレルギー・必須安全・must_use・品数・時間
2) 当日の preferences（メイン食材・避けたい等）
3) tasteHints の「スタイル」
4) recentDishHints（最近と近い案を避ける）
5) 季節
```

**料理名・食材名を system 文へ連結しない。** 学習段落は指示文だけを含み、値は既存の
`serializePromptPayload` を通した user JSON（`tasteHints` キー）にのみ載せる。
`noveltyExcludedDishes` と同じ扱いであり、`recentDishHints` と違って後方互換の制約が無いため、
無効時・`null` 時はキーごと出さない。

段落に必ず含める指示:

- `likedDishes` は**味の方向・調理法の傾向を汲む材料**であり、そのまま出す料理の指定ではない。
  同じ料理名を再び出すためのリストとして使わないこと。
- `likedTimeBand` / `likedGenres` は当日の preferences が優先し、当日の指定があるときは無視すること。
- `signalStrength` が `weak` のときは参考程度に留めること。
- `avoidAxes` は献立全体の寄せ方であり、`constraint_conflict` の理由にしないこと。
- `overusedIngredients` は連続を避ける対象であり、禁止食材ではないこと。
- 学習ヒントと他の制約が両立しないときは通常どおり `outcome=success` を返すこと。

### 5.5 配線 `generation-service.ts`

```ts
const tasteEnabled = isTasteHintsEnabled(TASTE_HINTS_ENABLED);
const tastePromise = tasteEnabled
  ? loadTasteHints({ ownerClient, targetMode: command.request.targetMode })
  : Promise.resolve({ hints: null, outcome: "disabled_flag" as const });

const [generationContext, recentDishHints, taste] = await Promise.all([
  loadGenerationContext(user, requestId, command.request),
  hintsPromise,
  tastePromise,
]);

const finalTasteHints =
  taste.hints === null
    ? null
    : sanitizeTasteHints(filterTasteHintsForSafety(taste.hints, generationContext), recentDishHints);
```

- kill-switch off のときは **load 自体を呼ばない**（内部 early-return に頼らない。L13 と同じ規約）。
- 直列化しない。`Promise.all` の 3 本目として足すだけで、Function 総予算への追加は 0ms が期待値、
  最悪でも 200ms のタイムアウトで頭打ちになる。

### 5.6 記録の確定タイミング

**`preference_snapshot` へ書くのは、`sanitizeTasteHints` を通し、実際に user ペイロードへ載せた
確定オブジェクトに基づく。**

```
finalTasteHints === null        -> キーを載せない
finalTasteHints !== null        -> { applied: true, strength: finalTasteHints.signalStrength }
```

安全フィルタ直後の非 null 判定で記録すると、その後の切り詰めで中身が空になっても
「反映しました」が残る。確定は 1 か所（`finalTasteHints`）に集約し、prompt と記録が同じ
オブジェクトから導かれることをテストで固定する。

### 5.7 観測性

効果を測るには、なぜヒントが載らなかったのかが分かる必要がある（`off` / 履歴ゼロ / タイムアウト /
検証失敗 / フィルタで全削除 がすべて「キーなし」に潰れている）。既存 `logGenerationEvent` へ
**閉じた列挙 1 フィールドだけ**を足す。

```
tasteHintsOutcome: TasteHintsOutcome   // §5.1 の 8 値のみ
```

`logger.ts` は自由文を受け付けない閉じた snake_case 設計であり、この形はその規約に合う。
**料理名・食材名・件数の内訳は出さない。** `preference_snapshot` へ自由文を足す必要もない。

## 6. UI

### 6.1 設定トグル

`src/features/account/account-settings-section.tsx` に 1 項目追加する。読み取りは既存の
`profiles` select、書き込みは `set_taste_learning_enabled` RPC（§3.3）。

```
好みの学習                                              [ ON ]
★を付けた献立、「この献立にする」で選んだ献立、再生成の理由、入力したメイン食材から
傾向を読み取り、次の提案に反映します。
献立を作るときに、料理名と食材名が AI へ送られます。
OFF にすると読み取りをやめます。設定と反映の記録は保存されます。
```

改訂前の「新しく保存される情報はありません」は §7 と矛盾していたため削除した。実際に増えるのは
`profiles.taste_learning_enabled` と `preference_snapshot.tasteHints` であり、★ 以外に採用・
再生成理由・メイン食材も読む。

### 6.2 結果画面の 1 行

`menu-result-api.ts` が `preference_snapshot` を読む既存 select に相乗りし、
`MenuResultViewModel.tasteHintsApplied: boolean` を投影する。履歴詳細も同じ `menu-result` を
通るため、投影は結果画面と履歴で共有する。

表示は `MenuHero`。**`PageHeader` の `note` は 1 枠しかなく、`作成モデル: …` が既に使っている。**
好みの 1 行はそれを置き換えず、`MenuHero` が `PageHeader` の**外に独立した行**として描く
（`MenuHero` は fragment を返す形に変える）。

```
✨ いつもの好みを反映しました
```

- 出す条件は「実際に空でない `tasteHints` をプロンプトへ載せた（`applied: true`）」**かつ**
  `strength` が `medium` 以上のときだけ。`weak` では出さない。
- `signalStrength` の語そのものは利用者に見せない。
- 導入前の献立はキーが無く `false`。既存履歴の表示は変わらない。

## 7. 保存と送信

**新しく保存されるもの**

- `public.profiles.taste_learning_enabled`（boolean 1 列）
- `menus.preference_snapshot.tasteHints = { applied, strength }`（既存 jsonb 列の中）
- 生成ログの `tasteHintsOutcome`（閉じた列挙。料理名・食材名を含まない）

**新しく OpenRouter へ送られるもの**

現在も直近 10 献立の料理名は `recentDishHints` として送っている。本設計により、
**お気に入り・採用された献立の料理名と食材名（最長 90 日・最大 50 献立の範囲）**、
所要時間帯、ジャンル、メイン食材の使いすぎ傾向が追加で渡る。

`privacy_consents.notice_version`（現行 `2026-07-29.v1`）を上げるかは**未決（§10.2）**とする。
改訂前の「新しい個人データを保存しないから据え置く」という理由は、この**送信の増加**を
説明できていなかったため撤回する。

## 8. 不変条件

1. `tasteHints` は fingerprint（`createCurrentSafetyFingerprint`）、quota、attempt 予算、
   `validate-generated-menu` の入力に**現れない**。
2. `regenerate_menu` / `regenerate_dish` の messages に `tasteHints` キーと【学習】マーカーは現れない。
3. `TASTE_HINTS_ENABLED` が false のとき、段落・キー・RPC のすべてが出ない。
4. `taste_learning_enabled = false` の利用者では `get_taste_signals` がヒントを返さない。
5. 他人の `menus` は RLS により集計に入らない。
6. `change_reason_custom` と `memo` の自由記述は集計にも prompt にも入らない。
7. `p_target_mode = 'idea'` で `avoidAxes` は常に空。
8. 料理名・食材名は system 文に連結されず、user JSON 経由でのみ送られる。
9. `public.profiles` のテーブル単位 UPDATE 権限は復活しない。
10. 優先順位の文は 1 つの system 文に 1 回しか現れない。

## 9. テスト

| 層 | ファイル | 見るもの |
| --- | --- | --- |
| pgTAP | `supabase/tests/database/taste_signals.test.sql` | 他人の menus を読まない／窓の境界 89・90 日と 49・50 件／半減期／`score` の加算と乗算／`derivation_group_id` で数えた強さの 4・5・14・15／最低出現回数の境界／ジャンル比率 0.35 と `any` 限定／idea で `avoidAxes` 空／OFF と 0 件の判別／`set_taste_learning_enabled` が他人の行を更新しない／テーブル単位 UPDATE が依然として拒否される |
| Function | `taste-hints.test.ts` | Zod 検証／タイムアウト・失敗・不正形で null と `outcome`／OFF で RPC を呼ばない／安全フィルタ（アレルゲン別名・カスタム・苦手・avoid）／idea モード／`sanitizeTasteHints` の食材連鎖削除 |
| Function | `generation-prompt.test.ts` 追記 | 段落とキーの有無／優先順位の文が 1 回だけ／料理名が system 文に現れない／空ヒントでキーごと消える |
| Function | `generation-prompt-taste-off.test.ts`（新規） | kill-switch off で段落もキーも出ない（既存 2 本と同型） |
| Function | `generation-service.test.ts` 追記 | `Promise.all` 並列／**fingerprint に載らない**／`preference_snapshot` の記録が確定オブジェクトと一致（切り詰めで空→キーなし）／再生成経路に出ない／`tasteHintsOutcome` |
| src | `menu-result-api.test.ts` | `tasteHintsApplied` の投影、キー欠落・壊れた形で `false` |
| src | `menu-hero.test.tsx` | `weak` 非表示、`medium`/`strong` 表示、**作成モデル行と共存**する |
| src | `account-settings-section.test.tsx` | トグル往復（RPC 経由）と失敗時の復帰 |

**最重要は不変条件 1 の否定テスト**である。ここが漏れて fingerprint が揺れると、既存の
再検証・買い物リスト整合が壊れる。

## 10. 実装順

各 Task で RED → GREEN → 焦点検証 → 日本語 Conventional Commit。

```
Task 1  migration: 列 + set_taste_learning_enabled + get_taste_signals + pgTAP
        ＋ npm run db:types の成果物（database.generated.ts）を同 Task に含める
Task 2  shared/contracts/taste-hints.ts（Zod 契約・定数・hasTasteContent）
Task 3  netlify/.../taste-hints.ts（ローダ + 安全フィルタ + sanitize）
Task 4  UI: アカウント設定トグル        <- 配線より前に置く
Task 5  generation-prompt: 【学習】段落 + 多様性段落の番号更新 + kill-switch
Task 6  generation-service: 配線 + 記録 + tasteHintsOutcome
Task 7  UI: menu-result 投影 + MenuHero の 1 行
```

**Task 4 を Task 6 より前に置く。** 初期値が ON であるため、トグル（切る手段）と説明文が
利用者に届く前に学習が有効になってはならない。Task 1〜7 は同一リリースにまとめる。

検証は毎 Task スコープを絞って Docker 経由で回す。

```bash
docker compose run --rm --no-deps app npx vitest run <files>
docker compose run --rm --no-deps app npm run typecheck
docker compose run --rm --no-deps app npm run lint
docker compose run --rm --no-deps app npm run format:check
docker compose --profile test run --rm db-test
```

作業ブランチは `main`（人間の指示による。CLAUDE.md の既定 `production` ではない）。

## 11. 決定事項と未決

### 11.1 決定

| 論点 | 決定 |
| --- | --- |
| 学習の出口 | 生成結果の中身。画面はほぼ変えない |
| シグナル | 既存の暗黙シグナルのみ |
| 算出方式 | 都度集計。蓄積テーブルを作らない |
| 好み と ひねり の両立 | 軸を分ける |
| 透明性 | 結果に 1 行 + アカウント設定に ON/OFF |
| 提供範囲 | 全員・デフォルト ON |
| トグルの保存 | `set_taste_learning_enabled` RPC。テーブル単位 UPDATE は復活させない |
| 重みの式 | 減衰は乗算、★ 1.0 と採用 0.3 は加算 |
| 避ける軸 | `child_unfriendly` のみ。家族モード限定・2 回以上 |
| ジャンル | おまかせ生成のお気に入りに限る + 比率 0.35 |
| 反映表示 | プロンプトへ実際に載せた確定オブジェクトで判定 |

### 11.2 未決（人間の判断が要る）

- **`privacy_consents.notice_version` を上げるか。** 保存は増えないが、お気に入り由来の料理名・
  食材名が最長 90 日ぶん OpenRouter へ追加で渡る（§7）。現行 `2026-07-29.v1`。
- 初期値の微調整: 窓 90 日 / 50 件、半減期 30 日、採用係数 0.3、強さ境界 5・15、
  最低出現回数 2・3・2、ジャンル比率 0.35、時間帯の区切り 20 / 40 分、上限 12・2・8・3。
  重みの式と最低出現回数が決まったので初期値として使えるが、運用で調整する前提。

### 11.3 効果を見てから判断

- 週献立への適用、再生成経路への適用
- 都度集計の実測レイテンシが 200ms に収まらない場合のキャッシュ行
- 見える／編集できるプロフィール画面
