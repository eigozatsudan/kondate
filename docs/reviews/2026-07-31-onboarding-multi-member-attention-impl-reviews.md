# 実装レビュー: 初回家族アテンション強化

| 項目 | 値 |
|------|-----|
| 対象コミット | `ef8f7f1`（feat）、`6fc24d3`（e2e）、`5519644`（fixture 追随） |
| 設計 | `docs/superpowers/specs/2026-07-31-onboarding-multi-member-attention-design.md` |
| 計画 | `docs/superpowers/plans/2026-07-31-onboarding-multi-member-attention.md`（r1） |
| 日付 | 2026-07-31 |
| 種別 | 一次レビュー + 二次検証 + 敵対的レビュー（read-only） |
| 判定 | **Accept with residual risks** — Critical なし。Important は修正推奨（ブロック級ではない） |

**照合ファイル**

- `src/features/household/household-onboarding-page.tsx`
- `src/features/household/household-onboarding-page.test.tsx`
- `e2e/specs/onboarding.spec.ts`
- `e2e/fixtures/auth.ts`（`completeMinimumOnboarding`）
- `src/features/emergency/emergency-menu-page.cache.test.tsx`
- RPC: `complete_household_member` / `set_onboarding_status` 遷移表

**検証エビデンス（実装セッション時点）**

- unit: onboarding + emergency cache **31 passed**
- typecheck / lint: **OK**
- e2e: `./scripts/run-e2e.sh e2e/specs/onboarding.spec.ts` **mobile + desktop passed**

---

## 総合判定

| レーン | 判定 | 要約 |
|--------|------|------|
| **一次** | Accept with notes | 設計の本線（complete 分離・次アクション・callout・skip 分岐・getProfile）は実装とテストで固定されている |
| **二次** | 一次の C 候補を棄却 / I を確認 | 連打レースは Important。N≥2 見出しテスト欠落を確認 |
| **敵対的** | Accept with residual | RPC 遷移・invalidate 後 members・fixture 追随は健全。二重 complete は RPC 上ほぼ冪等だが UI pending が遅い |

**結論: マージ済み実装として受け入れ可能。** Important はフォローアップ fix を推奨（必須ではない）。

---

## Findings table

| ID | Sev | レーン | 箇所 | Title | 二次 |
|----|-----|--------|------|-------|------|
| I-1 | Important | 敵対 | `handleCompleteClick` | `actionPending` が validation 通過後・await 直前にしか立たず、連打で `completeMember` が二重キューされ得る | **確認** |
| I-2 | Important | 一次 | tests | N≥2 時見出し「登録が完了しました」の unit が無い | **確認** |
| I-3 | Important | 一次 | tests / 設計 I-5 | 次アクション h1 focus のテストが無い（実装はある） | **確認**（重要度を Minor へ下げ可） |
| M-1 | Minor | 一次 | page.tsx | `draft === null` の第三分岐は到達不能（型狭め用の安全網） | **確認** |
| M-2 | Minor | 敵対 | 開始/次アクション | profile 未取得中は skip が一瞬出ない（設計 fail-closed どおり） | **確認**（仕様どおり） |
| M-3 | Minor | 一次 | tests | `skipped` + complete member で主 CTA が `setProgress("complete")` する経路の unit が無い | **確認** |

### 擬陽性 / 棄却

| 候補 | 判定 | 理由 |
|------|------|------|
| invalidate で complete が消える | **FP** | production は DB 正本。unit は `createMembersApiState` で対策済み |
| complete → skipped が出る | **FP** | `canShowSkip` が `not_started\|in_progress` のみ。E2E 再訪で skip count 0 |
| 主 CTA が「献立に戻る」でない | **FP** | 計画が「献立を始める」固定 |
| completeMember 二重でデータ破壊 | **ほぼ FP** | RPC は required 充足時に status=complete を再 UPDATE するだけ（破壊的でない）。ただし二重 invalidate / エラー表示のちらつきは I-1 |
| fixture が壊れている | **FP** | `5519644` で「献立を始める」追随済み。expect import あり |

---

## 一次レビュー詳細

### 設計適合（本線）

| 設計要件 | 実装 | テスト |
|----------|------|--------|
| complete 後 setProgress/navigate しない | `handleCompleteClick` 末尾で finish を呼ばない | unit: setProgress/onDone not called |
| 次アクション UI・人数行 | h1 / `N人の…` / 本文 / 3 CTA | unit + e2e |
| 主 CTA「献立を始める」 | 固定 | unit + e2e + fixture |
| complete 時 setProgress 省略 | `onboardingStatus !== "complete"` | unit omits setProgress |
| skip 条件 | `canShowSkip` | unit hide/show + e2e revisit |
| callout 分岐 | InlineNotice | unit first/continue |
| getProfile | query + API | 注入・emergency 追随 |
| focus h1 | ref + useEffect | **実装のみ**（I-3） |
| pending disable | actionPending / startMutation | 実装あり。連打タイミング I-1 |
| E2E 必須 | onboarding.spec + fixture | 実装セッションで pass |

