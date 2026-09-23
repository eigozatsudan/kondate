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

/**
 * 所要時間帯。menus.total_elapsed_minutes の加重平均から導出する。
 * 加重平均は小数になるため、境界は `<= 20` / `<= 40` / それ以外で連続させる
 * （`21-40` と書くと 20.5 分がどの帯にも入らない）。
 */
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

/** prompt 肥大を防ぐ各上限。対応表は prompt へ出ないため上限を持たない（下記） */
export const TASTE_LIKED_DISHES_MAX = 12 as const;
/**
 * 集計関数が返す likedDishes の上限。最近出した料理を落とす前の候補なので prompt の上限より広く取り、
 * sanitize が最近の料理を落とした後に TASTE_LIKED_DISHES_MAX へ切る（§4.2、§5.3）。
 */
export const TASTE_LIKED_DISHES_QUERY_MAX = 24 as const;
export const TASTE_LIKED_GENRES_MAX = 2 as const;
export const TASTE_LIKED_INGREDIENTS_MAX = 8 as const;
export const TASTE_OVERUSED_INGREDIENTS_MAX = 3 as const;

/**
 * 名前は DB の CHECK（char_length(btrim(name)) 1〜100）と同じく code point で数える。
 * UTF-16 の .max(100) だと絵文字の多い 1 語で parse 全体が落ち、学習が黙って止まる。
 */
const foodNameSchema = z.string().refine((value) => {
  const length = Array.from(value.replace(/^ +| +$/g, "")).length;
  return length >= 1 && length <= 100;
});

export const tasteHintsSchema = z
  .object({
    likedDishes: z
      .array(z.object({ dishName: foodNameSchema, role: z.enum(dishRoles).optional() }))
      .max(TASTE_LIKED_DISHES_MAX),
    likedGenres: z.array(z.enum(["japanese", "western", "chinese"])).max(TASTE_LIKED_GENRES_MAX),
    likedIngredients: z.array(foodNameSchema).max(TASTE_LIKED_INGREDIENTS_MAX),
    likedTimeBand: z.enum(tasteTimeBands).nullable(),
    overusedIngredients: z.array(foodNameSchema).max(TASTE_OVERUSED_INGREDIENTS_MAX),
    avoidAxes: z.array(z.enum(tasteAvoidAxes)).max(1),
    signalStrength: z.enum(tasteSignalStrengths),
  })
  .strict();

export type TasteHints = z.infer<typeof tasteHintsSchema>;

/**
 * 集計関数の戻り。dishIngredientIndex は §5.3 の食材連鎖削除の対応表であり、
 * prompt にも preference_snapshot にも出さない（sanitize で捨てる）。
 *
 * 対応表には上限を掛けない。prompt へ出ないので肥大を防ぐ理由が無く、逆に切ると
 * 差集合が壊れる: likedDishes の上限（TASTE_LIKED_DISHES_QUERY_MAX = 24 件）を対応表にも
 * 掛けると、上限より下位のお気に入りがある利用者では (a) 残した料理の食材が表に無く、
 * 落とした料理にしか無いと誤判定して消える、(b) 上限の外の料理の食材が表に無く、
 * likedIngredients に残って同じ皿へ戻す、の両方が起きる。窓（90 日・50 献立）が実質の上限になる。
 */
export const tasteSignalsSchema = z
  .object({
    ...tasteHintsSchema.shape,
    // 最近の料理を落とす前の候補なので prompt の上限より広い。要素は tasteHintsSchema と共有する
    likedDishes: z
      .array(tasteHintsSchema.shape.likedDishes.element)
      .max(TASTE_LIKED_DISHES_QUERY_MAX),
    dishIngredientIndex: z.array(
      z.object({
        dishName: foodNameSchema,
        ingredients: z.array(foodNameSchema),
      }),
    ),
  })
  .strict();

/**
 * 中身が空なら prompt にも記録にも出さない（§5.6）。
 * likedDishes / likedIngredients / likedGenres / overusedIngredients / avoidAxes の
 * いずれかが 1 件以上、または likedTimeBand が null でないこと。
 * signalStrength だけでは載せない（強さは中身ではない）。
 * これは prompt へ載せる条件。preference_snapshot へ記録する条件はさらに狭い（§5.6）。
 */
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

未適用はキーを載せないことで表し、`applied: false` は書かない。`applied: true` は
`likedDishes` か `likedIngredients` を 1 件以上載せたときだけ記録し、それ以外（使いすぎの食材・ジャンル・
時間帯・`avoidAxes` だけを prompt に載せたときを含む）はキーを載せない（§5.6）。読み側は
`tasteHintsRecordSchema.safeParse` で再検証し、失敗・欠落は「未適用」に倒す（`sourceSubmission` と
同じ安全側の扱い）。導入前の `preference_snapshot` にキーが無いことが正常系である。

### 3.3 マイグレーション `20260922120000_taste_learning.sql`

```sql
alter table public.profiles
  add column taste_learning_enabled boolean not null default true,
  -- 比較更新（CAS）用の連番。書き込みが通るたびに 1 進む。
  -- abort してもサーバー側の commit は止まらないため、遅れて届いた古い書き込みが
  -- 利用者の OFF を ON で上書きしうる。連番を照合して古い書き込みを捨てる。
  -- 期限（時刻）ではなく連番にしたのは、端末の時計ずれで判定が壊れないようにするため。
  add column taste_learning_seq bigint not null default 0;
```

`taste_learning_seq` は比較更新（CAS）用の連番で、書き込みが通るたびに 1 進む。
導入済みの supabase-js / postgrest-js（2.110.2）は abort してもサーバー側の処理を止めないため、
proxy に滞留した書き込みが、画面が timeout して再読を終えた**後に** commit しうる。
その場合、画面は OFF なのにサーバーは ON に戻り、料理名・食材名が AI へ送られてしまう。
連番を照合して、遅れて届いた古い書き込みをサーバー側で捨てる。期限（時刻）で捨てる方式は
端末の時計ずれで壊れるため採らない（決定）。

