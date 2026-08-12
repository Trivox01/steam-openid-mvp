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
import { ErrorBoundary } from "./components/errors/ErrorBoundary";
import { AppErrorFallback } from "./components/errors/AppErrorFallback";
import { FatalErrorBoundary } from "./components/errors/FatalErrorBoundary";
import { installGlobalErrorDiagnostics } from "./runtime/diagnostics";

installNativeDesktopInteractions();
// Diagnostics only. Failures that reach the window never render anything: the
// error boundary and the per-page states own everything the user sees.
installGlobalErrorDiagnostics();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <FatalErrorBoundary>
      <TranslationProvider>
        <ThemeProvider>
          <AuthorizationProvider store={services.authorization}>
            <PublicBadgeProvider store={services.publicBadges}>
              {/*
                Inside every provider on purpose. A page crash resets only the app
                subtree, so the Steam session, the authorization snapshot, the
                loaded badges, the theme and the language all survive a retry.
              */}
              <ErrorBoundary route="app_shell" fallback={AppErrorFallback}>
                <App />
              </ErrorBoundary>
            </PublicBadgeProvider>
          </AuthorizationProvider>
        </ThemeProvider>
      </TranslationProvider>
    </FatalErrorBoundary>
  </StrictMode>
);
