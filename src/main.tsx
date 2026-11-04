import "./lib/relay"; // 중계 모드(?relay=)면 Tauri 흉내를 먼저 깐다 — 다른 모듈보다 앞에
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { CardApp } from "./card/CardApp";
import { ErrorBoundary } from "./components/ui/ErrorBoundary";
import "./index.css";

// 탐색기 우클릭 "KorDoc AI에게 맡기기…"로 뜬 문서 카드 창 (Rust shell::open_card)
const card = new URLSearchParams(window.location.search).get("card");

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      {card ? <CardApp raw={card} /> : <App />}
    </ErrorBoundary>
  </StrictMode>
);
