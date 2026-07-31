# Primary adversarial design review: 初回家族設定の複数登録アテンション

| 項目 | 値 |
|------|-----|
| 対象 | `docs/archive/superpowers/specs/2026-07-31-onboarding-multi-member-attention-design.md`（`48136f1`） |
| 日付 | 2026-07-31 |
| 種別 | 設計書に対する敵対的レビュー（実装しない・read-only） |
| 判定 | **Needs revision**（一次レビュー時点） |
| 反映 | **2026-07-31 設計改訂済み** — 対象 spec に C-1〜C-3 / I-1〜I-7 / M-1〜M-3 を吸収。二次確認は改訂後 spec を正とする |
| 観点 | 状態機械（`onboarding_status` 遷移）、再訪・中断、既存 E2E/単体契約、2人目以降の文言、a11y、低リテラシー UX |

**照合した正本・実装**

- 対象設計: `docs/archive/superpowers/specs/2026-07-31-onboarding-multi-member-attention-design.md`
- Guided planner: `docs/archive/superpowers/specs/2026-07-22-guided-planner-optional-household-design.md` §8.1（`skipped` / `complete` 遷移・1人完了可）
- RPC: `supabase/migrations/20260722120643_optional_household_profiles.sql`（`set_onboarding_status` 遷移表）
- RPC: `supabase/migrations/20260715000300_atomic_household_onboarding_start.sql`（`complete` 時は後退させない）
- UI: `src/features/household/household-onboarding-page.tsx`（`handleCompleteClick` → `finishOnboarding`）
- 単体: `src/features/household/household-onboarding-page.test.tsx`（complete→setProgress→navigate 固定）
- E2E: `e2e/specs/onboarding.spec.ts`（完了ボタン直後 `/planner`、再訪で人数文言）
- Welcome / Root: `welcome-page.tsx`, `root-entry-page.tsx`（`in_progress` → `/welcome`）
- 既存 UI token: `src/styles.css`（`.inline-notice` 等）

---

## Verdict: **Needs revision**

問題設定（1人目完了で即 planner → 複数登録できないように見える）と Approach A（次アクションを挟む + 入力中 callout）の方向は正しい。DB/API 非変更・任意 onboarding 維持も健全。

ただし **「member complete と profile complete の分離」を正規状態にする変更**に対し、設計は遷移失敗・再訪・中断後の welcome 戻り・E2E 必須追随を十分に閉じていない。特に次アクションの tertiary skip は、`complete` 済み再訪では **RPC が `invalid_onboarding_transition` で拒否**する経路になり、設計の「再訪でも同じ次アクション UI」と衝突する。また 2人目フォームでも「まずは1人分から」callout を常時出すと、今回の目的（複数登録できると伝える）と自己矛盾する。

実装計画に進む前に Critical を設計本文へ反映すること。Important は計画 Task に落とせる粒度まで書くこと。

---

## Findings table

| ID | Severity | Section | Title |
|----|----------|---------|-------|
| C-1 | **Critical** | §5.2 tertiary, §4 再訪 | `complete` 済みで skip CTA を出すと RPC 遷移が必ず失敗する |
| C-2 | **Critical** | §6.2, §9, フロー | member complete 後 profile が `in_progress` のままが正規化するが、中断時の到達先・再入が未規定 |
| C-3 | **Critical** | §7.2, §8, E2E 実体 | `e2e/specs/onboarding.spec.ts` は「完了即 planner」を固定しており「あれば追随」では不足 |
| I-1 | Important | §5.1, ループ | 2人目以降の draft でも「まずは1人分から」callout が常時表示され誤解を生む |
| I-2 | Important | §5.2, e2e L35 | N===1 で人数行を省略可とすると、再訪アサーションと衝突し得る |
| I-3 | Important | §7.1 | 既存単体の「completeMember→setProgress 原子性」テストの書き換え契約が未ロック |
| I-4 | Important | §5.1, a11y | 静的 callout に `role="status"` は不適切（live region の誤用） |
| I-5 | Important | §5.2, UX | 次アクション遷移時のフォーカス／完了アナウンスが未規定 |
| I-6 | Important | §5.2 主 CTA | 二重タップ・pending 中 disable が未規定（既存 finish も弱いが分離で露呈しやすい） |
| I-7 | Important | §5.2 vs 設定 | 「設定の家族設定」導線が文言のみで、次アクションから `/settings` への明示リンクがない |
| M-1 | Minor | §5.1 | 見た目を「既存トークン」と書くが `.inline-notice` 等の正本クラス名が未ロック |
| M-2 | Minor | §7.1-7 | 「完了 API」が member complete と setProgress のどちらを指すか曖昧 |
| M-3 | Minor | 残余リスク | 主 CTA が「献立を始める」のままなので、読まずに押す利用者には問題が部分残存 |

