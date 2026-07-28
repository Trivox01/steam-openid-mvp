function enabled(value: unknown) {
  return typeof value === "string" && value.trim().toLowerCase() === "true";
}

export const featureFlags = Object.freeze({
  steamOpenIdEnabled: enabled(import.meta.env?.VITE_STEAM_OPENID_ENABLED)
});
