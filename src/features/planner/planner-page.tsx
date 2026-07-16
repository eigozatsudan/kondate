import { useEffect, useMemo, useState } from "react";
import { collectPlannerRequestText } from "@shared/contracts/planner";
import type { PlannerDraft, PlannerDraftInput } from "@shared/contracts/planner";
import type { PantryItem } from "@shared/contracts/pantry";
import { detectUnsupportedMedicalRequest } from "@shared/safety/medical-scope";
import { CurrentSafetySummary } from "./current-safety-summary";
import type { PlannerAttempt } from "./expired-pantry-checks";
import { PantrySelector, type PantryItemsStatus } from "./pantry-selector";
import { memberSafetyText, type PlannerSafetyMember } from "./planner-safety-member";

const mealLabels = { breakfast: "朝食", lunch: "昼食", dinner: "夕食" } as const;
const genreLabels = {
  japanese: "和食",
  western: "洋食",
  chinese: "中華",
  any: "おまかせ",
} as const;
const mainIngredientLimit = 8;
const mainIngredientLengthLimit = 80;
const targetMemberLimit = 20;
const avoidIngredientLimit = 20;
const avoidIngredientLengthLimit = 80;

function parseAvoidIngredientInput(rawValue: string): {
  text: string;
  items: string[];
  hasTooManyItems: boolean;
  hasTooLongItem: boolean;
} {
  const segments = rawValue.split(/[、,]/u).map((segment) => segment.normalize("NFKC"));
  const normalizedItems = segments.map((segment) => segment.trim()).filter((item) => item !== "");
  const hasTooManyItems = normalizedItems.length > avoidIngredientLimit;
  const hasTooLongItem = normalizedItems.some(
    (item) => Array.from(item).length > avoidIngredientLengthLimit,
  );
  const items = normalizedItems
    .slice(0, avoidIngredientLimit)
    .map((item) => Array.from(item).slice(0, avoidIngredientLengthLimit).join(""));

  if (hasTooManyItems) {
    return { text: items.join("、"), items, hasTooManyItems, hasTooLongItem };
  }

  return {
    text: segments
      .map((segment) => {
        const trimmed = segment.trim();
        if (Array.from(trimmed).length <= avoidIngredientLengthLimit) return segment;
        return Array.from(trimmed).slice(0, avoidIngredientLengthLimit).join("");
      })
      .join("、"),
    items,
    hasTooManyItems,
    hasTooLongItem,
  };
}

export function PlannerForm({
  initialValue,
  members,
  saveState,
  pantryItems,
  pantryItemsStatus,
  attempt,
  onAttemptChange,
  onChange,
  flush,
  onGenerate,
}: {
  initialValue: PlannerDraftInput;
  members: readonly PlannerSafetyMember[];
  saveState: "idle" | "saving" | "saved" | "error";
  pantryItems: readonly PantryItem[];
  pantryItemsStatus: PantryItemsStatus;
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
  const [avoidIngredientText, setAvoidIngredientText] = useState(
    initialValue.avoidIngredients.join("、"),
  );
  const [avoidIngredientError, setAvoidIngredientError] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const update = (patch: Partial<PlannerDraftInput>): void => {
    const next = { ...value, ...patch };
    setValue(next);
    onChange(next);
  };
  const medicalMatches = detectUnsupportedMedicalRequest(collectPlannerRequestText(value));
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
  const pantryItemIds = new Set(pantryItems.map((item) => item.id));
  const hasUnavailablePantrySelections =
    pantryItemsStatus === "loaded" &&
    value.pantrySelections.some((selection) => !pantryItemIds.has(selection.pantryItemId));

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
        {members.map((member, memberIndex) => {
          const descriptionId = `planner-member-${String(memberIndex + 1)}-description`;
          return (
            <div key={member.id}>
              <label>
                <input
                  type="checkbox"
                  aria-describedby={descriptionId}
                  checked={value.targetMemberIds.includes(member.id)}
                  disabled={
                    member.blockedReason !== null ||
                    (!value.targetMemberIds.includes(member.id) &&
                      value.targetMemberIds.length >= targetMemberLimit)
                  }
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
              <div id={descriptionId}>
                <p>{memberSafetyText(member)}</p>
                {member.blockedReason !== null && <p>{member.blockedReason}</p>}
              </div>
            </div>
          );
        })}
        {value.targetMemberIds.length >= targetMemberLimit &&
          members.some(
            (member) => member.blockedReason === null && !value.targetMemberIds.includes(member.id),
          ) && <p>対象家族は20人までです。選択中の家族を外すと追加できます。</p>}
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
            onChange={(event) => {
              const rawValue = event.target.value;
              setIngredient(rawValue);
              if (
                Array.from(rawValue.normalize("NFKC").trim()).length <= mainIngredientLengthLimit
              ) {
                setIngredientError(null);
              } else {
                setIngredientError("メイン食材は1件80文字までです。");
              }
            }}
          />
        </label>
        <button
          type="button"
          onClick={() => {
            const next = ingredient.normalize("NFKC").trim();
            if (Array.from(next).length > mainIngredientLengthLimit) {
              setIngredientError("メイン食材は1件80文字までです。");
              return;
            }
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
            value={avoidIngredientText}
            onChange={(event) => {
              const parsed = parseAvoidIngredientInput(event.target.value);
              setAvoidIngredientText(parsed.text);
              if (
                parsed.items.length !== value.avoidIngredients.length ||
                parsed.items.some((item, index) => item !== value.avoidIngredients[index])
              ) {
                update({ avoidIngredients: parsed.items });
              }
              setAvoidIngredientError(
                parsed.hasTooManyItems
                  ? "避ける食材は20件までです。"
                  : parsed.hasTooLongItem
                    ? "避ける食材は1件80文字までです。"
                    : null,
              );
            }}
          />
        </label>
        {avoidIngredientError !== null && <p role="alert">{avoidIngredientError}</p>}
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
      {attempt !== undefined && onAttemptChange !== undefined && (
        <PantrySelector
          items={pantryItems}
          itemsStatus={pantryItemsStatus}
          selections={value.pantrySelections}
          attempt={attempt}
          onAttemptChange={onAttemptChange}
          onChange={(pantrySelections) => {
            update({ pantrySelections: [...pantrySelections] });
          }}
        />
      )}
      {hasUnavailablePantrySelections && (
        <p role="alert">冷蔵庫から削除された食材の選択を解除してから献立を作ってください。</p>
      )}
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
          saveState === "error" ||
          hasUnavailablePantrySelections ||
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
