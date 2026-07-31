# 献立作成中の段階進捗表示（体感用）設計書

| 項目 | 値 |
|------|-----|
| 文書 | `docs/superpowers/specs/2026-07-31-generation-progress-stages-design.md` |
| 日付 | 2026-07-31 |
| 状態 | **Approved**（2026-07-31 ユーザー承認。方針 A: 経過時間による文言切替） |
| 対象 | `/generation` の `GenerationStatusPanel`（`submitting` / `processing`） |
| 関連 | MVP `2026-07-11-kondate-mvp-design.md`（生成状態 API・processing 画面）、Plan 3 生成結果 |

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

### 2.3 成功受け入れ

| シナリオ | 期待 |
|----------|------|
| 新規作成で `submitting` が 10 秒続く | 進捗1行が少なくとも「条件を確認…」から「AI に献立案を…」帯へ進む |
| `processing` で `startedAt` が 35 秒前 | 初期表示が「組み合わせと段取り…」帯（§3 の表） |
| 3 秒で成功終端 | 途中段階を飛ばして終端 UI。進捗タイマーは止まる |
| `submitting` → `processing` に遷移 | 文言は**時間上前進のみ**（後ろに戻らない） |
| リロードで processing 復帰 | `startedAt` 基準の経過で正しい帯。補足・RecoveryLinks は現状どおり |
| checking / failed / offline | 現状文言のまま（段階表を使わない） |
| unit | 境界 ms・前進ガード・パネル表示のテストが通る |

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

### 3.1 選択規則

- `selectGenerationProgressMessage(elapsedMs)` は上表で `elapsedMs >= afterMs` を満たす最大 index の文言を返す。
- `elapsedMs < 0` は `0` として扱う。
- `submitting` と `processing` で**同一表**を使う。

### 3.2 前進のみ（L1）

phase 跨ぎやアンカー再計算で計算上の index が下がっても、**一度出した index より小さい文言へ戻さない**。

実装: フック内で `maxStageIndexSeen` を保持し、`max(calculated, maxStageIndexSeen)` を表示する。`active` が false になったらリセット。

### 3.3 アンカー時刻（L2）

| phase | アンカー |
|-------|----------|
| `submitting` | 当該 phase に入ったクライアント時刻（`Date.now()`）。phase 再入場でリセット |
| `processing` | `Date.parse(data.startedAt)`。`NaN` または未来時刻（クライアント now より 5s 超先）ならクライアント now にフォールバック |

`elapsedMs = now - anchorMs`。

---

## 4. 構成

すべてブラウザ専用（`src/features/generation/`）。所有境界を跨がない。

### 4.1 純関数 `model/progress-stages.ts`

- 定数 `GENERATION_PROGRESS_STAGES: readonly { afterMs: number; message: string }[]`
- `selectGenerationProgressMessage(elapsedMs: number): string`
- 必要なら `selectGenerationProgressStageIndex(elapsedMs: number): number`（前進ガードとテスト用）

コメントは日本語で「体感用・サーバ工程と一致しない」と明記する。

### 4.2 フック `hooks/use-generation-progress-message.ts`

入力:

```ts
type Args = {
  active: boolean;
  /** processing は startedAt 由来。submitting は phase 入場時刻。無効時は null で now フォールバック */
  anchorMs: number | null;
};
// returns: 現在の進捗文言
```

動作:

- `active === false` のときタイマーなし。戻り値は**段階 0 の文言**に固定する（呼び出し側は active の phase でのみ表示に使う）。
- `active === true` のとき約 **1_000 ms** 間隔で再評価（`setInterval`）。境界を逃さない粒度。rAF 連打はしない。
- unmount / `active → false` で interval 解除と `maxStageIndexSeen` リセット。
- タブ非表示中も interval は動かしてよい（表示復帰時に正しい帯が出ればよい）。status poll の `document.hidden` スキップとは独立。

### 4.3 UI `GenerationStatusPanel`

**変更する phase のみ**

- `submitting`: 既存の固定「条件を確認しています」をフック結果に置換。`role="status"` / `aria-live="polite"` は維持（1 要素）。
- `processing`: 見出し「献立を作っています」・補足2行・RecoveryLinks は現状維持。進捗の1行だけフック結果に置換。

**変更しない**

- `checking` / `offline` / 終端（succeeded は Navigate、failed / constraint_conflict / request_conflict）
- `data-phase` 属性値
- ポーリング間隔（2s）や `generation-machine` の phase 定義

**任意（推奨）**

