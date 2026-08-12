/**
 * The error boundary's decision logic, kept free of React so it can be tested in
 * Node without a DOM. The React class in `ErrorBoundary.tsx` owns nothing but
 * this state plus the calls into it.
 *
 * The reset key exists to stop a fallback loop: if the child throws again the
 * instant it is remounted, resetting forever would spin. After
 * `MAX_CONSECUTIVE_FAILURES` the boundary latches and stops offering a retry.
 */

export const MAX_CONSECUTIVE_FAILURES = 3;

export interface BoundaryState {
  /** Whether the fallback is showing. */
  readonly failed: boolean;
  /** Bumped on every reset; used as the child subtree key so it remounts. */
  readonly resetKey: number;
  /** Consecutive failures without an intervening successful render. */
  readonly failureCount: number;
  /** False once the boundary latches, so the fallback stops offering retry. */
  readonly canRetry: boolean;
}

export const initialBoundaryState: BoundaryState = {
  failed: false,
  resetKey: 0,
  failureCount: 0,
  canRetry: true
};

export function boundaryStateAfterError(state: BoundaryState): BoundaryState {
  const failureCount = state.failureCount + 1;
  return {
    failed: true,
    resetKey: state.resetKey,
    failureCount,
    canRetry: failureCount < MAX_CONSECUTIVE_FAILURES
  };
}

export function boundaryStateAfterReset(state: BoundaryState): BoundaryState {
  if (!state.failed || !state.canRetry) return state;
  return {
    failed: false,
    resetKey: state.resetKey + 1,
    failureCount: state.failureCount,
    canRetry: true
  };
}

/**
 * Called when the subtree renders successfully again. Clearing the counter here
 * rather than on reset is what makes "three failures" mean three in a row: a
 * page that recovers and later fails again starts from zero.
 */
export function boundaryStateAfterSuccess(state: BoundaryState): BoundaryState {
  if (state.failed || state.failureCount === 0) return state;
  return { ...state, failureCount: 0, canRetry: true };
}

/**
 * Classifies a caught render error for diagnostics only. The result never
 * reaches the UI, which always shows the same translated copy, because an
 * exception message can carry backend internals.
 */
export function renderErrorDetail(error: unknown): string {
  if (error instanceof Error) {
    const name = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(error.name) ? error.name : "Error";
    return name;
  }
  return "non_error_throw";
}
