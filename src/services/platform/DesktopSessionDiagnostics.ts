import { invoke } from "@tauri-apps/api/core";

export type DesktopRefreshTrigger =
  | "boot_restore"
  | "access_token_expired"
  | "network_recovered"
  | "authenticated_request_missing_session"
  | "authenticated_request_401"
  | "manual_retry"
  | "other";

export type DesktopLogoutReason =
  | "user_logout"
  | "change_account"
  | "offline_logout"
  | "other";

export type DesktopSessionDiagnosticEvent =
  | "boot_initialization_started"
  | "boot_initialization_skipped_already_started"
  | "desktop_restore_started"
  | "desktop_health_preflight_started"
  | "desktop_health_preflight_completed"
  | "desktop_health_preflight_exhausted"
  | "desktop_refresh_started"
  | "desktop_refresh_completed"
  | "desktop_refresh_failed"
  | "desktop_credential_write_started"
  | "desktop_credential_write_succeeded"
  | "desktop_credential_write_failed"
  | "desktop_logout_started"
  | "desktop_logout_completed"
  | "desktop_logout_failed";

export interface DesktopSessionDiagnostic {
  timestamp: string;
  bootId: string;
  authOperationId: string;
  processId: number;
  event: DesktopSessionDiagnosticEvent;
  trigger?: DesktopRefreshTrigger;
  logoutReason?: DesktopLogoutReason;
}

type DiagnosticSink = (event: DesktopSessionDiagnostic) => void;

export class DesktopSessionDiagnostics {
  readonly bootId: string;
  private readonly enabled: boolean;
  private readonly sink: DiagnosticSink;
  private readonly processId: () => Promise<number>;
  private readonly now: () => string;
  private readonly randomId: () => string;
  private queue = Promise.resolve();

  constructor(options: {
    enabled?: boolean;
    sink?: DiagnosticSink;
    processId?: () => Promise<number>;
    now?: () => string;
    randomId?: () => string;
  } = {}) {
    this.enabled = options.enabled ?? sessionDiagnosticsEnabled();
    this.sink = options.sink ?? developmentSink;
    this.processId = options.processId ?? (() => invoke<number>("desktop_session_process_id"));
    this.now = options.now ?? (() => new Date().toISOString());
    this.randomId = options.randomId ?? (() => crypto.randomUUID());
    this.bootId = this.randomId();
  }

  operationId() {
    return this.randomId();
  }

  record(
    event: DesktopSessionDiagnosticEvent,
    authOperationId: string,
    metadata: { trigger?: DesktopRefreshTrigger; logoutReason?: DesktopLogoutReason } = {}
  ) {
    if (!this.enabled) return;
    const timestamp = this.now();
    this.queue = this.queue.then(async () => {
      try {
        this.sink({
          timestamp,
          bootId: this.bootId,
          authOperationId,
          processId: await this.processId(),
          event,
          ...(metadata.trigger ? { trigger: metadata.trigger } : {}),
          ...(metadata.logoutReason ? { logoutReason: metadata.logoutReason } : {})
        });
      } catch {
        // Diagnostics are observational and must never alter authentication.
      }
    });
  }

  async flush() {
    await this.queue;
  }
}

function sessionDiagnosticsEnabled() {
  const env = (import.meta as ImportMeta & {
    env?: { DEV?: boolean; VITE_SESSION_DIAGNOSTICS?: string };
  }).env;
  return Boolean(env?.DEV || env?.VITE_SESSION_DIAGNOSTICS === "1");
}

function developmentSink(event: DesktopSessionDiagnostic) {
  // This type has no arbitrary text or secret-bearing fields.
  console.info("[desktop-session]", event);
}

export const desktopSessionDiagnostics = new DesktopSessionDiagnostics();