**`public.profiles` へのテーブル単位 UPDATE 権限は復活させない。**
`20260712000100_onboarding_completion_boundary.sql` が `profiles_update_own` を drop し
`revoke update on public.profiles from authenticated` を実行しており、以降プロフィールの更新は
`set_onboarding_status` のような**関数経由だけ**である。テーブル単位 UPDATE を戻すと
`onboarding_status` まで利用者が直接書き換えられる状態に戻る。

`menus.is_favorite` 式の列単位 grant（`grant update (taste_learning_enabled)` + 列用ポリシー）でも
書き込み面は 1 列に絞れるが、`profiles` はこのテーブル自身の確立した規約が**関数経由**であるため、
そちらへ揃える。

```sql
create or replace function public.set_taste_learning_enabled(
  p_enabled boolean,
  p_expected_seq bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_enabled boolean;
  v_seq bigint;
begin
  -- set_onboarding_status と同じ規約。未認証・行欠落を null で黙らせない。
  -- updated_at は profiles_set_updated_at トリガが入れる
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'authentication_required';
  end if;

  if p_enabled is null then
    raise exception using errcode = '22023', message = 'invalid_taste_learning_enabled';
  end if;

  if p_expected_seq is null then
    raise exception using errcode = '22023', message = 'invalid_taste_learning_seq';
  end if;

  -- 呼び出し側が最後に読んだ連番と一致するときだけ書く。timeout 後の画面は
  -- 同じ値の「柵」書き込みで連番を進めるので、proxy に滞留していた古い書き込みが
  -- 後から届いても一致せず捨てられる（UI が OFF なのにサーバーが ON に戻る事故を防ぐ）。
  update public.profiles as profile
  set taste_learning_enabled = p_enabled,
    taste_learning_seq = profile.taste_learning_seq + 1
  where profile.user_id = auth.uid()
    and profile.taste_learning_seq = p_expected_seq
  returning profile.taste_learning_enabled, profile.taste_learning_seq
  into v_enabled, v_seq;

  if found then
    return pg_catalog.jsonb_build_object('enabled', v_enabled, 'seq', v_seq, 'applied', true);
  end if;

  -- 連番が合わない: 書かずに現在値を返し、呼び出し側が表示をサーバー値へ合わせる。
  -- 行そのものが無い場合は従来どおり黙らせず P0002
  select profile.taste_learning_enabled, profile.taste_learning_seq
  into v_enabled, v_seq
  from public.profiles as profile
  where profile.user_id = auth.uid();

  if not found then
    raise exception using errcode = 'P0002', message = 'profile_not_found';
  end if;

  return pg_catalog.jsonb_build_object('enabled', v_enabled, 'seq', v_seq, 'applied', false);
end;
$function$;

revoke all on function public.set_taste_learning_enabled(boolean, bigint) from public, anon;
grant execute on function public.set_taste_learning_enabled(boolean, bigint) to authenticated;
```

戻り値は `{ enabled, seq, applied }`。連番が一致したときだけ書いて `applied: true`、一致しなければ
書かずに現在値を `applied: false` で返す（行が無ければ従来どおり `P0002`）。`p_expected_seq` の null は
`22023 invalid_taste_learning_seq`。連番を照合しない 1 引数版は残さない。
連番もテーブル単位 UPDATE の revoke により利用者が直接は書けず、この関数だけが進める。

SELECT 権限は `20260712000100` 以降も残っているため、**読み取りに新しい関数は要らない**
（`taste_learning_seq` も同じ所有者 select ポリシーで読める）。
ただしアカウント設定は現在 `profiles` を読んでおらず（`profiles` を読むのは
`household-api.ts` の `select("*")` だけ）、既存 select への相乗り先が無い。トグルの初期表示用の
読み取りは設定画面側に新設する（§6.1）。

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
- **モードは引数に取らない。** 新規生成の request（`newMenuGenerationRequestSchema`）は
  `idempotencyKey` / `draftId` / `draftRevision` / `privacyNoticeVersion` /
  `expiredPantryConfirmations` だけで `targetMode` を持たない。モードは下書き側にあり、
  `loadGenerationContext` が返す `generationContext.targetMode` で初めて分かる。
  `Promise.all` の開始時点では渡せる値がないため、idea の `avoidAxes` 除去は
  取得後（§5.2）で行う。
- 戻りは常に**判別可能オブジェクト**（§4.5）。`null` は返さない。

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
| `likedDishes` | `score > 0` | `dishes(name, role)` を score 合計降順。同名は 1 つに畳む。SQL は最大 24（`TASTE_LIKED_DISHES_QUERY_MAX`）。prompt へ出す 12 件（`TASTE_LIKED_DISHES_MAX`）への切り詰めは、§5.3 で最近の料理を落とした後に行う |
| `likedIngredients` | `score > 0` | `dish_ingredients.name` を score 合計降順。**派生グループ 2 つ以上**（同一献立内の重複は 1 回。§4.4 と同じ数え方）。最大 8 |
| `likedTimeBand` | `score > 0` | `menus.total_elapsed_minutes` の score 加重平均 → `<= 20` は `short`、`<= 40` は `standard`、それ以外は `slow`。1 値 |
| `likedGenres` | `score > 0` **かつ `submission.cuisineGenre = 'any'`** | **`menus.cuisine_genre`**（生成結果のジャンル）別の score 合計 ÷ 母集団の score 合計 が 0.35 以上のジャンルのみ、最大 2 |

**`likedGenres` の母集団をおまかせ（`any`）に限る理由。** `validate-generated-menu.ts` は
`submission.cuisineGenre !== "any"` のとき生成結果のジャンル不一致を弾く。したがってジャンルを
指定した回のお気に入りは「利用者が自分で選んだジャンル」の写しでしかなく、学習として循環する。
おまかせで生成された献立をお気に入りにしたときだけ、ジャンルは利用者の自由な選好を表す。
加えて 3 値中 2 値が常に入るとヒントにならないため、比率 0.35 の下限を置く。

**`likedDishes` を SQL で 24 件まで返す理由（最終レビュー Q3）。** SQL で 12 件に切ってから最近の料理を
落とすと、上位が最近の料理で埋まる利用者ほど `likedDishes` が空になり、学習が効かない。
SQL は候補を広めに返し、Function の `sanitizeTasteHints` が最近の料理を落とした後に 12 件へ切る。
集計の戻り（`tasteSignalsSchema`）だけが 24 件まで受け、prompt と記録の形（`tasteHintsSchema`）は 12 件のままである。
`20260923190000_taste_signals_liked_dishes_window.sql` で関数を置き換えた（あわせて減衰式を 1 回だけ計算する形にした。値は変わらない）。

