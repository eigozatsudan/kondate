# Plan 6開始ゲート Important closure（最新権威）

**日付:** 2026-07-24
**対象:** Plan 6 Start gate §2
**開始基準HEAD:** `7acef702762fa2f81ca77d31ecceb81b803ac38c`
**branch:** `main`
**worktree:** `/home/dev/projects/kondate`

この文書は
`.superpowers/sdd/plan-reviews-2026-07-24/02-important-closure.md`
の後継であり、同文書のImportant 20件のinventoryと判定（15件closed、5件deferred、
open 0件）を継承する。Plan 6 Start gate §2の延期所有・残余リスク・acceptance
matrix対応については、この文書を最新の権威とする。

## Closed 15件

| ID | 状態 | closing commit |
| --- | --- | --- |
| P3#1 | closed | `17a31bd` |
| P3#2 | closed | `9e76991` |
| P3#3 | closed | `a1bf89a`、型整合は`42db9ad` |
| P3#4 | closed | `42db9ad` |
| P4#1 | closed | `badbaa1` |
| P4#2 | closed | `badbaa1` |
| P4#3 | closed | `5ff1747` |
| P2#1 | closed | `d079451`、fixture調整は`bdbbd9a` |
| P2#2 | closed | `d079451`、fixture調整は`bdbbd9a` |
| P2#3 | closed | `d079451` |
| P5#1 | closed | `540dbfd` |
| P5#2 | closed | `bdbbd9a` |
| P5#3 | closed | `bdbbd9a` |
| P5#5 | closed | `540dbfd`、pgTAP matrixは`bdbbd9a` |
| P7#1 | closed | `cd73b7c` |

同一修正で複数IDを閉じたため、同じclosing commitを共有する行がある。closing
commit集合は `17a31bd`、`9e76991`、`a1bf89a`、`42db9ad`、`badbaa1`、
`5ff1747`、`d079451`、`bdbbd9a`、`540dbfd`、`cd73b7c` である。

## Deferred 5件

5件すべての単一実装ownerは **Plan 6 Task 6 Implementer** とする。Verifierは
独立検証だけを担当し、修正ownerではない。以下は既存Plan 6 Task 6
（`docs/superpowers/plans/2026-07-11-kondate-mvp-06-hardening-deployment.md`
1375–1657行）のaddendumであり、元Taskの契約を置き換えない。

### P3#5 — finalize対allergy mutationの二session競合

- **残余リスク:** helper/unitでは終端化を確認済みだが、実DBでallergy更新と
  finalizeを停止・再開する二session競合を証明していない。lock取得順により、
  古いfingerprintのmenuが保存されたり、成功予約の解放・attempt accountingが
  崩れる可能性が残る。
- **MVP rows:** **#6、#20**。
- **Task 6追加scope:** authority file
  `supabase/tests/database/ai_control_and_quota_races.test.sql` に二sessionの
  finalize対allergy mutation raceを追加する。
- **完了条件:** どちらのlock順でもstored fingerprint不一致のmenuが0件である。
  競合時は `constraint_conflict` / `current_safety_changed`、menu 0件、成功予約の
  解放とattempt accountingの整合を実assertで証明する。

### P4#4 — history safety-changeの非vacuuous E2E

- **残余リスク:** unconfirmed allergy pathとpgTAPの説明的証拠はあるが、標準
  allergen hit後のinvalid revalidate、操作停止、自動再検査signalをbrowserで
  一続きに証明していない。narrativeだけが通り実挙動が壊れても検出できない
  可能性が残る。
- **MVP rows:** **#6、#14**。
- **Task 6追加scope:** `e2e/specs/history-safety-change.spec.ts` と
  `e2e/fixtures/history.ts` に、標準allergen hitでrevalidateが200かつinvalid
  issue listを返し、操作がdisabledになるテストを追加する。Realtime、focus、
  visibility、online、最大60秒のうちPlan既存契約が要求する自動signalを
  非vacuuousに証明する。既存pgTAPがnarrative passだけなら
  `supabase/tests/database/history_regeneration.test.sql` もTask 6 scopeに含め、
  実assertへ修正する。
- **完了条件:** 上記browser経路と必要なpgTAP assertが通り、row #6/#14にexact
  fileとtest titleを記録する。

### P1#1 — auth continuation handler adversarial unit

- **残余リスク:** SQL/crypto単体では、Netlify handler glueがwrong/missing
  Originやstate/secret不一致を誤って受理し、開いた応答を返す退行を検出できない。
- **MVP rows:** **#2**。
- **Task 6追加scope:** `netlify/functions/auth-continuation-create.test.ts`、
  `netlify/functions/auth-continuation-deposit.test.ts`、
  `netlify/functions/auth-continuation-claim.test.ts` にwrong/missing Origin、
  state/secret hash binding、closed responseのassertを追加する。
- **完了条件:** 対象handlerのfocused unitが上記拒否境界とclosed envelopeを
  実assertし、row #2にexact fileとtest titleを記録する。

### P1#2 — OAuth cancel/expiryの正直なE2E

- **残余リスク:** synthetic titleだけでは、実oauth-mock cancel authority、
  期限切れcontinuation、safe copy、transient eraseが結線されたことを証明
  できない。
- **MVP rows:** **#2**。
- **Task 6追加scope:** `e2e/specs/auth-callback-security.spec.ts` を新規作成し、
  必要に応じて既存auth recovery fixtureとoauth-mockを利用する。real
  oauth-mock cancel authorityを通し、過去の `expires_at` をseedした
  continuationでexpiry、safe copy、transient code/state消去を確認する。
- **完了条件:** 300秒sleepを使わず上記E2Eが通り、row #2にexact fileとtest
  titleを記録する。

### P1#3 — deposit/claim handler成功crypto roundtrip

- **残余リスク:** crypto unitとpgTAPが通っても、handler成功経路で暗号化前後の
  順序、ciphertextの非露出、HTTP envelopeが退行する可能性が残る。
- **MVP rows:** **#2**。
- **Task 6追加scope:** deposit/claim handler testsにreal crypto keyと
  in-memory transition doubleを用いた成功roundtripを追加する。
- **完了条件:** encrypt-before-deposit、decrypt-after-claim、ciphertext
  非露出、depositの204 / claimの200 envelopeを実assertし、row #2にexact
  fileとtest titleを記録する。

## Task 6完了ゲート

追加scopeのfocused unit、pgTAP、E2EをすべてPASSさせる。
`docs/testing/acceptance-matrix.md` のMVP rows **#2、#6、#14、#20**へexact
fileとexact test titleを記録し、独立Verifierと独立Reviewerの検証を受ける。
Critical/Importantが残る場合はTask 6を完了しない。

## Start gate結論

Important 20件はclosed 15件、明示延期5件、open 0件である。延期5件はすべて
Plan 6 Task 6 Implementerへ単一所有され、残余リスク、MVP rows、追加scope、
完了条件が確定した。これにより、DB resetとfull E2Eの別途PASS readbackを除く
§2の文書要件は満たす。
