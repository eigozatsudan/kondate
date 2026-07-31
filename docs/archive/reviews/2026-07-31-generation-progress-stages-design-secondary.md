# 二次検証: 献立作成中の段階進捗表示 設計レビュー

| 項目 | 値 |
|------|-----|
| 対象設計 | `docs/archive/superpowers/specs/2026-07-31-generation-progress-stages-design.md`（`e7d5bd8`） |
| 一次 | `docs/archive/reviews/2026-07-31-generation-progress-stages-design-primary.md` |
| 敵対的 | `docs/archive/reviews/2026-07-31-generation-progress-stages-design-adversarial.md` |
| 日付 | 2026-07-31 |
| 種別 | 一次・敵対的 finding の独立二次検証（read-only・別コンテキスト） |
| 判定 | **設計改訂（または plan Locked interfaces 固定）後に writing-plans 可** |

二次検証は一次/敵対的の**結論本文を共有せず**、finding 一覧とコード・設計本文のみを照合した。

---

## 1. 一次 finding の判定

| ID | 二次 Status | 統合 severity |
|----|-------------|---------------|
| D1 sticky アンカー | **CONFIRMED** | **Critical** |
| D2 hook API / data-progress-stage | **DOWNGRADE** | **Minor** |
| D3 Rules of Hooks 配線 | **CONFIRMED** | **Important** |
| D4 a11y 固定 copy | **CONFIRMED** | **Important**（Critical ではない） |
| D5 panel 時刻フィクスチャ | **CONFIRMED_WITH_NUANCE** | **Important** |
| D6 現行 copy 差 | **REJECT**（意図的） | — |
| D7 Approved 表記 | **CONFIRMED** | **Minor** |

### D1 根拠（要約）

設計は submitting アンカーを「phase 入場時刻」としつつ、`anchorMs: null` +「now フォールバック」しか書かない。  
`elapsed = now - (anchorMs ?? Date.now())` を毎評価すると ≈0。受け入れ §2.3（10s で AI 帯）が壊れうる。**Critical 妥当。**

### D4 を Critical にしない理由

フル `vitest run` では落ちるが、ランタイム/製品中核欠陥ではなく **テスト棚卸し漏れ**。Important + §7 必須変更で足りる。

---

## 2. 敵対的 finding の判定

| ID | 二次 Status | 統合 severity |
|----|-------------|---------------|
| D-C1 a11y CI | **DOWNGRADE** → D4 と同一 | **Important** |
| D-C2 同期初期評価 | **CONFIRMED** | **Critical** |
| D-I1 stage0×h1 | **DOWNGRADE** | **Minor / 許容** |
| D-I2 hook API | D2 にマージ | **Minor** |
| D-I3 active リセットで L1 死 | **CONFIRMED** | **Important**（D3 とセット） |
| D-I4 過去 skew 即 stage4 | **REJECT** | —（仕様） |
| D-I5 弱い panel 試験 | D5 にマージ | **Important** |
| D-M1〜3 | 非ブロッカー | **Minor** |

### D-C2 と D1 は別 Critical か？

**Yes。**

| | D1 | D-C2 |
|--|----|------|
| 症状 | submitting が時間で進まない | 正しい過去 anchor でも**初回表示**が stage0 |
| 原因 | sticky 欠落 | 初回の同期 elapsed 評価が未契約 |
| 壊れる受け入れ | submitting 10s → AI 帯 | processing 35s 前 → **初期**が段取り帯 |

### D-I1 は Important か？

**No。** 同一表・h1 維持はロック済み。R1 体感優先。計画ブロッカーにしない。

### D-I4 は問題か？

**No。** 遠過去 `startedAt` → 後半帯はリロード復帰の意図（§2.3 / §5）。

---

## 3. 二次が追加した点

| ID | Severity | 内容 |
|----|----------|------|
| **S1 / V-I4** | **Important** | L2 の `Date.parse` / NaN / 未来+5s 正規化を **panel と hook のどちらが行うか**未ロック。hook 入力は finite `number \| null` に限定すべき |

**追加 Critical はなし。**

---

