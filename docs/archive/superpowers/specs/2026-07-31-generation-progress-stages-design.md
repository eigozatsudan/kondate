# 献立作成中の段階進捗表示（体感用）設計書

| 項目 | 値 |
|------|-----|
| 文書 | `docs/archive/superpowers/specs/2026-07-31-generation-progress-stages-design.md` |
| 日付 | 2026-07-31 |
| 状態 | **Approved（レビュー改訂済み）** — 一次・敵対的・二次レビュー反映。writing-plans 可 |
| 対象 | `/generation` の `GenerationStatusPanel`（`submitting` / `processing`） |
| 関連 | MVP `2026-07-11-kondate-mvp-design.md`（生成状態 API・processing 画面）、Plan 3 生成結果 |
| レビュー | `docs/archive/reviews/2026-07-31-generation-progress-stages-design-primary.md` / `-adversarial.md` / `-secondary.md`（統合 ID **V-C1〜V-I4** を本改訂で吸収） |

---

## 1. 背景と問題

献立作成は Netlify Function がプロンプト組み立て → OpenRouter 呼び出し → 検証 / repair → 保存までを**同一 POST 内で同期実行**する（Function 予算はおおよそ 55s 級）。クライアントは主に次の phase を見せる。

| phase | 現状の進捗文言 | 典型の待ち |
|-------|----------------|------------|
| `checking` | 保存した作成状況を確認しています | 短い status 照会 |
| `submitting` | 条件を確認しています（固定） | **初回 POST の長時間** |
| `processing` | 料理の組み合わせと全体の段取りを確認しています（固定） | 再開・ポーリング中 |

サーバの status は `not_started` / `processing` / `succeeded` / `failed` / `constraint_conflict` のみで、**下位ステージはない**。待ちの大半で文言が1行のまま変わるため、「止まっている」ように感じやすい。

ユーザー要求: 「プロンプト作成中」「AI 問い合わせ中」など、作成中の進捗を細かく見せたい。優先は**正確なサーバ同期ではなく体感の改善**。

主待ちは通常 **`submitting` 中の同期 POST** である。`processing` はリロード復帰・`visibilitychange` 経由の status 再取得などで POST 完了前に phase が切り替わる場合にも出る（`use-generation-recovery`）。

---

## 2. 目的と非目的

### 2.1 目的

1. `submitting` と `processing` の待ち中に、日本語の**段階メッセージが時間経過で切り替わる**。
2. 既存の見出し・補足・脱出導線（RecoveryLinks）・終端画面は壊さない。
3. **クライアントのみ**で完結し、契約・DB・Function を変更しない。

### 2.2 非目的

- 実サーバ工程との厳密な同期（「AI に…」表示中が必ず OpenRouter 中である保証はしない）
- 完了％・残り秒の予測バー
- status API / `GenerationStatusData` / DB / Netlify Functions の変更
- プロンプト本文・モデル ID・生 AI 出力・アレルギー等の表示（プライバシー不変条件）
- `checking` / `offline` / 終端 phase の細分化
- ステップ点・プログレスバー等の追加 UI（本設計は**段階テキストのみ**）
- processing 序盤の stage0 文言を phase 別に分けること（同一表を維持。R6）

### 2.3 成功受け入れ

| シナリオ | 期待 |
|----------|------|
| 新規作成で `submitting` が 10 秒続く | 進捗1行が少なくとも「条件を確認…」から「AI に献立案を…」帯へ進む |
| `processing` で `startedAt` が 35 秒前 | **`render` 直後（タイマー進行なし）**の初期表示が「組み合わせと段取り…」帯（§3 の表 index 3） |
| 3 秒で成功終端 | 途中段階を飛ばして終端 UI。進捗タイマーは止まる |
| `submitting` → `processing` に遷移 | 文言は**時間上前進のみ**（後ろに戻らない）。`active` は true のまま |
| リロードで processing 復帰 | 正規化済み `startedAt` 基準の経過で正しい帯。補足・RecoveryLinks は現状どおり |
| checking / failed / offline | 現状文言のまま（段階表を DOM に出さない） |
| unit | 境界 ms・前進ガード・同期初期評価・パネル配線・a11y 追随のテストが通る |

