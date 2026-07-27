import { useEffect, useState } from "react";
import { ImageOff } from "lucide-react";

type GameArtworkProps = {
  src?: string;
  alt: string;
  variant: "cover" | "background";
  className?: string;
  eager?: boolean;
};

const mergeClassNames = (...values: Array<string | false | undefined>) =>
  values.filter(Boolean).join(" ");

export function GameArtwork({
  src,
  alt,
  variant,
  className,
  eager = false
}: GameArtworkProps) {
  const [status, setStatus] = useState<"loading" | "loaded" | "error">(
    src ? "loading" : "error"
  );

  useEffect(() => {
    setStatus(src ? "loading" : "error");
  }, [src]);

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
      {status !== "error" && src && (
        <img
          src={src}
          alt={alt}
          loading={eager ? "eager" : "lazy"}
          decoding="async"
          onLoad={() => setStatus("loaded")}
          onError={() => setStatus("error")}
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
          <span>Artwork unavailable</span>
        </span>
      )}
    </span>
  );
}
