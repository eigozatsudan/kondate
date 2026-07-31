# 実装計画レビュー: 初回家族アテンション強化

| 項目 | 値 |
|------|-----|
| 対象 | `docs/superpowers/plans/2026-07-31-onboarding-multi-member-attention.md`（初版〜`4348310`） |
| 設計 | `docs/superpowers/specs/2026-07-31-onboarding-multi-member-attention-design.md` |
| 日付 | 2026-07-31 |
| 種別 | 一次レビュー + 二次検証 + 敵対的レビュー（実装しない） |
| 判定 | **Needs revision** → 計画 r1 で擬陽性以外を吸収 |

**照合:** `household-onboarding-page.tsx` / `.test.tsx`、`household-queries.ts`（`invalidateHouseholdSafetyDependents`）、`inline-notice.tsx`、`e2e/specs/onboarding.spec.ts`、`scripts/run-e2e.sh`、設計 §4–§7

---

## 総合判定

| レーン | 判定 | 要約 |
|--------|------|------|
| **一次** | Needs revision | 分解は妥当だが Task 1 にプレースホルダと invalidate 後の members mock 契約不足 |
| **二次** | 一次の C/I を確認 | C1–C3 / I1–I4 はコード根拠あり。M の一部は残余で可 |
| **敵対的** | Needs revision | unit が静的 `listMembers` のままだと GREEN 不能。complete 中 pending 欠落で連打リスク |

**実装開始前に計画 r1 を正とする。**

---

## Findings table（三次横断）

| ID | Sev | レーン | 箇所 | Title | 二次 |
|----|-----|--------|------|-------|------|
| C-P1 | **Critical** | 敵対/一次 | Task 1 テスト | `invalidateHouseholdSafetyDependents` が members を refetch するため、静的 `listMembers([draft])` だと complete が巻き戻り次アクションに届かない | **確認** |
| C-P2 | **Critical** | 一次 | Task 1 Step 1/4 | `// ...既存` / `// ... validation` は writing-plans の No Placeholders 違反。写経不能 | **確認** |
| C-P3 | **Critical** | 一次 | 既存 test L502 | 「この家族の設定を完了する」期待のまま残ると Task 1 GREEN 不能。置換コードが未ロック | **確認** |
| I-P1 | Important | 敵対 | handleCompleteClick | completeMember 実行中に `actionPending` が立たず連打可能（設計 I-6） | **確認** |
| I-P2 | Important | 一次 | Task 1 | 開始画面（member 0）の JSX が「既存」参照のみで skip 分岐の写経が曖昧 | **確認** |
| I-P3 | Important | 一次 | Task 1 | 全テストへの `getProfile` 追加が「寄せてよい」で、件数・対象 it 名が未列挙 | **確認** |
| I-P4 | Important | 敵対 | Task 3 | `run-e2e.sh` 引数は有効なのに「受け取らない場合は…」で手順が分岐し実装者を迷わせる | **確認** |
| I-P5 | Important | 二次 | Task 1 finish | `setProgress` 成功後 profile cache を書かず invalidate のみ。成功即 onDone なら実害小だが、失敗再試行前の status 陳腐化を避けるなら setQueryData 推奨 | **確認（重要度維持）** |
| M-P1 | Minor | 一次 | Task 2 | callout 実装が Task 2 なのに Task 1 の次アクション本文は Task 1 で出る — 順序は問題なし | **FP 扱い可**（分解として妥当） |
| M-P2 | Minor | 一次 | 文末 | Execution Handoff の質問は計画正本に不要 | **確認**（削除でよい） |

### 擬陽性 / 非採用

| 候補 | 理由 |
|------|------|
| 「invalidate を onboarding から外すべき」 | 設計・現行とも complete 後に safety dependents 無効化が必須。**外さない**。テスト側を stateful にするのが正解 |
| 「主 CTA を献立に戻るにすべき」 | 計画が意図的に「献立を始める」固定。設計も許容 |
| 「E2E が他ファイルも必ず壊れる」 | full-journey 等は settings 文言や fixture 経由が多く、onboarding 即 planner 固定は主に `onboarding.spec.ts`。壊れたら追随でよい |

---

## Detailed findings

### [C-P1] 静的 listMembers + members invalidate で次アクションが消える — **Critical**

**Code:** `invalidateHouseholdSafetyDependents` → `invalidateHouseholdSafetyQueries` → `householdKeys.members` を invalidate（`household-queries.ts` L42–47）。

**現行 handleCompleteClick** も complete 後に同 invalidate を呼ぶ。navigate 即時なら unit はレースで通ることがあるが、**新フローは画面に留まる**ため refetch 完了後に `listMembers` が再び `status: "draft"` を返すと UI がフォームに戻る。

**計画のテスト**（Task 1 happy path）は `listMembers: mockResolvedValue([draft])` のまま。

**Required plan fix:** テスト用に mutable members store をロック。