---

## What the design gets right (non-exhaustive)

1. **痛みの記述が実装と一致**: `handleCompleteClick` は `completeMember` 成功後に `finishOnboarding()`（`setProgress("complete")` + `onDone`→`/planner`）を直列で呼ぶ。通常経路では draft 無し UI に留まらない。
2. **次アクション条件が state 機械として単純**: `draft === null && completeMembers.length > 0` はローカルフラグ不要で、リロード耐性がある。
3. **DB/API 非変更**: 既存 RPC の意味を変えず UI フローだけで解く方針は、Plan 7 契約を壊しにくい。
4. **1人で `complete` 可能な契約を維持**: 必須人数引き上げを Non-Goal にしたのは正しい。
5. **`start_household_onboarding` は `complete` を後退させない**: 「続けて家族を追加」は profile が既に `complete` でも draft 作成可能（migration コメントどおり）。
6. **主 CTA 1 タップで従来相当**: 次アクションを挟んでも「献立を始める」で従来の終端に届く。
7. **設定画面の大改修を外した**: スコープが実装可能なサイズに収まっている。

---

## Detailed findings

### [C-1] `complete` 済み再訪で skip が必ず失敗する — **Critical**

**Where**: §5.2 tertiary「あとで設定する（アイデアから始める）」→ `setProgress("skipped")`; §4 再訪「complete メンバー ≥1 で同じ次アクション」「`profiles.onboarding_status === complete` でも次アクション相当 UI を出してよい」。

**Code / contract today**

`set_onboarding_status` 許可遷移（`20260722120643_optional_household_profiles.sql` L54–58）:

| 現在 | 許可先 |
|------|--------|
| `not_started` | `in_progress`, `skipped` |
| `in_progress` | `complete`, `skipped` |
| `skipped` | `in_progress`, `complete` |
| **`complete`** | **なし（同一 status の冪等 return のみ）** |

`complete` → `skipped` は **`invalid_onboarding_transition`**。

**Why it's real**

1. 利用者が次アクションで「献立を始める」→ profile `complete`。
2. E2E / 手動で `/onboarding` に戻る（`onboarding.spec.ts` L33–35 がまさにこの再訪）。
3. 設計どおり次アクション UI（skip 付き）を出す。
4. skip 押下 → RPC 失敗 → 「スキップできませんでした…」。

初回の「まだ `in_progress`」のうちは skip は合法。問題は **設計が再訪を同一 UI に寄せたこと**と **skip を常時出すこと**の積。

**Not a false positive**: 遷移表に `complete` からの出口は無い。設計は API 非変更を Non-Goal にしているので、UI 側で CTA を分岐するしかない。

**Concrete design fix**（いずれかを本文にロック）:

- **A（推奨）**: 次アクションの skip は **profile が `not_started` / `in_progress` のときだけ表示**。`complete` / `skipped` では主 CTA「献立を始める（または献立に戻る）」+ 副「続けて家族を追加」のみ。`complete` 時の主 CTA は冪等 `setProgress("complete")` または **navigate のみ**（RPC 省略可）を明記。
- **B**: 再訪時は次アクションではなく設定相当の簡略 UI にし、skip を置かない。
- **C**: API で `complete`→`skipped` を許可する — **本設計の Non-Goal（DB/API 非変更）と衝突。採用するなら Non-Goal 改訂と guided-planner 再審査が必要**。

