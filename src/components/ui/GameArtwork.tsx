import { useEffect, useMemo, useRef, useState } from "react";
import { ImageOff } from "lucide-react";
import { useTranslation } from "../../i18n/TranslationContext";

type GameArtworkProps = {
  src?: string;
  fallbackSources?: readonly string[];
  alt: string;
  variant: "cover" | "background";
  className?: string;
  eager?: boolean;
};

const mergeClassNames = (...values: Array<string | false | undefined>) =>
  values.filter(Boolean).join(" ");

export function GameArtwork({
  src,
  fallbackSources = [],
  alt,
  variant,
  className,
  eager = false
}: GameArtworkProps) {
  const { t } = useTranslation();
  const sourceSignature = [src, ...fallbackSources].filter(Boolean).join("\n");
  const sources = useMemo(() => sourceSignature.split("\n").filter(Boolean), [sourceSignature]);
  const [sourceIndex, setSourceIndex] = useState(0);
  const [status, setStatus] = useState<"loading" | "loaded" | "error">(
    sources.length ? "loading" : "error"
  );
  const imageRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    setSourceIndex(0);
    setStatus(sources.length ? "loading" : "error");
  }, [sources]);

  const activeSource = sources[sourceIndex];

  useEffect(() => {
    const image = imageRef.current;
    if (!activeSource || !image?.complete) return;
    if (image.naturalWidth > 0) {
      setStatus("loaded");
    } else if (sourceIndex + 1 < sources.length) {
      setSourceIndex((index) => index + 1);
      setStatus("loading");
    } else {
      setStatus("error");
    }
  }, [activeSource, sourceIndex, sources.length]);

  return (
    <span
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
          key={activeSource}
          src={activeSource}
          alt={alt}
          loading={eager ? "eager" : "lazy"}
          decoding="async"
          onLoad={() => setStatus("loaded")}
          onError={() => {
            if (sourceIndex + 1 < sources.length) {
              setSourceIndex((index) => index + 1);
              setStatus("loading");
            } else {
              setStatus("error");
            }
          }}
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
