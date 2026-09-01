# 献立ひねり軸 Implementation Plan — 再々レビュー（敵対的）

- 日付: 2026-08-31
- 対象: `docs/superpowers/plans/2026-08-31-menu-novelty-axis.md` @ `6455863a`
- 姿勢: 本文を一字一句貼る。improvisation 無し。Task GREEN が嘘になる経路だけを成立させる。
- 判定: **REVISE。成立した攻撃は 9b PASS、コピー関数 null、`…f7` unique、P-06 自作禁止、Step 13 の null 再指示。**

## 成立

### A-1 Step 9b の typecheck PASS（R-01 残）

regen 後 generated Args は `p_novelty_preference: string` 必須。overlay は次の 9c。9b は camelCase null を足せと書き、PASS を要求する。Args 欠キーは消えない。実装者は 9c に進めないか、ダミー string を invent して 9c で巻き戻す。

### A-2 コピー関数を null 固定 → Task 2 が足せない / wipe 出荷

`toDraftInputFields` / `toPlannerDraftInput` / `submissionCandidate` は `PlannerDraftInput` を返す。契約変更の瞬間にキー必須。9b は全部 null。autosave の canonical が twist を落とす → Task 2 の「ひねりだけ保存」は空判定の前に値を失う。Task 2 が同じキーをもう 1 行足すと TS1117。キーがあるからスキップすると定数 null が残る。

### A-3 `…f7` unique（R-02 残）

計画は「衝突しない前提」で `1000…f7` / `3000…f7` を貼らせる。live `$pantry_recheck$` が両方使う。novelty DO の `auth.users` INSERT のあと pantry_recheck の INSERT が PK 違反。Step 8 全 PASS は起きない。grep してずらせは improvisation。

「3185 行目のブロックの後ろ」を行番号どおり 3185 の直後に読むと、進行中の `do $idea_finalize$` の中へ SQL が入り syntax error。ブロック終端 `:3488` の後ろなら unique。どちらでも Step 8 は止まる。

### A-4 P-06 自作禁止

サンプルは `makeBrowserClientStub`。本文はチェーン自作禁止。live にそのヘルパーも `from().select()` も `getPlannerDraft` import も無い。select ロックテストを書けない。書けないと F-02（GET 列漏れ + `.default(null)` が twist を潰す）がテスト緑で再発する。

### A-5 Step 13 が 9c を否定

「planner-api が落ちたら `noveltyPreference: null`。配線は Task 2」。9c は既に `p_novelty_preference: input.noveltyPreference`。A-2 の null 植えを overlay 後にもう一度指示する。

## 不成立

| 攻撃 | 理由 |
| --- | --- |
| JWT が DO ローカルで snapshot `select is` が空 | snapshot は `p_user_id`、`auth.uid()` 不使用、security definer。既存 `:1230` が DO 外から呼ぶ |
| `repeat('f',64)` unique | `:1092` の request は `:1096` で削除。unique は `(user_id, idempotency_key)` |
| Task 1 Files 欠で 9c が消える | SubAgents は Task 全文。9c と git add にある。Minor |
| Step 1 で `incompleteDraft` にキーを足すと既存 toEqual が罠 | Step 2 の unrecognized_keys と同一。Step 3 後は PASS |
| snapshot 列が migrate 前 | Step 8 が migrate してから db-test |
| selected_only 往復への差し込み | 本文が禁止し、独立 DO になっている |
| 安全 / quota / HMAC / PromptPreferences / 2-pass / temperature / 漢字畳み / radio / 13 引数 DROP | 再開しない |

## Assessment

実装禁止。貼るだけだと Task 1 Step 8 が unique で止まり、止まらなくても Step 9b PASS が無く、クライアントは twist を null に写す。
