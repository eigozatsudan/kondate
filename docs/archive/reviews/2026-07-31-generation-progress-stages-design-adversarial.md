# 敵対的レビュー: 献立作成中の段階進捗表示 設計

| 項目 | 値 |
|------|-----|
| 対象 | `docs/archive/superpowers/specs/2026-07-31-generation-progress-stages-design.md`（`e7d5bd8`） |
| 日付 | 2026-07-31 |
| 種別 | 設計書に対する敵対的レビュー（read-only・実装しない） |
| 判定 | **ACCEPT_WITH_CHANGES** — Critical を設計改訂してから writing-plans / 実装へ |
| 二次検証 | `docs/archive/reviews/2026-07-31-generation-progress-stages-design-secondary.md`（severity の再判定あり） |
| 観点 | ユーザー欺瞞、タブ/visibility 並行、低リテラシー、プライバシー、既存テスト衝突、実装者逃げ道 |

**照合した正本・実装**

- 対象設計・UI・machine・recovery・generation-service（同一 POST 内 AI〜終端）
- `function-budget.ts`（55s / 24s attempt）
- `accessibility.test.tsx` L565–593
- `generation-status-panel.test.tsx`
- StrictMode: `src/main.tsx`

---

## Verdict: **ACCEPT_WITH_CHANGES**

方針 A は正しい。サーバ stage を増やさない・privacy を守る・主戦場が `submitting` である点は攻撃しても崩れない。

ただし **Approved のまま実装に渡すと**、受け入れシナリオと CI が壊れうる穴が残る。Critical は二次検証後 **2 件**（sticky アンカー / 同期初期評価）に絞る。a11y 固定 copy は Important（必須 Task）に降格。

---

## Findings table（一次発行時）

| ID | Severity（発行時） | 二次後 | Title |
|----|-------------------|--------|-------|
| D-C1 | Critical | **Important**（V-I2） | a11y 固定 processing copy が未棚卸し → フルスイート破壊 |
| D-C2 | Critical | **Critical**（V-C2） | マウント時の同期再評価が未ロック → 「初期表示」受け入れ失敗 |
| D-I1 | Important | **Minor/許容** | processing stage0「条件を確認」が h1 と矛盾し得る |
| D-I2 | Important | **Minor**（V-M1） | フック API が message のみ・index 任意 |
| D-I3 | Important | **Important**（V-I1） | active が一瞬 false になると max リセットで L1 後退 |
| D-I4 | Important | **Reject** | 過去 skew で即 stage4 — 仕様として意図的 |
| D-I5 | Important | **Important**（V-I3 にマージ） | panel 試験が「存在」止まり + 時刻フィクスチャ |
| D-M1 | Minor | Minor | 「約 1_000 ms」の曖昧さ |
| D-M2 | Minor | Minor | submitting→processing の実経路（visibility GET）が薄い |
| D-M3 | Minor | Minor | aria-live 最大 5 回読み上げ |

---

## Detailed findings（残す価値のある攻撃）

### [D-C2] 初期表示の同期評価が未ロック — **Critical**（維持）

§2.3 は `startedAt` 35s 前で**初期表示**が中盤帯。§4.2 は interval 再評価中心。

素直な `useState(stage0) + setInterval` は初回 1 フレーム〜1s が stage0。低リテラシー向けに「一瞬条件確認→飛ぶ」は壊れた感を生む。

**Required lock:** `active===true` の render / active・anchor 変化時に**同期**で elapsed と文言を計算。interval は経過更新専用。

---

### [D-C1] a11y 固定 copy — **Important**（二次で降格）

```591:593:src/app/accessibility.test.tsx
    expect(screen.getByRole("status")).toHaveTextContent(
      "料理の組み合わせと全体の段取りを確認しています",
    );
```

旧文言は段階表に存在しない。`startedAt` が遠い過去 → 常に stage4。§6/§7 未記載。

**Required lock:** 変更対象に追加。固定旧文を相対時刻 or `role=status` + 表の subset に更新。heading / axe は維持。

---

### [D-I1] processing × stage0 と h1 — **Minor / 許容**（二次）

同一表・h1 維持はロック済み。R1 体感優先。長時間 submitting 後は L1 で stage0 に戻りにくい。早期 reload の 3s だけ違和感があり得るが、設計やり直し級ではない。§9 に任意追記可。

---

### [D-I3] active 配線で L1 死 — **Important**（維持）

`active` false で max リセットと「submitting→processing は前進のみ」は、**同一 hook で active が true のまま跨ぐ**前提でのみ両立。式 `submitting || processing` と単一インスタンスを本文ロック。

`visibilitychange` → `retryStatus` が POST 中に processing を dispatch し得る（`use-generation-recovery.ts` L455–456）ため、受け入れ表の phase 跨ぎは実在しうる。

---

### [D-I4] 過去 skew — **Reject**

遠過去 `startedAt` → 後半帯はリロード復帰の意図。未来 5s のみ特別扱いは L2 どおり。

---

### [D-I2] hook API — **Minor**

message でコア可。`data-progress-stage` を付けるなら plan で `{ message, stageIndex }` を 1 行固定。

---

## Focus checklist

| # | 観点 | 結論 |
|---|------|------|
| 1 | 「AI に…」中の validation/失敗 | R1 許容。終端後は進捗を出さない（active false）は設計どおり |
| 2 | 前進のみで遅い stage 張り付き | 意図。危険は max リセット後退（D-I3） |
| 3 | clock skew | 未来のみガード。過去即最終帯は仕様（D-I4 Reject） |
| 4 | 1s interval + fake timers | 同期初期評価が無いと初手で嘘（D-C2） |
| 5 | Hook API | D-I2 Minor |
| 6 | active=false stage0 flash | 表示は active phase のみ。配線ロックとセット |
| 7 | StrictMode 二重 mount | 残リスク低（R8 級） |
| 8 | 「条件を確認」両 phase | D-I1 Minor |
| 9 | RecoveryLinks 放棄 | unmount で interval 解除。追記推奨程度 |
| 10 | a11y 固定 copy | D-C1 → Important |

---

## Privacy / MVP

- 進捗に raw AI / プロンプト / 個人安全情報を載せない方針は守れている。
- 親 MVP 本文に当該固定文言の強い拘束は薄く、Plan3 実装・a11y が事実上の正本。クライアント表示 supersede を一文あるとレビューが楽（Critical ではない）。

---

## Residual risks（§9 追記候補）

| ID | 内容 |
|----|------|
| R5 | （任意）過去 skew で即最終帯は意図的 — 既に §5 に近い |
| R6 | processing 序盤 stage0 と h1 の軽い矛盾（同一表維持時） |
| R7 | visibility GET で phase が processing に変わりアンカーが `startedAt` へ |
| R8 | StrictMode で max が一瞬リセットされ得るが elapsed 再計算で単調非減寄り |

---

## Bottom line

体感用クライアント段階表示は MVP を壊さない良い小さな設計。**Critical は sticky アンカー（一次 D1）と同期初期評価（D-C2）**。a11y・配線・相対時刻テストは Important として plan 必須。D-I1/D-I4 で設計をやり直す必要はない。
