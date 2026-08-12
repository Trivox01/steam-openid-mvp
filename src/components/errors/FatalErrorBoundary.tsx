import { Component, type ReactNode } from "react";
import { common as enCommon } from "../../locales/en/common";
import { common as arCommon } from "../../locales/ar/common";
import { reportDiagnostic } from "../../runtime/diagnostics";
import { renderErrorDetail } from "./errorBoundaryState";

/**
 * Last resort for a crash in the providers themselves, which the recoverable
 * boundary cannot see because it sits inside them.
 *
 * The need is real rather than theoretical: `ThemeProvider` calls
 * `window.matchMedia` while rendering, `TranslationProvider` and
 * `AuthorizationProvider` throw by design when a consumer escapes them, and any
 * of those throws happens above the recoverable boundary and would leave a blank
 * window.
 *
 * The fallback therefore uses no context and no hook: it reads the dictionary
 * modules directly and takes the language from the `lang` attribute that
 * `TranslationProvider` already wrote to `<html>`. There is no retry, because a
 * provider that failed to construct will fail again on remount, and no reload,
 * because that is not a recovery and would only restart the app.
 */
export class FatalErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    reportDiagnostic({
      scope: "fatal_boundary",
      category: "render_error",
      detail: renderErrorDetail(error)
    });
  }

  render() {
    if (!this.state.failed) return this.props.children;
    const arabic = document.documentElement.lang === "ar";
    const strings = arabic ? arCommon : enCommon;
    return (
      <div className="state-view error-state app-error-fallback" role="alert" dir={arabic ? "rtl" : "ltr"}>
        <h2 className="nexus-display-title">{strings["state.crashTitle"]}</h2>
        <p>{strings["state.crashPersistent"]}</p>
      </div>
    );
  }
}
