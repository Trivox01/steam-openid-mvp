import type { ElementType, HTMLAttributes, ReactNode } from "react";

type SurfaceProps = HTMLAttributes<HTMLElement> & {
  as?: ElementType;
  elevation?: "subtle" | "default" | "elevated";
  children: ReactNode;
};

export function Surface({
  as: Component = "section",
  elevation = "default",
  className,
  children,
  ...props
}: SurfaceProps) {
  return (
    <Component
      className={["ds-surface", `ds-surface--${elevation}`, className].filter(Boolean).join(" ")}
      {...props}
    >
      {children}
    </Component>
  );
}