実装計画に「profile status を onboarding フォームがどう読むか」（既存 profile query の有無）も書くこと。現状 `HouseholdOnboardingForm` は **members のみ**で profile status を持たない可能性が高い → skip 表示条件のために **読取追加 or props** が要る（それでも API 書き込み契約は不変）。

---

### [C-2] member complete 後 `in_progress` のままが正規化し、中断時の世界が変わる — **Critical**

**Where**: §6.2「finishOnboarding は献立を始める押下時のみ」; §9「complete と setProgress の分離で状態不整合 | in_progress のままでよい」— **許容は書いてあるが、中断・再入の利用者体験が未規定**。

**Code today**

- `root-entry-page.tsx`: `not_started | in_progress` → `/welcome`（planner ではない）。
- `welcome-page.tsx`: `in_progress` では「家族設定を続ける」「設定せず献立アイデアを考える」。
- 旧実装: member complete と profile complete は同一操作でほぼ同時成功 → 成功利用者は `/planner` へ。

**Why it's real**

新フローでは member complete 成功直後〜「献立を始める」前が **意図的な中間状態**になる:

| 項目 | 旧 | 新（設計どおり） |
|------|----|------------------|
| member | complete | complete |
| profile | complete（直後） | **in_progress のまま** |
| タブを閉じた後の `/` | planner 側へ振り分け | **welcome に戻る** |
| 利用者が「登録できた」と思った後 | 献立へ | 次回起動で welcome 再表示 |

行き止まりではない（welcome → 続ける → 次アクション）。しかし:

1. **「設定が終わったのにまた最初の選択？」** という低リテラシー向けの裏切りになり得る。
2. 設計 §9 は開発者向けに「in_progress でよい」と書くだけで、**受け入れ基準に中断・再入シナリオが無い**。
3. 「続けて家族を追加」中も profile は `in_progress` のまま（`start_household_onboarding` は complete 以外を in_progress に保つ）— 複数人を登録してから献立へ、の経路では中間が長い。

**Concrete design fix**

本文に **正規中間状態**として明記する:

1. 許容: `profile=in_progress` かつ `complete` member ≥ 1。
2. 再入: `/` → welcome →「家族設定を続ける」→ `/onboarding` → **次アクション**（draft 無し）または draft フォーム。
3. welcome 文言の変更は **本設計の対象外**か **最小 copy だけ触る**かを決める。触らないなら「welcome 再表示は許容する残余リスク」と §9 に書く。
4. 受け入れに追加: 「member complete 後にリロードしても次アクション（または draft）に復帰し、データが消えない」。
5. （任意・推奨）「献立を始める」前にブラウザを閉じてもデータは残る、を §5.2 本文に一文。

「中間を嫌う」なら **member complete 成功時に裏で `setProgress("complete")` し、次アクションは navigate 遅延だけ**にする案もあるが、その場合 skip の意味・`complete` 後の追加との整合を再設計する必要があり、Approach A の単純さは落ちる。採用するなら C-1 とセットで書き直すこと。

---

### [C-3] E2E 正本が「完了即 planner」を固定しており、追随が必須 — **Critical**

**Where**: §7.2「E2E があれば追随」「新規フル E2E は必須条件にしない」; §8 受け入れに E2E 更新が無い。

**Code today** — `e2e/specs/onboarding.spec.ts`:

```text
L18: 「この家族の設定を完了する」click
L22: expect URL /planner   ← 次アクション導入で必ず壊れる
L33–35: /onboarding 再訪 → 「1人の設定が完了しています。」
```

同系統の「設定を完了」は settings 側文言の spec も多いが、**onboarding 専用の完了即 planner は本ファイルが正本**。

**Why it's real**

- 「あれば」ではなく **リポジトリに現存し CI で走る**。
- 設計がユニット中心に寄せると、E2E 赤のまま merge されうる。
- L35 の人数文言は §5.2「N===1 では人数行省略可」と衝突し得る（I-2）。

**Concrete design fix**

