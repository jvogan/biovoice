import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import "./styles.css";

// Bootstrap dark-mode class before first render to avoid FOUC.
(() => {
  if (typeof window === "undefined") return;
  const stored = window.localStorage.getItem("theme");
  const isDark =
    stored === "dark"
    || (stored !== "light" && window.matchMedia?.("(prefers-color-scheme: dark)").matches)
    || stored === null;
  document.documentElement.classList.toggle("dark", isDark);
})();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
