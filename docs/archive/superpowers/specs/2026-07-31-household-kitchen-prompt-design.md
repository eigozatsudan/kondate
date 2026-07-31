# 家庭キッチン前提の手順（プロンプト誘導）設計

| 項目 | 値 |
|------|-----|
| 文書 | `docs/archive/superpowers/specs/2026-07-31-household-kitchen-prompt-design.md` |
| 日付 | 2026-07-31 |
| 状態 | **Approved for implementation planning**（一次・敵対的 r2 吸収、二次 Approve） |
| 関連 | MVP `2026-07-11-kondate-mvp-design.md`、多様性 soft 誘導 `2026-07-30-ux-diversity-safety-design.md`（soft・成功率優先・kill-switch 思想を踏襲）、生成 prompt `netlify/functions/_shared/generation-prompt.ts` |
| 後方互換 | **不要**（本番未デプロイ前提。prompt 文字列変更のみ） |
| 一次レビュー | セッション内（2026-07-31）。I1–I6 / M1–M4 → r2 吸収 |
| 敵対的レビュー | `docs/archive/superpowers/specs/2026-07-31-household-kitchen-prompt-adversarial-review.md` |
| 二次レビュー | `docs/archive/superpowers/specs/2026-07-31-household-kitchen-prompt-secondary-review.md`（Approve） |

---

## Revision summary (r2)

| ID | 出典 | 反映 |
|----|------|------|
| I1 | 一次・敵対 | 文言骨格を soft 化。「満たせる範囲で寄せる」＋ success 逃げ道を必須化。単独の強い「だけで書く」命令を禁止 |
| I2 | 一次・敵対 | `HOUSEHOLD_KITCHEN_PROMPT_ENABLED`（default on）を lock。off 時はキッチン段落のみ省略 |
| I3 | 一次・敵対 | 挿入位置を **1 レシピ**に固定。non-conflict 列挙への「機材・器具の都合」拡張を必須 |
| I4 | 一次・敵対 | L6 を hard → preferences → キッチン soft → 多様性 → 季節 に再定義。DIVERSITY 段落は **更新しない** |
| I5 | 敵対 | 自由メモとキッチン方針の優先を 1 文で固定（メモは命令にしない。機材メモでも conflict にしない） |
| I6 | 一次・敵対 | テスト用安定 marker `【家庭キッチン】` と idea/household 必須 assert を固定 |
| I7 | 敵対 | 代用手順の長時間化 → 既存 `time_limit_exceeded` 等の **rate** リスクを §9 に明記。時間内で現実的、と skeleton に追加 |
| abs | 一次 I4 | 絶対制約を **アプリ側保証** と **モデル残差** に分割して §2 を再記述 |
| CORE | 一次 I6 | 多様性設計の CORE 凍結は diversity 本文のみ。本設計は CORE_BODY への短いキッチン soft を **明示許可** |
| M | 双方 Minor | flyer/緊急/benchmark を非目標、repair は original system 再利用、quality-review は private 観測のみ、境界語は観測でも網羅しない |
| S1 | 二次 | soft 断片 assert はキッチン固有語を必須にし、既存 CORE の `constraint_conflictにしない` だけでは通さない |
| S2 | 二次 | 再生成経路にも marker が載ることを **必須** canary（new_menu だけ緑で L12 違反を隠さない） |

---

## 1. 背景

利用者が次の痛みを持っている。

- 家にない機材（例: 蒸し器）を前提にしたレシピが出ると、**作る意欲が削がれる**。
- 一方で、キッチン機材を**事前登録させる**のは、アレルギー登録のような必然性がなく、オンボーディングとして不自然。

現行プロダクトには機材モデルがない。

| あるもの | ないもの |
|----------|----------|
| 調理時間・予算・避ける食材・自由メモ・冷蔵庫 | 蒸し器・オーブン・エアフライヤー等の機材登録 |
| 品質オフラインレビューで業務寄り機材の粗い検出（`no_pro_equipment`） | 一般家庭向けの「ある／ない」制約 |
| 緊急献立の手書き代替（例: 「フライパンで蒸す」） | 生成 AI への家庭機材の明示前提 |