**比率を足す列は `menus.cuisine_genre`（生成結果）である。** 母集団の条件に使う
`submission.cuisineGenre` を分子にも使うと、母集団は定義上すべて `any` なので結果は常に空になる。
生成結果側の `cuisine_genre` が `'any'` の行は分子に入れない（分母には残す）。

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

`child_friendly` の回数も**派生グループごとに 1 回**と数える（§4.4 と同じ理由）。同じ 1 食に
「子どもが食べやすく」を 2 回押しただけで恒常の軸にしない。

**idea 生成では `avoidAxes` を空にする。** `regeneration-sheet.tsx` は idea で `child_friendly` を
選択肢から外し、サーバーも拒否する（年齢適合を保証しないため）。家族モードで押した履歴を idea
生成のプロンプトへ持ち込むと、この約束と衝突する。集計関数はモードを知らないので、
除去は `filterTasteHintsForSafety`（§5.2）で `generationContext.targetMode === "idea"` を見て行う。

### 4.4 使いすぎの検出と強さ

| 出力 | 集計 |
| --- | --- |
| `overusedIngredients` | 窓内**全**献立の `submission.mainIngredients`。**派生グループ単位で 3 回以上**かつ decay 合計降順、最大 3 |
| `signalStrength` | 窓内の **`derivation_group_id` の個数**。1–4 = `weak` / 5–14 = `medium` / 15 以上 = `strong` |

`signalStrength` は献立の行数ではなく派生グループで数える。`parent_menu_id is not null` の再生成
子行を数えると、同じ 1 食を作り直しただけで 15 行にすぐ届き、`strong` を名乗ってしまう。

**回数を数えるものはすべて `derivation_group_id` 単位で 1 回**とする。再生成は元の依頼をやり直す
操作であり、子献立は親と同じ条件由来の `submission` を持って別行で保存される。行で数えると、
同じ 1 食を 3 回作り直しただけでメイン食材が「使いすぎ」になる。同一献立の配列内に同じ食材が
二度現れた場合も 1 回と数える。`likedIngredients` の最低出現回数、`overusedIngredients` の
最低出現回数、`avoidAxes` の最低出現回数のすべてに適用する。

### 4.5 戻り値（判別可能オブジェクトに統一する）

`null` は返さない。空の理由をローダが区別できる必要があり（§5.7 の観測性）、
かつ `tasteHintsSchema` は理由オブジェクトを通さないため、**`safeParse` の前に `reason` を見る**。

```jsonc
{ "reason": "disabled" }     // taste_learning_enabled = false
{ "reason": "no_history" }   // 窓内 0 件
{ "reason": null, "likedDishes": [...], "likedGenres": [...], "likedIngredients": [...],
  "likedTimeBand": "standard", "overusedIngredients": [...], "avoidAxes": [...],
  "signalStrength": "medium", "dishIngredientIndex": [...] }
```

ローダは `reason` を先に分岐し、`null` のときだけ `tasteSignalsSchema.safeParse` にかける。

**`reason` キー自体は `safeParse` の前に取り除く。** `tasteSignalsSchema` は `.strict()` であり
`reason` を知らないため、成功応答をそのまま通すと未知キーで落ち、履歴のある利用者が全員
`invalid_shape` になる。ローダは `const { reason: _ignored, ...rest } = data` の形で外してから
`rest` を検証する。

**`taste_learning_enabled = false` は窓が空でも `disabled` が優先する。** 関数の分岐順は
`disabled` → `no_history` → 本体であり、OFF の利用者が `no_history` として観測されることはない。

## 5. Function 側

### 5.1 `netlify/functions/_shared/taste-hints.ts`（新規）

`diversity-hints.ts` と同型に保つ。

```ts
export const TASTE_HINTS_ENABLED = true as const;
export const TASTE_SYSTEM_MARKER = "【学習】" as const;
export const TASTE_HINTS_TIMEOUT_MS = 200 as const;

export type TasteHintsOutcome =
  | "disabled_flag"      // kill-switch off
  | "disabled_user"      // taste_learning_enabled = false（reason: "disabled"）
  | "no_history"         // 窓内 0 件
  | "timeout"
  | "query_failed"
  | "invalid_shape"      // Zod 失敗
  | "filtered_empty"     // 安全フィルタ・重複落としで空になった
  | "filter_failed"      // 安全フィルタ・sanitize が例外を投げた（fail-open で null に倒す）
  | "applied";

export async function loadTasteHints(input: {
  ownerClient: unknown;
  timeoutMs?: number;
}): Promise<{ signals: TasteSignals | null; outcome: TasteHintsOutcome }>;
```

- owner-scoped client（`createUserScopedSupabase(user.accessToken)`）で `get_taste_signals` を RPC する。
- 失敗・タイムアウト・例外はすべて `signals: null`。**決して throw しない**。
- 200ms の race は `loadRecentDishHints` と同じ実装形（遅延 resolve は採用しない、late reject を握り潰す）。
  加えて timeout で負けたときは `rpc(...).abortSignal()` で fetch を中断する（結末は `timeout` のまま fail-open。PostgREST 側の SQL が止まる保証は無い）。
- `reason` を先に見て `disabled_user` / `no_history` を確定し、`reason === null` のときだけ
  `tasteSignalsSchema.safeParse` にかける（§4.5）。理由オブジェクトを schema に通すと
  両方とも `invalid_shape` に潰れる。
- **`reason` キーを外してから `safeParse` する。** `tasteSignalsSchema` は `.strict()` なので、
  `reason: null` を含んだまま渡すと成功応答が未知キーで落ちる（§4.5）。
- 戻すのは `TasteSignals`（対応表を含む）。対応表は §5.3 で使い切り、prompt へは出さない。
- `reason` を外すコピーは `Object.fromEntries` で作る。代入でコピーすると `"__proto__"` キーが
  プロトタイプを差し替え、strict schema の未知キー検査をすり抜ける。

