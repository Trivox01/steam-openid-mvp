import type { HTMLAttributes } from "react";

type SkeletonProps = HTMLAttributes<HTMLSpanElement> & {
  width?: string;
  height?: string;
  radius?: string;
};

export function Skeleton({ width, height, radius, className, style, ...props }: SkeletonProps) {
  return (
    <span
      className={["ds-skeleton", className].filter(Boolean).join(" ")}
      aria-hidden="true"
      style={{ inlineSize: width, blockSize: height, borderRadius: radius, ...style }}
      {...props}
    />
  );
}
