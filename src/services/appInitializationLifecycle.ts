import { desktopSessionDiagnostics } from "./platform/DesktopSessionDiagnostics.ts";

export type AppInitializationTrigger = "boot_restore" | "manual_retry";

export interface AppInitializationLifecycle<T> {
  autoStart(): Promise<T>;
  retry(): Promise<T>;
}

/**
 * Owns the difference between the one automatic initialization for an app boot
 * and an explicit retry requested by the user. Repeated renders may call
 * autoStart again, but only retry is allowed to begin a later attempt.
 */
export function createAppInitializationLifecycle<T>(
  initialize: (trigger: AppInitializationTrigger) => Promise<T>,
  diagnostics = desktopSessionDiagnostics
): AppInitializationLifecycle<T> {
  let automaticAttempt: Promise<T> | undefined;
  let activeAttempt: Promise<T> | undefined;

  const runSingleFlight = (trigger: AppInitializationTrigger) => {
    if (activeAttempt) return activeAttempt;
    const operationId = diagnostics.operationId();
    diagnostics.record("boot_initialization_started", operationId, { trigger });
    const attempt = Promise.resolve().then(() => initialize(trigger));
    const trackedAttempt = attempt.finally(() => {
      if (activeAttempt === trackedAttempt) activeAttempt = undefined;
    });
    activeAttempt = trackedAttempt;
    return trackedAttempt;
  };

  return {
    autoStart() {
      if (automaticAttempt) {
        diagnostics.record(
          "boot_initialization_skipped_already_started",
          diagnostics.operationId(),
          { trigger: "boot_restore" }
        );
      } else {
        automaticAttempt = runSingleFlight("boot_restore");
      }
      return automaticAttempt;
    },
    retry() {
      return runSingleFlight("manual_retry");
    }
  };
}
