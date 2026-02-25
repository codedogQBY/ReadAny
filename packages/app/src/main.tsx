/**
 * Entry point — mount React app + beforeunload protection
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles/globals.css";
import { flushAllWrites } from "./stores/persist";

// Flush pending state writes before window closes
window.addEventListener("beforeunload", () => {
  flushAllWrites();
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
