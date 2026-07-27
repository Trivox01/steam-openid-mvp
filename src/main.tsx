import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { ThemeProvider } from "./state/ThemeContext";
import { TranslationProvider } from "./i18n/TranslationContext";
import "./styles/index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <TranslationProvider>
      <ThemeProvider>
        <App />
      </ThemeProvider>
    </TranslationProvider>
  </StrictMode>
);
