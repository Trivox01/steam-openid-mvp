import { useEffect, useRef } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { useTranslation } from "../../i18n/TranslationContext";
import type { ErrorFallbackProps } from "./ErrorBoundary";

/**
 * The fallback shown when a page crashes during render.
 *
 * It shows fixed translated copy and never the exception: no message, no stack,
 * no file path, no identifier. The category is recorded through diagnostics
 * instead, where it stays sanitized and out of the interface.
 *
 * This lives inside the translation and theme providers, so it inherits the
 * active language, direction and palette; the boundary that renders it does not
 * remount those providers.
 */
export function AppErrorFallback({ canRetry, onRetry }: ErrorFallbackProps) {
  const { t } = useTranslation();
  const heading = useRef<HTMLHeadingElement>(null);
  // The crashed subtree is gone, so focus would otherwise fall back to the body
  // and a keyboard or screen-reader user would lose their place.
  useEffect(() => { heading.current?.focus(); }, []);
  return (
    <div className="state-view error-state app-error-fallback" role="alert">
      <AlertTriangle aria-hidden="true" />
      <h2 className="nexus-display-title" ref={heading} tabIndex={-1}>
        {t("state.crashTitle")}
      </h2>
      <p>{canRetry ? t("state.crashDescription") : t("state.crashPersistent")}</p>
      {canRetry && (
        <button className="primary-button" type="button" onClick={onRetry}>
          <RotateCcw size={16} aria-hidden="true" /> {t("state.retry")}
        </button>
      )}
    </div>
  );
}