### 5.2 安全フィルタ `filterTasteHintsForSafety()`

`loadGenerationContext` と `loadTasteHints` は `Promise.all` で並列に走るため、フィルタは
**両方が揃った後**、`generation-service.ts` の配線箇所で適用する。

現行の制約に一致する語を `likedDishes[].dishName` と `likedIngredients` から落とす。
料理名に出ない食材（親子丼の卵など）でも、対応表でその料理の食材が制約に当たれば料理ごと落とす。
対応表の食材が不可視文字（§5.3 手順 2 の集合）を含む料理も、照合器で当否を判定できないので料理ごと落とす（保守側）。
ただし料理ごと落とす判定に使うのは、ハードゲートが実際に弾く語（避けたい食材の展開、自由登録
アレルギー、表示確認が不要な辞書の別名と表示名、対象年齢帯の家族がいる forbidden の食品安全ルールの語）だけにする。醤油・みそのような表示確認の別名や
家族の苦手まで使うと、小麦・大豆アレルギーの家庭で和食の好みがほぼ全部消える。
`overusedIngredients` は「使いすぎを避けて」という向きの語なので対象外とする。

| 出典 | 取り方 |
| --- | --- |
| 当日の避けたい食材 | `context.submission.avoidIngredients` を検証側と同じ `expandAvoidNeedles`（`validate-generated-menu.ts`）で展開 |
| 家族の苦手 | `context.memberPreferences[].dislikes` |
| 登録アレルゲン | `context.safety.members[].allergenIds` を `allergenDictionary` の表示名と別名で展開 |
| 自由登録アレルギー | `context.safety.members[].customAllergies[].name / aliases` |
| 年齢帯の禁止ルール | `context.safety.foodSafetyRules` のうち `ruleKind === "forbidden"` かつ `appliesToAgeBands` が家族の `ageBand` と交わるものの `matchTerms`（餅・ナッツなど）。`requires_tag`（ぶどうの 4 等分など）は下処理で許されるので含めない |

照合は `normalizeFoodText` + `foodTextContainsAlias`（`shared/safety/allergens.ts`）を再利用する。
語は正規化後の形で重複を畳み、名前ごとに 1 回だけ `normalizeFoodTextForMatching` した compact に
語が部分文字列で含まれるものだけを `foodTextContainsAlias` に回す（判定結果は同一）。フィルタはローダの 200ms 予算の外で走るため、辞書全件でも数十 ms 以内に収める。
idea モード（`safety: null`）ではアレルゲン由来の語が無く、`avoidIngredients` のみで落とす。

**この関数が `avoidAxes` のモード制限も行う。** `generationContext.targetMode === "idea"` のとき
`avoidAxes` を空にする（§4.3）。集計関数はモードを知らず、配線の `Promise.all` 開始時点でも
モードは未確定であり、`generationContext` が揃うこの位置が最初の適用点である。

食材を落とすときは、対応表（`dishIngredientIndex`）側の食材も同じ判定で落としておく。
§5.3 の差集合が、既に安全上落とした食材を「残っている」と誤判定しないようにする。

> **これは安全ゲートではない。** 過去の好みを現在の制約に持ち込まないための prompt 衛生であり、
> 実際の安全判定は従来どおり `validate-generated-menu` と生成ハードゲートが担う。
> 本フィルタが素通りしても安全性は下がらない。

### 5.3 軸分けの確定 `sanitizeTasteHints()`

プロンプト組み立てではなく**配線側**で実行し、確定した 1 つのオブジェクトを prompt と記録の
両方に使う（§5.6）。

1. `recentDishHints` に出ている料理名を `likedDishes` から落とす。
   — 好きだが最近出した料理は、スタイルだけ汲んで料理は変える。軸分けの実装本体である。
2. **1 で落とした料理にしか現れない食材を `likedIngredients` からも落とす。**
   名前だけ消しても食材が残れば同じ皿に戻る。生き残りは上限で切れた `likedDishes` ではなく、
   上限の無い対応表の「最近でない料理」から数える（上限 24 件の外の料理の食材を誤って消さない）。
   あわせて改行・制御文字・不可視の書式文字（`\p{Cc}` / `\p{Cf}` / `\p{Co}` / `\p{Cn}` / U+2028 / U+2029）と、
   既定で無視される文字（`\p{Default_Ignorable_Code_Point}`。異体字セレクタ U+FE00–FE0F / U+E0100–E01EF / U+180B–180F、
   U+034F、U+17B4–17B5、ハングルの空白字 U+3164 / U+115F / U+1160 / U+FFA0 などを含む）、点字の空白 U+2800 を
   含む語を語ごとに落とす（結合記号 `\p{M}` の全体は正当な日本語を落としうるので入れない）。後者は照合器の正規化（NFKC と Cf の除去）を抜けるため、ここで落とす（照合器を変えると安全 fingerprint に波及する）。ゼロ幅空白や双方向制御で見た目を偽装した語をプロンプトへ渡さない。
3. 契約の各上限で切り詰める。
4. **対応表 `dishIngredientIndex` を捨てる。** 戻り値は `TasteHints`（対応表なし）。
5. `hasTasteContent()` が false なら全体を `null` にする（`outcome = "filtered_empty"`）。

**手順 2 は対応表なしでは計算できない。** `recentDishHints` は `{ dishName, role? }` だけで食材を
持たず、`likedIngredients` も料理名と紐づいていない。この 2 つだけを受け取った関数に差集合は
作れない。そのため集計関数が `score > 0` の料理ごとの食材名（`dishIngredientIndex`）を一緒に返し、
sanitize がそれを使って差を取り、user ペイロードと `preference_snapshot` へ渡す前に対応表自体を
捨てる。対応表は**プロンプトにも記録にも出ない**。

**対応表は窓内の `score > 0` の料理をすべて、食材名もすべて含む（上限なし）。** `likedDishes` と
同じ名前の畳み方（`group by dishes.name`）で 1 料理 1 行にまとめ、`recentDishHints` との突き合わせは
その畳んだ名前で行う。件数を切ると差集合が両方向に壊れる（§3.1 の注記）。

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
  当日の preferences のメイン食材に含まれるときは無視すること。
- 学習ヒントと他の制約が両立しないときは通常どおり `outcome=success` を返すこと。

