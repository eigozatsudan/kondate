import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AppProviders } from "./app/providers";
import "./styles.css";

const root = document.getElementById("root");

if (root === null) {
  throw new Error("Application root element was not found");
}

createRoot(root).render(
  <StrictMode>
    <AppProviders>
      <main className="page-frame">
        <p className="eyebrow">毎日の献立を、家族に合わせて</p>
        <h1>こんだて日和</h1>
        <p>ログインと家族設定の準備をしています。</p>
      </main>
    </AppProviders>
  </StrictMode>,
);
