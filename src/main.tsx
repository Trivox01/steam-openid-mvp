import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { ThemeProvider } from "./state/ThemeContext";
import { TranslationProvider } from "./i18n/TranslationContext";
import "./styles/index.css";
import { AuthorizationProvider } from "./features/developer-center/AuthorizationContext";
import { services } from "./services/compositionRoot";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <TranslationProvider>
      <ThemeProvider>
        <AuthorizationProvider store={services.authorization}>
          <App />
        </AuthorizationProvider>
      </ThemeProvider>
    </TranslationProvider>
  </StrictMode>
);