---

## 3. 段階表（ロック）

体感用の固定スケジュール。秒数はおおよその尺であり、実処理とは一致しない。

| index | 経過 `elapsedMs`（以上〜未満） | 表示文言 |
|------:|--------------------------------|----------|
| 0 | `0` ≤ t < `3_000` | 条件を確認しています |
| 1 | `3_000` ≤ t < `8_000` | 献立の指示を組み立てています |
| 2 | `8_000` ≤ t < `30_000` | AI に献立案を聞いています |
| 3 | `30_000` ≤ t < `45_000` | 組み合わせと段取りを整えています |
| 4 | `45_000` ≤ t | 仕上げの確認をしています |

processing の**現行**固定文「料理の組み合わせと全体の段取りを確認しています」は本表に置き換える。文言の後方互換は求めない（L3）。

### 3.1 選択規則

- `selectGenerationProgressStageIndex(elapsedMs)` は上表で `elapsedMs >= afterMs` を満たす最大 index を返す（**必須 export**）。
- `selectGenerationProgressMessage(elapsedMs)` はその index の文言を返す。
- `elapsedMs < 0` または非有限は `0` として扱う。
- `submitting` と `processing` で**同一表**を使う。

### 3.2 前進のみ（L1）

phase 跨ぎやアンカー再計算で計算上の index が下がっても、**一度出した index より小さい文言へ戻さない**。

- フック内で `maxStageIndexSeen` を保持し、表示 index = `max(calculated, maxStageIndexSeen)`。
- リセットは **`active === false` または unmount のみ**。
- **phase が `submitting` → `processing` に変わっただけでは `active` を false にしない**（V-I1）。L1 と「active false でリセット」は、同一 hook インスタンスで `active` が true のまま跨ぐことでのみ両立する。

### 3.3 アンカー時刻（L2）と正規化責務（V-I4）

| phase | アンカーの正 |
|-------|----------------|
| `submitting` | sticky なクライアント入場時刻（§4.2 V-C1）。外部から有限 `anchorMs` を渡してもよいが、通常は `null` で hook が capture |
| `processing` | L2 正規化後の `startedAt` epoch ms。正規化失敗時は `null`（hook が sticky now にフォールバック） |

**L2 正規化は panel（または専用 helper）が行い、hook には finite `number | null` のみ渡す。hook 内で `Date.parse` や NaN 演算をしない（V-I4）。**

```ts
// panel / helper の契約（疑似）
function resolveProcessingAnchorMs(startedAt: string, nowMs: number): number | null {
  const parsed = Date.parse(startedAt);
  if (!Number.isFinite(parsed)) return null;
  if (parsed > nowMs + 5_000) return null; // 未来 5s 超
  return parsed;
}
```

- 遠過去の `startedAt` は**そのまま**使い、経過が大きいと最終帯になる（リロード復帰・ハングの意図。D-I4 Reject）。
- `elapsedMs = nowMs - resolvedAnchorMs`（resolved は §4.2 の sticky 規則後）。

---

## 4. 構成

すべてブラウザ専用（`src/features/generation/`）。所有境界を跨がない。

### 4.1 純関数 `model/progress-stages.ts`

- 定数 `GENERATION_PROGRESS_STAGES: readonly { afterMs: number; message: string }[]`（§3 表と同一・昇順）
- `selectGenerationProgressStageIndex(elapsedMs: number): number`（必須）
- `selectGenerationProgressMessage(elapsedMs: number): string`（必須）

コメントは日本語で「体感用・サーバ工程と一致しない」と明記する。純関数は **L1 ガードなし**（表示用の max はフックが正）。

### 4.2 フック `hooks/use-generation-progress-message.ts`（V-C1 / V-C2）

入力・出力:

```ts
type Args = {
  active: boolean;
  /**
   * finite な epoch ms、または null。
   * null = sticky クライアント now を hook が 1 回 capture（毎 tick 差し替え禁止）。
   * processing は panel が L2 正規化済みの値を渡す（不正時 null）。
   */
  anchorMs: number | null;
};

type GenerationProgressView = {
  message: string;
  /** L1 適用後の表示 index（data-progress-stage と status 本文の正） */
  stageIndex: number;
};
// returns: GenerationProgressView
```

#### 4.2.1 Sticky アンカー（V-C1）— 再導出禁止

内部に `resolvedAnchorMsRef`（または同等）を持つ。

1. `active === false`  
   - interval なし。`maxStageIndexSeen = 0`。`resolvedAnchorMsRef` をクリア。  
   - 戻りは **index 0** の `{ message, stageIndex: 0 }`（DOM には出さない）。
2. `active === true` の評価（初回および以降）  
   - `anchorMs` が finite かつ「now より 5s 超未来」でない → それを resolved とし ref に保持（外部有効値への切替は ref を**更新**する。例: submitting→processing で `startedAt` が来たとき）。  
   - それ以外（`null` / 非有限 / 遠い未来）→ **ref が空のときだけ** `Date.now()` を capture して ref に入れる。  
   - **禁止:** 各 interval tick で `Date.now()` をアンカーに差し替えて `elapsed ≈ 0` にすること。  
3. リセット: `active` false→true、または unmount。submitting 再入場（active が一度 false を経由）で新しい sticky now。

#### 4.2.2 同期初期評価（V-C2）— 再導出禁止

- `active === true` のとき、**初回 render（またはそれに相当する同期計算）および `active` / 入力 `anchorMs` の変化時に、interval を待たず** `elapsedMs` と L1 適用後の `message` / `stageIndex` を計算して返す。
- `setInterval(1000)`（**1000 ms 固定**。「約」ではない）は、その後の経過更新専用。
- 初回を stage0 に固定してから 1s 後に直す実装は受け入れ不合格。
- unmount / `active → false` で interval 解除と `maxStageIndexSeen` リセット。
- タブ非表示中も interval は動かしてよい。status poll の `document.hidden` スキップとは独立。

### 4.3 UI `GenerationStatusPanel`（V-I1）

#### 配線（ロック）

```tsx
// 疑似: phase の early return より前で必ず呼ぶ（Rules of Hooks）
const phase = state.phase;
const active = phase === "submitting" || phase === "processing";
const anchorMs =
  phase === "processing"
    ? resolveProcessingAnchorMs(state.data.startedAt, Date.now())
    : null; // submitting: sticky は hook（V-C1）
const { message, stageIndex } = useGenerationProgressMessage({ active, anchorMs });
// 以降 phase 分岐。checking / offline / 終端では message を DOM に出さない
```

- **単一 hook インスタンス**。submitting / processing で別 hook をマウントし直さない。
- submitting→processing で `active` を false にしない（L1）。

#### 表示

- `submitting`: 固定「条件を確認しています」を `{message}` に置換。`role="status"` / `aria-live="polite"` は維持（1 要素）。
- `processing`: 見出し「献立を作っています」・補足2行・RecoveryLinks は現状維持。進捗の1行だけ `{message}` に置換。
- **`data-progress-stage={stageIndex}` を進捗行またはパネルルートに必須付与**（表示文言には使わない。L1 適用後の index のみ。V-M1 を必須に格上げ）。

#### 変更しない

- `checking` / `offline` / 終端（succeeded は Navigate、failed / constraint_conflict / request_conflict）
- `data-phase` 属性値
- ポーリング間隔（2s）や `generation-machine` の phase 定義

### 4.4 触らないもの（ロック）

- `shared/contracts/generation.ts` および status / command スキーマ
- `netlify/functions/**`、DB マイグレーション、RPC
- `ai_generation_requests` の列追加や progress stage 永続化
- ログへのプロンプト / 生 AI 出力の追加

---