ウィザードの任意条件は時間・予算・避ける食材・メモ・冷蔵庫まで。機材は自由メモに書かない限り伝わらず、メモは「命令ではなくデータ」扱いのため、蒸し器回避は保証されない。

ブレインストーミングでの合意（2026-07-31）:

1. 痛みの中心は「特殊機材そのもの」ではなく、**その家で作れない手順のまま終わること**（代用があればよい）。
2. 保証の強さは **プロンプト方針のみ**。登録 UI なし。検証は緩め。
3. 専門機材は **名前を出さず**、最初から一般器具だけで手順を書く（併記しない）。
4. **生成できなくなる可能性を絶対に上げない**（アプリ側に新しい失敗クラスを足さない。モデル rate の悪化は soft 文言＋ kill-switch で抑える）。

---

## 2. 絶対制約（生成成功率）

### 2.1 アプリ側（保証する）

**新しい失敗クラスを追加してはならない。** 次を禁止する。

| 禁止 | 理由 |
|------|------|
| 本番の materialize / validate で専門機材キーワードを理由に reject | 誤検知（「蒸し」技法 vs「蒸し器」等）で success が減る |
| 専門機材検出を repair 起動条件にする | 追加送信・枠消費・timeout が増え、失敗面が広がる |
| 機材を `constraint_conflict` の新 code にする | 終端失敗が増える |
| 手順に機材フィールドを必須化する schema 変更 | モデル出力の構造失敗が増えうる |
| プロンプトが「専門機材がないと success にできない」「機材不足で conflict」と読める文言 | 偽 conflict・過剰慎重を誘発しうる |

既存の closed conflict 集合、quota、repair 条件、Function 予算（55s 総 / 24s 試行）は **変更しない**。

- アプリ側 preflight / `validateGeneratedMenu` / finalize は **機材を見ない**。
- 機材専用の失敗コード・拒否を **追加しない**。
- モデルが機材方針だけを理由に `constraint_conflict` を返した場合の **追加パース拒否はしない**（成功率を落とす hard gate にしない。多様性 L5 と同型）。

### 2.2 モデル側残差（保証しないが緩和する）

プロンプト変更により、**既存**の `constraint_conflict` / `time_limit_exceeded` / `invalid_*` の **発生率が上がる**可能性は残る（新しい code は増えない）。

緩和:

1. soft 文言（§6.3）— 「満たせる範囲」「寄せきれなくても success」
2. 時間内で現実的な代用（工程水増し禁止）
3. kill-switch `HOUSEHOLD_KITCHEN_PROMPT_ENABLED`（L11）— 悪化が明らかなら off または弱体化
4. 受け入れは文言存在とアプリ側差分ゼロまで。**ライブ success rate の事前測定は必須にしない**（残差として明示受容）

---

## 3. 人間と合意済みのロック

