import { Navigate } from "react-router";
import type { OnboardingStatus } from "@shared/contracts/domain";

export type WelcomePageProps = {
  onboardingStatus: OnboardingStatus;
  onStartIdea: () => Promise<void>;
  onStartHousehold: () => Promise<void>;
};

// WelcomePage は家族設定を任意化したあとの入口。
// not_started/in_progress の利用者にだけ操作を見せ、complete/skipped で直接
// アクセスされた場合は操作を出さずに /planner へ即時リダイレクトする
// （ここで status を skipped/complete へ書き換えることはしない。判断済みの状態を尊重するだけ）。
export function WelcomePage({ onboardingStatus, onStartIdea, onStartHousehold }: WelcomePageProps) {
  if (onboardingStatus === "complete" || onboardingStatus === "skipped") {
    return <Navigate to="/planner" replace />;
  }

  const ideaLabel =
    onboardingStatus === "in_progress" ? "設定せず献立アイデアを考える" : "献立アイデアを考える";
  const householdLabel =
    onboardingStatus === "in_progress" ? "家族設定を続ける" : "家族情報を登録する";

  return (
    <main className="page-frame stack guided-planner-theme">
      <div>
        <p className="eyebrow">はじめに</p>
        <h1>どちらから始めますか？</h1>
        <p>
          家族情報の登録は必須ではありません。あとからいつでも設定できます。まずは献立アイデアだけを試すこともできます。
        </p>
      </div>
      <button
        className="primary-button"
        type="button"
        onClick={() => {
          void onStartIdea();
        }}
      >
        {ideaLabel}
      </button>
      <button
        className="secondary-button"
        type="button"
        onClick={() => {
          void onStartHousehold();
        }}
      >
        {householdLabel}
      </button>
    </main>
  );
}