## 4. 統合 finding 表（実装前ゲート）

| ID | 由来 | Severity | 要約 | plan 前に要ロック |
|----|------|----------|------|-------------------|
| **V-C1** | D1 | **Critical** | submitting 入場時刻 sticky と `null→now` の 1 回評価 | **Yes** |
| **V-C2** | D-C2 | **Critical** | active/anchor 変更時の同期初期評価（interval のみ禁止） | **Yes** |
| **V-I1** | D3 + D-I3 | **Important** | パネル先頭で単一 hook; `active = submitting \|\| processing`; phase 跨ぎで active を落とさない | **Yes** |
| **V-I2** | D4 + D-C1 | **Important** | `accessibility.test.tsx` を §6/§7 に含め相対時刻 or stage 非依存 assert | **Yes** |
| **V-I3** | D5 + D-I5 | **Important** | panel テストは `NOW` 相対の `startedAt` | **Yes** |
| **V-I4** | S1 | **Important** | L2 正規化の責務; hook 入力は `number \| null` | **Yes** |
| **V-M1** | D2 + D-I2 | Minor | `data-progress-stage` を付けるなら戻り値型を plan で 1 行 | 任意 |
| **V-M2** | D7 | Minor | Approved / §10 表記整理 | 任意 |
| — | D6 | Reject | 文言置換は意図的 | No |
| — | D-I1 | 許容 | h1 と stage0 の軽い矛盾 | No |
| — | D-I4 | Reject | 過去 startedAt → 後半帯は仕様 | No |

---

## 5. Exact locks（設計追記 or plan Locked interfaces）

以下を固定すれば writing-plans → Task 実装に進んでよい。

### V-C1 Sticky anchor

- submitting: phase 入場時に **1 回** `Date.now()` を capture（panel `useRef` 推奨、または hook が `active: false→true` で capture）。
- `anchorMs === null` は **その評価フレームの now を 1 回だけ**使い、interval tick ごとにアンカーを差し替えない。
- phase 再入場（`active` false→true、または submitting 再入場）でのみリセット。

### V-C2 Sync evaluate

- `active === true` のとき、**初回 render および `anchorMs` / `active` 変化時に同期で** elapsed と表示文言（と max index）を計算する。
- `setInterval(1000)` は経過再評価用。初回表示を stage0 に固定してはならない。
- 試験: `render` 直後（`advanceTimers` なし）で 35s 前 anchor → stage3 文言。

### V-I1 Single hook wiring

- `GenerationStatusPanel` の **phase 早期 return より前**で常に hook を呼ぶ。
- `active = phase === "submitting" || phase === "processing"`。
- submitting→processing で `active` を false にしない（L1 維持）。
- 試験: submitting で index≥2 まで進めたあと `startedAt=now` に切替えても文言が戻らない。

### V-I4 L2 normalization site

- processing: panel（または helper）が  
  `parse → NaN or (parsed > now + 5000) ? null : parsed`  
  を行い、hook には `number | null` のみ渡す。

### V-I2 / V-I3 Test inventory

- 変更対象に `src/app/accessibility.test.tsx` を追加。
- processing の固定旧文言 assert を相対 `startedAt` または「`role=status` が表のいずれかの文言」に更新。
- panel テストの `startedAt` も `NOW` 相対。

### 任意

- `data-progress-stage` を付けるなら hook が `{ message, stageIndex }`（L1 適用後）を返す。
- interval は **1000 ms 固定**（「約」をやめる）。

---

## 6. 総合判定

| 項目 | 結論 |
|------|------|
| 設計の方向 | **健全**（方針 A・境界・プライバシー） |
| このまま plan に進めるか | **不可** — V-C1 / V-C2 が未ロック |
| 設計の全面やり直し | **不要** |
| 次アクション | 設計書に V-* locks を吸収する改訂、または plan 冒頭 Locked interfaces に同一文言を固定 → その後 writing-plans |

**Verdict:** V-C1 / V-C2 / V-I1 / V-I4 を設計または plan に書いた後であれば実装計画作成に進んでよい。D-I1・D-I4・D6 を理由に設計をやり直す必要はない。