```ts
function createMembersApiState(initial: HouseholdMemberRow[]) {
  let members = initial.map((m) => ({ ...m }));
  return {
    get members() {
      return members;
    },
    listMembers: vi.fn(async () => members.map((m) => ({ ...m }))),
    replaceAll(next: HouseholdMemberRow[]) {
      members = next.map((m) => ({ ...m }));
    },
    upsert(member: HouseholdMemberRow) {
      const i = members.findIndex((m) => m.id === member.id);
      if (i >= 0) members[i] = { ...member };
      else members.push({ ...member });
    },
  };
}
```

`completeMember` mock は complete 行を `upsert` してから return。`createDraft` も同様。

---

### [C-P2] プレースホルダ — **Critical**

Task 1 Step 1: `// ...既存のまま`  
Task 1 Step 4: `// ... validation / completeMember 既存どおり`  
Task 1 空画面: `// 既存の「家族設定を始める」+ skip`

**Required:** factory 全文、`handleCompleteClick` 全文、member 0 画面 JSX 全文を計画に載せる。

---

### [C-P3] 既存 it の明示置換 — **Critical**

`household-onboarding-page.test.tsx` L502–518:

```ts
it("draft が無く complete member が既にいる場合も任意性が明確な完了ボタン文言を使う", ...)
// expect この家族の設定を完了する
```

計画は「主 CTA を献立を始めるに」と書くが、**この it 名と expect の置換ブロックが無い**。

**Required:** 当該 it を削除し、次で置換するコードを載せる:

```ts
it("uses 献立を始める as primary CTA when complete members exist without draft", async () => {
  ...
  expect(await screen.findByRole("button", { name: "献立を始める" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "この家族の設定を完了する" })).not.toBeInTheDocument();
});
```

同様に旧 happy path / setProgress-after-complete の it 名を削除リストに列挙。

---

### [I-P1] completeMember 中の pending — **Important**

設計 §5.2 I-6: pending 中は全操作 disable。計画の `actionPending` は finish/skip のみ。

**Required:** `handleCompleteClick` 開始時 `setActionPending(true)`、validation 早期 return で false、complete 成否後 finally で false。フォーム完了ボタンも `disabled={saveState === "failed" || actionPending}`。

---

### [I-P2] 開始画面 JSX — **Important**

member 0 の skip を `canShowSkip` で囲む変更があるのに全文が無い。

**Required:** 開始画面の return 全文を Task 1 に掲載。

---

### [I-P3] テスト移行チェックリスト — **Important**

`HouseholdOnboardingApi` リテラルは test 内に **10+ 箇所**。`getProfile` 必須化で typecheck が全件落ちる。

**Required:** Task 1 Step に「全 it を `baseApi` 経由に移行。残った `const api: HouseholdOnboardingApi = {` 直書きを grep で 0 件にする」を明示。

---

### [I-P4] E2E コマンド — **Important**

`run-e2e.sh` は `"$@"` を playwright に渡す（L321–325, L383）。  
**Required:** 固定コマンドのみ:

```bash
./scripts/run-e2e.sh e2e/specs/onboarding.spec.ts
```

「受け取らない場合」分岐を削除。

---

### [I-P5] profile cache — **Important**

`setProgress` 成功後:

```ts
const updated = await api.setProgress("complete"); // 戻りが ProfileRow なら
queryClient.setQueryData(householdKeys.profile(userId), updated);
```

現状 `setProgress` の型は `Promise<unknown>`。計画で:

- 成功後 `invalidateQueries(profile)` のまま **または**
- `setOnboardingStatus` は既に Profile を返すので API 型を `Promise<ProfileRow>` に寄せて setQueryData

実装最小は invalidate のままでも可だが、**再試行前に status が古いと complete 省略判定を誤る**のは `complete` 成功後に onDone 失敗した場合のみ。onDone は sync なので実害は小さい。  
→ r1 では「成功後 invalidateQueries を維持。setQueryData は任意」と明記しブロックしない。

---

## 二次検証メモ

| ID | 二次結論 |
|----|----------|
| C-P1 | `household-queries.ts` L42 で members invalidate は事実。新フローで画面残留するため **成立** |
| C-P2 | 計画本文に `// ...` が実在。**成立** |
| C-P3 | test L517 が旧ボタン名。**成立** |
| I-P1 | 現行も complete 中 disable なし。設計が強化要求。**成立** |
| I-P4 | run-e2e は引数対応。**成立**（曖昧文を削る） |
| M-P1 | Task 分割として許容 → **擬陽性（修正不要）** |

---

## r1 で計画へ吸収する項目

- [x] C-P1 stateful members helper + 全 complete 系テストで使用
- [x] C-P2 全文コード（factory / handleCompleteClick / 開始画面）
- [x] C-P3 旧 it 削除・置換の明示
- [x] I-P1 complete 中 actionPending
- [x] I-P2 開始画面 JSX
- [x] I-P3 baseApi 移行・grep 0 件
- [x] I-P4 E2E コマンド固定
- [x] I-P5 cache 方針一文
- [x] M-P2 Execution Handoff 質問削除
- [ ] M-P1 修正不要