### 5.5 配線 `generation-service.ts`

```ts
const tasteEnabled = isTasteHintsEnabled(TASTE_HINTS_ENABLED);
const tastePromise = tasteEnabled
  ? loadTasteHints({ ownerClient })
  : Promise.resolve({ signals: null, outcome: "disabled_flag" as const });

const [generationContext, recentDishHints, taste] = await Promise.all([
  loadGenerationContext(user, requestId, command.request),
  hintsPromise,
  tastePromise,
]);

// targetMode は generationContext が揃って初めて分かる（request は持たない）
const finalTasteHints =
  taste.signals === null
    ? null
    : sanitizeTasteHints(
        filterTasteHintsForSafety(taste.signals, generationContext),
        recentDishHints,
      );
```

- kill-switch off のときは **load 自体を呼ばない**（内部 early-return に頼らない。L13 と同じ規約）。
- **フラグの組み合わせ:** 多様性の kill-switch（`DIVERSITY_HINTS_ENABLED`）が off のときは `recentDishHints` が空配列になるため、
  §5.3 の「直近の料理を落とす」処理は働かず、最近出した料理も `likedDishes` に残る（学習だけ on の組み合わせ。運用の kill-switch 時に限られ、コードは変えない）。
- 直列化しない。`Promise.all` の 3 本目として足すだけで、Function 総予算への追加は 0ms が期待値、
  最悪でも 200ms のタイムアウトで頭打ちになる。

### 5.6 記録の確定タイミング

**`preference_snapshot` へ書くのは、`sanitizeTasteHints` を通し、実際に user ペイロードへ載せた
確定オブジェクトに基づく。**

```
finalTasteHints === null                                   -> キーを載せない
finalTasteHints !== null かつ likedDishes・likedIngredients が両方空 -> キーを載せない（prompt には載せる）
finalTasteHints !== null かつ likedDishes か likedIngredients が 1 件以上
                                                           -> { applied: true, strength: finalTasteHints.signalStrength }
```

記録は「★や採用に由来する好みを載せた」ときだけにする（`shouldRecordTasteHints`）。使いすぎの食材・
ジャンル・時間帯・`avoidAxes` だけのときは prompt へは載せるが、結果画面の「いつもの好みを反映しました」
が中身より強く聞こえるので記録しない（最終レビュー A2 の決定）。

安全フィルタ直後の非 null 判定で記録すると、その後の切り詰めで中身が空になっても
「反映しました」が残る。確定は 1 か所（`finalTasteHints`）に集約し、prompt と記録が同じ
オブジェクトから導かれることをテストで固定する。

### 5.7 観測性

効果を測るには、なぜヒントが載らなかったのかが分かる必要がある（`off` / 履歴ゼロ / タイムアウト /
検証失敗 / フィルタで全削除 がすべて「キーなし」に潰れている）。既存 `logGenerationEvent` へ
**閉じた列挙 1 フィールドだけ**を足す。

```
taste_hints_outcome: TasteHintsOutcome   // §5.1 の 9 値のみ
```

**フィールドを型に足すだけでは出力されない。** `logGenerationEvent` は受け取った
`SafeGenerationLogEvent` から `createSafeLogger` へ渡すフィールドを**手で写しており**、
`createSafeLogger` は自分が知っているキーだけを `record` へ入れる。許可一覧に足すだけでは
分岐が無いキーは出力に現れない。次の 5 箇所へ**同時に**足す。

| 追加先 | 内容 |
| --- | --- |
| `logger.ts` の `SafeGenerationLogEvent` | 型に `tasteHintsOutcome?: TasteHintsOutcome` を足す |
| `logger.ts` の `logGenerationEvent` | `createSafeLogger(write)({ ... })` の呼び出しへ写す（`modelId` と同じ省略形） |
| `logger.ts` の `SafeLogEvent` | 型に `tasteHintsOutcome` を足す |
| `logger.ts` の `createSafeLogger` | `record.taste_hints_outcome` へ入れる分岐を足す（**これが無いと出力されない**） |
| `logger.ts` の `SAFE_LOG_SERIALIZED_KEYS` | `"taste_hints_outcome"` を足す |
| `scripts/assert-privacy-logs.mjs` の `allowedLogKeys` | 同じキーを足す（無いと `privacy_log_unexpected_field`） |

値は `closedErrorCode` / `closedModelId` と同型の**閉じた列挙**で通し、未知の文字列は落とす。
`logger.ts` は自由文を受け付けない設計であり、この形はその規約に合う。
**料理名・食材名・件数の内訳は出さない。** `preference_snapshot` へ自由文を足す必要もない。

## 6. UI

### 6.1 設定トグル

`account-settings-section.tsx` へは追加しない。独立した
`src/features/account/taste-learning-settings-section.tsx`（`TasteLearningSettingsSection`）
として作り、`src/features/household/household-settings-page.tsx` の
`<ShareConsentSettingsSection userId={userId} />` の直後（家族ゼロ分岐・家族あり分岐の
2 箇所とも）に差し込む。

**アカウント設定は現在 `profiles` を読んでいない。** `profiles` を読んでいるのは
`src/features/household/household-api.ts` の `select("*")`（初回設定の状態用）だけである。
設定画面用の読み取りを新設する。SELECT 権限は `20260712000100` 以降も残っているため、
読み取りに新しい関数は要らない。書き込みだけが `set_taste_learning_enabled` RPC（§3.3）。
読み取りは `taste_learning_enabled` と `taste_learning_seq` を一緒に読み（`getTasteLearningState`）、
書き込みは最後に読んだ連番を `p_expected_seq` に渡す。

**トグルの挙動（CAS の柵）**

- 書き込みは timeout（`TASTE_LEARNING_TOGGLE_TIMEOUT_MS`）で abort を試みて打ち切る。
- `applied: true` なら戻り値を cache へ書き、invalidate して裏取りする。
- `applied: false`（別端末などが先に変えた）なら戻り値のサーバー値を cache へ書く。要求値と
  同じなら成功扱い、違えば失敗表示を出す。
