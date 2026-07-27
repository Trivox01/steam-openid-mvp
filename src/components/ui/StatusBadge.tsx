import type { HTMLAttributes, ReactNode } from "react";

type StatusBadgeProps = HTMLAttributes<HTMLSpanElement> & {
  tone?: "neutral" | "accent" | "success" | "warning" | "error";
  children: ReactNode;
};

export function StatusBadge({ tone = "neutral", className, children, ...props }: StatusBadgeProps) {
  return (
    <span className={["ds-status-badge", `ds-status-badge--${tone}`, className].filter(Boolean).join(" ")} {...props}>
      {children}
    </span>
  );
}
