import type { ReactNode } from "react";

type SectionHeaderProps = {
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
};

export function SectionHeader({ title, description, action, className }: SectionHeaderProps) {
  return (
    <header className={["ds-section-header", className].filter(Boolean).join(" ")}>
      <div>
        <h2>{title}</h2>
        {description && <p>{description}</p>}
      </div>
      {action && <div className="ds-section-header__action">{action}</div>}
    </header>
  );
}
