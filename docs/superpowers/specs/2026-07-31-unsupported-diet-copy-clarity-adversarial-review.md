# 敵対的レビュー: 対象外食事の明示と表示文言の明確化

**Document:** `docs/superpowers/specs/2026-07-31-unsupported-diet-copy-clarity-design.md`  
**Reviewed commit (design):** `66c4d7c`  
**Date:** 2026-07-31  
**Stance:** adversarial product + safety + UX + a11y + implementation ambiguity  
**Method:** コントローラ照合 + 独立 read-only reviewer（`feature-dev:code-reviewer`）  
**前提:** 実装者は設計を字義どおり実装し、未記載は省略する

---

## Summary

| 重大度 | 件数 |
|---|---|
| Critical | 0 |
| Important | 7 |
| Minor | 3 |

**Verdict (at review time): Request changes**  
**Post-r2 design:** I1–I7 および M1–M3 を設計本文 `2026-07-31-unsupported-diet-copy-clarity-design.md` r2 へ吸収済み → **Approve for implementation planning**

---

## Critical

なし。スキーマ・生成拒否・enum を触らない方針は安全側で、致命的な仕様自己矛盾は見当たらない。

---

## Important

### I1. 親質問がアレルギー／苦手と衝突しうる（意味軸の再ズレ）

- **Section:** §6 親質問
- **Evidence:** 変更後ラベル「このアプリで作れない食事の事情はありますか」。MVP §6 ではアレルギー確認と対象外確認は別フィールド。現状 UI も分離済み。
- **Failure:** 利用者がアレルギー・苦手・宗教制限などを「食事の事情」と広く解釈 → 該当あり → 出てくるのは3種別のみ → 誤選択または誤って kind 付与で **生成対象外**。
- **Design fix:** 親質問を3種別にスコープ固定する。例:「離乳食・飲み込みの不安・治療食など、このアプリで献立を作れない事情はありますか」。または親の直下に常時「アレルギーや苦手は別の項目です」を固定。バリデーション／未確認メッセージの「食事の事情」も同スコープ語に揃える。
- **Status:** addressed in design r2

### I2. 追加前ダイアログ主文が「世帯全体が使えない」に読める

- **Section:** §5.2 本文
- **Evidence:** 「次に当てはまる方のメニューには、このアプリでは対応していません。」補足はあるが主文に「その方個人向け／他家族向けは可」が無い。
- **Failure:** 乳児＋大人世帯が初回ダイアログでアプリ全体を諦めて「やめる」→離脱。大人向け献立という本来の利用を失う。
- **Design fix:** 主文を個人スコープに固定。例:「当てはまる方がいる場合、**その方個人向け**のメニューには対応していません。**他の家族向けの献立はこれまでどおり作れます。**」
- **Status:** addressed in design r2

### I3. a11y が「削除確認と同系統」と言いながら必須挙動が列挙不足

- **Section:** §5.3
- **Evidence:** 削除確認（`household-settings-page.tsx`）は Escape 閉じ、`deleteTrigger` へ focus 復帰、背面 click では閉じない、`creatingDraftRef` で二重追加防止。設計は role/aria-modal/フォーカスの抽象のみ。
- **Failure:** Escape 不可・フォーカスロスト・トリガー3種なのに1 ref・OK 二重 tap で createDraft 二重。
- **Design fix:** §5.3 に必須項を明文化:
  1. Escape と副ボタンは同等（閉じるのみ、ネットワークなし）
  2. 背面 click では閉じない
  3. 開く操作ごとに trigger を記録し close 時にその要素へ focus
  4. 見出しは `aria-label` または可視見出し + `aria-labelledby` をページ内で統一
  5. 主ボタン経路は single-flight（settings の `creatingDraftRef` / onboarding `isPending` と同等）
- **Status:** addressed in design r2

### I4. E2E／追加入口の列挙が曖昧で実装漏れを誘発

- **Section:** §8.2 / §9
- **Evidence:** 「`e2e/fixtures/auth.ts` ほか」。実経路は `auth.ts` の `completeMinimumOnboarding`、`onboarding.spec.ts`、`settings.spec.ts`、`menu-domain-pantry.spec.ts`、`history.ts` の `openFirstMemberEditor`（編集が無いとき「家族を追加」）。settings/onboarding 単体もボタン直後に `createDraft` を assert。
- **Failure:** auth だけ直し他が落ちる、または「ほか」解釈で未修正マージ試み。
- **Design fix:** 必須更新ファイルを列挙固定。「ほか」禁止。E2E は `confirmAddScopeNotice(page)` 等の1ヘルパーに「登録を続ける」を集約することを推奨として書く。
- **Status:** addressed in design r2

