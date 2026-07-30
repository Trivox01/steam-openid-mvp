export class SteamIntegrationError extends Error {
  readonly code: string;

  constructor(message: string, code = "unknown") {
    super(message);
    this.code = code;
    this.name = "SteamIntegrationError";
  }
}
