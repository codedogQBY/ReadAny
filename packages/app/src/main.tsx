/**
 * Entry point — mount React app + beforeunload protection
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./i18n";
import "./styles/globals.css";
import { useLibraryStore } from "./stores/library-store";
import { flushAllWrites } from "./stores/persist";

// Flush pending state writes before window closes
window.addEventListener("beforeunload", () => {
  flushAllWrites();
});

// Initialize database and load books
useLibraryStore.getState().loadBooks();

// Fire-and-forget: preload foliate-js core modules so they're cached for later use
import("foliate-js/view.js").catch(() => {});
import("foliate-js/paginator.js").catch(() => {});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
