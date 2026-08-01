import { memo, useEffect, useState, type CSSProperties, type ImgHTMLAttributes } from "react";
import nexusAchievementFallback from "../../assets/nexus-achievement-fallback.png";

export type AchievementIconSize = "compact" | "default" | number;
type Props = {
  src?: string | null;
  alt: string;
  size?: AchievementIconSize;
  fallback?: string;
  className?: string;
  loading?: ImgHTMLAttributes<HTMLImageElement>["loading"];
  decoding?: ImgHTMLAttributes<HTMLImageElement>["decoding"];
};

export const AchievementIcon = memo(function AchievementIcon({
  src,
  alt,
  size = "default",
  fallback = nexusAchievementFallback,
  className = "",
  loading = "lazy",
  decoding = "async"
}: Props) {
  const [failed, setFailed] = useState(false);
  const [naturalSize, setNaturalSize] = useState<number>();
  useEffect(() => { setFailed(false); setNaturalSize(undefined); }, [src]);

  const outer = typeof size === "number" ? size : size === "compact" ? 40 : 48;
  const inner = Math.max(1, outer - 4);
  const renderedInner = naturalSize ? Math.min(inner, naturalSize) : inner;
  const useFallback = !src || failed;
  const style = {
    "--achievement-icon-size": `${outer}px`,
    "--achievement-icon-inner": `${renderedInner}px`
  } as CSSProperties;

  return <span
    className={`achievement-icon ${size === "compact" ? "achievement-icon--compact" : ""} ${useFallback ? "is-fallback" : ""} ${className}`.trim()}
    style={style}
    data-achievement-icon-source={useFallback ? "nexus-fallback" : "steam"}
  >
    <img
      src={useFallback ? fallback : src}
      alt={alt}
      loading={loading}
      decoding={decoding}
      draggable={false}
      onLoad={useFallback ? undefined : (event) => {
        const image = event.currentTarget;
        setNaturalSize(Math.min(image.naturalWidth, image.naturalHeight));
      }}
      onError={useFallback ? undefined : () => setFailed(true)}
    />
  </span>;
});
