import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import "@writalin/ui/styles.css";
import "@writalin/editor/editor.css";
import "@writalin/workspaces/styles.css";
import "./app.css";
import { App } from "./App";
import { installGlow } from "@writalin/ui";
import { trackKeyboard } from "./keyboard";

installGlow();
trackKeyboard();

registerSW({ immediate: true });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