- timeout・abort・その他の書き込み失敗では、応答が無くても commit 済みかもしれない。
  純粋関数 `settleTasteLearningWrite`（`taste-learning-settle.ts`）で確定させる。サーバーの連番は
  書き込みのたびに 1 進むだけなので、観測した連番が送った `expectedSeq` を超えていれば、その書き込みは
  既に適用されたか、今後届いても捨てられる。どちらでも観測した値が最終値になる。
  1. 現在値を読む（同じ timeout）。連番が `expectedSeq` を超えていれば確定。値が要求値と同じでも、
     連番が進んでいなければ確定とはみなさない（滞留中の書き込みはまだ通りうる）。
  2. 超えていなければ、現在値のまま読んだ連番で**柵**の書き込みを送る。値は変えず連番だけを進めるので、
     滞留中の古い書き込みが後から届いても連番が合わずサーバーで捨てられる。柵の答えは `applied` の
     true/false どちらでも連番が進んでいることを示すので、そこで確定する。
  3. 読み取りの失敗も柵の失敗も「まだ分からない」として同じに扱う（元の書き込みを止めた相関障害が
     両方を止めうる）。`TASTE_LEARNING_FENCE_ATTEMPTS` 回まで `TASTE_LEARNING_FENCE_RETRY_DELAY_MS`
     の間隔をおいて、毎回読み取りからやり直す。
  4. 確定したら、そのサーバー値が要求値なら成功扱い、違えば失敗表示（スイッチはサーバー値）。
  5. 何度試みても確かめられなければ、サーバー側の状態は本当に未確定である。失敗表示はせず、
     未確定の記録 `{ requestedEnabled, expectedSeq }` を query cache
     （`tasteLearningKeys.unconfirmed(userId)`、`gcTime: Infinity`）に置き、消えない警告
     （`tasteLearningCopy.unconfirmed`）と「もう一度読み込む」ボタンを出す。画面を離れて戻っても
     記録は残る。スイッチは直近に観測したサーバー値のままにし、楽観値には戻さない。
     ボタンは記録の `expectedSeq` で確定を 1 回試み、その間は disabled で読み込み中の文言にする。
     トグルの書き込み中もボタンは押せない（柵がその書き込みの連番を奪い、偽の失敗表示を出すため）。
     逆にボタンの確定処理の間はスイッチも押せない（`TasteLearningSection` の `disabled`）。同じ理由で、
     柵が先に連番を進めるとトグルが `applied: false` になり偽の失敗表示が出る。
     この相互の disabled は、両方の mutation に付けた `mutationKey`（`tasteLearningKeys.toggleWrite(userId)` /
     `tasteLearningKeys.unconfirmedRetry(userId)`）を `useIsMutating` で数えて導く。インスタンスごとの
     `isPending` と違い mutation cache 単位なので、画面を離れて戻っても（再マウント）走っている方を見失わない。
     確定処理は数十秒かかりうるので、画面を開き直した後の別の書き込みと並行しうる。記録を置くときは、
     既により新しいか同じ連番の記録があれば残し、cache が既に `expectedSeq` を超えた連番を観測して
     いれば置かない（`nextTasteLearningUnconfirmed`）。古い記録が新しい記録を上書きすると、新しい
     書き込みが後から通っても警告が出なくなるため。
  6. 記録は、どの経路であれ（書き込み・柵の応答、確定処理の読み取り、`queryFn` の fetch）観測した
     連番が記録の `expectedSeq` を超えた時点で消す。記録の中身と比べて消すので、後から置かれた
     別の記録を誤って消すことはない。
- taste-learning の cache への書き込みは、`useQuery` の `queryFn` 自身が fetch 成功時に行う置き換え
  も含めてすべて連番ガード（`mergeTasteLearningState`。cache の連番より古ければ捨てる）を通す。
  遅れて届いた読み取り・柵の応答や、remount 前のインスタンスからの応答が新しい値を巻き戻さない。
- 書き込みと確定処理の間（最悪 1 分強）は、スイッチの下に `role="status"` の短い文言
  （`tasteLearningCopy.saving`）を出す。スイッチが無言で止まって見えないようにする。
  文言と同時に挿入した live region は支援技術によって読み上げられないため、`role="status"` の領域は
  常に置いて中身だけを切り替える（空の間は `empty:sr-only` で余白を作らない）。
- 共有同意（`share-consent-settings-section.tsx`）は連番を持たないため、従来どおり複数回の
  再読ポーリングで同じ問題を扱っている。挙動は変えない。

