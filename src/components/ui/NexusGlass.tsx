import type { ElementType, HTMLAttributes, ReactNode } from "react";

export function GlassSurface({
  as: Component = "section",
  variant = "surface",
  interactive = false,
  className,
  children,
  ...props
}: HTMLAttributes<HTMLElement> & {
  as?: ElementType;
  variant?: "strong" | "surface" | "content";
  interactive?: boolean;
  children: ReactNode;
}) {
  return <Component className={["nexus-glass", `nexus-glass--${variant}`, interactive ? "is-interactive" : "", className].filter(Boolean).join(" ")} {...props}>{children}</Component>;
}

export function BentoGrid({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={["nexus-bento", className].filter(Boolean).join(" ")} {...props}>{children}</div>;
}

export function BentoTile({
  as: Component = "section",
  size = "medium",
  className,
  children,
  ...props
}: HTMLAttributes<HTMLElement> & {
  as?: ElementType;
  size?: "small" | "medium" | "wide" | "large";
  children: ReactNode;
}) {
  return <Component className={["nexus-bento__tile", `nexus-bento__tile--${size}`, className].filter(Boolean).join(" ")} {...props}>{children}</Component>;
}

export function AmbientBackdrop() {
  return <div className="nexus-ambient-backdrop" aria-hidden="true"><span /><span /></div>;
}