## 5. 境界条件まとめ

| 状況 | 振る舞い |
|------|----------|
| すぐ成功 | 途中段階スキップ可。`active` false でタイマー停止 |
| `submitting` → `processing` | `anchorMs` を正規化 `startedAt` へ更新。L1 で後退禁止。`active` は true のまま |
| リロード processing | 正規化 `startedAt` から**同期**に正しい帯。補足・RecoveryLinks 現状どおり |
| `startedAt` 不正 / 未来 5s 超 | panel が `null` → hook sticky now（L2） |
| 遠過去 `startedAt` | そのまま → 最終帯になり得る（意図） |
| offline / 終端 / 離脱 | `active` false。進捗 DOM なし。interval 解除 |
| 長時間ハング | 最終帯のまま。RecoveryLinks で脱出（既存） |
| `visibilitychange` 中の status が processing | phase だけ変わっても L1 維持（R7） |

---

## 6. テスト

### 6.1 必須

1. **`progress-stages.test.ts`**  
   境界: 0, 2999, 3000, 7999, 8000, 29999, 30000, 44999, 45000, 大きい値、負数、非有限。
2. **`use-generation-progress-message.test.tsx`**（fake timers）  
   - **`render` 直後（`advanceTimers` なし）**で過去 `anchorMs`（例: now−35_000）→ index 3 文言（V-C2）  
   - `anchorMs: null` で sticky: 時間経過後に stage が進む（V-C1）。tick ごとに stage0 に戻らない  
   - active 後に 1000ms 間隔で文言が進む  
   - inactive で止まる / リセット  
   - アンカーが後ろにずれても前進のみ（L1）  
   - submitting 相当（null sticky で index≥2）のあと `anchorMs` を now に切替えても index が戻らない
3. **`generation-status-panel.test.tsx`**  
   - **`NOW` 相対の `startedAt`** のみ使う（絶対日時 `2026-07-11` を進捗 assert に使わない。V-I3）  
     - 例: `NOW` → index 0 帯、`NOW - 10_000` → index 2、`NOW - 35_000` → index 3、`NOW - 60_000` → index 4  
   - submitting / processing で `role="status"` が表の文言、かつ `data-progress-stage` が L1 後 index  
   - checking / failed / RecoveryLinks の既存期待を壊さない  
   - unmount で interval が残らない（fake timers と整合）
4. **`src/app/accessibility.test.tsx`**（V-I2・必須）  
   - processing の **旧固定文言**「料理の組み合わせと全体の段取りを確認しています」assert を削除または更新  
   - `startedAt` を frozen now 相対にするか、status を「§3 表のいずれかの文言」に緩める  
   - 見出し「献立を作っています」・`role="status"` 存在・axe は維持

### 6.2 任意・非必須

- E2E での時間経過 assert はフレークしやすいため本設計の必須ゲートに含めない。
- 必要なら別 Task で「作成中画面に `role=status` がある」程度の弱い確認に留める。

### 6.3 検証コマンド（実装時）

Task 実装後は Docker 経由で、少なくとも対象テスト（上記 4 系統）+ `typecheck` + `lint` + `format:check` を実行する（プロジェクト常規）。フル `vitest run` では a11y を含む。

---

## 7. 実装ファイル一覧

| パス | 操作 |
|------|------|
| `src/features/generation/model/progress-stages.ts` | 新規 |
| `src/features/generation/model/progress-stages.test.ts` | 新規 |
| `src/features/generation/hooks/use-generation-progress-message.ts` | 新規 |
| `src/features/generation/hooks/use-generation-progress-message.test.tsx` | 新規 |
| `src/features/generation/components/generation-status-panel.tsx` | 変更（進捗1行・L2 正規化・hook 配線） |
| `src/features/generation/components/generation-status-panel.test.tsx` | 変更（相対時刻・段階表示） |
| `src/app/accessibility.test.tsx` | 変更（processing status の固定旧文追随） |

実装計画 Task 分割の目安（writing-plans で確定）:

1. model 純関数 + テスト（RED/GREEN）
2. hook（V-C1/V-C2/L1）+ テスト
3. パネル配線 + panel / a11y テスト

---

## 8. 人間と合意済みのロック（再導出禁止）

| # | 決定 |
|---|------|
| L0 | 方針 **A**: 経過時間によるクライアント側文言切替。サーバ stage は採用しない |
| L1 | 文言は**前進のみ**（後退禁止）。リセットは `active` false / unmount のみ |
| L2 | processing のアンカーは正規化済み `startedAt`。不正・未来 5s 超は `null` → sticky now。**正規化は panel/helper**（V-I4） |
| L3 | 段階は §3 の 5 段・文言・境界 ms を正とする。processing 現行固定文の後方互換なし |
| L4 | 表示は**段階テキストのみ**（バー・ステップ点なし） |
| L5 | 対象 phase は `submitting` と `processing` のみ |
| L6 | 契約・DB・Function・status shape は変更しない |
| L7 | 進捗文言に内部用語（idempotency / OpenRouter / repair / quota など）を出さない。表の文言のみ |
| L8 | プライバシー: プロンプト・生 AI・個人の安全情報を進捗に載せない |
| L9 | **V-C1** sticky: `null` アンカーは 1 回 capture。tick ごとの now 差し替え禁止 |
| L10 | **V-C2** 同期初期評価: 初回 render と active/anchor 変化で interval 待ちなし |
| L11 | **V-I1** 単一 hook: `active = submitting \|\| processing`。early return 前で呼ぶ |
| L12 | interval は **1000 ms 固定** |
| L13 | フック戻りは `{ message, stageIndex }`（L1 後）。`data-progress-stage` **必須** |
| L14 | テスト: a11y を変更対象に含める。panel/a11y は `NOW` 相対 `startedAt` |

---

## 9. 残余リスク（許容）

| ID | 内容 | 扱い |
|----|------|------|
| R1 | 表示帯と実工程がずれる | 体感優先として許容。正確同期は別設計。終端 UI に切替後は進捗を出さない |
| R2 | repair や短時間成功で一部帯を飛ばす | 許容 |
| R3 | POST 中は status を並列取得しないためサーバ真相は見えない | L0 により意図的 |
| R4 | aria-live が段階切替のたびに読み上げる | 3s〜十数秒間隔で polite のため許容。連打はしない |
| R5 | 遠過去 `startedAt` で即最終帯 | リロード/ハング復帰の意図。L2 は未来のみ特別扱い |
| R6 | processing 序盤（elapsed&lt;3s）で status が「条件を確認…」となり h1「献立を作っています」と並ぶ | 同一表ロックの帰結として許容。長時間 submitting 後は L1 で stage0 に戻りにくい |
| R7 | POST 中の `visibilitychange`→GET で phase が processing に変わりアンカーが `startedAt` へ | L1 で前進維持。文言がサーバ開始時刻基準に寄る |
| R8 | StrictMode dev 二重 mount で max が一瞬リセットされ得る | elapsed 再計算で表示は概ね単調非減。許容 |

---

## 10. 次ステップ

1. ~~ユーザー最終確認 / レビュー改訂~~ → **本改訂で完了**（V-C1〜V-I4 吸収済み）。
2. `writing-plans` で実装計画を作成（本設計の L0–L14 と §4 アルゴリズムを Locked interfaces に転記）。
3. 計画の Task を 1 つずつ TDD で実装（AGENTS.md / CLAUDE.md の per-Task ワークフロー）。

---

## 11. レビュー改訂履歴

| 日付 | 内容 |
|------|------|
| 2026-07-31 | 初版（ユーザー承認・方針 A） |
| 2026-07-31 | 一次 / 敵対的 / 二次レビュー反映: V-C1 sticky、V-C2 同期評価、V-I1 配線、V-I2 a11y、V-I3 相対時刻、V-I4 L2 責務、L9–L14、R5–R8、戻り値型と `data-progress-stage` 必須化 |
