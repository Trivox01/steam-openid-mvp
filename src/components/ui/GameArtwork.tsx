import { useEffect, useMemo, useRef, useState } from "react";
import { ImageOff } from "lucide-react";
import { useTranslation } from "../../i18n/TranslationContext";
import { isMeaningfulArtworkPixels } from "../../services/platform/artworkContent";

export type GameArtworkSource = {
  url: string;
  kind?: string;
  origin?: "sqlite" | "generated" | "remote";
  inspectContent?: boolean;
};

type GameArtworkProps = {
  src?: string;
  fallbackSources?: readonly string[];
  sources?: readonly GameArtworkSource[];
  alt: string;
  variant: "cover" | "background" | "square";
  className?: string;
  eager?: boolean;
  appId?: string;
  componentName?: string;
};

const MAX_ARTWORK_ATTEMPTS = 6;
const MAX_VALIDATION_CACHE_ENTRIES = 512;
const artworkValidationCache = new Map<string, boolean>();
const ALLOWED_ARTWORK_HOSTS = new Set([
  "shared.steamstatic.com",
  "shared.cloudflare.steamstatic.com",
  "media.steampowered.com"
]);

const mergeClassNames = (...values: Array<string | false | undefined>) =>
  values.filter(Boolean).join(" ");

export function GameArtwork({
  src,
  fallbackSources = [],
  sources: explicitSources,
  alt,
  variant,
  className,
  eager = false,
  appId,
  componentName = "GameArtwork"
}: GameArtworkProps) {
  const { t } = useTranslation();
  const sourceSignature = JSON.stringify(explicitSources ?? [
    ...(src ? [{ url: src, origin: "sqlite" as const }] : []),
    ...fallbackSources.map((url) => ({ url, origin: "generated" as const }))
  ]);
  const sources = useMemo(() => {
    const parsed = JSON.parse(sourceSignature) as GameArtworkSource[];
    const seen = new Set<string>();
    return parsed.filter((item) => item.url && !seen.has(item.url) && Boolean(seen.add(item.url)))
      .slice(0, MAX_ARTWORK_ATTEMPTS);
  }, [sourceSignature]);
  const [sourceIndex, setSourceIndex] = useState(0);
  const [status, setStatus] = useState<"loading" | "loaded" | "error">(
    sources.length ? "loading" : "error"
  );
  const imageRef = useRef<HTMLImageElement>(null);
  const generationRef = useRef(0);
  const settledSourceRef = useRef("");

  useEffect(() => {
    generationRef.current += 1;
    settledSourceRef.current = "";
    setSourceIndex(0);
    setStatus(sources.length ? "loading" : "error");
    return () => { generationRef.current += 1; };
  }, [sources]);

  const activeSource = sources[sourceIndex];
  const advance = (reason: string, image?: HTMLImageElement) => {
    if (!activeSource || settledSourceRef.current === activeSource.url) return;
    settledSourceRef.current = activeSource.url;
    logArtwork("failed", reason, activeSource, image, appId, variant, componentName);
    if (sourceIndex + 1 < sources.length) {
      setSourceIndex((index) => index + 1);
      setStatus("loading");
    } else {
      setStatus("error");
    }
  };
  const acceptLoaded = async (image: HTMLImageElement) => {
    if (!activeSource || settledSourceRef.current === activeSource.url) return;
    const generation = generationRef.current;
    if (activeSource.inspectContent && !(await hasMeaningfulArtworkContent(image))) {
      if (generation === generationRef.current) advance("visually_empty_image", image);
      return;
    }
    if (generation !== generationRef.current) return;
    settledSourceRef.current = activeSource.url;
    setStatus("loaded");
    logArtwork("loaded", "image_loaded", activeSource, image, appId, variant, componentName);
  };

  useEffect(() => {
    settledSourceRef.current = "";
    const image = imageRef.current;
    if (!activeSource || !image?.complete) return;
    if (image.naturalWidth > 0) void acceptLoaded(image);
    else advance("completed_without_image_data", image);
  }, [activeSource?.url]);

  return (
    <span
      data-artwork-source-kind={activeSource?.kind}
      className={mergeClassNames(
        "game-artwork",
        `game-artwork--${variant}`,
        status === "loaded" && "is-loaded",
        status === "error" && "has-error",
        className
      )}
    >
      {status === "loading" && <span className="game-artwork__skeleton" aria-hidden="true" />}
      {status !== "error" && activeSource && (
        <img
          ref={imageRef}
          key={activeSource.url}
          src={activeSource.url}
          alt={alt}
          crossOrigin={activeSource.inspectContent ? "anonymous" : undefined}
          loading={eager ? "eager" : "lazy"}
          decoding="async"
          onLoad={(event) => void acceptLoaded(event.currentTarget)}
          onError={(event) => advance("image_error_event", event.currentTarget)}
        />
      )}
      {status === "error" && (
        <span
          className="game-artwork__fallback"
          role={alt ? "img" : undefined}
          aria-label={alt || undefined}
          aria-hidden={alt ? undefined : true}
        >
          <ImageOff aria-hidden="true" />
          <span>{t("common.artworkUnavailable")}</span>
        </span>
      )}
    </span>
  );
}

async function hasMeaningfulArtworkContent(image: HTMLImageElement) {
  const cacheKey = image.currentSrc || image.src;
  const cached = artworkValidationCache.get(cacheKey);
  if (cached !== undefined) return cached;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 16;
    canvas.height = 16;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return true;
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const result = isMeaningfulArtworkPixels(context.getImageData(0, 0, canvas.width, canvas.height).data);
    artworkValidationCache.set(cacheKey, result);
    if (artworkValidationCache.size > MAX_VALIDATION_CACHE_ENTRIES) artworkValidationCache.delete(artworkValidationCache.keys().next().value!);
    return result;
  } catch {
    return true;
  }
}

function logArtwork(
  outcome: "loaded" | "failed",
  reason: string,
  source: GameArtworkSource,
  image: HTMLImageElement | undefined,
  appId: string | undefined,
  kind: string,
  component: string
) {
  if (!import.meta.env.DEV) return;
  let cspResult = "not_applicable";
  try {
    const url = new URL(source.url);
    cspResult = url.protocol === "data:" || ALLOWED_ARTWORK_HOSTS.has(url.hostname) ? "allowed" : "not_allowlisted";
  } catch {
    cspResult = "invalid_url";
  }
  const details = {
    appId: appId || "unavailable",
    artworkKind: source.kind ?? kind,
    imageUrl: source.url,
    finalUrl: image?.currentSrc || source.url,
    contentType: "unavailable_in_webview",
    httpStatus: "unavailable_in_webview",
    cspResult,
    component,
    source: source.origin ?? "remote",
    reason
  };
  if (outcome === "failed") console.warn("[game-artwork]", details);
  else console.info("[game-artwork]", details);
}
