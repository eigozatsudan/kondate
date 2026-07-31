# Secondary Verification: 対象外食事 copy + 追加前ダイアログ

**Date:** 2026-07-31  
**Stance:** independent secondary verification of primary + adversarial findings  
**HEAD:** c6a1363  
**Range:** 9ef6c9e..c6a1363

## Summary

Primary（Approved・Critical/Important 0）と Adversarial（Request changes・I-1 Important）を、設計 r2 §5.3.9 / §9 と実装を突き合わせて再判定した。

**結論:** 両レビューが指摘する onboarding single-flight の非対称は実在するが、設計が onboarding 手段として `startMutation.isPending` を明示許容しており、実ユーザの OK 連打経路は dialog 閉鎖 + 同一 click 内の `setState` 再レンダーで `isPending` が読まれるため、**Important / マージブロックには上げられない**。Primary の Minor 扱いが妥当。Adversarial I-1 の Important 昇格は **REJECTED**。

その他 Minor（テスト非対称・markup 二重・E2E 第2メンバー未踏・focus trap 残余）は確認済みでいずれも非ブロック。Primary が見落とした Minor は adversarial M-2/M-3/M-4 だが、いずれも Important 未満。

**Net blocking: なし → Verdict: Approved**

---

## Deep-dive: Adversarial I-1 / Primary M1（onboarding single-flight）

### Cited code (re-read)

Onboarding (`household-onboarding-page.tsx:282–292`):

```ts
const openAddScopeNotice = (trigger: HTMLButtonElement) => {
  if (startMutation.isPending || actionPending) return;
  // ...
};
const confirmAddScopeNotice = () => {
  if (startMutation.isPending) return;
  setAddScopeNoticeOpen(false);
  startMutation.mutate();
};
```

Settings (`household-settings-page.tsx:755–769`):

```ts
const requestCreateDraft = () => {
  if (savingRef.current || creatingDraftRef.current || cancellingDraftRef.current) return;
  creatingDraftRef.current = true;
  createDraft.mutate();
};
// openAddScopeNotice も同 ref を同期チェック
```

Design §5.3.9 (verbatim intent):

> 主ボタン経路は **single-flight**: settings は既存 `creatingDraftRef`、**onboarding は `startMutation.isPending` 等**。OK 連打で `createDraft` / start を二重に呼ばない

§9: 「OK 連打でも createDraft / start は1回」

### Failure scenario analysis

| Scenario | Can it double-call `createDraft`? | Notes |
|---|---|---|
| Same-tick double `confirmAddScopeNotice()` without re-render | **Yes (theoretical)** | `isPending` は render スナップショット。ref 無しなら同期二重呼び出しは通る |
| Real double-click on 「登録を続ける」 | **Practically no** | 1st click: `setAddScopeNoticeOpen(false)` + `mutate()`。React 18 は discrete click 後に同期 flush。再 render 時 `useMutation` の getSnapshot が pending を読む + dialog unmount。2nd click は同一ボタンに届かない |
| OK 後 focus 復帰 → Space/再クリック trigger | **Practically no after re-render** | trigger は `disabled={startMutation.isPending \|\| …}`。再 render 後 isPending true なら open も click も止まる |
| Settings path | **No** | `creatingDraftRef` が mutate 前に同期 true。open も同 ref |

### Design compliance

- 実装は §5.3.9 が onboarding に許容した **means**（`isPending`）そのもの。
- ハード outcome「二重に呼ばない」は、実ユーザの連打では dialog 閉鎖 + pending disabled で実質満たす。
- settings との非対称・同期 ref の堅牢性差・§9 の OK 連打 unit 欠如は **品質 / テストギャップ**であり、設計違反のブロック級ではない。

### Secondary status

**PARTIALLY_CONFIRMED** as **Minor** (align primary M1).  
**REJECTED** as Important / merge-blocker (adversarial I-1 severity).

Confidence: **88** (issue shape confirmed; Important elevation rejected with 90 confidence on design-means reading + React 18 event flush reasoning).

---

## Primary findings adjudication

| ID | Primary severity | Secondary status | Confidence | Notes |
|---|---|---|---|---|
| (none Critical) | — | — | — | Critical は両レビューとも 0。独立確認でも安全ゲート破壊なし（OK→present 自動設定なし、enum/DB 非接触、共有 copy 集約） |
| (none Important) | — | **AGREE** | 90 | Adversarial I-1 を Important に昇格する根拠は不十分（下記） |
| M1 | Minor | **CONFIRMED** (Minor) | 88 | onboarding は isPending のみ。settings は `creatingDraftRef`。非対称と理論窓は実在。設計が isPending を明示許容するため非ブロック。同期 ref + unit はフォローアップ推奨 |
| M2 | Minor | **CONFIRMED** | 95 | onboarding test は cancel + next-action OK のみ（`household-onboarding-page.test.tsx:560–603`）。settings は Escape（L1324–1336）と dialog 本文（個人向け/他の家族向け L1309–1310）あり。実装 Escape effect は同型（onboarding L266–279）だが回帰ネットが片側厚い |
| M3 | Minor | **CONFIRMED** | 95 | settings L777–816 と onboarding L300–339 で markup 二重。計画は抽出任意。仕様違反ではない |

