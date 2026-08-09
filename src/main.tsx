import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { ThemeProvider } from "./state/ThemeContext";
import { TranslationProvider } from "./i18n/TranslationContext";
import "./styles/index.css";
import "./styles/nexus-system-v2.css";
import { AuthorizationProvider } from "./features/developer-center/AuthorizationContext";
import { services } from "./services/compositionRoot";
import { PublicBadgeProvider } from "./features/profile/publicBadges/PublicBadgeContext";
import { installNativeDesktopInteractions } from "./services/nativeDesktopInteractions";

installNativeDesktopInteractions();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <TranslationProvider>
      <ThemeProvider>
        <AuthorizationProvider store={services.authorization}>
          <PublicBadgeProvider store={services.publicBadges}>
            <App />
          </PublicBadgeProvider>
        </AuthorizationProvider>
      </ThemeProvider>
    </TranslationProvider>
  </StrictMode>
);
