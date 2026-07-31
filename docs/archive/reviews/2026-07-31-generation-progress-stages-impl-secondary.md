# 二次検証: 献立作成進捗（体感用）実装レビュー

| 項目 | 値 |
|------|-----|
| 対象 | commits `b0dc04b` → `145047b` → `7c8319c` |
| 一次 | `docs/archive/reviews/2026-07-31-generation-progress-stages-impl-primary.md` |
| 敵対的 | `docs/archive/reviews/2026-07-31-generation-progress-stages-impl-adversarial.md` |
| 日付 | 2026-07-31 |
| 種別 | 独立二次検証（read-only + 焦点テスト再実行） |
| 判定 | **Approve / ACCEPT を維持。追加 Must なし** |

---

## 1. 独立検証（二次が自分でやったこと）

### テスト再実行

```bash
docker compose run --rm --no-deps app npm test -- --run \
  src/features/generation/model/progress-stages.test.ts \
  src/features/generation/hooks/use-generation-progress-message.test.tsx \
  src/features/generation/components/generation-status-panel.test.tsx \
  src/app/accessibility.test.tsx
```

**結果: 4 files / 77 tests PASS**（2026-07-31 二次セッション）。

jsdom canvas / 無関係 a11y の `act` 警告は既存ノイズ。失敗なし。

### コード照合（抜粋）

- `progress-stages.ts`: 表 L3 一致、`stageMessageAt` に `!` なし、L2 helper  
- `use-generation-progress-message.ts`: sticky / sync / L1 / 1000ms  
- `generation-status-panel.tsx` L222–233: early return 前の単一 hook  
- panel tests: sticky submitting、相対 each、V-I2 跨ぎ、unmount timer  
- a11y: 旧固定文削除、表 OR

---

## 2. 一次 finding の判定

| 一次 | 二次 | 結論 |
|------|------|------|
| Approve・高信頼度指摘なし | **CONFIRMED** | 維持 |

ロック表（V-C1/V-C2/L1/配線/L2/表/契約/プライバシー/テスト）はソースと一致。異論なし。

---

## 3. 敵対的 finding の判定

| ID | 二次 | 理由 |
|----|------|------|
| D-C1〜D-C3 | **Reject 維持** | R1 許容 / L1+panel it / early return 前 hook |
| D-I1〜D-I9 | **Reject 維持** | cleanup・a11y・固定表・境界・相対時刻・R8・offline 設計・`!` なし |
| D-M1 | **CONFIRMED Minor** | `active→false` の timer 明示 it は無いが effect cleanup は正しい |
| D-M2 | **CONFIRMED Minor** | a11y any-of は設計・計画意図 |

**昇格すべき Important / Critical はなし。**

---

## 4. 統合表

| ID | Severity | 扱い |
|----|----------|------|
| — | Critical | なし |
| — | Important | なし |
| D-M1 | Minor | 任意: active false で timer 0 の it |
| D-M2 | Minor | 任意: a11y で stage0 固定（now） |

---

## 5. 総合判定

| 項目 | 結論 |
|------|------|
| 実装品質 | 設計・計画 r1 に適合 |
| 回帰リスク | checking/offline/終端は進捗を出さない。契約非変更 |
| テスト | 二次再実行 77/77 PASS |
| 修正必須 | **なし** |
| マージ可否 | **可**（push/PR はリポジトリ方針に従う） |

**Verdict:** 一次 **Approve** と敵対的 **ACCEPT** を二次確認で維持する。実装フォローアップの Must はない。

### フォローアップ（2026-07-31）

非擬陽性の Minor のみを `78d52a2` で閉じた:

| ID | 対応 |
|----|------|
| D-M1 | hook: `active→false` で `vi.getTimerCount()===0`。panel: submitting→checking で同様 |
| D-M2 | a11y: `startedAt≈now` で stage0 文言 + `data-progress-stage="0"` |
