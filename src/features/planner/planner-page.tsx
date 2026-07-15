import { useEffect, useMemo, useState } from "react";
import type { PlannerDraft, PlannerDraftInput } from "@shared/contracts/planner";
import { detectUnsupportedMedicalRequest } from "@shared/safety/medical-scope";
import { CurrentSafetySummary, type PlannerSafetyMember } from "./current-safety-summary";
import type { PlannerAttempt } from "./expired-pantry-checks";

const mealLabels = { breakfast: "朝食", lunch: "昼食", dinner: "夕食" } as const;
const genreLabels = {
  japanese: "和食",
  western: "洋食",
  chinese: "中華",
  any: "おまかせ",
} as const;
const mainIngredientLimit = 8;

export function PlannerForm({
  initialValue,
  members,
  saveState,
  attempt,
  onChange,
  flush,
  onGenerate,
}: {
  initialValue: PlannerDraftInput;
  members: readonly PlannerSafetyMember[];
  saveState: "idle" | "saving" | "saved" | "error";
  attempt?: PlannerAttempt;
  onAttemptChange?: (next: PlannerAttempt) => void;
  onStartNewAttempt?: () => void;
  onChange: (value: PlannerDraftInput) => void;
  flush?: () => Promise<PlannerDraft>;
  onGenerate?: (draft: PlannerDraft, attempt: PlannerAttempt | undefined) => unknown;
}) {
  const [value, setValue] = useState(initialValue);
  const [ingredient, setIngredient] = useState("");
  const [ingredientError, setIngredientError] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const update = (patch: Partial<PlannerDraftInput>): void => {
    const next = { ...value, ...patch };
    setValue(next);
    onChange(next);
  };
  const medicalMatches = detectUnsupportedMedicalRequest(value.memo);
  const selectedMembers = members.filter((member) => value.targetMemberIds.includes(member.id));
  const eligibleMemberIds = useMemo(
    () =>
      new Set(members.filter((member) => member.blockedReason === null).map((member) => member.id)),
    [members],
  );
  const hasEligibleMembers = eligibleMemberIds.size > 0;
  const blocked =
    selectedMembers.some((member) => member.blockedReason !== null) || medicalMatches.length > 0;
  const requiredChoicesComplete =
    value.mealType !== null &&
    value.mainIngredients.length > 0 &&
    value.cuisineGenre !== null &&
    selectedMembers.length > 0;

  useEffect(() => {
    const reconciledTargetMemberIds = value.targetMemberIds.filter((id) =>
      eligibleMemberIds.has(id),
    );
    if (reconciledTargetMemberIds.length === value.targetMemberIds.length) return;
    const next = { ...value, targetMemberIds: reconciledTargetMemberIds };
    setValue(next);
    onChange(next);
  }, [eligibleMemberIds, onChange, value]);

  return (
    <main className="page-frame stack">
      <div>
        <p className="eyebrow">献立</p>
        <h1>3ステップで献立を決める</h1>
      </div>
      <CurrentSafetySummary members={members} />
      <section className="card stack" aria-labelledby="target-members-title">
        <h2 id="target-members-title">献立を作る家族</h2>
        {members.map((member) => (
          <div key={member.id}>
            <label>
              <input
                type="checkbox"
                checked={value.targetMemberIds.includes(member.id)}
                disabled={member.blockedReason !== null}
                onChange={(event) => {
                  update({
                    targetMemberIds: event.target.checked
                      ? [...value.targetMemberIds, member.id]
                      : value.targetMemberIds.filter((id) => id !== member.id),
                  });
                }}
              />
              {member.displayName}
            </label>
            {member.blockedReason !== null && <p>{member.blockedReason}</p>}
          </div>
        ))}
        {!hasEligibleMembers && (
          <p role="alert">献立を作れる家族がいません。家族設定を確認してください。</p>
        )}
      </section>
      <section className="card">
        <h2>1. 食事</h2>
        {Object.entries(mealLabels).map(([key, label]) => (
          <label key={key}>
            <input
              type="radio"
              name="meal"
              checked={value.mealType === key}
              onChange={() => {
                update({ mealType: key as PlannerDraftInput["mealType"] });
              }}
            />
            {label}
          </label>
        ))}
      </section>
      <section className="card">
        <h2>2. メイン食材</h2>
        <label>
          メイン食材
          <input
            value={ingredient}
            maxLength={80}
            onChange={(event) => {
              setIngredient(event.target.value);
            }}
          />
        </label>
        <button
          type="button"
          onClick={() => {
            const next = ingredient.normalize("NFKC").trim();
            if (
              next !== "" &&
              !value.mainIngredients.includes(next) &&
              value.mainIngredients.length >= mainIngredientLimit
            ) {
              setIngredientError(`メイン食材は${String(mainIngredientLimit)}件までです。`);
              return;
            }
            if (next !== "" && !value.mainIngredients.includes(next)) {
              update({ mainIngredients: [...value.mainIngredients, next] });
            }
            setIngredientError(null);
            setIngredient("");
          }}
        >
          追加
        </button>
        {ingredientError !== null && <p role="alert">{ingredientError}</p>}
        <div>
          {value.mainIngredients.map((item) => (
            <button
              type="button"
              key={item}
              onClick={() => {
                update({
                  mainIngredients: value.mainIngredients.filter((value) => value !== item),
                });
              }}
            >
              {item}を外す
            </button>
          ))}
        </div>
      </section>
      <section className="card">
        <h2>3. ジャンル</h2>
        {Object.entries(genreLabels).map(([key, label]) => (
          <label key={key}>
            <input
              type="radio"
              name="genre"
              checked={value.cuisineGenre === key}
              onChange={() => {
                update({ cuisineGenre: key as PlannerDraftInput["cuisineGenre"] });
              }}
            />
            {label}
          </label>
        ))}
      </section>
      <details className="card">
        <summary>追加条件</summary>
        <label>
          献立全体の調理時間
          <select
            value={value.timeLimitMinutes ?? ""}
            onChange={(event) => {
              const selected = event.target.value;
              update({
                timeLimitMinutes:
                  selected === "" ? null : selected === "15" ? 15 : selected === "30" ? 30 : 45,
              });
            }}
          >
            <option value="">指定なし</option>
            <option value="15">15分以内</option>
            <option value="30">30分以内</option>
            <option value="45">45分以内</option>
          </select>
        </label>
        <label>
          予算
          <select
            value={value.budgetPreference ?? ""}
            onChange={(event) => {
              update({
                budgetPreference:
                  event.target.value === "economy"
                    ? "economy"
                    : event.target.value === "standard"
                      ? "standard"
                      : null,
              });
            }}
          >
            <option value="">指定なし</option>
            <option value="economy">節約優先</option>
            <option value="standard">標準</option>
          </select>
        </label>
        <label>
          今回だけ避ける食材
          <input
            value={value.avoidIngredients.join("、")}
            onChange={(event) => {
              update({
                avoidIngredients: event.target.value
                  .split(/[、,]/u)
                  .map((item) => item.normalize("NFKC").trim())
                  .filter((item) => item !== ""),
              });
            }}
          />
        </label>
        <label>
          自由メモ
          <textarea
            maxLength={200}
            value={value.memo}
            onChange={(event) => {
              update({ memo: event.target.value });
            }}
          />
        </label>
        <p>{value.memo.length}/200</p>
        <p>「やわらかめ」は一般的な食べやすさの希望です。嚥下調整食ではありません。</p>
      </details>
      {medicalMatches.length > 0 && (
        <p role="alert">
          離乳食、飲み込み・嚥下、治療食の依頼には対応できません。専門職の指示に従ってください。
        </p>
      )}
      <p aria-live="polite">
        {
          {
            idle: "",
            saving: "保存中…",
            saved: "保存済み",
            error: "保存失敗。入力を保持したまま最新の下書きを確認しています。",
          }[saveState]
        }
      </p>
      <button
        className="primary-button"
        type="button"
        disabled={
          blocked ||
          !requiredChoicesComplete ||
          isGenerating ||
          flush === undefined ||
          onGenerate === undefined
        }
        onClick={() => {
          if (flush === undefined || onGenerate === undefined) return;
          setGenerationError(null);
          setIsGenerating(true);
          void (async () => {
            try {
              const draft = await flush();
              await onGenerate(draft, attempt);
            } catch {
              setGenerationError("献立条件を保存できなかったため、生成を開始しませんでした。");
            } finally {
              setIsGenerating(false);
            }
          })();
        }}
      >
        献立を作る
      </button>
      {generationError !== null && <p role="alert">{generationError}</p>}
      <a href="/emergency-menus">AIを使わない緊急献立を見る</a>
    </main>
  );
}
