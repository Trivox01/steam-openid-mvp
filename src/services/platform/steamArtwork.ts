const safeHash = /^[a-f0-9]+$/i;

export function steamArtworkUrls(appId: number, iconHash?: string | null) {
  const id = Number.isSafeInteger(appId) && appId > 0 ? String(appId) : "";
  if (!id) return { coverUrl: "", backgroundUrl: "", iconUrl: "", coverFallbackUrls: [], backgroundFallbackUrls: [] };
  const assetRoot = `https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/${id}`;
  return {
    coverUrl: `${assetRoot}/library_600x900_2x.jpg`,
    backgroundUrl: `${assetRoot}/library_hero.jpg`,
    iconUrl: iconHash && safeHash.test(iconHash)
      ? `https://media.steampowered.com/steamcommunity/public/images/apps/${id}/${iconHash}.jpg`
      : "",
    coverFallbackUrls: [
      `${assetRoot}/library_600x900.jpg`,
      `${assetRoot}/header.jpg`
    ],
    backgroundFallbackUrls: [
      `${assetRoot}/page_bg_generated_v6b.jpg`,
      `${assetRoot}/header.jpg`
    ]
  };
}

export function steamArtworkFallbacks(appId: string | number, variant: "cover" | "background") {
  const numericId = typeof appId === "number" ? appId : Number(appId);
  const artwork = steamArtworkUrls(numericId);
  return variant === "cover" ? artwork.coverFallbackUrls : artwork.backgroundFallbackUrls;
}