### I5. 「旧文言の入力面残存ゼロ（repo 検索）」が過広

- **Section:** §9.2
- **Evidence:** UI refresh 設計・本設計・planner 拒否文（非目標で据え置き）に同一語が残る。
- **Failure:** docs / planner ヒットで偽未完了、または household 外の本番 UI を見落とす。
- **Design fix:** 検索範囲を固定:
  - 必須ゼロ: `src/features/household/**` のユーザー向け文字列（本番・schema・共有 copy・テスト期待値）
  - 意図的残置: `docs/**`、planner/generation 拒否コピー（§3）、必要ならコメント方針を1行
- **Status:** addressed in design r2

### I6. onboarding 完了バリデーションが schema と二重定義であることの未記載

- **Section:** §8.1–8.2
- **Evidence:** `household-onboarding-page.tsx` がローカルで `食べない食事があるか選んでください` / `該当する項目を選んでください` を保持。settings は schema 経由。
- **Failure:** schema と共有定数だけ更新し onboarding エラーが旧文言のまま。
- **Design fix:** onboarding complete 前バリデーション短文も同一共有定数を import すると §8.1 に明記。変更対象に1行追加。
- **Status:** addressed in design r2

### I7. 空状態ヘルプが「押すと入力が始まる」のまま（ダイアログと矛盾）

- **Section:** §6 文言表（欠落）
- **Evidence:** settings 空状態:「「家族を追加」を押すと、1人目の入力が始まります。」（`household-settings-page.tsx` L1156–1157）。設計表に更新行が無い。
- **Failure:** 表だけ実装 → ヘルプが嘘になる（押下後は確認ダイアログ）。
- **Design fix:** §6 に空状態ヘルプを追加。例:「「家族を追加」を押すと、登録の前に確認が表示されます。続けたあと、1人目の入力が始まります。」「押すとすぐ開始」系コピーの点検を変更対象に含める。
- **Status:** open

---

## Minor

### M1. 編集で none→present のとき入口説明が弱い

§4 で編集時ダイアログなしは固定で妥当。settings に present 説明を足す方針で緩和されるが、§10 リスク表に「編集経路はフォーム説明頼み」を1行追加すると QA が迷わない。

### M2. 箇条書きのマークアップ未指定

§5.2 は文言のみ。§5.3 に「意味のあるリスト（`ul`/`li`）で出す」を1行。

### M3. UI refresh 設計との永久ドリフト

本設計 §10 は入力面の最新権威と書くが、UI refresh 側への supersede 注記が無い。関連ドキュメントに相互参照（入力面文言は 2026-07-31 設計が優先）を足すと巻き戻し耐性が上がる。

---

## 設計が正しい点

1. 問題の原因（UI refresh による親質問と kind の意味軸ズレ）の分析がコード・両設計と一致
2. 非目標が明確で enum/DB/medical-scope を壊さない
3. present の製品意味（作れない／名簿明示／生成対象外）と「OK で status を present にしない」が正しい
4. settings に present 説明を足す非対称解消
5. kind ラベルの事情表現化と治療食「書く欄がない」理由の明示
6. コピー単一ソースを `src/features/household` に閉じる所有境界
7. ダイアログを createDraft/start **前**に置く（テスト可能）
8. planner 拒否コピーを非目標に分離（スコープ制御）

---

## このまま出荷した場合の残余リスク（受容候補）

| 残余 | 内容 |
|---|---|
| 毎回ダイアログ | 該当なし多数派にも毎回。設計が明示的に受容 |
| 編集時ダイアログなし | none→present はフォーム説明頼み |
| present でもフル入力 | アレルギー等を省略しない（§3） |
| planner / 緊急献立の旧表現 | 用語ゆれは旅程上残る |
| 自己申告依存 | ダイアログを読まず該当なしにしたケースは従来どおり生成側で全ては防げない |
| UI refresh 文書の旧文言 | 権威の優先が実装者の記憶頼み（M3 で緩和可） |

---

## 実装計画に進む前のゲート

- [x] I1–I7 / M1–M3 を設計 r2 本文へ吸収
- [ ] `writing-plans` で実装計画を作成
- [ ] 実装（subagent-driven または inline）

**Next:** 実装計画 → 実装
