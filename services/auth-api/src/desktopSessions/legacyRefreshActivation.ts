import type { Pool } from "pg";

// Pre-cutover session compatibility. The activation instant is the moment the
// operation-identity schema became live, taken from the persisted migration
// marker so that it never moves across restarts, deploys, or instances.
export const LEGACY_REFRESH_ACTIVATION_MIGRATION_VERSION = 18;

// Historical rotation grace restored from 7be4527 desktopSessionPolicy.
export const LEGACY_REFRESH_ROTATION_GRACE_MS = 8_000;

export class LegacyRefreshActivationStateError extends Error {
  readonly code = "desktop_session_activation_state_invalid";
  constructor() {
    super("desktop_session_activation_state_invalid");
    this.name = "LegacyRefreshActivationStateError";
  }
}

export interface LegacyRefreshActivation {
  // Resolves the persisted cutover instant, or undefined when legacy
  // compatibility must fail closed.
  resolve(): Promise<string | undefined>;
  assertConsistent(): Promise<void>;
}

export class StaticLegacyRefreshActivation implements LegacyRefreshActivation {
  private readonly activatedAt?: string;

  constructor(activatedAt?: string) {
    this.activatedAt = normalizeInstant(activatedAt);
  }

  async resolve() { return this.activatedAt; }

  async assertConsistent() {
    if (!this.activatedAt) throw new LegacyRefreshActivationStateError();
  }
}

export class MigrationLegacyRefreshActivation implements LegacyRefreshActivation {
  private readonly pool: Pool;
  private resolved?: string;
  private pending?: Promise<string | undefined>;

  constructor(pool: Pool) { this.pool = pool; }

  // Loaded at most once per process; a failure never widens eligibility and is
  // retried on the next call instead of being cached.
  async resolve() {
    if (this.resolved) return this.resolved;
    this.pending ??= this.load().finally(() => { this.pending = undefined; });
    return await this.pending;
  }

  async assertConsistent() {
    if (!(await this.resolve())) throw new LegacyRefreshActivationStateError();
  }

  private async load() {
    try {
      const result = await this.pool.query<{ appliedAt: string | Date | null }>(
        `SELECT applied_at AS "appliedAt" FROM auth_schema_migrations WHERE version = $1`,
        [LEGACY_REFRESH_ACTIVATION_MIGRATION_VERSION]
      );
      const activatedAt = normalizeInstant(result.rows[0]?.appliedAt ?? undefined);
      if (!activatedAt) return undefined;
      this.resolved = activatedAt;
      return activatedAt;
    } catch {
      return undefined;
    }
  }
}

function normalizeInstant(value?: string | Date) {
  if (value === undefined || value === null) return undefined;
  const parsed = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : undefined;
}
