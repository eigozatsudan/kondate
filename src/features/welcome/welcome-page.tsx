import { useEffect, useRef, useState } from "react";
import { Navigate } from "react-router";
import type { OnboardingStatus } from "@shared/contracts/domain";
import "./welcome-page.css";

export type WelcomePageProps = {
  onboardingStatus: OnboardingStatus;
  onStartIdea: () => Promise<void>;
  onStartHousehold: () => Promise<void>;
};

const tutorialSlides = [
  {
    title: "質問に答えて、献立を作れます",
    description:
      "食べる人数や使いたい食材など、かんたんな質問に答えるだけで献立アイデアを作れます。",
    decoration: "🍳",
  },
  {
    title: "家族情報は、あとからでも登録できます",
    description:
      "家族情報の登録は任意です。登録すると、人数や好みに合わせた家族向けの献立も作れます。",
    decoration: "🏠",
  },
  {
    title: "献立を見返して、買い物にもつなげられます",
    description:
      "作った献立は履歴からいつでも見返せます。家族向けの献立は、必要な食材を買い物リストにできます。",
    decoration: "🛒",
  },
] as const;

// WelcomePage は家族設定を任意化したあとの入口。
// not_started/in_progress の利用者にだけ操作を見せ、complete/skipped で直接
// アクセスされた場合は操作を出さずに /planner へ即時リダイレクトする
// （ここで status を skipped/complete へ書き換えることはしない。判断済みの状態を尊重するだけ）。
export function WelcomePage({ onboardingStatus, onStartIdea, onStartHousehold }: WelcomePageProps) {
  const [slideIndex, setSlideIndex] = useState(0);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const hasMounted = useRef(false);

  useEffect(() => {
    // 初期表示では自然な読み順を保ち、利用者がスライドを変えたときだけ新しい見出しを通知する。
    if (hasMounted.current) {
      headingRef.current?.focus();
    } else {
      hasMounted.current = true;
    }
  }, [slideIndex]);

  if (onboardingStatus === "complete" || onboardingStatus === "skipped") {
    return <Navigate to="/planner" replace />;
  }

  // state更新は範囲内に制限しているが、型上も必ず表示内容を持つよう先頭を安全網にする。
  const slide = tutorialSlides[slideIndex] ?? tutorialSlides[0];
  const isFirstSlide = slideIndex === 0;
  const isLastSlide = slideIndex === tutorialSlides.length - 1;
  const ideaLabel =
    onboardingStatus === "in_progress" ? "設定せず献立アイデアを考える" : "献立アイデアを考える";
  const householdLabel =
    onboardingStatus === "in_progress" ? "家族設定を続ける" : "家族情報を登録する";

  return (
    <main className="page-frame guided-planner-theme welcome-tutorial">
      <header className="welcome-tutorial__header">
        <p className="eyebrow">はじめに</p>
        <h1 className="welcome-tutorial__page-title">どちらから始めますか？</h1>
      </header>
      <section className="welcome-tutorial__slide" aria-labelledby="welcome-tutorial-title">
        <span className="welcome-tutorial__decoration" aria-hidden="true">
          {slide.decoration}
        </span>
        <h2
          className="welcome-tutorial__title"
          id="welcome-tutorial-title"
          ref={headingRef}
          tabIndex={-1}
        >
          {slide.title}
        </h2>
        <p className="welcome-tutorial__description">{slide.description}</p>
      </section>

      <div className="welcome-tutorial__controls">
        <button
          className="welcome-tutorial__move-button"
          type="button"
          disabled={isFirstSlide}
          onClick={() => {
            setSlideIndex((current) => Math.max(0, current - 1));
          }}
        >
          戻る
        </button>
        <ol
          className="welcome-tutorial__indicator"
          aria-label={`チュートリアル ${String(slideIndex + 1)} / ${String(tutorialSlides.length)}`}
        >
          {tutorialSlides.map((item, index) => (
            <li
              className="welcome-tutorial__indicator-item"
              aria-current={index === slideIndex ? "step" : undefined}
              key={item.title}
            >
              {index + 1}
            </li>
          ))}
        </ol>
        <button
          className="welcome-tutorial__move-button"
          type="button"
          disabled={isLastSlide}
          onClick={() => {
            setSlideIndex((current) => Math.min(tutorialSlides.length - 1, current + 1));
          }}
        >
          次へ
        </button>
      </div>

      <div className="welcome-tutorial__actions">
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
      </div>
    </main>
  );
}
