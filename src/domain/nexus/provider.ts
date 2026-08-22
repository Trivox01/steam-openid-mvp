/**
 * Nexus provider identity and capability model.
 *
 * Phase 1 is design-only: this module contains types and pure policy helpers.
 * It performs no I/O, reads no credentials and changes no existing Steam
 * behaviour. Steam is the only provider with proven behaviour; Xbox and
 * PlayStation are declared so the domain can be modelled honestly, not so the
 * product can pretend they work.
 */

export type NexusProvider = "steam" | "xbox" | "playstation";

export const NEXUS_PROVIDERS: readonly NexusProvider[] = [
  "steam",
  "xbox",
  "playstation"
];

export type ProviderCapability =
  | "library"
  | "achievements"
  | "playtime"
  | "presence"
  | "game_metadata";

export const PROVIDER_CAPABILITIES: readonly ProviderCapability[] = [
  "library",
  "achievements",
  "playtime",
  "presence",
  "game_metadata"
];

/**
 * "unverified" is the honest default for anything we have not actually run
 * against a live provider. Only "supported" may unlock UI or data.
 */
export type CapabilitySupport = "supported" | "unsupported" | "unverified";

export type ProviderCapabilities = Readonly<
  Record<ProviderCapability, CapabilitySupport>
>;

export type ProviderIntegrationStatus = "proven" | "unimplemented";

/**
 * Linking protocols differ per provider on purpose. Steam OpenID 2.0 is an
 * identity assertion and returns no provider tokens; Xbox and PlayStation are
 * undetermined until their discovery phase. Forcing one shared login shape
 * would be a design error, so this stays descriptive metadata.
 */
export type ProviderLinkProtocol =
  | "steam_openid"
  | "oauth2_authorization_code"
  | "undetermined";

export type ProviderDescriptor = {
  readonly provider: NexusProvider;
  readonly integrationStatus: ProviderIntegrationStatus;
  readonly linkProtocol: ProviderLinkProtocol;
  /**
   * True when linking this provider is expected to produce per-user provider
   * credentials that must live server-side and encrypted at rest.
   */
  readonly expectsProviderCredentials: boolean;
  readonly capabilities: ProviderCapabilities;
};

const UNVERIFIED_CAPABILITIES: ProviderCapabilities = {
  library: "unverified",
  achievements: "unverified",
  playtime: "unverified",
  presence: "unverified",
  game_metadata: "unverified"
};

const PROVIDER_DESCRIPTORS: Readonly<Record<NexusProvider, ProviderDescriptor>> = {
  steam: {
    provider: "steam",
    integrationStatus: "proven",
    linkProtocol: "steam_openid",
    expectsProviderCredentials: false,
    capabilities: {
      library: "supported",
      achievements: "supported",
      playtime: "supported",
      // Persona state is returned with the profile, but no presence pipeline
      // has been proven in the product. It stays gated until it is.
      presence: "unverified",
      game_metadata: "supported"
    }
  },
  xbox: {
    provider: "xbox",
    integrationStatus: "unimplemented",
    linkProtocol: "undetermined",
    expectsProviderCredentials: true,
    capabilities: UNVERIFIED_CAPABILITIES
  },
  playstation: {
    provider: "playstation",
    integrationStatus: "unimplemented",
    linkProtocol: "undetermined",
    expectsProviderCredentials: true,
    capabilities: UNVERIFIED_CAPABILITIES
  }
};

export class ProviderCapabilityError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.code = code;
    this.name = "ProviderCapabilityError";
  }
}

export function isNexusProvider(value: unknown): value is NexusProvider {
  return (
    typeof value === "string" &&
    (NEXUS_PROVIDERS as readonly string[]).includes(value)
  );
}

export function providerDescriptor(provider: NexusProvider): ProviderDescriptor {
  return PROVIDER_DESCRIPTORS[provider];
}

export function capabilityStatus(
  provider: NexusProvider,
  capability: ProviderCapability
): CapabilitySupport {
  return PROVIDER_DESCRIPTORS[provider].capabilities[capability];
}

/** The only gate the UI and sync services may use. Unverified is not a yes. */
export function supportsCapability(
  provider: NexusProvider,
  capability: ProviderCapability
): boolean {
  return capabilityStatus(provider, capability) === "supported";
}

export function visibleCapabilities(
  provider: NexusProvider
): ProviderCapability[] {
  return PROVIDER_CAPABILITIES.filter((capability) =>
    supportsCapability(provider, capability)
  );
}

export function assertCapability(
  provider: NexusProvider,
  capability: ProviderCapability
): void {
  if (!supportsCapability(provider, capability)) {
    throw new ProviderCapabilityError(
      `capability_unavailable:${provider}:${capability}`
    );
  }
}

/** A provider may only be offered in a linking flow once it is proven. */
export function isProviderLinkable(provider: NexusProvider): boolean {
  return PROVIDER_DESCRIPTORS[provider].integrationStatus === "proven";
}
