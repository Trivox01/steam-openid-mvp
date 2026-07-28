export interface SecurityLogEntry {
  event: string;
  requestId: string;
  endpoint:
    | "steam_auth_start"
    | "steam_auth_callback"
    | "steam_auth_status"
    | "storage_cleanup";
  status: "success" | "failure" | "temporary_failure";
  durationMs: number;
  errorCode?: string;
}

export interface SafeLogger {
  write(entry: SecurityLogEntry): void;
}

export const jsonSafeLogger: SafeLogger = {
  write(entry) {
    process.stdout.write(`${JSON.stringify(entry)}\n`);
  }
};

export const noOpLogger: SafeLogger = {
  write() {}
};