```
好みの学習                                              [ ON ]
★を付けた献立、「この献立にする」で選んだ献立、再生成の理由、入力したメイン食材から
傾向を読み取り、次の提案に反映します。
献立を作るときに、そこから読み取った料理名と食材名（最長90日・最大50献立）がAIへ送られます。
OFFにすると読み取りをやめます。設定と反映の記録は保存されます。
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
- `applied: true` は `likedDishes` か `likedIngredients` が 1 件以上残ったときだけ記録される（§5.6）。
  使いすぎの食材・ジャンル・時間帯・`avoidAxes` だけを載せた献立では、記録が無いので 1 行も出ない。
- `signalStrength` の語そのものは利用者に見せない。
- 導入前の献立はキーが無く `false`。既存履歴の表示は変わらない。

## 7. 保存と送信

**新しく保存されるもの**

- `public.profiles.taste_learning_enabled`（boolean）と `taste_learning_seq`（比較更新用の連番。bigint）
- `menus.preference_snapshot.tasteHints = { applied, strength }`（既存 jsonb 列の中）
- 生成ログの `tasteHintsOutcome`（閉じた列挙。料理名・食材名を含まない）

**新しく OpenRouter へ送られるもの**

現在も直近 10 献立の料理名は `recentDishHints` として送っている。本設計により、
**お気に入り・採用された献立の料理名と食材名（最長 90 日・最大 50 献立の範囲）**、
所要時間帯、ジャンル、メイン食材の使いすぎ傾向が追加で渡る。

**`privacy_consents.notice_version` は `2026-07-29.v1` のまま据え置く（決定）。**
代わりに、この送信の増加を**設定トグルの説明文とプライバシーページの両方**に書く。
既に直近 10 献立の料理名は送っており、OFF にする手段（トグル）が同じリリースで同時に届くため、
全利用者へ同意画面を再表示する負荷に見合わないと判断した。

改訂前の「新しい個人データを保存しないから据え置く」という理由は、この**送信の増加**を
説明できていなかったため撤回する。据え置きの理由は上記のとおり差し替える。

プライバシーページは `src/features/privacy/privacy-copy.ts` の `privacySections`「AIへ送る情報」に
追記する。改訂前の本文は「献立の希望や人数など」と家族設定の扱いだけを述べており、履歴由来の
送信に触れていなかった。追記する内容は次の 5 点に限る。

- ★ を付けた・「この献立にする」で選んだ献立の**料理名と食材名**を送ること
- 直近の窓で**繰り返し指定したメイン食材名**を送ること（`overusedIngredients` は ★ の付いていない
  献立も母集団に含むため、上の 1 点目だけでは実際に送る範囲より狭い）
- 範囲は**最長 90 日・最大 50 献立**であること
- **好みの学習は設定で止められる**こと（止められるのは好みの学習だけで、直前の同じ料理を避けるための
  送信は止まらないため、主語を明示する）
- 新しい献立を作るときは、同じ料理が続かないよう**直近の献立（最大 10 献立）の料理名**も送ること
  （既存の `recentDishHints`。上限は `netlify/functions/_shared/diversity-hints.ts` の
  `RECENT_MENUS_LIMIT`）

確定した追記文（人間承認済み）:

> 家族設定を使わないアイデア献立では、家族に関する情報は一切送りません。**新しい献立を作るときは、同じ料理が続かないよう、直近の献立（最大10献立）の料理名も送ります。**また、好みの学習をONにしている場合は、★を付けた献立や選んだ献立から読み取った料理名と食材名、および直近で繰り返し指定したメイン食材名（最長90日・最大50献立）も送ります。**好みの学習は設定でいつでも止められます。**

## 8. 不変条件

1. `tasteHints` は fingerprint（`createCurrentSafetyFingerprint`）、quota、attempt 予算、
   `validate-generated-menu` の入力に**現れない**。
2. `regenerate_menu` / `regenerate_dish` の messages に `tasteHints` キーと【学習】マーカーは現れない。
3. `TASTE_HINTS_ENABLED` が false のとき、段落・キー・RPC のすべてが出ない。
4. `taste_learning_enabled = false` の利用者では `get_taste_signals` が `{ reason: "disabled" }` を返す。
5. 他人の `menus` は RLS により集計に入らない。
6. `change_reason_custom` と `memo` の自由記述は集計にも prompt にも入らない。
7. idea 生成では `avoidAxes` に値が入らない（空配列）。`tasteHints` を載せるときは `"avoidAxes":[]` のキーと段落の説明文は残るが、`child_unfriendly` は出ない。
8. 料理名・食材名は system 文に連結されず、user JSON 経由でのみ送られる。
9. `public.profiles` のテーブル単位 UPDATE 権限は復活しない。
10. 優先順位の文は 1 つの system 文に 1 回しか現れない。
11. `dishIngredientIndex` は user ペイロードにも `preference_snapshot` にもログにも現れない。

## 9. テスト

| 層 | ファイル | 見るもの |
| --- | --- | --- |
| pgTAP | `supabase/tests/database/taste_signals.test.sql` | 他人の menus を読まない／窓の境界 89・90 日と 49・50 件／半減期／`score` の加算と乗算／`derivation_group_id` で数えた強さの 4・5・14・15／**回数はすべて派生グループ単位**（同じ 1 食を 3 回再生成しても使いすぎにならない、`child_friendly` 2 回でも 1 グループなら軸にならない）／同一献立内の重複食材は 1 回／ジャンルは `menus.cuisine_genre` で比率を取り、結果 `any` は分子に入らない／`submission.cuisineGenre = 'any'` 限定／時間帯の境界 20・20.5・40・40.5／`{"reason":...}` と `reason: null` の判別／`dishIngredientIndex` が `score > 0` の料理だけを含む／`set_taste_learning_enabled` が他人の行を更新しない（他人の連番と一致しても自分の行だけを照合する）／テーブル単位 UPDATE が依然として拒否される（`taste_learning_seq` も直接書けない）／**CAS**: 連番一致で `applied: true` と連番 +1、古い連番は `applied: false` で値も連番も変えず現在値を返す、`p_expected_seq` の null は `22023`、1 引数版が無い／**各上限**: likedDishes は 25 件の候補で 24 件、likedIngredients は 9 件で 8 件、overusedIngredients は 4 件で 3 件に止まる、同じ献立内の重複食材は 1 回と数える、3 ジャンル等分では likedGenres が `[]` |
| Function | `taste-hints.test.ts` | `reason` 分岐が safeParse より先（`disabled` / `no_history` が `invalid_shape` に潰れない）／タイムアウト・失敗・不正形で null と `outcome`／OFF で RPC を呼ばない／安全フィルタ（アレルゲン別名・カスタム・苦手・avoid）／**idea で `avoidAxes` が空**／表示確認の別名・苦手では料理ごと落とさない／`__proto__` キーで strict 検査をすり抜けない／辞書全件でも予算内に収まる／`sanitizeTasteHints` が対応表で食材を落とし（上限 24 件の外の料理の食材は残す）、制御文字・不可視文字を含む語を落とし、対応表を戻り値から捨てる／**年齢帯の forbidden**: 3〜5 歳の家族がいると餅・ナッツ系が対応表経由も含めて料理ごと落ち、高齢者だけなら餅系だけが落ちてナッツ系は残り、大人だけなら残る。requires_tag（ぶどう）は落とさない／**不可視文字**: 異体字セレクタ（U+FE0E ほか）・ハングルと点字の空白字・U+034F・U+180B・U+17B4 を挟んだ語を落とし、対応表の食材に不可視文字がある料理は料理ごと落とす／**24 件上限**: 集計の戻りは 24 件を受け、最近の料理を落とした後に 12 件へ切る／RPC の中断（予算切れで fetch を abort、予算内なら abort しない） |
| Function | `generation-prompt.test.ts` 追記 | 段落とキーの有無／優先順位の文が 1 回だけ／料理名が system 文に現れない／空ヒントでキーごと消える |
| Function | `generation-prompt-taste-off.test.ts`（新規） | kill-switch off で段落もキーも出ない（既存 2 本と同型） |
| Function | `generation-service.test.ts` 追記 | `Promise.all` 並列／**fingerprint に載らない**／`preference_snapshot` の記録が確定オブジェクトと一致（切り詰めで空→キーなし）／再生成経路に出ない／`tasteHintsOutcome`／安全フィルタの例外は `filter_failed` で fail-open／**記録条件**: 使いすぎの食材だけ、またはジャンル・時間帯・`avoidAxes` だけのヒントは prompt に載せるが記録しない、sanitize 後に likedDishes か likedIngredients が残れば記録する |
| contract | `shared/contracts/taste-hints.test.ts` | signals は likedDishes を 24 件まで受け 25 件を拒み、hints は 12 件のまま／signals と hints の likedDishes の要素スキーマが同じオブジェクト |
| src | `menu-result-api.test.ts` | `tasteHintsApplied` の投影、キー欠落・壊れた形で `false` |
| src | `menu-hero.test.tsx` | `weak` 非表示、`medium`/`strong` 表示、**作成モデル行と共存**する |
| src | `taste-learning-api.test.ts` / `taste-learning-settings-section.test.tsx` | 初期表示の `profiles` 読み取り（値と連番、strict Zod）、`p_expected_seq` の送信と `{ enabled, seq, applied }` の strict 検査、signal の転送／postgrest-js が abort 後も `{data: null, error}` で resolve するケースで `setTasteLearningEnabled` が throw する／CAS を持つテスト内の偽サーバーで: 通常成功、連番を運ぶ OFF→ON→OFF 往復、滞留書き込みが柵より先に commit（成功・柵なし）、未 commit の滞留書き込みを柵で捨てる（失敗表示とサーバー値、後着の書き込みが `applied: false`）、別端末による `applied: false`（違う値は失敗表示、同じ値は成功）、柵が `applied: false` で要求値と一致し成功扱いになる、書き込み失敗後の読み取りが失敗しても読み直して柵を送る、柵の再試行が途中の attempt で答えを得て止まる、全 attempt 失敗で消えない unconfirmed 警告が出て remount をまたいでも残り「もう一度読み込む」ボタン（確かめている間は disabled・読み込み中の文言）で解決する、連番が進んだ読み取りで警告が自動で消え同じ連番では消えない、古い書き込みの未確定が新しい記録を上書きしない、トグルの書き込み中は再読み込みボタンが押せず再試行の間はスイッチが押せない（remount をまたいでも両方向とも disabled のまま）、remount をまたいで古い読み取りが新しい連番の値を上書きしない（`mergeTasteLearningState` が `queryFn` 自身の fetch にも効く）。`taste-learning-settle.test.ts` で確定処理を注入した偽サーバーで単体に確かめる。`taste-learning-section.test.tsx` で `role="status"` の領域が最初から置かれ、書き込みの間だけ中身が入る |
| src | `privacy-copy.test.ts` | 「AIへ送る情報」に 90 日・50 献立・「好みの学習は設定でいつでも止められます」・直近の献立（最大 10 献立）の料理名が含まれる |
| script | `scripts/assert-privacy-logs.mjs` | `taste_hints_outcome` が許可一覧にあり、料理名・食材名がログに出ない |

**最重要は不変条件 1 の否定テスト**である。ここが漏れて fingerprint が揺れると、既存の
再検証・買い物リスト整合が壊れる。

## 10. 実装順

各 Task で RED → GREEN → 焦点検証 → 日本語 Conventional Commit。

```
Task 1  migration: 列 + set_taste_learning_enabled + get_taste_signals + pgTAP
        ＋ npm run db:types の成果物（database.generated.ts）を同 Task に含める
