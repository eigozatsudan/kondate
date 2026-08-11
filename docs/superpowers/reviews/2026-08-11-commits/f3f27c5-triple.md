# Triple review: `f3f27c5` feat(e2e): project の grepInvert で mobile/desktop only を分ける

- **Full SHA:** `f3f27c50e17e84c4ce0ee3130e916e9bdd22cdd0`
- **Parent:** `891431e5b1da0c514a51a01076087026a8b5a33d`
- **種別:** 実装（config + tooling）
- **差分の核:** `playwright.config.ts` に mobile `grepInvert: /@desktop-only/`、desktop `grepInvert: /@mobile-only/`。`project-config.test.mjs` に極性 assert 追加
- **照合:** Spec §4.1（891431e 反映後）、review package 内 config、後続タグ commit 前提
- **重点:** project skip 漏れ・極性逆転・false green tooling

---

## 1次レビュー

### Summary

Spec が要求する **project skip の単一入口を config に置く**変更で、fixture グラフや raw `@playwright/test` に依存しない。極性は正しい（mobile が desktop-only を除外、desktop が mobile-only を除外）。

**この commit 単体ではタグ未付与**のため、runtime のフィルタ効果はほぼ無（invert 対象タグ 0）。意図的な Task 分割として妥当。`pass-with-no-tests` は触っていない。workers / privacy / product limit 非変更。

### Verdict: **APPROVE_WITH_NITS**（中間 commit として）

### Findings

#### Critical

（なし）

#### Important

| ID | 内容 |
| --- | --- |
| F1 | tooling の極性 assert が `name: "mobile-chromium"[\s\S]*?grepInvert` 形だと **project 境界を跨ぎ**、逆転 config でも false green しうる（当時のテスト実装が弱い場合）。config 実装自体は正しい |
| F2 | タグ無しのまま merge されると Phase 1 短縮効果 0 — 後続 Task 必須。単体では完了条件 §5.5 を満たさない |

#### Minor

| ID | 内容 |
| --- | --- |
| M1 | `@desktop-only` 付与 test はまだ 0 — 将来用。問題なし |
| M2 | コメントで fixture 非依存を説明しており意図は明瞭 |

---

## 敵対的レビュー

### Summary

「grepInvert を入れた」と見せかけて **逆極性 / 無 polarity テスト / fixture 併用で二重 skip** を突く。

### Attack scenarios

| # | 攻撃 | 判定 |
| --- | --- | --- |
| 1 | mobile に `/@mobile-only/` を付けて a11y を mobile から落とす | **実装は正しい**。tooling が跨ぎ false green なら **ガード漏れ**（I1） |
| 2 | grepInvert を削除し desktop で a11y 二重実行 | この commit 時点ではタグ無しなので **実害は後続**。タグ後は Critical 級退行 |
| 3 | fixture beforeEach に別 skip を足して入口を二重化 | **本 commit は config のみ** — 散発 skip は追加していない（良い） |
| 4 | pass-with-no-tests を同時導入 | **無し** — 反証 |
| 5 | 正規表現の部分一致で workers 等を壊す | **非変更** |

### Findings

#### Critical

（なし）

#### Important

- **I1:** 極性テストの非局所 regex による false green 可能性（後続 33c10be で project ブロック単位に強化された類の穴）
- **I2:** 単独では §5.5「desktop a11y 0」を証明できない — タグ commit 依存

#### Minor

- 中間状態で main に長時間残ると「grepInvert があるから a11y は desktop 0」と誤解されうる — コメントで用途は説明済み

---

## 2次検証

### Cross-walk

| 指摘 | 判定 |
| --- | --- |
| 極性実装 | **PASS** — mobile→`/@desktop-only/`、desktop→`/@mobile-only/` |
| fixture 非依存 | **PASS** — config のみ |
| tooling 弱さ F1/I1 | **CONFIRMED residual**（当時）。実装破壊ではない |
| 中間 commit としての完全性 | **意図的不完全** — 次 0842d22 がタグ |

### Must-fix

**なし**（後続タグ・強化が前提の中間 commit）。

### Final: **APPROVE_WITH_NITS**

**理由:** Spec §4.1 の入口固定は正しい。skip 漏れの runtime リスクは **タグ未付与の今は低**、タグ後は tooling 極性の穴が残る。Critical 切替バグなし。

TRIPLE_REVIEW_COMPLETE
