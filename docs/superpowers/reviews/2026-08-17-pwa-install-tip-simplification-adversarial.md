# 敵対的レビュー: ホーム画面案内の簡易化設計

**対象:**
[`docs/superpowers/specs/2026-08-17-pwa-install-tip-simplification-design.md`](../specs/2026-08-17-pwa-install-tip-simplification-design.md)

**親:** [`docs/superpowers/specs/2026-08-16-pwa-installable-app-shell-design.md`](../specs/2026-08-16-pwa-installable-app-shell-design.md) §2.3 / §8

**照合:** `src/features/pwa/**`、`src/styles.css`（`.card` / `.page-frame` / list-style 注記）、`e2e/specs/pwa-install-tip.spec.ts`、`src/shared/ui/stack.tsx`

**レビュー日:** 2026-08-17  
**判定（改訂前）:** `BLOCK_WITH_CONDITIONS`  
**偽陽性判定後:** I1–I4 / I6 / I7 / M1–M3 を仕様へ反映。I5 は位置語を戻さず §2.3 残差にする（短い見出しは人間が選んだ契約）。

---

## 偽陽性判定

| ID | 判定 | 扱い |
| --- | --- | --- |
| I1 Android `インストール` が実メニューと不一致 | **採用** | 副経路 2 行目を `ホーム画面に追加` に変更 |
| I2 部分一致で偽グリーン / 偽レッド | **採用** | §8 に exact / list 不在の禁則 |
| I3 320 未契約・E2E が 375 | **採用** | 行レイアウト固定 + viewport 320 |
| I4 `kind="none"` が二義 | **採用** | 排他 presentation helper |
| I5 位置ヒント削除 | **採用（残差）** | 見出しは短く保つ。位置語を戻さないことを §2.3 に書く |
| I6 番号 / VoiceOver | **採用** | 視覚番号は `aria-hidden`、`ol` に `role="list"` |
| I7 受け入れ vs E2E | **採用** | BIP はユニット専用。E2E は 3 listitem + 320 |
| M1 手順を heading にする | **採用** | 手順は `span` のみ |
| M2 チェックマーク検証不能 | **採用** | `data-icon` 固定 |
| M3 currentColor | **採用** | fill/stroke は `currentColor` のみ |
| M4 設定に溢れ保険が無い | **I3 に吸収** | 対策は共有ルートへ |

Critical なし。

## 改訂前の攻撃（要約）

1. BIP なし Android でユーザーが「インストール」をメニューに探し、実項目は `ホーム画面に追加`。
2. `追加` / `インストール` / `ホーム画面に追加` が設定見出し・ボタン・other 一文と部分一致する。
3. `kind="none"` がボタン経路と generic 経路を潰し、親が sibling を忘れる。
4. 320 内容幅 248px に対し番号 + 32px SVG + 7 文字。E2E は 375。
5. Tailwind preflight / `list-style: none` で番号消失または VO がリストを失う。