Task 2  shared/contracts/taste-hints.ts（Zod 契約・定数・hasTasteContent）
Task 3  netlify/.../taste-hints.ts（ローダ + 安全フィルタ + sanitize）
Task 4  UI: アカウント設定トグル + privacy-copy.ts の「AIへ送る情報」追記
        <- 配線（Task 6）より前に置く
Task 5  generation-prompt: 【学習】段落 + 多様性段落の番号更新 + kill-switch
Task 6  generation-service: 配線 + 記録 + tasteHintsOutcome
Task 7  UI: menu-result 投影 + MenuHero の 1 行
```

**Task 4 を Task 6 より前に置く。** 初期値が ON であるため、トグル（切る手段）と説明文
（設定・プライバシーページの両方）が利用者に届く前に学習が有効になってはならない。
Task 1〜7 は同一リリースにまとめる。

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
| 同意版 | `2026-07-29.v1` 据え置き。送信の増加は設定とプライバシーページの両方に明記 |
| トグルの保存 | `set_taste_learning_enabled` RPC（連番つき比較更新。timeout 時は柵の書き込みで古い書き込みを捨てる）。テーブル単位 UPDATE は復活させない |
| 重みの式 | 減衰は乗算、★ 1.0 と採用 0.3 は加算 |
| 避ける軸 | `child_unfriendly` のみ。家族モード限定・2 派生グループ以上 |
| 回数の数え方 | 強さも最低出現回数も `derivation_group_id` 単位 |
| 空の戻り | `null` ではなく `{ reason }` の判別可能オブジェクト |
| ジャンル | 母集団は `submission.cuisineGenre = 'any'`、比率は `menus.cuisine_genre` で取る + 下限 0.35 |
| 反映表示 | プロンプトへ実際に載せた確定オブジェクトで判定 |

### 11.2 未決（人間の判断が要る）

- （解決済み）`notice_version` は据え置き、送信の増加は設定トグルとプライバシーページの
  両方に書く。§7 を参照。
- 初期値の微調整: 窓 90 日 / 50 件、半減期 30 日、採用係数 0.3、強さ境界 5・15、
  最低出現回数 2・3・2、ジャンル比率 0.35、時間帯の区切り 20 / 40 分、上限 12・2・8・3。
  重みの式と最低出現回数が決まったので初期値として使えるが、運用で調整する前提。

### 11.3 効果を見てから判断

- 週献立への適用、再生成経路への適用
- 都度集計の実測レイテンシが 200ms に収まらない場合のキャッシュ行
- 見える／編集できるプロフィール画面