| # | 決定 |
|---|------|
| L1 | 手段は **system プロンプトのキッチン soft 段落**のみ（validate/UI/DB なし） |
| L2 | **機材登録 UI / DB / preference フィールドを作らない** |
| L3 | 専門機材は **併記しない**。満たせる範囲で最初から基本器具の手順に寄せる |
| L4 | 本番 validate / repair 条件 / conflict code / OpenRouter JSON schema は **触らない** |
| L5 | 機材方針違反は **conflict 理由にしない**（プロンプトにもそう書く） |
| L6 | 優先順位（キッチン段落内に短く書く。`DIVERSITY_PARAGRAPH` の番号リストは **今回更新しない**）: **hard**（アレルギー・必須安全・must_use・品数・時間）→ **preferences**（main / avoid / budget / ingredientPreference / genre 等）→ **キッチン soft（本方針）** → **多様性** → **季節**。メモは命令ではなくデータ（既存）。メモに専用機材希望があっても機材を理由に conflict にせず、キッチン soft は preferences より弱く hard より弱い |
| L7 | idea / household の新規生成、同じ CORE を使う再生成、および **repair（originalMessages 再利用）** に同じ方針が乗る。repair 用の第二 system は作らない |
| L8 | テストは marker／固定断片の存在まで。モデルが常に守ることの保証テスト・E2E の「蒸し器ゼロ」ゲートは置かない |
| L9 | 品質オフラインレビュー（`no_pro_equipment`）のキーワード拡張は **任意・観測のみ**。本番経路に接続しない。拡張する場合は **機材名**（蒸し器）を対象にし技法（蒸）で広く取らない。配列は quality-review ファイル内に留め `shared/safety` へ export しない |
| L10 | 追加文は **短く**（marker 1 行＋おおよそ 3〜6 文）。CORE_BODY 希釈を避ける |
| L11 | 定数 `HOUSEHOLD_KITCHEN_PROMPT_ENABLED`（`netlify/functions/_shared` 内、default **`true`**）。`false` のときキッチン段落（marker 付きブロック）と outcome 列挙への「機材・器具の都合」追記を **両方省略**。hard 拒否はしない。conflict / invalid / timeout 率が明らかに増えたら off または段落弱体化 |
| L12 | 多様性設計の「CORE に diversity を埋め込まない」は **diversity 本文専用**。本設計は `GENERATION_SYSTEM_PROMPT_CORE_BODY` への短いキッチン soft を **明示許可**する。キッチンを new_menu の diversity スロットだけに置いて再生成から外すことは **禁止** |
| L13 | テスト安定 marker は `【家庭キッチン】`（定数として export 可）。idea と household の new_menu system の両方で marker 出現を必須 assert |

---

## 4. Goals & Non-Goals

### Goals

- 生成手順が、多くの一般家庭で **手元の基本器具だけで実行できる**方向に寄る。
- 「蒸し器がない」などで意欲が削がれる体験を減らす。
- 登録・設定・追加の質問ステップを増やさない。
- 既存の生成成功経路・失敗クラス・quota を壊さない（§2.1）。

### Non-Goals

- キッチン機材の登録 UI / DB / preference
- 結果画面の「この機材がない」フィードバック学習
- 本番 validate の hard gate、機材キーワード reject、repair 条件追加
- オーブン有無・IH/ガスなど家ごとの細分化
- 専門機材名＋代用の併記 UI
- 緊急献立 fixture の全面書き換え
- **チラシ週間献立**（`flyer-weekly-service.ts` 独自 system）、benchmark 専用文、緊急献立 fixture への同方針強制
- 自由メモの「蒸し器を使って」等への専用例外経路（§6.3 の 1 文で優先だけ固定）
- モデルが専門機材を二度と出さないことの保証
- ライブ success rate の事前 A/B 測定を実装完了条件にすること
- 本番デプロイ・push

---

## 5. 想定キッチンと手順ルール

### 5.1 想定する基本キッチン（allow）

手順の前提に使ってよい器具・手段（日本の一般家庭）:

| 分類 | 例 |
|------|-----|
| 切る | 包丁、まな板 |
| 加熱（直火・IH を区別しない） | フライパン、片手鍋・両手鍋、ふた |
| レンジ | 電子レンジ |
| 炊飯 | 炊飯器（ごはんを炊く前提は可。時間枠と矛盾する長時間炊飯は既存の時間整合の問題として扱い、本設計の機材禁止対象にしない） |
| 計量・和える | ボウル、箸、スプーン、ザル |
| 下ごしらえ | 湯通し、茹でる、炒める、煮る、焼く、電子レンジ加熱 |

ガス／IH の区別、オーブン有無、メーカー差は **聞かない・出さない**。

### 5.2 手順の前提にしないもの（avoid 名指し・soft）

満たせる範囲で、料理名や手順の **必須前提として出さない**（最初から基本器具の手順に寄せる）:

- 蒸し器・せいろ・専用スチーマー
- フードプロセッサー・ミキサー・ブレンダー
- エアフライヤー
- オーブン・オーブントースターを **必須** とする工程
- ホットプレート・電気圧力鍋・スープメーカー等の専用家電
- 業務寄り（真空調理、ソスヴィ、パコジェット、ブラストチラー、中華レンジ 等）

### 5.3 技法の書き換え（最初から基本器具へ寄せる）

