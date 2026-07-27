const safeHash = /^[a-f0-9]+$/i;

export function steamArtworkUrls(appId: number, iconHash?: string) {
  const id = Number.isSafeInteger(appId) && appId > 0 ? String(appId) : "";
  if (!id) return { coverUrl: "", backgroundUrl: "", iconUrl: "" };
  return {
    coverUrl: `https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/${id}/library_600x900_2x.jpg`,
    backgroundUrl: `https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/${id}/library_hero.jpg`,
    iconUrl: iconHash && safeHash.test(iconHash)
      ? `https://media.steampowered.com/steamcommunity/public/images/apps/${id}/${iconHash}.jpg`
      : ""
  };
}
