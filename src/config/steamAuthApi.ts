export function getSteamAuthApiBaseUrl() {
  const value = import.meta.env?.VITE_STEAM_AUTH_API_URL?.trim();
  if (!value) throw new Error("steam_auth_api_not_configured");
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.hash) {
    throw new Error("steam_auth_api_invalid");
  }
  return url.toString().replace(/\/$/, "");
}