| やりたいこと | 寄せる前 | 満たせる範囲でこう書く |
|--------------|----------|------------------------|
| 蒸す | 蒸し器に並べて… | フライパンに少量の湯＋材料、**ふたをして**蒸し焼き／電子レンジで加熱 等 |
| 細かく砕く・ペースト | ミキサーにかける | 包丁でみじん切り／フォークでつぶす 等 |
| カリッと揚げる代替 | エアフライヤーで… | フライパンで焼く・少量の油で炒める 等 |
| オーブン焼き | オーブン 200℃で… | フライパンや鍋で焼く・煮る・レンジ 等（**時間内で現実的**な方法） |

「蒸し器があれば／なければ」の **併記はしない**。

### 5.4 意図的に曖昧にするもの

- 「トースター」「グリル」など境界的な語は、**網羅リストで本番拒否しない**。quality-review の任意拡張でも境界語の網羅は推奨しない（過剰拒否の温床）。
- プロンプトは否定の長い列挙より、**肯定側**（フライパン・鍋・電子レンジ中心）を主にする。
- 自由メモに専門機材利用が書かれても専用例外経路は作らない。優先は L6 / §6.3。

---

## 6. 実装仕様

### 6.1 変更対象

| 対象 | 変更 |
|------|------|
| `netlify/functions/_shared/generation-prompt.ts` の `GENERATION_SYSTEM_PROMPT_CORE_BODY` | キッチン soft ブロックを **条件付き合成**（flag on 時）で含める。実装は (a) BODY 定数を「共通 hard + kitchen 可変」に分ける、または (b) `buildSystemPrompt` / `buildNewMenuSystemPrompt` で CORE_BODY 相当を組み立てる、のいずれか。**flag off 時はキッチン段落も outcome の機材句も出ない**こと |
| 同上 outcome の non-conflict 列挙 | flag on 時のみ「機材・器具の都合」を並列追加 |
| `HOUSEHOLD_KITCHEN_PROMPT_ENABLED` | `netlify/functions/_shared` 内の定数、default `true`（多様性 `DIVERSITY_HINTS_ENABLED` と同型の読み方でよい） |
| `GENERATION_SYSTEM_PROMPT_SEASON` / `DIVERSITY_PARAGRAPH` / mode extra | **触らない** |
| planner 契約・DB・UI・OpenRouter schema | **触らない** |
| materialize / validate / repair 条件 / conflict code | **触らない** |

**repair:** `generation-service` は repair 時に `originalMessages` を再利用し system を作り直さない。初回 system にキッチン方針が含まれていれば repair にも乗る。追加 system は不要（L7）。

**CORE 権限:** 多様性設計が禁じているのは diversity 本文の CORE 恒久埋め込みである。本設計のキッチン soft の CORE_BODY（または同等の全経路共通組み立て）への配置は **許可**（L12）。new_menu 専用スロットのみへの配置は **禁止**（再生成から消える）。

### 6.2 挿入位置（固定レシピ — 二者択一禁止）

flag on のとき、system 本体は次の順だけを正とする:

1. 既存 hard 構造契約（品数、refs、pantry、timeline、ingredientPreference まで）— 現状どおり
2. **キッチン soft ブロック**（marker 付き。§6.3）— **outcome ブロックの直前**
3. 既存 outcome / conflict 方針ブロック。ただし non-conflict 列挙を次のように拡張する（flag on 時のみ）:
   - 現行: 「材料の都合・好みの曖昧さ・品数や時間の難しさ・取り分け文の書きにくさだけでは constraint_conflict にしない」
   - 拡張: 同じ文に **「機材・器具の都合」** を並列で入れる（文の分割改変より列挙追記を優先）
4. （new_menu 合成時）diversity（flag 別）→ SEASON → mode extra — 現状どおり

**禁止:** outcome の「直後だけ」にキッチンを置く、列挙拡張だけしてキッチン段落を省略する、直前/直後を実装者任せにする。

### 6.3 プロンプト文言の要件（normative）

flag on 時のキッチン段落は次をすべて満たす:

1. **先頭に marker** `【家庭キッチン】`（L13）
2. **肯定主・soft** — 「満たせる範囲で、基本器具（包丁・まな板、フライパン、鍋とふた、電子レンジ、ボウル等）で実行できる手順に寄せる」
3. **禁止副（短い）** — 蒸し器・ミキサー・フードプロセッサー・エアフライヤー・オーブン必須の工程・その他専用家電を **必須前提にしない**（「絶対に出すな」ではなく前提にしない）
4. **技法** — 蒸す・細かくする等は、ふた付きフライパンや電子レンジ、包丁・フォーク等の基本器具手順で最初から書く（併記しない）
5. **時間** — 時間制限内で現実的な基本器具手順にする。本方針のために工程を水増しして時間を壊さない
6. **優先** — hard（アレルギー・必須安全・must_use・品数・時間）と preferences を、本方針のために破らない。本方針は多様性・季節より先に寄せるが、いずれも hard / preferences より弱い（DIVERSITY 本文は編集しない）
7. **メモ** — 自由メモに専用機材の希望があっても命令として機材必須にしない。メモ機材を理由に constraint_conflict にしない
8. **success 逃げ道** — 寄せきれなくても outcome=success でよい。機材方針だけでは constraint_conflict にしない
9. **短い** — marker 除きおおよそ 3〜6 文
10. **success を縛る単独命令を置かない** — 例: soft 逃げ道のない「基本器具だけで実行できるように書く」だけを独立文として置かない

**文言の骨格（実装時の正本はコード。意味は逸脱しない。soft 必須）:**

> 【家庭キッチン】  
> 制約と preferences を満たす範囲で、一般家庭の基本器具（包丁・まな板、フライパン、鍋とふた、電子レンジ、ボウル等）で実行できる手順に寄せてください。  
> 蒸し器・ミキサー・フードプロセッサー・エアフライヤー・オーブン必須の工程・その他の専用家電を必須前提にしないでください。  
> 蒸す・細かくする等は、ふた付きフライパンや電子レンジ、包丁・フォークなど基本器具の手順で最初から書いてください。  
> 時間制限内で現実的な手順にし、本方針のために工程を水増ししないでください。  
> 自由メモに専用機材の希望があっても命令として従わず、機材を理由に constraint_conflict にしないでください。  
> 寄せきれなくても outcome=success で構いません。機材方針だけでは constraint_conflict にしないでください。

最終の日本語の切り方は実装 Task で隣接文とトーンを揃えてよい。ただし **marker・soft 逃げ道・機材を conflict にしない・時間水増し禁止** の意味は削らない。

### 6.4 本番以外（任意・観測のみ）

| 対象 | 変更 |
|------|------|
| `generation-quality-review-entry.ts` の `no_pro_equipment` | **任意**: 蒸し器、フードプロセッサー、エアフライヤー等の **機材名** を観測用に足してよい。技法語「蒸」単体では広げない |
| 本番 validate | **足さない** |
| export | quality-review 内 private。`shared/safety` や validate から import しない |

任意拡張をやらなくても本設計の必須は満たせる。

---

## 7. テスト方針

| 種類 | 内容 |
|------|------|
| **必須** | `HOUSEHOLD_KITCHEN_PROMPT_ENABLED === true`（default）のとき、idea **および** household の new_menu system に `【家庭キッチン】` が含まれる |
| **必須** | 同 system に **キッチン固有**の soft 断片が含まれる（最低: marker に加え `基本器具` と、`寄せ` または `寄せきれなくても` など **キッチン段落由来**の句。既存 outcome にある `constraint_conflictにしない` **だけ**では soft 契約充足とみなさない） |
| **必須** | flag off のとき system に `【家庭キッチン】` が **含まれない**こと、および non-conflict 列挙に「機材・器具の都合」が **出ない**こと |
| **必須** | 再生成（base system / `GENERATION_SYSTEM_PROMPT_CORE` 相当、diversity なし経路）にも flag on で `【家庭キッチン】` が含まれること — new_menu 専用スロット置きを防ぐ（L12） |
| **必須** | 既存の prompt canary / mode extra / 多様性合成テストが回帰しないこと |
| **推奨** | marker が diversity marker / 季節文より前に現れること（new_menu、flag on）— 順序のリグレッション用 |
| **禁止** | 専門機材キーワードで validate 失敗する本番テストを success 条件にしない |
| **禁止** | e2e で「蒸し器が出ない」を生成成功のゲートにしない |

