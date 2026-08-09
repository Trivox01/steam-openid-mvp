import type { ElementType, HTMLAttributes, ReactNode } from "react";

type SurfaceProps = HTMLAttributes<HTMLElement> & {
  as?: ElementType;
  density?: "compact" | "normal";
  elevation?: "subtle" | "default" | "elevated";
  variant?: "solid" | "glass" | "strong";
  interactive?: boolean;
  children: ReactNode;
};

export function Surface({
  as: Component = "section",
  density = "normal",
  elevation = "default",
  variant = "solid",
  interactive = false,
  className,
  children,
  ...props
}: SurfaceProps) {
  return (
    <Component
      className={[
        "ds-surface",
        `ds-surface--density-${density}`,
        `ds-surface--${elevation}`,
        `ds-surface--${variant}`,
        interactive ? "ds-surface--interactive" : "",
        className
      ].filter(Boolean).join(" ")}
      {...props}
    >
      {children}
    </Component>
  );
}