- `data-progress-stage={index}` を進捗行またはパネルに付与（表示文言には使わない。テスト容易性）。

### 4.4 触らないもの（ロック）

- `shared/contracts/generation.ts` および status / command スキーマ
- `netlify/functions/**`、DB マイグレーション、RPC
- `ai_generation_requests` の列追加や progress stage 永続化
- ログへのプロンプト / 生 AI 出力の追加

---

## 5. 境界条件まとめ

| 状況 | 振る舞い |
|------|----------|
| すぐ成功 | 途中段階スキップ可。タイマー停止 |
| `submitting` → `processing` | アンカーを `startedAt` に切替。L1 で後退禁止 |
| リロード processing | `startedAt` から経過。後半帯から開始可 |
| `startedAt` 不正 / 遠い未来 | クライアント now フォールバック（L2） |
| offline | 進捗タイマー停止。offline 文言のみ |
| 長時間ハング | 最終帯のまま。RecoveryLinks で脱出（既存） |

---

## 6. テスト

### 6.1 必須

1. **`progress-stages.test.ts`**  
   境界: 0, 2999, 3000, 7999, 8000, 29999, 30000, 44999, 45000, 大きい値、負数。
2. **`use-generation-progress-message.test.tsx`**（fake timers）  
   - active 後に時間で文言が進む  
   - inactive で止まる / リセット  
   - 過去 `anchorMs` で中盤から開始  
   - アンカーが後ろにずれても前進のみ
3. **`generation-status-panel.test.tsx`**  
   - submitting / processing で進捗行（または `data-progress-stage`）が存在する  
   - checking / failed / RecoveryLinks の既存期待を壊さない

### 6.2 任意・非必須

- E2E での時間経過 assert はフレークしやすいため本設計の必須ゲートに含めない。
- 必要なら別 Task で「作成中画面に `role=status` がある」程度の弱い確認に留める。

### 6.3 検証コマンド（実装時）

Task 実装後は Docker 経由で、少なくとも対象テスト + `typecheck` + `lint` + `format:check` を実行する（プロジェクト常規）。

---

## 7. 実装ファイル一覧

| パス | 操作 |
|------|------|
| `src/features/generation/model/progress-stages.ts` | 新規 |
| `src/features/generation/model/progress-stages.test.ts` | 新規 |
| `src/features/generation/hooks/use-generation-progress-message.ts` | 新規 |
| `src/features/generation/hooks/use-generation-progress-message.test.tsx` | 新規 |
| `src/features/generation/components/generation-status-panel.tsx` | 変更（進捗1行） |
| `src/features/generation/components/generation-status-panel.test.tsx` | 変更（表示確認） |

実装計画 Task 分割の目安（writing-plans で確定）:

1. model 純関数 + テスト（RED/GREEN）
2. hook + パネル配線 + テスト

---

## 8. 人間と合意済みのロック（再導出禁止）

| # | 決定 |
|---|------|
| L0 | 方針 **A**: 経過時間によるクライアント側文言切替。サーバ stage は採用しない |
| L1 | 文言は**前進のみ**（後退禁止） |
| L2 | processing のアンカーは `startedAt`、不正時はクライアント now |
| L3 | 段階は §3 の 5 段・文言・境界 ms を正とする（実装で勝手に秒数を「最適化」しない） |
| L4 | 表示は**段階テキストのみ**（バー・ステップ点なし） |
| L5 | 対象 phase は `submitting` と `processing` のみ |
| L6 | 契約・DB・Function・status shape は変更しない |
| L7 | 進捗文言に内部用語（idempotency / OpenRouter / repair / quota など）を出さない。表の文言のみ |
| L8 | プライバシー: プロンプト・生 AI・個人の安全情報を進捗に載せない |

---

## 9. 残余リスク（許容）

| ID | 内容 | 扱い |
|----|------|------|
| R1 | 表示帯と実工程がずれる | 体感優先として許容。正確同期は別設計 |
| R2 | repair や短時間成功で一部帯を飛ばす | 許容 |
| R3 | POST 中は status を並列取得しないためサーバ真相は見えない | L0 により意図的 |
| R4 | aria-live が段階切替のたびに読み上げる | 3s〜十数秒間隔で polite のため許容。連打はしない |

---

## 10. 次ステップ

1. 本設計書のユーザー最終確認（文言・境界の微修正があれば本ファイルを更新）。
2. `writing-plans` で実装計画を作成。
3. 計画の Task を 1 つずつ TDD で実装（AGENTS.md / CLAUDE.md の per-Task ワークフロー）。