---

## 8. 受け入れ条件

### 満たせば完了

1. flag default on で、idea / household の system に `【家庭キッチン】` 付き soft 方針が入る。
2. 同じ組み立てが再生成・repair（originalMessages）にも乗る（L7 / L12）。
3. DB・UI・planner 契約・validate / repair 条件 / conflict code / schema に差分がない。
4. §7 の必須テストが通り、既存 prompt テストが回帰しない。
5. flag off でキッチン段落が消える（L11）。
6. 設計・実装コメント上、機材方針は soft であり conflict / reject しないことが読み取れる。

### 完了とみなさないもの

- モデルが専門機材を二度と出さないことの保証
- 本番の機材キーワード検査
- 機材登録・フィードバック UI
- 生成 E2E での「蒸し器ゼロ」アサーション
- ライブ success rate の数値改善証明

### 絶対に壊してはいけないもの

- アプリ側の新しい失敗クラスを増やさないこと（§2.1）
- アレルギー・must_use・品数・時間・quota・repair 条件の契約

---

## 9. リスクと緩和

| リスク | 緩和 |
|--------|------|
| 指示が増えて他 hard 制約の遵守が薄れる | 短文（L10）、優先順位（L6）、outcome 近傍、flag |
| soft 不足の強い命令で偽 conflict / 過剰慎重 | §6.3 soft 必須・success 逃げ道（r2 I1） |
| 代用手順の長時間化 → `time_limit_exceeded` / repair 増 | skeleton の時間水増し禁止。残差は L11 で off |
| モデルが「オーブン不可」を拡大解釈して献立が単調に | allow 肯定列挙。技法禁止ではなく器具必須前提を避ける |
| モデルが機材不足で `constraint_conflict` を返す | プロンプトで conflict にしない。追加パース拒否はしない |
| 将来誰かが validate に接続したくなる | §2.1 / L4。plan で validate 差分ゼロ。quality 語彙を shared に出さない |
| メモ「蒸し器を使って」との競合 | L6 / §6.3: メモは命令にしない。conflict にしない |
| 境界語（トースター / グリル）の揺れ | 意図的非網羅。観測でも広げない |
| flyer 等への誤拡張 | Non-Goals で明示除外 |

---

## 10. 変更規模

- 実質 **`generation-prompt.ts`（＋ flag 定数）** と **`generation-prompt.test.ts`** が必須。
- 契約・DB・UI・HTTP 面はゼロ。
- 実装 plan は **単一の小さな Task** で足りる想定（flag + 段落 + テスト）。

---

## 11. Spec supersede / 関連設計との関係

| 対象 | 関係 |
|------|------|
| MVP `2026-07-11-kondate-mvp-design.md` | 希望条件・自由メモ・安全制約の枠は維持。機材 preference は **追加しない** |
| 多様性 `2026-07-30-ux-diversity-safety-design.md` | soft・hard 拒否禁止・成功率優先・kill-switch 思想を踏襲。`DIVERSITY_PARAGRAPH` 本文と diversity の CORE 非埋め込みルールは変更しない。キッチンは CORE 共通側に置き、diversity の番号リストは更新しない（L6 / L12） |
| 品質レビュー | 本番契約外の任意観測のみ |

本設計は MVP の機材登録を新設せず、**生成 system 文の soft 品質誘導**として追加する。

---

## 12. 実装順序（plan 用の粗い指針）

1. RED: idea / household で `【家庭キッチン】` と soft 断片、flag off で非出現を assert。
2. GREEN: flag 定数 + CORE 組み立てに §6.2 / §6.3 を実装。outcome 列挙に機材句。
3. 既存 prompt テスト・typecheck・lint・format:check。
4. （任意）quality-review の機材名観測キーワード。
5. validate / materialize / schema に差分が無いことを `git diff` で確認。

詳細 Task 分解は `writing-plans` で行う。