1. §7.2 / §8 を改訂: **`e2e/specs/onboarding.spec.ts` の更新は必須**。
2. 期待フローをロック:
   - 完了ボタン → **次アクション表示**（`/planner` に行かない）
   - 「献立を始める」→ `/planner`
   - 再訪 `/onboarding` → 次アクション（人数文言は I-2 と一致させる）
3. 他 E2E が onboarding 完了即 planner 前提なら「存在する範囲で追随」をチェックリスト化（少なくとも `onboarding.spec.ts` は列挙）。

---

### [I-1] 2人目以降でも「まずは1人分から」callout — **Important**

**Where**: §5.1「draft 表示中」常時・文言固定。フローは「続けて家族を追加 → 同じフォーム」。

**Why**

2人目入力中に「まずは1人分から登録しましょう」「最初は1人で十分です」は:

- すでに1人 complete の事実と矛盾する
- 「複数登録できる」という本改修のメッセージと逆行する

**Fix**

- `completeMembers.length === 0` のときだけ §5.1 文言
- `completeMembers.length ≥ 1` の draft では別 callout、例:  
  **「続けて家族を登録できます」** / **「何人でも登録できます。終わったら献立を始められます。」**  
  または callout 非表示 + 進捗のみ

本文に分岐表を1つ置くこと。

---

### [I-2] N===1 人数行の省略が再訪契約と衝突し得る — **Important**

**Where**: §5.2「N===1 では人数行を省略してよい」; e2e L35 `1人の設定が完了しています。`

**Fix**: どちらかに固定。

- **常に `N人の設定が完了しています。` を出す**（実装単純・E2E 容易）を推奨  
- 省略するなら e2e 期待を見出しベース（`1人目の登録が完了しました` / `登録が完了しました`）に変更すると §7 に書く

---

### [I-3] 単体テスト契約の書き換えが未ロック — **Important**

**Where**: §7.1 項目 2–5; 既存:

- `resumes ... completes through completeMember->setProgress->navigate`
- `stays ... when setProgress fails after completeMember succeeds`（member 成功後に setProgress が走る前提）
- `completes ... when a complete member already exists`（ボタン名「この家族の設定を完了する」）

**Fix**: §7.1 に **置換表**を書く。

| 旧 | 新 |
|----|-----|
| complete 成功で setProgress+onDone | complete 成功で **どちらも呼ばれない** + 次アクション文言 |
| setProgress 失敗が complete 直列 | **「献立を始める」**押下時の setProgress 失敗 |
| 既存 complete member の完了ボタン | ラベル **「献立を始める」** |

「回帰として維持」だけでは実装者が旧 assertion を残して赤、または意味の薄いテストを残す。

---

### [I-4] `role="status"` の誤用 — **Important**

**Where**: §5.1。

`role="status"` は **動的なライブリージョン**向け。静的な説明 callout に付けると:

- 支援技術が「更新」として扱ったり、過剰アナウンスしたりする
- プロジェクト既存の注意 UI は `.inline-notice` + 見出し（例: generation-resume-notice）パターン

**Fix**: 静的 callout は `section` + 見出し（`h2` または `p` + `class=inline-notice-title`）とし、`role="status"` は使わない。完了直後の一時メッセージが必要なら、そのときだけ status/alert を検討（I-5）。

---

### [I-5] 次アクション表示時のフォーカス / アナウンス未規定 — **Important**

**Where**: §5.2, §6.3。

member complete 後、フォーカスは完了ボタン（消えたり disabled になったりする）に残りがち。低視力・キーボード利用者は **画面が変わったことに気づきにくい** — 本改修の「見逃さない」目的と矛盾。

**Fix**（いずれかを必須化）:

- 次アクションの `h1` に `tabIndex={-1}` して `focus()`  
- または短命の `role="status"` で「1人目の登録が完了しました」を1回だけアナウンス  
- ユニットで「次アクション見出しが document に現れ、（可能なら）フォーカスされる」を §7.1 に追加

---

### [I-6] 「献立を始める」の pending / 二重送信 — **Important**