---

## Adversarial findings adjudication

| ID | Adv severity | Secondary status | Confidence | Notes |
|---|---|---|---|---|
| I-1 | Important | **PARTIALLY_CONFIRMED → demote to Minor**; **REJECTED as Important** | 88 / 90 | 技術的非対称は Primary M1 と同一。設計 §5.3.9 が `isPending` を onboarding 手段として列挙。実ユーザ OK 連打の二重 mutate は React 18 の click 後 re-render + dialog unmount + trigger disabled で実質閉じる。Request changes 根拠としては不十分。フォローアップで settings 同型 ref + 連打 unit は有益 |
| M-1 | Minor | **CONFIRMED** | 95 | Primary M2 と重複。Escape unit なし、OK 連打 unit なし。§9 の「Escape」「OK 連打」を onboarding 側が固定していない |
| M-2 | Minor | **CONFIRMED** | 92 | cancel it は `createDraft` 未呼出のみ（L601–602）。`queryByRole("dialog")` 非存在 assert なし。settings L1313 は閉鎖を確認。実装は `setAddScopeNoticeOpen(false)` 済みで実害低 |
| M-3 | Minor | **CONFIRMED** | 93 | `e2e/specs/onboarding.spec.ts` は「続けて家族を追加」を **可視まで**（L31）。click → `confirmAddScopeNotice` → フォームは unit（onboarding-page.test L575–583）のみ。§5.1 3トリガーのうち E2E は開始 + settings 追加が主。任意フォロー |
| M-4 | Minor | **CONFIRMED / OUT_OF_SCOPE for ticket** | 90 | `aria-modal` だが Tab trap なし。削除確認（settings L1853+ 付近）と同型。設計 §5.3 は「削除確認と同等」まで必須。trap 追加は本チケット外が正しい |

---

## Cross-review gaps

| Gap | Who had it | Secondary |
|---|---|---|
| onboarding single-flight severity | Primary=Minor / Adv=Important | **Minor**（Adv 昇格を却下） |
| cancel 後 dialog 非存在 assert | Adv M-2 only | Confirmed Minor; primary 未記載だが非ブロック |
| E2E「続けて家族を追加」未踏 | Adv M-3 only | Confirmed Minor; unit で緩和 |
| focus trap 残余 | Adv M-4 only | Design residual; 本変更の必須外 |
| markup 二重抽出 | Primary M3 only | Confirmed Minor; Adv は I3 partial に吸収気味 |

Primary が Important を見落と transientしたわけではない。Adv が見つけた追加点はすべて Minor / residual。

---

## Independent spot-checks (beyond findings)

| Check | Result |
|---|---|
| 共有 copy が設計 §5.2 / §6 と一致 | `unsupported-diet-copy.ts` L6–38 一致 |
| OK で status を present にしない | confirm 経路は draft 作成のみ（両 page） |
| Escape 実装（onboarding） | L266–279: Escape → close only。backdrop に onClick なし |
| E2E helper | `e2e/fixtures/household.ts` `confirmAddScopeNotice` が必須経路から import 済み |
| 旧文言 household ゼロ | 両レビュー報告と整合（本二次では再 grep せず finding 対象外） |

---

## Net blocking issues after secondary

（なし）

CONFIRMED Critical: 0  
CONFIRMED Important: 0  

Non-blocking nits worth tracking (optional follow-up):

1. **M1 / I-1 (Minor):** onboarding に settings 同型の同期 ref（例: `startingDraftRef`）+ OK 連打 unit  
2. **M2 / M-1 (Minor):** onboarding に Escape unit・dialog 本文 assert  
3. **M-2 (Minor):** cancel 後 `queryByRole("dialog")` 非存在  
4. **M3 (Minor):** `AddScopeNoticeDialog` 抽出（任意）  
5. **M-3 (Minor):** E2E で「続けて家族を追加」経路（任意）  
6. **M-4 (residual):** focus trap は削除確認と一括の別タスク

---

## Verdict after secondary

**Approved**

- Adversarial **I-1 の Request changes 要求は却下**（Important 不成立。設計許容 means + 実ユーザ経路で実質 single-flight）。
- Primary の **Approved** を支持。
- 残件はすべて Minor / residual。マージブロックなし。
- E2E runtime 実行は両レビューどおり residual gate（静的追随は完了）。本二次の判定対象外。
