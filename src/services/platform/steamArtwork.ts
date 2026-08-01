const safeHash = /^[a-f0-9]+$/i;
const STORE_ASSET_ORIGIN = "https://shared.steamstatic.com";
const LEGACY_STORE_ASSET_ORIGIN = "https://shared.cloudflare.steamstatic.com";

export type SteamArtworkKind = "cover" | "hero" | "square";
export type SteamArtworkCandidate = {
  url: string;
  kind: string;
  origin: "sqlite" | "generated";
  inspectContent: true;
};

export function normalizeSteamArtworkUrl(value?: string | null) {
  if (!value) return "";
  return value.startsWith(`${LEGACY_STORE_ASSET_ORIGIN}/`)
    ? `${STORE_ASSET_ORIGIN}${value.slice(LEGACY_STORE_ASSET_ORIGIN.length)}`
    : value;
}

export function steamArtworkUrls(appId: number, iconHash?: string | null) {
  const id = Number.isSafeInteger(appId) && appId > 0 ? String(appId) : "";
  if (!id) return { coverUrl: "", backgroundUrl: "", iconUrl: "", coverFallbackUrls: [], backgroundFallbackUrls: [] };
  const assetRoot = `${STORE_ASSET_ORIGIN}/store_item_assets/steam/apps/${id}`;
  return {
    coverUrl: `${assetRoot}/library_600x900_2x.jpg`,
    backgroundUrl: `${assetRoot}/library_hero.jpg`,
    iconUrl: iconHash && safeHash.test(iconHash)
      ? `https://media.steampowered.com/steamcommunity/public/images/apps/${id}/${iconHash}.jpg`
      : "",
    coverFallbackUrls: [
      `${assetRoot}/library_600x900.jpg`,
      `${assetRoot}/header.jpg`,
      `${assetRoot}/library_hero.jpg`
    ],
    backgroundFallbackUrls: [
      `${assetRoot}/header.jpg`,
      `${assetRoot}/capsule_616x353.jpg`
    ]
  };
}

export function steamArtworkSources(options: {
  appId: string | number;
  kind: SteamArtworkKind;
  storedUrl?: string;
  iconUrl?: string;
}): SteamArtworkCandidate[] {
  const numericId = typeof options.appId === "number" ? options.appId : Number(options.appId);
  if (!Number.isSafeInteger(numericId) || numericId <= 0) return [];
  const artwork = steamArtworkUrls(numericId);
  const root = `${STORE_ASSET_ORIGIN}/store_item_assets/steam/apps/${numericId}`;
  const stored = normalizeSteamArtworkUrl(options.storedUrl);
  const icon = normalizeSteamArtworkUrl(options.iconUrl);
  const definitions = options.kind === "cover"
    ? [
        candidate(stored, "portrait-stored", "sqlite"),
        candidate(artwork.coverUrl, "library-capsule-portrait-2x", "generated"),
        candidate(`${root}/library_600x900.jpg`, "library-capsule-portrait", "generated"),
        candidate(`${root}/header.jpg`, "header-crop", "generated"),
        candidate(artwork.backgroundUrl, "library-hero-crop", "generated"),
        candidate(icon, "app-icon", "sqlite")
      ]
    : options.kind === "hero"
      ? [
          candidate(stored, "hero-stored", "sqlite"),
          candidate(artwork.backgroundUrl, "library-hero", "generated"),
          candidate(`${root}/header.jpg`, "header", "generated"),
          candidate(`${root}/capsule_616x353.jpg`, "main-capsule", "generated")
        ]
      : [
          candidate(icon, "app-icon", "sqlite"),
          candidate(`${root}/logo.png`, "library-logo", "generated"),
          candidate(`${root}/capsule_231x87.jpg`, "small-capsule-crop", "generated"),
          candidate(artwork.backgroundUrl, "library-hero-crop", "generated"),
          candidate(`${root}/header.jpg`, "header-crop", "generated")
        ];
  const seen = new Set<string>();
  return definitions.filter((item): item is SteamArtworkCandidate => {
    if (!item || seen.has(item.url)) return false;
    seen.add(item.url);
    return true;
  });
}

export function steamArtworkFallbacks(appId: string | number, variant: "cover" | "background") {
  const numericId = typeof appId === "number" ? appId : Number(appId);
  const artwork = steamArtworkUrls(numericId);
  return variant === "cover" ? artwork.coverFallbackUrls : artwork.backgroundFallbackUrls;
}

function candidate(url: string, kind: string, origin: SteamArtworkCandidate["origin"]): SteamArtworkCandidate | undefined {
  return url ? { url, kind, origin, inspectContent: true } : undefined;
}