**Where**: §5.2 主 CTA。既存 `finishOnboarding` に pending フラグは無い。

分離後、次アクションで主 CTA が目立つため連打しやすい。`setProgress` は同一 status で冪等だが、**失敗表示と onDone のレース**（一方成功一方失敗）は残り得る。

**Fix**: 主・副・tertiary いずれも pending 中は disable（既存 skip の `skipPending` と同型）。§5.2 操作表に1列「pending 時」を追加。

---

### [I-7] 「設定で追加」が文言だけで導線が弱い — **Important**

**Where**: ユーザー要求「設定で家族追加可能」; §5.2 本文は言及のみ; 操作表に設定リンク無し。

副 CTA が「続けて家族を追加」（onboarding 内）なので設定導線は必須ではないが、callout が「設定画面から」と言う以上、**次アクションに「設定で家族を管理」リンク（`/settings`）を置くか、置かないなら callout を「このあと（この画面）や設定から」に寄せて過剰約束しない**かを決める。

現状 callout は「このあとや設定画面から」で onboarding 内追加と整合。次アクション本文も同様。**リンク無しを採用するなら「文言案内のみ・ディープリンク非対象」と Non-Goal に明示**。

---

### [M-1] 見た目トークン名が未ロック — **Minor**

`.inline-notice` / `.inline-notice-title` / `.inline-notice-body` が既存。設計がクラス名を固定すると実装とレビューが速い。

### [M-2] 「完了 API」の曖昧さ — **Minor**

§7.1-7 を「`completeMember` 失敗時はフォームに残り…」「`setProgress('complete')` 失敗時は次アクションに残り…」と分割。

### [M-3] 残余 UX リスク — **Minor（記録）**

主 CTA が献立のままなので、callout を読まない利用者は従来どおり1人で進む。本設計は「可能だと気づける」ことが目的なら妥当。§9 に「主 CTA 最適化は将来課題」と残してよい。

---

## Cross-check: guided-planner / RPC との整合

| 論点 | 判定 |
|------|------|
| 1人で `complete` 可 | 維持 — OK |
| `skipped` は draft を消さない | 変更なし — OK |
| `complete` 後に最後の member を削除しても profile complete 維持 | 本設計非対象 — OK |
| `start_household_onboarding` が complete を後退させない | 追加ループと整合 — OK |
| `complete`→`skipped` | **不可 — C-1** |
| member だけ complete で profile in_progress | **新規に頻度増 — C-2** |

---

## Suggested design revision checklist（実装前）

- [ ] **C-1**: skip CTA の表示条件を profile status で分岐。`complete` 再訪の CTA セットを表にする。必要なら profile 読取を File touch に追加。
- [ ] **C-2**: 中間状態 `in_progress` + complete member ≥1 を正規と明記。再入経路（welcome）と受け入れシナリオを追加。welcome copy の扱いに触れるか「触らない残余リスク」を §9 へ。
- [ ] **C-3**: `e2e/specs/onboarding.spec.ts` 更新を必須化。期待ステップを本文に書く。
- [ ] **I-1**: callout を completeMembers 数で分岐。
- [ ] **I-2**: 人数行の有無を一意に。
- [ ] **I-3**: 単体テスト置換表。
- [ ] **I-4 / I-5**: a11y（role とフォーカス）。
- [ ] **I-6**: pending disable。
- [ ] **I-7**: 設定リンクの有無を Non-Goal か操作表へ。

---

## Residual risks after fixes (acceptable)

- 主 CTA が献立のままだと、急ぐ利用者は1人登録のまま進む（製品として許容しうる）。
- welcome を触らない場合、中断後に welcome が再表示される違和感は残る（C-2 で文書化すれば実装ブロックではない）。
- onboarding 内マルチメンバーは設定画面と機能重複するが、本課題の「初回で複数できないように見える」には有効。

---

## Recommendation

**判定: Needs revision。**  
方向 APPROVE 相当だが、**C-1〜C-3 を設計本文に吸収するまで writing-plans に進まない**こと。改訂後は二次レビューで遷移表と E2E 期待だけ再確認すれば足りる規模。
