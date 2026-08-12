import { Component, Fragment, type ErrorInfo, type ReactNode } from "react";
import {
  boundaryStateAfterError,
  boundaryStateAfterReset,
  boundaryStateAfterSuccess,
  initialBoundaryState,
  renderErrorDetail,
  type BoundaryState
} from "./errorBoundaryState";
import { reportDiagnostic } from "../../runtime/diagnostics";

export interface ErrorFallbackProps {
  /** False once the boundary has latched, so the fallback hides its retry. */
  canRetry: boolean;
  onRetry: () => void;
}

/**
 * Catches render and lifecycle exceptions in its subtree and shows a fallback
 * instead of the blank screen React leaves behind.
 *
 * Retry remounts the subtree by changing its key. It deliberately does not
 * reload the window: a reload would rebuild the whole app, discard the in-memory
 * Steam session, the theme and the language, and turn a single broken page into
 * a full restart.
 */
export class ErrorBoundary extends Component<{
  children: ReactNode;
  fallback: (props: ErrorFallbackProps) => ReactNode;
  /** Stable identifier for diagnostics, e.g. "app_shell". Never user data. */
  route?: string;
}, BoundaryState> {
  state = initialBoundaryState;

  static getDerivedStateFromError(): Partial<BoundaryState> {
    // The real transition needs the previous state, so it happens in the
    // updater below; this only guarantees the fallback renders this commit.
    return { failed: true };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    this.setState(boundaryStateAfterError);
    // Only the error's class name and a sanitized component stack are recorded.
    // The exception message is never logged: it is the most common carrier of
    // backend internals, paths and identifiers.
    reportDiagnostic({
      scope: "error_boundary",
      category: "render_error",
      ...(this.props.route ? { route: this.props.route } : {}),
      detail: `${renderErrorDetail(error)} ${info.componentStack ?? ""}`
    });
  }

  componentDidUpdate() {
    const cleared = boundaryStateAfterSuccess(this.state);
    if (cleared !== this.state) this.setState(cleared);
  }

  private readonly retry = () => this.setState(boundaryStateAfterReset);

  render() {
    if (this.state.failed) {
      return this.props.fallback({ canRetry: this.state.canRetry, onRetry: this.retry });
    }
    return <Fragment key={this.state.resetKey}>{this.props.children}</Fragment>;
  }
}