### 品質・回帰

- 旧 complete→navigate 契約の unit は置換済み。`baseApi` 化で `getProfile` 必須を満たす。
- emergency cache テストが次アクション経由に追随（`getProfile` + 献立を始める）。
- `completeMinimumOnboarding` fixture が共通 E2E 経路を保護。

---

## 二次検証（一次指摘の深掘り）

### I-1 連打 — **成立（Important）**

```ts
// handleCompleteClick
void saveQueue.current.then(async (saved) => {
  // validation...
  setActionPending(true);  // ← ここまでボタンは enabled のまま
  completed = await api.completeMember(draft.id);
```

1. 1 回目 click → then チェーンに入る（actionPending まだ false）
2. 2 回目 click → さらに then が積まれる
3. 両方 validation 通過後に completeMember が二度走る

`complete_household_member` は draft 限定ではなく required 充足行を complete にする UPDATE で、**二度目も成功し得る**（破壊ではない）。影響は二重 invalidate・一瞬の failed 表示の可能性。

**推奨 fix（フォローアップ）:** validation 成功直後ではなく **click 直後**（または validation 成功の同期区間の先頭）で `setActionPending(true)`。または `completingRef` で同期ガード。

### I-2 N≥2 見出し — **成立**

実装:

```tsx
{n === 1 ? "1人目の登録が完了しました" : "登録が完了しました"}
```

unit は N=1 のみ。設計 §5.2 の分岐はコードにあるが回帰が効かない。

### I-3 focus テスト — **成立（実装は正しい）**

```ts
useEffect(() => {
  if (draft !== null || completeMembers.length === 0) return;
  nextActionHeadingRef.current?.focus();
}, [draft, completeMembers.length]);
```

`tabIndex={-1}` 付き。テスト欠落は品質ギャップであり仕様未実装ではない → **Important 下限 / Minor 上振れ**。

### 棄却した Critical 候補

- **invalidate 巻き戻し:** 計画 C-P1 対策が unit に入っている。e2e 実機 pass。
- **skip の RPC 失敗再訪:** DOM から除去。e2e `toHaveCount(0)`。

---

## 敵対的レビュー

### 状態機械

| シナリオ | 結果 |
|----------|------|
| member complete, profile in_progress | 次アクション。正規中間状態 |
| 献立を始める | setProgress(complete) → onDone |
| complete 再訪 | skip なし、setProgress 省略で onDone 可 |
| skipped + complete members で献立を始める | setProgress(complete) 試行（許可遷移）— unit なし（M-3） |
| 続けて家族を追加 | createDraft → 2人目 callout |
| profile 読取失敗 | skip 非表示、主/副は操作可 |

### 敵対入力

- 完了ボタン連打 → I-1
- complete 済みで skip を DOM 探索 → 出ない
- listMembers が stale draft を返す mock → unit は stateful 必須をドキュメント化済み。production は DB

### 境界

- 320 / min-h-11: 主操作に `min-h-11` 付与
- InlineNotice: `role="note"`（status 誤用なし）
- 個人情報: 次アクションに display_name を出さない

### 残余リスク（設計どおり許容）

- 中断後 welcome 再表示（設計 §4.2 / §9）
- 主 CTA を読まず 1 人で進む利用者（設計 M-3）

---

## 受け入れチェック（設計 §8）

| 基準 | 状態 |
|------|------|
| 初回 callout | ✅ unit + e2e |
| 2人目 callout | ✅ unit |
| 完了直後自動献立しない | ✅ unit + e2e |
| 続けて家族を追加 | ✅ unit |
| 献立を始める → complete + planner | ✅ unit + e2e |
| skip 条件付き | ✅ unit + e2e |
| リロードでデータ残存 | ✅ e2e reload mid-draft；member complete 後リロードは production 経路で DB 依存（unit は stateful で invalidate 耐性） |
| E2E onboarding | ✅ |
| DB/API 非変更 | ✅ |
| typecheck/lint/format（ソース） | ✅（実装時） |

---

## 推奨フォローアップ（任意）

1. **I-1:** `handleCompleteClick` で validation 成功後すぐ / または click 先頭で `actionPending` を立て、二重 completeMember を防ぐ unit を 1 本追加。
2. **I-2:** complete members 2 人 + draft なしで見出し「登録が完了しました」の unit。
3. **I-3:** 次アクション表示後 `document.activeElement` が h1 であることの unit（jsdom で focus が弱い場合は `toHaveAttribute('tabIndex','-1')` に落とす）。

Critical がないため、**追加コミットなしでもリリース判断は可**。

---

## 二次レビュー署名

| 項目 | 内容 |
|------|------|
| 一次の Critical | 0 件（候補はすべて棄却） |
| 一次の Important | I-1, I-2 成立。I-3 は実装済み・テスト欠落 |
| 敵対の追加 Critical | 0 件 |
| 最終判定 | **Accept with residual risks** |
